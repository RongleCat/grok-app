//! Durable exclusions for abandoned rewind branches. Only digests are stored;
//! the CLI history remains untouched and live streaming is never filtered.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::*;

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct RewindFence {
    blocked: HashSet<String>,
    #[serde(default)]
    blocked_prompts: HashSet<String>,
    block_all: bool,
}

impl RewindFence {
    fn path(session_id: &str) -> PathBuf {
        crate::paths::session_dir(session_id).join("rewind_reconcile_fence.json")
    }

    pub(super) fn load(session_id: &str) -> Self {
        match fs::read(Self::path(session_id)) {
            Ok(raw) => serde_json::from_slice(&raw).unwrap_or(Self {
                block_all: true,
                ..Self::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(_) => Self {
                block_all: true,
                ..Self::default()
            },
        }
    }

    fn digest(role: &str, content: &str, tool_id: Option<&str>) -> String {
        // JSON preserves field boundaries; timestamps/rewritten log envelopes
        // do not change the identity of discarded assistant/tool content.
        let row = serde_json::to_vec(&(role, content.trim(), tool_id)).expect("serialize tuple");
        format!("{:x}", Sha256::digest(row))
    }

    pub(super) fn blocks(&self, role: &str, content: &str, tool_id: Option<&str>) -> bool {
        self.block_all || self.blocked.contains(&Self::digest(role, content, tool_id))
    }

    pub(super) fn blocks_prompt(&self, content: &str) -> bool {
        self.block_all
            || self
                .blocked_prompts
                .contains(&Self::digest("user", &user_body_key(content), None))
    }

    /// Capture before asking the CLI to rewind, since that RPC may rewrite its
    /// disk log. Failed RPCs never commit this pending fence.
    pub(crate) fn capture(session_id: &str, kept_prompts: u32) -> Self {
        let mut fence = Self::default();
        let Some(meta) = store::load_sessions_index()
            .into_iter()
            .find(|s| s.id == session_id)
        else {
            fence.block_all = true;
            return fence;
        };
        let Some(agent_id) = meta.agent_session_id else {
            return fence;
        };
        let mode = store::load_settings().session_data_mode;
        let cwd = meta.project_id.as_deref().and_then(|id| {
            store::load_projects()
                .into_iter()
                .find(|p| p.id == id)
                .map(|p| p.path)
        });
        let rows = crate::paths::find_agent_session_dir(&agent_id, cwd.as_deref(), &mode)
            .ok_or_else(|| "missing linked history".to_string())
            .and_then(|dir| {
                let path = dir.join("chat_history.jsonl");
                let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                if raw
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .any(|line| serde_json::from_str::<Value>(line).is_err())
                {
                    return Err("incomplete linked history".into());
                }
                parse_chat_history_rows(&path)
            });
        let Ok(rows) = rows else {
            // We cannot establish which rows were discarded. Keep live output,
            // but do not guess which disk answers belong to the new branch.
            fence.block_all = true;
            return fence;
        };
        let mut users = 0u32;
        for (role, body, tool_id) in rows {
            if role == "user" {
                users = users.saturating_add(1);
                if users > kept_prompts {
                    fence
                        .blocked_prompts
                        .insert(Self::digest("user", &user_body_key(&body), None));
                }
            } else if users > kept_prompts {
                fence
                    .blocked
                    .insert(Self::digest(&role, &body, tool_id.as_deref()));
            }
        }
        // A late/incomplete flush cannot establish all discarded rows.
        if users < store::user_prompt_count(&store::load_messages(session_id)) {
            fence.block_all = true;
            fence.blocked.clear();
        }
        fence
    }

    /// The journal lock covers the latest fence read, union, durable write,
    /// and truncate. Reconcile acquires this same lock before loading a fence.
    pub(crate) fn replace_journal(
        self,
        session_id: &str,
        kept: &[ChatMessageStored],
    ) -> Result<(), String> {
        let journal_path = crate::paths::session_dir(session_id).join("messages.json");
        crate::store_lock::with_exclusive_lock(&journal_path, || {
            let mut fence = Self::load(session_id);
            fence.blocked.extend(self.blocked);
            fence.blocked_prompts.extend(self.blocked_prompts);
            fence.block_all |= self.block_all;
            if fence.blocked.len() + fence.blocked_prompts.len() > 4096 {
                fence.block_all = true;
            }
            if fence.block_all {
                fence.blocked.clear();
                fence.blocked_prompts.clear();
            }
            let encoded = serde_json::to_vec(&fence).map_err(|e| e.to_string())?;
            let messages = serde_json::to_vec(kept).map_err(|e| e.to_string())?;
            // A fence write failure leaves the old journal untouched. If the
            // journal write fails afterwards the extra exclusions are safe.
            crate::store_lock::write_bytes_replace(&Self::path(session_id), &encoded)?;
            crate::store_lock::write_bytes_replace(&journal_path, &messages)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconcile_fence_write_failure_keeps_journal_intact() {
        let _guard = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!("grok-rewind-fence-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("GROK_APP_HOME", &home);
        crate::paths::ensure_app_dirs().unwrap();
        let session = store::create_session(None, None, false).unwrap();
        let row = ChatMessageStored {
            id: "keep".into(),
            role: "user".into(),
            content: "keep me".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        };
        store::replace_messages(&session.id, &[row]).unwrap();
        fs::create_dir(RewindFence::path(&session.id)).unwrap();
        assert!(RewindFence::default()
            .replace_journal(&session.id, &[])
            .is_err());
        assert_eq!(store::load_messages(&session.id)[0].content, "keep me");
        std::env::remove_var("GROK_APP_HOME");
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn reconcile_corrupt_fence_blocks_disk_rows_after_reload() {
        let _guard = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!("grok-rewind-fence-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("GROK_APP_HOME", &home);
        crate::paths::ensure_app_dirs().unwrap();
        let session = store::create_session(None, None, false).unwrap();
        fs::write(RewindFence::path(&session.id), "corrupt").unwrap();
        let loaded = RewindFence::load(&session.id);
        assert!(loaded.blocks("assistant", "old answer", None));
        assert!(loaded.blocks("tool", "old output", Some("old-tool")));
        assert!(loaded.blocks_prompt("same prompt"));
        std::env::remove_var("GROK_APP_HOME");
        fs::remove_dir_all(&home).unwrap();
    }
}
