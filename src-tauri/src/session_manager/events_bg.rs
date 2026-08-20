//! Background ACP event pump handler.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{
    provider_retry_abort_error, provider_retry_abort_rpc_message, should_abort_provider_retry_ex,
    AcpEvent, PermissionOutcome, StreamKind, HOST_PROVIDER_MAX_RETRIES,
};
use crate::journal_throttle::is_paragraph_break;
use crate::permission::{
    coerce_wire_option_id_for_tool, extract_path_target, extract_shell_command, may_auto_allow,
    may_auto_deny, resolve_reject_option_id, scope_key,
};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};

use super::*;

impl SessionManager {
    pub(super) async fn handle_acp_event_on_background(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: &str,
        process_id: &str,
        agent_session_id: Option<&str>,
        ev: AcpEvent,
    ) {
        // Routing is decided from a snapshot, but focus/park transitions can
        // move the map before this async handler is polled. Re-check the
        // process and (when stamped) ACP session identity at the application
        // boundary so a late event cannot write into a newly reused slot.
        let route_matches = self.background.lock().get(app_session_id).is_some_and(|s| {
            s.process_id == process_id
                && agent_session_id.is_none_or(|sid| {
                    // Stamped events must name this background session
                    // exactly; an unset owner is not a safe wildcard while a
                    // focus/park transition is moving the same process.
                    s.meta.agent_session_id.as_deref() == Some(sid)
                })
        });
        if !route_matches {
            tracing::debug!(
                session = %app_session_id,
                process = %process_id,
                agent = ?agent_session_id,
                "background ACP event dropped after route changed"
            );
            return;
        }
        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                let (need_schedule, pending_journal) = {
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
                    if Self::is_session_load_replay(s) {
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
                    // Prepare only — disk write runs after `background` is
                    // released so a contended store file lock can't stall
                    // every other session command (same rule as the live path).
                    let pending_journal = Self::prepare_stream_journal_flush(s, done, para);
                    let mid = s.streaming_message_id.clone().unwrap_or_default();
                    let need =
                        Self::queue_stream_emit(s, app, kind, mid, text, thought_phase, done);
                    let need_schedule = if need {
                        s.stream_emit_flush_gen = s.stream_emit_flush_gen.wrapping_add(1);
                        Some((s.app_session_id.clone(), s.stream_emit_flush_gen))
                    } else {
                        None
                    };
                    (need_schedule, pending_journal)
                };
                if let Some(pending) = pending_journal {
                    Self::commit_stream_journal_flush(pending);
                }
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
                        if !Self::should_rearm_deferred_prompt_complete(s) {
                            false
                        } else {
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
                        // Hyphenated CLI wire optionIds (#523 / #542).
                        let option_id = coerce_wire_option_id_for_tool(
                            "allow_once",
                            None,
                            &options,
                            &tool_name,
                        );
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
                        let option_id = resolve_reject_option_id(&options);
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
                        tool_name: tool_name.clone(),
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options: options.clone(),
                    };
                    // Keep the full UI payload so a remounted WebView can
                    // recover the card (one-shot emit below can be missed).
                    {
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            s.pending_permission_rpc_id = Some(rpc_id);
                            s.pending_permission_options = Some(options);
                            s.pending_permission_tool_name = Some(tool_name.clone());
                            s.pending_permission_ui = Some(req.clone());
                            let command = crate::session_manager::extract_tool_input(&raw)
                                .unwrap_or_default();
                            crate::turn_lease::update_active(
                                &s.app_session_id,
                                "permission_prompt",
                                true,
                                Some(crate::turn_lease::PendingTool {
                                    tool_call_id: req.tool_call_id.clone(),
                                    tool_name: tool_name.clone(),
                                    title: req.title.clone(),
                                    command,
                                }),
                            );
                        }
                    }
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
                if !app_session_id.is_empty() {
                    remember_tool_identity(
                        &self.tool_identities,
                        app_session_id,
                        &tool_call_id,
                        &title,
                        &kind,
                        &raw,
                    );
                }
                let (title2, kind2, name2, input2) = resolve_tool_identity(
                    &self.tool_identities,
                    app_session_id,
                    &tool_call_id,
                    &title,
                    &kind,
                );
                let (kind_enriched, title_enriched) =
                    enrich_tool_identity_from_raw(&raw, &title2, &kind2);
                let kind_j = normalize_tool_kind_for_journal(&kind_enriched, &title_enriched);
                let kind_j = if kind_j.is_empty() {
                    kind_enriched.clone()
                } else {
                    kind_j
                };
                // Journal kind = machine tool name when known (UI maps names to
                // typed icons + localized labels).
                let kind_store = if !name2.is_empty() && !name2.eq_ignore_ascii_case("tool") {
                    name2.clone()
                } else {
                    kind_j.clone()
                };
                let live_title =
                    tool_journal_label(&title_enriched, &kind_store, &detail, &path_out);
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
                        if Self::is_session_load_replay(s) {
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
                            let title_line = tool_journal_one_line(&live_title, 240);
                            let mut content = format!("tool_step|{st}|{kind_store}|{title_line}");
                            if let Some(inp) = input2.as_deref().filter(|s| !s.trim().is_empty()) {
                                content.push('\n');
                                content.push_str("input:");
                                // One line only so `input:` is always rest[0] for the parser.
                                content.push_str(&tool_journal_one_line(inp, 400));
                            }
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
                                    if let Err(e) = store::save_messages(&s.app_session_id, &msgs) {
                                        tracing::error!(
                                            session = %s.app_session_id,
                                            tool = %tool_call_id,
                                            "background tool journal update failed: {e}"
                                        );
                                    }
                                }
                            } else {
                                if let Err(e) = store::append_message(
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
                                ) {
                                    tracing::error!(
                                        session = %s.app_session_id,
                                        tool = %tool_call_id,
                                        "background tool journal append failed: {e}"
                                    );
                                }
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
                        // Call argument (target file / command / query) for primary labels.
                        "input": input2,
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
                        if Self::is_session_load_replay(s) {
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
            AcpEvent::ProcessExited { code } => {
                self.pending_soft_respawn.lock().remove(app_session_id);
                let mut gate_invalidations: Vec<serde_json::Value> = Vec::new();
                let mut bg = self.background.lock();
                if let Some(mut s) = bg.remove(app_session_id) {
                    // No done flag — crash must not Ready the UI before
                    // Disconnected (P1-10).
                    Self::flush_pending_stream_emit(&mut s, app);
                    Self::maybe_flush_stream_journal(&mut s, true, false);
                    let busy = Self::live_session_is_busy(&s)
                        || matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        );
                    if busy {
                        Self::journal_turn_cancelled(&mut s, Some(app), "agent_exit");
                        tracing::warn!(
                            "background agent process exited mid-turn sid={}",
                            s.app_session_id
                        );
                    }
                    if let Some(row) = Self::take_pending_gate_invalidation(&mut s) {
                        crate::plan_chrome::mark_gate_stale(&s.app_session_id);
                        gate_invalidations.push(row);
                    }
                    let detail = match code {
                        Some(status) => {
                            format!("Agent process exited (background, code {status})")
                        }
                        None => "Agent process exited (background, EOF/unknown status)".into(),
                    };
                    let _ = s.fsm.crash(detail);
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
                drop(bg);
                Self::emit_gates_invalidated(app, "agent_exit", gate_invalidations);
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
                model_calls,
                api_duration_ms,
                cost_is_partial,
                usage_is_incomplete,
                context_window,
                percentage,
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
                        "modelCalls": model_calls,
                        "apiDurationMs": api_duration_ms,
                        "costIsPartial": cost_is_partial,
                        "usageIsIncomplete": usage_is_incomplete,
                        "contextWindow": context_window,
                        "percentage": percentage,
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
            // Human gates must work off-focus: demoted turns raise exit_plan_mode /
            // ask_user_question on the background pump. Ignoring them left the agent
            // wedged on reverse-RPC with no UI (plan mode disconnect class of bugs).
            AcpEvent::Plan {
                entries,
                body,
                rpc_id,
                tool_call_id,
            } => {
                {
                    let mut bg = self.background.lock();
                    let Some(s) = bg.get_mut(app_session_id) else {
                        return;
                    };
                    if Self::should_drop_plan_event(
                        s.prompt_in_flight,
                        s.pending_plan_rpc_id.is_some(),
                        rpc_id.is_some(),
                    ) {
                        tracing::debug!(
                            "background plan dropped: idle after turn close sid={app_session_id}"
                        );
                        return;
                    }
                    if let Some(id) = rpc_id {
                        s.pending_plan_rpc_id = Some(id);
                        Self::touch_activity_locked(s);
                    }
                }
                crate::plan_chrome::upsert_from_plan_event(
                    app_session_id,
                    &entries,
                    &body,
                    rpc_id,
                    &tool_call_id,
                );
                let _ = app.emit(
                    "session://plan",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "entries": entries,
                        "body": body,
                        "rpcId": rpc_id,
                        "toolCallId": tool_call_id,
                        "waiting": rpc_id.is_none(),
                    }),
                );
                let bg_snap = self
                    .background
                    .lock()
                    .get(app_session_id)
                    .map(Self::snapshot_from_live);
                if let Some(snap) = bg_snap {
                    Self::emit_runtime(app, &snap);
                }
            }
            AcpEvent::AskUserQuestion {
                rpc_id,
                tool_call_id,
                questions,
                raw: _,
            } => {
                {
                    let mut bg = self.background.lock();
                    let Some(s) = bg.get_mut(app_session_id) else {
                        return;
                    };
                    if Self::should_drop_ask_user_event(s.prompt_in_flight) {
                        return;
                    }
                    s.pending_ask_user_rpc_id = Some(rpc_id);
                    Self::touch_activity_locked(s);
                }
                let _ = app.emit(
                    "session://ask_user",
                    serde_json::json!({
                        "rpcId": rpc_id,
                        "sessionId": app_session_id,
                        "toolCallId": tool_call_id,
                        "questions": questions,
                    }),
                );
                // Same signal as background permission — toast / sidebar attention.
                let _ = app.emit(
                    "session://background_permission",
                    serde_json::json!({ "sessionId": app_session_id, "kind": "ask_user" }),
                );
                let bg_snap = self
                    .background
                    .lock()
                    .get(app_session_id)
                    .map(Self::snapshot_from_live);
                if let Some(snap) = bg_snap {
                    Self::emit_runtime(app, &snap);
                }
            }
            AcpEvent::RetryState {
                attempt,
                max_retries,
                reason,
                status,
            } => {
                let cap = max_retries.clamp(1, HOST_PROVIDER_MAX_RETRIES);
                let abort = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        s.provider_retry_attempt = attempt;
                        if !Self::should_apply_provider_retry_abort(s) {
                            false
                        } else if s.provider_retry_aborted {
                            false
                        } else {
                            should_abort_provider_retry_ex(attempt, max_retries, &status, &reason)
                        }
                    } else {
                        false
                    }
                };
                let _ = app.emit(
                    "session://retry",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "attempt": attempt,
                        "maxRetries": cap,
                        "reason": reason,
                        "status": status,
                        "aborting": abort,
                    }),
                );
                if abort {
                    let (acp, agent_sid) = {
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            if s.provider_retry_aborted {
                                (None, None)
                            } else {
                                s.provider_retry_aborted = true;
                                let err = provider_retry_abort_error(attempt, cap, &reason);
                                Self::record_turn_error(s, app, &err);
                                let _ = s.fsm.fail_with(err);
                                (s.acp.clone(), s.meta.agent_session_id.clone())
                            }
                        } else {
                            (None, None)
                        }
                    };
                    if let Some(acp) = acp {
                        let abort_msg = provider_retry_abort_rpc_message(&reason);
                        acp.abort_pending_prompts(&abort_msg);
                        let _ = match agent_sid {
                            Some(sid) => acp.cancel_for(&sid).await,
                            None => acp.cancel().await,
                        };
                    }
                    self.promote_background_ready_to_parked(app_session_id);
                    Self::emit_state(app, &self.snapshot());
                }
            }
            _ => {
                // stderr / other variants — log only
                tracing::debug!("background acp event ignored variant for sid={app_session_id}");
            }
        }
    }
}
