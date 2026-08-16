//! DingTalk Stream mode (real gateway WS) + session webhook text/card outbound.

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let client_id = secret_or_opt(&inst.secrets, &inst.options, "client_id")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "app_key"))
        .ok_or_else(|| "missing client_id".to_string())?;
    let client_secret = secret_or_opt(&inst.secrets, &inst.options, "client_secret")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "app_secret"))
        .ok_or_else(|| "missing client_secret".to_string())?;

    tracing::info!(instance = %inst.id, "dingtalk stream connector starting (real gateway)");

    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_stream_once(&inst, &client_id, &client_secret, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
                tracing::warn!(instance = %inst.id, "dingtalk stream closed; reconnecting");
            }
            Err(e) => {
                tracing::error!(instance = %inst.id, "dingtalk stream: {e}");
                if *cancel.borrow() {
                    return Err(e);
                }
            }
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn run_stream_once(
    inst: &ChannelInstance,
    client_id: &str,
    client_secret: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let client = http_client()?;
    // Open stream connection ticket
    let open_url = "https://api.dingtalk.com/v1.0/gateway/connections/open";
    let body = json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "subscriptions": [{
            "type": "CALLBACK",
            "topic": "*"
        }],
        "ua": "grok-app-remote-im/1.0",
        "localIp": "127.0.0.1"
    });
    let res = client
        .post(open_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("dingtalk open: {e}"))?;
    let status = res.status();
    let open_body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "dingtalk open HTTP {status}: {}",
            open_body
                .get("message")
                .or_else(|| open_body.get("code"))
                .map(|x| x.to_string())
                .unwrap_or_else(|| open_body.to_string().chars().take(200).collect())
        ));
    }
    let endpoint = open_body
        .get("endpoint")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "dingtalk: missing endpoint".to_string())?;
    let ticket = open_body
        .get("ticket")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let ws_url = if ticket.is_empty() {
        endpoint.to_string()
    } else if endpoint.contains('?') {
        format!("{endpoint}&ticket={ticket}")
    } else {
        format!("{endpoint}?ticket={ticket}")
    };

    let (ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("dingtalk ws: {e}"))?;
    let (mut write, mut read) = ws.split();

    // Keep session webhooks for replies (chatId -> webhook)
    // Stored in process via outbound secrets update is hard; parse sessionWebhook per message
    // and encode into message_id field temporarily — engine only needs chat_id.

    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    let _ = write.close().await;
                    return Ok(());
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => {
                        let v: Value = serde_json::from_str(&t).unwrap_or(json!({}));
                        // ACK keepalives
                        if v.get("type").and_then(|x| x.as_str()) == Some("SYSTEM")
                            || v.get("headers").and_then(|h| h.get("topic")).and_then(|x| x.as_str()) == Some("ping")
                        {
                            let ack = json!({ "code": 200, "headers": v.get("headers").cloned().unwrap_or(json!({})) });
                            let _ = write.send(Message::Text(ack.to_string().into())).await;
                            continue;
                        }
                        // Callback data
                        let data = v
                            .get("data")
                            .cloned()
                            .or_else(|| v.get("body").cloned())
                            .unwrap_or(v.clone());
                        let data = if let Some(s) = data.as_str() {
                            serde_json::from_str(s).unwrap_or(json!({}))
                        } else {
                            data
                        };
                        // Card action
                        if let Some(action_id) = data
                            .get("actionIds")
                            .and_then(|a| a.as_array())
                            .and_then(|a| a.first())
                            .and_then(|x| x.as_str())
                            .or_else(|| data.get("actionId").and_then(|x| x.as_str()))
                        {
                            let chat_id = data
                                .get("conversationId")
                                .or_else(|| data.get("conversation_id"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("card")
                                .to_string();
                            let sender = data
                                .get("senderStaffId")
                                .or_else(|| data.get("senderId"))
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                            let _ = tx.send(IncomingMessage {
                                channel: inst.channel.clone(),
                                instance_id: inst.id.clone(),
                                message_id: data.get("msgId").and_then(|x| x.as_str()).unwrap_or("").into(),
                                chat_id,
                                chat_type: "p2p".into(),
                                sender_id: sender,
                                content: format!("__card_action__:{action_id}"),
                                mentioned_bot: true,
                                thread_id: None,                            }).await;
                            let ack = json!({ "code": 200 });
                            let _ = write.send(Message::Text(ack.to_string().into())).await;
                            continue;
                        }
                        if let Some(incoming) = parse_bot_callback(inst, &data) {
                            // Persist sessionWebhook on secrets map via side channel file
                            if let Some(wh) = data.get("sessionWebhook").and_then(|x| x.as_str()) {
                                store_session_webhook(&inst.id, &incoming.chat_id, wh);
                            }
                            let _ = tx.send(incoming).await;
                        }
                        let ack = json!({ "code": 200 });
                        let _ = write.send(Message::Text(ack.to_string().into())).await;
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = write.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Err(e)) => return Err(e.to_string()),
                    _ => {}
                }
            }
        }
    }
}

fn parse_bot_callback(inst: &ChannelInstance, data: &Value) -> Option<IncomingMessage> {
    let msgtype = data
        .get("msgtype")
        .or_else(|| data.get("msgType"))
        .and_then(|x| x.as_str())
        .unwrap_or("text");
    let mut text = data
        .pointer("/text/content")
        .or_else(|| data.get("text").and_then(|t| t.get("content")))
        .or_else(|| data.get("content"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    // Text-adjacent media: image/file download codes into prompt.
    if msgtype == "picture" || msgtype == "image" || msgtype == "file" {
        let key = data
            .pointer("/content/downloadCode")
            .or_else(|| data.pointer("/content/pictureDownloadCode"))
            .or_else(|| data.get("downloadCode"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        if !key.is_empty() {
            let tag = format!("[{msgtype}:{key}]");
            if text.is_empty() {
                text = format!("请查看附件 {tag}");
            } else {
                text = format!("{text}\n{tag}");
            }
        }
    }
    if text.is_empty() {
        return None;
    }
    let chat_id = data
        .get("conversationId")
        .or_else(|| data.get("conversation_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let sender = data
        .get("senderStaffId")
        .or_else(|| data.get("senderId"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let msg_id = data
        .get("msgId")
        .or_else(|| data.get("msgid"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let conv_type = data
        .get("conversationType")
        .and_then(|x| x.as_str())
        .unwrap_or("1");
    let chat_type = if conv_type == "2" { "group" } else { "p2p" };
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: msg_id,
        chat_id,
        chat_type: chat_type.into(),
        sender_id: sender,
        content: text,
        mentioned_bot: true,
        thread_id: None,
    })
}

fn webhook_store_path(instance_id: &str) -> std::path::PathBuf {
    crate::paths::app_data_root()
        .join("remote")
        .join("dingtalk-webhooks")
        .join(format!("{instance_id}.json"))
}

fn store_session_webhook(instance_id: &str, chat_id: &str, webhook: &str) {
    let path = webhook_store_path(instance_id);
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let mut map: HashMap<String, String> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    map.insert(chat_id.to_string(), webhook.to_string());
    if let Ok(raw) = serde_json::to_string(&map) {
        let _ = std::fs::write(path, raw);
    }
}

fn load_session_webhook(instance_id: &str, chat_id: &str) -> Option<String> {
    let path = webhook_store_path(instance_id);
    let map: HashMap<String, String> = std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())?;
    map.get(chat_id).cloned()
}

pub async fn send_text(
    secrets: &HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    // Prefer session webhook; then robot webhook
    let instance_id = secrets.get("_instance_id").cloned().unwrap_or_default();
    if let Some(wh) = load_session_webhook(&instance_id, chat_id)
        .or_else(|| secrets.get("webhook").cloned())
        .or_else(|| secrets.get("robot_webhook").cloned())
    {
        let client = http_client()?;
        let res = client
            .post(&wh)
            .json(&json!({
                "msgtype": "text",
                "text": { "content": text }
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("dingtalk send: {}", res.status()));
        }
        return Ok(());
    }
    tracing::warn!(chat_id, "dingtalk: no sessionWebhook; drop reply");
    Ok(())
}

pub async fn send_card(
    secrets: &HashMap<String, String>,
    chat_id: &str,
    card: &Value,
) -> Result<(), String> {
    let instance_id = secrets.get("_instance_id").cloned().unwrap_or_default();
    let wh = load_session_webhook(&instance_id, chat_id)
        .or_else(|| secrets.get("webhook").cloned())
        .or_else(|| secrets.get("robot_webhook").cloned());
    let Some(wh) = wh else {
        // Fallback text menu
        return send_text(secrets, chat_id, &format!("[card]\n{card}")).await;
    };
    let client = http_client()?;
    // ActionCard simplified
    let title = card
        .pointer("/header/title/text")
        .or_else(|| card.pointer("/header/title/content"))
        .and_then(|x| x.as_str())
        .unwrap_or("Grok Remote IM");
    let text = card
        .pointer("/contents/0/text")
        .and_then(|x| x.as_str())
        .unwrap_or("Select:");
    let mut btns = Vec::new();
    if let Some(actions) = card
        .pointer("/contents/1/actions")
        .and_then(|a| a.as_array())
    {
        for a in actions {
            btns.push(json!({
                "title": a.get("title").and_then(|x| x.as_str()).unwrap_or("·"),
                "actionURL": format!("dtmd://dingtalkclient/sendMessage?content={}",
                    urlencoding_simple(a.get("actionId").and_then(|x| x.as_str()).unwrap_or("")))
            }));
        }
    }
    let res = client
        .post(&wh)
        .json(&json!({
            "msgtype": "actionCard",
            "actionCard": {
                "title": title,
                "text": text,
                "btns": btns,
                "btnOrientation": "0"
            }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return send_text(secrets, chat_id, text).await;
    }
    Ok(())
}

fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

/// Protocol entry marker for registry tests.
pub fn protocol_name() -> &'static str {
    "dingtalk-stream-gateway"
}
