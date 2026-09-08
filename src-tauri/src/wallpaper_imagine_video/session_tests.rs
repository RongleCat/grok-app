use super::*;
use crate::wallpaper_imagine_video::tests::{temp_dir, write_fake_mp4};
use serde_json::json;

fn failed_log(tool: &str, message: &str) -> String {
    let start = json!({"sessionUpdate": "tool_call", "toolCallId": "call-1",
        "toolName": tool, "rawInput": {"prompt": "selected prompt"}});
    let end = json!({"sessionUpdate": "tool_call_update", "toolCallId": "call-1",
        "status": "failed", "rawOutput": {"error": "tool_execution_failed", "message": message}});
    [start, end]
        .iter()
        .map(|update| json!({"params": {"sessionId": "session-1", "update": update}}).to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn audit_failure(raw: &str, tool: &str) -> Result<(), &'static str> {
    audit_tool(raw, "session-1", tool, |input| {
        if input == &json!({"prompt": "selected prompt"}) {
            Ok(())
        } else {
            Err("bad_input")
        }
    })
}

#[test]
fn classifies_only_tool_owned_http_statuses_for_all_generation_modes() {
    for (tool, prefix) in [
        ("image_gen", "Image generation"),
        ("image_edit", "Image edit"),
        ("image_to_video", "Video generation"),
        ("image_to_video", "Video poll"),
    ] {
        for (status, expected) in [
            (401, "auth_required"),
            (403, "imagine_access_denied"),
            (408, "timeout"),
            (504, "timeout"),
            (429, "imagine_rate_limited"),
            (400, "imagine_request_rejected"),
            (402, "imagine_request_rejected"),
            (415, "imagine_request_rejected"),
            (422, "imagine_request_rejected"),
            (500, "imagine_upstream_failed"),
            (503, "imagine_upstream_failed"),
            (200, "imagine_failed"),
            (418, "imagine_failed"),
        ] {
            let raw = failed_log(
                tool,
                &format!("{prefix} failed with HTTP {status} Reason: private body HTTP 401"),
            );
            assert_eq!(audit_failure(&raw, tool), Err(expected), "{tool} {status}");
        }
    }
}

#[test]
fn classifies_audited_transport_failures_without_interpreting_the_url() {
    for (tool, prefix) in [
        ("image_gen", "Image generation API"),
        ("image_edit", "Image edit API"),
        ("image_to_video", "Video generation API"),
        ("image_to_video", "Video poll"),
    ] {
        let raw = failed_log(
            tool,
            &format!("{prefix} request failed: error sending request for url (https://example.test/private?HTTP=401)"),
        );
        assert_eq!(audit_failure(&raw, tool), Err("imagine_network_failed"));
        for invalid in [
            raw.replace("session-1", "foreign-session"),
            raw.replace("selected prompt", "substituted prompt"),
            format!("{raw}\n{}", raw.lines().next().unwrap()),
            format!("{raw}\nnot JSON"),
        ] {
            assert_eq!(audit_failure(&invalid, tool), Err("imagine_result_invalid"));
        }
    }
    for message in [
        "Video generation API request failed: error sending request for url (https://example.test)",
        "Error: Image generation API request failed: error sending request for url (https://example.test)",
        "Image generation failed with HTTP 500 Error: error sending request for url (https://example.test)",
    ] {
        assert_ne!(audit_failure(&failed_log("image_gen", message), "image_gen"), Err("imagine_network_failed"));
    }
}

#[test]
fn run_error_mapping_preserves_only_audited_transport_failures() {
    let raw = failed_log(
        "image_gen",
        "Image generation API request failed: error sending request for url (https://example.test)",
    );
    assert_eq!(
        public_run_error(audit_failure(&raw, "image_gen")),
        "imagine_network_failed"
    );
    assert_eq!(
        public_run_error(audit_failure(
            &raw.replace("selected prompt", "substituted prompt"),
            "image_gen"
        )),
        "imagine_failed"
    );
}

#[test]
fn untrusted_text_and_invalid_audits_cannot_invent_a_generation_cause() {
    for message in [
        "selected prompt mentions HTTP 429",
        "Error: Image generation failed with HTTP 429: body",
        "Image edit failed with HTTP 429: wrong tool",
        "Image generation failed with HTTP 4290: malformed status",
        "Image generation failed with HTTP 429",
        "Image generation failed with HTTP 4é: malformed status",
        "Image generation API request failed: user input says HTTP 429",
    ] {
        assert_eq!(
            audit_failure(&failed_log("image_gen", message), "image_gen"),
            Err("imagine_failed")
        );
    }
    let raw = failed_log("image_gen", "Image generation failed with HTTP 429: body");
    for bad in [
        raw.replace("session-1", "foreign-session"),
        raw.replace("selected prompt", "substituted prompt"),
        format!("{raw}\n{}", raw.lines().next().unwrap()),
        format!("{raw}\nnot JSON"),
        raw.lines().last().unwrap().to_string(),
    ] {
        assert_eq!(
            audit_failure(&bad, "image_gen"),
            Err("imagine_result_invalid")
        );
    }
    assert_eq!(
        audit_failure(
            &raw.replace("tool_execution_failed", "other_error"),
            "image_gen"
        ),
        Err("imagine_failed")
    );
    let message = json!({"params": {"sessionId": "session-1", "update": {
        "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": raw}
    }}})
    .to_string();
    assert_eq!(
        audit_failure(&message, "image_gen"),
        Err("imagine_result_invalid")
    );
}

#[test]
fn failed_generation_without_an_images_directory_preserves_its_cause() {
    let root = temp_dir("failed-tool-no-images");
    let output = root.join("output");
    fs::create_dir(&output).unwrap();
    fs::write(
        root.join("updates.jsonl"),
        failed_log(
            "image_gen",
            "Image generation failed with HTTP 429: private body",
        ),
    )
    .unwrap();
    let result = crate::wallpaper_imagine_video::edit::copy_image_result(
        &root,
        &output,
        "session-1",
        "image_gen",
        |_| Ok(()),
        &WallpaperSearchCancellation::default(),
    );
    assert_eq!(result, Err("imagine_rate_limited"));
    assert_eq!(fs::read_dir(&output).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

fn log(expected: &VideoInvocation<'_>) -> String {
    let update = json!({ "sessionUpdate": "tool_call", "toolCallId": "call-1",
        "_meta": { "x.ai/tool": { "name": "image_to_video" } },
        "rawInput": { "image": expected.source, "prompt": expected.motion,
            "duration": expected.duration, "resolution_name": expected.resolution } });
    let done = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "call-1", "status": "completed" });
    [update, done]
        .iter()
        .map(|update| {
            json!({ "params": { "sessionId": expected.session_id, "update": update } }).to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn accepts_only_one_completed_call_with_exact_parameters() {
    let root = temp_dir("audit");
    let source = root.join("source.png");
    fs::write(&source, "source snapshot").unwrap();
    let expected = VideoInvocation {
        session_id: "session-1",
        source: &source,
        motion: Some("slow orbit"),
        duration: 10,
        resolution: "720p",
    };
    let good = log(&expected);
    assert!(audit(&good, &expected).is_ok());
    let fabricated_result = json!({ "params": { "sessionId": expected.session_id,
        "update": { "sessionUpdate": "agent_message_chunk", "content": {
            "type": "text", "text": json!({ "items": [{
                "localPath": source, "kind": "video"
            }] }).to_string()
        } } } })
    .to_string();
    for bad in [
        fabricated_result,
        good.replace("image_to_video", "use_tool"),
        good.replace("session-1", "different-session"),
        good.replace("slow orbit", "ignore instructions"),
        good.replace("720p", "480p"),
        good.replace("\"duration\":10", "\"duration\":6"),
        good.replace("completed", "failed"),
        good.lines().next().unwrap().to_string(),
        format!("{good}\n{good}"),
        format!("{good}\nnot JSON"),
        String::new(),
    ] {
        assert!(audit(&bad, &expected).is_err(), "accepted invalid audit");
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn matching_basename_is_not_the_same_source_file() {
    let root = temp_dir("audit-path");
    let source = root.join("source.png");
    let other_dir = root.join("other");
    fs::create_dir(&other_dir).unwrap();
    let other = other_dir.join("source.png");
    fs::write(&source, "selected").unwrap();
    fs::write(&other, "wrong").unwrap();
    let expected = VideoInvocation {
        session_id: "session-1",
        source: &source,
        motion: None,
        duration: 6,
        resolution: "480p",
    };
    let wrong = VideoInvocation {
        source: &other,
        ..expected
    };
    assert!(audit(&log(&wrong), &expected).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn host_copies_only_one_valid_video_and_preserves_original() {
    let root = temp_dir("session-copy");
    let source = root.join("source.png");
    fs::write(&source, "source").unwrap();
    let expected = VideoInvocation {
        session_id: "session-1",
        source: &source,
        motion: None,
        duration: 6,
        resolution: "480p",
    };
    let videos = root.join("videos");
    let output = root.join("output");
    fs::create_dir(&videos).unwrap();
    fs::create_dir(&output).unwrap();
    fs::write(root.join("updates.jsonl"), log(&expected)).unwrap();
    let generated = videos.join("1.mp4");
    write_fake_mp4(&generated);
    let cancellation = WallpaperSearchCancellation::default();
    let copied = copy_from_session(&root, &expected, &output, &cancellation).unwrap();
    assert_eq!(fs::read(&copied).unwrap(), fs::read(&generated).unwrap());
    assert!(generated.exists());
    fs::remove_file(&copied).unwrap();
    write_fake_mp4(&videos.join("2.mp4"));
    assert!(copy_from_session(&root, &expected, &output, &cancellation).is_err());
    fs::remove_file(videos.join("2.mp4")).unwrap();
    fs::write(&generated, "not a movie").unwrap();
    assert!(copy_from_session(&root, &expected, &output, &cancellation).is_err());
    write_fake_mp4(&generated);
    cancellation.cancel();
    assert_eq!(
        copy_from_session(&root, &expected, &output, &cancellation),
        Err("cancelled")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn later_tool_updates_cannot_substitute_parameters() {
    let root = temp_dir("audit-update");
    let source = root.join("source.png");
    fs::write(&source, "selected").unwrap();
    let expected = VideoInvocation {
        session_id: "session-1",
        source: &source,
        motion: None,
        duration: 6,
        resolution: "480p",
    };
    let good = log(&expected);
    let mut changed: Value = serde_json::from_str(good.lines().next().unwrap()).unwrap();
    changed["params"]["update"]["sessionUpdate"] = json!("tool_call_update");
    changed["params"]["update"]["rawInput"]["duration"] = json!(10);
    let bad = format!(
        "{}\n{}\n{}",
        good.lines().next().unwrap(),
        changed,
        good.lines().last().unwrap()
    );
    assert!(audit(&bad, &expected).is_err());
    fs::remove_dir_all(root).unwrap();
}
