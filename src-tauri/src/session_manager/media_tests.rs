//! Media path extract tests.
#![cfg(test)]

use super::*;

use serde_json::json;

#[test]
fn extracts_backtick_path_from_mcp_okay_output() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "type": "MCP",
            "tool_name": "image_edit",
            "server_name": "official-aux",
            "output": {
                "OkayOutput": "已完成 image_edit。\n\n**输出文件路径：**\n\n`/tmp/demo/images/1.jpg`\n\n（会话内相对路径：images/1.jpg）"
            }
        }
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
}

#[test]
fn extracts_path_from_content_text_markdown() {
    let raw = json!({
        "content": [{
            "type": "content",
            "content": {
                "type": "text",
                "text": "saved to /Users/me/out/pixel.png for you"
            }
        }]
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/Users/me/out/pixel.png")
    );
}

#[test]
fn normalizes_chatcut_protocol_relative_s3_url() {
    let raw = "//chatcut-production-mainbucketbucket-oxvbnfsx.s3.us-east-1.amazonaws.com/users/u/projects/p/assets/image/id/%E7%AC%AC2-thumbnail.jpg";
    assert_eq!(
        normalize_media_ref(raw).as_deref(),
        Some(
            "https://chatcut-production-mainbucketbucket-oxvbnfsx.s3.us-east-1.amazonaws.com/users/u/projects/p/assets/image/id/%E7%AC%AC2-thumbnail.jpg"
        )
    );
    assert!(!is_local_media_fs_path(raw));
    assert!(is_media_fs_path(&normalize_media_ref(raw).unwrap()));
}

#[test]
fn rejects_frame_name_placeholder() {
    assert!(normalize_media_ref("/<frame-name>.jpg").is_none());
    assert!(!is_local_media_fs_path("/<frame-name>.jpg"));
    let text = "tool_step|completed|use_tool|chatcut__view_timeline_frames\n/<frame-name>.jpg";
    // Must not return the placeholder as a media path.
    let got = first_media_path_in_text(text);
    assert!(
        got.as_ref().map(|s| !s.contains('<')).unwrap_or(true),
        "unexpected {got:?}"
    );
}

#[test]
fn collapses_double_slash_in_temp_frame_path() {
    let raw = "/var/folders/75/xx/T//chatcut-frames.qVukfi/f2150.jpg";
    assert_eq!(
        normalize_media_ref(raw).as_deref(),
        Some("/var/folders/75/xx/T/chatcut-frames.qVukfi/f2150.jpg")
    );
    assert!(is_local_media_fs_path(raw));
}

#[test]
fn extracts_chatcut_s3_from_mcp_text() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "output": "thumbnail: //cdn.example.com/a/b/thumb.jpg\n"
        }
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("https://cdn.example.com/a/b/thumb.jpg")
    );
}

#[test]
fn does_not_false_extract_relative_md_image_as_root_abs() {
    // Markdown in chat backups: `![](media/img_001.png)` used to yield `/img_001.png`
    // because the bare-path scanner started at the mid-relative `/`.
    let text = "see ![](media/img_001.png) and more";
    assert!(
        first_media_path_in_text(text).is_none(),
        "unexpected {:?}",
        first_media_path_in_text(text)
    );
    assert!(!is_plausible_local_media_abs("/img_001.png"));
    assert!(is_plausible_local_media_abs(
        "/Users/me/chat/media/img_001.png"
    ));
}

#[test]
fn still_extracts_real_absolute_media_in_markdown() {
    let text = "saved ![](/Users/me/out/pixel.png) for you";
    assert_eq!(
        first_media_path_in_text(text).as_deref(),
        Some("/Users/me/out/pixel.png")
    );
}

#[test]
fn structured_prefers_raw_output_path_over_freeform() {
    let raw = json!({
        "rawOutput": {
            "path": "/tmp/demo/images/1.jpg",
            "output": "also see /Users/me/other.png"
        }
    });
    assert_eq!(
        extract_structured_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
}

#[test]
fn freeform_scans_okay_output_when_no_structured_path() {
    let raw = json!({
        "rawOutput": {
            "output": {
                "OkayOutput": "done: `/tmp/demo/images/2.png`"
            }
        }
    });
    assert!(extract_structured_media_path(&raw).is_none());
    assert_eq!(
        extract_freeform_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/2.png")
    );
}

#[test]
fn prepare_rejects_missing_and_single_segment() {
    assert!(prepare_media_attachment_path("/img_001.png", None, true).is_none());
    assert!(
        prepare_media_attachment_path("/no/such/path/definitely-missing-xyz.png", None, true)
            .is_none()
    );
    // Remote always ok without disk.
    assert_eq!(
        prepare_media_attachment_path("https://cdn.example.com/a/b/thumb.jpg", None, false)
            .as_deref(),
        Some("https://cdn.example.com/a/b/thumb.jpg")
    );
}

#[test]
fn prepare_force_grants_existing_temp_media() {
    let dir = std::env::temp_dir().join(format!("grok-media-attach-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("shot.png");
    std::fs::write(&file, b"fake").expect("write");
    let path = file.to_string_lossy().to_string();
    let out = prepare_media_attachment_path(&path, None, true);
    assert_eq!(out.as_deref(), Some(path.as_str()));
    assert!(crate::path_scope::is_allowed(std::path::Path::new(&path)));
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir(&dir);
}
