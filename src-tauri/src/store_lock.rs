//! Advisory file locks for App JSON store (E06 shared / multi-instance).
//!
//! CLI and a second App window may touch the same data root in `shared` mode.
//! We take an exclusive lock around read-modify-write of index files so the
//! index is not half-written, and use temp+rename for atomic replace.

use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use fs2::FileExt;

/// How long to wait for a lock before failing with a clear error.
const LOCK_WAIT: Duration = Duration::from_secs(3);
const LOCK_POLL: Duration = Duration::from_millis(40);

/// Sidecar lock path for `foo.json` → `foo.json.lock`.
pub fn lock_path_for(target: &Path) -> PathBuf {
    let mut s = target.as_os_str().to_os_string();
    s.push(".lock");
    PathBuf::from(s)
}

/// Holds an exclusive lock until dropped.
pub struct ExclusiveLock {
    _file: File,
    path: PathBuf,
}

impl Drop for ExclusiveLock {
    fn drop(&mut self) {
        // Best-effort unlock; File drop also releases the lock on most OSes.
        let _ = self._file.unlock();
        let _ = fs::remove_file(&self.path);
    }
}

/// Acquire exclusive lock for `target` (creates `target.lock`).
pub fn lock_exclusive(target: &Path) -> Result<ExclusiveLock, String> {
    let path = lock_path_for(target);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("lock dir: {e}"))?;
    }
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| format!("open lock {}: {e}", path.display()))?;

    let deadline = Instant::now() + LOCK_WAIT;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => {
                return Ok(ExclusiveLock {
                    _file: file,
                    path,
                });
            }
            Err(_) if Instant::now() < deadline => {
                thread::sleep(LOCK_POLL);
            }
            Err(e) => {
                return Err(format!(
                    "LOCK_BUSY: could not lock {} within {}ms ({e})",
                    path.display(),
                    LOCK_WAIT.as_millis()
                ));
            }
        }
    }
}

/// Run `body` while holding an exclusive lock on `target`.
pub fn with_exclusive_lock<T>(
    target: &Path,
    body: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lock = lock_exclusive(target)?;
    body()
}

/// Write bytes to `path` via temp file + rename under exclusive lock.
pub fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    with_exclusive_lock(path, || {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = {
            let mut p = path.as_os_str().to_os_string();
            p.push(".tmp");
            PathBuf::from(p)
        };
        fs::write(&tmp, bytes).map_err(|e| format!("write temp: {e}"))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename into place: {e}")
        })?;
        Ok(())
    })
}

/// True if error string is a lock contention failure.
pub fn is_lock_busy(err: &str) -> bool {
    err.contains("LOCK_BUSY")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn tmp_file(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "grok-store-lock-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        p
    }

    #[test]
    fn lock_path_suffix() {
        let p = PathBuf::from("/tmp/sessions_index.json");
        assert_eq!(
            lock_path_for(&p),
            PathBuf::from("/tmp/sessions_index.json.lock")
        );
    }

    #[test]
    fn atomic_write_roundtrip() {
        let path = tmp_file("atomic.json");
        write_bytes_atomic(&path, br#"{"ok":true}"#).unwrap();
        let s = fs::read_to_string(&path).unwrap();
        assert!(s.contains("ok"));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(lock_path_for(&path));
    }

    #[test]
    fn exclusive_blocks_second_holder() {
        let path = tmp_file("block.json");
        let barrier = Arc::new(Barrier::new(2));
        let path2 = path.clone();
        let b2 = Arc::clone(&barrier);

        let t = thread::spawn(move || {
            let _lock = lock_exclusive(&path2).expect("first lock");
            b2.wait();
            // Hold long enough for the other thread to time out path.
            thread::sleep(Duration::from_millis(200));
        });

        barrier.wait();
        // Second lock should fail quickly if we shrink wait — use direct try.
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(lock_path_for(&path))
            .unwrap();
        let busy = file.try_lock_exclusive().is_err();
        assert!(busy, "second exclusive lock should be busy");
        t.join().unwrap();
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(lock_path_for(&path));
    }

    #[test]
    fn is_lock_busy_detects_prefix() {
        assert!(is_lock_busy("LOCK_BUSY: could not lock"));
        assert!(!is_lock_busy("write temp: disk full"));
    }
}
