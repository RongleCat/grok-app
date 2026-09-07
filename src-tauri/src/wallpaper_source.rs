//! Wallpaper source: X search + Imagine generate via headless Grok CLI,
//! plus allowlisted media download into the app wallpaper library.

#![allow(dead_code)] // residual-clippy: kind_from_mime
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cli_probe;
use crate::paths;
use crate::process_util;
use crate::proxy;
use crate::store;

const MAX_WALLPAPER_CLI_STDOUT_BYTES: usize = 2 * 1024 * 1024;
const WALLPAPER_CLI_OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
/// Max bytes for a single wallpaper media download.
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
/// Enough prefix data to verify a real image and usually recover dimensions,
/// without buffering a full response when a CDN ignores Range.
const MAX_IMAGE_PROBE_BYTES: usize = 64 * 1024;
const MIN_IMAGE_PROBE_BYTES: usize = 32;
const MAX_X_GALLERY_CANDIDATES: usize = 40;
const MAX_X_GALLERY_RESULTS: usize = 16;
const MIN_X_GALLERY_RESULTS_BEFORE_SUPPLEMENT: usize = 6;
pub(crate) const X_SEARCH_FIRST_ROUND_CALLS: u32 = 2;
pub(crate) const X_SEARCH_SUPPLEMENT_CALLS: u32 = 1;
pub(crate) const X_SEARCH_TOTAL_CALLS: u32 = X_SEARCH_FIRST_ROUND_CALLS + X_SEARCH_SUPPLEMENT_CALLS;
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
    /// Host-only evidence used by the shared X quality pipeline. These fields
    /// never cross IPC and cannot expose extra account or post information.
    #[serde(skip)]
    pub(crate) status_id: Option<String>,
    #[serde(skip)]
    pub(crate) media_index: Option<u8>,
    #[serde(skip)]
    pub(crate) media_quality: Option<WallpaperMediaQuality>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct WallpaperMediaQuality {
    declared_image_mime: bool,
    dimensions_verified: bool,
    content_length: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperSearchResult {
    pub items: Vec<WallpaperGalleryItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<WallpaperSearchMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperSearchMeta {
    pub request_id: Option<String>,
    pub requested_mode: String,
    pub route_used: String,
    pub fallback_reason: Option<String>,
    pub duration_ms: u64,
    pub cache_hit: bool,
    pub search_calls: Option<u32>,
    pub candidate_count: usize,
    pub valid_count: usize,
    pub model: Option<String>,
    pub effort: Option<String>,
}

#[derive(Clone)]
pub(crate) struct WallpaperSearchCancellation {
    inner: Arc<WallpaperSearchCancellationInner>,
}

struct WallpaperSearchCancellationInner {
    cancelled: AtomicBool,
    signal: tokio::sync::watch::Sender<bool>,
}

impl Default for WallpaperSearchCancellation {
    fn default() -> Self {
        let (signal, _receiver) = tokio::sync::watch::channel(false);
        Self {
            inner: Arc::new(WallpaperSearchCancellationInner {
                cancelled: AtomicBool::new(false),
                signal,
            }),
        }
    }
}

impl WallpaperSearchCancellation {
    pub(crate) fn cancel(&self) {
        if !self.inner.cancelled.swap(true, Ordering::AcqRel) {
            self.inner.signal.send_replace(true);
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        let mut receiver = self.inner.signal.subscribe();
        while !self.is_cancelled() && !*receiver.borrow() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WallpaperXSearchStage {
    Preparing,
    SearchingX,
    Validating,
    Supplementing,
    FallingBack,
    Done,
}

#[derive(Clone)]
pub(crate) struct WallpaperXSearchRuntime {
    cancellation: WallpaperSearchCancellation,
    progress: Arc<dyn Fn(WallpaperXSearchStage) + Send + Sync>,
}

impl WallpaperXSearchRuntime {
    pub(crate) fn new(
        cancellation: WallpaperSearchCancellation,
        progress: Arc<dyn Fn(WallpaperXSearchStage) + Send + Sync>,
    ) -> Self {
        Self {
            cancellation,
            progress,
        }
    }

    #[cfg(test)]
    pub(crate) fn quiet() -> Self {
        Self::new(WallpaperSearchCancellation::default(), Arc::new(|_| {}))
    }

    pub(crate) fn cancellation(&self) -> &WallpaperSearchCancellation {
        &self.cancellation
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub(crate) fn report(&self, stage: WallpaperXSearchStage) {
        if !self.is_cancelled() || stage == WallpaperXSearchStage::Done {
            (self.progress)(stage);
        }
    }
}

#[derive(Debug)]
pub(crate) struct WallpaperCliSearchOutcome {
    pub(crate) result: WallpaperSearchResult,
    pub(crate) candidate_count: usize,
    pub(crate) valid_count: usize,
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
            let format = u
                .query_pairs()
                .find(|(key, _)| key.eq_ignore_ascii_case("format"))
                .map(|(_, value)| value.into_owned());
            u.set_fragment(None);
            u.set_query(None);
            {
                let mut query = u.query_pairs_mut();
                if let Some(format) = format.filter(|value| !value.trim().is_empty()) {
                    query.append_pair("format", &format);
                }
                query.append_pair("name", "orig");
            }
            return u.to_string();
        }
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        if let Ok(mut parsed) = url::Url::parse(trimmed) {
            parsed.set_fragment(None);
            return parsed.to_string();
        }
    }
    trimmed.to_string()
}

/// Hosts allowed for wallpaper downloads (X CDN + common xAI/Imagine assets).
pub fn is_allowed_media_url(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url.trim()) else {
        return false;
    };
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port_or_known_default() != Some(443)
    {
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

fn should_follow_media_redirect(url: &url::Url, previous_hops: usize) -> bool {
    previous_hops < 6 && is_allowed_media_url(url.as_str())
}

fn media_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if should_follow_media_redirect(attempt.url(), attempt.previous().len()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
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
        "avif" => "image/avif",
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
    if m.contains("avif") {
        return "avif".into();
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

fn configure_wallpaper_process_tree(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: this runs in the child immediately before exec. A dedicated
        // session lets timeout cleanup terminate the CLI and all descendants.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    let _ = cmd;
}

fn terminate_wallpaper_process_tree(child: &mut std::process::Child) {
    let pid = child.id();
    #[cfg(windows)]
    {
        let _ = process_util::command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        // The child called setsid(), so its pid is also the process-group id.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
        std::thread::sleep(Duration::from_millis(150));
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

struct WallpaperCliOutputReaders {
    stop: Arc<AtomicBool>,
    stdout_result: std::sync::mpsc::Receiver<io::Result<WallpaperCliStdout>>,
    stdout_thread: std::thread::JoinHandle<()>,
    stderr_result: std::sync::mpsc::Receiver<io::Result<()>>,
    stderr_thread: std::thread::JoinHandle<()>,
}

struct WallpaperCliStdout {
    bytes: Vec<u8>,
    exceeded_limit: bool,
}

impl WallpaperCliOutputReaders {
    fn start(child: &mut std::process::Child) -> Result<Self, String> {
        let Some(mut stdout) = child.stdout.take() else {
            terminate_wallpaper_process_tree(child);
            return Err("cli stdout unavailable".into());
        };
        let Some(mut stderr) = child.stderr.take() else {
            terminate_wallpaper_process_tree(child);
            return Err("cli stderr unavailable".into());
        };

        let stop = Arc::new(AtomicBool::new(false));
        let stdout_stop = Arc::clone(&stop);
        let (stdout_tx, stdout_result) = std::sync::mpsc::sync_channel(1);
        let stdout_thread = match std::thread::Builder::new()
            .name("wallpaper-cli-stdout".into())
            .spawn(move || {
                let result = drain_wallpaper_cli_stdout(&mut stdout, &stdout_stop);
                let _ = stdout_tx.send(result);
            }) {
            Ok(thread) => thread,
            Err(error) => {
                terminate_wallpaper_process_tree(child);
                return Err(format!("cli stdout reader: {error}"));
            }
        };

        let stderr_stop = Arc::clone(&stop);
        let (stderr_tx, stderr_result) = std::sync::mpsc::sync_channel(1);
        let stderr_thread = match std::thread::Builder::new()
            .name("wallpaper-cli-stderr".into())
            .spawn(move || {
                let result = drain_wallpaper_cli_stderr(&mut stderr, &stderr_stop);
                let _ = stderr_tx.send(result);
            }) {
            Ok(thread) => thread,
            Err(error) => {
                stop.store(true, Ordering::Release);
                terminate_wallpaper_process_tree(child);
                let _ = stdout_thread.join();
                return Err(format!("cli stderr reader: {error}"));
            }
        };

        Ok(Self {
            stop,
            stdout_result,
            stdout_thread,
            stderr_result,
            stderr_thread,
        })
    }

    fn finish(self) -> Result<String, String> {
        self.finish_with_timeout(WALLPAPER_CLI_OUTPUT_DRAIN_TIMEOUT)
    }

    /// Pipe handles can outlive the CLI when a detached descendant inherits
    /// them. Stop the non-blocking drains at the deadline and always join both
    /// threads before returning.
    fn finish_with_timeout(self, timeout: Duration) -> Result<String, String> {
        let deadline = Instant::now() + timeout;
        let stdout = receive_wallpaper_cli_reader(&self.stdout_result, deadline, "stdout");
        let stderr = receive_wallpaper_cli_reader(&self.stderr_result, deadline, "stderr");
        self.stop.store(true, Ordering::Release);
        let stdout_join = self.stdout_thread.join();
        let stderr_join = self.stderr_thread.join();

        if stdout_join.is_err() {
            return Err("cli stdout reader panicked".into());
        }
        if stderr_join.is_err() {
            return Err("cli stderr reader panicked".into());
        }
        let stdout = stdout?;
        if stdout.exceeded_limit {
            tracing::warn!("wallpaper source cli stdout exceeded size limit");
            return Err("search_failed".into());
        }
        stderr?;
        String::from_utf8(stdout.bytes).map_err(|_| "cli stdout was not valid utf-8".to_string())
    }

    fn stop(self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.stdout_thread.join();
        let _ = self.stderr_thread.join();
    }
}

fn receive_wallpaper_cli_reader<T>(
    receiver: &std::sync::mpsc::Receiver<io::Result<T>>,
    deadline: Instant,
    stream: &str,
) -> Result<T, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    match receiver.recv_timeout(remaining) {
        Ok(result) => result.map_err(|error| format!("cli {stream} read: {error}")),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            Err(format!("cli {stream} reader timeout"))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("cli {stream} reader panicked"))
        }
    }
}

fn drain_wallpaper_cli_stdout<R>(
    stdout: &mut R,
    stop: &AtomicBool,
) -> io::Result<WallpaperCliStdout>
where
    R: Read + WallpaperCliPipe,
{
    let mut bytes = Vec::new();
    let mut exceeded_limit = false;
    drain_wallpaper_cli_pipe(stdout, stop, |chunk| {
        if exceeded_limit {
            return;
        }
        let remaining = (MAX_WALLPAPER_CLI_STDOUT_BYTES + 1).saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if bytes.len() > MAX_WALLPAPER_CLI_STDOUT_BYTES {
            bytes.truncate(MAX_WALLPAPER_CLI_STDOUT_BYTES);
            exceeded_limit = true;
        }
    })?;
    Ok(WallpaperCliStdout {
        bytes,
        exceeded_limit,
    })
}

fn drain_wallpaper_cli_stderr<R>(stderr: &mut R, stop: &AtomicBool) -> io::Result<()>
where
    R: Read + WallpaperCliPipe,
{
    drain_wallpaper_cli_pipe(stderr, stop, |_| {})
}

fn drain_wallpaper_cli_pipe<R>(
    pipe: &mut R,
    stop: &AtomicBool,
    mut consume: impl FnMut(&[u8]),
) -> io::Result<()>
where
    R: Read + WallpaperCliPipe,
{
    pipe.prepare_nonblocking()?;
    let mut buffer = [0_u8; 16 * 1024];
    while !stop.load(Ordering::Acquire) {
        match pipe.read_available(&mut buffer)? {
            WallpaperCliPipeRead::Data(0) | WallpaperCliPipeRead::Eof => return Ok(()),
            WallpaperCliPipeRead::Data(read) => consume(&buffer[..read]),
            WallpaperCliPipeRead::Pending => {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    Ok(())
}

enum WallpaperCliPipeRead {
    Data(usize),
    Pending,
    Eof,
}

trait WallpaperCliPipe {
    fn prepare_nonblocking(&self) -> io::Result<()>;
    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<WallpaperCliPipeRead>;
}

#[cfg(unix)]
impl<T> WallpaperCliPipe for T
where
    T: Read + std::os::fd::AsRawFd,
{
    fn prepare_nonblocking(&self) -> io::Result<()> {
        let fd = std::os::fd::AsRawFd::as_raw_fd(self);
        // SAFETY: `fd` belongs to this live pipe. `fcntl` only reads/updates its
        // descriptor flags, and the reader thread owns the descriptor.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags == -1 {
            return Err(io::Error::last_os_error());
        }
        if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<WallpaperCliPipeRead> {
        match self.read(buffer) {
            Ok(read) => Ok(WallpaperCliPipeRead::Data(read)),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                Ok(WallpaperCliPipeRead::Pending)
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                Ok(WallpaperCliPipeRead::Pending)
            }
            Err(error) => Err(error),
        }
    }
}

#[cfg(windows)]
impl<T> WallpaperCliPipe for T
where
    T: Read + std::os::windows::io::AsRawHandle,
{
    fn prepare_nonblocking(&self) -> io::Result<()> {
        Ok(())
    }

    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<WallpaperCliPipeRead> {
        use windows::core::HRESULT;
        use windows::Win32::Foundation::{
            ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_NOT_CONNECTED, HANDLE,
        };
        use windows::Win32::System::Pipes::PeekNamedPipe;

        let mut available = 0_u32;
        // SAFETY: the raw handle is borrowed from this live ChildStdout/
        // ChildStderr. No buffer is passed; PeekNamedPipe only reports bytes.
        let peek = unsafe {
            PeekNamedPipe(
                HANDLE(self.as_raw_handle()),
                None,
                0,
                None,
                Some(&mut available),
                None,
            )
        };
        if let Err(error) = peek {
            let code = error.code();
            if code == HRESULT::from_win32(ERROR_BROKEN_PIPE.0)
                || code == HRESULT::from_win32(ERROR_NO_DATA.0)
                || code == HRESULT::from_win32(ERROR_PIPE_NOT_CONNECTED.0)
            {
                return Ok(WallpaperCliPipeRead::Eof);
            }
            return Err(io::Error::other(format!("peek pipe: {error}")));
        }
        if available == 0 {
            return Ok(WallpaperCliPipeRead::Pending);
        }
        let read_limit = buffer.len().min(available as usize);
        self.read(&mut buffer[..read_limit])
            .map(WallpaperCliPipeRead::Data)
    }
}

pub(crate) fn run_grok_headless(
    cli_path: &str,
    prompt: &str,
    schema: &str,
    max_turns: u32,
    timeout: Duration,
    cwd: Option<&Path>,
) -> Result<String, String> {
    run_grok_headless_cancellable(cli_path, prompt, schema, max_turns, timeout, cwd, None)
}

pub(crate) fn run_grok_headless_cancellable(
    cli_path: &str,
    prompt: &str,
    schema: &str,
    max_turns: u32,
    timeout: Duration,
    cwd: Option<&Path>,
    cancellation: Option<&WallpaperSearchCancellation>,
) -> Result<String, String> {
    if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
        return Err("cancelled".into());
    }
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
    configure_wallpaper_process_tree(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    proxy::apply_to_std_command(&mut cmd);

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("cli spawn: {e}"))?;
    let output_readers = WallpaperCliOutputReaders::start(&mut child)?;
    loop {
        if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
            terminate_wallpaper_process_tree(&mut child);
            output_readers.stop();
            return Err("cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = output_readers.finish()?;
                if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
                    return Err("cancelled".into());
                }
                if !status.success() && stdout.trim().is_empty() {
                    tracing::warn!("wallpaper source cli failed");
                    return Err("search_failed".into());
                }
                if stdout.trim().is_empty() {
                    tracing::warn!("wallpaper source empty stdout");
                    return Err("empty".into());
                }
                return Ok(stdout);
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    terminate_wallpaper_process_tree(&mut child);
                    output_readers.stop();
                    return Err("timeout".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                terminate_wallpaper_process_tree(&mut child);
                output_readers.stop();
                return Err(format!("cli wait: {e}"));
            }
        }
    }
}

// ── Parse gallery from model JSON ───────────────────────────────────────────

pub(crate) fn parse_gallery_items(
    value: &serde_json::Value,
    source: &str,
) -> Vec<WallpaperGalleryItem> {
    let arr = value
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default();

    let mut out = Vec::new();
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
        if full_norm.is_empty() {
            continue;
        }
        let thumb = raw
            .get("thumbUrl")
            .or_else(|| raw.get("thumb_url"))
            .and_then(|v| v.as_str())
            .map(normalize_media_url)
            .filter(|value| !value.is_empty())
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
        let username = raw
            .get("username")
            .and_then(|v| v.as_str())
            .map(|s| s.trim_start_matches('@').to_string())
            .filter(|value| !value.is_empty());
        let raw_post_url = raw
            .get("postUrl")
            .or_else(|| raw.get("post_url"))
            .or_else(|| raw.get("statusUrl"))
            .or_else(|| raw.get("status_url"))
            .and_then(|v| v.as_str());
        let status_id = raw_post_url.and_then(extract_status_id_from_url);
        let media_index = raw
            .get("mediaIndex")
            .or_else(|| raw.get("media_index"))
            .and_then(|value| {
                value
                    .as_u64()
                    .and_then(|index| u8::try_from(index).ok())
                    .or_else(|| value.as_str()?.parse::<u8>().ok())
            })
            .filter(|index| (1..=4).contains(index))
            .or_else(|| raw_post_url.and_then(extract_media_index_from_status_url));
        out.push(WallpaperGalleryItem {
            id,
            thumb_url: thumb,
            full_url: full_norm,
            kind,
            width: raw.get("width").and_then(|v| v.as_u64()).map(|n| n as u32),
            height: raw.get("height").and_then(|v| v.as_u64()).map(|n| n as u32),
            source: source.into(),
            username: username.clone(),
            post_url: raw_post_url.and_then(|url| normalize_status_url(url, username.as_deref())),
            text_preview: raw
                .get("textPreview")
                .or_else(|| raw.get("text_preview"))
                .and_then(|v| v.as_str())
                .map(|s| s.chars().take(160).collect()),
            likes: raw.get("likes").and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_u64().and_then(|n| i64::try_from(n).ok()))
            }),
            local_path: raw
                .get("localPath")
                .or_else(|| raw.get("local_path"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            prompt: raw
                .get("prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            status_id,
            media_index,
            media_quality: None,
        });
    }
    dedupe_gallery_items(out, false)
}

fn short_hash(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    let d = h.finalize();
    format!("{:x}", u32::from_be_bytes([d[0], d[1], d[2], d[3]]))
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Expand the user keyword into stronger X search guidance while keeping the
/// hosted tool budget explicit. The CLI does not expose a reliable call count,
/// so both rounds carry a hard textual budget and use separate processes.
fn build_x_search_prompt(
    user_query: &str,
    sort: &str,
    max_search_calls: u32,
    is_supplement: bool,
    seen_ids: &[String],
) -> String {
    let round_guidance = if is_supplement {
        format!(
            "Supplement round: use exactly one new query with a different visual angle (alternate composition, lighting, setting, season, or medium). Do not repeat candidates carrying any of these opaque media/post ids: {}",
            if seen_ids.is_empty() {
                "none from the empty first round".to_string()
            } else {
                seen_ids.join(", ")
            }
        )
    } else {
        "First round: use up to two complementary query variants. Cover the strongest direct interpretation of the topic and one useful visual/style variant."
            .to_string()
    };
    format!(
        r#"You collect high-quality still images from X (Twitter) for a desktop wallpaper picker.

User topic (raw): {user_query}

Search strategy (use X tools; sort = {sort}):
1. {round_guidance}
2. Use no more than {max_search_calls} hosted X search call(s) in this process. Prefer posts that:
   - Share AI image-generation prompts (prompt share / Midjourney / Flux / SD / Grok Imagine / "prompt" / 提示词 / 咒语)
   - Attach real photos or AI art suitable as wallpaper (landscape, scenery, aesthetic stills)
3. Always require media: use filter:images. Prefer higher engagement (likes/reposts) when sort is Top.
4. Prefer posts that include BOTH the prompt text and attached images; if none, fall back to high-quality image posts about the topic.
5. Skip low quality: memes with heavy text overlays, screenshots of chat UI, profile avatars, emoji packs, ads, pure text cards, blurry thumbs, broken/placeholder links.
6. Collect distinct direct IMAGE CDN URLs only for fullUrl — prefer https://pbs.twimg.com/media/… (name=orig or full size). Never put status page URLs in fullUrl.
7. Always set postUrl to the real canonical status link `https://x.com/<user>/status/<id>` when the post is known. Include mediaIndex 1–4 only when the status media position is known. Never invent or guess a status id. If you cannot confirm the status URL, omit postUrl (client will mark the tile Unverified).
8. Return exactly ONE JSON object matching the schema (items array, 8–16 when possible). No prose, no second JSON object, no placeholder.jpg.

Do not download files — metadata only.
"#
    )
}

/// Keep only gallery-worthy media URLs (static filter before network probe).
pub(crate) fn filter_gallery_candidates(items: &mut Vec<WallpaperGalleryItem>) {
    for item in items.iter_mut() {
        item.full_url = normalize_media_url(&item.full_url);
        item.thumb_url = normalize_media_url(&item.thumb_url);
        if item.thumb_url.is_empty() || !is_allowed_media_url(&item.thumb_url) {
            item.thumb_url = item.full_url.clone();
        }
        item.post_url = item
            .post_url
            .as_deref()
            .and_then(|url| normalize_status_url(url, item.username.as_deref()));
    }
    items.retain(|item| is_gallery_media_url(&item.full_url));
}

fn http_client_wallpaper() -> Result<reqwest::Client, String> {
    proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(media_redirect_policy())
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
    )
    .build()
    .map_err(|e| format!("http client: {e}"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DetectedMedia {
    Jpeg,
    Png,
    Gif,
    Webp,
    Avif,
    Mp4,
    Webm,
}

impl DetectedMedia {
    fn is_image(self) -> bool {
        matches!(
            self,
            Self::Jpeg | Self::Png | Self::Gif | Self::Webp | Self::Avif
        )
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Avif => "image/avif",
            Self::Mp4 => "video/mp4",
            Self::Webm => "video/webm",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Gif => "gif",
            Self::Webp => "webp",
            Self::Avif => "avif",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
        }
    }
}

#[derive(Debug)]
struct ImageProbe {
    dimensions: Option<(u32, u32)>,
    declared_image_mime: bool,
    content_length: Option<u64>,
}

fn detect_media_signature(bytes: &[u8]) -> Option<DetectedMedia> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(DetectedMedia::Jpeg);
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(DetectedMedia::Png);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(DetectedMedia::Gif);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(DetectedMedia::Webp);
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some(DetectedMedia::Webm);
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brands = &bytes[8..bytes.len().min(40)];
        if brands
            .as_chunks::<4>()
            .0
            .iter()
            .any(|brand| brand == b"avif" || brand == b"avis")
        {
            return Some(DetectedMedia::Avif);
        }
        if brands.as_chunks::<4>().0.iter().any(|brand| {
            matches!(
                brand,
                b"mif1" | b"msf1" | b"heic" | b"heix" | b"hevc" | b"hevx"
            )
        }) {
            return None;
        }
        return Some(DetectedMedia::Mp4);
    }
    None
}

fn image_dimensions_from_prefix(bytes: &[u8], media: DetectedMedia) -> Option<(u32, u32)> {
    match media {
        DetectedMedia::Png if bytes.len() >= 24 => Some((
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        )),
        DetectedMedia::Gif if bytes.len() >= 10 => Some((
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
        )),
        DetectedMedia::Jpeg => jpeg_dimensions(bytes),
        _ => None,
    }
    .filter(|(width, height)| *width > 0 && *height > 0)
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut cursor = 2usize;
    while cursor + 3 < bytes.len() {
        while cursor < bytes.len() && bytes[cursor] != 0xff {
            cursor += 1;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd8 || marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let segment_len =
            u16::from_be_bytes([*bytes.get(cursor)?, *bytes.get(cursor.checked_add(1)?)?]) as usize;
        if segment_len < 2 || cursor.checked_add(segment_len)? > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && segment_len >= 7
        {
            let height = u16::from_be_bytes([bytes[cursor + 3], bytes[cursor + 4]]) as u32;
            let width = u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]) as u32;
            return Some((width, height)).filter(|(width, height)| *width > 0 && *height > 0);
        }
        cursor += segment_len;
    }
    None
}

fn normalized_content_type(value: Option<&reqwest::header::HeaderValue>) -> String {
    value
        .and_then(|header| header.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn content_type_matches_signature(content_type: &str, media: DetectedMedia) -> bool {
    if content_type.is_empty()
        || content_type == "application/octet-stream"
        || content_type.contains("binary")
    {
        return true;
    }
    match media {
        DetectedMedia::Jpeg => matches!(content_type, "image/jpeg" | "image/jpg" | "image/pjpeg"),
        DetectedMedia::Png => content_type == "image/png",
        DetectedMedia::Gif => content_type == "image/gif",
        DetectedMedia::Webp => content_type == "image/webp",
        DetectedMedia::Avif => content_type == "image/avif",
        DetectedMedia::Mp4 => matches!(content_type, "video/mp4" | "application/mp4"),
        DetectedMedia::Webm => content_type == "video/webm",
    }
}

fn response_total_length(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|total| total.parse::<u64>().ok())
        .or_else(|| response.content_length())
}

pub(crate) fn is_complete_download_response(status: u16, has_content_range: bool) -> bool {
    status == 200 && !has_content_range
}

async fn read_response_prefix(
    response: &mut reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, reqwest::Error> {
    let mut prefix = Vec::with_capacity(limit);
    while prefix.len() < limit {
        let Some(chunk) = response.chunk().await? else {
            break;
        };
        let remaining = limit - prefix.len();
        prefix.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if chunk.len() >= remaining {
            break;
        }
    }
    Ok(prefix)
}

async fn read_response_body_bounded(
    response: &mut reqwest::Response,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let initial_capacity = response
        .content_length()
        .unwrap_or(0)
        .min(limit)
        .min(1024 * 1024)
        .try_into()
        .unwrap_or(0usize);
    let mut body = Vec::with_capacity(initial_capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "download_failed: network".to_string())?
    {
        let next_len = (body.len() as u64).saturating_add(chunk.len() as u64);
        if next_len > limit {
            return Err("download_failed: too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn inspect_image_url(client: &reqwest::Client, url: &str) -> Option<ImageProbe> {
    if !is_gallery_media_url(url) {
        return None;
    }
    let mut response = client
        .get(url)
        .header(
            "Accept",
            "image/jpeg,image/png,image/webp;q=0.9,image/avif;q=0.8,image/*;q=0.7,*/*;q=0.5",
        )
        .header(
            reqwest::header::RANGE,
            format!("bytes=0-{}", MAX_IMAGE_PROBE_BYTES - 1),
        )
        .send()
        .await
        .ok()?;
    if !matches!(response.status().as_u16(), 200 | 206)
        || !is_allowed_media_url(response.url().as_str())
    {
        return None;
    }
    let content_length = response_total_length(&response);
    if content_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return None;
    }
    let content_type =
        normalized_content_type(response.headers().get(reqwest::header::CONTENT_TYPE));
    let prefix = read_response_prefix(&mut response, MAX_IMAGE_PROBE_BYTES)
        .await
        .ok()?;
    if prefix.len() < MIN_IMAGE_PROBE_BYTES {
        return None;
    }
    let media = detect_media_signature(&prefix)?;
    if !media.is_image() || !content_type_matches_signature(&content_type, media) {
        return None;
    }
    Some(ImageProbe {
        dimensions: image_dimensions_from_prefix(&prefix, media),
        declared_image_mime: content_type.starts_with("image/"),
        content_length,
    })
}

/// Probe whether a remote URL is a reachable image (filters broken gallery thumbs).
pub async fn probe_image_reachable(client: &reqwest::Client, url: &str) -> bool {
    inspect_image_url(client, url).await.is_some()
}

fn merge_gallery_item(existing: &mut WallpaperGalleryItem, incoming: WallpaperGalleryItem) {
    let existing_dimensions_verified = existing
        .media_quality
        .as_ref()
        .is_some_and(|quality| quality.dimensions_verified);
    let incoming_dimensions_verified = incoming
        .media_quality
        .as_ref()
        .is_some_and(|quality| quality.dimensions_verified);
    if existing.post_url.is_none() && incoming.post_url.is_some() {
        existing.post_url = incoming.post_url;
    }
    if existing.username.is_none() && incoming.username.is_some() {
        existing.username = incoming.username;
    }
    if existing.text_preview.is_none() && incoming.text_preview.is_some() {
        existing.text_preview = incoming.text_preview;
    }
    if existing.prompt.is_none() && incoming.prompt.is_some() {
        existing.prompt = incoming.prompt;
    }
    existing.likes = match (existing.likes, incoming.likes) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (None, value) => value,
        (value, None) => value,
    };
    if existing.status_id.is_none() {
        existing.status_id = incoming.status_id;
    }
    if existing.media_index.is_none() {
        existing.media_index = incoming.media_index;
    }
    let incoming_pixels = incoming
        .width
        .zip(incoming.height)
        .map(|(width, height)| u64::from(width) * u64::from(height));
    let existing_pixels = existing
        .width
        .zip(existing.height)
        .map(|(width, height)| u64::from(width) * u64::from(height));
    if (incoming_dimensions_verified && !existing_dimensions_verified)
        || (incoming_dimensions_verified == existing_dimensions_verified
            && incoming_pixels > existing_pixels)
    {
        existing.width = incoming.width;
        existing.height = incoming.height;
    }
    if let Some(incoming_quality) = incoming.media_quality {
        if let Some(existing_quality) = existing.media_quality.as_mut() {
            existing_quality.declared_image_mime |= incoming_quality.declared_image_mime;
            existing_quality.dimensions_verified |= incoming_quality.dimensions_verified;
            existing_quality.content_length = match (
                existing_quality.content_length,
                incoming_quality.content_length,
            ) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (None, value) => value,
                (value, None) => value,
            };
        } else {
            existing.media_quality = Some(incoming_quality);
        }
    }
}

fn dedupe_gallery_items(
    items: Vec<WallpaperGalleryItem>,
    include_status_media: bool,
) -> Vec<WallpaperGalleryItem> {
    let mut out: Vec<WallpaperGalleryItem> = Vec::with_capacity(items.len());
    for item in items {
        let media_key = normalized_media_identity(&item.full_url);
        let status_key = include_status_media
            .then(|| status_media_identity(&item))
            .flatten();
        if let Some(index) = out.iter().position(|existing| {
            let same_media =
                media_key.is_some() && normalized_media_identity(&existing.full_url) == media_key;
            let same_status = status_key.is_some() && status_media_identity(existing) == status_key;
            same_media || same_status
        }) {
            merge_gallery_item(&mut out[index], item);
        } else {
            out.push(item);
        }
    }
    out
}

fn gallery_rank_score(item: &WallpaperGalleryItem) -> i64 {
    let mut score = 0i64;
    if let Some(quality) = &item.media_quality {
        if quality.declared_image_mime {
            score += 5_000;
        }
        if quality.dimensions_verified {
            score += 1_000;
        }
        if quality
            .content_length
            .is_some_and(|bytes| bytes >= 128 * 1024)
        {
            score += 150;
        }
    }
    if item.post_url.is_some() {
        score += 1_500;
    }
    if let Some((width, height)) = item.width.zip(item.height) {
        let pixels = u64::from(width) * u64::from(height);
        score += (pixels / 500_000).min(4_000) as i64;
        let ratio = width as f64 / height.max(1) as f64;
        let wallpaper_ratio = [16.0 / 9.0, 9.0 / 16.0, 21.0 / 9.0, 4.0 / 3.0]
            .into_iter()
            .any(|target| (ratio - target).abs() <= 0.2);
        if wallpaper_ratio {
            score += 750;
        }
    }
    if let Some(likes) = item.likes.filter(|likes| *likes > 0) {
        score += ((likes as f64 + 1.0).log2() * 60.0).min(900.0) as i64;
    }
    if item.prompt.is_some() {
        score += 100;
    }
    if item.text_preview.is_some() {
        score += 50;
    }
    if item.full_url.contains("pbs.twimg.com/media/") {
        score += 100;
    }
    score
}

pub(crate) fn merge_rank_x_gallery_items(
    items: Vec<WallpaperGalleryItem>,
) -> Vec<WallpaperGalleryItem> {
    let mut items = dedupe_gallery_items(items, true);
    items.sort_by_key(|item| std::cmp::Reverse(gallery_rank_score(item)));
    items.truncate(MAX_X_GALLERY_RESULTS);
    items
}

pub(crate) fn x_gallery_needs_supplement(valid_count: usize) -> bool {
    valid_count < MIN_X_GALLERY_RESULTS_BEFORE_SUPPLEMENT
}

/// Drop items whose fullUrl cannot be fetched as an image.
pub(crate) async fn filter_reachable_gallery_items_cancellable(
    mut items: Vec<WallpaperGalleryItem>,
    cancellation: Option<&WallpaperSearchCancellation>,
) -> Vec<WallpaperGalleryItem> {
    if items.is_empty() {
        return items;
    }
    if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
        return Vec::new();
    }
    filter_gallery_candidates(&mut items);
    items = dedupe_gallery_items(items, false);
    if items.len() > MAX_X_GALLERY_CANDIDATES {
        items.truncate(MAX_X_GALLERY_CANDIDATES);
    }
    let Ok(client) = http_client_wallpaper() else {
        return Vec::new();
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
                    let probe = inspect_image_url(&client, &url).await;
                    (probe, it.clone())
                }
            })
            .collect();
        let joined = futures_util::future::join_all(futs);
        let results = if let Some(cancellation) = cancellation {
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Vec::new(),
                results = joined => results,
            }
        } else {
            joined.await
        };
        for (probe, mut it) in results {
            if let Some(probe) = probe {
                if let Some((width, height)) = probe.dimensions {
                    it.width = Some(width);
                    it.height = Some(height);
                }
                it.kind = "image".into();
                it.media_quality = Some(WallpaperMediaQuality {
                    declared_image_mime: probe.declared_image_mime,
                    dimensions_verified: probe.dimensions.is_some(),
                    content_length: probe.content_length,
                });
                out.push(it);
            } else {
                tracing::debug!("wallpaper gallery: drop unreachable media");
            }
        }
        if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
            return Vec::new();
        }
    }
    merge_rank_x_gallery_items(out)
}

pub async fn filter_reachable_gallery_items(
    items: Vec<WallpaperGalleryItem>,
) -> Vec<WallpaperGalleryItem> {
    filter_reachable_gallery_items_cancellable(items, None).await
}

fn x_search_round(
    query: &str,
    sort: Option<&str>,
    max_search_calls: u32,
    is_supplement: bool,
    seen_ids: &[String],
    cancellation: Option<&WallpaperSearchCancellation>,
) -> WallpaperSearchResult {
    if cancellation.is_some_and(WallpaperSearchCancellation::is_cancelled) {
        return cancelled_search_result();
    }
    let q = query.trim();
    if q.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("empty query".into()),
            meta: None,
        };
    }
    let cli = match require_cli_ready() {
        Ok(p) => p,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
                meta: None,
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
          "kind": { "type": "string" },
          "width": { "type": "number" },
          "height": { "type": "number" },
          "mediaIndex": { "type": "number" }
        },
        "required": ["fullUrl"]
      }
    }
  },
  "required": ["items"]
}"#;

    let prompt = build_x_search_prompt(q, sort, max_search_calls, is_supplement, seen_ids);

    let stdout = match run_grok_headless_cancellable(
        &cli,
        &prompt,
        schema,
        14,
        X_SEARCH_TIMEOUT,
        None,
        cancellation,
    ) {
        Ok(s) => s,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
                meta: None,
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
                meta: None,
            };
        }
    };

    let mut items = parse_gallery_items(&value, "x");

    if items.is_empty() {
        if let Some(v) = harvest_media_urls_as_items(&stdout) {
            items = parse_gallery_items(&v, "x");
        }
    }

    if items.is_empty() {
        return WallpaperSearchResult {
            items: vec![],
            error_code: Some("empty".into()),
            message: Some("no images found".into()),
            meta: None,
        };
    }

    WallpaperSearchResult {
        items,
        error_code: None,
        message: None,
        meta: None,
    }
}

/// Sync first-round headless search only (no network probe). Prefer
/// [`x_search_async`] for the complete quality and supplement pipeline.
pub fn x_search(query: &str, sort: Option<&str>) -> WallpaperSearchResult {
    x_search_round(query, sort, X_SEARCH_FIRST_ROUND_CALLS, false, &[], None)
}

fn extract_media_index_from_status_url(url: &str) -> Option<u8> {
    let parsed = url::Url::parse(url.trim()).ok()?;
    if !is_canonical_x_status_url(url) {
        return None;
    }
    let segments: Vec<&str> = parsed
        .path_segments()?
        .filter(|part| !part.is_empty())
        .collect();
    let status_pos = segments.iter().position(|part| {
        part.eq_ignore_ascii_case("status") || part.eq_ignore_ascii_case("statuses")
    })?;
    let media_kind = segments.get(status_pos + 2)?;
    if !media_kind.eq_ignore_ascii_case("photo") && !media_kind.eq_ignore_ascii_case("video") {
        return None;
    }
    segments
        .get(status_pos + 3)?
        .parse::<u8>()
        .ok()
        .filter(|index| (1..=4).contains(index))
}

fn normalized_media_identity(url: &str) -> Option<String> {
    if !is_allowed_media_url(url) {
        return None;
    }
    let parsed = url::Url::parse(url.trim()).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let path = parsed.path();
    if host == "pbs.twimg.com" {
        let media = path.strip_prefix("/media/")?.split('/').next()?;
        let media = [":thumb", ":small", ":medium", ":large", ":orig"]
            .iter()
            .find_map(|suffix| media.strip_suffix(suffix))
            .unwrap_or(media);
        let media = [".jpeg", ".jpg", ".png", ".webp", ".gif", ".avif"]
            .iter()
            .find_map(|suffix| media.strip_suffix(suffix))
            .unwrap_or(media);
        if !media.is_empty() {
            return Some(format!("twimg:{media}"));
        }
    }
    Some(format!("cdn:{host}{path}"))
}

fn status_media_identity(item: &WallpaperGalleryItem) -> Option<String> {
    Some(format!(
        "status:{}:{}",
        item.status_id.as_deref()?,
        item.media_index?
    ))
}

pub(crate) fn x_gallery_reference_ids(items: &[WallpaperGalleryItem]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut ids = Vec::new();
    for item in items {
        for value in [
            normalized_media_identity(&item.full_url),
            item.status_id.as_ref().map(|id| format!("status:{id}")),
            status_media_identity(item),
        ]
        .into_iter()
        .flatten()
        {
            if seen.insert(value.clone()) {
                ids.push(value);
            }
            if ids.len() >= 48 {
                return ids;
            }
        }
    }
    ids
}

/// Headless X search + drop unreachable media URLs before returning to UI.
pub async fn x_search_async(query: &str, sort: Option<&str>) -> WallpaperSearchResult {
    x_search_cli_outcome(query, sort, None).await.result
}

fn cancelled_search_result() -> WallpaperSearchResult {
    WallpaperSearchResult {
        items: Vec::new(),
        error_code: Some("cancelled".into()),
        message: None,
        meta: None,
    }
}

fn cancelled_cli_outcome() -> WallpaperCliSearchOutcome {
    WallpaperCliSearchOutcome {
        result: cancelled_search_result(),
        candidate_count: 0,
        valid_count: 0,
    }
}

pub(crate) async fn x_search_cli_outcome(
    query: &str,
    sort: Option<&str>,
    runtime: Option<&WallpaperXSearchRuntime>,
) -> WallpaperCliSearchOutcome {
    if runtime.is_some_and(WallpaperXSearchRuntime::is_cancelled) {
        return cancelled_cli_outcome();
    }
    let first_query = query.to_string();
    let first_sort = sort.map(str::to_string);
    let first_cancellation = runtime.map(|runtime| runtime.cancellation().clone());
    let mut result = match tauri::async_runtime::spawn_blocking(move || {
        x_search_round(
            &first_query,
            first_sort.as_deref(),
            X_SEARCH_FIRST_ROUND_CALLS,
            false,
            &[],
            first_cancellation.as_ref(),
        )
    })
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return WallpaperCliSearchOutcome {
                result: WallpaperSearchResult {
                    items: vec![],
                    error_code: Some("search_failed".into()),
                    message: Some(format!("join: {e}")),
                    meta: None,
                },
                candidate_count: 0,
                valid_count: 0,
            };
        }
    };

    if runtime.is_some_and(WallpaperXSearchRuntime::is_cancelled)
        || result.error_code.as_deref() == Some("cancelled")
    {
        return cancelled_cli_outcome();
    }

    let mut candidate_count = result.items.len();
    if result
        .error_code
        .as_deref()
        .is_some_and(|code| code != "empty")
    {
        return WallpaperCliSearchOutcome {
            result,
            candidate_count,
            valid_count: 0,
        };
    }

    let seen_ids = x_gallery_reference_ids(&result.items);
    if let Some(runtime) = runtime {
        runtime.report(WallpaperXSearchStage::Validating);
    }
    let mut filtered = filter_reachable_gallery_items_cancellable(
        std::mem::take(&mut result.items),
        runtime.map(WallpaperXSearchRuntime::cancellation),
    )
    .await;
    if runtime.is_some_and(WallpaperXSearchRuntime::is_cancelled) {
        return cancelled_cli_outcome();
    }
    if x_gallery_needs_supplement(filtered.len()) {
        if let Some(runtime) = runtime {
            runtime.report(WallpaperXSearchStage::Supplementing);
        }
        let supplement_query = query.to_string();
        let supplement_sort = sort.map(str::to_string);
        let supplement_seen = seen_ids;
        let supplement_cancellation = runtime.map(|runtime| runtime.cancellation().clone());
        if let Ok(supplement) = tauri::async_runtime::spawn_blocking(move || {
            x_search_round(
                &supplement_query,
                supplement_sort.as_deref(),
                X_SEARCH_SUPPLEMENT_CALLS,
                true,
                &supplement_seen,
                supplement_cancellation.as_ref(),
            )
        })
        .await
        {
            if runtime.is_some_and(WallpaperXSearchRuntime::is_cancelled)
                || supplement.error_code.as_deref() == Some("cancelled")
            {
                return cancelled_cli_outcome();
            }
            candidate_count = candidate_count.saturating_add(supplement.items.len());
            if supplement.error_code.is_none() || supplement.error_code.as_deref() == Some("empty")
            {
                if let Some(runtime) = runtime {
                    runtime.report(WallpaperXSearchStage::Validating);
                }
                let supplement_items = filter_reachable_gallery_items_cancellable(
                    supplement.items,
                    runtime.map(WallpaperXSearchRuntime::cancellation),
                )
                .await;
                if runtime.is_some_and(WallpaperXSearchRuntime::is_cancelled) {
                    return cancelled_cli_outcome();
                }
                filtered.extend(supplement_items);
                filtered = merge_rank_x_gallery_items(filtered);
            }
        }
    }
    if filtered.is_empty() {
        return WallpaperCliSearchOutcome {
            result: WallpaperSearchResult {
                items: vec![],
                error_code: Some("empty".into()),
                message: Some("no downloadable images".into()),
                meta: None,
            },
            candidate_count,
            valid_count: 0,
        };
    }
    result.error_code = None;
    result.message = None;
    result.items = filtered;
    let valid_count = result.items.len();
    WallpaperCliSearchOutcome {
        result,
        candidate_count,
        valid_count,
    }
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
            .redirect(media_redirect_policy())
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
    )
    .build()
    .map_err(|e| format!("http client: {e}"))?;

    let mut resp = client
        .get(&normalized)
        .header("Accept", "image/avif,image/webp,image/*,video/*,*/*;q=0.8")
        .send()
        .await
        .map_err(|_| "download_failed: network".to_string())?;

    if !is_complete_download_response(
        resp.status().as_u16(),
        resp.headers().contains_key(reqwest::header::CONTENT_RANGE),
    ) || !is_allowed_media_url(resp.url().as_str())
    {
        return Err(format!("download_failed: HTTP {}", resp.status()));
    }
    if response_total_length(&resp).is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err("download_failed: too large".into());
    }

    let content_type = normalized_content_type(resp.headers().get(reqwest::header::CONTENT_TYPE));
    let bytes = read_response_body_bounded(&mut resp, MAX_DOWNLOAD_BYTES).await?;
    if bytes.is_empty() {
        return Err("download_failed: empty body".into());
    }
    // Reject tiny broken payloads
    if bytes.len() < 64 {
        return Err("download_failed: too small".into());
    }
    let media = detect_media_signature(&bytes)
        .filter(|media| content_type_matches_signature(&content_type, *media))
        .ok_or_else(|| "download_failed: invalid media signature".to_string())?;

    let src = match source {
        Some("imagine") => "imagine",
        _ => "x",
    };
    let ext = media.extension();
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
        mime: media.mime().to_string(),
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
            meta: None,
        };
    }
    let cli = match require_cli_ready() {
        Ok(c) => c,
        Err(code) => {
            return WallpaperSearchResult {
                items: vec![],
                error_code: Some(code),
                message: None,
                meta: None,
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
                meta: None,
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
                    meta: None,
                };
            }
            return WallpaperSearchResult {
                items: scanned,
                error_code: None,
                message: None,
                meta: None,
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
                meta: None,
            };
        }
        return WallpaperSearchResult {
            items: scanned,
            error_code: None,
            message: None,
            meta: None,
        };
    }

    WallpaperSearchResult {
        items,
        error_code: None,
        message: None,
        meta: None,
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
            status_id: None,
            media_index: None,
            media_quality: None,
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
    #[tokio::test]
    async fn cancellation_wakes_waiters_and_prevents_cli_start() {
        let cancellation = WallpaperSearchCancellation::default();
        let waiter = cancellation.clone();
        let task = tokio::spawn(async move { waiter.cancelled().await });
        cancellation.cancel();
        cancellation.cancel();
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            run_grok_headless_cancellable(
                "missing-cli-must-not-start",
                "query",
                "{}",
                1,
                Duration::from_secs(1),
                None,
                Some(&cancellation),
            )
            .unwrap_err(),
            "cancelled"
        );
        let runtime = WallpaperXSearchRuntime::new(cancellation, Arc::new(|_| {}));
        let result = x_search_cli_outcome("sky", None, Some(&runtime)).await;
        assert_eq!(result.result.error_code.as_deref(), Some("cancelled"));
    }

    #[tokio::test]
    async fn active_cli_cancellation_returns_before_execution_timeout() {
        let test_dir =
            std::env::temp_dir().join(format!("wallpaper-cancel-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&test_dir).unwrap();
        #[cfg(windows)]
        let cli = test_dir.join("grok.cmd");
        #[cfg(windows)]
        fs::write(
            &cli,
            "@echo off\r\nif \"%~1\"==\"--version\" (echo 0.2.117 & exit /b 0)\r\necho ready>\"%~dp0started\"\r\npowershell -NoProfile -Command \"Start-Sleep -Seconds 30\"\r\n",
        )
        .unwrap();
        #[cfg(unix)]
        let cli = test_dir.join("grok");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(&cli, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.2.117; exit 0; fi\necho ready > \"$(dirname \"$0\")/started\"\nsleep 30\n").unwrap();
            fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let cancellation = WallpaperSearchCancellation::default();
        let signal = cancellation.clone();
        let cli_path = cli.to_string_lossy().to_string();
        let task = tokio::task::spawn_blocking(move || {
            run_grok_headless_cancellable(
                &cli_path,
                "cancel",
                "{}",
                1,
                Duration::from_secs(30),
                None,
                Some(&signal),
            )
        });
        let started = test_dir.join("started");
        let deadline = Instant::now() + Duration::from_secs(5);
        while !started.exists() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let did_start = started.exists();
        cancellation.cancel();
        let result = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(did_start, "synthetic CLI never reached its execution phase");
        fs::remove_file(started).unwrap();
        fs::remove_file(cli).unwrap();
        fs::remove_dir(test_dir).unwrap();
    }

    #[test]
    fn wallpaper_cli_drains_large_stdout_and_stderr_before_exit() {
        let test_dir = std::env::temp_dir().join(format!(
            "grok-app-wallpaper-pipe-drain-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&test_dir).expect("create pipe-drain test directory");

        #[cfg(windows)]
        let fake_cli = test_dir.join("grok.cmd");
        #[cfg(windows)]
        std::fs::write(
            &fake_cli,
            "@echo off\r\npowershell -NoProfile -Command \"$s=[string]::new([char]'x',1048576);[Console]::Out.Write($s);$s=[string]::new([char]'y',1048576);[Console]::Error.Write($s)\"\r\n",
        )
        .expect("write fake Windows CLI");

        #[cfg(unix)]
        let fake_cli = test_dir.join("grok");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(
                &fake_cli,
                "#!/bin/sh\nhead -c 1048576 /dev/zero | tr '\\0' x\nhead -c 1048576 /dev/zero | tr '\\0' y >&2\n",
            )
            .expect("write fake Unix CLI");
            let mut permissions = std::fs::metadata(&fake_cli)
                .expect("stat fake CLI")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&fake_cli, permissions).expect("make fake CLI executable");
        }

        let stdout = run_grok_headless(
            &fake_cli.to_string_lossy(),
            "large output",
            r#"{"type":"object"}"#,
            1,
            Duration::from_secs(15),
            None,
        )
        .expect("large stdout/stderr must be drained without deadlock");
        assert_eq!(stdout.len(), 1024 * 1024);
        assert!(stdout.bytes().all(|byte| byte == b'x'));

        let _ = std::fs::remove_file(fake_cli);
        let _ = std::fs::remove_dir(test_dir);
    }

    #[test]
    fn wallpaper_cli_rejects_oversized_stdout_after_draining_it() {
        let test_dir = std::env::temp_dir().join(format!(
            "grok-app-wallpaper-pipe-limit-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&test_dir).expect("create pipe-limit test directory");
        let oversized = MAX_WALLPAPER_CLI_STDOUT_BYTES + 1;

        #[cfg(windows)]
        let fake_cli = test_dir.join("grok.cmd");
        #[cfg(windows)]
        std::fs::write(
            &fake_cli,
            format!(
                "@echo off\r\npowershell -NoProfile -Command \"$s=[string]::new([char]'x',{oversized});[Console]::Out.Write($s);$s=[string]::new([char]'y',1048576);[Console]::Error.Write($s)\"\r\n"
            ),
        )
        .expect("write oversized fake Windows CLI");

        #[cfg(unix)]
        let fake_cli = test_dir.join("grok");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(
                &fake_cli,
                format!(
                    "#!/bin/sh\nhead -c {oversized} /dev/zero | tr '\\0' x\nhead -c 1048576 /dev/zero | tr '\\0' y >&2\n"
                ),
            )
            .expect("write oversized fake Unix CLI");
            let mut permissions = std::fs::metadata(&fake_cli)
                .expect("stat fake CLI")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&fake_cli, permissions).expect("make fake CLI executable");
        }

        let error = run_grok_headless(
            &fake_cli.to_string_lossy(),
            "oversized output",
            r#"{"type":"object"}"#,
            1,
            Duration::from_secs(15),
            None,
        )
        .expect_err("oversized stdout must fail after being drained");
        assert_eq!(error, "search_failed");

        let _ = std::fs::remove_file(fake_cli);
        let _ = std::fs::remove_dir(test_dir);
    }

    #[test]
    fn wallpaper_cli_output_readers_stop_while_child_keeps_pipes_open() {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
            command
        };
        #[cfg(unix)]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 30"]);
            command
        };
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        process_util::apply_no_window_std(&mut command);
        let mut child = command.spawn().expect("spawn pipe holder");
        let readers = WallpaperCliOutputReaders::start(&mut child).expect("start pipe drains");
        std::thread::sleep(Duration::from_millis(25));
        let started = Instant::now();

        readers.stop();
        let elapsed = started.elapsed();
        terminate_wallpaper_process_tree(&mut child);

        assert!(elapsed < Duration::from_secs(1), "stop took {elapsed:?}");
    }

    use super::*;

    #[test]
    fn media_urls_require_https_without_credentials_or_nonstandard_ports() {
        for raw in [
            "http://pbs.twimg.com/media/a.jpg",
            "https://user@pbs.twimg.com/media/a.jpg",
            "https://user:password@pbs.twimg.com/media/a.jpg",
            "https://pbs.twimg.com:8443/media/a.jpg",
            "https://pbs.twimg.com.evil.example/media/a.jpg",
        ] {
            assert!(!is_allowed_media_url(raw), "{raw}");
        }
        assert!(is_allowed_media_url(
            "https://pbs.twimg.com:443/media/a.jpg"
        ));
    }

    #[test]
    fn normalization_preserves_format_and_collapses_query_and_fragment_variants() {
        assert_eq!(
            normalize_media_url(
                "https://pbs.twimg.com/media/a?FORMAT=png&name=small&name=large&tracking=1#preview"
            ),
            "https://pbs.twimg.com/media/a?format=png&name=orig"
        );
        assert_eq!(
            normalize_media_url("https://cdn.grok.com/image.png?signature=abc#preview"),
            "https://cdn.grok.com/image.png?signature=abc"
        );
    }

    #[test]
    fn gallery_dedupes_tracking_and_size_variants_of_the_same_x_image() {
        let value = json!({"items": [
            {"fullUrl": "https://pbs.twimg.com/media/a?format=jpg&name=small&tracking=1#one"},
            {"fullUrl": "https://pbs.twimg.com/media/a?name=large&format=jpg&tracking=2#two"}
        ]});
        let items = parse_gallery_items(&value, "x");
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].full_url,
            "https://pbs.twimg.com/media/a?format=jpg&name=orig"
        );
    }

    #[test]
    fn full_download_rejects_partial_and_non_success_responses() {
        assert!(is_complete_download_response(200, false));
        assert!(!is_complete_download_response(200, true));
        assert!(!is_complete_download_response(206, true));
        assert!(!is_complete_download_response(204, false));
    }

    #[test]
    fn allowlist_twimg() {
        assert!(is_allowed_media_url(
            "https://pbs.twimg.com/media/HOUbJsYaEAAaEQ6.jpg"
        ));
        assert!(is_allowed_media_url(
            "https://pbs.twimg.com/media/foo?format=jpg&name=small"
        ));
        assert!(!is_allowed_media_url(
            "http://pbs.twimg.com/media/insecure.jpg"
        ));
        assert!(!is_allowed_media_url(
            "https://pbs.twimg.com:8443/media/wrong-port.jpg"
        ));
        assert!(!is_allowed_media_url(
            "https://user@pbs.twimg.com/media/credentials.jpg"
        ));
        assert!(!is_allowed_media_url("https://evil.example/a.jpg"));
        assert!(!is_allowed_media_url("file:///etc/passwd"));
    }

    #[test]
    fn media_redirects_revalidate_every_hop() {
        assert!(should_follow_media_redirect(
            &url::Url::parse("https://pbs.twimg.com/media/a.jpg").unwrap(),
            0
        ));
        assert!(!should_follow_media_redirect(
            &url::Url::parse("https://evil.example/a.jpg").unwrap(),
            0
        ));
        assert!(!should_follow_media_redirect(
            &url::Url::parse("http://pbs.twimg.com/media/a.jpg").unwrap(),
            0
        ));
        assert!(!should_follow_media_redirect(
            &url::Url::parse("https://pbs.twimg.com/media/a.jpg").unwrap(),
            6
        ));
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
            "https://pbs.twimg.com/media/HOUbJsYaEAAaEQ6.jpg?utm_source=x&name=small&format=jpg#fragment",
        );
        assert!(u.contains("name=orig"), "{u}");
        assert!(u.contains("format=jpg"), "{u}");
        assert!(!u.contains("utm_source"), "{u}");
        assert!(!u.contains("fragment"), "{u}");
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
    fn shared_pipeline_dedupes_cdn_variants_and_merges_metadata() {
        let v = json!({
            "items": [
                { "fullUrl": "https://pbs.twimg.com/media/a.jpg?name=small" },
                {
                    "fullUrl": "https://pbs.twimg.com/media/a?format=jpg&name=large",
                    "postUrl": "https://x.com/alice/status/1234567890123456789/photo/1",
                    "likes": 42
                },
                { "fullUrl": "https://pbs.twimg.com/media/b.jpg", "username": "u" }
            ]
        });
        let items = parse_gallery_items(&v, "x");
        assert_eq!(
            items.len(),
            2,
            "parsing merges duplicate media with their metadata"
        );
        let items = merge_rank_x_gallery_items(items);
        assert_eq!(items.len(), 2);
        let merged = items
            .iter()
            .find(|item| normalized_media_identity(&item.full_url).as_deref() == Some("twimg:a"))
            .expect("merged media");
        assert_eq!(merged.likes, Some(42));
        assert_eq!(merged.status_id.as_deref(), Some("1234567890123456789"));
        assert_eq!(merged.media_index, Some(1));
    }

    #[test]
    fn shared_pipeline_dedupes_status_media_position_without_collapsing_siblings() {
        let v = json!({
            "items": [
                {
                    "fullUrl": "https://pbs.twimg.com/media/a.jpg",
                    "postUrl": "https://x.com/alice/status/1234567890123456789/photo/1"
                },
                {
                    "fullUrl": "https://cdn.grok.com/render/alternate-a.png",
                    "postUrl": "https://twitter.com/alice/status/1234567890123456789/photo/1"
                },
                {
                    "fullUrl": "https://pbs.twimg.com/media/b.jpg",
                    "postUrl": "https://x.com/alice/status/1234567890123456789/photo/2"
                }
            ]
        });
        let items = merge_rank_x_gallery_items(parse_gallery_items(&v, "x"));
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item.media_index == Some(1)));
        assert!(items.iter().any(|item| item.media_index == Some(2)));
    }

    #[test]
    fn media_signature_and_dimensions_reject_disguised_text() {
        let mut png = vec![0u8; 32];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[16..20].copy_from_slice(&3840u32.to_be_bytes());
        png[20..24].copy_from_slice(&2160u32.to_be_bytes());
        let media = detect_media_signature(&png).expect("png signature");
        assert_eq!(media, DetectedMedia::Png);
        assert_eq!(
            image_dimensions_from_prefix(&png, media),
            Some((3840, 2160))
        );
        assert!(content_type_matches_signature("image/png", media));
        assert!(content_type_matches_signature(
            "application/octet-stream",
            media
        ));
        assert!(!content_type_matches_signature("text/html", media));
        assert_eq!(detect_media_signature(b"<html>not an image</html>"), None);
    }

    #[test]
    fn iso_image_brands_do_not_label_heic_as_avif_or_video() {
        assert_eq!(
            detect_media_signature(b"\0\0\0\x18ftypavif\0\0\0\0mif1"),
            Some(DetectedMedia::Avif)
        );
        assert_eq!(
            detect_media_signature(b"\0\0\0\x18ftypmif1\0\0\0\0avif"),
            Some(DetectedMedia::Avif)
        );
        assert_eq!(
            detect_media_signature(b"\0\0\0\x18ftypheic\0\0\0\0mif1"),
            None
        );
        assert_eq!(
            detect_media_signature(b"\0\0\0\x18ftypmif1\0\0\0\0xxxx"),
            None
        );
        assert_eq!(
            detect_media_signature(b"\0\0\0\x18ftypisom\0\0\0\0mp42"),
            Some(DetectedMedia::Mp4)
        );
    }

    #[test]
    fn supplement_threshold_and_reference_ids_are_deterministic() {
        assert!(x_gallery_needs_supplement(5));
        assert!(!x_gallery_needs_supplement(6));
        let items = parse_gallery_items(
            &json!({
                "items": [{
                    "fullUrl": "https://pbs.twimg.com/media/opaqueABC.jpg",
                    "postUrl": "https://x.com/i/status/1234567890123456789/photo/3"
                }]
            }),
            "x",
        );
        assert_eq!(
            x_gallery_reference_ids(&items),
            vec![
                "twimg:opaqueABC",
                "status:1234567890123456789",
                "status:1234567890123456789:3"
            ]
        );
    }

    #[test]
    fn shared_ranking_prefers_verified_wallpaper_quality_and_keeps_evidence_private() {
        let mut items = parse_gallery_items(
            &json!({
                "items": [
                    { "fullUrl": "https://pbs.twimg.com/media/low.jpg" },
                    {
                        "fullUrl": "https://pbs.twimg.com/media/high.jpg",
                        "postUrl": "https://x.com/alice/status/1234567890123456789/photo/1",
                        "likes": 500
                    }
                ]
            }),
            "x",
        );
        items[0].width = Some(800);
        items[0].height = Some(600);
        items[0].media_quality = Some(WallpaperMediaQuality {
            declared_image_mime: false,
            dimensions_verified: true,
            content_length: Some(64 * 1024),
        });
        items[1].width = Some(3840);
        items[1].height = Some(2160);
        items[1].media_quality = Some(WallpaperMediaQuality {
            declared_image_mime: true,
            dimensions_verified: true,
            content_length: Some(2 * 1024 * 1024),
        });

        let ranked = merge_rank_x_gallery_items(items);
        assert!(ranked[0].full_url.contains("high.jpg"));
        let serialized = serde_json::to_value(&ranked[0]).expect("serialize gallery item");
        assert!(serialized.get("statusId").is_none());
        assert!(serialized.get("mediaIndex").is_none());
        assert!(serialized.get("mediaQuality").is_none());
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
