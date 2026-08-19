//! Windows shell integration for the main workbench window.
//!
//! Frameless (`decorations: false`) + tray `set_skip_taskbar` can leave the HWND
//! in a state where Explorer's **Show Desktop** (taskbar far-right / Win+D)
//! does not treat us as a significant top-level app window when we are alone.
//! With other normal windows open, minimize-all still sweeps us up — matching
//! the reported "alone = no effect; multi-window = works" symptom.
//!
//! This module forces shell-friendly styles, AppUserModelID, and taskbar tab
//! registration so the window participates in Show Desktop consistently.

#![cfg(windows)]

use tauri::WebviewWindow;
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    ITaskbarList, SetCurrentProcessExplicitAppUserModelID, TaskbarList,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DrawMenuBar, GetWindow, GetWindowLongPtrW, GetWindowLongW, SetMenu, SetWindowLongPtrW,
    SetWindowLongW, SetWindowPos, GWLP_HWNDPARENT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER,
    HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_MINIMIZEBOX,
};

/// Product AUMID — must match `identifier` in tauri.conf.json / NSIS shortcuts.
const APP_USER_MODEL_ID: &str = "com.grokapp.desktop";

/// Call once early in process startup (before or right after creating the main window).
pub fn set_process_app_user_model_id() {
    let wide: Vec<u16> = APP_USER_MODEL_ID
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        if let Err(e) = SetCurrentProcessExplicitAppUserModelID(PCWSTR(wide.as_ptr())) {
            tracing::warn!("SetCurrentProcessExplicitAppUserModelID: {e}");
        }
    }
}

/// Desktop-pet overlay: drop the Win32 menu bar (File / Edit / Window / Help).
///
/// Tauri `app.set_menu` attaches the app-wide menu to every window that did not
/// install its own. `SetMenu(NULL)` + `DrawMenuBar` collapses the extra strip
/// even when `decorations(false)` left the muda bar painted.
pub fn strip_overlay_native_menu(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let _ = SetMenu(hwnd, None);
        let _ = DrawMenuBar(hwnd);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

/// Ensure the main window is a normal taskbar / Alt-Tab / Show-Desktop participant.
///
/// Safe to call repeatedly (setup, show-from-tray, after skip_taskbar restore).
pub fn ensure_main_window_shell_integration(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("win_shell: no hwnd for main window");
        return;
    };
    ensure_hwnd_shell_integration(hwnd, /*register_taskbar*/ true);
}

/// Apply or clear "live in tray only" extended styles + taskbar tab.
/// Prefer this over bare `set_skip_taskbar` so TOOLWINDOW/APPWINDOW stay consistent.
pub fn set_main_window_skip_taskbar(window: &WebviewWindow, skip: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let mut ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if skip {
            ex |= WS_EX_TOOLWINDOW.0;
            ex &= !WS_EX_APPWINDOW.0;
        } else {
            ex &= !WS_EX_TOOLWINDOW.0;
            ex |= WS_EX_APPWINDOW.0;
        }
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex as i32);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
        taskbar_set_tab(hwnd, !skip);
    }
    if !skip {
        // Full re-assert (minimize box, owner clear, not topmost, refresh tab).
        ensure_hwnd_shell_integration(hwnd, /*register_taskbar*/ true);
    }
}

fn ensure_hwnd_shell_integration(hwnd: HWND, register_taskbar: bool) {
    unsafe {
        // Clear accidental owner (GWLP_HWNDPARENT on a top-level window is the owner).
        // Owned windows are often skipped by Show Desktop when alone.
        let owner_ptr = GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT);
        if owner_ptr != 0 {
            let _ = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
            tracing::debug!("win_shell: cleared window owner");
        }
        if let Ok(gw_owner) = GetWindow(hwnd, GW_OWNER) {
            if !gw_owner.0.is_null() {
                let _ = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
            }
        }

        let mut style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let mut ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let mut changed = false;

        if style & WS_MINIMIZEBOX.0 == 0 {
            style |= WS_MINIMIZEBOX.0;
            changed = true;
        }
        // Visible app windows must not be tool windows — TOOLWINDOW alone is excluded
        // from Show Desktop's "significant window" set when it is the only one open.
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            ex &= !WS_EX_TOOLWINDOW.0;
            changed = true;
        }
        if ex & WS_EX_APPWINDOW.0 == 0 {
            ex |= WS_EX_APPWINDOW.0;
            changed = true;
        }
        let was_topmost = ex & WS_EX_TOPMOST.0 != 0;
        if was_topmost {
            ex &= !WS_EX_TOPMOST.0;
            changed = true;
        }

        if changed {
            SetWindowLongW(hwnd, GWL_STYLE, style as i32);
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex as i32);
        }

        // Always poke FRAMECHANGED so Explorer re-reads styles; drop TOPMOST z-order if needed.
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED;
        if was_topmost {
            let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
        } else {
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, flags | SWP_NOZORDER);
        }

        if register_taskbar {
            // Delete+Add forces Explorer to refresh the button / ToggleDesktop set.
            taskbar_set_tab(hwnd, true);
        }
    }
}

fn taskbar_set_tab(hwnd: HWND, present: bool) {
    // COM calls are unsafe; the closure body is not covered by `com_scope`'s
    // outer `unsafe` block (only the call site of `f()` is).
    let _ = com_scope(|| unsafe {
        let taskbar: ITaskbarList = CoCreateInstance(&TaskbarList, None, CLSCTX_SERVER)?;
        taskbar.HrInit()?;
        if present {
            let _ = taskbar.DeleteTab(hwnd);
            taskbar.AddTab(hwnd)?;
        } else {
            taskbar.DeleteTab(hwnd)?;
        }
        Ok(())
    });
}

fn com_scope<F, T>(f: F) -> windows::core::Result<T>
where
    F: FnOnce() -> windows::core::Result<T>,
{
    unsafe {
        // CoInitializeEx returns HRESULT (not Result). S_OK / S_FALSE both succeed and
        // must be balanced with CoUninitialize (MSDN). RPC_E_CHANGED_MODE → skip uninit.
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let need_uninit = hr.is_ok();
        let result = f();
        if need_uninit {
            CoUninitialize();
        }
        result
    }
}

/// Pure helper for unit tests: Alt-Tab / Show-Desktop significance rules (simplified).
#[cfg(test)]
pub fn is_shell_significant_for_tests(style: u32, ex: u32, has_owner: bool) -> bool {
    let tool = ex & WS_EX_TOOLWINDOW.0 != 0;
    let app = ex & WS_EX_APPWINDOW.0 != 0;
    let minbox = style & WS_MINIMIZEBOX.0 != 0;
    if has_owner && !app {
        return false;
    }
    if tool && !app {
        return false;
    }
    minbox && (app || !tool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolwindow_without_appwindow_is_not_significant() {
        let style = WS_MINIMIZEBOX.0;
        let ex = WS_EX_TOOLWINDOW.0;
        assert!(!is_shell_significant_for_tests(style, ex, false));
    }

    #[test]
    fn appwindow_with_minimize_is_significant() {
        let style = WS_MINIMIZEBOX.0;
        let ex = WS_EX_APPWINDOW.0;
        assert!(is_shell_significant_for_tests(style, ex, false));
    }

    #[test]
    fn owned_without_appwindow_is_not_significant() {
        let style = WS_MINIMIZEBOX.0;
        let ex = 0;
        assert!(!is_shell_significant_for_tests(style, ex, true));
    }

    #[test]
    fn owned_with_appwindow_is_significant() {
        let style = WS_MINIMIZEBOX.0;
        let ex = WS_EX_APPWINDOW.0;
        assert!(is_shell_significant_for_tests(style, ex, true));
    }
}
