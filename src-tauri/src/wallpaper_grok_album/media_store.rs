use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Weak};

use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use crate::wallpaper_source::{
    self, WallpaperFetchResult, WallpaperSearchCancellation, MAX_DOWNLOAD_BYTES,
};

const CACHE_EXTENSIONS: [&str; 7] = ["jpg", "png", "gif", "webp", "avif", "mp4", "webm"];

type MediaLock = AsyncMutex<()>;

static MEDIA_LOCKS: LazyLock<Mutex<HashMap<String, Weak<MediaLock>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn sha256_hex(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn media_key(url: &str) -> String {
    sha256_hex(url.as_bytes())
}

fn originals_dir() -> PathBuf {
    wallpaper_source::wallpapers_root()
        .join("grok_album")
        .join("originals")
}

fn media_path(key: &str, extension: &str) -> PathBuf {
    originals_dir().join(format!("{key}.{extension}"))
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove cached media: {error}")),
    }
}

fn remove_other_variants(key: &str, keep: Option<&Path>) -> Result<(), String> {
    for extension in CACHE_EXTENSIONS {
        let candidate = media_path(key, extension);
        if keep.is_some_and(|path| path == candidate) {
            continue;
        }
        remove_file_if_present(&candidate)?;
    }
    Ok(())
}

fn cached_result(path: &Path) -> Result<Option<WallpaperFetchResult>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("stat cached media: {error}")),
    };
    if !metadata.is_file() || metadata.len() < 64 || metadata.len() > MAX_DOWNLOAD_BYTES {
        remove_file_if_present(path)?;
        return Ok(None);
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("read cached media: {error}")),
    };
    let Ok((mime, extension)) = wallpaper_source::validate_fetched_media_bytes("", &bytes) else {
        remove_file_if_present(path)?;
        return Ok(None);
    };
    let actual_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !actual_extension.eq_ignore_ascii_case(extension) {
        remove_file_if_present(path)?;
        return Ok(None);
    }

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "cached media name unavailable".to_string())?
        .to_string();
    crate::path_scope::grant_path(path);
    Ok(Some(WallpaperFetchResult {
        path: path.display().to_string(),
        mime: mime.to_string(),
        bytes: bytes.len() as u64,
        name,
    }))
}

pub(super) fn lookup(url: &str) -> Result<Option<WallpaperFetchResult>, String> {
    let key = media_key(url);
    for extension in CACHE_EXTENSIONS {
        let path = media_path(&key, extension);
        if let Some(result) = cached_result(&path)? {
            remove_other_variants(&key, Some(&path))?;
            return Ok(Some(result));
        }
    }
    Ok(None)
}

fn lock_for_url(url: &str) -> Arc<MediaLock> {
    let key = media_key(url);
    let mut locks = MEDIA_LOCKS.lock();
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(AsyncMutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

pub(super) async fn acquire(
    url: &str,
    cancellation: &WallpaperSearchCancellation,
) -> Result<OwnedMutexGuard<()>, String> {
    let lock = lock_for_url(url);
    let cancellation_wait = cancellation.clone();
    tokio::select! {
        biased;
        _ = cancellation_wait.cancelled() => {
            Err("download_failed: album media cancelled".to_string())
        }
        guard = lock.lock_owned() => Ok(guard),
    }
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("create cached media: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("write cached media: {error}"))?;
    file.flush()
        .map_err(|error| format!("flush cached media: {error}"))
}

pub(super) fn save(
    url: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<WallpaperFetchResult, String> {
    if let Some(result) = lookup(url)? {
        return Ok(result);
    }
    let (mime, extension) = wallpaper_source::validate_fetched_media_bytes(content_type, &bytes)?;
    let key = media_key(url);
    let directory = originals_dir();
    fs::create_dir_all(&directory).map_err(|error| format!("create media cache: {error}"))?;
    remove_other_variants(&key, None)?;

    let path = media_path(&key, extension);
    let temporary = directory.join(format!(".{key}-{}.partial", uuid::Uuid::new_v4().simple()));
    if let Err(error) = write_new_file(&temporary, &bytes) {
        let _ = remove_file_if_present(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = remove_file_if_present(&temporary);
        if let Some(result) = lookup(url)? {
            return Ok(result);
        }
        return Err(format!("commit cached media: {error}"));
    }

    crate::path_scope::grant_path(&path);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "cached media name unavailable".to_string())?
        .to_string();
    Ok(WallpaperFetchResult {
        path: path.display().to_string(),
        mime: mime.to_string(),
        bytes: bytes.len() as u64,
        name,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use futures_util::future::join_all;

    use super::*;

    fn test_png() -> Vec<u8> {
        let mut bytes = vec![0u8; 128];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes
    }

    fn test_home(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "grok-app-album-media-{label}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn stable_cache_reuses_one_validated_file_and_rebuilds_damage() {
        let _environment = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let home = test_home("reuse");
        // SAFETY: test-only mutation serialized by APP_HOME_ENV_LOCK.
        unsafe { std::env::set_var("GROK_APP_HOME", &home) };
        let url = "https://assets.grok.com/users/test/generated/stable.png";

        let first = save(url, "image/png", test_png()).expect("initial save");
        let second = lookup(url).expect("cache lookup").expect("cache hit");
        assert_eq!(first.path, second.path);
        assert_eq!(second.mime, "image/png");

        fs::write(&first.path, vec![b'x'; 128]).expect("corrupt cache");
        assert!(lookup(url).expect("corrupt lookup").is_none());
        assert!(!Path::new(&first.path).exists());
        let rebuilt = save(url, "image/png", test_png()).expect("rebuild corrupt cache");
        assert_eq!(first.path, rebuilt.path);

        fs::remove_file(&rebuilt.path).expect("delete cache");
        assert!(lookup(url).expect("deleted lookup").is_none());
        let restored = save(url, "image/png", test_png()).expect("restore deleted cache");
        assert_eq!(first.path, restored.path);

        unsafe { std::env::remove_var("GROK_APP_HOME") };
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn concurrent_requests_commit_one_stable_file() {
        let _environment = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let home = test_home("concurrent");
        // SAFETY: test-only mutation serialized by APP_HOME_ENV_LOCK.
        unsafe { std::env::set_var("GROK_APP_HOME", &home) };
        let url = "https://assets.grok.com/users/test/generated/concurrent.png";
        let writes = AtomicUsize::new(0);

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime");
        let results = runtime.block_on(async {
            let requests = (0..8).map(|_| async {
                let cancellation = WallpaperSearchCancellation::default();
                let _guard = acquire(url, &cancellation).await.expect("media lock");
                if let Some(result) = lookup(url).expect("cache lookup") {
                    return result;
                }
                writes.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                save(url, "image/png", test_png()).expect("save")
            });
            join_all(requests).await
        });
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(|result| result.path == results[0].path));
        let files = fs::read_dir(originals_dir())
            .expect("originals directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);

        unsafe { std::env::remove_var("GROK_APP_HOME") };
        let _ = fs::remove_dir_all(home);
    }
}
