/// Resolve relative media refs to absolute paths that exist on disk.
/// Tries (1) agent session dir under GROK_HOME (`images/1.jpg`),
/// then (2) project cwd (skill outputs like `outputs/xhx-media-gen/foo.png`).
/// Skips missing / unsafe paths.
#[tauri::command]
pub async fn session_resolve_relative_media(
    id: String,
    relatives: Vec<String>,
) -> Result<Vec<store::MessageAttachmentStored>, String> {
    let (session_root, project_root) = resolve_media_search_roots(&id);
    if session_root.is_none() && project_root.is_none() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for rel in relatives {
        let full = session_root
            .as_ref()
            .and_then(|r| crate::paths::resolve_session_relative_media(r, &rel))
            .or_else(|| {
                project_root
                    .as_ref()
                    .and_then(|r| crate::paths::resolve_session_relative_media(r, &rel))
            });
        let Some(full) = full else {
            continue;
        };
        // Allow media:// previews for session/project skill outputs (including
        // untrusted project roots that are not in the global path_scope list).
        crate::path_scope::grant_path(&full);
        let path = full.to_string_lossy().to_string();
        if !seen.insert(path.clone()) {
            continue;
        }
        let name = full
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        out.push(store::MessageAttachmentStored {
            path,
            name,
            is_dir: false,
            ..Default::default()
        });
    }
    Ok(out)
}

fn resolve_media_search_roots(
    session_id: &str,
) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id);
    let Some(meta) = meta else {
        return (None, None);
    };
    let project_root = meta.project_id.as_ref().and_then(|pid| {
        store::load_projects()
            .into_iter()
            .find(|p| &p.id == pid)
            .map(|p| std::path::PathBuf::from(p.path))
    });
    let session_root = meta.agent_session_id.as_deref().and_then(|agent_sid| {
        let settings = store::load_settings();
        crate::paths::find_agent_session_dir(
            agent_sid,
            project_root
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .as_deref(),
            &settings.session_data_mode,
        )
    });
    (session_root, project_root)
}

fn resolve_session_media_root(session_id: &str) -> Option<String> {
    resolve_media_search_roots(session_id)
        .0
        .map(|p| p.to_string_lossy().to_string())
}

