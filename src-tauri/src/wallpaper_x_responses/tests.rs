use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use super::*;
use crate::wallpaper_source::X_SEARCH_FIRST_ROUND_CALLS;

#[derive(Clone)]
struct MockState {
    status: StatusCode,
    response_body: Arc<String>,
    delay: Duration,
    requests: Arc<AtomicUsize>,
    authorization_ok: Arc<AtomicBool>,
    request_body: Arc<Mutex<Option<Value>>>,
}

struct FailingDnsResolver;

#[derive(Debug)]
struct SyntheticTransportError(&'static str);

impl std::fmt::Display for SyntheticTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for SyntheticTransportError {}

impl reqwest::dns::Resolve for FailingDnsResolver {
    fn resolve(&self, _name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async {
            let error: Box<dyn std::error::Error + Send + Sync> = Box::new(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "synthetic DNS failure",
            ));
            Err::<reqwest::dns::Addrs, _>(error)
        })
    }
}

async fn spawn_raw_response(
    response: &'static [u8],
    delay: Duration,
) -> (SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind raw server");
    let address = listener.local_addr().expect("raw server address");
    let task = tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        let _ = stream.write_all(response).await;
    });
    (address, task)
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
    BuildOauthCredentialRevision::for_test(123, Some(456), 7)
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
        ResponsesSearchRequest {
            query: "misty mountains",
            sort: Some("top"),
            endpoint,
            max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
            lane_index: 1,
            target_count: 16,
            excluded_ids: &[],
            cancellation: &cancellation,
        },
        timeout,
        Ok(("test-token", test_revision())),
    )
    .await
}

fn lane_item(id: &str) -> WallpaperGalleryItem {
    WallpaperGalleryItem {
        id: id.into(),
        thumb_url: format!("https://pbs.twimg.com/media/{id}.jpg?name=small"),
        full_url: format!("https://pbs.twimg.com/media/{id}.jpg?name=orig"),
        kind: "image".into(),
        width: None,
        height: None,
        source: "x".into(),
        username: None,
        post_url: Some(format!("https://x.com/example/status/{id}")),
        text_preview: None,
        likes: None,
        local_path: None,
        prompt: None,
        status_id: Some(id.into()),
        media_index: Some(1),
        media_quality: None,
    }
}

fn lane_success(ids: &[&str], search_calls: u32) -> ResponsesSearchSuccess {
    ResponsesSearchSuccess {
        items: ids.iter().map(|id| lane_item(id)).collect(),
        candidate_count: ids.len(),
        valid_count: ids.len(),
        search_calls,
        model: RESPONSES_MODEL,
        effort: RESPONSES_EFFORT,
        credential_revision: test_revision(),
    }
}

#[tokio::test]
async fn wallpaper_x_responses_parallel_lanes_emit_completion_order_and_dedupe() {
    let captured = Arc::new(Mutex::new(Vec::<WallpaperXSearchBatch>::new()));
    let captured_batches = Arc::clone(&captured);
    let runtime = WallpaperXSearchRuntime::new(
        WallpaperSearchCancellation::default(),
        Arc::new(|_| {}),
        Arc::new(move |batch| {
            captured_batches
                .lock()
                .expect("batch capture lock")
                .push(batch);
        }),
    );

    let result = run_parallel_lanes(&runtime, test_revision(), |lane_index| async move {
        match lane_index {
            1 => {
                tokio::time::sleep(Duration::from_millis(30)).await;
                Ok(lane_success(&["a", "shared"], 2))
            }
            2 => {
                tokio::time::sleep(Duration::from_millis(5)).await;
                Ok(lane_success(&["b", "shared"], 2))
            }
            _ => {
                tokio::time::sleep(Duration::from_millis(15)).await;
                Err(ResponsesSearchError::new(
                    ResponsesSearchErrorKind::Empty,
                    Some(test_revision()),
                )
                .with_observed_search_calls(1))
            }
        }
    })
    .await
    .expect("two useful lanes should return partial success");

    assert_eq!(result.candidate_count, 4);
    assert_eq!(result.valid_count, 3);
    assert_eq!(result.search_calls, 5);
    let mut ids = result
        .items
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    assert_eq!(ids, ["a", "b", "shared"]);

    let batches = captured.lock().expect("batch capture lock");
    assert_eq!(batches.len(), 2);
    assert_eq!(batches[0].batch_index, 2);
    assert_eq!(batches[0].items.len(), 2);
    assert_eq!(batches[0].accumulated_count, 2);
    assert!(!batches[0].done);
    assert_eq!(batches[1].batch_index, 1);
    assert_eq!(batches[1].items.len(), 1);
    assert_eq!(batches[1].items[0].id, "a");
    assert_eq!(batches[1].accumulated_count, 3);
    assert!(batches[1].done);
}

#[tokio::test]
async fn wallpaper_x_responses_parallel_cancellation_stops_all_lanes_without_batches() {
    let captured = Arc::new(Mutex::new(Vec::<WallpaperXSearchBatch>::new()));
    let captured_batches = Arc::clone(&captured);
    let cancellation = WallpaperSearchCancellation::default();
    let runtime = WallpaperXSearchRuntime::new(
        cancellation.clone(),
        Arc::new(|_| {}),
        Arc::new(move |batch| {
            captured_batches
                .lock()
                .expect("batch capture lock")
                .push(batch);
        }),
    );
    let run = run_parallel_lanes(&runtime, test_revision(), |_| async {
        tokio::time::sleep(Duration::from_secs(10)).await;
        Ok(lane_success(&["late"], 1))
    });
    let cancel = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancellation.cancel();
    };
    let (result, ()) = tokio::join!(run, cancel);

    assert_eq!(
        result.expect_err("cancelled lanes must fail").kind,
        ResponsesSearchErrorKind::Cancelled
    );
    assert!(
        captured.lock().expect("batch capture lock").is_empty(),
        "cancelled lanes must not emit late batches"
    );
}

#[test]
fn wallpaper_x_responses_parallel_error_priority_prevents_cli_double_spend() {
    let error = select_parallel_error(
        vec![
            ResponsesSearchError::new(ResponsesSearchErrorKind::Network, Some(test_revision())),
            ResponsesSearchError::new(ResponsesSearchErrorKind::RateLimited, Some(test_revision())),
        ],
        test_revision(),
    );
    assert_eq!(error.kind, ResponsesSearchErrorKind::RateLimited);
}

#[tokio::test]
async fn wallpaper_x_responses_success_parses_gallery_and_fixed_contract() {
    assert_eq!(
        count_x_search_calls(&[json!({
            "type": "custom_tool_call",
            "status": "completed"
        })]),
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
    let visual_lane = responses_request(
        "misty mountains",
        Some("top"),
        RESPONSES_LANE_MAX_X_SEARCH_CALLS,
        2,
        RESPONSES_LANE_TARGET_COUNT,
        &[],
    );
    assert_eq!(visual_lane.get("max_tool_calls"), Some(&json!(3)));
    assert_eq!(
        visual_lane.pointer("/text/format/schema/properties/items/maxItems"),
        Some(&json!(8))
    );
    assert!(visual_lane
        .get("input")
        .and_then(Value::as_str)
        .is_some_and(|prompt| {
            prompt.contains("Visual-variation batch") && prompt.contains("Return 8 distinct items")
        }));
    assert_eq!(
        RESPONSES_LANE_COUNT as u32 * RESPONSES_LANE_MAX_X_SEARCH_CALLS,
        9
    );
    let excluded = vec!["twimg:seen-id".into(), "status:12345678:1".into()];
    let load_more = responses_request(
        "misty mountains",
        Some("top"),
        RESPONSES_LANE_MAX_X_SEARCH_CALLS,
        4,
        RESPONSES_LANE_TARGET_COUNT,
        &excluded,
    );
    assert!(load_more
        .get("input")
        .and_then(Value::as_str)
        .is_some_and(|prompt| {
            prompt.contains("User-requested load-more batch")
                && prompt.contains("twimg:seen-id")
                && prompt.contains("status:12345678:1")
        }));
}

#[test]
fn wallpaper_x_responses_counts_only_completed_call_records() {
    let output = [
        json!({ "type": "x_search_result", "status": "completed" }),
        json!({ "type": "x_search_call", "status": "in_progress" }),
        json!({ "type": "custom_tool_result", "status": "completed" }),
        json!({ "type": "custom_tool_call_extra", "status": "completed" }),
        json!({ "type": "tool_call", "name": "other", "status": "completed" }),
        json!({ "type": "x_search_call", "status": "completed" }),
        json!({
            "type": "server_tool_use",
            "name": "x_search",
            "status": "completed"
        }),
    ];

    assert_eq!(count_x_search_calls(&output), 2);
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
async fn wallpaper_x_responses_classifies_proxy_dns_and_connection_failures_as_network() {
    let (proxy_address, proxy_task) = spawn_raw_response(
        b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        Duration::ZERO,
    )
    .await;
    let proxy_client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{proxy_address}")).expect("synthetic proxy URL"))
        .timeout(Duration::from_secs(1))
        .build()
        .expect("proxy client");
    let proxy_error = proxy_client
        .get("https://wallpaper-search.invalid")
        .send()
        .await
        .expect_err("proxy must reject the CONNECT request");
    proxy_task.abort();
    assert_eq!(
        transport_error_kind(&proxy_error),
        ResponsesSearchErrorKind::Network,
        "proxy error: {proxy_error:?}"
    );

    let dns_client = reqwest::Client::builder()
        .no_proxy()
        .dns_resolver(Arc::new(FailingDnsResolver))
        .timeout(Duration::from_secs(1))
        .build()
        .expect("DNS client");
    let dns_error = dns_client
        .get("http://wallpaper-search.invalid")
        .send()
        .await
        .expect_err("synthetic DNS must fail");
    assert_eq!(
        transport_error_kind(&dns_error),
        ResponsesSearchErrorKind::Network
    );

    let (reset_address, reset_task) = spawn_raw_response(
        b"HTTP/1.1 200 OK\r\nContent-Length: 64\r\nConnection: close\r\n\r\npartial",
        Duration::ZERO,
    )
    .await;
    let reset_client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("reset client");
    let reset_error = match reset_client
        .get(format!("http://{reset_address}"))
        .send()
        .await
    {
        Ok(response) => response
            .bytes()
            .await
            .expect_err("truncated response body must fail"),
        Err(error) => error,
    };
    reset_task.abort();
    assert_eq!(
        transport_error_kind(&reset_error),
        ResponsesSearchErrorKind::Network
    );
}

#[tokio::test]
async fn wallpaper_x_responses_classifies_tls_markers_and_timeout_transport_failures() {
    for message in [
        "TLS handshake failed",
        "invalid peer certificate: UnknownIssuer",
    ] {
        assert_eq!(
            classify_transport_error(false, &SyntheticTransportError(message)),
            ResponsesSearchErrorKind::Tls
        );
    }
    assert_eq!(
        classify_transport_error(false, &SyntheticTransportError("connection reset by peer")),
        ResponsesSearchErrorKind::Network
    );

    let (timeout_address, timeout_task) =
        spawn_raw_response(b"HTTP/1.1 204 No Content\r\n\r\n", Duration::from_secs(1)).await;
    let timeout_error = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(25))
        .build()
        .expect("timeout client")
        .get(format!("http://{timeout_address}"))
        .send()
        .await
        .expect_err("delayed response must time out");
    timeout_task.abort();
    assert_eq!(
        transport_error_kind(&timeout_error),
        ResponsesSearchErrorKind::Timeout
    );
}

#[tokio::test]
async fn wallpaper_x_responses_cancellation_aborts_inflight_http() {
    let (endpoint, state, task) =
        spawn_mock(StatusCode::OK, success_payload(1), Duration::from_secs(10)).await;
    let cancellation = WallpaperSearchCancellation::default();
    let cancellation_for_request = cancellation.clone();
    let request = tokio::spawn(async move {
        search_with_credentials(
            ResponsesSearchRequest {
                query: "misty mountains",
                sort: Some("top"),
                endpoint: &endpoint,
                max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
                lane_index: 1,
                target_count: 16,
                excluded_ids: &[],
                cancellation: &cancellation_for_request,
            },
            Duration::from_secs(30),
            Ok(("test-token", test_revision())),
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
        "output": [
            { "type": "x_search_call", "status": "completed" },
            {
                "type": "message",
                "content": [{ "type": "output_text", "text": "not-json" }]
            }
        ]
    })
    .to_string();
    let (endpoint, _state, task) = spawn_mock(StatusCode::OK, invalid_output, Duration::ZERO).await;
    let error = test_search(&endpoint, Duration::from_secs(2))
        .await
        .expect_err("bad structured output must fail");
    task.abort();
    assert_eq!(error.kind, ResponsesSearchErrorKind::InvalidJson);

    let (endpoint, _state, task) =
        spawn_mock(StatusCode::OK, success_payload(0), Duration::ZERO).await;
    let error = test_search(&endpoint, Duration::from_secs(2))
        .await
        .expect_err("structured output without a real X tool call must fail");
    task.abort();
    assert_eq!(error.kind, ResponsesSearchErrorKind::ToolNotCalled);
    assert_eq!(error.observed_search_calls, Some(0));

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
            ResponsesSearchRequest {
                query: "misty mountains",
                sort: Some("top"),
                endpoint: &endpoint,
                max_search_calls: X_SEARCH_FIRST_ROUND_CALLS,
                lane_index: 1,
                target_count: 16,
                excluded_ids: &[],
                cancellation: &cancellation,
            },
            Duration::from_secs(2),
            Err(oauth_error),
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
