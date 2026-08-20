//! System tray / menu-bar icon + ChatGPT / Codex-style menu.
//!
//! **Tray / menu-bar icon** → `icons/tray-icon.png` (from `docs/svg/logo.svg`).
//! **App dock / .exe icons** → generated from `icons/icon (1).png` (do not mix).

#![allow(dead_code)] // residual-clippy: busy_tooltip helper
use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

use crate::store;
use crate::tray_i18n::{self, TrayStrings};

const TRAY_ID: &str = "grok-main-tray";

/// Build ChatGPT-style tray menu: Recent · More · Usage · New Chat · Open · Quit.
/// Labels follow `settings.locale` (zh / en).
pub fn build_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let tr: &TrayStrings = tray_i18n::t();
    let sessions = store::load_sessions_index();
    let projects = store::load_projects();
    let project_name = |id: &Option<String>| -> String {
        id.as_ref()
            .and_then(|pid| projects.iter().find(|p| &p.id == pid))
            .map(|p| p.name.clone())
            .unwrap_or_default()
    };

    let mut builder = MenuBuilder::new(app);

    // Recent header (disabled label)
    builder = builder.item(&MenuItem::with_id(
        app,
        "recent_header",
        tr.recent,
        false,
        None::<&str>,
    )?);

    let mut count = 0usize;
    for s in sessions.iter().filter(|s| !s.archived) {
        if count >= 8 {
            break;
        }
        let title = if s.title.trim().is_empty() {
            tr.untitled.to_string()
        } else {
            s.title.clone()
        };
        let proj = project_name(&s.project_id);
        let label = if proj.is_empty() {
            title
        } else {
            // ChatGPT shows title + project subtitle; native menu uses " · "
            format!("{title}  ·  {proj}")
        };
        let id = format!("session:{}", s.id);
        builder = builder.item(&MenuItem::with_id(app, &id, &label, true, None::<&str>)?);
        count += 1;
    }
    if count == 0 {
        builder = builder.item(&MenuItem::with_id(
            app,
            "recent_empty",
            tr.no_recent,
            false,
            None::<&str>,
        )?);
    }

    builder = builder.separator();

    // More ▸ Settings / Doctor / Account
    let more = SubmenuBuilder::new(app, tr.more)
        .id("more")
        .item(&MenuItem::with_id(
            app,
            "more_settings",
            tr.settings,
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app,
            "more_doctor",
            tr.doctor,
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app,
            "more_account",
            tr.account,
            true,
            None::<&str>,
        )?)
        .build()?;
    builder = builder.item(&more);

    // Usage status line (disabled, like ChatGPT "1 week 96%")
    let usage_label = usage_status_label(tr);
    builder = builder.item(&MenuItem::with_id(
        app,
        "usage",
        &usage_label,
        false,
        None::<&str>,
    )?);

    builder = builder.separator();
    builder = builder.item(&MenuItem::with_id(
        app,
        "new_chat",
        tr.new_chat,
        true,
        None::<&str>,
    )?);
    builder = builder.item(&MenuItem::with_id(
        app,
        "open_app",
        tr.open_app,
        true,
        None::<&str>,
    )?);
    builder = builder.separator();
    builder = builder.item(&MenuItem::with_id(
        app,
        "quit",
        &quit_tray_label(tr.quit),
        true,
        None::<&str>,
    )?);

    builder.build()
}

/// Tray Quit label plus a Ctrl+Q hint on Windows/Linux.
/// macOS keeps the bare label: ⌘Q is the quit chord (and still immediate).
/// Inline on purpose: a `\t` accelerator column makes the whole tray menu wider.
fn quit_tray_label(quit: &str) -> String {
    quit_tray_label_for(quit, cfg!(target_os = "macos"))
}

fn quit_tray_label_for(quit: &str, macos: bool) -> String {
    if macos {
        quit.to_string()
    } else {
        format!("{quit} (Ctrl+Q)")
    }
}

/// Format quota refresh ISO → local short date and clock, in `fmt`.
///
/// `fmt` comes from the active locale's `TrayStrings`, so this stays the same
/// instant the in-app user menu shows, written the way that language writes it.
fn format_reset_time(iso: &str, fmt: &str) -> Option<String> {
    let s = iso.trim();
    if s.is_empty() {
        return None;
    }
    // Prefer RFC3339 (what BillingSnapshot writes).
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&chrono::Local).format(fmt).to_string());
    }
    // Fallback: UTC Z without offset, or naive local.
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
        let dt = ndt.and_utc().with_timezone(&chrono::Local);
        return Some(dt.format(fmt).to_string());
    }
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ") {
        let dt = ndt.and_utc().with_timezone(&chrono::Local);
        return Some(dt.format(fmt).to_string());
    }
    None
}

fn usage_status_label(tr: &TrayStrings) -> String {
    if let Ok(cache) =
        std::fs::read_to_string(crate::paths::app_data_root().join("account_billing_cache.json"))
    {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cache) {
            let rem = v
                .pointer("/remainingPercent")
                .or_else(|| v.pointer("/remaining_percent"))
                .and_then(|x| x.as_f64())
                .or_else(|| {
                    v.pointer("/creditUsagePercent")
                        .or_else(|| v.pointer("/credit_usage_percent"))
                        .and_then(|x| x.as_f64())
                        .map(|u| (100.0_f64 - u).clamp(0.0, 100.0))
                })
                .or_else(|| {
                    v.pointer("/usedPercent")
                        .or_else(|| v.pointer("/used_percent"))
                        .and_then(|x| x.as_f64())
                        .map(|u| (100.0_f64 - u).clamp(0.0, 100.0))
                });
            let reset = v
                .pointer("/resetsAt")
                .or_else(|| v.pointer("/resets_at"))
                .and_then(|x| x.as_str())
                .and_then(|s| format_reset_time(s, tr.reset_time_fmt));
            if let Some(r) = rem {
                return match reset.as_deref() {
                    Some(t) => tray_i18n::format_usage(tr.usage_with_reset, Some(r), Some(t)),
                    None => tray_i18n::format_usage(tr.usage_pct, Some(r), None),
                };
            }
        }
    }
    tr.usage_unknown.to_string()
}

/// Hide the main workbench without quitting. Dock stays so click-to-reopen
/// still works (the pet overlay is skip-taskbar and must not replace the Dock).
pub fn hide_to_tray(app: &AppHandle) {
    hide_to_tray_inner(app, false);
}

/// Headless launch (`--start-in-tray` / fire-due): hide Dock + become Accessory.
pub fn hide_to_tray_accessory(app: &AppHandle) {
    hide_to_tray_inner(app, true);
}

fn hide_to_tray_inner(app: &AppHandle, hide_dock: bool) {
    // Persist geometry before hide so force-kill while tray-resident still restores
    // the last size/position on next launch (plugin also saves on process Exit;
    // resize is additionally debounced to disk from lib.rs window events).
    {
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        let flags = StateFlags::SIZE
            | StateFlags::POSITION
            | StateFlags::MAXIMIZED
            | StateFlags::FULLSCREEN;
        if let Err(e) = app.save_window_state(flags) {
            tracing::debug!(error = %e, "window-state save on hide-to-tray failed");
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        // Windows: TOOLWINDOW + DeleteTab (see win_shell) so reopen can fully
        // restore Show Desktop significance. Linux: Tauri skip_taskbar only.
        #[cfg(windows)]
        {
            crate::win_shell::set_main_window_skip_taskbar(&w, true);
        }
        #[cfg(all(not(target_os = "macos"), not(windows)))]
        {
            let _ = w.set_skip_taskbar(true);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if hide_dock {
            let _ = app.set_dock_visibility(false);
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        } else {
            // Closing the window used to drop the Dock icon (Accessory). Keep
            // Regular + visible so Dock click can show_main_window again.
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let _ = app.set_dock_visibility(true);
        }
    }
}

/// Show and focus the main workbench window (tray Open / dock reopen / after hide-to-tray).
pub fn show_main_window(app: &AppHandle) {
    // Restore Dock / taskbar presence before showing.
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = app.set_dock_visibility(true);
    }
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(windows)]
        {
            // Restore APPWINDOW / clear TOOLWINDOW / re-AddTab before show so
            // Explorer sees a normal app window (Show Desktop when alone).
            crate::win_shell::set_main_window_skip_taskbar(&w, false);
        }
        #[cfg(all(not(target_os = "macos"), not(windows)))]
        {
            let _ = w.set_skip_taskbar(false);
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        #[cfg(windows)]
        {
            // After show/focus, re-assert styles + taskbar tab once more.
            crate::win_shell::ensure_main_window_shell_integration(&w);
        }
    }
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        // Real exit: show the window so the in-app busy confirm can render, then
        // let the frontend decide (same event as window close when not close-to-tray).
        // Arm host failsafe so a wedged FE cannot trap Quit forever.
        "quit" => {
            show_main_window(app);
            let _ = app.emit("app://close-requested", ());
            crate::pending_quit::schedule_pending_quit(app);
        }
        "open_app" => show_main_window(app),
        "new_chat" => {
            show_main_window(app);
            let _ = app.emit("tray://new-chat", ());
        }
        "more_settings" => {
            show_main_window(app);
            // No section → frontend restores last settings route (or general).
            let _ = app.emit("tray://open-settings", serde_json::json!({}));
        }
        "more_doctor" => {
            show_main_window(app);
            let _ = app.emit("tray://open-doctor", ());
        }
        "more_account" => {
            show_main_window(app);
            let _ = app.emit(
                "tray://open-settings",
                serde_json::json!({ "section": "account" }),
            );
        }
        other if other.starts_with("session:") => {
            let sid = other.trim_start_matches("session:");
            show_main_window(app);
            let _ = app.emit(
                "tray://open-session",
                serde_json::json!({ "sessionId": sid }),
            );
        }
        _ => {}
    }
}

fn load_tray_icon() -> Result<Image<'static>, String> {
    // Embedded at compile time — logo.svg pipeline only (never app icon.png).
    // tray-icon on macOS displays at 18pt height; embed 36px (@2x) so retina is sharp.
    // Windows notification area: 32px monochrome.
    #[cfg(target_os = "macos")]
    let bytes: &[u8] = include_bytes!("../icons/tray-icon.png"); // 36×36
    #[cfg(not(target_os = "macos"))]
    let bytes: &[u8] = include_bytes!("../icons/tray-32.png");
    Image::from_bytes(bytes).map_err(|e| format!("tray icon decode: {e}"))
}

/// Create menu-bar / system tray at startup.
pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let menu = build_menu(app).map_err(|e| e.to_string())?;
    let icon = load_tray_icon()?;

    // macOS menu-bar: left-click opens menu (status-item habit).
    // Windows tray: left-click shows window; right-click opens menu.
    #[cfg(target_os = "macos")]
    let show_menu_on_left = true;
    #[cfg(not(target_os = "macos"))]
    let show_menu_on_left = false;

    let tooltip = tray_i18n::t().tooltip;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(tooltip)
        .show_menu_on_left_click(show_menu_on_left)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            match event {
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    show_main_window(tray.app_handle());
                }
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    // Windows / Linux: left-click shows the workbench.
                    #[cfg(not(target_os = "macos"))]
                    {
                        show_main_window(tray.app_handle());
                    }
                    let _ = MouseButtonState::Up;
                }
                _ => {}
            }
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    let tray = builder.build(app).map_err(|e| e.to_string())?;
    app.manage(Mutex::new(tray));
    Ok(())
}

/// Rebuild recent list / usage after sessions or account change.
pub fn refresh_menu(app: &AppHandle) -> Result<(), String> {
    let menu = build_menu(app).map_err(|e| e.to_string())?;
    if let Some(tray) = app.try_state::<Mutex<tauri::tray::TrayIcon>>() {
        if let Ok(t) = tray.lock() {
            t.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn tray_refresh(app: AppHandle) -> Result<(), String> {
    refresh_menu(&app)
}

/// Pure: dock badge count value. `0` → clear (`None`).
pub fn badge_count_value(count: u32) -> Option<i64> {
    if count == 0 {
        None
    } else {
        Some(i64::from(count))
    }
}

/// Pure: macOS dock badge label text. `0` → clear (`None`).
pub fn badge_label_value(count: u32) -> Option<String> {
    if count == 0 {
        None
    } else {
        Some(count.to_string())
    }
}

/// Pure: tray tooltip with optional busy count suffix.
/// `0` restores the base product tooltip only.
pub fn busy_tooltip(base: &str, count: u32) -> String {
    if count == 0 {
        base.to_string()
    } else {
        format!("{base} · {count}")
    }
}

/// Show a count on the dock badge (macOS) and/or tray chrome.
/// Frontend product passes unread session count (after background turn end).
///
/// - **macOS Dock**: `set_badge_label` (+ count) on the main window. No-op while
///   the app is Accessory / dock-hidden (close-to-tray) — tray chrome still updates.
/// - **macOS menu-bar tray**: tooltip `Grok · N` and a numeric title next to the icon.
/// - **Other platforms**: dock-like badge when supported + tray tooltip.
/// - Count `0` clears the badge / restores default tooltip / clears tray title.
/// - Fail-closed: missing tray/window errors are logged, never panic.
pub fn set_busy_count(app: &AppHandle, count: u32) {
    let base = tray_i18n::t().tooltip;
    let tip = busy_tooltip(base, count);

    #[cfg(target_os = "macos")]
    {
        if let Some(w) = app.get_webview_window("main") {
            if let Err(e) = w.set_badge_count(badge_count_value(count)) {
                tracing::debug!(error = %e, count, "set_badge_count failed");
            }
            if let Err(e) = w.set_badge_label(badge_label_value(count)) {
                tracing::debug!(error = %e, count, "set_badge_label failed");
            }
        } else {
            tracing::debug!(count, "set_busy_count: main window missing");
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Linux may also support dock-like badge count via libunity; best-effort.
        if let Some(w) = app.get_webview_window("main") {
            if let Err(e) = w.set_badge_count(badge_count_value(count)) {
                tracing::debug!(error = %e, count, "set_badge_count failed");
            }
        }
    }

    // Tray tooltip (all platforms) + macOS menu-bar numeric title so the count
    // is visible even when the Dock icon is hidden (close-to-tray / Accessory).
    if let Some(tray) = app.try_state::<Mutex<tauri::tray::TrayIcon>>() {
        if let Ok(t) = tray.lock() {
            if let Err(e) = t.set_tooltip(Some(tip.as_str())) {
                tracing::debug!(error = %e, "tray set_tooltip failed");
            }
            #[cfg(target_os = "macos")]
            {
                let title = if count == 0 {
                    None
                } else {
                    Some(count.to_string())
                };
                if let Err(e) = t.set_title(title.as_deref()) {
                    tracing::debug!(error = %e, "tray set_title failed");
                }
            }
        }
    } else {
        tracing::debug!("set_busy_count: tray state missing");
    }
}

/// Frontend → host: update dock/tray badge count (product: unread sessions).
#[tauri::command]
pub fn tray_set_busy_count(app: AppHandle, count: u32) -> Result<(), String> {
    set_busy_count(&app, count);
    Ok(())
}

#[cfg(test)]
mod badge_tests {
    use super::*;

    #[test]
    fn badge_count_clears_at_zero() {
        assert_eq!(badge_count_value(0), None);
        assert_eq!(badge_count_value(1), Some(1));
        assert_eq!(badge_count_value(12), Some(12));
    }

    #[test]
    fn badge_label_is_decimal_or_clear() {
        assert_eq!(badge_label_value(0), None);
        assert_eq!(badge_label_value(3).as_deref(), Some("3"));
    }

    #[test]
    fn busy_tooltip_suffix() {
        assert_eq!(busy_tooltip("Grok", 0), "Grok");
        assert_eq!(busy_tooltip("Grok", 2), "Grok · 2");
    }

    #[test]
    fn quit_label_shows_ctrl_q_without_owning_the_text() {
        assert_eq!(
            quit_tray_label_for("Quit Grok", false),
            "Quit Grok (Ctrl+Q)"
        );
        assert_eq!(
            quit_tray_label_for("退出 Grok", false),
            "退出 Grok (Ctrl+Q)"
        );
        assert_eq!(quit_tray_label_for("Quit Grok", true), "Quit Grok");
        assert_eq!(quit_tray_label_for("退出 Grok", true), "退出 Grok");
    }
}
