//! Read-only wallpaper search through the Grok Build Responses compatibility
//! endpoint. This module is Host-internal until the wallpaper search router
//! explicitly opts into it.

mod more;
pub(crate) use more::search_more;

use std::future::Future;
use std::time::Duration;

use futures_util::stream::{FuturesUnordered, StreamExt};
use reqwest::StatusCode;
use serde_json::{json, Value};

use crate::account::{
    self, BuildOauthAccessToken, BuildOauthCredentialRevision, BuildOauthTokenError,
};
use crate::proxy;
use crate::wallpaper_source::{
    filter_reachable_gallery_items_cancellable, merge_rank_x_gallery_items_with_limit,
    parse_gallery_items, x_gallery_new_items, WallpaperGalleryItem, WallpaperSearchCancellation,
    WallpaperXSearchBatch, WallpaperXSearchRuntime, WallpaperXSearchStage,
};

pub(crate) const RESPONSES_ENDPOINT: &str = "https://cli-chat-proxy.grok.com/v1/responses";
pub(crate) const RESPONSES_MODEL: &str = "grok-4.6";
pub(crate) const RESPONSES_EFFORT: &str = "low";
pub(crate) const RESPONSES_LANE_COUNT: usize = 3;
pub(crate) const RESPONSES_LANE_TARGET_COUNT: usize = 8;
pub(crate) const RESPONSES_LANE_MAX_X_SEARCH_CALLS: u32 = 3;

const RESPONSES_TIMEOUT: Duration = Duration::from_secs(90);
const RESPONSES_MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const RESPONSES_MAX_RESULTS: usize = RESPONSES_LANE_COUNT * RESPONSES_LANE_TARGET_COUNT;

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
    pub(crate) observed_search_calls: Option<u32>,
}

impl ResponsesSearchError {
    fn new(
        kind: ResponsesSearchErrorKind,
        credential_revision: Option<BuildOauthCredentialRevision>,
    ) -> Self {
        Self {
            kind,
            credential_revision,
            observed_search_calls: None,
        }
    }

    fn with_observed_search_calls(mut self, search_calls: u32) -> Self {
        self.observed_search_calls = Some(search_calls);
        self
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

struct ResponsesSearchRequest<'a> {
    query: &'a str,
    sort: Option<&'a str>,
    endpoint: &'a str,
    max_search_calls: u32,
    lane_index: usize,
    target_count: usize,
    excluded_ids: &'a [String],
    cancellation: &'a WallpaperSearchCancellation,
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
    let client = responses_client(RESPONSES_TIMEOUT, Some(auth.revision.clone()))?;
    run_parallel_lanes(runtime, auth.revision.clone(), |lane_index| {
        search_lane(query, sort, lane_index, &client, &auth, runtime)
    })
    .await
}

async fn search_lane(
    query: &str,
    sort: Option<&str>,
    lane_index: usize,
    client: &reqwest::Client,
    auth: &BuildOauthAccessToken,
    runtime: &WallpaperXSearchRuntime,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    let mut result = search_with_client(
        ResponsesSearchRequest {
            query,
            sort,
            endpoint: RESPONSES_ENDPOINT,
            max_search_calls: RESPONSES_LANE_MAX_X_SEARCH_CALLS,
            lane_index,
            target_count: RESPONSES_LANE_TARGET_COUNT,
            excluded_ids: &[],
            cancellation: runtime.cancellation(),
        },
        client,
        auth.expose_to_build_proxy(),
        auth.revision.clone(),
    )
    .await?;
    runtime.report(WallpaperXSearchStage::Validating);
    result.items =
        filter_reachable_gallery_items_cancellable(result.items, Some(runtime.cancellation()))
            .await;
    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            Some(auth.revision.clone()),
        ));
    }
    if result.items.is_empty() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Empty,
            Some(auth.revision.clone()),
        )
        .with_observed_search_calls(result.search_calls));
    }
    result.valid_count = result.items.len();
    Ok(result)
}

async fn run_parallel_lanes<F, Fut>(
    runtime: &WallpaperXSearchRuntime,
    credential_revision: BuildOauthCredentialRevision,
    run_lane: F,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError>
where
    F: Fn(usize) -> Fut,
    Fut: Future<Output = Result<ResponsesSearchSuccess, ResponsesSearchError>>,
{
    let mut lanes = FuturesUnordered::new();
    for lane_index in 1..=RESPONSES_LANE_COUNT {
        let lane = run_lane(lane_index);
        lanes.push(async move { (lane_index, lane.await) });
    }

    let mut items = Vec::new();
    let mut candidate_count = 0usize;
    let mut search_calls = 0u32;
    let mut errors = Vec::new();
    loop {
        let next = tokio::select! {
            biased;
            _ = runtime.cancellation().cancelled() => {
                return Err(ResponsesSearchError::new(
                    ResponsesSearchErrorKind::Cancelled,
                    Some(credential_revision.clone()),
                ));
            }
            next = lanes.next() => next,
        };
        let Some((lane_index, outcome)) = next else {
            break;
        };
        let is_last = lanes.is_empty();
        match outcome {
            Ok(lane) => {
                candidate_count = candidate_count.saturating_add(lane.candidate_count);
                search_calls = search_calls.saturating_add(lane.search_calls);
                let previous = items.clone();
                let mut combined = previous.clone();
                combined.extend(lane.items);
                items = merge_rank_x_gallery_items_with_limit(combined, RESPONSES_MAX_RESULTS);
                let batch_items = x_gallery_new_items(&previous, &items);
                runtime.report_batch(WallpaperXSearchBatch {
                    batch_index: lane_index,
                    items: batch_items,
                    accumulated_count: items.len(),
                    done: is_last,
                });
            }
            Err(error) if error.kind == ResponsesSearchErrorKind::Cancelled => {
                return Err(error);
            }
            Err(error) => {
                search_calls =
                    search_calls.saturating_add(error.observed_search_calls.unwrap_or_default());
                errors.push(error);
                if is_last {
                    runtime.report_batch(WallpaperXSearchBatch {
                        batch_index: lane_index,
                        items: Vec::new(),
                        accumulated_count: items.len(),
                        done: true,
                    });
                }
            }
        }
    }

    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            Some(credential_revision),
        ));
    }
    if items.is_empty() {
        return Err(select_parallel_error(errors, credential_revision));
    }

    Ok(ResponsesSearchSuccess {
        valid_count: items.len(),
        items,
        candidate_count,
        search_calls,
        model: RESPONSES_MODEL,
        effort: RESPONSES_EFFORT,
        credential_revision,
    })
}

fn select_parallel_error(
    errors: Vec<ResponsesSearchError>,
    credential_revision: BuildOauthCredentialRevision,
) -> ResponsesSearchError {
    errors
        .into_iter()
        .min_by_key(|error| parallel_error_priority(error.kind))
        .unwrap_or_else(|| {
            ResponsesSearchError::new(ResponsesSearchErrorKind::Empty, Some(credential_revision))
        })
}

fn parallel_error_priority(kind: ResponsesSearchErrorKind) -> u8 {
    match kind {
        ResponsesSearchErrorKind::Cancelled => 0,
        ResponsesSearchErrorKind::RateLimited => 1,
        ResponsesSearchErrorKind::SearchBudgetExceeded => 2,
        ResponsesSearchErrorKind::Unauthorized
        | ResponsesSearchErrorKind::OauthUnavailable
        | ResponsesSearchErrorKind::OauthExpired => 3,
        ResponsesSearchErrorKind::BadRequest
        | ResponsesSearchErrorKind::InvalidJson
        | ResponsesSearchErrorKind::Protocol
        | ResponsesSearchErrorKind::ToolNotCalled => 4,
        ResponsesSearchErrorKind::ServerError
        | ResponsesSearchErrorKind::Timeout
        | ResponsesSearchErrorKind::Tls
        | ResponsesSearchErrorKind::Network => 5,
        ResponsesSearchErrorKind::Empty => 6,
    }
}

fn auth_error(error: BuildOauthTokenError) -> ResponsesSearchError {
    let kind = match error {
        BuildOauthTokenError::Unavailable => ResponsesSearchErrorKind::OauthUnavailable,
        BuildOauthTokenError::Expired => ResponsesSearchErrorKind::OauthExpired,
    };
    ResponsesSearchError::new(kind, None)
}

#[cfg(test)]
async fn search_with_credentials(
    request: ResponsesSearchRequest<'_>,
    timeout: Duration,
    credentials: Result<(&str, BuildOauthCredentialRevision), BuildOauthTokenError>,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    let (token, credential_revision) = credentials.map_err(auth_error)?;
    let client = responses_client(timeout, Some(credential_revision.clone()))?;
    search_with_client(request, &client, token, credential_revision).await
}

fn responses_client(
    timeout: Duration,
    credential_revision: Option<BuildOauthCredentialRevision>,
) -> Result<reqwest::Client, ResponsesSearchError> {
    proxy::apply_to_reqwest(
        reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout.min(Duration::from_secs(20)))
            // A Build bearer token is valid only for the fixed proxy endpoint.
            // Returning a 3xx is a protocol error; the credential is never
            // replayed to a redirect target.
            .redirect(reqwest::redirect::Policy::none()),
    )
    .build()
    .map_err(|_| ResponsesSearchError::new(ResponsesSearchErrorKind::Network, credential_revision))
}

async fn search_with_client(
    request: ResponsesSearchRequest<'_>,
    client: &reqwest::Client,
    token: &str,
    credential_revision: BuildOauthCredentialRevision,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    let ResponsesSearchRequest {
        query,
        sort,
        endpoint,
        max_search_calls,
        lane_index,
        target_count,
        excluded_ids,
        cancellation,
    } = request;
    let error_revision = || Some(credential_revision.clone());

    let request = client.post(endpoint).bearer_auth(token);
    let request = request
        .header("x-grok-client-mode", "cli")
        .header("x-grok-client-identifier", "grok-shell")
        .header("x-grok-client-version", "1.0.5")
        .json(&responses_request(
            query,
            sort,
            max_search_calls,
            lane_index,
            target_count,
            excluded_ids,
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
        )
        .with_observed_search_calls(search_calls));
    }
    if search_calls > max_search_calls {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::SearchBudgetExceeded,
            error_revision(),
        )
        .with_observed_search_calls(search_calls));
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
    lane_index: usize,
    target_count: usize,
    excluded_ids: &[String],
) -> Value {
    json!({
        "model": RESPONSES_MODEL,
        "input": responses_prompt(
            query,
            sort,
            max_search_calls,
            lane_index,
            target_count,
            excluded_ids,
        ),
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
                "schema": gallery_schema(target_count)
            }
        },
        "store": false
    })
}

fn responses_prompt(
    query: &str,
    sort: Option<&str>,
    max_search_calls: u32,
    lane_index: usize,
    target_count: usize,
    excluded_ids: &[String],
) -> String {
    let sort = match sort.unwrap_or("top") {
        "latest" | "Latest" => "Latest",
        _ => "Top",
    };
    let lane_guidance = match lane_index {
        1 => "Concurrent batch 1 of 3. Primary batch: search the strongest direct interpretation of the topic and prioritize immediately recognizable wallpaper candidates.",
        2 => "Concurrent batch 2 of 3. Visual-variation batch: avoid repeating the primary lane; emphasize alternate composition, lighting, season, or medium.",
        3 => "Concurrent batch 3 of 3. Discovery batch: use different viewpoint, palette, time or weather, cultural framing, or bilingual keywords; avoid the obvious direct and visual-variation queries.",
        4 => "User-requested load-more batch: search fresh long-tail variants with a different viewpoint, palette, setting, time, weather, cultural framing, or bilingual keywords. Do not repeat the initial three batches.",
        _ => "Concurrent wallpaper batch: use complementary direct and visual/style query variants.",
    };
    let exclusion_guidance = if excluded_ids.is_empty() {
        String::new()
    } else {
        format!(
            "\nExclude candidates carrying these opaque media/post ids from the existing validated gallery: {}",
            excluded_ids.join(", ")
        )
    };
    format!(
        r#"You collect high-quality still images from X (Twitter) for a wallpaper picker.

User topic: {query}
Sort preference: {sort}

{lane_guidance}{exclusion_guidance}

Use X search only. Use no more than {max_search_calls} x_search call(s) in this request. Search useful query variants with image filters. Prefer real photography or polished AI art suitable as wallpaper. Prefer posts that include both a prompt and attached images when relevant. Skip memes, screenshots, text cards, avatars, emoji packs, ads, blurry thumbnails, videos, and placeholder links.

Return {target_count} distinct items when possible. Return fewer only when you cannot confirm enough candidates; never pad, duplicate, or guess metadata. fullUrl must be a direct HTTPS full-size image CDN URL, preferably https://pbs.twimg.com/media/... with name=orig. postUrl must be a confirmed canonical https://x.com/<user>/status/<id>; omit it rather than guessing. Include mediaIndex 1-4 only when the status media position is known. Return metadata only and do not download files."#
    )
}

fn gallery_schema(target_count: usize) -> Value {
    json!({
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "maxItems": target_count,
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
    classify_transport_error(error.is_timeout(), error)
}

fn classify_transport_error(
    is_timeout: bool,
    error: &(dyn std::error::Error + 'static),
) -> ResponsesSearchErrorKind {
    if is_timeout {
        return ResponsesSearchErrorKind::Timeout;
    }
    let mut source = Some(error);
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
mod tests;
