use std::time::Duration;

use hyper::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde_json::Value;

use super::request_url::provider_request_url;
use super::response::parse_api_page;
use super::{ApiPage, ProviderError};
use crate::safe_https_client::{
    self, SafeHttpsClient, SafeHttpsError, SafeHttpsErrorKind, SafeHttpsResponse,
};
use crate::skin_net::{self, OriginPolicy};
use crate::wallpaper_remote_search::RemoteWallpaperSource;
use crate::wallpaper_source::WallpaperSearchCancellation;

const HTTP_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_API_BYTES: usize = 2 * 1024 * 1024;

pub(super) fn provider_client() -> SafeHttpsClient {
    safe_https_client::shared()
}

pub(super) async fn fetch_api_page(
    client: &SafeHttpsClient,
    source: RemoteWallpaperSource,
    query: &str,
    page: usize,
    api_key: Option<&str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<ApiPage, ProviderError> {
    let url = provider_request_url(source, query, page)?;
    let checked = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
        checked = skin_net::check_hop_async(url.as_str(), &OriginPolicy::AnyHttps) => {
            checked.map_err(|_| ProviderError::Network)?
        },
    };
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("GrokApp/WallpaperProviderSearch"),
    );
    if source == RemoteWallpaperSource::Pexels {
        let key = api_key.ok_or(ProviderError::PexelsKeyMissing)?;
        let mut value = HeaderValue::from_str(key).map_err(|_| ProviderError::PexelsKeyInvalid)?;
        value.set_sensitive(true);
        headers.insert(AUTHORIZATION, value);
    }
    let response = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
        response = client.get(&checked, headers, HTTP_TIMEOUT) => {
            response.map_err(|error| classify_transport_error(&error))?
        },
    };
    let status = response.status();
    if status.is_redirection() {
        return Err(ProviderError::Protocol);
    }
    match status.as_u16() {
        200..=299 => {}
        401 | 403 if source == RemoteWallpaperSource::Pexels => {
            return Err(ProviderError::PexelsKeyInvalid);
        }
        408 | 504 => return Err(ProviderError::Timeout),
        429 => return Err(ProviderError::RateLimited),
        500..=599 => return Err(ProviderError::ServiceUnavailable),
        _ => return Err(ProviderError::Protocol),
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if content_type != "application/json" && !content_type.ends_with("+json") {
        return Err(ProviderError::Protocol);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_API_BYTES as u64)
    {
        return Err(ProviderError::Protocol);
    }
    let bytes = read_bounded_body(response, cancellation).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ProviderError::Protocol)?;
    parse_api_page(source, &value, page)
}

async fn read_bounded_body(
    mut response: SafeHttpsResponse,
    cancellation: &WallpaperSearchCancellation,
) -> Result<Vec<u8>, ProviderError> {
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(ProviderError::Cancelled),
            chunk = response.chunk() => chunk.map_err(|error| classify_transport_error(&error))?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        if bytes.len() + chunk.len() > MAX_API_BYTES {
            return Err(ProviderError::Protocol);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn classify_transport_error(error: &SafeHttpsError) -> ProviderError {
    match error.kind() {
        SafeHttpsErrorKind::Timeout => ProviderError::Timeout,
        SafeHttpsErrorKind::Blocked | SafeHttpsErrorKind::Network => ProviderError::Network,
    }
}
