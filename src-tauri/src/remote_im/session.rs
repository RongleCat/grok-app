//! Per-scope IM session binding (project + agent session id), disk-persisted.

#![allow(dead_code)] // residual-clippy: ephemeral/reset session API
use super::control_plane::ScopeBinding;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct SessionStore {
    inner: Arc<Mutex<HashMap<String, ScopeBinding>>>,
    path: PathBuf,
}

#[derive(Serialize, Deserialize, Default)]
struct DiskFile {
    scopes: HashMap<String, ScopeBinding>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::open_default()
    }
}

impl SessionStore {
    pub fn open_default() -> Self {
        let path = crate::paths::app_data_root()
            .join("remote")
            .join("scope-bindings.json");
        Self::open(path)
    }

    pub fn open(path: PathBuf) -> Self {
        let store = Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            path,
        };
        store.load_disk();
        store
    }

    /// In-memory only (tests).
    pub fn ephemeral() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            path: PathBuf::from("/dev/null"),
        }
    }

    pub fn scope_key(channel: &str, instance_id: &str, chat_id: &str, sender_id: &str) -> String {
        format!("{channel}:{instance_id}:{chat_id}:{sender_id}")
    }

    /// Same as [`scope_key`], but when `isolate_thread` the Telegram / forum
    /// topic id is folded into the chat segment so each topic is its own binding.
    pub fn scope_key_for(msg: &super::types::IncomingMessage, isolate_thread: bool) -> String {
        let chat_id = match (isolate_thread, msg.thread_id()) {
            (true, Some(tid)) => format!("{}#t{tid}", msg.chat_id),
            _ => msg.chat_id.clone(),
        };
        Self::scope_key(&msg.channel, &msg.instance_id, &chat_id, &msg.sender_id)
    }

    fn load_disk(&self) {
        if !self.path.is_file() {
            return;
        }
        if let Ok(raw) = fs::read_to_string(&self.path) {
            if let Ok(f) = serde_json::from_str::<DiskFile>(&raw) {
                *self.inner.lock() = f.scopes;
            }
        }
    }

    fn save_disk(&self) {
        if self.path.as_os_str() == "/dev/null" {
            return;
        }
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let f = DiskFile {
            scopes: self.inner.lock().clone(),
        };
        if let Ok(raw) = serde_json::to_string_pretty(&f) {
            let _ = fs::write(&self.path, raw);
        }
    }

    pub fn get_or_create(&self, key: &str, work_dir: &str) -> ScopeBinding {
        let mut g = self.inner.lock();
        g.entry(key.to_string())
            .or_insert_with(|| ScopeBinding::fresh(work_dir))
            .clone()
    }

    pub fn get(&self, key: &str) -> Option<ScopeBinding> {
        self.inner.lock().get(key).cloned()
    }

    pub fn set(&self, key: &str, rec: ScopeBinding) {
        self.inner.lock().insert(key.to_string(), rec);
        self.save_disk();
    }

    pub fn reset(&self, key: &str, work_dir: &str) -> ScopeBinding {
        let rec = ScopeBinding::fresh(work_dir);
        self.inner.lock().insert(key.to_string(), rec.clone());
        self.save_disk();
        rec
    }

    /// Drop a persisted binding (scope narrowed or no longer valid).
    pub fn remove(&self, key: &str) {
        self.inner.lock().remove(key);
        self.save_disk();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_im::types::IncomingMessage;

    fn msg(thread_id: Option<&str>) -> IncomingMessage {
        IncomingMessage {
            channel: "telegram".into(),
            instance_id: "bot".into(),
            message_id: "1".into(),
            chat_id: "42".into(),
            chat_type: "p2p".into(),
            sender_id: "7".into(),
            content: "hi".into(),
            mentioned_bot: true,
            thread_id: thread_id.map(str::to_string),
        }
    }

    #[test]
    fn scope_ignores_topic_unless_isolation_on() {
        let m = msg(Some("77"));
        assert_eq!(SessionStore::scope_key_for(&m, false), "telegram:bot:42:7");
        assert_eq!(
            SessionStore::scope_key_for(&m, true),
            "telegram:bot:42#t77:7"
        );
        assert_eq!(
            SessionStore::scope_key_for(&msg(None), true),
            "telegram:bot:42:7"
        );
    }
}
