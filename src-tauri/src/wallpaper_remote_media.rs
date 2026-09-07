//! Safe, source-agnostic remote image probing and download.
//!
//! Unlike the X/Imagine downloader, this path accepts arbitrary public HTTPS
//! origins, so every redirect and DNS resolution is checked through
//! `skin_net` before bytes are trusted.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hyper::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_RANGE, CONTENT_TYPE, RANGE, REFERER,
    USER_AGENT,
};
use hyper::StatusCode;
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::safe_https_client::{
    self, SafeHttpsClient, SafeHttpsError, SafeHttpsErrorKind, SafeHttpsResponse,
};
use crate::skin_net::{self, OriginPolicy};
use crate::wallpaper_remote_search::RemoteWallpaperSource;
use crate::wallpaper_source::{
    validate_fetched_media_bytes, validate_image_prefix, ValidatedImagePrefix,
    WallpaperFetchResult, WallpaperSearchCancellation, MAX_DOWNLOAD_BYTES,
};

const PROBE_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const THUMBNAIL_SOURCE_BYTES: u64 = 32 * 1024 * 1024;
const THUMBNAIL_JPEG_BYTES: usize = 512 * 1024;
const SOURCE_ORIGIN_TTL: Duration = Duration::from_secs(30 * 60);
const SOURCE_ORIGIN_LIMIT: usize = 512;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 128;
const BROWSER_IMAGE_USER_AGENT: &str =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 GrokApp/WallpaperDiscovery";
const BROWSER_IMAGE_ACCEPT_LANGUAGE: &str = "en-US,en;q=0.9,*;q=0.5";

#[derive(Clone)]
struct ActiveMediaRequest {
    token: uuid::Uuid,
    cancellation: WallpaperSearchCancellation,
}

#[derive(Default)]
struct MediaRequestRegistry {
    active: HashMap<String, ActiveMediaRequest>,
    pre_cancelled: VecDeque<(String, Instant)>,
}

impl MediaRequestRegistry {
    fn purge_pre_cancelled(&mut self, now: Instant) {
        self.pre_cancelled
            .retain(|(_, created)| now.saturating_duration_since(*created) < PRE_CANCEL_TTL);
    }

    fn record_pre_cancel(&mut self, request_id: &str, now: Instant) {
        self.purge_pre_cancelled(now);
        self.pre_cancelled.retain(|(id, _)| id != request_id);
        while self.pre_cancelled.len() >= PRE_CANCEL_CAPACITY {
            self.pre_cancelled.pop_front();
        }
        self.pre_cancelled.push_back((request_id.to_string(), now));
    }

    fn take_pre_cancel(&mut self, request_id: &str, now: Instant) -> bool {
        self.purge_pre_cancelled(now);
        let found = self.pre_cancelled.iter().any(|(id, _)| id == request_id);
        self.pre_cancelled.retain(|(id, _)| id != request_id);
        found
    }
}

static ACTIVE_MEDIA: OnceLock<Mutex<MediaRequestRegistry>> = OnceLock::new();

#[derive(Clone, Debug)]
struct RegisteredSourceOrigin {
    origin: String,
    last_seen: Instant,
}

#[derive(Default)]
struct SourceOriginRegistry {
    entries: HashMap<(RemoteWallpaperSource, String), RegisteredSourceOrigin>,
}

impl SourceOriginRegistry {
    fn prune_expired(&mut self, now: Instant) {
        self.entries
            .retain(|_, entry| now.saturating_duration_since(entry.last_seen) < SOURCE_ORIGIN_TTL);
    }

    fn register(
        &mut self,
        source: RemoteWallpaperSource,
        media_url: String,
        origin: String,
        now: Instant,
    ) {
        self.prune_expired(now);
        self.entries.insert(
            (source, media_url),
            RegisteredSourceOrigin {
                origin,
                last_seen: now,
            },
        );
        while self.entries.len() > SOURCE_ORIGIN_LIMIT {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_seen)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
    }

    fn lookup(
        &mut self,
        source: RemoteWallpaperSource,
        media_url: &str,
        now: Instant,
    ) -> Option<String> {
        self.prune_expired(now);
        let entry = self.entries.get_mut(&(source, media_url.to_string()))?;
        entry.last_seen = now;
        Some(entry.origin.clone())
    }
}

static SOURCE_ORIGINS: OnceLock<Mutex<SourceOriginRegistry>> = OnceLock::new();

fn active_media() -> &'static Mutex<MediaRequestRegistry> {
    ACTIVE_MEDIA.get_or_init(|| Mutex::new(MediaRequestRegistry::default()))
}

fn source_origins() -> &'static Mutex<SourceOriginRegistry> {
    SOURCE_ORIGINS.get_or_init(|| Mutex::new(SourceOriginRegistry::default()))
}

fn begin_media_request(request_id: &str) -> (uuid::Uuid, WallpaperSearchCancellation) {
    let token = uuid::Uuid::new_v4();
    let cancellation = WallpaperSearchCancellation::default();
    let mut requests = active_media().lock();
    if requests.take_pre_cancel(request_id, Instant::now()) {
        cancellation.cancel();
    }
    if let Some(previous) = requests.active.insert(
        request_id.to_string(),
        ActiveMediaRequest {
            token,
            cancellation: cancellation.clone(),
        },
    ) {
        previous.cancellation.cancel();
    }
    (token, cancellation)
}

fn finish_media_request(request_id: &str, token: uuid::Uuid) {
    let mut requests = active_media().lock();
    if requests
        .active
        .get(request_id)
        .is_some_and(|request| request.token == token)
    {
        requests.active.remove(request_id);
    }
}

pub(crate) fn cancel_media_requests(request_ids: &[String]) -> usize {
    let mut requests = active_media().lock();
    let mut active = Vec::new();
    let now = Instant::now();
    for request_id in request_ids {
        if let Some(request) = requests.active.remove(request_id) {
            active.push(request.cancellation);
        } else {
            requests.record_pre_cancel(request_id, now);
        }
    }
    drop(requests);
    let count = active.len();
    for cancellation in active {
        cancellation.cancel();
    }
    count
}

pub(crate) fn cancel_all_media_requests() -> usize {
    let requests = active_media()
        .lock()
        .active
        .drain()
        .map(|(_, request)| request)
        .collect::<Vec<_>>();
    let count = requests.len();
    for request in requests {
        request.cancellation.cancel();
    }
    count
}

#[derive(Debug, Clone)]
pub(crate) struct RemoteImageProbe {
    pub(crate) final_url: String,
    pub(crate) width: Option<u32>,
    pub(crate) height: Option<u32>,
    pub(crate) content_length: Option<u64>,
    pub(crate) content_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteWallpaperThumbnail {
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RemoteImageProbeFailure {
    Cancelled,
    Blocked,
    Timeout,
    Forbidden,
    NotFound,
    RateLimited,
    HttpClient,
    HttpServer,
    Network,
    InvalidImage,
    TooLarge,
    Redirect,
}

fn network_failure(error: &SafeHttpsError) -> RemoteImageProbeFailure {
    match error.kind() {
        SafeHttpsErrorKind::Blocked => RemoteImageProbeFailure::Blocked,
        SafeHttpsErrorKind::Timeout => RemoteImageProbeFailure::Timeout,
        SafeHttpsErrorKind::Network => RemoteImageProbeFailure::Network,
    }
}

fn status_failure(status: StatusCode) -> RemoteImageProbeFailure {
    match status.as_u16() {
        403 => RemoteImageProbeFailure::Forbidden,
        404 | 410 => RemoteImageProbeFailure::NotFound,
        429 => RemoteImageProbeFailure::RateLimited,
        400..=499 => RemoteImageProbeFailure::HttpClient,
        500..=599 => RemoteImageProbeFailure::HttpServer,
        _ => RemoteImageProbeFailure::Network,
    }
}

pub(crate) fn origin_referer(source_page: &Url) -> Option<String> {
    if source_page.scheme() != "https"
        || !source_page.username().is_empty()
        || source_page.password().is_some()
        || source_page.host_str().is_none()
    {
        return None;
    }
    Some(format!("{}/", source_page.origin().ascii_serialization()))
}

fn canonical_media_url(raw: &str) -> Option<String> {
    if raw.len() > 8_192 {
        return None;
    }
    let mut url = Url::parse(raw.trim()).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
        || url.port().is_some_and(|port| port != 443)
    {
        return None;
    }
    url.set_fragment(None);
    Some(url.to_string())
}

fn verified_source_origin(raw: &str) -> Option<String> {
    if raw.len() > 2_048 {
        return None;
    }
    let url = Url::parse(raw.trim()).ok()?;
    if url.port().is_some_and(|port| port != 443) {
        return None;
    }
    origin_referer(&url)
}

/// Associate a validated result with only its source origin. Renderer IPC
/// never supplies the Referer used by later thumbnail or original downloads.
pub(crate) fn register_media_source(
    source: RemoteWallpaperSource,
    media_url: &str,
    source_page: &str,
) {
    let (Some(media_url), Some(origin)) = (
        canonical_media_url(media_url),
        verified_source_origin(source_page),
    ) else {
        return;
    };
    source_origins()
        .lock()
        .register(source, media_url, origin, Instant::now());
}

fn registered_source_origin(source: RemoteWallpaperSource, media_url: &str) -> Option<String> {
    let media_url = canonical_media_url(media_url)?;
    source_origins()
        .lock()
        .lookup(source, &media_url, Instant::now())
}

pub(crate) fn is_wallpaper_quality_candidate(probe: &RemoteImageProbe) -> bool {
    if let (Some(width), Some(height)) = (probe.width, probe.height) {
        let long = width.max(height);
        let short = width.min(height);
        let ratio = width as f64 / height as f64;
        long >= 900 && short >= 360 && (0.38..=3.2).contains(&ratio)
    } else {
        probe.content_length.is_some_and(|bytes| bytes >= 80 * 1024)
    }
}

#[derive(Clone)]
pub(crate) struct RemoteImageProber {
    client: SafeHttpsClient,
}

impl RemoteImageProber {
    pub(crate) fn new() -> Self {
        Self {
            client: safe_https_client::shared(),
        }
    }

    pub(crate) async fn probe_image(
        &self,
        start: &str,
        referer_origin: Option<&str>,
        cancellation: &WallpaperSearchCancellation,
    ) -> Result<RemoteImageProbe, RemoteImageProbeFailure> {
        probe_image_with_client(&self.client, start, referer_origin, cancellation).await
    }
}

fn normalized_content_type(response: &SafeHttpsResponse) -> String {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn response_total_length(response: &SafeHttpsResponse) -> Option<u64> {
    response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.content_length())
}

fn image_headers(
    referer_origin: Option<&str>,
    range: Option<&str>,
) -> Result<HeaderMap, RemoteImageProbeFailure> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(BROWSER_IMAGE_USER_AGENT),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "image/jpeg,image/png,image/webp;q=0.9,image/avif;q=0.8,image/*;q=0.7,*/*;q=0.5",
        ),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static(BROWSER_IMAGE_ACCEPT_LANGUAGE),
    );
    if let Some(range) = range {
        headers.insert(
            RANGE,
            HeaderValue::from_str(range).map_err(|_| RemoteImageProbeFailure::Blocked)?,
        );
    }
    if let Some(referer) = referer_origin {
        headers.insert(
            REFERER,
            HeaderValue::from_str(referer).map_err(|_| RemoteImageProbeFailure::Blocked)?,
        );
    }
    Ok(headers)
}

async fn read_prefix(
    response: &mut SafeHttpsResponse,
    cancellation: &WallpaperSearchCancellation,
) -> Result<Vec<u8>, RemoteImageProbeFailure> {
    let mut bytes = Vec::with_capacity(PROBE_BYTES);
    while bytes.len() < PROBE_BYTES {
        let next = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(RemoteImageProbeFailure::Cancelled),
            chunk = response.chunk() => chunk,
        }
        .map_err(|error| network_failure(&error))?;
        let Some(chunk) = next else {
            break;
        };
        let remaining = PROBE_BYTES - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    Ok(bytes)
}

async fn check_image_hop(
    raw: &str,
    policy: &OriginPolicy,
    cancellation: &WallpaperSearchCancellation,
) -> Result<Url, RemoteImageProbeFailure> {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(RemoteImageProbeFailure::Cancelled),
        checked = skin_net::check_hop_async(raw, policy) => {
            checked.map_err(|_| RemoteImageProbeFailure::Blocked)
        },
    }
}

async fn probe_image_with_client(
    client: &SafeHttpsClient,
    start: &str,
    referer_origin: Option<&str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<RemoteImageProbe, RemoteImageProbeFailure> {
    if cancellation.is_cancelled() {
        return Err(RemoteImageProbeFailure::Cancelled);
    }
    let policy = OriginPolicy::AnyHttps;
    let mut current = check_image_hop(start, &policy, cancellation).await?;

    for hop in 0..=skin_net::MAX_REDIRECTS {
        let range = format!("bytes=0-{}", PROBE_BYTES - 1);
        let headers = image_headers(referer_origin, Some(&range))?;
        let mut response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(RemoteImageProbeFailure::Cancelled),
            response = client.get(&current, headers, REQUEST_TIMEOUT) => response,
        }
        .map_err(|error| network_failure(&error))?;

        if response.status().is_redirection() {
            if hop == skin_net::MAX_REDIRECTS {
                return Err(RemoteImageProbeFailure::Redirect);
            }
            let location = response
                .headers()
                .get(hyper::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(RemoteImageProbeFailure::Redirect)?;
            let next = current
                .join(location)
                .map_err(|_| RemoteImageProbeFailure::Redirect)?;
            current = check_image_hop(next.as_str(), &policy, cancellation).await?;
            continue;
        }

        if !matches!(response.status().as_u16(), 200 | 206) {
            return Err(status_failure(response.status()));
        }
        let content_length = response_total_length(&response);
        if content_length.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
            return Err(RemoteImageProbeFailure::TooLarge);
        }
        let content_type = normalized_content_type(&response);
        let prefix = read_prefix(&mut response, cancellation).await?;
        let ValidatedImagePrefix { dimensions, .. } = validate_image_prefix(&content_type, &prefix)
            .ok_or(RemoteImageProbeFailure::InvalidImage)?;
        let content_fingerprint = hex::encode(Sha256::digest(&prefix));
        let (width, height) = dimensions
            .map(|(width, height)| (Some(width), Some(height)))
            .unwrap_or((None, None));
        return Ok(RemoteImageProbe {
            final_url: current.to_string(),
            width,
            height,
            content_length,
            content_fingerprint,
        });
    }

    Err(RemoteImageProbeFailure::Redirect)
}

async fn fetch_remote_image_bytes_with_client(
    client: &SafeHttpsClient,
    start: &str,
    referer_origin: Option<&str>,
    max_bytes: u64,
    cancellation: &WallpaperSearchCancellation,
) -> Result<(String, String, Vec<u8>), RemoteImageProbeFailure> {
    if cancellation.is_cancelled() {
        return Err(RemoteImageProbeFailure::Cancelled);
    }
    let policy = OriginPolicy::AnyHttps;
    let mut current = check_image_hop(start, &policy, cancellation).await?;

    for hop in 0..=skin_net::MAX_REDIRECTS {
        let headers = image_headers(referer_origin, None)?;
        let mut response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(RemoteImageProbeFailure::Cancelled),
            response = client.get(&current, headers, REQUEST_TIMEOUT) => response,
        }
        .map_err(|error| network_failure(&error))?;

        if response.status().is_redirection() {
            if hop == skin_net::MAX_REDIRECTS {
                return Err(RemoteImageProbeFailure::Redirect);
            }
            let location = response
                .headers()
                .get(hyper::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(RemoteImageProbeFailure::Redirect)?;
            let next = current
                .join(location)
                .map_err(|_| RemoteImageProbeFailure::Redirect)?;
            current = check_image_hop(next.as_str(), &policy, cancellation).await?;
            continue;
        }
        if !crate::wallpaper_source::is_complete_download_response(
            response.status().as_u16(),
            response
                .headers()
                .contains_key(hyper::header::CONTENT_RANGE),
        ) {
            return Err(status_failure(response.status()));
        }
        if response_total_length(&response).is_some_and(|length| length > max_bytes) {
            return Err(RemoteImageProbeFailure::TooLarge);
        }
        let content_type = normalized_content_type(&response);
        let mut bytes = Vec::new();
        while let Some(chunk) = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(RemoteImageProbeFailure::Cancelled),
            chunk = response.chunk() => chunk,
        }
        .map_err(|error| network_failure(&error))?
        {
            if (bytes.len() as u64).saturating_add(chunk.len() as u64) > max_bytes {
                return Err(RemoteImageProbeFailure::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        validate_image_prefix(&content_type, &bytes)
            .ok_or(RemoteImageProbeFailure::InvalidImage)?;
        return Ok((current.to_string(), content_type, bytes));
    }

    Err(RemoteImageProbeFailure::Redirect)
}

fn remote_fetch_error(failure: RemoteImageProbeFailure) -> String {
    match failure {
        RemoteImageProbeFailure::Cancelled => "cancelled".into(),
        RemoteImageProbeFailure::Blocked => "url_blocked".into(),
        RemoteImageProbeFailure::TooLarge => "download_failed: too large".into(),
        RemoteImageProbeFailure::InvalidImage => "download_failed: invalid image".into(),
        _ => "download_failed: network".into(),
    }
}

pub(crate) async fn fetch_image_bytes(
    start: &str,
    cancellation: Option<&WallpaperSearchCancellation>,
) -> Result<(String, String, Vec<u8>), String> {
    let default_cancellation = WallpaperSearchCancellation::default();
    let cancellation = cancellation.unwrap_or(&default_cancellation);
    fetch_remote_image_bytes_with_client(
        &safe_https_client::shared(),
        start,
        None,
        MAX_DOWNLOAD_BYTES,
        cancellation,
    )
    .await
    .map_err(remote_fetch_error)
}

pub(crate) async fn fetch_and_store_image(
    start: &str,
    source: RemoteWallpaperSource,
    request_id: &str,
) -> Result<WallpaperFetchResult, String> {
    let (token, cancellation) = begin_media_request(request_id);
    let result = async {
        let referer = registered_source_origin(source, start);
        let (final_url, content_type, bytes) = if let Some(referer) = referer.as_deref() {
            let client = RemoteImageProber::new();
            fetch_remote_image_bytes_with_client(
                &client.client,
                start,
                Some(referer),
                MAX_DOWNLOAD_BYTES,
                &cancellation,
            )
            .await
            .map_err(remote_fetch_error)?
        } else {
            fetch_image_bytes(start, Some(&cancellation)).await?
        };
        if cancellation.is_cancelled() {
            return Err("cancelled".into());
        }
        save_image(&final_url, source, &content_type, bytes)
    }
    .await;
    finish_media_request(request_id, token);
    result
}

fn thumbnail_from_bytes(bytes: Vec<u8>) -> Result<RemoteWallpaperThumbnail, String> {
    let (jpeg, width, height) = crate::image_thumb::thumbnail_jpeg_from_untrusted_bytes(&bytes)
        .map_err(|_| "thumbnail_unavailable".to_string())?;
    if jpeg.is_empty() || jpeg.len() > THUMBNAIL_JPEG_BYTES || width == 0 || height == 0 {
        return Err("thumbnail_unavailable".into());
    }
    Ok(RemoteWallpaperThumbnail {
        data_url: format!("data:image/jpeg;base64,{}", B64.encode(jpeg)),
        width,
        height,
    })
}

pub(crate) async fn fetch_thumbnail(
    start: &str,
    source: RemoteWallpaperSource,
    request_id: &str,
) -> Result<RemoteWallpaperThumbnail, String> {
    let (token, cancellation) = begin_media_request(request_id);
    let result = async {
        let client = RemoteImageProber::new();
        let referer = registered_source_origin(source, start);
        let (_, _, bytes) = fetch_remote_image_bytes_with_client(
            &client.client,
            start,
            referer.as_deref(),
            THUMBNAIL_SOURCE_BYTES,
            &cancellation,
        )
        .await
        .map_err(|failure| match failure {
            RemoteImageProbeFailure::Cancelled => "cancelled".to_string(),
            _ => "thumbnail_unavailable".to_string(),
        })?;
        if cancellation.is_cancelled() {
            return Err("cancelled".into());
        }
        let thumbnail = tokio::task::spawn_blocking(move || thumbnail_from_bytes(bytes))
            .await
            .map_err(|_| "thumbnail_unavailable".to_string())??;
        if cancellation.is_cancelled() {
            return Err("cancelled".into());
        }
        Ok(thumbnail)
    }
    .await;
    finish_media_request(request_id, token);
    result
}

fn save_image(
    final_url: &str,
    source: RemoteWallpaperSource,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<WallpaperFetchResult, String> {
    let (mime, extension) = validate_fetched_media_bytes(content_type, &bytes)?;
    if !mime.starts_with("image/") {
        return Err("download_failed: image required".into());
    }
    let mut digest = Sha256::new();
    digest.update(final_url.as_bytes());
    digest.update(&bytes);
    let hash = format!("{:x}", digest.finalize());
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let directory = crate::wallpaper_source::wallpapers_root()
        .join(source.as_str())
        .join(day);
    fs::create_dir_all(&directory).map_err(|error| format!("write: {error}"))?;
    let name = format!(
        "{}-{}.{}",
        chrono::Local::now().format("%H%M%S%3f"),
        &hash[..16],
        extension
    );
    let path = directory.join(&name);
    let temporary = directory.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
    fs::write(&temporary, &bytes).map_err(|error| format!("write: {error}"))?;
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("write: {error}"));
    }
    crate::path_scope::grant_path(&path);
    Ok(WallpaperFetchResult {
        path: path.display().to_string(),
        mime: mime.to_string(),
        bytes: bytes.len() as u64,
        name,
    })
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::path::Path;

    use crate::paths::APP_HOME_ENV_LOCK;

    use super::*;

    #[test]
    fn content_range_total_shape_is_stable() {
        let parsed = "bytes 0-65535/1048576"
            .rsplit('/')
            .next()
            .and_then(|value| value.parse::<u64>().ok());
        assert_eq!(parsed, Some(1_048_576));
    }

    #[test]
    fn full_remote_download_rejects_partial_response_shapes() {
        assert!(crate::wallpaper_source::is_complete_download_response(
            200, false
        ));
        assert!(!crate::wallpaper_source::is_complete_download_response(
            206, true
        ));
        assert!(!crate::wallpaper_source::is_complete_download_response(
            200, true
        ));
    }

    #[test]
    fn image_referer_contains_only_the_source_origin() {
        let source = Url::parse("https://photos.example/private/path?query=secret").unwrap();
        assert_eq!(
            origin_referer(&source).as_deref(),
            Some("https://photos.example/")
        );
        assert!(origin_referer(&Url::parse("http://photos.example/path").unwrap()).is_none());
        assert_eq!(
            verified_source_origin("https://photos.example/private/path?token=secret").as_deref(),
            Some("https://photos.example/")
        );
    }

    #[test]
    fn source_registry_is_source_scoped_bounded_and_expires() {
        let started = Instant::now();
        let mut registry = SourceOriginRegistry::default();
        registry.register(
            RemoteWallpaperSource::Web,
            "https://cdn.example/photo.jpg".into(),
            "https://photos.example/".into(),
            started,
        );
        assert_eq!(
            registry
                .lookup(
                    RemoteWallpaperSource::Web,
                    "https://cdn.example/photo.jpg",
                    started + Duration::from_secs(1),
                )
                .as_deref(),
            Some("https://photos.example/")
        );
        assert!(registry
            .lookup(
                RemoteWallpaperSource::Openverse,
                "https://cdn.example/photo.jpg",
                started + Duration::from_secs(1),
            )
            .is_none());
        assert!(registry
            .lookup(
                RemoteWallpaperSource::Web,
                "https://cdn.example/photo.jpg",
                started + SOURCE_ORIGIN_TTL + Duration::from_secs(1),
            )
            .is_none());

        for index in 0..=SOURCE_ORIGIN_LIMIT {
            registry.register(
                RemoteWallpaperSource::Pexels,
                format!("https://cdn.example/{index}.jpg"),
                "https://www.pexels.com/".into(),
                started + Duration::from_millis(index as u64),
            );
        }
        assert_eq!(registry.entries.len(), SOURCE_ORIGIN_LIMIT);
        assert!(!registry.entries.contains_key(&(
            RemoteWallpaperSource::Pexels,
            "https://cdn.example/0.jpg".into(),
        )));
    }

    #[test]
    fn source_registry_rejects_renderer_style_header_inputs() {
        assert_eq!(
            canonical_media_url("https://cdn.example/photo.jpg#fragment").as_deref(),
            Some("https://cdn.example/photo.jpg")
        );
        assert!(canonical_media_url("http://cdn.example/photo.jpg").is_none());
        assert!(canonical_media_url("https://user:secret@cdn.example/photo.jpg").is_none());
        assert!(verified_source_origin("https://photos.example:444/item").is_none());
    }

    #[test]
    fn media_cancel_before_begin_is_sticky_bounded_and_expires() {
        let now = Instant::now();
        let mut registry = MediaRequestRegistry::default();
        registry.record_pre_cancel("late-media", now);
        assert!(registry.take_pre_cancel("late-media", now));
        assert!(!registry.take_pre_cancel("late-media", now));

        for index in 0..=PRE_CANCEL_CAPACITY {
            registry.record_pre_cancel(&format!("request-{index}"), now);
        }
        assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
        assert!(!registry.take_pre_cancel("request-0", now));
        assert!(
            !registry.take_pre_cancel("request-1", now + PRE_CANCEL_TTL + Duration::from_secs(1),)
        );
    }

    #[test]
    fn remote_thumbnail_is_bounded_jpeg_data_without_persisting() {
        let image = image::DynamicImage::new_rgb8(1_600, 900);
        let mut png = Cursor::new(Vec::new());
        image
            .write_to(&mut png, image::ImageFormat::Png)
            .expect("encode test image");

        let thumbnail = thumbnail_from_bytes(png.into_inner()).expect("build thumbnail");
        assert_eq!((thumbnail.width, thumbnail.height), (1_600, 900));
        assert!(thumbnail.data_url.starts_with("data:image/jpeg;base64,"));
        assert!(thumbnail.data_url.len() <= 768 * 1024);
    }

    #[test]
    fn probe_http_failures_have_stable_categories() {
        assert_eq!(
            status_failure(StatusCode::FORBIDDEN),
            RemoteImageProbeFailure::Forbidden
        );
        assert_eq!(
            status_failure(StatusCode::NOT_FOUND),
            RemoteImageProbeFailure::NotFound
        );
        assert_eq!(
            status_failure(StatusCode::TOO_MANY_REQUESTS),
            RemoteImageProbeFailure::RateLimited
        );
        assert_eq!(
            status_failure(StatusCode::BAD_GATEWAY),
            RemoteImageProbeFailure::HttpServer
        );
    }

    #[test]
    fn stored_remote_images_stay_in_their_source_directory() {
        let _environment = APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let home = std::env::temp_dir().join(format!(
            "grok-app-remote-image-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        // SAFETY: test-only mutation serialized by APP_HOME_ENV_LOCK.
        unsafe { std::env::set_var("GROK_APP_HOME", &home) };
        let mut png = vec![0u8; 128];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let saved = save_image(
            "https://images.example.test/wallpaper.png",
            RemoteWallpaperSource::Web,
            "image/png",
            png,
        )
        .expect("save remote image");
        assert!(Path::new(&saved.path).is_file());
        assert!(Path::new(&saved.path).starts_with(home.join("wallpapers").join("web")));

        unsafe { std::env::remove_var("GROK_APP_HOME") };
        let _ = fs::remove_dir_all(home);
    }
}
