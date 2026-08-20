//! OS light/dark probe + live Windows app-theme watch.
//!
//! Boot locks WebView2 to a concrete theme (form chrome). That freezes
//! `prefers-color-scheme`, so Settings → Personalization flips never reach
//! matchMedia. On Windows we watch `AppsUseLightTheme` and emit
//! `os-theme://changed` for the frontend to paint `data-theme`.

use tauri::AppHandle;

/// Host → frontend when Windows default *app* mode changes.
pub const OS_THEME_CHANGED_EVENT: &str = "os-theme://changed";

/// `AppsUseLightTheme` DWORD: `0` = dark apps, `1` = light. Missing → dark.
pub fn apps_prefer_dark_from_dword(apps: Option<u32>) -> bool {
    !apps.is_some_and(|v| v != 0)
}

/// Best-effort OS dark/light probe (no extra deps).
pub fn os_prefers_dark() -> bool {
    #[cfg(target_os = "macos")]
    {
        // AppleInterfaceStyle is set only in dark mode; missing → light.
        let out = crate::process_util::command("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout).to_ascii_lowercase();
            return s.contains("dark");
        }
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        return apps_prefer_dark();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // GNOME etc. — soft default dark when unknown
        true
    }
}

#[cfg(windows)]
fn apps_prefer_dark() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let apps = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()
        .and_then(|key| key.get_value::<u32, _>("AppsUseLightTheme").ok());
    apps_prefer_dark_from_dword(apps)
}

pub fn resolved_os_theme() -> &'static str {
    if os_prefers_dark() {
        "dark"
    } else {
        "light"
    }
}

#[tauri::command]
pub fn os_theme_current() -> String {
    resolved_os_theme().to_string()
}

/// Poll Windows app mode. No-op on other OS (matchMedia / Tauri theme-changed).
pub fn watch(app: &AppHandle) {
    #[cfg(windows)]
    watch_apps_theme(app.clone());
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
fn watch_apps_theme(app: AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("grok-os-theme".into())
        .spawn(move || {
            let mut last = resolved_os_theme();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let now = resolved_os_theme();
                if now == last {
                    continue;
                }
                last = now;
                let _ = app.emit(OS_THEME_CHANGED_EVENT, serde_json::json!({ "theme": now }));
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_dword_zero_is_dark() {
        assert!(apps_prefer_dark_from_dword(Some(0)));
        assert!(!apps_prefer_dark_from_dword(Some(1)));
        assert!(apps_prefer_dark_from_dword(None));
    }

    #[test]
    fn resolved_theme_matches_probe() {
        let t = resolved_os_theme();
        assert!(t == "light" || t == "dark");
        assert_eq!(t == "dark", os_prefers_dark());
    }
}
