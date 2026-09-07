use super::*;
use std::cell::Cell;

fn revision(value: u8) -> BuildOauthCredentialRevision {
    BuildOauthCredentialRevision::for_test(1, Some(1), value)
}

fn success() -> WallpaperSearchResult {
    let item = wallpaper_source::parse_gallery_items(
        &serde_json::json!({"items": [{
            "fullUrl": "https://pbs.twimg.com/media/sky.jpg", "kind": "image"
        }]}),
        "x",
    )
    .remove(0);
    WallpaperSearchResult {
        items: vec![item],
        error_code: None,
        message: None,
        meta: Some(WallpaperSearchMeta {
            request_id: Some("old".into()),
            requested_mode: "responses_preview".into(),
            route_used: "responses".into(),
            fallback_reason: None,
            duration_ms: 9000,
            cache_hit: false,
            search_calls: Some(6),
            candidate_count: 1,
            valid_count: 1,
            model: Some("grok-4.6".into()),
            effort: Some("low".into()),
        }),
    }
}

fn request(runtime: &WallpaperXSearchRuntime) -> CacheRequest<'_> {
    CacheRequest {
        request_id: "new",
        query: " blue  SKY ",
        sort: Some("top"),
        mode: "responses_preview",
        runtime,
    }
}

#[tokio::test]
async fn repeat_search_uses_validated_cache_without_provider_calls() {
    let runtime = WallpaperXSearchRuntime::quiet();
    let cache = Mutex::new(Cache::default());
    let first = run_cached(
        request(&runtime),
        &cache,
        || Some(revision(1)),
        || async { success() },
    )
    .await;
    assert!(!first.meta.unwrap().cache_hit);
    let second = run_cached(
        request(&runtime),
        &cache,
        || Some(revision(1)),
        || async { panic!("cache hit must not call provider") },
    )
    .await;
    let meta = second.meta.unwrap();
    assert!(meta.cache_hit);
    assert_eq!(meta.request_id.as_deref(), Some("new"));
    assert_eq!(meta.search_calls, Some(0));
    assert_eq!(second.items.len(), 1);
}

#[tokio::test]
async fn changed_or_expired_credentials_never_receive_old_results() {
    let runtime = WallpaperXSearchRuntime::quiet();
    let cache = Mutex::new(Cache::default());
    run_cached(
        request(&runtime),
        &cache,
        || Some(revision(1)),
        || async { success() },
    )
    .await;
    for identity in [Some(revision(2)), None] {
        let called = Cell::new(false);
        let result = run_cached(
            request(&runtime),
            &cache,
            || identity.clone(),
            || async {
                called.set(true);
                success()
            },
        )
        .await;
        assert!(called.get());
        assert!(!result.meta.unwrap().cache_hit);
    }
}

#[tokio::test]
async fn credential_change_during_search_prevents_cache_write() {
    let runtime = WallpaperXSearchRuntime::quiet();
    let cache = Mutex::new(Cache::default());
    let identity = Cell::new(1);
    run_cached(
        request(&runtime),
        &cache,
        || Some(revision(identity.get())),
        || async {
            identity.set(2);
            success()
        },
    )
    .await;
    assert!(cache.lock().entries.is_empty());
}

#[tokio::test]
async fn cancellation_wins_over_hits_and_provider_completion() {
    let cache = Mutex::new(Cache::default());
    let active = WallpaperXSearchRuntime::quiet();
    run_cached(
        request(&active),
        &cache,
        || Some(revision(1)),
        || async { success() },
    )
    .await;
    let cancelled = WallpaperXSearchRuntime::quiet();
    cancelled.cancellation().cancel();
    let hit = run_cached(
        request(&cancelled),
        &cache,
        || Some(revision(1)),
        || async { panic!("pre-cancel") },
    )
    .await;
    assert_eq!(hit.error_code.as_deref(), Some("cancelled"));
    let cache = Mutex::new(Cache::default());
    let result = run_cached(
        request(&active),
        &cache,
        || Some(revision(1)),
        || async {
            active.cancellation().cancel();
            success()
        },
    )
    .await;
    assert_eq!(result.error_code.as_deref(), Some("cancelled"));
    assert!(cache.lock().entries.is_empty());
    assert!(active
        .cancellation()
        .commit_if_active(|| panic!("cancelled commit"))
        .is_none());
}

#[tokio::test]
async fn failures_cli_and_fallbacks_are_not_cached() {
    let cache = Mutex::new(Cache::default());
    let runtime = WallpaperXSearchRuntime::quiet();
    for mode in ["cli", "auto", "responses_preview"] {
        let mut req = request(&runtime);
        req.mode = mode;
        run_cached(
            req,
            &cache,
            || Some(revision(1)),
            || async {
                let mut result = success();
                result.meta.as_mut().unwrap().route_used = "cli".into();
                result
            },
        )
        .await;
    }
    run_cached(
        request(&runtime),
        &cache,
        || Some(revision(1)),
        || async {
            let mut result = success();
            result.error_code = Some("responses_network".into());
            result
        },
    )
    .await;
    assert!(cache.lock().entries.is_empty());
}

#[test]
fn cache_bounds_lru_and_ttl_without_extending_expiry_on_reads() {
    let now = Instant::now();
    let mut cache = Cache::default();
    let key = |i| Key {
        query: format!("{i}"),
        latest: false,
        credential: revision(1),
    };
    for i in 0..CAPACITY {
        cache.insert(key(i), success(), now);
    }
    assert!(cache.get(&key(0), now + TTL / 2).is_some());
    cache.insert(key(CAPACITY), success(), now + TTL / 2);
    assert_eq!(cache.entries.len(), CAPACITY);
    assert!(cache.get(&key(1), now + TTL / 2).is_none());
    assert!(cache.get(&key(0), now + TTL).is_none());
    assert!(cache.get(&key(CAPACITY), now + TTL).is_some());
    let mut wrong_sort = key(CAPACITY);
    wrong_sort.latest = true;
    assert!(cache.get(&wrong_sort, now + TTL).is_none());
}
