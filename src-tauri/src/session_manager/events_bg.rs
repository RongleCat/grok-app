//! Background ACP event pump handler.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{AcpEvent, PermissionOutcome, StreamKind};
use crate::journal_throttle::is_paragraph_break;
use crate::permission::{
    extract_path_target, extract_shell_command, may_auto_allow, may_auto_deny, pick_option_id,
    scope_key,
};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};

use super::*;

impl SessionManager {
    pub(super) async fn handle_acp_event_on_background(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: &str,
        ev: AcpEvent,
    ) {
        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                let need_schedule = {
                    let mut bg = self.background.lock();
                    let Some(s) = bg.get_mut(app_session_id) else {
                        return;
                    };
                    // Same rule as the live path: gate on `prompt_in_flight`,
                    // never on the FSM (early prompt_complete + more text).
                    //
                    // A background chat never runs `session/load` — a drop here
                    // after the RPC resolved is a real lost chunk and must leave
                    // a trace.
                    if Self::is_session_load_replay(s.prompt_in_flight) {
                        tracing::warn!(
                            "background stream chunk dropped after turn close sid={} fsm={:?} len={}",
                            app_session_id,
                            s.fsm.state(),
                            text.len()
                        );
                        return;
                    }
                    if s.fsm.state() == SessionState::Ready {
                        let _ = s.fsm.begin_stream();
                    }
                    Self::touch_stream_progress_locked(s);
                    Self::ensure_stream_message_id(s, kind, message_id);
                    let thought_phase = match kind {
                        StreamKind::Thought => {
                            let phase = if s.stream_last_was_assistant {
                                if !s.stream_thought.is_empty() {
                                    s.stream_thought.push_str("\n\n⟪phase⟫\n\n");
                                }
                                s.stream_last_was_assistant = false;
                                "new"
                            } else if s.stream_thought.is_empty() {
                                "open"
                            } else {
                                "continue"
                            };
                            s.stream_thought.push_str(&text);
                            phase
                        }
                        StreamKind::Assistant => {
                            s.stream_buf.push_str(&text);
                            // Only real body text flips the phase boundary.
                            if !text.trim().is_empty() {
                                s.stream_last_was_assistant = true;
                                s.saw_model_output = true;
                            }
                            "none"
                        }
                    };
                    let para = is_paragraph_break(&text);
                    Self::maybe_flush_stream_journal(s, done, para);
                    let mid = s.streaming_message_id.clone().unwrap_or_default();
                    let need =
                        Self::queue_stream_emit(s, app, kind, mid, text, thought_phase, done);
                    if need {
                        s.stream_emit_flush_gen = s.stream_emit_flush_gen.wrapping_add(1);
                        Some((s.app_session_id.clone(), s.stream_emit_flush_gen))
                    } else {
                        None
                    }
                };
                if let Some((sid, gen)) = need_schedule {
                    self.schedule_stream_emit_flush(app.clone(), sid, gen);
                }
            }
            AcpEvent::PromptComplete {
                stop_reason,
                authoritative,
            } => {
                let finished = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::flush_pending_stream_emit(s, app);
                        Self::touch_stream_progress_locked(s);
                        if authoritative {
                            s.prompt_in_flight = false;
                        }
                        s.deferred_prompt_complete = Some(stop_reason.clone());
                        // Keep turn open while tools still running (long find / subagent).
                        match Self::try_finish_deferred_prompt_complete(s, Some(app)) {
                            None => {
                                tracing::info!(
                                    "background prompt_complete deferred sid={} tools={}",
                                    app_session_id,
                                    s.open_tool_ids.len()
                                );
                                false
                            }
                            Some(_) => true,
                        }
                    } else {
                        false
                    }
                };
                if finished {
                    self.promote_background_ready_to_parked(app_session_id);
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
                } else {
                    // Still busy in background — keep liveMap streaming.
                    Self::emit_runtime(
                        app,
                        &SessionSnapshot {
                            session_id: Some(app_session_id.to_string()),
                            agent_session_id: None,
                            state: SessionState::Streaming,
                            last_error: None,
                            streaming_message_id: None,
                            backend: Self::backend_name(),
                            model_id: None,
                            project_path: None,
                            title: String::new(),
                        },
                    );
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::PermissionRequest {
                rpc_id,
                tool_call_id,
                tool_name,
                title,
                options,
                raw,
            } => {
                let preview = raw.to_string();
                let path_target = extract_path_target(&raw);
                let shell_command = extract_shell_command(&raw);
                let sk_source = if path_target.is_empty() {
                    title.clone()
                } else {
                    path_target.clone()
                };
                let sk = scope_key(&tool_name, &sk_source);
                let (auto, auto_deny, session_id, project_path, acp) = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::touch_activity_locked(s);
                        let _ = s.fsm.await_permission();
                        let root = s.project_path.as_ref().map(std::path::PathBuf::from);
                        let auto = may_auto_allow(
                            s.policy,
                            &s.allow_cache,
                            &sk,
                            root.as_deref(),
                            &path_target,
                            &tool_name,
                            &shell_command,
                        );
                        let auto_deny = may_auto_deny(s.policy) && !auto;
                        (
                            auto,
                            auto_deny,
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                            s.acp.clone(),
                        )
                    } else {
                        return;
                    }
                };
                if auto {
                    if let Some(acp) = acp {
                        let option_id = pick_option_id(&options, "allow_once")
                            .or_else(|| pick_option_id(&options, "allow"))
                            .unwrap_or_else(|| "allow_once".into());
                        let _ = acp
                            .respond_permission(rpc_id, PermissionOutcome::Selected { option_id })
                            .await;
                        crate::audit_ledger::record_permission(
                            Some(&session_id),
                            project_path.as_deref(),
                            &tool_name,
                            "auto_allow",
                            Some(&title),
                        );
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
                    }
                } else if auto_deny {
                    if let Some(acp) = acp {
                        let option_id = pick_option_id(&options, "reject_once")
                            .or_else(|| pick_option_id(&options, "reject"))
                            .unwrap_or_else(|| "reject".into());
                        let _ = acp
                            .respond_permission(rpc_id, PermissionOutcome::Selected { option_id })
                            .await;
                        crate::audit_ledger::record_permission(
                            Some(&session_id),
                            project_path.as_deref(),
                            &tool_name,
                            "auto_deny",
                            Some(&title),
                        );
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
                    }
                } else {
                    crate::audit_ledger::remember_permission(
                        &session_id,
                        rpc_id,
                        &tool_name,
                        Some(&title),
                    );
                    let req = UiPermissionRequest {
                        rpc_id,
                        session_id: session_id.clone(),
                        tool_call_id,
                        tool_name,
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options,
                    };
                    let _ = app.emit("session://permission", &req);
                    // Tell UI this permission belongs to a non-focused session.
                    let _ = app.emit(
                        "session://background_permission",
                        serde_json::json!({ "sessionId": session_id }),
                    );
                }
                // Runtime for *this* session, not the live slot: the sidebar
                // must show which chat is waiting (or resumed), otherwise a
                // demoted turn looks idle while it blocks on approval.
                let bg_snap = self
                    .background
                    .lock()
                    .get(app_session_id)
                    .map(Self::snapshot_from_live);
                if let Some(snap) = bg_snap {
                    Self::emit_runtime(app, &snap);
                }
            }
            AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw,
            } => {
                let (detail, path_hint) = extract_tool_ui_fields(&raw);
                let path_out = path_hint.filter(|p| !p.is_empty());
                let (kind_enriched, title_enriched) =
                    enrich_tool_identity_from_raw(&raw, &title, &kind);
                let kind_j = normalize_tool_kind_for_journal(&kind_enriched, &title_enriched);
                let kind_j = if kind_j.is_empty() {
                    kind_enriched.clone()
                } else {
                    kind_j
                };
                let live_title = tool_journal_label(&title_enriched, &kind_j, &detail, &path_out);
                let live_title = if live_title.is_empty() || live_title.eq_ignore_ascii_case("tool")
                {
                    if !title_enriched.is_empty() {
                        title_enriched.clone()
                    } else {
                        live_title
                    }
                } else {
                    live_title
                };
                let (
                    app_sid,
                    project_path,
                    live_title,
                    st,
                    finished,
                    open_changed,
                    already_terminal,
                ) = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        // Defensive: background turns never load-replay, but if
                        // prompt_in_flight is already false, do not mutate journal.
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "background tool_call dropped after turn close sid={} id={tool_call_id}",
                                app_session_id
                            );
                            return;
                        }
                        Self::touch_stream_progress_locked(s);
                        let already_terminal =
                            !tool_call_id.is_empty() && s.terminal_tool_ids.contains(&tool_call_id);
                        let open_changed = if !tool_call_id.is_empty() {
                            Self::note_tool_status_on_session(s, &tool_call_id, &status)
                        } else {
                            false
                        };
                        s.tools_this_turn = s.tools_this_turn.saturating_add(1);
                        let finished =
                            Self::try_finish_deferred_prompt_complete(s, Some(app)).is_some();
                        let st = if status.is_empty() {
                            "in_progress".to_string()
                        } else {
                            status.clone()
                        };
                        // Persist tool_step like live path so journal survives switch.
                        if matches!(st.as_str(), "completed" | "failed" | "error" | "cancelled")
                            && !tool_call_id.is_empty()
                        {
                            let kind_store = if kind_j.is_empty() {
                                if kind_enriched.is_empty() {
                                    "tool".into()
                                } else {
                                    kind_enriched.clone()
                                }
                            } else {
                                kind_j.clone()
                            };
                            let mut content = format!("tool_step|{st}|{kind_store}|{live_title}");
                            if let Some(ref d) = detail {
                                content.push('\n');
                                content.push_str(&d.chars().take(400).collect::<String>());
                            }
                            if let Some(ref p) = path_out {
                                content.push('\n');
                                content.push_str(p);
                            }
                            let mid = format!("tool-{tool_call_id}");
                            let mut msgs = store::load_messages(&s.app_session_id);
                            if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
                                if tool_journal_richer(&slot.content, &content) {
                                    slot.content = content.clone();
                                    slot.marker = Some("tool_step".into());
                                    let _ = store::save_messages(&s.app_session_id, &msgs);
                                }
                            } else {
                                let _ = store::append_message(
                                    &s.app_session_id,
                                    ChatMessageStored {
                                        id: mid,
                                        role: "tool".into(),
                                        content,
                                        thought: None,
                                        created_at: chrono::Utc::now(),
                                        is_error: matches!(st.as_str(), "failed" | "error"),
                                        attachments: None,
                                        marker: Some("tool_step".into()),
                                    },
                                );
                            }
                        }
                        (
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                            live_title,
                            st,
                            finished,
                            open_changed,
                            already_terminal,
                        )
                    } else {
                        return;
                    }
                };
                // Cross-session tool audit (background turn).
                {
                    let audit_name = if !kind.is_empty() {
                        kind.as_str()
                    } else {
                        live_title.as_str()
                    };
                    Self::audit_tool_call(
                        &app_sid,
                        project_path.as_deref(),
                        audit_name,
                        &status,
                        Some(live_title.as_str()),
                        open_changed,
                        already_terminal,
                    );
                }
                let _ = app.emit(
                    "session://tool",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "title": live_title,
                        "kind": if kind_j.is_empty() { kind.clone() } else { kind_j },
                        "status": st,
                        "path": path_out,
                        "detail": detail,
                    }),
                );
                if finished {
                    self.promote_background_ready_to_parked(app_session_id);
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
            }
            AcpEvent::ToolOpenReleased { tool_call_id } => {
                let finished = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            return;
                        }
                        Self::release_tool_open_on_session(s, &tool_call_id);
                        Self::touch_stream_progress_locked(s);
                        Self::try_finish_deferred_prompt_complete(s, Some(app)).is_some()
                    } else {
                        false
                    }
                };
                if finished {
                    self.promote_background_ready_to_parked(app_session_id);
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
            }
            AcpEvent::ProcessExited { .. } => {
                let mut bg = self.background.lock();
                if let Some(mut s) = bg.remove(app_session_id) {
                    let busy = Self::live_session_is_busy(&s)
                        || matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        );
                    if busy {
                        Self::maybe_flush_stream_journal(&mut s, true, false);
                        let mid = Uuid::new_v4().to_string();
                        let content = "turn_cancelled|agent_exit".to_string();
                        let _ = store::append_message(
                            &s.app_session_id,
                            ChatMessageStored {
                                id: mid.clone(),
                                role: "tool".into(),
                                content: content.clone(),
                                thought: None,
                                created_at: chrono::Utc::now(),
                                is_error: true,
                                attachments: None,
                                marker: Some("turn_cancelled".into()),
                            },
                        );
                        let _ = app.emit(
                            "session://turn_marker",
                            serde_json::json!({
                                "sessionId": s.app_session_id,
                                "messageId": mid,
                                "marker": "turn_cancelled",
                                "reason": "agent_exit",
                                "content": content,
                            }),
                        );
                        tracing::warn!(
                            "background agent process exited mid-turn sid={}",
                            s.app_session_id
                        );
                    }
                    let _ = s.fsm.crash("Agent process exited (background)");
                    s.acp = None;
                    s.open_tool_ids.clear();
                    s.terminal_tool_ids.clear();
                    s.open_tool_seen_at.clear();
                    s.streaming_message_id = None;
                    s.active_turn_id = None;
                    s.stream_message_id_locked = false;
                    s.deferred_prompt_complete = None;
                    s.prompt_in_flight = false;
                    let mut snap = Self::snapshot_from_live(&s);
                    snap.state = SessionState::Disconnected;
                    Self::emit_runtime(app, &snap);
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::Error { error } => {
                {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::record_turn_error(s, app, &error);
                        let _ = s.fsm.fail_with(error);
                    }
                }
                self.promote_background_ready_to_parked(app_session_id);
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::UsageReported {
                total_tokens,
                input_tokens,
                output_tokens,
                system_tokens,
                tools_tokens,
                history_tokens,
                cached_read_tokens,
                cache_creation_tokens,
                reasoning_tokens,
                cost_usd_ticks,
                source,
            } => {
                let _ = app.emit(
                    "session://usage",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "totalTokens": total_tokens,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "systemTokens": system_tokens,
                        "toolsTokens": tools_tokens,
                        "historyTokens": history_tokens,
                        "cachedReadTokens": cached_read_tokens,
                        "cacheCreationTokens": cache_creation_tokens,
                        "reasoningTokens": reasoning_tokens,
                        "costUsdTicks": cost_usd_ticks,
                        "source": source,
                    }),
                );
            }
            AcpEvent::HookActivity {
                kind,
                event_name,
                tool_name,
                ok,
                detail,
                raw,
            } => {
                let _ = app.emit(
                    "session://hook",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "kind": kind,
                        "eventName": event_name,
                        "toolName": tool_name,
                        "ok": ok,
                        "detail": detail,
                        "update": raw,
                    }),
                );
            }
            AcpEvent::GoalUpdated {
                goal_id,
                role,
                current_deliverable_title,
                completed_deliverables,
                total_deliverables,
                verifying_completion,
                last_classifier_verdict,
                raw,
            } => {
                let _ = app.emit(
                    "session://goal",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "goalId": goal_id,
                        "currentSubagentRole": role,
                        "currentDeliverableTitle": current_deliverable_title,
                        "completedDeliverables": completed_deliverables,
                        "totalDeliverables": total_deliverables,
                        "verifyingCompletion": verifying_completion,
                        "lastClassifierVerdict": last_classifier_verdict,
                        "update": raw,
                    }),
                );
            }
            _ => {
                // ask_user / plan / stderr / retry — still forward with session id when possible
                tracing::debug!("background acp event ignored variant for sid={app_session_id}");
            }
        }
    }
}
