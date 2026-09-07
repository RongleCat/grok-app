//! One user-triggered Responses enrichment batch.
//!
//! This is deliberately separate from the initial three-lane search: it runs
//! only after explicit user intent, never retries automatically, and never
//! falls back to the CLI.

use super::*;
use crate::wallpaper_source::x_gallery_reference_ids;

const LOAD_MORE_LANE_INDEX: usize = 4;

pub(crate) async fn search_more(
    query: &str,
    sort: Option<&str>,
    existing: &[WallpaperGalleryItem],
    runtime: &WallpaperXSearchRuntime,
    auth: &BuildOauthAccessToken,
) -> Result<ResponsesSearchSuccess, ResponsesSearchError> {
    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            None,
        ));
    }

    let client = responses_client(RESPONSES_TIMEOUT, Some(auth.revision.clone()))?;
    let excluded_ids = x_gallery_reference_ids(existing);
    let mut result = search_with_client(
        ResponsesSearchRequest {
            query,
            sort,
            endpoint: RESPONSES_ENDPOINT,
            max_search_calls: RESPONSES_LANE_MAX_X_SEARCH_CALLS,
            lane_index: LOAD_MORE_LANE_INDEX,
            target_count: RESPONSES_LANE_TARGET_COUNT,
            excluded_ids: &excluded_ids,
            cancellation: runtime.cancellation(),
        },
        &client,
        auth.expose_to_build_proxy(),
        auth.revision.clone(),
    )
    .await?;

    runtime.report(WallpaperXSearchStage::Validating);
    let validated =
        filter_reachable_gallery_items_cancellable(result.items, Some(runtime.cancellation()))
            .await;
    if runtime.is_cancelled() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Cancelled,
            Some(auth.revision.clone()),
        ));
    }

    result.items = new_more_items(existing, validated);
    if result.items.is_empty() {
        return Err(ResponsesSearchError::new(
            ResponsesSearchErrorKind::Empty,
            Some(auth.revision.clone()),
        )
        .with_observed_search_calls(result.search_calls));
    }
    result.valid_count = result.items.len();
    Ok(result)
}

fn new_more_items(
    existing: &[WallpaperGalleryItem],
    candidates: Vec<WallpaperGalleryItem>,
) -> Vec<WallpaperGalleryItem> {
    let candidates = merge_rank_x_gallery_items_with_limit(candidates, RESPONSES_LANE_TARGET_COUNT);
    x_gallery_new_items(existing, &candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, status_id: &str) -> WallpaperGalleryItem {
        WallpaperGalleryItem {
            id: id.into(),
            thumb_url: format!("https://pbs.twimg.com/media/{id}.jpg?name=small"),
            full_url: format!("https://pbs.twimg.com/media/{id}.jpg?name=orig"),
            kind: "image".into(),
            width: None,
            height: None,
            source: "x".into(),
            username: None,
            post_url: Some(format!("https://x.com/example/status/{status_id}")),
            text_preview: None,
            likes: None,
            local_path: None,
            prompt: None,
            status_id: Some(status_id.into()),
            media_index: Some(1),
            media_quality: None,
        }
    }

    #[test]
    fn wallpaper_x_responses_load_more_dedupes_existing_media_and_status() {
        let existing = vec![item("same-media", "10000001")];
        let mut same_status = item("different-media", "10000001");
        same_status.media_index = Some(1);
        let fresh = item("fresh", "10000002");

        let result = new_more_items(&existing, vec![existing[0].clone(), same_status, fresh]);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "fresh");
    }
}
