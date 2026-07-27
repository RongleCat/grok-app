//! WeCom — WebSocket aibot mode + Webhook callback HTTP.

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let mode = secret_or_opt(&inst.secrets, &inst.options, "connect_mode")
        .or_else(|| {
            inst.options
                .get("connect_mode")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "websocket".into());

    if mode == "webhook" {
        return run_webhook(inst, tx, cancel).await;
    }
    run_websocket(inst, tx, cancel).await
}

async fn run_websocket(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let bot_id = secret_or_opt(&inst.secrets, &inst.options, "bot_id")
        .ok_or_else(|| "wecom ws: missing bot_id".to_string())?;
    let bot_secret = secret_or_opt(&inst.secrets, &inst.options, "bot_secret")
        .ok_or_else(|| "wecom ws: missing bot_secret".to_string())?;

    tracing::info!(instance = %inst.id, "wecom aibot websocket starting");
    let mut backoff = 2u64;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        match run_ws_once(&inst, &bot_id, &bot_secret, tx.clone(), &mut cancel).await {
            Ok(()) => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            Err(e) => tracing::error!(instance = %inst.id, "wecom ws: {e}"),
        }
        tokio::select! {
            _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
        }
        backoff = (backoff * 2).min(60);
    }
}

async fn run_ws_once(
    inst: &ChannelInstance,
    bot_id: &str,
    bot_secret: &str,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    // WeCom aibot long-connection endpoint
    let ws_url = format!(
        "wss://openws.work.weixin.qq.com/?bot_id={bot_id}&bot_secret={bot_secret}"
    );
    let (ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("wecom ws connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    // Auth frame (best-effort; some deployments auto-auth via query)
    let auth = json!({
        "cmd": "auth",
        "bot_id": bot_id,
        "bot_secret": bot_secret
    });
    let _ = write
        .send(Message::Text(auth.to_string().into()))
        .await;

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
                        if let Some(inc) = parse_ws_msg(inst, &v) {
                            let _ = tx.send(inc).await;
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

fn parse_ws_msg(inst: &ChannelInstance, v: &Value) -> Option<IncomingMessage> {
    let text = v
        .pointer("/text/content")
        .or_else(|| v.get("content"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return None;
    }
    let sender = v
        .get("from")
        .and_then(|f| f.get("userid").or_else(|| f.get("user_id")))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat = v
        .get("chatid")
        .or_else(|| v.get("chat_id"))
        .and_then(|x| x.as_str())
        .unwrap_or(&sender)
        .to_string();
    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: v
            .get("msgid")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .into(),
        chat_id: chat,
        chat_type: "p2p".into(),
        sender_id: sender,
        content: text,
        mentioned_bot: true,
    })
}

async fn run_webhook(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let port: u16 = secret_or_opt(&inst.secrets, &inst.options, "port")
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            inst.options
                .get("port")
                .and_then(|x| x.as_u64())
                .map(|n| n as u16)
        })
        .unwrap_or(8081);
    let path = secret_or_opt(&inst.secrets, &inst.options, "callback_path")
        .unwrap_or_else(|| "/wecom/callback".into());

    // default loopback only. Opt in to LAN/public with allow_external=true
    // (real public callbacks should use a tunnel, not a wide bind).
    let allow_external = inst
        .options
        .get("allow_external")
        .or_else(|| inst.options.get("allowExternal"))
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let bind_ip = if allow_external {
        [0, 0, 0, 0]
    } else {
        [127, 0, 0, 1]
    };
    tracing::info!(
        instance = %inst.id,
        port,
        %path,
        allow_external,
        "wecom webhook server starting"
    );

    // Bind first so the connector is reachable even if remote gettoken is slow.
    let addr = SocketAddr::from((bind_ip, port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("wecom bind: {e}"))?;

    // Best-effort corp credential check in background (must not block listen).
    let corp_id = secret_or_opt(&inst.secrets, &inst.options, "corp_id");
    let corp_secret = secret_or_opt(&inst.secrets, &inst.options, "corp_secret");
    if let (Some(cid), Some(sec)) = (corp_id, corp_secret) {
        tokio::spawn(async move {
            if let Ok(client) = http_client() {
                let _ = client
                    .get(format!(
                        "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={cid}&corpsecret={sec}"
                    ))
                    .send()
                    .await;
            }
        });
    }

    let inst = Arc::new(inst);
    let path = Arc::new(path);

    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() { return Ok(()); }
            }
            acc = listener.accept() => {
                let Ok((mut socket, _)) = acc else { continue };
                let tx = tx.clone();
                let inst = inst.clone();
                let path = path.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = vec![0u8; 65536];
                    let n = match socket.read(&mut buf).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    let req = String::from_utf8_lossy(&buf[..n]);
                    // URL verify echo
                    if req.starts_with("GET") {
                        if let Some(q) = req.lines().next().and_then(|l| l.split_whitespace().nth(1)) {
                            if let Some(echo) = q.split("echostr=").nth(1).map(|s| s.split('&').next().unwrap_or("")) {
                                let body = echo.to_string();
                                let resp = format!(
                                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                                    body.len(),
                                    body
                                );
                                let _ = socket.write_all(resp.as_bytes()).await;
                                return;
                            }
                        }
                    }
                    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");
                    if !req.contains(path.as_str()) {
                        let _ = socket.write_all(b"HTTP/1.1 404\r\n\r\n").await;
                        return;
                    }
                    // JSON or XML simplified — try JSON
                    if let Ok(v) = serde_json::from_str::<Value>(body) {
                        let text = v
                            .get("Content")
                            .or_else(|| v.get("text"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        let user = v
                            .get("FromUserName")
                            .or_else(|| v.get("from"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        if !text.is_empty() {
                            let _ = tx.send(IncomingMessage {
                                channel: inst.channel.clone(),
                                instance_id: inst.id.clone(),
                                message_id: v.get("MsgId").and_then(|x| x.as_str()).unwrap_or("").into(),
                                chat_id: user.into(),
                                chat_type: "p2p".into(),
                                sender_id: user.into(),
                                content: text.into(),
                                mentioned_bot: true,
                            }).await;
                        }
                    }
                    let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nsuccess").await;
                });
            }
        }
    }
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    if let Some(hook) = secrets.get("webhook") {
        let client = http_client()?;
        let res = client
            .post(hook)
            .json(&json!({
                "msgtype": "text",
                "text": { "content": text }
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("wecom webhook: {}", res.status()));
        }
        return Ok(());
    }
    // App chat send via access token
    if let (Some(corp_id), Some(secret)) = (secrets.get("corp_id"), secrets.get("corp_secret")) {
        let client = http_client()?;
        let tok: Value = client
            .get(format!(
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={corp_id}&corpsecret={secret}"
            ))
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
        let agent = secrets.get("agent_id").map(|s| s.as_str()).unwrap_or("0");
        let res = client
            .post(format!(
                "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={access}"
            ))
            .json(&json!({
                "touser": chat_id,
                "msgtype": "text",
                "agentid": agent.parse::<i64>().unwrap_or(0),
                "text": { "content": text }
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("wecom send: {}", res.status()));
        }
        return Ok(());
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "wecom-ws-or-webhook"
}
