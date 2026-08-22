//! Wallpaper source: X search + Imagine generate via headless Grok CLI,
//! plus allowlisted media download into the app wallpaper library.

#![allow(dead_code)] // residual-clippy: kind_from_mime
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cli_probe;
use crate::paths;
use crate::process_util;
use crate::proxy;
use crate::store;

/// Max bytes for a single wallpaper media download.
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
/// Headless X search budget.
const X_SEARCH_TIMEOUT: Duration = Duration::from_secs(150);
/// Headless Imagine budget.
const IMAGINE_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperGalleryItem {
    pub id: String,
    pub thumb_url: String,
    pub full_url: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub likes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperSearchResult {
    pub items: Vec<WallpaperGalleryItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperFetchResult {
    pub path: String,
    pub mime: String,
    pub bytes: u64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperLibraryEntry {
    pub path: String,
    pub name: String,
    pub source: String,
    pub kind: String,
    pub bytes: u64,
    pub modified_ms: u64,
}

// ── Paths ───────────────────────────────────────────────────────────────────

pub fn wallpapers_root() -> PathBuf {
    let dir = paths::app_data_root().join("wallpapers");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn dated_subdir(kind: &str) -> PathBuf {
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let dir = wallpapers_root().join(kind).join(day);
    let _ = fs::create_dir_all(&dir);
    dir
}

// ── URL helpers ─────────────────────────────────────────────────────────────

/// Normalize common X CDN URL variants to a larger still when possible.
pub fn normalize_media_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // pbs.twimg.com/media/XXX?format=jpg&name=small → name=orig
    if trimmed.contains("pbs.twimg.com/media/") {
        // Legacy `:small` / `:large` suffix — must be handled before
        // Url::parse, which accepts the suffix as part of the path and
        // would return the URL unchanged.
        for suffix in [":thumb", ":small", ":medium", ":large"] {
            if let Some(base) = trimmed.strip_suffix(suffix) {
                return format!("{base}:orig");
            }
        }
        if let Ok(mut u) = url::Url::parse(trimmed) {
            let mut pairs: Vec<(String, String)> = u
                .query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let mut found_name = false;
            for (k, v) in pairs.iter_mut() {
                if k == "name" {
                    *v = "orig".into();
                    found_name = true;
                }
            }
            if !found_name {
                pairs.push(("name".into(), "orig".into()));
            }
            u.query_pairs_mut().clear();
            for (k, v) in pairs {
                u.query_pairs_mut().append_pair(&k, &v);
            }
            return u.to_string();
        }
    }
    trimmed.to_string()
}

/// Hosts allowed for wallpaper downloads (X CDN + common xAI/Imagine assets).
pub fn is_allowed_media_url(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url.trim()) else {
        return false;
    };
    if u.scheme() != "https" && u.scheme() != "http" {
        return false;
    }
    let host = match u.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return false,
    };
    const ALLOW: &[&str] = &[
        "pbs.twimg.com",
        "video.twimg.com",
        "ton.twimg.com",
        "abs.twimg.com",
        "cdn.grok.com",
        "assets.grok.com",
        "imagine-public.x.ai",
        "imgen.x.ai",
        "filesystem.site",
    ];
    ALLOW.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))
        // Also allow any *.x.ai / *.twimg.com under https
        || host.ends_with(".x.ai")
        || host.ends_with(".twimg.com")
        || host == "x.ai"
}

/// Extract a numeric X/Twitter status snowflake from a URL (or bare id).
/// Only pathname `status|statuses/<digits>` counts — query/fragment are ignored.
fn extract_status_id_from_url(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }
    if u.chars().all(|c| c.is_ascii_digit()) && u.len() >= 8 {
        return Some(u.to_string());
    }
    let parsed = url::Url::parse(u).ok()?;
    let segs: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    for i in 0..segs.len().saturating_sub(1) {
        let name = segs[i].to_ascii_lowercase();
        if name != "status" && name != "statuses" {
            continue;
        }
        let id = segs[i + 1];
        if id.len() >= 8 && id.chars().all(|c| c.is_ascii_digit()) {
            return Some(id.to_string());
        }
        return None;
    }
    None
}

fn is_canonical_x_status_url(url: &str) -> bool {
    let parsed = match url::Url::parse(url.trim()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let scheme = parsed.scheme();
    if scheme != "https" && scheme != "http" {
        return false;
    }
    let host = parsed
        .host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    if host != "x.com" && host != "twitter.com" && host != "mobile.twitter.com" {
        return false;
    }
    extract_status_id_from_url(url).is_some()
}

/// Normalize to `https://x.com/<user>/status/<id>` when a real status id is present.
/// Returns `None` when the URL is not a citable status page (never invents ids).
fn normalize_status_url(url: &str, username: Option<&str>) -> Option<String> {
    let trimmed = url.trim();
    let bare_id = trimmed.chars().all(|c| c.is_ascii_digit()) && trimmed.len() >= 8;
    if !bare_id && !is_canonical_x_status_url(trimmed) {
        return None;
    }
    let status_id = extract_status_id_from_url(url)?;
    let mut handle = String::new();
    if let Ok(parsed) = url::Url::parse(url.trim()) {
        let host = parsed
            .host_str()
            .unwrap_or("")
            .trim_start_matches("www.")
            .to_ascii_lowercase();
        if host == "x.com" || host == "twitter.com" || host == "mobile.twitter.com" {
            let segs: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
            if let Some(first) = segs.first() {
                if !first.eq_ignore_ascii_case("i")
                    && !first.eq_ignore_ascii_case("status")
                    && !first.eq_ignore_ascii_case("statuses")
                {
                    handle = first.trim_start_matches('@').to_string();
                }
            }
        }
    }
    if handle.is_empty() {
        if let Some(u) = username.map(str::trim).filter(|s| !s.is_empty()) {
            handle = u.trim_start_matches('@').to_string();
        }
    }
    if handle.is_empty() {
        handle = "i".into();
    }
    Some(format!("https://x.com/{handle}/status/{status_id}"))
}

/// Stricter gallery candidate: real stills suitable as wallpaper, not avatars/emoji.
pub fn is_gallery_media_url(url: &str) -> bool {
    if !is_allowed_media_url(url) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    if lower.contains("placeholder")
        || lower.contains("/profile_images/")
        || lower.contains("/profile_banners/")
        || lower.contains("/emoji/")
        || lower.contains("/ext_tw_video_thumb/")
        || lower.contains("default_profile")
    {
        return false;
    }
    // Prefer photo media CDN paths. Keep in sync with is_allowed_media_url —
    // a host allowed for download must not be silently dropped from the gallery.
    lower.contains("pbs.twimg.com/media/")
        || lower.contains("video.twimg.com/")
        || lower.contains("ton.twimg.com/")
        || lower.contains("abs.twimg.com/")
        || lower.contains(".x.ai/")
        || lower.contains("cdn.grok.com")
        || lower.contains("assets.grok.com")
        || lower.contains("filesystem.site/")
}

fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn ext_from_mime_or_url(mime: &str, url: &str) -> String {
    let m = mime.to_ascii_lowercase();
    if m.contains("jpeg") || m.contains("jpg") {
        return "jpg".into();
    }
    if m.contains("png") {
        return "png".into();
    }
    if m.contains("webp") {
        return "webp".into();
    }
    if m.contains("gif") {
        return "gif".into();
    }
    if m.contains("mp4") {
        return "mp4".into();
    }
    if m.contains("webm") {
        return "webm".into();
    }
    if let Ok(u) = url::Url::parse(url) {
        if let Some(seg) = u.path_segments().and_then(|mut s| s.next_back()) {
            if let Some(dot) = seg.rfind('.') {
                let e = &seg[dot + 1..];
                if e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return e.to_ascii_lowercase();
                }
            }
        }
    }
    "jpg".into()
}

fn kind_from_mime(mime: &str) -> &'static str {
    if mime.starts_with("video/") {
        "video"
    } else {
        "image"
    }
}

// ── Auth / CLI ──────────────────────────────────────────────────────────────

pub(crate) fn require_cli_ready() -> Result<String, String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if !probe.found {
        return Err("cli_missing".into());
    }
    let path = probe.path.ok_or_else(|| "cli_missing".to_string())?;
    if !cli_probe::cli_auth_json_present() {
        // Official API key in app secrets also works for some flows, but
        // headless grok prefers ~/.grok/auth.json — surface login.
        let secrets = crate::secrets::load_secrets_disk_only();
        if !crate::secrets::has_official_key_configured(&secrets) {
            return Err("auth_required".into());
        }
    }
    Ok(path)
}

/// Parse headless `grok -p --output-format json` stdout into a gallery payload.
///
/// Real CLI wraps the model answer:
/// ```json
/// { "text": "<maybe nested JSON string>", "structuredOutput": null|object, ... }
/// ```
/// Model text may also concatenate multiple JSON objects when schema validation
/// fails (`structuredOutputError`). We must unwrap the envelope and harvest
/// `items` / media URLs — not treat the outer wrapper as the gallery.
pub fn parse_grok_wallpaper_payload(raw: &str) -> Option<serde_json::Value> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }

    // Envelope from --output-format json
    if let Ok(env) = serde_json::from_str::<serde_json::Value>(s) {
        if let Some(v) = gallery_from_value(&env) {
            return Some(v);
        }
        // Prefer structuredOutput when present and non-null
        if let Some(so) = env.get("structuredOutput") {
            if !so.is_null() {
                if let Some(v) = gallery_from_value(so) {
                    return Some(v);
                }
            }
        }
        // `text` is often a JSON string (or double-JSON) of the real answer
        if let Some(text) = env.get("text").and_then(|t| t.as_str()) {
            if let Some(v) = parse_model_text_payload(text) {
                return Some(v);
            }
        }
    }

    // Bare model text / fenced JSON
    if let Some(v) = parse_model_text_payload(s) {
        return Some(v);
    }

    None
}

fn gallery_from_value(v: &serde_json::Value) -> Option<serde_json::Value> {
    if v.get("items").and_then(|i| i.as_array()).is_some() {
        return Some(v.clone());
    }
    if v.as_array().is_some() {
        return Some(json!({ "items": v }));
    }
    None
}

fn parse_model_text_payload(text: &str) -> Option<serde_json::Value> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }

    // Fenced ```json
    if let Some(start) = t.find("```") {
        let after = &t[start + 3..];
        let body = after
            .strip_prefix("json")
            .or_else(|| after.strip_prefix("JSON"))
            .unwrap_or(after);
        if let Some(end) = body.find("```") {
            let inner = body[..end].trim();
            if let Some(v) = parse_one_or_many_json_objects(inner) {
                return Some(v);
            }
        }
    }

    if let Some(v) = parse_one_or_many_json_objects(t) {
        return Some(v);
    }

    // Last resort: scrape pbs.twimg.com / video.twimg.com URLs from free text
    harvest_media_urls_as_items(t)
}

/// Parse a single JSON object, or several brace-balanced objects concatenated
/// (common when the model prints a stub then the real payload).
fn parse_one_or_many_json_objects(s: &str) -> Option<serde_json::Value> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(s.trim()) {
        return gallery_from_value(&v).or(Some(v));
    }

    let mut merged_items: Vec<serde_json::Value> = Vec::new();
    let mut found_any = false;
    for obj in iter_json_objects(s) {
        found_any = true;
        if let Some(arr) = obj.get("items").and_then(|a| a.as_array()) {
            merged_items.extend(arr.iter().cloned());
        } else if let Some(arr) = obj.as_array() {
            merged_items.extend(arr.iter().cloned());
        } else if obj.get("fullUrl").is_some()
            || obj.get("full_url").is_some()
            || obj.get("url").is_some()
            || obj.get("localPath").is_some()
            || obj.get("local_path").is_some()
        {
            merged_items.push(obj);
        }
    }
    if !merged_items.is_empty() {
        return Some(json!({ "items": merged_items }));
    }
    if found_any {
        // Objects existed but no items — still return empty items for callers
        return Some(json!({ "items": [] }));
    }
    None
}

/// Yield successive top-level `{...}` slices (string-aware brace matching).
fn iter_json_objects(s: &str) -> Vec<serde_json::Value> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }
        let start = i;
        let mut depth = 0i32;
        let mut in_str = false;
        let mut escape = false;
        let mut end = None;
        while i < bytes.len() {
            let c = bytes[i];
            if in_str {
                if escape {
                    escape = false;
                } else if c == b'\\' {
                    escape = true;
                } else if c == b'"' {
                    in_str = false;
                }
            } else {
                match c {
                    b'"' => in_str = true,
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(i);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        if let Some(e) = end {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s[start..=e]) {
                out.push(v);
            }
            i = e + 1;
        } else {
            break;
        }
    }
    out
}

/// Pull image/video CDN URLs out of free-form model text.
fn harvest_media_urls_as_items(text: &str) -> Option<serde_json::Value> {
    let mut urls: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    // Match http(s) URLs that look like media CDN paths
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rest = &text[i..];
        let Some(rel) = rest.find("http://").or_else(|| rest.find("https://")) else {
            break;
        };
        let start = i + rel;
        let after = &text[start..];
        let end_rel = after
            .find(|c: char| {
                c.is_whitespace()
                    || c == '"'
                    || c == '\''
                    || c == ')'
                    || c == ']'
                    || c == '}'
                    || c == '<'
                    || c == '>'
                    || c == '`'
            })
            .unwrap_or(after.len());
        let mut url = after[..end_rel]
            .trim_end_matches(['.', ',', ';', ':'])
            .to_string();
        // Strip trailing backslash escapes from JSON strings
        while url.ends_with('\\') {
            url.pop();
        }
        i = start + end_rel.max(1);

        let norm = normalize_media_url(&url);
        if norm.is_empty() || !is_gallery_media_url(&norm) || !seen.insert(norm.clone()) {
            continue;
        }
        urls.push(norm);
    }
    if urls.is_empty() {
        return None;
    }
    let items: Vec<serde_json::Value> = urls
        .into_iter()
        .map(|u| json!({ "fullUrl": u, "kind": "image" }))
        .collect();
    Some(json!({ "items": items }))
}

/// Backward-compatible alias used by older call sites / tests.
fn extract_json_object(raw: &str) -> Option<serde_json::Value> {
    parse_grok_wallpaper_payload(raw)
}

pub(crate) fn run_grok_headless(
    cli_path: &str,
    prompt: &str,
    schema: &str,
    max_turns: u32,
    timeout: Duration,
    cwd: Option<&Path>,
) -> Result<String, String> {
    let mut cmd = Command::new(cli_path);
    cmd.arg("-p")
        .arg(prompt)
        .arg("--always-approve")
        .arg("--max-turns")
        .arg(max_turns.to_string())
        .arg("--effort")
        .arg("low")
        .arg("--json-schema")
        .arg(schema)
        .arg("--output-format")
        .arg("json");
    // Headless background-wait policy (CLI 0.2.117+); soft-fail older builds.
    {
        let settings = crate::store::load_settings();
        let ver = crate::cli_probe::read_version_of(std::path::Path::new(cli_path));
        for a in
            crate::acp_client::background_wait_spawn_flags_from_settings(&settings, ver.as_deref())
        {
            cmd.arg(a);
        }
    }
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    proxy::apply_to_std_command(&mut cmd);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("cli spawn: {e}"))?;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut stdout);
                }
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                if !status.success() && stdout.trim().is_empty() {
                    tracing::warn!("wallpaper source cli failed: {stderr}");
                    return Err("search_failed".into());
                }
                if stdout.trim().is_empty() {
                    tracing::warn!("wallpaper source empty stdout: {stderr}");
                    return Err("empty".into());
                }
                return Ok(stdout);
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("timeout".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("cli wait: {e}")),
        }
    }
}

// ── Parse gallery from model JSON ───────────────────────────────────────────

fn parse_gallery_items(value: &serde_json::Value, source: &str) -> Vec<WallpaperGalleryItem> {
    let arr = value
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default();

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, raw) in arr.iter().enumerate() {
        let full = raw
            .get("fullUrl")
            .or_else(|| raw.get("full_url"))
            .or_else(|| raw.get("url"))
            .or_else(|| raw.get("imageUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if full.is_empty() {
            continue;
        }
        let full_norm = normalize_media_url(&full);
        if !seen.insert(full_norm.clone()) {
            continue;
        }
        let thumb = raw
            .get("thumbUrl")
            .or_else(|| raw.get("thumb_url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| full_norm.clone());
        let kind = raw
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("image")
            .to_string();
        let id = raw
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{source}-{i}-{}", short_hash(&full_norm)));
        out.push(WallpaperGalleryItem {
            id,
            thumb_url: thumb,
            full_url: full_norm,
            kind,
            width: raw.get("width").and_then(|v| v.as_u64()).map(|n| n as u32),
            height: raw.get("height").and_then(|v| v.as_u64()).map(|n| n as u32),
            source: source.into(),
            username: raw
                .get("username")
                .and_then(|v| v.as_str())
                .map(|s| s.trim_start_matches('@').to_string()),
            post_url: {
                let username = raw
                    .get("username")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim_start_matches('@'));
                raw.get("postUrl")
                    .or_else(|| raw.get("post_url"))
                    .or_else(|| raw.get("statusUrl"))
                    .or_else(|| raw.get("status_url"))
                    .and_then(|v| v.as_str())
                    .and_then(|s| normalize_status_url(s, username))
            },
            text_preview: raw
                .get("textPreview")
                .or_else(|| raw.get("text_preview"))
                .and_then(|v| v.as_str())
                .map(|s| s.chars().take(160).collect()),
            likes: raw.get("likes").and_then(|v| v.as_i64()),
            local_path: raw
                .get("localPath")
                .or_else(|| raw.get("local_path"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            prompt: raw
                .get("prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    out
}

fn short_hash(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    let d = h.finalize();
    format!("{:x}", u32::from_be_bytes([d[0], d[1], d[2], d[3]]))
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Expand the user keyword into stronger X search guidance (still one agent call).
fn build_x_search_prompt(user_query: &str, sort: &str) -> String {
    format!(
        r#"You collect high-quality still images from X (Twitter) for a desktop wallpaper picker.

User topic (raw): {user_query}

Search strategy (use X tools; sort = {sort}):
1. Expand the user topic into 2–4 effective queries before searching. Prefer posts that:
   - Share AI image-generation prompts (prompt share / Midjourney / Flux / SD / Grok Imagine / "prompt" / 提示词 / 咒语)
   - Attach real photos or AI art suitable as wallpaper (landscape, scenery, aesthetic stills)
2. Always require media: use filter:images (or media). Prefer higher engagement (likes/reposts) when sort is Top.
3. Prefer posts that include BOTH the prompt text and attached images; if none, fall back to high-quality image posts about the topic.
4. Skip low quality: memes with heavy text overlays, screenshots of chat UI, profile avatars, emoji packs, ads, pure text cards, blurry thumbs, broken/placeholder links.
5. Collect distinct direct IMAGE CDN URLs only for fullUrl — prefer https://pbs.twimg.com/media/… (name=orig or full size). Never put status page URLs in fullUrl.
6. Always set postUrl to the real canonical status link `https://x.com/<user>/status/<id>` when the post is known. Never invent or guess a status id. If you cannot confirm the status URL, omit postUrl (client will mark the tile Unverified).
7. Return exactly ONE JSON object matching the schema (items array, 12–28 when possible). No prose, no second JSON object, no placeholder.jpg.

Do not download files — metadata only.
"#
    )
}

/// Keep only gallery-worthy media URLs (static filter before network probe).
fn filter_gallery_candidates(items: &mut Vec<WallpaperGalleryItem>) {
    items.retain(|it| {
        let u = it.full_url.trim();
        (u.starts_with("http://") || u.starts_with("https://")) && is_gallery_media_url(u)
    });
}

fn http_client_wallpaper() -> Result<reqwest::Client, String> {
    proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(6))
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
    )
    .build()
    .map_err(|e| format!("http client: {e}"))
}

/// Probe whether a remote URL is a reachable image (filters broken gallery thumbs).
pub async fn probe_image_reachable(client: &reqwest::Client, url: &str) -> bool {
    if !is_gallery_media_url(url) {
        return false;
    }
    // Prefer Range GET — many CDNs ignore HEAD or return wrong types.
    let resp = client
        .get(url)
        .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
        .header(reqwest::header::RANGE, "bytes=0-2047")
        .send()
        .await;
    let Ok(resp) = resp else {
        return false;
    };
    let status = resp.status().as_u16();
    // 200 full body or 206 partial
    if status != 200 && status != 206 {
        return false;
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !mime.is_empty()
        && !mime.starts_with("image/")
        && !mime.contains("octet-stream")
        && !mime.contains("binary")
    {
        // Some twimg responses omit useful type on Range; only reject clear non-images.
        if mime.starts_with("text/") || mime.contains("html") || mime.contains("json") {
            return false;
        }
    }
    matches!(resp.bytes().await, Ok(b) if b.len() >= 32)
}

/// Drop items whose fullUrl cannot be fetched as an image.
pub async fn filter_reachable_gallery_items(
    items: Vec<WallpaperGalleryItem>,
) -> Vec<WallpaperGalleryItem> {
    if items.is_empty() {
        return items;
    }
    let Ok(client) = http_client_wallpaper() else {
        return items;
    };
    // Bound concurrency
    const CHUNK: usize = 8;
    let mut out = Vec::with_capacity(items.len());
    for chunk in items.chunks(CHUNK) {
        let futs: Vec<_> = chunk
            .iter()
            .map(|it| {
                let url = it.full_url.clone();
                let client = client.clone();
                async move {
                    let ok = probe_image_reachable(&client, &url).await;
                    (ok, it.clone())
                }
            })
            .collect();
        let results = futures_util::future::join_all(futs).await;
        for (ok, it) in results {
            if ok {
                out.push(it);
            } else {
                tracing::debug!("wallpaper gallery: drop unreachable {}", it.full_url);
            }
        }
    }
    out
}

/// Sync headless search only (no network probe). Prefer [`x_search_async`].
pub fn x_search(query: &str, sort: Option<&str>) -> WallpaperSearchResult {
    let q = query.trim();
    if q.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("empty query".into()),
        };
    }
    let cli = match require_cli_ready() {
        Ok(p) => p,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
            };
        }
    };

    let sort = match sort.unwrap_or("top") {
        "latest" | "Latest" => "Latest",
        _ => "Top",
    };

    let schema = r#"{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "fullUrl": { "type": "string" },
          "thumbUrl": { "type": "string" },
          "username": { "type": "string" },
          "postUrl": { "type": "string" },
          "textPreview": { "type": "string" },
          "likes": { "type": "number" },
          "kind": { "type": "string" }
        },
        "required": ["fullUrl"]
      }
    }
  },
  "required": ["items"]
}"#;

    let prompt = build_x_search_prompt(q, sort);

    let stdout = match run_grok_headless(&cli, &prompt, schema, 14, X_SEARCH_TIMEOUT, None) {
        Ok(s) => s,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
            };
        }
    };

    let value = match extract_json_object(&stdout) {
        Some(v) => v,
        None => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some("search_failed".into()),
                message: Some("could not parse search JSON".into()),
            };
        }
    };

    let mut items = parse_gallery_items(&value, "x");
    filter_gallery_candidates(&mut items);

    if items.is_empty() {
        if let Some(v) = harvest_media_urls_as_items(&stdout) {
            items = parse_gallery_items(&v, "x");
            filter_gallery_candidates(&mut items);
        }
    }

    if items.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("no images found".into()),
        };
    }

    WallpaperSearchResult {
        items,
        error_code: None,
        message: None,
    }
}

/// Headless X search + drop unreachable media URLs before returning to UI.
pub async fn x_search_async(query: &str, sort: Option<&str>) -> WallpaperSearchResult {
    let query = query.to_string();
    let sort = sort.map(|s| s.to_string());
    let mut result =
        match tauri::async_runtime::spawn_blocking(move || x_search(&query, sort.as_deref())).await
        {
            Ok(r) => r,
            Err(e) => {
                return WallpaperSearchResult {
                    items: vec![],
                    error_code: Some("search_failed".into()),
                    message: Some(format!("join: {e}")),
                };
            }
        };

    if result.error_code.is_some() || result.items.is_empty() {
        return result;
    }

    let filtered = filter_reachable_gallery_items(result.items).await;
    if filtered.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("no downloadable images".into()),
        };
    }
    result.items = filtered;
    result
}

pub async fn fetch_media(url: &str, source: Option<&str>) -> Result<WallpaperFetchResult, String> {
    let normalized = normalize_media_url(url);
    if normalized.is_empty() {
        return Err("url_blocked".into());
    }
    // Allow local already-downloaded paths for re-apply
    if Path::new(&normalized).is_file() {
        return file_to_fetch_result(Path::new(&normalized));
    }
    if !is_allowed_media_url(&normalized) {
        return Err("url_blocked".into());
    }

    let client = proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(6))
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
    )
    .build()
    .map_err(|e| format!("http client: {e}"))?;

    let resp = client
        .get(&normalized)
        .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("download_failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("download_failed: HTTP {}", resp.status()));
    }

    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string();

    let mime_l = mime.to_ascii_lowercase();
    if mime_l.starts_with("text/") || mime_l.contains("html") || mime_l.contains("json") {
        return Err("download_failed: not an image".into());
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download_failed: {e}"))?;
    if bytes.is_empty() {
        return Err("download_failed: empty body".into());
    }
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("download_failed: too large".into());
    }
    // Reject tiny broken payloads
    if bytes.len() < 64 {
        return Err("download_failed: too small".into());
    }

    let src = source.unwrap_or("x");
    let ext = ext_from_mime_or_url(&mime, &normalized);
    let name = format!(
        "{}-{}.{}",
        chrono::Local::now().format("%H%M%S"),
        short_hash(&normalized),
        ext
    );
    let path = dated_subdir(src).join(&name);
    fs::write(&path, &bytes).map_err(|e| format!("write: {e}"))?;
    // Allow media:// reads for this file immediately.
    crate::path_scope::grant_path(&path);

    Ok(WallpaperFetchResult {
        path: path.display().to_string(),
        mime: if mime == "application/octet-stream" {
            mime_from_ext(&ext).to_string()
        } else {
            mime
        },
        bytes: bytes.len() as u64,
        name,
    })
}

fn file_to_fetch_result(path: &Path) -> Result<WallpaperFetchResult, String> {
    let meta = fs::metadata(path).map_err(|e| format!("stat: {e}"))?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("wallpaper")
        .to_string();
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("jpg");
    crate::path_scope::grant_path(path);
    Ok(WallpaperFetchResult {
        path: path.display().to_string(),
        mime: mime_from_ext(ext).to_string(),
        bytes: meta.len(),
        name,
    })
}

pub fn imagine(prompt: &str, aspect_ratio: Option<&str>) -> WallpaperSearchResult {
    let p = prompt.trim();
    if p.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("empty prompt".into()),
        };
    }
    let cli = match require_cli_ready() {
        Ok(c) => c,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
            };
        }
    };

    let ar = aspect_ratio.unwrap_or("16:9");
    let out_dir = dated_subdir("imagine");
    let out_dir_str = out_dir.display().to_string();

    let schema = r#"{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "localPath": { "type": "string" },
          "fullUrl": { "type": "string" },
          "prompt": { "type": "string" },
          "kind": { "type": "string" }
        },
        "required": ["localPath"]
      }
    }
  },
  "required": ["items"]
}"#;

    let agent_prompt = format!(
        r#"Generate wallpaper image(s) with the Imagine image_gen tool.

User prompt (use as the image prompt, refine lightly for wallpaper quality if needed):
{p}

Requirements:
1. Call image_gen with aspect_ratio "{ar}". Prefer one strong wallpaper-quality image (you may generate up to 2 variants with distinct prompts if helpful).
2. After generation, copy or move each resulting image file into this directory:
   {out_dir_str}
   Use clear filenames like wallpaper-1.jpg.
3. Return JSON items with localPath set to the absolute path of each saved file under that directory. kind should be "image".
4. Do not invent paths that do not exist on disk.
"#
    );

    let stdout = match run_grok_headless(
        &cli,
        &agent_prompt,
        schema,
        12,
        IMAGINE_TIMEOUT,
        Some(&out_dir),
    ) {
        Ok(s) => s,
        Err(code) => {
            // Honest codes for UI: keep auth_required / cli_missing / timeout;
            // map generic search_failed → imagine_failed.
            let code = match code.as_str() {
                "search_failed" => "imagine_failed".into(),
                other => other.to_string(),
            };
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
            };
        }
    };

    let value = match extract_json_object(&stdout) {
        Some(v) => v,
        None => {
            // Fallback: scan out_dir for any new images
            let scanned = scan_dir_as_gallery(&out_dir, "imagine", Some(p));
            if scanned.is_empty() {
                return WallpaperSearchResult {
                    items: vec![],
                    error_code: Some("imagine_failed".into()),
                    message: Some("could not parse imagine result".into()),
                };
            }
            return WallpaperSearchResult {
                items: scanned,
                error_code: None,
                message: None,
            };
        }
    };

    let mut items = parse_gallery_items(&value, "imagine");
    // Resolve local paths / grant scope
    for it in items.iter_mut() {
        if let Some(ref lp) = it.local_path {
            let path = PathBuf::from(lp);
            if path.is_file() {
                crate::path_scope::grant_path(&path);
                it.full_url = format!("file://{}", path.display());
                it.thumb_url = it.full_url.clone();
                it.kind = "image".into();
                if it.prompt.is_none() {
                    it.prompt = Some(p.to_string());
                }
            }
        }
    }
    items.retain(|it| {
        it.local_path
            .as_ref()
            .map(|p| Path::new(p).is_file())
            .unwrap_or(false)
    });

    if items.is_empty() {
        let scanned = scan_dir_as_gallery(&out_dir, "imagine", Some(p));
        if scanned.is_empty() {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some("empty".into()),
                message: Some("no image produced".into()),
            };
        }
        return WallpaperSearchResult {
            items: scanned,
            error_code: None,
            message: None,
        };
    }

    WallpaperSearchResult {
        items,
        error_code: None,
        message: None,
    }
}

fn scan_dir_as_gallery(
    dir: &Path,
    source: &str,
    prompt: Option<&str>,
) -> Vec<WallpaperGalleryItem> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .collect();
    entries.sort_by_key(|e| {
        std::cmp::Reverse(
            e.metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        )
    });

    let mut out = Vec::new();
    for (i, e) in entries.into_iter().take(12).enumerate() {
        let path = e.path();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "mp4" | "webm"
        ) {
            continue;
        }
        crate::path_scope::grant_path(&path);
        let path_str = path.display().to_string();
        let kind = if matches!(ext.as_str(), "mp4" | "webm") {
            "video"
        } else {
            "image"
        };
        out.push(WallpaperGalleryItem {
            id: format!("{source}-scan-{i}-{}", short_hash(&path_str)),
            thumb_url: format!("file://{path_str}"),
            full_url: format!("file://{path_str}"),
            kind: kind.into(),
            width: None,
            height: None,
            source: source.into(),
            username: None,
            post_url: None,
            text_preview: None,
            likes: None,
            local_path: Some(path_str),
            prompt: prompt.map(|s| s.to_string()),
        });
    }
    out
}

pub fn library_list(limit: Option<u32>) -> Result<Vec<WallpaperLibraryEntry>, String> {
    let root = wallpapers_root();
    let limit = limit.unwrap_or(48).clamp(1, 200) as usize;
    let mut all: Vec<WallpaperLibraryEntry> = Vec::new();
    collect_library(&root, &root, &mut all);
    all.sort_by_key(|b| std::cmp::Reverse(b.modified_ms));
    all.truncate(limit);
    for e in &all {
        crate::path_scope::grant_path(Path::new(&e.path));
    }
    Ok(all)
}

fn collect_library(root: &Path, dir: &Path, out: &mut Vec<WallpaperLibraryEntry>) {
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for e in rd.flatten() {
        let path = e.path();
        if path.is_dir() {
            collect_library(root, &path, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "mp4" | "webm"
        ) {
            continue;
        }
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let rel = path.strip_prefix(root).unwrap_or(&path);
        let source = rel
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("library")
            .to_string();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_string();
        let kind = if matches!(ext.as_str(), "mp4" | "webm") {
            "video"
        } else {
            "image"
        };
        out.push(WallpaperLibraryEntry {
            path: path.display().to_string(),
            name,
            source,
            kind: kind.into(),
            bytes: meta.len(),
            modified_ms,
        });
    }
}

/// True when `path` resolves under `root` (canonical when possible).
/// Pure helper for library delete allowlist tests and host checks.
pub fn is_path_under_dir(path: &Path, root: &Path) -> bool {
    let root_c = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let candidate = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else if let Some(parent) = path.parent() {
        let parent_c = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        parent_c.join(path.file_name().unwrap_or_default())
    } else {
        path.to_path_buf()
    };
    candidate.starts_with(&root_c)
}

/// Soft-delete a file under the app wallpapers root.
///
/// - Path outside wallpapers root → `path_not_allowed`
/// - Missing file → Ok (idempotent soft success)
/// - IO failure → `delete_failed: …` (caller soft-fails in UI)
pub fn library_delete(path: &str) -> Result<(), String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("path_not_allowed".into());
    }
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return Err("path_not_allowed".into());
    }
    let root = wallpapers_root();
    if !is_path_under_dir(&p, &root) {
        return Err("path_not_allowed".into());
    }
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        return Err("path_not_allowed".into());
    }
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete_failed: {e}")),
    }
}

// Ensure wallpapers dir exists on module use.
pub fn ensure_wallpaper_dirs() {
    let _ = paths::ensure_app_dirs();
    let root = wallpapers_root();
    let _ = fs::create_dir_all(root.join("x"));
    let _ = fs::create_dir_all(root.join("imagine"));
    let _ = fs::create_dir_all(root.join("library"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_twimg() {
        assert!(is_allowed_media_url(
            "https://pbs.twimg.com/media/HOUbJsYaEAAaEQ6.jpg"
        ));
        assert!(is_allowed_media_url(
            "https://pbs.twimg.com/media/foo?format=jpg&name=small"
        ));
        assert!(!is_allowed_media_url("https://evil.example/a.jpg"));
        assert!(!is_allowed_media_url("file:///etc/passwd"));
    }

    #[test]
    fn gallery_rejects_avatars_and_placeholders() {
        assert!(is_gallery_media_url(
            "https://pbs.twimg.com/media/HOUbJsYaEAAaEQ6.jpg"
        ));
        assert!(!is_gallery_media_url(
            "https://pbs.twimg.com/profile_images/1/abc_normal.jpg"
        ));
        assert!(!is_gallery_media_url(
            "https://pbs.twimg.com/media/placeholder.jpg"
        ));
        assert!(!is_gallery_media_url("https://evil.example/a.jpg"));
    }

    #[test]
    fn normalize_twimg_name_orig() {
        let u = normalize_media_url(
            "https://pbs.twimg.com/media/HOUbJsYaEAAaEQ6.jpg?format=jpg&name=small",
        );
        assert!(u.contains("name=orig"), "{u}");
    }

    #[test]
    fn normalize_twimg_legacy_colon_suffix() {
        assert_eq!(
            normalize_media_url("https://pbs.twimg.com/media/abc.jpg:small"),
            "https://pbs.twimg.com/media/abc.jpg:orig"
        );
        assert_eq!(
            normalize_media_url("https://pbs.twimg.com/media/abc.jpg:large"),
            "https://pbs.twimg.com/media/abc.jpg:orig"
        );
    }

    #[test]
    fn gallery_accepts_all_allowlisted_hosts() {
        // 下载白名单里的主机不能被画廊判定静默丢弃。
        assert!(is_gallery_media_url("https://filesystem.site/cdn/xyz.png"));
        assert!(is_gallery_media_url("https://abs.twimg.com/media/foo.jpg"));
    }

    #[test]
    fn extract_json_from_fence() {
        let raw = "here you go\n```json\n{\"items\":[{\"fullUrl\":\"https://pbs.twimg.com/media/a.jpg\"}]}\n```\n";
        let v = extract_json_object(raw).expect("json");
        let items = parse_gallery_items(&v, "x");
        assert_eq!(items.len(), 1);
        assert!(items[0].full_url.contains("pbs.twimg.com"));
    }

    #[test]
    fn parse_dedupes_urls() {
        let v = json!({
            "items": [
                { "fullUrl": "https://pbs.twimg.com/media/a.jpg" },
                { "fullUrl": "https://pbs.twimg.com/media/a.jpg" },
                { "fullUrl": "https://pbs.twimg.com/media/b.jpg", "username": "u" }
            ]
        });
        let items = parse_gallery_items(&v, "x");
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].username.as_deref(), Some("u"));
    }

    /// Real headless `grok -p --output-format json` shape (2026-07-28 probe).
    #[test]
    fn parse_headless_envelope_with_nested_text() {
        let raw = r#"{
  "text": "{\"items\":[{\"fullUrl\":\"https://pbs.twimg.com/media/placeholder.jpg\"}]}{\n  \"items\": [\n    { \"fullUrl\": \"https://pbs.twimg.com/media/HNccFHAWUAACNkL.jpg\" },\n    { \"fullUrl\": \"https://pbs.twimg.com/media/HNccFG2X0AE8gQ6.jpg\" },\n    { \"fullUrl\": \"https://pbs.twimg.com/media/HOOQSMDWYAAk0x4.png\" }\n  ]\n}",
  "stopReason": "EndTurn",
  "structuredOutput": null,
  "structuredOutputError": "model output was not valid JSON: trailing characters at line 1 column 70"
}"#;
        let v = parse_grok_wallpaper_payload(raw).expect("payload");
        let items = parse_gallery_items(&v, "x");
        // placeholder may still be present; filter like x_search does
        let real: Vec<_> = items
            .into_iter()
            .filter(|it| !it.full_url.to_ascii_lowercase().contains("placeholder"))
            .collect();
        assert!(
            real.len() >= 3,
            "expected real media urls, got {:?}",
            real.iter().map(|i| &i.full_url).collect::<Vec<_>>()
        );
        assert!(real
            .iter()
            .all(|i| i.full_url.contains("pbs.twimg.com/media/")));
    }

    #[test]
    fn parse_structured_output_field() {
        let raw = r#"{
          "text": "done",
          "structuredOutput": {
            "items": [
              { "fullUrl": "https://pbs.twimg.com/media/abc.jpg", "username": "u" }
            ]
          }
        }"#;
        let v = parse_grok_wallpaper_payload(raw).expect("payload");
        let items = parse_gallery_items(&v, "x");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].username.as_deref(), Some("u"));
    }

    #[test]
    fn harvest_urls_from_prose() {
        let raw = r#"I found these:
https://pbs.twimg.com/media/HNccFHAWUAACNkL.jpg
and https://pbs.twimg.com/media/HNccFG2X0AE8gQ6.jpg?format=jpg&name=small
"#;
        let v = parse_grok_wallpaper_payload(raw).expect("harvest");
        let items = parse_gallery_items(&v, "x");
        assert_eq!(items.len(), 2);
        assert!(items[1].full_url.contains("name=orig") || items[1].full_url.contains("HNccFG2"));
    }

    fn test_tmp_home(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("grok-app-wp-lib-{}-{}", label, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_path_under_dir_accepts_nested() {
        let tmp = test_tmp_home("under");
        let root = tmp.join("wallpapers");
        fs::create_dir_all(root.join("x").join("2026-08-01")).unwrap();
        let file = root.join("x").join("2026-08-01").join("a.jpg");
        fs::write(&file, b"hi").unwrap();
        assert!(is_path_under_dir(&file, &root));
        assert!(!is_path_under_dir(&tmp.join("other.jpg"), &root));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn library_delete_soft_and_scoped() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = test_tmp_home("del");
        // SAFETY: test-only, mutex-serialized GROK_APP_HOME mutation.
        unsafe {
            std::env::set_var("GROK_APP_HOME", &tmp);
        }
        ensure_wallpaper_dirs();
        let root = wallpapers_root();
        let file = root.join("imagine").join("2026-08-01");
        fs::create_dir_all(&file).unwrap();
        let img = file.join("w.png");
        fs::write(&img, b"png").unwrap();

        library_delete(&img.display().to_string()).expect("delete ok");
        assert!(!img.exists());
        // Idempotent soft success when already gone
        library_delete(&img.display().to_string()).expect("missing ok");

        let outside = tmp.join("escape.jpg");
        fs::write(&outside, b"x").unwrap();
        let err = library_delete(&outside.display().to_string()).unwrap_err();
        assert_eq!(err, "path_not_allowed");
        assert!(outside.exists());

        unsafe {
            std::env::remove_var("GROK_APP_HOME");
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn library_list_collects_x_and_imagine() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = test_tmp_home("list");
        unsafe {
            std::env::set_var("GROK_APP_HOME", &tmp);
        }
        ensure_wallpaper_dirs();
        let root = wallpapers_root();
        let xdir = root.join("x").join("2026-08-01");
        let idir = root.join("imagine").join("2026-08-01");
        fs::create_dir_all(&xdir).unwrap();
        fs::create_dir_all(&idir).unwrap();
        fs::write(xdir.join("a.jpg"), b"a").unwrap();
        fs::write(idir.join("b.png"), b"b").unwrap();
        fs::write(idir.join("skip.txt"), b"no").unwrap();

        let list = library_list(Some(10)).expect("list");
        assert_eq!(list.len(), 2);
        let sources: std::collections::HashSet<_> =
            list.iter().map(|e| e.source.as_str()).collect();
        assert!(sources.contains("x"));
        assert!(sources.contains("imagine"));
        assert!(list.iter().all(|e| e.kind == "image"));

        unsafe {
            std::env::remove_var("GROK_APP_HOME");
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn normalize_status_url_canonicalizes_and_drops_non_status() {
        assert_eq!(
            normalize_status_url(
                "https://twitter.com/FooBar/status/1234567890123456789?s=20",
                None
            )
            .as_deref(),
            Some("https://x.com/FooBar/status/1234567890123456789")
        );
        assert_eq!(
            normalize_status_url("https://x.com/i/status/1234567890123456789", Some("alice"))
                .as_deref(),
            Some("https://x.com/alice/status/1234567890123456789")
        );
        assert_eq!(
            normalize_status_url("https://x.com/i/status/1234567890123456789", None).as_deref(),
            Some("https://x.com/i/status/1234567890123456789")
        );
        assert!(normalize_status_url("https://pbs.twimg.com/media/a.jpg", Some("u")).is_none());
        assert!(normalize_status_url("https://x.com/alice", Some("alice")).is_none());
        assert!(extract_status_id_from_url("https://x.com/search?q=/status/12345678").is_none());
        assert!(extract_status_id_from_url("https://x.com/search#/status/12345678").is_none());
        assert!(
            extract_status_id_from_url("https://x.com/victim/photo?u=/status/99999999").is_none()
        );
        assert!(!is_canonical_x_status_url(
            "ftp://x.com/user/status/12345678"
        ));
        assert!(normalize_status_url("https://cdn.evil.com/x.com/status/12345678", None).is_none());
        assert!(
            normalize_status_url("https://x.com.evil.com/user/status/12345678", None).is_none()
        );
    }

    #[test]
    fn parse_gallery_items_normalizes_post_url() {
        let v = json!({
            "items": [
                {
                    "fullUrl": "https://pbs.twimg.com/media/a.jpg",
                    "username": "alice",
                    "postUrl": "https://twitter.com/alice/status/1234567890123456789"
                },
                {
                    "fullUrl": "https://pbs.twimg.com/media/b.jpg",
                    "username": "bob"
                }
            ]
        });
        let items = parse_gallery_items(&v, "x");
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].post_url.as_deref(),
            Some("https://x.com/alice/status/1234567890123456789")
        );
        assert!(items[1].post_url.is_none());
    }
}
