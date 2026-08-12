//! In-process multi-channel Remote IM runtime (Rust only).

#![allow(dead_code)] // residual-clippy: runtime holder fields
use super::channels;
use super::config;
use super::engine::Engine;
use super::outbound::OutboundRouter;
use super::slash::{self, BuiltinCommand};
use super::types::{ChannelInstance, ConnectedChannel, IncomingMessage};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

pub struct RuntimeHandle {
    cancel_tx: watch::Sender<bool>,
    pump: JoinHandle<()>,
    connectors: Vec<JoinHandle<()>>,
    /// Kept alive so the pump channel never closes while connectors restart.
    _keepalive_tx: mpsc::Sender<IncomingMessage>,
    outbound: OutboundRouter,
    engine: Arc<Engine>,
}

fn should_handle_inline(content: &str) -> bool {
    let trimmed = content.trim();
    if matches!(
        slash::parse_slash(trimmed),
        Some(BuiltinCommand::Compact { .. })
    ) {
        return false;
    }
    trimmed.starts_with('/') || trimmed.starts_with("__card_action__:")
}

impl RuntimeHandle {
    pub async fn stop(self) {
        let _ = self.cancel_tx.send(true);
        // Give connectors a moment to exit long-poll / WS loops via cancel.
        tokio::time::sleep(Duration::from_millis(200)).await;
        for h in self.connectors {
            h.abort();
        }
        self.pump.abort();
        // Do NOT clear outbound here: in-flight handle tasks may still reply.
        // A subsequent start_runtime builds a fresh OutboundRouter.
    }

    /// True when the message pump task has finished (unexpected exit / panic).
    pub fn is_finished(&self) -> bool {
        self.pump.is_finished()
    }
}

pub async fn start_runtime(
    allow_remote_yolo: bool,
) -> Result<(RuntimeHandle, Vec<ConnectedChannel>), String> {
    let list = config::list_instances();
    let mut active = Vec::new();
    let mut instances = Vec::new();

    for dto in list {
        if !dto.enabled || !dto.has_credentials {
            continue;
        }
        let secrets = config::get_secrets(&dto.id);
        if secrets.is_empty() {
            continue;
        }
        let inst = ChannelInstance {
            id: dto.id.clone(),
            channel: dto.channel.clone(),
            name: dto.name.clone(),
            enabled: true,
            secrets,
            options: dto.options.clone(),
            acl: dto.acl.clone(),
            project_scope: dto.project_scope.clone(),
        };
        active.push(ConnectedChannel {
            channel: dto.channel.clone(),
            instance_id: dto.id.clone(),
            name: dto.name.clone(),
        });
        instances.push(inst);
    }

    if instances.is_empty() {
        return Err("no enabled channel with credentials".into());
    }

    let outbound = OutboundRouter::new();
    let engine = Arc::new(Engine::new(outbound.clone(), allow_remote_yolo));
    for inst in &instances {
        // Must inject _instance_id so weixin context_token / dingtalk webhooks resolve.
        let mut secrets = inst.secrets.clone();
        secrets.insert("_instance_id".into(), inst.id.clone());
        // Non-secret bind fields (feishu app_id, domain) live in options — also mirror
        // string options into secrets so send helpers that only read secrets still work.
        if let Some(obj) = inst.options.as_object() {
            for (k, v) in obj {
                if secrets.contains_key(k) {
                    continue;
                }
                if let Some(s) = v.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                    secrets.insert(k.clone(), s.to_string());
                }
            }
        }
        outbound.register(&inst.id, &inst.channel, secrets, inst.options.clone());
        engine.upsert_instance(inst.clone());
    }

    let (msg_tx, mut msg_rx) = mpsc::channel::<IncomingMessage>(256);
    let (cancel_tx, cancel_rx) = watch::channel(false);

    let eng = engine.clone();
    let pump = tokio::spawn(async move {
        tracing::info!("remote_im: message pump started");
        while let Some(msg) = msg_rx.recv().await {
            let preview: String = msg.content.chars().take(40).collect();
            tracing::info!(
                channel = %msg.channel,
                instance = %msg.instance_id,
                chat = %msg.chat_id,
                sender = %msg.sender_id,
                content_len = msg.content.len(),
                preview = %preview,
                "remote_im: engine recv"
            );
            let e = eng.clone();
            // Control-plane messages are awaited inline (must not be dropped).
            // Agent turns, including `/compact`, are detached so `/stop` can
            // always reach the pump and cancel them.
            if should_handle_inline(&msg.content) {
                e.handle(msg).await;
            } else {
                drop(e.spawn_cancellable(msg));
            }
        }
        tracing::warn!("remote_im: message pump exited (all senders dropped)");
    });

    let mut connectors = Vec::new();
    for inst in instances {
        let h = channels::spawn_instance(inst, msg_tx.clone(), cancel_rx.clone());
        connectors.push(h);
    }
    // Keep one sender so pump does not exit if a connector task ends/restarts.
    let keepalive_tx = msg_tx;

    Ok((
        RuntimeHandle {
            cancel_tx,
            pump,
            connectors,
            _keepalive_tx: keepalive_tx,
            outbound,
            engine,
        },
        active,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_is_detached_while_stop_stays_inline() {
        assert!(!should_handle_inline("/compact"));
        assert!(!should_handle_inline("/compact keep decisions"));
        assert!(!should_handle_inline("/compact@GrokBot keep decisions"));
        assert!(!should_handle_inline("0"));
        assert!(!should_handle_inline("cancel"));
        assert!(should_handle_inline("/stop"));
        assert!(should_handle_inline("/help"));
    }
}
