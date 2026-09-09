use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use super::{
    ApiPage, ProviderCandidate, ProviderError, OPENVERSE_PAGE_SIZE, PEXELS_LICENSE_URL,
    PEXELS_PAGE_SIZE,
};
use crate::wallpaper_remote_media::{self, RemoteImageProbe};
use crate::wallpaper_remote_search::RemoteWallpaperSource;
use crate::wallpaper_source::{WallpaperGalleryItem, WallpaperProvenance};

pub(super) fn parse_api_page(
    source: RemoteWallpaperSource,
    value: &Value,
    page: usize,
) -> Result<ApiPage, ProviderError> {
    match source {
        RemoteWallpaperSource::Openverse => parse_openverse_page(value, page),
        RemoteWallpaperSource::Pexels => parse_pexels_page(value, page),
        RemoteWallpaperSource::Web => Err(ProviderError::Protocol),
    }
}

pub(super) fn parse_openverse_page(value: &Value, page: usize) -> Result<ApiPage, ProviderError> {
    let results = value
        .get("results")
        .and_then(Value::as_array)
        .ok_or(ProviderError::Protocol)?;
    let page_count = value.get("page_count").and_then(Value::as_u64);
    let has_more = page_count
        .map(|count| (page as u64) < count)
        .unwrap_or(results.len() >= OPENVERSE_PAGE_SIZE);
    let mut candidates = Vec::new();
    for raw in results.iter().take(OPENVERSE_PAGE_SIZE) {
        if raw.get("mature").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(image_url) = raw.get("url").and_then(Value::as_str).and_then(safe_url) else {
            continue;
        };
        let Some(source_url) = raw
            .get("foreign_landing_url")
            .and_then(Value::as_str)
            .and_then(safe_url)
        else {
            continue;
        };
        let Some(author_name) = clean_text(raw.get("creator").and_then(Value::as_str), 160) else {
            continue;
        };
        let Some(license_url) = raw
            .get("license_url")
            .and_then(Value::as_str)
            .and_then(safe_url)
        else {
            continue;
        };
        let Some(license) = openverse_license_label(
            raw.get("license").and_then(Value::as_str),
            raw.get("license_version").and_then(Value::as_str),
        ) else {
            continue;
        };
        let upstream_id = clean_text(raw.get("id").and_then(Value::as_str), 160)
            .unwrap_or_else(|| opaque_id(&image_url));
        candidates.push(ProviderCandidate {
            upstream_id,
            image_url,
            thumbnail_url: raw
                .get("thumbnail")
                .and_then(Value::as_str)
                .and_then(safe_url),
            source_url,
            source_name: "Openverse",
            title: clean_text(raw.get("title").and_then(Value::as_str), 240),
            author_name,
            author_url: raw
                .get("creator_url")
                .and_then(Value::as_str)
                .and_then(safe_url),
            license,
            license_url,
        });
    }
    Ok(ApiPage {
        candidates,
        has_more,
    })
}

pub(super) fn parse_pexels_page(value: &Value, page: usize) -> Result<ApiPage, ProviderError> {
    let results = value
        .get("photos")
        .and_then(Value::as_array)
        .ok_or(ProviderError::Protocol)?;
    let total = value.get("total_results").and_then(Value::as_u64);
    let per_page = value
        .get("per_page")
        .and_then(Value::as_u64)
        .unwrap_or(PEXELS_PAGE_SIZE as u64)
        .max(1);
    let has_more = total
        .map(|count| (page as u64).saturating_mul(per_page) < count)
        .unwrap_or_else(|| value.get("next_page").is_some_and(|next| !next.is_null()));
    let mut candidates = Vec::new();
    for raw in results.iter().take(PEXELS_PAGE_SIZE) {
        let Some(src) = raw.get("src") else {
            continue;
        };
        let Some(image_url) = first_safe_url(src, &["original", "large2x"]) else {
            continue;
        };
        let thumbnail_url = first_safe_url(src, &["large", "medium", "large2x", "landscape"]);
        let Some(source_url) = raw.get("url").and_then(Value::as_str).and_then(safe_url) else {
            continue;
        };
        let Some(author_name) = clean_text(raw.get("photographer").and_then(Value::as_str), 160)
        else {
            continue;
        };
        let upstream_id = raw
            .get("id")
            .and_then(|id| {
                id.as_u64()
                    .map(|value| value.to_string())
                    .or_else(|| clean_text(id.as_str(), 160))
            })
            .unwrap_or_else(|| opaque_id(&image_url));
        candidates.push(ProviderCandidate {
            upstream_id,
            image_url,
            thumbnail_url,
            source_url,
            source_name: "Pexels",
            title: clean_text(raw.get("alt").and_then(Value::as_str), 240),
            author_name,
            author_url: raw
                .get("photographer_url")
                .and_then(Value::as_str)
                .and_then(safe_url),
            license: "Pexels License".into(),
            license_url: PEXELS_LICENSE_URL.into(),
        });
    }
    Ok(ApiPage {
        candidates,
        has_more,
    })
}

fn first_safe_url(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).and_then(safe_url))
}

pub(super) fn safe_url(raw: &str) -> Option<String> {
    if raw.len() > 2_048 {
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

fn clean_text(value: Option<&str>, limit: usize) -> Option<String> {
    let value = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() {
        None
    } else {
        Some(value.chars().take(limit).collect())
    }
}

fn openverse_license_label(code: Option<&str>, version: Option<&str>) -> Option<String> {
    let code = code?.trim().to_ascii_lowercase();
    if code.is_empty()
        || !code
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return None;
    }
    let version = version.map(str::trim).filter(|value| {
        !value.is_empty()
            && value
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
    });
    let base = match code.as_str() {
        "cc0" => "CC0".to_string(),
        "pdm" => "Public Domain Mark".to_string(),
        other => format!("CC {}", other.to_ascii_uppercase()),
    };
    Some(match version {
        Some(version) => format!("{base} {version}"),
        None => base,
    })
}

pub(super) fn provider_item(
    source: RemoteWallpaperSource,
    candidate: ProviderCandidate,
    probe: RemoteImageProbe,
) -> WallpaperGalleryItem {
    wallpaper_remote_media::register_media_source(source, &probe.final_url, &candidate.source_url);
    let thumb_url = candidate
        .thumbnail_url
        .clone()
        .unwrap_or_else(|| probe.final_url.clone());
    wallpaper_remote_media::register_media_source(source, &thumb_url, &candidate.source_url);
    let mut digest = Sha256::new();
    digest.update(source.as_str().as_bytes());
    digest.update(candidate.upstream_id.as_bytes());
    digest.update(probe.content_fingerprint.as_bytes());
    let identity = hex::encode(digest.finalize());
    WallpaperGalleryItem {
        metadata: None,
        id: format!("{}-{}", source.as_str(), &identity[..24]),
        thumb_url,
        full_url: probe.final_url,
        kind: "image".into(),
        width: probe.width,
        height: probe.height,
        source: source.as_str().into(),
        username: None,
        post_url: None,
        text_preview: candidate.title,
        likes: None,
        local_path: None,
        prompt: None,
        provenance: WallpaperProvenance {
            source_url: Some(candidate.source_url),
            source_name: Some(candidate.source_name.into()),
            author_name: Some(candidate.author_name),
            author_url: candidate.author_url,
            license: Some(candidate.license),
            license_url: Some(candidate.license_url),
        },
        status_id: None,
        media_index: None,
        media_quality: None,
        media_fingerprint: Some(probe.content_fingerprint),
    }
}

fn opaque_id(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
