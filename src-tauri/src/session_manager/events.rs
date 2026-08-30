//! Live ACP event pump handler.

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
    may_auto_deny, permission_preview_text, resolve_reject_option_id, scope_key,
};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};

use super::*;

impl SessionManager {
    pub(super) async fn handle_acp_event(
        self: &Arc<Self>,
        app: &AppHandle,
        process_id: &str,
        session_id: Option<&str>,
        ev: AcpEvent,
    ) {
        // Process death is process-scoped: always scrub co-tenants first, then
        // deliver to live if this process is the focused shell.
        if let AcpEvent::ProcessExited { code } = &ev {
            let exit_code = *code;
            {
                let mut parked = self.parked.lock();
                parked.retain(|_, p| p.process_id != process_id);
            }
            // Background mid-turn shells need their own cancel path.
            let bg_ids: Vec<String> = self
                .background
                .lock()
                .iter()
                .filter(|(_, s)| s.process_id == process_id)
                .map(|(id, _)| id.clone())
                .collect();
            for bg_id in bg_ids {
                self.pending_soft_respawn.lock().remove(&bg_id);
                self.handle_acp_event_on_background(
                    app,
                    &bg_id,
                    process_id,
                    None,
                    AcpEvent::ProcessExited { code: exit_code },
                )
                .await;
            }
            let live_sid = self
                .inner
                .lock()
                .as_ref()
                .filter(|s| s.process_id == process_id)
                .map(|s| s.app_session_id.clone());
            if live_sid.is_none() {
                return;
            }
            if let Some(sid) = live_sid {
                self.pending_soft_respawn.lock().remove(&sid);
            }
            // Fall through to live ProcessExited handling below.
        } else {
            // Multi-session safety (P0): route by agent sessionId when present;
            // never rescue a parked co-tenant into a fake mid-turn (that wrote
            // foreign session/load replay into the wrong App journal).
            let live_hint = self.inner.lock().as_ref().map(|s| SessionRouteHint {
                app_session_id: s.app_session_id.clone(),
                process_id: s.process_id.clone(),
                agent_session_id: s.meta.agent_session_id.clone(),
                prompt_in_flight: s.prompt_in_flight,
            });
            let bg_hints: Vec<SessionRouteHint> = self
                .background
                .lock()
                .values()
                .map(|s| SessionRouteHint {
                    app_session_id: s.app_session_id.clone(),
                    process_id: s.process_id.clone(),
                    agent_session_id: s.meta.agent_session_id.clone(),
                    prompt_in_flight: s.prompt_in_flight,
                })
                .collect();
            let parked_hints: Vec<SessionRouteHint> = self
                .parked
                .lock()
                .values()
                .map(|p| SessionRouteHint {
                    app_session_id: p.app_session_id.clone(),
                    process_id: p.process_id.clone(),
                    agent_session_id: p.meta.agent_session_id.clone(),
                    prompt_in_flight: false,
                })
                .collect();
            match resolve_turn_event_route(
                process_id,
                session_id,
                live_hint.as_ref(),
                &bg_hints,
                &parked_hints,
            ) {
                TurnEventRoute::Background(bg_sid) => {
                    self.handle_acp_event_on_background(app, &bg_sid, process_id, session_id, ev)
                        .await;
                    return;
                }
                TurnEventRoute::Drop => {
                    if Self::event_carries_turn_output(&ev) {
                        tracing::debug!(
                            "acp event dropped: no apply target process={process_id} agent_sid={session_id:?} ev={}",
                            Self::event_kind_name(&ev)
                        );
                    }
                    return;
                }
                TurnEventRoute::Live => {
                    // Fall through to live match below.
                }
            }
        }

        // The route snapshot above is advisory. Re-check the live slot before
        // applying the event so a concurrent focus/park transition cannot
        // deliver a late process event to the next chat occupying the slot.
        let live_route_matches = self.inner.lock().as_ref().is_some_and(|s| {
            s.process_id == process_id
                && session_id.is_none_or(|sid| {
                    // Once the wire event carries a session id, require an
                    // exact owner match. Treating an unbound live hint as a
                    // wildcard lets late events from a co-tenant land in the
                    // newly focused session during connect/park races.
                    s.meta.agent_session_id.as_deref() == Some(sid)
                })
        });
        if !live_route_matches {
            if Self::event_carries_turn_output(&ev) {
                tracing::debug!(
                    process = %process_id,
                    agent = ?session_id,
                    ev = Self::event_kind_name(&ev),
                    "live ACP event dropped after route changed"
                );
            }
            return;
        }

        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                // Host stream backpressure: coalesce high-frequency tokens.
                let (need_schedule, pending_journal) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Replay guard: on session resume (`session/load`) the CLI
                        // replays the past transcript as agent_message_chunk
                        // notifications. Without a guard the UI re-types the whole
                        // history on every session switch.
                        //
                        // Gate on `prompt_in_flight`, NOT on the FSM: the agent can
                        // fire `prompt_complete` early (which Readies the FSM) and
                        // keep streaming for many more seconds. Gating on the FSM
                        // silently truncated those answers mid-sentence.
                        if Self::is_session_load_replay(s) {
                            tracing::debug!(
                                "acp stream dropped: no prompt in flight (fsm={:?}) — replay",
                                s.fsm.state()
                            );
                            return;
                        }
                        // Agent resumed talking after an early prompt_complete —
                        // re-open the turn so the tail is captured and shown.
                        if s.fsm.state() == SessionState::Ready && s.fsm.begin_stream().is_ok() {
                            tracing::info!(
                                "acp turn re-opened: chunk after early prompt_complete sid={}",
                                s.app_session_id
                            );
                        }
                        // Stream chunk = progress (I06); not pure silence.
                        Self::touch_stream_progress_locked(s);
                        // Prefer agent-supplied messageId unless an interjection
                        // deliberately split this turn into a new host-owned row.
                        Self::ensure_stream_message_id(s, kind, message_id);
                        // Split thinking whenever it resumes after *non-empty* body
                        // text so the UI can interleave thought ↔ content. Empty
                        // assistant ticks must not open a new phase — they caused
                        // journal multi-phase markers that reloaded as trailing
                        // "思考 2 / 思考 3" under the answer.
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
                        // I04: throttled mid-stream journal (force on terminal done chunk).
                        let para = is_paragraph_break(&text);
                        // prompt_for emits an empty done tick when the RPC
                        // returns — often while tools are still open. Do not
                        // paint 工作了 / copy-retry until the turn can finish.
                        let emit_done = done
                            && crate::turn_complete::should_emit_stream_done(
                                s.prompt_in_flight,
                                s.fsm.state() == SessionState::AwaitingPermission,
                                s.pending_plan_rpc_id.is_some(),
                                s.pending_ask_user_rpc_id.is_some(),
                                s.open_tool_ids.len(),
                            );
                        // Prepare only — the disk write happens after `inner`
                        // is released. Journal appends poll a cross-process
                        // file lock (shared GROK_HOME); holding `inner` across
                        // that stall blocked every session command for seconds.
                        let pending_journal =
                            Self::prepare_stream_journal_flush(s, emit_done, para);
                        let mid = s.streaming_message_id.clone().unwrap_or_default();
                        let need = Self::queue_stream_emit(
                            s,
                            app,
                            kind,
                            mid,
                            text,
                            thought_phase,
                            emit_done,
                        );
                        let need_schedule = if need {
                            s.stream_emit_flush_gen = s.stream_emit_flush_gen.wrapping_add(1);
                            Some((s.app_session_id.clone(), s.stream_emit_flush_gen))
                        } else {
                            None
                        };
                        (need_schedule, pending_journal)
                    } else {
                        return;
                    }
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
                let empty_run = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Flush any buffered stream before turn-end signals.
                        Self::flush_pending_stream_emit(s, app);
                        Self::touch_stream_progress_locked(s);
                        // Only the RPC result ends the turn. It is ordered after
                        // every chunk, so clearing here cannot truncate output.
                        if authoritative {
                            s.prompt_in_flight = false;
                        }
                        if !Self::should_rearm_deferred_prompt_complete(s) {
                            None
                        } else {
                            s.deferred_prompt_complete = Some(stop_reason.clone());
                            // #52: do not Ready the UI while tools / permission / ask_user / plan
                            // are still open — agent often fires prompt_complete early.
                            match Self::try_finish_deferred_prompt_complete(s, Some(app)) {
                                None => {
                                    tracing::info!(
                                        "acp prompt_complete deferred stop={stop_reason} tools={} perm={} plan={} ask={}",
                                        s.open_tool_ids.len(),
                                        s.fsm.state() == SessionState::AwaitingPermission,
                                        s.pending_plan_rpc_id.is_some(),
                                        s.pending_ask_user_rpc_id.is_some(),
                                    );
                                    None
                                }
                                Some(empty) => empty,
                            }
                        }
                    } else {
                        None
                    }
                };
                Self::emit_state(app, &self.snapshot());
                Self::emit_empty_run_if_any(app, empty_run);
            }
            AcpEvent::PermissionRequest {
                rpc_id,
                tool_call_id,
                tool_name,
                title,
                options,
                raw,
            } => {
                // During session/load replay, never surface a permission UI or
                // leave the agent blocked on a historical tool approval.
                let replay_acp = {
                    let guard = self.inner.lock();
                    guard.as_ref().and_then(|s| {
                        if Self::is_session_load_replay(s) {
                            s.acp.clone()
                        } else {
                            None
                        }
                    })
                };
                if let Some(acp) = replay_acp {
                    // CLI wire optionIds are hyphenated (#523 / #542).
                    let option_id =
                        coerce_wire_option_id_for_tool("allow_once", None, &options, &tool_name);
                    tracing::debug!(
                        "acp permission auto-resolved during load replay tool={tool_name}"
                    );
                    let _ = acp
                        .respond_permission(rpc_id, PermissionOutcome::Selected { option_id })
                        .await;
                    return;
                }

                let preview = permission_preview_text(&raw, &title);
                let path_target = extract_path_target(&raw);
                let shell_command = extract_shell_command(&raw);
                let sk_source = if path_target.is_empty() {
                    title.clone()
                } else {
                    path_target.clone()
                };
                let sk = scope_key(&tool_name, &sk_source);
                let (auto, auto_deny, session_id, project_path) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        Self::touch_activity_locked(s);
                        let _ = s.fsm.await_permission();
                        // Use live session policy (updated by chip / settings_set / set_policy).
                        // Do NOT re-read only global settings — project/session scope would break.
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
                        let auto_deny = !auto && may_auto_deny(s.policy);
                        (
                            auto,
                            auto_deny,
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                        )
                    } else {
                        return;
                    }
                };
                if auto {
                    let acp = self.inner.lock().as_ref().and_then(|s| s.acp.clone());
                    if let Some(acp) = acp {
                        // Grok Build CLI publishes hyphenated wire optionIds
                        // (`allow-once`, `always-allow`, …). Underscore fallbacks
                        // are rejected as "unknown permission option" (#523 / #542).
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
                        let empty = {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                if s.fsm.state() == SessionState::AwaitingPermission {
                                    let _ = s.fsm.permission_resolved_continue();
                                }
                                Self::try_finish_deferred_prompt_complete(s, Some(app)).flatten()
                            } else {
                                None
                            }
                        };
                        Self::emit_empty_run_if_any(app, empty);
                    }
                } else if auto_deny {
                    let acp = self.inner.lock().as_ref().and_then(|s| s.acp.clone());
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
                        let empty = {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                if s.fsm.state() == SessionState::AwaitingPermission {
                                    let _ = s.fsm.permission_resolved_continue();
                                }
                                Self::try_finish_deferred_prompt_complete(s, Some(app)).flatten()
                            } else {
                                None
                            }
                        };
                        Self::emit_empty_run_if_any(app, empty);
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
                        session_id,
                        tool_call_id: tool_call_id.clone(),
                        tool_name: tool_name.clone(),
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options: options.clone(),
                    };
                    // Track pending permission + process generation so recycle
                    // can invalidate stale UI bars (#524). Keep the full UI
                    // payload so a remounted WebView can recover the card.
                    {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
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
                                    tool_call_id: tool_call_id.clone(),
                                    tool_name: tool_name.clone(),
                                    title: req.title.clone(),
                                    command,
                                }),
                            );
                        }
                    }
                    let _ = app.emit("session://permission", &req);
                    Self::emit_state(app, &self.snapshot());
                }
            }
            AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw,
            } => {
                // Replay guard (P0): session/load floods tool_call history.
                // UI journal is source of truth — do not re-emit, re-write journal,
                // or mutate open_tool_ids during resume.
                {
                    let guard = self.inner.lock();
                    if let Some(s) = guard.as_ref() {
                        if Self::is_session_load_replay(s) {
                            tracing::debug!(
                                "acp tool_call dropped: no prompt in flight (replay) id={tool_call_id} status={status}"
                            );
                            return;
                        }
                    } else {
                        return;
                    }
                }

                // Project path for soft-attach gating (workspace media only).
                let (app_sid, project_path) = {
                    let guard = self.inner.lock();
                    (
                        guard.as_ref().map(|s| s.app_session_id.clone()),
                        guard.as_ref().and_then(|s| s.project_path.clone()),
                    )
                };

                // Tool identity for freeform-media gating: terminal / file /
                // search tool output is arbitrary text — a curl scrape printing
                // image URLs must not become an unrelated chat image card.
                // Structured `rawOutput` media stays trusted unconditionally.
                let (title_id, kind_id, name_id, _input_id) = resolve_tool_identity(
                    &self.tool_identities,
                    app_sid.as_deref().unwrap_or(""),
                    &tool_call_id,
                    &title,
                    &kind,
                );
                let (kind_enr_id, title_enr_id) =
                    enrich_tool_identity_from_raw(&raw, &title_id, &kind_id);
                let freeform_media_capable =
                    tool_is_media_capable(&name_id, &kind_enr_id, &title_enr_id, &raw);

                // Structured (force-grant) vs freeform (soft: allowlist/project only).
                // Soft avoids incidental tool reads of plugin logos under ~/.codex
                // becoming undeliverable paperclip thumbs.
                let structured_media = if status == "completed" {
                    extract_structured_media_path(&raw)
                } else {
                    None
                };
                let freeform_media = if status == "completed"
                    && structured_media.is_none()
                    && freeform_media_capable
                {
                    extract_freeform_media_path(&raw)
                } else {
                    None
                };

                let (detail, path_hint) = extract_tool_ui_fields(&raw);
                let path_out = structured_media
                    .clone()
                    .or_else(|| freeform_media.clone())
                    .or(path_hint)
                    .filter(|p| !p.is_empty());
                let (before_snip, after_snip) = extract_tool_content_snippets(&raw);
                // Real tool output (ACP `content[]`) — powers the expandable body.
                let output = extract_tool_output(&raw);

                let prepared = completed_tool_media_attachment(
                    &raw,
                    &name_id,
                    &kind_enr_id,
                    &title_enr_id,
                    project_path.as_deref(),
                    &status,
                );

                if let Some(path) = prepared {
                    // Local file (granted) or remote https media (ChatCut S3).
                    let att = attachment_from_path(&path);
                    let (app_sid, mid) = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            Self::touch_stream_progress_locked(s);
                            if !s.stream_attachments.iter().any(|a| a.path == att.path) {
                                s.stream_attachments.push(att.clone());
                            }
                            (
                                s.app_session_id.clone(),
                                s.streaming_message_id.clone().unwrap_or_default(),
                            )
                        } else {
                            (String::new(), String::new())
                        }
                    };
                    // Keep event name for backward compat; used for image + video.
                    let _ = app.emit(
                        "session://generated_image",
                        serde_json::json!({
                            "sessionId": app_sid,
                            "messageId": mid,
                            "path": att.path,
                            "name": att.name,
                            "toolCallId": tool_call_id,
                            "kind": if is_video_fs_path(&att.path) { "video" } else { "image" },
                        }),
                    );
                }

                let (app_sid, project_path, empty_run, open_changed, already_terminal) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Tool events count as progress so long tools never false-stall (I06).
                        Self::touch_stream_progress_locked(s);
                        let already_terminal =
                            !tool_call_id.is_empty() && s.terminal_tool_ids.contains(&tool_call_id);
                        let open_changed = if !tool_call_id.is_empty() {
                            Self::note_tool_status_on_session(s, &tool_call_id, &status)
                        } else {
                            false
                        };
                        s.tools_this_turn = s.tools_this_turn.saturating_add(1);
                        // Tools settled → apply deferred prompt_complete if any (#52).
                        let finished = Self::try_finish_deferred_prompt_complete(s, Some(app));
                        (
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                            finished,
                            open_changed,
                            already_terminal,
                        )
                    } else {
                        (String::new(), None, None, false, false)
                    }
                };
                Self::emit_empty_run_if_any(app, empty_run.clone().flatten());
                // Live ToolCall used to flatten away Some(None)=finished, so
                // Ready never reached the UI and the composer stayed on Stop.
                if empty_run.is_some() {
                    Self::emit_state(app, &self.snapshot());
                }

                // Live tool activity for UI — recover identity when completed
                // updates omit title/kind (sparse status-only payloads).
                if !app_sid.is_empty() {
                    remember_tool_identity(
                        &self.tool_identities,
                        &app_sid,
                        &tool_call_id,
                        &title,
                        &kind,
                        &raw,
                    );
                }
                let (title2, kind2, name2, input2) = resolve_tool_identity(
                    &self.tool_identities,
                    &app_sid,
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
                // Journal kind = machine tool name when known (read_file,
                // run_terminal_command…). The UI maps names to typed icons +
                // localized labels; bare category kinds are the fallback.
                let kind_store = if !name2.is_empty() && !name2.eq_ignore_ascii_case("tool") {
                    name2.clone()
                } else {
                    kind_j.clone()
                };
                let live_title =
                    tool_journal_label(&title_enriched, &kind_store, &detail, &path_out);
                let live_title =
                    if !live_title.is_empty() && !live_title.eq_ignore_ascii_case("tool") {
                        live_title
                    } else if !title_enriched.is_empty() {
                        title_enriched.clone()
                    } else if let Some(ref d) = detail {
                        d.clone()
                    } else if let Some(ref p) = path_out {
                        p.clone()
                    } else if !kind_j.is_empty() && !kind_j.eq_ignore_ascii_case("tool") {
                        kind_j.replace('_', " ")
                    } else {
                        "tool".into()
                    };
                // Cross-session tool audit (soft-fail; redacted summary).
                if !app_sid.is_empty() {
                    let audit_name = if !kind.is_empty() {
                        kind.as_str()
                    } else if !title.is_empty() {
                        title.as_str()
                    } else {
                        "tool"
                    };
                    let audit_summary = if !live_title.is_empty() {
                        Some(live_title.as_str())
                    } else {
                        detail.as_deref().or(path_out.as_deref())
                    };
                    Self::audit_tool_call(
                        &app_sid,
                        project_path.as_deref(),
                        audit_name,
                        &status,
                        audit_summary,
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
                        "kind": if kind_j.is_empty() { kind.clone() } else { kind_j.clone() },
                        "status": if status.is_empty() { "in_progress" } else { &status },
                        "path": path_out,
                        "detail": detail,
                        // Call argument (target file / command / query) for primary labels.
                        "input": input2,
                        // What the tool actually produced (stdout / file text) — expand body.
                        "output": output,
                        // Optional content snippets for the session Changes / diff panel.
                        "before": before_snip,
                        "after": after_snip,
                    }),
                );

                // Persist completed/failed tool steps so reload still shows work trail.
                let st = if status.is_empty() {
                    "in_progress"
                } else {
                    status.as_str()
                };
                if matches!(st, "completed" | "failed" | "error" | "cancelled")
                    && !app_sid.is_empty()
                    && !tool_call_id.is_empty()
                {
                    let label =
                        tool_journal_label(&title_enriched, &kind_store, &detail, &path_out);
                    let label = if label.is_empty() || label.eq_ignore_ascii_case("tool") {
                        live_title.clone()
                    } else {
                        label
                    };
                    let label_line = tool_journal_one_line(&label, 240);
                    let mut content = format!("tool_step|{st}|{kind_store}|{label_line}");
                    if let Some(inp) = input2.as_deref().filter(|s| !s.trim().is_empty()) {
                        // Call argument (target file / command / query) — the
                        // UI shows this as the specific tool detail.
                        // One line only so `input:` is always rest[0] for the parser.
                        content.push('\n');
                        content.push_str("input:");
                        content.push_str(&tool_journal_one_line(inp, 400));
                    }
                    if let Some(ref d) = detail {
                        content.push('\n');
                        content.push_str(&d.chars().take(400).collect::<String>());
                    }
                    if let Some(ref p) = path_out {
                        // Always persist path/url so reload can paint “Browsed …”.
                        content.push('\n');
                        content.push_str(p);
                    }
                    // Real tool output last, behind a sentinel line, so everything
                    // above stays byte-identical to the legacy layout (old rows and
                    // the positional detail/path heuristic keep parsing unchanged).
                    if let Some(ref o) = output {
                        content.push('\n');
                        content.push_str(TOOL_OUTPUT_SENTINEL);
                        content.push('\n');
                        content.push_str(o);
                    }
                    let mid = format!("tool-{tool_call_id}");
                    let is_error = matches!(st, "failed" | "error");
                    let app_sid_j = app_sid.clone();
                    let tool_call_id_j = tool_call_id.clone();
                    // Disk RMW must not stall the ACP pump (later stream tokens).
                    tauri::async_runtime::spawn_blocking(move || {
                        persist_completed_tool_journal(
                            app_sid_j,
                            tool_call_id_j,
                            mid,
                            content,
                            is_error,
                        );
                    });
                }
            }
            AcpEvent::ToolOpenReleased { tool_call_id } => {
                let empty_run = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if Self::is_session_load_replay(s) {
                            return;
                        }
                        Self::release_tool_open_on_session(s, &tool_call_id);
                        // Progress without re-arming a false open tool.
                        Self::touch_stream_progress_locked(s);
                        Self::try_finish_deferred_prompt_complete(s, Some(app)).flatten()
                    } else {
                        None
                    }
                };
                Self::emit_empty_run_if_any(app, empty_run);
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::Plan {
                entries,
                body,
                rpc_id,
                tool_call_id,
            } => {
                let app_sid = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Do not use bare is_session_load_replay: Build re-parks
                        // exit_plan_mode after session/load with no prompt in flight.
                        if Self::should_drop_plan_event(
                            s.prompt_in_flight,
                            s.pending_plan_rpc_id.is_some(),
                            rpc_id.is_some(),
                        ) {
                            tracing::debug!(
                                "acp plan dropped: idle load-replay (no rpc, no pending gate)"
                            );
                            return;
                        }
                        if let Some(id) = rpc_id {
                            s.pending_plan_rpc_id = Some(id);
                            Self::touch_activity_locked(s);
                        }
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
                crate::plan_chrome::upsert_from_plan_event(
                    &app_sid,
                    &entries,
                    &body,
                    rpc_id,
                    &tool_call_id,
                );
                let _ = app.emit(
                    "session://plan",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "entries": entries,
                        "body": body,
                        "rpcId": rpc_id,
                        "toolCallId": tool_call_id,
                        "waiting": rpc_id.is_none(),
                    }),
                );
            }
            AcpEvent::AskUserQuestion {
                rpc_id,
                tool_call_id,
                questions,
                raw: _,
            } => {
                let pending = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Live reverse-RPC — never drop as session/load replay.
                        if Self::should_drop_ask_user_event(s.prompt_in_flight) {
                            return;
                        }
                        s.pending_ask_user_rpc_id = Some(rpc_id);
                        let pending = UiAskUserRequest {
                            rpc_id,
                            session_id: s.app_session_id.clone(),
                            tool_call_id,
                            questions,
                        };
                        s.pending_ask_user_ui = Some(pending.clone());
                        Self::touch_activity_locked(s);
                        pending
                    } else {
                        return;
                    }
                };
                // Emit the stored payload so a restore and a live emit cannot drift.
                let _ = app.emit("session://ask_user", &pending);
            }
            AcpEvent::Error { error } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if !s.provider_retry_aborted {
                            Self::record_turn_error(s, app, &error);
                        } else {
                            // Retry path already recorded the error; still drop busy
                            // markers so reconnect is not stuck Disconnected+busy.
                            Self::release_failed_turn_markers(s, Some(app));
                        }
                        let _ = s.fsm.fail_with(error);
                    }
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::ProcessExited { code } => {
                let mut gate_invalidations: Vec<serde_json::Value> = Vec::new();
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Deliver the last coalesced stream batch before we drop
                        // the live slot — otherwise ~40ms / 600 chars vanish.
                        // Do not mark done: that would Ready the UI before
                        // fsm.crash / Disconnected (P1-10).
                        Self::flush_pending_stream_emit(s, app);
                        Self::maybe_flush_stream_journal(s, true, false);
                        let st = s.fsm.state();
                        // Busy includes pending plan / ask_user (not only Streaming FSM).
                        let was_busy = Self::live_session_is_busy(s)
                            || matches!(
                                st,
                                SessionState::Streaming | SessionState::AwaitingPermission
                            );
                        if was_busy {
                            Self::journal_turn_cancelled(s, Some(app), "agent_exit");
                        }
                        // Drop human gates so UI cannot Approve into a dead process.
                        if let Some(row) = Self::take_pending_gate_invalidation(s) {
                            crate::plan_chrome::mark_gate_stale(&s.app_session_id);
                            gate_invalidations.push(row);
                        }
                        // Connecting must leave too: a lost initialize waiter used
                        // to leave the pill on 连接中 until restart.
                        let has_err = s.fsm.last_error().is_some();
                        if process_exit_should_fail_fsm(st, has_err) {
                            let detail = match code {
                                Some(status) => format!("Agent process exited (code {status})"),
                                None => "Agent process exited (EOF/unknown status)".into(),
                            };
                            let _ = s.fsm.crash(detail);
                        }
                        s.acp = None;
                        s.open_tool_ids.clear();
                        s.terminal_tool_ids.clear();
                        s.open_tool_seen_at.clear();
                        s.deferred_prompt_complete = None;
                        s.streaming_message_id = None;
                        s.active_turn_id = None;
                        s.stream_message_id_locked = false;
                        s.prompt_in_flight = false;
                    }
                }
                // Also drop any parked entry with this process id (defensive).
                self.parked.lock().retain(|_, p| p.process_id != process_id);
                Self::emit_gates_invalidated(app, "agent_exit", gate_invalidations);
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::State {
                backend,
                agent_session_id,
                model_id,
            } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        s.backend = backend;
                        if let Some(id) = agent_session_id {
                            s.meta.agent_session_id = Some(id);
                        }
                        if model_id.is_some() {
                            s.model_id = model_id;
                        }
                    }
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::Stderr { line } => {
                // Always land agent stderr in the diagnostic log (post-mortem).
                tracing::warn!(target: "acp_stderr", "{line}");
                // CLI MCP worker fatals with AuthRequired when OAuth is missing/
                // expired — suppress re-inject of that host on the next session open.
                crate::extensions::note_mcp_auth_required_from_stderr(&line);
                let _ = app.emit("session://stderr", serde_json::json!({ "line": line }));
            }
            AcpEvent::HookActivity {
                kind,
                event_name,
                tool_name,
                ok,
                detail,
                raw,
            } => {
                let app_sid = {
                    let guard = self.inner.lock();
                    guard
                        .as_ref()
                        .map(|s| s.app_session_id.clone())
                        .unwrap_or_default()
                };
                let _ = app.emit(
                    "session://hook",
                    serde_json::json!({
                        "sessionId": app_sid,
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
                let app_sid = {
                    let guard = self.inner.lock();
                    guard
                        .as_ref()
                        .map(|s| s.app_session_id.clone())
                        .unwrap_or_default()
                };
                let _ = app.emit(
                    "session://goal",
                    serde_json::json!({
                        "sessionId": app_sid,
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
            AcpEvent::RetryState {
                attempt,
                max_retries,
                reason,
                status,
            } => {
                let cap = max_retries.clamp(1, HOST_PROVIDER_MAX_RETRIES);
                let abort = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        s.provider_retry_attempt = attempt;
                        // Reconnect / session/load residual retries (and shared-
                        // process noise while idle) must not fail the shell or
                        // append NETWORK_PROVIDER rows without a host-owned turn.
                        if !Self::should_apply_provider_retry_abort(s) {
                            tracing::debug!(
                                "acp retry_state ignored: no host turn (fsm={:?} pif={} attempt={attempt})",
                                s.fsm.state(),
                                s.prompt_in_flight
                            );
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
                        "attempt": attempt,
                        "maxRetries": cap,
                        "reason": reason,
                        "status": status,
                        "aborting": abort,
                    }),
                );

                if abort {
                    let (acp, agent_sid) = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            if s.provider_retry_aborted {
                                (None, None)
                            } else {
                                s.provider_retry_aborted = true;
                                // `attempt` is how many tries the host saw; `cap`
                                // is the agent/host budget — do not claim we ran
                                // the full budget when hard-transport fail-fast
                                // aborts early (e.g. attempt 3 of 12).
                                // Terminal quota uses QuotaExceeded + the CLI sentence.
                                let err = provider_retry_abort_error(attempt, cap, &reason);
                                // Chat-visible error row (must happen before clearing stream ids)
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
                        // Target the session explicitly (shared process safety).
                        let _ = match agent_sid {
                            Some(sid) => acp.cancel_for(&sid).await,
                            None => acp.cancel().await,
                        };
                    }
                    Self::emit_state(app, &self.snapshot());
                }
            }
            AcpEvent::ContextCompact {
                trigger,
                tokens_before,
                tokens_after,
                summary_preview,
                note,
            } => {
                let (app_sid, content) = {
                    let guard = self.inner.lock();
                    let Some(s) = guard.as_ref() else {
                        return;
                    };
                    // Compact markers during load/replay would spam the journal.
                    if Self::is_session_load_replay(s) {
                        tracing::debug!(
                            "acp context_compact dropped: no prompt in flight (replay)"
                        );
                        return;
                    }
                    let mut parts = Vec::new();
                    if trigger == "manual" {
                        parts.push("manual".to_string());
                    } else {
                        parts.push("auto".to_string());
                    }
                    if let (Some(b), Some(a)) = (tokens_before, tokens_after) {
                        parts.push(format!("tokens:{b}->{a}"));
                    } else if let Some(b) = tokens_before {
                        parts.push(format!("tokens_before:{b}"));
                    } else if let Some(a) = tokens_after {
                        parts.push(format!("tokens_after:{a}"));
                    }
                    if let Some(n) = note.as_ref().filter(|s| !s.is_empty()) {
                        parts.push(format!("note:{n}"));
                    }
                    // Machine-readable line for UI; human copy is i18n on frontend.
                    let mut content = format!("context_compact|{}", parts.join("|"));
                    if let Some(sum) = summary_preview
                        .as_ref()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                    {
                        content.push('\n');
                        content.push_str(sum);
                    }
                    (s.app_session_id.clone(), content)
                };
                let mid = Uuid::new_v4().to_string();
                if let Err(e) = store::append_message(
                    &app_sid,
                    ChatMessageStored {
                        id: mid.clone(),
                        role: "tool".into(),
                        content: content.clone(),
                        thought: None,
                        created_at: chrono::Utc::now(),
                        is_error: false,
                        attachments: None,
                        marker: Some("context_compact".into()),
                    },
                ) {
                    tracing::error!(session = %app_sid, "context compact journal append failed: {e}");
                }
                let _ = app.emit(
                    "session://context_compact",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "messageId": mid,
                        "trigger": trigger,
                        "tokensBefore": tokens_before,
                        "tokensAfter": tokens_after,
                        "summaryPreview": summary_preview,
                        "note": note,
                        "content": content,
                    }),
                );
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
                let app_sid = {
                    let guard = self.inner.lock();
                    let Some(s) = guard.as_ref() else {
                        return;
                    };
                    if Self::is_session_load_replay(s) {
                        return;
                    }
                    s.app_session_id.clone()
                };
                let _ = app.emit(
                    "session://usage",
                    serde_json::json!({
                        "sessionId": app_sid,
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
        }
    }
}

fn persist_completed_tool_journal(
    app_sid: String,
    tool_call_id: String,
    mid: String,
    content: String,
    is_error: bool,
) {
    let mut msgs = store::load_messages(&app_sid);
    if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
        if tool_journal_richer(&slot.content, &content) {
            slot.content = content;
            slot.marker = Some("tool_step".into());
            if let Err(e) = store::save_messages(&app_sid, &msgs) {
                tracing::error!(
                    session = %app_sid,
                    tool = %tool_call_id,
                    "tool journal update failed: {e}"
                );
            }
        }
        return;
    }
    if let Err(e) = store::append_message(
        &app_sid,
        ChatMessageStored {
            id: mid,
            role: "tool".into(),
            content,
            thought: None,
            created_at: chrono::Utc::now(),
            is_error,
            attachments: None,
            marker: Some("tool_step".into()),
        },
    ) {
        tracing::error!(
            session = %app_sid,
            tool = %tool_call_id,
            "tool journal append failed: {e}"
        );
    }
}
