use super::*;

#[tokio::test]
async fn first_success_uses_fastest_route_and_survives_one_failure() {
    let (value, route) = first_success(
        std::future::pending::<Result<u8, String>>(),
        std::future::ready(Ok(7)),
    )
    .await
    .unwrap();
    assert_eq!(value, 7);
    assert_eq!(route, AlbumFetchRoute::Host);

    let (value, route) = first_success(
        std::future::ready(Err("webview failed".to_string())),
        std::future::ready(Ok(9)),
    )
    .await
    .unwrap();
    assert_eq!(value, 9);
    assert_eq!(route, AlbumFetchRoute::Host);
}

fn capability_label_matches(pattern: &str, label: &str) -> bool {
    assert!(
        !pattern.chars().any(|c| matches!(c, '[' | ']' | '{' | '}')),
        "complex capability label patterns require an album security review: {pattern}"
    );
    let pattern = pattern.as_bytes();
    let label = label.as_bytes();
    let mut previous = vec![false; label.len() + 1];
    previous[0] = true;
    for token in pattern {
        let mut current = vec![false; label.len() + 1];
        if *token == b'*' {
            current[0] = previous[0];
            for index in 1..=label.len() {
                current[index] = previous[index] || current[index - 1];
            }
        } else {
            for index in 1..=label.len() {
                current[index] = previous[index - 1]
                    && (*token == b'?' || token.eq_ignore_ascii_case(&label[index - 1]));
            }
        }
        previous = current;
    }
    previous[label.len()]
}

#[test]
fn navigation_is_https_and_first_party_or_supported_auth_only() {
    for allowed in [
        "https://grok.com/imagine/saved",
        "https://accounts.x.ai/sign-in",
        "https://x.com/i/oauth2/authorize",
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://appleid.apple.com/auth/authorize",
    ] {
        assert!(is_allowed_album_navigation(&Url::parse(allowed).unwrap()));
    }
    for denied in [
        "http://grok.com/imagine/saved",
        "https://grok.com.evil.example/imagine/saved",
        "https://user@grok.com/imagine/saved",
        "https://example.com/",
    ] {
        assert!(!is_allowed_album_navigation(&Url::parse(denied).unwrap()));
    }
}

#[test]
fn saved_page_requires_the_rendered_app_shell() {
    let saved = Url::parse("https://grok.com/imagine/saved").unwrap();
    assert_eq!(
        classify_page(&saved, "complete", false, false, "waiting"),
        GrokAlbumStatus::Loading
    );
    assert_eq!(
        classify_page(&saved, "complete", true, false, "ready"),
        GrokAlbumStatus::Ready
    );
    assert_eq!(
        classify_page(&saved, "loading", false, false, "waiting"),
        GrokAlbumStatus::Loading
    );
    assert_eq!(
        classify_page(&saved, "complete", false, true, "waiting"),
        GrokAlbumStatus::Verification
    );
    assert_eq!(
        classify_page(&saved, "complete", false, false, "challenge"),
        GrokAlbumStatus::Verification
    );
    assert_eq!(
        classify_page(&saved, "complete", false, false, "redirecting"),
        GrokAlbumStatus::SignIn
    );
}

#[test]
fn media_bridge_strips_unapproved_query_values_and_rejects_other_assets() {
    let safe = sanitize_media_url(
        "https://assets.grok.com/users/test/generated/fake/image.jpg?width=2048&cache=1&token=secret#x",
    )
    .unwrap();
    assert!(safe.contains("width=2048"));
    assert!(safe.contains("cache=1"));
    assert!(!safe.contains("token"));
    assert!(!safe.contains('#'));
    assert!(sanitize_media_url("https://assets.grok.com/users/test/avatar.jpg").is_none());
    assert!(sanitize_media_url("https://evil.example/generated/image.jpg").is_none());
    let oversized = format!(
        "https://assets.grok.com/users/test/generated/{}/image.jpg",
        "x".repeat(MAX_MEDIA_URL_LENGTH)
    );
    assert!(sanitize_media_url(&oversized).is_none());
}

#[test]
fn blob_video_uses_an_allowlisted_poster_anchor_without_serializing_bridge_state() {
    let poster = "https://assets.grok.com/users/test/generated/video/poster.jpg";
    let item = sanitize_raw_item(RawAlbumMedia {
        media_url: poster.to_string(),
        thumbnail_url: Some(poster.to_string()),
        kind: "video".to_string(),
        webview_only: true,
        ..RawAlbumMedia::default()
    })
    .expect("blob-backed video anchor should pass validation");
    assert!(item.webview_only);
    let serialized = serde_json::to_string(&item).unwrap();
    assert!(!serialized.contains("webviewOnly"));
    assert!(!serialized.contains("blob:"));

    assert!(sanitize_raw_item(RawAlbumMedia {
        media_url: poster.to_string(),
        thumbnail_url: Some(poster.to_string()),
        kind: "image".to_string(),
        webview_only: true,
        ..RawAlbumMedia::default()
    })
    .is_none());
}

#[test]
fn closed_window_forgets_in_memory_album_items() {
    clear_cache();
    assert_eq!(
        merge_cache(vec![
            GrokAlbumMedia {
                media_url: "https://assets.grok.com/users/test/generated/fake/image.jpg?width=1024"
                    .to_string(),
                thumbnail_url: None,
                kind: "image".to_string(),
                width: None,
                height: None,
                created_at: None,
                post_id: None,
                webview_only: false,
            },
            GrokAlbumMedia {
                media_url: "https://assets.grok.com/users/test/generated/fake/image.jpg?width=2048"
                    .to_string(),
                thumbnail_url: None,
                kind: "image".to_string(),
                width: None,
                height: None,
                created_at: None,
                post_id: None,
                webview_only: false,
            },
        ]),
        1
    );
    let snapshot = closed_snapshot();
    assert_eq!(snapshot.status, GrokAlbumStatus::Closed);
    assert_eq!(snapshot.total, 0);
    assert!(snapshot.items.is_empty());
    assert!(cached_items().is_empty());
}

#[test]
fn stale_page_revision_cannot_repopulate_the_album_cache() {
    let mut cache = AlbumCache::default();
    let stale_revision = cache.revision;
    cache.revision = cache.revision.wrapping_add(1);
    let item = GrokAlbumMedia {
        media_url: "https://assets.grok.com/users/test/generated/fake/stale.jpg".to_string(),
        thumbnail_url: None,
        kind: "image".to_string(),
        width: None,
        height: None,
        created_at: None,
        post_id: None,
        webview_only: false,
    };

    assert_eq!(
        merge_cache_items_at_revision(&mut cache, vec![item], stale_revision),
        None
    );
    assert!(cache.items.is_empty());
}

#[test]
fn spa_page_epoch_and_disjoint_top_snapshot_replace_previous_account_media() {
    fn item(name: &str) -> GrokAlbumMedia {
        GrokAlbumMedia {
            media_url: format!("https://assets.grok.com/users/test/generated/{name}/image.jpg"),
            thumbnail_url: None,
            kind: "image".to_string(),
            width: None,
            height: None,
            created_at: None,
            post_id: None,
            webview_only: false,
        }
    }

    let mut cache = AlbumCache::default();
    let revision = cache.revision;
    let (added, reset) =
        reconcile_cache_items_at_revision(&mut cache, vec![item("account-a")], revision, 1, 0.0)
            .unwrap();
    assert_eq!(added, 1);
    assert!(!reset);

    let revision = cache.revision;
    let (_, reset) =
        reconcile_cache_items_at_revision(&mut cache, vec![item("account-b")], revision, 2, 0.0)
            .unwrap();
    assert!(reset);
    assert_eq!(cache.items, vec![item("account-b")]);

    let revision = cache.revision;
    let (_, reset) =
        reconcile_cache_items_at_revision(&mut cache, vec![item("account-c")], revision, 2, 0.0)
            .unwrap();
    assert!(reset, "a disjoint top-of-page gallery is a new dataset");
    assert_eq!(cache.items, vec![item("account-c")]);
}

#[test]
fn empty_ready_page_requires_two_snapshots_before_forgetting_cached_media() {
    let item = GrokAlbumMedia {
        media_url: "https://assets.grok.com/users/test/generated/account-a/image.jpg".to_string(),
        thumbnail_url: None,
        kind: "image".to_string(),
        width: None,
        height: None,
        created_at: None,
        post_id: None,
        webview_only: false,
    };
    let mut cache = AlbumCache::default();
    let revision = cache.revision;
    reconcile_cache_items_at_revision(&mut cache, vec![item.clone()], revision, 1, 0.0).unwrap();

    let revision = cache.revision;
    let (_, reset) =
        reconcile_cache_items_at_revision(&mut cache, Vec::new(), revision, 1, 0.0).unwrap();
    assert!(!reset);
    assert_eq!(cache.items, vec![item]);

    let revision = cache.revision;
    let (_, reset) =
        reconcile_cache_items_at_revision(&mut cache, Vec::new(), revision, 1, 0.0).unwrap();
    assert!(reset);
    assert!(cache.items.is_empty());
}

#[test]
fn thumbnail_cancel_tombstone_handles_ipc_reordering() {
    let request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        cancel_album_requests(std::slice::from_ref(&request_id)).unwrap(),
        0
    );
    let request = register_album_request(&request_id).unwrap();
    assert!(request.cancellation.is_cancelled());
}

#[test]
fn eval_snapshot_accepts_direct_and_nested_json() {
    let direct = r#"{"readyState":"complete","hasSecurityChallenge":true,"items":[]}"#;
    let decoded = decode_eval_snapshot(direct).unwrap();
    assert_eq!(decoded.ready_state, "complete");
    assert!(decoded.has_security_challenge);
    let nested = serde_json::to_string(direct).unwrap();
    assert_eq!(
        decode_eval_snapshot(&nested).unwrap().ready_state,
        "complete"
    );
}

#[test]
fn remote_album_window_has_no_capability_entry() {
    let capabilities = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    for entry in std::fs::read_dir(capabilities).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for field in ["windows", "webviews"] {
            let labels = value[field].as_array().cloned().unwrap_or_default();
            assert!(
                !labels
                    .iter()
                    .filter_map(|entry| entry.as_str())
                    .any(|pattern| { capability_label_matches(pattern, WINDOW_LABEL) }),
                "remote album window unexpectedly matches {field} in {}",
                path.display()
            );
        }
    }
}
