//! ACP golden fixtures — protocol regression suite (T06).
//!
//! Loads JSON under `tests/fixtures/acp/` and asserts Host wire builders,
//! pure decoders, permission option mapping, and mock_acp streaming.
//! No network, no real CLI. Required for ACP protocol changes (see CI + SPIKE-ACP).

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use crate::acp_client::{
    decode_permission_request, decode_session_update, parse_ask_user_question_params,
    wire_ask_user_result, wire_exit_plan_mode_result, wire_initialize_params, wire_jsonrpc_result,
    wire_permission_result, wire_session_cancel_params, wire_session_prompt_params, AcpEvent,
    AskUserOutcome, PermissionOutcome, StreamKind,
};
use crate::mock_acp::{chunk_text, mock_reply_for, spawn_fake_stream_channel};
use crate::permission::pick_option_id;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/acp")
}

fn load_fixture(name: &str) -> Value {
    let path = fixtures_dir().join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

// ── Handshake ───────────────────────────────────────────────────────────────

#[test]
fn handshake_initialize_params_match_fixture() {
    let fx = load_fixture("handshake_initialize.json");
    let expected = &fx["hostRequest"]["params"];
    let actual = wire_initialize_params();
    assert_eq!(
        actual, *expected,
        "wire_initialize_params drifted from handshake_initialize.json"
    );

    assert_eq!(
        actual["protocolVersion"],
        fx["expect"]["protocolVersion"]
    );
    assert_eq!(
        actual["clientInfo"]["name"].as_str(),
        fx["expect"]["clientName"].as_str()
    );
    assert!(
        actual["capabilities"].is_object(),
        "capabilities must be object"
    );

    // Sample agent result must advertise the same protocol version.
    assert_eq!(
        fx["sampleAgentResult"]["protocolVersion"],
        actual["protocolVersion"]
    );
}

#[test]
fn session_prompt_and_cancel_wire_shapes() {
    let stop = load_fixture("stop_cancel.json");
    let sid = stop["expect"]["sessionId"].as_str().unwrap();
    assert_eq!(
        wire_session_cancel_params(sid),
        stop["hostNotification"]["params"]
    );

    let prompt = wire_session_prompt_params("sess-a", "hello");
    assert_eq!(prompt["sessionId"], "sess-a");
    assert_eq!(
        prompt["prompt"],
        json!([{ "type": "text", "text": "hello" }])
    );
}

// ── Stream chunks (real ACP session/update decoder) ─────────────────────────

#[test]
fn stream_session_update_chunks_match_fixture() {
    let fx = load_fixture("stream_chunks.json");
    let inbound = fx["inbound"].as_array().expect("inbound array");
    let expect_events = fx["expect"]["events"].as_array().expect("expect.events");

    assert_eq!(inbound.len(), expect_events.len());

    let mut assistant_joined = String::new();
    for (i, (msg, exp)) in inbound.iter().zip(expect_events.iter()).enumerate() {
        let params = msg.get("params").expect("params");
        let events = decode_session_update(params);
        assert_eq!(
            events.len(),
            1,
            "inbound[{i}] should decode to one stream event"
        );
        match &events[0] {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                let kind_s = match kind {
                    StreamKind::Assistant => "assistant",
                    StreamKind::Thought => "thought",
                };
                assert_eq!(kind_s, exp["kind"].as_str().unwrap(), "event[{i}].kind");
                assert_eq!(text, exp["text"].as_str().unwrap(), "event[{i}].text");
                assert_eq!(
                    message_id.as_deref(),
                    exp["messageId"].as_str(),
                    "event[{i}].messageId"
                );
                assert_eq!(*done, exp["done"].as_bool().unwrap(), "event[{i}].done");
                if matches!(kind, StreamKind::Assistant) {
                    assistant_joined.push_str(text);
                }
            }
            other => panic!("event[{i}] expected Stream, got {other:?}"),
        }
    }

    assert_eq!(
        assistant_joined,
        fx["expect"]["joinedAssistantText"].as_str().unwrap()
    );
    assert_eq!(
        fx["sessionPromptResult"]["stopReason"].as_str(),
        Some("end_turn")
    );
}

// ── Stop / cancel ───────────────────────────────────────────────────────────

#[tokio::test]
async fn stop_mid_stream_emits_done_matching_fixture() {
    let fx = load_fixture("stop_cancel.json");
    let done_shape = &fx["mockStopDoneChunk"];

    let (handle, mut rx) = spawn_fake_stream_channel(
        done_shape["sessionId"].as_str().unwrap().into(),
        done_shape["messageId"].as_str().unwrap().into(),
        "long prompt for more chunks than one".into(),
        Duration::from_millis(40),
    );

    let first = rx.recv().await.expect("first chunk");
    assert_eq!(first.session_id, done_shape["sessionId"].as_str().unwrap());
    handle.request_stop();

    let mut saw_done = false;
    while let Some(c) = rx.recv().await {
        if c.done {
            assert_eq!(c.session_id, done_shape["sessionId"].as_str().unwrap());
            assert_eq!(c.message_id, done_shape["messageId"].as_str().unwrap());
            // Stop path: empty text + done (see mock_acp::spawn_fake_stream).
            assert_eq!(c.text, done_shape["text"].as_str().unwrap_or(""));
            assert!(c.done);
            saw_done = true;
            break;
        }
    }
    let _ = handle.join.await;
    assert!(saw_done, "stop should finish with done=true");
}

// ── Permission request options ──────────────────────────────────────────────

#[test]
fn permission_request_decode_and_option_mapping() {
    let fx = load_fixture("permission_request.json");
    let inbound = &fx["inbound"];
    let params = &inbound["params"];
    let rpc_id = inbound["id"].as_u64().unwrap();

    let ev = decode_permission_request(rpc_id, params);
    match ev {
        AcpEvent::PermissionRequest {
            rpc_id: rid,
            tool_call_id,
            tool_name,
            title,
            options,
            ..
        } => {
            assert_eq!(rid, fx["expect"]["rpcId"].as_u64().unwrap());
            assert_eq!(
                tool_call_id,
                fx["expect"]["toolCallId"].as_str().unwrap()
            );
            assert_eq!(tool_name, fx["expect"]["toolName"].as_str().unwrap());
            assert_eq!(title, fx["expect"]["title"].as_str().unwrap());

            let map = &fx["expect"]["optionMap"];
            for (prefer, expected_id) in map.as_object().unwrap() {
                let got = pick_option_id(&options, prefer);
                assert_eq!(
                    got.as_deref(),
                    expected_id.as_str(),
                    "pick_option_id({prefer})"
                );
            }
        }
        other => panic!("expected PermissionRequest, got {other:?}"),
    }

    // Host reply envelopes
    let selected = wire_jsonrpc_result(
        rpc_id,
        wire_permission_result(&PermissionOutcome::Selected {
            option_id: "allow-once".into(),
        }),
    );
    assert_eq!(selected, fx["hostReplySelected"]);

    let cancelled =
        wire_jsonrpc_result(rpc_id, wire_permission_result(&PermissionOutcome::Cancelled));
    assert_eq!(cancelled, fx["hostReplyCancelled"]);

    // Underscore optionIds (shell-style)
    let us = &fx["underscoreOptionIds"];
    let opts = &us["options"];
    for (prefer, expected_id) in us["expect"].as_object().unwrap() {
        assert_eq!(
            pick_option_id(opts, prefer).as_deref(),
            expected_id.as_str(),
            "underscore pick_option_id({prefer})"
        );
    }
}

// ── ask_user_question ───────────────────────────────────────────────────────

#[test]
fn ask_user_question_parse_and_replies_match_fixture() {
    let fx = load_fixture("ask_user_question.json");
    let params = &fx["inbound"]["params"];
    let parsed = parse_ask_user_question_params(params);

    assert_eq!(
        parsed.tool_call_id.as_deref(),
        fx["expect"]["toolCallId"].as_str()
    );
    let expect_q = fx["expect"]["questions"].as_array().unwrap();
    assert_eq!(parsed.questions.len(), expect_q.len());
    assert_eq!(
        parsed.questions[0].question,
        expect_q[0]["question"].as_str().unwrap()
    );
    assert_eq!(
        parsed.questions[0].multi_select,
        expect_q[0]["multiSelect"].as_bool().unwrap()
    );
    let labels: Vec<&str> = parsed.questions[0]
        .options
        .iter()
        .map(|o| o.label.as_str())
        .collect();
    let expect_labels: Vec<&str> = expect_q[0]["optionLabels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(labels, expect_labels);

    let rpc_id = fx["inbound"]["id"].as_u64().unwrap();
    let accepted = wire_jsonrpc_result(
        rpc_id,
        wire_ask_user_result(&AskUserOutcome::Accepted {
            answers: json!({ "Which store?": "SQLite" }),
        }),
    );
    assert_eq!(accepted, fx["hostReplyAccepted"]);

    let cancelled =
        wire_jsonrpc_result(rpc_id, wire_ask_user_result(&AskUserOutcome::Cancelled));
    assert_eq!(cancelled, fx["hostReplyCancelled"]);
}

// ── exit_plan_mode / plan update ────────────────────────────────────────────

#[test]
fn exit_plan_mode_and_plan_update_match_fixture() {
    let fx = load_fixture("exit_plan_mode.json");
    let params = &fx["inbound"]["params"];
    let plan = params["planContent"].as_str().unwrap();
    assert!(
        plan.starts_with(fx["expect"]["planContentStartsWith"].as_str().unwrap()),
        "planContent prefix"
    );
    assert_eq!(
        params["toolCallId"].as_str(),
        fx["expect"]["toolCallId"].as_str()
    );

    let rpc_id = fx["inbound"]["id"].as_u64().unwrap();
    assert_eq!(
        wire_jsonrpc_result(rpc_id, wire_exit_plan_mode_result("approved", None)),
        fx["hostReplyApproved"]
    );
    assert_eq!(
        wire_jsonrpc_result(
            rpc_id,
            wire_exit_plan_mode_result("cancelled", Some("Please add tests first".into()))
        ),
        fx["hostReplyCancelledWithFeedback"]
    );
    assert_eq!(
        wire_jsonrpc_result(rpc_id, wire_exit_plan_mode_result("abandoned", None)),
        fx["hostReplyAbandoned"]
    );
    // Aliases normalize
    assert_eq!(
        wire_exit_plan_mode_result("approve", None)["outcome"],
        "approved"
    );
    assert_eq!(
        wire_exit_plan_mode_result("quit", None)["outcome"],
        "abandoned"
    );

    // session/update plan → Plan event
    let plan_params = &fx["sessionUpdatePlan"]["params"];
    let events = decode_session_update(plan_params);
    assert_eq!(events.len(), 1);
    match &events[0] {
        AcpEvent::Plan {
            body,
            entries,
            rpc_id,
            ..
        } => {
            assert!(rpc_id.is_none());
            assert_eq!(body.as_deref(), Some(plan));
            assert_eq!(entries.as_array().map(|a| a.len()), Some(2));
        }
        other => panic!("expected Plan, got {other:?}"),
    }
}

// ── mock_acp stream golden ──────────────────────────────────────────────────

#[test]
fn mock_reply_and_chunks_match_fixture() {
    let fx = load_fixture("mock_stream.json");
    let prompt = fx["prompt"].as_str().unwrap();
    let chunk_chars = fx["chunkChars"].as_u64().unwrap() as usize;

    let full = mock_reply_for(prompt);
    assert_eq!(full, fx["expectedFullText"].as_str().unwrap());

    let pieces = chunk_text(&full, chunk_chars);
    let expected: Vec<String> = fx["expectedChunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        pieces, expected,
        "chunk_text output drifted — regenerate mock_stream.json (see fixtures README)"
    );

    for needle in fx["expect"]["contains"].as_array().unwrap() {
        assert!(
            full.contains(needle.as_str().unwrap()),
            "reply missing {:?}",
            needle
        );
    }
}

#[tokio::test]
async fn mock_stream_emits_fixture_chunks_then_done() {
    let fx = load_fixture("mock_stream.json");
    let prompt = fx["prompt"].as_str().unwrap().to_string();
    let session_id = fx["sessionId"].as_str().unwrap().to_string();
    let message_id = fx["messageId"].as_str().unwrap().to_string();
    let expected: Vec<String> = fx["expectedChunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();

    let (handle, mut rx) = spawn_fake_stream_channel(
        session_id.clone(),
        message_id.clone(),
        prompt,
        Duration::from_millis(0),
    );

    let mut texts = Vec::new();
    let mut last_done = false;
    while let Some(c) = rx.recv().await {
        assert_eq!(c.session_id, session_id);
        assert_eq!(c.message_id, message_id);
        if !c.text.is_empty() {
            texts.push(c.text);
        }
        if c.done {
            last_done = true;
            break;
        }
    }
    handle.join.await.unwrap();

    assert!(last_done);
    assert!(
        texts.len() >= fx["expect"]["minChunks"].as_u64().unwrap() as usize
    );
    assert_eq!(texts, expected);
    assert_eq!(
        texts.concat(),
        fx["expectedFullText"].as_str().unwrap()
    );
}

/// Helper: print regenerated mock_stream chunk list when regenerating fixtures.
#[test]
#[ignore = "run with --ignored --nocapture to regenerate mock_stream.json chunks"]
fn print_mock_stream_chunks() {
    let prompt = "hi";
    let full = mock_reply_for(prompt);
    let pieces = chunk_text(&full, 6);
    println!("expectedFullText: {full:?}");
    println!(
        "expectedChunks:\n{}",
        serde_json::to_string_pretty(&pieces).unwrap()
    );
}
