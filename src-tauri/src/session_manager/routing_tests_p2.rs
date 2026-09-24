
#[test]
fn journal_assistant_after_last_user_detects_answered_turn() {
    let _lock = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp =
        std::env::temp_dir().join(format!("grok-app-replay-gate-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::create_dir_all(&tmp);
    std::env::set_var("GROK_APP_HOME", &tmp);
    let _ = crate::paths::ensure_app_dirs();
    let sid = "replay-gate-test-session";
    let _ = store::append_message(
        sid,
        ChatMessageStored {
            id: "u1".into(),
            role: "user".into(),
            content: "hello".into(),
            thought: None,
            created_at: chrono::Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        },
    );
    assert!(!SessionManager::journal_has_assistant_after_last_user(sid));
    let _ = store::append_message(
        sid,
        ChatMessageStored {
            id: "a1".into(),
            role: "assistant".into(),
            content: "world".into(),
            thought: None,
            created_at: chrono::Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        },
    );
    assert!(SessionManager::journal_has_assistant_after_last_user(sid));
    std::env::remove_var("GROK_APP_HOME");
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn interjection_starts_host_owned_stream_segment() {
    // Minimal LiveSession-shaped fields via a throwaway session on the manager.
    // We only need stream id lock semantics — use begin_post_interjection_stream.
    // Build through connect path is heavy; construct via unpark-style fields by
    // reusing ensure_stream_message_id after begin_post_interjection_stream on a
    // hand-built session inside the lock.
    let mgr = SessionManager::new();
    // Use a mock live session from existing patterns if any — otherwise skip build.
    // Direct unit: call ensure after setting locked on an empty shell via private API
    // through begin_post_interjection_stream requiring &mut LiveSession.
    // We'll assemble a minimal session matching LiveSession fields by sending
    // through the manager's public surface is hard; use sample via FSM.
    let mut fsm = SessionFsm::new();
    let _ = fsm.start_connect();
    let _ = fsm.handshake_ok();
    let _ = fsm.begin_stream();
    let now = Instant::now();
    let mut session = LiveSession {
        app_session_id: "session-1".into(),
        process_id: "process-1".into(),
        meta: SessionMeta {
            id: "session-1".into(),
            project_id: None,
            title: "Test".into(),
            agent_session_id: None,
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
            workspace_id: None,
            workspace_root_snapshot: None,
            workspace_capability: None,
        },
        fsm,
        backend: "mock_acp".into(),
        acp: None,
        mock_stream: None,
        streaming_message_id: Some("agent-message-1".into()),
        active_turn_id: Some("turn-1".into()),
        stream_message_id_locked: false,
        stream_buf: "before".into(),
        stream_thought: String::new(),
        stream_last_was_assistant: true,
        stream_attachments: Vec::new(),
        model_id: None,
        effort: None,
        product_mode: None,
        project_path: None,
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
        prompt_in_flight: true,
        sent_prompt_this_visit: false,
        pending_stream_emit: None,
        stream_emit_flush_gen: 0,
        last_tool_heartbeat_emit: None,
    };

    SessionManager::begin_post_interjection_stream(&mut session);
    let post_id = session
        .streaming_message_id
        .clone()
        .expect("post-interjection message id");
    assert_ne!(post_id, "agent-message-1");
    assert!(session.stream_message_id_locked);
    assert!(session.stream_buf.is_empty());

    SessionManager::ensure_stream_message_id(
        &mut session,
        StreamKind::Assistant,
        Some("agent-message-1".into()),
    );
    assert_eq!(
        session.streaming_message_id.as_deref(),
        Some(post_id.as_str())
    );

    assert!(SessionManager::is_interjection_turn_active(
        &session,
        "session-1",
        "turn-1",
    ));
    assert!(!SessionManager::is_interjection_turn_active(
        &session,
        "session-2",
        "turn-1",
    ));
    session.prompt_in_flight = false;
    session.fsm.end_stream().unwrap();
    session.active_turn_id = None;
    assert!(!SessionManager::is_interjection_turn_active(
        &session,
        "session-1",
        "turn-1",
    ));
    let _ = mgr; // keep manager constructed for parity with other tests
}

#[test]
fn pick_interjection_target_rejects_non_streaming_session() {
    let mgr = SessionManager::new();
    let mut fsm = SessionFsm::new();
    let _ = fsm.start_connect();
    let _ = fsm.handshake_ok();
    // Ready, not streaming
    let now = Instant::now();
    *mgr.inner.lock() = Some(LiveSession {
        app_session_id: "session-1".into(),
        process_id: "process-1".into(),
        meta: SessionMeta {
            id: "session-1".into(),
            project_id: None,
            title: "Test".into(),
            agent_session_id: None,
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
            workspace_id: None,
            workspace_root_snapshot: None,
            workspace_capability: None,
        },
        fsm,
        backend: "mock_acp".into(),
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
        project_path: None,
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
    });
    // Same validation `interject_message` runs first, without AppHandle.
    // `tauri::test::mock_app()` needs the `test` feature and crashes the
    // Windows test binary (STATUS_ENTRYPOINT_NOT_FOUND, tauri #14580).
    let guard = mgr.inner.lock();
    match SessionManager::pick_interjection_target(guard.as_ref().expect("live session set")) {
        Ok(_) => panic!("ready session must reject interjection"),
        Err(err) => assert_eq!(err, "interjection requires a streaming turn"),
    }
}

/// Minimal Ready session (no ACP child) for lock-ordering tests.
fn bare_live_session(id: &str, process_id: &str) -> LiveSession {
    let mut fsm = SessionFsm::new();
    let _ = fsm.start_connect();
    let _ = fsm.handshake_ok();
    let now = Instant::now();
    LiveSession {
        app_session_id: id.into(),
        process_id: process_id.into(),
        meta: SessionMeta {
            id: id.into(),
            project_id: None,
            title: "Lock test".into(),
            agent_session_id: None,
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
            workspace_id: None,
            workspace_root_snapshot: None,
            workspace_capability: None,
        },
        fsm,
        backend: "mock_acp".into(),
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
        project_path: None,
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

/// Regression: the background→live promote used to hold the `background`
/// guard through its body (edition-2021 if-let temporaries) while locking
/// `inner` — the reverse of `try_park_live`'s inner→background order. Two
/// concurrent threads deadlocked permanently: streaming froze on 「思考中」
/// and every session command (export diagnostics, stop, get_state) hung
/// until force-quit.
#[test]
fn promote_background_to_live_survives_inner_then_background_contention() {
    use std::sync::{mpsc, Barrier};
    use std::time::Duration;

    let mgr = Arc::new(SessionManager::new());
    mgr.background
        .lock()
        .insert("bg-1".into(), bare_live_session("bg-1", "p-1"));

    let barrier = Arc::new(Barrier::new(2));

    // Adversary thread mimics try_park_live: hold `inner`, then take
    // `background` while the promote runs on the other thread.
    let mgr_adv = Arc::clone(&mgr);
    let barrier_adv = Arc::clone(&barrier);
    let adversary = std::thread::spawn(move || {
        let inner = mgr_adv.inner.lock();
        barrier_adv.wait();
        // Give the promote thread time to enter its background critical section.
        std::thread::sleep(Duration::from_millis(150));
        let bg = mgr_adv.background.lock();
        drop(bg);
        drop(inner);
    });

    let (tx, rx) = mpsc::channel();
    let mgr_promote = Arc::clone(&mgr);
    let barrier_promote = Arc::clone(&barrier);
    std::thread::spawn(move || {
        barrier_promote.wait();
        let promoted = mgr_promote.promote_background_to_live("bg-1");
        let _ = tx.send(promoted);
    });

    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(promoted) => assert!(promoted, "seeded background session must promote"),
        Err(_) => {
            panic!("ABBA deadlock regression: promote held `background` while waiting on `inner`")
        }
    }
    adversary.join().expect("adversary thread");
    assert!(mgr.is_live_session("bg-1"));
    assert!(mgr.background.lock().is_empty());
}

/// Regression: `has_other_process_tenant` chained `background.lock() ||
/// parked.lock()` in one expression, holding background while waiting for
/// parked — the reverse of `try_park_live`'s parked→background order.
#[test]
fn process_tenant_check_survives_parked_then_background_contention() {
    use std::sync::{mpsc, Barrier};
    use std::time::Duration;

    let mgr = Arc::new(SessionManager::new());
    let barrier = Arc::new(Barrier::new(2));

    // Adversary mimics try_park_live's detach branch: hold `parked`, then
    // take `background`.
    let mgr_adv = Arc::clone(&mgr);
    let barrier_adv = Arc::clone(&barrier);
    let adversary = std::thread::spawn(move || {
        let parked = mgr_adv.parked.lock();
        barrier_adv.wait();
        std::thread::sleep(Duration::from_millis(150));
        let bg = mgr_adv.background.lock();
        drop(bg);
        drop(parked);
    });

    let (tx, rx) = mpsc::channel();
    let mgr_check = Arc::clone(&mgr);
    let barrier_check = Arc::clone(&barrier);
    std::thread::spawn(move || {
        barrier_check.wait();
        let tenant = mgr_check.has_other_process_tenant("p-x", "s-x");
        let _ = tx.send(tenant);
    });

    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(tenant) => assert!(!tenant, "empty maps have no co-tenant"),
        Err(_) => panic!(
            "ABBA deadlock regression: tenant check held `background` while waiting on `parked`"
        ),
    }
    adversary.join().expect("adversary thread");
}

/// The diagnostic export is what users reach for when the app is wedged —
/// it must return a lock-busy placeholder instead of hanging behind the
/// very lock it is trying to diagnose.
#[test]
fn diagnostic_runtime_reports_lock_busy_instead_of_hanging() {
    use std::sync::mpsc;
    use std::time::Duration;

    let mgr = Arc::new(SessionManager::new());
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let mgr_hold = Arc::clone(&mgr);
    let (held_tx, held_rx) = mpsc::channel::<()>();
    let holder = std::thread::spawn(move || {
        let _inner = mgr_hold.inner.lock();
        let _ = held_tx.send(());
        // Hold `inner` until the probe finished (simulated wedged holder).
        let _ = release_rx.recv();
    });
    held_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("holder thread must take the lock");

    let started = Instant::now();
    let rt = mgr.diagnostic_runtime_for("any-session");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "diagnostic snapshot must respect its lock budget"
    );
    let v = rt.expect("lock-busy must still yield a diagnostic payload");
    assert_eq!(v["state"], "LockBusy");
    assert_eq!(v["lockBusy"], "inner");

    let _ = release_tx.send(());
    holder.join().expect("holder thread");
}

/// Lock-vs-disk split for the streaming journal: `prepare_stream_journal_flush`
/// does the throttle bookkeeping and payload snapshot under the session lock
/// with no disk IO, so hot-path callers can commit after dropping
/// `inner` / `background` (a contended store file lock stalled every session
/// command for seconds while thinking).
#[test]
fn stream_journal_prepare_snapshots_and_throttles_without_disk_io() {
    let mut s = bare_live_session("journal-1", "p-journal");
    assert!(
        SessionManager::prepare_stream_journal_flush(&mut s, false, false).is_none(),
        "empty buffers must not produce a flush payload"
    );

    s.stream_buf.push_str("hello");
    let pending = SessionManager::prepare_stream_journal_flush(&mut s, false, false)
        .expect("first chunk flushes immediately");
    assert_eq!(pending.session_id, "journal-1");
    assert_eq!(pending.message.content, "hello");
    let mid = s.streaming_message_id.clone().expect("message id assigned");
    assert_eq!(pending.message.id, mid);

    // The throttle advances at prepare time (optimistically): an immediate
    // follow-up chunk must not produce a second payload.
    s.stream_buf.push_str(" world");
    assert!(
        SessionManager::prepare_stream_journal_flush(&mut s, false, false).is_none(),
        "mid-stream flushes are throttled"
    );

    // Force (turn end) bypasses the throttle and carries the full cumulative
    // buffer under the same stable row id with a newer `created_at` revision —
    // this is what makes a lost or late mid-stream commit self-healing.
    let final_pending = SessionManager::prepare_stream_journal_flush(&mut s, true, false)
        .expect("force flush bypasses throttle");
    assert_eq!(final_pending.message.id, mid);
    assert_eq!(final_pending.message.content, "hello world");
    assert!(final_pending.message.created_at >= pending.message.created_at);
    assert!(final_pending.meta.updated_at >= pending.meta.updated_at);
}

/// Regression: `rewind_to_prompt_index` read busy state from the live slot
/// only. A chat demoted to background mid-turn (the user switched away while
/// it streamed) therefore reported idle, and the rewind truncated its journal
/// underneath the running turn — the agent's memory no longer matched the
/// transcript, so the next send hung or showed a phantom 「思考中」.
#[test]
fn rewind_busy_check_sees_background_mid_turn_session() {
    let mgr = Arc::new(SessionManager::new());
    let mut demoted = bare_live_session("bg-rewind", "p-1");
    // Authoritative mid-turn marker: the prompt RPC has not resolved yet.
    demoted.prompt_in_flight = true;
    mgr.background.lock().insert("bg-rewind".into(), demoted);

    // Precondition that made the old check wrong: nothing holds the live slot,
    // so a live-slot-only read sees no session at all and answers "idle".
    assert!(
        mgr.inner.lock().is_none(),
        "fixture must leave the live slot empty"
    );

    assert!(
        mgr.rewind_blocked_by_running_turn("bg-rewind"),
        "a background session mid-turn must still block rewind"
    );
}

/// A demoted session that finished its turn must not keep rewind locked out.
#[test]
fn rewind_busy_check_allows_idle_background_session() {
    let mgr = Arc::new(SessionManager::new());
    mgr.background
        .lock()
        .insert("bg-idle".into(), bare_live_session("bg-idle", "p-1"));

    assert!(!mgr.rewind_blocked_by_running_turn("bg-idle"));
    assert!(
        !mgr.rewind_blocked_by_running_turn("never-seen"),
        "an unknown chat has no running turn to protect"
    );
}

// ── BOR-50：路由级回收保留忙碌会话 ─────────────────────────────────────────

fn busy_live_session(id: &str, process_id: &str) -> LiveSession {
    let mut s = bare_live_session(id, process_id);
    // prompt_in_flight 是权威忙碌信号（turn 未结束前必须保留进程）。
    s.prompt_in_flight = true;
    s
}

/// 忙碌的 live + background 会话必须被保留并登记 pending_soft_respawn，
/// 进程条目不得从映射中移除（否则会被误杀 / 丢失事件路由）。
#[test]
fn route_change_preserves_busy_sessions_and_queues_respawn() {
    let mgr = SessionManager::new();
    *mgr.inner.lock() = Some(busy_live_session("s-live", "p-live"));
    mgr.background
        .lock()
        .insert("s-bg".into(), busy_live_session("s-bg", "p-bg"));

    let preserved = mgr.preserve_busy_sessions_for_route_change("provider_route");

    assert_eq!(preserved.len(), 2, "live + background busy must both survive");
    assert!(preserved.contains(&"s-live".to_string()));
    assert!(preserved.contains(&"s-bg".to_string()));
    let pending = mgr.pending_soft_respawn.lock();
    assert_eq!(pending.get("s-live").map(String::as_str), Some("provider_route"));
    assert_eq!(pending.get("s-bg").map(String::as_str), Some("provider_route"));
    drop(pending);
    // 条目仍在：保留 ≠ 逐出。
    assert!(mgr.inner.lock().as_ref().unwrap().app_session_id == "s-live");
    assert!(mgr.background.lock().contains_key("s-bg"));
}

/// 空闲会话不进入保留集合，也不登记 pending（它们的进程由
/// recycle_agents_for_route_change 直接回收）。
#[test]
fn route_change_skips_idle_sessions() {
    let mgr = SessionManager::new();
    *mgr.inner.lock() = Some(bare_live_session("s-idle-live", "p-1"));
    mgr.background
        .lock()
        .insert("s-idle-bg".into(), bare_live_session("s-idle-bg", "p-2"));

    let preserved = mgr.preserve_busy_sessions_for_route_change("provider_route");

    assert!(preserved.is_empty(), "idle sessions have nothing to preserve");
    assert!(mgr.pending_soft_respawn.lock().is_empty());
}

/// 已完成的 background turn 先落入 parked 后，忙碌后台会话仍保留在
/// background 中——sweep 只搬走结束的 turn，不触碰忙碌的。
#[test]
fn route_change_preservation_survives_parked_sweep() {
    let mgr = SessionManager::new();
    mgr.background
        .lock()
        .insert("s-bg-busy".into(), busy_live_session("s-bg-busy", "p-busy"));

    mgr.sweep_finished_background_to_parked();

    assert!(
        mgr.background.lock().contains_key("s-bg-busy"),
        "sweep must not evict a busy background turn"
    );
    let preserved = mgr.preserve_busy_sessions_for_route_change("models_aux");
    assert_eq!(preserved, vec!["s-bg-busy".to_string()]);
}

// ── BOR-52：会话内模型切换排队（运行中任务不中断）──────────────────────────

/// (a) 忙碌会话：模型切换登记 pending_soft_respawn("model")，live 槽位
/// 进程原样保留（不 soft-drop、不改 FSM 状态），等待本轮结束 flush。
#[test]
fn model_change_on_busy_session_queues_pending_and_keeps_process() {
    let mgr = SessionManager::new();
    *mgr.inner.lock() = Some(busy_live_session("s-model-busy", "p-model"));

    let queued = mgr.queue_model_change_for_busy();

    assert_eq!(queued.as_deref(), Some("s-model-busy"));
    assert_eq!(
        mgr.pending_soft_respawn
            .lock()
            .get("s-model-busy")
            .map(String::as_str),
        Some("model")
    );
    let guard = mgr.inner.lock();
    let s = guard.as_ref().expect("live slot preserved");
    assert_eq!(s.app_session_id, "s-model-busy");
    assert_eq!(s.process_id, "p-model");
    // FSM 未被 soft_disconnect —— 进程与事件路由保持原样。
    assert_eq!(s.fsm.state(), SessionState::Ready);
}

/// (c) 空闲会话：不进 pending，模型切换立即生效（由调用方直接
/// `session/set_model`），队列保持为空。
#[test]
fn model_change_on_idle_session_applies_immediately_without_pending() {
    let mgr = SessionManager::new();
    *mgr.inner.lock() = Some(bare_live_session("s-model-idle", "p-idle"));

    let queued = mgr.queue_model_change_for_busy();

    assert!(queued.is_none(), "idle session must not queue");
    assert!(mgr.pending_soft_respawn.lock().is_empty());
}

/// (b) 前置：turn 未结束（仍忙碌）时 flush 不得消费 pending —— 原样
/// 重新登记，等待真正的 turn 边界。
#[test]
fn flush_keeps_pending_while_session_still_busy() {
    let mgr = SessionManager::new();
    *mgr.inner.lock() = Some(busy_live_session("s-flush-busy", "p-busy"));
    mgr.pending_soft_respawn
        .lock()
        .insert("s-flush-busy".into(), "model".into());

    let taken = mgr.take_pending_if_idle("s-flush-busy");

    assert!(taken.is_none(), "busy session must not consume pending");
    assert_eq!(
        mgr.pending_soft_respawn
            .lock()
            .get("s-flush-busy")
            .map(String::as_str),
        Some("model")
    );
}

/// (b) turn 结束后 flush：pending 被消费，旧后台 ACP 条目被丢弃，
/// 下次 connect 以新 model（meta.model_id）冷启动 —— 换新路由。
#[tokio::test]
async fn flush_after_turn_end_drops_old_agent_for_new_route() {
    let mgr = SessionManager::new();
    mgr.pending_soft_respawn
        .lock()
        .insert("s-flush-idle".into(), "model".into());
    mgr.background
        .lock()
        .insert("s-flush-idle".into(), bare_live_session("s-flush-idle", "p-old"));

    let taken = mgr.take_pending_if_idle("s-flush-idle");

    assert_eq!(taken.as_deref(), Some("model"));
    assert!(!mgr.pending_soft_respawn.lock().contains_key("s-flush-idle"));
    // apply 阶段：丢掉旧 agent 条目，下一次 connect 冷启动读取新 meta。
    mgr.drop_idle_agent_for_session("s-flush-idle", "model").await;
    assert!(
        !mgr.background.lock().contains_key("s-flush-idle"),
        "old background agent must not be promoted by the ready fast-path"
    );
}

// ── 手工验收反馈：切模型必须落在**目标会话**上 ─────────────────────────────
//
// 症状：切模型没中断任务（BOR-52 已修），但不同会话的模型仍被统一。
// 其中一半原因在 store 的 scope（已修）；另一半在这里 —— `set_model` 写的是
// 「当前 live 槽位」而不是调用方指定的会话，所以改后台会话的模型会污染屏幕上
// 那个会话的 meta。
//
// 这些用例会经 `update_session_meta` 落盘，因此**必须在隔离的 APP_HOME 里跑**：
// 否则会往开发者真实的 sessions_index.json 里写进 `s-a` / `s-b` 这类测试会话
// （这个坑已经踩过一次，真实索引里被写进了两行标题为 "Lock test" 的假会话）。

/// 在临时 `GROK_APP_HOME` 下运行 `f`。`update_session_meta` 只写这里，
/// 不会碰开发者的真实应用数据。
fn with_isolated_app_home(label: &str, f: impl FnOnce()) {
    let _lock = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join(format!(
        "grok-app-{label}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create isolated app home");
    let previous = std::env::var_os("GROK_APP_HOME");
    std::env::set_var("GROK_APP_HOME", &dir);
    let _ = crate::paths::ensure_app_dirs();
    f();
    match previous {
        Some(v) => std::env::set_var("GROK_APP_HOME", v),
        None => std::env::remove_var("GROK_APP_HOME"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn model_change_targets_the_requested_chat_not_the_live_slot() {
    with_isolated_app_home("model-target", || {
        // Arrange — live 槽位是 s-a，但调用方要改的是 s-b
        let mgr = SessionManager::new();
        *mgr.inner.lock() = Some(bare_live_session("s-a", "p-a"));

        // Act
        let applied = mgr.apply_model_to_session_slots("s-b", "model-x");

        // Assert — live 槽位不认领，s-a 的 meta 一个字节都不能动
        assert!(!applied.applies_live);
        assert!(applied.acp.is_none());
        let guard = mgr.inner.lock();
        let live = guard.as_ref().expect("live slot preserved");
        assert_eq!(live.app_session_id, "s-a");
        assert_eq!(
            live.meta.model_id, None,
            "changing another chat must not re-model the live one"
        );
    });
}

#[test]
fn model_change_claims_the_live_slot_when_it_is_the_target() {
    with_isolated_app_home("model-claim", || {
        // Arrange
        let mgr = SessionManager::new();
        *mgr.inner.lock() = Some(bare_live_session("s-a", "p-a"));

        // Act
        let applied = mgr.apply_model_to_session_slots("s-a", "model-x");

        // Assert
        assert!(applied.applies_live);
        let guard = mgr.inner.lock();
        let live = guard.as_ref().expect("live slot");
        assert_eq!(live.meta.model_id.as_deref(), Some("model-x"));
    });
}

#[test]
fn model_change_on_a_background_chat_writes_its_own_meta() {
    with_isolated_app_home("model-background", || {
        // Arrange — s-b 已后台化，s-a 仍是 live
        let mgr = SessionManager::new();
        *mgr.inner.lock() = Some(bare_live_session("s-a", "p-a"));
        mgr.background
            .lock()
            .insert("s-b".into(), bare_live_session("s-b", "p-b"));

        // Act
        let applied = mgr.apply_model_to_session_slots("s-b", "model-x");

        // Assert — 只有 s-b 被改；s-b 没有 ACP，所以不需要换路由
        assert!(!applied.applies_live);
        assert!(!applied.background_needs_respawn);
        let bg = mgr.background.lock();
        assert_eq!(
            bg.get("s-b").and_then(|s| s.meta.model_id.as_deref()),
            Some("model-x")
        );
        let guard = mgr.inner.lock();
        assert_eq!(
            guard.as_ref().and_then(|s| s.meta.model_id.clone()),
            None,
            "background model change must not leak into the live chat"
        );
    });
}
