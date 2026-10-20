//! Adopt the CLI turn that reports a finished background workflow.
//!
//! The workflow tool returns immediately. When the run ends, Grok Build
//! starts its own turn on the same ACP connection (`workflow-completed-`).
//! There is no Host `session/prompt`, so `prompt_in_flight` is false and the
//! replay gate would drop the answer. This opens that turn, journals the
//! quiet cue, and finishes it on `turn_completed`.

use tauri::AppHandle;

use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};
use crate::workflow_followup::{self, Decision, Wire, CUE_FALLBACK};

use super::*;

enum FollowupPrepared {
    None,
    Opened {
        app_session_id: String,
        prompt_id: String,
        turn_id: String,
        agent_session_id: Option<String>,
        stream_message_id: String,
        user_row: ChatMessageStored,
        // Boxed so the Opened arm is not hundreds of bytes larger than Finished.
        meta: Box<store::SessionMeta>,
    },
    Finished {
        pending_emits: Vec<StreamEmitPayload>,
        pending_persists: Vec<PendingSessionPersist>,
        empty: Option<(String, String, String)>,
        /// `try_finish` closed the turn. False while tools or a gate still hold it.
        completed: bool,
    },
}

impl SessionManager {
    /// Apply one workflow-follow-up signal to whichever slot holds `app_session_id`.
    pub(super) fn handle_workflow_followup(
        &self,
        app: &AppHandle,
        app_session_id: &str,
        wire: Wire,
    ) {
        let prepared = self.with_session_mut(app_session_id, |s| {
            Self::prepare_workflow_followup(s, &wire)
        });
        let Some(prepared) = prepared else {
            tracing::debug!(
                session = %app_session_id,
                "workflow follow-up dropped: session is not live or background"
            );
            return;
        };
        match prepared {
            FollowupPrepared::None => {}
            FollowupPrepared::Opened {
                app_session_id,
                prompt_id,
                turn_id,
                agent_session_id,
                stream_message_id,
                user_row,
                meta,
            } => {
                if let Err(e) = store::append_message(&app_session_id, user_row.clone()) {
                    tracing::error!(
                        session = %app_session_id,
                        "workflow follow-up journal append failed: {e}"
                    );
                    self.with_session_mut(&app_session_id, Self::abandon_opened_followup);
                    self.emit_for_session(app, &app_session_id);
                    return;
                }
                if let Err(e) = store::update_session_meta(&meta) {
                    tracing::warn!(
                        session = %app_session_id,
                        "workflow follow-up session metadata update failed: {e}"
                    );
                }
                crate::turn_lease::begin_active(
                    &app_session_id,
                    agent_session_id.as_deref(),
                    Some(turn_id.as_str()),
                );
                crate::mirror::fanout_event(
                    app,
                    "session://user_message",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "message": user_row,
                        "streamMessageId": stream_message_id,
                    }),
                );
                crate::mirror::notify_sessions_changed(Some(app), "turn", &app_session_id);
                tracing::info!(
                    session = %app_session_id,
                    prompt = %prompt_id,
                    "workflow follow-up adopted"
                );
                self.emit_for_session(app, &app_session_id);
            }
            FollowupPrepared::Finished {
                pending_emits,
                pending_persists,
                empty,
                completed,
            } => {
                Self::emit_stream_payloads(app, pending_emits);
                Self::commit_session_persists(Some(app), pending_persists);
                Self::emit_empty_run_if_any(app, empty);
                if completed {
                    let was_background = !self.is_live_session(app_session_id);
                    self.promote_background_ready_to_parked(app_session_id);
                    if self.is_live_session(app_session_id)
                        || self.background.lock().contains_key(app_session_id)
                    {
                        self.emit_for_session(app, app_session_id);
                    } else if was_background {
                        Self::emit_runtime(
                            app,
                            &SessionSnapshot {
                                session_id: Some(app_session_id.to_string()),
                                agent_session_id: None,
                                state: SessionState::Ready,
                                last_error: None,
                                streaming_message_id: None,
                                backend: Self::backend_name(),
                                model_id: None,
                                project_path: None,
                                title: String::new(),
                            },
                        );
                    }
                    tracing::info!(session = %app_session_id, "workflow follow-up finished");
                } else {
                    self.emit_for_session(app, app_session_id);
                }
            }
        }
    }

    fn prepare_workflow_followup(s: &mut LiveSession, wire: &Wire) -> FollowupPrepared {
        let armed = workflow_followup::armed_prompt(&s.app_session_id);
        let decision = workflow_followup::decide(
            s.prompt_in_flight,
            s.fsm.state() == SessionState::Ready,
            armed.as_deref(),
            wire,
        );
        match decision {
            Decision::Ignore | Decision::AlreadyOpen => FollowupPrepared::None,
            Decision::RememberCue => {
                if let Wire::Cue { text } = wire {
                    // A chat that has not sent this visit is still in connect
                    // replay territory. Do not keep a cue for a later open.
                    if s.sent_prompt_this_visit {
                        workflow_followup::note_cue(&s.app_session_id, text);
                    }
                }
                FollowupPrepared::None
            }
            Decision::Open { prompt_id } => {
                if !s.sent_prompt_this_visit {
                    tracing::debug!(
                        session = %s.app_session_id,
                        prompt = %prompt_id,
                        "workflow follow-up not opened: no prompt sent this visit"
                    );
                    return FollowupPrepared::None;
                }
                if s.fsm.begin_stream().is_err() {
                    return FollowupPrepared::None;
                }
                s.prompt_in_flight = true;
                s.sent_prompt_this_visit = true;
                Self::touch_stream_progress_locked(s);
                let turn_id = uuid::Uuid::new_v4().to_string();
                s.active_turn_id = Some(turn_id.clone());
                // Lock the shell id. The cue row tells the UI which assistant
                // row to fill; an agent message id must not split that shell.
                s.stream_message_id_locked = true;
                let stream_message_id = uuid::Uuid::new_v4().to_string();
                s.streaming_message_id = Some(stream_message_id.clone());
                s.stream_buf.clear();
                s.stream_thought.clear();
                s.stream_last_was_assistant = false;
                s.stream_attachments.clear();
                s.journal_throttle.reset();
                s.last_stall_emit = None;
                s.open_tool_ids.clear();
                s.open_tool_seen_at.clear();
                s.terminal_tool_ids.clear();
                s.deferred_prompt_complete = None;
                s.stall_soft_emits = 0;
                s.saw_model_output = false;
                s.tools_this_turn = 0;
                Self::clear_provider_retry_memory(s);
                // `arm` clears the stored cue. Take it first.
                let content = workflow_followup::take_fresh_cue(&s.app_session_id)
                    .unwrap_or_else(|| CUE_FALLBACK.to_string());
                workflow_followup::arm(&s.app_session_id, &prompt_id);
                let user_row = ChatMessageStored {
                    id: uuid::Uuid::new_v4().to_string(),
                    role: "user".into(),
                    content,
                    thought: None,
                    created_at: chrono::Utc::now(),
                    is_error: false,
                    attachments: None,
                    marker: Some("auto_wake".into()),
                };
                s.meta.updated_at = user_row.created_at;
                FollowupPrepared::Opened {
                    app_session_id: s.app_session_id.clone(),
                    prompt_id,
                    turn_id,
                    agent_session_id: s.meta.agent_session_id.clone(),
                    stream_message_id,
                    user_row,
                    meta: Box::new(s.meta.clone()),
                }
            }
            Decision::Finish {
                prompt_id,
                stop_reason,
            } => {
                // Keep the arm. A duplicate start must stay AlreadyOpen.
                // A second end after the turn is already Ready is a no-op.
                // A real user send disarms so this end cannot close that turn.
                if s.active_turn_id.is_none() && s.fsm.state() == SessionState::Ready {
                    return FollowupPrepared::None;
                }
                s.deferred_prompt_complete = Some(stop_reason);
                s.prompt_in_flight = false;
                let mut pending_emits = Vec::new();
                let mut pending_persists = Vec::new();
                let finished = Self::try_finish_deferred_prompt_complete(
                    s,
                    Some(&mut pending_emits),
                    Some(&mut pending_persists),
                );
                let completed = finished.is_some();
                if !completed {
                    tracing::info!(
                        session = %s.app_session_id,
                        prompt = %prompt_id,
                        tools = s.open_tool_ids.len(),
                        "workflow follow-up end deferred"
                    );
                }
                FollowupPrepared::Finished {
                    pending_emits,
                    pending_persists,
                    empty: finished.flatten(),
                    completed,
                }
            }
        }
    }

    fn abandon_opened_followup(s: &mut LiveSession) {
        let _ = s.fsm.end_stream();
        s.prompt_in_flight = false;
        crate::turn_lease::clear_lease(&s.app_session_id);
        workflow_followup::disarm(&s.app_session_id);
        s.active_turn_id = None;
        s.streaming_message_id = None;
        s.stream_message_id_locked = false;
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
        s.open_tool_ids.clear();
        s.open_tool_seen_at.clear();
        s.terminal_tool_ids.clear();
        s.deferred_prompt_complete = None;
        s.saw_model_output = false;
    }
}
