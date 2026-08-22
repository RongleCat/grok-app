//! App menu bar — replaces Tauri's default Close Window (⌘W / Ctrl+W) with a
//! custom item so the frontend can close Side Workbench tabs first.
//!
//! Why: `PredefinedMenuItem::close_window` is wired by the OS menu and fires
//! `CloseRequested` without giving the WebView a chance to `preventDefault`.
//! File preview open + ⌘W was hiding/quitting the whole window.

use tauri::{
    menu::{
        AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle, Emitter, Manager, WebviewWindow, Wry,
};

/// Menu item id for Close (⌘W / Ctrl+W). Handled in [`handle_menu_event`].
pub const CLOSE_TAB_OR_WINDOW_ID: &str = "close-tab-or-window";

/// Emitted to the focused main workbench webview. FE closes a side tab when
/// any are open; otherwise calls `window.close()` (tray / quit path).
pub const CLOSE_TAB_OR_WINDOW_EVENT: &str = "app://close-tab-or-window";

/// Build a default-equivalent menu whose Close items are app-owned.
pub fn build_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let pkg = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let close_label = close_menu_label();
    // Only one item owns the ⌘W / Ctrl+W accelerator (OS allows a single binding).
    // On Linux put it on Window; on macOS/Windows put it on File (standard).
    let close_primary = MenuItem::with_id(
        app,
        CLOSE_TAB_OR_WINDOW_ID,
        &close_label,
        true,
        Some("CmdOrCtrl+W"),
    )?;

    #[cfg(not(target_os = "linux"))]
    let window_menu = {
        let close_click = MenuItem::with_id(
            app,
            format!("{CLOSE_TAB_OR_WINDOW_ID}-window"),
            &close_label,
            true,
            None::<&str>,
        )?;
        Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                #[cfg(target_os = "macos")]
                &PredefinedMenuItem::separator(app)?,
                &close_click,
            ],
        )?
    };
    #[cfg(target_os = "linux")]
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &close_primary,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let app_submenu = Submenu::with_items(
        app,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    #[cfg(all(not(target_os = "linux"), not(target_os = "macos")))]
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&close_primary, &PredefinedMenuItem::quit(app, None)?],
    )?;
    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_items(app, "File", true, &[&close_primary])?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    #[cfg(all(not(target_os = "macos"), not(target_os = "linux")))]
    let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &window_menu, &help_menu])?;
    #[cfg(target_os = "linux")]
    let menu = Menu::with_items(app, &[&edit_menu, &window_menu, &help_menu])?;

    Ok(menu)
}

/// Native File/Window "Close" label. Shares the tray catalog so a new locale
/// only has to be translated once (see `tray_i18n::TrayStrings::close`).
fn close_menu_label() -> String {
    crate::tray_i18n::t().close.to_string()
}

/// Install the menu (replaces the auto default that binds ⌘W → window close).
pub fn install(app: &AppHandle) -> Result<(), String> {
    let menu = build_menu(app).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    // App-wide set_menu reattaches File/Edit/Window/Help to windows that have
    // no menu of their own — the pet overlay must stay chrome-less.
    crate::pet_window::reassert_overlay_chrome(app);
    Ok(())
}

/// Global menu event router — only handles our Close ids.
pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id != CLOSE_TAB_OR_WINDOW_ID && !id.starts_with(&format!("{CLOSE_TAB_OR_WINDOW_ID}-")) {
        return;
    }
    dispatch_close_tab_or_window(app);
}

fn dispatch_close_tab_or_window(app: &AppHandle) {
    let target = focused_webview(app).or_else(|| app.get_webview_window("main"));
    let Some(win) = target else {
        return;
    };
    // Secondary session windows have no side-tab strip — close for real.
    // The pet overlay is not a document window: hide it so prefs stay in sync.
    if win.label() == crate::pet_window::PET_WINDOW_LABEL {
        let _ = crate::pet_window::hide_pet(app);
        return;
    }
    if win.label() != "main" {
        let _ = win.close();
        return;
    }
    let _ = win.emit(CLOSE_TAB_OR_WINDOW_EVENT, ());
}

fn focused_webview(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

/// Refresh labels when the user changes locale in Settings (best-effort).
pub fn refresh(app: &AppHandle) -> Result<(), String> {
    install(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_constant_stable() {
        assert_eq!(CLOSE_TAB_OR_WINDOW_EVENT, "app://close-tab-or-window");
        assert_eq!(CLOSE_TAB_OR_WINDOW_ID, "close-tab-or-window");
    }

    #[test]
    fn close_label_non_empty() {
        assert!(!close_menu_label().is_empty());
    }
}
