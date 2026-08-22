//! Side-browser download takeover (generic; not ChatCut-only).
//!
//! ## What is generic vs site-specific
//!
//! | Path | Trigger (any site) | Host action |
//! |------|--------------------|-------------|
//! | `blob:` / `data:` | injected JS hooks | FileReader → save dialog → write |
//! | `http(s)` + `download` / iframe / file-like URL | same hooks | reqwest → save dialog → stream |
//! | Authenticated API (e.g. ChatCut) | same hooks | WebView **cookies** on first hop, then public redirect (S3) **without** cookies |
//!
//! ChatCut is only special in that `/api/.../download` needs session cookies and
//! 302s to a short-lived S3 URL. Public CDN / static files need no cookies.
//!
//! ```text
//! page click / a[download] / hidden iframe
//!        │
//!        ▼
//!   JS interceptor (injected, any origin)
//!        │
//!   ┌────┴────────────────────┐
//!   │                         │
//! http(s) URL              blob: / data:
//!   │                         │
//!   ▼                         ▼
//! title + sbdl GET       FileReader → base64 in page
//!        │                    │
//!        └──────────┬─────────┘
//!                   ▼
//!            native save dialog
//!                   ▼
//!         Rust write / stream to path
//! ```

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine;
use parking_lot::Mutex;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::side_browser_host::{emit_download_payload, SideBrowserDownloadPayload};

const TITLE_BLOB_PREFIX: &str = "__GROK_SBDL__";
const TITLE_URL_PREFIX: &str = "__GROK_DL_URL__";
const MAX_BLOB_BYTES: usize = 1_500 * 1024 * 1024;
const PULL_CHUNK_B64: usize = 512 * 1024;
const MAX_HTTP_DOWNLOAD_BYTES: u64 = 1_500 * 1024 * 1024;

static SAVE_SEQ: AtomicU64 = AtomicU64::new(1);
/// Dedupe concurrent title + Image signals for the same blob id / url.
static INFLIGHT: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn is_download_signal_title(title: &str) -> bool {
    title.starts_with(TITLE_BLOB_PREFIX) || title.starts_with(TITLE_URL_PREFIX)
}

/// Handle `document.title` signals from the polyfill.
pub fn handle_title_signal(app: &AppHandle, webview_label: &str, title: &str) {
    if let Some(rest) = title.strip_prefix(TITLE_URL_PREFIX) {
        // `__GROK_DL_URL__|{fileName}|{url}`  (url may contain `|` rarely — split once)
        let rest = rest.strip_prefix('|').unwrap_or(rest);
        let (name, url) = match rest.split_once('|') {
            Some((n, u)) => (n, u),
            None => return,
        };
        spawn_http_download(app, webview_label, url.to_string(), sanitize_filename(name));
        return;
    }

    let rest = match title.strip_prefix(TITLE_BLOB_PREFIX) {
        Some(r) if r.starts_with('|') => &r[1..],
        _ => return,
    };
    let mut parts = rest.splitn(3, '|');
    let id = match parts.next() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return,
    };
    let b64_len: usize = match parts.next().and_then(|s| s.parse().ok()) {
        Some(n) => n,
        None => return,
    };
    let file_name = sanitize_filename(parts.next().unwrap_or("download.bin"));
    spawn_blob_pull(app, webview_label, id, b64_len, file_name);
}

fn try_begin(key: String) -> bool {
    INFLIGHT.lock().insert(key)
}

fn end_inflight(key: &str) {
    INFLIGHT.lock().remove(key);
}

fn spawn_blob_pull(
    app: &AppHandle,
    webview_label: &str,
    id: String,
    b64_len: usize,
    file_name: String,
) {
    if b64_len == 0 || b64_len > MAX_BLOB_BYTES * 4 / 3 + 64 {
        tracing::warn!(
            target: "side_browser",
            %webview_label,
            b64_len,
            "blob pull rejected (size)"
        );
        return;
    }
    let key = format!("blob:{webview_label}:{id}");
    if !try_begin(key.clone()) {
        tracing::debug!(target: "side_browser", %id, "blob pull already in flight");
        return;
    }

    tracing::info!(
        target: "side_browser",
        %webview_label,
        %id,
        %file_name,
        b64_len,
        "blob pull start"
    );

    emit_download_payload(
        app,
        SideBrowserDownloadPayload {
            phase: "requested".into(),
            label: webview_label.to_string(),
            url: format!("blob-download:{file_name}"),
            path: None,
            success: None,
            file_name: Some(file_name.clone()),
        },
    );

    let app = app.clone();
    let label = webview_label.to_string();
    let id_for_thread = id.clone();
    let _ = std::thread::Builder::new()
        .name("sbdl-blob-pull".into())
        .spawn(move || {
            let result = pull_blob_and_save(&app, &label, &id_for_thread, b64_len, &file_name);
            end_inflight(&key);
            match result {
                Ok(path) => finish_ok(&app, &label, &file_name, path),
                Err(e) if e == "cancelled" => {
                    emit_download_payload(
                        &app,
                        SideBrowserDownloadPayload {
                            phase: "cancelled".into(),
                            label: label.clone(),
                            url: format!("blob-download:{file_name}"),
                            path: None,
                            success: Some(false),
                            file_name: Some(file_name),
                        },
                    );
                }
                Err(e) => finish_err(&app, &label, &file_name, &e, Some(&id_for_thread)),
            }
        });
}

fn spawn_http_download(app: &AppHandle, webview_label: &str, url: String, file_name: String) {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        tracing::warn!(target: "side_browser", %url, "http download rejected (scheme)");
        return;
    }
    // Signed S3 URLs can be long (query + security token).
    if url.len() > 32_000 {
        tracing::warn!(target: "side_browser", len = url.len(), "http download rejected (url too long)");
        return;
    }

    // Dedupe by render/download path (ignore query noise).
    let dedupe_key = url.split('?').next().unwrap_or(&url).to_string();
    let key = format!("url:{webview_label}:{dedupe_key}");
    if !try_begin(key.clone()) {
        tracing::info!(
            target: "side_browser",
            %webview_label,
            "http download already in progress — wait for current transfer"
        );
        return;
    }

    // Prefer filename embedded in signed S3 query (ChatCut export).
    let mut file_name = file_name;
    if file_name == "download.bin" || file_name == "download" {
        if let Some(n) = filename_from_url_query(&url) {
            file_name = n;
        }
    }

    // Collect WebView cookies *before* worker (auth for api.chatcut.io).
    let cookie = cookie_header_for_download(app, webview_label, &url);

    tracing::info!(
        target: "side_browser",
        %webview_label,
        %file_name,
        url = %url.chars().take(120).collect::<String>(),
        has_cookie = cookie.is_some(),
        "http download start (Rust reqwest)"
    );

    emit_download_payload(
        app,
        SideBrowserDownloadPayload {
            phase: "requested".into(),
            label: webview_label.to_string(),
            url: url.clone(),
            path: None,
            success: None,
            file_name: Some(file_name.clone()),
        },
    );

    let app = app.clone();
    let label = webview_label.to_string();
    let _ = std::thread::Builder::new()
        .name("sbdl-http-dl".into())
        .spawn(move || {
            let result =
                http_download_to_downloads(&app, &label, &url, &file_name, cookie.as_deref());
            end_inflight(&key);
            match result {
                Ok(path) => finish_ok(&app, &label, &file_name, path),
                Err(e) if e == "cancelled" => {
                    emit_download_payload(
                        &app,
                        SideBrowserDownloadPayload {
                            phase: "cancelled".into(),
                            label: label.clone(),
                            url: url.clone(),
                            path: None,
                            success: Some(false),
                            file_name: Some(file_name),
                        },
                    );
                }
                Err(e) => finish_err(&app, &label, &file_name, &e, None),
            }
        });
}

/// Native save dialog (suggested name). `None` = user cancelled.
fn pick_save_path(app: &AppHandle, webview_label: &str, suggested: &str) -> Option<PathBuf> {
    let suggested = sanitize_filename(suggested);
    let mut dlg = rfd::FileDialog::new()
        .set_title("Save file / 保存文件")
        .set_file_name(&suggested);

    // Prefer the hosting window so the sheet appears above the child webview.
    if let Some(wv) = app.get_webview(webview_label) {
        let win = wv.window();
        dlg = dlg.set_parent(&win);
    } else if let Some(win) = app.get_window("main") {
        dlg = dlg.set_parent(&win);
    }

    // Default directory: system Downloads (user can still navigate away).
    let dl = system_downloads_dir();
    if dl.is_dir() {
        dlg = dlg.set_directory(&dl);
    }

    tracing::info!(
        target: "side_browser",
        %webview_label,
        %suggested,
        "save dialog open"
    );
    let chosen = dlg.save_file();
    if chosen.is_none() {
        tracing::info!(target: "side_browser", %webview_label, "save dialog cancelled");
    }
    chosen
}

/// Build Cookie header from the side-browser WebView store (HTTP-only included).
fn cookie_header_for_download(app: &AppHandle, label: &str, url: &str) -> Option<String> {
    let wv = app.get_webview(label)?;
    let mut jar: Vec<(String, String)> = Vec::new();

    let mut try_url = |u: &str| {
        if let Ok(parsed) = url::Url::parse(u) {
            if let Ok(cookies) = wv.cookies_for_url(parsed) {
                for c in cookies {
                    let name = c.name().to_string();
                    let value = c.value().to_string();
                    if name.is_empty() {
                        continue;
                    }
                    if !jar.iter().any(|(n, _)| n == &name) {
                        jar.push((name, value));
                    }
                }
            }
        }
    };

    try_url(url);
    // ChatCut: page on app.* API on api.*
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            if host.contains("chatcut") {
                try_url("https://api.chatcut.io/");
                try_url("https://app.chatcut.io/");
                try_url("https://www.chatcut.io/");
            }
            // Always try origin root
            let origin = format!("{}://{}/", parsed.scheme(), host);
            try_url(&origin);
        }
    }

    if jar.is_empty() {
        // Last resort: all cookies in the store (can be large; filter to chatcut hosts).
        if let Ok(all) = wv.cookies() {
            for c in all {
                let domain = c.domain().unwrap_or("").to_string();
                if domain.contains("chatcut") || url.contains(domain.trim_start_matches('.')) {
                    let name = c.name().to_string();
                    let value = c.value().to_string();
                    if !name.is_empty() && !jar.iter().any(|(n, _)| n == &name) {
                        jar.push((name, value));
                    }
                }
            }
        }
    }

    if jar.is_empty() {
        return None;
    }
    Some(
        jar.into_iter()
            .map(|(n, v)| format!("{n}={v}"))
            .collect::<Vec<_>>()
            .join("; "),
    )
}

/// Parse `response-content-disposition` / `filename` from a signed URL query.
fn filename_from_url_query(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    for (k, v) in u.query_pairs() {
        let key = k.to_ascii_lowercase();
        if key == "response-content-disposition" || key == "filename" {
            // attachment; filename*=UTF-8''%E6%96%B0...
            if let Some(n) = parse_content_disposition_filename(&v) {
                // ChatCut double-encodes filename* value
                let n = urlencoding_decode(&n).unwrap_or(n);
                let n = urlencoding_decode(&n).unwrap_or(n);
                return Some(sanitize_filename(&n));
            }
            if key == "filename" {
                return Some(sanitize_filename(&v));
            }
        }
    }
    // path segment fallback
    u.path_segments()
        .and_then(|mut s| s.next_back())
        .map(|s| s.to_string())
        .filter(|s| s.contains('.') && s != "download" && s != "out.mp4")
        .map(|s| sanitize_filename(&s))
}

fn finish_ok(app: &AppHandle, label: &str, file_name: &str, path: PathBuf) {
    tracing::info!(
        target: "side_browser",
        %label,
        path = %path.display(),
        "download saved"
    );
    crate::path_scope::grant_path(&path);
    let path_s = path.display().to_string();
    // Shared reveal: macOS open -R / Windows explorer /select / Linux ShowItems.
    // Do not use process_util::command (CREATE_NO_WINDOW breaks explorer select).
    let _ = crate::process_util::reveal_in_file_manager(&path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_name)
        .to_string();
    emit_download_payload(
        app,
        SideBrowserDownloadPayload {
            phase: "finished".into(),
            label: label.to_string(),
            url: format!("download:{name}"),
            path: Some(path_s),
            success: Some(true),
            file_name: Some(name),
        },
    );
}

fn finish_err(app: &AppHandle, label: &str, file_name: &str, err: &str, blob_id: Option<&str>) {
    tracing::warn!(target: "side_browser", %label, error = %err, "download failed");
    if let Some(id) = blob_id {
        let id_js = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into());
        let cleanup = format!(
            r#"(function(){{try{{delete window.__grokSbdlData[{id_js}];}}catch(e){{}}}})()"#
        );
        let _ = crate::side_browser_host::eval(app, label.to_string(), cleanup);
    }
    emit_download_payload(
        app,
        SideBrowserDownloadPayload {
            phase: "finished".into(),
            label: label.to_string(),
            url: format!("download:{file_name}"),
            path: None,
            success: Some(false),
            file_name: Some(file_name.to_string()),
        },
    );
}

/// Rust-owned HTTP(S) download — no WebView CORS.
///
/// **Do not** auto-follow redirects while holding session cookies: reqwest would
/// forward `Cookie` to CDN/S3. Instead: cookies only on first-party hosts, then
/// public redirect target without cookies. Save path via native dialog.
fn http_download_to_downloads(
    app: &AppHandle,
    webview_label: &str,
    url: &str,
    file_name: &str,
    cookie_header: Option<&str>,
) -> Result<PathBuf, String> {
    let start_url = url.to_string();
    let mut file_name = file_name.to_string();
    if let Some(n) = filename_from_url_query(&start_url) {
        if file_name == "download.bin" || file_name == "download" {
            file_name = n;
        }
    }
    let cookie_header = cookie_header.map(|s| s.to_string());
    let app = app.clone();
    let webview_label = webview_label.to_string();

    tauri::async_runtime::block_on(async move {
        // HTTP/1.1 only: some long presigned S3 URLs misbehave under h2.
        let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .http1_only()
            .build()
            .map_err(|e| format!("client: {e}"))?;

        let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

        let mut current = start_url;
        let mut name = file_name;

        for hop in 0..8 {
            let host_l = url::Url::parse(&current)
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
                .unwrap_or_default();
            // Public object stores / CDNs: never forward first-party session cookies.
            let host_is_object_store = host_l.contains("amazonaws.com")
                || host_l.contains(".s3.")
                || host_l.contains("cloudfront.net")
                || host_l.contains("r2.cloudflarestorage.com")
                || host_l.contains("blob.core.windows.net")
                || host_l.contains("storage.googleapis.com");
            // Attach WebView cookies only on first-party / API hosts (any site, not just ChatCut).
            let send_cookie = cookie_header.is_some() && !host_is_object_store;

            let mut req = client.get(&current).header(reqwest::header::USER_AGENT, ua);
            // Minimal headers on signed object URLs (often only `host` is signed).
            if !host_is_object_store {
                req = req.header(reqwest::header::ACCEPT, "*/*");
            }
            if send_cookie {
                if let Some(ref c) = cookie_header {
                    req = req.header(reqwest::header::COOKIE, c);
                }
            }

            tracing::info!(
                target: "side_browser",
                hop,
                url_len = current.len(),
                url = %current.chars().take(160).collect::<String>(),
                with_cookie = send_cookie,
                "http download hop"
            );

            let response = req
                .send()
                .await
                .map_err(|e| format!("request hop{hop}: {e}"))?;
            let status = response.status();
            tracing::info!(
                target: "side_browser",
                hop,
                %status,
                "http download response headers"
            );

            if status.is_redirection() {
                let loc = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| format!("HTTP {status} without Location"))?;
                let next = url::Url::parse(&current)
                    .ok()
                    .and_then(|base| base.join(loc).ok())
                    .map(|u| u.to_string())
                    .unwrap_or_else(|| loc.to_string());
                if let Some(n) = filename_from_url_query(&next) {
                    name = n;
                }
                tracing::info!(
                    target: "side_browser",
                    hop,
                    next_len = next.len(),
                    next = %next.chars().take(160).collect::<String>(),
                    "http download redirect"
                );
                drop(response);
                current = next;
                continue;
            }

            if !status.is_success() {
                return Err(format!("HTTP {status} at hop {hop}"));
            }

            if let Some(cd) = response.headers().get(reqwest::header::CONTENT_DISPOSITION) {
                if let Ok(s) = cd.to_str() {
                    if let Some(n) = parse_content_disposition_filename(s) {
                        name = sanitize_filename(&n);
                    }
                }
            }
            if let Some(n) = filename_from_url_query(&current) {
                if name == "download.bin" || name == "download" || name == "out.mp4" {
                    name = n;
                }
            }

            let content_len = response.content_length();
            if let Some(len) = content_len {
                if len > MAX_HTTP_DOWNLOAD_BYTES {
                    return Err(format!("too large: {len} bytes"));
                }
            }

            // Ask user where to save (after we know the final name from headers/URL).
            // Do this before streaming so cancel doesn't waste a full transfer…
            // (S3 signed URLs may expire if the user waits too long on the dialog.)
            let dest = match pick_save_path(&app, &webview_label, &name) {
                Some(p) => p,
                None => return Err("cancelled".into()),
            };
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            crate::path_scope::grant_path(&dest);

            tracing::info!(
                target: "side_browser",
                hop,
                content_len = ?content_len,
                %name,
                dest = %dest.display(),
                "http download reading body (stream → chosen path)"
            );

            let mut tmp_os = dest.as_os_str().to_os_string();
            tmp_os.push(".part");
            let tmp = PathBuf::from(tmp_os);

            {
                use futures_util::StreamExt;
                use std::io::Write as _;
                let mut stream = response.bytes_stream();
                let mut file =
                    std::fs::File::create(&tmp).map_err(|e| format!("create part: {e}"))?;
                let mut written: u64 = 0;
                let mut last_log: u64 = 0;
                let mut first = true;
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|e| format!("stream: {e}"))?;
                    if first {
                        first = false;
                        tracing::info!(
                            target: "side_browser",
                            first_chunk = chunk.len(),
                            "http download first byte"
                        );
                    }
                    file.write_all(&chunk)
                        .map_err(|e| format!("write part: {e}"))?;
                    written += chunk.len() as u64;
                    if written > MAX_HTTP_DOWNLOAD_BYTES {
                        let _ = std::fs::remove_file(&tmp);
                        return Err("too large".into());
                    }
                    if written - last_log >= 2 * 1024 * 1024 {
                        last_log = written;
                        tracing::info!(
                            target: "side_browser",
                            written,
                            content_len = ?content_len,
                            "http download progress"
                        );
                    }
                }
                file.flush().map_err(|e| format!("flush part: {e}"))?;
                if written == 0 {
                    let _ = std::fs::remove_file(&tmp);
                    return Err("empty body".into());
                }
                tracing::info!(
                    target: "side_browser",
                    written,
                    %name,
                    "http download body ok"
                );
            }

            std::fs::rename(&tmp, &dest).or_else(|_| {
                std::fs::copy(&tmp, &dest)
                    .map(|_| {
                        let _ = std::fs::remove_file(&tmp);
                    })
                    .map_err(|e| format!("finalize: {e}"))
            })?;
            return Ok(dest);
        }

        Err("too many redirects".into())
    })
}

fn parse_content_disposition_filename(cd: &str) -> Option<String> {
    // attachment; filename*=UTF-8''%E6%96%B0...  or filename="clip.mp4"
    for part in cd.split(';') {
        let p = part.trim();
        let lower = p.to_ascii_lowercase();
        if lower.starts_with("filename*=") {
            let rest = p.split_once('=')?.1.trim().trim_matches('"');
            // UTF-8''percent-encoded  OR charset'lang'value
            let encoded = rest.split_once("''").map(|(_, e)| e).unwrap_or(rest);
            let mut name = urlencoding_decode(encoded).unwrap_or_else(|| encoded.to_string());
            // ChatCut double-encodes in signed URL query
            if name.contains('%') {
                name = urlencoding_decode(&name).unwrap_or(name);
            }
            if !name.is_empty() {
                return Some(name);
            }
        }
        if lower.starts_with("filename=") && !lower.starts_with("filename*=") {
            let rest = p.split_once('=')?.1.trim().trim_matches('"');
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn pull_blob_and_save(
    app: &AppHandle,
    label: &str,
    id: &str,
    b64_len: usize,
    file_name: &str,
) -> Result<PathBuf, String> {
    let id_js = serde_json::to_string(id).map_err(|e| e.to_string())?;
    let mut b64 = String::with_capacity(b64_len + 8);
    let mut offset = 0usize;
    while offset < b64_len {
        let end = (offset + PULL_CHUNK_B64).min(b64_len);
        let script = format!(
            r#"(function(){{
  try {{
    var d = window.__grokSbdlData && window.__grokSbdlData[{id}];
    if (!d || typeof d !== 'string') return '';
    return d.substring({offset},{end});
  }} catch (e) {{ return ''; }}
}})()"#,
            id = id_js,
            offset = offset,
            end = end,
        );
        let raw = crate::side_browser_host::eval(app, label.to_string(), script)?;
        let chunk = decode_eval_string_result(&raw);
        if chunk.is_empty() && end > offset {
            return Err(format!(
                "empty chunk at {offset}..{end} (raw starts {:?})",
                raw.chars().take(48).collect::<String>()
            ));
        }
        b64.push_str(&chunk);
        offset = end;
    }

    let cleanup = format!(
        r#"(function(){{try{{delete window.__grokSbdlData[{id}];}}catch(e){{}}}})()"#,
        id = id_js
    );
    let _ = crate::side_browser_host::eval(app, label.to_string(), cleanup);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("base64: {e}"))?;
    if bytes.is_empty() {
        return Err("empty payload".into());
    }
    if bytes.len() > MAX_BLOB_BYTES {
        return Err("too large".into());
    }

    let dest = match pick_save_path(app, label, file_name) {
        Some(p) => p,
        None => return Err("cancelled".into()),
    };
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    write_all_atomic(&dest, &bytes)?;
    crate::path_scope::grant_path(&dest);
    Ok(dest)
}

fn decode_eval_string_result(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() || t == "null" || t == "undefined" {
        return String::new();
    }
    if let Ok(s) = serde_json::from_str::<String>(t) {
        return s;
    }
    t.trim_matches('"').to_string()
}

/// Injected interceptor.
///
/// ChatCut `Xx(url, filename)`:
/// - same-origin / blob / data → `<a download>` + click (then revokeObjectURL)
/// - cross-origin → **hidden iframe** (our old a-only hooks missed this)
///
/// Auth: same-origin API download needs cookies → fetch in-page with
/// `credentials:"include"`, then FileReader bridge. Cross-origin falls back to
/// Rust reqwest (signed CDN URLs usually work without cookies).
pub fn blob_download_polyfill(label: &str) -> String {
    let label_js = serde_json::to_string(label).unwrap_or_else(|_| "\"resource-browser\"".into());
    // Use r## so JS like split("#") does not terminate the raw string.
    format!(
        r##"(function () {{
  var LABEL = {label_js};
  if (window.__grokSbdlInstalled) {{
    window.__grokSbdlLabel = LABEL;
    return;
  }}
  window.__grokSbdlData = {{}};
  window.__grokSbdlBlobMap = new Map();
  window.__grokSbdlSeq = 1;
  window.__grokSbdlRecent = Object.create(null);

  function dedupe(key) {{
    var now = Date.now();
    if (window.__grokSbdlRecent[key] && now - window.__grokSbdlRecent[key] < 2500) return true;
    window.__grokSbdlRecent[key] = now;
    return false;
  }}

  try {{
    var origCreate = URL.createObjectURL.bind(URL);
    var origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {{
      var url = origCreate(obj);
      try {{
        if (obj && typeof Blob !== "undefined" && obj instanceof Blob) {{
          window.__grokSbdlBlobMap.set(url, obj);
        }}
      }} catch (e) {{}}
      return url;
    }};
    URL.revokeObjectURL = function (url) {{
      // Keep map entry until after click handlers; delete async.
      var u = url;
      setTimeout(function () {{
        try {{ window.__grokSbdlBlobMap.delete(u); }} catch (e) {{}}
      }}, 3000);
      return origRevoke(url);
    }};
  }} catch (e) {{}}

  function guessName(name, blob, href) {{
    var n = (name && String(name).trim()) || "";
    if (n) return n;
    if (blob && blob.type) {{
      var t = String(blob.type);
      if (t.indexOf("mp4") >= 0) return "download.mp4";
      if (t.indexOf("webm") >= 0) return "download.webm";
      if (t.indexOf("png") >= 0) return "download.png";
      if (t.indexOf("jpeg") >= 0 || t.indexOf("jpg") >= 0) return "download.jpg";
      if (t.indexOf("pdf") >= 0) return "download.pdf";
      if (t.indexOf("zip") >= 0) return "download.zip";
    }}
    if (href) {{
      try {{
        var path = String(href).split("?")[0].split("#")[0];
        var base = path.split("/").pop() || "";
        if (base && base.indexOf(".") > 0) return decodeURIComponent(base);
      }} catch (e) {{}}
    }}
    return "download.bin";
  }}

  function pingScheme(pathAndQuery) {{
    var roots = ["sbdl://localhost", "http://sbdl.localhost"];
    for (var i = 0; i < roots.length; i++) {{
      try {{
        var img = new Image();
        img.src = roots[i] + pathAndQuery + "&_t=" + Date.now() + "&i=" + i;
      }} catch (e) {{}}
    }}
  }}

  function signalUrlDownload(name, url) {{
    var safeName = String(name || "download.bin").replace(/\|/g, "_");
    if (dedupe("url:" + url)) return;
    try {{
      var prev = document.title;
      document.title = "__GROK_DL_URL__|" + safeName + "|" + url;
      setTimeout(function () {{ try {{ document.title = prev; }} catch (e) {{}} }}, 150);
    }} catch (e) {{}}
    pingScheme(
      "/url?label=" + encodeURIComponent(LABEL) +
      "&name=" + encodeURIComponent(safeName) +
      "&u=" + encodeURIComponent(url)
    );
  }}

  function signalBlobReady(id, b64Len, name) {{
    var safeName = String(name || "download.bin").replace(/\|/g, "_");
    try {{
      var prev = document.title;
      document.title = "__GROK_SBDL__|" + id + "|" + b64Len + "|" + safeName;
      setTimeout(function () {{ try {{ document.title = prev; }} catch (e) {{}} }}, 150);
    }} catch (e) {{}}
    pingScheme(
      "/ready?label=" + encodeURIComponent(LABEL) +
      "&id=" + encodeURIComponent(id) +
      "&len=" + encodeURIComponent(String(b64Len)) +
      "&name=" + encodeURIComponent(safeName)
    );
  }}

  function deliverBlob(blob, filename) {{
    if (!blob) return;
    var name = filename || "download.bin";
    var dkey = "blob:" + name + ":" + (blob.size || 0);
    if (dedupe(dkey)) return;
    var id = String(window.__grokSbdlSeq++);
    window.__grokSbdlLast = {{ id: id, name: name, size: blob.size, at: Date.now(), phase: "reading" }};
    try {{
      var reader = new FileReader();
      reader.onloadend = function () {{
        try {{
          var result = reader.result;
          if (typeof result !== "string") {{
            window.__grokSbdlLast.phase = "fail";
            return;
          }}
          var comma = result.indexOf(",");
          var b64 = comma >= 0 ? result.slice(comma + 1) : result;
          window.__grokSbdlData[id] = b64;
          window.__grokSbdlLast.phase = "signaled";
          window.__grokSbdlLast.b64Len = b64.length;
          signalBlobReady(id, b64.length, name);
        }} catch (e) {{
          try {{ console.warn("[grok-sbdl] reader", e); }} catch (e2) {{}}
        }}
      }};
      reader.onerror = function () {{
        try {{ window.__grokSbdlLast.phase = "fail"; }} catch (e) {{}}
      }};
      reader.readAsDataURL(blob);
    }} catch (e) {{
      try {{ console.warn("[grok-sbdl] deliver", e); }} catch (e2) {{}}
    }}
  }}

  function dataUrlToBlob(href) {{
    var comma = href.indexOf(",");
    if (comma < 0) return null;
    var meta = href.slice(0, comma);
    var data = href.slice(comma + 1);
    var isB64 = /;base64/i.test(meta);
    var mimeMatch = /^data:([^;,]+)/i.exec(meta);
    var mime = (mimeMatch && mimeMatch[1]) || "application/octet-stream";
    if (isB64) {{
      var raw = atob(data);
      var arr = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return new Blob([arr], {{ type: mime }});
    }}
    try {{
      return new Blob([decodeURIComponent(data)], {{ type: mime }});
    }} catch (e) {{
      return new Blob([data], {{ type: mime }});
    }}
  }}

  // HTTP(S): do NOT follow redirects in-page (S3 signed URLs fail CORS with Origin null
  // in WKWebView). Prefer redirect:manual → pass Location to Rust, else Rust + cookies.
  function fetchThenDeliver(href, name) {{
    if (dedupe("fetch:" + href + ":" + name)) return;
    window.__grokSbdlLast = {{ name: name, href: href, phase: "fetch", at: Date.now() }};
    var done = false;
    function toRust(u) {{
      if (done) return;
      done = true;
      signalUrlDownload(name, u || href);
    }}
    try {{
      fetch(href, {{
        credentials: "include",
        mode: "cors",
        redirect: "manual",
        cache: "no-store"
      }})
        .then(function (r) {{
          // Same-origin API often 302 → S3. Location is the signed URL (no CORS on Rust).
          if (r.status >= 300 && r.status < 400) {{
            var loc = r.headers.get("Location") || r.headers.get("location");
            if (loc) {{
              try {{ loc = new URL(loc, href).href; }} catch (e) {{}}
              window.__grokSbdlLast.phase = "redirect";
              window.__grokSbdlLast.location = loc;
              toRust(loc);
              return;
            }}
          }}
          // opaqueredirect / status 0
          if (r.type === "opaqueredirect" || r.status === 0) {{
            toRust(href);
            return;
          }}
          if (r.ok) {{
            return r.blob().then(function (b) {{
              done = true;
              deliverBlob(b, name);
            }});
          }}
          toRust(href);
        }})
        .catch(function (err) {{
          try {{ console.warn("[grok-sbdl] page fetch", err); }} catch (e) {{}}
          toRust(href);
        }});
    }} catch (e) {{
      toRust(href);
    }}
  }}

  function handleHref(href, filename, force) {{
    if (!href || typeof href !== "string") return false;
    var name = guessName(filename, null, href);

    if (href.indexOf("blob:") === 0) {{
      var blob = window.__grokSbdlBlobMap.get(href);
      name = guessName(filename, blob, href);
      if (blob) {{
        deliverBlob(blob, name);
        return true;
      }}
      try {{
        fetch(href)
          .then(function (r) {{ return r.blob(); }})
          .then(function (b) {{ deliverBlob(b, name); }})
          .catch(function (err) {{
            try {{ console.warn("[grok-sbdl] blob fetch", err); }} catch (e) {{}}
          }});
        return true;
      }} catch (e) {{
        return false;
      }}
    }}

    if (href.indexOf("data:") === 0) {{
      try {{
        var b = dataUrlToBlob(href);
        if (!b) return false;
        deliverBlob(b, name);
        return true;
      }} catch (e) {{
        return false;
      }}
    }}

    if (href.indexOf("https://") === 0 || href.indexOf("http://") === 0) {{
      var low = href.toLowerCase();
      var pathLooksFile =
        low.indexOf(".mp4") >= 0 || low.indexOf(".webm") >= 0 || low.indexOf(".mov") >= 0 ||
        low.indexOf(".zip") >= 0 || low.indexOf(".pdf") >= 0 || low.indexOf(".png") >= 0 ||
        low.indexOf(".jpg") >= 0 || low.indexOf(".jpeg") >= 0 || low.indexOf(".gif") >= 0 ||
        low.indexOf(".webp") >= 0 || low.indexOf(".bin") >= 0 || low.indexOf(".wav") >= 0 ||
        low.indexOf(".mp3") >= 0 || low.indexOf(".m4a") >= 0;
      var looksApiDownload =
        low.indexOf("/download") >= 0 || low.indexOf("/export") >= 0 ||
        low.indexOf("/render") >= 0 || low.indexOf("/jobs/") >= 0;
      if (force || pathLooksFile || looksApiDownload) {{
        fetchThenDeliver(href, name);
        return true;
      }}
    }}
    return false;
  }}

  function tryAnchor(a) {{
    if (!a || !a.tagName || String(a.tagName).toUpperCase() !== "A") return false;
    if (a.getAttribute("data-grok-sbdl") === "1") return true;
    var href = "";
    try {{ href = a.href || a.getAttribute("href") || ""; }} catch (e) {{
      href = a.getAttribute("href") || "";
    }}
    var name = "";
    try {{ name = a.getAttribute("download") || a.download || ""; }} catch (e) {{}}
    var hasDl =
      a.hasAttribute("download") ||
      (typeof a.download === "string" && a.download !== "") ||
      href.indexOf("blob:") === 0 ||
      href.indexOf("data:") === 0;
    if (!hasDl) return false;
    var ok = handleHref(href, name, true);
    if (ok) {{
      try {{ a.setAttribute("data-grok-sbdl", "1"); }} catch (e) {{}}
    }}
    return ok;
  }}

  function tryIframeSrc(src) {{
    if (!src || typeof src !== "string") return false;
    if (src === "about:blank" || src.indexOf("javascript:") === 0) return false;
    // ChatCut Xx() fallback: hidden iframe to download URL
    return handleHref(src, "", true);
  }}

  // --- hooks ---
  document.addEventListener(
    "click",
    function (ev) {{
      try {{
        var t = ev.target;
        if (!t || !t.closest) return;
        var a = t.closest("a");
        if (!a) return;
        if (tryAnchor(a)) {{
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        }}
      }} catch (e) {{}}
    }},
    true
  );

  try {{
    var aProto = HTMLAnchorElement.prototype;
    var origAClick = aProto.click;
    aProto.click = function () {{
      try {{
        if (tryAnchor(this)) return;
      }} catch (e) {{}}
      return origAClick.apply(this, arguments);
    }};
  }} catch (e) {{}}

  // Critical: ChatCut does appendChild(a); a.click(); revoke — handle on append
  // BEFORE click/revoke. Also catch iframe download fallback.
  try {{
    var origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {{
      try {{
        if (child && child.tagName) {{
          var tag = String(child.tagName).toUpperCase();
          if (tag === "A") {{
            tryAnchor(child);
          }} else if (tag === "IFRAME") {{
            var s = "";
            try {{ s = child.src || child.getAttribute("src") || ""; }} catch (e) {{}}
            if (s && tryIframeSrc(s)) {{
              try {{ child.removeAttribute("src"); child.src = "about:blank"; }} catch (e2) {{}}
            }}
          }}
        }}
      }} catch (e) {{}}
      return origAppend.apply(this, arguments);
    }};
  }} catch (e) {{}}

  try {{
    var origInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (child, ref) {{
      try {{
        if (child && child.tagName) {{
          var tag = String(child.tagName).toUpperCase();
          if (tag === "A") tryAnchor(child);
          else if (tag === "IFRAME") {{
            var s = "";
            try {{ s = child.src || child.getAttribute("src") || ""; }} catch (e) {{}}
            if (s && tryIframeSrc(s)) {{
              try {{ child.removeAttribute("src"); child.src = "about:blank"; }} catch (e2) {{}}
            }}
          }}
        }}
      }} catch (e) {{}}
      return origInsert.apply(this, arguments);
    }};
  }} catch (e) {{}}

  // iframe.src = url (set after create)
  try {{
    var iframeProto = HTMLIFrameElement.prototype;
    var srcDesc = Object.getOwnPropertyDescriptor(iframeProto, "src") ||
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, "src");
    if (srcDesc && srcDesc.set) {{
      Object.defineProperty(iframeProto, "src", {{
        configurable: true,
        enumerable: true,
        get: srcDesc.get,
        set: function (v) {{
          try {{
            if (v && tryIframeSrc(String(v))) {{
              return srcDesc.set.call(this, "about:blank");
            }}
          }} catch (e) {{}}
          return srcDesc.set.call(this, v);
        }}
      }});
    }}
  }} catch (e) {{}}

  window.__grokSbdlInstalled = true;
  window.__grokSbdlLabel = LABEL;
  try {{ console.info("[grok-sbdl] ready v3", LABEL); }} catch (e) {{}}
}})();"##,
        label_js = label_js
    )
}

/// Non-blocking polyfill inject.
pub fn install_hook(app: &AppHandle, label: String) -> Result<(), String> {
    let t = label.trim();
    if t.is_empty() {
        return Err("label empty".into());
    }
    let wv = app
        .get_webview(t)
        .ok_or_else(|| format!("side browser webview not found: {t}"))?;
    let script = blob_download_polyfill(t);
    wv.eval(script)
        .map_err(|e| format!("install download polyfill: {e}"))?;
    tracing::debug!(target: "side_browser", label = %t, "download polyfill eval scheduled");
    Ok(())
}

// ── custom protocol: GET notify (Image/beacon) + optional POST body ─────

fn cors_headers(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS, GET")
        .header(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Content-Type, X-Grok-Filename, X-Grok-Label, Content-Length",
        )
        .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
}

fn json_response(status: StatusCode, body: &str) -> Response<Vec<u8>> {
    cors_headers(
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8"),
    )
    .body(body.as_bytes().to_vec())
    .unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(b"{}".to_vec())
            .expect("response")
    })
}

fn sanitize_filename(raw: &str) -> String {
    let trimmed = raw.trim();
    let base = if trimmed.is_empty() {
        "download.bin"
    } else {
        trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed)
    };
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    if cleaned.is_empty() {
        "download.bin".into()
    } else {
        cleaned.chars().take(200).collect()
    }
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if k == key {
            return Some(urlencoding_decode(v).unwrap_or_else(|| v.replace('+', " ")));
        }
    }
    None
}

fn urlencoding_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                let b = u8::from_str_radix(h, 16).ok()?;
                out.push(b);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn system_downloads_dir() -> PathBuf {
    if let Some(dirs) = directories::UserDirs::new() {
        if let Some(dl) = dirs.download_dir() {
            return dl.to_path_buf();
        }
    }
    crate::process_util::user_home().join("Downloads")
}

/// Collision-safe download target (`name.ext` → `name (2).ext` → …).
/// Unit-tested pure helper; the live download path resolves naming inline.
#[cfg_attr(not(test), allow(dead_code))]
fn unique_download_path(dir: &Path, suggested: &str) -> PathBuf {
    let name = sanitize_filename(suggested);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e))
            if !s.is_empty() && e.len() <= 12 && e.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            (s.to_string(), format!(".{e}"))
        }
        _ => (name.clone(), String::new()),
    };
    let mut candidate = dir.join(format!("{stem}{ext}"));
    if !candidate.exists() {
        return candidate;
    }
    for n in 1..10_000 {
        candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let seq = SAVE_SEQ.fetch_add(1, Ordering::Relaxed);
    dir.join(format!("{stem}-{seq}{ext}"))
}

fn write_all_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut f = std::fs::File::create(path).map_err(|e| format!("create: {e}"))?;
    f.write_all(data).map_err(|e| format!("write: {e}"))?;
    f.flush().map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

pub fn dispatch_async(
    app: AppHandle,
    webview_label: String,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if let Err(e) = std::thread::Builder::new()
        .name("sbdl-proto".into())
        .spawn(move || {
            let response = handle_protocol(&app, &webview_label, request);
            responder.respond(response);
        })
    {
        tracing::warn!(error = %e, "sbdl spawn failed");
    }
}

fn handle_protocol(
    app: &AppHandle,
    webview_label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let method = request.method().clone();
    let uri = request.uri().to_string();
    tracing::info!(
        target: "side_browser",
        %method,
        uri = %uri,
        label = %webview_label,
        "sbdl protocol hit"
    );

    if method == Method::OPTIONS {
        return cors_headers(Response::builder().status(StatusCode::NO_CONTENT))
            .body(Vec::new())
            .unwrap_or_else(|_| json_response(StatusCode::NO_CONTENT, ""));
    }

    if method == Method::GET {
        let path = request.uri().path();
        let label = query_param(&uri, "label").unwrap_or_else(|| webview_label.to_string());

        // Image/beacon notify: blob ready for eval pull
        if path.ends_with("/ready") || path.contains("ready") {
            let id = query_param(&uri, "id").unwrap_or_default();
            let len: usize = query_param(&uri, "len")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let name = query_param(&uri, "name").unwrap_or_else(|| "download.bin".into());
            if !id.is_empty() && len > 0 {
                spawn_blob_pull(app, &label, id, len, sanitize_filename(&name));
            }
            return json_response(StatusCode::OK, r#"{"ok":true,"queued":"blob"}"#);
        }

        // Image/beacon notify: http(s) URL for Rust download
        if path.ends_with("/url") || path.contains("/url") {
            let name = query_param(&uri, "name").unwrap_or_else(|| "download.bin".into());
            let url = query_param(&uri, "u").unwrap_or_default();
            if !url.is_empty() {
                spawn_http_download(app, &label, url, sanitize_filename(&name));
            }
            return json_response(StatusCode::OK, r#"{"ok":true,"queued":"url"}"#);
        }

        return json_response(StatusCode::OK, r#"{"ok":true,"pong":true}"#);
    }

    if method != Method::POST {
        return json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            r#"{"ok":false,"error":"method"}"#,
        );
    }

    // POST body path (if a page can reach it)
    let body = request.body();
    if body.is_empty() {
        return json_response(StatusCode::BAD_REQUEST, r#"{"ok":false,"error":"empty"}"#);
    }
    if body.len() > MAX_BLOB_BYTES {
        return json_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            r#"{"ok":false,"error":"too large"}"#,
        );
    }
    let label = query_param(&uri, "label").unwrap_or_else(|| webview_label.to_string());
    let name = query_param(&uri, "name")
        .map(|s| sanitize_filename(&s))
        .unwrap_or_else(|| "download.bin".into());
    let Some(dest) = pick_save_path(app, &label, &name) else {
        return json_response(StatusCode::OK, r#"{"ok":false,"cancelled":true}"#);
    };
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = write_all_atomic(&dest, body) {
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!(r#"{{"ok":false,"error":"{e}"}}"#),
        );
    }
    finish_ok(app, &label, &name, dest.clone());
    let body_json = serde_json::json!({
        "ok": true,
        "path": dest.display().to_string(),
    });
    json_response(StatusCode::OK, &body_json.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_titles() {
        assert!(is_download_signal_title("__GROK_SBDL__|1|10|a.mp4"));
        assert!(is_download_signal_title(
            "__GROK_DL_URL__|a.mp4|https://x/y"
        ));
        assert!(!is_download_signal_title("ChatCut"));
    }

    #[test]
    fn content_disposition() {
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=\"clip.mp4\"").as_deref(),
            Some("clip.mp4")
        );
        let s3 = "https://bucket.s3.amazonaws.com/out.mp4?response-content-disposition=attachment%3B%20filename%2A%3DUTF-8%27%27hello%2520world.mp4&x-id=GetObject";
        let n = filename_from_url_query(s3).expect("name");
        assert!(n.contains("hello"), "{n}");
        assert!(n.ends_with(".mp4"), "{n}");
    }

    #[test]
    fn polyfill_has_both_bridges() {
        let s = blob_download_polyfill("resource-browser-x");
        assert!(s.contains("__GROK_SBDL__"));
        assert!(s.contains("__GROK_DL_URL__"));
        assert!(s.contains("createObjectURL"));
        assert!(s.contains("/ready?"));
        assert!(s.contains("/url?"));
        assert!(s.contains("__grokSbdlInstalled"));
        assert!(s.contains("IFRAME"));
        assert!(s.contains("credentials"));
        assert!(s.contains("appendChild"));
    }

    #[test]
    fn sanitize_and_unique() {
        assert_eq!(sanitize_filename("a/b.mp4"), "b.mp4");
        let dir = std::env::temp_dir().join(format!("sbdl-u-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = unique_download_path(&dir, "c.mp4");
        std::fs::write(&a, b"1").unwrap();
        let b = unique_download_path(&dir, "c.mp4");
        assert_ne!(a, b);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
