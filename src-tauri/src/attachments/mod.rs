//! Host-side attachment store for remote-control media.
//!
//! Blobs are content-addressed by SHA-256; every upload gets its own UUIDv7
//! attachment row, so duplicate content shares one file while sessions keep
//! distinct references.

mod store;

// Consumed by the remote inbound/outbound slices next; see store.rs.
#[allow(unused_imports)]
pub use store::{
    AttachmentKind, AttachmentMeta, AttachmentRef, AttachmentStore, NewAttachment,
    NewAttachmentFile, NewAttachmentMeta, StagedAttachment, MAX_FILE_BYTES, MAX_SESSION_BYTES,
};
