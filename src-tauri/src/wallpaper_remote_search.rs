//! Shared runtime contract for independent Web and licensed-library searches.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::wallpaper_source::{WallpaperGalleryItem, WallpaperSearchCancellation};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum RemoteWallpaperSource {
    Web,
    Openverse,
    Pexels,
}

impl RemoteWallpaperSource {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "web" => Ok(Self::Web),
            "openverse" => Ok(Self::Openverse),
            "pexels" => Ok(Self::Pexels),
            _ => Err("invalid_remote_source".into()),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Openverse => "openverse",
            Self::Pexels => "pexels",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSearchResult {
    pub(crate) source: String,
    pub(crate) items: Vec<WallpaperGalleryItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message: Option<String>,
    pub(crate) has_more: bool,
    pub(crate) cache_hit: bool,
    pub(crate) duration_ms: u64,
}

impl RemoteSearchResult {
    pub(crate) fn success(
        source: &str,
        items: Vec<WallpaperGalleryItem>,
        has_more: bool,
        duration_ms: u64,
    ) -> Self {
        Self {
            source: source.into(),
            items,
            error_code: None,
            message: None,
            has_more,
            cache_hit: false,
            duration_ms,
        }
    }

    pub(crate) fn error(source: &str, code: &str, duration_ms: u64) -> Self {
        Self {
            source: source.into(),
            items: Vec::new(),
            error_code: Some(code.into()),
            message: None,
            has_more: false,
            cache_hit: false,
            duration_ms,
        }
    }

    pub(crate) fn empty(source: &str, has_more: bool, duration_ms: u64) -> Self {
        let mut result = Self::error(source, "empty", duration_ms);
        result.has_more = has_more;
        result
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RemoteSearchStage {
    Preparing,
    SearchingWeb,
    SearchingProvider,
    FetchingSources,
    ValidatingImages,
    LoadingMore,
    Done,
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteSearchBatch {
    pub(crate) batch_index: usize,
    pub(crate) items: Vec<WallpaperGalleryItem>,
    pub(crate) accumulated_count: usize,
    pub(crate) done: bool,
}

#[derive(Clone)]
pub(crate) struct RemoteSearchRuntime {
    cancellation: WallpaperSearchCancellation,
    progress: Arc<dyn Fn(RemoteSearchStage) + Send + Sync>,
    batch: Arc<dyn Fn(RemoteSearchBatch) + Send + Sync>,
}

impl RemoteSearchRuntime {
    pub(crate) fn new(
        cancellation: WallpaperSearchCancellation,
        progress: Arc<dyn Fn(RemoteSearchStage) + Send + Sync>,
        batch: Arc<dyn Fn(RemoteSearchBatch) + Send + Sync>,
    ) -> Self {
        Self {
            cancellation,
            progress,
            batch,
        }
    }

    pub(crate) fn cancellation(&self) -> &WallpaperSearchCancellation {
        &self.cancellation
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub(crate) fn report(&self, stage: RemoteSearchStage) {
        if !self.is_cancelled() || stage == RemoteSearchStage::Done {
            (self.progress)(stage);
        }
    }

    pub(crate) fn report_batch(&self, batch: RemoteSearchBatch) {
        if !self.is_cancelled() {
            (self.batch)(batch);
        }
    }
}

/// Linearize a synchronous cache lookup with cancellation. A cancellation
/// that wins the shared gate prevents both the lookup's LRU mutation and use
/// of its value; a lookup that wins has completed before cancellation.
pub(crate) fn read_cache_if_active<T>(
    cancellation: &WallpaperSearchCancellation,
    read: impl FnOnce() -> T,
) -> Result<T, ()> {
    cancellation.commit_if_active(read).ok_or(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    request_id: &'a str,
    source: &'a str,
    stage: RemoteSearchStage,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchEvent<'a> {
    request_id: &'a str,
    source: &'a str,
    batch_index: usize,
    items: &'a [WallpaperGalleryItem],
    accumulated_count: usize,
    done: bool,
}

pub(crate) fn runtime(
    app: &AppHandle,
    request_id: &str,
    source: RemoteWallpaperSource,
    cancellation: WallpaperSearchCancellation,
) -> RemoteSearchRuntime {
    let progress_app = app.clone();
    let progress_request_id = request_id.to_string();
    let batch_app = app.clone();
    let batch_request_id = request_id.to_string();
    let source_name = source.as_str();
    RemoteSearchRuntime::new(
        cancellation,
        Arc::new(move |stage| {
            let _ = progress_app.emit(
                "wallpaper://remote-search-progress",
                ProgressEvent {
                    request_id: &progress_request_id,
                    source: source_name,
                    stage,
                },
            );
        }),
        Arc::new(move |batch| {
            let _ = batch_app.emit(
                "wallpaper://remote-search-batch",
                BatchEvent {
                    request_id: &batch_request_id,
                    source: source_name,
                    batch_index: batch.batch_index,
                    items: &batch.items,
                    accumulated_count: batch.accumulated_count,
                    done: batch.done,
                },
            );
        }),
    )
}

pub(crate) fn normalized_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(crate) fn validate_query(query: &str) -> Result<String, String> {
    let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = query.chars().count();
    if count == 0 {
        return Err("empty".into());
    }
    if count > 240 {
        return Err("query_too_long".into());
    }
    Ok(query)
}

pub(crate) fn request_id(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("").trim();
    if value.is_empty() {
        return Ok(uuid::Uuid::new_v4().to_string());
    }
    if value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.:".contains(character))
    {
        return Err("invalid_request_id".into());
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_are_bounded_and_secret_free() {
        assert_eq!(request_id(Some("web-123")).unwrap(), "web-123");
        assert!(request_id(Some("bad request")).is_err());
        assert!(request_id(Some(&"x".repeat(129))).is_err());
        assert!(!request_id(None).unwrap().is_empty());
    }

    #[test]
    fn remote_sources_are_strictly_enumerated() {
        assert_eq!(
            RemoteWallpaperSource::parse("openverse").unwrap(),
            RemoteWallpaperSource::Openverse
        );
        assert!(RemoteWallpaperSource::parse("x").is_err());
        assert!(RemoteWallpaperSource::parse("https://example.test").is_err());
    }

    #[test]
    fn queries_are_normalized_and_bounded() {
        assert_eq!(validate_query("  Misty   Lake  ").unwrap(), "Misty Lake");
        assert_eq!(normalized_query("  Misty   Lake  "), "misty lake");
        assert!(validate_query("   ").is_err());
        assert!(validate_query(&"x".repeat(241)).is_err());
    }

    #[test]
    fn cache_read_is_skipped_when_already_cancelled() {
        let cancellation = WallpaperSearchCancellation::default();
        cancellation.cancel();
        let mut read = false;

        let result = read_cache_if_active(&cancellation, || {
            read = true;
            42
        });

        assert_eq!(result, Err(()));
        assert!(!read);
    }

    #[test]
    fn cache_read_is_linearized_before_a_later_cancellation() {
        let cancellation = WallpaperSearchCancellation::default();

        let result = read_cache_if_active(&cancellation, || 42);

        assert_eq!(result, Ok(42));
        cancellation.cancel();
        assert!(cancellation.is_cancelled());
    }
}
