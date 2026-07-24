//! MCP / Skills enable prefs + ACP `mcpServers` injection.
//!
//! Prefs live in `{app_data}/extensions.json` (which names are enabled).
//! On session open the Host injects **enabled** MCP servers into ACP
//! `session/new` / `session/load`. Independent mode also mirrors `enabled`
//! flags into agent-home `config.toml`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::paths::{
    agent_config_toml, ensure_app_dirs, extensions_file, resolve_agent_grok_home,
};
use crate::store;

const MCP_LIST_TIMEOUT_SECS: u64 = 8;
const MCP_CACHE_TTL: Duration = Duration::from_secs(30);

/// App-side enable prefs for MCP servers and skills.
/// Missing name defaults to **enabled** (opt-out).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsPrefs {
    /// MCP server name → enabled.
    #[serde(default)]
    pub mcp: HashMap<String, bool>,
    /// Skill name → enabled (filters slash palette; agent still loads skill files).
    #[serde(default)]
    pub skills: HashMap<String, bool>,
}

/// Full MCP server definition (from `grok mcp list --json` or inspect + config).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /// `stdio` | `http` | `sse` (optional; inferred from fields).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    /// CLI/config `enabled` flag (informational; App prefs override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

// ── Enable-set pure helpers ──────────────────────────────────────────────────

/// Missing key → enabled (default-on / opt-out).
pub fn is_enabled(map: &HashMap<String, bool>, name: &str) -> bool {
    let key = name.trim();
    if key.is_empty() {
        return false;
    }
    map.get(key).copied().unwrap_or(true)
}

/// Insert or update a single enable flag (normalized name).
pub fn set_enabled(map: &mut HashMap<String, bool>, name: &str, enabled: bool) {
    let key = name.trim();
    if key.is_empty() {
        return;
    }
    map.insert(key.to_string(), enabled);
}

/// Mark every name in `names` as enabled.
pub fn enable_all(map: &mut HashMap<String, bool>, names: &[String]) {
    for n in names {
        set_enabled(map, n, true);
    }
}

/// Merge overlay flags into base (overlay wins). Pure helper for tests.
pub fn merge_enable_maps(
    base: &HashMap<String, bool>,
    overlay: &HashMap<String, bool>,
) -> HashMap<String, bool> {
    let mut out = base.clone();
    for (k, v) in overlay {
        let key = k.trim();
        if !key.is_empty() {
            out.insert(key.to_string(), *v);
        }
    }
    out
}

/// Filter server defs by App prefs (default-on).
pub fn filter_enabled_mcp<'a>(
    defs: &'a [McpServerDef],
    prefs: &ExtensionsPrefs,
) -> Vec<&'a McpServerDef> {
    defs.iter()
        .filter(|d| is_enabled(&prefs.mcp, &d.name))
        .collect()
}

/// Filter skill names by App prefs (default-on).
pub fn filter_enabled_skill_names(names: &[String], prefs: &ExtensionsPrefs) -> Vec<String> {
    names
        .iter()
        .filter(|n| is_enabled(&prefs.skills, n))
        .cloned()
        .collect()
}

// ── ACP mapping ──────────────────────────────────────────────────────────────

/// Map one server definition to an ACP `mcpServers[]` entry.
/// Returns `None` when the def cannot form a valid transport payload.
pub fn mcp_def_to_acp(def: &McpServerDef) -> Option<Value> {
    let name = def.name.trim();
    if name.is_empty() {
        return None;
    }
    let transport = def
        .transport
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());

    // Prefer explicit HTTP/SSE when url is present or transport says so.
    if let Some(url) = def.url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let ty = match transport.as_deref() {
            Some("sse") => "sse",
            _ => "http",
        };
        let headers = env_map_to_named_array(def.headers.as_ref());
        return Some(json!({
            "type": ty,
            "name": name,
            "url": url,
            "headers": headers,
        }));
    }

    // Stdio: command + args (+ env).
    let command = def
        .command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let args = def.args.clone().unwrap_or_default();
    let env = env_map_to_named_array(def.env.as_ref());
    Some(json!({
        "name": name,
        "command": command,
        "args": args,
        "env": env,
    }))
}

fn env_map_to_named_array(map: Option<&HashMap<String, String>>) -> Vec<Value> {
    let Some(m) = map else {
        return Vec::new();
    };
    let mut keys: Vec<&String> = m.keys().collect();
    keys.sort();
    keys.into_iter()
        .map(|k| {
            json!({
                "name": k,
                "value": m.get(k).map(|s| s.as_str()).unwrap_or(""),
            })
        })
        .collect()
}

/// Build the ACP `mcpServers` JSON array from defs + prefs.
pub fn build_acp_mcp_servers(defs: &[McpServerDef], prefs: &ExtensionsPrefs) -> Value {
    let arr: Vec<Value> = filter_enabled_mcp(defs, prefs)
        .into_iter()
        .filter_map(mcp_def_to_acp)
        .collect();
    Value::Array(arr)
}

// ── Persistence ──────────────────────────────────────────────────────────────

pub fn load_prefs() -> ExtensionsPrefs {
    let path = extensions_file();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => ExtensionsPrefs::default(),
    }
}

pub fn save_prefs(prefs: &ExtensionsPrefs) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = extensions_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

// ── MCP definition discovery ─────────────────────────────────────────────────

struct McpCache {
    at: Instant,
    /// Config path used for mtime invalidation.
    config_path: PathBuf,
    config_mtime_ms: u128,
    defs: Vec<McpServerDef>,
}

static MCP_CACHE: Mutex<Option<McpCache>> = Mutex::new(None);

fn file_mtime_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// List configured MCP servers (CLI `grok mcp list --json` preferred).
/// `project_cwd` scopes project-level servers when present.
pub fn list_mcp_server_defs(project_cwd: Option<&str>) -> Vec<McpServerDef> {
    let settings = store::load_settings();
    let config_path = resolve_agent_grok_home(&settings.session_data_mode).join("config.toml");
    // Also watch user ~/.grok/config.toml — list often sources from there.
    let user_config = crate::process_util::user_home().join(".grok").join("config.toml");
    let mtime = file_mtime_ms(&config_path).max(file_mtime_ms(&user_config));

    {
        let guard = MCP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref c) = *guard {
            if c.at.elapsed() < MCP_CACHE_TTL
                && c.config_mtime_ms == mtime
                && c.config_path == config_path
            {
                return c.defs.clone();
            }
        }
    }

    // Prefer `grok mcp list --json` (full command/args/env/url).
    // Fall back to config.toml (stdio args survive; inspect often drops them),
    // then inspect names/targets as last resort.
    let mut defs = fetch_mcp_list_json(project_cwd).unwrap_or_default();
    if defs.is_empty() {
        defs = load_mcp_defs_from_configs(&settings.session_data_mode);
    }
    if defs.is_empty() {
        defs = fetch_mcp_from_inspect(project_cwd);
    }

    if let Ok(mut guard) = MCP_CACHE.lock() {
        *guard = Some(McpCache {
            at: Instant::now(),
            config_path,
            config_mtime_ms: mtime,
            defs: defs.clone(),
        });
    }
    defs
}

/// Read MCP server defs from agent-home + user `~/.grok/config.toml`.
/// Later files do not override earlier names (agent-home wins over user when
/// independent mode has mirrored sections; otherwise user config is the source).
fn load_mcp_defs_from_configs(session_data_mode: &str) -> Vec<McpServerDef> {
    let mut by_name: HashMap<String, McpServerDef> = HashMap::new();
    // User config first, then agent-home (independent) so App-managed home wins.
    let user_cfg = crate::process_util::user_home()
        .join(".grok")
        .join("config.toml");
    if let Ok(raw) = fs::read_to_string(&user_cfg) {
        for d in parse_mcp_servers_from_toml(&raw) {
            by_name.insert(d.name.clone(), d);
        }
    }
    let agent_cfg = resolve_agent_grok_home(session_data_mode).join("config.toml");
    if agent_cfg != user_cfg {
        if let Ok(raw) = fs::read_to_string(&agent_cfg) {
            for d in parse_mcp_servers_from_toml(&raw) {
                by_name.insert(d.name.clone(), d);
            }
        }
    }
    let mut out: Vec<McpServerDef> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Parse `[mcp_servers.<name>]` tables (and nested `.env`) from config.toml text.
/// Lightweight — no full TOML dependency; covers command/args/url/enabled/env.
/// Supports multi-line `args = [ ... ]` arrays used by Grok config.
pub fn parse_mcp_servers_from_toml(text: &str) -> Vec<McpServerDef> {
    let mut by_name: HashMap<String, McpServerDef> = HashMap::new();
    let mut current: Option<String> = None;
    let mut in_env = false;
    // Accumulator for multi-line `args = [` … `]`
    let mut args_buf: Option<String> = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(ref mut buf) = args_buf {
            buf.push(' ');
            buf.push_str(trimmed);
            if trimmed.contains(']') {
                let joined = args_buf.take().unwrap_or_default();
                if let Some(name) = current.as_ref() {
                    if let Some(def) = by_name.get_mut(name) {
                        if let Some(arr) = parse_toml_string_array(&joined) {
                            def.args = Some(arr);
                        }
                    }
                }
            }
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let inner = trimmed[1..trimmed.len() - 1].trim();
            if let Some(rest) = inner.strip_prefix("mcp_servers.") {
                if let Some(name) = rest.strip_suffix(".env") {
                    let name = name.trim();
                    if !name.is_empty() {
                        ensure_mcp_def(&mut by_name, name);
                        current = Some(name.to_string());
                        in_env = true;
                    } else {
                        current = None;
                        in_env = false;
                    }
                } else {
                    let name = rest.trim();
                    if !name.is_empty() {
                        ensure_mcp_def(&mut by_name, name);
                        current = Some(name.to_string());
                        in_env = false;
                    } else {
                        current = None;
                        in_env = false;
                    }
                }
            } else {
                current = None;
                in_env = false;
            }
            continue;
        }
        let Some(name) = current.as_ref() else {
            continue;
        };
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let val_raw = trimmed[eq + 1..].trim();
        if key.is_empty() {
            continue;
        }
        let Some(def) = by_name.get_mut(name) else {
            continue;
        };
        if in_env {
            if let Some(v) = parse_toml_string(val_raw) {
                def.env
                    .get_or_insert_with(HashMap::new)
                    .insert(key.to_string(), v);
            }
            continue;
        }
        match key {
            "command" => {
                if let Some(v) = parse_toml_string(val_raw) {
                    def.command = Some(v);
                    if def.transport.is_none() {
                        def.transport = Some("stdio".into());
                    }
                }
            }
            "url" => {
                if let Some(v) = parse_toml_string(val_raw) {
                    def.url = Some(v);
                    if def.transport.is_none() {
                        def.transport = Some("http".into());
                    }
                }
            }
            "enabled" => {
                def.enabled = parse_toml_bool(val_raw);
            }
            "args" => {
                if val_raw.contains('[') && !val_raw.contains(']') {
                    args_buf = Some(val_raw.to_string());
                } else if let Some(arr) = parse_toml_string_array(val_raw) {
                    def.args = Some(arr);
                }
            }
            "transport" => {
                if let Some(v) = parse_toml_string(val_raw) {
                    def.transport = Some(v);
                }
            }
            _ => {}
        }
    }

    let mut out: Vec<McpServerDef> = by_name.into_values().collect();
    out.retain(|d| !d.name.is_empty() && (d.command.is_some() || d.url.is_some()));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn ensure_mcp_def(map: &mut HashMap<String, McpServerDef>, name: &str) {
    map.entry(name.to_string()).or_insert_with(|| McpServerDef {
        name: name.to_string(),
        command: None,
        args: None,
        env: None,
        url: None,
        headers: None,
        transport: None,
        enabled: None,
        scope: None,
    });
}

fn parse_toml_string(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.len() >= 2 {
        let b = s.as_bytes()[0];
        if (b == b'"' || b == b'\'') && s.as_bytes()[s.len() - 1] == b {
            return Some(s[1..s.len() - 1].to_string());
        }
    }
    // Bare token (rare)
    if !s.is_empty() && !s.starts_with('[') && !s.starts_with('{') {
        return Some(s.trim_end_matches(',').to_string());
    }
    None
}

fn parse_toml_bool(raw: &str) -> Option<bool> {
    match raw.trim().trim_end_matches(',').to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Parse a single-line or multi-line-joined TOML string array: `["a", "b"]`.
fn parse_toml_string_array(raw: &str) -> Option<Vec<String>> {
    let s = raw.trim();
    let start = s.find('[')?;
    let end = s.rfind(']')?;
    if end <= start {
        return None;
    }
    let inner = &s[start + 1..end];
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_str: Option<char> = None;
    let mut escape = false;
    for ch in inner.chars() {
        if escape {
            cur.push(ch);
            escape = false;
            continue;
        }
        if let Some(q) = in_str {
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == q {
                out.push(cur.clone());
                cur.clear();
                in_str = None;
            } else {
                cur.push(ch);
            }
            continue;
        }
        match ch {
            '"' | '\'' => in_str = Some(ch),
            ',' | ' ' | '\t' | '\n' | '\r' => {}
            _ => {}
        }
    }
    Some(out)
}

/// Invalidate in-process MCP list cache (after toggle / config write).
pub fn invalidate_mcp_cache() {
    if let Ok(mut guard) = MCP_CACHE.lock() {
        *guard = None;
    }
}

fn fetch_mcp_list_json(project_cwd: Option<&str>) -> Option<Vec<McpServerDef>> {
    let settings = store::load_settings();
    let probe = crate::cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let cli_path = probe.path.filter(|_| probe.found)?;

    let cwd = project_cwd
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = Command::new(&cli_path);
        cmd.arg("mcp").arg("list").arg("--json");
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });

    let output = rx
        .recv_timeout(Duration::from_secs(MCP_LIST_TIMEOUT_SECS))
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_mcp_list_json(stdout.trim())
}

/// Parse `grok mcp list --json` payload into server defs.
pub fn parse_mcp_list_json(raw: &str) -> Option<Vec<McpServerDef>> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let arr = if let Some(a) = v.as_array() {
        a.clone()
    } else if let Some(a) = v.get("servers").and_then(|x| x.as_array()) {
        a.clone()
    } else if let Some(a) = v.get("mcpServers").and_then(|x| x.as_array()) {
        a.clone()
    } else {
        return None;
    };

    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let command = item
            .get("command")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let args = item.get("args").and_then(|x| {
            x.as_array().map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
        });
        let env = parse_string_map(item.get("env"));
        let url = item
            .get("url")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let headers = parse_string_map(item.get("headers"));
        let transport = item
            .get("transport")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                if url.is_some() {
                    Some("http".into())
                } else if command.is_some() {
                    Some("stdio".into())
                } else {
                    None
                }
            });
        let enabled = item.get("enabled").and_then(|x| x.as_bool());
        let scope = item
            .get("scope")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        out.push(McpServerDef {
            name,
            command,
            args,
            env,
            url,
            headers,
            transport,
            enabled,
            scope,
        });
    }
    Some(out)
}

fn parse_string_map(v: Option<&Value>) -> Option<HashMap<String, String>> {
    let obj = v?.as_object()?;
    let mut m = HashMap::new();
    for (k, val) in obj {
        if let Some(s) = val.as_str() {
            m.insert(k.clone(), s.to_string());
        } else if !val.is_null() {
            m.insert(k.clone(), val.to_string());
        }
    }
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

fn fetch_mcp_from_inspect(project_cwd: Option<&str>) -> Vec<McpServerDef> {
    // Reuse inspect path via CLI without pulling private helpers — light spawn.
    let settings = store::load_settings();
    let probe = crate::cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Vec::new();
    };
    let cwd = project_cwd
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = Command::new(&cli_path);
        cmd.arg("inspect").arg("--json");
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });
    let Ok(Ok(output)) = rx.recv_timeout(Duration::from_secs(MCP_LIST_TIMEOUT_SECS)) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Ok(v) = serde_json::from_str::<Value>(stdout.trim()) else {
        return Vec::new();
    };
    let Some(arr) = v
        .get("mcpServers")
        .or_else(|| v.get("mcp"))
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let transport = item
            .get("transport")
            .and_then(|x| x.as_str())
            .map(|s| s.to_ascii_lowercase());
        let target = item
            .get("target")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let mut command = None;
        let mut url = None;
        match transport.as_deref() {
            Some("http") | Some("sse") => url = target.clone(),
            _ => {
                if let Some(ref t) = target {
                    if t.starts_with("http://") || t.starts_with("https://") {
                        url = Some(t.clone());
                    } else {
                        command = Some(t.clone());
                    }
                }
            }
        }
        out.push(McpServerDef {
            name,
            command,
            args: None,
            env: None,
            url,
            headers: None,
            transport,
            enabled: None,
            scope: None,
        });
    }
    out
}

/// Build ACP mcpServers for the current prefs + discovered defs.
pub fn build_session_mcp_servers(project_cwd: Option<&str>) -> Value {
    let prefs = load_prefs();
    let defs = list_mcp_server_defs(project_cwd);
    build_acp_mcp_servers(&defs, &prefs)
}

// ── Config.toml enabled sync ─────────────────────────────────────────────────

/// Upsert `enabled = bool` under `[mcp_servers.<name>]` in TOML text.
pub fn set_mcp_enabled_in_toml(text: &str, name: &str, enabled: bool) -> String {
    let name = name.trim();
    if name.is_empty() {
        return text.to_string();
    }
    let header = format!("[mcp_servers.{name}]");
    let line_val = format!("enabled = {enabled}");
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
                // Leaving our table without finding enabled — insert before next header.
                lines.insert(i, line_val);
                return lines.join("\n") + trailing_nl(text);
            } else {
                in_table = false;
            }
            continue;
        }
        if in_table {
            // Match bare `enabled = …` (not nested env tables).
            let key = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key == "enabled" {
                lines[i] = line_val;
                return lines.join("\n") + trailing_nl(text);
            }
        }
    }
    if let Some(start) = table_start {
        lines.insert(start + 1, line_val);
        return lines.join("\n") + trailing_nl(text);
    }
    // Section missing — append a minimal table so independent agent-home can gate it.
    let block = format!("\n{header}\n{line_val}\n");
    let base = text.trim_end();
    if base.is_empty() {
        format!("{header}\n{line_val}\n")
    } else {
        format!("{base}{block}")
    }
}

fn trailing_nl(text: &str) -> &'static str {
    if text.ends_with('\n') || text.is_empty() {
        ""
    } else {
        "\n"
    }
}

/// Write App enable prefs into the agent GROK_HOME config.toml `enabled` flags.
/// Independent mode: agent-home. Shared mode: user `~/.grok/config.toml` (user-initiated).
pub fn sync_mcp_enabled_to_agent_config(
    session_data_mode: &str,
    prefs: &ExtensionsPrefs,
) -> Result<(), String> {
    let home = resolve_agent_grok_home(session_data_mode);
    let path = if session_data_mode == "shared" {
        home.join("config.toml")
    } else {
        let _ = ensure_app_dirs();
        agent_config_toml()
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut next = existing.clone();
    // Apply every known pref key.
    for (name, enabled) in &prefs.mcp {
        next = set_mcp_enabled_in_toml(&next, name, *enabled);
    }
    if next != existing {
        fs::write(&path, next).map_err(|e| e.to_string())?;
        tracing::info!(
            "extensions: synced mcp enabled flags → {}",
            path.display()
        );
    }
    invalidate_mcp_cache();
    Ok(())
}

/// Apply a single MCP enable toggle: prefs + agent config + return updated prefs.
pub fn set_mcp_enabled(name: &str, enabled: bool) -> Result<ExtensionsPrefs, String> {
    let mut prefs = load_prefs();
    set_enabled(&mut prefs.mcp, name, enabled);
    save_prefs(&prefs)?;
    let settings = store::load_settings();
    let _ = sync_mcp_enabled_to_agent_config(&settings.session_data_mode, &prefs);
    Ok(prefs)
}

/// Apply a single skill enable toggle (App filter only).
pub fn set_skill_enabled(name: &str, enabled: bool) -> Result<ExtensionsPrefs, String> {
    let mut prefs = load_prefs();
    set_enabled(&mut prefs.skills, name, enabled);
    save_prefs(&prefs)?;
    Ok(prefs)
}

/// Enable every known MCP server name.
pub fn enable_all_mcp(names: &[String]) -> Result<ExtensionsPrefs, String> {
    let mut prefs = load_prefs();
    enable_all(&mut prefs.mcp, names);
    save_prefs(&prefs)?;
    let settings = store::load_settings();
    let _ = sync_mcp_enabled_to_agent_config(&settings.session_data_mode, &prefs);
    Ok(prefs)
}

/// Enable every known skill name.
pub fn enable_all_skills(names: &[String]) -> Result<ExtensionsPrefs, String> {
    let mut prefs = load_prefs();
    enable_all(&mut prefs.skills, names);
    save_prefs(&prefs)?;
    Ok(prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_on_when_missing() {
        let m = HashMap::new();
        assert!(is_enabled(&m, "foo"));
        assert!(!is_enabled(&m, ""));
        let mut m2 = HashMap::new();
        set_enabled(&mut m2, "foo", false);
        assert!(!is_enabled(&m2, "foo"));
        set_enabled(&mut m2, "foo", true);
        assert!(is_enabled(&m2, "foo"));
    }

    #[test]
    fn merge_and_enable_all() {
        let mut base = HashMap::new();
        set_enabled(&mut base, "a", false);
        set_enabled(&mut base, "b", true);
        let mut over = HashMap::new();
        set_enabled(&mut over, "a", true);
        set_enabled(&mut over, "c", false);
        let m = merge_enable_maps(&base, &over);
        assert!(is_enabled(&m, "a"));
        assert!(is_enabled(&m, "b"));
        assert!(!is_enabled(&m, "c"));
        assert!(is_enabled(&m, "unknown"));

        let mut all = HashMap::new();
        set_enabled(&mut all, "x", false);
        enable_all(&mut all, &["x".into(), "y".into()]);
        assert!(is_enabled(&all, "x"));
        assert!(is_enabled(&all, "y"));
    }

    #[test]
    fn filter_enabled_mcp_respects_prefs() {
        let defs = vec![
            McpServerDef {
                name: "keep".into(),
                command: Some("npx".into()),
                args: Some(vec!["-y".into(), "pkg".into()]),
                env: None,
                url: None,
                headers: None,
                transport: Some("stdio".into()),
                enabled: Some(true),
                scope: None,
            },
            McpServerDef {
                name: "drop".into(),
                command: None,
                args: None,
                env: None,
                url: Some("https://example.com/mcp".into()),
                headers: None,
                transport: Some("http".into()),
                enabled: Some(true),
                scope: None,
            },
        ];
        let mut prefs = ExtensionsPrefs::default();
        set_enabled(&mut prefs.mcp, "drop", false);
        let filtered = filter_enabled_mcp(&defs, &prefs);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, "keep");
    }

    #[test]
    fn acp_stdio_and_http_mapping() {
        let stdio = McpServerDef {
            name: "chrome-devtools".into(),
            command: Some("/usr/local/bin/npx".into()),
            args: Some(vec!["-y".into(), "chrome-devtools-mcp@1.5.0".into()]),
            env: Some(HashMap::from([("PATH".into(), "/usr/bin".into())])),
            url: None,
            headers: None,
            transport: Some("stdio".into()),
            enabled: Some(true),
            scope: None,
        };
        let v = mcp_def_to_acp(&stdio).expect("stdio");
        assert_eq!(v["name"], "chrome-devtools");
        assert_eq!(v["command"], "/usr/local/bin/npx");
        assert!(v.get("type").is_none());
        assert_eq!(v["args"].as_array().unwrap().len(), 2);
        assert_eq!(v["env"].as_array().unwrap().len(), 1);

        let http = McpServerDef {
            name: "cf".into(),
            command: None,
            args: None,
            env: None,
            url: Some("https://mcp.example.com/mcp".into()),
            headers: Some(HashMap::from([("Authorization".into(), "Bearer x".into())])),
            transport: Some("http".into()),
            enabled: Some(true),
            scope: None,
        };
        let v = mcp_def_to_acp(&http).expect("http");
        assert_eq!(v["type"], "http");
        assert_eq!(v["url"], "https://mcp.example.com/mcp");
        assert_eq!(v["headers"].as_array().unwrap().len(), 1);

        let sse = McpServerDef {
            name: "events".into(),
            command: None,
            args: None,
            env: None,
            url: Some("https://events.example.com/sse".into()),
            headers: None,
            transport: Some("sse".into()),
            enabled: None,
            scope: None,
        };
        let v = mcp_def_to_acp(&sse).expect("sse");
        assert_eq!(v["type"], "sse");
    }

    #[test]
    fn build_acp_filters_and_skips_invalid() {
        let defs = vec![
            McpServerDef {
                name: "ok".into(),
                command: Some("npx".into()),
                args: None,
                env: None,
                url: None,
                headers: None,
                transport: Some("stdio".into()),
                enabled: None,
                scope: None,
            },
            McpServerDef {
                name: "no-target".into(),
                command: None,
                args: None,
                env: None,
                url: None,
                headers: None,
                transport: None,
                enabled: None,
                scope: None,
            },
            McpServerDef {
                name: "off".into(),
                command: Some("x".into()),
                args: None,
                env: None,
                url: None,
                headers: None,
                transport: Some("stdio".into()),
                enabled: None,
                scope: None,
            },
        ];
        let mut prefs = ExtensionsPrefs::default();
        set_enabled(&mut prefs.mcp, "off", false);
        let arr = build_acp_mcp_servers(&defs, &prefs);
        let a = arr.as_array().unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0]["name"], "ok");
    }

    #[test]
    fn set_mcp_enabled_in_toml_upserts() {
        let base = r#"
[ui]
yolo = false

[mcp_servers.chrome-devtools]
command = "/usr/local/bin/npx"
args = ["-y", "chrome-devtools-mcp"]
enabled = true
"#;
        let next = set_mcp_enabled_in_toml(base, "chrome-devtools", false);
        assert!(next.contains("enabled = false"));
        assert_eq!(next.matches("enabled = ").count(), 1);
        assert!(next.contains("command = \"/usr/local/bin/npx\""));

        // Missing section → append
        let appended = set_mcp_enabled_in_toml("[ui]\nyolo = false\n", "playwright", true);
        assert!(appended.contains("[mcp_servers.playwright]"));
        assert!(appended.contains("enabled = true"));
    }

    #[test]
    fn parse_mcp_list_json_shape() {
        let raw = r#"[
          {
            "name": "chrome-devtools",
            "command": "/usr/local/bin/npx",
            "args": ["-y", "chrome-devtools-mcp@1.5.0"],
            "env": {"PATH": "/usr/bin"},
            "enabled": true,
            "scope": "user"
          },
          {
            "name": "cloudflare-api",
            "url": "https://mcp.cloudflare.com/mcp",
            "enabled": true
          }
        ]"#;
        let defs = parse_mcp_list_json(raw).expect("parse");
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].command.as_deref(), Some("/usr/local/bin/npx"));
        assert_eq!(defs[0].args.as_ref().unwrap().len(), 2);
        assert_eq!(
            defs[1].url.as_deref(),
            Some("https://mcp.cloudflare.com/mcp")
        );
    }

    #[test]
    fn filter_skill_names() {
        let names = vec!["help".into(), "imagine".into(), "code-review".into()];
        let mut prefs = ExtensionsPrefs::default();
        set_enabled(&mut prefs.skills, "imagine", false);
        let f = filter_enabled_skill_names(&names, &prefs);
        assert_eq!(f, vec!["help".to_string(), "code-review".to_string()]);
    }

    #[test]
    fn parse_mcp_servers_from_toml_stdio_and_http() {
        let raw = r#"
[ui]
yolo = false

[mcp_servers.chrome-devtools]
command = "/usr/local/bin/npx"
args = [
    "-y",
    "chrome-devtools-mcp@1.5.0",
    "--isolated",
]
enabled = true

[mcp_servers.chrome-devtools.env]
PATH = "/usr/local/bin:/usr/bin"

[mcp_servers.cloudflare-api]
url = "https://mcp.cloudflare.com/mcp"
enabled = true
"#;
        let defs = parse_mcp_servers_from_toml(raw);
        assert_eq!(defs.len(), 2, "{defs:?}");
        let chrome = defs.iter().find(|d| d.name == "chrome-devtools").unwrap();
        assert_eq!(chrome.command.as_deref(), Some("/usr/local/bin/npx"));
        assert_eq!(
            chrome.args.as_ref().map(|a| a.as_slice()),
            Some(
                [
                    "-y".to_string(),
                    "chrome-devtools-mcp@1.5.0".to_string(),
                    "--isolated".to_string()
                ]
                .as_slice()
            )
        );
        assert_eq!(
            chrome.env.as_ref().and_then(|e| e.get("PATH")).map(|s| s.as_str()),
            Some("/usr/local/bin:/usr/bin")
        );
        let http = defs.iter().find(|d| d.name == "cloudflare-api").unwrap();
        assert_eq!(
            http.url.as_deref(),
            Some("https://mcp.cloudflare.com/mcp")
        );

        // ACP mapping must not yield empty array when prefs default-on.
        let prefs = ExtensionsPrefs::default();
        let arr = build_acp_mcp_servers(&defs, &prefs);
        let a = arr.as_array().unwrap();
        assert_eq!(a.len(), 2);
        assert!(a.iter().any(|v| v["name"] == "chrome-devtools"));
        assert!(a.iter().any(|v| v["name"] == "cloudflare-api" && v["type"] == "http"));
    }
}
