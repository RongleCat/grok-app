//! Weibo private-message WebSocket (subscription style).

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
    let access_token = secret_or_opt(&inst.secrets, &inst.options, "access_token")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "token"))
        .ok_or_else(|| "weibo: missing access_token".to_string())?;
    let ws_url = secret_or_opt(&inst.secrets, &inst.options, "ws_url")
        .unwrap_or_else(|| "wss://api.weibo.com/chat".into());

    tracing::info!(instance = %inst.id, "weibo WS starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(&inst, &ws_url, &access_token, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "weibo: {e}"),
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
    let url = if ws_url.contains('?') {
        format!("{ws_url}&access_token={token}")
    } else {
        format!("{ws_url}?access_token={token}")
    };
    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("weibo ws: {e}"))?;
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
                        let text = v
                            .get("text")
                            .or_else(|| v.pointer("/data/text"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        if text.is_empty() { continue; }
                        let sender = v
                            .get("sender_id")
                            .or_else(|| v.pointer("/data/sender_id"))
                            .map(|x| x.to_string())
                            .unwrap_or_default();
                        let _ = tx.send(IncomingMessage {
                            channel: inst.channel.clone(),
                            instance_id: inst.id.clone(),
                            message_id: v.get("id").map(|x| x.to_string()).unwrap_or_default(),
                            chat_id: sender.clone(),
                            chat_type: "p2p".into(),
                            sender_id: sender,
                            content: text.into(),
                            mentioned_bot: true,
                            thread_id: None,                        }).await;
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

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let token = secrets
        .get("access_token")
        .or_else(|| secrets.get("token"))
        .ok_or("missing access_token")?;
    let client = http_client()?;
    let res = client
        .post("https://api.weibo.com/2/direct_messages/new.json")
        .form(&[
            ("access_token", token.as_str()),
            ("uid", chat_id),
            ("text", text),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("weibo send: {}", res.status()));
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "weibo-ws"
}
