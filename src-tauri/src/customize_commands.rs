//! Typed slash commands as CLI `commands/*.md` files (#1222).
//!
//! User scope writes `{GROK_HOME}/commands/{name}.md` only in independent
//! mode. Shared mode lists `~/.grok/commands` read-only. Project scope writes
//! `{project}/.grok/commands/{name}.md`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::agent_config_view::normalize_mode;
use crate::path_scope;
use crate::paths::resolve_agent_grok_home;
use crate::skill_edit::sanitize_skill_folder_name;
use crate::store;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomCommandEntry {
    pub name: String,
    pub absolute_path: String,
    pub scope: String,
    pub writable: bool,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomCommandListResult {
    pub commands: Vec<CustomCommandEntry>,
    pub user_root: String,
    pub project_root: Option<String>,
    pub user_writable: bool,
}

fn commands_dir(root: &Path) -> PathBuf {
    root.join("commands")
}

fn project_commands_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".grok").join("commands")
}

fn user_writable(mode: &str) -> bool {
    normalize_mode(mode) == "independent"
}

fn list_md_stems(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.is_empty() {
            continue;
        }
        out.push((stem.to_string(), path));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn list_custom_commands(project_path: Option<&str>) -> Result<CustomCommandListResult, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    let grok_home = resolve_agent_grok_home(mode);
    let user_root = commands_dir(&grok_home);
    let writable = user_writable(mode);
    let mut commands = Vec::new();
    for (name, path) in list_md_stems(&user_root) {
        commands.push(CustomCommandEntry {
            name,
            absolute_path: path.to_string_lossy().to_string(),
            scope: "user".into(),
            writable,
            exists: true,
        });
    }
    let project_root = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(project_commands_dir);
    if let Some(ref dir) = project_root {
        for (name, path) in list_md_stems(dir) {
            commands.push(CustomCommandEntry {
                name,
                absolute_path: path.to_string_lossy().to_string(),
                scope: "project".into(),
                writable: true,
                exists: true,
            });
        }
    }
    Ok(CustomCommandListResult {
        commands,
        user_root: user_root.to_string_lossy().to_string(),
        project_root: project_root.map(|p| p.to_string_lossy().to_string()),
        user_writable: writable,
    })
}

fn render_command_md(name: &str, body: &str) -> String {
    let desc = body
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim())
        .unwrap_or(name);
    let desc = if desc.chars().count() > 120 {
        format!("{}…", desc.chars().take(119).collect::<String>())
    } else {
        desc.to_string()
    };
    format!(
        "---\nname: {name}\ndescription: {desc}\nuser-invocable: true\n---\n\n{}\n",
        body.trim()
    )
}

pub fn create_custom_command(
    name: &str,
    body: &str,
    scope: Option<&str>,
    project_path: Option<&str>,
) -> Result<CustomCommandEntry, String> {
    let safe = sanitize_skill_folder_name(name)?;
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    let scope = scope.unwrap_or("user").trim().to_ascii_lowercase();
    let (dir, writable, scope_label) = match scope.as_str() {
        "project" => {
            let raw = project_path
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project scope requires an active project".to_string())?;
            (project_commands_dir(raw), true, "project")
        }
        _ => {
            if !user_writable(mode) {
                return Err(
                    "shared session mode: switch to Independent to write user commands (will not rewrite ~/.grok)"
                        .into(),
                );
            }
            (commands_dir(&resolve_agent_grok_home(mode)), true, "user")
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("create commands dir: {e}"))?;
    path_scope::grant_path(&dir);
    let path = dir.join(format!("{safe}.md"));
    path_scope::grant_path(&path);
    if path.is_file() {
        return Err(format!("command `{safe}` already exists"));
    }
    let content = render_command_md(&safe, body);
    fs::write(&path, content).map_err(|e| format!("write command: {e}"))?;
    Ok(CustomCommandEntry {
        name: safe,
        absolute_path: path.to_string_lossy().to_string(),
        scope: scope_label.into(),
        writable,
        exists: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_includes_invocable_frontmatter() {
        let md = render_command_md("ship", "Build and tag a release.");
        assert!(md.contains("name: ship"));
        assert!(md.contains("user-invocable: true"));
        assert!(md.contains("Build and tag a release."));
    }
}
