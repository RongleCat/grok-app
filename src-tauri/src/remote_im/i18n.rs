//! Localized copy emitted directly by the native Remote IM bridge.
//!
//! Catalogs follow `docs/llm-wiki/i18n.md`: every id in `tray_i18n::Locale`,
//! defaulting to English. Language comes from App settings.

use crate::tray_i18n::Locale;

#[derive(Clone, Copy)]
pub enum MessageKey {
    StopSignalSent,
    NoInFlightTurn,
    NoAvailableProject,
}

/// Canonical catalog id: `en` | `de` | … | `zh-TW`.
pub fn normalize_lang(lang: &str) -> &'static str {
    Locale::parse(lang).as_tag()
}

/// Live App locale (`settings.locale`, including `system`).
pub fn resolve_engine_lang() -> String {
    crate::tray_i18n::app_locale().as_tag().to_string()
}

pub fn t(lang: &str, key: MessageKey) -> &'static str {
    let locale = Locale::parse(lang);
    match (locale, key) {
        (Locale::De, MessageKey::StopSignalSent) => "Stoppsignal gesendet.",
        (Locale::De, MessageKey::NoInFlightTurn) => "Kein laufender Vorgang.",
        (Locale::De, MessageKey::NoAvailableProject) => {
            "Diese Instanz hat kein verfügbares Projekt. Sende /p oder wende dich an einen Admin."
        }

        (Locale::Es, MessageKey::StopSignalSent) => "Señal de parada enviada.",
        (Locale::Es, MessageKey::NoInFlightTurn) => "No hay ningún turno en curso.",
        (Locale::Es, MessageKey::NoAvailableProject) => {
            "Esta instancia no tiene ningún proyecto disponible. Envía /p o contacta a un administrador."
        }

        (Locale::Fr, MessageKey::StopSignalSent) => "Signal d’arrêt envoyé.",
        (Locale::Fr, MessageKey::NoInFlightTurn) => "Aucun tour en cours.",
        (Locale::Fr, MessageKey::NoAvailableProject) => {
            "Cette instance n’a aucun projet disponible. Envoyez /p ou contactez un administrateur."
        }

        (Locale::Id, MessageKey::StopSignalSent) => "Sinyal berhenti terkirim.",
        (Locale::Id, MessageKey::NoInFlightTurn) => "Tidak ada giliran yang berjalan.",
        (Locale::Id, MessageKey::NoAvailableProject) => {
            "Instance ini tidak punya proyek yang tersedia. Kirim /p atau hubungi admin."
        }

        (Locale::It, MessageKey::StopSignalSent) => "Segnale di stop inviato.",
        (Locale::It, MessageKey::NoInFlightTurn) => "Nessun turno in corso.",
        (Locale::It, MessageKey::NoAvailableProject) => {
            "Questa istanza non ha progetti disponibili. Invia /p o contatta un amministratore."
        }

        (Locale::Ja, MessageKey::StopSignalSent) => "中断信号を送信しました。",
        (Locale::Ja, MessageKey::NoInFlightTurn) => "進行中のターンはありません。",
        (Locale::Ja, MessageKey::NoAvailableProject) => {
            "このインスタンスに利用可能なプロジェクトがありません。/p を送信するか管理者に連絡してください。"
        }

        (Locale::Ko, MessageKey::StopSignalSent) => "중지 신호를 보냈습니다.",
        (Locale::Ko, MessageKey::NoInFlightTurn) => "진행 중인 턴이 없습니다.",
        (Locale::Ko, MessageKey::NoAvailableProject) => {
            "이 인스턴스에는 사용 가능한 프로젝트가 없습니다. /p 를 보내거나 관리자에게 문의하세요."
        }

        (Locale::PtBr, MessageKey::StopSignalSent) => "Sinal de parada enviado.",
        (Locale::PtBr, MessageKey::NoInFlightTurn) => "Nenhum turno em andamento.",
        (Locale::PtBr, MessageKey::NoAvailableProject) => {
            "Esta instância não tem projeto disponível. Envie /p ou fale com um administrador."
        }

        (Locale::Ru, MessageKey::StopSignalSent) => "Сигнал остановки отправлен.",
        (Locale::Ru, MessageKey::NoInFlightTurn) => "Нет активного хода.",
        (Locale::Ru, MessageKey::NoAvailableProject) => {
            "В этом экземпляре нет доступного проекта. Отправьте /p или обратитесь к администратору."
        }

        (Locale::Uk, MessageKey::StopSignalSent) => "Сигнал зупинки надіслано.",
        (Locale::Uk, MessageKey::NoInFlightTurn) => "Немає активного ходу.",
        (Locale::Uk, MessageKey::NoAvailableProject) => {
            "У цьому екземплярі немає доступного проєкту. Надішліть /p або зверніться до адміністратора."
        }

        (Locale::Zh, MessageKey::StopSignalSent) => "已发送中断信号。",
        (Locale::Zh, MessageKey::NoInFlightTurn) => "当前没有进行中的任务。",
        (Locale::Zh, MessageKey::NoAvailableProject) => "当前实例没有可用项目，请发送 /p 或联系管理员。",

        (Locale::ZhTw, MessageKey::StopSignalSent) => "已傳送中斷訊號。",
        (Locale::ZhTw, MessageKey::NoInFlightTurn) => "目前沒有進行中的任務。",
        (Locale::ZhTw, MessageKey::NoAvailableProject) => {
            "目前執行個體沒有可用專案，請傳送 /p 或聯絡管理員。"
        }

        (_, MessageKey::StopSignalSent) => "Stop signal sent.",
        (_, MessageKey::NoInFlightTurn) => "No in-flight turn.",
        (_, MessageKey::NoAvailableProject) => {
            "This instance has no available project. Send /p or contact an admin."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_TAGS: [&str; 13] = [
        "en", "de", "es", "fr", "id", "it", "ja", "ko", "pt-BR", "ru", "uk", "zh", "zh-TW",
    ];

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
        assert_eq!(
            t("zh", MessageKey::NoAvailableProject),
            "当前实例没有可用项目，请发送 /p 或联系管理员。"
        );
        assert!(t("en", MessageKey::NoAvailableProject).contains("/p"));
        assert!(t("zh-TW", MessageKey::NoAvailableProject).contains("/p"));
    }

    #[test]
    fn added_locales_are_translated_not_english() {
        assert_eq!(t("ja", MessageKey::StopSignalSent), "中断信号を送信しました。");
        assert_eq!(t("ko", MessageKey::NoInFlightTurn), "진행 중인 턴이 없습니다.");
        assert_eq!(
            t("de", MessageKey::NoInFlightTurn),
            "Kein laufender Vorgang."
        );
        assert_eq!(t("pt-BR", MessageKey::StopSignalSent), "Sinal de parada enviado.");
        assert_eq!(t("uk", MessageKey::StopSignalSent), "Сигнал зупинки надіслано.");
    }

    #[test]
    fn every_locale_answers_and_keeps_the_slash_command() {
        for tag in ALL_TAGS {
            for key in [
                MessageKey::StopSignalSent,
                MessageKey::NoInFlightTurn,
                MessageKey::NoAvailableProject,
            ] {
                assert!(!t(tag, key).trim().is_empty(), "{tag} has empty copy");
            }
            // The recovery instruction is useless without the command itself.
            assert!(
                t(tag, MessageKey::NoAvailableProject).contains("/p"),
                "{tag} dropped /p"
            );
        }
    }

    #[test]
    fn unknown_locale_falls_back_to_english() {
        assert_eq!(t("he", MessageKey::StopSignalSent), "Stop signal sent.");
        assert_eq!(
            normalize_lang("system"),
            crate::tray_i18n::Locale::parse("system").as_tag()
        );
        assert_eq!(normalize_lang(""), "en");
        assert_eq!(normalize_lang("zh_CN"), "zh");
        assert_eq!(normalize_lang("zh-TW"), "zh-TW");
        assert_eq!(normalize_lang("ja-JP"), "ja");
        assert_eq!(normalize_lang("pt_PT"), "pt-BR");
    }
}
