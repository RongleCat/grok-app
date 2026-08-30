//! Rewind timeline and journal checkpoints.

use std::sync::Arc;

use tauri::AppHandle;

use crate::acp_client::AcpClient;
use crate::error::AgentErrorCode;
use crate::session_fsm::SessionState;
use crate::store::{self};

use super::*;

/// Budget for a single agent rewind RPC. `AcpClient::request` already allows
/// `HANDSHAKE_TIMEOUT_SECS` per method name and `rewind_execute_for` probes
/// several names, so an unbounded await can park a rewind command for minutes
/// with the rollback dialog spinning. The local journal is the UI source of
/// truth, so exceeding the budget degrades to "agent rewind failed" instead.
const REWIND_AGENT_RPC_BUDGET: std::time::Duration = std::time::Duration::from_secs(8);

impl SessionManager {
    /// True when a rewind must be refused because a turn is still running for
    /// `app_sid` — whether that chat holds the live slot or was demoted to
    /// background when the user switched away.
    ///
    /// Reading only `inner` reported idle for a demoted chat, so the journal was
    /// truncated underneath a turn that was still streaming and the agent's
    /// memory stopped matching the transcript. `live_session_is_busy` is also
    /// authoritative where the FSM is not: it honours `prompt_in_flight` after
    /// an early `prompt_complete`.
    pub(super) fn rewind_blocked_by_running_turn(&self, app_sid: &str) -> bool {
        self.with_session_mut(app_sid, |s| Self::live_session_is_busy(s))
            .unwrap_or(false)
    }

    pub async fn rewind_drop_last_user_turn(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let (backend, app_sid, acp, agent_sid, user_prompt_count) = {
            let guard = self.inner.lock();
            let s = guard.as_ref().ok_or("no active session")?;
            if let Some(target) = session_id.as_deref() {
                if s.app_session_id != target {
                    return Err(format!(
                        "{}: chat {target} is not focused — reconnect and retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
            }
            if s.fsm.state() == SessionState::Streaming
                || s.fsm.state() == SessionState::AwaitingPermission
            {
                return Err("cannot edit while a turn is running".into());
            }
            let msgs = store::load_messages(&s.app_session_id);
            let user_prompt_count = store::user_prompt_count(&msgs);
            if user_prompt_count == 0 {
                return Err("no user message to rewind".into());
            }
            (
                s.backend.clone(),
                s.app_session_id.clone(),
                s.acp.clone(),
                s.meta.agent_session_id.clone(),
                user_prompt_count,
            )
        };

        // Agent: discard last user turn. TUI semantics keep the selected turn and drop after;
        // so for "drop last user" we target the previous turn when count > 1.
        // When count == 1, execute target 0 with best-effort; host journal is the source of truth for UI.
        let mut agent_rewind_ok: Option<bool> = None;
        if backend != "mock_acp" && !AcpClient::use_mock() {
            if let Some(client) = acp {
                let target = user_prompt_count.saturating_sub(1);
                let exec_index =
                    store::drop_last_user_prompt_exec_index(user_prompt_count).unwrap_or(0);
                let sid = agent_sid.as_deref().ok_or("chat has no agent session id")?;
                let first = tokio::time::timeout(
                    REWIND_AGENT_RPC_BUDGET,
                    client.rewind_execute_for(sid, exec_index, false),
                )
                .await;
                match first {
                    Ok(Ok(_)) => {
                        agent_rewind_ok = Some(true);
                        tracing::info!(
                            target: "session",
                            "rewind_drop_last_user_turn: agent rewound target={exec_index} (user_turns={user_prompt_count})"
                        );
                    }
                    Err(_) => {
                        // Timed out: spending a second budget on the fallback
                        // index would double the stall the user already felt.
                        agent_rewind_ok = Some(false);
                        tracing::warn!(
                            target: "session",
                            "rewind_execute({exec_index}) timed out; leaving local journal intact"
                        );
                    }
                    Ok(Err(e)) => {
                        agent_rewind_ok = Some(false);
                        if crate::acp_client::rpc_looks_like_method_not_found(&e) {
                            tracing::warn!(
                                target: "session",
                                error = %e,
                                "rewind_execute({exec_index}) failed; leaving local journal intact"
                            );
                        } else {
                            // Fallback: try targeting the last turn itself (some builds discard at/after index).
                            tracing::warn!(
                                target: "session",
                                error = %e,
                                "rewind_execute({exec_index}) failed; trying last-turn index {target}"
                            );
                            match tokio::time::timeout(
                                REWIND_AGENT_RPC_BUDGET,
                                client.rewind_execute_for(sid, target, false),
                            )
                            .await
                            {
                                Ok(Ok(_)) => {
                                    agent_rewind_ok = Some(true);
                                }
                                Ok(Err(e2)) => {
                                    tracing::warn!(
                                        target: "session",
                                        error = %e2,
                                        "agent rewind failed; leaving local journal intact"
                                    );
                                }
                                Err(_) => {
                                    tracing::warn!(
                                        target: "session",
                                        "agent rewind timed out; leaving local journal intact"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        if !store::drop_last_should_truncate_journal(agent_rewind_ok) {
            return Err("agent rewind failed; local journal left intact".into());
        }

        // Local journal: keep messages strictly before the last *prompt* user message.
        let msgs = store::load_messages(&app_sid);
        let cut = store::cut_index_before_last_user_prompt(&msgs);
        let kept: Vec<_> = msgs.into_iter().take(cut).collect();
        store::replace_messages(&app_sid, &kept)?;

        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                s.meta.updated_at = chrono::Utc::now();
                let _ = store::update_session_meta(&s.meta);
            }
        }
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
    }

    /// List rewind points for an app session journal (one per user prompt).
    /// Prefer the local journal so the UI timeline always matches what the user sees.
    pub fn list_rewind_points(
        &self,
        session_id: Option<String>,
    ) -> Result<Vec<RewindPointDto>, String> {
        let app_sid = match session_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                s.app_session_id.clone()
            }
        };
        // Ensure session exists in the index (or at least has a journal dir).
        let known = store::load_sessions_index().iter().any(|s| s.id == app_sid);
        if !known && store::load_messages(&app_sid).is_empty() {
            return Err(format!("session not found: {app_sid}"));
        }
        Ok(Self::rewind_points_from_journal(&app_sid))
    }

    pub(super) fn rewind_points_from_journal(app_sid: &str) -> Vec<RewindPointDto> {
        let msgs = store::load_messages(app_sid);
        let mut out = Vec::new();
        let mut idx = 0u32;
        for m in msgs {
            if !store::is_user_prompt_message(&m) {
                continue;
            }
            let raw = m.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let preview = if raw.chars().count() > 80 {
                let truncated: String = raw.chars().take(79).collect();
                format!("{truncated}…")
            } else if raw.is_empty() {
                "…".into()
            } else {
                raw
            };
            out.push(RewindPointDto {
                prompt_index: idx,
                message_id: Some(m.id),
                preview,
            });
            idx = idx.saturating_add(1);
        }
        out
    }

    /// Rewind a session to a user-prompt index (keep that turn, drop after).
    /// Truncates the local journal to the selected prompt. Agent rewind is
    /// best-effort when this session is the live ACP session (`agent_ok`).
    pub async fn rewind_to_prompt_index(
        self: &Arc<Self>,
        app: AppHandle,
        target_prompt_index: u32,
        restore_files: bool,
        session_id: Option<String>,
    ) -> Result<RewindExecuteResult, String> {
        let app_sid = match session_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                s.app_session_id.clone()
            }
        };

        if self.rewind_blocked_by_running_turn(&app_sid) {
            return Err("cannot rewind while a turn is running".into());
        }

        let (live_match, backend, acp, agent_sid) = {
            let guard = self.inner.lock();
            match guard.as_ref() {
                Some(s) if s.app_session_id == app_sid => (
                    true,
                    s.backend.clone(),
                    s.acp.clone(),
                    s.meta.agent_session_id.clone(),
                ),
                _ => (false, String::new(), None, None),
            }
        };

        let msgs = store::load_messages(&app_sid);
        let user_count = store::user_prompt_count(&msgs);
        if user_count == 0 {
            return Err("no user messages to rewind".into());
        }
        if target_prompt_index >= user_count {
            return Err(format!(
                "user prompt index out of range: {target_prompt_index} (have {user_count})"
            ));
        }

        let mut agent_ok = true;
        let mut agent_error: Option<String> = None;

        // Agent path only when this is the live session with a real ACP client.
        // Never abort the whole command on agent rewind failure — local
        // journal truncate is the UI source of truth (Feature Parity).
        if live_match && backend != "mock_acp" && !AcpClient::use_mock() {
            if let (Some(client), Some(sid)) = (acp, agent_sid) {
                match tokio::time::timeout(
                    REWIND_AGENT_RPC_BUDGET,
                    client.rewind_execute_for(&sid, target_prompt_index, restore_files),
                )
                .await
                {
                    Ok(Ok(_)) => {
                        tracing::info!(
                            target: "session",
                            "rewind_to_prompt_index: agent rewound target={target_prompt_index}"
                        );
                    }
                    Ok(Err(e)) => {
                        agent_ok = false;
                        agent_error = Some(e.clone());
                        tracing::warn!(
                            target: "session",
                            error = %e,
                            "agent rewind failed; applying local journal truncate only"
                        );
                    }
                    Err(_) => {
                        agent_ok = false;
                        agent_error = Some("agent rewind timed out".into());
                        tracing::warn!(
                            target: "session",
                            "agent rewind timed out; applying local journal truncate only"
                        );
                    }
                }
            } else {
                agent_ok = false;
                agent_error = Some("agent not connected".into());
            }
        } else if !live_match {
            agent_ok = false;
            agent_error = Some("session not live; local journal only".into());
        }

        let kept = store::truncate_through_user_prompt(&msgs, target_prompt_index)?;
        let kept_count = kept.len();
        store::replace_messages(&app_sid, &kept)?;

        // Touch meta updated_at for index sort.
        let updated_at = chrono::Utc::now();
        if let Ok(Some(meta)) = store::update_sessions_index(|list| {
            let Some(meta) = list.iter_mut().find(|s| s.id == app_sid) else {
                return Ok(None);
            };
            meta.updated_at = updated_at;
            Ok(Some(meta.clone()))
        }) {
            if live_match {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    if s.app_session_id == app_sid {
                        s.meta.updated_at = meta.updated_at;
                    }
                }
            }
        }

        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(RewindExecuteResult {
            snapshot: snap,
            agent_ok,
            agent_error,
            local_ok: true,
            kept_count,
        })
    }
}
