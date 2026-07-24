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
        match raw.trim().to_ascii_lowercase().as_str() {
            "en" | "en-us" | "en_us" | "en-gb" => Locale::En,
            "zh-tw" | "zh_tw" | "zh-hant" | "zh_hant" => Locale::ZhTw,
            // Default product locale is zh (matches AppSettings::default).
            _ => Locale::Zh,
        }
    }
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
        assert_eq!(Locale::parse(""), Locale::Zh);
        assert_eq!(Locale::parse("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::parse("zh-Hant"), Locale::ZhTw);
        assert_eq!(strings(Locale::ZhTw).settings, "設定…");
    }

    #[test]
    fn usage_templates_fill() {
        let s = format_usage(EN.usage_with_reset, Some(73.2), Some("04-15 09:05"));
        assert_eq!(s, "Usage  ·  73% left  ·  04-15 09:05");
        let z = format_usage(ZH.usage_pct, Some(73.0), None);
        assert_eq!(z, "额度  ·  剩余 73%");
    }
}
