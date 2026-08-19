//! Tray / menu-bar copy — mirrors `tray.*` keys in `src/i18n/messages.ts`.
//! Native menus cannot use the frontend catalog; keep both sides in sync.
//!
//! The variant list, alias table and `as_tag` output must match `LOCALES` and
//! the alias map in `src/i18n/index.ts`. See docs/llm-wiki/i18n.md.

use crate::store;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    De,
    En,
    Es,
    Fil,
    Fr,
    Id,
    It,
    Ja,
    Ko,
    PtBr,
    Ru,
    Ta,
    Uk,
    Zh,
    ZhTw,
}

impl Locale {
    pub fn parse(raw: &str) -> Self {
        let v = raw.trim().to_ascii_lowercase();
        if v == "system" {
            return Locale::from_system();
        }
        // Everything else is a tag: reuse the one matcher so settings values and
        // OS tags can never diverge.
        Self::from_lang_tag(&v)
    }

    /// Best-effort map of OS UI language → catalog.
    /// Mirrors frontend `resolveLocaleFromSystem` for tray copy when preference
    /// is `"system"`. Prefers the GUI language (AppleLanguages / Windows UI
    /// LANGID) over POSIX `LANG=C` which Dock-launched apps often inherit.
    pub fn from_system() -> Self {
        Self::from_lang_tag(&detect_os_lang_tag())
    }

    /// Map a BCP-47 / POSIX language tag to a tray locale (pure; testable).
    /// Unknown languages fall back to `en`, matching `AppSettings::default`.
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

        // Chinese needs script/region inspection before the primary-subtag path.
        if primary == "zh" {
            let is_trad = bare
                .split('-')
                .any(|p| p == "hant" || p == "tw" || p == "hk" || p == "mo");
            return if is_trad { Locale::ZhTw } else { Locale::Zh };
        }

        match primary {
            "de" => Locale::De,
            "en" => Locale::En,
            "es" => Locale::Es,
            "fr" => Locale::Fr,
            "it" => Locale::It,
            "ja" => Locale::Ja,
            "ko" => Locale::Ko,
            "ru" => Locale::Ru,
            "ta" => Locale::Ta,
            "uk" => Locale::Uk,
            // Every Portuguese variant shares the pt-BR catalog.
            "pt" => Locale::PtBr,
            // `in` is Indonesian's retired ISO-639 code, still emitted by some
            // Java and POSIX stacks; `tl` (Tagalog) shares the Filipino catalog.
            "id" | "in" => Locale::Id,
            "fil" | "tl" => Locale::Fil,
            _ => Locale::En,
        }
    }

    /// Canonical catalog id shared with the frontend.
    pub fn as_tag(self) -> &'static str {
        match self {
            Locale::De => "de",
            Locale::En => "en",
            Locale::Es => "es",
            Locale::Fil => "fil",
            Locale::Fr => "fr",
            Locale::Id => "id",
            Locale::It => "it",
            Locale::Ja => "ja",
            Locale::Ko => "ko",
            Locale::PtBr => "pt-BR",
            Locale::Ru => "ru",
            Locale::Ta => "ta",
            Locale::Uk => "uk",
            Locale::Zh => "zh",
            Locale::ZhTw => "zh-TW",
        }
    }

    /// English name of the language, for prompts that must name a target
    /// language to a model (see `session_title.rs`).
    pub fn english_name(self) -> &'static str {
        match self {
            Locale::De => "German",
            Locale::En => "English",
            Locale::Es => "Spanish",
            Locale::Fil => "Filipino",
            Locale::Fr => "French",
            Locale::Id => "Indonesian",
            Locale::It => "Italian",
            Locale::Ja => "Japanese",
            Locale::Ko => "Korean",
            Locale::PtBr => "Brazilian Portuguese",
            Locale::Ru => "Russian",
            Locale::Ta => "Tamil",
            Locale::Uk => "Ukrainian",
            Locale::Zh => "Simplified Chinese",
            Locale::ZhTw => "Traditional Chinese",
        }
    }
}

/// Raw OS UI language tag (`zh-CN`, `zh_TW`, `ru-RU`, `en-US`, …). Empty if unknown.
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
/// Unknown primary languages return `None` so callers can fall through to
/// GetUserDefaultLocaleName (which covers locales without an entry here).
pub fn windows_langid_to_tag(id: u16) -> Option<&'static str> {
    const LANG_CHINESE: u16 = 0x04;
    const LANG_GERMAN: u16 = 0x07;
    const LANG_ENGLISH: u16 = 0x09;
    const LANG_SPANISH: u16 = 0x0a;
    const LANG_FRENCH: u16 = 0x0c;
    const LANG_ITALIAN: u16 = 0x10;
    const LANG_JAPANESE: u16 = 0x11;
    const LANG_KOREAN: u16 = 0x12;
    const LANG_PORTUGUESE: u16 = 0x16;
    const LANG_RUSSIAN: u16 = 0x19;
    const LANG_INDONESIAN: u16 = 0x21;
    const LANG_UKRAINIAN: u16 = 0x22;
    const LANG_TAMIL: u16 = 0x49;
    const LANG_FILIPINO: u16 = 0x64;

    let primary = id & 0x3ff;
    let sub = id >> 10;
    match primary {
        LANG_CHINESE => match sub {
            1 | 3 | 5 => Some("zh-TW"), // Traditional / HK / MO
            _ => Some("zh-CN"),
        },
        // SUBLANG_PORTUGUESE_BRAZILIAN is 1, SUBLANG_PORTUGUESE (Portugal) is 2.
        // Both share the pt-BR catalog, so the tag does not need to distinguish.
        LANG_PORTUGUESE => Some("pt-BR"),
        LANG_GERMAN => Some("de"),
        LANG_ENGLISH => Some("en"),
        LANG_SPANISH => Some("es"),
        LANG_FRENCH => Some("fr"),
        LANG_ITALIAN => Some("it"),
        LANG_JAPANESE => Some("ja"),
        LANG_KOREAN => Some("ko"),
        LANG_RUSSIAN => Some("ru"),
        LANG_INDONESIAN => Some("id"),
        LANG_UKRAINIAN => Some("uk"),

        LANG_TAMIL => Some("ta"),
        LANG_FILIPINO => Some("fil"),
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
    /// Native File/Window menu "Close" item (see `app_menu.rs`).
    pub close: &'static str,
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
    close: "Close",
    usage_with_reset: "Usage  ·  {pct}% left  ·  {time}",
    usage_pct: "Usage  ·  {pct}% left",
    usage_unknown: "Usage  ·  —",
};

const DE: TrayStrings = TrayStrings {
    recent: "Zuletzt",
    no_recent: "Keine kürzlichen Chats",
    untitled: "Ohne Titel",
    more: "Mehr",
    settings: "Einstellungen…",
    doctor: "Doctor",
    account: "Konto",
    new_chat: "Neuer Chat",
    open_app: "Grok öffnen",
    quit: "Grok beenden",
    tooltip: "Grok",
    close: "Schließen",
    usage_with_reset: "Nutzung  ·  {pct}% übrig  ·  {time}",
    usage_pct: "Nutzung  ·  {pct}% übrig",
    usage_unknown: "Nutzung  ·  —",
};

const ES: TrayStrings = TrayStrings {
    recent: "Recientes",
    no_recent: "No hay chats recientes",
    untitled: "Sin título",
    more: "Más",
    settings: "Ajustes…",
    doctor: "Doctor",
    account: "Cuenta",
    new_chat: "Nuevo chat",
    open_app: "Abrir Grok",
    quit: "Salir de Grok",
    tooltip: "Grok",
    close: "Cerrar",
    usage_with_reset: "Uso  ·  {pct}% restante  ·  {time}",
    usage_pct: "Uso  ·  {pct}% restante",
    usage_unknown: "Uso  ·  —",
};

const FIL: TrayStrings = TrayStrings {
    recent: "Kamakailan",
    no_recent: "Walang kamakailang chat",
    untitled: "Walang pamagat",
    more: "Higit pa",
    settings: "Mga setting…",
    doctor: "Doctor",
    account: "Account",
    new_chat: "Bagong chat",
    open_app: "Buksan ang Grok",
    quit: "Isara ang Grok",
    tooltip: "Grok",
    close: "Isara",
    usage_with_reset: "Paggamit  ·  {pct}% natitira  ·  {time}",
    usage_pct: "Paggamit  ·  {pct}% natitira",
    usage_unknown: "Paggamit  ·  —",
};

const FR: TrayStrings = TrayStrings {
    recent: "Récents",
    no_recent: "Aucune conversation récente",
    untitled: "Sans titre",
    more: "Plus",
    settings: "Réglages…",
    doctor: "Doctor",
    account: "Compte",
    new_chat: "Nouvelle conversation",
    open_app: "Ouvrir Grok",
    quit: "Quitter Grok",
    tooltip: "Grok",
    close: "Fermer",
    usage_with_reset: "Usage  ·  {pct}% restants  ·  {time}",
    usage_pct: "Usage  ·  {pct}% restants",
    usage_unknown: "Usage  ·  —",
};

const ID: TrayStrings = TrayStrings {
    recent: "Terbaru",
    no_recent: "Tidak ada obrolan terbaru",
    untitled: "Tanpa judul",
    more: "Lainnya",
    settings: "Pengaturan…",
    doctor: "Doctor",
    account: "Akun",
    new_chat: "Obrolan baru",
    open_app: "Buka Grok",
    quit: "Keluar dari Grok",
    tooltip: "Grok",
    close: "Tutup",
    usage_with_reset: "Pemakaian  ·  sisa {pct}%  ·  {time}",
    usage_pct: "Pemakaian  ·  sisa {pct}%",
    usage_unknown: "Pemakaian  ·  —",
};

const IT: TrayStrings = TrayStrings {
    recent: "Recenti",
    no_recent: "Nessuna chat recente",
    untitled: "Senza titolo",
    more: "Altro",
    settings: "Impostazioni…",
    doctor: "Doctor",
    account: "Account",
    new_chat: "Nuova chat",
    open_app: "Apri Grok",
    quit: "Esci da Grok",
    tooltip: "Grok",
    close: "Chiudi",
    usage_with_reset: "Utilizzo  ·  {pct}% rimasto  ·  {time}",
    usage_pct: "Utilizzo  ·  {pct}% rimasto",
    usage_unknown: "Utilizzo  ·  —",
};

const JA: TrayStrings = TrayStrings {
    recent: "最近",
    no_recent: "最近のチャットはありません",
    untitled: "無題",
    more: "その他",
    settings: "設定…",
    doctor: "ドクター",
    account: "アカウント",
    new_chat: "新しいチャット",
    open_app: "Grok を開く",
    quit: "Grok を終了",
    tooltip: "Grok",
    close: "閉じる",
    usage_with_reset: "使用量  ·  残り {pct}%  ·  {time}",
    usage_pct: "使用量  ·  残り {pct}%",
    usage_unknown: "使用量  ·  —",
};

const KO: TrayStrings = TrayStrings {
    recent: "최근",
    no_recent: "최근 대화 없음",
    untitled: "제목 없음",
    more: "더 보기",
    settings: "설정…",
    doctor: "닥터",
    account: "계정",
    new_chat: "새 대화",
    open_app: "Grok 열기",
    quit: "Grok 종료",
    tooltip: "Grok",
    close: "닫기",
    usage_with_reset: "사용량  ·  {pct}% 남음  ·  {time}",
    usage_pct: "사용량  ·  {pct}% 남음",
    usage_unknown: "사용량  ·  —",
};

const PT_BR: TrayStrings = TrayStrings {
    recent: "Recentes",
    no_recent: "Nenhuma conversa recente",
    untitled: "Sem título",
    more: "Mais",
    settings: "Configurações…",
    doctor: "Doctor",
    account: "Conta",
    new_chat: "Nova conversa",
    open_app: "Abrir o Grok",
    quit: "Sair do Grok",
    tooltip: "Grok",
    close: "Fechar",
    usage_with_reset: "Uso  ·  {pct}% restante  ·  {time}",
    usage_pct: "Uso  ·  {pct}% restante",
    usage_unknown: "Uso  ·  —",
};

const RU: TrayStrings = TrayStrings {
    recent: "Недавние",
    no_recent: "Нет недавних чатов",
    untitled: "Без названия",
    more: "Ещё",
    settings: "Настройки…",
    doctor: "Диагностика",
    account: "Аккаунт",
    new_chat: "Новый чат",
    open_app: "Открыть Grok",
    quit: "Выйти из Grok",
    tooltip: "Grok",
    close: "Закрыть",
    usage_with_reset: "Лимит  ·  осталось {pct}%  ·  {time}",
    usage_pct: "Лимит  ·  осталось {pct}%",
    usage_unknown: "Лимит  ·  —",
};

const TA: TrayStrings = TrayStrings {
    recent: "சமீபத்தியவை",
    no_recent: "சமீபத்திய உரையாடல்கள் இல்லை",
    untitled: "தலைப்பில்லாதது",
    more: "மேலும்",
    settings: "அமைப்புகள்…",
    doctor: "Doctor",
    account: "கணக்கு",
    new_chat: "புதிய உரையாடல்",
    open_app: "Grok ஐத் திற",
    quit: "Grok இலிருந்து வெளியேறு",
    tooltip: "Grok",
    close: "மூடு",
    usage_with_reset: "பயன்பாடு  ·  {pct}% மீதம்  ·  {time}",
    usage_pct: "பயன்பாடு  ·  {pct}% மீதம்",
    usage_unknown: "பயன்பாடு  ·  —",
};

const UK: TrayStrings = TrayStrings {
    recent: "Нещодавні",
    no_recent: "Немає нещодавніх чатів",
    untitled: "Без назви",
    more: "Ще",
    settings: "Налаштування…",
    doctor: "Діагностика",
    account: "Обліковий запис",
    new_chat: "Новий чат",
    open_app: "Відкрити Grok",
    quit: "Вийти з Grok",
    tooltip: "Grok",
    close: "Закрити",
    usage_with_reset: "Ліміт  ·  залишилось {pct}%  ·  {time}",
    usage_pct: "Ліміт  ·  залишилось {pct}%",
    usage_unknown: "Ліміт  ·  —",
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
    close: "关闭",
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
    close: "關閉",
    usage_with_reset: "額度  ·  剩餘 {pct}%  ·  {time}",
    usage_pct: "額度  ·  剩餘 {pct}%",
    usage_unknown: "額度  ·  —",
};

pub fn strings(locale: Locale) -> &'static TrayStrings {
    match locale {
        Locale::De => &DE,
        Locale::En => &EN,
        Locale::Es => &ES,
        Locale::Fil => &FIL,
        Locale::Fr => &FR,
        Locale::Id => &ID,
        Locale::It => &IT,
        Locale::Ja => &JA,
        Locale::Ko => &KO,
        Locale::PtBr => &PT_BR,
        Locale::Ru => &RU,
        Locale::Ta => &TA,
        Locale::Uk => &UK,
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

    /// Every catalog id shipped by the frontend (`LOCALES` in
    /// `src/i18n/messages/index.ts`), in the same order.
    const ALL: [Locale; 15] = [
        Locale::En,
        Locale::De,
        Locale::Es,
        Locale::Fil,
        Locale::Fr,
        Locale::Id,
        Locale::It,
        Locale::Ja,
        Locale::Ko,
        Locale::PtBr,
        Locale::Ru,
        Locale::Ta,
        Locale::Uk,
        Locale::Zh,
        Locale::ZhTw,
    ];

    #[test]
    fn locale_parse() {
        assert_eq!(Locale::parse("en"), Locale::En);
        assert_eq!(Locale::parse("EN-US"), Locale::En);
        assert_eq!(Locale::parse("ru"), Locale::Ru);
        assert_eq!(Locale::parse("RU-RU"), Locale::Ru);
        assert_eq!(Locale::parse("zh"), Locale::Zh);
        assert_eq!(Locale::parse(""), Locale::En);
        assert_eq!(Locale::parse("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::parse("zh-Hant"), Locale::ZhTw);
        assert_eq!(strings(Locale::Ru).settings, "Настройки…");
        assert_eq!(strings(Locale::ZhTw).settings, "設定…");
    }

    #[test]
    fn locale_parse_covers_every_shipped_catalog() {
        for l in ALL {
            // A catalog id must round-trip through the settings parser, or a
            // user who picks that language in Settings gets English chrome.
            assert_eq!(Locale::parse(l.as_tag()), l, "round-trip {}", l.as_tag());
        }
    }

    #[test]
    fn parse_accepts_new_locale_aliases() {
        assert_eq!(Locale::parse("ja-JP"), Locale::Ja);
        assert_eq!(Locale::parse("ko_KR"), Locale::Ko);
        assert_eq!(Locale::parse("de-AT"), Locale::De);
        assert_eq!(Locale::parse("es-419"), Locale::Es);
        assert_eq!(Locale::parse("fr-CA"), Locale::Fr);
        assert_eq!(Locale::parse("it-CH"), Locale::It);
        assert_eq!(Locale::parse("pt"), Locale::PtBr);
        assert_eq!(Locale::parse("pt-PT"), Locale::PtBr);
        assert_eq!(Locale::parse("pt-BR"), Locale::PtBr);
        assert_eq!(Locale::parse("uk-UA"), Locale::Uk);
        assert_eq!(Locale::parse("ta-IN"), Locale::Ta);
        assert_eq!(Locale::parse("ta-LK"), Locale::Ta);
        assert_eq!(Locale::parse("tl-PH"), Locale::Fil);
        assert_eq!(Locale::parse("fil-PH"), Locale::Fil);
        assert_eq!(Locale::parse("in-ID"), Locale::Id);
        assert_eq!(Locale::parse("id-ID"), Locale::Id);
    }

    #[test]
    fn tray_strings_are_non_empty_for_every_locale() {
        for l in ALL {
            let s = strings(l);
            for (field, v) in [
                ("recent", s.recent),
                ("no_recent", s.no_recent),
                ("untitled", s.untitled),
                ("more", s.more),
                ("settings", s.settings),
                ("doctor", s.doctor),
                ("account", s.account),
                ("new_chat", s.new_chat),
                ("open_app", s.open_app),
                ("quit", s.quit),
                ("tooltip", s.tooltip),
                ("close", s.close),
            ] {
                assert!(!v.trim().is_empty(), "{} {} is empty", l.as_tag(), field);
            }
            // Usage templates must keep their placeholders or the tray shows a
            // literal "{pct}" to the user.
            assert!(s.usage_pct.contains("{pct}"), "{} usage_pct", l.as_tag());
            assert!(
                s.usage_with_reset.contains("{pct}") && s.usage_with_reset.contains("{time}"),
                "{} usage_with_reset",
                l.as_tag()
            );
        }
    }

    #[test]
    fn as_tag_is_unique_per_locale() {
        let mut tags: Vec<&str> = ALL.iter().map(|l| l.as_tag()).collect();
        tags.sort_unstable();
        let before = tags.len();
        tags.dedup();
        assert_eq!(before, tags.len(), "duplicate catalog id in as_tag");
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
        assert!(!is_c_or_posix_locale("ru_RU.UTF-8"));
        assert!(!is_c_or_posix_locale("en_US"));
    }

    #[test]
    fn windows_langid_maps_ui_languages() {
        assert_eq!(windows_langid_to_tag(0x0804), Some("zh-CN"));
        assert_eq!(windows_langid_to_tag(0x0404), Some("zh-TW"));
        assert_eq!(windows_langid_to_tag(0x0C04), Some("zh-TW"));
        assert_eq!(windows_langid_to_tag(0x0409), Some("en"));
        assert_eq!(windows_langid_to_tag(0x0411), Some("ja"));
        assert_eq!(windows_langid_to_tag(0x0412), Some("ko"));
        assert_eq!(windows_langid_to_tag(0x0419), Some("ru"));
        assert_eq!(windows_langid_to_tag(0x0407), Some("de"));
        assert_eq!(windows_langid_to_tag(0x0C0A), Some("es"));
        assert_eq!(windows_langid_to_tag(0x040C), Some("fr"));
        assert_eq!(windows_langid_to_tag(0x0410), Some("it"));
        assert_eq!(windows_langid_to_tag(0x0416), Some("pt-BR")); // pt-BR
        assert_eq!(windows_langid_to_tag(0x0816), Some("pt-BR")); // pt-PT → same catalog
        assert_eq!(windows_langid_to_tag(0x0421), Some("id"));
        assert_eq!(windows_langid_to_tag(0x0422), Some("uk"));
        assert_eq!(windows_langid_to_tag(0x0449), Some("ta"));
        assert_eq!(windows_langid_to_tag(0x0464), Some("fil"));
        // Sanskrit / Hebrew LANGIDs are not product locales.
        assert_eq!(windows_langid_to_tag(0x044F), None);
        assert_eq!(windows_langid_to_tag(0x040D), None);
    }

    #[test]
    fn windows_langid_tags_resolve_to_the_expected_catalog() {
        for (id, expected) in [
            (0x0411u16, Locale::Ja),
            (0x0412, Locale::Ko),
            (0x0416, Locale::PtBr),
            (0x0816, Locale::PtBr),
            (0x0464, Locale::Fil),
            (0x0449, Locale::Ta),
        ] {
            let tag = windows_langid_to_tag(id).expect("langid mapped");
            assert_eq!(Locale::from_lang_tag(tag), expected, "langid {id:#06x}");
        }
    }

    #[test]
    fn from_lang_tag_maps_system_tags() {
        assert_eq!(Locale::from_lang_tag("en-US"), Locale::En);
        assert_eq!(Locale::from_lang_tag("ru-RU"), Locale::Ru);
        assert_eq!(Locale::from_lang_tag("ru_RU.UTF-8"), Locale::Ru);
        assert_eq!(Locale::from_lang_tag("zh_CN.UTF-8"), Locale::Zh);
        assert_eq!(Locale::from_lang_tag("zh-Hans-CN"), Locale::Zh);
        assert_eq!(Locale::from_lang_tag("zh-TW"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("zh-Hant-TW"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("zh-HK"), Locale::ZhTw);
        assert_eq!(Locale::from_lang_tag("ja_JP.UTF-8"), Locale::Ja);
        assert_eq!(Locale::from_lang_tag("fr_FR.UTF-8"), Locale::Fr);
        assert_eq!(Locale::from_lang_tag("pt_BR.UTF-8"), Locale::PtBr);
        // Still unsupported languages fall back to the product default.
        assert_eq!(Locale::from_lang_tag("he-IL"), Locale::En);
        assert_eq!(Locale::from_lang_tag("th-TH"), Locale::En);
        assert_eq!(Locale::from_lang_tag(""), Locale::En);
        assert_eq!(Locale::En.as_tag(), "en");
        assert_eq!(Locale::Ru.as_tag(), "ru");
        assert_eq!(Locale::Zh.as_tag(), "zh");
        assert_eq!(Locale::ZhTw.as_tag(), "zh-TW");
        assert_eq!(Locale::PtBr.as_tag(), "pt-BR");
    }

    #[test]
    fn usage_templates_fill() {
        let s = format_usage(EN.usage_with_reset, Some(73.2), Some("04-15 09:05"));
        assert_eq!(s, "Usage  ·  73% left  ·  04-15 09:05");
        let r = format_usage(RU.usage_pct, Some(73.0), None);
        assert_eq!(r, "Лимит  ·  осталось 73%");
        let z = format_usage(ZH.usage_pct, Some(73.0), None);
        assert_eq!(z, "额度  ·  剩余 73%");
        let j = format_usage(JA.usage_pct, Some(73.0), None);
        assert_eq!(j, "使用量  ·  残り 73%");
    }
}
