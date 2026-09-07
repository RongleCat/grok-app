//! Request ownership, progress and cancellation for CLI wallpaper searches.
use crate::wallpaper_source::{
    self, WallpaperSearchCancellation, WallpaperSearchResult, WallpaperXSearchRuntime,
    WallpaperXSearchStage,
};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 64;
pub(crate) const WALLPAPER_X_SEARCH_PROGRESS_EVENT: &str = "wallpaper://x-search-progress";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WallpaperXSearchProgress {
    request_id: String,
    stage: WallpaperXSearchStage,
}
#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, WallpaperSearchCancellation>,
    pre_cancelled: VecDeque<(String, Instant)>,
}

impl RequestRegistry {
    fn purge_pre_cancelled(&mut self, now: Instant) {
        self.pre_cancelled
            .retain(|(_, created)| now.duration_since(*created) < PRE_CANCEL_TTL);
    }

    fn record_pre_cancel(&mut self, request_id: &str, now: Instant) {
        self.purge_pre_cancelled(now);
        self.pre_cancelled.retain(|(id, _)| id != request_id);
        while self.pre_cancelled.len() >= PRE_CANCEL_CAPACITY {
            self.pre_cancelled.pop_front();
        }
        self.pre_cancelled.push_back((request_id.to_string(), now));
    }

    fn take_pre_cancel(&mut self, request_id: &str, now: Instant) -> bool {
        self.purge_pre_cancelled(now);
        let found = self.pre_cancelled.iter().any(|(id, _)| id == request_id);
        self.pre_cancelled.retain(|(id, _)| id != request_id);
        found
    }
}

fn active_requests() -> &'static Mutex<RequestRegistry> {
    static REQUESTS: OnceLock<Mutex<RequestRegistry>> = OnceLock::new();
    REQUESTS.get_or_init(|| Mutex::new(RequestRegistry::default()))
}

struct ActiveRequestGuard {
    request_id: String,
    cancellation: WallpaperSearchCancellation,
}

impl Drop for ActiveRequestGuard {
    fn drop(&mut self) {
        self.cancellation.cancel();
        active_requests().lock().active.remove(&self.request_id);
    }
}

fn register_request(request_id: &str) -> Result<ActiveRequestGuard, String> {
    let cancellation = WallpaperSearchCancellation::default();
    let mut requests = active_requests().lock();
    if requests.active.contains_key(request_id) {
        return Err("wallpaper_request_in_use".into());
    }
    if requests.take_pre_cancel(request_id, Instant::now()) {
        cancellation.cancel();
    }
    requests
        .active
        .insert(request_id.to_string(), cancellation.clone());
    Ok(ActiveRequestGuard {
        request_id: request_id.to_string(),
        cancellation,
    })
}

pub(crate) fn request_id(raw: Option<&str>) -> Result<String, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(uuid::Uuid::new_v4().to_string());
    };
    uuid::Uuid::parse_str(raw)
        .map(|id| id.to_string())
        .map_err(|_| "invalid_wallpaper_request_id".to_string())
}

pub(crate) fn cancel(request_id: &str) -> bool {
    let mut requests = active_requests().lock();
    let cancellation = requests.active.get(request_id).cloned();
    if let Some(cancellation) = cancellation {
        drop(requests);
        cancellation.cancel();
        true
    } else {
        // IPC can deliver cancel just before the async search command reaches
        // registration. Keep a short, bounded tombstone so close/switch still
        // prevents that request from starting network or CLI work.
        requests.record_pre_cancel(request_id, Instant::now());
        true
    }
}

pub(crate) async fn search(
    app: &tauri::AppHandle,
    request_id: &str,
    query: &str,
    sort: Option<&str>,
) -> Result<WallpaperSearchResult, String> {
    let request = register_request(request_id)?;
    let event_app = app.clone();
    let event_request_id = request_id.to_string();
    let runtime = WallpaperXSearchRuntime::new(
        request.cancellation.clone(),
        Arc::new(move |stage| {
            let _ = event_app.emit(
                WALLPAPER_X_SEARCH_PROGRESS_EVENT,
                WallpaperXSearchProgress {
                    request_id: event_request_id.clone(),
                    stage,
                },
            );
        }),
    );
    runtime.report(WallpaperXSearchStage::Preparing);
    runtime.report(WallpaperXSearchStage::SearchingX);
    let result = wallpaper_source::x_search_cli_outcome(query, sort, Some(&runtime))
        .await
        .result;
    runtime.report(WallpaperXSearchStage::Done);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_ids_are_validated_and_canonicalized() {
        assert!(request_id(Some("invalid")).is_err());
        let id = uuid::Uuid::new_v4();
        assert_eq!(
            request_id(Some(&id.to_string().to_uppercase())).unwrap(),
            id.to_string()
        );
        assert!(uuid::Uuid::parse_str(&request_id(None).unwrap()).is_ok());
    }
    #[test]
    fn cancel_before_register_and_guard_cleanup() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(cancel(&id));
        let request = register_request(&id).unwrap();
        assert!(request.cancellation.is_cancelled());
        assert!(register_request(&id).is_err());
        drop(request);
        assert!(!active_requests().lock().active.contains_key(&id));
        let request = register_request(&id).unwrap();
        assert!(!request.cancellation.is_cancelled());
        assert!(cancel(&id));
        assert!(request.cancellation.is_cancelled());
    }
    #[test]
    fn pre_cancel_is_bounded_and_expires() {
        let mut registry = RequestRegistry::default();
        let now = Instant::now();
        for index in 0..PRE_CANCEL_CAPACITY + 2 {
            registry.record_pre_cancel(&index.to_string(), now);
        }
        assert_eq!(registry.pre_cancelled.len(), PRE_CANCEL_CAPACITY);
        assert!(!registry.take_pre_cancel("0", now));
        assert!(registry.take_pre_cancel("2", now));
        assert!(!registry.take_pre_cancel("3", now + PRE_CANCEL_TTL));
        assert!(registry.pre_cancelled.is_empty());
    }
}
