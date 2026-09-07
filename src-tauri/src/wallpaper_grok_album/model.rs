use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GrokAlbumStatus {
    Closed,
    Loading,
    Verification,
    SignIn,
    Ready,
    OtherPage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokAlbumMedia {
    pub media_url: String,
    pub thumbnail_url: Option<String>,
    pub kind: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: Option<String>,
    pub post_id: Option<String>,
    #[serde(skip_serializing)]
    pub(super) webview_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokAlbumSnapshot {
    pub status: GrokAlbumStatus,
    pub items: Vec<GrokAlbumMedia>,
    pub total: usize,
    pub can_load_more: bool,
    pub new_items: usize,
    pub prefetch_skipped: bool,
    pub page_changed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokAlbumThumbnail {
    pub(super) data_url: String,
    pub(super) width: u32,
    pub(super) height: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawAlbumSnapshot {
    #[serde(default)]
    pub(super) ready_state: String,
    #[serde(default)]
    pub(super) has_app_shell: bool,
    #[serde(default)]
    pub(super) has_security_challenge: bool,
    #[serde(default)]
    pub(super) recovery_state: String,
    #[serde(default)]
    pub(super) items: Vec<RawAlbumMedia>,
    #[serde(default)]
    pub(super) page_epoch: u64,
    #[serde(default)]
    pub(super) scroll_top: f64,
    #[serde(default)]
    pub(super) scroll_height: f64,
    #[serde(default)]
    pub(super) viewport_height: f64,
    #[serde(default)]
    pub(super) at_bottom: bool,
    #[serde(default)]
    pub(super) bridge_error: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawAlbumMedia {
    #[serde(default)]
    pub(super) media_url: String,
    #[serde(default)]
    pub(super) thumbnail_url: Option<String>,
    #[serde(default)]
    pub(super) kind: String,
    #[serde(default)]
    pub(super) width: Option<u32>,
    #[serde(default)]
    pub(super) height: Option<u32>,
    #[serde(default)]
    pub(super) created_at: Option<String>,
    #[serde(default)]
    pub(super) post_id: Option<String>,
    #[serde(default)]
    pub(super) webview_only: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawAlbumThumbnailJob {
    #[serde(default)]
    pub(super) state: String,
    #[serde(default)]
    pub(super) data_url: String,
    #[serde(default)]
    pub(super) width: u32,
    #[serde(default)]
    pub(super) height: u32,
}
