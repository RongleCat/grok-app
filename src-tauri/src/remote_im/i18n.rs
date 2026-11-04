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
    AttachmentProcessingFailed,
    AttachmentQuotaExhausted,
    AttachmentQueueFull,
    AttachmentTooMany,
    AttachmentSendFailed,
    AttachmentsSent,
}

/// Canonical catalog id: `en` | `de` | … | `zh-TW`.
#[cfg_attr(not(test), allow(dead_code))]
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
        (Locale::De, MessageKey::NoInFlightTurn) => "Kein laufender Zug.",
        (Locale::De, MessageKey::NoAvailableProject) => {
            "Diese Instanz hat kein verfügbares Projekt. Sende /p oder wende dich an einen Admin."
        }

        (Locale::Es, MessageKey::StopSignalSent) => "Señal de parada enviada.",
        (Locale::Es, MessageKey::NoInFlightTurn) => "No hay ningún turno en curso.",
        (Locale::Es, MessageKey::NoAvailableProject) => {
            "Esta instancia no tiene ningún proyecto disponible. Envía /p o contacta a un administrador."
        }

        (Locale::Fil, MessageKey::StopSignalSent) => "Naipadala ang senyas na huminto.",
        (Locale::Fil, MessageKey::NoInFlightTurn) => "Walang kasalukuyang turn.",
        (Locale::Fil, MessageKey::NoAvailableProject) => {
            "Walang available na proyekto ang instance na ito. Magpadala ng /p o makipag-ugnayan sa admin."
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

        (Locale::Ta, MessageKey::StopSignalSent) => "நிறுத்தச் சமிக்ஞை அனுப்பப்பட்டது.",
        (Locale::Ta, MessageKey::NoInFlightTurn) => "நடப்பில் எந்தச் சுற்றும் இல்லை.",
        (Locale::Ta, MessageKey::NoAvailableProject) => {
            "இந்த நிகழ்வில் பயன்படுத்தக்கூடிய திட்டம் இல்லை. /p ஐ அனுப்பவும் அல்லது நிர்வாகியைத் தொடர்பு கொள்ளவும்."
        }

        (Locale::Tr, MessageKey::StopSignalSent) => "Durdurma sinyali gönderildi.",
        (Locale::Tr, MessageKey::NoInFlightTurn) => "Süren bir tur yok.",
        (Locale::Tr, MessageKey::NoAvailableProject) => {
            "Bu örnekte kullanılabilir proje yok. /p gönderin ya da bir yöneticiyle iletişime geçin."
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

        (Locale::De, MessageKey::AttachmentProcessingFailed) => "Anhangsverarbeitung fehlgeschlagen: ",
        (Locale::De, MessageKey::AttachmentQuotaExhausted) => "Das Anhangslimit für diesen Chat ist aufgebraucht; später erneut versuchen.",
        (Locale::De, MessageKey::AttachmentQueueFull) => "Die Anhang-Warteschlange ist voll; später erneut versuchen.",
        (Locale::De, MessageKey::AttachmentTooMany) => "Zu viele Anhänge; nur die ersten 16 wurden verarbeitet.",
        (Locale::De, MessageKey::AttachmentSendFailed) => "Anhang konnte nicht gesendet werden: ",
        (Locale::De, MessageKey::AttachmentsSent) => "Anhänge gesendet.",
        (Locale::Es, MessageKey::AttachmentProcessingFailed) => "Error al procesar el adjunto: ",
        (Locale::Es, MessageKey::AttachmentQuotaExhausted) => "Se agotó el límite de adjuntos de este chat; inténtalo más tarde.",
        (Locale::Es, MessageKey::AttachmentQueueFull) => "La cola de adjuntos está llena; inténtalo más tarde.",
        (Locale::Es, MessageKey::AttachmentTooMany) => "Demasiados adjuntos; solo se procesaron los primeros 16.",
        (Locale::Es, MessageKey::AttachmentSendFailed) => "No se pudo enviar el adjunto: ",
        (Locale::Es, MessageKey::AttachmentsSent) => "Adjuntos enviados.",
        (Locale::Fil, MessageKey::AttachmentProcessingFailed) => "Nabigo ang pagproseso ng attachment: ",
        (Locale::Fil, MessageKey::AttachmentQuotaExhausted) => "Naubos na ang attachment quota ng chat na ito; subukan mamaya.",
        (Locale::Fil, MessageKey::AttachmentQueueFull) => "Puno na ang attachment queue; subukan mamaya.",
        (Locale::Fil, MessageKey::AttachmentTooMany) => "Masyadong maraming attachment; unang 16 lang ang naproseso.",
        (Locale::Fil, MessageKey::AttachmentSendFailed) => "Nabigo ang pagpapadala ng attachment: ",
        (Locale::Fil, MessageKey::AttachmentsSent) => "Naipadala ang mga attachment.",
        (Locale::Fr, MessageKey::AttachmentProcessingFailed) => "Échec du traitement de la pièce jointe : ",
        (Locale::Fr, MessageKey::AttachmentQuotaExhausted) => "Le quota de pièces jointes de ce chat est épuisé ; réessayez plus tard.",
        (Locale::Fr, MessageKey::AttachmentQueueFull) => "La file des pièces jointes est pleine ; réessayez plus tard.",
        (Locale::Fr, MessageKey::AttachmentTooMany) => "Trop de pièces jointes ; seules les 16 premières ont été traitées.",
        (Locale::Fr, MessageKey::AttachmentSendFailed) => "Échec de l’envoi de la pièce jointe : ",
        (Locale::Fr, MessageKey::AttachmentsSent) => "Pièces jointes envoyées.",
        (Locale::Id, MessageKey::AttachmentProcessingFailed) => "Gagal memproses lampiran: ",
        (Locale::Id, MessageKey::AttachmentQuotaExhausted) => "Kuota lampiran chat ini habis; coba lagi nanti.",
        (Locale::Id, MessageKey::AttachmentQueueFull) => "Antrean lampiran penuh; coba lagi nanti.",
        (Locale::Id, MessageKey::AttachmentTooMany) => "Terlalu banyak lampiran; hanya 16 pertama yang diproses.",
        (Locale::Id, MessageKey::AttachmentSendFailed) => "Gagal mengirim lampiran: ",
        (Locale::Id, MessageKey::AttachmentsSent) => "Lampiran terkirim.",
        (Locale::It, MessageKey::AttachmentProcessingFailed) => "Elaborazione dell’allegato non riuscita: ",
        (Locale::It, MessageKey::AttachmentQuotaExhausted) => "La quota allegati di questa chat è esaurita; riprova più tardi.",
        (Locale::It, MessageKey::AttachmentQueueFull) => "La coda degli allegati è piena; riprova più tardi.",
        (Locale::It, MessageKey::AttachmentTooMany) => "Troppi allegati; sono stati elaborati solo i primi 16.",
        (Locale::It, MessageKey::AttachmentSendFailed) => "Invio dell’allegato non riuscito: ",
        (Locale::It, MessageKey::AttachmentsSent) => "Allegati inviati.",
        (Locale::Ja, MessageKey::AttachmentProcessingFailed) => "添付ファイルの処理に失敗しました。",
        (Locale::Ja, MessageKey::AttachmentQuotaExhausted) => "このチャットの添付ファイル枠を使い切りました。後でもう一度お試しください。",
        (Locale::Ja, MessageKey::AttachmentQueueFull) => "添付ファイルのキューが満杯です。後でもう一度お試しください。",
        (Locale::Ja, MessageKey::AttachmentTooMany) => "添付ファイルが多すぎます。最初の16個のみ処理しました。",
        (Locale::Ja, MessageKey::AttachmentSendFailed) => "添付ファイルの送信に失敗しました。",
        (Locale::Ja, MessageKey::AttachmentsSent) => "添付ファイルを送信しました。",
        (Locale::Ko, MessageKey::AttachmentProcessingFailed) => "첨부 파일 처리에 실패했습니다. ",
        (Locale::Ko, MessageKey::AttachmentQuotaExhausted) => "이 채팅의 첨부 파일 할당량을 모두 사용했습니다. 나중에 다시 시도하세요.",
        (Locale::Ko, MessageKey::AttachmentQueueFull) => "첨부 파일 대기열이 가득 찼습니다. 나중에 다시 시도하세요.",
        (Locale::Ko, MessageKey::AttachmentTooMany) => "첨부 파일이 너무 많습니다. 처음 16개만 처리했습니다.",
        (Locale::Ko, MessageKey::AttachmentSendFailed) => "첨부 파일 전송에 실패했습니다. ",
        (Locale::Ko, MessageKey::AttachmentsSent) => "첨부 파일을 보냈습니다.",
        (Locale::PtBr, MessageKey::AttachmentProcessingFailed) => "Falha ao processar o anexo: ",
        (Locale::PtBr, MessageKey::AttachmentQuotaExhausted) => "A cota de anexos deste chat esgotou; tente mais tarde.",
        (Locale::PtBr, MessageKey::AttachmentQueueFull) => "A fila de anexos está cheia; tente mais tarde.",
        (Locale::PtBr, MessageKey::AttachmentTooMany) => "Anexos demais; apenas os 16 primeiros foram processados.",
        (Locale::PtBr, MessageKey::AttachmentSendFailed) => "Falha ao enviar o anexo: ",
        (Locale::PtBr, MessageKey::AttachmentsSent) => "Anexos enviados.",
        (Locale::Ru, MessageKey::AttachmentProcessingFailed) => "Не удалось обработать вложение: ",
        (Locale::Ru, MessageKey::AttachmentQuotaExhausted) => "Квота вложений в этом чате исчерпана; повторите позже.",
        (Locale::Ru, MessageKey::AttachmentQueueFull) => "Очередь вложений заполнена; повторите позже.",
        (Locale::Ru, MessageKey::AttachmentTooMany) => "Слишком много вложений; обработаны только первые 16.",
        (Locale::Ru, MessageKey::AttachmentSendFailed) => "Не удалось отправить вложение: ",
        (Locale::Ru, MessageKey::AttachmentsSent) => "Вложения отправлены.",
        (Locale::Ta, MessageKey::AttachmentProcessingFailed) => "இணைப்பைச் செயலாக்க முடியவில்லை: ",
        (Locale::Ta, MessageKey::AttachmentQuotaExhausted) => "இந்த அரட்டையின் இணைப்பு ஒதுக்கீடு தீர்ந்தது; பிறகு முயலவும்.",
        (Locale::Ta, MessageKey::AttachmentQueueFull) => "இணைப்பு வரிசை நிரம்பியது; பிறகு முயலவும்.",
        (Locale::Ta, MessageKey::AttachmentTooMany) => "அதிக இணைப்புகள்; முதல் 16 மட்டும் செயலாக்கப்பட்டன.",
        (Locale::Ta, MessageKey::AttachmentSendFailed) => "இணைப்பை அனுப்ப முடியவில்லை: ",
        (Locale::Ta, MessageKey::AttachmentsSent) => "இணைப்புகள் அனுப்பப்பட்டன.",
        (Locale::Tr, MessageKey::AttachmentProcessingFailed) => "Ek işlenemedi: ",
        (Locale::Tr, MessageKey::AttachmentQuotaExhausted) => "Bu sohbetin ek kotası doldu; sonra tekrar deneyin.",
        (Locale::Tr, MessageKey::AttachmentQueueFull) => "Ek kuyruğu dolu; sonra tekrar deneyin.",
        (Locale::Tr, MessageKey::AttachmentTooMany) => "Çok fazla ek; yalnızca ilk 16 işlendi.",
        (Locale::Tr, MessageKey::AttachmentSendFailed) => "Ek gönderilemedi: ",
        (Locale::Tr, MessageKey::AttachmentsSent) => "Ekler gönderildi.",
        (Locale::Uk, MessageKey::AttachmentProcessingFailed) => "Не вдалося обробити вкладення: ",
        (Locale::Uk, MessageKey::AttachmentQuotaExhausted) => "Квоту вкладень у цьому чаті вичерпано; повторіть пізніше.",
        (Locale::Uk, MessageKey::AttachmentQueueFull) => "Черга вкладень заповнена; повторіть пізніше.",
        (Locale::Uk, MessageKey::AttachmentTooMany) => "Забагато вкладень; оброблено лише перші 16.",
        (Locale::Uk, MessageKey::AttachmentSendFailed) => "Не вдалося надіслати вкладення: ",
        (Locale::Uk, MessageKey::AttachmentsSent) => "Вкладення надіслано.",
        (Locale::Zh, MessageKey::AttachmentProcessingFailed) => "附件处理失败：",
        (Locale::Zh, MessageKey::AttachmentQuotaExhausted) => "本聊天附件额度已用完，请稍后再试。",
        (Locale::Zh, MessageKey::AttachmentQueueFull) => "附件队列已满，请稍后再试。",
        (Locale::Zh, MessageKey::AttachmentTooMany) => "附件过多，仅处理前 16 个。",
        (Locale::Zh, MessageKey::AttachmentSendFailed) => "附件发送失败：",
        (Locale::Zh, MessageKey::AttachmentsSent) => "附件已发送。",
        (Locale::ZhTw, MessageKey::AttachmentProcessingFailed) => "附件處理失敗：",
        (Locale::ZhTw, MessageKey::AttachmentQuotaExhausted) => "本聊天附件額度已用完，請稍後再試。",
        (Locale::ZhTw, MessageKey::AttachmentQueueFull) => "附件佇列已滿，請稍後再試。",
        (Locale::ZhTw, MessageKey::AttachmentTooMany) => "附件過多，僅處理前 16 個。",
        (Locale::ZhTw, MessageKey::AttachmentSendFailed) => "附件傳送失敗：",
        (Locale::ZhTw, MessageKey::AttachmentsSent) => "附件已傳送。",
        (_, MessageKey::AttachmentProcessingFailed) => "Attachment processing failed: ",
        (_, MessageKey::AttachmentQuotaExhausted) => {
            "Attachment quota for this chat is used up; try again later."
        }
        (_, MessageKey::AttachmentQueueFull) => "Attachment queue is full; try again later.",
        (_, MessageKey::AttachmentTooMany) => {
            "Too many attachments; only the first 16 were processed."
        }
        (_, MessageKey::AttachmentSendFailed) => "Attachment send failed: ",
        (_, MessageKey::AttachmentsSent) => "Attachments sent.",
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

    const ALL_TAGS: [&str; 15] = [
        "en", "de", "es", "fil", "fr", "id", "it", "ja", "ko", "pt-BR", "ru", "ta", "uk", "zh",
        "zh-TW",
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
        assert_eq!(
            t("ja", MessageKey::StopSignalSent),
            "中断信号を送信しました。"
        );
        assert_eq!(
            t("ko", MessageKey::NoInFlightTurn),
            "진행 중인 턴이 없습니다."
        );
        assert_eq!(t("de", MessageKey::NoInFlightTurn), "Kein laufender Zug.");
        assert_eq!(
            t("pt-BR", MessageKey::StopSignalSent),
            "Sinal de parada enviado."
        );
        assert_eq!(
            t("uk", MessageKey::StopSignalSent),
            "Сигнал зупинки надіслано."
        );
    }

    #[test]
    fn every_locale_answers_and_keeps_the_slash_command() {
        for tag in ALL_TAGS {
            for key in [
                MessageKey::StopSignalSent,
                MessageKey::NoInFlightTurn,
                MessageKey::NoAvailableProject,
                MessageKey::AttachmentProcessingFailed,
                MessageKey::AttachmentQuotaExhausted,
                MessageKey::AttachmentQueueFull,
                MessageKey::AttachmentTooMany,
                MessageKey::AttachmentSendFailed,
                MessageKey::AttachmentsSent,
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
