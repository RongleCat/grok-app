//! Feishu / Lark long-connection (WS) + REST outbound — pure Rust.

#![allow(dead_code)] // residual-clippy: download_message_resource
use super::super::outbound::{http_client, opt_str, secret_or_opt};
use super::super::pb_frame::{decode_frame, encode_frame, Frame, Header};
use super::super::types::{ChannelInstance, IncomingMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const FRAME_CONTROL: i32 = 0;
const FRAME_DATA: i32 = 1;

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
                                        channel: inst.channel.clone(),
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
                            } else if let Some(incoming) = parse_im_event(inst, &event) {
                                tracing::info!(
                                    instance = %inst.id,
                                    chat = %incoming.chat_id,
                                    content_len = incoming.content.len(),
                                    preview = %incoming.content.chars().take(40).collect::<String>(),
                                    "feishu inbound message"
                                );
                                if let Err(e) = tx.send(incoming).await {
                                    tracing::error!(
                                        instance = %inst.id,
                                        err = %e,
                                        "feishu: engine channel closed — message dropped"
                                    );
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

fn parse_im_event(inst: &ChannelInstance, root: &Value) -> Option<IncomingMessage> {
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
    let mut text = content_json
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        // post content
        if let Some(title) = content_json.pointer("/title").and_then(|x| x.as_str()) {
            text = title.to_string();
        }
    }
    // Text-adjacent media: surface image/file keys into the prompt (download optional).
    if text.is_empty() || msg_type == "image" || msg_type == "file" || msg_type == "audio" {
        if let Some(key) = content_json
            .get("image_key")
            .or_else(|| content_json.get("file_key"))
            .and_then(|x| x.as_str())
        {
            let tag = format!("[{msg_type}:{key}]");
            if text.is_empty() {
                text = format!("请查看附件 {tag}");
            } else {
                text = format!("{text}\n{tag}");
            }
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

    if re_clean.trim().is_empty() {
        return None;
    }

    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id,
        chat_id,
        chat_type: chat_type.into(),
        sender_id,
        content: re_clean,
        mentioned_bot: mentioned_bot || chat_type == "p2p",
        thread_id: None,
    })
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

/// Download inbound image bytes (text-adjacent media path).
pub async fn download_message_resource(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    message_id: &str,
    file_key: &str,
    resource_type: &str, // image | file
) -> Result<Vec<u8>, String> {
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let client = http_client()?;
    let url = format!(
        "https://{domain}/open-apis/im/v1/messages/{message_id}/resources/{file_key}?type={resource_type}"
    );
    let res = client
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("feishu media download: {}", res.status()));
    }
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
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
