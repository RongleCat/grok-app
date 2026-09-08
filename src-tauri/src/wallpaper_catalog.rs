//! Persistent media provenance and user intent, separate from scan snapshots.

use crate::{
    store_lock,
    wallpaper_source::{self, WallpaperLibraryEntry},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

const MAX_CATALOG_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 100_000;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationParameters {
    pub operation: String,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<u32>,
    pub requested_model: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaRecord {
    pub id: String,
    pub source: String,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub author_name: Option<String>,
    pub author_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub title: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub prompt: Option<String>,
    pub generation: Option<GenerationParameters>,
    pub parent_id: Option<String>,
    pub favorite: bool,
    pub purpose: String,
    pub bytes: u64,
    pub modified_ms: u64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceMetadata {
    pub source: Option<String>,
    pub media_url: Option<String>,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub author_name: Option<String>,
    pub author_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub title: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Catalog {
    version: u32,
    records: BTreeMap<String, MediaRecord>,
    #[serde(default)]
    origins: BTreeMap<String, String>,
}

impl Catalog {
    fn insert(&mut self, relative: String, record: MediaRecord) {
        if self
            .records
            .get(&relative)
            .is_some_and(|old| old.id != record.id)
        {
            self.origins.retain(|_, path| path != &relative);
        }
        self.records.insert(relative, record);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MediaLookup {
    pub source: String,
    pub media_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaMatch {
    pub index: usize,
    pub path: String,
    pub metadata: MediaRecord,
}

fn origin_key(source: &str, raw: &str) -> Option<String> {
    if !matches!(
        source,
        "x" | "web" | "openverse" | "pexels" | "grok_album" | "imagine"
    ) || raw.len() > 16_384
    {
        return None;
    }
    let mut url = url::Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    Some(hex::encode(Sha256::digest(
        format!("{source}\n{url}").as_bytes(),
    )))
}

fn key(root: &Path, path: &Path) -> Result<String, String> {
    let root = root.canonicalize().map_err(|_| "path_not_allowed")?;
    let canonical = path.canonicalize().map_err(|_| "path_not_allowed")?;
    let relative = canonical
        .strip_prefix(root)
        .map_err(|_| "path_not_allowed")?;
    if relative
        .components()
        .any(|p| p.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err("path_not_allowed".into());
    }
    let relative = relative.to_string_lossy().replace('\\', "/");
    Ok(if cfg!(windows) {
        relative.to_lowercase()
    } else {
        relative
    })
}

fn stable_id(key: &str) -> String {
    format!("media-{}", hex::encode(Sha256::digest(key.as_bytes())))
}

fn read(path: &Path) -> Result<Catalog, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Catalog {
                version: 1,
                records: BTreeMap::new(),
                origins: BTreeMap::new(),
            })
        }
        Err(_) => return Err("catalog_read_failed".into()),
        Ok(meta) if meta.len() > MAX_CATALOG_BYTES => return Err("catalog_too_large".into()),
        Ok(_) => {}
    }
    let data = fs::read(path).map_err(|_| "catalog_read_failed")?;
    let catalog: Catalog = serde_json::from_slice(&data).map_err(|_| "catalog_invalid")?;
    if catalog.version != 1
        || catalog.records.len() > MAX_RECORDS
        || catalog.origins.len() > MAX_RECORDS
    {
        return Err("catalog_invalid".into());
    }
    Ok(catalog)
}

fn transaction<T>(
    root: &Path,
    body: impl FnOnce(&mut Catalog) -> Result<T, String>,
) -> Result<T, String> {
    let path = root.join(".catalog.json");
    store_lock::with_exclusive_lock(&path, || {
        let mut catalog = read(&path)?;
        let previous = catalog.records.clone();
        let previous_origins = catalog.origins.clone();
        let result = body(&mut catalog)?;
        if catalog.records != previous || catalog.origins != previous_origins {
            if catalog.records.len() > MAX_RECORDS || catalog.origins.len() > MAX_RECORDS {
                return Err("catalog_too_large".into());
            }
            let bytes = serde_json::to_vec(&catalog).map_err(|_| "catalog_write_failed")?;
            if bytes.len() as u64 > MAX_CATALOG_BYTES {
                return Err("catalog_too_large".into());
            }
            store_lock::write_bytes_replace(&path, &bytes).map_err(|_| "catalog_write_failed")?;
        }
        Ok(result)
    })
}

fn record_for(
    root: &Path,
    path: &Path,
    previous: Option<&MediaRecord>,
) -> Result<MediaRecord, String> {
    let relative = key(root, path)?;
    let stat = fs::metadata(path).map_err(|_| "catalog_read_failed")?;
    if !stat.is_file() {
        return Err("path_not_allowed".into());
    }
    let modified_ms = stat
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Some(saved) = previous.filter(|r| r.bytes == stat.len() && r.modified_ms == modified_ms)
    {
        return Ok(saved.clone());
    }
    let dimensions = image::ImageReader::open(path)
        .ok()
        .and_then(|r| r.with_guessed_format().ok())
        .and_then(|r| r.into_dimensions().ok());
    let source = relative
        .split('/')
        .next()
        .filter(|s| {
            matches!(
                *s,
                "x" | "web" | "openverse" | "pexels" | "grok_album" | "imagine"
            )
        })
        .unwrap_or("library")
        .to_string();
    Ok(MediaRecord {
        // A replacement is a new work, even if it reuses a known filename.
        // Keep legacy IDs for unchanged files; never revive an old parent or
        // remote-origin association after a scan accepts the replacement.
        id: if previous.is_some() {
            stable_id(&format!("{relative}:{}", uuid::Uuid::new_v4()))
        } else {
            stable_id(&relative)
        },
        purpose: if source == "imagine" {
            "generated"
        } else {
            "cache"
        }
        .into(),
        source,
        source_url: None,
        source_name: None,
        author_name: None,
        author_url: None,
        license: None,
        license_url: None,
        title: None,
        width: dimensions.map(|d| d.0),
        height: dimensions.map(|d| d.1),
        prompt: None,
        generation: None,
        parent_id: None,
        favorite: false,
        bytes: stat.len(),
        modified_ms,
    })
}

fn public_url(value: Option<String>) -> Option<String> {
    let mut url = url::Url::parse(value.as_deref()?).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_query(None);
    url.set_fragment(None);
    (url.as_str().len() <= 2_048).then(|| url.to_string())
}

fn bounded(value: Option<String>, limit: usize) -> Option<String> {
    value
        .map(|s| {
            s.chars()
                .filter(|c| !c.is_control())
                .take(limit)
                .collect::<String>()
        })
        .filter(|s| !s.trim().is_empty())
}

pub(crate) fn hydrate(root: &Path, rows: &mut [WallpaperLibraryEntry]) -> Result<(), String> {
    transaction(root, |catalog| {
        for row in rows {
            let path = Path::new(&row.path);
            // Files may disappear between directory enumeration and this transaction.
            if !path.is_file() {
                continue;
            }
            let relative = key(root, path)?;
            let record = record_for(root, path, catalog.records.get(&relative))?;
            row.metadata = Some(record.clone());
            catalog.insert(relative, record);
        }
        Ok(())
    })
}

pub(crate) fn remember(
    path: &str,
    metadata: SourceMetadata,
    favorite: Option<bool>,
) -> Result<MediaRecord, String> {
    remember_at(
        &wallpaper_source::wallpapers_root(),
        Path::new(path),
        metadata,
        favorite,
    )
}

fn remember_at(
    root: &Path,
    path: &Path,
    metadata: SourceMetadata,
    favorite: Option<bool>,
) -> Result<MediaRecord, String> {
    let relative = key(root, path)?;
    let kind = if path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| matches!(ext.to_lowercase().as_str(), "mp4" | "webm"))
    {
        wallpaper_source::LocalWallpaperMediaKind::Video
    } else {
        wallpaper_source::LocalWallpaperMediaKind::Image
    };
    wallpaper_source::validate_local_wallpaper_media(path, kind)?;
    let origin = metadata
        .source
        .as_deref()
        .zip(metadata.media_url.as_deref())
        .and_then(|(source, url)| origin_key(source, url));
    transaction(root, |catalog| {
        let mut record = record_for(root, path, catalog.records.get(&relative))?;
        if let Some(source) = metadata.source.filter(|s| {
            matches!(
                s.as_str(),
                "x" | "web" | "openverse" | "pexels" | "grok_album"
            )
        }) {
            record.source = source;
        }
        if let Some(value) = public_url(metadata.source_url) {
            record.source_url = Some(value);
        }
        if let Some(value) = bounded(metadata.source_name, 200) {
            record.source_name = Some(value);
        }
        if let Some(value) = bounded(metadata.author_name, 200) {
            record.author_name = Some(value);
        }
        if let Some(value) = public_url(metadata.author_url) {
            record.author_url = Some(value);
        }
        if let Some(value) = bounded(metadata.license, 200) {
            record.license = Some(value);
        }
        if let Some(value) = public_url(metadata.license_url) {
            record.license_url = Some(value);
        }
        if let Some(value) = bounded(metadata.title, 500) {
            record.title = Some(value);
        }
        if let Some(favorite) = favorite {
            record.favorite = favorite;
        }
        catalog.insert(relative.clone(), record.clone());
        if let Some(origin) = origin {
            catalog.origins.insert(origin, relative.clone());
        }
        Ok(record)
    })
}

pub(crate) fn lookup(requests: &[MediaLookup]) -> Result<Vec<MediaMatch>, String> {
    lookup_at(&wallpaper_source::wallpapers_root(), requests)
}

fn lookup_at(root: &Path, requests: &[MediaLookup]) -> Result<Vec<MediaMatch>, String> {
    if requests.len() > 96 {
        return Err("catalog_lookup_limit".into());
    }
    store_lock::with_exclusive_lock(&root.join(".catalog.json"), || {
        let catalog = read(&root.join(".catalog.json"))?;
        let mut matches = Vec::new();
        for (index, request) in requests.iter().enumerate() {
            let Some(origin) = origin_key(&request.source, &request.media_url) else {
                continue;
            };
            let Some(relative) = catalog.origins.get(&origin) else {
                continue;
            };
            let Some(record) = catalog.records.get(relative) else {
                continue;
            };
            let path = root.join(relative);
            if !path.is_file() || key(root, &path).as_ref() != Ok(relative) {
                continue;
            }
            let current = record_for(root, &path, Some(record))?;
            // A replacement file at the same path is no longer this remote media.
            if current != *record {
                continue;
            }
            crate::path_scope::grant_path(&path);
            matches.push(MediaMatch {
                index,
                path: crate::process_util::strip_extended_path_prefix(&path.to_string_lossy()),
                metadata: current,
            });
        }
        Ok(matches)
    })
}

pub(crate) fn record_generation(
    path: &Path,
    prompt: Option<&str>,
    parameters: GenerationParameters,
    parent: Option<&Path>,
) -> Result<MediaRecord, String> {
    record_generation_at(
        &wallpaper_source::wallpapers_root(),
        path,
        prompt,
        parameters,
        parent,
    )
}

pub(crate) fn find_by_id(id: &str) -> Result<Option<WallpaperLibraryEntry>, String> {
    find_by_id_at(&wallpaper_source::wallpapers_root(), id)
}

fn find_by_id_at(root: &Path, id: &str) -> Result<Option<WallpaperLibraryEntry>, String> {
    if id.len() != 70
        || !id.starts_with("media-")
        || !id[6..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("catalog_invalid_id".into());
    }
    store_lock::with_exclusive_lock(&root.join(".catalog.json"), || {
        let catalog = read(&root.join(".catalog.json"))?;
        let Some((relative, record)) = catalog.records.iter().find(|(_, record)| record.id == id)
        else {
            return Ok(None);
        };
        let path = root.join(relative);
        if !path.is_file() || key(root, &path).as_ref() != Ok(relative) {
            return Ok(None);
        }
        if record_for(root, &path, Some(record))? != *record {
            return Ok(None);
        }
        let video = path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| matches!(ext.to_lowercase().as_str(), "mp4" | "webm"));
        wallpaper_source::validate_local_wallpaper_media(
            &path,
            if video {
                wallpaper_source::LocalWallpaperMediaKind::Video
            } else {
                wallpaper_source::LocalWallpaperMediaKind::Image
            },
        )?;
        crate::path_scope::grant_path(&path);
        Ok(Some(WallpaperLibraryEntry {
            path: crate::process_util::strip_extended_path_prefix(&path.to_string_lossy()),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            source: record.source.clone(),
            kind: if video { "video" } else { "image" }.into(),
            bytes: record.bytes,
            modified_ms: record.modified_ms,
            metadata: Some(record.clone()),
        }))
    })
}

fn record_generation_at(
    root: &Path,
    path: &Path,
    prompt: Option<&str>,
    parameters: GenerationParameters,
    parent: Option<&Path>,
) -> Result<MediaRecord, String> {
    let relative = key(root, path)?;
    transaction(root, |catalog| {
        // Uploaded source images may never have appeared in a gallery scan.
        // Persist their record now so parent navigation works immediately.
        let parent_id = if let Some(parent) = parent {
            let parent_key = key(root, parent)?;
            let parent_record = record_for(root, parent, catalog.records.get(&parent_key))?;
            let id = parent_record.id.clone();
            catalog.insert(parent_key, parent_record);
            Some(id)
        } else {
            None
        };
        let mut record = record_for(root, path, catalog.records.get(&relative))?;
        record.source = "imagine".into();
        record.purpose = "generated".into();
        record.prompt = prompt.map(|value| value.chars().take(4_000).collect());
        record.generation = Some(parameters);
        record.parent_id = parent_id;
        catalog.insert(relative, record.clone());
        Ok(record)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn fixture() -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("grok-wallpaper-catalog-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("original.png");
        image::RgbImage::new(24, 12).save(&path).unwrap();
        (root, path)
    }

    #[test]
    fn favorite_and_provenance_survive_reread() {
        let (root, path) = fixture();
        let media_url = "https://cdn.example.org/photo.jpg?size=large";
        let saved = remember_at(
            &root,
            &path,
            SourceMetadata {
                source: Some("openverse".into()),
                media_url: Some(media_url.into()),
                source_url: Some("https://example.org/photo?token=secret#fragment".into()),
                ..Default::default()
            },
            Some(true),
        )
        .unwrap();
        assert!(saved.favorite);
        assert_eq!(saved.width, Some(24));
        assert_eq!(saved.height, Some(12));
        assert_eq!(
            saved.source_url.as_deref(),
            Some("https://example.org/photo")
        );
        let restored = remember_at(&root, &path, SourceMetadata::default(), Some(false)).unwrap();
        assert!(!restored.favorite);
        assert_eq!(saved.id, restored.id);
        assert_eq!(saved.source, restored.source);
        let matches = lookup_at(
            &root,
            &[MediaLookup {
                source: "openverse".into(),
                media_url: format!("{media_url}#preview"),
            }],
        )
        .unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].metadata.id, saved.id);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn author_metadata_is_bounded_sanitized_and_legacy_compatible() {
        let (root, path) = fixture();
        let saved = remember_at(
            &root,
            &path,
            SourceMetadata {
                source_name: Some("Openverse".into()),
                author_name: Some(format!("A\n{}", "名".repeat(220))),
                author_url: Some("https://example.org/author?token=private#fragment".into()),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let restored = remember_at(&root, &path, SourceMetadata::default(), None).unwrap();
        assert_eq!(saved, restored);
        assert_eq!(restored.author_name.unwrap().chars().count(), 200);
        assert_eq!(
            restored.author_url.as_deref(),
            Some("https://example.org/author")
        );
        let mut legacy = serde_json::to_value(saved).unwrap();
        for field in ["sourceName", "authorName", "authorUrl"] {
            legacy.as_object_mut().unwrap().remove(field);
        }
        let legacy: MediaRecord = serde_json::from_value(legacy).unwrap();
        assert!(
            legacy.source_name.is_none()
                && legacy.author_name.is_none()
                && legacy.author_url.is_none()
        );
        assert_eq!(legacy.width, Some(24));
        assert!(public_url(Some("https://user:pass@example.org/author".into())).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parent_lookup_rejects_replaced_missing_and_outside_records() {
        let (root, path) = fixture();
        let saved = remember_at(&root, &path, SourceMetadata::default(), None).unwrap();
        assert!(find_by_id_at(&root, &saved.id).unwrap().is_some());
        assert!(find_by_id_at(&root, "../private").is_err());
        image::RgbImage::new(60, 30).save(&path).unwrap();
        assert!(find_by_id_at(&root, &saved.id).unwrap().is_none());
        fs::remove_file(&path).unwrap();
        assert!(find_by_id_at(&root, &saved.id).unwrap().is_none());
        let (outside_root, outside) = fixture();
        transaction(&root, |catalog| {
            catalog.records.clear();
            catalog
                .records
                .insert(outside.to_string_lossy().into_owned(), saved.clone());
            Ok(())
        })
        .unwrap();
        assert!(find_by_id_at(&root, &saved.id).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside_root).unwrap();
    }

    #[test]
    fn remote_lookup_survives_reread_and_rejects_changed_or_missing_files() {
        let (root, path) = fixture();
        let url = "https://cdn.example.test/photo?id=one";
        let saved = remember_at(
            &root,
            &path,
            SourceMetadata {
                source: Some("openverse".into()),
                media_url: Some(url.into()),
                ..Default::default()
            },
            Some(true),
        )
        .unwrap();
        let requests = vec![
            MediaLookup {
                source: "pexels".into(),
                media_url: url.into(),
            },
            MediaLookup {
                source: "openverse".into(),
                media_url: format!("{url}#preview"),
            },
            MediaLookup {
                source: "openverse".into(),
                media_url: "https://cdn.example.test/photo?id=two".into(),
            },
        ];
        let matches = lookup_at(&root, &requests).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].index, 1);
        assert_eq!(matches[0].metadata, saved);
        assert!(!fs::read_to_string(root.join(".catalog.json"))
            .unwrap()
            .contains(url));
        image::RgbImage::new(60, 30).save(&path).unwrap();
        assert!(lookup_at(&root, &requests).unwrap().is_empty());
        fs::remove_file(&path).unwrap();
        assert!(lookup_at(&root, &requests).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refresh_cannot_reassociate_replacement_with_old_origin() {
        let (root, path) = fixture();
        let url = "https://cdn.example.test/original.png";
        let original = remember_at(
            &root,
            &path,
            SourceMetadata {
                source: Some("web".into()),
                media_url: Some(url.into()),
                ..Default::default()
            },
            Some(true),
        )
        .unwrap();
        image::RgbImage::new(60, 30).save(&path).unwrap();
        let mut rows = Vec::new();
        wallpaper_source::collect_library(&root, &root, &mut rows);
        hydrate(&root, &mut rows).unwrap();
        let replacement = rows[0].metadata.as_ref().unwrap().clone();
        assert_ne!(replacement.id, original.id);
        assert!(!replacement.favorite);
        assert!(find_by_id_at(&root, &original.id).unwrap().is_none());
        assert!(find_by_id_at(&root, &replacement.id).unwrap().is_some());
        assert!(lookup_at(
            &root,
            &[MediaLookup {
                source: "web".into(),
                media_url: url.into(),
            }]
        )
        .unwrap()
        .is_empty());

        hydrate(&root, &mut rows).unwrap();
        assert_eq!(rows[0].metadata.as_ref().unwrap().id, replacement.id);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_lookup_abuse_and_reads_legacy_catalogs() {
        let (root, _) = fixture();
        fs::write(root.join(".catalog.json"), br#"{"version":1,"records":{}}"#).unwrap();
        assert!(lookup_at(&root, &[]).unwrap().is_empty());
        let requests = (0..97)
            .map(|_| MediaLookup {
                source: "x".into(),
                media_url: "https://example.test/photo".into(),
            })
            .collect::<Vec<_>>();
        assert!(lookup_at(&root, &requests).is_err());
        assert!(origin_key("x", "https://user:pass@example.test/photo").is_none());
        assert!(origin_key("x", "file:///private.png").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_outside_files_and_preserves_a_corrupt_catalog() {
        let (root, original) = fixture();
        let (other_root, outside) = fixture();
        assert!(remember_at(&root, &outside, SourceMetadata::default(), Some(true)).is_err());
        let invalid = root.join("invalid.png");
        fs::write(&invalid, b"not an image").unwrap();
        assert!(remember_at(&root, &invalid, SourceMetadata::default(), None).is_err());
        let catalog = root.join(".catalog.json");
        fs::write(&catalog, b"corrupt").unwrap();
        assert!(remember_at(&root, &original, SourceMetadata::default(), Some(true)).is_err());
        assert_eq!(fs::read(&catalog).unwrap(), b"corrupt");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other_root).unwrap();
    }
}
