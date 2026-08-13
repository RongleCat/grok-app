//! Interactive MCP OAuth (Authorization Code + PKCE) for remote HTTP servers.
//!
//! Grok CLI has no headless `mcp oauth` — TUI `/mcps` → `i` opens a browser.
//! The App wizard used to only show instructions. This module runs the same
//! style flow in-host: discover metadata → dynamic client registration →
//! loopback callback → token exchange → persist Bearer header into agent-home
//! (and user `~/.grok`) so doctor / ACP inject can authenticate.
//!
//! **Long-lived access (Codex parity):** ChatCut (and similar) issue short-lived
//! access tokens (`expires_in` often 3600s) plus a `refresh_token` when
//! `offline_access` is granted. We persist `refresh_token` + `client_id` +
//! `token_endpoint` and silently refresh before session inject / when near
//! expiry — so one browser authorization stays usable until the refresh
//! grant is revoked.
//!
//! Tokens are never returned to the frontend (only status + auth URL).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::extensions::{
    invalidate_mcp_cache, list_mcp_server_defs, mcp_agent_config_path,
    mirror_user_http_mcp_into_agent_home, upsert_mcp_http_in_toml,
};
use crate::store;

const OAUTH_WAIT_SECS: u64 = 300;
/// Default access-token TTL when the token response omits `expires_in`.
const DEFAULT_ACCESS_TTL_SECS: u64 = 3600;
/// Refresh this many seconds before `expires_at` (Codex: “expired or nearly expired”).
const REFRESH_SKEW_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthStartResult {
    pub ok: bool,
    pub server: String,
    pub auth_url: String,
    pub redirect_uri: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthStatusResult {
    pub ok: bool,
    pub server: String,
    /// pending | success | error | idle
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
enum FlowPhase {
    Pending {
        #[allow(dead_code)]
        auth_url: String,
        started: Instant,
    },
    Success {
        message: String,
    },
    Error {
        message: String,
    },
}

struct FlowState {
    phase: FlowPhase,
}

fn flow_map() -> &'static Mutex<HashMap<String, FlowState>> {
    use std::sync::OnceLock;
    static MAP: OnceLock<Mutex<HashMap<String, FlowState>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn set_phase(server: &str, phase: FlowPhase) {
    if let Ok(mut g) = flow_map().lock() {
        g.insert(server.to_string(), FlowState { phase });
    }
}

fn get_status(server: &str) -> McpOauthStatusResult {
    let name = server.trim();
    let guard = flow_map().lock().ok();
    let Some(g) = guard else {
        return McpOauthStatusResult {
            ok: false,
            server: name.to_string(),
            phase: "error".into(),
            message: "oauth state lock poisoned".into(),
            error: Some("lock".into()),
        };
    };
    match g.get(name) {
        None => McpOauthStatusResult {
            ok: true,
            server: name.to_string(),
            phase: "idle".into(),
            message: "no in-flight OAuth".into(),
            error: None,
        },
        Some(st) => match &st.phase {
            FlowPhase::Pending { started, .. } => {
                let elapsed = started.elapsed().as_secs();
                McpOauthStatusResult {
                    ok: true,
                    server: name.to_string(),
                    phase: "pending".into(),
                    message: format!("waiting for browser consent… ({elapsed}s)"),
                    error: None,
                }
            }
            FlowPhase::Success { message } => McpOauthStatusResult {
                ok: true,
                server: name.to_string(),
                phase: "success".into(),
                message: message.clone(),
                error: None,
            },
            FlowPhase::Error { message } => McpOauthStatusResult {
                ok: false,
                server: name.to_string(),
                phase: "error".into(),
                message: message.clone(),
                error: Some(message.clone()),
            },
        },
    }
}

fn pkce_pair() -> (String, String) {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let verifier = URL_SAFE_NO_PAD.encode(raw);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    (verifier, challenge)
}

fn random_state() -> String {
    let mut raw = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}

#[derive(Debug, Deserialize)]
struct ProtectedResourceMeta {
    #[serde(default)]
    authorization_servers: Vec<String>,
    #[serde(default)]
    authorization_server: Option<String>,
    #[serde(default)]
    resource: Option<String>,
    #[serde(default)]
    scopes_supported: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AuthServerMeta {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    registration_endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClientReg {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    scope: Option<String>,
}

/// Result of ensuring a usable access token for an MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnsureMcpTokenResult {
    /// Access token still valid (or no expiry known).
    StillValid,
    /// Obtained a new access token via refresh_token grant.
    Refreshed,
    /// No credentials on disk.
    NoCredentials,
    /// Credentials exist but cannot be refreshed (missing RT / client / permanent fail).
    NeedsReauth,
}

/// Fields we persist under `mcp_credentials.json` for silent refresh.
#[derive(Debug, Clone)]
pub struct StoredMcpOAuth {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub token_endpoint: Option<String>,
    pub resource: Option<String>,
    pub expires_at: Option<u64>,
    #[allow(dead_code)]
    pub token_type: Option<String>,
    pub scope: Option<String>,
}

/// Pure: whether access should be refreshed now (near or past expiry).
pub fn mcp_access_needs_refresh(expires_at: Option<u64>, now_secs: u64, skew_secs: u64) -> bool {
    match expires_at {
        Some(exp) => exp <= now_secs.saturating_add(skew_secs),
        // Legacy entries without expires_at: do not force refresh (may still work).
        None => false,
    }
}

/// Pure: compute `expires_at` unix seconds from token `expires_in`.
pub fn expires_at_from_expires_in(now_secs: u64, expires_in: Option<u64>) -> u64 {
    now_secs.saturating_add(expires_in.unwrap_or(DEFAULT_ACCESS_TTL_SECS))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn refresh_global_lock() -> &'static Mutex<()> {
    use std::sync::OnceLock;
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn credential_homes() -> [PathBuf; 2] {
    let settings = store::load_settings();
    [
        crate::paths::resolve_agent_grok_home(&settings.session_data_mode),
        crate::process_util::user_home().join(".grok"),
    ]
}

/// Load the richest credential entry for `server` from agent-home then `~/.grok`.
pub fn load_stored_mcp_oauth(server: &str) -> Option<StoredMcpOAuth> {
    let key = server.trim();
    if key.is_empty() {
        return None;
    }
    for home in &credential_homes() {
        let path = home.join("mcp_credentials.json");
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(root) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if let Some(stored) = parse_stored_mcp_oauth(&root, key) {
            return Some(stored);
        }
    }
    None
}

/// Pure parse for unit tests + loaders.
pub fn parse_stored_mcp_oauth(root: &Value, server: &str) -> Option<StoredMcpOAuth> {
    let key = server.trim();
    if key.is_empty() {
        return None;
    }
    let entry = root
        .get("servers")
        .and_then(|s| s.get(key))
        .or_else(|| root.get(key))?;
    // Codex-shaped nested token_response is accepted too.
    let tr = entry.get("token_response").unwrap_or(entry);
    let access = tr
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let expires_at = entry
        .get("expires_at")
        .and_then(json_u64)
        // Codex stores ms timestamps — normalize to seconds.
        .map(|n| if n > 1_000_000_000_000 { n / 1000 } else { n })
        // `expires_in` alone is not an absolute clock — never treat it as
        // "fresh for TTL from now" on every load (that would never refresh).
        // Prefer obtained_at + expires_in when available; else force refresh.
        .or_else(|| {
            let ttl = tr.get("expires_in").and_then(json_u64)?;
            if let Some(obtained) = entry.get("obtained_at").and_then(json_u64) {
                Some(obtained.saturating_add(ttl))
            } else {
                // Unknown mint time: treat as already expired so refresh runs.
                Some(0)
            }
        });
    Some(StoredMcpOAuth {
        access_token: access,
        refresh_token: tr
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                entry
                    .get("refresh_token")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            }),
        client_id: entry
            .get("client_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        client_secret: entry
            .get("client_secret")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        token_endpoint: entry
            .get("token_endpoint")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        resource: entry
            .get("resource")
            .or_else(|| entry.get("url"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        expires_at,
        token_type: tr
            .get("token_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        scope: tr.get("scope").and_then(|v| v.as_str()).map(str::to_string),
    })
}

fn json_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_i64().map(|n| n as u64))
        .or_else(|| {
            v.as_f64()
                .filter(|f| f.is_finite() && *f >= 0.0)
                .map(|f| f as u64)
        })
}

fn http_get_json(url: &str) -> Result<Value, String> {
    let client = crate::proxy::apply_to_reqwest_blocking(
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())?;
    let res = client.get(url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GET {url} → HTTP {}", res.status()));
    }
    res.json().map_err(|e| e.to_string())
}

fn http_post_json(url: &str, body: &Value) -> Result<Value, String> {
    let client = crate::proxy::apply_to_reqwest_blocking(
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())?;
    let res = client
        .post(url)
        .json(body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "POST {url} → HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| {
        format!(
            "JSON parse: {e}; body={}",
            text.chars().take(120).collect::<String>()
        )
    })
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding_encode(k), urlencoding_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// RFC 9728 well-known metadata URLs derived **only** from this MCP endpoint.
/// Never prepend a third-party (ChatCut) URL — that would authorize the wrong
/// provider for every other remote MCP (#605).
fn protected_resource_meta_urls(mcp_url: &str) -> Vec<String> {
    let mcp_url = mcp_url.trim().trim_end_matches('/');
    let Ok(u) = reqwest::Url::parse(mcp_url) else {
        return Vec::new();
    };
    let Some(host) = u.host_str().filter(|h| !h.is_empty()) else {
        return Vec::new();
    };
    let origin = format!("{}://{}", u.scheme(), host);
    let path = u.path().trim_start_matches('/');
    let mut urls = Vec::new();
    if !path.is_empty() {
        urls.push(format!(
            "{origin}/.well-known/oauth-protected-resource/{path}"
        ));
    }
    urls.push(format!("{origin}/.well-known/oauth-protected-resource"));
    urls
}

fn discover_for_mcp_url(
    mcp_url: &str,
) -> Result<(ProtectedResourceMeta, AuthServerMeta, String), String> {
    let mcp_url = mcp_url.trim().trim_end_matches('/');
    let resource_meta_urls = protected_resource_meta_urls(mcp_url);

    let mut pr: Option<ProtectedResourceMeta> = None;
    for u in &resource_meta_urls {
        if u.is_empty() {
            continue;
        }
        if let Ok(v) = http_get_json(u) {
            if let Ok(m) = serde_json::from_value::<ProtectedResourceMeta>(v) {
                pr = Some(m);
                break;
            }
        }
    }
    let pr = pr.ok_or_else(|| {
        "could not load OAuth protected-resource metadata for this MCP URL".to_string()
    })?;

    let as_base = pr
        .authorization_servers
        .first()
        .cloned()
        .or_else(|| pr.authorization_server.clone())
        .ok_or_else(|| "no authorization_servers in resource metadata".to_string())?;
    let as_base = as_base.trim_end_matches('/');
    let as_meta_url = format!("{as_base}/.well-known/oauth-authorization-server");
    let as_val = http_get_json(&as_meta_url)?;
    let as_meta: AuthServerMeta =
        serde_json::from_value(as_val).map_err(|e| format!("auth server meta: {e}"))?;
    let resource = pr.resource.clone().unwrap_or_else(|| mcp_url.to_string());
    Ok((pr, as_meta, resource))
}

fn bind_loopback() -> Result<(TcpListener, String, u16), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(false).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    Ok((listener, redirect, port))
}

fn wait_for_code(listener: TcpListener, expect_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(OAUTH_WAIT_SECS);
    let (mut stream, _) = loop {
        match listener.accept() {
            Ok(pair) => break pair,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(format!(
                        "OAuth consent timed out after {OAUTH_WAIT_SECS}s — reopen 授权 and try again"
                    ));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("waiting for OAuth callback: {e}")),
        }
    };
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first = req.lines().next().unwrap_or("");
    // GET /callback?code=...&state=... HTTP/1.1
    let path = first.split_whitespace().nth(1).unwrap_or("");
    let q = path.split('?').nth(1).unwrap_or("");
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut err: Option<String> = None;
    for part in q.split('&') {
        let mut kv = part.splitn(2, '=');
        let k = kv.next().unwrap_or("");
        let v = kv.next().unwrap_or("");
        let v = urlencoding_decode(v);
        match k {
            "code" => code = Some(v),
            "state" => state = Some(v),
            "error" => err = Some(v),
            "error_description" => {
                if err.is_none() {
                    err = Some(v);
                } else {
                    err = Some(format!("{}: {v}", err.as_deref().unwrap_or("error")));
                }
            }
            _ => {}
        }
    }
    let body = if code.is_some() {
        "<html><body><h2>Authorization complete</h2><p>You can close this tab and return to Grok App.</p></body></html>"
    } else {
        "<html><body><h2>Authorization failed</h2><p>Return to Grok App and retry.</p></body></html>"
    };
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();

    if let Some(e) = err {
        return Err(format!("provider error: {e}"));
    }
    let code = code.ok_or_else(|| "callback missing code".to_string())?;
    let state = state.unwrap_or_default();
    if state != expect_state {
        return Err("OAuth state mismatch (possible CSRF)".into());
    }
    Ok(code)
}

fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let h = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00");
                if let Ok(v) = u8::from_str_radix(h, 16) {
                    out.push(v);
                }
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn exchange_token(
    token_url: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
    resource: &str,
) -> Result<TokenResponse, String> {
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
        ("resource", resource),
    ];
    let secret;
    if let Some(s) = client_secret {
        secret = s.to_string();
        form.push(("client_secret", secret.as_str()));
    }
    let body = form_encode(&form);
    let client = crate::proxy::apply_to_reqwest_blocking(
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())?;
    let mut req = client
        .post(token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body);
    if let Some(s) = client_secret {
        // Also try basic auth
        let basic = STANDARD.encode(format!("{client_id}:{s}"));
        req = req.header("Authorization", format!("Basic {basic}"));
    }
    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "token exchange HTTP {status}: {}",
            text.chars().take(240).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("token JSON: {e}"))
}

fn refresh_token_grant(
    token_url: &str,
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
    resource: Option<&str>,
) -> Result<TokenResponse, String> {
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];
    let resource_owned;
    if let Some(r) = resource.filter(|s| !s.is_empty()) {
        resource_owned = r.to_string();
        form.push(("resource", resource_owned.as_str()));
    }
    let secret_owned;
    if let Some(s) = client_secret {
        secret_owned = s.to_string();
        form.push(("client_secret", secret_owned.as_str()));
    }
    let body = form_encode(&form);
    let client = crate::proxy::apply_to_reqwest_blocking(
        reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())?;
    let mut req = client
        .post(token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body);
    if let Some(s) = client_secret {
        let basic = STANDARD.encode(format!("{client_id}:{s}"));
        req = req.header("Authorization", format!("Basic {basic}"));
    }
    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "token refresh HTTP {status}: {}",
            text.chars().take(240).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("refresh token JSON: {e}"))
}

/// Persist access token into MCP config headers + credential store (full OAuth fields).
fn persist_oauth_tokens(
    server: &str,
    tok: &TokenResponse,
    client_id: &str,
    client_secret: Option<&str>,
    token_endpoint: &str,
    resource: &str,
    extra_headers: Option<&HashMap<String, String>>,
) -> Result<(), String> {
    let settings = store::load_settings();
    let _ = mirror_user_http_mcp_into_agent_home(&settings.session_data_mode);

    let defs = list_mcp_server_defs(None);
    let def = defs
        .iter()
        .find(|d| d.name == server)
        .ok_or_else(|| format!("MCP server '{server}' not found in config"))?;
    let url = def
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("MCP server '{server}' has no URL"))?;

    let mut headers = def.headers.clone().unwrap_or_default();
    if let Some(extra) = extra_headers {
        for (k, v) in extra {
            headers.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }
    // Preserve ChatCut surface if missing
    if url.contains("chatcut") {
        headers
            .entry("x-chatcut-mcp-surface".into())
            .or_insert_with(|| "codex".into());
    }
    headers.insert(
        "Authorization".into(),
        format!("Bearer {}", tok.access_token.trim()),
    );

    // Write agent-home (independent) + user ~/.grok so doctor/CLI both see it.
    let paths: Vec<PathBuf> = {
        let agent = mcp_agent_config_path(&settings.session_data_mode);
        let user = crate::process_util::user_home()
            .join(".grok")
            .join("config.toml");
        if agent == user {
            vec![agent]
        } else {
            vec![agent, user]
        }
    };

    for path in paths {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let next = upsert_mcp_http_in_toml(
            &existing,
            server,
            url,
            Some(&headers),
            def.transport.as_deref().or(Some("http")),
        );
        std::fs::write(&path, next).map_err(|e| e.to_string())?;
        tracing::info!("mcp oauth: wrote Bearer for {server} → {}", path.display());
    }

    write_mcp_credentials_full(
        server,
        tok,
        client_id,
        client_secret,
        token_endpoint,
        resource,
    )?;

    invalidate_mcp_cache();
    Ok(())
}

fn write_mcp_credentials_full(
    server: &str,
    tok: &TokenResponse,
    client_id: &str,
    client_secret: Option<&str>,
    token_endpoint: &str,
    resource: &str,
) -> Result<(), String> {
    let now = now_unix_secs();
    let expires_at = expires_at_from_expires_in(now, tok.expires_in);
    let prior = load_stored_mcp_oauth(server);

    // Keep previous refresh_token / client_secret when the AS omits them on refresh.
    let refresh_token = tok
        .refresh_token
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| prior.as_ref().and_then(|p| p.refresh_token.clone()));
    let client_secret = client_secret
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .or_else(|| prior.as_ref().and_then(|p| p.client_secret.clone()));

    let mut entry = json!({
        "access_token": tok.access_token.trim(),
        "token_type": tok.token_type.as_deref().unwrap_or("Bearer"),
        "expires_at": expires_at,
        "expires_in": tok.expires_in.unwrap_or(DEFAULT_ACCESS_TTL_SECS),
        "resource": resource,
        "url": resource,
        "token_endpoint": token_endpoint,
        "client_id": client_id,
        "obtained_at": now,
        "server_name": server,
    });
    if let Some(rt) = refresh_token {
        entry["refresh_token"] = json!(rt);
    }
    if let Some(sec) = client_secret {
        entry["client_secret"] = json!(sec);
    }
    if let Some(scope) = tok.scope.as_ref().filter(|s| !s.is_empty()) {
        entry["scope"] = json!(scope);
    } else if let Some(scope) = prior.as_ref().and_then(|p| p.scope.clone()) {
        entry["scope"] = json!(scope);
    }

    for home in &credential_homes() {
        let path = home.join("mcp_credentials.json");
        let mut root: Value = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| json!({}))
        } else {
            json!({})
        };
        // Support both map-of-servers and { "servers": { ... } }
        if root.get("servers").is_some() {
            root["servers"][server] = entry.clone();
        } else if root.is_object() {
            root[server] = entry.clone();
        } else {
            root = json!({ server: entry.clone() });
        }
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let raw = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
        std::fs::write(&path, raw).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    Ok(())
}

/// Ensure `server` has a usable access token, refreshing with `refresh_token` when needed.
///
/// Called from ACP `mcpServers` inject so ChatCut (and other remote OAuth MCPs)
/// stay connected after the short-lived access token expires.
///
/// When `force` is true (e.g. after CLI `AuthRequired`), always attempt a
/// refresh-token grant even if local `expires_at` still looks valid — the AS
/// may have revoked or rejected the access token early.
pub fn ensure_mcp_access_token(server: &str) -> EnsureMcpTokenResult {
    ensure_mcp_access_token_inner(server, false)
}

/// Force a refresh attempt when credentials include a refresh_token (AuthRequired path).
pub fn ensure_mcp_access_token_forced(server: &str) -> EnsureMcpTokenResult {
    ensure_mcp_access_token_inner(server, true)
}

fn ensure_mcp_access_token_inner(server: &str, force: bool) -> EnsureMcpTokenResult {
    let server = server.trim();
    if server.is_empty() {
        return EnsureMcpTokenResult::NoCredentials;
    }

    // Serialize refresh across concurrent session opens (avoid RT double-spend).
    let _guard = refresh_global_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    let Some(stored) = load_stored_mcp_oauth(server) else {
        return EnsureMcpTokenResult::NoCredentials;
    };

    let now = now_unix_secs();
    if !force && !mcp_access_needs_refresh(stored.expires_at, now, REFRESH_SKEW_SECS) {
        return EnsureMcpTokenResult::StillValid;
    }
    // Forced path with no refresh_token cannot improve the situation.
    if force
        && stored
            .refresh_token
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    {
        return EnsureMcpTokenResult::NeedsReauth;
    }

    let Some(refresh_token) = stored.refresh_token.as_deref().filter(|s| !s.is_empty()) else {
        tracing::info!(
            target: "mcp_oauth",
            server,
            "access near/expired but no refresh_token — re-auth required"
        );
        return EnsureMcpTokenResult::NeedsReauth;
    };
    let Some(client_id) = stored.client_id.as_deref().filter(|s| !s.is_empty()) else {
        tracing::info!(
            target: "mcp_oauth",
            server,
            "access near/expired but no client_id — re-auth required"
        );
        return EnsureMcpTokenResult::NeedsReauth;
    };

    let resource = stored
        .resource
        .clone()
        .or_else(|| {
            list_mcp_server_defs(None)
                .into_iter()
                .find(|d| d.name == server)
                .and_then(|d| d.url)
        })
        .unwrap_or_default();

    let token_endpoint = match stored
        .token_endpoint
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
    {
        Some(u) => u,
        None => {
            // Fallback: rediscover AS token endpoint from resource URL.
            match discover_for_mcp_url(&resource) {
                Ok((_, as_meta, _)) => as_meta.token_endpoint,
                Err(e) => {
                    tracing::warn!(
                        target: "mcp_oauth",
                        server,
                        error = %e,
                        "token_endpoint missing and discovery failed"
                    );
                    return EnsureMcpTokenResult::NeedsReauth;
                }
            }
        }
    };

    tracing::info!(
        target: "mcp_oauth",
        server,
        "access token expired or nearly expired, refreshing"
    );

    match refresh_token_grant(
        &token_endpoint,
        client_id,
        stored.client_secret.as_deref(),
        refresh_token,
        if resource.is_empty() {
            None
        } else {
            Some(resource.as_str())
        },
    ) {
        Ok(tok) => {
            if let Err(e) = persist_oauth_tokens(
                server,
                &tok,
                client_id,
                stored.client_secret.as_deref(),
                &token_endpoint,
                if resource.is_empty() {
                    stored.resource.as_deref().unwrap_or("")
                } else {
                    resource.as_str()
                },
                None,
            ) {
                tracing::warn!(
                    target: "mcp_oauth",
                    server,
                    error = %e,
                    "refreshed token but failed to persist"
                );
                return EnsureMcpTokenResult::NeedsReauth;
            }
            tracing::info!(target: "mcp_oauth", server, "refreshed access token");
            EnsureMcpTokenResult::Refreshed
        }
        Err(e) => {
            tracing::warn!(
                target: "mcp_oauth",
                server,
                error = %e,
                "token refresh failed — re-authorization required"
            );
            EnsureMcpTokenResult::NeedsReauth
        }
    }
}

/// Best-effort: refresh every remote OAuth MCP that looks like it needs it.
/// Used before building ACP `mcpServers` so inject sees fresh bearers.
pub fn ensure_all_remote_mcp_tokens(server_names: &[String]) {
    for name in server_names {
        let _ = ensure_mcp_access_token(name);
    }
}

/// Start OAuth for a configured MCP server: returns authorize URL immediately and
/// continues waiting for the browser callback on a background thread.
pub fn mcp_oauth_start(server_name: &str) -> Result<McpOauthStartResult, String> {
    let server = server_name.trim();
    if server.is_empty() {
        return Err("server name required".into());
    }
    if server.starts_with('-') || server.contains('/') || server.contains('\\') {
        return Err("invalid server name".into());
    }

    let settings = store::load_settings();
    let _ = mirror_user_http_mcp_into_agent_home(&settings.session_data_mode);
    let defs = list_mcp_server_defs(None);
    let def = defs.iter().find(|d| d.name == server).ok_or_else(|| {
        format!(
            "MCP server '{server}' not found under App agent-home / ~/.grok. \
                 Add it first (Settings → MCP or grok mcp add)."
        )
    })?;
    let mcp_url = def
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("'{server}' is not an HTTP MCP server (no url)"))?
        .to_string();

    // If already has Authorization, still allow re-auth.
    let (pr, as_meta, resource) = discover_for_mcp_url(&mcp_url)?;
    let (listener, redirect_uri, _port) = bind_loopback()?;
    let (verifier, challenge) = pkce_pair();
    let state = random_state();

    // Dynamic client registration when available
    let client = if let Some(reg_url) = as_meta.registration_endpoint.as_deref() {
        let body = json!({
            "client_name": "Grok App",
            "redirect_uris": [&redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        });
        let v = http_post_json(reg_url, &body)?;
        serde_json::from_value::<ClientReg>(v).map_err(|e| format!("client reg parse: {e}"))?
    } else {
        return Err("authorization server has no registration_endpoint; use TUI /mcps → i".into());
    };

    // Always request offline_access so the AS can issue a refresh_token (Codex parity).
    let mut scopes = if pr.scopes_supported.is_empty() {
        "openid profile email offline_access".to_string()
    } else {
        pr.scopes_supported.join(" ")
    };
    if !scopes
        .split_whitespace()
        .any(|s| s.eq_ignore_ascii_case("offline_access"))
    {
        scopes.push_str(" offline_access");
    }

    let auth_url = format!(
        "{}?{}",
        as_meta.authorization_endpoint,
        form_encode(&[
            ("response_type", "code"),
            ("client_id", &client.client_id),
            ("redirect_uri", &redirect_uri),
            ("scope", &scopes),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("resource", &resource),
            ("state", &state),
        ])
    );

    set_phase(
        server,
        FlowPhase::Pending {
            auth_url: auth_url.clone(),
            started: Instant::now(),
        },
    );

    let server_owned = server.to_string();
    let token_url = as_meta.token_endpoint.clone();
    let client_id = client.client_id.clone();
    let client_secret = client.client_secret.clone();
    let redirect = redirect_uri.clone();
    let resource_owned = resource.clone();
    let existing_headers = def.headers.clone();

    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let code = wait_for_code(listener, &state)?;
            let tok = exchange_token(
                &token_url,
                &client_id,
                client_secret.as_deref(),
                &code,
                &redirect,
                &verifier,
                &resource_owned,
            )?;
            let missing_rt = tok
                .refresh_token
                .as_ref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true);
            if missing_rt {
                tracing::warn!(
                    target: "mcp_oauth",
                    server = %server_owned,
                    "token response has no refresh_token — access will expire without re-auth"
                );
            }
            persist_oauth_tokens(
                &server_owned,
                &tok,
                &client_id,
                client_secret.as_deref(),
                &token_url,
                &resource_owned,
                existing_headers.as_ref(),
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                let msg = if load_stored_mcp_oauth(&server_owned)
                    .and_then(|s| s.refresh_token)
                    .filter(|s| !s.trim().is_empty())
                    .is_some()
                {
                    "OAuth complete — access + refresh token stored for long-lived sessions"
                } else {
                    "OAuth complete — access token stored (no refresh_token; re-auth when it expires)"
                };
                set_phase(
                    &server_owned,
                    FlowPhase::Success {
                        message: msg.into(),
                    },
                );
            }
            Err(e) => set_phase(
                &server_owned,
                FlowPhase::Error {
                    message: e.chars().take(400).collect(),
                },
            ),
        }
    });

    Ok(McpOauthStartResult {
        ok: true,
        server: server.to_string(),
        auth_url,
        redirect_uri,
        message:
            "Open the URL, sign in to the provider, then wait for App to capture the callback."
                .into(),
    })
}

pub fn mcp_oauth_status(server_name: &str) -> McpOauthStatusResult {
    get_status(server_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_pair_shapes() {
        let (v, c) = pkce_pair();
        assert!(v.len() >= 32);
        assert!(c.len() >= 32);
        assert!(!v.contains('+') && !v.contains('/'));
    }

    #[test]
    fn form_encode_basic() {
        let s = form_encode(&[("a", "b c"), ("x", "1")]);
        assert!(s.contains("a=b%20c") || s.contains("a=b+c") || s.contains("a=b%20c"));
        assert!(s.contains("x=1"));
    }

    #[test]
    fn expires_at_and_refresh_skew_pure() {
        assert_eq!(expires_at_from_expires_in(1_000, Some(3600)), 4_600);
        assert_eq!(
            expires_at_from_expires_in(1_000, None),
            1_000 + DEFAULT_ACCESS_TTL_SECS
        );
        // Within skew of expiry → needs refresh.
        assert!(mcp_access_needs_refresh(Some(1_200), 1_000, 300));
        // Well before expiry → still valid.
        assert!(!mcp_access_needs_refresh(Some(10_000), 1_000, 300));
        // No expires_at → do not force refresh.
        assert!(!mcp_access_needs_refresh(None, 1_000, 300));
    }

    #[test]
    fn parse_stored_mcp_oauth_flat_and_codex_shape() {
        let flat = json!({
            "chatcut": {
                "access_token": "at1",
                "refresh_token": "rt1",
                "client_id": "cid",
                "token_endpoint": "https://api.chatcut.io/auth/mcp/token",
                "resource": "https://api.chatcut.io/api/external-mcp/mcp",
                "expires_at": 1_700_000_000_u64,
                "scope": "openid profile email offline_access"
            }
        });
        let s = parse_stored_mcp_oauth(&flat, "chatcut").unwrap();
        assert_eq!(s.access_token, "at1");
        assert_eq!(s.refresh_token.as_deref(), Some("rt1"));
        assert_eq!(s.client_id.as_deref(), Some("cid"));
        assert_eq!(
            s.token_endpoint.as_deref(),
            Some("https://api.chatcut.io/auth/mcp/token")
        );
        assert_eq!(s.expires_at, Some(1_700_000_000));

        // Codex keychain-shaped payload (expires_at in ms, nested token_response).
        let codex = json!({
            "chatcut": {
                "client_id": "cid2",
                "expires_at": 1_700_000_000_000_u64,
                "url": "https://api.chatcut.io/api/external-mcp/mcp",
                "token_response": {
                    "access_token": "at2",
                    "refresh_token": "rt2",
                    "expires_in": 3600,
                    "token_type": "bearer",
                    "scope": "openid profile email offline_access"
                }
            }
        });
        let s2 = parse_stored_mcp_oauth(&codex, "chatcut").unwrap();
        assert_eq!(s2.access_token, "at2");
        assert_eq!(s2.refresh_token.as_deref(), Some("rt2"));
        assert_eq!(s2.client_id.as_deref(), Some("cid2"));
        // ms → seconds
        assert_eq!(s2.expires_at, Some(1_700_000_000));
        assert_eq!(
            s2.resource.as_deref(),
            Some("https://api.chatcut.io/api/external-mcp/mcp")
        );
    }

    #[test]
    fn protected_resource_meta_urls_follow_mcp_origin_not_chatcut() {
        let urls = protected_resource_meta_urls("https://mcp.appwrite.io/mcp");
        assert!(!urls.is_empty());
        assert!(
            urls.iter()
                .all(|u| !u.to_ascii_lowercase().contains("chatcut")),
            "non-ChatCut MCP must not probe ChatCut metadata: {urls:?}"
        );
        assert_eq!(
            urls[0],
            "https://mcp.appwrite.io/.well-known/oauth-protected-resource/mcp"
        );
        assert_eq!(
            urls[1],
            "https://mcp.appwrite.io/.well-known/oauth-protected-resource"
        );
    }

    #[test]
    fn protected_resource_meta_urls_chatcut_still_derives_from_own_url() {
        let urls = protected_resource_meta_urls("https://api.chatcut.io/api/external-mcp/mcp/");
        assert_eq!(
            urls[0],
            "https://api.chatcut.io/.well-known/oauth-protected-resource/api/external-mcp/mcp"
        );
        assert!(urls.iter().all(|u| u.contains("api.chatcut.io")));
    }

    #[test]
    fn protected_resource_meta_urls_rejects_garbage() {
        assert!(protected_resource_meta_urls("not a url").is_empty());
        assert!(protected_resource_meta_urls("").is_empty());
    }
}
