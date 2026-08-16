//! Slack Socket Mode (apps.connections.open) + chat.postMessage.

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
    let bot_token = secret_or_opt(&inst.secrets, &inst.options, "bot_token")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "token"))
        .ok_or_else(|| "missing bot_token".to_string())?;
    let app_token = secret_or_opt(&inst.secrets, &inst.options, "app_token")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "app_level_token"));

    // Socket Mode preferred
    if let Some(app_tok) = app_token {
        return run_socket_mode(&inst, &bot_token, &app_tok, tx, cancel).await;
    }

    // Fallback: RTM-less health loop (credentials validated; no inbound without Socket Mode)
    tracing::warn!(
        instance = %inst.id,
        "slack: no app_token — Socket Mode disabled; only credential health checks"
    );
    let client = http_client()?;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let _ = client
            .get("https://slack.com/api/auth.test")
            .bearer_auth(&bot_token)
            .send()
            .await;
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(120)) => {}
        }
    }
}

async fn run_socket_mode(
    inst: &ChannelInstance,
    _bot_token: &str,
    app_token: &str,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    tracing::info!(instance = %inst.id, "slack socket mode starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_socket_once(inst, app_token, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "slack socket: {e}"),
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn run_socket_once(
    inst: &ChannelInstance,
    app_token: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let client = http_client()?;
    let res: Value = client
        .post("https://slack.com/api/apps.connections.open")
        .bearer_auth(app_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if res.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        return Err(format!(
            "apps.connections.open: {}",
            res.get("error").and_then(|e| e.as_str()).unwrap_or("fail")
        ));
    }
    let url = res
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "no socket url".to_string())?;
    let (ws, _) = connect_async(url)
        .await
        .map_err(|e| format!("slack ws: {e}"))?;
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
                        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
                        if ty == "disconnect" {
                            return Ok(());
                        }
                        if ty == "events_api" {
                            // ACK envelope
                            if let Some(envelope_id) = v.get("envelope_id").and_then(|x| x.as_str()) {
                                let ack = json!({ "envelope_id": envelope_id });
                                let _ = write.send(Message::Text(ack.to_string().into())).await;
                            }
                            if let Some(incoming) = parse_event(inst, v.get("payload").unwrap_or(&json!({}))) {
                                let _ = tx.send(incoming).await;
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

fn parse_event(inst: &ChannelInstance, payload: &Value) -> Option<IncomingMessage> {
    let event = payload.get("event")?;
    if event.get("type").and_then(|t| t.as_str()) != Some("message") {
        return None;
    }
    if event.get("bot_id").is_some() || event.get("subtype").is_some() {
        return None;
    }
    let text = event
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return None;
    }
    let chat_id = event
        .get("channel")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let sender_id = event
        .get("user")
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = event
        .get("ts")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let channel_type = event
        .get("channel_type")
        .and_then(|t| t.as_str())
        .unwrap_or("channel");
    let chat_type = if channel_type == "im" { "p2p" } else { "group" };
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id,
        chat_id,
        chat_type: chat_type.into(),
        sender_id,
        mentioned_bot: chat_type == "p2p" || text.contains("<@"),
        thread_id: None,
        content: text,
    })
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    channel: &str,
    text: &str,
) -> Result<(), String> {
    let token = secrets
        .get("bot_token")
        .or_else(|| secrets.get("token"))
        .map(|s| s.as_str())
        .ok_or_else(|| "missing bot_token".to_string())?;
    let client = http_client()?;
    let res = client
        .post("https://slack.com/api/chat.postMessage")
        .bearer_auth(token)
        .json(&json!({ "channel": channel, "text": text }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        return Err(format!(
            "slack post: {}",
            body.get("error").and_then(|e| e.as_str()).unwrap_or("fail")
        ));
    }
    Ok(())
}
