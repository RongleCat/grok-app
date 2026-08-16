//! Telegram Bot API long-polling (getUpdates) + native bot commands menu.

use super::super::outbound::{http_client, secret_or_opt, sender_allowed};
use super::super::slash::{self, native_bot_commands};
use super::super::types::{ChannelInstance, IncomingMessage};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

/// Telegram accepts two-letter ISO 639-1 language codes for command menus.
const COMMAND_LANGUAGE_CODES_ZH: &[&str] = &["zh"];

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let token = secret_or_opt(&inst.secrets, &inst.options, "bot_token")
        .or_else(|| secret_or_opt(&inst.secrets, &inst.options, "token"))
        .ok_or_else(|| "missing bot_token".to_string())?;
    let client = http_client()?;
    let mut offset: i64 = 0;

    tracing::info!(instance = %inst.id, "telegram long-poll starting");

    // drop pending webhook if any
    let _ = client
        .post(format!("https://api.telegram.org/bot{token}/deleteWebhook"))
        .json(&json!({ "drop_pending_updates": false }))
        .send()
        .await;

    // Register Telegram native command menu (/ key) for default + zh.
    if let Err(e) = register_native_commands(&client, &token).await {
        tracing::warn!(instance = %inst.id, "telegram setMyCommands failed: {e}");
    }

    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let url =
            format!("https://api.telegram.org/bot{token}/getUpdates?timeout=25&offset={offset}");
        let fut = client.get(&url).send();
        let res = tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() { return Ok(()); }
                continue;
            }
            r = fut => r,
        };
        let res = match res {
            Ok(r) => r,
            Err(e) => {
                // reqwest errors include the request URL by default; Telegram
                // embeds the bot token in that URL, so always strip it first.
                let safe_error = e.without_url();
                tracing::warn!(instance = %inst.id, "telegram poll error: {safe_error}");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        let body: Value = match res.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if body.get("ok").and_then(|x| x.as_bool()) != Some(true) {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        let Some(arr) = body.get("result").and_then(|r| r.as_array()) else {
            continue;
        };
        for upd in arr {
            if let Some(id) = upd.get("update_id").and_then(|x| x.as_i64()) {
                offset = id + 1;
            }
            if let Some(callback) = upd.get("callback_query") {
                handle_callback_query(&client, &token, &inst, &tx, callback).await;
                continue;
            }
            let msg = upd.get("message").or_else(|| upd.get("edited_message"));
            let Some(msg) = msg else { continue };
            let raw_text = msg
                .get("text")
                .or_else(|| msg.get("caption"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if raw_text.is_empty() {
                continue;
            }
            let entities = msg.get("entities").and_then(|e| e.as_array());
            // Normalize `/cmd@BotName args` → `/cmd args` so control-plane slash parser matches.
            let text = normalize_bot_command_text(&raw_text, entities);
            let chat_id = msg
                .pointer("/chat/id")
                .map(|x| match x {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let chat_type = msg
                .pointer("/chat/type")
                .and_then(|x| x.as_str())
                .map(|t| if t == "private" { "p2p" } else { "group" })
                .unwrap_or("p2p")
                .to_string();
            let sender_id = msg
                .pointer("/from/id")
                .map(|x| match x {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let message_id = msg
                .get("message_id")
                .map(|x| match x {
                    Value::Number(n) => n.to_string(),
                    Value::String(s) => s.clone(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let thread_id = telegram_thread_id(msg);
            // Private chats always; groups when @mentioned or a native bot_command entity.
            let mentioned_bot = chat_type == "p2p"
                || entities
                    .map(|e| {
                        e.iter().any(|ent| {
                            matches!(
                                ent.get("type").and_then(|t| t.as_str()),
                                Some("mention") | Some("bot_command")
                            )
                        })
                    })
                    .unwrap_or(false)
                || slash::parse_slash(&text).is_some();

            let _ = tx
                .send(IncomingMessage {
                    channel: inst.channel.clone(),
                    instance_id: inst.id.clone(),
                    message_id,
                    chat_id,
                    chat_type,
                    sender_id,
                    content: text,
                    mentioned_bot,
                    thread_id,
                })
                .await;
        }
    }
}

async fn handle_callback_query(
    client: &reqwest::Client,
    token: &str,
    inst: &ChannelInstance,
    tx: &mpsc::Sender<IncomingMessage>,
    callback: &Value,
) {
    let is_pagination = callback
        .get("data")
        .and_then(|x| x.as_str())
        .map(|data| data.starts_with("page:"))
        .unwrap_or(false);
    let parsed = callback_query_to_incoming(inst, callback);
    let allowed = parsed
        .as_ref()
        .map(|(incoming, _)| sender_allowed(&inst.acl, &incoming.sender_id))
        .unwrap_or(false);
    // Telegram keeps a spinner visible until answerCallbackQuery is called; acknowledge first,
    // before any account switch or session lookup can perform slower I/O.
    if let Some(callback_id) = callback.get("id").and_then(|x| x.as_str()) {
        let answer = if parsed.is_some() && !allowed {
            json!({
                "callback_query_id": callback_id,
                "text": "Not allowed.",
                "show_alert": true,
            })
        } else {
            json!({ "callback_query_id": callback_id })
        };
        let _ = post_bot_api(client, token, "answerCallbackQuery", &answer).await;
    }

    let Some((incoming, message_id)) = parsed else {
        return;
    };
    if !allowed {
        return;
    }
    let chat_id = incoming.chat_id.clone();
    let thread_id = incoming.thread_id.clone();
    if tx.send(incoming).await.is_ok() && !is_pagination {
        // Best-effort consume the keyboard so a stale project/session/account action
        // cannot be clicked repeatedly after the selection has been accepted.
        let _ = post_bot_api(
            client,
            token,
            "editMessageReplyMarkup",
            &with_thread_id(
                json!({
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "reply_markup": { "inline_keyboard": [] },
                }),
                thread_id.as_deref(),
            ),
        )
        .await;
    }
}

fn callback_query_to_incoming(
    inst: &ChannelInstance,
    callback: &Value,
) -> Option<(IncomingMessage, i64)> {
    let data = callback.get("data").and_then(|x| x.as_str())?.trim();
    if data.is_empty() {
        return None;
    }
    let message = callback.get("message")?;
    let message_id = message.get("message_id").and_then(|x| x.as_i64())?;
    let chat_id = message.pointer("/chat/id").map(json_id_to_string)?;
    if chat_id.is_empty() {
        return None;
    }
    let chat_type = message
        .pointer("/chat/type")
        .and_then(|x| x.as_str())
        .map(|kind| if kind == "private" { "p2p" } else { "group" })
        .unwrap_or("p2p")
        .to_string();
    let sender_id = callback.pointer("/from/id").map(json_id_to_string)?;
    if sender_id.is_empty() {
        return None;
    }

    Some((
        IncomingMessage {
            channel: inst.channel.clone(),
            instance_id: inst.id.clone(),
            message_id: message_id.to_string(),
            chat_id,
            chat_type,
            sender_id,
            content: format!("__card_action__:{data}"),
            mentioned_bot: true,
            thread_id: telegram_thread_id(message),
        },
        message_id,
    ))
}

pub fn telegram_thread_id(msg: &Value) -> Option<String> {
    let raw = msg.get("message_thread_id")?;
    let id = json_id_to_string(raw);
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

pub fn with_thread_id(mut body: Value, thread_id: Option<&str>) -> Value {
    let Some(tid) = thread_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return body;
    };
    body["message_thread_id"] = match tid.parse::<i64>() {
        Ok(n) => json!(n),
        Err(_) => json!(tid),
    };
    body
}

fn json_id_to_string(value: &Value) -> String {
    match value {
        Value::Number(number) => number.to_string(),
        Value::String(value) => value.clone(),
        _ => String::new(),
    }
}

/// Register default + Chinese command lists with Telegram Bot API.
pub async fn register_native_commands(client: &reqwest::Client, token: &str) -> Result<(), String> {
    let base = format!("https://api.telegram.org/bot{token}/setMyCommands");

    let en_cmds: Vec<Value> = native_bot_commands()
        .iter()
        .map(|c| {
            json!({
                "command": c.command,
                "description": c.description_en,
            })
        })
        .collect();
    let zh_cmds: Vec<Value> = native_bot_commands()
        .iter()
        .map(|c| {
            json!({
                "command": c.command,
                "description": c.description_zh,
            })
        })
        .collect();

    // Default language (fallback for all clients)
    post_set_my_commands(client, &base, &en_cmds, None).await?;
    for language_code in COMMAND_LANGUAGE_CODES_ZH {
        post_set_my_commands(client, &base, &zh_cmds, Some(language_code)).await?;
    }

    Ok(())
}

async fn post_set_my_commands(
    client: &reqwest::Client,
    url: &str,
    commands: &[Value],
    language_code: Option<&str>,
) -> Result<(), String> {
    let mut body = json!({ "commands": commands });
    if let Some(code) = language_code {
        body["language_code"] = json!(code);
    }
    let res = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("setMyCommands {status}: {text}"));
    }
    let v: Value = res.json().await.unwrap_or_default();
    if v.get("ok").and_then(|o| o.as_bool()) != Some(true) {
        let desc = v
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("setMyCommands_failed");
        return Err(desc.to_string());
    }
    Ok(())
}

/// Strip `@BotUsername` from the leading bot_command entity (UTF-16 offsets per Telegram API).
pub fn normalize_bot_command_text(text: &str, entities: Option<&Vec<Value>>) -> String {
    let Some(entities) = entities else {
        return strip_at_in_leading_slash(text);
    };
    let Some(ent) = entities.iter().find(|e| {
        e.get("type").and_then(|t| t.as_str()) == Some("bot_command")
            && e.get("offset").and_then(|o| o.as_u64()) == Some(0)
    }) else {
        return strip_at_in_leading_slash(text);
    };
    let Some(len) = ent
        .get("length")
        .and_then(|l| l.as_u64())
        .map(|n| n as usize)
    else {
        return strip_at_in_leading_slash(text);
    };
    let utf16: Vec<u16> = text.encode_utf16().collect();
    if len > utf16.len() {
        return strip_at_in_leading_slash(text);
    }
    let cmd_u16 = &utf16[..len];
    let rest_u16 = &utf16[len..];
    let cmd = String::from_utf16_lossy(cmd_u16);
    let rest = String::from_utf16_lossy(rest_u16);
    let normalized_cmd = if let Some((base, _)) = cmd.split_once('@') {
        base.to_string()
    } else {
        cmd
    };
    format!("{normalized_cmd}{rest}")
}

/// Fallback when entities are missing: `/help@Bot arg` → `/help arg`.
fn strip_at_in_leading_slash(text: &str) -> String {
    let t = text.trim_start();
    if !t.starts_with('/') {
        return text.to_string();
    }
    let rest = &t[1..];
    let (head, tail) = match rest.find(char::is_whitespace) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if let Some((cmd, _)) = head.split_once('@') {
        format!("/{cmd}{tail}")
    } else {
        text.to_string()
    }
}

fn bot_token(secrets: &std::collections::HashMap<String, String>) -> Result<&str, String> {
    secrets
        .get("bot_token")
        .or_else(|| secrets.get("token"))
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing bot_token".to_string())
}

async fn post_bot_api(
    client: &reqwest::Client,
    token: &str,
    method: &str,
    body: &Value,
) -> Result<Value, String> {
    let res = client
        .post(format!("https://api.telegram.org/bot{token}/{method}"))
        .json(body)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = res.status();
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() || value.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        let description = value
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("Telegram Bot API request failed");
        return Err(format!("telegram {method} {status}: {description}"));
    }
    Ok(value)
}

async fn post_with_markdown_fallback(
    token: &str,
    method: &str,
    mut body: Value,
) -> Result<(), String> {
    let client = http_client()?;
    body["parse_mode"] = json!("Markdown");
    if post_bot_api(&client, token, method, &body).await.is_ok() {
        return Ok(());
    }
    // User/project/session labels may contain Markdown punctuation; preserve buttons
    // and retry as plain text rather than dropping the whole native selection result.
    if let Some(object) = body.as_object_mut() {
        object.remove("parse_mode");
    }
    post_bot_api(&client, token, method, &body)
        .await
        .map(|_| ())
}

pub async fn send_text(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    text: &str,
    thread_id: Option<&str>,
) -> Result<(), String> {
    let token = bot_token(secrets)?;
    post_with_markdown_fallback(
        token,
        "sendMessage",
        with_thread_id(
            json!({
                "chat_id": chat_id,
                "text": text,
            }),
            thread_id,
        ),
    )
    .await
}

pub async fn send_card(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    card: &Value,
    thread_id: Option<&str>,
) -> Result<(), String> {
    let token = bot_token(secrets)?;
    let text = card
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("Select:");
    let reply_markup = card
        .get("reply_markup")
        .cloned()
        .unwrap_or_else(|| json!({ "inline_keyboard": [] }));
    post_with_markdown_fallback(
        token,
        "sendMessage",
        with_thread_id(
            json!({
                "chat_id": chat_id,
                "text": text,
                "reply_markup": reply_markup,
            }),
            thread_id,
        ),
    )
    .await
}

pub async fn edit_card(
    secrets: &std::collections::HashMap<String, String>,
    chat_id: &str,
    message_id: &str,
    card: &Value,
    thread_id: Option<&str>,
) -> Result<(), String> {
    let token = bot_token(secrets)?;
    let message_id = message_id
        .parse::<i64>()
        .map_err(|_| "invalid Telegram message_id".to_string())?;
    let text = card
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("Select:");
    let reply_markup = card
        .get("reply_markup")
        .cloned()
        .unwrap_or_else(|| json!({ "inline_keyboard": [] }));
    post_with_markdown_fallback(
        token,
        "editMessageText",
        with_thread_id(
            json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "reply_markup": reply_markup,
            }),
            thread_id,
        ),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn command_menu_language_codes_are_telegram_compatible() {
        assert_eq!(COMMAND_LANGUAGE_CODES_ZH, &["zh"]);
        assert!(COMMAND_LANGUAGE_CODES_ZH
            .iter()
            .all(|code| { code.len() == 2 && code.bytes().all(|byte| byte.is_ascii_lowercase()) }));
    }

    #[test]
    fn normalizes_bot_command_with_entity() {
        let text = "/help@MyGrokBot";
        // ASCII: length in UTF-16 units equals char count
        let entities = vec![json!({
            "offset": 0,
            "length": text.encode_utf16().count(),
            "type": "bot_command"
        })];
        assert_eq!(normalize_bot_command_text(text, Some(&entities)), "/help");
    }

    #[test]
    fn normalizes_bot_command_with_args() {
        let text = "/p@MyBot 1";
        let entities = vec![json!({
            "offset": 0,
            "length": "/p@MyBot".encode_utf16().count(),
            "type": "bot_command"
        })];
        assert_eq!(normalize_bot_command_text(text, Some(&entities)), "/p 1");
    }

    #[test]
    fn fallback_strip_without_entities() {
        assert_eq!(normalize_bot_command_text("/status@BotX", None), "/status");
        assert_eq!(normalize_bot_command_text("/r@Bot 3", None), "/r 3");
    }

    #[test]
    fn callback_query_maps_to_card_action_message() {
        let inst = ChannelInstance {
            id: "tg-1".into(),
            channel: "telegram".into(),
            name: "Bot".into(),
            enabled: true,
            secrets: std::collections::HashMap::new(),
            options: json!({}),
            acl: json!({}),
            project_scope: json!({}),
        };
        let callback = json!({
            "id": "cb-1",
            "from": { "id": 42 },
            "data": "project:project-1",
            "message": {
                "message_id": 99,
                "chat": { "id": -1001, "type": "supergroup" }
            }
        });

        let (incoming, message_id) = callback_query_to_incoming(&inst, &callback).unwrap();
        assert_eq!(message_id, 99);
        assert_eq!(incoming.sender_id, "42");
        assert_eq!(incoming.chat_id, "-1001");
        assert_eq!(incoming.chat_type, "group");
        assert_eq!(incoming.content, "__card_action__:project:project-1");
        assert!(incoming.mentioned_bot);
        assert_eq!(incoming.thread_id, None);
    }

    #[test]
    fn parses_and_stamps_message_thread_id() {
        let msg = json!({
            "message_id": 12,
            "message_thread_id": 77,
            "chat": { "id": 42, "type": "private" },
            "text": "hi"
        });
        assert_eq!(telegram_thread_id(&msg).as_deref(), Some("77"));
        let stamped = with_thread_id(json!({ "chat_id": 42, "text": "ok" }), Some("77"));
        assert_eq!(stamped["message_thread_id"], json!(77));
        let skipped = with_thread_id(json!({ "chat_id": 42, "text": "ok" }), None);
        assert!(skipped.get("message_thread_id").is_none());
    }

    #[test]
    fn callback_query_keeps_topic_thread_id() {
        let inst = ChannelInstance {
            id: "tg-1".into(),
            channel: "telegram".into(),
            name: "Bot".into(),
            enabled: true,
            secrets: std::collections::HashMap::new(),
            options: json!({}),
            acl: json!({}),
            project_scope: json!({}),
        };
        let callback = json!({
            "id": "cb-1",
            "from": { "id": 42 },
            "data": "project:project-1",
            "message": {
                "message_id": 99,
                "message_thread_id": 8,
                "chat": { "id": 42, "type": "private" }
            }
        });
        let (incoming, _) = callback_query_to_incoming(&inst, &callback).unwrap();
        assert_eq!(incoming.thread_id.as_deref(), Some("8"));
        assert_eq!(incoming.chat_type, "p2p");
    }
}
