//! Request ownership, progress and cancellation for CLI wallpaper searches.
use crate::account::BuildOauthCredentialRevision;
use crate::wallpaper_source::{
    self, WallpaperSearchCancellation, WallpaperSearchResult, WallpaperXSearchRuntime,
    WallpaperXSearchStage,
};
use crate::wallpaper_source::{WallpaperCliSearchOutcome, WallpaperSearchMeta};
use crate::wallpaper_x_responses::{
    ResponsesSearchError, ResponsesSearchErrorKind, ResponsesSearchSuccess,
};
use crate::{account, store, wallpaper_x_responses};
use std::future::Future;
const CIRCUIT_FAILURE_THRESHOLD: u8 = 3;
const CIRCUIT_OPEN_DURATION: Duration = Duration::from_secs(10 * 60);
const CIRCUIT_OPEN_REASON: &str = "responses_circuit_open";
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 64;
pub(crate) const WALLPAPER_X_SEARCH_PROGRESS_EVENT: &str = "wallpaper://x-search-progress";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperXSearchProgress {
    request_id: String,
    stage: WallpaperXSearchStage,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperXSearchBatchEvent {
    request_id: String,
    batch_index: usize,
    items: Vec<wallpaper_source::WallpaperGalleryItem>,
    accumulated_count: usize,
    done: bool,
}

const WALLPAPER_X_SEARCH_BATCH_EVENT: &str = "wallpaper://x-search-batch";

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, WallpaperSearchCancellation>,
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

fn active_requests() -> &'static Mutex<RequestRegistry> {
    static REQUESTS: OnceLock<Mutex<RequestRegistry>> = OnceLock::new();
    REQUESTS.get_or_init(|| Mutex::new(RequestRegistry::default()))
}

struct ActiveRequestGuard {
    request_id: String,
    cancellation: WallpaperSearchCancellation,
}

impl Drop for ActiveRequestGuard {
    fn drop(&mut self) {
        self.cancellation.cancel();
        active_requests().lock().active.remove(&self.request_id);
    }
}

fn register_request(request_id: &str) -> Result<ActiveRequestGuard, String> {
    let cancellation = WallpaperSearchCancellation::default();
    let mut requests = active_requests().lock();
    if requests.active.contains_key(request_id) {
        return Err("wallpaper_request_in_use".into());
    }
    if requests.take_pre_cancel(request_id, Instant::now()) {
        cancellation.cancel();
    }
    requests
        .active
        .insert(request_id.to_string(), cancellation.clone());
    Ok(ActiveRequestGuard {
        request_id: request_id.to_string(),
        cancellation,
    })
}

pub(crate) fn request_id(raw: Option<&str>) -> Result<String, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(uuid::Uuid::new_v4().to_string());
    };
    uuid::Uuid::parse_str(raw)
        .map(|id| id.to_string())
        .map_err(|_| "invalid_wallpaper_request_id".to_string())
}

pub(crate) fn cancel(request_id: &str) -> bool {
    let mut requests = active_requests().lock();
    let cancellation = requests.active.get(request_id).cloned();
    if let Some(cancellation) = cancellation {
        drop(requests);
        cancellation.cancel();
        true
    } else {
        // IPC can deliver cancel just before the async search command reaches
        // registration. Keep a short, bounded tombstone so close/switch still
        // prevents that request from starting network or CLI work.
        requests.record_pre_cancel(request_id, Instant::now());
        true
    }
}

pub(crate) async fn search(
    app: &tauri::AppHandle,
    request_id: &str,
    query: &str,
    sort: Option<&str>,
) -> Result<WallpaperSearchResult, String> {
    let request = register_request(request_id)?;
    let event_app = app.clone();
    let event_request_id = request_id.to_string();
    let batch_app = app.clone();
    let batch_request_id = request_id.to_string();
    let runtime = WallpaperXSearchRuntime::new(
        request.cancellation.clone(),
        Arc::new(move |stage| {
            let _ = event_app.emit(
                WALLPAPER_X_SEARCH_PROGRESS_EVENT,
                WallpaperXSearchProgress {
                    request_id: event_request_id.clone(),
                    stage,
                },
            );
        }),
        Arc::new(move |batch| {
            let _ = batch_app.emit(
                WALLPAPER_X_SEARCH_BATCH_EVENT,
                WallpaperXSearchBatchEvent {
                    request_id: batch_request_id.clone(),
                    batch_index: batch.batch_index,
                    items: batch.items,
                    accumulated_count: batch.accumulated_count,
                    done: batch.done,
                },
            );
        }),
    );
    runtime.report(WallpaperXSearchStage::Preparing);
    let settings = store::load_settings();
    let mode = store::normalize_wallpaper_x_search_mode(&settings.wallpaper_x_search_mode);
    let mut result = route_with_providers(
        mode,
        account::build_oauth_credential_revision(),
        responses_circuit(),
        &runtime,
        || wallpaper_x_responses::search(query, sort, &runtime),
        || wallpaper_source::x_search_cli_outcome(query, sort, Some(&runtime)),
    )
    .await;
    if let Some(meta) = result.meta.as_mut() {
        meta.request_id = Some(request_id.to_string());
    }
    runtime.report(WallpaperXSearchStage::Done);
    Ok(result)
}

#[derive(Default)]
struct ResponsesCircuitBreaker {
    credential_revision: Option<BuildOauthCredentialRevision>,
    consecutive_failures: u8,
    open_until: Option<Instant>,
}

impl ResponsesCircuitBreaker {
    fn reset_for_revision(&mut self, revision: Option<BuildOauthCredentialRevision>) {
        if self.credential_revision == revision {
            return;
        }
        self.credential_revision = revision;
        self.consecutive_failures = 0;
        self.open_until = None;
    }

    fn allows_attempt(
        &mut self,
        revision: Option<BuildOauthCredentialRevision>,
        now: Instant,
    ) -> bool {
        self.reset_for_revision(revision);
        match self.open_until {
            Some(until) if now < until => false,
            Some(_) => {
                self.open_until = None;
                self.consecutive_failures = 0;
                true
            }
            None => true,
        }
    }

    fn record_success(&mut self, revision: BuildOauthCredentialRevision) {
        self.credential_revision = Some(revision);
        self.consecutive_failures = 0;
        self.open_until = None;
    }

    fn record_failure(
        &mut self,
        kind: ResponsesSearchErrorKind,
        revision: Option<BuildOauthCredentialRevision>,
        now: Instant,
    ) {
        self.reset_for_revision(revision);
        if kind == ResponsesSearchErrorKind::BadRequest {
            self.consecutive_failures = CIRCUIT_FAILURE_THRESHOLD;
            self.open_until = Some(now + CIRCUIT_OPEN_DURATION);
            return;
        }
        if !counts_toward_circuit(kind) {
            return;
        }
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD {
            self.open_until = Some(now + CIRCUIT_OPEN_DURATION);
        }
    }
}

fn responses_circuit() -> &'static Mutex<ResponsesCircuitBreaker> {
    static CIRCUIT: OnceLock<Mutex<ResponsesCircuitBreaker>> = OnceLock::new();
    CIRCUIT.get_or_init(|| Mutex::new(ResponsesCircuitBreaker::default()))
}

fn counts_toward_circuit(kind: ResponsesSearchErrorKind) -> bool {
    matches!(
        kind,
        ResponsesSearchErrorKind::ServerError
            | ResponsesSearchErrorKind::Timeout
            | ResponsesSearchErrorKind::Tls
            | ResponsesSearchErrorKind::Network
            | ResponsesSearchErrorKind::Empty
            | ResponsesSearchErrorKind::InvalidJson
            | ResponsesSearchErrorKind::ToolNotCalled
            | ResponsesSearchErrorKind::Protocol
            | ResponsesSearchErrorKind::SearchBudgetExceeded
    )
}

fn should_fallback(kind: ResponsesSearchErrorKind) -> bool {
    !matches!(
        kind,
        ResponsesSearchErrorKind::RateLimited
            | ResponsesSearchErrorKind::SearchBudgetExceeded
            | ResponsesSearchErrorKind::Cancelled
    )
}

async fn route_with_providers<R, RFut, C, CFut>(
    requested_mode: &str,
    credential_revision: Option<BuildOauthCredentialRevision>,
    circuit: &Mutex<ResponsesCircuitBreaker>,
    runtime: &WallpaperXSearchRuntime,
    responses: R,
    cli: C,
) -> WallpaperSearchResult
where
    R: FnOnce() -> RFut,
    RFut: Future<Output = Result<ResponsesSearchSuccess, ResponsesSearchError>>,
    C: FnOnce() -> CFut,
    CFut: Future<Output = WallpaperCliSearchOutcome>,
{
    let started = Instant::now();
    let requested_mode = store::normalize_wallpaper_x_search_mode(requested_mode);
    if runtime.is_cancelled() {
        return cancelled_result(requested_mode, "cli", started);
    }

    // `auto` stays protocol-reserved until QA explicitly enables it. Both it
    // and the public default execute the established CLI route.
    if requested_mode != store::WALLPAPER_X_SEARCH_MODE_RESPONSES_PREVIEW {
        runtime.report(WallpaperXSearchStage::SearchingX);
        return finish_cli(cli().await, requested_mode, None, started);
    }

    if !circuit
        .lock()
        .allows_attempt(credential_revision.clone(), Instant::now())
    {
        runtime.report(WallpaperXSearchStage::FallingBack);
        return finish_cli(
            cli().await,
            requested_mode,
            Some(CIRCUIT_OPEN_REASON),
            started,
        );
    }

    runtime.report(WallpaperXSearchStage::SearchingX);
    match responses().await {
        Ok(result) if !result.items.is_empty() && result.valid_count > 0 => {
            if runtime.is_cancelled() {
                return cancelled_result(requested_mode, "responses", started);
            }
            circuit
                .lock()
                .record_success(result.credential_revision.clone());
            WallpaperSearchResult {
                items: result.items,
                error_code: None,
                message: None,
                meta: Some(WallpaperSearchMeta {
                    request_id: None,
                    requested_mode: requested_mode.into(),
                    route_used: "responses".into(),
                    fallback_reason: None,
                    duration_ms: elapsed_ms(started),
                    cache_hit: false,
                    search_calls: Some(result.search_calls),
                    candidate_count: result.candidate_count,
                    valid_count: result.valid_count,
                    model: Some(result.model.into()),
                    effort: Some(result.effort.into()),
                }),
            }
        }
        Ok(result) => {
            if runtime.is_cancelled() {
                return cancelled_result(requested_mode, "responses", started);
            }
            circuit.lock().record_failure(
                ResponsesSearchErrorKind::Empty,
                Some(result.credential_revision),
                Instant::now(),
            );
            runtime.report(WallpaperXSearchStage::FallingBack);
            if runtime.is_cancelled() {
                return cancelled_result(requested_mode, "responses", started);
            }
            finish_cli(
                cli().await,
                requested_mode,
                Some(ResponsesSearchErrorKind::Empty.code()),
                started,
            )
        }
        Err(error) if error.kind == ResponsesSearchErrorKind::Cancelled => {
            cancelled_result(requested_mode, "responses", started)
        }
        Err(error) if !should_fallback(error.kind) => {
            if counts_toward_circuit(error.kind) {
                circuit.lock().record_failure(
                    error.kind,
                    error.credential_revision.clone().or(credential_revision),
                    Instant::now(),
                );
            }
            WallpaperSearchResult {
                items: Vec::new(),
                error_code: Some(error.code().into()),
                message: None,
                meta: Some(WallpaperSearchMeta {
                    request_id: None,
                    requested_mode: requested_mode.into(),
                    route_used: "responses".into(),
                    fallback_reason: None,
                    duration_ms: elapsed_ms(started),
                    cache_hit: false,
                    search_calls: None,
                    candidate_count: 0,
                    valid_count: 0,
                    model: Some(wallpaper_x_responses::RESPONSES_MODEL.into()),
                    effort: Some(wallpaper_x_responses::RESPONSES_EFFORT.into()),
                }),
            }
        }
        Err(error) => {
            circuit.lock().record_failure(
                error.kind,
                error.credential_revision.clone().or(credential_revision),
                Instant::now(),
            );
            runtime.report(WallpaperXSearchStage::FallingBack);
            if runtime.is_cancelled() {
                return cancelled_result(requested_mode, "responses", started);
            }
            finish_cli(cli().await, requested_mode, Some(error.code()), started)
        }
    }
}

fn finish_cli(
    mut outcome: WallpaperCliSearchOutcome,
    requested_mode: &str,
    fallback_reason: Option<&str>,
    started: Instant,
) -> WallpaperSearchResult {
    outcome.result.meta = Some(WallpaperSearchMeta {
        request_id: None,
        requested_mode: requested_mode.into(),
        route_used: "cli".into(),
        fallback_reason: fallback_reason.map(str::to_string),
        duration_ms: elapsed_ms(started),
        cache_hit: false,
        // Grok Build does not currently expose a reliable hosted X call count
        // or selected official model through this headless result contract.
        search_calls: None,
        candidate_count: outcome.candidate_count,
        valid_count: outcome.valid_count,
        model: None,
        effort: Some("low".into()),
    });
    outcome.result
}

fn cancelled_result(
    requested_mode: &str,
    route_used: &str,
    started: Instant,
) -> WallpaperSearchResult {
    WallpaperSearchResult {
        items: Vec::new(),
        error_code: Some("cancelled".into()),
        message: None,
        meta: Some(WallpaperSearchMeta {
            request_id: None,
            requested_mode: store::normalize_wallpaper_x_search_mode(requested_mode).into(),
            route_used: route_used.into(),
            fallback_reason: None,
            duration_ms: elapsed_ms(started),
            cache_hit: false,
            search_calls: None,
            candidate_count: 0,
            valid_count: 0,
            model: (route_used == "responses")
                .then(|| wallpaper_x_responses::RESPONSES_MODEL.into()),
            effort: Some("low".into()),
        }),
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cli_outcome() -> WallpaperCliSearchOutcome {
        WallpaperCliSearchOutcome {
            result: WallpaperSearchResult {
                items: vec![],
                error_code: Some("empty".into()),
                message: None,
                meta: None,
            },
            candidate_count: 0,
            valid_count: 0,
        }
    }

    #[tokio::test]
    async fn default_and_unknown_mode_do_not_call_responses() {
        for mode in ["cli", "", "auto", "unknown"] {
            let runtime = WallpaperXSearchRuntime::quiet();
            let result = route_with_providers(
                mode,
                None,
                &Mutex::new(ResponsesCircuitBreaker::default()),
                &runtime,
                || async { panic!("default must not request Responses") },
                || async { cli_outcome() },
            )
            .await;
            assert_eq!(result.meta.unwrap().route_used, "cli");
        }
    }

    #[tokio::test]
    async fn rate_limits_and_budget_failures_never_trigger_cli() {
        for kind in [
            ResponsesSearchErrorKind::RateLimited,
            ResponsesSearchErrorKind::SearchBudgetExceeded,
        ] {
            let runtime = WallpaperXSearchRuntime::quiet();
            let result = route_with_providers(
                "responses_preview",
                None,
                &Mutex::new(ResponsesCircuitBreaker::default()),
                &runtime,
                || async {
                    Err(ResponsesSearchError {
                        kind,
                        credential_revision: None,
                        observed_search_calls: None,
                    })
                },
                || async { panic!("must not double-request after limit") },
            )
            .await;
            assert_eq!(result.error_code.as_deref(), Some(kind.code()));
            assert_eq!(result.meta.unwrap().route_used, "responses");
        }
    }

    #[tokio::test]
    async fn network_failure_falls_back_once_and_reports_reason() {
        let runtime = WallpaperXSearchRuntime::quiet();
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let result = route_with_providers(
            "responses_preview",
            None,
            &Mutex::new(ResponsesCircuitBreaker::default()),
            &runtime,
            || async {
                Err(ResponsesSearchError {
                    kind: ResponsesSearchErrorKind::Network,
                    credential_revision: None,
                    observed_search_calls: None,
                })
            },
            || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                cli_outcome()
            },
        )
        .await;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(
            result.meta.unwrap().fallback_reason.as_deref(),
            Some("responses_network")
        );
    }

    #[test]
    fn credential_content_change_resets_circuit_even_with_same_metadata() {
        let first = BuildOauthCredentialRevision::for_test(10, Some(1), 1);
        let second = BuildOauthCredentialRevision::for_test(10, Some(1), 2);
        let now = Instant::now();
        let mut circuit = ResponsesCircuitBreaker::default();
        for _ in 0..3 {
            circuit.record_failure(ResponsesSearchErrorKind::Network, Some(first.clone()), now);
        }
        assert!(!circuit.allows_attempt(Some(first), now));
        assert!(circuit.allows_attempt(Some(second), now));
    }
    #[test]
    fn request_ids_are_validated_and_canonicalized() {
        assert!(request_id(Some("invalid")).is_err());
        let id = uuid::Uuid::new_v4();
        assert_eq!(
            request_id(Some(&id.to_string().to_uppercase())).unwrap(),
            id.to_string()
        );
        assert!(uuid::Uuid::parse_str(&request_id(None).unwrap()).is_ok());
    }
    #[test]
    fn cancel_before_register_and_guard_cleanup() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(cancel(&id));
        let request = register_request(&id).unwrap();
        assert!(request.cancellation.is_cancelled());
        assert!(register_request(&id).is_err());
        drop(request);
        assert!(!active_requests().lock().active.contains_key(&id));
        let request = register_request(&id).unwrap();
        assert!(!request.cancellation.is_cancelled());
        assert!(cancel(&id));
        assert!(request.cancellation.is_cancelled());
    }
    #[test]
    fn pre_cancel_is_bounded_and_expires() {
        let mut registry = RequestRegistry::default();
        let now = Instant::now();
        for index in 0..PRE_CANCEL_CAPACITY + 2 {
            registry.record_pre_cancel(&index.to_string(), now);
        }
        assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
        assert!(!registry.take_pre_cancel("0", now));
        assert!(registry.take_pre_cancel("2", now));
        assert!(!registry.take_pre_cancel("3", now + PRE_CANCEL_TTL));
        assert!(registry.pre_cancelled.is_empty());
    }
}
