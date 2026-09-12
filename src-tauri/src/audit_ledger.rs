//! Cross-session tool / permission audit ledger.
//!
//! Append-only JSONL under `{app_data}/audit/tool_ledger.jsonl`. Soft-fail on
//! all I/O. Never stores secrets/API keys (summary is redacted + length-capped).
//! Soft-rotates when the file grows past a size budget. Optional day-based
//! retention (7 / 30 / 90 / unlimited) prunes on write, rotate, or explicit
//! prune. Export can filter by event, session, and date range.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use parking_lot::Mutex as ParkingMutex;
use serde::{Deserialize, Serialize};

/// Soft cap for the on-disk JSONL (bytes). Past this we rewrite keeping the tail.
pub const MAX_LEDGER_BYTES: u64 = 2 * 1024 * 1024;
/// When rotating, keep roughly this many trailing lines.
pub const ROTATE_KEEP_LINES: usize = 4_000;
/// Default / max rows returned by list.
pub const DEFAULT_LIST_LIMIT: usize = 200;
pub const MAX_LIST_LIMIT: usize = 1_000;
/// Redacted free-form summary budget.
pub const MAX_SUMMARY_CHARS: usize = 240;
/// Cap tool_name / permission strings.
pub const MAX_FIELD_CHARS: usize = 120;

/// Retention presets (days). `0` = unlimited (keep until size rotate / clear).
pub const RETENTION_UNLIMITED: u32 = 0;
pub const RETENTION_7: u32 = 7;
pub const RETENTION_30: u32 = 30;
pub const RETENTION_90: u32 = 90;
#[allow(dead_code)]
pub const RETENTION_PRESETS: [u32; 4] =
    [RETENTION_7, RETENTION_30, RETENTION_90, RETENTION_UNLIMITED];

/// Event kinds written to the ledger.
pub const EVENT_PERMISSION: &str = "permission";
pub const EVENT_TOOL_START: &str = "tool_start";
pub const EVENT_TOOL_END: &str = "tool_end";

/// Outcome for terminal tool rows.
pub const OUTCOME_OK: &str = "ok";
pub const OUTCOME_ERR: &str = "err";

static WRITE_LOCK: ParkingMutex<()> = ParkingMutex::new(());

/// Pending UI permission context so `resolve_permission` can log tool_name.
#[derive(Debug, Clone)]
struct PendingPermission {
    tool_name: String,
    summary: String,
}

static PENDING_PERMS: LazyLock<Mutex<std::collections::HashMap<(String, u64), PendingPermission>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// One append-only ledger row (camelCase for the UI).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuditLedgerEntry {
    /// ISO-8601 UTC timestamp.
    pub ts: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(default)]
    pub tool_name: String,
    /// `permission` | `tool_start` | `tool_end`
    pub event: String,
    /// User/auto permission decision when `event == permission`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<String>,
    /// `ok` | `err` when `event == tool_end`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    /// Short redacted human summary (title / path / shell head).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Directory `{app_data}/audit`.
pub fn audit_dir() -> PathBuf {
    let dir = crate::paths::app_data_root().join("audit");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Path `{app_data}/audit/tool_ledger.jsonl`.
pub fn ledger_path() -> PathBuf {
    audit_dir().join("tool_ledger.jsonl")
}

/// Normalize limit into a safe range.
pub fn normalize_list_limit(raw: Option<u32>) -> usize {
    match raw {
        None => DEFAULT_LIST_LIMIT,
        Some(n) => (n as usize).clamp(1, MAX_LIST_LIMIT),
    }
}

/// Normalize retention days to a known preset. Unknown → unlimited (`0`).
pub fn normalize_retention_days(raw: u32) -> u32 {
    match raw {
        RETENTION_7 | RETENTION_30 | RETENTION_90 => raw,
        _ => RETENTION_UNLIMITED,
    }
}

/// Read retention days from AppSettings (normalized). Soft-fail → unlimited.
pub fn current_retention_days() -> u32 {
    normalize_retention_days(crate::store::load_settings().audit_ledger_retention_days)
}

/// Parse entry `ts` to UTC millis since epoch. `None` when unparseable.
pub fn entry_ts_ms(entry: &AuditLedgerEntry) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(entry.ts.trim())
        .ok()
        .map(|dt| dt.timestamp_millis())
        .or_else(|| {
            // Accept plain UTC `...Z` already covered by rfc3339; try millis-less fallback.
            chrono::DateTime::parse_from_str(entry.ts.trim(), "%Y-%m-%dT%H:%M:%SZ")
                .ok()
                .map(|dt| dt.timestamp_millis())
        })
}

/// Pure: keep entries within retention window. Unlimited (`0`) keeps all.
/// Unparseable timestamps are kept (never drop opaque rows on time alone).
#[allow(dead_code)]
pub fn filter_by_retention(
    entries: Vec<AuditLedgerEntry>,
    retention_days: u32,
    now_ms: i64,
) -> Vec<AuditLedgerEntry> {
    let days = normalize_retention_days(retention_days);
    if days == RETENTION_UNLIMITED {
        return entries;
    }
    let window_ms = (days as i64).saturating_mul(86_400_000);
    let cutoff = now_ms.saturating_sub(window_ms);
    entries
        .into_iter()
        .filter(|e| match entry_ts_ms(e) {
            Some(ms) => ms >= cutoff,
            None => true,
        })
        .collect()
}

/// Optional export / list filter (camelCase from UI).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLedgerFilter {
    /// `permission` | `tool_start` | `tool_end` | omit/empty = all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Inclusive lower bound RFC3339 (or any parseable timestamp string).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_ts: Option<String>,
    /// Inclusive upper bound RFC3339.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_ts: Option<String>,
}

fn parse_bound_ms(raw: Option<&str>) -> Option<i64> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    // Date-only `YYYY-MM-DD` → start of that UTC day.
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let dt = d.and_hms_opt(0, 0, 0).map(|ndt| ndt.and_utc())?;
        return Some(dt.timestamp_millis());
    }
    None
}

/// Pure: apply event / session / date-range filter.
pub fn filter_entries(
    entries: Vec<AuditLedgerEntry>,
    filter: &AuditLedgerFilter,
) -> Vec<AuditLedgerEntry> {
    let event = filter
        .event
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all")
        .map(|s| s.to_string());
    let sid = filter
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());
    let from_ms = parse_bound_ms(filter.from_ts.as_deref());
    let to_ms = parse_bound_ms(filter.to_ts.as_deref()).map(|ms| {
        // If bound was date-only (midnight), treat as end of that day.
        let raw = filter.to_ts.as_deref().unwrap_or("").trim();
        if raw.len() == 10 && chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").is_ok() {
            ms + 86_400_000 - 1
        } else {
            ms
        }
    });

    entries
        .into_iter()
        .filter(|e| {
            if let Some(ref ev) = event {
                if e.event != *ev {
                    return false;
                }
            }
            if let Some(ref want) = sid {
                let got = e.session_id.as_deref().unwrap_or("").to_ascii_lowercase();
                if got != *want {
                    return false;
                }
            }
            if from_ms.is_some() || to_ms.is_some() {
                let Some(ms) = entry_ts_ms(e) else {
                    // Unparseable ts: keep when no bounds strictness required? Drop for range
                    // filters so export stays honest about the window.
                    return false;
                };
                if let Some(lo) = from_ms {
                    if ms < lo {
                        return false;
                    }
                }
                if let Some(hi) = to_ms {
                    if ms > hi {
                        return false;
                    }
                }
            }
            true
        })
        .collect()
}

/// Cap + scrub a free-form field. Soft-fail friendly (never panics).
pub fn sanitize_field(raw: &str, max: usize) -> String {
    let redacted = crate::store::redact_text(raw);
    let cleaned: String = redacted
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let max = max.max(1);
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    trimmed.chars().take(max).collect()
}

/// Map a terminal tool status string to ok/err (None when not terminal).
pub fn outcome_from_tool_status(status: &str) -> Option<&'static str> {
    let s = if status.is_empty() {
        "in_progress"
    } else {
        status
    };
    let lower = s.to_ascii_lowercase();
    match lower.as_str() {
        "completed" | "complete" => Some(OUTCOME_OK),
        "failed" | "error" | "cancelled" | "canceled" | "rejected" => Some(OUTCOME_ERR),
        _ => None,
    }
}

/// Build a sanitized entry (does not write).
pub fn build_entry(
    session_id: Option<&str>,
    project_path: Option<&str>,
    tool_name: &str,
    event: &str,
    permission: Option<&str>,
    outcome: Option<&str>,
    summary: Option<&str>,
) -> AuditLedgerEntry {
    let tool = sanitize_field(tool_name, MAX_FIELD_CHARS);
    let tool = if tool.is_empty() {
        "unknown".into()
    } else {
        tool
    };
    let event = match event {
        EVENT_PERMISSION | EVENT_TOOL_START | EVENT_TOOL_END => event.to_string(),
        other => sanitize_field(other, MAX_FIELD_CHARS),
    };
    let permission = permission
        .map(|p| sanitize_field(p, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let outcome = outcome
        .map(|o| sanitize_field(o, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let summary = summary
        .map(|s| sanitize_field(s, MAX_SUMMARY_CHARS))
        .filter(|s| !s.is_empty());
    let session_id = session_id
        .map(|s| sanitize_field(s, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let project_path = project_path
        .map(|s| sanitize_field(s, 512))
        .filter(|s| !s.is_empty());

    AuditLedgerEntry {
        ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        session_id,
        project_path,
        tool_name: tool,
        event,
        permission,
        outcome,
        summary,
    }
}

/// Remember a pending UI permission so resolve can attribute tool_name.
pub fn remember_permission(session_id: &str, rpc_id: u64, tool_name: &str, summary: Option<&str>) {
    let sid = session_id.trim();
    if sid.is_empty() {
        return;
    }
    let tool = sanitize_field(tool_name, MAX_FIELD_CHARS);
    let sum = summary
        .map(|s| sanitize_field(s, MAX_SUMMARY_CHARS))
        .unwrap_or_default();
    if let Ok(mut map) = PENDING_PERMS.lock() {
        // Soft cap pending map so a stuck agent cannot grow unbounded.
        if map.len() > 512 {
            map.clear();
        }
        map.insert(
            (sid.to_string(), rpc_id),
            PendingPermission {
                tool_name: if tool.is_empty() {
                    "unknown".into()
                } else {
                    tool
                },
                summary: sum,
            },
        );
    }
}

/// Take (and remove) a remembered permission context.
fn take_permission(session_id: &str, rpc_id: u64) -> Option<PendingPermission> {
    let Ok(mut map) = PENDING_PERMS.lock() else {
        return None;
    };
    map.remove(&(session_id.to_string(), rpc_id))
}

/// Soft-fail append of one entry. Never panics; I/O errors are logged.
pub fn append_entry(entry: &AuditLedgerEntry) {
    let _guard = WRITE_LOCK.lock();
    if let Err(e) = append_entry_locked(entry) {
        tracing::warn!(target: "grok_app::audit_ledger", "append failed: {e}");
    }
}

fn append_entry_locked(entry: &AuditLedgerEntry) -> Result<(), String> {
    let path = ledger_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let line = serde_json::to_string(entry).map_err(|e| format!("serialize: {e}"))?;
    // Reject accidental secrets that slipped past sanitize (defense in depth).
    let line = crate::store::redact_text(&line);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open: {e}"))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    file.write_all(b"\n")
        .map_err(|e| format!("write nl: {e}"))?;
    file.flush().map_err(|e| format!("flush: {e}"))?;

    maybe_rotate_locked(&path)?;
    // Time-based retention after size rotate so the rewrite stays small.
    maybe_prune_locked(&path, current_retention_days())?;
    Ok(())
}

/// Soft rotate: if file exceeds budget, keep the last ROTATE_KEEP_LINES lines.
fn maybe_rotate_locked(path: &std::path::Path) -> Result<(), String> {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()),
    };
    if meta.len() <= MAX_LEDGER_BYTES {
        return Ok(());
    }
    let file = File::open(path).map_err(|e| format!("rotate open: {e}"))?;
    let reader = BufReader::new(file);
    let mut lines: Vec<String> = reader
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .collect();
    if lines.len() <= ROTATE_KEEP_LINES / 2 {
        // File is huge with few lines (giant rows) — drop oldest half.
        let keep = lines.len() / 2;
        if keep == 0 {
            let _ = fs::write(path, b"");
            return Ok(());
        }
        lines = lines.split_off(lines.len() - keep);
    } else {
        let start = lines.len().saturating_sub(ROTATE_KEEP_LINES);
        lines = lines.split_off(start);
    }
    let tmp = path.with_extension("jsonl.tmp");
    {
        let mut out = File::create(&tmp).map_err(|e| format!("rotate create: {e}"))?;
        for l in &lines {
            out.write_all(l.as_bytes())
                .map_err(|e| format!("rotate write: {e}"))?;
            out.write_all(b"\n")
                .map_err(|e| format!("rotate write nl: {e}"))?;
        }
        out.flush().map_err(|e| format!("rotate flush: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rotate rename: {e}"))?;
    tracing::info!(
        target: "grok_app::audit_ledger",
        kept = lines.len(),
        "rotated tool ledger (size budget)"
    );
    Ok(())
}

/// Rewrite ledger keeping only rows inside the retention window.
/// Soft-fail → Ok(0). Returns number of rows dropped (best-effort).
pub fn prune_ledger(retention_days: Option<u32>) -> Result<u32, String> {
    let days = normalize_retention_days(retention_days.unwrap_or_else(current_retention_days));
    let _guard = WRITE_LOCK.lock();
    let path = ledger_path();
    maybe_prune_locked(&path, days)
}

fn maybe_prune_locked(path: &std::path::Path, retention_days: u32) -> Result<u32, String> {
    let days = normalize_retention_days(retention_days);
    if days == RETENTION_UNLIMITED {
        return Ok(0);
    }
    if !path.is_file() {
        return Ok(0);
    }
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Ok(0),
    };
    let reader = BufReader::new(file);
    let mut kept_lines: Vec<String> = Vec::new();
    let mut kept_entries = 0u32;
    let mut dropped = 0u32;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let window_ms = (days as i64).saturating_mul(86_400_000);
    let cutoff = now_ms.saturating_sub(window_ms);

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        match parse_entry_line(t) {
            Some(e) => match entry_ts_ms(&e) {
                Some(ms) if ms < cutoff => {
                    dropped = dropped.saturating_add(1);
                }
                _ => {
                    // In-window or unparseable ts: keep (re-serialize redacted).
                    if let Ok(s) = serde_json::to_string(&e) {
                        kept_lines.push(crate::store::redact_text(&s));
                        kept_entries = kept_entries.saturating_add(1);
                    }
                }
            },
            None => {
                // Corrupt line: drop (never re-export junk that might hold secrets).
                dropped = dropped.saturating_add(1);
            }
        }
    }

    if dropped == 0 {
        return Ok(0);
    }

    let tmp = path.with_extension("jsonl.tmp");
    {
        let mut out = File::create(&tmp).map_err(|e| format!("prune create: {e}"))?;
        for l in &kept_lines {
            out.write_all(l.as_bytes())
                .map_err(|e| format!("prune write: {e}"))?;
            out.write_all(b"\n")
                .map_err(|e| format!("prune write nl: {e}"))?;
        }
        out.flush().map_err(|e| format!("prune flush: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("prune rename: {e}"))?;
    tracing::info!(
        target: "grok_app::audit_ledger",
        kept = kept_entries,
        dropped,
        days,
        "pruned tool ledger by retention"
    );
    Ok(dropped)
}

/// Record a permission decision (user or auto). Soft-fail.
pub fn record_permission(
    session_id: Option<&str>,
    project_path: Option<&str>,
    tool_name: &str,
    decision: &str,
    summary: Option<&str>,
) {
    let entry = build_entry(
        session_id,
        project_path,
        tool_name,
        EVENT_PERMISSION,
        Some(decision),
        None,
        summary,
    );
    append_entry(&entry);
}

/// Record permission using remembered UI context for `rpc_id` when available.
pub fn record_permission_resolve(
    session_id: Option<&str>,
    project_path: Option<&str>,
    rpc_id: u64,
    decision: &str,
) {
    let pending = session_id.and_then(|sid| take_permission(sid, rpc_id));
    let (tool_name, summary) = match pending {
        Some(p) => (
            p.tool_name,
            if p.summary.is_empty() {
                None
            } else {
                Some(p.summary)
            },
        ),
        None => ("unknown".into(), None),
    };
    record_permission(
        session_id,
        project_path,
        &tool_name,
        decision,
        summary.as_deref(),
    );
}

/// Record tool start (non-terminal status, first open). Soft-fail.
pub fn record_tool_start(
    session_id: Option<&str>,
    project_path: Option<&str>,
    tool_name: &str,
    summary: Option<&str>,
) {
    let entry = build_entry(
        session_id,
        project_path,
        tool_name,
        EVENT_TOOL_START,
        None,
        None,
        summary,
    );
    append_entry(&entry);
}

/// Record tool end with ok/err outcome. Soft-fail.
pub fn record_tool_end(
    session_id: Option<&str>,
    project_path: Option<&str>,
    tool_name: &str,
    outcome: &str,
    summary: Option<&str>,
) {
    let entry = build_entry(
        session_id,
        project_path,
        tool_name,
        EVENT_TOOL_END,
        None,
        Some(outcome),
        summary,
    );
    append_entry(&entry);
}

/// Parse one JSONL line into an entry (pure; used by list + tests).
pub fn parse_entry_line(line: &str) -> Option<AuditLedgerEntry> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(t).ok()?;
    parse_entry_value(&v)
}

/// Normalize a JSON object into a safe entry (drops junk / secrets-ish fields).
pub fn parse_entry_value(v: &serde_json::Value) -> Option<AuditLedgerEntry> {
    let o = v.as_object()?;
    let event = o
        .get("event")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    // Only known events
    if !matches!(
        event.as_str(),
        EVENT_PERMISSION | EVENT_TOOL_START | EVENT_TOOL_END
    ) {
        return None;
    }
    let tool_name = o
        .get("toolName")
        .or_else(|| o.get("tool_name"))
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into());
    let ts = o
        .get("ts")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let session_id = o
        .get("sessionId")
        .or_else(|| o.get("session_id"))
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let project_path = o
        .get("projectPath")
        .or_else(|| o.get("project_path"))
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, 512))
        .filter(|s| !s.is_empty());
    let permission = o
        .get("permission")
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let outcome = o
        .get("outcome")
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, MAX_FIELD_CHARS))
        .filter(|s| !s.is_empty());
    let summary = o
        .get("summary")
        .and_then(|x| x.as_str())
        .map(|s| sanitize_field(s, MAX_SUMMARY_CHARS))
        .filter(|s| !s.is_empty());

    Some(AuditLedgerEntry {
        ts,
        session_id,
        project_path,
        tool_name,
        event,
        permission,
        outcome,
        summary,
    })
}

/// Read recent entries (newest first). Soft-fail → empty vec.
pub fn list_recent(limit: Option<u32>) -> Vec<AuditLedgerEntry> {
    let lim = normalize_list_limit(limit);
    let _guard = WRITE_LOCK.lock();
    match list_recent_locked(lim) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(target: "grok_app::audit_ledger", "list failed: {e}");
            Vec::new()
        }
    }
}

fn list_recent_locked(limit: usize) -> Result<Vec<AuditLedgerEntry>, String> {
    let path = ledger_path();
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file = File::open(&path).map_err(|e| format!("open: {e}"))?;
    let reader = BufReader::new(file);
    let mut entries: Vec<AuditLedgerEntry> = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { continue };
        if let Some(e) = parse_entry_line(&line) {
            entries.push(e);
        }
    }
    // Newest first
    entries.reverse();
    if entries.len() > limit {
        entries.truncate(limit);
    }
    Ok(entries)
}

/// Clear the ledger file. Soft-fail → Err string for UI toast.
pub fn clear_ledger() -> Result<(), String> {
    let _guard = WRITE_LOCK.lock();
    let path = ledger_path();
    if path.is_file() {
        fs::write(&path, b"").map_err(|e| format!("clear: {e}"))?;
    }
    if let Ok(mut map) = PENDING_PERMS.lock() {
        map.clear();
    }
    Ok(())
}

/// Export redacted JSONL text (file order = chronological). Soft-fail → empty string.
#[allow(dead_code)]
pub fn export_redacted_jsonl() -> String {
    export_redacted_jsonl_filtered(&AuditLedgerFilter::default())
}

/// Export redacted JSONL with optional event / session / date-range filter.
/// Soft-fail → empty string. Never emits unsanitized lines.
pub fn export_redacted_jsonl_filtered(filter: &AuditLedgerFilter) -> String {
    let _guard = WRITE_LOCK.lock();
    let path = ledger_path();
    if !path.is_file() {
        return String::new();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let mut entries = Vec::new();
            for line in raw.lines() {
                if let Some(e) = parse_entry_line(line) {
                    entries.push(e);
                }
            }
            let filtered = filter_entries(entries, filter);
            let mut out = String::new();
            for e in filtered {
                if let Ok(s) = serde_json::to_string(&e) {
                    out.push_str(&crate::store::redact_text(&s));
                    out.push('\n');
                }
            }
            out
        }
        Err(e) => {
            tracing::warn!(target: "grok_app::audit_ledger", "export read failed: {e}");
            String::new()
        }
    }
}

include!("audit_ledger_tests_ext.rs");
