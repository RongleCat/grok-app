//! Discover / import Grok Build CLI sessions from GROK_HOME (shared mode E03).
//!
//! Layout: `{GROK_HOME}/sessions/{percent-encoded-cwd}/{agent_session_id}/`
//!   - summary.json — title, timestamps, cwd
//!   - chat_history.jsonl — line-delimited messages

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::paths::resolve_agent_grok_home;
use crate::store::{self, ChatMessageStored, SessionMeta};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSessionSummary {
    pub agent_session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub updated_at: String,
    pub dir: String,
    pub num_messages: u32,
    /// App already has a session row pointing at this agent id.
    pub already_linked: bool,
}

#[derive(Debug, Deserialize)]
struct SummaryFile {
    #[serde(default)]
    info: Option<SummaryInfo>,
    #[serde(default)]
    session_summary: Option<String>,
    #[serde(default)]
    generated_title: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    last_active_at: Option<String>,
    #[serde(default)]
    num_messages: Option<u32>,
    #[serde(default)]
    num_chat_messages: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SummaryInfo {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

/// List CLI agent sessions under the active GROK_HOME (respects session_data_mode).
pub fn list_cli_sessions(session_data_mode: &str) -> Result<Vec<CliSessionSummary>, String> {
    let home = resolve_agent_grok_home(session_data_mode);
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return Ok(Vec::new());
    }

    let linked: std::collections::HashSet<String> = store::load_sessions_index()
        .into_iter()
        .filter_map(|s| s.agent_session_id)
        .collect();

    let mut out = Vec::new();
    let cwd_dirs = fs::read_dir(&sessions).map_err(|e| e.to_string())?;
    for cwd_ent in cwd_dirs.flatten() {
        let cwd_path = cwd_ent.path();
        if !cwd_path.is_dir() {
            continue;
        }
        let cwd_decoded = percent_decode_component(
            cwd_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(""),
        );
        let Ok(sid_dirs) = fs::read_dir(&cwd_path) else {
            continue;
        };
        for sid_ent in sid_dirs.flatten() {
            let dir = sid_ent.path();
            if !dir.is_dir() {
                continue;
            }
            let agent_id = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if agent_id.is_empty() || agent_id.starts_with('.') {
                continue;
            }
            let summary_path = dir.join("summary.json");
            if !summary_path.is_file() && !dir.join("chat_history.jsonl").is_file() {
                continue;
            }
            let (title, cwd, updated, n) = read_summary_bits(&summary_path, &cwd_decoded, &agent_id);
            out.push(CliSessionSummary {
                already_linked: linked.contains(&agent_id),
                agent_session_id: agent_id,
                title,
                cwd,
                updated_at: updated,
                dir: dir.display().to_string(),
                num_messages: n,
            });
        }
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    // Cap list for UI.
    if out.len() > 200 {
        out.truncate(200);
    }
    Ok(out)
}

fn read_summary_bits(
    summary_path: &Path,
    cwd_fallback: &str,
    agent_id: &str,
) -> (String, Option<String>, String, u32) {
    let raw = fs::read_to_string(summary_path).unwrap_or_default();
    let parsed: SummaryFile = serde_json::from_str(&raw).unwrap_or(SummaryFile {
        info: None,
        session_summary: None,
        generated_title: None,
        created_at: None,
        updated_at: None,
        last_active_at: None,
        num_messages: None,
        num_chat_messages: None,
    });
    let title = parsed
        .generated_title
        .or(parsed.session_summary)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("CLI {}", &agent_id.chars().take(8).collect::<String>()));
    let cwd = parsed
        .info
        .as_ref()
        .and_then(|i| i.cwd.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            if cwd_fallback.is_empty() {
                None
            } else {
                Some(cwd_fallback.to_string())
            }
        });
    let updated = parsed
        .last_active_at
        .or(parsed.updated_at)
        .or(parsed.created_at)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let n = parsed
        .num_chat_messages
        .or(parsed.num_messages)
        .unwrap_or(0);
    (title, cwd, updated, n)
}

/// Decode encodeURIComponent-style path segments used by Grok Build.
pub fn percent_decode_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = || {
                let a = (bytes[i + 1] as char).to_digit(16)?;
                let b = (bytes[i + 2] as char).to_digit(16)?;
                Some(((a << 4) | b) as u8)
            };
            if let Some(v) = h() {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_to_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(t.to_string());
                } else if let Some(t) = item.as_str() {
                    parts.push(t.to_string());
                }
            }
            parts.join("\n")
        }
        Value::Object(map) => map
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

/// Parse CLI `chat_history.jsonl` into (role, content) pairs for the App journal.
pub fn parse_chat_history_jsonl(path: &Path) -> Result<Vec<(String, String)>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read chat_history: {e}"))?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue, // skip broken lines
        };
        let typ = v
            .get("type")
            .or_else(|| v.get("role"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let role = match typ {
            "user" => "user",
            "assistant" => "assistant",
            _ => continue,
        };
        let content = v
            .get("content")
            .map(content_to_text)
            .unwrap_or_default();
        let content = content.trim().to_string();
        if content.is_empty() {
            continue;
        }
        // Drop huge system-y user envelopes when possible — keep query body.
        let content = extract_user_query(&content).unwrap_or(content);
        if content.is_empty() {
            continue;
        }
        out.push((role.to_string(), content));
    }
    if out.is_empty() {
        return Err("no user/assistant messages in chat_history.jsonl".into());
    }
    Ok(out)
}

fn extract_user_query(content: &str) -> Option<String> {
    let start = content.find("<user_query>")?;
    let rest = &content[start + "<user_query>".len()..];
    let end = rest.find("</user_query>")?;
    let q = rest[..end].trim();
    if q.is_empty() {
        None
    } else {
        Some(q.to_string())
    }
}

/// Import one CLI session into the App journal (independent App session row).
pub fn import_cli_session(
    agent_session_id: &str,
    dir: Option<&str>,
    project_id: Option<String>,
    session_data_mode: &str,
) -> Result<SessionMeta, String> {
    if session_data_mode != "shared" {
        return Err(
            "CLI session import requires shared session data mode (Settings → General)".into(),
        );
    }
    let dir = if let Some(d) = dir.filter(|s| !s.is_empty()) {
        PathBuf::from(d)
    } else {
        crate::paths::find_agent_session_dir(agent_session_id, None, session_data_mode)
            .ok_or_else(|| format!("CLI session dir not found for {agent_session_id}"))?
    };
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }

    // Already linked?
    if let Some(existing) = store::load_sessions_index()
        .into_iter()
        .find(|s| s.agent_session_id.as_deref() == Some(agent_session_id))
    {
        return Ok(existing);
    }

    let summary_path = dir.join("summary.json");
    let cwd_name = dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let (title, cwd, _, _) = read_summary_bits(
        &summary_path,
        &percent_decode_component(cwd_name),
        agent_session_id,
    );

    let history = dir.join("chat_history.jsonl");
    let pairs = parse_chat_history_jsonl(&history)?;

    // Prefer matching App project by path.
    let project_id = project_id.or_else(|| {
        let cwd = cwd.as_deref()?;
        store::load_projects()
            .into_iter()
            .find(|p| {
                let a = p.path.trim_end_matches('/').trim_end_matches('\\');
                let b = cwd.trim_end_matches('/').trim_end_matches('\\');
                a == b
            })
            .map(|p| p.id)
    });

    let mut meta = store::create_session(project_id, Some(title), false)?;
    meta.agent_session_id = Some(agent_session_id.to_string());
    let now = Utc::now();
    let msgs: Vec<ChatMessageStored> = pairs
        .into_iter()
        .enumerate()
        .map(|(i, (role, content))| ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role,
            content,
            thought: None,
            created_at: now + chrono::Duration::milliseconds(i as i64),
            is_error: false,
            attachments: None,
            marker: None,
        })
        .collect();
    store::save_messages(&meta.id, &msgs)?;
    meta.updated_at = now;
    // Persist agent_session_id link.
    let mut list = store::load_sessions_index();
    if let Some(row) = list.iter_mut().find(|s| s.id == meta.id) {
        row.agent_session_id = meta.agent_session_id.clone();
        row.updated_at = now;
        meta = row.clone();
    }
    store::save_sessions_index(&list)?;
    Ok(meta)
}

/// Import all not-yet-linked CLI sessions (capped).
pub fn import_all_cli_sessions(
    session_data_mode: &str,
    limit: usize,
) -> Result<Vec<SessionMeta>, String> {
    let list = list_cli_sessions(session_data_mode)?;
    let mut imported = Vec::new();
    for s in list.into_iter().filter(|s| !s.already_linked).take(limit) {
        match import_cli_session(
            &s.agent_session_id,
            Some(&s.dir),
            None,
            session_data_mode,
        ) {
            Ok(m) => imported.push(m),
            Err(e) => tracing::warn!("cli import skip {}: {e}", s.agent_session_id),
        }
    }
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    use crate::paths::percent_encode_path_component;

    #[test]
    fn percent_decode_roundtrip_path() {
        let enc = percent_encode_path_component("/Users/me/Code/oss/pq");
        assert!(enc.contains("%2F"));
        assert_eq!(
            percent_decode_component(&enc),
            "/Users/me/Code/oss/pq"
        );
    }

    #[test]
    fn parse_jsonl_user_assistant() {
        let dir = std::env::temp_dir().join(format!("cli-hist-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat_history.jsonl");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(
            f,
            r#"{{"type":"system","content":"sys"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"user","content":[{{"type":"text","text":"<user_query>\nhello world\n</user_query>"}}]}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"assistant","content":"hi there"}}"#
        )
        .unwrap();
        let pairs = parse_chat_history_jsonl(&path).unwrap();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "user");
        assert_eq!(pairs[0].1, "hello world");
        assert_eq!(pairs[1].0, "assistant");
        assert_eq!(pairs[1].1, "hi there");
        let _ = fs::remove_dir_all(&dir);
    }
}
