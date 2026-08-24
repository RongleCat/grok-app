//! Token-gated HTTP server: health, SPA static, WebSocket, auth middleware.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use tauri::AppHandle;

use super::auth::{extract_token_from_path, path_after_token, path_for_log, tokens_equal};
use super::lan::listen_ip;
use super::ws;
use super::MirrorHost;

/// Shared state for axum handlers.
#[derive(Clone)]
pub struct HttpState {
    pub host: Arc<MirrorHost>,
    pub dist_dir: PathBuf,
    /// Packaged fallback: `frontendDist` via Tauri asset resolver.
    pub app: Option<AppHandle>,
}

/// Filesystem dist wins; packaged apps fall back to embedded frontendDist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MirrorStaticSource {
    Filesystem,
    Embedded,
    Missing,
}

/// Decide which body to serve. Pure: callers supply the two hit flags.
pub fn resolve_mirror_static_source(fs_hit: bool, embedded_hit: bool) -> MirrorStaticSource {
    if fs_hit {
        MirrorStaticSource::Filesystem
    } else if embedded_hit {
        MirrorStaticSource::Embedded
    } else {
        MirrorStaticSource::Missing
    }
}

/// Bind loopback (`127.0.0.1`) or all interfaces (`0.0.0.0`) when `allow_lan`.
/// `port` 0 = OS-assigned free port. Returns bound port + shutdown sender.
pub async fn start_server(
    host: Arc<MirrorHost>,
    port: u16,
    dist_dir: PathBuf,
    allow_lan: bool,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let app = host.rpc_ctx().map(|(a, _)| a);
    let state = HttpState {
        host: host.clone(),
        dist_dir,
        app,
    };

    // Token-gated routes (HTML shell, API, WS, static under /t/{token}/…).
    let gated = Router::new()
        .route("/t/{token}/api/health", get(health_handler))
        // WS must be registered before the static catch-all.
        .route("/t/{token}/ws", get(ws_handler))
        .route("/t/{token}/", get(index_handler))
        .route("/t/{token}", get(index_handler))
        .route("/t/{token}/{*path}", get(static_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            token_gate_middleware,
        ))
        .with_state(state.clone());

    // Public hashed SPA chunks at host root. Dynamic imports (e.g. @tauri-apps/api
    // code-split files) resolve absolute `/assets/*` and ignore <base href>, so
    // they cannot use the token prefix. Shell is not secret; live state still
    // requires token on /ws and /api (DESIGN §5).
    let public_assets = Router::new()
        .route("/assets/{*path}", get(public_assets_handler))
        .with_state(state);

    let app = gated.merge(public_assets).fallback(unauth_fallback);

    let addr = SocketAddr::from((listen_ip(allow_lan), port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("mirror bind {addr}: {e}"))?;
    let bound = listener
        .local_addr()
        .map_err(|e| format!("mirror local_addr: {e}"))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = serve.await {
            tracing::error!(error = %e, "mirror http server exited with error");
        } else {
            tracing::info!("mirror http server stopped");
        }
    });

    tracing::info!(port = bound, allow_lan, "mirror http listening");
    Ok((bound, shutdown_tx))
}

async fn token_gate_middleware(
    State(state): State<HttpState>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    // Never log raw path — it embeds the token (or attacker-supplied candidates).
    let log_path = path_for_log(&path);
    let Some(path_token) = extract_token_from_path(&path) else {
        tracing::warn!(path = %log_path, "mirror auth rejected: missing token path");
        return unauthorized();
    };

    let active = state.host.active_token();
    let Some(active) = active else {
        tracing::warn!(path = %log_path, "mirror auth rejected: host not running");
        return unauthorized();
    };

    if !tokens_equal(&path_token, &active) {
        tracing::warn!(path = %log_path, "mirror auth rejected: bad token");
        return unauthorized();
    }

    next.run(req).await
}

fn unauthorized() -> Response {
    // Fail-closed: 401 with no SPA body (AC3).
    (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
}

async fn unauth_fallback() -> Response {
    unauthorized()
}

async fn health_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"ok":true}"#,
    )
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    /// Optional fallback when path token is awkward for some clients (DESIGN §5.1).
    token: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<HttpState>,
    Query(q): Query<WsQuery>,
    headers: HeaderMap,
) -> Response {
    // Token already validated by middleware on path; query token is optional extra check.
    if let Some(qtok) = q.token.as_ref() {
        if let Some(active) = state.host.active_token() {
            if !tokens_equal(qtok, &active) {
                tracing::warn!("mirror ws: query token mismatch");
                return unauthorized();
            }
        }
    }

    let host = state.host.clone();

    // Cap concurrent WS clients (DoS / resource bound). Default 4; panel can raise.
    if host.is_at_client_limit() {
        let clients = host.hub().client_count();
        let max = host.max_clients();
        tracing::warn!(
            clients,
            max_clients = max,
            "mirror ws: rejected — client limit reached"
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Mirror client limit reached",
        )
            .into_response();
    }

    let (app, mgr) = match host.rpc_ctx() {
        Some(ctx) => (Some(ctx.0), Some(ctx.1)),
        None => {
            tracing::warn!("mirror ws: no host context (attach not called); RPC will be limited");
            (None, None)
        }
    };

    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-");
    let ua_snip: String = ua.chars().take(120).collect();
    // UA only — never log URL / token.
    tracing::info!(ua = %ua_snip, "mirror: websocket upgrade accepted");

    ws.on_upgrade(move |socket| ws::handle_socket(socket, host, app, mgr))
}

async fn index_handler(State(state): State<HttpState>, req: Request) -> Response {
    serve_index(&state, req.headers()).await
}

async fn static_handler(State(state): State<HttpState>, req: Request) -> Response {
    let path = req.uri().path();
    let Some(rest) = path_after_token(path) else {
        return unauthorized();
    };

    if rest.is_empty() || rest == "index.html" {
        return serve_index(&state, req.headers()).await;
    }

    // API / WS routes that are not registered should not leak as static 404 with body probe.
    if rest.starts_with("api/") || rest == "ws" {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    serve_static_file(&state, &rest)
}

/// `GET /assets/*` — no token (dynamic-import chunks ignore `<base href>`).
async fn public_assets_handler(State(state): State<HttpState>, req: Request) -> Response {
    let path = req.uri().path();
    // Only hashed build output under /assets/; reject anything else.
    let rest = path.strip_prefix('/').unwrap_or(path);
    if !rest.starts_with("assets/") || rest.contains("..") {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    // Host must be running so we do not leak dist when mirror is stopped.
    if state.host.active_token().is_none() {
        return unauthorized();
    }
    serve_static_file(&state, rest)
}

async fn serve_index(state: &HttpState, headers: &HeaderMap) -> Response {
    let token = match state.host.active_token() {
        Some(t) => t,
        None => return unauthorized(),
    };

    let index_path = state.dist_dir.join("index.html");
    let fs_html = std::fs::read_to_string(&index_path).ok();
    let embedded_html = if fs_html.is_none() {
        state.app.as_ref().and_then(|app| {
            serve_embedded(app, "index.html").and_then(|(b, _)| String::from_utf8(b).ok())
        })
    } else {
        None
    };
    let raw = match resolve_mirror_static_source(fs_html.is_some(), embedded_html.is_some()) {
        MirrorStaticSource::Filesystem => fs_html.expect("fs_hit"),
        MirrorStaticSource::Embedded => embedded_html.expect("embedded_hit"),
        MirrorStaticSource::Missing => {
            tracing::error!(
                path = %index_path.display(),
                "mirror: cannot read index.html — is dist built? set GROK_MIRROR_DIST"
            );
            // Temporary placeholder when dist missing (Slice 1 gate proof still works).
            let placeholder = format!(
                r#"<!doctype html><html><head><meta charset="utf-8"><title>Grok Mirror</title>
<script>window.__MIRROR__={{token:{tok},protocol:1}};</script>
<base href="/t/{token}/">
</head><body><p>Mirror host online (dist not found). Build UI or set GROK_MIRROR_DIST.</p></body></html>"#,
                tok = serde_json::to_string(&token).unwrap_or_else(|_| "\"\"".into()),
                token = token,
            );
            log_mirror_html_session(headers);
            // Same no-store as the real SPA path — phones must not cache this placeholder.
            return html_no_store(Html(placeholder).into_response());
        }
    };

    let injected = inject_mirror_shell(&raw, &token);
    log_mirror_html_session(headers);
    html_no_store(Html(injected).into_response())
}

/// SPA shell and dist-missing placeholder must never be cached by phone browsers.
fn html_no_store(mut res: Response) -> Response {
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );
    res
}

fn log_mirror_html_session(headers: &HeaderMap) {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-");
    let ua_snip: String = ua.chars().take(120).collect();
    tracing::info!(ua = %ua_snip, "mirror: authenticated HTML session");
}

/// Inject `<base href>`, `window.__MIRROR__`, and rewrite root-absolute asset URLs under token.
pub fn inject_mirror_shell(html: &str, token: &str) -> String {
    let prefix = format!("/t/{token}");
    // Rewrite root-absolute asset URLs first (absolute paths ignore <base href>).
    // Do this before injecting our own base/script tags so we never double-prefix them.
    let out = html
        .replace("src=\"/", &format!("src=\"{prefix}/"))
        .replace("href=\"/", &format!("href=\"{prefix}/"));

    let base = format!(r#"<base href="{prefix}/">"#);
    let mirror_script = format!(
        r#"<script>window.__MIRROR__={{token:{},protocol:1}};</script>"#,
        serde_json::to_string(token).unwrap_or_else(|_| "\"\"".into())
    );
    let inject = format!("{mirror_script}\n    {base}");

    if let Some(idx) = out.find("<head>") {
        let mut s = String::with_capacity(out.len() + inject.len() + 64);
        s.push_str(&out[..idx + 6]);
        s.push('\n');
        s.push_str(&inject);
        s.push_str(&out[idx + 6..]);
        s
    } else if let Some(idx) = out.find("<head ") {
        if let Some(end) = out[idx..].find('>') {
            let at = idx + end + 1;
            let mut s = String::with_capacity(out.len() + inject.len() + 64);
            s.push_str(&out[..at]);
            s.push('\n');
            s.push_str(&inject);
            s.push_str(&out[at..]);
            s
        } else {
            format!("{inject}\n{out}")
        }
    } else {
        format!("{inject}\n{out}")
    }
}

fn embedded_asset_key(rest: &str) -> Option<String> {
    if rest.contains("..") || rest.contains('\\') || rest.starts_with('/') {
        return None;
    }
    Some(format!("/{}", rest.trim_start_matches('/')))
}

/// Packaged fallback: filesystem dist missing → embedded frontendDist.
fn serve_embedded(app: &AppHandle, rest: &str) -> Option<(Vec<u8>, String)> {
    let key = embedded_asset_key(rest)?;
    let asset = app.asset_resolver().get(key)?;
    Some((asset.bytes, asset.mime_type))
}

fn try_read_dist_file(dist_dir: &Path, rest: &str) -> Option<(Vec<u8>, PathBuf)> {
    let file_path = dist_dir.join(rest);
    let canon_dist = dist_dir.canonicalize().ok()?;
    let canon_file = file_path.canonicalize().ok()?;
    if !canon_file.starts_with(&canon_dist) || !canon_file.is_file() {
        return None;
    }
    let bytes = std::fs::read(&canon_file).ok()?;
    Some((bytes, canon_file))
}

fn static_ok(bytes: Vec<u8>, mime: &str, rest: &str) -> Response {
    let mut res = Response::new(Body::from(bytes));
    *res.status_mut() = StatusCode::OK;
    if let Ok(v) = HeaderValue::from_str(mime) {
        res.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    if rest.starts_with("assets/") {
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    res
}

fn serve_static_file(state: &HttpState, rest: &str) -> Response {
    // Reject path traversal before filesystem or embedded lookup.
    if rest.contains("..") || rest.starts_with('/') || rest.contains('\\') {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let fs_file = try_read_dist_file(&state.dist_dir, rest);
    let embedded = if fs_file.is_none() {
        state.app.as_ref().and_then(|app| serve_embedded(app, rest))
    } else {
        None
    };
    match resolve_mirror_static_source(fs_file.is_some(), embedded.is_some()) {
        MirrorStaticSource::Filesystem => {
            let (bytes, path) = fs_file.expect("fs_hit");
            static_ok(bytes, mime_guess_from_path(&path), rest)
        }
        MirrorStaticSource::Embedded => {
            let (bytes, mime) = embedded.expect("embedded_hit");
            static_ok(bytes, &mime, rest)
        }
        MirrorStaticSource::Missing => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

fn mime_guess_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_adds_base_and_mirror_and_rewrites_assets() {
        let html = r#"<!doctype html><html><head>
<meta charset="UTF-8" />
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-abc.css">
</head><body><div id="root"></div></body></html>"#;
        let out = inject_mirror_shell(html, "tok123");
        assert!(out.contains(r#"window.__MIRROR__={token:"tok123",protocol:1}"#));
        assert!(out.contains(r#"<base href="/t/tok123/">"#));
        assert!(out.contains(r#"src="/t/tok123/assets/index-abc.js""#));
        assert!(out.contains(r#"href="/t/tok123/assets/index-abc.css""#));
        assert!(!out.contains(r#"src="/assets/"#));
    }

    #[test]
    fn resolve_mirror_static_source_prefers_fs_then_embedded() {
        assert_eq!(
            resolve_mirror_static_source(true, true),
            MirrorStaticSource::Filesystem
        );
        assert_eq!(
            resolve_mirror_static_source(true, false),
            MirrorStaticSource::Filesystem
        );
        assert_eq!(
            resolve_mirror_static_source(false, true),
            MirrorStaticSource::Embedded
        );
        assert_eq!(
            resolve_mirror_static_source(false, false),
            MirrorStaticSource::Missing
        );
    }

    #[test]
    fn embedded_asset_key_rejects_traversal() {
        assert_eq!(
            embedded_asset_key("index.html").as_deref(),
            Some("/index.html")
        );
        assert_eq!(
            embedded_asset_key("assets/app.js").as_deref(),
            Some("/assets/app.js")
        );
        assert_eq!(embedded_asset_key("../secret"), None);
        assert_eq!(embedded_asset_key("/etc/passwd"), None);
        assert_eq!(embedded_asset_key("foo\\bar"), None);
    }

    #[test]
    fn html_no_store_sets_cache_control() {
        let res = html_no_store(Html("<p>x</p>".to_string()).into_response());
        let cc = res
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(cc, "no-cache, no-store, must-revalidate");
    }
}
