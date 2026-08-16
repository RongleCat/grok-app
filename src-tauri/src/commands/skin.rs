// Skin pack / preset / catalog / deeplink command wrappers (included into commands).

use std::path::PathBuf;

use crate::path_scope;
use crate::skin_catalog;
use crate::skin_deeplink::{self, PendingSkinImport, PendingSlot};
use crate::skin_pack::{self, SkinPackPreviewDto};
use crate::skin_presets::{self, PresetIndexEntry};
use crate::skin_staging;

fn desktop_only() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn skin_pick_open() -> Result<Option<String>, String> {
    desktop_only()?;
    let file = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Open appearance pack")
            .add_filter("Grok skin pack", &["grokskin", "zip"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.map(|p| {
        path_scope::grant_path(&p);
        p.display().to_string()
    }))
}

#[tauri::command]
pub async fn skin_pick_save(default_name: Option<String>) -> Result<Option<String>, String> {
    desktop_only()?;
    let name = default_name.unwrap_or_else(|| "skin.grokskin".into());
    let file = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Save appearance pack")
            .set_file_name(&name)
            .add_filter("Grok skin pack", &["grokskin"])
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.map(|p| {
        path_scope::grant_path(&p);
        p.display().to_string()
    }))
}

#[tauri::command]
pub async fn skin_pack_inspect(path: String) -> Result<SkinPackPreviewDto, String> {
    let p = PathBuf::from(path);
    path_scope::grant_path(&p);
    tauri::async_runtime::spawn_blocking(move || skin_pack::inspect_pack(&p, "file"))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_inspect_abort(inspect_id: String) -> Result<(), String> {
    skin_staging::abort_inspect(&inspect_id)
}

#[tauri::command]
pub async fn skin_pack_export(
    dest_path: String,
    staging_id: Option<String>,
    manifest: serde_json::Value,
) -> Result<crate::skin_pack::SkinExportResult, String> {
    let dest = PathBuf::from(dest_path);
    path_scope::grant_path(&dest);
    tauri::async_runtime::spawn_blocking(move || {
        let wallpaper = if let Some(id) = staging_id.as_deref() {
            let dir = crate::skin_staging::consume_upload(id)?;
            let blob = dir.join("blob.bin");
            let ext = manifest
                .get("wallpaper")
                .and_then(|w| w.get("file"))
                .and_then(|f| f.as_str())
                .and_then(|f| f.rsplit('.').next())
                .unwrap_or("bin");
            let named = dir.join(format!("wallpaper.{ext}"));
            if blob.is_file() {
                let _ = std::fs::copy(&blob, &named);
                Some(named)
            } else {
                None
            }
        } else {
            None
        };
        let r = skin_pack::export_pack(&dest, &manifest, wallpaper.as_deref());
        if let Some(id) = staging_id.as_deref() {
            let _ = crate::skin_staging::abort_upload(id);
        }
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_staging_begin() -> Result<skin_staging::StagingBegin, String> {
    skin_staging::begin_upload()
}

#[tauri::command]
pub async fn skin_staging_append(staging_id: String, chunk_base64: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        skin_staging::append_upload(&staging_id, &chunk_base64)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_staging_abort(staging_id: String) -> Result<(), String> {
    skin_staging::abort_upload(&staging_id)
}

#[tauri::command]
pub async fn skin_preset_list() -> Result<serde_json::Value, String> {
    let presets = skin_presets::list_presets()?;
    Ok(serde_json::json!({
        "presets": presets,
        "usage": skin_presets::disk_usage(),
    }))
}

#[tauri::command]
pub async fn skin_preset_save_from_upload(
    staging_id: String,
    manifest: serde_json::Value,
) -> Result<PresetIndexEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        skin_presets::save_from_upload(&staging_id, manifest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_preset_save_from_inspect(inspect_id: String) -> Result<PresetIndexEntry, String> {
    tauri::async_runtime::spawn_blocking(move || skin_presets::save_from_inspect(&inspect_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_preset_materialize(id: String) -> Result<SkinPackPreviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || skin_presets::materialize(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_preset_delete(id: String) -> Result<(), String> {
    skin_presets::delete_preset(&id)
}

#[tauri::command]
pub async fn skin_preset_rename(id: String, name: String) -> Result<PresetIndexEntry, String> {
    skin_presets::rename_preset(&id, &name)
}

#[tauri::command]
pub async fn skin_preset_replace_from_upload(
    id: String,
    staging_id: String,
    manifest: serde_json::Value,
) -> Result<PresetIndexEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        skin_presets::replace_from_upload(&id, &staging_id, manifest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_preset_export(
    id: String,
    dest_path: String,
) -> Result<crate::skin_pack::SkinExportResult, String> {
    let dest = PathBuf::from(dest_path);
    path_scope::grant_path(&dest);
    tauri::async_runtime::spawn_blocking(move || skin_presets::export_preset(&id, &dest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_undo_prepare() -> Result<String, String> {
    skin_presets::undo_prepare()
}

#[tauri::command]
pub async fn skin_undo_append(snapshot_id: String, chunk_base64: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || skin_presets::undo_append(&snapshot_id, &chunk_base64))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_undo_commit(snapshot_id: String, manifest: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || skin_presets::undo_commit(&snapshot_id, manifest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn skin_undo_abort(snapshot_id: String) -> Result<(), String> {
    skin_presets::undo_abort(&snapshot_id)
}

#[tauri::command]
pub async fn skin_catalog_fetch(
    source_id: String,
    force: Option<bool>,
) -> Result<Vec<skin_catalog::CatalogPack>, String> {
    skin_catalog::fetch_catalog(&source_id, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn skin_catalog_download(
    source_id: String,
    pack_id: String,
) -> Result<SkinPackPreviewDto, String> {
    skin_catalog::download_pack(&source_id, &pack_id).await
}

#[tauri::command]
pub async fn skin_catalog_preview_path(
    source_id: String,
    pack_id: String,
) -> Result<Option<String>, String> {
    skin_catalog::preview_path(&source_id, &pack_id).await
}

#[tauri::command]
pub async fn skin_sources_list() -> Result<Vec<skin_catalog::SkinSource>, String> {
    skin_catalog::list_sources()
}

#[tauri::command]
pub async fn skin_sources_add(url: String, label: Option<String>) -> Result<skin_catalog::SkinSource, String> {
    skin_catalog::add_source(&url, label.as_deref().unwrap_or(""))
}

#[tauri::command]
pub async fn skin_sources_remove(id: String) -> Result<(), String> {
    skin_catalog::remove_source(&id)
}

#[tauri::command]
pub async fn skin_sources_set_enabled(
    id: String,
    enabled: bool,
) -> Result<skin_catalog::SkinSource, String> {
    skin_catalog::set_source_enabled(&id, enabled)
}

#[tauri::command]
pub async fn skin_import_take_pending(
    slot: State<'_, Arc<PendingSlot>>,
) -> Result<Option<PendingSkinImport>, String> {
    Ok(skin_deeplink::take_pending(&slot))
}

#[tauri::command]
pub async fn skin_pack_fetch_url(href: String) -> Result<SkinPackPreviewDto, String> {
    skin_catalog::fetch_url_pack(&href).await
}
