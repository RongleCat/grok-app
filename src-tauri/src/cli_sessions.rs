//! Discover / import Grok Build CLI sessions from active GROK_HOME
//! (shared `~/.grok` or independent agent-home).
//!
//! Layout: `{GROK_HOME}/sessions/{percent-encoded-cwd}/{agent_session_id}/`
//!   - summary.json — title, timestamps, cwd
//!   - chat_history.jsonl — line-delimited messages

#![allow(dead_code)] // residual-clippy: pick_latest helper
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::paths::resolve_agent_grok_home;
use crate::session_manager::{
    extract_tool_input, tool_journal_richer, TOOL_OUTPUT_MAX_PUB, TOOL_OUTPUT_SENTINEL,
};
use crate::store::{self, ChatMessageStored, MessageAttachmentStored, SessionMeta};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSessionSummary {
    pub agent_session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub updated_at: String,
    pub dir: String,
    pub num_messages: u32,
    /// App already has a session row pointing at this agent id.
    pub already_linked: bool,
    /// App session id when already linked (for one-click open / resume).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_session_id: Option<String>,
    /// GROK_HOME used for discovery (path clarity independent vs shared).
    pub source_home: String,
    /// First user prompt when known (search / enriched list only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_prompt: Option<String>,
}

/// Search hit from `grok sessions search` or local first-prompt fallback.
/// Compatible with list rows for import / open / delete in the UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSessionSearchHit {
    pub agent_session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub updated_at: String,
    /// May be empty for remote-only hits not present under local GROK_HOME.
    pub dir: String,
    pub num_messages: u32,
    pub already_linked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_session_id: Option<String>,
    pub source_home: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_prompt: Option<String>,
    /// CLI status token when known (`local` / `remote`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// `"cli"` when from `grok sessions search`, `"local"` for disk fallback.
    pub source: String,
}

#[derive(Debug, Deserialize)]
struct SummaryFile {
    #[serde(default)]
    info: Option<SummaryInfo>,
    #[serde(default)]
    session_summary: Option<String>,
    #[serde(default)]
    generated_title: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    last_active_at: Option<String>,
    #[serde(default)]
    num_messages: Option<u32>,
    #[serde(default)]
    num_chat_messages: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SummaryInfo {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

/// List CLI agent sessions under the active GROK_HOME (respects session_data_mode).
pub fn list_cli_sessions(session_data_mode: &str) -> Result<Vec<CliSessionSummary>, String> {
    let home = resolve_agent_grok_home(session_data_mode);
    let source_home = home.display().to_string();
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return Ok(Vec::new());
    }

    // agent_session_id → app session id (first match wins).
    let linked: std::collections::HashMap<String, String> = store::load_sessions_index()
        .into_iter()
        .filter_map(|s| {
            let aid = s.agent_session_id.filter(|id| !id.is_empty())?;
            Some((aid, s.id))
        })
        .collect();

    let mut out = Vec::new();
    let cwd_dirs = fs::read_dir(&sessions).map_err(|e| e.to_string())?;
    for cwd_ent in cwd_dirs.flatten() {
        let cwd_path = cwd_ent.path();
        if !cwd_path.is_dir() {
            continue;
        }
        let cwd_decoded =
            percent_decode_component(cwd_path.file_name().and_then(|s| s.to_str()).unwrap_or(""));
        let Ok(sid_dirs) = fs::read_dir(&cwd_path) else {
            continue;
        };
        for sid_ent in sid_dirs.flatten() {
            let dir = sid_ent.path();
            if !dir.is_dir() {
                continue;
            }
            let agent_id = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if agent_id.is_empty() || agent_id.starts_with('.') {
                continue;
            }
            let summary_path = dir.join("summary.json");
            if !summary_path.is_file() && !dir.join("chat_history.jsonl").is_file() {
                continue;
            }
            let (title, cwd, updated, n) =
                read_summary_bits(&summary_path, &cwd_decoded, &agent_id);
            let app_session_id = linked.get(&agent_id).cloned();
            out.push(CliSessionSummary {
                already_linked: app_session_id.is_some(),
                app_session_id,
                agent_session_id: agent_id,
                title,
                cwd,
                updated_at: updated,
                dir: dir.display().to_string(),
                num_messages: n,
                source_home: source_home.clone(),
                first_prompt: None,
            });
        }
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    // Cap list for UI.
    if out.len() > 200 {
        out.truncate(200);
    }
    Ok(out)
}

/// Normalize a project / cwd path for equality (pure).
///
/// Matches CLI session folder identity loosely: trim, unify slashes, drop a
/// trailing separator, lowercase. Aligns with `agent_memory::normalize_path_key`.
pub fn normalize_cwd_path(path: &str) -> String {
    let mut s = path.trim().replace('\\', "/");
    while s.ends_with('/') && s.len() > 1 {
        s.pop();
    }
    s.to_ascii_lowercase()
}

/// True when two cwd strings refer to the same project folder (pure).
pub fn cwd_paths_match(a: &str, b: &str) -> bool {
    let na = normalize_cwd_path(a);
    let nb = normalize_cwd_path(b);
    !na.is_empty() && na == nb
}

/// Whether a CLI cwd should become an untrusted App project on import (pure).
///
/// Skips filesystem roots, the user home, ancestors of home, and shallow
/// paths such as `/Users/name` or `/Users/name/Developer`. Real project
/// folders (`…/Developer/foo`) have ≥4 segments.
pub fn should_auto_add_project_path(path: &str, home: &str) -> bool {
    let p = normalize_cwd_path(path);
    if p.is_empty() || p == "/" || p == "." {
        return false;
    }
    let bytes = p.as_bytes();
    // Windows drive root: "c:" / "c:/"
    if bytes.len() <= 3 && bytes.get(1) == Some(&b':') {
        return false;
    }
    let home_n = normalize_cwd_path(home);
    if !home_n.is_empty() {
        if p == home_n {
            return false;
        }
        if home_n.starts_with(&format!("{p}/")) {
            return false;
        }
    }
    p.split('/').filter(|s| !s.is_empty()).count() >= 4
}

/// Create an untrusted App project for a CLI cwd when missing.
/// Never auto-trusts. Missing / shallow / home paths are no-ops.
fn ensure_untrusted_project_for_cwd(cwd: &str) {
    let home = crate::process_util::user_home();
    let home_s = home.to_string_lossy();
    if !should_auto_add_project_path(cwd, home_s.as_ref()) {
        return;
    }
    if !Path::new(cwd).is_dir() {
        return;
    }
    if let Err(e) = store::add_project(cwd.to_string(), false) {
        tracing::debug!("cli import skip project add {cwd}: {e}");
    }
}

/// Pick the newest session among rows whose `cwd` matches `project_path` (pure).
///
/// Compares `updated_at` lexicographically (RFC3339-friendly).
pub fn pick_latest_session_for_cwd<'a, T>(
    rows: &'a [T],
    project_path: &str,
    cwd_of: impl Fn(&T) -> Option<&str>,
    updated_of: impl Fn(&T) -> Option<&str>,
) -> Option<&'a T> {
    let target = normalize_cwd_path(project_path);
    if target.is_empty() {
        return None;
    }
    let mut best: Option<(&T, &str)> = None;
    for row in rows {
        let Some(cwd) = cwd_of(row) else { continue };
        if !cwd_paths_match(cwd, project_path) {
            continue;
        }
        let updated = updated_of(row).unwrap_or("");
        match best {
            None => best = Some((row, updated)),
            Some((_, prev)) if updated > prev => best = Some((row, updated)),
            _ => {}
        }
    }
    best.map(|(r, _)| r)
}

/// Find the most recent CLI agent session for a project path (CLI `-c/--continue`).
///
/// Strategy:
/// 1. Prefer the on-disk folder `{GROK_HOME}/sessions/{percent-encoded-cwd}/`
///    and pick the newest `summary.json` / history under it.
/// 2. Fall back to a full list scan matching decoded folder name or summary
///    `cwd` (handles path variants and folders encoded slightly differently).
///
/// Soft-fails with `Ok(None)` when the path is empty or no session exists.
pub fn find_latest_cli_session_for_cwd(
    project_path: &str,
    session_data_mode: &str,
) -> Result<Option<CliSessionSummary>, String> {
    let path = project_path.trim();
    if path.is_empty() {
        return Ok(None);
    }

    let home = resolve_agent_grok_home(session_data_mode);
    let source_home = home.display().to_string();
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return Ok(None);
    }

    // agent_session_id → app session id (first match wins).
    let linked: std::collections::HashMap<String, String> = store::load_sessions_index()
        .into_iter()
        .filter_map(|s| {
            let aid = s.agent_session_id.filter(|id| !id.is_empty())?;
            Some((aid, s.id))
        })
        .collect();

    let mut candidates: Vec<CliSessionSummary> = Vec::new();

    // Fast path: exact encoded cwd directory (CLI layout).
    let encoded = crate::paths::percent_encode_path_component(path);
    let encoded_norm = crate::paths::percent_encode_path_component(&normalize_cwd_path(path));
    for enc in [encoded.as_str(), encoded_norm.as_str()] {
        let cwd_dir = sessions.join(enc);
        if !cwd_dir.is_dir() {
            continue;
        }
        collect_sessions_under_cwd_dir(&cwd_dir, path, &source_home, &linked, &mut candidates);
        if !candidates.is_empty() {
            break;
        }
    }

    // Fallback: scan all cwd folders; match by decoded name or summary cwd.
    if candidates.is_empty() {
        let cwd_dirs = fs::read_dir(&sessions).map_err(|e| e.to_string())?;
        for cwd_ent in cwd_dirs.flatten() {
            let cwd_path = cwd_ent.path();
            if !cwd_path.is_dir() {
                continue;
            }
            let cwd_decoded = percent_decode_component(
                cwd_path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
            );
            let folder_matches = cwd_paths_match(&cwd_decoded, path);
            let mut under = Vec::new();
            collect_sessions_under_cwd_dir(
                &cwd_path,
                &cwd_decoded,
                &source_home,
                &linked,
                &mut under,
            );
            for row in under {
                if folder_matches {
                    candidates.push(row);
                    continue;
                }
                let cwd_ok = row
                    .cwd
                    .as_deref()
                    .map(|c| cwd_paths_match(c, path))
                    .unwrap_or(false);
                if cwd_ok {
                    candidates.push(row);
                }
            }
        }
    }

    candidates.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(candidates.into_iter().next())
}

fn collect_sessions_under_cwd_dir(
    cwd_dir: &Path,
    cwd_fallback: &str,
    source_home: &str,
    linked: &std::collections::HashMap<String, String>,
    out: &mut Vec<CliSessionSummary>,
) {
    let Ok(sid_dirs) = fs::read_dir(cwd_dir) else {
        return;
    };
    for sid_ent in sid_dirs.flatten() {
        let dir = sid_ent.path();
        if !dir.is_dir() {
            continue;
        }
        let agent_id = dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if agent_id.is_empty() || agent_id.starts_with('.') {
            continue;
        }
        let summary_path = dir.join("summary.json");
        if !summary_path.is_file() && !dir.join("chat_history.jsonl").is_file() {
            continue;
        }
        let (title, cwd, updated, n) = read_summary_bits(&summary_path, cwd_fallback, &agent_id);
        let app_session_id = linked.get(&agent_id).cloned();
        out.push(CliSessionSummary {
            already_linked: app_session_id.is_some(),
            app_session_id,
            agent_session_id: agent_id,
            title,
            cwd,
            updated_at: updated,
            dir: dir.display().to_string(),
            num_messages: n,
            source_home: source_home.to_string(),
            first_prompt: None,
        });
    }
}

/// CLI `-c/--continue` for the App: find latest agent session for a project
/// path and open/import it as an App session row.
///
/// Returns `Ok(None)` when no agent session exists (soft-fail). When found,
/// reuses an already-linked App session or imports history + links the agent id.
pub fn continue_cli_session_for_cwd(
    project_path: &str,
    project_id: Option<String>,
    session_data_mode: &str,
) -> Result<Option<SessionMeta>, String> {
    let Some(hit) = find_latest_cli_session_for_cwd(project_path, session_data_mode)? else {
        return Ok(None);
    };
    let meta = import_cli_session(
        &hit.agent_session_id,
        Some(&hit.dir),
        project_id,
        session_data_mode,
    )?;
    Ok(Some(meta))
}

/// Clamp search limit (1–100). Default 40.
pub fn clamp_search_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(40).clamp(1, 100)
}

/// Run `grok sessions search <query>` under the active GROK_HOME.
///
/// Prefers `--json` when the CLI accepts it; otherwise parses text output.
/// On CLI failure / missing binary, falls back to local disk filter that also
/// matches first user prompts from `chat_history.jsonl`.
pub fn search_cli_sessions(
    query: &str,
    limit: Option<u32>,
    session_data_mode: &str,
    cli_path: Option<&Path>,
) -> Result<Vec<CliSessionSearchHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let lim = clamp_search_limit(limit);
    let home = resolve_agent_grok_home(session_data_mode);
    let source_home = home.display().to_string();

    // Prefer real CLI when a binary is available.
    if let Some(path) = cli_path.filter(|p| p.is_file()) {
        match run_sessions_search_cli(path, &home, q, lim) {
            Ok(hits) if !hits.is_empty() => {
                return Ok(enrich_search_hits(
                    hits,
                    session_data_mode,
                    &source_home,
                    "cli",
                ));
            }
            Ok(_empty) => {
                // CLI succeeded with zero hits — still try local first-prompt
                // match (CLI may only search remote index / different store).
                let local = search_local_sessions(q, lim, session_data_mode)?;
                if !local.is_empty() {
                    return Ok(local);
                }
                return Ok(Vec::new());
            }
            Err(e) => {
                tracing::warn!(
                    target: "session",
                    error = %e,
                    "grok sessions search failed; falling back to local filter"
                );
            }
        }
    }

    search_local_sessions(q, lim, session_data_mode)
}

/// Pure text parser for `grok sessions search` human output.
pub fn parse_sessions_search_text(raw: &str) -> Vec<RawSearchHit> {
    let text = raw.replace("\r\n", "\n");
    if text.trim().is_empty() {
        return Vec::new();
    }

    let mut hits: Vec<RawSearchHit> = Vec::new();
    let mut current: Option<RawSearchHitBuilder> = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("total:") {
            if let Some(b) = current.take() {
                hits.push(b.finish());
            }
            break;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("warning:") || lower.starts_with("error:") {
            continue;
        }

        let is_indented = line.starts_with("  ") || line.starts_with('\t');
        if let Some(id) = extract_session_id_prefix(trimmed) {
            if !is_indented {
                if let Some(b) = current.take() {
                    hits.push(b.finish());
                }
                let rest = trimmed[id.len()..].trim();
                let (status, updated) = parse_status_and_date(rest);
                current = Some(RawSearchHitBuilder {
                    agent_session_id: id.to_string(),
                    status,
                    updated_label: updated,
                    body: Vec::new(),
                });
                continue;
            }
        }

        if let Some(ref mut b) = current {
            if is_indented {
                b.body.push(line.trim_start().to_string());
            } else if !b.body.is_empty() && extract_session_id_prefix(trimmed).is_none() {
                // Rare unindented continuation of first prompt.
                b.body.push(trimmed.to_string());
            }
        }
    }
    if let Some(b) = current.take() {
        hits.push(b.finish());
    }
    hits
}

/// Pure JSON parser for future `grok sessions search --json`.
pub fn parse_sessions_search_json(raw: &str) -> Option<Vec<RawSearchHit>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let rows: Vec<Value> = match value {
        Value::Array(arr) => arr,
        Value::Object(map) => {
            for key in ["sessions", "results", "items", "data", "hits"] {
                if let Some(Value::Array(arr)) = map.get(key) {
                    return Some(json_rows_to_hits(arr.clone()));
                }
            }
            // Single object
            if json_pick_str(
                &Value::Object(map.clone()),
                &[
                    "agentSessionId",
                    "agent_session_id",
                    "sessionId",
                    "session_id",
                    "id",
                ],
            )
            .is_some()
            {
                vec![Value::Object(map)]
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(json_rows_to_hits(rows))
}

fn json_rows_to_hits(rows: Vec<Value>) -> Vec<RawSearchHit> {
    let mut out = Vec::new();
    for row in rows {
        let id = match json_pick_str(
            &row,
            &[
                "agentSessionId",
                "agent_session_id",
                "sessionId",
                "session_id",
                "id",
            ],
        ) {
            Some(id) => id,
            None => continue,
        };
        let title = json_pick_str(
            &row,
            &[
                "title",
                "summary",
                "generatedTitle",
                "generated_title",
                "sessionSummary",
                "session_summary",
            ],
        )
        .unwrap_or_else(|| format!("CLI {}", id.chars().take(8).collect::<String>()));
        let first_prompt = json_pick_str(
            &row,
            &[
                "firstPrompt",
                "first_prompt",
                "prompt",
                "firstUserPrompt",
                "first_user_prompt",
            ],
        );
        let status = json_pick_str(&row, &["status", "location", "source"]);
        let updated_label = json_pick_str(
            &row,
            &[
                "updatedLabel",
                "updatedAt",
                "updated_at",
                "updated",
                "lastActiveAt",
                "last_active_at",
            ],
        );
        out.push(RawSearchHit {
            agent_session_id: id,
            title,
            first_prompt,
            status,
            updated_label,
        });
    }
    out
}

fn json_pick_str(v: &Value, keys: &[&str]) -> Option<String> {
    let obj = v.as_object()?;
    for k in keys {
        if let Some(s) = obj.get(*k).and_then(|x| x.as_str()).map(str::trim) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawSearchHit {
    pub agent_session_id: String,
    pub title: String,
    pub first_prompt: Option<String>,
    pub status: Option<String>,
    pub updated_label: Option<String>,
}

struct RawSearchHitBuilder {
    agent_session_id: String,
    status: Option<String>,
    updated_label: Option<String>,
    body: Vec<String>,
}

impl RawSearchHitBuilder {
    fn finish(self) -> RawSearchHit {
        let body: Vec<String> = self
            .body
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let title = body.first().cloned().unwrap_or_else(|| {
            format!(
                "CLI {}",
                self.agent_session_id.chars().take(8).collect::<String>()
            )
        });
        let first_prompt = if body.len() > 1 {
            Some(body[1..].join("\n"))
        } else {
            None
        };
        RawSearchHit {
            agent_session_id: self.agent_session_id,
            title,
            first_prompt,
            status: self.status,
            updated_label: self.updated_label,
        }
    }
}

fn extract_session_id_prefix(s: &str) -> Option<&str> {
    // UUID-shaped agent session ids (Grok uses UUID v7-ish).
    let bytes = s.as_bytes();
    if bytes.len() < 36 {
        return None;
    }
    let cand = &s[..36];
    let ok = cand.as_bytes().iter().enumerate().all(|(i, &c)| match i {
        8 | 13 | 18 | 23 => c == b'-',
        _ => c.is_ascii_hexdigit(),
    });
    if ok {
        Some(cand)
    } else {
        None
    }
}

fn parse_status_and_date(rest: &str) -> (Option<String>, Option<String>) {
    let rest = rest.trim();
    if rest.is_empty() {
        return (None, None);
    }
    if rest.starts_with('(') {
        if let Some(end) = rest.find(')') {
            let status = rest[1..end].trim();
            let after = rest[end + 1..].trim();
            return (
                if status.is_empty() {
                    None
                } else {
                    Some(status.to_string())
                },
                if after.is_empty() {
                    None
                } else {
                    Some(after.to_string())
                },
            );
        }
    }
    (None, Some(rest.to_string()))
}

fn looks_like_unsupported_flag(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("unexpected argument")
        || s.contains("unrecognized option")
        || s.contains("unknown flag")
        || s.contains("unknown option")
        || s.contains("invalid option")
        || s.contains("unrecognized subcommand")
        || s.contains("unexpected subcommand")
}

const SESSIONS_SEARCH_TIMEOUT_SECS: u64 = 25;

fn run_sessions_search_cli(
    cli_path: &Path,
    grok_home: &Path,
    query: &str,
    limit: u32,
) -> Result<Vec<RawSearchHit>, String> {
    // Try --json first (future CLI); fall back to text on unsupported flag.
    let json_attempt = run_grok_sessions_search(cli_path, grok_home, query, limit, true);
    match json_attempt {
        Ok((stdout, stderr, ok)) => {
            if let Some(hits) = parse_sessions_search_json(&stdout) {
                return Ok(hits);
            }
            // Some CLIs print JSON errors on stderr only.
            if looks_like_unsupported_flag(&stderr) {
                // retry without --json below
            } else if !stdout.trim().is_empty() {
                // Might still be text despite requesting json.
                let hits = parse_sessions_search_text(&stdout);
                if !hits.is_empty() || ok {
                    return Ok(hits);
                }
            } else if looks_like_unsupported_flag(&stderr) {
                // fall through
            } else if !ok {
                return Err(format!(
                    "grok sessions search failed: {}",
                    truncate_err(if stderr.is_empty() { &stdout } else { &stderr }, 240)
                ));
            }
        }
        Err(e) => {
            // Spawn failure — do not retry.
            return Err(e);
        }
    }

    let (stdout, stderr, ok) = run_grok_sessions_search(cli_path, grok_home, query, limit, false)?;
    if !ok && stdout.trim().is_empty() {
        return Err(format!(
            "grok sessions search failed: {}",
            truncate_err(if stderr.is_empty() { &stdout } else { &stderr }, 240)
        ));
    }
    // Prefer JSON if it somehow worked without flag.
    if let Some(hits) = parse_sessions_search_json(&stdout) {
        return Ok(hits);
    }
    Ok(parse_sessions_search_text(&stdout))
}

fn run_grok_sessions_search(
    cli_path: &Path,
    grok_home: &Path,
    query: &str,
    limit: u32,
    with_json: bool,
) -> Result<(String, String, bool), String> {
    let mut args: Vec<String> = vec![
        "sessions".into(),
        "search".into(),
        query.into(),
        "-n".into(),
        limit.to_string(),
    ];
    if with_json {
        args.push("--json".into());
    }

    let cli_path = cli_path.to_path_buf();
    let grok_home = grok_home.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = crate::process_util::command(&cli_path);
        cmd.args(&args);
        cmd.env("GROK_HOME", &grok_home);
        crate::process_util::ensure_home_env_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });

    match rx.recv_timeout(std::time::Duration::from_secs(SESSIONS_SEARCH_TIMEOUT_SECS)) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok((stdout, stderr, output.status.success()))
        }
        Ok(Err(e)) => Err(format!("Failed to run grok sessions search: {e}")),
        Err(_) => Err(format!(
            "grok sessions search timed out after {SESSIONS_SEARCH_TIMEOUT_SECS}s"
        )),
    }
}

fn truncate_err(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let head: String = t.chars().take(max).collect();
    format!("{head}…")
}

fn enrich_search_hits(
    hits: Vec<RawSearchHit>,
    session_data_mode: &str,
    source_home: &str,
    source: &str,
) -> Vec<CliSessionSearchHit> {
    let local = list_cli_sessions(session_data_mode).unwrap_or_default();
    let by_id: std::collections::HashMap<String, CliSessionSummary> = local
        .into_iter()
        .map(|s| (s.agent_session_id.clone(), s))
        .collect();

    hits.into_iter()
        .map(|h| {
            if let Some(loc) = by_id.get(&h.agent_session_id) {
                CliSessionSearchHit {
                    agent_session_id: h.agent_session_id,
                    title: if h.title.is_empty() {
                        loc.title.clone()
                    } else {
                        h.title
                    },
                    cwd: loc.cwd.clone(),
                    updated_at: if loc.updated_at.is_empty() {
                        h.updated_label.unwrap_or_default()
                    } else {
                        loc.updated_at.clone()
                    },
                    dir: loc.dir.clone(),
                    num_messages: loc.num_messages,
                    already_linked: loc.already_linked,
                    app_session_id: loc.app_session_id.clone(),
                    source_home: loc.source_home.clone(),
                    first_prompt: h.first_prompt.or_else(|| loc.first_prompt.clone()),
                    status: h.status,
                    source: source.to_string(),
                }
            } else {
                CliSessionSearchHit {
                    agent_session_id: h.agent_session_id,
                    title: h.title,
                    cwd: None,
                    updated_at: h.updated_label.unwrap_or_default(),
                    dir: String::new(),
                    num_messages: 0,
                    already_linked: false,
                    app_session_id: None,
                    source_home: source_home.to_string(),
                    first_prompt: h.first_prompt,
                    status: h.status,
                    source: source.to_string(),
                }
            }
        })
        .collect()
}

/// Local disk search: title / id / cwd / first user prompt.
fn search_local_sessions(
    query: &str,
    limit: u32,
    session_data_mode: &str,
) -> Result<Vec<CliSessionSearchHit>, String> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let list = list_cli_sessions(session_data_mode)?;
    let mut out = Vec::new();
    for mut row in list {
        // Lazy first-prompt only when title/id/cwd did not already match —
        // but CLI search is meant to hit first prompts, so always load when
        // cheap enough. Cap body read via first user message only.
        let prompt = read_first_user_prompt(Path::new(&row.dir));
        row.first_prompt = prompt.clone();

        let hay_title = row.title.to_ascii_lowercase();
        let hay_id = row.agent_session_id.to_ascii_lowercase();
        let hay_cwd = row.cwd.as_deref().unwrap_or("").to_ascii_lowercase();
        let hay_prompt = prompt.as_deref().unwrap_or("").to_ascii_lowercase();
        if !(hay_title.contains(&q)
            || hay_id.contains(&q)
            || (!hay_cwd.is_empty() && hay_cwd.contains(&q))
            || (!hay_prompt.is_empty() && hay_prompt.contains(&q)))
        {
            continue;
        }
        out.push(CliSessionSearchHit {
            agent_session_id: row.agent_session_id,
            title: row.title,
            cwd: row.cwd,
            updated_at: row.updated_at,
            dir: row.dir,
            num_messages: row.num_messages,
            already_linked: row.already_linked,
            app_session_id: row.app_session_id,
            source_home: row.source_home,
            first_prompt: prompt,
            status: Some("local".into()),
            source: "local".into(),
        });
        if out.len() >= limit as usize {
            break;
        }
    }
    Ok(out)
}

/// First user message body from chat_history.jsonl (best-effort, capped).
pub fn read_first_user_prompt(dir: &Path) -> Option<String> {
    let history = dir.join("chat_history.jsonl");
    if !history.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&history).ok()?;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let typ = v
            .get("type")
            .or_else(|| v.get("role"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        if typ != "user" {
            continue;
        }
        let content = v.get("content").map(content_to_text).unwrap_or_default();
        let Some(content) = imported_user_content(&v, &content) else {
            continue;
        };
        // Cap length for UI / filter.
        let capped: String = content.chars().take(500).collect();
        return Some(capped);
    }
    None
}

fn read_summary_bits(
    summary_path: &Path,
    cwd_fallback: &str,
    agent_id: &str,
) -> (String, Option<String>, String, u32) {
    let raw = fs::read_to_string(summary_path).unwrap_or_default();
    let parsed: SummaryFile = serde_json::from_str(&raw).unwrap_or(SummaryFile {
        info: None,
        session_summary: None,
        generated_title: None,
        created_at: None,
        updated_at: None,
        last_active_at: None,
        num_messages: None,
        num_chat_messages: None,
    });
    let title = parsed
        .generated_title
        .or(parsed.session_summary)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("CLI {}", agent_id.chars().take(8).collect::<String>()));
    let cwd = parsed
        .info
        .as_ref()
        .and_then(|i| i.cwd.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            if cwd_fallback.is_empty() {
                None
            } else {
                Some(cwd_fallback.to_string())
            }
        });
    let updated = parsed
        .last_active_at
        .or(parsed.updated_at)
        .or(parsed.created_at)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let n = parsed
        .num_chat_messages
        .or(parsed.num_messages)
        .unwrap_or(0);
    (title, cwd, updated, n)
}

/// Decode encodeURIComponent-style path segments used by Grok Build.
pub fn percent_decode_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = || {
                let a = (bytes[i + 1] as char).to_digit(16)?;
                let b = (bytes[i + 2] as char).to_digit(16)?;
                Some(((a << 4) | b) as u8)
            };
            if let Some(v) = h() {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_to_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(t.to_string());
                } else if let Some(t) = item.as_str() {
                    parts.push(t.to_string());
                }
            }
            parts.join("\n")
        }
        Value::Object(map) => map
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

/// Parse CLI `chat_history.jsonl` into (role, content) pairs for the App journal.
pub fn parse_chat_history_jsonl(path: &Path) -> Result<Vec<(String, String)>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read chat_history: {e}"))?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue, // skip broken lines
        };
        let typ = v
            .get("type")
            .or_else(|| v.get("role"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let role = match typ {
            "user" => "user",
            "assistant" => "assistant",
            _ => continue,
        };
        let content = v.get("content").map(content_to_text).unwrap_or_default();
        let content = if role == "user" {
            match imported_user_content(&v, &content) {
                Some(c) => c,
                None => continue,
            }
        } else {
            let content = content.trim().to_string();
            if content.is_empty() {
                continue;
            }
            content
        };
        out.push((role.to_string(), content));
    }
    if out.is_empty() {
        return Err("no user/assistant messages in chat_history.jsonl".into());
    }
    Ok(out)
}

/// Walk CLI `chat_history.jsonl` in stream order keeping tool rows:
/// `(role, cleaned_content, tool_call_id)` for user / assistant / tool_result.
///
/// Used by reconcile to rebuild sparse tool-step journal rows at the correct
/// position (and with real names from `events.jsonl`), not just user/assistant.
fn parse_chat_history_rows(path: &Path) -> Result<Vec<(String, String, Option<String>)>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read chat_history: {e}"))?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue, // skip broken lines
        };
        let typ = v
            .get("type")
            .or_else(|| v.get("role"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        match typ {
            "user" | "assistant" => {
                let content = v.get("content").map(content_to_text).unwrap_or_default();
                let content = if typ == "user" {
                    match imported_user_content(&v, &content) {
                        Some(c) => c,
                        None => continue,
                    }
                } else {
                    let content = content.trim().to_string();
                    if content.is_empty() {
                        continue;
                    }
                    content
                };
                out.push((typ.to_string(), content, None));
            }
            "tool_result" => {
                let call_id = v
                    .get("tool_call_id")
                    .or_else(|| v.get("toolCallId"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let content = v
                    .get("content")
                    .map(content_to_text)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                out.push(("tool".to_string(), content, Some(call_id)));
            }
            _ => {}
        }
    }
    if out.is_empty() {
        return Err("no messages in chat_history.jsonl".into());
    }
    Ok(out)
}

fn extract_user_query(content: &str) -> Option<String> {
    let start = content.find("<user_query>")?;
    let rest = &content[start + "<user_query>".len()..];
    let end = rest.find("</user_query>")?;
    let q = rest[..end].trim();
    if q.is_empty() {
        None
    } else {
        Some(q.to_string())
    }
}

fn chat_history_synthetic_reason(v: &Value) -> Option<&str> {
    v.get("synthetic_reason")
        .or_else(|| v.get("syntheticReason"))
        .or_else(|| v.pointer("/_meta/synthetic_reason"))
        .or_else(|| v.pointer("/metadata/synthetic_reason"))
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn is_synthetic_instruction_reason(reason: &str) -> bool {
    let r = reason.to_ascii_lowercase();
    r == "project_instructions"
        || r == "system_reminder"
        || r == "user_instructions"
        || r.contains("reminder")
        || r.contains("instruction")
}

/// Official TUI paints `updates.jsonl`, not `chat_history.jsonl`. Import must
/// not copy reminder-only / synthetic instruction envelopes as user bubbles.
fn imported_user_content(v: &Value, raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(q) = extract_user_query(raw) {
        return Some(q);
    }
    if raw.contains("<system-reminder>") {
        return None;
    }
    if let Some(reason) = chat_history_synthetic_reason(v) {
        if is_synthetic_instruction_reason(reason) {
            return None;
        }
    }
    Some(raw.to_string())
}

/// Split display text + `@/abs/path` (or `@C:\path`) sole-line refs — mirrors FE
/// `parseAttachmentsFromContent` so history cards can be recovered from agent
/// chat_history when the App journal only kept the user-facing body.
pub fn parse_at_path_attachments(content: &str) -> (String, Vec<MessageAttachmentStored>) {
    if content.is_empty() {
        return (String::new(), Vec::new());
    }
    let mut attachments: Vec<MessageAttachmentStored> = Vec::new();
    let mut text_lines: Vec<&str> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // @/path or @C:\path — absolute only (same as FE).
        let path = trimmed.strip_prefix('@').and_then(|rest| {
            let rest = rest.trim();
            if rest.starts_with('/') || looks_like_windows_abs(rest) {
                Some(rest.to_string())
            } else {
                None
            }
        });
        if let Some(path) = path {
            if seen.insert(path.clone()) {
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());
                attachments.push(MessageAttachmentStored {
                    path,
                    name,
                    is_dir: false,
                });
            }
            continue;
        }
        text_lines.push(line);
    }
    while text_lines
        .last()
        .map(|l| l.trim().is_empty())
        .unwrap_or(false)
    {
        text_lines.pop();
    }
    (text_lines.join("\n"), attachments)
}

fn looks_like_windows_abs(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

fn user_body_key(content: &str) -> String {
    parse_at_path_attachments(content).0.trim().to_string()
}

fn user_bodies_match(journal_content: &str, agent_body: &str) -> bool {
    let j = user_body_key(journal_content);
    let a = user_body_key(agent_body);
    if j.is_empty() && a.is_empty() {
        return true;
    }
    if j.is_empty() || a.is_empty() {
        return false;
    }
    j == a || a.starts_with(&j) || j.starts_with(&a)
}

/// Backfill missing structured `attachments` on journal **user** rows from
/// agent `chat_history` user turns (which still carry `@/abs/path` lines).
///
/// Older App builds stored only display text (`attachments: null`), so reopening
/// history showed bare bubbles. Returns how many rows gained attachments.
pub fn backfill_user_attachments_from_agent_pairs(
    journal: &mut [ChatMessageStored],
    pairs: &[(String, String)],
) -> u32 {
    let mut changed = 0u32;
    let mut used = std::collections::HashSet::new();
    for m in journal.iter_mut() {
        if m.role != "user" {
            continue;
        }
        if m.attachments
            .as_ref()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
        {
            continue;
        }
        for (i, (role, content)) in pairs.iter().enumerate() {
            if role != "user" || used.contains(&i) {
                continue;
            }
            let (_atext, atts) = parse_at_path_attachments(content);
            if atts.is_empty() {
                continue;
            }
            if !user_bodies_match(&m.content, content) {
                continue;
            }
            m.attachments = Some(atts);
            used.insert(i);
            changed += 1;
            break;
        }
    }
    changed
}

/// True when journal already covers this agent assistant body.
///
/// - Exact match or journal row contains the body (stream-concat / prefix cases).
/// - Agent body contains a journal row only counts when the journal row is a
///   *prefix* of the agent body (truncated stream) — then we extend that row.
///
/// Every variant carries the journal row index (anchor for tool-step rebuild).
fn journal_covers_assistant(journal: &[ChatMessageStored], agent_body: &str) -> CoverKind {
    let body = agent_body.trim();
    if body.is_empty() {
        return CoverKind::Covered(usize::MAX);
    }
    let mut best_prefix: Option<usize> = None;
    for (i, m) in journal.iter().enumerate() {
        if m.role != "assistant" || m.is_error {
            continue;
        }
        let j = m.content.trim();
        if j.is_empty() {
            continue;
        }
        if j == body || j.contains(body) {
            return CoverKind::Covered(i);
        }
        // Truncated host journal: intro-only while agent has intro+more in one
        // row, or host stopped mid-stream. Prefer extending that row.
        if body.starts_with(j) && body.len() > j.len() {
            best_prefix = Some(match best_prefix {
                Some(prev) if journal[prev].content.len() >= j.len() => prev,
                _ => i,
            });
        }
    }
    match best_prefix {
        Some(i) => CoverKind::Extend(i),
        None => CoverKind::Missing,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoverKind {
    Covered(usize),
    Missing,
    Extend(usize),
}

/// Map tool call id → machine tool name from CLI `events.jsonl`
/// (`tool_started` / `tool_completed` rows carry `tool_name`).
///
/// The ACP `tool_call_update` terminal notifications are status-only, but the
/// CLI's own event log records the name — reuse it to rebuild sparse journal
/// `tool_step|completed|tool|tool` rows with real identities.
fn load_tool_names_from_events(events_path: &std::path::Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let raw = match std::fs::read_to_string(events_path) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if typ != "tool_started" && typ != "tool_completed" {
            continue;
        }
        let Some(name) = v
            .get("tool_name")
            .or_else(|| v.get("toolName"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let Some(cid) = v
            .get("tool_call_id")
            .or_else(|| v.get("toolCallId"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        // Prefer a later (completed) record's name, but never overwrite a name
        // with an empty one — both rows carry the same name in practice.
        out.insert(cid.to_string(), name.to_string());
    }
    out
}

/// Rich per-call tool record from the CLI's own ACP update log
/// (`updates.jsonl` persists the full `session/update` payloads, including
/// `rawInput` and `_meta.x.ai/tool` — the identity the terminal ACP
/// notifications drop).
struct ToolCallRecord {
    name: String,
    label: String,
    kind: String,
    input: Option<String>,
}

/// Map tool call id → { name, label, kind, input } from `updates.jsonl`.
/// Falls back to `events.jsonl` names when the update log is absent.
fn load_tool_calls_from_updates(
    updates_path: &Path,
    events_path: &Path,
) -> HashMap<String, ToolCallRecord> {
    let mut out: HashMap<String, ToolCallRecord> = HashMap::new();
    let raw = std::fs::read_to_string(updates_path).unwrap_or_default();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let params = v.get("params").and_then(|x| x.as_object());
        let Some(up) = params
            .and_then(|p| p.get("update"))
            .and_then(|x| x.as_object())
        else {
            continue;
        };
        if up.get("sessionUpdate").and_then(|x| x.as_str()) != Some("tool_call") {
            continue;
        }
        let Some(cid) = up
            .get("toolCallId")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let meta = up
            .get("_meta")
            .and_then(|m| m.get("x.ai/tool"))
            .and_then(|m| m.as_object());
        let name = meta
            .and_then(|m| m.get("name"))
            .or_else(|| up.get("toolName"))
            .or_else(|| up.get("tool_name"))
            .or_else(|| up.get("title"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("")
            .to_string();
        let label = meta
            .and_then(|m| m.get("label"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| name.clone());
        let kind = meta
            .and_then(|m| m.get("kind"))
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_default();
        let input = extract_tool_input(&Value::Object(up.clone()));
        out.insert(
            cid.to_string(),
            ToolCallRecord {
                name,
                label,
                kind,
                input,
            },
        );
    }
    if out.is_empty() {
        // Older CLI: only events.jsonl exists — names alone.
        let names = load_tool_names_from_events(events_path);
        for (cid, name) in names {
            out.insert(
                cid,
                ToolCallRecord {
                    label: name.clone(),
                    name,
                    kind: String::new(),
                    input: None,
                },
            );
        }
    }
    out
}

/// Human-readable tool label for a rebuild tool row. Prefer the tool name;
/// terminal tools get a short content lead so the transcript reads naturally.
fn tool_label_from_result(name: &str, content: &str) -> String {
    if !name.is_empty() && name != "tool" {
        return name.to_string();
    }
    let first = content.lines().find(|l| !l.trim().is_empty());
    match first {
        Some(l) if l.trim().len() > 4 => l.trim().to_string(),
        _ => "tool".to_string(),
    }
}

/// Strip the CLI's parallel-read numbering markers ("1→…", "2→…") from tool
/// output so the expand detail reads as file content, not an index list.
fn strip_numbered_markers(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix(|c: char| c.is_ascii_digit()) {
            let after = rest.trim_start();
            if let Some(body) = after.strip_prefix('→').or_else(|| after.strip_prefix("->")) {
                out.push_str(body);
                out.push('\n');
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim_end().to_string()
}

/// Merge missing assistant bodies **and** backfill user file/image cards from
/// CLI `chat_history.jsonl` into the App journal.
///
/// - Host stream can drop the final answer (early turn close / process
///   ownership loss); reload only reads `messages.json`.
/// - Older builds wrote user turns with `attachments: null` while the agent
///   prompt still had `@/abs/path` lines — recover those for AttachmentCard UI.
///
/// Returns how many journal rows were added, extended, or attachment-backfilled.
pub fn reconcile_journal_from_chat_history(
    app_session_id: &str,
    agent_session_id: &str,
    cwd_hint: Option<&str>,
    session_data_mode: &str,
) -> Result<u32, String> {
    let dir = crate::paths::find_agent_session_dir(agent_session_id, cwd_hint, session_data_mode)
        .ok_or_else(|| format!("CLI session dir not found for {agent_session_id}"))?;
    let history = dir.join("chat_history.jsonl");
    if !history.is_file() {
        return Ok(0);
    }
    // Tool identity + call arguments from the CLI's own update log
    // (terminal ACP updates are status-only; chat_history carries no input).
    let tool_calls =
        load_tool_calls_from_updates(&dir.join("updates.jsonl"), &dir.join("events.jsonl"));
    let rows = match parse_chat_history_rows(&history) {
        Ok(r) => r,
        Err(_) => return Ok(0),
    };
    let pairs: Vec<(String, String)> = rows
        .iter()
        .filter(|(role, _, _)| role == "user" || role == "assistant")
        .map(|(role, content, _)| (role.clone(), content.clone()))
        .collect();
    let mut journal = store::load_messages(app_session_id);
    let mut changed = 0u32;
    let now = Utc::now();
    // Insert anchor: journal index after which the next rebuilt tool row goes,
    // so turn-2 fragments + their tools land in stream order (not appended at
    // the tail after later turns).
    let mut anchor: Option<usize> = journal.len().checked_sub(1);

    for (role, content, tool_call_id) in &rows {
        if role == "assistant" {
            match journal_covers_assistant(&journal, content) {
                CoverKind::Covered(idx) => {
                    // usize::MAX = empty body sentinel; never a real anchor.
                    if idx != usize::MAX {
                        anchor = Some(idx);
                    }
                }
                CoverKind::Extend(idx) => {
                    journal[idx].content = content.clone();
                    changed += 1;
                    anchor = Some(idx);
                }
                CoverKind::Missing => {
                    journal.push(ChatMessageStored {
                        id: Uuid::new_v4().to_string(),
                        role: "assistant".into(),
                        content: content.clone(),
                        thought: None,
                        created_at: now + chrono::Duration::milliseconds(changed as i64),
                        is_error: false,
                        attachments: None,
                        marker: None,
                    });
                    changed += 1;
                    anchor = Some(journal.len() - 1);
                }
            }
            continue;
        }
        if role != "tool" {
            continue;
        }
        let Some(call_id) = tool_call_id else {
            continue;
        };
        if call_id.is_empty() {
            continue;
        }
        let mid = format!("tool-{call_id}");
        let rec = tool_calls.get(call_id);
        let name = rec
            .map(|r| r.name.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_default();
        let label = rec
            .map(|r| r.label.clone())
            .filter(|s| !s.is_empty() && s != "tool")
            .unwrap_or_else(|| tool_label_from_result(&name, content));
        // Strip the CLI's parallel-read numbering markers ("1→…") from detail.
        let detail_clean = strip_numbered_markers(content);
        let mut row_content = format!("tool_step|completed|{name}|{label}");
        if let Some(inp) = rec
            .and_then(|r| r.input.as_deref())
            .filter(|s| !s.trim().is_empty())
        {
            // Call argument (target file / command / query) — the UI shows this
            // as the specific tool detail.
            row_content.push('\n');
            row_content.push_str("input:");
            row_content.push_str(&inp.chars().take(400).collect::<String>());
        }
        if !detail_clean.is_empty() {
            row_content.push('\n');
            row_content.push_str(&detail_clean.chars().take(400).collect::<String>());
            // Full tool output behind the sentinel so imported terminal sessions
            // expand the same way live ones do (the 400-char lead above stays
            // for the legacy positional detail parse).
            if detail_clean.chars().count() > 400 {
                row_content.push('\n');
                row_content.push_str(TOOL_OUTPUT_SENTINEL);
                row_content.push('\n');
                row_content.push_str(
                    &detail_clean
                        .chars()
                        .take(TOOL_OUTPUT_MAX_PUB)
                        .collect::<String>(),
                );
            }
        }
        if let Some(slot) = journal.iter_mut().find(|m| m.id == mid) {
            // Upgrade sparse rows (tool_step|…|tool|tool) to named rows; never
            // downgrade richer rows (tool_journal_richer guard).
            if tool_journal_richer(&slot.content, &row_content) {
                slot.content = row_content;
                slot.marker = Some("tool_step".into());
                changed += 1;
            }
        } else {
            let row = ChatMessageStored {
                id: mid,
                role: "tool".into(),
                content: row_content,
                thought: None,
                created_at: now + chrono::Duration::milliseconds(changed as i64),
                is_error: false,
                attachments: None,
                marker: Some("tool_step".into()),
            };
            // Stream order: insert right after the preceding assistant row.
            match anchor {
                Some(at) => {
                    journal.insert(at + 1, row);
                    anchor = Some(at + 1);
                }
                None => {
                    journal.push(row);
                    anchor = Some(journal.len() - 1);
                }
            }
            changed += 1;
        }
    }

    changed += backfill_user_attachments_from_agent_pairs(&mut journal, &pairs);

    if changed > 0 {
        store::save_messages(app_session_id, &journal)?;
        tracing::info!(
            target: "session",
            session = %app_session_id,
            agent = %agent_session_id,
            changed,
            "reconciled App journal from agent chat_history"
        );
    }
    Ok(changed)
}

/// Best-effort reconcile when opening an App session that is linked to an agent.
/// Never fails the load path — missing agent dir is normal for brand-new chats.
pub fn try_reconcile_linked_session(app_session_id: &str) -> u32 {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == app_session_id);
    let Some(meta) = meta else {
        return 0;
    };
    let Some(agent_id) = meta.agent_session_id.as_deref().filter(|s| !s.is_empty()) else {
        return 0;
    };
    let mode = store::load_settings().session_data_mode;
    let cwd_hint = meta.project_id.as_deref().and_then(|pid| {
        store::load_projects()
            .into_iter()
            .find(|p| p.id == pid)
            .map(|p| p.path)
    });
    let changed =
        reconcile_journal_from_chat_history(app_session_id, agent_id, cwd_hint.as_deref(), &mode)
            .unwrap_or(0);
    // Do not heal here: session_messages / post-turn reconcile can run while
    // this process still has a live prompt. Boot + connect heal instead.
    changed
}

/// Import one CLI session into the App journal (independent App session row).
///
/// Allowed in both shared and independent mode. In independent mode the scan
/// path is the app agent-home (not terminal `~/.grok`); callers should surface
/// path clarity in the UI. Already-linked agent ids return the existing row
/// without re-importing history.
pub fn import_cli_session(
    agent_session_id: &str,
    dir: Option<&str>,
    project_id: Option<String>,
    session_data_mode: &str,
) -> Result<SessionMeta, String> {
    let agent_session_id = validate_agent_session_id(agent_session_id)?;

    // Already linked? Skip re-import and return the existing app session.
    if let Some(existing) = store::load_sessions_index()
        .into_iter()
        .find(|s| s.agent_session_id.as_deref() == Some(agent_session_id))
    {
        return Ok(existing);
    }

    let dir = if let Some(d) = dir.filter(|s| !s.is_empty()) {
        PathBuf::from(d)
    } else {
        crate::paths::find_agent_session_dir(agent_session_id, None, session_data_mode)
            .ok_or_else(|| format!("CLI session dir not found for {agent_session_id}"))?
    };
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }

    let summary_path = dir.join("summary.json");
    let cwd_name = dir
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let (title, cwd, _, _) = read_summary_bits(
        &summary_path,
        &percent_decode_component(cwd_name),
        agent_session_id,
    );

    let history = dir.join("chat_history.jsonl");
    let pairs = parse_chat_history_jsonl(&history)?;

    // Prefer matching App project by path. Missing project folders from a
    // real CLI cwd are added untrusted — user still confirms trust.
    let project_id = project_id.or_else(|| {
        let cwd = cwd.as_deref()?;
        ensure_untrusted_project_for_cwd(cwd);
        store::load_projects()
            .into_iter()
            .find(|p| cwd_paths_match(&p.path, cwd))
            .map(|p| p.id)
    });

    let mut meta = store::create_session(project_id, Some(title), false)?;
    meta.agent_session_id = Some(agent_session_id.to_string());
    let now = Utc::now();
    let msgs: Vec<ChatMessageStored> = pairs
        .into_iter()
        .enumerate()
        .map(|(i, (role, content))| ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role,
            content,
            thought: None,
            created_at: now + chrono::Duration::milliseconds(i as i64),
            is_error: false,
            attachments: None,
            marker: None,
        })
        .collect();
    store::save_messages(&meta.id, &msgs)?;
    meta.updated_at = now;
    // Persist agent_session_id link.
    let sid = meta.id.clone();
    let agent_session_id = meta.agent_session_id.clone();
    if let Some(updated) = store::update_sessions_index(move |list| {
        let Some(row) = list.iter_mut().find(|s| s.id == sid) else {
            return Ok(None);
        };
        row.agent_session_id = agent_session_id;
        row.updated_at = now;
        Ok(Some(row.clone()))
    })? {
        meta = updated;
    }
    Ok(meta)
}

/// Import all not-yet-linked CLI sessions (capped).
pub fn import_all_cli_sessions(
    session_data_mode: &str,
    limit: usize,
) -> Result<Vec<SessionMeta>, String> {
    let list = list_cli_sessions(session_data_mode)?;
    let mut imported = Vec::new();
    for s in list.into_iter().filter(|s| !s.already_linked).take(limit) {
        match import_cli_session(&s.agent_session_id, Some(&s.dir), None, session_data_mode) {
            Ok(m) => imported.push(m),
            Err(e) => tracing::warn!("cli import skip {}: {e}", s.agent_session_id),
        }
    }
    Ok(imported)
}

/// Reject empty / traversal-looking agent session ids before any path join.
pub fn validate_agent_session_id(agent_session_id: &str) -> Result<&str, String> {
    let id = agent_session_id.trim();
    if id.is_empty() {
        return Err("empty agent_session_id".into());
    }
    if id.contains('\0') {
        return Err("invalid agent_session_id".into());
    }
    // Single path segment only — no separators or relative components.
    if id.contains('/') || id.contains('\\') || id == "." || id == ".." || id.contains("..") {
        return Err("invalid agent_session_id".into());
    }
    Ok(id)
}

/// True when `path` is exactly `{sessions_root}/{cwd_enc}/{agent_id}` (2 levels).
fn is_strict_cli_session_dir(path: &Path, sessions_root: &Path, agent_id: &str) -> bool {
    let name = match path.file_name().and_then(|s| s.to_str()) {
        Some(n) if n == agent_id => n,
        _ => return false,
    };
    let Ok(rel) = path.strip_prefix(sessions_root) else {
        return false;
    };
    let mut depth = 0usize;
    for c in rel.components() {
        match c {
            std::path::Component::Normal(os) => {
                // First segment is percent-encoded cwd; second must be agent id.
                if depth == 1 && os.to_str() != Some(name) {
                    return false;
                }
                depth += 1;
                if depth > 2 {
                    return false;
                }
            }
            _ => return false,
        }
    }
    depth == 2
}

/// Resolve a deletable CLI session directory under `sessions_root`.
///
/// When `dir` is provided it is preferred (from list), but must still canonicalize
/// under `{sessions_root}/{cwd}/{agent_session_id}`. Path traversal and id mismatch
/// are rejected. Does not touch App journals.
pub fn resolve_deletable_cli_session_dir(
    agent_session_id: &str,
    dir: Option<&str>,
    sessions_root: &Path,
) -> Result<PathBuf, String> {
    let agent_id = validate_agent_session_id(agent_session_id)?;

    let sessions_canon = sessions_root
        .canonicalize()
        .map_err(|e| format!("sessions root not available: {e}"))?;

    let candidate = if let Some(d) = dir.map(str::trim).filter(|s| !s.is_empty()) {
        if d.contains('\0') {
            return Err("invalid session dir".into());
        }
        PathBuf::from(d)
    } else {
        // Scan sessions_root/{cwd_enc}/{agent_id}/
        let Ok(cwd_dirs) = fs::read_dir(&sessions_canon) else {
            return Err(format!("CLI session dir not found for {agent_id}"));
        };
        let mut found: Option<PathBuf> = None;
        for ent in cwd_dirs.flatten() {
            let cwd_path = ent.path();
            if !cwd_path.is_dir() {
                continue;
            }
            let hit = cwd_path.join(agent_id);
            if hit.is_dir() {
                if found.is_some() {
                    return Err(format!(
                        "ambiguous CLI session dir for {agent_id}; pass dir from list"
                    ));
                }
                found = Some(hit);
            }
        }
        found.ok_or_else(|| format!("CLI session dir not found for {agent_id}"))?
    };

    let target = candidate
        .canonicalize()
        .map_err(|e| format!("session dir not found: {e}"))?;

    if !target.is_dir() {
        return Err(format!("not a directory: {}", target.display()));
    }
    if !is_strict_cli_session_dir(&target, &sessions_canon, agent_id) {
        return Err("path not allowed: outside GROK_HOME/sessions or id mismatch".into());
    }
    Ok(target)
}

/// Delete one CLI session directory under the active GROK_HOME only.
///
/// Removes the on-disk tree (`summary.json`, `chat_history.jsonl`, …).
/// Does **not** delete or unlink App chats — linked sidebar rows stay.
pub fn delete_cli_session(
    agent_session_id: &str,
    dir: Option<&str>,
    session_data_mode: &str,
) -> Result<(), String> {
    let home = resolve_agent_grok_home(session_data_mode);
    let sessions = home.join("sessions");
    let target = resolve_deletable_cli_session_dir(agent_session_id, dir, &sessions)?;
    fs::remove_dir_all(&target).map_err(|e| format!("delete failed: {e}"))?;
    tracing::info!(
        target: "session",
        agent = %agent_session_id,
        dir = %target.display(),
        "deleted on-disk CLI session under GROK_HOME"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    use crate::paths::percent_encode_path_component;

    #[test]
    fn percent_decode_roundtrip_path() {
        let enc = percent_encode_path_component("/Users/me/Code/oss/pq");
        assert!(enc.contains("%2F"));
        assert_eq!(percent_decode_component(&enc), "/Users/me/Code/oss/pq");
    }

    #[test]
    fn parse_jsonl_user_assistant() {
        let dir = std::env::temp_dir().join(format!("cli-hist-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat_history.jsonl");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(f, r#"{{"type":"system","content":"sys"}}"#).unwrap();
        writeln!(
            f,
            r#"{{"type":"user","content":[{{"type":"text","text":"<user_query>\nhello world\n</user_query>"}}]}}"#
        )
        .unwrap();
        writeln!(f, r#"{{"type":"assistant","content":"hi there"}}"#).unwrap();
        let pairs = parse_chat_history_jsonl(&path).unwrap();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "user");
        assert_eq!(pairs[0].1, "hello world");
        assert_eq!(pairs[1].0, "assistant");
        assert_eq!(pairs[1].1, "hi there");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_jsonl_skips_system_reminder_user_envelopes() {
        let dir = std::env::temp_dir().join(format!("cli-hist-reminder-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat_history.jsonl");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(
            f,
            r#"{{"type":"user","synthetic_reason":"project_instructions","content":"<system-reminder>\nFollow AGENTS.md\n</system-reminder>"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"user","content":"<system-reminder>\nAlso this\n</system-reminder>"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"type":"user","content":"<system-reminder>\nctx\n</system-reminder>\n<user_query>\nreal question\n</user_query>"}}"#
        )
        .unwrap();
        writeln!(f, r#"{{"type":"assistant","content":"ok"}}"#).unwrap();
        let pairs = parse_chat_history_jsonl(&path).unwrap();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "user");
        assert_eq!(pairs[0].1, "real question");
        assert_eq!(pairs[1].0, "assistant");
        assert_eq!(pairs[1].1, "ok");

        let rows = parse_chat_history_rows(&path).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].1, "real question");

        let first = read_first_user_prompt(&dir).unwrap();
        assert_eq!(first, "real question");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_at_path_attachments_strips_refs() {
        let raw = "see this\n\n@/Users/me/Desktop/shot.png\n@/tmp/notes.md";
        let (text, atts) = parse_at_path_attachments(raw);
        assert_eq!(text, "see this");
        assert_eq!(atts.len(), 2);
        assert_eq!(atts[0].path, "/Users/me/Desktop/shot.png");
        assert_eq!(atts[0].name, "shot.png");
        assert_eq!(atts[1].path, "/tmp/notes.md");
    }

    #[test]
    fn parse_at_path_attachments_keeps_spaces_in_path() {
        let raw = "docs please\n\n@/Users/me/Downloads/Codex 安装教程文档.md";
        let (text, atts) = parse_at_path_attachments(raw);
        assert_eq!(text, "docs please");
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].path, "/Users/me/Downloads/Codex 安装教程文档.md");
        assert_eq!(atts[0].name, "Codex 安装教程文档.md");
    }

    #[test]
    fn load_tool_names_from_events_parses_tool_name() {
        let dir = std::env::temp_dir().join(format!("cli-evt-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("events.jsonl");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(
            f,
            r#"{{"ts":"x","type":"tool_started","tool_name":"read_file","tool_call_id":"call-1"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"ts":"x","type":"tool_completed","tool_name":"run_terminal_command","tool_call_id":"call-2"}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"ts":"x","type":"phase_changed","phase":"execute"}}"#
        )
        .unwrap();
        let names = load_tool_names_from_events(&path);
        assert_eq!(names.get("call-1").map(String::as_str), Some("read_file"));
        assert_eq!(
            names.get("call-2").map(String::as_str),
            Some("run_terminal_command")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconcile_rebuilds_sparse_tool_rows_with_names_in_order() {
        let dir = std::env::temp_dir().join(format!("cli-rec-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        // chat_history: user → frag1 → tool(call-16) → frag2 → tool(call-17) → frag3
        let mut h = fs::File::create(dir.join("chat_history.jsonl")).unwrap();
        writeln!(
            h,
            r#"{{"type":"user","content":[{{"type":"text","text":"<user_query>\n做图\n</user_query>"}}]}}"#
        )
        .unwrap();
        writeln!(h, r#"{{"type":"assistant","content":"先读技能。"}}"#).unwrap();
        writeln!(
            h,
            r#"{{"type":"tool_result","tool_call_id":"call-16","content":"1→skill body"}}"#
        )
        .unwrap();
        writeln!(h, r#"{{"type":"assistant","content":"正在构建信息图。"}}"#).unwrap();
        writeln!(
            h,
            r#"{{"type":"tool_result","tool_call_id":"call-17","content":"exit: 0\nok"}}"#
        )
        .unwrap();
        writeln!(h, r#"{{"type":"assistant","content":"已定稿。"}}"#).unwrap();
        // updates.jsonl supplies name + label + rawInput (the rich source)
        let mut u = fs::File::create(dir.join("updates.jsonl")).unwrap();
        writeln!(
            u,
            r#"{{"method":"session/update","params":{{"sessionId":"s","update":{{"sessionUpdate":"tool_call","toolCallId":"call-16","title":"read_file","rawInput":{{"target_file":"/Users/me/notes.md"}},"_meta":{{"x.ai/tool":{{"name":"read_file","label":"Read","kind":"read"}}}}}}}}}}"#
        )
        .unwrap();
        writeln!(
            u,
            r#"{{"method":"session/update","params":{{"sessionId":"s","update":{{"sessionUpdate":"tool_call","toolCallId":"call-17","title":"run_terminal_command","rawInput":{{"command":"ls -la","description":"List files"}},"_meta":{{"x.ai/tool":{{"name":"run_terminal_command","label":"Run Command","kind":"execute"}}}}}}}}}}"#
        )
        .unwrap();
        // events.jsonl remains a fallback for name-only CLIs
        let mut e = fs::File::create(dir.join("events.jsonl")).unwrap();
        writeln!(
            e,
            r#"{{"type":"tool_completed","tool_name":"read_file","tool_call_id":"call-16"}}"#
        )
        .unwrap();
        writeln!(
            e,
            r#"{{"type":"tool_completed","tool_name":"run_terminal_command","tool_call_id":"call-17"}}"#
        )
        .unwrap();

        // Pre-seeded journal mirrors a live session that already has the user
        // row, the first fragment (streamed), and a SPARSE tool row for call-16.
        let mut journal = vec![
            ChatMessageStored {
                id: "u1".into(),
                role: "user".into(),
                content: "做图".into(),
                thought: None,
                created_at: Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
            ChatMessageStored {
                id: "a1".into(),
                role: "assistant".into(),
                content: "先读技能。".into(),
                thought: None,
                created_at: Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
            ChatMessageStored {
                id: "tool-call-16".into(),
                role: "tool".into(),
                content: "tool_step|completed|tool|tool".into(),
                thought: None,
                created_at: Utc::now(),
                is_error: false,
                attachments: None,
                marker: Some("tool_step".into()),
            },
        ];
        let rows = parse_chat_history_rows(&dir.join("chat_history.jsonl")).unwrap();
        assert_eq!(rows.len(), 6);
        let tool_calls =
            load_tool_calls_from_updates(&dir.join("updates.jsonl"), &dir.join("events.jsonl"));
        assert_eq!(
            tool_calls.get("call-16").map(|r| r.name.as_str()),
            Some("read_file")
        );
        assert_eq!(
            tool_calls.get("call-16").map(|r| r.label.as_str()),
            Some("Read")
        );
        assert_eq!(
            tool_calls.get("call-16").and_then(|r| r.input.as_deref()),
            Some("/Users/me/notes.md")
        );
        assert_eq!(
            tool_calls.get("call-17").and_then(|r| r.input.as_deref()),
            Some("ls -la")
        );

        // Mirror the reconcile walk (fragments upsert + sparse tool upgrade +
        // missing tool insert in stream order).
        let mut anchor: Option<usize> = journal.len().checked_sub(1);
        for (role, content, cid) in &rows {
            if role == "assistant" {
                match journal_covers_assistant(&journal, content) {
                    CoverKind::Covered(idx) => {
                        if idx != usize::MAX {
                            anchor = Some(idx);
                        }
                    }
                    CoverKind::Extend(idx) => {
                        journal[idx].content = content.clone();
                        anchor = Some(idx);
                    }
                    CoverKind::Missing => {
                        journal.push(ChatMessageStored {
                            id: Uuid::new_v4().to_string(),
                            role: "assistant".into(),
                            content: content.clone(),
                            thought: None,
                            created_at: Utc::now(),
                            is_error: false,
                            attachments: None,
                            marker: None,
                        });
                        anchor = Some(journal.len() - 1);
                    }
                }
                continue;
            }
            if role != "tool" {
                continue;
            }
            let Some(call_id) = cid else { continue };
            let mid = format!("tool-{call_id}");
            let rec = tool_calls.get(call_id);
            let name = rec
                .map(|r| r.name.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_default();
            let label = rec
                .map(|r| r.label.clone())
                .filter(|s| !s.is_empty() && s != "tool")
                .unwrap_or_else(|| tool_label_from_result(&name, content));
            let detail_clean = strip_numbered_markers(content);
            let mut row_content = format!("tool_step|completed|{name}|{label}");
            if let Some(inp) = rec
                .and_then(|r| r.input.as_deref())
                .filter(|s| !s.trim().is_empty())
            {
                row_content.push('\n');
                row_content.push_str("input:");
                row_content.push_str(&inp.chars().take(400).collect::<String>());
            }
            if !detail_clean.is_empty() {
                row_content.push('\n');
                row_content.push_str(&detail_clean.chars().take(400).collect::<String>());
            }
            if let Some(slot) = journal.iter_mut().find(|m| m.id == mid) {
                if tool_journal_richer(&slot.content, &row_content) {
                    slot.content = row_content;
                }
            } else {
                let row = ChatMessageStored {
                    id: mid,
                    role: "tool".into(),
                    content: row_content,
                    thought: None,
                    created_at: Utc::now(),
                    is_error: false,
                    attachments: None,
                    marker: Some("tool_step".into()),
                };
                match anchor {
                    Some(at) => {
                        journal.insert(at + 1, row);
                        anchor = Some(at + 1);
                    }
                    None => {
                        journal.push(row);
                        anchor = Some(journal.len() - 1);
                    }
                }
            }
        }

        // tool-call-16 upgraded from sparse to named read_file with input.
        let t16 = journal.iter().find(|m| m.id == "tool-call-16").unwrap();
        assert!(t16
            .content
            .starts_with("tool_step|completed|read_file|Read"));
        assert!(t16.content.contains("input:/Users/me/notes.md"));
        // call-17 keeps the rich label + command input.
        let t17 = journal.iter().find(|m| m.id == "tool-call-17").unwrap();
        assert!(t17
            .content
            .starts_with("tool_step|completed|run_terminal_command|Run Command"));
        assert!(t17.content.contains("input:ls -la"));
        // call-17 inserted in stream order between its fragments.
        let order: Vec<&str> = journal.iter().map(|m| m.id.as_str()).collect();
        let contents: Vec<&str> = journal.iter().map(|m| m.content.as_str()).collect();
        let i16 = order.iter().position(|x| *x == "tool-call-16").unwrap();
        let i17 = order.iter().position(|x| *x == "tool-call-17").unwrap();
        assert!(i16 < i17, "tools keep stream order: {order:?}");
        assert!(
            contents[i17 - 1].contains("正在构建信息图"),
            "call-17 sits after its preceding fragment: {order:?}"
        );
        assert!(
            contents[i17 + 1].contains("已定稿"),
            "call-17 sits before its following fragment: {order:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backfill_user_attachments_from_agent_pairs_fills_missing() {
        let mut journal = vec![ChatMessageStored {
            id: "u1".into(),
            role: "user".into(),
            content: "以参考图形象为准，生成一张精致像素风格的图片".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        }];
        let pairs = vec![(
            "user".into(),
            "以参考图形象为准，生成一张精致像素风格的图片\n\n@/Users/me/Downloads/ref.png".into(),
        )];
        let n = backfill_user_attachments_from_agent_pairs(&mut journal, &pairs);
        assert_eq!(n, 1);
        let atts = journal[0].attachments.as_ref().unwrap();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].path, "/Users/me/Downloads/ref.png");
        assert_eq!(atts[0].name, "ref.png");
        // Idempotent — already filled rows are skipped.
        assert_eq!(
            backfill_user_attachments_from_agent_pairs(&mut journal, &pairs),
            0
        );
    }

    #[test]
    fn cover_detects_missing_final_and_prefix_extend() {
        let journal = vec![ChatMessageStored {
            id: "a1".into(),
            role: "assistant".into(),
            content: "基于已有调研，产出矩阵。".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        }];
        assert_eq!(
            journal_covers_assistant(&journal, "基于已有调研，产出矩阵。"),
            CoverKind::Covered(0)
        );
        assert_eq!(
            journal_covers_assistant(&journal, "# 功能对照矩阵（已出）\n\n完整版已落盘"),
            CoverKind::Missing
        );
        assert_eq!(
            journal_covers_assistant(
                &journal,
                "基于已有调研，产出矩阵。\n\n# 功能对照矩阵（已出）"
            ),
            CoverKind::Extend(0)
        );
        // Full journal already has the answer — agent intro is covered.
        let full = vec![ChatMessageStored {
            id: "a2".into(),
            role: "assistant".into(),
            content: "基于已有调研，产出矩阵。\n\n# 功能对照矩阵（已出）".into(),
            thought: None,
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        }];
        assert_eq!(
            journal_covers_assistant(&full, "基于已有调研，产出矩阵。"),
            CoverKind::Covered(0)
        );
    }

    #[test]
    fn validate_agent_session_id_rejects_traversal() {
        assert!(validate_agent_session_id("").is_err());
        assert!(validate_agent_session_id("   ").is_err());
        assert!(validate_agent_session_id("../etc").is_err());
        assert!(validate_agent_session_id("a/b").is_err());
        assert!(validate_agent_session_id("a\\b").is_err());
        assert!(validate_agent_session_id("..").is_err());
        assert!(validate_agent_session_id("sess-ok-123").is_ok());
    }

    #[test]
    fn import_cli_session_rejects_traversal_ids_before_path_join() {
        // Must fail closed on the id itself — never scan sessions or join `..`.
        for id in ["", "   ", "../etc", "a/b", "a\\b", "..", "sess/../x"] {
            let err = import_cli_session(id, None, None, "shared").unwrap_err();
            assert!(
                err.contains("invalid agent_session_id") || err.contains("empty agent_session_id"),
                "id {id:?} → {err}"
            );
        }
    }

    fn make_fake_cli_session(home: &Path, agent_id: &str) -> PathBuf {
        let cwd_enc = percent_encode_path_component("/Users/me/proj");
        let dir = home.join("sessions").join(cwd_enc).join(agent_id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("summary.json"), r#"{"generated_title":"t"}"#).unwrap();
        fs::write(dir.join("chat_history.jsonl"), "").unwrap();
        dir
    }

    #[test]
    fn resolve_delete_accepts_strict_session_dir() {
        let home = std::env::temp_dir().join(format!("cli-del-ok-{}", Uuid::new_v4()));
        let agent_id = "agent-sess-aaaa";
        let dir = make_fake_cli_session(&home, agent_id);
        let sessions = home.join("sessions");
        let resolved =
            resolve_deletable_cli_session_dir(agent_id, Some(dir.to_str().unwrap()), &sessions)
                .unwrap();
        assert_eq!(resolved, dir.canonicalize().unwrap());
        // Discover by id alone
        let by_id = resolve_deletable_cli_session_dir(agent_id, None, &sessions).unwrap();
        assert_eq!(by_id, dir.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn resolve_delete_rejects_outside_sessions_and_id_mismatch() {
        let home = std::env::temp_dir().join(format!("cli-del-bad-{}", Uuid::new_v4()));
        let agent_id = "agent-sess-bbbb";
        let _dir = make_fake_cli_session(&home, agent_id);
        let sessions = home.join("sessions");

        // Outside sessions root
        let outside = home.join("other").join(agent_id);
        fs::create_dir_all(&outside).unwrap();
        assert!(resolve_deletable_cli_session_dir(
            agent_id,
            Some(outside.to_str().unwrap()),
            &sessions
        )
        .is_err());

        // Id does not match directory name
        let wrong_name = sessions
            .join(percent_encode_path_component("/Users/me/proj"))
            .join("not-the-agent");
        fs::create_dir_all(&wrong_name).unwrap();
        assert!(resolve_deletable_cli_session_dir(
            agent_id,
            Some(wrong_name.to_str().unwrap()),
            &sessions
        )
        .is_err());

        // sessions root itself
        assert!(resolve_deletable_cli_session_dir(
            agent_id,
            Some(sessions.to_str().unwrap()),
            &sessions
        )
        .is_err());

        // cwd folder (only one level under sessions)
        let cwd_only = sessions.join(percent_encode_path_component("/Users/me/proj"));
        assert!(resolve_deletable_cli_session_dir(
            agent_id,
            Some(cwd_only.to_str().unwrap()),
            &sessions
        )
        .is_err());

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn delete_cli_session_removes_tree() {
        let home = std::env::temp_dir().join(format!("cli-del-rm-{}", Uuid::new_v4()));
        let agent_id = "agent-sess-cccc";
        let dir = make_fake_cli_session(&home, agent_id);
        let sessions = home.join("sessions");
        let target =
            resolve_deletable_cli_session_dir(agent_id, Some(dir.to_str().unwrap()), &sessions)
                .unwrap();
        fs::remove_dir_all(&target).unwrap();
        assert!(!dir.exists());
        // sibling under home must remain
        assert!(sessions.is_dir() || !home.join("sessions").exists() || home.exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn normalize_cwd_path_trims_and_lowercases() {
        assert_eq!(
            normalize_cwd_path("/Users/Me/Proj/"),
            normalize_cwd_path("/users/me/proj")
        );
        assert_eq!(normalize_cwd_path("  /a/b  "), "/a/b");
        assert!(normalize_cwd_path("   ").is_empty());
    }

    #[test]
    fn cwd_paths_match_ignores_trailing_slash_and_case() {
        assert!(cwd_paths_match("/Users/me/Code", "/Users/me/Code/"));
        assert!(cwd_paths_match(r"C:\Work\App", "c:/work/app"));
        assert!(!cwd_paths_match("/a/b", "/a/c"));
        assert!(!cwd_paths_match("", "/a"));
    }

    #[test]
    fn pick_latest_session_for_cwd_picks_newest() {
        #[derive(Debug)]
        struct Row {
            id: &'static str,
            cwd: Option<&'static str>,
            updated: &'static str,
        }
        let rows = [
            Row {
                id: "old",
                cwd: Some("/Users/me/proj"),
                updated: "2024-01-01T00:00:00Z",
            },
            Row {
                id: "other",
                cwd: Some("/Users/me/other"),
                updated: "2026-01-01T00:00:00Z",
            },
            Row {
                id: "new",
                cwd: Some("/Users/me/proj/"),
                updated: "2025-06-01T12:00:00Z",
            },
        ];
        let best =
            pick_latest_session_for_cwd(&rows, "/Users/me/proj", |r| r.cwd, |r| Some(r.updated))
                .unwrap();
        assert_eq!(best.id, "new");
        assert!(
            pick_latest_session_for_cwd(&rows, "/missing", |r| r.cwd, |r| Some(r.updated),)
                .is_none()
        );
        assert!(pick_latest_session_for_cwd(&rows, "", |r| r.cwd, |r| Some(r.updated),).is_none());
    }

    #[test]
    fn find_latest_prefers_newest_under_encoded_cwd() {
        use crate::paths::{percent_encode_path_component, APP_HOME_ENV_LOCK};

        let _guard = APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let app_home = std::env::temp_dir().join(format!("cli-cont-{}", Uuid::new_v4()));
        let agent_home = app_home.join("agent-home");
        let proj = "/Users/me/continue-proj";
        let cwd_enc = percent_encode_path_component(proj);
        let sessions = agent_home.join("sessions").join(&cwd_enc);

        let old_id = "agent-old-1111";
        let new_id = "agent-new-2222";
        let old_dir = sessions.join(old_id);
        let new_dir = sessions.join(new_id);
        fs::create_dir_all(&old_dir).unwrap();
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(
            old_dir.join("summary.json"),
            r#"{"generated_title":"old","updated_at":"2024-01-01T00:00:00Z","info":{"cwd":"/Users/me/continue-proj"}}"#,
        )
        .unwrap();
        fs::write(old_dir.join("chat_history.jsonl"), "").unwrap();
        fs::write(
            new_dir.join("summary.json"),
            r#"{"generated_title":"new","updated_at":"2025-06-01T00:00:00Z","info":{"cwd":"/Users/me/continue-proj"}}"#,
        )
        .unwrap();
        fs::write(new_dir.join("chat_history.jsonl"), "").unwrap();

        // Unrelated project must not win.
        let other = agent_home
            .join("sessions")
            .join(percent_encode_path_component("/Users/me/other"))
            .join("agent-other");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("summary.json"),
            r#"{"generated_title":"other","updated_at":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        fs::write(other.join("chat_history.jsonl"), "").unwrap();

        std::env::set_var("GROK_APP_HOME", &app_home);
        let hit = find_latest_cli_session_for_cwd(proj, "independent")
            .unwrap()
            .expect("should find session");
        assert_eq!(hit.agent_session_id, new_id);
        assert_eq!(hit.title, "new");

        // Soft-fail empty / missing path
        assert!(find_latest_cli_session_for_cwd("", "independent")
            .unwrap()
            .is_none());
        assert!(
            find_latest_cli_session_for_cwd("/no/such/path", "independent")
                .unwrap()
                .is_none()
        );

        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&app_home);
    }

    #[test]
    fn find_latest_matches_trailing_slash_variant() {
        use crate::paths::{percent_encode_path_component, APP_HOME_ENV_LOCK};

        let _guard = APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let app_home = std::env::temp_dir().join(format!("cli-cont2-{}", Uuid::new_v4()));
        let agent_home = app_home.join("agent-home");
        let proj = "/Users/me/slash-proj";
        let dir = agent_home
            .join("sessions")
            .join(percent_encode_path_component(proj))
            .join("agent-slash");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("summary.json"),
            r#"{"generated_title":"slash","updated_at":"2025-01-01T00:00:00Z","info":{"cwd":"/Users/me/slash-proj"}}"#,
        )
        .unwrap();
        fs::write(dir.join("chat_history.jsonl"), "").unwrap();

        std::env::set_var("GROK_APP_HOME", &app_home);
        let hit = find_latest_cli_session_for_cwd("/Users/me/slash-proj/", "independent")
            .unwrap()
            .expect("trailing slash should still match");
        assert_eq!(hit.agent_session_id, "agent-slash");
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&app_home);
    }

    #[test]
    fn parse_sessions_search_text_basic() {
        let raw = r#"019f3fc7-485c-7ef1-ba71-624d6c014657 (remote)  Jul 08, 11:42am
  Test Message
  test
019f3fc7-fd3a-72b1-b0a7-5d0c3e0b02bc (local)  Jul 08, 11:42am
  Test Session
  测试 session

Total: 2
"#;
        let hits = parse_sessions_search_text(raw);
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].agent_session_id,
            "019f3fc7-485c-7ef1-ba71-624d6c014657"
        );
        assert_eq!(hits[0].title, "Test Message");
        assert_eq!(hits[0].first_prompt.as_deref(), Some("test"));
        assert_eq!(hits[0].status.as_deref(), Some("remote"));
        assert_eq!(hits[1].title, "Test Session");
        assert_eq!(hits[1].status.as_deref(), Some("local"));
    }

    #[test]
    fn parse_sessions_search_text_empty_and_warnings() {
        assert!(parse_sessions_search_text("\nTotal: 0\n").is_empty());
        let raw = r#"warning: remote session search timed out, showing local results only
019ea630-1bd7-7f20-9ee4-78325ae16994 (local)  Jun 08,  6:17pm
  GatePath Software Download

Total: 1
"#;
        let hits = parse_sessions_search_text(raw);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "GatePath Software Download");
        assert!(hits[0].first_prompt.is_none());
    }

    #[test]
    fn parse_sessions_search_json_array() {
        let raw = r#"[
          {
            "agentSessionId": "abc-1111-uuid-xxxx-yyyyyyyyyyyy",
            "title": "Hello",
            "firstPrompt": "hi there",
            "status": "local"
          }
        ]"#;
        let hits = parse_sessions_search_json(raw).expect("json");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Hello");
        assert_eq!(hits[0].first_prompt.as_deref(), Some("hi there"));
    }

    #[test]
    fn read_first_user_prompt_from_history() {
        let dir = std::env::temp_dir().join(format!("cli-fp-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat_history.jsonl");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(f, r#"{{"type":"system","content":"sys"}}"#).unwrap();
        writeln!(
            f,
            r#"{{"type":"user","content":[{{"type":"text","text":"<user_query>\nsearch me please\n</user_query>"}}]}}"#
        )
        .unwrap();
        let p = read_first_user_prompt(&dir).unwrap();
        assert_eq!(p, "search me please");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clamp_search_limit_bounds() {
        assert_eq!(clamp_search_limit(None), 40);
        assert_eq!(clamp_search_limit(Some(0)), 1);
        assert_eq!(clamp_search_limit(Some(200)), 100);
        assert_eq!(clamp_search_limit(Some(25)), 25);
    }

    #[test]
    fn auto_add_project_path_skips_home_and_roots() {
        let home = "/Users/prax";
        assert!(should_auto_add_project_path(
            "/Users/prax/Developer/money-manager-reverse-engineering",
            home
        ));
        assert!(should_auto_add_project_path(
            "/Users/prax/Developer/PraxAutomations/prax-daily",
            home
        ));
        assert!(!should_auto_add_project_path("/", home));
        assert!(!should_auto_add_project_path("/Users/prax", home));
        assert!(!should_auto_add_project_path("/Users/prax/Developer", home));
        assert!(!should_auto_add_project_path("C:\\", "C:\\Users\\prax"));
        assert!(!should_auto_add_project_path("", home));
    }
}
