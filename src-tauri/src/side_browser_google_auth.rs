//! Google Sign-In handoff for the embedded side browser (#1154).
//!
//! Child WebView2 hard-freezes on Google account / OAuth documents. Those
//! navigations open a top-level auth window that shares the side-browser
//! data directory so cookies return to the embedded tab after redirect.

use std::path::PathBuf;
use std::sync::LazyLock;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::side_browser_host::{emit_page_load, get_side_webview};

const AUTH_WINDOW_LABEL: &str = "side-browser-google-auth";
const EXTERNAL_OPEN_EVENT: &str = "side-browser://external-open";

/// Stable WKWebView data-store id (macOS 14+). Windows/Linux use `data_directory`.
pub const SIDE_BROWSER_DATA_STORE: [u8; 16] = [
    0x47, 0x72, 0x6f, 0x6b, 0x53, 0x69, 0x64, 0x65, 0x42, 0x72, 0x6f, 0x77, 0x73, 0x65, 0x72, 0x01,
];

static PENDING_GOOGLE_AUTH: LazyLock<Mutex<Option<PendingGoogleAuth>>> =
    LazyLock::new(|| Mutex::new(None));

struct PendingGoogleAuth {
    side_label: String,
}

/// Payload for `side-browser://external-open` (status line after Google auth handoff).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideBrowserExternalOpenPayload {
    pub label: String,
    pub url: String,
    /// `google_auth` — opened the shared-cookie login window
    pub reason: String,
}

pub fn side_browser_data_directory() -> PathBuf {
    crate::paths::app_data_root()
        .join("webviews")
        .join("side-browser")
}

/// Google account / OAuth surfaces that hard-freeze child WebView2 on Windows (#1154).
///
/// Intentionally narrow: plain `google.com` search / docs stay in-app.
pub fn should_open_google_auth_externally(url: &Url) -> bool {
    if url.scheme() != "https" && url.scheme() != "http" {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    if host == "accounts.google.com"
        || host == "accounts.youtube.com"
        || host == "accounts.googleusercontent.com"
        || host.ends_with(".accounts.google.com")
        || host == "oauth2.googleapis.com"
    {
        return true;
    }
    if host == "google.com" || host == "www.google.com" {
        let path = url.path().to_ascii_lowercase();
        return path.starts_with("/o/oauth2")
            || path.starts_with("/signin")
            || path.starts_with("/_/accountchooser")
            || path.starts_with("/accountchooser");
    }
    false
}

fn emit_external_open(app: &AppHandle, label: &str, url: &str) {
    if let Err(e) = app.emit(
        EXTERNAL_OPEN_EVENT,
        SideBrowserExternalOpenPayload {
            label: label.into(),
            url: url.into(),
            reason: "google_auth".into(),
        },
    ) {
        tracing::warn!(error = %e, "side-browser external-open emit failed");
    }
}

fn resume_side_browser_after_google_auth(app: &AppHandle, callback: &Url) {
    let side_label = PENDING_GOOGLE_AUTH.lock().take().map(|p| p.side_label);
    let Some(side_label) = side_label else {
        tracing::warn!(
            target: "side_browser",
            url = %callback,
            "Google auth completed but no pending side-browser label"
        );
        if let Some(w) = app.get_webview_window(AUTH_WINDOW_LABEL) {
            let _ = w.close();
        }
        return;
    };
    tracing::info!(
        target: "side_browser",
        %side_label,
        url = %callback,
        "Google auth redirect → resume embedded browser"
    );
    if let Some(w) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        let _ = w.close();
    }
    match get_side_webview(app, &side_label) {
        Ok(wv) => {
            emit_page_load(app, "started", &side_label, callback.as_str());
            if let Err(e) = wv.navigate(callback.clone()) {
                tracing::warn!(
                    target: "side_browser",
                    error = %e,
                    %side_label,
                    "failed to navigate side browser after Google auth"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                target: "side_browser",
                error = %e,
                %side_label,
                "side browser missing after Google auth"
            );
        }
    }
}

fn open_google_auth_window(app: &AppHandle, side_label: &str, url: &Url) -> Result<(), String> {
    *PENDING_GOOGLE_AUTH.lock() = Some(PendingGoogleAuth {
        side_label: side_label.to_string(),
    });
    let data_dir = side_browser_data_directory();
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("side browser profile dir: {e}"))?;

    if let Some(existing) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        existing
            .navigate(url.clone())
            .map_err(|e| format!("google auth navigate: {e}"))?;
        let _ = existing.set_focus();
        let _ = existing.unminimize();
        let _ = existing.show();
        return Ok(());
    }

    let app_nav = app.clone();
    let app_new = app.clone();
    let builder =
        WebviewWindowBuilder::new(app, AUTH_WINDOW_LABEL, WebviewUrl::External(url.clone()))
            .title("Google Sign-In")
            .inner_size(520.0, 740.0)
            .min_inner_size(360.0, 480.0)
            .resizable(true)
            .center()
            .data_directory(data_dir)
            .data_store_identifier(SIDE_BROWSER_DATA_STORE)
            .on_navigation(move |nav_url| {
                if should_open_google_auth_externally(nav_url) {
                    return true;
                }
                let scheme = nav_url.scheme();
                if scheme == "about" || scheme == "blob" || scheme == "data" {
                    return true;
                }
                // OAuth finished — load the redirect in the embedded tab (shared cookies).
                resume_side_browser_after_google_auth(&app_nav, nav_url);
                false
            })
            .on_new_window(move |popup_url, _features| {
                if should_open_google_auth_externally(&popup_url) {
                    if let Some(w) = app_new.get_webview_window(AUTH_WINDOW_LABEL) {
                        let _ = w.navigate(popup_url);
                    }
                }
                NewWindowResponse::Deny
            });

    let window = builder
        .build()
        .map_err(|e| format!("google auth window: {e}"))?;
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = PENDING_GOOGLE_AUTH.lock().take();
        }
    });
    Ok(())
}

/// Cancel child-webview Google auth navigations and open the shared-cookie window.
pub fn handoff_google_auth_externally(app: &AppHandle, label: &str, url: &Url) -> bool {
    if !should_open_google_auth_externally(url) {
        return false;
    }
    let url_s = url.as_str();
    tracing::info!(
        target: "side_browser",
        %label,
        url = %url_s,
        "Google auth URL → shared-cookie login window (WebView2 freeze guard)"
    );
    if let Err(e) = open_google_auth_window(app, label, url) {
        tracing::warn!(
            target: "side_browser",
            error = %e,
            url = %url_s,
            "failed to open Google auth window"
        );
    }
    emit_external_open(app, label, url_s);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_auth_hosts_open_externally() {
        let cases = [
            (
                "https://accounts.google.com/o/oauth2/auth?client_id=1",
                true,
            ),
            ("https://accounts.youtube.com/accounts/SetSID", true),
            ("https://oauth2.googleapis.com/token", true),
            ("https://www.google.com/o/oauth2/v2/auth?client_id=1", true),
            ("https://www.google.com/signin/identifier", true),
            ("https://www.google.com/search?q=hello", false),
            ("https://google.com/", false),
            ("https://mail.google.com/", false),
            ("https://example.com/accounts.google.com", false),
        ];
        for (raw, expect) in cases {
            let url = Url::parse(raw).unwrap();
            assert_eq!(
                should_open_google_auth_externally(&url),
                expect,
                "url={raw}"
            );
        }
    }
}
