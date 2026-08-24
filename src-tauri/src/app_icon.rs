use tauri::AppHandle;

pub const DEFAULT_ICON_ID: &str = "default-black";

const DEFAULT_BLACK: &[u8] = include_bytes!("../../src/assets/app-icons/default-black.png");
const DEFAULT_WHITE: &[u8] = include_bytes!("../../src/assets/app-icons/default-white.png");
const PIXEL_GLITCH: &[u8] = include_bytes!("../../src/assets/app-icons/pixel-glitch.png");
const MINIMAL_LINE: &[u8] = include_bytes!("../../src/assets/app-icons/minimal-line.png");
const TERMINAL_CODE: &[u8] = include_bytes!("../../src/assets/app-icons/terminal-code.png");
const WHITE_HOLE: &[u8] = include_bytes!("../../src/assets/app-icons/white-hole.png");

pub fn validate_id(id: &str) -> Result<&'static str, String> {
    match id {
        "default-black" => Ok("default-black"),
        "default-white" => Ok("default-white"),
        "pixel-glitch" => Ok("pixel-glitch"),
        "minimal-line" => Ok("minimal-line"),
        "terminal-code" => Ok("terminal-code"),
        "white-hole" => Ok("white-hole"),
        _ => Err(format!("unknown app icon: {id}")),
    }
}

pub fn effective_id(id: &str) -> &'static str {
    validate_id(id).unwrap_or(DEFAULT_ICON_ID)
}

fn icon_bytes(id: &str) -> Result<&'static [u8], String> {
    Ok(match validate_id(id)? {
        "default-black" => DEFAULT_BLACK,
        "default-white" => DEFAULT_WHITE,
        "pixel-glitch" => PIXEL_GLITCH,
        "minimal-line" => MINIMAL_LINE,
        "terminal-code" => TERMINAL_CODE,
        "white-hole" => WHITE_HOLE,
        _ => unreachable!("validate_id only returns shipped ids"),
    })
}

/// Setup runs on Tauri's main thread; call this before the hidden window is shown.
pub fn apply_startup(app: &AppHandle, persisted_id: &str) -> Result<(), String> {
    let id = effective_id(persisted_id);
    if id != persisted_id {
        tracing::warn!(
            persisted_id,
            fallback = DEFAULT_ICON_ID,
            "unknown persisted app icon; using default"
        );
    }
    apply_now(app, id)
}

/// Live settings changes may arrive off the UI thread. Schedule the native swap
/// on the main thread and wait so settings_set can roll persistence back on error.
pub async fn apply(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = validate_id(id)?;
    let app_for_main = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(apply_now(&app_for_main, id));
    })
    .map_err(|e| format!("schedule app icon update: {e}"))?;
    rx.await
        .map_err(|_| "app icon update task was cancelled".to_string())?
}

#[cfg(target_os = "macos")]
fn apply_now(_app: &AppHandle, id: &str) -> Result<(), String> {
    let bytes = icon_bytes(id)?;
    unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};

        let data: *mut AnyObject = msg_send![
            class!(NSData),
            dataWithBytes: bytes.as_ptr(),
            length: bytes.len()
        ];
        if data.is_null() {
            return Err("create NSData for app icon".into());
        }
        let allocated: *mut AnyObject = msg_send![class!(NSImage), alloc];
        if allocated.is_null() {
            return Err("allocate NSImage for app icon".into());
        }
        let image: *mut AnyObject = msg_send![allocated, initWithData: data];
        if image.is_null() {
            return Err(format!("decode app icon: {id}"));
        }
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if application.is_null() {
            let _: () = msg_send![image, release];
            return Err("NSApplication unavailable".into());
        }
        let _: () = msg_send![application, setApplicationIconImage: image];
        let _: () = msg_send![image, release];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_now(app: &AppHandle, id: &str) -> Result<(), String> {
    use tauri::Manager;

    let image = tauri::image::Image::from_bytes(icon_bytes(id)?)
        .map_err(|e| format!("decode app icon {id}: {e}"))?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;
    window
        .set_icon(image)
        .map_err(|e| format!("set app icon {id}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_the_six_shipped_icon_ids() {
        for id in [
            "default-black",
            "default-white",
            "pixel-glitch",
            "minimal-line",
            "terminal-code",
            "white-hole",
        ] {
            assert_eq!(validate_id(id), Ok(id));
        }
        assert!(validate_id("black-hole").is_err());
        assert!(validate_id("").is_err());
    }

    #[test]
    fn invalid_persisted_ids_fall_back_without_becoming_valid_input() {
        assert_eq!(effective_id("hand-edited"), "default-black");
        assert!(validate_id("hand-edited").is_err());
    }

    #[test]
    fn all_icon_assets_share_the_default_rounded_alpha_mask() {
        let alpha = |bytes: &[u8]| {
            let image = image::load_from_memory(bytes).unwrap().to_rgba8();
            assert_eq!(image.dimensions(), (512, 512));
            image.pixels().map(|pixel| pixel[3]).collect::<Vec<_>>()
        };
        let expected = alpha(DEFAULT_BLACK);

        for id in [
            "default-white",
            "pixel-glitch",
            "minimal-line",
            "terminal-code",
            "white-hole",
        ] {
            assert_eq!(alpha(icon_bytes(id).unwrap()), expected, "{id}");
        }
    }
}
