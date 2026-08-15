//! First-party theme catalog fetch / download / user sources.

use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::paths;
use crate::skin_disk;
use crate::skin_net::{
    self, official_configured, OriginPolicy, OFFICIAL_SKIN_CATALOG_ID, OFFICIAL_SKIN_CATALOG_URL,
};
use crate::skin_pack::{self, SkinPackPreviewDto};

const CATALOG_MAX: u64 = 512 * 1024;
const PACKS_MAX: usize = 200;
const USER_SOURCE_LIMIT: usize = 5;
const CACHE_TTL_SECS: u64 = 6 * 60 * 60;
const PACK_MAX: u64 = 201 * 1024 * 1024;
const PREVIEW_MAX: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinSource {
    pub id: String,
    pub url: String,
    pub enabled: bool,
    pub official: bool,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPack {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub preview_url: String,
    pub download_url: String,
    pub sha256: String,
    pub bytes: u64,
    #[serde(default)]
    pub skin: String,
    #[serde(default)]
    pub has_wallpaper: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn sources_path() -> PathBuf {
    crate::paths::skin_presets_dir().join("sources.json")
}

fn official_source(enabled: bool) -> SkinSource {
    SkinSource {
        id: OFFICIAL_SKIN_CATALOG_ID.into(),
        url: OFFICIAL_SKIN_CATALOG_URL.into(),
        enabled,
        official: true,
        label: "Official".into(),
    }
}

pub fn list_sources() -> Result<Vec<SkinSource>, String> {
    let mut official_enabled = true;
    let mut user = Vec::new();
    if let Ok(raw) = fs::read(sources_path()) {
        if let Ok(list) = serde_json::from_slice::<Vec<SkinSource>>(&raw) {
            for s in list {
                if s.official || s.id == OFFICIAL_SKIN_CATALOG_ID {
                    official_enabled = s.enabled;
                } else {
                    user.push(s);
                }
            }
        }
    }
    let mut out = vec![official_source(official_enabled)];
    out.extend(user);
    Ok(out)
}

fn write_sources(list: &[SkinSource]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(list).map_err(|e| format!("invalid_pack: {e}"))?;
    fs::write(sources_path(), bytes).map_err(|e| format!("invalid_pack: {e}"))
}

pub fn add_source(url: &str, label: &str) -> Result<SkinSource, String> {
    let parsed = Url::parse(url).map_err(|_| "url_blocked: invalid url".to_string())?;
    skin_net::check_hop(url, &OriginPolicy::AnyHttps, skin_net::default_resolve)?;
    if parsed.scheme() != "https" {
        return Err("url_blocked: https required".into());
    }
    let mut list = list_sources()?;
    let users: Vec<_> = list.iter().filter(|s| !s.official).collect();
    if users.len() >= USER_SOURCE_LIMIT {
        return Err("preset_limit: max 5 user sources".into());
    }
    if list.iter().any(|s| s.url == url) {
        return Err("invalid_pack: source exists".into());
    }
    let src = SkinSource {
        id: uuid::Uuid::new_v4().to_string(),
        url: url.to_string(),
        enabled: true,
        official: false,
        label: label.trim().chars().take(80).collect(),
    };
    list.push(src.clone());
    write_sources(&list)?;
    Ok(src)
}

pub fn remove_source(id: &str) -> Result<(), String> {
    if id == OFFICIAL_SKIN_CATALOG_ID {
        return Err("invalid_pack: official source cannot be removed".into());
    }
    let list: Vec<_> = list_sources()?
        .into_iter()
        .filter(|s| s.id != id)
        .collect();
    write_sources(&list)
}

pub fn set_source_enabled(id: &str, enabled: bool) -> Result<SkinSource, String> {
    let mut list = list_sources()?;
    let mut found = None;
    for s in list.iter_mut() {
        if s.id == id {
            s.enabled = enabled;
            if s.official {
                s.url = OFFICIAL_SKIN_CATALOG_URL.into();
            }
            found = Some(s.clone());
        }
    }
    let found = found.ok_or_else(|| "not_found: source".to_string())?;
    write_sources(&list)?;
    Ok(found)
}

fn cache_dir(source_id: &str) -> PathBuf {
    paths::skin_catalog_cache_dir().join(source_id)
}

fn cache_fresh(path: &PathBuf) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|d| d.as_secs() < CACHE_TTL_SECS)
        .unwrap_or(false)
}

fn parse_catalog(bytes: &[u8], policy: &OriginPolicy) -> Result<Vec<CatalogPack>, String> {
    if bytes.len() as u64 > CATALOG_MAX {
        return Err("too_large: catalog.json".into());
    }
    let v: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid_pack: catalog json: {e}"))?;
    if v.get("schemaVersion").and_then(|x| x.as_u64()) != Some(1) {
        return Err("unsupported_schema: catalog schemaVersion".into());
    }
    let packs = v
        .get("packs")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "invalid_pack: packs".to_string())?;
    if packs.len() > PACKS_MAX {
        return Err("too_large: too many packs".into());
    }
    let mut out = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for p in packs {
        let id = p
            .get("id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "invalid_pack: pack id".to_string())?;
        if !ids.insert(id.to_string()) {
            return Err("invalid_pack: duplicate pack id".into());
        }
        let download = p
            .get("downloadUrl")
            .and_then(|x| x.as_str())
            .ok_or_else(|| "invalid_pack: downloadUrl".to_string())?;
        let preview = p.get("previewUrl").and_then(|x| x.as_str()).unwrap_or("");
        skin_net::check_hop(download, policy, skin_net::default_resolve)?;
        if !preview.is_empty() {
            skin_net::check_hop(preview, policy, skin_net::default_resolve)?;
        }
        let sha = p
            .get("sha256")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_lowercase();
        if sha.len() != 64 {
            return Err("invalid_pack: sha256".into());
        }
        let bytes = p.get("bytes").and_then(|x| x.as_u64()).unwrap_or(0);
        if bytes == 0 || bytes > PACK_MAX {
            return Err("too_large: pack bytes".into());
        }
        out.push(CatalogPack {
            id: id.to_string(),
            name: p
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or(id)
                .to_string(),
            description: p
                .get("description")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            author: p
                .get("author")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            preview_url: preview.to_string(),
            download_url: download.to_string(),
            sha256: sha,
            bytes,
            skin: p
                .get("skin")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            has_wallpaper: p
                .get("hasWallpaper")
                .and_then(|x| x.as_bool())
                .unwrap_or(false),
            kind: p.get("kind").and_then(|x| x.as_str()).map(|s| s.to_string()),
            tags: p
                .get("tags")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    Ok(out)
}

fn policy_for(src: &SkinSource) -> Result<OriginPolicy, String> {
    if src.official {
        if !official_configured() {
            return Err("official_unconfigured: official catalog URL is empty".into());
        }
        Ok(OriginPolicy::Official)
    } else {
        let catalog = Url::parse(&src.url).map_err(|_| "url_blocked: bad source url".to_string())?;
        Ok(OriginPolicy::UserSameOrigin { catalog })
    }
}

pub async fn fetch_catalog(
    source_id: &str,
    force: bool,
) -> Result<Vec<CatalogPack>, String> {
    let src = list_sources()?
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| "not_found: source".to_string())?;
    if !src.enabled {
        return Err("source_disabled: source is disabled".into());
    }
    if src.official && !official_configured() {
        return Err("official_unconfigured: official catalog URL is empty".into());
    }
    let policy = policy_for(&src)?;
    let cache = cache_dir(&src.id).join("catalog.json");
    if !force && cache_fresh(&cache) {
        if let Ok(bytes) = fs::read(&cache) {
            if let Ok(packs) = parse_catalog(&bytes, &policy) {
                return Ok(packs);
            }
        }
    }
    skin_disk::preflight(CATALOG_MAX)?;
    let bytes = skin_net::safe_https_get(&src.url, policy.clone(), CATALOG_MAX, None).await?;
    let packs = parse_catalog(&bytes, &policy)?;
    let _ = fs::create_dir_all(cache_dir(&src.id));
    let _ = fs::write(&cache, &bytes);
    Ok(packs)
}

pub async fn download_pack(
    source_id: &str,
    pack_id: &str,
) -> Result<SkinPackPreviewDto, String> {
    let src = list_sources()?
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| "not_found: source".to_string())?;
    if !src.enabled {
        return Err("source_disabled: source is disabled".into());
    }
    if src.official && !official_configured() {
        return Err("official_unconfigured: official catalog URL is empty".into());
    }
    let packs = fetch_catalog(source_id, false).await?;
    let pack = packs
        .into_iter()
        .find(|p| p.id == pack_id)
        .ok_or_else(|| "not_found: pack".to_string())?;
    let policy = policy_for(&src)?;
    skin_disk::preflight(pack.bytes.saturating_add(64 * 1024))?;
    let tmp = paths::skin_catalog_cache_dir().join(format!("dl-{}.grokskin", pack_id));
    let bytes = skin_net::safe_https_get(&pack.download_url, policy, PACK_MAX, Some(&tmp)).await?;
    let mut h = Sha256::new();
    h.update(&bytes);
    let got = hex::encode(h.finalize());
    if got != pack.sha256 {
        let _ = fs::remove_file(&tmp);
        return Err("hash_mismatch: catalog pack sha256".into());
    }
    let preview = skin_pack::inspect_pack(&tmp, "catalog");
    let _ = fs::remove_file(&tmp);
    let mut preview = preview?;
    preview.source_id = Some(pack.id);
    preview.source = "catalog".into();
    Ok(preview)
}

pub async fn fetch_url_pack(href: &str) -> Result<SkinPackPreviewDto, String> {
    skin_net::check_hop(href, &OriginPolicy::AnyHttps, skin_net::default_resolve)?;
    skin_disk::preflight(PACK_MAX)?;
    let tmp = paths::skin_catalog_cache_dir().join(format!("url-{}.grokskin", uuid::Uuid::new_v4()));
    let _ = skin_net::safe_https_get(href, OriginPolicy::AnyHttps, PACK_MAX, Some(&tmp)).await?;
    let preview = skin_pack::inspect_pack(&tmp, "deeplink");
    let _ = fs::remove_file(&tmp);
    preview
}

pub async fn preview_path(source_id: &str, pack_id: &str) -> Result<Option<String>, String> {
    let packs = fetch_catalog(source_id, false).await?;
    let pack = match packs.into_iter().find(|p| p.id == pack_id) {
        Some(p) => p,
        None => return Ok(None),
    };
    if pack.preview_url.is_empty() {
        return Ok(None);
    }
    let src = list_sources()?
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| "not_found: source".to_string())?;
    let policy = policy_for(&src)?;
    let dest = cache_dir(source_id).join(format!("{pack_id}.jpg"));
    if dest.is_file() && cache_fresh(&dest) {
        return Ok(Some(dest.display().to_string()));
    }
    skin_disk::preflight(PREVIEW_MAX)?;
    match skin_net::safe_https_get(&pack.preview_url, policy, PREVIEW_MAX, Some(&dest)).await {
        Ok(_) => Ok(Some(dest.display().to_string())),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_unconfigured_without_invented_rows() {
        assert_eq!(OFFICIAL_SKIN_CATALOG_URL, "");
        let src = official_source(true);
        assert!(src.url.is_empty());
        assert!(policy_for(&src).unwrap_err().starts_with("official_unconfigured"));
    }

    #[test]
    fn no_fetch_media() {
        let src = include_str!("skin_catalog.rs");
        let prod = src.split("#[cfg(test)]").next().unwrap();
        assert!(!prod.contains("wallpaper_source"));
        assert!(!prod.contains("fetch_media"));
    }
}
