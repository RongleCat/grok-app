//! Session connect / mock connect / event-routing helpers.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use uuid::Uuid;

use crate::acp_client::{AcpClient, AcpEvent};
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::JournalWriteThrottle;
use crate::mock_acp::MockConnectMode;
use crate::permission::{PermissionPolicy, SessionAllowCache};
use crate::process_limits::{can_spawn_process, normalize_max_concurrent, process_limit_message};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self};

use super::*;

impl SessionManager {
    pub async fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let _connect_guard = self.connect_lock.lock().await;
        self.connect_inner(app, project_path, app_session_id, mock_mode)
            .await
    }

    pub(super) async fn connect_inner(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let settings = store::load_settings();
        let max_concurrent = normalize_max_concurrent(settings.max_concurrent_agents);
        self.sweep_dead_parked();

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
                store::load_projects()
                    .into_iter()
                    .find(|p| p.id == pid)
                    .map(|p| std::path::PathBuf::from(p.path))
            });
            from_arg.or(from_meta).unwrap_or_else(|| {
                let _ = store::ensure_general_workspace_dir();
                crate::paths::general_workspace_dir()
            })
        };
        let project_path = Some(cwd.to_string_lossy().to_string());

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
        let agent_model = crate::providers::agent_spawn_model_id(&prefs.model_id);

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
                            return Ok(self.snapshot());
                        }
                        let acp = s.acp.take();
                        s.needs_history_bootstrap = false;
                        s.fsm.soft_disconnect();
                        s.process_id = String::new();
                        acp
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
                .and_then(|mut bg| bg.acp.take());
            let parked_acp = self.parked.lock().remove(&meta.id).map(|p| p.acp);
            if let Some(acp) = acp_to_kill {
                acp.kill().await;
            }
            if let Some(acp) = bg_acp {
                acp.kill().await;
            }
            if let Some(acp) = parked_acp {
                acp.kill().await;
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
                        return Ok(self.snapshot());
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
            if let Some(live) = self.background.lock().remove(&meta.id) {
                *self.inner.lock() = Some(live);
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
                        let busy = self.busy_process_ids_for_warm_reuse();
                        if should_kill_parked_after_flag_mismatch(&live.process_id, &busy) {
                            acp.kill().await;
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
                            if let Err(e) = acp.set_model_for(&sid, &agent_model).await {
                                tracing::warn!("acp set_model on unpark soft-fail: {e}");
                            }
                            if let Err(e) = acp.set_mode_for(&sid, &prefs.mode).await {
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
                    acp.kill().await;
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
                pending_ask_user_rpc_id: None,
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
        // A Ready parked (or idle background) process with identical
        // process-level spawn flags (permission / effort / sandbox / route)
        // can host this App session: no CLI spawn, just session/load or
        // session/new. The parked shell stays — switch-back is an unpark.
        //
        // Never reuse a process that still has a mid-turn live/background
        // co-tenant. CLI 1.0.3 load-replay is often unstamped; unique-busy-
        // background routing would then write B's history into A's journal
        // (00f647cd diagnostic: 009ea8c2 / 407d65e2 load on the Streaming
        // process). Idle Ready reuse is unchanged. Unstamped routing is
        // unchanged so A's own chunks still land after demote.
        if !pending_fork {
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
            let reused = {
                // Reuse candidates = idle parked + idle background only.
                // Mid-turn background keeps exclusive ownership of its process
                // so session/load on a peer cannot poison that journal.
                // Route class must follow active_route(), not prefs.model_id.
                // Custom channels store the *upstream* model in session prefs
                // (e.g. deepseek-v4-flash), which is_custom_provider_id rejects
                // — processes were mis-labeled official and reused after
                // auth.json was stripped (#528 intermittent re-login).
                let busy_process_ids = self.busy_process_ids_for_warm_reuse();
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
                                if gate(
                                    p.acp.is_alive(),
                                    p.policy,
                                    p.effort.as_deref(),
                                    p.sandbox_profile.as_deref(),
                                    p.acp.is_custom_route(),
                                ) {
                                    Some((p.acp, p.process_id, p.created_at))
                                } else {
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
                if best.is_none() {
                    let parked = self.parked.lock();
                    for p in parked.values() {
                        if process_blocked_for_warm_reuse(&p.process_id, &busy_process_ids) {
                            rejected.push(format!(
                                "parked {}: mid-turn co-tenant on process",
                                p.app_session_id
                            ));
                            continue;
                        }
                        if !gate(
                            p.acp.is_alive(),
                            p.policy,
                            p.effort.as_deref(),
                            p.acp.sandbox_profile().as_deref(),
                            p.acp.is_custom_route(),
                        ) {
                            rejected.push(format!(
                                "parked {}: {}",
                                p.app_session_id,
                                reject_reason(
                                    p.acp.is_alive(),
                                    p.policy,
                                    p.effort.as_deref(),
                                    p.acp.sandbox_profile().as_deref(),
                                    p.acp.is_custom_route(),
                                )
                            ));
                            continue;
                        }
                        let cand = (p.acp.clone(), p.process_id.clone(), p.last_activity);
                        if best.as_ref().is_none_or(|b| cand.2 > b.2) {
                            best = Some(cand);
                        }
                    }
                }
                if best.is_none() {
                    let bg = self.background.lock();
                    for s in bg.values() {
                        let s_custom = s.acp.as_ref().is_some_and(|c| c.is_custom_route());
                        if process_blocked_for_warm_reuse(&s.process_id, &busy_process_ids) {
                            rejected.push(format!("background {}: mid-turn", s.app_session_id));
                            continue;
                        }
                        if !gate(
                            s.acp.as_ref().is_some_and(|c| c.is_alive()),
                            s.policy,
                            s.effort.as_deref(),
                            s.acp.as_ref().and_then(|c| c.sandbox_profile()).as_deref(),
                            s_custom,
                        ) {
                            rejected.push(format!(
                                "background {}: {}",
                                s.app_session_id,
                                reject_reason(
                                    s.acp.as_ref().is_some_and(|c| c.is_alive()),
                                    s.policy,
                                    s.effort.as_deref(),
                                    s.acp.as_ref().and_then(|c| c.sandbox_profile()).as_deref(),
                                    s_custom,
                                )
                            ));
                            continue;
                        }
                        let cand = (
                            s.acp.clone().unwrap(),
                            s.process_id.clone(),
                            s.last_activity,
                        );
                        if best.as_ref().is_none_or(|b| cand.2 > b.2) {
                            best = Some(cand);
                        }
                    }
                }
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
            if let Some((acp, reused_process)) = reused {
                let reused_from = self
                    .parked
                    .lock()
                    .values()
                    .find(|p| p.process_id == reused_process)
                    .map(|p| p.app_session_id.clone())
                    .or_else(|| {
                        self.background
                            .lock()
                            .values()
                            .find(|s| s.process_id == reused_process)
                            .map(|s| s.app_session_id.clone())
                    });
                tracing::info!(
                    target: "session",
                    session = %meta.id,
                    reused_process = %reused_process,
                    reused_from = ?reused_from,
                    "connect warm-process reuse (shared, no spawn)"
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
                let open_result = acp
                    .open_session_at(resume_agent_sid.as_deref(), false, &cwd_str)
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
                        acp.kill().await;
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

        let cli_path = std::path::PathBuf::from(probe.path.unwrap());
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
            plugin_dirs: meta.plugin_dirs.clone(),
            extra_rules: crate::official_aux::merge_extra_rules(
                meta.extra_rules
                    .as_ref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty()),
            ),
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
        };

        let (client, mut events) = match AcpClient::spawn_with_options(cli_path, cwd, spawn_opts) {
            Ok(v) => {
                tracing::info!(
                    target: "session",
                    session = %meta.id,
                    process = %process_id,
                    fork_session = fork_agent,
                    "connect spawn_ok"
                );
                v
            }
            Err(e) => {
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

        tracing::info!(
            target: "session",
            session = %meta.id,
            resume_agent = ?resume_agent_sid,
            fork_session = fork_agent,
            "connect session_open_begin"
        );
        let open_result = client
            .initialize_and_open_session(resume_agent_sid.as_deref(), fork_agent)
            .await;

        // One-shot flag: clear whether fork succeeded or fell through to new/load.
        if meta.fork_agent_session {
            let _ = store::clear_session_fork_agent_session(&meta.id);
        }

        match open_result {
            Ok((agent_sid, resumed)) => {
                // Cold-spawn path: the process was spawned with `--model` =
                // active channel model, and `session/new` inherits the process
                // default — the post-open `set_model` here was a redundant RPC
                // on every connect. Keep `set_mode` on a normal resume (product
                // mode is per-prompt; this is only a nudge).
                // After `session/fork` the CLI is still hydrating parent
                // context — `set_mode` timed out 5×45s (agent/default/code/…)
                // and pinned both the fork and the parent chat on 连接中.
                // Spawn already passed `--permission-mode`; skip the nudge.
                if fork_agent {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        "connect skip set_mode after fork (parent mode already applied)"
                    );
                } else if let Err(e) = client.set_mode(&prefs.mode).await {
                    tracing::warn!("acp set_mode after session open soft-fail: {e}");
                }
                // Native resume / successful fork = full agent context. Fresh
                // session + existing UI journal → bootstrap history into the next prompt.
                let need_bootstrap = !resumed && journal_has_history;
                if resumed {
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
                        s.acp = Some(client);
                        s.process_id = process_id;
                        s.meta.agent_session_id = Some(agent_sid);
                        s.meta.fork_agent_session = false;
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
                Ok(snap)
            }
            Err(e) => {
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect session_open_fail"
                );
                client.kill().await;
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
            pending_ask_user_rpc_id: None,
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
    /// initialize + auth only — NO session (the chat's project cwd is bound
    /// later at `session/new` on submit). Connect reuses this process first,
    /// so the first send in a new chat is near-instant.
    ///
    /// Idempotent: skips when a prewarm already lives, or when any warm
    /// process already exists (parked / background covers connect). Uses the
    /// global/default channel prefs — if the submitted session differs in
    /// policy/effort/sandbox/route, connect falls back to a cold spawn.
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

    async fn prewarm_inner(self: &Arc<Self>, app: AppHandle, force: bool) {
        // Quick gate (no connect_lock — connect may be awaiting a Spawning
        // prewarm; grabbing the lock here would deadlock it). The prewarm
        // Mutex serializes concurrent prewarm calls.
        {
            let mut pw = self.prewarm.lock();
            match &*pw {
                PrewarmState::Spawning { .. } => return,
                PrewarmState::Ready(p) if p.acp.is_alive() && !force => return,
                _ => {}
            }
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
                        p.acp.kill().await;
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
        }

        let settings = store::load_settings();
        // WSL backend probes inside the distro (a WSL-only install has no native grok.exe).
        let probe = crate::wsl_backend::probe_cli_for_settings(
            &settings,
            settings.manual_cli_path.as_deref(),
        );
        let Some(cli_path) = probe.path else {
            *self.prewarm.lock() = PrewarmState::None;
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
        // Placeholder cwd — session cwd is a per-session parameter, so this
        // never binds the upcoming chat to a project. Must exist for
        // Command::current_dir (spawn fails silently otherwise).
        let _ = store::ensure_general_workspace_dir();
        let cwd = crate::paths::general_workspace_dir();
        let effective_sandbox = store::resolve_sandbox_profile(&settings.sandbox_profile, None);
        let spawn_opts = crate::acp_client::SpawnOptions {
            model_id: Some(agent_model),
            effort: Some(prefs.effort.clone()),
            permission_policy: Some(prefs.permission_policy.clone()),
            product_mode: Some(prefs.mode.clone()),
            sandbox_profile: Some(effective_sandbox.clone()),
            ..Default::default()
        };
        let (client, mut events) = match AcpClient::spawn_with_options(cli_path, cwd, spawn_opts) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(code = e.code.as_str(), error = %e.message, "prewarm spawn failed");
                *self.prewarm.lock() = PrewarmState::None;
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
            client.kill().await;
            *self.prewarm.lock() = PrewarmState::None;
            return;
        }
        *self.prewarm.lock() = PrewarmState::Ready(PrewarmedProcess {
            acp: client,
            process_id,
            policy,
            effort: Some(prefs.effort),
            sandbox_profile: Some(effective_sandbox),
            model_id: Some(prefs.model_id),
            created_at: Instant::now(),
            backend: "grok_agent_stdio".into(),
        });
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
            p.acp.kill().await;
        }
    }

    /// Process ids that currently host a mid-turn live or background session.
    /// Parked is never mid-turn (`prompt_in_flight` blocks parking).
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
    fn streaming_and_connecting_always_preserve() {
        assert!(connect_should_preserve_live_process(
            SessionState::Streaming,
            false
        ));
        assert!(connect_should_preserve_live_process(
            SessionState::AwaitingPermission,
            false
        ));
        assert!(connect_should_preserve_live_process(
            SessionState::Connecting,
            false
        ));
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
            pending_ask_user_rpc_id: None,
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
