//! Subagent spawning — spawn flags, env, config.
//!
//! CLI: `--no-subagents`, `GROK_SUBAGENTS`, `[subagents] enabled`.
//! Enabled by default; when App setting is off, force-disable at spawn.

use crate::agent_home_config::{set_table_bool, update_config_toml_if_independent};

/// Top-level CLI flags (before `agent`) for the subagents_enabled setting.
/// Empty when enabled (CLI default on); `["--no-subagents"]` when disabled.
pub fn subagents_spawn_flags(enabled: bool) -> Vec<&'static str> {
    if enabled {
        vec![]
    } else {
        vec!["--no-subagents"]
    }
}

/// `GROK_SUBAGENTS` env value when force-disabling. `None` when enabled.
pub fn subagents_spawn_env_value(enabled: bool) -> Option<&'static str> {
    if enabled {
        None
    } else {
        Some("0")
    }
}

/// When off, always force-disable so config cannot re-enable subagents.
#[allow(dead_code)]
pub fn should_force_disable_subagents(subagents_enabled: bool) -> bool {
    !subagents_enabled
}

/// Upsert `[subagents] enabled = bool` in a TOML-ish text blob.
pub fn set_subagents_enabled_in_toml(text: &str, enabled: bool) -> String {
    set_table_bool(text, "subagents", "enabled", enabled)
}

/// Write `[subagents] enabled` into App agent-home (independent GROK_HOME only).
pub fn sync_subagents_to_agent_profile(
    session_data_mode: &str,
    subagents_enabled: bool,
) -> Result<(), String> {
    let path = update_config_toml_if_independent(session_data_mode, |existing| {
        set_subagents_enabled_in_toml(existing, subagents_enabled)
    })?;
    if let Some(path) = path {
        tracing::info!(
            "agent_subagents: synced [subagents] enabled={} → {}",
            subagents_enabled,
            path.display()
        );
    }
    Ok(())
}

/// Apply spawn flag + env on a tokio Command (top-level, before `agent`).
/// When enabled, leaves CLI defaults alone; when disabled, force-disables.
pub fn apply_subagents_to_command(cmd: &mut tokio::process::Command, enabled: bool) {
    for flag in subagents_spawn_flags(enabled) {
        cmd.arg(flag);
    }
    if let Some(v) = subagents_spawn_env_value(enabled) {
        cmd.env("GROK_SUBAGENTS", v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_and_env() {
        assert!(subagents_spawn_flags(true).is_empty());
        assert_eq!(subagents_spawn_flags(false), vec!["--no-subagents"]);
        assert_eq!(subagents_spawn_env_value(true), None);
        assert_eq!(subagents_spawn_env_value(false), Some("0"));
        assert!(should_force_disable_subagents(false));
        assert!(!should_force_disable_subagents(true));
    }

    #[test]
    fn upserts_subagents_table() {
        let t = set_subagents_enabled_in_toml("", false);
        assert!(t.contains("[subagents]"));
        assert!(t.contains("enabled = false"));
        let t2 = set_subagents_enabled_in_toml(&t, true);
        assert!(t2.contains("enabled = true"));
        assert_eq!(t2.matches("enabled").count(), 1);

        let existing = "[ui]\nyolo = false\n\n[subagents]\nenabled = true\n";
        let next = set_subagents_enabled_in_toml(existing, false);
        assert!(next.contains("[subagents]"));
        assert!(next.contains("enabled = false"));
        assert!(next.contains("[ui]"));
    }

    #[test]
    fn shared_mode_skips_write() {
        assert!(sync_subagents_to_agent_profile("shared", true).is_ok());
    }
}
