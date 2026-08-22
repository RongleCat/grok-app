//! Grok Build workflows (`workflows_enabled`) — agent-home config sync +
//! discovery + soft-fail headless run.
//!
//! Config key (top-level, independent agent-home only):
//! - `workflows_enabled` (bool)
//!
//! Workflows are Rhai orchestration scripts run by the Grok Build **`workflow`
//! tool** (agent tool). There is **no** top-level `grok workflow` CLI
//! subcommand (probed against Grok Build 0.2.117). Scripts live under
//! `~/.grok/workflows/*.rhai` and project `.grok/workflows/*.rhai`.
//!
//! App surfaces:
//! - enable toggle → independent agent-home `config.toml`
//! - read-only discovery of definition names
//! - soft-fail **headless** invoke via short `grok -p` that must call the
//!   `workflow` tool by registered name (`validate_only` smoke by default)
//!
//! No visual workflow editor. Shared mode never rewrites `~/.grok/config.toml`.

#![allow(dead_code)] // residual-clippy: normalize_enabled
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::agent_home_config::{set_top_level_bool, update_config_toml_if_independent};
use serde::Serialize;

use crate::cli_probe;
use crate::process_util;
use crate::proxy;
use crate::store;

pub const CONFIG_KEY: &str = "workflows_enabled";

/// Normalize enable toggle (App default off).
pub fn normalize_enabled(raw: bool) -> bool {
    raw
}

/// Upsert `workflows_enabled` into a TOML-ish text blob.
pub fn set_workflows_enabled_in_toml(text: &str, enabled: bool) -> String {
    set_top_level_bool(text, CONFIG_KEY, enabled)
}

/// Write the config key into App agent-home (independent GROK_HOME only).
pub fn sync_workflows_to_agent_profile(
    session_data_mode: &str,
    enabled: bool,
) -> Result<(), String> {
    let path = update_config_toml_if_independent(session_data_mode, |existing| {
        set_workflows_enabled_in_toml(existing, enabled)
    })?;
    if let Some(path) = path {
        tracing::info!(
            "agent_workflows: synced {}={} → {}",
            CONFIG_KEY,
            enabled,
            path.display()
        );
    }
    Ok(())
}

/// Definition name = file stem (`review-changes.rhai` → `review-changes`).
pub fn workflow_name_from_file_name(file_name: &str) -> Option<String> {
    let base = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim();
    if base.is_empty() || base.starts_with('.') {
        return None;
    }
    let lower = base.to_ascii_lowercase();
    if !lower.ends_with(".rhai") {
        return None;
    }
    let stem = &base[..base.len() - ".rhai".len()];
    let stem = stem.trim();
    if stem.is_empty() || stem.eq_ignore_ascii_case("readme") {
        return None;
    }
    Some(stem.to_string())
}

fn scan_workflow_dir(dir: &Path, scope: &str) -> Vec<WorkflowDef> {
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(workflow_name_from_file_name)
        {
            Some(n) => n,
            None => continue,
        };
        out.push(WorkflowDef {
            name,
            path: path.to_string_lossy().to_string(),
            scope: scope.to_string(),
        });
    }
    out
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDef {
    pub name: String,
    pub path: String,
    /// `project` | `user` | `agent_home`
    pub scope: String,
}

fn sort_workflows(mut items: Vec<WorkflowDef>) -> Vec<WorkflowDef> {
    items.sort_by(|a, b| {
        let sa = scope_rank(&a.scope);
        let sb = scope_rank(&b.scope);
        sa.cmp(&sb).then_with(|| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        })
    });
    items
}

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "project" => 0,
        "user" => 1,
        "agent_home" => 2,
        _ => 9,
    }
}

/// Read-only soft-fail discovery of workflow `.rhai` names.
///
/// Scans (in order, de-dup by name case-insensitive, project wins):
/// - `<project>/.grok/workflows`
/// - `~/.grok/workflows`
/// - independent agent-home `workflows/` when different from `~/.grok`
pub fn discover_workflows(
    project_path: Option<&str>,
    session_data_mode: &str,
) -> DiscoverWorkflowsResult {
    let home = crate::process_util::user_home();
    let user_dir = home.join(".grok").join("workflows");
    let project_dir = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|p| PathBuf::from(p).join(".grok").join("workflows"));

    let active_home = crate::paths::resolve_agent_grok_home(session_data_mode);
    let agent_home_dir = active_home.join("workflows");

    let mut items = Vec::new();
    if let Some(ref dir) = project_dir {
        items.extend(scan_workflow_dir(dir, "project"));
    }
    items.extend(scan_workflow_dir(&user_dir, "user"));
    if agent_home_dir != user_dir {
        for w in scan_workflow_dir(&agent_home_dir, "agent_home") {
            if !items.iter().any(|e| e.name.eq_ignore_ascii_case(&w.name)) {
                items.push(w);
            }
        }
    }

    // De-dupe: project > user > agent_home (keep first after sort).
    items = sort_workflows(items);
    let mut seen = std::collections::HashSet::new();
    items.retain(|w| {
        let key = w.name.to_ascii_lowercase();
        if seen.contains(&key) {
            false
        } else {
            seen.insert(key);
            true
        }
    });

    DiscoverWorkflowsResult {
        workflows: items,
        user_dir: user_dir.to_string_lossy().to_string(),
        project_dir: project_dir.map(|p| p.to_string_lossy().to_string()),
        agent_home_dir: if agent_home_dir != user_dir {
            Some(agent_home_dir.to_string_lossy().to_string())
        } else {
            None
        },
        create_workflow_skill: home
            .join(".grok")
            .join("bundled")
            .join("skills")
            .join("create-workflow")
            .join("SKILL.md")
            .to_string_lossy()
            .to_string(),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverWorkflowsResult {
    pub workflows: Vec<WorkflowDef>,
    pub user_dir: String,
    pub project_dir: Option<String>,
    pub agent_home_dir: Option<String>,
    /// Bundled create-workflow skill path (may not exist on disk).
    pub create_workflow_skill: String,
}

// ── Soft-fail headless run (workflow tool via grok -p) ────────────────────

/// Soft cap on captured log characters returned to the FE (after redaction).
pub const MAX_RUN_LOG_CHARS: usize = 4_000;
/// Default soft timeout for validate_only smoke (ms).
pub const DEFAULT_VALIDATE_TIMEOUT_MS: u64 = 90_000;
/// Default soft timeout for a real launch attempt (ms).
pub const DEFAULT_LAUNCH_TIMEOUT_MS: u64 = 180_000;
/// Hard clamp so a stuck CLI cannot hang the host forever.
pub const MAX_RUN_TIMEOUT_MS: u64 = 300_000;
pub const WORKFLOW_NAME_MAX_LEN: usize = 96;

/// Soft-fail result for Settings run UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResult {
    pub ok: bool,
    /// `ok` | `invalid_name` | `cli_missing` | `timeout` | `spawn_failed` |
    /// `empty` | `nonzero_exit` | `soft_fail`
    pub reason: String,
    pub workflow_name: String,
    /// `validate` | `launch`
    pub mode: String,
    /// Truncated + redacted stdout/stderr snip for the result panel.
    pub log: Option<String>,
    pub truncated: bool,
    pub duration_ms: u64,
    pub cli_path: Option<String>,
    pub cli_version: Option<String>,
    /// Honesty note: no top-level `grok workflow` subcommand; headless path used.
    pub invoke_path: String,
}

#[allow(clippy::too_many_arguments)]
fn run_soft_fail(
    reason: &str,
    workflow_name: &str,
    mode: &str,
    log: Option<String>,
    truncated: bool,
    duration_ms: u64,
    cli_path: Option<String>,
    cli_version: Option<String>,
) -> WorkflowRunResult {
    WorkflowRunResult {
        ok: false,
        reason: reason.to_string(),
        workflow_name: workflow_name.to_string(),
        mode: mode.to_string(),
        log,
        truncated,
        duration_ms,
        cli_path,
        cli_version,
        invoke_path: "headless_workflow_tool".into(),
    }
}

/// Safe registered workflow name (letters, digits, `_`, `-`; no path seps).
pub fn is_valid_workflow_name(name: &str) -> bool {
    let n = name.trim();
    if n.is_empty() || n.len() > WORKFLOW_NAME_MAX_LEN {
        return false;
    }
    if n.contains("..") || n.contains('/') || n.contains('\\') {
        return false;
    }
    let mut chars = n.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Sanitize a raw name into a safe workflow filename stem.
/// Mirrors `src/lib/workflowsAuthor.ts` `sanitizeWorkflowName`.
pub fn sanitize_workflow_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("invalid workflow name".into());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid workflow name".into());
    }
    let mut s = trimmed.to_string();
    if s.to_ascii_lowercase().ends_with(".rhai") {
        s = s[..s.len() - ".rhai".len()].trim().to_string();
    }
    // Spaces / dots → dash; drop other junk; keep underscore.
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if ch == '_' {
            if !out.ends_with('_') {
                out.push('_');
            }
        } else if (ch == '-' || ch.is_whitespace() || ch == '.')
            && !out.is_empty()
            && !out.ends_with('-')
            && !out.ends_with('_')
        {
            out.push('-');
        }
        // else drop
    }
    while out.ends_with('-') || out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() || out.len() > WORKFLOW_NAME_MAX_LEN {
        return Err("invalid workflow name".into());
    }
    if out.eq_ignore_ascii_case("readme") {
        return Err("reserved workflow name".into());
    }
    if !is_valid_workflow_name(&out) {
        return Err("invalid workflow name".into());
    }
    Ok(out)
}

/// Minimal valid-ish Rhai scaffold (pure-literal meta). Honest comments only.
pub fn default_workflow_template(name: &str) -> Result<String, String> {
    let safe = sanitize_workflow_name(name)?;
    Ok(format!(
        r#"// Workflow scaffold: {safe}
// Full authoring: create-workflow skill (/create-workflow) or edit this .rhai.
// This App lists, creates templates, and smoke/runs — no visual graph editor.
// Optional args: pass an object via the workflow tool `args` map when launching.

let meta = #{{
    name: "{safe}",
    description: "Template scaffold — replace with real orchestration steps",
}};

// Guard optional args (unit `()` when absent).
let _note = if args == () {{ "no args" }} else {{ "args present" }};
log("template " + meta.name + " ready (" + _note + ") — edit or use /create-workflow");
complete(#{{ summary: "template scaffold", name: meta.name }});
"#
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCreateResult {
    pub name: String,
    pub path: String,
    pub scope: String,
    pub created: bool,
    pub overwritten: bool,
}

/// Resolve writable workflows directory for create scope.
///
/// - `user` → `~/.grok/workflows` (matches discovery + create-workflow skill)
/// - `project` → `{project}/.grok/workflows`
fn resolve_create_workflows_dir(
    scope: &str,
    project_path: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let scope = scope.trim().to_ascii_lowercase();
    match scope.as_str() {
        "user" | "" => {
            let home = crate::process_util::user_home();
            Ok((home.join(".grok").join("workflows"), "user".into()))
        }
        "project" => {
            let proj = project_path
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project path required for project scope".to_string())?;
            if proj.contains('\0') {
                return Err("invalid project path".into());
            }
            let root = PathBuf::from(proj);
            if root
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("invalid project path".into());
            }
            Ok((root.join(".grok").join("workflows"), "project".into()))
        }
        other => Err(format!("unknown workflow scope: {other}")),
    }
}

/// Create `{name}.rhai` under the scoped workflows dir. Path-scoped only.
/// Rejects overwrite unless `force` is true. Soft soft-fail via Result.
pub fn create_workflow_template(
    name: &str,
    scope: &str,
    project_path: Option<&str>,
    force: bool,
) -> Result<WorkflowCreateResult, String> {
    let stem = sanitize_workflow_name(name)?;
    let (dir, scope_label) = resolve_create_workflows_dir(scope, project_path)?;
    let path = dir.join(format!("{stem}.rhai"));

    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path not allowed: traversal".into());
    }
    if path.parent() != Some(dir.as_path()) {
        return Err("path not allowed: outside workflows directory".into());
    }

    let exists = path.is_file();
    if exists && !force {
        return Err(format!(
            "workflow already exists: {} (pass force to overwrite)",
            path.display()
        ));
    }

    fs::create_dir_all(&dir).map_err(|e| format!("could not create workflows dir: {e}"))?;
    let body = default_workflow_template(&stem)?;
    fs::write(&path, body.as_bytes()).map_err(|e| format!("could not write workflow file: {e}"))?;

    Ok(WorkflowCreateResult {
        name: stem,
        path: path.display().to_string(),
        scope: scope_label,
        created: !exists,
        overwritten: exists && force,
    })
}

/// Normalize run mode; unknown → `validate` (safest Settings path).
pub fn normalize_run_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "launch" | "run" | "start" => "launch",
        _ => "validate",
    }
}

/// Headless prompt that forces a single `workflow` tool call (pure for tests).
pub fn build_workflow_run_prompt(name: &str, mode: &str) -> String {
    let safe = name.trim();
    if normalize_run_mode(mode) == "launch" {
        format!(
            "Call the workflow tool exactly once with these parameters, then stop:\n\
             - name: \"{safe}\"\n\
             - agent_budget: 8\n\
             Do not invent script or script_path. Do not call other tools first.\n\
             After the tool returns, reply with only a short summary of success or error (no secrets, no full script)."
        )
    } else {
        format!(
            "Call the workflow tool exactly once with these parameters, then stop:\n\
             - name: \"{safe}\"\n\
             - validate_only: true\n\
             - agent_budget: 1\n\
             Do not invent script or script_path. Do not call other tools first.\n\
             This is a path-specific smoke check only — not a live multi-agent run.\n\
             After the tool returns, reply with only a short summary of success or error (no secrets, no full script)."
        )
    }
}

/// Build headless argv (without binary path). Pure for tests.
pub fn workflow_run_args(prompt: &str, mode: &str) -> Vec<String> {
    let max_turns = if normalize_run_mode(mode) == "launch" {
        "8"
    } else {
        "4"
    };
    vec![
        "-p".into(),
        prompt.to_string(),
        "--always-approve".into(),
        "--max-turns".into(),
        max_turns.into(),
        "--effort".into(),
        "low".into(),
        "--output-format".into(),
        "plain".into(),
    ]
}

fn clamp_timeout_ms(ms: Option<u64>, mode: &str) -> u64 {
    let default = if normalize_run_mode(mode) == "launch" {
        DEFAULT_LAUNCH_TIMEOUT_MS
    } else {
        DEFAULT_VALIDATE_TIMEOUT_MS
    };
    let v = ms.unwrap_or(default);
    v.clamp(5_000, MAX_RUN_TIMEOUT_MS)
}

fn truncate_chars(s: &str, max: usize) -> (String, bool) {
    let t = s.trim();
    if t.is_empty() {
        return (String::new(), false);
    }
    if t.chars().count() <= max {
        return (t.to_string(), false);
    }
    let clipped: String = t.chars().take(max.saturating_sub(1)).collect();
    (format!("{clipped}…"), true)
}

fn prepare_log(stdout: &str, stderr: &str) -> (Option<String>, bool) {
    let mut combined = String::new();
    let out = stdout.trim();
    let err = stderr.trim();
    if !out.is_empty() {
        combined.push_str(out);
    }
    if !err.is_empty() {
        if !combined.is_empty() {
            combined.push_str("\n--- stderr ---\n");
        }
        combined.push_str(err);
    }
    if combined.is_empty() {
        return (None, false);
    }
    let redacted = crate::agent_memory::redact_memory_preview(&combined);
    let (text, truncated) = truncate_chars(&redacted, MAX_RUN_LOG_CHARS);
    if text.is_empty() {
        (None, false)
    } else {
        (Some(text), truncated)
    }
}

enum ThreadWait<T> {
    Done(T),
    TimedOut,
    JoinErr,
}

fn wait_thread<T: Send + 'static>(
    handle: std::thread::JoinHandle<T>,
    timeout: Duration,
) -> ThreadWait<T> {
    let deadline = Instant::now() + timeout;
    loop {
        if handle.is_finished() {
            return match handle.join() {
                Ok(v) => ThreadWait::Done(v),
                Err(_) => ThreadWait::JoinErr,
            };
        }
        if Instant::now() >= deadline {
            return ThreadWait::TimedOut;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

/// Tauri event for progressive workflow headless output (Settings live log).
pub const WORKFLOW_RUN_PROGRESS_EVENT: &str = "workflows://run-progress";

/// Soft-fail headless invoke of a registered workflow by name.
///
/// Probe note: Grok Build has no `workflow` subcommand; the App uses short
/// headless `grok -p` and asks the agent to call the `workflow` tool once.
/// Default mode is `validate` (`validate_only: true` smoke). Never panics.
///
/// When `app` is provided, emits line-level progress on
/// [`WORKFLOW_RUN_PROGRESS_EVENT`] so Settings can show a live log.
pub fn run_workflow(
    name: &str,
    project_path: Option<&str>,
    mode: Option<&str>,
    timeout_ms: Option<u64>,
) -> WorkflowRunResult {
    run_workflow_inner(None, name, project_path, mode, timeout_ms)
}

/// Same as [`run_workflow`] but streams progress to the UI via `app`.
pub fn run_workflow_with_app(
    app: tauri::AppHandle,
    name: &str,
    project_path: Option<&str>,
    mode: Option<&str>,
    timeout_ms: Option<u64>,
) -> WorkflowRunResult {
    run_workflow_inner(Some(&app), name, project_path, mode, timeout_ms)
}

fn emit_workflow_progress(
    app: Option<&tauri::AppHandle>,
    name: &str,
    mode: &str,
    kind: &str,
    line: &str,
    elapsed_ms: u64,
) {
    let Some(app) = app else { return };
    use tauri::Emitter;
    let text = crate::agent_memory::redact_memory_preview(line);
    let text = text.chars().take(500).collect::<String>();
    if text.trim().is_empty() && kind != "status" {
        return;
    }
    let _ = app.emit(
        WORKFLOW_RUN_PROGRESS_EVENT,
        serde_json::json!({
            "workflowName": name,
            "mode": mode,
            "kind": kind,
            "line": text,
            "elapsedMs": elapsed_ms,
        }),
    );
}

fn run_workflow_inner(
    app: Option<&tauri::AppHandle>,
    name: &str,
    project_path: Option<&str>,
    mode: Option<&str>,
    timeout_ms: Option<u64>,
) -> WorkflowRunResult {
    let started = Instant::now();
    let mode_s = normalize_run_mode(mode.unwrap_or("validate"));
    let name_trim = name.trim();

    if !is_valid_workflow_name(name_trim) {
        return run_soft_fail(
            "invalid_name",
            name_trim,
            mode_s,
            None,
            false,
            started.elapsed().as_millis() as u64,
            None,
            None,
        );
    }

    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if !probe.found {
        return run_soft_fail(
            "cli_missing",
            name_trim,
            mode_s,
            None,
            false,
            started.elapsed().as_millis() as u64,
            None,
            probe.version.clone(),
        );
    }
    let cli_path = match probe.path.clone() {
        Some(p) => p,
        None => {
            return run_soft_fail(
                "cli_missing",
                name_trim,
                mode_s,
                None,
                false,
                started.elapsed().as_millis() as u64,
                None,
                probe.version.clone(),
            );
        }
    };
    let cli_version = probe.version.clone();

    let prompt = build_workflow_run_prompt(name_trim, mode_s);
    let args = workflow_run_args(&prompt, mode_s);
    let timeout = Duration::from_millis(clamp_timeout_ms(timeout_ms, mode_s));

    let cwd = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir);

    emit_workflow_progress(
        app,
        name_trim,
        mode_s,
        "status",
        "starting headless workflow tool…",
        0,
    );

    let mut cmd = Command::new(&cli_path);
    cmd.args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_util::apply_cli_env_std(&mut cmd);
    let grok_home = crate::paths::resolve_agent_grok_home(&settings.session_data_mode);
    let _ = std::fs::create_dir_all(&grok_home);
    cmd.env("GROK_HOME", &grok_home);
    if settings.session_data_mode != "shared" {
        crate::providers::prepare_route_auth_for_agent();
    }
    proxy::apply_to_std_command(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                target: "agent_workflows",
                error = %e,
                name = %name_trim,
                "workflow run spawn failed"
            );
            return run_soft_fail(
                "spawn_failed",
                name_trim,
                mode_s,
                None,
                false,
                started.elapsed().as_millis() as u64,
                Some(cli_path),
                cli_version,
            );
        }
    };

    use std::io::{BufRead, BufReader};
    use std::sync::{Arc, Mutex};

    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let name_owned = name_trim.to_string();
    let mode_owned = mode_s.to_string();
    let started_arc = Arc::new(started);

    if let Some(out) = child.stdout.take() {
        let buf = Arc::clone(&stdout_buf);
        let app_c = app.cloned();
        let n = name_owned.clone();
        let m = mode_owned.clone();
        let st = Arc::clone(&started_arc);
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut g) = buf.lock() {
                    if !g.is_empty() {
                        g.push('\n');
                    }
                    g.push_str(&line);
                }
                emit_workflow_progress(
                    app_c.as_ref(),
                    &n,
                    &m,
                    "stdout",
                    &line,
                    st.elapsed().as_millis() as u64,
                );
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let buf = Arc::clone(&stderr_buf);
        let app_c = app.cloned();
        let n = name_owned.clone();
        let m = mode_owned.clone();
        let st = Arc::clone(&started_arc);
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut g) = buf.lock() {
                    if !g.is_empty() {
                        g.push('\n');
                    }
                    g.push_str(&line);
                }
                emit_workflow_progress(
                    app_c.as_ref(),
                    &n,
                    &m,
                    "stderr",
                    &line,
                    st.elapsed().as_millis() as u64,
                );
            }
        });
    }

    // Poll until exit or soft timeout (kill child on timeout).
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Ok(st),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("timeout");
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => break Err("spawn_failed"),
        }
    };

    // Give reader threads a moment to flush last lines.
    std::thread::sleep(Duration::from_millis(80));
    let duration_ms = started.elapsed().as_millis() as u64;
    let stdout = stdout_buf.lock().map(|g| g.clone()).unwrap_or_default();
    let stderr = stderr_buf.lock().map(|g| g.clone()).unwrap_or_default();
    let (log, truncated) = prepare_log(&stdout, &stderr);

    match status {
        Err("timeout") => {
            emit_workflow_progress(
                app,
                name_trim,
                mode_s,
                "status",
                "timeout — killed headless process",
                duration_ms,
            );
            run_soft_fail(
                "timeout",
                name_trim,
                mode_s,
                log,
                truncated,
                duration_ms,
                Some(cli_path),
                cli_version,
            )
        }
        Err(_) => run_soft_fail(
            "spawn_failed",
            name_trim,
            mode_s,
            log,
            truncated,
            duration_ms,
            Some(cli_path),
            cli_version,
        ),
        Ok(st) => {
            let status_ok = st.success();
            emit_workflow_progress(
                app,
                name_trim,
                mode_s,
                "status",
                if status_ok {
                    "finished ok"
                } else {
                    "finished with non-zero exit"
                },
                duration_ms,
            );
            if log.is_none() {
                return run_soft_fail(
                    if status_ok { "empty" } else { "spawn_failed" },
                    name_trim,
                    mode_s,
                    None,
                    false,
                    duration_ms,
                    Some(cli_path),
                    cli_version,
                );
            }
            if status_ok {
                WorkflowRunResult {
                    ok: true,
                    reason: "ok".into(),
                    workflow_name: name_trim.to_string(),
                    mode: mode_s.to_string(),
                    log,
                    truncated,
                    duration_ms,
                    cli_path: Some(cli_path),
                    cli_version,
                    invoke_path: "headless_workflow_tool".into(),
                }
            } else {
                WorkflowRunResult {
                    ok: false,
                    reason: "nonzero_exit".into(),
                    workflow_name: name_trim.to_string(),
                    mode: mode_s.to_string(),
                    log,
                    truncated,
                    duration_ms,
                    cli_path: Some(cli_path),
                    cli_version,
                    invoke_path: "headless_workflow_tool".into(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_and_name() {
        assert!(!normalize_enabled(false));
        assert!(normalize_enabled(true));
        assert_eq!(
            workflow_name_from_file_name("review-changes.rhai").as_deref(),
            Some("review-changes")
        );
        assert_eq!(
            workflow_name_from_file_name("path/to/Foo.RHAI").as_deref(),
            Some("Foo")
        );
        assert!(workflow_name_from_file_name("notes.md").is_none());
        assert!(workflow_name_from_file_name(".hidden.rhai").is_none());
        assert!(workflow_name_from_file_name("README.rhai").is_none());
        assert!(workflow_name_from_file_name("").is_none());
    }

    #[test]
    fn upserts_top_level_key() {
        let t = set_workflows_enabled_in_toml("", true);
        assert!(t.contains("workflows_enabled = true"));

        let existing = "[ui]\nyolo = false\n\n[subagents]\nenabled = true\n";
        let next = set_workflows_enabled_in_toml(existing, false);
        assert!(next.contains("workflows_enabled = false"));
        let ui_pos = next.find("[ui]").unwrap();
        let key_pos = next.find("workflows_enabled").unwrap();
        assert!(key_pos < ui_pos);
        assert!(next.contains("[subagents]"));
        assert!(next.contains("yolo = false"));

        let again = set_workflows_enabled_in_toml(&next, true);
        assert!(again.contains("workflows_enabled = true"));
        assert_eq!(again.matches("workflows_enabled").count(), 1);
    }

    #[test]
    fn shared_mode_skips_write() {
        // Should not error and must not require a real agent-home path.
        assert!(sync_workflows_to_agent_profile("shared", true).is_ok());
    }

    #[test]
    fn validates_workflow_names() {
        assert!(is_valid_workflow_name("review-changes"));
        assert!(is_valid_workflow_name("Foo_Bar1"));
        assert!(!is_valid_workflow_name(""));
        assert!(!is_valid_workflow_name("../evil"));
        assert!(!is_valid_workflow_name("a/b"));
        assert!(!is_valid_workflow_name("has space"));
        assert!(!is_valid_workflow_name(&"a".repeat(100)));
    }

    #[test]
    fn sanitizes_and_templates() {
        assert_eq!(
            sanitize_workflow_name("  my workflow  ").as_deref(),
            Ok("my-workflow")
        );
        assert_eq!(
            sanitize_workflow_name("find.flaky.rhai").as_deref(),
            Ok("find-flaky")
        );
        assert!(sanitize_workflow_name("../evil").is_err());
        assert!(sanitize_workflow_name("README").is_err());
        let body = default_workflow_template("review-changes").unwrap();
        assert!(body.contains("let meta = #{"));
        assert!(body.contains("review-changes"));
        assert!(body.contains("create-workflow"));
        assert!(!body.contains("parallel("));
    }

    #[test]
    fn create_workflow_template_project_idempotent() {
        let tmp = std::env::temp_dir().join(format!("grok-wf-create-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let r1 = create_workflow_template("demo-wf", "project", Some(tmp.to_str().unwrap()), false)
            .unwrap();
        assert!(r1.created);
        assert!(!r1.overwritten);
        assert!(Path::new(&r1.path).is_file());
        let err =
            create_workflow_template("demo-wf", "project", Some(tmp.to_str().unwrap()), false);
        assert!(err.is_err());
        let r2 = create_workflow_template("demo-wf", "project", Some(tmp.to_str().unwrap()), true)
            .unwrap();
        assert!(r2.overwritten);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn run_mode_and_prompt() {
        assert_eq!(normalize_run_mode("validate"), "validate");
        assert_eq!(normalize_run_mode("launch"), "launch");
        assert_eq!(normalize_run_mode("run"), "launch");
        assert_eq!(normalize_run_mode("nope"), "validate");

        let v = build_workflow_run_prompt("review-changes", "validate");
        assert!(v.contains("validate_only: true"));
        assert!(v.contains("review-changes"));
        let l = build_workflow_run_prompt("review-changes", "launch");
        assert!(l.contains("agent_budget: 8"));
        assert!(!l.contains("validate_only"));
    }

    #[test]
    fn run_args_include_plain_and_approve() {
        let a = workflow_run_args("hello", "validate");
        assert!(a.contains(&"-p".into()));
        assert!(a.contains(&"hello".into()));
        assert!(a.contains(&"--always-approve".into()));
        assert!(a.contains(&"plain".into()));
        assert!(a.contains(&"4".into()));
        let b = workflow_run_args("hello", "launch");
        assert!(b.contains(&"8".into()));
    }

    #[test]
    fn invalid_name_soft_fails_without_spawn() {
        let r = run_workflow("../evil", None, Some("validate"), Some(5_000));
        assert!(!r.ok);
        assert_eq!(r.reason, "invalid_name");
        assert_eq!(r.invoke_path, "headless_workflow_tool");
    }
}
