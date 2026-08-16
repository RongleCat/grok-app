//! Shared types for the in-process Remote IM runtime.

#![allow(dead_code)] // residual-clippy: DTO fields for protocol completeness
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct ChannelInstance {
    pub id: String,
    pub channel: String,
    pub name: String,
    pub enabled: bool,
    pub secrets: HashMap<String, String>,
    pub options: Value,
    pub acl: Value,
    pub project_scope: Value,
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
pub struct SessionRecord {
    pub session_id: String,
    pub work_dir: String,
    pub agent_session_id: Option<String>,
    pub turn_count: u32,
}

impl SessionRecord {
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
