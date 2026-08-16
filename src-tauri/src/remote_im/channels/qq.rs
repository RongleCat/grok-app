//! QQ OneBot v11 forward WebSocket.

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let ws_url = secret_or_opt(&inst.secrets, &inst.options, "ws_url")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "url"))
        .ok_or_else(|| "qq: missing ws_url".to_string())?;
    let token = secret_or_opt(&inst.secrets, &inst.options, "token").unwrap_or_default();

    tracing::info!(instance = %inst.id, %ws_url, "qq OneBot WS starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(&inst, &ws_url, &token, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "qq: {e}"),
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn run_once(
    inst: &ChannelInstance,
    ws_url: &str,
    token: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let url = if token.is_empty() {
        ws_url.to_string()
    } else if ws_url.contains('?') {
        format!("{ws_url}&access_token={token}")
    } else {
        format!("{ws_url}?access_token={token}")
    };
    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("qq ws: {e}"))?;
    let (mut write, mut read) = ws.split();
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
                        if v.get("post_type").and_then(|x| x.as_str()) == Some("message") {
                            if let Some(inc) = parse_event(inst, &v) {
                                let _ = tx.send(inc).await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Ok(Message::Ping(p))) => { let _ = write.send(Message::Pong(p)).await; }
                    Some(Err(e)) => return Err(e.to_string()),
                    _ => {}
                }
            }
        }
    }
}

fn parse_event(inst: &ChannelInstance, v: &Value) -> Option<IncomingMessage> {
    let raw = v.get("raw_message").and_then(|x| x.as_str()).unwrap_or("");
    let message = v.get("message");
    let text = if !raw.is_empty() {
        raw.to_string()
    } else if let Some(s) = message.and_then(|m| m.as_str()) {
        s.to_string()
    } else {
        String::new()
    };
    if text.is_empty() {
        return None;
    }
    let user_id = v
        .get("user_id")
        .map(|x| match x {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        })
        .unwrap_or_default();
    let group_id = v.get("group_id");
    let chat_type = if group_id.is_some() { "group" } else { "p2p" };
    let chat_id = if chat_type == "group" {
        group_id
            .map(|x| match x {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => user_id.clone(),
            })
            .unwrap_or_else(|| user_id.clone())
    } else {
        user_id.clone()
    };
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: v
            .get("message_id")
            .map(|x| x.to_string())
            .unwrap_or_default(),
        chat_id,
        chat_type: chat_type.into(),
        sender_id: user_id,
        mentioned_bot: chat_type == "p2p" || text.contains("[CQ:at"),
        thread_id: None,
        content: text,
    })
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let http_url = secrets
        .get("http_url")
        .or_else(|| secrets.get("api_base"))
        .cloned()
        .or_else(|| {
            secrets
                .get("ws_url")
                .map(|w| w.replace("ws://", "http://").replace("wss://", "https://"))
        })
        .ok_or_else(|| "qq: missing http_url for send".to_string())?;
    let base = http_url.trim_end_matches('/');
    let client = http_client()?;
    let token = secrets.get("token").cloned().unwrap_or_default();
    // Try group first then private
    for path in ["send_group_msg", "send_private_msg"] {
        let url = format!("{base}/{path}");
        let mut req = client.post(&url).json(&json!({
            "group_id": chat_id.parse::<i64>().ok(),
            "user_id": chat_id.parse::<i64>().ok(),
            "message": text,
        }));
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        if let Ok(res) = req.send().await {
            if res.status().is_success() {
                return Ok(());
            }
        }
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "qq-onebot-ws"
}
