//! Standalone appearance editor — OS window matching main-window chrome.
//!
//! macOS: Overlay title bar + hidden title + traffic lights.
//! Windows / Linux: frameless, self-drawn caption buttons in the WebView.

#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::os_theme;
use crate::store;
use crate::tray_i18n;

pub const THEME_EDITOR_WINDOW_LABEL: &str = "theme-editor";

const EDITOR_WIDTH: f64 = 840.0;
const EDITOR_HEIGHT: f64 = 860.0;
const EDITOR_MIN_WIDTH: f64 = 560.0;
const EDITOR_MIN_HEIGHT: f64 = 480.0;

fn resolve_boot_theme(pref: &str) -> &'static str {
    match pref.trim().to_ascii_lowercase().as_str() {
        "light" => "light",
        "dark" => "dark",
        _ => {
            if os_theme::os_prefers_dark() {
                "dark"
            } else {
                "light"
            }
        }
    }
}

fn boot_theme_script() -> String {
    let boot_settings = store::load_settings();
    let boot_theme = resolve_boot_theme(&boot_settings.theme);
    let boot_locale = tray_i18n::Locale::parse(&boot_settings.locale);
    let boot_locale_tag = boot_locale.as_tag();
    let boot_os_lang = tray_i18n::detect_os_lang_tag();
    let boot_html_lang = boot_locale.html_lang();
    format!(
        r#"(function(){{try{{Object.defineProperty(window,"__GROK_BOOT_THEME__",{{value:{theme:?},writable:false,configurable:false}});Object.defineProperty(window,"__GROK_BOOT_LOCALE__",{{value:{locale:?},writable:false,configurable:false}});Object.defineProperty(window,"__GROK_BOOT_OS_LANG__",{{value:{os_lang:?},writable:false,configurable:false}});var d=document.documentElement;if(d){{d.setAttribute("data-theme",{theme:?});d.setAttribute("lang",{html_lang:?});d.setAttribute("data-theme-editor-shell","1");}}}}catch(e){{}}}})();"#,
        theme = boot_theme,
        locale = boot_locale_tag,
        os_lang = boot_os_lang,
        html_lang = boot_html_lang
    )
}

fn place_over_main_right(app: &AppHandle, win: &WebviewWindow) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(pos) = main.outer_position() else {
        return;
    };
    let Ok(size) = main.outer_size() else {
        return;
    };
    let Ok(ed) = win.outer_size() else {
        return;
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let inset = (16.0 * scale).round() as i32;
    let x = pos.x + size.width as i32 - ed.width as i32 - inset;
    let y = pos.y + inset;
    let _ = win.set_position(tauri::PhysicalPosition::new(x.max(pos.x), y.max(pos.y)));
}

/// Open or focus the appearance editor as a real OS window.
#[tauri::command]
pub async fn open_theme_editor_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(THEME_EDITOR_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let script = boot_theme_script();
    let mut builder = WebviewWindowBuilder::new(
        &app,
        THEME_EDITOR_WINDOW_LABEL,
        WebviewUrl::App("index.html#/theme-editor".into()),
    )
    .title("Grok")
    .inner_size(EDITOR_WIDTH, EDITOR_HEIGHT)
    .min_inner_size(EDITOR_MIN_WIDTH, EDITOR_MIN_HEIGHT)
    .resizable(true)
    .visible(true)
    .focused(true)
    .accept_first_mouse(true)
    .initialization_script(&script);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .transparent(true)
            .shadow(true)
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(LogicalPosition::new(16.0, 22.0));
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false).transparent(false).shadow(true);
    }

    let window = builder
        .build()
        .map_err(|e| format!("theme editor window: {e}"))?;
    #[cfg(windows)]
    crate::win_shell::attach_webview_keyboard_focus(&window);
    place_over_main_right(&app, &window);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_label_is_stable() {
        assert_eq!(THEME_EDITOR_WINDOW_LABEL, "theme-editor");
    }

    #[test]
    fn boot_theme_script_marks_the_editor_shell() {
        let s = boot_theme_script();
        assert!(s.contains("data-theme-editor-shell"));
        assert!(s.contains("__GROK_BOOT_THEME__"));
        assert!(s.contains("__GROK_BOOT_LOCALE__"));
        assert!(s.contains("__GROK_BOOT_OS_LANG__"));
    }
}
