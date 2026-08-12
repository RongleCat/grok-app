//! Localized copy emitted directly by the native Remote IM bridge.
//!
//! Catalogs follow `docs/llm-wiki/i18n.md`: `en` (default), `zh`, `zh-TW`.
//! Unknown tags fall back to English. Language comes from App settings.

#[derive(Clone, Copy)]
pub enum MessageKey {
    StopSignalSent,
    NoInFlightTurn,
    ProcessSupervisionFailed,
    TurnAlreadyInProgress,
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
        ("zh", MessageKey::ProcessSupervisionFailed) => "无法安全监控 Grok 进程，请重试。",
        ("zh", MessageKey::TurnAlreadyInProgress) => {
            "当前会话已有进行中的任务。发送 /stop 后再试，或等待其结束。"
        }
        ("zh-TW", MessageKey::StopSignalSent) => "已傳送中斷訊號。",
        ("zh-TW", MessageKey::NoInFlightTurn) => "目前沒有進行中的任務。",
        ("zh-TW", MessageKey::ProcessSupervisionFailed) => "無法安全監控 Grok 行程，請再試一次。",
        ("zh-TW", MessageKey::TurnAlreadyInProgress) => {
            "目前工作階段已有進行中的任務。請先傳送 /stop，或等它結束後再試。"
        }
        (_, MessageKey::StopSignalSent) => "Stop signal sent.",
        (_, MessageKey::NoInFlightTurn) => "No in-flight turn.",
        (_, MessageKey::ProcessSupervisionFailed) => {
            "Could not safely supervise the Grok process. Please try again."
        }
        (_, MessageKey::TurnAlreadyInProgress) => {
            "A turn is already running in this chat. Send /stop first, or wait for it to finish."
        }
    }
}

pub fn process_limit_user_message(lang: &str, max: u32) -> String {
    match normalize_lang(lang) {
        "zh" => format!(
            "已达到代理进程上限（最多同时 {max} 个）。请等待进行中的任务结束，或在 设置 → 运行时 → 进程池 中提高上限。"
        ),
        "zh-TW" => format!(
            "已達代理行程上限（最多同時 {max} 個）。請等待進行中的任務結束，或在 設定 → 執行階段 → 行程池 中提高上限。"
        ),
        _ => format!(
            "Agent process limit reached (max {max} concurrent). Wait for a running turn to finish, or raise the limit in Settings → Runtime → Process pool."
        ),
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
            t("en", MessageKey::ProcessSupervisionFailed),
            "Could not safely supervise the Grok process. Please try again."
        );
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

    #[test]
    fn process_limit_message_includes_max_in_each_catalog() {
        assert!(process_limit_user_message("en", 8).contains('8'));
        assert!(process_limit_user_message("zh", 3).contains('3'));
        assert!(process_limit_user_message("zh-TW", 4).contains('4'));
    }
}
