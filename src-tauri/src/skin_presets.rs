//! Local skin preset library + `before-last-apply` undo slot.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::paths;
use crate::skin_disk;
use crate::skin_pack::{self, SkinPackPreviewDto};
use crate::skin_staging;

pub const MAX_PRESETS: usize = 50;
pub const UNDO_ID: &str = "before-last-apply";

static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetIndexEntry {
    pub id: String,
    #[serde(default)]
    pub source_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    pub skin: String,
    pub scrim: i32,
    pub has_wallpaper: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub preview_rel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetIndexFile {
    schema_version: u32,
    presets: Vec<PresetIndexEntry>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn index_path() -> PathBuf {
    paths::skin_presets_dir().join("index.json")
}

fn reserved(id: &str) -> bool {
    id == UNDO_ID || id.starts_with('.')
}

fn scan_dirs() -> Vec<PresetIndexEntry> {
    let root = paths::skin_presets_dir();
    let Ok(rd) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        let id = ent.file_name().to_string_lossy().to_string();
        if reserved(&id) {
            continue;
        }
        if let Ok(entry) = entry_from_dir(&p, &id) {
            out.push(entry);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

fn entry_from_dir(dir: &Path, id: &str) -> Result<PresetIndexEntry, String> {
    let raw = fs::read(dir.join("manifest.json")).map_err(|e| format!("not_found: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid_pack: {e}"))?;
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or(id)
        .to_string();
    let skin = v
        .get("skin")
        .and_then(|x| x.as_str())
        .unwrap_or("default")
        .to_string();
    let scrim = v.get("scrim").and_then(|x| x.as_i64()).unwrap_or(100) as i32;
    let wall = v.get("wallpaper");
    let has_wallpaper = wall.is_some() && !wall.unwrap().is_null();
    let kind = wall
        .and_then(|w| w.get("kind"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let bytes = crate::skin_disk::dir_size(dir);
    Ok(PresetIndexEntry {
        id: id.to_string(),
        source_id: v
            .get("sourceId")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        name,
        description: v
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        author: v
            .get("author")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: v.get("createdAt").and_then(|x| x.as_i64()).unwrap_or(0),
        updated_at: now_ms(),
        skin,
        scrim,
        has_wallpaper,
        kind,
        bytes,
        preview_rel: if dir.join("preview.jpg").is_file() {
            Some("preview.jpg".into())
        } else {
            None
        },
    })
}

fn write_index(presets: &[PresetIndexEntry]) -> Result<(), String> {
    let _g = INDEX_LOCK
        .lock()
        .map_err(|_| "busy: index lock poisoned".to_string())?;
    let path = index_path();
    let tmp = path.with_extension("json.tmp");
    let body = PresetIndexFile {
        schema_version: 1,
        presets: presets.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&body).map_err(|e| format!("invalid_pack: {e}"))?;
    fs::write(&tmp, bytes).map_err(|e| format!("invalid_pack: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("invalid_pack: {e}"))?;
    Ok(())
}

pub fn list_presets() -> Result<Vec<PresetIndexEntry>, String> {
    let path = index_path();
    if !path.is_file() {
        let scanned = scan_dirs();
        let _ = write_index(&scanned);
        return Ok(scanned);
    }
    match fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<PresetIndexFile>(&b).ok())
    {
        Some(idx) if idx.schema_version == 1 => Ok(idx.presets),
        _ => {
            let scanned = scan_dirs();
            let _ = write_index(&scanned);
            Ok(scanned)
        }
    }
}

fn copy_dir(src: &Path, dest: &Path) -> Result<u64, String> {
    fs::create_dir_all(dest).map_err(|e| format!("invalid_pack: {e}"))?;
    let mut bytes = 0u64;
    let rd = fs::read_dir(src).map_err(|e| format!("not_found: {e}"))?;
    for ent in rd.flatten() {
        let from = ent.path();
        let to = dest.join(ent.file_name());
        if from.is_dir() {
            bytes = bytes.saturating_add(copy_dir(&from, &to)?);
        } else {
            fs::copy(&from, &to).map_err(|e| format!("invalid_pack: {e}"))?;
            bytes = bytes.saturating_add(ent.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }
    Ok(bytes)
}

fn save_from_dir(src: &Path, source_id: Option<String>) -> Result<PresetIndexEntry, String> {
    let mut presets = list_presets()?;
    if presets.len() >= MAX_PRESETS {
        return Err("preset_limit: 50 presets".into());
    }
    let add = crate::skin_disk::dir_size(src);
    skin_disk::preflight(add)?;
    let id = Uuid::new_v4().to_string();
    if reserved(&id) {
        return Err("invalid_pack: reserved id".into());
    }
    let dest = paths::skin_presets_dir().join(&id);
    if dest.exists() {
        return Err("invalid_pack: dest exists".into());
    }
    copy_dir(src, &dest)?;
    if let Some(sid) = source_id {
        let man_path = dest.join("manifest.json");
        if let Ok(raw) = fs::read(&man_path) {
            if let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&raw) {
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("sourceId".into(), serde_json::json!(sid));
                    obj.remove("themePreference");
                }
                let _ = fs::write(&man_path, serde_json::to_vec_pretty(&v).unwrap_or(raw));
            }
        }
    }
    let mut entry = entry_from_dir(&dest, &id)?;
    entry.updated_at = now_ms();
    presets.insert(0, entry.clone());
    write_index(&presets)?;
    Ok(entry)
}

pub fn save_from_inspect(inspect_id: &str) -> Result<PresetIndexEntry, String> {
    let src = skin_staging::inspect_dir(inspect_id);
    if !src.is_dir() {
        return Err("not_found: inspect staging".into());
    }
    let entry = save_from_dir(&src, None)?;
    let _ = fs::remove_dir_all(&src);
    crate::skin_pack::clear_current_inspect(inspect_id);
    Ok(entry)
}

fn materialize_upload_dir(
    upload_id: &str,
    manifest: serde_json::Value,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let upload = if upload_id.is_empty() {
        None
    } else {
        Some(skin_staging::consume_upload(upload_id)?)
    };
    let blob = upload.as_ref().map(|d| d.join("blob.bin"));
    let tmp = paths::skin_staging_upload_dir().join(format!("pack-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp).map_err(|e| format!("invalid_pack: {e}"))?;
    let mut man = manifest;
    if let Some(obj) = man.as_object_mut() {
        obj.remove("themePreference");
        obj.insert("schemaVersion".into(), serde_json::json!(1));
    }
    if let Some(blob) = blob.filter(|p| p.is_file()) {
        let ext = man
            .get("wallpaper")
            .and_then(|w| w.get("file"))
            .and_then(|f| f.as_str())
            .and_then(|f| f.rsplit('.').next())
            .unwrap_or("bin")
            .to_string();
        let assets = tmp.join("assets");
        fs::create_dir_all(&assets).map_err(|e| format!("invalid_pack: {e}"))?;
        let dest = assets.join(format!("wallpaper.{ext}"));
        fs::copy(&blob, &dest).map_err(|e| format!("invalid_pack: {e}"))?;
        if let Some(obj) = man.as_object_mut() {
            if let Some(w) = obj.get_mut("wallpaper").and_then(|x| x.as_object_mut()) {
                w.insert(
                    "file".into(),
                    serde_json::json!(format!("assets/wallpaper.{ext}")),
                );
                let bytes = fs::read(&dest).unwrap_or_default();
                let mut h = sha2::Sha256::new();
                use sha2::Digest;
                h.update(&bytes);
                w.insert("sha256".into(), serde_json::json!(hex::encode(h.finalize())));
            }
        }
    } else if let Some(obj) = man.as_object_mut() {
        obj.insert("wallpaper".into(), serde_json::Value::Null);
    }
    fs::write(
        tmp.join("manifest.json"),
        serde_json::to_vec_pretty(&man).map_err(|e| format!("invalid_pack: {e}"))?,
    )
    .map_err(|e| format!("invalid_pack: {e}"))?;
    Ok((tmp, upload))
}

pub fn save_from_upload(
    upload_id: &str,
    manifest: serde_json::Value,
) -> Result<PresetIndexEntry, String> {
    let (tmp, upload) = materialize_upload_dir(upload_id, manifest)?;
    let entry = save_from_dir(&tmp, None);
    let _ = fs::remove_dir_all(&tmp);
    if let Some(dir) = upload {
        let _ = fs::remove_dir_all(&dir);
    }
    entry
}

pub fn replace_from_dir(id: &str, src: &Path) -> Result<PresetIndexEntry, String> {
    if reserved(id) {
        return Err("not_found: reserved id".into());
    }
    let dest = paths::skin_presets_dir().join(id);
    if !dest.is_dir() {
        return Err("not_found: preset".into());
    }
    let old = crate::skin_disk::dir_size(&dest);
    let add = crate::skin_disk::dir_size(src);
    skin_disk::preflight(add.saturating_sub(old))?;
    let tmp = paths::skin_presets_dir().join(format!(".replace-tmp-{id}"));
    if tmp.exists() {
        let _ = fs::remove_dir_all(&tmp);
    }
    copy_dir(src, &tmp)?;
    fs::remove_dir_all(&dest).map_err(|e| format!("invalid_pack: {e}"))?;
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("invalid_pack: {e}"));
    }
    let mut entry = entry_from_dir(&dest, id)?;
    entry.updated_at = now_ms();
    let mut presets = list_presets()?;
    if let Some(p) = presets.iter_mut().find(|p| p.id == id) {
        *p = entry.clone();
    } else {
        presets.insert(0, entry.clone());
    }
    write_index(&presets)?;
    Ok(entry)
}

pub fn replace_from_upload(
    id: &str,
    upload_id: &str,
    manifest: serde_json::Value,
) -> Result<PresetIndexEntry, String> {
    let (tmp, upload) = materialize_upload_dir(upload_id, manifest)?;
    let entry = replace_from_dir(id, &tmp);
    let _ = fs::remove_dir_all(&tmp);
    if let Some(dir) = upload {
        let _ = fs::remove_dir_all(&dir);
    }
    entry
}

pub fn materialize(id: &str) -> Result<SkinPackPreviewDto, String> {
    if reserved(id) && id != UNDO_ID {
        return Err("not_found: reserved".into());
    }
    let dir = if id == UNDO_ID {
        paths::skin_presets_dir().join(UNDO_ID)
    } else {
        paths::skin_presets_dir().join(id)
    };
    if !dir.is_dir() {
        return Err("not_found: preset".into());
    }
    let dest = paths::skin_presets_dir().join(format!(".export-{}.grokskin", Uuid::new_v4()));
    // Apply/preview must keep the original video + focus/clip. Bake only
    // happens on user-facing export/share.
    skin_pack::export_dir_unbaked(&dir, &dest)?;
    let preview = skin_pack::inspect_pack(&dest, if id == UNDO_ID { "preset" } else { "preset" });
    let _ = fs::remove_file(&dest);
    preview
}

pub fn delete_preset(id: &str) -> Result<(), String> {
    if reserved(id) {
        return Err("not_found: reserved id".into());
    }
    let dir = paths::skin_presets_dir().join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("invalid_pack: {e}"))?;
    }
    let presets: Vec<_> = list_presets()?.into_iter().filter(|p| p.id != id).collect();
    write_index(&presets)
}

pub fn rename_preset(id: &str, name: &str) -> Result<PresetIndexEntry, String> {
    if reserved(id) {
        return Err("not_found: reserved id".into());
    }
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 {
        return Err("invalid_pack: name".into());
    }
    let dir = paths::skin_presets_dir().join(id);
    let man_path = dir.join("manifest.json");
    let raw = fs::read(&man_path).map_err(|e| format!("not_found: {e}"))?;
    let mut v: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid_pack: {e}"))?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("name".into(), serde_json::json!(trimmed));
    }
    fs::write(
        &man_path,
        serde_json::to_vec_pretty(&v).map_err(|e| format!("invalid_pack: {e}"))?,
    )
    .map_err(|e| format!("invalid_pack: {e}"))?;
    let mut presets = list_presets()?;
    let mut found = None;
    for p in presets.iter_mut() {
        if p.id == id {
            p.name = trimmed.to_string();
            p.updated_at = now_ms();
            found = Some(p.clone());
        }
    }
    write_index(&presets)?;
    found.ok_or_else(|| "not_found: preset".to_string())
}

pub fn export_preset(id: &str, dest: &Path) -> Result<skin_pack::SkinExportResult, String> {
    if reserved(id) && id != UNDO_ID {
        return Err("not_found: reserved".into());
    }
    let dir = paths::skin_presets_dir().join(id);
    skin_pack::export_dir(&dir, dest)
}

/// Direct-write undo snapshot into a temp dir then rename over `before-last-apply/`.
pub fn write_undo_snapshot(src_dir: &Path) -> Result<(), String> {
    let add = crate::skin_disk::dir_size(src_dir);
    skin_disk::preflight(add)?;
    let root = paths::skin_presets_dir();
    let tmp = root.join(format!(".undo-tmp-{}", Uuid::new_v4()));
    copy_dir(src_dir, &tmp)?;
    let dest = root.join(UNDO_ID);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("invalid_pack: {e}"))?;
    }
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        format!("invalid_pack: {e}")
    })?;
    Ok(())
}

/// Prepare a direct undo write dir (not upload staging, no upload mutex).
pub fn undo_prepare() -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let dir = paths::skin_presets_dir().join(format!(".undo-tmp-{id}"));
    skin_disk::preflight(64 * 1024)?;
    fs::create_dir_all(dir.join("assets")).map_err(|e| format!("invalid_pack: {e}"))?;
    Ok(id)
}

pub fn undo_append(id: &str, chunk_base64: &str) -> Result<u64, String> {
    let dir = paths::skin_presets_dir().join(format!(".undo-tmp-{id}"));
    if !dir.is_dir() {
        return Err("not_found: undo tmp".into());
    }
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, chunk_base64.trim())
        .map_err(|_| "invalid_pack: bad chunk".to_string())?;
    let blob = dir.join("blob.bin");
    let current = fs::metadata(&blob).map(|m| m.len()).unwrap_or(0);
    let next = current.saturating_add(bytes.len() as u64);
    if next > 200 * 1024 * 1024 {
        return Err("too_large: undo wallpaper".into());
    }
    skin_disk::preflight(bytes.len() as u64)?;
    use std::io::Write;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&blob)
        .map_err(|e| format!("invalid_pack: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("invalid_pack: {e}"))?;
    Ok(next)
}

pub fn undo_commit(id: &str, mut manifest: serde_json::Value) -> Result<(), String> {
    let dir = paths::skin_presets_dir().join(format!(".undo-tmp-{id}"));
    if !dir.is_dir() {
        return Err("not_found: undo tmp".into());
    }
    if let Some(obj) = manifest.as_object_mut() {
        obj.remove("themePreference");
    }
    let blob = dir.join("blob.bin");
    if blob.is_file() {
        let ext = manifest
            .get("wallpaper")
            .and_then(|w| w.get("file"))
            .and_then(|f| f.as_str())
            .and_then(|f| f.rsplit('.').next())
            .unwrap_or("bin");
        let dest = dir.join("assets").join(format!("wallpaper.{ext}"));
        fs::create_dir_all(dest.parent().unwrap()).map_err(|e| format!("invalid_pack: {e}"))?;
        fs::rename(&blob, &dest).or_else(|_| fs::copy(&blob, &dest).map(|_| ())).map_err(|e| format!("invalid_pack: {e}"))?;
        let _ = fs::remove_file(&blob);
    }
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| format!("invalid_pack: {e}"))?,
    )
    .map_err(|e| format!("invalid_pack: {e}"))?;
    let r = write_undo_snapshot(&dir);
    let _ = fs::remove_dir_all(&dir);
    r
}

pub fn undo_abort(id: &str) -> Result<(), String> {
    let dir = paths::skin_presets_dir().join(format!(".undo-tmp-{id}"));
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("invalid_pack: {e}"))?;
    }
    Ok(())
}

pub fn undo_exists() -> bool {
    paths::skin_presets_dir()
        .join(UNDO_ID)
        .join("manifest.json")
        .is_file()
}

pub fn disk_usage() -> serde_json::Value {
    serde_json::json!({
        "bytes": skin_disk::skin_data_bytes(),
        "budget": skin_disk::SKIN_DISK_BUDGET,
        "hasUndo": undo_exists(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> (std::sync::MutexGuard<'static, ()>, PathBuf) {
        let g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!(
            "grok-skin-presets-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("GROK_APP_HOME", &dir);
        let _ = crate::paths::ensure_app_dirs();
        (g, dir)
    }

    #[test]
    fn reserved_name_not_overwritten() {
        assert!(reserved(UNDO_ID));
        let (_g, dir) = home();
        let err = rename_preset(UNDO_ID, "x").unwrap_err();
        assert!(err.contains("reserved") || err.contains("not_found"), "{err}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn index_atomic_roundtrip() {
        let (_g, dir) = home();
        write_index(&[]).unwrap();
        assert!(index_path().is_file());
        assert!(list_presets().unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn replace_from_dir_keeps_id_and_updates_manifest() {
        let (_g, home_dir) = home();
        let src = home_dir.join("first");
        fs::create_dir_all(&src).unwrap();
        fs::write(
            src.join("manifest.json"),
            br#"{"schemaVersion":1,"name":"Old","skin":"ocean","scrim":10,"wallpaper":null}"#,
        )
        .unwrap();
        let saved = save_from_dir(&src, None).unwrap();
        assert_eq!(saved.name, "Old");
        assert_eq!(list_presets().unwrap().len(), 1);

        let next = home_dir.join("next");
        fs::create_dir_all(&next).unwrap();
        fs::write(
            next.join("manifest.json"),
            br#"{"schemaVersion":1,"name":"New","skin":"ember","scrim":40,"wallpaper":null}"#,
        )
        .unwrap();
        let replaced = replace_from_dir(&saved.id, &next).unwrap();
        assert_eq!(replaced.id, saved.id);
        assert_eq!(replaced.name, "New");
        assert_eq!(replaced.skin, "ember");
        assert_eq!(replaced.scrim, 40);
        let listed = list_presets().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);
        assert_eq!(listed[0].name, "New");
        let _ = fs::remove_dir_all(&home_dir);
        std::env::remove_var("GROK_APP_HOME");
    }
}
