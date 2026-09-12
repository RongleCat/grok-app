//! Multi-root workspace persistence (#1194 MVP-0).
//!
//! Declares primary + extra local roots for a chat. Extra roots default to
//! read-only; without a verified custom CLI sandbox profile the capability is
//! always `context_only` (honest: CLI `workspace` profile may still read the
//! whole disk). Does not rewrite `~/.grok` or invent write powers CLI lacks.

use crate::paths::workspaces_file;
use crate::store::{self, read_json_recover, write_json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

pub const MAX_EXTRA_ROOTS: usize = 8;
pub const WORKSPACE_STORE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceRootRole {
    Primary,
    Extra,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceRootAccess {
    Read,
    Write,
}

/// Honest CLI capability for this workspace snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceCapability {
    /// Old CLI / unknown — hide multi-root write.
    None,
    /// Roots declared in App only; CLI may still read whole disk.
    #[default]
    ContextOnly,
    /// Verified custom strict profile covers declared roots (MVP-1+).
    EnforcedRead,
    /// Verified write roots (v1+).
    ExtraWriteActive,
    /// Profile/platform failure — do not silently fall to `off`.
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRoot {
    pub path: String,
    pub role: WorkspaceRootRole,
    pub access: WorkspaceRootAccess,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_ok: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub primary_project_id: String,
    pub roots: Vec<WorkspaceRoot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_ref: Option<String>,
    #[serde(default)]
    pub capability: WorkspaceCapability,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStoreFile {
    #[serde(default = "default_store_version")]
    pub version: u32,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceRecord>,
}

fn default_store_version() -> u32 {
    WORKSPACE_STORE_VERSION
}

impl Default for WorkspaceStoreFile {
    fn default() -> Self {
        Self {
            version: WORKSPACE_STORE_VERSION,
            workspaces: Vec::new(),
        }
    }
}

pub fn load_workspace_store() -> WorkspaceStoreFile {
    let path = workspaces_file();
    if !path.is_file() {
        return WorkspaceStoreFile::default();
    }
    let mut file: WorkspaceStoreFile = read_json_recover(&path);
    if file.version == 0 {
        file.version = WORKSPACE_STORE_VERSION;
    }
    file
}

pub fn save_workspace_store(file: &WorkspaceStoreFile) -> Result<(), String> {
    write_json(&workspaces_file(), file)
}

pub fn list_workspaces() -> Vec<WorkspaceRecord> {
    load_workspace_store().workspaces
}

pub fn get_workspace(id: &str) -> Option<WorkspaceRecord> {
    let id = id.trim();
    if id.is_empty() {
        return None;
    }
    list_workspaces().into_iter().find(|w| w.id == id)
}

/// Canonicalize a local directory path for workspace membership.
/// Rejects empty, relative `..` escape after canonicalize, files, and missing dirs.
pub fn canonicalize_workspace_root(raw: &str) -> Result<(String, bool), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("path empty".into());
    }
    if trimmed.contains('\0') {
        return Err("path invalid".into());
    }
    let path = PathBuf::from(trimmed);
    // Soft reject obvious `..` segments before resolve (user input hygiene).
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("path must not contain ..".into());
    }
    if !path.exists() {
        return Ok((normalize_display_path(&path), false));
    }
    if !path.is_dir() {
        return Err("path is not a directory".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("canonicalize: {e}"))?;
    if !canon.is_dir() {
        return Err("path is not a directory".into());
    }
    Ok((normalize_display_path(&canon), true))
}

fn normalize_display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn paths_equal(a: &str, b: &str) -> bool {
    a.trim()
        .trim_end_matches('/')
        .eq_ignore_ascii_case(b.trim().trim_end_matches('/'))
}

/// Build / update a workspace. Extra-root write is allowed in the record;
/// capability / spawn profile are applied by [`apply_capability_plan`].
pub fn upsert_workspace(
    id: Option<String>,
    name: String,
    primary_project_id: String,
    roots: Vec<WorkspaceRoot>,
) -> Result<WorkspaceRecord, String> {
    let primary_project_id = primary_project_id.trim().to_string();
    if primary_project_id.is_empty() {
        return Err("primary project required".into());
    }
    let projects = store::load_projects();
    let project = projects
        .iter()
        .find(|p| p.id == primary_project_id)
        .ok_or_else(|| "primary project not found".to_string())?;
    if project.is_ssh_remote() {
        return Err("SSH projects cannot host a multi-root workspace in MVP-0".into());
    }

    let name = {
        let n = name.trim();
        if n.is_empty() {
            format!("{} workspace", project.name)
        } else {
            n.to_string()
        }
    };

    let mut normalized: Vec<WorkspaceRoot> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut primary_count = 0usize;
    let mut extra_count = 0usize;

    for root in roots {
        let (path, path_ok) = canonicalize_workspace_root(&root.path)?;
        if seen.iter().any(|s| paths_equal(s, &path)) {
            return Err(format!("duplicate root: {path}"));
        }
        seen.push(path.clone());
        match root.role {
            WorkspaceRootRole::Primary => {
                primary_count += 1;
                if primary_count > 1 {
                    return Err("exactly one primary root required".into());
                }
                // Primary stays write for the main project cwd (single-project write).
                normalized.push(WorkspaceRoot {
                    path,
                    role: WorkspaceRootRole::Primary,
                    access: WorkspaceRootAccess::Write,
                    path_ok: Some(path_ok),
                });
            }
            WorkspaceRootRole::Extra => {
                extra_count += 1;
                if extra_count > MAX_EXTRA_ROOTS {
                    return Err(format!("at most {MAX_EXTRA_ROOTS} extra roots"));
                }
                normalized.push(WorkspaceRoot {
                    path,
                    role: WorkspaceRootRole::Extra,
                    access: root.access,
                    path_ok: Some(path_ok),
                });
            }
        }
    }

    if primary_count != 1 {
        // Default primary from project path when caller omitted it.
        let (path, path_ok) = canonicalize_workspace_root(&project.path)?;
        if seen.iter().any(|s| paths_equal(s, &path)) {
            return Err("primary root conflicts with an extra root".into());
        }
        normalized.insert(
            0,
            WorkspaceRoot {
                path,
                role: WorkspaceRootRole::Primary,
                access: WorkspaceRootAccess::Write,
                path_ok: Some(path_ok),
            },
        );
    }

    let now = Utc::now();
    let mut file = load_workspace_store();
    let record =
        if let Some(existing_id) = id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            let idx = file
                .workspaces
                .iter()
                .position(|w| w.id == existing_id)
                .ok_or_else(|| "workspace not found".to_string())?;
            let mut record = WorkspaceRecord {
                id: existing_id,
                name,
                primary_project_id,
                roots: normalized,
                profile_ref: None,
                capability: WorkspaceCapability::ContextOnly,
                updated_at: now,
            };
            apply_capability_plan(&mut record)?;
            file.workspaces[idx] = record.clone();
            record
        } else {
            let mut record = WorkspaceRecord {
                id: format!("ws_{}", Uuid::new_v4()),
                name,
                primary_project_id,
                roots: normalized,
                profile_ref: None,
                capability: WorkspaceCapability::ContextOnly,
                updated_at: now,
            };
            apply_capability_plan(&mut record)?;
            file.workspaces.insert(0, record.clone());
            record
        };
    save_workspace_store(&file)?;
    Ok(record)
}

/// Resolve capability from session_data_mode + sandbox plan. Downgrades extra
/// write roots to read when the plan cannot activate write.
pub fn apply_capability_plan(record: &mut WorkspaceRecord) -> Result<(), String> {
    let settings = store::load_settings();
    let plan =
        crate::workspace_sandbox::plan_for_session_mode(&settings.session_data_mode, record)?;
    if plan.spawn_sandbox.is_none() {
        for root in &mut record.roots {
            if root.role == WorkspaceRootRole::Extra {
                root.access = WorkspaceRootAccess::Read;
            }
        }
    }
    record.capability = plan.capability;
    record.profile_ref = plan.profile_ref;
    Ok(())
}

/// Spawn sandbox override for a bound workspace, if any.
pub fn spawn_sandbox_for_workspace(workspace_id: &str) -> Option<String> {
    let ws = get_workspace(workspace_id)?;
    let settings = store::load_settings();
    crate::workspace_sandbox::plan_for_session_mode(&settings.session_data_mode, &ws)
        .ok()
        .and_then(|p| p.spawn_sandbox)
}

pub fn delete_workspace(id: &str) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("workspace id empty".into());
    }
    let mut file = load_workspace_store();
    let before = file.workspaces.len();
    file.workspaces.retain(|w| w.id != id);
    if file.workspaces.len() == before {
        return Err("workspace not found".into());
    }
    save_workspace_store(&file)
}

pub fn workspaces_for_project(project_id: &str) -> Vec<WorkspaceRecord> {
    let pid = project_id.trim();
    list_workspaces()
        .into_iter()
        .filter(|w| w.primary_project_id == pid)
        .collect()
}

/// Snapshot string for SessionMeta (stable, path-order sensitive).
pub fn root_snapshot(roots: &[WorkspaceRoot]) -> String {
    roots
        .iter()
        .map(|r| {
            format!(
                "{}:{}:{}",
                match r.role {
                    WorkspaceRootRole::Primary => "p",
                    WorkspaceRootRole::Extra => "e",
                },
                match r.access {
                    WorkspaceRootAccess::Read => "r",
                    WorkspaceRootAccess::Write => "w",
                },
                r.path
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("grok-ws-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn canonicalize_rejects_parent_segments() {
        let err = canonicalize_workspace_root("/tmp/foo/../bar").unwrap_err();
        assert!(err.contains(".."), "{err}");
    }

    #[test]
    fn canonicalize_marks_missing_path_ok_false() {
        let (path, ok) =
            canonicalize_workspace_root("/tmp/grok-app-ws-missing-dir-should-not-exist").unwrap();
        assert!(!ok);
        assert!(path.contains("grok-app-ws-missing"));
    }

    #[test]
    fn canonicalize_accepts_real_dir() {
        let dir = temp_dir("ok");
        let (path, ok) = canonicalize_workspace_root(dir.to_str().unwrap()).unwrap();
        assert!(ok);
        assert!(!path.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn root_snapshot_is_stable() {
        let snap = root_snapshot(&[
            WorkspaceRoot {
                path: "/a".into(),
                role: WorkspaceRootRole::Primary,
                access: WorkspaceRootAccess::Write,
                path_ok: Some(true),
            },
            WorkspaceRoot {
                path: "/b".into(),
                role: WorkspaceRootRole::Extra,
                access: WorkspaceRootAccess::Read,
                path_ok: Some(true),
            },
        ]);
        assert_eq!(snap, "p:w:/a|e:r:/b");
    }

    #[test]
    fn legacy_empty_file_deserializes() {
        let raw = r#"{"version":1,"workspaces":[]}"#;
        let f: WorkspaceStoreFile = serde_json::from_str(raw).unwrap();
        assert!(f.workspaces.is_empty());
    }
}
