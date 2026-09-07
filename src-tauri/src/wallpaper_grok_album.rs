//! Read-only bridge for the consumer Grok Imagine saved page.
//!
//! The page runs in a dedicated, zero-capability WebView window. The Host does
//! not read cookies or storage and never accepts caller-provided JavaScript.
//! Only a bounded, allowlisted media DTO can cross back to the app UI.

mod cache;
mod fetch_route;
mod media_fetch;
mod media_store;
mod model;
mod request_registry;
#[cfg(test)]
mod script_tests;
#[cfg(test)]
mod tests;

use cache::{
    cache_revision, cached_items, cached_media_contains, cached_media_state, clear_cache,
    reconcile_cache_at_revision,
};
#[cfg(test)]
use cache::{
    merge_cache, merge_cache_items_at_revision, reconcile_cache_items_at_revision, AlbumCache,
};
use fetch_route::{first_success, AlbumFetchRoute};
pub use model::{GrokAlbumMedia, GrokAlbumSnapshot, GrokAlbumStatus, GrokAlbumThumbnail};
use model::{RawAlbumMedia, RawAlbumSnapshot, RawAlbumThumbnailJob};
use request_registry::{
    cancel as cancel_album_requests, cancel_all as cancel_all_album_requests,
    register as register_album_request,
};

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use parking_lot::Mutex;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::wallpaper_source::WallpaperSearchCancellation;

const WINDOW_LABEL: &str = "grok-imagine-saved";
const SAVED_URL: &str = "https://grok.com/imagine/saved";
const MAX_BRIDGE_ITEMS: usize = 320;
const MAX_MEDIA_URL_LENGTH: usize = 4_096;
const MAX_BRIDGE_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;
const EVAL_TIMEOUT: Duration = Duration::from_secs(10);
const LOAD_MORE_ATTEMPTS: usize = 4;
const LOAD_MORE_WAIT: Duration = Duration::from_millis(700);
const MAX_THUMB_SOURCE_BYTES: usize = 12 * 1024 * 1024;
const MAX_THUMB_JPEG_BYTES: usize = 512 * 1024;
const MAX_THUMB_HEADER_BYTES: usize = 64 * 1024;
const THUMB_WEBVIEW_TIMEOUT: Duration = Duration::from_secs(18);
const THUMB_WEBVIEW_POLL: Duration = Duration::from_millis(90);

// Stable, album-specific WKWebView data-store identifier (macOS 14+). Windows
// and Linux use `data_directory`; unsupported platforms ignore this field.
const DATA_STORE_IDENTIFIER: [u8; 16] = [
    0x47, 0x72, 0x6f, 0x6b, 0x41, 0x6c, 0x62, 0x75, 0x6d, 0x57, 0x65, 0x62, 0x56, 0x31, 0x00, 0x01,
];

const BRIDGE_MARKER_SCRIPT: &str = include_str!("wallpaper_grok_album/bridge_marker.js");

// Grok currently renders `/imagine/saved` as an empty shell when its consumer
// session is signed out. Recover to the official home page so the user can use
// Grok's own sign-in button. A signed-in Saved page exposes its normal `main`
// shell and is left untouched. No auth state, storage or network response is
// inspected by this fixed script.
const SIGNED_OUT_RECOVERY_SCRIPT: &str =
    include_str!("wallpaper_grok_album/signed_out_recovery.js");

// This is the only script that bridges data from the remote document. It
// deliberately avoids text content, cookies, storage, headers, request bodies
// and responses.
const SNAPSHOT_SCRIPT: &str = include_str!("wallpaper_grok_album/snapshot.js");

const SCROLL_MORE_SCRIPT: &str = include_str!("wallpaper_grok_album/scroll_more.js");
const SCROLL_RESTORE_SCRIPT: &str = include_str!("wallpaper_grok_album/scroll_restore.js");

static ALBUM_PAGE_OPERATION: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static ALBUM_WINDOW_PROXY_OVERRIDE: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));

fn album_data_directory() -> PathBuf {
    crate::paths::app_data_root()
        .join("webviews")
        .join("grok-imagine-saved")
}

fn detach_album_menu(window: &WebviewWindow) {
    #[cfg(not(target_os = "macos"))]
    {
        // The application menu is useful in document windows, but adds a
        // redundant File/Edit/Window/Help row above this isolated web page.
        // A window-local empty menu also prevents a later app-wide menu
        // refresh from attaching the row again.
        if let Ok(empty) = tauri::menu::Menu::new(window.app_handle()) {
            let _ = window.set_menu(empty);
        }
        let _ = window.hide_menu();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = window;
    }
}

/// Re-apply the album window chrome after the app-wide menu is refreshed.
pub(crate) fn reassert_window_chrome(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        detach_album_menu(&window);
    }
}

fn host_matches(host: &str, base: &str) -> bool {
    host == base || host.ends_with(&format!(".{base}"))
}

/// Top-level navigation allowlist. Subresources are governed by the page; the
/// remote window has no Tauri capability regardless of the identity provider.
pub fn is_allowed_album_navigation(url: &Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    host_matches(&host, "grok.com")
        || host_matches(&host, "x.ai")
        || host_matches(&host, "x.com")
        || host_matches(&host, "twitter.com")
        || host == "accounts.google.com"
        || host == "accounts.googleusercontent.com"
        || host == "appleid.apple.com"
}

fn classify_page(
    url: &Url,
    ready_state: &str,
    has_app_shell: bool,
    has_security_challenge: bool,
    recovery_state: &str,
) -> GrokAlbumStatus {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    if host_matches(&host, "grok.com") && (has_security_challenge || recovery_state == "challenge")
    {
        return GrokAlbumStatus::Verification;
    }
    let auth_path = path.contains("sign-in")
        || path.contains("signin")
        || path.contains("log-in")
        || path.contains("login")
        || path.contains("oauth")
        || path.contains("authorize");
    if auth_path
        || host_matches(&host, "x.ai")
        || host_matches(&host, "x.com")
        || host_matches(&host, "twitter.com")
        || host == "accounts.google.com"
        || host == "accounts.googleusercontent.com"
        || host == "appleid.apple.com"
    {
        return GrokAlbumStatus::SignIn;
    }
    if host_matches(&host, "grok.com") && path.starts_with("/imagine/saved") {
        return if has_app_shell && (ready_state == "interactive" || ready_state == "complete") {
            GrokAlbumStatus::Ready
        } else if recovery_state == "redirecting" {
            GrokAlbumStatus::SignIn
        } else {
            GrokAlbumStatus::Loading
        };
    }
    if host_matches(&host, "grok.com") {
        GrokAlbumStatus::OtherPage
    } else {
        GrokAlbumStatus::Loading
    }
}

fn sanitize_media_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > MAX_MEDIA_URL_LENGTH {
        return None;
    }
    let mut url = Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || !url.host_str()?.eq_ignore_ascii_case("assets.grok.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || !url.path().contains("/generated/")
    {
        return None;
    }
    // Do not bridge arbitrary or signed query values. Known transform keys are
    // sufficient for public asset variants; the original path remains usable.
    let safe_pairs = url
        .query_pairs()
        .filter_map(|(key, value)| {
            let key = key.to_ascii_lowercase();
            let value = value.into_owned();
            let allowed = match key.as_str() {
                "format" => value.len() <= 8 && value.chars().all(|c| c.is_ascii_alphanumeric()),
                "w" | "h" | "width" | "height" => {
                    value.len() <= 6 && value.chars().all(|c| c.is_ascii_digit())
                }
                "cache" => value == "0" || value == "1",
                _ => false,
            };
            allowed.then_some((key, value))
        })
        .collect::<Vec<_>>();
    url.set_query(None);
    url.set_fragment(None);
    if !safe_pairs.is_empty() {
        let mut query = url.query_pairs_mut();
        for (key, value) in safe_pairs {
            query.append_pair(&key, &value);
        }
    }
    let sanitized = url.to_string();
    (sanitized.len() <= MAX_MEDIA_URL_LENGTH).then_some(sanitized)
}

fn ensure_thumbnail_active(cancellation: &WallpaperSearchCancellation) -> Result<(), String> {
    if cancellation.is_cancelled() {
        Err("album_thumbnail_cancelled".to_string())
    } else {
        Ok(())
    }
}

async fn fetch_album_thumbnail(
    raw_url: String,
    cancellation: &WallpaperSearchCancellation,
) -> Result<GrokAlbumThumbnail, String> {
    ensure_thumbnail_active(cancellation)?;
    let url = sanitize_media_url(&raw_url).ok_or_else(|| "album_thumbnail_blocked".to_string())?;
    let client = crate::proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ),
    )
    .build()
    .map_err(|_| "album_thumbnail_unavailable".to_string())?;
    let mut response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "image/jpeg,image/png,image/webp;q=0.9,image/avif;q=0.8,image/*;q=0.7,*/*;q=0.5",
        )
        .header(reqwest::header::REFERER, SAVED_URL)
        .header("sec-fetch-dest", "image")
        .header("sec-fetch-mode", "no-cors")
        .header("sec-fetch-site", "same-site")
        .send()
        .await
        .map_err(|_| "album_thumbnail_unavailable".to_string())?;
    ensure_thumbnail_active(cancellation)?;
    if !response.status().is_success() {
        tracing::debug!(
            status = response.status().as_u16(),
            "Grok album thumbnail request rejected"
        );
        return Err("album_thumbnail_unavailable".to_string());
    }
    let is_image = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("image/"));
    if !is_image
        || response
            .content_length()
            .is_some_and(|length| length > MAX_THUMB_SOURCE_BYTES as u64)
    {
        return Err("album_thumbnail_unavailable".to_string());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "album_thumbnail_unavailable".to_string())?
    {
        ensure_thumbnail_active(cancellation)?;
        if bytes.len().saturating_add(chunk.len()) > MAX_THUMB_SOURCE_BYTES {
            return Err("album_thumbnail_unavailable".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("album_thumbnail_unavailable".to_string());
    }
    ensure_thumbnail_active(cancellation)?;

    let (jpeg, width, height) = tokio::task::spawn_blocking(move || {
        crate::image_thumb::thumbnail_jpeg_from_untrusted_bytes(&bytes)
    })
    .await
    .map_err(|_| "album_thumbnail_unavailable".to_string())?
    .map_err(|_| "album_thumbnail_unavailable".to_string())?;
    ensure_thumbnail_active(cancellation)?;
    if jpeg.is_empty() || jpeg.len() > MAX_THUMB_JPEG_BYTES || width == 0 || height == 0 {
        return Err("album_thumbnail_unavailable".to_string());
    }
    Ok(GrokAlbumThumbnail {
        data_url: format!("data:image/jpeg;base64,{}", B64.encode(jpeg)),
        width,
        height,
    })
}

fn sanitize_short_field(
    raw: Option<String>,
    max: usize,
    allowed: fn(char) -> bool,
) -> Option<String> {
    let value = raw?.trim().to_string();
    if value.is_empty() || value.len() > max || !value.chars().all(allowed) {
        return None;
    }
    Some(value)
}

fn sanitize_raw_item(raw: RawAlbumMedia) -> Option<GrokAlbumMedia> {
    let media_url = sanitize_media_url(&raw.media_url)?;
    let kind = match raw.kind.trim().to_ascii_lowercase().as_str() {
        "video" => "video",
        _ => "image",
    };
    let thumbnail_url = raw
        .thumbnail_url
        .as_deref()
        .and_then(sanitize_media_url)
        .or_else(|| (kind == "image").then(|| media_url.clone()));
    if kind == "video" && thumbnail_url.is_none() {
        return None;
    }
    let webview_only =
        raw.webview_only && kind == "video" && thumbnail_url.as_deref() == Some(media_url.as_str());
    if raw.webview_only && !webview_only {
        return None;
    }
    let width = raw.width.filter(|v| (1..=32_768).contains(v));
    let height = raw.height.filter(|v| (1..=32_768).contains(v));
    let created_at = sanitize_short_field(raw.created_at, 64, |c| {
        c.is_ascii_digit() || matches!(c, 'T' | 'Z' | ':' | '+' | '-' | '.')
    });
    let post_id = sanitize_short_field(raw.post_id, 128, |c| {
        c.is_ascii_alphanumeric() || matches!(c, '-' | '_')
    });
    Some(GrokAlbumMedia {
        media_url,
        thumbnail_url,
        kind: kind.to_string(),
        width,
        height,
        created_at,
        post_id,
        webview_only,
    })
}

fn decode_eval_snapshot(raw: &str) -> Result<RawAlbumSnapshot, String> {
    if raw.len() > MAX_BRIDGE_PAYLOAD_BYTES {
        return Err("album_bridge_invalid".to_string());
    }
    let first: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "album_bridge_invalid".to_string())?;
    let value = match first {
        serde_json::Value::String(inner) => {
            serde_json::from_str(&inner).map_err(|_| "album_bridge_invalid".to_string())?
        }
        other => other,
    };
    serde_json::from_value(value).map_err(|_| "album_bridge_invalid".to_string())
}

fn eval_fixed(window: &WebviewWindow, script: &'static str) -> Result<String, String> {
    eval_script(window, script)
}

fn eval_script(window: &WebviewWindow, script: &str) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<String>();
    window
        .eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|_| "album_bridge_unavailable".to_string())?;
    rx.recv_timeout(EVAL_TIMEOUT)
        .map_err(|_| "album_bridge_timeout".to_string())
}

fn decode_eval_thumbnail_job(raw: &str) -> Result<RawAlbumThumbnailJob, String> {
    if raw.len() > MAX_BRIDGE_PAYLOAD_BYTES {
        return Err("album_thumbnail_unavailable".to_string());
    }
    let first: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "album_thumbnail_unavailable".to_string())?;
    let value = match first {
        serde_json::Value::String(inner) => {
            serde_json::from_str(&inner).map_err(|_| "album_thumbnail_unavailable".to_string())?
        }
        other => other,
    };
    serde_json::from_value(value).map_err(|_| "album_thumbnail_unavailable".to_string())
}

fn thumbnail_job_start_script(url: &str) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "album_thumbnail_blocked".to_string())?;
    Ok(include_str!("wallpaper_grok_album/thumbnail_start.js")
        .replace(
            "__MAX_DATA_URL__",
            &((MAX_THUMB_JPEG_BYTES * 4 / 3) + 128).to_string(),
        )
        .replace("__MAX_HEADER_BYTES__", &MAX_THUMB_HEADER_BYTES.to_string())
        .replace(
            "__MAX_DIMENSION__",
            &crate::image_thumb::UNTRUSTED_THUMB_MAX_DIMENSION.to_string(),
        )
        .replace(
            "__MAX_PIXELS__",
            &crate::image_thumb::UNTRUSTED_THUMB_MAX_PIXELS.to_string(),
        )
        .replace("__MAX_SOURCE_BYTES__", &MAX_THUMB_SOURCE_BYTES.to_string())
        .replace("__URL__", &url))
}

fn thumbnail_job_poll_script(url: &str, remove: bool) -> Result<String, String> {
    let url = serde_json::to_string(url).map_err(|_| "album_thumbnail_blocked".to_string())?;
    Ok(include_str!("wallpaper_grok_album/thumbnail_poll.js")
        .replace("__REMOVE__", if remove { "true" } else { "false" })
        .replace("__URL__", &url))
}

fn fetch_album_thumbnail_from_webview(
    app: &AppHandle,
    raw_url: &str,
    cancellation: &WallpaperSearchCancellation,
) -> Result<GrokAlbumThumbnail, String> {
    let url = sanitize_media_url(raw_url).ok_or_else(|| "album_thumbnail_blocked".to_string())?;
    if !cached_media_contains(&url) {
        return Err("album_thumbnail_blocked".to_string());
    }
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "album_thumbnail_unavailable".to_string())?;
    let page_url = window
        .url()
        .map_err(|_| "album_thumbnail_unavailable".to_string())?;
    if !page_url
        .host_str()
        .is_some_and(|host| host.eq_ignore_ascii_case("grok.com"))
        || !page_url.path().starts_with("/imagine/saved")
    {
        return Err("album_thumbnail_unavailable".to_string());
    }

    let result = (|| {
        ensure_thumbnail_active(cancellation)?;
        let start = thumbnail_job_start_script(&url)?;
        let _ = eval_script(&window, &start)?;
        let deadline = Instant::now() + THUMB_WEBVIEW_TIMEOUT;
        while Instant::now() < deadline {
            ensure_thumbnail_active(cancellation)?;
            let poll = thumbnail_job_poll_script(&url, false)?;
            let job = decode_eval_thumbnail_job(&eval_script(&window, &poll)?)?;
            match job.state.as_str() {
                "ready" => {
                    if job.data_url.starts_with("data:image/jpeg;base64,")
                        && job.data_url.len() <= (MAX_THUMB_JPEG_BYTES * 4 / 3) + 128
                        && job.width > 0
                        && job.height > 0
                    {
                        return Ok(GrokAlbumThumbnail {
                            data_url: job.data_url,
                            width: job.width,
                            height: job.height,
                        });
                    }
                    return Err("album_thumbnail_unavailable".to_string());
                }
                "error" => return Err("album_thumbnail_unavailable".to_string()),
                _ => std::thread::sleep(THUMB_WEBVIEW_POLL),
            }
        }
        Err("album_thumbnail_unavailable".to_string())
    })();
    if let Ok(cleanup) = thumbnail_job_poll_script(&url, true) {
        let _ = eval_script(&window, &cleanup);
    }
    result
}

fn closed_snapshot() -> GrokAlbumSnapshot {
    clear_cache();
    GrokAlbumSnapshot {
        status: GrokAlbumStatus::Closed,
        total: 0,
        items: Vec::new(),
        can_load_more: false,
        new_items: 0,
        prefetch_skipped: false,
        page_changed: false,
    }
}

fn snapshot_from_window(window: &WebviewWindow) -> Result<GrokAlbumSnapshot, String> {
    // A navigation clears the cache and advances this revision. An eval that
    // started in the previous document must not repopulate the new page with
    // stale media after the navigation callback has already run.
    let expected_revision = cache_revision();
    let url = window
        .url()
        .map_err(|_| "album_page_unavailable".to_string())?;
    let raw = decode_eval_snapshot(&eval_fixed(window, SNAPSHOT_SCRIPT)?)?;
    let status = classify_page(
        &url,
        &raw.ready_state,
        raw.has_app_shell,
        raw.has_security_challenge,
        &raw.recovery_state,
    );
    if status != GrokAlbumStatus::Ready {
        clear_cache();
    }
    if raw.bridge_error {
        return Err("album_bridge_unavailable".to_string());
    }
    let page_epoch = raw.page_epoch;
    let scroll_top = raw.scroll_top;
    let incoming = raw
        .items
        .into_iter()
        .take(MAX_BRIDGE_ITEMS)
        .filter_map(sanitize_raw_item)
        .collect::<Vec<_>>();
    let (new_items, page_changed) = if status == GrokAlbumStatus::Ready {
        reconcile_cache_at_revision(incoming, expected_revision, page_epoch, scroll_top)
            .ok_or_else(|| "album_page_changed".to_string())?
    } else {
        (0, false)
    };
    let items = cached_items();
    let can_load_more = status == GrokAlbumStatus::Ready
        && !items.is_empty()
        && raw.scroll_height >= raw.viewport_height
        && (raw.at_bottom || raw.scroll_height > raw.viewport_height);
    Ok(GrokAlbumSnapshot {
        status,
        total: items.len(),
        items,
        can_load_more,
        new_items,
        prefetch_skipped: false,
        page_changed,
    })
}

fn open_album_window(app: &AppHandle, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 128 {
        return Err("album_title_invalid".to_string());
    }
    // Validate the current route before reusing an existing window. This also
    // prevents a stale window from bypassing a newly selected Direct or
    // otherwise unsupported proxy mode if its earlier destruction failed.
    let proxy_url = crate::proxy::webview_proxy_override()
        .map_err(|_| "album_proxy_unsupported".to_string())?;
    let proxy_override = proxy_url.as_ref().map(|url| url.as_str().to_string());
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let route_matches = *ALBUM_WINDOW_PROXY_OVERRIDE.lock() == proxy_override;
        if route_matches {
            let _ = window.set_title(title);
            let _ = window.unminimize();
            window
                .show()
                .map_err(|_| "album_window_unavailable".to_string())?;
            window
                .set_focus()
                .map_err(|_| "album_window_unavailable".to_string())?;
            return Ok(());
        }
        window
            .destroy()
            .map_err(|_| "album_window_unavailable".to_string())?;
    }

    let data_dir = album_data_directory();
    std::fs::create_dir_all(&data_dir).map_err(|_| "album_profile_unavailable".to_string())?;
    let url = Url::parse(SAVED_URL).map_err(|_| "album_url_invalid".to_string())?;
    clear_cache();
    let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title(title)
        .inner_size(1120.0, 780.0)
        .min_inner_size(720.0, 540.0)
        .resizable(true)
        .center()
        .visible(false)
        .data_directory(data_dir)
        .data_store_identifier(DATA_STORE_IDENTIFIER)
        .incognito(false)
        .devtools(cfg!(debug_assertions))
        .initialization_script(BRIDGE_MARKER_SCRIPT)
        .initialization_script(SIGNED_OUT_RECOVERY_SCRIPT)
        .on_navigation(|url| {
            let allowed = is_allowed_album_navigation(url);
            if allowed {
                // A top-level navigation can represent logout or an account
                // switch. Never merge a previous page's in-memory album into
                // the next page instance.
                clear_cache();
            }
            allowed
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, _| false);
    if let Some(proxy_url) = proxy_url {
        builder = builder.proxy_url(proxy_url);
    }
    let window = builder
        .build()
        .map_err(|_| "album_window_unavailable".to_string())?;
    *ALBUM_WINDOW_PROXY_OVERRIDE.lock() = proxy_override;
    detach_album_menu(&window);
    window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            clear_cache();
        }
    });
    window
        .show()
        .map_err(|_| "album_window_unavailable".to_string())?;
    window
        .set_focus()
        .map_err(|_| "album_window_unavailable".to_string())?;
    Ok(())
}

/// A remote WebView cannot change its proxy after construction. Drop the
/// isolated window when network settings change; its dedicated persistent
/// profile keeps the official sign-in session for the next open.
pub(crate) fn close_for_proxy_change(app: &AppHandle) {
    clear_cache();
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.destroy();
    }
}

fn refresh_album_window(app: &AppHandle) -> Result<(), String> {
    let _operation = ALBUM_PAGE_OPERATION.lock();
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "album_window_closed".to_string())?;
    clear_cache();
    let url = Url::parse(SAVED_URL).map_err(|_| "album_url_invalid".to_string())?;
    window
        .navigate(url)
        .map_err(|_| "album_page_unavailable".to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    window
        .set_focus()
        .map_err(|_| "album_window_unavailable".to_string())
}

fn load_more_from_window(
    window: &WebviewWindow,
    only_when_background: bool,
) -> Result<GrokAlbumSnapshot, String> {
    let _operation = ALBUM_PAGE_OPERATION.lock();
    let initial = snapshot_from_window(window)?;
    if initial.status != GrokAlbumStatus::Ready || !initial.can_load_more {
        return Ok(initial);
    }
    if only_when_background && window.is_focused().unwrap_or(true) {
        return Ok(GrokAlbumSnapshot {
            prefetch_skipped: true,
            new_items: 0,
            ..initial
        });
    }

    let result = (|| {
        let baseline = initial.total;
        let mut latest = initial;
        for _ in 0..LOAD_MORE_ATTEMPTS {
            if only_when_background && window.is_focused().unwrap_or(true) {
                return Ok(GrokAlbumSnapshot {
                    prefetch_skipped: true,
                    new_items: latest.total.saturating_sub(baseline),
                    ..latest
                });
            }
            let _ = eval_fixed(window, SCROLL_MORE_SCRIPT)?;
            std::thread::sleep(LOAD_MORE_WAIT);
            latest = snapshot_from_window(window)?;
            if latest.total > baseline || latest.status != GrokAlbumStatus::Ready {
                break;
            }
        }
        latest.new_items = latest.total.saturating_sub(baseline);
        Ok(latest)
    })();

    // Background lookahead must not leave the user's official Grok page at
    // the infinite-scroll boundary. The fixed page script remembers the
    // original root and offset before the first scroll; always restore it,
    // including focus changes and bridge failures.
    let _ = eval_fixed(window, SCROLL_RESTORE_SCRIPT);
    result
}

#[tauri::command]
pub async fn wallpaper_grok_album_open(app: AppHandle, title: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_album_window(&app, title))
        .await
        .map_err(|_| "album_window_unavailable".to_string())?
}

#[tauri::command]
pub async fn wallpaper_grok_album_snapshot(app: AppHandle) -> Result<GrokAlbumSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
            return Ok(closed_snapshot());
        };
        snapshot_from_window(&window)
    })
    .await
    .map_err(|_| "album_bridge_unavailable".to_string())?
}

#[tauri::command]
pub async fn wallpaper_grok_album_refresh(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || refresh_album_window(&app))
        .await
        .map_err(|_| "album_page_unavailable".to_string())?
}

#[tauri::command]
pub async fn wallpaper_grok_album_load_more(
    app: AppHandle,
    background_only: Option<bool>,
) -> Result<GrokAlbumSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
            return Ok(closed_snapshot());
        };
        load_more_from_window(&window, background_only.unwrap_or(false))
    })
    .await
    .map_err(|_| "album_bridge_unavailable".to_string())?
}

#[tauri::command]
pub async fn wallpaper_grok_album_thumbnail(
    app: AppHandle,
    url: String,
    request_id: String,
) -> Result<GrokAlbumThumbnail, String> {
    let request = register_album_request(&request_id)?;
    ensure_thumbnail_active(&request.cancellation)?;
    let url = sanitize_media_url(&url).ok_or_else(|| "album_thumbnail_blocked".to_string())?;
    if !cached_media_contains(&url) {
        return Err("album_thumbnail_blocked".to_string());
    }
    let started = Instant::now();
    let cancellation = request.cancellation.clone();
    let webview_cancellation = cancellation.clone();
    let webview_url = url.clone();
    let webview = async move {
        tauri::async_runtime::spawn_blocking(move || {
            fetch_album_thumbnail_from_webview(&app, &webview_url, &webview_cancellation)
        })
        .await
        .map_err(|_| "album_thumbnail_unavailable".to_string())?
    };
    let host_cancellation = cancellation.clone();
    let host_url = url.clone();
    let host = async move { fetch_album_thumbnail(host_url, &host_cancellation).await };
    let cancellation_wait = cancellation.clone();
    let result = tokio::select! {
        result = first_success(webview, host) => result,
        _ = cancellation_wait.cancelled() => Err("album_thumbnail_cancelled".to_string()),
    };
    let (thumbnail, route) = result?;
    cancellation.cancel();
    if !cached_media_contains(&url) {
        return Err("album_thumbnail_unavailable".to_string());
    }
    tracing::debug!(
        route = route.as_str(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "Grok album thumbnail route completed"
    );
    Ok(thumbnail)
}

#[tauri::command]
pub fn wallpaper_grok_album_cancel_requests(request_ids: Vec<String>) -> Result<usize, String> {
    let requested = request_ids.len();
    let active = cancel_album_requests(&request_ids)?;
    tracing::debug!(
        requested = requested as u64,
        active = active as u64,
        "Grok album requests cancelled"
    );
    Ok(active)
}

#[tauri::command]
pub fn wallpaper_grok_album_cancel_all_requests() -> usize {
    let active = cancel_all_album_requests();
    tracing::debug!(
        active = active as u64,
        "Grok album active requests cancelled"
    );
    active
}

#[tauri::command]
pub async fn wallpaper_grok_album_fetch_media(
    app: AppHandle,
    url: String,
    request_id: String,
) -> Result<crate::wallpaper_source::WallpaperFetchResult, String> {
    let request = register_album_request(&request_id)?;
    if request.cancellation.is_cancelled() {
        return Err("download_failed: album media cancelled".to_string());
    }
    crate::wallpaper_source::ensure_wallpaper_dirs();
    let url = sanitize_media_url(&url).ok_or_else(|| "url_blocked".to_string())?;
    let (expected_revision, webview_only) =
        cached_media_state(&url).ok_or_else(|| "url_blocked".to_string())?;
    let started = Instant::now();
    let _media_lock = media_store::acquire(&url, &request.cancellation).await?;
    if cache_revision() != expected_revision || !cached_media_contains(&url) {
        return Err("download_failed: album page changed".to_string());
    }
    if let Some(cached) = media_store::lookup(&url)? {
        request.cancellation.cancel();
        tracing::debug!(
            route = "cache",
            media_transport = if webview_only { "blob" } else { "remote" },
            elapsed_ms = started.elapsed().as_millis() as u64,
            bytes = cached.bytes,
            "Grok album media route completed"
        );
        return Ok(cached);
    }
    tracing::debug!(
        media_transport = if webview_only { "blob" } else { "remote" },
        "Grok album media route started"
    );
    let cancellation = request.cancellation.clone();
    let app_for_webview = app.clone();
    let url_for_webview = url.clone();
    let webview_cancellation = cancellation.clone();
    let webview = async move {
        tauri::async_runtime::spawn_blocking(move || {
            media_fetch::fetch_from_webview(
                &app_for_webview,
                &url_for_webview,
                &webview_cancellation,
                webview_only,
            )
        })
        .await
        .map_err(|_| "download_failed: album media task failed".to_string())?
    };
    let host_url = url.clone();
    let host = async move {
        let (content_type, bytes) =
            crate::wallpaper_source::fetch_remote_media_bytes(&host_url, Some("grok_album"))
                .await?;
        Ok((bytes, content_type))
    };
    let transfer = async {
        if webview_only {
            webview.await.map(|value| (value, AlbumFetchRoute::Webview))
        } else {
            first_success(webview, host).await
        }
    };
    let cancellation_wait = cancellation.clone();
    let result = tokio::select! {
        result = transfer => result,
        _ = cancellation_wait.cancelled() => {
            Err("download_failed: album media cancelled".to_string())
        }
    };
    let ((bytes, content_type), route) = result?;
    cancellation.cancel();
    // Navigation, logout, or an account switch invalidates the URL after the
    // race has started. Never persist a late winner from the previous page.
    if cache_revision() != expected_revision || !cached_media_contains(&url) {
        return Err("download_failed: album page changed".to_string());
    }
    tracing::debug!(
        route = route.as_str(),
        media_transport = if webview_only { "blob" } else { "remote" },
        elapsed_ms = started.elapsed().as_millis() as u64,
        bytes = bytes.len() as u64,
        "Grok album media route completed"
    );
    tauri::async_runtime::spawn_blocking(move || media_store::save(&url, &content_type, bytes))
        .await
        .map_err(|_| "download_failed: album media save task failed".to_string())?
}
