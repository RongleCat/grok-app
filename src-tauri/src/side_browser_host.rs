//! Embedded side-browser automation surface.
//!
//! All side browser tabs are **in-app** Tauri child Webviews (WKWebView /
//! WebView2 / webkit2gtk). Automation (navigate / eval / url) targets those
//! labeled webviews so Agent tooling can drive the same surface the user sees.
//!
//! Child webviews **must** be created via [`create`] so downloads get an
//! `on_download` handler with a native save dialog. Frontend `new Webview()`
//! skips that hook — WKWebView then cannot prompt for a destination and
//! downloads fail or vanish silently.
//!
//! True Chromium-in-process (CEF) is **not** available in Tauri/Wry today.
//! When CEF lands, it should register under the same label scheme and reuse
//! these commands so automation clients stay compatible.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::{DownloadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl};
use tauri::{LogicalPosition, LogicalSize, Url};

const LABEL_PREFIX: &str = "resource-browser";
const DOWNLOAD_EVENT: &str = "side-browser://download";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideBrowserInfo {
    pub label: String,
    pub url: Option<String>,
}

/// Payload for `side-browser://download` (UI toast / status line).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideBrowserDownloadPayload {
    /// `requested` | `finished` | `cancelled`
    pub phase: String,
    pub label: String,
    pub url: String,
    pub path: Option<String>,
    pub success: Option<bool>,
    pub file_name: Option<String>,
}

fn validate_label(label: &str) -> Result<(), String> {
    let t = label.trim();
    if t.is_empty() || t.len() > 96 {
        return Err("invalid webview label".into());
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '/'))
    {
        return Err("invalid webview label chars".into());
    }
    Ok(())
}

fn validate_side_label(label: &str) -> Result<(), String> {
    validate_label(label)?;
    if !label.starts_with(LABEL_PREFIX) {
        return Err(format!("side browser label must start with {LABEL_PREFIX}"));
    }
    Ok(())
}

fn validate_url(url: &str) -> Result<Url, String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("url empty".into());
    }
    let lower = u.to_ascii_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("about:")
        || lower.starts_with("file://")
        || lower.starts_with("data:"))
    {
        return Err("url scheme not allowed".into());
    }
    Url::parse(u).map_err(|e| format!("bad url: {e}"))
}

fn get_side_webview<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<tauri::Webview<R>, String> {
    validate_label(label)?;
    app.get_webview(label)
        .ok_or_else(|| format!("side browser webview not found: {label}"))
}

/// Sanitize a suggested download file name for the save dialog.
fn sanitize_file_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let base = if trimmed.is_empty() {
        "download"
    } else {
        trimmed
    };
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    if cleaned.is_empty() {
        "download".into()
    } else {
        cleaned.chars().take(200).collect()
    }
}

/// Prefer WK/WebView2 suggested path name; fall back to URL path segment.
fn suggested_download_name(destination: &Path, url: &str) -> String {
    if let Some(name) = destination
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return sanitize_file_name(name);
    }
    if let Ok(u) = Url::parse(url) {
        if let Some(seg) = u
            .path_segments()
            .and_then(|mut s| s.next_back())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return sanitize_file_name(seg);
        }
    }
    "download".into()
}

fn emit_download(app: &AppHandle, payload: SideBrowserDownloadPayload) {
    if let Err(e) = app.emit(DOWNLOAD_EVENT, &payload) {
        tracing::warn!(error = %e, "side-browser download emit failed");
    }
}

/// Create (or replace) an in-app side-browser child webview with download UX.
///
/// `window_label` is usually `main` or `session-*` — the window that hosts the
/// overlay bounds. Position/size are logical pixels matching the host DOM rect.
pub fn create(
    app: &AppHandle,
    label: String,
    url: String,
    window_label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_side_label(&label)?;
    let parsed = validate_url(&url)?;
    let win_label = window_label.trim();
    if win_label.is_empty() {
        return Err("window_label empty".into());
    }

    let width = width.max(40.0);
    let height = height.max(40.0);

    if let Some(existing) = app.get_webview(&label) {
        existing
            .close()
            .map_err(|e| format!("close existing side browser: {e}"))?;
    }

    let window = app
        .get_window(win_label)
        .ok_or_else(|| format!("window not found: {win_label}"))?;

    let webview_label = label.clone();
    let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
        .accept_first_mouse(true)
        .focused(true)
        .on_download(move |webview, event| {
            let label = webview.label().to_string();
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let url_s = url.to_string();
                    let suggested = suggested_download_name(destination, &url_s);
                    tracing::info!(
                        target: "side_browser",
                        %label,
                        url = %url_s,
                        %suggested,
                        "download requested"
                    );

                    let app = webview.app_handle().clone();
                    emit_download(
                        &app,
                        SideBrowserDownloadPayload {
                            phase: "requested".into(),
                            label: label.clone(),
                            url: url_s.clone(),
                            path: None,
                            success: None,
                            file_name: Some(suggested.clone()),
                        },
                    );

                    // Native save dialog (blocks this download callback until
                    // the user chooses a path or cancels). rfd is main-thread
                    // safe on macOS when already on the UI thread.
                    let chosen = rfd::FileDialog::new()
                        .set_title("Save file / 保存文件")
                        .set_file_name(&suggested)
                        .save_file();

                    match chosen {
                        Some(path) => {
                            crate::path_scope::grant_path(&path);
                            *destination = path;
                            true
                        }
                        None => {
                            emit_download(
                                &app,
                                SideBrowserDownloadPayload {
                                    phase: "cancelled".into(),
                                    label,
                                    url: url_s,
                                    path: None,
                                    success: Some(false),
                                    file_name: Some(suggested),
                                },
                            );
                            false
                        }
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    let url_s = url.to_string();
                    let path_s = path.as_ref().map(|p| p.display().to_string());
                    let file_name = path
                        .as_ref()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string());
                    if success {
                        if let Some(ref p) = path {
                            crate::path_scope::grant_path(p);
                        }
                    }
                    tracing::info!(
                        target: "side_browser",
                        %label,
                        url = %url_s,
                        path = ?path_s,
                        success,
                        "download finished"
                    );
                    emit_download(
                        &webview.app_handle(),
                        SideBrowserDownloadPayload {
                            phase: "finished".into(),
                            label,
                            url: url_s,
                            path: path_s,
                            success: Some(success),
                            file_name,
                        },
                    );
                    true
                }
                _ => true,
            }
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("side browser create: {e}"))?;

    tracing::info!(
        target: "side_browser",
        %webview_label,
        window = %win_label,
        url = %url,
        "side browser webview created"
    );
    Ok(())
}

/// Close a side-browser webview if present (no error when already gone).
pub fn close(app: &AppHandle, label: String) -> Result<(), String> {
    validate_side_label(&label)?;
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| format!("side browser close: {e}"))?;
    }
    Ok(())
}

/// List known side-browser webviews (label prefix `resource-browser`).
pub fn list(app: &AppHandle) -> Result<Vec<SideBrowserInfo>, String> {
    let mut out = Vec::new();
    for w in app.webviews().values() {
        let label = w.label().to_string();
        if !label.starts_with(LABEL_PREFIX) {
            continue;
        }
        let url = w.url().ok().map(|u| u.to_string());
        out.push(SideBrowserInfo { label, url });
    }
    out.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(out)
}

pub fn navigate(app: &AppHandle, label: String, url: String) -> Result<(), String> {
    let parsed = validate_url(&url)?;
    let wv = get_side_webview(app, &label)?;
    wv.navigate(parsed).map_err(|e| format!("navigate: {e}"))
}

pub fn reload(app: &AppHandle, label: String) -> Result<(), String> {
    let wv = get_side_webview(app, &label)?;
    wv.reload().map_err(|e| format!("reload: {e}"))
}

pub fn current_url(app: &AppHandle, label: String) -> Result<String, String> {
    let wv = get_side_webview(app, &label)?;
    wv.url()
        .map(|u| u.to_string())
        .map_err(|e| format!("url: {e}"))
}

/// Evaluate JS in the embedded webview; return JSON-serialized result string.
///
/// Script should be an expression or IIFE that returns a value. Exceptions
/// should be caught in-script (Windows WebView2 limitation).
pub fn eval(app: &AppHandle, label: String, script: String) -> Result<String, String> {
    validate_label(&label)?;
    if script.trim().is_empty() {
        return Err("script empty".into());
    }
    if script.len() > 512_000 {
        return Err("script too large".into());
    }
    let wv = get_side_webview(app, &label)?;
    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback(script, move |result| {
        let _ = tx.send(result);
    })
    .map_err(|e| format!("eval: {e}"))?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| "eval timeout".to_string())
}

/// Convenience: page snapshot for automation (title + href + body text sample).
pub fn snapshot(app: &AppHandle, label: String) -> Result<String, String> {
    let script = r#"(function(){
  try {
    return JSON.stringify({
      title: document.title || '',
      href: location.href || '',
      readyState: document.readyState || '',
      text: (document.body && document.body.innerText || '').slice(0, 8000)
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()"#;
    eval(app, label, script.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn label_rules() {
        assert!(validate_label("resource-browser-tab1").is_ok());
        assert!(validate_label("../x").is_err());
        assert!(validate_side_label("resource-browser-x").is_ok());
        assert!(validate_side_label("other").is_err());
    }

    #[test]
    fn url_scheme_rules() {
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn sanitize_file_name_strips_path_chars() {
        assert_eq!(sanitize_file_name("a/b\\c:d?.pdf"), "a_b_c_d_.pdf");
        assert_eq!(sanitize_file_name("  "), "download");
        assert_eq!(sanitize_file_name("..."), "download");
    }

    #[test]
    fn suggested_name_from_destination_or_url() {
        let dest = PathBuf::from("/tmp/report.zip");
        assert_eq!(
            suggested_download_name(&dest, "https://example.com/x.bin"),
            "report.zip"
        );
        // No file name component → fall back to URL path segment.
        let empty = PathBuf::new();
        assert_eq!(
            suggested_download_name(&empty, "https://cdn.example.com/files/data.csv"),
            "data.csv"
        );
    }
}
