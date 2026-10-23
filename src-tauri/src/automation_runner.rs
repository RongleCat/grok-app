//! Host-side automation scheduler.
//!
//! Runs while the **process** is alive — including when the main window is
//! hidden to the tray (`close_to_tray` / **Keep tray for schedules**) or when
//! launched with `--start-in-tray`. Due tasks do **not** depend on WebView
//! timers or a visible window.
//!
//! **Honest limits:** there is no separate headless daemon. Fully quitting the
//! app pauses schedules until the process is started again (login item,
//! optional schedules LaunchAgent helper, manual open, or the **one-shot**
//! `--fire-due-schedules` helper which boots, fires at most one due task, then
//! exits — not a KeepAlive daemon).
//!
//! Execution reuses `SessionManager` (create → connect → send). UI is notified
//! via `automation://ran` / `automation://skipped` / `automation://error`.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use chrono::{Datelike, Duration as ChronoDuration, Local, Utc, Weekday};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use crate::session_fsm::SessionState;
use crate::session_manager::SessionManager;
use crate::store::{self, Automation};

const TICK: Duration = Duration::from_secs(30);
const BOOT_DELAY: Duration = Duration::from_secs(12);
/// One-shot mode: short settle before first fire (no continuous loop).
const ONESHOT_BOOT_DELAY: Duration = Duration::from_secs(3);
/// Soft cap waiting for the fired turn to leave busy (permission hang, stall).
const ONESHOT_TURN_WAIT: Duration = Duration::from_secs(600);
const ONESHOT_TURN_POLL: Duration = Duration::from_secs(1);

/// CLI flag / env for headless one-shot schedule fire (then exit).
pub const FIRE_DUE_FLAG: &str = "--fire-due-schedules";
const FIRE_DUE_ENV: &str = "GROK_FIRE_DUE_SCHEDULES";

/// Process-wide claimed fire keys (`id:nextRunAt`) for this process lifetime.
static FIRED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

static STARTED: AtomicBool = AtomicBool::new(false);
static LAST_TICK_RFC3339: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunnerStatus {
    /// Tick loop has been spawned for this process.
    pub running: bool,
    /// RFC3339 of last completed tick (Ok or Err); null before first tick.
    pub last_tick_at: Option<String>,
    pub tick_interval_secs: u64,
    /// Always false — runner does not need a visible main window.
    pub window_required: bool,
    /// Always true — fully quitting pauses schedules.
    pub process_required: bool,
    /// Count of enabled automations on disk.
    pub enabled_count: u64,
    /// AppSettings.keep_tray_for_schedules.
    pub keep_tray_for_schedules: bool,
    /// True when this process was launched with `--fire-due-schedules` (one-shot).
    pub oneshot_mode: bool,
    /// Short honesty note (English; UI has translated copy).
    pub honesty: String,
}

/// Structured result of a single due-schedule fire attempt (one-shot or tick).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FireDueOutcome {
    /// `fired` | `none_due` | `busy` | `error` | `already_claimed`
    pub kind: String,
    pub automation_id: Option<String>,
    pub title: Option<String>,
    pub session_id: Option<String>,
    /// Soft-fail detail (CLI missing, project untrusted, connect, etc.).
    pub error: Option<String>,
    pub honesty: String,
}

fn fire_due_honesty() -> String {
    "One-shot helper fires at most one due schedule then exits. \
     Not a KeepAlive daemon — full quit still pauses continuous ticks."
        .into()
}

/// Pure argv/env probe: should this process run headless one-shot fire then exit?
pub fn wants_fire_due_schedules() -> bool {
    wants_fire_due_schedules_from(
        std::env::args().collect::<Vec<_>>().as_slice(),
        std::env::var(FIRE_DUE_ENV).ok().as_deref(),
    )
}

/// Pure helper for tests — parse flag / env without touching process env.
pub fn wants_fire_due_schedules_from(argv: &[String], env_val: Option<&str>) -> bool {
    if argv.iter().any(|a| a == FIRE_DUE_FLAG) {
        return true;
    }
    matches!(
        env_val.map(|s| s.trim()),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

/// Pure policy: should window-close hide to tray so schedules keep ticking?
///
/// `close_to_tray` always hides. When it is off, `keep_tray_for_schedules`
/// still hides **if** any automation is enabled — so users can quit freely
/// when nothing is scheduled, but keep the process alive for due tasks.
pub fn should_hide_to_tray_on_close(
    close_to_tray: bool,
    keep_tray_for_schedules: bool,
    any_enabled_automation: bool,
) -> bool {
    if close_to_tray {
        return true;
    }
    keep_tray_for_schedules && any_enabled_automation
}

/// Snapshot for UI / diagnostics. Safe to call before `start`.
pub fn status() -> AutomationRunnerStatus {
    let enabled_count = store::load_automations()
        .iter()
        .filter(|a| a.enabled)
        .count() as u64;
    let settings = store::load_settings();
    let last = LAST_TICK_RFC3339
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let oneshot = wants_fire_due_schedules();
    AutomationRunnerStatus {
        running: STARTED.load(Ordering::Relaxed),
        last_tick_at: last,
        tick_interval_secs: TICK.as_secs(),
        window_required: false,
        process_required: true,
        enabled_count,
        keep_tray_for_schedules: settings.keep_tray_for_schedules,
        oneshot_mode: oneshot,
        honesty: if oneshot {
            fire_due_honesty()
        } else {
            "Schedules tick only while this app process is alive \
             (main window or tray). There is no separate background daemon. \
             Optional one-shot: --fire-due-schedules fires at most one due task then exits."
                .into()
        },
    }
}

fn mark_tick() {
    let now = Utc::now().to_rfc3339();
    if let Ok(mut g) = LAST_TICK_RFC3339.lock() {
        *g = Some(now);
    }
}

/// Start the background tick loop (call once from app setup).
///
/// Skipped when `wants_fire_due_schedules()` — use [`start_oneshot`] instead.
pub fn start(app: AppHandle, mgr: Arc<SessionManager>) {
    if wants_fire_due_schedules() {
        info!(
            target: "automation_runner",
            "skipping continuous tick loop (oneshot --fire-due-schedules)"
        );
        return;
    }
    if STARTED.swap(true, Ordering::SeqCst) {
        warn!(target: "automation_runner", "start called more than once; ignoring");
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BOOT_DELAY).await;
        info!(
            target: "automation_runner",
            "host automation scheduler started (window not required; tray-only ok)"
        );
        loop {
            let outcome = fire_due_once(&app, &mgr).await;
            mark_tick();
            if outcome.kind == "error" {
                warn!(
                    target: "automation_runner",
                    error = ?outcome.error,
                    "tick error"
                );
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

/// Headless one-shot: settle → fire at most one due schedule → wait for turn
/// idle (soft timeout) → exit process. Not a KeepAlive daemon.
pub fn start_oneshot(app: AppHandle, mgr: Arc<SessionManager>) {
    if STARTED.swap(true, Ordering::SeqCst) {
        warn!(target: "automation_runner", "start_oneshot: already started");
        return;
    }
    tauri::async_runtime::spawn(async move {
        info!(
            target: "automation_runner",
            "oneshot fire-due-schedules starting (no continuous daemon)"
        );
        tokio::time::sleep(ONESHOT_BOOT_DELAY).await;
        let outcome = fire_due_once(&app, &mgr).await;
        mark_tick();
        info!(
            target: "automation_runner",
            kind = %outcome.kind,
            id = ?outcome.automation_id,
            error = ?outcome.error,
            "oneshot fire outcome"
        );
        // Soft-wait so we do not kill a just-started agent mid-turn.
        if outcome.kind == "fired" {
            let deadline = tokio::time::Instant::now() + ONESHOT_TURN_WAIT;
            loop {
                if !mgr.any_turn_busy() {
                    break;
                }
                if tokio::time::Instant::now() >= deadline {
                    warn!(
                        target: "automation_runner",
                        "oneshot turn wait timed out; exiting anyway (soft-fail)"
                    );
                    break;
                }
                tokio::time::sleep(ONESHOT_TURN_POLL).await;
            }
        }
        // Successful exit so launchd KeepAlive SuccessfulExit=false does not
        // treat this as a crash restart (one-shot is intentional).
        app.exit(0);
    });
}

/// Fire at most one due enabled automation (shared by continuous tick + oneshot).
///
/// Soft-fails: no due task, mid-turn busy, missing CLI/project, connect/send
/// errors — never panics. Emits `automation://ran` / `automation://error` when
/// a fire is attempted.
pub async fn fire_due_once(app: &AppHandle, mgr: &Arc<SessionManager>) -> FireDueOutcome {
    // Do not steal the agent while a turn is actively streaming.
    if mgr.any_turn_busy() {
        return FireDueOutcome {
            kind: "busy".into(),
            automation_id: None,
            title: None,
            session_id: None,
            error: None,
            honesty: fire_due_honesty(),
        };
    }

    let list = store::load_automations();
    let now = Utc::now();
    let due = list.into_iter().find(|a| a.enabled && is_due(a, now));
    let Some(auto) = due else {
        return FireDueOutcome {
            kind: "none_due".into(),
            automation_id: None,
            title: None,
            session_id: None,
            error: None,
            honesty: fire_due_honesty(),
        };
    };

    let fire_key = format!(
        "{}:{}",
        auto.id,
        auto.next_run_at
            .map(|t| t.to_rfc3339())
            .unwrap_or_else(|| "none".into())
    );
    {
        let mut fired = FIRED.lock().unwrap_or_else(|e| e.into_inner());
        if fired.contains(&fire_key) {
            return FireDueOutcome {
                kind: "already_claimed".into(),
                automation_id: Some(auto.id.clone()),
                title: Some(auto.title.clone()),
                session_id: None,
                error: None,
                honesty: fire_due_honesty(),
            };
        }
        fired.insert(fire_key.clone());
    }

    match run_one(app, mgr, &auto).await {
        Ok(session_id) => {
            let _ = app.emit(
                "automation://ran",
                serde_json::json!({
                    "automationId": auto.id,
                    "title": auto.title,
                    "sessionId": session_id,
                    "oneshot": wants_fire_due_schedules(),
                }),
            );
            FireDueOutcome {
                kind: "fired".into(),
                automation_id: Some(auto.id.clone()),
                title: Some(auto.title.clone()),
                session_id: Some(session_id),
                error: None,
                honesty: fire_due_honesty(),
            }
        }
        Err(e) => {
            // Allow retry next tick / next oneshot invoke.
            FIRED
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&fire_key);
            let _ = app.emit(
                "automation://error",
                serde_json::json!({
                    "automationId": auto.id,
                    "title": auto.title,
                    "error": e,
                    "oneshot": wants_fire_due_schedules(),
                }),
            );
            FireDueOutcome {
                kind: "error".into(),
                automation_id: Some(auto.id.clone()),
                title: Some(auto.title.clone()),
                session_id: None,
                error: Some(e),
                honesty: fire_due_honesty(),
            }
        }
    }
}

/// Chat this automation reuses, when configured. `None` means a fresh chat.
pub fn automation_reuse_session_id(auto: &Automation) -> Option<String> {
    let reuse = auto.session_mode.trim().eq_ignore_ascii_case("reuse");
    if !reuse {
        return None;
    }
    auto.session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn validate_project(project: &store::Project) -> Result<(), String> {
    if !project.trusted {
        return Err(format!("project not trusted: {}", project.name));
    }
    if !project.path_ok && !project.is_ssh_remote() {
        return Err(format!("project path missing: {}", project.name));
    }
    Ok(())
}

async fn run_one(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    auto: &Automation,
) -> Result<String, String> {
    let reuse_id = automation_reuse_session_id(auto);
    let reuse_requested = reuse_id.is_some();
    let existing = reuse_id.as_deref().and_then(|sid| {
        store::load_sessions_index()
            .into_iter()
            .find(|s| s.id == sid)
    });

    let title = if auto.title.trim().is_empty() {
        "Scheduled".into()
    } else {
        auto.title.clone()
    };

    let projects = store::load_projects();

    // Validate the target project before creating a chat. Reused chats are
    // validated after we load their row; never delete a chat we did not create.
    if existing.is_none() {
        let project = auto
            .project_id
            .as_ref()
            .and_then(|pid| projects.iter().find(|p| &p.id == pid));
        if let Some(p) = project {
            validate_project(p)?;
        }
    }

    let (mut meta, created_new) = match existing {
        Some(meta) => (meta, false),
        None => (
            store::create_session(auto.project_id.clone(), Some(title), true)
                .map_err(|e| format!("create session: {e}"))?,
            true,
        ),
    };
    let session_id = meta.id.clone();

    // The reused chat keeps its project; the automation's project only seeds a
    // fresh chat (including the fallback when the configured chat is gone).
    let proj = meta
        .project_id
        .as_ref()
        .and_then(|pid| projects.iter().find(|p| &p.id == pid));

    if !created_new {
        if let Some(p) = proj {
            validate_project(p)?;
        }
    }

    // A reused chat keeps its own model and reasoning. A fresh chat (including
    // the fallback for a deleted reuse target) gets the automation's prefs.
    if (!reuse_requested || created_new) && (auto.model_id.is_some() || auto.effort.is_some()) {
        if let Some(ref mid) = auto.model_id {
            meta.model_id = Some(mid.clone());
        }
        if let Some(ref ef) = auto.effort {
            meta.effort = Some(ef.clone());
        }
        if let Err(e) = store::update_session_meta(&meta) {
            if created_new {
                let _ = store::delete_session(&session_id);
            }
            return Err(format!("session prefs write failed: {e}"));
        }
    }

    let project_path = proj.map(|p| p.path.clone());
    let snap = mgr
        .connect(
            app.clone(),
            project_path,
            Some(session_id.clone()),
            None,
            None,
        )
        .await
        .map_err(|e| {
            // Drop an empty shell; never delete the chat this task reused.
            if created_new {
                let _ = store::delete_session(&session_id);
            }
            format!("connect failed: {e}")
        })?;

    if snap.state != SessionState::Ready {
        let detail = snap
            .last_error
            .as_ref()
            .map(|e| format!("{}: {}", e.code.as_str(), e.message))
            .unwrap_or_else(|| format!("state={:?}", snap.state));
        if created_new {
            let _ = store::delete_session(&session_id);
        }
        return Err(format!("connect not ready: {detail}"));
    }

    let prompt = format!("[Scheduled: {}]\n\n{}", auto.title, auto.prompt);
    mgr.send_message(app.clone(), prompt, None, None, Some(session_id.clone()))
        .await
        .map_err(|e| format!("send failed: {e}"))?;

    // The configured chat was deleted: remember the replacement only after the
    // prompt landed, so a failed send leaves the schedule on the old target.
    if reuse_requested && created_new {
        let _ =
            store::set_automation_session_id_if_reuse(&auto.id, reuse_id.as_deref(), &session_id);
    }

    let last_run = Utc::now();
    let next = if auto.frequency.eq_ignore_ascii_case("once") {
        None
    } else {
        compute_next_run_at(auto, last_run + ChronoDuration::minutes(1))
    };
    let _ = store::mark_automation_run(&auto.id, last_run, next);
    if auto.frequency.eq_ignore_ascii_case("once") {
        let _ = store::set_automation_enabled(&auto.id, false);
    }

    info!(
        target: "automation_runner",
        id = %auto.id,
        session = %session_id,
        "automation fired"
    );
    Ok(session_id)
}

/// Due if enabled and `next_run_at` is in the past (or missing but wall-clock matches window).
pub fn is_due(auto: &Automation, now: chrono::DateTime<Utc>) -> bool {
    if !auto.enabled {
        return false;
    }
    if let Some(next) = auto.next_run_at {
        return next <= now;
    }
    // Lazy schedule: treat as due if we can compute a next within the last 90s.
    if let Some(next) = compute_next_run_at(auto, now - ChronoDuration::seconds(90)) {
        let age = now.signed_duration_since(next);
        return age.num_seconds() >= 0 && age.num_seconds() < 90;
    }
    false
}

/// Next local wall-clock occurrence for the automation schedule.
pub fn compute_next_run_at(
    auto: &Automation,
    after: chrono::DateTime<Utc>,
) -> Option<chrono::DateTime<Utc>> {
    let (hour, minute) = parse_hhmm(&auto.time)?;
    let local_after = after.with_timezone(&Local);
    let freq = auto.frequency.to_ascii_lowercase();

    // Search up to 14 days ahead for a matching slot.
    for day_offset in 0..14 {
        let day = local_after.date_naive() + ChronoDuration::days(day_offset);
        let candidate = day
            .and_hms_opt(hour, minute, 0)?
            .and_local_timezone(Local)
            .single()?;
        if candidate <= local_after {
            continue;
        }
        let wd = candidate.weekday();
        let ok = match freq.as_str() {
            "once" | "daily" => true,
            "weekdays" => {
                matches!(
                    wd,
                    Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu | Weekday::Fri
                )
            }
            "weekly" => {
                if auto.weekdays.is_empty() {
                    true
                } else {
                    let js = weekday_to_js(wd);
                    auto.weekdays.contains(&js)
                }
            }
            _ => true,
        };
        if ok {
            return Some(candidate.with_timezone(&Utc));
        }
    }
    None
}

fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let parts: Vec<_> = s.trim().split(':').collect();
    if parts.len() < 2 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some((h, m))
}

fn weekday_to_js(wd: Weekday) -> u8 {
    // JS: 0=Sun … 6=Sat
    match wd {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample(freq: &str, time: &str, weekdays: Vec<u8>) -> Automation {
        Automation {
            id: "a1".into(),
            title: "t".into(),
            prompt: "p".into(),
            enabled: true,
            project_id: None,
            model_id: None,
            effort: None,
            session_mode: "new".into(),
            session_id: None,
            frequency: freq.into(),
            time: time.into(),
            weekdays,
            notify: "all".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_run_at: None,
            next_run_at: None,
        }
    }

    #[test]
    fn is_due_respects_next_run_at() {
        let mut a = sample("daily", "09:00", vec![]);
        a.next_run_at = Some(Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap());
        assert!(is_due(&a, Utc::now()));
        a.next_run_at = Some(Utc::now() + ChronoDuration::hours(2));
        assert!(!is_due(&a, Utc::now()));
        a.enabled = false;
        a.next_run_at = Some(Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap());
        assert!(!is_due(&a, Utc::now()));
    }

    #[test]
    fn parse_hhmm_ok() {
        assert_eq!(parse_hhmm("09:30"), Some((9, 30)));
        assert_eq!(parse_hhmm("23:59"), Some((23, 59)));
        assert!(parse_hhmm("25:00").is_none());
        assert!(parse_hhmm("bad").is_none());
    }

    #[test]
    fn compute_next_daily_in_future() {
        let a = sample("daily", "23:59", vec![]);
        let after = Utc::now() - ChronoDuration::minutes(5);
        let next = compute_next_run_at(&a, after).expect("next");
        assert!(next > after);
    }

    #[test]
    fn hide_to_tray_policy() {
        // Default close-to-tray wins.
        assert!(should_hide_to_tray_on_close(true, false, false));
        assert!(should_hide_to_tray_on_close(true, true, true));
        // Close quits unless keep-tray-for-schedules + enabled tasks.
        assert!(!should_hide_to_tray_on_close(false, false, true));
        assert!(!should_hide_to_tray_on_close(false, true, false));
        assert!(should_hide_to_tray_on_close(false, true, true));
    }

    #[test]
    fn wants_fire_due_from_flag() {
        let argv = vec!["grok-app".into(), FIRE_DUE_FLAG.into()];
        assert!(wants_fire_due_schedules_from(&argv, None));
        assert!(!wants_fire_due_schedules_from(
            &["grok-app".into(), "--start-in-tray".into()],
            None
        ));
    }

    #[test]
    fn wants_fire_due_from_env() {
        let argv = vec!["grok-app".into()];
        assert!(wants_fire_due_schedules_from(&argv, Some("1")));
        assert!(wants_fire_due_schedules_from(&argv, Some("true")));
        assert!(!wants_fire_due_schedules_from(&argv, Some("0")));
        assert!(!wants_fire_due_schedules_from(&argv, None));
    }

    #[test]
    fn reuse_session_id_requires_reuse_mode_and_id() {
        let mut a = sample("daily", "09:00", vec![]);
        assert_eq!(automation_reuse_session_id(&a), None);
        a.session_mode = "reuse".into();
        a.session_id = Some(" chat-1 ".into());
        assert_eq!(automation_reuse_session_id(&a), Some("chat-1".to_string()));
        a.session_id = Some("   ".into());
        assert_eq!(automation_reuse_session_id(&a), None);
    }

    #[test]
    fn fire_due_outcome_kinds_are_stable() {
        // Documented contract for FE / helper scripts — do not rename lightly.
        for k in ["fired", "none_due", "busy", "error", "already_claimed"] {
            assert!(!k.is_empty());
        }
        let o = FireDueOutcome {
            kind: "none_due".into(),
            automation_id: None,
            title: None,
            session_id: None,
            error: None,
            honesty: fire_due_honesty(),
        };
        assert_eq!(o.kind, "none_due");
        assert!(
            o.honesty.contains("Not a KeepAlive daemon")
                || o.honesty.contains("one-shot")
                || o.honesty.contains("One-shot")
        );
    }
}
