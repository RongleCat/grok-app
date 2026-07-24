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
    "新会话",
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
    {
        t = rest.trim().to_string();
    }
    if let Some(line) = t.lines().next() {
        t = line.trim().to_string();
    }
    if t.is_empty() || t.len() > 120 || is_placeholder_title(&t) {
        return None;
    }
    Some(truncate_chars(&t, 32))
}

/// Prompt for the headless title LLM, matching the app UI locale.
fn title_prompt(snippet: &str, locale: Locale) -> String {
    match locale {
        Locale::En => format!(
            "Write a short session title for the user message below.\nRequirements: at most 8 English words (or match the message language if it is not English); output the title only; no quotes, prefixes, or explanation.\n\nUser message:\n{snippet}"
        ),
        Locale::Zh => format!(
            "为下面这条用户消息起一个简短会话标题。要求：最多16个汉字或8个英文单词；只输出标题；不要引号、标点前缀、解释。\n\n用户消息：\n{snippet}"
        ),
    }
}

/// Call Grok CLI headless with low effort.
fn llm_title_via_cli(message: &str) -> Option<String> {
    let probe = cli_probe::probe_cli(None);
    let path = probe.path?;
    let snippet: String = message.chars().take(400).collect();
    let prompt = title_prompt(&snippet, tray_i18n::app_locale());

    let mut cmd = Command::new(&path);
    cmd.arg("-p")
        .arg(&prompt)
        .arg("--effort")
        .arg("low")
        .arg("--max-turns")
        .arg("1")
        .arg("--always-approve")
        .arg("--disallowed-tools")
        .arg(
            "run_terminal_cmd,run_terminal_command,web_search,web_fetch,search_replace,write,Agent,spawn_subagent,bash",
        );
    crate::process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }

    let output = std::thread::spawn(move || cmd.output())
        .join()
        .ok()?
        .ok()?;

    if !output.status.success() {
        tracing::debug!(
            "session title cli failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
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
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let msg = first_message.clone();
        std::thread::spawn(move || {
            let _ = tx.send(llm_title_via_cli(&msg));
        });
        let refined = rx.recv_timeout(Duration::from_secs(20)).ok().flatten();
        if let Some(title) = refined {
            // Do not clobber a manual rename: only replace placeholder / prior heuristic.
            let list = store::load_sessions_index();
            let Some(current) = list.iter().find(|s| s.id == id) else {
                return;
            };
            let heuristic = heuristic_title(&first_message);
            let can_overwrite =
                is_placeholder_title(&current.title) || current.title == heuristic;
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
        assert!(is_placeholder_title("New chat"));
        assert!(!is_placeholder_title("修权限条 bug"));
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
    fn title_prompt_follows_locale() {
        let en = title_prompt("list open prs", Locale::En);
        assert!(en.contains("User message:"));
        assert!(en.contains("list open prs"));
        assert!(!en.contains("用户消息"));

        let zh = title_prompt("list open prs", Locale::Zh);
        assert!(zh.contains("用户消息："));
        assert!(zh.contains("list open prs"));
        assert!(!zh.contains("User message:"));
    }
}
