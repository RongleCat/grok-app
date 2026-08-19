//! Safe, redacted viewer for agent `config.toml` (independent agent-home or shared `~/.grok`).
//!
//! View-first only — never returns raw API keys / secrets / bearer tokens.
//! Path follows active `session_data_mode` (same root as permission rules / MCP).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::paths::{agent_config_toml, ensure_app_dirs, resolve_agent_grok_home};
use crate::store;

/// Hard cap on bytes read from disk before redaction (keeps UI snappy).
pub const MAX_CONFIG_TOML_BYTES: u64 = 512 * 1024;

/// Result of a redacted `config.toml` read for Settings UI.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigTomlReadResult {
    /// Absolute path to the config file for the active session data mode.
    pub path: String,
    pub exists: bool,
    /// `independent` | `shared`
    pub mode: String,
    /// GROK_HOME root for this mode.
    pub grok_home: String,
    /// Full file text with secrets redacted (empty when missing).
    pub text: String,
    /// Top-level / nested `[table]` headers in order (from redacted text).
    pub sections: Vec<String>,
    /// True when the on-disk file was truncated before redaction.
    pub truncated: bool,
}

/// Resolve `config.toml` path for the given session data mode.
///
/// Independent → App agent-home; shared → `~/.grok/config.toml`.
pub fn config_toml_path(session_data_mode: &str) -> PathBuf {
    if session_data_mode == "shared" {
        resolve_agent_grok_home(session_data_mode).join("config.toml")
    } else {
        let _ = ensure_app_dirs();
        agent_config_toml()
    }
}

/// Normalize mode string to `independent` | `shared`.
pub fn normalize_mode(session_data_mode: &str) -> &'static str {
    if session_data_mode.trim().eq_ignore_ascii_case("shared") {
        "shared"
    } else {
        "independent"
    }
}

/// Extract `[table]` / `[[array]]` headers in document order (pure).
pub fn extract_toml_sections(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if t.starts_with('[') && t.ends_with(']') && t.len() >= 3 {
            // Reject malformed single-char brackets already covered by len.
            out.push(t.to_string());
        }
    }
    out
}

/// Format-preserving secret redaction for TOML (and similar key=value text).
///
/// - Whole-line redaction for secret-looking keys (`api_key`, `token`, …)
/// - Token-span redaction for common key prefixes (`sk-`, `xai-`, `ghp_`, …)
/// - Bearer header spans
pub fn redact_config_toml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for (i, line) in input.lines().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&redact_toml_line(line));
    }
    // Preserve a trailing newline if the original had one.
    if input.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn redact_toml_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    // Secret assignment keys (TOML / env-style).
    let secret_keys = [
        "api_key",
        "apikey",
        "api-key",
        "secret",
        "password",
        "passwd",
        "token",
        "authorization",
        "bearer",
        "private_key",
        "private-key",
        "access_key",
        "secret_key",
        "client_secret",
        "client-secret",
        "deployment_key",
        "deployment-key",
        "deploy_key",
        "deploy-key",
        "xai_api_key",
        "openai_api_key",
        "refresh_token",
        "access_token",
        "auth_token",
        "server_key",
        "server-key",
        "webhook_secret",
        "channel_secret",
        "channel_access_token",
    ];
    for key in secret_keys {
        if !lower.contains(key) {
            continue;
        }
        // Only treat as secret assignment when there's a value separator.
        if let Some(idx) = find_assignment_sep(line) {
            // Ensure the key appears before the separator (not only in a comment after).
            let head_lower = line[..idx].to_ascii_lowercase();
            if head_lower.contains(key) {
                let head = &line[..=idx];
                // Preserve trailing inline comment if any after a quoted value is hard;
                // always redact the value side entirely.
                return format!("{head} [REDACTED]");
            }
        }
    }
    redact_token_spans(&redact_bearer(line))
}

fn find_assignment_sep(line: &str) -> Option<usize> {
    // Prefer `=` (TOML); also accept `:` for yaml-ish / header lines.
    let eq = line.find('=');
    let colon = line.find(':');
    match (eq, colon) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn redact_bearer(line: &str) -> String {
    // Authorization: Bearer <token>
    let lower = line.to_ascii_lowercase();
    if let Some(rel) = lower.find("bearer ") {
        let start = rel;
        let rest = &line[start + "bearer ".len()..];
        let token_len = rest
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\'')
            .count();
        if token_len >= 8 {
            let end = start + "bearer ".len() + token_len;
            let mut out = String::with_capacity(line.len());
            out.push_str(&line[..start]);
            out.push_str("Bearer [REDACTED]");
            out.push_str(&line[end..]);
            return out;
        }
    }
    line.to_string()
}

fn redact_token_spans(line: &str) -> String {
    let prefixes = [
        "sk-", "sk_", "rk-", "xai-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xoxb-", "xoxp-",
        "AKIA", "ASIA", "dep_",
    ];
    let mut result = line.to_string();
    for pref in prefixes {
        let mut search_from = 0;
        while let Some(rel) = result[search_from..].find(pref) {
            let start = search_from + rel;
            let rest = &result[start + pref.len()..];
            let token_len = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .count();
            if token_len >= 12 {
                let end = start + pref.len() + token_len;
                result.replace_range(start..end, &format!("{pref}[REDACTED]"));
                search_from = start + pref.len() + "[REDACTED]".len();
            } else {
                search_from = start + pref.len();
            }
        }
    }
    result
}

/// Also scrub exact known secrets from App secrets store (format-preserving replace).
fn scrub_known_secrets(mut text: String) -> String {
    let secrets = store::load_secrets();
    for key in [
        secrets.official_api_key.as_deref(),
        secrets.relay_api_key.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if key.len() >= 8 {
            text = text.replace(key, "[REDACTED]");
        }
    }
    text
}

/// Read + redact agent config.toml for the active session data mode.
pub fn read_agent_config_toml(session_data_mode: &str) -> AgentConfigTomlReadResult {
    let mode = normalize_mode(session_data_mode);
    let grok_home = resolve_agent_grok_home(mode);
    let path = config_toml_path(mode);
    let path_str = path.to_string_lossy().to_string();
    let grok_home_str = grok_home.to_string_lossy().to_string();

    if !path.is_file() {
        return AgentConfigTomlReadResult {
            path: path_str,
            exists: false,
            mode: mode.to_string(),
            grok_home: grok_home_str,
            text: String::new(),
            sections: Vec::new(),
            truncated: false,
        };
    }

    let meta_len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let truncated = meta_len > MAX_CONFIG_TOML_BYTES;

    let raw = match fs::read(&path) {
        Ok(bytes) => {
            let slice = if bytes.len() as u64 > MAX_CONFIG_TOML_BYTES {
                &bytes[..MAX_CONFIG_TOML_BYTES as usize]
            } else {
                &bytes
            };
            // Lossy UTF-8 so binary junk cannot panic the host.
            let mut s = String::from_utf8_lossy(slice).into_owned();
            if truncated {
                s.push_str("\n\n# … [truncated: file exceeds viewer size cap] …\n");
            }
            s
        }
        Err(_) => String::new(),
    };

    let redacted = scrub_known_secrets(redact_config_toml(&raw));
    let sections = extract_toml_sections(&redacted);

    AgentConfigTomlReadResult {
        path: path_str,
        exists: true,
        mode: mode.to_string(),
        grok_home: grok_home_str,
        text: redacted,
        sections,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_home(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "grok-cfg-view-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn normalize_mode_maps_shared() {
        assert_eq!(normalize_mode("shared"), "shared");
        assert_eq!(normalize_mode("SHARED"), "shared");
        assert_eq!(normalize_mode("independent"), "independent");
        assert_eq!(normalize_mode(""), "independent");
    }

    #[test]
    fn config_path_independent_is_agent_home() {
        let p = config_toml_path("independent");
        assert!(
            p.ends_with("agent-home/config.toml") || p.ends_with("agent-home\\config.toml"),
            "{p:?}"
        );
    }

    #[test]
    fn config_path_shared_is_dot_grok() {
        let p = config_toml_path("shared");
        assert!(
            p.ends_with(".grok/config.toml") || p.ends_with(".grok\\config.toml"),
            "{p:?}"
        );
    }

    #[test]
    fn extract_sections_finds_tables() {
        let text = r#"
# comment
[models]
default = "grok"

[model.relay]
api_key = "x"

[[plugins]]
name = "a"

[ui.permissions]
"#;
        let secs = extract_toml_sections(text);
        assert_eq!(
            secs,
            vec![
                "[models]".to_string(),
                "[model.relay]".to_string(),
                "[[plugins]]".to_string(),
                "[ui.permissions]".to_string(),
            ]
        );
    }

    #[test]
    fn redacts_api_keys_secrets_and_tokens() {
        let raw = r#"
[model.custom]
name = "relay"
model = "gpt"
base_url = "https://example.com/v1"
api_key = "sk-abcdefghijklmnopqrstuvwxyz012345"
secret = "deploy-secret-should-never-show"
token = "supersecrettokenvalue123"
deployment_key = "dep_abcdefghijklmnop"
client_secret = "client-secret-value"
authorization = "Bearer supersecrettokenvalue"

[ui]
theme = "dark"
"#;
        let out = redact_config_toml(raw);
        assert!(out.contains("[REDACTED]"), "{out}");
        assert!(
            !out.contains("sk-abcdefghijklmnopqrstuvwxyz012345"),
            "{out}"
        );
        assert!(!out.contains("deploy-secret-should-never-show"), "{out}");
        assert!(!out.contains("supersecrettokenvalue123"), "{out}");
        assert!(!out.contains("dep_abcdefghijklmnop"), "{out}");
        assert!(!out.contains("client-secret-value"), "{out}");
        assert!(!out.contains("supersecrettokenvalue"), "{out}");
        // Non-secret fields preserved.
        assert!(out.contains("base_url"), "{out}");
        assert!(out.contains("https://example.com/v1"), "{out}");
        assert!(out.contains("theme = \"dark\""), "{out}");
    }

    #[test]
    fn redacts_inline_token_prefix_without_key() {
        let s = redact_config_toml("note = \"see sk-abcdefghijklmnopqrstuvwxyz0123\"");
        assert!(
            s.contains("sk-[REDACTED]") || s.contains("[REDACTED]"),
            "{s}"
        );
        assert!(!s.contains("sk-abcdefghijklmnopqrstuvwxyz0123"), "{s}");
    }

    #[test]
    fn redacts_bearer_header() {
        let s = redact_config_toml("Authorization: Bearer supersecrettokenvalue");
        assert!(s.contains("[REDACTED]"), "{s}");
        assert!(!s.contains("supersecrettokenvalue"), "{s}");
    }

    #[test]
    fn preserves_trailing_newline() {
        let s = redact_config_toml("a = 1\n");
        assert!(s.ends_with('\n'), "{s:?}");
    }

    #[test]
    fn read_missing_file_reports_exists_false() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("missing");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let res = read_agent_config_toml("independent");
        assert!(!res.exists);
        assert_eq!(res.mode, "independent");
        assert!(res.text.is_empty());
        assert!(res.path.ends_with("config.toml"));
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn read_existing_file_redacts() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("exists");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let agent = tmp.join("agent-home");
        fs::create_dir_all(&agent).unwrap();
        let cfg = agent.join("config.toml");
        fs::write(
            &cfg,
            "[model.x]\napi_key = \"sk-abcdefghijklmnopqrstuvwxyz0123\"\nmodel = \"m\"\n",
        )
        .unwrap();
        let res = read_agent_config_toml("independent");
        assert!(res.exists);
        assert!(res.text.contains("[REDACTED]"), "{}", res.text);
        assert!(!res.text.contains("sk-abcdefghijklmnopqrstuvwxyz0123"));
        assert!(res.sections.iter().any(|s| s == "[model.x]"));
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }
}
