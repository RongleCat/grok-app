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
    let ws_url =
        format!("wss://openws.work.weixin.qq.com/?bot_id={bot_id}&bot_secret={bot_secret}");
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
    let _ = write.send(Message::Text(auth.to_string().into())).await;

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
        message_id: v.get("msgid").and_then(|x| x.as_str()).unwrap_or("").into(),
        chat_id: chat,
        chat_type: "p2p".into(),
        sender_id: sender,
        content: text,
        mentioned_bot: true,
        thread_id: None,
    })
}

/// Default local webhook port for WeCom callback mode.
pub const DEFAULT_WEBHOOK_PORT: u16 = 8081;

/// Shared-token fallback header when `msg_signature` is unavailable
/// (plain-JSON deployments that cannot compute the WeCom signature).
pub const SHARED_TOKEN_HEADER: &str = "x-grok-wecom-token";

fn const_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Official WeCom callback signature:
/// `SHA1(lexicographically sorted [token, timestamp, nonce, payload])`,
/// delivered as the `msg_signature` query parameter. Compared constant-time.
fn wecom_signature_ok(
    token: &str,
    timestamp: &str,
    nonce: &str,
    payload: &str,
    signature: Option<&str>,
) -> bool {
    use sha1::{Digest, Sha1};

    let Some(sig) = signature.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let mut parts = [token, timestamp, nonce, payload];
    parts.sort_unstable();
    let mut hasher = Sha1::new();
    for part in parts {
        hasher.update(part.as_bytes());
    }
    let expected = hex::encode(hasher.finalize());
    const_time_eq(expected.as_bytes(), sig.as_bytes())
}

/// Extract `k=v` from an HTTP query string (first occurrence, no decode).
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then_some(v)
    })
}

/// Minimal percent-decoding (%XX only) so signatures are computed over the
/// decoded values the sender signed.
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(hex) = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok())
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Split a raw HTTP request into (request-line, headers, body).
fn split_request(req: &str) -> (&str, &str, &str) {
    match req.split_once("\r\n\r\n") {
        Some((head, body)) => match head.split_once("\r\n") {
            Some((request_line, headers)) => (request_line, headers, body),
            None => (head, "", body),
        },
        None => (req.trim_end_matches(['\r', '\n']), "", ""),
    }
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
        .unwrap_or(DEFAULT_WEBHOOK_PORT);
    let path = secret_or_opt(&inst.secrets, &inst.options, "callback_path")
        .unwrap_or_else(|| "/wecom/callback".into());
    let callback_token = secret_or_opt(&inst.secrets, &inst.options, "callback_token")
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    if callback_token.is_none() {
        return Err(
            "wecom webhook: missing callback_token (Settings → WeCom requires it; \
             it is the Callback Token shown in the WeCom admin console)"
                .to_string(),
        );
    }

    // Default loopback; opt-in LAN bind only with allow_external=true (same
    // contract as the LINE channel).
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
        .map_err(|e| format!("wecom bind {port}: {e}"))?;
    let _ = super::super::config::set_instance_last_error(&inst.id, None);

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
    // `callback_token` presence was validated before binding; this fallback is
    // unreachable in practice and only satisfies the type checker without a panic.
    let callback_token = Arc::new(callback_token.unwrap_or_else(|| String::from("unreachable")));

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
                let callback_token = callback_token.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = vec![0u8; 65536];
                    let n = match socket.read(&mut buf).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let (request_line, _, body) = split_request(&req);

                    let uri = request_line.split_whitespace().nth(1).unwrap_or("");
                    let (uri_path, uri_query) = match uri.split_once('?') {
                        Some((p, q)) => (p, q),
                        None => (uri, ""),
                    };
                    // Path match on the decoded request target; tolerate a
                    // trailing-slash difference only.
                    let norm =
                        |p: &str| p.trim_end_matches('/').to_string();
                    if norm(&percent_decode(uri_path)) != norm(path.as_str()) {
                        let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }

                    // Official WeCom signature over [token, timestamp, nonce,
                    // payload]; GET verify signs the echostr, POSTs sign the body.
                    let sig = query_param(uri_query, "msg_signature").map(percent_decode);
                    let timestamp = query_param(uri_query, "timestamp")
                        .map(percent_decode)
                        .unwrap_or_default();
                    let nonce = query_param(uri_query, "nonce")
                        .map(percent_decode)
                        .unwrap_or_default();
                    let echostr = query_param(uri_query, "echostr").map(percent_decode);
                    let header_token = req.lines().skip(1).find_map(|l| {
                        l.split_once(':').filter(|(name, _)| {
                            name.eq_ignore_ascii_case(SHARED_TOKEN_HEADER)
                        }).map(|(_, v)| v.trim().to_string())
                    });

                    let is_get = request_line.starts_with("GET");
                    let payload_for_sig: &str = if is_get {
                        echostr.as_deref().unwrap_or("")
                    } else {
                        body
                    };
                    let verified = wecom_signature_ok(
                        callback_token.as_str(),
                        &timestamp,
                        &nonce,
                        payload_for_sig,
                        sig.as_deref(),
                    ) || header_token.is_some_and(|t| {
                        const_time_eq(t.as_bytes(), callback_token.as_bytes())
                    });

                    // URL verify echo: only echo after verification (WeCom signs
                    // the encrypted echostr during endpoint setup).
                    if is_get {
                        if !verified {
                            tracing::warn!(instance = %inst.id, "wecom: bad or missing callback signature on verify");
                            let _ = socket.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n").await;
                            return;
                        }
                        if let Some(echo) = echostr.as_deref() {
                            let resp = format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                                echo.len(),
                                echo
                            );
                            let _ = socket.write_all(resp.as_bytes()).await;
                            return;
                        }
                        let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }

                    if !verified {
                        tracing::warn!(instance = %inst.id, "wecom: bad or missing callback signature");
                        let _ = socket.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n").await;
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
                                thread_id: None,                            }).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Official WeCom signature: SHA1 over lexicographically sorted
    /// [token, timestamp, nonce, payload], hex-encoded.
    fn sign(token: &str, ts: &str, nonce: &str, payload: &str) -> String {
        use sha1::{Digest, Sha1};
        let mut parts = [token, ts, nonce, payload];
        parts.sort_unstable();
        let mut h = Sha1::new();
        for p in parts {
            h.update(p.as_bytes());
        }
        hex::encode(h.finalize())
    }

    #[test]
    fn signature_accepts_valid_and_rejects_missing_or_bad() {
        let sig = sign("tok", "1717171717", "nonce1", "{\"x\":1}");
        assert!(wecom_signature_ok(
            "tok",
            "1717171717",
            "nonce1",
            "{\"x\":1}",
            Some(&sig)
        ));
        // Wrong payload / token / timestamp must not verify.
        assert!(!wecom_signature_ok(
            "tok",
            "1717171717",
            "nonce1",
            "{\"y\":2}",
            Some(&sig)
        ));
        assert!(!wecom_signature_ok(
            "bad",
            "1717171717",
            "nonce1",
            "{\"x\":1}",
            Some(&sig)
        ));
        assert!(!wecom_signature_ok(
            "tok",
            "0000",
            "nonce1",
            "{\"x\":1}",
            Some(&sig)
        ));
        // Missing or empty signature fails closed.
        assert!(!wecom_signature_ok(
            "tok",
            "1717171717",
            "nonce1",
            "{\"x\":1}",
            None
        ));
        assert!(!wecom_signature_ok(
            "tok",
            "1717171717",
            "nonce1",
            "{\"x\":1}",
            Some("  ")
        ));
    }

    #[test]
    fn signature_is_order_independent_over_parts() {
        // The four parts sort before hashing — same inputs, any order.
        let a = wecom_signature_ok("t", "123", "n", "p", Some(&sign("t", "123", "n", "p")));
        let b = wecom_signature_ok("123", "t", "p", "n", Some(&sign("t", "123", "n", "p")));
        assert!(a && b);
    }

    #[test]
    fn const_time_eq_basic() {
        assert!(const_time_eq(b"abc", b"abc"));
        assert!(!const_time_eq(b"abc", b"abd"));
        assert!(!const_time_eq(b"abc", b"ab"));
        assert!(const_time_eq(b"", b""));
    }

    #[test]
    fn percent_decode_handles_escapes_and_passes_through() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%2Fx"), "/x");
        assert_eq!(percent_decode("plain"), "plain");
        // Truncated escape stays literal.
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%G1"), "%G1");
    }

    #[test]
    fn query_param_finds_first_exact_key() {
        let q = "msg_signature=abc&timestamp=5&nonce=xyz&echostr=EN%2FCODE";
        assert_eq!(query_param(q, "timestamp"), Some("5"));
        assert_eq!(query_param(q, "nonce"), Some("xyz"));
        assert_eq!(query_param(q, "echostr"), Some("EN%2FCODE"));
        assert_eq!(query_param(q, "missing"), None);
        // Prefix keys do not match.
        assert_eq!(query_param("nonceX=1", "nonce"), None);
    }

    #[test]
    fn split_request_parses_head_and_body() {
        let raw = "POST /cb HTTP/1.1\r\nHost: x\r\n\r\n{\"a\":1}";
        let (line, headers, body) = split_request(raw);
        assert_eq!(line, "POST /cb HTTP/1.1");
        assert_eq!(headers, "Host: x");
        assert_eq!(body, "{\"a\":1}");
        // Bodyless request still yields an empty body slice.
        let (line2, _, body2) = split_request("GET /cb HTTP/1.1\r\n");
        assert_eq!(line2, "GET /cb HTTP/1.1");
        assert_eq!(body2, "");
    }
}
