//! Bounded, credential-scoped metadata cache. No tokens or image bytes are stored.
use super::*;
mod continuation;
pub(super) use continuation::claim;

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
    continuation: String,
    in_flight: bool,
    consumed: bool,
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
            .retain(|_, entry| entry.in_flight || now.duration_since(entry.inserted) < TTL);
        self.lru.retain(|key| self.entries.contains_key(key));
    }

    fn get(&mut self, key: &Key, now: Instant) -> Option<WallpaperSearchResult> {
        self.purge(now);
        let entry = self.entries.get(key)?;
        let mut result = entry.result.clone();
        if let Some(meta) = result.meta.as_mut() {
            meta.continuation_id =
                (!entry.in_flight && !entry.consumed).then(|| entry.continuation.clone());
        }
        self.lru.retain(|other| other != key);
        self.lru.push_back(key.clone());
        Some(result)
    }

    fn insert(
        &mut self,
        key: Key,
        mut result: WallpaperSearchResult,
        now: Instant,
    ) -> Option<String> {
        self.purge(now);
        if self.entries.get(&key).is_some_and(|entry| entry.in_flight) {
            return None;
        }
        self.lru.retain(|other| other != &key);
        while self.entries.len() >= CAPACITY && !self.entries.contains_key(&key) {
            let evict = self
                .lru
                .iter()
                .find(|k| self.entries.get(*k).is_some_and(|e| !e.in_flight))
                .cloned()?;
            self.lru.retain(|k| k != &evict);
            self.entries.remove(&evict);
        }
        if let Some(meta) = result.meta.as_mut() {
            meta.request_id = None;
            meta.cache_hit = false;
        }
        let continuation = uuid::Uuid::new_v4().to_string();
        self.entries.insert(
            key.clone(),
            Entry {
                inserted: now,
                continuation: continuation.clone(),
                in_flight: false,
                consumed: false,
                result,
            },
        );
        self.lru.push_back(key);
        Some(continuation)
    }
}

pub(super) struct CacheRequest<'a> {
    pub request_id: &'a str,
    pub query: &'a str,
    pub sort: Option<&'a str>,
    pub mode: &'a str,
    pub runtime: &'a WallpaperXSearchRuntime,
}

fn shared_cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub(super) async fn search_cached<F, Fut>(
    request: CacheRequest<'_>,
    run: F,
) -> WallpaperSearchResult
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = WallpaperSearchResult>,
{
    run_cached(
        request,
        shared_cache(),
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
    let mut result = run().await;
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
            if revision().as_ref() == Some(&key.credential) {
                let inserted = runtime
                    .cancellation()
                    .commit_if_active(|| cache.lock().insert(key, result.clone(), Instant::now()));
                match inserted {
                    None => return cancelled_result(mode, "responses", started),
                    Some(id) => {
                        if let Some(meta) = result.meta.as_mut() {
                            meta.continuation_id = id;
                        }
                    }
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests;
