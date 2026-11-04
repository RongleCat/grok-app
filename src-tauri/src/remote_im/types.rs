//! Shared types for the in-process Remote IM runtime.

use crate::attachments::AttachmentKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct ChannelInstance {
    pub id: String,
    pub channel: String,
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub enabled: bool,
    pub secrets: HashMap<String, String>,
    pub options: Value,
    pub acl: Value,
    pub project_scope: Value,
}

#[derive(Debug, Clone)]
pub struct StagedRemoteAttachment {
    pub name: String,
    pub kind: AttachmentKind,
    pub temp_path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

/// Removes uncommitted staging files on every early return (ACL, rate limit,
/// cancellation, budget rejection).
pub struct StagedGuard {
    staged: Vec<StagedRemoteAttachment>,
    armed: bool,
}

impl StagedGuard {
    pub fn new(staged: Vec<StagedRemoteAttachment>) -> Self {
        Self {
            staged,
            armed: true,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.staged.is_empty()
    }

    pub fn as_slice(&self) -> &[StagedRemoteAttachment] {
        &self.staged
    }

    /// Remove any temp files still present and stop tracking.
    pub fn finish(&mut self) {
        for item in &self.staged {
            let _ = std::fs::remove_file(&item.temp_path);
        }
        self.staged.clear();
        self.armed = false;
    }
}

impl Drop for StagedGuard {
    fn drop(&mut self) {
        if self.armed {
            for item in &self.staged {
                let _ = std::fs::remove_file(&item.temp_path);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct IncomingMessage {
    pub channel: String,
    pub instance_id: String,
    pub message_id: String,
    pub chat_id: String,
    pub chat_type: String, // p2p | group
    pub sender_id: String,
    pub content: String,
    pub mentioned_bot: bool,
    /// Telegram forum / private-topic thread (`message_thread_id`).
    pub thread_id: Option<String>,
    /// Media downloaded to store staging; the engine commits it after resolving
    /// the App session and checking the 512 MB session budget.
    pub staged_attachments: Vec<StagedRemoteAttachment>,
    /// Agent-facing note about attachment failures/truncation. Never written to
    /// the journal as user content.
    pub attachment_note: Option<String>,
}

impl IncomingMessage {
    pub fn thread_id(&self) -> Option<&str> {
        self.thread_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedChannel {
    pub channel: String,
    pub instance_id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionRecord {
    pub session_id: String,
    pub work_dir: String,
    pub agent_session_id: Option<String>,
    pub turn_count: u32,
}

impl SessionRecord {
    #[allow(dead_code)]
    pub fn new(work_dir: &str) -> Self {
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            work_dir: work_dir.to_string(),
            agent_session_id: None,
            turn_count: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TrustedProject {
    pub id: String,
    pub name: String,
    pub path: String,
}
