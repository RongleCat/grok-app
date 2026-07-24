//! Search App journal message bodies (messages.json) for sidebar content hits.
//!
//! Pure match/snippet helpers are unit-tested; `search_sessions` scans on-disk
//! journals with hard caps so the palette stays responsive.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::paths::session_dir;
use crate::store::{self, ChatMessageStored, SessionMeta};

/// Max sessions to open on disk (most recently updated first).
const MAX_SESSIONS_SCAN: usize = 200;
/// Skip journals larger than this (bytes).
const MAX_MESSAGES_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Snippet half-window around the first match (chars).
const SNIPPET_RADIUS: usize = 48;
/// Max snippet length returned to the UI.
const SNIPPET_MAX: usize = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContentHit {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// First matching excerpt with optional ellipsis.
    pub snippet: String,
    /// How many user/assistant messages contain the query.
    pub match_count: u32,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub archived: bool,
}

/// Count matching user/assistant messages and build a snippet from the first hit.
/// Case-insensitive substring. Empty query → `None`.
pub fn match_messages<'a, I>(query: &str, messages: I) -> Option<(u32, String)>
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    let q_lower = q.to_lowercase();
    let mut match_count = 0u32;
    let mut first_snippet: Option<String> = None;

    for (role, content) in messages {
        if role != "user" && role != "assistant" {
            continue;
        }
        if content.is_empty() {
            continue;
        }
        let lower = content.to_lowercase();
        if let Some(byte_idx) = lower.find(&q_lower) {
            match_count = match_count.saturating_add(1);
            if first_snippet.is_none() {
                first_snippet = Some(make_snippet(content, byte_idx, q.len()));
            }
        }
    }

    if match_count == 0 {
        None
    } else {
        Some((match_count, first_snippet.unwrap_or_default()))
    }
}

/// Build a single-line snippet around a UTF-8 byte offset into `content`.
pub fn make_snippet(content: &str, match_byte_idx: usize, match_len: usize) -> String {
    // Clamp to char boundaries.
    let start_byte = floor_char_boundary(content, match_byte_idx);
    let end_byte = ceil_char_boundary(
        content,
        match_byte_idx.saturating_add(match_len).min(content.len()),
    );

    let prefix = &content[..start_byte];
    let matched = &content[start_byte..end_byte];
    let suffix = &content[end_byte..];

    let prefix_chars: Vec<char> = prefix.chars().collect();
    let suffix_chars: Vec<char> = suffix.chars().collect();
    let matched_chars: Vec<char> = matched.chars().collect();

    let take_pre = SNIPPET_RADIUS.min(prefix_chars.len());
    let pre_slice = &prefix_chars[prefix_chars.len().saturating_sub(take_pre)..];
    let lead_ellipsis = prefix_chars.len() > take_pre;

    let mut out = String::new();
    if lead_ellipsis {
        out.push('…');
    }
    out.extend(pre_slice.iter().copied());
    out.extend(matched_chars.iter().copied());

    let room = SNIPPET_MAX.saturating_sub(out.chars().count());
    let take_suf = room.min(suffix_chars.len()).min(SNIPPET_RADIUS + 16);
    out.extend(suffix_chars.iter().take(take_suf).copied());
    if suffix_chars.len() > take_suf {
        out.push('…');
    }

    // Collapse whitespace for a single-line palette row.
    let collapsed: String = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > SNIPPET_MAX {
        let trimmed: String = collapsed
            .chars()
            .take(SNIPPET_MAX.saturating_sub(1))
            .collect();
        format!("{trimmed}…")
    } else {
        collapsed
    }
}

fn floor_char_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut i = i;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut i = i;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Scan App journal sessions for `query`. Caps work; skips huge files.
pub fn search_sessions(query: &str, limit: usize) -> Vec<SessionContentHit> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let limit = limit.clamp(1, 50);
    let index = store::load_sessions_index();
    let mut hits = Vec::new();

    for meta in index.into_iter().take(MAX_SESSIONS_SCAN) {
        // Match sidebar default: hide archived from content hits.
        if meta.archived {
            continue;
        }
        if let Some(hit) = scan_session(&meta, q) {
            hits.push(hit);
            if hits.len() >= limit {
                break;
            }
        }
    }
    hits
}

fn scan_session(meta: &SessionMeta, query: &str) -> Option<SessionContentHit> {
    let path = session_dir(&meta.id).join("messages.json");
    if !path.is_file() {
        return None;
    }
    if file_too_large(&path) {
        return None;
    }
    let messages: Vec<ChatMessageStored> = match fs::read_to_string(&path) {
        Ok(s) if s.trim().is_empty() => return None,
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => return None,
    };
    let iter = messages
        .iter()
        .map(|m| (m.role.as_str(), m.content.as_str()));
    let (match_count, snippet) = match_messages(query, iter)?;
    Some(SessionContentHit {
        id: meta.id.clone(),
        title: meta.title.clone(),
        project_id: meta.project_id.clone(),
        snippet,
        match_count,
        updated_at: meta.updated_at,
        archived: meta.archived,
    })
}

fn file_too_large(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(m) => m.len() > MAX_MESSAGES_FILE_BYTES,
        Err(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query_yields_none() {
        let msgs = [("user", "hello world")];
        assert!(match_messages("", msgs).is_none());
        assert!(match_messages("   ", msgs).is_none());
    }

    #[test]
    fn case_insensitive_substring() {
        let msgs = [
            ("user", "Please fix the Doctor reset button"),
            ("assistant", "Sure, I will patch it."),
            ("system", "doctor ignore me"),
        ];
        let (n, snip) = match_messages("doctor", msgs).expect("hit");
        // system role ignored; only user matches
        assert_eq!(n, 1);
        assert!(snip.to_lowercase().contains("doctor"));
    }

    #[test]
    fn counts_multiple_message_hits() {
        let msgs = [
            ("user", "alpha beta"),
            ("assistant", "reply without key"),
            ("user", "gamma beta again"),
            ("assistant", "BETA uppercase"),
        ];
        let (n, _) = match_messages("beta", msgs).expect("hit");
        assert_eq!(n, 3);
    }

    #[test]
    fn snippet_truncates_with_ellipsis() {
        let long_prefix = "word ".repeat(40);
        let content = format!("{long_prefix}TARGET rest of the message body continues here");
        let lower = content.to_lowercase();
        let idx = lower.find("target").unwrap();
        let snip = make_snippet(&content, idx, "TARGET".len());
        assert!(snip.contains("TARGET"));
        assert!(snip.starts_with('…'));
        assert!(snip.chars().count() <= SNIPPET_MAX + 1);
    }

    #[test]
    fn unicode_safe_snippet() {
        let content = "你好世界测试内容 TARGET 后面还有更多中文内容用于截断";
        let idx = content.find("TARGET").unwrap();
        let snip = make_snippet(content, idx, 6);
        assert!(snip.contains("TARGET"));
        assert!(!snip.is_empty());
    }

    #[test]
    fn search_sessions_empty_query() {
        assert!(search_sessions("", 10).is_empty());
    }
}
