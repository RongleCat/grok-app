//! Weixin personal (ilink) long-poll + sendMessage (aligned with cc-connect payload).

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

const DEFAULT_BASE: &str = "https://ilinkai.weixin.qq.com";
const MESSAGE_TYPE_USER: i64 = 1;
const MESSAGE_TYPE_BOT: i64 = 2;
const MESSAGE_ITEM_TEXT: i64 = 1;
const MESSAGE_STATE_FINISH: i64 = 2;

/// In-memory context_token cache (instance_id → peer → token). Disk is backup.
fn token_cache() -> &'static Mutex<HashMap<String, HashMap<String, String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, HashMap<String, String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let token = secret_or_opt(&inst.secrets, &inst.options, "token")
        .ok_or_else(|| "weixin: missing token".to_string())?;
    let base = secret_or_opt(&inst.secrets, &inst.options, "base_url")
        .unwrap_or_else(|| DEFAULT_BASE.into());
    let route_tag = secret_or_opt(&inst.secrets, &inst.options, "route_tag").unwrap_or_default();
    let timeout_ms: u64 = secret_or_opt(&inst.secrets, &inst.options, "long_poll_timeout_ms")
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            inst.options
                .get("long_poll_timeout_ms")
                .and_then(|x| x.as_u64())
        })
        .unwrap_or(35_000);

    tracing::info!(instance = %inst.id, base = %base, "weixin ilink long-poll starting");

    let mut buf = load_updates_buf(&inst.id);
    let client = http_client()?;
    let mut backoff = Duration::from_secs(1);

    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let url = format!("{}/ilink/bot/getupdates", base.trim_end_matches('/'));
        let body = json!({
            "get_updates_buf": buf,
            "base_info": { "channel_version": "grok-app-weixin/1.0" }
        });
        let mut req = client
            .post(&url)
            .timeout(Duration::from_millis(timeout_ms + 5_000))
            .header("Authorization", format!("Bearer {token}"))
            .header("AuthorizationType", "ilink_bot_token")
            .header("Content-Type", "application/json")
            .json(&body);
        if !route_tag.is_empty() {
            req = req.header("SKRouteTag", &route_tag);
        }

        let fut = req.send();
        let res = tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() { return Ok(()); }
                continue;
            }
            r = fut => r,
        };

        match res {
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                if !status.is_success() {
                    tracing::warn!(instance = %inst.id, %status, "weixin getUpdates HTTP error: {}", text.chars().take(200).collect::<String>());
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(30));
                    continue;
                }
                let v: Value = serde_json::from_str(&text).unwrap_or(json!({}));
                let ret = v.get("ret").and_then(|x| x.as_i64()).unwrap_or(0);
                if ret != 0 {
                    tracing::warn!(
                        instance = %inst.id,
                        ret,
                        errcode = ?v.get("errcode"),
                        errmsg = ?v.get("errmsg"),
                        "weixin getUpdates ret!=0"
                    );
                }
                if let Some(nb) = v
                    .get("get_updates_buf")
                    .or_else(|| v.get("getUpdatesBuf"))
                    .and_then(|x| x.as_str())
                {
                    buf = nb.to_string();
                    save_updates_buf(&inst.id, &buf);
                }
                backoff = Duration::from_secs(1);
                let msgs = v
                    .get("msgs")
                    .or_else(|| v.get("messages"))
                    .and_then(|m| m.as_array())
                    .cloned()
                    .unwrap_or_default();
                for m in msgs {
                    if let Some(incoming) = parse_msg(&inst, &m) {
                        if let Some(ct) = m
                            .get("context_token")
                            .or_else(|| m.get("contextToken"))
                            .and_then(|x| x.as_str())
                        {
                            // Key by peer user id (from_user_id) — same id used for send.
                            set_context_token(&inst.id, &incoming.sender_id, ct);
                            // Also key by chat_id if different (session_id)
                            if incoming.chat_id != incoming.sender_id {
                                set_context_token(&inst.id, &incoming.chat_id, ct);
                            }
                        }
                        tracing::info!(
                            instance = %inst.id,
                            sender = %incoming.sender_id,
                            content_len = incoming.content.len(),
                            preview = %incoming.content.chars().take(40).collect::<String>(),
                            "weixin inbound message"
                        );
                        if let Err(e) = tx.send(incoming).await {
                            tracing::error!(
                                instance = %inst.id,
                                err = %e,
                                "weixin: engine channel closed — message dropped (is Bridge pump alive?)"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(instance = %inst.id, "weixin getUpdates: {e}");
                tokio::select! {
                    _ = cancel.changed() => { if *cancel.borrow() { return Ok(()); } }
                    _ = tokio::time::sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

fn parse_msg(inst: &ChannelInstance, m: &Value) -> Option<IncomingMessage> {
    // Skip bot echoes
    let msg_type = m
        .get("message_type")
        .or_else(|| m.get("messageType"))
        .and_then(|x| x.as_i64())
        .unwrap_or(MESSAGE_TYPE_USER);
    if msg_type == MESSAGE_TYPE_BOT {
        return None;
    }

    let sender = m
        .get("from_user_id")
        .or_else(|| m.get("fromUserId"))
        .or_else(|| m.get("ilink_user_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if sender.is_empty() {
        return None;
    }

    // Prefer peer user id as chat_id for p2p (required for context_token + send).
    let session_id = m
        .get("session_id")
        .or_else(|| m.get("sessionId"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let chat_id = if !sender.is_empty() {
        sender.clone()
    } else {
        session_id.to_string()
    };

    let mut text = String::new();
    if let Some(items) = m
        .get("item_list")
        .or_else(|| m.get("itemList"))
        .and_then(|x| x.as_array())
    {
        for it in items {
            let ty = it.get("type").and_then(|x| x.as_i64()).unwrap_or(0);
            if ty == MESSAGE_ITEM_TEXT || ty == 0 {
                if let Some(t) = it
                    .pointer("/text_item/text")
                    .or_else(|| it.pointer("/textItem/text"))
                    .and_then(|x| x.as_str())
                {
                    let t = t.trim();
                    if !t.is_empty() {
                        text = t.to_string();
                        break;
                    }
                }
            }
        }
        // media tags
        for it in items {
            let ty = it.get("type").and_then(|x| x.as_i64()).unwrap_or(0);
            if (2..=5).contains(&ty) {
                let key = it
                    .pointer("/media_item/media_id")
                    .or_else(|| it.pointer("/image_item/media_id"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("media");
                let tag = format!("[media_type={ty}:{key}]");
                if text.is_empty() {
                    text = format!("请查看附件 {tag}");
                } else if !text.contains(&tag) {
                    text = format!("{text}\n{tag}");
                }
            }
        }
    }
    if text.is_empty() {
        text = m
            .pointer("/text")
            .and_then(|x| x.as_str())
            .or_else(|| m.get("message").and_then(|x| x.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();
    }
    if text.is_empty() {
        return None;
    }

    let msg_id = m
        .get("message_id")
        .or_else(|| m.get("msg_id"))
        .map(|x| match x {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        })
        .unwrap_or_default();

    Some(IncomingMessage {
        channel: inst.channel.clone(),
        instance_id: inst.id.clone(),
        message_id: msg_id,
        chat_id,
        chat_type: "p2p".into(),
        sender_id: sender,
        content: text,
        mentioned_bot: true,
        thread_id: None,
    })
}

fn state_dir(instance_id: &str) -> PathBuf {
    crate::paths::app_data_root()
        .join("remote")
        .join("weixin")
        .join(instance_id)
}

fn load_updates_buf(instance_id: &str) -> String {
    let p = state_dir(instance_id).join("get_updates_buf.txt");
    fs::read_to_string(p).unwrap_or_default()
}

fn save_updates_buf(instance_id: &str, buf: &str) {
    let dir = state_dir(instance_id);
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join("get_updates_buf.txt"), buf);
}

fn context_tokens_path(instance_id: &str) -> PathBuf {
    state_dir(instance_id).join("context_tokens.json")
}

fn set_context_token(instance_id: &str, peer: &str, token: &str) {
    if peer.is_empty() || token.is_empty() {
        return;
    }
    // Memory first (same process, immediate for outbound reply)
    {
        let mut g = token_cache().lock();
        g.entry(instance_id.to_string())
            .or_default()
            .insert(peer.to_string(), token.to_string());
    }
    let path = context_tokens_path(instance_id);
    if let Some(p) = path.parent() {
        let _ = fs::create_dir_all(p);
    }
    let mut map: HashMap<String, String> = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    map.insert(peer.to_string(), token.to_string());
    if let Ok(raw) = serde_json::to_string_pretty(&map) {
        let _ = fs::write(path, raw);
    }
}

pub fn get_context_token(instance_id: &str, peer: &str) -> Option<String> {
    if let Some(t) = token_cache()
        .lock()
        .get(instance_id)
        .and_then(|m| m.get(peer))
        .cloned()
    {
        return Some(t);
    }
    let path = context_tokens_path(instance_id);
    let map: HashMap<String, String> = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())?;
    let tok = map.get(peer).cloned()?;
    // Warm memory from disk
    token_cache()
        .lock()
        .entry(instance_id.to_string())
        .or_default()
        .insert(peer.to_string(), tok.clone());
    Some(tok)
}

pub async fn send_text(
    secrets: &HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let token = secrets
        .get("token")
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "weixin: missing token".to_string())?;
    let base = secrets
        .get("base_url")
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE);
    let instance_id = secrets
        .get("_instance_id")
        .map(|s| s.as_str())
        .unwrap_or("");
    let peer = chat_id.trim();
    if instance_id.is_empty() {
        tracing::error!(
            "weixin send: missing _instance_id in secrets — context_token lookup will fail"
        );
    }
    let ctx = get_context_token(instance_id, peer).ok_or_else(|| {
        format!(
            "weixin: missing context_token for peer {peer} (instance={instance_id}) — 请先用该微信账号给机器人发一条消息"
        )
    })?;
    let client = http_client()?;
    let url = format!("{}/ilink/bot/sendmessage", base.trim_end_matches('/'));
    // Match cc-connect weixinOutboundMsg shape exactly.
    let client_id = format!("grok-{}", uuid::Uuid::new_v4());
    let body = json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": peer,
            "client_id": client_id,
            "message_type": MESSAGE_TYPE_BOT,
            "message_state": MESSAGE_STATE_FINISH,
            "item_list": [{
                "type": MESSAGE_ITEM_TEXT,
                "text_item": { "text": text }
            }],
            "context_token": ctx
        },
        "base_info": { "channel_version": "grok-app-weixin/1.0" }
    });
    let mut req = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("AuthorizationType", "ilink_bot_token")
        .header("Content-Type", "application/json")
        .json(&body);
    if let Some(rt) = secrets.get("route_tag").filter(|s| !s.is_empty()) {
        req = req.header("SKRouteTag", rt);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        tracing::error!(%status, body = %body_text.chars().take(200).collect::<String>(), peer, "weixin send HTTP error");
        return Err(format!(
            "weixin send HTTP {status}: {}",
            body_text.chars().take(200).collect::<String>()
        ));
    }
    // Success may be `{"message_id":...}` (no ret) or `{ret:0,...}`.
    if let Ok(v) = serde_json::from_str::<Value>(&body_text) {
        let ret = v.get("ret").and_then(|x| x.as_i64()).unwrap_or(0);
        if ret != 0 {
            tracing::error!(ret, body = %body_text.chars().take(200).collect::<String>(), peer, "weixin send ret!=0");
            return Err(format!(
                "weixin send ret={ret}: {}",
                v.get("errmsg")
                    .and_then(|x| x.as_str())
                    .unwrap_or(&body_text)
            ));
        }
    }
    tracing::info!(peer, len = text.len(), "weixin send ok");
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "weixin-ilink-longpoll"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_user_text_message() {
        let inst = ChannelInstance {
            id: "w1".into(),
            channel: "weixin".into(),
            name: "w".into(),
            enabled: true,
            secrets: HashMap::new(),
            options: json!({}),
            acl: json!({}),
            project_scope: json!({}),
        };
        let m = json!({
            "from_user_id": "u@im.wechat",
            "message_id": 42,
            "message_type": 1,
            "item_list": [{ "type": 1, "text_item": { "text": "hello" } }],
            "context_token": "ctx1",
            "session_id": "sess-x"
        });
        let inc = parse_msg(&inst, &m).unwrap();
        assert_eq!(inc.content, "hello");
        assert_eq!(inc.sender_id, "u@im.wechat");
        // chat_id must be peer user id for send/context_token
        assert_eq!(inc.chat_id, "u@im.wechat");
    }

    #[test]
    fn parse_skips_bot_messages() {
        let inst = ChannelInstance {
            id: "w1".into(),
            channel: "weixin".into(),
            name: "w".into(),
            enabled: true,
            secrets: HashMap::new(),
            options: json!({}),
            acl: json!({}),
            project_scope: json!({}),
        };
        let m = json!({
            "from_user_id": "bot",
            "message_type": 2,
            "item_list": [{ "type": 1, "text_item": { "text": "echo" } }],
        });
        assert!(parse_msg(&inst, &m).is_none());
    }
}
