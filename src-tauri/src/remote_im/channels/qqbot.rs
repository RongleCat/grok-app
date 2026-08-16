//! QQ official bot gateway (WebSocket).

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
    let app_id = secret_or_opt(&inst.secrets, &inst.options, "app_id")
        .ok_or_else(|| "qqbot: missing app_id".to_string())?;
    let app_secret = secret_or_opt(&inst.secrets, &inst.options, "app_secret")
        .ok_or_else(|| "qqbot: missing app_secret".to_string())?;

    tracing::info!(instance = %inst.id, "qqbot gateway starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(&inst, &app_id, &app_secret, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "qqbot: {e}"),
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn access_token(app_id: &str, app_secret: &str) -> Result<String, String> {
    let client = http_client()?;
    let body: Value = client
        .post("https://bots.qq.com/app/getAppAccessToken")
        .json(&json!({ "appId": app_id, "clientSecret": app_secret }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    body.get("access_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("qqbot token: {body}"))
}

async fn run_once(
    inst: &ChannelInstance,
    app_id: &str,
    app_secret: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let token = access_token(app_id, app_secret).await?;
    let client = http_client()?;
    let gw: Value = client
        .get("https://api.sgroup.qq.com/gateway")
        .header("Authorization", format!("QQBot {token}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let url = gw
        .get("url")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "qqbot: no gateway url".to_string())?;
    let (ws, _) = connect_async(url)
        .await
        .map_err(|e| format!("qqbot ws: {e}"))?;
    let (mut write, mut read) = ws.split();
    let mut heartbeat_ms: u64 = 41250;
    let mut identified = false;
    let mut hb = tokio::time::interval(Duration::from_millis(heartbeat_ms));

    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    let _ = write.close().await;
                    return Ok(());
                }
            }
            _ = hb.tick(), if identified => {
                let _ = write.send(Message::Text(json!({"op":1,"d":null}).to_string().into())).await;
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => {
                        let v: Value = serde_json::from_str(&t).unwrap_or(json!({}));
                        let op = v.get("op").and_then(|x| x.as_i64()).unwrap_or(-1);
                        match op {
                            10 => {
                                if let Some(ms) = v.pointer("/d/heartbeat_interval").and_then(|x| x.as_u64()) {
                                    heartbeat_ms = ms;
                                    hb = tokio::time::interval(Duration::from_millis(heartbeat_ms));
                                }
                                let identify = json!({
                                    "op": 2,
                                    "d": {
                                        "token": format!("QQBot {token}"),
                                        "intents": 1 << 25 | 1 << 30 | 1 << 26,
                                        "shard": [0, 1]
                                    }
                                });
                                write.send(Message::Text(identify.to_string().into())).await.map_err(|e| e.to_string())?;
                                identified = true;
                            }
                            0 => {
                                let t = v.get("t").and_then(|x| x.as_str()).unwrap_or("");
                                if t.contains("MESSAGE") || t == "AT_MESSAGE_CREATE" || t == "C2C_MESSAGE_CREATE" || t == "GROUP_AT_MESSAGE_CREATE" {
                                    if let Some(inc) = parse_dispatch(inst, v.get("d").unwrap_or(&json!({}))) {
                                        let _ = tx.send(inc).await;
                                    }
                                }
                            }
                            7 | 9 => return Ok(()),
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

fn parse_dispatch(inst: &ChannelInstance, d: &Value) -> Option<IncomingMessage> {
    let content = d
        .get("content")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if content.is_empty() {
        return None;
    }
    let author = d
        .pointer("/author/id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat_id = d
        .get("group_id")
        .or_else(|| d.get("channel_id"))
        .and_then(|x| x.as_str())
        .unwrap_or(&author)
        .to_string();
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: d.get("id").and_then(|x| x.as_str()).unwrap_or("").into(),
        chat_id,
        chat_type: if d.get("group_id").is_some() {
            "group".into()
        } else {
            "p2p".into()
        },
        sender_id: author,
        content,
        mentioned_bot: true,
        thread_id: None,
    })
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let app_id = secrets.get("app_id").ok_or("missing app_id")?;
    let app_secret = secrets.get("app_secret").ok_or("missing app_secret")?;
    let token = access_token(app_id, app_secret).await?;
    let client = http_client()?;
    // C2C or group — try C2C first
    let url = format!("https://api.sgroup.qq.com/v2/users/{chat_id}/messages");
    let res = client
        .post(url)
        .header("Authorization", format!("QQBot {token}"))
        .json(&json!({ "content": text, "msg_type": 0 }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let url2 = format!("https://api.sgroup.qq.com/v2/groups/{chat_id}/messages");
        let res2 = client
            .post(url2)
            .header("Authorization", format!("QQBot {token}"))
            .json(&json!({ "content": text, "msg_type": 0 }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res2.status().is_success() {
            return Err(format!("qqbot send: {}", res2.status()));
        }
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "qqbot-official-gateway"
}
