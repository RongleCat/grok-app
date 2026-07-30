//! Grok Build **agent leader** process management for Settings → Runtime.
//!
//! CLI surface (verified against current Grok Build):
//! - `grok agent leader` — long-running shared backend (Unix socket)
//! - `grok leader list --json` / `kill` / `info`
//! - Default socket: `~/.grok/leader.sock` (override: `GROK_LEADER_SOCKET` or `--leader-socket`)
//!
//! The app may spawn a background leader and track its PID for stop; externally
//! started leaders are still visible via socket probe + `leader list`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::cli_probe;
use crate::process_util;
use crate::session_manager::SessionManager;
use crate::store;

const LEADER_CMD_TIMEOUT_SECS: u64 = 15;
const LEADER_START_WAIT_MS: u64 = 2500;
const LEADER_START_POLL_MS: u64 = 150;

/// Tracked PID of a leader **we** spawned (not necessarily the only leader).
static TRACKED_LEADER: Mutex<Option<TrackedLeader>> = Mutex::new(None);

#[derive(Debug, Clone)]
struct TrackedLeader {
    pid: u32,
    /// Unix process-group id (same as pid when we call setsid).
    pgid: Option<i32>,
    /// Socket we passed to spawn (informational / future diagnostics).
    #[allow(dead_code)]
    socket_path: String,
    #[allow(dead_code)]
    started_at_unix: u64,
}

/// One row from `grok leader list --json` (fields vary by CLI version).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderProcessDto {
    pub pid: Option<u64>,
    pub socket_path: Option<String>,
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classification: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
}

/// Aggregate status for the Runtime panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderStatusDto {
    /// `stopped` | `running` | `error` | `unsupported`
    pub state: String,
    pub socket_path: String,
    pub socket_exists: bool,
    /// Seconds since socket mtime when known.
    pub socket_age_secs: Option<u64>,
    pub pid: Option<u64>,
    pub version: Option<String>,
    pub classification: Option<String>,
    /// PID we spawned from the app (may differ from list if external).
    pub tracked_pid: Option<u64>,
    pub cli_found: bool,
    pub cli_supports_leader: bool,
    /// Honest message when CLI cannot run leader, or last error.
    pub message: Option<String>,
    /// Leaders from `grok leader list --json` (may be empty if CLI probe fails).
    pub leaders: Vec<LeaderProcessDto>,
    /// Optional serve bind (informational; secrets always masked if present).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serve_hint: Option<String>,
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/// Default leader socket path: `GROK_LEADER_SOCKET` env, else `~/.grok/leader.sock`.
pub fn default_leader_socket_path() -> PathBuf {
    if let Ok(p) = std::env::var("GROK_LEADER_SOCKET") {
        let t = p.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    process_util::user_home().join(".grok").join("leader.sock")
}

/// Age of a path's mtime in whole seconds, if available.
pub fn path_age_secs(path: &Path, now: SystemTime) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    now.duration_since(modified).ok().map(|d| d.as_secs())
}

/// Mask secrets / tokens for UI display (never show full serve secret).
pub fn mask_secret(value: &str) -> String {
    let t = value.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.len() <= 4 {
        return "••••".into();
    }
    let visible = t
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("••••{visible}")
}

/// Pure parse helper for `grok leader list --json`.
pub fn parse_leader_list_json(stdout: &str) -> Result<Vec<LeaderProcessDto>, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("invalid leader list JSON: {e}"))?;
    let items: Vec<serde_json::Value> = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value
        .get("leaders")
        .or_else(|| value.get("processes"))
        .and_then(|v| v.as_array())
    {
        arr.clone()
    } else if value.is_object() {
        vec![value]
    } else {
        return Ok(Vec::new());
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let pid = item
            .get("pid")
            .or_else(|| item.get("leader_pid"))
            .or_else(|| item.get("leaderPid"))
            .or_else(|| item.get("pidLive"))
            .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|i| i as u64)));
        let socket_path = item
            .get("socket_path")
            .or_else(|| item.get("socketPath"))
            .or_else(|| item.get("socket"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let version = item
            .get("version")
            .or_else(|| item.get("leader_version"))
            .or_else(|| item.get("leaderVersion"))
            .or_else(|| item.get("leader_binary_version"))
            .or_else(|| {
                item.get("info")
                    .and_then(|i| i.get("leader_binary_version"))
            })
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let classification = item
            .get("classification")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        out.push(LeaderProcessDto {
            pid,
            socket_path,
            version,
            classification,
            raw: Some(item),
        });
    }
    Ok(out)
}

/// Derive panel state from socket probe + list rows + CLI capability.
pub fn derive_leader_state(
    socket_exists: bool,
    leaders: &[LeaderProcessDto],
    cli_found: bool,
    cli_supports_leader: bool,
    list_error: Option<&str>,
) -> (&'static str, Option<String>) {
    if !cli_found {
        return (
            "error",
            Some("Grok Build CLI not found. Install or set the CLI path under Runtime.".into()),
        );
    }
    if !cli_supports_leader {
        return (
            "unsupported",
            Some(
                "This Grok Build CLI version does not expose `agent leader` / `leader` commands."
                    .into(),
            ),
        );
    }

    let reachable = leaders.iter().any(|l| {
        l.pid.is_some()
            && l.classification
                .as_deref()
                .map(|c| c.eq_ignore_ascii_case("Reachable") || c.eq_ignore_ascii_case("running"))
                .unwrap_or(true)
    });
    if reachable || (!leaders.is_empty() && leaders.iter().any(|l| l.pid.is_some())) {
        return ("running", None);
    }
    // Socket present but list empty — stale socket or still starting.
    if socket_exists && leaders.is_empty() {
        if let Some(err) = list_error {
            return ("error", Some(err.chars().take(400).collect()));
        }
        return (
            "error",
            Some("Leader socket exists but no reachable leader process was listed.".into()),
        );
    }
    if let Some(err) = list_error {
        // List failed but no socket — treat as stopped with diagnostic, not hard error,
        // so the user can still try Start.
        if !socket_exists {
            return ("stopped", Some(err.chars().take(400).collect()));
        }
        return ("error", Some(err.chars().take(400).collect()));
    }
    ("stopped", None)
}

// ── CLI helpers ─────────────────────────────────────────────────────────────

fn run_grok_cli_args(args: &[&str], timeout_secs: u64) -> Result<(String, String, bool), String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };

    let args_owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args_owned);
        process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok((stdout, stderr, output.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run grok: {e}")),
        Err(_) => Err(format!("grok command timed out after {timeout_secs}s")),
    }
}

fn probe_cli_supports_leader() -> (bool, bool, Option<String>) {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if !probe.found {
        return (false, false, Some("Grok Build CLI not found".into()));
    }
    // Prefer `grok leader --help` (management surface); fall back to agent leader.
    match run_grok_cli_args(&["leader", "--help"], 8) {
        Ok((stdout, stderr, ok)) => {
            let blob = format!("{stdout}\n{stderr}").to_ascii_lowercase();
            let supports = ok
                && (blob.contains("list") || blob.contains("kill") || blob.contains("leader"));
            if supports {
                return (true, true, None);
            }
        }
        Err(e) => {
            // CLI missing mid-flight
            if e.contains("not found") {
                return (false, false, Some(e));
            }
        }
    }
    match run_grok_cli_args(&["agent", "leader", "--help"], 8) {
        Ok((stdout, stderr, ok)) => {
            let blob = format!("{stdout}\n{stderr}").to_ascii_lowercase();
            let supports = ok
                && (blob.contains("shared leader")
                    || blob.contains("leader process")
                    || blob.contains("leader-socket")
                    || blob.contains("--no-exit-on-disconnect"));
            (true, supports, None)
        }
        Err(e) => (true, false, Some(e)),
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // signal 0 = existence check
        libc_kill(pid as i32, 0) == 0
    }
    #[cfg(windows)]
    {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout);
                s.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
}

fn kill_tracked(pid: u32, pgid: Option<i32>) {
    #[cfg(unix)]
    {
        if let Some(g) = pgid.or(Some(pid as i32)) {
            let _ = libc_kill(-g, 15); // SIGTERM group
            std::thread::sleep(Duration::from_millis(200));
            let _ = libc_kill(-g, 9);
            // Reap best-effort (if we are parent — usually not after setsid)
            let _ = libc_waitpid(pid as i32);
            return;
        }
    }
    #[cfg(windows)]
    {
        let _ = pgid;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(unix)]
fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid, sig) }
}

#[cfg(unix)]
fn libc_setsid() -> i32 {
    extern "C" {
        fn setsid() -> i32;
    }
    unsafe { setsid() }
}

#[cfg(unix)]
fn libc_waitpid(pid: i32) -> i32 {
    extern "C" {
        fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
    }
    // WNOHANG = 1
    unsafe { waitpid(pid, std::ptr::null_mut(), 1) }
}

fn clear_tracked_if_dead() {
    let mut guard = match TRACKED_LEADER.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(t) = guard.as_ref() {
        if !pid_alive(t.pid) {
            *guard = None;
        }
    }
}

fn collect_status_sync() -> LeaderStatusDto {
    clear_tracked_if_dead();
    let socket_path = default_leader_socket_path();
    let socket_path_str = socket_path.to_string_lossy().to_string();
    let socket_exists = socket_path.exists();
    let socket_age_secs = if socket_exists {
        path_age_secs(&socket_path, SystemTime::now())
    } else {
        None
    };

    let (cli_found, cli_supports_leader, support_msg) = probe_cli_supports_leader();

    let mut leaders = Vec::new();
    let mut list_error: Option<String> = None;

    if cli_found && cli_supports_leader {
        match run_grok_cli_args(&["leader", "list", "--json"], LEADER_CMD_TIMEOUT_SECS) {
            Ok((stdout, stderr, ok)) => {
                if ok {
                    match parse_leader_list_json(&stdout) {
                        Ok(rows) => leaders = rows,
                        Err(e) => list_error = Some(e),
                    }
                } else {
                    let msg = if !stderr.is_empty() {
                        stderr
                    } else if !stdout.is_empty() {
                        stdout
                    } else {
                        "grok leader list failed".into()
                    };
                    list_error = Some(msg.chars().take(400).collect());
                }
            }
            Err(e) => list_error = Some(e),
        }
    }

    let (state, mut message) = derive_leader_state(
        socket_exists,
        &leaders,
        cli_found,
        cli_supports_leader,
        list_error.as_deref(),
    );
    if message.is_none() {
        message = support_msg;
    }

    let primary = leaders.first();
    let tracked = TRACKED_LEADER
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|t| t.pid as u64));

    // Prefer live list fields; fall back to tracked pid.
    let pid = primary
        .and_then(|l| l.pid)
        .or(tracked)
        .or_else(|| {
            // If socket exists and tracked is alive, surface it.
            TRACKED_LEADER
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|t| t.pid as u64))
        });

    let version = primary.and_then(|l| l.version.clone());
    let classification = primary.and_then(|l| l.classification.clone());
    let socket_from_list = primary
        .and_then(|l| l.socket_path.clone())
        .unwrap_or(socket_path_str);

    LeaderStatusDto {
        state: state.into(),
        socket_path: socket_from_list,
        socket_exists,
        socket_age_secs,
        pid,
        version,
        classification,
        tracked_pid: tracked,
        cli_found,
        cli_supports_leader,
        message,
        leaders,
        serve_hint: Some(
            "Optional: `grok agent serve` (WebSocket; secrets auto-generated — never shown here)."
                .into(),
        ),
    }
}

fn spawn_leader_process(cli_path: &Path, socket_path: &Path) -> Result<TrackedLeader, String> {
    let mut cmd = std::process::Command::new(cli_path);
    cmd.arg("agent")
        .arg("leader")
        .arg("--no-exit-on-disconnect")
        .arg("--no-auto-update")
        .arg("--leader-socket")
        .arg(socket_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }

    // Own process group / session so we can kill the tree and avoid zombies
    // hanging off the app when we drop our handle (we do not wait on the child).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: runs in child before exec; setsid → new session = process group.
        unsafe {
            cmd.pre_exec(|| {
                if libc_setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn grok agent leader: {e}"))?;
    let pid = child.id();
    // Reap in a background thread so we never leave zombies. kill_on_drop is not
    // set (std Command) — we only wait; stop path kills via process group / CLI.
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(TrackedLeader {
        pid,
        pgid: Some(pid as i32),
        socket_path: socket_path.to_string_lossy().to_string(),
        started_at_unix: unix_now(),
    })
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Full status for Settings → Runtime → Agent leader / serve.
#[tauri::command]
pub async fn leader_status() -> Result<LeaderStatusDto, String> {
    tauri::async_runtime::spawn_blocking(collect_status_sync)
        .await
        .map_err(|e| e.to_string())
}

/// List running leader processes (`grok leader list --json`).
#[tauri::command]
pub async fn leader_list() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        run_grok_cli_args(&["leader", "list", "--json"], LEADER_CMD_TIMEOUT_SECS)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok((stdout, stderr, ok)) => {
            if !ok {
                let msg = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    "grok leader list failed".into()
                };
                return Ok(serde_json::json!({
                    "leaders": [],
                    "error": msg.chars().take(400).collect::<String>(),
                }));
            }
            match parse_leader_list_json(&stdout) {
                Ok(leaders) => Ok(serde_json::json!({ "leaders": leaders })),
                Err(e) => Ok(serde_json::json!({
                    "leaders": [],
                    "error": e,
                })),
            }
        }
        Err(e) => Ok(serde_json::json!({
            "leaders": [],
            "error": e,
        })),
    }
}

/// Start `grok agent leader` in the background (tracked PID + process group).
#[tauri::command]
pub async fn leader_start() -> Result<LeaderStatusDto, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Already running?
        let current = collect_status_sync();
        if current.state == "running" {
            return Ok(current);
        }
        if !current.cli_found {
            return Err("Grok Build CLI not found".into());
        }
        if !current.cli_supports_leader {
            return Err(current.message.unwrap_or_else(|| {
                "This CLI version cannot run `grok agent leader`".into()
            }));
        }

        let settings = store::load_settings();
        let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
        let Some(cli_path) = probe.path.filter(|_| probe.found) else {
            return Err("Grok Build CLI not found".into());
        };
        let socket = default_leader_socket_path();
        if let Some(parent) = socket.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let tracked = spawn_leader_process(Path::new(&cli_path), &socket)?;
        {
            let mut guard = TRACKED_LEADER
                .lock()
                .map_err(|_| "leader tracker lock poisoned".to_string())?;
            *guard = Some(tracked);
        }

        // Wait briefly for socket / list to show Reachable.
        let deadline = std::time::Instant::now() + Duration::from_millis(LEADER_START_WAIT_MS);
        loop {
            let st = collect_status_sync();
            if st.state == "running" {
                return Ok(st);
            }
            // Process died immediately
            if let Ok(g) = TRACKED_LEADER.lock() {
                if let Some(t) = g.as_ref() {
                    if !pid_alive(t.pid) {
                        drop(g);
                        let mut g2 = TRACKED_LEADER.lock().ok();
                        if let Some(ref mut gg) = g2 {
                            **gg = None;
                        }
                        return Err(
                            "Leader process exited immediately after start. Check CLI auth / logs."
                                .into(),
                        );
                    }
                }
            }
            if std::time::Instant::now() >= deadline {
                // Still starting — report best-effort status (socket may appear late).
                let mut st = collect_status_sync();
                if st.state == "stopped" && st.socket_exists {
                    st.state = "running".into();
                    st.message = Some("Leader started; socket present.".into());
                } else if st.state == "stopped" {
                    st.state = "running".into();
                    st.message =
                        Some("Leader process spawned; waiting for socket to become ready.".into());
                    if st.pid.is_none() {
                        if let Ok(g) = TRACKED_LEADER.lock() {
                            st.pid = g.as_ref().map(|t| t.pid as u64);
                            st.tracked_pid = st.pid;
                        }
                    }
                }
                return Ok(st);
            }
            std::thread::sleep(Duration::from_millis(LEADER_START_POLL_MS));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop leaders: `grok leader kill` plus tracked PID cleanup; soft-respawn if useLeader.
#[tauri::command]
pub async fn leader_stop(
    app: tauri::AppHandle,
    mgr: State<'_, std::sync::Arc<SessionManager>>,
) -> Result<LeaderStatusDto, String> {
    let kill_result = tauri::async_runtime::spawn_blocking(|| {
        // Prefer CLI kill (handles external leaders + lock files).
        let cli_res = run_grok_cli_args(&["leader", "kill"], LEADER_CMD_TIMEOUT_SECS);
        // Always clear / kill our tracked process group.
        if let Ok(mut guard) = TRACKED_LEADER.lock() {
            if let Some(t) = guard.take() {
                if pid_alive(t.pid) {
                    kill_tracked(t.pid, t.pgid);
                }
            }
        }
        cli_res
    })
    .await
    .map_err(|e| e.to_string())?;

    match kill_result {
        Ok((_stdout, stderr, ok)) => {
            if !ok {
                // If no leaders were running, kill may still "fail" — re-check status.
                let st = collect_status_sync();
                if st.state != "stopped" {
                    let msg = if !stderr.is_empty() {
                        stderr
                    } else {
                        "grok leader kill failed".into()
                    };
                    return Err(msg.chars().take(400).collect());
                }
            }
        }
        Err(e) => {
            // CLI missing — still try tracked kill (already done above if path ran).
            // If we never got to kill via CLI, try tracked only was done inside spawn_blocking.
            let st = collect_status_sync();
            if st.state == "running" {
                return Err(e);
            }
        }
    }

    // Soft-respawn agents that may have been attached via --leader.
    let settings = store::load_settings();
    if settings.use_leader {
        mgr.soft_respawn(&app).await;
    }

    Ok(collect_status_sync())
}

/// Stop all running leader processes (`grok leader kill`). Soft-respawns the app agent.
#[tauri::command]
pub async fn leader_kill_all(
    app: tauri::AppHandle,
    mgr: State<'_, std::sync::Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let st = leader_stop(app, mgr).await?;
    Ok(serde_json::json!({
        "ok": true,
        "state": st.state,
        "message": st.message,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parse_list_empty() {
        assert!(parse_leader_list_json("").unwrap().is_empty());
        assert!(parse_leader_list_json("[]").unwrap().is_empty());
    }

    #[test]
    fn parse_list_array_camel_case() {
        let raw = r#"[{"pid":7601,"pidFromLock":7601,"pidLive":7601,"classification":"Reachable","socketPath":"/Users/x/.grok/leader.sock","lockPath":"/Users/x/.grok/leader.lock","wsUrlSuffix":""}]"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(7601));
        assert_eq!(
            rows[0].socket_path.as_deref(),
            Some("/Users/x/.grok/leader.sock")
        );
        assert_eq!(rows[0].classification.as_deref(), Some("Reachable"));
    }

    #[test]
    fn parse_list_wrapped_object() {
        let raw = r#"{"leaders":[{"leader_pid":42,"socket_path":"/tmp/l.sock","leader_binary_version":"0.2.1"}]}"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(42));
        assert_eq!(rows[0].version.as_deref(), Some("0.2.1"));
    }

    #[test]
    fn parse_list_single_object() {
        let raw = r#"{"pid":9,"socket":"/tmp/a.sock"}"#;
        let rows = parse_leader_list_json(raw).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, Some(9));
        assert_eq!(rows[0].socket_path.as_deref(), Some("/tmp/a.sock"));
    }

    #[test]
    fn parse_list_invalid_json() {
        assert!(parse_leader_list_json("not-json").is_err());
    }

    #[test]
    fn derive_state_running_reachable() {
        let leaders = vec![LeaderProcessDto {
            pid: Some(1),
            socket_path: Some("/tmp/x".into()),
            version: None,
            classification: Some("Reachable".into()),
            raw: None,
        }];
        let (s, m) = derive_leader_state(true, &leaders, true, true, None);
        assert_eq!(s, "running");
        assert!(m.is_none());
    }

    #[test]
    fn derive_state_stopped() {
        let (s, _) = derive_leader_state(false, &[], true, true, None);
        assert_eq!(s, "stopped");
    }

    #[test]
    fn derive_state_unsupported() {
        let (s, m) = derive_leader_state(false, &[], true, false, None);
        assert_eq!(s, "unsupported");
        assert!(m.unwrap().contains("does not expose"));
    }

    #[test]
    fn derive_state_cli_missing() {
        let (s, m) = derive_leader_state(false, &[], false, false, None);
        assert_eq!(s, "error");
        assert!(m.unwrap().contains("not found"));
    }

    #[test]
    fn derive_state_stale_socket() {
        let (s, m) = derive_leader_state(true, &[], true, true, None);
        assert_eq!(s, "error");
        assert!(m.unwrap().contains("socket exists"));
    }

    #[test]
    fn mask_secret_short_and_long() {
        assert_eq!(mask_secret(""), "");
        assert_eq!(mask_secret("ab"), "••••");
        assert_eq!(mask_secret("super-secret-token"), "••••oken");
    }

    #[test]
    fn path_age_secs_recent_file() {
        let dir = std::env::temp_dir().join(format!("grok-leader-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("sock-ish");
        std::fs::write(&f, b"x").unwrap();
        let age = path_age_secs(&f, SystemTime::now()).unwrap();
        assert!(age < 5);
        // Advance "now"
        let later = SystemTime::now() + Duration::from_secs(30);
        // mtime is in the past relative to later — age should grow (platform may have 1s resolution)
        let age2 = path_age_secs(&f, later).unwrap();
        assert!(age2 >= 29);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_socket_respects_env() {
        // SAFETY: test-only env mutation; single-threaded test process.
        std::env::set_var("GROK_LEADER_SOCKET", "/tmp/custom-leader.sock");
        let p = default_leader_socket_path();
        assert_eq!(p, PathBuf::from("/tmp/custom-leader.sock"));
        std::env::remove_var("GROK_LEADER_SOCKET");
        let p2 = default_leader_socket_path();
        assert!(p2.ends_with(Path::new(".grok/leader.sock")) || p2.ends_with("leader.sock"));
    }
}
