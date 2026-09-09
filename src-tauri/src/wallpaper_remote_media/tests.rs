use std::io::Cursor;
use std::path::Path;

use crate::paths::APP_HOME_ENV_LOCK;

use super::*;

#[test]
fn content_range_total_shape_is_stable() {
    let parsed = "bytes 0-65535/1048576"
        .rsplit('/')
        .next()
        .and_then(|value| value.parse::<u64>().ok());
    assert_eq!(parsed, Some(1_048_576));
}

#[test]
fn full_remote_download_rejects_partial_response_shapes() {
    assert!(crate::wallpaper_source::is_complete_download_response(
        200, false
    ));
    assert!(!crate::wallpaper_source::is_complete_download_response(
        206, true
    ));
    assert!(!crate::wallpaper_source::is_complete_download_response(
        200, true
    ));
}

#[test]
fn image_referer_contains_only_the_source_origin() {
    let source = Url::parse("https://photos.example/private/path?query=secret").unwrap();
    assert_eq!(
        origin_referer(&source).as_deref(),
        Some("https://photos.example/")
    );
    assert!(origin_referer(&Url::parse("http://photos.example/path").unwrap()).is_none());
    assert_eq!(
        verified_source_origin("https://photos.example/private/path?token=secret").as_deref(),
        Some("https://photos.example/")
    );
}

#[test]
fn image_requests_advertise_only_supported_decoder_formats() {
    let headers =
        image_headers(None, None, ImageAcceptProfile::SupportedOnly).expect("image headers");
    let accept = headers
        .get(ACCEPT)
        .and_then(|value| value.to_str().ok())
        .expect("Accept header");

    assert_eq!(accept, SUPPORTED_IMAGE_ACCEPT);
}

#[test]
fn openverse_thumbnail_accept_fallback_is_endpoint_scoped() {
    let openverse_thumb =
        "https://api.openverse.org/v1/images/01234567-89ab-cdef-0123-456789abcdef/thumb/";
    assert_eq!(
        thumbnail_accept_profile(RemoteWallpaperSource::Openverse, openverse_thumb),
        ImageAcceptProfile::OpenverseThumbnail
    );
    assert_eq!(
        thumbnail_accept_profile(RemoteWallpaperSource::Pexels, openverse_thumb),
        ImageAcceptProfile::SupportedOnly
    );
    assert_eq!(
        thumbnail_accept_profile(
            RemoteWallpaperSource::Openverse,
            "https://api.openverse.org/v1/images/search/"
        ),
        ImageAcceptProfile::SupportedOnly
    );
    assert_eq!(
        thumbnail_accept_profile(
            RemoteWallpaperSource::Openverse,
            "https://api.openverse.org.example/v1/images/id/thumb/"
        ),
        ImageAcceptProfile::SupportedOnly
    );

    let endpoint = Url::parse(openverse_thumb).unwrap();
    let redirected = Url::parse("https://cdn.example/thumb.webp").unwrap();
    assert_eq!(
        accept_profile_for_hop(ImageAcceptProfile::OpenverseThumbnail, &endpoint),
        ImageAcceptProfile::OpenverseThumbnail
    );
    assert_eq!(
        accept_profile_for_hop(ImageAcceptProfile::OpenverseThumbnail, &redirected),
        ImageAcceptProfile::SupportedOnly
    );

    let headers = image_headers(None, None, ImageAcceptProfile::OpenverseThumbnail)
        .expect("Openverse thumbnail headers");
    assert_eq!(
        headers.get(ACCEPT).and_then(|value| value.to_str().ok()),
        Some(OPENVERSE_THUMBNAIL_ACCEPT)
    );
}

#[test]
fn source_registry_is_source_scoped_bounded_and_expires() {
    let started = Instant::now();
    let mut registry = SourceOriginRegistry::default();
    registry.register(
        RemoteWallpaperSource::Web,
        "https://cdn.example/photo.jpg".into(),
        "https://photos.example/".into(),
        started,
    );
    assert_eq!(
        registry
            .lookup(
                RemoteWallpaperSource::Web,
                "https://cdn.example/photo.jpg",
                started + Duration::from_secs(1),
            )
            .as_deref(),
        Some("https://photos.example/")
    );
    assert!(registry
        .lookup(
            RemoteWallpaperSource::Openverse,
            "https://cdn.example/photo.jpg",
            started + Duration::from_secs(1),
        )
        .is_none());
    assert!(registry
        .lookup(
            RemoteWallpaperSource::Web,
            "https://cdn.example/photo.jpg",
            started + SOURCE_ORIGIN_TTL + Duration::from_secs(1),
        )
        .is_none());

    for index in 0..=SOURCE_ORIGIN_LIMIT {
        registry.register(
            RemoteWallpaperSource::Pexels,
            format!("https://cdn.example/{index}.jpg"),
            "https://www.pexels.com/".into(),
            started + Duration::from_millis(index as u64),
        );
    }
    assert_eq!(registry.entries.len(), SOURCE_ORIGIN_LIMIT);
    assert!(!registry.entries.contains_key(&(
        RemoteWallpaperSource::Pexels,
        "https://cdn.example/0.jpg".into(),
    )));
}

#[test]
fn source_registry_rejects_renderer_style_header_inputs() {
    assert_eq!(
        canonical_media_url("https://cdn.example/photo.jpg#fragment").as_deref(),
        Some("https://cdn.example/photo.jpg")
    );
    assert!(canonical_media_url("http://cdn.example/photo.jpg").is_none());
    assert!(canonical_media_url("https://user:secret@cdn.example/photo.jpg").is_none());
    assert!(verified_source_origin("https://photos.example:444/item").is_none());
}

#[test]
fn media_cancel_before_begin_is_sticky_bounded_and_expires() {
    let now = Instant::now();
    let mut registry = MediaRequestRegistry::default();
    registry.record_pre_cancel("late-media", now);
    assert!(registry.take_pre_cancel("late-media", now));
    assert!(!registry.take_pre_cancel("late-media", now));

    for index in 0..=PRE_CANCEL_CAPACITY {
        registry.record_pre_cancel(&format!("request-{index}"), now);
    }
    assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
    assert!(!registry.take_pre_cancel("request-0", now));
    assert!(!registry.take_pre_cancel("request-1", now + PRE_CANCEL_TTL + Duration::from_secs(1),));
}

#[test]
fn remote_thumbnail_is_bounded_jpeg_data_without_persisting() {
    let image = image::DynamicImage::new_rgb8(1_600, 900);
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .expect("encode test image");

    let thumbnail = thumbnail_from_bytes(png.into_inner()).expect("build thumbnail");
    assert_eq!((thumbnail.width, thumbnail.height), (1_600, 900));
    assert!(thumbnail.data_url.starts_with("data:image/jpeg;base64,"));
    assert!(thumbnail.data_url.len() <= 768 * 1024);
}

#[test]
fn probe_http_failures_have_stable_categories() {
    assert_eq!(
        status_failure(StatusCode::FORBIDDEN),
        RemoteImageProbeFailure::Forbidden
    );
    assert_eq!(
        status_failure(StatusCode::NOT_FOUND),
        RemoteImageProbeFailure::NotFound
    );
    assert_eq!(
        status_failure(StatusCode::TOO_MANY_REQUESTS),
        RemoteImageProbeFailure::RateLimited
    );
    assert_eq!(
        status_failure(StatusCode::BAD_GATEWAY),
        RemoteImageProbeFailure::HttpServer
    );
}

#[test]
fn stored_remote_images_stay_in_their_source_directory() {
    let _environment = APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let home = std::env::temp_dir().join(format!(
        "grok-app-remote-image-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    // SAFETY: test-only mutation serialized by APP_HOME_ENV_LOCK.
    unsafe { std::env::set_var("GROK_APP_HOME", &home) };
    let mut png = vec![0u8; 128];
    png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let saved = save_image(
        "https://images.example.test/wallpaper.png",
        RemoteWallpaperSource::Web,
        "image/png",
        png,
    )
    .expect("save remote image");
    assert!(Path::new(&saved.path).is_file());
    assert!(Path::new(&saved.path).starts_with(home.join("wallpapers").join("web")));

    unsafe { std::env::remove_var("GROK_APP_HOME") };
    let _ = fs::remove_dir_all(home);
}
