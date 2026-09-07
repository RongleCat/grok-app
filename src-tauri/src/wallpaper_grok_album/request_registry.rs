use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::wallpaper_source::WallpaperSearchCancellation;

const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);
const PRE_CANCEL_CAPACITY: usize = 128;
const CANCEL_BATCH_LIMIT: usize = 64;

#[derive(Default)]
struct AlbumRequestRegistry {
    active: HashMap<String, WallpaperSearchCancellation>,
    pre_cancelled: VecDeque<(String, Instant)>,
}

impl AlbumRequestRegistry {
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

static REQUESTS: std::sync::LazyLock<Mutex<AlbumRequestRegistry>> =
    std::sync::LazyLock::new(|| Mutex::new(AlbumRequestRegistry::default()));

pub(super) struct ActiveAlbumRequest {
    request_id: String,
    pub(super) cancellation: WallpaperSearchCancellation,
}

impl Drop for ActiveAlbumRequest {
    fn drop(&mut self) {
        REQUESTS.lock().active.remove(&self.request_id);
    }
}

fn validate_request_id(request_id: &str) -> Result<&str, String> {
    let request_id = request_id.trim();
    uuid::Uuid::parse_str(request_id).map_err(|_| "album_request_invalid".to_string())?;
    Ok(request_id)
}

pub(super) fn register(request_id: &str) -> Result<ActiveAlbumRequest, String> {
    let request_id = validate_request_id(request_id)?;
    let cancellation = WallpaperSearchCancellation::default();
    let mut requests = REQUESTS.lock();
    if requests.active.contains_key(request_id) {
        return Err("album_request_in_use".to_string());
    }
    if requests.take_pre_cancel(request_id, Instant::now()) {
        cancellation.cancel();
    }
    requests
        .active
        .insert(request_id.to_string(), cancellation.clone());
    Ok(ActiveAlbumRequest {
        request_id: request_id.to_string(),
        cancellation,
    })
}

pub(super) fn cancel(request_ids: &[String]) -> Result<usize, String> {
    if request_ids.len() > CANCEL_BATCH_LIMIT {
        return Err("album_request_cancel_batch_too_large".to_string());
    }
    let request_ids = request_ids
        .iter()
        .map(|request_id| validate_request_id(request_id).map(str::to_string))
        .collect::<Result<HashSet<_>, _>>()?;
    let mut requests = REQUESTS.lock();
    let mut active = Vec::new();
    for request_id in &request_ids {
        if let Some(cancellation) = requests.active.get(request_id).cloned() {
            active.push(cancellation);
        } else {
            requests.record_pre_cancel(request_id, Instant::now());
        }
    }
    drop(requests);
    let count = active.len();
    for cancellation in active {
        cancellation.cancel();
    }
    Ok(count)
}

fn cancel_all_in(requests: &Mutex<AlbumRequestRegistry>) -> usize {
    let active = requests.lock().active.values().cloned().collect::<Vec<_>>();
    let count = active.len();
    for cancellation in active {
        cancellation.cancel();
    }
    count
}

pub(super) fn cancel_all() -> usize {
    cancel_all_in(&REQUESTS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_all_reports_and_cancels_active_album_requests() {
        let first = WallpaperSearchCancellation::default();
        let second = WallpaperSearchCancellation::default();
        let requests = Mutex::new(AlbumRequestRegistry {
            active: HashMap::from([
                (uuid::Uuid::new_v4().to_string(), first.clone()),
                (uuid::Uuid::new_v4().to_string(), second.clone()),
            ]),
            pre_cancelled: VecDeque::new(),
        });

        assert_eq!(cancel_all_in(&requests), 2);
        assert!(first.is_cancelled());
        assert!(second.is_cancelled());
        assert_eq!(cancel_all_in(&requests), 2);
    }
}
