//! Localized copy emitted directly by the native Remote IM bridge.

#[derive(Clone, Copy)]
pub enum MessageKey {
    StopSignalSent,
    NoInFlightTurn,
    ProcessSupervisionFailed,
}

pub fn t(lang: &str, key: MessageKey) -> &'static str {
    match (lang, key) {
        ("en", MessageKey::StopSignalSent) => "Stop signal sent.",
        ("en", MessageKey::NoInFlightTurn) => "No in-flight turn.",
        ("en", MessageKey::ProcessSupervisionFailed) => {
            "Could not safely supervise the Grok process. Please try again."
        }
        (_, MessageKey::StopSignalSent) => "已发送中断信号。",
        (_, MessageKey::NoInFlightTurn) => "当前没有进行中的任务。",
        (_, MessageKey::ProcessSupervisionFailed) => "无法安全监控 Grok 进程，请重试。",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_messages_are_available_in_both_bridge_languages() {
        assert_eq!(t("en", MessageKey::StopSignalSent), "Stop signal sent.");
        assert_eq!(
            t("zh", MessageKey::NoInFlightTurn),
            "当前没有进行中的任务。"
        );
        assert_eq!(
            t("en", MessageKey::ProcessSupervisionFailed),
            "Could not safely supervise the Grok process. Please try again."
        );
    }
}
