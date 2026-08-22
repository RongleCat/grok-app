//! Host-side desktop notifications.
//!
//! **macOS delivery (Sequoia reality)**:
//! - Real `.app` package → `UNUserNotificationCenter` (registers as Grok, can banner).
//!   Click (default action) restores the main window and emits `notify://clicked`.
//! - Bare `tauri dev` binary → **do not** use NSUserNotification / notify-rust:
//!   they often return Ok while delivering nothing. Use `osascript` instead
//!   (lands under Script Editor; banner depends on that app's Notification prefs).
//!   Script Editor toasts cannot deep-link back into this process.
//! - Touching UN from a bare binary aborts the process with an uncatchable ObjC
//!   exception (`bundleProxyForCurrentProcess is nil`).
//!
//! **Windows**: WinRT toast with `on_activated` (plugin desktop path is
//! fire-and-forget and ignores `extra`). Falls back to the plugin if WinRT fails.
//!
//! **Linux**: notify-rust default action. Plugin fallback if that fails.
//!
//! Returns the delivery **path** string on success so Settings can be honest.

use tauri::{AppHandle, Emitter};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

/// Product bundle id / AUMID (must match `tauri.conf.json` `identifier`).
/// Linux notifications carry no app id; the const stays for WinToast/macOS.
#[cfg_attr(target_os = "linux", allow(dead_code))]
const APP_BUNDLE_ID: &str = "com.grokapp.desktop";

/// Frontend listens for this after a native notification body click.
pub const NOTIFY_CLICKED_EVENT: &str = "notify://clicked";

/// Show a system notification.
///
/// On success returns a short path id:
/// - `unusernotification` — modern API, real `.app`
/// - `nsusernotification` — legacy API (packaged app fallback)
/// - `osascript` — dev bare-binary path (Script Editor)
/// - `winrt` — Windows Toast with click callback
/// - `notify-rust` — Linux XDG with default-action click
/// - `plugin` — tauri-plugin-notification (no desktop click)
#[tauri::command]
pub fn desktop_notify_show(
    app: AppHandle,
    title: String,
    body: Option<String>,
    session_id: Option<String>,
) -> Result<String, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("notification title is empty".into());
    }
    let body = body
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();
    let session_id = sanitize_session_id(session_id.as_deref());

    #[cfg(target_os = "macos")]
    {
        match show_macos(&app, &title, &body, session_id.as_deref()) {
            Ok(path) => {
                tracing::info!(
                    target: "desktop_notify",
                    title = %title,
                    %path,
                    "native notification delivered"
                );
                Ok(path.to_string())
            }
            Err(e) => {
                tracing::warn!(
                    target: "desktop_notify",
                    error = %e,
                    title = %title,
                    "macos native path failed"
                );
                Err(e)
            }
        }
    }

    #[cfg(windows)]
    {
        match show_via_winrt(&app, &title, &body, session_id.as_deref()) {
            Ok(()) => {
                tracing::info!(
                    target: "desktop_notify",
                    title = %title,
                    "winrt notification accepted"
                );
                return Ok("winrt".into());
            }
            Err(e) => {
                tracing::warn!(
                    target: "desktop_notify",
                    error = %e,
                    title = %title,
                    "winrt notification failed; falling back to plugin"
                );
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match show_via_notify_rust(&app, &title, &body, session_id.as_deref()) {
            Ok(()) => {
                tracing::info!(
                    target: "desktop_notify",
                    title = %title,
                    "notify-rust notification accepted"
                );
                return Ok("notify-rust".into());
            }
            Err(e) => {
                tracing::warn!(
                    target: "desktop_notify",
                    error = %e,
                    title = %title,
                    "notify-rust notification failed; falling back to plugin"
                );
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        show_via_plugin(&app, &title, &body, session_id.as_deref())?;
        tracing::info!(
            target: "desktop_notify",
            title = %title,
            "plugin notification accepted"
        );
        Ok("plugin".into())
    }
}

/// Whether the host can attempt native notifications.
#[tauri::command]
pub fn desktop_notify_available() -> bool {
    true
}

/// Startup hook: request UN auth only inside a real `.app`.
pub fn request_permission_on_startup() {
    #[cfg(target_os = "macos")]
    {
        if is_real_app_bundle() {
            match request_macos_auth() {
                Ok(granted) => {
                    tracing::info!(
                        target: "desktop_notify",
                        granted,
                        "macos notification authorization"
                    );
                }
                Err(e) => {
                    tracing::debug!(
                        target: "desktop_notify",
                        error = %e,
                        "macos notification auth failed"
                    );
                }
            }
            // Pin legacy NS path for packaged-app fallback only.
            if let Err(e) = pin_ns_application() {
                tracing::debug!(
                    target: "desktop_notify",
                    error = %e,
                    "set_application(com.grokapp.desktop) failed"
                );
            }
        } else {
            tracing::debug!(
                target: "desktop_notify",
                "dev bare binary: notifications use osascript (Script Editor); UN/NS skipped"
            );
        }
    }
}

fn sanitize_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn notify_click_payload(session_id: Option<&str>) -> serde_json::Value {
    match sanitize_session_id(session_id) {
        Some(sid) => serde_json::json!({ "sessionId": sid }),
        None => serde_json::json!({}),
    }
}

/// Restore the main window, then tell the WebView which session to open.
fn dispatch_notification_click(app: &AppHandle, session_id: Option<&str>) {
    let app = app.clone();
    let sid = sanitize_session_id(session_id);
    let emit_and_focus = {
        let app = app.clone();
        let sid = sid.clone();
        move || {
            crate::tray::show_main_window(&app);
            let _ = app.emit(NOTIFY_CLICKED_EVENT, notify_click_payload(sid.as_deref()));
            tracing::info!(
                target: "desktop_notify",
                session_id = sid.as_deref().unwrap_or(""),
                "notification click dispatched"
            );
        }
    };
    if let Err(e) = app.run_on_main_thread(emit_and_focus) {
        tracing::debug!(
            target: "desktop_notify",
            error = %e,
            "run_on_main_thread failed; dispatching inline"
        );
        crate::tray::show_main_window(&app);
        let _ = app.emit(NOTIFY_CLICKED_EVENT, notify_click_payload(sid.as_deref()));
    }
}

#[cfg(not(target_os = "macos"))]
fn show_via_plugin(
    app: &AppHandle,
    title: &str,
    body: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title);
    if !body.is_empty() {
        builder = builder.body(body);
    }
    if let Some(sid) = session_id {
        builder = builder.extra("sessionId", sid);
    }
    builder.show().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn show_via_winrt(
    app: &AppHandle,
    title: &str,
    body: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    let app_click = app.clone();
    let sid = session_id.map(|s| s.to_string());
    let mut toast = Toast::new(APP_BUNDLE_ID).title(title);
    if !body.is_empty() {
        toast = toast.text1(body);
    }
    toast
        .on_activated(move |_action| {
            dispatch_notification_click(&app_click, sid.as_deref());
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn show_via_notify_rust(
    app: &AppHandle,
    title: &str,
    body: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(title);
    if !body.is_empty() {
        n.body(body);
    }
    n.action("default", "Open");
    let handle = n.show().map_err(|e| e.to_string())?;
    let app = app.clone();
    let sid = session_id.map(|s| s.to_string());
    std::thread::Builder::new()
        .name("grok-notify-click".into())
        .spawn(move || {
            handle.wait_for_action(|action| {
                if action == "default" {
                    dispatch_notification_click(&app, sid.as_deref());
                }
            });
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// True only when the running process lives inside `Something.app/Contents/MacOS/`.
#[cfg(target_os = "macos")]
fn is_real_app_bundle() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy();
        if path.contains(".app/Contents/MacOS/") {
            return true;
        }
        for ancestor in exe.ancestors() {
            if ancestor
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("app"))
            {
                return true;
            }
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn show_macos(
    app: &AppHandle,
    title: &str,
    body: &str,
    session_id: Option<&str>,
) -> Result<&'static str, String> {
    if is_real_app_bundle() {
        // Packaged app: modern UN first (real Grok identity + System Settings entry).
        match show_via_usernotifications(title, body) {
            Ok(handle) => {
                watch_macos_click(app.clone(), handle, session_id.map(|s| s.to_string()));
                return Ok("unusernotification");
            }
            Err(e) => {
                tracing::debug!(
                    target: "desktop_notify",
                    error = %e,
                    "UNUserNotificationCenter path failed"
                );
            }
        }
        // Packaged fallback: NS with our product id. Click may activate the
        // bundle, but this crate path cannot carry sessionId.
        match show_via_nsusernotification(title, body) {
            Ok(()) => return Ok("nsusernotification"),
            Err(e) => {
                tracing::debug!(
                    target: "desktop_notify",
                    error = %e,
                    "NSUserNotification path failed"
                );
            }
        }
        return show_via_osascript(title, body).map(|_| "osascript");
    }

    // Bare `tauri dev` binary on Sequoia:
    // - UN → process crash (never call)
    // - NS / notify-rust → often Ok with zero visible delivery
    // - osascript → lands in Notification Center under Script Editor (verified)
    show_via_osascript(title, body).map(|_| "osascript")
}

#[cfg(target_os = "macos")]
fn watch_macos_click(
    app: AppHandle,
    handle: mac_usernotifications::NotificationHandle,
    session_id: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        match handle.response().await {
            Ok(resp) if resp.is_default_action() => {
                dispatch_notification_click(&app, session_id.as_deref());
            }
            Ok(resp) => {
                tracing::debug!(
                    target: "desktop_notify",
                    action = %resp.action_identifier,
                    "macos notification response ignored"
                );
            }
            Err(e) => {
                tracing::debug!(
                    target: "desktop_notify",
                    error = %e,
                    "macos notification response failed"
                );
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn request_macos_auth() -> Result<bool, String> {
    if !is_real_app_bundle() {
        return Err("not a real .app bundle".into());
    }
    mac_usernotifications::check_bundle().map_err(|e| e.to_string())?;
    mac_usernotifications::blocking::request_auth().map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn show_via_usernotifications(
    title: &str,
    body: &str,
) -> Result<mac_usernotifications::NotificationHandle, String> {
    if !is_real_app_bundle() {
        return Err("not a real .app bundle".into());
    }
    mac_usernotifications::check_bundle().map_err(|e| e.to_string())?;
    let granted = mac_usernotifications::blocking::request_auth().map_err(|e| e.to_string())?;
    if !granted {
        return Err("user denied notification authorization".into());
    }
    let mut n = mac_usernotifications::Notification::new().title(title);
    if !body.is_empty() {
        n = n.message(body);
    }
    n.send_blocking().map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn pin_ns_application() -> Result<(), String> {
    use mac_notification_sys::error::{ApplicationError, Error as MacError};
    match mac_notification_sys::set_application(APP_BUNDLE_ID) {
        Ok(()) => Ok(()),
        Err(MacError::Application(ApplicationError::AlreadySet(_))) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(target_os = "macos")]
fn show_via_nsusernotification(title: &str, body: &str) -> Result<(), String> {
    pin_ns_application()?;
    mac_notification_sys::send_notification(title, None, body, None).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_via_osascript(title: &str, body: &str) -> Result<(), String> {
    use std::process::Command;

    // Collapse control/newlines and cap length so AppleScript stays valid
    // (availability; title/body are app-controlled i18n strings).
    let sanitize = |s: &str| -> String {
        let flat: String = s
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
        let truncated: String = flat.chars().take(200).collect();
        truncated.replace('\\', "\\\\").replace('"', "\\\"")
    };
    // sound name makes the alert more noticeable when banners are subtle.
    let script = format!(
        "display notification \"{}\" with title \"{}\" sound name \"default\"",
        sanitize(body),
        sanitize(title)
    );
    let out = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript spawn failed: {e}"))?;
    if out.status.success() {
        tracing::info!(
            target: "desktop_notify",
            title = %title,
            "osascript notification accepted (Notification Center → 脚本编辑器 / Script Editor)"
        );
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(format!("osascript failed: {stderr}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{notify_click_payload, sanitize_session_id};

    #[test]
    fn sanitize_session_id_trims_and_drops_empty() {
        assert_eq!(
            sanitize_session_id(Some("  sess-1  ")).as_deref(),
            Some("sess-1")
        );
        assert_eq!(sanitize_session_id(Some("")), None);
        assert_eq!(sanitize_session_id(Some("   ")), None);
        assert_eq!(sanitize_session_id(None), None);
    }

    #[test]
    fn notify_click_payload_omits_missing_id() {
        assert_eq!(notify_click_payload(None), serde_json::json!({}));
        assert_eq!(notify_click_payload(Some("")), serde_json::json!({}));
        assert_eq!(
            notify_click_payload(Some(" sess-9 ")),
            serde_json::json!({ "sessionId": "sess-9" })
        );
    }
}
