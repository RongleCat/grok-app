//! Auto-wake (CLI `[features].auto_wake`) — agent-home sync + spawn overlay.
//!
//! When enabled, Grok Build may inject a synthetic turn after background work
//! completes (bash / monitor / task completion, scheduled loops). Behavior is
//! entirely CLI-side.
//!
//! - Independent mode: write agent-home `config.toml` (`auto_wake_enabled` +
//!   `[features].auto_wake`). Never rewrite `~/.grok`.
//! - Shared mode: do **not** write `~/.grok`. Inject `GROK_CONFIG` overlay
//!   `{"features":{"auto_wake":true}}` (allowlisted) on spawn when enabled.
//!
//! Soft-respawn after a settings flip so the next agent process reloads.

use serde_json::{json, Value};

use crate::agent_home_config::{
    set_table_key, set_top_level_bool, update_config_toml_if_independent,
};

pub const CONFIG_KEY: &str = "auto_wake_enabled";
pub const GROK_CONFIG_ENV: &str = "GROK_CONFIG";

/// Normalize enable toggle (App default off / opt-in).
#[allow(dead_code)]
pub fn normalize_enabled(raw: bool) -> bool {
    raw
}

/// Upsert top-level `auto_wake_enabled` and `[features].auto_wake`.
pub fn set_auto_wake_in_toml(text: &str, enabled: bool) -> String {
    let lit = if enabled { "true" } else { "false" };
    let next = set_top_level_bool(text, CONFIG_KEY, enabled);
    set_table_key(&next, "features", "auto_wake", lit, false)
}

/// Write the config keys into App agent-home (independent GROK_HOME only).
pub fn sync_auto_wake_to_agent_profile(
    session_data_mode: &str,
    enabled: bool,
) -> Result<(), String> {
    let path = update_config_toml_if_independent(session_data_mode, |existing| {
        set_auto_wake_in_toml(existing, enabled)
    })?;
    if let Some(path) = path {
        tracing::info!(
            "agent_auto_wake: synced {}={} → {}",
            CONFIG_KEY,
            enabled,
            path.display()
        );
    }
    Ok(())
}

/// JSON overlay for `GROK_CONFIG` (`features` is on the CLI allowlist).
pub fn auto_wake_overlay_json(enabled: bool) -> Value {
    json!({ "features": { "auto_wake": enabled } })
}

/// Deep-merge `patch` onto an existing `GROK_CONFIG` JSON object blob.
/// Malformed / non-object existing values are dropped (CLI would ignore them).
pub fn merge_grok_config_overlay(existing: Option<&str>, patch: &Value) -> String {
    let mut base = existing
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}));
    deep_merge_objects(&mut base, patch);
    base.to_string()
}

fn deep_merge_objects(base: &mut Value, patch: &Value) {
    let Some(patch_obj) = patch.as_object() else {
        *base = patch.clone();
        return;
    };
    let Some(base_obj) = base.as_object_mut() else {
        *base = patch.clone();
        return;
    };
    for (k, v) in patch_obj {
        if let Some(existing) = base_obj.get_mut(k) {
            if existing.is_object() && v.is_object() {
                deep_merge_objects(existing, v);
                continue;
            }
        }
        base_obj.insert(k.clone(), v.clone());
    }
}

/// Shared-mode spawn overlay. Independent mode already wrote agent-home.
///
/// When App auto-wake is **on**, merge `features.auto_wake=true` into the
/// process `GROK_CONFIG` (does not rewrite `~/.grok`). Off → leave env alone
/// so a user `~/.grok` / inherited overlay is not forced off.
pub fn apply_auto_wake_to_command(
    cmd: &mut tokio::process::Command,
    enabled: bool,
    session_data_mode: &str,
) {
    if !enabled {
        return;
    }
    let existing = std::env::var(GROK_CONFIG_ENV).ok();
    let merged = merge_grok_config_overlay(existing.as_deref(), &auto_wake_overlay_json(true));
    tracing::info!(
        target: "acp_client",
        mode = %session_data_mode,
        "agent_auto_wake: GROK_CONFIG overlay features.auto_wake=true"
    );
    cmd.env(GROK_CONFIG_ENV, merged);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize() {
        assert!(!normalize_enabled(false));
        assert!(normalize_enabled(true));
    }

    #[test]
    fn upserts_top_level_and_features_key() {
        let t = set_auto_wake_in_toml("", true);
        assert!(t.contains("auto_wake_enabled = true"));
        assert!(t.contains("auto_wake = true"), "{t}");

        let existing = "[ui]\nyolo = false\n\n[subagents]\nenabled = true\n";
        let next = set_auto_wake_in_toml(existing, false);
        assert!(next.contains("auto_wake_enabled = false"));
        assert!(next.contains("auto_wake = false"), "{next}");
        let ui_pos = next.find("[ui]").unwrap();
        let key_pos = next.find("auto_wake_enabled").unwrap();
        assert!(key_pos < ui_pos);
        assert!(next.contains("[subagents]"));
        assert!(next.contains("yolo = false"));

        let again = set_auto_wake_in_toml(&next, true);
        assert!(again.contains("auto_wake_enabled = true"));
        assert_eq!(again.matches("auto_wake_enabled").count(), 1);
        assert!(again.contains("auto_wake = true"));
    }

    #[test]
    fn overlay_json_is_features_auto_wake() {
        assert_eq!(
            auto_wake_overlay_json(true),
            json!({ "features": { "auto_wake": true } })
        );
        assert_eq!(
            auto_wake_overlay_json(false),
            json!({ "features": { "auto_wake": false } })
        );
    }

    #[test]
    fn merge_preserves_existing_allowlisted_keys() {
        let merged = merge_grok_config_overlay(
            Some(r#"{"models":{"default_reasoning_effort":"high"}}"#),
            &auto_wake_overlay_json(true),
        );
        let v: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v["features"]["auto_wake"], json!(true));
        assert_eq!(v["models"]["default_reasoning_effort"], json!("high"));
    }

    #[test]
    fn merge_drops_malformed_existing() {
        let merged = merge_grok_config_overlay(Some("not-json"), &auto_wake_overlay_json(true));
        let v: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v, auto_wake_overlay_json(true));
    }
}
