//! WebSocket hub for mirror clients — RPC in, event fan-out out (DESIGN §7).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::broadcast;

use super::rpc;
use super::MirrorHost;
use crate::session_manager::SessionManager;

/// Connected mirror clients and broadcast channel for `event` frames (JSON text).
pub struct WsHub {
    tx: broadcast::Sender<String>,
    clients: AtomicUsize,
}

impl Default for WsHub {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for WsHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsHub")
            .field("clients", &self.clients.load(Ordering::Relaxed))
            .finish()
    }
}

impl WsHub {
    /// Ask every open socket loop to exit (used after token rotate).
    pub fn disconnect_all(&self) {
        let _ = self.tx.send("__mirror_close_all__".into());
    }

    pub fn new() -> Self {
        // Capacity for bursty stream events; lagging clients drop old frames.
        let (tx, _) = broadcast::channel(512);
        Self {
            tx,
            clients: AtomicUsize::new(0),
        }
    }

    pub fn client_count(&self) -> usize {
        self.clients.load(Ordering::Relaxed)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    /// Fan-out a named event (payload already JSON-serializable).
    pub fn broadcast(&self, name: &str, payload: &Value) {
        let frame = json!({
            "type": "event",
            "name": name,
            "payload": payload,
        });
        let s = frame.to_string();
        // Ignore "no receivers" — hub may be idle.
        let _ = self.tx.send(s);
    }

    fn client_joined(&self) -> usize {
        self.clients.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn client_left(&self) {
        let _ = self
            .clients
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |c| {
                Some(c.saturating_sub(1))
            });
    }
}

/// Per-connection handler after HTTP upgrade (token already gated).
pub async fn handle_socket(
    socket: WebSocket,
    host: Arc<MirrorHost>,
    app: Option<AppHandle>,
    mgr: Option<Arc<SessionManager>>,
) {
    let hub = host.hub();
    let n = hub.client_joined();
    tracing::info!(clients = n, "mirror: websocket client connected");

    let (mut sender, mut receiver) = socket.split();
    let mut event_rx = hub.subscribe();

    // Hello on connect (DESIGN §7.1).
    let hello = build_hello(&host, &app).await;
    if sender
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        hub.client_left();
        return;
    }

    loop {
        tokio::select! {
            biased;
            // Outbound fan-out events
            evt = event_rx.recv() => {
                match evt {
                    Ok(text) if text == "__mirror_close_all__" => break,
                    Ok(text) => {
                        if sender.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(skipped = n, "mirror ws client lagged; dropped events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            // Inbound RPC / control
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.to_string();
                        if let Some(resp) = handle_text_frame(
                            &text,
                            host.as_ref(),
                            app.as_ref(),
                            mgr.as_ref(),
                        ).await {
                            if sender.send(Message::Text(resp.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        if sender.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Pong(_))) | Some(Ok(Message::Binary(_))) => {}
                    Some(Err(e)) => {
                        tracing::debug!(error = %e, "mirror ws recv error");
                        break;
                    }
                }
            }
        }
    }

    hub.client_left();
    tracing::info!(
        clients = hub.client_count(),
        "mirror: websocket client disconnected"
    );
}

async fn build_hello(host: &MirrorHost, app: &Option<AppHandle>) -> Value {
    let st = host.status();
    let account = match app {
        Some(a) => rpc::account_summary_light(a).await,
        None => json!({ "signedIn": false, "displayName": null }),
    };
    let host_version = env!("CARGO_PKG_VERSION");
    json!({
        "type": "event",
        "name": "mirror://hello",
        "payload": {
            "protocol": rpc::PROTOCOL_VERSION,
            "hostVersion": host_version,
            "account": account,
            "connection": {
                "tunnel": matches!(st.phase, super::MirrorPhase::Live | super::MirrorPhase::WaitingTunnel),
                "clients": st.clients,
            }
        }
    })
}

async fn handle_text_frame(
    text: &str,
    host: &MirrorHost,
    app: Option<&AppHandle>,
    mgr: Option<&Arc<SessionManager>>,
) -> Option<String> {
    let v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "mirror ws: invalid JSON");
            return Some(
                json!({
                    "id": null,
                    "type": "res",
                    "ok": false,
                    "code": "BAD_REQUEST",
                    "error": "invalid JSON",
                })
                .to_string(),
            );
        }
    };

    let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if typ != "req" {
        // Ignore non-request frames (clients should only send req).
        return None;
    }

    let id = v.get("id").cloned().unwrap_or(Value::Null);
    let method = v
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let params = v.get("params").cloned().unwrap_or(json!({}));

    let result = rpc::dispatch(method.as_str(), params, host, app, mgr).await;
    let res = match result {
        Ok(result) => json!({
            "id": id,
            "type": "res",
            "ok": true,
            "result": result,
        }),
        Err(err) => json!({
            "id": id,
            "type": "res",
            "ok": false,
            "code": err.code,
            "error": err.message,
        }),
    };
    Some(res.to_string())
}
