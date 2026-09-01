// ── Community PR batch (#63–#91) ─────────────────────────

// from PR #88

/// Timeout for `grok doctor fix <id> --yes` (may rewrite shell rc / config).
const CLI_DOCTOR_FIX_TIMEOUT_SECS: u64 = 30;

// from PR #68

const MCP_DOCTOR_TIMEOUT_SECS: u64 = 90;

// from PR #77

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefDto {
    pub name: String,
    pub path: String,
    /// "project" | "user" | "bundled"
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// from PR #64

/// Result of creating a linked worktree (`git worktree add`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeAddResult {
    /// Absolute path of the new worktree directory.
    pub path: String,
    /// Sanitized worktree / new-branch name.
    pub name: String,
    /// Optional start-point / commit-ish that was used.
    pub start_point: Option<String>,
    /// Branch checked out after add (best-effort from re-list).
    pub branch: Option<String>,
}

// from PR #83

/// Result of `git worktree prune` (gc / clean stale admin files).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeGcResult {
    /// Whether this was a dry-run (`-n`).
    pub dry_run: bool,
    /// Whether aggressive expire (`now`) was applied via force without max_age.
    pub forced: bool,
    /// Optional `--expire` value that was used.
    pub max_age: Option<String>,
    /// Combined verbose prune output (stdout + stderr, trimmed).
    pub output: String,
    /// Paths marked `prunable` in `git worktree list --porcelain` before prune.
    pub prunable: Vec<String>,
    /// Best-effort count of removals reported in prune output.
    pub pruned_count: usize,
}

// from PR #74

/// Result of `git worktree remove`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeRemoveResult {
    /// Absolute path that was removed.
    pub path: String,
    /// Whether `--force` was used.
    pub forced: bool,
}

/// One row from `git diff --name-status` (worktree compare).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCompareEntry {
    /// Status token: A, M, D, R100, C080, …
    pub status: String,
    /// Path (rename/copy destination when old_path is set).
    pub path: String,
    /// Rename/copy source path when present.
    pub old_path: Option<String>,
}

/// Soft-fail result of comparing two worktree paths / refs (`git diff --name-status`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCompareResult {
    pub available: bool,
    pub entries: Vec<GitWorktreeCompareEntry>,
    /// Raw `git diff --name-status` stdout (for client re-parse / honesty).
    pub raw: Option<String>,
    pub reason: Option<String>,
    pub base: String,
    pub other: String,
    /// Resolved left ref (branch or sha).
    pub base_ref: Option<String>,
    /// Resolved right ref (branch or sha).
    pub other_ref: Option<String>,
    /// True when host truncated the entry list (cap honesty).
    pub truncated: bool,
    /// Total entries before host cap (when truncated).
    pub total: usize,
}

// from PR #77

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDefDto {
    pub name: String,
    pub path: String,
    pub scope: String,
}

// from PR #77

/// Read-only soft-fail list of discovered Grok Build workflow scripts
/// (`~/.grok/workflows` + project `.grok/workflows` + independent agent-home).
/// Never invents runners; empty dirs return an empty list.
#[tauri::command]
pub async fn workflows_list(
    project_path: Option<String>,
) -> Result<crate::agent_workflows::DiscoverWorkflowsResult, String> {
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let mode = store::load_settings().session_data_mode.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent_workflows::discover_workflows(project.as_deref(), &mode)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
}

/// Soft-fail headless run of a discovered Grok Build workflow by name.
///
/// There is no top-level `grok workflow` CLI subcommand; the host spawns a
/// short `grok -p` that must call the agent `workflow` tool. Default mode is
/// `validate` (`validate_only: true` smoke). Returns structured ok / reason /
/// redacted truncated log — never panics on CLI missing / timeout.
#[tauri::command]
pub async fn workflows_run(
    app: tauri::AppHandle,
    name: String,
    project_path: Option<String>,
    mode: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<crate::agent_workflows::WorkflowRunResult, String> {
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let mode_owned = mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        crate::agent_workflows::run_workflow_with_app(
            app,
            &name,
            project.as_deref(),
            mode_owned.as_deref(),
            timeout_ms,
        )
    })
    .await
    .map_err(|e| format!("workflows_run: {e}"))
}

/// Create a minimal `.rhai` workflow template under user or project scope.
/// Path-scoped write; refuses overwrite unless `force`. Soft-fail via Result.
#[tauri::command]
pub async fn workflows_create(
    name: String,
    scope: Option<String>,
    project_path: Option<String>,
    force: Option<bool>,
) -> Result<crate::agent_workflows::WorkflowCreateResult, String> {
    let scope = scope.unwrap_or_else(|| "user".into());
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        crate::agent_workflows::create_workflow_template(
            &name,
            &scope,
            project_path.as_deref(),
            force,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// List agent + persona definition files from user / project / bundled scopes.
/// Does not require the CLI binary (pure filesystem discovery under `~/.grok`,
/// active GROK_HOME / agent-home, and optional `{project}/.grok`). Always returns Ok.
#[tauri::command]
pub async fn agents_list(project_path: Option<String>) -> Result<serde_json::Value, String> {
    let project = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let home = crate::process_util::user_home();
        let grok = home.join(".grok");
        let user_agents = grok.join("agents");
        let bundled_agents = grok.join("bundled").join("agents");
        let user_personas = grok.join("personas");
        let bundled_personas = grok.join("bundled").join("personas");

        let project_agents = project.as_ref().map(|p| {
            std::path::PathBuf::from(p).join(".grok").join("agents")
        });
        let project_personas = project.as_ref().map(|p| {
            std::path::PathBuf::from(p).join(".grok").join("personas")
        });

        let settings = store::load_settings();
        let active_home =
            crate::paths::resolve_agent_grok_home(&settings.session_data_mode);
        let active_user_agents = active_home.join("agents");

        let mut agents = Vec::new();
        if let Some(ref dir) = project_agents {
            agents.extend(scan_agent_dir(dir, "project"));
        }
        agents.extend(scan_agent_dir(&user_agents, "user"));
        if active_user_agents != user_agents {
            // Independent mode: defs under agent-home count as user scope.
            for a in scan_agent_dir(&active_user_agents, "user") {
                if !agents
                    .iter()
                    .any(|e| e.scope == "user" && e.name.eq_ignore_ascii_case(&a.name))
                {
                    agents.push(a);
                }
            }
        }
        agents.extend(scan_agent_dir(&bundled_agents, "bundled"));
        let agents = sort_agent_defs(agents);

        let mut personas = Vec::new();
        if let Some(ref dir) = project_personas {
            personas.extend(scan_persona_dir(dir, "project"));
        }
        personas.extend(scan_persona_dir(&user_personas, "user"));
        personas.extend(scan_persona_dir(&bundled_personas, "bundled"));
        let personas = sort_persona_defs(personas);

        let user_agents_dir = if active_user_agents != user_agents {
            active_user_agents.to_string_lossy().to_string()
        } else {
            user_agents.to_string_lossy().to_string()
        };

        serde_json::json!({
            "agents": agents,
            "personas": personas,
            "userAgentsDir": user_agents_dir,
            "projectAgentsDir": project_agents
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            "bundledAgentsDir": bundled_agents.to_string_lossy(),
            "userPersonasDir": user_personas.to_string_lossy(),
            "projectPersonasDir": project_personas
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            "bundledPersonasDir": bundled_personas.to_string_lossy(),
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

/// Create a SKILL-like agent definition markdown under user GROK_HOME or
/// project `.grok/agents`. Path-scoped; rejects overwrite unless `force`.
#[tauri::command]
pub async fn agents_scaffold(
    name: String,
    scope: Option<String>,
    project_path: Option<String>,
    force: Option<bool>,
    description: Option<String>,
) -> Result<crate::agents_catalog::AgentsScaffoldResult, String> {
    let scope = scope.unwrap_or_else(|| "user".into());
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        crate::agents_catalog::scaffold_agent(
            &name,
            &scope,
            project_path.as_deref(),
            force,
            description.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

// from PR #83

/// Build argv for `git worktree prune` (no binary name; caller prefixes `git`).
///
/// Layout: `[-C <project>] worktree prune -v [--dry-run] [--expire <age>]`
///
/// - `dry_run` → `--dry-run` (report only)
/// - `max_age` → `--expire <max_age>` when set
/// - `force` without `max_age` → `--expire now` (prune all stale admin files now)
/// - always `-v` so dry-run preview has useful lines
///
/// Pure; unit-tested. Never goes through a shell.
pub fn build_worktree_gc_args(
    project: &str,
    dry_run: bool,
    force: bool,
    max_age: Option<&str>,
) -> Result<Vec<String>, String> {
    let project = normalize_fs_path(project);
    if project.is_empty() {
        return Err("empty path".into());
    }
    if project.starts_with('-') {
        return Err("invalid project path".into());
    }
    let expire = match sanitize_worktree_gc_max_age(max_age)? {
        Some(age) => Some(age),
        None if force => Some("now".into()),
        None => None,
    };

    let mut args: Vec<String> = vec![
        "-C".into(),
        project,
        "worktree".into(),
        "prune".into(),
        "-v".into(),
    ];
    if dry_run {
        args.push("--dry-run".into());
    }
    if let Some(age) = expire {
        args.push("--expire".into());
        args.push(age);
    }
    Ok(args)
}

// from PR #64

/// Path placement for new linked worktrees (`cli` default, or `sibling`).
pub fn normalize_worktree_layout(raw: Option<&str>) -> &'static str {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) if s.eq_ignore_ascii_case("sibling") => "sibling",
        _ => "cli",
    }
}

/// Shared CLI GROK_HOME (`~/.grok`) used for worktree placement.
/// Matches Grok Build 0.2.x `~/.grok/worktrees/<repo>/…` regardless of
/// App independent agent-home (git worktrees are filesystem layout, not session store).
pub fn shared_cli_grok_home() -> std::path::PathBuf {
    crate::process_util::user_home().join(".grok")
}

/// CLI worktrees root: `{GROK_HOME}/worktrees`.
pub fn cli_worktrees_home(grok_home: &std::path::Path) -> std::path::PathBuf {
    grok_home.join("worktrees")
}

/// Repo folder slug for CLI layout (main worktree basename).
pub fn worktree_repo_slug(main_worktree_path: &str) -> Result<String, String> {
    let main = normalize_fs_path(main_worktree_path);
    if main.is_empty() {
        return Err("empty main worktree path".into());
    }
    let main_pb = std::path::PathBuf::from(&main);
    main_pb
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "cannot derive repo folder name".to_string())
}

/// CLI-aligned path: `{GROK_HOME}/worktrees/<main_basename>/<name>`.
///
/// Example: grok_home `~/.grok`, main `/Users/me/Code/oss-grok-app`, name `feat`
/// → `~/.grok/worktrees/oss-grok-app/feat`.
///
/// Matches Grok Build 0.2.x (`grok --worktree=…`, `grok worktree list`).
pub fn build_worktree_cli_path(
    main_worktree_path: &str,
    name: &str,
    grok_home: &std::path::Path,
) -> Result<String, String> {
    let main = normalize_fs_path(main_worktree_path);
    if main.is_empty() {
        return Err("empty main worktree path".into());
    }
    let safe = sanitize_worktree_name(name)?;
    let slug = worktree_repo_slug(&main)?;
    let path = cli_worktrees_home(grok_home).join(slug).join(safe);
    let s = path.to_string_lossy().replace('\\', "/");
    let s = normalize_fs_path(&s);
    if s == main || s.is_empty() {
        return Err("resolved worktree path is invalid".into());
    }
    Ok(s)
}

/// Build sibling worktree path: `<parent>/<main_basename>-<name>`.
///
/// Example: main `/Users/me/repo` + name `feat` → `/Users/me/repo-feat`.
///
/// Optional alternative to CLI home layout — matches common
/// `git worktree add ../repo-feat` practice.
pub fn build_worktree_sibling_path(main_worktree_path: &str, name: &str) -> Result<String, String> {
    let main = normalize_fs_path(main_worktree_path);
    if main.is_empty() {
        return Err("empty main worktree path".into());
    }
    let safe = sanitize_worktree_name(name)?;
    let main_pb = std::path::PathBuf::from(&main);
    let base = main_pb
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "cannot derive repo folder name".to_string())?;
    let parent = main_pb
        .parent()
        .ok_or_else(|| "main worktree has no parent directory".to_string())?;
    let dir_name = format!("{base}-{safe}");
    let path = parent.join(dir_name);
    let s = path.to_string_lossy().replace('\\', "/");
    let s = normalize_fs_path(&s);
    if s == main || s.is_empty() {
        return Err("resolved worktree path is invalid".into());
    }
    Ok(s)
}

/// Resolve create path for layout (`cli` default, or `sibling`).
pub fn build_worktree_path_for_layout(
    layout: Option<&str>,
    main_worktree_path: &str,
    name: &str,
) -> Result<String, String> {
    match normalize_worktree_layout(layout) {
        "sibling" => build_worktree_sibling_path(main_worktree_path, name),
        _ => build_worktree_cli_path(main_worktree_path, name, &shared_cli_grok_home()),
    }
}

// from PR #88

/// Apply a CLI automatic remediation: `grok doctor fix <id> --yes`.
/// Returns redacted stdout/stderr; never throws on non-zero exit (ok=false).
#[tauri::command]
pub async fn cli_doctor_fix(id: String) -> Result<serde_json::Value, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("doctor fix id required".into());
    }
    if !is_safe_doctor_fix_id(&id) {
        return Err(format!("invalid doctor fix id: {id}"));
    }

    let id_for_cmd = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_grok_cli_args(
            &["doctor", "fix", &id_for_cmd, "--yes"],
            CLI_DOCTOR_FIX_TIMEOUT_SECS,
        )
    })
    .await
    .map_err(|e| format!("doctor fix worker panicked: {e}"))?;

    match result {
        Ok((stdout, stderr, exit_ok)) => Ok(serde_json::json!({
            "ok": exit_ok,
            "id": id,
            "stdout": redact_doctor_fix_output(&stdout, 2000),
            "stderr": redact_doctor_fix_output(&stderr, 800),
            "exitOk": exit_ok,
        })),
        Err(e) => {
            // Missing CLI / timeout — surface as structured failure, not panic.
            Ok(serde_json::json!({
                "ok": false,
                "id": id,
                "stdout": "",
                "stderr": redact_doctor_fix_output(&e, 400),
                "exitOk": false,
                "error": redact_doctor_fix_output(&e, 400),
            }))
        }
    }
}

// from PR #63

/// Run resolved `grok update --check --json` and return a typed DTO.
#[tauri::command]
pub async fn cli_update_check() -> Result<crate::cli_update::CliUpdateCheck, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let settings = store::load_settings();
        crate::cli_update::check_cli_update(settings.manual_cli_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

// from PR #63 / channel UX (CLI ≥ 0.2.117)

/// Install CLI update / switch channel / pin version.
///
/// Optional `channel` (`stable`|`alpha`), `version` pin, and `force` reinstall.
/// Channel switch and version pin are mutually exclusive; unknown channels error
/// (never invented). Plain update still falls back to App install trust-chain.
#[tauri::command]
pub async fn cli_update_install(
    app: tauri::AppHandle,
    channel: Option<String>,
    version: Option<String>,
    force: Option<bool>,
) -> Result<crate::cli_install::CliInstallResult, String> {
    let opts = crate::cli_update::CliUpdateInstallOpts {
        channel,
        version,
        force: force.unwrap_or(false),
    };
    crate::cli_update::install_cli_update(app, opts).await
}

/// Recycle every warm agent process so the next send spawns fresh binaries.
/// Used after a CLI upgrade — running children keep executing the old image
/// until restarted (NEW-05). Chat history is untouched; sessions reconnect
/// lazily on the next send.
#[tauri::command]
pub async fn agents_recycle_all(
    app: tauri::AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    mgr.recycle_all_agents(&app, "cli_upgrade").await;
    Ok(())
}

// from PR #83

/// Count removal-like lines in `git worktree prune -v` output (best-effort).
pub fn count_worktree_prune_lines(output: &str) -> usize {
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| {
            let lower = l.to_ascii_lowercase();
            lower.contains("remov") || lower.contains("prun") || lower.starts_with("would ")
        })
        .count()
}

// from PR #77

/// Best-effort YAML frontmatter `description:` (first line / plain value).
fn extract_agent_description_from_content(content: &str) -> Option<String> {
    if !content.starts_with("---") {
        return None;
    }
    let rest = &content[3..];
    let end = rest.find("\n---")?;
    let fm = &rest[..end];
    for (i, line) in fm.lines().enumerate() {
        let trimmed = line.trim_start();
        if let Some(val) = trimmed.strip_prefix("description:") {
            let v = val.trim();
            if v == ">" || v == "|" || v == ">-" || v == "|-" {
                // Folded block: first non-empty indented line after this one.
                for next in fm.lines().skip(i + 1) {
                    if next.starts_with(' ') || next.starts_with('\t') {
                        let t = next.trim();
                        if !t.is_empty() {
                            return Some(t.to_string());
                        }
                    } else if !next.trim().is_empty() {
                        break;
                    }
                }
                return None;
            }
            if v.is_empty() {
                return None;
            }
            let unquoted = v
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
                .unwrap_or(v);
            let cleaned = unquoted.split_whitespace().collect::<Vec<_>>().join(" ");
            if cleaned.is_empty() {
                return None;
            }
            return Some(cleaned);
        }
    }
    None
}

// from PR #64

/// Create a linked git worktree, then return its path.
///
/// Default layout (`cli` / omitted): `{GROK_HOME}/worktrees/<repo>/<name>`
/// aligned with Grok Build 0.2.x (`grok --worktree=…`).
/// Optional `layout = "sibling"`: `<parent>/<main_basename>-<name>`.
///
/// Args are passed to `git` as an argv array (no shell) to avoid injection.
/// - Without `start_point`: `git worktree add -b <name> <path>` (branch from HEAD).
/// - With `start_point`: `git worktree add -b <name> <path> <start_point>`.
#[tauri::command]
pub async fn git_worktree_add(
    project_path: String,
    name: String,
    start_point: Option<String>,
    layout: Option<String>,
) -> Result<GitWorktreeAddResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Err("empty path".into());
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Err("project not a directory".into());
    }
    git_probe_work_tree(&project)?;

    let safe_name = sanitize_worktree_name(&name)?;
    let start = sanitize_worktree_ref(start_point.as_deref())?;
    let layout_kind = normalize_worktree_layout(layout.as_deref());

    // Worktree add materializes a full checkout (spawn + disk-heavy) — the
    // blocking pool keeps it from stalling the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        git_worktree_add_blocking(project, safe_name, start, layout_kind)
    })
    .await
    .map_err(|e| format!("git worktree add worker panicked: {e}"))?
}

fn git_worktree_add_blocking(
    project: String,
    safe_name: String,
    start: Option<String>,
    layout_kind: &'static str,
) -> Result<GitWorktreeAddResult, String> {
    // Resolve main worktree path (first porcelain entry) for path placement.
    let list_out = crate::process_util::command("git")
        .args(["-C", &project, "worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;
    if !list_out.status.success() {
        let err = String::from_utf8_lossy(&list_out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git worktree list failed".into()
        } else {
            err.chars().take(200).collect()
        });
    }
    let listed = parse_worktree_porcelain(&String::from_utf8_lossy(&list_out.stdout));
    let main_path = listed
        .first()
        .map(|w| w.path.clone())
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "could not resolve main worktree path".to_string())?;

    let target = build_worktree_path_for_layout(Some(layout_kind), &main_path, &safe_name)?;
    let target_pb = std::path::PathBuf::from(&target);
    if target_pb.exists() {
        return Err(format!("path already exists: {target}"));
    }
    // Refuse if already registered as a worktree.
    if listed.iter().any(|w| {
        let p = normalize_fs_path(&w.path);
        p.eq_ignore_ascii_case(&target) || p == target
    }) {
        return Err(format!("worktree already registered: {target}"));
    }

    // CLI layout nests under ~/.grok/worktrees/<repo>/ — ensure parents exist.
    if let Some(parent) = target_pb.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!("could not create worktree parent {}: {e}", parent.display())
        })?;
    }

    // Safe argv — never go through a shell.
    // `git worktree add -b <name> <path> [start_point]`
    let mut args: Vec<String> = vec![
        "-C".into(),
        project.clone(),
        "worktree".into(),
        "add".into(),
        "-b".into(),
        safe_name.clone(),
        target.clone(),
    ];
    if let Some(ref sp) = start {
        args.push(sp.clone());
    }

    let out = crate::process_util::command("git")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        return Err(if err.is_empty() {
            "git worktree add failed".into()
        } else {
            err.chars().take(400).collect()
        });
    }

    // Best-effort: re-list to pick up branch field for the new path.
    let branch = {
        let re = crate::process_util::command("git")
            .args(["-C", &project, "worktree", "list", "--porcelain"])
            .output()
            .ok();
        re.and_then(|o| {
            if !o.status.success() {
                return None;
            }
            let list = parse_worktree_porcelain(&String::from_utf8_lossy(&o.stdout));
            list.into_iter()
                .find(|w| {
                    let p = normalize_fs_path(&w.path);
                    p.eq_ignore_ascii_case(&target) || p == target
                })
                .and_then(|w| w.branch)
        })
        .or_else(|| Some(safe_name.clone()))
    };

    Ok(GitWorktreeAddResult {
        path: target,
        name: safe_name,
        start_point: start,
        branch,
    })
}

// from PR #83

/// Garbage-collect stale git worktree administrative files via `git worktree prune`.
///
/// Safe argv only (no shell). Soft-fails on missing git / non-repo with an Err.
/// When `dry_run` is true, nothing is deleted (`--dry-run`).
/// Optional `force` maps to `--expire now` when `max_age` is unset.
/// Optional `max_age` maps to `--expire <max_age>`.
#[tauri::command]
pub async fn git_worktree_gc(
    project_path: String,
    dry_run: bool,
    force: Option<bool>,
    max_age: Option<String>,
) -> Result<GitWorktreeGcResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Err("empty path".into());
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Err("project not a directory".into());
    }
    git_probe_work_tree(&project)?;

    let forced = force.unwrap_or(false);
    let age = sanitize_worktree_gc_max_age(max_age.as_deref())?;

    // Prune scans + removes admin files across the repo — blocking pool.
    tauri::async_runtime::spawn_blocking(move || {
        git_worktree_gc_blocking(project, dry_run, forced, age)
    })
    .await
    .map_err(|e| format!("git worktree gc worker panicked: {e}"))?
}

fn git_worktree_gc_blocking(
    project: String,
    dry_run: bool,
    forced: bool,
    age: Option<String>,
) -> Result<GitWorktreeGcResult, String> {
    // Snapshot prunable entries before prune for UI preview / summary.
    let prunable = {
        let list_out = crate::process_util::command("git")
            .args(["-C", &project, "worktree", "list", "--porcelain"])
            .output()
            .map_err(|e| e.to_string())?;
        if list_out.status.success() {
            parse_worktree_porcelain(&String::from_utf8_lossy(&list_out.stdout))
                .into_iter()
                .filter(|w| w.prunable)
                .map(|w| w.path)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        }
    };

    let args = build_worktree_gc_args(
        &project,
        dry_run,
        forced,
        age.as_deref(),
    )?;

    let out = crate::process_util::command("git")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        return Err(if err.is_empty() {
            "git worktree prune failed".into()
        } else {
            err.chars().take(400).collect()
        });
    }

    // prune -v writes progress to stderr on some git versions, stdout on others.
    let mut combined = String::new();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stdout.trim().is_empty() {
        combined.push_str(stdout.trim());
    }
    if !stderr.trim().is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(stderr.trim());
    }
    // Prefer verbose prune lines; fall back to porcelain prunable count on dry-run.
    let mut pruned_count = count_worktree_prune_lines(&combined);
    if pruned_count == 0 && !prunable.is_empty() {
        pruned_count = prunable.len();
    }

    let used_expire = match &age {
        Some(a) => Some(a.clone()),
        None if forced => Some("now".into()),
        None => None,
    };

    Ok(GitWorktreeGcResult {
        dry_run,
        forced,
        max_age: used_expire,
        output: combined.chars().take(4000).collect(),
        prunable,
        pruned_count,
    })
}

// from PR #74

/// Remove a linked git worktree via `git worktree remove` (argv only, no shell).
///
/// Refuses the main worktree. Optional `force` maps to `--force` (dirty / locked).
#[tauri::command]
pub async fn git_worktree_remove(
    project_path: String,
    worktree_path: String,
    force: Option<bool>,
) -> Result<GitWorktreeRemoveResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Err("empty path".into());
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Err("project not a directory".into());
    }
    git_probe_work_tree(&project)?;

    let target = normalize_fs_path(&worktree_path);
    if target.is_empty() {
        return Err("empty worktree path".into());
    }
    // Disallow option-like paths so a crafted path cannot become a git flag.
    if target.starts_with('-') {
        return Err("invalid worktree path".into());
    }

    // `git worktree remove` deletes a full checkout tree — blocking pool.
    tauri::async_runtime::spawn_blocking(move || {
        git_worktree_remove_blocking(project, target, force.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("git worktree remove worker panicked: {e}"))?
}

fn git_worktree_remove_blocking(
    project: String,
    target: String,
    forced: bool,
) -> Result<GitWorktreeRemoveResult, String> {
    let list_out = crate::process_util::command("git")
        .args(["-C", &project, "worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;
    if !list_out.status.success() {
        let err = String::from_utf8_lossy(&list_out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git worktree list failed".into()
        } else {
            err.chars().take(200).collect()
        });
    }
    let listed = parse_worktree_porcelain(&String::from_utf8_lossy(&list_out.stdout));
    if listed.is_empty() {
        return Err("no worktrees found".into());
    }

    refuse_remove_main_worktree(&listed, &target)?;

    let registered = listed.iter().any(|w| worktree_paths_equal(&w.path, &target));
    if !registered {
        return Err("worktree not registered for this repository".into());
    }

    // Use the path as listed by git (preserves real casing / form).
    let remove_path = listed
        .iter()
        .find(|w| worktree_paths_equal(&w.path, &target))
        .map(|w| w.path.clone())
        .unwrap_or(target.clone());

    // Safe argv — never go through a shell.
    // `git worktree remove [--force] <path>`
    let mut args: Vec<String> = vec![
        "-C".into(),
        project,
        "worktree".into(),
        "remove".into(),
    ];
    if forced {
        args.push("--force".into());
    }
    args.push(remove_path.clone());

    let out = crate::process_util::command("git")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        return Err(if err.is_empty() {
            "git worktree remove failed".into()
        } else {
            err.chars().take(400).collect()
        });
    }

    Ok(GitWorktreeRemoveResult {
        path: remove_path,
        forced,
    })
}

