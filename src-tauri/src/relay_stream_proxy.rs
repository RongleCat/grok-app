//! Local OpenAI-compatible reverse proxy that strips non-standard SSE frames.
//!
//! Some gateways (OpenCode Zen Go, etc.) append proprietary trailers such as:
//!   `{"choices":[],"x-opencode-type":"inference-cost",...}`  // missing `id`
//!   `{"type":"ping","cost":"0"}`
//! Grok Build CLI deserializes stream chunks strictly and **fatals** on these,
//! which surfaces in the App as “Agent crashed / protocol interrupted”.
//!
//! Host rewrites affected providers’ `base_url` to
//! `http://127.0.0.1:{port}/r/{provider_id}/v1` and stores the real upstream in
//! `app_upstream_base_url` (CLI ignores unknown keys).

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::OnceLock;

use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use futures_util::StreamExt;
use tokio::sync::Mutex;

/// TOML key for the real upstream base (written next to rewritten localhost base).
pub const APP_UPSTREAM_BASE_URL_KEY: &str = "app_upstream_base_url";

static LISTEN_PORT: AtomicU16 = AtomicU16::new(0);
static START_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const RELAY_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const RELAY_STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

fn start_lock() -> &'static Mutex<()> {
    START_LOCK.get_or_init(|| Mutex::new(()))
}

/// Hosts that need SSE sanitizing before Grok Build sees them.
pub fn host_needs_stream_sanitize(base_url: &str) -> bool {
    let u = base_url.trim().to_ascii_lowercase();
    u.contains("opencode.ai") || u.contains("/zen/go")
}

/// Whether a single SSE `data:` payload should be dropped (CLI-unsafe).
pub fn should_drop_sse_data_payload(payload: &str) -> bool {
    let raw = payload.trim();
    if raw.is_empty() || raw == "[DONE]" {
        return false;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return false;
    };
    if v.get("x-opencode-type").is_some() {
        return true;
    }
    if v.get("type").and_then(|t| t.as_str()) == Some("ping") {
        return true;
    }
    let has_id = v.get("id").map(|x| !x.is_null()).unwrap_or(false);
    let object = v.get("object").and_then(|o| o.as_str()).unwrap_or("");
    if object == "chat.completion.chunk" && !has_id {
        return true;
    }
    if !has_id {
        let choices_empty = v
            .get("choices")
            .and_then(|c| c.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(false);
        if choices_empty || v.get("cost").is_some() || v.get("normalizedUsage").is_some() {
            return true;
        }
        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
            if t.starts_with("response.")
                && v.get("sequence_number").is_none()
                && (t.contains("delta") || t.contains("ping"))
            {
                return true;
            }
        }
    }
    false
}

/// Decode streaming UTF-8 without corrupting multi-byte chars at chunk boundaries.
///
/// `from_utf8_lossy` on each TCP/HTTP chunk independently replaces incomplete
/// trailing sequences with U+FFFD (`��`), which permanently mojibakes CJK text
/// mid-stream. Keep incomplete bytes in `pending` until the next chunk completes them.
pub fn push_utf8_stream(pending: &mut Vec<u8>, chunk: &[u8], out: &mut String) {
    if chunk.is_empty() {
        return;
    }
    pending.extend_from_slice(chunk);
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                break;
            }
            Err(e) => {
                let good = e.valid_up_to();
                if good > 0 {
                    // SAFETY: `valid_up_to` marks a complete valid UTF-8 prefix.
                    let s = unsafe { std::str::from_utf8_unchecked(&pending[..good]) };
                    out.push_str(s);
                    pending.drain(..good);
                }
                match e.error_len() {
                    // Incomplete multi-byte sequence at end — wait for more bytes.
                    None => break,
                    // Invalid sequence — skip and replace (should be rare on API SSE).
                    Some(n) => {
                        let n = n.min(pending.len()).max(1);
                        out.push('\u{FFFD}');
                        pending.drain(..n);
                    }
                }
            }
        }
    }
}

/// Filter one SSE event block (terminated by blank line).
pub fn filter_sse_event(event: &str) -> String {
    let mut data_payloads: Vec<String> = Vec::new();
    let mut other: Vec<String> = Vec::new();
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            data_payloads.push(rest.trim_start().to_string());
        } else if !line.is_empty() {
            other.push(line.to_string());
        }
    }
    if data_payloads.is_empty() {
        if other.is_empty() {
            return String::new();
        }
        let mut out = other.join("\n");
        out.push_str("\n\n");
        return out;
    }
    data_payloads.retain(|p| !should_drop_sse_data_payload(p));
    if data_payloads.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for o in other {
        out.push_str(&o);
        out.push('\n');
    }
    for d in data_payloads {
        out.push_str("data: ");
        out.push_str(&d);
        out.push('\n');
    }
    out.push('\n');
    out
}

/// Ensure the local proxy is listening; returns the bound port.
pub async fn ensure_started() -> Result<u16, String> {
    let port = LISTEN_PORT.load(Ordering::SeqCst);
    if port != 0 {
        return Ok(port);
    }
    let _g = start_lock().lock().await;
    let port = LISTEN_PORT.load(Ordering::SeqCst);
    if port != 0 {
        return Ok(port);
    }

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .map_err(|e| format!("relay stream proxy bind: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("relay stream proxy addr: {e}"))?;
    let bound = addr.port();

    let app = Router::new().fallback(any(proxy_fallback));
    // Publish the port only after the listener has been bound, but before the
    // serve task is spawned. If `axum::serve` fails immediately, its cleanup
    // compare-exchange below can reliably clear this exact generation; doing
    // the store after `spawn` left a race where a fast failure was overwritten
    // by the stale port value.
    LISTEN_PORT.store(bound, Ordering::SeqCst);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(target: "relay_stream_proxy", "serve error: {e}");
        }
        // A bound port is not useful after the serving task exits, whether it
        // returns an error or a graceful `Ok(())`. Clear only this generation
        // so a newer listener cannot be invalidated by an old task.
        let _ = LISTEN_PORT.compare_exchange(bound, 0, Ordering::SeqCst, Ordering::SeqCst);
    });

    tracing::info!(
        target: "relay_stream_proxy",
        port = bound,
        "OpenAI stream-sanitize proxy on 127.0.0.1:{bound}"
    );
    Ok(bound)
}

/// Blocking wrapper for sync provider writers / startup repair.
///
/// Safe to call from:
/// - plain sync code (no Tokio context)
/// - `spawn_blocking` threads
/// - async tasks **after** the proxy is already up (fast path — no nested runtime)
///
/// Never calls `block_on` on a Tokio worker thread (that panics:
/// "Cannot start a runtime from within a runtime"). When the port is not yet
/// bound and we are already inside a runtime, start on a dedicated OS thread.
pub fn ensure_started_blocking() -> Result<u16, String> {
    let port = LISTEN_PORT.load(Ordering::SeqCst);
    if port != 0 {
        return Ok(port);
    }

    // Nested `block_on` on a multi-thread worker panics. Detect a current
    // Handle and offload to a fresh OS thread that may safely enter the
    // Tauri global runtime.
    if tokio::runtime::Handle::try_current().is_ok() {
        return std::thread::Builder::new()
            .name("relay-proxy-start".into())
            .spawn(|| tauri::async_runtime::block_on(ensure_started()))
            .map_err(|e| format!("relay stream proxy start spawn: {e}"))?
            .join()
            .map_err(|_| "relay stream proxy start thread panicked".to_string())?;
    }

    tauri::async_runtime::block_on(ensure_started())
}

/// Local base_url written into agent-home for a provider that needs sanitizing.
pub fn local_proxy_base_url(provider_id: &str, port: u16) -> String {
    let id = provider_id.trim().trim_matches('/');
    format!("http://127.0.0.1:{port}/r/{id}/v1")
}

/// Resolve real upstream for display / proxy (prefer app_upstream_base_url).
pub fn effective_upstream_base(fields: &HashMap<String, String>) -> String {
    fields
        .get(APP_UPSTREAM_BASE_URL_KEY)
        .cloned()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| fields.get("base_url").cloned())
        .unwrap_or_default()
}

/// Given user-facing base_url + id, return (cli_base_url, optional_upstream_to_store).
///
/// When sanitizing is needed, `cli_base_url` is loopback and `Some(real)` is the
/// true OpenCode/Zen endpoint (stored as `app_upstream_base_url`).
pub fn rewrite_base_for_cli(
    provider_id: &str,
    user_base_url: &str,
    api_backend: &str,
    full_path: bool,
) -> Result<(String, Option<String>), String> {
    let real = crate::providers::normalize_openai_base_url(user_base_url, api_backend, full_path);
    if real.is_empty() {
        return Ok((real, None));
    }
    // Already pointed at our proxy (and caller keeps existing upstream key).
    if is_local_sanitize_proxy_url(&real) {
        return Ok((real, None));
    }
    if !host_needs_stream_sanitize(&real) {
        return Ok((real, None));
    }
    let port = ensure_started_blocking()?;
    let local = local_proxy_base_url(provider_id, port);
    Ok((local, Some(real)))
}

/// True for `http://127.0.0.1:{port}/r/{id}/v1` style bases.
pub fn is_local_sanitize_proxy_url(base_url: &str) -> bool {
    let u = base_url.trim().to_ascii_lowercase();
    (u.contains("127.0.0.1") || u.contains("localhost")) && u.contains("/r/")
}

/// Re-write all custom sections that need sanitizing (startup / list repair).
pub fn repair_sanitize_proxy_bases() -> Result<bool, String> {
    let path = crate::paths::agent_config_toml();
    if !path.is_file() {
        return Ok(false);
    }
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let sections = crate::providers::parse_model_sections_for_proxy(&text);
    let mut out = text.clone();
    let mut changed = false;
    for s in sections {
        if crate::providers::is_app_model_child(&s.fields) {
            // Per-model alias sections mirror their provider's base_url. Only the
            // provider section owns the sanitize-proxy rewrite; touching the
            // aliases would point them at a proxy id that maps back here.
            continue;
        }
        let backend = s
            .fields
            .get("api_backend")
            .map(|x| x.as_str())
            .unwrap_or("chat_completions");
        let displayed = effective_upstream_base(&s.fields);
        if !host_needs_stream_sanitize(&displayed) {
            // Drop stale app_upstream if the host no longer needs sanitizing.
            continue;
        }
        let full_path = crate::providers::base_url_full_path_from_fields(&s.fields);
        let (cli_base, upstream) = rewrite_base_for_cli(&s.id, &displayed, backend, full_path)?;
        let Some(up) = upstream else {
            // Already local — ensure port still matches a live proxy, rebind if needed.
            let cur = s.fields.get("base_url").cloned().unwrap_or_default();
            if is_local_sanitize_proxy_url(&cur) {
                let port = ensure_started_blocking()?;
                let want = local_proxy_base_url(&s.id, port);
                if cur != want {
                    let up_keep = s
                        .fields
                        .get(APP_UPSTREAM_BASE_URL_KEY)
                        .cloned()
                        .unwrap_or_else(|| displayed.clone());
                    out = crate::providers::rewrite_section_base_urls(
                        &out,
                        &s.id,
                        &want,
                        Some(up_keep.as_str()),
                    )?;
                    changed = true;
                }
            }
            continue;
        };
        let cur = s.fields.get("base_url").cloned().unwrap_or_default();
        let cur_up = s
            .fields
            .get(APP_UPSTREAM_BASE_URL_KEY)
            .cloned()
            .unwrap_or_default();
        if cur == cli_base && cur_up == up {
            continue;
        }
        out = crate::providers::rewrite_section_base_urls(&out, &s.id, &cli_base, Some(&up))?;
        changed = true;
    }
    if changed {
        std::fs::write(&path, out).map_err(|e| e.to_string())?;
        tracing::info!(
            target: "relay_stream_proxy",
            "repaired provider base_url(s) via stream-sanitize proxy"
        );
    }
    Ok(changed)
}

async fn proxy_fallback(req: Request) -> Response {
    match proxy_request(req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(target: "relay_stream_proxy", "proxy error: {e}");
            (
                StatusCode::BAD_GATEWAY,
                format!(
                    r#"{{"error":{{"message":{},"type":"proxy_error"}}}}"#,
                    json_escape(&e)
                ),
            )
                .into_response()
        }
    }
}

fn json_escape(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"error\"".into())
}

async fn proxy_request(req: Request) -> Result<Response, String> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri.path();
    let rest = path
        .strip_prefix("/r/")
        .ok_or_else(|| format!("expected /r/{{provider}}/… got {path}"))?;
    let (provider_id, after_id) = rest
        .split_once('/')
        .ok_or_else(|| "missing provider id in path".to_string())?;
    let after_v1 = after_id
        .strip_prefix("v1/")
        .or_else(|| after_id.strip_prefix("v1"))
        .unwrap_or(after_id);
    let upstream_base = lookup_upstream(provider_id)?;
    let upstream_base = upstream_base.trim_end_matches('/');
    let suffix = after_v1.trim_start_matches('/');
    let mut target = if suffix.is_empty() {
        upstream_base.to_string()
    } else {
        format!("{upstream_base}/{suffix}")
    };
    if let Some(q) = uri.query() {
        target.push('?');
        target.push_str(q);
    }

    let headers = filter_request_headers(req.headers());
    let body_bytes = axum::body::to_bytes(req.into_body(), 32 * 1024 * 1024)
        .await
        .map_err(|e| format!("read body: {e}"))?;

    let client = {
        // Do not install a total request deadline: a healthy SSE response may
        // legitimately run for hours. Bound only connection setup and idle
        // reads; the latter resets whenever an upstream chunk arrives.
        let b = reqwest::Client::builder()
            .connect_timeout(RELAY_CONNECT_TIMEOUT)
            .read_timeout(RELAY_STREAM_IDLE_TIMEOUT);
        crate::proxy::apply_to_reqwest(b)
            .build()
            .map_err(|e| e.to_string())?
    };
    let req_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);
    let mut rb = client.request(req_method, &target);
    for (k, v) in headers.iter() {
        if let Ok(name) = reqwest::header::HeaderName::from_bytes(k.as_str().as_bytes()) {
            if let Ok(val) = reqwest::header::HeaderValue::from_bytes(v.as_bytes()) {
                rb = rb.header(name, val);
            }
        }
    }
    if !body_bytes.is_empty() {
        rb = rb.body(body_bytes.to_vec());
    }

    let upstream = rb.send().await.map_err(|e| format!("upstream: {e}"))?;
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_event_stream = content_type.contains("text/event-stream");

    if !is_event_stream {
        let bytes = upstream
            .bytes()
            .await
            .map_err(|e| format!("upstream body: {e}"))?;
        return Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, content_type.as_str())
            .body(Body::from(bytes))
            .map_err(|e| e.to_string());
    }

    // Byte pending holds incomplete UTF-8 across chunk boundaries; line_buf is
    // fully decoded text ready for SSE event framing (`\n\n`).
    let byte_stream = upstream.bytes_stream();
    let filtered = async_stream::stream! {
        let mut stream = byte_stream;
        let mut utf8_pending: Vec<u8> = Vec::new();
        let mut line_buf = String::new();
        loop {
            let item = match tokio::time::timeout(RELAY_STREAM_IDLE_TIMEOUT, stream.next()).await {
                Ok(item) => item,
                Err(_) => {
                    let msg = "upstream SSE idle timeout";
                    tracing::warn!(target: "relay_stream_proxy", "{msg}");
                    yield Ok::<Bytes, Infallible>(Bytes::from(format_sse_error(msg)));
                    break;
                }
            };
            let Some(item) = item else { break };
            match item {
                Ok(chunk) => {
                    push_utf8_stream(&mut utf8_pending, &chunk, &mut line_buf);
                    while let Some((pos, delimiter_len)) = find_sse_event_end(&line_buf) {
                        let end = pos + delimiter_len;
                        let event = line_buf[..end].to_string();
                        line_buf = line_buf[end..].to_string();
                        let kept = filter_sse_event(&event);
                        if !kept.is_empty() {
                            yield Ok::<Bytes, Infallible>(Bytes::from(kept));
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(target: "relay_stream_proxy", "upstream stream: {e}");
                    yield Ok::<Bytes, Infallible>(Bytes::from(format_sse_error(&format!("upstream SSE read failed: {e}"))));
                    break;
                }
            }
        }
        // Flush any leftover incomplete UTF-8 as lossy (stream ended mid-char).
        if !utf8_pending.is_empty() {
            line_buf.push_str(&String::from_utf8_lossy(&utf8_pending));
            utf8_pending.clear();
        }
        if !line_buf.is_empty() {
            let kept = filter_sse_event(&line_buf);
            if !kept.is_empty() {
                yield Ok::<Bytes, Infallible>(Bytes::from(kept));
            }
        }
    };

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(filtered))
        .map_err(|e| e.to_string())
}

/// Return the first complete SSE event boundary, accepting both the LF form
/// emitted by most providers and the strict CRLF form required by the SSE spec.
fn find_sse_event_end(input: &str) -> Option<(usize, usize)> {
    let lf = input.find("\n\n").map(|pos| (pos, 2));
    let crlf = input.find("\r\n\r\n").map(|pos| (pos, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn format_sse_error(message: &str) -> String {
    let payload = serde_json::json!({
        "error": {
            "message": message,
            "type": "upstream_stream_error"
        }
    });
    format!("event: error\ndata: {payload}\n\n")
}

fn filter_request_headers(src: &HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (k, v) in src.iter() {
        let name = k.as_str().to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding" | "accept-encoding"
        ) {
            continue;
        }
        out.insert(k.clone(), v.clone());
    }
    out
}

fn lookup_upstream(provider_id: &str) -> Result<String, String> {
    let path = crate::paths::agent_config_toml();
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let sections = crate::providers::parse_model_sections_for_proxy(&text);
    let sec = sections
        .iter()
        .find(|s| s.id == provider_id)
        .ok_or_else(|| format!("unknown provider `{provider_id}` for proxy"))?;
    let up = effective_upstream_base(&sec.fields);
    if up.is_empty() {
        return Err(format!("provider `{provider_id}` has no upstream base_url"));
    }
    if is_local_sanitize_proxy_url(&up) {
        return Err(format!(
            "provider `{provider_id}` missing {APP_UPSTREAM_BASE_URL_KEY}"
        ));
    }
    Ok(up)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_opencode_cost_frame() {
        let raw = r#"{"choices":[],"x-opencode-type":"inference-cost","cost":"0.0003"}"#;
        assert!(should_drop_sse_data_payload(raw));
    }

    #[test]
    fn drops_live_opencode_cost_trailer() {
        // Exact shape from Grok Build stderr (missing `id` → ChatCompletionChunk fail).
        let raw = r#"{"choices":[],"x-opencode-type":"inference-cost","cost":"0.00033520","normalizedUsage":{"inputTokens":59,"outputTokens":17,"reasoningTokens":48,"cacheReadTokens":384,"cacheWrite5mTokens":0,"cacheWrite1hTokens":0}}"#;
        assert!(should_drop_sse_data_payload(raw));
    }

    #[test]
    fn drops_ping() {
        assert!(should_drop_sse_data_payload(
            r#"{"type":"ping","cost":"0"}"#
        ));
    }

    #[test]
    fn keeps_normal_chunk() {
        let raw =
            r#"{"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"}}]}"#;
        assert!(!should_drop_sse_data_payload(raw));
    }

    #[test]
    fn keeps_done() {
        assert!(!should_drop_sse_data_payload("[DONE]"));
    }

    #[test]
    fn filter_event_drops_cost() {
        let ev = "data: {\"choices\":[],\"x-opencode-type\":\"inference-cost\",\"cost\":\"1\"}\n\n";
        assert!(filter_sse_event(ev).is_empty());
    }

    #[test]
    fn filter_event_keeps_chunk() {
        let ev = "data: {\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[]}\n\n";
        let out = filter_sse_event(ev);
        assert!(out.contains("chat.completion.chunk"));
    }

    #[test]
    fn finds_lf_and_crlf_event_boundaries() {
        assert_eq!(find_sse_event_end("data: x\n\nrest"), Some((7, 2)));
        assert_eq!(find_sse_event_end("data: x\r\n\r\nrest"), Some((7, 4)));
        assert_eq!(find_sse_event_end("data: x\nrest"), None);
    }

    #[test]
    fn structured_stream_error_is_sse() {
        let out = format_sse_error("upstream broke");
        assert!(out.starts_with("event: error\n"));
        assert!(out.contains("upstream broke"));
        assert!(out.ends_with("\n\n"));
    }

    #[test]
    fn host_detects_opencode() {
        assert!(host_needs_stream_sanitize("https://opencode.ai/zen/go/v1"));
        assert!(!host_needs_stream_sanitize("https://api.deepseek.com/v1"));
    }

    #[test]
    fn ensure_started_blocking_fast_path_when_port_set() {
        // Do not start a real listener — only exercise the AtomicU16 short-circuit
        // so nested block_on is never attempted in unit tests.
        let prev = LISTEN_PORT.swap(54321, Ordering::SeqCst);
        let got = ensure_started_blocking().expect("fast path");
        assert_eq!(got, 54321);
        LISTEN_PORT.store(prev, Ordering::SeqCst);
    }

    #[test]
    fn utf8_stream_survives_cjk_split_mid_char() {
        // Session 2ef3bf77: proxy used from_utf8_lossy per chunk → 帮��处理.
        let text = "帮你处理自动化流程定时任务";
        let bytes = text.as_bytes();
        let mut pending = Vec::new();
        let mut out = String::new();
        // Split every byte so every multi-byte CJK char is fragmented.
        for b in bytes {
            push_utf8_stream(&mut pending, &[*b], &mut out);
        }
        assert!(pending.is_empty());
        assert_eq!(out, text);
        assert!(!out.contains('\u{FFFD}'));
    }

    #[test]
    fn utf8_stream_lossy_per_chunk_would_mojibake() {
        // Document the old bug: independent lossy decode corrupts CJK.
        let text = "帮你";
        let bytes = text.as_bytes();
        // Split after first byte of 帮 (E5, should be E5 B8 AE).
        let a = &bytes[..1];
        let b = &bytes[1..];
        let broken = format!(
            "{}{}",
            String::from_utf8_lossy(a),
            String::from_utf8_lossy(b)
        );
        assert!(broken.contains('\u{FFFD}') || broken != text);

        let mut pending = Vec::new();
        let mut out = String::new();
        push_utf8_stream(&mut pending, a, &mut out);
        push_utf8_stream(&mut pending, b, &mut out);
        assert_eq!(out, text);
    }
}
