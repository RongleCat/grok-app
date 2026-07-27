//! Persist Remote IM channel instances under ~/.grok-app/remote/.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::ChannelInstanceDto;
use crate::paths::{app_data_root, ensure_app_dirs};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ChannelsFile {
    instances: Vec<ChannelInstanceDto>,
}

fn remote_dir() -> PathBuf {
    let dir = app_data_root().join("remote");
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(dir.join("logs"));
    dir
}

fn channels_path() -> PathBuf {
    remote_dir().join("channels.json")
}

fn secrets_path() -> PathBuf {
    remote_dir().join("channel-secrets.json")
}

pub fn list_instances() -> Vec<ChannelInstanceDto> {
    let path = channels_path();
    if !path.exists() {
        return vec![];
    }
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<ChannelsFile>(&raw)
            .map(|f| f.instances)
            .unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_instances(list: &[ChannelInstanceDto]) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = channels_path();
    let file = ChannelsFile {
        instances: list.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("serialize channels: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("write channels: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn load_secrets_map() -> HashMap<String, HashMap<String, String>> {
    let path = secrets_path();
    if !path.exists() {
        return HashMap::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_secrets_map(map: &HashMap<String, HashMap<String, String>>) -> Result<(), String> {
    let path = secrets_path();
    let raw = serde_json::to_string_pretty(map)
        .map_err(|e| format!("serialize secrets: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("write secrets: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn get_secrets(instance_id: &str) -> HashMap<String, String> {
    load_secrets_map()
        .get(instance_id)
        .cloned()
        .unwrap_or_default()
}

pub fn save_instance(
    inst: &ChannelInstanceDto,
    secrets: &HashMap<String, String>,
) -> Result<ChannelInstanceDto, String> {
    let mut list = list_instances();
    let mut saved = inst.clone();

    // Merge secrets
    let mut all = load_secrets_map();
    let mut row = all.remove(&saved.id).unwrap_or_default();
    for (k, v) in secrets {
        let t = v.trim();
        if !t.is_empty() {
            row.insert(k.clone(), t.to_string());
        }
    }
    let has = !row.is_empty();
    if has {
        all.insert(saved.id.clone(), row);
    } else {
        all.remove(&saved.id);
    }
    write_secrets_map(&all)?;

    saved.has_credentials = has || inst.has_credentials;
    if saved.has_credentials && saved.enabled {
        saved.status = "configured".into();
    } else if saved.has_credentials {
        saved.status = "configured".into();
    } else {
        saved.status = "unconfigured".into();
    }
    saved.last_error = None;

    if let Some(i) = list.iter().position(|x| x.id == saved.id) {
        list[i] = saved.clone();
    } else {
        list.push(saved.clone());
    }
    write_instances(&list)?;

    Ok(saved)
}

pub fn delete_instance(instance_id: &str) -> Result<(), String> {
    let list: Vec<_> = list_instances()
        .into_iter()
        .filter(|x| x.id != instance_id)
        .collect();
    write_instances(&list)?;
    let mut all = load_secrets_map();
    all.remove(instance_id);
    write_secrets_map(&all)?;
    Ok(())
}

/// Persist connector exit / bind errors so UI does not show a false "connected".
pub fn set_instance_last_error(instance_id: &str, err: Option<String>) -> Result<(), String> {
    let mut list = list_instances();
    let Some(row) = list.iter_mut().find(|x| x.id == instance_id) else {
        return Ok(());
    };
    row.last_error = err.clone();
    if err.is_some() {
        row.status = "error".into();
    } else if row.has_credentials {
        row.status = "configured".into();
    }
    write_instances(&list)?;
    Ok(())
}

/// Legacy path kept for doctor/docs; Rust runtime does not require Node config.toml.
pub fn bridge_data_dir() -> PathBuf {
    let dir = app_data_root().join("remote").join("bridge-data");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn bridge_config_path() -> PathBuf {
    bridge_data_dir().join("config.toml")
}

pub fn remote_log_path() -> PathBuf {
    remote_dir().join("logs").join("bridge.log")
}

/// Host-persisted Bridge switch (survives App restart).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgePersistedConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_lifecycle")]
    pub lifecycle: String,
    #[serde(default)]
    pub allow_remote_yolo: bool,
}

fn default_lifecycle() -> String {
    "attached".into()
}

impl Default for BridgePersistedConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            lifecycle: default_lifecycle(),
            allow_remote_yolo: false,
        }
    }
}

fn bridge_persist_path() -> PathBuf {
    remote_dir().join("bridge-config.json")
}

pub fn load_bridge_config() -> BridgePersistedConfig {
    let path = bridge_persist_path();
    if !path.is_file() {
        // Auto-enable when user already has bound channels (first migration).
        let has_ready = list_instances()
            .iter()
            .any(|i| i.enabled && i.has_credentials);
        return BridgePersistedConfig {
            enabled: has_ready,
            ..Default::default()
        };
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_bridge_config(cfg: &BridgePersistedConfig) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = bridge_persist_path();
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("write bridge-config: {e}"))?;
    Ok(())
}

/// True when at least one channel can be connected.
pub fn has_ready_instances() -> bool {
    list_instances()
        .iter()
        .any(|i| i.enabled && i.has_credentials)
}
