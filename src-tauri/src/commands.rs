//! Tauri commands — Host facade.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::cli_probe::{self, CliProbeResult};
use crate::session_manager::{SessionManager, SessionSnapshot};
use crate::store::{self, AppSettings, Project, SessionMeta};

fn windows_grok_go_config_candidates() -> Option<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let mut out = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(format!(r"{appdata}\com.grokgo.desktop\config.json"));
            out.push(format!(r"{appdata}\GrokGo\config.json"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            out.push(format!(r"{local}\com.grokgo.desktop\config.json"));
            out.push(format!(r"{local}\GrokGo\config.json"));
        }
        return if out.is_empty() { None } else { Some(out) };
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[tauri::command]
pub async fn session_get_state(
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<SessionSnapshot, String> {
    Ok(mgr.snapshot())
}

#[tauri::command]
pub async fn session_connect(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    project_path: Option<String>,
    session_id: Option<String>,
    mode: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.connect(app, project_path, session_id, mode).await
}

/// Send a turn. `text` goes to the agent; optional `display_text` is stored in the journal
/// (skill chips as `[[skill:name]]`) so history can re-render tags.
#[tauri::command]
pub async fn session_send(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    text: String,
    display_text: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.send_message(app, text, display_text).await
}

/// Drop last user turn on agent + local journal (edit & resend).
#[tauri::command]
pub async fn session_rewind_drop_last_user(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<SessionSnapshot, String> {
    mgr.rewind_drop_last_user_turn(app).await
}

/// List rewind points (one per user prompt) for a session journal.
/// Omitting `session_id` uses the live host session.
#[tauri::command]
pub async fn session_rewind_points(
    mgr: State<'_, Arc<SessionManager>>,
    session_id: Option<String>,
) -> Result<Vec<crate::session_manager::RewindPointDto>, String> {
    mgr.list_rewind_points(session_id)
}

/// Rewind a session to a user-prompt index. Local journal always truncates;
/// agent `x.ai/rewind/execute` is best-effort when the session is live (`agentOk`).
#[tauri::command]
pub async fn session_rewind_execute(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    target_prompt_index: u32,
    restore_files: Option<bool>,
    session_id: Option<String>,
) -> Result<crate::session_manager::RewindExecuteResult, String> {
    mgr.rewind_to_prompt_index(
        app,
        target_prompt_index,
        restore_files.unwrap_or(false),
        session_id,
    )
    .await
}

/// Fork a session into a new chat (same project, messages up to optional cut).
#[tauri::command]
pub fn session_fork(
    source_id: String,
    through_user_prompt_index: Option<u32>,
    title: Option<String>,
) -> Result<store::SessionMeta, String> {
    store::fork_session(&source_id, through_user_prompt_index, title)
}

#[tauri::command]
pub async fn session_stop(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<SessionSnapshot, String> {
    mgr.stop(app).await
}

/// Approve / revise / abandon pending plan (`_x.ai/exit_plan_mode`).
#[tauri::command]
pub async fn session_resolve_plan(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    decision: String,
    feedback: Option<String>,
    rpc_id: Option<u64>,
) -> Result<SessionSnapshot, String> {
    mgr.resolve_plan(app, decision, feedback, rpc_id).await
}

/// Answer or dismiss pending `_x.ai/ask_user_question`.
#[tauri::command]
pub async fn session_resolve_ask_user(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    decision: String,
    answers: Option<serde_json::Value>,
    rpc_id: Option<u64>,
) -> Result<SessionSnapshot, String> {
    mgr.resolve_ask_user(app, decision, answers, rpc_id).await
}

#[tauri::command]
pub async fn session_disconnect(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<SessionSnapshot, String> {
    mgr.disconnect(app).await
}

#[tauri::command]
pub async fn session_reattach(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<SessionSnapshot, String> {
    mgr.reattach(app).await
}

#[tauri::command]
pub async fn session_resolve_permission(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    rpc_id: u64,
    decision: String,
    option_id: Option<String>,
    scope_key: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.resolve_permission(app, rpc_id, decision, option_id, scope_key)
        .await
}

#[tauri::command]
pub async fn probe_cli(manual_path: Option<String>) -> Result<CliProbeResult, String> {
    Ok(cli_probe::probe_cli(manual_path.as_deref()))
}

/// API mode: TCP-connect to an ACP server and run the initialize handshake.
#[tauri::command]
pub async fn acp_test_connection(
    addr: String,
) -> Result<crate::acp_client::AcpProbeResult, String> {
    let addr = addr.trim();
    if addr.is_empty() {
        return Err("empty address".into());
    }
    Ok(crate::acp_client::probe_acp_server(addr).await)
}

/// Download + install latest Grok Build (multi-mirror, progress via `setup://cli-install-progress`).
#[tauri::command]
pub async fn cli_install_latest(app: tauri::AppHandle) -> Result<crate::cli_install::CliInstallResult, String> {
    crate::cli_install::install_cli_latest(app).await
}

/// Platform install command + docs URL for manual fallback.
#[tauri::command]
pub async fn cli_install_commands() -> Result<serde_json::Value, String> {
    Ok(crate::cli_install::install_commands())
}

/// Native file picker for a Grok Build binary (manual path).
#[tauri::command]
pub async fn pick_cli_binary() -> Result<Option<String>, String> {
    let file = tauri::async_runtime::spawn_blocking(|| {
        let mut dlg = rfd::FileDialog::new().set_title("Select Grok Build binary / 选择 Grok Build 可执行文件");
        #[cfg(target_os = "windows")]
        {
            dlg = dlg.add_filter("Executable", &["exe", "cmd", "bat"]);
        }
        dlg.pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.map(|p| p.display().to_string()))
}

/// Open a URL in the system browser (docs, install pages).
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("empty url".into());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs allowed".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub async fn projects_list() -> Result<Vec<Project>, String> {
    Ok(store::load_projects())
}

#[tauri::command]
pub async fn project_add(path: String, trust: bool) -> Result<Project, String> {
    store::add_project(path, trust)
}

#[tauri::command]
pub async fn project_remove(id: String) -> Result<(), String> {
    // Unlink from app only — disk folder + sessions retained.
    store::remove_project(&id)
}

#[tauri::command]
pub async fn project_trust(id: String) -> Result<Project, String> {
    store::trust_project(&id)
}

/// Set or clear the project-level permission tier (L10).
/// `policy = null` / empty / `"inherit"` → fall back to app default.
/// When this project is the live Host context, sync agent policy immediately.
#[tauri::command]
pub async fn project_set_permission_policy(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    policy: Option<String>,
) -> Result<Project, String> {
    let p = store::set_project_permission_policy(&id, policy)?;
    let (live_proj, live_sess) = mgr.current_context_ids();
    if live_proj.as_deref() == Some(id.as_str()) {
        let prefs = store::resolve_composer_prefs(Some(&id), live_sess.as_deref());
        if let Err(e) = mgr
            .apply_permission_policy(&app, &prefs.permission_policy)
            .await
        {
            tracing::warn!("project_set_permission_policy apply live: {e}");
        }
    }
    Ok(p)
}

#[tauri::command]
pub async fn project_rename(id: String, name: String) -> Result<Project, String> {
    store::rename_project(&id, &name)
}

#[tauri::command]
pub async fn project_set_pinned(id: String, pinned: bool) -> Result<Project, String> {
    store::set_project_pinned(&id, pinned)
}

/// Reveal project folder in the OS file manager (Finder / Explorer).
#[tauri::command]
pub async fn project_reveal(id: String) -> Result<(), String> {
    let list = store::load_projects();
    let p = list
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    let path = p.path.clone();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn project_archive_sessions(id: String) -> Result<usize, String> {
    store::archive_project_sessions(&id)
}

#[tauri::command]
pub async fn sessions_list() -> Result<Vec<SessionMeta>, String> {
    Ok(store::load_sessions_index())
}

/// List Grok Build CLI sessions under GROK_HOME (shared-mode discovery, E03).
#[tauri::command]
pub async fn cli_sessions_list() -> Result<Vec<crate::cli_sessions::CliSessionSummary>, String> {
    let mode = store::load_settings().session_data_mode;
    crate::cli_sessions::list_cli_sessions(&mode)
}

/// Import one CLI session (chat_history.jsonl) into the App journal.
#[tauri::command]
pub async fn cli_session_import(
    agent_session_id: String,
    dir: Option<String>,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let mode = store::load_settings().session_data_mode;
    crate::cli_sessions::import_cli_session(
        &agent_session_id,
        dir.as_deref(),
        project_id,
        &mode,
    )
}

/// Import up to `limit` not-yet-linked CLI sessions (default 50).
#[tauri::command]
pub async fn cli_sessions_import_all(limit: Option<u32>) -> Result<Vec<SessionMeta>, String> {
    let mode = store::load_settings().session_data_mode;
    let lim = limit.unwrap_or(50).min(100) as usize;
    crate::cli_sessions::import_all_cli_sessions(&mode, lim)
}

#[tauri::command]
pub async fn session_create(
    project_id: Option<String>,
    title: Option<String>,
    scheduled: Option<bool>,
) -> Result<SessionMeta, String> {
    store::create_session(project_id, title, scheduled.unwrap_or(false))
}

#[tauri::command]
pub async fn session_set_scheduled(
    id: String,
    scheduled: bool,
) -> Result<SessionMeta, String> {
    store::set_session_scheduled(&id, scheduled)
}

#[tauri::command]
pub async fn session_delete(id: String) -> Result<(), String> {
    store::delete_session(&id)
}

#[tauri::command]
pub async fn session_rename(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    title: String,
) -> Result<SessionMeta, String> {
    let meta = store::rename_session(&id, &title)?;
    // Sync live session so streaming state events do not revive the old title.
    let _ = mgr.apply_title(&app, &meta.id, &meta.title);
    Ok(meta)
}

#[tauri::command]
pub async fn session_set_archived(id: String, archived: bool) -> Result<SessionMeta, String> {
    store::set_session_archived(&id, archived)
}

/// Move session under a project (or clear project → orphan / 「其他会话」).
#[tauri::command]
pub async fn session_set_project(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_project(&id, project_id)?;
    // If this session is live, drop ACP so next send reconnects with new cwd.
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        let _ = mgr.disconnect(app).await;
    }
    Ok(meta)
}

#[tauri::command]
pub async fn session_messages(
    id: String,
) -> Result<Vec<store::ChatMessageStored>, String> {
    Ok(store::load_messages(&id))
}

/// Absolute path of the agent session folder under GROK_HOME (images/, etc.).
/// Used to resolve short relative paths like `images/1.jpg` into image cards.
#[tauri::command]
pub async fn session_media_root(id: String) -> Result<Option<String>, String> {
    Ok(resolve_session_media_root(&id))
}

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

// ─── Automations ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn automations_list() -> Result<Vec<store::Automation>, String> {
    Ok(store::load_automations())
}

#[tauri::command]
pub async fn automation_create(
    input: store::AutomationInput,
) -> Result<store::Automation, String> {
    store::create_automation(input)
}

#[tauri::command]
pub async fn automation_update(
    id: String,
    input: store::AutomationInput,
) -> Result<store::Automation, String> {
    store::update_automation(&id, input)
}

#[tauri::command]
pub async fn automation_set_enabled(
    id: String,
    enabled: bool,
) -> Result<store::Automation, String> {
    store::set_automation_enabled(&id, enabled)
}

#[tauri::command]
pub async fn automation_mark_run(
    id: String,
    last_run_at: String,
    next_run_at: Option<String>,
) -> Result<store::Automation, String> {
    let last = chrono::DateTime::parse_from_rfc3339(&last_run_at)
        .map(|d| d.with_timezone(&chrono::Utc))
        .map_err(|e| e.to_string())?;
    let next = match next_run_at {
        Some(s) if !s.is_empty() => Some(
            chrono::DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&chrono::Utc))
                .map_err(|e| e.to_string())?,
        ),
        _ => None,
    };
    store::mark_automation_run(&id, last, next)
}

#[tauri::command]
pub async fn automation_delete(id: String) -> Result<(), String> {
    store::delete_automation(&id)
}

#[tauri::command]
pub async fn settings_get() -> Result<AppSettings, String> {
    Ok(store::load_settings())
}

#[tauri::command]
pub async fn settings_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let prev = store::load_settings();
    let keychain_flip =
        prev.store_api_keys_in_keychain != settings.store_api_keys_in_keychain;

    store::save_settings(&settings)?;

    if keychain_flip {
        if let Err(e) =
            crate::secrets::apply_keychain_preference(settings.store_api_keys_in_keychain)
        {
            // Revert flag so UI and storage stay consistent.
            let mut rolled = settings.clone();
            rolled.store_api_keys_in_keychain = prev.store_api_keys_in_keychain;
            let _ = store::save_settings(&rolled);
            return Err(e);
        }
    }

    // Full permission apply: Host + agent-home + soft-respawn if needed
    if let Err(e) = mgr
        .apply_permission_policy(&app, &settings.permission_policy)
        .await
    {
        tracing::warn!("settings_set apply_permission: {e}");
    }
    // Rebuild tray so locale / recent list match settings immediately.
    if let Err(e) = crate::tray::refresh_menu(&app) {
        tracing::warn!("settings_set tray refresh: {e}");
    }
    Ok(settings)
}

#[tauri::command]
pub async fn models_list_available() -> Result<crate::models_catalog::AvailableModelsResult, String> {
    Ok(crate::models_catalog::list_available_models())
}

#[tauri::command]
pub async fn composer_prefs_resolve(
    project_id: Option<String>,
    session_id: Option<String>,
) -> Result<store::ComposerPrefs, String> {
    Ok(store::resolve_composer_prefs(
        project_id.as_deref(),
        session_id.as_deref(),
    ))
}

/// Persist composer fields at the configured memory scope + apply live.
#[tauri::command]
pub async fn composer_prefs_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    project_id: Option<String>,
    session_id: Option<String>,
    model_id: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    permission_policy: Option<String>,
) -> Result<store::ComposerPrefs, String> {
    // Prefer explicit ids; fall back to live session context.
    let (live_proj, live_sess) = mgr.current_context_ids();
    let project_id = project_id.or(live_proj);
    let session_id = session_id.or(live_sess);

    let prefs = store::save_composer_prefs(
        project_id.as_deref(),
        session_id.as_deref(),
        model_id.clone(),
        effort.clone(),
        mode.clone(),
        permission_policy.clone(),
    )?;

    if let Some(ref pol) = permission_policy {
        if let Err(e) = mgr.apply_permission_policy(&app, pol).await {
            tracing::warn!("composer_prefs_set apply_permission: {e}");
        }
    }
    if let Some(mid) = model_id {
        if let Err(e) = mgr.set_model(mid).await {
            tracing::warn!("composer_prefs_set set_model soft-fail: {e}");
        }
    }
    if let Some(eff) = effort {
        if let Err(e) = mgr.set_effort_and_respawn_needed(&app, eff).await {
            tracing::warn!("composer_prefs_set set_effort soft-fail: {e}");
        }
    }
    if let Some(m) = mode {
        if let Err(e) = mgr.apply_product_mode(&app, m).await {
            tracing::warn!("composer_prefs_set apply_mode soft-fail: {e}");
        }
    }
    Ok(prefs)
}

#[tauri::command]
pub async fn session_set_policy(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    policy: String,
    project_id: Option<String>,
    session_id: Option<String>,
) -> Result<store::ComposerPrefs, String> {
    let p = crate::permission::PermissionPolicy::parse(&policy);
    let (live_proj, live_sess) = mgr.current_context_ids();
    let prefs = store::save_composer_prefs(
        project_id.or(live_proj).as_deref(),
        session_id.or(live_sess).as_deref(),
        None,
        None,
        None,
        Some(p.as_str().into()),
    )?;
    mgr.apply_permission_policy(&app, p.as_str()).await?;
    Ok(prefs)
}

#[tauri::command]
pub async fn session_set_model(
    mgr: State<'_, Arc<SessionManager>>,
    model_id: String,
    project_id: Option<String>,
    session_id: Option<String>,
) -> Result<store::ComposerPrefs, String> {
    let (live_proj, live_sess) = mgr.current_context_ids();
    let prefs = store::save_composer_prefs(
        project_id.or(live_proj).as_deref(),
        session_id.or(live_sess).as_deref(),
        Some(model_id.clone()),
        None,
        None,
        None,
    )?;
    if let Err(e) = mgr.set_model(model_id).await {
        tracing::warn!("session_set_model soft-fail: {e}");
    }
    Ok(prefs)
}

#[tauri::command]
pub async fn fs_list_dir(
    project_path: String,
    relative: Option<String>,
) -> Result<Vec<crate::fs_browser::FsEntry>, String> {
    crate::fs_browser::list_dir(&project_path, relative.as_deref().unwrap_or(""))
}

#[tauri::command]
pub async fn fs_read_file(
    project_path: String,
    relative: String,
) -> Result<crate::fs_browser::FsReadResult, String> {
    crate::fs_browser::read_file(&project_path, &relative)
}

/// Write UTF-8 text under the project root (resource pane Save).
/// Pass `expected_mtime_ms` from the last read to detect agent/external overwrites.
#[tauri::command]
pub async fn fs_write_file(
    project_path: String,
    relative: String,
    content: String,
    expected_mtime_ms: Option<u64>,
) -> Result<crate::fs_browser::FsWriteResult, String> {
    crate::fs_browser::write_text_file(
        &project_path,
        &relative,
        &content,
        expected_mtime_ms,
    )
}

/// Write UTF-8 text to an absolute path already open in the resource pane.
#[tauri::command]
pub async fn fs_write_absolute(
    path: String,
    content: String,
    expected_mtime_ms: Option<u64>,
) -> Result<crate::fs_browser::FsWriteResult, String> {
    crate::fs_browser::write_text_absolute(&path, &content, expected_mtime_ms)
}

/// Read an absolute path for resource-pane preview (chat file cards, agent outputs).
#[tauri::command]
pub async fn fs_read_absolute(
    path: String,
) -> Result<crate::fs_browser::FsReadResult, String> {
    crate::fs_browser::read_absolute_file(&path)
}

/// Smart open for chat cards: absolute / project-relative / suffix search under project.
#[tauri::command]
pub async fn fs_open_path(
    path: String,
    project_path: Option<String>,
) -> Result<crate::fs_browser::FsReadResult, String> {
    crate::fs_browser::open_path_smart(project_path.as_deref(), &path)
}

/// Auto-name a session from the first user message.
/// Returns heuristic title immediately; low-effort CLI refine emits `session://title`.
#[tauri::command]
pub async fn session_auto_title(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    first_message: String,
) -> Result<store::SessionMeta, String> {
    let meta = crate::session_title::auto_title_session_fast(&id, &first_message)?;
    // Keep Host live meta aligned so mid-stream session://state does not wipe the title.
    let _ = mgr.apply_title(&app, &meta.id, &meta.title);
    let mgr_arc = Arc::clone(&*mgr);
    crate::session_title::refine_title_in_background(app, mgr_arc, id, first_message);
    Ok(meta)
}

#[tauri::command]
pub async fn secrets_get_masked() -> Result<serde_json::Value, String> {
    // Disk + presence flags only — do not unlock Keychain on app open.
    let s = crate::secrets::load_secrets_disk_only();
    let providers = crate::providers::list_custom_providers().unwrap_or_else(|_| {
        crate::providers::ProvidersListResult {
            providers: vec![],
            default_model: None,
            active_source: "official".into(),
            active_provider_id: None,
            config_path: String::new(),
            agent_home: String::new(),
        }
    });
    let has_provider_key = providers.providers.iter().any(|p| p.has_api_key);
    let relay_base = providers
        .providers
        .iter()
        .find(|p| p.is_default)
        .or(providers.providers.first())
        .map(|p| p.base_url.clone())
        .or(s.relay_base_url.clone());
    Ok(serde_json::json!({
        "hasOfficialKey": crate::secrets::has_official_key_configured(&s),
        "hasRelayKey": has_provider_key
            || crate::secrets::has_relay_key_configured(&s),
        "relayBaseUrl": relay_base,
        "defaultModel": providers.default_model.or(s.default_model),
        "providerCount": providers.providers.len(),
        "agentHome": providers.agent_home,
        // Report user preference — do not soft-probe Keychain on cold start.
        "secretsBackend": match crate::secrets::configured_backend() {
            crate::secrets::SecretsBackendKind::Keychain => "keychain",
            crate::secrets::SecretsBackendKind::File => "file",
        },
        "storeApiKeysInKeychain": store::load_settings().store_api_keys_in_keychain,
    }))
}

#[tauri::command]
pub async fn secrets_set(
    official_api_key: Option<String>,
    relay_base_url: Option<String>,
    relay_api_key: Option<String>,
    default_model: Option<String>,
) -> Result<(), String> {
    let mut s = store::load_secrets();
    if let Some(k) = official_api_key {
        if !k.is_empty() {
            s.official_api_key = Some(k);
        }
    }
    if let Some(u) = relay_base_url {
        s.relay_base_url = if u.is_empty() { None } else { Some(u) };
    }
    if let Some(k) = relay_api_key {
        if !k.is_empty() {
            s.relay_api_key = Some(k);
        }
    }
    if let Some(m) = default_model {
        s.default_model = if m.is_empty() { None } else { Some(m) };
    }
    store::save_secrets(&s)
}

#[tauri::command]
pub async fn provider_ping() -> Result<serde_json::Value, String> {
    let secrets = store::load_secrets();
    // Prefer relay if configured, else probe public xAI-ish endpoint with key presence only.
    if let (Some(base), Some(key)) = (&secrets.relay_base_url, &secrets.relay_api_key) {
        let url = format!("{}/models", base.trim_end_matches('/'));
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {key}"))
            .send()
            .await;
        return match resp {
            Ok(r) => {
                let status = r.status().as_u16();
                if status == 401 || status == 403 {
                    Ok(serde_json::json!({
                        "ok": false,
                        "class": "AUTH_FAILED",
                        "status": status,
                        "message": "Provider rejected credentials (401/403)"
                    }))
                } else if status >= 500 {
                    Ok(serde_json::json!({
                        "ok": false,
                        "class": "NETWORK_PROVIDER",
                        "status": status,
                        "message": "Provider server error"
                    }))
                } else if r.status().is_success() {
                    Ok(serde_json::json!({
                        "ok": true,
                        "class": "OK",
                        "status": status,
                        "message": "Ping OK"
                    }))
                } else {
                    Ok(serde_json::json!({
                        "ok": false,
                        "class": "NETWORK_PROVIDER",
                        "status": status,
                        "message": format!("HTTP {status}")
                    }))
                }
            }
            Err(e) => {
                let msg = e.to_string();
                let class = if msg.contains("dns") || msg.contains("resolve") {
                    "NETWORK_PROVIDER"
                } else if msg.contains("timeout") {
                    "NETWORK_PROVIDER"
                } else {
                    "NETWORK_PROVIDER"
                };
                Ok(serde_json::json!({
                    "ok": false,
                    "class": class,
                    "message": msg
                }))
            }
        };
    }

    // CLI auth present?
    let auth = crate::process_util::user_home().join(".grok").join("auth.json");
    if auth.is_file() {
        Ok(serde_json::json!({
            "ok": true,
            "class": "OK",
            "message": "CLI auth.json present (cached_token). Use Doctor + real chat to verify."
        }))
    } else if secrets.official_api_key.as_ref().map(|k| !k.is_empty()).unwrap_or(false) {
        Ok(serde_json::json!({
            "ok": true,
            "class": "OK",
            "message": "Official API key stored (not verified over network without base_url)."
        }))
    } else {
        Ok(serde_json::json!({
            "ok": false,
            "class": "AUTH_FAILED",
            "message": "No provider configured. Use Onboarding: official key, relay, or import."
        }))
    }
}

#[tauri::command]
pub async fn import_grok_cli_config() -> Result<serde_json::Value, String> {
    let home = crate::process_util::user_home();
    let auth = home.join(".grok").join("auth.json");
    let config = home.join(".grok").join("config.toml");
    let mut msg = Vec::new();
    if auth.is_file() {
        msg.push("Found ~/.grok/auth.json (CLI will use cached_token)".to_string());
    } else {
        msg.push("No ~/.grok/auth.json".to_string());
    }
    if config.is_file() {
        msg.push("Found ~/.grok/config.toml".to_string());
    }
    let mut settings = store::load_settings();
    settings.onboarding_done = true;
    store::save_settings(&settings)?;
    Ok(serde_json::json!({
        "ok": auth.is_file(),
        "messages": msg,
    }))
}

#[tauri::command]
pub async fn import_grok_go_config() -> Result<serde_json::Value, String> {
    // Common grok-go config locations (read-only)
    let home = crate::process_util::user_home();
    let home_s = home.to_string_lossy();
    let mut candidates: Vec<String> = vec![
        format!("{home_s}/.grok-go/config.json"),
        format!("{home_s}/Library/Application Support/com.grokgo.desktop/config.json"),
        format!("{home_s}/Library/Application Support/GrokGo/config.json"),
    ];
    // Windows app-data layouts (cfg-gated; mut used only on Windows).
    if let Some(extra) = windows_grok_go_config_candidates() {
        candidates.extend(extra);
    }
    for c in candidates {
        let p = std::path::PathBuf::from(&c);
        if p.is_file() {
            let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            let v: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            // Try common keys without logging secrets
            let mut secrets = store::load_secrets();
            if let Some(key) = v
                .pointer("/apiKey")
                .or_else(|| v.pointer("/api_key"))
                .or_else(|| v.pointer("/key"))
                .and_then(|x| x.as_str())
            {
                secrets.relay_api_key = Some(key.to_string());
            }
            if let Some(base) = v
                .pointer("/baseUrl")
                .or_else(|| v.pointer("/base_url"))
                .or_else(|| v.pointer("/endpoint"))
                .and_then(|x| x.as_str())
            {
                secrets.relay_base_url = Some(base.to_string());
            }
            store::save_secrets(&secrets)?;
            let mut settings = store::load_settings();
            settings.onboarding_done = true;
            store::save_settings(&settings)?;
            return Ok(serde_json::json!({
                "ok": true,
                "path": c,
                "message": "Imported grok-go config (keys stored, not logged)."
            }));
        }
    }
    Err("grok-go config not found in known locations".into())
}

/// Structured Doctor check row (UI consumes `checks`; `raw` is for copy/export).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorCheck {
    id: String,
    level: String,
    title: String,
    detail: String,
    meta: serde_json::Value,
}

fn doctor_check(
    id: &str,
    level: &str,
    title: &str,
    detail: String,
    meta: serde_json::Value,
) -> DoctorCheck {
    DoctorCheck {
        id: id.into(),
        level: level.into(),
        title: title.into(),
        detail,
        meta,
    }
}

#[tauri::command]
pub async fn doctor_report() -> Result<serde_json::Value, String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let projects = store::load_projects();
    let sessions = store::load_sessions_index();
    let secrets = store::load_secrets();
    let auth_path_buf = crate::process_util::user_home()
        .join(".grok")
        .join("auth.json");
    let auth_ok = auth_path_buf.is_file();
    let auth_path = auth_path_buf.display().to_string();
    let data_root_path = crate::paths::app_data_root();
    let data_root = data_root_path.display().to_string();
    let log_dir_path = data_root_path.join("logs");
    let log_dir = log_dir_path.display().to_string();
    let log_dir_exists = log_dir_path.is_dir();
    let backend_default = if crate::acp_client::AcpClient::use_mock() {
        "mock_acp"
    } else {
        "grok_agent_stdio"
    };
    let has_official_key = secrets.official_api_key.is_some();
    let has_relay = secrets.relay_base_url.is_some() && secrets.relay_api_key.is_some();
    // Never include secret values — only which backend holds them.
    let secrets_backend = match crate::secrets::active_backend() {
        crate::secrets::SecretsBackendKind::Keychain => "keychain",
        crate::secrets::SecretsBackendKind::File => "file",
    };

    // Flat snapshot for clipboard / legacy consumers (no secret values).
    let raw = serde_json::json!({
        "cli": {
            "found": probe.found,
            "path": probe.path,
            "version": probe.version,
            "source": probe.source,
        },
        "auth": {
            "cliAuthJson": auth_ok,
            "authPath": auth_path,
            "hasOfficialKey": has_official_key,
            "hasRelay": has_relay,
            "secretsBackend": secrets_backend,
        },
        "workspace": {
            "projectCount": projects.len(),
            "sessionCount": sessions.len(),
            "dataRoot": data_root,
            "sessionDataMode": settings.session_data_mode,
        },
        "logs": {
            "dir": log_dir,
            "exists": log_dir_exists,
        },
        "app": {
            "version": env!("CARGO_PKG_VERSION"),
            "backendDefault": backend_default,
            "nonOfficial": true,
            "license": "MIT",
        }
    });

    let mut checks: Vec<DoctorCheck> = Vec::with_capacity(5);

    // 1) CLI
    if probe.found {
        let ver = probe.version.as_deref().unwrap_or("unknown");
        let path = probe.path.as_deref().unwrap_or("—");
        checks.push(doctor_check(
            "cli",
            "ok",
            "Grok Build CLI",
            format!("Found {ver} ({}) at {path}", probe.source),
            serde_json::json!({
                "found": true,
                "path": probe.path,
                "version": probe.version,
                "source": probe.source,
            }),
        ));
    } else {
        checks.push(doctor_check(
            "cli",
            "fail",
            "Grok Build CLI",
            "Grok Build CLI not found. Install from Settings → Runtime or the setup wizard."
                .into(),
            serde_json::json!({
                "found": false,
                "path": probe.path,
                "version": probe.version,
                "source": probe.source,
                "candidatesTried": probe.candidates_tried,
            }),
        ));
    }

    // 2) Auth — warn if no CLI auth, official key, or relay
    let auth_sources: Vec<&str> = [
        auth_ok.then_some("cliAuthJson"),
        has_official_key.then_some("officialKey"),
        has_relay.then_some("relay"),
    ]
    .into_iter()
    .flatten()
    .collect();
    if auth_sources.is_empty() {
        checks.push(doctor_check(
            "auth",
            "warn",
            "Authentication",
            format!(
                "No CLI auth (~/.grok/auth.json), official API key, or relay configured. Path: {auth_path}"
            ),
            serde_json::json!({
                "cliAuthJson": auth_ok,
                "authPath": auth_path,
                "hasOfficialKey": has_official_key,
                "hasRelay": has_relay,
            }),
        ));
    } else {
        checks.push(doctor_check(
            "auth",
            "ok",
            "Authentication",
            format!("Auth available via: {}", auth_sources.join(", ")),
            serde_json::json!({
                "cliAuthJson": auth_ok,
                "authPath": auth_path,
                "hasOfficialKey": has_official_key,
                "hasRelay": has_relay,
            }),
        ));
    }

    // 3) Workspace
    let data_root_ok = data_root_path.is_dir() || data_root_path.parent().is_some();
    let workspace_level = if data_root_path.exists() || data_root_ok {
        "ok"
    } else {
        "warn"
    };
    checks.push(doctor_check(
        "workspace",
        workspace_level,
        "Workspace",
        format!(
            "{} projects · {} sessions · dataRoot {data_root} · mode {}",
            projects.len(),
            sessions.len(),
            settings.session_data_mode
        ),
        serde_json::json!({
            "projectCount": projects.len(),
            "sessionCount": sessions.len(),
            "dataRoot": data_root,
            "sessionDataMode": settings.session_data_mode,
        }),
    ));

    // 4) Backend
    let (backend_level, backend_detail) = if backend_default == "mock_acp" {
        (
            "warn",
            "Using mock ACP backend (dev). Production uses grok_agent_stdio.".to_string(),
        )
    } else {
        (
            "ok",
            format!("Agent backend: {backend_default}"),
        )
    };
    checks.push(doctor_check(
        "backend",
        backend_level,
        "Backend",
        backend_detail,
        serde_json::json!({
            "backendDefault": backend_default,
            "version": env!("CARGO_PKG_VERSION"),
        }),
    ));

    // 5) Logs dir
    let (logs_level, logs_detail) = if log_dir_exists {
        ("ok", format!("Logs directory: {log_dir}"))
    } else {
        (
            "warn",
            format!("Logs directory not created yet: {log_dir}"),
        )
    };
    checks.push(doctor_check(
        "logs",
        logs_level,
        "Logs",
        logs_detail,
        serde_json::json!({
            "dir": log_dir,
            "exists": log_dir_exists,
        }),
    ));

    let mut ok = 0u32;
    let mut warn = 0u32;
    let mut fail = 0u32;
    for c in &checks {
        match c.level.as_str() {
            "ok" => ok += 1,
            "warn" => warn += 1,
            "fail" => fail += 1,
            _ => {}
        }
    }

    Ok(serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "summary": { "ok": ok, "warn": warn, "fail": fail },
        "checks": checks,
        "raw": raw,
    }))
}

/// Write a redacted support zip (Doctor JSON + logs) and return its path.
/// Optionally opens a save dialog so the user can pick the destination.
#[tauri::command]
pub async fn export_support_bundle(
    doctor_json: Option<String>,
) -> Result<serde_json::Value, String> {
    let doctor = if let Some(j) = doctor_json.filter(|s| !s.trim().is_empty()) {
        j
    } else {
        // Build a fresh report when the UI did not pass one.
        let report = doctor_report().await?;
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    };

    let tmp = crate::support_bundle::write_support_bundle(&doctor)?;
    save_and_reveal_zip(tmp, "Save support bundle", "grok-app-support.zip")
}

/// Full session diagnostic zip: messages, meta, settings, CLI probe, agent trail, logs.
/// Redacts secrets. Opens a save dialog and reveals the file.
#[tauri::command]
pub async fn export_session_bundle(
    session_id: String,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("session id is empty".into());
    }
    let runtime = mgr.diagnostic_runtime_for(&sid);
    let tmp = crate::support_bundle::write_session_bundle(&sid, runtime)?;
    let short: String = sid.chars().take(8).collect();
    let suggested = format!("grok-app-session-{short}.zip");
    save_and_reveal_zip(tmp, "Save session diagnostic bundle", &suggested)
}

fn save_and_reveal_zip(
    tmp: std::path::PathBuf,
    dialog_title: &str,
    fallback_name: &str,
) -> Result<serde_json::Value, String> {
    let suggested = tmp
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_name)
        .to_string();
    let dest = rfd::FileDialog::new()
        .set_title(dialog_title)
        .set_file_name(&suggested)
        .add_filter("Zip", &["zip"])
        .save_file();

    let final_path = if let Some(dest) = dest {
        std::fs::copy(&tmp, &dest).map_err(|e| format!("copy zip: {e}"))?;
        let _ = std::fs::remove_file(&tmp);
        dest
    } else {
        tmp
    };

    let path_s = final_path.display().to_string();
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .args(["-R", &path_s])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .args(["/select,", &path_s])
            .status();
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": path_s,
    }))
}

/// Wipe App data under the data root (sessions, projects, settings).
/// Does not touch the CLI home (`~/.grok`). Double-confirm in the UI before calling.
#[tauri::command]
pub async fn reset_app_data(
    app: tauri::AppHandle,
    keep_secrets: Option<bool>,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    // Drop live agent first so session files are not mid-write.
    let _ = mgr.disconnect(app).await;
    let keep = keep_secrets.unwrap_or(true);
    crate::support_bundle::reset_app_data(keep)
}

// ── Skills / MCP via `grok inspect --json` ──────────────────────────────────

const INSPECT_TIMEOUT_SECS: u64 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDto {
    pub name: String,
    pub description: String,
    /// Normalized source type string (e.g. "user", "project", "plugin").
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default)]
    pub user_invocable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compatibility_status: Option<String>,
}

/// Run probed CLI: `grok inspect --json` with optional project cwd.
/// Returns (parsed JSON, error message). Never panics; empty on failure.
fn run_grok_inspect(project_path: Option<&str>) -> (Option<serde_json::Value>, Option<String>) {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return (None, Some("Grok Build CLI not found".into()));
    };

    let cwd = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.arg("inspect").arg("--json");
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(INSPECT_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let msg = if err.is_empty() {
                    format!("grok inspect exited with {}", output.status)
                } else {
                    // Truncate; never log secrets (inspect should not print keys)
                    err.chars().take(400).collect()
                };
                return (None, Some(msg));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                Ok(v) => (Some(v), None),
                Err(e) => (None, Some(format!("Failed to parse grok inspect JSON: {e}"))),
            }
        }
        Ok(Err(e)) => (None, Some(format!("Failed to run grok inspect: {e}"))),
        Err(_) => (None, Some(format!(
            "grok inspect timed out after {INSPECT_TIMEOUT_SECS}s"
        ))),
    }
}

fn normalize_skill_source(source: &serde_json::Value) -> (String, Option<String>) {
    if let Some(s) = source.as_str() {
        return (s.to_string(), None);
    }
    if let Some(obj) = source.as_object() {
        let ty = obj
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown")
            .to_string();
        let path = obj
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        return (ty, path);
    }
    ("unknown".into(), None)
}

fn parse_skills(v: &serde_json::Value) -> Vec<SkillDto> {
    let Some(arr) = v.get("skills").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = item
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let (source, path_from_source) =
            normalize_skill_source(item.get("source").unwrap_or(&serde_json::Value::Null));
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or(path_from_source);
        let user_invocable = item
            .get("userInvocable")
            .or_else(|| item.get("user_invocable"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        out.push(SkillDto {
            name,
            description,
            source,
            path,
            user_invocable,
        });
    }
    out
}

fn parse_mcp_servers(v: &serde_json::Value) -> Vec<McpDto> {
    let Some(arr) = v
        .get("mcpServers")
        .or_else(|| v.get("mcp"))
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let transport = item
            .get("transport")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let target = item
            .get("target")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let vendor = item
            .get("vendor")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let compatibility_status = item
            .get("compatibilityStatus")
            .or_else(|| item.get("compatibility_status"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        out.push(McpDto {
            name,
            transport,
            target,
            vendor,
            compatibility_status,
        });
    }
    out
}

/// List invocable skills from `grok inspect --json`.
/// Always returns Ok; on CLI missing / timeout, `skills` is empty and `error` is set.
/// Each skill includes `enabled` from App Extensions prefs (default true).
#[tauri::command]
pub async fn skills_list(project_path: Option<String>) -> Result<serde_json::Value, String> {
    let path = project_path.clone();
    let (parsed, error) = tauri::async_runtime::spawn_blocking(move || {
        run_grok_inspect(path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;

    let skills = parsed.as_ref().map(parse_skills).unwrap_or_default();
    let skills = attach_skill_enabled(skills);
    let mut out = serde_json::json!({ "skills": skills });
    if let Some(err) = error {
        out["error"] = serde_json::Value::String(err);
    }
    Ok(out)
}

/// List MCP servers from `grok inspect --json`.
/// Always returns Ok; on CLI missing / timeout, `servers` is empty and `error` is set.
/// Each server includes `enabled` from App Extensions prefs (default true).
#[tauri::command]
pub async fn inspect_mcp(project_path: Option<String>) -> Result<serde_json::Value, String> {
    let path = project_path.clone();
    let (parsed, error) = tauri::async_runtime::spawn_blocking(move || {
        run_grok_inspect(path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut servers = parsed.as_ref().map(parse_mcp_servers).unwrap_or_default();
    let prefs = crate::extensions::load_prefs();
    // Enrich with enable state for UI toggles.
    let mut server_json = Vec::with_capacity(servers.len());
    for s in servers.drain(..) {
        let enabled = crate::extensions::is_enabled(&prefs.mcp, &s.name);
        server_json.push(serde_json::json!({
            "name": s.name,
            "transport": s.transport,
            "target": s.target,
            "vendor": s.vendor,
            "compatibilityStatus": s.compatibility_status,
            "enabled": enabled,
        }));
    }
    let mut out = serde_json::json!({ "servers": server_json });
    if let Some(err) = error {
        out["error"] = serde_json::Value::String(err);
    }
    Ok(out)
}

/// List skills from `grok inspect --json`, each with App `enabled` (default true).
/// (skills_list already exists; this keeps enable flags on the existing shape.)
fn attach_skill_enabled(skills: Vec<SkillDto>) -> Vec<serde_json::Value> {
    let prefs = crate::extensions::load_prefs();
    skills
        .into_iter()
        .map(|s| {
            let enabled = crate::extensions::is_enabled(&prefs.skills, &s.name);
            serde_json::json!({
                "name": s.name,
                "description": s.description,
                "source": s.source,
                "path": s.path,
                "userInvocable": s.user_invocable,
                "enabled": enabled,
            })
        })
        .collect()
}

/// Current Extensions enable prefs (`extensions.json`).
#[tauri::command]
pub async fn extensions_get() -> Result<crate::extensions::ExtensionsPrefs, String> {
    Ok(crate::extensions::load_prefs())
}

/// Toggle one MCP server; persists prefs, syncs agent-home/config, soft-respawns.
#[tauri::command]
pub async fn extensions_set_mcp(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
    enabled: bool,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    let prefs = tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::set_mcp_enabled(&name, enabled)
    })
    .await
    .map_err(|e| e.to_string())??;
    mgr.apply_extensions_mcp_change(&app).await;
    Ok(prefs)
}

/// Toggle one skill (App filter for slash/composer); persists immediately.
#[tauri::command]
pub async fn extensions_set_skill(
    name: String,
    enabled: bool,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::set_skill_enabled(&name, enabled)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bulk-enable all listed MCP servers; soft-respawns when a live agent exists.
#[tauri::command]
pub async fn extensions_enable_all_mcp(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    names: Vec<String>,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    let prefs = tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::enable_all_mcp(&names)
    })
    .await
    .map_err(|e| e.to_string())??;
    mgr.apply_extensions_mcp_change(&app).await;
    Ok(prefs)
}

/// Bulk-enable all listed skills.
#[tauri::command]
pub async fn extensions_enable_all_skills(
    names: Vec<String>,
) -> Result<crate::extensions::ExtensionsPrefs, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::enable_all_skills(&names)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Plugins via Grok Build CLI (`grok plugin …` + `inspect` + config.toml) ──
//
// Keep field semantics aligned with Grok Build:
// - install inventory: `grok plugin list --json` (status/name/version/source/…)
// - enable/disable: `~/.grok/config.toml` `[plugins].disabled` / CLI enable|disable
// - scope + component counts: `grok inspect --json` → `plugins[]`
// Do not invent a parallel store or rewrite CLI `status` values.

const PLUGIN_CMD_TIMEOUT_SECS: u64 = 30;
/// Install / update pull git or marketplace cache; allow longer than enable/list.
const PLUGIN_MUTATE_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginProvidesDto {
    #[serde(default)]
    pub skills: u32,
    #[serde(default)]
    pub agents: u32,
    #[serde(default)]
    pub hooks: bool,
    #[serde(default)]
    pub mcp_servers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marketplace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Install status from `plugin list --json` (usually `"installed"`). Not enable/disable.
    pub status: String,
    /// Load state from Grok Build config (`[plugins].disabled` / enable CLI).
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_key: Option<String>,
    /// Grok Build scope: user / project / cli / custom path / marketplace name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Component inventory from `grok inspect` (skills / agents / hooks / mcp).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provides: Option<PluginProvidesDto>,
}

/// Run probed CLI with the given args. Returns (stdout, stderr, ok).
fn run_grok_cli_args(args: &[&str], timeout_secs: u64) -> Result<(String, String, bool), String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };

    let args_owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args_owned);
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok((stdout, stderr, output.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run grok: {e}")),
        Err(_) => Err(format!("grok command timed out after {timeout_secs}s")),
    }
}

/// Path to the user-level Grok config that tracks plugin enable/disable.
/// Same file Grok Build reads for `[plugins].enabled` / `[plugins].disabled`.
fn user_grok_config_toml() -> std::path::PathBuf {
    crate::process_util::user_home().join(".grok").join("config.toml")
}

/// Parse a string-array key under `[plugins]` (single- or multi-line).
pub fn parse_plugins_toml_string_array(toml_text: &str, key: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let mut in_plugins = false;
    let mut collecting = false;
    let mut buf = String::new();
    let key_prefix = key;

    for line in toml_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if collecting {
                break;
            }
            in_plugins = trimmed == "[plugins]";
            continue;
        }
        if !in_plugins {
            continue;
        }
        if collecting {
            buf.push(' ');
            buf.push_str(trimmed);
            if trimmed.contains(']') {
                collecting = false;
                for name in extract_toml_string_array(&buf) {
                    out.insert(name);
                }
                buf.clear();
            }
            continue;
        }
        if let Some(rest) = trimmed
            .strip_prefix(key_prefix)
            .map(str::trim)
            .and_then(|s| s.strip_prefix('='))
            .map(str::trim)
        {
            if rest.contains('[') && rest.contains(']') {
                for name in extract_toml_string_array(rest) {
                    out.insert(name);
                }
            } else if rest.contains('[') {
                collecting = true;
                buf = rest.to_string();
            }
        }
    }
    out
}

/// Grok Build config: plugin IDs or plain names listed under `[plugins].disabled`.
pub fn parse_plugins_disabled_names(toml_text: &str) -> std::collections::HashSet<String> {
    parse_plugins_toml_string_array(toml_text, "disabled")
}

fn extract_toml_string_array(s: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' || c == '\'' {
            let quote = c;
            let mut name = String::new();
            while let Some(ch) = chars.next() {
                if ch == quote {
                    break;
                }
                if ch == '\\' {
                    if let Some(escaped) = chars.next() {
                        name.push(escaped);
                    }
                } else {
                    name.push(ch);
                }
            }
            let n = name.trim();
            if !n.is_empty() {
                names.push(n.to_string());
            }
        }
    }
    names
}

fn load_disabled_plugin_entries() -> std::collections::HashSet<String> {
    let path = user_grok_config_toml();
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_plugins_disabled_names(&text),
        Err(_) => std::collections::HashSet::new(),
    }
}

/// Match Grok Build disabled entries: plain name or full id `scope/hash/name`.
pub fn plugin_matches_disabled(
    name: &str,
    repo_key: Option<&str>,
    disabled: &std::collections::HashSet<String>,
) -> bool {
    if disabled.is_empty() {
        return false;
    }
    if disabled.contains(name) {
        return true;
    }
    for entry in disabled {
        let e = entry.trim();
        if e.is_empty() {
            continue;
        }
        // Full plugin id: <scope>/<hash>/<name>
        if let Some((head, tail)) = e.rsplit_once('/') {
            if tail == name {
                // Optional: also match hash against repo_key suffix
                if let Some(rk) = repo_key {
                    if head.ends_with(rk) || rk.ends_with(head.rsplit_once('/').map(|(_, h)| h).unwrap_or(head)) {
                        return true;
                    }
                }
                return true;
            }
        }
        if let Some(rk) = repo_key {
            if e == rk || e.ends_with(&format!("/{rk}")) {
                return true;
            }
        }
    }
    false
}

#[derive(Debug, Clone, Default)]
struct InspectPluginExtra {
    scope: Option<String>,
    provides: Option<PluginProvidesDto>,
}

fn parse_inspect_plugins_map(
    inspect_json: &serde_json::Value,
) -> std::collections::HashMap<String, InspectPluginExtra> {
    let mut map = std::collections::HashMap::new();
    let Some(arr) = inspect_json.get("plugins").and_then(|x| x.as_array()) else {
        return map;
    };
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let scope = item
            .get("scope")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let provides = item.get("provides").map(|p| PluginProvidesDto {
            skills: p
                .get("skills")
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
            agents: p
                .get("agents")
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
            hooks: p.get("hooks").and_then(|x| x.as_bool()).unwrap_or(false),
            mcp_servers: p
                .get("mcpServers")
                .or_else(|| p.get("mcp_servers"))
                .and_then(|x| x.as_u64())
                .unwrap_or(0) as u32,
        });
        let extra = InspectPluginExtra { scope, provides };
        // Key by name and path so duplicate names (e.g. two cloudflare installs) can match path.
        map.insert(name.clone(), extra.clone());
        if let Some(p) = path {
            map.insert(format!("path:{p}"), extra);
        }
    }
    map
}

fn parse_plugin_list_json(
    raw: &str,
    disabled: &std::collections::HashSet<String>,
    inspect_extra: &std::collections::HashMap<String, InspectPluginExtra>,
) -> Result<Vec<PluginDto>, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Failed to parse plugin list JSON: {e}"))?;
    let arr = value
        .as_array()
        .ok_or_else(|| "plugin list JSON is not an array".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let version = item
            .get("version")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let source = item
            .get("source")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let marketplace = item
            .get("marketplace")
            .and_then(|x| {
                if x.is_null() {
                    None
                } else {
                    x.as_str()
                }
            })
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let repo_key = item
            .get("repo_key")
            .or_else(|| item.get("repoKey"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        // Preserve CLI install status verbatim (do not invent "disabled" status).
        let status = item
            .get("status")
            .and_then(|x| x.as_str())
            .unwrap_or("installed")
            .trim()
            .to_string();
        let status = if status.is_empty() {
            "installed".to_string()
        } else {
            status
        };
        let enabled = !plugin_matches_disabled(&name, repo_key.as_deref(), disabled);

        // Prefer path-keyed inspect row, then name.
        let extra = path
            .as_ref()
            .and_then(|p| inspect_extra.get(&format!("path:{p}")))
            .or_else(|| inspect_extra.get(&name));

        // Scope: inspect first, else marketplace name, else "user" for installed-plugins paths.
        let scope = extra
            .and_then(|e| e.scope.clone())
            .or_else(|| marketplace.clone())
            .or_else(|| {
                path.as_ref().and_then(|p| {
                    if p.contains("installed-plugins") {
                        Some("user".into())
                    } else {
                        None
                    }
                })
            });

        out.push(PluginDto {
            name,
            version,
            source,
            marketplace,
            path,
            status,
            enabled,
            repo_key,
            scope,
            provides: extra.and_then(|e| e.provides.clone()),
        });
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| {
                a.repo_key
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.repo_key.as_deref().unwrap_or(""))
            })
    });
    Ok(out)
}

fn collect_plugins_list() -> Result<Vec<PluginDto>, String> {
    // Parallel: install inventory + inspect enrich (scope/provides).
    let list_handle = std::thread::spawn(|| {
        run_grok_cli_args(&["plugin", "list", "--json"], PLUGIN_CMD_TIMEOUT_SECS)
    });
    let inspect_handle =
        std::thread::spawn(|| run_grok_cli_args(&["inspect", "--json"], INSPECT_TIMEOUT_SECS));

    let list_result = list_handle
        .join()
        .map_err(|_| "plugin list worker panicked".to_string())?;
    let (stdout, stderr, ok) = list_result?;
    if !ok {
        let msg: String = if !stderr.is_empty() {
            stderr.chars().take(400).collect()
        } else if !stdout.is_empty() {
            stdout.chars().take(400).collect()
        } else {
            "grok plugin list failed".into()
        };
        return Err(msg);
    }
    if stdout.is_empty() {
        return Ok(Vec::new());
    }
    let disabled = load_disabled_plugin_entries();
    // Best-effort inspect enrich. Failures leave scope/provides empty.
    let inspect_extra = match inspect_handle.join() {
        Ok(Ok((body, _, true))) if !body.is_empty() => {
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(v) => parse_inspect_plugins_map(&v),
                Err(_) => std::collections::HashMap::new(),
            }
        }
        _ => std::collections::HashMap::new(),
    };
    parse_plugin_list_json(&stdout, &disabled, &inspect_extra)
}

/// List installed plugins (Grok Build inventory + enable state + inspect extras).
/// Always returns Ok; on CLI missing / failure, `plugins` is empty and `error` is set.
#[tauri::command]
pub async fn plugins_list() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_plugins_list)
        .await
        .map_err(|e| e.to_string())?;

    match result {
        Ok(plugins) => Ok(serde_json::json!({ "plugins": plugins })),
        Err(e) => Ok(serde_json::json!({
            "plugins": [],
            "error": e,
        })),
    }
}

/// Enable a plugin by name (`grok plugin enable <name>`). Soft-respawns agent.
#[tauri::command]
pub async fn plugin_enable(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("plugin name required".into());
    }
    let name_for_cmd = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "enable", &name_for_cmd],
            PLUGIN_CMD_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to enable plugin {name}")
        };
        return Err(msg.chars().take(400).collect());
    }
    mgr.soft_respawn(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": name,
        "message": stdout.chars().take(200).collect::<String>(),
    }))
}

/// Disable a plugin by name (`grok plugin disable <name>`). Soft-respawns agent.
#[tauri::command]
pub async fn plugin_disable(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("plugin name required".into());
    }
    let name_for_cmd = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "disable", &name_for_cmd],
            PLUGIN_CMD_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to disable plugin {name}")
        };
        return Err(msg.chars().take(400).collect());
    }
    mgr.soft_respawn(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": name,
        "message": stdout.chars().take(200).collect::<String>(),
    }))
}

/// Uninstall a plugin by name. Soft-respawns agent on success.
#[tauri::command]
pub async fn plugin_uninstall(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("plugin name required".into());
    }
    let name_for_cmd = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "uninstall", &name_for_cmd, "--confirm"],
            PLUGIN_CMD_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to uninstall plugin {name}")
        };
        return Err(msg.chars().take(400).collect());
    }
    mgr.soft_respawn(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": name,
        "message": stdout.chars().take(200).collect::<String>(),
    }))
}

/// Plugin component inventory text (`grok plugin details <name>`).
#[tauri::command]
pub async fn plugin_details(name: String) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("plugin name required".into());
    }
    let name_for_cmd = name.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "details", &name_for_cmd],
            PLUGIN_CMD_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to load details for {name}")
        };
        return Err(msg.chars().take(400).collect());
    }
    Ok(serde_json::json!({
        "name": name,
        "details": stdout,
    }))
}

/// Trim install source; reject empty. Accepts path, git URL, or GitHub shorthand.
pub fn normalize_plugin_install_source(source: &str) -> Result<String, String> {
    let s = source.trim();
    if s.is_empty() {
        return Err("plugin source required".into());
    }
    Ok(s.to_string())
}

/// Optional update target: empty / whitespace → update all (`None`).
pub fn normalize_plugin_update_name(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Install from path / git URL / GitHub shorthand (`grok plugin install <source> --trust`).
/// Soft-respawns agent on success. `--trust` is required for non-interactive UI.
#[tauri::command]
pub async fn plugin_install(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    source: String,
) -> Result<serde_json::Value, String> {
    let source = normalize_plugin_install_source(&source)?;
    let source_for_cmd = source.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "install", &source_for_cmd, "--trust"],
            PLUGIN_MUTATE_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to install plugin from {source}")
        };
        return Err(msg.chars().take(400).collect());
    }
    mgr.soft_respawn(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": source,
        "message": stdout.chars().take(400).collect::<String>(),
    }))
}

/// Update one plugin by name, or all when `name` is null/empty (`grok plugin update [name]`).
/// Soft-respawns agent on success.
#[tauri::command]
pub async fn plugin_update(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let target = normalize_plugin_update_name(name.as_deref());
    let target_for_cmd = target.clone();
    let result = tauri::async_runtime::spawn_blocking(move || match target_for_cmd.as_deref() {
        Some(n) => run_grok_cli_args(&["plugin", "update", n], PLUGIN_MUTATE_TIMEOUT_SECS),
        None => run_grok_cli_args(&["plugin", "update"], PLUGIN_MUTATE_TIMEOUT_SECS),
    })
    .await
    .map_err(|e| e.to_string())??;

    let (stdout, stderr, ok) = result;
    if !ok {
        let label = target.as_deref().unwrap_or("all");
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to update plugin(s): {label}")
        };
        return Err(msg.chars().take(400).collect());
    }
    mgr.soft_respawn(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": target.unwrap_or_default(),
        "message": stdout.chars().take(400).collect::<String>(),
    }))
}

#[cfg(test)]
mod plugin_config_tests {
    use super::*;

    #[test]
    fn parse_disabled_single_line() {
        let toml = r#"
[plugins]
enabled = ["a", "b"]
disabled = ["chrome-devtools-mcp", "x"]
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("chrome-devtools-mcp"));
        assert!(set.contains("x"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn parse_disabled_multiline() {
        let toml = r#"
[plugins]
enabled = [
    "cloudflare",
]
disabled = [
    "chrome-devtools-mcp",
    "playwright",
]

[marketplace]
foo = 1
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("chrome-devtools-mcp"));
        assert!(set.contains("playwright"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn parse_disabled_empty() {
        let set = parse_plugins_disabled_names("[plugins]\ndisabled = []\n");
        assert!(set.is_empty());
    }

    #[test]
    fn parse_disabled_ignores_other_sections() {
        let toml = r#"
[other]
disabled = ["nope"]

[plugins]
disabled = ["yes"]
"#;
        let set = parse_plugins_disabled_names(toml);
        assert!(set.contains("yes"));
        assert!(!set.contains("nope"));
    }

    #[test]
    fn matches_full_plugin_id_like_grok_build() {
        let mut disabled = std::collections::HashSet::new();
        disabled.insert("user/a0b23c68/chrome-devtools-mcp".into());
        assert!(plugin_matches_disabled(
            "chrome-devtools-mcp",
            Some("chrome-devtools-mcp-a0b23c68"),
            &disabled
        ));
        assert!(!plugin_matches_disabled("other", None, &disabled));
    }

    #[test]
    fn list_json_keeps_cli_status_and_config_enabled() {
        let raw = r#"[
          {"status":"installed","name":"demo","repo_key":"demo-abc","version":"1.0.0","path":"/tmp/demo","source":"https://example.com/demo","marketplace":null}
        ]"#;
        let mut disabled = std::collections::HashSet::new();
        disabled.insert("demo".into());
        let empty = std::collections::HashMap::new();
        let plugins = parse_plugin_list_json(raw, &disabled, &empty).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].status, "installed"); // CLI install status preserved
        assert!(!plugins[0].enabled); // config disabled
    }

    #[test]
    fn merges_inspect_scope_and_provides() {
        let raw = r#"[
          {"status":"installed","name":"superpowers","repo_key":"superpowers-599","version":"6.1.1","path":"/p/superpowers","source":"https://github.com/obra/superpowers","marketplace":null}
        ]"#;
        let disabled = std::collections::HashSet::new();
        let mut extra = std::collections::HashMap::new();
        extra.insert(
            "path:/p/superpowers".into(),
            InspectPluginExtra {
                scope: Some("user".into()),
                provides: Some(PluginProvidesDto {
                    skills: 14,
                    agents: 0,
                    hooks: true,
                    mcp_servers: 0,
                }),
            },
        );
        let plugins = parse_plugin_list_json(raw, &disabled, &extra).unwrap();
        assert_eq!(plugins[0].scope.as_deref(), Some("user"));
        assert_eq!(plugins[0].provides.as_ref().unwrap().skills, 14);
        assert!(plugins[0].provides.as_ref().unwrap().hooks);
        assert!(plugins[0].enabled);
    }

    #[test]
    fn normalize_install_source_trims_and_rejects_empty() {
        assert_eq!(
            normalize_plugin_install_source("  owner/repo  ").unwrap(),
            "owner/repo"
        );
        assert_eq!(
            normalize_plugin_install_source("https://github.com/a/b.git").unwrap(),
            "https://github.com/a/b.git"
        );
        assert_eq!(
            normalize_plugin_install_source("/tmp/my-plugin").unwrap(),
            "/tmp/my-plugin"
        );
        assert!(normalize_plugin_install_source("").is_err());
        assert!(normalize_plugin_install_source("   ").is_err());
    }

    #[test]
    fn normalize_update_name_empty_means_all() {
        assert_eq!(
            normalize_plugin_update_name(Some("  chrome-devtools-mcp ")).as_deref(),
            Some("chrome-devtools-mcp")
        );
        assert_eq!(normalize_plugin_update_name(Some("")), None);
        assert_eq!(normalize_plugin_update_name(Some("   ")), None);
        assert_eq!(normalize_plugin_update_name(None), None);
    }
}

#[tauri::command]
pub async fn pick_directory() -> Result<Option<String>, String> {
    // rfd must run off the async runtime (main-thread dialog on macOS via spawn_blocking)
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择项目目录 / Choose project folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.map(|p| p.display().to_string()))
}

/// Native multi-file picker for composer attachments. Returns empty vec if cancelled.
#[tauri::command]
pub async fn pick_attach_files() -> Result<Vec<String>, String> {
    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("附加文件 / Attach files")
            .pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(files
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.display().to_string())
        .collect())
}

/// Native folder picker for attaching a directory as `@path` (optional).
#[tauri::command]
pub async fn pick_attach_folder() -> Result<Option<String>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("附加文件夹 / Attach folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.map(|p| p.display().to_string()))
}

/// Save clipboard / webview File bytes into app attachments dir; return classified path.
/// Used when paste has image data without a filesystem path (screenshots, browser copy).
#[tauri::command]
pub async fn save_temp_attachment(
    bytes_base64: String,
    suggested_name: Option<String>,
    mime: Option<String>,
) -> Result<PathEntry, String> {
    use base64::Engine;
    let raw = bytes_base64.trim();
    // Accept data-URL prefix if present
    let b64 = raw
        .split(',')
        .last()
        .unwrap_or(raw)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.is_empty() {
        return Err("empty attachment payload".into());
    }
    // Cap paste size at 40 MiB to avoid runaway memory
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("attachment too large (max 40 MiB)".into());
    }

    let mime = mime.unwrap_or_default().to_lowercase();
    let ext = mime_to_ext(&mime).unwrap_or_else(|| {
        suggested_name
            .as_deref()
            .and_then(|n| {
                std::path::Path::new(n)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_lowercase())
            })
            .unwrap_or_else(|| "bin".into())
    });

    let safe_name = sanitize_attachment_name(
        suggested_name.as_deref(),
        &ext,
    );
    let dir = crate::paths::attachments_paste_dir();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let file_name = format!("{stamp}-{safe_name}");
    let path = dir.join(&file_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("write attachment: {e}"))?;

    let path_str = path.display().to_string();
    Ok(PathEntry {
        path: path_str.clone(),
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or(file_name),
        is_dir: false,
        exists: true,
    })
}

/// Read an image from the OS clipboard (screenshots) and save under attachments/paste.
/// Used when the WebView paste event has no File objects (common on macOS WKWebView).
/// Returns `None` when the clipboard has no image.
#[tauri::command]
pub async fn clipboard_paste_image() -> Result<Option<PathEntry>, String> {
    tauri::async_runtime::spawn_blocking(|| clipboard_paste_image_sync())
        .await
        .map_err(|e| format!("clipboard task: {e}"))?
}

fn clipboard_paste_image_sync() -> Result<Option<PathEntry>, String> {
    use arboard::Clipboard;

    let mut cb = Clipboard::new().map_err(|e| format!("clipboard open: {e}"))?;
    let img = match cb.get_image() {
        Ok(img) => img,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(format!("clipboard image: {e}")),
    };

    let w = img.width;
    let h = img.height;
    if w == 0 || h == 0 {
        return Ok(None);
    }
    let expected = w.saturating_mul(h).saturating_mul(4);
    if img.bytes.len() < expected {
        return Err(format!(
            "clipboard image truncated ({} < {})",
            img.bytes.len(),
            expected
        ));
    }

    let png = rgba_to_png_bytes(w, h, &img.bytes[..expected])?;
    if png.len() > 40 * 1024 * 1024 {
        return Err("attachment too large (max 40 MiB)".into());
    }

    let dir = crate::paths::attachments_paste_dir();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let file_name = format!("{stamp}-paste.png");
    let path = dir.join(&file_name);
    std::fs::write(&path, &png).map_err(|e| format!("write attachment: {e}"))?;

    Ok(Some(PathEntry {
        path: path.display().to_string(),
        name: file_name,
        is_dir: false,
        exists: true,
    }))
}

/// Encode raw RGBA8 pixels as PNG (clipboard / paste path).
fn rgba_to_png_bytes(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    if width == 0 || height == 0 {
        return Err("empty image".into());
    }
    let expected = width.saturating_mul(height).saturating_mul(4);
    if rgba.len() < expected {
        return Err("rgba buffer too short".into());
    }
    let mut png = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png);
    encoder
        .write_image(
            &rgba[..expected],
            width as u32,
            height as u32,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("png encode: {e}"))?;
    if png.is_empty() {
        return Err("png encode produced empty buffer".into());
    }
    Ok(png)
}

#[cfg(test)]
mod clipboard_paste_tests {
    use super::rgba_to_png_bytes;

    #[test]
    fn rgba_one_pixel_encodes_png_signature() {
        // 1×1 opaque red
        let rgba = [255u8, 0, 0, 255];
        let png = rgba_to_png_bytes(1, 1, &rgba).expect("encode");
        assert!(png.len() > 8);
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
    }

    #[test]
    fn rgba_rejects_short_buffer() {
        assert!(rgba_to_png_bytes(2, 2, &[0u8; 4]).is_err());
    }
}

fn mime_to_ext(mime: &str) -> Option<String> {
    let m = mime.split(';').next().unwrap_or(mime).trim();
    Some(
        match m {
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            "image/svg+xml" => "svg",
            "image/heic" => "heic",
            "image/avif" => "avif",
            "application/pdf" => "pdf",
            "text/plain" => "txt",
            "text/markdown" => "md",
            "application/json" => "json",
            "video/mp4" => "mp4",
            "video/webm" => "webm",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/wav" | "audio/x-wav" => "wav",
            _ => return None,
        }
        .into(),
    )
}

fn sanitize_attachment_name(suggested: Option<&str>, ext: &str) -> String {
    let base = suggested
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("paste");
    let stem = std::path::Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("paste");
    let mut cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        cleaned = "paste".into();
    }
    // Cap stem length
    if cleaned.len() > 64 {
        cleaned.truncate(64);
    }
    let has_ext = std::path::Path::new(base)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false);
    if has_ext {
        format!("{cleaned}.{ext}")
    } else {
        format!("{cleaned}.{ext}")
    }
}

/// Classify dropped / picked paths for drag-drop UX (file vs folder).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub exists: bool,
}

/// Normalize OS / browser path strings (file:// URLs, percent-encoding, trailing slashes).
fn normalize_fs_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return s;
    }
    // file://localhost/Users/... or file:///Users/...
    if let Some(rest) = s.strip_prefix("file://") {
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        s = rest.to_string();
        // percent-decode common escapes (spaces, CJK, etc.)
        if s.contains('%') {
            if let Ok(decoded) = urlencoding_lite_decode(&s) {
                s = decoded;
            }
        }
    }
    // drop trailing slash except root
    while s.len() > 1 && (s.ends_with('/') || s.ends_with('\\')) {
        s.pop();
    }
    s
}

/// Minimal percent-decoder (avoid extra crate).
fn urlencoding_lite_decode(input: &str) -> Result<String, ()> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = |c: u8| -> Option<u8> {
                    match c {
                        b'0'..=b'9' => Some(c - b'0'),
                        b'a'..=b'f' => Some(c - b'a' + 10),
                        b'A'..=b'F' => Some(c - b'A' + 10),
                        _ => None,
                    }
                };
                match (h(bytes[i + 1]), h(bytes[i + 2])) {
                    (Some(a), Some(b)) => {
                        out.push((a << 4) | b);
                        i += 3;
                    }
                    _ => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

#[tauri::command]
pub fn paths_classify(paths: Vec<String>) -> Vec<PathEntry> {
    paths
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .map(|raw| {
            let p = normalize_fs_path(&raw);
            let pb = std::path::PathBuf::from(&p);
            let name = pb
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| p.clone());
            // Prefer metadata; if path is missing, still return entry so UI can attach it.
            let meta = std::fs::metadata(&pb).ok();
            let exists = meta.is_some();
            let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
            PathEntry {
                path: p,
                name,
                is_dir,
                exists,
            }
        })
        .collect()
}

/// Open a file or folder with the OS default application.
#[tauri::command]
pub async fn path_open(path: String) -> Result<(), String> {
    let p = normalize_fs_path(&path);
    if p.is_empty() {
        return Err("empty path".into());
    }
    let pb = std::path::PathBuf::from(&p);
    if !pb.exists() {
        return Err(format!("path not found: {p}"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &p])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Optional git unified diff for a path under a project (session Changes panel).
/// Soft-fails: returns `available: false` when git is missing, path is outside
/// the repo, or the file has no diff — never hard-requires git.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffResult {
    pub available: bool,
    pub diff: Option<String>,
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn git_file_diff(
    project_path: String,
    path: String,
) -> Result<GitFileDiffResult, String> {
    let project = normalize_fs_path(&project_path);
    let target = normalize_fs_path(&path);
    if project.is_empty() || target.is_empty() {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: None,
            reason: Some("project not a directory".into()),
        });
    }

    // Prefer project-relative when under root (git -C wants repo-relative paths).
    let rel = {
        let t = std::path::PathBuf::from(&target);
        match t.strip_prefix(&proj) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                // Also try string prefix (macOS /var vs /private/var etc. is best-effort)
                let p = project.trim_end_matches('/').replace('\\', "/");
                let a = target.replace('\\', "/");
                if a.starts_with(&(p.clone() + "/")) {
                    a[p.len() + 1..].to_string()
                } else {
                    target.clone()
                }
            }
        }
    };
    if rel.is_empty() || rel == "." {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: None,
            reason: Some("not a file path".into()),
        });
    }

    // Soft check: is git on PATH?
    let git_ok = std::process::Command::new("git")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !git_ok {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("git not available".into()),
        });
    }

    // Confirm we are inside a work tree
    let inside = std::process::Command::new("git")
        .args(["-C", &project, "rev-parse", "--is-inside-work-tree"])
        .output();
    let inside_ok = inside
        .as_ref()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside_ok {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("not a git repository".into()),
        });
    }

    // Working tree + index vs HEAD (covers staged and unstaged edits).
    let out = std::process::Command::new("git")
        .args([
            "-C",
            &project,
            "diff",
            "--no-color",
            "--no-ext-diff",
            "HEAD",
            "--",
            &rel,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        // Untracked new file: try against empty tree
        let untracked = std::process::Command::new("git")
            .args([
                "-C",
                &project,
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                &rel,
            ])
            .output();
        if let Ok(u) = untracked {
            // git --no-index exits 1 when files differ — still useful
            let text = String::from_utf8_lossy(&u.stdout).to_string();
            if !text.trim().is_empty() {
                return Ok(GitFileDiffResult {
                    available: true,
                    diff: Some(text.chars().take(400_000).collect()),
                    relative_path: Some(rel),
                    reason: None,
                });
            }
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some(if err.is_empty() {
                "git diff failed".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() {
        // Maybe untracked
        let untracked = std::process::Command::new("git")
            .args([
                "-C",
                &project,
                "ls-files",
                "--error-unmatch",
                "--",
                &rel,
            ])
            .status();
        let tracked = untracked.map(|s| s.success()).unwrap_or(false);
        if !tracked {
            // Show full file as addition via --no-index when possible
            let abs = proj.join(&rel);
            if abs.is_file() {
                let u = std::process::Command::new("git")
                    .args([
                        "-C",
                        &project,
                        "diff",
                        "--no-color",
                        "--no-ext-diff",
                        "--no-index",
                        "--",
                        "/dev/null",
                        abs.to_string_lossy().as_ref(),
                    ])
                    .output();
                if let Ok(u) = u {
                    let t = String::from_utf8_lossy(&u.stdout).to_string();
                    if !t.trim().is_empty() {
                        return Ok(GitFileDiffResult {
                            available: true,
                            diff: Some(t.chars().take(400_000).collect()),
                            relative_path: Some(rel),
                            reason: None,
                        });
                    }
                }
            }
        }
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("no diff".into()),
        });
    }

    Ok(GitFileDiffResult {
        available: true,
        diff: Some(text.chars().take(400_000).collect()),
        relative_path: Some(rel),
        reason: None,
    })
}

// ── Workspace git status (Changes panel: Session + Workspace) ──────────────

/// Soft-check git on PATH + project is inside a work tree.
fn git_probe_work_tree(project: &str) -> Result<(), String> {
    let git_ok = std::process::Command::new("git")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !git_ok {
        return Err("git not available".into());
    }
    let inside = std::process::Command::new("git")
        .args(["-C", project, "rev-parse", "--is-inside-work-tree"])
        .output();
    let inside_ok = inside
        .as_ref()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside_ok {
        return Err("not a git repository".into());
    }
    Ok(())
}

/// One row from `git status --porcelain=v1` for the Workspace Changes section.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    /// Repo-relative path (forward slashes).
    pub path: String,
    /// Absolute path under the project root when possible.
    pub absolute_path: String,
    /// Two-char porcelain code (e.g. ` M`, `M `, `??`, `A `).
    pub status: String,
    /// Index (staged) status char, or space.
    pub index_status: String,
    /// Worktree status char, or space.
    pub worktree_status: String,
    /// Coarse kind: modified | added | deleted | untracked | renamed | copied | typechange | conflict | ignored | unknown
    pub kind: String,
    /// Basename for list rows.
    pub name: String,
    /// Rename/copy source path when present.
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub available: bool,
    pub files: Vec<GitStatusEntry>,
    pub branch: Option<String>,
    pub reason: Option<String>,
}

/// Classify porcelain XY code into a coarse kind string (mirrors frontend helper).
fn git_status_kind(x: char, y: char) -> &'static str {
    if x == '?' && y == '?' {
        return "untracked";
    }
    if x == '!' && y == '!' {
        return "ignored";
    }
    if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        return "conflict";
    }
    // Prefer worktree letter, then index
    for c in [y, x] {
        match c {
            'R' => return "renamed",
            'C' => return "copied",
            'A' => return "added",
            'D' => return "deleted",
            'T' => return "typechange",
            'M' => return "modified",
            _ => {}
        }
    }
    if x != ' ' || y != ' ' {
        return "modified";
    }
    "unknown"
}

fn git_entry_basename(rel: &str) -> String {
    let n = rel.replace('\\', "/");
    n.rsplit('/').next().unwrap_or(rel).to_string()
}

/// Parse one porcelain v1 line into an entry (pure; unit-tested).
#[cfg(test)]
fn parse_porcelain_line(line: &str, project: &str) -> Option<GitStatusEntry> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() < 3 {
        return None;
    }
    let bytes = line.as_bytes();
    // Standard: XY SPACE path…  (status is always 2 chars)
    let x = bytes[0] as char;
    let y = bytes[1] as char;
    // Must have a separator after XY
    if bytes.len() < 4 {
        return None;
    }
    // skip optional space after XY
    let rest = line[2..].trim_start();
    if rest.is_empty() {
        return None;
    }

    let (path, original_path) = if rest.contains(" -> ") {
        // rename / copy: "old -> new"
        let mut parts = rest.splitn(2, " -> ");
        let old = parts.next().unwrap_or("").trim().to_string();
        let new = parts.next().unwrap_or("").trim().to_string();
        if new.is_empty() {
            return None;
        }
        (new, if old.is_empty() { None } else { Some(old) })
    } else {
        // Unquoted path (porcelain without -z does not quote unless special chars;
        // strip surrounding quotes when present).
        let p = rest.trim().trim_matches('"').to_string();
        (p, None)
    };

    let path = path.replace('\\', "/");
    if path.is_empty() {
        return None;
    }

    let abs = join_project_rel(project, &path);

    let status = format!("{x}{y}");
    Some(GitStatusEntry {
        path: path.clone(),
        absolute_path: abs,
        status,
        index_status: x.to_string(),
        worktree_status: y.to_string(),
        kind: git_status_kind(x, y).to_string(),
        name: git_entry_basename(&path),
        original_path,
    })
}

/// Join project root + repo-relative path with `/` for UI (platform-neutral).
fn join_project_rel(project: &str, rel: &str) -> String {
    let root = project.trim_end_matches(['/', '\\']).replace('\\', "/");
    let r = rel.trim_start_matches('/').replace('\\', "/");
    if root.is_empty() {
        r
    } else if r.is_empty() {
        root
    } else {
        format!("{root}/{r}")
    }
}

/// List modified / untracked / added files under a project (Workspace Changes).
/// Soft-fails when git is missing or the path is not a repo.
#[tauri::command]
pub async fn git_status(project_path: String) -> Result<GitStatusResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some("project not a directory".into()),
        });
    }

    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some(reason),
        });
    }

    let branch = std::process::Command::new("git")
        .args(["-C", &project, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b.is_empty() || b == "HEAD" {
                    None
                } else {
                    Some(b)
                }
            } else {
                None
            }
        });

    // Porcelain v1: untracked as `??`, no ignored noise, relative paths.
    let out = std::process::Command::new("git")
        .args([
            "-C",
            &project,
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "-z",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch,
            reason: Some(if err.is_empty() {
                "git status failed".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    // -z: records separated by NUL. Each record is `XY path` or for renames
    // `XY` + space + old + NUL + new (git uses two NUL fields for rename).
    // Actually with -z: "XY path\0" and for rename "R  oldpath\0newpath\0".
    let raw = out.stdout;
    let mut files: Vec<GitStatusEntry> = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        // find next NUL
        let end = raw[i..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| i + p)
            .unwrap_or(raw.len());
        if end == i {
            break;
        }
        let chunk = String::from_utf8_lossy(&raw[i..end]).into_owned();
        i = end + 1;

        if chunk.len() < 3 {
            continue;
        }
        let x = chunk.as_bytes()[0] as char;
        let y = chunk.as_bytes()[1] as char;
        // After XY there is a space then path (when not rename split).
        let rest = chunk[2..].trim_start();

        // Rename/copy: first field is "XY oldpath", second field (next NUL record) is newpath.
        let is_rename = x == 'R' || x == 'C' || y == 'R' || y == 'C';
        let (path, original_path) = if is_rename && i < raw.len() {
            let end2 = raw[i..]
                .iter()
                .position(|&b| b == 0)
                .map(|p| i + p)
                .unwrap_or(raw.len());
            let newp = String::from_utf8_lossy(&raw[i..end2])
                .trim()
                .replace('\\', "/");
            i = end2 + 1;
            let old = rest.trim().replace('\\', "/");
            (newp, if old.is_empty() { None } else { Some(old) })
        } else {
            (rest.trim().replace('\\', "/"), None)
        };

        if path.is_empty() {
            continue;
        }

        let abs = join_project_rel(&project, &path);

        files.push(GitStatusEntry {
            path: path.clone(),
            absolute_path: abs,
            status: format!("{x}{y}"),
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            kind: git_status_kind(x, y).to_string(),
            name: git_entry_basename(&path),
            original_path,
        });
    }

    // Cap for UI responsiveness
    if files.len() > 2000 {
        files.truncate(2000);
    }

    Ok(GitStatusResult {
        available: true,
        files,
        branch,
        reason: None,
    })
}

/// File content at HEAD for a path under a project (before snapshot for diffs).
/// Soft-fails for untracked files / missing git / binary truncation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowFileResult {
    pub available: bool,
    pub content: Option<String>,
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn git_show_file(
    project_path: String,
    path: String,
) -> Result<GitShowFileResult, String> {
    let project = normalize_fs_path(&project_path);
    let target = normalize_fs_path(&path);
    if project.is_empty() || target.is_empty() {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("project not a directory".into()),
        });
    }

    let rel = {
        let t = std::path::PathBuf::from(&target);
        match t.strip_prefix(&proj) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                let p = project.trim_end_matches('/').replace('\\', "/");
                let a = target.replace('\\', "/");
                if a.starts_with(&(p.clone() + "/")) {
                    a[p.len() + 1..].to_string()
                } else {
                    // path may already be repo-relative
                    target.replace('\\', "/")
                }
            }
        }
    };
    if rel.is_empty() || rel == "." {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("not a file path".into()),
        });
    }

    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some(reason),
        });
    }

    // `git show HEAD:path` — fails for untracked / missing at HEAD
    let out = std::process::Command::new("git")
        .args(["-C", &project, "show", &format!("HEAD:{rel}")])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some(if err.is_empty() {
                "not in HEAD".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    // Reject obvious binary (NUL in first 8k)
    let sample_end = out.stdout.len().min(8192);
    if out.stdout[..sample_end].contains(&0) {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some("binary file".into()),
        });
    }

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(GitShowFileResult {
        available: true,
        content: Some(text.chars().take(400_000).collect()),
        relative_path: Some(rel),
        reason: None,
    })
}

#[cfg(test)]
mod git_status_parse_tests {
    use super::*;

    #[test]
    fn porcelain_modified_worktree() {
        let e = parse_porcelain_line(" M src/app.ts", "/proj").expect("entry");
        assert_eq!(e.path, "src/app.ts");
        assert_eq!(e.status, " M");
        assert_eq!(e.kind, "modified");
        assert_eq!(e.name, "app.ts");
        assert!(e.absolute_path.ends_with("src/app.ts"));
    }

    #[test]
    fn porcelain_untracked() {
        let e = parse_porcelain_line("?? new.md", "/proj").expect("entry");
        assert_eq!(e.kind, "untracked");
        assert_eq!(e.path, "new.md");
    }

    #[test]
    fn porcelain_added_staged() {
        let e = parse_porcelain_line("A  foo/bar.rs", "/repo").expect("entry");
        assert_eq!(e.kind, "added");
        assert_eq!(e.index_status, "A");
    }

    #[test]
    fn porcelain_rename() {
        let e = parse_porcelain_line("R  old.ts -> new.ts", "/repo").expect("entry");
        assert_eq!(e.kind, "renamed");
        assert_eq!(e.path, "new.ts");
        assert_eq!(e.original_path.as_deref(), Some("old.ts"));
    }

    #[test]
    fn porcelain_conflict() {
        let e = parse_porcelain_line("UU merge.txt", "/repo").expect("entry");
        assert_eq!(e.kind, "conflict");
    }

    #[test]
    fn porcelain_deleted() {
        let e = parse_porcelain_line(" D gone.ts", "/repo").expect("entry");
        assert_eq!(e.kind, "deleted");
    }

    #[test]
    fn kind_helpers() {
        assert_eq!(git_status_kind('?', '?'), "untracked");
        assert_eq!(git_status_kind('M', ' '), "modified");
        assert_eq!(git_status_kind(' ', 'M'), "modified");
        assert_eq!(git_status_kind('A', ' '), "added");
        assert_eq!(git_status_kind('D', ' '), "deleted");
    }
}

// ── Git worktrees (issue #42) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreesResult {
    pub available: bool,
    pub worktrees: Vec<GitWorktreeEntry>,
    pub reason: Option<String>,
}

/// Parse `git worktree list --porcelain` (pure; unit-tested).
pub fn parse_worktree_porcelain(raw: &str) -> Vec<GitWorktreeEntry> {
    let text = raw.replace("\r\n", "\n");
    if text.trim().is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut path = String::new();
        let mut head: Option<String> = None;
        let mut branch: Option<String> = None;
        let mut detached = false;
        let mut locked = false;
        let mut prunable = false;

        for line in block.lines() {
            let t = line.trim_end();
            if let Some(rest) = t.strip_prefix("worktree ") {
                path = rest.trim().replace('\\', "/");
                while path.ends_with('/') && path.len() > 1 {
                    path.pop();
                }
            } else if let Some(rest) = t.strip_prefix("HEAD ") {
                let h = rest.trim();
                head = if h.is_empty() {
                    None
                } else {
                    Some(h.to_string())
                };
            } else if let Some(rest) = t.strip_prefix("branch ") {
                let r = rest.trim();
                branch = if let Some(name) = r.strip_prefix("refs/heads/") {
                    Some(name.to_string())
                } else if r.is_empty() {
                    None
                } else {
                    Some(r.to_string())
                };
            } else if t == "detached" {
                detached = true;
            } else if t.starts_with("locked") {
                locked = true;
            } else if t.starts_with("prunable") {
                prunable = true;
            }
        }

        if path.is_empty() {
            continue;
        }
        if detached {
            branch = None;
        }
        out.push(GitWorktreeEntry {
            path,
            head,
            branch,
            detached,
            is_main: out.is_empty(),
            locked,
            prunable,
        });
    }
    // First entry is main
    for (i, w) in out.iter_mut().enumerate() {
        w.is_main = i == 0;
    }
    out
}

/// List linked git worktrees for a project folder. Soft-fails without git / non-repo.
#[tauri::command]
pub async fn git_worktrees_list(project_path: String) -> Result<GitWorktreesResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some("project not a directory".into()),
        });
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some(reason),
        });
    }

    let out = std::process::Command::new("git")
        .args(["-C", &project, "worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some(if err.is_empty() {
                "git worktree list failed".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    let worktrees = parse_worktree_porcelain(&raw);
    Ok(GitWorktreesResult {
        available: true,
        worktrees,
        reason: None,
    })
}

#[cfg(test)]
mod git_worktree_parse_tests {
    use super::*;

    #[test]
    fn parses_main_and_linked() {
        let raw = "\
worktree /Users/me/repo
HEAD abcdef
branch refs/heads/main

worktree /Users/me/repo-feat
HEAD fedcba
branch refs/heads/feat/x

worktree /Users/me/repo-d
HEAD 112233
detached
";
        let list = parse_worktree_porcelain(raw);
        assert_eq!(list.len(), 3);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch.as_deref(), Some("feat/x"));
        assert!(!list[1].is_main);
        assert!(list[2].detached);
        assert!(list[2].branch.is_none());
    }

    #[test]
    fn empty_input() {
        assert!(parse_worktree_porcelain("").is_empty());
    }
}

/// Reveal a path in the system file manager (Finder / Explorer).
#[tauri::command]
pub async fn path_reveal(path: String) -> Result<(), String> {
    let p = normalize_fs_path(&path);
    if p.is_empty() {
        return Err("empty path".into());
    }
    let pb = std::path::PathBuf::from(&p);
    if !pb.exists() {
        return Err(format!("path not found: {p}"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &p])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // explorer /select,<path> — works with spaces on modern Windows.
        std::process::Command::new("explorer")
            .arg(format!("/select,{p}"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Open parent directory
        let parent = pb
            .parent()
            .map(|x| x.to_path_buf())
            .unwrap_or(pb.clone());
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Add project via native folder dialog; optional auto-trust.
#[tauri::command]
pub async fn project_add_dialog(trust: bool) -> Result<Option<Project>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("添加项目 / Add project")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = folder else {
        return Ok(None);
    };
    let p = store::add_project(path.display().to_string(), trust)?;
    Ok(Some(p))
}

// ── Official Grok Build account ─────────────────────────────────────────────

#[tauri::command]
pub async fn account_status(
    refresh_billing: Option<bool>,
    manual_cli_path: Option<String>,
) -> Result<crate::account::AccountStatus, String> {
    let settings = store::load_settings();
    let manual = manual_cli_path
        .or(settings.manual_cli_path)
        .filter(|s| !s.is_empty());
    Ok(crate::account::account_status(manual.as_deref(), refresh_billing.unwrap_or(true)).await)
}

#[tauri::command]
pub async fn account_login(
    method: Option<String>,
    manual_cli_path: Option<String>,
) -> Result<crate::account::LoginResult, String> {
    let settings = store::load_settings();
    let manual = manual_cli_path
        .or(settings.manual_cli_path)
        .filter(|s| !s.is_empty());
    let method = method.unwrap_or_else(|| "oauth".into());
    Ok(crate::account::account_login(&method, manual.as_deref()).await)
}

/// Abort a running `grok login` (OAuth / device-code). No-op if none is running.
#[tauri::command]
pub async fn account_login_cancel() -> Result<(), String> {
    crate::account::account_login_cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn account_logout(
    manual_cli_path: Option<String>,
) -> Result<crate::account::AccountProfile, String> {
    let settings = store::load_settings();
    let manual = manual_cli_path
        .or(settings.manual_cli_path)
        .filter(|s| !s.is_empty());
    crate::account::account_logout(manual.as_deref()).await
}

#[tauri::command]
pub async fn account_open_usage() -> Result<(), String> {
    crate::account::open_usage_manage().await
}

#[tauri::command]
pub async fn account_open_subscribe() -> Result<(), String> {
    crate::account::open_subscribe().await
}

// ── Multi-account profiles ─────────────────────────────────────────────────

#[tauri::command]
pub fn accounts_list() -> crate::account_profiles::AccountsListResult {
    crate::account_profiles::list_accounts()
}

#[tauri::command]
pub fn account_save_current(label: Option<String>) -> Result<crate::account_profiles::SavedAccount, String> {
    crate::account_profiles::save_current_account(label)
}

#[tauri::command]
pub async fn account_switch(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
) -> Result<crate::account::AccountProfile, String> {
    let profile = crate::account_profiles::switch_account(&id)?;
    // Soft-drop live agent so next send uses the new credentials.
    let _ = mgr.disconnect(app).await;
    Ok(profile)
}

#[tauri::command]
pub fn account_remove(id: String) -> Result<(), String> {
    crate::account_profiles::remove_account(&id)
}

#[tauri::command]
pub fn account_rename(
    id: String,
    label: String,
) -> Result<crate::account_profiles::SavedAccount, String> {
    crate::account_profiles::rename_account(&id, &label)
}

/// Import a markdown/JSON transcript into a new local session (Grok web history alternative).
#[tauri::command]
pub fn session_import_transcript(
    text: String,
    title: Option<String>,
    project_id: Option<String>,
) -> Result<store::SessionMeta, String> {
    crate::session_import::import_transcript_as_session(&text, title, project_id)
}

/// Native file picker → read text transcript → import as session.
#[tauri::command]
pub async fn session_import_transcript_file(
    title: Option<String>,
    project_id: Option<String>,
) -> Result<Option<store::SessionMeta>, String> {
    let path = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Import conversation / 导入对话")
            .add_filter("Transcript", &["md", "txt", "json", "markdown"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = path else {
        return Ok(None);
    };
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read file: {e}"))?;
    let derived_title = title.or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    });
    let meta =
        crate::session_import::import_transcript_as_session(&text, derived_title, project_id)?;
    Ok(Some(meta))
}

// ── Custom providers (agent-home config.toml) ───────────────────────────────

#[tauri::command]
pub async fn providers_list() -> Result<crate::providers::ProvidersListResult, String> {
    // One-time migration of legacy single relay secrets → multi-provider config.
    let secrets = store::load_secrets();
    let _ = crate::providers::maybe_migrate_legacy_relay(
        secrets.relay_base_url.as_deref(),
        secrets.relay_api_key.as_deref(),
        secrets.default_model.as_deref(),
    );
    // Cap agent transport retries (host still circuit-breaks at 5 via retry_state).
    let _ = crate::providers::ensure_models_retry_cap();
    // Fix bases saved without /v1 (causes silent multi-minute inference retries).
    let _ = crate::providers::repair_custom_base_urls();
    crate::providers::list_custom_providers()
}

/// Activate official Grok Build or a custom provider; returns updated list.
#[tauri::command]
pub async fn providers_activate(
    source: String,
    provider_id: Option<String>,
) -> Result<crate::providers::ProvidersListResult, String> {
    let result =
        crate::providers::activate_provider(&source, provider_id.as_deref())?;
    // Composer model stays a catalog id (UI). Channel is `[models].default`.
    // When leaving a custom route, drop stale provider ids from settings.
    let mut settings = store::load_settings();
    let cur = settings.model_id.clone().unwrap_or_default();
    if result.active_source == "official" {
        if cur.is_empty()
            || crate::providers::is_custom_provider_id(&cur)
            || cur == crate::providers::OFFICIAL_DEFAULT_MODEL
        {
            settings.model_id =
                Some(crate::providers::OFFICIAL_CATALOG_MODEL.into());
            let _ = store::save_settings(&settings);
        }
    } else if result.active_source == "custom" {
        // Keep catalog model in settings for the model picker; spawn resolves route id.
        if cur.is_empty() || crate::providers::is_custom_provider_id(&cur) {
            if let Some(p) = result
                .active_provider_id
                .as_ref()
                .and_then(|id| result.providers.iter().find(|x| x.id == *id))
            {
                let upstream = p.model.trim();
                settings.model_id = Some(if upstream.is_empty() {
                    crate::providers::OFFICIAL_CATALOG_MODEL.into()
                } else {
                    upstream.to_string()
                });
            } else {
                settings.model_id =
                    Some(crate::providers::OFFICIAL_CATALOG_MODEL.into());
            }
            let _ = store::save_settings(&settings);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn providers_upsert(
    id: String,
    model: String,
    base_url: String,
    name: Option<String>,
    api_key: Option<String>,
    api_backend: Option<String>,
    set_as_default: Option<bool>,
    create_only: Option<bool>,
) -> Result<crate::providers::ProvidersListResult, String> {
    let result = crate::providers::upsert_custom_provider(crate::providers::UpsertProviderInput {
        id,
        model: model.clone(),
        base_url,
        name,
        api_key,
        api_backend,
        set_as_default,
        create_only,
    })?;
    // Keep legacy secrets in sync for Doctor / account channel display.
    if let Some(p) = result.providers.iter().find(|p| p.is_default).or(result.providers.first())
    {
        let mut secrets = store::load_secrets();
        secrets.relay_base_url = Some(p.base_url.clone());
        secrets.default_model = result.default_model.clone();
        // Do not copy api_key into secrets (stays only in config.toml).
        let _ = store::save_secrets(&secrets);
        if set_as_default.unwrap_or(false) {
            let mut settings = store::load_settings();
            // Composer shows upstream request model, not the route slug.
            let upstream = p.model.trim();
            settings.model_id = Some(if upstream.is_empty() {
                crate::providers::OFFICIAL_CATALOG_MODEL.into()
            } else {
                upstream.to_string()
            });
            let _ = store::save_settings(&settings);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn providers_remove(id: String) -> Result<crate::providers::ProvidersListResult, String> {
    crate::providers::remove_custom_provider(&id)
}

#[tauri::command]
pub async fn providers_set_default(
    model_id: String,
) -> Result<crate::providers::ProvidersListResult, String> {
    // Prefer activate_provider so auth material is rebound correctly.
    let id = model_id.trim();
    let list = crate::providers::list_custom_providers()?;
    let result = if list.providers.iter().any(|p| p.id == id) {
        crate::providers::activate_provider("custom", Some(id))?
    } else {
        crate::providers::activate_provider("official", None)?
    };
    let mut settings = store::load_settings();
    if result.active_source == "custom" {
        if let Some(p) = result
            .active_provider_id
            .as_ref()
            .and_then(|pid| result.providers.iter().find(|x| x.id == *pid))
        {
            let upstream = p.model.trim();
            settings.model_id = Some(if upstream.is_empty() {
                crate::providers::OFFICIAL_CATALOG_MODEL.into()
            } else {
                upstream.to_string()
            });
        }
    } else {
        settings.model_id = Some(crate::providers::OFFICIAL_CATALOG_MODEL.into());
    }
    let _ = store::save_settings(&settings);
    Ok(result)
}

#[tauri::command]
pub async fn providers_ping(
    base_url: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<crate::providers::ProviderPingResult, String> {
    crate::providers::ping_provider(base_url, api_key, provider_id).await
}

#[tauri::command]
pub async fn providers_list_models(
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<crate::providers::RemoteModelsResult, String> {
    crate::providers::list_remote_models(base_url, api_key, provider_id).await
}

// ── Editors ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn editors_list() -> Result<crate::editors::EditorsListResult, String> {
    Ok(crate::editors::list_editors_with_icons())
}

#[tauri::command]
pub async fn open_in_editor(
    path: String,
    line: Option<u32>,
    editor: Option<String>,
) -> Result<(), String> {
    let settings = store::load_settings();
    let target = editor
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| settings.default_open_target.clone());
    crate::editors::open_in_editor(&path, line, Some(target.as_str()))
}
