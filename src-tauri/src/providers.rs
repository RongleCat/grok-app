//! Custom OpenAI-compatible providers → agent-readable config.toml under GROK_HOME.
//! Intentionally original implementation (not ported from other desktops).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::paths::{agent_config_toml, agent_home_dir, ensure_app_dirs};
use crate::provider_headers::{
    decode_extra_headers, encode_extra_headers_toml, normalize_extra_headers, EXTRA_HEADERS_KEY,
};

pub use crate::provider_headers::ProviderHeaderEntry;

/// One selectable request model under a custom provider channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelEntry {
    /// Upstream request body model id.
    pub id: String,
    /// Composer chip / menu display label.
    pub name: String,
    /// Per-model context window (tokens). Missing → channel `context_window`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// Per-model image-pixel capability. Missing → channel `app_supports_vision`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    /// Per-model video-input capability. Missing → unset (not a channel flag).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_video: Option<bool>,
    /// Per-model reasoning ladder. Empty → channel `app_efforts`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub efforts: Vec<ProviderEffortEntry>,
}

impl ProviderModelEntry {
    pub fn named(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            ..Default::default()
        }
    }
}

/// One selectable reasoning-effort option for a custom channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEffortEntry {
    /// Value passed to `--reasoning-effort` / upstream `reasoning_effort`.
    pub id: String,
    /// Composer display label (optional; falls back to id).
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub id: String,
    /// Active request model (written to config `model = …`).
    pub model: String,
    pub base_url: String,
    pub name: String,
    pub has_api_key: bool,
    pub api_backend: String,
    /// `generic` writes a normal `[model.<id>]` relay. `grok_build_proxy`
    /// exposes the relay as Grok Build's native model catalog / chat proxy so
    /// the CLI can discover server-side capabilities from `/models`.
    #[serde(default = "default_provider_mode")]
    pub provider_mode: String,
    pub is_default: bool,
    /// Catalog of selectable models for this channel (App-managed).
    #[serde(default)]
    pub models: Vec<ProviderModelEntry>,
    /// Reasoning efforts for this channel (App-managed). Empty → App falls back to Grok 3.
    #[serde(default)]
    pub efforts: Vec<ProviderEffortEntry>,
    /// Optional per-channel context window (tokens). None → App falls back to
    /// the model catalog window, then `DEFAULT_CUSTOM_CONTEXT_WINDOW`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// When true, treat `base_url` as a complete root path and never auto-append `/v1`.
    /// Default false preserves legacy OpenAI-compatible `/v1` normalization.
    #[serde(default)]
    pub base_url_full_path: bool,
    /// Extra instructions appended to the system prompt for this channel.
    ///
    /// Relays differ in what they need spelled out; this rides the CLI's
    /// `--rules` (append) rather than `--system-prompt-override` (replace), so
    /// the agent keeps its built-in prompt. Empty / unset = nothing appended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub append_prompt: Option<String>,
    /// Explicit: this relay accepts image pixels (`image_url`). Combined with
    /// name/model heuristics in `models_aux` to decide text-only vs vision.
    #[serde(default)]
    pub supports_vision: bool,
    /// Extra HTTP headers written as Grok Build `extra_headers` (verbatim).
    #[serde(default)]
    pub extra_headers: Vec<ProviderHeaderEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProviderInput {
    pub id: String,
    pub model: String,
    pub base_url: String,
    pub name: Option<String>,
    /// Empty / omitted = keep existing key on edit.
    pub api_key: Option<String>,
    pub api_backend: Option<String>,
    /// Explicit transport semantics. Never inferred from a provider hostname.
    pub provider_mode: Option<String>,
    pub set_as_default: Option<bool>,
    pub create_only: Option<bool>,
    /// Optional multi-model catalog; when omitted on edit, keep previous `app_models`.
    pub models: Option<Vec<ProviderModelEntry>>,
    /// Optional effort catalog; when omitted on edit, keep previous `app_efforts`.
    pub efforts: Option<Vec<ProviderEffortEntry>>,
    /// Context window (tokens). `Some(0)` clears; `Some(n>0)` sets;
    /// `None` keeps the existing value on edit. Written to TOML as a string.
    #[serde(default)]
    pub context_window: Option<u64>,
    /// Full-path base URL mode. `None` keeps previous flag on edit; create defaults false.
    #[serde(default)]
    pub base_url_full_path: Option<bool>,
    /// Appended system-prompt rules. `Some("")` clears; `None` keeps existing on edit.
    #[serde(default)]
    pub append_prompt: Option<String>,
    /// Explicit vision capability. `None` keeps previous flag on edit; create defaults false.
    #[serde(default)]
    pub supports_vision: Option<bool>,
    /// Extra request headers. `None` keeps existing on edit; `Some([])` clears.
    #[serde(default)]
    pub extra_headers: Option<Vec<ProviderHeaderEntry>>,
}

/// TOML field (ignored by Grok Build) storing JSON array of `{id,name}`.
const APP_MODELS_KEY: &str = "app_models";
/// TOML field (ignored by Grok Build) storing JSON array of `{id,name,isDefault}`.
const APP_EFFORTS_KEY: &str = "app_efforts";
/// Grok Build capability gate for forwarding `--reasoning-effort` to inference.
const SUPPORTS_REASONING_EFFORT_KEY: &str = "supports_reasoning_effort";
/// TOML field (ignored by Grok Build): when true, do not auto-append `/v1` to base_url.
const APP_BASE_URL_FULL_PATH_KEY: &str = "app_base_url_full_path";
/// TOML field (ignored by Grok Build): extra rules appended to the system prompt.
const APP_APPEND_PROMPT_KEY: &str = "app_append_prompt";
/// TOML field (ignored by Grok Build): relay accepts multimodal image_url.
const APP_SUPPORTS_VISION_KEY: &str = "app_supports_vision";
/// TOML field (ignored by Grok Build): relay transport semantics selected in App.
const APP_PROVIDER_MODE_KEY: &str = "app_provider_mode";

pub const PROVIDER_MODE_GENERIC: &str = "generic";
pub const PROVIDER_MODE_GROK_BUILD_PROXY: &str = "grok_build_proxy";

fn default_provider_mode() -> String {
    PROVIDER_MODE_GENERIC.to_string()
}

pub fn normalize_provider_mode(raw: Option<&str>) -> String {
    match raw.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        PROVIDER_MODE_GROK_BUILD_PROXY => PROVIDER_MODE_GROK_BUILD_PROXY.to_string(),
        _ => PROVIDER_MODE_GENERIC.to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersListResult {
    pub providers: Vec<CustomProvider>,
    pub default_model: Option<String>,
    /// `official` = built-in Grok OAuth / xAI path; `custom` = a config.toml model with base_url.
    pub active_source: String,
    /// When `active_source == "custom"`, the selected provider id.
    pub active_provider_id: Option<String>,
    pub config_path: String,
    pub agent_home: String,
    /// True when this call forced `session_data_mode` shared → independent so
    /// App-written agent-home `config.toml` is visible to the spawned agent (#557).
    #[serde(default)]
    pub switched_to_independent: bool,
}

/// Built-in model id used when routing back to official Grok Build / SuperGrok.
pub const OFFICIAL_DEFAULT_MODEL: &str = "grok";

/// Catalog model preferred for composer / official spawn when none is set.
pub const OFFICIAL_CATALOG_MODEL: &str = "grok-4.6";
/// Previous official catalog id — still a valid official aux / spawn target.
pub const OFFICIAL_CATALOG_MODEL_LEGACY: &str = "grok-4.5";

pub fn is_official_catalog_model(id: &str) -> bool {
    let t = id.trim();
    t == OFFICIAL_CATALOG_MODEL || t == OFFICIAL_CATALOG_MODEL_LEGACY
}

/// Which inference channel the agent should use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveRoute {
    /// Built-in xAI / SuperGrok (OIDC via auth.json).
    Official,
    /// OpenAI-compatible relay section id in config.toml (`[model.<id>]`).
    Custom { id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPingResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub endpoint: String,
    pub status: Option<u16>,
    pub error: Option<String>,
}

/// Result of a per-model connection probe (mirrors ZCode's connectivity test):
/// sends one tiny non-streaming inference request and reports success = HTTP 2xx.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub endpoint: String,
    pub status: Option<u16>,
    /// `auth` | `model_not_found` | `rate_limit` | `server` | `network` | `timeout` | `unknown`
    pub error_kind: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModelsResult {
    pub endpoint: String,
    pub models: Vec<RemoteModel>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub owned_by: Option<String>,
    /// Capability advertised by the live `/models` response. `None` means the
    /// endpoint did not make a claim, which must not be treated as supported.
    pub supports_backend_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_video: Option<bool>,
}

/// Process-only native Grok Build relay binding. Deliberately not Debug or
/// Serialize because it contains the provider key.
pub struct GrokBuildProxySpawn {
    pub base_url: String,
    pub models_url: String,
    pub api_key: String,
    pub model: String,
}

pub fn validate_grok_build_proxy_models(
    remote: &[RemoteModel],
    selected: &[ProviderModelEntry],
) -> Result<(), String> {
    if selected.is_empty() {
        return Err("grok_build_proxy requires at least one model".into());
    }
    let mut missing = Vec::new();
    let mut unsupported = Vec::new();
    for model in selected {
        let id = model.id.trim();
        if id.is_empty() {
            continue;
        }
        match remote.iter().find(|m| m.id == id) {
            None => missing.push(id.to_string()),
            Some(m) if m.supports_backend_search != Some(true) => unsupported.push(id.to_string()),
            Some(_) => {}
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "grok_build_proxy models missing from live /models: {}",
            missing.join(", ")
        ));
    }
    if !unsupported.is_empty() {
        return Err(format!(
            "grok_build_proxy requires supports_backend_search=true for: {}",
            unsupported.join(", ")
        ));
    }
    Ok(())
}

/// Parsed `[model.*]` section (shared with relay stream proxy).
#[derive(Debug, Clone)]
pub struct ModelSection {
    pub id: String,
    pub start: usize,
    pub end: usize,
    pub fields: std::collections::HashMap<String, String>,
}

type Section = ModelSection;

/// Unquote a TOML basic string written by [`quote`].
///
/// Must reverse `serde_json::to_string` escapes (`\"`, `\\`, …). A naive
/// strip of the outer quotes leaves `\"` in `app_models` / `app_efforts` JSON
/// so `serde_json::from_str` fails and the UI falls back to Grok defaults.
fn unquote(v: &str) -> String {
    let t = v.trim();
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
        if let Ok(s) = serde_json::from_str::<String>(t) {
            return s;
        }
        // Fallback: strip quotes only (legacy / malformed values).
        return t[1..t.len() - 1].to_string();
    }
    if t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2 {
        return t[1..t.len() - 1].to_string();
    }
    t.to_string()
}

fn quote(v: &str) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| format!("\"{v}\""))
}

/// `[model.*]` keys Grok Build expects as bare TOML integers (not strings).
///
/// Writing `context_window = "1000000"` makes CLI reject the field
/// (`context_window invalid type: string`) and silently fall back to 200k.
/// See GitHub #538.
const TOML_INTEGER_FIELD_KEYS: &[&str] = &["context_window"];

/// Encode a `[model.*]` field value for agent-home `config.toml`.
///
/// Strings stay JSON-quoted; integer keys write bare digits so the CLI type
/// check matches native `~/.grok/config.toml` (CLI writes integers).
fn format_toml_field_value(key: &str, value: &str) -> String {
    if TOML_INTEGER_FIELD_KEYS.contains(&key) {
        let raw = unquote(value.trim());
        if let Ok(n) = raw.parse::<u64>() {
            return n.to_string();
        }
    }
    // CLI inline table — never JSON-quote (Grok would treat it as a string).
    if key == EXTRA_HEADERS_KEY {
        let raw = value.trim();
        if raw.starts_with('{') {
            return raw.to_string();
        }
    }
    // App-managed bool flags: write bare `true` / `false` when clearly boolean.
    if key == APP_BASE_URL_FULL_PATH_KEY || key == SUPPORTS_REASONING_EFFORT_KEY {
        let raw = unquote(value.trim());
        match raw.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => return "true".into(),
            "false" | "0" | "no" | "off" => return "false".into(),
            _ => {}
        }
    }
    quote(value)
}

/// Rewrite quoted integer fields (`context_window = "1000000"` → bare int).
/// Idempotent; preserves comments and non-matching lines.
pub(crate) fn repair_quoted_integer_fields(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut changed = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(eq) = trimmed.find('=') {
                let key = trimmed[..eq].trim();
                if TOML_INTEGER_FIELD_KEYS.contains(&key) {
                    let val = trimmed[eq + 1..].trim();
                    let bare = unquote(val);
                    if bare.parse::<u64>().is_ok()
                        && (val.starts_with('"') || val.starts_with('\''))
                    {
                        let indent_len = line.len() - line.trim_start().len();
                        let indent = &line[..indent_len];
                        out.push_str(indent);
                        out.push_str(key);
                        out.push_str(" = ");
                        out.push_str(&bare);
                        out.push('\n');
                        changed = true;
                        continue;
                    }
                }
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    if !changed {
        return text.to_string();
    }
    if text.ends_with('\n') {
        out
    } else {
        out.trim_end_matches('\n').to_string()
    }
}

/// If agent-home config has string-typed integer fields, rewrite and save.
/// Returns true when the file was modified.
pub fn ensure_model_integer_fields() -> Result<bool, String> {
    let _ = ensure_agent_home()?;
    let path = agent_config_toml();
    if !path.exists() {
        return Ok(false);
    }
    let text = read_text(&path);
    let repaired = repair_quoted_integer_fields(&text);
    if repaired == text {
        return Ok(false);
    }
    write_text(&path, &repaired)?;
    tracing::info!(
        target: "providers",
        "repaired quoted integer fields (e.g. context_window) in agent-home config.toml"
    );
    Ok(true)
}

/// Enable Grok Build's native effort forwarding for existing custom providers
/// that already expose effort choices in the App.
fn ensure_reasoning_effort_support_fields() -> Result<bool, String> {
    let _ = ensure_agent_home()?;
    let path = agent_config_toml();
    if !path.exists() {
        return Ok(false);
    }

    let text = read_text(&path);
    let sections = parse_model_sections(&text);
    let mut insertions = Vec::new();
    for section in sections {
        if !is_custom(&section.fields)
            || section.fields.contains_key(SUPPORTS_REASONING_EFFORT_KEY)
            || decode_app_efforts(
                section
                    .fields
                    .get(APP_EFFORTS_KEY)
                    .map(std::string::String::as_str),
            )
            .is_empty()
        {
            continue;
        }

        let lines = config_lines(&text);
        let index = (section.start + 1..section.end)
            .find(|&i| assignment_key_exact(lines[i].trim()) == Some(APP_EFFORTS_KEY))
            .map_or(section.end, |i| i + 1);
        insertions.push(index);
    }
    if insertions.is_empty() {
        return Ok(false);
    }

    let mut lines: Vec<_> = config_lines(&text).into_iter().map(str::to_owned).collect();
    for index in insertions.into_iter().rev() {
        lines.insert(index, format!("{SUPPORTS_REASONING_EFFORT_KEY} = true"));
    }
    let mut repaired = lines.join("\n");
    if text.ends_with('\n') {
        repaired.push('\n');
    }
    write_text(&path, &repaired)?;
    tracing::info!(
        target: "providers",
        "enabled reasoning-effort forwarding for existing custom providers"
    );
    Ok(true)
}

fn sanitize_id(raw: &str) -> Result<String, String> {
    let id = raw
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
        .to_string();
    if id.is_empty() || !id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err("provider id must start with a letter or digit".into());
    }
    Ok(id)
}

pub fn normalize_backend(v: Option<&str>) -> String {
    match v.unwrap_or("").trim() {
        "responses" => "responses".into(),
        "messages" => "messages".into(),
        _ => "chat_completions".into(),
    }
}

/// Parse App-managed boolean TOML string fields (`"true"` / `"1"` / …).
pub fn parse_app_bool_field(raw: Option<&str>) -> bool {
    match raw.map(str::trim).unwrap_or("") {
        "" => false,
        s => matches!(s.to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "on"),
    }
}

/// Whether this provider section opts out of automatic `/v1` base_url repair.
pub fn base_url_full_path_from_fields(fields: &std::collections::HashMap<String, String>) -> bool {
    parse_app_bool_field(fields.get(APP_BASE_URL_FULL_PATH_KEY).map(|s| s.as_str()))
}

/// Whether the user marked this section as vision-capable.
pub fn supports_vision_from_fields(fields: &std::collections::HashMap<String, String>) -> bool {
    parse_app_bool_field(fields.get(APP_SUPPORTS_VISION_KEY).map(|s| s.as_str()))
}

/// Grok Build joins `{base_url}/chat/completions` (or `/responses`).
/// OpenAI-compatible relays almost always expect `…/v1` as the base.
/// Without it, requests hit `https://host/chat/completions` (404/HTML) and the
/// agent may retry for minutes with no user-visible progress.
///
/// When `full_path` is true (UI「完整路径」), only trim trailing slashes — used
/// for gateways that already expose a non-`/v1` root (e.g. Volcengine Ark
/// Coding Plan `…/api/coding` or `…/api/coding/v3`).
pub fn normalize_openai_base_url(raw: &str, api_backend: &str, full_path: bool) -> String {
    let mut base = raw.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return base;
    }
    if full_path {
        return base;
    }
    // Anthropic-style messages often use bare host or /v1 already; still prefer /v1.
    let lower = base.to_ascii_lowercase();
    let needs_v1 = matches!(
        api_backend,
        "chat_completions" | "responses" | "messages" | ""
    );
    if needs_v1
        && !lower.ends_with("/v1")
        && !lower.contains("/v1/")
        && !lower.ends_with("/chat/completions")
        && !lower.ends_with("/responses")
        && !lower.ends_with("/messages")
    {
        base.push_str("/v1");
    }
    base
}

/// One-shot repair: rewrite stored custom base_url values that omit /v1.
///
/// When the section is already pointed at the stream-sanitize loopback proxy,
/// normalize `app_upstream_base_url` instead of the local `base_url`.
pub fn repair_custom_base_urls() -> Result<bool, String> {
    let path = agent_config_toml();
    if !path.is_file() {
        return Ok(false);
    }
    let text = read_text(&path);
    let sections = parse_model_sections(&text);
    let mut changed = false;
    let mut out = text.clone();
    for s in sections {
        if !is_custom(&s.fields) {
            continue;
        }
        let backend = normalize_backend(s.fields.get("api_backend").map(|x| x.as_str()));
        // Full-path providers intentionally skip /v1 auto-repair.
        if base_url_full_path_from_fields(&s.fields) {
            continue;
        }
        let Some(old_base) = s.fields.get("base_url").cloned() else {
            continue;
        };
        let is_proxy = crate::relay_stream_proxy::is_local_sanitize_proxy_url(&old_base);
        let upstream_key = crate::relay_stream_proxy::APP_UPSTREAM_BASE_URL_KEY;
        if is_proxy {
            // Fix real upstream if it lost /v1; leave loopback base_url alone.
            let Some(old_up) = s.fields.get(upstream_key).cloned() else {
                continue;
            };
            let new_up = normalize_openai_base_url(&old_up, &backend, false);
            if new_up == old_up.trim().trim_end_matches('/') || new_up == old_up {
                continue;
            }
            out = rewrite_section_base_urls(&out, &s.id, &old_base, Some(&new_up))?;
            changed = true;
            tracing::info!(
                target: "providers",
                id = %s.id,
                "repaired app_upstream_base_url to include /v1"
            );
            continue;
        }
        let new = normalize_openai_base_url(&old_base, &backend, false);
        if new != old_base.trim().trim_end_matches('/') && new != old_base {
            let keep_up = s.fields.get(upstream_key).map(|x| x.as_str());
            out = rewrite_section_base_urls(&out, &s.id, &new, keep_up)?;
            changed = true;
            tracing::info!(
                target: "providers",
                id = %s.id,
                "repaired base_url to include /v1"
            );
        }
    }
    if changed {
        // Preserve [models].default
        let def = get_models_default(&text);
        if let Some(d) = def {
            out = set_models_default(&out, &d);
        }
        write_text(&path, &out)?;
    }
    Ok(changed)
}

/// Parse all `[model.*]` sections (for stream-proxy repair / lookup).
pub fn parse_model_sections_for_proxy(text: &str) -> Vec<ModelSection> {
    parse_model_sections(text)
}

/// Update `base_url` and optional `app_upstream_base_url` while keeping other fields.
pub fn rewrite_section_base_urls(
    text: &str,
    id: &str,
    cli_base: &str,
    upstream: Option<&str>,
) -> Result<String, String> {
    let sections = parse_model_sections(text);
    let Some(s) = sections.iter().find(|x| x.id == id) else {
        return Err(format!("provider `{id}` not found"));
    };
    let upstream_key = crate::relay_stream_proxy::APP_UPSTREAM_BASE_URL_KEY;
    // Stable-ish field order: known keys first, then the rest alphabetically.
    let preferred = [
        "model",
        "base_url",
        "name",
        "api_key",
        "api_backend",
        APP_MODELS_KEY,
        APP_EFFORTS_KEY,
        "context_window",
        upstream_key,
    ];
    let mut fields: Vec<(String, String)> = Vec::new();
    let mut used = std::collections::HashSet::new();
    for k in preferred {
        if k == "base_url" {
            fields.push(("base_url".into(), cli_base.to_string()));
            used.insert("base_url".to_string());
            continue;
        }
        if k == upstream_key {
            if let Some(up) = upstream.map(str::trim).filter(|s| !s.is_empty()) {
                fields.push((upstream_key.into(), up.to_string()));
            }
            used.insert(upstream_key.to_string());
            continue;
        }
        if let Some(v) = s.fields.get(k) {
            if !v.is_empty() {
                fields.push((k.into(), v.clone()));
                used.insert(k.to_string());
            }
        }
    }
    let mut rest: Vec<_> = s
        .fields
        .iter()
        .filter(|(k, _)| !used.contains(k.as_str()) && *k != upstream_key)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    rest.sort_by(|a, b| a.0.cmp(&b.0));
    fields.extend(rest);
    if let Some(up) = upstream.map(str::trim).filter(|s| !s.is_empty()) {
        if !fields.iter().any(|(k, _)| k == upstream_key) {
            fields.push((upstream_key.into(), up.to_string()));
        }
    }
    let mut out = remove_section(text, id);
    out = append_section(&out, id, &fields);
    // Preserve [models].default if remove_section somehow touched it (it doesn't).
    Ok(out)
}

fn model_header(id: &str) -> String {
    if id
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
    {
        format!("[model.{}]", quote(id))
    } else {
        format!("[model.{id}]")
    }
}

fn parse_model_header_id(trimmed: &str) -> Option<String> {
    let rest = trimmed.strip_prefix("[model.")?.strip_suffix(']')?;
    Some(unquote(rest).trim().to_string()).filter(|s| !s.is_empty())
}

fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Split config text into lines for section indexing.
///
/// Must match [`remove_section`]: use `str::lines()` (not `split('\n')`).
/// `split('\n')` keeps a trailing empty element when the file ends with `\n`,
/// so `end = lines.len()` would be one past what `lines()` produces and panic
/// on `drain(start..end)`.
fn config_lines(text: &str) -> Vec<&str> {
    text.lines().collect()
}

fn parse_model_sections(text: &str) -> Vec<Section> {
    let lines = config_lines(text);
    let mut sections = Vec::new();
    let mut cur: Option<Section> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(hid) = parse_model_header_id(trimmed) {
            if let Some(mut c) = cur.take() {
                c.end = i;
                sections.push(c);
            }
            cur = Some(Section {
                id: hid,
                start: i,
                end: lines.len(),
                fields: std::collections::HashMap::new(),
            });
            continue;
        }
        if trimmed.starts_with('[') {
            if let Some(mut c) = cur.take() {
                c.end = i;
                sections.push(c);
            }
            continue;
        }
        if let Some(ref mut c) = cur {
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(eq) = trimmed.find('=') {
                let key = trimmed[..eq].trim().to_string();
                let val = unquote(trimmed[eq + 1..].trim());
                c.fields.insert(key, val);
            }
        }
    }
    if let Some(c) = cur {
        sections.push(c);
    }
    sections
}

fn is_models_table_header(trimmed: &str) -> bool {
    matches!(
        crate::agent_home_config::parse_table_header(trimmed),
        Some((false, "models"))
    )
}

fn assignment_key_exact(trimmed: &str) -> Option<&str> {
    crate::agent_home_config::assignment_key(trimmed)
}

fn get_models_default(text: &str) -> Option<String> {
    let mut in_models = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if crate::agent_home_config::parse_table_header(trimmed).is_some() {
            in_models = is_models_table_header(trimmed);
            continue;
        }
        if !in_models || trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        // Exact key match — never starts_with("default") (would hit default_model).
        if assignment_key_exact(trimmed) == Some("default") {
            let eq = trimmed.find('=')?;
            return Some(unquote(trimmed[eq + 1..].trim()));
        }
    }
    None
}

fn set_models_default(text: &str, model_id: &str) -> String {
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_models = false;
    let mut models_start: Option<usize> = None;
    let line_val = format!("default = {}", quote(model_id));
    for i in 0..lines.len() {
        let trimmed = lines[i].trim().to_string();
        if crate::agent_home_config::parse_table_header(&trimmed).is_some() {
            if is_models_table_header(&trimmed) {
                in_models = true;
                models_start = Some(i);
            } else if in_models {
                lines.insert(i, line_val);
                return lines.join("\n");
            } else {
                in_models = false;
            }
            continue;
        }
        if in_models && assignment_key_exact(&trimmed) == Some("default") {
            lines[i] = line_val;
            return lines.join("\n");
        }
    }
    if let Some(start) = models_start {
        lines.insert(start + 1, line_val);
        return lines.join("\n");
    }
    let block = format!("\n[models]\ndefault = {}\n", quote(model_id));
    let base = text.trim_end();
    if base.is_empty() {
        block.trim_start().to_string()
    } else {
        format!("{base}{block}")
    }
}

fn remove_section(text: &str, id: &str) -> String {
    let sections = parse_model_sections(text);
    let Some(hit) = sections.iter().find(|s| s.id == id) else {
        return text.to_string();
    };
    // Same line basis as parse_model_sections (str::lines).
    let mut lines: Vec<String> = config_lines(text)
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let start = hit.start.min(lines.len());
    let end = hit.end.min(lines.len()).max(start);
    if start < end {
        lines.drain(start..end);
    }
    let joined = lines.join("\n");
    // collapse excess blank lines
    let mut out = String::new();
    let mut blanks = 0;
    for line in joined.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 2 {
                out.push('\n');
            }
        } else {
            blanks = 0;
            out.push_str(line);
            out.push('\n');
        }
    }
    // Preserve trailing newline if original file had one (common for config.toml).
    if text.ends_with('\n') && !out.ends_with('\n') && !out.is_empty() {
        out.push('\n');
    }
    out
}

fn append_section(text: &str, id: &str, fields: &[(String, String)]) -> String {
    let body: String = fields
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k} = {}", format_toml_field_value(k, v)))
        .collect::<Vec<_>>()
        .join("\n");
    let block = format!("\n{}\n{body}\n", model_header(id));
    let base = text.trim_end();
    if base.is_empty() {
        block.trim_start().to_string()
    } else {
        format!("{base}\n{block}")
    }
}

fn is_custom(fields: &std::collections::HashMap<String, String>) -> bool {
    fields
        .get("base_url")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn encode_app_models(models: &[ProviderModelEntry]) -> String {
    serde_json::to_string(models).unwrap_or_else(|_| "[]".into())
}

/// Normalize a models catalog; drop empty ids; default blank names to id.
pub fn normalize_provider_models(models: &[ProviderModelEntry]) -> Vec<ProviderModelEntry> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for m in models {
        let id = m.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let name = m.name.trim();
        out.push(ProviderModelEntry {
            name: if name.is_empty() {
                id.clone()
            } else {
                name.to_string()
            },
            id,
            context_window: m.context_window.filter(|n| *n > 0),
            supports_vision: m.supports_vision,
            supports_video: m.supports_video,
            efforts: normalize_provider_efforts(&m.efforts),
        });
    }
    out
}

fn decode_app_models(
    raw: Option<&str>,
    fallback_model: &str,
    fallback_display: &str,
) -> Vec<ProviderModelEntry> {
    if let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(list) = serde_json::from_str::<Vec<ProviderModelEntry>>(s) {
            let cleaned = normalize_provider_models(&list);
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
    }
    let id = fallback_model.trim();
    if id.is_empty() {
        return Vec::new();
    }
    let name = fallback_display.trim();
    vec![ProviderModelEntry::named(
        id,
        if name.is_empty() { id } else { name },
    )]
}

/// Ensure `active_model` is in `models`; pick first when missing.
fn resolve_active_model(models: &[ProviderModelEntry], preferred: &str) -> String {
    let pref = preferred.trim();
    if !pref.is_empty() && models.iter().any(|m| m.id == pref) {
        return pref.to_string();
    }
    models
        .first()
        .map(|m| m.id.clone())
        .unwrap_or_else(|| pref.to_string())
}

fn encode_app_efforts(efforts: &[ProviderEffortEntry]) -> String {
    serde_json::to_string(efforts).unwrap_or_else(|_| "[]".into())
}

/// Normalize efforts: unique ids, blank names → id.
pub fn normalize_provider_efforts(efforts: &[ProviderEffortEntry]) -> Vec<ProviderEffortEntry> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut any_default = false;
    for e in efforts {
        let id = e.id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let name = e.name.trim();
        let is_default = e.is_default && !any_default;
        if is_default {
            any_default = true;
        }
        out.push(ProviderEffortEntry {
            name: if name.is_empty() {
                id.clone()
            } else {
                name.to_string()
            },
            id,
            is_default,
        });
    }
    out
}

fn decode_app_efforts(raw: Option<&str>) -> Vec<ProviderEffortEntry> {
    if let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(list) = serde_json::from_str::<Vec<ProviderEffortEntry>>(s) {
            return normalize_provider_efforts(&list);
        }
    }
    Vec::new()
}

fn ensure_agent_home() -> Result<PathBuf, String> {
    ensure_app_dirs().map_err(|e| e.to_string())?;
    let home = agent_home_dir();
    fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    Ok(home)
}

/// Migrate legacy single-slot secrets.relay_* into config.toml once.
pub fn maybe_migrate_legacy_relay(
    relay_base: Option<&str>,
    relay_key: Option<&str>,
    default_model: Option<&str>,
) -> Result<(), String> {
    let base = relay_base.map(str::trim).filter(|s| !s.is_empty());
    let key = relay_key.map(str::trim).filter(|s| !s.is_empty());
    let (Some(base), Some(key)) = (base, key) else {
        return Ok(());
    };
    let list = list_custom_providers()?;
    if !list.providers.is_empty() {
        return Ok(());
    }
    let model = default_model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(OFFICIAL_CATALOG_MODEL);
    let _ = upsert_custom_provider(UpsertProviderInput {
        id: "relay".into(),
        model: model.into(),
        base_url: base.into(),
        name: Some("Imported relay".into()),
        api_key: Some(key.into()),
        api_backend: Some("responses".into()),
        provider_mode: Some(PROVIDER_MODE_GENERIC.into()),
        set_as_default: Some(true),
        create_only: Some(true),
        models: None,
        efforts: None,
        context_window: None,
        base_url_full_path: None,
        append_prompt: None,
        supports_vision: None,
        extra_headers: None,
    })?;
    Ok(())
}

/// Cap CLI transport retries for flaky custom relays / 中转.
/// Host circuit-breaks at [`crate::acp_client::HOST_PROVIDER_MAX_RETRIES`].
pub const PROVIDER_MAX_RETRIES: u32 = 12;

/// Ensure `[models] max_retries` is at least [`PROVIDER_MAX_RETRIES`].
/// Never *lower* a user-raised value; only bump when missing or too small.
pub fn ensure_models_retry_cap() -> Result<(), String> {
    let _ = ensure_agent_home()?;
    let path = agent_config_toml();
    let text = read_text(&path);
    let current = read_models_u32_field(&text, "max_retries");
    if current.is_some_and(|n| n >= PROVIDER_MAX_RETRIES) {
        return Ok(());
    }
    let next = set_models_u32_field(&text, "max_retries", PROVIDER_MAX_RETRIES);
    if next != text {
        write_text(&path, &next)?;
        tracing::info!(
            target: "providers",
            "set [models].max_retries = {PROVIDER_MAX_RETRIES}"
        );
    }
    Ok(())
}

/// Read a u32 field under `[models]` if present (not under `[models.*]`).
fn read_models_u32_field(text: &str, key: &str) -> Option<u32> {
    let mut in_models = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if crate::agent_home_config::parse_table_header(trimmed).is_some() {
            // Only the root `[models]` table — not `[models.foo]` sections.
            in_models = is_models_table_header(trimmed);
            continue;
        }
        if !in_models {
            continue;
        }
        if assignment_key_exact(trimmed) != Some(key) {
            continue;
        }
        let eq = trimmed.find('=')?;
        let raw = trimmed[eq + 1..]
            .trim()
            .trim_matches('"')
            .trim_matches('\'');
        if let Ok(n) = raw.parse::<u32>() {
            return Some(n);
        }
    }
    None
}

fn set_models_u32_field(text: &str, key: &str, value: u32) -> String {
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_models = false;
    let mut models_start: Option<usize> = None;
    let line_val = format!("{key} = {value}");
    for i in 0..lines.len() {
        let trimmed = lines[i].trim().to_string();
        if crate::agent_home_config::parse_table_header(&trimmed).is_some() {
            if is_models_table_header(&trimmed) {
                in_models = true;
                models_start = Some(i);
            } else if in_models {
                lines.insert(i, line_val);
                return lines.join("\n");
            } else {
                in_models = false;
            }
            continue;
        }
        // Exact key match — never starts_with(key) (would hit max_retries_extra).
        if in_models && assignment_key_exact(&trimmed) == Some(key) {
            lines[i] = line_val;
            return lines.join("\n");
        }
    }
    if let Some(start) = models_start {
        lines.insert(start + 1, line_val);
        return lines.join("\n");
    }
    let block = format!("\n[models]\n{key} = {value}\n");
    let base = text.trim_end();
    if base.is_empty() {
        block.trim_start().to_string()
    } else {
        format!("{base}{block}")
    }
}

fn route_from_default(def: Option<&str>, providers: &[CustomProvider]) -> (String, Option<String>) {
    if let Some(d) = def {
        if providers.iter().any(|p| p.id == d) {
            return ("custom".into(), Some(d.to_string()));
        }
    }
    ("official".into(), None)
}

fn build_list_result(home: PathBuf, path: PathBuf, text: &str) -> ProvidersListResult {
    let def = get_models_default(text);
    let mut providers = Vec::new();
    for s in parse_model_sections(text) {
        if !is_custom(&s.fields) {
            continue;
        }
        let model = s
            .fields
            .get("model")
            .cloned()
            .unwrap_or_else(|| s.id.clone());
        // UI shows the real upstream; CLI may use loopback sanitize proxy.
        let base_url = crate::relay_stream_proxy::effective_upstream_base(&s.fields);
        let name = s
            .fields
            .get("name")
            .cloned()
            .unwrap_or_else(|| s.id.clone());
        let has_api_key = s
            .fields
            .get("api_key")
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false);
        let api_backend = normalize_backend(s.fields.get("api_backend").map(|s| s.as_str()));
        let provider_mode =
            normalize_provider_mode(s.fields.get(APP_PROVIDER_MODE_KEY).map(|s| s.as_str()));
        let is_default = def.as_deref() == Some(s.id.as_str());
        // Prefer model display names from catalog; fall back to request id (not
        // channel name) so multi-model rows stay distinct from the provider card.
        let models = decode_app_models(
            s.fields.get(APP_MODELS_KEY).map(|x| x.as_str()),
            &model,
            &model,
        );
        let efforts = decode_app_efforts(s.fields.get(APP_EFFORTS_KEY).map(|x| x.as_str()));
        let context_window = s
            .fields
            .get("context_window")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0);
        let base_url_full_path = base_url_full_path_from_fields(&s.fields);
        let append_prompt =
            crate::store::sanitize_extra_rules(s.fields.get(APP_APPEND_PROMPT_KEY).cloned());
        let supports_vision = supports_vision_from_fields(&s.fields);
        let extra_headers =
            decode_extra_headers(s.fields.get(EXTRA_HEADERS_KEY).map(|s| s.as_str()));
        providers.push(CustomProvider {
            id: s.id,
            model,
            base_url,
            name,
            has_api_key,
            api_backend,
            provider_mode,
            is_default,
            models,
            efforts,
            context_window,
            base_url_full_path,
            append_prompt,
            supports_vision,
            extra_headers,
        });
    }
    let (active_source, active_provider_id) = route_from_default(def.as_deref(), &providers);
    ProvidersListResult {
        providers,
        default_model: def,
        active_source,
        active_provider_id,
        config_path: path.display().to_string(),
        agent_home: home.display().to_string(),
        switched_to_independent: false,
    }
}

/// Custom providers are written only under App agent-home. Shared mode uses
/// `GROK_HOME=~/.grok`, so those sections are invisible to the agent. When the
/// active route is (or becomes) custom, force independent mode (#557).
///
/// Returns `true` when the mode was changed on this call.
pub fn ensure_independent_for_custom_route() -> bool {
    match active_route() {
        ActiveRoute::Custom { .. } => {}
        ActiveRoute::Official => return false,
    }
    let mut settings = crate::store::load_settings();
    if settings.session_data_mode == "independent" {
        return false;
    }
    settings.session_data_mode = "independent".into();
    if let Err(e) = crate::store::save_settings(&settings) {
        tracing::warn!(
            target: "providers",
            "failed to switch session_data_mode to independent for custom route: {e}"
        );
        return false;
    }
    tracing::info!(
        target: "providers",
        "switched session_data_mode shared→independent so custom provider config.toml is live (#557)"
    );
    true
}

pub fn list_custom_providers() -> Result<ProvidersListResult, String> {
    let home = ensure_agent_home()?;
    let path = agent_config_toml();
    // Heal legacy App writes that stringified context_window (#538).
    let _ = ensure_model_integer_fields();
    // Existing App-only effort choices need the native Grok Build capability gate.
    let _ = ensure_reasoning_effort_support_fields();
    let text = read_text(&path);
    Ok(build_list_result(home, path, &text))
}

/// Current channel from `[models].default` vs custom provider sections.
pub fn active_route() -> ActiveRoute {
    match list_custom_providers() {
        Ok(list) if list.active_source == "custom" => {
            if let Some(id) = list.active_provider_id.filter(|s| !s.trim().is_empty()) {
                return ActiveRoute::Custom { id };
            }
            ActiveRoute::Official
        }
        _ => ActiveRoute::Official,
    }
}

/// Whether `id` is a configured custom provider route (not an official catalog model).
pub fn is_custom_provider_id(id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() {
        return false;
    }
    list_custom_providers()
        .map(|list| list.providers.iter().any(|p| p.id == id))
        .unwrap_or(false)
}

pub fn provider_mode_for_id(id: &str) -> String {
    let id = id.trim();
    if id.is_empty() {
        return default_provider_mode();
    }
    list_custom_providers()
        .ok()
        .and_then(|list| list.providers.into_iter().find(|p| p.id == id))
        .map(|p| p.provider_mode)
        .unwrap_or_else(default_provider_mode)
}

/// Preserve the complete-path contract when callers edit only the active model
/// or context window and omit the provider form's URL toggle.
pub fn provider_base_url_full_path_for_id(id: &str) -> bool {
    let id = id.trim();
    if id.is_empty() {
        return false;
    }
    list_custom_providers()
        .ok()
        .and_then(|list| list.providers.into_iter().find(|p| p.id == id))
        .map(|p| p.base_url_full_path)
        .unwrap_or(false)
}

/// Extra system-prompt rules configured on the active custom channel.
///
/// Relays vary in what they need spelled out (tool syntax, language, refusal
/// style), so this rides `--rules` — appended to the agent's prompt rather than
/// replacing it. `None` on the official route or when the channel sets nothing.
pub fn active_provider_append_prompt() -> Option<String> {
    let ActiveRoute::Custom { id } = active_route() else {
        return None;
    };
    list_custom_providers()
        .ok()?
        .providers
        .into_iter()
        .find(|p| p.id == id)
        .and_then(|p| p.append_prompt)
}

/// Model flag for `grok agent --model`.
///
/// Grok Build behavior:
/// - Generic custom route: pass the **provider section id** (e.g. `yunyi`) and
///   do not keep OIDC `auth.json` in GROK_HOME.
/// - Explicit Grok Build proxy route: `AcpClient::spawn` replaces this alias
///   with the selected real catalog model after binding the native endpoint.
/// - Official route: pass a catalog id (`grok-4.6`); needs `auth.json`.
pub fn agent_spawn_model_id(composer_model: &str) -> String {
    match active_route() {
        ActiveRoute::Custom { id } => id,
        ActiveRoute::Official => {
            let m = composer_model.trim();
            if m.is_empty() || is_custom_provider_id(m) || m == OFFICIAL_DEFAULT_MODEL {
                OFFICIAL_CATALOG_MODEL.into()
            } else {
                m.into()
            }
        }
    }
}

fn grok_build_proxy_spawn_from_text(
    text: &str,
    composer_model: &str,
) -> Option<GrokBuildProxySpawn> {
    let default = get_models_default(text)?;
    let section = parse_model_sections(text)
        .into_iter()
        .find(|s| s.id == default)?;
    if normalize_provider_mode(
        section
            .fields
            .get(APP_PROVIDER_MODE_KEY)
            .map(|s| s.as_str()),
    ) != PROVIDER_MODE_GROK_BUILD_PROXY
    {
        return None;
    }
    let base_url = crate::relay_stream_proxy::effective_upstream_base(&section.fields)
        .trim()
        .trim_end_matches('/')
        .to_string();
    let api_key = section.fields.get("api_key")?.trim().to_string();
    if base_url.is_empty() || api_key.is_empty() {
        return None;
    }
    let configured_model = section
        .fields
        .get("model")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(section.id.as_str());
    let models = decode_app_models(
        section.fields.get(APP_MODELS_KEY).map(|s| s.as_str()),
        configured_model,
        configured_model,
    );
    let requested = composer_model.trim();
    let model = if !requested.is_empty() && models.iter().any(|m| m.id == requested) {
        requested.to_string()
    } else {
        resolve_active_model(&models, configured_model)
    };
    let models_url = models_list_endpoint(&base_url).ok()?;
    Some(GrokBuildProxySpawn {
        base_url,
        models_url,
        api_key,
        model,
    })
}

/// Resolve the active explicit Grok Build-compatible relay for one ACP spawn.
/// The key is returned only to the spawn caller and must never be logged.
pub fn active_grok_build_proxy_spawn(composer_model: &str) -> Option<GrokBuildProxySpawn> {
    let text = read_text(&agent_config_toml());
    grok_build_proxy_spawn_from_text(&text, composer_model)
}

/// After official login / account switch: only the official route should
/// receive a copy of `~/.grok/auth.json` in agent-home. Custom relays must
/// keep that file out so Grok Build uses `[model.<id>].api_key`.
pub fn should_sync_cli_auth_after_account_change(route: &ActiveRoute) -> bool {
    matches!(route, ActiveRoute::Official)
}

/// Prepare agent-home auth material for the active route.
///
/// Custom: strip agent-home `auth.json` so inference uses `api_key` only.
/// Official: mirror `~/.grok/auth.json` into agent-home for OAuth.
pub fn prepare_route_auth_for_agent() {
    match active_route() {
        ActiveRoute::Custom { ref id } => {
            // Heal shared→independent before spawn so GROK_HOME matches config (#557).
            let _ = ensure_independent_for_custom_route();
            crate::account::clear_agent_home_auth();
            tracing::info!(
                target: "providers",
                "custom route `{id}`: cleared agent-home auth.json (api_key only)"
            );
        }
        ActiveRoute::Official => {
            debug_assert!(should_sync_cli_auth_after_account_change(
                &ActiveRoute::Official
            ));
            if let Err(e) = crate::account::sync_cli_auth_to_agent_home() {
                tracing::warn!(
                    target: "providers",
                    "official route: auth sync failed: {e}"
                );
            }
        }
    }
    // Never import Claude/Cursor MCP catalogs into App agent-home sessions.
    let mode = crate::store::load_settings().session_data_mode;
    if let Err(e) = crate::agent_home_config::apply_compat_mcp_disabled(&mode) {
        tracing::warn!(
            target: "providers",
            "compat.claude/cursor mcps=false pin failed: {e}"
        );
    }
}

/// Switch active route: `official` or `custom` (+ provider_id).
///
/// Completely rebinds agent-home credentials so the next ACP spawn cannot
/// mix OIDC with a custom relay (or leave a relay as default when going official).
pub fn activate_provider(
    source: &str,
    provider_id: Option<&str>,
) -> Result<ProvidersListResult, String> {
    let source = source.trim().to_ascii_lowercase();
    match source.as_str() {
        "official" => {
            let result = set_default_model_id(OFFICIAL_DEFAULT_MODEL)?;
            // Restore official OAuth into agent-home; drop relay display fields.
            if let Err(e) = crate::account::sync_cli_auth_to_agent_home() {
                tracing::warn!(target: "providers", "activate official: auth sync: {e}");
            }
            let mut secrets = crate::store::load_secrets();
            secrets.relay_base_url = None;
            // Prefer catalog id for composer, not the synthetic "grok" default key.
            secrets.default_model = Some(OFFICIAL_CATALOG_MODEL.into());
            let _ = crate::store::save_secrets(&secrets);
            Ok(result)
        }
        "custom" => {
            let id = provider_id
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "providerId is required for custom source".to_string())?;
            let list = list_custom_providers()?;
            if !list.providers.iter().any(|p| p.id == id) {
                return Err(format!("unknown provider `{id}`"));
            }
            let mut result = set_default_model_id(id)?;
            // Critical: remove OIDC so Grok Build uses [model.<id>].api_key.
            crate::account::clear_agent_home_auth();
            if let Some(p) = result.providers.iter().find(|p| p.id == id) {
                let mut secrets = crate::store::load_secrets();
                secrets.relay_base_url = Some(p.base_url.clone());
                // Route id selects the channel; upstream model lives in config.toml.
                secrets.default_model = Some(id.to_string());
                let _ = crate::store::save_secrets(&secrets);
            }
            // #557: agent-home config is only live when GROK_HOME is agent-home.
            // set_default_model_id may already have switched; OR so we don't clobber.
            result.switched_to_independent =
                result.switched_to_independent || ensure_independent_for_custom_route();
            Ok(result)
        }
        _ => Err(format!("unknown source `{source}` (use official|custom)")),
    }
}

/// Whether a provider mutation should recycle warm ACP processes so the next
/// send reloads `config.toml` / auth material without a full app restart.
///
/// - `set_as_default` → active route or default model changed
/// - Mutated id is the active custom route → key / base_url / backend edit
pub fn provider_mutation_needs_agent_reload(
    set_as_default: bool,
    mutated_id: &str,
    result: &ProvidersListResult,
) -> bool {
    if set_as_default {
        return true;
    }
    let id = mutated_id.trim();
    if id.is_empty() {
        return false;
    }
    result.active_source == "custom" && result.active_provider_id.as_deref() == Some(id)
}

pub fn upsert_custom_provider(input: UpsertProviderInput) -> Result<ProvidersListResult, String> {
    let id = sanitize_id(&input.id)?;
    let model = {
        let m = input.model.trim();
        if m.is_empty() {
            id.clone()
        } else {
            m.to_string()
        }
    };
    let api_backend = normalize_backend(input.api_backend.as_deref());

    let _ = ensure_agent_home()?;
    let path = agent_config_toml();
    let mut text = read_text(&path);
    let sections = parse_model_sections(&text);
    let existing = sections.iter().find(|s| s.id == id);
    let provider_mode = match input.provider_mode.as_deref() {
        Some(raw) => normalize_provider_mode(Some(raw)),
        None => normalize_provider_mode(
            existing
                .and_then(|s| s.fields.get(APP_PROVIDER_MODE_KEY))
                .map(|s| s.as_str()),
        ),
    };

    // Full-path mode: UI switch. Omitted on edit keeps previous; create defaults false.
    let full_path = match input.base_url_full_path {
        Some(v) => v,
        None => existing
            .map(|s| base_url_full_path_from_fields(&s.fields))
            .unwrap_or(false),
    };
    let user_base = normalize_openai_base_url(input.base_url.trim(), &api_backend, full_path);
    if user_base.is_empty() {
        return Err("base_url is required".into());
    }
    if !(user_base.starts_with("http://") || user_base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    // OpenCode Zen Go etc.: CLI talks to loopback sanitize proxy; real host in
    // app_upstream_base_url (ignored by Grok Build).
    let (base_url, app_upstream) = if provider_mode == PROVIDER_MODE_GROK_BUILD_PROXY {
        // Native catalog/proxy mode talks straight to the configured endpoint;
        // the generic SSE sanitizer is a different provider contract.
        (user_base.clone(), None)
    } else {
        crate::relay_stream_proxy::rewrite_base_for_cli(&id, &user_base, &api_backend, full_path)?
    };
    let create_only = input.create_only.unwrap_or(false);
    if create_only && existing.is_some() {
        return Err(format!("provider id `{id}` already exists"));
    }
    let prev_key = existing
        .and_then(|s| s.fields.get("api_key"))
        .cloned()
        .unwrap_or_default();
    // On create, never inherit a ghost key from a stale section (should not
    // exist when create_only, but keep the path explicit for overwrite upserts).
    let next_key = match input.api_key.as_deref() {
        None | Some("") => {
            if create_only {
                String::new()
            } else {
                prev_key
            }
        }
        Some(k) => k.trim().to_string(),
    };
    if next_key.is_empty() {
        return Err("api_key is required for custom providers".into());
    }

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(id.as_str())
        .to_string();

    let prev_app_models = existing.and_then(|s| s.fields.get(APP_MODELS_KEY)).cloned();
    let models = if let Some(ref list) = input.models {
        let mut cleaned = normalize_provider_models(list);
        if cleaned.is_empty() {
            cleaned = decode_app_models(None, &model, &model);
        }
        cleaned
    } else {
        decode_app_models(prev_app_models.as_deref(), &model, &model)
    };
    let model = resolve_active_model(&models, &model);
    let app_models_json = encode_app_models(&models);
    let active_model = models.iter().find(|m| m.id == model);

    let prev_app_efforts = existing
        .and_then(|s| s.fields.get(APP_EFFORTS_KEY))
        .cloned();
    let efforts = if let Some(ref list) = input.efforts {
        normalize_provider_efforts(list)
    } else if let Some(m) = active_model.filter(|m| !m.efforts.is_empty()) {
        normalize_provider_efforts(&m.efforts)
    } else {
        decode_app_efforts(prev_app_efforts.as_deref())
    };
    let app_efforts_json = encode_app_efforts(&efforts);

    // Context window: `Some(0)` clears → None; `Some(n>0)` sets;
    // `None` prefers the active model's window, else keeps the existing
    // channel value on edit (create-only → None).
    let resolved_context_window: Option<u64> = match input.context_window {
        Some(0) => None,
        Some(n) => Some(n),
        None => active_model
            .and_then(|m| m.context_window)
            .filter(|n| *n > 0)
            .or_else(|| {
                existing
                    .and_then(|s| s.fields.get("context_window"))
                    .and_then(|v| v.parse::<u64>().ok())
                    .filter(|n| *n > 0)
            }),
    };

    // Appended system-prompt rules: `Some("")` clears; `None` keeps the value
    // already on disk so an edit that omits the field is not a silent wipe.
    let resolved_append_prompt: Option<String> = match input.append_prompt {
        Some(ref raw) => crate::store::sanitize_extra_rules(Some(raw.clone())),
        None => crate::store::sanitize_extra_rules(
            existing
                .and_then(|s| s.fields.get(APP_APPEND_PROMPT_KEY))
                .cloned(),
        ),
    };

    let supports_vision = match input.supports_vision {
        Some(v) => v,
        None => active_model
            .and_then(|m| m.supports_vision)
            .unwrap_or_else(|| {
                existing
                    .map(|s| supports_vision_from_fields(&s.fields))
                    .unwrap_or(false)
            }),
    };

    let extra_headers = match input.extra_headers {
        Some(ref list) => normalize_extra_headers(list),
        None => decode_extra_headers(
            existing
                .and_then(|s| s.fields.get(EXTRA_HEADERS_KEY))
                .map(|s| s.as_str()),
        ),
    };

    text = remove_section(&text, &id);
    let mut fields: Vec<(String, String)> = vec![
        ("model".into(), model),
        ("base_url".into(), base_url.clone()),
        ("name".into(), name),
        ("api_key".into(), next_key),
        ("api_backend".into(), api_backend),
        (APP_PROVIDER_MODE_KEY.into(), provider_mode),
        (APP_MODELS_KEY.into(), app_models_json),
    ];
    if full_path {
        fields.push((APP_BASE_URL_FULL_PATH_KEY.into(), "true".into()));
    }
    if supports_vision {
        fields.push((APP_SUPPORTS_VISION_KEY.into(), "true".into()));
    }
    if !app_efforts_json.is_empty() && app_efforts_json != "[]" {
        fields.push((APP_EFFORTS_KEY.into(), app_efforts_json));
    }
    fields.push((
        SUPPORTS_REASONING_EFFORT_KEY.into(),
        (!efforts.is_empty()).to_string(),
    ));
    if let Some(ref p) = resolved_append_prompt {
        fields.push((APP_APPEND_PROMPT_KEY.into(), p.clone()));
    }
    if let Some(n) = resolved_context_window {
        fields.push(("context_window".into(), n.to_string()));
    }
    let extra_headers_toml = encode_extra_headers_toml(&extra_headers);
    if !extra_headers_toml.is_empty() {
        fields.push((EXTRA_HEADERS_KEY.into(), extra_headers_toml));
    }
    if let Some(up) = app_upstream {
        fields.push((
            crate::relay_stream_proxy::APP_UPSTREAM_BASE_URL_KEY.into(),
            up,
        ));
    } else if crate::relay_stream_proxy::is_local_sanitize_proxy_url(&base_url) {
        // User re-saved a local proxy URL without retyping upstream: keep previous.
        if let Some(prev) = existing
            .and_then(|s| {
                s.fields
                    .get(crate::relay_stream_proxy::APP_UPSTREAM_BASE_URL_KEY)
            })
            .cloned()
            .filter(|s| !s.trim().is_empty())
        {
            fields.push((
                crate::relay_stream_proxy::APP_UPSTREAM_BASE_URL_KEY.into(),
                prev,
            ));
        }
    }
    if let Some(ex) = existing {
        let mut known: std::collections::HashSet<String> =
            fields.iter().map(|(k, _)| k.clone()).collect();
        // Always treated as managed — empty list must not copy the old table back.
        known.insert(EXTRA_HEADERS_KEY.into());
        for (k, v) in &ex.fields {
            if !known.contains(k) {
                fields.push((k.clone(), v.clone()));
            }
        }
    }
    text = append_section(&text, &id, &fields);

    if input.set_as_default.unwrap_or(false) {
        text = set_models_default(&text, &id);
    }

    write_text(&path, &text)?;
    let mut result = list_custom_providers()?;
    if input.set_as_default.unwrap_or(false) {
        // Newly defaulted custom channel must not inherit OIDC.
        crate::account::clear_agent_home_auth();
        // #557: keep GROK_HOME on agent-home when this becomes the live route.
        result.switched_to_independent = ensure_independent_for_custom_route();
    }
    Ok(result)
}

pub fn remove_custom_provider(id: &str) -> Result<ProvidersListResult, String> {
    let id = sanitize_id(id)?;
    let path = agent_config_toml();
    let mut text = read_text(&path);
    let sections = parse_model_sections(&text);
    if !sections.iter().any(|s| s.id == id) {
        // Fail loudly so the UI cannot think a delete succeeded when the
        // section was already gone or the id did not match (re-add ghosts).
        return Err(format!("provider `{id}` not found"));
    }
    let def = get_models_default(&text);
    text = remove_section(&text, &id);
    // Verify the section is actually gone before reporting success.
    if parse_model_sections(&text).iter().any(|s| s.id == id) {
        return Err(format!("failed to remove provider `{id}` from config"));
    }
    let fell_back_official = def.as_deref() == Some(id.as_str());
    if fell_back_official {
        text = set_models_default(&text, OFFICIAL_DEFAULT_MODEL);
    }
    write_text(&path, &text)?;
    let result = list_custom_providers()?;
    if fell_back_official {
        prepare_route_auth_for_agent();
    }
    Ok(result)
}

pub fn set_default_model_id(model_id: &str) -> Result<ProvidersListResult, String> {
    let id = model_id.trim();
    if id.is_empty() {
        return Err("modelId is required".into());
    }
    let path = agent_config_toml();
    let mut text = read_text(&path);
    text = set_models_default(&text, id);
    write_text(&path, &text)?;
    let mut result = list_custom_providers()?;
    // #557: custom default must run under agent-home GROK_HOME.
    if result.active_source == "custom" {
        result.switched_to_independent = ensure_independent_for_custom_route();
    }
    Ok(result)
}

fn resolve_stored_key(provider_id: Option<&str>) -> String {
    let Some(pid) = provider_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let Ok(sid) = sanitize_id(pid) else {
        return String::new();
    };
    let text = read_text(&agent_config_toml());
    parse_model_sections(&text)
        .into_iter()
        .find(|s| s.id == sid)
        .and_then(|s| s.fields.get("api_key").cloned())
        .unwrap_or_default()
}

fn resolve_stored_base(provider_id: Option<&str>) -> String {
    let Some(pid) = provider_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let Ok(sid) = sanitize_id(pid) else {
        return String::new();
    };
    let text = read_text(&agent_config_toml());
    parse_model_sections(&text)
        .into_iter()
        .find(|s| s.id == sid)
        .and_then(|s| s.fields.get("base_url").cloned())
        .unwrap_or_default()
}

pub fn models_list_endpoint(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("base_url is required".into());
    }
    if base.to_ascii_lowercase().ends_with("/models") {
        return Ok(base.to_string());
    }
    Ok(format!("{base}/models"))
}

pub async fn ping_provider(
    base_url: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<ProviderPingResult, String> {
    let mut base = base_url.unwrap_or_default().trim().to_string();
    if base.is_empty() {
        base = resolve_stored_base(provider_id.as_deref());
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(provider_id.as_deref());
    }
    let endpoint = models_list_endpoint(&base)?;
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    let mut req = client.get(&endpoint).header("Accept", "application/json");
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    match req.send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            let _ = res.bytes().await;
            Ok(ProviderPingResult {
                ok: true,
                latency_ms: t0.elapsed().as_millis() as u64,
                endpoint,
                status: Some(status),
                error: None,
            })
        }
        Err(e) => Ok(ProviderPingResult {
            ok: false,
            latency_ms: t0.elapsed().as_millis() as u64,
            endpoint,
            status: None,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn list_remote_models(
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<RemoteModelsResult, String> {
    let base = base_url.trim().to_string();
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(provider_id.as_deref());
    }
    if key.is_empty() {
        return Err("api_key is required to list models".into());
    }
    let endpoint = models_list_endpoint(&base)?;
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "models HTTP {}: {}",
            status.as_u16(),
            text.chars().take(240).collect::<String>()
        ));
    }
    parse_remote_models_response(endpoint, &text)
}

/// Blocking model-catalog probe for import paths that already run on a
/// dedicated blocking worker. The key is request-only and must never be logged.
pub fn list_remote_models_blocking(
    base_url: &str,
    api_key: &str,
) -> Result<RemoteModelsResult, String> {
    let base = base_url.trim();
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    let key = api_key.trim();
    if key.is_empty() {
        return Err("api_key is required to list models".into());
    }
    let endpoint = models_list_endpoint(base)?;
    let client = crate::proxy::apply_to_reqwest_blocking(
        reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(20)),
    )
    .build()
    .map_err(|e| e.to_string())?;
    let res = client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("request failed: {e}"))?;
    let status = res.status();
    let text = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "models HTTP {}: {}",
            status.as_u16(),
            text.chars().take(240).collect::<String>()
        ));
    }
    parse_remote_models_response(endpoint, &text)
}

fn parse_remote_models_response(
    endpoint: String,
    text: &str,
) -> Result<RemoteModelsResult, String> {
    let data: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "models response is not JSON".to_string())?;
    let arr = if let Some(a) = data.as_array() {
        a.clone()
    } else if let Some(a) = data.get("data").and_then(|d| d.as_array()) {
        a.clone()
    } else {
        Vec::new()
    };
    let mut models = Vec::new();
    for item in arr {
        let id = item
            .get("id")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(id) = id else { continue };
        let (supports_vision, supports_video) = remote_modalities(&item);
        models.push(RemoteModel {
            id: id.to_string(),
            owned_by: item
                .get("owned_by")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
            supports_backend_search: item
                .get("supports_backend_search")
                .and_then(|x| x.as_bool()),
            context_window: remote_context_window(&item),
            supports_vision,
            supports_video,
        });
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(RemoteModelsResult { endpoint, models })
}

fn json_positive_u64(v: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        let Some(raw) = v.get(*key) else { continue };
        let n = if let Some(n) = raw.as_u64() {
            n
        } else if let Some(f) = raw.as_f64() {
            if f.is_finite() && f > 0.0 {
                f as u64
            } else {
                continue;
            }
        } else if let Some(s) = raw.as_str() {
            match s.replace(['_', ','], "").parse::<u64>() {
                Ok(n) => n,
                Err(_) => continue,
            }
        } else {
            continue;
        };
        if n > 0 {
            return Some(n);
        }
    }
    None
}

fn remote_context_window(item: &serde_json::Value) -> Option<u64> {
    const KEYS: &[&str] = &[
        "context_window",
        "contextWindow",
        "context_length",
        "contextLength",
        "max_model_len",
        "max_context_length",
    ];
    if let Some(n) = json_positive_u64(item, KEYS) {
        return Some(n);
    }
    if let Some(arch) = item.get("architecture") {
        if let Some(n) = json_positive_u64(arch, KEYS) {
            return Some(n);
        }
    }
    if let Some(top) = item.get("top_provider") {
        if let Some(n) = json_positive_u64(top, KEYS) {
            return Some(n);
        }
    }
    None
}

fn collect_modality_tokens(item: &serde_json::Value) -> String {
    let mut bits = String::new();
    let push = |out: &mut String, s: &str| {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&s.to_ascii_lowercase());
    };
    if let Some(s) = item
        .get("architecture")
        .and_then(|a| a.get("modality"))
        .and_then(|x| x.as_str())
    {
        push(&mut bits, s);
    }
    if let Some(arr) = item
        .get("architecture")
        .and_then(|a| a.get("input_modalities"))
        .and_then(|x| x.as_array())
    {
        for v in arr {
            if let Some(s) = v.as_str() {
                push(&mut bits, s);
            }
        }
    }
    for key in [
        "supports_vision",
        "vision",
        "supports_image",
        "supports_video",
    ] {
        if item.get(key).and_then(|x| x.as_bool()) == Some(true) {
            push(&mut bits, key);
        }
    }
    bits
}

fn remote_modalities(item: &serde_json::Value) -> (Option<bool>, Option<bool>) {
    let tokens = collect_modality_tokens(item);
    if tokens.is_empty() {
        return (None, None);
    }
    let vision =
        if tokens.contains("image") || tokens.contains("vision") || tokens.contains("multimodal") {
            Some(true)
        } else if item.get("supports_vision").and_then(|x| x.as_bool()) == Some(false) {
            Some(false)
        } else {
            None
        };
    let video = if tokens.contains("video") {
        Some(true)
    } else {
        None
    };
    (vision, video)
}

// ── Per-model connection probe (mirrors ZCode "测试模型") ─────────────────────

fn classify_test_status(status: u16) -> &'static str {
    match status {
        401 | 403 => "auth",
        404 => "model_not_found",
        429 => "rate_limit",
        s if s >= 500 => "server",
        _ => "unknown",
    }
}

/// Pull a human-readable reason out of an error response body.
///
/// Mirrors ZCode's `readHttpErrorMessage`: tries JSON `error` / `error.message`
/// / `message` / `detail`, strips HTML tags, collapses whitespace, truncates to
/// 240 chars. Falls back to `None` when nothing usable is present.
fn extract_http_error_message(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        v.get("error")
            .and_then(|e| {
                e.as_str().map(str::to_string).or_else(|| {
                    e.get("message")
                        .and_then(|m| m.as_str())
                        .map(str::to_string)
                })
            })
            .or_else(|| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .or_else(|| v.get("detail").and_then(|d| d.as_str()).map(str::to_string))
    } else {
        None
    };
    let raw = candidate.unwrap_or_else(|| trimmed.to_string());
    // strip HTML tags
    let no_tags = raw
        .chars()
        .fold((String::new(), false), |(mut out, mut in_tag), c| {
            match c {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => out.push(c),
                _ => {}
            }
            (out, in_tag)
        })
        .0;
    // collapse whitespace
    let collapsed: String = no_tags.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else {
        Some(collapsed.chars().take(240).collect())
    }
}

/// Test whether a specific model id is usable on a custom provider by sending
/// one tiny non-streaming inference request. Success = HTTP 2xx (mirrors ZCode).
///
/// Honors each channel's `api_backend` (`chat_completions` | `responses` |
/// `messages`) so a responses-only relay is not falsely flagged as failing.
/// Probes the **real upstream**, unwrapping the loopback SSE-sanitize proxy
/// the same way the balance probe does.
pub async fn test_model_connection(
    base_url: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
    model: String,
    api_backend: Option<String>,
    base_url_full_path: Option<bool>,
) -> Result<ProviderTestResult, String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("model id is required to test connection".into());
    }

    // Resolve base URL; unwrap loopback SSE-sanitize proxy → real upstream.
    let mut base = base_url.unwrap_or_default().trim().to_string();
    let mut fields_opt: Option<std::collections::HashMap<String, String>> = None;
    if base.is_empty() {
        fields_opt = resolve_provider_fields(provider_id.as_deref());
        if let Some(ref fields) = fields_opt {
            base = crate::relay_stream_proxy::effective_upstream_base(fields);
        }
    } else if crate::relay_stream_proxy::is_local_sanitize_proxy_url(&base) {
        fields_opt = resolve_provider_fields(provider_id.as_deref());
        if let Some(ref fields) = fields_opt {
            let up = crate::relay_stream_proxy::effective_upstream_base(fields);
            if !up.is_empty() {
                base = up;
            }
        }
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }

    // Resolve api key (form value wins; else stored config).
    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(provider_id.as_deref());
    }

    // Resolve backend + full_path (form value wins; else stored config).
    let caller_backend = api_backend
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let mut backend = normalize_backend(caller_backend);
    let mut full_path = base_url_full_path.unwrap_or(false);
    if let Some(ref fields) = fields_opt {
        if caller_backend.is_none() {
            if let Some(b) = fields.get("api_backend") {
                backend = normalize_backend(Some(b));
            }
        }
        if !full_path {
            full_path = base_url_full_path_from_fields(fields);
        }
    }

    let root = normalize_openai_base_url(&base, &backend, full_path);
    // Per-backend endpoint path + minimal body (matches ZCode connectivity probe).
    let (path, body) = match backend.as_str() {
        "responses" => (
            "/responses",
            serde_json::json!({ "model": model, "input": "hi", "max_output_tokens": 1 })
                .to_string(),
        ),
        "messages" => (
            // Anthropic-style: normalize_openai_base_url already ensured `/v1`.
            "/messages",
            serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{ "role": "user", "content": "hi" }]
            })
            .to_string(),
        ),
        _ => (
            // chat_completions (default)
            "/chat/completions",
            serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{ "role": "user", "content": "hi" }]
            })
            .to_string(),
        ),
    };
    let endpoint = format!("{root}{path}");

    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    let mut req = client
        .post(&endpoint)
        .header("content-type", "application/json")
        .header("accept", "application/json");
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    // Anthropic-style channels need the version header + x-api-key (ZCode sends both).
    if backend == "messages" {
        req = req
            .header("anthropic-version", "2023-06-01")
            .header("x-api-key", &key);
    }

    match req.body(body).send().await {
        Ok(res) => {
            let status_code = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            let latency_ms = t0.elapsed().as_millis() as u64;
            if res_is_success(status_code) {
                return Ok(ProviderTestResult {
                    ok: true,
                    latency_ms,
                    endpoint,
                    status: Some(status_code),
                    error_kind: None,
                    error: None,
                });
            }
            let error_kind = classify_test_status(status_code).to_string();
            let error =
                extract_http_error_message(&text).unwrap_or_else(|| format!("HTTP {status_code}"));
            Ok(ProviderTestResult {
                ok: false,
                latency_ms,
                endpoint,
                status: Some(status_code),
                error_kind: Some(error_kind),
                error: Some(error),
            })
        }
        Err(e) => {
            let latency_ms = t0.elapsed().as_millis() as u64;
            let error_kind = if e.is_timeout() { "timeout" } else { "network" };
            Ok(ProviderTestResult {
                ok: false,
                latency_ms,
                endpoint,
                status: None,
                error_kind: Some(error_kind.into()),
                error: Some(e.to_string()),
            })
        }
    }
}

fn res_is_success(status: u16) -> bool {
    (200..300).contains(&status)
}

// ── Provider balance probe (DeepSeek first; extensible adapters) ─────────────

/// One currency row from a balance/plan probe (amounts stay strings).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBalanceLine {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
}

/// Normalized balance / plan probe result for the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBalanceResult {
    /// `balance` | `plan` | `unsupported`
    pub kind: String,
    pub provider: String,
    pub endpoint: String,
    pub ok: bool,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `auth` | `network` | `timeout` | `unsupported` | `other`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balances: Option<Vec<ProviderBalanceLine>>,
}

const DEEPSEEK_BALANCE_HOST: &str = "api.deepseek.com";
const DEEPSEEK_BALANCE_FIXED: &str = "https://api.deepseek.com/user/balance";

/// Host component of a URL (lowercase), empty if unparseable.
pub fn url_host_lower(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    // Prefer full URL parse; fall back to stripping scheme manually.
    if let Ok(u) = url::Url::parse(t) {
        return u.host_str().unwrap_or("").to_ascii_lowercase();
    }
    let rest = t
        .strip_prefix("https://")
        .or_else(|| t.strip_prefix("http://"))
        .unwrap_or(t);
    rest.split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Whether this channel can use DeepSeek's official balance API.
pub fn is_deepseek_balance_target(provider_id: Option<&str>, base_url: &str) -> bool {
    let host = url_host_lower(base_url);
    if host == DEEPSEEK_BALANCE_HOST || host.ends_with(&format!(".{DEEPSEEK_BALANCE_HOST}")) {
        return true;
    }
    let id = provider_id.unwrap_or("").trim().to_ascii_lowercase();
    if id.is_empty() {
        return false;
    }
    id == "deepseek" || id.starts_with("deepseek-") || id.ends_with("-deepseek")
}

/// Build DeepSeek balance URL from a stored OpenAI-compatible base.
///
/// Balance lives at origin root (`/user/balance`), **not** under `/v1`.
pub fn deepseek_balance_endpoint(base_url: &str) -> Result<String, String> {
    let t = base_url.trim();
    if t.is_empty() {
        return Ok(DEEPSEEK_BALANCE_FIXED.to_string());
    }
    let host = url_host_lower(t);
    if !host.is_empty()
        && host != DEEPSEEK_BALANCE_HOST
        && !host.ends_with(&format!(".{DEEPSEEK_BALANCE_HOST}"))
    {
        // Id-matched DeepSeek with a non-DeepSeek host → still hit official API.
        return Ok(DEEPSEEK_BALANCE_FIXED.to_string());
    }
    if let Ok(u) = url::Url::parse(t) {
        let mut origin = format!(
            "{}://{}",
            u.scheme(),
            u.host_str().unwrap_or(DEEPSEEK_BALANCE_HOST)
        );
        if let Some(port) = u.port() {
            origin.push(':');
            origin.push_str(&port.to_string());
        }
        return Ok(format!("{origin}/user/balance"));
    }
    // Manual strip: remove path after host, especially trailing /v1.
    let rest = t
        .strip_prefix("https://")
        .or_else(|| t.strip_prefix("http://"))
        .unwrap_or(t);
    let scheme = if t.starts_with("http://") {
        "http"
    } else {
        "https"
    };
    let host_part = rest.split('/').next().unwrap_or(DEEPSEEK_BALANCE_HOST);
    Ok(format!("{scheme}://{host_part}/user/balance"))
}

/// Parse DeepSeek `GET /user/balance` JSON. Amounts stay strings.
pub fn parse_deepseek_balance_json(body: &str) -> Result<(bool, Vec<ProviderBalanceLine>), String> {
    let data: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "balance response is not JSON".to_string())?;
    let is_available = data
        .get("is_available")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| "balance response missing is_available".to_string())?;
    let mut lines = Vec::new();
    if let Some(arr) = data.get("balance_infos").and_then(|v| v.as_array()) {
        for item in arr {
            let currency = item
                .get("currency")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("")
                .to_string();
            // Amounts may arrive as string or number — always store as string.
            let as_str = |key: &str| -> Option<String> {
                let v = item.get(key)?;
                if let Some(s) = v.as_str() {
                    let t = s.trim();
                    if t.is_empty() {
                        return None;
                    }
                    return Some(t.to_string());
                }
                if let Some(n) = v.as_f64() {
                    // Avoid inventing trailing zeros; keep compact display.
                    return Some(n.to_string());
                }
                if let Some(n) = v.as_i64() {
                    return Some(n.to_string());
                }
                None
            };
            let Some(total) = as_str("total_balance") else {
                continue;
            };
            lines.push(ProviderBalanceLine {
                currency,
                total_balance: total,
                granted_balance: as_str("granted_balance").unwrap_or_default(),
                topped_up_balance: as_str("topped_up_balance").unwrap_or_default(),
            });
        }
    }
    Ok((is_available, lines))
}

fn resolve_provider_fields(
    provider_id: Option<&str>,
) -> Option<std::collections::HashMap<String, String>> {
    let pid = provider_id.map(str::trim).filter(|s| !s.is_empty())?;
    let sid = sanitize_id(pid).ok()?;
    let text = read_text(&agent_config_toml());
    parse_model_sections(&text)
        .into_iter()
        .find(|s| s.id == sid)
        .map(|s| s.fields)
}

fn resolve_balance_base(base_url: Option<&str>, provider_id: Option<&str>) -> String {
    let mut base = base_url.unwrap_or("").trim().to_string();
    if base.is_empty() {
        if let Some(fields) = resolve_provider_fields(provider_id) {
            base = crate::relay_stream_proxy::effective_upstream_base(&fields);
        }
    } else if crate::relay_stream_proxy::is_local_sanitize_proxy_url(&base) {
        if let Some(fields) = resolve_provider_fields(provider_id) {
            let up = crate::relay_stream_proxy::effective_upstream_base(&fields);
            if !up.is_empty() {
                base = up;
            }
        }
    }
    base
}

/// Query provider balance (Phase 1: DeepSeek only).
pub async fn query_provider_balance(
    base_url: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<ProviderBalanceResult, String> {
    let base = resolve_balance_base(base_url.as_deref(), provider_id.as_deref());
    let pid = provider_id.as_deref();

    if !is_deepseek_balance_target(pid, &base) {
        return Ok(ProviderBalanceResult {
            kind: "unsupported".into(),
            provider: "unknown".into(),
            endpoint: String::new(),
            ok: false,
            latency_ms: 0,
            status: None,
            error: Some("Balance probe is only supported for DeepSeek (api.deepseek.com)".into()),
            error_kind: Some("unsupported".into()),
            is_available: None,
            balances: None,
        });
    }

    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(pid);
    }
    if key.is_empty() {
        return Ok(ProviderBalanceResult {
            kind: "balance".into(),
            provider: "deepseek".into(),
            endpoint: deepseek_balance_endpoint(&base)
                .unwrap_or_else(|_| DEEPSEEK_BALANCE_FIXED.into()),
            ok: false,
            latency_ms: 0,
            status: None,
            error: Some("api_key is required to query balance".into()),
            error_kind: Some("auth".into()),
            is_available: None,
            balances: None,
        });
    }

    let endpoint = deepseek_balance_endpoint(&base)?;
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    let req = client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json");

    match req.send().await {
        Ok(res) => {
            let status = res.status();
            let code = status.as_u16();
            let text = res.text().await.unwrap_or_default();
            let latency_ms = t0.elapsed().as_millis() as u64;
            if code == 401 || code == 403 {
                return Ok(ProviderBalanceResult {
                    kind: "balance".into(),
                    provider: "deepseek".into(),
                    endpoint,
                    ok: false,
                    latency_ms,
                    status: Some(code),
                    error: Some(format!(
                        "balance HTTP {}: {}",
                        code,
                        text.chars().take(200).collect::<String>()
                    )),
                    error_kind: Some("auth".into()),
                    is_available: None,
                    balances: None,
                });
            }
            if !status.is_success() {
                return Ok(ProviderBalanceResult {
                    kind: "balance".into(),
                    provider: "deepseek".into(),
                    endpoint,
                    ok: false,
                    latency_ms,
                    status: Some(code),
                    error: Some(format!(
                        "balance HTTP {}: {}",
                        code,
                        text.chars().take(200).collect::<String>()
                    )),
                    error_kind: Some("other".into()),
                    is_available: None,
                    balances: None,
                });
            }
            match parse_deepseek_balance_json(&text) {
                Ok((is_available, balances)) => Ok(ProviderBalanceResult {
                    kind: "balance".into(),
                    provider: "deepseek".into(),
                    endpoint,
                    ok: true,
                    latency_ms,
                    status: Some(code),
                    error: None,
                    error_kind: None,
                    is_available: Some(is_available),
                    balances: Some(balances),
                }),
                Err(e) => Ok(ProviderBalanceResult {
                    kind: "balance".into(),
                    provider: "deepseek".into(),
                    endpoint,
                    ok: false,
                    latency_ms,
                    status: Some(code),
                    error: Some(e),
                    error_kind: Some("other".into()),
                    is_available: None,
                    balances: None,
                }),
            }
        }
        Err(e) => {
            let latency_ms = t0.elapsed().as_millis() as u64;
            let msg = e.to_string();
            let kind = if e.is_timeout() || msg.to_ascii_lowercase().contains("timed out") {
                "timeout"
            } else {
                "network"
            };
            Ok(ProviderBalanceResult {
                kind: "balance".into(),
                provider: "deepseek".into(),
                endpoint,
                ok: false,
                latency_ms,
                status: None,
                error: Some(msg),
                error_kind: Some(kind.into()),
                is_available: None,
                balances: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_and_endpoint() {
        assert_eq!(sanitize_id("My Relay").unwrap(), "my-relay");
        assert!(models_list_endpoint("https://x.example/v1")
            .unwrap()
            .ends_with("/v1/models"));
    }

    #[test]
    fn deepseek_balance_endpoint_strips_v1() {
        assert_eq!(
            deepseek_balance_endpoint("https://api.deepseek.com/v1").unwrap(),
            "https://api.deepseek.com/user/balance"
        );
        assert_eq!(
            deepseek_balance_endpoint("https://api.deepseek.com/v1/").unwrap(),
            "https://api.deepseek.com/user/balance"
        );
        assert_eq!(
            deepseek_balance_endpoint("https://api.deepseek.com").unwrap(),
            "https://api.deepseek.com/user/balance"
        );
        // Id-only path with non-DeepSeek host still uses official endpoint.
        assert_eq!(
            deepseek_balance_endpoint("https://relay.example.com/v1").unwrap(),
            "https://api.deepseek.com/user/balance"
        );
    }

    #[test]
    fn deepseek_balance_target_detect() {
        assert!(is_deepseek_balance_target(
            Some("deepseek"),
            "https://api.deepseek.com/v1"
        ));
        assert!(is_deepseek_balance_target(
            None,
            "https://api.deepseek.com/v1"
        ));
        assert!(is_deepseek_balance_target(Some("deepseek"), ""));
        assert!(!is_deepseek_balance_target(
            Some("amux"),
            "https://api.amux.ai/v1"
        ));
        assert!(!is_deepseek_balance_target(
            Some("opencode-go"),
            "https://opencode.ai/zen/go/v1"
        ));
        assert!(!is_deepseek_balance_target(
            Some("volcano-ark"),
            "https://ark.cn-beijing.volces.com/api/plan/v3"
        ));
    }

    #[test]
    fn parse_deepseek_balance_cny_fixture() {
        let body = r#"{
            "is_available": true,
            "balance_infos": [
                {
                    "currency": "CNY",
                    "total_balance": "110.00",
                    "granted_balance": "10.00",
                    "topped_up_balance": "100.00"
                }
            ]
        }"#;
        let (avail, lines) = parse_deepseek_balance_json(body).unwrap();
        assert!(avail);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].currency, "CNY");
        assert_eq!(lines[0].total_balance, "110.00");
        assert_eq!(lines[0].granted_balance, "10.00");
        assert_eq!(lines[0].topped_up_balance, "100.00");
    }

    #[test]
    fn parse_deepseek_balance_empty_infos() {
        let body = r#"{"is_available": false, "balance_infos": []}"#;
        let (avail, lines) = parse_deepseek_balance_json(body).unwrap();
        assert!(!avail);
        assert!(lines.is_empty());
    }

    #[test]
    fn normalizes_missing_v1() {
        assert_eq!(
            normalize_openai_base_url("https://api.yunyi.ai", "chat_completions", false),
            "https://api.yunyi.ai/v1"
        );
        assert_eq!(
            normalize_openai_base_url("https://api.yunyi.ai/v1", "chat_completions", false),
            "https://api.yunyi.ai/v1"
        );
        assert_eq!(
            normalize_openai_base_url("https://api.yunyi.ai/v1/", "chat_completions", false),
            "https://api.yunyi.ai/v1"
        );
    }

    #[test]
    fn full_path_skips_v1_append() {
        // Volcengine Ark Coding Plan roots must not gain trailing /v1.
        assert_eq!(
            normalize_openai_base_url(
                "https://ark.cn-beijing.volces.com/api/coding",
                "messages",
                true
            ),
            "https://ark.cn-beijing.volces.com/api/coding"
        );
        assert_eq!(
            normalize_openai_base_url(
                "https://ark.cn-beijing.volces.com/api/coding/v3/",
                "responses",
                true
            ),
            "https://ark.cn-beijing.volces.com/api/coding/v3"
        );
        // Legacy default still appends.
        assert_eq!(
            normalize_openai_base_url(
                "https://ark.cn-beijing.volces.com/api/coding",
                "messages",
                false
            ),
            "https://ark.cn-beijing.volces.com/api/coding/v1"
        );
    }

    #[test]
    fn parses_full_path_bool_fields() {
        assert!(!parse_app_bool_field(None));
        assert!(!parse_app_bool_field(Some("")));
        assert!(parse_app_bool_field(Some("true")));
        assert!(parse_app_bool_field(Some("1")));
        assert!(parse_app_bool_field(Some("YES")));
        assert!(!parse_app_bool_field(Some("false")));
        let mut m = std::collections::HashMap::new();
        m.insert(APP_BASE_URL_FULL_PATH_KEY.into(), "true".into());
        assert!(base_url_full_path_from_fields(&m));
    }

    #[test]
    fn provider_mode_is_explicit_and_defaults_generic() {
        assert_eq!(normalize_provider_mode(None), PROVIDER_MODE_GENERIC);
        assert_eq!(
            normalize_provider_mode(Some("grok_build_proxy")),
            PROVIDER_MODE_GROK_BUILD_PROXY
        );
        assert_eq!(
            normalize_provider_mode(Some("beefapi")),
            PROVIDER_MODE_GENERIC,
            "provider host or id must never opt into native semantics"
        );
    }

    #[test]
    fn native_proxy_requires_live_backend_search_capability() {
        let remote = vec![
            RemoteModel {
                id: "grok-4.6".into(),
                owned_by: None,
                supports_backend_search: Some(true),
                ..Default::default()
            },
            RemoteModel {
                id: "grok-4.5".into(),
                owned_by: None,
                supports_backend_search: None,
                ..Default::default()
            },
        ];
        let selected = vec![ProviderModelEntry::named("grok-4.6", "Grok 4.6")];
        assert!(validate_grok_build_proxy_models(&remote, &selected).is_ok());

        let unsupported = vec![ProviderModelEntry::named("grok-4.5", "Grok 4.5")];
        assert!(validate_grok_build_proxy_models(&remote, &unsupported)
            .unwrap_err()
            .contains("supports_backend_search=true"));
    }

    #[test]
    fn native_proxy_spawn_uses_real_model_and_process_only_binding() {
        let models = encode_app_models(&[
            ProviderModelEntry::named("grok-4.6", "Grok 4.6"),
            ProviderModelEntry::named("grok-4.5", "Grok 4.5"),
        ]);
        let text = set_models_default(
            &append_section(
                "",
                "beef-relay",
                &[
                    ("model".into(), "grok-4.6".into()),
                    ("base_url".into(), "https://relay.example/v1".into()),
                    ("api_key".into(), "runtime-key".into()),
                    ("api_backend".into(), "responses".into()),
                    (
                        APP_PROVIDER_MODE_KEY.into(),
                        PROVIDER_MODE_GROK_BUILD_PROXY.into(),
                    ),
                    (APP_MODELS_KEY.into(), models),
                ],
            ),
            "beef-relay",
        );
        let spawn = grok_build_proxy_spawn_from_text(&text, "grok-4.5").expect("spawn");
        assert_eq!(spawn.model, "grok-4.5");
        assert_ne!(spawn.model, "beef-relay");
        assert_eq!(spawn.base_url, "https://relay.example/v1");
        assert_eq!(spawn.models_url, "https://relay.example/v1/models");
        assert_eq!(spawn.api_key, "runtime-key");

        let generic = text.replace(
            "app_provider_mode = \"grok_build_proxy\"",
            "app_provider_mode = \"generic\"",
        );
        assert!(grok_build_proxy_spawn_from_text(&generic, "grok-4.5").is_none());
    }

    #[test]
    fn mutation_reload_when_default_or_active() {
        let active = ProvidersListResult {
            providers: vec![CustomProvider {
                id: "relay".into(),
                model: "m".into(),
                base_url: "https://ex/v1".into(),
                name: "Relay".into(),
                has_api_key: true,
                api_backend: "responses".into(),
                provider_mode: PROVIDER_MODE_GENERIC.into(),
                is_default: true,
                models: vec![ProviderModelEntry::named("m", "m")],
                efforts: vec![],
                context_window: None,
                base_url_full_path: false,
                append_prompt: None,
                supports_vision: false,
                extra_headers: vec![],
            }],
            default_model: Some("relay".into()),
            active_source: "custom".into(),
            active_provider_id: Some("relay".into()),
            config_path: String::new(),
            agent_home: String::new(),
            switched_to_independent: false,
        };
        assert!(provider_mutation_needs_agent_reload(true, "other", &active));
        assert!(provider_mutation_needs_agent_reload(
            false, "relay", &active
        ));
        assert!(!provider_mutation_needs_agent_reload(
            false, "other", &active
        ));
        let official = ProvidersListResult {
            active_source: "official".into(),
            active_provider_id: None,
            ..active.clone()
        };
        assert!(!provider_mutation_needs_agent_reload(
            false, "relay", &official
        ));
    }

    #[test]
    fn roundtrip_section_text() {
        let text = "";
        let text = append_section(
            text,
            "demo",
            &[
                ("model".into(), "m1".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Demo".into()),
                ("api_key".into(), "sk-test".into()),
                ("api_backend".into(), "chat_completions".into()),
            ],
        );
        let text = set_models_default(&text, "demo");
        let sections = parse_model_sections(&text);
        assert_eq!(sections.len(), 1);
        assert_eq!(get_models_default(&text).as_deref(), Some("demo"));
        assert!(is_custom(&sections[0].fields));
    }

    #[test]
    fn app_models_roundtrip_and_normalize() {
        let list = normalize_provider_models(&[
            ProviderModelEntry::named(" deepseek-v4-flash ", "DeepSeek V4"),
            ProviderModelEntry::named("deepseek-v4-flash", "dup"),
            ProviderModelEntry::named("", "skip"),
            ProviderModelEntry::named("other", "  "),
        ]);
        assert_eq!(
            list,
            vec![
                ProviderModelEntry::named("deepseek-v4-flash", "DeepSeek V4"),
                ProviderModelEntry::named("other", "other"),
            ]
        );
        let json = encode_app_models(&list);
        let decoded = decode_app_models(Some(&json), "fallback", "Fallback");
        assert_eq!(decoded, list);
        assert_eq!(resolve_active_model(&list, "other"), "other");
        assert_eq!(resolve_active_model(&list, "missing"), "deepseek-v4-flash");
    }

    #[test]
    fn app_models_preserves_per_model_caps_and_efforts() {
        let list = normalize_provider_models(&[ProviderModelEntry {
            id: "vision".into(),
            name: "Vision".into(),
            context_window: Some(128_000),
            supports_vision: Some(true),
            supports_video: Some(true),
            efforts: vec![ProviderEffortEntry {
                id: "high".into(),
                name: "high".into(),
                is_default: true,
            }],
        }]);
        assert_eq!(list[0].context_window, Some(128_000));
        assert_eq!(list[0].supports_vision, Some(true));
        assert_eq!(list[0].supports_video, Some(true));
        assert_eq!(list[0].efforts[0].id, "high");
        let json = encode_app_models(&list);
        let decoded = decode_app_models(Some(&json), "fallback", "Fallback");
        assert_eq!(decoded, list);
        let legacy = decode_app_models(
            Some(r#"[{"id":"plain","name":"Plain"}]"#),
            "fallback",
            "Fallback",
        );
        assert_eq!(legacy[0].id, "plain");
        assert_eq!(legacy[0].context_window, None);
        assert!(legacy[0].efforts.is_empty());
    }

    #[test]
    fn parse_remote_models_reads_openrouter_caps() {
        let body = r#"{
            "data": [
                {
                    "id": "stealth/ox-alpha",
                    "owned_by": "openrouter",
                    "context_length": 1048576,
                    "architecture": {
                        "modality": "text+image->text",
                        "input_modalities": ["text", "image"]
                    }
                },
                {
                    "id": "video-model",
                    "context_window": 32000,
                    "architecture": { "input_modalities": ["text", "video"] }
                }
            ]
        }"#;
        let got = parse_remote_models_response("https://ex/v1/models".into(), body).unwrap();
        let ox = got
            .models
            .iter()
            .find(|m| m.id == "stealth/ox-alpha")
            .unwrap();
        assert_eq!(ox.context_window, Some(1_048_576));
        assert_eq!(ox.supports_vision, Some(true));
        let vid = got.models.iter().find(|m| m.id == "video-model").unwrap();
        assert_eq!(vid.context_window, Some(32_000));
        assert_eq!(vid.supports_video, Some(true));
    }

    #[test]
    fn quote_unquote_roundtrip_json_payload() {
        let models = vec![
            ProviderModelEntry::named("deepseek-v4-flash", "DeepSeek V4 Flash"),
            ProviderModelEntry::named("deepseek-v4-pro", "DeepSeek V4 Pro"),
        ];
        let efforts = vec![
            ProviderEffortEntry {
                id: "low".into(),
                name: "low".into(),
                is_default: false,
            },
            ProviderEffortEntry {
                id: "high".into(),
                name: "high".into(),
                is_default: true,
            },
            ProviderEffortEntry {
                id: "xhigh".into(),
                name: "xhigh".into(),
                is_default: false,
            },
            ProviderEffortEntry {
                id: "max".into(),
                name: "max".into(),
                is_default: false,
            },
        ];
        let models_json = encode_app_models(&models);
        let efforts_json = encode_app_efforts(&efforts);
        // Simulate TOML field write + read (quote → line value → unquote).
        let models_field = format!("app_models = {}", quote(&models_json));
        let efforts_field = format!("app_efforts = {}", quote(&efforts_json));
        let models_raw = models_field.split_once('=').unwrap().1.trim();
        let efforts_raw = efforts_field.split_once('=').unwrap().1.trim();
        let models_back = unquote(models_raw);
        let efforts_back = unquote(efforts_raw);
        assert_eq!(
            decode_app_models(Some(&models_back), "fallback", "fallback"),
            models
        );
        assert_eq!(decode_app_efforts(Some(&efforts_back)), efforts);

        // Full section round-trip through append + parse
        let text = append_section(
            "",
            "deepseek",
            &[
                ("model".into(), "deepseek-v4-flash".into()),
                ("base_url".into(), "https://api.deepseek.com/v1".into()),
                ("name".into(), "DeepSeek".into()),
                ("api_key".into(), "sk-test".into()),
                ("api_backend".into(), "chat_completions".into()),
                (APP_MODELS_KEY.into(), models_json),
                (APP_EFFORTS_KEY.into(), efforts_json),
            ],
        );
        let sections = parse_model_sections(&text);
        assert_eq!(sections.len(), 1);
        let s = &sections[0];
        let got_models =
            decode_app_models(s.fields.get(APP_MODELS_KEY).map(|x| x.as_str()), "x", "x");
        let got_efforts = decode_app_efforts(s.fields.get(APP_EFFORTS_KEY).map(|x| x.as_str()));
        assert_eq!(got_models, models);
        assert_eq!(got_efforts, efforts);
        assert_eq!(got_models[0].name, "DeepSeek V4 Flash");
        assert_eq!(
            got_efforts
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            vec!["low", "high", "xhigh", "max"]
        );
    }

    #[test]
    fn append_prompt_round_trips_multiline_through_toml() {
        // Channel rules are free-form and often multi-line; the JSON-quoted
        // TOML value must survive a write → parse cycle unchanged.
        let prompt = "Always answer in Simplified Chinese.\nNever use emoji.";
        let text = append_section(
            "",
            "relay",
            &[
                ("model".into(), "m".into()),
                ("base_url".into(), "https://ex/v1".into()),
                (APP_APPEND_PROMPT_KEY.into(), prompt.into()),
            ],
        );
        // A raw newline would break the `key = value` line parser.
        assert!(!text.contains("Chinese.\nNever"), "must be escaped: {text}");
        let sections = parse_model_sections(&text);
        assert_eq!(sections.len(), 1);
        assert_eq!(
            sections[0]
                .fields
                .get(APP_APPEND_PROMPT_KEY)
                .map(|s| s.as_str()),
            Some(prompt)
        );
    }

    #[test]
    fn append_prompt_blank_is_dropped_not_stored() {
        // Empty box = no channel rules; the field must not reach config.toml.
        let text = append_section(
            "",
            "relay",
            &[
                ("model".into(), "m".into()),
                ("base_url".into(), "https://ex/v1".into()),
                (APP_APPEND_PROMPT_KEY.into(), String::new()),
            ],
        );
        assert!(!text.contains(APP_APPEND_PROMPT_KEY), "{text}");
    }

    #[test]
    fn remove_section_handles_trailing_newline() {
        // File ends with `\n` — previously split('\n') vs lines() disagreed on len.
        let text = "\
[models]
default = \"deepseek\"

[model.deepseek]
model = \"deepseek-v4-flash\"
base_url = \"https://api.deepseek.com/v1\"
name = \"DeepSeek\"
api_key = \"sk-test\"
api_backend = \"chat_completions\"
app_models = \"[{\\\"id\\\":\\\"deepseek-v4-flash\\\",\\\"name\\\":\\\"Flash\\\"}]\"
";
        assert!(text.ends_with('\n'));
        let sections = parse_model_sections(text);
        let deep = sections
            .iter()
            .find(|s| s.id == "deepseek")
            .expect("section");
        // end must not exceed lines() length
        let n = text.lines().count();
        assert!(deep.end <= n, "end {} > lines {}", deep.end, n);

        let next = remove_section(text, "deepseek");
        assert!(
            !parse_model_sections(&next)
                .iter()
                .any(|s| s.id == "deepseek"),
            "section should be gone: {next}"
        );
        // Other content preserved
        assert!(next.contains("[models]"));
        assert!(next.contains("default"));
    }

    #[test]
    fn remove_section_last_section_without_trailing_newline() {
        let text = "\
[model.a]
model = \"m\"
base_url = \"https://ex/v1\"
name = \"A\"
api_key = \"k\"
api_backend = \"responses\"";
        let next = remove_section(text, "a");
        assert!(parse_model_sections(&next).is_empty());
    }

    #[test]
    fn app_efforts_normalize_and_roundtrip() {
        let list = normalize_provider_efforts(&[
            ProviderEffortEntry {
                id: " low ".into(),
                name: "Low".into(),
                is_default: false,
            },
            ProviderEffortEntry {
                id: "high".into(),
                name: "".into(),
                is_default: true,
            },
            ProviderEffortEntry {
                id: "high".into(),
                name: "dup".into(),
                is_default: true,
            },
            ProviderEffortEntry {
                id: "xhigh".into(),
                name: "xHigh".into(),
                is_default: false,
            },
            ProviderEffortEntry {
                id: "max".into(),
                name: "Max".into(),
                is_default: false,
            },
        ]);
        assert_eq!(list.len(), 4);
        assert_eq!(list[0].id, "low");
        assert_eq!(list[1].id, "high");
        assert!(list[1].is_default);
        assert_eq!(list[1].name, "high");
        assert_eq!(list[2].id, "xhigh");
        assert_eq!(list[3].id, "max");
        let json = encode_app_efforts(&list);
        let decoded = decode_app_efforts(Some(&json));
        assert_eq!(decoded, list);
    }

    #[test]
    fn custom_provider_efforts_enable_cli_reasoning_effort() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home =
            std::env::temp_dir().join(format!("grok-app-provider-effort-{}", uuid::Uuid::new_v4()));
        let previous_home = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &home);

        let result = upsert_custom_provider(UpsertProviderInput {
            id: "custom_gateway".into(),
            model: "custom-reasoner".into(),
            base_url: "https://custom.example/v1".into(),
            name: Some("Custom Gateway".into()),
            api_key: Some("test-key".into()),
            api_backend: Some("responses".into()),
            provider_mode: Some(PROVIDER_MODE_GENERIC.into()),
            set_as_default: Some(false),
            create_only: Some(true),
            models: Some(vec![ProviderModelEntry::named(
                "custom-reasoner",
                "Custom Reasoner",
            )]),
            efforts: Some(vec![ProviderEffortEntry {
                id: "xhigh".into(),
                name: "Extra high".into(),
                is_default: true,
            }]),
            context_window: None,
            base_url_full_path: Some(false),
            append_prompt: None,
            supports_vision: Some(false),
            extra_headers: None,
        })
        .and_then(|_| std::fs::read_to_string(agent_config_toml()).map_err(|e| e.to_string()));

        match previous_home {
            Some(value) => std::env::set_var("GROK_APP_HOME", value),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = std::fs::remove_dir_all(&home);

        let config = result.expect("custom provider should be written");
        assert!(
            config.contains("supports_reasoning_effort = true"),
            "Grok Build must see the native capability gate:\n{config}"
        );
        assert!(
            !config.contains("supports_reasoning_effort = \"true\""),
            "Grok Build requires a TOML boolean, not a string:\n{config}"
        );
    }

    #[test]
    fn list_repairs_existing_custom_provider_reasoning_support() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!(
            "grok-app-provider-effort-repair-{}",
            uuid::Uuid::new_v4()
        ));
        let previous_home = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &home);

        let result = (|| -> Result<String, String> {
            ensure_app_dirs().map_err(|e| e.to_string())?;
            let path = agent_config_toml();
            write_text(
                &path,
                r#"[models]
default = "custom_gateway"

[model.custom_gateway]
model = "custom-reasoner"
base_url = "https://custom.example/v1"
api_key = "test-key"
api_backend = "responses"
app_efforts = "[{\"id\":\"xhigh\",\"name\":\"Extra high\",\"isDefault\":true}]"
"#,
            )?;
            list_custom_providers()?;
            std::fs::read_to_string(path).map_err(|e| e.to_string())
        })();

        match previous_home {
            Some(value) => std::env::set_var("GROK_APP_HOME", value),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = std::fs::remove_dir_all(&home);

        let config = result.expect("existing provider should be repaired");
        assert!(
            config.contains("supports_reasoning_effort = true"),
            "existing App providers must be migrated without a manual re-save:\n{config}"
        );
    }

    #[test]
    fn context_window_roundtrips_through_toml() {
        // Write a context_window field, parse back, and verify the same
        // parse logic `build_list_result` uses (string → u64, filtered > 0).
        let text = append_section(
            "",
            "demo",
            &[
                ("model".into(), "m1".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Demo".into()),
                ("api_key".into(), "sk-test".into()),
                ("api_backend".into(), "chat_completions".into()),
                ("context_window".into(), "1000000".into()),
            ],
        );
        // Grok Build requires a bare integer — never a quoted string (#538).
        assert!(
            text.contains("context_window = 1000000"),
            "expected bare integer, got:\n{text}"
        );
        assert!(
            !text.contains("context_window = \"1000000\""),
            "must not quote context_window:\n{text}"
        );
        let sections = parse_model_sections(&text);
        assert_eq!(sections.len(), 1);
        let s = &sections[0];
        assert!(is_custom(&s.fields));
        let cw = s
            .fields
            .get("context_window")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0);
        assert_eq!(cw, Some(1000000));

        // Zero / missing → filtered to None (mirrors build_list_result semantics).
        let text0 = append_section(
            "",
            "demo0",
            &[
                ("model".into(), "m0".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Demo0".into()),
                ("api_key".into(), "sk-test".into()),
                ("api_backend".into(), "chat_completions".into()),
                ("context_window".into(), "0".into()),
            ],
        );
        let s0 = parse_model_sections(&text0)[0].clone();
        let cw0 = s0
            .fields
            .get("context_window")
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0);
        assert_eq!(cw0, None);
    }

    #[test]
    fn repair_quoted_context_window_heals_legacy_string_writes() {
        let broken = r#"
[model.opencode-go]
model = "go"
base_url = "https://ex/v1"
name = "OpenCode"
api_key = "sk-test"
api_backend = "chat_completions"
context_window = "1000000"
"#;
        let fixed = repair_quoted_integer_fields(broken);
        assert!(fixed.contains("context_window = 1000000"));
        assert!(!fixed.contains("context_window = \"1000000\""));
        // Idempotent.
        assert_eq!(repair_quoted_integer_fields(&fixed), fixed);
        let s = parse_model_sections(&fixed)[0].clone();
        let cw = s
            .fields
            .get("context_window")
            .and_then(|v| v.parse::<u64>().ok());
        assert_eq!(cw, Some(1_000_000));
    }

    #[test]
    fn edit_without_context_window_keeps_integer_on_rewrite() {
        // Simulate: user set 1M, then GUI rewrites section for model/effort only.
        let mut text = append_section(
            "",
            "ch",
            &[
                ("model".into(), "m1".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Ch".into()),
                ("api_key".into(), "sk".into()),
                ("api_backend".into(), "chat_completions".into()),
                ("context_window".into(), "1000000".into()),
            ],
        );
        // Rewrite like upsert with preserved context_window value from parse.
        let sections = parse_model_sections(&text);
        let cw = sections[0].fields.get("context_window").cloned().unwrap();
        text = remove_section(&text, "ch");
        text = append_section(
            &text,
            "ch",
            &[
                ("model".into(), "m2".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Ch".into()),
                ("api_key".into(), "sk".into()),
                ("api_backend".into(), "chat_completions".into()),
                ("context_window".into(), cw),
            ],
        );
        assert!(
            text.contains("context_window = 1000000"),
            "rewrite must keep bare int:\n{text}"
        );
        assert!(!text.contains("context_window = \"1000000\""));
    }

    #[test]
    fn login_must_not_sync_oidc_into_custom_agent_home() {
        // grok login always writes ~/.grok/auth.json. Copying that into
        // agent-home while a custom relay is active makes the next spawn
        // send OIDC to the relay. Official stays the only route that
        // should receive the mirror.
        assert!(!should_sync_cli_auth_after_account_change(
            &ActiveRoute::Custom {
                id: "claudex".into()
            }
        ));
        assert!(should_sync_cli_auth_after_account_change(
            &ActiveRoute::Official
        ));
    }

    #[test]
    fn extra_headers_write_cli_inline_table() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!(
            "grok-app-provider-headers-{}",
            uuid::Uuid::new_v4()
        ));
        let previous_home = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &home);

        let listed = upsert_custom_provider(UpsertProviderInput {
            id: "agentrouter".into(),
            model: "claude-opus-4-6".into(),
            base_url: "https://agentrouter.org/v1".into(),
            name: Some("AgentRouter".into()),
            api_key: Some("sk-test".into()),
            api_backend: Some("chat_completions".into()),
            provider_mode: Some(PROVIDER_MODE_GENERIC.into()),
            set_as_default: Some(false),
            create_only: Some(true),
            models: None,
            efforts: None,
            context_window: None,
            base_url_full_path: Some(false),
            append_prompt: None,
            supports_vision: Some(false),
            extra_headers: Some(vec![ProviderHeaderEntry {
                name: "Originator".into(),
                value: "codex_cli_rs".into(),
            }]),
        });

        let config = std::fs::read_to_string(agent_config_toml()).ok();
        match previous_home {
            Some(value) => std::env::set_var("GROK_APP_HOME", value),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = std::fs::remove_dir_all(&home);

        let listed = listed.expect("upsert");
        assert_eq!(listed.providers[0].extra_headers.len(), 1);
        assert_eq!(listed.providers[0].extra_headers[0].name, "Originator");
        let config = config.expect("config");
        assert!(
            config.contains("extra_headers = {") && config.contains("\"Originator\""),
            "CLI extra_headers must be an inline table:\n{config}"
        );
        assert!(
            !config.contains("extra_headers = \"{"),
            "must not quote the table as a string:\n{config}"
        );
    }

    #[test]
    fn extra_headers_empty_list_clears_inline_table() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!(
            "grok-app-provider-headers-clear-{}",
            uuid::Uuid::new_v4()
        ));
        let previous_home = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &home);

        upsert_custom_provider(UpsertProviderInput {
            id: "agentrouter".into(),
            model: "claude-opus-4-6".into(),
            base_url: "https://agentrouter.org/v1".into(),
            name: Some("AgentRouter".into()),
            api_key: Some("sk-test".into()),
            api_backend: Some("chat_completions".into()),
            provider_mode: Some(PROVIDER_MODE_GENERIC.into()),
            set_as_default: Some(false),
            create_only: Some(true),
            models: None,
            efforts: None,
            context_window: None,
            base_url_full_path: Some(false),
            append_prompt: None,
            supports_vision: Some(false),
            extra_headers: Some(vec![ProviderHeaderEntry {
                name: "Originator".into(),
                value: "codex_cli_rs".into(),
            }]),
        })
        .expect("create");

        let listed = upsert_custom_provider(UpsertProviderInput {
            id: "agentrouter".into(),
            model: "claude-opus-4-6".into(),
            base_url: "https://agentrouter.org/v1".into(),
            name: Some("AgentRouter".into()),
            api_key: None,
            api_backend: Some("chat_completions".into()),
            provider_mode: Some(PROVIDER_MODE_GENERIC.into()),
            set_as_default: Some(false),
            create_only: Some(false),
            models: None,
            efforts: None,
            context_window: None,
            base_url_full_path: Some(false),
            append_prompt: None,
            supports_vision: Some(false),
            extra_headers: Some(vec![]),
        });
        let config = std::fs::read_to_string(agent_config_toml()).ok();
        match previous_home {
            Some(value) => std::env::set_var("GROK_APP_HOME", value),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = std::fs::remove_dir_all(&home);

        let listed = listed.expect("clear");
        assert!(listed.providers[0].extra_headers.is_empty());
        let config = config.expect("config");
        assert!(
            !config.contains("extra_headers"),
            "empty list must drop extra_headers, not copy the old table:\n{config}"
        );
    }
}
