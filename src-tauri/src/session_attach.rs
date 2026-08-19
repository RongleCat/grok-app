//! Attach another App session as *context* on send (not a journal merge).
//!
//! UI stores `[[chat:<uuid>]]` tokens in the user-bubble / display text.
//! Host expands those ids into a compact transcript prefix for the agent only.

use crate::store::{self, ChatMessageStored};

/// Same compact budget as history bootstrap (session-continuity.md).
pub const ATTACH_MAX_SESSIONS: usize = 3;
pub const ATTACH_MAX_MSGS: usize = 16;
pub const ATTACH_MAX_MSGS_FULL: usize = 40;
pub const ATTACH_PER_MSG_CHARS: usize = 2_000;
pub const ATTACH_MAX_CHARS: usize = 14_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachScope {
    Recent,
    User,
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedChatSpec {
    pub id: String,
    pub scope: AttachScope,
}

fn parse_chat_inner(inner: &str) -> Option<AttachedChatSpec> {
    if inner.len() < 36 {
        return None;
    }
    let id = &inner[..36];
    if !is_uuid(id) {
        return None;
    }
    let scope = match &inner[36..] {
        "" | ":recent" => AttachScope::Recent,
        ":user" => AttachScope::User,
        ":full" => AttachScope::Full,
        _ => return None,
    };
    Some(AttachedChatSpec {
        id: id.to_string(),
        scope,
    })
}

const TOKEN_OPEN: &str = "[[chat:";
const TOKEN_CLOSE: &str = "]]";

fn is_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    for (i, c) in b.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            if *c != b'-' {
                return false;
            }
        } else if !c.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// Ordered unique attached chats (`[[chat:<uuid>]]` or `[[chat:<uuid>:user|full]]`).
pub fn extract_attached_chats(text: &str) -> Vec<AttachedChatSpec> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(TOKEN_OPEN) {
        let after = &rest[start + TOKEN_OPEN.len()..];
        let Some(end) = after.find(TOKEN_CLOSE) else {
            break;
        };
        if let Some(spec) = parse_chat_inner(&after[..end]) {
            if !out.iter().any(|x: &AttachedChatSpec| x.id == spec.id) {
                out.push(spec);
            }
        }
        rest = &after[end + TOKEN_CLOSE.len()..];
    }
    out
}

/// Ordered unique session ids from `[[chat:<uuid>]]` tokens.
pub fn extract_chat_session_ids(text: &str) -> Vec<String> {
    extract_attached_chats(text)
        .into_iter()
        .map(|s| s.id)
        .collect()
}

/// Drop `[[chat:<uuid>]]` tokens. Leaves surrounding text intact.
pub fn strip_chat_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(TOKEN_OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + TOKEN_OPEN.len()..];
        match after.find(TOKEN_CLOSE) {
            Some(end) if parse_chat_inner(&after[..end]).is_some() => {
                rest = &after[end + TOKEN_CLOSE.len()..];
            }
            _ => {
                out.push_str(TOKEN_OPEN);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// How nested `[[chat:…]]` tokens inside a compacted turn are rewritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NestedAttach {
    /// Short placeholder — used when compacting a *source* chat (no recursion).
    Stub,
    /// One-level expand of the source journal — used on history bootstrap so a
    /// recycled agent still sees attach context (or an explicit stub).
    Expand,
}

/// Typed send failure when the user sent only attach chips.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachSendError {
    NotFound,
    NoTranscript,
}

impl AttachSendError {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotFound => "attached chat not found",
            Self::NoTranscript => "no transcript",
        }
    }
}

impl std::fmt::Display for AttachSendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Journal access for attach expand / send. Tests inject a map; Host uses disk.
pub trait AttachJournal {
    fn exists(&self, id: &str) -> bool;
    fn load(&self, id: &str) -> Vec<ChatMessageStored>;
    fn title(&self, id: &str) -> String;
}

pub struct StoreAttachJournal;

impl AttachJournal for StoreAttachJournal {
    fn exists(&self, id: &str) -> bool {
        crate::paths::session_dir(id)
            .join("messages.json")
            .is_file()
    }

    fn load(&self, id: &str) -> Vec<ChatMessageStored> {
        store::load_messages(id)
    }

    fn title(&self, id: &str) -> String {
        session_title(id)
    }
}

const NESTED_EXPAND_MAX_MSGS: usize = 8;
const NESTED_EXPAND_PER_MSG: usize = 800;
const NESTED_EXPAND_MAX_CHARS: usize = 4_000;

fn session_title(id: &str) -> String {
    store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.title.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled".into())
}

pub fn attach_stub(title: &str, id: &str) -> String {
    format!("[attached conversation “{title}” ({id})]")
}

fn rewrite_chat_tokens(text: &str, mode: NestedAttach, journal: &impl AttachJournal) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(TOKEN_OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + TOKEN_OPEN.len()..];
        match after.find(TOKEN_CLOSE) {
            Some(end) if parse_chat_inner(&after[..end]).is_some() => {
                let spec = parse_chat_inner(&after[..end]).expect("checked");
                out.push_str(&rewrite_one_token(&spec, mode, journal));
                rest = &after[end + TOKEN_CLOSE.len()..];
            }
            _ => {
                out.push_str(TOKEN_OPEN);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

fn rewrite_one_token(
    spec: &AttachedChatSpec,
    mode: NestedAttach,
    journal: &impl AttachJournal,
) -> String {
    let title = journal.title(&spec.id);
    let stub = attach_stub(&title, &spec.id);
    if mode == NestedAttach::Stub {
        return stub;
    }
    if !journal.exists(&spec.id) {
        return stub;
    }
    let mut msgs = journal.load(&spec.id);
    if spec.scope == AttachScope::User {
        msgs.retain(|m| m.role == "user");
    }
    match compact_user_assistant_turns_with(
        &msgs,
        NESTED_EXPAND_MAX_MSGS,
        NESTED_EXPAND_PER_MSG,
        NESTED_EXPAND_MAX_CHARS,
        NestedAttach::Stub,
        journal,
    ) {
        Some(turns) => turns,
        None => stub,
    }
}

/// Compact user/assistant turns into markdown blocks (no wrapper).
///
/// Char budget is applied **newest-first**: oldest turns drop when over budget.
pub fn compact_user_assistant_turns(
    msgs: &[ChatMessageStored],
    max_msgs: usize,
    per_msg_chars: usize,
    max_chars: usize,
) -> Option<String> {
    compact_user_assistant_turns_with(
        msgs,
        max_msgs,
        per_msg_chars,
        max_chars,
        NestedAttach::Stub,
        &StoreAttachJournal,
    )
}

pub fn compact_user_assistant_turns_with(
    msgs: &[ChatMessageStored],
    max_msgs: usize,
    per_msg_chars: usize,
    max_chars: usize,
    nested: NestedAttach,
    journal: &impl AttachJournal,
) -> Option<String> {
    let mut picked: Vec<&ChatMessageStored> = Vec::new();
    for m in msgs.iter().rev() {
        if m.role != "user" && m.role != "assistant" {
            continue;
        }
        if m.content.trim().is_empty() {
            continue;
        }
        picked.push(m);
        if picked.len() >= max_msgs {
            break;
        }
    }
    if picked.is_empty() {
        return None;
    }
    picked.reverse();

    let mut blocks: Vec<String> = Vec::new();
    for m in picked {
        let role = if m.role == "user" {
            "User"
        } else if m.is_error {
            "Assistant (error)"
        } else {
            "Assistant"
        };
        let mut content = rewrite_chat_tokens(m.content.trim(), nested, journal);
        if content.is_empty() {
            continue;
        }
        if content.len() > per_msg_chars {
            let keep = per_msg_chars.saturating_sub(40);
            content = format!(
                "{}…\n[truncated {} chars]",
                content.chars().take(keep).collect::<String>(),
                m.content.len()
            );
        }
        blocks.push(format!("### {role}\n{content}\n\n"));
    }
    if blocks.is_empty() {
        return None;
    }

    let mut total: usize = blocks.iter().map(|b| b.len()).sum();
    let mut omitted = 0usize;
    while blocks.len() > 1 && total > max_chars {
        let dropped = blocks.remove(0);
        total = total.saturating_sub(dropped.len());
        omitted += 1;
    }
    if omitted > 0 {
        let marker = "### …\n[earlier turns omitted for length]\n\n";
        if marker.len() + total > max_chars && !blocks.is_empty() {
            // Keep the newest block even if it alone is over budget.
        }
        let mut body = String::from(marker);
        body.push_str(&blocks.concat());
        return Some(body);
    }
    if total > max_chars {
        // Single remaining block — keep newest rather than drop it.
    }
    let body = blocks.concat();
    if body.trim().is_empty() {
        None
    } else {
        Some(body)
    }
}

fn wrap_attached_block(title: &str, id: &str, turns: &str) -> String {
    format!(
        "[Attached conversation — \"{title}\" ({id}). Context only.\n\
Rules: do NOT re-greet; do NOT quote or reprint this transcript; \
do NOT re-answer prior turns; use it only as background for the user's new message below.]\n\n\
{turns}\
---\n[End of attached conversation \"{title}\".]\n"
    )
}

/// Build the agent-only prefix for attached chats. Skips self + missing journals.
pub fn build_attached_chats_context(
    specs: &[AttachedChatSpec],
    current_id: &str,
) -> Option<String> {
    build_attached_chats_context_with(specs, current_id, &StoreAttachJournal)
}

pub fn build_attached_chats_context_with(
    specs: &[AttachedChatSpec],
    current_id: &str,
    journal: &impl AttachJournal,
) -> Option<String> {
    let collected = collect_attached_blocks(specs, current_id, journal);
    if collected.blocks.is_empty() {
        None
    } else {
        Some(collected.blocks.join("\n"))
    }
}

struct CollectedAttach {
    blocks: Vec<String>,
    missing: usize,
    empty: usize,
}

fn collect_attached_blocks(
    specs: &[AttachedChatSpec],
    current_id: &str,
    journal: &impl AttachJournal,
) -> CollectedAttach {
    let mut out = CollectedAttach {
        blocks: Vec::new(),
        missing: 0,
        empty: 0,
    };
    for spec in specs.iter().take(ATTACH_MAX_SESSIONS) {
        let id = spec.id.as_str();
        if id == current_id || !is_uuid(id) {
            continue;
        }
        if !journal.exists(id) {
            out.missing += 1;
            continue;
        }
        let mut msgs = journal.load(id);
        if spec.scope == AttachScope::User {
            msgs.retain(|m| m.role == "user");
        }
        let max_msgs = match spec.scope {
            AttachScope::Full => ATTACH_MAX_MSGS_FULL,
            AttachScope::Recent | AttachScope::User => ATTACH_MAX_MSGS,
        };
        let Some(turns) = compact_user_assistant_turns_with(
            &msgs,
            max_msgs,
            ATTACH_PER_MSG_CHARS,
            ATTACH_MAX_CHARS,
            NestedAttach::Stub,
            journal,
        ) else {
            out.empty += 1;
            continue;
        };
        let title = journal.title(id);
        out.blocks.push(wrap_attached_block(&title, id, &turns));
    }
    out
}

/// Shipped send-path decision: prefix attach context or return a typed error
/// when the user sent only chips and no source transcript is available.
pub fn agent_prompt_after_attach(
    stripped_user_text: &str,
    specs: &[AttachedChatSpec],
    current_id: &str,
    journal: &impl AttachJournal,
) -> Result<String, AttachSendError> {
    if specs.is_empty() {
        return Ok(stripped_user_text.to_string());
    }
    let collected = collect_attached_blocks(specs, current_id, journal);
    if collected.blocks.is_empty() {
        if stripped_user_text.is_empty() {
            if collected.missing > 0 {
                return Err(AttachSendError::NotFound);
            }
            return Err(AttachSendError::NoTranscript);
        }
        return Ok(stripped_user_text.to_string());
    }
    let ctx = collected.blocks.join("\n");
    if stripped_user_text.is_empty() {
        Ok(format!(
            "{ctx}\nThe user attached the conversation(s) above as context."
        ))
    } else {
        Ok(format!("{ctx}\n{stripped_user_text}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn msg(role: &str, content: &str) -> ChatMessageStored {
        ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role: role.into(),
            content: content.into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        }
    }

    #[test]
    fn extracts_unique_uuids() {
        let a = "11111111-1111-4111-8111-111111111111";
        let b = "22222222-2222-4222-8222-222222222222";
        let raw = format!("x [[chat:{a}]] y [[chat:{b}]] [[chat:{a}]] [[chat:nope]]");
        assert_eq!(extract_chat_session_ids(&raw), vec![a, b]);
        let scoped = format!("[[chat:{a}:user]] [[chat:{b}:full]]");
        let specs = extract_attached_chats(&scoped);
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].scope, AttachScope::User);
        assert_eq!(specs[1].scope, AttachScope::Full);
    }

    #[test]
    fn strips_tokens_from_prompt() {
        let a = "11111111-1111-4111-8111-111111111111";
        let raw = format!("[[chat:{a}]]\nplease continue");
        assert_eq!(strip_chat_tokens(&raw), "please continue");
        assert_eq!(
            strip_chat_tokens("keep [[chat:not-uuid]]"),
            "keep [[chat:not-uuid]]"
        );
    }

    #[test]
    fn compact_skips_tools_and_empty() {
        let msgs = vec![
            msg("tool", "ignored"),
            msg("user", "hello"),
            msg("assistant", ""),
            msg("assistant", "hi"),
        ];
        let body = compact_user_assistant_turns(&msgs, 16, 2000, 14000).unwrap();
        assert!(body.contains("### User\nhello"));
        assert!(body.contains("### Assistant\nhi"));
        assert!(!body.contains("ignored"));
    }

    #[test]
    fn compact_strips_nested_chat_tokens() {
        let a = "11111111-1111-4111-8111-111111111111";
        let msgs = vec![msg("user", &format!("[[chat:{a}]]\ndo it"))];
        let body = compact_user_assistant_turns(&msgs, 16, 2000, 14000).unwrap();
        assert!(body.contains("do it"));
        assert!(!body.contains("[[chat:"));
    }

    #[test]
    fn compact_none_when_no_turns() {
        let msgs = vec![msg("tool", "x")];
        assert!(compact_user_assistant_turns(&msgs, 16, 2000, 14000).is_none());
    }

    #[test]
    fn compact_keeps_huge_recent_when_olds_are_short() {
        let mut msgs = Vec::new();
        for i in 0..16 {
            msgs.push(msg("user", &format!("old-{i}")));
        }
        msgs.push(msg("user", &format!("RECENT-{}", "Y".repeat(180))));
        let body = compact_user_assistant_turns(&msgs, 17, 2000, 280).unwrap();
        assert!(
            body.contains("RECENT-"),
            "newest turn must survive char budget: {body}"
        );
    }

    #[test]
    fn compact_keeps_short_recent_when_olds_are_huge() {
        let mut msgs = Vec::new();
        for i in 0..16 {
            msgs.push(msg("user", &format!("OLD-{i}-{}", "Z".repeat(180))));
        }
        msgs.push(msg("user", "RECENT-OK"));
        let body = compact_user_assistant_turns(&msgs, 17, 2000, 400).unwrap();
        assert!(
            body.contains("RECENT-OK"),
            "newest turn must survive char budget: {body}"
        );
        assert!(
            body.contains("earlier turns omitted") || !body.contains("OLD-0-"),
            "oldest turns should drop first: {body}"
        );
    }

    struct MapJournal {
        files: std::collections::HashMap<String, Option<Vec<ChatMessageStored>>>,
        titles: std::collections::HashMap<String, String>,
    }

    impl AttachJournal for MapJournal {
        fn exists(&self, id: &str) -> bool {
            matches!(self.files.get(id), Some(Some(_)))
        }
        fn load(&self, id: &str) -> Vec<ChatMessageStored> {
            self.files
                .get(id)
                .and_then(|v| v.clone())
                .unwrap_or_default()
        }
        fn title(&self, id: &str) -> String {
            self.titles
                .get(id)
                .cloned()
                .unwrap_or_else(|| "Untitled".into())
        }
    }

    fn spec(id: &str) -> AttachedChatSpec {
        AttachedChatSpec {
            id: id.to_string(),
            scope: AttachScope::Recent,
        }
    }

    #[test]
    fn chips_only_missing_journal_is_not_found() {
        let a = "11111111-1111-4111-8111-111111111111";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(a.to_string(), None)]),
            titles: std::collections::HashMap::new(),
        };
        let err = agent_prompt_after_attach("", &[spec(a)], "current", &journal).unwrap_err();
        assert_eq!(err.as_str(), "attached chat not found");
        assert_ne!(err.as_str(), "empty message");
    }

    #[test]
    fn chips_only_empty_transcript_is_no_transcript() {
        let a = "11111111-1111-4111-8111-111111111111";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(a.to_string(), Some(vec![msg("tool", "x")]))]),
            titles: std::collections::HashMap::from([(a.to_string(), "Src".into())]),
        };
        let err = agent_prompt_after_attach("", &[spec(a)], "current", &journal).unwrap_err();
        assert_eq!(err.as_str(), "no transcript");
        assert_ne!(err.as_str(), "empty message");
    }

    #[test]
    fn build_attached_context_wraps_turns() {
        let a = "11111111-1111-4111-8111-111111111111";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(
                a.to_string(),
                Some(vec![msg("user", "hello from source")]),
            )]),
            titles: std::collections::HashMap::from([(a.to_string(), "Src".into())]),
        };
        let ctx = build_attached_chats_context_with(&[spec(a)], "current", &journal).unwrap();
        assert!(ctx.contains("hello from source"));
        assert!(ctx.contains("Attached conversation"));
    }

    #[test]
    fn chips_only_with_turns_builds_prompt() {
        let a = "11111111-1111-4111-8111-111111111111";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(
                a.to_string(),
                Some(vec![msg("user", "hello from source")]),
            )]),
            titles: std::collections::HashMap::from([(a.to_string(), "Src".into())]),
        };
        let prompt = agent_prompt_after_attach("", &[spec(a)], "current", &journal).unwrap();
        assert!(prompt.contains("hello from source"));
        assert!(prompt.contains("attached the conversation"));
    }

    #[test]
    fn bootstrap_expand_keeps_attach_context_or_stub() {
        let src = "22222222-2222-4222-8222-222222222222";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(
                src.to_string(),
                Some(vec![msg("user", "source-turn-body")]),
            )]),
            titles: std::collections::HashMap::from([(src.to_string(), "Other".into())]),
        };
        let historical = vec![msg("user", &format!("[[chat:{src}]]\nsummarize"))];
        let expanded = compact_user_assistant_turns_with(
            &historical,
            16,
            2000,
            14000,
            NestedAttach::Expand,
            &journal,
        )
        .unwrap();
        assert!(expanded.contains("summarize"));
        assert!(
            expanded.contains("source-turn-body") || expanded.contains(&attach_stub("Other", src)),
            "recycle bootstrap must keep attach context or stub, got: {expanded}"
        );
        assert!(!expanded.contains(&format!("[[chat:{src}]]")));
    }

    #[test]
    fn bootstrap_stub_when_source_missing() {
        let src = "33333333-3333-4333-8333-333333333333";
        let journal = MapJournal {
            files: std::collections::HashMap::from([(src.to_string(), None)]),
            titles: std::collections::HashMap::from([(src.to_string(), "Gone".into())]),
        };
        let historical = vec![msg("user", &format!("[[chat:{src}]]\nsummarize"))];
        let body = compact_user_assistant_turns_with(
            &historical,
            16,
            2000,
            14000,
            NestedAttach::Expand,
            &journal,
        )
        .unwrap();
        assert!(body.contains("summarize"));
        assert!(body.contains(&attach_stub("Gone", src)));
    }
}
