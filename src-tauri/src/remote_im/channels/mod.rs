//! Per-IM channel connectors (all Rust, no Node agent-connect).

pub mod dingtalk;
pub mod discord;
pub mod feishu;
pub mod generic;
pub mod line;
pub mod matrix;
pub mod qq;
pub mod qqbot;
pub mod slack;
pub mod telegram;
pub mod wecom;
pub mod weibo;
pub mod weixin;
pub mod wps_xiezuo;

use super::types::{ChannelInstance, IncomingMessage};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

/// Catalog channel ids that must have a real connector entry.
pub const CATALOG_CHANNELS: &[&str] = &[
    "feishu",
    "lark",
    "dingtalk",
    "wecom",
    "weixin",
    "wps-xiezuo",
    "weibo",
    "qq",
    "qqbot",
    "telegram",
    "slack",
    "discord",
    "matrix",
    "line",
    "wps-agentspace",
];

/// Protocol entry name for a channel (for doctor / tests). Never "generic-sleep" for core.
pub fn protocol_for(channel: &str) -> &'static str {
    match channel {
        "feishu" | "lark" => feishu::protocol_name(),
        "dingtalk" => dingtalk::protocol_name(),
        "wecom" => wecom::protocol_name(),
        "weixin" => weixin::protocol_name(),
        "telegram" => "telegram-getupdates",
        "discord" => "discord-gateway",
        "slack" => "slack-socket-mode",
        "qq" => qq::protocol_name(),
        "qqbot" => qqbot::protocol_name(),
        "matrix" => matrix::protocol_name(),
        "line" => line::protocol_name(),
        "weibo" => weibo::protocol_name(),
        "wps-xiezuo" => wps_xiezuo::protocol_name(),
        "wps-agentspace" => "wps-agentspace-ws-or-poll",
        other => {
            let _ = other;
            "generic-health"
        }
    }
}

pub fn is_real_protocol(channel: &str) -> bool {
    !matches!(protocol_for(channel), "generic-health")
}

/// Spawn background connector for one enabled instance.
pub fn spawn_instance(
    mut inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    cancel: watch::Receiver<bool>,
) -> JoinHandle<()> {
    // Inject instance id for outbound helpers (webhooks, weixin context)
    inst.secrets
        .insert("_instance_id".into(), inst.id.clone());
    let channel = inst.channel.clone();
    tokio::spawn(async move {
        let id = inst.id.clone();
        let result = match channel.as_str() {
            "feishu" | "lark" => feishu::run(inst, tx, cancel).await,
            "telegram" => telegram::run(inst, tx, cancel).await,
            "discord" => discord::run(inst, tx, cancel).await,
            "slack" => slack::run(inst, tx, cancel).await,
            "dingtalk" => dingtalk::run(inst, tx, cancel).await,
            "wecom" => wecom::run(inst, tx, cancel).await,
            "weixin" => weixin::run(inst, tx, cancel).await,
            "qq" => qq::run(inst, tx, cancel).await,
            "qqbot" => qqbot::run(inst, tx, cancel).await,
            "matrix" => matrix::run(inst, tx, cancel).await,
            "line" => line::run(inst, tx, cancel).await,
            "weibo" => weibo::run(inst, tx, cancel).await,
            "wps-xiezuo" | "wps-agentspace" => wps_xiezuo::run(inst, tx, cancel).await,
            other => generic::run(other, inst, tx, cancel).await,
        };
        if let Err(e) = result {
            tracing::error!(instance = %id, channel = %channel, "channel connector exited: {e}");
            // Surface bind/auth failures so Settings does not keep a green "connected".
            let _ = super::config::set_instance_last_error(&id, Some(e));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_catalog_channel_has_real_protocol_entry() {
        for ch in CATALOG_CHANNELS {
            let p = protocol_for(ch);
            assert!(
                !p.is_empty(),
                "channel {ch} missing protocol"
            );
            // Core IM must not be generic-health
            if matches!(
                *ch,
                "feishu"
                    | "lark"
                    | "dingtalk"
                    | "wecom"
                    | "weixin"
                    | "telegram"
                    | "discord"
                    | "slack"
                    | "qq"
                    | "qqbot"
                    | "matrix"
                    | "line"
                    | "weibo"
                    | "wps-xiezuo"
            ) {
                assert_ne!(
                    p, "generic-health",
                    "channel {ch} still generic-health stub"
                );
            }
        }
    }

    #[test]
    fn dingtalk_and_wecom_not_token_only_names() {
        assert!(protocol_for("dingtalk").contains("stream") || protocol_for("dingtalk").contains("gateway"));
        assert!(
            protocol_for("wecom").contains("ws") || protocol_for("wecom").contains("webhook")
        );
        assert!(protocol_for("weixin").contains("ilink") || protocol_for("weixin").contains("longpoll"));
    }
}
