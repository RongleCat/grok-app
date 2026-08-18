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

/// Compact user/assistant turns into markdown blocks (no wrapper).
pub fn compact_user_assistant_turns(
    msgs: &[ChatMessageStored],
    max_msgs: usize,
    per_msg_chars: usize,
    max_chars: usize,
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

    let mut body = String::new();
    for m in picked {
        let role = if m.role == "user" {
            "User"
        } else if m.is_error {
            "Assistant (error)"
        } else {
            "Assistant"
        };
        let mut content = m.content.trim().to_string();
        // Do not leak nested attach tokens into the compact block.
        content = strip_chat_tokens(&content);
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
        let block = format!("### {role}\n{content}\n\n");
        if body.len() + block.len() > max_chars {
            body.push_str("### …\n[earlier turns omitted for length]\n\n");
            break;
        }
        body.push_str(&block);
    }
    if body.trim().is_empty() {
        None
    } else {
        Some(body)
    }
}

fn session_title(id: &str) -> String {
    store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == id)
        .map(|s| s.title.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled".into())
}

/// Build the agent-only prefix for attached chats. Skips self + missing journals.
pub fn build_attached_chats_context(
    specs: &[AttachedChatSpec],
    current_id: &str,
) -> Option<String> {
    let mut blocks: Vec<String> = Vec::new();
    for spec in specs.iter().take(ATTACH_MAX_SESSIONS) {
        let id = spec.id.as_str();
        if id == current_id {
            continue;
        }
        if !is_uuid(id) {
            continue;
        }
        let mut msgs = store::load_messages(id);
        if spec.scope == AttachScope::User {
            msgs.retain(|m| m.role == "user");
        }
        let max_msgs = match spec.scope {
            AttachScope::Full => ATTACH_MAX_MSGS_FULL,
            AttachScope::Recent | AttachScope::User => ATTACH_MAX_MSGS,
        };
        let Some(turns) =
            compact_user_assistant_turns(&msgs, max_msgs, ATTACH_PER_MSG_CHARS, ATTACH_MAX_CHARS)
        else {
            continue;
        };
        let title = session_title(id);
        blocks.push(format!(
            "[Attached conversation — \"{title}\" ({id}). Context only.\n\
Rules: do NOT re-greet; do NOT quote or reprint this transcript; \
do NOT re-answer prior turns; use it only as background for the user's new message below.]\n\n\
{turns}\
---\n[End of attached conversation \"{title}\".]\n"
        ));
    }
    if blocks.is_empty() {
        None
    } else {
        Some(blocks.join("\n"))
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
}
