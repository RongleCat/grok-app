//! Workflow run snapshots written by Grok under the CLI session directory.
//!
//! Each run is `workflows/<run_id>/state.json`. Agents carry the phase name
//! the script assigned, so a later agent joins the phase that is already there.
//! This module copies those fields and drops prompts.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::paths;
use crate::store;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPhaseDto {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAgentDto {
    pub agent_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    pub state: String,
    pub running: bool,
    /// Resolved model for this child. Absent when the sub-agent record has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Unix millis from the sub-agent `started_at`. Absent until that file exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunDto {
    pub run_id: String,
    pub name: String,
    pub status: String,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_budget: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents_used: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    pub phases: Vec<WorkflowPhaseDto>,
    pub agents: Vec<WorkflowAgentDto>,
}

fn one_line(raw: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch == '\n' || ch == '\r' {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        out.push(ch);
        if out.chars().count() >= max_chars {
            break;
        }
    }
    out.trim().to_string()
}

fn opt_u64(obj: &Value, key: &str) -> Option<u64> {
    let value = obj.get(key)?;
    if let Some(n) = value.as_u64() {
        return Some(n);
    }
    value.as_i64().filter(|n| *n >= 0).map(|n| n as u64)
}

fn non_empty(obj: &Value, key: &str) -> Option<String> {
    let text = obj.get(key)?.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn run_is_open(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "running" | "active" | "pending" | "paused" | "in_progress"
    )
}

fn agent_is_open(state: &str) -> bool {
    matches!(
        state.trim().to_ascii_lowercase().as_str(),
        "running" | "active" | "pending" | "in_progress"
    )
}

/// Parse a `state.json` body. Accepts the on-disk wrapper `{ "state": { ... } }`
/// or the inner object. Returns nothing when the run has no name.
pub fn parse_workflow_state(raw: &Value, fallback_run_id: &str) -> Option<WorkflowRunDto> {
    let inner = raw
        .get("state")
        .filter(|value| value.is_object())
        .unwrap_or(raw);
    let name = non_empty(inner, "name")?;
    let run_id = non_empty(inner, "run_id").unwrap_or_else(|| fallback_run_id.trim().to_string());
    if run_id.is_empty() {
        return None;
    }
    let status = non_empty(inner, "status").unwrap_or_default();
    let phases = inner
        .get("phases")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = non_empty(item, "title")?;
                    let detail = non_empty(item, "detail").map(|text| one_line(&text, 160));
                    Some(WorkflowPhaseDto { title, detail })
                })
                .collect()
        })
        .unwrap_or_default();
    let agents = inner
        .get("agents")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().filter_map(parse_agent).collect())
        .unwrap_or_default();
    let objective = non_empty(inner, "objective").map(|text| one_line(&text, 240));
    let elapsed_ms = opt_u64(inner, "elapsed_ms_floor").filter(|n| *n > 0);
    Some(WorkflowRunDto {
        run_id,
        name,
        running: run_is_open(&status),
        status,
        current_phase: non_empty(inner, "current_phase"),
        agent_budget: opt_u64(inner, "agent_budget"),
        agents_used: opt_u64(inner, "agents_used"),
        elapsed_ms,
        objective,
        phases,
        agents,
    })
}

fn agent_id_ok(id: &str) -> bool {
    !id.is_empty()
        && !id.contains("..")
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn json_string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let text = current.as_str()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn read_model_at(path: &Path, keys: &[&str]) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    json_string_at(&value, keys)
}

struct AgentSideMeta {
    model: Option<String>,
    started_at_ms: Option<i64>,
}

/// The workflow state has no model or start clock. The sub-agent meta does.
fn side_meta_for_agent(session_dir: &Path, agent_id: &str) -> AgentSideMeta {
    if !agent_id_ok(agent_id) {
        return AgentSideMeta {
            model: None,
            started_at_ms: None,
        };
    }
    let meta_path = session_dir
        .join("subagents")
        .join(agent_id)
        .join("meta.json");
    let from_meta = read_agent_meta(&meta_path);
    if from_meta.model.is_some() {
        return from_meta;
    }
    let Some(parent) = session_dir.parent() else {
        return from_meta;
    };
    let child = parent.join(agent_id);
    let model = read_model_at(&child.join("summary.json"), &["current_model_id"])
        .or_else(|| read_model_at(&child.join("usage.json"), &["session", "primaryModelId"]));
    AgentSideMeta {
        model,
        started_at_ms: from_meta.started_at_ms,
    }
}

fn read_agent_meta(path: &Path) -> AgentSideMeta {
    let Some(text) = fs::read_to_string(path).ok() else {
        return AgentSideMeta {
            model: None,
            started_at_ms: None,
        };
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return AgentSideMeta {
            model: None,
            started_at_ms: None,
        };
    };
    AgentSideMeta {
        model: json_string_at(&value, &["effective_model_id"]),
        started_at_ms: json_string_at(&value, &["started_at"])
            .and_then(|text| parse_unix_ms(&text)),
    }
}

/// RFC3339, including the nanosecond form Grok writes (`...18.353802560Z`).
fn parse_unix_ms(raw: &str) -> Option<i64> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    if let Some(ms) = rfc3339_ms(text) {
        return Some(ms);
    }
    let shortened = shorten_fraction_to_millis(text);
    if shortened != text {
        return rfc3339_ms(&shortened);
    }
    None
}

fn rfc3339_ms(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn shorten_fraction_to_millis(text: &str) -> String {
    let Some(dot) = text.find('.') else {
        return text.to_string();
    };
    let digits = text[dot + 1..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .count();
    if digits <= 3 {
        return text.to_string();
    }
    let mut out = String::new();
    out.push_str(&text[..=dot]);
    out.push_str(&text[dot + 1..dot + 1 + 3]);
    out.push_str(&text[dot + 1 + digits..]);
    out
}

fn attach_agent_meta(session_dir: &Path, agents: &mut [WorkflowAgentDto]) {
    for agent in agents.iter_mut() {
        let side = side_meta_for_agent(session_dir, &agent.agent_id);
        if agent.model.is_none() {
            agent.model = side.model;
        }
        if agent.started_at_ms.is_none() {
            agent.started_at_ms = side.started_at_ms;
        }
    }
}

fn parse_agent(item: &Value) -> Option<WorkflowAgentDto> {
    let agent_id = non_empty(item, "agent_id")?;
    let state = non_empty(item, "state").unwrap_or_default();
    let label = non_empty(item, "label").unwrap_or_else(|| agent_id.clone());
    Some(WorkflowAgentDto {
        agent_id,
        label,
        phase: non_empty(item, "phase"),
        running: agent_is_open(&state),
        state,
        model: non_empty(item, "model")
            .or_else(|| non_empty(item, "model_id"))
            .or_else(|| non_empty(item, "effective_model_id")),
        tokens_used: opt_u64(item, "tokens_used").filter(|n| *n > 0),
        duration_ms: opt_u64(item, "duration_ms").filter(|n| *n > 0),
        started_at_ms: None,
    })
}

pub fn read_runs_in_session_dir(dir: &Path) -> Vec<WorkflowRunDto> {
    let workflows = dir.join("workflows");
    let Ok(entries) = fs::read_dir(&workflows) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        let Ok(text) = fs::read_to_string(path.join("state.json")) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if let Some(mut run) = parse_workflow_state(&value, folder) {
            attach_agent_meta(dir, &mut run.agents);
            out.push(run);
        }
    }
    out.sort_by(|a, b| {
        b.running
            .cmp(&a.running)
            .then(b.elapsed_ms.unwrap_or(0).cmp(&a.elapsed_ms.unwrap_or(0)))
            .then(a.name.cmp(&b.name))
    });
    out
}

fn agent_dir_for_app_session(session_id: &str) -> Option<std::path::PathBuf> {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|session| session.id == session_id)?;
    let agent_id = meta
        .agent_session_id
        .as_deref()
        .filter(|id| !id.is_empty())?;
    let mode = store::load_settings().session_data_mode;
    let cwd_hint = meta.project_id.as_deref().and_then(|project_id| {
        store::load_projects()
            .into_iter()
            .find(|project| project.id == project_id)
            .map(|project| project.path)
    });
    let worktree = meta
        .worktree_path
        .as_deref()
        .filter(|path| !path.is_empty());
    paths::find_agent_session_dir(agent_id, worktree.or(cwd_hint.as_deref()), &mode)
}

/// Runs for the CLI session bound to this App chat. Missing sessions are empty.
pub fn runs_for_app_session(session_id: &str) -> Vec<WorkflowRunDto> {
    let Some(dir) = agent_dir_for_app_session(session_id.trim()) else {
        return Vec::new();
    };
    read_runs_in_session_dir(&dir)
}

#[tauri::command]
pub fn workflow_runs_for_session(session_id: String) -> Vec<WorkflowRunDto> {
    runs_for_app_session(&session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        serde_json::json!({
            "version": 1,
            "state": {
                "run_id": "wf_abc",
                "name": "review-changes-2",
                "status": "running",
                "current_phase": "Review",
                "agent_budget": 8,
                "agents_used": 2,
                "elapsed_ms_floor": 1500,
                "objective": "Check the contract\nand stop",
                "phases": [
                    { "title": "Implement", "detail": null },
                    { "title": "Review", "detail": "second pass" }
                ],
                "agents": [
                    {
                        "agent_id": "agent-1",
                        "label": "impl:L1",
                        "phase": "Implement",
                        "state": "completed",
                        "tokens_used": 120,
                        "duration_ms": 4000
                    },
                    {
                        "agent_id": "agent-2",
                        "label": "review:late",
                        "phase": "Review",
                        "state": "running",
                        "tokens_used": 0,
                        "duration_ms": 0
                    }
                ]
            }
        })
    }

    #[test]
    fn parse_groups_a_later_agent_by_phase_name() {
        let run = parse_workflow_state(&sample(), "folder").expect("run");
        assert_eq!(run.run_id, "wf_abc");
        assert_eq!(run.name, "review-changes-2");
        assert!(run.running);
        assert_eq!(run.current_phase.as_deref(), Some("Review"));
        assert_eq!(run.agent_budget, Some(8));
        assert_eq!(run.agents_used, Some(2));
        assert_eq!(run.elapsed_ms, Some(1500));
        assert_eq!(
            run.objective.as_deref(),
            Some("Check the contract and stop")
        );
        assert_eq!(run.phases.len(), 2);
        assert_eq!(run.agents[0].phase.as_deref(), Some("Implement"));
        assert_eq!(run.agents[0].tokens_used, Some(120));
        assert!(!run.agents[0].running);
        assert_eq!(run.agents[1].phase.as_deref(), Some("Review"));
        assert_eq!(run.agents[1].tokens_used, None);
        assert!(run.agents[1].running);
        assert!(!run.agents[1].label.contains("prompt"));
    }

    #[test]
    fn parse_skips_a_nameless_run_and_an_agent_without_id() {
        let raw = serde_json::json!({
            "state": {
                "status": "running",
                "agents": [{ "label": "orphan", "phase": "Review" }]
            }
        });
        assert!(parse_workflow_state(&raw, "wf_x").is_none());
    }

    #[test]
    fn read_runs_from_a_session_directory() {
        let root = std::env::temp_dir().join(format!("grok-workflow-runs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let run_dir = root.join("workflows").join("wf_disk");
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(
            run_dir.join("state.json"),
            serde_json::to_string(&sample()).unwrap(),
        )
        .unwrap();
        let meta_dir = root.join("subagents").join("agent-1");
        fs::create_dir_all(&meta_dir).unwrap();
        fs::write(
            meta_dir.join("meta.json"),
            r#"{"effective_model_id":"grok-4.7","started_at":"2026-10-16T20:59:18.353802560Z","prompt":"do not leak this prompt"}"#,
        )
        .unwrap();
        let runs = read_runs_in_session_dir(&root);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].name, "review-changes-2");
        assert_eq!(runs[0].agents[0].model.as_deref(), Some("grok-4.7"));
        assert_eq!(runs[0].agents[0].started_at_ms, Some(1_792_184_358_353));
        assert_eq!(runs[0].agents[1].model, None);
        assert_eq!(runs[0].agents[1].started_at_ms, None);
        let encoded = serde_json::to_string(&runs[0]).unwrap();
        assert!(!encoded.contains("do not leak"));
        let _ = fs::remove_dir_all(&root);
    }
}
