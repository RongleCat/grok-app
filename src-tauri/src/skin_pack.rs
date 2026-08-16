//! `.grokskin` ZIP inspect / export. Fail-closed on unknown top-level names.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::paths;
use crate::skin_disk;
use crate::skin_staging;

pub const ZIP_FILE_MAX: u64 = 201 * 1024 * 1024;
pub const UNCOMPRESSED_MAX: u64 = 201 * 1024 * 1024;
pub const MANIFEST_MAX: u64 = 64 * 1024;
pub const PREVIEW_MAX: u64 = 256 * 1024;
pub const WALLPAPER_MAX: u64 = 200 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 16;
pub const ZIP_COMMENT: &str = "GROKSKIN/1";
pub const DEFAULT_SCRIM: i32 = 100;
const KNOWN_SKINS: &[&str] = &["default", "rose", "gothic", "mist", "ocean", "ember"];

static CURRENT_INSPECT: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPackWallpaperDto {
    pub path: String,
    pub kind: String,
    pub mime: String,
    pub name: String,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPackPreviewDto {
    pub id: String,
    pub source_id: Option<String>,
    pub name: String,
    pub description: String,
    pub author: String,
    pub created_at: i64,
    pub skin: String,
    pub requested_skin: String,
    pub scrim: i32,
    pub theme_preference: Option<String>,
    pub wallpaper: Option<SkinPackWallpaperDto>,
    pub preview_path: Option<String>,
    pub warnings: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinPackExportManifest {
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    pub skin: String,
    #[serde(default)]
    pub scrim: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wallpaper: Option<serde_json::Value>,
}

pub fn clear_current_inspect(id: &str) {
    if let Ok(mut g) = CURRENT_INSPECT.lock() {
        if g.as_deref() == Some(id) {
            *g = None;
        }
    }
}

fn err(code: &str, msg: impl std::fmt::Display) -> String {
    format!("{code}: {msg}")
}

fn looks_unsafe_raw(raw: &str) -> bool {
    let t = raw.trim();
    if t.starts_with('/') || t.starts_with('\\') {
        return true;
    }
    if t.starts_with("//") || t.starts_with("\\\\") {
        return true;
    }
    let b = t.as_bytes();
    if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        return true;
    }
    t.split(['/', '\\']).any(|p| p == "..")
}

fn is_ignored(norm: &str) -> bool {
    if norm.ends_with('/') && norm != "assets/" {
        return true;
    }
    if norm == ".ds_store" || norm.ends_with("/.ds_store") {
        return true;
    }
    if norm.starts_with("__macosx/") || norm == "__macosx" {
        return true;
    }
    let base = norm.rsplit('/').next().unwrap_or(norm);
    base.starts_with("._")
}

fn wallpaper_ext(norm: &str) -> Option<&'static str> {
    const EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"];
    let prefix = "assets/wallpaper.";
    if let Some(ext) = norm.strip_prefix(prefix) {
        EXTS.iter().copied().find(|e| *e == ext)
    } else {
        None
    }
}

fn canonical_name(norm: &str) -> Option<String> {
    if norm == "manifest.json" || norm == "preview.jpg" || norm == "assets/" {
        return Some(norm.to_string());
    }
    if wallpaper_ext(norm).is_some() {
        return Some(norm.to_string());
    }
    None
}

/// Normalize a ZIP entry name. `Ok(None)` = ignore. `Err` = invalid_pack.
pub fn normalize_zip_name(raw: &str) -> Result<Option<String>, String> {
    if looks_unsafe_raw(raw) {
        return Err(err("invalid_pack", "unsafe zip path"));
    }
    let mut s = raw.replace('\\', "/");
    while s.starts_with("./") {
        s = s[2..].to_string();
    }
    if s.split('/').any(|p| p == "..") || s.starts_with('/') {
        return Err(err("invalid_pack", "unsafe zip path"));
    }
    let norm = s.to_lowercase();
    if norm.is_empty() || is_ignored(&norm) {
        return Ok(None);
    }
    match canonical_name(&norm) {
        Some(c) => Ok(Some(c)),
        None => Err(err(
            "invalid_pack",
            format!("unknown zip entry '{raw}'"),
        )),
    }
}

fn mime_for_ext(ext: &str) -> Option<(&'static str, &'static str)> {
    match ext {
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "png" => Some(("image", "image/png")),
        "webp" => Some(("image", "image/webp")),
        "gif" => Some(("image", "image/gif")),
        "mp4" => Some(("video", "video/mp4")),
        "webm" => Some(("video", "video/webm")),
        _ => None,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

fn parse_scrim(v: &serde_json::Value) -> i32 {
    let n = v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64));
    match n {
        Some(x) if (0..=100).contains(&x) => x as i32,
        _ => DEFAULT_SCRIM,
    }
}

fn validate_manifest_value(
    v: &serde_json::Value,
    wallpaper_present: bool,
    wallpaper_name: Option<&str>,
    wallpaper_hash: Option<&str>,
) -> Result<(SkinPackPreviewDto, serde_json::Value), String> {
    let obj = v
        .as_object()
        .ok_or_else(|| err("invalid_pack", "manifest is not an object"))?;
    if obj.contains_key("tokens") || obj.contains_key("style") || obj.contains_key("css") {
        return Err(err("unsupported_schema", "tokens/style/css not allowed"));
    }
    let schema = obj.get("schemaVersion").and_then(|x| x.as_u64());
    if schema != Some(1) {
        return Err(err("unsupported_schema", "schemaVersion must be 1"));
    }
    let name = obj
        .get("name")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 80)
        .ok_or_else(|| err("invalid_pack", "name required"))?;
    let requested = obj
        .get("skin")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let mut warnings = Vec::new();
    let skin = if KNOWN_SKINS.contains(&requested.as_str()) {
        requested.clone()
    } else {
        warnings.push("unknown_skin".into());
        "default".into()
    };
    let scrim = obj.get("scrim").map(parse_scrim).unwrap_or(DEFAULT_SCRIM);
    let description = obj
        .get("description")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .chars()
        .take(500)
        .collect();
    let author = obj
        .get("author")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    let created_at = obj
        .get("createdAt")
        .and_then(|x| x.as_i64())
        .filter(|n| *n > 0)
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        });
    let source_id = obj
        .get("sourceId")
        .and_then(|x| x.as_str())
        .or_else(|| obj.get("id").and_then(|x| x.as_str()))
        .map(|s| s.to_string());

    let wall_val = obj.get("wallpaper");
    let wallpaper = if wall_val.is_none() || wall_val == Some(&serde_json::Value::Null) {
        if wallpaper_present {
            return Err(err(
                "invalid_pack",
                "wallpaper file present but manifest.wallpaper is null",
            ));
        }
        warnings.push("will_clear_wallpaper".into());
        None
    } else {
        let w = wall_val
            .and_then(|x| x.as_object())
            .ok_or_else(|| err("invalid_pack", "wallpaper must be object or null"))?;
        let file = w
            .get("file")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_lowercase();
        let ext = wallpaper_ext(&file).ok_or_else(|| err("invalid_pack", "wallpaper.file"))?;
        let (kind, mime) = mime_for_ext(ext).unwrap();
        let got_kind = w.get("kind").and_then(|x| x.as_str()).unwrap_or("");
        let got_mime = w.get("mime").and_then(|x| x.as_str()).unwrap_or("");
        if got_kind != kind || got_mime != mime {
            return Err(err("invalid_pack", "wallpaper kind/mime mismatch"));
        }
        if got_mime == "image/svg+xml" || got_mime == "text/html" {
            return Err(err("invalid_pack", "wallpaper mime not allowed"));
        }
        let sha = w
            .get("sha256")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_lowercase();
        if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(err("invalid_pack", "wallpaper.sha256"));
        }
        let wname = w
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("wallpaper")
            .to_string();
        if !wallpaper_present {
            return Err(err("invalid_pack", "wallpaper declared but file missing"));
        }
        if wallpaper_name != Some(file.as_str()) {
            return Err(err("invalid_pack", "wallpaper file name mismatch"));
        }
        if wallpaper_hash != Some(sha.as_str()) {
            return Err(err("hash_mismatch", "wallpaper sha256"));
        }
        Some(SkinPackWallpaperDto {
            path: String::new(),
            kind: kind.into(),
            mime: mime.into(),
            name: wname,
            bytes: 0,
            width: w.get("width").and_then(|x| x.as_u64()).map(|n| n as u32),
            height: w.get("height").and_then(|x| x.as_u64()).map(|n| n as u32),
            focus: w.get("focus").cloned(),
            clip: if kind == "video" {
                w.get("clip").cloned()
            } else {
                None
            },
        })
    };

    Ok((
        SkinPackPreviewDto {
            id: String::new(),
            source_id,
            name: name.to_string(),
            description,
            author,
            created_at,
            skin,
            requested_skin: requested,
            scrim,
            theme_preference: None,
            wallpaper,
            preview_path: None,
            warnings,
            source: "file".into(),
        },
        v.clone(),
    ))
}

fn abort_old_inspect() {
    if let Ok(mut g) = CURRENT_INSPECT.lock() {
        if let Some(old) = g.take() {
            let dir = skin_staging::inspect_dir(&old);
            let _ = fs::remove_dir_all(dir);
        }
    }
}

/// Inspect a `.grokskin` / selected `.zip` into `.staging/inspect/{id}/`.
pub fn inspect_pack(zip_path: &Path, source: &str) -> Result<SkinPackPreviewDto, String> {
    inspect_pack_into(zip_path, &paths::skin_staging_inspect_dir(), source)
}

pub fn inspect_pack_into(
    zip_path: &Path,
    inspect_parent: &Path,
    source: &str,
) -> Result<SkinPackPreviewDto, String> {
    let meta = fs::metadata(zip_path).map_err(|e| err("not_found", e))?;
    if meta.len() > ZIP_FILE_MAX {
        return Err(err("too_large", "zip file exceeds 201 MiB"));
    }
    skin_disk::preflight(meta.len().saturating_add(64 * 1024))?;

    let file = File::open(zip_path).map_err(|e| err("not_found", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| err("invalid_pack", e))?;
    if archive.len() > MAX_ENTRIES {
        return Err(err("too_large", "too many zip entries"));
    }

    let mut seen = HashSet::new();
    let mut uncompressed_total = 0u64;
    let mut has_manifest = false;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| err("invalid_pack", e))?;
        if entry.encrypted() {
            return Err(err("invalid_pack", "encrypted zip"));
        }
        match entry.compression() {
            CompressionMethod::Stored | CompressionMethod::Deflated => {}
            other => {
                return Err(err(
                    "invalid_pack",
                    format!("unsupported compression {other:?}"),
                ));
            }
        }
        uncompressed_total = uncompressed_total.saturating_add(entry.size());
        if uncompressed_total > UNCOMPRESSED_MAX {
            return Err(err("too_large", "uncompressed size exceeds 201 MiB"));
        }
        let raw_name = entry.name().to_string();
        if let Some(norm) = normalize_zip_name(&raw_name)? {
            if !seen.insert(norm.clone()) {
                return Err(err("invalid_pack", format!("duplicate entry {norm}")));
            }
            if norm == "manifest.json" {
                has_manifest = true;
                if entry.size() > MANIFEST_MAX {
                    return Err(err("too_large", "manifest.json too large"));
                }
            } else if norm == "preview.jpg" {
                if entry.size() > PREVIEW_MAX {
                    return Err(err("too_large", "preview.jpg too large"));
                }
            } else if wallpaper_ext(&norm).is_some() && entry.size() > WALLPAPER_MAX {
                return Err(err("too_large", "wallpaper too large"));
            }
        }
    }
    if !has_manifest {
        return Err(err("invalid_pack", "missing manifest.json"));
    }

    abort_old_inspect();
    let inspect_id = Uuid::new_v4().to_string();
    let dest = inspect_parent.join(&inspect_id);
    fs::create_dir_all(&dest).map_err(|e| err("invalid_pack", e))?;
    if let Ok(mut g) = CURRENT_INSPECT.lock() {
        *g = Some(inspect_id.clone());
    }

    let dest_canon = dest.canonicalize().unwrap_or(dest.clone());
    let mut written_wallpaper: Option<(String, PathBuf, Vec<u8>)> = None;
    let mut preview_path: Option<PathBuf> = None;
    let mut manifest_bytes = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| err("invalid_pack", e))?;
        let raw_name = entry.name().to_string();
        let Some(norm) = normalize_zip_name(&raw_name)? else {
            continue;
        };
        if norm.ends_with('/') {
            let dir = dest.join(norm.trim_end_matches('/'));
            fs::create_dir_all(&dir).map_err(|e| err("invalid_pack", e))?;
            continue;
        }
        let out = dest.join(&norm);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| err("invalid_pack", e))?;
        }
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| err("invalid_pack", e))?;
        fs::write(&out, &buf).map_err(|e| err("invalid_pack", e))?;
        let written_canon = out.canonicalize().unwrap_or(out.clone());
        if !written_canon.starts_with(&dest_canon) {
            let _ = fs::remove_dir_all(&dest);
            return Err(err("invalid_pack", "zip-slip blocked"));
        }
        if norm == "manifest.json" {
            manifest_bytes = buf;
        } else if norm == "preview.jpg" {
            preview_path = Some(out);
        } else if wallpaper_ext(&norm).is_some() {
            written_wallpaper = Some((norm, out, buf));
        }
    }

    let manifest_json: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| err("invalid_pack", format!("manifest json: {e}")))?;
    let wall_hash = written_wallpaper
        .as_ref()
        .map(|(_, _, b)| sha256_hex(b));
    let wall_name = written_wallpaper.as_ref().map(|(n, _, _)| n.as_str());
    let (mut preview, _) = validate_manifest_value(
        &manifest_json,
        written_wallpaper.is_some(),
        wall_name,
        wall_hash.as_deref(),
    )
    .map_err(|e| {
        let _ = fs::remove_dir_all(&dest);
        e
    })?;

    preview.id = inspect_id;
    preview.source = source.to_string();
    if let Some((_, path, bytes)) = written_wallpaper {
        if let Some(w) = preview.wallpaper.as_mut() {
            w.path = path.display().to_string();
            w.bytes = bytes.len() as u64;
        }
    }
    if let Some(p) = preview_path {
        preview.preview_path = Some(p.display().to_string());
    }
    Ok(preview)
}

fn encode_preview_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(bytes).ok()?;
    let img = img.resize(640, 640, image::imageops::FilterType::Triangle);
    let mut out = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82);
    enc.encode(
        img.to_rgb8().as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    if out.len() as u64 > PREVIEW_MAX {
        return None;
    }
    Some(out)
}

fn maybe_preview_from_wallpaper(path: &Path, kind: &str) -> Option<Vec<u8>> {
    if kind == "video" {
        if let Ok(poster) = crate::video_poster::ensure_video_poster(&path.to_string_lossy()) {
            let p = PathBuf::from(poster.poster_path);
            if let Ok(bytes) = fs::read(&p) {
                return encode_preview_jpeg(&bytes);
            }
        }
        return None;
    }
    fs::read(path).ok().and_then(|b| encode_preview_jpeg(&b))
}

struct RemoveOnDrop(Option<PathBuf>);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = fs::remove_file(p);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinExportResult {
    pub warning: Option<String>,
}

impl SkinExportResult {
    fn from_bake(status: crate::skin_video_bake::VideoBakeStatus) -> Self {
        Self {
            warning: match status {
                crate::skin_video_bake::VideoBakeStatus::SkippedNoFfmpeg => {
                    Some("ffmpeg_unavailable".into())
                }
                _ => None,
            },
        }
    }
}

/// Export a pack to `dest_path`. Wallpaper bytes come from `wallpaper_path`.
/// Never writes `themePreference`. Video crop/clip is baked when `bake_video`.
pub fn export_pack(
    dest_path: &Path,
    manifest: &serde_json::Value,
    wallpaper_path: Option<&Path>,
) -> Result<SkinExportResult, String> {
    export_pack_inner(dest_path, manifest, wallpaper_path, true)
}

/// Zip a library dir without re-encoding video. Used to preview/apply a
/// saved look so the original file + focus/clip stay intact.
pub fn export_dir_unbaked(src_dir: &Path, dest_path: &Path) -> Result<SkinExportResult, String> {
    export_dir_inner(src_dir, dest_path, false)
}

fn export_pack_inner(
    dest_path: &Path,
    manifest: &serde_json::Value,
    wallpaper_path: Option<&Path>,
    bake_video: bool,
) -> Result<SkinExportResult, String> {
    let mut man = manifest.clone();
    if let Some(obj) = man.as_object_mut() {
        obj.remove("themePreference");
        obj.insert("schemaVersion".into(), serde_json::json!(1));
        if !obj.contains_key("createdAt") {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            obj.insert("createdAt".into(), serde_json::json!(now));
        }
    }
    let mut wallpaper_bytes: Option<(String, Vec<u8>, String, String)> = None;
    let mut baked_tmp = RemoveOnDrop(None);
    let mut bake_status = crate::skin_video_bake::VideoBakeStatus::NotNeeded;
    let mut preview_src = wallpaper_path.map(|p| p.to_path_buf());
    if let Some(path) = wallpaper_path {
        let mut use_path = path.to_path_buf();
        if let Some(obj) = man.as_object_mut() {
            let mut wall = obj
                .get("wallpaper")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            if let Some(w) = wall.as_object_mut() {
                let is_video = w.get("kind").and_then(|x| x.as_str()) == Some("video")
                    || path
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("mp4") || e.eq_ignore_ascii_case("webm"));
                if bake_video && is_video {
                    w.entry("kind".to_string())
                        .or_insert_with(|| serde_json::json!("video"));
                    let (baked, status) =
                        crate::skin_video_bake::maybe_bake_wallpaper_video(path, w)?;
                    bake_status = status;
                    if baked != path {
                        baked_tmp.0 = Some(baked.clone());
                        use_path = baked;
                    }
                } else if bake_video {
                    let is_image = w.get("kind").and_then(|x| x.as_str()) == Some("image")
                        || path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                            matches!(
                                e.to_ascii_lowercase().as_str(),
                                "jpg" | "jpeg" | "png" | "webp" | "gif"
                            )
                        });
                    if is_image {
                        w.entry("kind".to_string())
                            .or_insert_with(|| serde_json::json!("image"));
                        let (baked, _status) =
                            crate::skin_image_bake::maybe_bake_wallpaper_image(path, w)?;
                        if baked != path {
                            baked_tmp.0 = Some(baked.clone());
                            use_path = baked;
                        }
                    }
                } else {
                    w.remove("viewAspect");
                }
            }
            obj.insert("wallpaper".into(), wall);
        }
        let bytes = fs::read(&use_path).map_err(|e| err("not_found", e))?;
        if bytes.len() as u64 > WALLPAPER_MAX {
            return Err(err("too_large", "wallpaper exceeds 200 MiB"));
        }
        let ext = use_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg")
            .to_ascii_lowercase();
        let ext = if ext == "jpeg" { "jpg" } else { ext.as_str() };
        let (kind, mime) = mime_for_ext(ext).ok_or_else(|| err("invalid_pack", "wallpaper ext"))?;
        let hash = sha256_hex(&bytes);
        let file = format!("assets/wallpaper.{ext}");
        if let Some(obj) = man.as_object_mut() {
            if let Some(w) = obj.get_mut("wallpaper").and_then(|x| x.as_object_mut()) {
                w.insert("file".into(), serde_json::json!(file));
                w.insert("kind".into(), serde_json::json!(kind));
                w.insert("mime".into(), serde_json::json!(mime));
                w.insert("sha256".into(), serde_json::json!(hash));
                if !w.contains_key("name") {
                    w.insert(
                        "name".into(),
                        serde_json::json!(
                            path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("wallpaper")
                        ),
                    );
                }
                w.remove("viewAspect");
            }
        }
        preview_src = Some(use_path);
        wallpaper_bytes = Some((file, bytes, kind.to_string(), mime.to_string()));
    } else if let Some(obj) = man.as_object_mut() {
        obj.insert("wallpaper".into(), serde_json::Value::Null);
    }

    let preview_bytes = wallpaper_bytes.as_ref().and_then(|(_, _b, kind, _)| {
        preview_src
            .as_deref()
            .and_then(|p| maybe_preview_from_wallpaper(p, kind))
    });

    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| err("invalid_pack", e))?;
    }
    let file = File::create(dest_path).map_err(|e| err("invalid_pack", e))?;
    let mut zip = ZipWriter::new(file);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let man_bytes = serde_json::to_vec_pretty(&man).map_err(|e| err("invalid_pack", e))?;
    zip.start_file("manifest.json", deflate)
        .map_err(|e| err("invalid_pack", e))?;
    zip.write_all(&man_bytes)
        .map_err(|e| err("invalid_pack", e))?;
    if let Some(prev) = preview_bytes {
        zip.start_file("preview.jpg", deflate)
            .map_err(|e| err("invalid_pack", e))?;
        zip.write_all(&prev)
            .map_err(|e| err("invalid_pack", e))?;
    }
    if let Some((name, bytes, _, _)) = wallpaper_bytes {
        zip.start_file(&name, stored)
            .map_err(|e| err("invalid_pack", e))?;
        zip.write_all(&bytes)
            .map_err(|e| err("invalid_pack", e))?;
    }
    zip.set_comment(ZIP_COMMENT);
    zip.finish().map_err(|e| err("invalid_pack", e))?;
    Ok(SkinExportResult::from_bake(bake_status))
}

/// Export a directory that already has manifest + optional assets/preview.
/// Video wallpapers are cropped/trimmed when the stored look asks for it.
pub fn export_dir(src_dir: &Path, dest_path: &Path) -> Result<SkinExportResult, String> {
    export_dir_inner(src_dir, dest_path, true)
}

fn export_dir_inner(
    src_dir: &Path,
    dest_path: &Path,
    bake_video: bool,
) -> Result<SkinExportResult, String> {
    let man_path = src_dir.join("manifest.json");
    let raw = fs::read(&man_path).map_err(|e| err("not_found", e))?;
    let mut man: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| err("invalid_pack", e))?;
    if let Some(obj) = man.as_object_mut() {
        obj.remove("themePreference");
    }
    let wall = man
        .get("wallpaper")
        .and_then(|w| w.get("file"))
        .and_then(|f| f.as_str())
        .map(|rel| src_dir.join(rel));
    let wall_ref = wall.as_deref().filter(|p| p.is_file());
    export_pack_inner(dest_path, &man, wall_ref, bake_video)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn tmp() -> (std::sync::MutexGuard<'static, ()>, PathBuf) {
        let g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!(
            "grok-skin-pack-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("GROK_APP_HOME", &dir);
        let _ = crate::paths::ensure_app_dirs();
        (g, dir)
    }

    fn tiny_png() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(8, 8, image::Rgb([20, 80, 160]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    fn write_zip(path: &Path, files: &[(&str, &[u8], CompressionMethod)]) {
        let f = File::create(path).unwrap();
        let mut z = ZipWriter::new(f);
        for (name, bytes, method) in files {
            let opts = SimpleFileOptions::default().compression_method(*method);
            z.start_file(*name, opts).unwrap();
            z.write_all(bytes).unwrap();
        }
        z.set_comment(ZIP_COMMENT);
        z.finish().unwrap();
    }

    fn ocean_manifest(sha: &str, file: &str) -> String {
        format!(
            r#"{{
              "schemaVersion": 1,
              "name": "Harbor dusk",
              "skin": "ocean",
              "scrim": 42,
              "wallpaper": {{
                "file": "{file}",
                "kind": "image",
                "mime": "image/png",
                "name": "harbor.png",
                "width": 8,
                "height": 8,
                "sha256": "{sha}",
                "focus": {{ "cx": 0.46, "cy": 0.38, "zoom": 1.25 }}
              }}
            }}"#
        )
    }

    #[test]
    fn reject_zip_slip() {
        let (_g, dir) = tmp();
        let zip = dir.join("slip.grokskin");
        write_zip(
            &zip,
            &[(
                "../evil.txt",
                b"{}",
                CompressionMethod::Stored,
            )],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("invalid_pack"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_entry_count_bomb() {
        let (_g, dir) = tmp();
        let zip = dir.join("bomb.grokskin");
        let f = File::create(&zip).unwrap();
        let mut z = ZipWriter::new(f);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        z.start_file("manifest.json", opts).unwrap();
        z.write_all(br#"{"schemaVersion":1,"name":"x","skin":"default"}"#)
            .unwrap();
        for i in 0..16 {
            z.start_file(format!("extra{i}.txt"), opts).unwrap();
            z.write_all(b"x").unwrap();
        }
        z.finish().unwrap();
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("too_large") || e.starts_with("invalid_pack"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_uncompressed_cap() {
        let (_g, dir) = tmp();
        let zip = dir.join("huge.grokskin");
        write_zip(
            &zip,
            &[(
                "manifest.json",
                br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
                CompressionMethod::Stored,
            )],
        );
        // Patch uncompressed size in local + central headers to 300 MiB.
        let mut bytes = fs::read(&zip).unwrap();
        // local header uncompressed size at offset 22
        let huge: u32 = 300 * 1024 * 1024;
        bytes[22..26].copy_from_slice(&huge.to_le_bytes());
        // find EOCD, then central directory
        let eocd = bytes.windows(4).rposition(|w| w == [0x50, 0x4b, 0x05, 0x06]);
        if let Some(e) = eocd {
            let cd_off = u32::from_le_bytes(bytes[e + 16..e + 20].try_into().unwrap()) as usize;
            // central header uncompressed size at +24
            if cd_off + 28 < bytes.len() && bytes[cd_off..cd_off + 4] == [0x50, 0x4b, 0x01, 0x02] {
                bytes[cd_off + 24..cd_off + 28].copy_from_slice(&huge.to_le_bytes());
            }
        }
        fs::write(&zip, bytes).unwrap();
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("too_large"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_unknown_top_level() {
        let (_g, dir) = tmp();
        let zip = dir.join("extra.grokskin");
        write_zip(
            &zip,
            &[
                (
                    "manifest.json",
                    br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
                    CompressionMethod::Deflated,
                ),
                ("theme.css", b"body{}", CompressionMethod::Stored),
            ],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("invalid_pack"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_missing_manifest() {
        let (_g, dir) = tmp();
        let zip = dir.join("nom.grokskin");
        write_zip(
            &zip,
            &[("preview.jpg", &[0xff, 0xd8, 0xff, 0xd9], CompressionMethod::Stored)],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.contains("manifest"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn accepts_case_aliases() {
        let (_g, dir) = tmp();
        let png = tiny_png();
        let sha = sha256_hex(&png);
        let man = ocean_manifest(&sha, "assets/wallpaper.png");
        let zip = dir.join("case.grokskin");
        write_zip(
            &zip,
            &[
                ("Manifest.json", man.as_bytes(), CompressionMethod::Deflated),
                (
                    "ASSETS/WALLPAPER.PNG",
                    &png,
                    CompressionMethod::Stored,
                ),
            ],
        );
        let p = inspect_pack(&zip, "file").expect("case alias");
        assert_eq!(p.skin, "ocean");
        assert!(p.wallpaper.is_some());
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_duplicate_normalized_names() {
        let (_g, dir) = tmp();
        let zip = dir.join("dup.grokskin");
        write_zip(
            &zip,
            &[
                (
                    "manifest.json",
                    br#"{"schemaVersion":1,"name":"a","skin":"default"}"#,
                    CompressionMethod::Stored,
                ),
                (
                    "MANIFEST.JSON",
                    br#"{"schemaVersion":1,"name":"b","skin":"ocean"}"#,
                    CompressionMethod::Stored,
                ),
            ],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("invalid_pack"), "{e}");
        assert!(e.to_lowercase().contains("duplicate"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_unknown_compression() {
        let (_g, dir) = tmp();
        let zip = dir.join("meth.grokskin");
        write_zip(
            &zip,
            &[(
                "manifest.json",
                br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
                CompressionMethod::Stored,
            )],
        );
        let mut bytes = fs::read(&zip).unwrap();
        // local header compression method at offset 8
        bytes[8..10].copy_from_slice(&99u16.to_le_bytes());
        let eocd = bytes.windows(4).rposition(|w| w == [0x50, 0x4b, 0x05, 0x06]);
        if let Some(e) = eocd {
            let cd_off = u32::from_le_bytes(bytes[e + 16..e + 20].try_into().unwrap()) as usize;
            if cd_off + 12 < bytes.len() {
                bytes[cd_off + 10..cd_off + 12].copy_from_slice(&99u16.to_le_bytes());
            }
        }
        fs::write(&zip, bytes).unwrap();
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("invalid_pack"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_tokens_style_css() {
        let (_g, dir) = tmp();
        for key in ["tokens", "style", "css"] {
            let zip = dir.join(format!("{key}.grokskin"));
            let man = format!(
                r#"{{"schemaVersion":1,"name":"x","skin":"default","{key}":{{}}}}"#
            );
            write_zip(
                &zip,
                &[(
                    "manifest.json",
                    man.as_bytes(),
                    CompressionMethod::Deflated,
                )],
            );
            let e = inspect_pack(&zip, "file").unwrap_err();
            assert!(e.starts_with("unsupported_schema"), "{key}: {e}");
        }
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_schema_not_one() {
        let (_g, dir) = tmp();
        let zip = dir.join("v2.grokskin");
        write_zip(
            &zip,
            &[(
                "manifest.json",
                br#"{"schemaVersion":2,"name":"x","skin":"default"}"#,
                CompressionMethod::Deflated,
            )],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("unsupported_schema"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn reject_hash_mismatch() {
        let (_g, dir) = tmp();
        let png = tiny_png();
        let man = ocean_manifest(&"ab".repeat(32), "assets/wallpaper.png");
        let zip = dir.join("hash.grokskin");
        write_zip(
            &zip,
            &[
                ("manifest.json", man.as_bytes(), CompressionMethod::Deflated),
                ("assets/wallpaper.png", &png, CompressionMethod::Stored),
            ],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("hash_mismatch"), "{e}");
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn round_trip_export_inspect() {
        let (_g, dir) = tmp();
        let png = tiny_png();
        let wall = dir.join("src.png");
        fs::write(&wall, &png).unwrap();
        let dest = dir.join("out.grokskin");
        let man = serde_json::json!({
            "schemaVersion": 1,
            "name": "Harbor dusk",
            "skin": "ocean",
            "scrim": 42,
            "themePreference": "dark",
            "wallpaper": {
                "focus": { "cx": 0.46, "cy": 0.38, "zoom": 1.25 }
            }
        });
        export_pack(&dest, &man, Some(&wall)).expect("export");
        let p = inspect_pack(&dest, "file").expect("inspect");
        assert_eq!(p.skin, "ocean");
        assert_eq!(p.scrim, 42);
        assert_eq!(p.name, "Harbor dusk");
        assert!(p.theme_preference.is_none());
        let w = p.wallpaper.as_ref().expect("wallpaper");
        assert_eq!(w.kind, "image");
        assert!(w.bytes > 0);
        assert_eq!(w.focus.as_ref().unwrap()["cx"], 0.46);
        assert!(!p.warnings.iter().any(|x| x == "unknown_skin"));

        let p2 = inspect_pack(&dest, "file").expect("inspect 2");
        assert_eq!(p2.skin, p.skin);
        assert_eq!(p2.scrim, p.scrim);
        assert_eq!(p2.wallpaper.is_some(), p.wallpaper.is_some());
        assert_eq!(p2.warnings, p.warnings);
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }

    #[test]
    fn inspect_fixture_twice_stable() {
        let (_g, dir) = tmp();
        let png = tiny_png();
        let sha = sha256_hex(&png);
        let man = ocean_manifest(&sha, "assets/wallpaper.png");
        let zip = dir.join("stable.grokskin");
        write_zip(
            &zip,
            &[
                ("manifest.json", man.as_bytes(), CompressionMethod::Deflated),
                ("assets/wallpaper.png", &png, CompressionMethod::Stored),
            ],
        );
        let a = inspect_pack(&zip, "file").expect("run 1");
        let b = inspect_pack(&zip, "file").expect("run 2");
        assert_eq!(a.skin, b.skin);
        assert_eq!(a.scrim, b.scrim);
        assert_eq!(a.wallpaper.is_some(), b.wallpaper.is_some());
        assert_eq!(a.warnings, b.warnings);
        println!(
            "INSPECT_STABLE skin={} scrim={} wallpaper={} warnings={:?}",
            a.skin,
            a.scrim,
            a.wallpaper.is_some(),
            a.warnings
        );
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("GROK_APP_HOME");
    }
}
