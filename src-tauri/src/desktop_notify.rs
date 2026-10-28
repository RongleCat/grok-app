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

/// Packaged-macOS NS notification id. `tauri dev` is a bare binary and skips
/// this path. Windows WinRT toasts use `app.config().identifier` so `pnpm dev`
/// matches the overlay (`com.grokapp.desktop.dev`).
#[cfg(target_os = "macos")]
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
    // `Some(true)` when Settings "Play a sound with notifications" is on.
    // Missing / false stays silent (the pref defaults off).
    sound: Option<bool>,
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
    let sound = notify_sound_enabled(sound);

    #[cfg(target_os = "macos")]
    {
        match show_macos(&app, &title, &body, session_id.as_deref(), sound) {
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
        match show_via_winrt(&app, &title, &body, session_id.as_deref(), sound) {
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
        match show_via_notify_rust(&app, &title, &body, session_id.as_deref(), sound) {
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
    sound: bool,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    let app_click = app.clone();
    let sid = session_id.map(|s| s.to_string());
    let mut toast = Toast::new(&app.config().identifier).title(title);
    if !body.is_empty() {
        toast = toast.text1(body);
    }
    // Empty `<audio>` is the default toast ding. `sound(None)` is `silent="true"`.
    if !sound {
        toast = toast.sound(None);
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
    sound: bool,
) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(title);
    if !body.is_empty() {
        n.body(body);
    }
    if sound {
        n.sound_name("message-new-instant");
    } else {
        n.hint(notify_rust::Hint::SuppressSound(true));
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
    sound: bool,
) -> Result<&'static str, String> {
    // Host beep is the audible path. UNNotificationSound.soundNamed only
    // looks inside the app bundle, and AppleScript `sound name "default"`
    // is not a file under /System/Library/Sounds (NSSound(named:) is nil).
    // A second payload sound on top of the beep would double-play.
    let host_beep = sound && schedule_soft_beep(app);
    let payload_sound = sound && !host_beep;

    if is_real_app_bundle() {
        // Packaged app: modern UN first (real Grok identity + System Settings entry).
        match show_via_usernotifications(title, body, payload_sound) {
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
        match show_via_nsusernotification(title, body, payload_sound) {
            Ok(()) => return Ok("nsusernotification"),
            Err(e) => {
                tracing::debug!(
                    target: "desktop_notify",
                    error = %e,
                    "NSUserNotification path failed"
                );
            }
        }
        return show_via_osascript(title, body, payload_sound).map(|_| "osascript");
    }

    // Bare `tauri dev` binary on Sequoia:
    // - UN → process crash (never call)
    // - NS / notify-rust → often Ok with zero visible delivery
    // - osascript → lands in Notification Center under Script Editor (verified)
    show_via_osascript(title, body, payload_sound).map(|_| "osascript")
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
    sound: bool,
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
    // Only when the host beep could not be scheduled. `default_sound()` is
    // the crate's best effort; the normal path plays the WAV via NSSound.
    if sound {
        n = n.default_sound();
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
fn show_via_nsusernotification(title: &str, body: &str, sound: bool) -> Result<(), String> {
    pin_ns_application()?;
    if sound {
        let mut opts = mac_notification_sys::Notification::new();
        opts.default_sound();
        mac_notification_sys::send_notification(title, None, body, Some(&opts))
            .map_err(|e| e.to_string())?;
    } else {
        mac_notification_sys::send_notification(title, None, body, None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_via_osascript(title: &str, body: &str, sound: bool) -> Result<(), String> {
    use std::process::Command;

    let script = osascript_notification_script(title, body, sound);
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

/// Missing and `false` stay silent. The Settings pref defaults off.
fn notify_sound_enabled(sound: Option<bool>) -> bool {
    matches!(sound, Some(true))
}

#[cfg(any(target_os = "macos", test))]
/// AppleScript string literal body: no controls, capped, quotes escaped.
fn apple_script_literal(s: &str) -> String {
    let flat: String = s
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated: String = flat.chars().take(200).collect();
    truncated.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(any(target_os = "macos", test))]
/// Fallback sound for `osascript` only. `"default"` is not a system sound
/// (`NSSound(named: "default")` is nil). `Tink.aiff` is in
/// `/System/Library/Sounds`.
const OSASCRIPT_SOUND_NAME: &str = "Tink";

#[cfg(any(target_os = "macos", test))]
/// `display notification` script. Sound clause is omitted when `sound` is false
/// so a disabled pref does not ding via Script Editor.
fn osascript_notification_script(title: &str, body: &str, sound: bool) -> String {
    let title = apple_script_literal(title);
    let body = apple_script_literal(body);
    if sound {
        format!(
            "display notification \"{body}\" with title \"{title}\" sound name \"{OSASCRIPT_SOUND_NAME}\""
        )
    } else {
        format!("display notification \"{body}\" with title \"{title}\"")
    }
}

#[cfg(any(target_os = "macos", test))]
/// 880 Hz, 120 ms, 16-bit mono WAV. Same short beep the Settings copy describes.
/// Sample rate 22050 × 0.12 s = 2646 frames.
const BEEP_SAMPLE_RATE: u32 = 22_050;
#[cfg(any(target_os = "macos", test))]
const BEEP_SAMPLE_COUNT: usize = 2_646;

#[cfg(any(target_os = "macos", test))]
fn soft_notify_beep_wav() -> Vec<u8> {
    let data_len = (BEEP_SAMPLE_COUNT * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&BEEP_SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(BEEP_SAMPLE_RATE * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&2u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());

    let attack = (BEEP_SAMPLE_COUNT / 15).max(1);
    for i in 0..BEEP_SAMPLE_COUNT {
        let t = i as f32 / BEEP_SAMPLE_RATE as f32;
        let env = if i < attack {
            i as f32 / attack as f32
        } else {
            let tail = BEEP_SAMPLE_COUNT - i;
            (tail as f32 / (BEEP_SAMPLE_COUNT - attack) as f32).clamp(0.0, 1.0)
        };
        let sample = (t * 880.0 * std::f32::consts::TAU).sin() * 0.25 * env;
        let pcm = (sample.clamp(-1.0, 1.0) * 32_767.0).round() as i16;
        wav.extend_from_slice(&pcm.to_le_bytes());
    }
    wav
}

/// Queue the beep on the main thread. Returns false only when it could not be
/// queued and the inline attempt also failed — callers may then attach a
/// platform payload sound instead of staying silent.
#[cfg(target_os = "macos")]
fn schedule_soft_beep(app: &AppHandle) -> bool {
    match app.run_on_main_thread(|| {
        play_soft_beep_now();
    }) {
        Ok(()) => true,
        Err(e) => {
            tracing::debug!(
                target: "desktop_notify",
                error = %e,
                "notify beep main-thread schedule failed"
            );
            play_soft_beep_now()
        }
    }
}

/// One NSSound kept alive so `play` (async) is not released mid-beep.
/// Replaced on the next beep. Main-thread only, guarded by the mutex.
#[cfg(target_os = "macos")]
struct HeldSound(*mut objc2::runtime::AnyObject);

#[cfg(target_os = "macos")]
// SAFETY: the pointer is an NSSound created and released only while `HELD_BEEP`
// is locked. Callers schedule that work on the main thread.
unsafe impl Send for HeldSound {}

#[cfg(target_os = "macos")]
static HELD_BEEP: parking_lot::Mutex<Option<HeldSound>> = parking_lot::Mutex::new(None);

#[cfg(target_os = "macos")]
fn play_soft_beep_now() -> bool {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};

    let wav = soft_notify_beep_wav();
    // SAFETY: NSData copies the bytes. NSSound `initWithData:` returns +1 or
    // nil (and consumes the alloc). `play` is asynchronous; we keep the +1
    // until the next beep so the object outlives playback.
    unsafe {
        let data: *mut AnyObject = msg_send![
            class!(NSData),
            dataWithBytes: wav.as_ptr(),
            length: wav.len()
        ];
        if data.is_null() {
            return false;
        }
        let alloc: *mut AnyObject = msg_send![class!(NSSound), alloc];
        if alloc.is_null() {
            return false;
        }
        let sound: *mut AnyObject = msg_send![alloc, initWithData: data];
        if sound.is_null() {
            return false;
        }
        let played: Bool = msg_send![sound, play];
        if !played.as_bool() {
            let _: () = msg_send![sound, release];
            return false;
        }
        let mut slot = HELD_BEEP.lock();
        if let Some(prev) = slot.replace(HeldSound(sound)) {
            let _: () = msg_send![prev.0, release];
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{
        notify_click_payload, notify_sound_enabled, osascript_notification_script,
        sanitize_session_id, soft_notify_beep_wav, BEEP_SAMPLE_COUNT,
    };

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

    #[test]
    fn notify_sound_enabled_defaults_off() {
        assert!(!notify_sound_enabled(None));
        assert!(!notify_sound_enabled(Some(false)));
        assert!(notify_sound_enabled(Some(true)));
    }

    #[test]
    fn osascript_script_adds_tink_only_when_sound_is_on() {
        let on = osascript_notification_script("Hello", "Body text", true);
        assert!(on.contains("sound name \"Tink\""));
        assert!(on.contains("with title \"Hello\""));
        assert!(on.contains("display notification \"Body text\""));
        assert!(!on.contains("default"));

        let off = osascript_notification_script("Hello", "Body text", false);
        assert!(!off.contains("sound name"));
        assert!(off.contains("with title \"Hello\""));
    }

    #[test]
    fn osascript_script_escapes_quotes_and_strips_controls() {
        let script = osascript_notification_script("a\"b\\c", "line\n\t two", false);
        assert!(script.contains("a\\\"b\\\\c"));
        assert!(script.contains("line two"));
        assert!(!script.contains('\n'));
    }

    #[test]
    fn soft_beep_wav_is_short_pcm() {
        let wav = soft_notify_beep_wav();
        assert!(wav.starts_with(b"RIFF"));
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
        let data_len = u32::from_le_bytes(wav[40..44].try_into().expect("len"));
        assert_eq!(wav.len(), 44 + data_len as usize);
        assert_eq!(data_len as usize, BEEP_SAMPLE_COUNT * 2);
        let pcm = &wav[44..];
        assert!(pcm.chunks(2).any(|frame| frame != [0, 0]));
    }
}
