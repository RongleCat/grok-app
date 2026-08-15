//! Upload staging (IDB → disk chunks). Inspect uses a separate tree.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::Serialize;
use uuid::Uuid;

use crate::paths;
use crate::skin_disk;

const UPLOAD_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const INSPECT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_UPLOAD_BYTES: u64 = 200 * 1024 * 1024;

static UPLOAD_LOCK: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagingBegin {
    pub upload_id: String,
}

fn now_ok(dir: &Path, ttl: Duration) -> bool {
    let Ok(meta) = fs::metadata(dir) else {
        return false;
    };
    let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    SystemTime::now()
        .duration_since(modified)
        .map(|d| d < ttl)
        .unwrap_or(false)
}

fn gc_tree(root: &Path, ttl: Duration) {
    let Ok(rd) = fs::read_dir(root) else {
        return;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        if !now_ok(&p, ttl) {
            let _ = fs::remove_dir_all(&p);
        }
    }
}

/// Startup / ensure_app_dirs GC for both staging trees.
pub fn gc_expired_staging() {
    gc_tree(&paths::skin_staging_inspect_dir(), INSPECT_TTL);
    gc_tree(&paths::skin_staging_upload_dir(), UPLOAD_TTL);
}

pub fn upload_dir(id: &str) -> PathBuf {
    paths::skin_staging_upload_dir().join(id)
}

pub fn inspect_dir(id: &str) -> PathBuf {
    paths::skin_staging_inspect_dir().join(id)
}

pub fn begin_upload() -> Result<StagingBegin, String> {
    let mut slot = UPLOAD_LOCK
        .lock()
        .map_err(|_| "busy: upload lock poisoned".to_string())?;
    if let Some(cur) = slot.as_ref() {
        if upload_dir(cur).exists() {
            return Err("busy: an upload is already in progress".into());
        }
    }
    let id = Uuid::new_v4().to_string();
    skin_disk::preflight(64 * 1024)?;
    let dir = upload_dir(&id);
    fs::create_dir_all(&dir).map_err(|e| format!("invalid_pack: mkdir upload: {e}"))?;
    *slot = Some(id.clone());
    Ok(StagingBegin { upload_id: id })
}

pub fn append_upload(staging_id: &str, chunk_base64: &str) -> Result<u64, String> {
    let slot = UPLOAD_LOCK
        .lock()
        .map_err(|_| "busy: upload lock poisoned".to_string())?;
    if slot.as_deref() != Some(staging_id) {
        return Err("not_found: unknown upload staging id".into());
    }
    drop(slot);
    let dir = upload_dir(staging_id);
    if !dir.is_dir() {
        return Err("not_found: upload staging missing".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(chunk_base64.trim())
        .map_err(|_| "invalid_pack: bad chunk base64".to_string())?;
    let blob = dir.join("blob.bin");
    let current = fs::metadata(&blob).map(|m| m.len()).unwrap_or(0);
    let next = current.saturating_add(bytes.len() as u64);
    if next > MAX_UPLOAD_BYTES {
        return Err("too_large: upload exceeds 200 MiB".into());
    }
    skin_disk::preflight(bytes.len() as u64)?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&blob)
        .map_err(|e| format!("invalid_pack: append: {e}"))?;
    f.write_all(&bytes)
        .map_err(|e| format!("invalid_pack: append write: {e}"))?;
    Ok(next)
}

pub fn abort_upload(staging_id: &str) -> Result<(), String> {
    let mut slot = UPLOAD_LOCK
        .lock()
        .map_err(|_| "busy: upload lock poisoned".to_string())?;
    if slot.as_deref() == Some(staging_id) {
        *slot = None;
    }
    let dir = upload_dir(staging_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("invalid_pack: abort upload: {e}"))?;
    }
    Ok(())
}

pub fn consume_upload(staging_id: &str) -> Result<PathBuf, String> {
    let mut slot = UPLOAD_LOCK
        .lock()
        .map_err(|_| "busy: upload lock poisoned".to_string())?;
    if slot.as_deref() != Some(staging_id) {
        return Err("not_found: unknown upload staging id".into());
    }
    *slot = None;
    let dir = upload_dir(staging_id);
    if !dir.is_dir() {
        return Err("not_found: upload staging missing".into());
    }
    Ok(dir)
}

pub fn abort_inspect(inspect_id: &str) -> Result<(), String> {
    crate::skin_pack::clear_current_inspect(inspect_id);
    let dir = inspect_dir(inspect_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("invalid_pack: abort inspect: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home_guard() -> (std::sync::MutexGuard<'static, ()>, std::path::PathBuf) {
        let g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-skin-staging-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = crate::paths::ensure_app_dirs();
        (g, tmp)
    }

    #[test]
    fn second_begin_is_busy() {
        let (_g, tmp) = home_guard();
        let a = begin_upload().expect("first begin");
        let err = begin_upload().unwrap_err();
        assert!(err.starts_with("busy"), "{err}");
        abort_upload(&a.upload_id).unwrap();
        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn inspect_does_not_block_upload() {
        let (_g, tmp) = home_guard();
        let inspect_id = Uuid::new_v4().to_string();
        fs::create_dir_all(inspect_dir(&inspect_id)).unwrap();
        let a = begin_upload().expect("upload while inspect exists");
        abort_upload(&a.upload_id).unwrap();
        let _ = fs::remove_dir_all(&tmp);
        std::env::remove_var("GROK_APP_HOME");
    }
}
