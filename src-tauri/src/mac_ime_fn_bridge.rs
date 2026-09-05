//! Forward macOS Fn / Globe `flagsChanged` to the active IME (#1030).
//!
//! Doubao (and some other IMEs) start voice input on long-press Fn. WebKit's
//! `WKView.flagsChanged` returns early for keyCode 63 (Fn), so the IME never
//! sees the modifier while a WKWebView contenteditable is focused. Ordinary
//! pinyin and Doubao's alternate Right-Option trigger still work.
//!
//! We install a local `NSEvent` monitor and, for Fn only:
//! 1. Call `-[NSTextInputContext handleEvent:]` so the IME receives the press.
//! 2. If the current input source looks like Doubao, also synthesize a Right
//!    Option tap (Doubao's documented alternate voice trigger) on Fn *down*.

#![cfg(target_os = "macos")]

use std::sync::Once;
use std::sync::atomic::{AtomicBool, Ordering};

/// Hardware Fn / Globe (kVK_Function). WebKit ignores this in flagsChanged.
pub const FN_KEY_CODE: u16 = 63;

/// Right Option (kVK_RightOption) — Doubao alternate voice trigger.
pub const RIGHT_OPTION_KEY_CODE: u16 = 0x3d;

/// `NSEventTypeFlagsChanged` → mask bit.
const NS_EVENT_MASK_FLAGS_CHANGED: u64 = 1u64 << 12;
/// `NSEventModifierFlagFunction`
const NS_EVENT_MODIFIER_FLAG_FUNCTION: u64 = 1u64 << 23;
/// `NSEventModifierFlagOption`
const NS_EVENT_MODIFIER_FLAG_OPTION: u64 = 1u64 << 19;
const NS_EVENT_TYPE_KEY_DOWN: u64 = 10;
const NS_EVENT_TYPE_KEY_UP: u64 = 11;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

// Needed so `msg_send!` can pass `location:` to NSEvent.
unsafe impl objc2::Encode for CGPoint {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

static INSTALL: Once = Once::new();
static FN_WAS_DOWN: AtomicBool = AtomicBool::new(false);

/// Install once after the main window is up. Safe to call repeatedly.
pub fn install() {
    INSTALL.call_once(|| {
        if let Err(e) = install_monitor() {
            tracing::warn!("mac_ime_fn_bridge: install failed: {e}");
        } else {
            tracing::info!("mac_ime_fn_bridge: Fn flagsChanged → IME bridge installed");
        }
    });
}

/// True when the input-source id looks like Doubao IME.
pub fn input_source_looks_like_doubao(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    lower.contains("doubao") || lower.contains("bytedance.inputmethod")
}

fn install_monitor() -> Result<(), String> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let block = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
        if event.is_null() {
            return event;
        }
        unsafe {
            let key_code: u16 = msg_send![event, keyCode];
            if key_code != FN_KEY_CODE {
                return event;
            }
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if ns_app.is_null() {
                return event;
            }
            let active: bool = msg_send![ns_app, isActive];
            if !active {
                return event;
            }
            let key_win: *mut AnyObject = msg_send![ns_app, keyWindow];
            if key_win.is_null() {
                return event;
            }

            let flags: u64 = msg_send![event, modifierFlags];
            let fn_down = (flags & NS_EVENT_MODIFIER_FLAG_FUNCTION) != 0;
            let was_down = FN_WAS_DOWN.swap(fn_down, Ordering::SeqCst);

            let ctx_cls = class!(NSTextInputContext);
            let ctx: *mut AnyObject = msg_send![ctx_cls, currentInputContext];
            if !ctx.is_null() {
                let handled: bool = msg_send![ctx, handleEvent: event];
                if handled {
                    tracing::debug!("mac_ime_fn_bridge: IME handled Fn flagsChanged");
                }

                // Fn edge down + Doubao: synthesize Right Option tap (alternate trigger).
                if fn_down && !was_down && current_input_source_is_doubao(ctx) {
                    post_right_option_tap(ns_app);
                }
            }
        }
        event
    });

    unsafe {
        let _: *mut AnyObject = msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: NS_EVENT_MASK_FLAGS_CHANGED,
            handler: &*block
        ];
    }
    std::mem::forget(block);
    Ok(())
}

unsafe fn current_input_source_is_doubao(ctx: *mut objc2::runtime::AnyObject) -> bool {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use std::ffi::CStr;

    let sel_src = sel!(selectedKeyboardInputSource);
    let responds: bool = msg_send![ctx, respondsToSelector: sel_src];
    if !responds {
        return false;
    }
    let src: *mut AnyObject = msg_send![ctx, selectedKeyboardInputSource];
    if src.is_null() {
        return false;
    }
    let utf8: *const i8 = msg_send![src, UTF8String];
    if utf8.is_null() {
        return false;
    }
    let id = CStr::from_ptr(utf8).to_string_lossy();
    input_source_looks_like_doubao(&id)
}

unsafe fn post_right_option_tap(ns_app: *mut objc2::runtime::AnyObject) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let empty: *mut AnyObject =
        msg_send![class!(NSString), stringWithUTF8String: b"\0".as_ptr() as *const i8];
    let loc = CGPoint { x: 0.0, y: 0.0 };
    for ty in [NS_EVENT_TYPE_KEY_DOWN, NS_EVENT_TYPE_KEY_UP] {
        let ev: *mut AnyObject = msg_send![
            class!(NSEvent),
            keyEventWithType: ty,
            location: loc,
            modifierFlags: NS_EVENT_MODIFIER_FLAG_OPTION,
            timestamp: 0.0f64,
            windowNumber: 0i64,
            context: std::ptr::null_mut::<AnyObject>(),
            characters: empty,
            charactersIgnoringModifiers: empty,
            isARepeat: false,
            keyCode: RIGHT_OPTION_KEY_CODE
        ];
        if !ev.is_null() {
            let _: () = msg_send![ns_app, postEvent: ev, atStart: true];
        }
    }
    tracing::debug!("mac_ime_fn_bridge: posted Right Option tap for Doubao voice");
}

#[cfg(test)]
mod tests {
    use super::{FN_KEY_CODE, RIGHT_OPTION_KEY_CODE, input_source_looks_like_doubao};

    #[test]
    fn fn_keycode_is_apple_function_key() {
        assert_eq!(FN_KEY_CODE, 63);
        assert_eq!(RIGHT_OPTION_KEY_CODE, 0x3d);
    }

    #[test]
    fn detects_doubao_input_source_ids() {
        assert!(input_source_looks_like_doubao(
            "com.bytedance.inputmethod.doubaoime.pinyin"
        ));
        assert!(input_source_looks_like_doubao("com.foo.Doubao.bar"));
        assert!(!input_source_looks_like_doubao("com.apple.keylayout.ABC"));
        assert!(!input_source_looks_like_doubao("com.sogou.inputmethod.pinyin"));
    }
}
