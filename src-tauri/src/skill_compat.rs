//! Claude / Cursor compat skill discovery for Settings → Extensions → Skills.
//!
//! `grok inspect` can still list `~/.claude` / `~/.cursor` skills after the
//! user sets `[compat.claude] skills = false` (or the App overlay is off).
//! Filter the App catalog so it matches Grok Build's live discovery.

use serde::{Deserialize, Serialize};

use crate::agent_config_view::{config_toml_path, normalize_mode};
use crate::agent_home_config::{get_table_bool, set_table_bool, update_config_toml_if_independent};
use crate::extensions::{self, ExtensionsPrefs};
use crate::paths::resolve_agent_grok_home;
use crate::store;

/// App + config.toml flags that decide whether compat skills stay visible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoverFlags {
    /// `extensions.json` overlay. `false` hides both vendors in the App.
    pub app_pref: bool,
    /// `[compat.claude] skills` when present.
    pub claude_skills: Option<bool>,
    /// `[compat.cursor] skills` when present.
    pub cursor_skills: Option<bool>,
}

impl DiscoverFlags {
    pub fn allow_claude(&self) -> bool {
        self.app_pref && self.claude_skills != Some(false)
    }

    pub fn allow_cursor(&self) -> bool {
        self.app_pref && self.cursor_skills != Some(false)
    }

    pub fn effective(&self) -> bool {
        self.allow_claude() && self.allow_cursor()
    }
}

/// Snapshot returned with `skills_list` / `skills_compat_set`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillsCompatSnapshot {
    pub app_pref: bool,
    pub claude_skills: Option<bool>,
    pub cursor_skills: Option<bool>,
    pub effective: bool,
    pub hidden_count: u32,
    /// `independent` | `shared`
    pub mode: String,
    /// True only when independent (App may write agent-home config.toml).
    pub writable: bool,
    pub path: String,
    pub file_exists: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatSkillKind {
    Claude,
    Cursor,
}

fn normalize_fs_path(path: &str) -> String {
    path.trim().replace('\\', "/").to_ascii_lowercase()
}

fn normalize_source(source: &str) -> String {
    source.trim().to_ascii_lowercase()
}

/// Classify a skill as Claude/Cursor compat from source or path.
pub fn compat_skill_kind(source: &str, path: Option<&str>) -> Option<CompatSkillKind> {
    let src = normalize_source(source);
    if src == "claude" || src.starts_with("claude") {
        return Some(CompatSkillKind::Claude);
    }
    if src == "cursor" || src.starts_with("cursor") {
        return Some(CompatSkillKind::Cursor);
    }
    let raw = path.map(str::trim).filter(|s| !s.is_empty())?;
    let p = normalize_fs_path(raw);
    if p.contains("/.claude/skills/")
        || p.contains("/.claude/commands/")
        || p.ends_with("/.claude/skills")
        || p.ends_with("/.claude/commands")
    {
        return Some(CompatSkillKind::Claude);
    }
    if p.contains("/.cursor/skills/")
        || p.contains("/.cursor/commands/")
        || p.ends_with("/.cursor/skills")
        || p.ends_with("/.cursor/commands")
    {
        return Some(CompatSkillKind::Cursor);
    }
    None
}

pub fn should_keep_skill(source: &str, path: Option<&str>, flags: &DiscoverFlags) -> bool {
    match compat_skill_kind(source, path) {
        Some(CompatSkillKind::Claude) => flags.allow_claude(),
        Some(CompatSkillKind::Cursor) => flags.allow_cursor(),
        None => true,
    }
}

pub fn parse_compat_skill_flags(text: &str) -> (Option<bool>, Option<bool>) {
    (
        get_table_bool(text, "compat.claude", "skills"),
        get_table_bool(text, "compat.cursor", "skills"),
    )
}

fn app_pref_from(prefs: &ExtensionsPrefs) -> bool {
    prefs.discover_external_skills != Some(false)
}

/// Read App overlay + active GROK_HOME config.toml (never invents missing keys).
pub fn load_discover_flags() -> DiscoverFlags {
    let prefs = extensions::load_prefs();
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    let path = config_toml_path(mode);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let (claude_skills, cursor_skills) = parse_compat_skill_flags(&text);
    DiscoverFlags {
        app_pref: app_pref_from(&prefs),
        claude_skills,
        cursor_skills,
    }
}

pub fn snapshot_from(flags: &DiscoverFlags, hidden_count: u32) -> SkillsCompatSnapshot {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode).to_string();
    let path = config_toml_path(&mode);
    let file_exists = path.is_file();
    SkillsCompatSnapshot {
        app_pref: flags.app_pref,
        claude_skills: flags.claude_skills,
        cursor_skills: flags.cursor_skills,
        effective: flags.effective(),
        hidden_count,
        writable: mode == "independent",
        path: path.to_string_lossy().to_string(),
        file_exists,
        mode,
    }
}

fn apply_compat_skills_toml(text: &str, enabled: bool) -> String {
    let t = set_table_bool(text, "compat.claude", "skills", enabled);
    set_table_bool(&t, "compat.cursor", "skills", enabled)
}

/// Persist the master toggle. Shared mode updates App overlay only.
pub fn set_discover_external(enabled: bool) -> Result<DiscoverFlags, String> {
    let mut prefs = extensions::load_prefs();
    prefs.discover_external_skills = Some(enabled);
    extensions::save_prefs(&prefs)?;

    let settings = store::load_settings();
    let _ = update_config_toml_if_independent(&settings.session_data_mode, |text| {
        apply_compat_skills_toml(text, enabled)
    })?;
    Ok(load_discover_flags())
}

/// GROK_HOME the inspect CLI should use (same as the live agent).
pub fn inspect_grok_home() -> std::path::PathBuf {
    let settings = store::load_settings();
    resolve_agent_grok_home(&settings.session_data_mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_claude_and_cursor_paths() {
        assert_eq!(
            compat_skill_kind("user", Some("/Users/me/.claude/skills/pdf/SKILL.md")),
            Some(CompatSkillKind::Claude)
        );
        assert_eq!(
            compat_skill_kind("unknown", Some(r"C:\Users\me\.claude\skills\web\SKILL.md")),
            Some(CompatSkillKind::Claude)
        );
        assert_eq!(
            compat_skill_kind("cursor", Some("/tmp/other")),
            Some(CompatSkillKind::Cursor)
        );
        assert_eq!(
            compat_skill_kind("user", Some("/Users/me/.grok/skills/help/SKILL.md")),
            None
        );
        assert_eq!(
            compat_skill_kind("project", Some("D:/work/.grok/skills/local/SKILL.md")),
            None
        );
        assert_eq!(
            compat_skill_kind("user", Some("/Users/me/.agents/skills/portable/SKILL.md")),
            None
        );
    }

    #[test]
    fn missing_flags_keep_compat_skills() {
        let flags = DiscoverFlags {
            app_pref: true,
            claude_skills: None,
            cursor_skills: None,
        };
        assert!(flags.effective());
        assert!(should_keep_skill(
            "user",
            Some("/Users/me/.claude/skills/x/SKILL.md"),
            &flags
        ));
    }

    #[test]
    fn config_false_hides_only_that_vendor() {
        let flags = DiscoverFlags {
            app_pref: true,
            claude_skills: Some(false),
            cursor_skills: None,
        };
        assert!(!flags.allow_claude());
        assert!(flags.allow_cursor());
        assert!(!flags.effective());
        assert!(!should_keep_skill(
            "user",
            Some("/Users/me/.claude/skills/x/SKILL.md"),
            &flags
        ));
        assert!(should_keep_skill(
            "user",
            Some("/Users/me/.cursor/skills/y/SKILL.md"),
            &flags
        ));
        assert!(should_keep_skill(
            "user",
            Some("/Users/me/.grok/skills/help/SKILL.md"),
            &flags
        ));
    }

    #[test]
    fn app_overlay_off_hides_both() {
        let flags = DiscoverFlags {
            app_pref: false,
            claude_skills: Some(true),
            cursor_skills: Some(true),
        };
        assert!(!flags.effective());
        assert!(!should_keep_skill(
            "claude",
            Some("/Users/me/.claude/skills/x/SKILL.md"),
            &flags
        ));
        assert!(!should_keep_skill(
            "cursor",
            Some("/Users/me/.cursor/skills/y/SKILL.md"),
            &flags
        ));
    }

    #[test]
    fn parse_compat_skill_flags_reads_tables() {
        let text =
            "[compat.claude]\nskills = false\nmcps = false\n\n[compat.cursor]\nskills = true\n";
        assert_eq!(parse_compat_skill_flags(text), (Some(false), Some(true)));
        assert_eq!(parse_compat_skill_flags(""), (None, None));
    }

    #[test]
    fn apply_compat_skills_toml_upserts_both() {
        let next = apply_compat_skills_toml("", false);
        assert!(next.contains("[compat.claude]"));
        assert!(next.contains("[compat.cursor]"));
        assert!(next.contains("skills = false"));
        let on = apply_compat_skills_toml(&next, true);
        assert!(get_table_bool(&on, "compat.claude", "skills") == Some(true));
        assert!(get_table_bool(&on, "compat.cursor", "skills") == Some(true));
    }
}
