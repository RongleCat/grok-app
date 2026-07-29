//! System tray / menu-bar icon + ChatGPT / Codex-style menu.
//!
//! **Tray / menu-bar icon** → `icons/tray-icon.png` (from `docs/svg/logo.svg`).  
//! **App dock / .exe icons** → generated from `icons/icon (1).png` (do not mix).

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
            .unwrap_or_else(|| String::new())
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
        tr.quit,
        true,
        None::<&str>,
    )?);

    builder.build()
}

/// Format quota refresh ISO → local `MM-DD HH:mm` (same as in-app user menu).
fn format_reset_mm_dd_hm(iso: &str) -> Option<String> {
    let s = iso.trim();
    if s.is_empty() {
        return None;
    }
    // Prefer RFC3339 (what BillingSnapshot writes).
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(
            dt.with_timezone(&chrono::Local)
                .format("%m-%d %H:%M")
                .to_string(),
        );
    }
    // Fallback: UTC Z without offset, or naive local.
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
        let dt = ndt.and_utc().with_timezone(&chrono::Local);
        return Some(dt.format("%m-%d %H:%M").to_string());
    }
    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%SZ") {
        let dt = ndt.and_utc().with_timezone(&chrono::Local);
        return Some(dt.format("%m-%d %H:%M").to_string());
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
                .and_then(format_reset_mm_dd_hm);
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

/// Hide main window to tray only: no Dock (macOS) / no taskbar button (Windows).
pub fn hide_to_tray(app: &AppHandle) {
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
    // macOS: hide Dock icon (menu-bar app while window is closed).
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_dock_visibility(false);
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
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
        "quit" => app.exit(0),
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
        .on_menu_event(|app, event| handle_menu_event(app, event))
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
