//! Discover selectable Grok Build agent definition names for Settings.
//!
//! Sources mirror CLI `--agent <NAME>` resolution:
//! - Built-ins: explore, plan, general-purpose
//! - User: `~/.grok/agents/*.md` (+ active GROK_HOME / agent-home agents)
//! - Project: `<cwd>/.grok/agents/*.md`
//! - Bundled reference: `~/.grok/bundled/agents/*.md` (same names as built-ins)
//!
//! Scaffold: create a SKILL-like `{Name}.md` under the active agent home or
//! project `.grok/agents` (path-scoped; no overwrite unless `force`).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths::resolve_agent_grok_home;
use crate::store;

/// Well-known built-in agent names (always listed even if files are missing).
pub const BUILTIN_AGENT_NAMES: &[&str] = &["explore", "general-purpose", "plan"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentCatalogSource {
    Builtin,
    User,
    Project,
    Bundled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogEntry {
    pub name: String,
    pub source: AgentCatalogSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsCatalogResult {
    pub agents: Vec<AgentCatalogEntry>,
    pub user_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    pub bundled_dir: String,
}

/// Pure: normalize settings value → spawn name, or `None` for CLI default.
pub fn normalize_preferred_agent(raw: &str) -> Option<String> {
    let name = raw.trim();
    if name.is_empty() {
        return None;
    }
    let lower = name.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "default" | "none" | "cli-default" | "grok-build"
    ) {
        return None;
    }
    if name.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return None;
    }
    Some(name.to_string())
}

/// Pure: top-level CLI args `["--agent", name]` when set.
#[allow(dead_code)]
pub fn agent_spawn_cli_args(raw: &str) -> Option<Vec<String>> {
    let name = normalize_preferred_agent(raw)?;
    Some(vec!["--agent".into(), name])
}

/// Pure: normalize Settings → Agent profile path for spawn.
/// Empty / control chars → `None` (omit `--agent-profile`).
/// Does not check filesystem existence.
pub fn normalize_agent_profile_path(raw: &str) -> Option<String> {
    let path = raw.trim();
    if path.is_empty() {
        return None;
    }
    if path.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return None;
    }
    Some(path.to_string())
}

/// Pure: agent-option CLI args `["--agent-profile", path]` when set.
/// Placement: after `grok agent` and before `stdio` (not top-level).
#[allow(dead_code)]
pub fn agent_profile_spawn_cli_args(raw: &str) -> Option<Vec<String>> {
    let path = normalize_agent_profile_path(raw)?;
    Some(vec!["--agent-profile".into(), path])
}

/// Soft cap for Settings / spawn argv (~64 KiB).
pub const AGENTS_JSON_MAX_CHARS: usize = 64 * 1024;

/// Pure: validate + normalize inline agents JSON for Settings / spawn.
///
/// - Blank → `Ok("")` (omit `--agents`)
/// - Valid JSON **object** map → `Ok(compact)` for storage / CLI
/// - Invalid syntax, non-object, or too large → `Err(message)`
///
/// CLI currently expects a map (`--agents: … expected a map`); arrays and
/// primitives are rejected so save fails honestly instead of at next spawn.
pub fn normalize_agents_json(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > AGENTS_JSON_MAX_CHARS {
        return Err(format!(
            "Agents JSON is too large (max {AGENTS_JSON_MAX_CHARS} characters)."
        ));
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|_| "Invalid JSON — fix syntax before saving.".to_string())?;
    if !value.is_object() {
        return Err("Agents JSON must be a JSON object map (e.g. {\"reviewer\":{…}}).".into());
    }
    let compact = serde_json::to_string(&value)
        .map_err(|_| "Invalid JSON — fix syntax before saving.".to_string())?;
    if compact.len() > AGENTS_JSON_MAX_CHARS {
        return Err(format!(
            "Agents JSON is too large (max {AGENTS_JSON_MAX_CHARS} characters)."
        ));
    }
    Ok(compact)
}

/// Pure: top-level CLI args `["--agents", json]` when set.
/// Empty / invalid → `None` (omit flag; invalid should not reach spawn).
pub fn agents_json_spawn_cli_args(raw: &str) -> Option<Vec<String>> {
    match normalize_agents_json(raw) {
        Ok(s) if !s.is_empty() => Some(vec!["--agents".into(), s]),
        _ => None,
    }
}

/// File stem for agent def (`explore.md` → `explore`).
pub fn agent_name_from_file_name(file_name: &str) -> Option<String> {
    let base = Path::new(file_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name)
        .trim();
    if base.is_empty() || base.starts_with('.') {
        return None;
    }
    let lower = base.to_ascii_lowercase();
    let stem = if let Some(s) = lower.strip_suffix(".markdown") {
        &base[..s.len()]
    } else {
        let s = lower.strip_suffix(".md")?;
        &base[..s.len()]
    };
    let stem = stem.trim();
    if stem.is_empty() || stem.eq_ignore_ascii_case("readme") {
        return None;
    }
    Some(stem.to_string())
}

fn is_agent_md(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .and_then(agent_name_from_file_name)
        .is_some()
}

fn scan_agent_dir(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        if !is_agent_md(&path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(agent_name_from_file_name);
        if let Some(name) = name {
            out.push((name, path));
        }
    }
    out.sort_by_key(|a| a.0.to_ascii_lowercase());
    out
}

/// Pure merge: project > user > bundled file > builtin name-only.
pub fn merge_agent_catalog(
    builtins: &[&str],
    user: &[(String, PathBuf)],
    project: &[(String, PathBuf)],
    bundled: &[(String, PathBuf)],
) -> Vec<AgentCatalogEntry> {
    use std::collections::BTreeMap;
    // BTreeMap keyed by lowercase name for stable sort of keys; we re-sort at end by display name.
    let mut map: BTreeMap<String, AgentCatalogEntry> = BTreeMap::new();

    for name in builtins {
        let n = name.trim();
        if n.is_empty() {
            continue;
        }
        map.insert(
            n.to_ascii_lowercase(),
            AgentCatalogEntry {
                name: n.to_string(),
                source: AgentCatalogSource::Builtin,
                path: None,
            },
        );
    }

    for (name, path) in bundled {
        map.insert(
            name.to_ascii_lowercase(),
            AgentCatalogEntry {
                name: name.clone(),
                source: AgentCatalogSource::Bundled,
                path: Some(path.display().to_string()),
            },
        );
    }

    for (name, path) in user {
        map.insert(
            name.to_ascii_lowercase(),
            AgentCatalogEntry {
                name: name.clone(),
                source: AgentCatalogSource::User,
                path: Some(path.display().to_string()),
            },
        );
    }

    for (name, path) in project {
        map.insert(
            name.to_ascii_lowercase(),
            AgentCatalogEntry {
                name: name.clone(),
                source: AgentCatalogSource::Project,
                path: Some(path.display().to_string()),
            },
        );
    }

    let mut agents: Vec<_> = map.into_values().collect();
    agents.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    agents
}

fn user_grok_home() -> PathBuf {
    crate::process_util::user_home().join(".grok")
}

/// Live catalog for Settings agent picker.
pub fn list_agents_catalog(project_path: Option<&str>) -> AgentsCatalogResult {
    let grok = user_grok_home();
    let user_dir = grok.join("agents");
    let bundled_dir = grok.join("bundled").join("agents");
    let project_dir = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|p| PathBuf::from(p).join(".grok").join("agents"));

    let mut user = scan_agent_dir(&user_dir);
    // Independent mode GROK_HOME may differ from ~/.grok — include those defs.
    let settings = store::load_settings();
    let active_home = resolve_agent_grok_home(&settings.session_data_mode);
    let active_agents = active_home.join("agents");
    if active_agents != user_dir {
        for entry in scan_agent_dir(&active_agents) {
            if !user.iter().any(|(n, _)| n.eq_ignore_ascii_case(&entry.0)) {
                user.push(entry);
            }
        }
    }
    let bundled = scan_agent_dir(&bundled_dir);
    let project = project_dir
        .as_ref()
        .map(|d| scan_agent_dir(d))
        .unwrap_or_default();

    let agents = merge_agent_catalog(BUILTIN_AGENT_NAMES, &user, &project, &bundled);

    AgentsCatalogResult {
        agents,
        user_dir: user_dir.display().to_string(),
        project_dir: project_dir.map(|p| p.display().to_string()),
        bundled_dir: bundled_dir.display().to_string(),
    }
}

// ── Scaffold (create agent definition markdown) ─────────────────────────────

const AGENT_STEM_NAME_MAX: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsScaffoldResult {
    pub name: String,
    pub path: String,
    pub scope: String,
    pub created: bool,
    pub overwritten: bool,
}

/// Pure: sanitize agent file stem for filesystem + CLI `--agent`.
/// Mirrors `src/lib/agentsDiscovery.ts` `sanitizeAgentFileStemName`.
pub fn sanitize_agent_file_stem_name(raw: &str) -> Result<String, String> {
    // Collapse whitespace runs to a single hyphen (no leading hyphen from spaces).
    let name = {
        let trimmed = raw.trim();
        let mut out = String::with_capacity(trimmed.len());
        let mut prev_hyphen = false;
        for ch in trimmed.chars() {
            if ch.is_whitespace() {
                if !prev_hyphen && !out.is_empty() {
                    out.push('-');
                    prev_hyphen = true;
                }
            } else {
                out.push(ch);
                prev_hyphen = ch == '-';
            }
        }
        // Drop a single trailing hyphen left by trailing spaces only.
        if out.ends_with('-') {
            let before = out.trim_end_matches('-');
            // Keep intentional trailing hyphens that were not from whitespace collapse
            // only when the raw ended with '-'; otherwise strip padding hyphens.
            if !trimmed.ends_with('-') {
                out = before.to_string();
            }
        }
        out
    };
    if name.is_empty() {
        return Err("agent name is required".into());
    }
    if name == "." || name == ".." {
        return Err("invalid agent name".into());
    }
    if name.len() > AGENT_STEM_NAME_MAX {
        return Err(format!("agent name too long (max {AGENT_STEM_NAME_MAX})"));
    }
    if name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name.contains('\n')
        || name.contains('\r')
    {
        return Err("agent name must not contain path separators".into());
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return Err("agent name may only contain letters, digits, '.', '_' and '-'".into());
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err("agent name may only contain letters, digits, '.', '_' and '-'".into());
    }
    if name.eq_ignore_ascii_case("readme") {
        return Err("reserved agent name".into());
    }
    Ok(name)
}

/// Pure: default SKILL-like agent markdown body (no secrets).
pub fn default_agent_markdown_template(
    name: &str,
    description: Option<&str>,
) -> Result<String, String> {
    let stem = sanitize_agent_file_stem_name(name)?;
    let desc = description
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_else(|| {
            format!(
                "Custom agent definition for `{stem}`. Edit when to use it and preferred tools — do not put secrets here."
            )
        });
    Ok(format!(
        r#"---
name: {stem}
description: >
  {desc}
prompt_mode: full
agents_md: true
---

You are the **{stem}** agent.

## Role

Describe this agent's specialist role and when the parent session should delegate to it.

## Strengths

- Focused task execution within the declared scope
- Prefer existing project conventions and patterns
- Small, reviewable changes

## Guidelines

- Prefer read/search tools before editing.
- Match existing style; avoid unrelated refactors.
- Do not commit secrets, auth tokens, or local credentials.
- Stay within the workspace unless the user asks otherwise.

## Tools hints

- Use list/search/read tools to orient before writes.
- Prefer targeted edits over broad rewrites.
- Report absolute paths and concise findings when returning to the parent.

Workspace boundary:
- Default scope is the active project workspace.
- Do not expand search outside the workspace unless asked.
"#
    ))
}

/// Resolve writable agents directory for scaffold scope.
///
/// - `user` → `{resolve_agent_grok_home}/agents`
/// - `project` → `{project}/.grok/agents` (requires project_path)
fn resolve_scaffold_agents_dir(
    scope: &str,
    project_path: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let scope = scope.trim().to_ascii_lowercase();
    match scope.as_str() {
        "user" | "" => {
            let settings = store::load_settings();
            let home = resolve_agent_grok_home(&settings.session_data_mode);
            Ok((home.join("agents"), "user".into()))
        }
        "project" => {
            let proj = project_path
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project path required for project scope".to_string())?;
            if proj.contains('\0') {
                return Err("invalid project path".into());
            }
            let root = PathBuf::from(proj);
            // Refuse path traversal noise in project path segments.
            if root
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("invalid project path".into());
            }
            Ok((root.join(".grok").join("agents"), "project".into()))
        }
        other => Err(format!("unknown agent scope: {other}")),
    }
}

/// Create `{name}.md` under the scoped agents dir. Path-scoped only.
/// Rejects overwrite unless `force` is true.
pub fn scaffold_agent(
    name: &str,
    scope: &str,
    project_path: Option<&str>,
    force: bool,
    description: Option<&str>,
) -> Result<AgentsScaffoldResult, String> {
    let stem = sanitize_agent_file_stem_name(name)?;
    let (dir, scope_label) = resolve_scaffold_agents_dir(scope, project_path)?;
    let path = dir.join(format!("{stem}.md"));

    // Ensure we never write outside the intended agents directory.
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path not allowed: traversal".into());
    }
    if path.parent() != Some(dir.as_path()) {
        return Err("path not allowed: outside agents directory".into());
    }

    let exists = path.is_file();
    if exists && !force {
        return Err(format!(
            "agent already exists: {} (pass force to overwrite)",
            path.display()
        ));
    }

    fs::create_dir_all(&dir).map_err(|e| format!("could not create agents dir: {e}"))?;
    let body = default_agent_markdown_template(&stem, description)?;
    fs::write(&path, body.as_bytes()).map_err(|e| format!("could not write agent file: {e}"))?;

    Ok(AgentsScaffoldResult {
        name: stem,
        path: path.display().to_string(),
        scope: scope_label,
        created: !exists,
        overwritten: exists && force,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn normalize_empty_and_sentinels() {
        assert!(normalize_preferred_agent("").is_none());
        assert!(normalize_preferred_agent("  ").is_none());
        assert!(normalize_preferred_agent("default").is_none());
        assert!(normalize_preferred_agent("NONE").is_none());
        assert!(normalize_preferred_agent("grok-build").is_none());
        assert!(normalize_preferred_agent("cli-default").is_none());
        assert!(normalize_preferred_agent("ex\nplore").is_none());
    }

    #[test]
    fn normalize_keeps_names() {
        assert_eq!(
            normalize_preferred_agent("  explore  ").as_deref(),
            Some("explore")
        );
        assert_eq!(
            normalize_preferred_agent("general-purpose").as_deref(),
            Some("general-purpose")
        );
        assert_eq!(
            normalize_preferred_agent("/tmp/a.md").as_deref(),
            Some("/tmp/a.md")
        );
    }

    #[test]
    fn spawn_args_top_level() {
        assert!(agent_spawn_cli_args("").is_none());
        assert!(agent_spawn_cli_args("default").is_none());
        assert_eq!(
            agent_spawn_cli_args("explore"),
            Some(vec!["--agent".into(), "explore".into()])
        );
        assert_eq!(
            agent_spawn_cli_args("  plan  "),
            Some(vec!["--agent".into(), "plan".into()])
        );
    }

    #[test]
    fn normalize_agent_profile_path_empty_and_controls() {
        assert!(normalize_agent_profile_path("").is_none());
        assert!(normalize_agent_profile_path("  ").is_none());
        assert!(normalize_agent_profile_path("/tmp/a\nb.md").is_none());
        assert!(normalize_agent_profile_path("x\0y").is_none());
    }

    #[test]
    fn normalize_agent_profile_path_trims() {
        assert_eq!(
            normalize_agent_profile_path("  /tmp/my-agent.md  ").as_deref(),
            Some("/tmp/my-agent.md")
        );
        assert_eq!(
            normalize_agent_profile_path("./agents/custom.md").as_deref(),
            Some("./agents/custom.md")
        );
    }

    #[test]
    fn agent_profile_spawn_args() {
        assert!(agent_profile_spawn_cli_args("").is_none());
        assert_eq!(
            agent_profile_spawn_cli_args("  /tmp/a.md  "),
            Some(vec!["--agent-profile".into(), "/tmp/a.md".into()])
        );
    }

    #[test]
    fn normalize_agents_json_empty() {
        assert_eq!(normalize_agents_json("").as_deref(), Ok(""));
        assert_eq!(normalize_agents_json("  \n").as_deref(), Ok(""));
    }

    #[test]
    fn normalize_agents_json_object() {
        assert_eq!(
            normalize_agents_json(r#"  { "a": { "prompt": "x" } }  "#).as_deref(),
            Ok(r#"{"a":{"prompt":"x"}}"#)
        );
        assert_eq!(normalize_agents_json("{}").as_deref(), Ok("{}"));
    }

    #[test]
    fn normalize_agents_json_rejects_bad_shapes() {
        assert!(normalize_agents_json("{").is_err());
        assert!(normalize_agents_json("[]").is_err());
        assert!(normalize_agents_json("null").is_err());
        assert!(normalize_agents_json(r#""x""#).is_err());
        assert!(normalize_agents_json("1").is_err());
    }

    #[test]
    fn normalize_agents_json_size_cap() {
        let big = format!(r#"{{"a":"{}"}}"#, "x".repeat(AGENTS_JSON_MAX_CHARS));
        assert!(normalize_agents_json(&big).is_err());
    }

    #[test]
    fn agents_json_spawn_args() {
        assert!(agents_json_spawn_cli_args("").is_none());
        assert!(agents_json_spawn_cli_args("[]").is_none());
        assert_eq!(
            agents_json_spawn_cli_args(r#"  {"x":1}  "#),
            Some(vec!["--agents".into(), r#"{"x":1}"#.into()])
        );
    }

    #[test]
    fn file_name_stems() {
        assert_eq!(
            agent_name_from_file_name("explore.md").as_deref(),
            Some("explore")
        );
        assert_eq!(
            agent_name_from_file_name("my.markdown").as_deref(),
            Some("my")
        );
        assert!(agent_name_from_file_name("x.txt").is_none());
        assert!(agent_name_from_file_name(".hidden.md").is_none());
        assert!(agent_name_from_file_name("README.md").is_none());
        assert_eq!(
            agent_name_from_file_name("/a/b/plan.md").as_deref(),
            Some("plan")
        );
    }

    #[test]
    fn merge_priority_project_user_bundled_builtin() {
        let user = vec![(
            "explore".into(),
            PathBuf::from("/u/.grok/agents/explore.md"),
        )];
        let project = vec![(
            "explore".into(),
            PathBuf::from("/p/.grok/agents/explore.md"),
        )];
        let bundled = vec![(
            "plan".into(),
            PathBuf::from("/u/.grok/bundled/agents/plan.md"),
        )];
        let custom = vec![("custom".into(), PathBuf::from("/u/.grok/agents/custom.md"))];
        let user_all = [user, custom].concat();
        let agents = merge_agent_catalog(BUILTIN_AGENT_NAMES, &user_all, &project, &bundled);
        let by: std::collections::HashMap<_, _> =
            agents.into_iter().map(|e| (e.name.clone(), e)).collect();
        assert_eq!(by["explore"].source, AgentCatalogSource::Project);
        assert_eq!(
            by["explore"].path.as_deref(),
            Some("/p/.grok/agents/explore.md")
        );
        assert_eq!(by["custom"].source, AgentCatalogSource::User);
        assert_eq!(by["plan"].source, AgentCatalogSource::Bundled);
        assert_eq!(by["general-purpose"].source, AgentCatalogSource::Builtin);
        assert!(by["general-purpose"].path.is_none());
    }

    #[test]
    fn sanitize_stem_ok() {
        assert_eq!(
            sanitize_agent_file_stem_name("  my agent  ").as_deref(),
            Ok("my-agent")
        );
        assert_eq!(
            sanitize_agent_file_stem_name("general-purpose").as_deref(),
            Ok("general-purpose")
        );
        assert_eq!(
            sanitize_agent_file_stem_name("My.Agent_1").as_deref(),
            Ok("My.Agent_1")
        );
    }

    #[test]
    fn sanitize_stem_rejects() {
        assert!(sanitize_agent_file_stem_name("").is_err());
        assert!(sanitize_agent_file_stem_name("a/b").is_err());
        assert!(sanitize_agent_file_stem_name("-sneaky").is_err());
        assert!(sanitize_agent_file_stem_name("README").is_err());
        assert!(sanitize_agent_file_stem_name("has!").is_err());
        assert!(sanitize_agent_file_stem_name(&"x".repeat(65)).is_err());
    }

    #[test]
    fn template_has_frontmatter_no_secrets() {
        let md = default_agent_markdown_template("code-review", None).unwrap();
        assert!(md.starts_with("---\n"));
        assert!(md.contains("name: code-review"));
        assert!(md.contains("prompt_mode: full"));
        assert!(md.contains("You are the **code-review** agent."));
        assert!(md.contains("Tools hints"));
        let lower = md.to_ascii_lowercase();
        assert!(!lower.contains("api_key"));
        assert!(!lower.contains("sk-"));
    }

    #[test]
    fn scaffold_creates_and_rejects_overwrite() {
        let dir =
            std::env::temp_dir().join(format!("grok-app-agents-scaffold-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let project = dir.join("proj");
        fs::create_dir_all(&project).unwrap();

        let r1 = scaffold_agent(
            "demo-agent",
            "project",
            Some(project.to_str().unwrap()),
            false,
            Some("Demo only"),
        )
        .unwrap();
        assert!(r1.created);
        assert!(!r1.overwritten);
        assert_eq!(r1.name, "demo-agent");
        assert_eq!(r1.scope, "project");
        assert!(Path::new(&r1.path).is_file());
        let body = fs::read_to_string(&r1.path).unwrap();
        assert!(body.contains("name: demo-agent"));
        assert!(body.contains("Demo only"));

        let err = scaffold_agent(
            "demo-agent",
            "project",
            Some(project.to_str().unwrap()),
            false,
            None,
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "{err}");

        let r2 = scaffold_agent(
            "demo-agent",
            "project",
            Some(project.to_str().unwrap()),
            true,
            Some("Overwritten"),
        )
        .unwrap();
        assert!(!r2.created);
        assert!(r2.overwritten);
        let body2 = fs::read_to_string(&r2.path).unwrap();
        assert!(body2.contains("Overwritten"));

        let _ = fs::remove_dir_all(&dir);
    }
}
