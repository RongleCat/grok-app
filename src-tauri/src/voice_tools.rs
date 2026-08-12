//! Host tools exposed to the live voice model for agent delegation.
//! Pure definitions + argument parsing (testable without network).

#![allow(dead_code)] // residual-clippy: normalize_tool_status
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Tool schema sent to the realtime session (OpenAI-compatible function tools).
pub fn tool_definitions() -> Vec<Value> {
    vec![
        function_tool(
            "list_sessions",
            "List recent Grok Build agent sessions for the current project (id, title, busy).",
            json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                }
            }),
        ),
        function_tool(
            "create_agent_session",
            "Create a new Grok Build agent session in the active project to do coding work. Prefer this for multi-step implementation tasks.",
            json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short session title" },
                    "prompt": {
                        "type": "string",
                        "description": "First instruction for the coding agent"
                    }
                },
                "required": ["prompt"]
            }),
        ),
        function_tool(
            "prompt_agent",
            "Send a follow-up instruction to an existing agent session (or the current live session if session_id is omitted).",
            json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string" },
                    "prompt": { "type": "string" }
                },
                "required": ["prompt"]
            }),
        ),
        function_tool(
            "get_agent_status",
            "Get status of an agent session: state, last activity, whether a permission or plan is waiting.",
            json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string" }
                }
            }),
        ),
        function_tool(
            "cancel_agent",
            "Cancel the in-flight turn on an agent session.",
            json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string" }
                }
            }),
        ),
    ]
}

fn function_tool(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "name": name,
        "description": description,
        "parameters": parameters
    })
}

/// System / session instructions for the voice model.
pub fn live_voice_instructions(project_path: Option<&str>, project_name: Option<&str>) -> String {
    let project = project_name
        .or(project_path)
        .unwrap_or("the current workspace");
    format!(
        r#"You are Grok Live Voice in the Grok desktop coding workbench.
You speak briefly and clearly. You can listen and talk while coding agents work.

Project: {project}
{path_line}

Rules:
- You do NOT edit files yourself. For any implementation, debugging, tests, git, or multi-step work, call host tools: create_agent_session, prompt_agent, get_agent_status, cancel_agent, list_sessions.
- After starting work, keep the user updated in plain language. Offer to check status.
- Never invent tool results. Use tool returns only.
- Respect that the app shows permission prompts; if work is blocked on approval, tell the user to allow or deny in the UI.
- Prefer short spoken answers (1–3 sentences) unless the user asks for detail.
"#,
        path_line = project_path
            .map(|p| format!("Path: {p}"))
            .unwrap_or_default(),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceToolName {
    ListSessions,
    CreateAgentSession,
    PromptAgent,
    GetAgentStatus,
    CancelAgent,
}

impl VoiceToolName {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "list_sessions" => Some(Self::ListSessions),
            "create_agent_session" => Some(Self::CreateAgentSession),
            "prompt_agent" => Some(Self::PromptAgent),
            "get_agent_status" => Some(Self::GetAgentStatus),
            "cancel_agent" => Some(Self::CancelAgent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CreateAgentArgs {
    pub title: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PromptAgentArgs {
    pub session_id: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SessionRefArgs {
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ListSessionsArgs {
    pub limit: Option<u32>,
}

pub fn parse_create_agent_args(raw: &str) -> Result<CreateAgentArgs, String> {
    let v: Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw })
        .map_err(|e| format!("invalid create_agent_session args: {e}"))?;
    let prompt = v
        .get("prompt")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if prompt.is_empty() {
        return Err("create_agent_session requires prompt".into());
    }
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(CreateAgentArgs { title, prompt })
}

pub fn parse_prompt_agent_args(raw: &str) -> Result<PromptAgentArgs, String> {
    let v: Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw })
        .map_err(|e| format!("invalid prompt_agent args: {e}"))?;
    let prompt = v
        .get("prompt")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if prompt.is_empty() {
        return Err("prompt_agent requires prompt".into());
    }
    let session_id = v
        .get("session_id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(PromptAgentArgs { session_id, prompt })
}

pub fn parse_session_ref_args(raw: &str) -> Result<SessionRefArgs, String> {
    let v: Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw })
        .map_err(|e| format!("invalid session args: {e}"))?;
    let session_id = v
        .get("session_id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(SessionRefArgs { session_id })
}

pub fn parse_list_sessions_args(raw: &str) -> Result<ListSessionsArgs, String> {
    let v: Value = serde_json::from_str(if raw.trim().is_empty() { "{}" } else { raw })
        .map_err(|e| format!("invalid list_sessions args: {e}"))?;
    let limit = v.get("limit").and_then(|x| x.as_u64()).map(|n| n as u32);
    Ok(ListSessionsArgs { limit })
}

/// Stable error class tokens for voice → Build tool failures (UI / model).
pub fn classify_tool_error(raw: &str) -> &'static str {
    let s = raw.to_lowercase();
    if s.contains("cli not found")
        || s.contains("cli_missing")
        || s.contains("grok build not found")
        || s.contains("grok build cli not found")
        || s.contains("install grok build")
        || s.contains("install or set the cli path")
        || s.contains("install or set cli path")
    {
        return "cli_missing";
    }
    // OS mic denial (getUserMedia) — before generic permission_denied.
    if s.contains("notallowed")
        || s.contains("mic_denied")
        || (s.contains("microphone") && (s.contains("denied") || s.contains("permission")))
        || (s.contains("getusermedia") && s.contains("denied"))
    {
        return "mic_denied";
    }
    // Agent / tool permission blocked by user or policy (not OS mic).
    if s.contains("permission_denied")
        || s.contains("permission denied")
        || s.contains("permission_blocked")
        || s.contains("user denied")
        || s.contains("user_denied")
        || s.contains("reject_once")
        || s.contains("reject_always")
    {
        return "permission_denied";
    }
    if s.contains("cancelled")
        || s.contains("canceled")
        || s.contains("voice_stop")
        || s.contains("user_stop")
    {
        return "cancelled";
    }
    if s.contains("no microphone")
        || s.contains("mic_missing")
        || s.contains("no device")
        || s.contains("device not found")
    {
        return "mic_missing";
    }
    if s.contains("timeout") || s.contains("timed out") || s.contains("deadline") {
        return "timeout";
    }
    if s.contains("network")
        || s.contains("connection")
        || s.contains("websocket")
        || s.contains("econn")
        || s.contains("dns")
    {
        return "network";
    }
    if s.contains("401")
        || s.contains("403")
        || s.contains("unauthor")
        || s.contains("credential")
        || s.contains("no xai")
        || s.contains("bearer")
        || s.contains("auth")
    {
        return "auth";
    }
    if s.contains("not available") || s.contains("not_available") {
        return "not_available";
    }
    if s.contains("unknown tool") || s.contains("tool ") {
        return "tool_failed";
    }
    "unknown"
}

/// Soft-fail classes: return structured tool result instead of killing the loop.
/// CLI missing, user permission deny, and voice-stop cancel keep voice open.
pub fn is_soft_tool_error(class: &str) -> bool {
    matches!(class, "cli_missing" | "permission_denied" | "cancelled")
}

/// Whether stopping Live Voice should cancel delegated Build agent turns.
/// Product default: keep agents (`keep_agents_on_end = true`).
pub fn should_cancel_delegated_agents_on_voice_stop(keep_agents_on_end: bool) -> bool {
    !keep_agents_on_end
}

/// Non-empty session id suitable for delegated tracking.
/// Never invents ids — empty / whitespace → None.
pub fn recordable_delegated_session_id(session_id: Option<&str>) -> Option<String> {
    session_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Canonical tool-loop status tokens emitted on `voice://tool` (VOX-BUILD-FULL).
pub fn normalize_tool_status(raw: &str) -> &'static str {
    match raw.trim().to_lowercase().as_str() {
        "running" | "tool_running" | "in_progress" => "tool_running",
        "permission_pending" | "permission" | "awaiting_permission" => "permission_pending",
        "ok" | "completed" | "success" | "done" => "completed",
        "soft_fail" | "softfail" | "cancelled" | "canceled" => "soft_fail",
        "error" | "failed" | "err" | "failure" => "error",
        "idle" => "idle",
        _ => "tool_running",
    }
}

/// Honest soft-fail payload for the voice model (never invent success).
pub fn soft_fail_result(reason: &str, message: &str) -> Value {
    json!({
        "ok": false,
        "reason": reason,
        "message": message,
    })
}

/// Read soft-fail reason from a tool result object (`ok: false` only).
pub fn soft_fail_reason(result: &Value) -> Option<String> {
    if result.get("ok").and_then(|x| x.as_bool()) == Some(false) {
        let reason = result
            .get("reason")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown")
            .trim()
            .to_string();
        Some(if reason.is_empty() {
            "unknown".into()
        } else {
            reason
        })
    } else {
        None
    }
}

/// Mock tool executor for tests / GROK_APP_VOICE=mock without a live agent.
pub fn mock_execute_tool(name: &str, args_json: &str) -> Result<Value, String> {
    let tool = VoiceToolName::parse(name).ok_or_else(|| format!("unknown tool: {name}"))?;
    match tool {
        VoiceToolName::ListSessions => {
            let _ = parse_list_sessions_args(args_json)?;
            Ok(json!({
                "sessions": [
                    { "id": "mock-1", "title": "Mock session", "state": "ready" }
                ]
            }))
        }
        VoiceToolName::CreateAgentSession => {
            let a = parse_create_agent_args(args_json)?;
            Ok(json!({
                "session_id": "mock-new",
                "title": a.title.unwrap_or_else(|| "Voice task".into()),
                "accepted_prompt": a.prompt,
                "state": "streaming"
            }))
        }
        VoiceToolName::PromptAgent => {
            let a = parse_prompt_agent_args(args_json)?;
            Ok(json!({
                "session_id": a.session_id.unwrap_or_else(|| "live".into()),
                "accepted_prompt": a.prompt,
                "state": "streaming"
            }))
        }
        VoiceToolName::GetAgentStatus => {
            let a = parse_session_ref_args(args_json)?;
            Ok(json!({
                "session_id": a.session_id.unwrap_or_else(|| "live".into()),
                "state": "ready",
                "summary": "Mock agent is idle and ready."
            }))
        }
        VoiceToolName::CancelAgent => {
            let a = parse_session_ref_args(args_json)?;
            Ok(json!({
                "session_id": a.session_id.unwrap_or_else(|| "live".into()),
                "cancelled": true
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_nonempty() {
        assert!(tool_definitions().len() >= 4);
    }

    #[test]
    fn parse_create_requires_prompt() {
        assert!(parse_create_agent_args("{}").is_err());
        let a = parse_create_agent_args(r#"{"prompt":"fix tests","title":"T"}"#).unwrap();
        assert_eq!(a.prompt, "fix tests");
        assert_eq!(a.title.as_deref(), Some("T"));
    }

    #[test]
    fn mock_create() {
        let v =
            mock_execute_tool("create_agent_session", r#"{"prompt":"run cargo test"}"#).unwrap();
        assert_eq!(v["session_id"], "mock-new");
    }

    #[test]
    fn instructions_include_project() {
        let s = live_voice_instructions(Some("/tmp/app"), Some("app"));
        assert!(s.contains("app"));
        assert!(s.contains("create_agent_session"));
    }

    #[test]
    fn classifies_cli_missing_as_soft() {
        assert_eq!(
            classify_tool_error(
                "Grok Build CLI not found. Install Grok Build or set path in Settings."
            ),
            "cli_missing"
        );
        assert!(is_soft_tool_error("cli_missing"));
        assert!(!is_soft_tool_error("auth"));
        let out = soft_fail_result("cli_missing", "missing");
        assert_eq!(out["ok"], false);
        assert_eq!(soft_fail_reason(&out).as_deref(), Some("cli_missing"));
        assert_eq!(soft_fail_reason(&json!({ "session_id": "x" })), None);
    }

    #[test]
    fn classifies_auth_and_network() {
        assert_eq!(classify_tool_error("No xAI credentials found"), "auth");
        assert_eq!(
            classify_tool_error("voice websocket connect failed"),
            "network"
        );
    }

    #[test]
    fn classifies_permission_denied_and_cancelled_as_soft() {
        assert_eq!(
            classify_tool_error("permission denied by user"),
            "permission_denied"
        );
        assert_eq!(
            classify_tool_error("tool cancelled on voice_stop"),
            "cancelled"
        );
        assert!(is_soft_tool_error("permission_denied"));
        assert!(is_soft_tool_error("cancelled"));
        assert_eq!(
            classify_tool_error("NotAllowedError: microphone permission"),
            "mic_denied"
        );
    }

    #[test]
    fn cancel_agents_only_when_keep_false() {
        assert!(!should_cancel_delegated_agents_on_voice_stop(true));
        assert!(should_cancel_delegated_agents_on_voice_stop(false));
    }

    #[test]
    fn recordable_delegated_id_never_invents() {
        assert_eq!(recordable_delegated_session_id(None), None);
        assert_eq!(recordable_delegated_session_id(Some("")), None);
        assert_eq!(recordable_delegated_session_id(Some("   ")), None);
        assert_eq!(
            recordable_delegated_session_id(Some("  abc-1  ")).as_deref(),
            Some("abc-1")
        );
    }

    #[test]
    fn classifies_mic_missing_and_soft_vs_fatal() {
        assert_eq!(
            classify_tool_error("No microphone device found"),
            "mic_missing"
        );
        assert_eq!(
            classify_tool_error("NotAllowedError: Permission denied"),
            "mic_denied"
        );
        // Soft tool loop classes keep voice open; mic/auth/network are classified
        // for UI toasts but are not agent soft-fail tool results.
        assert!(!is_soft_tool_error("mic_denied"));
        assert!(!is_soft_tool_error("auth"));
        assert!(!is_soft_tool_error("network"));
    }

    #[test]
    fn normalizes_tool_status_tokens() {
        assert_eq!(normalize_tool_status("running"), "tool_running");
        assert_eq!(normalize_tool_status("ok"), "completed");
        assert_eq!(
            normalize_tool_status("permission_pending"),
            "permission_pending"
        );
        assert_eq!(normalize_tool_status("cancelled"), "soft_fail");
    }
}
