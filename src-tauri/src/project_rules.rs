//! Project and user-level instruction files (AGENTS.md, CLAUDE.md, `.grok/rules*`).
//!
//! Home scopes follow the same GROK_HOME ACP spawn injects: Settings
//! `session_data_mode` (`~/.grok` vs App `agent-home`), plus custom-route
//! override. `~/.agents` is listed as a user instruction file. Same-inode
//! case probes (`AGENTS.md` / `Agents.md` / `agents.md` on macOS) collapse
//! to one row. Missing home AGENTS.md files are placeholders, sorted last.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One existing rule file on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuleEntry {
    /// Path relative to project root (`AGENTS.md`, `.grok/rules/x.md`, …).
    /// Home-scope files use the absolute path so the UI does not treat them
    /// as project-relative.
    pub relative_path: String,
    /// Absolute filesystem path.
    pub absolute_path: String,
    /// `agents_md` | `claude_md` | `grok_rules` | `nested_agents`.
    pub kind: String,
    /// Basename for display.
    pub name: String,
    /// Byte size.
    pub size: u64,
    /// Last modified (ms since UNIX epoch); 0 when unavailable.
    pub mtime_ms: u64,
    /// `project` | `user_agents` (`~/.agents`) | `grok_home` (live GROK_HOME).
    pub scope: String,
    /// False when this is a placeholder for a not-yet-created AGENTS.md.
    pub exists: bool,
}

/// Result of scanning a project for rule files.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRulesListResult {
    pub project_path: String,
    pub rules: Vec<ProjectRuleEntry>,
    /// True when any root-level AGENTS / AGENT.md exists.
    pub has_agents_md: bool,
    /// Preferred relative path for the primary agents file (existing or `AGENTS.md`).
    pub preferred_agents_path: String,
}

/// Result of ensuring the AGENTS.md template.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRulesEnsureResult {
    pub project_path: String,
    pub relative_path: String,
    pub absolute_path: String,
    /// True when the file was created by this call.
    pub created: bool,
    /// True when a root agents file already existed (no write).
    pub already_existed: bool,
}

const AGENTS_TEMPLATE: &str = "\
# Project rules

Instructions for coding agents in this repository.

## Layout

- Describe important directories and entry points.

## Commands

- test:
- build:
- lint:

## Conventions

- Prefer small, reviewable changes.
- Match existing style; avoid unrelated refactors.
- Do not commit secrets, auth tokens, or local credentials.
";

const ROOT_AGENTS_NAMES: &[&str] = &[
    "AGENTS.md",
    "Agents.md",
    "agents.md",
    "AGENT.md",
    "Agent.md",
];

const ROOT_CLAUDE_NAMES: &[&str] = &["CLAUDE.md", "Claude.md", "claude.md"];

/// Max depth when walking `.grok/` for nested AGENTS.md / rules trees.
const GROK_WALK_MAX_DEPTH: usize = 6;
/// Cap listed rule files to avoid huge trees.
const MAX_RULE_ENTRIES: usize = 200;

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_rel(path: &str) -> String {
    path.trim()
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn is_agents_name(name: &str) -> bool {
    let n = name.trim().to_ascii_lowercase();
    n == "agents.md" || n == "agent.md"
}

fn is_claude_name(name: &str) -> bool {
    name.trim().eq_ignore_ascii_case("claude.md")
}

/// Pure: classify a project-relative path (mirrors TS `classifyProjectRulePath`).
pub fn classify_rule_path(relative: &str) -> Option<(&'static str, String)> {
    let p = normalize_rel(relative);
    if p.is_empty() {
        return None;
    }
    let name = Path::new(&p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if !p.contains('/') {
        if is_agents_name(&name) {
            return Some(("agents_md", name));
        }
        if is_claude_name(&name) {
            return Some(("claude_md", name));
        }
        return None;
    }

    let lower = p.to_ascii_lowercase();
    if lower == ".grok/rules"
        || lower.starts_with(".grok/rules.")
        || lower.starts_with(".grok/rules/")
    {
        return Some(("grok_rules", name));
    }

    if lower.starts_with(".grok/") && is_agents_name(&name) {
        // Nested agents under .grok, excluding the rules tree (already grok_rules).
        if !(lower == ".grok/rules"
            || lower.starts_with(".grok/rules.")
            || lower.starts_with(".grok/rules/"))
        {
            return Some(("nested_agents", name));
        }
    }

    None
}

fn kind_order(kind: &str) -> u8 {
    match kind {
        "agents_md" => 0,
        "claude_md" => 1,
        "grok_rules" => 2,
        "nested_agents" => 3,
        _ => 9,
    }
}

fn scope_order(scope: &str) -> u8 {
    match scope {
        "project" => 0,
        "grok_home" => 1,
        "user_agents" => 2,
        _ => 9,
    }
}

fn sort_rules(rules: &mut [ProjectRuleEntry]) {
    rules.sort_by(|a, b| {
        // Existing files first; placeholders stay at the bottom.
        b.exists.cmp(&a.exists).then_with(|| {
            scope_order(&a.scope)
                .cmp(&scope_order(&b.scope))
                .then_with(|| kind_order(&a.kind).cmp(&kind_order(&b.kind)))
                .then_with(|| a.relative_path.cmp(&b.relative_path))
        })
    });
}

/// Identity for "same file on disk" so case-insensitive volumes do not list
/// `AGENTS.md` / `Agents.md` / `agents.md` as three rules.
#[cfg_attr(not(unix), allow(unused_variables))]
fn file_identity_key(abs: &Path, meta: &fs::Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let ino = meta.ino();
        if ino != 0 {
            return format!("ino:{}:{}", meta.dev(), ino);
        }
    }
    fs::canonicalize(abs)
        .map(|p| p.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|_| abs.to_string_lossy().to_ascii_lowercase())
}

fn ensure_project_root(project_path: &str) -> Result<PathBuf, String> {
    let root = project_path.trim();
    if root.is_empty() {
        return Err("empty project path".into());
    }
    let pb = PathBuf::from(root);
    if !pb.is_dir() {
        return Err(format!("project path is not a directory: {root}"));
    }
    Ok(pb)
}

fn push_file_entry(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    root: &Path,
    relative: &str,
) {
    if out.len() >= MAX_RULE_ENTRIES {
        return;
    }
    let rel = normalize_rel(relative);
    if rel.is_empty() {
        return;
    }
    let Some((kind, name)) = classify_rule_path(&rel) else {
        return;
    };
    let abs = root.join(Path::new(&rel));
    let meta = match fs::metadata(&abs) {
        Ok(m) if m.is_file() => m,
        _ => return,
    };
    if !seen.insert(file_identity_key(&abs, &meta)) {
        return;
    }
    out.push(ProjectRuleEntry {
        relative_path: rel,
        absolute_path: abs.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        name,
        size: meta.len(),
        mtime_ms: file_mtime_ms(&meta),
        scope: "project".to_string(),
        exists: true,
    });
}

fn push_home_file(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    abs: PathBuf,
    kind: &str,
    name: String,
    scope: &str,
) {
    if out.len() >= MAX_RULE_ENTRIES {
        return;
    }
    let meta = match fs::metadata(&abs) {
        Ok(m) if m.is_file() => m,
        _ => return,
    };
    if !seen.insert(file_identity_key(&abs, &meta)) {
        return;
    }
    let abs_s = abs.to_string_lossy().into_owned();
    out.push(ProjectRuleEntry {
        relative_path: abs_s.clone(),
        absolute_path: abs_s,
        kind: kind.to_string(),
        name,
        size: meta.len(),
        mtime_ms: file_mtime_ms(&meta),
        scope: scope.to_string(),
        exists: true,
    });
}

fn push_missing_home_agents(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    home: &Path,
    scope: &str,
) {
    if out
        .iter()
        .any(|r| r.scope == scope && r.kind == "agents_md" && r.exists)
    {
        return;
    }
    let abs = home.join("AGENTS.md");
    let key = format!("missing:{}", abs.to_string_lossy().to_ascii_lowercase());
    if !seen.insert(key) {
        return;
    }
    let abs_s = abs.to_string_lossy().into_owned();
    out.push(ProjectRuleEntry {
        relative_path: abs_s.clone(),
        absolute_path: abs_s,
        kind: "agents_md".to_string(),
        name: "AGENTS.md".to_string(),
        size: 0,
        mtime_ms: 0,
        scope: scope.to_string(),
        exists: false,
    });
}

/// Scan a user-level instruction root (`~/.agents` or GROK_HOME).
fn scan_home_instruction_root(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    home: &Path,
    scope: &str,
    include_missing_agents: bool,
) {
    if home.is_dir() {
        if let Ok(rd) = fs::read_dir(home) {
            for ent in rd.filter_map(|e| e.ok()) {
                let name = ent.file_name().to_string_lossy().into_owned();
                let abs = home.join(&name);
                if is_agents_name(&name) {
                    push_home_file(out, seen, abs, "agents_md", name, scope);
                } else if is_claude_name(&name) {
                    push_home_file(out, seen, abs, "claude_md", name, scope);
                }
            }
        }
        let rules_dir = home.join("rules");
        if rules_dir.is_dir() {
            if let Ok(rd) = fs::read_dir(&rules_dir) {
                let mut ents: Vec<_> = rd.filter_map(|e| e.ok()).collect();
                ents.sort_by_key(|e| e.file_name());
                for ent in ents {
                    let name = ent.file_name().to_string_lossy().into_owned();
                    if !name.to_ascii_lowercase().ends_with(".md") {
                        continue;
                    }
                    push_home_file(out, seen, rules_dir.join(&name), "grok_rules", name, scope);
                }
            }
        }
    }
    if include_missing_agents {
        push_missing_home_agents(out, seen, home, scope);
    }
}

fn seed_seen(rules: &[ProjectRuleEntry]) -> std::collections::HashSet<String> {
    let mut seen = std::collections::HashSet::new();
    for r in rules {
        if !r.exists {
            seen.insert(format!("missing:{}", r.absolute_path.to_ascii_lowercase()));
            continue;
        }
        let abs = PathBuf::from(&r.absolute_path);
        if let Ok(meta) = fs::metadata(&abs) {
            seen.insert(file_identity_key(&abs, &meta));
        } else {
            seen.insert(r.absolute_path.to_ascii_lowercase());
        }
    }
    seen
}

/// Walk a directory under project root; collect classified rule files.
fn walk_rules(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    root: &Path,
    dir_rel: &str,
    depth: usize,
) {
    if depth > GROK_WALK_MAX_DEPTH || out.len() >= MAX_RULE_ENTRIES {
        return;
    }
    let abs_dir = if dir_rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(Path::new(dir_rel))
    };
    let Ok(rd) = fs::read_dir(&abs_dir) else {
        return;
    };
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for ent in entries {
        if out.len() >= MAX_RULE_ENTRIES {
            break;
        }
        let name = ent.file_name().to_string_lossy().into_owned();
        // Skip hidden junk except `.grok` at root of walk when dir_rel empty is not used for root walk.
        if name == "." || name == ".." {
            continue;
        }
        if name.starts_with('.') && name != ".grok" && dir_rel.is_empty() {
            continue;
        }
        let child_rel = if dir_rel.is_empty() {
            name.clone()
        } else {
            format!("{dir_rel}/{name}")
        };
        // Reject path traversal components.
        if Path::new(&child_rel).components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            continue;
        }
        let Ok(ft) = ent.file_type() else { continue };
        if ft.is_file() {
            push_file_entry(out, seen, root, &child_rel);
        } else if ft.is_dir() {
            // Only recurse into .grok and under .grok/rules (and nested .grok paths).
            let lower = child_rel.to_ascii_lowercase();
            let under_grok = lower == ".grok" || lower.starts_with(".grok/");
            if under_grok {
                walk_rules(out, seen, root, &child_rel, depth + 1);
            }
        }
    }
}

/// List existing project rule files under `project_path`.
pub fn list_project_rules(project_path: &str) -> Result<ProjectRulesListResult, String> {
    let root = ensure_project_root(project_path)?;
    let mut rules: Vec<ProjectRuleEntry> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Root AGENTS / CLAUDE probes (explicit + case variants).
    for name in ROOT_AGENTS_NAMES.iter().chain(ROOT_CLAUDE_NAMES.iter()) {
        push_file_entry(&mut rules, &mut seen, &root, name);
    }

    // Also scan project root for any case variant the probes missed (e.g. AgEnTs.md).
    if let Ok(rd) = fs::read_dir(&root) {
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().into_owned();
            if is_agents_name(&name) || is_claude_name(&name) {
                push_file_entry(&mut rules, &mut seen, &root, &name);
            }
        }
    }

    // Walk `.grok/` for rules* and nested AGENTS.md.
    let grok = root.join(".grok");
    if grok.is_dir() {
        walk_rules(&mut rules, &mut seen, &root, ".grok", 0);
    }

    sort_rules(&mut rules);

    let has_agents_md = rules
        .iter()
        .any(|r| r.scope == "project" && r.kind == "agents_md" && r.exists);
    let preferred_agents_path = rules
        .iter()
        .find(|r| r.scope == "project" && r.kind == "agents_md")
        .map(|r| r.relative_path.clone())
        .unwrap_or_else(|| "AGENTS.md".to_string());

    Ok(ProjectRulesListResult {
        project_path: root.to_string_lossy().into_owned(),
        rules,
        has_agents_md,
        preferred_agents_path,
    })
}

/// Project rules plus user-level instruction files Grok actually loads:
/// `~/.agents` and live `GROK_HOME` (`~/.grok` or App agent-home).
pub fn list_project_rules_with_homes(
    project_path: &str,
    user_agents_home: Option<&Path>,
    grok_home: Option<&Path>,
) -> Result<ProjectRulesListResult, String> {
    let mut listed = list_project_rules(project_path)?;
    let mut seen = seed_seen(&listed.rules);

    if let Some(home) = user_agents_home {
        scan_home_instruction_root(&mut listed.rules, &mut seen, home, "user_agents", true);
    }
    if let Some(home) = grok_home {
        scan_home_instruction_root(&mut listed.rules, &mut seen, home, "grok_home", true);
    }

    sort_rules(&mut listed.rules);
    listed.has_agents_md = listed
        .rules
        .iter()
        .any(|r| r.scope == "project" && r.kind == "agents_md" && r.exists);
    listed.preferred_agents_path = listed
        .rules
        .iter()
        .find(|r| r.scope == "project" && r.kind == "agents_md")
        .map(|r| r.relative_path.clone())
        .unwrap_or_else(|| "AGENTS.md".to_string());
    Ok(listed)
}

/// Create root `AGENTS.md` with a short stub when no root agents file exists.
/// Idempotent: if any root AGENTS/AGENT.md already exists, returns it without writing.
pub fn ensure_agents_template(project_path: &str) -> Result<ProjectRulesEnsureResult, String> {
    let root = ensure_project_root(project_path)?;

    // Prefer an existing root agents file (any case).
    if let Ok(rd) = fs::read_dir(&root) {
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().into_owned();
            if !is_agents_name(&name) {
                continue;
            }
            let abs = root.join(&name);
            if abs.is_file() {
                return Ok(ProjectRulesEnsureResult {
                    project_path: root.to_string_lossy().into_owned(),
                    relative_path: name,
                    absolute_path: abs.to_string_lossy().into_owned(),
                    created: false,
                    already_existed: true,
                });
            }
        }
    }

    let rel = "AGENTS.md".to_string();
    let abs = root.join(&rel);
    if abs.exists() {
        return Ok(ProjectRulesEnsureResult {
            project_path: root.to_string_lossy().into_owned(),
            relative_path: rel,
            absolute_path: abs.to_string_lossy().into_owned(),
            created: false,
            already_existed: true,
        });
    }

    let mut f = fs::File::create(&abs).map_err(|e| format!("create AGENTS.md: {e}"))?;
    f.write_all(AGENTS_TEMPLATE.as_bytes())
        .map_err(|e| format!("write AGENTS.md: {e}"))?;
    f.sync_all().ok();

    Ok(ProjectRulesEnsureResult {
        project_path: root.to_string_lossy().into_owned(),
        relative_path: rel,
        absolute_path: abs.to_string_lossy().into_owned(),
        created: true,
        already_existed: false,
    })
}

/// Create `AGENTS.md` under a user-level home (`~/.agents` or GROK_HOME).
pub fn ensure_home_agents_template(home: &Path) -> Result<ProjectRulesEnsureResult, String> {
    fs::create_dir_all(home).map_err(|e| format!("create agents home: {e}"))?;

    if let Ok(rd) = fs::read_dir(home) {
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().into_owned();
            if !is_agents_name(&name) {
                continue;
            }
            let abs = home.join(&name);
            if abs.is_file() {
                return Ok(ProjectRulesEnsureResult {
                    project_path: home.to_string_lossy().into_owned(),
                    relative_path: abs.to_string_lossy().into_owned(),
                    absolute_path: abs.to_string_lossy().into_owned(),
                    created: false,
                    already_existed: true,
                });
            }
        }
    }

    let abs = home.join("AGENTS.md");
    if abs.exists() {
        return Ok(ProjectRulesEnsureResult {
            project_path: home.to_string_lossy().into_owned(),
            relative_path: abs.to_string_lossy().into_owned(),
            absolute_path: abs.to_string_lossy().into_owned(),
            created: false,
            already_existed: true,
        });
    }

    let mut f = fs::File::create(&abs).map_err(|e| format!("create AGENTS.md: {e}"))?;
    f.write_all(AGENTS_TEMPLATE.as_bytes())
        .map_err(|e| format!("write AGENTS.md: {e}"))?;
    f.sync_all().ok();

    Ok(ProjectRulesEnsureResult {
        project_path: home.to_string_lossy().into_owned(),
        relative_path: abs.to_string_lossy().into_owned(),
        absolute_path: abs.to_string_lossy().into_owned(),
        created: true,
        already_existed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classify_root_and_grok_paths() {
        assert_eq!(
            classify_rule_path("AGENTS.md").map(|x| x.0),
            Some("agents_md")
        );
        assert_eq!(
            classify_rule_path("Agents.md").map(|x| x.0),
            Some("agents_md")
        );
        assert_eq!(
            classify_rule_path("CLAUDE.md").map(|x| x.0),
            Some("claude_md")
        );
        assert_eq!(
            classify_rule_path(".grok/rules.md").map(|x| x.0),
            Some("grok_rules")
        );
        assert_eq!(
            classify_rule_path(".grok/rules/a.md").map(|x| x.0),
            Some("grok_rules")
        );
        assert_eq!(
            classify_rule_path(".grok/x/AGENTS.md").map(|x| x.0),
            Some("nested_agents")
        );
        assert!(classify_rule_path("README.md").is_none());
        assert!(classify_rule_path("docs/AGENTS.md").is_none());
        assert!(classify_rule_path(".grok/config.toml").is_none());
    }

    #[test]
    fn list_and_ensure_template() {
        let dir = std::env::temp_dir().join(format!("grok-app-rules-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".grok/rules")).unwrap();
        fs::create_dir_all(dir.join(".grok/team")).unwrap();
        fs::write(dir.join("CLAUDE.md"), "# c\n").unwrap();
        fs::write(dir.join(".grok/rules/base.md"), "rule\n").unwrap();
        fs::write(dir.join(".grok/team/AGENTS.md"), "nested\n").unwrap();

        let listed = list_project_rules(dir.to_str().unwrap()).unwrap();
        assert!(!listed.has_agents_md);
        let paths: Vec<_> = listed
            .rules
            .iter()
            .map(|r| r.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"CLAUDE.md"));
        assert!(paths.contains(&".grok/rules/base.md"));
        assert!(paths.contains(&".grok/team/AGENTS.md"));

        let ensured = ensure_agents_template(dir.to_str().unwrap()).unwrap();
        assert!(ensured.created);
        assert_eq!(ensured.relative_path, "AGENTS.md");
        assert!(dir.join("AGENTS.md").is_file());

        let again = ensure_agents_template(dir.to_str().unwrap()).unwrap();
        assert!(!again.created);
        assert!(again.already_existed);

        let listed2 = list_project_rules(dir.to_str().unwrap()).unwrap();
        assert!(listed2.has_agents_md);
        let agents: Vec<_> = listed2
            .rules
            .iter()
            .filter(|r| r.kind == "agents_md")
            .map(|r| r.relative_path.as_str())
            .collect();
        assert_eq!(
            agents,
            vec!["AGENTS.md"],
            "case-variant probes must collapse to one on-disk file"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_collapses_root_agents_case_variants_to_one_file() {
        let dir = std::env::temp_dir().join(format!("grok-app-rules-case-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("AGENTS.md"), "# a\n").unwrap();

        let listed = list_project_rules(dir.to_str().unwrap()).unwrap();
        let agents: Vec<_> = listed
            .rules
            .iter()
            .filter(|r| r.kind == "agents_md")
            .map(|r| r.relative_path.as_str())
            .collect();
        assert_eq!(agents, vec!["AGENTS.md"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_with_homes_includes_user_and_grok_home_files() {
        let pid = std::process::id();
        let proj = std::env::temp_dir().join(format!("grok-app-rules-proj-{pid}"));
        let user_agents = std::env::temp_dir().join(format!("grok-app-rules-agents-{pid}"));
        let grok_home = std::env::temp_dir().join(format!("grok-app-rules-home-{pid}"));
        let _ = fs::remove_dir_all(&proj);
        let _ = fs::remove_dir_all(&user_agents);
        let _ = fs::remove_dir_all(&grok_home);
        fs::create_dir_all(&proj).unwrap();
        fs::create_dir_all(user_agents.join("ignored")).unwrap();
        fs::create_dir_all(grok_home.join("rules")).unwrap();
        fs::write(proj.join("AGENTS.md"), "# project\n").unwrap();
        fs::write(user_agents.join("AGENTS.md"), "# user\n").unwrap();
        fs::write(grok_home.join("AGENTS.md"), "# home\n").unwrap();
        fs::write(grok_home.join("rules/global.md"), "rule\n").unwrap();

        let listed = list_project_rules_with_homes(
            proj.to_str().unwrap(),
            Some(user_agents.as_path()),
            Some(grok_home.as_path()),
        )
        .unwrap();
        assert!(listed.has_agents_md);
        let by_scope = |scope: &str| {
            listed
                .rules
                .iter()
                .filter(|r| r.scope == scope && r.kind == "agents_md")
                .count()
        };
        assert_eq!(by_scope("project"), 1);
        assert_eq!(by_scope("user_agents"), 1);
        assert_eq!(by_scope("grok_home"), 1);
        assert!(listed.rules.iter().any(|r| {
            r.scope == "grok_home" && r.kind == "grok_rules" && r.name == "global.md"
        }));
        assert_eq!(listed.rules[0].scope, "project");

        let _ = fs::remove_dir_all(&proj);
        let _ = fs::remove_dir_all(&user_agents);
        let _ = fs::remove_dir_all(&grok_home);
    }

    #[test]
    fn list_with_homes_placeholders_when_missing() {
        let pid = std::process::id();
        let proj = std::env::temp_dir().join(format!("grok-app-rules-empty-proj-{pid}"));
        let user_agents = std::env::temp_dir().join(format!("grok-app-rules-empty-agents-{pid}"));
        let grok_home = std::env::temp_dir().join(format!("grok-app-rules-empty-home-{pid}"));
        let _ = fs::remove_dir_all(&proj);
        let _ = fs::remove_dir_all(&user_agents);
        let _ = fs::remove_dir_all(&grok_home);
        fs::create_dir_all(&proj).unwrap();

        let listed = list_project_rules_with_homes(
            proj.to_str().unwrap(),
            Some(user_agents.as_path()),
            Some(grok_home.as_path()),
        )
        .unwrap();
        assert!(!listed.has_agents_md);
        let missing: Vec<_> = listed
            .rules
            .iter()
            .filter(|r| r.kind == "agents_md" && !r.exists)
            .map(|r| r.scope.as_str())
            .collect();
        assert_eq!(missing, vec!["grok_home", "user_agents"]);

        let created = ensure_home_agents_template(&user_agents).unwrap();
        assert!(created.created);
        assert!(user_agents.join("AGENTS.md").is_file());

        let _ = fs::remove_dir_all(&proj);
        let _ = fs::remove_dir_all(&user_agents);
        let _ = fs::remove_dir_all(&grok_home);
    }
}
