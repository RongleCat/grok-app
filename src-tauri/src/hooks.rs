//! Grok Build hooks discovery under `~/.grok/hooks` and `<project>/.grok/hooks`.
//!
//! Management is list / reveal / open-folder only — no visual JSON editor.
//! Hook file format lives in the Grok Build user guide (`10-hooks.md`).

#![allow(dead_code)] // residual-clippy: join_hooks_path helper
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::process_util::user_home;

/// One on-disk entry under a hooks directory (file or subfolder).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    /// File or directory name (basename).
    pub name: String,
    /// Absolute path.
    pub path: String,
    /// `user` (global `~/.grok/hooks`) or `project` (`<cwd>/.grok/hooks`).
    pub scope: String,
    /// `file` | `dir`.
    pub kind: String,
    /// Lowercased extension without dot (files only; empty for dirs / no ext).
    pub ext: String,
    /// Byte size (0 for directories).
    pub size: u64,
    /// Last modified time in ms since UNIX epoch (0 when unavailable).
    pub mtime_ms: u64,
}

/// Result of scanning user (+ optional project) hooks directories.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksListResult {
    pub hooks: Vec<HookEntry>,
    pub user_dir: String,
    pub user_dir_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir_exists: Option<bool>,
    /// Absolute path to the local Grok Build hooks user-guide page when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_path: Option<String>,
}

/// `~/.grok/hooks` — always-trusted personal hooks.
pub fn user_hooks_dir() -> PathBuf {
    user_home().join(".grok").join("hooks")
}

/// `<project>/.grok/hooks` when `project_path` is a non-empty path.
pub fn project_hooks_dir(project_path: &str) -> Option<PathBuf> {
    let root = project_path.trim();
    if root.is_empty() {
        return None;
    }
    Some(PathBuf::from(root).join(".grok").join("hooks"))
}

/// Local user-guide page shipped with the CLI install (optional).
pub fn hooks_docs_path() -> PathBuf {
    user_home()
        .join(".grok")
        .join("docs")
        .join("user-guide")
        .join("10-hooks.md")
}

/// Join a hooks directory with a relative file name (pure; no FS access).
/// Rejects empty names, absolute paths, and parent-directory traversal.
pub fn join_hooks_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." {
        return None;
    }
    if n.contains('/') || n.contains('\\') {
        return None;
    }
    let p = Path::new(n);
    if p.is_absolute() {
        return None;
    }
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(dir.join(n))
}

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_ext(name: &str, is_dir: bool) -> String {
    if is_dir {
        return String::new();
    }
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

/// List top-level entries in a hooks directory (non-recursive).
/// Skips hidden names (leading `.`). Missing / unreadable dirs yield empty vec.
pub fn list_hooks_in_dir(dir: &Path, scope: &str) -> Vec<HookEntry> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let path = ent.path();
        let meta = match ent.metadata().or_else(|_| fs::metadata(&path)) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let kind = if is_dir { "dir" } else { "file" };
        let size = if is_dir { 0 } else { meta.len() };
        out.push(HookEntry {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            scope: scope.to_string(),
            kind: kind.to_string(),
            ext: entry_ext(&name, is_dir),
            size,
            mtime_ms: file_mtime_ms(&meta),
        });
    }
    sort_hook_entries(&mut out);
    out
}

/// Stable sort: scope (user then project), then name (case-insensitive).
pub fn sort_hook_entries(entries: &mut [HookEntry]) {
    entries.sort_by(|a, b| {
        let scope_ord = scope_rank(&a.scope).cmp(&scope_rank(&b.scope));
        if scope_ord != std::cmp::Ordering::Equal {
            return scope_ord;
        }
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
}

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "user" => 0,
        "project" => 1,
        _ => 2,
    }
}

/// Scan user hooks (+ project hooks when `project_path` is set).
pub fn collect_hooks_list(project_path: Option<&str>) -> HooksListResult {
    let user_dir = user_hooks_dir();
    let user_dir_exists = user_dir.is_dir();
    let mut hooks = if user_dir_exists {
        list_hooks_in_dir(&user_dir, "user")
    } else {
        Vec::new()
    };

    let (project_dir, project_dir_exists) = match project_path.and_then(project_hooks_dir) {
        Some(dir) => {
            let exists = dir.is_dir();
            if exists {
                hooks.extend(list_hooks_in_dir(&dir, "project"));
            }
            sort_hook_entries(&mut hooks);
            (Some(dir.to_string_lossy().to_string()), Some(exists))
        }
        None => (None, None),
    };

    let docs = hooks_docs_path();
    let docs_path = if docs.is_file() {
        Some(docs.to_string_lossy().to_string())
    } else {
        None
    };

    HooksListResult {
        hooks,
        user_dir: user_dir.to_string_lossy().to_string(),
        user_dir_exists,
        project_dir,
        project_dir_exists,
        docs_path,
    }
}

/// Ensure a hooks directory exists (`user` or `project`). Returns absolute path.
pub fn ensure_hooks_dir(scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    let dir = match scope.trim() {
        "user" | "" => user_hooks_dir(),
        "project" => project_hooks_dir(project_path.unwrap_or(""))
            .ok_or_else(|| "project path required for project hooks".to_string())?,
        other => {
            return Err(format!("unknown hooks scope: {other}"));
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("create hooks dir: {e}"))?;
    Ok(dir)
}

// ── Try-run (real process, path-scoped to hooks dirs only) ───────────────────

/// Default timeout for try-run (matches Grok Build hook default for most events).
pub const HOOKS_TRY_DEFAULT_TIMEOUT_SECS: u64 = 5;
/// Hard upper bound so the UI cannot hang the host.
pub const HOOKS_TRY_MAX_TIMEOUT_SECS: u64 = 60;
/// Minimum timeout (seconds).
pub const HOOKS_TRY_MIN_TIMEOUT_SECS: u64 = 1;
/// Max stdin JSON size (~32 KiB).
pub const HOOKS_TRY_MAX_STDIN_BYTES: usize = 32 * 1024;
/// Max stdout/stderr characters returned after redaction.
pub const HOOKS_TRY_MAX_OUTPUT_CHARS: usize = 16 * 1024;

/// Result of a real hook-script try-run (never invents success).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HooksTryRunResult {
    /// True only when the process exited 0 and did not time out.
    pub ok: bool,
    /// Host refused before spawn (path / stdin / etc.).
    pub refused: bool,
    /// Timed out and the child was killed.
    pub timed_out: bool,
    /// Process exit code when known (None when refused or timed out without status).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    /// Redacted + truncated stdout.
    pub stdout: String,
    /// Redacted + truncated stderr.
    pub stderr: String,
    pub duration_ms: u64,
    /// Resolved absolute path (empty when refuse before resolve).
    pub path: String,
    /// `user` | `project` when resolved under a hooks root.
    pub scope: String,
    pub timeout_secs: u64,
    /// Machine reason when refused or spawn failed: `empty_path`, `path_outside_hooks`,
    /// `not_a_file`, `stdin_too_large`, `invalid_json`, `spawn_failed`, `timeout`, …
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Short human message (redacted); empty when success with no detail.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl HooksTryRunResult {
    fn refused(reason: &str, message: &str, timeout_secs: u64) -> Self {
        Self {
            ok: false,
            refused: true,
            timed_out: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            path: String::new(),
            scope: String::new(),
            timeout_secs,
            reason: Some(reason.to_string()),
            message: Some(redact_hooks_output(message)),
        }
    }
}

/// Clamp optional timeout into `[MIN, MAX]`, defaulting when unset.
pub fn clamp_hooks_try_timeout(secs: Option<u64>) -> u64 {
    let raw = secs.unwrap_or(HOOKS_TRY_DEFAULT_TIMEOUT_SECS);
    raw.clamp(HOOKS_TRY_MIN_TIMEOUT_SECS, HOOKS_TRY_MAX_TIMEOUT_SECS)
}

/// Component-wise: `path` equals `root` or is a descendant (no string-prefix tricks).
pub fn path_under_hooks_root(path: &Path, root: &Path) -> bool {
    if path == root {
        return true;
    }
    let mut path_comps = path.components();
    for rc in root.components() {
        match path_comps.next() {
            Some(pc) if pc == rc => {}
            _ => return false,
        }
    }
    // path must have remaining components OR equal (handled above) — equal already returned.
    // Being under root means all root components matched; path may equal or go deeper.
    true
}

/// Allowed try-run roots: `(absolute_or_logical_dir, scope_label)`.
pub fn hooks_try_roots(project_path: Option<&str>) -> Vec<(PathBuf, String)> {
    let mut roots = vec![(user_hooks_dir(), "user".to_string())];
    if let Some(p) = project_path.and_then(project_hooks_dir) {
        roots.push((p, "project".to_string()));
    }
    roots
}

/// Resolve `path` to a real file under one of the allowed hooks roots.
/// Returns `(canonical_path, scope)` or a refuse reason + message.
pub fn resolve_hooks_try_path(
    path: &str,
    roots: &[(PathBuf, String)],
) -> Result<(PathBuf, String), (String, String)> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err(("empty_path".into(), "path is required".into()));
    }
    if raw.contains('\0') {
        return Err(("invalid_path".into(), "path contains NUL".into()));
    }
    let p = PathBuf::from(raw);
    // Reject relative paths — callers must pass absolute paths from the list API.
    if !p.is_absolute() {
        return Err((
            "path_not_absolute".into(),
            "hook try-run requires an absolute path under a hooks folder".into(),
        ));
    }
    // Must exist and be a regular file (canonicalize fails for missing).
    let meta = fs::symlink_metadata(&p)
        .map_err(|e| ("not_found".into(), format!("path not found: {e}")))?;
    if meta.file_type().is_dir() {
        return Err((
            "not_a_file".into(),
            "path is a directory, not a script".into(),
        ));
    }
    // Follow symlinks for the final path; gate on the resolved target.
    let canonical =
        fs::canonicalize(&p).map_err(|e| ("not_found".into(), format!("path not found: {e}")))?;
    if !canonical.is_file() {
        return Err(("not_a_file".into(), "path is not a regular file".into()));
    }

    for (root, scope) in roots {
        let root_canon = fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        if path_under_hooks_root(&canonical, &root_canon) {
            // Disallow the root directory itself as a "script".
            if canonical == root_canon {
                return Err((
                    "not_a_file".into(),
                    "path is the hooks folder, not a script".into(),
                ));
            }
            return Ok((canonical, scope.clone()));
        }
    }
    Err((
        "path_outside_hooks".into(),
        "refused: path is outside user/project hooks directories".into(),
    ))
}

/// Validate optional stdin: empty OK; non-empty must be JSON and within size cap.
pub fn validate_hooks_try_stdin(stdin: Option<&str>) -> Result<Option<String>, (String, String)> {
    let Some(raw) = stdin else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    // Cap on raw bytes (UTF-8 length).
    if raw.len() > HOOKS_TRY_MAX_STDIN_BYTES {
        return Err((
            "stdin_too_large".into(),
            format!(
                "stdin exceeds {HOOKS_TRY_MAX_STDIN_BYTES} byte limit (got {})",
                raw.len()
            ),
        ));
    }
    // Whitespace-only → treat as empty (no JSON parse).
    if raw.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<serde_json::Value>(raw).map_err(|e| {
        (
            "invalid_json".into(),
            format!("stdin is not valid JSON: {e}"),
        )
    })?;
    Ok(Some(raw.to_string()))
}

/// Redact secrets in hook try-run output (best-effort; pure).
pub fn redact_hooks_output(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for (i, line) in input.lines().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&redact_hooks_line(line));
    }
    // Preserve a single trailing newline if present.
    if input.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    // Also scrub whole-blob token spans when no newlines.
    if !input.contains('\n') {
        out = redact_hooks_line(input);
    }
    truncate_chars(&out, HOOKS_TRY_MAX_OUTPUT_CHARS)
}

fn redact_hooks_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let secret_keys = [
        "api_key",
        "apikey",
        "api-key",
        "secret",
        "password",
        "passwd",
        "token",
        "authorization",
        "bearer",
        "private_key",
        "private-key",
        "access_key",
        "secret_key",
        "client_secret",
        "xai_api_key",
        "openai_api_key",
    ];
    for key in secret_keys {
        if lower.contains(key) && (line.contains('=') || line.contains(':')) {
            if let Some(idx) = line.find(['=', ':']) {
                let (head, _) = line.split_at(idx + 1);
                return format!("{head} [REDACTED]");
            }
            return "[REDACTED]".to_string();
        }
    }
    redact_hooks_token_spans(line)
}

fn redact_hooks_token_spans(line: &str) -> String {
    let prefixes = [
        "sk-", "sk_", "rk-", "xai-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xoxb-", "xoxp-",
        "AKIA", "ASIA",
    ];
    let mut result = line.to_string();
    for pref in prefixes {
        let mut search_from = 0;
        while let Some(rel) = result[search_from..].find(pref) {
            let start = search_from + rel;
            let rest = &result[start + pref.len()..];
            let token_len = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .count();
            if token_len >= 12 {
                let end = start + pref.len() + token_len;
                result.replace_range(start..end, &format!("{pref}[REDACTED]"));
                search_from = start + pref.len() + "[REDACTED]".len();
            } else {
                search_from = start + pref.len();
            }
        }
    }
    // Bearer tokens
    if let Some(idx) = result.to_ascii_lowercase().find("bearer ") {
        let after = idx + "bearer ".len();
        if after < result.len() {
            let rest = &result[after..];
            let tok_len = rest.chars().take_while(|c| !c.is_whitespace()).count();
            if tok_len >= 8 {
                let end = after + tok_len;
                result.replace_range(after..end, "[REDACTED]");
            }
        }
    }
    result
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Build a process command for a hook script path (no freeform shell string).
pub fn hooks_try_command(script: &Path) -> std::process::Command {
    use crate::process_util::{self, looks_runnable};

    if looks_runnable(script) {
        // Direct exec — no freeform shell string.
        return process_util::command(script);
    }

    // Non-executable script files: interpret via a known shell, path as arg only.
    #[cfg(windows)]
    {
        let ext = script
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "ps1" {
            let mut cmd = process_util::command("powershell");
            cmd.arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File");
            cmd.arg(script);
            return cmd;
        }
        if ext == "bat" || ext == "cmd" {
            let mut cmd = process_util::command("cmd");
            cmd.arg("/C");
            cmd.arg(script);
            return cmd;
        }
        // Prefer bash (Git for Windows) for `.sh` hooks; fall back to cmd /C.
        if ext == "sh" {
            let mut cmd = process_util::command("bash");
            cmd.arg(script);
            return cmd;
        }
        let mut cmd = process_util::command("cmd");
        cmd.arg("/C");
        cmd.arg(script);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = process_util::command("/bin/sh");
        cmd.arg(script);
        cmd
    }
}

/// Real try-run: spawn the script under hooks roots only, optional JSON stdin, timeout, redacted output.
///
/// Never returns `ok: true` unless the process actually exited 0 without timing out.
pub fn try_run_hook_script(
    path: &str,
    project_path: Option<&str>,
    stdin_json: Option<&str>,
    timeout_secs: Option<u64>,
) -> HooksTryRunResult {
    let roots = hooks_try_roots(project_path);
    try_run_hook_script_with_roots(path, &roots, stdin_json, timeout_secs)
}

/// Same as [`try_run_hook_script`] with injectable roots (unit tests).
pub fn try_run_hook_script_with_roots(
    path: &str,
    roots: &[(PathBuf, String)],
    stdin_json: Option<&str>,
    timeout_secs: Option<u64>,
) -> HooksTryRunResult {
    let timeout = clamp_hooks_try_timeout(timeout_secs);

    let stdin_body = match validate_hooks_try_stdin(stdin_json) {
        Ok(v) => v,
        Err((reason, msg)) => return HooksTryRunResult::refused(&reason, &msg, timeout),
    };

    let (script, scope) = match resolve_hooks_try_path(path, roots) {
        Ok(v) => v,
        Err((reason, msg)) => {
            let mut r = HooksTryRunResult::refused(&reason, &msg, timeout);
            r.path = path.trim().to_string();
            return r;
        }
    };

    let cwd = script
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let start = std::time::Instant::now();
    let mut cmd = hooks_try_command(&script);
    cmd.current_dir(&cwd);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return HooksTryRunResult {
                ok: false,
                refused: false,
                timed_out: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: start.elapsed().as_millis() as u64,
                path: script.to_string_lossy().to_string(),
                scope,
                timeout_secs: timeout,
                reason: Some("spawn_failed".into()),
                message: Some(redact_hooks_output(&format!("failed to spawn: {e}"))),
            };
        }
    };

    // Write stdin (if any), then close so the child sees EOF.
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(ref body) = stdin_body {
            use std::io::Write;
            let _ = stdin.write_all(body.as_bytes());
        }
        drop(stdin);
    }

    // Drain pipes on background threads to avoid pipe-buffer deadlock.
    let stdout_handle = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });

    let deadline = std::time::Duration::from_secs(timeout);
    let mut timed_out = false;
    let mut exit_code: Option<i32> = None;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = status.code();
                break;
            }
            Ok(None) => {
                if start.elapsed() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            Err(e) => {
                let stdout = join_pipe(stdout_handle);
                let stderr = join_pipe(stderr_handle);
                return HooksTryRunResult {
                    ok: false,
                    refused: false,
                    timed_out: false,
                    exit_code: None,
                    stdout: redact_hooks_output(&stdout),
                    stderr: redact_hooks_output(&stderr),
                    duration_ms: start.elapsed().as_millis() as u64,
                    path: script.to_string_lossy().to_string(),
                    scope,
                    timeout_secs: timeout,
                    reason: Some("wait_failed".into()),
                    message: Some(redact_hooks_output(&format!("wait failed: {e}"))),
                };
            }
        }
    }

    let stdout_raw = join_pipe(stdout_handle);
    let stderr_raw = join_pipe(stderr_handle);
    let duration_ms = start.elapsed().as_millis() as u64;
    let stdout = redact_hooks_output(&stdout_raw);
    let stderr = redact_hooks_output(&stderr_raw);

    if timed_out {
        return HooksTryRunResult {
            ok: false,
            refused: false,
            timed_out: true,
            exit_code,
            stdout,
            stderr,
            duration_ms,
            path: script.to_string_lossy().to_string(),
            scope,
            timeout_secs: timeout,
            reason: Some("timeout".into()),
            message: Some(format!("timed out after {timeout}s")),
        };
    }

    let ok = matches!(exit_code, Some(0));
    HooksTryRunResult {
        ok,
        refused: false,
        timed_out: false,
        exit_code,
        stdout,
        stderr,
        duration_ms,
        path: script.to_string_lossy().to_string(),
        scope,
        timeout_secs: timeout,
        reason: if ok {
            None
        } else {
            Some("exit_nonzero".into())
        },
        message: if ok {
            None
        } else {
            Some(format!(
                "exit {}",
                exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "unknown".into())
            ))
        },
    }
}

fn join_pipe(handle: Option<std::thread::JoinHandle<Vec<u8>>>) -> String {
    match handle {
        Some(h) => match h.join() {
            Ok(buf) => String::from_utf8_lossy(&buf).to_string(),
            Err(_) => String::new(),
        },
        None => String::new(),
    }
}

include!("hooks_tests_ext.rs");
