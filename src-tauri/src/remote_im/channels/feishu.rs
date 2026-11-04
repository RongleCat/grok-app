//! Feishu / Lark long-connection (WS) + REST outbound — pure Rust.

use super::super::outbound::{
    http_client, opt_str, require_mention, secret_or_opt, sender_allowed,
};
use super::super::pb_frame::{decode_frame, encode_frame, Frame, Header};
use super::super::types::{ChannelInstance, IncomingMessage, StagedRemoteAttachment};
use crate::attachments::AttachmentKind;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const FRAME_CONTROL: i32 = 0;
const FRAME_DATA: i32 = 1;

/// One inbound message may reference at most this many media resources.
const MAX_INBOUND_FILES: usize = 16;

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let app_id = secret_or_opt(&inst.secrets, &inst.options, "app_id")
        .ok_or_else(|| "missing app_id".to_string())?;
    let app_secret = secret_or_opt(&inst.secrets, &inst.options, "app_secret")
        .ok_or_else(|| "missing app_secret".to_string())?;
    let domain = open_domain(&inst.channel, &inst.options);

    tracing::info!(
        instance = %inst.id,
        app_id = %app_id,
        domain = %domain,
        "feishu connector starting (Rust WS)"
    );

    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(
            &inst,
            &app_id,
            &app_secret,
            &domain,
            tx.clone(),
            &mut cancel,
        )
        .await
        {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
                tracing::warn!(instance = %inst.id, "feishu ws closed; reconnecting");
            }
            Err(e) => {
                tracing::error!(instance = %inst.id, "feishu ws error: {e}");
                if *cancel.borrow() {
                    return Err(e);
                }
            }
        }
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() { return Ok(()); }
            }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn run_once(
    inst: &ChannelInstance,
    app_id: &str,
    app_secret: &str,
    domain: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let (ws_url, service_id, ping_interval_ms) = pull_endpoint(domain, app_id, app_secret).await?;
    let (ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("ws connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    let mut ping_iv = tokio::time::interval(Duration::from_millis(ping_interval_ms.max(10_000)));
    ping_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // Media downloads run on a worker so a slow 50 MB attachment cannot stall
    // the WS read loop (heartbeat / pong / next ACK). One worker keeps message
    // order; it exits when this connection drops the sender.
    let (media_tx, media_rx) = mpsc::channel::<ParsedInbound>(16);
    {
        let worker_inst = inst.clone();
        let worker_tx = tx.clone();
        tokio::spawn(async move {
            run_media_worker(worker_inst, media_rx, worker_tx).await;
        });
    }

    // fragment cache: message_id -> (sum, parts)
    #[allow(clippy::type_complexity)]
    let mut fragments: HashMap<String, (usize, Vec<Option<Vec<u8>>>)> = HashMap::new();

    loop {
        tokio::select! {
                _ = cancel.changed() => {
                    if *cancel.borrow() {
                        let _ = write.close().await;
                        return Ok(());
                    }
                }
                _ = ping_iv.tick() => {
                    let frame = Frame {
                        seq_id: 0,
                        log_id: 0,
                        service: service_id,
                        method: FRAME_CONTROL,
                        headers: vec![Header { key: "type".into(), value: "ping".into() }],
                        ..Default::default()
                    };
                    let bin = encode_frame(&frame);
                    if write.send(Message::Binary(bin.into())).await.is_err() {
                        return Err("ws ping send failed".into());
                    }
                }
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Binary(b))) => {
                            let frame = decode_frame(&b).map_err(|e| format!("frame decode: {e}"))?;
                            let headers: HashMap<String, String> = frame
                                .headers
                                .iter()
                                .map(|h| (h.key.clone(), h.value.clone()))
                                .collect();
                            let ty = headers.get("type").map(|s| s.as_str()).unwrap_or("");
                            if frame.method == FRAME_CONTROL {
                                continue;
                            }
                            if frame.method != FRAME_DATA || ty != "event" {
                                continue;
                            }
                            let payload = frame.payload.clone().unwrap_or_default();
                            let merged = merge_payload(&mut fragments, &headers, payload);
                            // Peek event type before ACK so card.action.trigger gets a toast body
                            // (Feishu client otherwise shows timeout / failed interaction).
                            let peeked: Option<Value> = merged.as_ref().and_then(|b| {
                                serde_json::from_str(&String::from_utf8_lossy(b)).ok()
                            });
                            let is_card = peeked
                                .as_ref()
                                .map(|e| {
                                    e.pointer("/header/event_type")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .contains("card.action")
                                        || e.pointer("/event/action").is_some()
                                })
                                .unwrap_or(false);
                            let resp_bytes = if is_card {
                                serde_json::to_vec(&json!({
                                    "toast": {
                                        "type": "info",
                                        "content": "已收到"
                                    }
                                }))
                                .unwrap_or_else(|_| br#"{"code":200}"#.to_vec())
                            } else {
                                serde_json::to_vec(&json!({ "code": 200 })).unwrap_or_default()
                            };
                            let mut ack_headers = frame.headers.clone();
                            ack_headers.push(Header {
                                key: "biz_rt".into(),
                                value: "1".into(),
                            });
                            let ack = Frame {
                                seq_id: frame.seq_id,
                                log_id: frame.log_id,
                                service: service_id,
                                method: FRAME_DATA,
                                headers: ack_headers,
                                payload: Some(resp_bytes),
                                ..Default::default()
                            };
                            let _ = write
                                .send(Message::Binary(encode_frame(&ack).into()))
                                .await;
                            if let Some(bytes) = merged {
                                let text = String::from_utf8_lossy(&bytes);
                                let event: Value = serde_json::from_str(&text).unwrap_or(json!({}));
                                // Card action callback (card.action.trigger)
                                if let Some(content) = card_action_to_content(&event) {
                                    let (chat_id, sender) = card_action_ids(&event);
                                    let chat_id = if chat_id.is_empty() {
                                        if !sender.is_empty() {
                                            sender.clone()
                                        } else {
                                            "card".into()
                                        }
                                    } else {
                                        chat_id
                                    };
                                    tracing::info!(
                                        instance = %inst.id,
                                        %chat_id,
                                        %sender,
                                        %content,
                                        "feishu card.action.trigger"
                                    );
                                    if let Err(e) = tx
                                        .send(IncomingMessage {
        staged_attachments: Vec::new(),
        attachment_note: None,                                            channel: inst.channel.clone(),
                                            instance_id: inst.id.clone(),
                                            message_id: event
                                                .pointer("/event/context/open_message_id")
                                                .or_else(|| event.pointer("/header/event_id"))
                                                .and_then(|x| x.as_str())
                                                .unwrap_or("")
                                                .into(),
                                            chat_id,
                                            chat_type: "p2p".into(),
                                            sender_id: sender,
                                            content,
                                            mentioned_bot: true,
                                            thread_id: None,                                    })
                                        .await
                                    {
                                        tracing::error!(
                                            instance = %inst.id,
                                            err = %e,
                                            "feishu: engine channel closed — card action dropped"
                                        );
                                    }
                                } else if let Some(parsed) = parse_im_event(inst, &event) {
                                    // Hand off to the media worker; the WS loop keeps
                                    // reading heartbeats and the next events.
                                    match media_tx.try_send(parsed) {
                                        Ok(()) => {}
                                        Err(mpsc::error::TrySendError::Full(mut parsed)) => {
                                            // Never stall the socket on a slow disk: forward
                                            // the message without its attachments.
                                            if !parsed.media.is_empty() {
                                                push_media_failure(
                                                    &mut parsed.message.attachment_note,
                                                    "附件处理队列已满，请稍后重新发送",
                                                );
                                            }
                                            let message = parsed.message;
                                            tracing::warn!(
                                                instance = %inst.id,
                                                chat = %message.chat_id,
                                                "feishu media queue full — forwarding without attachments"
                                            );
                                            if let Err(e) = tx.send(message).await {
                                                tracing::error!(
                                                    instance = %inst.id,
                                                    err = %e,
                                                    "feishu: engine channel closed — message dropped"
                                                );
                                            }
                                        }
                                        Err(mpsc::error::TrySendError::Closed(_)) => {
                                            tracing::error!(
                                                instance = %inst.id,
                                                "feishu: media worker closed — message dropped"
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Ping(p))) => {
                            let _ = write.send(Message::Pong(p)).await;
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            return Ok(());
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => return Err(format!("ws read: {e}")),
                    }
                }
            }
    }
}

#[allow(clippy::type_complexity)]
fn merge_payload(
    fragments: &mut HashMap<String, (usize, Vec<Option<Vec<u8>>>)>,
    headers: &HashMap<String, String>,
    payload: Vec<u8>,
) -> Option<Vec<u8>> {
    let message_id = headers
        .get("message_id")
        .cloned()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let sum = headers
        .get("sum")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let seq = headers
        .get("seq")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if sum == 1 {
        return Some(payload);
    }
    let entry = fragments
        .entry(message_id.clone())
        .or_insert_with(|| (sum, vec![None; sum]));
    if seq < entry.1.len() {
        entry.1[seq] = Some(payload);
    }
    if entry.1.iter().all(|x| x.is_some()) {
        let mut all = Vec::new();
        for p in entry.1.iter().flatten() {
            all.extend_from_slice(p);
        }
        fragments.remove(&message_id);
        Some(all)
    } else {
        None
    }
}

/// One downloadable media part of an inbound Feishu message.
#[derive(Debug, Clone, PartialEq, Eq)]
struct InboundMedia {
    key: String,
    /// Feishu resource `type` query value: `image` or `file`.
    resource_type: &'static str,
    /// Store kind used for journal/preview.
    kind: AttachmentKind,
    /// Original name for file / video messages; images carry none.
    file_name: Option<String>,
}

/// Parsed message plus the media that still has to be downloaded.
struct ParsedInbound {
    message: IncomingMessage,
    media: Vec<InboundMedia>,
    /// The message referenced more than [`MAX_INBOUND_FILES`] resources.
    media_truncated: bool,
}

fn parse_im_event(inst: &ChannelInstance, root: &Value) -> Option<ParsedInbound> {
    // EventDispatcher wraps: { type, event: { message, sender } } or schema 2.0
    let event = root
        .get("event")
        .cloned()
        .or_else(|| root.get("data").and_then(|d| d.get("event")).cloned())
        .unwrap_or_else(|| root.clone());

    let header_type = root
        .get("header")
        .and_then(|h| h.get("event_type"))
        .and_then(|x| x.as_str())
        .or_else(|| root.get("type").and_then(|x| x.as_str()))
        .unwrap_or("");

    if !header_type.is_empty()
        && header_type != "im.message.receive_v1"
        && !header_type.contains("message")
    {
        // still try parse message body
    }

    let message = event.get("message")?;
    let msg_type = message
        .get("message_type")
        .and_then(|x| x.as_str())
        .unwrap_or("text");

    let content_raw = message
        .get("content")
        .and_then(|x| x.as_str())
        .unwrap_or("{}");
    let content_json: Value = serde_json::from_str(content_raw).unwrap_or(json!({}));
    let mut text = String::new();
    let mut media: Vec<InboundMedia> = Vec::new();
    let mut media_truncated = false;
    if msg_type == "post" {
        collect_post_content(&content_json, &mut text, &mut media, &mut media_truncated);
    } else {
        text = content_json
            .get("text")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        match msg_type {
            "image" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "image_key",
                "image",
                None,
                AttachmentKind::Image,
            ),
            "file" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                content_json.get("file_name").and_then(|x| x.as_str()),
                AttachmentKind::File,
            ),
            "audio" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                None,
                AttachmentKind::Audio,
            ),
            "media" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                content_json.get("file_name").and_then(|x| x.as_str()),
                AttachmentKind::Video,
            ),
            // Feishu stickers carry a plain `file_key`; store them as images.
            "sticker" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                None,
                AttachmentKind::Image,
            ),
            _ => {}
        }
    }
    // strip @mention placeholders like @_user_1
    let re_clean = regex_lite_strip_mentions(&text);

    let chat_id = message
        .get("chat_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = message
        .get("message_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat_type_raw = message
        .get("chat_type")
        .and_then(|x| x.as_str())
        .unwrap_or("p2p");
    let chat_type = if chat_type_raw == "group" || chat_type_raw == "public" {
        "group"
    } else {
        "p2p"
    };

    let sender_id = event
        .pointer("/sender/sender_id/open_id")
        .or_else(|| event.pointer("/sender/sender_id/user_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let mentions = message.get("mentions").and_then(|x| x.as_array());
    let mentioned_bot = mentions
        .map(|arr| {
            arr.iter().any(|m| {
                m.get("id")
                    .and_then(|id| id.get("open_id"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.starts_with("ou_"))
                    .unwrap_or(false)
                    || m.get("name")
                        .and_then(|x| x.as_str())
                        .map(|n| n.contains("bot") || n.contains("机器人"))
                        .unwrap_or(false)
                    || m.get("key").is_some()
            })
        })
        .unwrap_or(chat_type == "p2p");

    if re_clean.trim().is_empty() && media.is_empty() {
        return None;
    }
    let content = re_clean;

    Some(ParsedInbound {
        message: IncomingMessage {
            staged_attachments: Vec::new(),
            attachment_note: None,
            channel: inst.channel.clone(),
            instance_id: inst.id.clone(),
            message_id,
            chat_id,
            chat_type: chat_type.into(),
            sender_id,
            content,
            mentioned_bot: mentioned_bot || chat_type == "p2p",
            thread_id: None,
        },
        media,
        media_truncated,
    })
}

/// Pick the human body out of a `post` payload. Feishu wraps rich text in a
/// locale map (`{"zh_cn": {"title":…, "content":[…]}}`); older fixtures and
/// plain shapes put `title` / `content` at the top level.
fn post_body(content: &Value) -> &Value {
    if looks_like_post_body(content) {
        return content;
    }
    for locale in ["zh_cn", "en_us"] {
        if let Some(body) = content.get(locale) {
            if looks_like_post_body(body) {
                return body;
            }
        }
    }
    content
        .as_object()
        .and_then(|map| map.values().find(|v| looks_like_post_body(v)))
        .unwrap_or(content)
}

fn looks_like_post_body(value: &Value) -> bool {
    value.get("content").and_then(|x| x.as_array()).is_some()
        || value.get("title").and_then(|x| x.as_str()).is_some()
}

/// Collect text and media refs from a rich-text (`post`) message body.
fn collect_post_content(
    content: &Value,
    text: &mut String,
    media: &mut Vec<InboundMedia>,
    truncated: &mut bool,
) {
    let body = post_body(content);
    if let Some(title) = body
        .get("title")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        text.push_str(title);
    }
    let lines = body.get("content").and_then(|x| x.as_array());
    let Some(lines) = lines else {
        return;
    };
    for line in lines {
        let Some(nodes) = line.as_array() else {
            continue;
        };
        let mut line_text = String::new();
        for node in nodes {
            match node.get("tag").and_then(|x| x.as_str()).unwrap_or("") {
                "text" | "a" | "md" => {
                    if let Some(t) = node.get("text").and_then(|x| x.as_str()) {
                        line_text.push_str(t);
                    }
                }
                "at" => {
                    if let Some(name) = node.get("user_name").and_then(|x| x.as_str()) {
                        line_text.push('@');
                        line_text.push_str(name);
                    }
                }
                "img" => push_media(
                    media,
                    truncated,
                    node,
                    "image_key",
                    "image",
                    None,
                    AttachmentKind::Image,
                ),
                "media" => push_media(
                    media,
                    truncated,
                    node,
                    "file_key",
                    "file",
                    node.get("file_name").and_then(|x| x.as_str()),
                    AttachmentKind::Video,
                ),
                _ => {}
            }
        }
        let line_text = line_text.trim();
        if !line_text.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(line_text);
        }
    }
}

fn push_media(
    media: &mut Vec<InboundMedia>,
    truncated: &mut bool,
    node: &Value,
    key_field: &str,
    resource_type: &'static str,
    file_name: Option<&str>,
    kind: AttachmentKind,
) {
    let Some(key) = node
        .get(key_field)
        .and_then(|x| x.as_str())
        .map(str::trim)
        // Feishu keys are `img_v3_…` / `file_v3_…`; reject anything that could
        // alter the download URL path.
        .filter(|k| is_safe_resource_id(k))
    else {
        return;
    };
    if media.iter().any(|m| m.key == key) {
        return;
    }
    if media.len() >= MAX_INBOUND_FILES {
        *truncated = true;
        return;
    }
    media.push(InboundMedia {
        key: key.to_string(),
        resource_type,
        kind,
        file_name: file_name
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string),
    });
}

/// Feishu message ids (`om_…`) and resource keys use this charset only.
fn is_safe_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn regex_lite_strip_mentions(s: &str) -> String {
    // remove @_user_N and bare @xxx patterns used by Feishu
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '@' {
            // skip until space or end
            while let Some(&n) = chars.peek() {
                if n.is_whitespace() {
                    break;
                }
                chars.next();
            }
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

async fn pull_endpoint(
    domain: &str,
    app_id: &str,
    app_secret: &str,
) -> Result<(String, i32, u64), String> {
    let url = format!("https://{domain}/callback/ws/endpoint");
    let client = http_client()?;
    let res = client
        .post(&url)
        .header("locale", "zh")
        .json(&json!({
            "AppID": app_id,
            "AppSecret": app_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("endpoint request: {e}"))?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 {
        let msg = body
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("endpoint error");
        return Err(format!("feishu endpoint code={code}: {msg}"));
    }
    let data = body.get("data").cloned().unwrap_or(json!({}));
    let ws_url = data
        .get("URL")
        .or_else(|| data.get("url"))
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing WS URL".to_string())?
        .to_string();
    let service_id = extract_query_i32(&ws_url, "service_id").unwrap_or(0);
    let ping_sec = data
        .pointer("/ClientConfig/PingInterval")
        .or_else(|| data.pointer("/client_config/ping_interval"))
        .and_then(|x| x.as_u64())
        .unwrap_or(120);
    Ok((ws_url, service_id, ping_sec * 1000))
}

fn extract_query_i32(url: &str, key: &str) -> Option<i32> {
    let q = url.split('?').nth(1)?;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if k == key {
            return v.parse().ok();
        }
    }
    None
}

fn open_domain(channel: &str, options: &Value) -> String {
    if let Some(d) = opt_str(options, "domain") {
        return d
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .to_string();
    }
    if channel == "lark" {
        "open.larksuite.com".into()
    } else {
        "open.feishu.cn".into()
    }
}

pub async fn tenant_token(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
) -> Result<String, String> {
    let app_id = secret_or_opt(secrets, options, "app_id").ok_or("missing app_id")?;
    let app_secret = secret_or_opt(secrets, options, "app_secret").ok_or("missing app_secret")?;
    let domain = open_domain(channel, options);
    let url = format!("https://{domain}/open-apis/auth/v3/tenant_access_token/internal");
    let client = http_client()?;
    let body: Value = client
        .post(url)
        .json(&json!({ "app_id": app_id, "app_secret": app_secret }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if body.get("code").and_then(|c| c.as_i64()) != Some(0) {
        return Err(format!(
            "token: {}",
            body.get("msg").and_then(|m| m.as_str()).unwrap_or("fail")
        ));
    }
    body.get("tenant_access_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no tenant_access_token".into())
}

pub async fn send_text(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    chat_id: &str,
    reply_to: Option<&str>,
    text: &str,
) -> Result<(), String> {
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let client = http_client()?;
    // Feishu plain `text` does not render Markdown. Prefer interactive card (schema 2.0
    // markdown element) when content looks like MD — same approach as cc-connect.
    let (msg_type, content) = build_reply_payload(text);

    if let Some(mid) = reply_to {
        if !mid.is_empty() {
            let url = format!("https://{domain}/open-apis/im/v1/messages/{mid}/reply");
            let res = client
                .post(&url)
                .bearer_auth(&token)
                .json(&json!({
                    "content": content,
                    "msg_type": msg_type,
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if res.status().is_success() {
                return Ok(());
            }
            // fall through to create (reply may reject interactive on some clients)
        }
    }

    // open_id (ou_…) must use receive_id_type=open_id; oc_… uses chat_id.
    let id_type = receive_id_type(chat_id);
    let url = format!("https://{domain}/open-apis/im/v1/messages?receive_id_type={id_type}");
    let res = client
        .post(url)
        .bearer_auth(&token)
        .json(&json!({
            "receive_id": chat_id,
            "msg_type": msg_type,
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        // Fallback: plain text if card rejected
        if msg_type == "interactive" {
            return send_plain_text(channel, secrets, options, chat_id, reply_to, text).await;
        }
        return Err(format!(
            "feishu send HTTP {status}: {}",
            body.chars().take(200).collect::<String>()
        ));
    }
    Ok(())
}

async fn send_plain_text(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    chat_id: &str,
    reply_to: Option<&str>,
    text: &str,
) -> Result<(), String> {
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let client = http_client()?;
    let content = json!({ "text": text }).to_string();
    if let Some(mid) = reply_to.filter(|m| !m.is_empty()) {
        let url = format!("https://{domain}/open-apis/im/v1/messages/{mid}/reply");
        let res = client
            .post(&url)
            .bearer_auth(&token)
            .json(&json!({ "content": content, "msg_type": "text" }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().is_success() {
            return Ok(());
        }
    }
    let id_type = receive_id_type(chat_id);
    let url = format!("https://{domain}/open-apis/im/v1/messages?receive_id_type={id_type}");
    let res = client
        .post(url)
        .bearer_auth(&token)
        .json(&json!({
            "receive_id": chat_id,
            "msg_type": "text",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "feishu plain send: {}",
            body.chars().take(200).collect::<String>()
        ));
    }
    Ok(())
}

/// Choose Feishu payload: interactive markdown card vs plain text.
fn build_reply_payload(text: &str) -> (&'static str, String) {
    if !contains_markdown(text) {
        return ("text", json!({ "text": text }).to_string());
    }
    // Too many tables → post `md` tag (card limit ~5 tables).
    if count_markdown_tables(text) > 5 {
        let post = json!({
            "zh_cn": {
                "content": [[{ "tag": "md", "text": text }]]
            }
        });
        return ("post", post.to_string());
    }
    let md = preprocess_feishu_markdown(text);
    let card = json!({
        "schema": "2.0",
        "config": { "wide_screen_mode": true },
        "body": {
            "elements": [{
                "tag": "markdown",
                "content": md
            }]
        }
    });
    ("interactive", card.to_string())
}

fn contains_markdown(s: &str) -> bool {
    const INDS: &[&str] = &[
        "```", "**", "~~", "`", "\n- ", "\n* ", "\n1. ", "\n# ", "\n## ", "---", "| ", "](http",
    ];
    INDS.iter().any(|ind| s.contains(ind))
        || s.lines().any(|l| {
            let t = l.trim();
            t.starts_with('#') || t.starts_with('>') || (t.starts_with('|') && t.ends_with('|'))
        })
}

fn count_markdown_tables(s: &str) -> usize {
    let mut count = 0;
    let mut in_table = false;
    for line in s.lines() {
        let t = line.trim();
        let is_row = t.len() > 1 && t.starts_with('|') && t.ends_with('|');
        if is_row && !in_table {
            count += 1;
            in_table = true;
        } else if !is_row {
            in_table = false;
        }
    }
    count
}

fn preprocess_feishu_markdown(md: &str) -> String {
    // Ensure fenced code blocks are preceded by a newline for card renderer.
    let mut out = md.replace("\r\n", "\n");
    // Downgrade h1 → h4 (Feishu card renders h1 huge / broken)
    out = out
        .lines()
        .map(|l| {
            if let Some(rest) = l.strip_prefix("# ") {
                format!("#### {rest}")
            } else if let Some(rest) = l.strip_prefix("## ") {
                format!("#### {rest}")
            } else {
                l.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    out
}

fn receive_id_type(id: &str) -> &'static str {
    if id.starts_with("ou_") || id.starts_with("on_") {
        "open_id"
    } else if id.starts_with("cli_") {
        "app_id"
    } else {
        "chat_id"
    }
}

/// Send interactive card (msg_type=interactive).
pub fn protocol_name() -> &'static str {
    "feishu-ws-long-connection"
}

/// Upper bound for one inbound attachment. Feishu caps resources at 100 MB.
const MAX_INBOUND_MEDIA_BYTES: usize = 100 * 1024 * 1024;

/// Per-chat download budget so one chat cannot fill the disk between engine
/// rate-limit windows. The engine still applies its own turn rate limit.
const MEDIA_WINDOW: Duration = Duration::from_secs(60);
const MAX_MEDIA_BYTES_PER_CHAT_WINDOW: usize = 200 * 1024 * 1024;

struct MediaBudget {
    started: std::time::Instant,
    bytes: usize,
}

impl MediaBudget {
    fn new() -> Self {
        Self {
            started: std::time::Instant::now(),
            bytes: 0,
        }
    }

    fn remaining(&mut self) -> usize {
        if self.started.elapsed() >= MEDIA_WINDOW {
            self.started = std::time::Instant::now();
            self.bytes = 0;
        }
        MAX_MEDIA_BYTES_PER_CHAT_WINDOW.saturating_sub(self.bytes)
    }

    fn record(&mut self, bytes: usize) {
        self.bytes = self.bytes.saturating_add(bytes);
    }
}

/// Streamed download result; the file already lives under store staging.
#[derive(Debug)]
struct DownloadedResource {
    size: u64,
    sha256: String,
    content_type: Option<String>,
}

/// Downloads queued messages off the WS read loop. One worker per connection
/// keeps message order while the socket keeps answering heartbeats.
async fn run_media_worker(
    inst: ChannelInstance,
    mut queue: mpsc::Receiver<ParsedInbound>,
    tx: mpsc::Sender<IncomingMessage>,
) {
    let mut budgets: HashMap<String, MediaBudget> = HashMap::new();
    while let Some(parsed) = queue.recv().await {
        let ParsedInbound {
            mut message,
            media,
            media_truncated,
        } = parsed;
        // Never stage files for senders the engine will reject (ACL) or for a
        // group message the bot was not mentioned in. Forward the message so
        // the engine keeps its existing reply/drop behavior.
        if can_download_media(&inst, &message) {
            let media_count = media.len();
            budgets.retain(|_, budget| budget.started.elapsed() < MEDIA_WINDOW * 5);
            let budget = budgets
                .entry(message.chat_id.clone())
                .or_insert_with(MediaBudget::new);
            attach_inbound_media(&inst, &mut message, &media, budget).await;
            if media_truncated {
                append_note(
                    &mut message.attachment_note,
                    format!("[附件过多，仅处理前 {MAX_INBOUND_FILES} 个]"),
                );
            }
            tracing::info!(
                instance = %inst.id,
                chat = %message.chat_id,
                content_len = message.content.len(),
                media = media_count,
                staged = message.staged_attachments.len(),
                preview = %message.content.chars().take(40).collect::<String>(),
                "feishu inbound message"
            );
        }
        if tx.send(message).await.is_err() {
            break;
        }
    }
}

fn can_download_media(inst: &ChannelInstance, msg: &IncomingMessage) -> bool {
    if !sender_allowed(&inst.acl, &msg.sender_id) {
        return false;
    }
    !(msg.chat_type == "group" && require_mention(&inst.options, &inst.acl) && !msg.mentioned_bot)
}

/// Stream each inbound resource into the attachment store's staging area.
///
/// The engine commits staging after resolving the App session and checking the
/// 512 MB session budget. No `@path` is written into the journal here.
async fn attach_inbound_media(
    inst: &ChannelInstance,
    incoming: &mut IncomingMessage,
    media: &[InboundMedia],
    budget: &mut MediaBudget,
) {
    if media.is_empty() {
        return;
    }
    if budget.remaining() == 0 {
        push_media_failure(
            &mut incoming.attachment_note,
            "本聊天附件下载额度已用完，请稍后再试",
        );
        return;
    }
    let store = match crate::attachments::shared() {
        Ok(store) => store,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    // One token + one client per message, not per attachment.
    let token = match tenant_token(&inst.channel, &inst.secrets, &inst.options).await {
        Ok(token) => token,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    let api_base = format!("https://{}", open_domain(&inst.channel, &inst.options));
    let client = match http_client() {
        Ok(client) => client,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    for item in media {
        if budget.remaining() == 0 {
            push_media_failure(
                &mut incoming.attachment_note,
                "本聊天附件下载额度已用完，请稍后再试",
            );
            break;
        }
        let temp_path = store.staging_path();
        match fetch_message_to_staging(
            &client,
            &api_base,
            &token,
            &incoming.message_id,
            item,
            &temp_path,
            MAX_INBOUND_MEDIA_BYTES,
        )
        .await
        {
            Ok(resource) => {
                budget.record(resource.size as usize);
                let name = media_display_name(item, resource.content_type.as_deref());
                tracing::info!(
                    instance = %inst.id,
                    key = %item.key,
                    file = %name,
                    bytes = resource.size,
                    "feishu inbound media staged"
                );
                incoming.staged_attachments.push(StagedRemoteAttachment {
                    name,
                    kind: item.kind,
                    temp_path,
                    size: resource.size,
                    sha256: resource.sha256,
                });
            }
            Err(err) => {
                let _ = std::fs::remove_file(&temp_path);
                tracing::warn!(
                    instance = %inst.id,
                    key = %item.key,
                    error = %err,
                    "feishu inbound media download failed"
                );
                push_media_failure(&mut incoming.attachment_note, &err);
            }
        }
    }
}

fn append_note(note: &mut Option<String>, line: String) {
    match note {
        Some(existing) => {
            existing.push('\n');
            existing.push_str(&line);
        }
        None => *note = Some(line),
    }
}

fn push_media_failure(note: &mut Option<String>, reason: &str) {
    // External text must stay on one line and bounded before it reaches the
    // agent prompt.
    let reason: String = reason
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(120)
        .collect();
    append_note(
        note,
        format!("[附件处理失败：{}] 请告诉用户重新发送。", reason.trim()),
    );
}

fn media_display_name(item: &InboundMedia, content_type: Option<&str>) -> String {
    let ext = content_type
        .and_then(extension_for_content_type)
        .unwrap_or_else(|| match item.kind {
            AttachmentKind::Image => "png".into(),
            AttachmentKind::Audio => "opus".into(),
            AttachmentKind::Video => "mp4".into(),
            AttachmentKind::File => "bin".into(),
        });
    if let Some(name) = item.file_name.as_deref().and_then(sanitize_file_name) {
        if Path::new(&name).extension().is_some() {
            return name;
        }
        return format!("{name}.{ext}");
    }
    let stem = match item.kind {
        AttachmentKind::Image => "image",
        AttachmentKind::Audio => "audio",
        AttachmentKind::Video => "video",
        AttachmentKind::File => "attachment",
    };
    format!("{stem}.{ext}")
}

/// Keep the original file name recognizable while stripping path separators,
/// control characters and anything a filesystem may reject.
fn sanitize_file_name(raw: &str) -> Option<String> {
    let base = std::path::Path::new(raw.trim())
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let cleaned: String = base
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    Some(cleaned.chars().take(80).collect())
}

fn extension_for_content_type(content_type: &str) -> Option<String> {
    let essence = content_type.split(';').next()?.trim().to_ascii_lowercase();
    let ext = match essence.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "application/zip" => "zip",
        "audio/opus" => "opus",
        "audio/ogg" => "ogg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" => "m4a",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        _ => return None,
    };
    Some(ext.into())
}

/// Fetch one message resource into an already-allocated staging path.
async fn fetch_message_to_staging(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    message_id: &str,
    media: &InboundMedia,
    temp_path: &Path,
    max_bytes: usize,
) -> Result<DownloadedResource, String> {
    if !is_safe_resource_id(message_id) {
        return Err("invalid message_id".into());
    }
    let url = format!(
        "{api_base}/open-apis/im/v1/messages/{message_id}/resources/{}?type={}",
        media.key, media.resource_type
    );
    let mut res = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("feishu media request: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        // The upstream body stays in the log; the prompt only gets the status.
        tracing::warn!(
            status = %status,
            body = %body.chars().take(160).collect::<String>(),
            "feishu media HTTP error"
        );
        return Err(format!("HTTP {status}"));
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(temp_path)
        .map_err(|e| format!("feishu media: create staging: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0usize;
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("feishu media read: {e}"))?
    {
        if total.saturating_add(chunk.len()) > max_bytes {
            drop(file);
            let _ = std::fs::remove_file(temp_path);
            return Err(format!(
                "附件超过 {:.1} MB 上限",
                max_bytes as f64 / (1024.0 * 1024.0)
            ));
        }
        if let Err(err) = file.write_all(&chunk) {
            drop(file);
            let _ = std::fs::remove_file(temp_path);
            return Err(format!("feishu media write: {err}"));
        }
        hasher.update(&chunk);
        total += chunk.len();
    }
    if total == 0 {
        drop(file);
        let _ = std::fs::remove_file(temp_path);
        return Err("feishu media: empty body".into());
    }
    file.sync_all()
        .map_err(|e| format!("feishu media sync: {e}"))?;

    Ok(DownloadedResource {
        size: total as u64,
        sha256: hex::encode(hasher.finalize()),
        content_type,
    })
}

// Channel + credentials + destination + one media payload; splitting would add
// a wrapper struct without making call sites clearer.
#[allow(clippy::too_many_arguments)]
pub async fn send_media(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    chat_id: &str,
    reply_to: Option<&str>,
    path: &Path,
    kind: AttachmentKind,
    name: &str,
) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("media stat: {e}"))?;
    if !meta.is_file() {
        return Err("media source is not a file".into());
    }
    let max = 30 * 1024 * 1024;
    if meta.len() > max {
        return Err(format!(
            "文件超过 Feishu 上传上限（{:.0} MB）",
            max as f64 / (1024.0 * 1024.0)
        ));
    }
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let base = format!("https://{domain}");
    let client = http_client()?;
    let source = path.to_path_buf();
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(source))
        .await
        .map_err(|e| format!("media read task: {e}"))?
        .map_err(|e| format!("media read: {e}"))?;

    // Feishu images cap at 10 MB; larger images are uploaded as files.
    let (msg_type, content) = if kind == AttachmentKind::Image && meta.len() <= 10 * 1024 * 1024 {
        match upload_image(&client, &base, &token, &bytes, name).await {
            Ok(image_key) => ("image", json!({ "image_key": image_key })),
            Err(err) => {
                tracing::warn!(error = %err, "feishu image upload failed; retry as file");
                let file_key = upload_file(&client, &base, &token, &bytes, name).await?;
                ("file", json!({ "file_key": file_key }))
            }
        }
    } else {
        let file_key = upload_file(&client, &base, &token, &bytes, name).await?;
        match kind {
            AttachmentKind::Audio => ("audio", json!({ "file_key": file_key })),
            AttachmentKind::Video => ("media", json!({ "file_key": file_key })),
            _ => ("file", json!({ "file_key": file_key })),
        }
    };

    if let Err(err) = send_native_message(
        &client, &base, &token, chat_id, reply_to, msg_type, &content,
    )
    .await
    {
        if msg_type == "audio" || msg_type == "media" {
            let file_key = upload_file(&client, &base, &token, &bytes, name).await?;
            send_native_message(
                &client,
                &base,
                &token,
                chat_id,
                reply_to,
                "file",
                &json!({ "file_key": file_key }),
            )
            .await?;
            return Ok(());
        }
        return Err(err);
    }
    Ok(())
}

async fn upload_image(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    bytes: &[u8],
    name: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(name.to_string())
        .mime_str(mime_for_name(name))
        .map_err(|e| format!("image mime: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .text("image_type", "message")
        .part("image", part);
    let res = client
        .post(format!("{base}/open-apis/im/v1/images"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("image upload: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("image upload body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "image upload HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    body.pointer("/data/image_key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "image upload: missing image_key".to_string())
}

async fn upload_file(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    bytes: &[u8],
    name: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(name.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| format!("file mime: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .text("file_type", file_type_for_name(name))
        .text("file_name", name.to_string())
        .part("file", part);
    let res = client
        .post(format!("{base}/open-apis/im/v1/files"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("file upload: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("file upload body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "file upload HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    body.pointer("/data/file_key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "file upload: missing file_key".to_string())
}

async fn send_native_message(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    chat_id: &str,
    reply_to: Option<&str>,
    msg_type: &str,
    content: &Value,
) -> Result<(), String> {
    let payload = json!({
        "msg_type": msg_type,
        "content": content.to_string(),
    });
    let (url, body) = match reply_to.map(str::trim).filter(|id| !id.is_empty()) {
        Some(mid) => (
            format!("{base}/open-apis/im/v1/messages/{mid}/reply"),
            payload,
        ),
        None => (
            format!("{base}/open-apis/im/v1/messages?receive_id_type=chat_id"),
            json!({
                "receive_id": chat_id,
                "msg_type": msg_type,
                "content": content.to_string(),
            }),
        ),
    };
    let res = client
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("media message: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("media message body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "media message HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    Ok(())
}

fn upload_error(body: &Value) -> String {
    let msg = body
        .get("msg")
        .and_then(Value::as_str)
        .unwrap_or("upload failed");
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    format!("code={code} {msg}")
}

fn mime_for_name(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn file_type_for_name(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "pdf",
        "doc" | "docx" => "doc",
        "xls" | "xlsx" => "xls",
        "ppt" | "pptx" => "ppt",
        "mp4" | "mov" => "mp4",
        "opus" | "ogg" => "opus",
        _ => "stream",
    }
}

pub async fn send_card(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    chat_id: &str,
    reply_to: Option<&str>,
    card: &Value,
) -> Result<(), String> {
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let client = http_client()?;
    let content = card.to_string();
    if let Some(mid) = reply_to {
        if !mid.is_empty() {
            let url = format!("https://{domain}/open-apis/im/v1/messages/{mid}/reply");
            let res = client
                .post(&url)
                .bearer_auth(&token)
                .json(&json!({
                    "content": content,
                    "msg_type": "interactive",
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if res.status().is_success() {
                return Ok(());
            }
        }
    }
    let id_type = receive_id_type(chat_id);
    let url = format!("https://{domain}/open-apis/im/v1/messages?receive_id_type={id_type}");
    let res = client
        .post(url)
        .bearer_auth(&token)
        .json(&json!({
            "receive_id": chat_id,
            "msg_type": "interactive",
            "content": content,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!(
            "feishu card: {}",
            body.chars().take(200).collect::<String>()
        ));
    }
    Ok(())
}

/// Parse card action event into engine-prefixed content.
/// Supports Feishu `card.action.trigger` (schema 1.0 / 2.0) and nested value maps.
pub fn card_action_to_content(event: &Value) -> Option<String> {
    // Only treat as card action when event type matches (or action payload present)
    let et = event
        .pointer("/header/event_type")
        .or_else(|| event.get("type"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let has_action = event.pointer("/event/action").is_some() || event.get("action").is_some();
    if !et.contains("card.action") && !et.contains("card.action.trigger") && !has_action {
        // Still allow if action.value looks like our payload
        let probe = event
            .pointer("/event/action/value")
            .or_else(|| event.pointer("/action/value"));
        probe?;
    }
    let value = event
        .pointer("/event/action/value")
        .or_else(|| event.pointer("/action/value"))
        .or_else(|| event.pointer("/event/action/option"))
        .cloned()?;
    let raw = if let Some(s) = value.as_str() {
        s.to_string()
    } else {
        // Object value — keep full JSON for parse_card_action_value
        value.to_string()
    };
    if raw.is_empty() || raw == "null" {
        return None;
    }
    Some(format!("__card_action__:{raw}"))
}

/// Extract open_chat_id + operator open_id from card.action.trigger event.
/// Never uses open_message_id as chat_id (that breaks outbound send).
pub fn card_action_ids(event: &Value) -> (String, String) {
    let sender = event
        .pointer("/event/operator/open_id")
        .or_else(|| event.pointer("/event/operator/user_id"))
        .or_else(|| event.pointer("/event/operator/union_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat_id = event
        .pointer("/event/context/open_chat_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    // Fallback to operator open_id for p2p (receive_id_type=open_id works).
    let chat_id = if chat_id.is_empty() {
        sender.clone()
    } else {
        chat_id
    };
    (chat_id, sender)
}

#[cfg(test)]
mod md_tests {
    use super::*;

    #[test]
    fn plain_text_stays_text_type() {
        let (ty, body) = build_reply_payload("hello world");
        assert_eq!(ty, "text");
        assert!(body.contains("hello world"));
    }

    #[test]
    fn markdown_uses_interactive_card() {
        let (ty, body) = build_reply_payload("**bold** and\n```rs\nfn main(){}\n```");
        assert_eq!(ty, "interactive");
        assert!(body.contains("markdown"));
        assert!(body.contains("schema"));
    }

    #[test]
    fn many_tables_use_post() {
        let mut s = String::new();
        for i in 0..6 {
            s.push_str(&format!("| H{i} |\n|---|\n| v |\n\n"));
        }
        let (ty, _) = build_reply_payload(&s);
        assert_eq!(ty, "post");
    }
}

#[cfg(test)]
mod inbound_media_tests {
    use super::*;

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
        assert_eq!(
            sanitize_file_name("C:\\temp\\report.pdf").as_deref(),
            Some("Ctempreport.pdf")
        );
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
        assert!(last.contains("附件处理失败"), "{last}");
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

        assert!(err.contains("上限"), "{err}");
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
}
