//! Matrix /sync long-poll.

use super::super::outbound::{http_client, secret_or_opt};
use super::super::types::{ChannelInstance, IncomingMessage};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let homeserver = secret_or_opt(&inst.secrets, &inst.options, "homeserver")
        .ok_or_else(|| "matrix: missing homeserver".to_string())?;
    let access_token = secret_or_opt(&inst.secrets, &inst.options, "access_token")
        .ok_or_else(|| "matrix: missing access_token".to_string())?;
    let base = homeserver.trim_end_matches('/');
    let client = http_client()?;
    let mut since = String::new();

    tracing::info!(instance = %inst.id, "matrix /sync starting");

    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let mut url =
            format!("{base}/_matrix/client/v3/sync?timeout=30000&access_token={access_token}");
        if !since.is_empty() {
            url.push_str(&format!("&since={since}"));
        }
        let fut = client.get(&url).send();
        let res = tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() { return Ok(()); }
                continue;
            }
            r = fut => r,
        };
        match res {
            Ok(r) => {
                let body: Value = r.json().await.unwrap_or(json!({}));
                if let Some(n) = body.get("next_batch").and_then(|x| x.as_str()) {
                    since = n.to_string();
                }
                if let Some(rooms) = body.pointer("/rooms/join").and_then(|r| r.as_object()) {
                    for (room_id, room) in rooms {
                        let events = room
                            .pointer("/timeline/events")
                            .and_then(|e| e.as_array())
                            .cloned()
                            .unwrap_or_default();
                        for ev in events {
                            if ev.get("type").and_then(|t| t.as_str()) != Some("m.room.message") {
                                continue;
                            }
                            if ev.pointer("/content/msgtype").and_then(|t| t.as_str())
                                != Some("m.text")
                            {
                                continue;
                            }
                            let body = ev
                                .pointer("/content/body")
                                .and_then(|x| x.as_str())
                                .unwrap_or("");
                            if body.is_empty() {
                                continue;
                            }
                            let sender = ev
                                .get("sender")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                            let _ = tx
                                .send(IncomingMessage {
                                    channel: inst.channel.clone(),
                                    instance_id: inst.id.clone(),
                                    message_id: ev
                                        .get("event_id")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .into(),
                                    chat_id: room_id.clone(),
                                    chat_type: "group".into(),
                                    sender_id: sender,
                                    content: body.into(),
                                    mentioned_bot: true,
                                    thread_id: None,
                                })
                                .await;
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(instance = %inst.id, "matrix sync: {e}");
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
) -> Result<(), String> {
    let homeserver = secrets
        .get("homeserver")
        .ok_or("missing homeserver")?
        .trim_end_matches('/');
    let access_token = secrets.get("access_token").ok_or("missing access_token")?;
    let txn = uuid::Uuid::new_v4().to_string();
    let url = format!(
        "{homeserver}/_matrix/client/v3/rooms/{chat_id}/send/m.room.message/{txn}?access_token={access_token}"
    );
    let client = http_client()?;
    let res = client
        .put(url)
        .json(&json!({ "msgtype": "m.text", "body": text }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("matrix send: {}", res.status()));
    }
    Ok(())
}

pub fn protocol_name() -> &'static str {
    "matrix-sync"
}
