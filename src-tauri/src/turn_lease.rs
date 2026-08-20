//! On-disk lease for an in-flight App turn.
//!
//! Survives host process death so the next boot can mark the chat interrupted
//! instead of looking idle-complete.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const SCHEMA: u32 = 1;
pub const COMMAND_MAX_CHARS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LeaseStatus {
    Active,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingTool {
    pub tool_call_id: String,
    pub tool_name: String,
    pub title: String,
    pub command: String,
}

impl PendingTool {
    pub fn truncated(mut self) -> Self {
        self.command = truncate_chars(&self.command, COMMAND_MAX_CHARS);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnLease {
    pub schema: u32,
    pub status: LeaseStatus,
    pub session_id: String,
    pub agent_session_id: Option<String>,
    pub turn_id: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub phase: String,
    pub permission_pending: bool,
    pub pending_tool: Option<PendingTool>,
}

pub fn lease_path(session_id: &str) -> PathBuf {
    crate::paths::session_dir(session_id).join("turn_lease.json")
}

pub fn write_lease(lease: &TurnLease) -> std::io::Result<()> {
    let path = lease_path(&lease.session_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut body = lease.clone();
    if let Some(tool) = body.pending_tool.take() {
        body.pending_tool = Some(tool.truncated());
    }
    let json = serde_json::to_vec_pretty(&body)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&json)?;
        f.flush()?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn read_lease(session_id: &str) -> Option<TurnLease> {
    let raw = fs::read_to_string(lease_path(session_id)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn clear_lease(session_id: &str) {
    let path = lease_path(session_id);
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("json.tmp"));
}

pub fn mark_interrupted(session_id: &str) -> Option<TurnLease> {
    let mut lease = read_lease(session_id)?;
    lease.status = LeaseStatus::Interrupted;
    lease.updated_at = now_rfc3339();
    if let Err(e) = write_lease(&lease) {
        tracing::warn!(session = %session_id, "turn lease mark_interrupted failed: {e}");
        return Some(lease);
    }
    Some(lease)
}

/// Fresh active lease for a newly dispatched prompt (drops leftover pending).
pub fn begin_active(session_id: &str, agent_session_id: Option<&str>, turn_id: Option<&str>) {
    let now = now_rfc3339();
    let lease = TurnLease {
        schema: SCHEMA,
        status: LeaseStatus::Active,
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.map(str::to_string),
        turn_id: turn_id.map(str::to_string),
        started_at: now.clone(),
        updated_at: now,
        phase: "streaming".into(),
        permission_pending: false,
        pending_tool: None,
    };
    if let Err(e) = write_lease(&lease) {
        tracing::warn!(session = %session_id, "turn lease begin failed: {e}");
    }
}

/// Patch the live lease (permission / tool). Creates an active lease if missing.
pub fn update_active(
    session_id: &str,
    phase: &str,
    permission_pending: bool,
    pending_tool: Option<PendingTool>,
) {
    let now = now_rfc3339();
    let existing = read_lease(session_id);
    let lease = TurnLease {
        schema: SCHEMA,
        status: LeaseStatus::Active,
        session_id: session_id.to_string(),
        agent_session_id: existing.as_ref().and_then(|e| e.agent_session_id.clone()),
        turn_id: existing.as_ref().and_then(|e| e.turn_id.clone()),
        started_at: existing
            .as_ref()
            .map(|e| e.started_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
        phase: phase.to_string(),
        permission_pending,
        pending_tool: pending_tool.or_else(|| existing.and_then(|e| e.pending_tool)),
    };
    if let Err(e) = write_lease(&lease) {
        tracing::warn!(session = %session_id, "turn lease update failed: {e}");
    }
}

pub fn list_active_lease_session_ids() -> Vec<String> {
    let root = crate::paths::app_data_root().join("sessions");
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if matches!(
            read_lease(id).as_ref().map(|l| &l.status),
            Some(LeaseStatus::Active)
        ) {
            out.push(id.to_string());
        }
    }
    out
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn with_home<T>(f: impl FnOnce(&PathBuf) -> T) -> T {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-turn-lease-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = crate::paths::ensure_app_dirs();
        let out = f(&tmp);
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
        out
    }

    fn sample(session_id: &str) -> TurnLease {
        TurnLease {
            schema: SCHEMA,
            status: LeaseStatus::Active,
            session_id: session_id.into(),
            agent_session_id: Some("agent-1".into()),
            turn_id: Some("turn-1".into()),
            started_at: "2026-08-19T03:44:28Z".into(),
            updated_at: "2026-08-19T03:45:47Z".into(),
            phase: "permission_prompt".into(),
            permission_pending: true,
            pending_tool: Some(PendingTool {
                tool_call_id: "call-9e5f0e0d".into(),
                tool_name: "run_terminal_command".into(),
                title: "List commits to merge into hzh/dev".into(),
                command: "git rev-parse master origin/master HEAD".into(),
            }),
        }
    }

    #[test]
    fn write_and_read_active_lease_roundtrip() {
        with_home(|_| {
            let sid = "sess-roundtrip";
            write_lease(&sample(sid)).unwrap();
            let got = read_lease(sid).expect("lease");
            assert_eq!(got.status, LeaseStatus::Active);
            assert_eq!(got.session_id, sid);
            assert_eq!(
                got.pending_tool.as_ref().map(|t| t.command.as_str()),
                Some("git rev-parse master origin/master HEAD")
            );
            assert!(got.permission_pending);
        });
    }

    #[test]
    fn mark_interrupted_preserves_pending_tool() {
        with_home(|_| {
            let sid = "sess-interrupt";
            write_lease(&sample(sid)).unwrap();
            let got = mark_interrupted(sid).expect("marked");
            assert_eq!(got.status, LeaseStatus::Interrupted);
            assert_eq!(got.pending_tool.unwrap().tool_call_id, "call-9e5f0e0d");
            assert_eq!(read_lease(sid).unwrap().status, LeaseStatus::Interrupted);
        });
    }

    #[test]
    fn clear_removes_file() {
        with_home(|_| {
            let sid = "sess-clear";
            write_lease(&sample(sid)).unwrap();
            assert!(lease_path(sid).is_file());
            clear_lease(sid);
            assert!(!lease_path(sid).is_file());
            assert!(read_lease(sid).is_none());
        });
    }

    #[test]
    fn missing_file_is_none() {
        with_home(|_| {
            assert!(read_lease("does-not-exist").is_none());
        });
    }

    #[test]
    fn list_active_skips_interrupted() {
        with_home(|_| {
            write_lease(&sample("a1")).unwrap();
            write_lease(&sample("a2")).unwrap();
            mark_interrupted("a2");
            let mut ids = list_active_lease_session_ids();
            ids.sort();
            assert_eq!(ids, vec!["a1".to_string()]);
        });
    }

    #[test]
    fn begin_active_drops_old_pending() {
        with_home(|_| {
            write_lease(&sample("a3")).unwrap();
            begin_active("a3", Some("agent-2"), Some("turn-2"));
            let got = read_lease("a3").unwrap();
            assert_eq!(got.status, LeaseStatus::Active);
            assert!(got.pending_tool.is_none());
            assert_eq!(got.agent_session_id.as_deref(), Some("agent-2"));
        });
    }
}
