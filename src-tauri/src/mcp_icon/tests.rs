//! mcp_icon 的单元测试。
//!
//! 单独成文件：生产代码与测试共同计入仓库的「≥1000 行文件」预算，
//! 拆开才能保持两边都在阈值内。

use super::*;

const DAY: u64 = 24 * 60 * 60;

fn tiny_png(width: u32, height: u32) -> Vec<u8> {
    let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([12, 34, 56, 200]),
    ));
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .expect("encode png");
    png.into_inner()
}

fn cached_entry(data_url: Option<&str>, fetched_at: u64) -> CacheEntry {
    CacheEntry {
        domain: "context7.com".into(),
        data_url: data_url.map(str::to_string),
        source: if data_url.is_some() {
            McpIconSource::Site
        } else {
            McpIconSource::None
        },
        fetched_at,
    }
}

#[test]
fn registrable_domain_strips_subdomains_and_keeps_private_suffixes() {
    assert_eq!(registrable_domain("mcp.context7.com"), "context7.com");
    assert_eq!(registrable_domain("context7.com"), "context7.com");
    assert_eq!(registrable_domain("API.Context7.COM"), "context7.com");
    // github.io 在 PSL 里是私有后缀，注册域必须保留用户段。
    assert_eq!(registrable_domain("foo.github.io"), "foo.github.io");
    assert_eq!(registrable_domain("api.foo.github.io"), "foo.github.io");
    assert_eq!(registrable_domain("localhost"), "localhost");
}

#[test]
fn parse_target_accepts_remote_https_and_drops_query() {
    let target =
        parse_target("https://mcp.context7.com/mcp?token=secret#frag").expect("valid target");
    assert_eq!(target.host, "mcp.context7.com");
    assert_eq!(target.domain, "context7.com");

    let bare = parse_target("https://example.com.").expect("trailing dot host");
    assert_eq!(bare.host, "example.com");
}

#[test]
fn parse_target_rejects_http_userinfo_local_and_no_dot_hosts() {
    for bad in [
        "http://mcp.context7.com/mcp",
        "ftp://mcp.context7.com/mcp",
        "https://user:pass@mcp.context7.com/mcp",
        "https://localhost/mcp",
        "https://app.localhost/mcp",
        "https://printer.local/mcp",
        "https://intranet/mcp",
        "https://127.0.0.1/mcp",
        "https://10.0.0.5/mcp",
        "https://[::1]/mcp",
        // 主机名本身就是公共后缀：域策略没有可限制的范围
        "https://github.io/mcp",
        "https://co.uk/mcp",
        "not a url",
        "",
    ] {
        assert!(parse_target(bad).is_none(), "must reject {bad}");
    }
}

#[test]
fn server_info_icons_keep_only_https_and_image_data_urls() {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "serverInfo": {
                "name": "context7",
                "icons": [
                    { "src": "https://context7.com/logo.svg", "mimeType": "image/svg+xml" },
                    { "src": "data:image/png;base64,AAAA" },
                    { "src": "http://insecure.example/icon.png" },
                    { "src": "javascript:alert(1)" },
                    { "src": "https://context7.com/logo.svg" },
                    { "src": "data:text/html;base64,AAAA" }
                ]
            }
        }
    })
    .to_string();
    assert_eq!(
        parse_server_icon_sources(body.as_bytes()),
        vec![
            "https://context7.com/logo.svg".to_string(),
            "data:image/png;base64,AAAA".to_string(),
        ]
    );
}

#[test]
fn server_info_icons_parse_sse_frames() {
    let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"serverInfo\":{\"icons\":[{\"src\":\"https://linear.app/icon.png\"}]}}}\n\n";
    assert_eq!(
        parse_server_icon_sources(body.as_bytes()),
        vec!["https://linear.app/icon.png".to_string()]
    );
}

#[test]
fn server_info_icons_ignore_missing_or_malformed_payloads() {
    assert!(parse_server_icon_sources(b"").is_empty());
    assert!(parse_server_icon_sources(b"not json").is_empty());
    assert!(parse_server_icon_sources(b"{\"result\":{}}").is_empty());
    assert!(
        parse_server_icon_sources(b"{\"result\":{\"serverInfo\":{\"icons\":\"nope\"}}}").is_empty()
    );
}

#[test]
fn fallback_candidates_try_the_domain_before_the_original_host() {
    let target = parse_target("https://mcp.context7.com/mcp").expect("valid target");
    assert_eq!(
        fallback_icon_candidates(&target),
        vec![
            (
                "https://context7.com/favicon.ico".to_string(),
                McpIconSource::Favicon
            ),
            (
                "https://mcp.context7.com/favicon.ico".to_string(),
                McpIconSource::Favicon
            ),
        ]
    );

    let bare = parse_target("https://context7.com/mcp").expect("valid target");
    assert_eq!(fallback_icon_candidates(&bare).len(), 1);
}

#[test]
fn extract_site_icons_ranks_svg_apple_size_then_document_order() {
    let base = Url::parse("https://context7.com/").expect("base url");
    let html = r#"
          <html><head>
            <link rel="icon" href="/favicon-16.png" sizes="16x16">
            <link rel="shortcut icon" href="/favicon-32.png" sizes="32x32">
            <link rel="icon" type="image/svg+xml" href="/logo.svg">
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <link rel="apple-touch-icon-precomposed" sizes="120x120" href="/apple-120.png">
            <link rel="mask-icon" href="/mask.svg">
            <link rel="icon" href="http://insecure.example.com/i.png">
            <link rel="icon" href="https://user:pass@example.com/i.png">
            <link rel="icon" href="https://third-party-cdn.example.com/i.png">
          </head></html>
        "#;
    let urls = extract_site_icon_urls(&base, html, "context7.com");
    assert_eq!(
        urls,
        vec![
            "https://context7.com/logo.svg",
            "https://context7.com/apple-touch-icon.png",
            "https://context7.com/apple-120.png",
            "https://context7.com/favicon-32.png",
            "https://context7.com/favicon-16.png",
        ]
    );
}

#[test]
fn extract_site_icons_resolves_relative_urls_and_dedupes() {
    let base = Url::parse("https://docs.context7.com/guide/start").expect("base url");
    let html = r#"
            <link rel="icon" href="./assets/favicon.png">
            <link rel="icon" href="assets/favicon.png">
            <link rel="icon" href="//cdn.context7.com/icon.png">
        "#;
    let urls = extract_site_icon_urls(&base, html, "context7.com");
    assert_eq!(
        urls,
        vec![
            "https://docs.context7.com/guide/assets/favicon.png",
            "https://cdn.context7.com/icon.png",
        ]
    );
}

#[test]
fn extract_site_icons_drops_other_vendors() {
    let base = Url::parse("https://foo.github.io/").expect("base url");
    let html = r#"
            <link rel="icon" href="https://foo.github.io/icon.png">
            <link rel="icon" href="https://bar.github.io/icon.png">
        "#;
    assert_eq!(
        extract_site_icon_urls(&base, html, "foo.github.io"),
        vec!["https://foo.github.io/icon.png"]
    );
}

#[test]
fn stale_fallback_keeps_only_entries_that_hold_an_icon() {
    let now = 10 * SUCCESS_TTL_SECS;
    let stale = cached_entry(Some("data:image/png;base64,AAAA"), now - 90 * DAY);
    let resolved = stale_icon_fallback(Some(stale)).expect("stale icon");
    assert!(resolved.from_cache);
    assert!(resolved.data_url.is_some());
    assert_eq!(resolved.domain.as_deref(), Some("context7.com"));

    assert!(stale_icon_fallback(Some(cached_entry(None, now - 90 * DAY))).is_none());
    assert!(stale_icon_fallback(None).is_none());
}

#[test]
fn cache_freshness_uses_success_and_failure_ttls() {
    let now = 10 * SUCCESS_TTL_SECS;
    let icon = "data:image/png;base64,AAAA";
    assert!(cache_is_fresh(
        &cached_entry(Some(icon), now - 29 * DAY),
        now
    ));
    assert!(!cache_is_fresh(
        &cached_entry(Some(icon), now - 31 * DAY),
        now
    ));
    assert!(cache_is_fresh(&cached_entry(None, now - 6 * DAY), now));
    assert!(!cache_is_fresh(&cached_entry(None, now - 8 * DAY), now));
}

#[test]
fn cache_window_is_half_open_at_the_ttl_boundary() {
    let now = 1_000 * DAY;
    let icon = "data:image/png;base64,AAAA";
    assert!(cache_is_fresh(
        &cached_entry(Some(icon), now - SUCCESS_TTL_SECS + 1),
        now
    ));
    assert!(!cache_is_fresh(
        &cached_entry(Some(icon), now - SUCCESS_TTL_SECS),
        now
    ));
    assert!(!cache_is_fresh(
        &cached_entry(None, now - NONE_TTL_SECS),
        now
    ));
}

#[test]
fn cache_entries_reject_mismatched_or_foreign_payloads() {
    assert!(cached_entry(Some("data:image/png;base64,AAAA"), 0).is_sane());
    assert!(cached_entry(None, 0).is_sane());

    let mut mismatched = cached_entry(None, 0);
    mismatched.source = McpIconSource::Site;
    assert!(!mismatched.is_sane());

    let mut script = cached_entry(None, 0);
    script.data_url = Some("javascript:alert(1)".into());
    script.source = McpIconSource::Site;
    assert!(!script.is_sane());

    let mut bad_domain = cached_entry(None, 0);
    bad_domain.domain = "../escape".into();
    assert!(!bad_domain.is_sane());
}

#[test]
fn cache_file_names_are_hashed_without_leaking_domain() {
    let name = short_hash("mcp.context7.com");
    assert_eq!(name.len(), 40);
    assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
    assert!(!name.contains("context7"));
    assert_ne!(short_hash("a.com"), short_hash("b.com"));
}

#[test]
fn tiny_png_becomes_png_data_url_with_alpha() {
    let data_url = icon_data_url(None, &tiny_png(16, 16)).expect("png accepted");
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("png prefix");
    let bytes = BASE64.decode(encoded).expect("valid base64");
    let image = image::load_from_memory(&bytes).expect("decode png");
    assert_eq!((image.width(), image.height()), (16, 16));
    assert!(image.color().has_alpha());
}

#[test]
fn oversized_bitmap_is_fitted_into_sixty_four_pixels() {
    let data_url = icon_data_url(None, &tiny_png(256, 128)).expect("png accepted");
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("png prefix");
    let bytes = BASE64.decode(encoded).expect("valid base64");
    let image = image::load_from_memory(&bytes).expect("decode png");
    assert_eq!((image.width(), image.height()), (64, 32));
}

#[test]
fn svg_payload_is_returned_verbatim() {
    let svg = br#"<?xml version="1.0" encoding="UTF-8"?>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="32"/></svg>"#;
    let data_url = icon_data_url(None, svg).expect("svg accepted");
    let encoded = data_url
        .strip_prefix("data:image/svg+xml;base64,")
        .expect("svg prefix");
    assert_eq!(BASE64.decode(encoded).expect("valid base64"), svg);

    let declared = icon_data_url(Some("image/svg+xml; charset=utf-8"), b"<svg/>")
        .expect("content type carries svg");
    assert!(declared.starts_with("data:image/svg+xml;base64,"));
}

#[test]
fn undecodable_and_empty_payloads_are_skipped() {
    assert!(icon_data_url(None, b"").is_none());
    assert!(icon_data_url(None, b"not an image").is_none());
    let oversized_svg = format!("<svg>{}</svg>", "x".repeat(SVG_MAX_BYTES));
    assert!(icon_data_url(None, oversized_svg.as_bytes()).is_none());
}

#[test]
fn html_content_type_only_accepts_text_html() {
    assert!(is_html_content_type(Some("text/html; charset=utf-8")));
    assert!(!is_html_content_type(Some("application/json")));
    assert!(!is_html_content_type(Some("image/png")));
    assert!(!is_html_content_type(None));
}

#[test]
fn invalid_target_never_reports_a_domain() {
    let result = McpIconResult::unresolved();
    assert_eq!(result.source, McpIconSource::None);
    assert!(result.domain.is_none());
    assert!(result.data_url.is_none());
    assert!(!result.from_cache);
}

#[test]
fn cache_round_trip_keeps_only_the_domain_and_icon() {
    let dir = std::env::temp_dir().join(format!(
        "grok-mcp-icon-cache-{}-{}",
        std::process::id(),
        unix_now_secs()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("entry.json");
    let data_url = icon_data_url(None, &tiny_png(8, 8)).expect("png accepted");
    let entry = CacheEntry {
        domain: "context7.com".into(),
        data_url: Some(data_url.clone()),
        source: McpIconSource::Site,
        fetched_at: 42,
    };
    write_cache(&path, &entry);

    let raw = fs::read_to_string(&path).expect("cache file");
    assert!(!raw.contains("https://mcp.context7.com"));
    let loaded = read_cache(&path).expect("cache entry");
    assert_eq!(loaded.domain, "context7.com");
    assert_eq!(loaded.data_url.as_deref(), Some(data_url.as_str()));
    assert_eq!(loaded.source, McpIconSource::Site);
    assert_eq!(loaded.fetched_at, 42);
    let _ = fs::remove_dir_all(&dir);
}
