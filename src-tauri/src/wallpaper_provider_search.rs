//! Fixed-endpoint Openverse and Pexels wallpaper-library adapters.
//!
//! Provider credentials, paging cursors, raw responses, and query strings stay
//! inside the Host. Only validated image DTOs cross IPC.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use futures_util::stream::{FuturesUnordered, StreamExt};
use hyper::header::HeaderValue;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::wallpaper_remote_search::{
    self as remote_search, RemoteSearchBatch, RemoteSearchResult, RemoteSearchRuntime,
    RemoteSearchStage, RemoteWallpaperSource,
};
use crate::wallpaper_source::{WallpaperGalleryItem, WallpaperSearchCancellation};

mod probe;
mod request_url;
mod response;
mod transport;

use probe::validate_candidates;
#[cfg(test)]
use probe::{validate_probe_outputs, visit_probes_as_completed};
#[cfg(test)]
use request_url::{provider_request_url, provider_url, PEXELS_CACHE_BUST_PARAM};
#[cfg(test)]
use response::{parse_openverse_page, parse_pexels_page, safe_url};
use transport::{fetch_api_page, provider_client};

const PEXELS_LICENSE_URL: &str = "https://www.pexels.com/license/";
const CONTRACT_VERSION: u8 = 3;
const RESULT_LIMIT: usize = 20;
const OPENVERSE_PAGE_SIZE: usize = 20;
const OPENVERSE_PAGES_PER_BATCH: usize = 2;
const PEXELS_PAGE_SIZE: usize = 40;
const MAX_CANDIDATES: usize = 40;
const MAX_CONCURRENT_PROBES: usize = 10;
const PROGRESS_BATCH_SIZE: usize = 4;
const IMAGE_PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const IMAGE_VALIDATION_BUDGET: Duration = Duration::from_secs(12);
const PROVIDER_SEARCH_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_CAPACITY: usize = 64;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 64;
const MAX_EMPTY_VALIDATED_BATCHES: usize = 3;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SearchKey {
    source: RemoteWallpaperSource,
    query: String,
    credential_revision: Option<String>,
    contract_version: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct PageKey {
    search: SearchKey,
    first_page: usize,
}

#[derive(Clone)]
struct CacheEntry {
    key: PageKey,
    inserted: Instant,
    result: RemoteSearchResult,
    continuation: Option<ProviderContinuation>,
}

#[derive(Clone)]
struct ContinuationEntry {
    key: SearchKey,
    inserted: Instant,
    continuation: ProviderContinuation,
}

#[derive(Clone)]
struct ProviderContinuation {
    next_page: usize,
    buffered_items: Vec<WallpaperGalleryItem>,
    upstream_has_more: bool,
}

impl ProviderContinuation {
    fn is_available(&self) -> bool {
        self.upstream_has_more || !self.buffered_items.is_empty()
    }
}

#[derive(Default)]
struct SearchCache {
    entries: VecDeque<CacheEntry>,
    continuations: VecDeque<ContinuationEntry>,
}

impl SearchCache {
    fn purge_expired(&mut self, now: Instant) {
        self.entries
            .retain(|entry| now.duration_since(entry.inserted) <= CACHE_TTL);
        self.continuations
            .retain(|entry| now.duration_since(entry.inserted) <= CACHE_TTL);
    }

    fn get(
        &mut self,
        key: &PageKey,
        now: Instant,
    ) -> Option<(RemoteSearchResult, Option<ProviderContinuation>)> {
        self.purge_expired(now);
        let index = self.entries.iter().position(|entry| &entry.key == key)?;
        let entry = self.entries.remove(index)?;
        let result = entry.result.clone();
        let continuation = entry.continuation.clone();
        self.entries.push_front(entry);
        Some((result, continuation))
    }

    fn insert(
        &mut self,
        key: PageKey,
        result: RemoteSearchResult,
        continuation: Option<ProviderContinuation>,
        now: Instant,
    ) {
        self.purge_expired(now);
        self.entries.retain(|entry| entry.key != key);
        self.entries.push_front(CacheEntry {
            key,
            inserted: now,
            result,
            continuation,
        });
        self.entries.truncate(CACHE_CAPACITY);
    }

    fn continuation(&mut self, key: &SearchKey, now: Instant) -> Option<ProviderContinuation> {
        self.purge_expired(now);
        let index = self
            .continuations
            .iter()
            .position(|entry| &entry.key == key)?;
        let entry = self.continuations.remove(index)?;
        let continuation = entry.continuation.clone();
        self.continuations.push_front(entry);
        Some(continuation)
    }

    fn update_continuation(
        &mut self,
        key: &SearchKey,
        continuation: Option<ProviderContinuation>,
        now: Instant,
    ) {
        self.purge_expired(now);
        self.continuations.retain(|entry| &entry.key != key);
        if let Some(continuation) = continuation.filter(ProviderContinuation::is_available) {
            self.continuations.push_front(ContinuationEntry {
                key: key.clone(),
                inserted: now,
                continuation,
            });
            self.continuations.truncate(CACHE_CAPACITY);
        }
    }
}

struct ProviderContext {
    search_key: SearchKey,
    api_key: Option<String>,
}

#[derive(Clone)]
struct ActiveRequest {
    token: uuid::Uuid,
    cancellation: WallpaperSearchCancellation,
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, ActiveRequest>,
    pre_cancelled: VecDeque<(String, Instant)>,
}

impl RequestRegistry {
    fn purge_pre_cancelled(&mut self, now: Instant) {
        self.pre_cancelled
            .retain(|(_, created)| now.duration_since(*created) < PRE_CANCEL_TTL);
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

#[derive(Clone)]
struct ProviderCandidate {
    upstream_id: String,
    image_url: String,
    source_url: String,
    source_name: &'static str,
    title: Option<String>,
    author_name: String,
    author_url: Option<String>,
    license: String,
    license_url: String,
}

struct ApiPage {
    candidates: Vec<ProviderCandidate>,
    has_more: bool,
}

struct CandidateBatch {
    candidates: Vec<ProviderCandidate>,
    has_more: bool,
    next_page: usize,
}

struct ValidatedPage {
    items: Vec<WallpaperGalleryItem>,
    buffered_items: Vec<WallpaperGalleryItem>,
    upstream_has_more: bool,
    next_page: usize,
}

#[derive(Default)]
struct ProviderPartialState {
    completed_items: Vec<(usize, WallpaperGalleryItem)>,
    next_page: usize,
    upstream_has_more: bool,
    last_emitted_batch_index: usize,
}

#[derive(Clone)]
struct ProviderPartialResults {
    state: Arc<Mutex<ProviderPartialState>>,
}

struct RecoveredProviderPage {
    page: ValidatedPage,
    terminal_batch_index: usize,
}

impl ProviderPartialResults {
    fn new(first_page: usize) -> Self {
        Self {
            state: Arc::new(Mutex::new(ProviderPartialState {
                next_page: first_page,
                ..ProviderPartialState::default()
            })),
        }
    }

    fn begin_batch(&self, next_page: usize, upstream_has_more: bool) {
        let mut state = self.state.lock();
        state.completed_items.clear();
        state.next_page = next_page;
        state.upstream_has_more = upstream_has_more;
        state.last_emitted_batch_index = 0;
    }

    fn record(&self, index: usize, item: WallpaperGalleryItem) {
        self.state.lock().completed_items.push((index, item));
    }

    fn mark_batch_emitted(&self, batch_index: usize) {
        self.state.lock().last_emitted_batch_index = batch_index;
    }

    fn recover_timeout_page(&self) -> Option<RecoveredProviderPage> {
        let state = self.state.lock();
        let mut completed_items = state.completed_items.clone();
        let next_page = state.next_page;
        let upstream_has_more = state.upstream_has_more;
        let terminal_batch_index = state.last_emitted_batch_index.saturating_add(1);
        drop(state);

        completed_items.sort_by_key(|(index, _)| *index);
        let mut seen_urls = HashSet::new();
        let mut seen_fingerprints = HashSet::new();
        let mut items = completed_items
            .into_iter()
            .filter_map(|(_, item)| {
                let fingerprint = item.media_fingerprint.clone().unwrap_or_default();
                if !seen_urls.insert(item.full_url.clone())
                    || (!fingerprint.is_empty() && !seen_fingerprints.insert(fingerprint))
                {
                    return None;
                }
                Some(item)
            })
            .collect::<Vec<_>>();
        if items.is_empty() {
            return None;
        }
        let buffered_items = if items.len() > RESULT_LIMIT {
            items.split_off(RESULT_LIMIT)
        } else {
            Vec::new()
        };
        Some(RecoveredProviderPage {
            page: ValidatedPage {
                items,
                buffered_items,
                upstream_has_more,
                next_page,
            },
            terminal_batch_index,
        })
    }
}

impl ValidatedPage {
    fn continuation(&self) -> Option<ProviderContinuation> {
        let continuation = ProviderContinuation {
            next_page: self.next_page,
            buffered_items: self.buffered_items.clone(),
            upstream_has_more: self.upstream_has_more,
        };
        continuation.is_available().then_some(continuation)
    }

    fn has_more(&self) -> bool {
        self.upstream_has_more || !self.buffered_items.is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderError {
    Cancelled,
    PexelsKeyMissing,
    PexelsKeyInvalid,
    RateLimited,
    Timeout,
    Network,
    ServiceUnavailable,
    Protocol,
}

impl ProviderError {
    fn code(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::PexelsKeyMissing => "pexels_key_missing",
            Self::PexelsKeyInvalid => "pexels_key_invalid",
            Self::RateLimited => "provider_rate_limited",
            Self::Timeout => "provider_timeout",
            Self::Network => "provider_network",
            Self::ServiceUnavailable => "provider_service_unavailable",
            Self::Protocol => "provider_protocol",
        }
    }
}

static ACTIVE: OnceLock<Mutex<RequestRegistry>> = OnceLock::new();
static CACHE: OnceLock<Mutex<SearchCache>> = OnceLock::new();

fn active() -> &'static Mutex<RequestRegistry> {
    ACTIVE.get_or_init(|| Mutex::new(RequestRegistry::default()))
}

fn cache() -> &'static Mutex<SearchCache> {
    CACHE.get_or_init(|| Mutex::new(SearchCache::default()))
}

fn begin_request(request_id: &str) -> (uuid::Uuid, WallpaperSearchCancellation) {
    let mut requests = active().lock();
    for (_, request) in requests.active.drain() {
        request.cancellation.cancel();
    }
    let token = uuid::Uuid::new_v4();
    let cancellation = WallpaperSearchCancellation::default();
    if requests.take_pre_cancel(request_id, Instant::now()) {
        cancellation.cancel();
    }
    requests.active.insert(
        request_id.to_string(),
        ActiveRequest {
            token,
            cancellation: cancellation.clone(),
        },
    );
    (token, cancellation)
}

fn finish_request(request_id: &str, token: uuid::Uuid) {
    let mut requests = active().lock();
    if requests
        .active
        .get(request_id)
        .is_some_and(|request| request.token == token)
    {
        requests.active.remove(request_id);
    }
}

pub(crate) fn cancel(request_id: &str) -> bool {
    let mut requests = active().lock();
    let request = requests.active.remove(request_id);
    if let Some(request) = request {
        drop(requests);
        request.cancellation.cancel();
    } else {
        requests.record_pre_cancel(request_id, Instant::now());
    }
    true
}

fn library_provider_query(query: &str) -> String {
    const CJK_WALLPAPER_TERMS: [&str; 4] = ["壁纸", "壁紙", "桌布", "배경화면"];

    let mut stripped = query.to_string();
    for term in CJK_WALLPAPER_TERMS {
        stripped = stripped.replace(term, " ");
    }

    let normalized = stripped
        .split_whitespace()
        .filter(|token| {
            let comparison = token
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_ascii_lowercase();
            !comparison.is_empty()
                && !matches!(
                    comparison.as_str(),
                    "wallpaper" | "wallpapers" | "4k" | "8k" | "uhd"
                )
        })
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.is_empty() {
        query.trim().to_string()
    } else {
        normalized
    }
}

fn provider_context(
    source: RemoteWallpaperSource,
    query: &str,
) -> Result<ProviderContext, ProviderError> {
    let (api_key, credential_revision) = match source {
        RemoteWallpaperSource::Openverse => (None, None),
        RemoteWallpaperSource::Pexels => {
            let key = crate::store::load_secrets()
                .pexels_api_key
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty() && value.len() <= 512)
                .ok_or(ProviderError::PexelsKeyMissing)?;
            HeaderValue::from_str(&key).map_err(|_| ProviderError::PexelsKeyInvalid)?;
            let revision = hex::encode(Sha256::digest(key.as_bytes()));
            (Some(key), Some(revision))
        }
        RemoteWallpaperSource::Web => return Err(ProviderError::Protocol),
    };
    Ok(ProviderContext {
        search_key: SearchKey {
            source,
            query: remote_search::normalized_query(query),
            credential_revision,
            contract_version: CONTRACT_VERSION,
        },
        api_key,
    })
}

pub(crate) async fn search(
    app: &AppHandle,
    source: RemoteWallpaperSource,
    request_id: &str,
    query: &str,
) -> Result<RemoteSearchResult, String> {
    let query = remote_search::validate_query(query)?;
    let provider_query = library_provider_query(&query);
    let started = Instant::now();
    let context = match provider_context(source, &query) {
        Ok(context) => context,
        Err(error) => {
            return Ok(RemoteSearchResult::error(
                source.as_str(),
                error.code(),
                elapsed_ms(started),
            ));
        }
    };
    let (token, cancellation) = begin_request(request_id);
    let runtime = remote_search::runtime(app, request_id, source, cancellation);
    runtime.report(RemoteSearchStage::Preparing);
    let page_key = PageKey {
        search: context.search_key.clone(),
        first_page: 1,
    };

    if runtime.is_cancelled() {
        finish_request(request_id, token);
        return Ok(RemoteSearchResult::error(
            source.as_str(),
            "cancelled",
            elapsed_ms(started),
        ));
    }
    let cached = match remote_search::read_cache_if_active(runtime.cancellation(), || {
        cache().lock().get(&page_key, Instant::now())
    }) {
        Ok(cached) => cached,
        Err(()) => {
            finish_request(request_id, token);
            return Ok(RemoteSearchResult::error(
                source.as_str(),
                "cancelled",
                elapsed_ms(started),
            ));
        }
    };
    if let Some((mut result, continuation)) = cached {
        result.cache_hit = true;
        result.duration_ms = elapsed_ms(started);
        if runtime
            .cancellation()
            .commit_if_active(|| {
                cache().lock().update_continuation(
                    &context.search_key,
                    continuation,
                    Instant::now(),
                );
            })
            .is_none()
        {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
            runtime.report(RemoteSearchStage::Done);
            finish_request(request_id, token);
            return Ok(result);
        }
        emit_cached_batch(&runtime, &result);
        runtime.report(RemoteSearchStage::Done);
        finish_request(request_id, token);
        return Ok(result);
    }

    let partial = ProviderPartialResults::new(1);
    let page = with_provider_deadline(
        runtime.cancellation(),
        PROVIDER_SEARCH_TIMEOUT,
        search_page(
            source,
            &provider_query,
            1,
            context.api_key.as_deref(),
            &runtime,
            &partial,
        ),
    )
    .await;
    let page = recover_provider_timeout(page, &partial, &runtime);
    let mut result = result_from_page(source, page.as_ref(), started);
    if let Ok(page) = page {
        let continuation = page.continuation();
        let committed = runtime.cancellation().commit_if_active(|| {
            let mut cache = cache().lock();
            cache.update_continuation(&context.search_key, continuation.clone(), Instant::now());
            if !page.items.is_empty() {
                cache.insert(page_key, result.clone(), continuation, Instant::now());
            }
        });
        if committed.is_none() {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
        }
    } else {
        let committed = runtime.cancellation().commit_if_active(|| {
            cache()
                .lock()
                .update_continuation(&context.search_key, None, Instant::now());
        });
        if committed.is_none() {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
        }
    }
    runtime.report(RemoteSearchStage::Done);
    finish_request(request_id, token);
    Ok(result)
}

pub(crate) async fn search_more(
    app: &AppHandle,
    source: RemoteWallpaperSource,
    request_id: &str,
    query: &str,
) -> Result<RemoteSearchResult, String> {
    let query = remote_search::validate_query(query)?;
    let provider_query = library_provider_query(&query);
    let started = Instant::now();
    let context = match provider_context(source, &query) {
        Ok(context) => context,
        Err(error) => {
            return Ok(RemoteSearchResult::error(
                source.as_str(),
                error.code(),
                elapsed_ms(started),
            ));
        }
    };
    let (token, cancellation) = begin_request(request_id);
    let runtime = remote_search::runtime(app, request_id, source, cancellation);
    runtime.report(RemoteSearchStage::LoadingMore);
    if runtime.is_cancelled() {
        finish_request(request_id, token);
        return Ok(RemoteSearchResult::error(
            source.as_str(),
            "cancelled",
            elapsed_ms(started),
        ));
    }
    let continuation = match remote_search::read_cache_if_active(runtime.cancellation(), || {
        cache()
            .lock()
            .continuation(&context.search_key, Instant::now())
    }) {
        Ok(continuation) => continuation,
        Err(()) => {
            finish_request(request_id, token);
            return Ok(RemoteSearchResult::error(
                source.as_str(),
                "cancelled",
                elapsed_ms(started),
            ));
        }
    };
    let Some(continuation) = continuation else {
        finish_request(request_id, token);
        return Ok(RemoteSearchResult::error(
            source.as_str(),
            "provider_no_continuation",
            elapsed_ms(started),
        ));
    };
    if let Some((items, next_continuation)) = take_buffered_page(continuation.clone()) {
        let mut result = RemoteSearchResult::success(
            source.as_str(),
            items,
            next_continuation.is_some(),
            elapsed_ms(started),
        );
        result.cache_hit = true;
        if runtime
            .cancellation()
            .commit_if_active(|| {
                cache().lock().update_continuation(
                    &context.search_key,
                    next_continuation,
                    Instant::now(),
                );
            })
            .is_none()
        {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
            runtime.report(RemoteSearchStage::Done);
            finish_request(request_id, token);
            return Ok(result);
        }
        emit_cached_batch(&runtime, &result);
        runtime.report(RemoteSearchStage::Done);
        finish_request(request_id, token);
        return Ok(result);
    }
    let first_page = continuation.next_page;
    let page_key = PageKey {
        search: context.search_key.clone(),
        first_page,
    };

    let cached = match remote_search::read_cache_if_active(runtime.cancellation(), || {
        cache().lock().get(&page_key, Instant::now())
    }) {
        Ok(cached) => cached,
        Err(()) => {
            finish_request(request_id, token);
            return Ok(RemoteSearchResult::error(
                source.as_str(),
                "cancelled",
                elapsed_ms(started),
            ));
        }
    };
    if let Some((mut result, continuation)) = cached {
        result.cache_hit = true;
        result.duration_ms = elapsed_ms(started);
        if runtime
            .cancellation()
            .commit_if_active(|| {
                cache().lock().update_continuation(
                    &context.search_key,
                    continuation,
                    Instant::now(),
                );
            })
            .is_none()
        {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
            runtime.report(RemoteSearchStage::Done);
            finish_request(request_id, token);
            return Ok(result);
        }
        emit_cached_batch(&runtime, &result);
        runtime.report(RemoteSearchStage::Done);
        finish_request(request_id, token);
        return Ok(result);
    }

    let partial = ProviderPartialResults::new(first_page);
    let page = with_provider_deadline(
        runtime.cancellation(),
        PROVIDER_SEARCH_TIMEOUT,
        search_page(
            source,
            &provider_query,
            first_page,
            context.api_key.as_deref(),
            &runtime,
            &partial,
        ),
    )
    .await;
    let page = recover_provider_timeout(page, &partial, &runtime);
    let mut result = result_from_page(source, page.as_ref(), started);
    if let Ok(page) = page {
        let continuation = page.continuation();
        let committed = runtime.cancellation().commit_if_active(|| {
            let mut cache = cache().lock();
            cache.update_continuation(&context.search_key, continuation.clone(), Instant::now());
            if !page.items.is_empty() {
                cache.insert(page_key, result.clone(), continuation, Instant::now());
            }
        });
        if committed.is_none() {
            result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
        }
    } else if runtime.is_cancelled() {
        result = RemoteSearchResult::error(source.as_str(), "cancelled", elapsed_ms(started));
    }
    runtime.report(RemoteSearchStage::Done);
    finish_request(request_id, token);
    Ok(result)
}

fn emit_cached_batch(runtime: &RemoteSearchRuntime, result: &RemoteSearchResult) {
    runtime.report_batch(RemoteSearchBatch {
        batch_index: 1,
        items: result.items.clone(),
        accumulated_count: result.items.len(),
        done: true,
    });
}

fn take_buffered_page(
    mut continuation: ProviderContinuation,
) -> Option<(Vec<WallpaperGalleryItem>, Option<ProviderContinuation>)> {
    if continuation.buffered_items.is_empty() {
        return None;
    }
    let remainder = if continuation.buffered_items.len() > RESULT_LIMIT {
        continuation.buffered_items.split_off(RESULT_LIMIT)
    } else {
        Vec::new()
    };
    let items = std::mem::replace(&mut continuation.buffered_items, remainder);
    let next = continuation.is_available().then_some(continuation);
    Some((items, next))
}

fn result_from_page(
    source: RemoteWallpaperSource,
    page: Result<&ValidatedPage, &ProviderError>,
    started: Instant,
) -> RemoteSearchResult {
    match page {
        Ok(page) if !page.items.is_empty() => RemoteSearchResult::success(
            source.as_str(),
            page.items.clone(),
            page.has_more(),
            elapsed_ms(started),
        ),
        Ok(page) => {
            RemoteSearchResult::empty(source.as_str(), page.has_more(), elapsed_ms(started))
        }
        Err(error) => RemoteSearchResult::error(source.as_str(), error.code(), elapsed_ms(started)),
    }
}

fn recover_provider_timeout(
    result: Result<ValidatedPage, ProviderError>,
    partial: &ProviderPartialResults,
    runtime: &RemoteSearchRuntime,
) -> Result<ValidatedPage, ProviderError> {
    if !matches!(&result, Err(ProviderError::Timeout)) {
        return result;
    }
    let Some(recovered) = partial.recover_timeout_page() else {
        return result;
    };
    runtime.report_batch(RemoteSearchBatch {
        batch_index: recovered.terminal_batch_index,
        items: Vec::new(),
        accumulated_count: recovered.page.items.len(),
        done: true,
    });
    Ok(recovered.page)
}

async fn with_provider_deadline<T, F>(
    cancellation: &WallpaperSearchCancellation,
    timeout: Duration,
    operation: F,
) -> Result<T, ProviderError>
where
    F: std::future::Future<Output = Result<T, ProviderError>>,
{
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(ProviderError::Cancelled),
        result = tokio::time::timeout(timeout, operation) => {
            result.unwrap_or(Err(ProviderError::Timeout))
        },
    }
}

async fn search_page(
    source: RemoteWallpaperSource,
    query: &str,
    first_page: usize,
    api_key: Option<&str>,
    runtime: &RemoteSearchRuntime,
    partial: &ProviderPartialResults,
) -> Result<ValidatedPage, ProviderError> {
    if runtime.is_cancelled() {
        return Err(ProviderError::Cancelled);
    }
    runtime.report(if first_page == 1 {
        RemoteSearchStage::SearchingProvider
    } else {
        RemoteSearchStage::LoadingMore
    });
    let mut page = first_page;
    for _ in 0..MAX_EMPTY_VALIDATED_BATCHES {
        let batch = fetch_candidate_batch(source, query, page, api_key, runtime).await?;
        partial.begin_batch(batch.next_page, batch.has_more);
        runtime.report(RemoteSearchStage::ValidatingImages);
        let mut items = validate_candidates(source, batch.candidates, runtime, partial).await?;
        let buffered_items = if items.len() > RESULT_LIMIT {
            items.split_off(RESULT_LIMIT)
        } else {
            Vec::new()
        };
        let validated = ValidatedPage {
            items,
            buffered_items,
            upstream_has_more: batch.has_more,
            next_page: batch.next_page,
        };
        if !validated.items.is_empty() || !validated.has_more() {
            return Ok(validated);
        }
        page = validated.next_page;
        runtime.report(RemoteSearchStage::LoadingMore);
    }
    Ok(ValidatedPage {
        items: Vec::new(),
        buffered_items: Vec::new(),
        upstream_has_more: true,
        next_page: page,
    })
}

async fn fetch_candidate_batch(
    source: RemoteWallpaperSource,
    query: &str,
    first_page: usize,
    api_key: Option<&str>,
    runtime: &RemoteSearchRuntime,
) -> Result<CandidateBatch, ProviderError> {
    let pages_per_batch = match source {
        RemoteWallpaperSource::Openverse => OPENVERSE_PAGES_PER_BATCH,
        RemoteWallpaperSource::Pexels => 1,
        RemoteWallpaperSource::Web => return Err(ProviderError::Protocol),
    };
    let client = Arc::new(provider_client());
    let mut requests = FuturesUnordered::new();
    for page in first_page..first_page + pages_per_batch {
        let client = Arc::clone(&client);
        let cancellation = runtime.cancellation().clone();
        let api_key = api_key.map(str::to_string);
        let query = query.to_string();
        requests.push(async move {
            let result = fetch_api_page(
                client.as_ref(),
                source,
                &query,
                page,
                api_key.as_deref(),
                &cancellation,
            )
            .await;
            (page, result)
        });
    }

    let mut completed = HashMap::new();
    while let Some((page, result)) = tokio::select! {
        biased;
        _ = runtime.cancellation().cancelled() => return Err(ProviderError::Cancelled),
        result = requests.next() => result,
    } {
        completed.insert(page, result);
    }

    let mut candidates = Vec::new();
    let mut has_more = false;
    let mut next_page = first_page;
    for page_number in first_page..first_page + pages_per_batch {
        let Some(result) = completed.remove(&page_number) else {
            break;
        };
        match result {
            Ok(page) => {
                candidates.extend(page.candidates);
                next_page = page_number + 1;
                has_more = page.has_more;
                if !has_more {
                    break;
                }
            }
            Err(error) if page_number == first_page => return Err(error),
            Err(_) => {
                has_more = true;
                next_page = page_number;
                break;
            }
        }
    }
    candidates.truncate(MAX_CANDIDATES);
    Ok(CandidateBatch {
        candidates,
        has_more,
        next_page,
    })
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests;
