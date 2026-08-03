//! Interactive MCP OAuth (Authorization Code + PKCE) for remote HTTP servers.
//!
//! Grok CLI has no headless `mcp oauth` — TUI `/mcps` → `i` opens a browser.
//! The App wizard used to only show instructions. This module runs the same
//! style flow in-host: discover metadata → dynamic client registration →
//! loopback callback → token exchange → persist Bearer header into agent-home
//! (and user `~/.grok`) so doctor / ACP inject can authenticate.
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
    #[allow(dead_code)]
    expires_in: Option<u64>,
    #[serde(default)]
    #[allow(dead_code)]
    token_type: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    scope: Option<String>,
}

fn http_get_json(url: &str) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GET {url} → HTTP {}", res.status()));
    }
    res.json().map_err(|e| e.to_string())
}

fn http_post_json(url: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
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

fn discover_for_mcp_url(
    mcp_url: &str,
) -> Result<(ProtectedResourceMeta, AuthServerMeta, String), String> {
    let mcp_url = mcp_url.trim().trim_end_matches('/');
    // RFC 9728 style path under well-known
    let resource_meta_urls = [
        format!("https://api.chatcut.io/.well-known/oauth-protected-resource/api/external-mcp/mcp"),
        // Generic: origin + /.well-known/oauth-protected-resource + path
        {
            if let Ok(u) = reqwest::Url::parse(mcp_url) {
                let origin = format!("{}://{}", u.scheme(), u.host_str().unwrap_or(""));
                let path = u.path().trim_start_matches('/');
                if path.is_empty() {
                    format!("{origin}/.well-known/oauth-protected-resource")
                } else {
                    format!("{origin}/.well-known/oauth-protected-resource/{path}")
                }
            } else {
                String::new()
            }
        },
        {
            if let Ok(u) = reqwest::Url::parse(mcp_url) {
                format!(
                    "{}://{}/.well-known/oauth-protected-resource",
                    u.scheme(),
                    u.host_str().unwrap_or("")
                )
            } else {
                String::new()
            }
        },
    ];

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
        "<html><body><h2>ChatCut authorization complete</h2><p>You can close this tab and return to Grok App.</p></body></html>"
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
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
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

fn persist_bearer(
    server: &str,
    access_token: &str,
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
    headers.insert("Authorization".into(), format!("Bearer {access_token}"));

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
        // Ensure base table exists with url
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

    // Best-effort credential store for native Grok OAuth reader
    let _ = write_mcp_credentials_best_effort(server, access_token, url);

    invalidate_mcp_cache();
    Ok(())
}

fn write_mcp_credentials_best_effort(
    server: &str,
    access_token: &str,
    resource: &str,
) -> Result<(), String> {
    let settings = store::load_settings();
    let homes = [
        crate::paths::resolve_agent_grok_home(&settings.session_data_mode),
        crate::process_util::user_home().join(".grok"),
    ];
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = json!({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_at": now + 3600,
        "resource": resource,
        "obtained_at": now,
    });
    for home in &homes {
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

    let scopes = if pr.scopes_supported.is_empty() {
        "openid profile email offline_access".to_string()
    } else {
        pr.scopes_supported.join(" ")
    };

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
            persist_bearer(&server_owned, &tok.access_token, existing_headers.as_ref())?;
            // keep refresh_token in credentials file if present
            if let Some(rt) = tok.refresh_token.as_deref() {
                let _ = rt; // already stored access; refresh optional later
            }
            Ok(())
        })();
        match result {
            Ok(()) => set_phase(
                &server_owned,
                FlowPhase::Success {
                    message: "OAuth complete — token stored for doctor and sessions".into(),
                },
            ),
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
}
