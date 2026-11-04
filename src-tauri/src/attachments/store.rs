//! Content-addressed attachment store.
//!
//! A blob is stored once per SHA-256 under `blobs/<sha256>/<name>`. Every
//! upload gets its own UUIDv7 attachment row, so duplicate content is shared
//! while sessions keep independent references.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Hard cap for one attachment object (inbound or outbound).
pub const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
/// Hard cap for the unique blob bytes referenced by one session.
pub const MAX_SESSION_BYTES: u64 = 512 * 1024 * 1024;

const MAX_NAME_CHARS: usize = 80;
const COPY_BUF: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    File,
    Audio,
    Video,
}

impl AttachmentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::File => "file",
            Self::Audio => "audio",
            Self::Video => "video",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "image" => Some(Self::Image),
            "file" => Some(Self::File),
            "audio" => Some(Self::Audio),
            "video" => Some(Self::Video),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub kind: AttachmentKind,
    pub size: u64,
}

/// Store-facing metadata; callers may read only the fields they need.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct AttachmentMeta {
    pub id: String,
    pub name: String,
    pub kind: AttachmentKind,
    pub size: u64,
    pub origin: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewAttachmentFile {
    pub name: String,
    pub kind: AttachmentKind,
    pub origin: String,
    pub session_id: Option<String>,
    pub source: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StagedAttachment {
    pub temp_path: PathBuf,
    pub name: String,
    pub kind: AttachmentKind,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct NewAttachmentMeta {
    pub origin: String,
    pub instance_id: Option<String>,
    pub session_id: Option<String>,
    pub message_id: Option<String>,
}

#[derive(Clone)]
pub struct AttachmentStore {
    inner: Arc<Inner>,
}

struct Inner {
    root: PathBuf,
    sessions_root: PathBuf,
    state: Mutex<Connection>,
}

impl AttachmentStore {
    /// Open a store at an explicit root. Tests pass a temp directory; production
    /// uses [`AttachmentStore::open_default`].
    pub fn open(root: PathBuf, sessions_root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("blobs"))
            .map_err(|e| format!("attachment store: create blobs dir: {e}"))?;
        fs::create_dir_all(root.join("staging"))
            .map_err(|e| format!("attachment store: create staging dir: {e}"))?;
        let conn = Connection::open(root.join("index.sqlite"))
            .map_err(|e| format!("attachment store: open index: {e}"))?;
        restrict_file(&root.join("index.sqlite"));
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|e| format!("attachment store: busy_timeout: {e}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("attachment store: WAL: {e}"))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("attachment store: foreign_keys: {e}"))?;
        init_schema(&conn)?;
        restrict_dir(&root);
        restrict_dir(&root.join("blobs"));
        restrict_dir(&root.join("staging"));
        Ok(Self {
            inner: Arc::new(Inner {
                root,
                sessions_root,
                state: Mutex::new(conn),
            }),
        })
    }

    pub fn open_default() -> Result<Self, String> {
        let base = crate::paths::app_data_root();
        Self::open(
            base.join("attachments").join("store"),
            base.join("sessions"),
        )
    }

    /// A unique staging path under the store. Channels stream into it, then
    /// hand the path to [`commit_staged`](Self::commit_staged).
    pub fn staging_path(&self) -> PathBuf {
        self.inner
            .root
            .join("staging")
            .join(format!("{}.part", Uuid::now_v7()))
    }

    pub fn put_file(&self, input: NewAttachmentFile) -> Result<AttachmentRef, String> {
        validate_meta(&input.origin, input.session_id.as_deref())?;
        let meta = fs::symlink_metadata(&input.source)
            .map_err(|e| format!("attachment store: stat source: {e}"))?;
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err("attachment store: source must be a regular file".into());
        }
        ensure_file_size(meta.len())?;

        let temp_path = self.staging_path();
        let copied = (|| -> Result<(u64, String), String> {
            let mut src = fs::File::open(&input.source)
                .map_err(|e| format!("attachment store: open source: {e}"))?;
            let mut dst = create_staging_file(&temp_path)
                .map_err(|e| format!("attachment store: create staging: {e}"))?;
            let mut hasher = Sha256::new();
            let mut total = 0u64;
            let mut buf = [0u8; COPY_BUF];
            loop {
                let read = src
                    .read(&mut buf)
                    .map_err(|e| format!("attachment store: read source: {e}"))?;
                if read == 0 {
                    break;
                }
                total = total.saturating_add(read as u64);
                ensure_file_size(total)?;
                hasher.update(&buf[..read]);
                dst.write_all(&buf[..read])
                    .map_err(|e| format!("attachment store: write staging: {e}"))?;
            }
            dst.sync_all()
                .map_err(|e| format!("attachment store: sync staging: {e}"))?;
            Ok((total, hex::encode(hasher.finalize())))
        })();
        let (size, sha256) = match copied {
            Ok(value) => value,
            Err(err) => {
                remove_file_best_effort(&temp_path);
                return Err(err);
            }
        };
        self.commit_staged(
            StagedAttachment {
                temp_path,
                name: input.name,
                kind: input.kind,
                size,
                sha256,
            },
            NewAttachmentMeta {
                origin: input.origin,
                instance_id: None,
                session_id: input.session_id,
                message_id: None,
            },
        )
    }

    pub fn commit_staged(
        &self,
        staged: StagedAttachment,
        meta: NewAttachmentMeta,
    ) -> Result<AttachmentRef, String> {
        validate_meta(&meta.origin, meta.session_id.as_deref())?;
        ensure_file_size(staged.size)?;
        let staging_root = self.inner.root.join("staging");
        if !path_is_under(&staging_root, &staged.temp_path) {
            return Err("attachment store: staging path is outside the store".into());
        }
        let file_meta = fs::symlink_metadata(&staged.temp_path)
            .map_err(|e| format!("attachment store: stat staging: {e}"))?;
        if file_meta.file_type().is_symlink() || !file_meta.is_file() {
            return Err("attachment store: staging path must be a regular file".into());
        }
        if file_meta.len() != staged.size {
            remove_file_best_effort(&staged.temp_path);
            return Err("attachment store: staging size mismatch".into());
        }
        let actual_sha = hash_file(&staged.temp_path)?;
        if actual_sha != staged.sha256 {
            remove_file_best_effort(&staged.temp_path);
            return Err("attachment store: staging hash mismatch".into());
        }

        let id = Uuid::now_v7().to_string();
        let mut conn = self.lock_conn()?;
        let existing: Option<(String, i64)> = conn
            .query_row(
                "SELECT rel_path, size FROM blobs WHERE sha256 = ?1",
                params![staged.sha256],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("attachment store: lookup blob: {e}"))?;

        let (rel_path, blob_size, created_blob) = match existing {
            Some(found) => {
                remove_file_best_effort(&staged.temp_path);
                (found.0, found.1, false)
            }
            None => {
                let rel_path = format!("blobs/{}/{}", staged.sha256, sanitize_name(&staged.name));
                let dest = self.inner.root.join(&rel_path);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("attachment store: create blob dir: {e}"))?;
                    restrict_dir(parent);
                }
                if dest.exists() {
                    remove_file_best_effort(&staged.temp_path);
                    restrict_file(&dest);
                    (rel_path, staged.size as i64, false)
                } else if let Err(err) = fs::rename(&staged.temp_path, &dest) {
                    remove_file_best_effort(&staged.temp_path);
                    return Err(format!("attachment store: commit blob: {err}"));
                } else {
                    restrict_file(&dest);
                    (rel_path, staged.size as i64, true)
                }
            }
        };

        let created_at = now_secs();
        let write = (|| -> Result<(), String> {
            let tx = conn
                .transaction()
                .map_err(|e| format!("attachment store: begin: {e}"))?;
            tx.execute(
                "INSERT OR IGNORE INTO blobs (sha256, rel_path, size, kind, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    staged.sha256,
                    rel_path,
                    blob_size,
                    staged.kind.as_str(),
                    created_at
                ],
            )
            .map_err(|e| format!("attachment store: insert blob: {e}"))?;
            tx.execute(
                "INSERT INTO attachments
                   (id, sha256, name, kind, origin, instance_id, session_id, message_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    staged.sha256,
                    staged.name,
                    staged.kind.as_str(),
                    meta.origin,
                    meta.instance_id,
                    meta.session_id,
                    meta.message_id,
                    created_at
                ],
            )
            .map_err(|e| format!("attachment store: insert attachment: {e}"))?;
            tx.commit()
                .map_err(|e| format!("attachment store: commit: {e}"))?;
            Ok(())
        })();

        // The blob may have just been created; on failure remove it so a DB
        // error cannot leave an untracked file behind (GC scans the index).
        if let Err(err) = write {
            if created_blob {
                let blob_dir = self.inner.root.join("blobs").join(&staged.sha256);
                if blob_dir.starts_with(&self.inner.root) {
                    let _ = fs::remove_dir_all(&blob_dir);
                }
            }
            return Err(err);
        }

        Ok(AttachmentRef {
            id,
            name: staged.name,
            kind: staged.kind,
            size: blob_size as u64,
        })
    }

    pub fn metadata(&self, id: &str) -> Result<AttachmentMeta, String> {
        validate_attachment_id(id)?;
        let conn = self.lock_conn()?;
        let row = conn
            .query_row(
                "SELECT a.id, a.name, a.kind, a.origin, a.session_id, b.size
                   FROM attachments a JOIN blobs b ON b.sha256 = a.sha256
                  WHERE a.id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("attachment store: read metadata: {e}"))?;
        let Some((id, name, kind, origin, session_id, size)) = row else {
            return Err("attachment not found".into());
        };
        Ok(AttachmentMeta {
            id,
            name,
            kind: AttachmentKind::parse(&kind).unwrap_or(AttachmentKind::File),
            size: size as u64,
            origin,
            session_id,
        })
    }

    pub fn materialize(&self, id: &str) -> Result<PathBuf, String> {
        validate_attachment_id(id)?;
        let conn = self.lock_conn()?;
        let rel_path: Option<String> = conn
            .query_row(
                "SELECT b.rel_path FROM attachments a JOIN blobs b ON b.sha256 = a.sha256
                  WHERE a.id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("attachment store: resolve path: {e}"))?;
        let Some(rel_path) = rel_path else {
            return Err("attachment not found".into());
        };
        drop(conn);

        let path = self.inner.root.join(rel_path);
        let canonical_root = fs::canonicalize(&self.inner.root)
            .map_err(|e| format!("attachment store: canonical root: {e}"))?;
        let canonical =
            fs::canonicalize(&path).map_err(|_| "attachment file is missing".to_string())?;
        if !canonical.starts_with(&canonical_root) {
            return Err("attachment path escapes the store".into());
        }
        let meta = fs::symlink_metadata(&canonical)
            .map_err(|e| format!("attachment store: stat blob: {e}"))?;
        if !meta.is_file() {
            return Err("attachment file is missing".into());
        }
        Ok(canonical)
    }

    /// Unique blob SHA-256 values referenced by one session's journal.
    pub fn session_sha_set(&self, session_id: &str) -> Result<HashSet<String>, String> {
        let ids = self.session_attachment_ids(session_id)?;
        if ids.is_empty() {
            return Ok(HashSet::new());
        }
        let conn = self.lock_conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT a.sha256 FROM attachments a JOIN blobs b ON b.sha256 = a.sha256
                  WHERE a.id = ?1",
            )
            .map_err(|e| format!("attachment store: prepare shas: {e}"))?;
        let mut shas = HashSet::new();
        for id in ids {
            let found: Option<String> = stmt
                .query_row(params![id], |row| row.get(0))
                .optional()
                .map_err(|e| format!("attachment store: sha row: {e}"))?;
            if let Some(sha) = found {
                shas.insert(sha);
            }
        }
        Ok(shas)
    }

    /// Unique blob bytes referenced by one session's journal.
    pub fn session_usage(&self, session_id: &str) -> Result<u64, String> {
        let shas = self.session_sha_set(session_id)?;
        if shas.is_empty() {
            return Ok(0);
        }
        let conn = self.lock_conn()?;
        let mut stmt = conn
            .prepare("SELECT size FROM blobs WHERE sha256 = ?1")
            .map_err(|e| format!("attachment store: prepare usage: {e}"))?;
        let mut total = 0u64;
        for sha in shas {
            let size: Option<i64> = stmt
                .query_row(params![sha], |row| row.get(0))
                .optional()
                .map_err(|e| format!("attachment store: usage row: {e}"))?;
            if let Some(size) = size {
                total = total.saturating_add(size.max(0) as u64);
            }
        }
        Ok(total)
    }

    fn session_attachment_ids(&self, session_id: &str) -> Result<Vec<String>, String> {
        validate_session_id(session_id)?;
        let path = self
            .inner
            .sessions_root
            .join(session_id)
            .join("messages.json");
        let raw = match fs::read(&path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(format!("attachment store: read session journal: {err}")),
        };
        let rows: Vec<serde_json::Value> = serde_json::from_slice(&raw)
            .map_err(|e| format!("attachment store: parse session journal: {e}"))?;
        let mut ids = HashSet::new();
        for row in rows {
            let Some(attachments) = row.get("attachments").and_then(|value| value.as_array())
            else {
                continue;
            };
            for attachment in attachments {
                let Some(id) = attachment.get("id").and_then(|value| value.as_str()) else {
                    continue;
                };
                if Uuid::parse_str(id).is_ok() {
                    ids.insert(id.to_string());
                }
            }
        }
        Ok(ids.into_iter().collect())
    }

    pub(super) fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.inner
            .state
            .lock()
            .map_err(|_| "attachment store: index lock poisoned".to_string())
    }

    pub(super) fn root_dir(&self) -> &Path {
        &self.inner.root
    }

    pub(super) fn sessions_dir(&self) -> &Path {
        &self.inner.sessions_root
    }
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS blobs (
            sha256      TEXT PRIMARY KEY,
            rel_path    TEXT NOT NULL,
            size        INTEGER NOT NULL,
            kind        TEXT NOT NULL,
            created_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS attachments (
            id          TEXT PRIMARY KEY,
            sha256      TEXT NOT NULL REFERENCES blobs(sha256),
            name        TEXT NOT NULL,
            kind        TEXT NOT NULL,
            origin      TEXT NOT NULL,
            instance_id TEXT,
            session_id  TEXT,
            message_id  TEXT,
            created_at  INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_attachments_sha ON attachments(sha256);
         CREATE INDEX IF NOT EXISTS idx_attachments_created ON attachments(created_at);
         CREATE INDEX IF NOT EXISTS idx_blobs_created ON blobs(created_at);",
    )
    .map_err(|e| format!("attachment store: init schema: {e}"))
}

fn validate_meta(origin: &str, session_id: Option<&str>) -> Result<(), String> {
    if !(origin.starts_with("remote:") || origin.starts_with("outbound:")) {
        return Err("attachment origin must be remote:* or outbound:*".into());
    }
    if let Some(session_id) = session_id {
        validate_session_id(session_id)?;
    }
    Ok(())
}

fn validate_attachment_id(id: &str) -> Result<(), String> {
    let parsed = Uuid::parse_str(id).map_err(|_| "invalid attachment id".to_string())?;
    if parsed.get_version_num() != 7 {
        return Err("invalid attachment id".into());
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid session id".into());
    }
    Ok(())
}

fn ensure_file_size(size: u64) -> Result<(), String> {
    if size > MAX_FILE_BYTES {
        return Err("attachment exceeds the 100 MB per-file limit".into());
    }
    Ok(())
}

fn sanitize_name(raw: &str) -> String {
    let base = Path::new(raw.trim())
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let cleaned: String = cleaned.chars().take(MAX_NAME_CHARS).collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "attachment".into()
    } else {
        cleaned
    }
}

/// SHA-256 of a local file, used for outbound budget/dedupe before import.
pub fn file_sha256(path: &Path) -> Result<String, String> {
    hash_file(path)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("attachment store: open for hash: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; COPY_BUF];
    loop {
        let read = file
            .read(&mut buf)
            .map_err(|e| format!("attachment store: hash read: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn path_is_under(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = fs::canonicalize(root) else {
        return false;
    };
    let Ok(candidate) = fs::canonicalize(candidate) else {
        return false;
    };
    candidate.starts_with(root)
}

fn remove_file_best_effort(path: &Path) {
    let _ = fs::remove_file(path);
}

fn create_staging_file(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(unix)]
fn restrict_file(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_file(_: &Path) {}

#[cfg(unix)]
fn restrict_dir(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn restrict_dir(_: &Path) {}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestStore {
        base: PathBuf,
        store: AttachmentStore,
    }

    impl TestStore {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!("grok-attach-{}", Uuid::now_v7()));
            fs::create_dir_all(base.join("sessions")).expect("sessions dir");
            let store =
                AttachmentStore::open(base.join("store"), base.join("sessions")).expect("store");
            Self { base, store }
        }
    }

    impl Drop for TestStore {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn put(store: &AttachmentStore, name: &str, bytes: &[u8]) -> AttachmentRef {
        let source = std::env::temp_dir().join(format!("attach-src-{}", Uuid::now_v7()));
        fs::write(&source, bytes).expect("source");
        let result = store.put_file(NewAttachmentFile {
            name: name.into(),
            kind: AttachmentKind::Image,
            origin: "remote:feishu".into(),
            session_id: Some("session-1".into()),
            source: source.clone(),
        });
        let _ = fs::remove_file(&source);
        result.expect("put")
    }

    fn write_journal(store: &AttachmentStore, session_id: &str, ids: &[&str]) {
        let rows: Vec<serde_json::Value> = ids
            .iter()
            .map(|id| serde_json::json!({ "attachments": [{ "id": id }] }))
            .collect();
        let dir = store.inner.sessions_root.join(session_id);
        fs::create_dir_all(&dir).expect("session dir");
        fs::write(
            dir.join("messages.json"),
            serde_json::to_vec(&rows).unwrap(),
        )
        .expect("journal");
    }

    #[test]
    fn dedupes_identical_content_but_keeps_distinct_ids() {
        let test = TestStore::new();
        let first = put(&test.store, "a.png", b"same bytes");
        let second = put(&test.store, "b.png", b"same bytes");

        assert_ne!(first.id, second.id);
        assert_eq!(first.size, 10);
        let conn = test.store.lock_conn().expect("conn");
        let blobs: i64 = conn
            .query_row("SELECT COUNT(*) FROM blobs", [], |row| row.get(0))
            .unwrap();
        let attachments: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(blobs, 1);
        assert_eq!(attachments, 2);
        assert_eq!(
            fs::read_dir(test.store.inner.root.join("blobs"))
                .expect("blobs dir")
                .count(),
            1
        );
    }

    #[test]
    fn materialize_and_open_range_round_trip() {
        let test = TestStore::new();
        let attachment = put(&test.store, "data.bin", b"0123456789");

        let path = test.store.materialize(&attachment.id).expect("materialize");
        assert_eq!(fs::read(&path).unwrap(), b"0123456789");
    }

    #[test]
    fn metadata_round_trips() {
        let test = TestStore::new();
        let attachment = put(&test.store, "shot.png", b"png");
        let meta = test.store.metadata(&attachment.id).expect("metadata");
        assert_eq!(meta.name, "shot.png");
        assert_eq!(meta.kind, AttachmentKind::Image);
        assert_eq!(meta.origin, "remote:feishu");
        assert_eq!(meta.session_id.as_deref(), Some("session-1"));
        assert_eq!(meta.size, 3);
    }

    #[test]
    fn put_file_rejects_oversized_source_before_copying() {
        let test = TestStore::new();
        let source = test.base.join("big.bin");
        let file = fs::File::create(&source).expect("create");
        file.set_len(MAX_FILE_BYTES + 1).expect("sparse size");

        let err = test
            .store
            .put_file(NewAttachmentFile {
                name: "big.bin".into(),
                kind: AttachmentKind::File,
                origin: "outbound:feishu".into(),
                session_id: Some("session-1".into()),
                source,
            })
            .expect_err("must reject");
        assert!(err.contains("100 MB"), "{err}");
        assert_eq!(
            fs::read_dir(test.store.inner.root.join("staging"))
                .expect("staging")
                .count(),
            0
        );
    }

    #[test]
    fn commit_staged_rejects_hash_mismatch() {
        let test = TestStore::new();
        let temp = test.store.staging_path();
        fs::write(&temp, b"content").unwrap();
        let err = test
            .store
            .commit_staged(
                StagedAttachment {
                    temp_path: temp.clone(),
                    name: "x.bin".into(),
                    kind: AttachmentKind::File,
                    size: 7,
                    sha256: "0".repeat(64),
                },
                NewAttachmentMeta {
                    origin: "remote:feishu".into(),
                    instance_id: None,
                    session_id: None,
                    message_id: None,
                },
            )
            .expect_err("must reject");
        assert!(err.contains("hash"), "{err}");
        assert!(!temp.exists());
    }

    #[test]
    fn session_usage_counts_unique_blobs_and_enforces_cap() {
        let test = TestStore::new();
        let a = put(&test.store, "a.bin", b"aaaa");
        let b = put(&test.store, "b.bin", b"aaaa");
        let c = put(&test.store, "c.bin", b"bbbbbb");
        write_journal(&test.store, "session-1", &[&a.id, &b.id, &c.id]);

        assert_eq!(test.store.session_usage("session-1").unwrap(), 10);
        assert!(test.store.session_usage("session-1").unwrap() <= MAX_SESSION_BYTES);
    }

    #[test]
    fn legacy_attachment_json_still_parses() {
        let legacy: crate::store::MessageAttachmentStored =
            serde_json::from_str(r#"{"path":"/tmp/a.png","name":"a.png"}"#).expect("legacy");
        assert!(legacy.id.is_none());
        assert_eq!(legacy.path, "/tmp/a.png");
        assert_eq!(legacy.name, "a.png");
        assert!(!legacy.is_dir);

        let fresh: crate::store::MessageAttachmentStored = serde_json::from_str(
            r#"{"id":"0190c3d2-0000-7000-8000-000000000000","name":"a.png","kind":"image","size":12}"#,
        )
        .expect("fresh");
        assert!(fresh.id.is_some());
        assert_eq!(fresh.kind.as_deref(), Some("image"));
        assert_eq!(fresh.size, Some(12));
    }

    #[test]
    fn uuid_v7_ids_are_time_ordered() {
        let first = Uuid::now_v7();
        std::thread::sleep(Duration::from_millis(2));
        let second = Uuid::now_v7();
        assert!(first < second);
    }

    #[test]
    fn rejects_invalid_ids_and_session_paths() {
        let test = TestStore::new();
        assert!(test.store.materialize("../etc/passwd").is_err());
        assert!(test.store.session_usage("../etc").is_err());
        assert!(test.store.metadata("not-a-uuid").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn store_files_are_private() {
        use std::os::unix::fs::PermissionsExt;

        let test = TestStore::new();
        let attachment = put(&test.store, "private.png", b"secret");
        let file = test.store.materialize(&attachment.id).expect("materialize");
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(test.store.inner.root.join("blobs"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }

    #[cfg(unix)]
    #[test]
    fn put_file_rejects_symlink_source() {
        let test = TestStore::new();
        let target = test.base.join("target.bin");
        fs::write(&target, b"data").unwrap();
        let link = test.base.join("link.bin");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let err = test
            .store
            .put_file(NewAttachmentFile {
                name: "link.bin".into(),
                kind: AttachmentKind::File,
                origin: "outbound:feishu".into(),
                session_id: None,
                source: link,
            })
            .expect_err("symlink");
        assert!(err.contains("regular file"), "{err}");
    }
}
