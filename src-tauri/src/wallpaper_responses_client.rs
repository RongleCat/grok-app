//! Shared Host-only client for fixed Grok Build Responses side routes.

use std::collections::HashSet;
use std::time::Duration;

use reqwest::StatusCode;
use serde_json::Value;

use crate::account::{
    self, BuildOauthAccessToken, BuildOauthCredentialRevision, BuildOauthTokenError,
};
use crate::wallpaper_source::WallpaperSearchCancellation;

pub(crate) const ENDPOINT: &str = "https://cli-chat-proxy.grok.com/v1/responses";
pub(crate) const MODEL: &str = "grok-4.6";
pub(crate) const EFFORT: &str = "low";
const CLIENT_MODE: &str = "cli";
const CLIENT_IDENTIFIER: &str = "grok-shell";
const CLIENT_VERSION: &str = "1.0.5";
const TOKEN_AUTH: &str = "xai-grok-cli";
const AUTHENTICATE_RESPONSE: &str = "authenticate-response";
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ErrorKind {
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
    ToolBudgetExceeded,
    Cancelled,
}

impl ErrorKind {
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
            Self::ToolBudgetExceeded => "responses_tool_budget_exceeded",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClientError {
    pub(crate) kind: ErrorKind,
    pub(crate) credential_revision: Option<Box<BuildOauthCredentialRevision>>,
    pub(crate) observed_tool_calls: Option<u32>,
    pub(crate) tool_call_breakdown: Option<ToolCallBreakdown>,
}

impl ClientError {
    pub(crate) fn new(
        kind: ErrorKind,
        credential_revision: Option<BuildOauthCredentialRevision>,
    ) -> Self {
        Self {
            kind,
            credential_revision: credential_revision.map(Box::new),
            observed_tool_calls: None,
            tool_call_breakdown: None,
        }
    }

    pub(crate) fn with_observed_tool_calls(mut self, calls: u32) -> Self {
        self.observed_tool_calls = Some(calls);
        self
    }

    pub(crate) fn with_tool_call_breakdown(mut self, breakdown: ToolCallBreakdown) -> Self {
        self.tool_call_breakdown = Some(breakdown);
        self
    }

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }
}

pub(crate) struct ResponsesClient {
    http: reqwest::Client,
    auth: BuildOauthAccessToken,
}

impl ResponsesClient {
    pub(crate) fn new(timeout: Duration) -> Result<Self, ClientError> {
        let auth = account::read_build_oauth_access_token().map_err(auth_error)?;
        let revision = Some(auth.revision.clone());
        let http = crate::proxy::apply_to_reqwest(
            reqwest::Client::builder()
                .timeout(timeout)
                .connect_timeout(timeout.min(Duration::from_secs(20)))
                .redirect(reqwest::redirect::Policy::none()),
        )
        .build()
        .map_err(|_| ClientError::new(ErrorKind::Network, revision))?;
        Ok(Self { http, auth })
    }

    pub(crate) fn credential_revision(&self) -> &BuildOauthCredentialRevision {
        &self.auth.revision
    }

    pub(crate) async fn post_json(
        &self,
        body: Value,
        cancellation: &WallpaperSearchCancellation,
    ) -> Result<Value, ClientError> {
        if cancellation.is_cancelled() {
            return Err(self.error(ErrorKind::Cancelled));
        }
        let request = self
            .http
            .post(ENDPOINT)
            .bearer_auth(self.auth.expose_to_build_proxy());
        let request = apply_build_proxy_headers(request).json(&body).send();
        let response = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(self.error(ErrorKind::Cancelled)),
            response = request => response,
        }
        .map_err(|error| self.error(transport_error_kind(&error)))?;
        let status = response.status();
        if !status.is_success() {
            return Err(self.error(status_error_kind(status)));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
        {
            return Err(self.error(ErrorKind::Protocol));
        }
        let bytes = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(self.error(ErrorKind::Cancelled)),
            bytes = read_bounded_body(response, Some(self.auth.revision.clone())) => bytes?,
        };
        if bytes.is_empty() {
            return Err(self.error(ErrorKind::Empty));
        }
        serde_json::from_slice(&bytes).map_err(|_| self.error(ErrorKind::InvalidJson))
    }

    fn error(&self, kind: ErrorKind) -> ClientError {
        ClientError::new(kind, Some(self.auth.revision.clone()))
    }
}

/// Apply the fixed identity and OAuth-routing headers used by Grok Build for
/// authenticated cli-chat-proxy requests. Keep side routes on this helper so
/// new Responses callers cannot silently drift from the official contract.
pub(crate) fn apply_build_proxy_headers(
    request: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    request
        .header("X-XAI-Token-Auth", TOKEN_AUTH)
        .header("x-authenticateresponse", AUTHENTICATE_RESPONSE)
        .header("x-grok-client-mode", CLIENT_MODE)
        .header("x-grok-client-identifier", CLIENT_IDENTIFIER)
        .header("x-grok-client-version", CLIENT_VERSION)
}

fn auth_error(error: BuildOauthTokenError) -> ClientError {
    let kind = match error {
        BuildOauthTokenError::Unavailable => ErrorKind::OauthUnavailable,
        BuildOauthTokenError::Expired => ErrorKind::OauthExpired,
    };
    ClientError::new(kind, None)
}

async fn read_bounded_body(
    mut response: reqwest::Response,
    revision: Option<BuildOauthCredentialRevision>,
) -> Result<Vec<u8>, ClientError> {
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| ClientError::new(transport_error_kind(&error), revision.clone()))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
            return Err(ClientError::new(ErrorKind::Protocol, revision));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn status_error_kind(status: StatusCode) -> ErrorKind {
    match status.as_u16() {
        400 => ErrorKind::BadRequest,
        401 | 403 => ErrorKind::Unauthorized,
        429 => ErrorKind::RateLimited,
        500..=599 => ErrorKind::ServerError,
        _ => ErrorKind::Protocol,
    }
}

fn transport_error_kind(error: &reqwest::Error) -> ErrorKind {
    if error.is_timeout() {
        return ErrorKind::Timeout;
    }
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(cause) = source {
        let message = cause.to_string().to_ascii_lowercase();
        if message.contains("tls")
            || message.contains("certificate")
            || message.contains("cert ")
            || message.contains("handshake")
        {
            return ErrorKind::Tls;
        }
        source = cause.source();
    }
    ErrorKind::Network
}

pub(crate) fn output_items(payload: &Value) -> Result<&[Value], ErrorKind> {
    payload
        .get("output")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or(ErrorKind::Protocol)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ToolCallBreakdown {
    pub(crate) total: u32,
    pub(crate) primary_call_items: u32,
    pub(crate) server_tool_use_items: u32,
    pub(crate) other_call_items: u32,
    pub(crate) distinct_call_ids: u32,
    pub(crate) duplicate_call_ids: u32,
    pub(crate) missing_call_ids: u32,
}

pub(crate) fn tool_call_breakdown(output: &[Value], tool_name: &str) -> ToolCallBreakdown {
    let expected = tool_name.to_ascii_lowercase();
    let primary_call = format!("{expected}_call");
    let typed_calls = [
        primary_call.clone(),
        format!("{expected}_use"),
        format!("{expected}_tool_call"),
        format!("{expected}_tool_use"),
    ];
    let mut breakdown = ToolCallBreakdown::default();
    let mut call_ids = HashSet::new();

    for item in output {
        let item_type = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let typed_call = typed_calls.iter().any(|call| call == &item_type);
        let named_tool = ["name", "tool_name", "tool"]
            .iter()
            .filter_map(|field| item.get(field).and_then(Value::as_str))
            .any(|name| name.eq_ignore_ascii_case(tool_name));
        let named_call = named_tool
            && matches!(
                item_type.as_str(),
                "server_tool_use" | "server_tool_call" | "tool_use" | "tool_call"
            );
        if !typed_call && !named_call {
            continue;
        }

        breakdown.total = breakdown.total.saturating_add(1);
        if item_type == primary_call {
            breakdown.primary_call_items = breakdown.primary_call_items.saturating_add(1);
        } else if item_type == "server_tool_use" {
            breakdown.server_tool_use_items = breakdown.server_tool_use_items.saturating_add(1);
        } else {
            breakdown.other_call_items = breakdown.other_call_items.saturating_add(1);
        }

        let call_id = ["id", "call_id", "tool_call_id"]
            .iter()
            .filter_map(|field| item.get(field).and_then(Value::as_str))
            .find(|value| !value.trim().is_empty());
        match call_id {
            Some(call_id) if call_ids.insert(call_id.to_string()) => {
                breakdown.distinct_call_ids = breakdown.distinct_call_ids.saturating_add(1);
            }
            Some(_) => {
                breakdown.duplicate_call_ids = breakdown.duplicate_call_ids.saturating_add(1);
            }
            None => {
                breakdown.missing_call_ids = breakdown.missing_call_ids.saturating_add(1);
            }
        }
    }

    breakdown
}

pub(crate) fn count_tool_calls(output: &[Value], tool_name: &str) -> u32 {
    tool_call_breakdown(output, tool_name).total
}

pub(crate) fn output_json(output: &[Value]) -> Result<Value, ErrorKind> {
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
                Ok(value) => return Ok(value),
                Err(_) => saw_invalid_json = true,
            }
        }
    }
    if saw_invalid_json {
        Err(ErrorKind::InvalidJson)
    } else {
        Err(ErrorKind::Empty)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_last_structured_output_and_counts_named_tool() {
        let output = vec![
            json!({ "type": "web_search_call", "status": "completed" }),
            json!({
                "type": "message",
                "content": [{ "type": "output_text", "text": "{\"pages\":[]}" }]
            }),
        ];
        assert_eq!(count_tool_calls(&output, "web_search"), 1);
        assert_eq!(output_json(&output).unwrap(), json!({ "pages": [] }));
    }

    #[test]
    fn counts_named_server_tool_use_without_counting_results() {
        let output = vec![
            json!({ "type": "server_tool_use", "name": "web_search" }),
            json!({ "type": "server_tool_result", "name": "web_search" }),
            json!({ "type": "message", "content": [] }),
        ];
        assert_eq!(count_tool_calls(&output, "web_search"), 1);
    }

    #[test]
    fn counts_supported_call_shapes() {
        let output = vec![
            json!({ "type": "web_search_call" }),
            json!({ "type": "web_search_tool_call" }),
            json!({ "type": "server_tool_use", "name": "web_search" }),
            json!({ "type": "server_tool_call", "tool_name": "web_search" }),
            json!({ "type": "tool_use", "tool": "web_search" }),
            json!({ "type": "tool_call", "name": "web_search" }),
        ];
        assert_eq!(count_tool_calls(&output, "web_search"), 6);
    }

    #[test]
    fn reports_safe_tool_call_shape_and_id_breakdown() {
        let output = vec![
            json!({ "type": "web_search_call", "id": "call-1" }),
            json!({
                "type": "server_tool_use",
                "name": "web_search",
                "call_id": "call-1"
            }),
            json!({ "type": "web_search_call", "id": "call-2" }),
            json!({ "type": "tool_call", "name": "web_search" }),
            json!({ "type": "server_tool_result", "name": "web_search", "id": "call-3" }),
        ];
        assert_eq!(
            tool_call_breakdown(&output, "web_search"),
            ToolCallBreakdown {
                total: 4,
                primary_call_items: 2,
                server_tool_use_items: 1,
                other_call_items: 1,
                distinct_call_ids: 2,
                duplicate_call_ids: 1,
                missing_call_ids: 1,
            }
        );
    }

    #[test]
    fn ignores_result_shapes_for_the_same_tool() {
        let output = vec![
            json!({ "type": "web_search_result" }),
            json!({ "type": "web_search_tool_result" }),
            json!({ "type": "server_tool_result", "name": "web_search" }),
            json!({ "type": "tool_result", "tool_name": "web_search" }),
        ];
        assert_eq!(count_tool_calls(&output, "web_search"), 0);
    }

    #[test]
    fn client_error_codes_never_include_credentials() {
        for kind in [
            ErrorKind::OauthUnavailable,
            ErrorKind::OauthExpired,
            ErrorKind::Unauthorized,
            ErrorKind::RateLimited,
            ErrorKind::Cancelled,
        ] {
            let code = kind.code();
            assert!(!code.contains("Bearer"));
            assert!(!code.contains("token"));
        }
    }

    #[test]
    fn client_error_stays_small_enough_for_result_errors() {
        assert!(std::mem::size_of::<ClientError>() <= 128);
    }

    #[test]
    fn build_proxy_headers_match_grok_build_contract() {
        let request = apply_build_proxy_headers(
            reqwest::Client::new().post("https://cli-chat-proxy.grok.com/v1/responses"),
        )
        .build()
        .expect("request should build");
        let headers = request.headers();

        assert_eq!(headers["X-XAI-Token-Auth"], TOKEN_AUTH);
        assert_eq!(headers["x-authenticateresponse"], AUTHENTICATE_RESPONSE);
        assert_eq!(headers["x-grok-client-mode"], CLIENT_MODE);
        assert_eq!(headers["x-grok-client-identifier"], CLIENT_IDENTIFIER);
        assert_eq!(headers["x-grok-client-version"], CLIENT_VERSION);
    }
}
