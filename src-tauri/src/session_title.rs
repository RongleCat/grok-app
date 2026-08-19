//! Auto-title sessions from the first user message.
//! Instant heuristic + optional low-effort CLI refine (background).

use std::process::Command;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::cli_probe;
use crate::store::{self, SessionMeta};
use crate::tray_i18n::{self, Locale};

const PLACEHOLDERS: &[&str] = &[
    "New chat",
    "Новый чат",
    "Новая беседа",
    "Без названия",
    "新会话",
    "新对话",
    "新對話",
    "Untitled",
    "未命名",
    "New conversation",
    "新建会话",
];

pub fn is_placeholder_title(title: &str) -> bool {
    let t = title.trim();
    t.is_empty() || PLACEHOLDERS.iter().any(|p| p.eq_ignore_ascii_case(t))
}

/// Offline title: first non-empty line, collapsed whitespace, max ~28 display chars.
pub fn heuristic_title(message: &str) -> String {
    let line = message
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("Chat");
    let collapsed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, 28)
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn clean_llm_title(raw: &str) -> Option<String> {
    let mut t = raw.trim().to_string();
    // Drop CLI chrome / error lines that sometimes pollute stdout.
    let skip_line = |line: &str| -> bool {
        let l = line.trim();
        if l.is_empty() {
            return true;
        }
        let lower = l.to_ascii_lowercase();
        lower.starts_with("error:")
            || lower.starts_with("max turns")
            || lower.contains("max turns reached")
            || lower.starts_with("usage:")
            || lower.starts_with("{")
    };
    {
        let line = t.lines().map(str::trim).find(|l| !skip_line(l))?;
        t = line.to_string();
    }
    for _ in 0..3 {
        if (t.starts_with('"') && t.ends_with('"'))
            || (t.starts_with('「') && t.ends_with('」'))
            || (t.starts_with('“') && t.ends_with('”'))
            || (t.starts_with('\'') && t.ends_with('\''))
        {
            t = t[1..t.len() - 1].trim().to_string();
        }
    }
    if let Some(rest) = t
        .strip_prefix("标题：")
        .or_else(|| t.strip_prefix("标题:"))
        .or_else(|| t.strip_prefix("Title:"))
        .or_else(|| t.strip_prefix("Title："))
        .or_else(|| {
            t.strip_prefix("\u{417}\u{430}\u{433}\u{43e}\u{43b}\u{43e}\u{432}\u{43e}\u{43a}:")
        })
        .or_else(|| {
            t.strip_prefix("\u{417}\u{430}\u{433}\u{43e}\u{43b}\u{43e}\u{432}\u{43e}\u{43a}：")
        })
    {
        t = rest.trim().to_string();
    }
    if t.is_empty() || t.len() > 120 || is_placeholder_title(&t) {
        return None;
    }
    if skip_line(&t) {
        return None;
    }
    Some(truncate_chars(&t, 32))
}

/// Prompt for the headless title LLM, matching the app UI locale.
///
/// The four locales that shipped first keep their hand-written native prompts —
/// they are tuned and covered by tests. Every locale added since gets a generic
/// English-instruction prompt that names the target language, which the title
/// model follows reliably and which needs no re-tuning per language.
fn title_prompt(snippet: &str, locale: Locale) -> String {
    match locale {
        Locale::En => format!(
            "Write a short session title for the user message below.\nRequirements: at most 8 English words (or match the message language if it is not English); output the title only; no quotes, prefixes, or explanation.\n\nUser message:\n{snippet}"
        ),
        Locale::Ru => format!(
            "Придумай короткое название сессии для сообщения пользователя ниже.\nТребования: не более 8 слов; используй язык сообщения пользователя; выведи только название без кавычек, префиксов и пояснений.\n\nСообщение пользователя:\n{snippet}"
        ),
        Locale::Zh => format!(
            "为下面这条用户消息起一个简短会话标题。要求：最多16个汉字或8个英文单词；只输出标题；不要引号、标点前缀、解释。\n\n用户消息：\n{snippet}"
        ),
        Locale::ZhTw => format!(
            "為下面這則使用者訊息起一個簡短對話標題。要求：最多16個漢字或8個英文單詞；只輸出標題；不要引號、標點前綴、解釋。\n\n使用者訊息：\n{snippet}"
        ),
        other => {
            let language = other.english_name();
            format!(
                "Write a short session title in {language} for the user message below.\nRequirements: at most 8 words; write the title in {language}; output the title only; no quotes, prefixes, or explanation.\n\nUser message:\n{snippet}"
            )
        }
    }
}

/// Call Grok CLI headless with low effort.
fn llm_title_via_cli(message: &str) -> Option<String> {
    // Same settings path as other CLI call sites (doctor, session spawn, etc.).
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let path = probe.path?;
    let snippet: String = message.chars().take(400).collect();
    let prompt = title_prompt(&snippet, tray_i18n::app_locale());

    // Grok Build counts reasoning + answer as separate turns for some models;
    // `--max-turns 1` exits with "Max turns reached" and never prints a title.
    // Use 2, disable tools/subagents so the reply is plain text only.
    let mut cmd = Command::new(&path);
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--effort")
        .arg("low")
        .arg("--max-turns")
        .arg("2")
        .arg("--always-approve")
        .arg("--no-subagents")
        .arg("--disable-web-search")
        .arg("--disallowed-tools")
        .arg(
            "run_terminal_cmd,run_terminal_command,web_search,web_fetch,search_replace,write,Agent,spawn_subagent,bash,bash_tool",
        );
    crate::process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    crate::proxy::apply_to_std_command(&mut cmd);

    let output = std::thread::spawn(move || cmd.output()).join().ok()?.ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        // Prefer stdout when present (CLI sometimes prints the title then errors).
        if let Some(title) = clean_llm_title(&stdout) {
            return Some(title);
        }
        tracing::debug!(
            "session title cli failed: status={} stderr={} stdout={}",
            output.status,
            stderr.trim(),
            stdout.trim()
        );
        return None;
    }
    clean_llm_title(&stdout)
}

/// Immediate heuristic rename (if still placeholder). Spawns CLI refine in background.
pub fn auto_title_session_fast(id: &str, first_message: &str) -> Result<SessionMeta, String> {
    let list = store::load_sessions_index();
    let current = list
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| "session not found".to_string())?;

    if !is_placeholder_title(&current.title) {
        return Ok(current);
    }

    let heuristic = heuristic_title(first_message);
    store::rename_session(id, &heuristic)
}

/// Background refine via low-effort CLI; emits `session://title` when improved.
pub fn refine_title_in_background(
    app: AppHandle,
    mgr: std::sync::Arc<crate::session_manager::SessionManager>,
    id: String,
    first_message: String,
) {
    crate::process_util::spawn_named_catch("session-title-refine", move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let msg = first_message.clone();
        crate::process_util::spawn_named_catch("session-title-cli", move || {
            let _ = tx.send(llm_title_via_cli(&msg));
        });
        // Headless title often needs ~2 model turns (~10–25s); 20s was racing the CLI.
        let refined = rx.recv_timeout(Duration::from_secs(45)).ok().flatten();
        if let Some(title) = refined {
            // Do not clobber a manual rename: only replace placeholder / prior heuristic.
            let list = store::load_sessions_index();
            let Some(current) = list.iter().find(|s| s.id == id) else {
                return;
            };
            let heuristic = heuristic_title(&first_message);
            let can_overwrite = is_placeholder_title(&current.title) || current.title == heuristic;
            if !can_overwrite {
                return;
            }
            if let Ok(meta) = store::rename_session(&id, &title) {
                let _ = mgr.apply_title(&app, &meta.id, &meta.title);
                let _ = app.emit(
                    "session://title",
                    serde_json::json!({
                        "sessionId": meta.id,
                        "title": meta.title,
                    }),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders() {
        assert!(is_placeholder_title("新会话"));
        assert!(is_placeholder_title("新对话"));
        assert!(is_placeholder_title("新對話"));
        assert!(is_placeholder_title("New chat"));
        assert!(is_placeholder_title("Новый чат"));
        assert!(is_placeholder_title("Без названия"));
        assert!(!is_placeholder_title("修权限条 bug"));
        assert!(!is_placeholder_title("Исправить панель разрешений"));
        assert!(!is_placeholder_title("馬斯克最近有發什麼貼文"));
    }

    #[test]
    fn heuristic_uses_first_line() {
        let t = heuristic_title("  帮我改一下登录页样式\n第二行");
        assert!(t.contains("登录") || t.contains("帮我"));
        assert!(t.chars().count() <= 28);
    }

    #[test]
    fn clean_strips_quotes() {
        assert_eq!(
            clean_llm_title("  \"修复登录样式\" \n"),
            Some("修复登录样式".into())
        );
    }

    #[test]
    fn clean_strips_english_title_prefix() {
        assert_eq!(
            clean_llm_title("Title: List open PRs\n"),
            Some("List open PRs".into())
        );
    }

    #[test]
    fn clean_strips_russian_title_prefix() {
        assert_eq!(
            clean_llm_title("Заголовок: Исправить вход\n"),
            Some("Исправить вход".into())
        );
    }

    #[test]
    fn clean_rejects_max_turns_noise() {
        assert_eq!(clean_llm_title("Max turns reached\n"), None);
        assert_eq!(clean_llm_title("Error: max turns reached\n"), None);
        assert_eq!(
            clean_llm_title("修复登录样式\nMax turns reached\n"),
            Some("修复登录样式".into())
        );
    }

    #[test]
    fn title_prompt_follows_locale() {
        let en = title_prompt("list open prs", Locale::En);
        assert!(en.contains("User message:"));
        assert!(en.contains("list open prs"));
        assert!(!en.contains("用户消息"));

        let ru = title_prompt("исправить вход", Locale::Ru);
        assert!(ru.contains("Сообщение пользователя:"));
        assert!(ru.contains("Придумай короткое название сессии"));
        assert!(ru.contains("исправить вход"));
        assert!(!ru.contains("User message:"));

        let zh = title_prompt("list open prs", Locale::Zh);
        assert!(zh.contains("用户消息："));
        assert!(zh.contains("为下面这条用户消息"));
        assert!(zh.contains("list open prs"));
        assert!(!zh.contains("User message:"));

        let zhtw = title_prompt("list open prs", Locale::ZhTw);
        assert!(zhtw.contains("為下面這則使用者訊息"));
        assert!(zhtw.contains("使用者訊息："));
        assert!(zhtw.contains("list open prs"));
        assert!(!zhtw.contains("为下面这条用户消息"));
        assert!(!zhtw.contains("User message:"));
    }

    #[test]
    fn title_prompt_names_the_target_language_for_added_locales() {
        for (locale, language) in [
            (Locale::Ja, "Japanese"),
            (Locale::Ko, "Korean"),
            (Locale::De, "German"),
            (Locale::PtBr, "Brazilian Portuguese"),
            (Locale::Ta, "Tamil"),
        ] {
            let p = title_prompt("list open prs", locale);
            assert!(
                p.contains(language),
                "{} prompt must name {language}",
                locale.as_tag()
            );
            assert!(p.contains("list open prs"), "{} keeps the snippet", locale.as_tag());
            assert!(p.contains("User message:"), "{} keeps the anchor", locale.as_tag());
        }
    }
}
