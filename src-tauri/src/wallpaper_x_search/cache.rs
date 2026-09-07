//! Bounded, credential-scoped metadata cache. No tokens or image bytes are stored.
use super::*;

const CAPACITY: usize = 32;
const TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    query: String,
    latest: bool,
    credential: BuildOauthCredentialRevision,
}

struct Entry {
    inserted: Instant,
    result: WallpaperSearchResult,
}

#[derive(Default)]
struct Cache {
    entries: HashMap<Key, Entry>,
    lru: VecDeque<Key>,
}

impl Cache {
    fn purge(&mut self, now: Instant) {
        self.entries
            .retain(|_, entry| now.duration_since(entry.inserted) < TTL);
        self.lru.retain(|key| self.entries.contains_key(key));
    }

    fn get(&mut self, key: &Key, now: Instant) -> Option<WallpaperSearchResult> {
        self.purge(now);
        let result = self.entries.get(key)?.result.clone();
        self.lru.retain(|other| other != key);
        self.lru.push_back(key.clone());
        Some(result)
    }

    fn insert(&mut self, key: Key, mut result: WallpaperSearchResult, now: Instant) {
        self.purge(now);
        self.lru.retain(|other| other != &key);
        while self.entries.len() >= CAPACITY && !self.entries.contains_key(&key) {
            if let Some(oldest) = self.lru.pop_front() {
                self.entries.remove(&oldest);
            } else {
                break;
            }
        }
        if let Some(meta) = result.meta.as_mut() {
            meta.request_id = None;
            meta.cache_hit = false;
        }
        self.entries.insert(
            key.clone(),
            Entry {
                inserted: now,
                result,
            },
        );
        self.lru.push_back(key);
    }
}

pub(super) struct CacheRequest<'a> {
    pub request_id: &'a str,
    pub query: &'a str,
    pub sort: Option<&'a str>,
    pub mode: &'a str,
    pub runtime: &'a WallpaperXSearchRuntime,
}

pub(super) async fn search_cached<F, Fut>(
    request: CacheRequest<'_>,
    run: F,
) -> WallpaperSearchResult
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = WallpaperSearchResult>,
{
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    run_cached(
        request,
        CACHE.get_or_init(Default::default),
        || {
            // Parsing validates scope and expiry, unlike file revision alone.
            account::read_build_oauth_access_token()
                .ok()
                .map(|auth| auth.revision)
        },
        run,
    )
    .await
}

async fn run_cached<F, Fut, R>(
    request: CacheRequest<'_>,
    cache: &Mutex<Cache>,
    revision: R,
    run: F,
) -> WallpaperSearchResult
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = WallpaperSearchResult>,
    R: Fn() -> Option<BuildOauthCredentialRevision>,
{
    let CacheRequest {
        request_id,
        query,
        sort,
        mode,
        runtime,
    } = request;
    let started = Instant::now();
    if runtime.is_cancelled() {
        return cancelled_result(mode, "responses", started);
    }
    // CLI/custom routes have different identity semantics and must not share
    // an official-account cache. Only an explicit preview can read or write it.
    if mode != "responses_preview" {
        return run().await;
    }
    let key = revision().map(|credential| Key {
        query: query
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase(),
        latest: matches!(sort, Some("latest" | "Latest")),
        credential,
    });
    if let Some(key) = key.as_ref() {
        let hit = cache.lock().get(key, Instant::now());
        if let Some(mut result) = hit {
            if runtime.is_cancelled() {
                return cancelled_result(mode, "responses", started);
            }
            if let Some(meta) = result.meta.as_mut() {
                meta.request_id = Some(request_id.into());
                meta.cache_hit = true;
                meta.duration_ms = elapsed_ms(started);
                meta.search_calls = Some(0);
            }
            runtime.report_batch(wallpaper_source::WallpaperXSearchBatch {
                batch_index: 1,
                accumulated_count: result.items.len(),
                items: result.items.clone(),
                done: true,
            });
            return result;
        }
    }
    let result = run().await;
    if runtime.is_cancelled() {
        return cancelled_result(mode, "responses", started);
    }
    if result.error_code.is_none()
        && !result.items.is_empty()
        && result
            .meta
            .as_ref()
            .is_some_and(|meta| meta.route_used == "responses")
    {
        if let Some(key) = key {
            // Never associate a response with a different or now-expired login.
            if revision().as_ref() == Some(&key.credential)
                && runtime
                    .cancellation()
                    .commit_if_active(|| {
                        cache.lock().insert(key, result.clone(), Instant::now());
                    })
                    .is_none()
            {
                return cancelled_result(mode, "responses", started);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests;
