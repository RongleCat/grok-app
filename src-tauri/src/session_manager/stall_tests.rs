//! Stall heal and tool identity tests.
#![cfg(test)]

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::journal_throttle::JournalWriteThrottle;
use crate::permission::{PermissionPolicy, SessionAllowCache};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::SessionMeta;

use super::*;

use serde_json::json;

/// Isolate store writes (`force_end` → journal/meta) from the real app home.
/// Without this, stall heal tests once rewrote production `sessions_index.json`.
fn with_temp_app_home<R>(f: impl FnOnce() -> R) -> R {
    let _lock = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!(
        "grok-app-stall-test-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).expect("tmp home");
    std::env::set_var("GROK_APP_HOME", &tmp);
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    std::env::remove_var("GROK_APP_HOME");
    let _ = std::fs::remove_dir_all(&tmp);
    match out {
        Ok(v) => v,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

fn streaming_session(now: Instant, mut patch: impl FnMut(&mut LiveSession)) -> LiveSession {
    let mut fsm = SessionFsm::new();
    let _ = fsm.start_connect();
    let _ = fsm.handshake_ok();
    let _ = fsm.begin_stream();
    let mut s = LiveSession {
        app_session_id: "stall-session".into(),
        process_id: "process-stall".into(),
        meta: SessionMeta {
            id: "stall-session".into(),
            project_id: None,
            title: "Stall".into(),
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
        streaming_message_id: Some("msg-1".into()),
        active_turn_id: Some("turn-1".into()),
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
    patch(&mut s);
    s
}

#[test]
fn new_turn_pre_token_uses_short_window_and_this_turn_tier() {
    // Grok 4.x high-effort first token is often 40–70s with an empty
    // thinking placeholder. Soft stall must stay pre_first_token (not
    // post_output from a prior answer) and must not fire at 45s.
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.prompt_in_flight = true;
            s.last_stream_progress = t0;
        });
        let at_45 = t0 + Duration::from_secs(45);
        assert!(
            SessionManager::tick_stream_stall_on_session(&mut s, None, 600, at_45).is_none(),
            "45s is inside the 90s pre-token window"
        );
        let at_90 = t0 + Duration::from_secs(90);
        match SessionManager::tick_stream_stall_on_session(&mut s, None, 600, at_90) {
            Some(StallTickAction::SoftStall {
                tier: crate::stream_stall::StallTier::PreFirstToken,
                stall_seconds: 90,
                saw_model_output: false,
                saw_tool_activity: false,
                ..
            }) => {}
            other => panic!("expected pre_first_token @ 90s, got {other:?}"),
        }
        assert_eq!(s.fsm.state(), SessionState::Streaming);
        assert!(s.prompt_in_flight);
    });
}

#[test]
fn maybe_done_soft_silence_prompts_never_auto_ends() {
    // Tools finished + partial assistant text; model may still be hung with
    // prompt_in_flight=true. Soft silence must only banner — never force-end.
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.saw_model_output = true;
            s.stream_buf = "搜到了不少最新动态…".into();
            s.tools_this_turn = 4;
            s.prompt_in_flight = true;
            s.last_stream_progress = t0;
        });
        let now = t0 + Duration::from_secs(180);
        let action = SessionManager::tick_stream_stall_on_session(&mut s, None, 180, now);
        match action {
            Some(StallTickAction::SoftStall {
                tier: crate::stream_stall::StallTier::MaybeDone,
                stall_seconds: 180,
                saw_model_output: true,
                ..
            }) => {}
            other => panic!("expected maybe_done soft stall, got {other:?}"),
        }
        assert_eq!(s.fsm.state(), SessionState::Streaming);
        assert!(s.prompt_in_flight);
        assert!(s.streaming_message_id.is_some());
    });
}

#[test]
fn no_auto_end_without_this_turn_body() {
    // Prior tools only — wait for soft banner / hard window, don't assume done.
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.tools_this_turn = 2;
            s.prompt_in_flight = true;
            s.last_stream_progress = t0;
        });
        let now = t0 + Duration::from_secs(180);
        let action = SessionManager::tick_stream_stall_on_session(&mut s, None, 180, now);
        match action {
            Some(StallTickAction::SoftStall { .. }) => {}
            other => panic!("expected soft stall without body, got {other:?}"),
        }
        assert_eq!(s.fsm.state(), SessionState::Streaming);
        assert!(s.prompt_in_flight);
    });
}

#[test]
fn orphan_open_tools_pruned_then_maybe_done_soft_only() {
    // Leaked open tool ids age out (TOOL_ORPHAN_SECONDS); then soft maybe-done
    // banner — still never auto-cancel while prompt_in_flight.
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.saw_model_output = true;
            s.open_tool_ids.insert("call_1".into());
            s.open_tool_seen_at.insert("call_1".into(), t0);
            s.tools_this_turn = 1;
            s.prompt_in_flight = true;
            s.last_stream_progress = t0;
        });
        let now = t0 + Duration::from_secs(180);
        let action = SessionManager::tick_stream_stall_on_session(&mut s, None, 180, now);
        match action {
            Some(StallTickAction::SoftStall {
                tier: crate::stream_stall::StallTier::MaybeDone,
                ..
            }) => {}
            other => panic!("expected maybe_done soft after orphan prune, got {other:?}"),
        }
        assert!(s.open_tool_ids.is_empty());
        assert_eq!(s.fsm.state(), SessionState::Streaming);
        assert!(s.prompt_in_flight);
    });
}

#[test]
fn hard_silence_never_force_ends_user_turn() {
    // 10+ minutes of pure silence used to force-end; must only soft-prompt.
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.prompt_in_flight = true;
            s.tools_this_turn = 1;
            s.last_stream_progress = t0;
        });
        let now = t0 + Duration::from_secs(600);
        let action = SessionManager::tick_stream_stall_on_session(&mut s, None, 180, now);
        match action {
            Some(StallTickAction::SoftStall { .. }) => {}
            other => panic!("expected soft stall at hard silence, got {other:?}"),
        }
        assert_eq!(s.fsm.state(), SessionState::Streaming);
        assert!(s.prompt_in_flight);
        assert!(s.streaming_message_id.is_some());
    });
}

/// P0-3: a recently-seen open tool after early prompt_complete must keep the
/// turn deferred — force-clearing dropped the rest of the answer as replay.
#[test]
fn deferred_prompt_complete_keeps_recent_open_tools() {
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.prompt_in_flight = false;
            s.deferred_prompt_complete = Some("end_turn".into());
            s.open_tool_ids.insert("live_silent_tool".into());
            s.open_tool_seen_at.insert("live_silent_tool".into(), t0);
            s.tools_this_turn = 1;
            s.saw_model_output = true;
        });
        let finished = SessionManager::try_finish_deferred_prompt_complete(&mut s, None);
        assert!(
            finished.is_none(),
            "recent open tools must keep deferred prompt_complete"
        );
        assert!(s.open_tool_ids.contains("live_silent_tool"));
        assert_eq!(s.deferred_prompt_complete.as_deref(), Some("end_turn"));
        assert_eq!(s.fsm.state(), SessionState::Streaming);
    });
}

/// #453 residual: aged orphan tool ids (TOOL_ORPHAN_SECONDS) prune, then
/// deferred complete may finish without a human gate.
#[test]
fn deferred_prompt_complete_finishes_after_orphan_prune() {
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let aged = t0 - Duration::from_secs(crate::stream_stall::TOOL_ORPHAN_SECONDS as u64 + 5);
        let mut s = streaming_session(t0, |s| {
            s.prompt_in_flight = false;
            s.deferred_prompt_complete = Some("end_turn".into());
            s.open_tool_ids.insert("ghost_bg_tool".into());
            s.open_tool_seen_at.insert("ghost_bg_tool".into(), aged);
            s.last_stream_progress = aged;
            s.tools_this_turn = 1;
            s.saw_model_output = true;
        });
        let finished = SessionManager::try_finish_deferred_prompt_complete(&mut s, None);
        assert!(
            finished.is_some(),
            "expected deferred finish after orphan prune"
        );
        assert!(s.open_tool_ids.is_empty());
        assert!(s.deferred_prompt_complete.is_none());
        assert!(!s.prompt_in_flight);
        assert_eq!(s.fsm.state(), SessionState::Ready);
        assert!(s.streaming_message_id.is_none());
    });
}

/// #754: session/prompt RPC Ok already finished the turn. A trailing
/// prompt_complete notification must not re-arm deferred finish.
#[test]
fn prompt_complete_does_not_rearm_after_turn_is_ready() {
    with_temp_app_home(|| {
        let t0 = Instant::now();
        let mut s = streaming_session(t0, |s| {
            s.prompt_in_flight = false;
            s.deferred_prompt_complete = Some("end_turn".into());
            s.saw_model_output = true;
        });
        let first = SessionManager::try_finish_deferred_prompt_complete(&mut s, None);
        assert!(first.is_some(), "first finish should complete the turn");
        assert_eq!(s.fsm.state(), SessionState::Ready);
        assert!(s.active_turn_id.is_none());
        assert!(!SessionManager::should_rearm_deferred_prompt_complete(&s));

        s.deferred_prompt_complete = Some("end_turn".into());
        let second = SessionManager::try_finish_deferred_prompt_complete(&mut s, None);
        assert!(
            second.is_none(),
            "duplicate prompt_complete must not finish again"
        );
        assert!(s.deferred_prompt_complete.is_none());
        assert_eq!(s.fsm.state(), SessionState::Ready);
    });
}

#[test]
fn prompt_complete_still_rearms_while_rpc_in_flight() {
    let t0 = Instant::now();
    let s = streaming_session(t0, |s| {
        s.prompt_in_flight = true;
        s.deferred_prompt_complete = None;
    });
    assert!(SessionManager::should_rearm_deferred_prompt_complete(&s));
}

#[test]
fn enrich_recovers_mcp_tool_name_from_sparse_completed() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "type": "MCP",
            "tool_name": "x_keyword_search",
            "server_name": "official-aux",
        },
        "rawInput": {
            "variant": "UseTool",
            "tool_name": "official-aux__x_keyword_search",
        },
        "_meta": {
            "x.ai/tool": { "name": "use_tool", "kind": "use_tool" }
        }
    });
    let (kind, title) = enrich_tool_identity_from_raw(&raw, "", "");
    assert!(
        title.contains("x_keyword_search") || title.contains("official-aux"),
        "title={title}"
    );
    assert_ne!(kind, "");
    assert_ne!(title.to_ascii_lowercase(), "tool");
}

#[test]
fn enrich_recovers_search_tool_from_variant() {
    let raw = json!({
        "status": "completed",
        "rawInput": { "variant": "SearchTool", "query": "twitter x search posts" },
        "_meta": { "x.ai/tool": { "name": "search_tool" } }
    });
    let (kind, title) = enrich_tool_identity_from_raw(&raw, "", "other");
    assert_eq!(kind, "search_tool");
    assert!(
        title.contains("search") || title.contains("twitter"),
        "title={title}"
    );
}

/// Regression for diag 5bda6b52: unanswered `ask_user_question` kept the session
/// busy after host stop markers were cleared (pending reverse-RPC not taken).
/// Stop must take `pending_ask_user_rpc_id` so `live_session_is_busy` returns false.
#[test]
fn clearing_pending_ask_user_releases_busy_after_stream_markers_drop() {
    let t0 = Instant::now();
    let mut s = streaming_session(t0, |s| {
        s.pending_ask_user_rpc_id = Some(0);
        s.prompt_in_flight = true;
    });
    assert!(
        SessionManager::live_session_is_busy(&s),
        "pending ask_user alone (with stream) must be busy"
    );

    // Mirror stop()'s marker release: take reverse-RPC ids + drop turn flags.
    let pending_ask = s.pending_ask_user_rpc_id.take();
    let pending_plan = s.pending_plan_rpc_id.take();
    assert_eq!(pending_ask, Some(0));
    assert!(pending_plan.is_none());
    s.streaming_message_id = None;
    s.active_turn_id = None;
    s.stream_message_id_locked = false;
    s.stream_buf.clear();
    s.open_tool_ids.clear();
    s.deferred_prompt_complete = None;
    s.prompt_in_flight = false;
    let _ = s.fsm.end_stream();

    assert!(
        !SessionManager::live_session_is_busy(&s),
        "after stop-style clear, pending ask_user must not leave the session busy"
    );
}
