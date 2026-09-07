use super::*;

#[test]
fn fixed_scripts_remain_bundled_and_thumbnail_templates_are_fully_bound() {
    assert!(BRIDGE_MARKER_SCRIPT.contains("__GROK_APP_SAVED_READ_ONLY__"));
    assert!(BRIDGE_MARKER_SCRIPT.contains("__GROK_APP_SAVED_PAGE_STATE__"));
    assert!(BRIDGE_MARKER_SCRIPT.contains("MutationObserver"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("https://grok.com/"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("__GROK_APP_SAVED_RECOVERY_STATE__"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("shellSignature"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("stableSamples >= MIN_STABLE_SAMPLES"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("stableAge >= MIN_STABLE_AGE_MS"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("pageAge >= MIN_PAGE_AGE_MS"));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("phase = \"challenge\""));
    assert!(SIGNED_OUT_RECOVERY_SCRIPT.contains("phase = \"redirecting\""));
    assert!(SNAPSHOT_SCRIPT.contains("assets.grok.com"));
    assert!(SNAPSHOT_SCRIPT.contains("recoveryState"));
    assert!(SNAPSHOT_SCRIPT.contains("hasSecurityChallenge"));
    assert!(SNAPSHOT_SCRIPT.contains("/cdn-cgi/challenge-platform/"));
    assert!(SNAPSHOT_SCRIPT.contains("/cdn-cgi/styles/challenges.css"));
    assert!(SNAPSHOT_SCRIPT.contains("!hasAppShell && hasChallengeAsset"));
    assert!(SNAPSHOT_SCRIPT.contains("webviewOnly"));
    assert!(SNAPSHOT_SCRIPT.contains("url.protocol === \"blob:\""));
    assert!(SCROLL_MORE_SCRIPT.contains("scrollTo"));
    assert!(SCROLL_MORE_SCRIPT.contains("__GROK_APP_ALBUM_SCROLL_RESTORE__"));
    assert!(SCROLL_RESTORE_SCRIPT.contains("delete window.__GROK_APP_ALBUM_SCROLL_RESTORE__"));

    let url = "https://assets.grok.com/users/test/generated/fake/image.jpg";
    let start = thumbnail_job_start_script(url).unwrap();
    let poll = thumbnail_job_poll_script(url, true).unwrap();
    for script in [&start, &poll] {
        assert!(script.contains(url));
        assert!(!script.contains("__URL__"));
        assert!(!script.contains("__MAX_"));
        assert!(!script.contains("__REMOVE__"));
    }
    assert!(start.contains(&MAX_THUMB_SOURCE_BYTES.to_string()));
    assert!(start.contains(&MAX_THUMB_HEADER_BYTES.to_string()));
    assert!(start.contains(&crate::image_thumb::UNTRUSTED_THUMB_MAX_DIMENSION.to_string()));
    assert!(start.contains(&crate::image_thumb::UNTRUSTED_THUMB_MAX_PIXELS.to_string()));
    assert!(start.contains("dimensionsFromHeader"));
    assert!(start.contains("blob.slice(0,"));
    assert!(start.contains("createImageBitmap(payload.blob)"));
    assert!(start.contains("response.url || url"));
    assert!(start.contains("finalUrl.hostname !== \"assets.grok.com\""));
    assert!(poll.contains("if (true)"));
}
