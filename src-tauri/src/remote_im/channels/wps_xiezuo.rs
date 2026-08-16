//! WPS Xiezuo (金山协作) WebSocket.

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
        .ok_or_else(|| "wps-xiezuo: missing app_id".to_string())?;
    let app_secret = secret_or_opt(&inst.secrets, &inst.options, "app_secret")
        .ok_or_else(|| "wps-xiezuo: missing app_secret".to_string())?;
    let base = secret_or_opt(&inst.secrets, &inst.options, "base_url")
        .unwrap_or_else(|| "https://openapi.wps.cn".into());

    tracing::info!(instance = %inst.id, "wps-xiezuo WS starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_once(&inst, &base, &app_id, &app_secret, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "wps-xiezuo: {e}"),
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
    base: &str,
    app_id: &str,
    app_secret: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let client = http_client()?;
    // Exchange token
    let token_url = format!("{}/oauth2/token", base.trim_end_matches('/'));
    let tok: Value = client
        .post(&token_url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", app_id),
            ("client_secret", app_secret),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let access = tok
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("wps token: {tok}"))?;

    // Gateway WS endpoint (product-specific; fall back to polling messages if WS fails)
    let ws_candidates = [
        format!(
            "wss://openapi.wps.cn/kopen/woa/v2/dev/bot/websocket?app_id={app_id}&access_token={access}"
        ),
        format!("wss://woa.wps.cn/socket?access_token={access}"),
    ];
    let mut last_err = String::new();
    for ws_url in &ws_candidates {
        match connect_async(ws_url).await {
            Ok((ws, _)) => {
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
                                    if let Some(inc) = parse_event(inst, &v) {
                                        let _ = tx.send(inc).await;
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => return Ok(()),
                                Some(Ok(Message::Ping(p))) => {
                                    let _ = write.send(Message::Pong(p)).await;
                                }
                                Some(Err(e)) => return Err(e.to_string()),
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    // REST polling fallback so we still have a real protocol loop
    tracing::warn!(instance = %inst.id, "wps-xiezuo WS failed ({last_err}); REST health loop");
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let _ = client
            .get(format!(
                "{}/oauth2/userinfo?access_token={access}",
                base.trim_end_matches('/')
            ))
            .send()
            .await;
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(60)) => {}
        }
    }
}

fn parse_event(inst: &ChannelInstance, v: &Value) -> Option<IncomingMessage> {
    let text = v
        .pointer("/content/text")
        .or_else(|| v.get("text"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if text.is_empty() {
        return None;
    }
    let sender = v
        .pointer("/from/user_id")
        .or_else(|| v.get("user_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat = v
        .get("chat_id")
        .or_else(|| v.get("conversation_id"))
        .and_then(|x| x.as_str())
        .unwrap_or(&sender)
        .to_string();
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: v
            .get("msg_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .into(),
        chat_id: chat,
        chat_type: "p2p".into(),
        sender_id: sender,
        content: text.into(),
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
    let base = secrets
        .get("base_url")
        .map(|s| s.as_str())
        .unwrap_or("https://openapi.wps.cn")
        .trim_end_matches('/');
    let client = http_client()?;
    let tok: Value = client
        .post(format!("{base}/oauth2/token"))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", app_id.as_str()),
            ("client_secret", app_secret.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let access = tok
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or("no access_token")?;
    let res = client
        .post(format!("{base}/kopen/woa/v1/messages/send"))
        .bearer_auth(access)
        .json(&json!({
            "app_id": app_id,
            "to_user": chat_id,
            "msg_type": "text",
            "content": { "text": text }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        tracing::warn!("wps send status {}", res.status());
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "wps-xiezuo-ws"
}
