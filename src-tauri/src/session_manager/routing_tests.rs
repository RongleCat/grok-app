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
            fork_rewind_prompt_index: None,
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
fn pending_ask_user_recovers_questionnaire_until_invalidated() {
    // Same one-shot recovery as the approval bar, and more urgent: the agent
    // blocks on the `_x.ai/ask_user_question` reverse RPC and the stall
    // watchdog skips sessions holding an ask gate, so a missed
    // `session://ask_user` emit left the chat "thinking" with nothing to click.
    let mgr = SessionManager::new();
    let mut s = sample_live_for_empty_run("", "", 0, "agent");
    s.pending_ask_user_rpc_id = Some(11);
    s.pending_ask_user_ui = Some(UiAskUserRequest {
        rpc_id: 11,
        session_id: "session-1".into(),
        tool_call_id: Some("tc-9".into()),
        questions: vec![crate::acp_client::AskUserQuestionItem {
            id: "q1".into(),
            question: "Which database?".into(),
            options: vec![],
            multi_select: false,
        }],
    });
    *mgr.inner.lock() = Some(s);

    let got = mgr
        .pending_ask_user(Some("session-1".into()))
        .expect("pending questionnaire should be recoverable");
    assert_eq!(got.rpc_id, 11);
    assert_eq!(got.questions.len(), 1);
    assert_eq!(got.questions[0].question, "Which database?");

    // Unknown ids never fall back to another chat.
    assert!(mgr.pending_ask_user(Some("other".into())).is_none());

    // rpc_id is the invalidation gate: once answered / recycled / stopped, a
    // stale stored questionnaire must not resurrect the gate.
    mgr.with_session_mut("session-1", |s| {
        s.pending_ask_user_rpc_id = None;
    });
    assert!(mgr.pending_ask_user(Some("session-1".into())).is_none());
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

include!("routing_tests_p2.rs");
