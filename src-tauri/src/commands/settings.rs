#[tauri::command]
pub async fn settings_get() -> Result<AppSettings, String> {
    Ok(store::load_settings())
}

/// One-shot notice after corrupt store files were quarantined on load.
#[tauri::command]
pub fn store_take_quarantine() -> Option<String> {
    store::take_store_quarantine()
}

#[tauri::command]
pub async fn settings_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let prev = store::load_settings();
    let mut settings = settings;
    // Normalize denylist / allowlist so spawn / equality see stable lists.
    settings.disallowed_tools =
        crate::acp_client::normalize_disallowed_tools(&settings.disallowed_tools);
    settings.allowed_tools =
        crate::acp_client::normalize_allowed_tools(&settings.allowed_tools);
    // Normalize optional agent profile path (trim / drop control chars).
    settings.agent_profile_path =
        crate::agents_catalog::normalize_agent_profile_path(&settings.agent_profile_path)
            .unwrap_or_default();
    // Normalize / validate optional agents JSON (reject invalid non-empty).
    settings.agents_json =
        crate::agents_catalog::normalize_agents_json(&settings.agents_json)?;
    // Headless background-wait policy (CLI 0.2.117+); clamp timeout 1–3600.
    settings.background_wait_policy =
        crate::acp_client::normalize_background_wait_policy(&settings.background_wait_policy)
            .as_str()
            .to_string();
    settings.background_wait_timeout_sec =
        crate::acp_client::normalize_background_wait_timeout_sec(
            settings.background_wait_timeout_sec,
        );
    // Normalize compaction mode/detail enums (CLI 0.2.117+).
    settings.compaction_mode =
        crate::acp_client::normalize_compaction_mode(&settings.compaction_mode).to_string();
    settings.compaction_detail =
        crate::acp_client::normalize_compaction_detail(&settings.compaction_detail).to_string();
    // Audit ledger retention presets: 7 / 30 / 90 / 0 (unlimited).
    settings.audit_ledger_retention_days =
        crate::audit_ledger::normalize_retention_days(settings.audit_ledger_retention_days);
    let audit_retention_flip = crate::audit_ledger::normalize_retention_days(
        prev.audit_ledger_retention_days,
    ) != settings.audit_ledger_retention_days;
    let keychain_flip =
        prev.store_api_keys_in_keychain != settings.store_api_keys_in_keychain;
    let session_data_mode_changed =
        prev.session_data_mode != settings.session_data_mode;
    let memory_flip = prev.experimental_memory != settings.experimental_memory;
    let web_search_flip = prev.disable_web_search != settings.disable_web_search;
    let official_aux_inject_flip =
        prev.official_aux_inject != settings.official_aux_inject
            || prev.official_aux_with_user_mcp != settings.official_aux_with_user_mcp;
    // Keep native-Imagine PreToolUse hook in sync with inject / route (independent home only).
    if official_aux_inject_flip || session_data_mode_changed {
        let mode = settings.session_data_mode.clone();
        let _ = crate::official_aux::sync_native_media_block_hook_for_current(&mode);
    }
    let no_ask_user_flip = prev.no_ask_user != settings.no_ask_user;
    let disallowed_tools_flip = !crate::acp_client::disallowed_tools_equal(
        &prev.disallowed_tools,
        &settings.disallowed_tools,
    );
    let allowed_tools_flip = !crate::acp_client::allowed_tools_equal(
        &prev.allowed_tools,
        &settings.allowed_tools,
    );
    // Normalize TodoGate max fires (1–20; 0 → default 3).
    settings.todo_gate_max_fires_per_prompt =
        crate::agent_todo_gate::normalize_todo_gate_max_fires(Some(
            settings.todo_gate_max_fires_per_prompt,
        ));
    let todo_gate_flip = prev.todo_gate_enabled != settings.todo_gate_enabled
        || crate::agent_todo_gate::normalize_todo_gate_max_fires(Some(
            prev.todo_gate_max_fires_per_prompt,
        )) != settings.todo_gate_max_fires_per_prompt;
    let plan_enabled_flip = prev.plan_enabled != settings.plan_enabled;
    let use_leader_changed = prev.use_leader != settings.use_leader;
    let subagents_flip = prev.subagents_enabled != settings.subagents_enabled;
    let subagent_wt_snap_flip = prev.subagent_worktree_snapshot_enabled
        != settings.subagent_worktree_snapshot_enabled;
    let auto_wake_flip = prev.auto_wake_enabled != settings.auto_wake_enabled;
    let workflows_flip = prev.workflows_enabled != settings.workflows_enabled;
    let two_pass_compaction_flip =
        prev.two_pass_compaction_enabled != settings.two_pass_compaction_enabled;
    let preferred_agent_flip =
        prev.preferred_agent.trim() != settings.preferred_agent.trim();
    let agent_profile_flip = prev.agent_profile_path.trim() != settings.agent_profile_path.trim();
    let agents_json_flip = prev.agents_json.trim() != settings.agents_json.trim();
    let max_turns_flip = prev.max_agent_turns != settings.max_agent_turns;
    let bg_wait_flip = !crate::acp_client::background_wait_settings_equal(
        &prev.background_wait_policy,
        prev.background_wait_timeout_sec,
        &settings.background_wait_policy,
        settings.background_wait_timeout_sec,
    );
    let sandbox_flip = prev.sandbox_profile.trim() != settings.sandbox_profile.trim();
    let compaction_flip = {
        let prev_m = crate::acp_client::normalize_compaction_mode(&prev.compaction_mode);
        let next_m = settings.compaction_mode.as_str();
        let prev_d = crate::acp_client::normalize_compaction_detail(&prev.compaction_detail);
        let next_d = settings.compaction_detail.as_str();
        prev_m != next_m || prev_d != next_d
    };
    // API-mode address is a spawn-path flip (local CLI ↔ TCP). Soft-respawn so
    // the next connect uses the new target; mid-turn sessions stay skipped.
    let proxy_flip = prev.proxy_mode.trim() != settings.proxy_mode.trim()
        || prev.proxy_url.as_deref().map(str::trim) != settings.proxy_url.as_deref().map(str::trim)
        || prev.proxy_no_proxy.as_deref().map(str::trim)
            != settings.proxy_no_proxy.as_deref().map(str::trim);
    let acp_addr_flip = {
        let a = prev
            .acp_server_addr
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let b = settings
            .acp_server_addr
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        a != b
    };
    let launch_at_login_flip = prev.launch_at_login != settings.launch_at_login;
    let schedules_launch_agent_flip =
        prev.schedules_launch_agent != settings.schedules_launch_agent;

    store::save_settings(&settings)?;

    if schedules_launch_agent_flip {
        let res = if settings.schedules_launch_agent {
            crate::schedules_launch_agent::enable()
        } else {
            crate::schedules_launch_agent::disable()
        };
        if let Err(e) = res {
            let mut rolled = settings.clone();
            rolled.schedules_launch_agent = prev.schedules_launch_agent;
            let _ = store::save_settings(&rolled);
            return Err(format!("schedules LaunchAgent: {e}"));
        }
        // Non-macOS enable is unsupported — keep flag false.
        #[cfg(not(target_os = "macos"))]
        if settings.schedules_launch_agent {
            let mut rolled = settings.clone();
            rolled.schedules_launch_agent = false;
            let _ = store::save_settings(&rolled);
            settings.schedules_launch_agent = false;
        }
    }

    if keychain_flip {
        if let Err(e) =
            crate::secrets::apply_keychain_preference(settings.store_api_keys_in_keychain)
        {
            let mut rolled = settings.clone();
            rolled.store_api_keys_in_keychain = prev.store_api_keys_in_keychain;
            let _ = store::save_settings(&rolled);
            return Err(e);
        }
    }

    if launch_at_login_flip {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        let res = if settings.launch_at_login {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        if let Err(e) = res {
            let mut rolled = settings.clone();
            rolled.launch_at_login = prev.launch_at_login;
            let _ = store::save_settings(&rolled);
            return Err(format!("launch at login: {e}"));
        }
    }

    if session_data_mode_changed {
        // Custom route + shared mode cannot see agent-home config.toml.
        // Self-heal back to independent and return the value that actually landed.
        if settings.session_data_mode == "shared"
            && crate::providers::ensure_independent_for_custom_route()
        {
            settings = store::load_settings();
            tracing::info!(
                "settings_set: custom route self-healed session_data_mode shared → independent"
            );
        }
        // Rebuild media/fs roots so shared (`~/.grok`) vs independent agent-home
        // switch takes effect for media:// previews immediately.
        crate::path_scope::refresh_from_store();
        mgr.recycle_all_agents(&app, "session_data_mode").await;
    }

    let mut need_soft_respawn = false;
    if memory_flip {
        if let Err(e) = crate::agent_memory::sync_memory_to_agent_profile(
            &settings.session_data_mode,
            settings.experimental_memory,
        ) {
            tracing::warn!("settings_set sync memory profile: {e}");
        }
        need_soft_respawn = true;
    }
    if subagents_flip {
        if let Err(e) = crate::agent_subagents::sync_subagents_to_agent_profile(
            &settings.session_data_mode,
            settings.subagents_enabled,
        ) {
            tracing::warn!("settings_set sync subagents profile: {e}");
        }
        need_soft_respawn = true;
    }
    if todo_gate_flip {
        if let Err(e) = crate::agent_todo_gate::sync_todo_gate_to_agent_profile(
            &settings.session_data_mode,
            settings.todo_gate_enabled,
            settings.todo_gate_max_fires_per_prompt,
        ) {
            tracing::warn!("settings_set sync todo_gate profile: {e}");
        }
        need_soft_respawn = true;
    }
    if subagent_wt_snap_flip {
        if let Err(e) = crate::agent_subagent_wt_snap::sync_subagent_wt_snap_to_agent_profile(
            &settings.session_data_mode,
            settings.subagent_worktree_snapshot_enabled,
        ) {
            tracing::warn!("settings_set sync subagent_wt_snap profile: {e}");
        }
        need_soft_respawn = true;
    }
    if auto_wake_flip {
        if let Err(e) = crate::agent_auto_wake::sync_auto_wake_to_agent_profile(
            &settings.session_data_mode,
            settings.auto_wake_enabled,
        ) {
            tracing::warn!("settings_set sync auto_wake profile: {e}");
        }
        need_soft_respawn = true;
    }
    if workflows_flip {
        if let Err(e) = crate::agent_workflows::sync_workflows_to_agent_profile(
            &settings.session_data_mode,
            settings.workflows_enabled,
        ) {
            tracing::warn!("settings_set sync workflows profile: {e}");
        }
        need_soft_respawn = true;
    }
    if two_pass_compaction_flip {
        if let Err(e) = crate::agent_two_pass_compaction::sync_two_pass_compaction_to_agent_profile(
            &settings.session_data_mode,
            settings.two_pass_compaction_enabled,
        ) {
            tracing::warn!("settings_set sync two_pass_compaction profile: {e}");
        }
        need_soft_respawn = true;
    }
    if web_search_flip
        || official_aux_inject_flip
        || no_ask_user_flip
        || disallowed_tools_flip
        || allowed_tools_flip
        || plan_enabled_flip
        || use_leader_changed
        || preferred_agent_flip
        || agent_profile_flip
        || agents_json_flip
        || max_turns_flip
        || bg_wait_flip
        || sandbox_flip
        || compaction_flip
        || acp_addr_flip
        || proxy_flip
    {
        need_soft_respawn = true;
    }
    if need_soft_respawn {
        mgr.soft_respawn_with_reason(&app, "settings_spawn").await;
    }

    if let Err(e) = mgr
        .apply_permission_policy(&app, &settings.permission_policy)
        .await
    {
        tracing::warn!("settings_set apply_permission: {e}");
    }
    if let Err(e) = crate::tray::refresh_menu(&app) {
        tracing::warn!("settings_set tray refresh: {e}");
    }
    if let Err(e) = crate::app_menu::refresh(&app) {
        tracing::warn!("settings_set app menu refresh: {e}");
    }
    // Apply audit ledger retention when the preset changes (soft-fail I/O).
    if audit_retention_flip {
        let days = settings.audit_ledger_retention_days;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = crate::audit_ledger::prune_ledger(Some(days)) {
                tracing::warn!(target: "grok_app::audit_ledger", "settings prune: {e}");
            }
        })
        .await;
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
#[allow(clippy::too_many_arguments)]
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
    // Effort is per-chat, so a draft (`sessionId: null`) must keep its `None`:
    // falling back to the live session wrote the draft's effort into whichever
    // chat was still running and soft-respawned that agent. Drafts seed the
    // global default instead, and the row is written once the chat exists.
    let session_id = if effort.is_some() {
        session_id
    } else {
        session_id.or(live_sess)
    };
    let previous_effort = effort.as_ref().map(|_| {
        store::resolve_composer_prefs(project_id.as_deref(), session_id.as_deref()).effort
    });

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
        let effort_changed = previous_effort.as_deref() != Some(eff.trim());
        if let Err(e) = mgr
            .set_effort_and_respawn_needed(
                &app,
                eff,
                session_id.as_deref(),
                effort_changed,
            )
            .await
        {
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

/// Project-scoped file name/path + content search (keyword / `rg` or walk).
/// Soft-fails when path missing / not a dir / untrusted. Never invents
/// embeddings or CLI code-graph results (`search_kind` is always `"keyword"`).
#[tauri::command]
pub async fn project_codebase_search(
    project_path: String,
    query: String,
    mode: Option<String>,
    limit: Option<usize>,
) -> Result<crate::project_codebase_search::CodebaseSearchResult, String> {
    let path = project_path;
    let q = query;
    let m = mode;
    tokio::task::spawn_blocking(move || {
        Ok(crate::project_codebase_search::search_project_codebase(
            &path,
            &q,
            m.as_deref(),
            limit,
        ))
    })
    .await
    .map_err(|e| format!("project codebase search task failed: {e}"))?
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

/// Resolve a chat path to absolute metadata only (no body). Used by file cards
/// before opening the resource pane so history paint does not read every file.
#[tauri::command]
pub async fn fs_resolve_path(
    path: String,
    project_path: Option<String>,
) -> Result<crate::fs_browser::FsResolveResult, String> {
    crate::fs_browser::resolve_path_smart(project_path.as_deref(), &path)
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
            switched_to_independent: false,
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
        "hasSttCustomKey": crate::secrets::has_stt_custom_key_configured(&s),
        "sttCustomKeys": crate::secrets::stt_custom_key_presence(&s),
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

/// Set secrets. `stt_custom_api_key_provider` is the provider preset id the
/// custom STT key belongs to (ADR-0001); empty → `custom` slot, and an empty
/// `stt_custom_api_key` clears that slot.
#[tauri::command]
pub async fn secrets_set(
    official_api_key: Option<String>,
    relay_base_url: Option<String>,
    relay_api_key: Option<String>,
    default_model: Option<String>,
    stt_custom_api_key: Option<String>,
    stt_custom_api_key_provider: Option<String>,
) -> Result<(), String> {
    let mut s = store::load_secrets();
    // Empty string clears the secret (needed when revoking speech/API credentials).
    if let Some(k) = official_api_key {
        s.official_api_key = if k.trim().is_empty() {
            None
        } else {
            Some(k)
        };
    }
    if let Some(u) = relay_base_url {
        s.relay_base_url = if u.is_empty() { None } else { Some(u) };
    }
    if let Some(k) = relay_api_key {
        s.relay_api_key = if k.trim().is_empty() {
            None
        } else {
            Some(k)
        };
    }
    if let Some(m) = default_model {
        s.default_model = if m.is_empty() { None } else { Some(m) };
    }
    if let Some(k) = stt_custom_api_key {
        let provider = stt_custom_api_key_provider
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "custom".into());
        if k.trim().is_empty() {
            s.stt_custom_api_keys.remove(&provider);
        } else {
            s.stt_custom_api_keys.insert(provider, k);
        }
        // Deprecated single slot is superseded once any map write happens.
        s.stt_custom_api_key = None;
    }
    store::save_secrets(&s)
}

#[tauri::command]
pub async fn provider_ping() -> Result<serde_json::Value, String> {
    let secrets = store::load_secrets();
    // Prefer relay if configured, else probe public xAI-ish endpoint with key presence only.
    if let (Some(base), Some(key)) = (&secrets.relay_base_url, &secrets.relay_api_key) {
        let url = format!("{}/models", base.trim_end_matches('/'));
        let client = crate::proxy::apply_to_reqwest(
            reqwest::Client::builder().timeout(std::time::Duration::from_secs(12)),
        )
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
                let class = "NETWORK_PROVIDER";
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
