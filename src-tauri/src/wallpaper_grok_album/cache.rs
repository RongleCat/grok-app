use std::collections::HashSet;
use std::sync::LazyLock;

use parking_lot::Mutex;
use tauri::Url;

use super::model::GrokAlbumMedia;
use super::request_registry::cancel_all as cancel_all_album_requests;

const MAX_CACHE_ITEMS: usize = 480;
const CACHE_TOP_THRESHOLD: f64 = 96.0;
const EMPTY_AT_TOP_CONFIRMATIONS: u8 = 2;

#[derive(Default)]
pub(super) struct AlbumCache {
    pub(super) items: Vec<GrokAlbumMedia>,
    pub(super) revision: u64,
    pub(super) page_epoch: Option<u64>,
    pub(super) empty_at_top_snapshots: u8,
}

static ALBUM_CACHE: LazyLock<Mutex<AlbumCache>> =
    LazyLock::new(|| Mutex::new(AlbumCache::default()));

pub(super) fn cached_media_contains(raw_url: &str) -> bool {
    let target = media_identity(raw_url);
    ALBUM_CACHE.lock().items.iter().any(|item| {
        media_identity(&item.media_url) == target
            || item
                .thumbnail_url
                .as_deref()
                .is_some_and(|url| media_identity(url) == target)
    })
}

pub(super) fn cached_media_state(raw_url: &str) -> Option<(u64, bool)> {
    let target = media_identity(raw_url);
    let cache = ALBUM_CACHE.lock();
    cache.items.iter().find_map(|item| {
        let matches = media_identity(&item.media_url) == target
            || item
                .thumbnail_url
                .as_deref()
                .is_some_and(|url| media_identity(url) == target);
        matches.then_some((cache.revision, item.webview_only))
    })
}

fn merge_cache_items(cache: &mut AlbumCache, incoming: Vec<GrokAlbumMedia>) -> usize {
    let mut seen = cache
        .items
        .iter()
        .map(|item| media_identity(&item.media_url))
        .collect::<HashSet<_>>();
    let before = cache.items.len();
    for item in incoming {
        if cache.items.len() >= MAX_CACHE_ITEMS {
            break;
        }
        if seen.insert(media_identity(&item.media_url)) {
            cache.items.push(item);
        }
    }
    cache.items.len().saturating_sub(before)
}

#[cfg(test)]
pub(super) fn merge_cache(incoming: Vec<GrokAlbumMedia>) -> usize {
    let mut cache = ALBUM_CACHE.lock();
    merge_cache_items(&mut cache, incoming)
}

#[cfg(test)]
pub(super) fn merge_cache_items_at_revision(
    cache: &mut AlbumCache,
    incoming: Vec<GrokAlbumMedia>,
    expected_revision: u64,
) -> Option<usize> {
    if cache.revision != expected_revision {
        return None;
    }
    Some(merge_cache_items(cache, incoming))
}

pub(super) fn reconcile_cache_items_at_revision(
    cache: &mut AlbumCache,
    incoming: Vec<GrokAlbumMedia>,
    expected_revision: u64,
    page_epoch: u64,
    scroll_top: f64,
) -> Option<(usize, bool)> {
    if cache.revision != expected_revision {
        return None;
    }

    let at_top = scroll_top.is_finite() && scroll_top <= CACHE_TOP_THRESHOLD;
    let incoming_identities = incoming
        .iter()
        .map(|item| media_identity(&item.media_url))
        .collect::<HashSet<_>>();
    let has_overlap = cache
        .items
        .iter()
        .any(|item| incoming_identities.contains(&media_identity(&item.media_url)));
    let mut reset = false;

    if cache.page_epoch != Some(page_epoch) {
        reset = !cache.items.is_empty();
        cache.page_epoch = Some(page_epoch);
        cache.empty_at_top_snapshots = 0;
    }

    if at_top && incoming.is_empty() && !cache.items.is_empty() {
        cache.empty_at_top_snapshots = cache.empty_at_top_snapshots.saturating_add(1);
        if cache.empty_at_top_snapshots >= EMPTY_AT_TOP_CONFIRMATIONS {
            reset = true;
        }
    } else {
        cache.empty_at_top_snapshots = 0;
        if at_top && !incoming.is_empty() && !cache.items.is_empty() && !has_overlap {
            reset = true;
        }
    }

    if reset {
        cache.items.clear();
        cache.revision = cache.revision.wrapping_add(1);
        cache.empty_at_top_snapshots = 0;
    }
    Some((merge_cache_items(cache, incoming), reset))
}

pub(super) fn reconcile_cache_at_revision(
    incoming: Vec<GrokAlbumMedia>,
    expected_revision: u64,
    page_epoch: u64,
    scroll_top: f64,
) -> Option<(usize, bool)> {
    let (new_items, reset) = {
        let mut cache = ALBUM_CACHE.lock();
        reconcile_cache_items_at_revision(
            &mut cache,
            incoming,
            expected_revision,
            page_epoch,
            scroll_top,
        )?
    };
    if reset {
        let _ = cancel_all_album_requests();
    }
    Some((new_items, reset))
}

fn media_identity(raw: &str) -> String {
    let Ok(mut url) = Url::parse(raw) else {
        return raw.to_string();
    };
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

pub(super) fn cached_items() -> Vec<GrokAlbumMedia> {
    ALBUM_CACHE.lock().items.clone()
}

pub(super) fn cache_revision() -> u64 {
    ALBUM_CACHE.lock().revision
}

pub(super) fn clear_cache() {
    {
        let mut cache = ALBUM_CACHE.lock();
        cache.items.clear();
        cache.revision = cache.revision.wrapping_add(1);
        cache.page_epoch = None;
        cache.empty_at_top_snapshots = 0;
    }
    let _ = cancel_all_album_requests();
}
