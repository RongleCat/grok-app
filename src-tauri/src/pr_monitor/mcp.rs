//! Agent-facing PR monitor MCP (stdio Node script, injected per session).
//!
//! The Host owns every watch — registry, poll loop, wake delivery — and serves
//! it on the loopback session API. This module is the other half: it embeds
//! `scripts/pr-monitor-mcp.mjs` (the `pr_watch` / `pr_unwatch` / `pr_watches`
//! tools) and describes the ACP `mcpServers` entry that gives a chat's agent its
//! own handle on the watches of *that* chat.
//!
//! Injecting it is what makes the feature agent-operable: after `gh pr create`
//! the agent mounts the watch itself and stops it when the PR is merged or
//! closed, instead of waiting for a human to click the branch menu's bell.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// Embedded copy of `scripts/pr-monitor-mcp.mjs`.
///
/// Packaged installs have no repo tree, so the Host writes this out under the
/// app data dir and points the agent at the written file (mirrors official-aux).
pub const PR_MONITOR_MCP_SCRIPT: &str = include_str!("../../../scripts/pr-monitor-mcp.mjs");
pub const PR_MONITOR_MCP_SCRIPT_FILE: &str = "pr-monitor-mcp.mjs";
/// MCP server name the agent sees.
pub const PR_MONITOR_MCP_SERVER: &str = "pr-monitor";

/// Where the written script lives: `{app_data}/mcp/pr-monitor`.
pub fn mcp_home() -> PathBuf {
    crate::paths::app_data_root().join("mcp").join("pr-monitor")
}

/// Write (or refresh) the stdio script under `home`; returns its path.
pub fn write_script(home: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(home).map_err(|e| format!("pr monitor mcp home: {e}"))?;
    let dest = home.join(PR_MONITOR_MCP_SCRIPT_FILE);
    let current = fs::read_to_string(&dest).unwrap_or_default();
    if current != PR_MONITOR_MCP_SCRIPT {
        fs::write(&dest, PR_MONITOR_MCP_SCRIPT)
            .map_err(|e| format!("write pr-monitor mcp script: {e}"))?;
    }
    Ok(dest)
}

/// ACP `mcpServers` entry scoped to one app session, or `None` when there is
/// nothing to hand the agent (no session id, no node, script unwritable).
///
/// The tools talk to the running Host over the loopback API, so the env carries
/// the endpoint file (its `{url, token}`) and the session whose watches these
/// tools may touch. `project_cwd` becomes the default repository for `pr_watch`.
pub fn mcp_server_acp_entry(session_id: &str, project_cwd: Option<&str>) -> Option<Value> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return None;
    }
    let script = write_script(&mcp_home()).ok()?;
    let node = resolve_node();
    let endpoint = crate::session_api::endpoint_path();
    let mut env = vec![
        json!({
            "name": "GROK_APP_PR_MONITOR_ENDPOINT",
            "value": endpoint.display().to_string(),
        }),
        json!({ "name": "GROK_APP_SESSION_ID", "value": sid }),
    ];
    if let Some(cwd) = project_cwd.map(str::trim).filter(|c| !c.is_empty()) {
        env.push(json!({ "name": "GROK_APP_PROJECT_PATH", "value": cwd }));
    }
    Some(json!({
        "name": PR_MONITOR_MCP_SERVER,
        "command": node,
        "args": [script.display().to_string()],
        "env": env,
    }))
}

/// The `node` that runs the stdio server.
///
/// Falls back to the bare name (the agent's own PATH resolves it) exactly like
/// the official-aux entry, so a host where `which` is missing still gets the
/// tools. Resolved once: this runs on the connect path, which must stay cheap.
fn resolve_node() -> String {
    static NODE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NODE.get_or_init(|| crate::official_aux::which_node().unwrap_or_else(|| "node".to_string()))
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_is_embedded_and_names_the_three_tools() {
        for tool in ["pr_watch", "pr_unwatch", "pr_watches"] {
            assert!(
                PR_MONITOR_MCP_SCRIPT.contains(tool),
                "embedded script is missing {tool}"
            );
        }
    }

    #[test]
    fn entry_stays_none_without_a_session() {
        assert!(mcp_server_acp_entry("   ", Some("/tmp/project")).is_none());
    }

    /// The script reads the host's watch rows by field name, with `?? null`
    /// fallbacks: a rename here would show up as blank rows instead of an error.
    #[test]
    fn script_reads_fields_the_host_actually_sends() {
        let row = crate::pr_monitor::types::PrWatchInfo {
            session_id: "s1".into(),
            project_path: "/tmp/repo".into(),
            pr_number: 7,
            interval_secs: 60,
            mounted_at: "2026-01-01T00:00:00Z".into(),
            last_poll_at: None,
            last_update_at: None,
            last_error: None,
            polls: 0,
            updates: 0,
            terminal: false,
            snapshot: None,
            last_change: None,
            pending: false,
        };
        let json = serde_json::to_value(&row).expect("watch row serializes");
        let object = json.as_object().expect("watch row is an object");
        // `skip_serializing_if` hides the optional ones until they have a value.
        for key in [
            "prNumber",
            "projectPath",
            "intervalSecs",
            "polls",
            "updates",
            "terminal",
        ] {
            assert!(object.contains_key(key), "watch row is missing `{key}`");
        }
        for key in [
            "prNumber",
            "projectPath",
            "intervalSecs",
            "polls",
            "updates",
            "terminal",
            "lastPollAt",
            "lastError",
            "snapshot",
        ] {
            assert!(
                PR_MONITOR_MCP_SCRIPT.contains(key),
                "script does not read `{key}` — it fell out of sync with the host"
            );
        }
    }
}
