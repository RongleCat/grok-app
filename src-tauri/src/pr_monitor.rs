//! Host-side PR monitor: watch a pull request, emit only real changes.
//!
//! A watcher is mounted from the composer branch chip and lives in memory for
//! this process lifetime. While the process is alive — including when the main
//! window is hidden to the tray — the tick loop polls the watched PR with
//! `gh pr view --json …` (one call covers PR fields, comments and reviews).
//!
//! **Honest limits:** there is no separate headless daemon and mounts are not
//! persisted. Fully quitting the app stops monitoring; relaunching does not
//! silently resume a mount the UI is not showing.
//!
//! **Layering:** this module detects *that* something changed (fingerprint
//! dedup) and hands the UI both snapshots. The semantic diff (new comment /
//! review / check transition) and the follow-up prompt live in the frontend
//! (`src/lib/prMonitor.ts`) so the wake text can be localized and reuse the
//! existing PR prompt builders.
//!
//! Events: `pr-monitor://update` with the before/after snapshots.
//! The latest unconsumed change per watcher is kept in `pending` so a UI that
//! remounted (or missed the event) can drain it via `pr_monitor_consume_pending`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

use crate::git_pr_hub::{self, PrChecksSummary};

/// Event name for a real PR change (carries prior + current snapshot).
pub const UPDATE_EVENT: &str = "pr-monitor://update";

const DEFAULT_INTERVAL_SECS: u64 = 60;
const MIN_INTERVAL_SECS: u64 = 20;
const MAX_INTERVAL_SECS: u64 = 3600;
/// Cap mounted watchers; each one costs a `gh` call per interval.
const MAX_WATCHERS: usize = 32;
/// Scheduler tick — cheap when nothing is mounted.
const TICK: Duration = Duration::from_secs(10);
/// Let the window settle before the first `gh` call.
const BOOT_DELAY: Duration = Duration::from_secs(8);
/// Newest comments kept per snapshot (older ones never affect the diff).
const SNAPSHOT_COMMENTS: usize = 10;
const TERMINAL_STATES: [&str; 2] = ["MERGED", "CLOSED"];

// ── Types ───────────────────────────────────────────────────────────────────

/// One conversation entry (issue comment or review) in a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrCommentBrief {
    pub id: String,
    pub author: String,
    /// comment | review
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub excerpt: String,
}

/// Everything the UI needs to diff two polls, and nothing else.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrSnapshot {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// OPEN | MERGED | CLOSED ("" when gh did not report one).
    pub state: String,
    pub is_draft: bool,
    /// MERGEABLE | CONFLICTING | UNKNOWN ("" when unknown).
    pub mergeable: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub updated_at: String,
    pub checks: PrChecksSummary,
    /// Newest first, capped at [`SNAPSHOT_COMMENTS`].
    pub comments: Vec<PrCommentBrief>,
}

/// A real change between two polls of one watched PR.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorUpdate {
    pub watcher_id: String,
    pub project_path: String,
    pub branch: String,
    pub pr_number: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub url: String,
    pub title: String,
    pub prev: PrSnapshot,
    pub next: PrSnapshot,
    pub at: String,
}

/// Serializable view of a mounted watcher (host is the source of truth for mounts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorWatcherInfo {
    pub watcher_id: String,
    pub project_path: String,
    pub branch: String,
    pub pr_number: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub interval_secs: u64,
    pub mounted_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_poll_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_update_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub polls: u64,
    pub updates: u64,
    /// TERMINAL once the PR merged or closed — the UI can stop watching.
    pub terminal: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<PrSnapshot>,
    /// Latest change not yet consumed by the UI (survives a UI remount).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<PrMonitorUpdate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorWatchResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watcher: Option<PrMonitorWatcherInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorUnwatchResult {
    pub ok: bool,
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorPollResult {
    pub ok: bool,
    /// True when this poll observed a change (and emitted `pr-monitor://update`).
    pub changed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watcher: Option<PrMonitorWatcherInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/// JSON fields for the single `gh pr view` call a poll makes.
pub fn pr_view_json_fields() -> String {
    format!("{},comments,reviews", git_pr_hub::VIEW_JSON_FIELDS)
}

/// `gh` argv for one poll of `pr_number` (never interpolates user text).
pub fn gh_view_args(pr_number: u64) -> Vec<String> {
    vec![
        "pr".into(),
        "view".into(),
        pr_number.to_string(),
        "--json".into(),
        pr_view_json_fields(),
    ]
}

/// Stable watcher key. Unit separator cannot appear in a git branch name.
pub fn watcher_id(project_path: &str, branch: &str) -> String {
    format!(
        "{}\u{1f}{}",
        project_path.trim().trim_end_matches('/'),
        branch.trim()
    )
}

/// Clamp a caller-supplied interval into the supported range.
pub fn clamp_interval_secs(raw: Option<u64>) -> u64 {
    match raw {
        None => DEFAULT_INTERVAL_SECS,
        Some(v) => v.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS),
    }
}

/// True when a watcher is due for another poll.
pub fn is_due(elapsed_since_poll: Option<Duration>, interval_secs: u64) -> bool {
    match elapsed_since_poll {
        None => true,
        Some(e) => e.as_secs() >= interval_secs,
    }
}

/// Length-prefixed field so a `|` inside a title cannot fake a fingerprint match.
fn fp_field(raw: &str) -> String {
    format!("{}:{}", raw.len(), raw)
}

/// Normalize a snapshot to a stable string. Revisions that the UI cares about
/// (title, state, mergeable, checks counts, comment set, updatedAt) all move it.
pub fn snapshot_fingerprint(s: &PrSnapshot) -> String {
    let mut ids: Vec<&str> = s.comments.iter().map(|c| c.id.as_str()).collect();
    ids.sort_unstable();
    let mut parts = vec![
        s.number.to_string(),
        fp_field(&s.title),
        fp_field(&s.state),
        s.is_draft.to_string(),
        fp_field(&s.mergeable),
        fp_field(&s.updated_at),
        fp_field(&s.head_ref_name),
        fp_field(&s.base_ref_name),
        format!(
            "{}/{}/{}/{}/{}",
            s.checks.pass, s.checks.fail, s.checks.pending, s.checks.total, s.checks.overall
        ),
    ];
    parts.push(fp_field(&ids.join(",")));
    parts.join("|")
}

/// True once gh reports the PR merged or closed (watcher can be unmounted).
pub fn is_terminal_state(state: &str) -> bool {
    let s = state.trim().to_ascii_uppercase();
    TERMINAL_STATES.contains(&s.as_str())
}

/// Build a snapshot from one `gh pr view --json` payload (PR fields + comments).
pub fn snapshot_from_gh_json(raw: &str) -> Result<PrSnapshot, String> {
    let entry = git_pr_hub::parse_gh_pr_view_json(raw)?
        .ok_or_else(|| "gh pr view returned no pull request".to_string())?;
    let (comments, url, _number) = git_pr_hub::parse_gh_pr_comments_json(raw)?;
    let briefs = comments
        .into_iter()
        .take(SNAPSHOT_COMMENTS)
        .map(|c| PrCommentBrief {
            id: c.id,
            // Prefer the login so diffs stay stable across display-name edits.
            author: c
                .author_login
                .clone()
                .unwrap_or(c.author)
                .trim()
                .to_string(),
            kind: c.kind,
            state: c.state,
            created_at: c.created_at,
            excerpt: c.excerpt,
        })
        .collect();
    let entry_url = entry.url.trim().to_string();
    Ok(PrSnapshot {
        number: entry.number,
        title: entry.title.trim().to_string(),
        url: if entry_url.is_empty() {
            url.unwrap_or_default()
        } else {
            entry_url
        },
        state: entry.state.unwrap_or_default().trim().to_string(),
        is_draft: entry.is_draft,
        mergeable: entry.mergeable.unwrap_or_default().trim().to_string(),
        head_ref_name: entry.head_ref_name.unwrap_or_default().trim().to_string(),
        base_ref_name: entry.base_ref_name.unwrap_or_default().trim().to_string(),
        updated_at: entry.updated_at.unwrap_or_default().trim().to_string(),
        checks: entry.checks.unwrap_or_default(),
        comments: briefs,
    })
}

/// Validate a mount request without touching the network.
pub fn validate_watch(project_path: &str, branch: &str, pr_number: u64) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("empty project path".into());
    }
    if branch.trim().is_empty() {
        return Err("empty branch".into());
    }
    if pr_number == 0 {
        return Err("invalid PR number".into());
    }
    Ok(())
}

/// Last observed state of one watcher (the non-IO half of a watcher).
#[derive(Debug, Clone, Default)]
pub struct WatcherBaseline {
    fingerprint: Option<String>,
    snapshot: Option<PrSnapshot>,
}

/// Fold a fresh poll into the baseline.
///
/// Returns `Some((prev, next))` exactly once per real change — the baseline
/// advances in every case, so a repeated fingerprint never fires twice and the
/// first poll only seeds the baseline (mounting cannot wake the session).
pub fn advance_baseline(
    baseline: &mut WatcherBaseline,
    next: &PrSnapshot,
) -> Option<(PrSnapshot, PrSnapshot)> {
    let fingerprint = snapshot_fingerprint(next);
    let changed = match (baseline.fingerprint.take(), baseline.snapshot.take()) {
        (Some(prev_fp), Some(prev_snapshot)) if prev_fp != fingerprint => {
            Some((prev_snapshot, next.clone()))
        }
        _ => None,
    };
    baseline.fingerprint = Some(fingerprint);
    baseline.snapshot = Some(next.clone());
    changed
}

// ── Registry ────────────────────────────────────────────────────────────────

struct Watcher {
    project_path: String,
    branch: String,
    pr_number: u64,
    session_id: Option<String>,
    interval_secs: u64,
    mounted_at: String,
    last_poll: Option<Instant>,
    last_poll_at: Option<String>,
    last_update_at: Option<String>,
    last_error: Option<String>,
    baseline: WatcherBaseline,
    pending: Option<PrMonitorUpdate>,
    polls: u64,
    updates: u64,
}

impl Watcher {
    fn info(&self) -> PrMonitorWatcherInfo {
        let terminal = self
            .baseline
            .snapshot
            .as_ref()
            .map(|s| is_terminal_state(&s.state))
            .unwrap_or(false);
        PrMonitorWatcherInfo {
            watcher_id: watcher_id(&self.project_path, &self.branch),
            project_path: self.project_path.clone(),
            branch: self.branch.clone(),
            pr_number: self.pr_number,
            session_id: self.session_id.clone(),
            interval_secs: self.interval_secs,
            mounted_at: self.mounted_at.clone(),
            last_poll_at: self.last_poll_at.clone(),
            last_update_at: self.last_update_at.clone(),
            last_error: self.last_error.clone(),
            polls: self.polls,
            updates: self.updates,
            terminal,
            snapshot: self.baseline.snapshot.clone(),
            pending: self.pending.clone(),
        }
    }
}

static WATCHERS: LazyLock<Mutex<HashMap<String, Watcher>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STARTED: AtomicBool = AtomicBool::new(false);

fn lock_watchers() -> std::sync::MutexGuard<'static, HashMap<String, Watcher>> {
    WATCHERS.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ── Poll ────────────────────────────────────────────────────────────────────

/// Poll one watcher once, emitting an update when the snapshot really moved.
///
/// Returns `Ok(changed)`. The first successful poll only seeds the baseline so
/// mounting never fires a spurious "everything changed" wake.
async fn poll_watcher(app: &AppHandle, id: &str) -> Result<bool, String> {
    let (project_path, pr_number) = {
        let guard = lock_watchers();
        let Some(w) = guard.get(id) else {
            return Ok(false);
        };
        (w.project_path.clone(), w.pr_number)
    };

    let args = gh_view_args(pr_number);
    let project = project_path.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        git_pr_hub::run_gh_in_project(&project, &argv)
    })
    .await
    .map_err(|e| format!("gh task failed: {e}"))?;

    let polled_at = now_rfc3339();
    let result: Result<PrSnapshot, String> = match out {
        Err(e) => Err(e),
        Ok(output) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let msg = if err.trim().is_empty() {
                    stdout.to_string()
                } else {
                    err.to_string()
                };
                Err(if msg.trim().is_empty() {
                    "gh pr view failed".to_string()
                } else {
                    msg.trim().chars().take(240).collect()
                })
            } else {
                snapshot_from_gh_json(&String::from_utf8_lossy(&output.stdout))
            }
        }
    };

    let mut guard = lock_watchers();
    let Some(w) = guard.get_mut(id) else {
        return Ok(false);
    };
    w.polls += 1;
    w.last_poll = Some(Instant::now());
    w.last_poll_at = Some(polled_at.clone());

    let snapshot = match result {
        Ok(s) => s,
        Err(e) => {
            // Never silent: a broken `gh` auth or a missing repo would otherwise
            // look like "no changes forever".
            warn!(
                target: "pr_monitor",
                watcher = %id,
                error = %e,
                "PR poll failed; keeping the previous snapshot"
            );
            w.last_error = Some(e);
            return Ok(false);
        }
    };
    // A re-mount for a different PR can land while `gh` was running; the old
    // PR's snapshot must not become the new watcher's baseline.
    if w.pr_number != pr_number {
        return Ok(false);
    }
    w.last_error = None;

    let Some((prev, next)) = advance_baseline(&mut w.baseline, &snapshot) else {
        return Ok(false);
    };
    let update = PrMonitorUpdate {
        watcher_id: id.to_string(),
        project_path: w.project_path.clone(),
        branch: w.branch.clone(),
        pr_number: w.pr_number,
        session_id: w.session_id.clone(),
        url: next.url.clone(),
        title: next.title.clone(),
        prev,
        next,
        at: polled_at,
    };
    w.updates += 1;
    w.last_update_at = Some(update.at.clone());
    // Kept until the UI consumes it, so a remount cannot lose the change.
    w.pending = Some(update.clone());
    drop(guard);

    if let Err(e) = app.emit(UPDATE_EVENT, &update) {
        warn!(
            target: "pr_monitor",
            watcher = %id,
            error = %e,
            "failed to emit pr update"
        );
    }
    Ok(true)
}

/// Watcher ids whose interval elapsed; claimed (stamped) so a long poll cannot
/// be started twice while the previous one is still running.
fn claim_due_watchers(now: Instant) -> Vec<String> {
    let mut guard = lock_watchers();
    let mut out = Vec::new();
    for (id, w) in guard.iter_mut() {
        let elapsed = w.last_poll.map(|t| now.saturating_duration_since(t));
        if is_due(elapsed, w.interval_secs) {
            w.last_poll = Some(now);
            out.push(id.clone());
        }
    }
    out.sort();
    out
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
            for id in claim_due_watchers(Instant::now()) {
                if let Err(e) = poll_watcher(&app, &id).await {
                    warn!(target: "pr_monitor", watcher = %id, error = %e, "poll failed");
                }
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Mount (or re-mount) a watcher for `project_path` + `branch` / `pr_number`.
#[tauri::command]
pub async fn pr_monitor_watch(
    project_path: String,
    branch: String,
    pr_number: u64,
    session_id: Option<String>,
    interval_secs: Option<u64>,
) -> PrMonitorWatchResult {
    if let Err(error) = validate_watch(&project_path, &branch, pr_number) {
        return PrMonitorWatchResult {
            ok: false,
            watcher: None,
            error: Some(error),
        };
    }
    let project = project_path.trim().trim_end_matches('/').to_string();
    if let Err((reason, _, _)) = git_pr_hub::prepare_project(&project) {
        return PrMonitorWatchResult {
            ok: false,
            watcher: None,
            error: Some(reason),
        };
    }
    let branch = branch.trim().to_string();
    let interval = clamp_interval_secs(interval_secs);
    let id = watcher_id(&project, &branch);
    let session = session_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut guard = lock_watchers();
    if !guard.contains_key(&id) && guard.len() >= MAX_WATCHERS {
        return PrMonitorWatchResult {
            ok: false,
            watcher: None,
            error: Some(format!("too many PR watches (max {MAX_WATCHERS})")),
        };
    }
    // Re-mount resets the baseline so a stale fingerprint cannot fire a wake.
    let watcher = Watcher {
        project_path: project,
        branch,
        pr_number,
        session_id: session,
        interval_secs: interval,
        mounted_at: now_rfc3339(),
        last_poll: None,
        last_poll_at: None,
        last_update_at: None,
        last_error: None,
        baseline: WatcherBaseline::default(),
        pending: None,
        polls: 0,
        updates: 0,
    };
    let info = watcher.info();
    guard.insert(id, watcher);
    info!(
        target: "pr_monitor",
        pr = pr_number,
        branch = %info.branch,
        interval_secs = interval,
        "PR watch mounted"
    );
    PrMonitorWatchResult {
        ok: true,
        watcher: Some(info),
        error: None,
    }
}

/// Stop watching the PR mounted for `project_path` + `branch`.
#[tauri::command]
pub async fn pr_monitor_unwatch(project_path: String, branch: String) -> PrMonitorUnwatchResult {
    let id = watcher_id(&project_path, &branch);
    let removed = lock_watchers().remove(&id).is_some();
    if removed {
        info!(target: "pr_monitor", watcher = %id, "PR watch unmounted");
    }
    PrMonitorUnwatchResult { ok: true, removed }
}

/// Mounted watchers (host is the source of truth for mounts across UI remounts).
#[tauri::command]
pub async fn pr_monitor_list() -> Vec<PrMonitorWatcherInfo> {
    let mut rows: Vec<PrMonitorWatcherInfo> = lock_watchers().values().map(Watcher::info).collect();
    rows.sort_by(|a, b| a.watcher_id.cmp(&b.watcher_id));
    rows
}

/// Poll one watcher immediately (mount seeding / user "check now").
#[tauri::command]
pub async fn pr_monitor_poll_now(
    app: AppHandle,
    project_path: String,
    branch: String,
) -> PrMonitorPollResult {
    let id = watcher_id(&project_path, &branch);
    if !lock_watchers().contains_key(&id) {
        return PrMonitorPollResult {
            ok: false,
            changed: false,
            watcher: None,
            error: Some("no such PR watch".into()),
        };
    }
    let changed = match poll_watcher(&app, &id).await {
        Ok(c) => c,
        Err(e) => {
            return PrMonitorPollResult {
                ok: false,
                changed: false,
                watcher: None,
                error: Some(e),
            }
        }
    };
    let guard = lock_watchers();
    let watcher = guard.get(&id).map(Watcher::info);
    let ok = watcher
        .as_ref()
        .map(|w| w.last_error.is_none())
        .unwrap_or(false);
    PrMonitorPollResult {
        ok,
        changed,
        watcher,
        error: None,
    }
}

/// Drain the latest unconsumed change for a watcher (missed-event recovery).
#[tauri::command]
pub async fn pr_monitor_consume_pending(
    project_path: String,
    branch: String,
) -> Option<PrMonitorUpdate> {
    let id = watcher_id(&project_path, &branch);
    let mut guard = lock_watchers();
    guard.get_mut(&id).and_then(|w| w.pending.take())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Shape of `gh pr view <n> --json …` output (trimmed but faithful).
    fn sample_view(title: &str, state: &str, fail: u32, comment_id: &str) -> String {
        format!(
            r#"{{
  "number": 1316,
  "title": "{title}",
  "state": "{state}",
  "isDraft": false,
  "mergeable": "MERGEABLE",
  "headRefName": "feat/subagent-live-monitor",
  "baseRefName": "main",
  "updatedAt": "2026-10-10T09:00:00Z",
  "url": "https://github.com/RongleCat/grok-app/pull/1316",
  "statusCheckRollup": [
    {{"name": "frontend", "status": "COMPLETED", "conclusion": "SUCCESS", "workflowName": "ci"}},
    {{"name": "rust", "status": "COMPLETED", "conclusion": "{}"}}
  ],
  "comments": [
    {{"id": "{comment_id}", "author": {{"login": "RongleCat"}}, "body": "Please rebase.", "createdAt": "2026-10-10T08:00:00Z", "url": "https://github.com/RongleCat/grok-app/pull/1316#issuecomment-1"}}
  ],
  "reviews": []
}}"#,
            if fail > 0 { "FAILURE" } else { "SUCCESS" }
        )
    }

    #[test]
    fn gh_argv_targets_one_pr_and_covers_comments() {
        let args = gh_view_args(1316);
        assert_eq!(args[0], "pr");
        assert_eq!(args[1], "view");
        assert_eq!(args[2], "1316");
        assert_eq!(args[3], "--json");
        let fields = &args[4];
        for needle in [
            "number",
            "title",
            "mergeable",
            "state",
            "headRefName",
            "statusCheckRollup",
            "comments",
            "reviews",
        ] {
            assert!(fields.contains(needle), "missing {needle} in {fields}");
        }
    }

    #[test]
    fn parse_snapshot_keeps_rollup_without_bucket() {
        // gh often omits `bucket`; the parser must classify from status/conclusion.
        let snap = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 1, "c1")).unwrap();
        assert_eq!(snap.number, 1316);
        assert_eq!(snap.title, "Live monitor");
        assert_eq!(snap.state, "OPEN");
        assert_eq!(snap.head_ref_name, "feat/subagent-live-monitor");
        assert_eq!(snap.checks.total, 2);
        assert_eq!(snap.checks.fail, 1);
        assert_eq!(snap.checks.pass, 1);
        assert_eq!(snap.comments.len(), 1);
        assert_eq!(snap.comments[0].id, "c1");
        assert_eq!(snap.comments[0].author, "RongleCat");
        assert_eq!(snap.comments[0].kind, "comment");
        assert!(snap.url.ends_with("/pull/1316"));
    }

    #[test]
    fn parse_snapshot_rejects_unrelated_json() {
        assert!(snapshot_from_gh_json("[]").is_err());
        assert!(snapshot_from_gh_json("not json").is_err());
    }

    #[test]
    fn fingerprint_is_stable_and_moves_on_real_changes() {
        let base = sample_view("Live monitor", "OPEN", 0, "c1");
        let a = snapshot_from_gh_json(&base).unwrap();
        let b = snapshot_from_gh_json(&base).unwrap();
        assert_eq!(snapshot_fingerprint(&a), snapshot_fingerprint(&b));

        // New comment → different fingerprint.
        let c = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 0, "c2")).unwrap();
        assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&c));

        // CI pending → fail (same comment set) → different fingerprint.
        let d = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 1, "c1")).unwrap();
        assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&d));

        // Title change alone → different fingerprint.
        let e = snapshot_from_gh_json(&sample_view("Renamed", "OPEN", 0, "c1")).unwrap();
        assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&e));

        // Merged state → different fingerprint.
        let f = snapshot_from_gh_json(&sample_view("Live monitor", "MERGED", 0, "c1")).unwrap();
        assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&f));
    }

    #[test]
    fn fingerprint_cannot_be_faked_by_a_delimiter_in_the_title() {
        let a = snapshot_from_gh_json(&sample_view("a|1:x", "OPEN", 0, "c1")).unwrap();
        let b = snapshot_from_gh_json(&sample_view("a", "1:x", 0, "c1")).unwrap();
        assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&b));
    }

    #[test]
    fn terminal_states_are_recognized() {
        assert!(is_terminal_state("MERGED"));
        assert!(is_terminal_state("closed"));
        assert!(!is_terminal_state("OPEN"));
        assert!(!is_terminal_state(""));
    }

    #[test]
    fn interval_is_clamped_into_range() {
        assert_eq!(clamp_interval_secs(None), DEFAULT_INTERVAL_SECS);
        assert_eq!(clamp_interval_secs(Some(1)), MIN_INTERVAL_SECS);
        assert_eq!(clamp_interval_secs(Some(90)), 90);
        assert_eq!(clamp_interval_secs(Some(100_000)), MAX_INTERVAL_SECS);
    }

    #[test]
    fn due_waits_a_full_interval_and_polls_first_time() {
        assert!(is_due(None, 60));
        assert!(!is_due(Some(Duration::from_secs(59)), 60));
        assert!(is_due(Some(Duration::from_secs(60)), 60));
    }

    #[test]
    fn watcher_ids_distinguish_branches_and_normalize_trailing_slash() {
        let a = watcher_id("/tmp/repo/", "feat/x");
        let b = watcher_id("/tmp/repo", "feat/x");
        let c = watcher_id("/tmp/repo", "feat/y");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn validate_rejects_incomplete_mounts() {
        assert!(validate_watch("/tmp", "feat/x", 1).is_ok());
        assert!(validate_watch("", "feat/x", 1).is_err());
        assert!(validate_watch("/tmp", "  ", 1).is_err());
        assert!(validate_watch("/tmp", "feat/x", 0).is_err());
    }

    #[test]
    fn first_poll_seeds_the_baseline_without_an_update() {
        let mut baseline = WatcherBaseline::default();
        let snap = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 0, "c1")).unwrap();
        assert!(advance_baseline(&mut baseline, &snap).is_none());
        assert!(baseline.snapshot.is_some());
        // Same snapshot again (unchanged poll) → still no update.
        assert!(advance_baseline(&mut baseline, &snap).is_none());
    }

    /// The dedup contract: one update per real change, never a repeat.
    #[test]
    fn a_real_change_fires_exactly_once() {
        let mut baseline = WatcherBaseline::default();
        let before = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 0, "c1")).unwrap();
        assert!(advance_baseline(&mut baseline, &before).is_none());

        let after = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 0, "c2")).unwrap();
        let change = advance_baseline(&mut baseline, &after).expect("one update");
        assert_eq!(change.0.comments[0].id, "c1");
        assert_eq!(change.1.comments[0].id, "c2");

        // Polling again with the same payload must not fire a second update.
        assert!(advance_baseline(&mut baseline, &after).is_none());
        assert!(advance_baseline(&mut baseline, &after).is_none());

        // A later change still gets through.
        let later = snapshot_from_gh_json(&sample_view("Live monitor", "OPEN", 1, "c2")).unwrap();
        assert!(advance_baseline(&mut baseline, &later).is_some());
        assert!(advance_baseline(&mut baseline, &later).is_none());
    }

    /// Live registry round trip over the shipped commands on a real repo with
    /// an authenticated `gh`: mount → list → drain → unmount.
    ///
    /// `PR_MONITOR_LIVE_PR=1316 cargo test live_watch_round_trip -- --ignored --nocapture`
    #[test]
    #[ignore = "live gh: needs a real repo and authenticated gh"]
    fn live_watch_round_trip() {
        let Ok(number) =
            std::env::var("PR_MONITOR_LIVE_PR").map(|v| v.trim().parse::<u64>().unwrap_or(0))
        else {
            eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
            return;
        };
        if number == 0 {
            eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
            return;
        }
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .to_string_lossy()
            .to_string();
        let branch = "pr-monitor-live-test".to_string();

        tauri::async_runtime::block_on(async {
            let mounted = pr_monitor_watch(
                project.clone(),
                branch.clone(),
                number,
                Some("live-session".into()),
                Some(5),
            )
            .await;
            assert!(mounted.ok, "mount failed: {:?}", mounted.error);
            let info = mounted.watcher.expect("watcher info");
            assert_eq!(info.pr_number, number);
            // Interval is clamped even when the caller asks for something silly.
            assert_eq!(info.interval_secs, MIN_INTERVAL_SECS);

            let rows = pr_monitor_list().await;
            let mine = rows
                .iter()
                .find(|w| w.branch == branch)
                .expect("mounted watcher is listed");
            assert_eq!(mine.session_id.as_deref(), Some("live-session"));
            assert_eq!(mine.polls, 0);

            // Nothing has been delivered yet, so there is nothing to drain.
            assert!(pr_monitor_consume_pending(project.clone(), branch.clone())
                .await
                .is_none());

            let removed = pr_monitor_unwatch(project.clone(), branch.clone()).await;
            assert!(removed.removed);
            assert!(pr_monitor_list().await.iter().all(|w| w.branch != branch));
            println!("LIVE watch round trip ok (PR #{number})");
        });
    }

    /// Live `gh` round trip through the shipped poll path: argv, runner, parse
    /// and fingerprint. It needs network plus an authenticated `gh`, so it stays
    /// ignored unless asked for and CI remains hermetic:
    ///
    /// `PR_MONITOR_LIVE_PR=1316 cargo test live_gh_round_trip -- --ignored --nocapture`
    #[test]
    #[ignore = "live gh: needs network + authenticated gh"]
    fn live_gh_round_trip() {
        let Ok(number) =
            std::env::var("PR_MONITOR_LIVE_PR").map(|v| v.trim().parse::<u64>().unwrap_or(0))
        else {
            eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
            return;
        };
        if number == 0 {
            eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
            return;
        }
        // Run in the repo this test lives in (a real checkout with remotes).
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .to_string_lossy()
            .to_string();

        let args = gh_view_args(number);
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = git_pr_hub::run_gh_in_project(&project, &argv).expect("spawn gh");
        assert!(
            out.status.success(),
            "gh pr view failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );

        let raw = String::from_utf8_lossy(&out.stdout);
        let snap = snapshot_from_gh_json(&raw).expect("parse snapshot");
        println!(
            "LIVE ok number=#{} state={} mergeable={} checks={} pass/fail/pending={}/{}/{} comments={} fp={}",
            snap.number,
            snap.state,
            snap.mergeable,
            snap.checks.total,
            snap.checks.pass,
            snap.checks.fail,
            snap.checks.pending,
            snap.comments.len(),
            snapshot_fingerprint(&snap)
        );
        assert_eq!(snap.number, number);
        assert!(!snap.title.trim().is_empty());
        assert!(snap.url.contains(&format!("/pull/{number}")));
    }
}
