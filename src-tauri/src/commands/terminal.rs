// Side Workbench: interactive PTY + path probe + embedded browser automation.

use std::path::Path;
use tauri::AppHandle;

use crate::pty_host;
use crate::side_browser_host::{self, SideBrowserInfo};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathExistsManyResult {
    pub existing: Vec<String>,
}

/// Soft path existence probe (optional diagnostics).
#[tauri::command]
pub async fn path_exists_many(paths: Vec<String>) -> Result<PathExistsManyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let existing: Vec<String> = paths
            .into_iter()
            .filter(|p| {
                let t = p.trim();
                !t.is_empty() && Path::new(t).exists()
            })
            .collect();
        PathExistsManyResult { existing }
    })
    .await
    .map_err(|e| format!("path_exists_many join: {e}"))
}

/// Spawn interactive login shell PTY (`$SHELL -l -i`). Streams on `terminal://data`.
#[tauri::command]
pub async fn terminal_pty_spawn(
    app: AppHandle,
    session_id: Option<String>,
    project_path: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<pty_host::PtySpawnResult, String> {
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);
    tauri::async_runtime::spawn_blocking(move || {
        pty_host::spawn(app, session_id, project_path, cols, rows)
    })
    .await
    .map_err(|e| format!("terminal_pty_spawn join: {e}"))?
}

/// Write UTF-8 input to a PTY session (keystrokes from xterm).
#[tauri::command]
pub async fn terminal_pty_write(session_id: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pty_host::write_bytes(&session_id, &data))
        .await
        .map_err(|e| format!("terminal_pty_write join: {e}"))?
}

/// Resize PTY when the terminal view changes.
#[tauri::command]
pub async fn terminal_pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pty_host::resize(&session_id, cols, rows))
        .await
        .map_err(|e| format!("terminal_pty_resize join: {e}"))?
}

/// Tear down a PTY session.
#[tauri::command]
pub async fn terminal_pty_kill(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pty_host::kill(&session_id))
        .await
        .map_err(|e| format!("terminal_pty_kill join: {e}"))?
}

// ── Embedded side browser automation (in-app Webview only) ──────────────

/// Create/replace a side-browser child webview with download save-dialog wiring.
/// Prefer this over frontend `new Webview()` so WKWebView downloads can prompt.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn side_browser_create(
    app: AppHandle,
    label: String,
    url: String,
    window_label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // `Window::add_child` dispatches work to the platform event loop and waits
    // for completion. Running it inside a synchronous IPC command can occupy
    // that same loop on Windows, leaving WebView2 half-created (renderer starts,
    // but the command never returns). Match Tauri's own async create_webview
    // command and keep the blocking wait off the UI/invoke thread.
    tauri::async_runtime::spawn_blocking(move || {
        side_browser_host::create(&app, label, url, window_label, x, y, width, height)
    })
    .await
    .map_err(|e| format!("side_browser_create join: {e}"))?
}

#[tauri::command]
pub fn side_browser_close(app: AppHandle, label: String) -> Result<(), String> {
    side_browser_host::close(&app, label)
}

#[tauri::command]
pub fn side_browser_list(app: AppHandle) -> Result<Vec<SideBrowserInfo>, String> {
    side_browser_host::list(&app)
}

#[tauri::command]
pub fn side_browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    side_browser_host::navigate(&app, label, url)
}

#[tauri::command]
pub fn side_browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    side_browser_host::reload(&app, label)
}

#[tauri::command]
pub fn side_browser_url(app: AppHandle, label: String) -> Result<String, String> {
    side_browser_host::current_url(&app, label)
}

/// Eval waits on the webview callback (up to 15s). Keep that wait off the
/// UI/invoke thread — a sync command here freezes the whole app when the
/// child document is mid-navigation (WK/WebView2 will not answer).
#[tauri::command]
pub async fn side_browser_eval(
    app: AppHandle,
    label: String,
    script: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || side_browser_host::eval(&app, label, script))
        .await
        .map_err(|e| format!("side_browser_eval join: {e}"))?
}

#[tauri::command]
pub async fn side_browser_snapshot(app: AppHandle, label: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || side_browser_host::snapshot(&app, label))
        .await
        .map_err(|e| format!("side_browser_snapshot join: {e}"))?
}

/// Force-inject blob download polyfill into a side-browser webview (idempotent).
#[tauri::command]
pub fn side_browser_install_download_hook(app: AppHandle, label: String) -> Result<(), String> {
    crate::side_browser_blob::install_hook(&app, label)
}
