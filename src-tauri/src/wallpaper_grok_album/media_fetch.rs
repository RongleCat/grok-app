use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::wallpaper_source::WallpaperSearchCancellation;

use super::{
    cached_media_contains, eval_script, sanitize_media_url, MAX_BRIDGE_PAYLOAD_BYTES, WINDOW_LABEL,
};

const FETCH_TIMEOUT: Duration = Duration::from_secs(90);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(180);
const POLL_INTERVAL: Duration = Duration::from_millis(80);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(12);
const CHUNK_BYTES: usize = 512 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaJob {
    #[serde(default)]
    state: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    mime: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaChunk {
    #[serde(default)]
    state: String,
    #[serde(default)]
    start: u64,
    #[serde(default)]
    end: u64,
    #[serde(default)]
    data: String,
}

pub(super) fn validated_cached_media_url(raw_url: &str) -> Result<String, String> {
    let url = sanitize_media_url(raw_url).ok_or_else(|| "url_blocked".to_string())?;
    if !cached_media_contains(&url) {
        return Err("url_blocked".to_string());
    }
    Ok(url)
}

fn saved_album_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "download_failed: album window closed".to_string())?;
    let page_url = window
        .url()
        .map_err(|_| "download_failed: album page unavailable".to_string())?;
    if !page_url
        .host_str()
        .is_some_and(|host| host.eq_ignore_ascii_case("grok.com"))
        || !page_url.path().starts_with("/imagine/saved")
    {
        return Err("download_failed: album page unavailable".to_string());
    }
    Ok(window)
}

fn decode_eval_json<T: DeserializeOwned>(raw: &str) -> Result<T, String> {
    if raw.len() > MAX_BRIDGE_PAYLOAD_BYTES {
        return Err("download_failed: album bridge payload too large".to_string());
    }
    let first: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "download_failed: invalid album bridge payload".to_string())?;
    let value = match first {
        serde_json::Value::String(inner) => serde_json::from_str(&inner)
            .map_err(|_| "download_failed: invalid album bridge payload".to_string())?,
        other => other,
    };
    serde_json::from_value(value)
        .map_err(|_| "download_failed: invalid album bridge payload".to_string())
}

fn media_job_start_script(url: &str, webview_only: bool) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "url_blocked".to_string())?;
    Ok(format!(
        r#"(function () {{
  try {{
    var url = {url};
    var webviewOnly = {webview_only};
    var target = url;
    var targetWasBlob = false;

    function assetIdentity(raw) {{
      try {{
        var parsed = new URL(String(raw || ""), location.href);
        if (parsed.protocol !== "https:" || parsed.hostname !== "assets.grok.com" ||
            (parsed.port && parsed.port !== "443") || parsed.username || parsed.password ||
            parsed.pathname.indexOf("/generated/") < 0) return null;
        return parsed.origin + parsed.pathname;
      }} catch (_) {{
        return null;
      }}
    }}

    if (webviewOnly) {{
      var anchorIdentity = assetIdentity(url);
      var videos = Array.prototype.slice.call(document.querySelectorAll("video"));
      var matched = videos.find(function (video) {{
        return assetIdentity(video && video.poster) === anchorIdentity;
      }});
      if (!anchorIdentity || !matched) throw new Error("anchor");
      var rawTarget = String((matched.currentSrc || matched.src) || "");
      var targetUrl = new URL(rawTarget, location.href);
      var localBlob = targetUrl.protocol === "blob:" && targetUrl.origin === location.origin;
      var generatedAsset = assetIdentity(targetUrl.href) !== null;
      if (!localBlob && !generatedAsset) throw new Error("target");
      target = targetUrl.href;
      targetWasBlob = localBlob;
    }}

    var jobs = window.__GROK_APP_ALBUM_MEDIA_JOBS__ ||
      (window.__GROK_APP_ALBUM_MEDIA_JOBS__ = Object.create(null));
    var existing = jobs[url];
    if (existing && (existing.state === "loading" || existing.state === "ready")) {{
      return JSON.stringify({{
        state: existing.state,
        size: Number(existing.size || 0),
        mime: String(existing.mime || "").slice(0, 64)
      }});
    }}
    try {{ if (existing && existing.controller) existing.controller.abort(); }} catch (_) {{}}

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var job = {{ state: "loading", size: 0, mime: "", controller: controller }};
    jobs[url] = job;
    var timer = window.setTimeout(function () {{
      try {{ if (controller) controller.abort(); }} catch (_) {{}}
    }}, 85000);

    function fail() {{
      window.clearTimeout(timer);
      if (jobs[url] === job) jobs[url] = {{ state: "error", size: 0, mime: "" }};
    }}

    fetch(target, {{
      credentials: "include",
      mode: "cors",
      cache: "force-cache",
      redirect: "follow",
      signal: controller ? controller.signal : undefined
    }})
      .then(function (response) {{
        if (!response.ok) throw new Error("status");
        if (!targetWasBlob) {{
          var finalUrl = new URL(response.url || target, location.href);
          if (assetIdentity(finalUrl.href) === null) throw new Error("redirect");
        }}
        var mime = String(response.headers.get("content-type") || "")
          .split(";")[0].trim().toLowerCase().slice(0, 64);
        var length = Number(response.headers.get("content-length") || 0);
        if ((mime.indexOf("image/") !== 0 && mime.indexOf("video/") !== 0 &&
             mime !== "application/octet-stream" && mime !== "") ||
            (webviewOnly && mime && mime.indexOf("video/") !== 0 &&
             mime !== "application/octet-stream") ||
            !Number.isFinite(length) || length < 0 || length > {max_bytes}) {{
          throw new Error("metadata");
        }}
        return response.blob().then(function (blob) {{ return {{ blob: blob, mime: mime }}; }});
      }})
      .then(function (payload) {{
        window.clearTimeout(timer);
        if (jobs[url] !== job) return;
        var blob = payload && payload.blob;
        var mime = String((payload && payload.mime) || (blob && blob.type) || "")
          .split(";")[0].trim().toLowerCase().slice(0, 64);
        if (!blob || !blob.size || blob.size > {max_bytes}) return fail();
        jobs[url] = {{
          state: "ready",
          size: Number(blob.size),
          mime: mime,
          blob: blob,
          chunk: null
        }};
      }})
      .catch(fail);
    return JSON.stringify({{ state: "loading", size: 0, mime: "" }});
  }} catch (_) {{
    return JSON.stringify({{ state: "error", size: 0, mime: "" }});
  }}
}})()"#,
        max_bytes = crate::wallpaper_source::MAX_DOWNLOAD_BYTES,
        webview_only = if webview_only { "true" } else { "false" },
    ))
}

fn media_job_poll_script(url: &str, remove: bool) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "url_blocked".to_string())?;
    Ok(format!(
        r#"(function () {{
  try {{
    var url = {url};
    var jobs = window.__GROK_APP_ALBUM_MEDIA_JOBS__;
    var job = jobs && jobs[url];
    if (!job) return JSON.stringify({{ state: "error", size: 0, mime: "" }});
    var result = JSON.stringify({{
      state: String(job.state || "error"),
      size: Number(job.size || 0),
      mime: String(job.mime || "").slice(0, 64)
    }});
    if ({remove}) {{
      try {{ if (job.controller) job.controller.abort(); }} catch (_) {{}}
      delete jobs[url];
    }}
    return result;
  }} catch (_) {{
    return JSON.stringify({{ state: "error", size: 0, mime: "" }});
  }}
}})()"#,
        remove = if remove { "true" } else { "false" },
    ))
}

fn media_chunk_start_script(url: &str, start: u64, end: u64) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "url_blocked".to_string())?;
    Ok(format!(
        r#"(function () {{
  try {{
    var url = {url};
    var start = {start};
    var end = {end};
    var jobs = window.__GROK_APP_ALBUM_MEDIA_JOBS__;
    var job = jobs && jobs[url];
    if (!job || job.state !== "ready" || !job.blob || start < 0 || end <= start ||
        end > job.size || end - start > {chunk_bytes}) {{
      return JSON.stringify({{ state: "error", start: start, end: end, data: "" }});
    }}
    var existing = job.chunk;
    if (existing && existing.start === start && existing.end === end &&
        (existing.state === "loading" || existing.state === "ready")) {{
      return JSON.stringify({{ state: existing.state, start: start, end: end, data: "" }});
    }}
    var chunk = {{ state: "loading", start: start, end: end, data: "" }};
    job.chunk = chunk;
    var reader = new FileReader();
    var timer = window.setTimeout(function () {{
      try {{ reader.abort(); }} catch (_) {{}}
      if (job.chunk === chunk) job.chunk = {{ state: "error", start: start, end: end, data: "" }};
    }}, 8000);
    function fail() {{
      window.clearTimeout(timer);
      if (job.chunk === chunk) job.chunk = {{ state: "error", start: start, end: end, data: "" }};
    }}
    reader.onload = function () {{
      window.clearTimeout(timer);
      if (job.chunk !== chunk) return;
      var result = String(reader.result || "");
      var comma = result.indexOf(",");
      var data = comma >= 0 ? result.slice(comma + 1) : "";
      if (!data || data.length > {max_b64} || !/^[A-Za-z0-9+/]*={{0,2}}$/.test(data)) return fail();
      job.chunk = {{ state: "ready", start: start, end: end, data: data }};
    }};
    reader.onerror = fail;
    reader.onabort = fail;
    reader.readAsDataURL(job.blob.slice(start, end));
    return JSON.stringify({{ state: "loading", start: start, end: end, data: "" }});
  }} catch (_) {{
    return JSON.stringify({{ state: "error", start: {start}, end: {end}, data: "" }});
  }}
}})()"#,
        chunk_bytes = CHUNK_BYTES,
        max_b64 = (CHUNK_BYTES * 4 / 3) + 16,
    ))
}

fn media_chunk_poll_script(url: &str, take: bool) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "url_blocked".to_string())?;
    Ok(format!(
        r#"(function () {{
  try {{
    var url = {url};
    var jobs = window.__GROK_APP_ALBUM_MEDIA_JOBS__;
    var job = jobs && jobs[url];
    var chunk = job && job.chunk;
    if (!chunk) return JSON.stringify({{ state: "error", start: 0, end: 0, data: "" }});
    var result = JSON.stringify({{
      state: String(chunk.state || "error"),
      start: Number(chunk.start || 0),
      end: Number(chunk.end || 0),
      data: chunk.state === "ready" ? String(chunk.data || "") : ""
    }});
    if ({take} && chunk.state !== "loading") job.chunk = null;
    return result;
  }} catch (_) {{
    return JSON.stringify({{ state: "error", start: 0, end: 0, data: "" }});
  }}
}})()"#,
        take = if take { "true" } else { "false" },
    ))
}

fn wait_for_media(
    window: &WebviewWindow,
    url: &str,
    cancellation: &WallpaperSearchCancellation,
    webview_only: bool,
) -> Result<MediaJob, String> {
    if cancellation.is_cancelled() {
        return Err("download_failed: album media cancelled".to_string());
    }
    let start = media_job_start_script(url, webview_only)?;
    let _ = eval_script(window, &start)?;
    let deadline = Instant::now() + FETCH_TIMEOUT;
    while Instant::now() < deadline {
        if cancellation.is_cancelled() {
            return Err("download_failed: album media cancelled".to_string());
        }
        let poll = media_job_poll_script(url, false)?;
        let job: MediaJob = decode_eval_json(&eval_script(window, &poll)?)?;
        match job.state.as_str() {
            "ready" => {
                if job.size == 0 || job.size > crate::wallpaper_source::MAX_DOWNLOAD_BYTES {
                    return Err("download_failed: invalid album media size".to_string());
                }
                return Ok(job);
            }
            "error" => return Err("download_failed: album media unavailable".to_string()),
            _ => std::thread::sleep(POLL_INTERVAL),
        }
    }
    Err("download_failed: album media timeout".to_string())
}

fn read_media_chunk(
    window: &WebviewWindow,
    url: &str,
    start: u64,
    end: u64,
    cancellation: &WallpaperSearchCancellation,
) -> Result<Vec<u8>, String> {
    let start_script = media_chunk_start_script(url, start, end)?;
    let _ = eval_script(window, &start_script)?;
    let deadline = Instant::now() + CHUNK_TIMEOUT;
    while Instant::now() < deadline {
        if cancellation.is_cancelled() {
            return Err("download_failed: album media cancelled".to_string());
        }
        let poll = media_chunk_poll_script(url, false)?;
        let chunk: MediaChunk = decode_eval_json(&eval_script(window, &poll)?)?;
        match chunk.state.as_str() {
            "ready" => {
                let take = media_chunk_poll_script(url, true)?;
                let chunk: MediaChunk = decode_eval_json(&eval_script(window, &take)?)?;
                if chunk.start != start || chunk.end != end || chunk.data.is_empty() {
                    return Err("download_failed: invalid album media chunk".to_string());
                }
                let bytes = B64
                    .decode(chunk.data.as_bytes())
                    .map_err(|_| "download_failed: invalid album media chunk".to_string())?;
                if bytes.len() as u64 != end - start {
                    return Err("download_failed: short album media chunk".to_string());
                }
                return Ok(bytes);
            }
            "error" => return Err("download_failed: album media chunk unavailable".to_string()),
            _ => std::thread::sleep(POLL_INTERVAL),
        }
    }
    Err("download_failed: album media chunk timeout".to_string())
}

pub(super) fn fetch_from_webview(
    app: &AppHandle,
    raw_url: &str,
    cancellation: &WallpaperSearchCancellation,
    webview_only: bool,
) -> Result<(Vec<u8>, String), String> {
    let url = validated_cached_media_url(raw_url)?;
    let window = saved_album_window(app)?;
    let result = (|| {
        let job = wait_for_media(&window, &url, cancellation, webview_only)?;
        let capacity = usize::try_from(job.size)
            .map_err(|_| "download_failed: invalid album media size".to_string())?;
        let mut bytes = Vec::with_capacity(capacity);
        let transfer_deadline = Instant::now() + TRANSFER_TIMEOUT;
        let mut offset = 0u64;
        while offset < job.size {
            if cancellation.is_cancelled() {
                return Err("download_failed: album media cancelled".to_string());
            }
            if Instant::now() >= transfer_deadline {
                return Err("download_failed: album media transfer timeout".to_string());
            }
            let end = (offset + CHUNK_BYTES as u64).min(job.size);
            bytes.extend_from_slice(&read_media_chunk(&window, &url, offset, end, cancellation)?);
            offset = end;
        }
        if bytes.len() as u64 != job.size {
            return Err("download_failed: short album media transfer".to_string());
        }
        Ok((bytes, job.mime))
    })();

    if let Ok(cleanup) = media_job_poll_script(&url, true) {
        let _ = eval_script(&window, &cleanup);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_decodes_direct_and_nested_job_json() {
        let direct: MediaJob =
            decode_eval_json(r#"{"state":"ready","size":123,"mime":"image/jpeg"}"#).unwrap();
        assert_eq!(direct.state, "ready");
        assert_eq!(direct.size, 123);
        let nested =
            serde_json::to_string(r#"{"state":"ready","start":0,"end":3,"data":"YWJj"}"#).unwrap();
        let chunk: MediaChunk = decode_eval_json(&nested).unwrap();
        assert_eq!(chunk.data, "YWJj");
    }

    #[test]
    fn generated_scripts_embed_bounded_constants_and_unconditional_cleanup() {
        let url = "https://assets.grok.com/users/test/generated/fake/image.jpg";
        let media_start = media_job_start_script(url, false).unwrap();
        assert!(media_start.contains("response.url || target"));
        assert!(media_start.contains("parsed.port !== \"443\""));
        let blob_start = media_job_start_script(url, true).unwrap();
        assert!(blob_start.contains("var webviewOnly = true"));
        assert!(blob_start.contains("targetUrl.protocol === \"blob:\""));
        assert!(blob_start.contains("targetUrl.origin === location.origin"));
        let start = media_chunk_start_script(url, 0, CHUNK_BYTES as u64).unwrap();
        assert!(start.contains(&format!("end - start > {CHUNK_BYTES}")));
        let cleanup = media_job_poll_script(url, true).unwrap();
        assert!(cleanup.contains("delete jobs[url]"));
        assert!(!cleanup.contains("state !== \"loading\""));
    }

    #[test]
    fn bridge_rejects_oversized_eval_payload() {
        let oversized = "x".repeat(MAX_BRIDGE_PAYLOAD_BYTES + 1);
        assert!(decode_eval_json::<MediaJob>(&oversized).is_err());
    }
}
