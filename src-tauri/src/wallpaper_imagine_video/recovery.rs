//! Host-owned recovery records for generated media whose catalog write failed.

use super::*;
use serde::{Deserialize, Serialize};
use std::io::Read;

const RECOVERY_VERSION: u32 = 1;
const MAX_RECOVERY_BYTES: u64 = 64 * 1024;
const MAX_RECOVERIES: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileFingerprint {
    relative_path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryDescriptor {
    version: u32,
    recovery_id: String,
    output: FileFingerprint,
    kind: String,
    prompt: Option<String>,
    parameters: crate::wallpaper_catalog::GenerationParameters,
    parent: Option<FileFingerprint>,
    created_ms: u64,
    #[serde(default)]
    completed_ms: Option<u64>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn recovery_dir(root: &Path) -> PathBuf {
    root.join(".generation-recovery")
}

fn recovery_path(root: &Path, id: &str) -> Result<PathBuf, &'static str> {
    let id = uuid::Uuid::parse_str(id.trim()).map_err(|_| "catalog_recovery_invalid")?;
    Ok(recovery_dir(root).join(format!("{id}.json")))
}

fn relative_path(root: &Path, path: &Path) -> Result<String, &'static str> {
    let root = root
        .canonicalize()
        .map_err(|_| "catalog_recovery_invalid")?;
    let path = path
        .canonicalize()
        .map_err(|_| "catalog_recovery_invalid")?;
    if !wallpaper_source::is_path_under_dir(&path, &root) {
        return Err("catalog_recovery_invalid");
    }
    let relative = path
        .strip_prefix(&root)
        .map_err(|_| "catalog_recovery_invalid")?;
    if relative.components().any(|component| {
        !matches!(component, std::path::Component::Normal(_))
            || component.as_os_str().to_string_lossy().starts_with('.')
    }) {
        return Err("catalog_recovery_invalid");
    }
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn resolve_relative(root: &Path, relative: &str) -> Result<PathBuf, &'static str> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            !matches!(component, std::path::Component::Normal(_))
                || component.as_os_str().to_string_lossy().starts_with('.')
        })
    {
        return Err("catalog_recovery_invalid");
    }
    let path = root.join(relative);
    let canonical = path
        .canonicalize()
        .map_err(|_| "catalog_recovery_invalid")?;
    if !wallpaper_source::is_path_under_dir(&canonical, root) {
        return Err("catalog_recovery_invalid");
    }
    Ok(canonical)
}

fn sha256_file(path: &Path) -> Result<(u64, String), &'static str> {
    let metadata = fs::metadata(path).map_err(|_| "catalog_recovery_invalid")?;
    if !metadata.is_file() {
        return Err("catalog_recovery_invalid");
    }
    let mut file = fs::File::open(path).map_err(|_| "catalog_recovery_invalid")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "catalog_recovery_invalid")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok((metadata.len(), hex::encode(hasher.finalize())))
}

fn fingerprint(root: &Path, path: &Path) -> Result<FileFingerprint, &'static str> {
    let relative_path = relative_path(root, path)?;
    let (bytes, sha256) = sha256_file(path)?;
    Ok(FileFingerprint {
        relative_path,
        bytes,
        sha256,
    })
}

fn validate_fingerprint(root: &Path, expected: &FileFingerprint) -> Result<PathBuf, &'static str> {
    if expected.sha256.len() != 64 || !expected.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("catalog_recovery_invalid");
    }
    let path = resolve_relative(root, &expected.relative_path)?;
    let (bytes, sha256) = sha256_file(&path)?;
    if bytes != expected.bytes || sha256 != expected.sha256 {
        return Err("catalog_recovery_invalid");
    }
    Ok(path)
}

fn validate_descriptor(
    root: &Path,
    id: &str,
    descriptor: &RecoveryDescriptor,
) -> Result<(PathBuf, Option<PathBuf>), &'static str> {
    let canonical_id = uuid::Uuid::parse_str(id.trim())
        .map_err(|_| "catalog_recovery_invalid")?
        .to_string();
    if descriptor.version != RECOVERY_VERSION
        || descriptor.recovery_id != canonical_id
        || descriptor.prompt.as_ref().is_some_and(|value| {
            value.chars().count() > MAX_MOTION_PROMPT_CHARS || value.contains('\0')
        })
    {
        return Err("catalog_recovery_invalid");
    }

    let (expected_kind, parent_required) = match descriptor.parameters.operation.as_str() {
        "image_gen" => {
            if !matches!(
                descriptor.parameters.aspect_ratio.as_deref(),
                Some("auto" | "16:9" | "9:16" | "1:1" | "4:3")
            ) || descriptor.prompt.as_deref().is_none_or(str::is_empty)
                || descriptor.parameters.duration.is_some()
                || descriptor.parameters.resolution.is_some()
            {
                return Err("catalog_recovery_invalid");
            }
            ("image", false)
        }
        "image_edit" => {
            if !matches!(
                descriptor.parameters.aspect_ratio.as_deref(),
                Some("auto" | "16:9" | "9:16" | "1:1" | "4:3")
            ) || descriptor.prompt.as_deref().is_none_or(str::is_empty)
                || descriptor.parameters.duration.is_some()
                || descriptor.parameters.resolution.is_some()
            {
                return Err("catalog_recovery_invalid");
            }
            ("image", true)
        }
        "image_to_video" => {
            if !matches!(descriptor.parameters.duration, Some(6 | 10))
                || !matches!(
                    descriptor.parameters.resolution.as_deref(),
                    Some("480p" | "720p")
                )
                || descriptor.parameters.aspect_ratio.is_some()
            {
                return Err("catalog_recovery_invalid");
            }
            ("video", true)
        }
        _ => return Err("catalog_recovery_invalid"),
    };
    if descriptor
        .parameters
        .requested_model
        .as_ref()
        .is_some_and(|value| value.chars().count() > 200 || value.chars().any(char::is_control))
    {
        return Err("catalog_recovery_invalid");
    }
    if descriptor.kind != expected_kind || descriptor.parent.is_some() != parent_required {
        return Err("catalog_recovery_invalid");
    }
    let output = validate_fingerprint(root, &descriptor.output)?;
    wallpaper_source::validate_local_wallpaper_media(
        &output,
        if expected_kind == "video" {
            LocalWallpaperMediaKind::Video
        } else {
            LocalWallpaperMediaKind::Image
        },
    )
    .map_err(|_| "catalog_recovery_invalid")?;

    let parent = descriptor
        .parent
        .as_ref()
        .map(|value| {
            let path = validate_fingerprint(root, value)?;
            wallpaper_source::validate_local_wallpaper_media(&path, LocalWallpaperMediaKind::Image)
                .map_err(|_| "catalog_recovery_invalid")?;
            Ok::<PathBuf, &'static str>(path)
        })
        .transpose()?;
    Ok((output, parent))
}

fn read_descriptor(path: &Path) -> Result<RecoveryDescriptor, &'static str> {
    let metadata = fs::metadata(path).map_err(|_| "catalog_recovery_invalid")?;
    if !metadata.is_file() || metadata.len() > MAX_RECOVERY_BYTES {
        return Err("catalog_recovery_invalid");
    }
    let bytes = fs::read(path).map_err(|_| "catalog_recovery_invalid")?;
    serde_json::from_slice(&bytes).map_err(|_| "catalog_recovery_invalid")
}

fn write_descriptor(path: &Path, descriptor: &RecoveryDescriptor) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(descriptor).map_err(|_| "catalog_recovery_invalid")?;
    if bytes.len() as u64 > MAX_RECOVERY_BYTES {
        return Err("catalog_recovery_invalid");
    }
    crate::store_lock::write_bytes_atomic(path, &bytes).map_err(|_| "catalog_recovery_unavailable")
}

fn ensure_recovery_capacity(root: &Path) -> Result<(), &'static str> {
    let mut entries = fs::read_dir(recovery_dir(root))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let descriptor = read_descriptor(&path).ok()?;
            Some((
                path,
                descriptor.created_ms,
                descriptor.completed_ms.is_some(),
            ))
        })
        .collect::<Vec<_>>();
    if entries.len() < MAX_RECOVERIES {
        return Ok(());
    }
    entries.sort_by_key(|entry| entry.1);
    let mut remaining = entries.len();
    for (path, _, completed) in entries {
        if completed && fs::remove_file(path).is_ok() {
            remaining -= 1;
            if remaining < MAX_RECOVERIES {
                return Ok(());
            }
        }
    }
    Err("catalog_recovery_unavailable")
}

pub(super) fn persist_at(
    root: &Path,
    path: &Path,
    prompt: Option<&str>,
    parameters: crate::wallpaper_catalog::GenerationParameters,
    parent: Option<&Path>,
) -> Result<String, &'static str> {
    ensure_recovery_capacity(root)?;
    let kind = match parameters.operation.as_str() {
        "image_gen" | "image_edit" => "image",
        "image_to_video" => "video",
        _ => return Err("catalog_recovery_invalid"),
    };
    let recovery_id = uuid::Uuid::new_v4().to_string();
    let descriptor = RecoveryDescriptor {
        version: RECOVERY_VERSION,
        recovery_id: recovery_id.clone(),
        output: fingerprint(root, path)?,
        kind: kind.into(),
        prompt: prompt.map(str::to_string),
        parameters,
        parent: parent.map(|value| fingerprint(root, value)).transpose()?,
        created_ms: now_ms(),
        completed_ms: None,
    };
    let recovery_path = recovery_path(root, &recovery_id)?;
    write_descriptor(&recovery_path, &descriptor)?;
    Ok(recovery_id)
}

pub(super) fn recover(recovery_id: &str) -> WallpaperImagineResult {
    recover_at(&wallpaper_source::wallpapers_root(), recovery_id)
}

fn recover_at(root: &Path, recovery_id: &str) -> WallpaperImagineResult {
    let path = match recovery_path(root, recovery_id) {
        Ok(path) => path,
        Err(code) => return failure(code),
    };
    let mut descriptor = match read_descriptor(&path) {
        Ok(descriptor) => descriptor,
        Err(code) => return failure(code),
    };
    let (output, parent) = match validate_descriptor(root, recovery_id, &descriptor) {
        Ok(value) => value,
        Err(code) => return failure(code),
    };
    let mut item = match generated_media_item(
        &output,
        output.parent().unwrap_or(root),
        descriptor.prompt.as_deref(),
        descriptor.kind == "image",
    ) {
        Ok(item) => item,
        Err(_) => return failure("catalog_recovery_invalid"),
    };
    match crate::wallpaper_catalog::record_generation_at(
        root,
        &output,
        descriptor.prompt.as_deref(),
        descriptor.parameters.clone(),
        parent.as_deref(),
    ) {
        Ok(record) => {
            item.metadata = Some(record);
            if descriptor.completed_ms.is_none() {
                descriptor.completed_ms = Some(now_ms());
                let _ = write_descriptor(&path, &descriptor);
            }
            WallpaperImagineResult {
                items: vec![item],
                error_code: None,
                message: None,
                catalog_recovery_id: None,
            }
        }
        Err(_) => WallpaperImagineResult {
            items: vec![item],
            error_code: Some("catalog_write_failed".into()),
            message: None,
            catalog_recovery_id: Some(descriptor.recovery_id),
        },
    }
}

pub(super) fn pending() -> Vec<WallpaperImagineRecovery> {
    pending_at(&wallpaper_source::wallpapers_root())
}

fn pending_at(root: &Path) -> Vec<WallpaperImagineRecovery> {
    let mut descriptors = fs::read_dir(recovery_dir(root))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let descriptor = read_descriptor(&path).ok()?;
            if descriptor.completed_ms.is_some() {
                return None;
            }
            Some((descriptor.created_ms, descriptor))
        })
        .collect::<Vec<_>>();
    descriptors.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    descriptors
        .into_iter()
        .take(MAX_RECOVERIES)
        .filter_map(|(_, descriptor)| {
            let (output, _) =
                validate_descriptor(root, &descriptor.recovery_id, &descriptor).ok()?;
            let item = generated_media_item(
                &output,
                output.parent().unwrap_or(root),
                descriptor.prompt.as_deref(),
                descriptor.kind == "image",
            )
            .ok()?;
            Some(WallpaperImagineRecovery {
                recovery_id: descriptor.recovery_id,
                item,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "grok-wallpaper-recovery-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let parent = root.join("uploads").join("source.png");
        let output = root
            .join("imagine")
            .join("2026-09-10")
            .join("video-00000000000000000000000000000000")
            .join("result.png");
        fs::create_dir_all(parent.parent().unwrap()).unwrap();
        fs::create_dir_all(output.parent().unwrap()).unwrap();
        image::RgbImage::new(16, 9).save(&parent).unwrap();
        image::RgbImage::new(32, 18).save(&output).unwrap();
        (root, parent, output)
    }

    fn edit_parameters() -> crate::wallpaper_catalog::GenerationParameters {
        crate::wallpaper_catalog::GenerationParameters {
            operation: "image_edit".into(),
            aspect_ratio: Some("16:9".into()),
            ..Default::default()
        }
    }

    #[test]
    fn recovery_roundtrip_restores_lineage_and_is_idempotent() {
        let (root, parent, output) = fixture();
        let id = persist_at(
            &root,
            &output,
            Some("blue hour"),
            edit_parameters(),
            Some(&parent),
        )
        .unwrap();
        let raw = fs::read_to_string(recovery_path(&root, &id).unwrap()).unwrap();
        assert!(!raw.contains(&root.to_string_lossy().to_string()));
        assert_eq!(pending_at(&root).len(), 1);

        let first = recover_at(&root, &id);
        assert!(first.error_code.is_none());
        let record = first.items[0].metadata.as_ref().unwrap();
        assert_eq!(record.prompt.as_deref(), Some("blue hour"));
        assert_eq!(record.generation.as_ref().unwrap().operation, "image_edit");
        assert!(record.parent_id.is_some());
        assert!(pending_at(&root).is_empty());

        let repeated = recover_at(&root, &id);
        assert!(repeated.error_code.is_none());
        assert_eq!(repeated.items[0].metadata.as_ref().unwrap().id, record.id);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_rejects_missing_or_replaced_output() {
        let (root, parent, output) = fixture();
        let missing = persist_at(
            &root,
            &output,
            Some("first"),
            edit_parameters(),
            Some(&parent),
        )
        .unwrap();
        fs::remove_file(&output).unwrap();
        assert_eq!(
            recover_at(&root, &missing).error_code.as_deref(),
            Some("catalog_recovery_invalid")
        );

        image::RgbImage::new(32, 18).save(&output).unwrap();
        let replaced = persist_at(
            &root,
            &output,
            Some("second"),
            edit_parameters(),
            Some(&parent),
        )
        .unwrap();
        image::RgbImage::new(64, 36).save(&output).unwrap();
        assert_eq!(
            recover_at(&root, &replaced).error_code.as_deref(),
            Some("catalog_recovery_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_rejects_invalid_ids_and_changed_parents() {
        let (root, parent, output) = fixture();
        assert_eq!(
            recover_at(&root, "../descriptor").error_code.as_deref(),
            Some("catalog_recovery_invalid")
        );
        let id = persist_at(
            &root,
            &output,
            Some("scene"),
            edit_parameters(),
            Some(&parent),
        )
        .unwrap();
        image::RgbImage::new(24, 24).save(&parent).unwrap();
        assert_eq!(
            recover_at(&root, &id).error_code.as_deref(),
            Some("catalog_recovery_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finalize_returns_generated_item_and_retry_only_repairs_catalog() {
        let (root, _, output) = fixture();
        let original_bytes = fs::read(&output).unwrap();
        fs::write(root.join(".catalog.json"), b"not valid catalog json").unwrap();
        let item = generated_media_item(
            &output,
            output.parent().unwrap(),
            Some("blue hour recovery"),
            true,
        )
        .unwrap();
        let first = finalize_generated_item_at(
            &root,
            item,
            &output,
            Some("blue hour recovery"),
            crate::wallpaper_catalog::GenerationParameters {
                operation: "image_gen".into(),
                aspect_ratio: Some("16:9".into()),
                ..Default::default()
            },
            None,
            &WallpaperSearchCancellation::default(),
        )
        .unwrap();

        assert_eq!(first.items.len(), 1);
        assert!(first.items[0].metadata.is_none());
        assert_eq!(first.error_code.as_deref(), Some("catalog_write_failed"));
        let recovery_id = first.catalog_recovery_id.as_deref().unwrap();
        assert_eq!(pending_at(&root).len(), 1);
        assert_eq!(fs::read(&output).unwrap(), original_bytes);

        fs::remove_file(root.join(".catalog.json")).unwrap();
        let recovered = recover_at(&root, recovery_id);
        assert!(recovered.error_code.is_none());
        assert!(recovered.catalog_recovery_id.is_none());
        assert_eq!(recovered.items.len(), 1);
        let record = recovered.items[0].metadata.as_ref().unwrap();
        assert_eq!(record.prompt.as_deref(), Some("blue hour recovery"));
        assert_eq!(record.generation.as_ref().unwrap().operation, "image_gen");
        assert_eq!(fs::read(&output).unwrap(), original_bytes);
        assert!(pending_at(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
