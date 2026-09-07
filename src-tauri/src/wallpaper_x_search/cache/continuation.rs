//! One exclusive continuation per cached gallery. Failed/abandoned work restores it.
use super::*;

pub(in crate::wallpaper_x_search) struct Lease<'a> {
    cache: &'a Mutex<Cache>,
    key: Key,
    id: String,
    pub query: String,
    pub sort: &'static str,
    pub items: Vec<wallpaper_source::WallpaperGalleryItem>,
}

pub(in crate::wallpaper_x_search) fn claim(
    id: &str,
    revision: &BuildOauthCredentialRevision,
) -> Option<Lease<'static>> {
    claim_from(shared_cache(), id, revision, Instant::now())
}

fn claim_from<'a>(
    cache: &'a Mutex<Cache>,
    id: &str,
    revision: &BuildOauthCredentialRevision,
    now: Instant,
) -> Option<Lease<'a>> {
    let mut entries = cache.lock();
    entries.purge(now);
    let (key, entry) = entries.entries.iter_mut().find(|(key, entry)| {
        key.credential == *revision
            && entry.continuation == id
            && !entry.in_flight
            && !entry.consumed
    })?;
    entry.in_flight = true;
    Some(Lease {
        cache,
        key: key.clone(),
        id: id.into(),
        query: key.query.clone(),
        sort: if key.latest { "latest" } else { "top" },
        items: entry.result.items.clone(),
    })
}

impl Lease<'_> {
    pub(in crate::wallpaper_x_search) fn consume(&self, runtime: &WallpaperXSearchRuntime) -> bool {
        runtime
            .cancellation()
            .commit_if_active(|| {
                let mut cache = self.cache.lock();
                if let Some(entry) = cache
                    .entries
                    .get_mut(&self.key)
                    .filter(|entry| entry.continuation == self.id)
                {
                    entry.consumed = true;
                    entry.in_flight = false;
                }
            })
            .is_some()
    }
}

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        let mut cache = self.cache.lock();
        if let Some(entry) = cache
            .entries
            .get_mut(&self.key)
            .filter(|entry| entry.continuation == self.id && entry.in_flight)
        {
            entry.in_flight = false;
            // Preserve a retry opportunity even if the network call outlived TTL.
            entry.inserted = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{revision, success};
    use super::*;

    #[test]
    fn lease_is_exclusive_restores_on_drop_and_consumes_once() {
        let cache = Mutex::new(Cache::default());
        let key = Key {
            query: "sky".into(),
            latest: false,
            credential: revision(1),
        };
        let now = Instant::now();
        let id = cache.lock().insert(key.clone(), success(), now).unwrap();
        assert!(claim_from(&cache, &id, &revision(2), now).is_none());
        let lease = claim_from(&cache, &id, &revision(1), now).unwrap();
        assert!(claim_from(&cache, &id, &revision(1), now).is_none());
        cache.lock().purge(now + TTL);
        assert!(cache
            .lock()
            .insert(key.clone(), success(), now + TTL)
            .is_none());
        drop(lease);
        let lease = claim_from(&cache, &id, &revision(1), Instant::now()).unwrap();
        let runtime = WallpaperXSearchRuntime::quiet();
        runtime.cancellation().cancel();
        assert!(!lease.consume(&runtime));
        drop(lease);
        let lease = claim_from(&cache, &id, &revision(1), Instant::now()).unwrap();
        assert!(lease.consume(&WallpaperXSearchRuntime::quiet()));
        drop(lease);
        assert!(claim_from(&cache, &id, &revision(1), Instant::now()).is_none());
        assert!(cache
            .lock()
            .get(&key, Instant::now())
            .unwrap()
            .meta
            .unwrap()
            .continuation_id
            .is_none());
    }
}
