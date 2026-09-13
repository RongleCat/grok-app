// Multi-root workspace IPC (#1194 MVP-0).
// Included into `commands` — do not re-import Arc/State/SessionManager.

use crate::workspace_store::{
    self, root_snapshot, WorkspaceCapability, WorkspaceRecord, WorkspaceRoot,
};

#[tauri::command]
pub fn workspaces_list() -> Result<Vec<WorkspaceRecord>, String> {
    Ok(workspace_store::list_workspaces())
}

#[tauri::command]
pub fn workspaces_for_project(project_id: String) -> Result<Vec<WorkspaceRecord>, String> {
    Ok(workspace_store::workspaces_for_project(&project_id))
}

#[tauri::command]
pub fn workspace_get(id: String) -> Result<Option<WorkspaceRecord>, String> {
    Ok(workspace_store::get_workspace(&id))
}

#[tauri::command]
pub fn workspace_upsert(
    id: Option<String>,
    name: String,
    primary_project_id: String,
    roots: Vec<WorkspaceRoot>,
) -> Result<WorkspaceRecord, String> {
    workspace_store::upsert_workspace(id, name, primary_project_id, roots)
}

#[tauri::command]
pub fn workspace_delete(id: String) -> Result<(), String> {
    workspace_store::delete_workspace(&id)
}

#[tauri::command]
pub fn workspace_validate_root(path: String) -> Result<WorkspaceRoot, String> {
    let (canon, path_ok) = workspace_store::canonicalize_workspace_root(&path)?;
    Ok(WorkspaceRoot {
        path: canon,
        role: workspace_store::WorkspaceRootRole::Extra,
        access: workspace_store::WorkspaceRootAccess::Read,
        path_ok: Some(path_ok),
    })
}

/// Refresh capability plans for all workspaces (Doctor / settings).
#[tauri::command]
pub fn workspaces_diagnose() -> Result<Vec<WorkspaceRecord>, String> {
    workspace_store::refresh_all_capabilities()
}

/// Bind (or clear) a workspace on a session. Grants extra roots into Host
/// path_scope for App file APIs; does not change CLI OS sandbox (MVP-0).
#[tauri::command]
pub async fn session_set_workspace(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    workspace_id: Option<String>,
) -> Result<SessionMeta, String> {
    let wid = workspace_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (snapshot, capability) = if let Some(ref wid) = wid {
        let ws = workspace_store::get_workspace(wid)
            .ok_or_else(|| "workspace not found".to_string())?;
        for root in &ws.roots {
            if root.role == workspace_store::WorkspaceRootRole::Extra {
                crate::path_scope::grant_path(std::path::Path::new(&root.path));
            }
        }
        (
            Some(root_snapshot(&ws.roots)),
            Some(match ws.capability {
                WorkspaceCapability::None => "none".into(),
                WorkspaceCapability::ContextOnly => "context_only".into(),
                WorkspaceCapability::EnforcedRead => "enforced_read".into(),
                WorkspaceCapability::ExtraWriteActive => "extra_write_active".into(),
                WorkspaceCapability::Blocked => "blocked".into(),
            }),
        )
    } else {
        (None, None)
    };

    let meta = store::set_session_workspace(&id, wid, snapshot, capability)?;

    // Roots change → next turn should not resume a process started without them.
    mgr.invalidate_spawn_flags_for_session(&app, &meta.id, "session_workspace")
        .await;
    Ok(meta)
}
