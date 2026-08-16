//! Discord Gateway (identify + MESSAGE_CREATE) + REST outbound.

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const INTENTS: u64 = 1 << 9 | 1 << 15; // GUILD_MESSAGES | MESSAGE_CONTENT

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let token = secret_or_opt(&inst.secrets, &inst.options, "bot_token")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "token"))
        .ok_or_else(|| "missing bot_token".to_string())?;

    tracing::info!(instance = %inst.id, "discord gateway starting");

    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(&inst, &token, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "discord: {e}"),
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
    token: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    // GET gateway URL
    let client = http_client()?;
    let gw: Value = client
        .get("https://discord.com/api/v10/gateway")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let url = gw
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "no gateway url".to_string())?;
    let ws_url = format!("{url}/?v=10&encoding=json");
    let (ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("discord ws: {e}"))?;
    let (mut write, mut read) = ws.split();

    let mut heartbeat_ms: u64 = 41250;
    let mut seq: Option<i64> = None;
    let mut identified = false;
    let mut hb = tokio::time::interval(Duration::from_millis(heartbeat_ms));
    hb.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    let _ = write.close().await;
                    return Ok(());
                }
            }
            _ = hb.tick(), if identified => {
                let payload = json!({ "op": 1, "d": seq });
                if write.send(Message::Text(payload.to_string().into())).await.is_err() {
                    return Err("hb send failed".into());
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => {
                        let v: Value = serde_json::from_str(&t).unwrap_or(json!({}));
                        let op = v.get("op").and_then(|x| x.as_i64()).unwrap_or(-1);
                        if let Some(s) = v.get("s").and_then(|x| x.as_i64()) {
                            seq = Some(s);
                        }
                        match op {
                            10 => {
                                // Hello
                                if let Some(ms) = v.pointer("/d/heartbeat_interval").and_then(|x| x.as_u64()) {
                                    heartbeat_ms = ms;
                                    hb = tokio::time::interval(Duration::from_millis(heartbeat_ms));
                                    hb.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                                }
                                let identify = json!({
                                    "op": 2,
                                    "d": {
                                        "token": token,
                                        "intents": INTENTS,
                                        "properties": {
                                            "os": std::env::consts::OS,
                                            "browser": "grok-app",
                                            "device": "grok-app"
                                        }
                                    }
                                });
                                write.send(Message::Text(identify.to_string().into())).await
                                    .map_err(|e| e.to_string())?;
                                identified = true;
                            }
                            0 => {
                                let t = v.get("t").and_then(|x| x.as_str()).unwrap_or("");
                                if t == "MESSAGE_CREATE" {
                                    if let Some(incoming) = parse_message(inst, v.get("d").unwrap_or(&json!({}))) {
                                        let _ = tx.send(incoming).await;
                                    }
                                }
                            }
                            9 => return Err("discord invalid session".into()),
                            7 => return Ok(()), // reconnect
                            _ => {}
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

fn parse_message(inst: &ChannelInstance, d: &Value) -> Option<IncomingMessage> {
    if d.get("author")
        .and_then(|a| a.get("bot"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        return None;
    }
    let content = d
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    if content.is_empty() {
        return None;
    }
    let chat_id = d
        .get("channel_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = d
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let sender_id = d
        .pointer("/author/id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let guild = d.get("guild_id").and_then(|x| x.as_str());
    let chat_type = if guild.is_some() { "group" } else { "p2p" };
    let mentioned_bot = chat_type == "p2p"
        || d.get("mentions")
            .and_then(|m| m.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false)
        || content.contains("<@");

    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id,
        chat_id,
        chat_type: chat_type.into(),
        sender_id,
        content,
        mentioned_bot,
        thread_id: None,
    })
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    channel_id: &str,
    text: &str,
) -> Result<(), String> {
    let token = secrets
        .get("bot_token")
        .or_else(|| secrets.get("token"))
        .map(|s| s.as_str())
        .ok_or_else(|| "missing bot_token".to_string())?;
    let client = http_client()?;
    let url = format!("https://discord.com/api/v10/channels/{channel_id}/messages");
    let res = client
        .post(url)
        .header("Authorization", format!("Bot {token}"))
        .json(&json!({ "content": text.chars().take(2000).collect::<String>() }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("discord send: {}", res.status()));
    }
    Ok(())
}
