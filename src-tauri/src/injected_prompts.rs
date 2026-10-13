//! Prompts the Host typed into a chat on its own.
//!
//! A PR-monitor wake and an external `--session-send` both dispatch a real turn,
//! so the CLI journals them as user messages and the transcript would read as if
//! the user had said it ("I sent this and never typed it"). The Host knows which
//! prompts are its own, so it remembers them here and the transcript marks those
//! rows (`auto_wake`): an automatic follow-up that stays inside the turn before
//! it, instead of a new question from the user.
//!
//! Today the PR-monitor wake (`pr_monitor`) and the external session API
//! (`external`) record themselves; the automations runner does not yet.
//!
//! Matching is by the exact prompt text (digest), so a row the Host did not
//! write stays a normal user row: no false positives, and a row the CLI rewrote
//! simply goes unmarked.

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
    /// Who injected it (`pr_monitor`, `external`): kept so a support bundle can
    /// tell why a row was marked, even though the transcript only needs to know
    /// that it *was*.
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
///
/// Read-modify-write under the store lock: wakes are delivered per watch, so two
/// injections can land at the same time and must not drop each other's entry.
pub fn record(session_id: &str, prompt: &str, origin: &str) {
    let session = session_id.trim();
    let text = prompt.trim();
    if session.is_empty() || text.is_empty() {
        return;
    }
    let file = path(session);
    let Ok(_guard) = crate::store_lock::lock_exclusive(&file) else {
        return;
    };
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
    let _ = crate::store_lock::write_bytes_replace(&file, out.as_bytes());
}

/// The marker for a user row holding `text`, when the Host injected that exact
/// prompt into `session_id`. `None` = the user typed it: a normal user row.
pub fn row_marker(session_id: &str, text: &str) -> Option<String> {
    let wanted = text.trim();
    if session_id.trim().is_empty() || wanted.is_empty() {
        return None;
    }
    let hash = digest(wanted);
    read(session_id)
        .into_iter()
        .rev()
        .any(|e| e.hash == hash)
        .then(|| MARKER.to_string())
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
        assert!(row_marker("", "x").is_none());
        assert!(row_marker("s", "   ").is_none());
    }

    #[test]
    fn records_and_matches_one_prompt() {
        let session = format!("test-{}", uuid::Uuid::new_v4());
        record(&session, "[PR 更新] #1 wake", "pr_monitor");
        assert!(row_marker(&session, "[PR 更新] #1 wake").is_some());
        assert!(row_marker(&session, "[PR 更新] #2 other").is_none());
        // Trimmed compare: the journal may keep surrounding whitespace.
        assert!(row_marker(&session, "  [PR 更新] #1 wake \n").is_some());
        // Re-recording the same text keeps one entry, not two.
        record(&session, "[PR 更新] #1 wake", "pr_monitor");
        assert_eq!(read(&session).len(), 1);
        let _ = fs::remove_file(path(&session));
        let _ = fs::remove_file(crate::store_lock::lock_path_for(&path(&session)));
    }
}
