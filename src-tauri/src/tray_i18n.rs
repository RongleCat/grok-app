//! Tray / menu-bar copy — mirrors `tray.*` keys in `src/i18n/messages.ts`.
//! Native menus cannot use the frontend catalog; keep both sides in sync.

use crate::store;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Zh,
    ZhTw,
    En,
}

impl Locale {
    pub fn parse(raw: &str) -> Self {
        let v = raw.trim().to_ascii_lowercase();
        match v.as_str() {
            "system" => Locale::from_system(),
            "en" | "en-us" | "en_us" | "en-gb" => Locale::En,
            "zh-tw" | "zh_tw" | "zh-hant" | "zh_hant" => Locale::ZhTw,
            "zh" | "zh-cn" | "zh_cn" | "zh-hans" | "zh_hans" => Locale::Zh,
            // Default product locale is en (matches AppSettings::default).
            _ => Locale::En,
        }
    }

    /// Best-effort map of OS UI language → catalog.
    /// Mirrors frontend `resolveLocaleFromSystem` for tray copy when preference
    /// is `"system"`. Prefers the GUI language (AppleLanguages / Windows UI
    /// LANGID) over POSIX `LANG=C` which Dock-launched apps often inherit.
    pub fn from_system() -> Self {
        Self::from_lang_tag(&detect_os_lang_tag())
    }

    /// Map a BCP-47 / POSIX language tag to a tray locale (pure; testable).
    pub fn from_lang_tag(raw: &str) -> Self {
        let bare = raw
            .trim()
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .replace('_', "-");
        if bare.is_empty() {
            return Locale::En;
        }
        let primary = bare.split('-').next().unwrap_or("");
        if primary == "zh" {
            let is_trad = bare
                .split('-')
                .any(|p| p == "hant" || p == "tw" || p == "hk" || p == "mo");
            return if is_trad { Locale::ZhTw } else { Locale::Zh };
        }
        if primary == "en" {
            return Locale::En;
        }
        // Fall through to exact alias parse (without re-entering "system").
        match bare.as_str() {
            "zh-tw" | "zh-hant" => Locale::ZhTw,
            "zh" | "zh-cn" | "zh-hans" => Locale::Zh,
            "en" | "en-us" | "en-gb" => Locale::En,
            _ => Locale::En,
        }
    }

    /// Canonical catalog id shared with the frontend (`en` / `zh` / `zh-TW`).
    pub fn as_tag(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::Zh => "zh",
            Locale::ZhTw => "zh-TW",
        }
    }
}

/// Raw OS UI language tag (`zh-CN`, `zh_TW`, `en-US`, …). Empty if unknown.
pub fn detect_os_lang_tag() -> String {
    if let Some(tag) = platform_ui_lang_tag() {
        return tag;
    }
    posix_lang_tag().unwrap_or_default()
}

fn posix_lang_tag() -> Option<String> {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() && !is_c_or_posix_locale(t) {
                return Some(t.to_string());
            }
        }
    }
    None
}

pub fn is_c_or_posix_locale(raw: &str) -> bool {
    let bare = raw
        .trim()
        .split('.')
        .next()
        .unwrap_or("")
        .replace('_', "-")
        .to_ascii_lowercase();
    bare == "c" || bare == "posix"
}

/// First quoted token from `defaults read -g AppleLanguages` output.
pub fn first_apple_languages_tag(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let q = bytes[i];
        if q == b'"' || q == b'\'' {
            if let Some(end) = raw[i + 1..].find(q as char) {
                let inner = raw[i + 1..i + 1 + end].trim();
                if !inner.is_empty() {
                    return Some(inner.to_string());
                }
                i += end + 2;
                continue;
            }
        }
        i += 1;
    }
    None
}

/// Map a Windows LANGID (GetUserDefaultUILanguage) to a BCP-47 tag.
/// Unknown primary languages return `None` so callers can fall through.
pub fn windows_langid_to_tag(id: u16) -> Option<&'static str> {
    const LANG_CHINESE: u16 = 0x04;
    const LANG_ENGLISH: u16 = 0x09;
    let primary = id & 0x3ff;
    let sub = id >> 10;
    match primary {
        LANG_CHINESE => match sub {
            1 | 3 | 5 => Some("zh-TW"), // Traditional / HK / MO
            _ => Some("zh-CN"),
        },
        LANG_ENGLISH => Some("en"),
        _ => None,
    }
}

fn platform_ui_lang_tag() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        return macos_ui_lang_tag();
    }
    #[cfg(windows)]
    {
        return windows_ui_lang_tag();
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn macos_ui_lang_tag() -> Option<String> {
    let langs = crate::process_util::command("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output();
    if let Ok(o) = langs {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout);
            if let Some(tag) = first_apple_languages_tag(&s) {
                return Some(tag);
            }
        }
    }
    let locale = crate::process_util::command("defaults")
        .args(["read", "-g", "AppleLocale"])
        .output();
    if let Ok(o) = locale {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_ui_lang_tag() -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
        fn GetUserDefaultLocaleName(lp_locale_name: *mut u16, cch_locale_name: i32) -> i32;
    }
    let id = unsafe { GetUserDefaultUILanguage() };
    if let Some(tag) = windows_langid_to_tag(id) {
        return Some(tag.to_string());
    }
    const LOCALE_NAME_MAX_LENGTH: usize = 85;
    let mut buf = [0u16; LOCALE_NAME_MAX_LENGTH];
    let n = unsafe { GetUserDefaultLocaleName(buf.as_mut_ptr(), buf.len() as i32) };
    if n > 1 {
        return String::from_utf16(&buf[..(n as usize - 1)]).ok();
    }
    None
}

/// Current app locale from durable settings.
pub fn app_locale() -> Locale {
    Locale::parse(&store::load_settings().locale)
}

/// Static tray strings for one locale.
pub struct TrayStrings {
    pub recent: &'static str,
    pub no_recent: &'static str,
    pub untitled: &'static str,
    pub more: &'static str,
    pub settings: &'static str,
    pub doctor: &'static str,
    pub account: &'static str,
    pub new_chat: &'static str,
    pub open_app: &'static str,
    pub quit: &'static str,
    pub tooltip: &'static str,
    /// `Usage  ·  {pct}% left  ·  {time}`
    pub usage_with_reset: &'static str,
    /// `Usage  ·  {pct}% left`
    pub usage_pct: &'static str,
    /// `Usage  ·  —`
    pub usage_unknown: &'static str,
}

const EN: TrayStrings = TrayStrings {
    recent: "Recent",
    no_recent: "No recent chats",
    untitled: "Untitled",
    more: "More",
    settings: "Settings…",
    doctor: "Doctor",
    account: "Account",
    new_chat: "New Chat",
    open_app: "Open Grok",
    quit: "Quit Grok",
    tooltip: "Grok",
    usage_with_reset: "Usage  ·  {pct}% left  ·  {time}",
    usage_pct: "Usage  ·  {pct}% left",
    usage_unknown: "Usage  ·  —",
};

const ZH: TrayStrings = TrayStrings {
    recent: "最近",
    no_recent: "暂无最近会话",
    untitled: "未命名",
    more: "更多",
    settings: "设置…",
    doctor: "Doctor",
    account: "账户",
    new_chat: "新对话",
    open_app: "打开 Grok",
    quit: "退出 Grok",
    tooltip: "Grok",
    usage_with_reset: "额度  ·  剩余 {pct}%  ·  {time}",
    usage_pct: "额度  ·  剩余 {pct}%",
    usage_unknown: "额度  ·  —",
};

const ZH_TW: TrayStrings = TrayStrings {
    recent: "最近",
    no_recent: "尚無最近對話",
    untitled: "未命名",
    more: "更多",
    settings: "設定…",
    doctor: "Doctor",
    account: "帳戶",
    new_chat: "新對話",
    open_app: "開啟 Grok",
    quit: "結束 Grok",
    tooltip: "Grok",
    usage_with_reset: "額度  ·  剩餘 {pct}%  ·  {time}",
    usage_pct: "額度  ·  剩餘 {pct}%",
    usage_unknown: "額度  ·  —",
};

pub fn strings(locale: Locale) -> &'static TrayStrings {
    match locale {
        Locale::En => &EN,
        Locale::Zh => &ZH,
        Locale::ZhTw => &ZH_TW,
    }
}

pub fn t() -> &'static TrayStrings {
    strings(app_locale())
}

/// Fill `{pct}` / `{time}` placeholders in tray usage templates.
pub fn format_usage(template: &str, pct: Option<f64>, time: Option<&str>) -> String {
    let mut out = template.to_string();
    if let Some(p) = pct {
        out = out.replace("{pct}", &format!("{p:.0}"));
    }
    if let Some(t) = time {
        out = out.replace("{time}", t);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_parse() {
        assert_eq!(Locale::parse("en"), Locale::En);
        assert_eq!(Locale::parse("EN-US"), Locale::En);
        assert_eq!(Locale::parse("zh"), Locale::Zh);
        assert_eq!(Locale::parse(""), Locale::En);
        assert_eq!(Locale::parse("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::parse("zh-Hant"), Locale::ZhTw);
        assert_eq!(strings(Locale::ZhTw).settings, "設定…");
    }

    #[test]
    fn first_apple_languages_tag_picks_preferred() {
        let raw = r#"
(
    "zh-Hans-CN",
    "en-US"
)
"#;
        assert_eq!(
            first_apple_languages_tag(raw).as_deref(),
            Some("zh-Hans-CN")
        );
        assert_eq!(
            first_apple_languages_tag(r#"("en-US")"#).as_deref(),
            Some("en-US")
        );
        assert_eq!(first_apple_languages_tag(""), None);
    }

    #[test]
    fn c_and_posix_locales_are_ignored() {
        assert!(is_c_or_posix_locale("C"));
        assert!(is_c_or_posix_locale("POSIX"));
        assert!(is_c_or_posix_locale("C.UTF-8"));
        assert!(!is_c_or_posix_locale("zh_CN.UTF-8"));
        assert!(!is_c_or_posix_locale("en_US"));
    }

    #[test]
    fn windows_langid_maps_chinese_ui() {
        assert_eq!(windows_langid_to_tag(0x0804), Some("zh-CN"));
        assert_eq!(windows_langid_to_tag(0x0404), Some("zh-TW"));
        assert_eq!(windows_langid_to_tag(0x0C04), Some("zh-TW"));
        assert_eq!(windows_langid_to_tag(0x0409), Some("en"));
        assert_eq!(windows_langid_to_tag(0x0411), None); // Japanese — fall through
    }

    #[test]
    fn from_lang_tag_maps_system_tags() {
        assert_eq!(Locale::from_lang_tag("en-US"), Locale::En);
        assert_eq!(Locale::from_lang_tag("zh_CN.UTF-8"), Locale::Zh);
        assert_eq!(Locale::from_lang_tag("zh-Hans-CN"), Locale::Zh);
        assert_eq!(Locale::from_lang_tag("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("zh-Hant-TW"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("zh-HK"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("fr_FR.UTF-8"), Locale::En);
        assert_eq!(Locale::from_lang_tag(""), Locale::En);
        assert_eq!(Locale::En.as_tag(), "en");
        assert_eq!(Locale::Zh.as_tag(), "zh");
        assert_eq!(Locale::ZhTw.as_tag(), "zh-TW");
    }

    #[test]
    fn usage_templates_fill() {
        let s = format_usage(EN.usage_with_reset, Some(73.2), Some("04-15 09:05"));
        assert_eq!(s, "Usage  ·  73% left  ·  04-15 09:05");
        let z = format_usage(ZH.usage_pct, Some(73.0), None);
        assert_eq!(z, "额度  ·  剩余 73%");
    }
}
