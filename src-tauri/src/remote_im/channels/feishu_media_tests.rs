use super::*;
use crate::attachments::sanitize_file_name;

fn instance() -> ChannelInstance {
    ChannelInstance {
        id: "feishu-test".into(),
        channel: "feishu".into(),
        name: "test".into(),
        enabled: true,
        secrets: HashMap::new(),
        options: json!({}),
        acl: json!({}),
        project_scope: json!({}),
    }
}

fn event(message_type: &str, content: Value) -> Value {
    json!({
        "header": { "event_type": "im.message.receive_v1" },
        "event": {
            "sender": { "sender_id": { "open_id": "ou_user" } },
            "message": {
                "message_id": "om_1",
                "chat_id": "oc_1",
                "chat_type": "p2p",
                "message_type": message_type,
                "content": content.to_string(),
            }
        }
    })
}

#[test]
fn image_message_becomes_downloadable_media() {
    let parsed = parse_im_event(
        &instance(),
        &event("image", json!({ "image_key": "img_v3_123" })),
    )
    .expect("image event");

    assert_eq!(parsed.media.len(), 1);
    assert_eq!(parsed.media[0].key, "img_v3_123");
    assert_eq!(parsed.media[0].resource_type, "image");
    assert_eq!(parsed.media[0].kind, AttachmentKind::Image);
    assert_eq!(parsed.message.content, "");
}

#[test]
fn file_message_keeps_original_name() {
    let parsed = parse_im_event(
        &instance(),
        &event(
            "file",
            json!({ "file_key": "file_v3_1", "file_name": "错误截图.png" }),
        ),
    )
    .expect("file event");

    assert_eq!(parsed.media.len(), 1);
    assert_eq!(parsed.media[0].resource_type, "file");
    assert_eq!(parsed.media[0].file_name.as_deref(), Some("错误截图.png"));
}

#[test]
fn post_message_collects_text_and_images() {
    let parsed = parse_im_event(
        &instance(),
        &event(
            "post",
            json!({
                "title": "报错",
                "content": [
                    [
                        { "tag": "text", "text": "第一行" },
                        { "tag": "img", "image_key": "img_a" }
                    ],
                    [
                        { "tag": "text", "text": "第二行" },
                        { "tag": "img", "image_key": "img_b" }
                    ]
                ]
            }),
        ),
    )
    .expect("post event");

    assert_eq!(parsed.message.content, "报错\n第一行\n第二行");
    let keys: Vec<_> = parsed.media.iter().map(|m| m.key.as_str()).collect();
    assert_eq!(keys, vec!["img_a", "img_b"]);
}

#[test]
fn post_without_text_gets_attachment_lead() {
    let parsed = parse_im_event(
        &instance(),
        &event(
            "post",
            json!({ "content": [[{ "tag": "img", "image_key": "img_only" }]] }),
        ),
    )
    .expect("post event");

    assert_eq!(parsed.message.content, "");
    assert_eq!(parsed.media.len(), 1);
}

#[test]
fn post_locale_wrapper_is_unwrapped() {
    let parsed = parse_im_event(
            &instance(),
            &event(
                "post",
                json!({
                    "zh_cn": {
                        "title": "标题",
                        "content": [[{ "tag": "text", "text": "正文" }, { "tag": "img", "image_key": "img_zh" }]]
                    }
                }),
            ),
        )
        .expect("zh post");
    assert_eq!(parsed.message.content, "标题\n正文");
    assert_eq!(parsed.media[0].key, "img_zh");

    let parsed = parse_im_event(
        &instance(),
        &event(
            "post",
            json!({
                "en_us": {
                    "title": "Title",
                    "content": [[{ "tag": "img", "image_key": "img_en" }]]
                }
            }),
        ),
    )
    .expect("en post");
    assert_eq!(parsed.message.content, "Title");
    assert_eq!(parsed.media[0].key, "img_en");

    let parsed = parse_im_event(
        &instance(),
        &event("post", json!({ "zh_cn": { "title": "只有标题" } })),
    )
    .expect("title-only post");
    assert_eq!(parsed.message.content, "只有标题");
}

#[test]
fn sticker_media_is_kept() {
    let parsed = parse_im_event(
        &instance(),
        &event("sticker", json!({ "file_key": "sticker_1" })),
    )
    .expect("sticker event");

    assert_eq!(parsed.media.len(), 1);
    assert_eq!(parsed.media[0].resource_type, "file");
}

#[test]
fn unsafe_media_key_is_ignored() {
    assert!(parse_im_event(
        &instance(),
        &event("image", json!({ "image_key": "../../etc/passwd" })),
    )
    .is_none());
}

#[test]
fn media_list_is_capped() {
    let nodes: Vec<Value> = (0..20)
        .map(|i| json!({ "tag": "img", "image_key": format!("img_{i}") }))
        .collect();
    let parsed = parse_im_event(&instance(), &event("post", json!({ "content": [nodes] })))
        .expect("post event");

    assert_eq!(parsed.media.len(), MAX_INBOUND_FILES);
    assert!(parsed.media_truncated);
}

#[test]
fn duplicate_media_keys_are_deduplicated() {
    let parsed = parse_im_event(
        &instance(),
        &event(
            "post",
            json!({
                "content": [[
                    { "tag": "img", "image_key": "img_same" },
                    { "tag": "img", "image_key": "img_same" }
                ]]
            }),
        ),
    )
    .expect("post event");

    assert_eq!(parsed.media.len(), 1);
}

#[test]
fn file_name_sanitizer_strips_traversal() {
    assert_eq!(
        sanitize_file_name("../../evil.png").as_deref(),
        Some("evil.png")
    );
    let windows = sanitize_file_name("C:\\temp\\report.pdf").expect("windows name");
    assert!(!windows.contains('\\') && !windows.contains('/'));
    assert!(windows.ends_with("report.pdf"), "{windows}");
    assert_eq!(sanitize_file_name("..."), None);
    assert_eq!(sanitize_file_name(""), None);
}

#[test]
fn media_display_name_uses_content_type_for_unnamed_image() {
    let media = InboundMedia {
        key: "img_1".into(),
        resource_type: "image",
        kind: AttachmentKind::Image,
        file_name: None,
    };
    assert_eq!(
        media_display_name(&media, Some("image/jpeg; charset=binary")),
        "image.jpg"
    );
}

#[test]
fn media_display_name_keeps_safe_file_names() {
    let media = InboundMedia {
        key: "file_1".into(),
        resource_type: "file",
        kind: AttachmentKind::File,
        file_name: Some("README".into()),
    };
    assert_eq!(media_display_name(&media, Some("text/plain")), "README.txt");

    let named = InboundMedia {
        key: "file_2".into(),
        resource_type: "file",
        kind: AttachmentKind::File,
        file_name: Some("截图.png".into()),
    };
    assert_eq!(media_display_name(&named, None), "截图.png");
    assert!(!media_display_name(&named, None).contains('/'));
}

#[test]
fn prompt_failure_notes_stay_on_one_line() {
    let mut note = None;
    push_media_failure(&mut note, "HTTP 403\n<script>");
    let note = note.expect("note");
    let last = note.lines().last().unwrap();
    assert!(last.contains("HTTP 403"), "{last}");
    assert!(!last.contains('\n'), "{last}");
    assert!(last.chars().count() < 200, "{last}");
}

#[tokio::test]
async fn fetch_message_to_staging_writes_file_and_hash() {
    let (base, state, _stop) = crate::remote_im::fixture_http::spawn_fixture().await;
    state.set_route("/resources/img_1", 200, "PNGDATA");
    let client = http_client().expect("client");
    let dir = std::env::temp_dir().join(format!("feishu-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let temp = dir.join("a.part");
    let media = InboundMedia {
        key: "img_1".into(),
        resource_type: "image",
        kind: AttachmentKind::Image,
        file_name: None,
    };

    let got = fetch_message_to_staging(
        &client,
        &base,
        "tenant",
        "om_1",
        &media,
        &temp,
        MAX_INBOUND_MEDIA_BYTES,
    )
    .await
    .expect("download");

    assert_eq!(std::fs::read(&temp).unwrap(), b"PNGDATA");
    assert_eq!(got.size, 7);
    assert_eq!(got.sha256, hex::encode(Sha256::digest(b"PNGDATA")));
    let request = &state.request_paths()[0];
    assert!(
        request.contains("/open-apis/im/v1/messages/om_1/resources/img_1?type=image"),
        "{request}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn fetch_message_to_staging_surfaces_http_error() {
    let (base, state, _stop) = crate::remote_im::fixture_http::spawn_fixture().await;
    state.set_route("/resources/img_403", 403, "no permission");
    let client = http_client().expect("client");
    let dir = std::env::temp_dir().join(format!("feishu-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let temp = dir.join("a.part");
    let media = InboundMedia {
        key: "img_403".into(),
        resource_type: "image",
        kind: AttachmentKind::Image,
        file_name: None,
    };

    let err = fetch_message_to_staging(
        &client,
        &base,
        "tenant",
        "om_1",
        &media,
        &temp,
        MAX_INBOUND_MEDIA_BYTES,
    )
    .await
    .expect_err("must fail");

    assert!(err.contains("403"), "{err}");
    assert!(!err.contains("no permission"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn fetch_message_to_staging_rejects_oversized_body_and_cleans_up() {
    let (base, state, _stop) = crate::remote_im::fixture_http::spawn_fixture().await;
    state.set_route("/resources/big", 200, "x".repeat(128));
    let client = http_client().expect("client");
    let dir = std::env::temp_dir().join(format!("feishu-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let temp = dir.join("a.part");
    let media = InboundMedia {
        key: "big".into(),
        resource_type: "file",
        kind: AttachmentKind::File,
        file_name: None,
    };

    let err = fetch_message_to_staging(&client, &base, "tenant", "om_1", &media, &temp, 64)
        .await
        .expect_err("must be capped");

    assert!(err.contains("limit"), "{err}");
    assert!(!temp.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resource_ids_reject_path_characters() {
    assert!(is_safe_resource_id("om_1"));
    assert!(is_safe_resource_id("img_v3_02173-abc"));
    assert!(!is_safe_resource_id(""));
    assert!(!is_safe_resource_id("../x"));
    assert!(!is_safe_resource_id("a/b"));
    assert!(!is_safe_resource_id("a?b"));
}

fn incoming(sender: &str, chat_type: &str, mentioned: bool) -> IncomingMessage {
    IncomingMessage {
        staged_attachments: Vec::new(),
        attachment_note: None,
        channel: "feishu".into(),
        instance_id: "feishu-test".into(),
        message_id: "om_1".into(),
        chat_id: "oc_1".into(),
        chat_type: chat_type.into(),
        sender_id: sender.into(),
        content: "图片".into(),
        mentioned_bot: mentioned,
        thread_id: None,
    }
}

#[test]
fn media_gate_requires_allowlisted_sender() {
    let mut inst = instance();
    inst.acl = json!({ "allowFrom": "ou_allowed" });
    assert!(can_download_media(
        &inst,
        &incoming("ou_allowed", "p2p", true)
    ));
    assert!(!can_download_media(
        &inst,
        &incoming("ou_other", "p2p", true)
    ));
}

#[test]
fn media_gate_requires_mention_in_groups() {
    let mut inst = instance();
    inst.acl = json!({ "allowFrom": "*" });
    assert!(can_download_media(&inst, &incoming("ou_a", "p2p", false)));
    assert!(can_download_media(&inst, &incoming("ou_a", "group", true)));
    assert!(!can_download_media(
        &inst,
        &incoming("ou_a", "group", false)
    ));

    // `group_reply_all` turns the mention requirement off.
    inst.options = json!({ "group_reply_all": true });
    assert!(can_download_media(&inst, &incoming("ou_a", "group", false)));
}

#[test]
fn media_budget_saturates_and_resets_after_record() {
    let mut budget = MediaBudget::new();
    assert_eq!(budget.remaining(), MAX_MEDIA_BYTES_PER_CHAT_WINDOW);
    budget.record(MAX_MEDIA_BYTES_PER_CHAT_WINDOW + 10);
    assert_eq!(budget.remaining(), 0);
}
