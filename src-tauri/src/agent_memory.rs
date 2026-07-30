//! Cross-session memory (Grok Build experimental) — spawn flags, env, config.
//!
//! CLI: `--experimental-memory` / `--no-memory`, `GROK_MEMORY`, `[memory] enabled`,
//! `grok memory clear`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cli_probe;
use crate::paths::{agent_config_toml, ensure_app_dirs, resolve_agent_grok_home};
use crate::process_util;

/// Top-level CLI flag (before `agent`) for the experimental_memory setting.
pub fn memory_spawn_flag(enabled: bool) -> &'static str {
    if enabled {
        "--experimental-memory"
    } else {
        "--no-memory"
    }
}

/// `GROK_MEMORY` env value for the agent process.
pub fn memory_spawn_env_value(enabled: bool) -> &'static str {
    if enabled {
        "1"
    } else {
        "0"
    }
}

/// When off, always force-disable so config cannot leak memory on.
pub fn should_force_disable_memory(experimental_memory: bool) -> bool {
    !experimental_memory
}

/// Upsert `[memory] enabled = bool` in a TOML-ish text blob.
pub fn set_memory_enabled_in_toml(text: &str, enabled: bool) -> String {
    set_table_bool(text, "memory", "enabled", enabled)
}

fn set_table_bool(text: &str, table: &str, key: &str, value: bool) -> String {
    let header = format!("[{table}]");
    let line_val = format!("{key} = {value}");
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_table = false;
    let mut table_start: Option<usize> = None;
    for i in 0..lines.len() {
        let trimmed = lines[i].trim().to_string();
        if trimmed.starts_with('[') {
            if trimmed == header {
                in_table = true;
                table_start = Some(i);
            } else if in_table {
                lines.insert(i, line_val);
                return lines.join("\n") + "\n";
            } else {
                in_table = false;
            }
            continue;
        }
        if in_table {
            let key_part = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key_part == key {
                lines[i] = line_val;
                return lines.join("\n") + "\n";
            }
        }
    }
    if let Some(start) = table_start {
        lines.insert(start + 1, line_val);
        return lines.join("\n") + "\n";
    }
    let block = format!("\n{header}\n{line_val}\n");
    let base = text.trim_end();
    if base.is_empty() {
        format!("{header}\n{line_val}\n")
    } else {
        format!("{base}{block}")
    }
}

/// Write `[memory] enabled` into App agent-home (independent GROK_HOME only).
pub fn sync_memory_to_agent_profile(
    session_data_mode: &str,
    experimental_memory: bool,
) -> Result<(), String> {
    if session_data_mode == "shared" {
        // Never rewrite the user's personal ~/.grok/config.toml from the App.
        return Ok(());
    }
    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = set_memory_enabled_in_toml(&existing, experimental_memory);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, next).map_err(|e| e.to_string())?;
    tracing::info!(
        "agent_memory: synced [memory] enabled={} → {}",
        experimental_memory,
        path.display()
    );
    Ok(())
}

/// Args for `grok memory clear` (workspace scope = product default).
pub fn memory_clear_cli_args(scope: &str) -> Vec<&'static str> {
    match scope.trim().to_ascii_lowercase().as_str() {
        "global" => vec!["memory", "clear", "-y", "--global"],
        "all" => vec!["memory", "clear", "-y", "--all"],
        _ => vec!["memory", "clear", "-y", "--workspace"],
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryClearResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub cwd: String,
}

/// Run `grok memory clear` scoped to `cwd` (project path when available).
pub fn clear_workspace_memory(
    cwd: Option<&Path>,
    session_data_mode: &str,
    manual_cli_path: Option<&str>,
    scope: &str,
) -> Result<MemoryClearResult, String> {
    let probe = cli_probe::probe_cli(manual_cli_path);
    let cli_path = probe
        .path
        .filter(|_| probe.found)
        .ok_or_else(|| "Grok Build CLI not found".to_string())?;

    let work_dir = cwd
        .map(Path::to_path_buf)
        .filter(|p| p.is_dir())
        .unwrap_or_else(process_util::user_home);

    let grok_home = resolve_agent_grok_home(session_data_mode);
    let args = memory_clear_cli_args(scope);

    let mut cmd = Command::new(&cli_path);
    cmd.args(&args)
        .current_dir(&work_dir)
        .env("GROK_HOME", &grok_home);
    if let Some(path) = process_util::enriched_path_env() {
        cmd.env("PATH", path);
    }
    process_util::apply_no_window_std(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("failed to run grok memory clear: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let ok = output.status.success();

    if !ok {
        let detail = if !stderr.is_empty() {
            stderr.clone()
        } else if !stdout.is_empty() {
            stdout.clone()
        } else {
            format!("exit {}", output.status)
        };
        return Err(format!("grok memory clear failed: {detail}"));
    }

    Ok(MemoryClearResult {
        ok: true,
        stdout,
        stderr,
        cwd: work_dir.display().to_string(),
    })
}

/// Apply spawn flag + env on a tokio Command (top-level, before `agent`).
pub fn apply_memory_to_command(cmd: &mut tokio::process::Command, enabled: bool) {
    cmd.arg(memory_spawn_flag(enabled));
    cmd.env("GROK_MEMORY", memory_spawn_env_value(enabled));
}

// ── Memory browser (disk inspect under GROK_HOME/memory) ───────────────────
//
// Grok Build layout (from CLI user guide):
//   {GROK_HOME}/memory/MEMORY.md                         — global
//   {GROK_HOME}/memory/<project-slug>-<hash8>/MEMORY.md  — workspace
//   {GROK_HOME}/memory/<slug>/sessions/*.md              — session logs
//   {GROK_HOME}/memory/<slug>/index.sqlite*              — search index
//
// Workspace dir hash is proprietary; we match by reading the
// `# Project Memory — <path>` header, basename prefix, and optional git origin.

use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Max chars returned in a text preview (after redaction).
pub const MEMORY_PREVIEW_CHARS: usize = 400;

/// Max bytes read from disk when building a text preview.
const PREVIEW_READ_BYTES: usize = 8 * 1024;

/// One on-disk memory artifact under `{GROK_HOME}/memory`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFileEntry {
    /// Absolute path.
    pub path: String,
    /// Basename.
    pub name: String,
    /// Path relative to the memory root (POSIX-style separators).
    pub relative_path: String,
    pub size: u64,
    /// Last modified time in ms since UNIX epoch (0 when unavailable).
    pub mtime_ms: u64,
    /// First N chars of text content, redacted. Empty for binary/index files.
    pub preview: String,
    /// `global` | `workspace` | `session` | `index` | `other`
    pub kind: String,
    /// Workspace directory name under memory root (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_slug: Option<String>,
    /// Whether this entry belongs to the requested project cwd (or is global).
    pub matched: bool,
}

/// Result of scanning memory files for a project workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryListResult {
    pub entries: Vec<MemoryFileEntry>,
    pub memory_root: String,
    pub memory_root_exists: bool,
    pub grok_home: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Workspace directory names matched for `cwd` (may be empty).
    pub workspace_slugs: Vec<String>,
}

/// `{GROK_HOME}/memory` for the active session-data mode.
pub fn memory_root_dir(session_data_mode: &str) -> PathBuf {
    resolve_agent_grok_home(session_data_mode).join("memory")
}

/// Classify a relative path under the memory root.
///
/// Pure helper — used by list + tests.
pub fn classify_memory_relative(rel: &str) -> (&'static str, Option<String>) {
    let rel = rel.trim().trim_start_matches('/').replace('\\', "/");
    if rel.is_empty() {
        return ("other", None);
    }
    let parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
    match parts.as_slice() {
        ["MEMORY.md"] => ("global", None),
        [slug, "MEMORY.md"] => ("workspace", Some((*slug).to_string())),
        [slug, "sessions", name] if !name.is_empty() => {
            ("session", Some((*slug).to_string()))
        }
        [slug, name]
            if name.starts_with("index.sqlite")
                || name.ends_with(".sqlite")
                || name.ends_with(".sqlite-wal")
                || name.ends_with(".sqlite-shm") =>
        {
            ("index", Some((*slug).to_string()))
        }
        [slug, ..] if parts.len() >= 2 => ("other", Some((*slug).to_string())),
        _ => ("other", None),
    }
}

/// Redact likely secrets/API keys in a short preview string (pure).
pub fn redact_memory_preview(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&redact_line(line));
    }
    // Also catch single-line blobs without newlines.
    if !input.contains('\n') && out == input {
        out = redact_line(input);
    }
    out
}

fn redact_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    // Whole-line redaction for obvious secret assignments / headers.
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
    redact_token_spans(line)
}

fn redact_token_spans(line: &str) -> String {
    // Common key prefixes + long high-entropy tokens.
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
            // Only redact if the token body is long enough to look like a key.
            if token_len >= 12 {
                let end = start + pref.len() + token_len;
                result.replace_range(start..end, &format!("{pref}[REDACTED]"));
                search_from = start + pref.len() + "[REDACTED]".len();
            } else {
                search_from = start + pref.len();
            }
        }
    }
    result
}

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn path_to_rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

/// Extract project path hints from a MEMORY.md header / body (pure).
///
/// Looks for lines like `# Project Memory — /Users/me/proj` or bare absolute paths.
pub fn extract_project_path_hints(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().take(20) {
        let t = line.trim();
        if let Some(rest) = t
            .strip_prefix("# Project Memory")
            .or_else(|| t.strip_prefix("# Workspace Memory"))
            .or_else(|| t.strip_prefix("# Project memory"))
        {
            let rest = rest.trim().trim_start_matches(['—', '-', ':', '–']).trim();
            if !rest.is_empty() {
                out.push(rest.to_string());
            }
        }
        // Fallback: first absolute path-looking token on early lines.
        if t.starts_with('/') || (t.len() > 2 && t.as_bytes()[1] == b':' && t.as_bytes()[0].is_ascii_alphabetic()) {
            if t.len() > 2 && !out.iter().any(|x| x == t) {
                out.push(t.to_string());
            }
        }
    }
    out
}

/// Normalize a filesystem path for fuzzy comparison (pure).
pub fn normalize_path_key(p: &str) -> String {
    let mut s = p.trim().replace('\\', "/");
    while s.ends_with('/') && s.len() > 1 {
        s.pop();
    }
    // Strip Windows drive quirks for equality only when both sides use it.
    s.to_ascii_lowercase()
}

/// Best-effort workspace identity tokens for matching dir names (pure-ish).
pub fn workspace_match_tokens(cwd: &Path) -> Vec<String> {
    let mut tokens = Vec::new();
    if let Some(name) = cwd.file_name().and_then(|n| n.to_str()) {
        let safe: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        if !safe.is_empty() {
            tokens.push(safe);
        }
    }
    // Git origin → org/repo and repo basename.
    if let Some(origin) = git_origin_url(cwd) {
        if let Some(org_repo) = origin_to_org_repo(&origin) {
            tokens.push(org_repo.replace('/', "-").to_ascii_lowercase());
            if let Some(repo) = org_repo.split('/').next_back() {
                tokens.push(repo.to_ascii_lowercase());
            }
            tokens.push(org_repo.to_ascii_lowercase());
        }
    }
    tokens
}

fn git_origin_url(cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// `git@host:org/repo.git` / `https://host/org/repo.git` → `org/repo`.
pub fn origin_to_org_repo(url: &str) -> Option<String> {
    let s = url.trim().trim_end_matches('/').trim_end_matches(".git");
    // SSH: git@github.com:org/repo
    if let Some(rest) = s.split_once(':').map(|(_, r)| r) {
        if !rest.contains("://") && rest.contains('/') {
            let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() >= 2 {
                return Some(format!(
                    "{}/{}",
                    parts[parts.len() - 2],
                    parts[parts.len() - 1]
                ));
            }
        }
    }
    // HTTPS / path
    if let Some(idx) = s.rfind('/') {
        let repo = &s[idx + 1..];
        let head = &s[..idx];
        if let Some(idx2) = head.rfind('/') {
            let org = &head[idx2 + 1..];
            if !org.is_empty() && !repo.is_empty() && !org.contains(':') {
                // Skip host-only (e.g. https://github.com with nothing else handled above)
                if !org.contains('.') || org.contains('.') && head.matches('/').count() >= 2 {
                    // Prefer last two path segments when host looks like a domain
                    let host_like = org.contains('.');
                    if host_like {
                        // org is actually host; need one more segment — already took last two of full URL
                        // e.g. https://github.com/org/repo → head ends with org
                    }
                    return Some(format!("{org}/{repo}"));
                }
            }
        }
    }
    None
}

fn paths_equal_fuzzy(a: &str, b: &str) -> bool {
    normalize_path_key(a) == normalize_path_key(b)
}

fn path_is_same_or_child(parent: &str, child: &str) -> bool {
    let p = normalize_path_key(parent);
    let c = normalize_path_key(child);
    c == p || c.starts_with(&(p.clone() + "/")) || p.starts_with(&(c.clone() + "/"))
}

fn workspace_dir_matches(
    slug: &str,
    memory_md_head: Option<&str>,
    cwd: &Path,
    tokens: &[String],
) -> bool {
    let cwd_str = cwd.to_string_lossy();
    if let Some(head) = memory_md_head {
        for hint in extract_project_path_hints(head) {
            if path_is_same_or_child(&hint, &cwd_str) || paths_equal_fuzzy(&hint, &cwd_str) {
                return true;
            }
        }
    }
    let slug_l = slug.to_ascii_lowercase();
    for t in tokens {
        if t.is_empty() {
            continue;
        }
        // Dir names are `{token}-{hash8}` or start with token.
        if slug_l == *t || slug_l.starts_with(&format!("{t}-")) {
            return true;
        }
    }
    false
}

fn read_preview_text(path: &Path, kind: &str) -> String {
    if kind == "index" {
        return String::new();
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.ends_with(".sqlite")
        || name.ends_with(".sqlite-wal")
        || name.ends_with(".sqlite-shm")
        || name.ends_with(".db")
        || name.ends_with(".bin")
    {
        return String::new();
    }
    let Ok(mut f) = fs::File::open(path) else {
        return String::new();
    };
    use std::io::Read;
    let mut buf = vec![0u8; PREVIEW_READ_BYTES];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    // Skip obvious binary.
    if buf.iter().any(|&b| b == 0) {
        return String::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut chars: String = text.chars().take(MEMORY_PREVIEW_CHARS).collect();
    if text.chars().count() > MEMORY_PREVIEW_CHARS {
        chars.push('…');
    }
    redact_memory_preview(&chars)
}

fn push_entry(
    out: &mut Vec<MemoryFileEntry>,
    root: &Path,
    path: &Path,
    matched: bool,
) {
    let meta = match fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return,
    };
    let rel = path_to_rel(root, path);
    let (kind, slug) = classify_memory_relative(&rel);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| name_from_rel(&rel));
    let preview = read_preview_text(path, kind);
    out.push(MemoryFileEntry {
        path: path.to_string_lossy().to_string(),
        name,
        relative_path: rel,
        size: meta.len(),
        mtime_ms: file_mtime_ms(&meta),
        preview,
        kind: kind.to_string(),
        workspace_slug: slug,
        matched,
    });
}

fn name_from_rel(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

/// List memory artifacts for `cwd` under the agent GROK_HOME memory tree.
///
/// Resilient when the memory dir is missing: returns empty entries.
/// Includes global `MEMORY.md` (matched=true) plus files under matched workspace
/// dirs. When no workspace matches, still returns global only.
pub fn list_workspace_memory(
    cwd: Option<&Path>,
    session_data_mode: &str,
) -> MemoryListResult {
    let grok_home = resolve_agent_grok_home(session_data_mode);
    let root = grok_home.join("memory");
    let root_exists = root.is_dir();
    let cwd_buf = cwd
        .map(Path::to_path_buf)
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.canonicalize().unwrap_or(p));

    let mut entries: Vec<MemoryFileEntry> = Vec::new();
    let mut matched_slugs: Vec<String> = Vec::new();

    if !root_exists {
        return MemoryListResult {
            entries,
            memory_root: root.display().to_string(),
            memory_root_exists: false,
            grok_home: grok_home.display().to_string(),
            cwd: cwd_buf.as_ref().map(|p| p.display().to_string()),
            workspace_slugs: matched_slugs,
        };
    }

    let tokens = cwd_buf
        .as_ref()
        .map(|p| workspace_match_tokens(p))
        .unwrap_or_default();

    // Top-level MEMORY.md (global)
    let global = root.join("MEMORY.md");
    if global.is_file() {
        push_entry(&mut entries, &root, &global, true);
    }

    // Workspace directories
    if let Ok(rd) = fs::read_dir(&root) {
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let path = ent.path();
            if !path.is_dir() {
                continue;
            }
            // Read workspace MEMORY.md head for path matching.
            let mem_md = path.join("MEMORY.md");
            let head = fs::read_to_string(&mem_md)
                .ok()
                .map(|s| s.chars().take(2048).collect::<String>());
            let matches = if let Some(ref cwd_p) = cwd_buf {
                workspace_dir_matches(&name, head.as_deref(), cwd_p, &tokens)
            } else {
                // No cwd: include all workspaces.
                true
            };
            if matches {
                matched_slugs.push(name.clone());
            }
            // Collect files one level + sessions/
            collect_workspace_files(&mut entries, &root, &path, &name, matches);
        }
    }

    entries.sort_by(|a, b| {
        // matched first, then kind rank, then relative path
        b.matched
            .cmp(&a.matched)
            .then_with(|| kind_rank(&a.kind).cmp(&kind_rank(&b.kind)))
            .then_with(|| {
                a.relative_path
                    .to_ascii_lowercase()
                    .cmp(&b.relative_path.to_ascii_lowercase())
            })
    });

    // When cwd is set, drop unmatched workspace files (keep global).
    if cwd_buf.is_some() {
        entries.retain(|e| e.matched);
    }

    MemoryListResult {
        entries,
        memory_root: root.display().to_string(),
        memory_root_exists: true,
        grok_home: grok_home.display().to_string(),
        cwd: cwd_buf.as_ref().map(|p| p.display().to_string()),
        workspace_slugs: matched_slugs,
    }
}

fn kind_rank(kind: &str) -> u8 {
    match kind {
        "global" => 0,
        "workspace" => 1,
        "session" => 2,
        "index" => 3,
        _ => 4,
    }
}

fn collect_workspace_files(
    out: &mut Vec<MemoryFileEntry>,
    root: &Path,
    workspace_dir: &Path,
    _slug: &str,
    matched: bool,
) {
    // MEMORY.md + index + other top-level files
    if let Ok(rd) = fs::read_dir(workspace_dir) {
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let path = ent.path();
            if path.is_file() {
                push_entry(out, root, &path, matched);
            } else if path.is_dir() && name == "sessions" {
                if let Ok(sd) = fs::read_dir(&path) {
                    for sent in sd.flatten() {
                        let sname = sent.file_name().to_string_lossy().to_string();
                        if sname.is_empty() || sname.starts_with('.') {
                            continue;
                        }
                        let sp = sent.path();
                        if sp.is_file() {
                            push_entry(out, root, &sp, matched);
                        }
                    }
                }
            }
        }
    }
}

/// True when `path` is a regular file under the memory root (after canonicalize).
pub fn is_safe_memory_file_path(path: &Path, memory_root: &Path) -> bool {
    let Ok(root) = memory_root.canonicalize() else {
        return false;
    };
    let Ok(canon) = path.canonicalize() else {
        return false;
    };
    if !canon.starts_with(&root) {
        return false;
    }
    if canon == root {
        return false;
    }
    // Must be a file, not a directory.
    match fs::metadata(&canon) {
        Ok(m) => m.is_file(),
        Err(_) => false,
    }
}

/// Delete a single memory file. Only paths under the known memory root are allowed.
pub fn delete_memory_file(
    path: &Path,
    session_data_mode: &str,
) -> Result<MemoryDeleteResult, String> {
    let root = memory_root_dir(session_data_mode);
    if !is_safe_memory_file_path(path, &root) {
        return Err("refusing to delete path outside memory store".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;
    let rel = path_to_rel(&root.canonicalize().unwrap_or_else(|_| root.clone()), &canon);
    let (kind, _) = classify_memory_relative(&rel);
    // Do not delete arbitrary non-memory-looking files if somehow nested.
    if kind == "other" {
        // Allow only markdown / sqlite index under workspace trees.
        let name = canon
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let ok = name.ends_with(".md")
            || name.starts_with("index.sqlite")
            || name.ends_with(".sqlite")
            || name.ends_with(".sqlite-wal")
            || name.ends_with(".sqlite-shm");
        if !ok {
            return Err("refusing to delete non-memory file".into());
        }
    }
    fs::remove_file(&canon).map_err(|e| format!("delete failed: {e}"))?;
    tracing::info!("agent_memory: deleted {}", canon.display());
    Ok(MemoryDeleteResult {
        ok: true,
        path: canon.display().to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteResult {
    pub ok: bool,
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    #[test]
    fn flags_and_env() {
        assert_eq!(memory_spawn_flag(true), "--experimental-memory");
        assert_eq!(memory_spawn_flag(false), "--no-memory");
        assert_eq!(memory_spawn_env_value(true), "1");
        assert_eq!(memory_spawn_env_value(false), "0");
        assert!(should_force_disable_memory(false));
        assert!(!should_force_disable_memory(true));
    }

    #[test]
    fn upserts_memory_table() {
        let t = set_memory_enabled_in_toml("", true);
        assert!(t.contains("[memory]"));
        assert!(t.contains("enabled = true"));
        let t2 = set_memory_enabled_in_toml(&t, false);
        assert!(t2.contains("enabled = false"));
        assert_eq!(t2.matches("enabled").count(), 1);

        let existing = "[ui]\nyolo = false\n\n[memory]\nenabled = true\n";
        let next = set_memory_enabled_in_toml(existing, false);
        assert!(next.contains("[memory]"));
        assert!(next.contains("enabled = false"));
        assert!(next.contains("[ui]"));
    }

    #[test]
    fn clear_args() {
        assert_eq!(
            memory_clear_cli_args("workspace"),
            vec!["memory", "clear", "-y", "--workspace"]
        );
        assert_eq!(
            memory_clear_cli_args("global"),
            vec!["memory", "clear", "-y", "--global"]
        );
        assert_eq!(
            memory_clear_cli_args("all"),
            vec!["memory", "clear", "-y", "--all"]
        );
        assert_eq!(
            memory_clear_cli_args(""),
            vec!["memory", "clear", "-y", "--workspace"]
        );
    }

    #[test]
    fn classify_relative_paths() {
        assert_eq!(classify_memory_relative("MEMORY.md"), ("global", None));
        assert_eq!(
            classify_memory_relative("proj-abc12345/MEMORY.md"),
            ("workspace", Some("proj-abc12345".into()))
        );
        assert_eq!(
            classify_memory_relative("proj-abc12345/sessions/2026-01-01.md"),
            ("session", Some("proj-abc12345".into()))
        );
        assert_eq!(
            classify_memory_relative("proj-abc12345/index.sqlite"),
            ("index", Some("proj-abc12345".into()))
        );
        assert_eq!(
            classify_memory_relative("proj-abc12345/index.sqlite-wal"),
            ("index", Some("proj-abc12345".into()))
        );
    }

    #[test]
    fn redacts_api_keys_and_tokens() {
        let s = redact_memory_preview("api_key = sk-abcdefghijklmnopqrstuvwxyz0123\nhello");
        assert!(s.contains("[REDACTED]"), "{s}");
        assert!(!s.contains("sk-abcdefghijklmnopqrstuvwxyz0123"), "{s}");

        let s2 = redact_memory_preview("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWX");
        assert!(s2.contains("[REDACTED]"), "{s2}");

        let s3 = redact_memory_preview("normal line without secrets");
        assert_eq!(s3, "normal line without secrets");

        let s4 = redact_memory_preview("Authorization: Bearer supersecrettokenvalue");
        assert!(s4.contains("[REDACTED]"), "{s4}");
    }

    #[test]
    fn extract_project_path_from_header() {
        let text = "# Project Memory — /Users/me/work/proj\n\n> note\n";
        let hints = extract_project_path_hints(text);
        assert!(hints.iter().any(|h| h.contains("/Users/me/work/proj")), "{hints:?}");
    }

    #[test]
    fn origin_to_org_repo_parses() {
        assert_eq!(
            origin_to_org_repo("git@github.com:RongleCat/grok-app.git").as_deref(),
            Some("RongleCat/grok-app")
        );
        assert_eq!(
            origin_to_org_repo("https://github.com/RongleCat/grok-app.git").as_deref(),
            Some("RongleCat/grok-app")
        );
    }

    #[test]
    fn normalize_path_key_trims_slash() {
        assert_eq!(
            normalize_path_key("/Users/Me/Proj/"),
            normalize_path_key("/users/me/proj")
        );
    }

    #[test]
    fn list_and_delete_memory_files_in_temp() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-mem-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mem = tmp.join("memory");
        let slug = "demo-proj-deadbeef";
        let ws = mem.join(slug);
        let sessions = ws.join("sessions");
        fs::create_dir_all(&sessions).unwrap();

        fs::write(mem.join("MEMORY.md"), "# Global Memory\n\nprefs\n").unwrap();
        fs::write(
            ws.join("MEMORY.md"),
            format!("# Project Memory — {}\n\nfacts\napi_key = sk-abcdefghijklmnopqrstuv\n", tmp.display()),
        )
        .unwrap();
        fs::write(sessions.join("2026-01-01-session.md"), "session log\n").unwrap();
        fs::write(ws.join("index.sqlite"), b"SQLite format 3\0fake").unwrap();

        // Point independent mode agent home at tmp via GROK_APP_HOME.
        let _guard = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        // Safety: only for this process during test.
        std::env::set_var("GROK_APP_HOME", &tmp);
        // agent-home is under app data; memory for independent is agent-home/memory
        // so place files under agent-home/memory instead.
        let agent_mem = tmp.join("agent-home").join("memory");
        fs::create_dir_all(agent_mem.join(slug).join("sessions")).unwrap();
        fs::write(agent_mem.join("MEMORY.md"), "# Global Memory\n").unwrap();
        let proj_path = tmp.join("demo-proj");
        fs::create_dir_all(&proj_path).unwrap();
        fs::write(
            agent_mem.join(slug).join("MEMORY.md"),
            format!(
                "# Project Memory — {}\n\nsecret api_key=sk-abcdefghijklmnopqrstuvwx\n",
                proj_path.display()
            ),
        )
        .unwrap();
        fs::write(
            agent_mem
                .join(slug)
                .join("sessions")
                .join("log.md"),
            "session\n",
        )
        .unwrap();
        fs::write(agent_mem.join(slug).join("index.sqlite"), b"notext\0bin").unwrap();

        let listed = list_workspace_memory(Some(&proj_path), "independent");
        assert!(listed.memory_root_exists, "{listed:?}");
        assert!(
            listed.entries.iter().any(|e| e.kind == "global"),
            "{:?}",
            listed.entries
        );
        assert!(
            listed
                .entries
                .iter()
                .any(|e| e.kind == "workspace" && e.matched),
            "{:?}",
            listed.entries
        );
        // Preview redacts keys
        let ws_entry = listed
            .entries
            .iter()
            .find(|e| e.kind == "workspace")
            .expect("workspace entry");
        assert!(
            !ws_entry.preview.contains("sk-abcdefghijklmnopqrstuvwx"),
            "preview leaked key: {}",
            ws_entry.preview
        );
        assert!(
            ws_entry.preview.contains("[REDACTED]") || ws_entry.preview.contains("api_key"),
            "{}",
            ws_entry.preview
        );

        // Delete a session file
        let session = listed
            .entries
            .iter()
            .find(|e| e.kind == "session")
            .expect("session");
        let del = delete_memory_file(Path::new(&session.path), "independent").unwrap();
        assert!(del.ok);
        assert!(!Path::new(&session.path).exists());

        // Refuse path outside memory root
        let outside = tmp.join("agent-home").join("config.toml");
        let _ = fs::File::create(&outside).and_then(|mut f| f.write_all(b"x"));
        assert!(delete_memory_file(&outside, "independent").is_err());

        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn safe_path_rejects_escape() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-mem-safe-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = tmp.join("memory");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("MEMORY.md"), "g\n").unwrap();
        fs::write(tmp.join("evil.txt"), "nope\n").unwrap();
        assert!(is_safe_memory_file_path(&root.join("MEMORY.md"), &root));
        assert!(!is_safe_memory_file_path(&tmp.join("evil.txt"), &root));
        assert!(!is_safe_memory_file_path(&root, &root));
        let _ = fs::remove_dir_all(&tmp);
        let _ = PathBuf::new(); // silence unused in some rustc
    }
}
