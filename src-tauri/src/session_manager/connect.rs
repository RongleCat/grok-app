//! Session connect / mock connect / event-routing helpers.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{AcpClient, AcpEvent};
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::JournalWriteThrottle;
use crate::mock_acp::MockConnectMode;
use crate::permission::{PermissionPolicy, SessionAllowCache};
use crate::process_limits::{can_spawn_process, normalize_max_concurrent, process_limit_message};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self};

use super::fork_trim::{
    apply_child_rewind_fail_safe, child_trim_plan, fork_trimmed_outcome, ChildTrimPlan,
};
use super::*;

/// Drops `connect_lock` holder diagnostics when the lock guard goes out of
/// scope — including on task abort, where tokio drops the future's stack.
struct ConnectHolderGuard {
    mgr: Arc<SessionManager>,
}

impl ConnectHolderGuard {
    fn enter(mgr: Arc<SessionManager>, session_id: Option<String>, phase: &'static str) -> Self {
        mgr.record_connect_holder(session_id, phase);
        Self { mgr }
    }
}

impl Drop for ConnectHolderGuard {
    fn drop(&mut self) {
        self.mgr.clear_connect_holder();
    }
}

fn emit_host_exit_heal(app: &AppHandle, session_id: &str) {
    let Some(message_id) = crate::turn_interrupt::heal_interrupted_turn(session_id) else {
        return;
    };
    let _ = app.emit(
        "session://turn_marker",
        serde_json::json!({
            "sessionId": session_id,
            "messageId": message_id,
            "marker": "turn_cancelled",
            "reason": "host_exit",
            "content": "turn_cancelled|host_exit",
        }),
    );
}

impl SessionManager {
    pub async fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
        ssh_alias: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        // Enqueue is logged before `connect_lock` so a stuck holder still
        // leaves a trail. The 90s timer runs *inside* the sibling so dropping
        // this JoinHandle (HTTP 15s) still reaps the lock.
        tracing::info!(
            target: "session",
            session = ?app_session_id,
            "connect enqueue"
        );
        crate::logging::sync_diag(&format!("connect enqueue session={:?}", app_session_id));

        let my_gen = self
            .connect_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            .wrapping_add(1);

        let mgr = Arc::clone(self);
        let app_task = app.clone();
        let sid = app_session_id.clone();
        // Wall-clock lives *inside* the sibling. HTTP 15s may drop this JoinHandle
        // (detach, not abort); recovery must not depend on the caller future.
        let join = tauri::async_runtime::spawn(async move {
            match tokio::time::timeout(Duration::from_secs(CONNECT_WALL_CLOCK_SECS), async {
                let _connect_guard = mgr.connect_lock.lock().await;
                let _holder =
                    ConnectHolderGuard::enter(Arc::clone(&mgr), sid.clone(), "connect_inner");
                if !connect_attempt_still_current(
                    mgr.connect_epoch.load(std::sync::atomic::Ordering::SeqCst),
                    my_gen,
                ) {
                    return Err(format!(
                        "{}: {}",
                        crate::error::AgentErrorCode::ConnectFailed.as_str(),
                        connect_gave_up_reason(false)
                    ));
                }
                mgr.connect_inner(
                    app_task.clone(),
                    project_path,
                    sid.clone(),
                    mock_mode,
                    ssh_alias,
                )
                .await
            })
            .await
            {
                Ok(inner) => inner,
                Err(_) => {
                    mgr.reap_timed_out_connect(&app_task, sid.as_deref(), my_gen)
                        .await
                }
            }
        });

        match join.await {
            Ok(inner) => inner,
            Err(join_err) => {
                tracing::error!(error = %join_err, "connect task failed");
                Err(format!("connect task failed: {join_err}"))
            }
        }
    }

    /// Epoch bump + fail stale handshake + reap pending children.
    /// Runs on the connect sibling so a dropped HTTP waiter cannot cancel it.
    pub(super) async fn reap_timed_out_connect(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: Option<&str>,
        my_gen: u64,
    ) -> Result<SessionSnapshot, String> {
        let current = self.connect_epoch.load(std::sync::atomic::Ordering::SeqCst);
        let next = next_connect_epoch_on_timeout(current, my_gen);
        if next != current {
            self.connect_epoch
                .store(next, std::sync::atomic::Ordering::SeqCst);
        }
        tracing::warn!(
            target: "session",
            session = ?app_session_id,
            secs = CONNECT_WALL_CLOCK_SECS,
            "connect wall-clock timeout"
        );
        crate::logging::sync_diag(&format!(
            "connect wall-clock timeout session={:?} secs={}",
            app_session_id, CONNECT_WALL_CLOCK_SECS
        ));
        // Slot cleanup first: Ready/Streaming is a no-op. Then reap children
        // still in pending (never bound, or bound but still Connecting).
        let snap = self
            .fail_stale_connecting(app, app_session_id, connect_gave_up_reason(true))
            .await;
        self.sweep_pending_children().await;
        Ok(snap)
    }

    /// Outer handshake RPC budget (initialize + openSession). Smaller than
    /// wall-clock so a wedged child fails without relying on abort.
    pub(super) async fn with_handshake_budget<T, F>(fut: F) -> Result<T, AgentError>
    where
        F: std::future::Future<Output = Result<T, AgentError>>,
    {
        Self::with_handshake_budget_for(Duration::from_secs(CONNECT_HANDSHAKE_BUDGET_SECS), fut)
            .await
    }

    pub(super) async fn with_handshake_budget_for<T, F>(
        budget: Duration,
        fut: F,
    ) -> Result<T, AgentError>
    where
        F: std::future::Future<Output = Result<T, AgentError>>,
    {
        match tokio::time::timeout(budget, fut).await {
            Ok(inner) => inner,
            Err(_) => Err(AgentError::new(
                AgentErrorCode::ConnectFailed,
                format!("handshake timed out after {}s", budget.as_secs().max(1)),
            )),
        }
    }

    /// Soft-fail RPCs (set_model / set_mode) must not pin `connect_lock`.
    pub(super) async fn with_soft_rpc_budget<T, F>(fut: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T, String>>,
    {
        match tokio::time::timeout(Duration::from_secs(CONNECT_HANDSHAKE_BUDGET_SECS), fut).await {
            Ok(inner) => inner,
            Err(_) => Err(format!(
                "rpc timed out after {CONNECT_HANDSHAKE_BUDGET_SECS}s"
            )),
        }
    }

    /// Tear down an unfinished handshake (wall-clock timeout or user cancel).
    /// No-ops when the slot is already Ready / Streaming — a late timeout
    /// during post-open `set_mode` must not kill a working agent.
    pub(super) async fn fail_stale_connecting(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: Option<&str>,
        reason: &str,
    ) -> SessionSnapshot {
        let err = AgentError::new(
            AgentErrorCode::ConnectFailed,
            format!("{reason} after {CONNECT_WALL_CLOCK_SECS}s"),
        );
        let mut acps = Vec::new();
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let matches = app_session_id
                    .map(|id| s.app_session_id == id)
                    .unwrap_or(true);
                if matches && should_fail_connect_on_wall_clock(s.fsm.state()) {
                    let _ = s.fsm.connect_failed(err.clone());
                    if let Some(acp) = s.acp.take() {
                        acps.push(acp);
                    }
                }
            }
        }
        if let Some(id) = app_session_id {
            let mut bg = self.background.lock();
            if let Some(s) = bg.get_mut(id) {
                if should_fail_connect_on_wall_clock(s.fsm.state()) {
                    let _ = s.fsm.connect_failed(err);
                    if let Some(acp) = s.acp.take() {
                        acps.push(acp);
                    }
                }
            }
        }
        for acp in acps {
            Self::kill_acp_bounded(&acp).await;
        }
        let snap = self.snapshot();
        Self::emit_state(app, &snap);
        snap
    }

    pub(super) async fn connect_inner(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
        ssh_alias_explicit: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let settings = store::load_settings();
        let max_concurrent = normalize_max_concurrent(settings.max_concurrent_agents);
        self.sweep_dead_parked();
        if let Some(ref sid) = app_session_id {
            self.sweep_pending_for_session(sid).await;
        }

        // Ensure app session meta — never panic on disk/index races.
        let mut meta = if let Some(id) = app_session_id {
            if let Some(existing) = store::load_sessions_index()
                .into_iter()
                .find(|s| s.id == id)
            {
                existing
            } else {
                store::create_session(None, Some("New chat".into()), false)
                    .map_err(|e| format!("create session: {e}"))?
            }
        } else {
            store::create_session(None, Some("New chat".into()), false)
                .map_err(|e| format!("create session: {e}"))?
        };

        // Orphan / missing project_id → keep null (shows under "其他会话").
        // Clear retired system:general bindings if any slip through.
        if meta.project_id.as_deref() == Some(store::GENERAL_PROJECT_ID)
            || meta
                .project_id
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(false)
        {
            meta.project_id = None;
            let _ = store::update_session_meta(&meta);
        }

        let projects = store::load_projects();
        let bound_alias = meta.project_id.as_deref().and_then(|pid| {
            projects
                .iter()
                .find(|p| p.id == pid)
                .and_then(|p| p.ssh_alias.as_deref())
        });
        let path_hint = project_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let path_alias = path_hint.and_then(|path| {
            projects
                .iter()
                .find(|p| p.path == path)
                .and_then(|p| p.ssh_alias.as_deref())
        });
        let ssh_alias = crate::ssh_remote::pick_ssh_alias(
            ssh_alias_explicit.as_deref(),
            bound_alias,
            path_alias,
        );

        // Resolve cwd: explicit path → session's project path → general workspace.
        // Never use process cwd (Dock-launched macOS apps often have cwd `/`).
        let cwd = {
            let from_arg = project_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(std::path::PathBuf::from);
            let from_meta = meta.project_id.as_deref().and_then(|pid| {
                if pid == store::GENERAL_PROJECT_ID {
                    return None;
                }
                projects
                    .iter()
                    .find(|p| p.id == pid)
                    .map(|p| std::path::PathBuf::from(&p.path))
            });
            from_arg.or(from_meta).unwrap_or_else(|| {
                let _ = store::ensure_general_workspace_dir();
                crate::paths::general_workspace_dir()
            })
        };
        let project_path = Some(cwd.to_string_lossy().to_string());
        if meta.project_id.is_none() {
            if let Some(alias) = ssh_alias.as_deref() {
                if let Some(p) = projects.iter().find(|p| {
                    p.ssh_alias.as_deref() == Some(alias) && p.path == cwd.to_string_lossy()
                }) {
                    meta.project_id = Some(p.id.clone());
                    let _ = store::update_session_meta(&meta);
                }
            }
        }

        tracing::info!(
            target: "session",
            session = %meta.id,
            resume_agent = ?meta.agent_session_id,
            cwd = %cwd.display(),
            "connect open_start"
        );

        // Mid-turn policy / effort / proxy changes queue a respawn. If this
        // chat is now idle, drop the old process before the no-op / unpark
        // paths reuse spawn flags (P0-5 / #598).
        if self.pending_soft_respawn.lock().contains_key(&meta.id) {
            self.flush_pending_soft_respawn(&app, &meta.id).await;
        }

        // Resolve model / effort / permission / mode for this project+session scope.
        let prefs =
            store::resolve_composer_prefs(meta.project_id.as_deref(), Some(meta.id.as_str()));
        let policy = PermissionPolicy::parse(&prefs.permission_policy);
        let agent_model = if ssh_alias.is_some() {
            let m = prefs.model_id.trim();
            if m.is_empty() || crate::providers::is_custom_provider_id(m) {
                crate::providers::OFFICIAL_CATALOG_MODEL.to_string()
            } else {
                m.to_string()
            }
        } else {
            crate::providers::agent_spawn_model_id(&prefs.model_id)
        };

        // Pending CLI --fork-session: must cold-spawn so open can call session/fork.
        // Never no-op / unpark a warm process that still holds the source agent id.
        let pending_fork = meta.fork_agent_session
            && meta
                .agent_session_id
                .as_deref()
                .map(str::trim)
                .is_some_and(|s| !s.is_empty());
        if pending_fork {
            // Drop live/bg/parked shells for this App session so cold spawn can fork.
            let acp_to_kill = {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    if s.app_session_id == meta.id {
                        if Self::live_session_is_busy(s) {
                            tracing::warn!(
                                "connect fork pending but live mid-turn; deferring fork sid={}",
                                meta.id
                            );
                            // `inner` is held — never `self.snapshot()` (non-reentrant).
                            return Ok(Self::snapshot_from_live(s));
                        }
                        let process_id = s.process_id.clone();
                        let acp = s.acp.take();
                        s.needs_history_bootstrap = false;
                        s.fsm.soft_disconnect();
                        s.process_id = String::new();
                        acp.map(|client| (client, process_id))
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            let bg_acp = self
                .background
                .lock()
                .remove(&meta.id)
                .and_then(|mut bg| bg.acp.take().map(|acp| (acp, bg.process_id)));
            let parked_acp = self
                .parked
                .lock()
                .remove(&meta.id)
                .map(|p| (p.acp, p.process_id));
            for (acp, process_id) in acp_to_kill.into_iter().chain(bg_acp).chain(parked_acp) {
                if self.has_other_process_tenant(&process_id, &meta.id) {
                    tracing::info!(
                        session = %meta.id,
                        process = %process_id,
                        "pending fork detached shared ACP without killing co-tenant"
                    );
                } else {
                    Self::kill_acp_bounded(&acp).await;
                }
            }
            // Invalidate only after the busy early-return above. A deferred
            // fork must leave an in-flight prewarm producer valid; otherwise
            // its completion is rejected by the epoch check while the slot
            // remains stuck in `Spawning` forever.
            self.invalidate_prewarm_epoch();
            // Fork must not leave an ownerless prewarm child alongside the
            // forced cold-spawn process. If a prewarm is still Spawning, set
            // the slot to None; the producer checks the state before publish
            // and will kill the just-initialized child instead of resurrecting
            // a stale Ready slot.
            let prewarm_to_kill = {
                let mut pw = self.prewarm.lock();
                match std::mem::replace(&mut *pw, PrewarmState::None) {
                    PrewarmState::Ready(p) => Some(p.acp),
                    PrewarmState::Spawning { .. } | PrewarmState::None => None,
                }
            };
            if let Some(acp) = prewarm_to_kill {
                Self::kill_acp_bounded(&acp).await;
            }
            tracing::info!(
                target: "session",
                session = %meta.id,
                "connect pending fork_agent_session — forced cold spawn"
            );
        }

        // Already live on this App session with a healthy agent → no-op.
        // Includes mid-turn (streaming / open tools): never respawn or cancel.
        // Never no-op on Disconnected/Idle — leftover busy flags after fail_with
        // must not block reconnect (see `should_preserve_live_process`).
        if !pending_fork {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == meta.id && s.acp.as_ref().is_some_and(|c| c.is_alive()) {
                    let preserve = Self::should_preserve_live_process(s);
                    let ready_match = matches!(s.fsm.state(), SessionState::Ready)
                        && !Self::live_session_is_busy(s)
                        && s.project_path == project_path
                        && s.effort.as_deref() == Some(prefs.effort.as_str());
                    if preserve || ready_match {
                        Self::touch_activity_locked(s);
                        tracing::info!(
                            "acp connect no-op: already live session={} state={:?} busy={} preserve={}",
                            meta.id,
                            s.fsm.state(),
                            Self::live_session_is_busy(s),
                            preserve
                        );
                        // `inner` is held — never `self.snapshot()` (non-reentrant).
                        return Ok(Self::snapshot_from_live(s));
                    }
                }
            }
        }

        // Target already streaming in background → promote to focus.
        if !pending_fork && self.background.lock().contains_key(&meta.id) {
            if let Err(e) = self.try_park_live_emit(&app) {
                Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                return Err(format!("{}: {}", e.code.as_str(), e.message));
            }
            // Lock discipline: promote helper releases `background` before it
            // takes `inner` (the old inline if-let held both — ABBA deadlock
            // against try_park_live's inner→background order).
            if self.promote_background_to_live(&meta.id) {
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                tracing::info!("acp promoted background session to live sid={}", meta.id);
                return Ok(snap);
            }
        }

        // Target already parked (warm multi-session) → unpark.
        if !pending_fork && self.parked.lock().contains_key(&meta.id) {
            // Park current live if needed (busy → demote to background / park).
            if let Err(e) = self.try_park_live_emit(&app) {
                Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                return Err(format!("{}: {}", e.code.as_str(), e.message));
            }
            if let Some(live) = self.unpark_to_live(&meta.id) {
                // Spawn flags are process-level. Effort / policy mismatch
                // cannot be hot-patched — kill and fall through to cold spawn.
                let effort_ok = live.effort.as_deref() == Some(prefs.effort.as_str());
                let policy_ok = live.policy == policy;
                if !effort_ok || !policy_ok {
                    tracing::info!(
                        session = %meta.id,
                        parked_effort = ?live.effort,
                        want_effort = %prefs.effort,
                        parked_policy = ?live.policy,
                        "unpark spawn-flag mismatch — cold spawn"
                    );
                    if let Some(acp) = live.acp {
                        let shared_with_other =
                            self.has_other_process_tenant(&live.process_id, &meta.id);
                        if !shared_with_other {
                            Self::kill_acp_bounded(&acp).await;
                        } else {
                            tracing::info!(
                                session = %meta.id,
                                process = %live.process_id,
                                "unpark spawn-flag mismatch — skip kill, mid-turn cohabitant"
                            );
                        }
                    }
                } else {
                    // Refresh prefs on shell (model may have changed in UI).
                    let mut live = live;
                    live.model_id = Some(prefs.model_id.clone());
                    live.effort = Some(prefs.effort.clone());
                    live.product_mode = Some(prefs.mode.clone());
                    live.policy = policy;
                    live.project_path = project_path.clone();
                    live.meta.model_id = Some(prefs.model_id.clone());
                    live.meta.mode = Some(prefs.mode.clone());
                    live.meta.effort = Some(prefs.effort.clone());
                    live.meta.permission_policy = Some(prefs.permission_policy.clone());
                    // Best-effort align agent process to channel prefs. Target the
                    // session explicitly — on a shared process the "recently bound"
                    // agent session id may belong to another App session.
                    if let Some(acp) = live.acp.clone() {
                        if let Some(sid) = live.meta.agent_session_id.clone() {
                            if let Err(e) =
                                Self::with_soft_rpc_budget(acp.set_model_for(&sid, &agent_model))
                                    .await
                            {
                                tracing::warn!("acp set_model on unpark soft-fail: {e}");
                            }
                            if let Err(e) =
                                Self::with_soft_rpc_budget(acp.set_mode_for(&sid, &prefs.mode))
                                    .await
                            {
                                tracing::warn!("acp set_mode on unpark soft-fail: {e}");
                            }
                        }
                    }
                    *self.inner.lock() = Some(live);
                    let snap = self.snapshot();
                    Self::emit_state(&app, &snap);
                    tracing::info!("acp unparked warm session={}", meta.id);
                    return Ok(snap);
                }
            }
            // Parked process died — fall through to cold spawn.
        }

        // Multi-session: never steal another App session's process (no same-cwd
        // rebind). Each chat keeps its own ACP child — park Ready / background
        // busy, then unpark or cold-spawn for the target.
        {
            let live_sid = self.inner.lock().as_ref().map(|s| s.app_session_id.clone());
            if live_sid.as_deref() != Some(meta.id.as_str()) {
                if let Err(e) = self.try_park_live_emit(&app) {
                    Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                    return Err(format!("{}: {}", e.code.as_str(), e.message));
                }
                // Never Drop a shell that still holds a live ACP — re-park/demote.
                {
                    let still_busy = self.inner.lock().as_ref().is_some_and(|s| {
                        s.acp.as_ref().is_some_and(|c| c.is_alive())
                            && (Self::live_session_is_busy(s)
                                || matches!(s.fsm.state(), SessionState::Ready))
                    });
                    if still_busy {
                        // try_park should have moved it; force another demote/park.
                        let _ = self.try_park_live();
                    }
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_ref() {
                        // Only drop empty / dead shells (no acp).
                        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
                            let _ = guard.take();
                        } else if s.app_session_id != meta.id {
                            // Safety: never leave a foreign session in live when connecting.
                            drop(guard);
                            let _ = self.try_park_live();
                        }
                    }
                }
            } else {
                // Same session reconnect / flag change — kill any leftover process.
                // Mid-turn preserves the process (no-op above). Terminal Disconnected
                // with leftover busy flags must still tear down so the next spawn works.
                let leftover = {
                    let mut guard = self.inner.lock();
                    let preserve = guard
                        .as_ref()
                        .is_some_and(Self::should_preserve_live_process);
                    if preserve {
                        None
                    } else {
                        guard.take().and_then(|mut s| s.acp.take())
                    }
                };
                if let Some(acp) = leftover {
                    Self::kill_acp_bounded(&acp).await;
                }
            }
            Self::emit_state(&app, &self.snapshot());
        }

        // Independent GROK_HOME: push permission into agent config before spawn so
        // dontAsk / acceptEdits / YOLO apply agent-side (not only Host).
        if let Err(e) = crate::agent_prefs::sync_permission_to_agent_profile(
            &settings.session_data_mode,
            &prefs.permission_policy,
        ) {
            tracing::warn!("sync agent permission prefs: {e}");
        }

        // Fresh process id per connect (each App session owns its ACP child).
        let process_id = Uuid::new_v4().to_string();
        {
            let mut fsm = SessionFsm::new();
            fsm.start_connect().map_err(|e| e.to_string())?;
            let now = Instant::now();
            *self.inner.lock() = Some(LiveSession {
                app_session_id: meta.id.clone(),
                process_id: process_id.clone(),
                meta: meta.clone(),
                fsm,
                backend: Self::backend_name(),
                acp: None,
                mock_stream: None,
                streaming_message_id: None,
                active_turn_id: None,
                stream_message_id_locked: false,
                stream_buf: String::new(),
                stream_thought: String::new(),
                stream_last_was_assistant: false,
                stream_attachments: Vec::new(),
                model_id: Some(prefs.model_id.clone()),
                effort: Some(prefs.effort.clone()),
                product_mode: Some(prefs.mode.clone()),
                project_path: project_path.clone(),
                allow_cache: SessionAllowCache::default(),
                policy,
                provider_retry_attempt: 0,
                provider_retry_aborted: false,
                needs_history_bootstrap: false,
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
            });
        }
        Self::emit_state(&app, &self.snapshot());

        let use_mock = AcpClient::use_mock()
            || mock_mode.as_deref() == Some("mock")
            || mock_mode.as_deref() == Some("fail_cli_not_found");

        if use_mock {
            return self.connect_mock(app, mock_mode).await;
        }

        // Remember prior agent session for resume (before we overwrite meta).
        let resume_agent_sid = meta.agent_session_id.clone();
        let journal_has_history = store::load_messages(&meta.id).iter().any(|m| {
            (m.role == "user" || m.role == "assistant")
                && !m.content.trim().is_empty()
                && !m.is_error
        });

        // ── Warm-process reuse (per-route pool) ────────────────────────────
        // Only an ownerless prewarm process with identical process-level
        // spawn flags (permission / effort / sandbox / route) may cross an
        // App-session boundary. Session-bound parked/background ACPs stay
        // attached to their owner; sharing an Arc across sessions lets
        // unstamped load replay and process-level kill paths corrupt or abort
        // a co-tenant.
        //
        // #986: when the process OS sandbox is not `off`, spawn cwd is the
        // Seatbelt/Landlock write root for the process lifetime. Prewarm
        // always starts in `workspaces/general` — never reuse it for a
        // project-bound session (open_session_at cannot widen the sandbox).
        if !pending_fork && ssh_alias.is_none() {
            let eff_sandbox = {
                let project_sandbox = meta.project_id.as_deref().and_then(|pid| {
                    store::load_projects()
                        .into_iter()
                        .find(|p| p.id == pid)
                        .and_then(|p| p.sandbox_profile)
                });
                store::resolve_sandbox_profile(
                    &settings.sandbox_profile,
                    project_sandbox.as_deref(),
                )
            };
            let mut stale_prewarm: Vec<Arc<AcpClient>> = Vec::new();
            let reused = {
                // Only an ownerless prewarm process may cross a session boundary.
                // Mid-turn background keeps exclusive ownership of its process
                // so session/load on a peer cannot poison that journal.
                // Route class must follow active_route(), not prefs.model_id.
                // Custom channels store the *upstream* model in session prefs
                // (e.g. deepseek-v4-flash), which is_custom_provider_id rejects
                // — processes were mis-labeled official and reused after
                // auth.json was stripped (#528 intermittent re-login).
                // Only the ownerless prewarm process is eligible for reuse.
                // Session-bound ACP processes stay with their App session.
                let target_custom = matches!(
                    crate::providers::active_route(),
                    crate::providers::ActiveRoute::Custom { .. }
                );
                let gate = |alive: bool,
                            p_policy: PermissionPolicy,
                            p_effort: Option<&str>,
                            p_sandbox: Option<&str>,
                            p_custom: bool| {
                    Self::reuse_gate(
                        alive,
                        p_policy,
                        p_effort,
                        p_sandbox,
                        p_custom,
                        policy,
                        &prefs.effort,
                        &eff_sandbox,
                        target_custom,
                    )
                };
                let mut best: Option<(Arc<AcpClient>, String, Instant)> = None;
                // Diagnostics: why reuse misses (only logged when nothing matches).
                let mut rejected: Vec<String> = Vec::new();
                let reject_reason = |alive: bool,
                                     p_policy: PermissionPolicy,
                                     p_effort: Option<&str>,
                                     p_sandbox: Option<&str>,
                                     p_custom: bool| {
                    let mut parts = Vec::new();
                    if !alive {
                        parts.push("dead".into());
                    }
                    if p_policy != policy {
                        parts.push(format!("policy {}≠{}", p_policy.as_str(), policy.as_str()));
                    }
                    if p_effort != Some(prefs.effort.as_str()) {
                        parts.push(format!(
                            "effort {:?}≠{:?}",
                            p_effort,
                            Some(prefs.effort.as_str())
                        ));
                    }
                    if p_sandbox.unwrap_or("off") != eff_sandbox.as_str() {
                        parts.push(format!(
                            "sandbox {:?}≠{:?}",
                            p_sandbox.unwrap_or("off"),
                            eff_sandbox
                        ));
                    }
                    if p_custom != target_custom {
                        parts.push(format!("route custom={p_custom}≠{target_custom}"));
                    }
                    if parts.is_empty() {
                        parts.push("?".into());
                    }
                    parts.join(", ")
                };
                // Prewarm is the freshest candidate — purpose-built for the next
                // chat. Consume it first (matches are exclusive to this connect).
                // A Spawning prewarm (detach swapped in a fresh process) is
                // awaited briefly — its CLI has no accumulated actors, so the
                // session/load that follows is fast instead of the CLI's 5s
                // old-thread drain.
                let prewarm_wait_deadline =
                    std::time::Instant::now() + std::time::Duration::from_millis(2500);
                loop {
                    let taken = {
                        let mut pw = self.prewarm.lock();
                        match std::mem::replace(&mut *pw, PrewarmState::None) {
                            PrewarmState::Ready(p) => {
                                let process_cwd = p.acp.cwd().to_string_lossy();
                                let target_cwd = cwd.to_string_lossy();
                                if !Self::reuse_sandbox_cwd_ok(
                                    p.sandbox_profile.as_deref(),
                                    process_cwd.as_ref(),
                                    target_cwd.as_ref(),
                                ) {
                                    // Keep the general-workspace prewarm for a
                                    // later unbound chat; only cold-spawn this
                                    // project session (#986).
                                    rejected.push(format!(
                                        "prewarm: sandbox cwd {process_cwd}≠{target_cwd}"
                                    ));
                                    *pw = PrewarmState::Ready(p);
                                    None
                                } else if gate(
                                    p.acp.is_alive(),
                                    p.policy,
                                    p.effort.as_deref(),
                                    p.sandbox_profile.as_deref(),
                                    p.acp.is_custom_route(),
                                ) {
                                    Some((p.acp, p.process_id, p.created_at))
                                } else {
                                    // `PrewarmState::Ready` is ownerless, so
                                    // a gate mismatch cannot be handed back to
                                    // another session. Drop and explicitly
                                    // kill it after leaving the map lock; an
                                    // Arc/Child drop alone does not terminate
                                    // the CLI process.
                                    stale_prewarm.push(p.acp.clone());
                                    rejected.push(format!(
                                        "prewarm: {}",
                                        reject_reason(
                                            p.acp.is_alive(),
                                            p.policy,
                                            p.effort.as_deref(),
                                            p.sandbox_profile.as_deref(),
                                            p.acp.is_custom_route(),
                                        )
                                    ));
                                    None
                                }
                            }
                            PrewarmState::Spawning { since }
                                if since.elapsed() < std::time::Duration::from_millis(2500) =>
                            {
                                *pw = PrewarmState::Spawning { since };
                                None
                            }
                            other => {
                                *pw = other;
                                None
                            }
                        }
                    };
                    if let Some((acp, pid, at)) = taken {
                        best = Some((acp, pid, at));
                        break;
                    }
                    let still_spawning =
                        matches!(*self.prewarm.lock(), PrewarmState::Spawning { .. });
                    if !still_spawning || std::time::Instant::now() >= prewarm_wait_deadline {
                        break;
                    }
                    // Brief yield so the prewarm task can progress (it spawns
                    // outside connect_lock, so this cannot deadlock).
                    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
                }
                // A session-bound ACP process is never transferred to another
                // App session. The old parked/background reuse path shared an
                // `Arc<AcpClient>` while leaving the original owner registered;
                // capacity and event routing could then kill or apply events to
                // the wrong tenant. Only the ownerless prewarm process above is
                // eligible for reuse. The target session is opened on a fresh
                // process once its own parked entry is no longer focused.
                if best.is_none() && !rejected.is_empty() {
                    tracing::warn!(
                        target: "session",
                        session = %meta.id,
                        target_policy = %policy.as_str(),
                        target_effort = %prefs.effort,
                        target_sandbox = %eff_sandbox,
                        target_custom_route = target_custom,
                        "connect reuse rejected (cold spawn): {}",
                        rejected.join(" | ")
                    );
                }
                best.map(|(acp, pid, _)| (acp, pid))
            };
            for acp in stale_prewarm {
                Self::kill_acp_bounded(&acp).await;
            }
            if let Some((acp, reused_process)) = reused {
                tracing::info!(
                    target: "session",
                    session = %meta.id,
                    reused_process = %reused_process,
                    "connect prewarm reuse (ownerless process, no cross-session sharing)"
                );
                // #528: warm reuse skips cold spawn (no prepare_route_auth).
                // Re-apply route auth so official OIDC is on disk after any
                // intervening custom-route clear, and nested tools see keys.
                crate::providers::prepare_route_auth_for_agent();
                // P0: bind the live shell to the reused process *before*
                // session/load. Load replays stream/tool notifications while
                // open awaits; if live still held a temporary process_id,
                // unstamped process traffic used to rescue the parked
                // co-tenant with prompt_in_flight=true and corrupt its journal.
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        s.acp = Some(acp.clone());
                        s.process_id = reused_process.clone();
                        if let Some(ref rid) = resume_agent_sid {
                            let t = rid.trim();
                            if !t.is_empty() {
                                s.meta.agent_session_id = Some(t.to_string());
                            }
                        }
                        // Connect is not a user turn — load replay must drop.
                        s.prompt_in_flight = false;
                        s.model_id = Some(prefs.model_id.clone());
                        s.effort = Some(prefs.effort.clone());
                        s.product_mode = Some(prefs.mode.clone());
                        s.policy = policy;
                        s.project_path = project_path.clone();
                        Self::touch_activity_locked(s);
                    }
                }
                let cwd_str = cwd.to_string_lossy().to_string();
                let open_result = Self::with_handshake_budget(acp.open_session_at(
                    resume_agent_sid.as_deref(),
                    false,
                    &cwd_str,
                ))
                .await;
                match open_result {
                    Ok((agent_sid, resumed)) => {
                        let need_bootstrap = !resumed && journal_has_history;
                        {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                let _ = s.fsm.handshake_ok();
                                s.acp = Some(acp);
                                s.process_id = reused_process;
                                s.meta.agent_session_id = Some(agent_sid.clone());
                                s.model_id = Some(prefs.model_id.clone());
                                s.effort = Some(prefs.effort.clone());
                                s.product_mode = Some(prefs.mode.clone());
                                s.policy = policy;
                                s.project_path = project_path.clone();
                                s.needs_history_bootstrap = need_bootstrap;
                                s.prompt_in_flight = false;
                                Self::touch_activity_locked(s);
                                meta = s.meta.clone();
                            }
                        }
                        let _ = store::update_session_meta(&meta);
                        let snap = self.snapshot();
                        Self::emit_state(&app, &snap);
                        tracing::info!(
                            target: "session",
                            session = %meta.id,
                            agent = %agent_sid,
                            resumed,
                            "connect warm-reuse ok"
                        );
                        emit_host_exit_heal(&app, &meta.id);
                        // Refresh the prewarm slot with a FRESH process: the
                        // one we just consumed now hosts this session's actor,
                        // and the CLI has no public unload API — a second load
                        // of the same session on that process would wait the
                        // 5s old-thread drain. A clean process keeps every
                        // session/load fast.
                        {
                            let mgr = Arc::clone(self);
                            let app2 = app.clone();
                            tokio::spawn(async move {
                                mgr.prewarm_force(app2).await;
                            });
                        }
                        return Ok(snap);
                    }
                    Err(e) => {
                        // Reuse failed (session id lost / process wedged):
                        // detach our early bind, then kill and fall through
                        // to the cold spawn path.
                        {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                if s.process_id == reused_process {
                                    s.acp = None;
                                    // Restore the connect-local process id so the
                                    // cold path event pump tags match this shell.
                                    s.process_id = process_id.clone();
                                }
                            }
                        }
                        tracing::warn!(
                            target: "session",
                            session = %meta.id,
                            error = %e.message,
                            "connect warm-reuse open_session failed; cold spawn"
                        );
                        Self::kill_acp_bounded(&acp).await;
                    }
                }
            }
        }

        // Capacity: reclaim idle parked first (they fill the pool when browsing
        // chats). Never kill background-busy turns. Live shell has no acp yet.
        self.reclaim_parked_until_can_spawn(&app, max_concurrent)
            .await;
        let active = self.active_process_count();
        let busy = self.busy_process_count();
        if !can_spawn_process(active, max_concurrent) {
            tracing::warn!(
                "process limit: cannot spawn session={} active={} busy={} parked={} max={}",
                meta.id,
                active,
                busy,
                self.parked.lock().len(),
                max_concurrent
            );
            let err = AgentError::new(
                AgentErrorCode::ProcessLimit,
                process_limit_message(max_concurrent),
            );
            {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    let _ = s.fsm.connect_failed(err.clone());
                }
            }
            Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
            let snap = self.snapshot();
            Self::emit_state(&app, &snap);
            return Ok(snap);
        }

        // Real ACP cold spawn (one process per App session — no cross-session rebind).
        // WSL backend probes inside the distro (a WSL-only install has no native grok.exe).
        // SSH: grok lives on the host — do not require a local binary.
        // A remote path that is not a local directory must never hit local spawn
        // (ENOENT was mislabeled CLI_NOT_FOUND).
        if ssh_alias.is_none()
            && !crate::ssh_remote::local_acp_cwd_ok(None, cwd.to_string_lossy().as_ref())
        {
            {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    let _ = s.fsm.connect_failed(AgentError::new(
                        AgentErrorCode::ConnectFailed,
                        "This folder is not on this computer. Open it from the SSH host list.",
                    ));
                }
            }
            let snap = self.snapshot();
            Self::emit_state(&app, &snap);
            return Ok(snap);
        }
        let cli_path = if ssh_alias.is_some() {
            std::path::PathBuf::from("grok")
        } else {
            let probe = crate::wsl_backend::probe_cli_for_settings(
                &settings,
                settings.manual_cli_path.as_deref(),
            );
            if !probe.found {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(AgentError::new(
                            AgentErrorCode::CliNotFound,
                            "Grok Build CLI not found. Install Grok Build or set path in Settings.",
                        ));
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                return Ok(snap);
            }
            std::path::PathBuf::from(probe.path.unwrap())
        };
        // Effective sandbox: project override > app Settings (affects --sandbox / GROK_SANDBOX).
        let project_sandbox = meta.project_id.as_deref().and_then(|pid| {
            store::load_projects()
                .into_iter()
                .find(|p| p.id == pid)
                .and_then(|p| p.sandbox_profile)
        });
        let effective_sandbox =
            store::resolve_sandbox_profile(&settings.sandbox_profile, project_sandbox.as_deref());
        // One-shot CLI --fork-session: only when meta asks and we have a source id.
        let fork_agent = meta.fork_agent_session
            && resume_agent_sid
                .as_deref()
                .map(str::trim)
                .is_some_and(|s| !s.is_empty());
        let spawn_opts = crate::acp_client::SpawnOptions {
            model_id: Some(agent_model.clone()),
            effort: Some(prefs.effort.clone()),
            permission_policy: Some(prefs.permission_policy.clone()),
            product_mode: Some(prefs.mode.clone()),
            sandbox_profile: Some(effective_sandbox),
            json_schema: meta
                .json_schema
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            plugin_dirs: if ssh_alias.is_some() {
                Vec::new()
            } else {
                meta.plugin_dirs.clone()
            },
            extra_rules: if ssh_alias.is_some() {
                meta.extra_rules
                    .as_ref()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                crate::official_aux::merge_extra_rules(
                    meta.extra_rules
                        .as_ref()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty()),
                )
            },
            max_agent_turns: meta.max_agent_turns,
            system_prompt_override: meta
                .system_prompt_override
                .as_ref()
                .map(|s| s.to_string())
                .and_then(|s| crate::store::sanitize_system_prompt_override(Some(s))),
            no_ask_user: meta.no_ask_user,
            fork_session: fork_agent,
            grok_home_override: None,
            empty_mcp_servers: false,
            ssh_alias: ssh_alias.clone(),
        };

        let cwd_str = cwd.to_string_lossy().to_string();
        let spawn_result = tokio::time::timeout(
            Duration::from_secs(CONNECT_HANDSHAKE_BUDGET_SECS),
            AcpClient::spawn_with_options(cli_path, cwd, spawn_opts),
        )
        .await;
        let (client, mut events) = match spawn_result {
            Ok(Ok(v)) => {
                tracing::info!(
                    target: "session",
                    session = %meta.id,
                    process = %process_id,
                    fork_session = fork_agent,
                    "connect spawn_ok"
                );
                v
            }
            Ok(Err(e)) => {
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect spawn_fail"
                );
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(e);
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                return Ok(snap);
            }
            Err(_) => {
                let e = AgentError::new(
                    AgentErrorCode::ConnectFailed,
                    format!("spawn timed out after {CONNECT_HANDSHAKE_BUDGET_SECS}s"),
                );
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect spawn_fail"
                );
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(e);
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                return Ok(snap);
            }
        };
        self.register_pending_child(PendingAcpChild {
            session_id: Some(meta.id.clone()),
            process_id: process_id.clone(),
            acp: client.clone(),
        });

        // Event pump tagged with process_id (multi-process routing). Events
        // carry the CLI's owning sessionId when known so a reused process
        // never cross-routes another session's stream into the live chat.
        {
            let mgr = Arc::clone(self);
            let app_ev = app.clone();
            let pid = process_id.clone();
            tokio::spawn(async move {
                while let Some((sid, ev)) = events.recv().await {
                    mgr.handle_acp_event(&app_ev, &pid, sid.as_deref(), ev)
                        .await;
                }
            });
        }

        // Bind ACP before initialize so Stop / wall-clock abort can kill a
        // hung handshake (otherwise LiveSession.acp is None until Ready).
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == meta.id {
                    s.acp = Some(client.clone());
                    s.process_id = process_id.clone();
                }
            }
        }

        tracing::info!(
            target: "session",
            session = %meta.id,
            resume_agent = ?resume_agent_sid,
            fork_session = fork_agent,
            "connect session_open_begin"
        );
        let rewind_index = meta.fork_rewind_prompt_index;
        let open_result = Self::with_handshake_budget(
            client.initialize_and_open_session(resume_agent_sid.as_deref(), fork_agent),
        )
        .await;

        match open_result {
            Ok((mut agent_sid, resumed)) => {
                let plan = child_trim_plan(rewind_index, resumed);
                let mut rewind_ok: Option<bool> = None;
                let mut need_bootstrap = !resumed && journal_has_history;
                let mut skip_set_mode = fork_agent && matches!(plan, ChildTrimPlan::Skip);

                match plan {
                    ChildTrimPlan::RewindChild { prompt_index } => {
                        // Post-open RPC, so it runs outside `with_handshake_budget`
                        // while `connect_lock` is still held. Unbounded, it pinned
                        // the lock for the handshake *plus* the rewind probe chain,
                        // stalling every other chat's send/connect behind one fork.
                        match Self::with_soft_rpc_budget(client.rewind_execute_for(
                            &agent_sid,
                            prompt_index,
                            false,
                        ))
                        .await
                        {
                            Ok(_) => {
                                rewind_ok = Some(true);
                                need_bootstrap = false;
                                skip_set_mode = true;
                                tracing::info!(
                                    target: "session",
                                    session = %meta.id,
                                    agent = %agent_sid,
                                    prompt_index,
                                    "connect child rewind ok (memory matches cut journal)"
                                );
                            }
                            Err(e) => {
                                rewind_ok = Some(false);
                                tracing::warn!(
                                    target: "session",
                                    session = %meta.id,
                                    agent = %agent_sid,
                                    prompt_index,
                                    error = %e,
                                    "child rewind failed; will not keep untrimmed fork"
                                );
                                let fail_safe =
                                    apply_child_rewind_fail_safe(&meta.id, prompt_index);
                                match &fail_safe {
                                    Ok(fs) => tracing::info!(
                                        target: "session",
                                        session = %meta.id,
                                        prompt_index,
                                        before = fs.before_len,
                                        after = fs.after_len,
                                        persisted = fs.persisted,
                                        need_bootstrap = fs.need_bootstrap,
                                        "rewind-fail child journal re-cut before session/new"
                                    ),
                                    Err(trim_err) => tracing::warn!(
                                        target: "session",
                                        session = %meta.id,
                                        prompt_index,
                                        error = %trim_err,
                                        "rewind-fail child journal re-cut failed; refusing bootstrap"
                                    ),
                                }
                                match Self::with_handshake_budget(
                                    client.open_session_at(None, false, &cwd_str),
                                )
                                .await
                                {
                                    Ok((new_sid, _)) => {
                                        agent_sid = new_sid;
                                        need_bootstrap =
                                            fail_safe.map(|fs| fs.need_bootstrap).unwrap_or(false);
                                        skip_set_mode = false;
                                    }
                                    Err(new_err) => {
                                        tracing::warn!(
                                            target: "session",
                                            session = %meta.id,
                                            error = %new_err.message,
                                            "session/new after failed child rewind also failed"
                                        );
                                        Self::kill_acp_bounded(&client).await;
                                        self.unregister_pending_child(&process_id);
                                        if meta.fork_agent_session {
                                            let _ = store::clear_session_fork_after_connect_failure(
                                                &meta.id,
                                            );
                                        }
                                        {
                                            let mut guard = self.inner.lock();
                                            if let Some(s) = guard.as_mut() {
                                                let _ = s.fsm.connect_failed(new_err);
                                            }
                                        }
                                        let snap = self.snapshot();
                                        Self::emit_state(&app, &snap);
                                        return Ok(snap);
                                    }
                                }
                            }
                        }
                    }
                    ChildTrimPlan::Bootstrap => {
                        need_bootstrap = journal_has_history;
                        skip_set_mode = false;
                    }
                    ChildTrimPlan::Skip => {}
                }

                if let Some(outcome) = fork_trimmed_outcome(plan, rewind_ok) {
                    let _ = app.emit(
                        "session://fork_trimmed",
                        serde_json::json!({
                            "sessionId": meta.id,
                            "outcome": outcome,
                        }),
                    );
                }

                // Native resume / successful fork = full agent context. Fresh
                // session + existing UI journal → bootstrap history into the next prompt.
                if resumed && rewind_ok != Some(false) {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        forked = fork_agent,
                        "connect session_open_ok resumed=true (full context)"
                    );
                } else if need_bootstrap {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        "connect session_open_ok resumed=false; will bootstrap journal on first send"
                    );
                } else {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        "connect session_open_ok resumed=false"
                    );
                }
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.handshake_ok();
                        s.acp = Some(client.clone());
                        s.process_id = process_id.clone();
                        s.meta.agent_session_id = Some(agent_sid);
                        s.meta.fork_agent_session = false;
                        s.meta.fork_rewind_prompt_index = None;
                        s.meta.model_id = Some(prefs.model_id.clone());
                        s.meta.mode = Some(prefs.mode.clone());
                        s.meta.effort = Some(prefs.effort.clone());
                        s.meta.permission_policy = Some(prefs.permission_policy.clone());
                        s.model_id = Some(prefs.model_id.clone());
                        s.effort = Some(prefs.effort.clone());
                        s.product_mode = Some(prefs.mode.clone());
                        s.backend = "grok_agent_stdio".into();
                        s.needs_history_bootstrap = need_bootstrap;
                        Self::touch_activity_locked(s);
                        meta = s.meta.clone();
                    }
                }
                let _ = store::update_session_meta(&meta);
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                // Child is live/Ready — drop it from the abort-reap list before
                // set_mode so a wall-clock sweep cannot kill a working agent.
                self.unregister_pending_child(&process_id);
                // Nudge mode *after* Ready so a slow/failed set_mode cannot pin
                // the pill on 连接中. Successful fork already inherited parent mode.
                if skip_set_mode {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        "connect skip set_mode after fork (parent mode already applied)"
                    );
                } else if let Err(e) =
                    Self::with_soft_rpc_budget(client.set_mode(&prefs.mode)).await
                {
                    tracing::warn!("acp set_mode after session open soft-fail: {e}");
                }
                emit_host_exit_heal(&app, &meta.id);
                Ok(self.snapshot())
            }
            Err(e) => {
                // Failed open must drop the one-shot so the next connect does
                // not retry session/fork forever. Success clears via live meta.
                if meta.fork_agent_session {
                    let _ = store::clear_session_fork_after_connect_failure(&meta.id);
                }
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect session_open_fail"
                );
                Self::kill_acp_bounded(&client).await;
                self.unregister_pending_child(&process_id);
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(e);
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
        }
    }

    pub(super) async fn connect_mock(
        self: &Arc<Self>,
        app: AppHandle,
        mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let mode = match mode.as_deref() {
            Some("fail_cli_not_found") => MockConnectMode::FailCliNotFound,
            _ => MockConnectMode::Success,
        };
        tokio::time::sleep(Duration::from_millis(80)).await;
        match mode {
            MockConnectMode::Success => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.handshake_ok();
                        s.backend = "mock_acp".into();
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
            MockConnectMode::FailCliNotFound => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(AgentError::new(
                            AgentErrorCode::CliNotFound,
                            "Mock: CLI not found (GROK_APP_ACP=mock demo)",
                        ));
                        s.backend = "mock_acp".into();
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
        }
    }

    /// Legacy helper: move a parked agent into `background`.
    ///
    /// **Must not** be used to apply turn events. Parked is always idle Ready;
    /// rescuing with `prompt_in_flight=true` caused P0 cross-session journal
    /// corruption when another chat's `session/load` ran on the shared process.
    /// Event routing now **drops** parked/unstamped load traffic instead
    /// (`resolve_turn_event_route`). Kept for diagnostics / rare recovery only
    /// and always sets `prompt_in_flight=false` so apply gates drop replay.
    #[allow(dead_code)]
    pub(super) fn rescue_parked_to_background(&self, process_id: &str) -> Option<String> {
        let key = {
            let parked = self.parked.lock();
            parked
                .iter()
                .find(|(_, p)| p.process_id == process_id)
                .map(|(k, _)| k.clone())
        }?;
        let p = self.parked.lock().remove(&key)?;
        tracing::warn!(
            "acp rescue: parked session → background (idle; prompt_in_flight=false) sid={} process={}",
            p.app_session_id,
            p.process_id
        );
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        let live = LiveSession {
            app_session_id: p.app_session_id.clone(),
            process_id: p.process_id,
            meta: p.meta,
            fsm,
            backend: p.backend,
            acp: Some(p.acp),
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: p.model_id,
            effort: p.effort,
            product_mode: p.product_mode,
            project_path: p.project_path,
            allow_cache: SessionAllowCache::default(),
            policy: p.policy,
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: p.needs_history_bootstrap,
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
            // Never invent a mid-turn: load/orphan must hit the replay gate.
            prompt_in_flight: false,
            sent_prompt_this_visit: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        };
        let sid = live.app_session_id.clone();
        self.background.lock().insert(sid.clone(), live);
        Some(sid)
    }

    /// Short event name for diagnostics (no payload — journals stay readable).
    /// Prewarm a CLI process while the user is composing a new chat: spawn +
    /// initialize + auth only — NO session. Spawn cwd is always the App
    /// default workspace (`workspaces/general`).
    ///
    /// Connect reuses this process only when process-level flags match **and**
    /// (when OS sandbox ≠ `off`) the session cwd matches that spawn cwd.
    /// Project-bound chats with `workspace` sandbox always cold-spawn so
    /// Seatbelt/Landlock write roots cover the project (#986).
    ///
    /// Idempotent: skips when a prewarm already lives, or when any warm
    /// process already exists (parked / background covers connect). Uses the
    /// global/default channel prefs — if the submitted session differs in
    /// policy/effort/sandbox/route/cwd, connect falls back to a cold spawn.
    ///
    /// `force` kills any current prewarm first (detach uses it to swap in a
    /// fresh process whose CLI has no accumulated session actors, so the next
    /// `session/load` does not wait the CLI's 5s old-thread drain).
    pub async fn prewarm(self: &Arc<Self>, app: AppHandle) {
        self.prewarm_inner(app, false).await;
    }

    pub async fn prewarm_force(self: &Arc<Self>, app: AppHandle) {
        self.prewarm_inner(app, true).await;
    }

    fn clear_prewarm_if_current(&self, epoch: u64) {
        let mut pw = self.prewarm.lock();
        if self.prewarm_epoch.load(std::sync::atomic::Ordering::SeqCst) == epoch
            && matches!(*pw, PrewarmState::Spawning { .. })
        {
            *pw = PrewarmState::None;
        }
    }

    async fn prewarm_inner(self: &Arc<Self>, app: AppHandle, force: bool) {
        // Quick gate (no connect_lock — connect may be awaiting a Spawning
        // prewarm; grabbing the lock here would deadlock it). The prewarm
        // Mutex serializes concurrent prewarm calls.
        let epoch = {
            let mut pw = self.prewarm.lock();
            match &*pw {
                PrewarmState::Spawning { .. } => return,
                PrewarmState::Ready(p) if p.acp.is_alive() && !force => return,
                _ => {}
            }
            let epoch = self
                .prewarm_epoch
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                .saturating_add(1);
            if force {
                // Retire the old prewarm process (async kill) — otherwise
                // every refresh leaks a CLI process.
                if let PrewarmState::Ready(p) = std::mem::replace(
                    &mut *pw,
                    PrewarmState::Spawning {
                        since: Instant::now(),
                    },
                ) {
                    tokio::spawn(async move {
                        SessionManager::kill_acp_bounded(&p.acp).await;
                    });
                }
            } else {
                // Any warm process already covers connect — don't spawn a second.
                if self.parked.lock().values().any(|p| p.acp.is_alive())
                    || self
                        .background
                        .lock()
                        .values()
                        .any(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
                    || self
                        .inner
                        .lock()
                        .as_ref()
                        .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
                {
                    return;
                }
                *pw = PrewarmState::Spawning {
                    since: Instant::now(),
                };
            }
            epoch
        };

        let settings = store::load_settings();
        // WSL backend probes inside the distro (a WSL-only install has no native grok.exe).
        let probe = crate::wsl_backend::probe_cli_for_settings(
            &settings,
            settings.manual_cli_path.as_deref(),
        );
        let Some(cli_path) = probe.path else {
            self.clear_prewarm_if_current(epoch);
            return;
        };
        let cli_path = std::path::PathBuf::from(cli_path);
        // Most likely config for the next chat = the most recently used session's
        // prefs (users keep policy/effort stable across chats). Falls back to
        // the global defaults when no session exists yet. A global-default
        // prewarm (policy=ask) never matched this user's always-approve(YOLO)
        // sessions, so connect cold-spawned every time.
        let last_sid = store::load_sessions_index()
            .into_iter()
            .filter(|s| !s.archived)
            .max_by_key(|s| s.updated_at)
            .map(|s| s.id.clone());
        let prefs = store::resolve_composer_prefs(None, last_sid.as_deref());
        let policy = PermissionPolicy::parse(&prefs.permission_policy);
        let agent_model = crate::providers::agent_spawn_model_id(&prefs.model_id);
        // Default-workspace cwd only. Project sessions with a non-off OS
        // sandbox must cold-spawn (#986) — Seatbelt locks write roots here.
        // Must exist for Command::current_dir (spawn fails silently otherwise).
        let _ = store::ensure_general_workspace_dir();
        let cwd = crate::paths::general_workspace_dir();
        let effective_sandbox = store::resolve_sandbox_profile(&settings.sandbox_profile, None);
        let spawn_opts = crate::acp_client::SpawnOptions {
            model_id: Some(agent_model),
            effort: Some(prefs.effort.clone()),
            permission_policy: Some(prefs.permission_policy.clone()),
            product_mode: Some(prefs.mode.clone()),
            sandbox_profile: Some(effective_sandbox.clone()),
            extra_rules: crate::official_aux::merge_extra_rules(None),
            ..Default::default()
        };
        let (client, mut events) = match AcpClient::spawn_with_options(cli_path, cwd, spawn_opts)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(code = e.code.as_str(), error = %e.message, "prewarm spawn failed");
                self.clear_prewarm_if_current(epoch);
                return;
            }
        };
        let process_id = Uuid::new_v4().to_string();
        // Drain the event stream (prewarm has no session; events are dropped by
        // sid routing — but the reader must still consume stdout).
        {
            let mgr = Arc::clone(self);
            let pid = process_id.clone();
            tokio::spawn(async move {
                while let Some((_sid, ev)) = events.recv().await {
                    mgr.handle_acp_event(&app, &pid, None, ev).await;
                }
            });
        }
        if let Err(e) = client.initialize_and_auth().await {
            tracing::warn!(code = e.code.as_str(), error = %e.message, "prewarm init failed");
            Self::kill_acp_bounded(&client).await;
            self.clear_prewarm_if_current(epoch);
            return;
        }
        let published = {
            let mut pw = self.prewarm.lock();
            if self.prewarm_epoch.load(std::sync::atomic::Ordering::SeqCst) == epoch
                && matches!(*pw, PrewarmState::Spawning { .. })
            {
                *pw = PrewarmState::Ready(PrewarmedProcess {
                    acp: client.clone(),
                    process_id,
                    policy,
                    effort: Some(prefs.effort),
                    sandbox_profile: Some(effective_sandbox),
                    model_id: Some(prefs.model_id),
                    created_at: Instant::now(),
                    backend: "grok_agent_stdio".into(),
                });
                true
            } else {
                false
            }
        };
        if !published {
            // A pending fork or route reset cancelled this prewarm while it
            // was starting. Do not leak the initialized child.
            Self::kill_acp_bounded(&client).await;
            return;
        }
        tracing::info!(target: "session", "prewarm ready (spawn+init+auth, no session)");
    }

    /// Reap a dead prewarm process. Prewarm is intentionally persistent
    /// (one warm CLI serves all quick switches); no time-based reclamation —
    /// a stale-config process is replaced by connect's cold-spawn fallback
    /// and the next prewarm re-fills the slot.
    pub(super) async fn sweep_expired_prewarm(&self, ttl: Duration) {
        let _ = ttl; // persistent — only dead entries are reaped
        let victim = {
            let mut pw = self.prewarm.lock();
            match std::mem::replace(&mut *pw, PrewarmState::None) {
                PrewarmState::Ready(p) if !p.acp.is_alive() => Some(p),
                other => {
                    *pw = other;
                    None
                }
            }
        };
        if let Some(p) = victim {
            tracing::info!("prewarm process {} recycled (dead)", p.process_id);
            Self::kill_acp_bounded(&p.acp).await;
        }
    }

    /// Process ids that currently host a mid-turn live or background session.
    /// Parked is never mid-turn (`prompt_in_flight` blocks parking).
    #[allow(dead_code)]
    pub(super) fn busy_process_ids_for_warm_reuse(&self) -> HashSet<String> {
        let live_pid = {
            let guard = self.inner.lock();
            guard.as_ref().and_then(|s| {
                if s.acp.as_ref().is_some_and(|c| c.is_alive()) && Self::live_session_is_busy(s) {
                    Some(s.process_id.clone())
                } else {
                    None
                }
            })
        };
        let bg_pids: Vec<String> = {
            let bg = self.background.lock();
            bg.values()
                .filter(|s| Self::live_session_is_busy(s))
                .map(|s| s.process_id.clone())
                .collect()
        };
        collect_busy_reuse_process_ids(live_pid.as_deref(), bg_pids.iter().map(String::as_str))
    }

    /// Pure reuse gate — split out for unit tests (no AcpClient needed).
    /// Process-level spawn flags must match: permission policy, reasoning
    /// effort, sandbox profile, and route class (official OIDC vs custom
    /// relay — those cannot share a GROK_HOME). Model is session-level
    /// (`set_model`), so it deliberately does not gate.
    ///
    /// Sandbox: the CLI normalizes "off" to no `--sandbox` flag (stored as
    /// `None` on the client), while settings resolve to the string "off".
    /// Treat None as "off" so both representations match.
    ///
    /// Callers must also pass [`Self::reuse_sandbox_cwd_ok`] when the process
    /// may have been spawned under a non-`off` OS sandbox (#986).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn reuse_gate(
        alive: bool,
        p_policy: PermissionPolicy,
        p_effort: Option<&str>,
        p_sandbox: Option<&str>,
        p_custom_route: bool,
        policy: PermissionPolicy,
        effort: &str,
        sandbox: &str,
        target_custom_route: bool,
    ) -> bool {
        alive
            && p_policy == policy
            && p_effort == Some(effort)
            && p_sandbox.unwrap_or("off") == sandbox
            && p_custom_route == target_custom_route
    }

    /// Whether warm-reuse is safe for OS sandbox vs spawn cwd (#986).
    ///
    /// `off` does not lock filesystem roots to spawn cwd, so a different
    /// session cwd (via `session/new|load`) is fine. Any other profile
    /// (workspace / read-only / strict / …) applies Seatbelt/Landlock at
    /// process start — spawn cwd and target session cwd must match.
    pub(super) fn reuse_sandbox_cwd_ok(
        process_sandbox: Option<&str>,
        process_spawn_cwd: &str,
        target_cwd: &str,
    ) -> bool {
        let sandbox = process_sandbox.unwrap_or("off");
        if sandbox == "off" {
            return true;
        }
        crate::cli_sessions::cwd_paths_match(process_spawn_cwd, target_cwd)
    }

    pub(super) fn event_kind_name(ev: &AcpEvent) -> &'static str {
        match ev {
            AcpEvent::State { .. } => "state",
            AcpEvent::Stream { .. } => "stream",
            AcpEvent::ToolCall { .. } => "tool_call",
            AcpEvent::ToolOpenReleased { .. } => "tool_open_released",
            AcpEvent::Plan { .. } => "plan",
            AcpEvent::AskUserQuestion { .. } => "ask_user",
            AcpEvent::PermissionRequest { .. } => "permission",
            AcpEvent::PromptComplete { .. } => "prompt_complete",
            AcpEvent::RetryState { .. } => "retry_state",
            AcpEvent::ContextCompact { .. } => "context_compact",
            AcpEvent::UsageReported { .. } => "usage",
            AcpEvent::Error { .. } => "error",
            AcpEvent::ProcessExited { .. } => "process_exited",
            AcpEvent::Stderr { .. } => "stderr",
            AcpEvent::HookActivity { .. } => "hook_activity",
            AcpEvent::GoalUpdated { .. } => "goal_updated",
        }
    }

    /// Turn-bearing events must reach their session; bookkeeping ones may be dropped.
    pub(super) fn event_carries_turn_output(ev: &AcpEvent) -> bool {
        matches!(
            ev,
            AcpEvent::Stream { .. }
                | AcpEvent::ToolCall { .. }
                | AcpEvent::ToolOpenReleased { .. }
                | AcpEvent::PromptComplete { .. }
                | AcpEvent::PermissionRequest { .. }
                | AcpEvent::Plan { .. }
                | AcpEvent::AskUserQuestion { .. }
                | AcpEvent::Error { .. }
                | AcpEvent::ProcessExited { .. }
        )
    }
}

/// Process ids that must not be warm-reused for another App session.
/// `live` is included only when that live shell is itself mid-turn on a
/// real ACP (the Connecting placeholder with a fresh UUID is omitted by
/// the caller).
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn collect_busy_reuse_process_ids<'a>(
    live: Option<&'a str>,
    backgrounds: impl IntoIterator<Item = &'a str>,
) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Some(pid) = live {
        if !pid.is_empty() {
            ids.insert(pid.to_string());
        }
    }
    for pid in backgrounds {
        if !pid.is_empty() {
            ids.insert(pid.to_string());
        }
    }
    ids
}

/// True when this process currently hosts a mid-turn co-tenant.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn process_blocked_for_warm_reuse(
    process_id: &str,
    busy_process_ids: &HashSet<String>,
) -> bool {
    !process_id.is_empty() && busy_process_ids.contains(process_id)
}

/// After a parked entry is removed for a spawn-flag mismatch (effort /
/// permission / pending soft-respawn), kill the process only when no
/// mid-turn live/background session still shares it.
///
/// Parked entries are per-session; the ACP child is shared. Killing on the
/// parked grain would abort a cohabitant's in-flight turn. The parked row
/// stays gone so this chat cold-spawns on next connect.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn should_kill_parked_after_flag_mismatch(
    process_id: &str,
    busy_process_ids: &HashSet<String>,
) -> bool {
    !process_blocked_for_warm_reuse(process_id, busy_process_ids)
}

#[cfg(test)]
mod connect_preserve_tests {
    use super::*;
    use crate::store::SessionMeta;

    #[test]
    fn disconnected_never_preserves_even_when_busy_flags_stuck() {
        // Real log: `state=Disconnected busy=true` after 502 — must reconnect.
        assert!(!connect_should_preserve_live_process(
            SessionState::Disconnected,
            true
        ));
        assert!(!connect_should_preserve_live_process(
            SessionState::Idle,
            true
        ));
    }

    #[test]
    fn streaming_and_permission_always_preserve() {
        assert!(connect_should_preserve_live_process(
            SessionState::Streaming,
            false
        ));
        assert!(connect_should_preserve_live_process(
            SessionState::AwaitingPermission,
            false
        ));
    }

    #[test]
    fn connecting_does_not_preserve_unfinished_handshake() {
        // Leftover Connecting + live ACP used to no-op every reconnect.
        assert!(!connect_should_preserve_live_process(
            SessionState::Connecting,
            false
        ));
        assert!(!connect_should_preserve_live_process(
            SessionState::Connecting,
            true
        ));
    }

    #[test]
    fn process_exit_fails_connecting_as_well_as_live_turns() {
        assert!(process_exit_should_fail_fsm(
            SessionState::Connecting,
            false
        ));
        assert!(process_exit_should_fail_fsm(SessionState::Ready, false));
        assert!(!process_exit_should_fail_fsm(
            SessionState::Connecting,
            true
        ));
        assert!(!process_exit_should_fail_fsm(SessionState::Idle, false));
    }

    #[test]
    fn wall_clock_and_stop_only_abort_handshake() {
        assert!(should_fail_connect_on_wall_clock(SessionState::Connecting));
        assert!(!should_fail_connect_on_wall_clock(SessionState::Ready));
        assert!(stop_should_abort_handshake(SessionState::Connecting));
        assert!(!stop_should_abort_handshake(SessionState::Streaming));
        const { assert!(CONNECT_WALL_CLOCK_SECS >= 60) };
        const { assert!(CONNECT_WALL_CLOCK_SECS <= 90) };
    }

    #[test]
    fn wall_clock_covers_lock_wait_and_handshake() {
        assert_eq!(connect_gave_up_reason(false), "connect lock busy");
        assert_eq!(connect_gave_up_reason(true), "connect timed out");
        const { assert!(CONNECT_LOCK_WATCHDOG_SECS < CONNECT_WALL_CLOCK_SECS) };
        const { assert!(ACP_KILL_TIMEOUT_SECS <= CONNECT_LOCK_WATCHDOG_SECS) };
        const { assert!(CONNECT_HANDSHAKE_BUDGET_SECS < CONNECT_WALL_CLOCK_SECS) };
        const { assert!(CONNECT_HANDSHAKE_BUDGET_SECS >= 45) };
    }

    #[test]
    fn timed_out_connect_invalidates_only_its_own_generation() {
        assert!(connect_attempt_still_current(7, 7));
        assert!(!connect_attempt_still_current(8, 7));
        // Latest attempt timed out → bump so a waiter cannot start handshake.
        assert_eq!(next_connect_epoch_on_timeout(7, 7), 8);
        // A newer connect already owns the epoch → leave it.
        assert_eq!(next_connect_epoch_on_timeout(9, 7), 9);
    }

    #[test]
    fn ready_preserves_only_when_busy() {
        assert!(connect_should_preserve_live_process(
            SessionState::Ready,
            true
        ));
        assert!(!connect_should_preserve_live_process(
            SessionState::Ready,
            false
        ));
    }

    #[test]
    fn release_failed_turn_markers_unblocks_reconnect_after_fail_with() {
        // Repro: early prompt_complete(stop=error) sets deferred while prompt RPC
        // is still in flight; then 502 fail_with → Disconnected. Before the fix,
        // deferred stayed set → live_session_is_busy + connect no-op forever.
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let _ = fsm.begin_stream();
        let now = Instant::now();
        let mut s = LiveSession {
            app_session_id: "session-stuck".into(),
            process_id: "process-stuck".into(),
            meta: SessionMeta {
                id: "session-stuck".into(),
                project_id: None,
                title: "Stuck".into(),
                agent_session_id: Some("agent-1".into()),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: None,
                permission_policy: None,
                json_schema: None,
                scheduled: false,
                worktree_path: None,
                worktree_branch: None,
                is_worktree_session: false,
                plugin_dirs: Vec::new(),
                extra_rules: None,
                max_agent_turns: None,
                system_prompt_override: None,
                fork_agent_session: false,
                fork_rewind_prompt_index: None,
                no_ask_user: None,
            },
            fsm,
            backend: "grok_agent_stdio".into(),
            acp: None,
            mock_stream: None,
            streaming_message_id: Some("a-err".into()),
            active_turn_id: Some("turn-err".into()),
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: None,
            effort: None,
            product_mode: None,
            project_path: Some("/tmp".into()),
            allow_cache: SessionAllowCache::default(),
            policy: PermissionPolicy::default(),
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: false,
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
            deferred_prompt_complete: Some("error".into()),
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: true,
            sent_prompt_this_visit: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        };

        assert!(SessionManager::live_session_is_busy(&s));
        let _ = s.fsm.fail_with(AgentError::new(
            AgentErrorCode::NetworkProvider,
            "502 Bad Gateway",
        ));
        // Fail alone leaves deferred → still "busy" under the old policy.
        assert!(SessionManager::live_session_is_busy(&s));
        assert!(!SessionManager::should_preserve_live_process(&s));

        SessionManager::release_failed_turn_markers(&mut s, None);
        assert!(!SessionManager::live_session_is_busy(&s));
        assert!(s.deferred_prompt_complete.is_none());
        assert!(!s.prompt_in_flight);
        assert!(s.streaming_message_id.is_none());
        assert!(!SessionManager::should_preserve_live_process(&s));
    }

    fn ready_live_for_snapshot_lock(id: &str) -> LiveSession {
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        LiveSession {
            app_session_id: id.into(),
            process_id: "process-already-live".into(),
            meta: SessionMeta {
                id: id.into(),
                project_id: None,
                title: "Already live".into(),
                agent_session_id: Some("agent-1".into()),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: None,
                permission_policy: None,
                json_schema: None,
                scheduled: false,
                worktree_path: None,
                worktree_branch: None,
                is_worktree_session: false,
                plugin_dirs: Vec::new(),
                extra_rules: None,
                max_agent_turns: None,
                system_prompt_override: None,
                fork_agent_session: false,
                fork_rewind_prompt_index: None,
                no_ask_user: None,
            },
            fsm,
            backend: "grok_agent_stdio".into(),
            acp: None,
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: None,
            effort: None,
            product_mode: None,
            project_path: Some("/tmp".into()),
            allow_cache: SessionAllowCache::default(),
            policy: PermissionPolicy::default(),
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: false,
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
        }
    }

    #[test]
    fn already_live_snapshot_while_holding_inner_does_not_relock() {
        // Repro #905: already-live / fork-busy used to `return Ok(self.snapshot())`
        // while `inner` was held. `snapshot()` re-locks `inner`; parking_lot is
        // not reentrant → connect_inner never returns → connect_lock wedges.
        let mgr = SessionManager::new();
        let mut guard = mgr.inner.lock();
        *guard = Some(ready_live_for_snapshot_lock("sess-already-live"));
        let t0 = Instant::now();
        let snap = SessionManager::snapshot_locked(&guard);
        assert!(
            t0.elapsed() < Duration::from_millis(200),
            "snapshot_locked must not re-acquire inner; took {:?}",
            t0.elapsed()
        );
        assert_eq!(snap.session_id.as_deref(), Some("sess-already-live"));
        assert_eq!(snap.state, SessionState::Ready);
        assert_eq!(snap.agent_session_id.as_deref(), Some("agent-1"));
        // Same helper the already-live / fork-busy returns now use.
        let from_live = SessionManager::snapshot_from_live(guard.as_ref().unwrap());
        assert_eq!(from_live.session_id, snap.session_id);
        assert_eq!(from_live.state, snap.state);
    }
}

#[cfg(test)]
mod reuse_gate_tests {
    use super::*;

    fn ask() -> PermissionPolicy {
        PermissionPolicy::parse("ask")
    }

    #[test]
    fn reuse_requires_matching_process_flags() {
        // All matching → reusable.
        assert!(SessionManager::reuse_gate(
            true,
            ask(),
            Some("high"),
            Some("off"),
            true, // custom route
            ask(),
            "high",
            "off",
            true,
        ));
        // Policy mismatch blocks.
        assert!(!SessionManager::reuse_gate(
            true,
            ask(),
            Some("high"),
            Some("off"),
            true,
            PermissionPolicy::parse("bypassPermissions"),
            "high",
            "off",
            true,
        ));
        // Effort mismatch blocks.
        assert!(!SessionManager::reuse_gate(
            true,
            ask(),
            Some("high"),
            Some("off"),
            true,
            ask(),
            "low",
            "off",
            true,
        ));
        // Sandbox mismatch blocks.
        assert!(!SessionManager::reuse_gate(
            true,
            ask(),
            Some("high"),
            Some("off"),
            true,
            ask(),
            "high",
            "workspace",
            true,
        ));
        // Route class mismatch blocks (official target vs custom parked).
        assert!(!SessionManager::reuse_gate(
            true,
            ask(),
            Some("high"),
            Some("off"),
            true,
            ask(),
            "high",
            "off",
            false,
        ));
        // Dead process blocks.
        assert!(!SessionManager::reuse_gate(
            false,
            ask(),
            Some("high"),
            Some("off"),
            true,
            ask(),
            "high",
            "off",
            true,
        ));
    }

    #[test]
    fn reuse_sandbox_cwd_blocks_project_on_general_prewarm() {
        // #986: workspace sandbox + prewarm(general) must not serve a project.
        let general = "/Users/me/Library/Application Support/com.grokapp.desktop/workspaces/general";
        let project = "/Users/me/Projects/AI_conference";
        assert!(
            !SessionManager::reuse_sandbox_cwd_ok(Some("workspace"), general, project),
            "workspace sandbox cannot widen from general to project"
        );
        assert!(
            SessionManager::reuse_sandbox_cwd_ok(Some("workspace"), general, general),
            "same general cwd stays reusable"
        );
        assert!(
            SessionManager::reuse_sandbox_cwd_ok(Some("workspace"), project, &format!("{project}/")),
            "trailing slash still matches"
        );
        // off: Seatbelt not applied — session cwd may differ (open_session_at).
        assert!(SessionManager::reuse_sandbox_cwd_ok(
            Some("off"),
            general,
            project
        ));
        assert!(SessionManager::reuse_sandbox_cwd_ok(None, general, project));
        // Other non-off profiles also lock spawn cwd.
        assert!(!SessionManager::reuse_sandbox_cwd_ok(
            Some("strict"),
            general,
            project
        ));
        assert!(!SessionManager::reuse_sandbox_cwd_ok(
            Some("read-only"),
            general,
            project
        ));
    }

    #[test]
    fn mid_turn_process_is_blocked_for_warm_reuse() {
        // 00f647cd: chat B session/load on A's Streaming process poisoned A's journal.
        let busy = collect_busy_reuse_process_ids(None, ["proc-a"]);
        assert!(process_blocked_for_warm_reuse("proc-a", &busy));
        // Parked co-tenant on the same pid is also blocked.
        assert!(process_blocked_for_warm_reuse("proc-a", &busy));
        // A different idle process stays eligible.
        assert!(!process_blocked_for_warm_reuse("proc-idle", &busy));
        // Empty / missing id never matches.
        assert!(!process_blocked_for_warm_reuse("", &busy));
        let empty = collect_busy_reuse_process_ids(None, std::iter::empty());
        assert!(!process_blocked_for_warm_reuse("proc-a", &empty));
    }

    #[test]
    fn idle_background_process_is_not_collected_as_busy() {
        // Caller only passes mid-turn pids; idle Ready is omitted.
        let busy = collect_busy_reuse_process_ids(None, std::iter::empty::<&str>());
        assert!(busy.is_empty());
        assert!(!process_blocked_for_warm_reuse("proc-idle-bg", &busy));
    }

    #[test]
    fn live_mid_turn_pid_blocks_reuse_of_same_process() {
        let busy = collect_busy_reuse_process_ids(Some("proc-live"), ["proc-bg"]);
        assert!(process_blocked_for_warm_reuse("proc-live", &busy));
        assert!(process_blocked_for_warm_reuse("proc-bg", &busy));
        assert_eq!(busy.len(), 2);
    }

    #[test]
    fn flag_mismatch_does_not_kill_parked_with_mid_turn_cohabitant() {
        let busy = collect_busy_reuse_process_ids(Some("proc-shared"), ["proc-bg"]);
        assert!(!should_kill_parked_after_flag_mismatch(
            "proc-shared",
            &busy
        ));
        assert!(!should_kill_parked_after_flag_mismatch("proc-bg", &busy));
        // Idle / unknown process: no cohabitant → safe to kill.
        assert!(should_kill_parked_after_flag_mismatch("proc-idle", &busy));
        let empty = collect_busy_reuse_process_ids(None, std::iter::empty());
        assert!(should_kill_parked_after_flag_mismatch(
            "proc-shared",
            &empty
        ));
        // Empty id never matches the busy set → treat as unshared (kill).
        assert!(should_kill_parked_after_flag_mismatch("", &busy));
    }
}

#[cfg(test)]
mod connect_timeout_tests {
    use super::*;
    use crate::error::AgentError;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn aborting_connect_task_releases_connect_lock() {
        let mgr = Arc::new(SessionManager::new());
        let mgr_hold = Arc::clone(&mgr);
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel::<()>();
        let join: tauri::async_runtime::JoinHandle<Result<SessionSnapshot, String>> =
            tauri::async_runtime::spawn(async move {
                let _g = mgr_hold.connect_lock.lock().await;
                let _ = entered_tx.send(());
                std::future::pending::<()>().await;
                Ok(mgr_hold.snapshot())
            });
        entered_rx.await.expect("holder entered");
        assert!(
            mgr.try_lock_connect(Duration::ZERO).await.is_none(),
            "lock must be held before abort"
        );
        join.abort();
        let _ = join.await;
        assert!(
            mgr.try_lock_connect(Duration::ZERO).await.is_some(),
            "abort must drop connect_lock so the next waiter is not pinned"
        );
    }

    #[tokio::test]
    async fn abort_drops_holder_and_sweep_does_not_hang() {
        let mgr = Arc::new(SessionManager::new());
        let mgr_hold = Arc::clone(&mgr);
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel::<()>();
        let join: tauri::async_runtime::JoinHandle<Result<SessionSnapshot, String>> =
            tauri::async_runtime::spawn(async move {
                let _g = mgr_hold.connect_lock.lock().await;
                let _holder = ConnectHolderGuard::enter(
                    Arc::clone(&mgr_hold),
                    Some("sess-wedge".into()),
                    "connect_inner",
                );
                let _ = entered_tx.send(());
                std::future::pending::<()>().await;
                Ok(mgr_hold.snapshot())
            });
        entered_rx.await.expect("holder entered");
        assert!(mgr.connect_lock_busy());
        assert!(mgr.connect_holder_snapshot().is_some());
        join.abort();
        let _ = join.await;
        mgr.sweep_pending_children().await;
        assert!(
            mgr.try_lock_connect(Duration::ZERO).await.is_some(),
            "lock free after abort+reap"
        );
        assert!(
            mgr.connect_holder_snapshot().is_none(),
            "holder guard drops on abort"
        );
    }

    #[tokio::test]
    async fn health_probe_stays_fast_while_lock_held() {
        let mgr = Arc::new(SessionManager::new());
        let mgr_hold = Arc::clone(&mgr);
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel::<()>();
        let hold = tokio::spawn(async move {
            let _g = mgr_hold.connect_lock.lock().await;
            let _ = entered_tx.send(());
            std::future::pending::<()>().await;
        });
        entered_rx.await.unwrap();
        let t0 = Instant::now();
        let busy = mgr.connect_lock_busy();
        let elapsed = t0.elapsed();
        assert!(busy);
        assert!(
            elapsed < Duration::from_secs(1),
            "lock probe took {elapsed:?}, health must stay <1s during wedge"
        );
        hold.abort();
    }

    #[tokio::test]
    async fn inner_wall_clock_releases_lock_after_caller_drops() {
        // Simulates POST /turns 15s dropping the connect JoinHandle: the
        // sibling must still time out and drop connect_lock by itself.
        let mgr = Arc::new(SessionManager::new());
        let mgr_hold = Arc::clone(&mgr);
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel::<()>();
        let join = tokio::spawn(async move {
            match tokio::time::timeout(Duration::from_millis(80), async {
                let _g = mgr_hold.connect_lock.lock().await;
                let _ = entered_tx.send(());
                std::future::pending::<()>().await;
                Ok::<(), String>(())
            })
            .await
            {
                Ok(inner) => inner,
                Err(_) => Ok(()),
            }
        });
        entered_rx.await.expect("holder entered");
        drop(join);
        let deadline = Instant::now() + Duration::from_millis(400);
        loop {
            if mgr.try_lock_connect(Duration::ZERO).await.is_some() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "inner wall-clock must release connect_lock after caller drop"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test]
    async fn handshake_budget_fails_closed() {
        let err = SessionManager::with_handshake_budget_for(
            Duration::from_millis(30),
            std::future::pending::<Result<(), AgentError>>(),
        )
        .await
        .expect_err("handshake budget must fire");
        assert!(
            err.message.contains("handshake timed out"),
            "{}",
            err.message
        );
    }
}
