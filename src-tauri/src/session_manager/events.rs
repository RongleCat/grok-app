//! Live ACP event pump handler.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{
    should_abort_provider_retry, AcpEvent, PermissionOutcome, StreamKind, HOST_PROVIDER_MAX_RETRIES,
};
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::is_paragraph_break;
use crate::permission::{
    extract_path_target, extract_shell_command, may_auto_allow, may_auto_deny, pick_option_id,
    scope_key,
};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};

use super::*;

impl SessionManager {
    pub(super) async fn handle_acp_event(
        self: &Arc<Self>,
        app: &AppHandle,
        process_id: &str,
        ev: AcpEvent,
    ) {
        // Route events to the focused live session **or** a background busy session
        // (multi-session parallel streaming). Idle parked agents should not emit.
        let is_live = self
            .inner
            .lock()
            .as_ref()
            .map(|s| s.process_id == process_id)
            .unwrap_or(false);
        let bg_sid = if !is_live {
            self.background
                .lock()
                .iter()
                .find(|(_, s)| s.process_id == process_id)
                .map(|(id, _)| id.clone())
        } else {
            None
        };

        if !is_live {
            if let Some(sid) = bg_sid {
                self.handle_acp_event_on_background(app, &sid, ev).await;
                return;
            }
            if let AcpEvent::ProcessExited { .. } = &ev {
                let mut parked = self.parked.lock();
                parked.retain(|_, p| p.process_id != process_id);
                let mut bg = self.background.lock();
                bg.retain(|_, s| s.process_id != process_id);
                return;
            }
            // Still talking but parked (should be impossible now that
            // `prompt_in_flight` blocks parking — keep the recovery anyway).
            if Self::event_carries_turn_output(&ev) {
                if let Some(sid) = self.rescue_parked_to_background(process_id) {
                    self.handle_acp_event_on_background(app, &sid, ev).await;
                    return;
                }
                // Never fail silently: a dropped chunk is a truncated answer.
                tracing::warn!(
                    "acp event dropped: no session owns process={process_id} ev={}",
                    Self::event_kind_name(&ev)
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
                let need_schedule = {
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
                        if Self::is_session_load_replay(s.prompt_in_flight) {
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
                    } else {
                        return;
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
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            s.acp.clone()
                        } else {
                            None
                        }
                    })
                };
                if let Some(acp) = replay_acp {
                    let option_id = pick_option_id(&options, "allow_once")
                        .or_else(|| pick_option_id(&options, "allow"))
                        .unwrap_or_else(|| "allow_once".into());
                    tracing::debug!(
                        "acp permission auto-resolved during load replay tool={tool_name}"
                    );
                    let _ = acp
                        .respond_permission(rpc_id, PermissionOutcome::Selected { option_id })
                        .await;
                    return;
                }

                let preview = raw.to_string();
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
                        // Grok Build shell prompts use underscore optionIds (allow_once /
                        // allow_command_always / reject). Hyphenated ACP-style fallbacks
                        // are rejected as "unknown permission option".
                        let option_id = pick_option_id(&options, "allow_once")
                            .or_else(|| pick_option_id(&options, "allow_always"))
                            .or_else(|| pick_option_id(&options, "allow_command_always"))
                            .or_else(|| pick_option_id(&options, "always_allow_all_sessions"))
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
                        let option_id = pick_option_id(&options, "reject_once")
                            .or_else(|| pick_option_id(&options, "reject_always"))
                            .or_else(|| pick_option_id(&options, "reject"))
                            .or_else(|| pick_option_id(&options, "deny"))
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
                        tool_call_id,
                        tool_name,
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options,
                    };
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
                        if Self::is_session_load_replay(s.prompt_in_flight) {
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
                let project_path = {
                    let guard = self.inner.lock();
                    guard.as_ref().and_then(|s| s.project_path.clone())
                };

                // Structured (force-grant) vs freeform (soft: allowlist/project only).
                // Soft avoids incidental tool reads of plugin logos under ~/.codex
                // becoming undeliverable paperclip thumbs.
                let structured_media = if status == "completed" {
                    extract_structured_media_path(&raw)
                } else {
                    None
                };
                let freeform_media = if status == "completed" && structured_media.is_none() {
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

                let prepared = structured_media
                    .as_deref()
                    .and_then(|p| prepare_media_attachment_path(p, project_path.as_deref(), true))
                    .or_else(|| {
                        freeform_media.as_deref().and_then(|p| {
                            prepare_media_attachment_path(p, project_path.as_deref(), false)
                        })
                    });

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
                } else if let Some(path) = path_out.as_ref().and_then(|p| {
                    // Write / copy of workspace media only (soft): persist so
                    // history reload can render bare basenames after session switch.
                    // Does not attach incidental reads outside path_scope/project.
                    prepare_media_attachment_path(p, project_path.as_deref(), false)
                }) {
                    let att = attachment_from_path(&path);
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if !s.stream_attachments.iter().any(|a| a.path == att.path) {
                            s.stream_attachments.push(att);
                        }
                    }
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
                        let empty =
                            Self::try_finish_deferred_prompt_complete(s, Some(app)).flatten();
                        (
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                            empty,
                            open_changed,
                            already_terminal,
                        )
                    } else {
                        (String::new(), None, None, false, false)
                    }
                };
                Self::emit_empty_run_if_any(app, empty_run);

                // Live tool activity for UI — recover identity when completed
                // updates omit title/kind (sparse status-only payloads).
                let (kind_enriched, title_enriched) =
                    enrich_tool_identity_from_raw(&raw, &title, &kind);
                let kind_j = normalize_tool_kind_for_journal(&kind_enriched, &title_enriched);
                let kind_j = if kind_j.is_empty() {
                    kind_enriched.clone()
                } else {
                    kind_j
                };
                let live_title = tool_journal_label(&title_enriched, &kind_j, &detail, &path_out);
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
                    let label = tool_journal_label(&title_enriched, &kind_j, &detail, &path_out);
                    let label = if label.is_empty() || label.eq_ignore_ascii_case("tool") {
                        live_title.clone()
                    } else {
                        label
                    };
                    let kind_store = if kind_j.is_empty() {
                        if kind_enriched.is_empty() {
                            "tool".into()
                        } else {
                            kind_enriched
                        }
                    } else {
                        kind_j
                    };
                    let mut content = format!("tool_step|{st}|{kind_store}|{label}");
                    if let Some(ref d) = detail {
                        content.push('\n');
                        content.push_str(&d.chars().take(400).collect::<String>());
                    }
                    if let Some(ref p) = path_out {
                        // Always persist path/url so reload can paint “Browsed …”.
                        content.push('\n');
                        content.push_str(p);
                    }
                    let mid = format!("tool-{tool_call_id}");
                    // Upsert: replace only when new content is richer (never downgrade
                    // a Fetch:https://… row to bare "tool" on a sparse completed tick).
                    let mut msgs = store::load_messages(&app_sid);
                    if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
                        if tool_journal_richer(&slot.content, &content) {
                            slot.content = content.clone();
                            slot.marker = Some("tool_step".into());
                            let _ = store::save_messages(&app_sid, &msgs);
                        }
                    } else {
                        let _ = store::append_message(
                            &app_sid,
                            ChatMessageStored {
                                id: mid,
                                role: "tool".into(),
                                content,
                                thought: None,
                                created_at: chrono::Utc::now(),
                                is_error: matches!(st, "failed" | "error"),
                                attachments: None,
                                marker: Some("tool_step".into()),
                            },
                        );
                    }
                }
            }
            AcpEvent::ToolOpenReleased { tool_call_id } => {
                let empty_run = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
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
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!("acp plan dropped: no prompt in flight (replay)");
                            return;
                        }
                        if let Some(id) = rpc_id {
                            s.pending_plan_rpc_id = Some(id);
                        }
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
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
                let app_sid = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!("acp ask_user dropped: no prompt in flight (replay)");
                            return;
                        }
                        s.pending_ask_user_rpc_id = Some(rpc_id);
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
                let _ = app.emit(
                    "session://ask_user",
                    serde_json::json!({
                        "rpcId": rpc_id,
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "questions": questions,
                    }),
                );
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
                            Self::release_failed_turn_markers(s);
                        }
                        let _ = s.fsm.fail_with(error);
                    }
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::ProcessExited { .. } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let st = s.fsm.state();
                        if matches!(
                            st,
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            // I04: flush partial assistant before cancel marker.
                            Self::maybe_flush_stream_journal(s, true, false);
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
                        }
                        // During Connecting, leave error to initialize/connect_failed
                        // (fail_all_pending already surfaces a richer stderr-backed message).
                        let has_err = s.fsm.last_error().is_some();
                        if !has_err
                            && matches!(
                                st,
                                SessionState::Ready
                                    | SessionState::Streaming
                                    | SessionState::AwaitingPermission
                            )
                        {
                            let _ = s.fsm.crash("Agent process exited");
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
                        if s.provider_retry_aborted {
                            false
                        } else {
                            should_abort_provider_retry(attempt, max_retries, &status)
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
                    let acp = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            if s.provider_retry_aborted {
                                None
                            } else {
                                s.provider_retry_aborted = true;
                                let msg = if reason.trim().is_empty() {
                                    format!(
                                        "Provider request failed after {cap} retries (attempt {attempt})"
                                    )
                                } else {
                                    format!(
                                        "Provider request failed after {cap} retries (attempt {attempt}): {reason}"
                                    )
                                };
                                let err = AgentError::new(AgentErrorCode::NetworkProvider, msg);
                                // Chat-visible error row (must happen before clearing stream ids)
                                Self::record_turn_error(s, app, &err);
                                let _ = s.fsm.fail_with(err);
                                s.acp.clone()
                            }
                        } else {
                            None
                        }
                    };
                    if let Some(acp) = acp {
                        let abort_msg = format!(
                            "provider retries exhausted (host cap {HOST_PROVIDER_MAX_RETRIES})"
                        );
                        acp.abort_pending_prompts(&abort_msg);
                        let _ = acp.cancel().await;
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
                    if Self::is_session_load_replay(s.prompt_in_flight) {
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
                let _ = store::append_message(
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
                );
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
                source,
            } => {
                let app_sid = {
                    let guard = self.inner.lock();
                    let Some(s) = guard.as_ref() else {
                        return;
                    };
                    if Self::is_session_load_replay(s.prompt_in_flight) {
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
                        "source": source,
                    }),
                );
            }
        }
    }
}
