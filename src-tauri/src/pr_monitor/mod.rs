//! Host-side PR monitor: what each session watches, the poll loop, and the
//! follow-up turn the host delivers into that session.
//!
//! A watch is one pull request of one repository, mounted by a session: the
//! registry is keyed by session id, and one session watches as many PRs as it
//! likes. Where a branch sits is GitHub convention, not part of what is
//! watched, so no branch enters this model.
//!
//! A due watch polls `gh pr view <n> --json …` — one call covering the PR
//! fields, the conversation and the CI rows — and advances a fingerprint. When
//! the fingerprint moves, the change is read semantically and folded into that
//! watch's single pending wake: one PR carries one wake, and a change that
//! arrives while that wake waits joins it instead of stacking up.
//!
//! The host then delivers the wake itself, through the same turn path the local
//! session API uses (`session_api::prepare_send` + `dispatch_turn`): a chat
//! with no live agent is connected first, and a chat that is mid-turn queues the
//! turn in the composer's own follow-up queue. Delivery is reported to the UI as
//! `pr-monitor://wake`; the watch rows are pushed as `pr-monitor://state`.
//!
//! **Honest limits:** watches live in the app process and are not persisted.
//! Quitting the app stops monitoring and drops wakes that were still waiting.
//!
//! Layout: [`types`] holds the payloads, [`poll`] the `gh` call and the reading
//! of a change, [`prompt`] the turn written into a chat, [`text`] the text
//! shaping they share, and this file the registry, the tick loop and delivery.

mod poll;
mod prompt;
#[cfg(test)]
mod tests;
mod text;
mod types;

/// The agent-facing half of this feature: the injected MCP tools.
pub mod mcp;

use poll::*;
use prompt::*;
use types::*;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use crate::git_pr_hub;
use crate::session_api;
use crate::session_manager::SessionManager;

/// Watch rows for one session changed (mount, unmount, poll, wake).
pub const STATE_EVENT: &str = "pr-monitor://state";
/// One wake's outcome: queued, delivered, settled, or failed.
pub const WAKE_EVENT: &str = "pr-monitor://wake";

const DEFAULT_INTERVAL_SECS: u64 = 60;
const MIN_INTERVAL_SECS: u64 = 20;
const MAX_INTERVAL_SECS: u64 = 3600;
/// Cap watches per session; each one costs a `gh` call per interval.
const MAX_WATCHES_PER_SESSION: usize = 32;
/// Scheduler tick — cheap when nothing is watched.
const TICK: Duration = Duration::from_secs(10);
/// Let the window settle before the first `gh` call.
const BOOT_DELAY: Duration = Duration::from_secs(8);
/// Newest comments kept per snapshot (older ones never affect the diff).
const SNAPSHOT_COMMENTS: usize = 10;
/// Per-comment body carried into a prompt.
const COMMENT_BODY_CAP: usize = 4_000;
/// Title / ref / author fields carried into a prompt.
const FIELD_CAP: usize = 200;
/// Failed-check rows carried into a prompt.
const CHECK_ROWS_CAP: usize = 25;
const CHECK_DESC_CAP: usize = 400;
/// Soft cap on the whole follow-up turn.
const PROMPT_CAP: usize = 12_000;
/// One retry: the transport may have been mid-reconnect.
const MAX_ATTEMPTS: u32 = 2;
const TERMINAL_STATES: [&str; 2] = ["MERGED", "CLOSED"];
const UNKNOWN_AUTHOR: &str = "unknown";
const NO_TITLE: &str = "(no title)";
const NO_CHECK_ROWS: &str = "(No individual failed-check rows were provided. Investigate recent CI failures for this PR using the project workspace and `gh pr checks` if available — do not invent check names.)";

struct Watch {
    project_path: String,
    pr_number: u64,
    interval_secs: u64,
    mounted_at: String,
    last_poll: Option<Instant>,
    last_poll_at: Option<String>,
    last_update_at: Option<String>,
    last_error: Option<String>,
    baseline: WatchBaseline,
    pending: Option<PendingWake>,
    last_change: Option<String>,
    polls: u64,
    updates: u64,
}

impl Watch {
    fn info(&self, session_id: &str) -> PrWatchInfo {
        PrWatchInfo {
            session_id: session_id.to_string(),
            project_path: self.project_path.clone(),
            pr_number: self.pr_number,
            interval_secs: self.interval_secs,
            mounted_at: self.mounted_at.clone(),
            last_poll_at: self.last_poll_at.clone(),
            last_update_at: self.last_update_at.clone(),
            last_error: self.last_error.clone(),
            polls: self.polls,
            updates: self.updates,
            terminal: self
                .baseline
                .snapshot
                .as_ref()
                .map(|s| is_terminal_state(&s.state))
                .unwrap_or(false),
            snapshot: self.baseline.snapshot.as_ref().map(PrSnapshotView::from),
            last_change: self.last_change.clone(),
            pending: self.pending.is_some(),
        }
    }

    /// Fold one poll into this watch.
    ///
    /// A repeated error does not ask for another push. A new error, a cleared
    /// error, or a real change does — including a successful poll that only
    /// clears the error and leaves the baseline where it was.
    fn apply_poll(&mut self, result: Result<PolledPr, String>, polled_at: String) -> PollFold {
        self.polls += 1;
        self.last_poll_at = Some(polled_at.clone());
        match result {
            Err(e) => {
                let changed = self.last_error.as_deref() != Some(e.as_str());
                self.last_error = Some(e);
                PollFold {
                    publish: changed,
                    queued_wake: false,
                }
            }
            Ok(polled) => {
                let cleared = self.last_error.take().is_some();
                let Some(changes) = advance_baseline(&mut self.baseline, &polled) else {
                    return PollFold {
                        publish: cleared,
                        queued_wake: false,
                    };
                };
                let incoming = PendingWake::new(polled.snapshot.clone(), changes, polled_at);
                let wake = match self.pending.take() {
                    Some(mut waiting) => {
                        waiting.fold(incoming);
                        waiting
                    }
                    None => incoming,
                };
                self.updates += 1;
                self.last_update_at = Some(wake.last_at.clone());
                self.pending = Some(wake);
                PollFold {
                    publish: true,
                    queued_wake: true,
                }
            }
        }
    }
}

struct PollFold {
    publish: bool,
    queued_wake: bool,
}

struct SessionMonitor {
    watches: HashMap<u64, Watch>,
}

static MONITORS: LazyLock<Mutex<HashMap<String, SessionMonitor>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STARTED: AtomicBool = AtomicBool::new(false);

fn lock_monitors() -> std::sync::MutexGuard<'static, HashMap<String, SessionMonitor>> {
    MONITORS.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// The language the host writes a follow-up in: the App's own setting.
fn app_lang() -> String {
    crate::tray_i18n::app_locale().as_tag().to_string()
}

/// Watch rows for one session, newest mount first.
pub fn session_state(session_id: &str) -> PrMonitorState {
    let guard = lock_monitors();
    let mut watches: Vec<PrWatchInfo> = guard
        .get(session_id)
        .map(|m| m.watches.values().map(|w| w.info(session_id)).collect())
        .unwrap_or_default();
    watches.sort_by(|a, b| {
        b.mounted_at
            .cmp(&a.mounted_at)
            .then(a.pr_number.cmp(&b.pr_number))
    });
    PrMonitorState {
        session_id: session_id.to_string(),
        watches,
    }
}

/// Mount (or re-mount) a watch. A re-mount starts a fresh baseline, so a stale
/// fingerprint cannot fire a wake the session never saw.
fn mount(
    session_id: &str,
    project_path: &str,
    pr_number: u64,
    interval_secs: Option<u64>,
) -> Result<(), String> {
    validate_watch(session_id, project_path, pr_number)?;
    let session = session_id.trim().to_string();
    let project = project_path.trim().trim_end_matches('/').to_string();
    if let Err((reason, _, _)) = git_pr_hub::prepare_project(&project) {
        return Err(reason);
    }
    let interval = clamp_interval_secs(interval_secs);
    let mut guard = lock_monitors();
    let monitor = guard
        .entry(session.clone())
        .or_insert_with(|| SessionMonitor {
            watches: HashMap::new(),
        });
    let already = monitor.watches.contains_key(&pr_number);
    if !accepts_mount(monitor.watches.len(), already) {
        return Err(format!(
            "too many PR watches (max {MAX_WATCHES_PER_SESSION})"
        ));
    }
    monitor.watches.insert(
        pr_number,
        Watch {
            project_path: project,
            pr_number,
            interval_secs: interval,
            mounted_at: now_rfc3339(),
            last_poll: None,
            last_poll_at: None,
            last_update_at: None,
            last_error: None,
            baseline: WatchBaseline::default(),
            pending: None,
            last_change: None,
            polls: 0,
            updates: 0,
        },
    );
    info!(
        target: "pr_monitor",
        session = %session,
        pr = pr_number,
        interval_secs = interval,
        "PR watch mounted"
    );
    Ok(())
}

/// Stop watching one PR. A wake still waiting for that PR goes with it.
fn unmount(session_id: &str, pr_number: u64) -> bool {
    let session = session_id.trim();
    let mut guard = lock_monitors();
    let Some(monitor) = guard.get_mut(session) else {
        return false;
    };
    let removed = monitor.watches.remove(&pr_number).is_some();
    let empty = monitor.watches.is_empty();
    if empty {
        guard.remove(session);
    }
    if removed {
        info!(target: "pr_monitor", session = %session, pr = pr_number, "PR watch unmounted");
    }
    removed
}

/// Watches whose interval elapsed; claimed (stamped) so a long poll cannot be
/// started twice while the previous one is still running.
fn claim_due(now: Instant) -> Vec<(String, u64)> {
    let mut guard = lock_monitors();
    let mut out = Vec::new();
    for (session_id, monitor) in guard.iter_mut() {
        for watch in monitor.watches.values_mut() {
            let elapsed = watch.last_poll.map(|t| now.saturating_duration_since(t));
            if is_due(elapsed, watch.interval_secs) {
                watch.last_poll = Some(now);
                out.push((session_id.clone(), watch.pr_number));
            }
        }
    }
    out.sort();
    out
}

/// Sessions holding a wake that is waiting for delivery.
fn sessions_with_pending() -> Vec<String> {
    let guard = lock_monitors();
    let mut out: Vec<String> = guard
        .iter()
        .filter(|(_, m)| m.watches.values().any(|w| w.pending.is_some()))
        .map(|(id, _)| id.clone())
        .collect();
    out.sort();
    out
}

// ── Poll loop ───────────────────────────────────────────────────────────────

async fn emit_state(app: &AppHandle, session_id: &str) {
    let state = session_state(session_id);
    if let Err(e) = app.emit(STATE_EVENT, &state) {
        warn!(target: "pr_monitor", error = %e, "failed to emit pr watch state");
    }
}

async fn emit_wake(app: &AppHandle, wake: &PrMonitorWake) {
    if let Err(e) = app.emit(WAKE_EVENT, wake) {
        warn!(target: "pr_monitor", error = %e, "failed to emit pr wake");
    }
}

/// Poll one watch once, folding a real change into its pending wake.
async fn poll_watch(app: &AppHandle, session_id: &str, pr_number: u64) {
    let mounted_at = {
        let guard = lock_monitors();
        let Some(watch) = guard
            .get(session_id)
            .and_then(|m| m.watches.get(&pr_number))
        else {
            return;
        };
        (watch.project_path.clone(), watch.mounted_at.clone())
    };
    let (project_path, mounted_at) = mounted_at;

    let args = gh_view_args(pr_number);
    let project = project_path.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        git_pr_hub::run_gh_in_project(&project, &argv)
    })
    .await;

    let polled_at = now_rfc3339();
    let result: Result<PolledPr, String> = match out {
        Err(e) => Err(format!("gh task failed: {e}")),
        Ok(Err(e)) => Err(e),
        Ok(Ok(output)) => {
            if output.status.success() {
                polled_from_gh_json(&String::from_utf8_lossy(&output.stdout))
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let msg = if err.trim().is_empty() { stdout } else { err };
                Err(if msg.trim().is_empty() {
                    "gh pr view failed".to_string()
                } else {
                    msg.trim().chars().take(240).collect()
                })
            }
        }
    };

    let applied = {
        let mut guard = lock_monitors();
        let Some(watch) = guard
            .get_mut(session_id)
            .and_then(|m| m.watches.get_mut(&pr_number))
        else {
            return;
        };
        // A re-mount of the same PR while `gh` ran must not seed the new watch
        // with the previous mount's snapshot.
        if watch.mounted_at != mounted_at {
            return;
        }
        if let Err(e) = &result {
            // Never silent: a broken `gh` auth or a missing repo would
            // otherwise look like "no changes forever".
            warn!(
                target: "pr_monitor",
                session = %session_id,
                pr = pr_number,
                error = %e,
                "PR poll failed; keeping the previous snapshot"
            );
        }
        watch.apply_poll(result, polled_at)
    };

    if applied.queued_wake {
        info!(
            target: "pr_monitor",
            session = %session_id,
            pr = pr_number,
            "PR changed; its session has a follow-up waiting"
        );
    }
    if applied.publish {
        emit_state(app, session_id).await;
    }
}

// ── Delivery ────────────────────────────────────────────────────────────────

/// Deliver one watch's pending wake, then report the outcome.
async fn deliver(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    session_id: &str,
    pr_number: u64,
    wake: PendingWake,
    lang: &str,
) {
    let summary = wake.summary(lang);
    let pr_state = wake.next.state.clone();
    let terminal = is_terminal_state(&pr_state);
    let prompt = build_wake_prompt(lang, &wake);

    let outcome = if prompt.trim().is_empty() {
        WakeOutcome::Failed("nothing to follow up on".into())
    } else {
        match session_api::prepare_send(session_id, &prompt, "pr_monitor") {
            Err(result) => WakeOutcome::Failed(
                result
                    .message
                    .clone()
                    .unwrap_or_else(|| "this chat cannot take a turn".into()),
            ),
            Ok(request) => {
                // The origin travels with the send: the transcript marks the row
                // as an automatic follow-up rather than the user speaking.
                let result = session_api::dispatch_turn_or_timeout(app, mgr, request).await;
                wake_outcome(result.status, result.message.as_deref())
            }
        }
    };

    let retry = matches!(outcome, WakeOutcome::Retry);
    let settled = terminal && !retry;
    let (status, reason) = match outcome {
        WakeOutcome::Delivered => ("delivered", None),
        WakeOutcome::Queued => ("queued", None),
        WakeOutcome::Retry => ("queued", None),
        WakeOutcome::Failed(reason) => ("failed", Some(reason)),
    };

    {
        let mut guard = lock_monitors();
        let mut empty_after = false;
        if let Some(monitor) = guard.get_mut(session_id) {
            if monitor.watches.contains_key(&pr_number) {
                if retry {
                    let attempts = wake.attempts + 1;
                    if attempts < MAX_ATTEMPTS {
                        if let Some(watch) = monitor.watches.get_mut(&pr_number) {
                            watch.pending = Some(PendingWake {
                                attempts,
                                reported_waiting: false,
                                ..wake
                            });
                        }
                    } else if let Some(watch) = monitor.watches.get_mut(&pr_number) {
                        watch.pending = None;
                    }
                } else if settled {
                    // The PR is done: this was its last follow-up.
                    monitor.watches.remove(&pr_number);
                } else if let Some(watch) = monitor.watches.get_mut(&pr_number) {
                    watch.pending = None;
                    if !summary.is_empty() {
                        watch.last_change = Some(summary.clone());
                    }
                }
            }
            empty_after = monitor.watches.is_empty();
        }
        if empty_after {
            guard.remove(session_id);
        }
    }

    if settled {
        info!(
            target: "pr_monitor",
            session = %session_id,
            pr = pr_number,
            state = %pr_state,
            "PR is done; the watch stops after this follow-up"
        );
    }
    emit_wake(
        app,
        &PrMonitorWake {
            session_id: session_id.to_string(),
            pr_number,
            status: if settled { "settled" } else { status }.to_string(),
            summary,
            pr_state,
            reason,
            pending: retry,
            at: now_rfc3339(),
        },
    )
    .await;
    emit_state(app, session_id).await;
}

/// Give one session's waiting wakes a chance to land: at most one turn per
/// pass, and nothing at all while a turn is already running.
async fn flush_session(app: &AppHandle, session_id: &str) {
    let Some(mgr) = app
        .try_state::<Arc<SessionManager>>()
        .map(|m| m.inner().clone())
    else {
        return;
    };
    let lang = app_lang();
    if mgr.session_turn_busy(session_id) {
        // Say once — not on every tick — that the follow-up is waiting.
        let notices: Vec<PrMonitorWake> = {
            let mut guard = lock_monitors();
            let Some(monitor) = guard.get_mut(session_id) else {
                return;
            };
            let waiting: Vec<u64> = monitor
                .watches
                .values()
                .filter(|w| w.pending.is_some())
                .map(|w| w.pr_number)
                .collect();
            let mut out = Vec::new();
            for pr_number in waiting {
                let Some(wake) = monitor
                    .watches
                    .get_mut(&pr_number)
                    .and_then(|w| w.pending.as_mut())
                else {
                    continue;
                };
                if wake.reported_waiting {
                    continue;
                }
                wake.reported_waiting = true;
                out.push(PrMonitorWake {
                    session_id: session_id.to_string(),
                    pr_number,
                    status: "queued".into(),
                    summary: wake.summary(&lang),
                    pr_state: wake.next.state.clone(),
                    reason: None,
                    pending: true,
                    at: now_rfc3339(),
                });
            }
            out
        };
        for notice in notices {
            emit_wake(app, &notice).await;
        }
        return;
    }

    // Oldest waiting change first, so wakes land in the order they arrived.
    let target: Option<(u64, PendingWake)> = {
        let mut guard = lock_monitors();
        let Some(monitor) = guard.get_mut(session_id) else {
            return;
        };
        let mut waiting: Vec<(u64, String)> = monitor
            .watches
            .values()
            .filter_map(|w| {
                w.pending
                    .as_ref()
                    .map(|p| (w.pr_number, p.first_at.clone()))
            })
            .collect();
        waiting.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
        let Some((pr_number, _)) = waiting.into_iter().next() else {
            return;
        };
        monitor
            .watches
            .get_mut(&pr_number)
            .and_then(|w| w.pending.take())
            .map(|wake| (pr_number, wake))
    };

    let Some((pr_number, wake)) = target else {
        return;
    };
    deliver(app, &mgr, session_id, pr_number, wake, &lang).await;
}

/// Start the background tick loop (call once from app setup).
pub fn start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        warn!(target: "pr_monitor", "start called more than once; ignoring");
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BOOT_DELAY).await;
        info!(
            target: "pr_monitor",
            "host PR monitor started (window not required; tray-only ok)"
        );
        loop {
            for (session_id, pr_number) in claim_due(Instant::now()) {
                poll_watch(&app, &session_id, pr_number).await;
                flush_session(&app, &session_id).await;
            }
            // A session that was mid-turn when its wake arrived gets another
            // chance on every tick.
            for session_id in sessions_with_pending() {
                flush_session(&app, &session_id).await;
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Mount a watch for one PR of this session's project. The seed poll runs here,
/// so mounting cannot look like a change and no client nudge is needed.
#[tauri::command]
pub async fn pr_monitor_watch(
    app: AppHandle,
    session_id: String,
    project_path: String,
    pr_number: u64,
    interval_secs: Option<u64>,
) -> PrMonitorWatchResult {
    if let Err(error) = mount(&session_id, &project_path, pr_number, interval_secs) {
        return PrMonitorWatchResult {
            ok: false,
            error: Some(error),
        };
    }
    let session = session_id.trim().to_string();
    poll_watch(&app, &session, pr_number).await;
    emit_state(&app, &session).await;
    PrMonitorWatchResult {
        ok: true,
        error: None,
    }
}

/// Stop watching one PR.
#[tauri::command]
pub async fn pr_monitor_unwatch(
    app: AppHandle,
    session_id: String,
    pr_number: u64,
) -> PrMonitorUnwatchResult {
    let removed = unmount(&session_id, pr_number);
    emit_state(&app, session_id.trim()).await;
    PrMonitorUnwatchResult { ok: true, removed }
}

/// The watches one session holds: what the UI renders after it (re)subscribes.
#[tauri::command]
pub async fn pr_monitor_state(session_id: String) -> PrMonitorState {
    session_state(&session_id)
}
