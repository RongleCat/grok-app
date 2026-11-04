//! Reference-driven GC for the attachment store.
//!
//! Mark: scan only `remoteIm` sessions (archived included) and collect
//! attachment ids. Sweep: delete old unmarked attachment rows, then blobs that
//! no row references. A 24h grace covers the write-before-journal window.

use super::AttachmentStore;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const GC_GRACE_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GcReport {
    pub sessions_scanned: usize,
    pub attachments_marked: usize,
    pub attachments_deleted: usize,
    pub blobs_deleted: usize,
    pub orphan_files_deleted: usize,
    pub bytes_freed: u64,
    pub skipped_young: usize,
    pub errors: Vec<String>,
}

impl AttachmentStore {
    pub fn gc(&self, now: SystemTime) -> Result<GcReport, String> {
        let now_secs = now
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let cutoff = now_secs - GC_GRACE_SECS;
        let mut report = GcReport::default();

        let index_path = self
            .sessions_dir()
            .parent()
            .ok_or_else(|| "attachment gc: sessions root has no parent".to_string())?
            .join("sessions_index.json");
        let raw = fs::read(&index_path)
            .map_err(|e| format!("attachment gc: read sessions index: {e}"))?;
        let sessions: Vec<serde_json::Value> = serde_json::from_slice(&raw)
            .map_err(|e| format!("attachment gc: parse sessions index: {e}"))?;

        let mut remote_sessions = HashSet::new();
        let mut all_sessions = HashSet::new();
        let mut marked = HashSet::new();
        for session in &sessions {
            let Some(id) = session.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            if !valid_session_id(id) {
                // Corrupt index entry: fail closed instead of guessing which
                // refs it might contain.
                return Err(format!("attachment gc: invalid session id: {id}"));
            }
            all_sessions.insert(id.to_string());
            let Some(channel) = session.get("remoteIm").and_then(|v| v.as_str()) else {
                continue;
            };
            remote_sessions.insert(id.to_string());
            report.sessions_scanned += 1;
            let _ = channel;
            let journal = self.sessions_dir().join(id).join("messages.json");
            let raw = match fs::read(&journal) {
                Ok(raw) => raw,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => {
                    // A read error must abort the sweep: otherwise this
                    // session's refs look unreferenced and could be deleted.
                    return Err(format!("attachment gc: read journal {id}: {err}"));
                }
            };
            let rows: Vec<serde_json::Value> = match serde_json::from_slice(&raw) {
                Ok(rows) => rows,
                Err(err) => {
                    return Err(format!("attachment gc: parse journal {id}: {err}"));
                }
            };
            for row in rows {
                let Some(attachments) = row.get("attachments").and_then(|v| v.as_array()) else {
                    continue;
                };
                for attachment in attachments {
                    if let Some(att_id) = attachment.get("id").and_then(|v| v.as_str()) {
                        marked.insert(att_id.to_string());
                    }
                }
            }
        }
        report.attachments_marked = marked.len();

        let conn = self.lock_conn()?;
        let attachment_rows: Vec<(String, String, Option<String>, i64)> = {
            let mut stmt = conn
                .prepare("SELECT id, origin, session_id, created_at FROM attachments")
                .map_err(|e| format!("attachment gc: prepare attachments: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(|e| format!("attachment gc: query attachments: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("attachment gc: read attachments: {e}"))?;
            rows
        };
        for (id, origin, session_id, created_at) in attachment_rows {
            if marked.contains(&id) {
                continue;
            }
            if !origin.starts_with("remote:") && !origin.starts_with("outbound:") {
                report
                    .errors
                    .push(format!("{id}: unexpected origin {origin}"));
                continue;
            }
            // Safety: a session that still exists but lacks the remote marker
            // may reference this id. Deleted sessions (absent from the index)
            // are collectable.
            if let Some(sid) = session_id.as_deref() {
                if all_sessions.contains(sid) && !remote_sessions.contains(sid) {
                    report
                        .errors
                        .push(format!("{id}: session {sid} lacks remoteIm; skipped"));
                    continue;
                }
            }
            if created_at >= cutoff {
                report.skipped_young += 1;
                continue;
            }
            match conn.execute(
                "DELETE FROM attachments WHERE id = ?1",
                rusqlite::params![id],
            ) {
                Ok(_) => report.attachments_deleted += 1,
                Err(err) => report.errors.push(format!("{id}: delete row: {err}")),
            }
        }

        let blob_rows: Vec<(String, i64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT sha256, size, created_at FROM blobs")
                .map_err(|e| format!("attachment gc: prepare blobs: {e}"))?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| format!("attachment gc: query blobs: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("attachment gc: read blobs: {e}"))?;
            rows
        };
        for (sha, size, created_at) in blob_rows {
            let refs: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM attachments WHERE sha256 = ?1",
                    rusqlite::params![sha],
                    |row| row.get(0),
                )
                .map_err(|e| format!("attachment gc: count refs: {e}"))?;
            if refs > 0 {
                continue;
            }
            if created_at >= cutoff {
                report.skipped_young += 1;
                continue;
            }
            if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
                report.errors.push(format!("{sha}: invalid blob hash"));
                continue;
            }
            let blob_dir = self.root_dir().join("blobs").join(&sha);
            if !blob_dir.starts_with(self.root_dir()) {
                report
                    .errors
                    .push(format!("{sha}: blob path escapes store"));
                continue;
            }
            if blob_dir.exists() {
                if let Err(err) = fs::remove_dir_all(&blob_dir) {
                    report.errors.push(format!("{sha}: remove blob: {err}"));
                    continue;
                }
            }
            match conn.execute(
                "DELETE FROM blobs WHERE sha256 = ?1",
                rusqlite::params![sha],
            ) {
                Ok(_) => {
                    report.blobs_deleted += 1;
                    report.bytes_freed = report.bytes_freed.saturating_add(size.max(0) as u64);
                }
                Err(err) => report.errors.push(format!("{sha}: delete blob row: {err}")),
            }
        }
        let known: HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT sha256 FROM blobs")
                .map_err(|e| format!("attachment gc: prepare known blobs: {e}"))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("attachment gc: query known blobs: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("attachment gc: read known blobs: {e}"))?;
            rows.into_iter().collect()
        };
        sweep_orphan_files(self.root_dir(), now, &known, &mut report);
        Ok(report)
    }
}

/// Remove blob dirs / staging files that no index row owns. These appear when
/// a crash happens between renaming the file and committing the DB row, or
/// when a download is abandoned.
fn sweep_orphan_files(
    root: &Path,
    now: SystemTime,
    known: &HashSet<String>,
    report: &mut GcReport,
) {
    let Some(cutoff) = now.checked_sub(Duration::from_secs(GC_GRACE_SECS as u64)) else {
        return;
    };
    let blobs = root.join("blobs");
    if let Ok(entries) = fs::read_dir(&blobs) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.len() != 64 || !name.chars().all(|c| c.is_ascii_hexdigit()) {
                continue;
            }
            if known.contains(&name) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_dir() || meta.modified().map(|m| m >= cutoff).unwrap_or(true) {
                continue;
            }
            match fs::remove_dir_all(entry.path()) {
                Ok(()) => report.orphan_files_deleted += 1,
                Err(err) => report
                    .errors
                    .push(format!("orphan blob {name}: remove: {err}")),
            }
        }
    }

    let staging = root.join("staging");
    if let Ok(entries) = fs::read_dir(&staging) {
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() || meta.modified().map(|m| m >= cutoff).unwrap_or(true) {
                continue;
            }
            match fs::remove_file(entry.path()) {
                Ok(()) => report.orphan_files_deleted += 1,
                Err(err) => report
                    .errors
                    .push(format!("orphan staging file: remove: {err}")),
            }
        }
    }
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::{AttachmentKind, NewAttachmentFile};
    use rusqlite::params;
    use std::path::PathBuf;
    use uuid::Uuid;

    struct Harness {
        base: PathBuf,
        store: AttachmentStore,
    }

    impl Harness {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!("attachment-gc-{}", Uuid::now_v7()));
            std::fs::create_dir_all(base.join("sessions")).unwrap();
            let store = AttachmentStore::open(base.join("store"), base.join("sessions")).unwrap();
            Self { base, store }
        }

        fn put(&self, session: &str, bytes: &[u8]) -> String {
            let source = self.base.join(format!("src-{}.tmp", Uuid::now_v7()));
            std::fs::write(&source, bytes).unwrap();
            let result = self.store.put_file(NewAttachmentFile {
                name: "a.png".into(),
                kind: AttachmentKind::Image,
                origin: "remote:feishu".into(),
                session_id: Some(session.into()),
                source: source.clone(),
            });
            let _ = std::fs::remove_file(&source);
            result.unwrap().id
        }

        fn age(&self, id: &str, secs: i64) {
            let conn = self.store.lock_conn().unwrap();
            conn.execute(
                "UPDATE attachments SET created_at = ?1 WHERE id = ?2",
                params![secs, id],
            )
            .unwrap();
            conn.execute(
                "UPDATE blobs SET created_at = ?1
                  WHERE sha256 = (SELECT sha256 FROM attachments WHERE id = ?2)",
                params![secs, id],
            )
            .unwrap();
        }

        fn journal(&self, session: &str, ids: &[&str]) {
            let rows: Vec<serde_json::Value> = ids
                .iter()
                .map(|id| serde_json::json!({ "attachments": [{ "id": id }] }))
                .collect();
            let dir = self.base.join("sessions").join(session);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("messages.json"),
                serde_json::to_vec(&rows).unwrap(),
            )
            .unwrap();
        }

        fn index(&self, remote_sessions: &[(&str, bool)]) {
            let rows: Vec<serde_json::Value> = remote_sessions
                .iter()
                .map(|(id, archived)| {
                    serde_json::json!({
                        "id": id,
                        "remoteIm": "feishu",
                        "archived": archived,
                    })
                })
                .collect();
            std::fs::write(
                self.base.join("sessions_index.json"),
                serde_json::to_vec(&rows).unwrap(),
            )
            .unwrap();
        }
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn keeps_archived_refs_and_collects_deleted_ones() {
        let h = Harness::new();
        let archived = h.put("s-archived", b"archived");
        let deleted = h.put("s-deleted", b"deleted");
        h.journal("s-archived", &[&archived]);
        h.index(&[("s-archived", true), ("s-deleted", false)]);
        h.age(&archived, 0);
        h.age(&deleted, 0);

        let report = h.store.gc(std::time::SystemTime::now()).expect("gc");
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(h.store.metadata(&archived).is_ok());
        assert!(h.store.metadata(&deleted).is_err());
        assert!(report.attachments_deleted >= 1);
    }

    #[test]
    fn shared_blob_survives_until_last_alias_is_gone() {
        let h = Harness::new();
        let kept = h.put("s1", b"same");
        let orphan = h.put("s1", b"same");
        h.journal("s1", &[&kept]);
        h.index(&[("s1", false)]);
        h.age(&kept, 0);
        h.age(&orphan, 0);

        let report = h.store.gc(std::time::SystemTime::now()).expect("gc");
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(h.store.metadata(&kept).is_ok());
        assert!(h.store.metadata(&orphan).is_err());
        assert_eq!(report.blobs_deleted, 0);
    }

    #[test]
    fn respects_grace_period() {
        let h = Harness::new();
        let id = h.put("s1", b"young");
        h.index(&[("s1", false)]);
        // No journal ref, but created now -> keep.
        let report = h.store.gc(std::time::SystemTime::now()).expect("gc");
        assert!(report.skipped_young >= 1);
        assert!(h.store.metadata(&id).is_ok());
    }

    #[test]
    fn skips_session_without_remote_marker() {
        let h = Harness::new();
        let id = h.put("local-session", b"local");
        let rows = serde_json::json!([
            { "id": "s1", "remoteIm": "feishu" },
            { "id": "local-session" }
        ]);
        std::fs::write(
            h.base.join("sessions_index.json"),
            serde_json::to_vec(&rows).unwrap(),
        )
        .unwrap();
        h.age(&id, 0);

        let report = h.store.gc(std::time::SystemTime::now()).expect("gc");
        assert!(report.errors.iter().any(|e| e.contains("lacks remoteIm")));
        assert!(h.store.metadata(&id).is_ok());
    }

    #[test]
    fn collects_refs_from_deleted_sessions() {
        let h = Harness::new();
        let id = h.put("gone-session", b"gone");
        h.index(&[("s1", false)]);
        h.age(&id, 0);

        let report = h.store.gc(std::time::SystemTime::now()).expect("gc");
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert!(h.store.metadata(&id).is_err());
    }

    #[test]
    fn journal_read_error_aborts_gc() {
        let h = Harness::new();
        let id = h.put("s1", b"keep");
        h.index(&[("s1", false)]);
        h.age(&id, 0);
        // A directory at messages.json makes fs::read fail; GC must abort
        // instead of treating the refs as missing.
        let dir = h.base.join("sessions/s1/messages.json");
        std::fs::create_dir_all(&dir).unwrap();

        let err = h.store.gc(std::time::SystemTime::now()).expect_err("fail");
        assert!(err.contains("read journal"), "{err}");
        assert!(h.store.metadata(&id).is_ok());
    }

    #[test]
    fn sweeps_orphan_blob_dirs_and_staging_files() {
        let h = Harness::new();
        let sha = "a".repeat(64);
        let orphan = h.base.join("store/blobs").join(&sha);
        std::fs::create_dir_all(&orphan).unwrap();
        std::fs::write(orphan.join("leftover.bin"), b"x").unwrap();
        let staging = h.base.join("store/staging/old.part");
        std::fs::write(&staging, b"x").unwrap();
        h.index(&[]);

        let future = std::time::SystemTime::now() + Duration::from_secs(2 * 86_400);
        let report = h.store.gc(future).expect("gc");
        assert!(!orphan.exists());
        assert!(!staging.exists());
        assert_eq!(report.orphan_files_deleted, 2);
    }
}
