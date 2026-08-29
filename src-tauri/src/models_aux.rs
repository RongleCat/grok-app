//! Auxiliary model routing — Grok Build `[models]` side-task slots.
//!
//! Mirrors Hermes-style layering using native CLI keys:
//! `image_description`, `web_search`, `session_summary`, `prompt_suggestion`.
//!
//! **Safety:** only touches those four keys under `[models]`. Never mutates
//! `[models].default`, never activates provider routes, never rewrites auth.json.

#![allow(dead_code)] // residual-clippy: prompt-rewrite / spawn-env helpers retained for routing experiments
use serde::{Deserialize, Serialize};

use crate::agent_home_config::{
    get_table_string, normalize_mode, resolve_writable_config_path, set_table_string,
    SHARED_MODE_REFUSED,
};
use crate::paths::agent_config_toml;
use crate::providers::{
    is_custom_provider_id, is_official_catalog_model, list_custom_providers, OFFICIAL_CATALOG_MODEL,
};
use crate::secrets;
use crate::store;

/// Allowlisted CLI keys under `[models]` for auxiliary tasks.
pub const AUX_KEYS: &[&str] = &[
    "image_description",
    "web_search",
    "session_summary",
    "prompt_suggestion",
];

/// Sentinel / empty → CLI uses its built-in default (typically main / grok-4.5).
pub const AUTO: &str = "auto";

/// Official Grok catalog base (from CLI `models_cache.json` / grok-4.5 info).
/// Without this, pointing `image_description = "grok-4.5"` while
/// `[models].default` is a custom relay makes the CLI hit the **relay** with
/// model id `grok-4.5` → 400 (e.g. DeepSeek rejects unknown model names).
pub const OFFICIAL_GROK_BASE_URL: &str = "https://cli-chat-proxy.grok.com/v1";
/// Official catalog uses the Responses API.
pub const OFFICIAL_GROK_API_BACKEND: &str = "responses";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelsAuxSlots {
    /// Empty / omitted = auto (no override in config).
    #[serde(default)]
    pub image_description: String,
    #[serde(default)]
    pub web_search: String,
    #[serde(default)]
    pub session_summary: String,
    #[serde(default)]
    pub prompt_suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsAuxOption {
    /// Value written to config (model / provider section id).
    pub id: String,
    pub label: String,
    /// `official` | `custom` | `auto`
    pub source: String,
    #[serde(default)]
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsAuxState {
    pub slots: ModelsAuxSlots,
    pub options: Vec<ModelsAuxOption>,
    /// `independent` | `shared`
    pub session_data_mode: String,
    pub writable: bool,
    pub config_path: String,
    /// Current `[models].default` (read-only for this panel).
    pub main_default: String,
    pub active_source: String,
    /// Suggested target for Save Grok (may be empty if none).
    pub save_grok_target: Option<String>,
    pub save_grok_label: Option<String>,
    pub save_grok_reason: String,
    /// Stable code for UI i18n (empty = healthy).
    /// `official_aux_incomplete` | `text_only_no_vision` | ""
    #[serde(default)]
    pub health_code: String,
    /// True when image attachments can be sent as pixels / described via aux.
    #[serde(default)]
    pub vision_ready: bool,
    /// True when main route looks text-only (DeepSeek, etc.).
    #[serde(default)]
    pub main_text_only: bool,
    /// True when an official API key is configured (disk/keychain meta only).
    #[serde(default)]
    pub has_official_api_key: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsAuxSetInput {
    pub image_description: Option<String>,
    pub web_search: Option<String>,
    pub session_summary: Option<String>,
    pub prompt_suggestion: Option<String>,
}

/// Normalize UI / API values: trim; treat empty, `auto`, `default` as clear.
pub fn normalize_slot_value(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower == AUTO || lower == "default" || lower == "main" {
        return None;
    }
    Some(t.to_string())
}

/// Read a single allowlisted key from `[models]` (pure).
pub fn get_slot(text: &str, key: &str) -> String {
    if !AUX_KEYS.contains(&key) {
        return String::new();
    }
    get_table_string(text, "models", key).unwrap_or_default()
}

/// Read all four slots (pure).
pub fn read_slots(text: &str) -> ModelsAuxSlots {
    ModelsAuxSlots {
        image_description: get_slot(text, "image_description"),
        web_search: get_slot(text, "web_search"),
        session_summary: get_slot(text, "session_summary"),
        prompt_suggestion: get_slot(text, "prompt_suggestion"),
    }
}

/// Remove `key` from `[table]` if present (line-oriented; preserves other keys).
pub fn remove_table_key(text: &str, table: &str, key: &str) -> String {
    let header = format!("[{table}]");
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_table = false;
    let mut removed = false;
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim().to_string();
        if trimmed.starts_with('[') {
            in_table = trimmed == header;
            i += 1;
            continue;
        }
        if in_table {
            let key_part = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key_part == key {
                lines.remove(i);
                removed = true;
                continue;
            }
        }
        i += 1;
    }
    if !removed {
        return text.to_string();
    }
    let mut joined = lines.join("\n");
    if text.ends_with('\n') && !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// Apply one slot: set quoted value or remove key when auto.
pub fn apply_slot(text: &str, key: &str, value: Option<&str>) -> String {
    if !AUX_KEYS.contains(&key) {
        return text.to_string();
    }
    match value.and_then(normalize_slot_value) {
        Some(v) => set_table_string(text, "models", key, &v),
        None => remove_table_key(text, "models", key),
    }
}

/// Apply partial slot updates (pure). Unset fields in `input` are left unchanged
/// when using `apply_set_input` with only-present semantics — here every
/// `Some` is applied; `None` means leave alone.
pub fn apply_set_input(text: &str, input: &ModelsAuxSetInput) -> String {
    let mut out = text.to_string();
    if let Some(ref v) = input.image_description {
        out = apply_slot(&out, "image_description", Some(v.as_str()));
    }
    if let Some(ref v) = input.web_search {
        out = apply_slot(&out, "web_search", Some(v.as_str()));
    }
    if let Some(ref v) = input.session_summary {
        out = apply_slot(&out, "session_summary", Some(v.as_str()));
    }
    if let Some(ref v) = input.prompt_suggestion {
        out = apply_slot(&out, "prompt_suggestion", Some(v.as_str()));
    }
    out
}

/// Remove all four auxiliary keys (pure). Leaves `default` and everything else.
pub fn reset_all_slots(text: &str) -> String {
    let mut out = text.to_string();
    for key in AUX_KEYS {
        out = remove_table_key(&out, "models", key);
    }
    out
}

/// Set all four slots to the same model id (Save Grok preset).
pub fn apply_all_slots(text: &str, model_id: &str) -> String {
    let mut out = text.to_string();
    for key in AUX_KEYS {
        out = apply_slot(&out, key, Some(model_id));
    }
    out
}

/// Ensure `[model.<id>]` has `api_key` when non-empty (does not touch other fields).
pub fn ensure_model_api_key(text: &str, model_id: &str, api_key: &str) -> String {
    let id = model_id.trim();
    let key = api_key.trim();
    if id.is_empty() || key.is_empty() {
        return text.to_string();
    }
    // Refuse path-like / weird ids
    if id.contains('[') || id.contains(']') || id.contains('\n') {
        return text.to_string();
    }
    set_table_string(text, &format!("model.{id}"), "api_key", key)
}

/// True when any aux slot currently points at the official catalog model id.
pub fn slots_reference_official(slots: &ModelsAuxSlots) -> bool {
    [
        &slots.image_description,
        &slots.web_search,
        &slots.session_summary,
        &slots.prompt_suggestion,
    ]
    .into_iter()
    .any(|v| is_official_catalog_model(v))
}

/// True when the set-input will introduce an official-catalog aux target.
pub fn input_references_official(input: &ModelsAuxSetInput) -> bool {
    [
        input.image_description.as_deref(),
        input.web_search.as_deref(),
        input.session_summary.as_deref(),
        input.prompt_suggestion.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|v| {
        normalize_slot_value(v)
            .as_deref()
            .is_some_and(is_official_catalog_model)
    })
}

/// Write a **complete** `[model.grok-4.6]` so aux calls do not inherit the
/// active custom relay's `base_url` (the bug that sent official Grok to DeepSeek).
///
/// Fields always upserted: `model`, `name`, `base_url`, `api_backend`.
/// `api_key` only when non-empty (keep previous key if empty).
pub fn ensure_official_aux_model_section(text: &str, api_key: Option<&str>) -> String {
    let table = format!("model.{OFFICIAL_CATALOG_MODEL}");
    let mut out = text.to_string();
    out = set_table_string(&out, &table, "model", OFFICIAL_CATALOG_MODEL);
    out = set_table_string(&out, &table, "name", "Grok 4.6");
    out = set_table_string(&out, &table, "base_url", OFFICIAL_GROK_BASE_URL);
    out = set_table_string(&out, &table, "api_backend", OFFICIAL_GROK_API_BACKEND);
    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        out = set_table_string(&out, &table, "api_key", key);
    }
    out
}

/// Collect official api key from unlocked secrets (may unlock keychain).
fn load_official_api_key() -> Option<String> {
    let secrets = store::load_secrets();
    secrets
        .official_api_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// After writing aux slots that target `grok-4.5`, ensure the model section is
/// routable. Returns error when on custom main route without any credential.
pub fn ensure_official_reachable(text: &str, active_source: &str) -> Result<String, String> {
    let key = load_official_api_key();
    let has_key = key.is_some();
    // Official main route can use auth.json / OIDC without a pasted API key.
    if active_source != "official" && !has_key {
        return Err(
            "image/search aux points at official Grok but no official API key is configured, \
             and the main route is a custom relay (auth.json cleared). \
             Add an official API key under Account → Custom providers → Official, \
             or point aux slots at a Grok-capable custom provider (Amux / Yun)."
                .into(),
        );
    }
    Ok(ensure_official_aux_model_section(text, key.as_deref()))
}

fn read_config_text() -> String {
    let path = agent_config_toml();
    std::fs::read_to_string(&path).unwrap_or_default()
}

fn main_default_from_text(text: &str) -> String {
    get_table_string(text, "models", "default").unwrap_or_default()
}

/// Build picker options: auto + official catalog + custom providers.
pub fn build_options(list: &crate::providers::ProvidersListResult) -> Vec<ModelsAuxOption> {
    let mut opts = vec![ModelsAuxOption {
        id: AUTO.into(),
        label: "Auto (CLI default)".into(),
        source: "auto".into(),
        hint: "Use Grok Build built-in defaults for this task".into(),
    }];

    opts.push(ModelsAuxOption {
        id: OFFICIAL_CATALOG_MODEL.into(),
        label: format!("Official · {OFFICIAL_CATALOG_MODEL}"),
        source: "official".into(),
        hint: "Grok catalog model (needs official API key when main route is custom)".into(),
    });

    for p in &list.providers {
        let name = if p.name.trim().is_empty() {
            p.id.clone()
        } else {
            p.name.clone()
        };
        let model = p.model.trim();
        let label = if model.is_empty() {
            format!("Custom · {name}")
        } else {
            format!("Custom · {name} ({model})")
        };
        opts.push(ModelsAuxOption {
            id: p.id.clone(),
            label,
            source: "custom".into(),
            hint: p.base_url.clone(),
        });
        // Also offer upstream model id if distinct and looks like a catalog model
        // so users can point slots at a multi-model channel's specific id when
        // that id is itself a [model.*] section — only if different from provider id.
        if !model.is_empty()
            && model != p.id
            && !opts.iter().any(|o| o.id == model)
            && !is_custom_provider_id(model)
        {
            // Skip bare upstream ids that aren't configured sections — picker
            // still has provider id which is what spawn/config resolves.
        }
    }
    opts
}

fn find_custom_multimodal(
    list: &crate::providers::ProvidersListResult,
) -> Option<(String, String)> {
    for p in &list.providers {
        let model = p.model.trim().to_ascii_lowercase();
        let name = p.name.to_ascii_lowercase();
        if model == OFFICIAL_CATALOG_MODEL
            || model.contains("grok-4")
            || name.contains("grok")
            || name.contains("amux")
            || name.contains("yun")
            || p.models.iter().any(|m| {
                let id = m.id.trim().to_ascii_lowercase();
                id == OFFICIAL_CATALOG_MODEL || id.contains("grok-4")
            })
        {
            let label = if p.name.trim().is_empty() {
                format!("Custom · {}", p.id)
            } else {
                format!("Custom · {}", p.name)
            };
            return Some((p.id.clone(), label));
        }
    }
    None
}

/// Resolve Save Grok target id + human label + reason code.
///
/// When main route is **custom**, prefer an already-configured multimodal
/// custom channel (full `base_url` + key) over bare `grok-4.5` — the latter
/// needs a complete `[model.grok-4.5]` section or CLI will hit the custom relay.
pub fn resolve_save_grok_target(
    list: &crate::providers::ProvidersListResult,
    has_official_api_key: bool,
) -> (Option<String>, Option<String>, String) {
    // Custom main: multimodal custom channel first (safest).
    if list.active_source == "custom" {
        if let Some((id, label)) = find_custom_multimodal(list) {
            return (Some(id), Some(label), "custom_multimodal".into());
        }
        if has_official_api_key {
            return (
                Some(OFFICIAL_CATALOG_MODEL.into()),
                Some(format!("Official · {OFFICIAL_CATALOG_MODEL}")),
                "official_api_key".into(),
            );
        }
        return (None, None, "none".into());
    }

    // Official main: prefer official catalog; custom multimodal is still ok.
    if has_official_api_key || list.active_source == "official" {
        let reason = if has_official_api_key {
            "official_api_key"
        } else {
            "official_route"
        };
        return (
            Some(OFFICIAL_CATALOG_MODEL.into()),
            Some(format!("Official · {OFFICIAL_CATALOG_MODEL}")),
            reason.into(),
        );
    }

    if let Some((id, label)) = find_custom_multimodal(list) {
        return (Some(id), Some(label), "custom_multimodal".into());
    }

    (None, None, "none".into())
}

/// Load full panel state.
pub fn get_state() -> Result<ModelsAuxState, String> {
    // Best-effort: heal image_description=grok-4.5 without official base_url.
    let _ = repair_orphaned_official_aux();

    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode).to_string();
    let writable = mode == "independent";
    let list = list_custom_providers()?;
    let text = read_config_text();
    let slots = read_slots(&text);
    let main_default = main_default_from_text(&text);
    // Disk-only presence: do not unlock Keychain just to paint settings.
    let disk = secrets::load_secrets_disk_only();
    let has_key = secrets::has_official_key_configured(&disk);
    let (save_target, save_label, save_reason) = resolve_save_grok_target(&list, has_key);

    let config_path = if writable {
        resolve_writable_config_path(&mode)
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| agent_config_toml().display().to_string())
    } else {
        // Shared: show user grok home config for honesty (read-only).
        crate::process_util::user_home()
            .join(".grok")
            .join("config.toml")
            .display()
            .to_string()
    };

    let vision_ready = vision_aux_reachable(&text, &list);
    let text_only = main_is_text_only(&text, &list);
    let health_code = if text_only && !vision_ready && slots_reference_official(&slots) {
        "official_aux_incomplete".into()
    } else if text_only && !vision_ready {
        "text_only_no_vision".into()
    } else {
        String::new()
    };

    Ok(ModelsAuxState {
        slots,
        options: build_options(&list),
        session_data_mode: mode,
        writable,
        config_path,
        main_default,
        active_source: list.active_source,
        save_grok_target: save_target,
        save_grok_label: save_label,
        save_grok_reason: save_reason,
        health_code,
        vision_ready,
        main_text_only: text_only,
        has_official_api_key: has_key,
    })
}

fn refuse_if_shared(mode: &str) -> Result<(), String> {
    if normalize_mode(mode) == "shared" {
        Err(SHARED_MODE_REFUSED.into())
    } else {
        Ok(())
    }
}

/// Write partial slot updates; returns new state.
pub fn set_slots(input: ModelsAuxSetInput) -> Result<ModelsAuxState, String> {
    let settings = store::load_settings();
    refuse_if_shared(&settings.session_data_mode)?;
    let path = resolve_writable_config_path(&settings.session_data_mode)?;
    let list = list_custom_providers()?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut next = apply_set_input(&existing, &input);
    let after = read_slots(&next);
    if slots_reference_official(&after) || input_references_official(&input) {
        next = ensure_official_reachable(&next, &list.active_source)?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, next).map_err(|e| e.to_string())?;
    get_state()
}

/// Apply Save Grok preset (all four → resolved target).
pub fn apply_save_grok() -> Result<ModelsAuxState, String> {
    let settings = store::load_settings();
    refuse_if_shared(&settings.session_data_mode)?;
    let list = list_custom_providers()?;
    let disk = secrets::load_secrets_disk_only();
    let has_key = secrets::has_official_key_configured(&disk);
    let (target, _label, reason) = resolve_save_grok_target(&list, has_key);
    let target = target.ok_or_else(|| {
        format!(
            "no multimodal target for Save Grok (reason={reason}): add an official API key or a Grok-capable custom provider"
        )
    })?;

    let path = resolve_writable_config_path(&settings.session_data_mode)?;
    let mut existing = std::fs::read_to_string(&path).unwrap_or_default();

    // Official catalog id as aux requires a full [model.grok-4.6] section with
    // the Grok base_url — never inherit DeepSeek/Amux/etc. base_url.
    if is_official_catalog_model(&target) {
        existing = ensure_official_reachable(&existing, &list.active_source)?;
    }

    let next = apply_all_slots(&existing, &target);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, next).map_err(|e| e.to_string())?;
    get_state()
}

/// Image file extensions that Grok Build may attach as multimodal `image_url`.
const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "avif",
];

fn path_is_image(path: &str) -> bool {
    let p = path.trim();
    let ext = p
        .rsplit(['/', '\\'])
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    IMAGE_EXTS.iter().any(|e| *e == ext)
}

/// Known multimodal / vision-capable markers (provider id, name, or model id).
pub fn looks_vision_model(id_or_name: &str) -> bool {
    let s = id_or_name.trim().to_ascii_lowercase();
    if s.is_empty() {
        return false;
    }
    s.contains("grok")
        || s.contains("gpt-4o")
        || s.contains("gpt-4.1")
        || s.contains("claude")
        || s.contains("gemini")
        || s.contains("-vl")
        || s.contains("vision")
        || s.contains("pixtral")
        || s.contains("qwen-vl")
}

/// Known text-only / non-vision main model heuristics (provider id or upstream id).
pub fn looks_text_only_model(id_or_name: &str) -> bool {
    let s = id_or_name.trim().to_ascii_lowercase();
    if s.is_empty() {
        return false;
    }
    if looks_vision_model(&s) {
        return false;
    }
    s.contains("deepseek")
        || s.contains("coder")
        || s.contains("r1")
        || s.contains("v3")
        || s.contains("v4-flash")
        || s.contains("v4-pro")
        || s.contains("v4_flash")
        || s.contains("v4_pro")
}

/// Custom channel is vision-capable when the **active** model opted in, or the
/// id / name / active model looks multimodal. Unknown relays stay text-only.
/// Per-model `supports_vision` wins over the channel flag so mixed catalogs
/// (DeepSeek flash + vision-exp) do not treat every row as vision.
pub fn custom_provider_is_text_only(p: &crate::providers::CustomProvider) -> bool {
    let active = p
        .models
        .iter()
        .find(|m| m.id.trim() == p.model.trim())
        .or_else(|| p.models.first());
    if let Some(m) = active {
        match m.supports_vision {
            Some(true) => return false,
            Some(false) => {
                return !(looks_vision_model(&m.id) || looks_vision_model(&m.name));
            }
            None => {
                if p.supports_vision || looks_vision_model(&m.id) || looks_vision_model(&m.name) {
                    return false;
                }
            }
        }
    }
    if p.supports_vision {
        return false;
    }
    if looks_vision_model(&p.id) || looks_vision_model(&p.model) || looks_vision_model(&p.name) {
        return false;
    }
    true
}

/// Whether the configured image_description target can actually be reached
/// (has its own base_url for official, or is a custom provider section).
pub fn vision_aux_reachable(text: &str, list: &crate::providers::ProvidersListResult) -> bool {
    let slot = get_slot(text, "image_description");
    let Some(target) = normalize_slot_value(&slot) else {
        // auto → follows main model; only ok if main is vision-capable
        return !main_is_text_only(text, list);
    };
    if is_official_catalog_model(&target) {
        let table = format!("model.{target}");
        let base = get_table_string(text, &table, "base_url").unwrap_or_default();
        let key = get_table_string(text, &table, "api_key").unwrap_or_default();
        let ok_base = base.contains("cli-chat-proxy.grok.com") || base.contains("api.x.ai");
        // On official route auth.json may substitute for api_key
        let ok_cred = !key.is_empty() || list.active_source == "official";
        return ok_base && ok_cred;
    }
    // Custom provider id must exist with base_url
    list.providers
        .iter()
        .any(|p| p.id == target && !p.base_url.trim().is_empty() && p.has_api_key)
}

pub fn main_is_text_only(text: &str, list: &crate::providers::ProvidersListResult) -> bool {
    if list.active_source == "official" {
        return false;
    }
    let def = main_default_from_text(text);
    if def.is_empty() || def == crate::providers::OFFICIAL_DEFAULT_MODEL {
        return list.active_source != "official";
    }
    if let Some(p) = list.providers.iter().find(|p| p.id == def) {
        return custom_provider_is_text_only(p);
    }
    looks_text_only_model(&def)
}

/// Collect absolute `@/path` / `@C:\path` image refs from a prompt (any line).
pub fn extract_image_at_paths(prompt: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in prompt.lines() {
        let trimmed = line.trim();
        if let Some(path) = parse_at_abs_path(trimmed) {
            if path_is_image(path) && !out.iter().any(|p| p == path) {
                out.push(path.to_string());
            }
        }
        // Mid-line tokens
        let (_, found) = strip_inline_image_at_refs(line);
        for p in found {
            if !out.iter().any(|x| x == &p) {
                out.push(p);
            }
        }
    }
    out
}

fn parse_at_abs_path(trimmed: &str) -> Option<&str> {
    let path = trimmed.strip_prefix('@')?;
    if path.starts_with('/') {
        return Some(path);
    }
    // Windows `C:\` or `C:/`
    let b = path.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
    {
        return Some(path);
    }
    None
}

/// Strip image `@path` refs (sole-line **and** mid-line). Returns (new_prompt, stripped_paths).
pub fn strip_image_at_paths(prompt: &str) -> (String, Vec<String>) {
    let mut stripped: Vec<String> = Vec::new();
    let mut out_lines: Vec<String> = Vec::new();

    for line in prompt.lines() {
        let trimmed = line.trim();
        // Sole-line @path (common composer form)
        if let Some(path) = parse_at_abs_path(trimmed) {
            if path_is_image(path) {
                if !stripped.iter().any(|p| p == path) {
                    stripped.push(path.to_string());
                }
                continue;
            }
        }
        // Mid-line: scan for @/…image.ext tokens without the regex crate.
        let (rest, found) = strip_inline_image_at_refs(line);
        for p in found {
            if !stripped.iter().any(|x| x == &p) {
                stripped.push(p);
            }
        }
        let rest = rest.trim().to_string();
        if rest.is_empty() {
            continue;
        }
        out_lines.push(rest);
    }
    while out_lines
        .last()
        .map(|l| l.trim().is_empty())
        .unwrap_or(false)
    {
        out_lines.pop();
    }
    (out_lines.join("\n"), stripped)
}

/// Remove mid-line `@/abs/img.png` (or Windows) tokens; collect paths.
///
/// **Must** walk by `char` (not raw bytes): `bytes[i] as char` corrupts UTF-8
/// Chinese captions and broke X-intent detection after strip.
fn strip_inline_image_at_refs(line: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(line.len());
    let mut found = Vec::new();
    let mut chars = line.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '@' {
            let rest = &line[i + c.len_utf8()..];
            // Absolute unix or Windows path
            let is_abs = rest.starts_with('/')
                || (rest.len() >= 3
                    && rest.as_bytes()[0].is_ascii_alphabetic()
                    && rest.as_bytes()[1] == b':'
                    && (rest.as_bytes()[2] == b'\\' || rest.as_bytes()[2] == b'/'));
            if is_abs {
                let end = rest
                    .find(|ch: char| ch.is_whitespace() || ch == '@')
                    .unwrap_or(rest.len());
                let path = &rest[..end];
                if path_is_image(path) {
                    found.push(path.to_string());
                    // Skip the path chars we just consumed (rest is a slice of line).
                    let skip_to = i + c.len_utf8() + end;
                    while chars.peek().map(|(j, _)| *j < skip_to).unwrap_or(false) {
                        chars.next();
                    }
                    continue;
                }
            }
        }
        out.push(c);
    }
    // Collapse double spaces left by removals
    let mut cleaned = out;
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    (cleaned, found)
}

/// Pure: for text-only main models, **always** strip image `@path` lines so the
/// CLI never injects `image_url` into DeepSeek/chat_completions — even when
/// vision aux is configured (CLI routing of image_description is unreliable
/// across custom relays; Host describes images instead).
///
/// `vision_aux_ok` only changes the fallback note text (legacy param kept for tests).
pub fn rewrite_prompt_guard_text_only(
    prompt: &str,
    text_only_main: bool,
    _vision_aux_ok: bool,
) -> String {
    if !text_only_main {
        return prompt.to_string();
    }
    let (body, stripped) = strip_image_at_paths(prompt);
    if stripped.is_empty() {
        return prompt.to_string();
    }
    let list = stripped
        .iter()
        .map(|p| format!("- {p}"))
        .collect::<Vec<_>>()
        .join("\n");
    let note = format!(
        "\n\n[Image file path(s) — not injected as pixels for the text-only main model:\n{list}]"
    );
    if body.trim().is_empty() {
        note.trim_start().to_string()
    } else {
        format!("{body}{note}")
    }
}

/// Live config: rewrite agent prompt when needed. Never touches journal UI text.
/// Prefer [`prepare_agent_prompt_for_main`] which also Host-describes images.
pub fn maybe_rewrite_agent_prompt(prompt: &str) -> String {
    let text = read_config_text();
    let list = match list_custom_providers() {
        Ok(l) => l,
        Err(_) => return prompt.to_string(),
    };
    let text_only = main_is_text_only(&text, &list);
    rewrite_prompt_guard_text_only(prompt, text_only, false)
}

/// Env vars injected into every ACP agent spawn so CLI honors aux slots even if
/// config.toml was written after the process binary cached defaults.
///
/// Keys match Grok Build: `GROK_WEB_SEARCH_MODEL`, `GROK_IMAGE_DESCRIPTION_MODEL`,
/// `GROK_SESSION_SUMMARY_MODEL`, `GROK_PROMPT_SUGGESTIONS_MODEL`.
pub fn aux_model_spawn_env() -> Vec<(String, String)> {
    let text = read_config_text();
    let pairs = [
        ("image_description", "GROK_IMAGE_DESCRIPTION_MODEL"),
        ("web_search", "GROK_WEB_SEARCH_MODEL"),
        ("session_summary", "GROK_SESSION_SUMMARY_MODEL"),
        ("prompt_suggestion", "GROK_PROMPT_SUGGESTIONS_MODEL"),
    ];
    let mut out = Vec::new();
    for (slot, env) in pairs {
        if let Some(v) = normalize_slot_value(&get_slot(&text, slot)) {
            out.push((env.to_string(), v));
        }
    }
    out
}

/// Run a one-shot `grok -p` under App agent-home with an explicit model section
/// id (e.g. `amux`, `yun-api`, `grok-4.5`). Independent of the interactive
/// session's main model — Hermes-style side-channel.
///
/// Used for Host-driven aux jobs (search, probes). The child inherits
/// `GROK_HOME` so `[model.<id>]` credentials resolve correctly.
pub fn run_aux_headless(
    model_id: &str,
    prompt: &str,
    max_turns: u32,
    timeout: std::time::Duration,
) -> Result<String, String> {
    use std::process::Command;
    use std::time::Instant;

    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Err("model_id is required".into());
    }
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }

    let settings = store::load_settings();
    let mode = normalize_mode(&settings.session_data_mode);
    // Headless must use the same agent-home as interactive (custom models live there).
    let grok_home = crate::paths::resolve_agent_grok_home(mode);
    let probe = crate::cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let cli = probe
        .path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "grok CLI not found".to_string())?;

    let mut cmd = Command::new(&cli);
    cmd.arg("--no-auto-update")
        .arg("-p")
        .arg(prompt)
        .arg("-m")
        .arg(model_id)
        .arg("--always-approve")
        .arg("--max-turns")
        .arg(max_turns.clamp(1, 24).to_string())
        .arg("--effort")
        .arg("low")
        .arg("--output-format")
        .arg("plain");
    cmd.env("GROK_HOME", &grok_home);
    crate::process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    crate::proxy::apply_to_std_command(&mut cmd);

    tracing::info!(
        target: "models_aux",
        "aux headless start model={model_id} home={} prompt_chars={}",
        grok_home.display(),
        prompt.len()
    );

    let started = Instant::now();
    let output = std::thread::spawn(move || cmd.output())
        .join()
        .map_err(|_| "aux headless thread join failed".to_string())?
        .map_err(|e| format!("aux headless spawn: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let elapsed = started.elapsed();
    if elapsed > timeout {
        tracing::warn!(
            target: "models_aux",
            "aux headless slow model={model_id} elapsed={elapsed:?}"
        );
    }
    if !output.status.success() && stdout.trim().is_empty() {
        let preview: String = stderr.chars().take(400).collect();
        return Err(format!("aux headless failed: {preview}"));
    }
    if stdout.trim().is_empty() {
        let preview: String = stderr.chars().take(400).collect();
        return Err(format!("aux headless empty stdout: {preview}"));
    }
    Ok(stdout)
}

/// Resolve the model id currently configured for web_search (or None = auto).
pub fn web_search_model_id() -> Option<String> {
    normalize_slot_value(&get_slot(&read_config_text(), "web_search"))
}

/// Host-side web search via independent `grok -p -m <aux>`.
/// Does **not** use the live ACP session model.
pub fn headless_web_search(query: &str) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let model = web_search_model_id()
        .or_else(|| {
            // Prefer multimodal custom channel if web_search is auto
            let list = list_custom_providers().ok()?;
            find_custom_multimodal(&list).map(|(id, _)| id)
        })
        .ok_or_else(|| {
            "no web_search aux model configured — set Model layers → Web search to Amux/Yun/official"
                .to_string()
        })?;

    let prompt = format!(
        r#"You are a research helper running as an isolated side-job (not the main coding agent).

Task: search the web for current information and return a concise answer.

Query: {q}

Instructions:
1. Use the web_search / web_fetch tools if available.
2. Prefer primary sources; include URLs.
3. Reply in the same language as the query.
4. Do not edit files or run shell commands except tools needed for search.
5. Final answer: short markdown with findings + link list."#
    );

    run_aux_headless(&model, &prompt, 8, std::time::Duration::from_secs(180))
}
struct VisionEndpoint {
    base_url: String,
    model: String,
    api_key: String,
    api_backend: String,
}

fn resolve_vision_endpoint(
    config: &str,
    list: &crate::providers::ProvidersListResult,
) -> Option<VisionEndpoint> {
    let slot = get_slot(config, "image_description");
    let target = normalize_slot_value(&slot)?;
    if is_official_catalog_model(&target) {
        let table = format!("model.{target}");
        let base = get_table_string(config, &table, "base_url")
            .unwrap_or_else(|| OFFICIAL_GROK_BASE_URL.into());
        let key = get_table_string(config, &table, "api_key").unwrap_or_default();
        if key.is_empty() {
            return None;
        }
        let backend = get_table_string(config, &table, "api_backend")
            .unwrap_or_else(|| OFFICIAL_GROK_API_BACKEND.into());
        return Some(VisionEndpoint {
            base_url: base,
            model: target,
            api_key: key,
            api_backend: backend,
        });
    }
    let p = list.providers.iter().find(|p| p.id == target)?;
    if p.base_url.trim().is_empty() {
        return None;
    }
    // Prefer key from config.toml (not exposed on list)
    let key = get_table_string(config, &format!("model.{}", p.id), "api_key").unwrap_or_default();
    if key.is_empty() {
        return None;
    }
    let model = if p.model.trim().is_empty() {
        p.id.clone()
    } else {
        p.model.clone()
    };
    let backend = get_table_string(config, &format!("model.{}", p.id), "api_backend")
        .unwrap_or_else(|| p.api_backend.clone());
    Some(VisionEndpoint {
        base_url: p.base_url.clone(),
        model,
        api_key: key,
        api_backend: backend,
    })
}

fn mime_for_path(path: &str) -> &'static str {
    match path_ext(path).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn path_ext(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .and_then(|n| n.rsplit_once('.'))
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

const MAX_VISION_IMAGE_BYTES: u64 = 6 * 1024 * 1024;
const MAX_VISION_IMAGES: usize = 3;

/// Describe one local image via OpenAI-compatible chat_completions or responses.
async fn describe_image_http(ep: &VisionEndpoint, path: &str) -> Result<String, String> {
    use base64::Engine;
    let meta = std::fs::metadata(path).map_err(|e| format!("stat {path}: {e}"))?;
    if meta.len() > MAX_VISION_IMAGE_BYTES {
        return Err(format!(
            "image too large ({} bytes > {MAX_VISION_IMAGE_BYTES})",
            meta.len()
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime = mime_for_path(path);
    let data_url = format!("data:{mime};base64,{b64}");
    let base = ep.base_url.trim().trim_end_matches('/');
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let prompt_text = "Describe this image thoroughly for a coding agent: UI text, layout, errors, code, diagrams, colors, and any actionable detail. Use the same language as any visible UI text when possible. Be concrete; do not refuse.";

    let (url, body) = if ep.api_backend == "responses" {
        (
            format!("{base}/responses"),
            serde_json::json!({
                "model": ep.model,
                "input": [{
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt_text},
                        {"type": "input_image", "image_url": data_url}
                    ]
                }]
            }),
        )
    } else {
        // chat_completions (and messages fallback shape)
        (
            format!("{base}/chat/completions"),
            serde_json::json!({
                "model": ep.model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "image_url", "image_url": {"url": data_url}}
                    ]
                }]
            }),
        )
    };

    let res = client
        .post(&url)
        .bearer_auth(&ep.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vision request: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("vision body: {e}"))?;
    if !status.is_success() {
        let preview: String = text.chars().take(280).collect();
        return Err(format!("vision HTTP {status}: {preview}"));
    }
    extract_vision_reply(&text, &ep.api_backend)
}

fn extract_vision_reply(raw: &str, api_backend: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("vision json: {e}"))?;
    if api_backend == "responses" {
        // Prefer output_text, then walk output[].content[].text
        if let Some(s) = v.get("output_text").and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Ok(t.to_string());
            }
        }
        if let Some(arr) = v.get("output").and_then(|x| x.as_array()) {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                    for c in content {
                        if let Some(t) = c.get("text").and_then(|t| t.as_str()) {
                            parts.push(t.to_string());
                        }
                    }
                }
            }
            let joined = parts.join("\n").trim().to_string();
            if !joined.is_empty() {
                return Ok(joined);
            }
        }
    }
    // chat_completions
    if let Some(s) = v
        .pointer("/choices/0/message/content")
        .and_then(|x| x.as_str())
    {
        let t = s.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    Err("vision response had no text".into())
}

/// True when Host will run side-channel vision before the main model turn
/// (custom text-only main + image `@path` in prompt). Used for UI chip.
///
/// Official Grok subscription route: always false (native multimodal).
pub fn host_vision_will_run(prompt: &str) -> bool {
    // Hard gate: never Host-describe on official main (avoid double vision).
    if list_custom_providers()
        .map(|l| l.active_source == "official")
        .unwrap_or(true)
    {
        return false;
    }
    let config = read_config_text();
    let Ok(list) = list_custom_providers() else {
        return false;
    };
    if !main_is_text_only(&config, &list) {
        return false;
    }
    !extract_image_at_paths(prompt).is_empty()
}

/// Outcome of Host vision side-channel (for tool chip complete/fail).
#[derive(Debug, Clone)]
pub struct HostVisionPrep {
    pub prompt: String,
    /// Whether we attempted host vision (images present on text-only main).
    pub ran: bool,
    /// True if at least one description succeeded (official or HTTP).
    pub ok: bool,
    /// Short status for logs / legacy chips.
    pub detail: String,
    /// Full description text for journal / expandable tool body (may be long).
    pub description: String,
}

/// Full pipeline for a **final** agent prompt (after history bootstrap):
/// - text-only main → strip all image `@path` (CLI must not inject image_url)
/// - Host describes images: **prefer official ACP**, else `grok -p`, else Amux HTTP
///
/// Safe to call for every send; no-op when main is multimodal.
pub async fn prepare_agent_prompt_for_main(prompt: &str) -> String {
    prepare_agent_prompt_for_main_detailed(prompt, None)
        .await
        .prompt
}

/// Same as [`prepare_agent_prompt_for_main`] plus outcome for UI tool chips.
///
/// `progress` bridges official ACP stream/tool updates into the main chat chip.
pub async fn prepare_agent_prompt_for_main_detailed(
    prompt: &str,
    progress: Option<crate::official_aux::OfficialProgressCb>,
) -> HostVisionPrep {
    let config = read_config_text();
    let list = match list_custom_providers() {
        Ok(l) => l,
        Err(_) => {
            return HostVisionPrep {
                prompt: prompt.to_string(),
                ran: false,
                ok: false,
                detail: String::new(),
                description: String::new(),
            };
        }
    };
    if !main_is_text_only(&config, &list) {
        return HostVisionPrep {
            prompt: prompt.to_string(),
            ran: false,
            ok: false,
            detail: String::new(),
            description: String::new(),
        };
    }

    let images = extract_image_at_paths(prompt);
    let (mut stripped, _) = strip_image_at_paths(prompt);
    if images.is_empty() {
        return HostVisionPrep {
            prompt: stripped,
            ran: false,
            ok: false,
            detail: String::new(),
            description: String::new(),
        };
    }

    let batch: Vec<String> = images.iter().take(MAX_VISION_IMAGES).cloned().collect();
    let mut blocks: Vec<String> = Vec::new();

    // 1) Official ACP vision (isolated GROK_HOME + auth; stream → chip) — preferred.
    if crate::official_aux::official_aux_available() {
        let paths = batch.clone();
        match crate::official_aux::vision_describe_async(&paths, None, progress).await {
            Ok(text) => {
                tracing::info!(
                    target: "models_aux",
                    "official ACP vision ok chars={}",
                    text.len()
                );
                blocks.push(text);
            }
            Err(e) => {
                tracing::warn!(target: "models_aux", "official vision failed: {e}");
                blocks.push(format!("[official vision failed: {e}]"));
            }
        }
    }

    // 2) Fallback: HTTP vision via image_description slot (Amux/Yun/…).
    if blocks.is_empty() || blocks.iter().all(|b| b.contains("failed")) {
        blocks.clear();
        let ep = resolve_vision_endpoint(&config, &list);
        if let Some(ref endpoint) = ep {
            for path in &batch {
                match describe_image_http(endpoint, path).await {
                    Ok(desc) => {
                        tracing::info!(
                            target: "models_aux",
                            "host vision ok path={} chars={} via {}",
                            path,
                            desc.len(),
                            endpoint.model
                        );
                        blocks.push(format!(
                            "<image_description path=\"{path}\">\n{desc}\n</image_description>"
                        ));
                    }
                    Err(e) => {
                        tracing::warn!(target: "models_aux", "host vision failed path={path}: {e}");
                        blocks.push(format!(
                            "<image_description path=\"{path}\">\n[vision failed: {e}]\n</image_description>"
                        ));
                    }
                }
            }
        } else if blocks.is_empty() {
            let list = images
                .iter()
                .map(|p| format!("- {p}"))
                .collect::<Vec<_>>()
                .join("\n");
            blocks.push(format!(
                "[Images not described — sign in with Grok (official aux) or set Model layers image_description. Paths:\n{list}]"
            ));
        }
    }

    if images.len() > MAX_VISION_IMAGES {
        blocks.push(format!(
            "[Note: {} more image(s) omitted from host vision (cap {MAX_VISION_IMAGES})]",
            images.len() - MAX_VISION_IMAGES
        ));
    }

    while stripped.ends_with('\n') {
        stripped.pop();
    }
    // Vision models often echo `@/path/to.png` in their reply. If we inject that
    // text as-is, the main CLI re-attaches image_url → DeepSeek 400. Neutralize.
    let inject = neutralize_image_at_refs(&blocks.join("\n\n"));
    let ok = !blocks.is_empty()
        && !blocks
            .iter()
            .all(|b| b.contains("failed") || b.contains("not described") || b.contains("omitted"));
    // Non-technical chip detail (UI must not show `grok -p` command lines).
    let detail = if ok {
        format!("{} image(s)", batch.len().min(MAX_VISION_IMAGES))
    } else {
        "unavailable".into()
    };
    // Full description for journal / expandable tool body.
    let description = inject.chars().take(8_000).collect::<String>();
    let mut prompt = if stripped.trim().is_empty() {
        inject
    } else {
        format!(
            "{stripped}\n\n[Host vision — image pixels were NOT sent to the main model. Use the descriptions below; do not claim you cannot see the image. Do NOT call vision_describe again unless a description block is missing or failed.]\n\n{inject}"
        )
    };
    // Final hard strip: no `@image` may reach text-only main (bootstrap / inject / hints).
    let (final_prompt, leaked) = strip_image_at_paths(&prompt);
    if !leaked.is_empty() {
        tracing::warn!(
            target: "models_aux",
            "stripped {} residual image @path(s) before main prompt",
            leaked.len()
        );
        prompt = final_prompt;
        if prompt.trim().is_empty() {
            prompt = "[Image attached — description unavailable after sanitize.]".into();
        }
    } else {
        prompt = final_prompt;
    }
    // Belt-and-suspenders: rewrite any remaining mid-line @image tokens.
    prompt = neutralize_image_at_refs(&prompt);
    HostVisionPrep {
        prompt,
        ran: true,
        ok,
        detail,
        description,
    }
}

/// Replace `@/abs/image.ext` tokens with a non-attachable form so Grok Build
/// will not inject multimodal `image_url` blocks.
pub fn neutralize_image_at_refs(text: &str) -> String {
    let (body, found) = strip_image_at_paths(text);
    if found.is_empty() {
        return text.to_string();
    }
    // Re-insert paths as plain text (no leading `@`) so context remains.
    let mut out = body;
    for p in found {
        // Only append a path list once at the end if body lost sole-line refs.
        if !out.contains(&p) {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(&format!("(image path: {p})"));
        }
    }
    out
}

/// Repair orphaned `image_description = "grok-4.5"` (etc.) that lack a proper
/// `[model.grok-4.5]` section. Soft-fails when credentials missing.
pub fn repair_orphaned_official_aux() -> Result<bool, String> {
    let settings = store::load_settings();
    if normalize_mode(&settings.session_data_mode) != "independent" {
        return Ok(false);
    }
    let path = resolve_writable_config_path(&settings.session_data_mode)?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let slots = read_slots(&existing);
    if !slots_reference_official(&slots) {
        return Ok(false);
    }
    let base = get_table_string(
        &existing,
        &format!("model.{OFFICIAL_CATALOG_MODEL}"),
        "base_url",
    )
    .unwrap_or_default();
    if base.contains("cli-chat-proxy.grok.com") || base.contains("api.x.ai") {
        // Section already points at official; ensure api_key if we have one.
        let key = load_official_api_key();
        if key.is_none() {
            return Ok(false);
        }
        let next = ensure_official_aux_model_section(&existing, key.as_deref());
        if next == existing {
            return Ok(false);
        }
        std::fs::write(&path, next).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let list = list_custom_providers()?;
    match ensure_official_reachable(&existing, &list.active_source) {
        Ok(next) => {
            if next == existing {
                return Ok(false);
            }
            std::fs::write(&path, next).map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(e) => {
            tracing::warn!(target: "models_aux", "repair_orphaned_official_aux: {e}");
            Ok(false)
        }
    }
}

/// Restore CLI defaults: drop the four override keys only.
pub fn reset_defaults() -> Result<ModelsAuxState, String> {
    let settings = store::load_settings();
    refuse_if_shared(&settings.session_data_mode)?;
    let path = resolve_writable_config_path(&settings.session_data_mode)?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let next = reset_all_slots(&existing);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, next).map_err(|e| e.to_string())?;
    get_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
[models]
default = "deepseek"
max_retries = 8
image_description = "grok-4.5"
web_search = "amux"

[model.deepseek]
model = "deepseek-v4-pro"
base_url = "https://api.deepseek.com/v1"
api_key = "sk-ds"

[model.amux]
model = "grok-4.5"
base_url = "https://api.amux.ai/v1"
api_key = "sk-amux"

[ui]
yolo = false
"#;

    #[test]
    fn read_slots_only_aux_keys() {
        let s = read_slots(SAMPLE);
        assert_eq!(s.image_description, "grok-4.5");
        assert_eq!(s.web_search, "amux");
        assert!(s.session_summary.is_empty());
        assert!(s.prompt_suggestion.is_empty());
    }

    #[test]
    fn reset_preserves_default_and_model_sections() {
        let next = reset_all_slots(SAMPLE);
        assert!(next.contains("default = \"deepseek\""), "{next}");
        assert!(next.contains("max_retries = 8"), "{next}");
        assert!(!next.contains("image_description"), "{next}");
        assert!(!next.contains("web_search ="), "{next}");
        assert!(next.contains("[model.deepseek]"), "{next}");
        assert!(next.contains("sk-ds"), "{next}");
        assert!(next.contains("[model.amux]"), "{next}");
        assert!(next.contains("[ui]"), "{next}");
        assert!(next.contains("yolo = false"), "{next}");
    }

    #[test]
    fn apply_all_does_not_touch_default() {
        let next = apply_all_slots(SAMPLE, "grok-4.5");
        assert!(next.contains("default = \"deepseek\""), "{next}");
        assert!(next.contains("image_description = \"grok-4.5\""), "{next}");
        assert!(next.contains("web_search = \"grok-4.5\""), "{next}");
        assert!(next.contains("session_summary = \"grok-4.5\""), "{next}");
        assert!(next.contains("prompt_suggestion = \"grok-4.5\""), "{next}");
        assert!(next.contains("sk-ds"), "{next}");
    }

    #[test]
    fn apply_slot_auto_removes_key() {
        let next = apply_slot(SAMPLE, "image_description", Some("auto"));
        assert!(!next.contains("image_description"), "{next}");
        assert!(next.contains("web_search = \"amux\""), "{next}");
        assert!(next.contains("default = \"deepseek\""), "{next}");
    }

    #[test]
    fn apply_set_input_partial() {
        let next = apply_set_input(
            SAMPLE,
            &ModelsAuxSetInput {
                session_summary: Some("grok-4.5".into()),
                image_description: Some("auto".into()),
                ..Default::default()
            },
        );
        assert!(!next.contains("image_description"), "{next}");
        assert!(next.contains("session_summary = \"grok-4.5\""), "{next}");
        assert!(next.contains("web_search = \"amux\""), "{next}");
        assert!(next.contains("default = \"deepseek\""), "{next}");
    }

    #[test]
    fn ensure_model_api_key_upsert() {
        let t = ensure_model_api_key(SAMPLE, "grok-4.5", "sk-official");
        assert!(t.contains("[model.grok-4.5]"), "{t}");
        assert!(t.contains("api_key = \"sk-official\""), "{t}");
        assert!(t.contains("[model.deepseek]"), "{t}");
        // default untouched
        assert!(t.contains("default = \"deepseek\""), "{t}");
    }

    #[test]
    fn ensure_official_aux_writes_base_url_not_deepseek() {
        let t = ensure_official_aux_model_section(SAMPLE, Some("sk-official"));
        let official_table = format!("[model.{OFFICIAL_CATALOG_MODEL}]");
        assert!(t.contains(&official_table), "{t}");
        assert!(
            t.contains("base_url = \"https://cli-chat-proxy.grok.com/v1\""),
            "{t}"
        );
        assert!(t.contains("api_backend = \"responses\""), "{t}");
        assert!(t.contains("api_key = \"sk-official\""), "{t}");
        // Must not rewrite main default or deepseek section
        assert!(t.contains("default = \"deepseek\""), "{t}");
        assert!(t.contains("https://api.deepseek.com/v1"), "{t}");
        // Official section must not reuse DeepSeek host
        let off = t.split(official_table.as_str()).nth(1).unwrap_or("");
        assert!(
            off.contains("cli-chat-proxy.grok.com"),
            "official base missing: {off}"
        );
        assert!(
            !off.contains("api.deepseek.com"),
            "official section must not use deepseek host: {off}"
        );
    }

    #[test]
    fn rewrite_strips_image_at_paths_when_text_only() {
        let prompt = "这张图内容是什么\n\n@/Users/me/pic.png\n@/Users/me/note.txt";
        let out = rewrite_prompt_guard_text_only(prompt, true, false);
        assert!(!out.contains("@/Users/me/pic.png"), "{out}");
        assert!(out.contains("@/Users/me/note.txt"), "{out}");
        assert!(out.contains("/Users/me/pic.png"), "{out}");
        assert!(
            out.contains("text-only") || out.contains("not injected"),
            "{out}"
        );
    }

    #[test]
    fn rewrite_always_strips_images_for_text_only_even_if_vision_ok() {
        // CLI image_description routing is unreliable; Host path always strips.
        let prompt = "看图\n\n@/Users/me/pic.png";
        let out = rewrite_prompt_guard_text_only(prompt, true, true);
        assert!(!out.contains("@/Users/me/pic.png"), "{out}");
    }

    fn sample_provider(
        id: &str,
        model: &str,
        name: &str,
        supports_vision: bool,
    ) -> crate::providers::CustomProvider {
        crate::providers::CustomProvider {
            id: id.into(),
            model: model.into(),
            base_url: "https://example.com/v1".into(),
            name: name.into(),
            has_api_key: true,
            api_backend: "chat_completions".into(),
            provider_mode: crate::providers::PROVIDER_MODE_GENERIC.into(),
            is_default: true,
            models: vec![],
            efforts: vec![],
            context_window: None,
            base_url_full_path: false,
            append_prompt: None,
            supports_vision,
            extra_headers: vec![],
        }
    }

    #[test]
    fn custom_vision_flag_and_name_are_not_text_only() {
        assert!(custom_provider_is_text_only(&sample_provider(
            "relay", "foo-1", "My API", false
        )));
        assert!(!custom_provider_is_text_only(&sample_provider(
            "relay", "foo-1", "My API", true
        )));
        assert!(!custom_provider_is_text_only(&sample_provider(
            "relay",
            "foo-1",
            "第三方 Grok API",
            false
        )));
        assert!(!custom_provider_is_text_only(&sample_provider(
            "relay",
            "gpt-4o-mini",
            "Relay",
            false
        )));
        assert!(custom_provider_is_text_only(&sample_provider(
            "deepseek",
            "deepseek-v4-flash",
            "DeepSeek",
            false
        )));
    }

    #[test]
    fn custom_vision_follows_active_model_not_sibling_catalog() {
        let mut p = sample_provider("deepseek", "deepseek-v4-flash", "DeepSeek", false);
        p.models = vec![
            crate::providers::ProviderModelEntry::named("deepseek-v4-flash", "DeepSeek V4 Flash"),
            crate::providers::ProviderModelEntry {
                id: "deepseek-v4-flash-vision-exp".into(),
                name: "Flash Vision".into(),
                supports_vision: Some(true),
                ..Default::default()
            },
        ];
        assert!(
            custom_provider_is_text_only(&p),
            "active flash must stay text-only even when a sibling is vision"
        );
        p.model = "deepseek-v4-flash-vision-exp".into();
        assert!(!custom_provider_is_text_only(&p));
    }

    #[test]
    fn rewrite_keeps_images_for_multimodal_main() {
        let prompt = "看图\n\n@/Users/me/pic.png";
        let out = rewrite_prompt_guard_text_only(prompt, false, false);
        assert_eq!(out, prompt);
    }

    #[test]
    fn aux_spawn_env_from_slots() {
        let text = r#"
[models]
default = "deepseek"
image_description = "amux"
web_search = "amux"
"#;
        // Write via pure apply then read — env helper reads live config; unit-test pure map:
        let slots = read_slots(text);
        assert_eq!(slots.image_description, "amux");
        assert_eq!(slots.web_search, "amux");
        let mut env = Vec::new();
        for (slot, name) in [
            ("image_description", "GROK_IMAGE_DESCRIPTION_MODEL"),
            ("web_search", "GROK_WEB_SEARCH_MODEL"),
        ] {
            if let Some(v) = normalize_slot_value(&get_slot(text, slot)) {
                env.push((name, v));
            }
        }
        assert!(env
            .iter()
            .any(|(k, v)| *k == "GROK_WEB_SEARCH_MODEL" && v == "amux"));
        assert!(env
            .iter()
            .any(|(k, v)| *k == "GROK_IMAGE_DESCRIPTION_MODEL" && v == "amux"));
    }

    #[test]
    fn extract_and_strip_images_from_bootstrap() {
        let prompt =
            "[Prior…]\n### User\n你好\n\n@/tmp/a.png\n\n### Assistant\nok\n\n新问题\n@/tmp/b.jpg";
        let imgs = extract_image_at_paths(prompt);
        assert_eq!(imgs.len(), 2);
        let (body, stripped) = strip_image_at_paths(prompt);
        assert_eq!(stripped.len(), 2);
        assert!(!body.contains("@/tmp/a.png"));
        assert!(!body.contains("@/tmp/b.jpg"));
    }

    #[test]
    fn neutralize_removes_echoed_at_image_from_vision_output() {
        // Vision models often echo the @path we passed them.
        let echoed = r#"<image_description path="/tmp/a.png">
A red button.
</image_description>

@/tmp/a.png
"#;
        let out = neutralize_image_at_refs(echoed);
        assert!(
            !out.contains("@/tmp/a.png"),
            "must not re-inject attachable @image: {out}"
        );
        assert!(
            out.contains("red button") || out.contains("image_description"),
            "{out}"
        );
    }

    #[test]
    fn neutralize_noop_when_no_images() {
        let t = "plain text without attachments";
        assert_eq!(neutralize_image_at_refs(t), t);
    }

    #[test]
    fn strip_preserves_chinese_utf8() {
        let s = "在 x 上搜索 cgnot996 这个账号的信息";
        let (body, found) = strip_image_at_paths(s);
        assert!(found.is_empty());
        assert_eq!(body, s, "must not corrupt multi-byte UTF-8");
        assert!(body.contains("账号"));
    }

    #[test]
    fn strip_mid_line_image_keeps_chinese_caption() {
        let s = "看看这张图 @/tmp/shot.png 是什么";
        let (body, found) = strip_image_at_paths(s);
        assert_eq!(found, vec!["/tmp/shot.png".to_string()]);
        assert!(body.contains("看看这张图"), "{body}");
        assert!(body.contains("是什么"), "{body}");
        assert!(!body.contains("@/tmp/shot.png"), "{body}");
    }
    #[test]
    fn custom_main_prefers_multimodal_channel_over_official_key() {
        let list = crate::providers::ProvidersListResult {
            providers: vec![crate::providers::CustomProvider {
                id: "amux".into(),
                model: "grok-4.5".into(),
                base_url: "https://api.amux.ai/v1".into(),
                name: "Amux".into(),
                has_api_key: true,
                api_backend: "responses".into(),
                provider_mode: crate::providers::PROVIDER_MODE_GENERIC.into(),
                is_default: false,
                models: vec![],
                efforts: vec![],
                context_window: None,
                base_url_full_path: false,
                append_prompt: None,
                supports_vision: false,
                extra_headers: vec![],
            }],
            default_model: Some("deepseek".into()),
            active_source: "custom".into(),
            active_provider_id: Some("deepseek".into()),
            config_path: String::new(),
            agent_home: String::new(),
            switched_to_independent: false,
        };
        let (t, _, r) = resolve_save_grok_target(&list, true);
        assert_eq!(t.as_deref(), Some("amux"));
        assert_eq!(r, "custom_multimodal");
    }

    #[test]
    fn normalize_slot_value_auto() {
        assert_eq!(normalize_slot_value("  "), None);
        assert_eq!(normalize_slot_value("auto"), None);
        assert_eq!(normalize_slot_value("AUTO"), None);
        assert_eq!(
            normalize_slot_value("grok-4.5").as_deref(),
            Some("grok-4.5")
        );
    }

    #[test]
    fn resolve_prefers_official_key() {
        let list = crate::providers::ProvidersListResult {
            providers: vec![],
            default_model: Some("deepseek".into()),
            active_source: "custom".into(),
            active_provider_id: Some("deepseek".into()),
            config_path: String::new(),
            agent_home: String::new(),
            switched_to_independent: false,
        };
        let (t, _, r) = resolve_save_grok_target(&list, true);
        assert_eq!(t.as_deref(), Some(OFFICIAL_CATALOG_MODEL));
        assert_eq!(r, "official_api_key");
    }

    #[test]
    fn resolve_custom_multimodal() {
        let list = crate::providers::ProvidersListResult {
            providers: vec![crate::providers::CustomProvider {
                id: "amux".into(),
                model: "grok-4.5".into(),
                base_url: "https://api.amux.ai/v1".into(),
                name: "Amux".into(),
                has_api_key: true,
                api_backend: "responses".into(),
                provider_mode: crate::providers::PROVIDER_MODE_GENERIC.into(),
                is_default: false,
                models: vec![],
                efforts: vec![],
                context_window: None,
                base_url_full_path: false,
                append_prompt: None,
                supports_vision: false,
                extra_headers: vec![],
            }],
            default_model: Some("deepseek".into()),
            active_source: "custom".into(),
            active_provider_id: Some("deepseek".into()),
            config_path: String::new(),
            agent_home: String::new(),
            switched_to_independent: false,
        };
        let (t, label, r) = resolve_save_grok_target(&list, false);
        assert_eq!(t.as_deref(), Some("amux"));
        assert!(label.unwrap().contains("Amux"));
        assert_eq!(r, "custom_multimodal");
    }
}
