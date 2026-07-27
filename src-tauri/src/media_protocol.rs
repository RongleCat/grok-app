//! Streaming media protocol with HTTP Range support.
//!
//! Tauri's built-in `asset` protocol loads the **entire** file into memory when the
//! client omits a Range header. Multi‑GB video/audio then fails (or OOMs) and the
//! HTML5 player stuck at `-00:00`.
//!
//! This `media://` handler always streams in bounded chunks and answers Range
//! requests with `206 Partial Content`, which is what video/audio elements need.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use tauri::http::{header, Method, Request, Response, StatusCode};

/// Max bytes returned per request (keeps memory bounded).
const MAX_CHUNK: u64 = 2 * 1024 * 1024; // 2 MiB

fn mime_from_path(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
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
        _ => "application/octet-stream",
    }
}

/// Decode path from `media://localhost/<percent-encoded-path>` (or Windows variant).
fn path_from_request(request: &Request<Vec<u8>>) -> Option<PathBuf> {
    let uri = request.uri();
    // path is like "/Users/me/file.mp4" or "/%2FUsers%2F..." depending on encoding
    let raw = uri.path();
    let stripped = raw.strip_prefix('/').unwrap_or(raw);
    if stripped.is_empty() {
        return None;
    }
    // convertFileSrc encodes the whole absolute path with encodeURIComponent
    let decoded = percent_decode(stripped);
    if decoded.is_empty() {
        return None;
    }
    Some(PathBuf::from(decoded))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = &input[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(h, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    // Support "bytes=start-end" / "bytes=start-" / "bytes=-suffix"
    let s = header.trim();
    let s = s.strip_prefix("bytes=")?.trim();
    // Only first range
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
    // Cap chunk size
    let end = start.saturating_add(MAX_CHUNK - 1).min(end).min(len - 1);
    Some((start, end))
}

/// Origins allowed to read media:// (main window only — not embedded browsers).
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

fn request_origin_allowed(request: &Request<Vec<u8>>) -> bool {
    let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    else {
        // No Origin: same-document / <img>/<video> loads from the main webview.
        // Embedded cross-origin pages always send Origin on fetch(); allow bare loads.
        return true;
    };
    allowed_origins().iter().any(|o| *o == origin)
}

fn cors_origin_header(request: &Request<Vec<u8>>) -> Option<&'static str> {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())?;
    allowed_origins()
        .iter()
        .find(|o| **o == origin)
        .copied()
}

fn error_response(
    request: &Request<Vec<u8>>,
    status: StatusCode,
    msg: &str,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8");
    if let Some(o) = cors_origin_header(request) {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
    }
    builder
        .body(msg.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Handle one media protocol request (sync).
pub fn handle_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // CORS preflight — only for allowlisted main-window origins.
    if request.method() == Method::OPTIONS {
        let Some(origin) = cors_origin_header(&request) else {
            return error_response(&request, StatusCode::FORBIDDEN, "origin not allowed");
        };
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                "range, content-type, accept, origin",
            )
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "content-range, accept-ranges, content-length, content-type",
            )
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::VARY, "Origin")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    if !request_origin_allowed(&request) {
        tracing::warn!("media protocol: rejected disallowed Origin");
        return error_response(&request, StatusCode::FORBIDDEN, "origin not allowed");
    }

    let Some(path) = path_from_request(&request) else {
        return error_response(&request, StatusCode::BAD_REQUEST, "missing path");
    };

    // canonicalize + path_scope allowlist (trusted projects / app data / grants).
    let path = match crate::path_scope::require_allowed(&path) {
        Ok(p) => p,
        Err(_) => {
            tracing::warn!(path = %path.display(), "media protocol: path not allowed");
            return error_response(&request, StatusCode::FORBIDDEN, "path not allowed");
        }
    };

    if !path.is_file() {
        tracing::warn!(path = %path.display(), "media protocol: file not found");
        return error_response(&request, StatusCode::NOT_FOUND, "file not found");
    }

    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "media protocol: open failed");
            return error_response(
                &request,
                StatusCode::FORBIDDEN,
                &format!("open failed: {e}"),
            );
        }
    };

    let len = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => {
            return error_response(
                &request,
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("stat: {e}"),
            )
        }
    };

    let mime = mime_from_path(&path.to_string_lossy());
    let path_str = path.to_string_lossy().to_string();
    let acao = cors_origin_header(&request);

    let range_hdr = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Decide byte window
    let (start, end, partial) = if let Some(ref rh) = range_hdr {
        match parse_range(rh, len) {
            Some((s, e)) => (s, e, true),
            None => {
                let mut builder = Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                    .header(header::ACCEPT_RANGES, "bytes");
                if let Some(o) = acao {
                    builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
                }
                return builder
                    .body(Vec::new())
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            }
        }
    } else if len == 0 {
        (0, 0, false)
    } else if len <= MAX_CHUNK {
        (0, len - 1, false)
    } else {
        // No Range on a large file: do NOT load entire file.
        // Return the first chunk as 206 so the player learns Accept-Ranges + duration.
        (0, MAX_CHUNK - 1, true)
    };

    let nbytes = if len == 0 {
        0
    } else {
        end.saturating_sub(start).saturating_add(1)
    };

    if request.method() == Method::HEAD {
        let mut builder = Response::builder()
            .status(if partial {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            })
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, nbytes)
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "content-range, accept-ranges, content-length, content-type",
            );
        if let Some(o) = acao {
            builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
        }
        if partial && len > 0 {
            builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
        }
        return builder
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    let mut buf = vec![0u8; nbytes as usize];
    if nbytes > 0 {
        if let Err(e) = file.seek(SeekFrom::Start(start)) {
            return error_response(
                &request,
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("seek: {e}"),
            );
        }
        if let Err(e) = file.read_exact(&mut buf) {
            // Short read near EOF is ok for last chunk
            if e.kind() != std::io::ErrorKind::UnexpectedEof {
                tracing::warn!(path = %path_str, error = %e, "media protocol: read failed");
                return error_response(
                    &request,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("read: {e}"),
                );
            }
        }
    }

    let mut builder = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, buf.len())
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "content-range, accept-ranges, content-length, content-type",
        )
        .header(header::CACHE_CONTROL, "no-cache");

    if let Some(o) = acao {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
    }

    if partial && len > 0 {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{len}"),
        );
    }

    builder
        .body(buf)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_spaces() {
        let s = percent_decode("Users%2Fme%2FCleanShot%202026.mp4");
        assert!(s.contains("CleanShot 2026.mp4") || s.contains("CleanShot%20"));
        assert_eq!(
            percent_decode("%2FUsers%2Fme%2Fvid.mp4"),
            "/Users/me/vid.mp4"
        );
    }

    #[test]
    fn range_parse() {
        assert_eq!(parse_range("bytes=0-499", 1000), Some((0, 499)));
        // Open-ended range is capped by file length and MAX_CHUNK
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_range("bytes=0-999999999", 500), Some((0, 499)));
        let big = MAX_CHUNK * 4;
        assert_eq!(
            parse_range("bytes=0-", big),
            Some((0, MAX_CHUNK - 1))
        );
    }
}
