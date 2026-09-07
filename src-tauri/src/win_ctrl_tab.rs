//! Let Ctrl+Tab reach the page on Windows WebView2.
//!
//! WebView2 treats Ctrl+Tab as a browser-tab accelerator and swallows it
//! before JavaScript. Recent-chat switching (VS Code / Cursor) needs that
//! chord in the DOM, same as macOS and Linux. We mark it as not a browser
//! accelerator so the frontend handler runs. Other accelerators stay intact.

#![cfg(windows)]

use std::cell::RefCell;

use tauri::WebviewWindow;
use webview2_com::{
    AcceleratorKeyPressedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs2,
        ICoreWebView2AcceleratorKeyPressedEventHandler, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
    },
};
use windows::core::Interface;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
};

const VK_TAB: u32 = 0x09;

thread_local! {
    static HANDLERS: RefCell<Vec<ICoreWebView2AcceleratorKeyPressedEventHandler>> =
        const { RefCell::new(Vec::new()) };
}

fn down(vk: VIRTUAL_KEY) -> bool {
    unsafe { (GetKeyState(vk.0 as i32) as u16) & 0x8000 != 0 }
}

/// Install after the main window is shown (controller exists).
pub fn install(window: &WebviewWindow) {
    let result = window.with_webview(|webview| {
        let controller = webview.controller();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_sender, args| {
            let Some(args) = args else {
                return Ok(());
            };
            unsafe {
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND(0);
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut vk = 0u32;
                args.VirtualKey(&mut vk)?;
                if vk != VK_TAB {
                    return Ok(());
                }
                if !down(VK_CONTROL) {
                    return Ok(());
                }
                if down(VK_MENU) || down(VK_LWIN) || down(VK_RWIN) {
                    return Ok(());
                }
                if let Ok(args2) = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                    args2.SetIsBrowserAcceleratorKeyEnabled(false)?;
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        unsafe {
            if let Err(e) = controller.add_AcceleratorKeyPressed(&handler, &mut token) {
                tracing::warn!("Ctrl+Tab accelerator hook failed: {e}");
                return;
            }
        }
        HANDLERS.with(|h| h.borrow_mut().push(handler));
    });
    if let Err(e) = result {
        tracing::warn!("Ctrl+Tab webview hook failed: {e}");
    }
}
