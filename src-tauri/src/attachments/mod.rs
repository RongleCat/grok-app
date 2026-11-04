//! Host-side attachment store for remote-control media.
//!
//! Blobs are content-addressed by SHA-256; every upload gets its own UUIDv7
//! attachment row, so duplicate content shares one file while sessions keep
//! distinct references.

mod store;

use std::sync::OnceLock;

pub use store::{
    AttachmentKind, AttachmentRef, AttachmentStore, NewAttachmentMeta, StagedAttachment,
    MAX_SESSION_BYTES,
};

/// Process-wide store used by the remote-control bridge. The first caller
/// initializes the app-data root; later callers share the same SQLite handle.
pub fn shared() -> Result<AttachmentStore, String> {
    static STORE: OnceLock<Result<AttachmentStore, String>> = OnceLock::new();
    STORE.get_or_init(AttachmentStore::open_default).clone()
}
