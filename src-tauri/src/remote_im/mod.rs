//! Remote IM host: config, secrets, Feishu QR, **in-process Rust** multi-IM bridge.

mod app_sessions;
mod bridge;
#[cfg(test)]
mod catalog_ac4_tests;
mod channels;
mod config;
mod context;
mod control_plane;
mod engine;
mod feishu_reg;
#[cfg(test)]
mod fixture_http;
mod grok_agent;
mod i18n;
mod outbound;
mod pb_frame;
mod projects;
#[cfg(test)]
mod protocol_start_tests;
mod resilience;
mod runtime;
mod session;
mod slash;
mod types;
mod validate;
#[cfg(test)]
mod weixin_flow_tests;
mod weixin_reg;

pub use bridge::BridgeRuntime;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

/// Wire AppHandle for session index events after IM turns.
pub fn set_app_handle(app: AppHandle) {
    app_sessions::set_app_handle(app);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatusDto {
    pub state: String,
    pub enabled: bool,
    pub lifecycle: String,
    pub allow_remote_yolo: bool,
    pub connected_channels: Vec<ConnectedChannelDto>,
    pub last_error: Option<String>,
    pub mock: bool,
    /// Legacy field: now always `rust://in-process`.
    pub remote_bridge_path: Option<String>,
    /// `rust` | historical
    #[serde(default)]
    pub backend: Option<String>,
    /// Crash-recovery restart attempts since last successful listen (0 = healthy / first try).
    #[serde(default)]
    pub restart_attempt: u32,
    /// Seconds until next automatic restart attempt (0 / omit when not backing off).
    #[serde(default)]
    pub next_retry_secs: Option<u32>,
    /// idle | listening | starting | restarting | backing_off | degraded | rate_limited | error | stopped
    #[serde(default)]
    pub recovery_phase: Option<String>,
    /// rate_limit | auth | network | crash | config | unknown
    #[serde(default)]
    pub error_kind: Option<String>,
    /// True when last error / bridge is in a rate-limit posture (honest UI).
    #[serde(default)]
    pub rate_limited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedChannelDto {
    pub channel: String,
    pub instance_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionDto {
    pub ok: bool,
    pub message: String,
    pub mock: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBeginDto {
    pub device_code: String,
    pub verification_uri: String,
    pub interval_sec: u32,
    pub expire_in_sec: u32,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanPollDto {
    pub status: String,
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub owner_open_id: Option<String>,
    pub platform: Option<String>,
    pub error: Option<String>,
    /// When QR is refreshed server-side, new image/URL for GUI (Weixin).
    #[serde(default)]
    pub verification_uri: Option<String>,
    /// When QR key rotates, new device_code for subsequent polls.
    #[serde(default)]
    pub device_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInstanceDto {
    pub id: String,
    pub channel: String,
    pub name: String,
    pub enabled: bool,
    pub has_credentials: bool,
    pub options: serde_json::Value,
    pub acl: serde_json::Value,
    pub project_scope: serde_json::Value,
    pub presenter: String,
    pub status: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInstanceRequest {
    pub instance: ChannelInstanceDto,
    pub secrets: std::collections::HashMap<String, String>,
    pub connect_after_save: bool,
}

#[derive(Default)]
pub struct RemoteImState {
    pub inner: tokio::sync::Mutex<bridge::BridgeRuntime>,
}

#[tauri::command]
pub async fn remote_im_bridge_status(
    state: State<'_, std::sync::Arc<RemoteImState>>,
) -> Result<BridgeStatusDto, String> {
    let rt = state.inner.lock().await;
    Ok(rt.status_dto())
}

#[tauri::command]
pub async fn remote_im_bridge_start(
    state: State<'_, std::sync::Arc<RemoteImState>>,
) -> Result<BridgeStatusDto, String> {
    let mut rt = state.inner.lock().await;
    rt.start_async().await?;
    Ok(rt.status_dto())
}

#[tauri::command]
pub async fn remote_im_bridge_stop(
    state: State<'_, std::sync::Arc<RemoteImState>>,
) -> Result<BridgeStatusDto, String> {
    let mut rt = state.inner.lock().await;
    rt.stop_async().await?;
    Ok(rt.status_dto())
}

#[tauri::command]
pub async fn remote_im_bridge_set_config(
    state: State<'_, std::sync::Arc<RemoteImState>>,
    enabled: Option<bool>,
    lifecycle: Option<String>,
    allow_remote_yolo: Option<bool>,
) -> Result<BridgeStatusDto, String> {
    let mut rt = state.inner.lock().await;
    rt.set_config(enabled, lifecycle, allow_remote_yolo)?;
    if enabled == Some(true) {
        let _ = rt.start_async().await;
    } else if enabled == Some(false) {
        let _ = rt.stop_async().await;
    }
    Ok(rt.status_dto())
}

#[tauri::command]
pub async fn remote_im_bridge_reload(
    state: State<'_, std::sync::Arc<RemoteImState>>,
    instance_id: String,
    channel: String,
) -> Result<BridgeStatusDto, String> {
    let mut rt = state.inner.lock().await;
    rt.reload_async(&channel, &instance_id).await?;
    Ok(rt.status_dto())
}

/// Called from App setup to restore long-poll / Feishu WS after process restart.
pub async fn try_autostart(state: &RemoteImState) {
    let mut rt = state.inner.lock().await;
    match rt.try_autostart_async().await {
        Ok(()) => {}
        Err(e) => {
            tracing::warn!(error = %e, "remote_im: auto-start skipped/failed");
        }
    }
}

pub use bridge::start_health_watchdog;

#[tauri::command]
pub async fn remote_im_test_connection(
    channel: String,
    instance_id: String,
) -> Result<TestConnectionDto, String> {
    validate::test_connection(&channel, &instance_id).await
}

#[tauri::command]
pub async fn remote_im_scan_begin(
    channel: String,
    options: Option<std::collections::HashMap<String, String>>,
) -> Result<ScanBeginDto, String> {
    match channel.as_str() {
        "feishu" | "lark" => feishu_reg::scan_begin(&channel).await,
        "weixin" => weixin_reg::scan_begin(options.as_ref()).await,
        other => Err(format!(
            "scan not supported for channel {other}; use paste credentials"
        )),
    }
}

#[tauri::command]
pub async fn remote_im_scan_poll(
    channel: String,
    device_code: String,
) -> Result<ScanPollDto, String> {
    match channel.as_str() {
        "feishu" | "lark" => feishu_reg::scan_poll(&channel, &device_code).await,
        "weixin" => weixin_reg::scan_poll(&device_code).await,
        other => Err(format!("scan poll not supported for channel {other}")),
    }
}

#[tauri::command]
pub fn remote_im_list_instances() -> Result<Vec<ChannelInstanceDto>, String> {
    Ok(config::list_instances())
}

#[tauri::command]
pub async fn remote_im_save_instance(
    state: State<'_, std::sync::Arc<RemoteImState>>,
    body: SaveInstanceRequest,
) -> Result<ChannelInstanceDto, String> {
    let saved = config::save_instance(&body.instance, &body.secrets)?;
    if body.connect_after_save && saved.enabled && saved.has_credentials {
        let mut rt = state.inner.lock().await;
        let _ = rt.set_config(Some(true), None, None);
        let _ = rt.reload_async(&saved.channel, &saved.id).await;
    }
    Ok(saved)
}

#[tauri::command]
pub async fn remote_im_delete_instance(
    state: State<'_, std::sync::Arc<RemoteImState>>,
    instance_id: String,
) -> Result<(), String> {
    config::delete_instance(&instance_id)?;
    let mut rt = state.inner.lock().await;
    rt.drop_instance_async(&instance_id).await;
    Ok(())
}

#[tauri::command]
pub fn remote_im_doctor() -> Result<serde_json::Value, String> {
    Ok(bridge::doctor_report())
}
