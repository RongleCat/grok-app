use super::*;
use serde_json::json;

fn item(source_url: &str, full_url: &str, width: u32) -> WallpaperGalleryItem {
    item_with_fingerprint(source_url, full_url, width, opaque_id(full_url))
}

fn credential_revision(value: u64) -> account::BuildOauthCredentialRevision {
    account::BuildOauthCredentialRevision::for_test(value, Some(value.into()), value as u8)
}

fn item_with_fingerprint(
    source_url: &str,
    full_url: &str,
    width: u32,
    media_fingerprint: String,
) -> WallpaperGalleryItem {
    WallpaperGalleryItem {
        id: format!("web-{}", &media_fingerprint[..24]),
        thumb_url: full_url.into(),
        full_url: full_url.into(),
        kind: "image".into(),
        width: Some(width),
        height: Some(600),
        source: SOURCE.into(),
        username: None,
        post_url: None,
        text_preview: None,
        likes: None,
        local_path: None,
        prompt: None,
        provenance: WallpaperProvenance {
            source_url: Some(source_url.into()),
            source_name: Some("example.test".into()),
            author_name: None,
            author_url: None,
            license: None,
            license_url: None,
        },
        status_id: None,
        media_index: None,
        media_quality: None,
        media_fingerprint: Some(media_fingerprint),
    }
}

fn item_with_title(
    source_url: &str,
    full_url: &str,
    width: u32,
    title: &str,
) -> WallpaperGalleryItem {
    let mut item = item(source_url, full_url, width);
    item.text_preview = Some(title.into());
    item
}

fn item_with_title_and_dimensions(
    source_url: &str,
    full_url: &str,
    width: u32,
    height: u32,
    title: &str,
) -> WallpaperGalleryItem {
    let mut item = item_with_title(source_url, full_url, width, title);
    item.height = Some(height);
    item
}

#[test]
fn fixed_request_bounds_web_tool_calls_and_never_accepts_an_endpoint() {
    let request = responses_request("misty mountains", &[], 1);
    assert_eq!(request["model"], wallpaper_responses_client::MODEL);
    assert_eq!(request["tools"][0]["type"], "web_search");
    assert_eq!(request["max_tool_calls"], INITIAL_MAX_WEB_SEARCH_CALLS);
    assert_eq!(request["store"], false);
    assert_eq!(
        request["text"]["format"]["schema"]["properties"]["pages"]["maxItems"],
        INITIAL_PAGES_PER_LANE
    );
    const {
        assert!(INITIAL_PAGES_PER_LANE * LANE_COUNT >= MAX_RESULTS);
        assert!(INITIAL_PAGES_PER_LANE * (LANE_COUNT - 1) < MAX_RESULTS);
    }
    assert!(request.get("endpoint").is_none());
    assert_eq!(request["text"]["format"]["schema"]["required"][0], "pages");
    assert!(
        responses_prompt("misty mountains", &[], 1).contains(&format!(
            "use at most {INITIAL_MAX_WEB_SEARCH_CALLS} calls total"
        ))
    );
    let bilingual = responses_prompt("极光雪山湖泊", &[], 2);
    assert!(bilingual.contains("translate the topic into concise English"));
    assert!(bilingual.contains("watermarked or paid-stock previews"));
    assert!(responses_prompt("misty mountains", &[], 3).contains("Visual diversity lane"));
    let load_more = responses_request("misty mountains", &[], LANE_COUNT + 1);
    assert_eq!(load_more["max_tool_calls"], LOAD_MORE_MAX_WEB_SEARCH_CALLS);
    assert_eq!(
        load_more["text"]["format"]["schema"]["properties"]["pages"]["maxItems"],
        LOAD_MORE_PAGES_PER_LANE
    );
    let load_more_prompt = responses_prompt("misty mountains", &[], LANE_COUNT + 1);
    assert!(load_more_prompt.contains("Load-more lane"));
    assert!(load_more_prompt.contains(&format!(
        "use at most {LOAD_MORE_MAX_WEB_SEARCH_CALLS} calls total"
    )));
    assert!(load_more_prompt.contains(&format!(
        "have {LOAD_MORE_PAGES_PER_LANE} distinct source pages"
    )));
}

#[test]
fn load_more_exclusions_are_bounded_hosts_without_url_secrets() {
    let exclusions = source_page_exclusions([
        "https://www.photos.test/gallery/aurora/?token=private#preview",
        "https://photos.test/gallery/aurora/",
        "https://museum.test/exhibits/night-sky?tracking=discard",
        "https://vault.test/share/capability-token/image.jpg",
        "http://insecure.test/page",
        "https://user:password@blocked.test/page",
    ]);
    assert_eq!(
        exclusions,
        vec![
            "photos.test".to_string(),
            "museum.test".to_string(),
            "vault.test".to_string(),
        ]
    );

    let prompt = responses_prompt("night sky", &exclusions, LANE_COUNT + 1);
    assert!(prompt.contains("Previously shown source sites"));
    assert!(prompt.contains("photos.test"));
    assert!(prompt.contains("museum.test"));
    assert!(prompt.contains("vault.test"));
    assert!(!prompt.contains("gallery/aurora"));
    assert!(!prompt.contains("exhibits/night-sky"));
    assert!(!prompt.contains("capability-token"));
    assert!(!prompt.contains("private"));
    assert!(!prompt.contains("tracking"));
    assert!(!prompt.contains("Opaque source ids"));

    let many = (0..MAX_SOURCE_EXCLUSIONS + 5)
        .map(|index| format!("https://photos-{index}.test/{}/image", "secret/".repeat(20)))
        .collect::<Vec<_>>();
    let bounded = source_page_exclusions(many.iter().map(String::as_str));
    assert_eq!(bounded.len(), MAX_SOURCE_EXCLUSIONS);
    assert!(bounded
        .iter()
        .all(|identity| identity.chars().count() <= MAX_SOURCE_EXCLUSION_CHARS));
}

#[test]
fn source_discovery_keeps_a_minimum_budget_after_a_slow_response() {
    assert_eq!(
        source_discovery_budget(Duration::from_secs(54)),
        MIN_SOURCE_DISCOVERY_TIMEOUT
    );
    assert_eq!(
        source_discovery_budget(Duration::from_secs(40)),
        MIN_SOURCE_DISCOVERY_TIMEOUT
    );
}

#[test]
fn source_discovery_uses_remaining_lane_time_before_its_cap() {
    assert_eq!(
        source_discovery_budget(Duration::from_secs(30)),
        Duration::from_secs(25)
    );
    assert_eq!(
        source_discovery_budget(Duration::from_secs(10)),
        SOURCE_DISCOVERY_TIMEOUT
    );
}

#[test]
fn source_page_parser_rejects_insecure_userinfo_and_duplicates() {
    let pages = parse_source_pages(
        &json!({
            "pages": [
                {"url":"http://example.test/a"},
                {"url":"https://u:p@example.test/a"},
                {"url":"https://example.test/a", "title":" A  page "},
                {"url":"https://example.test/a"},
                {"url":"https://example.test/b"}
            ]
        }),
        INITIAL_PAGES_PER_LANE,
    );
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].title.as_deref(), Some("A page"));
}

#[test]
fn tolerates_bounded_provider_overrun_and_rejects_the_hard_boundary() {
    let call = || json!({ "type": "web_search_call", "status": "completed" });
    let initial = lane_budget(1);
    assert_eq!(
        validate_web_search_tool_calls(&[call()], initial.max_observed_tool_calls),
        Ok(1)
    );
    let mut calls = (0..initial.requested_tool_calls)
        .map(|_| call())
        .collect::<Vec<_>>();
    assert_eq!(
        validate_web_search_tool_calls(&calls, initial.max_observed_tool_calls),
        Ok(initial.requested_tool_calls)
    );
    assert_eq!(
        validate_web_search_tool_calls(&[], initial.max_observed_tool_calls),
        Err((ErrorKind::ToolNotCalled, 0))
    );
    calls.extend((initial.requested_tool_calls..initial.max_observed_tool_calls).map(|_| call()));
    assert_eq!(
        validate_web_search_tool_calls(&calls, initial.max_observed_tool_calls),
        Ok(initial.max_observed_tool_calls)
    );
    calls.push(call());
    assert_eq!(
        validate_web_search_tool_calls(&calls, initial.max_observed_tool_calls),
        Err((
            ErrorKind::ToolBudgetExceeded,
            initial.max_observed_tool_calls + 1
        ))
    );

    let continuation = lane_budget(LANE_COUNT + 1);
    assert_eq!(continuation.pages, LOAD_MORE_PAGES_PER_LANE);
    assert_eq!(
        continuation.max_observed_tool_calls,
        LOAD_MORE_MAX_WEB_SEARCH_CALLS * OBSERVED_TOOL_CALL_MULTIPLIER
    );
}

#[test]
fn merge_keeps_existing_order_and_ranks_only_the_new_batch() {
    let merged = merge_items(
        vec![
            item("https://one.test/page", "https://cdn.test/one.jpg", 1000),
            item("https://zero.test/page", "https://cdn.test/zero.jpg", 900),
        ],
        vec![
            item("https://one.test/page", "https://cdn.test/other.jpg", 2000),
            item("https://two.test/page", "https://cdn.test/one.jpg", 2200),
            item(
                "https://three.test/page",
                "https://cdn.test/three.jpg",
                1800,
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 4);
    assert_eq!(
        merged[0].provenance.source_url.as_deref(),
        Some("https://one.test/page")
    );
    assert_eq!(
        merged[1].provenance.source_url.as_deref(),
        Some("https://zero.test/page")
    );
    assert_eq!(
        merged[2].provenance.source_url.as_deref(),
        Some("https://one.test/page")
    );
    assert_eq!(
        merged[3].provenance.source_url.as_deref(),
        Some("https://three.test/page")
    );
}

#[test]
fn merge_keeps_at_most_two_distinct_images_per_source_page() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item("https://one.test/page", "https://cdn.test/one.jpg", 1800),
            item("https://one.test/page", "https://cdn.test/two.jpg", 1700),
            item("https://one.test/page", "https://cdn.test/three.jpg", 1600),
        ],
        10,
    );
    assert_eq!(merged.len(), MAX_IMAGES_PER_SOURCE_PAGE);
    assert_eq!(merged[0].full_url, "https://cdn.test/one.jpg");
    assert_eq!(merged[1].full_url, "https://cdn.test/two.jpg");
}

#[test]
fn merge_ranks_a_fresh_lane_by_image_area() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item("https://small.test/page", "https://cdn.test/small.jpg", 900),
            item(
                "https://large.test/page",
                "https://cdn.test/large.jpg",
                1800,
            ),
        ],
        10,
    );
    assert_eq!(
        merged[0].provenance.source_url.as_deref(),
        Some("https://large.test/page")
    );
}

#[test]
fn rejected_media_duplicate_does_not_reserve_its_source() {
    let merged = merge_items(
        vec![item(
            "https://one.test/page",
            "https://cdn.test/shared.jpg",
            1000,
        )],
        vec![
            item("https://two.test/page", "https://cdn.test/shared.jpg", 2000),
            item("https://two.test/page", "https://cdn.test/two.jpg", 1800),
        ],
        10,
    );
    assert_eq!(merged.len(), 2);
    assert!(merged
        .iter()
        .any(|item| item.full_url == "https://cdn.test/two.jpg"));
}

#[test]
fn merge_deduplicates_identical_content_across_different_urls() {
    let fingerprint = opaque_id("same image bytes");
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_fingerprint(
                "https://one.test/page",
                "https://one.cdn.test/image.jpg?width=1920",
                1920,
                fingerprint.clone(),
            ),
            item_with_fingerprint(
                "https://two.test/page",
                "https://two.cdn.test/render?id=42",
                1600,
                fingerprint,
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 1);
}

#[test]
fn merge_deduplicates_cdn_resize_and_recompression_variants() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_fingerprint(
                "https://photos.test/page-a",
                "https://cdn.test/gallery/mountain-1920x1080.jpg?width=1920&quality=90&id=42",
                1920,
                opaque_id("large recompression"),
            ),
            item_with_fingerprint(
                "https://photos.test/page-b",
                "https://cdn.test/gallery/mountain-1280x720.jpg?id=42&w=1280&q=75",
                1280,
                opaque_id("small recompression"),
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].width, Some(1920));
}

#[test]
fn merge_deduplicates_known_alphacoders_thumbnail_variants() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_fingerprint(
                "https://wall.alphacoders.com/big.php?i=123456",
                "https://images8.alphacoders.com/123/123456.jpg",
                1920,
                opaque_id("alphacoders original"),
            ),
            item_with_fingerprint(
                "https://wall.alphacoders.com/featured.php?id=123456",
                "https://images.alphacoders.com/123/thumb-1920-123456.jpg",
                1600,
                opaque_id("alphacoders thumbnail"),
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 1);
}

#[test]
fn merge_deduplicates_same_site_recompression_with_the_same_title() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_title(
                "https://photos.test/gallery/aurora-a",
                "https://cdn-a.test/render/first.jpg",
                1600,
                "  Aurora over the mountain lake  ",
            ),
            item_with_title(
                "https://www.photos.test/gallery/aurora-b",
                "https://cdn-b.test/render/second.webp",
                1920,
                "aurora   over the MOUNTAIN lake",
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].width, Some(1920));
}

#[test]
fn merge_keeps_the_same_title_from_different_sites() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_title(
                "https://one.test/gallery/aurora",
                "https://one.cdn.test/aurora.jpg",
                1920,
                "Aurora over the mountain lake",
            ),
            item_with_title(
                "https://two.test/gallery/aurora",
                "https://two.cdn.test/aurora.jpg",
                1800,
                "Aurora over the mountain lake",
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 2);
}

#[test]
fn merge_deduplicates_same_page_title_and_near_identical_shape() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora#preview",
                "https://cdn.test/aurora-large.jpg",
                1920,
                1080,
                "Aurora over the mountain lake",
            ),
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora",
                "https://cdn.test/aurora-recompressed.webp",
                1280,
                730,
                "Aurora over the mountain lake",
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].width, Some(1920));
}

#[test]
fn merge_keeps_two_different_shapes_from_one_titled_source_page() {
    let merged = merge_items(
        Vec::new(),
        vec![
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora",
                "https://cdn.test/aurora-wide.jpg",
                1920,
                1080,
                "Aurora over the mountain lake",
            ),
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora",
                "https://cdn.test/aurora-vertical.jpg",
                1080,
                1920,
                "Aurora over the mountain lake",
            ),
        ],
        10,
    );
    assert_eq!(merged.len(), MAX_IMAGES_PER_SOURCE_PAGE);
}

#[test]
fn load_more_rejects_a_same_site_title_from_another_source_page() {
    let existing = vec![item_with_title(
        "https://photos.test/gallery/aurora-a",
        "https://cdn-a.test/aurora.jpg",
        1920,
        "Aurora over the mountain lake",
    )];
    let fresh = new_items(
        &existing,
        vec![item_with_title(
            "https://photos.test/gallery/aurora-b",
            "https://cdn-b.test/aurora.webp",
            1600,
            "Aurora over the mountain lake",
        )],
    );
    assert!(fresh.is_empty());
}

#[test]
fn load_more_applies_same_page_title_and_shape_deduplication() {
    let existing = vec![item_with_title_and_dimensions(
        "https://photos.test/gallery/aurora#first",
        "https://cdn.test/aurora-original.jpg",
        1920,
        1080,
        "Aurora over the mountain lake",
    )];
    let fresh = new_items(
        &existing,
        vec![
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora",
                "https://cdn.test/aurora-recompressed.webp",
                1280,
                720,
                "Aurora over the mountain lake",
            ),
            item_with_title_and_dimensions(
                "https://photos.test/gallery/aurora",
                "https://cdn.test/aurora-portrait.webp",
                900,
                1200,
                "Aurora over the mountain lake",
            ),
        ],
    );
    assert_eq!(fresh.len(), 1);
    assert_eq!(fresh[0].full_url, "https://cdn.test/aurora-portrait.webp");
}

#[test]
fn variant_identity_keeps_semantic_query_parameters() {
    let first = item(
        "https://one.test/page",
        "https://cdn.test/render?id=42&w=1920",
        1920,
    );
    let second = item(
        "https://two.test/page",
        "https://cdn.test/render?id=43&w=1920",
        1920,
    );
    assert_ne!(
        media_variant_identity(&first),
        media_variant_identity(&second)
    );
    assert_eq!(merge_items(Vec::new(), vec![first, second], 10).len(), 2);
}

#[test]
fn cache_expires_and_preserves_safe_result_only() {
    let key = CacheKey {
        query: "mountains".into(),
        credential_revision: credential_revision(1),
        contract_version: CACHE_CONTRACT_VERSION,
    };
    let result = RemoteSearchResult::success(
        SOURCE,
        vec![item(
            "https://one.test/page",
            "https://cdn.test/one.jpg",
            1200,
        )],
        true,
        10,
    );
    let now = Instant::now();
    let mut cache = SearchCache::default();
    cache.insert(key.clone(), result, now);
    assert!(cache
        .get_initial(&key, now + Duration::from_secs(1))
        .is_some());
    assert_eq!(
        cache
            .continuation(&key, now + Duration::from_secs(1))
            .map(|items| items.len()),
        Some(1)
    );
    assert!(cache
        .continuation(&key, now + CACHE_TTL + Duration::from_secs(1))
        .is_none());
}

#[test]
fn web_initial_cache_hit_is_linearized_before_a_later_cancellation() {
    let key = CacheKey {
        query: "mountains".into(),
        credential_revision: credential_revision(1),
        contract_version: CACHE_CONTRACT_VERSION,
    };
    let mut cache = SearchCache::default();
    cache.insert(
        key.clone(),
        RemoteSearchResult::success(SOURCE, vec![], false, 1),
        Instant::now(),
    );
    let cancellation = WallpaperSearchCancellation::default();
    let guarded = remote_search::read_cache_if_active(&cancellation, || {
        cache.get_initial(&key, Instant::now())
    });

    assert!(guarded.is_ok());
    cancellation.cancel();
    assert!(cancellation.is_cancelled());
}

#[test]
fn web_cache_rejects_same_metadata_with_a_different_credential_tag() {
    let first = CacheKey {
        query: "mountains".into(),
        credential_revision: account::BuildOauthCredentialRevision::for_test(10, Some(20), 1),
        contract_version: CACHE_CONTRACT_VERSION,
    };
    let replacement = CacheKey {
        credential_revision: account::BuildOauthCredentialRevision::for_test(10, Some(20), 2),
        ..first.clone()
    };
    let mut cache = SearchCache::default();
    cache.insert(
        first,
        RemoteSearchResult::success(SOURCE, vec![], false, 1),
        Instant::now(),
    );

    assert!(cache.get_initial(&replacement, Instant::now()).is_none());
}

#[test]
fn cache_bounds_continuations_with_the_same_lru_and_contract_version() {
    let now = Instant::now();
    let mut cache = SearchCache::default();
    for index in 0..=CACHE_CAPACITY {
        let key = CacheKey {
            query: format!("query-{index}"),
            credential_revision: credential_revision(1),
            contract_version: CACHE_CONTRACT_VERSION,
        };
        cache.insert(
            key,
            RemoteSearchResult::success(
                SOURCE,
                vec![item(
                    "https://one.test/page",
                    &format!("https://cdn.test/{index}.jpg"),
                    1200,
                )],
                true,
                10,
            ),
            now,
        );
    }
    assert_eq!(cache.entries.len(), CACHE_CAPACITY);
    let evicted = CacheKey {
        query: "query-0".into(),
        credential_revision: credential_revision(1),
        contract_version: CACHE_CONTRACT_VERSION,
    };
    assert!(cache.continuation(&evicted, now).is_none());
}

#[test]
fn cancel_before_begin_remains_sticky_and_bounded() {
    let now = Instant::now();
    let mut registry = RequestRegistry::default();
    registry.record_pre_cancel("late-search", now);
    assert!(registry.take_pre_cancel("late-search", now));
    assert!(!registry.take_pre_cancel("late-search", now));

    for index in 0..=PRE_CANCEL_CAPACITY {
        registry.record_pre_cancel(&format!("request-{index}"), now);
    }
    assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
    assert!(!registry.take_pre_cancel("request-0", now));
    assert!(!registry.take_pre_cancel("request-1", now + PRE_CANCEL_TTL + Duration::from_secs(1),));
}

#[test]
fn replacement_request_cancels_previous_generation() {
    let (_first_token, first) = begin_request("first");
    let (second_token, second) = begin_request("second");
    assert!(first.is_cancelled());
    assert!(!second.is_cancelled());
    finish_request("second", second_token);
}
