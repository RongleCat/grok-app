//! Unified outbound reply router for all channel types (Rust HTTP / WS clients).

#![allow(dead_code)] // residual-clippy: test helpers and unused channel send paths
use parking_lot::RwLock;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct OutboundRouter {
    /// instance_id -> channel credentials snapshot
    creds: Arc<RwLock<HashMap<String, InstanceCreds>>>,
}

#[derive(Clone)]
struct InstanceCreds {
    channel: String,
    secrets: HashMap<String, String>,
    options: serde_json::Value,
}

impl OutboundRouter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        instance_id: &str,
        channel: &str,
        mut secrets: HashMap<String, String>,
        options: serde_json::Value,
    ) {
        // Always stamp instance id for weixin context_token / dingtalk webhook maps.
        secrets.insert("_instance_id".into(), instance_id.to_string());
        self.creds.write().insert(
            instance_id.to_string(),
            InstanceCreds {
                channel: channel.to_string(),
                secrets,
                options,
            },
        );
    }

    /// Test/helper: read back injected secrets for an instance.
    pub fn secrets_for_test(&self, instance_id: &str) -> Option<HashMap<String, String>> {
        self.creds
            .read()
            .get(instance_id)
            .map(|c| c.secrets.clone())
    }

    pub fn unregister(&self, instance_id: &str) {
        self.creds.write().remove(instance_id);
    }

    pub fn clear(&self) {
        self.creds.write().clear();
    }

    pub async fn reply(
        &self,
        instance_id: &str,
        chat_id: &str,
        reply_to: Option<&str>,
        text: &str,
    ) -> Result<(), String> {
        let cred = self
            .creds
            .read()
            .get(instance_id)
            .cloned()
            .ok_or_else(|| format!("no outbound creds for {instance_id}"))?;
        match cred.channel.as_str() {
            "feishu" | "lark" => {
                super::channels::feishu::send_text(
                    &cred.channel,
                    &cred.secrets,
                    &cred.options,
                    chat_id,
                    reply_to,
                    text,
                )
                .await
            }
            "telegram" => super::channels::telegram::send_text(&cred.secrets, chat_id, text).await,
            "discord" => super::channels::discord::send_text(&cred.secrets, chat_id, text).await,
            "slack" => super::channels::slack::send_text(&cred.secrets, chat_id, text).await,
            "dingtalk" => super::channels::dingtalk::send_text(&cred.secrets, chat_id, text).await,
            "wecom" => super::channels::wecom::send_text(&cred.secrets, chat_id, text).await,
            "weixin" => super::channels::weixin::send_text(&cred.secrets, chat_id, text).await,
            "qq" => super::channels::qq::send_text(&cred.secrets, chat_id, text).await,
            "qqbot" => super::channels::qqbot::send_text(&cred.secrets, chat_id, text).await,
            "matrix" => super::channels::matrix::send_text(&cred.secrets, chat_id, text).await,
            "line" => super::channels::line::send_text(&cred.secrets, chat_id, text).await,
            "weibo" => super::channels::weibo::send_text(&cred.secrets, chat_id, text).await,
            "wps-xiezuo" => {
                super::channels::wps_xiezuo::send_text(&cred.secrets, chat_id, text).await
            }
            other => {
                tracing::warn!(channel = other, "outbound reply not implemented; dropping");
                Ok(())
            }
        }
    }

    /// Interactive card (Feishu / DingTalk action card / Telegram inline keyboard).
    pub async fn reply_card(
        &self,
        instance_id: &str,
        chat_id: &str,
        reply_to: Option<&str>,
        card: &serde_json::Value,
    ) -> Result<(), String> {
        let cred = self
            .creds
            .read()
            .get(instance_id)
            .cloned()
            .ok_or_else(|| format!("no outbound creds for {instance_id}"))?;
        match cred.channel.as_str() {
            "feishu" | "lark" => {
                super::channels::feishu::send_card(
                    &cred.channel,
                    &cred.secrets,
                    &cred.options,
                    chat_id,
                    reply_to,
                    card,
                )
                .await
            }
            "dingtalk" => super::channels::dingtalk::send_card(&cred.secrets, chat_id, card).await,
            "telegram" => super::channels::telegram::send_card(&cred.secrets, chat_id, card).await,
            _ => {
                // Fallback: dump card as text menu summary
                let text = format!(
                    "{}\n{}",
                    card.pointer("/header/title/content")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Select:"),
                    card
                );
                self.reply(
                    instance_id,
                    chat_id,
                    reply_to,
                    &text.chars().take(2000).collect::<String>(),
                )
                .await
            }
        }
    }

    /// Replace an existing interactive result in-place where the channel supports it.
    pub async fn edit_card(
        &self,
        instance_id: &str,
        chat_id: &str,
        message_id: &str,
        card: &serde_json::Value,
    ) -> Result<(), String> {
        let cred = self
            .creds
            .read()
            .get(instance_id)
            .cloned()
            .ok_or_else(|| format!("no outbound creds for {instance_id}"))?;
        match cred.channel.as_str() {
            "telegram" => {
                super::channels::telegram::edit_card(&cred.secrets, chat_id, message_id, card).await
            }
            _ => self.reply_card(instance_id, chat_id, None, card).await,
        }
    }
}

pub fn http_client() -> Result<reqwest::Client, String> {
    crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("GrokApp-RemoteIM/1.0")
        .build()
        .map_err(|e| e.to_string())
}

pub async fn json_post(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let c = http_client()?;
    let res = c
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| {
        format!(
            "HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        )
    })
}

#[allow(dead_code)]
pub async fn json_get_bearer(url: &str, token: &str) -> Result<serde_json::Value, String> {
    let c = http_client()?;
    let res = c
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn redact_preview(s: &str) -> String {
    if s.len() <= 8 {
        return "***".into();
    }
    format!("{}…", &s[..4])
}

pub fn opt_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn secret_or_opt(
    secrets: &HashMap<String, String>,
    options: &serde_json::Value,
    key: &str,
) -> Option<String> {
    secrets
        .get(key)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| opt_str(options, key))
}

/// Parse allow-from ACL.
///
/// - `*` or missing → open (None)
/// - empty string → fail-closed empty list
/// - comma list → allow only those senders
pub fn allow_from_list(acl: &serde_json::Value) -> Option<Vec<String>> {
    let raw = acl
        .get("allowFrom")
        .or_else(|| acl.get("allow_from"))
        .and_then(|x| x.as_str())
        .unwrap_or("*")
        .trim();
    if raw == "*" {
        return None;
    }
    if raw.is_empty() {
        return Some(vec![]);
    }
    Some(
        raw.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    )
}

pub fn sender_allowed(acl: &serde_json::Value, sender_id: &str) -> bool {
    match allow_from_list(acl) {
        None => true,
        Some(list) if list.is_empty() => false,
        Some(list) => list.iter().any(|x| x == sender_id || x == "*"),
    }
}

/// True when enable should be refused (empty allow list, not `*`).
pub fn allow_from_blocks_enable(acl: &serde_json::Value) -> bool {
    matches!(allow_from_list(acl), Some(list) if list.is_empty())
}

/// Whether group chats require @bot.
///
/// Priority: explicit `require_mention` / ACL `requireMention`, else invert
/// options `group_reply_all` (§6.1 / §3.2). Default true (need @).
pub fn require_mention(options: &serde_json::Value, acl: &serde_json::Value) -> bool {
    if let Some(b) = options
        .get("require_mention")
        .or_else(|| acl.get("requireMention"))
        .and_then(|x| x.as_bool())
    {
        return b;
    }
    if let Some(all) = options.get("group_reply_all").and_then(|x| x.as_bool()) {
        return !all;
    }
    true
}

/// Helper for telegram-style JSON APIs
pub fn empty_json() -> serde_json::Value {
    json!({})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_always_injects_instance_id() {
        let r = OutboundRouter::new();
        let mut secrets = HashMap::new();
        secrets.insert("token".into(), "t".into());
        r.register("inst-42", "weixin", secrets, json!({}));
        let got = r.secrets_for_test("inst-42").unwrap();
        assert_eq!(got.get("_instance_id").map(|s| s.as_str()), Some("inst-42"));
        assert_eq!(got.get("token").map(|s| s.as_str()), Some("t"));
    }

    #[test]
    fn require_mention_honors_acl_and_group_reply_all() {
        // ACL requireMention wins
        assert!(!require_mention(
            &json!({}),
            &json!({ "requireMention": false }),
        ));
        assert!(require_mention(
            &json!({}),
            &json!({ "requireMention": true }),
        ));
        // group_reply_all is inverse when no explicit require_*
        assert!(!require_mention(
            &json!({ "group_reply_all": true }),
            &json!({}),
        ));
        assert!(require_mention(
            &json!({ "group_reply_all": false }),
            &json!({}),
        ));
        // default need @
        assert!(require_mention(&json!({}), &json!({})));
    }
}
