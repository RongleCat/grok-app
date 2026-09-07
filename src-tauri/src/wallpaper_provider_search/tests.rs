use super::*;
use serde_json::json;
use url::Url;

fn gallery_item(id: usize) -> WallpaperGalleryItem {
    WallpaperGalleryItem {
        id: format!("item-{id}"),
        thumb_url: format!("https://images.example/{id}.jpg"),
        full_url: format!("https://images.example/{id}.jpg"),
        kind: "image".into(),
        width: Some(1920),
        height: Some(1080),
        source: "pexels".into(),
        username: None,
        post_url: None,
        text_preview: None,
        likes: None,
        local_path: None,
        prompt: None,
        provenance: crate::wallpaper_source::WallpaperProvenance::empty(),
        status_id: None,
        media_index: None,
        media_quality: None,
        media_fingerprint: None,
    }
}

#[test]
fn endpoints_and_page_sizes_are_fixed() {
    let openverse = provider_url(RemoteWallpaperSource::Openverse, "misty lake", 3, None).unwrap();
    assert_eq!(openverse.host_str(), Some("api.openverse.org"));
    assert_eq!(openverse.path(), "/v1/images/");
    assert!(openverse.as_str().contains("page_size=20"));
    assert!(openverse.as_str().contains("page=3"));
    assert_eq!(
        openverse
            .query_pairs()
            .find(|(key, _)| key == PEXELS_CACHE_BUST_PARAM),
        None
    );

    let pexels = provider_url(
        RemoteWallpaperSource::Pexels,
        "misty lake",
        2,
        Some("000000000000000000000000000000010000000000000001"),
    )
    .unwrap();
    assert_eq!(pexels.host_str(), Some("api.pexels.com"));
    assert_eq!(pexels.path(), "/v1/search");
    assert!(pexels.as_str().contains("per_page=40"));
    assert!(pexels.as_str().contains("orientation=landscape"));
    assert_eq!(
        pexels
            .query_pairs()
            .find(|(key, _)| key == "query")
            .map(|(_, value)| value.into_owned())
            .as_deref(),
        Some("misty lake")
    );
    assert!(!pexels.query_pairs().any(|(key, _)| key == "q"));
}

#[test]
fn pexels_requests_use_fresh_credential_free_cache_busters() {
    let first = provider_request_url(RemoteWallpaperSource::Pexels, "misty lake", 1).unwrap();
    let second = provider_request_url(RemoteWallpaperSource::Pexels, "misty lake", 1).unwrap();
    let nonce = |url: &Url| {
        url.query_pairs()
            .find(|(key, _)| key == PEXELS_CACHE_BUST_PARAM)
            .map(|(_, value)| value.into_owned())
            .unwrap()
    };
    let first_nonce = nonce(&first);
    let second_nonce = nonce(&second);

    assert_ne!(first_nonce, second_nonce);
    for value in [&first_nonce, &second_nonce] {
        assert_eq!(value.len(), 48);
        assert!(value.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
    assert!(provider_url(RemoteWallpaperSource::Pexels, "misty lake", 1, None).is_err());
    assert!(provider_url(
        RemoteWallpaperSource::Pexels,
        "misty lake",
        1,
        Some("pexels-api-key-sentinel"),
    )
    .is_err());
}

#[test]
fn library_queries_drop_wallpaper_and_resolution_modifiers() {
    assert_eq!(
        library_provider_query("aurora mountain lake wallpaper"),
        "aurora mountain lake"
    );
    assert_eq!(
        library_provider_query("极光雪山湖泊 4K 壁纸"),
        "极光雪山湖泊"
    );
    assert_eq!(library_provider_query("富士山 壁紙 8K"), "富士山");
    assert_eq!(library_provider_query("海岸 桌布 UHD"), "海岸");
    assert_eq!(library_provider_query("오로라 배경화면 4k"), "오로라");
    assert_eq!(library_provider_query("wallpaper"), "wallpaper");
    assert_eq!(library_provider_query("wallpaper !!!"), "wallpaper !!!");
}

#[test]
fn openverse_parser_requires_real_provenance_and_license() {
    let page = parse_openverse_page(
        &json!({
            "page_count": 3,
            "results": [{
                "id": "asset-1",
                "title": "Misty mountain",
                "creator": "Photographer",
                "creator_url": "https://creator.example/profile",
                "url": "https://images.example/mountain.jpg",
                "foreign_landing_url": "https://source.example/photo/1",
                "license": "by-sa",
                "license_version": "4.0",
                "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                "mature": false
            }, {
                "id": "missing-license",
                "creator": "Unknown",
                "url": "https://images.example/no-license.jpg",
                "foreign_landing_url": "https://source.example/photo/2"
            }]
        }),
        1,
    )
    .unwrap();
    assert!(page.has_more);
    assert_eq!(page.candidates.len(), 1);
    let item = &page.candidates[0];
    assert_eq!(item.source_name, "Openverse");
    assert_eq!(item.license, "CC BY-SA 4.0");
    assert_eq!(item.author_name, "Photographer");
}

#[test]
fn pexels_parser_ignores_upstream_next_url_and_uses_fixed_license() {
    let page = parse_pexels_page(
        &json!({
            "page": 1,
            "per_page": 40,
            "total_results": 80,
            "next_page": "https://attacker.invalid/next",
            "photos": [{
                "id": 42,
                "url": "https://www.pexels.com/photo/misty-lake-42/",
                "photographer": "Photographer",
                "photographer_url": "https://www.pexels.com/@photographer/",
                "alt": "Misty lake",
                "src": {"original": "https://images.pexels.com/photos/42/image.jpeg"}
            }]
        }),
        1,
    )
    .unwrap();
    assert!(page.has_more);
    assert_eq!(page.candidates.len(), 1);
    assert_eq!(page.candidates[0].license, "Pexels License");
    assert_eq!(page.candidates[0].license_url, PEXELS_LICENSE_URL);
}

#[test]
fn provider_links_reject_insecure_userinfo_and_non_default_ports() {
    assert!(safe_url("http://example.test/image.jpg").is_none());
    assert!(safe_url("https://user:pass@example.test/image.jpg").is_none());
    assert!(safe_url("https://example.test:444/image.jpg").is_none());
    assert_eq!(
        safe_url("https://example.test:443/image.jpg#fragment").as_deref(),
        Some("https://example.test/image.jpg")
    );
}

#[test]
fn cache_expires_and_keeps_the_host_owned_cursor() {
    let search = SearchKey {
        source: RemoteWallpaperSource::Openverse,
        query: "misty lake".into(),
        credential_revision: None,
        contract_version: CONTRACT_VERSION,
    };
    let key = PageKey {
        search,
        first_page: 1,
    };
    let result = RemoteSearchResult::success("openverse", Vec::new(), true, 5);
    let now = Instant::now();
    let mut cache = SearchCache::default();
    cache.insert(
        key.clone(),
        result,
        Some(ProviderContinuation {
            next_page: 3,
            buffered_items: vec![gallery_item(1)],
            upstream_has_more: true,
        }),
        now,
    );
    let continuation = cache
        .get(&key, now)
        .and_then(|(_, continuation)| continuation)
        .expect("cached continuation");
    assert_eq!(continuation.next_page, 3);
    assert_eq!(continuation.buffered_items.len(), 1);
    assert!(continuation.upstream_has_more);
    assert!(cache
        .get(&key, now + CACHE_TTL + Duration::from_secs(1))
        .is_none());
}

#[test]
fn provider_initial_cache_hit_is_linearized_before_a_later_cancellation() {
    let key = PageKey {
        search: SearchKey {
            source: RemoteWallpaperSource::Openverse,
            query: "misty lake".into(),
            credential_revision: None,
            contract_version: CONTRACT_VERSION,
        },
        first_page: 1,
    };
    let mut cache = SearchCache::default();
    cache.insert(
        key.clone(),
        RemoteSearchResult::success("openverse", vec![gallery_item(1)], true, 1),
        None,
        Instant::now(),
    );
    let cancellation = WallpaperSearchCancellation::default();
    let guarded =
        remote_search::read_cache_if_active(&cancellation, || cache.get(&key, Instant::now()));

    assert!(guarded.is_ok());
    cancellation.cancel();
    assert!(cancellation.is_cancelled());
}

#[test]
fn provider_load_more_cache_hit_is_linearized_before_a_later_cancellation() {
    let search = SearchKey {
        source: RemoteWallpaperSource::Openverse,
        query: "misty lake".into(),
        credential_revision: None,
        contract_version: CONTRACT_VERSION,
    };
    let key = PageKey {
        search: search.clone(),
        first_page: 2,
    };
    let mut cache = SearchCache::default();
    cache.update_continuation(
        &search,
        Some(ProviderContinuation {
            next_page: 2,
            buffered_items: Vec::new(),
            upstream_has_more: true,
        }),
        Instant::now(),
    );
    cache.insert(
        key.clone(),
        RemoteSearchResult::success("openverse", vec![gallery_item(2)], true, 1),
        None,
        Instant::now(),
    );
    let cancellation = WallpaperSearchCancellation::default();
    let guarded = remote_search::read_cache_if_active(&cancellation, || {
        let continuation = cache.continuation(&search, Instant::now());
        continuation.and_then(|_| cache.get(&key, Instant::now()))
    });

    assert!(guarded.is_ok());
    cancellation.cancel();
    assert!(cancellation.is_cancelled());
}

#[test]
fn overfetched_results_are_paged_before_advancing_upstream() {
    let continuation = ProviderContinuation {
        next_page: 3,
        buffered_items: (0..25).map(gallery_item).collect(),
        upstream_has_more: false,
    };

    let (first, continuation) = take_buffered_page(continuation).expect("first buffered page");
    assert_eq!(first.len(), RESULT_LIMIT);
    assert_eq!(first.first().map(|item| item.id.as_str()), Some("item-0"));
    assert_eq!(first.last().map(|item| item.id.as_str()), Some("item-19"));

    let (second, continuation) = take_buffered_page(continuation.expect("remaining buffered page"))
        .expect("second buffered page");
    assert_eq!(second.len(), 5);
    assert_eq!(second.first().map(|item| item.id.as_str()), Some("item-20"));
    assert!(continuation.is_none());
}

#[test]
fn continuation_cache_is_ttl_bound_lru_and_credential_scoped() {
    let now = Instant::now();
    let mut cache = SearchCache::default();
    for index in 0..=CACHE_CAPACITY {
        cache.update_continuation(
            &SearchKey {
                source: RemoteWallpaperSource::Pexels,
                query: format!("query-{index}"),
                credential_revision: Some(format!("revision-{index}")),
                contract_version: CONTRACT_VERSION,
            },
            Some(ProviderContinuation {
                next_page: 2,
                buffered_items: Vec::new(),
                upstream_has_more: true,
            }),
            now,
        );
    }
    assert_eq!(cache.continuations.len(), CACHE_CAPACITY);
    let evicted = SearchKey {
        source: RemoteWallpaperSource::Pexels,
        query: "query-0".into(),
        credential_revision: Some("revision-0".into()),
        contract_version: CONTRACT_VERSION,
    };
    assert!(cache.continuation(&evicted, now).is_none());

    let newest = SearchKey {
        source: RemoteWallpaperSource::Pexels,
        query: format!("query-{CACHE_CAPACITY}"),
        credential_revision: Some(format!("revision-{CACHE_CAPACITY}")),
        contract_version: CONTRACT_VERSION,
    };
    let changed_credential = SearchKey {
        credential_revision: Some("rotated".into()),
        ..newest.clone()
    };
    assert!(cache.continuation(&changed_credential, now).is_none());
    assert_eq!(
        cache
            .continuation(&newest, now)
            .map(|continuation| continuation.next_page),
        Some(2)
    );
    assert!(cache
        .continuation(&newest, now + CACHE_TTL + Duration::from_secs(1))
        .is_none());
}

#[test]
fn provider_cancel_before_begin_remains_sticky_and_bounded() {
    let now = Instant::now();
    let mut registry = RequestRegistry::default();
    registry.record_pre_cancel("late-provider", now);
    assert!(registry.take_pre_cancel("late-provider", now));
    assert!(!registry.take_pre_cancel("late-provider", now));

    for index in 0..=PRE_CANCEL_CAPACITY {
        registry.record_pre_cancel(&format!("request-{index}"), now);
    }
    assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
    assert!(!registry.take_pre_cancel("request-0", now));
    assert!(!registry.take_pre_cancel("request-1", now + PRE_CANCEL_TTL + Duration::from_secs(1),));
}

#[tokio::test]
async fn concurrent_provider_probes_report_completion_order() {
    let mut output = Vec::new();
    visit_probes_as_completed(
        [("first", 30_u64), ("second", 0_u64), ("third", 5_u64)],
        3,
        Duration::from_millis(100),
        |(name, delay_ms)| async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            name
        },
        |_, item| output.push(item),
    )
    .await;

    assert_eq!(output, ["second", "third", "first"]);
}

#[tokio::test]
async fn provider_probe_concurrency_never_exceeds_the_configured_limit() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let in_flight = Arc::new(AtomicUsize::new(0));
    let max_in_flight = Arc::new(AtomicUsize::new(0));
    let concurrency = 3;
    visit_probes_as_completed(
        0..9,
        concurrency,
        Duration::from_secs(1),
        {
            let in_flight = Arc::clone(&in_flight);
            let max_in_flight = Arc::clone(&max_in_flight);
            move |item| {
                let in_flight = Arc::clone(&in_flight);
                let max_in_flight = Arc::clone(&max_in_flight);
                async move {
                    let current = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    max_in_flight.fetch_max(current, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                    item
                }
            }
        },
        |_, _| {},
    )
    .await;

    assert_eq!(max_in_flight.load(Ordering::SeqCst), concurrency);
    assert_eq!(in_flight.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn slow_first_probe_does_not_hide_later_fast_successes() {
    let mut output = Vec::new();
    visit_probes_as_completed(
        [("first", 200_u64), ("second", 1_u64), ("third", 5_u64)],
        3,
        Duration::from_millis(40),
        |(name, delay_ms)| async move {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            name
        },
        |_, item| output.push(item),
    )
    .await;

    assert_eq!(output, ["second", "third"]);
}

#[tokio::test]
async fn validation_reports_fast_batch_before_slow_first_probe() {
    let cancellation = WallpaperSearchCancellation::default();
    let (batch_tx, mut batch_rx) = tokio::sync::mpsc::unbounded_channel();
    let runtime = RemoteSearchRuntime::new(
        cancellation,
        Arc::new(|_| {}),
        Arc::new(move |batch| {
            let _ = batch_tx.send(batch);
        }),
    );
    let channels = (0..5)
        .map(|_| tokio::sync::oneshot::channel::<()>())
        .collect::<Vec<_>>();
    let (senders, receivers): (Vec<_>, Vec<_>) = channels.into_iter().unzip();
    let mut senders = senders.into_iter().map(Some).collect::<Vec<_>>();
    let partial = ProviderPartialResults::new(1);
    let validation = validate_probe_outputs(
        receivers.into_iter().enumerate(),
        5,
        Duration::from_secs(5),
        &runtime,
        &partial,
        |(index, ready)| async move {
            ready.await.ok()?;
            Some(gallery_item(index))
        },
    );
    tokio::pin!(validation);

    for sender in senders.iter_mut().skip(1) {
        sender.take().expect("fast sender").send(()).unwrap();
    }
    let first_batch = tokio::select! {
        batch = batch_rx.recv() => batch.expect("first progress batch"),
        result = &mut validation => panic!("validation finished before slow head: {result:?}"),
        _ = tokio::time::sleep(Duration::from_secs(1)) => {
            panic!("first progress batch waited for the slow head")
        },
    };

    assert_eq!(first_batch.items.len(), 4);
    assert!(!first_batch.done);
    assert!(first_batch.items.iter().all(|item| item.id != "item-0"));
    senders[0]
        .take()
        .expect("slow head sender")
        .send(())
        .unwrap();
    let items = validation.await.expect("validation result");
    assert_eq!(
        items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-0", "item-1", "item-2", "item-3", "item-4"]
    );
}

#[tokio::test]
async fn all_slow_probes_stop_at_the_validation_budget() {
    let started = Instant::now();
    let mut output = Vec::new();
    visit_probes_as_completed(
        [1_u8, 2, 3, 4],
        2,
        Duration::from_millis(30),
        |value| async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            value
        },
        |_, item| output.push(item),
    )
    .await;

    assert!(output.is_empty());
    assert!(
        started.elapsed() < Duration::from_millis(500),
        "elapsed={:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn validation_reports_first_batch_before_slow_tail_finishes() {
    let cancellation = WallpaperSearchCancellation::default();
    let (batch_tx, mut batch_rx) = tokio::sync::mpsc::unbounded_channel();
    let runtime = RemoteSearchRuntime::new(
        cancellation,
        Arc::new(|_| {}),
        Arc::new(move |batch| {
            let _ = batch_tx.send(batch);
        }),
    );
    let channels = (0..5)
        .map(|_| tokio::sync::oneshot::channel::<()>())
        .collect::<Vec<_>>();
    let (mut senders, receivers): (Vec<_>, Vec<_>) = channels.into_iter().unzip();
    let partial = ProviderPartialResults::new(1);
    let validation = validate_probe_outputs(
        receivers.into_iter().enumerate(),
        5,
        Duration::from_secs(5),
        &runtime,
        &partial,
        |(index, ready)| async move {
            ready.await.ok()?;
            Some(gallery_item(index))
        },
    );
    tokio::pin!(validation);

    for sender in senders.drain(..4) {
        sender.send(()).expect("release leading probe");
    }
    let first_batch = tokio::select! {
        batch = batch_rx.recv() => batch.expect("first progress batch"),
        result = &mut validation => panic!("validation finished before tail: {result:?}"),
        _ = tokio::time::sleep(Duration::from_secs(1)) => {
            panic!("first progress batch waited for the slow tail")
        },
    };

    assert_eq!(first_batch.batch_index, 1);
    assert_eq!(first_batch.accumulated_count, 4);
    assert!(!first_batch.done);
    assert_eq!(
        first_batch
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-0", "item-1", "item-2", "item-3"]
    );

    senders
        .pop()
        .expect("tail sender")
        .send(())
        .expect("release tail probe");
    let items = validation.await.expect("validation result");
    assert_eq!(
        items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-0", "item-1", "item-2", "item-3", "item-4"]
    );

    let final_batch = tokio::time::timeout(Duration::from_secs(1), batch_rx.recv())
        .await
        .expect("final batch timeout")
        .expect("final batch");
    assert_eq!(final_batch.batch_index, 2);
    assert_eq!(final_batch.accumulated_count, 5);
    assert!(final_batch.done);
    assert_eq!(
        final_batch
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-4"]
    );
    assert!(batch_rx.try_recv().is_err());
}

#[tokio::test]
async fn validation_deduplicates_in_order_and_caps_progress_at_result_limit() {
    let cancellation = WallpaperSearchCancellation::default();
    let batches = Arc::new(Mutex::new(Vec::new()));
    let reported_batches = Arc::clone(&batches);
    let runtime = RemoteSearchRuntime::new(
        cancellation,
        Arc::new(|_| {}),
        Arc::new(move |batch| reported_batches.lock().push(batch)),
    );
    let mut unique = (0..=RESULT_LIMIT).map(gallery_item).collect::<Vec<_>>();
    unique[2].media_fingerprint = Some("same-media".into());
    let mut duplicate_url = gallery_item(100);
    duplicate_url.full_url = unique[1].full_url.clone();
    let mut duplicate_fingerprint = gallery_item(101);
    duplicate_fingerprint.media_fingerprint = Some("same-media".into());
    let mut probes = Vec::new();
    for (index, item) in unique.into_iter().enumerate() {
        probes.push(item);
        if index == 1 {
            probes.push(duplicate_url.clone());
        } else if index == 2 {
            probes.push(duplicate_fingerprint.clone());
        }
    }

    let items = validate_probe_outputs(
        probes,
        MAX_CONCURRENT_PROBES,
        Duration::from_secs(1),
        &runtime,
        &ProviderPartialResults::new(1),
        |item| std::future::ready(Some(item)),
    )
    .await
    .expect("validation result");

    assert_eq!(items.len(), RESULT_LIMIT + 1);
    assert_eq!(
        items.iter().map(|item| item.id.clone()).collect::<Vec<_>>(),
        (0..=RESULT_LIMIT)
            .map(|index| format!("item-{index}"))
            .collect::<Vec<_>>()
    );
    let batches = batches.lock();
    assert_eq!(batches.iter().filter(|batch| batch.done).count(), 1);
    assert!(batches.last().is_some_and(|batch| batch.done));
    assert_eq!(
        batches
            .iter()
            .flat_map(|batch| batch.items.iter())
            .map(|item| item.id.clone())
            .collect::<Vec<_>>(),
        (0..RESULT_LIMIT)
            .map(|index| format!("item-{index}"))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn validation_cancellation_returns_cancelled_without_final_batch() {
    let cancellation = WallpaperSearchCancellation::default();
    let batches = Arc::new(Mutex::new(Vec::new()));
    let reported_batches = Arc::clone(&batches);
    let runtime = RemoteSearchRuntime::new(
        cancellation.clone(),
        Arc::new(|_| {}),
        Arc::new(move |batch| reported_batches.lock().push(batch)),
    );
    cancellation.cancel();

    let result = validate_probe_outputs(
        [()],
        1,
        Duration::from_secs(5),
        &runtime,
        &ProviderPartialResults::new(1),
        |_| std::future::pending::<Option<WallpaperGalleryItem>>(),
    )
    .await;

    assert!(matches!(result, Err(ProviderError::Cancelled)));
    assert!(batches.lock().is_empty());
}

#[tokio::test]
async fn validation_cancellation_after_progress_omits_final_batch() {
    let cancellation = WallpaperSearchCancellation::default();
    let (batch_tx, mut batch_rx) = tokio::sync::mpsc::unbounded_channel();
    let runtime = RemoteSearchRuntime::new(
        cancellation.clone(),
        Arc::new(|_| {}),
        Arc::new(move |batch| {
            let _ = batch_tx.send(batch);
        }),
    );
    let channels = (0..5)
        .map(|_| tokio::sync::oneshot::channel::<()>())
        .collect::<Vec<_>>();
    let (mut senders, receivers): (Vec<_>, Vec<_>) = channels.into_iter().unzip();
    let partial = ProviderPartialResults::new(1);
    let validation = validate_probe_outputs(
        receivers.into_iter().enumerate(),
        5,
        Duration::from_secs(5),
        &runtime,
        &partial,
        |(index, ready)| async move {
            ready.await.ok()?;
            Some(gallery_item(index))
        },
    );
    tokio::pin!(validation);

    for sender in senders.drain(..4) {
        sender.send(()).expect("release leading probe");
    }
    let first_batch = tokio::select! {
        batch = batch_rx.recv() => batch.expect("first progress batch"),
        result = &mut validation => panic!("validation finished before tail: {result:?}"),
        _ = tokio::time::sleep(Duration::from_secs(1)) => panic!("first batch timeout"),
    };
    assert!(!first_batch.done);

    cancellation.cancel();
    assert!(matches!(validation.await, Err(ProviderError::Cancelled)));
    assert!(batch_rx.try_recv().is_err());
}

#[tokio::test]
async fn provider_operation_timeout_is_classified() {
    let cancellation = WallpaperSearchCancellation::default();
    let result = with_provider_deadline(
        &cancellation,
        Duration::from_millis(20),
        std::future::pending::<Result<(), ProviderError>>(),
    )
    .await;

    assert_eq!(result, Err(ProviderError::Timeout));
}

#[test]
fn provider_timeout_recovers_validated_items_and_closes_progress() {
    let partial = ProviderPartialResults::new(2);
    partial.begin_batch(4, true);
    for index in 0..5 {
        partial.record(index, gallery_item(index));
    }
    partial.mark_batch_emitted(1);

    let recovered = partial
        .recover_timeout_page()
        .expect("validated progress should survive the provider deadline");

    assert_eq!(
        recovered
            .page
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-0", "item-1", "item-2", "item-3", "item-4"]
    );
    assert_eq!(recovered.page.next_page, 4);
    assert!(recovered.page.upstream_has_more);
    assert_eq!(recovered.terminal_batch_index, 2);
}

#[tokio::test]
async fn provider_deadline_keeps_reported_progress_and_emits_a_terminal_batch() {
    let cancellation = WallpaperSearchCancellation::default();
    let batches = Arc::new(Mutex::new(Vec::new()));
    let reported_batches = Arc::clone(&batches);
    let runtime = RemoteSearchRuntime::new(
        cancellation.clone(),
        Arc::new(|_| {}),
        Arc::new(move |batch| reported_batches.lock().push(batch)),
    );
    let partial = ProviderPartialResults::new(2);
    partial.begin_batch(4, true);
    for index in 0..4 {
        partial.record(index, gallery_item(index));
    }
    partial.mark_batch_emitted(1);
    runtime.report_batch(RemoteSearchBatch {
        batch_index: 1,
        items: (0..4).map(gallery_item).collect(),
        accumulated_count: 4,
        done: false,
    });

    let timed_out = with_provider_deadline(
        &cancellation,
        Duration::from_millis(20),
        std::future::pending::<Result<ValidatedPage, ProviderError>>(),
    )
    .await;
    let recovered = recover_provider_timeout(timed_out, &partial, &runtime)
        .expect("reported validated items should survive the outer deadline");

    assert_eq!(
        recovered
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["item-0", "item-1", "item-2", "item-3"]
    );
    assert!(recovered.has_more());
    let batches = batches.lock();
    assert_eq!(batches.len(), 2);
    assert!(!batches[0].done);
    assert!(batches[1].done);
    assert_eq!(batches[1].batch_index, 2);
    assert_eq!(batches[1].accumulated_count, 4);
    assert!(batches[1].items.is_empty());
}

#[test]
fn replacement_provider_request_cancels_the_previous_generation() {
    let (_first_token, first) = begin_request("first-provider");
    let (second_token, second) = begin_request("second-provider");
    assert!(first.is_cancelled());
    assert!(!second.is_cancelled());
    finish_request("second-provider", second_token);
}
