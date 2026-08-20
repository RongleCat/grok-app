//! Detect and heal turns abandoned when the host process died mid-flight.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

use crate::session_manager::has_turn_end_marker_after_last_user;
use crate::store::{self, ChatMessageStored};
use crate::turn_lease::{
    list_active_lease_session_ids, mark_interrupted, read_lease, write_lease, LeaseStatus,
    PendingTool, TurnLease,
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrailVerdict {
    pub abandoned: bool,
    pub pending_tool: Option<PendingTool>,
}

/// Walk space-separated or newline-delimited JSON objects.
pub fn parse_json_stream(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut rest = text;
    loop {
        let trimmed = rest.trim_start();
        if trimmed.is_empty() {
            break;
        }
        let mut stream = serde_json::Deserializer::from_str(trimmed).into_iter::<Value>();
        match stream.next() {
            Some(Ok(v)) => {
                let consumed = stream.byte_offset();
                out.push(v);
                rest = &trimmed[consumed..];
            }
            _ => break,
        }
    }
    out
}

pub fn inspect_agent_trail(agent_dir: &Path) -> TrailVerdict {
    let mut requested = 0u32;
    let mut resolved = 0u32;
    let mut last_tool: Option<PendingTool> = None;

    let events_path = agent_dir.join("events.jsonl");
    if let Ok(raw) = fs::read_to_string(&events_path) {
        for v in parse_json_stream(&raw) {
            let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
            match typ {
                "permission_requested" => {
                    requested += 1;
                    last_tool = Some(
                        pending_from_event(&v).or(last_tool).unwrap_or(PendingTool {
                            tool_call_id: String::new(),
                            tool_name: v
                                .get("tool_name")
                                .and_then(|x| x.as_str())
                                .unwrap_or("tool")
                                .to_string(),
                            title: String::new(),
                            command: String::new(),
                        }),
                    );
                }
                "permission_resolved" => resolved += 1,
                "turn_completed" => {
                    // Only the last turn matters. An earlier completed turn
                    // must not hide a later abandoned permission/tool.
                    requested = 0;
                    resolved = 0;
                    last_tool = None;
                }
                "tool_started" => {
                    if let Some(t) = pending_from_event(&v) {
                        last_tool = Some(t);
                    }
                }
                _ => {}
            }
        }
    }

    let mut open_calls: HashSet<String> = HashSet::new();
    let history_path = agent_dir.join("chat_history.jsonl");
    if let Ok(raw) = fs::read_to_string(&history_path) {
        for v in parse_json_stream(&raw) {
            let typ = v
                .get("type")
                .or_else(|| v.get("role"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            match typ {
                "assistant" => {
                    if let Some(calls) = v.get("tool_calls").and_then(|x| x.as_array()) {
                        for call in calls {
                            let id = call
                                .get("id")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !id.is_empty() {
                                open_calls.insert(id.clone());
                            }
                            last_tool = Some(pending_from_tool_call(call));
                        }
                    }
                }
                "tool_result" | "tool" => {
                    if let Some(id) = v
                        .get("tool_call_id")
                        .or_else(|| v.get("toolCallId"))
                        .and_then(|x| x.as_str())
                    {
                        open_calls.remove(id);
                    }
                }
                _ => {}
            }
        }
    }

    let permission_open = requested > resolved;
    let tools_open = !open_calls.is_empty();
    let abandoned = permission_open || tools_open;
    TrailVerdict {
        abandoned,
        pending_tool: last_tool.filter(|_| abandoned),
    }
}

fn pending_from_event(v: &Value) -> Option<PendingTool> {
    let name = v
        .get("tool_name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if name.is_empty() {
        return None;
    }
    Some(PendingTool {
        tool_call_id: v
            .get("tool_call_id")
            .or_else(|| v.get("toolCallId"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        tool_name: name,
        title: v
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        command: String::new(),
    })
}

fn pending_from_tool_call(call: &Value) -> PendingTool {
    let args = call.get("arguments").and_then(|x| x.as_str()).unwrap_or("");
    let command = serde_json::from_str::<Value>(args)
        .ok()
        .and_then(|v| {
            v.get("command")
                .or_else(|| v.get("cmd"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    PendingTool {
        tool_call_id: call
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        tool_name: call
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("tool")
            .to_string(),
        title: String::new(),
        command,
    }
}

fn resolve_agent_dir(session_id: &str) -> Option<std::path::PathBuf> {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id)?;
    let agent_id = meta.agent_session_id.as_deref().filter(|s| !s.is_empty())?;
    let mode = store::load_settings().session_data_mode;
    let cwd_hint = meta.project_id.as_deref().and_then(|pid| {
        store::load_projects()
            .into_iter()
            .find(|p| p.id == pid)
            .map(|p| p.path)
    });
    crate::paths::find_agent_session_dir(agent_id, cwd_hint.as_deref(), &mode)
}

/// Journal `turn_cancelled|host_exit` when the last user turn was abandoned.
/// Idempotent: skips when an end-of-turn chip already exists.
/// Returns the new chip message id when a row was written.
pub fn heal_interrupted_turn(session_id: &str) -> Option<String> {
    if session_id.trim().is_empty() {
        return None;
    }
    if has_turn_end_marker_after_last_user(session_id) {
        return None;
    }
    let lease = read_lease(session_id);
    let lease_active = matches!(lease.as_ref().map(|l| &l.status), Some(LeaseStatus::Active));
    let trail = resolve_agent_dir(session_id)
        .map(|d| inspect_agent_trail(&d))
        .unwrap_or_default();
    if !lease_active && !trail.abandoned {
        return None;
    }
    let chip_id = append_host_exit_chip(session_id);
    if let Some(mut lease) = lease {
        if let Some(tool) = trail.pending_tool.clone() {
            if lease.pending_tool.is_none() {
                lease.pending_tool = Some(tool);
            }
        }
        lease.status = LeaseStatus::Interrupted;
        lease.updated_at = Utc::now().to_rfc3339();
        let _ = write_lease(&lease);
    } else {
        let now = Utc::now().to_rfc3339();
        let _ = write_lease(&TurnLease {
            schema: crate::turn_lease::SCHEMA,
            status: LeaseStatus::Interrupted,
            session_id: session_id.to_string(),
            agent_session_id: None,
            turn_id: None,
            started_at: now.clone(),
            updated_at: now,
            phase: "permission_prompt".into(),
            permission_pending: trail.abandoned,
            pending_tool: trail.pending_tool,
        });
        let _ = mark_interrupted(session_id);
    }
    tracing::warn!(
        target: "session",
        session = %session_id,
        "healed interrupted turn after host exit"
    );
    Some(chip_id)
}

fn append_host_exit_chip(session_id: &str) -> String {
    let mid = Uuid::new_v4().to_string();
    let _ = store::append_message(
        session_id,
        ChatMessageStored {
            id: mid.clone(),
            role: "tool".into(),
            content: "turn_cancelled|host_exit".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: true,
            attachments: None,
            marker: Some("turn_cancelled".into()),
        },
    );
    mid
}

pub fn heal_all_active_leases() {
    for id in list_active_lease_session_ids() {
        let _ = heal_interrupted_turn(&id);
    }
}

/// Context for the Continue chip (renderer must not read app_data itself).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptContext {
    pub command: String,
    pub title: String,
    pub tool_name: String,
}

pub fn interrupt_context(session_id: &str) -> Option<InterruptContext> {
    let lease = read_lease(session_id)?;
    if !matches!(lease.status, LeaseStatus::Interrupted) {
        return None;
    }
    let tool = lease.pending_tool?;
    Some(InterruptContext {
        command: tool.command,
        title: tool.title,
        tool_name: tool.tool_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::ensure_app_dirs;
    use crate::store::{self, ChatMessageStored};
    use crate::turn_lease::{begin_active, write_lease, LeaseStatus, PendingTool, TurnLease};
    use std::path::PathBuf;
    use uuid::Uuid;

    fn with_home<T>(f: impl FnOnce(&PathBuf) -> T) -> T {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-turn-interrupt-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let out = f(&tmp);
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
        out
    }

    fn seed_user(session_id: &str) {
        store::append_message(
            session_id,
            ChatMessageStored {
                id: "u1".into(),
                role: "user".into(),
                content: "update master then merge".into(),
                thought: None,
                created_at: Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
        )
        .unwrap();
    }

    fn host_exit_count(session_id: &str) -> usize {
        store::load_messages(session_id)
            .iter()
            .filter(|m| m.content.contains("turn_cancelled|host_exit"))
            .count()
    }

    fn write_trail(dir: &Path, events: &str, history: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("events.jsonl"), events).unwrap();
        fs::write(dir.join("chat_history.jsonl"), history).unwrap();
    }

    #[test]
    fn permission_requested_without_resolve_is_abandoned() {
        let dir = std::env::temp_dir().join(format!("trail-perm-{}", Uuid::new_v4()));
        let events = r#"{"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_resolved","tool_name":"read_file"} {"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_requested","tool_name":"run_terminal_command"} {"type":"permission_resolved"} {"type":"permission_resolved"} {"type":"permission_resolved"} {"type":"permission_resolved"}"#;
        write_trail(&dir, events, "");
        let v = inspect_agent_trail(&dir);
        assert!(v.abandoned, "6 requested vs 5 resolved must be abandoned");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn assistant_tool_calls_without_result_is_abandoned() {
        let dir = std::env::temp_dir().join(format!("trail-tools-{}", Uuid::new_v4()));
        let history = r#"{"type":"user","content":[{"type":"text","text":"hi"}]} {"type":"assistant","content":[{"type":"text","text":"next merge"}],"tool_calls":[{"id":"call-9e5f0e0d-35bd-418a-a19f-a6449822f2f9-5","name":"run_terminal_command","arguments":"{\"command\":\"git rev-parse master origin/master HEAD\"}"}]}"#;
        write_trail(&dir, "", history);
        let v = inspect_agent_trail(&dir);
        assert!(v.abandoned);
        assert_eq!(
            v.pending_tool.as_ref().map(|t| t.command.as_str()),
            Some("git rev-parse master origin/master HEAD")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn turn_completed_is_not_abandoned() {
        let dir = std::env::temp_dir().join(format!("trail-done-{}", Uuid::new_v4()));
        write_trail(
            &dir,
            r#"{"type":"permission_requested","tool_name":"read_file"} {"type":"permission_resolved"} {"type":"turn_completed"}"#,
            r#"{"type":"assistant","content":[{"type":"text","text":"done"}]}"#,
        );
        let v = inspect_agent_trail(&dir);
        assert!(!v.abandoned);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn later_unresolved_permission_after_turn_completed_is_abandoned() {
        let dir = std::env::temp_dir().join(format!("trail-later-{}", Uuid::new_v4()));
        write_trail(
            &dir,
            r#"{"type":"permission_requested","tool_name":"read_file"} {"type":"permission_resolved"} {"type":"turn_completed"} {"type":"permission_requested","tool_name":"run_terminal_command"}"#,
            r#"{"type":"assistant","tool_calls":[{"id":"call-later","name":"run_terminal_command","arguments":"{\"command\":\"git log\"}"}]}"#,
        );
        let v = inspect_agent_trail(&dir);
        assert!(
            v.abandoned,
            "a later unfinished turn must not be hidden by an earlier turn_completed"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_dir_is_not_abandoned() {
        let dir = std::env::temp_dir().join(format!("trail-empty-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert!(!inspect_agent_trail(&dir).abandoned);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn heal_writes_host_exit_and_marks_lease_interrupted() {
        with_home(|_| {
            let sid = "heal-active-lease";
            seed_user(sid);
            begin_active(sid, Some("agent-1"), Some("turn-1"));
            assert!(heal_interrupted_turn(sid).is_some());
            assert_eq!(host_exit_count(sid), 1);
            assert_eq!(read_lease(sid).unwrap().status, LeaseStatus::Interrupted);
        });
    }

    #[test]
    fn heal_skips_when_end_marker_already_present() {
        with_home(|_| {
            let sid = "heal-already";
            seed_user(sid);
            store::append_message(
                sid,
                ChatMessageStored {
                    id: "c1".into(),
                    role: "tool".into(),
                    content: "turn_cancelled|host_exit".into(),
                    thought: None,
                    created_at: Utc::now(),
                    is_error: true,
                    attachments: None,
                    marker: Some("turn_cancelled".into()),
                },
            )
            .unwrap();
            begin_active(sid, None, None);
            assert!(heal_interrupted_turn(sid).is_none());
            assert_eq!(host_exit_count(sid), 1);
        });
    }

    #[test]
    fn heal_uses_lease_even_without_agent_dir() {
        with_home(|_| {
            let sid = "heal-no-agent";
            seed_user(sid);
            write_lease(&TurnLease {
                schema: 1,
                status: LeaseStatus::Active,
                session_id: sid.into(),
                agent_session_id: None,
                turn_id: None,
                started_at: "t0".into(),
                updated_at: "t1".into(),
                phase: "streaming".into(),
                permission_pending: false,
                pending_tool: Some(PendingTool {
                    tool_call_id: "c1".into(),
                    tool_name: "run_terminal_command".into(),
                    title: "compare".into(),
                    command: "git log".into(),
                }),
            })
            .unwrap();
            assert!(heal_interrupted_turn(sid).is_some());
            assert_eq!(host_exit_count(sid), 1);
        });
    }

    #[test]
    fn heal_second_pass_does_not_double_chip() {
        with_home(|_| {
            let sid = "heal-twice";
            seed_user(sid);
            begin_active(sid, None, None);
            assert!(heal_interrupted_turn(sid).is_some());
            assert!(heal_interrupted_turn(sid).is_none());
            assert_eq!(host_exit_count(sid), 1);
        });
    }

    #[test]
    fn clean_lease_and_completed_trail_does_not_heal() {
        with_home(|_| {
            let sid = "heal-clean";
            seed_user(sid);
            assert!(heal_interrupted_turn(sid).is_none());
            assert_eq!(host_exit_count(sid), 0);
        });
    }

    #[test]
    fn parse_json_stream_handles_concatenated_objects() {
        let vals = parse_json_stream(r#"{"a":1} {"b":2}"#);
        assert_eq!(vals.len(), 2);
        assert_eq!(vals[0]["a"], 1);
        assert_eq!(vals[1]["b"], 2);
    }
}
