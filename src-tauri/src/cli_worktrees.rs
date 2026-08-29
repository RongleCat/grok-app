//! List Grok Build CLI-tracked worktrees (`grok worktree list`).
//!
//! Prefers `grok worktree list --json`; falls back to careful text parsing when
//! `--json` is rejected by older CLIs. Soft-fails when the CLI is missing.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::cli_probe;
use crate::process_util;
use crate::store;

const CLI_WORKTREE_LIST_TIMEOUT_SECS: u64 = 15;
/// Path / stats are quick; rebuild scans the filesystem (CLI 0.2.117+).
const CLI_WORKTREE_DB_TIMEOUT_SECS: u64 = 45;
/// Cap rows returned to the UI (CLI index can grow large with subagents).
const CLI_WORKTREE_LIST_CAP: usize = 200;

/// One tracked worktree from `grok worktree list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeEntry {
    /// CLI index id (stable when present).
    pub id: String,
    /// Display name (folder basename, else short id).
    pub name: String,
    /// Absolute worktree path when known.
    pub path: String,
    /// Branch / git ref when known (`git_ref` in JSON, BRANCH column in text).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Lifecycle status (`alive`, `stale`, …) when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Kind: `user` / `subagent` / etc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Short repo name from CLI index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    /// Absolute source checkout path when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_repo: Option<String>,
    /// True when `path` exists as a directory (safe to open as cwd).
    #[serde(default)]
    pub path_ok: bool,
    /// Short HEAD commit when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
}

/// Result envelope for the worktree list panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreesResult {
    /// True when the list command succeeded (even if empty).
    pub available: bool,
    pub worktrees: Vec<CliWorktreeEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub cli_found: bool,
    /// How the list was parsed: `json` | `text` | `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/// Normalize path separators and strip trailing slashes (keep root `/`).
pub fn normalize_cli_wt_path(path: &str) -> String {
    let mut p = path.trim().replace('\\', "/");
    while p.len() > 1 && p.ends_with('/') {
        p.pop();
    }
    p
}

/// Expand a leading `~/` to the user home directory.
pub fn expand_tilde_path(path: &str, home: &Path) -> String {
    let t = path.trim();
    if t == "~" {
        return normalize_cli_wt_path(&home.to_string_lossy());
    }
    if let Some(rest) = t.strip_prefix("~/") {
        let joined = home.join(rest);
        return normalize_cli_wt_path(&joined.to_string_lossy());
    }
    if let Some(rest) = t.strip_prefix("~\\") {
        let joined = home.join(rest);
        return normalize_cli_wt_path(&joined.to_string_lossy());
    }
    normalize_cli_wt_path(t)
}

/// Display name: last path segment when present, else id (trimmed).
pub fn derive_cli_worktree_name(id: &str, path: &str) -> String {
    let p = normalize_cli_wt_path(path);
    if !p.is_empty() {
        if let Some(base) = Path::new(&p).file_name().and_then(|s| s.to_str()) {
            let b = base.trim();
            if !b.is_empty() && b != "." && b != ".." {
                return b.to_string();
            }
        }
    }
    let id = id.trim();
    if id.is_empty() {
        return "worktree".into();
    }
    // Keep subagent ids readable but capped for UI.
    if id.len() > 48 {
        format!("{}…", id.chars().take(40).collect::<String>())
    } else {
        id.to_string()
    }
}

fn json_str_field(item: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = item.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn path_is_dir(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    PathBuf::from(path).is_dir()
}

/// Pure parse helper for `grok worktree list --json`.
///
/// Accepts a top-level array, or `{ worktrees: [...] }` / `{ items: [...] }`.
pub fn parse_cli_worktree_list_json(
    stdout: &str,
    home: &Path,
) -> Result<Vec<CliWorktreeEntry>, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // Tolerate leading log noise: take first `[` or `{`.
    let json_start = trimmed
        .find(['[', '{'])
        .ok_or_else(|| "cli worktree list: no JSON object/array".to_string())?;
    let slice = &trimmed[json_start..];
    let value: serde_json::Value =
        serde_json::from_str(slice).map_err(|e| format!("invalid cli worktree list JSON: {e}"))?;

    let items: Vec<serde_json::Value> = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value
        .get("worktrees")
        .or_else(|| value.get("items"))
        .or_else(|| value.get("entries"))
        .and_then(|v| v.as_array())
    {
        arr.clone()
    } else if value.is_object() {
        // Single object row.
        vec![value]
    } else {
        return Ok(Vec::new());
    };

    let mut out = Vec::with_capacity(items.len().min(CLI_WORKTREE_LIST_CAP));
    for item in items {
        if !item.is_object() {
            continue;
        }
        let id = json_str_field(&item, &["id", "worktree_id", "worktreeId"]).unwrap_or_default();
        let raw_path = json_str_field(&item, &["path", "worktree_path", "worktreePath", "dir"])
            .unwrap_or_default();
        let path = expand_tilde_path(&raw_path, home);
        if id.is_empty() && path.is_empty() {
            continue;
        }
        let branch = json_str_field(
            &item,
            &[
                "git_ref",
                "gitRef",
                "branch",
                "ref",
                "worktree_ref",
                "worktreeRef",
            ],
        );
        let status = json_str_field(&item, &["status", "state"]);
        let kind = json_str_field(&item, &["kind", "type", "worktree_type", "worktreeType"]);
        let repo_name = json_str_field(&item, &["repo_name", "repoName", "repo"]);
        let source_repo = json_str_field(&item, &["source_repo", "sourceRepo", "source"])
            .map(|s| expand_tilde_path(&s, home));
        let head =
            json_str_field(&item, &["head_commit", "headCommit", "head", "commit"]).map(|h| {
                if h.len() > 12 {
                    h.chars().take(12).collect()
                } else {
                    h
                }
            });
        let effective_id = if id.is_empty() {
            path.clone()
        } else {
            id.clone()
        };
        let name = derive_cli_worktree_name(&effective_id, &path);
        out.push(CliWorktreeEntry {
            id: effective_id,
            name,
            path: path.clone(),
            branch,
            status,
            kind,
            repo_name,
            source_repo,
            path_ok: path_is_dir(&path),
            head,
        });
        if out.len() >= CLI_WORKTREE_LIST_CAP {
            break;
        }
    }
    Ok(out)
}

/// Detect summary / header lines in text `grok worktree list` output.
fn is_cli_worktree_text_noise(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() {
        return true;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("id ") || lower == "id" {
        return true;
    }
    if lower.contains(" type ") && lower.contains(" path") {
        return true;
    }
    // "20 worktrees (20 subagent)" summary
    if lower.contains("worktree")
        && (lower.contains(" subagent")
            || lower.ends_with("worktrees")
            || lower.contains(" worktrees "))
        && t.chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
    {
        return true;
    }
    false
}

/// Pure parse helper for human table from `grok worktree list` (no --json).
///
/// Columns observed (Grok Build 0.2.x):
/// `ID TYPE REPO LABEL BRANCH AGE PATH`
/// Path is last; id is first; type is second. Branch is often `HEAD` or a name
/// just before the age token (`4d`, `4d ago`, `12h`).
pub fn parse_cli_worktree_list_text(stdout: &str, home: &Path) -> Vec<CliWorktreeEntry> {
    let text = stdout.replace("\r\n", "\n");
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if is_cli_worktree_text_noise(t) {
            continue;
        }
        // Prefer absolute / home path at end of line.
        let path_raw = extract_trailing_path(t);
        let Some(path_raw) = path_raw else {
            continue;
        };
        let path = expand_tilde_path(path_raw, home);
        if path.is_empty() {
            continue;
        }
        let left = t[..t.len().saturating_sub(path_raw.len())].trim_end();
        let mut tokens: Vec<&str> = left.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        // Drop trailing age tokens: "4d", "ago", "12h", "2mo", "3w"
        while let Some(last) = tokens.last().copied() {
            if is_age_token(last) {
                tokens.pop();
            } else {
                break;
            }
        }
        let id = tokens.first().copied().unwrap_or("").to_string();
        let kind = tokens.get(1).map(|s| (*s).to_string());
        // BRANCH is typically the last remaining token after REPO/LABEL (may be empty).
        let branch = tokens
            .iter()
            .rev()
            .find(|s| {
                let s = **s;
                !s.is_empty()
                    && s != "…"
                    && s != "..."
                    && !s.ends_with('…')
                    && s != id.as_str()
                    && kind.as_deref() != Some(s)
            })
            .map(|s| (*s).to_string());
        // Prefer a token that looks like a ref (HEAD, main, feat/x) over truncated repo.
        let branch = branch.filter(|b| {
            b == "HEAD"
                || b.contains('/')
                || b.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        });
        let effective_id = if id.is_empty() { path.clone() } else { id };
        let name = derive_cli_worktree_name(&effective_id, &path);
        out.push(CliWorktreeEntry {
            id: effective_id,
            name,
            path: path.clone(),
            branch,
            status: None,
            kind,
            repo_name: None,
            source_repo: None,
            path_ok: path_is_dir(&path),
            head: None,
        });
        if out.len() >= CLI_WORKTREE_LIST_CAP {
            break;
        }
    }
    out
}

fn is_age_token(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    if lower == "ago" {
        return true;
    }
    // 4d, 12h, 30m, 2w, 3mo, 1y
    let bytes = lower.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return false;
    }
    matches!(
        &lower[i..],
        "d" | "h" | "m" | "s" | "w" | "mo" | "y" | "min" | "mins" | "hr" | "hrs"
    )
}

/// Extract a trailing filesystem path token from a table row.
fn extract_trailing_path(line: &str) -> Option<&str> {
    let t = line.trim_end();
    // Find last occurrence of path-like start.
    // Scan from the right for a token starting with ~/, /, or X:/
    let mut best: Option<&str> = None;
    for (idx, ch) in t.char_indices().rev() {
        if ch == ' ' || ch == '\t' {
            let candidate = t[idx + 1..].trim();
            if looks_like_path(candidate) {
                best = Some(candidate);
                break;
            }
        }
    }
    if best.is_none() && looks_like_path(t) {
        best = Some(t);
    }
    best.filter(|s| !s.is_empty())
}

fn looks_like_path(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    if s.starts_with("~/") || s.starts_with("~\\") || s == "~" {
        return true;
    }
    if s.starts_with('/') {
        return true;
    }
    // Windows drive
    let b = s.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
    {
        return true;
    }
    // Relative worktree paths are rare in CLI output; ignore.
    false
}

/// Whether stderr/stdout looks like clap rejecting an unknown flag (`--json`).
pub fn looks_like_unsupported_json_flag(stderr: &str, stdout: &str) -> bool {
    let blob = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    blob.contains("unexpected argument")
        || blob.contains("unknown flag")
        || blob.contains("unrecognized option")
        || (blob.contains("--json")
            && (blob.contains("not found")
                || blob.contains("unknown")
                || blob.contains("unexpected")))
}

/// Whether stderr/stdout indicates the CLI lacks `worktree db` (pre-0.2.117).
pub fn looks_like_unsupported_worktree_db(stderr: &str, stdout: &str) -> bool {
    let blob = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    if blob.contains("unrecognized subcommand")
        || blob.contains("unknown subcommand")
        || blob.contains("unexpected subcommand")
    {
        // Subcommand may be quoted: 'db' / "db" / `db`
        if blob.contains("'db'")
            || blob.contains("\"db\"")
            || blob.contains("`db`")
            || blob.contains(" subcommand 'db'")
            || blob.contains(" subcommand \"db\"")
            || blob.contains(" subcommand db")
        {
            return true;
        }
        // Parent surface missing entirely: unrecognized subcommand 'worktree'
        if blob.contains("'worktree'")
            || blob.contains("\"worktree\"")
            || blob.contains(" subcommand worktree")
        {
            return true;
        }
    }
    // Help-style "error: the subcommand wasn't recognized"
    if (blob.contains("wasn't recognized") || blob.contains("was not recognized"))
        && (blob.contains("db") || blob.contains("worktree"))
    {
        return true;
    }
    false
}

// ── CLI worktree DB (path / stats / rebuild) — Grok Build 0.2.117+ ───────────

/// Parsed fields from `grok worktree db stats` (text or JSON).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeDbStats {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alive: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead: Option<u64>,
    /// Human size from CLI, e.g. `48.0 KB`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_size: Option<String>,
    /// Best-effort byte size when parseable from the human string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_size_bytes: Option<u64>,
}

/// Envelope for `cli_worktree_db_path`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeDbPathResult {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// True when the reported path exists on disk.
    #[serde(default)]
    pub path_ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub cli_found: bool,
    /// True when the CLI is present but lacks `worktree db` (pre-0.2.117).
    #[serde(default)]
    pub unsupported: bool,
}

/// Envelope for `cli_worktree_db_stats`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeDbStatsResult {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<CliWorktreeDbStats>,
    /// Compact one-line summary for the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Raw CLI stdout (truncated) when useful for debug / fallback display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub cli_found: bool,
    #[serde(default)]
    pub unsupported: bool,
    /// How stats were parsed: `json` | `text` | `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Envelope for `cli_worktree_db_rebuild`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliWorktreeDbRebuildResult {
    /// Command ran successfully.
    pub ok: bool,
    /// CLI + `worktree db rebuild` surface available.
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovered: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registered: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub already_tracked: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub cli_found: bool,
    #[serde(default)]
    pub unsupported: bool,
}

/// Parse a single `Label: value` line into (normalized_label, value).
fn split_stats_kv(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    let (left, right) = t.split_once(':')?;
    let key = left
        .trim()
        .trim_start_matches(['-', '•', '*'])
        .trim()
        .to_ascii_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let val = right.trim().to_string();
    if key.is_empty() || val.is_empty() {
        return None;
    }
    Some((key, val))
}

/// Extract the first integer from a value string (`20`, `20 records`, …).
pub fn parse_first_u64(s: &str) -> Option<u64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    // Direct integer or leading integer token.
    let token = t
        .split(|c: char| !(c.is_ascii_digit()))
        .find(|p| !p.is_empty())?;
    token.parse::<u64>().ok()
}

/// Best-effort parse of human size (`48.0 KB`, `1.2 MB`, `512 B`, `49152`).
pub fn parse_human_size_bytes(s: &str) -> Option<u64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    // Bare integer bytes
    if let Ok(n) = t.parse::<u64>() {
        return Some(n);
    }
    let lower = t.to_ascii_lowercase().replace(',', "");
    let mut num_str = String::new();
    let mut unit = String::new();
    let mut seen_dot = false;
    for ch in lower.chars() {
        if ch.is_ascii_digit() {
            num_str.push(ch);
        } else if ch == '.' && !seen_dot {
            num_str.push(ch);
            seen_dot = true;
        } else if ch.is_ascii_whitespace() {
            continue;
        } else if ch.is_ascii_alphabetic() {
            unit.push(ch);
        }
    }
    if num_str.is_empty() {
        return None;
    }
    let n: f64 = num_str.parse().ok()?;
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let mult: f64 = match unit.as_str() {
        "" | "b" | "byte" | "bytes" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    let bytes = (n * mult).round();
    if bytes > u64::MAX as f64 {
        return None;
    }
    Some(bytes as u64)
}

fn apply_stats_kv(stats: &mut CliWorktreeDbStats, key: &str, val: &str) {
    match key {
        "total" | "total records" | "records" | "count" | "total count"
            if stats.total.is_none() =>
        {
            stats.total = parse_first_u64(val);
        }
        "alive" | "alive records" | "live" | "active" if stats.alive.is_none() => {
            stats.alive = parse_first_u64(val);
        }
        "dead" | "dead records" | "stale" | "gone" | "missing" if stats.dead.is_none() => {
            stats.dead = parse_first_u64(val);
        }
        "db size" | "size" | "database size" | "file size" if stats.db_size.is_none() => {
            let cleaned = val.trim().to_string();
            if !cleaned.is_empty() {
                stats.db_size = Some(cleaned.clone());
                stats.db_size_bytes = parse_human_size_bytes(&cleaned);
            }
        }
        _ => {}
    }
}

/// Pure parse helper for human `grok worktree db stats` output.
///
/// Observed shape (Grok Build 0.2.117):
/// ```text
/// Worktree DB Statistics
/// ======================
///   Total records:  20
///   Alive:          20
///   Dead:           0
///   DB size:        48.0 KB
/// ```
pub fn parse_cli_worktree_db_stats_text(stdout: &str) -> CliWorktreeDbStats {
    let mut stats = CliWorktreeDbStats::default();
    for line in stdout.replace("\r\n", "\n").lines() {
        if let Some((key, val)) = split_stats_kv(line) {
            apply_stats_kv(&mut stats, &key, &val);
        }
    }
    stats
}

/// Pure parse helper for possible future `grok worktree db stats --json`.
///
/// Accepts a top-level object or `{ stats: {...} }` with snake/camel keys.
pub fn parse_cli_worktree_db_stats_json(stdout: &str) -> Result<CliWorktreeDbStats, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(CliWorktreeDbStats::default());
    }
    let json_start = trimmed
        .find('{')
        .ok_or_else(|| "cli worktree db stats: no JSON object".to_string())?;
    let slice = &trimmed[json_start..];
    let value: serde_json::Value = serde_json::from_str(slice)
        .map_err(|e| format!("invalid cli worktree db stats JSON: {e}"))?;
    let obj = value
        .get("stats")
        .or_else(|| value.get("statistics"))
        .or_else(|| value.get("data"))
        .unwrap_or(&value);
    let mut stats = CliWorktreeDbStats::default();
    if let Some(map) = obj.as_object() {
        for (k, v) in map {
            let key = k.trim().to_ascii_lowercase().replace(['_', '-'], " ");
            let val = if let Some(s) = v.as_str() {
                s.to_string()
            } else if let Some(n) = v.as_u64() {
                n.to_string()
            } else if let Some(n) = v.as_i64() {
                n.to_string()
            } else if let Some(n) = v.as_f64() {
                // Prefer integer when whole.
                if (n - n.floor()).abs() < f64::EPSILON && n >= 0.0 && n <= u64::MAX as f64 {
                    (n as u64).to_string()
                } else {
                    n.to_string()
                }
            } else {
                continue;
            };
            apply_stats_kv(&mut stats, &key, &val);
            // Direct camelCase / snake aliases for size fields
            if (key == "dbsize" || key == "db size bytes" || key == "size bytes")
                && stats.db_size_bytes.is_none()
            {
                stats.db_size_bytes = parse_first_u64(&val);
            }
        }
    }
    Ok(stats)
}

/// Build a compact one-line summary for the UI.
pub fn format_cli_worktree_db_stats_summary(stats: &CliWorktreeDbStats) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(n) = stats.total {
        parts.push(format!("{n} total"));
    }
    if let Some(n) = stats.alive {
        parts.push(format!("{n} alive"));
    }
    if let Some(n) = stats.dead {
        parts.push(format!("{n} dead"));
    }
    if let Some(ref s) = stats.db_size {
        parts.push(s.clone());
    } else if let Some(b) = stats.db_size_bytes {
        parts.push(format!("{b} B"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

/// True when at least one stats field was parsed.
pub fn cli_worktree_db_stats_has_data(stats: &CliWorktreeDbStats) -> bool {
    stats.total.is_some()
        || stats.alive.is_some()
        || stats.dead.is_some()
        || stats.db_size.is_some()
        || stats.db_size_bytes.is_some()
}

/// Pure parse helper for `grok worktree db rebuild` report text.
///
/// Observed:
/// ```text
/// Rebuild report:
///   Discovered:      20
///   Registered:      0
///   Already tracked: 20
/// ```
pub fn parse_cli_worktree_db_rebuild_text(stdout: &str) -> (Option<u64>, Option<u64>, Option<u64>) {
    let mut discovered = None;
    let mut registered = None;
    let mut already = None;
    for line in stdout.replace("\r\n", "\n").lines() {
        if let Some((key, val)) = split_stats_kv(line) {
            match key.as_str() {
                "discovered" | "found" if discovered.is_none() => {
                    discovered = parse_first_u64(&val);
                }
                "registered" | "added" | "new" if registered.is_none() => {
                    registered = parse_first_u64(&val);
                }
                "already tracked" | "already" | "tracked" | "unchanged" if already.is_none() => {
                    already = parse_first_u64(&val);
                }
                _ => {}
            }
        }
    }
    (discovered, registered, already)
}

/// Extract a single filesystem path from `grok worktree db path` stdout.
pub fn parse_cli_worktree_db_path_stdout(stdout: &str, home: &Path) -> Option<String> {
    let text = stdout.replace("\r\n", "\n");
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        // Skip labels / headers
        let lower = t.to_ascii_lowercase();
        if lower.starts_with("usage:")
            || lower.starts_with("error:")
            || lower.contains("worktree db")
            || lower == "path"
        {
            continue;
        }
        // Prefer path-like tokens
        let candidate = if looks_like_path(t) {
            t
        } else if let Some((_, right)) = t.split_once(':') {
            let r = right.trim();
            if looks_like_path(r) {
                r
            } else {
                continue;
            }
        } else {
            continue;
        };
        let expanded = expand_tilde_path(candidate, home);
        if !expanded.is_empty() {
            return Some(expanded);
        }
    }
    // Fallback: first non-empty line expanded
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let expanded = expand_tilde_path(t, home);
        if !expanded.is_empty() && (expanded.contains('/') || expanded.contains('\\')) {
            return Some(expanded);
        }
    }
    None
}

// ── CLI runner ──────────────────────────────────────────────────────────────

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
        // PATH + HOME (Windows GUI often lacks $HOME; CLI hub needs it).
        process_util::apply_cli_env_std(&mut cmd);
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok((stdout, stderr, output.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run grok: {e}")),
        Err(_) => Err(format!("grok command timed out after {timeout_secs}s")),
    }
}

fn user_home() -> PathBuf {
    process_util::user_home()
}

/// List CLI-tracked worktrees. Soft-fails when CLI is missing or list fails.
///
/// - `all`: pass `--all` when true (include stale / all ages per CLI).
/// - `repo`: optional `--repo <name>` filter (matches CLI `repo_name`).
#[tauri::command]
pub async fn cli_worktrees_list(
    all: Option<bool>,
    repo: Option<String>,
) -> Result<CliWorktreesResult, String> {
    let all = all.unwrap_or(false);
    let repo = repo.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    // Never pass shell-like junk into argv.
    if let Some(ref r) = repo {
        if r.starts_with('-') || r.contains('\0') || r.len() > 256 {
            return Ok(CliWorktreesResult {
                available: false,
                worktrees: vec![],
                reason: Some("invalid repo filter".into()),
                cli_found: true,
                source: Some("none".into()),
            });
        }
    }

    let home = user_home();
    let result =
        tauri::async_runtime::spawn_blocking(move || list_cli_worktrees_blocking(all, repo, home))
            .await
            .map_err(|e| format!("cli worktree list worker panicked: {e}"))?;
    Ok(result)
}

fn list_cli_worktrees_blocking(
    all: bool,
    repo: Option<String>,
    home: PathBuf,
) -> CliWorktreesResult {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if !probe.found {
        return CliWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some("Grok Build CLI not found".into()),
            cli_found: false,
            source: Some("none".into()),
        };
    }

    let mut json_args: Vec<String> = vec!["worktree".into(), "list".into(), "--json".into()];
    if all {
        json_args.push("--all".into());
    }
    if let Some(ref r) = repo {
        json_args.push("--repo".into());
        json_args.push(r.clone());
    }
    let json_refs: Vec<&str> = json_args.iter().map(|s| s.as_str()).collect();

    match run_grok_cli_args(&json_refs, CLI_WORKTREE_LIST_TIMEOUT_SECS) {
        Ok((stdout, stderr, ok)) => {
            if !stdout.trim().is_empty() {
                match parse_cli_worktree_list_json(&stdout, &home) {
                    Ok(list) => {
                        return CliWorktreesResult {
                            available: true,
                            worktrees: list,
                            reason: None,
                            cli_found: true,
                            source: Some("json".into()),
                        };
                    }
                    Err(e) => {
                        // If parse failed but looks like JSON noise, try text fallback below.
                        if ok && !looks_like_unsupported_json_flag(&stderr, &stdout) {
                            // Fall through to text only when stdout is not JSON-ish.
                            if stdout.trim_start().starts_with('[')
                                || stdout.trim_start().starts_with('{')
                            {
                                return CliWorktreesResult {
                                    available: false,
                                    worktrees: vec![],
                                    reason: Some(e.chars().take(240).collect()),
                                    cli_found: true,
                                    source: Some("none".into()),
                                };
                            }
                        }
                    }
                }
            }
            if looks_like_unsupported_json_flag(&stderr, &stdout) || stdout.trim().is_empty() {
                // Fall back to text table.
            } else if !ok {
                let detail = if stderr.trim().is_empty() {
                    "grok worktree list failed".to_string()
                } else {
                    stderr.chars().take(240).collect()
                };
                return CliWorktreesResult {
                    available: false,
                    worktrees: vec![],
                    reason: Some(detail),
                    cli_found: true,
                    source: Some("none".into()),
                };
            }
        }
        Err(e) => {
            return CliWorktreesResult {
                available: false,
                worktrees: vec![],
                reason: Some(e.chars().take(240).collect()),
                cli_found: !e.to_ascii_lowercase().contains("not found"),
                source: Some("none".into()),
            };
        }
    }

    // Text fallback (older CLI without --json, or empty JSON path).
    let mut text_args: Vec<String> = vec!["worktree".into(), "list".into()];
    if all {
        text_args.push("--all".into());
    }
    if let Some(ref r) = repo {
        text_args.push("--repo".into());
        text_args.push(r.clone());
    }
    let text_refs: Vec<&str> = text_args.iter().map(|s| s.as_str()).collect();
    match run_grok_cli_args(&text_refs, CLI_WORKTREE_LIST_TIMEOUT_SECS) {
        Ok((stdout, stderr, ok)) => {
            if !ok && stdout.trim().is_empty() {
                let detail = if stderr.trim().is_empty() {
                    "grok worktree list failed".to_string()
                } else {
                    stderr.chars().take(240).collect()
                };
                return CliWorktreesResult {
                    available: false,
                    worktrees: vec![],
                    reason: Some(detail),
                    cli_found: true,
                    source: Some("none".into()),
                };
            }
            let list = parse_cli_worktree_list_text(&stdout, &home);
            CliWorktreesResult {
                available: true,
                worktrees: list,
                reason: None,
                cli_found: true,
                source: Some("text".into()),
            }
        }
        Err(e) => CliWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some(e.chars().take(240).collect()),
            cli_found: !e.to_ascii_lowercase().contains("not found"),
            source: Some("none".into()),
        },
    }
}

// ── Host commands: worktree db path / stats / rebuild ────────────────────────

fn soft_db_path_err(
    cli_found: bool,
    unsupported: bool,
    reason: impl Into<String>,
) -> CliWorktreeDbPathResult {
    CliWorktreeDbPathResult {
        available: false,
        path: None,
        path_ok: false,
        reason: Some(reason.into()),
        cli_found,
        unsupported,
    }
}

fn soft_db_stats_err(
    cli_found: bool,
    unsupported: bool,
    reason: impl Into<String>,
) -> CliWorktreeDbStatsResult {
    CliWorktreeDbStatsResult {
        available: false,
        stats: None,
        summary: None,
        raw: None,
        reason: Some(reason.into()),
        cli_found,
        unsupported,
        source: Some("none".into()),
    }
}

fn soft_db_rebuild_err(
    cli_found: bool,
    unsupported: bool,
    reason: impl Into<String>,
) -> CliWorktreeDbRebuildResult {
    CliWorktreeDbRebuildResult {
        ok: false,
        available: false,
        message: None,
        discovered: None,
        registered: None,
        already_tracked: None,
        reason: Some(reason.into()),
        cli_found,
        unsupported,
    }
}

fn db_cli_probe() -> (bool, Option<String>) {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if !probe.found {
        return (false, None);
    }
    (true, probe.path)
}

/// Print CLI worktree DB path (`grok worktree db path`). Soft-fails on old CLIs.
#[tauri::command]
pub async fn cli_worktree_db_path() -> Result<CliWorktreeDbPathResult, String> {
    let home = user_home();
    let result = tauri::async_runtime::spawn_blocking(move || cli_worktree_db_path_blocking(home))
        .await
        .map_err(|e| format!("cli worktree db path worker panicked: {e}"))?;
    Ok(result)
}

fn cli_worktree_db_path_blocking(home: PathBuf) -> CliWorktreeDbPathResult {
    let (cli_found, _) = db_cli_probe();
    if !cli_found {
        return soft_db_path_err(false, false, "Grok Build CLI not found");
    }
    match run_grok_cli_args(&["worktree", "db", "path"], CLI_WORKTREE_DB_TIMEOUT_SECS) {
        Ok((stdout, stderr, ok)) => {
            if looks_like_unsupported_worktree_db(&stderr, &stdout) {
                return soft_db_path_err(
                    true,
                    true,
                    "CLI worktree DB requires Grok Build CLI 0.2.117+",
                );
            }
            if let Some(path) = parse_cli_worktree_db_path_stdout(&stdout, &home) {
                let path_ok = PathBuf::from(&path).exists();
                return CliWorktreeDbPathResult {
                    available: true,
                    path: Some(path),
                    path_ok,
                    reason: None,
                    cli_found: true,
                    unsupported: false,
                };
            }
            if !ok {
                let detail = if stderr.trim().is_empty() {
                    "grok worktree db path failed".to_string()
                } else {
                    stderr.chars().take(240).collect()
                };
                return soft_db_path_err(true, false, detail);
            }
            soft_db_path_err(true, false, "could not parse worktree DB path")
        }
        Err(e) => {
            let lower = e.to_ascii_lowercase();
            soft_db_path_err(
                !lower.contains("not found"),
                false,
                e.chars().take(240).collect::<String>(),
            )
        }
    }
}

/// Show CLI worktree DB stats (`grok worktree db stats`). Soft-fails on old CLIs.
///
/// Prefers text parse (current CLI); attempts JSON parse when stdout looks like
/// an object (future `--json` or accidental structured output).
#[tauri::command]
pub async fn cli_worktree_db_stats() -> Result<CliWorktreeDbStatsResult, String> {
    let result = tauri::async_runtime::spawn_blocking(cli_worktree_db_stats_blocking)
        .await
        .map_err(|e| format!("cli worktree db stats worker panicked: {e}"))?;
    Ok(result)
}

fn cli_worktree_db_stats_blocking() -> CliWorktreeDbStatsResult {
    let (cli_found, _) = db_cli_probe();
    if !cli_found {
        return soft_db_stats_err(false, false, "Grok Build CLI not found");
    }
    match run_grok_cli_args(&["worktree", "db", "stats"], CLI_WORKTREE_DB_TIMEOUT_SECS) {
        Ok((stdout, stderr, ok)) => {
            if looks_like_unsupported_worktree_db(&stderr, &stdout) {
                return soft_db_stats_err(
                    true,
                    true,
                    "CLI worktree DB requires Grok Build CLI 0.2.117+",
                );
            }
            let raw_trim = stdout.trim();
            let raw = if raw_trim.is_empty() {
                None
            } else {
                Some(raw_trim.chars().take(800).collect::<String>())
            };

            // Prefer JSON when the body looks like an object.
            if raw_trim.starts_with('{') {
                if let Ok(stats) = parse_cli_worktree_db_stats_json(&stdout) {
                    if cli_worktree_db_stats_has_data(&stats) {
                        let summary = format_cli_worktree_db_stats_summary(&stats);
                        return CliWorktreeDbStatsResult {
                            available: true,
                            stats: Some(stats),
                            summary,
                            raw,
                            reason: None,
                            cli_found: true,
                            unsupported: false,
                            source: Some("json".into()),
                        };
                    }
                }
            }

            let stats = parse_cli_worktree_db_stats_text(&stdout);
            if cli_worktree_db_stats_has_data(&stats) {
                let summary = format_cli_worktree_db_stats_summary(&stats);
                return CliWorktreeDbStatsResult {
                    available: true,
                    stats: Some(stats),
                    summary,
                    raw,
                    reason: None,
                    cli_found: true,
                    unsupported: false,
                    source: Some("text".into()),
                };
            }

            if !ok {
                let detail = if stderr.trim().is_empty() {
                    "grok worktree db stats failed".to_string()
                } else {
                    stderr.chars().take(240).collect()
                };
                return soft_db_stats_err(true, false, detail);
            }
            // Succeeded but empty/unparseable — still available with raw body.
            CliWorktreeDbStatsResult {
                available: true,
                stats: None,
                summary: raw.clone(),
                raw,
                reason: Some("could not parse worktree DB stats".into()),
                cli_found: true,
                unsupported: false,
                source: Some("none".into()),
            }
        }
        Err(e) => {
            let lower = e.to_ascii_lowercase();
            soft_db_stats_err(
                !lower.contains("not found"),
                false,
                e.chars().take(240).collect::<String>(),
            )
        }
    }
}

/// Rebuild CLI worktree DB from a filesystem scan (`grok worktree db rebuild`).
/// Soft-fails when the CLI is missing or too old.
#[tauri::command]
pub async fn cli_worktree_db_rebuild() -> Result<CliWorktreeDbRebuildResult, String> {
    let result = tauri::async_runtime::spawn_blocking(cli_worktree_db_rebuild_blocking)
        .await
        .map_err(|e| format!("cli worktree db rebuild worker panicked: {e}"))?;
    Ok(result)
}

fn cli_worktree_db_rebuild_blocking() -> CliWorktreeDbRebuildResult {
    let (cli_found, _) = db_cli_probe();
    if !cli_found {
        return soft_db_rebuild_err(false, false, "Grok Build CLI not found");
    }
    match run_grok_cli_args(&["worktree", "db", "rebuild"], CLI_WORKTREE_DB_TIMEOUT_SECS) {
        Ok((stdout, stderr, ok)) => {
            if looks_like_unsupported_worktree_db(&stderr, &stdout) {
                return soft_db_rebuild_err(
                    true,
                    true,
                    "CLI worktree DB requires Grok Build CLI 0.2.117+",
                );
            }
            let (discovered, registered, already) = parse_cli_worktree_db_rebuild_text(&stdout);
            let msg = {
                let body = stdout.trim();
                if body.is_empty() {
                    if !stderr.trim().is_empty() {
                        Some(stderr.chars().take(400).collect::<String>())
                    } else {
                        None
                    }
                } else {
                    Some(body.chars().take(400).collect::<String>())
                }
            };
            if ok {
                CliWorktreeDbRebuildResult {
                    ok: true,
                    available: true,
                    message: msg,
                    discovered,
                    registered,
                    already_tracked: already,
                    reason: None,
                    cli_found: true,
                    unsupported: false,
                }
            } else {
                let detail = msg
                    .clone()
                    .or_else(|| {
                        if stderr.trim().is_empty() {
                            Some("grok worktree db rebuild failed".into())
                        } else {
                            Some(stderr.chars().take(240).collect())
                        }
                    })
                    .unwrap_or_else(|| "grok worktree db rebuild failed".into());
                CliWorktreeDbRebuildResult {
                    ok: false,
                    available: true,
                    message: msg,
                    discovered,
                    registered,
                    already_tracked: already,
                    reason: Some(detail),
                    cli_found: true,
                    unsupported: false,
                }
            }
        }
        Err(e) => {
            let lower = e.to_ascii_lowercase();
            soft_db_rebuild_err(
                !lower.contains("not found"),
                false,
                e.chars().take(240).collect::<String>(),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn home() -> PathBuf {
        PathBuf::from("/Users/me")
    }

    #[test]
    fn derive_name_from_path() {
        assert_eq!(
            derive_cli_worktree_name("id-long", "/Users/me/.grok/worktrees/repo/feat-login"),
            "feat-login"
        );
        assert_eq!(derive_cli_worktree_name("only-id", ""), "only-id");
    }

    #[test]
    fn expand_tilde() {
        assert_eq!(
            expand_tilde_path("~/.grok/worktrees/r/a", &home()),
            "/Users/me/.grok/worktrees/r/a"
        );
        assert_eq!(expand_tilde_path("/abs/x", &home()), "/abs/x");
    }

    #[test]
    fn parse_json_array() {
        let raw = r#"[
          {
            "id": "subagent-abc",
            "path": "/Users/me/.grok/worktrees/oss-grok-app/subagent-abc",
            "source_repo": "/Users/me/Code/oss/grok-app",
            "repo_name": "grok-app",
            "kind": "subagent",
            "git_ref": "HEAD",
            "head_commit": "ea837bbb4f3f625e9bb01268bab97476414abb5b",
            "status": "alive"
          },
          {
            "id": "feat-x",
            "path": "~/.grok/worktrees/oss-grok-app/feat-x",
            "repo_name": "grok-app",
            "kind": "user",
            "git_ref": "feat/x",
            "status": "alive"
          }
        ]"#;
        let list = parse_cli_worktree_list_json(raw, &home()).expect("parse");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "subagent-abc");
        assert_eq!(list[0].branch.as_deref(), Some("HEAD"));
        assert_eq!(list[0].status.as_deref(), Some("alive"));
        assert_eq!(list[0].head.as_deref(), Some("ea837bbb4f3f"));
        assert_eq!(
            list[1].path,
            "/Users/me/.grok/worktrees/oss-grok-app/feat-x"
        );
        assert_eq!(list[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(list[1].name, "feat-x");
    }

    #[test]
    fn parse_json_wrapped() {
        let raw = r#"{"worktrees":[{"id":"a","path":"/tmp/a","status":"stale"}]}"#;
        let list = parse_cli_worktree_list_json(raw, &home()).expect("parse");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "a");
        assert_eq!(list[0].status.as_deref(), Some("stale"));
    }

    #[test]
    fn parse_json_empty() {
        assert!(parse_cli_worktree_list_json("", &home())
            .unwrap()
            .is_empty());
        assert!(parse_cli_worktree_list_json("[]", &home())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn parse_text_table() {
        let raw = "\
  ID                                                             TYPE     REPO   LABEL BRANCH               AGE        PATH
  subagent-019f99c5-d7db-7e50-9212-2ee9821126c0-24f7e69a9a88c6fa subagent grok-…       HEAD                 4d ago     ~/.grok/worktrees/oss-grok-app/subagent-019f99c5-d7db-7e50-9212-2ee9821126c0
  feat-login                                                     user     grok-…       feat/login           1h ago     /Users/me/.grok/worktrees/oss-grok-app/feat-login
  20 worktrees (20 subagent)
";
        let list = parse_cli_worktree_list_text(raw, &home());
        assert_eq!(list.len(), 2);
        assert_eq!(
            list[0].path,
            "/Users/me/.grok/worktrees/oss-grok-app/subagent-019f99c5-d7db-7e50-9212-2ee9821126c0"
        );
        assert_eq!(list[0].kind.as_deref(), Some("subagent"));
        assert_eq!(list[0].branch.as_deref(), Some("HEAD"));
        assert_eq!(list[1].name, "feat-login");
        assert_eq!(list[1].branch.as_deref(), Some("feat/login"));
        assert_eq!(list[1].kind.as_deref(), Some("user"));
    }

    #[test]
    fn unsupported_json_flag_detect() {
        assert!(looks_like_unsupported_json_flag(
            "error: unexpected argument '--json' found",
            ""
        ));
        assert!(!looks_like_unsupported_json_flag("ok", "[]"));
    }

    #[test]
    fn age_tokens() {
        assert!(is_age_token("4d"));
        assert!(is_age_token("ago"));
        assert!(is_age_token("12h"));
        assert!(!is_age_token("HEAD"));
        assert!(!is_age_token("feat/login"));
    }

    #[test]
    fn unsupported_worktree_db_detect() {
        assert!(looks_like_unsupported_worktree_db(
            "error: unrecognized subcommand 'db'",
            ""
        ));
        assert!(looks_like_unsupported_worktree_db(
            "error: unrecognized subcommand 'worktree'",
            ""
        ));
        assert!(!looks_like_unsupported_worktree_db(
            "",
            "Worktree DB Statistics\n  Total records: 1"
        ));
        assert!(!looks_like_unsupported_worktree_db(
            "error: something else failed",
            ""
        ));
    }

    #[test]
    fn parse_stats_text_fixture() {
        let raw = "\
Worktree DB Statistics
======================
  Total records:  20
  Alive:          20
  Dead:           0
  DB size:        48.0 KB
";
        let s = parse_cli_worktree_db_stats_text(raw);
        assert_eq!(s.total, Some(20));
        assert_eq!(s.alive, Some(20));
        assert_eq!(s.dead, Some(0));
        assert_eq!(s.db_size.as_deref(), Some("48.0 KB"));
        assert_eq!(s.db_size_bytes, Some(49152));
        let summary = format_cli_worktree_db_stats_summary(&s).expect("summary");
        assert!(summary.contains("20 total"));
        assert!(summary.contains("48.0 KB"));
    }

    #[test]
    fn parse_stats_json_object() {
        let raw = r#"{
          "total": 5,
          "alive": 4,
          "dead": 1,
          "db_size": "1.5 KB"
        }"#;
        let s = parse_cli_worktree_db_stats_json(raw).expect("parse");
        assert_eq!(s.total, Some(5));
        assert_eq!(s.alive, Some(4));
        assert_eq!(s.dead, Some(1));
        assert_eq!(s.db_size.as_deref(), Some("1.5 KB"));
        assert_eq!(s.db_size_bytes, Some(1536));
    }

    #[test]
    fn parse_stats_json_wrapped() {
        let raw = r#"{"stats":{"total_records":3,"alive":3,"dead":0,"size":"512 B"}}"#;
        let s = parse_cli_worktree_db_stats_json(raw).expect("parse");
        assert_eq!(s.total, Some(3));
        assert_eq!(s.alive, Some(3));
        assert_eq!(s.db_size.as_deref(), Some("512 B"));
        assert_eq!(s.db_size_bytes, Some(512));
    }

    #[test]
    fn parse_human_size() {
        assert_eq!(parse_human_size_bytes("48.0 KB"), Some(49152));
        assert_eq!(parse_human_size_bytes("1 MB"), Some(1024 * 1024));
        assert_eq!(parse_human_size_bytes("100"), Some(100));
        assert_eq!(parse_human_size_bytes("512 B"), Some(512));
        assert!(parse_human_size_bytes("").is_none());
    }

    #[test]
    fn parse_db_path_stdout() {
        assert_eq!(
            parse_cli_worktree_db_path_stdout("/Users/me/.grok/worktrees.db\n", &home()),
            Some("/Users/me/.grok/worktrees.db".into())
        );
        assert_eq!(
            parse_cli_worktree_db_path_stdout("~/.grok/worktrees.db", &home()),
            Some("/Users/me/.grok/worktrees.db".into())
        );
    }

    #[test]
    fn parse_rebuild_report() {
        let raw = "\
Rebuild report:
  Discovered:      20
  Registered:      0
  Already tracked: 20
";
        let (d, r, a) = parse_cli_worktree_db_rebuild_text(raw);
        assert_eq!(d, Some(20));
        assert_eq!(r, Some(0));
        assert_eq!(a, Some(20));
    }
}
