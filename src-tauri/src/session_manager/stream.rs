//! Stream emit coalesce, journal flush, tool open-set, interjection helpers.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{AcpClient, StreamKind};
use crate::session_fsm::SessionState;
use crate::store::{self, ChatMessageStored};
use crate::stream_emit::{
    should_flush_stream_emit, stream_emit_can_merge, DEFAULT_STREAM_EMIT_MAX_CHARS,
    DEFAULT_STREAM_EMIT_MS,
};
use crate::stream_stall::{
    journal_tool_is_terminal, normalize_stream_stall_seconds, should_prune_open_tool_id,
    stream_stall_message, StallTier,
};
use crate::tool_heartbeat::should_emit_tool_heartbeat;
use crate::turn_complete::{
    is_terminal_tool_status, note_tool_open_status, release_tool_from_open,
    should_defer_prompt_complete,
};

use super::*;

/// Snapshot used by pure multi-session event routing (no locks).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionRouteHint {
    pub app_session_id: String,
    pub process_id: String,
    pub agent_session_id: Option<String>,
    /// Only meaningful for live/background. Parked is always idle Ready.
    pub prompt_in_flight: bool,
}

/// Where an ACP event for `process_id` should be delivered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TurnEventRoute {
    /// Focused live shell (caller still gates load-replay via `prompt_in_flight`).
    Live,
    /// Background app session id (caller still gates load-replay).
    Background(String),
    /// Drop — never rewrite a journal (foreign load / parked co-tenant / orphan).
    Drop,
}

/// P0 multi-session routing.
///
/// **Invariant:** a parked co-tenant on a shared process must never receive
/// `session/load` replay (or unstamped process traffic) as a live turn. That
/// path forced `prompt_in_flight=true` via rescue and wrote another chat's
/// history into the parked journal (user report: c955c700 polluted by
/// 0044e74a load on the same process).
///
/// Parked means idle Ready (`prompt_in_flight` blocks parking). App journal
/// is the source of truth for resume — drop load/orphan tails.
pub(crate) fn resolve_turn_event_route(
    process_id: &str,
    agent_session_id: Option<&str>,
    live: Option<&SessionRouteHint>,
    backgrounds: &[SessionRouteHint],
    parked: &[SessionRouteHint],
) -> TurnEventRoute {
    if let Some(sid) = agent_session_id {
        if live.is_some_and(|l| {
            // A stamped event is authoritative: an unknown owner must not be
            // treated as a wildcard. During connect/open the live hint can
            // briefly lack an agent id; dropping that handshake-side event is
            // safer than allowing a late foreign session update to mutate the
            // current chat.
            l.process_id == process_id && l.agent_session_id.as_deref() == Some(sid)
        }) {
            return TurnEventRoute::Live;
        }
        if let Some(bg) = backgrounds
            .iter()
            .find(|b| b.process_id == process_id && b.agent_session_id.as_deref() == Some(sid))
        {
            return TurnEventRoute::Background(bg.app_session_id.clone());
        }
        // Matched a parked agent session: do **not** rescue-and-write.
        // Idle park + load/orphan must not mutate the App journal.
        if parked
            .iter()
            .any(|p| p.process_id == process_id && p.agent_session_id.as_deref() == Some(sid))
        {
            return TurnEventRoute::Drop;
        }
        return TurnEventRoute::Drop;
    }

    // Unstamped (process-scoped):
    // 1) Prefer a *unique mid-turn* background shell (real concurrent turn
    //    on a shared process must not lose chunks to a connecting peer).
    // 2) Else the live shell that owns this process (connect binds
    //    process_id before session/load; prompt_in_flight=false → drop).
    // 3) Never rescue parked co-tenants (idle Ready) for unstamped traffic.
    let busy_bg: Vec<&SessionRouteHint> = backgrounds
        .iter()
        .filter(|b| b.process_id == process_id && b.prompt_in_flight)
        .collect();
    match busy_bg.as_slice() {
        [one] => return TurnEventRoute::Background(one.app_session_id.clone()),
        [] => {}
        _ => return TurnEventRoute::Drop,
    }
    if live.is_some_and(|l| l.process_id == process_id) {
        return TurnEventRoute::Live;
    }
    TurnEventRoute::Drop
}

/// Disk payload for one stream journal flush, prepared under the session
/// lock (`prepare_stream_journal_flush`) and committed to disk outside it
/// (`commit_stream_journal_flush`).
pub(super) struct PendingStreamJournalFlush {
    pub(super) session_id: String,
    pub(super) message: ChatMessageStored,
    pub(super) meta: store::SessionMeta,
}

impl SessionManager {
    pub(super) fn touch_activity_locked(s: &mut LiveSession) {
        s.last_activity = Instant::now();
    }

    /// Stream chunk or tool activity — advances stall deadline (I06).
    ///
    /// `session/load` (and similar resume paths) replay history while no prompt
    /// RPC is in flight. UI history must come only from the App journal — any
    /// turn side-effect event (`tool_call`, stream, …) must be dropped.
    ///
    /// Gate on `prompt_in_flight` **or** a still-deferred `prompt_complete`
    /// (not the FSM): early `prompt_complete` Readies the FSM and may release
    /// the RPC after a short silence while a long tool is still running. If
    /// we only looked at `prompt_in_flight`, those later chunks were dropped
    /// as load-replay (P0-3).
    ///
    /// **Human gates are different:** `exit_plan_mode` / `ask_user_question` are
    /// live reverse-RPCs that Grok Build may re-issue after resume with **no**
    /// prompt in flight (`RestorePlanApproval`). Use
    /// [`Self::should_drop_plan_event`] / [`Self::should_drop_ask_user_event`]
    /// for those — never this helper alone.
    #[inline]
    pub(super) fn is_session_load_replay(s: &LiveSession) -> bool {
        Self::is_session_load_replay_flags(s.prompt_in_flight, s.deferred_prompt_complete.is_some())
    }

    #[inline]
    pub(super) fn is_session_load_replay_flags(
        prompt_in_flight: bool,
        deferred_prompt_complete: bool,
    ) -> bool {
        !prompt_in_flight && !deferred_prompt_complete
    }

    /// Whether to drop an `AcpEvent::Plan` (progress update and/or exit_plan_mode).
    ///
    /// Accept when:
    /// - `rpc_id` is set (live reverse-RPC, including resume re-park), or
    /// - a plan gate is already pending (progress while waiting for approve), or
    /// - a prompt is in flight (mid-turn plan drafting updates).
    ///
    /// Drop only historical plan *notifications* during idle load-replay with
    /// no open gate (no rpc, no pending, no prompt).
    #[inline]
    pub(super) fn should_drop_plan_event(
        prompt_in_flight: bool,
        pending_plan: bool,
        has_rpc_id: bool,
    ) -> bool {
        if has_rpc_id || pending_plan || prompt_in_flight {
            return false;
        }
        true
    }

    /// Whether to drop an `ask_user_question` reverse-RPC.
    ///
    /// These always carry a JSON-RPC id and block the agent; never treat as
    /// session/load transcript replay. (Permission uses auto-allow on replay
    /// instead; ask_user has no safe auto answer.)
    #[inline]
    pub(super) fn should_drop_ask_user_event(_prompt_in_flight: bool) -> bool {
        false
    }

    /// Soft signal when a non-ask turn ends with **no user-visible answer** and
    /// zero tool events (diagnostic aid for #52).
    ///
    /// Successful pure-text replies (assistant body present, no tools) must
    /// **not** toast — that was false-positive spam on every chatty turn (#128).
    /// Call **before** stream buffers are cleared.
    ///
    /// Also suppress when the journal already has an assistant body after the
    /// last user turn (Host buffers can disagree with agent output after
    /// replay gating / early finish races).
    pub(super) fn empty_run_signal_from_live(
        s: &LiveSession,
        stop_reason: &str,
    ) -> Option<(String, String, String)> {
        let had_body = !s.stream_buf.trim().is_empty() || s.saw_model_output;
        let tools = s.tools_this_turn;
        let mode = s.product_mode.clone().unwrap_or_else(|| "agent".into());
        let app_sid = s.app_session_id.clone();
        // Zero tools + no body: agent "finished" without a reply the user can read
        // (thought-only / blank). Body without tools is a normal Q&A turn.
        let empty = tools == 0
            && !had_body
            && mode != "ask"
            && !s.provider_retry_aborted
            && stop_reason != "cancelled"
            && stop_reason != "stop";
        if empty {
            if Self::journal_has_assistant_after_last_user(&app_sid) {
                tracing::debug!(
                    target: "session",
                    session = %app_sid,
                    "empty-run suppressed: journal already has assistant after last user"
                );
                return None;
            }
            Some((app_sid, stop_reason.to_string(), mode))
        } else {
            None
        }
    }

    /// True when the journal has a non-empty assistant after the most recent user row.
    pub(super) fn journal_has_assistant_after_last_user(app_session_id: &str) -> bool {
        let msgs = store::load_messages(app_session_id);
        let last_user = msgs
            .iter()
            .rposition(|m| m.role == "user" && !m.content.trim().is_empty());
        let Some(ui) = last_user else {
            return false;
        };
        msgs[ui + 1..]
            .iter()
            .any(|m| m.role == "assistant" && !m.is_error && !m.content.trim().is_empty())
    }

    /// Apply tool_call status to open/terminal sets (live + background paths).
    /// Returns true when open-set membership changed (insert or remove).
    pub(super) fn note_tool_status_on_session(
        s: &mut LiveSession,
        tool_call_id: &str,
        status: &str,
    ) -> bool {
        note_tool_open_status(
            &mut s.open_tool_ids,
            &mut s.terminal_tool_ids,
            &mut s.open_tool_seen_at,
            tool_call_id,
            status,
            Instant::now(),
        )
    }

    /// Soft-fail audit row for a tool_call start/end (never panics).
    pub(super) fn audit_tool_call(
        session_id: &str,
        project_path: Option<&str>,
        tool_name: &str,
        status: &str,
        summary: Option<&str>,
        open_changed: bool,
        already_terminal: bool,
    ) {
        if tool_name.is_empty() && summary.is_none() {
            // Still record with "unknown" when we have a real lifecycle edge.
        }
        let name = if tool_name.is_empty() {
            "tool"
        } else {
            tool_name
        };
        if is_terminal_tool_status(status) {
            if already_terminal {
                return;
            }
            let outcome = crate::audit_ledger::outcome_from_tool_status(status)
                .unwrap_or(crate::audit_ledger::OUTCOME_ERR);
            crate::audit_ledger::record_tool_end(
                Some(session_id),
                project_path,
                name,
                outcome,
                summary,
            );
        } else if open_changed {
            crate::audit_ledger::record_tool_start(Some(session_id), project_path, name, summary);
        }
    }

    /// Release open-tool accounting for background tasks (no journal write).
    pub(super) fn release_tool_open_on_session(s: &mut LiveSession, tool_call_id: &str) {
        release_tool_from_open(
            &mut s.open_tool_ids,
            &mut s.terminal_tool_ids,
            &mut s.open_tool_seen_at,
            tool_call_id,
        );
    }

    /// Deliver any coalesced `session://stream` IPC before ending the turn.
    ///
    /// Without this, journal can hold the full `stream_buf` while the UI is
    /// missing the last ~40ms batch still sitting in `pending_stream_emit` —
    /// answers looked truncated mid-sentence until the session was reopened.
    /// `app` is `None` only in pure unit tests (no IPC).
    pub(super) fn flush_pending_stream_emit_done(s: &mut LiveSession, app: Option<&AppHandle>) {
        if let Some(app) = app {
            if let Some(p) = s.pending_stream_emit.as_mut() {
                p.done = true;
            }
            Self::flush_pending_stream_emit(s, app);
        } else {
            s.pending_stream_emit = None;
        }
    }

    /// A second `prompt_complete` (notification + `session/prompt` RPC Ok)
    /// must not re-arm finish after the turn already left Streaming.
    ///
    /// Rearming `deferred_prompt_complete` ran the end-of-turn handler twice
    /// (#754): the second pass emitted IPC while still holding `inner`, overlapping
    /// post-turn journal reconcile's store lock. On Windows the WebView WndProc
    /// then waited on that lock inside `SendMessage` and the window froze.
    pub(super) fn should_rearm_deferred_prompt_complete(s: &LiveSession) -> bool {
        if s.prompt_in_flight {
            return true;
        }
        matches!(
            s.fsm.state(),
            SessionState::Streaming | SessionState::AwaitingPermission
        )
    }

    /// Finish turn when a deferred `prompt_complete` is safe (#52).
    /// Returns `Some(empty_run)` if finished (`None` inside = finished, not empty);
    /// returns `None` if still deferred.
    pub(super) fn try_finish_deferred_prompt_complete(
        s: &mut LiveSession,
        app: Option<&AppHandle>,
    ) -> Option<Option<(String, String, String)>> {
        let stop_reason = s.deferred_prompt_complete.clone()?;
        // The `session/prompt` RPC has not resolved → the agent may still emit
        // more text (it fires `prompt_complete` early). Ending the turn here is
        // what truncated answers mid-sentence and made the chat look stuck.
        // `schedule_prompt_complete_fallback` releases the waiter once the agent
        // has gone quiet (and `PROMPT_TIMEOUT_SECS` caps a wedged RPC), so this
        // cannot hang.
        if s.prompt_in_flight {
            return None;
        }
        // Duplicate prompt_complete after a successful finish: clear the
        // re-armed deferred flag and do not flush/emit/journal again.
        if s.active_turn_id.is_none() && s.fsm.state() == SessionState::Ready {
            s.deferred_prompt_complete = None;
            return None;
        }
        // Drop journal-terminal / aged open tools first so bg handoff leftovers
        // do not keep `should_defer_prompt_complete` true forever (#453).
        Self::prune_orphan_open_tools(s, Instant::now());
        let awaiting_perm = s.fsm.state() == SessionState::AwaitingPermission;
        let pending_plan = s.pending_plan_rpc_id.is_some();
        let pending_ask = s.pending_ask_user_rpc_id.is_some();
        if should_defer_prompt_complete(
            awaiting_perm,
            pending_plan,
            pending_ask,
            s.open_tool_ids.len(),
        ) {
            // Keep the turn open while tools or human gates remain. Orphans
            // older than TOOL_ORPHAN_SECONDS were already pruned above; a
            // still-open id is treated as a live (possibly silent) tool.
            // Force-clearing here dropped the rest of the answer as
            // load-replay (P0-3). #453 reconnect-stuck is recovered by
            // the orphan prune + stall watchdog, not by discarding chunks.
            return None;
        }
        let empty = Self::empty_run_signal_from_live(s, &stop_reason);
        s.deferred_prompt_complete = None;
        // UI first (pending IPC), then journal — both must see the full tail.
        Self::flush_pending_stream_emit_done(s, app);
        // Force-flush assistant turn (I04 end-of-turn path).
        Self::maybe_flush_stream_journal(s, true, false);
        // Hard cancel (permission_rejected / CLI cancelled mid-tools) must leave
        // a durable end-of-turn chip so live and history show the same reason —
        // not a silent "half-done" assistant row.
        if let Some(reason) = infer_hard_end_reason_from_stop(
            &stop_reason,
            &s.app_session_id,
            journal_suggests_permission_reject,
        ) {
            Self::journal_turn_cancelled(s, app, &reason);
        } else {
            crate::turn_lease::clear_lease(&s.app_session_id);
        }
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
        s.open_tool_ids.clear();
        s.terminal_tool_ids.clear();
        s.tools_this_turn = 0;
        if s.fsm.state() == SessionState::Streaming
            || s.fsm.state() == SessionState::AwaitingPermission
        {
            let _ = s.fsm.end_stream();
        }
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.last_stall_emit = None;
        tracing::info!("acp turn finished after deferred prompt_complete stop={stop_reason}");
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        s.open_tool_seen_at.clear();
        Some(empty)
    }

    /// Persist + emit a `turn_cancelled|<reason>` row so the transcript shows
    /// why the turn hard-stopped (user stop, CLI upgrade, permission, …).
    /// Skips when this turn already has an end-of-turn marker (no double chips).
    pub(super) fn journal_turn_cancelled(
        s: &mut LiveSession,
        app: Option<&AppHandle>,
        reason: &str,
    ) {
        if has_turn_end_marker_after_last_user(&s.app_session_id) {
            return;
        }
        Self::maybe_flush_stream_journal(s, true, false);
        let reason = normalize_hard_end_reason(reason);
        if reason == "host_exit" || reason == "agent_exit" {
            crate::turn_lease::mark_interrupted(&s.app_session_id);
        } else {
            crate::turn_lease::clear_lease(&s.app_session_id);
        }
        let mid = Uuid::new_v4().to_string();
        let content = format!("turn_cancelled|{reason}");
        // Neutral chips: user stop + generic mid-run cancel. Infra / permission
        // hard ends stay is_error so history can highlight them if needed.
        let is_error = !matches!(reason, "user_stop" | "cancelled");
        if let Err(e) = store::append_message(
            &s.app_session_id,
            ChatMessageStored {
                id: mid.clone(),
                role: "tool".into(),
                content: content.clone(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error,
                attachments: None,
                marker: Some("turn_cancelled".into()),
            },
        ) {
            tracing::error!(session = %s.app_session_id, "turn-cancelled journal append failed: {e}");
        }
        s.meta.updated_at = chrono::Utc::now();
        if let Err(e) = store::update_session_meta(&s.meta) {
            tracing::warn!(session = %s.app_session_id, "turn-cancelled metadata update failed: {e}");
        }
        if let Some(app) = app {
            let _ = app.emit(
                "session://turn_marker",
                serde_json::json!({
                    "sessionId": s.app_session_id,
                    "messageId": mid,
                    "marker": "turn_cancelled",
                    "reason": reason,
                    "content": content,
                }),
            );
        }
    }

    /// Journal hard-end chips for live + background sessions that are mid-turn
    /// before recycle/kill (CLI upgrade, auth switch, provider route, …).
    pub(super) fn journal_hard_end_for_busy_agents(&self, app: &AppHandle, reason: &str) {
        let cancel = normalize_hard_end_reason(reason);
        let mut ids: Vec<String> = Vec::new();
        {
            let guard = self.inner.lock();
            if let Some(s) = guard.as_ref() {
                let st = s.fsm.state();
                let busy = Self::live_session_is_busy(s)
                    || matches!(
                        st,
                        SessionState::Streaming | SessionState::AwaitingPermission
                    );
                if busy {
                    ids.push(s.app_session_id.clone());
                }
            }
        }
        {
            let bg = self.background.lock();
            for s in bg.values() {
                let st = s.fsm.state();
                let busy = Self::live_session_is_busy(s)
                    || matches!(
                        st,
                        SessionState::Streaming | SessionState::AwaitingPermission
                    );
                if busy {
                    ids.push(s.app_session_id.clone());
                }
            }
        }
        for id in ids {
            if has_turn_end_marker_after_last_user(&id) {
                continue;
            }
            let mid = Uuid::new_v4().to_string();
            let content = format!("turn_cancelled|{cancel}");
            let is_error = !matches!(cancel, "user_stop" | "cancelled");
            let _ = store::append_message(
                &id,
                ChatMessageStored {
                    id: mid.clone(),
                    role: "tool".into(),
                    content: content.clone(),
                    thought: None,
                    created_at: chrono::Utc::now(),
                    is_error,
                    attachments: None,
                    marker: Some("turn_cancelled".into()),
                },
            );
            let _ = app.emit(
                "session://turn_marker",
                serde_json::json!({
                    "sessionId": id,
                    "messageId": mid,
                    "marker": "turn_cancelled",
                    "reason": cancel,
                    "content": content,
                }),
            );
        }
    }

    /// Tool call ids that already have a terminal journal row (`tool-{id}`).
    pub(super) fn journal_terminal_tool_ids(app_session_id: &str) -> HashSet<String> {
        let mut out = HashSet::new();
        for m in store::load_messages(app_session_id) {
            if m.role != "tool" {
                continue;
            }
            let Some(call_id) = m.id.strip_prefix("tool-") else {
                continue;
            };
            if journal_tool_is_terminal(&m.content) {
                out.insert(call_id.to_string());
            }
        }
        out
    }

    /// True when the journal has a non-empty, non-error assistant body (any turn).
    /// Used only as a silent heal signal when Host is stuck Streaming after work finished.
    pub(super) fn journal_has_assistant_body(app_session_id: &str) -> bool {
        store::load_messages(app_session_id)
            .iter()
            .rev()
            .any(|m| m.role == "assistant" && !m.is_error && !m.content.trim().is_empty())
    }

    /// Drop leaked open tool ids (journal already terminal, or aged without updates).
    pub(super) fn prune_orphan_open_tools(s: &mut LiveSession, now: Instant) -> usize {
        if s.open_tool_ids.is_empty() {
            return 0;
        }
        let terminal = Self::journal_terminal_tool_ids(&s.app_session_id);
        let mut drop_ids: Vec<String> = Vec::new();
        for id in s.open_tool_ids.iter() {
            let last = s
                .open_tool_seen_at
                .get(id)
                .copied()
                .unwrap_or(s.last_stream_progress);
            let journal_done = terminal.contains(id);
            if should_prune_open_tool_id(last, now, journal_done) {
                drop_ids.push(id.clone());
            }
        }
        let n = drop_ids.len();
        for id in drop_ids {
            // Journal-terminal orphans must stay closed (bg stdout after completed).
            if terminal.contains(&id) {
                s.terminal_tool_ids.insert(id.clone());
            }
            s.open_tool_ids.remove(&id);
            s.open_tool_seen_at.remove(&id);
            tracing::info!(
                target: "session",
                session = %s.app_session_id,
                tool_id = %id,
                "pruned orphan open_tool_id (stall heal)"
            );
        }
        n
    }

    /// Force-end a Streaming turn while preserving journal (silent heal / hard stall).
    pub(super) fn force_end_streaming_turn(
        s: &mut LiveSession,
        app: Option<&AppHandle>,
        reason: &str,
    ) {
        // Deliver any buffered stream IPC first — dropping it left the journal
        // complete while the chat bubble stopped mid-sentence.
        Self::flush_pending_stream_emit_done(s, app);
        Self::maybe_flush_stream_journal(s, true, false);
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
        s.open_tool_ids.clear();
        s.open_tool_seen_at.clear();
        s.terminal_tool_ids.clear();
        s.deferred_prompt_complete = None;
        s.tools_this_turn = 0;
        s.prompt_in_flight = false;
        if s.fsm.state() == SessionState::Streaming
            || s.fsm.state() == SessionState::AwaitingPermission
        {
            let _ = s.fsm.end_stream();
        }
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.last_stall_emit = None;
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        tracing::info!(
            target: "session",
            session = %s.app_session_id,
            reason,
            "force-ended stuck streaming turn (journal preserved)"
        );
    }

    /// Silent heal before any stall UI. Returns true if the turn was ended.
    pub(super) fn heal_stuck_streaming_turn(
        s: &mut LiveSession,
        app: Option<&AppHandle>,
        now: Instant,
    ) -> bool {
        if s.fsm.state() != SessionState::Streaming {
            return false;
        }
        // Never auto-end while waiting on a human gate.
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return false;
        }

        Self::prune_orphan_open_tools(s, now);

        // Deferred prompt_complete may finish once tools are cleared.
        if Self::try_finish_deferred_prompt_complete(s, app).is_some() {
            return true;
        }

        // Pure stuck FSM: RPC done, no tools, no deferred finish left.
        if !s.prompt_in_flight && s.open_tool_ids.is_empty() && s.deferred_prompt_complete.is_none()
        {
            Self::force_end_streaming_turn(s, app, "ready_eligible_silent_heal");
            return true;
        }

        false
    }

    /// Emit empty-run toast event if the finish result says so.
    pub(super) fn emit_empty_run_if_any(app: &AppHandle, empty: Option<(String, String, String)>) {
        let Some((app_sid, reason, mode)) = empty else {
            return;
        };
        tracing::info!(
            target: "session",
            session = %app_sid,
            stop_reason = %reason,
            mode = %mode,
            "turn ended with no assistant body and zero tool calls (soft empty-run signal)"
        );
        let _ = app.emit(
            "session://turn_empty_run",
            serde_json::json!({
                "sessionId": app_sid,
                "stopReason": reason,
                "mode": mode,
                "toolCount": 0,
            }),
        );
    }

    pub(super) fn touch_stream_progress_locked(s: &mut LiveSession) {
        let now = Instant::now();
        s.last_activity = now;
        s.last_stream_progress = now;
        s.last_stall_emit = None;
    }

    pub(super) fn stream_stall_seconds_from_settings() -> u32 {
        normalize_stream_stall_seconds(store::load_settings().stream_stall_seconds)
    }

    pub(super) fn emit_stream_stall(
        app: &AppHandle,
        session_id: &str,
        stall_seconds: u32,
        tier: StallTier,
        saw_model_output: bool,
        saw_tool_activity: bool,
    ) {
        let _ = app.emit(
            "session://stream_stall",
            serde_json::json!({
                "sessionId": session_id,
                "stallSeconds": stall_seconds,
                "code": "STREAM_STALL",
                "message": stream_stall_message(stall_seconds),
                "tier": tier.as_str(),
                "sawModelOutput": saw_model_output,
                "sawToolActivity": saw_tool_activity,
            }),
        );
    }

    /// Persist accumulated assistant stream (I04). `force` bypasses the throttle.
    ///
    /// Inline prepare + commit: the disk write runs on the caller's thread,
    /// usually while it still holds a session-map lock. Turn-boundary (force)
    /// flushes keep this deliberately — the buffered text must be durable
    /// *before* cancel / interject markers append their own rows, or a
    /// reloaded transcript shows the marker above the answer. High-frequency
    /// mid-stream flushes must NOT use this: call
    /// `prepare_stream_journal_flush` under the lock and
    /// `commit_stream_journal_flush` after dropping it.
    pub(super) fn maybe_flush_stream_journal(
        s: &mut LiveSession,
        force: bool,
        paragraph_break: bool,
    ) {
        if let Some(pending) = Self::prepare_stream_journal_flush(s, force, paragraph_break) {
            Self::commit_stream_journal_flush(pending);
        }
    }

    /// Lock-side half of a stream journal flush: throttle decision + payload
    /// snapshot, no disk IO. Commit the returned payload with
    /// [`Self::commit_stream_journal_flush`] after releasing the session-map
    /// lock — `store::append_message` polls a cross-process file lock for up
    /// to ~3s in shared `GROK_HOME` mode, and holding `inner` / `background`
    /// across that stall blocked every session command (second-long UI
    /// freezes while thinking).
    ///
    /// The throttle is advanced optimistically here. A failed or delayed
    /// commit is self-healing: the stream buffers are cumulative and the row
    /// id stays stable, so the next flush rewrites the full content, and the
    /// `created_at` revision guard in `store::append_message` stops a late
    /// stale commit from rolling newer text back.
    pub(super) fn prepare_stream_journal_flush(
        s: &mut LiveSession,
        force: bool,
        paragraph_break: bool,
    ) -> Option<PendingStreamJournalFlush> {
        let has_content = !s.stream_buf.is_empty()
            || !s.stream_thought.is_empty()
            || !s.stream_attachments.is_empty();
        if !has_content {
            return None;
        }
        let now = Instant::now();
        if !s.journal_throttle.should_flush(now, force, paragraph_break) {
            return None;
        }
        let mid = s
            .streaming_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if s.streaming_message_id.is_none() {
            s.streaming_message_id = Some(mid.clone());
        }
        let atts = if s.stream_attachments.is_empty() {
            None
        } else {
            Some(s.stream_attachments.clone())
        };
        let message = ChatMessageStored {
            id: mid,
            role: "assistant".into(),
            content: s.stream_buf.clone(),
            thought: if s.stream_thought.is_empty() {
                None
            } else {
                Some(s.stream_thought.clone())
            },
            created_at: chrono::Utc::now(),
            is_error: false,
            attachments: atts,
            marker: None,
        };
        s.meta.updated_at = chrono::Utc::now();
        s.journal_throttle.mark_flushed(now);
        if force {
            s.journal_throttle.reset();
        }
        Some(PendingStreamJournalFlush {
            session_id: s.app_session_id.clone(),
            message,
            meta: s.meta.clone(),
        })
    }

    /// Disk half of a stream journal flush: journal upsert + session meta
    /// bump. Callers on hot paths must not hold `inner` / `background` /
    /// `parked` here (see `prepare_stream_journal_flush`).
    pub(super) fn commit_stream_journal_flush(pending: PendingStreamJournalFlush) {
        let PendingStreamJournalFlush {
            session_id,
            message,
            meta,
        } = pending;
        if let Err(e) = store::append_message(&session_id, message) {
            // Row id is stable and buffers are cumulative — the next flush
            // retries the durable write instead of advancing past a lost
            // assistant tail.
            tracing::error!(
                session = %session_id,
                "stream journal append failed: {e}"
            );
            return;
        }
        if let Err(e) = store::update_session_meta(&meta) {
            tracing::warn!(
                session = %session_id,
                "stream session metadata update failed after journal append: {e}"
            );
        }
    }

    pub(super) fn stream_kind_str(kind: StreamKind) -> &'static str {
        match kind {
            StreamKind::Assistant => "assistant",
            StreamKind::Thought => "thought",
        }
    }

    /// Emit one coalesced stream payload (or no-op).
    pub(super) fn flush_pending_stream_emit(s: &mut LiveSession, app: &AppHandle) {
        let Some(p) = s.pending_stream_emit.take() else {
            return;
        };
        if p.text.is_empty() && !p.done {
            return;
        }
        let _ = app.emit(
            "session://stream",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "messageId": p.message_id,
                "text": p.text,
                "done": p.done,
                "kind": Self::stream_kind_str(p.kind),
                "thoughtPhase": p.thought_phase,
            }),
        );
    }

    /// Buffer stream IPC; flush on force / char budget / merge break / timer.
    /// Returns whether a delayed flush task should be scheduled.
    pub(super) fn queue_stream_emit(
        s: &mut LiveSession,
        app: &AppHandle,
        kind: StreamKind,
        message_id: String,
        text: String,
        thought_phase: &str,
        done: bool,
    ) -> bool {
        let kind_s = Self::stream_kind_str(kind);
        let force = done
            || thought_phase.eq_ignore_ascii_case("new")
            || thought_phase.eq_ignore_ascii_case("open");

        if let Some(pending) = s.pending_stream_emit.as_ref() {
            let can = stream_emit_can_merge(
                Self::stream_kind_str(pending.kind),
                &pending.message_id,
                kind_s,
                &message_id,
                thought_phase,
            );
            if !can {
                Self::flush_pending_stream_emit(s, app);
            }
        }

        let now = Instant::now();
        if let Some(pending) = s.pending_stream_emit.as_mut() {
            pending.text.push_str(&text);
            pending.done = pending.done || done;
            // Keep first non-none thought phase for the batch (UI phase open).
            if pending.thought_phase == "none" || pending.thought_phase.is_empty() {
                pending.thought_phase = thought_phase.to_string();
            }
            let flush = should_flush_stream_emit(
                pending.first_at,
                pending.text.len(),
                now,
                force,
                DEFAULT_STREAM_EMIT_MAX_CHARS,
                Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
            );
            if flush {
                Self::flush_pending_stream_emit(s, app);
                return false;
            }
            return true; // still pending → ensure timer
        }

        // Fresh buffer
        if force || text.is_empty() {
            // Emit immediately (done tick / phase boundary / empty marker).
            let _ = app.emit(
                "session://stream",
                serde_json::json!({
                    "sessionId": s.app_session_id,
                    "messageId": message_id,
                    "text": text,
                    "done": done,
                    "kind": kind_s,
                    "thoughtPhase": thought_phase,
                }),
            );
            return false;
        }

        s.pending_stream_emit = Some(PendingStreamEmit {
            kind,
            message_id,
            text,
            thought_phase: thought_phase.to_string(),
            done,
            first_at: now,
        });
        true
    }

    pub(super) fn schedule_stream_emit_flush(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: String,
        gen: u64,
    ) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(DEFAULT_STREAM_EMIT_MS)).await;
            mgr.flush_stream_emit_if_gen(&app, &session_id, gen);
        });
    }

    pub(super) fn flush_stream_emit_if_gen(&self, app: &AppHandle, session_id: &str, gen: u64) {
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == session_id && s.stream_emit_flush_gen == gen {
                    if let Some(p) = s.pending_stream_emit.as_ref() {
                        if should_flush_stream_emit(
                            p.first_at,
                            p.text.len(),
                            Instant::now(),
                            false,
                            DEFAULT_STREAM_EMIT_MAX_CHARS,
                            Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
                        ) {
                            Self::flush_pending_stream_emit(s, app);
                        }
                    }
                    return;
                }
            }
        }
        let mut bg = self.background.lock();
        if let Some(s) = bg.get_mut(session_id) {
            if s.stream_emit_flush_gen == gen {
                if let Some(p) = s.pending_stream_emit.as_ref() {
                    if should_flush_stream_emit(
                        p.first_at,
                        p.text.len(),
                        Instant::now(),
                        false,
                        DEFAULT_STREAM_EMIT_MAX_CHARS,
                        Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
                    ) {
                        Self::flush_pending_stream_emit(s, app);
                    }
                }
            }
        }
    }

    /// Open-tool heartbeat: re-arm stall progress + emit explicit protocol event.
    pub(super) fn tick_tool_heartbeats(&self, app: &AppHandle) {
        let now = Instant::now();
        let mut emits: Vec<(String, Vec<String>, u64)> = Vec::new();

        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if let Some(e) = Self::maybe_tool_heartbeat_on_session(s, now) {
                    emits.push(e);
                }
            }
        }
        {
            let mut bg = self.background.lock();
            for s in bg.values_mut() {
                if let Some(e) = Self::maybe_tool_heartbeat_on_session(s, now) {
                    emits.push(e);
                }
            }
        }

        for (sid, tool_ids, open_count) in emits {
            let _ = app.emit(
                "session://tool_heartbeat",
                serde_json::json!({
                    "sessionId": sid,
                    "toolCallIds": tool_ids,
                    "openCount": open_count,
                    "intervalSecs": crate::tool_heartbeat::TOOL_HEARTBEAT_INTERVAL_SECS,
                }),
            );
        }
    }

    pub(super) fn maybe_tool_heartbeat_on_session(
        s: &mut LiveSession,
        now: Instant,
    ) -> Option<(String, Vec<String>, u64)> {
        if s.open_tool_ids.is_empty() {
            return None;
        }
        if !matches!(
            s.fsm.state(),
            SessionState::Streaming | SessionState::AwaitingPermission
        ) && !s.prompt_in_flight
        {
            return None;
        }
        let oldest = s.open_tool_seen_at.values().copied().min();
        if !should_emit_tool_heartbeat(
            s.open_tool_ids.len(),
            s.last_tool_heartbeat_emit,
            oldest,
            now,
        ) {
            return None;
        }
        // Re-arm stall progress — long tools without intermediate tool events
        // must not false-trigger soft/hard stream stall.
        Self::touch_stream_progress_locked(s);
        s.last_tool_heartbeat_emit = Some(now);
        let ids: Vec<String> = s.open_tool_ids.iter().cloned().collect();
        let n = ids.len() as u64;
        Some((s.app_session_id.clone(), ids, n))
    }

    /// Start a fresh assistant journal/UI row after a mid-turn interjection.
    pub(super) fn begin_post_interjection_stream(s: &mut LiveSession) {
        s.streaming_message_id = Some(Uuid::new_v4().to_string());
        s.stream_message_id_locked = true;
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
    }

    /// Select the active interjection target (backend, app session id, turn id,
    /// optional ACP client) from a live session, validating that a streaming
    /// turn is in progress.
    ///
    /// Pure (no `AppHandle`) so the rejection path is unit-testable without
    /// `tauri::test::mock_app()`, which crashes the Windows test binary
    /// (`STATUS_ENTRYPOINT_NOT_FOUND`, tauri #14580 / #13419).
    #[allow(clippy::type_complexity)]
    pub(super) fn pick_interjection_target(
        s: &LiveSession,
    ) -> Result<
        (
            String,
            String,
            String,
            Option<String>,
            Option<Arc<AcpClient>>,
        ),
        String,
    > {
        // Align with mid-turn busy, not only FSM Streaming: early prompt_complete
        // can leave prompt_in_flight / tools / stream id while FE still guides.
        // Connecting-only is excluded (no turn to merge into yet).
        let mid_turn = s.prompt_in_flight
            || matches!(
                s.fsm.state(),
                SessionState::Streaming | SessionState::AwaitingPermission
            )
            || s.streaming_message_id.is_some()
            || !s.open_tool_ids.is_empty();
        if !mid_turn {
            return Err("interjection requires a streaming turn".into());
        }
        let turn_id = s
            .active_turn_id
            .clone()
            .ok_or("interjection requires an active turn")?;
        Ok((
            s.backend.clone(),
            s.app_session_id.clone(),
            turn_id,
            s.meta.agent_session_id.clone(),
            s.acp.clone(),
        ))
    }

    pub(super) fn is_interjection_turn_active(
        s: &LiveSession,
        app_session_id: &str,
        turn_id: &str,
    ) -> bool {
        s.app_session_id == app_session_id
            && s.active_turn_id.as_deref() == Some(turn_id)
            && (s.prompt_in_flight
                || matches!(
                    s.fsm.state(),
                    SessionState::Streaming | SessionState::AwaitingPermission
                )
                || s.streaming_message_id.is_some()
                || !s.open_tool_ids.is_empty())
    }

    /// Persist an interjection at the current stream boundary while holding the
    /// session lock. Emitting before unlock guarantees UI order vs stream chunks.
    ///
    /// **ACP inject already landed** when this is called after `interject_for`.
    /// Never hard-fail the user solely because the turn boundary moved mid-RPC:
    /// journal + emit still run; stream split only when the turn is still active.
    pub(super) fn commit_interjection_boundary<R: tauri::Runtime>(
        s: &mut LiveSession,
        app: &AppHandle<R>,
        message: &ChatMessageStored,
        expected_app_session_id: &str,
        expected_turn_id: &str,
    ) -> Result<(), String> {
        if s.app_session_id != expected_app_session_id {
            return Err(format!(
                "interjection: session mismatch (have {}, want {expected_app_session_id})",
                s.app_session_id
            ));
        }
        let turn_active =
            Self::is_interjection_turn_active(s, expected_app_session_id, expected_turn_id);
        if !turn_active {
            tracing::warn!(
                "interjection: turn no longer active (app={expected_app_session_id} turn={expected_turn_id}); journal best-effort after ACP ok"
            );
        } else {
            Self::maybe_flush_stream_journal(s, true, false);
        }
        // ACP interject already landed — journal is best-effort.
        if let Err(e) = store::append_message(&s.app_session_id, message.clone()) {
            tracing::error!("interjection journal append failed: {e}");
        }
        s.meta.updated_at = message.created_at;
        if let Err(e) = store::update_session_meta(&s.meta) {
            tracing::warn!("interjection meta update failed: {e}");
        }
        if turn_active {
            Self::begin_post_interjection_stream(s);
        }
        // Include the post-steer stream id so the FE can seed a live thinking
        // row immediately (same id Host will use for subsequent chunks).
        let post_stream_message_id = s.streaming_message_id.clone();
        let _ = app.emit(
            "session://interjection",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "message": message,
                "postStreamMessageId": post_stream_message_id,
            }),
        );
        Ok(())
    }

    /// Adopt agent message id unless host locked the id after an interjection split.
    pub(super) fn ensure_stream_message_id(
        s: &mut LiveSession,
        kind: StreamKind,
        message_id: Option<String>,
    ) {
        if !s.stream_message_id_locked {
            if let Some(ref mid_in) = message_id {
                if s.streaming_message_id.as_ref() != Some(mid_in)
                    && (s.streaming_message_id.is_none() || matches!(kind, StreamKind::Assistant))
                {
                    s.streaming_message_id = Some(mid_in.clone());
                }
            }
        }
        if s.streaming_message_id.is_none() {
            s.streaming_message_id = Some(message_id.unwrap_or_else(|| Uuid::new_v4().to_string()));
        }
    }
}

/// Map host recycle / stop tokens to stable journal reason ids (FE i18n keys).
pub(crate) fn normalize_hard_end_reason(raw: &str) -> &str {
    let r = raw.trim();
    if r.is_empty() {
        return "cancelled";
    }
    match r {
        "user_stop" | "user" | "cancelled_by_user" | "user_cancel" => "user_stop",
        "agent_exit" | "agent" | "process_exit" => "agent_exit",
        "host_exit" => "host_exit",
        "permission_denied"
        | "permission_rejected"
        | "permission_deny"
        | "denied"
        | "reject"
        | "unknown_permission" => "permission_denied",
        "cli_upgrade" => "cli_upgrade",
        "app_update" => "app_update",
        "account_auth" => "account_auth",
        "provider_route" | "models_aux" => "provider_route",
        "session_data_mode" => "session_data_mode",
        "stall" | "stream_stall" | "idle_timeout" => "stall",
        "error" | "failed" | "turn_error" => "error",
        "cancelled" | "canceled" | "turn_cancelled" | "stop" => "cancelled",
        // Unknown recycle reasons still surface as a hard end, not silence.
        other if other.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => other,
        _ => "cancelled",
    }
}

/// When ACP ends with `cancelled` / `stop`, map to a durable chip reason.
/// Returns `None` for normal completions (`end_turn`, …).
pub(crate) fn infer_hard_end_reason_from_stop(
    stop_reason: &str,
    app_session_id: &str,
    permission_hint: impl FnOnce(&str) -> bool,
) -> Option<String> {
    let r = stop_reason.trim().to_ascii_lowercase();
    match r.as_str() {
        "cancelled" | "canceled" | "stop" => {
            if permission_hint(app_session_id) {
                Some("permission_denied".into())
            } else {
                Some("cancelled".into())
            }
        }
        _ => None,
    }
}

/// True when the journal already has an end-of-turn chip after the last user.
pub(crate) fn has_turn_end_marker_after_last_user(app_session_id: &str) -> bool {
    let msgs = store::load_messages(app_session_id);
    let start = msgs
        .iter()
        .rposition(|m| m.role == "user")
        .map(|i| i + 1)
        .unwrap_or(0);
    msgs[start..].iter().any(|m| {
        matches!(
            m.marker.as_deref(),
            Some("turn_cancelled") | Some("turn_end") | Some("end_of_turn")
        ) || m.content.starts_with("turn_cancelled")
            || m.content.starts_with("turn_end|")
    })
}

/// Detect permission-reject style tool failures in the current turn journal
/// (CLI: `unknown permission option` / `Failed to request permission`).
pub(crate) fn journal_content_suggests_permission_reject(content: &str) -> bool {
    let c = content.to_ascii_lowercase();
    c.contains("unknown permission option")
        || c.contains("failed to request permission")
        || c.contains("permission_rejected")
}

pub(crate) fn journal_suggests_permission_reject(app_session_id: &str) -> bool {
    let msgs = store::load_messages(app_session_id);
    let start = msgs
        .iter()
        .rposition(|m| m.role == "user")
        .map(|i| i + 1)
        .unwrap_or(0);
    msgs[start..]
        .iter()
        .any(|m| journal_content_suggests_permission_reject(&m.content))
}

#[cfg(test)]
mod hard_end_tests {
    use super::*;

    #[test]
    fn normalize_maps_recycle_and_permission() {
        assert_eq!(normalize_hard_end_reason("cli_upgrade"), "cli_upgrade");
        assert_eq!(normalize_hard_end_reason("models_aux"), "provider_route");
        assert_eq!(
            normalize_hard_end_reason("permission_rejected"),
            "permission_denied"
        );
        assert_eq!(normalize_hard_end_reason("user_stop"), "user_stop");
        assert_eq!(normalize_hard_end_reason("host_exit"), "host_exit");
        assert_eq!(normalize_hard_end_reason(""), "cancelled");
    }

    #[test]
    fn infer_cancelled_uses_permission_hint() {
        assert_eq!(
            infer_hard_end_reason_from_stop("cancelled", "s", |_| true).as_deref(),
            Some("permission_denied")
        );
        assert_eq!(
            infer_hard_end_reason_from_stop("cancelled", "s", |_| false).as_deref(),
            Some("cancelled")
        );
        assert_eq!(
            infer_hard_end_reason_from_stop("end_turn", "s", |_| true),
            None
        );
    }

    #[test]
    fn tool_permission_denied_is_not_a_hard_end() {
        assert!(!journal_content_suggests_permission_reject(
            "bash: Permission denied"
        ));
        assert!(!journal_content_suggests_permission_reject(
            "cat: /root/x: Permission denied"
        ));
        assert!(journal_content_suggests_permission_reject(
            "unknown permission option"
        ));
        assert!(journal_content_suggests_permission_reject(
            "Failed to request permission"
        ));
        assert!(journal_content_suggests_permission_reject(
            "permission_rejected"
        ));
    }
}
