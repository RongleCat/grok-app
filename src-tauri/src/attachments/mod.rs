//! Host-side attachment store for remote-control media.
//!
//! Blobs are content-addressed by SHA-256; every upload gets its own UUIDv7
//! attachment row, so duplicate content shares one file while sessions keep
//! distinct references.

mod gc;
mod store;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

pub use gc::GcReport;
pub(crate) use store::create_staging_file;
pub use store::{
    file_sha256, AttachmentKind, AttachmentRef, AttachmentStore, NewAttachmentFile,
    NewAttachmentMeta, StagedAttachment, MAX_FILE_BYTES, MAX_SESSION_BYTES,
};

const GC_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
static GC_QUEUED: AtomicBool = AtomicBool::new(false);
static GC_LOCK: Mutex<()> = Mutex::new(());

/// Process-wide store used by the remote-control bridge. The first caller
/// initializes the app-data root; later callers share the same SQLite handle.
pub fn shared() -> Result<AttachmentStore, String> {
    static STORE: OnceLock<Result<AttachmentStore, String>> = OnceLock::new();
    STORE.get_or_init(AttachmentStore::open_default).clone()
}

/// Delete the pre-store Feishu media directory. The transition build wrote
/// test images there; the store is now the only owner of remote attachments.
pub fn cleanup_legacy_media() {
    let dir = crate::paths::app_data_root().join("remote").join("media");
    if !dir.exists() {
        return;
    }
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => tracing::info!(path = %dir.display(), "removed legacy remote media dir"),
        Err(err) => {
            tracing::warn!(path = %dir.display(), error = %err, "legacy media cleanup failed")
        }
    }
}

/// Run GC now (Host command / tests). One run at a time.
pub fn gc_now() -> Result<GcReport, String> {
    let _guard = GC_LOCK
        .lock()
        .map_err(|_| "attachment gc: lock poisoned".to_string())?;
    shared()?.gc(SystemTime::now())
}

/// Debounced GC after session deletion / rewind. Concurrent requests coalesce.
pub fn schedule_gc() {
    if GC_QUEUED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        GC_QUEUED.store(false, Ordering::SeqCst);
        return;
    };
    handle.spawn(async {
        struct ClearQueued;
        impl Drop for ClearQueued {
            fn drop(&mut self) {
                GC_QUEUED.store(false, Ordering::SeqCst);
            }
        }
        let _clear = ClearQueued;
        tokio::time::sleep(Duration::from_secs(30)).await;
        let _ = tokio::task::spawn_blocking(gc_now).await;
    });
}

/// Startup/idle GC, at most once per 24h.
pub async fn gc_if_due() {
    let Ok(store) = shared() else {
        return;
    };
    let marker = store.root_dir().join("last_gc");
    if let Ok(meta) = std::fs::metadata(&marker) {
        if let Ok(modified) = meta.modified() {
            if modified.elapsed().unwrap_or_default() < GC_INTERVAL {
                return;
            }
        }
    }
    let result = tokio::task::spawn_blocking(gc_now).await;
    match result {
        Ok(Ok(report)) => {
            tracing::info!(
                sessions = report.sessions_scanned,
                marked = report.attachments_marked,
                deleted = report.attachments_deleted,
                blobs = report.blobs_deleted,
                orphans = report.orphan_files_deleted,
                bytes = report.bytes_freed,
                errors = report.errors.len(),
                "attachment gc complete"
            );
            let _ = std::fs::write(store.root_dir().join("last_gc"), b"");
        }
        Ok(Err(err)) => tracing::warn!(error = %err, "attachment gc aborted"),
        Err(err) => tracing::warn!(error = %err, "attachment gc task failed"),
    }
}
