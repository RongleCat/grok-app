//! Privacy center — allowlisted read/write of Grok Build 0.2.117 privacy keys
//! in the active `GROK_HOME` `config.toml`.
//!
//! ## Allowlist (soft-fail when missing)
//! - `[features] telemetry` — product-analytics master switch
//! - `[telemetry] trace_upload` — session trace upload
//! - `[telemetry] mixpanel_enabled` — Mixpanel product analytics
//! - `[harness] disable_codebase_upload` — refuse codebase/index upload
//! - `[harness] disable_workspace_teleport` — related harness upload flag
//!
//! ## Honesty
//! - Missing keys stay `None` (never invent CLI defaults as “off”).
//! - Writes are path-scoped to independent agent-home only (never `~/.grok`).
//! - Shared mode is read-only against the live `~/.grok/config.toml`.
//! - Coding-data / training opt-in is **not** a config.toml key — UI must
//!   point users at CLI `/privacy` instead of a fake App toggle.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::agent_config_edit::{
    is_agent_home_config_path, parse_toml_bool, require_agent_home_config_path, set_table_key,
};
use crate::agent_config_view::{config_toml_path, normalize_mode};
use crate::paths::{agent_config_toml, agent_home_dir, ensure_app_dirs, resolve_agent_grok_home};
use crate::store;

/// Hard cap on bytes read before parse / redaction.
pub const MAX_PRIVACY_CONFIG_BYTES: u64 = 256 * 1024;

/// Snapshot of privacy-related allowlisted keys for Settings UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyConfigSnapshot {
    /// Absolute path of the config.toml being shown (active mode).
    pub path: String,
    /// Absolute GROK_HOME root for this mode.
    pub grok_home: String,
    /// `independent` | `shared`
    pub mode: String,
    /// True only when mode is independent (edits apply to App agent-home).
    pub writable: bool,
    pub file_exists: bool,
    /// `[features].telemetry` when present.
    pub telemetry: Option<bool>,
    /// `[telemetry].trace_upload` when present.
    pub trace_upload: Option<bool>,
    /// `[telemetry].mixpanel_enabled` when present.
    pub mixpanel_enabled: Option<bool>,
    /// `[harness].disable_codebase_upload` when present.
    pub disable_codebase_upload: Option<bool>,
    /// `[harness].disable_workspace_teleport` when present.
    pub disable_workspace_teleport: Option<bool>,
    /// Redacted preview of allowlisted privacy sections only.
    pub redacted_preview: String,
    /// CLI slash command for coding-data / retention / training (not config.toml).
    pub cli_privacy_command: String,
}

/// Partial patch for allowlisted privacy keys. `None` = leave unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyConfigPatch {
    pub telemetry: Option<bool>,
    pub trace_upload: Option<bool>,
    pub mixpanel_enabled: Option<bool>,
    pub disable_codebase_upload: Option<bool>,
    pub disable_workspace_teleport: Option<bool>,
}

impl PrivacyConfigPatch {
    pub fn is_empty(&self) -> bool {
        self.telemetry.is_none()
            && self.trace_upload.is_none()
            && self.mixpanel_enabled.is_none()
            && self.disable_codebase_upload.is_none()
            && self.disable_workspace_teleport.is_none()
    }
}

/// Parsed allowlisted privacy flags (all optional — soft-fail missing).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrivacyFlags {
    pub telemetry: Option<bool>,
    pub trace_upload: Option<bool>,
    pub mixpanel_enabled: Option<bool>,
    pub disable_codebase_upload: Option<bool>,
    pub disable_workspace_teleport: Option<bool>,
}

/// Extract allowlisted privacy keys from full config text (pure).
pub fn parse_privacy_flags(text: &str) -> PrivacyFlags {
    let mut flags = PrivacyFlags::default();
    let mut table = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            table = trimmed
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string();
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let val = trimmed[eq + 1..].trim();
        let Some(b) = parse_toml_bool(val) else {
            continue;
        };
        match (table.as_str(), key) {
            ("features", "telemetry") => flags.telemetry = Some(b),
            ("telemetry", "trace_upload") => flags.trace_upload = Some(b),
            ("telemetry", "mixpanel_enabled") => flags.mixpanel_enabled = Some(b),
            ("harness", "disable_codebase_upload") => flags.disable_codebase_upload = Some(b),
            ("harness", "disable_workspace_teleport") => flags.disable_workspace_teleport = Some(b),
            _ => {}
        }
    }

    flags
}

/// Apply an allowlisted privacy patch onto TOML text (pure). Never rewrites secrets.
pub fn apply_privacy_patch(text: &str, patch: &PrivacyConfigPatch) -> String {
    let mut next = text.to_string();
    if let Some(v) = patch.telemetry {
        next = set_table_key(
            &next,
            "features",
            "telemetry",
            if v { "true" } else { "false" },
            false,
        );
    }
    if let Some(v) = patch.trace_upload {
        next = set_table_key(
            &next,
            "telemetry",
            "trace_upload",
            if v { "true" } else { "false" },
            false,
        );
    }
    if let Some(v) = patch.mixpanel_enabled {
        next = set_table_key(
            &next,
            "telemetry",
            "mixpanel_enabled",
            if v { "true" } else { "false" },
            false,
        );
    }
    if let Some(v) = patch.disable_codebase_upload {
        next = set_table_key(
            &next,
            "harness",
            "disable_codebase_upload",
            if v { "true" } else { "false" },
            false,
        );
    }
    if let Some(v) = patch.disable_workspace_teleport {
        next = set_table_key(
            &next,
            "harness",
            "disable_workspace_teleport",
            if v { "true" } else { "false" },
            false,
        );
    }
    next
}

/// Extract only privacy-related tables for preview (document order).
pub fn extract_privacy_sections(text: &str) -> String {
    let mut out = String::new();
    let mut keep = false;
    let mut any = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let name = trimmed.trim_start_matches('[').trim_end_matches(']');
            // Keep whole tables that host privacy keys (not nested model secrets).
            keep = matches!(name, "features" | "telemetry" | "harness");
            if keep {
                if any {
                    out.push('\n');
                }
                any = true;
                out.push_str(trimmed);
                out.push('\n');
            }
            continue;
        }
        if keep {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Format-preserving secret redaction for privacy preview text.
pub fn redact_privacy_preview(input: &str) -> String {
    // Reuse config-edit redaction (api_key / token spans).
    crate::agent_config_edit::redact_config_text(input)
}

fn read_config_text(path: &Path) -> (String, bool) {
    if !path.is_file() {
        return (String::new(), false);
    }
    let meta_len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let truncated = meta_len > MAX_PRIVACY_CONFIG_BYTES;
    match fs::read(path) {
        Ok(bytes) => {
            let slice = if bytes.len() as u64 > MAX_PRIVACY_CONFIG_BYTES {
                &bytes[..MAX_PRIVACY_CONFIG_BYTES as usize]
            } else {
                &bytes
            };
            let mut s = String::from_utf8_lossy(slice).into_owned();
            if truncated {
                s.push_str("\n# … [truncated] …\n");
            }
            (s, true)
        }
        Err(_) => (String::new(), false),
    }
}

fn snapshot_from_raw(
    path: &Path,
    home: &Path,
    mode: &str,
    raw: &str,
    exists: bool,
) -> PrivacyConfigSnapshot {
    let flags = parse_privacy_flags(raw);
    let preview = redact_privacy_preview(&extract_privacy_sections(raw));
    PrivacyConfigSnapshot {
        path: path.to_string_lossy().to_string(),
        grok_home: home.to_string_lossy().to_string(),
        mode: mode.to_string(),
        writable: mode == "independent",
        file_exists: exists,
        telemetry: flags.telemetry,
        trace_upload: flags.trace_upload,
        mixpanel_enabled: flags.mixpanel_enabled,
        disable_codebase_upload: flags.disable_codebase_upload,
        disable_workspace_teleport: flags.disable_workspace_teleport,
        redacted_preview: preview,
        cli_privacy_command: "/privacy".into(),
    }
}

/// Load privacy snapshot for the active session data mode (redact-on-read).
///
/// Soft-fails: missing file / missing keys → empty / `None` fields, never error.
pub fn load_privacy_config() -> Result<PrivacyConfigSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode == "independent" {
        let _ = ensure_app_dirs();
    }
    let path = config_toml_path(mode);
    let home = resolve_agent_grok_home(mode);
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, mode, &raw, exists))
}

/// Apply allowlisted privacy patch to agent-home config.toml. Shared mode refused.
pub fn save_privacy_config(patch: &PrivacyConfigPatch) -> Result<PrivacyConfigSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode != "independent" {
        return Err(
            "shared session mode: agent-home config.toml is not the live GROK_HOME; switch to independent to edit privacy keys"
                .into(),
        );
    }

    if patch.is_empty() {
        return load_privacy_config();
    }

    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    require_agent_home_config_path(&path)?;
    if !is_agent_home_config_path(&path) {
        return Err(format!(
            "path not allowed: only agent-home config.toml may be edited ({})",
            path.display()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create agent-home: {e}"))?;
    }

    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.contains("[REDACTED]") {
        tracing::warn!(
            "agent_privacy: on-disk config contains [REDACTED]; writing patch carefully"
        );
    }
    let next = apply_privacy_patch(&existing, patch);
    fs::write(&path, &next).map_err(|e| format!("write config: {e}"))?;

    tracing::info!(
        path = %path.display(),
        telemetry = ?patch.telemetry,
        trace_upload = ?patch.trace_upload,
        mixpanel = ?patch.mixpanel_enabled,
        disable_codebase_upload = ?patch.disable_codebase_upload,
        disable_workspace_teleport = ?patch.disable_workspace_teleport,
        "agent_privacy: saved allowlisted privacy keys"
    );

    // Re-load from agent-home (independent path).
    let home = agent_home_dir();
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, "independent", &raw, exists))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_home(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "grok-privacy-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parse_missing_keys_are_none() {
        let flags = parse_privacy_flags("[ui]\nyolo = true\n");
        assert_eq!(flags, PrivacyFlags::default());
    }

    #[test]
    fn parse_allowlisted_privacy_keys() {
        let text = r#"
[features]
telemetry = false
codebase_indexing = true

[telemetry]
trace_upload = false
mixpanel_enabled = false
events_url = "https://example.com"

[harness]
disable_codebase_upload = true
disable_workspace_teleport = true

[model.x]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"
"#;
        let flags = parse_privacy_flags(text);
        assert_eq!(flags.telemetry, Some(false));
        assert_eq!(flags.trace_upload, Some(false));
        assert_eq!(flags.mixpanel_enabled, Some(false));
        assert_eq!(flags.disable_codebase_upload, Some(true));
        assert_eq!(flags.disable_workspace_teleport, Some(true));
    }

    #[test]
    fn apply_patch_preserves_other_sections_and_secrets() {
        let existing = r#"
[models]
default = "grok"

[features]
telemetry = true

[model.relay]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"
base_url = "https://example.com/v1"
"#;
        let next = apply_privacy_patch(
            existing,
            &PrivacyConfigPatch {
                telemetry: Some(false),
                trace_upload: Some(false),
                mixpanel_enabled: Some(false),
                disable_codebase_upload: Some(true),
                disable_workspace_teleport: Some(true),
            },
        );
        assert!(next.contains("[models]"), "{next}");
        assert!(next.contains("default = \"grok\""), "{next}");
        assert!(next.contains("telemetry = false"), "{next}");
        assert!(next.contains("[telemetry]"), "{next}");
        assert!(next.contains("trace_upload = false"), "{next}");
        assert!(next.contains("mixpanel_enabled = false"), "{next}");
        assert!(next.contains("[harness]"), "{next}");
        assert!(next.contains("disable_codebase_upload = true"), "{next}");
        assert!(next.contains("disable_workspace_teleport = true"), "{next}");
        assert!(next.contains("sk-abcdefghijklmnopqrstuvwxyz0123"), "{next}");
        assert!(next.contains("base_url"), "{next}");
        // One telemetry assignment under [features].
        assert_eq!(
            next.lines()
                .filter(|l| l.trim().starts_with("telemetry ="))
                .count(),
            1
        );
    }

    #[test]
    fn extract_privacy_sections_drops_secrets_tables() {
        let text = r#"
[features]
telemetry = false

[model.x]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"

[harness]
disable_codebase_upload = true

[telemetry]
trace_upload = false
"#;
        let preview = extract_privacy_sections(text);
        assert!(preview.contains("[features]"));
        assert!(preview.contains("[harness]"));
        assert!(preview.contains("[telemetry]"));
        assert!(!preview.contains("[model.x]"));
        assert!(!preview.contains("sk-"));
    }

    #[test]
    fn load_and_save_roundtrip_independent() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("roundtrip");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);

        let _ = ensure_app_dirs();
        let mut s = store::load_settings();
        s.session_data_mode = "independent".into();
        store::save_settings(&s).unwrap();

        let snap = load_privacy_config().unwrap();
        assert!(snap.writable);
        assert!(snap.path.contains("agent-home"));
        assert_eq!(snap.cli_privacy_command, "/privacy");
        // Soft-fail: no keys yet.
        assert_eq!(snap.telemetry, None);
        assert_eq!(snap.disable_codebase_upload, None);

        let saved = save_privacy_config(&PrivacyConfigPatch {
            telemetry: Some(false),
            trace_upload: Some(false),
            mixpanel_enabled: Some(false),
            disable_codebase_upload: Some(true),
            disable_workspace_teleport: Some(true),
        })
        .unwrap();
        assert_eq!(saved.telemetry, Some(false));
        assert_eq!(saved.trace_upload, Some(false));
        assert_eq!(saved.mixpanel_enabled, Some(false));
        assert_eq!(saved.disable_codebase_upload, Some(true));
        assert_eq!(saved.disable_workspace_teleport, Some(true));
        assert!(saved.file_exists);

        let disk = fs::read_to_string(agent_config_toml()).unwrap();
        assert!(disk.contains("[features]"));
        assert!(disk.contains("telemetry = false"));
        assert!(disk.contains("[telemetry]"));
        assert!(disk.contains("trace_upload = false"));
        assert!(disk.contains("[harness]"));
        assert!(disk.contains("disable_codebase_upload = true"));
        assert!(!disk.contains("[REDACTED]"));

        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn save_refuses_shared_mode() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("shared");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let mut s = store::load_settings();
        s.session_data_mode = "shared".into();
        store::save_settings(&s).unwrap();

        let err = save_privacy_config(&PrivacyConfigPatch {
            telemetry: Some(false),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.contains("shared"), "{err}");

        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }
}
