//! Read-only wallpaper search through the Grok Build Responses compatibility
//! endpoint. This module is Host-internal until the wallpaper search router
//! explicitly opts into it.

use std::error::Error as _;
use std::time::Duration;

use reqwest::StatusCode;
use serde_json::{json, Value};

use crate::account::{
    self, BuildOauthAccessToken, BuildOauthCredentialRevision, BuildOauthTokenError,
};
use crate::proxy;
use crate::wallpaper_source::{
    filter_reachable_gallery_items_cancellable, merge_rank_x_gallery_items, parse_gallery_items,
    x_gallery_needs_supplement, x_gallery_reference_ids, WallpaperGalleryItem,
    WallpaperSearchCancellation, WallpaperXSearchRuntime, WallpaperXSearchStage,
    X_SEARCH_FIRST_ROUND_CALLS, X_SEARCH_SUPPLEMENT_CALLS, X_SEARCH_TOTAL_CALLS,
};

pub(crate) const RESPONSES_ENDPOINT: &str = "https://cli-chat-proxy.grok.com/v1/responses";
pub(crate) const RESPONSES_MODEL: &str = "grok-4.6";
pub(crate) const RESPONSES_EFFORT: &str = "low";
pub(crate) const RESPONSES_MAX_X_SEARCH_CALLS: u32 = X_SEARCH_TOTAL_CALLS;

const RESPONSES_TIMEOUT: Duration = Duration::from_secs(90);
const RESPONSES_MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResponsesSearchErrorKind {
    OauthUnavailable,
    OauthExpired,
    BadRequest,
    Unauthorized,
    RateLimited,
    ServerError,
    Timeout,
    Tls,
    Network,
    Empty,
    InvalidJson,
    Protocol,
    ToolNotCalled,
    SearchBudgetExceeded,
    Cancelled,
}

impl ResponsesSearchErrorKind {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::OauthUnavailable => "oauth_unavailable",
            Self::OauthExpired => "oauth_expired",
            Self::BadRequest => "responses_bad_request",
            Self::Unauthorized => "responses_unauthorized",
            Self::RateLimited => "responses_rate_limited",
            Self::ServerError => "responses_server_error",
            Self::Timeout => "responses_timeout",
            Self::Tls => "responses_tls",
            Self::Network => "responses_network",
            Self::Empty => "responses_empty",
            Self::InvalidJson => "responses_invalid_json",
            Self::Protocol => "responses_protocol",
            Self::ToolNotCalled => "responses_tool_not_called",
            Self::SearchBudgetExceeded => "responses_search_budget_exceeded",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResponsesSearchError {
    pub(crate) kind: ResponsesSearchErrorKind,
    pub(crate) credential_revision: Option<BuildOauthCredentialRevision>,
}

impl ResponsesSearchError {
    fn new(
        kind: ResponsesSearchErrorKind,
        credential_revision: Option<BuildOauthCredentialRevision>,
    ) -> Self {
        Self {
            kind,
            credential_revision,
        }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ResponsesSearchSuccess {
    pub(crate) items: Vec<WallpaperGalleryItem>,
    pub(crate) candidate_count: usize,
    pub(crate) valid_count: usize,
    pub(crate) search_calls: u32,
    pub(crate) model: &'static str,
    pub(crate) effort: &'static str,
    pub(crate) credential_revision: BuildOauthCredentialRevision,
}

/// Run the fixed, read-only Responses preview request.
///
/// No endpoint, model, tool, or credential is accepted from the frontend.
pub(crate) async fn search(
    query: &str,
    sort: Option<&str>,
    runtime: &WallpaperXSearchRuntime,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            None,
        ));
    }
    let auth = account::read_build_oauth_access_token().map_err(auth_error)?;
    let mut first = search_with_auth(
        query,
        sort,
        &auth,
        RESPONSES_ENDPOINT,
        RESPONSES_TIMEOUT,
        SearchOptions {
            max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
            is_supplement: false,
            seen_ids: &[],
            cancellation: runtime.cancellation(),
        },
    )
    .await?;
    let mut candidate_count = first.candidate_count;
    let mut search_calls = first.search_calls;
    let seen_ids = x_gallery_reference_ids(&first.items);
    runtime.report(WallpaperXSearchStage::Validating);
    let mut items = filter_reachable_gallery_items_cancellable(
        std::mem::take(&mut first.items),
        Some(runtime.cancellation()),
    )
    .await;
    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            Some(auth.revision.clone()),
        ));
    }

    if x_gallery_needs_supplement(items.len()) {
        runtime.report(WallpaperXSearchStage::Supplementing);
        match search_with_auth(
            query,
            sort,
            &auth,
            RESPONSES_ENDPOINT,
            RESPONSES_TIMEOUT,
            SearchOptions {
                max_search_calls: X_SEARCH_SUPPLEMENT_CALLS,
                is_supplement: true,
                seen_ids: &seen_ids,
                cancellation: runtime.cancellation(),
            },
        )
        .await
        {
            Ok(mut supplement) => {
                search_calls = search_calls.saturating_add(supplement.search_calls);
                if search_calls > RESPONSES_MAX_X_SEARCH_CALLS {
                    return Err(ResponsesSearchError::new(
                        ResponsesSearchErrorKind::SearchBudgetExceeded,
                        Some(auth.revision.clone()),
                    ));
                }
                candidate_count = candidate_count.saturating_add(supplement.candidate_count);
                runtime.report(WallpaperXSearchStage::Validating);
                let supplement_items = filter_reachable_gallery_items_cancellable(
                    std::mem::take(&mut supplement.items),
                    Some(runtime.cancellation()),
                )
                .await;
                if runtime.is_cancelled() {
                    return Err(ResponsesSearchError::new(
                        ResponsesSearchErrorKind::Cancelled,
                        Some(auth.revision.clone()),
                    ));
                }
                items.extend(supplement_items);
                items = merge_rank_x_gallery_items(items);
            }
            Err(error)
                if error.kind == ResponsesSearchErrorKind::Cancelled
                    || items.is_empty()
                    || error.kind == ResponsesSearchErrorKind::SearchBudgetExceeded =>
            {
                return Err(error);
            }
            Err(_) => {
                // A useful partial first round is better than discarding honest
                // results because the optional supplement failed.
            }
        }
    }

    if items.is_empty() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Empty,
            Some(auth.revision.clone()),
        ));
    }

    Ok(ResponsesSearchSuccess {
        valid_count: items.len(),
        items,
        candidate_count,
        search_calls,
        model: RESPONSES_MODEL,
        effort: RESPONSES_EFFORT,
        credential_revision: auth.revision.clone(),
    })
}

fn auth_error(error: BuildOauthTokenError) -> ResponsesSearchError {
    let kind = match error {
        BuildOauthTokenError::Unavailable => ResponsesSearchErrorKind::OauthUnavailable,
        BuildOauthTokenError::Expired => ResponsesSearchErrorKind::OauthExpired,
    };
    ResponsesSearchError::new(kind, None)
}

struct SearchOptions<'a> {
    max_search_calls: u32,
    is_supplement: bool,
    seen_ids: &'a [String],
    cancellation: &'a WallpaperSearchCancellation,
}

async fn search_with_auth(
    query: &str,
    sort: Option<&str>,
    auth: &BuildOauthAccessToken,
    endpoint: &str,
    timeout: Duration,
    options: SearchOptions<'_>,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    search_with_credentials(
        query,
        sort,
        Ok((auth.expose_to_build_proxy(), auth.revision.clone())),
        endpoint,
        timeout,
        options,
    )
    .await
}

async fn search_with_credentials(
    query: &str,
    sort: Option<&str>,
    credentials: Result<(&str, BuildOauthCredentialRevision), BuildOauthTokenError>,
    endpoint: &str,
    timeout: Duration,
    options: SearchOptions<'_>,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    let SearchOptions {
        max_search_calls,
        is_supplement,
        seen_ids,
        cancellation,
    } = options;
    let (token, credential_revision) = credentials.map_err(auth_error)?;
    let error_revision = || Some(credential_revision.clone());

    let client = proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout.min(Duration::from_secs(20)))
            // A Build bearer token is valid only for the fixed proxy endpoint.
            // Returning a 3xx is a protocol error; the credential is never
            // replayed to a redirect target.
            .redirect(reqwest::redirect::Policy::none()),
    )
    .build()
    .map_err(|_| ResponsesSearchError::new(ResponsesSearchErrorKind::Network, error_revision()))?;

    let request = client
        .post(endpoint)
        .bearer_auth(token)
        .header("x-grok-client-mode", "cli")
        .header("x-grok-client-identifier", "grok-shell")
        .header("x-grok-client-version", "1.0.5")
        .json(&responses_request(
            query,
            sort,
            max_search_calls,
            is_supplement,
            seen_ids,
        ))
        .send();
    let response = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            return Err(ResponsesSearchError::new(
                ResponsesSearchErrorKind::Cancelled,
                error_revision(),
            ));
        }
        response = request => response,
    }
    .map_err(|error| ResponsesSearchError::new(transport_error_kind(&error), error_revision()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(ResponsesSearchError::new(
            status_error_kind(status),
            error_revision(),
        ));
    }

    if response
        .content_length()
        .is_some_and(|length| length > RESPONSES_MAX_BODY_BYTES.try_into().unwrap_or(u64::MAX))
    {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Protocol,
            error_revision(),
        ));
    }

    let body = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            return Err(ResponsesSearchError::new(
                ResponsesSearchErrorKind::Cancelled,
                error_revision(),
            ));
        }
        body = read_bounded_body(response, error_revision()) => body?,
    };
    if body.is_empty() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Empty,
            error_revision(),
        ));
    }
    let payload: Value = serde_json::from_slice(&body).map_err(|_| {
        ResponsesSearchError::new(ResponsesSearchErrorKind::InvalidJson, error_revision())
    })?;
    let output = payload
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ResponsesSearchError::new(ResponsesSearchErrorKind::Protocol, error_revision())
        })?;
    let search_calls = count_x_search_calls(output);
    if search_calls == 0 {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::ToolNotCalled,
            error_revision(),
        ));
    }
    if search_calls > max_search_calls {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::SearchBudgetExceeded,
            error_revision(),
        ));
    }

    let gallery = gallery_from_output(output)
        .map_err(|kind| ResponsesSearchError::new(kind, error_revision()))?;
    let candidate_count = gallery
        .get("items")
        .and_then(Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| {
            ResponsesSearchError::new(ResponsesSearchErrorKind::Protocol, error_revision())
        })?;
    let items = parse_gallery_items(&gallery, "x");
    let valid_count = items.len();

    Ok(ResponsesSearchSuccess {
        items,
        candidate_count,
        valid_count,
        search_calls,
        model: RESPONSES_MODEL,
        effort: RESPONSES_EFFORT,
        credential_revision,
    })
}

fn responses_request(
    query: &str,
    sort: Option<&str>,
    max_search_calls: u32,
    is_supplement: bool,
    seen_ids: &[String],
) -> Value {
    json!({
        "model": RESPONSES_MODEL,
        "input": responses_prompt(query, sort, max_search_calls, is_supplement, seen_ids),
        "tools": [{ "type": "x_search" }],
        "tool_choice": "auto",
        "max_tool_calls": max_search_calls,
        "reasoning": {
            "effort": RESPONSES_EFFORT,
            "summary": "concise"
        },
        "text": {
            "format": {
                "type": "json_schema",
                "name": "wallpaper_gallery",
                "strict": true,
                "schema": gallery_schema()
            }
        },
        "store": false
    })
}

fn responses_prompt(
    query: &str,
    sort: Option<&str>,
    max_search_calls: u32,
    is_supplement: bool,
    seen_ids: &[String],
) -> String {
    let sort = match sort.unwrap_or("top") {
        "latest" | "Latest" => "Latest",
        _ => "Top",
    };
    let round_guidance = if is_supplement {
        format!(
            "Supplement round: use one new query with a different visual angle (alternate composition, lighting, setting, season, or medium). Exclude candidates carrying these opaque media/post ids: {}",
            if seen_ids.is_empty() {
                "none from the empty first round".to_string()
            } else {
                seen_ids.join(", ")
            }
        )
    } else {
        "First round: use complementary direct and visual/style query variants.".to_string()
    };
    format!(
        r#"You collect high-quality still images from X (Twitter) for a wallpaper picker.

User topic: {query}
Sort preference: {sort}

{round_guidance}

Use X search only. Use no more than {max_search_calls} x_search call(s) in this request. Search useful query variants with image filters. Prefer real photography or polished AI art suitable as wallpaper. Prefer posts that include both a prompt and attached images when relevant. Skip memes, screenshots, text cards, avatars, emoji packs, ads, blurry thumbnails, videos, and placeholder links.

Return 8-16 distinct items when possible. fullUrl must be a direct HTTPS full-size image CDN URL, preferably https://pbs.twimg.com/media/... with name=orig. postUrl must be a confirmed canonical https://x.com/<user>/status/<id>; omit it rather than guessing. Include mediaIndex 1-4 only when the status media position is known. Return metadata only and do not download files."#
    )
}

fn gallery_schema() -> Value {
    json!({
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
                    "required": ["fullUrl"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["items"],
        "additionalProperties": false
    })
}

async fn read_bounded_body(
    mut response: reqwest::Response,
    credential_revision: Option<BuildOauthCredentialRevision>,
) -> Result<Vec<u8>, ResponsesSearchError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        ResponsesSearchError::new(transport_error_kind(&error), credential_revision.clone())
    })? {
        if body.len().saturating_add(chunk.len()) > RESPONSES_MAX_BODY_BYTES {
            return Err(ResponsesSearchError::new(
                ResponsesSearchErrorKind::Protocol,
                credential_revision,
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn status_error_kind(status: StatusCode) -> ResponsesSearchErrorKind {
    match status.as_u16() {
        400 => ResponsesSearchErrorKind::BadRequest,
        401 | 403 => ResponsesSearchErrorKind::Unauthorized,
        429 => ResponsesSearchErrorKind::RateLimited,
        500..=599 => ResponsesSearchErrorKind::ServerError,
        _ => ResponsesSearchErrorKind::Protocol,
    }
}

fn transport_error_kind(error: &reqwest::Error) -> ResponsesSearchErrorKind {
    if error.is_timeout() {
        return ResponsesSearchErrorKind::Timeout;
    }
    let mut source = error.source();
    while let Some(cause) = source {
        let message = cause.to_string().to_ascii_lowercase();
        if message.contains("tls")
            || message.contains("certificate")
            || message.contains("cert ")
            || message.contains("handshake")
        {
            return ResponsesSearchErrorKind::Tls;
        }
        source = cause.source();
    }
    ResponsesSearchErrorKind::Network
}

fn count_x_search_calls(output: &[Value]) -> u32 {
    output
        .iter()
        .filter(|item| {
            let item_type = item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            if item.get("status").and_then(Value::as_str) != Some("completed") {
                return false;
            }
            if matches!(item_type.as_str(), "x_search_call" | "x_search_tool_call") {
                return true;
            }
            // The fixed request registers only x_search. Build compatibility
            // responses can represent that call as an unnamed custom call,
            // but accept only the exact completed call item, never result or
            // arbitrary custom_tool-prefixed shapes.
            if item_type == "custom_tool_call" {
                return true;
            }
            matches!(
                item_type.as_str(),
                "server_tool_use" | "server_tool_call" | "tool_use" | "tool_call"
            ) && ["name", "tool_name", "tool"]
                .iter()
                .filter_map(|field| item.get(field).and_then(Value::as_str))
                .any(|name| name.eq_ignore_ascii_case("x_search"))
        })
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

fn gallery_from_output(output: &[Value]) -> Result<Value, ResponsesSearchErrorKind> {
    let mut saw_invalid_json = false;
    for item in output.iter().rev() {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in content.iter().rev() {
            if part.get("type").and_then(Value::as_str) != Some("output_text") {
                continue;
            }
            let Some(text) = part.get("text").and_then(Value::as_str) else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(text) {
                Ok(value) if value.get("items").and_then(Value::as_array).is_some() => {
                    return Ok(value);
                }
                Ok(_) => return Err(ResponsesSearchErrorKind::Protocol),
                Err(_) => saw_invalid_json = true,
            }
        }
    }
    if saw_invalid_json {
        Err(ResponsesSearchErrorKind::InvalidJson)
    } else {
        Err(ResponsesSearchErrorKind::Empty)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use axum::body::{Body, Bytes};
    use axum::extract::State;
    use axum::http::{HeaderMap, HeaderValue};
    use axum::response::{IntoResponse, Response};
    use axum::routing::post;
    use axum::Router;
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    use super::*;

    #[derive(Clone)]
    struct MockState {
        status: StatusCode,
        response_body: Arc<String>,
        delay: Duration,
        requests: Arc<AtomicUsize>,
        authorization_ok: Arc<AtomicBool>,
        request_body: Arc<Mutex<Option<Value>>>,
    }

    async fn mock_responses(
        State(state): State<MockState>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        state.requests.fetch_add(1, Ordering::SeqCst);
        state.authorization_ok.store(
            headers
                .get(reqwest::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                == Some("Bearer test-token"),
            Ordering::SeqCst,
        );
        if let Ok(value) = serde_json::from_slice::<Value>(&body) {
            *state.request_body.lock().expect("request body lock") = Some(value);
        }
        if !state.delay.is_zero() {
            tokio::time::sleep(state.delay).await;
        }
        (state.status, state.response_body.as_str().to_string()).into_response()
    }

    async fn spawn_mock(
        status: StatusCode,
        body: impl Into<String>,
        delay: Duration,
    ) -> (String, MockState, JoinHandle<()>) {
        let state = MockState {
            status,
            response_body: Arc::new(body.into()),
            delay,
            requests: Arc::new(AtomicUsize::new(0)),
            authorization_ok: Arc::new(AtomicBool::new(false)),
            request_body: Arc::new(Mutex::new(None)),
        };
        let app = Router::new()
            .route("/v1/responses", post(mock_responses))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
        let address = listener.local_addr().expect("mock address");
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://{address}/v1/responses"), state, task)
    }

    fn test_revision() -> BuildOauthCredentialRevision {
        BuildOauthCredentialRevision::for_test(123, Some(456), 1)
    }

    fn success_payload(search_calls: usize) -> String {
        let mut output = Vec::new();
        for _ in 0..search_calls {
            output.push(json!({ "type": "x_search_call", "status": "completed" }));
        }
        output.push(json!({
            "type": "message",
            "content": [{
                "type": "output_text",
                "text": serde_json::to_string(&json!({
                    "items": [{
                        "fullUrl": "https://pbs.twimg.com/media/test.jpg?name=small",
                        "thumbUrl": "https://pbs.twimg.com/media/test.jpg?name=small",
                        "username": "alice",
                        "postUrl": "https://x.com/alice/status/1234567890123456789",
                        "kind": "image"
                    }]
                })).expect("gallery json")
            }]
        }));
        json!({
            "model": RESPONSES_MODEL,
            "output": output
        })
        .to_string()
    }

    async fn test_search(
        endpoint: &str,
        timeout: Duration,
    ) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
        let cancellation = WallpaperSearchCancellation::default();
        search_with_credentials(
            "misty mountains",
            Some("top"),
            Ok(("test-token", test_revision())),
            endpoint,
            timeout,
            SearchOptions {
                max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
                is_supplement: false,
                seen_ids: &[],
                cancellation: &cancellation,
            },
        )
        .await
    }

    #[tokio::test]
    async fn gallery_without_completed_x_call_is_rejected() {
        let (endpoint, _, task) =
            spawn_mock(StatusCode::OK, success_payload(0), Duration::ZERO).await;
        let result = test_search(&endpoint, Duration::from_secs(2)).await;
        task.abort();
        assert_eq!(
            result.unwrap_err().kind,
            ResponsesSearchErrorKind::ToolNotCalled
        );
        assert_eq!(
            count_x_search_calls(&[
                json!({"type": "x_search_call", "status": "in_progress"}),
                json!({"type": "custom_tool_result", "status": "completed"}),
                json!({"type": "server_tool_call", "name": "web_search", "status": "completed"}),
            ]),
            0
        );
    }

    #[tokio::test]
    async fn wallpaper_x_responses_success_parses_gallery_and_fixed_contract() {
        assert_eq!(
            count_x_search_calls(&[json!({ "type": "custom_tool_call", "status": "completed" })]),
            1
        );
        let (endpoint, state, task) =
            spawn_mock(StatusCode::OK, success_payload(2), Duration::ZERO).await;
        let result = test_search(&endpoint, Duration::from_secs(2))
            .await
            .expect("responses success");
        task.abort();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.candidate_count, 1);
        assert_eq!(result.valid_count, 1);
        assert_eq!(result.search_calls, 2);
        assert_eq!(result.model, "grok-4.6");
        assert_eq!(result.effort, "low");
        assert!(result.items[0].full_url.contains("name=orig"));
        assert_eq!(state.requests.load(Ordering::SeqCst), 1);
        assert!(state.authorization_ok.load(Ordering::SeqCst));

        let request = state
            .request_body
            .lock()
            .expect("request body lock")
            .clone()
            .expect("captured request");
        assert_eq!(request.get("model"), Some(&json!("grok-4.6")));
        assert_eq!(request.pointer("/reasoning/effort"), Some(&json!("low")));
        assert_eq!(request.get("store"), Some(&json!(false)));
        assert_eq!(request.get("max_tool_calls"), Some(&json!(2)));
        assert_eq!(request.pointer("/tools/0/type"), Some(&json!("x_search")));
        assert_eq!(
            request.pointer("/text/format/type"),
            Some(&json!("json_schema"))
        );
        assert_eq!(request.pointer("/text/format/strict"), Some(&json!(true)));
        assert_eq!(
            request.pointer("/text/format/schema/additionalProperties"),
            Some(&json!(false))
        );
        assert!(request
            .get("input")
            .and_then(Value::as_str)
            .is_some_and(|prompt| prompt.contains("no more than 2 x_search call")));
        let supplement = responses_request(
            "misty mountains",
            Some("top"),
            X_SEARCH_SUPPLEMENT_CALLS,
            true,
            &["twimg:seen-id".into(), "status:12345678".into()],
        );
        assert_eq!(supplement.get("max_tool_calls"), Some(&json!(1)));
        assert!(supplement
            .get("input")
            .and_then(Value::as_str)
            .is_some_and(|prompt| {
                prompt.contains("different visual angle")
                    && prompt.contains("twimg:seen-id")
                    && prompt.contains("no more than 1 x_search call")
            }));
        assert_eq!(RESPONSES_MAX_X_SEARCH_CALLS, 3);
    }

    #[tokio::test]
    async fn wallpaper_x_responses_classifies_http_failures() {
        for (status, expected) in [
            (
                StatusCode::BAD_REQUEST,
                ResponsesSearchErrorKind::BadRequest,
            ),
            (
                StatusCode::UNAUTHORIZED,
                ResponsesSearchErrorKind::Unauthorized,
            ),
            (
                StatusCode::FORBIDDEN,
                ResponsesSearchErrorKind::Unauthorized,
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                ResponsesSearchErrorKind::RateLimited,
            ),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                ResponsesSearchErrorKind::ServerError,
            ),
        ] {
            let (endpoint, _state, task) = spawn_mock(status, "redacted", Duration::ZERO).await;
            let error = test_search(&endpoint, Duration::from_secs(2))
                .await
                .expect_err("http status must fail");
            task.abort();
            assert_eq!(error.kind, expected);
            assert_eq!(error.code(), expected.code());
        }
    }

    #[tokio::test]
    async fn wallpaper_x_responses_classifies_timeout_invalid_json_and_empty() {
        let (endpoint, _state, task) = spawn_mock(
            StatusCode::OK,
            success_payload(1),
            Duration::from_millis(150),
        )
        .await;
        let error = test_search(&endpoint, Duration::from_millis(25))
            .await
            .expect_err("request must time out");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::Timeout);

        let (endpoint, _state, task) = spawn_mock(StatusCode::OK, "not-json", Duration::ZERO).await;
        let error = test_search(&endpoint, Duration::from_secs(2))
            .await
            .expect_err("invalid json must fail");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::InvalidJson);

        let (endpoint, _state, task) = spawn_mock(StatusCode::OK, "", Duration::ZERO).await;
        let error = test_search(&endpoint, Duration::from_secs(2))
            .await
            .expect_err("empty response must fail");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::Empty);
    }

    #[tokio::test]
    async fn wallpaper_x_responses_cancellation_aborts_inflight_http() {
        let (endpoint, state, task) =
            spawn_mock(StatusCode::OK, success_payload(1), Duration::from_secs(10)).await;
        let cancellation = WallpaperSearchCancellation::default();
        let cancellation_for_request = cancellation.clone();
        let request = tokio::spawn(async move {
            search_with_credentials(
                "misty mountains",
                Some("top"),
                Ok(("test-token", test_revision())),
                &endpoint,
                Duration::from_secs(30),
                SearchOptions {
                    max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
                    is_supplement: false,
                    seen_ids: &[],
                    cancellation: &cancellation_for_request,
                },
            )
            .await
        });

        tokio::time::timeout(Duration::from_secs(2), async {
            while state.requests.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("mock request did not start");
        cancellation.cancel();
        let error = tokio::time::timeout(Duration::from_secs(2), request)
            .await
            .expect("cancelled request did not return")
            .expect("request task panicked")
            .expect_err("cancelled request must fail");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::Cancelled);
    }

    #[tokio::test]
    async fn wallpaper_x_responses_rejects_bad_structured_output_and_tool_overrun() {
        let invalid_output = json!({
            "output": [{ "type": "x_search_call", "status": "completed" }, {
                "type": "message",
                "content": [{ "type": "output_text", "text": "not-json" }]
            }]
        })
        .to_string();
        let (endpoint, _state, task) =
            spawn_mock(StatusCode::OK, invalid_output, Duration::ZERO).await;
        let error = test_search(&endpoint, Duration::from_secs(2))
            .await
            .expect_err("bad structured output must fail");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::InvalidJson);

        let (endpoint, _state, task) =
            spawn_mock(StatusCode::OK, success_payload(4), Duration::ZERO).await;
        let error = test_search(&endpoint, Duration::from_secs(2))
            .await
            .expect_err("tool overrun must fail");
        task.abort();
        assert_eq!(error.kind, ResponsesSearchErrorKind::SearchBudgetExceeded);
    }

    #[tokio::test]
    async fn wallpaper_x_responses_oauth_failure_sends_no_request() {
        let (endpoint, state, task) =
            spawn_mock(StatusCode::OK, success_payload(1), Duration::ZERO).await;
        for (oauth_error, expected) in [
            (
                BuildOauthTokenError::Unavailable,
                ResponsesSearchErrorKind::OauthUnavailable,
            ),
            (
                BuildOauthTokenError::Expired,
                ResponsesSearchErrorKind::OauthExpired,
            ),
        ] {
            let cancellation = WallpaperSearchCancellation::default();
            let error = search_with_credentials(
                "misty mountains",
                Some("top"),
                Err(oauth_error),
                &endpoint,
                Duration::from_secs(2),
                SearchOptions {
                    max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
                    is_supplement: false,
                    seen_ids: &[],
                    cancellation: &cancellation,
                },
            )
            .await
            .expect_err("oauth failure must stop before HTTP");
            assert_eq!(error.kind, expected);
        }
        task.abort();
        assert_eq!(state.requests.load(Ordering::SeqCst), 0);
    }

    #[derive(Clone)]
    struct RedirectState {
        target: String,
        source_requests: Arc<AtomicUsize>,
        target_requests: Arc<AtomicUsize>,
        target_saw_authorization: Arc<AtomicBool>,
    }

    async fn redirect_source(State(state): State<RedirectState>) -> Response {
        state.source_requests.fetch_add(1, Ordering::SeqCst);
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::TEMPORARY_REDIRECT;
        response.headers_mut().insert(
            reqwest::header::LOCATION,
            HeaderValue::from_str(&state.target).expect("redirect target header"),
        );
        response
    }

    async fn redirect_target(State(state): State<RedirectState>, headers: HeaderMap) -> Response {
        state.target_requests.fetch_add(1, Ordering::SeqCst);
        state.target_saw_authorization.store(
            headers.contains_key(reqwest::header::AUTHORIZATION),
            Ordering::SeqCst,
        );
        (StatusCode::OK, success_payload(1)).into_response()
    }

    #[tokio::test]
    async fn wallpaper_x_responses_never_replays_authorization_across_redirect() {
        let target_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind redirect target");
        let target_address = target_listener.local_addr().expect("target address");
        let state = RedirectState {
            target: format!("http://{target_address}/target"),
            source_requests: Arc::new(AtomicUsize::new(0)),
            target_requests: Arc::new(AtomicUsize::new(0)),
            target_saw_authorization: Arc::new(AtomicBool::new(false)),
        };
        let target_app = Router::new()
            .route("/target", post(redirect_target))
            .with_state(state.clone());
        let target_task = tokio::spawn(async move {
            let _ = axum::serve(target_listener, target_app).await;
        });

        let source_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind redirect source");
        let source_address = source_listener.local_addr().expect("source address");
        let source_app = Router::new()
            .route("/v1/responses", post(redirect_source))
            .with_state(state.clone());
        let source_task = tokio::spawn(async move {
            let _ = axum::serve(source_listener, source_app).await;
        });

        let error = test_search(
            &format!("http://{source_address}/v1/responses"),
            Duration::from_secs(2),
        )
        .await
        .expect_err("redirect must be a protocol failure");
        source_task.abort();
        target_task.abort();

        assert_eq!(error.kind, ResponsesSearchErrorKind::Protocol);
        assert_eq!(state.source_requests.load(Ordering::SeqCst), 1);
        assert_eq!(state.target_requests.load(Ordering::SeqCst), 0);
        assert!(!state.target_saw_authorization.load(Ordering::SeqCst));
    }
}
