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
//!
//! It also forwards Alt-Tab / taskbar activation into the child WebView2 HWND.
//! With Tauri `unstable` (multi-webview), the page is a `WRY_WEBVIEW` child and
//! wry does not subclass the parent to `MoveFocus`, so the window can be
//! foreground while keyboard events never reach JS until a click.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetFocus, SetFocus, VK_LBUTTON,
};
use windows::Win32::UI::Shell::{
    ITaskbarList, SetCurrentProcessExplicitAppUserModelID, TaskbarList,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DrawMenuBar, GetClassNameW, GetPropW, GetWindow, GetWindowLongPtrW,
    GetWindowLongW, IsChild, IsWindowVisible, RemovePropW, SetMenu, SetPropW, SetWindowLongPtrW,
    SetWindowLongW, SetWindowPos, GWLP_HWNDPARENT, GWLP_WNDPROC, GWL_EXSTYLE, GWL_STYLE, GW_CHILD,
    GW_HWNDNEXT, GW_OWNER, HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, WA_ACTIVE, WA_CLICKACTIVE, WM_ACTIVATE, WM_NCDESTROY, WM_SETFOCUS,
    WNDPROC, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
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

/// True while the physical left mouse button is down.
///
/// Used by the pet overlay: `startDragging()` often swallows WebView `pointerup`,
/// so the host must notice the button release itself.
pub fn primary_mouse_button_down() -> bool {
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0 }
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
    attach_hwnd_webview_keyboard_focus(hwnd);
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
        attach_hwnd_webview_keyboard_focus(hwnd);
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
        // Frameless HWNDs still need MAXIMIZEBOX so IsZoomed / SW_MAXIMIZE work.
        if style & WS_MAXIMIZEBOX.0 == 0 {
            style |= WS_MAXIMIZEBOX.0;
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

/// wry child-webview class (Tauri `unstable` / `build_as_child`).
const WRY_WEBVIEW_CLASS: &str = "WRY_WEBVIEW";
/// Stored original WndProc pointer (`SetWindowLongPtr` subclass).
const ORIG_PROC_PROP: PCWSTR = windows::core::w!("GrokWvKbdFocusOrig");
static FORWARDING_KEYBOARD_FOCUS: AtomicBool = AtomicBool::new(false);

/// Forward Alt-Tab / taskbar activation into the child WebView2 HWND.
///
/// Safe to call repeatedly (skips if the original WndProc prop is already set).
pub fn attach_webview_keyboard_focus(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    attach_hwnd_webview_keyboard_focus(hwnd);
}

fn attach_hwnd_webview_keyboard_focus(hwnd: HWND) {
    unsafe {
        if !GetPropW(hwnd, ORIG_PROC_PROP).0.is_null() {
            return;
        }
        let prev = SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            keyboard_focus_wndproc as *const () as isize,
        );
        if prev == 0 {
            return;
        }
        if SetPropW(
            hwnd,
            ORIG_PROC_PROP,
            Some(HANDLE(prev as *mut std::ffi::c_void)),
        )
        .is_err()
        {
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, prev);
        }
    }
}

unsafe extern "system" fn keyboard_focus_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if should_handle_focus_message(msg, wparam.0 as u32) {
        forward_keyboard_focus_to_webview(hwnd);
    }
    let orig = GetPropW(hwnd, ORIG_PROC_PROP);
    if msg == WM_NCDESTROY {
        let _ = RemovePropW(hwnd, ORIG_PROC_PROP);
    }
    type WndProcFn = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT;
    let prev: WNDPROC = if orig.0.is_null() {
        None
    } else {
        Some(std::mem::transmute::<*mut std::ffi::c_void, WndProcFn>(
            orig.0,
        ))
    };
    CallWindowProcW(prev, hwnd, msg, wparam, lparam)
}

fn forward_keyboard_focus_to_webview(hwnd: HWND) {
    if FORWARDING_KEYBOARD_FOCUS.swap(true, Ordering::SeqCst) {
        return;
    }
    let _guard = ForwardingGuard;
    unsafe {
        let focus = GetFocus();
        if !focus.0.is_null() && IsChild(hwnd, focus).as_bool() {
            return;
        }
        if let Some(child) = first_visible_wry_webview_child(hwnd) {
            let _ = SetFocus(Some(child));
        }
    }
}

struct ForwardingGuard;
impl Drop for ForwardingGuard {
    fn drop(&mut self) {
        FORWARDING_KEYBOARD_FOCUS.store(false, Ordering::SeqCst);
    }
}

fn first_visible_wry_webview_child(parent: HWND) -> Option<HWND> {
    unsafe {
        let mut child = hwnd_or_none(GetWindow(parent, GW_CHILD).ok())?;
        loop {
            if IsWindowVisible(child).as_bool() && hwnd_is_wry_webview(child) {
                return Some(child);
            }
            child = hwnd_or_none(GetWindow(child, GW_HWNDNEXT).ok())?;
        }
    }
}

fn hwnd_or_none(hwnd: Option<HWND>) -> Option<HWND> {
    hwnd.filter(|h| !h.0.is_null())
}

fn hwnd_is_wry_webview(hwnd: HWND) -> bool {
    is_wry_webview_class(&hwnd_class_name(hwnd))
}

fn hwnd_class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

/// `WM_SETFOCUS`, or `WM_ACTIVATE` that is not minimize / deactivate.
fn should_handle_focus_message(msg: u32, wparam: u32) -> bool {
    if msg == WM_SETFOCUS {
        return true;
    }
    if msg != WM_ACTIVATE {
        return false;
    }
    let state = wparam & 0xffff;
    let minimized = ((wparam >> 16) & 0xffff) != 0;
    !minimized && (state == WA_ACTIVE || state == WA_CLICKACTIVE)
}

fn is_wry_webview_class(name: &str) -> bool {
    name.eq_ignore_ascii_case(WRY_WEBVIEW_CLASS)
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
    use windows::Win32::UI::WindowsAndMessaging::WM_ACTIVATEAPP;

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

    #[test]
    fn wry_webview_class_matches_child_container() {
        assert!(is_wry_webview_class("WRY_WEBVIEW"));
        assert!(is_wry_webview_class("wry_webview"));
        assert!(!is_wry_webview_class("Chrome_WidgetWin_1"));
        assert!(!is_wry_webview_class(""));
    }

    #[test]
    fn alt_tab_activate_and_setfocus_forward_to_webview() {
        assert!(should_handle_focus_message(WM_SETFOCUS, 0));
        assert!(should_handle_focus_message(WM_ACTIVATE, WA_ACTIVE));
        assert!(should_handle_focus_message(WM_ACTIVATE, WA_CLICKACTIVE));
        assert!(!should_handle_focus_message(WM_ACTIVATE, 0));
        // HIWORD set → window is minimized while activating.
        assert!(!should_handle_focus_message(
            WM_ACTIVATE,
            WA_ACTIVE | (1 << 16)
        ));
        assert!(!should_handle_focus_message(WM_ACTIVATEAPP, WA_ACTIVE));
    }
}
