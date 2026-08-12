// --- recovered PR command blocks ---

const SETUP_CMD_TIMEOUT_SECS: u64 = 60;

/// Clear Grok Build cross-session memory (`grok memory clear`).
#[tauri::command]
pub async fn memory_clear(
    cwd: Option<String>,
    scope: Option<String>,
) -> Result<crate::agent_memory::MemoryClearResult, String> {
    let settings = store::load_settings();
    let path = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);
    let scope = scope
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "workspace".into());
    tokio::task::spawn_blocking(move || {
        crate::agent_memory::clear_workspace_memory(
            path.as_deref(),
            &settings.session_data_mode,
            settings.manual_cli_path.as_deref(),
            &scope,
        )
    })
    .await
    .map_err(|e| format!("memory clear task failed: {e}"))?
}

/// List / inspect on-disk workspace memory files under agent GROK_HOME.
#[tauri::command]
pub async fn memory_list(
    cwd: Option<String>,
) -> Result<crate::agent_memory::MemoryListResult, String> {
    let settings = store::load_settings();
    let path = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);
    tokio::task::spawn_blocking(move || {
        Ok(crate::agent_memory::list_workspace_memory(
            path.as_deref(),
            &settings.session_data_mode,
        ))
    })
    .await
    .map_err(|e| format!("memory list task failed: {e}"))?
}

/// Delete a single memory file (must live under the known memory root).
#[tauri::command]
pub async fn memory_delete_file(
    path: String,
) -> Result<crate::agent_memory::MemoryDeleteResult, String> {
    let settings = store::load_settings();
    let p = std::path::PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err("path is required".into());
    }
    tokio::task::spawn_blocking(move || {
        crate::agent_memory::delete_memory_file(&p, &settings.session_data_mode)
    })
    .await
    .map_err(|e| format!("memory delete task failed: {e}"))?
}

/// Read agent `config.toml` for the active session data mode (secrets redacted).
///
/// Independent → App agent-home; shared → `~/.grok/config.toml` (UI should warn).
#[tauri::command]
pub async fn agent_config_toml_read(
) -> Result<crate::agent_config_view::AgentConfigTomlReadResult, String> {
    let settings = store::load_settings();
    let mode = settings.session_data_mode.clone();
    tokio::task::spawn_blocking(move || crate::agent_config_view::read_agent_config_toml(&mode))
        .await
        .map_err(|e| format!("agent config.toml read task failed: {e}"))
}

/// Search path-scoped memory files (name + content) under agent GROK_HOME/memory.
/// Snippets are redacted; hard caps on hits and bytes read per file.
///
/// Always keyword / file-body scan — never invents embeddings client-side.
/// Agent-tool hybrid (vector + full-text) needs `[memory.embedding].model`
/// (see `memory_embed_config_get`). No host-invocable `grok memory search` CLI
/// as of 0.2.117 — when model is set, `search_kind` is `hybrid_unavailable`.
#[tauri::command]
pub async fn memory_search(
    query: String,
    cwd: Option<String>,
    limit: Option<usize>,
) -> Result<crate::agent_memory::MemorySearchResult, String> {
    let settings = store::load_settings();
    let path = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);
    let q = query;
    tokio::task::spawn_blocking(move || {
        // Soft-probe embedding.model for search_kind honesty (never runs vectors).
        let embedding_configured =
            crate::agent_memory_embed::load_memory_embed_config()
                .map(|s| s.embedding_configured)
                .unwrap_or(false);
        Ok(crate::agent_memory::search_workspace_memory_with_kind(
            &q,
            path.as_deref(),
            &settings.session_data_mode,
            limit,
            embedding_configured,
        ))
    })
    .await
    .map_err(|e| format!("memory search task failed: {e}"))?
}

/// Read allowlisted Grok Build 0.2.117 memory embedding keys from active GROK_HOME.
/// Soft-fails missing file/keys (null fields). Never invents embedding defaults.
#[tauri::command]
pub async fn memory_embed_config_get(
) -> Result<crate::agent_memory_embed::MemoryEmbedConfigSnapshot, String> {
    tauri::async_runtime::spawn_blocking(crate::agent_memory_embed::load_memory_embed_config)
        .await
        .map_err(|e| e.to_string())?
}

/// Write allowlisted memory embedding keys into agent-home config.toml only
/// (independent mode). Soft-respawns so the next turn reloads the agent profile.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn memory_embed_config_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    embedding_model: Option<String>,
    clear_embedding_model: Option<bool>,
    embedding_dimensions: Option<u32>,
    embedding_provider: Option<String>,
    search_max_results: Option<u32>,
    search_min_score: Option<f64>,
    search_vector_weight: Option<f64>,
    search_text_weight: Option<f64>,
    mmr_enabled: Option<bool>,
    mmr_lambda: Option<f64>,
    temporal_decay_enabled: Option<bool>,
    temporal_decay_half_life_days: Option<f64>,
    dream_enabled: Option<bool>,
    dream_min_hours: Option<f64>,
    dream_min_sessions: Option<u32>,
    dream_check_interval_secs: Option<u64>,
    watcher_enabled: Option<bool>,
    initial_injection_enabled: Option<bool>,
    initial_injection_min_score: Option<f64>,
) -> Result<crate::agent_memory_embed::MemoryEmbedConfigSnapshot, String> {
    let patch = crate::agent_memory_embed::MemoryEmbedConfigPatch {
        embedding_model,
        clear_embedding_model,
        embedding_dimensions,
        embedding_provider,
        search_max_results,
        search_min_score,
        search_vector_weight,
        search_text_weight,
        mmr_enabled,
        mmr_lambda,
        temporal_decay_enabled,
        temporal_decay_half_life_days,
        dream_enabled,
        dream_min_hours,
        dream_min_sessions,
        dream_check_interval_secs,
        watcher_enabled,
        initial_injection_enabled,
        initial_injection_min_score,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_memory_embed::save_memory_embed_config(&patch)
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.soft_respawn_with_reason(&app, "memory_embed_config").await;
    Ok(result)
}

/// List agent definitions available for session agent selection.
#[tauri::command]
pub async fn agents_catalog(
    project_path: Option<String>,
) -> Result<crate::agents_catalog::AgentsCatalogResult, String> {
    Ok(crate::agents_catalog::list_agents_catalog(
        project_path.as_deref(),
    ))
}

/// Read allowlisted agent-home config.toml keys (redact-on-read preview).
#[tauri::command]
pub async fn agent_config_edit_get(
) -> Result<crate::agent_config_edit::AgentConfigEditSnapshot, String> {
    tauri::async_runtime::spawn_blocking(crate::agent_config_edit::load_agent_config_edit)
        .await
        .map_err(|e| e.to_string())?
}

/// Write allowlisted keys into agent-home config.toml only (independent mode).
/// Soft-respawns so the next turn reloads profile.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn agent_config_edit_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    permission_mode: Option<String>,
    yolo: Option<bool>,
    subagents_enabled: Option<bool>,
    memory_enabled: Option<bool>,
    workflows_enabled: Option<bool>,
    auto_wake_enabled: Option<bool>,
    two_pass_compaction_enabled: Option<bool>,
    lsp_tools_enabled: Option<bool>,
    codebase_indexing: Option<bool>,
    remote_fetch: Option<bool>,
) -> Result<crate::agent_config_edit::AgentConfigEditSnapshot, String> {
    let patch = crate::agent_config_edit::AgentConfigEditPatch {
        permission_mode,
        yolo,
        subagents_enabled,
        memory_enabled,
        workflows_enabled,
        auto_wake_enabled,
        two_pass_compaction_enabled,
        lsp_tools_enabled,
        codebase_indexing,
        remote_fetch,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_config_edit::save_agent_config_edit(&patch)
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.soft_respawn_with_reason(&app, "agent_config_edit").await;
    Ok(result)
}

/// Read allowlisted privacy keys from active GROK_HOME config.toml (redacted).
/// Soft-fails missing keys as null; never invents defaults.
#[tauri::command]
pub async fn privacy_config_get(
) -> Result<crate::agent_privacy::PrivacyConfigSnapshot, String> {
    tauri::async_runtime::spawn_blocking(crate::agent_privacy::load_privacy_config)
        .await
        .map_err(|e| e.to_string())?
}

/// Write allowlisted privacy keys into agent-home config.toml only (independent mode).
/// Soft-respawns so the next turn reloads the agent profile.
#[tauri::command]
pub async fn privacy_config_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    telemetry: Option<bool>,
    trace_upload: Option<bool>,
    mixpanel_enabled: Option<bool>,
    disable_codebase_upload: Option<bool>,
    disable_workspace_teleport: Option<bool>,
) -> Result<crate::agent_privacy::PrivacyConfigSnapshot, String> {
    let patch = crate::agent_privacy::PrivacyConfigPatch {
        telemetry,
        trace_upload,
        mixpanel_enabled,
        disable_codebase_upload,
        disable_workspace_teleport,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_privacy::save_privacy_config(&patch)
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.soft_respawn_with_reason(&app, "privacy_config").await;
    Ok(result)
}

/// Read `[features].codebase_indexing` from active GROK_HOME config.toml.
/// Soft-fails missing key as unset; never invents embeddings.
#[tauri::command]
pub async fn codebase_indexing_get(
) -> Result<crate::agent_codebase_indexing::CodebaseIndexingSnapshot, String> {
    tauri::async_runtime::spawn_blocking(crate::agent_codebase_indexing::load_codebase_indexing)
        .await
        .map_err(|e| e.to_string())?
}

/// Write `[features].codebase_indexing` bool into agent-home config.toml only
/// (independent mode). Soft-respawns so the next turn reloads the agent profile.
#[tauri::command]
pub async fn codebase_indexing_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    enabled: Option<bool>,
) -> Result<crate::agent_codebase_indexing::CodebaseIndexingSnapshot, String> {
    let patch = crate::agent_codebase_indexing::CodebaseIndexingPatch { enabled };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_codebase_indexing::save_codebase_indexing(&patch)
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.soft_respawn_with_reason(&app, "codebase_indexing").await;
    Ok(result)
}

// marketplace
// ── Plugin marketplace (`grok plugin marketplace …` + available list) ───────
//
// Marketplace list --json currently returns sources only (no nested plugins).
// Browse installable plugins via `plugin list --json --available`.
// Install uses `plugin install <name|name@market|url> --trust` + soft-respawn.

const PLUGIN_MARKETPLACE_MUTATE_TIMEOUT_SECS: u64 = 120;


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSourceDto {
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailablePluginDto {
    pub name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marketplace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_count: Option<u32>,
    #[serde(default)]
    pub has_hooks: bool,
    #[serde(default)]
    pub has_agents: bool,
    #[serde(default)]
    pub has_mcp: bool,
}


/// Parse `grok plugin marketplace list --json` (array or `{ sources: [...] }`).
pub fn parse_marketplace_list_json(raw: &str) -> Result<Vec<MarketplaceSourceDto>, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("Failed to parse marketplace list JSON: {e}"))?;
    let arr = if let Some(a) = value.as_array() {
        a
    } else if let Some(a) = value
        .get("sources")
        .or_else(|| value.get("marketplaces"))
        .and_then(|x| x.as_array())
    {
        a
    } else {
        return Err("marketplace list JSON is not an array".into());
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
        let kind = item
            .get("kind")
            .or_else(|| item.get("type"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "git".into());
        let source = item.get("source");
        let url = source
            .and_then(|s| {
                s.get("url")
                    .or_else(|| s.get("git"))
                    .and_then(|x| x.as_str())
            })
            .or_else(|| item.get("url").and_then(|x| x.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let path = source
            .and_then(|s| s.get("path").and_then(|x| x.as_str()))
            .or_else(|| item.get("path").and_then(|x| x.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let branch = source
            .and_then(|s| s.get("branch").and_then(|x| x.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(MarketplaceSourceDto {
            name,
            kind,
            url,
            path,
            branch,
        });
    }
    Ok(out)
}


/// Fill skill/MCP/hooks/agents counts from `components` when top-level flags are empty.
/// CLI often reports skill_count=0 / has_mcp=false while `components` is populated.
fn enrich_available_from_components(
    item: &serde_json::Value,
    skill_count: Option<u32>,
    has_hooks: bool,
    has_agents: bool,
    has_mcp: bool,
) -> (Option<u32>, bool, bool, bool) {
    let Some(comps) = item.get("components") else {
        return (skill_count, has_hooks, has_agents, has_mcp);
    };
    let mut sc = skill_count;
    let mut hh = has_hooks;
    let mut ha = has_agents;
    let mut hm = has_mcp;
    if sc.unwrap_or(0) == 0 {
        if let Some(arr) = comps.get("skills").and_then(|x| x.as_array()) {
            sc = Some(arr.len() as u32);
        }
    }
    if !hh {
        if let Some(arr) = comps.get("hooks").and_then(|x| x.as_array()) {
            hh = !arr.is_empty();
        }
    }
    if !ha {
        if let Some(arr) = comps.get("agents").and_then(|x| x.as_array()) {
            ha = !arr.is_empty();
        }
    }
    if !hm {
        if let Some(arr) = comps
            .get("mcpServers")
            .or_else(|| comps.get("mcp_servers"))
            .and_then(|x| x.as_array())
        {
            hm = !arr.is_empty();
        }
    }
    (sc, hh, ha, hm)
}

/// Parse `plugin list --json --available`; keep status "available" rows only.
pub fn parse_available_plugins_json(raw: &str) -> Result<Vec<AvailablePluginDto>, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("Failed to parse available plugins JSON: {e}"))?;
    let arr = if let Some(a) = value.as_array() {
        a
    } else if let Some(a) = value.get("plugins").and_then(|x| x.as_array()) {
        a
    } else {
        return Err("available plugins JSON is not an array".into());
    };

    let mut out = Vec::new();
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
        let status = item
            .get("status")
            .and_then(|x| x.as_str())
            .unwrap_or("available")
            .trim()
            .to_string();
        if !status.eq_ignore_ascii_case("available") {
            continue;
        }
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
        let description = item
            .get("description")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let version = item
            .get("version")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let skill_count = item
            .get("skill_count")
            .or_else(|| item.get("skillCount"))
            .and_then(|x| x.as_u64())
            .map(|n| n as u32);
        let has_hooks = item
            .get("has_hooks")
            .or_else(|| item.get("hasHooks"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let has_agents = item
            .get("has_agents")
            .or_else(|| item.get("hasAgents"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let has_mcp = item
            .get("has_mcp")
            .or_else(|| item.get("hasMcp"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let (skill_count, has_hooks, has_agents, has_mcp) =
            enrich_available_from_components(item, skill_count, has_hooks, has_agents, has_mcp);
        out.push(AvailablePluginDto {
            name,
            status,
            marketplace,
            description,
            version,
            skill_count,
            has_hooks,
            has_agents,
            has_mcp,
        });
    }
    Ok(out)
}


pub fn normalize_marketplace_add_source(source: &str) -> Result<String, String> {
    let s = source.trim();
    if s.is_empty() {
        return Err("marketplace source required".into());
    }
    Ok(s.to_string())
}

/// CLI `marketplace remove` wants a git URL or local path — resolve name → URL.
pub fn resolve_marketplace_remove_arg(
    name_or_url: &str,
    sources: &[MarketplaceSourceDto],
) -> Result<String, String> {
    let raw = name_or_url.trim();
    if raw.is_empty() {
        return Err("marketplace source name or URL required".into());
    }
    let looks_like_url = raw.contains("://")
        || raw.starts_with("git@")
        || raw.ends_with(".git");
    let looks_like_path = raw.starts_with('/')
        || raw.starts_with('~')
        || (raw.len() >= 3
            && raw.as_bytes()[1] == b':'
            && (raw.as_bytes()[2] == b'\\' || raw.as_bytes()[2] == b'/'));
    if looks_like_url || looks_like_path {
        return Ok(raw.to_string());
    }
    let lower = raw.to_ascii_lowercase();
    if let Some(src) = sources
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case(raw) || s.name.to_ascii_lowercase() == lower)
    {
        if let Some(url) = src.url.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            return Ok(url.to_string());
        }
        if let Some(path) = src.path.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            return Ok(path.to_string());
        }
    }
    Ok(raw.to_string())
}


pub fn normalize_marketplace_update_name(name: Option<&str>) -> Option<String> {
    name.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}


fn collect_marketplace_list() -> Result<Vec<MarketplaceSourceDto>, String> {
    let (stdout, stderr, ok) = run_grok_cli_args(
        &["plugin", "marketplace", "list", "--json"],
        PLUGIN_CMD_TIMEOUT_SECS,
    )?;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "grok plugin marketplace list failed".into()
        };
        return Err(msg);
    }
    parse_marketplace_list_json(&stdout)
}


fn collect_available_plugins() -> Result<Vec<AvailablePluginDto>, String> {
    let (stdout, stderr, ok) = run_grok_cli_args(
        &["plugin", "list", "--json", "--available"],
        PLUGIN_CMD_TIMEOUT_SECS,
    )?;
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "grok plugin list --available failed".into()
        };
        return Err(msg);
    }
    parse_available_plugins_json(&stdout)
}


/// List configured marketplace sources. Always Ok; error field on failure.
#[tauri::command]
pub async fn marketplace_list() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_marketplace_list)
        .await
        .map_err(|e| e.to_string())?;
    match result {
        Ok(sources) => Ok(serde_json::json!({ "sources": sources })),
        Err(error) => Ok(serde_json::json!({
            "sources": [],
            "error": error,
        })),
    }
}


/// Available (not yet installed) plugins from marketplace catalogs.
#[tauri::command]
pub async fn marketplace_available() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_available_plugins)
        .await
        .map_err(|e| e.to_string())?;
    match result {
        Ok(plugins) => Ok(serde_json::json!({ "plugins": plugins })),
        Err(error) => Ok(serde_json::json!({
            "plugins": [],
            "error": error,
        })),
    }
}



/// Add a marketplace source (git URL, GitHub shorthand, or local path).
#[tauri::command]
pub async fn marketplace_add(source: String) -> Result<serde_json::Value, String> {
    let source = normalize_marketplace_add_source(&source)?;
    let source_for_cmd = source.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "marketplace", "add", &source_for_cmd],
            PLUGIN_MARKETPLACE_MUTATE_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    let (stdout, stderr, ok) = match result {
        Ok(t) => t,
        Err(e) => return Err(e),
    };
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to add marketplace source {source}")
        };
        return Err(msg.chars().take(400).collect());
    }
    Ok(serde_json::json!({
        "ok": true,
        "name": source,
        "message": stdout.chars().take(400).collect::<String>(),
    }))
}

/// Remove a marketplace source by name or URL (name resolved to URL for CLI).
#[tauri::command]
pub async fn marketplace_remove(name_or_url: String) -> Result<serde_json::Value, String> {
    let raw = name_or_url.trim().to_string();
    if raw.is_empty() {
        return Err("marketplace source name or URL required".into());
    }
    let sources = collect_marketplace_list().unwrap_or_default();
    let target = resolve_marketplace_remove_arg(&raw, &sources)?;
    let target_for_cmd = target.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["plugin", "marketplace", "remove", &target_for_cmd],
            PLUGIN_MARKETPLACE_MUTATE_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    let (stdout, stderr, ok) = match result {
        Ok(t) => t,
        Err(e) => return Err(e),
    };
    if !ok {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to remove marketplace source {target}")
        };
        return Err(msg.chars().take(400).collect());
    }
    Ok(serde_json::json!({
        "ok": true,
        "name": raw,
        "removed": target,
        "message": stdout.chars().take(400).collect::<String>(),
    }))
}

/// Update one marketplace source by name, or all when `name` is null/empty.
#[tauri::command]
pub async fn marketplace_update(name: Option<String>) -> Result<serde_json::Value, String> {
    let target = normalize_marketplace_update_name(name.as_deref());
    let target_for_cmd = target.clone();
    let result = tauri::async_runtime::spawn_blocking(move || match target_for_cmd.as_deref() {
        Some(n) => run_grok_cli_args(
            &["plugin", "marketplace", "update", n],
            PLUGIN_MARKETPLACE_MUTATE_TIMEOUT_SECS,
        ),
        None => run_grok_cli_args(
            &["plugin", "marketplace", "update"],
            PLUGIN_MARKETPLACE_MUTATE_TIMEOUT_SECS,
        ),
    })
    .await
    .map_err(|e| e.to_string())?;

    let (stdout, stderr, ok) = match result {
        Ok(t) => t,
        Err(e) => return Err(e),
    };
    if !ok {
        let label = target.as_deref().unwrap_or("all");
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("failed to update marketplace source(s): {label}")
        };
        return Err(msg.chars().take(400).collect());
    }
    Ok(serde_json::json!({
        "ok": true,
        "name": target.unwrap_or_default(),
        "message": stdout.chars().take(400).collect::<String>(),
    }))
}

/// Rich metadata for marketplace plugins (logo path, display name, etc.)
/// scanned from on-disk `marketplace-cache` clones.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePluginMetaDto {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
}

fn marketplace_cache_roots() -> Vec<std::path::PathBuf> {
    use crate::paths::{agent_home_dir, resolve_agent_grok_home};
    use crate::process_util::user_home;
    use crate::store;
    let mut roots = Vec::new();
    let settings = store::load_settings();
    let active = resolve_agent_grok_home(&settings.session_data_mode).join("marketplace-cache");
    roots.push(active);
    roots.push(user_home().join(".grok").join("marketplace-cache"));
    roots.push(agent_home_dir().join("marketplace-cache"));
    roots
}

fn join_logo(root: &std::path::Path, logo: &str) -> Option<std::path::PathBuf> {
    let logo = logo.trim();
    if logo.is_empty() {
        return None;
    }
    if logo.starts_with("http://") || logo.starts_with("https://") || logo.starts_with("data:") {
        return None; // remote — frontend may use URL later
    }
    let mut path = root.to_path_buf();
    for seg in logo.replace('\\', "/").split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            let _ = path.pop();
            continue;
        }
        path.push(seg);
    }
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn pick_logo_file(plugin_root: &std::path::Path, manifest_dir: &std::path::Path, manifest: &serde_json::Value) -> Option<std::path::PathBuf> {
    let iface = manifest.get("interface");
    let candidates: Vec<Option<&str>> = vec![
        iface.and_then(|i| i.get("logo")).and_then(|x| x.as_str()),
        iface.and_then(|i| i.get("composerIcon")).and_then(|x| x.as_str()),
        manifest.get("logo").and_then(|x| x.as_str()),
        manifest.get("icon").and_then(|x| x.as_str()),
    ];
    for c in candidates.into_iter().flatten() {
        if let Some(p) = join_logo(manifest_dir, c) {
            return Some(p);
        }
        if let Some(p) = join_logo(plugin_root, c) {
            return Some(p);
        }
    }
    // Conventional asset names
    for rel in [
        "assets/logo-padded.png",
        "assets/logo-light.png",
        "assets/logo.png",
        "assets/logo.svg",
        "assets/icon.png",
        "assets/app-icon.png",
        "logo.png",
        "icon.png",
    ] {
        let p = plugin_root.join(rel);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn parse_manifest_meta(plugin_root: &std::path::Path, manifest_path: &std::path::Path) -> Option<MarketplacePluginMetaDto> {
    let raw = std::fs::read_to_string(manifest_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            plugin_root
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })?;
    let iface = v.get("interface");
    let display_name = iface
        .and_then(|i| i.get("displayName"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let description = iface
        .and_then(|i| i.get("shortDescription"))
        .and_then(|x| x.as_str())
        .or_else(|| v.get("description").and_then(|x| x.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let long_description = iface
        .and_then(|i| i.get("longDescription"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let version = v
        .get("version")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let category = iface
        .and_then(|i| i.get("category"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let author = v
        .get("author")
        .and_then(|a| {
            if let Some(s) = a.as_str() {
                Some(s.to_string())
            } else {
                a.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
            }
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            iface
                .and_then(|i| i.get("developerName"))
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        });
    let homepage = v
        .get("homepage")
        .and_then(|x| x.as_str())
        .or_else(|| iface.and_then(|i| i.get("websiteURL")).and_then(|x| x.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let repository = v
        .get("repository")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let license = v
        .get("license")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let keywords = v
        .get("keywords")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let manifest_dir = manifest_path.parent().unwrap_or(plugin_root);
    let logo_path = pick_logo_file(plugin_root, manifest_dir, &v)
        .map(|p| p.to_string_lossy().to_string());
    Some(MarketplacePluginMetaDto {
        name,
        display_name,
        description,
        long_description,
        version,
        category,
        author,
        homepage,
        repository,
        license,
        logo_path,
        root_path: Some(plugin_root.to_string_lossy().to_string()),
        keywords,
    })
}

fn scan_plugin_dir(plugin_root: &std::path::Path) -> Option<MarketplacePluginMetaDto> {
    if !plugin_root.is_dir() {
        return None;
    }
    let manifest_candidates = [
        plugin_root.join(".grok-plugin").join("plugin.json"),
        plugin_root.join(".codex-plugin").join("plugin.json"),
        plugin_root.join(".claude-plugin").join("plugin.json"),
        plugin_root.join("plugin.json"),
        plugin_root.join("codex").join(".codex-plugin").join("plugin.json"),
    ];
    for m in &manifest_candidates {
        if m.is_file() {
            if let Some(meta) = parse_manifest_meta(plugin_root, m) {
                return Some(meta);
            }
        }
    }
    // No manifest — still try conventional logo
    let name = plugin_root.file_name()?.to_str()?.to_string();
    let logo_path = pick_logo_file(plugin_root, plugin_root, &serde_json::json!({}))
        .map(|p| p.to_string_lossy().to_string());
    Some(MarketplacePluginMetaDto {
        name,
        logo_path,
        root_path: Some(plugin_root.to_string_lossy().to_string()),
        ..Default::default()
    })
}

fn collect_marketplace_plugin_meta_index() -> std::collections::HashMap<String, MarketplacePluginMetaDto> {
    let mut map = std::collections::HashMap::new();
    for cache_root in marketplace_cache_roots() {
        if !cache_root.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&cache_root) else {
            continue;
        };
        for ent in entries.flatten() {
            let hash_dir = ent.path();
            if !hash_dir.is_dir() {
                continue;
            }
            for sub in ["plugins", "external_plugins"] {
                let plugins_dir = hash_dir.join(sub);
                let Ok(plugin_ents) = std::fs::read_dir(&plugins_dir) else {
                    continue;
                };
                for pe in plugin_ents.flatten() {
                    let plugin_root = pe.path();
                    if !plugin_root.is_dir() {
                        continue;
                    }
                    if let Some(meta) = scan_plugin_dir(&plugin_root) {
                        let key = meta.name.trim().to_ascii_lowercase();
                        // Prefer entry that has a logo / richer description
                        match map.get(&key) {
                            None => {
                                map.insert(key, meta);
                            }
                            Some(prev) => {
                                let better = meta.logo_path.is_some() && prev.logo_path.is_none()
                                    || (meta.description.as_ref().map(|s| s.len()).unwrap_or(0)
                                        > prev.description.as_ref().map(|s| s.len()).unwrap_or(0));
                                if better {
                                    map.insert(key, meta);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    map
}

/// Index plugin.json + logo paths from local marketplace-cache (for Settings UI cards).
#[tauri::command]
pub async fn marketplace_plugin_meta_index() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(collect_marketplace_plugin_meta_index)
        .await
        .map_err(|e| e.to_string())?;
    // Serialize as array for stable JSON; frontend maps by name.
    let plugins: Vec<MarketplacePluginMetaDto> = result.into_values().collect();
    Ok(serde_json::json!({ "plugins": plugins }))
}


// ── Wallpaper sources (X search + Imagine) ──────────────────────────────────

#[tauri::command]
pub async fn wallpaper_x_search(
    query: String,
    sort: Option<String>,
) -> Result<crate::wallpaper_source::WallpaperSearchResult, String> {
    crate::wallpaper_source::ensure_wallpaper_dirs();
    Ok(crate::wallpaper_source::x_search_async(&query, sort.as_deref()).await)
}

#[tauri::command]
pub async fn wallpaper_fetch_media(
    url: String,
    source: Option<String>,
) -> Result<crate::wallpaper_source::WallpaperFetchResult, String> {
    crate::wallpaper_source::ensure_wallpaper_dirs();
    crate::wallpaper_source::fetch_media(&url, source.as_deref()).await
}

#[tauri::command]
pub async fn wallpaper_imagine(
    prompt: String,
    aspect_ratio: Option<String>,
) -> Result<crate::wallpaper_source::WallpaperSearchResult, String> {
    crate::wallpaper_source::ensure_wallpaper_dirs();
    let aspect = aspect_ratio.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::wallpaper_source::imagine(&prompt, aspect.as_deref())
    })
    .await
    .map_err(|e| format!("wallpaper_imagine: {e}"))
}

#[tauri::command]
pub async fn wallpaper_library_list(
    limit: Option<u32>,
) -> Result<Vec<crate::wallpaper_source::WallpaperLibraryEntry>, String> {
    crate::wallpaper_source::ensure_wallpaper_dirs();
    tauri::async_runtime::spawn_blocking(move || crate::wallpaper_source::library_list(limit))
        .await
        .map_err(|e| format!("wallpaper_library_list: {e}"))?
}

#[tauri::command]
pub async fn wallpaper_library_delete(path: String) -> Result<(), String> {
    crate::wallpaper_source::ensure_wallpaper_dirs();
    tauri::async_runtime::spawn_blocking(move || crate::wallpaper_source::library_delete(&path))
        .await
        .map_err(|e| format!("wallpaper_library_delete: {e}"))?
}

/// Headless probe: `grok -p … --output-format streaming-messages-json` (CLI 0.2.117+).
/// Soft-fails older CLIs without spawning. Raw NDJSON returned to UI only — never logged.
#[tauri::command]
pub async fn streaming_messages_json_probe(
    include_partial: Option<bool>,
) -> Result<crate::streaming_messages_json::StreamingMessagesJsonProbeResult, String> {
    let include_partial = include_partial.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        crate::streaming_messages_json::probe_streaming_messages_json(include_partial)
    })
    .await
    .map_err(|e| format!("streaming_messages_json_probe: {e}"))
}

// ─── Process budget occupancy (live / background / parked) ──────────────────

/// Snapshot of warm agent process counts vs `maxConcurrentAgents`.
/// Soft-fail: returns an empty `available: false` snapshot when the manager path errors.
#[tauri::command]
pub async fn process_budget_snapshot(
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<crate::process_limits::ProcessBudgetSnapshot, String> {
    Ok(mgr.process_budget_snapshot())
}

// ─── Tool / permission audit ledger ─────────────────────────────────────────

/// Recent cross-session tool/permission audit rows (newest first). Soft-fail → [].
#[tauri::command]
pub async fn audit_ledger_list(
    limit: Option<u32>,
) -> Result<Vec<crate::audit_ledger::AuditLedgerEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::audit_ledger::list_recent(limit)
    })
    .await
    .map_err(|e| format!("audit_ledger_list: {e}"))
}

/// Clear the on-disk audit ledger (`{app_data}/audit/tool_ledger.jsonl`).
#[tauri::command]
pub async fn audit_ledger_clear() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(crate::audit_ledger::clear_ledger)
        .await
        .map_err(|e| format!("audit_ledger_clear: {e}"))??;
    Ok(serde_json::json!({ "ok": true }))
}

/// Prune audit ledger by retention days (`None` → current AppSettings value).
/// Soft-fail I/O → error string for UI toast. Returns `{ ok, dropped }`.
#[tauri::command]
pub async fn audit_ledger_prune(
    retention_days: Option<u32>,
) -> Result<serde_json::Value, String> {
    let dropped = tauri::async_runtime::spawn_blocking(move || {
        crate::audit_ledger::prune_ledger(retention_days)
    })
    .await
    .map_err(|e| format!("audit_ledger_prune: {e}"))??;
    Ok(serde_json::json!({ "ok": true, "dropped": dropped }))
}

/// Export redacted JSONL via native save dialog.
/// Optional filter: `event`, `sessionId`, `fromTs`, `toTs` (camelCase).
#[tauri::command]
pub async fn audit_ledger_export(
    filter: Option<crate::audit_ledger::AuditLedgerFilter>,
) -> Result<serde_json::Value, String> {
    let filter = filter.unwrap_or_default();
    let text = tauri::async_runtime::spawn_blocking(move || {
        crate::audit_ledger::export_redacted_jsonl_filtered(&filter)
    })
    .await
    .map_err(|e| format!("audit_ledger_export: {e}"))?;
    if text.trim().is_empty() {
        return Err("audit ledger is empty".into());
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let name = format!("grok-app-audit-ledger-{stamp}.jsonl");
    let tmp_dir = std::env::temp_dir();
    let tmp = tmp_dir.join(&name);
    tauri::async_runtime::spawn_blocking({
        let tmp = tmp.clone();
        let text = text.clone();
        move || std::fs::write(&tmp, text).map_err(|e| format!("write temp: {e}"))
    })
    .await
    .map_err(|e| format!("audit_ledger_export: {e}"))??;

    save_and_reveal_file(
        tmp,
        "Export audit ledger",
        &name,
        "JSONL",
        &["jsonl", "json", "txt"],
    )
    .await
}

/// One-shot headless batch turn for a project cwd (`grok -p`, soft-fail).
/// Sequential multi-project dispatch lives in the FE; this runs a single project.
#[tauri::command]
pub async fn batch_agents_headless(
    project_path: String,
    prompt: String,
    timeout_ms: Option<u64>,
) -> Result<crate::batch_agents::BatchHeadlessResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::batch_agents::run_batch_headless(&project_path, &prompt, timeout_ms)
    })
    .await
    .map_err(|e| format!("batch_agents_headless: {e}"))
}

