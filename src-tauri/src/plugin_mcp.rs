//! Discover MCP servers declared by installed Grok plugins (`.mcp.json`).
//!
//! GUI / CLI plugin install copies the pack under `~/.grok/installed-plugins/`.
//! Trusted plugin MCP is not always listed by `grok inspect` / `grok mcp list`
//! (hosts often skip `${CLAUDE_PLUGIN_ROOT}`). The App therefore reads
//! `.mcp.json`, expands plugin-root vars, and injects those servers the same
//! way user `config.toml` MCP is injected.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::extensions::McpServerDef;
use crate::process_util::user_home;

/// Expand `${CLAUDE_PLUGIN_ROOT}` / `${GROK_PLUGIN_ROOT}` in a config string.
pub fn expand_plugin_root_vars(raw: &str, plugin_root: &str) -> String {
    raw.replace("${CLAUDE_PLUGIN_ROOT}", plugin_root)
        .replace("${GROK_PLUGIN_ROOT}", plugin_root)
}

fn looks_enabled(enabled: &HashSet<String>, disabled: &HashSet<String>, names: &[&str]) -> bool {
    if names.iter().any(|n| {
        let n = n.trim();
        !n.is_empty() && name_listed(disabled, n)
    }) {
        return false;
    }
    if enabled.is_empty() {
        return false;
    }
    names.iter().any(|n| {
        let n = n.trim();
        !n.is_empty() && name_listed(enabled, n)
    })
}

fn name_listed(set: &HashSet<String>, name: &str) -> bool {
    let name = name.trim();
    if name.is_empty() {
        return false;
    }
    for e in set {
        let e = e.trim();
        if e.is_empty() {
            continue;
        }
        if e.eq_ignore_ascii_case(name) {
            return true;
        }
        if e.ends_with(&format!("/{name}")) || name.ends_with(&format!("/{e}")) {
            return true;
        }
    }
    false
}

/// Parse Claude/Grok `.mcp.json` (`mcpServers` object or array).
pub fn parse_plugin_mcp_json(raw: &str, plugin_root: &str, plugin_name: &str) -> Vec<McpServerDef> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(servers) = v.get("mcpServers") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Some(obj) = servers.as_object() {
        for (name, spec) in obj {
            if let Some(def) = mcp_spec_to_def(name, spec, plugin_root, plugin_name) {
                out.push(def);
            }
        }
    } else if let Some(arr) = servers.as_array() {
        for spec in arr {
            let name = spec
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim();
            if name.is_empty() {
                continue;
            }
            if let Some(def) = mcp_spec_to_def(name, spec, plugin_root, plugin_name) {
                out.push(def);
            }
        }
    }
    out
}

fn mcp_spec_to_def(
    name: &str,
    spec: &Value,
    plugin_root: &str,
    plugin_name: &str,
) -> Option<McpServerDef> {
    let name = name.trim();
    if name.is_empty() || !spec.is_object() {
        return None;
    }
    let expand = |s: &str| expand_plugin_root_vars(s, plugin_root);
    let command = spec
        .get("command")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| resolve_stdio_command(&expand(s)));
    let args = spec.get("args").and_then(|x| x.as_array()).map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(expand))
            .collect::<Vec<_>>()
    });
    let url = spec
        .get("url")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(expand);
    if command.is_none() && url.is_none() {
        return None;
    }
    let mut env = parse_string_map(spec.get("env"));
    env.entry("CLAUDE_PLUGIN_ROOT".into())
        .or_insert_with(|| plugin_root.to_string());
    env.entry("GROK_PLUGIN_ROOT".into())
        .or_insert_with(|| plugin_root.to_string());
    let transport = spec
        .get("transport")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            if url.is_some() {
                Some("http".into())
            } else {
                Some("stdio".into())
            }
        });
    Some(McpServerDef {
        name: name.to_string(),
        command,
        args,
        env: if env.is_empty() { None } else { Some(env) },
        url,
        headers: parse_string_map_opt(spec.get("headers")),
        transport,
        enabled: spec.get("enabled").and_then(|x| x.as_bool()),
        scope: Some(format!("plugin:{plugin_name}")),
    })
}

fn resolve_stdio_command(command: &str) -> String {
    let c = command.trim();
    if c != "node" && c != "nodejs" {
        return c.to_string();
    }
    for name in ["node", "nodejs"] {
        if let Ok(out) = crate::process_util::command("which").arg(name).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return p;
                }
            }
        }
    }
    c.to_string()
}

fn parse_string_map(v: Option<&Value>) -> HashMap<String, String> {
    parse_string_map_opt(v).unwrap_or_default()
}

fn parse_plugins_toml_names(toml_text: &str, key: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut in_plugins = false;
    let mut collecting = false;
    let mut buf = String::new();
    for line in toml_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if collecting {
                break;
            }
            in_plugins = trimmed == "[plugins]";
            continue;
        }
        if !in_plugins {
            continue;
        }
        if collecting {
            buf.push(' ');
            buf.push_str(trimmed);
            if trimmed.contains(']') {
                collecting = false;
                extract_toml_strings(&buf, &mut out);
                buf.clear();
            }
            continue;
        }
        if let Some(rest) = trimmed
            .strip_prefix(key)
            .map(str::trim)
            .and_then(|s| s.strip_prefix('='))
            .map(str::trim)
        {
            if rest.contains('[') && rest.contains(']') {
                extract_toml_strings(rest, &mut out);
            } else if rest.contains('[') {
                collecting = true;
                buf = rest.to_string();
            }
        }
    }
    out
}

fn extract_toml_strings(s: &str, out: &mut HashSet<String>) {
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' && c != '\'' {
            continue;
        }
        let quote = c;
        let mut name = String::new();
        while let Some(ch) = chars.next() {
            if ch == quote {
                break;
            }
            if ch == '\\' {
                if let Some(escaped) = chars.next() {
                    name.push(escaped);
                }
            } else {
                name.push(ch);
            }
        }
        let name = name.trim();
        if !name.is_empty() {
            out.insert(name.to_string());
        }
    }
}

fn parse_string_map_opt(v: Option<&Value>) -> Option<HashMap<String, String>> {
    let obj = v?.as_object()?;
    let mut m = HashMap::new();
    for (k, val) in obj {
        if let Some(s) = val.as_str() {
            m.insert(k.clone(), s.to_string());
        }
    }
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

#[derive(Debug, Deserialize)]
struct RegistryFile {
    #[serde(default)]
    repos: HashMap<String, RegistryRepo>,
}

#[derive(Debug, Deserialize)]
struct RegistryRepo {
    path: Option<String>,
    #[serde(default)]
    plugins: HashMap<String, RegistryPlugin>,
}

#[derive(Debug, Deserialize)]
struct RegistryPlugin {
    subdir: Option<String>,
}

/// Discover `.mcp.json` servers for enabled plugins under a Grok home.
pub fn discover_plugin_mcp_servers_in(grok_home: &Path) -> Vec<McpServerDef> {
    let config_text = fs::read_to_string(grok_home.join("config.toml")).unwrap_or_default();
    let enabled = parse_plugins_toml_names(&config_text, "enabled");
    let disabled = parse_plugins_toml_names(&config_text, "disabled");
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let registry_path = grok_home.join("installed-plugins").join("registry.json");
    if let Ok(raw) = fs::read_to_string(&registry_path) {
        if let Ok(reg) = serde_json::from_str::<RegistryFile>(&raw) {
            for (repo_key, repo) in reg.repos {
                let Some(repo_path) = repo
                    .path
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                else {
                    continue;
                };
                if repo.plugins.is_empty() {
                    push_mcp_dir(
                        Path::new(repo_path),
                        &repo_key,
                        &enabled,
                        &disabled,
                        &mut seen,
                        &mut out,
                    );
                    continue;
                }
                for (plugin_name, meta) in repo.plugins {
                    let dir = match meta
                        .subdir
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        Some(sub) => PathBuf::from(repo_path).join(sub),
                        None => PathBuf::from(repo_path),
                    };
                    push_mcp_dir(&dir, &plugin_name, &enabled, &disabled, &mut seen, &mut out);
                }
            }
        }
    }

    for extra in [
        grok_home.join("installed-plugins"),
        grok_home.join("plugins"),
    ] {
        scan_plugin_dirs(&extra, &enabled, &disabled, &mut seen, &mut out);
    }
    out
}

fn scan_plugin_dirs(
    root: &Path,
    enabled: &HashSet<String>,
    disabled: &HashSet<String>,
    seen: &mut HashSet<String>,
    out: &mut Vec<McpServerDef>,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let leaf = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if leaf.is_empty() || leaf == "registry.json" {
            continue;
        }
        let json_name = read_plugin_manifest_name(&path);
        let name = json_name.as_deref().unwrap_or(leaf.as_str());
        push_mcp_dir(&path, name, enabled, disabled, seen, out);
    }
}

fn read_plugin_manifest_name(dir: &Path) -> Option<String> {
    for rel in [
        ".grok-plugin/plugin.json",
        ".codex-plugin/plugin.json",
        ".claude-plugin/plugin.json",
        "plugin.json",
    ] {
        let p = dir.join(rel);
        let Ok(raw) = fs::read_to_string(&p) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        return Some(name.to_string());
    }
    None
}

fn push_mcp_dir(
    dir: &Path,
    plugin_name: &str,
    enabled: &HashSet<String>,
    disabled: &HashSet<String>,
    seen: &mut HashSet<String>,
    out: &mut Vec<McpServerDef>,
) {
    let leaf = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !looks_enabled(enabled, disabled, &[plugin_name, leaf]) {
        return;
    }
    let mcp_path = dir.join(".mcp.json");
    let Ok(raw) = fs::read_to_string(&mcp_path) else {
        return;
    };
    let root = dir.to_string_lossy().to_string();
    for def in parse_plugin_mcp_json(&raw, &root, plugin_name) {
        if !seen.insert(def.name.clone()) {
            continue;
        }
        out.push(def);
    }
}

/// Live discovery from `~/.grok`.
pub fn discover_plugin_mcp_servers() -> Vec<McpServerDef> {
    discover_plugin_mcp_servers_in(&user_home().join(".grok"))
}

/// Append plugin MCP defs whose names are not already present (user config wins).
pub fn merge_plugin_mcp_defs(mut existing: Vec<McpServerDef>) -> Vec<McpServerDef> {
    let mut names: HashSet<String> = existing.iter().map(|d| d.name.clone()).collect();
    for def in discover_plugin_mcp_servers() {
        if names.contains(&def.name) {
            continue;
        }
        names.insert(def.name.clone());
        existing.push(def);
    }
    existing
}

/// Inspect-row JSON for Settings → MCP (vendor marks the "from plugins" list).
pub fn mcp_def_to_inspect_json(def: &McpServerDef, enabled: bool) -> Value {
    let target = if let Some(url) = def.url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        url.to_string()
    } else {
        let cmd = def.command.as_deref().unwrap_or("").trim();
        let args = def.args.as_ref().map(|a| a.join(" ")).unwrap_or_default();
        format!("{cmd} {args}").trim().to_string()
    };
    let plugin_name = def
        .scope
        .as_deref()
        .and_then(|s| s.strip_prefix("plugin:"))
        .map(|s| s.to_string());
    serde_json::json!({
        "name": def.name,
        "transport": def.transport,
        "target": target,
        "vendor": "plugin",
        "fromPlugin": true,
        "pluginName": plugin_name,
        "authKind": plugin_auth_kind_for_def(def),
        "enabled": enabled,
    })
}

/// Plugin-root directory from a stdio MCP def whose args point at `mcp/server.mjs`.
pub fn plugin_root_from_def(def: &McpServerDef) -> Option<PathBuf> {
    let args = def.args.as_ref()?;
    for a in args {
        let p = Path::new(a);
        let name = p.file_name()?.to_str()?;
        if name == "server.mjs" || name == "server.js" {
            let mcp_dir = p.parent()?;
            if mcp_dir.file_name()?.to_str()? == "mcp" {
                return mcp_dir.parent().map(|x| x.to_path_buf());
            }
        }
    }
    None
}

fn x_api_cli_path(plugin_root: &Path) -> Option<PathBuf> {
    let p = plugin_root.join("scripts").join("x-api.mjs");
    p.is_file().then_some(p)
}

pub fn plugin_auth_kind_for_def(def: &McpServerDef) -> Option<&'static str> {
    let root = plugin_root_from_def(def)?;
    if x_api_cli_path(&root).is_some() {
        return Some("x-api");
    }
    None
}

fn def_for_server(name: &str) -> Option<McpServerDef> {
    let n = name.trim();
    discover_plugin_mcp_servers()
        .into_iter()
        .find(|d| d.name == n)
}

fn run_x_api_cli(plugin_root: &Path, args: &[String], timeout_secs: u64) -> Result<String, String> {
    let script = x_api_cli_path(plugin_root)
        .ok_or_else(|| "this plugin has no scripts/x-api.mjs auth CLI".to_string())?;
    let mut cmd = crate::plugin_auth_transport::command(&script);
    crate::proxy::apply_to_tokio_command(&mut cmd);
    cmd.env("NODE_USE_ENV_PROXY", "1");
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    let output = crate::plugin_auth_transport::execute(
        cmd,
        args,
        std::time::Duration::from_secs(timeout_secs),
    )?;
    let stdout = crate::plugin_auth_transport::redact_output(
        String::from_utf8_lossy(&output.stdout).trim(),
        args,
    );
    let stderr = crate::plugin_auth_transport::redact_output(
        String::from_utf8_lossy(&output.stderr).trim(),
        args,
    );
    if !output.status.success() {
        return Err(shorten_cli_error(&stderr, &stdout));
    }
    Ok(stdout)
}

fn shorten_cli_error(stderr: &str, stdout: &str) -> String {
    let blob = if !stderr.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    for line in blob.lines() {
        let t = line.trim();
        if t.starts_with("无法连接") {
            return t.to_string();
        }
    }
    for line in blob.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Error: ") {
            if !rest.contains("node:internal") {
                return rest.chars().take(400).collect();
            }
        }
    }
    if blob.contains("fetch failed") {
        return "无法连接 api.x.com（Node fetch failed）。授权页能打开，但换 token 默认不走系统代理。请在设置 → 网络启用代理后重试，或改用控制台四钥。".into();
    }
    blob.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with("node:internal") && !l.starts_with('^'))
        .unwrap_or("x-api auth failed")
        .chars()
        .take(400)
        .collect()
}

fn last_json_object(stdout: &str) -> Option<Value> {
    let t = stdout.trim();
    if t.starts_with('{') {
        return serde_json::from_str(t).ok();
    }
    t.lines()
        .rev()
        .find(|l| l.trim().starts_with('{'))
        .and_then(|l| serde_json::from_str(l.trim()).ok())
}

fn status_from_cli_json(server: &str, plugin_root: &Path, raw: &Value) -> Value {
    let o1 = raw.get("oauth1").cloned().unwrap_or(Value::Null);
    let o2 = raw.get("oauth2").cloned().unwrap_or(Value::Null);
    let authorized = o1
        .get("configured")
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
        || o2
            .get("configured")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
    let username = o1
        .get("username")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            o2.get("username")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("")
        .to_string();
    serde_json::json!({
        "server": server,
        "authKind": "x-api",
        "authorized": authorized,
        "username": username,
        "method": if o1.get("configured").and_then(|x| x.as_bool()).unwrap_or(false) {
            "oauth1"
        } else if o2.get("configured").and_then(|x| x.as_bool()).unwrap_or(false) {
            "oauth2"
        } else if raw.get("bearer").and_then(|x| x.as_bool()).unwrap_or(false) {
            "bearer"
        } else {
            "none"
        },
        "shortestPath": raw.get("shortestPath").and_then(|x| x.as_str()).unwrap_or(""),
        "pluginRoot": plugin_root.to_string_lossy(),
        "hasCli": true,
        "callback": "http://127.0.0.1:8787/callback",
    })
}

pub fn plugin_mcp_auth_status(server: &str) -> Result<Value, String> {
    let def = def_for_server(server).ok_or_else(|| format!("plugin MCP '{server}' not found"))?;
    let root = plugin_root_from_def(&def)
        .ok_or_else(|| "plugin MCP has no local plugin root".to_string())?;
    if x_api_cli_path(&root).is_none() {
        return Ok(serde_json::json!({
            "server": server,
            "authKind": serde_json::Value::Null,
            "authorized": false,
            "username": "",
            "method": "none",
            "shortestPath": "",
            "pluginRoot": root.to_string_lossy(),
            "hasCli": false,
        }));
    }
    let stdout = run_x_api_cli(&root, &["status".into()], 20)?;
    let raw = last_json_object(&stdout).ok_or_else(|| "x-api status was not JSON".to_string())?;
    Ok(status_from_cli_json(server, &root, &raw))
}

pub fn plugin_mcp_auth_save_tokens(
    server: &str,
    api_key: &str,
    api_secret: &str,
    access_token: &str,
    access_token_secret: &str,
) -> Result<Value, String> {
    let def = def_for_server(server).ok_or_else(|| format!("plugin MCP '{server}' not found"))?;
    let root = plugin_root_from_def(&def)
        .ok_or_else(|| "plugin MCP has no local plugin root".to_string())?;
    let stdout = run_x_api_cli(
        &root,
        &[
            "login".into(),
            "--tokens".into(),
            "--no-prompt".into(),
            "--api-key".into(),
            api_key.trim().into(),
            "--api-secret".into(),
            api_secret.trim().into(),
            "--access-token".into(),
            access_token.trim().into(),
            "--access-token-secret".into(),
            access_token_secret.trim().into(),
        ],
        60,
    )?;
    let _ = last_json_object(&stdout);
    plugin_mcp_auth_status(server)
}

pub fn plugin_mcp_auth_oauth2(
    server: &str,
    client_id: &str,
    client_secret: &str,
) -> Result<Value, String> {
    let def = def_for_server(server).ok_or_else(|| format!("plugin MCP '{server}' not found"))?;
    let root = plugin_root_from_def(&def)
        .ok_or_else(|| "plugin MCP has no local plugin root".to_string())?;
    let stdout = run_x_api_cli(
        &root,
        &[
            "login".into(),
            "--oauth2".into(),
            "--no-prompt".into(),
            "--client-id".into(),
            client_id.trim().into(),
            "--client-secret".into(),
            client_secret.trim().into(),
        ],
        180,
    )?;
    let _ = last_json_object(&stdout);
    plugin_mcp_auth_status(server)
}

pub fn plugin_mcp_auth_logout(server: &str) -> Result<Value, String> {
    let def = def_for_server(server).ok_or_else(|| format!("plugin MCP '{server}' not found"))?;
    let root = plugin_root_from_def(&def)
        .ok_or_else(|| "plugin MCP has no local plugin root".to_string())?;
    let _ = run_x_api_cli(&root, &["logout".into()], 20)?;
    plugin_mcp_auth_status(server)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_plugin_root_placeholders() {
        let root = "/tmp/plug";
        assert_eq!(
            expand_plugin_root_vars("${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs", root),
            "/tmp/plug/mcp/server.mjs"
        );
        assert_eq!(
            expand_plugin_root_vars("${GROK_PLUGIN_ROOT}/x", root),
            "/tmp/plug/x"
        );
        assert_eq!(expand_plugin_root_vars("node", root), "node");
    }

    #[test]
    fn parses_object_mcp_servers_and_sets_env() {
        let raw = r#"{
          "mcpServers": {
            "x-api": {
              "command": "node",
              "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"],
              "env": {}
            }
          }
        }"#;
        let defs = parse_plugin_mcp_json(raw, "/opt/x-api", "x-api");
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "x-api");
        match defs[0].command.as_deref() {
            Some("node") | Some("nodejs") => {}
            Some(cmd) if cmd.ends_with("/node") || cmd.ends_with("/nodejs") => {}
            other => panic!(
                "expected node/nodejs or absolute path ending in /node or /nodejs, got {other:?}"
            ),
        }
        assert_eq!(
            defs[0].args.clone().unwrap(),
            vec!["/opt/x-api/mcp/server.mjs".to_string()]
        );
        let env = defs[0].env.as_ref().expect("env");
        assert_eq!(
            env.get("CLAUDE_PLUGIN_ROOT").map(String::as_str),
            Some("/opt/x-api")
        );
        assert_eq!(
            env.get("GROK_PLUGIN_ROOT").map(String::as_str),
            Some("/opt/x-api")
        );
        assert_eq!(defs[0].scope.as_deref(), Some("plugin:x-api"));
        assert_eq!(defs[0].transport.as_deref(), Some("stdio"));
    }

    #[test]
    fn skips_specs_without_command_or_url() {
        let raw = r#"{"mcpServers":{"empty":{}}}"#;
        assert!(parse_plugin_mcp_json(raw, "/opt/p", "p").is_empty());
    }

    #[test]
    fn enabled_list_matches_plugin_and_repo_key() {
        let mut enabled = HashSet::new();
        enabled.insert("x-api".into());
        let disabled = HashSet::new();
        assert!(looks_enabled(
            &enabled,
            &disabled,
            &["x-api", "x-api-bcc58898"]
        ));
        assert!(!looks_enabled(&enabled, &disabled, &["other"]));
        assert!(!looks_enabled(&HashSet::new(), &disabled, &["x-api"]));
        let mut disabled = HashSet::new();
        disabled.insert("x-api".into());
        assert!(!looks_enabled(&enabled, &disabled, &["x-api"]));
    }

    #[test]
    fn discover_reads_registry_and_respects_enabled() {
        let root = std::env::temp_dir().join(format!(
            "grok-plugin-mcp-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let plugin_dir = root.join("installed-plugins").join("x-api-bcc58898");
        fs::create_dir_all(plugin_dir.join("mcp")).unwrap();
        fs::write(
            plugin_dir.join(".mcp.json"),
            r#"{"mcpServers":{"x-api":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]}}}"#,
        )
        .unwrap();
        fs::write(
            root.join("installed-plugins").join("registry.json"),
            format!(
                r#"{{"version":1,"repos":{{"x-api-bcc58898":{{"path":"{}","plugins":{{"x-api":{{"version":"0.1.0"}}}}}}}}}}"#,
                plugin_dir.display().to_string().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        fs::write(
            root.join("config.toml"),
            "[plugins]\nenabled = [\"x-api\"]\n",
        )
        .unwrap();

        let defs = discover_plugin_mcp_servers_in(&root);
        assert_eq!(defs.len(), 1, "{defs:?}");
        assert_eq!(defs[0].name, "x-api");
        assert!(defs[0].args.as_ref().unwrap()[0].ends_with("mcp/server.mjs"));

        fs::write(root.join("config.toml"), "[plugins]\nenabled = []\n").unwrap();
        assert!(discover_plugin_mcp_servers_in(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_root_from_stdio_server_arg() {
        let def = McpServerDef {
            name: "x-api".into(),
            command: Some("node".into()),
            args: Some(vec!["/opt/plug/mcp/server.mjs".into()]),
            env: None,
            url: None,
            headers: None,
            transport: Some("stdio".into()),
            enabled: None,
            scope: Some("plugin:x-api".into()),
        };
        assert_eq!(
            plugin_root_from_def(&def).as_deref(),
            Some(Path::new("/opt/plug"))
        );
    }

    #[test]
    fn shortens_undici_fetch_failed_stack() {
        let stderr = "node:internal/deps/undici/undici:14902 Error.captureStackTrace(err);\n^\nTypeError: fetch failed at async exchangeCode";
        let msg = shorten_cli_error(stderr, "");
        assert!(msg.contains("api.x.com"), "{msg}");
        assert!(!msg.contains("node:internal"), "{msg}");
    }
}
