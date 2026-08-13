//! Host session manager: real ACP default; mock only if GROK_APP_ACP=mock.
//!
//! Process policy (I01–I03) — multi-session, no monopoly:
//! - One ACP process per App session (live / background-busy / parked-ready).
//! - Switching chats **never** cancels a busy turn: Streaming / AwaitingPermission
//!   / open tools / deferred prompt_complete demote to `background` (event pump
//!   kept). Only true idle Ready parks warm.
//! - Processes are **not** stolen across App sessions (no same-cwd rebind).
//! - Cap: `maxConcurrentAgents` (default 8, cap 32). Over cap → reclaim idle
//!   parked first; `PROCESS_LIMIT` only when busy slots are full. **Never** kill
//!   background-busy or open-tool turns for capacity.
//! - Idle recycle after `agentIdleMinutes` (default 30); session meta stays.
//! - soft_respawn skips mid-turn live sessions.
//!
//! Streaming performance (I04 / I06):
//! - Mid-stream journal upserts are throttled (≥500ms or paragraph / force).
//! - Pure stream silence: silent heal first (orphan tools / ready-eligible when
//!   the agent RPC already finished), then soft `session://stream_stall`
//!   (Keep waiting / End turn). **Never auto-cancel a user-initiated turn** —
//!   long silence re-prompts only; only the user may End turn.

mod connect;
mod control;
mod events;
mod events_bg;
mod journal;
mod post_turn_reconcile;
mod process;
mod stream;
mod turn;
mod types;
mod watchdog;

// Multi-session event routing (P0 shared-process load-replay safety).
pub(crate) use stream::{resolve_turn_event_route, SessionRouteHint, TurnEventRoute};

#[cfg(test)]
mod media_tests;
#[cfg(test)]
mod routing_tests;
#[cfg(test)]
mod stall_tests;

use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;

use crate::session_fsm::SessionState;

use types::*;

pub(crate) use types::{
    extract_tool_input, tool_journal_richer, RewindExecuteResult, RewindPointDto, SessionSnapshot,
    UiPermissionRequest, TOOL_OUTPUT_MAX_PUB, TOOL_OUTPUT_SENTINEL,
};

pub struct SessionManager {
    /// Currently focused live session (UI-bound for send).
    pub(super) inner: Mutex<Option<LiveSession>>,
    /// Busy sessions still receiving ACP events (streaming / permission).
    /// Keyed by app session id. Enables multi-session parallel streaming.
    pub(super) background: Mutex<HashMap<String, LiveSession>>,
    /// Warm Ready agents for other App sessions (keyed by app session id).
    pub(super) parked: Mutex<HashMap<String, ParkedAgent>>,
    /// Process prewarmed while the user is composing a new chat (no session yet).
    pub(super) prewarm: Mutex<PrewarmState>,
    /// Tool identity learned from in_progress `tool_call` notifications
    /// (terminal `tool_call_update` payloads are status-only). Keyed by
    /// app session id → tool call id. See `remember_tool_identity`.
    pub(super) tool_identities: std::sync::Mutex<
        std::collections::HashMap<String, std::collections::HashMap<String, ToolIdentity>>,
    >,
    /// Serialize connect / park / unpark so openSession prefetch cannot race first send.
    pub(super) connect_lock: tokio::sync::Mutex<()>,
    /// Per-session locks that serialize a prompt's user-journal append with
    /// post-turn reconciliation. Retry sleeps never hold these locks, and one
    /// chat never delays another chat's send.
    pub(super) post_turn_journal_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Soft-respawn requested while the session was mid-turn (YOLO off,
    /// effort change, proxy, …). Flushed when the turn becomes idle so
    /// the next process picks up spawn flags (P0-5 / #598).
    pub(super) pending_soft_respawn: Mutex<HashMap<String, String>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            background: Mutex::new(HashMap::new()),
            parked: Mutex::new(HashMap::new()),
            prewarm: Mutex::new(PrewarmState::None),
            tool_identities: std::sync::Mutex::new(std::collections::HashMap::new()),
            connect_lock: tokio::sync::Mutex::new(()),
            post_turn_journal_locks: Mutex::new(HashMap::new()),
            pending_soft_respawn: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn post_turn_journal_lock(
        &self,
        app_session_id: &str,
    ) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.post_turn_journal_locks.lock();
        Arc::clone(
            locks
                .entry(app_session_id.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    /// True when any live or background session is mid-turn (streaming / tools / connect).
    /// Used by the host automation scheduler to avoid stealing agent slots.
    pub fn any_turn_busy(&self) -> bool {
        {
            let guard = self.inner.lock();
            if let Some(s) = guard.as_ref() {
                if s.prompt_in_flight
                    || matches!(
                        s.fsm.state(),
                        SessionState::Streaming
                            | SessionState::AwaitingPermission
                            | SessionState::Connecting
                    )
                    || !s.open_tool_ids.is_empty()
                {
                    return true;
                }
            }
        }
        let bg = self.background.lock();
        for s in bg.values() {
            if s.prompt_in_flight
                || matches!(
                    s.fsm.state(),
                    SessionState::Streaming
                        | SessionState::AwaitingPermission
                        | SessionState::Connecting
                )
                || !s.open_tool_ids.is_empty()
            {
                return true;
            }
        }
        false
    }
}
