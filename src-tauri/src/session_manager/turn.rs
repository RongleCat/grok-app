//! User turn: send, interject, stop.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{AcpClient, AskUserOutcome, PermissionOutcome};
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::is_paragraph_break;
use crate::mock_acp::{self, StreamChunk};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored, MessageAttachmentStored};

use super::*;

impl SessionManager {
    pub async fn send_message(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty message".into());
        }
        // Journal stores UI form when provided (skill chips); agent still receives `text`.
        // Do not wholesale-trim display: that drops leading/trailing blank lines the user
        // typed. Empty-check uses trim; payload keeps internal + intentional edge blanks.
        let mut journal_content = display_text
            .and_then(|s| {
                let s = s.replace("\r\n", "\n").replace('\r', "\n");
                if s.trim().is_empty() {
                    None
                } else {
                    Some(s)
                }
            })
            .unwrap_or_else(|| text.clone());
        // User file/image cards — structured field is primary for history cards.
        // Also dual-write `@/abs/path` sole-lines into content so reload can recover
        // cards even if an older reader ignores the attachments field (FE strips
        // those lines via parseAttachmentsFromContent for the bubble body).
        let journal_attachments = attachments.filter(|items| !items.is_empty());
        if let Some(ref atts) = journal_attachments {
            journal_content = append_journal_attachment_refs(journal_content, atts);
        }
        // Note: image @path stripping + Host vision runs on the *final*
        // agent_prompt after history bootstrap (see below). Do not rewrite
        // here only — bootstrap can reintroduce @image paths from the journal.

        // Serialize against connect for the whole focus + turn-open window, so
        // the slot cannot move between the target check and `begin_stream`.
        let _focus_guard = self.connect_lock.lock().await;
        if let Some(target) = session_id.as_deref() {
            match self.ensure_promptable_session(&app, target) {
                Ok(true) => {}
                Ok(false) => {
                    return Err(format!(
                        "{}: chat {target} has no live agent process — reconnect and retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
                Err(e) => return Err(format!("{}: {}", e.code.as_str(), e.message)),
            }
        }

        // Open the turn on the target wherever it sits (live **or** background).
        // Multi-window: a secondary send must not require stealing the live focus
        // from a main-window mid-turn when the target already has a warm agent.
        let target_sid = session_id
            .clone()
            .or_else(|| self.inner.lock().as_ref().map(|s| s.app_session_id.clone()));
        let Some(app_sid) = target_sid else {
            return Err("no active session".into());
        };

        // A delayed reconcile from the preceding turn performs a journal
        // read-modify-write. Keep this user append mutually exclusive with
        // each reconcile attempt so neither can overwrite the other's rows.
        let journal_lock = self.post_turn_journal_lock(&app_sid);
        let journal_guard = journal_lock.lock().await;
        let open = self.with_session_mut(&app_sid, |s| {
            if let Some(target) = session_id.as_deref() {
                if s.app_session_id != target {
                    return Err(format!(
                        "{}: chat {target} lost focus before send — retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
            }
            // One prompt per chat at a time. The FSM alone is not enough: an
            // early prompt_complete Readies it while the agent is still working,
            // and a second `session/prompt` would then be dispatched into a busy
            // agent (the CLI rejects it as `task_already_running`).
            if s.prompt_in_flight {
                return Err(format!(
                    "{}: chat {} is still running its previous turn",
                    AgentErrorCode::ConnectFailed.as_str(),
                    s.app_session_id
                ));
            }
            s.fsm.begin_stream().map_err(|e| e.to_string())?;
            s.prompt_in_flight = true;
            s.sent_prompt_this_visit = true;
            Self::touch_stream_progress_locked(s);
            let turn_id = Uuid::new_v4().to_string();
            s.active_turn_id = Some(turn_id.clone());
            s.stream_message_id_locked = false;
            let mid = Uuid::new_v4().to_string();
            s.streaming_message_id = Some(mid.clone());
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
            s.provider_retry_attempt = 0;
            s.provider_retry_aborted = false;
            s.tools_this_turn = 0;

            let mut agent_prompt = text.clone();
            if s.needs_history_bootstrap {
                if let Some(ctx) = build_history_bootstrap(&s.app_session_id) {
                    agent_prompt = format!("{ctx}\n{text}");
                    tracing::info!(
                        "history bootstrap attached ({} chars) for session {}",
                        ctx.len(),
                        s.app_session_id
                    );
                }
                s.needs_history_bootstrap = false;
            }
            // P2: steer session-by-UUID lookups to App/agent-home roots (avoid home-wide find).
            if let Some(hint) = session_lookup_host_hint(&text) {
                agent_prompt = format!("{hint}\n{agent_prompt}");
            }

            // persist user message (display form for skill chips on reload)
            // Journal stores the user-facing turn only — not the bootstrap wrapper.
            // Attachments are structured so history reloads image/file cards.
            let _ = store::append_message(
                &s.app_session_id,
                ChatMessageStored {
                    id: Uuid::new_v4().to_string(),
                    role: "user".into(),
                    content: journal_content.clone(),
                    thought: None,
                    created_at: chrono::Utc::now(),
                    is_error: false,
                    attachments: journal_attachments.clone(),
                    marker: None,
                },
            );
            Ok((
                s.backend.clone(),
                s.app_session_id.clone(),
                s.acp.clone(),
                s.meta.agent_session_id.clone(),
                agent_prompt,
                mid,
                turn_id,
            ))
        });
        drop(journal_guard);
        let (backend, app_sid, acp, agent_sid, agent_prompt, message_id, turn_id) = match open {
            Some(Ok(v)) => v,
            Some(Err(e)) => return Err(e),
            None => {
                return Err(format!(
                    "{}: chat {app_sid} has no live agent process — reconnect and retry",
                    AgentErrorCode::ConnectFailed.as_str()
                ));
            }
        };
        // Host side-channels before main model (vision first, then X). Emit tool
        // chips immediately so the UI shows waiting state instead of freezing.
        // Copy is non-technical (no `grok -p` / command lines in chip detail).
        let locale = store::load_settings().locale;
        let zh = locale.starts_with("zh");

        // Push streaming state before long host side-channels so the pill stays
        // "进行中" (not "就绪") while recognizing.
        self.emit_for_session(&app, &app_sid);

        // ── Host vision (custom text-only main + @image only) ──────────────
        // Official Grok route: never Host-describe (native multimodal).
        // X/web: tools-first via official-aux MCP — no Host keyword pre-search.
        let host_vision = crate::models_aux::host_vision_will_run(&agent_prompt);
        let host_tool_id = if host_vision {
            let id = format!("host-vision-{}", Uuid::new_v4());
            let (title, detail_run) = if zh {
                ("识别图片内容", "正在识别，请耐心等待…")
            } else {
                ("Recognizing image", "Working… please wait")
            };
            let _ = app.emit(
                "session://tool",
                serde_json::json!({
                    "sessionId": app_sid,
                    "toolCallId": id,
                    "title": title,
                    "kind": "vision",
                    "status": "in_progress",
                    "path": null,
                    "detail": detail_run,
                }),
            );
            self.with_session_mut(&app_sid, |s| {
                SessionManager::touch_stream_progress_locked(s);
            });
            Some((id, title.to_string()))
        } else {
            None
        };
        // Stream progress from official ACP into the *same* host-vision tool row
        // (native tool_step upsert by toolCallId — no second chip).
        let vision_progress: Option<crate::official_aux::OfficialProgressCb> =
            host_tool_id.as_ref().map(|(id, title)| {
                let app_p = app.clone();
                let sid_p = app_sid.clone();
                let tool_id = id.clone();
                let title_p = title.clone();
                let mgr = Arc::clone(self);
                std::sync::Arc::new(move |p: crate::official_aux::OfficialAcpProgress| {
                    let detail = if p.detail.trim().is_empty() {
                        if zh {
                            "正在识别…".to_string()
                        } else {
                            "Working…".to_string()
                        }
                    } else {
                        p.detail
                    };
                    // Always keep Host title; stream lives in detail only.
                    let _ = app_p.emit(
                        "session://tool",
                        serde_json::json!({
                            "sessionId": sid_p,
                            "toolCallId": tool_id,
                            "title": title_p,
                            "kind": "vision",
                            "status": "in_progress",
                            "path": null,
                            "detail": detail,
                        }),
                    );
                    mgr.with_session_mut(&sid_p, |s| {
                        SessionManager::touch_stream_progress_locked(s);
                    });
                }) as crate::official_aux::OfficialProgressCb
            });

        let prep = crate::models_aux::prepare_agent_prompt_for_main_detailed(
            &agent_prompt,
            vision_progress,
        )
        .await;
        let agent_prompt = prep.prompt;
        if let Some((id, title)) = host_tool_id {
            let status = if prep.ok { "completed" } else { "failed" };
            // Keep full description in detail for expand / journal (not "识别完成").
            let detail = if !prep.description.trim().is_empty() {
                prep.description.clone()
            } else if prep.ok {
                if zh {
                    "识别完成".to_string()
                } else {
                    "Done".to_string()
                }
            } else if zh {
                "识别失败".to_string()
            } else {
                "Failed".to_string()
            };
            let _ = app.emit(
                "session://tool",
                serde_json::json!({
                    "sessionId": app_sid,
                    "toolCallId": id,
                    "title": title,
                    "kind": "vision",
                    "status": status,
                    "path": null,
                    "detail": detail,
                }),
            );
            journal_host_tool_step(&app_sid, &id, status, "vision", &title, &detail);
            self.with_session_mut(&app_sid, |s| {
                SessionManager::touch_stream_progress_locked(s);
            });
        }
        // Emit runtime for background targets; state for live focus.
        self.emit_for_session(&app, &app_sid);

        // Host vision / prepare can take a long time. If the user hit Stop (or
        // stall/force-end cleared this turn) while we were away, do **not**
        // spawn session/prompt — otherwise the agent runs with streams dropped
        // as load-replay and the next send may see task_already_running.
        let still_this_turn = self
            .with_session_mut(&app_sid, |s| {
                s.prompt_in_flight
                    && s.active_turn_id.as_deref() == Some(turn_id.as_str())
                    && s.streaming_message_id.as_deref() == Some(message_id.as_str())
            })
            .unwrap_or(false);
        if !still_this_turn {
            tracing::info!(
                session = %app_sid,
                turn = %turn_id,
                message = %message_id,
                "send_message: turn no longer active after prepare; skip prompt_for"
            );
            self.emit_for_session(&app, &app_sid);
            // Must not return Ok — automations treat Ok as "fired" and
            // advance next_run_at / disable once tasks (P0-2). Frontend
            // maps TURN_CANCELLED to a silent cancel (user Stop / stall).
            return Err(format!(
                "TURN_CANCELLED: turn {turn_id} no longer active after prepare; prompt not dispatched"
            ));
        }

        if backend == "mock_acp" || AcpClient::use_mock() {
            let mgr = Arc::clone(self);
            let app_done = app.clone();
            let turn_sid = app_sid.clone();
            let handle = mock_acp::spawn_fake_stream(
                app_sid.clone(),
                message_id,
                agent_prompt,
                Duration::from_millis(25),
                move |chunk: StreamChunk| {
                    let _ = app_done.emit(
                        "session://stream",
                        serde_json::json!({
                            "sessionId": chunk.session_id,
                            "messageId": chunk.message_id,
                            "text": chunk.text,
                            "done": chunk.done,
                            "kind": "assistant"
                        }),
                    );
                    mgr.with_session_mut(&turn_sid, |s| {
                        SessionManager::touch_stream_progress_locked(s);
                        s.stream_buf.push_str(&chunk.text);
                        // I04: throttle mid-stream; force on terminal done.
                        let para = is_paragraph_break(&chunk.text);
                        SessionManager::maybe_flush_stream_journal(s, chunk.done, para);
                        if chunk.done {
                            s.stream_buf.clear();
                            s.journal_throttle.reset();
                            s.last_stall_emit = None;
                            // Mock backend has no `session/prompt` RPC — its
                            // terminal chunk is the authoritative completion.
                            s.prompt_in_flight = false;
                            if s.fsm.state() == SessionState::Streaming {
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
                                s.active_turn_id = None;
                                s.stream_message_id_locked = false;
                            }
                        }
                    });
                    if chunk.done {
                        mgr.emit_for_session(&app_done, &turn_sid);
                    }
                },
            );
            self.with_session_mut(&app_sid, |s| {
                s.mock_stream = Some(handle);
            });
            // Return the target's snapshot when possible (background path).
            if self.is_live_session(&app_sid) {
                return Ok(self.snapshot());
            }
            if let Some(snap) = self
                .background
                .lock()
                .get(&app_sid)
                .map(Self::snapshot_from_live)
            {
                return Ok(snap);
            }
            return Ok(self.snapshot());
        }

        // Bail *after* the turn was opened → roll it back, or the chat is stuck
        // forever: `prompt_in_flight` blocks both parking and the next send.
        let Some(acp) = acp else {
            self.with_session_mut(&app_sid, |s| {
                s.prompt_in_flight = false;
                s.streaming_message_id = None;
                s.active_turn_id = None;
                s.stream_message_id_locked = false;
                if s.fsm.state() == SessionState::Streaming {
                    let _ = s.fsm.end_stream();
                }
            });
            self.emit_for_session(&app, &app_sid);
            return Err("ACP client missing".into());
        };
        let mgr = Arc::clone(self);
        let app2 = app.clone();
        let turn_sid = app_sid.clone();
        tokio::spawn(async move {
            // Explicit session id: on a shared process the CLI's “recently
            // bound” id may belong to another App session — prompts must
            // target this chat's own agent session.
            let outcome = match agent_sid {
                Some(sid) => acp.prompt_for(&sid, &agent_prompt).await,
                None => Err(AgentError::new(
                    AgentErrorCode::AgentCrashed,
                    "chat has no agent session id (reconnect)",
                )),
            };
            match outcome {
                Err(e) => {
                    // Route by session id: this chat may have been demoted to
                    // background while the prompt ran, and the live slot now holds
                    // someone else's turn — recording the error there would blame
                    // the wrong chat.
                    let mut record_error = false;
                    mgr.with_session_mut(&turn_sid, |s| {
                        // The RPC failed, so no authoritative PromptComplete will
                        // arrive. Release the turn or the chat stays un-parkable
                        // and refuses further sends.
                        s.prompt_in_flight = false;
                        // Stall heal / user stop already force-ended (Ready) with
                        // journal kept — do not clobber with fail_with when
                        // cancel/abort unblocks this waiter.
                        if !matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            return;
                        }
                        // Skip if host already recorded a retry-exhausted error this turn.
                        if !s.provider_retry_aborted {
                            SessionManager::record_turn_error(s, &app2, &e);
                            let _ = s.fsm.fail_with(e);
                            record_error = true;
                        }
                    });
                    if record_error {
                        mgr.emit_for_session(&app2, &turn_sid);
                    }
                }
                Ok(()) => {
                    // #522: even if PromptComplete events were dropped/raced,
                    // a successful session/prompt must release the busy gate.
                    // Also heal sticky Streaming when `prompt_in_flight` was
                    // already cleared (dropped PromptComplete / partial finish)
                    // but FSM never left Streaming — UI shows "thinking" forever
                    // while the agent turn already ended (journal may hold body).
                    let mut need_emit = false;
                    mgr.with_session_mut(&turn_sid, |s| {
                        // Only heal sticky *Streaming* here — leave
                        // AwaitingPermission alone (user gate still live).
                        let sticky_streaming = s.fsm.state() == SessionState::Streaming;
                        if s.prompt_in_flight {
                            tracing::warn!(
                                target: "session",
                                session = %turn_sid,
                                "prompt RPC Ok but prompt_in_flight still true — force-clear (#522)"
                            );
                            s.prompt_in_flight = false;
                            if s.deferred_prompt_complete.is_none() {
                                s.deferred_prompt_complete = Some("end_turn".into());
                            }
                            need_emit = SessionManager::try_finish_deferred_prompt_complete(
                                s,
                                Some(&app2),
                            )
                            .is_some();
                        } else if sticky_streaming {
                            tracing::warn!(
                                target: "session",
                                session = %turn_sid,
                                "prompt RPC Ok but FSM still Streaming with prompt_in_flight=false — force-finish sticky stream"
                            );
                            if s.deferred_prompt_complete.is_none() {
                                s.deferred_prompt_complete = Some("end_turn".into());
                            }
                            need_emit = SessionManager::try_finish_deferred_prompt_complete(
                                s,
                                Some(&app2),
                            )
                            .is_some();
                            // If gates still block finish, at least drop busy so
                            // reconnect/send are not wedged forever.
                            if !need_emit
                                && s.open_tool_ids.is_empty()
                                && s.pending_plan_rpc_id.is_none()
                                && s.pending_ask_user_rpc_id.is_none()
                            {
                                // Best-effort flush so partial stream_buf is not lost
                                // when we force-end without try_finish.
                                SessionManager::flush_pending_stream_emit_done(
                                    s,
                                    Some(&app2),
                                );
                                SessionManager::maybe_flush_stream_journal(s, true, false);
                                s.stream_buf.clear();
                                s.stream_thought.clear();
                                s.stream_last_was_assistant = false;
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
                                s.active_turn_id = None;
                                s.stream_message_id_locked = false;
                                s.deferred_prompt_complete = None;
                                need_emit = true;
                            }
                        }
                    });
                    if need_emit {
                        mgr.emit_for_session(&app2, &turn_sid);
                    }
                    // Always best-effort pull missing assistant/tool rows from
                    // agent chat_history after the prompt RPC completes. The
                    // CLI's final disk flush can trail the RPC response, so use
                    // a short bounded retry window off the async worker thread.
                    let changed =
                        post_turn_reconcile::reconcile_linked_session(&mgr, &turn_sid, &turn_id)
                            .await;
                    if changed > 0 {
                        let _ = app2.emit(
                            "session://journal_reconciled",
                            serde_json::json!({
                                "sessionId": turn_sid,
                                "changed": changed,
                            }),
                        );
                    }
                }
            }
        });

        if self.is_live_session(&app_sid) {
            return Ok(self.snapshot());
        }
        if let Some(snap) = self
            .background
            .lock()
            .get(&app_sid)
            .map(Self::snapshot_from_live)
        {
            return Ok(snap);
        }
        Ok(self.snapshot())
    }

    /// Stop the turn on `session_id` (defaults to the live focus slot).
    ///
    /// Targets background turns too: the user can watch a demoted chat and hit
    /// Stop there, which previously cancelled whichever chat held focus.
    ///
    /// Inject guidance into the currently streaming turn without cancelling it.
    ///
    /// `session_id` names the chat (live or background). Omitting it uses the
    /// focused live slot. Does **not** rewrite the follow-up send queue.
    pub async fn interject_message<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty interjection".into());
        }
        // Same display blank-line policy as send_message (no wholesale trim).
        let mut journal_content = display_text
            .and_then(|s| {
                let s = s.replace("\r\n", "\n").replace('\r', "\n");
                if s.trim().is_empty() {
                    None
                } else {
                    Some(s)
                }
            })
            .unwrap_or_else(|| text.clone());
        let attachments = attachments.filter(|items| !items.is_empty());
        if let Some(ref atts) = attachments {
            journal_content = append_journal_attachment_refs(journal_content, atts);
        }
        let target = session_id.as_deref();

        // Take any pending ask-user / plan reverse-RPC so steer is not blocked
        // behind an unanswered questionnaire (diag: interject OK + ask_user hang).
        let (backend, app_sid, turn_id, agent_sid, acp, pending_ask, pending_plan) = {
            if let Some(t) = target {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut().filter(|s| s.app_session_id == t) {
                    let picked = Self::pick_interjection_target(s)?;
                    let pending_ask = s.pending_ask_user_rpc_id.take();
                    let pending_plan = s.pending_plan_rpc_id.take();
                    (
                        picked.0,
                        picked.1,
                        picked.2,
                        picked.3,
                        picked.4,
                        pending_ask,
                        pending_plan,
                    )
                } else {
                    drop(guard);
                    let mut background = self.background.lock();
                    let s = background
                        .get_mut(t)
                        .ok_or_else(|| format!("interjection: chat {t} is not active"))?;
                    let picked = Self::pick_interjection_target(s)?;
                    let pending_ask = s.pending_ask_user_rpc_id.take();
                    let pending_plan = s.pending_plan_rpc_id.take();
                    (
                        picked.0,
                        picked.1,
                        picked.2,
                        picked.3,
                        picked.4,
                        pending_ask,
                        pending_plan,
                    )
                }
            } else {
                let mut guard = self.inner.lock();
                let s = guard.as_mut().ok_or("no active session")?;
                let picked = Self::pick_interjection_target(s)?;
                let pending_ask = s.pending_ask_user_rpc_id.take();
                let pending_plan = s.pending_plan_rpc_id.take();
                (
                    picked.0,
                    picked.1,
                    picked.2,
                    picked.3,
                    picked.4,
                    pending_ask,
                    pending_plan,
                )
            }
        };

        if backend != "mock_acp" && !AcpClient::use_mock() {
            let client = acp.ok_or("ACP client missing")?;
            // Unblock reverse-RPCs first — otherwise interject is accepted but
            // the agent stays wedged on ask_user_question / exit_plan_mode.
            if let Some(id) = pending_ask {
                if let Err(e) = client
                    .respond_ask_user_question(id, AskUserOutcome::Cancelled)
                    .await
                {
                    tracing::warn!("interject: auto-cancel ask_user id={id} failed: {e}");
                }
                let _ = app.emit(
                    "session://ask_user_cleared",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "reason": "interject",
                    }),
                );
            }
            if let Some(id) = pending_plan {
                if let Err(e) = client.respond_exit_plan_mode(id, "cancelled", None).await {
                    tracing::warn!("interject: auto-cancel plan id={id} failed: {e}");
                }
            }
            match agent_sid {
                Some(sid) => {
                    tracing::info!(
                        "interject: app_session={app_sid} agent_session={sid} turn={turn_id}"
                    );
                    client.interject_for(&sid, &text).await.map_err(|e| {
                        tracing::warn!("interject: ACP failed app={app_sid} agent={sid}: {e}");
                        e
                    })?;
                }
                None => {
                    return Err("interjection: chat has no agent session id (reconnect)".into());
                }
            }
        }

        let created_at = chrono::Utc::now();
        let message = ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role: "user".into(),
            content: journal_content,
            thought: None,
            created_at,
            is_error: false,
            attachments,
            marker: Some("interjection".into()),
        };

        // Session may move between live/background while the ACP RPC is in flight.
        // ACP already accepted the inject — always try to surface UI + journal.
        //
        // IMPORTANT: while holding `inner` / `background`, return
        // `snapshot_from_live` — never `self.snapshot()`, which re-locks `inner`
        // (parking_lot is non-reentrant → permanent deadlock → FE stuck on
        // 「正在引导…」 until the 55s UI timeout).
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_sid {
                    Self::commit_interjection_boundary(s, &app, &message, &app_sid, &turn_id)?;
                    return Ok(Self::snapshot_from_live(s));
                }
            }
        }
        {
            let mut background = self.background.lock();
            if let Some(s) = background.get_mut(&app_sid) {
                Self::commit_interjection_boundary(s, &app, &message, &app_sid, &turn_id)?;
                return Ok(Self::snapshot_from_live(s));
            }
        }

        // Live/background slot gone after ACP ok: still journal so history is honest
        // and FE can drop the queue item (agent already received the steer).
        tracing::warn!("interject: chat {app_sid} left live/background after ACP ok; journal-only");
        if let Err(e) = store::append_message(&app_sid, message.clone()) {
            tracing::error!("interjection journal-only append failed: {e}");
        }
        let _ = app.emit(
            "session://interjection",
            serde_json::json!({
                "sessionId": app_sid,
                "message": message,
            }),
        );
        Ok(self.snapshot())
    }

    pub async fn stop(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = match session_id {
            Some(sid) => sid,
            None => self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone())
                .ok_or("no active session")?,
        };
        let app_for_marker = app.clone();
        // Also release ask_user / plan reverse-RPCs. Leaving them set kept
        // `live_session_is_busy` true after stop, so Send/park paths stayed
        // wedged until process kill (user diag 5bda6b52).
        let (acp, agent_sid, pending_ask, pending_plan, pending_perm) = self
            .with_session_mut(&target, move |s| {
                let app = app_for_marker;
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                let pending_ask = s.pending_ask_user_rpc_id.take();
                let pending_plan = s.pending_plan_rpc_id.take();
                let pending_perm = s.pending_permission_rpc_id.take();
                s.pending_permission_options = None;
                s.pending_permission_tool_name = None;
                let was_busy = s.fsm.state() == SessionState::Streaming
                    || s.fsm.state() == SessionState::AwaitingPermission
                    || s.streaming_message_id.is_some()
                    || !s.open_tool_ids.is_empty()
                    || s.prompt_in_flight
                    || pending_ask.is_some()
                    || pending_plan.is_some()
                    || pending_perm.is_some();
                // Journal a cancel marker so UI history is not left as user-only silence.
                if was_busy {
                    // Shared helper: durable chip + live emit (history matches live).
                    Self::journal_turn_cancelled(s, Some(&app), "user_stop");
                    if s.fsm.state() == SessionState::Streaming
                        || s.fsm.state() == SessionState::AwaitingPermission
                    {
                        let _ = s.fsm.end_stream();
                    }
                }
                s.streaming_message_id = None;
                s.active_turn_id = None;
                s.stream_message_id_locked = false;
                s.stream_buf.clear();
                s.stream_thought.clear();
                s.stream_last_was_assistant = false;
                s.stream_attachments.clear();
                s.open_tool_ids.clear();
                s.terminal_tool_ids.clear();
                s.open_tool_seen_at.clear();
                s.deferred_prompt_complete = None;
                // Cancelled: the prompt RPC resolves as cancelled, so release the
                // turn here too — otherwise the chat can never be parked again.
                s.prompt_in_flight = false;
                s.journal_throttle.reset();
                s.last_stall_emit = None;
                (
                    s.acp.clone(),
                    s.meta.agent_session_id.clone(),
                    pending_ask,
                    pending_plan,
                    pending_perm,
                )
            })
            .ok_or("no active session")?;
        let had_pending_ask = pending_ask.is_some();
        if had_pending_ask {
            let _ = app.emit(
                "session://ask_user_cleared",
                serde_json::json!({
                    "sessionId": target,
                    "reason": "user_stop",
                }),
            );
        }
        // Publish Ready *before* agent cancel. `session/cancel` goes through
        // stdin write (up to STDIN_WRITE_TIMEOUT) — if the agent is wedged or
        // the turn already ended with sticky Streaming, awaiting cancel first
        // left the UI/Host consumers blocked on Stop for the whole timeout
        // (user report: Stop does nothing while thinking is stuck).
        self.promote_background_ready_to_parked(&target);
        self.emit_for_session(&app, &target);
        // Prefer the stopped chat's snapshot (not the live focus slot).
        let stopped_snap = if self.is_live_session(&target) {
            self.snapshot()
        } else if let Some(snap) = self
            .background
            .lock()
            .get(&target)
            .map(Self::snapshot_from_live)
        {
            snap
        } else {
            // Parked after promote, or already idle — return live focus snap.
            self.snapshot()
        };

        // Best-effort agent cancel after UI is already unblocked.
        if let Some(acp) = acp {
            // Reply to reverse-RPCs before session/cancel so the agent does not
            // sit forever on an unanswered ask_user_question after Host "stop".
            if let Some(id) = pending_ask {
                if let Err(e) = acp
                    .respond_ask_user_question(id, AskUserOutcome::Cancelled)
                    .await
                {
                    tracing::warn!("stop: cancel ask_user id={id} failed: {e}");
                }
            }
            if let Some(id) = pending_plan {
                if let Err(e) = acp.respond_exit_plan_mode(id, "cancelled", None).await {
                    tracing::warn!("stop: cancel plan id={id} failed: {e}");
                }
            }
            if let Some(id) = pending_perm {
                if let Err(e) = acp
                    .respond_permission(id, PermissionOutcome::Cancelled)
                    .await
                {
                    tracing::warn!("stop: cancel permission id={id} failed: {e}");
                }
                let _ = app.emit(
                    "session://permissions_invalidated",
                    serde_json::json!({
                        "reason": "user_stop",
                        "gates": [{
                            "sessionId": target,
                            "rpcId": id,
                        }],
                    }),
                );
            }
            // Target the session explicitly (shared process safety).
            if let Err(e) = match agent_sid {
                Some(ref sid) => acp.cancel_for(sid).await,
                None => acp.cancel().await,
            } {
                tracing::warn!(
                    target: "session",
                    session = %target,
                    "stop: session/cancel after Ready emit failed (UI already settled): {e}"
                );
            }
        }
        self.flush_pending_soft_respawn(&app, &target).await;
        Ok(stopped_snap)
    }
}
