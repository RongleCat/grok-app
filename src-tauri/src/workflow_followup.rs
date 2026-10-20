//! CLI-started turn after a background workflow finishes.
//!
//! `workflow` returns at once. When the run ends, Grok Build starts its own
//! turn (`promptId` prefix `workflow-completed-`) and streams it on the same
//! ACP connection. That turn is not a Host `session/prompt`, so
//! `prompt_in_flight` is false and the replay gate would drop every chunk.
//! The pane still updates from disk. The parent chat stays idle.
//!
//! These helpers recognize that turn. `session/load` replay is not one of
//! them: the caller suppresses this decode while a `session/load` RPC is
//! still pending.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Prompt ids Grok Build assigns to the turn that reports a finished workflow.
pub const PROMPT_PREFIX: &str = "workflow-completed-";

/// Quiet-line fallback when the synthetic user chunk was not kept.
/// This is the CLI's own sentence (`notification_drain`), not a new product string.
pub const CUE_FALLBACK: &str =
    "A background workflow stopped. Review the workflow completion reminder, report the result to the user, and take any appropriate next action.";

const CUE_MAX_CHARS: usize = 500;
const CUE_FRESH: Duration = Duration::from_secs(5);

/// What one ACP notification says about a workflow follow-up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wire {
    /// Synthetic user chunk. The prompt id arrives on the next update.
    Cue { text: String },
    /// A chunk of the follow-up (`params._meta.promptId`).
    Start { prompt_id: String },
    /// `turn_completed` for that prompt.
    End {
        prompt_id: String,
        stop_reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Keep the cue until the matching start.
    RememberCue,
    /// Idle chat: open a host turn so the following chunks are applied.
    Open {
        prompt_id: String,
    },
    /// Already opened this prompt. Do not reset the stream.
    AlreadyOpen,
    /// `turn_completed` for the turn we opened.
    Finish {
        prompt_id: String,
        stop_reason: String,
    },
    Ignore,
}

struct Slot {
    cue: Option<(String, Instant)>,
    armed_prompt_id: Option<String>,
}

fn slot_map() -> &'static Mutex<HashMap<String, Slot>> {
    static MAP: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn replayed_ids() -> &'static Mutex<HashSet<String>> {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashSet::new()))
}

fn with_slot<T>(session_id: &str, f: impl FnOnce(&mut Slot) -> T) -> Option<T> {
    let session = session_id.trim();
    if session.is_empty() {
        return None;
    }
    let mut guard = slot_map()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let slot = guard.entry(session.to_string()).or_insert(Slot {
        cue: None,
        armed_prompt_id: None,
    });
    Some(f(slot))
}

pub fn is_workflow_followup_prompt(id: &str) -> bool {
    let id = id.trim();
    id.starts_with(PROMPT_PREFIX)
        && id.len() > PROMPT_PREFIX.len()
        && !id.chars().any(|c| c == '\n' || c == '\r')
}

/// Where a follow-up event sits relative to the other events in the same notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// Cue or start, before the stream / tool events.
    Before,
    /// `turn_completed`, after usage so the turn is still open while usage lands.
    After,
}

/// `None` while `session/load` is still pending, and for any prompt id seen then.
/// A live completion (load RPC already gone, id never seen during load) is admitted.
pub fn admission(during_session_load: bool, wire: &Wire) -> Option<Admission> {
    let prompt_id = match wire {
        Wire::Start { prompt_id } | Wire::End { prompt_id, .. } => Some(prompt_id.as_str()),
        Wire::Cue { .. } => None,
    };
    if during_session_load {
        if let Some(id) = prompt_id {
            note_load_replay(id);
        }
        return None;
    }
    if prompt_id.is_some_and(seen_during_load) {
        return None;
    }
    Some(match wire {
        Wire::End { .. } => Admission::After,
        _ => Admission::Before,
    })
}

/// Remember a prompt id that arrived while `session/load` was still in flight.
pub fn note_load_replay(prompt_id: &str) {
    if !is_workflow_followup_prompt(prompt_id) {
        return;
    }
    let mut guard = replayed_ids()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard.insert(prompt_id.to_string());
}

pub fn seen_during_load(prompt_id: &str) -> bool {
    replayed_ids()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(prompt_id)
}

fn owned_text(value: &Value) -> Option<String> {
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(CUE_MAX_CHARS).collect())
}

fn prompt_id_from_meta(params: &Value) -> Option<String> {
    params
        .pointer("/_meta/promptId")
        .or_else(|| params.pointer("/_meta/prompt_id"))
        .and_then(owned_text)
}

/// `Some` when this notification is the workflow result turn.
/// Other synthetic wakes (subagent, bash, task) stay `None`.
pub fn decode_followup(params: &Value) -> Option<Wire> {
    let update = params.get("update").unwrap_or(params);
    let kind = update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match kind {
        "user_message_chunk" => {
            let synthetic = update
                .pointer("/_meta/syntheticPrompt")
                .or_else(|| update.pointer("/_meta/synthetic_prompt"))
                .and_then(|v| v.as_bool())
                == Some(true);
            if !synthetic {
                return None;
            }
            let text = update
                .pointer("/content/text")
                .and_then(owned_text)
                .unwrap_or_else(|| CUE_FALLBACK.to_string());
            Some(Wire::Cue { text })
        }
        "turn_completed" => {
            let prompt_id = update
                .get("prompt_id")
                .or_else(|| update.get("promptId"))
                .and_then(owned_text)?;
            if !is_workflow_followup_prompt(&prompt_id) {
                return None;
            }
            let stop_reason = update
                .get("stop_reason")
                .or_else(|| update.get("stopReason"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("end_turn")
                .to_string();
            Some(Wire::End {
                prompt_id,
                stop_reason,
            })
        }
        _ => {
            let prompt_id = prompt_id_from_meta(params)?;
            if !is_workflow_followup_prompt(&prompt_id) {
                return None;
            }
            Some(Wire::Start { prompt_id })
        }
    }
}

/// Pure gate. `fsm_ready` is the host FSM in `Ready` (the only state that can begin a stream).
pub fn decide(
    prompt_in_flight: bool,
    fsm_ready: bool,
    armed_prompt_id: Option<&str>,
    wire: &Wire,
) -> Decision {
    match wire {
        Wire::Cue { .. } => {
            if prompt_in_flight {
                Decision::Ignore
            } else {
                Decision::RememberCue
            }
        }
        Wire::Start { prompt_id } => {
            if armed_prompt_id == Some(prompt_id.as_str()) {
                return Decision::AlreadyOpen;
            }
            if prompt_in_flight || !fsm_ready {
                return Decision::Ignore;
            }
            Decision::Open {
                prompt_id: prompt_id.clone(),
            }
        }
        Wire::End {
            prompt_id,
            stop_reason,
        } => {
            if armed_prompt_id != Some(prompt_id.as_str()) {
                return Decision::Ignore;
            }
            Decision::Finish {
                prompt_id: prompt_id.clone(),
                stop_reason: stop_reason.clone(),
            }
        }
    }
}

pub fn note_cue(session_id: &str, text: &str) {
    let kept: String = text.trim().chars().take(CUE_MAX_CHARS).collect();
    if kept.is_empty() {
        return;
    }
    with_slot(session_id, |slot| {
        slot.cue = Some((kept, Instant::now()));
    });
}

pub fn arm(session_id: &str, prompt_id: &str) {
    if !is_workflow_followup_prompt(prompt_id) {
        return;
    }
    with_slot(session_id, |slot| {
        slot.armed_prompt_id = Some(prompt_id.to_string());
        slot.cue = None;
    });
}

pub fn armed_prompt(session_id: &str) -> Option<String> {
    with_slot(session_id, |slot| slot.armed_prompt_id.clone()).flatten()
}

/// Cue text if one was stored in the last few seconds. Consumes it.
pub fn take_fresh_cue(session_id: &str) -> Option<String> {
    with_slot(session_id, |slot| {
        let (text, at) = slot.cue.take()?;
        if at.elapsed() > CUE_FRESH {
            return None;
        }
        Some(text)
    })
    .flatten()
}

pub fn disarm(session_id: &str) {
    with_slot(session_id, |slot| {
        slot.armed_prompt_id = None;
        slot.cue = None;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefix_requires_a_run_id() {
        assert!(!is_workflow_followup_prompt(""));
        assert!(!is_workflow_followup_prompt("workflow-completed-"));
        assert!(!is_workflow_followup_prompt("subagent-completed-abc"));
        assert!(is_workflow_followup_prompt(
            "workflow-completed-wf_01a14f93a56875318d0252d5bfa5660f-15"
        ));
        assert!(!is_workflow_followup_prompt("workflow-completed-bad\nid"));
    }

    #[test]
    fn synthetic_user_chunk_is_a_cue_and_a_real_user_chunk_is_not() {
        let synthetic = json!({
            "sessionId": "s",
            "update": {
                "sessionUpdate": "user_message_chunk",
                "content": { "type": "text", "text": "A background workflow stopped. Review it." },
                "_meta": { "syntheticPrompt": true, "hideFromScrollback": true }
            }
        });
        assert_eq!(
            decode_followup(&synthetic),
            Some(Wire::Cue {
                text: "A background workflow stopped. Review it.".into()
            })
        );
        let real = json!({
            "update": {
                "sessionUpdate": "user_message_chunk",
                "content": { "type": "text", "text": "hello" },
                "_meta": { "promptIndex": 2 }
            }
        });
        assert!(decode_followup(&real).is_none());
    }

    #[test]
    fn thought_with_workflow_prompt_id_starts_and_other_ids_do_not() {
        let id = "workflow-completed-wf_abc-15";
        let thought = json!({
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": { "type": "text", "text": "reading the checklist" }
            },
            "_meta": { "promptId": id }
        });
        assert_eq!(
            decode_followup(&thought),
            Some(Wire::Start {
                prompt_id: id.into()
            })
        );
        let other = json!({
            "update": { "sessionUpdate": "agent_message_chunk", "content": { "text": "hi" } },
            "_meta": { "promptId": "4db61605-26f4-432d-9996-07d93c9efb11" }
        });
        assert!(decode_followup(&other).is_none());
    }

    #[test]
    fn turn_completed_ends_only_a_workflow_prompt() {
        let done = json!({
            "update": {
                "sessionUpdate": "turn_completed",
                "prompt_id": "workflow-completed-wf_abc-15",
                "stop_reason": "end_turn"
            }
        });
        assert_eq!(
            decode_followup(&done),
            Some(Wire::End {
                prompt_id: "workflow-completed-wf_abc-15".into(),
                stop_reason: "end_turn".into()
            })
        );
        let other = json!({
            "update": {
                "sessionUpdate": "turn_completed",
                "prompt_id": "subagent-completed-1",
                "stop_reason": "end_turn"
            }
        });
        assert!(decode_followup(&other).is_none());
    }

    #[test]
    fn idle_ready_chat_opens_once_and_then_finishes() {
        let id = "workflow-completed-wf_abc-15";
        let start = Wire::Start {
            prompt_id: id.into(),
        };
        assert_eq!(
            decide(false, true, None, &start),
            Decision::Open {
                prompt_id: id.into()
            }
        );
        assert_eq!(decide(true, true, Some(id), &start), Decision::AlreadyOpen);
        // A user turn already in flight is not replaced.
        assert_eq!(decide(true, true, None, &start), Decision::Ignore);
        // Session/load leaves the FSM non-ready; do not open.
        assert_eq!(decide(false, false, None, &start), Decision::Ignore);
        let end = Wire::End {
            prompt_id: id.into(),
            stop_reason: "end_turn".into(),
        };
        assert_eq!(decide(true, false, None, &end), Decision::Ignore);
        assert_eq!(
            decide(true, true, Some(id), &end),
            Decision::Finish {
                prompt_id: id.into(),
                stop_reason: "end_turn".into()
            }
        );
    }

    #[test]
    fn a_cue_during_a_user_turn_is_not_remembered() {
        let cue = Wire::Cue {
            text: "A background workflow stopped.".into(),
        };
        assert_eq!(decide(false, true, None, &cue), Decision::RememberCue);
        assert_eq!(decide(true, true, None, &cue), Decision::Ignore);
    }

    #[test]
    fn load_replay_is_not_admitted_and_a_later_copy_stays_out() {
        let replayed = "workflow-completed-wf_admit_load-1";
        let start = Wire::Start {
            prompt_id: replayed.into(),
        };
        assert!(admission(true, &start).is_none());
        assert!(seen_during_load(replayed));
        assert!(admission(false, &start).is_none());

        let live = "workflow-completed-wf_admit_live-2";
        assert_eq!(
            admission(
                false,
                &Wire::Start {
                    prompt_id: live.into(),
                }
            ),
            Some(Admission::Before)
        );
        assert_eq!(
            admission(
                false,
                &Wire::End {
                    prompt_id: live.into(),
                    stop_reason: "end_turn".into(),
                }
            ),
            Some(Admission::After)
        );
        assert_eq!(
            admission(
                false,
                &Wire::Cue {
                    text: "A background workflow stopped.".into(),
                }
            ),
            Some(Admission::Before)
        );
        assert!(admission(
            true,
            &Wire::Cue {
                text: "replayed cue".into(),
            }
        )
        .is_none());
    }

    #[test]
    fn fresh_cue_is_taken_once() {
        let sid = "wf-cue-once-test";
        disarm(sid);
        note_cue(sid, "  review the result  ");
        assert_eq!(take_fresh_cue(sid).as_deref(), Some("review the result"));
        assert!(take_fresh_cue(sid).is_none());
        disarm(sid);
    }
}
