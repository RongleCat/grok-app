//! Memory embedding config — allowlisted read/write of Grok Build 0.2.117
//! `[memory.*]` keys in the active `GROK_HOME` `config.toml`.
//!
//! ## Allowlist (soft-fail when missing)
//! - `[memory.embedding]` model / dimensions / provider
//! - `[memory.search]` max_results / min_score / vector_weight / text_weight
//! - `[memory.search.mmr]` enabled / lambda
//! - `[memory.search.temporal_decay]` enabled / half_life_days
//! - `[memory.dream]` enabled / min_hours / min_sessions / check_interval_secs
//! - `[memory.watcher]` enabled
//! - `[memory.initial_injection]` enabled / min_score
//!
//! ## Honesty
//! - Missing keys stay `None` (never invent CLI defaults as “configured”).
//! - Unset `embedding.model` means **vector search is off** (CLI hybrid falls
//!   back to keyword / full-text only).
//! - App `memory_search` is always a path-scoped **keyword** file scan — it
//!   never runs embeddings client-side.
//! - Writes are path-scoped to independent agent-home only (never `~/.grok`).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::agent_config_edit::{
    is_agent_home_config_path, parse_toml_bool, parse_toml_scalar, require_agent_home_config_path,
    set_table_key,
};
use crate::agent_config_view::{config_toml_path, normalize_mode};
use crate::paths::{agent_config_toml, agent_home_dir, ensure_app_dirs, resolve_agent_grok_home};
use crate::store;

/// Hard cap on bytes read before parse.
pub const MAX_MEMORY_EMBED_CONFIG_BYTES: u64 = 256 * 1024;

/// Snapshot of memory-embedding allowlisted keys for Settings UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbedConfigSnapshot {
    pub path: String,
    pub grok_home: String,
    /// `independent` | `shared`
    pub mode: String,
    /// True only when mode is independent (edits apply to App agent-home).
    pub writable: bool,
    pub file_exists: bool,
    /// Derived: non-empty `[memory.embedding].model`.
    pub embedding_configured: bool,
    /// App host search mode is always keyword (never embed client-side).
    pub app_search_mode: String,
    /// CLI tool search mode when embedding is configured vs not.
    pub cli_search_mode: String,
    // --- embedding ---
    pub embedding_model: Option<String>,
    pub embedding_dimensions: Option<u32>,
    pub embedding_provider: Option<String>,
    // --- search ---
    pub search_max_results: Option<u32>,
    pub search_min_score: Option<f64>,
    pub search_vector_weight: Option<f64>,
    pub search_text_weight: Option<f64>,
    // --- mmr ---
    pub mmr_enabled: Option<bool>,
    pub mmr_lambda: Option<f64>,
    // --- temporal decay ---
    pub temporal_decay_enabled: Option<bool>,
    pub temporal_decay_half_life_days: Option<f64>,
    // --- dream ---
    pub dream_enabled: Option<bool>,
    pub dream_min_hours: Option<f64>,
    pub dream_min_sessions: Option<u32>,
    pub dream_check_interval_secs: Option<u64>,
    // --- watcher / initial injection ---
    pub watcher_enabled: Option<bool>,
    pub initial_injection_enabled: Option<bool>,
    pub initial_injection_min_score: Option<f64>,
    /// Redacted preview of allowlisted memory tables only.
    pub redacted_preview: String,
}

/// Partial patch for allowlisted memory embedding keys. `None` = leave unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbedConfigPatch {
    pub embedding_model: Option<String>,
    /// When true, remove `[memory.embedding].model` (unset → embeddings off).
    pub clear_embedding_model: Option<bool>,
    pub embedding_dimensions: Option<u32>,
    pub embedding_provider: Option<String>,
    pub search_max_results: Option<u32>,
    pub search_min_score: Option<f64>,
    pub search_vector_weight: Option<f64>,
    pub search_text_weight: Option<f64>,
    pub mmr_enabled: Option<bool>,
    pub mmr_lambda: Option<f64>,
    pub temporal_decay_enabled: Option<bool>,
    pub temporal_decay_half_life_days: Option<f64>,
    pub dream_enabled: Option<bool>,
    pub dream_min_hours: Option<f64>,
    pub dream_min_sessions: Option<u32>,
    pub dream_check_interval_secs: Option<u64>,
    pub watcher_enabled: Option<bool>,
    pub initial_injection_enabled: Option<bool>,
    pub initial_injection_min_score: Option<f64>,
}

impl MemoryEmbedConfigPatch {
    pub fn is_empty(&self) -> bool {
        self.embedding_model.is_none()
            && self.clear_embedding_model != Some(true)
            && self.embedding_dimensions.is_none()
            && self.embedding_provider.is_none()
            && self.search_max_results.is_none()
            && self.search_min_score.is_none()
            && self.search_vector_weight.is_none()
            && self.search_text_weight.is_none()
            && self.mmr_enabled.is_none()
            && self.mmr_lambda.is_none()
            && self.temporal_decay_enabled.is_none()
            && self.temporal_decay_half_life_days.is_none()
            && self.dream_enabled.is_none()
            && self.dream_min_hours.is_none()
            && self.dream_min_sessions.is_none()
            && self.dream_check_interval_secs.is_none()
            && self.watcher_enabled.is_none()
            && self.initial_injection_enabled.is_none()
            && self.initial_injection_min_score.is_none()
    }
}

/// Parsed allowlisted memory embedding flags (all optional — soft-fail missing).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MemoryEmbedFlags {
    pub embedding_model: Option<String>,
    pub embedding_dimensions: Option<u32>,
    pub embedding_provider: Option<String>,
    pub search_max_results: Option<u32>,
    pub search_min_score: Option<f64>,
    pub search_vector_weight: Option<f64>,
    pub search_text_weight: Option<f64>,
    pub mmr_enabled: Option<bool>,
    pub mmr_lambda: Option<f64>,
    pub temporal_decay_enabled: Option<bool>,
    pub temporal_decay_half_life_days: Option<f64>,
    pub dream_enabled: Option<bool>,
    pub dream_min_hours: Option<f64>,
    pub dream_min_sessions: Option<u32>,
    pub dream_check_interval_secs: Option<u64>,
    pub watcher_enabled: Option<bool>,
    pub initial_injection_enabled: Option<bool>,
    pub initial_injection_min_score: Option<f64>,
}

fn parse_toml_u32(raw: &str) -> Option<u32> {
    let s = parse_toml_scalar(raw);
    s.parse::<u32>().ok()
}

fn parse_toml_u64(raw: &str) -> Option<u64> {
    let s = parse_toml_scalar(raw);
    s.parse::<u64>().ok()
}

fn parse_toml_f64(raw: &str) -> Option<f64> {
    let s = parse_toml_scalar(raw);
    let v: f64 = s.parse().ok()?;
    if v.is_finite() {
        Some(v)
    } else {
        None
    }
}

fn format_f64(v: f64) -> String {
    // Prefer compact TOML-friendly rendering (avoid scientific noise).
    if (v - v.round()).abs() < 1e-12 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        let s = format!("{v}");
        if s.contains('.') || s.contains('e') || s.contains('E') {
            s
        } else {
            format!("{v:.6}")
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_string()
        }
    }
}

/// Extract allowlisted memory embedding keys from full config text (pure).
pub fn parse_memory_embed_flags(text: &str) -> MemoryEmbedFlags {
    let mut flags = MemoryEmbedFlags::default();
    let mut table = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            table = trimmed
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string();
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let val = trimmed[eq + 1..].trim();
        match (table.as_str(), key) {
            ("memory.embedding", "model") => {
                let s = parse_toml_scalar(val);
                if !s.is_empty() {
                    flags.embedding_model = Some(s);
                }
            }
            ("memory.embedding", "dimensions") => {
                if let Some(n) = parse_toml_u32(val) {
                    flags.embedding_dimensions = Some(n);
                }
            }
            ("memory.embedding", "provider") => {
                let s = parse_toml_scalar(val);
                if !s.is_empty() {
                    flags.embedding_provider = Some(s);
                }
            }
            ("memory.search", "max_results") => {
                if let Some(n) = parse_toml_u32(val) {
                    flags.search_max_results = Some(n);
                }
            }
            ("memory.search", "min_score") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.search_min_score = Some(n);
                }
            }
            ("memory.search", "vector_weight") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.search_vector_weight = Some(n);
                }
            }
            ("memory.search", "text_weight") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.search_text_weight = Some(n);
                }
            }
            ("memory.search.mmr", "enabled") => {
                if let Some(b) = parse_toml_bool(val) {
                    flags.mmr_enabled = Some(b);
                }
            }
            ("memory.search.mmr", "lambda") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.mmr_lambda = Some(n);
                }
            }
            ("memory.search.temporal_decay", "enabled") => {
                if let Some(b) = parse_toml_bool(val) {
                    flags.temporal_decay_enabled = Some(b);
                }
            }
            ("memory.search.temporal_decay", "half_life_days") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.temporal_decay_half_life_days = Some(n);
                }
            }
            ("memory.dream", "enabled") => {
                if let Some(b) = parse_toml_bool(val) {
                    flags.dream_enabled = Some(b);
                }
            }
            ("memory.dream", "min_hours") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.dream_min_hours = Some(n);
                }
            }
            ("memory.dream", "min_sessions") => {
                if let Some(n) = parse_toml_u32(val) {
                    flags.dream_min_sessions = Some(n);
                }
            }
            ("memory.dream", "check_interval_secs") => {
                if let Some(n) = parse_toml_u64(val) {
                    flags.dream_check_interval_secs = Some(n);
                }
            }
            ("memory.watcher", "enabled") => {
                if let Some(b) = parse_toml_bool(val) {
                    flags.watcher_enabled = Some(b);
                }
            }
            ("memory.initial_injection", "enabled") => {
                if let Some(b) = parse_toml_bool(val) {
                    flags.initial_injection_enabled = Some(b);
                }
            }
            ("memory.initial_injection", "min_score") => {
                if let Some(n) = parse_toml_f64(val) {
                    flags.initial_injection_min_score = Some(n);
                }
            }
            _ => {}
        }
    }

    flags
}

/// Remove `key` under `[table]` if present (pure). Leaves other sections intact.
pub fn remove_table_key(text: &str, table: &str, key: &str) -> String {
    let header = format!("[{table}]");
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_table = false;
    let mut remove_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_table = trimmed == header;
            continue;
        }
        if in_table {
            let key_part = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key_part == key {
                remove_idx = Some(i);
                break;
            }
        }
    }
    if let Some(i) = remove_idx {
        lines.remove(i);
    }
    let mut joined = lines.join("\n");
    if text.ends_with('\n') && !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// Apply an allowlisted memory-embed patch onto TOML text (pure).
pub fn apply_memory_embed_patch(text: &str, patch: &MemoryEmbedConfigPatch) -> String {
    let mut next = text.to_string();

    if patch.clear_embedding_model == Some(true) {
        next = remove_table_key(&next, "memory.embedding", "model");
    } else if let Some(ref model) = patch.embedding_model {
        let m = model.trim();
        if m.is_empty() {
            next = remove_table_key(&next, "memory.embedding", "model");
        } else {
            next = set_table_key(&next, "memory.embedding", "model", m, true);
        }
    }
    if let Some(d) = patch.embedding_dimensions {
        next = set_table_key(
            &next,
            "memory.embedding",
            "dimensions",
            &d.to_string(),
            false,
        );
    }
    if let Some(ref p) = patch.embedding_provider {
        let s = p.trim();
        if !s.is_empty() {
            next = set_table_key(&next, "memory.embedding", "provider", s, true);
        }
    }
    if let Some(n) = patch.search_max_results {
        next = set_table_key(&next, "memory.search", "max_results", &n.to_string(), false);
    }
    if let Some(n) = patch.search_min_score {
        next = set_table_key(&next, "memory.search", "min_score", &format_f64(n), false);
    }
    if let Some(n) = patch.search_vector_weight {
        next = set_table_key(
            &next,
            "memory.search",
            "vector_weight",
            &format_f64(n),
            false,
        );
    }
    if let Some(n) = patch.search_text_weight {
        next = set_table_key(&next, "memory.search", "text_weight", &format_f64(n), false);
    }
    if let Some(b) = patch.mmr_enabled {
        next = set_table_key(
            &next,
            "memory.search.mmr",
            "enabled",
            if b { "true" } else { "false" },
            false,
        );
    }
    if let Some(n) = patch.mmr_lambda {
        next = set_table_key(&next, "memory.search.mmr", "lambda", &format_f64(n), false);
    }
    if let Some(b) = patch.temporal_decay_enabled {
        next = set_table_key(
            &next,
            "memory.search.temporal_decay",
            "enabled",
            if b { "true" } else { "false" },
            false,
        );
    }
    if let Some(n) = patch.temporal_decay_half_life_days {
        next = set_table_key(
            &next,
            "memory.search.temporal_decay",
            "half_life_days",
            &format_f64(n),
            false,
        );
    }
    if let Some(b) = patch.dream_enabled {
        next = set_table_key(
            &next,
            "memory.dream",
            "enabled",
            if b { "true" } else { "false" },
            false,
        );
    }
    if let Some(n) = patch.dream_min_hours {
        next = set_table_key(&next, "memory.dream", "min_hours", &format_f64(n), false);
    }
    if let Some(n) = patch.dream_min_sessions {
        next = set_table_key(&next, "memory.dream", "min_sessions", &n.to_string(), false);
    }
    if let Some(n) = patch.dream_check_interval_secs {
        next = set_table_key(
            &next,
            "memory.dream",
            "check_interval_secs",
            &n.to_string(),
            false,
        );
    }
    if let Some(b) = patch.watcher_enabled {
        next = set_table_key(
            &next,
            "memory.watcher",
            "enabled",
            if b { "true" } else { "false" },
            false,
        );
    }
    if let Some(b) = patch.initial_injection_enabled {
        next = set_table_key(
            &next,
            "memory.initial_injection",
            "enabled",
            if b { "true" } else { "false" },
            false,
        );
    }
    if let Some(n) = patch.initial_injection_min_score {
        next = set_table_key(
            &next,
            "memory.initial_injection",
            "min_score",
            &format_f64(n),
            false,
        );
    }
    next
}

/// Extract only memory-related tables for preview (document order).
pub fn extract_memory_embed_sections(text: &str) -> String {
    let mut out = String::new();
    let mut keep = false;
    let mut any = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let name = trimmed.trim_start_matches('[').trim_end_matches(']');
            keep = name == "memory" || name.starts_with("memory.");
            if keep {
                if any {
                    out.push('\n');
                }
                any = true;
                out.push_str(trimmed);
                out.push('\n');
            }
            continue;
        }
        if keep {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn read_config_text(path: &Path) -> (String, bool) {
    if !path.is_file() {
        return (String::new(), false);
    }
    let meta_len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let truncated = meta_len > MAX_MEMORY_EMBED_CONFIG_BYTES;
    match fs::read(path) {
        Ok(bytes) => {
            let slice = if bytes.len() as u64 > MAX_MEMORY_EMBED_CONFIG_BYTES {
                &bytes[..MAX_MEMORY_EMBED_CONFIG_BYTES as usize]
            } else {
                &bytes
            };
            let mut s = String::from_utf8_lossy(slice).into_owned();
            if truncated {
                s.push_str("\n# … [truncated] …\n");
            }
            (s, true)
        }
        Err(_) => (String::new(), false),
    }
}

fn snapshot_from_raw(
    path: &Path,
    home: &Path,
    mode: &str,
    raw: &str,
    exists: bool,
) -> MemoryEmbedConfigSnapshot {
    let flags = parse_memory_embed_flags(raw);
    let embedding_configured = flags
        .embedding_model
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let preview = crate::agent_config_edit::redact_config_text(&extract_memory_embed_sections(raw));
    MemoryEmbedConfigSnapshot {
        path: path.to_string_lossy().to_string(),
        grok_home: home.to_string_lossy().to_string(),
        mode: mode.to_string(),
        writable: mode == "independent",
        file_exists: exists,
        embedding_configured,
        app_search_mode: "keyword".into(),
        cli_search_mode: if embedding_configured {
            "hybrid".into()
        } else {
            "keyword".into()
        },
        embedding_model: flags.embedding_model,
        embedding_dimensions: flags.embedding_dimensions,
        embedding_provider: flags.embedding_provider,
        search_max_results: flags.search_max_results,
        search_min_score: flags.search_min_score,
        search_vector_weight: flags.search_vector_weight,
        search_text_weight: flags.search_text_weight,
        mmr_enabled: flags.mmr_enabled,
        mmr_lambda: flags.mmr_lambda,
        temporal_decay_enabled: flags.temporal_decay_enabled,
        temporal_decay_half_life_days: flags.temporal_decay_half_life_days,
        dream_enabled: flags.dream_enabled,
        dream_min_hours: flags.dream_min_hours,
        dream_min_sessions: flags.dream_min_sessions,
        dream_check_interval_secs: flags.dream_check_interval_secs,
        watcher_enabled: flags.watcher_enabled,
        initial_injection_enabled: flags.initial_injection_enabled,
        initial_injection_min_score: flags.initial_injection_min_score,
        redacted_preview: preview,
    }
}

/// Load memory-embed snapshot for the active session data mode.
///
/// Soft-fails: missing file / missing keys → empty / `None` fields, never error.
pub fn load_memory_embed_config() -> Result<MemoryEmbedConfigSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode == "independent" {
        let _ = ensure_app_dirs();
    }
    let path = config_toml_path(mode);
    let home = resolve_agent_grok_home(mode);
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, mode, &raw, exists))
}

/// Apply allowlisted memory-embed patch to agent-home config.toml. Shared mode refused.
pub fn save_memory_embed_config(
    patch: &MemoryEmbedConfigPatch,
) -> Result<MemoryEmbedConfigSnapshot, String> {
    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    if mode != "independent" {
        return Err(
            "shared session mode: agent-home config.toml is not the live GROK_HOME; switch to independent to edit memory embedding keys"
                .into(),
        );
    }

    if patch.is_empty() {
        return load_memory_embed_config();
    }

    // Validate numeric ranges lightly (honest clamp, not silent invent).
    if let Some(d) = patch.embedding_dimensions {
        if d == 0 || d > 16_384 {
            return Err(format!(
                "embedding.dimensions out of range: {d} (expected 1–16384)"
            ));
        }
    }
    if let Some(n) = patch.search_max_results {
        if n == 0 || n > 100 {
            return Err(format!(
                "search.max_results out of range: {n} (expected 1–100)"
            ));
        }
    }
    for (label, v) in [
        ("search.min_score", patch.search_min_score),
        ("search.vector_weight", patch.search_vector_weight),
        ("search.text_weight", patch.search_text_weight),
        ("mmr.lambda", patch.mmr_lambda),
        (
            "temporal_decay.half_life_days",
            patch.temporal_decay_half_life_days,
        ),
        ("dream.min_hours", patch.dream_min_hours),
        (
            "initial_injection.min_score",
            patch.initial_injection_min_score,
        ),
    ] {
        if let Some(n) = v {
            if !n.is_finite() || n < 0.0 {
                return Err(format!("{label} must be a finite number ≥ 0 (got {n})"));
            }
        }
    }
    if let Some(n) = patch.mmr_lambda {
        if n > 1.0 {
            return Err(format!("mmr.lambda must be ≤ 1.0 (got {n})"));
        }
    }

    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    require_agent_home_config_path(&path)?;
    if !is_agent_home_config_path(&path) {
        return Err(format!(
            "path not allowed: only agent-home config.toml may be edited ({})",
            path.display()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create agent-home: {e}"))?;
    }

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = apply_memory_embed_patch(&existing, patch);
    fs::write(&path, &next).map_err(|e| format!("write config: {e}"))?;

    tracing::info!(
        path = %path.display(),
        embedding_model = ?patch.embedding_model,
        clear_model = ?patch.clear_embedding_model,
        mmr = ?patch.mmr_enabled,
        dream = ?patch.dream_enabled,
        "agent_memory_embed: saved allowlisted memory embedding keys"
    );

    let home = agent_home_dir();
    let (raw, exists) = read_config_text(&path);
    Ok(snapshot_from_raw(&path, &home, "independent", &raw, exists))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_home(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "grok-mem-embed-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parse_missing_keys_are_none() {
        let flags = parse_memory_embed_flags("[ui]\nyolo = true\n");
        assert_eq!(flags, MemoryEmbedFlags::default());
    }

    #[test]
    fn parse_allowlisted_nested_memory_keys() {
        let text = r#"
[memory]
enabled = true

[memory.embedding]
model = "text-embedding-3-small"
dimensions = 1024
provider = "api"

[memory.search]
max_results = 8
min_score = 0.35
vector_weight = 0.7
text_weight = 0.3

[memory.search.mmr]
enabled = true
lambda = 0.7

[memory.search.temporal_decay]
enabled = true
half_life_days = 7.0

[memory.dream]
enabled = false
min_hours = 4
min_sessions = 3
check_interval_secs = 3600

[memory.watcher]
enabled = true

[memory.initial_injection]
enabled = true
min_score = 0.0

[model.x]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"
"#;
        let flags = parse_memory_embed_flags(text);
        assert_eq!(
            flags.embedding_model.as_deref(),
            Some("text-embedding-3-small")
        );
        assert_eq!(flags.embedding_dimensions, Some(1024));
        assert_eq!(flags.embedding_provider.as_deref(), Some("api"));
        assert_eq!(flags.search_max_results, Some(8));
        assert_eq!(flags.search_min_score, Some(0.35));
        assert_eq!(flags.mmr_enabled, Some(true));
        assert_eq!(flags.mmr_lambda, Some(0.7));
        assert_eq!(flags.temporal_decay_enabled, Some(true));
        assert_eq!(flags.dream_enabled, Some(false));
        assert_eq!(flags.dream_min_sessions, Some(3));
        assert_eq!(flags.watcher_enabled, Some(true));
        assert_eq!(flags.initial_injection_enabled, Some(true));
    }

    #[test]
    fn apply_patch_sets_nested_tables_and_clears_model() {
        let existing = r#"
[models]
default = "grok"

[memory.embedding]
model = "old-model"
dimensions = 512
"#;
        let next = apply_memory_embed_patch(
            existing,
            &MemoryEmbedConfigPatch {
                clear_embedding_model: Some(true),
                embedding_dimensions: Some(1024),
                mmr_enabled: Some(true),
                mmr_lambda: Some(0.7),
                search_min_score: Some(0.4),
                dream_enabled: Some(false),
                ..Default::default()
            },
        );
        assert!(next.contains("[models]"), "{next}");
        assert!(next.contains("default = \"grok\""), "{next}");
        assert!(!next.contains("old-model"), "{next}");
        assert!(next.contains("dimensions = 1024"), "{next}");
        assert!(next.contains("[memory.search.mmr]"), "{next}");
        assert!(next.contains("enabled = true"), "{next}");
        assert!(
            next.contains("lambda = 0.7") || next.contains("lambda = 0.700"),
            "{next}"
        );
        assert!(next.contains("[memory.search]"), "{next}");
        assert!(
            next.contains("min_score = 0.4") || next.contains("min_score = 0.40"),
            "{next}"
        );
        assert!(next.contains("[memory.dream]"), "{next}");
        assert!(next.contains("enabled = false"), "{next}");
    }

    #[test]
    fn extract_sections_keeps_memory_tables_only() {
        let text = r#"
[features]
telemetry = false

[memory.embedding]
model = "m"

[model.x]
api_key = "sk-abcdefghijklmnopqrstuvwxyz0123"
"#;
        let preview = extract_memory_embed_sections(text);
        assert!(preview.contains("[memory.embedding]"));
        assert!(preview.contains("model = \"m\""));
        assert!(!preview.contains("[features]"));
        assert!(!preview.contains("[model.x]"));
        assert!(!preview.contains("sk-"));
    }

    #[test]
    fn load_and_save_roundtrip_independent() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("roundtrip");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);

        let _ = ensure_app_dirs();
        let mut s = store::load_settings();
        s.session_data_mode = "independent".into();
        store::save_settings(&s).unwrap();

        let snap = load_memory_embed_config().unwrap();
        assert!(snap.writable);
        assert!(snap.path.contains("agent-home"));
        assert!(!snap.embedding_configured);
        assert_eq!(snap.app_search_mode, "keyword");
        assert_eq!(snap.cli_search_mode, "keyword");
        assert_eq!(snap.embedding_model, None);

        let saved = save_memory_embed_config(&MemoryEmbedConfigPatch {
            embedding_model: Some("text-embedding-3-small".into()),
            embedding_dimensions: Some(1024),
            search_max_results: Some(6),
            search_min_score: Some(0.35),
            mmr_enabled: Some(false),
            dream_enabled: Some(true),
            dream_min_sessions: Some(3),
            watcher_enabled: Some(true),
            ..Default::default()
        })
        .unwrap();
        assert!(saved.embedding_configured);
        assert_eq!(saved.cli_search_mode, "hybrid");
        assert_eq!(
            saved.embedding_model.as_deref(),
            Some("text-embedding-3-small")
        );
        assert_eq!(saved.embedding_dimensions, Some(1024));
        assert_eq!(saved.mmr_enabled, Some(false));
        assert!(saved.file_exists);

        let cleared = save_memory_embed_config(&MemoryEmbedConfigPatch {
            clear_embedding_model: Some(true),
            ..Default::default()
        })
        .unwrap();
        assert!(!cleared.embedding_configured);
        assert_eq!(cleared.cli_search_mode, "keyword");
        assert_eq!(cleared.embedding_model, None);

        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn save_refuses_shared_mode() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = temp_app_home("shared");
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let mut s = store::load_settings();
        s.session_data_mode = "shared".into();
        store::save_settings(&s).unwrap();

        let err = save_memory_embed_config(&MemoryEmbedConfigPatch {
            mmr_enabled: Some(true),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.contains("shared"), "{err}");

        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
    }
}
