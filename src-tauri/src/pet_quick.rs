//! Pet quick bar — a small always-on-top prompt window opened from the desktop
//! pet, the tray, or a global hotkey. It lists recent chats, shows the
//! focused chat's state, and hands prompts to the main workbench over
//! `pet://quick-prompt` (the workbench owns sending; this window stays slim).
//!
//! Window-creating commands MUST be `async`: a sync Tauri command runs on the
//! main thread, and building a WebView2 window there deadlocks every later
//! IPC call (Connect, Stop and the window buttons all hang).

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const QUICK_WINDOW_LABEL: &str = "pet-quick";
const QUICK_W: f64 = 460.0;
const QUICK_H: f64 = 540.0;
const PREFS_FILE: &str = "pet_quick.json";
pub const DEFAULT_HOTKEY: &str = "Alt+Super+P";
const RECENT_LIMIT: usize = 40;
/// A pet click that lands right after the panel blurred is the same gesture
/// closing it (the click itself stole focus) — don't reopen.
const BLUR_REOPEN_GUARD_MS: i64 = 450;
static LAST_BLUR_HIDE_MS: AtomicI64 = AtomicI64::new(0);
static PET_FOLLOW_ATTACHED: AtomicBool = AtomicBool::new(false);

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Pure: whether a toggle right after a blur-hide should stay closed.
pub fn reopen_suppressed(last_blur_hide_ms: i64, now: i64) -> bool {
    last_blur_hide_ms > 0
        && now - last_blur_hide_ms >= 0
        && now - last_blur_hide_ms < BLUR_REOPEN_GUARD_MS
}

/// Actions the panel can ask the workbench to run on a chat.
pub fn valid_quick_action(kind: &str) -> bool {
    matches!(kind, "approve" | "deny" | "stop" | "open")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuickPrefs {
    /// Global accelerator; empty = disabled.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.into()
}

impl Default for QuickPrefs {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
        }
    }
}

fn prefs_path() -> std::path::PathBuf {
    crate::paths::app_data_root().join(PREFS_FILE)
}

pub fn load_quick_prefs() -> QuickPrefs {
    match std::fs::read_to_string(prefs_path()) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or_default(),
        _ => QuickPrefs::default(),
    }
}

fn save_quick_prefs(p: &QuickPrefs) -> Result<(), String> {
    let _ = crate::paths::ensure_app_dirs();
    let s = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    crate::store_lock::write_bytes_atomic(&prefs_path(), s.as_bytes())
}

/// Accelerator currently registered with the OS (so a change can unregister it).
static ACTIVE_HOTKEY: Mutex<Option<String>> = Mutex::new(None);

/// Pure: trim and collapse spaces around `+` ("alt + super + p" → "alt+super+p").
pub fn normalize_hotkey(raw: &str) -> String {
    raw.split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(desktop)]
fn register_hotkey(app: &AppHandle, accel: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    if let Ok(mut guard) = ACTIVE_HOTKEY.lock() {
        if let Some(prev) = guard.take() {
            let _ = gs.unregister(prev.as_str());
        }
        if accel.is_empty() {
            return Ok(());
        }
        gs.register(accel)
            .map_err(|e| format!("hotkey {accel}: {e}"))?;
        *guard = Some(accel.to_string());
    }
    Ok(())
}

#[cfg(not(desktop))]
fn register_hotkey(_app: &AppHandle, _accel: &str) -> Result<(), String> {
    Ok(())
}

/// Plugin with a handler that toggles the quick bar on key-down.
#[cfg(desktop)]
pub fn global_shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::{Builder, ShortcutState};
    Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                // Never build a webview on the main thread from an event
                // callback: WebView2 creation there deadlocks Host IPC.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = toggle_quick(&app);
                });
            }
        })
        .build()
}

/// Register the saved hotkey at startup (failure is logged, never fatal).
pub fn init_hotkey(app: &AppHandle) {
    let prefs = load_quick_prefs();
    let accel = normalize_hotkey(&prefs.hotkey);
    if let Err(e) = register_hotkey(app, &accel) {
        tracing::warn!("pet quick hotkey: {e}");
    }
}

/// Pure: place the bar above the pet when there is room, else below; clamp to work area.
pub fn quick_origin(
    pet: Option<(f64, f64, f64, f64)>,
    work: (f64, f64, f64, f64),
    w: f64,
    h: f64,
) -> (f64, f64) {
    let (wx, wy, ww, wh) = work;
    let (x, y) = match pet {
        Some((px, py, pw, ph)) => {
            let x = px + pw / 2.0 - w / 2.0;
            let above = py - h - 8.0;
            let y = if above >= wy { above } else { py + ph + 8.0 };
            (x, y)
        }
        None => (wx + (ww - w) / 2.0, wy + wh * 0.25),
    };
    let x = x.clamp(wx, (wx + ww - w).max(wx));
    let y = y.clamp(wy, (wy + wh - h).max(wy));
    (x, y)
}

fn place_near_pet(app: &AppHandle, win: &tauri::WebviewWindow) {
    let pet = app
        .get_webview_window(crate::pet_window::PET_WINDOW_LABEL)
        .filter(|p| p.is_visible().unwrap_or(false));
    // Multi-monitor: lay out on the pet's monitor (its own DPI), not ours.
    let mon = pet
        .as_ref()
        .and_then(|p| p.current_monitor().ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(mon) = mon else {
        return;
    };
    let scale = mon.scale_factor();
    let wa = mon.work_area();
    let work = (
        f64::from(wa.position.x) / scale,
        f64::from(wa.position.y) / scale,
        f64::from(wa.size.width) / scale,
        f64::from(wa.size.height) / scale,
    );
    let rect = pet.and_then(|p| {
        let pos = p.outer_position().ok()?;
        let size = p.outer_size().ok()?;
        Some((
            f64::from(pos.x) / scale,
            f64::from(pos.y) / scale,
            f64::from(size.width) / scale,
            f64::from(size.height) / scale,
        ))
    });
    let (x, y) = quick_origin(rect, work, QUICK_W, QUICK_H);
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    // Tell the panel which side the pet is on so it can grow from there.
    let from_below = rect.map(|(_, py, _, _)| py > y).unwrap_or(true);
    let _ = app.emit_to(
        QUICK_WINDOW_LABEL,
        "pet-quick://anchor",
        if from_below { "below" } else { "above" },
    );
}

/// Keep the panel glued to the pet while it is dragged (attached once).
fn attach_pet_follow(app: &AppHandle) {
    if PET_FOLLOW_ATTACHED.load(Ordering::SeqCst) {
        return;
    }
    let Some(pet) = app.get_webview_window(crate::pet_window::PET_WINDOW_LABEL) else {
        return;
    };
    PET_FOLLOW_ATTACHED.store(true, Ordering::SeqCst);
    let handle = app.clone();
    pet.on_window_event(move |ev| {
        if let tauri::WindowEvent::Moved(_) = ev {
            // Off the event callback: only a reposition, but never block it.
            let app = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(w) = app.get_webview_window(QUICK_WINDOW_LABEL) {
                    if w.is_visible().unwrap_or(false) {
                        place_near_pet(&app, &w);
                    }
                }
            });
        }
    });
}

fn ensure_quick(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        return Ok(w);
    }
    let win = WebviewWindowBuilder::new(
        app,
        QUICK_WINDOW_LABEL,
        WebviewUrl::App("index.html#/pet-quick".into()),
    )
    .title("Grok")
    .inner_size(QUICK_W, QUICK_H)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("pet quick window: {e}"))?;
    let handle = app.clone();
    win.on_window_event(move |ev| {
        // Spotlight-style: clicking elsewhere dismisses the bar.
        if let tauri::WindowEvent::Focused(false) = ev {
            if let Some(w) = handle.get_webview_window(QUICK_WINDOW_LABEL) {
                if w.is_visible().unwrap_or(false) {
                    LAST_BLUR_HIDE_MS.store(now_ms(), Ordering::SeqCst);
                    let _ = handle.emit_to(QUICK_WINDOW_LABEL, "pet-quick://hidden", ());
                }
                let _ = w.hide();
            }
        }
    });
    Ok(win)
}

pub fn show_quick(app: &AppHandle) -> Result<(), String> {
    let win = ensure_quick(app)?;
    attach_pet_follow(app);
    place_near_pet(app, &win);
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    let _ = app.emit_to(QUICK_WINDOW_LABEL, "pet-quick://shown", ());
    Ok(())
}

pub fn hide_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        let _ = w.hide();
    }
}

pub fn toggle_quick(app: &AppHandle) -> Result<(), String> {
    let up = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    if up {
        hide_quick(app);
        Ok(())
    } else if reopen_suppressed(LAST_BLUR_HIDE_MS.load(Ordering::SeqCst), now_ms()) {
        LAST_BLUR_HIDE_MS.store(0, Ordering::SeqCst);
        Ok(())
    } else {
        show_quick(app)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRecent {
    pub id: String,
    pub title: String,
    pub project: String,
    pub pinned: bool,
    pub updated_at: i64,
}

/// Pure: pinned first, then most recently updated; archived and scheduled dropped.
pub fn pick_recents(
    sessions: &[crate::store::SessionMeta],
    project_name: impl Fn(&Option<String>) -> String,
    limit: usize,
) -> Vec<QuickRecent> {
    let mut rows: Vec<&crate::store::SessionMeta> = sessions
        .iter()
        .filter(|s| !s.archived && !s.scheduled)
        .collect();
    rows.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.updated_at.cmp(&a.updated_at))
    });
    rows.into_iter()
        .take(limit)
        .map(|s| QuickRecent {
            id: s.id.clone(),
            title: s.title.trim().to_string(),
            project: project_name(&s.project_id),
            pinned: s.pinned,
            updated_at: s.updated_at.timestamp_millis(),
        })
        .collect()
}

#[tauri::command]
pub async fn pet_quick_recent() -> Vec<QuickRecent> {
    let sessions = crate::store::load_sessions_index();
    let projects = crate::store::load_projects();
    pick_recents(
        &sessions,
        |id| {
            id.as_ref()
                .and_then(|pid| projects.iter().find(|p| &p.id == pid))
                .map(|p| p.name.clone())
                .unwrap_or_default()
        },
        RECENT_LIMIT,
    )
}

#[tauri::command]
pub async fn pet_quick_show(app: AppHandle) -> Result<(), String> {
    show_quick(&app)
}

#[tauri::command]
pub async fn pet_quick_hide(app: AppHandle) {
    hide_quick(&app);
}

#[tauri::command]
pub async fn pet_quick_toggle(app: AppHandle) -> Result<(), String> {
    toggle_quick(&app)
}

/// Hand a prompt to the workbench. `session_id: None` = new chat.
/// `open_main` also raises the workbench on that chat.
#[tauri::command]
pub async fn pet_quick_send(
    app: AppHandle,
    session_id: Option<String>,
    text: String,
    open_main: bool,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty prompt".into());
    }
    let sid = session_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if open_main {
        crate::tray::show_main_window(&app);
    }
    app.emit_to(
        "main",
        "pet://quick-prompt",
        serde_json::json!({ "sessionId": sid, "text": text }),
    )
    .map_err(|e| e.to_string())?;
    hide_quick(&app);
    Ok(())
}

/// Approve / deny / stop / open a chat from the panel. The workbench owns the
/// permission + stop state, so this only forwards (`pet://quick-action`).
#[tauri::command]
pub async fn pet_quick_action(
    app: AppHandle,
    kind: String,
    session_id: String,
) -> Result<(), String> {
    let kind = kind.trim().to_string();
    let sid = session_id.trim().to_string();
    if !valid_quick_action(&kind) || sid.is_empty() {
        return Err("invalid quick action".into());
    }
    if kind == "open" {
        crate::tray::show_main_window(&app);
    }
    app.emit_to(
        "main",
        "pet://quick-action",
        serde_json::json!({ "kind": kind, "sessionId": sid }),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pet_quick_hotkey_get() -> String {
    load_quick_prefs().hotkey
}

/// Save + re-register. Returns the stored accelerator; an invalid one is
/// rejected and the previous hotkey stays registered.
#[tauri::command]
pub async fn pet_quick_hotkey_set(app: AppHandle, hotkey: String) -> Result<String, String> {
    let accel = normalize_hotkey(&hotkey);
    let prev = normalize_hotkey(&load_quick_prefs().hotkey);
    if let Err(e) = register_hotkey(&app, &accel) {
        let _ = register_hotkey(&app, &prev);
        return Err(e);
    }
    save_quick_prefs(&QuickPrefs {
        hotkey: accel.clone(),
    })?;
    Ok(accel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blur_guard_only_suppresses_the_closing_click() {
        assert!(!reopen_suppressed(0, 10_000));
        assert!(reopen_suppressed(10_000, 10_200));
        assert!(!reopen_suppressed(10_000, 10_000 + BLUR_REOPEN_GUARD_MS));
        assert!(!reopen_suppressed(10_000, 9_000));
    }

    #[test]
    fn quick_actions_are_allowlisted() {
        for k in ["approve", "deny", "stop", "open"] {
            assert!(valid_quick_action(k));
        }
        assert!(!valid_quick_action("rm -rf"));
        assert!(!valid_quick_action(""));
    }

    /// Guard: every command that creates/shows/moves the window must be async
    /// (a sync command runs on the main thread → WebView2 deadlock).
    #[test]
    fn window_commands_stay_async() {
        let src = include_str!("pet_quick.rs");
        for name in [
            "pet_quick_show",
            "pet_quick_hide",
            "pet_quick_toggle",
            "pet_quick_send",
            "pet_quick_action",
            "pet_quick_hotkey_set",
        ] {
            assert!(
                src.contains(&format!("pub async fn {name}(")),
                "{name} must be async"
            );
        }
    }

    #[test]
    fn normalizes_hotkey_spacing() {
        assert_eq!(normalize_hotkey(" Alt + Super +P "), "Alt+Super+P");
        assert_eq!(normalize_hotkey(""), "");
        assert_eq!(normalize_hotkey(" + "), "");
    }

    #[test]
    fn default_prefs_use_alt_win_p() {
        let p: QuickPrefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn origin_prefers_above_pet_and_clamps() {
        let work = (0.0, 0.0, 1920.0, 1040.0);
        let (x, y) = quick_origin(Some((900.0, 700.0, 200.0, 200.0)), work, 440.0, 340.0);
        assert_eq!((x, y), (780.0, 352.0));
        // Pet at the top → bar goes below.
        let (_, y) = quick_origin(Some((900.0, 10.0, 200.0, 200.0)), work, 440.0, 340.0);
        assert_eq!(y, 218.0);
        // Pet hugging the right edge → clamp inside.
        let (x, _) = quick_origin(Some((1850.0, 700.0, 200.0, 200.0)), work, 440.0, 340.0);
        assert_eq!(x, 1480.0);
        // No pet → centered upper third.
        let (x, y) = quick_origin(None, work, 440.0, 340.0);
        assert_eq!((x, y), (740.0, 260.0));
    }
}
