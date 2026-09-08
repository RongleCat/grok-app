//! Independent Responses `web_search` discovery with safe page parsing.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::account;
use crate::skin_net::{self, OriginPolicy};
use crate::wallpaper_remote_media::{self, RemoteImageProbe};
use crate::wallpaper_remote_search::{
    self as remote_search, RemoteSearchBatch, RemoteSearchResult, RemoteSearchRuntime,
    RemoteSearchStage, RemoteWallpaperSource,
};
use crate::wallpaper_responses_client::{self, ClientError, ErrorKind, ResponsesClient};
use crate::wallpaper_source::{
    WallpaperGalleryItem, WallpaperProvenance, WallpaperSearchCancellation,
};
use crate::wallpaper_web_page::{parse_web_page, WebPageMetadata};
use futures_util::stream::{FuturesUnordered, StreamExt};
use parking_lot::Mutex;
#[cfg(test)]
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const SOURCE: &str = "web";
const LANE_COUNT: usize = 3;
const MAX_RESULTS: usize = 20;
const LOW_YIELD_WARNING_THRESHOLD: usize = 2;
const MAX_IMAGES_PER_SOURCE_PAGE: usize = 2;
const SAME_SHAPE_ASPECT_TOLERANCE: f64 = 0.05;
const MAX_PROBES_PER_SOURCE_PAGE: usize = 6;
const MAX_CONCURRENT_IMAGE_PROBES: usize = 12;
const MAX_PAGE_BYTES: u64 = 1_500_000;
const SOURCE_IMAGE_PROBE_BUDGET: Duration = Duration::from_secs(10);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(75);
const SOURCE_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(30);
const MIN_SOURCE_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(20);
const LANE_RESULT_TIMEOUT: Duration = Duration::from_secs(55);
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_CAPACITY: usize = 32;
const CACHE_CONTRACT_VERSION: u8 = 2;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 64;

mod quality;
mod request;
#[cfg(test)]
use quality::media_variant_identity;
use quality::{merge_items, new_items};
use request::{
    lane_budget, parse_source_pages, responses_request, select_error, source_page_exclusions,
    validate_web_search_tool_calls,
};
#[cfg(test)]
use request::{
    responses_prompt, INITIAL_MAX_WEB_SEARCH_CALLS, INITIAL_PAGES_PER_LANE,
    LOAD_MORE_MAX_WEB_SEARCH_CALLS, LOAD_MORE_PAGES_PER_LANE, MAX_SOURCE_EXCLUSIONS,
    MAX_SOURCE_EXCLUSION_CHARS, OBSERVED_TOOL_CALL_MULTIPLIER,
};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct CacheKey {
    query: String,
    credential_revision: account::BuildOauthCredentialRevision,
    contract_version: u8,
}

#[derive(Clone)]
struct CacheEntry {
    key: CacheKey,
    inserted: Instant,
    result: RemoteSearchResult,
    continuation: Vec<WallpaperGalleryItem>,
}

#[derive(Default)]
struct SearchCache {
    entries: VecDeque<CacheEntry>,
}

impl SearchCache {
    fn purge_expired(&mut self, now: Instant) {
        self.entries
            .retain(|entry| now.duration_since(entry.inserted) <= CACHE_TTL);
    }

    fn get_initial(&mut self, key: &CacheKey, now: Instant) -> Option<RemoteSearchResult> {
        self.purge_expired(now);
        let index = self.entries.iter().position(|entry| &entry.key == key)?;
        let mut entry = self.entries.remove(index)?;
        let result = entry.result.clone();
        entry.continuation = result.items.clone();
        self.entries.push_front(entry);
        Some(result)
    }

    fn continuation(&mut self, key: &CacheKey, now: Instant) -> Option<Vec<WallpaperGalleryItem>> {
        self.purge_expired(now);
        let index = self.entries.iter().position(|entry| &entry.key == key)?;
        let entry = self.entries.remove(index)?;
        let continuation = (!entry.continuation.is_empty()).then(|| entry.continuation.clone());
        self.entries.push_front(entry);
        continuation
    }

    fn update_continuation(
        &mut self,
        key: &CacheKey,
        items: Vec<WallpaperGalleryItem>,
        has_more: bool,
        now: Instant,
    ) {
        self.purge_expired(now);
        let Some(index) = self.entries.iter().position(|entry| &entry.key == key) else {
            return;
        };
        let Some(mut entry) = self.entries.remove(index) else {
            return;
        };
        entry.inserted = now;
        entry.continuation = if has_more { items } else { Vec::new() };
        self.entries.push_front(entry);
    }

    fn insert(&mut self, key: CacheKey, result: RemoteSearchResult, now: Instant) {
        self.purge_expired(now);
        self.entries.retain(|entry| entry.key != key);
        let continuation = result.items.clone();
        self.entries.push_front(CacheEntry {
            key,
            inserted: now,
            result,
            continuation,
        });
        self.entries.truncate(CACHE_CAPACITY);
    }
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

#[derive(Clone, Debug)]
struct SourcePage {
    url: String,
    title: Option<String>,
    summary: Option<String>,
}

struct LaneSearchResult {
    items: Vec<WallpaperGalleryItem>,
    tool_calls: u32,
    tool_call_breakdown: wallpaper_responses_client::ToolCallBreakdown,
    responses_elapsed_ms: u64,
    source_discovery_budget_ms: u64,
    source_pages: usize,
    page_fetch_ok: usize,
    page_parse_ok: usize,
    image_candidates: usize,
    probe_attempts: usize,
    probe_failed: usize,
    probe_failures: ProbeFailureStats,
    quality_rejected: usize,
    source_discovery_timed_out: bool,
}

#[derive(Clone, Copy, Debug, Default)]
struct ProbeFailureStats {
    blocked: usize,
    timeout: usize,
    forbidden: usize,
    not_found: usize,
    rate_limited: usize,
    http_client: usize,
    http_server: usize,
    network: usize,
    invalid_image: usize,
    too_large: usize,
    redirect: usize,
}

impl ProbeFailureStats {
    fn record(&mut self, failure: wallpaper_remote_media::RemoteImageProbeFailure) {
        use wallpaper_remote_media::RemoteImageProbeFailure as Failure;
        match failure {
            Failure::Cancelled => {}
            Failure::Blocked => self.blocked += 1,
            Failure::Timeout => self.timeout += 1,
            Failure::Forbidden => self.forbidden += 1,
            Failure::NotFound => self.not_found += 1,
            Failure::RateLimited => self.rate_limited += 1,
            Failure::HttpClient => self.http_client += 1,
            Failure::HttpServer => self.http_server += 1,
            Failure::Network => self.network += 1,
            Failure::InvalidImage => self.invalid_image += 1,
            Failure::TooLarge => self.too_large += 1,
            Failure::Redirect => self.redirect += 1,
        }
    }

    fn add(&mut self, other: Self) {
        self.blocked += other.blocked;
        self.timeout += other.timeout;
        self.forbidden += other.forbidden;
        self.not_found += other.not_found;
        self.rate_limited += other.rate_limited;
        self.http_client += other.http_client;
        self.http_server += other.http_server;
        self.network += other.network;
        self.invalid_image += other.invalid_image;
        self.too_large += other.too_large;
        self.redirect += other.redirect;
    }
}

#[derive(Default)]
struct PageDiscoveryStats {
    page_fetch_ok: usize,
    page_parse_ok: usize,
    image_candidates: usize,
    probe_attempts: usize,
    probe_failed: usize,
    probe_failures: ProbeFailureStats,
    quality_rejected: usize,
}

impl PageDiscoveryStats {
    fn add(&mut self, other: Self) {
        self.page_fetch_ok += other.page_fetch_ok;
        self.page_parse_ok += other.page_parse_ok;
        self.image_candidates += other.image_candidates;
        self.probe_attempts += other.probe_attempts;
        self.probe_failed += other.probe_failed;
        self.probe_failures.add(other.probe_failures);
        self.quality_rejected += other.quality_rejected;
    }
}

struct PageDiscoveryResult {
    items: Vec<WallpaperGalleryItem>,
    stats: PageDiscoveryStats,
}

static ACTIVE: std::sync::OnceLock<Mutex<RequestRegistry>> = std::sync::OnceLock::new();
static CACHE: std::sync::OnceLock<Mutex<SearchCache>> = std::sync::OnceLock::new();

fn active() -> &'static Mutex<RequestRegistry> {
    ACTIVE.get_or_init(|| Mutex::new(RequestRegistry::default()))
}

fn cache() -> &'static Mutex<SearchCache> {
    CACHE.get_or_init(|| Mutex::new(SearchCache::default()))
}

fn begin_request(request_id: &str) -> (uuid::Uuid, WallpaperSearchCancellation) {
    let cancellation = WallpaperSearchCancellation::default();
    let token = uuid::Uuid::new_v4();
    let mut requests = active().lock();
    for request in requests.active.values() {
        request.cancellation.cancel();
    }
    requests.active.clear();
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

fn cache_key(query: &str) -> Option<CacheKey> {
    let revision = account::build_oauth_credential_revision()?;
    Some(CacheKey {
        query: remote_search::normalized_query(query),
        credential_revision: revision,
        contract_version: CACHE_CONTRACT_VERSION,
    })
}

pub(crate) async fn search(
    app: &AppHandle,
    request_id: &str,
    query: &str,
) -> Result<RemoteSearchResult, String> {
    let query = remote_search::validate_query(query)?;
    let started = Instant::now();
    let initial_cache_key = cache_key(&query);
    let (token, cancellation) = begin_request(request_id);
    let runtime = remote_search::runtime(app, request_id, RemoteWallpaperSource::Web, cancellation);
    runtime.report(RemoteSearchStage::Preparing);

    if let Some(key) = initial_cache_key.as_ref() {
        if runtime.is_cancelled() {
            finish_request(request_id, token);
            return Ok(RemoteSearchResult::error(
                SOURCE,
                "cancelled",
                elapsed_ms(started),
            ));
        }
        let cached = match remote_search::read_cache_if_active(runtime.cancellation(), || {
            cache().lock().get_initial(key, Instant::now())
        }) {
            Ok(cached) => cached,
            Err(()) => {
                finish_request(request_id, token);
                return Ok(RemoteSearchResult::error(
                    SOURCE,
                    "cancelled",
                    elapsed_ms(started),
                ));
            }
        };
        if let Some(mut result) = cached {
            result.cache_hit = true;
            result.duration_ms = elapsed_ms(started);
            runtime.report(RemoteSearchStage::Done);
            finish_request(request_id, token);
            return Ok(result);
        }
    }

    let result = search_fresh(&query, &[], &runtime, false).await;
    let mut result = match result {
        Ok(items) if !items.is_empty() => {
            RemoteSearchResult::success(SOURCE, items, true, elapsed_ms(started))
        }
        Ok(_) => RemoteSearchResult::error(SOURCE, "empty", elapsed_ms(started)),
        Err(error) => RemoteSearchResult::error(SOURCE, error.code(), elapsed_ms(started)),
    };
    if !result.items.is_empty() {
        if let Some(key) = initial_cache_key {
            if runtime
                .cancellation()
                .commit_if_active(|| cache().lock().insert(key, result.clone(), Instant::now()))
                .is_none()
            {
                result = RemoteSearchResult::error(SOURCE, "cancelled", elapsed_ms(started));
            }
        } else if runtime.is_cancelled() {
            result = RemoteSearchResult::error(SOURCE, "cancelled", elapsed_ms(started));
        }
    } else if runtime.is_cancelled() {
        result = RemoteSearchResult::error(SOURCE, "cancelled", elapsed_ms(started));
    }
    runtime.report(RemoteSearchStage::Done);
    finish_request(request_id, token);
    Ok(result)
}

pub(crate) async fn search_more(
    app: &AppHandle,
    request_id: &str,
    query: &str,
) -> Result<RemoteSearchResult, String> {
    let query = remote_search::validate_query(query)?;
    let started = Instant::now();
    let Some(key) = cache_key(&query) else {
        return Ok(RemoteSearchResult::error(
            SOURCE,
            "oauth_unavailable",
            elapsed_ms(started),
        ));
    };
    let (token, cancellation) = begin_request(request_id);
    let runtime = remote_search::runtime(app, request_id, RemoteWallpaperSource::Web, cancellation);
    runtime.report(RemoteSearchStage::LoadingMore);
    if runtime.is_cancelled() {
        finish_request(request_id, token);
        return Ok(RemoteSearchResult::error(
            SOURCE,
            "cancelled",
            elapsed_ms(started),
        ));
    }
    let existing = match remote_search::read_cache_if_active(runtime.cancellation(), || {
        cache().lock().continuation(&key, Instant::now())
    }) {
        Ok(existing) => existing.unwrap_or_default(),
        Err(()) => {
            finish_request(request_id, token);
            return Ok(RemoteSearchResult::error(
                SOURCE,
                "cancelled",
                elapsed_ms(started),
            ));
        }
    };
    if existing.is_empty() {
        finish_request(request_id, token);
        return Ok(RemoteSearchResult::error(
            SOURCE,
            "web_search_no_continuation",
            elapsed_ms(started),
        ));
    }
    let exclusions = source_page_exclusions(
        existing
            .iter()
            .filter_map(|item| item.provenance.source_url.as_deref()),
    );
    let result = search_fresh(&query, &exclusions, &runtime, true).await;
    let mut continuation_update = None;
    let mut result = match result {
        Ok(items) => {
            let remaining = (MAX_RESULTS * 2).saturating_sub(existing.len());
            let mut fresh = new_items(&existing, items);
            fresh.truncate(remaining);
            if fresh.is_empty() {
                RemoteSearchResult::error(SOURCE, "empty", elapsed_ms(started))
            } else {
                let merged = merge_items(existing, fresh.clone(), MAX_RESULTS * 2);
                let has_more = merged.len() < MAX_RESULTS * 2;
                continuation_update = Some((merged, has_more));
                RemoteSearchResult::success(SOURCE, fresh, has_more, elapsed_ms(started))
            }
        }
        Err(error) => RemoteSearchResult::error(SOURCE, error.code(), elapsed_ms(started)),
    };
    if let Some((items, has_more)) = continuation_update {
        if runtime
            .cancellation()
            .commit_if_active(|| {
                cache()
                    .lock()
                    .update_continuation(&key, items, has_more, Instant::now());
            })
            .is_none()
        {
            result = RemoteSearchResult::error(SOURCE, "cancelled", elapsed_ms(started));
        }
    } else if runtime.is_cancelled() {
        result = RemoteSearchResult::error(SOURCE, "cancelled", elapsed_ms(started));
    }
    runtime.report(RemoteSearchStage::Done);
    finish_request(request_id, token);
    Ok(result)
}

async fn search_fresh(
    query: &str,
    exclusions: &[String],
    runtime: &RemoteSearchRuntime,
    load_more: bool,
) -> Result<Vec<WallpaperGalleryItem>, ClientError> {
    if runtime.is_cancelled() {
        return Err(ClientError::new(ErrorKind::Cancelled, None));
    }
    runtime.report(if load_more {
        RemoteSearchStage::LoadingMore
    } else {
        RemoteSearchStage::SearchingWeb
    });
    let client = Arc::new(ResponsesClient::new(RESPONSE_TIMEOUT)?);
    let image_prober = Arc::new(wallpaper_remote_media::RemoteImageProber::new());
    let image_probe_limit = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_IMAGE_PROBES));
    let lane_indexes: Vec<usize> = if load_more {
        vec![LANE_COUNT + 1]
    } else {
        (1..=LANE_COUNT).collect()
    };
    let requested_lanes = lane_indexes.len();
    let mut lanes = FuturesUnordered::new();
    for lane_index in lane_indexes {
        let lane_client = Arc::clone(&client);
        let lane_image_prober = Arc::clone(&image_prober);
        let lane_image_probe_limit = Arc::clone(&image_probe_limit);
        lanes.push(async move {
            let started = Instant::now();
            let result = search_lane(
                query,
                exclusions,
                lane_index,
                lane_client.as_ref(),
                lane_image_prober,
                lane_image_probe_limit,
                runtime,
            )
            .await;
            log_lane_result(lane_index, started, &result);
            (lane_index, result)
        });
    }

    let mut succeeded_lanes = 0usize;
    let mut accumulated = Vec::new();
    let mut errors = Vec::new();
    while let Some((lane_index, result)) = tokio::select! {
        biased;
        _ = runtime.cancellation().cancelled() => {
            return Err(ClientError::new(
                ErrorKind::Cancelled,
                Some(client.credential_revision().clone()),
            ));
        }
        result = lanes.next() => result,
    } {
        let done = lanes.is_empty();
        match result {
            Ok(lane) => {
                succeeded_lanes += 1;
                let before = accumulated.clone();
                accumulated = merge_items(accumulated, lane.items, MAX_RESULTS);
                let fresh = new_items(&before, accumulated.clone());
                runtime.report_batch(RemoteSearchBatch {
                    batch_index: lane_index,
                    items: fresh,
                    accumulated_count: accumulated.len(),
                    done,
                });
            }
            Err(error) if error.kind == ErrorKind::Cancelled => return Err(error),
            Err(error) => {
                errors.push(error);
                if done {
                    runtime.report_batch(RemoteSearchBatch {
                        batch_index: lane_index,
                        items: Vec::new(),
                        accumulated_count: accumulated.len(),
                        done: true,
                    });
                }
            }
        }
    }
    if accumulated.is_empty() {
        return Err(select_error(errors, client.credential_revision().clone()));
    }
    if succeeded_lanes < requested_lanes || accumulated.len() <= LOW_YIELD_WARNING_THRESHOLD {
        tracing::warn!(
            source = SOURCE,
            load_more,
            lanes_requested = requested_lanes,
            lanes_succeeded = succeeded_lanes,
            lanes_failed = errors.len(),
            result_count = accumulated.len(),
            "wallpaper remote search completed with partial lane coverage"
        );
    }
    Ok(accumulated)
}

async fn search_lane(
    query: &str,
    exclusions: &[String],
    lane_index: usize,
    client: &ResponsesClient,
    image_prober: Arc<wallpaper_remote_media::RemoteImageProber>,
    image_probe_limit: Arc<tokio::sync::Semaphore>,
    runtime: &RemoteSearchRuntime,
) -> Result<LaneSearchResult, ClientError> {
    let lane_started = Instant::now();
    let budget = lane_budget(lane_index);
    let payload = tokio::time::timeout(
        LANE_RESULT_TIMEOUT,
        client.post_json(
            responses_request(query, exclusions, lane_index),
            runtime.cancellation(),
        ),
    )
    .await
    .map_err(|_| {
        ClientError::new(
            ErrorKind::Timeout,
            Some(client.credential_revision().clone()),
        )
    })??;
    let output = wallpaper_responses_client::output_items(&payload)
        .map_err(|kind| ClientError::new(kind, Some(client.credential_revision().clone())))?;
    let tool_breakdown = wallpaper_responses_client::tool_call_breakdown(output, "web_search");
    let tool_calls = validate_web_search_tool_calls(output, budget.max_observed_tool_calls)
        .map_err(|(kind, observed)| {
            ClientError::new(kind, Some(client.credential_revision().clone()))
                .with_observed_tool_calls(observed)
                .with_tool_call_breakdown(tool_breakdown)
        })?;
    if tool_calls > budget.requested_tool_calls {
        tracing::warn!(
            source = SOURCE,
            lane = lane_index,
            requested_tool_calls = budget.requested_tool_calls,
            observed_tool_calls = tool_calls,
            "wallpaper remote search response exceeded its requested tool budget"
        );
    }
    let structured = wallpaper_responses_client::output_json(output)
        .map_err(|kind| ClientError::new(kind, Some(client.credential_revision().clone())))?;
    let pages = parse_source_pages(&structured, budget.pages);
    if pages.is_empty() {
        return Err(ClientError::new(
            ErrorKind::Empty,
            Some(client.credential_revision().clone()),
        ));
    }

    let source_pages = pages.len();
    let responses_elapsed = lane_started.elapsed();
    runtime.report(RemoteSearchStage::FetchingSources);
    let mut discoveries = FuturesUnordered::new();
    for page in pages {
        discoveries.push(discover_page(
            page,
            Arc::clone(&image_prober),
            Arc::clone(&image_probe_limit),
            runtime,
        ));
    }
    runtime.report(RemoteSearchStage::ValidatingImages);
    let mut items = Vec::new();
    let mut stats = PageDiscoveryStats::default();
    let mut source_discovery_timed_out = false;
    let validation_budget = source_discovery_budget(responses_elapsed);
    let source_discovery_deadline = tokio::time::sleep(validation_budget);
    tokio::pin!(source_discovery_deadline);
    while !discoveries.is_empty() {
        let discovery = tokio::select! {
            biased;
            _ = runtime.cancellation().cancelled() => {
                return Err(ClientError::new(
                    ErrorKind::Cancelled,
                    Some(client.credential_revision().clone()),
                ));
            }
            _ = &mut source_discovery_deadline => {
                source_discovery_timed_out = true;
                break;
            }
            item = discoveries.next() => item,
        };
        let Some(discovery) = discovery else {
            break;
        };
        stats.add(discovery.stats);
        items.extend(discovery.items);
    }
    Ok(LaneSearchResult {
        items: merge_items(Vec::new(), items, budget.pages),
        tool_calls,
        tool_call_breakdown: tool_breakdown,
        responses_elapsed_ms: duration_ms(responses_elapsed),
        source_discovery_budget_ms: duration_ms(validation_budget),
        source_pages,
        page_fetch_ok: stats.page_fetch_ok,
        page_parse_ok: stats.page_parse_ok,
        image_candidates: stats.image_candidates,
        probe_attempts: stats.probe_attempts,
        probe_failed: stats.probe_failed,
        probe_failures: stats.probe_failures,
        quality_rejected: stats.quality_rejected,
        source_discovery_timed_out,
    })
}

fn log_lane_result(
    lane_index: usize,
    started: Instant,
    result: &Result<LaneSearchResult, ClientError>,
) {
    match result {
        Ok(result) if result.items.len() <= LOW_YIELD_WARNING_THRESHOLD => {
            let error_code = if result.items.is_empty() {
                "empty"
            } else {
                "low_yield"
            };
            tracing::warn!(
                source = SOURCE,
                lane = lane_index,
                error_code,
                elapsed_ms = elapsed_ms(started),
                tool_calls = result.tool_calls,
                tool_call_items = result.tool_call_breakdown.total,
                web_search_call_items = result.tool_call_breakdown.primary_call_items,
                server_tool_use_items = result.tool_call_breakdown.server_tool_use_items,
                other_tool_call_items = result.tool_call_breakdown.other_call_items,
                distinct_tool_call_ids = result.tool_call_breakdown.distinct_call_ids,
                duplicate_tool_call_ids = result.tool_call_breakdown.duplicate_call_ids,
                missing_tool_call_ids = result.tool_call_breakdown.missing_call_ids,
                responses_elapsed_ms = result.responses_elapsed_ms,
                source_discovery_budget_ms = result.source_discovery_budget_ms,
                source_pages = result.source_pages,
                page_fetch_ok = result.page_fetch_ok,
                page_parse_ok = result.page_parse_ok,
                image_candidates = result.image_candidates,
                probe_attempts = result.probe_attempts,
                probe_failed = result.probe_failed,
                probe_blocked = result.probe_failures.blocked,
                probe_timeout = result.probe_failures.timeout,
                probe_forbidden = result.probe_failures.forbidden,
                probe_not_found = result.probe_failures.not_found,
                probe_rate_limited = result.probe_failures.rate_limited,
                probe_http_client = result.probe_failures.http_client,
                probe_http_server = result.probe_failures.http_server,
                probe_network = result.probe_failures.network,
                probe_invalid_image = result.probe_failures.invalid_image,
                probe_too_large = result.probe_failures.too_large,
                probe_redirect = result.probe_failures.redirect,
                quality_rejected = result.quality_rejected,
                source_discovery_timed_out = result.source_discovery_timed_out,
                result_count = result.items.len(),
                "wallpaper remote search lane completed with low image yield"
            );
        }
        Ok(result) => tracing::info!(
            source = SOURCE,
            lane = lane_index,
            error_code = "none",
            elapsed_ms = elapsed_ms(started),
            tool_calls = result.tool_calls,
            tool_call_items = result.tool_call_breakdown.total,
            web_search_call_items = result.tool_call_breakdown.primary_call_items,
            server_tool_use_items = result.tool_call_breakdown.server_tool_use_items,
            other_tool_call_items = result.tool_call_breakdown.other_call_items,
            distinct_tool_call_ids = result.tool_call_breakdown.distinct_call_ids,
            duplicate_tool_call_ids = result.tool_call_breakdown.duplicate_call_ids,
            missing_tool_call_ids = result.tool_call_breakdown.missing_call_ids,
            responses_elapsed_ms = result.responses_elapsed_ms,
            source_discovery_budget_ms = result.source_discovery_budget_ms,
            source_pages = result.source_pages,
            page_fetch_ok = result.page_fetch_ok,
            page_parse_ok = result.page_parse_ok,
            image_candidates = result.image_candidates,
            probe_attempts = result.probe_attempts,
            probe_failed = result.probe_failed,
            probe_blocked = result.probe_failures.blocked,
            probe_timeout = result.probe_failures.timeout,
            probe_forbidden = result.probe_failures.forbidden,
            probe_not_found = result.probe_failures.not_found,
            probe_rate_limited = result.probe_failures.rate_limited,
            probe_http_client = result.probe_failures.http_client,
            probe_http_server = result.probe_failures.http_server,
            probe_network = result.probe_failures.network,
            probe_invalid_image = result.probe_failures.invalid_image,
            probe_too_large = result.probe_failures.too_large,
            probe_redirect = result.probe_failures.redirect,
            quality_rejected = result.quality_rejected,
            source_discovery_timed_out = result.source_discovery_timed_out,
            result_count = result.items.len(),
            "wallpaper remote search lane completed"
        ),
        Err(error) => {
            let breakdown = error.tool_call_breakdown.unwrap_or_default();
            tracing::warn!(
                source = SOURCE,
                lane = lane_index,
                error_code = error.code(),
                elapsed_ms = elapsed_ms(started),
                tool_calls = error.observed_tool_calls.unwrap_or_default(),
                tool_call_items = breakdown.total,
                web_search_call_items = breakdown.primary_call_items,
                server_tool_use_items = breakdown.server_tool_use_items,
                other_tool_call_items = breakdown.other_call_items,
                distinct_tool_call_ids = breakdown.distinct_call_ids,
                duplicate_tool_call_ids = breakdown.duplicate_call_ids,
                missing_tool_call_ids = breakdown.missing_call_ids,
                result_count = 0,
                "wallpaper remote search lane failed"
            )
        }
    }
}

fn source_discovery_budget(responses_elapsed: Duration) -> Duration {
    let remaining = LANE_RESULT_TIMEOUT
        .checked_sub(responses_elapsed)
        .unwrap_or(Duration::ZERO);
    SOURCE_DISCOVERY_TIMEOUT.min(remaining.max(MIN_SOURCE_DISCOVERY_TIMEOUT))
}

async fn discover_page(
    page: SourcePage,
    image_prober: Arc<wallpaper_remote_media::RemoteImageProber>,
    image_probe_limit: Arc<tokio::sync::Semaphore>,
    runtime: &RemoteSearchRuntime,
) -> PageDiscoveryResult {
    let mut stats = PageDiscoveryStats::default();
    let fetch = skin_net::safe_https_get_browser_document_response(
        &page.url,
        OriginPolicy::AnyHttps,
        MAX_PAGE_BYTES,
    );
    let response = tokio::select! {
        biased;
        _ = runtime.cancellation().cancelled() => return PageDiscoveryResult { items: Vec::new(), stats },
        response = fetch => match response {
            Ok(response) => response,
            Err(_) => return PageDiscoveryResult { items: Vec::new(), stats },
        },
    };
    stats.page_fetch_ok = 1;
    let referer_origin = wallpaper_remote_media::origin_referer(&response.final_url);
    let metadata = match parse_web_page(
        &response.final_url,
        response.content_type.as_deref(),
        &response.bytes,
    ) {
        Ok(metadata) => metadata,
        Err(_) => {
            return PageDiscoveryResult {
                items: Vec::new(),
                stats,
            }
        }
    };
    stats.page_parse_ok = 1;
    stats.image_candidates = metadata.image_urls.len();
    let mut probes = FuturesUnordered::new();
    for (candidate_index, image_url) in metadata
        .image_urls
        .iter()
        .take(MAX_PROBES_PER_SOURCE_PAGE)
        .enumerate()
    {
        let prober = Arc::clone(&image_prober);
        let limit = Arc::clone(&image_probe_limit);
        let referer_origin = referer_origin.clone();
        probes.push(async move {
            let permit = tokio::select! {
                biased;
                _ = runtime.cancellation().cancelled() => Err("cancelled".to_string()),
                permit = limit.acquire_owned() => {
                    permit.map_err(|_| "cancelled".to_string())
                }
            };
            let result = match permit {
                Ok(permit) => {
                    let result = prober
                        .probe_image(image_url, referer_origin.as_deref(), runtime.cancellation())
                        .await;
                    drop(permit);
                    result
                }
                Err(_) => Err(wallpaper_remote_media::RemoteImageProbeFailure::Cancelled),
            };
            (candidate_index, result)
        });
    }
    let mut accepted = Vec::new();
    let collect = async {
        while let Some((candidate_index, result)) = probes.next().await {
            stats.probe_attempts += 1;
            let probe = match result {
                Ok(probe) => probe,
                Err(wallpaper_remote_media::RemoteImageProbeFailure::Cancelled)
                    if runtime.is_cancelled() =>
                {
                    return;
                }
                Err(failure) => {
                    stats.probe_failed += 1;
                    stats.probe_failures.record(failure);
                    continue;
                }
            };
            if !wallpaper_remote_media::is_wallpaper_quality_candidate(&probe) {
                stats.quality_rejected += 1;
                continue;
            }
            accepted.push((candidate_index, probe));
            if accepted.len() == MAX_IMAGES_PER_SOURCE_PAGE {
                return;
            }
        }
    };
    tokio::select! {
        biased;
        _ = runtime.cancellation().cancelled() => {
            return PageDiscoveryResult { items: Vec::new(), stats };
        }
        _ = tokio::time::timeout(SOURCE_IMAGE_PROBE_BUDGET, collect) => {}
    }
    accepted.sort_by_key(|(candidate_index, _)| *candidate_index);
    let items = accepted
        .into_iter()
        .map(|(_, probe)| web_item(&page, &metadata, probe))
        .collect();
    PageDiscoveryResult { items, stats }
}
fn web_item(
    page: &SourcePage,
    metadata: &WebPageMetadata,
    probe: RemoteImageProbe,
) -> WallpaperGalleryItem {
    wallpaper_remote_media::register_media_source(
        RemoteWallpaperSource::Web,
        &probe.final_url,
        &metadata.source_url,
    );
    let content_fingerprint = probe.content_fingerprint;
    let title = metadata.title.clone().or_else(|| page.title.clone());
    let text_preview = title
        .or_else(|| metadata.description.clone())
        .or_else(|| page.summary.clone());
    WallpaperGalleryItem {
        metadata: None,
        id: format!("web-{}", &content_fingerprint[..24]),
        thumb_url: probe.final_url.clone(),
        full_url: probe.final_url,
        kind: "image".into(),
        width: probe.width,
        height: probe.height,
        source: SOURCE.into(),
        username: None,
        post_url: None,
        text_preview,
        likes: None,
        local_path: None,
        prompt: None,
        provenance: WallpaperProvenance {
            source_url: Some(metadata.source_url.clone()),
            source_name: Some(metadata.source_name.clone()),
            author_name: metadata.author_name.clone(),
            author_url: None,
            license: None,
            license_url: None,
        },
        status_id: None,
        media_index: None,
        media_quality: None,
        media_fingerprint: Some(content_fingerprint),
    }
}

#[cfg(test)]
fn opaque_id(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests;
