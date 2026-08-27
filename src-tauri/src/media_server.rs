//! Loopback HTTP media server — primary delivery for local files.
//!
//! Replaces the custom `media://` scheme for frontend `<img>` / `<video>` /
//! `fetch` loads. Benefits:
//! - Standard `http://127.0.0.1:{port}/…` URLs (WebView + browser + tools)
//! - Token gate (embedded browsers without the token cannot read disk)
//! - Same `path_scope` allowlist as the old protocol
//! - Full-body delivery for images (`<img>` cannot reassemble Range chunks)
//! - HTTP Range with bounded chunks (video/audio/PDF)
//!
//! URL shape (path never appears unencoded in the path segment):
//! ```text
//! GET http://127.0.0.1:{port}/v1/media?t={token}&p={urlencode(abs_path)}
//! ```

#![allow(dead_code)] // residual-clippy: url helper variants
use std::io::{Read, Seek, SeekFrom};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rand::RngCore;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Max bytes returned per Range request (keeps memory bounded — video/audio/PDF).
const MAX_CHUNK: u64 = 2 * 1024 * 1024; // 2 MiB

/// Max full-body response without Range (chat images, small binaries).
/// `<img>` tags do not reassemble multi-Range responses — truncating at
/// MAX_CHUNK yields broken/empty thumbnails for common multi-MB photos.
const MAX_FULL_BODY: u64 = 40 * 1024 * 1024; // 40 MiB

/// Max bytes returned by one raw Tauri IPC read. Wallpaper application needs a
/// complete `File`, but one unbounded IPC response would create a large memory
/// spike for videos.
pub const MAX_IPC_CHUNK: u32 = 8 * 1024 * 1024; // 8 MiB

/// Same ceiling as wallpaper video preparation/download.
const MAX_IPC_FILE: u64 = 200 * 1024 * 1024; // 200 MiB

/// Endpoint published to the frontend (base URL + secret token).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServerEndpoint {
    pub base_url: String,
    pub token: String,
}

/// Metadata used by bounded raw-IPC reads for full-file consumers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFileInfo {
    pub bytes: u64,
    pub mime: String,
    pub name: String,
}

/// Managed Tauri state — process-wide media server.
pub struct MediaServerHandle {
    pub endpoint: MediaServerEndpoint,
    shutdown: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

impl MediaServerHandle {
    pub fn endpoint(&self) -> MediaServerEndpoint {
        self.endpoint.clone()
    }
}

impl Drop for MediaServerHandle {
    fn drop(&mut self) {
        if let Ok(mut g) = self.shutdown.lock() {
            if let Some(tx) = g.take() {
                let _ = tx.send(());
            }
        }
    }
}

#[derive(Clone)]
struct ServerState {
    token: Arc<String>,
}

#[derive(Debug, serde::Deserialize)]
struct MediaQuery {
    /// Shared secret from `media_server_endpoint`.
    t: String,
    /// Absolute filesystem path (percent-decoded by axum query parser).
    p: String,
}

/// Bind `127.0.0.1:0`, spawn axum serve task, return handle.
pub async fn start() -> Result<MediaServerHandle, String> {
    let token = random_token();
    let state = ServerState {
        token: Arc::new(token.clone()),
    };

    let app = Router::new()
        .route(
            "/v1/media",
            get(media_get).head(media_get).options(media_options),
        )
        .route("/v1/health", get(health))
        .fallback(fallback_not_found)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("media server bind: {e}"))?;
    let bound = listener
        .local_addr()
        .map_err(|e| format!("media server local_addr: {e}"))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let serve = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = serve.await {
            tracing::error!(error = %e, "media http server exited with error");
        } else {
            tracing::info!("media http server stopped");
        }
    });

    let base_url = format!("http://127.0.0.1:{bound}");
    tracing::info!(%base_url, "media http listening (loopback, token-gated)");

    Ok(MediaServerHandle {
        endpoint: MediaServerEndpoint { base_url, token },
        shutdown: std::sync::Mutex::new(Some(shutdown_tx)),
    })
}

/// Build a viewable URL for an absolute path (used by tests / optional host helpers).
pub fn url_for_path(endpoint: &MediaServerEndpoint, abs_path: &str) -> String {
    format!(
        "{}/v1/media?t={}&p={}",
        endpoint.base_url.trim_end_matches('/'),
        urlencoding_encode(&endpoint.token),
        urlencoding_encode(abs_path)
    )
}

/// Inspect one allowlisted local media file before reading it over raw IPC.
///
/// WebView2 can block JavaScript `fetch()` to the loopback server before the
/// request reaches our CORS handler. Full-file consumers (wallpaper apply) use
/// this bounded IPC path; normal `<img>` / `<video>` previews still use HTTP.
pub fn ipc_file_info(path_raw: &str) -> Result<MediaFileInfo, String> {
    let path = require_allowed_media_file(path_raw)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("read_failed: stat: {e}"))?;
    let bytes = meta.len();
    if bytes > MAX_IPC_FILE {
        return Err("read_failed: file too large".into());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("wallpaper")
        .to_string();
    Ok(MediaFileInfo {
        bytes,
        mime: mime_from_path(&path.to_string_lossy()).to_string(),
        name,
    })
}

/// Read one bounded byte window for a full-file raw IPC consumer.
pub fn ipc_read_file_chunk(path_raw: &str, offset: u64, length: u32) -> Result<Vec<u8>, String> {
    if length == 0 || length > MAX_IPC_CHUNK {
        return Err("read_failed: invalid chunk length".into());
    }

    let path = require_allowed_media_file(path_raw)?;
    let mut file = std::fs::File::open(&path).map_err(|e| format!("read_failed: open: {e}"))?;
    let total = file
        .metadata()
        .map_err(|e| format!("read_failed: stat: {e}"))?
        .len();
    if total > MAX_IPC_FILE {
        return Err("read_failed: file too large".into());
    }
    if offset >= total {
        return Err("read_failed: invalid chunk offset".into());
    }

    let expected = u64::from(length).min(total - offset) as usize;
    let mut bytes = vec![0_u8; expected];
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("read_failed: seek: {e}"))?;
    file.read_exact(&mut bytes)
        .map_err(|e| format!("read_failed: short read: {e}"))?;
    Ok(bytes)
}

fn require_allowed_media_file(path_raw: &str) -> Result<PathBuf, String> {
    let raw = path_raw.trim();
    if raw.is_empty() {
        return Err("read_failed: missing path".into());
    }
    let path = PathBuf::from(raw);

    // Check scope before existence so IPC does not become a filesystem oracle.
    if !crate::path_scope::is_allowed(&path) {
        return Err("path_not_allowed".into());
    }
    if !path.exists() {
        return Err("read_failed: file not found".into());
    }
    let canonical = crate::path_scope::require_allowed(&path).map_err(|_| "path_not_allowed")?;
    if !canonical.is_file() {
        return Err("read_failed: file not found".into());
    }
    Ok(canonical)
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    // URL-safe base64 without padding
    base64_url_encode(&bytes)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Minimal encodeURIComponent-compatible encoder for query values.
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(HEX[(b >> 4) as usize]));
                out.push(char::from(HEX[(b & 0xf) as usize]));
            }
        }
    }
    out
}

const HEX: &[u8; 16] = b"0123456789ABCDEF";

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn fallback_not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, "not found")
}

/// Origins allowed to `fetch` media (main window only — not embedded browsers).
/// `<img>` / `<video>` often omit Origin; CORS is still required for
/// `fetch` (copy image, office preview reassembly).
fn allowed_origins() -> &'static [&'static str] {
    &[
        "http://localhost:1421",
        "https://localhost:1421",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost",
        "https://localhost",
    ]
}

fn cors_origin_from_headers(headers: &HeaderMap) -> Option<&'static str> {
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())?;
    allowed_origins().iter().find(|o| **o == origin).copied()
}

fn request_origin_allowed(headers: &HeaderMap) -> bool {
    match headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        None => true, // same-document / <img>/<video> from main webview
        Some(origin) => allowed_origins().contains(&origin),
    }
}

/// CORS preflight for fetch/Range clients.
async fn media_options(req: Request<Body>) -> Response {
    let Some(origin) = cors_origin_from_headers(req.headers()) else {
        return text_status(StatusCode::FORBIDDEN, "origin not allowed");
    };
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("range, content-type, accept, origin"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("content-range, accept-ranges, content-length, content-type"),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    (StatusCode::NO_CONTENT, headers, Body::empty()).into_response()
}

async fn media_get(
    State(state): State<ServerState>,
    Query(q): Query<MediaQuery>,
    req: Request<Body>,
) -> Response {
    let acao = cors_origin_from_headers(req.headers());

    if !request_origin_allowed(req.headers()) {
        tracing::warn!("media server: rejected disallowed Origin");
        return text_status_cors(StatusCode::FORBIDDEN, "origin not allowed", acao);
    }

    // Token must match exactly (constant-time-ish via subtle compare of equal length).
    if !tokens_equal(state.token.as_str(), &q.t) {
        tracing::warn!("media server: bad or missing token");
        return text_status_cors(StatusCode::UNAUTHORIZED, "unauthorized", acao);
    }

    let path_raw = q.p.trim();
    if path_raw.is_empty() {
        return text_status_cors(StatusCode::BAD_REQUEST, "missing path", acao);
    }
    let path = PathBuf::from(path_raw);

    // Allowlist BEFORE exists() — never leak path existence outside trusted
    // roots (404 vs 403 oracle). `is_allowed` works without the file on disk.
    if !crate::path_scope::is_allowed(&path) {
        tracing::warn!(path = %path.display(), "media server: path not allowed");
        return text_status_cors(StatusCode::FORBIDDEN, "path not allowed", acao);
    }

    // Allowed but missing → honest 404 (not 403), so the UI does not blame a
    // corrupt blob for an allowlist failure.
    if !path.exists() {
        return text_status_cors(StatusCode::NOT_FOUND, "file not found", acao);
    }

    let path = match crate::path_scope::require_allowed(&path) {
        Ok(p) => p,
        Err(_) => {
            tracing::warn!(path = %path.display(), "media server: path not allowed");
            return text_status_cors(StatusCode::FORBIDDEN, "path not allowed", acao);
        }
    };

    if !path.is_file() {
        return text_status_cors(StatusCode::NOT_FOUND, "file not found", acao);
    }

    let method = req.method().clone();
    let range_hdr = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // File I/O off the async runtime.
    let result = tokio::task::spawn_blocking(move || {
        read_file_chunk(&path, range_hdr.as_deref(), method == Method::HEAD)
    })
    .await;

    match result {
        Ok(Ok(mut chunk)) => {
            chunk.cors_origin = acao;
            chunk.into_response()
        }
        Ok(Err((status, msg))) => text_status_cors(status, msg, acao),
        Err(e) => {
            tracing::error!(error = %e, "media server: join error");
            text_status_cors(StatusCode::INTERNAL_SERVER_ERROR, "internal error", acao)
        }
    }
}

struct FileChunk {
    status: StatusCode,
    mime: &'static str,
    start: u64,
    end: u64,
    total: u64,
    partial: bool,
    body: Vec<u8>,
    head_only: bool,
    cors_origin: Option<&'static str>,
}

impl IntoResponse for FileChunk {
    fn into_response(self) -> Response {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(self.mime));
        headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("content-range, accept-ranges, content-length, content-type"),
        );
        // Images remount often in chat virtual lists. Thumbs are tiny + stable;
        // allow long private browser cache so scroll remounts hit disk not Host.
        // Streaming media keeps no-cache so Range windows stay fresh.
        let cache = if self.mime.starts_with("image/") && !self.partial {
            "private, max-age=604800, immutable"
        } else {
            "no-cache"
        };
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
        // Weak ETag from body length — helps revalidation when max-age lapses.
        if !self.partial && !self.body.is_empty() {
            let etag = format!("W/\"{}\"", self.body.len());
            if let Ok(v) = HeaderValue::from_str(&etag) {
                headers.insert(header::ETAG, v);
            }
        }
        if let Some(o) = self.cors_origin {
            if let Ok(v) = HeaderValue::from_str(o) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
            }
            headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        }
        if self.partial && self.total > 0 {
            if let Ok(v) =
                HeaderValue::from_str(&format!("bytes {}-{}/{}", self.start, self.end, self.total))
            {
                headers.insert(header::CONTENT_RANGE, v);
            }
        }
        let body = if self.head_only {
            Body::empty()
        } else {
            Body::from(self.body)
        };
        if self.head_only {
            let nbytes = if self.total == 0 {
                0
            } else {
                self.end.saturating_sub(self.start).saturating_add(1)
            };
            if let Ok(v) = HeaderValue::from_str(&nbytes.to_string()) {
                headers.insert(header::CONTENT_LENGTH, v);
            }
        }
        (self.status, headers, body).into_response()
    }
}

fn read_file_chunk(
    path: &Path,
    range_hdr: Option<&str>,
    head_only: bool,
) -> Result<FileChunk, (StatusCode, &'static str)> {
    let mut file = std::fs::File::open(path).map_err(|_| (StatusCode::FORBIDDEN, "open failed"))?;
    let len = file
        .metadata()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "stat failed"))?
        .len();
    let mime = mime_from_path(&path.to_string_lossy());
    let is_image = mime.starts_with("image/");

    let (start, end, partial) = if let Some(rh) = range_hdr {
        match parse_range(rh, len) {
            Some((s, e)) => (s, e, true),
            None => {
                return Err((StatusCode::RANGE_NOT_SATISFIABLE, "range not satisfiable"));
            }
        }
    } else if len == 0 {
        (0, 0, false)
    } else if is_image || len <= MAX_CHUNK {
        // Full body for images (any size ≤ MAX_FULL_BODY) and small non-images.
        // `<img src>` never sends Range and cannot decode a 206 first-chunk.
        if len > MAX_FULL_BODY {
            return Err((StatusCode::PAYLOAD_TOO_LARGE, "file too large"));
        }
        (0, len - 1, false)
    } else {
        // No Range on a large video/audio/pdf: first chunk as 206 so the
        // player learns Accept-Ranges (frontend reassembly / Plyr).
        (0, MAX_CHUNK - 1, true)
    };

    let nbytes = if len == 0 {
        0
    } else {
        end.saturating_sub(start).saturating_add(1)
    };
    let max_allowed = if partial { MAX_CHUNK } else { MAX_FULL_BODY };
    if nbytes > max_allowed {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "chunk too large"));
    }

    let body = if head_only || nbytes == 0 {
        Vec::new()
    } else {
        let mut buf = vec![0u8; nbytes as usize];
        file.seek(SeekFrom::Start(start))
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "seek failed"))?;
        match file.read_exact(&mut buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                // short read near EOF — keep what we have
            }
            Err(_) => return Err((StatusCode::INTERNAL_SERVER_ERROR, "read failed")),
        }
        buf
    };

    Ok(FileChunk {
        status: if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
        mime,
        start,
        end,
        total: len,
        partial,
        body,
        head_only,
        cors_origin: None,
    })
}

fn text_status(status: StatusCode, msg: &str) -> Response {
    (status, msg.to_string()).into_response()
}

fn text_status_cors(status: StatusCode, msg: &str, cors_origin: Option<&'static str>) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    if let Some(o) = cors_origin {
        if let Ok(v) = HeaderValue::from_str(o) {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
        }
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    (status, headers, msg.to_string()).into_response()
}

fn tokens_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    // Best-effort constant-time for equal-length secrets.
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn mime_from_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let s = header.trim().strip_prefix("bytes=")?.trim();
    let part = s.split(',').next()?.trim();
    if let Some(suffix) = part.strip_prefix('-') {
        let n: u64 = suffix.parse().ok()?;
        if n == 0 || len == 0 {
            return None;
        }
        let n = n.min(len);
        return Some((len - n, len - 1));
    }
    let (a, b) = part.split_once('-')?;
    let start: u64 = a.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if b.is_empty() {
        (start + MAX_CHUNK - 1).min(len - 1)
    } else {
        let e: u64 = b.parse().ok()?;
        e.min(len - 1)
    };
    if end < start {
        return None;
    }
    let end = start.saturating_add(MAX_CHUNK - 1).min(end).min(len - 1);
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_range_suffix_and_cap() {
        assert_eq!(parse_range("bytes=0-9", 100), Some((0, 9)));
        assert_eq!(
            parse_range("bytes=0-", 100),
            Some((0, 99.min(MAX_CHUNK - 1)))
        );
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
    }

    #[test]
    fn tokens_equal_rejects_mismatch() {
        assert!(tokens_equal("abc", "abc"));
        assert!(!tokens_equal("abc", "abd"));
        assert!(!tokens_equal("abc", "ab"));
    }

    #[test]
    fn url_for_path_encodes() {
        let ep = MediaServerEndpoint {
            base_url: "http://127.0.0.1:9".into(),
            token: "tok".into(),
        };
        let u = url_for_path(&ep, "/Users/me/a b.png");
        assert!(u.contains("t=tok"));
        assert!(u.contains("p=%2FUsers%2Fme%2Fa%20b.png") || u.contains("a%20b"));
    }

    #[tokio::test]
    async fn ipc_file_read_is_allowlisted_and_chunked() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        let dir = std::env::temp_dir().join(format!("grok-media-ipc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("wallpaper.png");
        std::fs::write(&file, b"abcdefghij").unwrap();
        crate::path_scope::grant_path(&file);

        let raw = file.to_string_lossy();
        let info = ipc_file_info(&raw).expect("info");
        assert_eq!(info.bytes, 10);
        assert_eq!(info.mime, "image/png");
        assert_eq!(info.name, "wallpaper.png");
        assert_eq!(ipc_read_file_chunk(&raw, 2, 4).expect("chunk"), b"cdef");
        assert_eq!(ipc_read_file_chunk(&raw, 8, 8).expect("last chunk"), b"ij");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn ipc_file_read_rejects_path_outside_allowlist() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        let missing = std::path::PathBuf::from(format!(
            "/grok-app-untrusted-ipc-{}/nope.png",
            uuid::Uuid::new_v4()
        ));
        let raw = missing.to_string_lossy();

        assert_eq!(ipc_file_info(&raw).unwrap_err(), "path_not_allowed");
        assert_eq!(
            ipc_read_file_chunk(&raw, 0, 1).unwrap_err(),
            "path_not_allowed"
        );
    }

    #[test]
    fn ipc_file_read_rejects_unbounded_chunk() {
        let err = ipc_read_file_chunk("ignored", 0, MAX_IPC_CHUNK + 1).unwrap_err();
        assert!(err.contains("invalid chunk length"));
    }

    #[tokio::test]
    async fn serves_allowed_file_with_token() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        let dir = std::env::temp_dir().join(format!("grok-media-srv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hi.png");
        {
            let mut f = std::fs::File::create(&file).unwrap();
            // minimal PNG-ish bytes
            f.write_all(b"\x89PNG\r\n\x1a\nhello").unwrap();
        }
        crate::path_scope::grant_path(&file);

        let handle = start().await.expect("start");
        let url = url_for_path(&handle.endpoint(), &file.to_string_lossy());
        let client = reqwest::Client::new();
        let res = client.get(&url).send().await.expect("get");
        assert_eq!(res.status(), 200);
        let bytes = res.bytes().await.unwrap();
        assert!(bytes.starts_with(b"\x89PNG"));

        // Bad token
        let bad = url.replace(&handle.endpoint.token, "wrong-token-xxxxxxxx");
        let res = client.get(&bad).send().await.expect("get bad");
        assert_eq!(res.status(), 401);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn serves_full_body_for_large_image_without_range() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        // Regression: >2 MiB images must be 200 + full body so <img> can decode.
        let dir = std::env::temp_dir().join(format!("grok-media-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("big.png");
        let size = (MAX_CHUNK as usize) + 1024;
        {
            let mut f = std::fs::File::create(&file).unwrap();
            f.write_all(b"\x89PNG\r\n\x1a\n").unwrap();
            f.write_all(&vec![0xABu8; size - 8]).unwrap();
        }
        crate::path_scope::grant_path(&file);

        let handle = start().await.expect("start");
        let url = url_for_path(&handle.endpoint(), &file.to_string_lossy());
        let client = reqwest::Client::new();
        let res = client.get(&url).send().await.expect("get");
        assert_eq!(res.status(), 200, "large image must not be truncated 206");
        let bytes = res.bytes().await.unwrap();
        assert_eq!(bytes.len(), size);
        assert!(bytes.starts_with(b"\x89PNG"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn large_non_image_without_range_returns_first_chunk_206() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        let dir = std::env::temp_dir().join(format!("grok-media-bin-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.bin");
        let size = (MAX_CHUNK as usize) + 4096;
        {
            let mut f = std::fs::File::create(&file).unwrap();
            f.write_all(&vec![0xCDu8; size]).unwrap();
        }
        crate::path_scope::grant_path(&file);

        let handle = start().await.expect("start");
        let url = url_for_path(&handle.endpoint(), &file.to_string_lossy());
        let client = reqwest::Client::new();
        let res = client.get(&url).send().await.expect("get");
        assert_eq!(res.status(), 206);
        let bytes = res.bytes().await.unwrap();
        assert_eq!(bytes.len(), MAX_CHUNK as usize);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn missing_file_is_404_not_403() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        // Error honesty: a path that does not exist is NOT FOUND (404), not a
        // path_scope denial (403) — the frontend must not blame a corrupt blob
        // for an allowlist failure.
        let dir = std::env::temp_dir().join(format!("grok-media-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("gone.png");
        crate::path_scope::grant_path(&missing);

        let handle = start().await.expect("start");
        let url = url_for_path(&handle.endpoint(), &missing.to_string_lossy());
        let client = reqwest::Client::new();
        let res = client.get(&url).send().await.expect("get");
        assert_eq!(res.status(), 404);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn outside_allowlist_is_403_even_when_missing() {
        let _scope = crate::path_scope::TEST_LOCK.lock().await;
        // No existence oracle: untrusted missing paths stay 403 (not 404).
        // Must NOT use temp_dir — `refresh_from_store` always allowlists it
        // (Linux `/tmp` has no symlink split, so that path would be 404).
        let missing = std::path::PathBuf::from(format!(
            "/grok-app-untrusted-missing-{}/nope.png",
            uuid::Uuid::new_v4()
        ));
        // Do NOT grant_path — outside allowlist.
        let handle = start().await.expect("start");
        let url = url_for_path(&handle.endpoint(), &missing.to_string_lossy());
        let client = reqwest::Client::new();
        let res = client.get(&url).send().await.expect("get");
        assert_eq!(res.status(), 403);
    }

    #[test]
    fn decide_window_images_full_body() {
        // Unit-level: read_file_chunk on a synthetic image path extension.
        let dir = std::env::temp_dir().join(format!("grok-media-unit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("photo.jpg");
        let size = (MAX_CHUNK as usize) + 512;
        {
            let mut f = std::fs::File::create(&file).unwrap();
            f.write_all(&vec![0xFFu8; size]).unwrap();
        }
        let chunk = read_file_chunk(&file, None, false).expect("read");
        assert!(!chunk.partial);
        assert_eq!(chunk.status, StatusCode::OK);
        assert_eq!(chunk.body.len(), size);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
