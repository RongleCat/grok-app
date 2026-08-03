//! Idle recycle + stream-stall watchdogs.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::session_fsm::SessionState;
use crate::stream_stall::{
    is_maybe_done_candidate, is_stream_stalled, should_emit_soft_stall, stall_tier_from_evidence,
};

use super::*;

impl SessionManager {
    pub fn start_idle_watchdog(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                mgr.tick_idle_recycle(&app).await;
            }
        });
    }

    /// Background stream stall detector (I06). Safe to call once from app setup.
    /// Also drives long-tool heartbeats on the same 5s tick.
    pub fn start_stream_stall_watchdog(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                mgr.tick_tool_heartbeats(&app);
                mgr.tick_stream_stall(&app);
            }
        });
    }

    pub(super) fn tick_stream_stall(&self, app: &AppHandle) {
        let stall_secs = Self::stream_stall_seconds_from_settings();
        let now = Instant::now();

        // Heal live focus slot.
        let live_action = {
            let mut guard = self.inner.lock();
            guard
                .as_mut()
                .and_then(|s| Self::tick_stream_stall_on_session(s, Some(app), stall_secs, now))
        };
        self.apply_stall_tick_action(app, live_action);

        // Background busy turns: silent heal only. Soft banners still emit so
        // the user sees Keep waiting / End turn when they view that chat — we
        // never force-end a user task just because it is not focused.
        let bg_actions: Vec<StallTickAction> = {
            let mut bg = self.background.lock();
            bg.values_mut()
                .filter_map(|s| Self::tick_stream_stall_on_session(s, Some(app), stall_secs, now))
                .collect()
        };
        for a in bg_actions {
            self.apply_stall_tick_action(app, Some(a));
        }
    }

    /// Per-session stall tick decision (mutates session when healing).
    pub(super) fn tick_stream_stall_on_session(
        s: &mut LiveSession,
        app: Option<&AppHandle>,
        stall_secs: u32,
        now: Instant,
    ) -> Option<StallTickAction> {
        // Only pure streaming silence — not permission / plan / ask-user waits.
        if s.fsm.state() != SessionState::Streaming {
            return None;
        }
        s.streaming_message_id.as_ref()?;
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return None;
        }
        // Deferred prompt_complete + orphan open tools: try silent heal without
        // waiting for stall silence. Tool heartbeat re-arms last_stream_progress
        // every 25s while open tools exist, so a leaked open id would otherwise
        // never reach the stall path and the UI stays "running" forever.
        // Normal mid-turn tools (journal not terminal, still young) are not pruned.
        if s.deferred_prompt_complete.is_some() && Self::heal_stuck_streaming_turn(s, app, now) {
            return Some(StallTickAction::Healed {
                session_id: s.app_session_id.clone(),
            });
        }
        // No silence yet — keep working.
        if !is_stream_stalled(s.last_stream_progress, stall_secs, now) {
            return None;
        }

        // 1) Silent heal (orphan tools + deferred complete + ready-eligible).
        if Self::heal_stuck_streaming_turn(s, app, now) {
            return Some(StallTickAction::Healed {
                session_id: s.app_session_id.clone(),
            });
        }

        // This-turn body only (do not use prior-turn journal — that false-triggers
        // maybe_done tier on a new turn that has not produced text yet).
        let saw_model_this_turn = s.saw_model_output || !s.stream_buf.trim().is_empty();
        if saw_model_this_turn {
            s.saw_model_output = true;
        }
        let saw_tools = s.tools_this_turn > 0 || !s.open_tool_ids.is_empty();
        // Soft-banner tier may look at prior journal so we never say pre-token
        // after a full earlier answer in the same chat.
        let saw_model_for_tier =
            saw_model_this_turn || Self::journal_has_assistant_body(&s.app_session_id);
        // Maybe-done = this turn has body + tools idle. Used for UI copy only —
        // never force-ends; user chooses Keep waiting / End turn.
        let terminal_candidate = is_maybe_done_candidate(
            saw_model_this_turn,
            s.open_tool_ids.len(),
            s.deferred_prompt_complete.is_some(),
        );

        // 2) Soft banner only — never auto-cancel a user-initiated turn.
        // Re-prompt every full soft window while silence continues. Silent heal
        // above already covered truly finished FSM (RPC done, no open tools).
        if !should_emit_soft_stall(
            s.last_stream_progress,
            s.last_stall_emit,
            stall_secs,
            s.stall_soft_emits,
            now,
        ) {
            return None;
        }
        s.last_stall_emit = Some(now);
        s.stall_soft_emits = s.stall_soft_emits.saturating_add(1);
        let tier = stall_tier_from_evidence(saw_model_for_tier, saw_tools, terminal_candidate);
        Some(StallTickAction::SoftStall {
            session_id: s.app_session_id.clone(),
            stall_seconds: stall_secs,
            tier,
            saw_model_output: saw_model_for_tier,
            saw_tool_activity: saw_tools,
        })
    }

    pub(super) fn apply_stall_tick_action(&self, app: &AppHandle, action: Option<StallTickAction>) {
        let Some(action) = action else {
            return;
        };
        match action {
            StallTickAction::Healed { session_id } => {
                tracing::info!(
                    target: "session",
                    session = %session_id,
                    "stream stall heal succeeded — turn Ready"
                );
                Self::emit_runtime(
                    app,
                    &SessionSnapshot {
                        session_id: Some(session_id),
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
                Self::emit_state(app, &self.snapshot());
            }
            StallTickAction::HardEnded {
                session_id,
                stall_seconds,
                reason,
            } => {
                tracing::warn!(
                    target: "session",
                    session = %session_id,
                    stall_seconds,
                    reason,
                    "stream stall — force-ended turn, journal kept (cancel hung prompt)"
                );
                // Unblock the agent: force_end only cleared Host FSM; without cancel
                // the CLI stays blocked on model inference and refuses the next send.
                let acp = self.with_session_mut(&session_id, |s| s.acp.clone());
                if let Some(acp) = acp.flatten() {
                    let msg = format!("stream stall recovery ({reason})");
                    acp.abort_pending_prompts(&msg);
                    tauri::async_runtime::spawn(async move {
                        let _ = acp.cancel().await;
                    });
                }
                Self::emit_runtime(
                    app,
                    &SessionSnapshot {
                        session_id: Some(session_id.clone()),
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
                let _ = app.emit(
                    "session://stream_stall_hard_end",
                    serde_json::json!({
                        "sessionId": session_id,
                        "stallSeconds": stall_seconds,
                        "code": "STREAM_STALL_HARD_END",
                        "reason": reason,
                    }),
                );
                Self::emit_state(app, &self.snapshot());
            }
            StallTickAction::SoftStall {
                session_id,
                stall_seconds,
                tier,
                saw_model_output,
                saw_tool_activity,
            } => {
                tracing::warn!(
                    target: "session",
                    session = %session_id,
                    stall_seconds,
                    tier = tier.as_str(),
                    "stream soft stall — emitting keep-waiting prompt"
                );
                Self::emit_stream_stall(
                    app,
                    &session_id,
                    stall_seconds,
                    tier,
                    saw_model_output,
                    saw_tool_activity,
                );
            }
        }
    }
}
