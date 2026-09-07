use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use url::Url;

use super::{ProviderError, OPENVERSE_PAGE_SIZE, PEXELS_PAGE_SIZE};
use crate::wallpaper_remote_search::RemoteWallpaperSource;

const OPENVERSE_ENDPOINT: &str = "https://api.openverse.org/v1/images/";
const PEXELS_ENDPOINT: &str = "https://api.pexels.com/v1/search";
pub(super) const PEXELS_CACHE_BUST_PARAM: &str = "_grokapp_cache_bust";

static PEXELS_CACHE_BUST_PREFIX: LazyLock<String> =
    LazyLock::new(|| uuid::Uuid::new_v4().simple().to_string());
static PEXELS_CACHE_BUST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn provider_request_url(
    source: RemoteWallpaperSource,
    query: &str,
    page: usize,
) -> Result<Url, ProviderError> {
    let pexels_cache_bust = (source == RemoteWallpaperSource::Pexels).then(next_pexels_cache_bust);
    provider_url(source, query, page, pexels_cache_bust.as_deref())
}

fn next_pexels_cache_bust() -> String {
    let sequence = PEXELS_CACHE_BUST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}{sequence:016x}", PEXELS_CACHE_BUST_PREFIX.as_str())
}

pub(super) fn provider_url(
    source: RemoteWallpaperSource,
    query: &str,
    page: usize,
    pexels_cache_bust: Option<&str>,
) -> Result<Url, ProviderError> {
    let (endpoint, page_size) = match source {
        RemoteWallpaperSource::Openverse => (OPENVERSE_ENDPOINT, OPENVERSE_PAGE_SIZE),
        RemoteWallpaperSource::Pexels => (PEXELS_ENDPOINT, PEXELS_PAGE_SIZE),
        RemoteWallpaperSource::Web => return Err(ProviderError::Protocol),
    };
    let mut url = Url::parse(endpoint).map_err(|_| ProviderError::Protocol)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", &page.max(1).to_string());
        if source == RemoteWallpaperSource::Openverse {
            if pexels_cache_bust.is_some() {
                return Err(ProviderError::Protocol);
            }
            pairs.append_pair("q", query);
            pairs.append_pair("page_size", &page_size.to_string());
            pairs.append_pair("mature", "false");
        } else {
            let cache_bust = pexels_cache_bust
                .filter(|value| {
                    value.len() == 48 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .ok_or(ProviderError::Protocol)?;
            pairs.append_pair("query", query);
            pairs.append_pair("per_page", &page_size.to_string());
            pairs.append_pair("orientation", "landscape");
            pairs.append_pair(PEXELS_CACHE_BUST_PARAM, cache_bust);
        }
    }
    Ok(url)
}
