//! Per-scope IM session binding (project + agent session id), disk-persisted.

use super::control_plane::{binding_after_app_session_move, ScopeBinding};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

static LIVE: Mutex<Option<SessionStore>> = Mutex::new(None);

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
        Self::open(Self::default_path())
    }

    fn default_path() -> PathBuf {
        crate::paths::app_data_root()
            .join("remote")
            .join("scope-bindings.json")
    }

    /// Point subsequent [`Self::retarget_shared`] calls at this in-memory map
    /// (the live Remote IM engine). Tests that use [`Self::ephemeral`] should
    /// not register.
    pub fn register_live(&self) {
        *LIVE.lock() = Some(self.clone());
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
    #[allow(dead_code)]
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

    #[allow(dead_code)]
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

    /// Rewrite every IM scope that is already bound to this App chat so the
    /// next remote turn uses the new project cwd and does not `session/load`
    /// the previous agent id.
    pub fn retarget_app_session(
        &self,
        session_id: &str,
        project_id: Option<String>,
        work_dir: &str,
    ) -> usize {
        let mut n = 0usize;
        {
            let mut g = self.inner.lock();
            for rec in g.values_mut() {
                if let Some(next) =
                    binding_after_app_session_move(rec, session_id, project_id.clone(), work_dir)
                {
                    *rec = next;
                    n += 1;
                }
            }
        }
        if n > 0 {
            self.save_disk();
        }
        n
    }

    /// Prefer the live engine store so in-memory IM bindings stay in sync;
    /// fall back to a disk load when the bridge is not running.
    pub fn retarget_shared(session_id: &str, project_id: Option<String>, work_dir: &str) -> usize {
        if let Some(store) = LIVE.lock().clone() {
            return store.retarget_app_session(session_id, project_id, work_dir);
        }
        Self::open(Self::default_path()).retarget_app_session(session_id, project_id, work_dir)
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
    fn retarget_app_session_updates_only_matching_rows() {
        use crate::remote_im::control_plane::PendingMode;
        let store = SessionStore::ephemeral();
        let mut hit = ScopeBinding::fresh("/old");
        hit.local_session_id = "s1".into();
        hit.project_id = Some("p0".into());
        hit.agent_session_id = Some("ag".into());
        hit.pending_mode = PendingMode::Continue;
        store.set("k1", hit);
        let other = ScopeBinding::fresh("/keep");
        store.set("k2", other);

        let n = store.retarget_app_session("s1", Some("p1".into()), "/new");
        assert_eq!(n, 1);
        let updated = store.get("k1").expect("k1");
        assert_eq!(updated.project_id.as_deref(), Some("p1"));
        assert_eq!(updated.work_dir, "/new");
        assert!(updated.agent_session_id.is_none());
        assert_eq!(updated.pending_mode, PendingMode::New);
        assert_eq!(store.get("k2").expect("k2").work_dir, "/keep");
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
