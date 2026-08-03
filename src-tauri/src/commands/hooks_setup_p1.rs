// from PR #78

/// Create the user or project hooks directory if missing. Returns the absolute path.
#[tauri::command]
pub async fn hooks_ensure_dir(
    scope: Option<String>,
    project_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let scope = scope.unwrap_or_else(|| "user".into());
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let scope_for_block = scope.clone();
    let dir = tauri::async_runtime::spawn_blocking(move || {
        crate::hooks::ensure_hooks_dir(&scope_for_block, project.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(serde_json::json!({
        "path": dir.to_string_lossy(),
        "scope": scope,
    }))
}

// from PR #78

// ── Hooks manager (list / reveal / open folder) ─────────────────────────────

/// List hook files under `~/.grok/hooks` and optionally `<project>/.grok/hooks`.
#[tauri::command]
pub async fn hooks_list(project_path: Option<String>) -> Result<crate::hooks::HooksListResult, String> {
    let path = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        crate::hooks::collect_hooks_list(path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

// from PR #78

/// Open the user or project hooks directory in the system file manager.
/// When `create` is true, creates the folder if it is missing.
#[tauri::command]
pub async fn hooks_open_dir(
    scope: Option<String>,
    project_path: Option<String>,
    create: Option<bool>,
) -> Result<serde_json::Value, String> {
    let scope = scope.unwrap_or_else(|| "user".into());
    let create = create.unwrap_or(false);
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let scope_for_block = scope.clone();
    let project_for_block = project.clone();
    let dir = tauri::async_runtime::spawn_blocking(move || {
        if create {
            crate::hooks::ensure_hooks_dir(&scope_for_block, project_for_block.as_deref())
        } else {
            let d = match scope_for_block.trim() {
                "user" | "" => crate::hooks::user_hooks_dir(),
                "project" => crate::hooks::project_hooks_dir(project_for_block.as_deref().unwrap_or(""))
                    .ok_or_else(|| "project path required for project hooks".to_string())?,
                other => return Err(format!("unknown hooks scope: {other}")),
            };
            if !d.exists() {
                return Err(format!(
                    "hooks folder not found: {} (use Create folder first)",
                    d.display()
                ));
            }
            Ok(d)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    let path = dir.to_string_lossy().to_string();
    // Open the directory itself (not reveal-select).
    path_open(path.clone()).await?;
    Ok(serde_json::json!({ "path": path, "scope": scope }))
}

// from PR #78

/// Reveal a hook path in the system file manager (Finder / Explorer).
#[tauri::command]
pub async fn hooks_reveal(path: String) -> Result<(), String> {
    path_reveal(path).await
}

/// Real try-run of a hook script (optional JSON stdin, timeout, path-scoped to hooks dirs).
///
/// Returns a structured result; `ok` is true only when the process exited 0 without
/// timing out. Unsafe paths / invalid stdin are refused (`refused: true`) — never
/// reported as success.
#[tauri::command]
pub async fn hooks_try_run(
    path: String,
    project_path: Option<String>,
    stdin_json: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<crate::hooks::HooksTryRunResult, String> {
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        crate::hooks::try_run_hook_script(
            &path,
            project.as_deref(),
            stdin_json.as_deref(),
            timeout_secs,
        )
    })
    .await
    .map_err(|e| e.to_string())
}

// from PR #77

fn is_agent_def_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.starts_with('.')
        && (lower.ends_with(".md") || lower.ends_with(".markdown"))
}

// from PR #77

fn is_persona_def_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.starts_with('.')
        && (lower.ends_with(".toml")
            || lower.ends_with(".md")
            || lower.ends_with(".markdown"))
}

// from PR #88

/// Safe fix-id shape: short handle (`ssh-wrap`) or canonical (`terminal.ssh-wrap`).
/// Rejects flags, paths, and shell metacharacters before invoking the CLI.
fn is_safe_doctor_fix_id(id: &str) -> bool {
    let t = id.trim();
    if t.is_empty() || t.len() > 128 {
        return false;
    }
    let mut chars = t.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// from PR #79

fn is_setup_sensitive_key(key: &str) -> bool {
    let k = key.trim().to_ascii_lowercase();
    if k.is_empty() {
        return false;
    }
    matches!(
        k.as_str(),
        "apikey"
            | "api_key"
            | "api-key"
            | "token"
            | "secret"
            | "password"
            | "passwd"
            | "authorization"
            | "auth"
            | "access_token"
            | "access-token"
            | "refresh_token"
            | "refresh-token"
            | "client_secret"
            | "client-secret"
            | "private_key"
            | "private-key"
            | "bearer"
            | "deployment_key"
            | "deployment-key"
            | "deploymentkey"
            | "xai_api_key"
            | "xai-api-key"
            | "env"
            | "environment"
            | "headers"
            | "secrets"
            | "credentials"
            | "signatures"
            | "managed_identity_signatures"
            | "managedidentitysignatures"
    ) || k.contains("api_key")
        || k.contains("api-key")
        || k.contains("apikey")
        || k.ends_with("_token")
        || k.ends_with("-token")
        || k.ends_with("_secret")
        || k.ends_with("-secret")
        || k.ends_with("_password")
        || k.contains("deployment_key")
        || k.contains("deploymentkey")
        || (k.contains("signature") && !k.contains("fingerprint"))
        || k.ends_with("_sig")
}

// from PR #68

/// Add or replace a stdio MCP server. Soft-respawns a live agent so the next
/// connect injects the new `mcpServers` set.
#[tauri::command]
pub async fn mcp_add(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
    command: String,
    args: Option<Vec<String>>,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    let command = command.trim().to_string();
    let args = args.unwrap_or_default();
    let env_owned = env;
    let def = tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::add_mcp_stdio(
            &name,
            &command,
            &args,
            env_owned.as_ref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.apply_extensions_mcp_change(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": def.name,
        "command": def.command,
        "args": def.args,
        "transport": def.transport,
        "enabled": true,
    }))
}

// from PR #68

/// Start interactive MCP OAuth (PKCE + loopback). Returns authorize URL for
/// the UI to open; host waits for callback and persists Bearer token.
#[tauri::command]
pub async fn mcp_oauth_start(name: String) -> Result<crate::mcp_oauth::McpOauthStartResult, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("MCP server name required".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::mcp_oauth::mcp_oauth_start(&name))
        .await
        .map_err(|e| e.to_string())?
}

/// Poll in-flight MCP OAuth (pending | success | error | idle).
#[tauri::command]
pub async fn mcp_oauth_status(
    name: String,
) -> Result<crate::mcp_oauth::McpOauthStatusResult, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("MCP server name required".into());
    }
    Ok(crate::mcp_oauth::mcp_oauth_status(&name))
}

/// Run `grok mcp doctor --json` (optional server name) under the active GROK_HOME.
#[tauri::command]
pub async fn mcp_doctor(
    name: Option<String>,
) -> Result<crate::extensions::McpDoctorReport, String> {
    let name = name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    tauri::async_runtime::spawn_blocking(move || run_mcp_doctor(name.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

// from PR #68

/// Remove an MCP server from agent config + App prefs. Soft-respawns when live.
#[tauri::command]
pub async fn mcp_remove(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    name: String,
) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("MCP server name required".into());
    }
    let name_for_job = name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::extensions::remove_mcp_server(&name_for_job)
    })
    .await
    .map_err(|e| e.to_string())??;

    mgr.apply_extensions_mcp_change(&app).await;
    Ok(serde_json::json!({
        "ok": true,
        "name": name,
    }))
}

// from PR #74

/// Normalize a path for worktree equality checks (slash direction, no trailing
/// slash, ASCII lowercased so macOS/Windows case-insensitive volumes match).
pub fn normalize_worktree_path_key(raw: &str) -> String {
    let mut s = normalize_fs_path(raw).replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s.make_ascii_lowercase();
    s
}

// from PR #84

/// Read compact permission rules from the active GROK_HOME config.toml.
#[tauri::command]
pub async fn permission_rules_get(
) -> Result<crate::permission_rules::PermissionRulesResult, String> {
    tauri::async_runtime::spawn_blocking(crate::permission_rules::load_permission_rules)
        .await
        .map_err(|e| e.to_string())?
}

// from PR #84

/// Replace compact allow/deny/ask arrays and soft-respawn the live agent.
#[tauri::command]
pub async fn permission_rules_set(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    allow: Option<Vec<String>>,
    deny: Option<Vec<String>>,
    ask: Option<Vec<String>>,
) -> Result<crate::permission_rules::PermissionRulesResult, String> {
    let rules = crate::permission_rules::PermissionRules {
        allow: allow.unwrap_or_default(),
        deny: deny.unwrap_or_default(),
        ask: ask.unwrap_or_default(),
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::permission_rules::save_permission_rules(&rules)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Grok Build reads rules at session start — soft-respawn so the next turn
    // reloads config without a full disconnect toast.
    mgr.soft_respawn(&app).await;
    Ok(result)
}

// from PR #82

/// Create root `AGENTS.md` stub when missing (idempotent).
/// IPC arg is `projectPath` (camelCase) → `project_path`.
#[tauri::command]
pub async fn project_rules_ensure_template(
    project_path: String,
) -> Result<crate::project_rules::ProjectRulesEnsureResult, String> {
    crate::project_rules::ensure_agents_template(&project_path)
}

// from PR #82

/// List existing project rule files (AGENTS.md, CLAUDE.md, `.grok/rules*`, nested AGENTS).
/// IPC arg is `projectPath` (camelCase) → `project_path`.
#[tauri::command]
pub async fn project_rules_list(
    project_path: String,
) -> Result<crate::project_rules::ProjectRulesListResult, String> {
    crate::project_rules::list_project_rules(&project_path)
}

// from PR #77

fn read_agent_description(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    // Frontmatter is near the top; cap read size.
    let take = bytes.len().min(4096);
    let content = String::from_utf8_lossy(&bytes[..take]);
    extract_agent_description_from_content(&content)
}

// from PR #88

/// Redact + cap CLI doctor fix stdout/stderr for the UI (no secrets, no huge dumps).
fn redact_doctor_fix_output(s: &str, max: usize) -> String {
    let scrubbed = store::redact_text(s);
    truncate_cli_err(&scrubbed, max)
}

// from PR #79

/// In-place redaction of secret-like keys / tokenish strings in managed setup JSON.
pub fn redact_setup_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                if is_setup_sensitive_key(&key) {
                    map.insert(key, serde_json::Value::String("[REDACTED]".into()));
                } else if let Some(child) = map.get_mut(&key) {
                    redact_setup_json_value(child);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_setup_json_value(item);
            }
        }
        serde_json::Value::String(s) => {
            let scrubbed = store::redact_text(s);
            *s = scrubbed.trim().to_string();
        }
        _ => {}
    }
}

// from PR #74

/// Refuse removing the main (primary) worktree. Pure; unit-tested.
pub fn refuse_remove_main_worktree(
    listed: &[GitWorktreeEntry],
    worktree_path: &str,
) -> Result<(), String> {
    let target = normalize_fs_path(worktree_path);
    if target.is_empty() {
        return Err("empty worktree path".into());
    }
    let main = listed
        .iter()
        .find(|w| w.is_main)
        .or_else(|| listed.first());
    if let Some(m) = main {
        if worktree_paths_equal(&m.path, &target) {
            return Err("refusing to remove the main worktree".into());
        }
    }
    Ok(())
}

// from PR #68

/// Invoke CLI doctor with GROK_HOME matching session_data_mode.
///
/// Runs `grok mcp doctor --json [NAME]` with a hard timeout. Errors are
/// redacted/truncated so secrets never leave the host. Returns a structured
/// report (JSON-serializable) — never invents servers.
///
/// Independent mode: HTTP MCP often exists only in `~/.grok/config.toml` (CLI)
/// while doctor uses App `agent-home`. Mirror missing user HTTP servers into
/// agent-home first so focused doctor (e.g. `chatcut`) does not false-report
/// "MCP server not found".
fn run_mcp_doctor(name: Option<&str>) -> Result<crate::extensions::McpDoctorReport, String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };
    // Sync user-scoped HTTP MCP into agent-home before doctor (independent mode).
    let mirrored =
        crate::extensions::mirror_user_http_mcp_into_agent_home(&settings.session_data_mode);
    if mirrored > 0 {
        tracing::info!("mcp doctor: mirrored {mirrored} HTTP MCP server(s) into agent-home");
    }
    let grok_home = crate::paths::resolve_agent_grok_home(&settings.session_data_mode);

    let mut args: Vec<String> = vec!["mcp".into(), "doctor".into(), "--json".into()];
    if let Some(n) = name {
        // Reject flag-like / path injection in the optional server name.
        let n = n.trim();
        if n.is_empty() {
            // no-op
        } else if n.starts_with('-') || n.contains('/') || n.contains('\\') || n.contains('\0') {
            return Err("invalid MCP server name".into());
        } else {
            args.push(n.to_string());
        }
    }

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args);
        cmd.env("GROK_HOME", &grok_home);
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });

    match rx.recv_timeout(std::time::Duration::from_secs(MCP_DOCTOR_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            // Doctor may exit non-zero when servers are unhealthy — still parse JSON.
            let blob = if !stdout.is_empty() {
                stdout
            } else {
                stderr.clone()
            };
            if blob.is_empty() {
                return Err(if !stderr.is_empty() {
                    // Never surface raw secrets from CLI stderr.
                    redact_doctor_fix_output(&stderr, 400)
                } else {
                    "mcp doctor returned no output".into()
                });
            }
            // Plain-text "MCP server 'x' not found" (no JSON) — surface as structured fail
            // so UI can show authorize / re-add guidance instead of an empty report.
            let lower = blob.to_ascii_lowercase();
            if lower.contains("not found") && lower.contains("mcp server") {
                let focus = name.unwrap_or("").trim();
                let label = if focus.is_empty() {
                    "MCP server not found under active GROK_HOME".to_string()
                } else {
                    format!(
                        "MCP server '{focus}' not found under active agent home. \
                         It may only exist in ~/.grok (terminal CLI). \
                         Re-add in App or re-run doctor after sync."
                    )
                };
                return Ok(crate::extensions::McpDoctorReport {
                    ok: false,
                    summary: crate::extensions::McpDoctorSummary {
                        total: 1,
                        healthy: 0,
                        unhealthy: 1,
                    },
                    servers: if focus.is_empty() {
                        vec![]
                    } else {
                        vec![crate::extensions::McpDoctorServer {
                            name: focus.to_string(),
                            transport: None,
                            target: None,
                            source: Some("agent-home".into()),
                            healthy: false,
                            checks: vec![crate::extensions::McpDoctorCheck {
                                label: "server present".into(),
                                passed: false,
                                detail: Some(label.clone()),
                                hint: Some(
                                    "Independent mode uses App agent-home; add HTTP MCP there \
                                     or re-run doctor (auto-mirrors from ~/.grok)."
                                        .into(),
                                ),
                            }],
                        }]
                    },
                    sources: vec![],
                    raw_text: Some(redact_doctor_fix_output(&blob, 400)),
                });
            }
            Ok(crate::extensions::parse_mcp_doctor_json(&blob))
        }
        Ok(Err(e)) => Err(format!(
            "Failed to run grok mcp doctor: {}",
            redact_doctor_fix_output(&e.to_string(), 240)
        )),
        Err(_) => Err(format!(
            "grok mcp doctor timed out after {MCP_DOCTOR_TIMEOUT_SECS}s"
        )),
    }
}

// from PR #83

/// Sanitize optional `--expire` / max-age for `git worktree prune`.
///
/// Accepts common git relative dates (`now`, `2.weeks.ago`, `3.months`) and
/// simple tokens. Rejects empty, option-like (`-…`), and control characters.
/// Pure; unit-tested.
pub fn sanitize_worktree_gc_max_age(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if s.len() > 64 {
        return Err("max-age too long".into());
    }
    if s.starts_with('-') {
        return Err("max-age must not start with '-'".into());
    }
    if s.contains('\0') || s.contains('\n') || s.contains('\r') || s.contains(' ') {
        return Err("invalid max-age".into());
    }
    // Git expire: alphanumerics + . _ (e.g. 2.weeks.ago, now, 90.days).
    let ok = s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    if !ok {
        return Err("max-age may only contain letters, digits, '.' and '_'".into());
    }
    Ok(Some(s.to_string()))
}

// from PR #64

/// Sanitize a user-provided worktree name for use as a path segment + branch name.
///
/// Allows letters, digits, `.`, `_`, `-`. Rejects empty, `..`, path separators,
/// and other control / shell-metacharacters. Pure; unit-tested.
pub fn sanitize_worktree_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("worktree name is required".into());
    }
    if name == "." || name == ".." {
        return Err("invalid worktree name".into());
    }
    if name.len() > 64 {
        return Err("worktree name too long (max 64)".into());
    }
    // Single path segment only — no separators, no absolute paths.
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("worktree name must not contain path separators".into());
    }
    // Branch-safe: alphanumeric + . _ - (common for feature names).
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if !ok {
        return Err(
            "worktree name may only contain letters, digits, '.', '_' and '-'".into(),
        );
    }
    if name.starts_with('-') {
        return Err("worktree name must not start with '-'".into());
    }
    Ok(name.to_string())
}

// from PR #64

/// Optional commit-ish / branch start-point for `git worktree add`.
/// Passed as a single argv element (no shell) after light validation.
pub fn sanitize_worktree_ref(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if s.len() > 256 {
        return Err("branch / ref too long".into());
    }
    if s.contains('\0') || s.contains('\n') || s.contains('\r') {
        return Err("invalid branch / ref".into());
    }
    // Disallow option-like args so they cannot be mistaken for git flags.
    if s.starts_with('-') {
        return Err("branch / ref must not start with '-'".into());
    }
    Ok(Some(s.to_string()))
}

#[cfg(test)]
include!("hooks_setup_worktree_path_tests.rs");

// from PR #77

fn scan_agent_dir(dir: &std::path::Path, scope: &str) -> Vec<AgentDefDto> {
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return out,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_agent_def_file(&file_name) {
            continue;
        }
        let name = stem_name(&file_name);
        if name.is_empty() {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        let description = read_agent_description(&path);
        out.push(AgentDefDto {
            name,
            path: path_str,
            scope: scope.to_string(),
            description,
        });
    }
    out
}

// from PR #77

fn scan_persona_dir(dir: &std::path::Path, scope: &str) -> Vec<PersonaDefDto> {
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return out,
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !is_persona_def_file(&file_name) {
            continue;
        }
        let name = stem_name(&file_name);
        if name.is_empty() {
            continue;
        }
        out.push(PersonaDefDto {
            name,
            path: path.to_string_lossy().to_string(),
            scope: scope.to_string(),
        });
    }
    out
}

// from PR #77

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "project" => 0,
        "user" => 1,
        "bundled" => 2,
        _ => 9,
    }
}

// from PR #71

/// Persist last active chat without permission/tray side-effects of `settings_set`.
/// Called on every successful open/switch so startup can restore once.
#[tauri::command]
pub async fn settings_remember_last_session(
    session_id: Option<String>,
    project_id: Option<String>,
) -> Result<(), String> {
    let mut s = store::load_settings();
    let next_session = session_id.and_then(|id| {
        let t = id.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let next_project = project_id.and_then(|id| {
        let t = id.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    if s.last_session_id == next_session && s.last_project_id == next_project {
        return Ok(());
    }
    s.last_session_id = next_session;
    s.last_project_id = next_project;
    store::save_settings(&s)
}

// from PR #79

fn setup_cli_failure_message(stdout: &str, stderr: &str, fallback: &str) -> String {
    let msg = if !stderr.trim().is_empty() {
        stderr.trim()
    } else if !stdout.trim().is_empty() {
        stdout.trim()
    } else {
        fallback
    };
    // Scrub any accidental key material in CLI diagnostics.
    store::redact_text(msg).trim().chars().take(1200).collect()
}

// from PR #79

fn setup_error_kind(msg: &str) -> &'static str {
    let m = msg.to_ascii_lowercase();
    if m.contains("cli not found") || m.contains("no such file") {
        return "cli_missing";
    }
    if m.contains("timed out") || m.contains("timeout") {
        return "timeout";
    }
    if m.contains("no deployment key")
        || m.contains("team sign-in")
        || m.contains("team login")
        || m.contains("sign in with a team")
        || m.contains("export grok_deployment_key")
    {
        return "missing_auth";
    }
    // Managed-config signature / envelope verification failures.
    if m.contains("signature rejected")
        || m.contains("signature was rejected")
        || m.contains("did not verify")
        || m.contains("could not be verified")
        || m.contains("is-managed claim")
        || m.contains("managed config signature")
        || m.contains("server envelope rejected")
    {
        return "signature_rejected";
    }
    if m.contains("deployment key was rejected")
        || m.contains("key was rejected")
        || m.contains("hasn't expired")
        || m.contains("hasnt expired")
    {
        return "rejected";
    }
    if m.contains("json") && (m.contains("parse") || m.contains("invalid")) {
        return "parse";
    }
    "other"
}

// from MANAGED-SETUP-PRO

/// Soft-fail local managed-config / signature artifact probe for Settings.
/// Always returns Ok; see [`crate::managed_setup::ManagedSetupStatus`].
#[tauri::command]
pub async fn managed_setup_status() -> Result<crate::managed_setup::ManagedSetupStatus, String> {
    tauri::async_runtime::spawn_blocking(crate::managed_setup::probe_managed_setup_status)
        .await
        .map_err(|e| format!("managed_setup_status: {e}"))
}

// from PR #79

/// `grok setup` — fetch and install managed configuration into ~/.grok.
/// Soft-respawns the agent on success so new policy is picked up.
/// Always returns Ok; failures surface as `{ ok: false, error, errorKind }`.
#[tauri::command]
pub async fn setup_install(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        run_grok_cli_args(&["setup"], SETUP_CMD_TIMEOUT_SECS)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (stdout, stderr, ok) = match result {
        Ok(t) => t,
        Err(e) => {
            let error = store::redact_text(&e).trim().to_string();
            let kind = setup_error_kind(&error);
            return Ok(serde_json::json!({
                "ok": false,
                "message": null,
                "error": error,
                "errorKind": kind,
            }));
        }
    };

    if !ok {
        let error =
            setup_cli_failure_message(&stdout, &stderr, "Could not install managed configuration");
        let kind = setup_error_kind(&error);
        return Ok(serde_json::json!({
            "ok": false,
            "message": null,
            "error": error,
            "errorKind": kind,
        }));
    }

    let message = {
        let raw = if !stdout.trim().is_empty() {
            stdout.trim()
        } else if !stderr.trim().is_empty() {
            stderr.trim()
        } else {
            "Applied managed configuration."
        };
        store::redact_text(raw)
            .trim()
            .chars()
            .take(800)
            .collect::<String>()
    };

    // New managed policy may change models / permissions / MCP — recycle agent.
    mgr.soft_respawn(&app).await;

    Ok(serde_json::json!({
        "ok": true,
        "message": message,
        "error": null,
        "errorKind": null,
    }))
}

// from PR #79

/// `grok setup --json` — fetch managed config preview without writing to ~/.grok.
/// Always returns Ok; failures surface as `{ ok: false, error, errorKind }`.
#[tauri::command]
pub async fn setup_preview() -> Result<serde_json::Value, String> {
    let result = tauri::async_runtime::spawn_blocking(|| {
        run_grok_cli_args(&["setup", "--json"], SETUP_CMD_TIMEOUT_SECS)
    })
    .await
    .map_err(|e| e.to_string())?;

    let (stdout, stderr, ok) = match result {
        Ok(t) => t,
        Err(e) => {
            let error = store::redact_text(&e).trim().to_string();
            let kind = setup_error_kind(&error);
            return Ok(serde_json::json!({
                "ok": false,
                "payload": null,
                "message": null,
                "error": error,
                "errorKind": kind,
            }));
        }
    };

    if !ok {
        let error = setup_cli_failure_message(
            &stdout,
            &stderr,
            "Could not fetch managed configuration",
        );
        let kind = setup_error_kind(&error);
        return Ok(serde_json::json!({
            "ok": false,
            "payload": null,
            "message": null,
            "error": error,
            "errorKind": kind,
        }));
    }

    let body = stdout.trim();
    if body.is_empty() {
        // Some CLI builds may print JSON on stderr when successful.
        let alt = stderr.trim();
        if alt.starts_with('{') || alt.starts_with('[') {
            return Ok(setup_preview_from_body(alt));
        }
        return Ok(serde_json::json!({
            "ok": true,
            "payload": null,
            "message": store::redact_text(alt).trim().chars().take(400).collect::<String>(),
            "error": null,
            "errorKind": null,
        }));
    }

    Ok(setup_preview_from_body(body))
}
