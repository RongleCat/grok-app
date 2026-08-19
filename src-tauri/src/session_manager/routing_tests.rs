//! Session routing / multi-session tests.
#![cfg(test)]

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use crate::acp_client::{AcpEvent, StreamKind};
use crate::journal_throttle::JournalWriteThrottle;
use crate::permission::{PermissionPolicy, SessionAllowCache};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored, SessionMeta};

use super::*;

#[test]
fn explicit_target_wins_over_live_slot() {
    let mgr = SessionManager::new();
    // No live session at all — an explicit id is still honoured.
    assert_eq!(
        mgr.resolve_target_session(Some("chat-b".into())).unwrap(),
        "chat-b"
    );
}

#[test]
fn blank_target_falls_back_to_live_and_errors_when_none() {
    let mgr = SessionManager::new();
    assert!(mgr.resolve_target_session(None).is_err());
    // Empty string is treated as "unspecified", not as a session id.
    assert!(mgr.resolve_target_session(Some(String::new())).is_err());
}

#[test]
fn unknown_session_never_resolves_to_another_chat() {
    let mgr = SessionManager::new();
    assert!(mgr.with_session_mut("chat-a", |_| ()).is_none());
    assert!(!mgr.is_live_session("chat-a"));
}

#[test]
fn with_session_mut_does_not_invent_sessions() {
    // Multi-window routing: unknown ids never fall back to another chat.
    let mgr = SessionManager::new();
    assert!(mgr.with_session_mut("bg-only", |_| 1u8).is_none());
    assert!(!mgr.is_live_session("bg-only"));
}

#[test]
fn turn_output_events_are_never_droppable() {
    // Anything that carries answer text, tool state, or a gate must be
    // routed to its session — silently returning truncates the answer.
    assert!(SessionManager::event_carries_turn_output(
        &AcpEvent::Stream {
            kind: StreamKind::Assistant,
            text: "hi".into(),
            message_id: None,
            done: false,
        }
    ));
    assert!(SessionManager::event_carries_turn_output(
        &AcpEvent::PromptComplete {
            stop_reason: "end_turn".into(),
            authoritative: true,
        }
    ));
    assert!(SessionManager::event_carries_turn_output(
        &AcpEvent::ProcessExited { code: None }
    ));
    // Pure telemetry may be dropped when no session owns the process.
    assert!(!SessionManager::event_carries_turn_output(
        &AcpEvent::Stderr {
            line: "noise".into()
        }
    ));
    assert_eq!(
        SessionManager::event_kind_name(&AcpEvent::PromptComplete {
            stop_reason: "end_turn".into(),
            authoritative: false,
        }),
        "prompt_complete"
    );
}

#[test]
fn rescue_is_noop_when_no_parked_agent_owns_the_process() {
    let mgr = SessionManager::new();
    assert!(mgr.rescue_parked_to_background("no-such-process").is_none());
}

fn sample_live_for_empty_run(body: &str, thought: &str, tools: u32, mode: &str) -> LiveSession {
    let mut fsm = SessionFsm::new();
    let _ = fsm.start_connect();
    let _ = fsm.handshake_ok();
    let _ = fsm.begin_stream();
    let now = Instant::now();
    LiveSession {
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
            mode: Some(mode.into()),
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
        backend: "mock_acp".into(),
        acp: None,
        mock_stream: None,
        streaming_message_id: Some("a1".into()),
        active_turn_id: Some("turn-1".into()),
        stream_message_id_locked: false,
        stream_buf: body.into(),
        stream_thought: thought.into(),
        stream_last_was_assistant: !body.is_empty(),
        stream_attachments: Vec::new(),
        model_id: None,
        effort: None,
        product_mode: Some(mode.into()),
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
        last_activity: now,
        last_stream_progress: now,
        last_stall_emit: None,
        stall_soft_emits: 0,
        journal_throttle: JournalWriteThrottle::with_default_interval(),
        open_tool_ids: HashSet::new(),
        open_tool_seen_at: HashMap::new(),
        terminal_tool_ids: HashSet::new(),
        deferred_prompt_complete: None,
        tools_this_turn: tools,
        saw_model_output: false,
        prompt_in_flight: false,
        sent_prompt_this_visit: false,
        pending_stream_emit: None,
        stream_emit_flush_gen: 0,
        last_tool_heartbeat_emit: None,
    }
}

#[test]
fn pending_permission_recovers_card_until_invalidated() {
    // Approval-bar recovery: a WebView that missed the one-shot
    // `session://permission` emit (reload / remount mid-approval) must be able
    // to pull the pending card back — otherwise the chat looks stuck
    // "thinking" forever (diag f1daa64c).
    let mgr = SessionManager::new();
    let mut s = sample_live_for_empty_run("", "", 0, "agent");
    s.pending_permission_rpc_id = Some(7);
    s.pending_permission_ui = Some(UiPermissionRequest {
        rpc_id: 7,
        session_id: "session-1".into(),
        tool_call_id: "tc-1".into(),
        tool_name: "run_terminal_command".into(),
        title: "Run command".into(),
        preview: "{}".into(),
        scope_key: "shell:ls".into(),
        options: serde_json::json!([]),
    });
    *mgr.inner.lock() = Some(s);

    let got = mgr
        .pending_permission(Some("session-1".into()))
        .expect("pending card should be recoverable");
    assert_eq!(got.rpc_id, 7);
    assert_eq!(got.tool_name, "run_terminal_command");

    // Unknown ids never fall back to another chat.
    assert!(mgr.pending_permission(Some("other".into())).is_none());

    // rpc_id is the invalidation gate: once cleared (resolve / recycle /
    // stop), a stale stored card must not resurrect the bar.
    mgr.with_session_mut("session-1", |s| {
        s.pending_permission_rpc_id = None;
    });
    assert!(mgr.pending_permission(Some("session-1".into())).is_none());
}

#[test]
fn empty_run_does_not_signal_when_assistant_body_exists_without_tools() {
    // #128: pure-text agent replies must not toast.
    let s = sample_live_for_empty_run("Here is a normal answer.", "", 0, "agent");
    assert!(SessionManager::empty_run_signal_from_live(&s, "end_turn").is_none());
}

#[test]
fn empty_run_signals_when_no_body_and_no_tools() {
    let s = sample_live_for_empty_run("", "thinking only", 0, "agent");
    let sig = SessionManager::empty_run_signal_from_live(&s, "end_turn")
        .expect("thought-only zero-tool turn should soft-signal");
    assert_eq!(sig.0, "session-1");
    assert_eq!(sig.2, "agent");
}

#[test]
fn empty_run_skips_ask_mode_and_tool_turns() {
    let ask = sample_live_for_empty_run("", "", 0, "ask");
    assert!(SessionManager::empty_run_signal_from_live(&ask, "end_turn").is_none());
    let tools = sample_live_for_empty_run("", "", 2, "agent");
    assert!(SessionManager::empty_run_signal_from_live(&tools, "end_turn").is_none());
}

#[test]
fn session_load_replay_gate_matches_prompt_in_flight() {
    // session/load replay: no prompt RPC and no deferred complete → drop.
    assert!(SessionManager::is_session_load_replay_flags(false, false));
    // Live turn (prompt in flight): apply all side effects.
    assert!(!SessionManager::is_session_load_replay_flags(true, false));
    // Early prompt_complete with tools still open: keep applying chunks (P0-3).
    assert!(!SessionManager::is_session_load_replay_flags(false, true));
}

#[test]
fn extract_tool_input_accepts_bare_string_raw_input() {
    // Shell wrappers may send rawInput as a plain string (not an object).
    let bare = serde_json::json!({ "rawInput": "ls -la /tmp" });
    assert_eq!(extract_tool_input(&bare).as_deref(), Some("ls -la /tmp"));
    let obj = serde_json::json!({ "rawInput": { "command": "pwd" } });
    assert_eq!(extract_tool_input(&obj).as_deref(), Some("pwd"));
    let empty = serde_json::json!({ "rawInput": "   " });
    assert_eq!(extract_tool_input(&empty), None);
}

#[test]
fn tool_meta_reads_escaped_x_ai_pointer() {
    // Real grok CLI payload: the _meta key is literally "x.ai/tool".
    // A JSON Pointer MUST escape the inner slash as ~1 (RFC 6901); the unescaped
    // form never resolves and silently dropped the machine tool name.
    let raw: serde_json::Value = serde_json::from_str(
        r#"{"_meta":{"x.ai/tool":{"name":"read_file","kind":"read","label":"Read"}}}"#,
    )
    .unwrap();
    assert!(raw.pointer("/_meta/x.ai/tool/name").is_none());
    assert_eq!(tool_meta_str(&raw, "name").as_deref(), Some("read_file"));
    assert_eq!(tool_meta_str(&raw, "label").as_deref(), Some("Read"));
    assert_eq!(tool_meta_str(&raw, "kind").as_deref(), Some("read"));
}

#[test]
fn enrich_tool_identity_recovers_from_meta_when_title_is_machine_name() {
    // Start notification: title is the raw machine name, kind is absent — the
    // _meta block is the only source for a typed kind. Used to fall through to
    // kind="tool" / title="tool" because the pointer was unescaped.
    let raw: serde_json::Value = serde_json::from_str(
        r#"{"title":"read_file","_meta":{"x.ai/tool":{"name":"read_file","kind":"read","label":"Read"}}}"#,
    )
    .unwrap();
    let (kind, title) = enrich_tool_identity_from_raw(&raw, "read_file", "");
    // The journal stores the machine tool name as `kind` so the UI can map it
    // to a typed icon/label (read_file → “查看/读取”). The pre-fix result was
    // the bare fallback "tool"; the recovery must yield a real identity.
    assert_eq!(title, "read_file");
    assert_ne!(kind, "tool");
    assert!(!kind.is_empty());
}

#[test]
fn extract_tool_output_pulls_text_and_diff_headers() {
    let raw: serde_json::Value = serde_json::from_str(
        r#"{
            "content": [
                {"type":"content","content":{"type":"text","text":"1→package foo\n2→bar"}},
                {"type":"diff","path":"src/lib.rs","oldText":"","newText":"fn main(){}"}
            ]
        }"#,
    )
    .unwrap();
    let out = extract_tool_output(&raw).expect("output");
    assert!(out.contains("1→package foo"));
    assert!(out.contains("--- src/lib.rs"));
    // Diff bodies are summarized as a header only — the diff panel renders them.
    assert!(!out.contains("fn main(){}"));
}

#[test]
fn extract_tool_output_handles_bare_string_entries() {
    let raw: serde_json::Value = serde_json::json!({ "content": ["hello\nworld", "", "tail"] });
    let out = extract_tool_output(&raw).expect("output");
    // Empty chunks are dropped; the rest join with single newlines.
    assert_eq!(out, "hello\nworld\ntail");
}

#[test]
fn extract_tool_output_returns_none_when_empty() {
    assert!(extract_tool_output(&serde_json::json!({ "content": [] })).is_none());
    assert!(extract_tool_output(&serde_json::json!({})).is_none());
}

#[test]
fn provider_retry_abort_skips_idle_and_connecting_reconnect() {
    // Diagnostic 65fa7759: session/load residual retry_state while Connecting/Ready
    // must not write NETWORK_PROVIDER or fail_with without a host turn.
    assert!(!should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        false,
        SessionState::Connecting,
    ));
    assert!(!should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        false,
        SessionState::Ready,
    ));
    assert!(!should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        false,
        SessionState::Disconnected,
    ));
    // Real host turn: prompt open.
    assert!(should_apply_provider_retry_abort_flags(
        true,
        false,
        false,
        false,
        SessionState::Streaming,
    ));
    // Early prompt_complete but stream still open.
    assert!(should_apply_provider_retry_abort_flags(
        false,
        true,
        false,
        false,
        SessionState::Ready,
    ));
    // Open tools / deferred complete still count as host-owned.
    assert!(should_apply_provider_retry_abort_flags(
        false,
        false,
        true,
        false,
        SessionState::Ready,
    ));
    assert!(should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        true,
        SessionState::Ready,
    ));
    // Explicit mid-turn FSM without prompt flag (stream path).
    assert!(should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        false,
        SessionState::Streaming,
    ));
    assert!(should_apply_provider_retry_abort_flags(
        false,
        false,
        false,
        false,
        SessionState::AwaitingPermission,
    ));
}

#[test]
fn plan_event_gate_accepts_resume_repark_without_prompt() {
    // Grok Build re-issues exit_plan_mode after session/load with no prompt.
    assert!(!SessionManager::should_drop_plan_event(
        /* prompt_in_flight */ false, /* pending_plan */ false,
        /* has_rpc_id */ true,
    ));
    // Progress while a gate is already open (prompt may have completed early).
    assert!(!SessionManager::should_drop_plan_event(false, true, false));
    // Mid-turn drafting updates.
    assert!(!SessionManager::should_drop_plan_event(true, false, false));
    // Idle load-replay plan notification only.
    assert!(SessionManager::should_drop_plan_event(false, false, false));
}

#[test]
fn ask_user_event_never_dropped_as_load_replay() {
    assert!(!SessionManager::should_drop_ask_user_event(false));
    assert!(!SessionManager::should_drop_ask_user_event(true));
}

fn hint(app: &str, process: &str, agent: Option<&str>, pif: bool) -> SessionRouteHint {
    SessionRouteHint {
        app_session_id: app.into(),
        process_id: process.into(),
        agent_session_id: agent.map(|s| s.into()),
        prompt_in_flight: pif,
    }
}

#[test]
fn route_stamped_foreign_load_never_hits_parked_co_tenant() {
    // P0: chat B session/load on shared process P while A is parked on P.
    // Events stamped with B's agent id must not rescue/write A.
    let live = hint("chat-b", "proc-p", Some("agent-b"), false);
    let parked = [hint("chat-a", "proc-p", Some("agent-a"), false)];
    assert_eq!(
        resolve_turn_event_route("proc-p", Some("agent-b"), Some(&live), &[], &parked),
        TurnEventRoute::Live
    );
    // Orphan / load tail stamped for parked A → Drop (never rescue).
    assert_eq!(
        resolve_turn_event_route("proc-p", Some("agent-a"), Some(&live), &[], &parked),
        TurnEventRoute::Drop
    );
}

#[test]
fn route_stamped_event_does_not_wildcard_unbound_live_hint() {
    // During a connect/open transition the live slot may not have recorded
    // its agent id yet. A stamped event from another session must be dropped,
    // not accepted merely because the process id matches.
    let live = hint("chat-live", "proc-p", None, true);
    let parked = [hint("chat-other", "proc-p", Some("agent-other"), false)];
    assert_eq!(
        resolve_turn_event_route("proc-p", Some("agent-other"), Some(&live), &[], &parked),
        TurnEventRoute::Drop
    );
}

#[test]
fn route_stamped_event_does_not_wildcard_unbound_background_hint() {
    let live = hint("chat-live", "proc-other", Some("agent-live"), false);
    let bg = [hint("chat-bg", "proc-p", None, true)];
    assert_eq!(
        resolve_turn_event_route("proc-p", Some("agent-foreign"), Some(&live), &bg, &[]),
        TurnEventRoute::Drop
    );
}

#[test]
fn route_unstamped_load_on_shared_process_does_not_rescue_parked() {
    // Before fix: unstamped load replay → rescue parked A with pif=true → journal poison.
    let live = hint("chat-b", "proc-p", Some("agent-b"), false);
    let parked = [hint("chat-a", "proc-p", Some("agent-a"), false)];
    assert_eq!(
        resolve_turn_event_route("proc-p", None, Some(&live), &[], &parked),
        TurnEventRoute::Live
    );
    // Live not yet bound to process, only parked co-tenant → Drop.
    assert_eq!(
        resolve_turn_event_route("proc-p", None, None, &[], &parked),
        TurnEventRoute::Drop
    );
}

#[test]
fn route_unstamped_prefers_unique_busy_background_over_connecting_live() {
    let live = hint("chat-b", "proc-p", Some("agent-b"), false);
    let bg = [hint("chat-a", "proc-p", Some("agent-a"), true)];
    assert_eq!(
        resolve_turn_event_route("proc-p", None, Some(&live), &bg, &[]),
        TurnEventRoute::Background("chat-a".into())
    );
}

#[test]
fn route_stamped_mid_turn_background() {
    let live = hint("chat-b", "proc-other", Some("agent-b"), false);
    let bg = [hint("chat-a", "proc-p", Some("agent-a"), true)];
    assert_eq!(
        resolve_turn_event_route("proc-p", Some("agent-a"), Some(&live), &bg, &[]),
        TurnEventRoute::Background("chat-a".into())
    );
}

#[test]
fn rescue_parked_never_forces_prompt_in_flight() {
    // Safety net if rescue is ever called again: must not invent a mid-turn.
    let mgr = SessionManager::new();
    assert!(mgr.rescue_parked_to_background("no-such-process").is_none());
}

#[test]
fn empty_run_skips_when_saw_model_output_even_if_buf_cleared() {
    let mut s = sample_live_for_empty_run("", "", 0, "agent");
    s.saw_model_output = true;
    assert!(SessionManager::empty_run_signal_from_live(&s, "end_turn").is_none());
}

#[test]
fn journal_assistant_after_last_user_detects_answered_turn() {
    let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
