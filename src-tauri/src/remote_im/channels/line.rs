//! LINE Messaging API — webhook HTTP server (public URL required).

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{mpsc, watch};

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let channel_secret = secret_or_opt(&inst.secrets, &inst.options, "channel_secret")
        .ok_or_else(|| "line: missing channel_secret".to_string())?;
    let access_token = secret_or_opt(&inst.secrets, &inst.options, "channel_access_token")
        .ok_or_else(|| "line: missing channel_access_token".to_string())?;
    let _ = access_token;

    let port: u16 = secret_or_opt(&inst.secrets, &inst.options, "port")
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            inst.options
                .get("port")
                .and_then(|x| x.as_u64())
                .map(|n| n as u16)
        })
        .unwrap_or(8082);
    let path = secret_or_opt(&inst.secrets, &inst.options, "callback_path")
        .unwrap_or_else(|| "/line/callback".into());

    // default loopback; opt-in LAN bind only with allow_external=true.
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
        "line webhook server starting"
    );

    let addr = SocketAddr::from((bind_ip, port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("line bind {port}: {e}"))?;

    let inst = Arc::new(inst);
    let path = Arc::new(path);
    let channel_secret = Arc::new(channel_secret);

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
                let channel_secret = channel_secret.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = vec![0u8; 65536];
                    let n = match socket.read(&mut buf).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");
                    if !req.contains(path.as_str()) {
                        let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }
                    // require X-Line-Signature (HMAC-SHA256 of raw body).
                    let sig = req
                        .lines()
                        .find(|l| l.to_ascii_lowercase().starts_with("x-line-signature:"))
                        .and_then(|l| l.split_once(':'))
                        .map(|(_, v)| v.trim().to_string());
                    if !line_signature_ok(channel_secret.as_str(), body.as_bytes(), sig.as_deref())
                    {
                        tracing::warn!(instance = %inst.id, "line: bad or missing X-Line-Signature");
                        let _ = socket
                            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        return;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(body) {
                        if let Some(events) = v.get("events").and_then(|e| e.as_array()) {
                            for ev in events {
                                if ev.get("type").and_then(|t| t.as_str()) != Some("message") {
                                    continue;
                                }
                                let text = ev.pointer("/message/text").and_then(|x| x.as_str()).unwrap_or("");
                                if text.is_empty() { continue; }
                                let user = ev.pointer("/source/userId").and_then(|x| x.as_str()).unwrap_or("");
                                let reply_token = ev.get("replyToken").and_then(|x| x.as_str()).unwrap_or("");
                                // store reply token as message_id for outbound
                                let _ = tx.send(IncomingMessage {
                                    channel: inst.channel.clone(),
                                    instance_id: inst.id.clone(),
                                    message_id: reply_token.into(),
                                    chat_id: user.into(),
                                    chat_type: "p2p".into(),
                                    sender_id: user.into(),
                                    content: text.into(),
                                    mentioned_bot: true,
                                }).await;
                            }
                        }
                    }
                    let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK").await;
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
    let token = secrets
        .get("channel_access_token")
        .ok_or("missing channel_access_token")?;
    let client = http_client()?;
    // Prefer push; replyToken may be in chat_id if we stored wrongly — use push by userId
    let res = client
        .post("https://api.line.me/v2/bot/message/push")
        .bearer_auth(token)
        .json(&json!({
            "to": chat_id,
            "messages": [{ "type": "text", "text": text }]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("line push: {}", res.status()));
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "line-webhook"
}


fn const_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.as_bytes().iter().zip(b.as_bytes().iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// LINE: `X-Line-Signature` = Base64(HMAC-SHA256(channel_secret, raw_body)).
fn line_signature_ok(channel_secret: &str, body: &[u8], header_sig: Option<&str>) -> bool {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let Some(sig) = header_sig.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let mut mac = match Hmac::<Sha256>::new_from_slice(channel_secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    let expected = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    const_time_eq(&expected, sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_signature_accepts_valid() {
        use base64::Engine;
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let secret = "test_secret";
        let body = br#"{"events":[]}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        assert!(line_signature_ok(secret, body, Some(&sig)));
        assert!(!line_signature_ok(secret, body, Some("bad")));
        assert!(!line_signature_ok(secret, body, None));
    }
}
