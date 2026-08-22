//! Installed font-family names for Settings → Appearance.

use std::cmp::Ordering;

/// Hidden / vertical faces that are not useful in a UI picker.
fn is_skipped_family(name: &str) -> bool {
    name.is_empty() || name.starts_with('.') || name.starts_with('@')
}

/// Split comma-separated aliases, drop hidden faces, case-insensitive sort/dedup.
pub fn normalize_font_families<I>(raw: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let mut out: Vec<String> = raw
        .into_iter()
        .flat_map(|s| {
            s.split(',')
                .map(|part| part.trim().to_string())
                .collect::<Vec<_>>()
        })
        .filter(|s| !is_skipped_family(s))
        .collect();
    out.sort_by(|a, b| match a.to_lowercase().cmp(&b.to_lowercase()) {
        Ordering::Equal => a.cmp(b),
        other => other,
    });
    out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    out
}

fn list_families_raw() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        list_families_macos()
    }
    #[cfg(windows)]
    {
        list_families_windows()
    }
    #[cfg(target_os = "linux")]
    {
        list_families_linux()
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        Ok(Vec::new())
    }
}

/// Installed family names for the Appearance font picker.
pub fn collect_system_font_families() -> Result<Vec<String>, String> {
    Ok(normalize_font_families(list_families_raw()?))
}

#[tauri::command]
pub async fn list_system_font_families() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(collect_system_font_families)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn list_families_macos() -> Result<Vec<String>, String> {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_void};

    type CfIndex = isize;
    type CfTypeRef = *const c_void;
    type CfArrayRef = *const c_void;
    type CfStringRef = *const c_void;

    #[link(name = "CoreText", kind = "framework")]
    extern "C" {
        fn CTFontManagerCopyAvailableFontFamilyNames() -> CfArrayRef;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(the_array: CfArrayRef) -> CfIndex;
        fn CFArrayGetValueAtIndex(the_array: CfArrayRef, idx: CfIndex) -> CfTypeRef;
        fn CFStringGetLength(the_string: CfStringRef) -> CfIndex;
        fn CFStringGetMaximumSizeForEncoding(length: CfIndex, encoding: u32) -> CfIndex;
        fn CFStringGetCString(
            the_string: CfStringRef,
            buffer: *mut c_char,
            buffer_size: CfIndex,
            encoding: u32,
        ) -> u8;
        fn CFRelease(cf: CfTypeRef);
    }

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    // SAFETY: Core Text returns a +1 CFArray of CFString; we copy UTF-8 then CFRelease.
    unsafe {
        let arr = CTFontManagerCopyAvailableFontFamilyNames();
        if arr.is_null() {
            return Err("CTFontManagerCopyAvailableFontFamilyNames returned null".into());
        }
        let count = CFArrayGetCount(arr);
        let mut raw = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let s = CFArrayGetValueAtIndex(arr, i);
            if s.is_null() {
                continue;
            }
            let len = CFStringGetLength(s);
            let cap = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) + 1;
            if cap <= 1 {
                continue;
            }
            let mut buf = vec![0u8; cap as usize];
            let ok = CFStringGetCString(
                s,
                buf.as_mut_ptr() as *mut c_char,
                cap,
                K_CF_STRING_ENCODING_UTF8,
            );
            if ok == 0 {
                continue;
            }
            if let Ok(name) = CStr::from_ptr(buf.as_ptr() as *const c_char).to_str() {
                raw.push(name.to_string());
            }
        }
        CFRelease(arr);
        Ok(raw)
    }
}

#[cfg(windows)]
fn list_families_windows() -> Result<Vec<String>, String> {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, LOGFONTW,
    };

    let mut families: Vec<String> = Vec::new();
    // SAFETY: screen DC + EnumFontFamiliesExW callback writes into `families`.
    unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            return Err("GetDC failed".into());
        }
        let mut lf = LOGFONTW::default();
        lf.lfCharSet = DEFAULT_CHARSET;
        let _ = EnumFontFamiliesExW(
            hdc,
            &lf,
            Some(enum_font_proc),
            LPARAM(&mut families as *mut Vec<String> as isize),
            0,
        );
        let _ = ReleaseDC(None, hdc);
    }
    Ok(families)
}

#[cfg(windows)]
unsafe extern "system" fn enum_font_proc(
    lplf: *const windows::Win32::Graphics::Gdi::LOGFONTW,
    _lpntme: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
    _font_type: u32,
    lparam: windows::Win32::Foundation::LPARAM,
) -> i32 {
    if lplf.is_null() {
        return 1;
    }
    // SAFETY: lparam is the Vec from list_families_windows; lplf is the GDI face.
    let families = &mut *(lparam.0 as *mut Vec<String>);
    let lf = &*lplf;
    let end = lf
        .lfFaceName
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(lf.lfFaceName.len());
    let name = String::from_utf16_lossy(&lf.lfFaceName[..end]);
    if !is_skipped_family(name.trim()) {
        families.push(name);
    }
    1
}

#[cfg(target_os = "linux")]
fn list_families_linux() -> Result<Vec<String>, String> {
    let out = crate::process_util::command("fc-list")
        .args(["--format", "%{family}\n"])
        .output()
        .map_err(|e| format!("fc-list: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "fc-list exited {}: {err}",
            out.status.code().unwrap_or(-1)
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout.lines().map(|l| l.to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_sorts_dedups_and_drops_hidden() {
        let out = normalize_font_families([
            " Inter ".into(),
            "PingFang SC,PingFang SC".into(),
            ".SF NS".into(),
            "@Arial Unicode MS".into(),
            "inter".into(),
            "".into(),
        ]);
        assert_eq!(out, vec!["Inter", "PingFang SC"]);
    }

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    #[test]
    fn host_lists_installed_families() {
        let fonts = collect_system_font_families().expect("list installed fonts");
        assert!(
            fonts.len() > 5,
            "expected several installed families, got {fonts:?}"
        );
        assert!(fonts.iter().all(|f| !is_skipped_family(f)));
    }
}
