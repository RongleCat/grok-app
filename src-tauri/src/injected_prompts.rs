//! Prompts the Host typed into a chat on its own.
//!
//! A PR-monitor wake, an external `--session-send`, an automation: the Host
//! dispatches a real turn, so the CLI journals it as a user message and the
//! transcript would read as if the user had said it. Remembering what we
//! injected lets the transcript mark that row (`auto_wake`), so a chat that
//! continues by itself shows an automatic follow-up instead of the user's own
//! message — and the assistant's answer stays attached to the turn before it.
//!
//! Matching is by the exact prompt text (digest), so a row the Host did not
//! write stays a normal user row: no false positives, and a row the CLI
//! rewrote simply goes unmarked.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Marker the transcript uses for a row the Host injected.
pub const MARKER: &str = "auto_wake";

const FILE: &str = "injected_prompts.jsonl";
/// Keep the file small: a long chat injects a handful of prompts, not hundreds.
const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    /// Digest of the exact prompt text.
    hash: String,
    /// Who injected it: `pr_monitor`, `external`, `automation`.
    origin: String,
    at: String,
}

fn path(session_id: &str) -> PathBuf {
    crate::paths::session_dir(session_id).join(FILE)
}

/// 64-bit FNV-1a over the prompt bytes: no dependency, stable across builds,
/// and enough to recognise a string this process wrote moments ago.
fn digest(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn read(session_id: &str) -> Vec<Entry> {
    let raw = fs::read_to_string(path(session_id)).unwrap_or_default();
    raw.lines()
        .filter_map(|line| serde_json::from_str::<Entry>(line.trim()).ok())
        .collect()
}

/// Remember one prompt the Host dispatched into `session_id`.
pub fn record(session_id: &str, prompt: &str, origin: &str) {
    let session = session_id.trim();
    let text = prompt.trim();
    if session.is_empty() || text.is_empty() {
        return;
    }
    let hash = digest(text);
    let mut entries = read(session);
    entries.retain(|e| e.hash != hash);
    entries.push(Entry {
        hash,
        origin: origin.to_string(),
        at: chrono::Utc::now().to_rfc3339(),
    });
    if entries.len() > MAX_ENTRIES {
        let drop = entries.len() - MAX_ENTRIES;
        entries.drain(0..drop);
    }
    let mut out = String::new();
    for entry in &entries {
        if let Ok(line) = serde_json::to_string(entry) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    let dir = crate::paths::session_dir(session);
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = crate::store_lock::write_bytes_replace(&path(session), out.as_bytes());
}

/// Origin when `text` is a prompt the Host injected into `session_id`; `None`
/// means the user typed it, and the row keeps its normal user treatment.
pub fn origin_for(session_id: &str, text: &str) -> Option<String> {
    let wanted = text.trim();
    if wanted.is_empty() {
        return None;
    }
    let hash = digest(wanted);
    read(session_id)
        .into_iter()
        .rev()
        .find(|e| e.hash == hash)
        .map(|e| e.origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stable_and_text_sensitive() {
        assert_eq!(digest("hello"), digest("hello"));
        assert_ne!(digest("hello"), digest("hello "));
        assert_ne!(digest("hello"), digest("hello!"));
    }

    #[test]
    fn empty_session_or_prompt_is_ignored() {
        assert!(origin_for("", "x").is_none());
        assert!(origin_for("s", "   ").is_none());
    }

    #[test]
    fn records_and_matches_one_prompt() {
        let session = format!("test-{}", uuid::Uuid::new_v4());
        record(&session, "[PR 更新] #1 wake", "pr_monitor");
        assert_eq!(
            origin_for(&session, "[PR 更新] #1 wake").as_deref(),
            Some("pr_monitor")
        );
        assert_eq!(origin_for(&session, "[PR 更新] #2 other"), None);
        // Trimmed compare: the journal may keep surrounding whitespace.
        assert_eq!(
            origin_for(&session, "  [PR 更新] #1 wake \n").as_deref(),
            Some("pr_monitor")
        );
        let _ = fs::remove_file(path(&session));
    }
}
