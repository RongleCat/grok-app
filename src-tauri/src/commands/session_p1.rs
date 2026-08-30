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
        if out.is_empty() { None } else { Some(out) }
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

/// Connect the live slot to an agent process (cold spawn or warm reuse).
#[tauri::command]
pub async fn session_connect(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    project_path: Option<String>,
    session_id: Option<String>,
    mode: Option<String>,
    ssh_alias: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.connect(app, project_path, session_id, mode, ssh_alias)
        .await
}

/// Fire-and-forget prewarm: spawn + initialize + auth a CLI process while the
/// user is composing a new chat, so the first send is near-instant. No session
/// is created — the chat's project cwd is bound at `session/new` on submit.
#[tauri::command]
pub async fn session_prewarm(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    let mgr = mgr.inner().clone();
    tauri::async_runtime::spawn(async move {
        mgr.prewarm(app).await;
    });
    Ok(())
}

/// Send a turn. `text` goes to the agent; optional `display_text` is stored in the journal
/// (skill chips as `[[skill:name]]`) so history can re-render tags.
/// Optional `attachments` are persisted on the user journal row so history can
/// re-show image/file cards (agent text still carries `@path` via the FE prompt).
///
/// `session_id` binds the turn to a chat so a concurrent connect cannot route it
/// into whichever session happens to hold the live slot. Omitting it keeps the
/// legacy "current focus" behaviour for single-session callers.
#[tauri::command]
pub async fn session_send(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    text: String,
    display_text: Option<String>,
    attachments: Option<Vec<store::MessageAttachmentStored>>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.send_message(app, text, display_text, attachments, session_id)
        .await
}

/// Pending command from an interrupted turn lease (Continue chip).
#[tauri::command]
pub fn session_interrupt_context(
    session_id: String,
) -> Option<crate::turn_interrupt::InterruptContext> {
    crate::turn_interrupt::interrupt_context(&session_id)
}

/// Inject guidance into the active turn without cancelling the running prompt.
/// `session_id` binds the interjection to a chat (live or background).
#[tauri::command]
pub async fn session_interject(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    text: String,
    display_text: Option<String>,
    attachments: Option<Vec<store::MessageAttachmentStored>>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.interject_message(app, text, display_text, attachments, session_id)
        .await
}

/// Drop last user turn on agent + local journal (edit & resend).
#[tauri::command]
pub async fn session_rewind_drop_last_user(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.rewind_drop_last_user_turn(app, session_id).await
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
///
/// When `fork_agent_session` is true and the source has an agent id, the new
/// chat carries that id with a one-shot fork flag so the next connect uses
/// CLI `--fork-session` semantics (ACP `session/fork` → new agent id).
#[tauri::command]
pub fn session_fork(
    source_id: String,
    through_user_prompt_index: Option<u32>,
    title: Option<String>,
    fork_agent_session: Option<bool>,
) -> Result<store::SessionMeta, String> {
    store::fork_session(
        &source_id,
        through_user_prompt_index,
        title,
        fork_agent_session.unwrap_or(false),
    )
}

/// Set the one-shot CLI `--fork-session` flag (new agent id on next connect).
/// Soft-respawns the live agent for this chat when the flag is armed so the
/// next connect can fork instead of reusing the warm process.
#[tauri::command]
pub async fn session_set_fork_agent_session(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    fork_agent_session: bool,
) -> Result<store::SessionMeta, String> {
    let meta = store::set_session_fork_agent_session(&id, fork_agent_session)?;
    let snap = mgr.snapshot();
    if fork_agent_session && snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_fork_agent")
            .await;
    }
    Ok(meta)
}

#[tauri::command]
pub async fn session_stop(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.stop(app, session_id).await
}

/// Approve / revise / abandon pending plan (`_x.ai/exit_plan_mode`).
#[tauri::command]
pub async fn session_resolve_plan(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    decision: String,
    feedback: Option<String>,
    rpc_id: Option<u64>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    let target = session_id.clone().filter(|s| !s.trim().is_empty());
    let result = mgr
        .resolve_plan(app, decision.clone(), feedback, rpc_id, session_id)
        .await;
    if result.is_ok() {
        if let Some(sid) =
            target.or_else(|| mgr.snapshot().session_id.filter(|s| !s.trim().is_empty()))
        {
            crate::plan_chrome::apply_decision(&sid, &decision, true);
        }
    }
    result
}

/// Load persisted plan chrome for an app session (P1 resume).
#[tauri::command]
pub fn session_plan_chrome_get(
    session_id: String,
) -> Result<Option<crate::plan_chrome::PlanChromeStored>, String> {
    Ok(crate::plan_chrome::load_plan_chrome_for_ui(&session_id))
}

/// Save plan chrome from the UI (hard dismiss / soft hide).
#[tauri::command]
pub fn session_plan_chrome_set(
    session_id: String,
    chrome: crate::plan_chrome::PlanChromeStored,
) -> Result<(), String> {
    crate::plan_chrome::save_plan_chrome(&session_id, &chrome)
}

/// Read agent-side plan_mode.json + plan.md for the app session (resume UI).
#[tauri::command]
pub fn session_agent_plan_snapshot(
    session_id: String,
) -> Result<crate::plan_chrome::AgentPlanSnapshot, String> {
    Ok(crate::plan_chrome::load_agent_plan_snapshot(&session_id))
}

/// Answer or dismiss pending `_x.ai/ask_user_question`.
#[tauri::command]
pub async fn session_resolve_ask_user(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    decision: String,
    answers: Option<serde_json::Value>,
    rpc_id: Option<u64>,
    session_id: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.resolve_ask_user(app, decision, answers, rpc_id, session_id)
        .await
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
#[allow(clippy::too_many_arguments)]
pub async fn session_resolve_permission(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    rpc_id: u64,
    decision: String,
    option_id: Option<String>,
    scope_key: Option<String>,
    session_id: Option<String>,
    // Optional UI options snapshot for wire-id coerce when Host pending is empty (#542).
    options: Option<serde_json::Value>,
    tool_name: Option<String>,
) -> Result<SessionSnapshot, String> {
    mgr.resolve_permission(
        app, rpc_id, decision, option_id, scope_key, session_id, options, tool_name,
    )
    .await
}

/// Still-pending permission card for a chat, if any. Frontend calls this on
/// session open to recover an approval bar whose one-shot
/// `session://permission` emit was missed (WebView reload / window remount) —
/// otherwise the turn looks stuck "thinking" with no way to answer.
#[tauri::command]
pub async fn session_pending_permission(
    mgr: State<'_, Arc<SessionManager>>,
    session_id: Option<String>,
) -> Result<Option<crate::session_manager::UiPermissionRequest>, String> {
    Ok(mgr.pending_permission(session_id))
}

/// Still-pending questionnaire for a chat. Pulled on session open to recover an
/// ask-user gate whose one-shot `session://ask_user` emit was missed (WebView
/// reload / window remount) — otherwise the agent stays blocked on the reverse
/// RPC and the chat looks stuck "thinking" with nothing to answer.
#[tauri::command]
pub async fn session_pending_ask_user(
    mgr: State<'_, Arc<SessionManager>>,
    session_id: Option<String>,
) -> Result<Option<crate::session_manager::UiAskUserRequest>, String> {
    Ok(mgr.pending_ask_user(session_id))
}

#[tauri::command]
pub async fn probe_cli(manual_path: Option<String>) -> Result<CliProbeResult, String> {
    // probe_cli runs `grok --version` (sync I/O). Never block a Tokio worker —
    // a hung binary used to freeze the setup gate ("Checking Grok Build…") forever.
    // When Settings → CLI backend is WSL, probe inside the distro instead of PATH.
    tokio::task::spawn_blocking(move || {
        let settings = store::load_settings();
        // When Settings → CLI backend is WSL, probe inside the distro instead of PATH.
        crate::wsl_backend::probe_cli_for_settings(&settings, manual_path.as_deref())
    })
    .await
    .map_err(|e| format!("probe_cli join: {e}"))
}

/// WSL availability, distro list, and optional CLI probe (Settings → Runtime).
#[tauri::command]
pub async fn wsl_status() -> Result<crate::wsl_backend::WslStatus, String> {
    tokio::task::spawn_blocking(|| {
        let settings = store::load_settings();
        crate::wsl_backend::wsl_status(&settings)
    })
    .await
    .map_err(|e| format!("wsl_status join: {e}"))
}

/// Relink/copy `~/.grok/bin/agent` to match the probed `grok` binary (skew repair).
///
/// App ACP always spawns `grok`; this only helps external TUI / tooling that uses
/// the `agent` sidecar. Soft-fails when grok is missing.
#[tauri::command]
pub async fn cli_repair_agent_sidecar(
    grok_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let path = grok_path
        .or_else(|| store::load_settings().manual_cli_path)
        .filter(|s| !s.trim().is_empty());
    let path_for_probe = path.clone();
    let repaired =
        tokio::task::spawn_blocking(move || cli_probe::repair_agent_sidecar_link(path.as_deref()))
            .await
            .map_err(|e| format!("cli_repair_agent_sidecar join: {e}"))??;
    let after =
        tokio::task::spawn_blocking(move || cli_probe::probe_cli(path_for_probe.as_deref()))
            .await
            .map_err(|e| format!("re-probe join: {e}"))?;
    Ok(serde_json::json!({
        "ok": true,
        "agentPath": repaired,
        "agentBinarySkew": after.agent_binary_skew,
        "agentVersion": after.agent_version,
        "grokVersion": after.version,
    }))
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

/// Settings health check: TCP connect only (~2s). No secrets, no ACP RPC.
#[tauri::command]
pub async fn acp_server_probe(
    addr: String,
) -> Result<crate::acp_client::AcpServerProbeResult, String> {
    let addr = addr.trim();
    if addr.is_empty() {
        return Err("empty address".into());
    }
    Ok(crate::acp_client::acp_server_probe(addr).await)
}

/// Download + install latest Grok Build (multi-mirror, progress via `setup://cli-install-progress`).
///
/// `allow_unverified`: optional; when omitted, uses Settings
/// `allowUnverifiedCliInstall`. Missing published checksums are allowed by
/// default; this flag (or env) only overrides `GROK_CLI_REQUIRE_CHECKSUM`.
/// Checksum **mismatch** always aborts.
#[tauri::command]
pub async fn cli_install_latest(
    app: tauri::AppHandle,
    allow_unverified: Option<bool>,
) -> Result<crate::cli_install::CliInstallResult, String> {
    let allow =
        allow_unverified.unwrap_or_else(|| store::load_settings().allow_unverified_cli_install);
    let result = crate::cli_install::install_cli_latest(app, allow).await?;
    // Remember last install verification for Doctor.
    let mut s = store::load_settings();
    s.last_cli_checksum_verified = result.checksum_verified;
    let _ = store::save_settings(&s);
    Ok(result)
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
        // Windows rebinds after add_filter; other platforms keep the builder immutable.
        #[cfg(target_os = "windows")]
        {
            let dlg = rfd::FileDialog::new()
                .set_title("Select Grok Build binary / 选择 Grok Build 可执行文件")
                .add_filter("Executable", &["exe", "cmd", "bat"]);
            dlg.pick_file()
        }
        #[cfg(not(target_os = "windows"))]
        {
            rfd::FileDialog::new()
                .set_title("Select Grok Build binary / 选择 Grok Build 可执行文件")
                .pick_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.map(|p| p.display().to_string()))
}

/// Native file picker for an agent profile (markdown / any file).
#[tauri::command]
pub async fn pick_agent_profile() -> Result<Option<String>, String> {
    let file = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select agent profile / 选择 Agent profile 文件")
            .add_filter("Agent profile", &["md", "markdown", "json", "toml"])
            .add_filter("All files", &["*"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(file.map(|p| {
        crate::path_scope::grant_path(&p);
        p.display().to_string()
    }))
}

/// Query GitHub Releases for a newer App version (Settings → About).
#[tauri::command]
pub async fn app_check_update() -> Result<crate::app_update::AppUpdateCheck, String> {
    crate::app_update::check_app_update().await
}

/// Open a URL in the system browser (docs, install pages).
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    open_http_url(url.trim())
}

/// Shared http(s) open helper (also used by account login).
///
/// Windows uses `rundll32 url.dll,FileProtocolHandler` so query `&` is not
/// split by `cmd /C start`, and no console window flashes (Fixes #162).
pub fn open_http_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("empty url".into());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs allowed".into());
    }
    // Reject control characters that could smuggle extra commands.
    if url.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r') {
        return Err("invalid url".into());
    }
    #[cfg(target_os = "macos")]
    {
        crate::process_util::command("open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Avoid `cmd /C start` — it re-parses `&` in query strings as command separators.
        crate::process_util::command("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        crate::process_util::command("xdg-open")
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

/// Default cwd for chats without a bound project folder (`workspaces/general`).
/// Not a sidebar project — only the on-disk directory.
#[tauri::command]
pub async fn general_workspace_path() -> Result<String, String> {
    store::general_workspace_path_string()
}

#[tauri::command]
pub async fn project_add(path: String, trust: bool) -> Result<Project, String> {
    store::add_project(path, trust)
}

#[tauri::command]
pub async fn project_add_ssh(
    alias: String,
    path: String,
    trust: bool,
) -> Result<Project, String> {
    store::add_ssh_project(&alias, path, trust)
}

#[tauri::command]
pub async fn project_remove(id: String) -> Result<(), String> {
    // Unlink from app only — disk folder + sessions retained.
    store::remove_project(&id)
}

/// Update project folder path after the directory moved or was renamed.
/// Verifies the new path is a directory and sets `path_ok` true.
#[tauri::command]
pub async fn project_relocate(id: String, path: String) -> Result<Project, String> {
    store::relocate_project(&id, path)
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

/// Set or clear the project-level OS sandbox profile.
/// `profile = null` / empty / `"inherit"` → fall back to app Settings.
/// When this project is the live Host context, soft-respawn so the flag applies.
#[tauri::command]
pub async fn project_set_sandbox_profile(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    profile: Option<String>,
) -> Result<Project, String> {
    let p = store::set_project_sandbox_profile(&id, profile)?;
    let (live_proj, _) = mgr.current_context_ids();
    if live_proj.as_deref() == Some(id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "project_sandbox").await;
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

/// Reorder sidebar projects by explicit id list.
/// Host always re-applies pin partition so nothing sits above pinned projects.
#[tauri::command]
pub async fn projects_reorder(ordered_ids: Vec<String>) -> Result<Vec<Project>, String> {
    store::reorder_projects(ordered_ids)
}

/// Set or clear a project sidebar accent color.
/// `color = null` / empty / `"none"` clears the accent.
/// Accepts named tokens (`blue`|`green`|…) or `#rgb`/`#rrggbb`.
#[tauri::command]
pub async fn project_set_color(id: String, color: Option<String>) -> Result<Project, String> {
    store::set_project_color(&id, color)
}

/// Reveal project folder in the OS file manager (Finder / Explorer / Files).
#[tauri::command]
pub async fn project_reveal(id: String) -> Result<(), String> {
    let list = store::load_projects();
    let p = list
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    let pb = std::path::PathBuf::from(&p.path);
    tokio::task::spawn_blocking(move || crate::process_util::reveal_in_file_manager(&pb))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn project_archive_sessions(id: String) -> Result<usize, String> {
    store::archive_project_sessions(&id)
}

#[tauri::command]
pub async fn sessions_list() -> Result<Vec<SessionMeta>, String> {
    Ok(store::load_sessions_index())
}

/// Scan App journal messages for case-insensitive content matches.
/// Returns session id, title, snippet, match count (capped work).
#[tauri::command]
pub async fn sessions_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<crate::session_content_search::SessionContentHit>, String> {
    let lim = limit.unwrap_or(20).min(50) as usize;
    // Blocking disk scan — run off the async runtime.
    let q = query;
    tauri::async_runtime::spawn_blocking(move || {
        crate::session_content_search::search_sessions(&q, lim)
    })
    .await
    .map_err(|e| e.to_string())
}

/// List Grok Build CLI sessions under GROK_HOME (shared-mode discovery, E03).
#[tauri::command]
pub async fn cli_sessions_list() -> Result<Vec<crate::cli_sessions::CliSessionSummary>, String> {
    let mode = store::load_settings().session_data_mode;
    crate::cli_sessions::list_cli_sessions(&mode)
}

/// Search CLI sessions via `grok sessions search` (summaries + first prompts).
/// Falls back to local disk filter (incl. first prompt) when CLI is unavailable.
#[tauri::command]
pub async fn cli_sessions_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<crate::cli_sessions::CliSessionSearchHit>, String> {
    let settings = store::load_settings();
    let mode = settings.session_data_mode.clone();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let cli_path = probe
        .path
        .filter(|_| probe.found)
        .map(std::path::PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        crate::cli_sessions::search_cli_sessions(&query, limit, &mode, cli_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import one CLI session (chat_history.jsonl) into the App journal.
#[tauri::command]
pub async fn cli_session_import(
    agent_session_id: String,
    dir: Option<String>,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let mode = store::load_settings().session_data_mode;
    crate::cli_sessions::import_cli_session(&agent_session_id, dir.as_deref(), project_id, &mode)
}

/// Find the most recent CLI agent session for a project path (CLI `-c/--continue`).
/// Returns `None` when no session exists (soft-fail).
#[tauri::command]
pub async fn cli_session_find_latest_for_cwd(
    project_path: String,
) -> Result<Option<crate::cli_sessions::CliSessionSummary>, String> {
    let mode = store::load_settings().session_data_mode;
    let path = project_path;
    tauri::async_runtime::spawn_blocking(move || {
        crate::cli_sessions::find_latest_cli_session_for_cwd(&path, &mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// CLI `-c/--continue`: find latest agent session for project path and
/// open/import it as an App session. `None` when no agent session exists.
#[tauri::command]
pub async fn cli_session_continue_cwd(
    project_path: String,
    project_id: Option<String>,
) -> Result<Option<SessionMeta>, String> {
    let mode = store::load_settings().session_data_mode;
    tauri::async_runtime::spawn_blocking(move || {
        crate::cli_sessions::continue_cli_session_for_cwd(&project_path, project_id, &mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Import up to `limit` not-yet-linked CLI sessions (default 50).
#[tauri::command]
pub async fn cli_sessions_import_all(limit: Option<u32>) -> Result<Vec<SessionMeta>, String> {
    let mode = store::load_settings().session_data_mode;
    let lim = limit.unwrap_or(50).min(100) as usize;
    crate::cli_sessions::import_all_cli_sessions(&mode, lim)
}

/// Delete one on-disk CLI session under active GROK_HOME (path-scoped).
/// App-linked chats are left intact.
#[tauri::command]
pub async fn cli_sessions_delete(
    agent_session_id: String,
    dir: Option<String>,
) -> Result<(), String> {
    let mode = store::load_settings().session_data_mode;
    // Blocking disk IO off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        crate::cli_sessions::delete_cli_session(&agent_session_id, dir.as_deref(), &mode)
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn session_set_scheduled(id: String, scheduled: bool) -> Result<SessionMeta, String> {
    store::set_session_scheduled(&id, scheduled)
}

/// Force-quit the process after frontend busy-session confirm (or when no confirm needed).
/// Bypasses CloseRequested so we do not re-enter the confirm loop.
/// Clears any host pending-quit failsafe timer first.
#[tauri::command]
pub fn app_force_quit(app: tauri::AppHandle) {
    crate::pending_quit::clear_and_exit(app);
}

/// User dismissed the busy-quit confirm (or cancelled exit). Disarms the host
/// failsafe so the app stays open. No-op when no pending quit is armed.
#[tauri::command]
pub fn app_cancel_pending_quit() {
    crate::pending_quit::cancel_pending_quit();
}

/// Primary workbench window label (matches tauri.conf.json + frontend multiWindow).
const MAIN_WINDOW_LABEL: &str = "main";

/// Secondary session window label prefix (`session-<uuid>`). Matches frontend `multiWindow.ts`.
const SESSION_WINDOW_LABEL_PREFIX: &str = "session-";

/// Sanitize a session id for Tauri window labels (ASCII alnum / `-` / `_` only).
fn sanitize_session_id_for_label(session_id: &str) -> Option<&str> {
    let id = session_id.trim();
    if id.is_empty() {
        return None;
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(id)
}

fn session_window_label(session_id: &str) -> Option<String> {
    sanitize_session_id_for_label(session_id).map(|id| format!("{SESSION_WINDOW_LABEL_PREFIX}{id}"))
}

/// Open (or focus) a secondary webview window for a chat (`#/session/<id>`).
///
/// Secondary windows are live-capable (send/stop/warm-connect via the shared
/// Host session-keyed agent pool). Concurrent connect demotes busy peers to
/// background (stream continues) rather than killing them. Re-opening the same
/// session focuses the existing window instead of spawning a third copy.
#[tauri::command]
pub fn open_session_window(
    app: tauri::AppHandle,
    session_id: String,
    title: Option<String>,
) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let sid = sanitize_session_id_for_label(&session_id)
        .ok_or_else(|| "invalid session id for window label".to_string())?;
    let label = session_window_label(sid).expect("sid already sanitized");

    let win_title = title
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|t| format!("Grok · {t}"))
        .unwrap_or_else(|| "Grok".to_string());

    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_title(&win_title);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    // Deep link: frontend parses `#/session/<id>` on boot (secondary live mode).
    let url = format!("index.html#/session/{sid}");
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(win_title)
        .inner_size(1000.0, 720.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()
        .map_err(|e| format!("open session window: {e}"))?;
    #[cfg(windows)]
    crate::win_shell::attach_webview_keyboard_focus(&window);
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

/// Focus (show / unminimize) the primary workbench window from a secondary pane.
#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let w = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    Ok(())
}

#[cfg(test)]
mod multi_window_tests {
    use super::*;

    #[test]
    fn sanitize_session_id_accepts_uuid() {
        let id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        assert_eq!(sanitize_session_id_for_label(id), Some(id));
        assert_eq!(
            session_window_label(id).as_deref(),
            Some("session-a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        );
    }

    #[test]
    fn sanitize_session_id_rejects_path_junk() {
        assert!(sanitize_session_id_for_label("").is_none());
        assert!(sanitize_session_id_for_label("bad id").is_none());
        assert!(sanitize_session_id_for_label("../x").is_none());
        assert!(sanitize_session_id_for_label("a/b").is_none());
        assert!(session_window_label(" ").is_none());
    }
}

#[tauri::command]
pub async fn session_delete(mgr: State<'_, Arc<SessionManager>>, id: String) -> Result<(), String> {
    store::delete_session(&id)?;
    mgr.forget_deleted_session(&id);
    Ok(())
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

#[tauri::command]
pub async fn session_set_pinned(id: String, pinned: bool) -> Result<SessionMeta, String> {
    store::set_session_pinned(&id, pinned)
}

/// Attach or clear worktree path/branch on a session (sidebar WT badge).
#[tauri::command]
pub async fn session_set_worktree(
    id: String,
    worktree_path: Option<String>,
    worktree_branch: Option<String>,
) -> Result<SessionMeta, String> {
    store::set_session_worktree(&id, worktree_path, worktree_branch)
}

/// Set or clear the optional JSON Schema for structured model output.
/// When the session is live, disconnect so the next connect re-spawns with
/// top-level `grok --json-schema` (prompt-side wrap still applies immediately).
#[tauri::command]
pub async fn session_set_json_schema(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    json_schema: Option<String>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_json_schema(&id, json_schema)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        let _ = mgr.disconnect(app).await;
    }
    Ok(meta)
}

/// Move session under a project (or clear project → orphan / 「其他会话」).
/// Internal / fork-restore path — does not reset agent identity.
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

/// User-facing move: confirm already happened in the UI.
/// Refuses mid-turn, untrusted, or missing folders; clears agent + worktree.
#[tauri::command]
pub async fn session_move_to_project(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    // Validate the target and detect no-ops *before* killing the agent —
    // a refused or same-project move must not cost this chat its live ACP
    // process and agent_session_id.
    let plan = store::precheck_session_move(&id, project_id.clone())?;
    if !plan.cwd_changes {
        return store::move_session_to_project(&id, project_id);
    }
    if mgr.session_is_busy(&id) {
        return Err("session_move_busy".into());
    }
    mgr.drop_session_agent(&app, &id).await;
    let meta = store::move_session_to_project(&id, project_id)?;
    let work_dir = meta
        .project_id
        .as_deref()
        .and_then(|pid| {
            store::load_projects()
                .into_iter()
                .find(|p| p.id == pid)
                .map(|p| p.path)
        })
        .or_else(|| store::general_workspace_path_string().ok())
        .unwrap_or_default();
    let _ = crate::remote_im::retarget_bindings_for_app_session(
        &meta.id,
        meta.project_id.clone(),
        &work_dir,
    );
    Ok(meta)
}

/// Set session-only plugin directories (`--plugin-dir` at next spawn).
/// Empty clears. Does not change global Extensions / installed plugins.
/// Soft-respawns the live agent when this chat is the active shell.
#[tauri::command]
pub async fn session_set_plugin_dirs(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    plugin_dirs: Vec<String>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_plugin_dirs(&id, plugin_dirs)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_plugin_dirs")
            .await;
    }
    Ok(meta)
}

/// Set or clear per-session extra rules (`grok --rules` at next spawn).
/// Empty / whitespace clears. Soft-respawns the live agent for this chat.
#[tauri::command]
pub async fn session_set_extra_rules(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    extra_rules: Option<String>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_extra_rules(&id, extra_rules)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_extra_rules")
            .await;
    }
    Ok(meta)
}

/// Set or clear per-session max agent turns (`grok --max-turns` at next spawn).
/// `None` / `0` clears (inherit global). Soft-respawns the live agent for this chat.
#[tauri::command]
pub async fn session_set_max_agent_turns(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    max_agent_turns: Option<u32>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_max_agent_turns(&id, max_agent_turns)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_max_agent_turns")
            .await;
    }
    Ok(meta)
}

/// Set or clear per-session system prompt override
/// (`grok --system-prompt-override` at next spawn).
/// Empty / whitespace clears. Soft-respawns the live agent for this chat.
/// Never logs the prompt body (may contain secrets / PII).
#[tauri::command]
pub async fn session_set_system_prompt_override(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    system_prompt_override: Option<String>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_system_prompt_override(&id, system_prompt_override)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_system_prompt_override")
            .await;
    }
    Ok(meta)
}

/// Set or clear per-session `--no-ask-user` override (CLI ≥ 0.2.117).
/// `None` inherits global Settings. Soft-respawns the live agent for this chat.
#[tauri::command]
pub async fn session_set_no_ask_user(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    id: String,
    no_ask_user: Option<bool>,
) -> Result<SessionMeta, String> {
    let meta = store::set_session_no_ask_user(&id, no_ask_user)?;
    let snap = mgr.snapshot();
    if snap.session_id.as_deref() == Some(meta.id.as_str()) {
        mgr.soft_respawn_with_reason(&app, "session_no_ask_user")
            .await;
    }
    Ok(meta)
}

/// Load the App journal for a session.
///
/// `reconcile` (default **true**): merge missing assistant / tool rows from the
/// linked agent `chat_history.jsonl` / `updates.jsonl`. Fast session **switch**
/// paths pass `false` so rapid sidebar clicks do not re-parse large agent logs
/// (Windows freeze under concurrent opens). Callers may re-request with
/// `reconcile: true` once the user settles on a chat.
#[tauri::command]
pub async fn session_messages(
    id: String,
    reconcile: Option<bool>,
) -> Result<Vec<store::ChatMessageStored>, String> {
    let do_reconcile = reconcile.unwrap_or(true);
    // Disk + optional full jsonl parse must not block the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        if do_reconcile {
            let _ = crate::cli_sessions::try_reconcile_linked_session(&id);
        }
        Ok(store::load_messages(&id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Absolute path of the agent session folder under GROK_HOME (images/, etc.).
/// Used to resolve short relative paths like `images/1.jpg` into image cards.
#[tauri::command]
pub async fn session_media_root(id: String) -> Result<Option<String>, String> {
    Ok(resolve_session_media_root(&id))
}

/// Loopback media HTTP endpoint (`baseUrl` + `token`) for local file previews.
/// Frontend builds `http://127.0.0.1:{port}/v1/media?t=…&p=…` for absolute paths.
#[tauri::command]
pub async fn media_server_endpoint(
    app: tauri::AppHandle,
) -> Result<crate::media_server::MediaServerEndpoint, String> {
    use tauri::Manager;
    let handle = app
        .try_state::<crate::media_server::MediaServerHandle>()
        .ok_or_else(|| "media server not running".to_string())?;
    Ok(handle.endpoint())
}

/// Metadata for a bounded raw-IPC media read.
///
/// Used by full-file consumers when WebView2 blocks JavaScript loopback fetch
/// before the request can reach the media server's CORS handler.
#[tauri::command]
pub async fn media_file_info(path: String) -> Result<crate::media_server::MediaFileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || crate::media_server::ipc_file_info(&path))
        .await
        .map_err(|e| format!("media_file_info task failed: {e}"))?
}

/// Read one bounded raw byte chunk from an allowlisted local media file.
#[tauri::command]
pub async fn media_read_file_chunk(
    path: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::media_server::ipc_read_file_chunk(&path, offset, length)
    })
    .await
    .map_err(|e| format!("media_read_file_chunk task failed: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}
