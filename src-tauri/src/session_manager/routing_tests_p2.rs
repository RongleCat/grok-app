
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
