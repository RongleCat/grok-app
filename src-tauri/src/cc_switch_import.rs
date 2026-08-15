//! Import custom Grok Build providers from **CC Switch** (farion1231/cc-switch).
//!
//! CC Switch stores providers in SQLite (`app_type = 'grokbuild'`) under
//! `{home}/.cc-switch/` (all platforms). Optional custom root lives in Tauri
//! Store `app_paths.json` (`com.ccswitch.desktop`). Windows also has a legacy
//! `HOME/.cc-switch` fallback when Profile `.cc-switch` has no db.
//!
//! We only **read** the database; writes go through [`crate::providers`].

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::process_util;
use crate::providers::{self, UpsertProviderInput};

const DB_NAME: &str = "cc-switch.db";
const STORE_APP_ID: &str = "com.ccswitch.desktop";
const STORE_FILE: &str = "app_paths.json";
const STORE_KEY_OVERRIDE: &str = "app_config_dir_override";
const ENV_DIR: &str = "GROK_APP_CC_SWITCH_DIR";
const ENV_HOME_ALT: &str = "CC_SWITCH_HOME";

// ── Public types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchScanResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_path: Option<String>,
    pub tried_paths: Vec<String>,
    pub items: Vec<CcSwitchProviderPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProviderPreview {
    /// CC Switch `providers.id` (UUID).
    pub source_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub is_current: bool,
    /// Suggested Grok App provider id (slug).
    pub suggested_id: String,
    pub model: String,
    pub base_url: String,
    pub api_backend: String,
    pub has_api_key: bool,
    /// Last 4 chars of key when present (no full secret).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_hint: Option<String>,
    /// `importable` | `official` | `missing_key` | `proxy_managed` | `invalid` | `exists`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchImportRequest {
    pub source_ids: Vec<String>,
    /// `skip` | `overwrite` | `rename` (default skip)
    #[serde(default)]
    pub on_conflict: Option<String>,
    /// After import, activate this suggested/final id (optional).
    #[serde(default)]
    pub activate_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub failed: Vec<CcSwitchImportFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub providers: Option<providers::ProvidersListResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchImportFailure {
    pub source_id: String,
    pub reason: String,
}

// ── Path resolution ─────────────────────────────────────────────────────────

/// Resolve candidate dirs that may contain `cc-switch.db`, in probe order.
/// Exposed for unit tests.
pub fn candidate_cc_switch_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut push = |p: PathBuf| {
        let key = normalize_path_key(&p);
        if seen.insert(key) {
            out.push(p);
        }
    };

    // 1) Env overrides
    for env in [ENV_DIR, ENV_HOME_ALT] {
        if let Ok(raw) = std::env::var(env) {
            let t = raw.trim();
            if !t.is_empty() {
                push(PathBuf::from(t));
            }
        }
    }

    // 2) Tauri store override (com.ccswitch.desktop / app_paths.json)
    if let Some(dir) = read_app_paths_override() {
        push(dir);
    }

    // 3) Default: {home}/.cc-switch
    let home = process_util::user_home();
    push(home.join(".cc-switch"));

    // 4) Windows legacy: HOME env when different from Profile and has db
    #[cfg(target_os = "windows")]
    {
        if let Ok(home_env) = std::env::var("HOME") {
            let trimmed = home_env.trim();
            if !trimmed.is_empty() {
                let legacy = PathBuf::from(trimmed).join(".cc-switch");
                push(legacy);
            }
        }
    }

    out
}

/// First existing `cc-switch.db` among candidates, plus all tried absolute paths.
pub fn resolve_cc_switch_db() -> (Option<PathBuf>, Vec<String>) {
    let candidates = candidate_cc_switch_dirs();
    let mut tried = Vec::new();
    for dir in candidates {
        let db = dir.join(DB_NAME);
        tried.push(db.display().to_string());
        if db.is_file() {
            // Windows legacy preference: prefer Profile default if both exist
            // (candidate order already puts Profile before HOME unless override).
            return (Some(db), tried);
        }
    }
    (None, tried)
}

fn normalize_path_key(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('\\', "/");
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }
    #[cfg(windows)]
    {
        key = key.to_ascii_lowercase();
    }
    key
}

/// Read `app_config_dir_override` from CC Switch Tauri store.
fn read_app_paths_override() -> Option<PathBuf> {
    let store_path = cc_switch_store_path()?;
    let text = fs::read_to_string(&store_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    // tauri-plugin-store may wrap values; try common shapes.
    let raw = extract_store_string(&v, STORE_KEY_OVERRIDE)?;
    let path = expand_user_path(&raw);
    if path.is_dir() || path.join(DB_NAME).is_file() {
        // Override may point at the config dir (contains db) or rarely the db parent.
        if path.join(DB_NAME).is_file() {
            return Some(path);
        }
        if path.is_file() && path.file_name().and_then(|s| s.to_str()) == Some(DB_NAME) {
            return path.parent().map(|p| p.to_path_buf());
        }
        if path.is_dir() {
            return Some(path);
        }
    }
    None
}

fn extract_store_string(root: &serde_json::Value, key: &str) -> Option<String> {
    // Flat: { "app_config_dir_override": "..." }
    if let Some(s) = root.get(key).and_then(|v| v.as_str()) {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    // Nested plugin shape: { "app_config_dir_override": { "value": "..." } }
    if let Some(s) = root
        .get(key)
        .and_then(|v| v.get("value"))
        .and_then(|v| v.as_str())
    {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

/// Platform path for Tauri plugin-store file of CC Switch.
fn cc_switch_store_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = process_util::user_home();
        Some(
            home.join("Library/Application Support")
                .join(STORE_APP_ID)
                .join(STORE_FILE),
        )
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Some(PathBuf::from(appdata).join(STORE_APP_ID).join(STORE_FILE));
        }
        return Some(
            process_util::user_home()
                .join("AppData")
                .join("Roaming")
                .join(STORE_APP_ID)
                .join(STORE_FILE),
        );
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            let t = xdg.trim();
            if !t.is_empty() {
                return Some(PathBuf::from(t).join(STORE_APP_ID).join(STORE_FILE));
            }
        }
        Some(
            process_util::user_home()
                .join(".local")
                .join("share")
                .join(STORE_APP_ID)
                .join(STORE_FILE),
        )
    }
}

fn expand_user_path(raw: &str) -> PathBuf {
    let raw = raw.trim();
    if raw == "~" {
        return process_util::user_home();
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return process_util::user_home().join(rest);
    }
    PathBuf::from(raw)
}

// ── Scan / import ───────────────────────────────────────────────────────────

pub fn scan_cc_switch_providers() -> CcSwitchScanResult {
    let (db, tried) = resolve_cc_switch_db();
    let Some(db_path) = db else {
        return CcSwitchScanResult {
            status: "not_found".into(),
            db_path: None,
            tried_paths: tried,
            items: vec![],
            error: Some("CC Switch database not found".into()),
        };
    };

    match read_grokbuild_rows(&db_path) {
        Ok(rows) => {
            let existing = existing_provider_ids();
            let items: Vec<_> = rows
                .into_iter()
                .map(|r| row_to_preview(r, &existing))
                .collect();
            CcSwitchScanResult {
                status: "ok".into(),
                db_path: Some(db_path.display().to_string()),
                tried_paths: tried,
                items,
                error: None,
            }
        }
        Err(e) => CcSwitchScanResult {
            status: "error".into(),
            db_path: Some(db_path.display().to_string()),
            tried_paths: tried,
            items: vec![],
            error: Some(e),
        },
    }
}

pub fn import_cc_switch_providers(
    req: CcSwitchImportRequest,
) -> Result<CcSwitchImportResult, String> {
    import_cc_switch_providers_with(req, resolve_import_provider_mode)
}

fn import_cc_switch_providers_with<F>(
    req: CcSwitchImportRequest,
    mut resolve_mode: F,
) -> Result<CcSwitchImportResult, String>
where
    F: FnMut(&ParsedModel) -> Result<String, String>,
{
    // Default overwrite: re-importing the same slug updates key/base_url in place.
    let on_conflict = req
        .on_conflict
        .as_deref()
        .unwrap_or("overwrite")
        .trim()
        .to_ascii_lowercase();
    if req.source_ids.is_empty() {
        return Err("no providers selected".into());
    }

    let (db, _) = resolve_cc_switch_db();
    let db_path = db.ok_or_else(|| "CC Switch database not found".to_string())?;
    let rows = read_grokbuild_rows(&db_path)?;
    let by_id: HashMap<String, DbRow> = rows.into_iter().map(|r| (r.id.clone(), r)).collect();

    let mut imported = 0u32;
    let mut skipped = 0u32;
    let mut failed = Vec::new();
    let mut last_list = None;
    let mut existing = existing_provider_ids();

    for sid in &req.source_ids {
        let Some(row) = by_id.get(sid) else {
            failed.push(CcSwitchImportFailure {
                source_id: sid.clone(),
                reason: "provider not found in CC Switch database".into(),
            });
            continue;
        };

        let parsed = match parse_settings_config(&row.settings_config, &row.name) {
            Ok(p) => p,
            Err(e) => {
                failed.push(CcSwitchImportFailure {
                    source_id: sid.clone(),
                    reason: e,
                });
                continue;
            }
        };

        if row.category.as_deref() == Some("official") || parsed.base_url.trim().is_empty() {
            failed.push(CcSwitchImportFailure {
                source_id: sid.clone(),
                reason: "official or empty base_url cannot be imported as custom".into(),
            });
            continue;
        }

        if parsed.api_key.trim().is_empty() {
            failed.push(CcSwitchImportFailure {
                source_id: sid.clone(),
                reason: "missing api_key".into(),
            });
            continue;
        }

        if is_proxy_managed(&parsed) {
            failed.push(CcSwitchImportFailure {
                source_id: sid.clone(),
                reason: "proxy-managed config (local proxy URL or placeholder key)".into(),
            });
            continue;
        }

        let provider_mode = match resolve_mode(&parsed) {
            Ok(mode) => mode,
            Err(e) => {
                failed.push(CcSwitchImportFailure {
                    source_id: sid.clone(),
                    reason: e,
                });
                continue;
            }
        };

        let mut id = slugify_id(&row.name, &parsed.profile);
        if existing.contains(&id) {
            match on_conflict.as_str() {
                "overwrite" => {}
                "rename" => {
                    id = unique_id(&id, &existing);
                }
                _ => {
                    skipped += 1;
                    continue;
                }
            }
        }

        match providers::upsert_custom_provider(UpsertProviderInput {
            id: id.clone(),
            model: parsed.model.clone(),
            base_url: parsed.base_url.clone(),
            name: Some(parsed.name.clone()),
            api_key: Some(parsed.api_key.clone()),
            api_backend: Some(parsed.api_backend.clone()),
            provider_mode: Some(provider_mode),
            set_as_default: Some(false),
            create_only: Some(false),
            models: Some(vec![providers::ProviderModelEntry {
                id: parsed.model.clone(),
                name: if parsed.model.trim().is_empty() {
                    parsed.name.clone()
                } else {
                    parsed.model.clone()
                },
            }]),
            efforts: None,
            context_window: None,
            // Imports carry no channel rules; the user can add them per provider.
            append_prompt: None,
            // Import URLs as typed; existing /v1 suffix preserved by normalizer.
            base_url_full_path: None,
            supports_vision: None,
        }) {
            Ok(list) => {
                existing.insert(id);
                imported += 1;
                last_list = Some(list);
            }
            Err(e) => {
                failed.push(CcSwitchImportFailure {
                    source_id: sid.clone(),
                    reason: e,
                });
            }
        }
    }

    // Optional activate after import
    if let Some(act) = req
        .activate_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match providers::activate_provider("custom", Some(act)) {
            Ok(list) => last_list = Some(list),
            Err(e) => {
                failed.push(CcSwitchImportFailure {
                    source_id: act.to_string(),
                    reason: format!("imported but activate failed: {e}"),
                });
            }
        }
    }

    if last_list.is_none() {
        last_list = providers::list_custom_providers().ok();
    }

    Ok(CcSwitchImportResult {
        imported,
        skipped,
        failed,
        providers: last_list,
    })
}

// ── DB + TOML parsing ───────────────────────────────────────────────────────

struct DbRow {
    id: String,
    name: String,
    website_url: Option<String>,
    category: Option<String>,
    settings_config: String,
    is_current: bool,
}

struct ParsedModel {
    profile: String,
    model: String,
    base_url: String,
    name: String,
    api_key: String,
    api_backend: String,
    provider_mode: Option<String>,
}

fn read_grokbuild_rows(db_path: &Path) -> Result<Vec<DbRow>, String> {
    // Read-only open (no create). Prefer path form over URI for Windows drive letters.
    let conn =
        Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| {
            // Common when CC Switch holds a write lock.
            format!("open CC Switch db (read-only): {e}")
        })?;

    // Busy timeout if another process briefly locks.
    let _ = conn.busy_timeout(std::time::Duration::from_millis(1500));

    let mut stmt = conn
        .prepare(
            "SELECT id, name, website_url, category, settings_config, \
             COALESCE(is_current, 0) \
             FROM providers WHERE app_type = 'grokbuild' \
             ORDER BY sort_index IS NULL, sort_index, name",
        )
        .map_err(|e| format!("query providers: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbRow {
                id: row.get::<_, String>(0)?,
                name: row.get::<_, String>(1)?,
                website_url: row.get::<_, Option<String>>(2)?,
                category: row.get::<_, Option<String>>(3)?,
                settings_config: row.get::<_, String>(4)?,
                is_current: row.get::<_, i64>(5).unwrap_or(0) != 0,
            })
        })
        .map_err(|e| format!("query map: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

fn row_to_preview(
    row: DbRow,
    existing: &std::collections::HashSet<String>,
) -> CcSwitchProviderPreview {
    let suggested = slugify_id(&row.name, "");
    let mut preview = CcSwitchProviderPreview {
        source_id: row.id.clone(),
        name: row.name.clone(),
        website_url: row.website_url.clone(),
        category: row.category.clone(),
        is_current: row.is_current,
        suggested_id: suggested.clone(),
        model: String::new(),
        base_url: String::new(),
        api_backend: "responses".into(),
        has_api_key: false,
        key_hint: None,
        status: "invalid".into(),
        status_detail: None,
    };

    if row.category.as_deref() == Some("official") {
        preview.status = "official".into();
        preview.status_detail = Some("Official Grok login — use Account tab".into());
        return preview;
    }

    match parse_settings_config(&row.settings_config, &row.name) {
        Ok(p) => {
            preview.model = p.model.clone();
            preview.base_url = p.base_url.clone();
            preview.api_backend = p.api_backend.clone();
            preview.has_api_key = !p.api_key.is_empty();
            preview.key_hint = key_hint(&p.api_key);
            if p.base_url.trim().is_empty() {
                preview.status = "invalid".into();
                preview.status_detail = Some("missing base_url".into());
            } else if p.api_key.trim().is_empty() {
                preview.status = "missing_key".into();
                preview.status_detail = Some("missing api_key".into());
            } else if is_proxy_managed(&p) {
                preview.status = "proxy_managed".into();
                preview.status_detail = Some("local proxy takeover — import may not work".into());
            } else if existing.contains(&suggested) {
                preview.status = "exists".into();
                preview.status_detail =
                    Some(format!("id `{suggested}` already present — will overwrite"));
            } else {
                preview.status = "importable".into();
            }
        }
        Err(e) => {
            preview.status = "invalid".into();
            preview.status_detail = Some(e);
        }
    }
    preview
}

fn parse_settings_config(settings_json: &str, fallback_name: &str) -> Result<ParsedModel, String> {
    let v: serde_json::Value =
        serde_json::from_str(settings_json).map_err(|e| format!("settings_config json: {e}"))?;
    let config = v
        .get("config")
        .and_then(|c| c.as_str())
        .ok_or_else(|| "settings_config missing config string".to_string())?;
    parse_grok_toml(config, fallback_name)
}

/// Minimal TOML extract for Grok Build model tables (no full toml crate).
fn parse_grok_toml(config: &str, fallback_name: &str) -> Result<ParsedModel, String> {
    if config.trim().is_empty() {
        return Err("empty config.toml".into());
    }

    let mut default_profile: Option<String> = None;
    let mut in_models = false;
    // profile id → fields
    let mut tables: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_profile: Option<String> = None;

    for raw in config.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_models = false;
            current_profile = None;
            if line == "[models]" {
                in_models = true;
                continue;
            }
            // [model."grok-4.5"] or [model.foo]
            if let Some(rest) = line
                .strip_prefix("[model.")
                .and_then(|s| s.strip_suffix(']'))
            {
                let id = unquote_toml_key(rest);
                if !id.is_empty() {
                    current_profile = Some(id);
                }
            }
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        let val = unquote_toml_value(v.trim());
        if in_models && key == "default" {
            default_profile = Some(val);
            continue;
        }
        if let Some(ref pid) = current_profile {
            tables
                .entry(pid.clone())
                .or_default()
                .insert(key.to_string(), val);
        }
    }

    let profile = default_profile
        .filter(|p| tables.contains_key(p))
        .or_else(|| tables.keys().next().cloned())
        .ok_or_else(|| "no [model.<id>] table found".to_string())?;

    let fields = tables
        .get(&profile)
        .ok_or_else(|| format!("missing [model.\"{profile}\"]"))?;

    let model = fields
        .get("model")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| profile.clone());
    let base_url = fields.get("base_url").cloned().unwrap_or_default();
    let name = fields
        .get("name")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_name.to_string());
    let mut api_key = fields.get("api_key").cloned().unwrap_or_default();
    if api_key.is_empty() {
        if let Some(env_key) = fields
            .get("env_key")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            if let Ok(v) = std::env::var(env_key) {
                api_key = v.trim().to_string();
            }
        }
    }
    let api_backend = fields
        .get("api_backend")
        .cloned()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "responses".into());
    let provider_mode = fields
        .get("app_provider_mode")
        .cloned()
        .filter(|s| !s.trim().is_empty());

    Ok(ParsedModel {
        profile,
        model,
        base_url,
        name,
        api_key,
        api_backend,
        provider_mode,
    })
}

fn resolve_import_provider_mode(parsed: &ParsedModel) -> Result<String, String> {
    resolve_import_provider_mode_with(parsed, |base_url, api_key| {
        providers::list_remote_models_blocking(base_url, api_key)
    })
}

fn resolve_import_provider_mode_with<F>(parsed: &ParsedModel, probe: F) -> Result<String, String>
where
    F: FnOnce(&str, &str) -> Result<providers::RemoteModelsResult, String>,
{
    let explicit = parsed
        .provider_mode
        .as_deref()
        .map(|raw| providers::normalize_provider_mode(Some(raw)));
    if explicit.as_deref() == Some(providers::PROVIDER_MODE_GENERIC) {
        return Ok(providers::PROVIDER_MODE_GENERIC.into());
    }
    if providers::normalize_backend(Some(&parsed.api_backend)) != "responses" {
        if explicit.as_deref() == Some(providers::PROVIDER_MODE_GROK_BUILD_PROXY) {
            return Err("grok_build_proxy requires api_backend=responses".into());
        }
        return Ok(providers::PROVIDER_MODE_GENERIC.into());
    }

    let normalized_base =
        providers::normalize_openai_base_url(&parsed.base_url, "responses", false);
    let remote = match probe(&normalized_base, &parsed.api_key) {
        Ok(remote) => remote,
        Err(error) => {
            if explicit.as_deref() == Some(providers::PROVIDER_MODE_GROK_BUILD_PROXY) {
                return Err(format!(
                    "explicit grok_build_proxy capability check failed: {error}"
                ));
            }
            tracing::warn!(
                target: "cc_switch_import",
                "model capability probe failed; preserving generic provider semantics: {error}"
            );
            return Ok(providers::PROVIDER_MODE_GENERIC.into());
        }
    };
    let selected = [providers::ProviderModelEntry {
        id: parsed.model.clone(),
        name: parsed.model.clone(),
    }];
    match providers::validate_grok_build_proxy_models(&remote.models, &selected) {
        Ok(()) => Ok(providers::PROVIDER_MODE_GROK_BUILD_PROXY.into()),
        Err(error) if explicit.as_deref() == Some(providers::PROVIDER_MODE_GROK_BUILD_PROXY) => {
            Err(format!(
                "explicit grok_build_proxy capability check failed: {error}"
            ))
        }
        Err(_) => Ok(providers::PROVIDER_MODE_GENERIC.into()),
    }
}

fn unquote_toml_key(raw: &str) -> String {
    let t = raw.trim();
    if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

fn unquote_toml_value(raw: &str) -> String {
    let t = raw.trim();
    // strip trailing comments for simple cases: "x" # comment
    let t = if let Some(i) = t.find(" #") {
        t[..i].trim()
    } else {
        t
    };
    if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
        // basic escape
        let inner = &t[1..t.len() - 1];
        inner.replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        t.to_string()
    }
}

fn is_proxy_managed(p: &ParsedModel) -> bool {
    let key = p.api_key.trim();
    if key.eq_ignore_ascii_case("PROXY_MANAGED") || key == "proxy_managed" {
        return true;
    }
    let u = p.base_url.to_ascii_lowercase();
    u.contains("127.0.0.1:") || u.contains("localhost:")
}

fn key_hint(key: &str) -> Option<String> {
    let t = key.trim();
    if t.is_empty() {
        return None;
    }
    let tail: String = t
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    Some(format!("…{tail}"))
}

fn slugify_id(name: &str, profile: &str) -> String {
    let base = if !name.trim().is_empty() {
        name
    } else {
        profile
    };
    let id: String = base
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect();
    if id.is_empty() || !id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        "imported".into()
    } else {
        id
    }
}

fn unique_id(base: &str, existing: &std::collections::HashSet<String>) -> String {
    if !existing.contains(base) {
        return base.to_string();
    }
    for n in 2..1000 {
        let cand = format!("{base}-{n}");
        if !existing.contains(&cand) {
            return cand;
        }
    }
    format!("{base}-x")
}

fn existing_provider_ids() -> std::collections::HashSet<String> {
    providers::list_custom_providers()
        .map(|l| l.providers.into_iter().map(|p| p.id).collect())
        .unwrap_or_default()
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_amux_style_toml() {
        let toml = r#"[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://api.amux.ai/v1"
name = "Amux"
api_backend = "responses"
context_window = 500000
api_key = "sk-testkey1234"
"#;
        let p = parse_grok_toml(toml, "fallback").expect("parse");
        assert_eq!(p.profile, "grok-4.5");
        assert_eq!(p.base_url, "https://api.amux.ai/v1");
        assert_eq!(p.name, "Amux");
        assert_eq!(p.api_backend, "responses");
        assert_eq!(p.api_key, "sk-testkey1234");
        assert_eq!(p.model, "grok-4.5");
        assert_eq!(p.provider_mode, None);
    }

    #[test]
    fn parses_explicit_native_provider_mode() {
        let toml = r#"[models]
default = "grok-4.6"

[model."grok-4.6"]
model = "grok-4.6"
base_url = "https://relay.example/v1"
api_key = "runtime-key"
api_backend = "responses"
app_provider_mode = "grok_build_proxy"
"#;
        let parsed = parse_grok_toml(toml, "Relay").expect("parse");
        assert_eq!(
            parsed.provider_mode.as_deref(),
            Some(providers::PROVIDER_MODE_GROK_BUILD_PROXY)
        );
    }

    #[test]
    fn cc_switch_import_auto_promotes_live_backend_search_capability() {
        let parsed = test_parsed_model(None);
        let mode = resolve_import_provider_mode_with(&parsed, |base, key| {
            assert_eq!(base, "https://relay.example/v1");
            assert_eq!(key, "runtime-key");
            Ok(providers::RemoteModelsResult {
                endpoint: "https://relay.example/v1/models".into(),
                models: vec![providers::RemoteModel {
                    id: "grok-4.6".into(),
                    owned_by: Some("grok_build".into()),
                    supports_backend_search: Some(true),
                }],
            })
        })
        .expect("classify");
        assert_eq!(mode, providers::PROVIDER_MODE_GROK_BUILD_PROXY);
    }

    #[test]
    fn cc_switch_import_keeps_generic_without_capability_claim() {
        let parsed = test_parsed_model(None);
        let mode = resolve_import_provider_mode_with(&parsed, |_, _| {
            Ok(providers::RemoteModelsResult {
                endpoint: "https://relay.example/v1/models".into(),
                models: vec![providers::RemoteModel {
                    id: "grok-4.6".into(),
                    owned_by: None,
                    supports_backend_search: None,
                }],
            })
        })
        .expect("classify");
        assert_eq!(mode, providers::PROVIDER_MODE_GENERIC);
    }

    #[test]
    fn cc_switch_import_honors_explicit_modes() {
        let explicit_generic = test_parsed_model(Some(providers::PROVIDER_MODE_GENERIC));
        let generic = resolve_import_provider_mode_with(&explicit_generic, |_, _| {
            panic!("explicit generic must not probe")
        })
        .expect("generic");
        assert_eq!(generic, providers::PROVIDER_MODE_GENERIC);

        let explicit_native = test_parsed_model(Some(providers::PROVIDER_MODE_GROK_BUILD_PROXY));
        let error =
            resolve_import_provider_mode_with(&explicit_native, |_, _| Err("offline".into()))
                .expect_err("explicit native must fail closed");
        assert!(error.contains("capability check failed"));
    }

    #[test]
    fn slugify_and_unique() {
        assert_eq!(slugify_id("Amux", ""), "amux");
        assert_eq!(slugify_id("My Relay!", ""), "my-relay");
        let mut set = std::collections::HashSet::new();
        set.insert("amux".into());
        assert_eq!(unique_id("amux", &set), "amux-2");
    }

    #[test]
    fn proxy_managed_detected() {
        let p = ParsedModel {
            profile: "x".into(),
            model: "x".into(),
            base_url: "http://127.0.0.1:15721/grokbuild/v1".into(),
            name: "x".into(),
            api_key: "PROXY_MANAGED".into(),
            api_backend: "responses".into(),
            provider_mode: None,
        };
        assert!(is_proxy_managed(&p));
    }

    #[test]
    fn key_hint_tail() {
        assert_eq!(key_hint("sk-abcdefgh").as_deref(), Some("…efgh"));
    }

    #[test]
    fn candidate_dirs_include_default_dot_cc_switch() {
        let dirs = candidate_cc_switch_dirs();
        assert!(
            dirs.iter().any(|p| p.ends_with(".cc-switch")),
            "expected ~/.cc-switch among {dirs:?}"
        );
    }

    #[test]
    fn parse_settings_json_wrapper() {
        let json = serde_json::json!({
            "config": "[models]\ndefault = \"m\"\n\n[model.\"m\"]\nmodel = \"m\"\nbase_url = \"https://ex.com/v1\"\nname = \"N\"\napi_key = \"k\"\napi_backend = \"responses\"\n"
        })
        .to_string();
        let p = parse_settings_config(&json, "N").expect("ok");
        assert_eq!(p.base_url, "https://ex.com/v1");
    }

    #[test]
    fn scan_temp_db_with_amux_row() {
        let dir = tempfile_dir();
        let db = dir.join(DB_NAME);
        {
            let conn = Connection::open(&db).expect("create db");
            conn.execute_batch(
                "CREATE TABLE providers (
                    id TEXT NOT NULL,
                    app_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    settings_config TEXT NOT NULL,
                    website_url TEXT,
                    category TEXT,
                    sort_index INTEGER,
                    is_current BOOLEAN NOT NULL DEFAULT 0,
                    PRIMARY KEY (id, app_type)
                );",
            )
            .expect("schema");
            let cfg = serde_json::json!({
                "config": "[models]\ndefault = \"grok-4.5\"\n\n[model.\"grok-4.5\"]\nmodel = \"grok-4.5\"\nbase_url = \"https://api.amux.ai/v1\"\nname = \"Amux\"\napi_backend = \"responses\"\napi_key = \"sk-secretXXXX\"\n"
            })
            .to_string();
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, website_url, category, is_current)
                 VALUES (?1, 'grokbuild', 'Amux', ?2, 'https://amux.ai', 'aggregator', 1)",
                rusqlite::params!["uuid-amux", cfg],
            )
            .expect("insert");
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, website_url, category, is_current)
                 VALUES ('grokbuild-official', 'grokbuild', 'Grok Official', '{\"config\":\"\"}', 'https://x.ai/grok', 'official', 0)",
                [],
            )
            .expect("insert official");
        }

        let rows = read_grokbuild_rows(&db).expect("read");
        assert_eq!(rows.len(), 2);
        let existing = std::collections::HashSet::new();
        let previews: Vec<_> = rows
            .into_iter()
            .map(|r| row_to_preview(r, &existing))
            .collect();
        let amux = previews.iter().find(|p| p.name == "Amux").expect("amux");
        assert_eq!(amux.status, "importable");
        assert_eq!(amux.base_url, "https://api.amux.ai/v1");
        assert!(amux.has_api_key);
        let off = previews
            .iter()
            .find(|p| p.category.as_deref() == Some("official"));
        assert_eq!(off.map(|p| p.status.as_str()), Some("official"));
    }

    #[test]
    fn import_roundtrip_writes_resolved_native_mode() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let app_home = tempfile_dir();
        let cc_home = tempfile_dir();
        let _restore = RestoreEnv::set(&[
            ("GROK_APP_HOME", app_home.to_string_lossy().as_ref()),
            (ENV_DIR, cc_home.to_string_lossy().as_ref()),
        ]);

        let db = cc_home.join(DB_NAME);
        let conn = Connection::open(&db).expect("create db");
        conn.execute_batch(
            "CREATE TABLE providers (
                id TEXT NOT NULL,
                app_type TEXT NOT NULL,
                name TEXT NOT NULL,
                settings_config TEXT NOT NULL,
                website_url TEXT,
                category TEXT,
                sort_index INTEGER,
                is_current BOOLEAN NOT NULL DEFAULT 0,
                PRIMARY KEY (id, app_type)
            );",
        )
        .expect("schema");
        let config = format!(
            "[models]\ndefault = \"grok-4.6\"\n\n[model.\"grok-4.6\"]\nmodel = \"grok-4.6\"\nbase_url = \"https://relay.example/v1\"\nname = \"Relay\"\napi_backend = \"responses\"\napi_key = \"runtime-key\"\n"
        );
        let settings = serde_json::json!({ "config": config }).to_string();
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config, category, is_current)
             VALUES ('source-relay', 'grokbuild', 'Relay', ?1, 'aggregator', 1)",
            [settings],
        )
        .expect("insert");
        drop(conn);

        let result = import_cc_switch_providers_with(
            CcSwitchImportRequest {
                source_ids: vec!["source-relay".into()],
                on_conflict: Some("overwrite".into()),
                activate_id: None,
            },
            |parsed| {
                assert_eq!(parsed.model, "grok-4.6");
                assert_eq!(parsed.base_url, "https://relay.example/v1");
                Ok(providers::PROVIDER_MODE_GROK_BUILD_PROXY.into())
            },
        )
        .expect("import");
        assert_eq!(result.imported, 1);
        assert!(result.failed.is_empty());

        let written = fs::read_to_string(app_home.join("agent-home/config.toml")).expect("config");
        assert!(written.contains("app_provider_mode = \"grok_build_proxy\""));
        assert!(written.contains("model = \"grok-4.6\""));

        let _ = fs::remove_dir_all(&app_home);
        let _ = fs::remove_dir_all(&cc_home);
    }

    fn tempfile_dir() -> PathBuf {
        let mut d = std::env::temp_dir();
        d.push(format!(
            "grok-app-cc-switch-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).expect("mkdir");
        d
    }

    #[test]
    fn expand_tilde() {
        let p = expand_user_path("~/foo/bar");
        assert!(p.ends_with("foo/bar") || p.ends_with(r"foo\bar"));
    }

    fn test_parsed_model(provider_mode: Option<&str>) -> ParsedModel {
        ParsedModel {
            profile: "grok-4.6".into(),
            model: "grok-4.6".into(),
            base_url: "https://relay.example/v1".into(),
            name: "Relay".into(),
            api_key: "runtime-key".into(),
            api_backend: "responses".into(),
            provider_mode: provider_mode.map(str::to_string),
        }
    }

    struct RestoreEnv(Vec<(&'static str, Option<String>)>);

    impl RestoreEnv {
        fn set(values: &[(&'static str, &str)]) -> Self {
            let previous = values
                .iter()
                .map(|(key, value)| {
                    let old = std::env::var(key).ok();
                    std::env::set_var(key, value);
                    (*key, old)
                })
                .collect();
            Self(previous)
        }
    }

    impl Drop for RestoreEnv {
        fn drop(&mut self) {
            for (key, value) in self.0.drain(..).rev() {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[allow(dead_code)]
    fn write_file(path: &Path, body: &str) {
        let mut f = fs::File::create(path).unwrap();
        f.write_all(body.as_bytes()).unwrap();
    }
}
