//! Tauri boundary for independent Web and licensed-library wallpaper sources.

use tauri::AppHandle;

use crate::wallpaper_remote_search::{self, RemoteSearchResult, RemoteWallpaperSource};

#[tauri::command]
pub(crate) async fn wallpaper_remote_search(
    app: AppHandle,
    source: String,
    query: String,
    request_id: Option<String>,
) -> Result<RemoteSearchResult, String> {
    let source = RemoteWallpaperSource::parse(&source)?;
    let request_id = wallpaper_remote_search::request_id(request_id.as_deref())?;
    match source {
        RemoteWallpaperSource::Web => {
            crate::wallpaper_web_search::search(&app, &request_id, &query).await
        }
        RemoteWallpaperSource::Openverse | RemoteWallpaperSource::Pexels => {
            crate::wallpaper_provider_search::search(&app, source, &request_id, &query).await
        }
    }
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_search_more(
    app: AppHandle,
    source: String,
    query: String,
    request_id: Option<String>,
) -> Result<RemoteSearchResult, String> {
    let source = RemoteWallpaperSource::parse(&source)?;
    let request_id = wallpaper_remote_search::request_id(request_id.as_deref())?;
    match source {
        RemoteWallpaperSource::Web => {
            crate::wallpaper_web_search::search_more(&app, &request_id, &query).await
        }
        RemoteWallpaperSource::Openverse | RemoteWallpaperSource::Pexels => {
            crate::wallpaper_provider_search::search_more(&app, source, &request_id, &query).await
        }
    }
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_search_cancel(
    source: String,
    request_id: String,
) -> Result<bool, String> {
    let source = RemoteWallpaperSource::parse(&source)?;
    let request_id = wallpaper_remote_search::request_id(Some(&request_id))?;
    Ok(match source {
        RemoteWallpaperSource::Web => crate::wallpaper_web_search::cancel(&request_id),
        RemoteWallpaperSource::Openverse | RemoteWallpaperSource::Pexels => {
            crate::wallpaper_provider_search::cancel(&request_id)
        }
    })
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_fetch_media(
    source: String,
    url: String,
    request_id: String,
) -> Result<crate::wallpaper_source::WallpaperFetchResult, String> {
    let source = RemoteWallpaperSource::parse(&source)?;
    let request_id = wallpaper_remote_search::request_id(Some(&request_id))?;
    crate::wallpaper_source::ensure_wallpaper_dirs();
    crate::wallpaper_remote_media::fetch_and_store_image(&url, source, &request_id).await
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_thumbnail(
    source: String,
    url: String,
    request_id: String,
) -> Result<crate::wallpaper_remote_media::RemoteWallpaperThumbnail, String> {
    let source = RemoteWallpaperSource::parse(&source)?;
    let request_id = wallpaper_remote_search::request_id(Some(&request_id))?;
    crate::wallpaper_remote_media::fetch_thumbnail(&url, source, &request_id).await
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_cancel_media_requests(
    request_ids: Vec<String>,
) -> Result<usize, String> {
    let request_ids = request_ids
        .iter()
        .map(|request_id| wallpaper_remote_search::request_id(Some(request_id)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(crate::wallpaper_remote_media::cancel_media_requests(
        &request_ids,
    ))
}

#[tauri::command]
pub(crate) async fn wallpaper_remote_cancel_all_media_requests() -> Result<usize, String> {
    Ok(crate::wallpaper_remote_media::cancel_all_media_requests())
}
