//! Remote mirror host — phone browser becomes a live UI of the desktop host.
//!
//! See `DESIGN.md` and `PLAN.md` Wave 2.

mod auth;
mod http;
mod lan;
mod rpc;
mod tunnel;
mod ws;

use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

pub use auth::generate_token;

use crate::session_manager::SessionManager;

/// Default concurrent phone WebSocket clients (SEC-08c). Overridable via env / panel.
pub const DEFAULT_MAX_CLIENTS: u32 = 4;
/// Hard upper clamp for max clients (avoid unbounded fan-out).
pub const MAX_CLIENTS_CAP: u32 = 16;
/// Minimum concurrent clients setting.
pub const MIN_CLIENTS: u32 = 1;

/// Clamp user/env max-clients to a safe range.
pub fn normalize_max_clients(raw: u32) -> u32 {
    raw.clamp(MIN_CLIENTS, MAX_CLIENTS_CAP)
}

/// Environment contract (DESIGN §12).
#[derive(Debug, Clone)]
pub struct MirrorEnvConfig {
    /// `GROK_MIRROR_HEADLESS=1` → auto-start after app setup.
    pub headless: bool,
    /// Fixed token when set (`GROK_MIRROR_TOKEN`).
    pub token: Option<String>,
    /// Fixed loopback port when set (`GROK_MIRROR_PORT`).
    pub port: Option<u16>,
    /// Skip cloudflared when true (`GROK_MIRROR_NO_TUNNEL=1`).
    pub no_tunnel: bool,
    /// Bind `0.0.0.0` when true (`GROK_MIRROR_ALLOW_LAN=1`). Default loopback.
    pub allow_lan: bool,
    /// Override static SPA root (`GROK_MIRROR_DIST`).
    pub dist: Option<PathBuf>,
    /// Concurrent WS client cap (`GROK_MIRROR_MAX_CLIENTS`, default 4).
    pub max_clients: u32,
}

impl MirrorEnvConfig {
    pub fn from_env() -> Self {
        let headless = env_truthy("GROK_MIRROR_HEADLESS");
        let token = std::env::var("GROK_MIRROR_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let port = std::env::var("GROK_MIRROR_PORT")
            .ok()
            .and_then(|s| s.trim().parse::<u16>().ok())
            .filter(|&p| p > 0);
        let no_tunnel = env_truthy("GROK_MIRROR_NO_TUNNEL");
        let allow_lan = env_truthy("GROK_MIRROR_ALLOW_LAN");
        let dist = std::env::var("GROK_MIRROR_DIST")
            .ok()
            .map(|s| PathBuf::from(s.trim()))
            .filter(|p| !p.as_os_str().is_empty());
        let max_clients = std::env::var("GROK_MIRROR_MAX_CLIENTS")
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .map(normalize_max_clients)
            .unwrap_or(DEFAULT_MAX_CLIENTS);
        Self {
            headless,
            token,
            port,
            no_tunnel,
            allow_lan,
            dist,
            max_clients,
        }
    }
}

fn env_truthy(key: &str) -> bool {
    match std::env::var(key) {
        Ok(v) => {
            let v = v.trim().to_ascii_lowercase();
            matches!(v.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => false,
    }
}

/// Lifecycle phase for Connect panel / status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MirrorPhase {
    Stopped,
    Starting,
    /// Local HTTP up; tunnel skipped or not yet ready.
    Local,
    WaitingTunnel,
    Live,
    /// Local host still running; cloudflared child exited (do not auto-restart).
    TunnelDead,
    Error,
}

/// Public status returned by `mirror_status` / start.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorStatus {
    pub running: bool,
    pub public_url: Option<String>,
    pub local_port: Option<u16>,
    /// Full token for QR / copy while host is running. Prefer publicUrl for display.
    /// Memory-only — never persist to disk / localStorage / support bundles.
    pub token: Option<String>,
    /// Last 6 chars of token for safe display in logs / status chips.
    pub token_tail: Option<String>,
    pub clients: u32,
    /// Concurrent WebSocket client cap (1–16, default 4).
    pub max_clients: u32,
    pub phase: MirrorPhase,
    pub error: Option<String>,
    /// When true, mirror RPC rejects write methods (send / permissions / create).
    pub read_only: bool,
    /// When true, HTTP listens on all interfaces (`0.0.0.0`) so same-LAN phones can connect.
    pub allow_lan: bool,
    /// Copy/QR URL using the detected LAN IPv4. None when LAN is off or no IPv4 found.
    pub lan_url: Option<String>,
}

struct Runtime {
    token: String,
    port: u16,
    phase: MirrorPhase,
    public_url: Option<String>,
    error: Option<String>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// cloudflared adapter handle (host process or Docker container); stopped on teardown.
    tunnel: Option<tunnel::TunnelHandle>,
    #[allow(dead_code)] // kept for future media/static re-resolve
    dist_dir: PathBuf,
    read_only: bool,
    allow_lan: bool,
    /// Cached default-route IPv4 for copy/QR (None = undetected).
    lan_ip: Option<Ipv4Addr>,
}

/// Host-side handles for RPC (set in app setup / mirror_start).
struct HostCtx {
    app: AppHandle,
    mgr: Arc<SessionManager>,
}

struct Inner {
    env: MirrorEnvConfig,
    runtime: Option<Runtime>,
    ctx: Option<HostCtx>,
    /// Default for new starts; also applied to live runtime via set_read_only.
    read_only: bool,
    /// Concurrent WS client cap (panel + env). Survives stop/start in-process.
    max_clients: u32,
    /// LAN bind preference (panel + env). Default false (loopback).
    allow_lan: bool,
}

/// Process-wide mirror host (memory-only token; not persisted).
pub struct MirrorHost {
    inner: Mutex<Inner>,
    hub: Arc<ws::WsHub>,
}

impl MirrorHost {
    pub fn from_env() -> Self {
        let env = MirrorEnvConfig::from_env();
        let max_clients = env.max_clients;
        let allow_lan = env.allow_lan;
        Self {
            inner: Mutex::new(Inner {
                env,
                runtime: None,
                ctx: None,
                // Safe default: phone can observe until the user opts into write access.
                read_only: true,
                max_clients,
                allow_lan,
            }),
            hub: Arc::new(ws::WsHub::new()),
        }
    }

    pub fn hub(&self) -> Arc<ws::WsHub> {
        self.hub.clone()
    }

    /// Attach AppHandle + SessionManager so WS RPC can call domain logic.
    pub fn attach(&self, app: AppHandle, mgr: Arc<SessionManager>) {
        let mut g = self.inner.lock();
        g.ctx = Some(HostCtx { app, mgr });
    }

    pub fn rpc_ctx(&self) -> Option<(AppHandle, Arc<SessionManager>)> {
        let g = self.inner.lock();
        g.ctx.as_ref().map(|c| (c.app.clone(), c.mgr.clone()))
    }

    /// Fan-out a session event to all mirror WS clients (payload as JSON).
    pub fn broadcast(&self, name: &str, payload: &Value) {
        self.hub.broadcast(name, payload);
    }

    pub fn env(&self) -> MirrorEnvConfig {
        self.inner.lock().env.clone()
    }

    pub fn active_token(&self) -> Option<String> {
        self.inner.lock().runtime.as_ref().map(|r| r.token.clone())
    }

    pub fn is_read_only(&self) -> bool {
        let g = self.inner.lock();
        g.runtime
            .as_ref()
            .map(|r| r.read_only)
            .unwrap_or(g.read_only)
    }

    pub fn max_clients(&self) -> u32 {
        self.inner.lock().max_clients
    }

    /// True when connected WS clients are already at the configured cap.
    pub fn is_at_client_limit(&self) -> bool {
        let max = self.max_clients();
        self.hub.client_count() as u32 >= max
    }

    pub fn set_max_clients(&self, max_clients: u32) -> u32 {
        let next = normalize_max_clients(max_clients);
        let mut g = self.inner.lock();
        let prev = g.max_clients;
        g.max_clients = next;
        g.env.max_clients = next;
        if prev != next {
            // No tokens / URLs — numeric policy only.
            tracing::info!(
                max_clients = next,
                prev,
                "mirror: max concurrent clients updated"
            );
        }
        next
    }

    pub fn set_read_only(&self, read_only: bool) {
        let mut g = self.inner.lock();
        let prev = g
            .runtime
            .as_ref()
            .map(|r| r.read_only)
            .unwrap_or(g.read_only);
        g.read_only = read_only;
        if let Some(r) = g.runtime.as_mut() {
            r.read_only = read_only;
        }
        // Audit line for support bundles / app.log — no tokens or URLs.
        if prev != read_only {
            tracing::info!(
                read_only,
                allow_write = !read_only,
                "mirror: phone write access toggled"
            );
        }
    }

    pub fn allow_lan(&self) -> bool {
        self.inner.lock().allow_lan
    }

    /// Opt-in LAN bind. Loopback is the default. Rebinds HTTP when already running.
    pub async fn set_allow_lan(self: &Arc<Self>, allow_lan: bool) -> Result<MirrorStatus, String> {
        let need_rebind = {
            let mut g = self.inner.lock();
            let prev = g.allow_lan;
            g.allow_lan = allow_lan;
            g.env.allow_lan = allow_lan;
            if let Some(r) = g.runtime.as_mut() {
                r.allow_lan = allow_lan;
            }
            if prev != allow_lan {
                tracing::info!(allow_lan, "mirror: LAN bind toggled");
            }
            g.runtime.is_some() && prev != allow_lan
        };
        if need_rebind {
            self.rebind_http().await?;
        } else {
            self.refresh_access_urls();
        }
        Ok(self.status())
    }

    fn refresh_access_urls(&self) {
        let mut g = self.inner.lock();
        let Some(r) = g.runtime.as_mut() else {
            return;
        };
        if r.allow_lan {
            if r.lan_ip.is_none() {
                r.lan_ip = lan::detect_lan_ipv4();
            }
        } else {
            r.lan_ip = None;
        }
        let local = lan::local_access_url(r.allow_lan, r.port, &r.token, r.lan_ip);
        if r.phase != MirrorPhase::Live {
            r.public_url = Some(local);
        }
    }

    async fn rebind_http(self: &Arc<Self>) -> Result<(), String> {
        let (shutdown_tx, port, dist_dir, allow_lan) = {
            let mut g = self.inner.lock();
            let Some(r) = g.runtime.as_mut() else {
                return Ok(());
            };
            (
                r.shutdown_tx.take(),
                r.port,
                r.dist_dir.clone(),
                g.allow_lan,
            )
        };
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }

        let (bound_port, new_shutdown) =
            bind_http_with_retry(self.clone(), port, dist_dir, allow_lan).await?;
        let lan_ip = if allow_lan {
            lan::detect_lan_ipv4()
        } else {
            None
        };

        {
            let mut g = self.inner.lock();
            if let Some(r) = g.runtime.as_mut() {
                r.port = bound_port;
                r.shutdown_tx = Some(new_shutdown);
                r.allow_lan = allow_lan;
                r.lan_ip = lan_ip;
                let local = lan::local_access_url(allow_lan, bound_port, &r.token, lan_ip);
                if r.phase != MirrorPhase::Live {
                    r.public_url = Some(local);
                }
            }
        }
        tracing::info!(port = bound_port, allow_lan, "mirror http rebound");
        Ok(())
    }

    /// Mint a new token, drop WS clients, keep the same port/tunnel when possible.
    pub fn rotate_token(&self) -> Result<MirrorStatus, String> {
        let clients_before = self.hub.client_count() as u32;
        let mut g = self.inner.lock();
        let Some(r) = g.runtime.as_mut() else {
            return Err("mirror is not running".into());
        };
        r.token = generate_token();
        let tail = auth::token_tail(&r.token, 6);
        if let Some(url) = r.public_url.clone() {
            if let Some(base) = url.split("/t/").next() {
                let base = base.trim_end_matches('/');
                if !base.is_empty() {
                    r.public_url = Some(format!("{base}/t/{}/", r.token));
                }
            }
        }
        drop(g);
        self.hub.disconnect_all();
        // Audit: token_tail only — never full token or public URL.
        tracing::info!(
            token_tail = %tail,
            clients_disconnected = clients_before,
            "mirror: token rotated (old QR/sessions invalidated)"
        );
        Ok(self.status())
    }

    pub fn status(&self) -> MirrorStatus {
        let mut g = self.inner.lock();
        // If cloudflared died while we still claim Live, report tunnel_dead (no auto-restart).
        if let Some(r) = g.runtime.as_mut() {
            if r.phase == MirrorPhase::Live {
                if let Some(tun) = r.tunnel.as_mut() {
                    if tun.poll_exited() {
                        r.phase = MirrorPhase::TunnelDead;
                        r.error = Some("cloudflared tunnel process exited".into());
                        tracing::warn!(
                            "mirror tunnel dead — host still up; panel should leave 已上線"
                        );
                    }
                }
            }
        }
        self.status_unlocked(&g)
    }

    /// Start loopback HTTP+WS server (idempotent if already running).
    pub async fn start(self: &Arc<Self>) -> Result<MirrorStatus, String> {
        {
            let g = self.inner.lock();
            if g.runtime.is_some() {
                // Drop lock then status() so dead cloudflared is still detected.
                drop(g);
                return Ok(self.status());
            }
        }

        let env = self.env();
        let token = env
            .token
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(generate_token);
        let prefer_port = env.port.unwrap_or(0);
        let dist_dir = resolve_dist_dir(env.dist.as_ref());

        if !dist_dir.join("index.html").is_file() {
            tracing::warn!(
                path = %dist_dir.display(),
                "mirror dist index.html missing — serving placeholder until built"
            );
        }

        // Mark starting so concurrent status is coherent.
        let allow_lan = {
            let mut g = self.inner.lock();
            let read_only = g.read_only;
            let allow_lan = g.allow_lan;
            g.runtime = Some(Runtime {
                token: token.clone(),
                port: prefer_port,
                phase: MirrorPhase::Starting,
                public_url: None,
                error: None,
                shutdown_tx: None,
                tunnel: None,
                dist_dir: dist_dir.clone(),
                read_only,
                allow_lan,
                lan_ip: None,
            });
            allow_lan
        };

        let (bound_port, shutdown_tx) = match http::start_server(
            self.clone(),
            prefer_port,
            dist_dir.clone(),
            allow_lan,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                let mut g = self.inner.lock();
                g.runtime = None;
                return Err(e);
            }
        };

        let lan_ip = if allow_lan {
            lan::detect_lan_ipv4()
        } else {
            None
        };
        let local_url = lan::local_access_url(allow_lan, bound_port, &token, lan_ip);

        {
            let mut g = self.inner.lock();
            if let Some(r) = g.runtime.as_mut() {
                r.port = bound_port;
                r.phase = if env.no_tunnel {
                    MirrorPhase::Local
                } else {
                    MirrorPhase::WaitingTunnel
                };
                r.public_url = Some(local_url.clone());
                r.shutdown_tx = Some(shutdown_tx);
                r.token = token.clone();
                r.allow_lan = allow_lan;
                r.lan_ip = lan_ip;
            }
        }

        let (phase, public_url, tunnel_handle, error) = if env.no_tunnel {
            tracing::info!(
                port = bound_port,
                "mirror host local-only (GROK_MIRROR_NO_TUNNEL)"
            );
            (MirrorPhase::Local, local_url.clone(), None, None)
        } else {
            match tunnel::start_quick_tunnel(bound_port).await {
                Ok(started) => {
                    let public =
                        format!("{}/t/{}/", started.public_url.trim_end_matches('/'), token);
                    (MirrorPhase::Live, public, Some(started.handle), None)
                }
                Err(e) => {
                    tracing::error!(error = %e, "mirror cloudflared tunnel failed");
                    // Keep local server up so panel can show error + still copy a debug URL.
                    (MirrorPhase::Error, local_url.clone(), None, Some(e))
                }
            }
        };

        {
            let mut g = self.inner.lock();
            if let Some(r) = g.runtime.as_mut() {
                r.phase = phase;
                r.public_url = Some(public_url.clone());
                r.tunnel = tunnel_handle;
                r.error = error;
            }
        }

        // Log phase/port/token_tail only — never the full public URL (embeds token).
        let tail = auth::token_tail(&token, 6);
        tracing::info!(
            port = bound_port,
            token_tail = %tail,
            phase = ?phase,
            no_tunnel = env.no_tunnel,
            allow_lan,
            max_clients = self.max_clients(),
            "mirror host started"
        );

        Ok(self.status())
    }

    /// Full teardown; invalidates token immediately; stops the active tunnel adapter.
    pub async fn stop(&self) -> Result<MirrorStatus, String> {
        self.stop_inner();
        // Brief yield so server task can observe shutdown.
        tokio::task::yield_now().await;
        Ok(self.status())
    }

    /// Sync teardown for process exit (no await). Safe from `RunEvent::Exit`.
    pub fn stop_sync(&self) {
        self.stop_inner();
    }

    fn stop_inner(&self) {
        let (shutdown, tunnel) = {
            let mut g = self.inner.lock();
            let (tx, tun) = match g.runtime.take() {
                Some(mut r) => (r.shutdown_tx.take(), r.tunnel.take()),
                None => (None, None),
            };
            (tx, tun)
        };
        if let Some(t) = tunnel {
            t.stop();
            tracing::info!("mirror tunnel adapter stopped");
        }
        if let Some(tx) = shutdown {
            let _ = tx.send(());
            tracing::info!("mirror host stop requested (token invalidated)");
        } else {
            tracing::info!("mirror host stop (was not running)");
        }
    }

    fn status_unlocked(&self, g: &Inner) -> MirrorStatus {
        let clients = self.hub.client_count() as u32;
        let max_clients = g.max_clients;
        match &g.runtime {
            None => MirrorStatus {
                running: false,
                public_url: None,
                local_port: None,
                token: None,
                token_tail: None,
                clients: 0,
                max_clients,
                phase: MirrorPhase::Stopped,
                error: None,
                read_only: g.read_only,
                allow_lan: g.allow_lan,
                lan_url: None,
            },
            Some(r) => {
                let tail = auth::token_tail(&r.token, 6);
                let fallback = lan::local_access_url(r.allow_lan, r.port, &r.token, r.lan_ip);
                let lan_url = r
                    .lan_ip
                    .filter(|_| r.allow_lan)
                    .map(|ip| lan::mirror_path_url(&ip.to_string(), r.port, &r.token));
                MirrorStatus {
                    running: true,
                    public_url: r.public_url.clone().or(Some(fallback)),
                    local_port: Some(r.port),
                    token: Some(r.token.clone()),
                    token_tail: Some(tail),
                    clients,
                    max_clients,
                    phase: r.phase,
                    error: r.error.clone(),
                    read_only: r.read_only,
                    allow_lan: r.allow_lan,
                    lan_url,
                }
            }
        }
    }
}

async fn bind_http_with_retry(
    host: Arc<MirrorHost>,
    port: u16,
    dist_dir: PathBuf,
    allow_lan: bool,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let mut last = "mirror rebind: no attempts".to_string();
    for i in 0..8u32 {
        match http::start_server(host.clone(), port, dist_dir.clone(), allow_lan).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                last = e;
                tokio::time::sleep(Duration::from_millis(40 * (i + 1) as u64)).await;
            }
        }
    }
    if port != 0 {
        match http::start_server(host, 0, dist_dir, allow_lan).await {
            Ok(v) => {
                tracing::warn!(
                    preferred = port,
                    bound = v.0,
                    "mirror rebind fell back to an ephemeral port"
                );
                return Ok(v);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Emit to desktop WebView **and** mirror WS clients (DESIGN §7.3).
/// Prefer this over bare `app.emit` for all `session://*` chat events.
pub fn fanout_event(app: &AppHandle, name: &str, payload: impl Serialize + Clone) {
    let _ = app.emit(name, payload.clone());
    if let Some(host) = app.try_state::<Arc<MirrorHost>>() {
        match serde_json::to_value(&payload) {
            Ok(v) => host.broadcast(name, &v),
            Err(e) => {
                tracing::warn!(error = %e, event = name, "mirror fanout: serialize failed");
            }
        }
    }
}

/// Resolve SPA root: env override → compile-time ../dist → cwd candidates.
pub fn resolve_dist_dir(override_dir: Option<&PathBuf>) -> PathBuf {
    if let Some(p) = override_dir {
        return p.clone();
    }
    // Packaged / dev: Tauri frontendDist is ../dist relative to src-tauri.
    let manifest_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if manifest_dist.join("index.html").is_file() {
        return manifest_dist.canonicalize().unwrap_or(manifest_dist);
    }
    for cand in [
        PathBuf::from("dist"),
        PathBuf::from("../dist"),
        PathBuf::from("./dist"),
    ] {
        if cand.join("index.html").is_file() {
            return cand.canonicalize().unwrap_or(cand);
        }
    }
    // Fall back to manifest-relative even if missing (placeholder HTML path).
    manifest_dist
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mirror_status(host: State<'_, Arc<MirrorHost>>) -> Result<MirrorStatus, String> {
    Ok(host.status())
}

#[tauri::command]
pub async fn mirror_start(
    app: AppHandle,
    host: State<'_, Arc<MirrorHost>>,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<MirrorStatus, String> {
    host.attach(app, mgr.inner().clone());
    host.start().await
}

#[tauri::command]
pub async fn mirror_stop(host: State<'_, Arc<MirrorHost>>) -> Result<MirrorStatus, String> {
    host.stop().await
}

/// Spawn headless auto-start when `GROK_MIRROR_HEADLESS=1`.
pub fn maybe_autostart(host: Arc<MirrorHost>, app: AppHandle, mgr: Arc<SessionManager>) {
    if !host.env().headless {
        return;
    }
    host.attach(app, mgr);
    tracing::info!("GROK_MIRROR_HEADLESS=1 — auto-starting mirror host");
    tauri::async_runtime::spawn(async move {
        match host.start().await {
            Ok(st) => {
                tracing::info!(
                    port = ?st.local_port,
                    phase = ?st.phase,
                    "headless mirror host ready"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "headless mirror start failed");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_config_defaults() {
        // Smoke: parsing does not panic; values depend on process env.
        let c = MirrorEnvConfig::from_env();
        let _ = c.headless;
        let _ = c.no_tunnel;
        assert!(c.max_clients >= MIN_CLIENTS && c.max_clients <= MAX_CLIENTS_CAP);
    }

    #[test]
    fn normalize_max_clients_clamps() {
        assert_eq!(normalize_max_clients(0), MIN_CLIENTS);
        assert_eq!(normalize_max_clients(4), 4);
        assert_eq!(normalize_max_clients(99), MAX_CLIENTS_CAP);
    }

    #[test]
    fn resolve_dist_prefers_existing() {
        let p = resolve_dist_dir(None);
        // Path is absolute-ish or relative; just ensure function returns something.
        assert!(!p.as_os_str().is_empty());
    }

    #[test]
    fn set_max_clients_clamps_and_status() {
        let host = MirrorHost::from_env();
        assert_eq!(host.set_max_clients(0), MIN_CLIENTS);
        assert_eq!(host.max_clients(), MIN_CLIENTS);
        assert_eq!(host.set_max_clients(100), MAX_CLIENTS_CAP);
        let st = host.status();
        assert_eq!(st.max_clients, MAX_CLIENTS_CAP);
        assert!(!st.running);
    }

    #[tokio::test]
    async fn token_gate_health_ac3() {
        let host = Arc::new(MirrorHost {
            inner: Mutex::new(Inner {
                env: MirrorEnvConfig {
                    headless: false,
                    token: Some("test-token-please-use-long-random-value-0123456789".into()),
                    port: Some(0), // ephemeral
                    no_tunnel: true,
                    allow_lan: false,
                    dist: Some(resolve_dist_dir(None)),
                    max_clients: DEFAULT_MAX_CLIENTS,
                },
                runtime: None,
                ctx: None,
                read_only: true,
                max_clients: DEFAULT_MAX_CLIENTS,
                allow_lan: false,
            }),
            hub: Arc::new(ws::WsHub::new()),
        });
        let st = host.start().await.expect("start");
        assert!(st.running);
        let port = st.local_port.expect("port");
        let token = st.token.expect("token");

        let client = reqwest::Client::new();
        let good = client
            .get(format!("http://127.0.0.1:{port}/t/{token}/api/health"))
            .send()
            .await
            .expect("good req");
        assert_eq!(good.status().as_u16(), 200);

        let bad = client
            .get(format!("http://127.0.0.1:{port}/t/wrong-token/api/health"))
            .send()
            .await
            .expect("bad req");
        assert_eq!(bad.status().as_u16(), 401);

        let index = client
            .get(format!("http://127.0.0.1:{port}/t/{token}/"))
            .header(
                "user-agent",
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            )
            .send()
            .await
            .expect("index");
        assert_eq!(index.status().as_u16(), 200);
        let body = index.text().await.unwrap_or_default();
        assert!(
            body.contains("__MIRROR__") || body.contains("root"),
            "expected SPA/placeholder body, got len {}",
            body.len()
        );

        host.stop().await.expect("stop");
        let after = client
            .get(format!("http://127.0.0.1:{port}/t/{token}/api/health"))
            .send()
            .await;
        // Server may be gone (connection error) or still draining with non-OK.
        if let Ok(r) = after {
            let code = r.status().as_u16();
            assert!(
                code == 401 || code == 404 || code == 502 || code >= 500,
                "unexpected status after stop: {code}"
            );
        }
        // connection refused after shutdown is fine
    }

    /// Placeholder HTML (missing dist/index.html) must carry no-store Cache-Control
    /// so phones never permanently cache "Mirror host online (dist not found)".
    #[tokio::test]
    async fn placeholder_index_has_no_store_cache_control() {
        let missing =
            std::env::temp_dir().join(format!("grok-mirror-missing-dist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        std::fs::create_dir_all(&missing).expect("temp dist dir");
        // intentionally no index.html

        let host = Arc::new(MirrorHost {
            inner: Mutex::new(Inner {
                env: MirrorEnvConfig {
                    headless: false,
                    token: Some("placeholder-cache-token-0123456789abcdef".into()),
                    port: Some(0),
                    no_tunnel: true,
                    allow_lan: false,
                    dist: Some(missing.clone()),
                    max_clients: DEFAULT_MAX_CLIENTS,
                },
                runtime: None,
                ctx: None,
                read_only: true,
                max_clients: DEFAULT_MAX_CLIENTS,
                allow_lan: false,
            }),
            hub: Arc::new(ws::WsHub::new()),
        });
        let st = host.start().await.expect("start");
        let port = st.local_port.expect("port");
        let token = st.token.expect("token");

        let client = reqwest::Client::new();
        let res = client
            .get(format!("http://127.0.0.1:{port}/t/{token}/"))
            .send()
            .await
            .expect("index");
        assert_eq!(res.status().as_u16(), 200);
        let cc = res
            .headers()
            .get(reqwest::header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(
            cc, "no-cache, no-store, must-revalidate",
            "placeholder must not be cacheable"
        );
        let body = res.text().await.unwrap_or_default();
        assert!(
            body.contains("dist not found") || body.contains("__MIRROR__"),
            "expected placeholder body, got len {}",
            body.len()
        );

        host.stop().await.expect("stop");
        let _ = std::fs::remove_dir_all(&missing);
    }

    fn test_host(token: &str, dist: PathBuf, allow_lan: bool) -> Arc<MirrorHost> {
        Arc::new(MirrorHost {
            inner: Mutex::new(Inner {
                env: MirrorEnvConfig {
                    headless: false,
                    token: Some(token.into()),
                    port: Some(0),
                    no_tunnel: true,
                    allow_lan,
                    dist: Some(dist),
                    max_clients: DEFAULT_MAX_CLIENTS,
                },
                runtime: None,
                ctx: None,
                read_only: true,
                max_clients: DEFAULT_MAX_CLIENTS,
                allow_lan,
            }),
            hub: Arc::new(ws::WsHub::new()),
        })
    }

    /// Loopback bind refuses LAN IP (the #875 repro). Opt-in LAN bind accepts it.
    #[tokio::test]
    async fn lan_bind_accepts_detected_ipv4() {
        let dist = resolve_dist_dir(None);
        let host = test_host("lan-bind-token-0123456789abcdef01234567", dist, false);
        let st = host.start().await.expect("start");
        let port = st.local_port.expect("port");
        let token = st.token.expect("token");
        assert!(!st.allow_lan);
        assert!(!host.allow_lan());
        assert!(st.public_url.as_deref().unwrap_or("").contains("127.0.0.1"));

        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .expect("client");
        let loopback = client
            .get(format!("http://127.0.0.1:{port}/t/{token}/api/health"))
            .send()
            .await
            .expect("loopback health");
        assert_eq!(loopback.status().as_u16(), 200);

        if let Some(ip) = lan::detect_lan_ipv4() {
            let lan_health = format!("http://{ip}:{port}/t/{token}/api/health");
            let refused = client.get(&lan_health).send().await;
            assert!(
                refused.is_err(),
                "loopback bind must refuse LAN IP (got {:?})",
                refused.map(|r| r.status())
            );

            let st2 = host.set_allow_lan(true).await.expect("enable lan");
            assert!(st2.allow_lan);
            let port2 = st2.local_port.expect("port after rebind");
            assert!(
                st2.lan_url
                    .as_deref()
                    .is_some_and(|u| u.contains(&ip.to_string())),
                "lan_url should use detected IPv4, got {:?}",
                st2.lan_url
            );
            assert!(
                st2.public_url
                    .as_deref()
                    .unwrap_or("")
                    .contains(&ip.to_string()),
                "local URL should advertise LAN IP, got {:?}",
                st2.public_url
            );
            let ok = client
                .get(format!("http://{ip}:{port2}/t/{token}/api/health"))
                .send()
                .await
                .expect("lan health after allow");
            assert_eq!(ok.status().as_u16(), 200);
        }

        host.stop().await.expect("stop");
    }
}

#[tauri::command]
pub async fn mirror_set_allow_lan(
    host: State<'_, Arc<MirrorHost>>,
    allow_lan: bool,
) -> Result<MirrorStatus, String> {
    host.set_allow_lan(allow_lan).await
}

#[tauri::command]
pub async fn mirror_rotate_token(host: State<'_, Arc<MirrorHost>>) -> Result<MirrorStatus, String> {
    host.rotate_token()
}

#[tauri::command]
pub async fn mirror_set_read_only(
    host: State<'_, Arc<MirrorHost>>,
    read_only: bool,
) -> Result<MirrorStatus, String> {
    host.set_read_only(read_only);
    Ok(host.status())
}

#[tauri::command]
pub async fn mirror_set_max_clients(
    host: State<'_, Arc<MirrorHost>>,
    max_clients: u32,
) -> Result<MirrorStatus, String> {
    host.set_max_clients(max_clients);
    Ok(host.status())
}
