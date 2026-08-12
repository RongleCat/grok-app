//! Localized copy emitted directly by the native Remote IM bridge.
//!
//! Catalogs follow `docs/llm-wiki/i18n.md`: `en` (default), `zh`, `zh-TW`.
//! Unknown tags fall back to English. Language comes from App settings.

#[derive(Clone, Copy)]
pub enum MessageKey {
    StopSignalSent,
    NoInFlightTurn,
}

/// Canonical catalog id: `en` | `zh` | `zh-TW`.
pub fn normalize_lang(lang: &str) -> &'static str {
    crate::tray_i18n::Locale::parse(lang).as_tag()
}

/// Live App locale (`settings.locale`, including `system`).
pub fn resolve_engine_lang() -> String {
    crate::tray_i18n::app_locale().as_tag().to_string()
}

pub fn t(lang: &str, key: MessageKey) -> &'static str {
    match (normalize_lang(lang), key) {
        ("zh", MessageKey::StopSignalSent) => "已发送中断信号。",
        ("zh", MessageKey::NoInFlightTurn) => "当前没有进行中的任务。",
        ("zh-TW", MessageKey::StopSignalSent) => "已傳送中斷訊號。",
        ("zh-TW", MessageKey::NoInFlightTurn) => "目前沒有進行中的任務。",
        (_, MessageKey::StopSignalSent) => "Stop signal sent.",
        (_, MessageKey::NoInFlightTurn) => "No in-flight turn.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_messages_cover_all_product_locales() {
        assert_eq!(t("en", MessageKey::StopSignalSent), "Stop signal sent.");
        assert_eq!(
            t("zh", MessageKey::NoInFlightTurn),
            "当前没有进行中的任务。"
        );
        assert_eq!(t("zh-TW", MessageKey::StopSignalSent), "已傳送中斷訊號。");
        assert_eq!(
            t("zh-Hant", MessageKey::NoInFlightTurn),
            "目前沒有進行中的任務。"
        );
    }

    #[test]
    fn unknown_locale_falls_back_to_english() {
        assert_eq!(t("fr", MessageKey::StopSignalSent), "Stop signal sent.");
        assert_eq!(
            normalize_lang("system"),
            crate::tray_i18n::Locale::parse("system").as_tag()
        );
        assert_eq!(normalize_lang(""), "en");
        assert_eq!(normalize_lang("zh_CN"), "zh");
        assert_eq!(normalize_lang("zh-TW"), "zh-TW");
    }
}
