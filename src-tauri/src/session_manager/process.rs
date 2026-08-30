//! Process capacity, park/unpark, idle recycle, snapshots.

#![allow(dead_code)] // residual-clippy: snapshot_from_parked
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::AcpClient;
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::JournalWriteThrottle;
use crate::permission::SessionAllowCache;
use crate::process_limits::{
    can_spawn_process, is_idle_expired, normalize_idle_minutes, normalize_max_concurrent,
    parked_slots_to_free_for_spawn, process_limit_message,
};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored};

use super::*;

/// Count living ACP children by their process identity rather than by session
/// map entries. Warm reuse intentionally leaves multiple session shells with
/// the same `process_id` / `Arc<AcpClient>`, so counting entries can make a
/// single child consume multiple pool slots.
///
/// A missing process id is counted conservatively as a distinct child. That
/// should only occur during an incomplete connect / teardown, and collapsing
/// unknown identities would let capacity accounting under-count real children.
fn count_unique_alive_processes<I>(entries: I) -> u32
where
    I: IntoIterator<Item = (String, bool)>,
{
    let mut process_ids = HashSet::new();
    let mut unknown_alive = 0u32;
    for (process_id, alive) in entries {
        if !alive {
            continue;
        }
        if process_id.trim().is_empty() {
            unknown_alive = unknown_alive.saturating_add(1);
        } else {
            process_ids.insert(process_id);
        }
    }
    (process_ids.len() as u32).saturating_add(unknown_alive)
}

/// A parked entry is only a handle to a process. Never recycle it when that
/// process identity is unknown or still has a live/background tenant.
#[inline]
fn process_recycle_is_blocked(process_id: &str, protected_process_ids: &HashSet<String>) -> bool {
    process_id.trim().is_empty() || protected_process_ids.contains(process_id)
}

impl SessionManager {
    pub(super) fn active_process_count(&self) -> u32 {
        let mut entries = Vec::new();
        {
            let live = self.inner.lock();
            if let Some(s) = live.as_ref() {
                entries.push((
                    s.process_id.clone(),
                    s.acp.as_ref().is_some_and(|c| c.is_alive()),
                ));
            }
        }
        {
            let background = self.background.lock();
            entries.extend(background.values().map(|s| {
                (
                    s.process_id.clone(),
                    s.acp.as_ref().is_some_and(|c| c.is_alive()),
                )
            }));
        }
        {
            let parked = self.parked.lock();
            entries.extend(
                parked
                    .values()
                    .map(|p| (p.process_id.clone(), p.acp.is_alive())),
            );
        }
        count_unique_alive_processes(entries)
    }

    /// Process ids that currently run a turn (live busy or demoted background).
    /// A shared process with a busy session must not be picked for a new
    /// session's reuse — that would stack a second concurrent turn on it.
    #[allow(dead_code)] // kept for diagnostics; reuse now includes busy processes
    pub(super) fn busy_process_ids(&self) -> std::collections::HashSet<String> {
        let mut out = std::collections::HashSet::new();
        {
            let live = self.inner.lock();
            if let Some(s) = live.as_ref() {
                if Self::live_session_is_busy(s)
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
                    && !s.process_id.is_empty()
                {
                    out.insert(s.process_id.clone());
                }
            }
        }
        {
            let background = self.background.lock();
            for s in background.values() {
                if Self::live_session_is_busy(s)
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
                    && !s.process_id.is_empty()
                {
                    out.insert(s.process_id.clone());
                }
            }
        }
        out
    }

    /// Process ids with any living live/background tenant. This is deliberately
    /// stricter than [`Self::busy_process_ids`] for parked reclamation: killing a
    /// parked handle kills the whole child, including a Ready live shell that
    /// has not yet become busy.
    pub(super) fn live_or_background_process_ids(&self) -> HashSet<String> {
        let mut out = HashSet::new();
        {
            let live = self.inner.lock();
            if let Some(s) = live.as_ref() {
                if s.acp.as_ref().is_some_and(|c| c.is_alive()) && !s.process_id.is_empty() {
                    out.insert(s.process_id.clone());
                }
            }
        }
        {
            let background = self.background.lock();
            for s in background.values() {
                if s.acp.as_ref().is_some_and(|c| c.is_alive()) && !s.process_id.is_empty() {
                    out.insert(s.process_id.clone());
                }
            }
        }
        out
    }

    /// Whether another session tenant still owns `process_id`.
    /// Process-level ACP shutdown must never be decided from one session map
    /// entry when an older shared-process state may still be present. Include
    /// parked co-tenants too: dropping a background/live handle can otherwise
    /// kill a Ready peer that is still represented in the parked map.
    pub(super) fn has_other_process_tenant(
        &self,
        process_id: &str,
        except_session_id: &str,
    ) -> bool {
        if process_id.trim().is_empty() {
            return false;
        }
        {
            let live = self.inner.lock();
            if live.as_ref().is_some_and(|s| {
                s.app_session_id != except_session_id
                    && s.process_id == process_id
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
            }) {
                return true;
            }
        }
        // One map lock at a time: chaining both `.lock()`s in a single `||`
        // expression kept the `background` guard alive while taking `parked`
        // (expression temporaries drop at statement end), which is the reverse
        // of `try_park_live`'s parked→background order — an ABBA deadlock.
        {
            let bg = self.background.lock();
            if bg.values().any(|s| {
                s.app_session_id != except_session_id
                    && s.process_id == process_id
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
            }) {
                return true;
            }
        }
        self.parked.lock().values().any(|p| {
            p.app_session_id != except_session_id && p.process_id == process_id && p.acp.is_alive()
        })
    }

    pub(super) fn max_concurrent_from_settings() -> u32 {
        normalize_max_concurrent(store::load_settings().max_concurrent_agents)
    }

    pub(super) fn idle_minutes_from_settings() -> u32 {
        normalize_idle_minutes(store::load_settings().agent_idle_minutes)
    }

    pub(super) fn emit_idle_recycled(app: &AppHandle, session_id: &str, reason: &str) {
        let _ = app.emit(
            "session://idle_recycled",
            serde_json::json!({
                "sessionId": session_id,
                "reason": reason,
            }),
        );
    }

    pub(super) fn emit_process_limit(app: &AppHandle, session_id: Option<&str>, max: u32) {
        let _ = app.emit(
            "session://process_limit",
            serde_json::json!({
                "sessionId": session_id,
                "maxConcurrentAgents": max,
                "code": "PROCESS_LIMIT",
                "message": process_limit_message(max),
            }),
        );
    }

    /// Drop dead parked entries; return removed count (for logging).
    pub(super) fn sweep_dead_parked(&self) -> usize {
        let mut parked = self.parked.lock();
        let before = parked.len();
        parked.retain(|_, p| p.acp.is_alive());
        before.saturating_sub(parked.len())
    }

    /// Drop background shells whose ACP child is gone (stale mid-turn maps).
    pub(super) fn sweep_dead_background(&self) -> usize {
        let mut bg = self.background.lock();
        let before = bg.len();
        bg.retain(|_, s| s.acp.as_ref().is_some_and(|c| c.is_alive()));
        before.saturating_sub(bg.len())
    }

    /// Live + background process count (excludes reclaimable parked idle).
    /// Used for diagnostics / limit messaging after parked reclaim.
    pub(super) fn busy_process_count(&self) -> u32 {
        let mut entries = Vec::new();
        {
            let live = self.inner.lock();
            if let Some(s) = live.as_ref() {
                entries.push((
                    s.process_id.clone(),
                    s.acp.as_ref().is_some_and(|c| c.is_alive()),
                ));
            }
        }
        {
            let background = self.background.lock();
            entries.extend(background.values().map(|s| {
                (
                    s.process_id.clone(),
                    s.acp.as_ref().is_some_and(|c| c.is_alive()),
                )
            }));
        }
        count_unique_alive_processes(entries)
    }

    /// True while a turn is still in flight — must demote to `background`, never park.
    /// Includes open tools / deferred prompt_complete even if FSM already Ready
    /// (early prompt_complete + long-running find/subagent).
    /// Whether this App session is mid-turn (live focus or background).
    /// Used by the local session API to enqueue instead of interrupting.
    pub fn session_turn_busy(&self, app_session_id: &str) -> bool {
        self.with_session_mut(app_session_id, |s| Self::live_session_is_busy(s))
            .unwrap_or(false)
    }

    pub(super) fn live_session_is_busy(s: &LiveSession) -> bool {
        // Authoritative: the prompt RPC has not resolved, so the agent is still
        // producing output for this chat no matter what the FSM says. Parking
        // here dropped the rest of the answer on the floor (parked agents get no
        // event routing) while the agent happily finished the turn.
        if s.prompt_in_flight {
            return true;
        }
        // Sticky ghost Streaming: turn fully ended (no pif / tools / gates /
        // deferred complete) but FSM never left Streaming (and may still hold
        // streaming_message_id). Treating this as busy forever blocked
        // demote/focus and made other chats' sends race the stuck live slot.
        // Real mid-turn keeps prompt_in_flight and/or deferred_prompt_complete
        // and/or open tools after early prompt_complete.
        if matches!(s.fsm.state(), SessionState::Streaming)
            && s.open_tool_ids.is_empty()
            && s.deferred_prompt_complete.is_none()
            && s.pending_plan_rpc_id.is_none()
            && s.pending_ask_user_rpc_id.is_none()
        {
            return false;
        }
        if matches!(
            s.fsm.state(),
            SessionState::Streaming | SessionState::AwaitingPermission | SessionState::Connecting
        ) {
            return true;
        }
        if s.streaming_message_id.is_some() {
            return true;
        }
        if !s.open_tool_ids.is_empty() {
            return true;
        }
        if s.deferred_prompt_complete.is_some() {
            return true;
        }
        if s.pending_plan_rpc_id.is_some()
            || s.pending_ask_user_rpc_id.is_some()
            || s.pending_permission_rpc_id.is_some()
        {
            return true;
        }
        false
    }

    /// Whether a provider `retry_state` may fail the host turn and write a chat error.
    ///
    /// Residual retries during `session/load` reconnect (or shared-process noise
    /// while idle) must **not** append NETWORK_PROVIDER rows or flip the FSM to
    /// Disconnected. Unlike [`Self::live_session_is_busy`], this deliberately
    /// excludes `Connecting` — reconnect is busy for process policy but has no
    /// user turn to abort.
    ///
    /// Host-owned turn = prompt RPC open, stream/tools still live after early
    /// `prompt_complete`, or explicit Streaming / AwaitingPermission.
    #[inline]
    pub(super) fn should_apply_provider_retry_abort(s: &LiveSession) -> bool {
        should_apply_provider_retry_abort_flags(
            s.prompt_in_flight,
            s.streaming_message_id.is_some(),
            !s.open_tool_ids.is_empty(),
            s.deferred_prompt_complete.is_some(),
            s.fsm.state(),
        )
    }

    /// Whether connect/respawn must keep the existing agent process.
    ///
    /// Terminal FSM states (`Disconnected` / `Idle`) never preserve the process —
    /// even when leftover busy flags remain after a failed turn. Otherwise a 502
    /// (or similar) that left `deferred_prompt_complete` set would make every
    /// subsequent connect no-op as `state=Disconnected busy=true`, and the chat
    /// could not send again (Remote IM still works because it uses one-shot `grok -p`).
    pub(super) fn should_preserve_live_process(s: &LiveSession) -> bool {
        connect_should_preserve_live_process(s.fsm.state(), Self::live_session_is_busy(s))
    }

    /// Drop all in-turn busy markers after a terminal turn failure.
    /// Complements FSM `fail_with` (which only flips state + last_error).
    pub(super) fn release_failed_turn_markers(s: &mut LiveSession, app: Option<&AppHandle>) {
        // Flush the last coalesced tokens before dropping the buffer (P0-1 / P1-9).
        // No done flag: the error / fail_with state should win over a fake Ready.
        if let Some(app) = app {
            Self::flush_pending_stream_emit(s, app);
        }
        s.prompt_in_flight = false;
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.open_tool_ids.clear();
        s.open_tool_seen_at.clear();
        s.terminal_tool_ids.clear();
        s.deferred_prompt_complete = None;
        s.pending_plan_rpc_id = None;
        s.pending_ask_user_rpc_id = None;
        s.pending_stream_emit = None;
        s.journal_throttle.reset();
        s.last_stall_emit = None;
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        s.tools_this_turn = 0;
    }

    /// Park or background the current live session so focus can move.
    ///
    /// - Idle Ready (no open tools) → warm `parked`.
    /// - Busy (FSM or open tools / deferred complete) → `background` (event pump kept).
    /// - Demoting a busy turn always succeeds (never cancel for focus).
    pub(super) fn try_park_live(&self) -> Result<(), AgentError> {
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return Ok(());
        };
        // Nothing to park
        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
            // Drop dead shell so connect can rebuild.
            let _ = guard.take();
            return Ok(());
        }

        // Busy (incl. open tools while FSM Ready) → background, never park/reclaim.
        if Self::live_session_is_busy(s) {
            let Some(live) = guard.take() else {
                return Ok(());
            };
            let sid = live.app_session_id.clone();
            let st = live.fsm.state();
            let tools = live.open_tool_ids.len();
            drop(guard);
            tracing::info!(
                "acp demote busy session to background sid={sid} state={st:?} open_tools={tools}"
            );
            self.background.lock().insert(sid, live);
            return Ok(());
        }

        match s.fsm.state() {
            SessionState::Ready => {
                let acp = match s.acp.take() {
                    Some(c) if c.is_alive() => c,
                    Some(_) | None => {
                        let _ = guard.take();
                        return Ok(());
                    }
                };
                // Sessions that only got opened to look at (no prompt sent this
                // visit) are NOT kept warm — close the connection instead of
                // parking. Exception: a just-opened chat may still have a send
                // waiting on the connect lock; killing it is how first prompts
                // vanished until the user nudged with a second message.
                if !s.sent_prompt_this_visit {
                    let recent_open =
                        s.last_activity.elapsed() < std::time::Duration::from_secs(180);
                    if recent_open {
                        tracing::info!(
                            "acp park unsubmitted recent session={} (send may still be in flight)",
                            s.app_session_id
                        );
                        // Fall through to the warm-park path below.
                    } else {
                        let sid = s.app_session_id.clone();
                        let pid = s.process_id.clone();
                        let agent_sid = s.meta.agent_session_id.clone();
                        // Release `inner` before touching the other session maps.
                        // Holding it across `parked`/`background` formed an ABBA
                        // pair with the background→inner promote path (deadlock:
                        // thinking froze and every session command hung until
                        // force-quit).
                        let _ = guard.take();
                        drop(guard);
                        // Shared process (other sessions still reference it): just
                        // drop our reference; the CLI stays for co-tenants.
                        // One map lock at a time — never chain `.lock()`s inside a
                        // single expression (the first guard lives to statement end).
                        let shared_parked = self
                            .parked
                            .lock()
                            .values()
                            .any(|p| p.process_id == pid && p.app_session_id != sid);
                        let shared = shared_parked
                            || self
                                .background
                                .lock()
                                .values()
                                .any(|b| b.process_id == pid && b.app_session_id != sid);
                        if !shared {
                            // Exclusive: kill — the CLI accumulates a session actor
                            // per load and has no public unload API (internal evict
                            // unavailable, close finalizes). A kept process would
                            // make the next load of this same session wait the CLI's
                            // 5s old-thread drain. The prewarm slot is refreshed on
                            // the next connect with a clean process.
                            tracing::info!(
                            "acp detach unsubmitted session={sid} process={pid} (viewed only; closed)"
                        );
                            let c = acp;
                            tokio::spawn(async move {
                                SessionManager::kill_acp_bounded(&c).await;
                            });
                        } else {
                            tracing::info!(
                            "acp detach unsubmitted session={sid} process={pid} (viewed only; shared process kept)"
                        );
                            // Best-effort actor unload (keeps session resumable) —
                            // soft-fails on CLIs without the internal method.
                            if let Some(asid) = agent_sid {
                                let c = acp.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = c.evict_sessions(&[asid]).await {
                                        tracing::debug!("evict session failed (soft): {e}");
                                    }
                                });
                            }
                        }
                        return Ok(());
                    }
                }
                let sandbox_profile = acp.sandbox_profile();
                let parked = ParkedAgent {
                    process_id: s.process_id.clone(),
                    app_session_id: s.app_session_id.clone(),
                    meta: s.meta.clone(),
                    acp,
                    last_activity: s.last_activity,
                    model_id: s.model_id.clone(),
                    effort: s.effort.clone(),
                    product_mode: s.product_mode.clone(),
                    project_path: s.project_path.clone(),
                    policy: s.policy,
                    sandbox_profile,
                    needs_history_bootstrap: s.needs_history_bootstrap,
                    backend: s.backend.clone(),
                };
                let _ = guard.take();
                drop(guard);
                self.parked
                    .lock()
                    .insert(parked.app_session_id.clone(), parked);
                Ok(())
            }
            SessionState::Idle | SessionState::Disconnected => {
                // Detach dead/idle shell without killing if no acp; drop shell.
                let _ = guard.take();
                Ok(())
            }
            other => Err(AgentError::new(
                AgentErrorCode::ProcessLimit,
                format!(
                    "Session is busy ({other:?}). Stop the turn or wait, then switch chats. {}",
                    process_limit_message(Self::max_concurrent_from_settings())
                ),
            )),
        }
    }

    /// Like `try_park_live`, then emit `session://runtime` for the demoted session.
    pub(super) fn try_park_live_emit(&self, app: &AppHandle) -> Result<(), AgentError> {
        let pre = self.inner.lock().as_ref().map(|s| {
            let busy = Self::live_session_is_busy(s);
            let mut snap = Self::snapshot_from_live(s);
            if busy && snap.state == SessionState::Ready {
                // Open tools while Ready — project as streaming so UI keeps busy.
                snap.state = SessionState::Streaming;
            }
            (busy, snap)
        });
        self.try_park_live()?;
        if let Some((busy, snap)) = pre {
            if busy {
                Self::emit_runtime(app, &snap);
            } else if snap.state == SessionState::Ready {
                let mut parked_snap = snap;
                parked_snap.streaming_message_id = None;
                Self::emit_runtime(app, &parked_snap);
            }
        }
        Ok(())
    }

    /// If a background session finished its turn (Ready, no open tools), park warm.
    pub(super) fn promote_background_ready_to_parked(&self, app_session_id: &str) {
        let mut bg = self.background.lock();
        let ready = bg.get(app_session_id).is_some_and(|s| {
            matches!(s.fsm.state(), SessionState::Ready)
                && !s.prompt_in_flight
                && s.streaming_message_id.is_none()
                && s.open_tool_ids.is_empty()
                && s.deferred_prompt_complete.is_none()
                && s.pending_plan_rpc_id.is_none()
                && s.pending_ask_user_rpc_id.is_none()
                && s.acp.as_ref().is_some_and(|c| c.is_alive())
        });
        if !ready {
            return;
        }
        let Some(mut s) = bg.remove(app_session_id) else {
            return;
        };
        drop(bg);
        let Some(acp) = s.acp.take() else {
            return;
        };
        let sandbox_profile = acp.sandbox_profile();
        let parked = ParkedAgent {
            process_id: s.process_id.clone(),
            app_session_id: s.app_session_id.clone(),
            meta: s.meta.clone(),
            acp,
            last_activity: s.last_activity,
            model_id: s.model_id.clone(),
            effort: s.effort.clone(),
            product_mode: s.product_mode.clone(),
            project_path: s.project_path.clone(),
            policy: s.policy,
            sandbox_profile,
            needs_history_bootstrap: s.needs_history_bootstrap,
            backend: s.backend.clone(),
        };
        self.parked
            .lock()
            .insert(parked.app_session_id.clone(), parked);
        tracing::info!(
            "acp background session ready → parked sid={}",
            app_session_id
        );
    }

    /// Promote a parked agent into the live slot (caller must have cleared live).
    pub(super) fn unpark_to_live(&self, app_session_id: &str) -> Option<LiveSession> {
        let parked = self.parked.lock().remove(app_session_id)?;
        if !parked.acp.is_alive() {
            return None;
        }
        let mut fsm = SessionFsm::new();
        // Parked agents were Ready; restore Ready without connect handshake.
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        Some(LiveSession {
            app_session_id: parked.app_session_id,
            process_id: parked.process_id,
            meta: parked.meta,
            fsm,
            backend: parked.backend,
            acp: Some(parked.acp),
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: parked.model_id,
            effort: parked.effort,
            product_mode: parked.product_mode,
            project_path: parked.project_path,
            allow_cache: SessionAllowCache::default(),
            policy: parked.policy,
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: parked.needs_history_bootstrap,
            pending_plan_rpc_id: None,
            pending_permission_rpc_id: None,
            pending_permission_options: None,
            pending_permission_tool_name: None,
            pending_permission_ui: None,
            pending_ask_user_rpc_id: None,
            pending_ask_user_ui: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            terminal_tool_ids: HashSet::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: false,
            sent_prompt_this_visit: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        })
    }

    /// Move a background session into the (already cleared) live focus slot.
    ///
    /// Lock discipline: `background` is released **before** `inner` is taken.
    /// The old inline `if let Some(live) = self.background.lock().remove(..)`
    /// kept the `background` guard alive across the body (edition-2021 if-let
    /// temporaries), locking background→inner while `try_park_live` locked
    /// inner→background — an ABBA deadlock that froze streaming ("thinking"
    /// stuck) and every session command (export, stop, state) until force-quit.
    pub(super) fn promote_background_to_live(&self, target_sid: &str) -> bool {
        let removed = self.background.lock().remove(target_sid);
        let Some(live) = removed else {
            return false;
        };
        *self.inner.lock() = Some(live);
        true
    }

    /// Run `f` on a session's runtime state wherever it currently sits —
    /// the live focus slot **or** a demoted `background` turn.
    ///
    /// Session-scoped commands (permission / plan / ask_user answers) must use
    /// this instead of reaching for `self.inner`: the pending JSON-RPC id lives
    /// on the session that asked, and that session may have been demoted when
    /// the user switched chats. Answering against the live slot sent the reply
    /// to the wrong ACP child, so the background turn waited forever.
    ///
    /// Parked agents are idle Ready and hold no pending RPC — not searched.
    pub(super) fn with_session_mut<R>(
        &self,
        app_session_id: &str,
        f: impl FnOnce(&mut LiveSession) -> R,
    ) -> Option<R> {
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_session_id {
                    return Some(f(s));
                }
            }
        }
        let mut bg = self.background.lock();
        bg.get_mut(app_session_id).map(f)
    }

    /// True when `app_session_id` currently owns the live focus slot.
    pub(super) fn is_live_session(&self, app_session_id: &str) -> bool {
        self.inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.app_session_id == app_session_id)
    }

    /// Emit the right runtime event for a session touched out-of-focus:
    /// `session://state` when it is live, `session://runtime` when demoted.
    pub(super) fn emit_for_session(&self, app: &AppHandle, app_session_id: &str) {
        if self.is_live_session(app_session_id) {
            Self::emit_state(app, &self.snapshot());
            return;
        }
        let snap = self
            .background
            .lock()
            .get(app_session_id)
            .map(Self::snapshot_from_live);
        if let Some(snap) = snap {
            Self::emit_runtime(app, &snap);
        }
    }

    /// Move `target_sid` into the live focus slot **without spawning**.
    ///
    /// Demotes the current live session first (busy → `background`, Ready →
    /// `parked`), then promotes the target from `background` / `parked`.
    /// Returns `false` when the target has no warm process — the caller must
    /// `connect` (cold spawn) instead.
    ///
    /// `send` prefers [`Self::ensure_promptable_session`] so a mid-turn live
    /// chat is not demoted when the target already has a warm background /
    /// parked agent (multi-window concurrent pool). This helper remains for
    /// callers that need the UI focus slot itself.
    ///
    /// Under `connect_lock` so a concurrent warm connect cannot swap the live
    /// slot between the caller's connect and its send (that delivered prompts
    /// into a foreign chat and left empty-journal zombie sessions behind).
    pub(super) fn focus_session(
        &self,
        app: &AppHandle,
        target_sid: &str,
    ) -> Result<bool, AgentError> {
        if self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id == target_sid && s.acp.as_ref().is_some_and(|c| c.is_alive())
        }) {
            return Ok(true);
        }
        let in_background = self.background.lock().contains_key(target_sid);
        let in_parked = self.parked.lock().contains_key(target_sid);
        if !in_background && !in_parked {
            return Ok(false);
        }

        self.try_park_live_emit(app)?;
        // Never overwrite a shell that still holds a living ACP child.
        if self
            .inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
        {
            self.try_park_live()?;
        }
        let _ = self.inner.lock().take();

        if in_background && self.promote_background_to_live(target_sid) {
            tracing::info!("acp focus: background → live sid={target_sid}");
            Self::emit_state(app, &self.snapshot());
            return Ok(true);
        }
        if let Some(live) = self.unpark_to_live(target_sid) {
            *self.inner.lock() = Some(live);
            tracing::info!("acp focus: parked → live sid={target_sid}");
            Self::emit_state(app, &self.snapshot());
            return Ok(true);
        }
        // Parked process died between the check and the promote → cold spawn.
        Ok(false)
    }

    /// Ensure `target_sid` can accept a prompt **without** demoting a different
    /// mid-turn live agent when the target is already warm in the pool.
    ///
    /// Multi-window concurrent slots:
    /// - Already live → ok
    /// - Already background (busy or idle shell) → prompt in place (no promote)
    /// - Parked while live is busy on another chat → unpark into **background**
    ///   so the streaming focus is not stolen
    /// - Parked while live is free / same chat → normal focus promote
    /// - No warm process → `Ok(false)` (caller cold-connects)
    ///
    /// Must run under `connect_lock`.
    pub(super) fn ensure_promptable_session(
        &self,
        app: &AppHandle,
        target_sid: &str,
    ) -> Result<bool, AgentError> {
        // Live focus already on target with a living ACP.
        if self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id == target_sid && s.acp.as_ref().is_some_and(|c| c.is_alive())
        }) {
            return Ok(true);
        }

        // Background: keep in place — do not demote the current live focus.
        if self
            .background
            .lock()
            .get(target_sid)
            .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
        {
            tracing::info!("acp promptable: background in-place sid={target_sid} (no live demote)");
            return Ok(true);
        }

        // Parked warm: if live is mid-turn on another chat, unpark into
        // background so concurrent multi-window send does not steal focus.
        let live_busy_other = self.inner.lock().as_ref().is_some_and(|s| {
            s.app_session_id != target_sid
                && s.acp.as_ref().is_some_and(|c| c.is_alive())
                && Self::live_session_is_busy(s)
        });
        if live_busy_other && self.parked.lock().contains_key(target_sid) {
            if let Some(live) = self.unpark_to_live(target_sid) {
                // unpark_to_live builds a LiveSession; place it into background
                // so the busy live focus is not demoted.
                let sid = live.app_session_id.clone();
                let snap = Self::snapshot_from_live(&live);
                self.background.lock().insert(sid.clone(), live);
                tracing::info!(
                    "acp promptable: parked → background sid={sid} (live busy preserved)"
                );
                Self::emit_runtime(app, &snap);
                return Ok(true);
            }
            // Parked process died — fall through to focus / cold path.
        }

        // Default: promote into live focus (may demote Ready live → parked,
        // or busy live → background — never kills a busy turn).
        self.focus_session(app, target_sid)
    }

    /// Kill oldest parked agents until `need_slots` are freed (or none left).
    /// Parked = Ready idle; never touches background busy turns.
    pub(super) async fn free_parked_for_capacity(&self, app: &AppHandle, need_slots: u32) -> usize {
        if need_slots == 0 {
            return 0;
        }
        // One slot = one process. Parked entries may now SHARE a process, so
        // recycle whole process groups (all sessions on the oldest process),
        // never individual entries (killing one session's handle would kill
        // the shared CLI under its co-tenants).
        let mut freed = 0usize;
        for _ in 0..need_slots {
            // Capacity reclaim runs under `connect_lock` in the normal spawn
            // path. Protect every living live/background process anyway: a
            // parked entry can be a stale co-tenant handle left behind by warm
            // reuse, and killing it would terminate the active child.
            let protected_process_ids = self.live_or_background_process_ids();
            let victim = {
                let mut parked = self.parked.lock();
                // Select only an unshared process group. Do not temporarily
                // drain all entries: a concurrent reader should never observe
                // unrelated parked sessions disappearing from the pool.
                let oldest_pid = parked
                    .values()
                    .filter(|p| !process_recycle_is_blocked(&p.process_id, &protected_process_ids))
                    .min_by_key(|p| p.last_activity)
                    .map(|p| p.process_id.clone());
                match oldest_pid {
                    None => None,
                    Some(pid) => {
                        let keys: Vec<String> = parked
                            .iter()
                            .filter(|(_, p)| p.process_id == pid)
                            .map(|(sid, _)| sid.clone())
                            .collect();
                        let mut entries = Vec::with_capacity(keys.len());
                        for sid in keys {
                            if let Some(p) = parked.remove(&sid) {
                                entries.push(p);
                            }
                        }
                        if entries.is_empty() {
                            None
                        } else {
                            Some((pid, entries))
                        }
                    }
                }
            };
            let Some((pid, entries)) = victim else {
                break;
            };
            tracing::info!(
                "process limit: recycling process={pid} sessions={}",
                entries.len()
            );
            if let Some(acp) = entries.first().map(|p| p.acp.clone()) {
                Self::kill_acp_bounded(&acp).await;
            }
            for p in entries {
                Self::emit_idle_recycled(app, &p.app_session_id, "capacity");
            }
            freed += 1;
        }
        freed
    }

    /// Move every finished `background` turn into `parked`.
    ///
    /// `background` is only reclaimable via `parked`, and it is only drained on
    /// the events that end a turn. A turn that ended by any other route (error,
    /// stop, a missed completion) left its agent sitting in `background`
    /// forever: it counted against the pool but no reclaim path could ever free
    /// it, so the app reported "all slots busy" with nothing running.
    pub(super) fn sweep_finished_background_to_parked(&self) {
        let keys: Vec<String> = self.background.lock().keys().cloned().collect();
        for k in keys {
            self.promote_background_ready_to_parked(&k);
        }
    }

    /// Before spawn: reclaim idle parked until there is room (never kill busy).
    pub(super) async fn reclaim_parked_until_can_spawn(
        &self,
        app: &AppHandle,
        max_concurrent: u32,
    ) {
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns are idle warm agents — make them reclaimable
        // before deciding the pool is full of running work.
        self.sweep_finished_background_to_parked();
        // Free enough parked slots for one new process (may free multiple).
        let active = self.active_process_count();
        let need = parked_slots_to_free_for_spawn(active, max_concurrent);
        if need > 0 {
            let _ = self.free_parked_for_capacity(app, need).await;
        }
        // If still full (e.g. free returned fewer), keep freeing until spawnable or empty.
        while !can_spawn_process(self.active_process_count(), max_concurrent) {
            let parked_n = self.parked.lock().len();
            if parked_n == 0 {
                break;
            }
            if self.free_parked_for_capacity(app, 1).await == 0 {
                // All remaining parked handles belong to a living process
                // that is still owned by another tenant. Retrying forever
                // would spin the connect task while no safe victim exists.
                break;
            }
        }
    }

    pub(super) async fn try_lock_connect(
        &self,
        wait: Duration,
    ) -> Option<tokio::sync::MutexGuard<'_, ()>> {
        tokio::time::timeout(wait, self.connect_lock.lock())
            .await
            .ok()
    }

    /// Non-blocking probe: true when some task currently holds `connect_lock`.
    pub fn connect_lock_busy(&self) -> bool {
        self.connect_lock.try_lock().is_err()
    }

    pub(super) fn record_connect_holder(&self, session_id: Option<String>, phase: &'static str) {
        *self.connect_holder.lock() = Some(ConnectLockHolderInfo {
            session_id,
            phase,
            since: Instant::now(),
        });
    }

    pub(super) fn clear_connect_holder(&self) {
        *self.connect_holder.lock() = None;
        self.connect_lock_busy_ticks
            .store(0, std::sync::atomic::Ordering::SeqCst);
    }

    pub(super) fn connect_holder_snapshot(&self) -> Option<ConnectLockHolderInfo> {
        self.connect_holder.lock().clone()
    }

    pub(super) async fn kill_acp_bounded(acp: &AcpClient) {
        if tokio::time::timeout(Duration::from_secs(ACP_KILL_TIMEOUT_SECS), acp.kill())
            .await
            .is_err()
        {
            tracing::warn!(secs = ACP_KILL_TIMEOUT_SECS, "acp kill timed out");
        }
    }

    pub(super) fn register_pending_child(&self, child: PendingAcpChild) {
        self.pending_children.lock().push(child);
    }

    pub(super) fn unregister_pending_child(&self, process_id: &str) {
        self.pending_children
            .lock()
            .retain(|c| c.process_id != process_id);
    }

    pub(super) async fn sweep_pending_children(&self) {
        let kids = std::mem::take(&mut *self.pending_children.lock());
        for child in kids {
            Self::kill_acp_bounded(&child.acp).await;
        }
    }

    pub(super) async fn sweep_pending_for_session(&self, session_id: &str) {
        let kids: Vec<PendingAcpChild> = {
            let mut list = self.pending_children.lock();
            let mut taken = Vec::new();
            list.retain(|c| {
                if c.session_id.as_deref() == Some(session_id) {
                    taken.push(c.clone());
                    false
                } else {
                    true
                }
            });
            taken
        };
        for child in kids {
            Self::kill_acp_bounded(&child.acp).await;
        }
    }

    /// Idle recycle for live + parked (I03).
    pub(super) async fn tick_idle_recycle(&self, app: &AppHandle) {
        // Serialize recycle with connect/park/unpark. Bound the wait so a
        // wedged handshake cannot pin this watchdog (and every later connect).
        let Some(_connect_guard) = self
            .try_lock_connect(Duration::from_secs(CONNECT_LOCK_WATCHDOG_SECS))
            .await
        else {
            let ticks = self
                .connect_lock_busy_ticks
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                .saturating_add(1);
            let holder = self.connect_holder_snapshot();
            let held_secs = holder
                .as_ref()
                .map(|h| h.since.elapsed().as_secs())
                .unwrap_or(0);
            let session = holder
                .as_ref()
                .and_then(|h| h.session_id.clone())
                .unwrap_or_else(|| "-".into());
            let phase = holder.as_ref().map(|h| h.phase).unwrap_or("unknown");
            if ticks >= CONNECT_LOCK_BUSY_ESCALATE_TICKS {
                tracing::error!(
                    secs = CONNECT_LOCK_WATCHDOG_SECS,
                    ticks,
                    session = %session,
                    phase,
                    held_secs,
                    "connect_lock held by session={session} phase={phase} since={held_secs}s"
                );
            } else {
                tracing::warn!(
                    secs = CONNECT_LOCK_WATCHDOG_SECS,
                    session = %session,
                    phase,
                    held_secs,
                    "idle recycle skipped: connect_lock busy"
                );
            }
            return;
        };
        self.connect_lock_busy_ticks
            .store(0, std::sync::atomic::Ordering::SeqCst);
        let idle_mins = Self::idle_minutes_from_settings();
        let now = Instant::now();
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns become parked so the idle window applies.
        self.sweep_finished_background_to_parked();

        // Parked first — recycle whole process groups when EVERY session on the
        // process is idle-expired (a shared process must not be killed while a
        // co-tenant session is still warm).
        // A parked handle may still share its ACP with a live/background
        // tenant after warm reuse. Protect every living tenant PID (not only
        // busy ones) before any process-level kill.
        let protected_process_ids = self.live_or_background_process_ids();
        let expired_groups: Vec<(String, Vec<ParkedAgent>)> = {
            let mut parked = self.parked.lock();
            let mut groups: HashMap<String, Vec<ParkedAgent>> = HashMap::new();
            let keys: Vec<String> = parked.keys().cloned().collect();
            for k in keys {
                if let Some(p) = parked.remove(&k) {
                    groups.entry(p.process_id.clone()).or_default().push(p);
                }
            }
            let mut keep: HashMap<String, ParkedAgent> = HashMap::new();
            let mut expired: Vec<(String, Vec<ParkedAgent>)> = Vec::new();
            for (pid, entries) in groups {
                if !process_recycle_is_blocked(&pid, &protected_process_ids)
                    && entries
                        .iter()
                        .all(|p| is_idle_expired(p.last_activity, idle_mins, now))
                {
                    expired.push((pid, entries));
                } else {
                    for p in entries {
                        keep.insert(p.app_session_id.clone(), p);
                    }
                }
            }
            *parked = keep;
            expired
        };
        for (pid, entries) in expired_groups {
            tracing::info!(
                "idle recycle process={pid} sessions={} after {idle_mins}min",
                entries.len()
            );
            if let Some(acp) = entries.first().map(|p| p.acp.clone()) {
                Self::kill_acp_bounded(&acp).await;
            }
            for p in entries {
                Self::emit_idle_recycled(app, &p.app_session_id, "idle");
            }
        }

        // Live: only true idle Ready (never mid-turn / open tools). Killing a
        // live process also reaps any parked co-tenant entries sharing it.
        let live_candidate = {
            let guard = self.inner.lock();
            guard.as_ref().and_then(|s| {
                let idle = is_idle_expired(s.last_activity, idle_mins, now);
                let ready_idle = matches!(s.fsm.state(), SessionState::Ready)
                    && !Self::live_session_is_busy(s)
                    && s.acp.as_ref().is_some_and(|c| c.is_alive());
                if idle && ready_idle {
                    Some((s.app_session_id.clone(), s.process_id.clone()))
                } else {
                    None
                }
            })
        };
        let live_shared_with_background = live_candidate.as_ref().is_some_and(|(_, pid)| {
            self.background
                .lock()
                .values()
                .any(|s| s.process_id == *pid && s.acp.as_ref().is_some_and(|c| c.is_alive()))
        });
        if live_shared_with_background {
            if let Some((sid, pid)) = live_candidate.as_ref() {
                tracing::debug!(
                    session = %sid,
                    process = %pid,
                    "idle recycle live skipped: shared background tenant"
                );
            }
        }
        let live_kill = if live_shared_with_background {
            None
        } else if let Some((candidate_sid, candidate_pid)) = live_candidate {
            // Re-check the candidate while taking the ACP. The connect lock
            // prevents map moves, but event handling can still mark a turn
            // terminal between the first snapshot and this point.
            let mut guard = self.inner.lock();
            match guard.as_mut() {
                None => None,
                Some(s) if s.app_session_id != candidate_sid || s.process_id != candidate_pid => {
                    None
                }
                Some(s) => {
                    let idle = is_idle_expired(s.last_activity, idle_mins, now);
                    let ready_idle = matches!(s.fsm.state(), SessionState::Ready)
                        && !Self::live_session_is_busy(s)
                        && s.acp.as_ref().is_some_and(|c| c.is_alive());
                    if idle && ready_idle {
                        if let Some(acp) = s.acp.take() {
                            s.fsm.soft_disconnect();
                            s.needs_history_bootstrap = false;
                            Some((s.app_session_id.clone(), s.process_id.clone(), acp))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
            }
        } else {
            None
        };
        if let Some((sid, pid, acp)) = live_kill {
            tracing::info!("idle recycle live session={sid} after {idle_mins}min");
            // Remove parked co-tenants before killing so their eventual
            // ProcessExited notification cannot race a later reconnect.
            let parked_cotenants = if pid.is_empty() {
                Vec::new()
            } else {
                let mut parked = self.parked.lock();
                let keys: Vec<String> = parked
                    .iter()
                    .filter(|(_, p)| p.process_id == pid)
                    .map(|(session_id, _)| session_id.clone())
                    .collect();
                keys.into_iter()
                    .filter_map(|session_id| parked.remove(&session_id))
                    .collect::<Vec<_>>()
            };
            Self::kill_acp_bounded(&acp).await;
            Self::emit_idle_recycled(app, &sid, "idle");
            for p in parked_cotenants {
                Self::emit_idle_recycled(app, &p.app_session_id, "idle");
            }
            Self::emit_state(app, &self.snapshot());
        }
    }

    pub(super) fn backend_name() -> String {
        if AcpClient::use_mock() {
            "mock_acp".into()
        } else {
            "grok_agent_stdio".into()
        }
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        Self::snapshot_locked(&self.inner.lock())
    }

    /// Snapshot from an already-held `inner` guard.
    ///
    /// `parking_lot::Mutex` is not reentrant — callers that already hold
    /// `inner` must use this (or [`Self::snapshot_from_live`]) instead of
    /// [`Self::snapshot`], which would deadlock.
    pub(super) fn snapshot_locked(inner: &Option<LiveSession>) -> SessionSnapshot {
        match inner.as_ref() {
            None => SessionSnapshot {
                session_id: None,
                agent_session_id: None,
                state: SessionState::Idle,
                last_error: None,
                streaming_message_id: None,
                backend: Self::backend_name(),
                model_id: None,
                project_path: None,
                title: String::new(),
            },
            Some(s) => Self::snapshot_from_live(s),
        }
    }

    /// Runtime diagnostics for a session export package (live, background, or parked).
    /// Returns `None` when the session is not currently attached to a process.
    ///
    /// Bounded lock waits: the diagnostic export is exactly what users reach
    /// for when the app is wedged. If a session-map lock cannot be acquired
    /// within budget, record which lock was busy instead of hanging the export
    /// forever behind the very deadlock it is meant to diagnose.
    pub fn diagnostic_runtime_for(&self, app_session_id: &str) -> Option<serde_json::Value> {
        const LOCK_BUDGET: Duration = Duration::from_secs(2);
        {
            let Some(guard) = self.inner.try_lock_for(LOCK_BUDGET) else {
                return Some(Self::lock_busy_runtime_json("inner"));
            };
            if let Some(s) = guard.as_ref() {
                if s.app_session_id == app_session_id {
                    return Some(Self::live_runtime_json(s, "live"));
                }
            }
        }
        {
            let Some(bg) = self.background.try_lock_for(LOCK_BUDGET) else {
                return Some(Self::lock_busy_runtime_json("background"));
            };
            if let Some(s) = bg.get(app_session_id) {
                // Overnight / demoted busy turns live here — export must see them.
                return Some(Self::live_runtime_json(s, "background"));
            }
        }
        let Some(parked) = self.parked.try_lock_for(LOCK_BUDGET) else {
            return Some(Self::lock_busy_runtime_json("parked"));
        };
        if let Some(p) = parked.get(app_session_id) {
            return Some(serde_json::json!({
                "slot": "parked",
                "state": "Ready",
                "backend": p.backend,
                "modelId": p.model_id,
                "effort": p.effort,
                "mode": p.product_mode,
                "permissionPolicy": p.policy.as_str(),
                "projectPath": p.project_path,
                "agentSessionId": p.meta.agent_session_id,
                "processId": p.process_id,
                "agentAlive": p.acp.is_alive(),
                "cwd": p.acp.cwd().display().to_string(),
                "streamingMessageId": serde_json::Value::Null,
                "toolsThisTurn": 0,
                "openToolCount": 0,
                "promptInFlight": false,
                "needsHistoryBootstrap": p.needs_history_bootstrap,
                "lastError": serde_json::Value::Null,
            }));
        }
        None
    }

    /// Placeholder runtime snapshot when a session-map lock stayed busy past
    /// the export budget. Landing in `host/runtime.json`, this is direct
    /// evidence of a wedged lock holder (deadlock or long store write).
    fn lock_busy_runtime_json(lock: &str) -> serde_json::Value {
        serde_json::json!({
            "slot": "unknown",
            "state": "LockBusy",
            "lockBusy": lock,
            "note": "session manager lock not acquired within budget during export; runtime snapshot skipped (possible deadlock or long store write)",
        })
    }

    pub(super) fn live_runtime_json(s: &LiveSession, slot: &str) -> serde_json::Value {
        let cwd = s.acp.as_ref().map(|c| c.cwd().display().to_string());
        let agent_alive = s.acp.as_ref().is_some_and(|c| c.is_alive());
        serde_json::json!({
            "slot": slot,
            "state": format!("{:?}", s.fsm.state()),
            "backend": s.backend,
            "modelId": s.model_id,
            "effort": s.effort,
            "mode": s.product_mode,
            "permissionPolicy": s.policy.as_str(),
            "projectPath": s.project_path,
            "agentSessionId": s.meta.agent_session_id,
            "processId": s.process_id,
            "agentAlive": agent_alive,
            "cwd": cwd,
            "streamingMessageId": s.streaming_message_id,
            "toolsThisTurn": s.tools_this_turn,
            "openToolCount": s.open_tool_ids.len(),
            "promptInFlight": s.prompt_in_flight,
            "needsHistoryBootstrap": s.needs_history_bootstrap,
            "lastError": s.fsm.last_error().map(|e| {
                serde_json::json!({
                    "code": e.code.as_str(),
                    "message": e.message,
                })
            }),
        })
    }

    /// Keep live session meta title in sync after store rename / auto-title.
    /// Without this, later `session://state` events re-emit the stale connect-time title
    /// and wipe sidebar / header renames.
    pub fn apply_title(&self, app: &AppHandle, session_id: &str, title: &str) -> bool {
        let title = title.trim();
        if title.is_empty() {
            return false;
        }
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return false;
        };
        if s.app_session_id != session_id {
            return false;
        }
        if s.meta.title == title {
            return true;
        }
        s.meta.title = title.to_string();
        s.meta.updated_at = chrono::Utc::now();
        drop(guard);
        Self::emit_state(app, &self.snapshot());
        true
    }

    pub(super) fn emit_state(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://state", snap);
    }

    /// Multi-session runtime for a non-focused session (background / parked).
    /// Does **not** move the live focus slot — UI projects this into `liveMap` only.
    pub(super) fn emit_runtime(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://runtime", snap);
    }

    pub(super) fn snapshot_from_live(s: &LiveSession) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(s.app_session_id.clone()),
            agent_session_id: s.meta.agent_session_id.clone(),
            state: s.fsm.state(),
            last_error: s.fsm.last_error().cloned(),
            streaming_message_id: s.streaming_message_id.clone(),
            backend: s.backend.clone(),
            model_id: s.model_id.clone(),
            project_path: s.project_path.clone(),
            title: s.meta.title.clone(),
        }
    }

    pub(super) fn snapshot_from_parked(p: &ParkedAgent) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(p.app_session_id.clone()),
            agent_session_id: p.meta.agent_session_id.clone(),
            state: SessionState::Ready,
            last_error: None,
            streaming_message_id: None,
            backend: p.backend.clone(),
            model_id: p.model_id.clone(),
            project_path: p.project_path.clone(),
            title: p.meta.title.clone(),
        }
    }

    /// Persist + push a chat-visible error for a failed turn (retries exhausted, RPC fail, …).
    /// Updates UI via `session://turn_error` so the optimistic thinking bubble becomes a record.
    ///
    /// Content is intentionally short (code + compact reason). The UI maps codes to i18n copy
    /// and must not dump raw RPC/MCP stderr into the chat bubble.
    pub(super) fn record_turn_error(s: &mut LiveSession, app: &AppHandle, err: &AgentError) {
        let mid = s
            .streaming_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let code = err.code.as_str();
        let detail = sanitize_error_detail(err.message.trim());
        // Persist machine-readable code first so the frontend can i18n the summary.
        let content = if detail.is_empty() {
            format!("**{code}**")
        } else {
            format!("**{code}**\n\n{detail}")
        };
        if let Err(e) = store::append_message(
            &s.app_session_id,
            ChatMessageStored {
                id: mid.clone(),
                role: "assistant".into(),
                content: content.clone(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: true,
                attachments: None,
                marker: None,
            },
        ) {
            tracing::error!(session = %s.app_session_id, "turn-error journal append failed: {e}");
        }
        s.meta.updated_at = chrono::Utc::now();
        if let Err(e) = store::update_session_meta(&s.meta) {
            tracing::warn!(session = %s.app_session_id, "turn-error metadata update failed: {e}");
        }
        // Clear *all* busy markers (including deferred prompt_complete / open tools).
        // Leaving them set after fail_with left the session as Disconnected+busy,
        // so connect no-oped forever and local sends failed while Remote IM still worked.
        Self::release_failed_turn_markers(s, Some(app));

        let _ = app.emit(
            "session://turn_error",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "messageId": mid,
                "code": code,
                "message": detail,
                "content": content,
            }),
        );
    }
}

#[cfg(test)]
mod process_accounting_tests {
    use super::{count_unique_alive_processes, process_recycle_is_blocked};
    use std::collections::HashSet;

    #[test]
    fn shared_process_id_counts_once_across_session_slots() {
        let count = count_unique_alive_processes([
            ("proc-shared".to_string(), true), // live
            ("proc-shared".to_string(), true), // background co-tenant
            ("proc-shared".to_string(), true), // parked co-tenant
            ("proc-other".to_string(), true),
            ("proc-dead".to_string(), false),
        ]);
        assert_eq!(count, 2);
    }

    #[test]
    fn unknown_alive_processes_are_counted_conservatively() {
        let count = count_unique_alive_processes([
            (String::new(), true),
            (String::new(), true),
            ("proc-dead".to_string(), false),
        ]);
        assert_eq!(count, 2);
    }

    #[test]
    fn parked_recycle_is_blocked_for_shared_or_unknown_processes() {
        let protected = HashSet::from(["proc-busy".to_string(), "proc-ready".to_string()]);
        assert!(process_recycle_is_blocked("proc-busy", &protected));
        assert!(process_recycle_is_blocked("proc-ready", &protected));
        assert!(process_recycle_is_blocked("", &protected));
        assert!(!process_recycle_is_blocked("proc-idle", &protected));
    }
}
