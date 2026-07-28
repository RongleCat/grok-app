//! Host-side automation scheduler.
//!
//! Runs while the process is alive — including when the main window is hidden
//! to the tray — so due tasks do not depend on WebView timers.
//!
//! Execution reuses `SessionManager` (create → connect → send). UI is notified
//! via `automation://ran` / `automation://skipped` / `automation://error`.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use chrono::{Datelike, Duration as ChronoDuration, Local, Timelike, Utc, Weekday};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use crate::session_fsm::SessionState;
use crate::session_manager::SessionManager;
use crate::store::{self, Automation};

const TICK: Duration = Duration::from_secs(30);
const BOOT_DELAY: Duration = Duration::from_secs(12);

/// Process-wide claimed fire keys (`id:nextRunAt`) for this process lifetime.
static FIRED: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Start the background tick loop (call once from app setup).
pub fn start(app: AppHandle, mgr: Arc<SessionManager>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BOOT_DELAY).await;
        info!(target: "automation_runner", "host automation scheduler started");
        loop {
            if let Err(e) = tick_once(&app, &mgr).await {
                warn!(target: "automation_runner", "tick error: {e}");
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

async fn tick_once(app: &AppHandle, mgr: &Arc<SessionManager>) -> Result<(), String> {
    // Do not steal the agent while a turn is actively streaming.
    if mgr.any_turn_busy() {
        return Ok(());
    }

    let list = store::load_automations();
    let now = Utc::now();
    let due = list.into_iter().find(|a| a.enabled && is_due(a, now));
    let Some(auto) = due else {
        return Ok(());
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
            return Ok(());
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
                }),
            );
            Ok(())
        }
        Err(e) => {
            // Allow retry next tick.
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
                }),
            );
            Err(e)
        }
    }
}

async fn run_one(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    auto: &Automation,
) -> Result<String, String> {
    let projects = store::load_projects();
    let proj = auto
        .project_id
        .as_ref()
        .and_then(|pid| projects.iter().find(|p| &p.id == pid));

    if let Some(p) = proj {
        if !p.trusted {
            return Err(format!("project not trusted: {}", p.name));
        }
        if !p.path_ok {
            return Err(format!("project path missing: {}", p.name));
        }
    }

    let title = if auto.title.trim().is_empty() {
        "Scheduled".into()
    } else {
        auto.title.clone()
    };

    let meta = store::create_session(auto.project_id.clone(), Some(title.clone()), true)
        .map_err(|e| format!("create session: {e}"))?;
    let session_id = meta.id.clone();

    // Optional session prefs (model / effort) before connect.
    if auto.model_id.is_some() || auto.effort.is_some() {
        let mut m = meta.clone();
        if let Some(ref mid) = auto.model_id {
            m.model_id = Some(mid.clone());
        }
        if let Some(ref ef) = auto.effort {
            m.effort = Some(ef.clone());
        }
        let _ = store::update_session_meta(&m);
    }

    let project_path = proj.map(|p| p.path.clone());
    let snap = mgr
        .connect(
            app.clone(),
            project_path,
            Some(session_id.clone()),
            None,
        )
        .await
        .map_err(|e| {
            // Drop empty shell so sidebar stays clean.
            let _ = store::delete_session(&session_id);
            format!("connect failed: {e}")
        })?;

    if snap.state != SessionState::Ready {
        let detail = snap
            .last_error
            .as_ref()
            .map(|e| format!("{}: {}", e.code.as_str(), e.message))
            .unwrap_or_else(|| format!("state={:?}", snap.state));
        let _ = store::delete_session(&session_id);
        return Err(format!("connect not ready: {detail}"));
    }

    let prompt = format!("[Scheduled: {}]\n\n{}", auto.title, auto.prompt);
    mgr.send_message(app.clone(), prompt, None, Some(session_id.clone()))
        .await
        .map_err(|e| format!("send failed: {e}"))?;

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
                    Weekday::Mon
                        | Weekday::Tue
                        | Weekday::Wed
                        | Weekday::Thu
                        | Weekday::Fri
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
}
