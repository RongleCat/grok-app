//! Grok Build `[permission]` allow / deny / ask rules in agent `config.toml`.
//!
//! Compact form (CLI `--allow` / `--deny` strings):
//! ```toml
//! [permission]
//! deny = ["Bash(rm -rf *)"]
//! allow = ["Bash(git *)"]
//! ask = ["Edit"]
//! ```
//!
//! Evaluation order is deny > ask > allow (Grok Build docs). This module only
//! manages the string-array keys; other `[permission]` keys (e.g. structured
//! `rules`) are left untouched. Writes target the active GROK_HOME for the
//! current `session_data_mode` (agent-home or `~/.grok`).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::{agent_config_toml, ensure_app_dirs, resolve_agent_grok_home};
use crate::store;

/// Snapshot of compact permission rules + config path metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRules {
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub ask: Vec<String>,
}

/// Result returned to the UI (rules + which file is managed).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRulesResult {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub ask: Vec<String>,
    /// Absolute path of the config.toml that was read/written.
    pub config_path: String,
    /// `independent` | `shared`
    pub session_data_mode: String,
    pub file_exists: bool,
}

/// Escape a string for a double-quoted TOML value (no surrounding quotes).
pub fn toml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

/// Double-quoted TOML string literal.
pub fn toml_quote(s: &str) -> String {
    format!("\"{}\"", toml_escape(s))
}

/// Normalize a rule string: trim; reject empty.
pub fn normalize_rule(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.to_string())
}

/// Normalize an action name to `allow` | `deny` | `ask`.
#[allow(dead_code)]
pub fn normalize_action(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "allow" => Some("allow"),
        "deny" => Some("deny"),
        "ask" => Some("ask"),
        _ => None,
    }
}

/// Dedupe while preserving order (first wins). Trims each entry.
pub fn dedupe_rules(rules: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in rules {
        let Some(n) = normalize_rule(r) else {
            continue;
        };
        if seen.insert(n.clone()) {
            out.push(n);
        }
    }
    out
}

/// Normalize a full rules set (trim + dedupe each bucket).
pub fn normalize_rules(rules: &PermissionRules) -> PermissionRules {
    PermissionRules {
        allow: dedupe_rules(&rules.allow),
        deny: dedupe_rules(&rules.deny),
        ask: dedupe_rules(&rules.ask),
    }
}

/// Pure helper: add a rule to one action bucket (deduped).
#[allow(dead_code)]
pub fn add_rule(
    rules: &PermissionRules,
    action: &str,
    rule: &str,
) -> Result<PermissionRules, String> {
    let action = normalize_action(action).ok_or_else(|| format!("unknown action: {action}"))?;
    let rule = normalize_rule(rule).ok_or_else(|| "rule text is empty".to_string())?;
    let mut next = normalize_rules(rules);
    let bucket = match action {
        "allow" => &mut next.allow,
        "deny" => &mut next.deny,
        "ask" => &mut next.ask,
        _ => unreachable!(),
    };
    if !bucket.iter().any(|r| r == &rule) {
        bucket.push(rule);
    }
    Ok(next)
}

/// Pure helper: remove a rule from one action bucket (exact match after trim).
#[allow(dead_code)]
pub fn remove_rule(
    rules: &PermissionRules,
    action: &str,
    rule: &str,
) -> Result<PermissionRules, String> {
    let action = normalize_action(action).ok_or_else(|| format!("unknown action: {action}"))?;
    let rule = normalize_rule(rule).ok_or_else(|| "rule text is empty".to_string())?;
    let mut next = normalize_rules(rules);
    let bucket = match action {
        "allow" => &mut next.allow,
        "deny" => &mut next.deny,
        "ask" => &mut next.ask,
        _ => unreachable!(),
    };
    bucket.retain(|r| r != &rule);
    Ok(next)
}

/// Parse a TOML string array value (single-line or multi-line-joined): `["a", "b"]`.
pub fn parse_toml_string_array(raw: &str) -> Option<Vec<String>> {
    let s = raw.trim();
    let start = s.find('[')?;
    let end = s.rfind(']')?;
    if end <= start {
        return None;
    }
    let inner = &s[start + 1..end];
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_str: Option<char> = None;
    let mut escape = false;
    for ch in inner.chars() {
        if escape {
            match ch {
                'n' => cur.push('\n'),
                'r' => cur.push('\r'),
                't' => cur.push('\t'),
                '\\' => cur.push('\\'),
                '"' => cur.push('"'),
                '\'' => cur.push('\''),
                c => cur.push(c),
            }
            escape = false;
            continue;
        }
        if let Some(q) = in_str {
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == q {
                out.push(cur.clone());
                cur.clear();
                in_str = None;
            } else {
                cur.push(ch);
            }
            continue;
        }
        match ch {
            '"' | '\'' => in_str = Some(ch),
            ',' | ' ' | '\t' | '\n' | '\r' => {}
            _ => {}
        }
    }
    Some(out)
}

/// Extract `allow` / `deny` / `ask` string arrays under `[permission]`.
///
/// Does not interpret structured `rules = [{ … }]` tables — those stay on disk.
pub fn parse_permission_rules(text: &str) -> PermissionRules {
    let mut rules = PermissionRules::default();
    let mut in_permission = false;
    let mut collecting_key: Option<&'static str> = None;
    let mut buf = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(key) = collecting_key {
            buf.push(' ');
            buf.push_str(trimmed);
            if trimmed.contains(']') {
                if let Some(arr) = parse_toml_string_array(&buf) {
                    assign_bucket(&mut rules, key, arr);
                }
                collecting_key = None;
                buf.clear();
            }
            continue;
        }

        if trimmed.starts_with('[') {
            // Leave nested tables (none expected under [permission] for compact form).
            in_permission = trimmed == "[permission]";
            continue;
        }
        if !in_permission {
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let val = trimmed[eq + 1..].trim();
        let action = match key {
            "allow" => "allow",
            "deny" => "deny",
            "ask" => "ask",
            _ => continue,
        };
        if val.contains('[') && !val.contains(']') {
            collecting_key = Some(action);
            buf = val.to_string();
        } else if let Some(arr) = parse_toml_string_array(val) {
            assign_bucket(&mut rules, action, arr);
        }
    }

    normalize_rules(&rules)
}

fn assign_bucket(rules: &mut PermissionRules, action: &str, arr: Vec<String>) {
    match action {
        "allow" => rules.allow = arr,
        "deny" => rules.deny = arr,
        "ask" => rules.ask = arr,
        _ => {}
    }
}

/// Format one string array as multi-line TOML (or `[]` when empty).
pub fn format_string_array(key: &str, items: &[String]) -> String {
    if items.is_empty() {
        return format!("{key} = []");
    }
    let mut out = String::new();
    out.push_str(key);
    out.push_str(" = [\n");
    for item in items {
        out.push_str("    ");
        out.push_str(&toml_quote(item));
        out.push_str(",\n");
    }
    out.push(']');
    out
}

/// Format the three compact keys for injection under `[permission]`.
pub fn format_permission_rule_lines(rules: &PermissionRules) -> Vec<String> {
    let n = normalize_rules(rules);
    // Documented severity order for humans editing the file.
    vec![
        format_string_array("deny", &n.deny),
        format_string_array("ask", &n.ask),
        format_string_array("allow", &n.allow),
    ]
}

/// Upsert `allow` / `deny` / `ask` under `[permission]` without wiping other
/// sections or other keys inside `[permission]` (e.g. structured `rules`).
pub fn set_permission_rules_in_toml(text: &str, rules: &PermissionRules) -> String {
    let rules = normalize_rules(rules);
    let inject_lines = format_permission_rule_lines(&rules);

    let mut out: Vec<String> = Vec::new();
    let mut in_permission = false;
    let mut permission_found = false;
    let mut injected = false;
    let mut skipping_array = false;

    for line in text.lines() {
        let trimmed = line.trim();

        if skipping_array {
            if trimmed.contains(']') {
                skipping_array = false;
            }
            continue;
        }

        if crate::agent_home_config::parse_table_header(trimmed).is_some() {
            if in_permission && !injected {
                for l in &inject_lines {
                    out.push(l.clone());
                }
                injected = true;
            }
            // Accept trailing comments: `[permission] # rules`
            in_permission = matches!(
                crate::agent_home_config::parse_table_header(trimmed),
                Some((false, "permission"))
            );
            if in_permission {
                permission_found = true;
                injected = false;
            }
            out.push(line.to_string());
            continue;
        }

        if in_permission {
            // Drop existing allow/deny/ask assignments (incl. multi-line arrays).
            if let Some(eq) = trimmed.find('=') {
                let key = trimmed[..eq].trim();
                if matches!(key, "allow" | "deny" | "ask") {
                    let val = trimmed[eq + 1..].trim();
                    if val.contains('[') && !val.contains(']') {
                        skipping_array = true;
                    }
                    continue;
                }
            }
            out.push(line.to_string());
            continue;
        }

        out.push(line.to_string());
    }

    if in_permission && !injected {
        for l in &inject_lines {
            out.push(l.clone());
        }
        injected = true;
    }

    if !permission_found {
        let base = out.join("\n");
        let mut block = String::from("[permission]\n");
        for (i, l) in inject_lines.iter().enumerate() {
            if i > 0 {
                block.push('\n');
            }
            block.push_str(l);
        }
        block.push('\n');
        let trimmed = base.trim_end();
        if trimmed.is_empty() {
            return block;
        }
        return format!("{trimmed}\n\n{block}");
    }

    let mut joined = out.join("\n");
    if text.ends_with('\n') || text.is_empty() {
        if !joined.ends_with('\n') {
            joined.push('\n');
        }
    } else if joined.ends_with('\n') {
        joined = joined.trim_end_matches('\n').to_string();
    }
    // Ensure injected block is present (defensive).
    let _ = injected;
    joined
}

/// Config path for the active session data mode.
pub fn permission_config_path(session_data_mode: &str) -> PathBuf {
    if session_data_mode == "shared" {
        resolve_agent_grok_home(session_data_mode).join("config.toml")
    } else {
        let _ = ensure_app_dirs();
        agent_config_toml()
    }
}

/// Load rules from the active GROK_HOME config.toml.
pub fn load_permission_rules() -> Result<PermissionRulesResult, String> {
    let settings = store::load_settings();
    let mode = settings.session_data_mode.clone();
    let path = permission_config_path(&mode);
    let file_exists = path.is_file();
    let text = if file_exists {
        fs::read_to_string(&path).map_err(|e| format!("read config: {e}"))?
    } else {
        String::new()
    };
    let rules = parse_permission_rules(&text);
    Ok(PermissionRulesResult {
        allow: rules.allow,
        deny: rules.deny,
        ask: rules.ask,
        config_path: path.to_string_lossy().to_string(),
        session_data_mode: mode,
        file_exists,
    })
}

/// Replace compact allow/deny/ask arrays and write config safely.
pub fn save_permission_rules(rules: &PermissionRules) -> Result<PermissionRulesResult, String> {
    let settings = store::load_settings();
    let mode = settings.session_data_mode.clone();
    let path = permission_config_path(&mode);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let normalized = normalize_rules(rules);
    let next = set_permission_rules_in_toml(&existing, &normalized);
    fs::write(&path, &next).map_err(|e| format!("write config: {e}"))?;

    // Never log rule text (may include private paths). Counts + path only.
    tracing::info!(
        allow = normalized.allow.len(),
        deny = normalized.deny.len(),
        ask = normalized.ask.len(),
        path = %path.display(),
        "permission_rules: saved compact rules"
    );

    Ok(PermissionRulesResult {
        allow: normalized.allow,
        deny: normalized.deny,
        ask: normalized.ask,
        config_path: path.to_string_lossy().to_string(),
        session_data_mode: mode,
        file_exists: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_and_missing() {
        let r = parse_permission_rules("");
        assert!(r.allow.is_empty() && r.deny.is_empty() && r.ask.is_empty());
        let r = parse_permission_rules("[ui]\nyolo = false\n");
        assert!(r.allow.is_empty());
    }

    #[test]
    fn parse_compact_arrays_single_and_multi() {
        let text = r#"
[ui]
yolo = false

[permission]
deny = ["Bash(rm -rf *)", "Read(/tmp/secret/**)"]
allow = [
    "Bash(git *)",
    "Bash(gh *)",
]
ask = ["Edit"]

[plugins]
enabled = ["x"]
"#;
        let r = parse_permission_rules(text);
        assert_eq!(r.deny, vec!["Bash(rm -rf *)", "Read(/tmp/secret/**)"]);
        assert_eq!(r.allow, vec!["Bash(git *)", "Bash(gh *)"]);
        assert_eq!(r.ask, vec!["Edit"]);
    }

    #[test]
    fn upsert_preserves_other_sections_and_keys() {
        let existing = r#"
[ui]
permission_mode = "default"
yolo = false

[permission]
# keep comment? (comments on own lines stay if not on replaced keys)
rules = [{ action = "allow", tool = "read" }]
allow = ["Bash(old *)"]
deny = ["Bash(rm *)"]

[plugins]
enabled = ["a"]
"#;
        let next = set_permission_rules_in_toml(
            existing,
            &PermissionRules {
                allow: vec!["Bash(git *)".into()],
                deny: vec!["Bash(rm -rf *)".into()],
                ask: vec!["Edit".into()],
            },
        );
        assert!(next.contains("[ui]"), "{next}");
        assert!(next.contains("permission_mode = \"default\""), "{next}");
        assert!(next.contains("[plugins]"), "{next}");
        assert!(next.contains("enabled = [\"a\"]"), "{next}");
        // Structured rules key preserved.
        assert!(
            next.contains("rules = [{ action = \"allow\", tool = \"read\" }]"),
            "{next}"
        );
        assert!(next.contains("Bash(git *)"), "{next}");
        assert!(next.contains("Bash(rm -rf *)"), "{next}");
        assert!(next.contains("Edit"), "{next}");
        assert!(!next.contains("Bash(old *)"), "{next}");
        // Only one of each compact key.
        assert_eq!(next.matches("allow =").count(), 1, "{next}");
        assert_eq!(next.matches("deny =").count(), 1, "{next}");
        assert_eq!(next.matches("ask =").count(), 1, "{next}");

        let parsed = parse_permission_rules(&next);
        assert_eq!(parsed.allow, vec!["Bash(git *)"]);
        assert_eq!(parsed.deny, vec!["Bash(rm -rf *)"]);
        assert_eq!(parsed.ask, vec!["Edit"]);
    }

    #[test]
    fn upsert_appends_section_when_missing() {
        let base = "[ui]\nyolo = false\n";
        let next = set_permission_rules_in_toml(
            base,
            &PermissionRules {
                allow: vec!["Read".into()],
                deny: vec![],
                ask: vec![],
            },
        );
        assert!(next.contains("[ui]"));
        assert!(next.contains("[permission]"));
        assert!(next.contains("allow = ["));
        assert!(next.contains("\"Read\""));
        assert!(next.contains("deny = []"));
        assert!(next.contains("ask = []"));
    }

    #[test]
    fn roundtrip_empty_clears_arrays() {
        let existing = r#"
[permission]
allow = ["Bash(git *)"]
deny = ["Bash(rm *)"]
ask = ["Edit"]
"#;
        let next = set_permission_rules_in_toml(existing, &PermissionRules::default());
        let parsed = parse_permission_rules(&next);
        assert!(parsed.allow.is_empty());
        assert!(parsed.deny.is_empty());
        assert!(parsed.ask.is_empty());
        assert!(next.contains("allow = []"));
        assert!(next.contains("deny = []"));
        assert!(next.contains("ask = []"));
    }

    #[test]
    fn add_remove_rule_pure() {
        let base = PermissionRules::default();
        let a = add_rule(&base, "deny", "  Bash(rm *)  ").unwrap();
        assert_eq!(a.deny, vec!["Bash(rm *)"]);
        // Dedupe
        let a2 = add_rule(&a, "deny", "Bash(rm *)").unwrap();
        assert_eq!(a2.deny.len(), 1);
        let b = add_rule(&a2, "allow", "Bash(git *)").unwrap();
        let c = remove_rule(&b, "deny", "Bash(rm *)").unwrap();
        assert!(c.deny.is_empty());
        assert_eq!(c.allow, vec!["Bash(git *)"]);
        assert!(add_rule(&base, "nope", "x").is_err());
        assert!(add_rule(&base, "allow", "   ").is_err());
    }

    #[test]
    fn toml_quote_escapes() {
        assert_eq!(toml_quote(r#"a"b"#), r#""a\"b""#);
        assert_eq!(toml_quote(r"a\b"), r#""a\\b""#);
    }

    #[test]
    fn normalize_action_and_dedupe() {
        assert_eq!(normalize_action("ALLOW"), Some("allow"));
        assert_eq!(normalize_action("Ask"), Some("ask"));
        assert!(normalize_action("maybe").is_none());
        let d = dedupe_rules(&["a".into(), " a ".into(), "b".into(), "".into()]);
        assert_eq!(d, vec!["a", "b"]);
    }
}
