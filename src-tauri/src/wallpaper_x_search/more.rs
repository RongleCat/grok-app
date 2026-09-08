//! Explicit enrichment: one request, no retries and no CLI fallback.
use super::*;

pub(crate) async fn search_more(
    app: &tauri::AppHandle,
    request_id: &str,
    continuation_id: &str,
) -> Result<WallpaperSearchResult, String> {
    let request = register_request(request_id)?;
    let runtime = search_runtime(app, request_id, request.cancellation.clone());
    let started = Instant::now();
    let settings = store::load_settings();
    let mode = store::normalize_wallpaper_x_search_mode(&settings.wallpaper_x_search_mode);
    let mut result = if runtime.is_cancelled() {
        cancelled_result(mode, "responses", started, None, None)
    } else if mode != "responses_preview" {
        error_result("load_more_unavailable", started, None)
    } else {
        match account::read_build_oauth_access_token() {
            Err(error) => error_result(error.code(), started, None),
            Ok(auth) => match cache::claim(continuation_id, &auth.revision) {
                None => error_result("load_more_unavailable", started, None),
                Some(lease) => {
                    if !responses_circuit()
                        .lock()
                        .allows_attempt(Some(auth.revision.clone()), Instant::now())
                    {
                        error_result(CIRCUIT_OPEN_REASON, started, None)
                    } else {
                        runtime.report(WallpaperXSearchStage::SearchingX);
                        let responses_started = Instant::now();
                        let outcome = wallpaper_x_responses::search_more(
                            &lease.query,
                            Some(lease.sort),
                            &lease.items,
                            &runtime,
                            &auth,
                        )
                        .await;
                        let responses_duration_ms = elapsed_ms(responses_started);
                        let result = if account::read_build_oauth_access_token()
                            .ok()
                            .map(|current| current.revision)
                            .as_ref()
                            == Some(&auth.revision)
                        {
                            finish(outcome, started, Some(responses_duration_ms))
                        } else {
                            error_result("load_more_unavailable", started, None)
                        };
                        if runtime.is_cancelled() || (consumes(&result) && !lease.consume(&runtime))
                        {
                            cancelled_result(
                                mode,
                                "responses",
                                started,
                                result
                                    .meta
                                    .as_ref()
                                    .and_then(|meta| meta.responses_duration_ms),
                                None,
                            )
                        } else {
                            result
                        }
                    }
                }
            },
        }
    };
    if let Some(meta) = result.meta.as_mut() {
        meta.request_id = Some(request_id.into());
    }
    runtime.report(WallpaperXSearchStage::Done);
    Ok(result)
}

fn consumes(result: &WallpaperSearchResult) -> bool {
    result.error_code.is_none() || result.error_code.as_deref() == Some("empty")
}

fn finish(
    outcome: Result<ResponsesSearchSuccess, ResponsesSearchError>,
    started: Instant,
    responses_duration_ms: Option<u64>,
) -> WallpaperSearchResult {
    match outcome {
        Ok(success) => {
            responses_circuit()
                .lock()
                .record_success(success.credential_revision);
            let mut result = error_result("", started, responses_duration_ms);
            result.error_code = None;
            result.items = success.items;
            let meta = result.meta.as_mut().expect("more result metadata");
            meta.search_calls = Some(success.search_calls);
            meta.candidate_count = success.candidate_count;
            meta.valid_count = success.valid_count;
            result
        }
        Err(error) => {
            if error.kind != ResponsesSearchErrorKind::Empty {
                responses_circuit().lock().record_failure(
                    error.kind,
                    error.credential_revision,
                    Instant::now(),
                );
            }
            let code = if error.kind == ResponsesSearchErrorKind::Empty {
                "empty"
            } else {
                error.kind.code()
            };
            let mut result = error_result(code, started, responses_duration_ms);
            result
                .meta
                .as_mut()
                .expect("more result metadata")
                .search_calls = error.observed_search_calls;
            result
        }
    }
}

fn error_result(
    code: &str,
    started: Instant,
    responses_duration_ms: Option<u64>,
) -> WallpaperSearchResult {
    WallpaperSearchResult {
        items: Vec::new(),
        error_code: Some(code.into()),
        message: None,
        meta: Some(WallpaperSearchMeta {
            request_id: None,
            requested_mode: "responses_preview".into(),
            route_used: "responses".into(),
            fallback_reason: None,
            duration_ms: elapsed_ms(started),
            responses_duration_ms,
            cli_duration_ms: None,
            cache_hit: false,
            continuation_id: None,
            search_calls: None,
            candidate_count: 0,
            valid_count: 0,
            model: Some(wallpaper_x_responses::RESPONSES_MODEL.into()),
            effort: Some(wallpaper_x_responses::RESPONSES_EFFORT.into()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failure_does_not_consume_continuation_but_empty_does() {
        assert!(consumes(&error_result("empty", Instant::now(), None)));
        for error in [
            "responses_network",
            "responses_rate_limited",
            "cancelled",
            "load_more_unavailable",
        ] {
            assert!(!consumes(&error_result(error, Instant::now(), None)));
        }
    }
}
