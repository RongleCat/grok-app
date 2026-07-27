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

use super::auth::{extract_token_from_path, path_after_token, tokens_equal};
use super::ws;
use super::MirrorHost;

/// Shared state for axum handlers.
#[derive(Clone)]
pub struct HttpState {
    pub host: Arc<MirrorHost>,
    pub dist_dir: PathBuf,
}

/// Bind `127.0.0.1:port` (port 0 = OS-assigned free port). Returns bound port + shutdown sender.
pub async fn start_server(
    host: Arc<MirrorHost>,
    port: u16,
    dist_dir: PathBuf,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let state = HttpState {
        host: host.clone(),
        dist_dir,
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

    let app = gated
        .merge(public_assets)
        .fallback(unauth_fallback);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
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

    tracing::info!(port = bound, "mirror http listening on 127.0.0.1");
    Ok((bound, shutdown_tx))
}


fn security_headers(mut res: Response) -> Response {
    let headers = res.headers_mut();
    headers.insert(
        header::HeaderName::from_static("referrer-policy"),
        header::HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        header::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::HeaderName::from_static("x-frame-options"),
        header::HeaderValue::from_static("DENY"),
    );
    res
}

async fn token_gate_middleware(
    State(state): State<HttpState>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let Some(path_token) = extract_token_from_path(&path) else {
        tracing::warn!(path = %path_after_token(&path).unwrap_or_else(|| "<redacted>".into()), "mirror auth rejected: missing token path");
        return unauthorized();
    };

    let active = state.host.active_token();
    let Some(active) = active else {
        tracing::warn!(path = %path_after_token(&path).unwrap_or_else(|| "<redacted>".into()), "mirror auth rejected: host not running");
        return unauthorized();
    };

    if !tokens_equal(&path_token, &active) {
        tracing::warn!(path = %path_after_token(&path).unwrap_or_else(|| "<redacted>".into()), "mirror auth rejected: bad token");
        return unauthorized();
    }

    next.run(req).await
}

fn unauthorized() -> Response {
    // Fail-closed: 401 with no SPA body (AC3).
    security_headers((StatusCode::UNAUTHORIZED, "Unauthorized").into_response())
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

    // Reject browser pages that are not this mirror (or loopback).
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        let origin = origin.trim();
        let ok = origin.starts_with("http://127.0.0.1")
            || origin.starts_with("http://localhost")
            || origin.starts_with("https://127.0.0.1")
            || origin.starts_with("https://localhost")
            || state
                .host
                .public_base_url()
                .as_deref()
                .map(|u| origin == u.trim_end_matches('/'))
                .unwrap_or(false);
        if !ok {
            tracing::warn!(origin = %origin, "mirror ws: origin not allowed");
            return unauthorized();
        }
    }

    let host = state.host.clone();
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
    tracing::info!(ua = %ua_snip, "mirror: websocket upgrade accepted");

    ws.on_upgrade(move |socket| ws::handle_socket(socket, host, app, mgr))
}

async fn index_handler(
    State(state): State<HttpState>,
    req: Request,
) -> Response {
    serve_index(&state, req.headers()).await
}

async fn static_handler(
    State(state): State<HttpState>,
    req: Request,
) -> Response {
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

    serve_static_file(&state.dist_dir, &rest)
}

/// `GET /assets/*` — no token (dynamic-import chunks ignore `<base href>`).
async fn public_assets_handler(
    State(state): State<HttpState>,
    req: Request,
) -> Response {
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
    serve_static_file(&state.dist_dir, rest)
}

async fn serve_index(state: &HttpState, headers: &HeaderMap) -> Response {
    let token = match state.host.active_token() {
        Some(t) => t,
        None => return unauthorized(),
    };

    let index_path = state.dist_dir.join("index.html");
    let raw = match std::fs::read_to_string(&index_path) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(
                path = %index_path.display(),
                error = %e,
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

fn serve_static_file(dist_dir: &Path, rest: &str) -> Response {
    // Reject path traversal.
    if rest.contains("..") || rest.starts_with('/') || rest.contains('\\') {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let file_path = dist_dir.join(rest);
    let Ok(canon_dist) = dist_dir.canonicalize() else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };
    let Ok(canon_file) = file_path.canonicalize() else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };
    if !canon_file.starts_with(&canon_dist) {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    if !canon_file.is_file() {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let bytes = match std::fs::read(&canon_file) {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };

    let mime = mime_guess_from_path(&canon_file);
    let mut res = Response::new(Body::from(bytes));
    *res.status_mut() = StatusCode::OK;
    if let Ok(v) = HeaderValue::from_str(mime) {
        res.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    // Hashed assets under /assets/ can be cached long-lived.
    if rest.starts_with("assets/") {
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    res
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
