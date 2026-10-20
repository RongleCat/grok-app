//! Per-session director rule and the read-only subagent inheritance check.
//!
//! The paragraph matches `DIRECTOR_RULE` in `src/lib/directorMode.ts`.
//! This module does not write `~/.grok`.

/// Sent as ACP `session/new` `_meta.rules` when director mode is on.
pub const DIRECTOR_RULE: &str = "Do lane work with a background workflow or background subagents. Keep this transcript to decisions, blockers, and a short status. Put file lists, diffs, and command output in the child prompt. Name the task ids started. Ask before two writers share one tree.";

/// Env wins when it is set. Otherwise `[features] subagent_model_inheritance`
/// or `subagent_model_inheritance_enabled`. Absent means off.
pub fn subagent_model_inheritance_on(config_toml: &str, env_value: Option<&str>) -> bool {
    if let Some(raw) = env_value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return matches!(
                trimmed.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            );
        }
    }
    crate::agent_home_config::get_table_bool(config_toml, "features", "subagent_model_inheritance")
        .or_else(|| {
            crate::agent_home_config::get_table_bool(
                config_toml,
                "features",
                "subagent_model_inheritance_enabled",
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::subagent_model_inheritance_on;

    #[test]
    fn missing_config_stays_off() {
        assert!(!subagent_model_inheritance_on("", None));
        assert!(!subagent_model_inheritance_on(
            "[features]\nother = true\n",
            None
        ));
    }

    #[test]
    fn features_table_and_env() {
        let on = "[features]\nsubagent_model_inheritance = true\n";
        assert!(subagent_model_inheritance_on(on, None));
        assert!(!subagent_model_inheritance_on(on, Some("false")));
        assert!(subagent_model_inheritance_on("", Some("1")));
        let alias = "[features]\nsubagent_model_inheritance_enabled = true\n";
        assert!(subagent_model_inheritance_on(alias, None));
    }
}
