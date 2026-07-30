//! Load App sessions_index for Remote IM /r + sync IM turns into App journal.

use super::control_plane::{AppSessionEntry, PendingMode, ScopeBinding};
use crate::store::{self, ChatMessageStored, SessionMeta};
use chrono::Utc;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Called once from App setup so Remote IM can notify the UI after index writes.
pub fn set_app_handle(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

fn emit_index_changed(session_id: &str) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(
            "session://index_changed",
            serde_json::json!({ "sessionId": session_id, "source": "remote_im" }),
        );
    }
}

pub fn sessions_for_project(project_id: Option<&str>) -> Vec<AppSessionEntry> {
    let all = store::load_sessions_index();
    map_and_filter(&all, project_id)
}

/// Pure mapping (testable with fixtures).
pub fn map_and_filter(all: &[SessionMeta], project_id: Option<&str>) -> Vec<AppSessionEntry> {
    let Some(pid) = project_id.filter(|p| !p.is_empty()) else {
        return Vec::new();
    };
    let mut out: Vec<AppSessionEntry> = all
        .iter()
        .filter(|s| !s.archived)
        .filter(|s| s.project_id.as_deref() == Some(pid))
        .map(|s| AppSessionEntry {
            id: s.id.clone(),
            project_id: s.project_id.clone(),
            title: s.title.clone(),
            agent_session_id: s.agent_session_id.clone(),
            updated_at: s.updated_at.to_rfc3339(),
        })
        .collect();
    // newest first
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// After an IM agent turn: ensure App `sessions_index` + journal match the binding.
/// Returns updated binding (local_session_id = App session id when created/linked).
pub fn sync_turn_to_app(
    binding: &ScopeBinding,
    user_prompt: &str,
    assistant_text: &str,
    is_error: bool,
    channel: &str,
) -> ScopeBinding {
    let agent_id = binding
        .agent_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Prefer existing App session: by local id, then by agent_session_id.
    let mut app_id = find_app_session_id(binding.local_session_id.as_str(), agent_id);

    let mut next = binding.clone();

    if app_id.is_none() {
        // Create a new App chat so /r and the sidebar see this IM conversation.
        let title = title_from_prompt(user_prompt, channel);
        match store::create_session(binding.project_id.clone(), Some(title), false) {
            Ok(mut meta) => {
                if let Some(aid) = agent_id {
                    meta.agent_session_id = Some(aid.to_string());
                    let _ = store::update_session_meta(&meta);
                }
                app_id = Some(meta.id.clone());
                next.local_session_id = meta.id.clone();
                tracing::info!(
                    app_session = %meta.id,
                    agent = ?agent_id,
                    "remote_im: created App session for IM turn"
                );
            }
            Err(e) => {
                tracing::warn!(error = %e, "remote_im: create App session failed");
                return next;
            }
        }
    } else if let Some(ref id) = app_id {
        // Touch meta + keep agent id in sync
        let mut list = store::load_sessions_index();
        if let Some(s) = list.iter_mut().find(|s| s.id == *id) {
            if let Some(aid) = agent_id {
                s.agent_session_id = Some(aid.to_string());
            }
            if s.project_id.is_none() {
                s.project_id = binding.project_id.clone();
            }
            // First meaningful title: replace default "New chat" / placeholder
            if is_placeholder_title(&s.title) {
                s.title = title_from_prompt(user_prompt, channel);
            }
            s.updated_at = Utc::now();
            let clone = s.clone();
            let _ = store::update_session_meta(&clone);
        }
        next.local_session_id = id.clone();
    }

    let Some(sid) = app_id else {
        return next;
    };

    // Journal: user + assistant rows (App UI reads messages.json)
    let now = Utc::now();
    let user_msg = ChatMessageStored {
        id: uuid::Uuid::new_v4().to_string(),
        role: "user".into(),
        content: format!("[Remote IM · {channel}]\n{user_prompt}"),
        thought: None,
        created_at: now,
        is_error: false,
        attachments: None,
        marker: None,
    };
    let asst_msg = ChatMessageStored {
        id: uuid::Uuid::new_v4().to_string(),
        role: "assistant".into(),
        content: assistant_text.to_string(),
        thought: None,
        created_at: Utc::now(),
        is_error,
        attachments: None,
        marker: None,
    };
    if let Err(e) = store::append_message(&sid, user_msg) {
        tracing::warn!(error = %e, session = %sid, "remote_im: append user message failed");
    }
    if let Err(e) = store::append_message(&sid, asst_msg) {
        tracing::warn!(error = %e, session = %sid, "remote_im: append assistant message failed");
    }

    // Align pending mode for continue after first write
    if next.pending_mode == PendingMode::New || next.pending_mode == PendingMode::Resume {
        next.pending_mode = PendingMode::Continue;
    }

    emit_index_changed(&sid);
    next
}

fn find_app_session_id(local_id: &str, agent_id: Option<&str>) -> Option<String> {
    let list = store::load_sessions_index();
    if list.iter().any(|s| s.id == local_id) {
        return Some(local_id.to_string());
    }
    if let Some(aid) = agent_id {
        if let Some(s) = list.iter().find(|s| s.agent_session_id.as_deref() == Some(aid)) {
            return Some(s.id.clone());
        }
    }
    None
}

fn is_placeholder_title(t: &str) -> bool {
    let t = t.trim();
    t.is_empty()
        || t.eq_ignore_ascii_case("New chat")
        || t == "新对话"
        || t.starts_with("Remote IM")
}

fn title_from_prompt(prompt: &str, channel: &str) -> String {
    let one_line = prompt.lines().next().unwrap_or(prompt).trim();
    let clipped: String = one_line.chars().take(48).collect();
    if clipped.is_empty() {
        format!("Remote IM · {channel}")
    } else {
        clipped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn meta(id: &str, pid: &str, title: &str, agent: Option<&str>) -> SessionMeta {
        let now = Utc::now();
        SessionMeta {
            id: id.into(),
            project_id: Some(pid.into()),
            title: title.into(),
            agent_session_id: agent.map(|s| s.into()),
            created_at: now,
            updated_at: now,
            model_id: None,
            archived: false,
            pinned: false,
            mode: None,
            effort: None,
            permission_policy: None,
            scheduled: false,
            worktree_path: None,
            worktree_branch: None,
            is_worktree_session: false,
        }
    }

    #[test]
    fn filters_by_project_and_maps_agent_id() {
        // SessionMeta may have more fields - check compile
        let list = vec![
            meta("s1", "p1", "A", Some("ag1")),
            meta("s2", "p2", "B", None),
        ];
        let f = map_and_filter(&list, Some("p1"));
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].agent_session_id.as_deref(), Some("ag1"));
    }
}
