use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use url::Url;

use super::response::provider_item;
use super::{
    ProviderCandidate, ProviderError, ProviderPartialResults, IMAGE_PROBE_TIMEOUT,
    IMAGE_VALIDATION_BUDGET, MAX_CONCURRENT_PROBES, PROGRESS_BATCH_SIZE, RESULT_LIMIT,
};
use crate::wallpaper_remote_media::{self, RemoteImageProber};
use crate::wallpaper_remote_search::{
    RemoteSearchBatch, RemoteSearchRuntime, RemoteWallpaperSource,
};
use crate::wallpaper_source::WallpaperGalleryItem;

pub(super) async fn visit_probes_as_completed<I, F, Fut, Visit>(
    inputs: I,
    concurrency: usize,
    budget: Duration,
    mut probe: F,
    mut visit: Visit,
) where
    I: IntoIterator,
    F: FnMut(I::Item) -> Fut,
    Fut: std::future::Future,
    Visit: FnMut(usize, Fut::Output),
{
    let probes = futures_util::stream::iter(inputs.into_iter().enumerate())
        .map(|(index, input)| {
            let future = probe(input);
            async move { (index, future.await) }
        })
        .buffer_unordered(concurrency.max(1));
    tokio::pin!(probes);
    let deadline = tokio::time::sleep(budget);
    tokio::pin!(deadline);
    loop {
        let next = tokio::select! {
            biased;
            _ = &mut deadline => break,
            next = probes.next() => next,
        };
        let Some(output) = next else {
            break;
        };
        visit(output.0, output.1);
    }
}

pub(super) async fn validate_candidates(
    source: RemoteWallpaperSource,
    candidates: Vec<ProviderCandidate>,
    runtime: &RemoteSearchRuntime,
    partial: &ProviderPartialResults,
) -> Result<Vec<WallpaperGalleryItem>, ProviderError> {
    let prober = Arc::new(RemoteImageProber::new());
    let cancellation = runtime.cancellation().clone();
    validate_probe_outputs(
        candidates,
        MAX_CONCURRENT_PROBES,
        IMAGE_VALIDATION_BUDGET,
        runtime,
        partial,
        |candidate| {
            let prober = Arc::clone(&prober);
            let cancellation = cancellation.clone();
            async move {
                let referer = Url::parse(&candidate.source_url)
                    .ok()
                    .as_ref()
                    .and_then(wallpaper_remote_media::origin_referer);
                let probe = tokio::time::timeout(
                    IMAGE_PROBE_TIMEOUT,
                    prober.probe_image(&candidate.image_url, referer.as_deref(), &cancellation),
                )
                .await
                .ok()
                .and_then(Result::ok)?;
                if !wallpaper_remote_media::is_wallpaper_quality_candidate(&probe) {
                    return None;
                }
                Some(provider_item(source, candidate, probe))
            }
        },
    )
    .await
}

pub(super) async fn validate_probe_outputs<I, F, Fut>(
    inputs: I,
    concurrency: usize,
    budget: Duration,
    runtime: &RemoteSearchRuntime,
    partial: &ProviderPartialResults,
    probe: F,
) -> Result<Vec<WallpaperGalleryItem>, ProviderError>
where
    I: IntoIterator,
    F: FnMut(I::Item) -> Fut,
    Fut: std::future::Future<Output = Option<WallpaperGalleryItem>>,
{
    let mut completed_items = Vec::new();
    let mut pending = Vec::new();
    let mut progressive_seen_urls = HashSet::new();
    let mut progressive_seen_fingerprints = HashSet::new();
    let mut progressive_count = 0;
    let mut batch_index = 1;

    let visit = visit_probes_as_completed(inputs, concurrency, budget, probe, |index, item| {
        let Some(item) = item else {
            return;
        };
        completed_items.push((index, item.clone()));
        partial.record(index, item.clone());
        if progressive_count >= RESULT_LIMIT {
            return;
        }
        let fingerprint = item.media_fingerprint.clone().unwrap_or_default();
        if !progressive_seen_urls.insert(item.full_url.clone())
            || (!fingerprint.is_empty() && !progressive_seen_fingerprints.insert(fingerprint))
        {
            return;
        }
        progressive_count += 1;
        pending.push(item);
        if pending.len() >= PROGRESS_BATCH_SIZE {
            partial.mark_batch_emitted(batch_index);
            runtime.report_batch(RemoteSearchBatch {
                batch_index,
                items: std::mem::take(&mut pending),
                accumulated_count: progressive_count,
                done: false,
            });
            batch_index += 1;
        }
    });
    tokio::select! {
        biased;
        _ = runtime.cancellation().cancelled() => return Err(ProviderError::Cancelled),
        _ = visit => {}
    }
    if runtime.is_cancelled() {
        return Err(ProviderError::Cancelled);
    }

    // Progress favors latency; the invoke result remains the relevance-ordered
    // authority used to reconcile the temporary completion-ordered cards.
    completed_items.sort_by_key(|(index, _)| *index);
    let mut items = Vec::with_capacity(completed_items.len());
    let mut seen_urls = HashSet::new();
    let mut seen_fingerprints = HashSet::new();
    for (_, item) in completed_items {
        let fingerprint = item.media_fingerprint.clone().unwrap_or_default();
        if !seen_urls.insert(item.full_url.clone())
            || (!fingerprint.is_empty() && !seen_fingerprints.insert(fingerprint))
        {
            continue;
        }
        items.push(item);
    }

    partial.mark_batch_emitted(batch_index);
    runtime.report_batch(RemoteSearchBatch {
        batch_index,
        items: pending,
        accumulated_count: items.len().min(RESULT_LIMIT),
        done: true,
    });
    Ok(items)
}
