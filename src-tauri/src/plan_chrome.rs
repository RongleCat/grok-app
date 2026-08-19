//! Per-app-session plan chrome persistence + agent plan_mode.json / plan.md snapshot.
//!
//! Survives App restart so Resources → Plan can re-show draft body while Grok Build
//! re-parks `exit_plan_mode` on the next `session/load`. Stored `rpcId` is never
//! treated as live after load — reverse-RPC ids die with the process.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::{find_agent_session_dir, session_dir};
use crate::store::{load_projects, load_sessions_index, load_settings};

/// Cap plan body size on disk (chars) — matches product edit limits roughly.
pub const PLAN_CHROME_BODY_MAX: usize = 200_000;
/// Cap entries array length when persisting.
pub const PLAN_CHROME_ENTRIES_MAX: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanChromeStored {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub entries: Value,
    #[serde(default)]
    pub waiting: bool,
    #[serde(default)]
    pub visible: bool,
    /// Never trustworthy after process death; cleared on load for actions.
    #[serde(default)]
    pub rpc_id: Option<u64>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub bar_dismissed: bool,
    #[serde(default)]
    pub user_closed: bool,
    #[serde(default)]
    pub closed_tool_call_id: Option<String>,
    #[serde(default)]
    pub closed_rpc_id: Option<u64>,
    /// Host killed the process while a gate was open — Approve is dead until re-park.
    #[serde(default)]
    pub gate_stale: bool,
    /// Last known agent `awaiting_plan_approval` (from plan_mode.json).
    #[serde(default)]
    pub awaiting_agent_approval: bool,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanSnapshot {
    pub found: bool,
    #[serde(default)]
    pub awaiting_plan_approval: bool,
    #[serde(default)]
    pub plan_mode_state: Option<String>,
    #[serde(default)]
    pub plan_body: Option<String>,
    #[serde(default)]
    pub plan_path: Option<String>,
    #[serde(default)]
    pub agent_session_id: Option<String>,
}

fn plan_chrome_path(session_id: &str) -> PathBuf {
    session_dir(session_id).join("plan_chrome.json")
}

fn cap_body(s: &str) -> String {
    let t = s.replace('\u{0000}', "");
    if t.len() <= PLAN_CHROME_BODY_MAX {
        return t;
    }
    let mut end = PLAN_CHROME_BODY_MAX;
    while end > 0 && !t.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &t[..end])
}

fn cap_entries(v: Value) -> Value {
    match v {
        Value::Array(mut arr) => {
            if arr.len() > PLAN_CHROME_ENTRIES_MAX {
                arr.truncate(PLAN_CHROME_ENTRIES_MAX);
            }
            Value::Array(arr)
        }
        other => other,
    }
}

/// Load persisted plan chrome for an app session (raw; may include stale rpcId).
pub fn load_plan_chrome(session_id: &str) -> Option<PlanChromeStored> {
    if session_id.trim().is_empty() {
        return None;
    }
    let path = plan_chrome_path(session_id);
    let raw = fs::read_to_string(&path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }
    serde_json::from_str(&raw).ok()
}

/// Load for UI restore: never hand out a reverse-RPC id (dies with the process).
pub fn load_plan_chrome_for_ui(session_id: &str) -> Option<PlanChromeStored> {
    let mut chrome = load_plan_chrome(session_id)?;
    if chrome.rpc_id.is_some() {
        chrome.gate_stale = true;
        chrome.rpc_id = None;
        chrome.waiting = false;
    }
    Some(chrome)
}

/// Persist plan chrome (best-effort; soft-fail for callers).
pub fn save_plan_chrome(session_id: &str, chrome: &PlanChromeStored) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("empty session id".into());
    }
    let dir = session_dir(session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut out = chrome.clone();
    out.body = cap_body(&out.body);
    out.entries = cap_entries(out.entries);
    if out.updated_at.is_empty() {
        out.updated_at = Utc::now().to_rfc3339();
    }
    let path = plan_chrome_path(session_id);
    let s = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?;
    crate::store_lock::write_bytes_atomic(&path, s.as_bytes())
}

/// Upsert from a live `session://plan` event.
pub fn upsert_from_plan_event(
    session_id: &str,
    entries: &Value,
    body: &Option<String>,
    rpc_id: Option<u64>,
    tool_call_id: &Option<String>,
) {
    if session_id.trim().is_empty() {
        return;
    }
    let mut prev = load_plan_chrome(session_id).unwrap_or_default();
    if prev.user_closed {
        // Only open a new cycle when toolCallId or rpcId changes.
        let same_rpc = rpc_id.is_some() && rpc_id == prev.closed_rpc_id;
        let same_tool = tool_call_id
            .as_ref()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .is_some_and(|t| Some(t.to_string()) == prev.closed_tool_call_id);
        if same_rpc || (tool_call_id.is_some() && same_tool && rpc_id.is_none()) {
            return;
        }
        if rpc_id.is_none()
            && tool_call_id
                .as_ref()
                .map(|t| t.trim().is_empty())
                .unwrap_or(true)
        {
            return;
        }
        prev.user_closed = false;
        prev.closed_rpc_id = None;
        prev.closed_tool_call_id = None;
    }

    let body_trim = body.as_deref().unwrap_or("").trim();
    if !body_trim.is_empty() {
        prev.body = cap_body(body_trim);
    }
    if let Value::Array(arr) = entries {
        if !arr.is_empty() {
            prev.entries = cap_entries(entries.clone());
        }
    }
    if let Some(id) = rpc_id {
        prev.rpc_id = Some(id);
        prev.gate_stale = false;
        prev.awaiting_agent_approval = true;
        prev.waiting = false;
    } else if prev.rpc_id.is_none() {
        prev.waiting = true;
    }
    if let Some(tid) = tool_call_id {
        let t = tid.trim();
        if !t.is_empty() {
            prev.tool_call_id = Some(t.to_string());
        }
    }
    prev.visible = true;
    prev.bar_dismissed = false;
    prev.updated_at = Utc::now().to_rfc3339();
    let _ = save_plan_chrome(session_id, &prev);
}

/// Mark gate stale after process death / recycle (keep body).
pub fn mark_gate_stale(session_id: &str) {
    if session_id.trim().is_empty() {
        return;
    }
    let mut prev = match load_plan_chrome(session_id) {
        Some(p) => p,
        None => return,
    };
    if prev.rpc_id.is_none() && !prev.gate_stale && !prev.awaiting_agent_approval {
        return;
    }
    prev.rpc_id = None;
    prev.gate_stale = true;
    prev.waiting = false;
    prev.updated_at = Utc::now().to_rfc3339();
    let _ = save_plan_chrome(session_id, &prev);
}

/// Clear live rpc after user decision (approve / revise / abandon).
pub fn apply_decision(session_id: &str, decision: &str, keep_body: bool) {
    if session_id.trim().is_empty() {
        return;
    }
    let mut prev = load_plan_chrome(session_id).unwrap_or_default();
    let closed = prev.rpc_id.clone();
    let d = decision.trim().to_ascii_lowercase();
    prev.rpc_id = None;
    prev.gate_stale = false;
    prev.awaiting_agent_approval = false;
    prev.waiting = false;
    if d == "abandoned" {
        prev.user_closed = true;
        prev.closed_rpc_id = closed;
        prev.closed_tool_call_id = prev.tool_call_id.clone();
        prev.visible = false;
        prev.bar_dismissed = true;
        if !keep_body {
            prev.body.clear();
            prev.entries = Value::Array(vec![]);
        }
    } else if d == "approved" {
        prev.visible = false;
        prev.bar_dismissed = true;
    } else {
        // cancelled / revise — keep body visible while agent reworks
        prev.visible = keep_body && (!prev.body.trim().is_empty() || !entries_empty(&prev.entries));
        prev.waiting = true;
    }
    prev.updated_at = Utc::now().to_rfc3339();
    let _ = save_plan_chrome(session_id, &prev);
}

fn entries_empty(v: &Value) -> bool {
    match v {
        Value::Array(a) => a.is_empty(),
        Value::Null => true,
        _ => false,
    }
}

/// Read agent-side `plan_mode.json` + `plan.md` for resume UI.
pub fn load_agent_plan_snapshot(session_id: &str) -> AgentPlanSnapshot {
    let mut out = AgentPlanSnapshot::default();
    if session_id.trim().is_empty() {
        return out;
    }
    let meta = load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id);
    let Some(meta) = meta else {
        return out;
    };
    let agent_id = match meta.agent_session_id.as_ref() {
        Some(a) if !a.is_empty() => a.clone(),
        _ => return out,
    };
    out.agent_session_id = Some(agent_id.clone());

    let settings = load_settings();
    let projects = load_projects();
    let project_path = meta.project_id.as_ref().and_then(|pid| {
        projects
            .iter()
            .find(|p| &p.id == pid)
            .map(|p| p.path.clone())
    });

    let Some(dir) = find_agent_session_dir(
        &agent_id,
        project_path.as_deref(),
        &settings.session_data_mode,
    ) else {
        return out;
    };
    out.found = true;

    let plan_path = dir.join("plan.md");
    out.plan_path = Some(plan_path.display().to_string());
    if let Ok(text) = fs::read_to_string(&plan_path) {
        let t = text.trim();
        if !t.is_empty() {
            out.plan_body = Some(cap_body(t));
        }
    }

    let mode_path = dir.join("plan_mode.json");
    if let Ok(raw) = fs::read_to_string(&mode_path) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            out.plan_mode_state = v
                .get("state")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            out.awaiting_plan_approval = v
                .get("awaiting_plan_approval")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
        }
    }

    // Soft-sync chrome flag when agent is awaiting.
    if out.awaiting_plan_approval {
        let mut chrome = load_plan_chrome(session_id).unwrap_or_default();
        if let Some(ref body) = out.plan_body {
            if chrome.body.trim().is_empty() {
                chrome.body = body.clone();
            }
        }
        chrome.awaiting_agent_approval = true;
        chrome.gate_stale = chrome.rpc_id.is_none();
        chrome.rpc_id = None;
        chrome.visible =
            !chrome.user_closed && (!chrome.body.trim().is_empty() || out.plan_body.is_some());
        chrome.waiting = false;
        chrome.updated_at = Utc::now().to_rfc3339();
        let _ = save_plan_chrome(session_id, &chrome);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // GROK_APP_HOME is process-global, so the tests that repoint it take
    // `paths::APP_HOME_ENV_LOCK`. A module-private lock only serialises
    // this file and lets it move the app home out from under any other
    // suite that is holding the real one.

    #[test]
    fn cap_body_truncates() {
        let s = "x".repeat(PLAN_CHROME_BODY_MAX + 50);
        let c = cap_body(&s);
        assert!(c.len() <= PLAN_CHROME_BODY_MAX + 3);
        assert!(c.ends_with('…'));
    }

    #[test]
    fn upsert_and_mark_stale_round_trip() {
        let _g = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-plan-chrome-test-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = fs::create_dir_all(&tmp);
        std::env::set_var("GROK_APP_HOME", &tmp);
        let sid = format!("test-plan-chrome-{}", uuid::Uuid::new_v4());
        upsert_from_plan_event(
            &sid,
            &serde_json::json!([{ "content": "step", "status": "pending" }]),
            &Some("# Plan\n1. Do it\n".into()),
            Some(42),
            &Some("tc-1".into()),
        );
        let loaded = load_plan_chrome(&sid).expect("chrome saved");
        assert_eq!(loaded.rpc_id, Some(42));
        assert!(loaded.body.contains("Plan"));
        mark_gate_stale(&sid);
        // load strips live rpc and marks stale again
        let stale = load_plan_chrome(&sid).expect("stale chrome");
        assert!(stale.rpc_id.is_none());
        assert!(stale.gate_stale);
        assert!(stale.body.contains("Plan"));
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
