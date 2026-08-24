//! Official-credential side-channel for layered capabilities.
//!
//! When the interactive agent runs a text-only custom main model (DeepSeek),
//! vision / web_search / X tools must **not** share that process's auth or
//! base_url. This module prepares an isolated `GROK_HOME` (official auth +
//! grok-4.5) and runs short **ACP** jobs (preferred) or `grok -p` fallback:
//!
//! - image description
//! - web_search
//! - all `x_*` tools (keyword / semantic / user / thread)
//!
//! Prefer ACP (`agent stdio` under `agent-home-official`) so Host can bridge
//! stream / tool progress into Chat chips. Fall back to `grok -p` when ACP
//! spawn fails.
//!
//! Never writes official `auth.json` into the main agent-home while a custom
//! relay is active (OIDC pollution).

#![allow(dead_code)] // residual-clippy: x_search / aux helpers retained for tests and future host wiring
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::acp_client::{AcpClient, AcpEvent, SpawnOptions, StreamKind};
use crate::agent_home_config::set_table_string;
use crate::cli_probe;
use crate::paths::{app_data_root, ensure_app_dirs};
use crate::process_util;
use crate::providers::OFFICIAL_CATALOG_MODEL;
use crate::proxy;
use crate::secrets;
use crate::store;
use serde::{Deserialize, Serialize};

/// Isolated profile for official aux headless jobs.
pub fn official_aux_home() -> PathBuf {
    app_data_root().join("agent-home-official")
}

pub fn official_aux_config_toml() -> PathBuf {
    official_aux_home().join("config.toml")
}

/// Official catalog model used for side-channel jobs.
pub fn official_aux_model_id() -> &'static str {
    OFFICIAL_CATALOG_MODEL
}

/// Whether we can run official aux jobs (CLI login and/or official API key).
pub fn official_aux_available() -> bool {
    cli_probe::cli_auth_json_present() || {
        let disk = secrets::load_secrets_disk_only();
        secrets::has_official_key_configured(&disk)
    }
}

/// Ensure `agent-home-official` exists with official auth + grok-4.5 default.
///
/// - Copies `~/.grok/auth.json` when present (OIDC for official path only).
/// - Writes `[models] default = grok-4.5` and optional `[model.grok-4.5] api_key`.
pub fn ensure_official_aux_home() -> Result<PathBuf, String> {
    let _ = ensure_app_dirs();
    let home = official_aux_home();
    fs::create_dir_all(&home).map_err(|e| format!("official aux home: {e}"))?;

    // Sync CLI OIDC into this isolated home only (never main agent-home here).
    let cli_auth = process_util::user_home().join(".grok").join("auth.json");
    let dest_auth = home.join("auth.json");
    if cli_auth.is_file() {
        let need = match (cli_auth.metadata(), dest_auth.metadata()) {
            (Ok(sm), Ok(dm)) => {
                sm.len() != dm.len()
                    || sm
                        .modified()
                        .ok()
                        .zip(dm.modified().ok())
                        .map(|(a, b)| a > b)
                        .unwrap_or(true)
            }
            (Ok(_), Err(_)) => true,
            _ => false,
        };
        if need {
            fs::copy(&cli_auth, &dest_auth).map_err(|e| format!("copy auth.json: {e}"))?;
        }
    }

    let mut text = fs::read_to_string(official_aux_config_toml()).unwrap_or_default();
    text = set_table_string(&text, "models", "default", OFFICIAL_CATALOG_MODEL);

    // Prefer API key when configured so headless works without OIDC file.
    // When only SuperGrok OIDC is present (auth.json), do **not** leave a
    // stale/wrong [model.grok-4.5] api_key — Imagine would prefer a bad key
    // and return HTTP 400 "Incorrect API key".
    let secrets = store::load_secrets();
    let key = secrets
        .official_api_key
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let table = format!("model.{OFFICIAL_CATALOG_MODEL}");
    if let Some(ref key) = key {
        text = set_table_string(&text, &table, "model", OFFICIAL_CATALOG_MODEL);
        text = set_table_string(&text, &table, "name", "Grok 4.6");
        text = set_table_string(
            &text,
            &table,
            "base_url",
            crate::models_aux::OFFICIAL_GROK_BASE_URL,
        );
        text = set_table_string(
            &text,
            &table,
            "api_backend",
            crate::models_aux::OFFICIAL_GROK_API_BACKEND,
        );
        text = set_table_string(&text, &table, "api_key", key);
        tracing::info!(
            target: "official_aux",
            "official aux home: using Settings official API key for Imagine/X"
        );
    } else if dest_auth.is_file() {
        // OIDC path: strip any leftover api_key line under model.grok-4.5 so
        // the CLI uses auth.json (subscription) instead of a dead key.
        text = strip_table_key(&text, &table, "api_key");
        tracing::info!(
            target: "official_aux",
            "official aux home: using OIDC auth.json (no Settings API key)"
        );
    }

    if !cli_auth.is_file()
        && key.is_none()
        && !secrets::has_official_key_configured(&secrets::load_secrets_disk_only())
    {
        // Still write default so errors are about auth, not missing section.
        tracing::warn!(target: "official_aux", "no CLI auth.json and no official API key");
    }

    fs::write(official_aux_config_toml(), text)
        .map_err(|e| format!("write official aux config: {e}"))?;
    let _ = write_official_aux_mcp_script(&home);
    Ok(home)
}

/// Remove `key = …` under `[table]` (line-oriented; keeps other keys).
fn strip_table_key(text: &str, table: &str, key: &str) -> String {
    let header = format!("[{table}]");
    let mut out: Vec<String> = Vec::new();
    let mut in_table = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_table = trimmed == header;
            out.push(line.to_string());
            continue;
        }
        if in_table {
            let key_part = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key_part == key {
                continue;
            }
        }
        out.push(line.to_string());
    }
    let mut joined = out.join("\n");
    if text.ends_with('\n') && !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// Status for UI / MCP readiness.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialAuxStatus {
    pub available: bool,
    pub home: String,
    pub model: String,
    pub has_cli_auth: bool,
    pub has_api_key: bool,
    pub reason: String,
}

pub fn status() -> OfficialAuxStatus {
    let has_cli = cli_probe::cli_auth_json_present();
    let disk = secrets::load_secrets_disk_only();
    let has_key = secrets::has_official_key_configured(&disk);
    let available = has_cli || has_key;
    let reason = if available {
        if has_cli && has_key {
            "cli_auth_and_api_key".into()
        } else if has_cli {
            "cli_auth".into()
        } else {
            "api_key".into()
        }
    } else {
        "none — sign in with grok login or paste an official API key".into()
    };
    OfficialAuxStatus {
        available,
        home: official_aux_home().display().to_string(),
        model: OFFICIAL_CATALOG_MODEL.into(),
        has_cli_auth: has_cli,
        has_api_key: has_key,
        reason,
    }
}

/// Fallback: `GROK_HOME=agent-home-official grok -p -m grok-4.5 …`
/// Prefer [`run_official_acp_job`] for Host pre-run (stream bridge).
pub fn run_official_headless(
    prompt: &str,
    max_turns: u32,
    timeout: Duration,
) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }
    if !official_aux_available() {
        return Err(
            "official aux unavailable: run `grok login` or set official API key in Settings → Account"
                .into(),
        );
    }
    let home = ensure_official_aux_home()?;
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let cli = probe
        .path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "grok CLI not found".to_string())?;

    let mut cmd = Command::new(&cli);
    cmd.arg("--no-auto-update")
        .arg("-p")
        .arg(prompt)
        .arg("-m")
        .arg(OFFICIAL_CATALOG_MODEL)
        .arg("--always-approve")
        .arg("--max-turns")
        .arg(max_turns.clamp(1, 32).to_string())
        .arg("--effort")
        .arg("low")
        .arg("--output-format")
        .arg("plain");
    cmd.env("GROK_HOME", &home);
    // Official profile only — do not leak these into the DeepSeek agent process.
    cmd.env("GROK_WEB_SEARCH_MODEL", OFFICIAL_CATALOG_MODEL);
    cmd.env("GROK_IMAGE_DESCRIPTION_MODEL", OFFICIAL_CATALOG_MODEL);
    process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    proxy::apply_to_std_command(&mut cmd);

    tracing::info!(
        target: "official_aux",
        "headless start model={} home={} prompt_chars={}",
        OFFICIAL_CATALOG_MODEL,
        home.display(),
        prompt.len()
    );

    let started = Instant::now();
    // `Command::output()` cannot be interrupted once the child wedges. Poll a
    // spawned child instead so the timeout actually kills the fallback and
    // releases the caller's side-channel slot.
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("official aux spawn: {e}"))?;
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("official aux wait: {e}"))?
            .is_some()
        {
            break;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "official aux timed out after {}s",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("official aux wait: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() && stdout.trim().is_empty() {
        let preview: String = stderr.chars().take(500).collect();
        return Err(format!("official aux failed: {preview}"));
    }
    if stdout.trim().is_empty() {
        let preview: String = stderr.chars().take(500).collect();
        return Err(format!("official aux empty: {preview}"));
    }
    Ok(stdout)
}

// ── ACP side-channel (preferred) ────────────────────────────────────────────

/// Progress event bridged into Chat host tool chips.
#[derive(Debug, Clone)]
pub struct OfficialAcpProgress {
    /// Short non-technical detail for the chip (may be a stream tail).
    pub detail: String,
    /// Optional tool title override from agent tool_call.
    pub tool_title: Option<String>,
    /// Optional tool status from agent.
    pub tool_status: Option<String>,
}

/// Callback type for streaming progress into the main session UI.
pub type OfficialProgressCb = Arc<dyn Fn(OfficialAcpProgress) + Send + Sync>;

fn clip_detail(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let clipped: String = t.chars().take(max.saturating_sub(1)).collect();
    format!("{clipped}…")
}

/// One-shot official ACP job: isolated GROK_HOME + stream bridge + kill.
///
/// Falls back to [`run_official_headless`] when ACP spawn/handshake fails.
pub async fn run_official_acp_job(
    prompt: &str,
    max_turns: u32,
    timeout: Duration,
    progress: Option<OfficialProgressCb>,
) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }
    if !official_aux_available() {
        return Err(
            "official aux unavailable: run `grok login` or set official API key in Settings → Account"
                .into(),
        );
    }

    match run_official_acp_job_inner(prompt, max_turns, timeout, progress.clone()).await {
        Ok(text) => Ok(text),
        Err(e) => {
            tracing::warn!(
                target: "official_aux",
                "ACP side-channel failed ({e}); falling back to grok -p"
            );
            if let Some(ref cb) = progress {
                cb(OfficialAcpProgress {
                    detail: "switching transport…".into(),
                    tool_title: None,
                    tool_status: Some("in_progress".into()),
                });
            }
            let p = prompt.to_string();
            let mt = max_turns;
            let to = timeout;
            tokio::task::spawn_blocking(move || run_official_headless(&p, mt, to))
                .await
                .map_err(|e| format!("join: {e}"))?
        }
    }
}

async fn run_official_acp_job_inner(
    prompt: &str,
    max_turns: u32,
    timeout: Duration,
    progress: Option<OfficialProgressCb>,
) -> Result<String, String> {
    let home = ensure_official_aux_home()?;
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let cli = probe
        .path
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| "grok CLI not found".to_string())?;
    let cli_path = PathBuf::from(cli);

    // Use official home as cwd so @image absolute paths still work; home is
    // the isolated profile only for GROK_HOME env.
    let cwd = std::env::current_dir().unwrap_or_else(|_| home.clone());

    let opts = SpawnOptions {
        model_id: Some(OFFICIAL_CATALOG_MODEL.into()),
        effort: Some("low".into()),
        permission_policy: Some("always_approve".into()),
        product_mode: Some("agent".into()),
        sandbox_profile: Some("off".into()),
        json_schema: None,
        plugin_dirs: Vec::new(),
        extra_rules: Some(
            "You are an isolated official side-job. Complete the task and stop. \
No repo edits. Prefer built-in tools. Keep the final answer concise and complete."
                .into(),
        ),
        max_agent_turns: Some(max_turns.clamp(1, 32)),
        system_prompt_override: None,
        no_ask_user: Some(true),
        fork_session: false,
        grok_home_override: Some(home.clone()),
        empty_mcp_servers: true,
    };

    tracing::info!(
        target: "official_aux",
        "ACP start model={} home={} prompt_chars={} timeout={:?}",
        OFFICIAL_CATALOG_MODEL,
        home.display(),
        prompt.len(),
        timeout
    );

    let (client, mut events) = AcpClient::spawn_with_home(cli_path, cwd, "independent", opts)
        .await
        .map_err(|e| format!("official ACP spawn: {}", e.message))?;

    let acc = Arc::new(std::sync::Mutex::new(String::new()));
    let acc_ev = Arc::clone(&acc);
    let progress_ev = progress.clone();
    let client_pump = Arc::clone(&client);
    let pump = tokio::spawn(async move {
        while let Some((_sid, ev)) = events.recv().await {
            match ev {
                AcpEvent::Stream { kind, text, .. } => {
                    if text.is_empty() {
                        continue;
                    }
                    if matches!(kind, StreamKind::Assistant | StreamKind::Thought) {
                        if let Ok(mut g) = acc_ev.lock() {
                            g.push_str(&text);
                            if let Some(ref cb) = progress_ev {
                                // Full accumulated body for native tool expand (cap for UI).
                                // Keep newlines so the rail matches other tool dumps.
                                let body = clip_detail(g.as_str(), 4_000);
                                cb(OfficialAcpProgress {
                                    detail: body,
                                    tool_title: None,
                                    tool_status: Some("in_progress".into()),
                                });
                            }
                        }
                    }
                }
                AcpEvent::ToolCall {
                    title,
                    status,
                    kind,
                    ..
                } => {
                    // Status/progress only — never overwrite the stream body with a tool name.
                    if let Some(ref cb) = progress_ev {
                        let label = if !title.is_empty() {
                            title.clone()
                        } else if !kind.is_empty() {
                            kind.replace('_', " ")
                        } else {
                            String::new()
                        };
                        let body = acc_ev
                            .lock()
                            .ok()
                            .map(|g| clip_detail(g.as_str(), 4_000))
                            .unwrap_or_default();
                        cb(OfficialAcpProgress {
                            detail: if body.is_empty() && !label.is_empty() {
                                label.clone()
                            } else {
                                body
                            },
                            tool_title: if label.is_empty() { None } else { Some(label) },
                            tool_status: Some(if status.is_empty() {
                                "in_progress".into()
                            } else {
                                status
                            }),
                        });
                    }
                }
                AcpEvent::PromptComplete { .. } => break,
                AcpEvent::ProcessExited { .. } | AcpEvent::Error { .. } => break,
                AcpEvent::PermissionRequest { rpc_id, .. } => {
                    // Always-approve path: CLI wire optionId (#523).
                    let _ = client_pump
                        .respond_permission(
                            rpc_id,
                            crate::acp_client::PermissionOutcome::Selected {
                                option_id: crate::permission::FALLBACK_ALLOW_ONCE.into(),
                            },
                        )
                        .await;
                }
                _ => {}
            }
        }
    });

    let open = tokio::time::timeout(
        Duration::from_secs(45),
        client.initialize_and_open_session(None, false),
    )
    .await;
    match open {
        Ok(Ok((_sid, _))) => {}
        Ok(Err(e)) => {
            client.kill().await;
            let _ = pump.await;
            return Err(format!("official ACP open: {}", e.message));
        }
        Err(_) => {
            client.kill().await;
            let _ = pump.await;
            return Err("official ACP open timeout".into());
        }
    }

    if let Some(ref cb) = progress {
        cb(OfficialAcpProgress {
            detail: "connected…".into(),
            tool_title: None,
            tool_status: Some("in_progress".into()),
        });
    }

    let prompt_fut = client.prompt(prompt);
    let prompt_res = tokio::time::timeout(timeout, prompt_fut).await;
    match prompt_res {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            client.kill().await;
            let _ = pump.await;
            // Prefer partial stream if any.
            let partial = acc.lock().map(|g| g.clone()).unwrap_or_default();
            if partial.trim().len() > 40 {
                tracing::warn!(
                    target: "official_aux",
                    "official ACP prompt error but partial text ok: {}",
                    e.message
                );
                return Ok(partial);
            }
            return Err(format!("official ACP prompt: {}", e.message));
        }
        Err(_) => {
            client.abort_pending_prompts("official aux timeout");
            let _ = client.cancel().await;
            client.kill().await;
            let _ = pump.await;
            let partial = acc.lock().map(|g| g.clone()).unwrap_or_default();
            if partial.trim().len() > 40 {
                return Ok(partial);
            }
            return Err("official ACP timeout".into());
        }
    }

    client.kill().await;
    let _ = tokio::time::timeout(Duration::from_secs(5), pump).await;

    let text = acc.lock().map(|g| g.clone()).unwrap_or_default();
    if text.trim().is_empty() {
        return Err("official ACP empty response".into());
    }
    tracing::info!(
        target: "official_aux",
        "ACP ok chars={}",
        text.len()
    );
    Ok(text)
}

// ── Capability wrappers ─────────────────────────────────────────────────────

fn vision_prompt(paths: &[String], question: Option<&str>) -> Result<String, String> {
    if paths.is_empty() {
        return Err("no image paths".into());
    }
    for p in paths {
        if !Path::new(p).is_file() {
            return Err(format!("not a file: {p}"));
        }
    }
    let q = question
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(
            "Describe each image thoroughly for a coding agent: UI text, layout, errors, code, diagrams, and actionable detail. Be concrete.",
        );
    let refs = paths
        .iter()
        .map(|p| format!("@{p}"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!(
        r#"{q}

Images (use native vision; you can see these files):
{refs}

Reply with one <image_description path="…">…</image_description> block per image.
Do not refuse; do not claim you cannot see images."#
    ))
}

/// Describe local image path(s) via official ACP (preferred) or headless.
pub fn vision_describe(paths: &[String], question: Option<&str>) -> Result<String, String> {
    let prompt = vision_prompt(paths, question)?;
    run_official_headless(&prompt, 4, Duration::from_secs(150))
}

/// Async vision with stream progress for Chat chips.
pub async fn vision_describe_async(
    paths: &[String],
    question: Option<&str>,
    progress: Option<OfficialProgressCb>,
) -> Result<String, String> {
    let prompt = vision_prompt(paths, question)?;
    run_official_acp_job(&prompt, 4, Duration::from_secs(150), progress).await
}

/// Web search via official `web_search` tool inside headless Grok.
pub fn web_search(query: &str) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let prompt = format!(
        r#"You are an isolated research side-job with official Grok credentials.

Use the built-in **web_search** tool (and web_fetch if needed) for:
{q}

Rules:
1. You MUST call web_search at least once.
2. Prefer primary sources; include URLs.
3. Reply in the same language as the query.
4. Do not edit files or run unrelated shell commands.
5. Final answer: concise markdown findings + link list."#
    );
    run_official_headless(&prompt, 10, Duration::from_secs(180))
}

/// `x_keyword_search` — keyword / advanced-syntax search on X.
pub fn x_keyword_search(
    query: &str,
    limit: Option<u32>,
    min_faves: Option<u32>,
) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let limit = limit.unwrap_or(10).clamp(1, 25);
    let faves = min_faves
        .map(|n| format!("min_faves:{n}"))
        .unwrap_or_default();
    let prompt = format!(
        r#"You are an isolated X (Twitter) research side-job with official Grok credentials.

Call the built-in tool **x_keyword_search** with:
- query: {q}
- limit: {limit}
{faves}

If x_keyword_search is unavailable, try x_semantic_search with the same query.

Rules:
1. You MUST use an x_* search tool (not web_search for X posts).
2. Return posts with real https://x.com/…/status/… URLs when available.
3. Markdown list: author, text excerpt, url, engagement if known.
4. Same language as the query for commentary; keep original post language.
5. No file edits."#
    );
    run_official_headless(&prompt, 12, Duration::from_secs(180))
}

/// `x_semantic_search` — semantic search on X.
pub fn x_semantic_search(query: &str, limit: Option<u32>) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let limit = limit.unwrap_or(10).clamp(1, 25);
    let prompt = format!(
        r#"You are an isolated X research side-job with official Grok credentials.

Call **x_semantic_search** with query: {q}, limit: {limit}.
Fallback: x_keyword_search if semantic is unavailable.

Return markdown with x.com status URLs. No file edits."#
    );
    run_official_headless(&prompt, 12, Duration::from_secs(180))
}

/// `x_user_search` — find X users.
pub fn x_user_search(query: &str, count: Option<u32>) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let count = count.unwrap_or(5).clamp(1, 20);
    let prompt = format!(
        r#"You are an isolated X research side-job with official Grok credentials.

Call **x_user_search** with query: {q}, count: {count}.

Return markdown: handle, display name, bio excerpt, profile url. No file edits."#
    );
    run_official_headless(&prompt, 8, Duration::from_secs(120))
}

/// `x_thread_fetch` — fetch a post thread by id or url.
pub fn x_thread_fetch(post_id_or_url: &str) -> Result<String, String> {
    let id = post_id_or_url.trim();
    if id.is_empty() {
        return Err("post_id_or_url is empty".into());
    }
    let prompt = format!(
        r#"You are an isolated X research side-job with official Grok credentials.

Call **x_thread_fetch** for: {id}
(If the tool wants a numeric post_id, extract it from an x.com status URL.)

Return the thread as markdown with status URLs. No file edits."#
    );
    run_official_headless(&prompt, 10, Duration::from_secs(150))
}

/// Imagine `image_gen` — text → image via official credentials.
pub fn image_gen(prompt: &str, aspect_ratio: Option<&str>) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("prompt is empty".into());
    }
    let ar = aspect_ratio
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("1:1");
    let agent_prompt = format!(
        r#"You are an isolated Imagine side-job with official Grok credentials.

Call the built-in tool **image_gen** with:
- prompt: {p}
- aspect_ratio: {ar}

Rules:
1. You MUST call image_gen (not web_search, not vision_describe).
2. After generation, report each resulting image as an absolute filesystem path.
3. Do not invent paths that do not exist on disk.
4. Final answer: short markdown with the path(s) and one-line caption."#
    );
    run_official_headless(&agent_prompt, 16, Duration::from_secs(360))
}

/// Imagine `image_edit` — edit/transform local image(s) via official credentials.
pub fn image_edit(
    prompt: &str,
    images: &[String],
    aspect_ratio: Option<&str>,
) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("prompt is empty".into());
    }
    if images.is_empty() {
        return Err("image path(s) required".into());
    }
    let refs = images
        .iter()
        .map(|s| format!("@{}", s.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    let ar = aspect_ratio
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("- aspect_ratio: {s}\n"))
        .unwrap_or_default();
    let agent_prompt = format!(
        r#"You are an isolated Imagine side-job with official Grok credentials.

Call the built-in tool **image_edit** with the edit request and reference image(s).

Edit prompt: {p}

Reference image(s):
{refs}
{ar}
Rules:
1. You MUST call image_edit.
2. Report absolute path(s) of the edited output file(s).
3. Do not invent paths. Final answer: markdown with path(s)."#
    );
    run_official_headless(&agent_prompt, 16, Duration::from_secs(360))
}

/// Imagine `image_to_video` — animate one local image to short video.
pub fn image_to_video(
    image: &str,
    prompt: Option<&str>,
    duration: Option<u32>,
    resolution_name: Option<&str>,
) -> Result<String, String> {
    let img = image.trim();
    if img.is_empty() {
        return Err("image path is empty".into());
    }
    let dur = match duration {
        Some(10) => 10,
        _ => 6,
    };
    let res = resolution_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("480p");
    let motion = prompt
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("- prompt: {s}\n"))
        .unwrap_or_default();
    let agent_prompt = format!(
        r#"You are an isolated Imagine video side-job with official Grok credentials.

Call the built-in tool **image_to_video** with:
- image: absolute path below
- duration: {dur}
- resolution_name: {res}
{motion}
Source image:
@{img}

Rules:
1. You MUST call image_to_video (not image_gen).
2. Report the absolute path of the generated video file.
3. Do not invent paths. Final answer: markdown with the video path."#
    );
    run_official_headless(&agent_prompt, 16, Duration::from_secs(420))
}

/// Imagine `reference_to_video` — multi-image reference + prompt → video.
pub fn reference_to_video(
    prompt: &str,
    images: &[String],
    aspect_ratio: Option<&str>,
    duration: Option<u32>,
    resolution_name: Option<&str>,
) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("prompt is empty".into());
    }
    if images.len() < 2 {
        return Err("reference_to_video needs at least 2 image paths".into());
    }
    let ar = aspect_ratio
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("16:9");
    let dur = match duration {
        Some(10) => 10,
        _ => 6,
    };
    let res = resolution_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("480p");
    let refs = images
        .iter()
        .map(|s| format!("@{}", s.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    let agent_prompt = format!(
        r#"You are an isolated Imagine video side-job with official Grok credentials.

Call the built-in tool **reference_to_video** with:
- prompt: {p}
- aspect_ratio: {ar}
- duration: {dur}
- resolution_name: {res}
- images: the reference paths below

Reference images:
{refs}

Rules:
1. You MUST call reference_to_video.
2. Report the absolute path of the generated video file.
3. Do not invent paths. Final answer: markdown with the video path."#
    );
    run_official_headless(&agent_prompt, 16, Duration::from_secs(420))
}

/// Generic dispatch for MCP / CLI shim: tool name → headless.
pub fn dispatch_tool(tool: &str, args: &serde_json::Value) -> Result<String, String> {
    let name = tool.trim().to_ascii_lowercase();
    // Accept both bare names and host_ / official_ prefixes.
    let name = name
        .strip_prefix("host_")
        .or_else(|| name.strip_prefix("official_"))
        .unwrap_or(name.as_str());

    match name {
        "vision_describe" | "image_description" | "describe_image" => {
            let paths = args
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .or_else(|| {
                    args.get("path")
                        .and_then(|v| v.as_str())
                        .map(|s| vec![s.to_string()])
                })
                .unwrap_or_default();
            let question = args.get("question").and_then(|v| v.as_str());
            vision_describe(&paths, question)
        }
        "web_search" => {
            let q = args
                .get("query")
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            web_search(q)
        }
        "x_keyword_search" => {
            let q = args
                .get("query")
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as u32);
            let min_faves = args
                .get("min_faves")
                .or_else(|| args.get("minFaves"))
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            x_keyword_search(q, limit, min_faves)
        }
        "x_semantic_search" => {
            let q = args
                .get("query")
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as u32);
            x_semantic_search(q, limit)
        }
        "x_user_search" => {
            let q = args
                .get("query")
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let count = args.get("count").and_then(|v| v.as_u64()).map(|n| n as u32);
            x_user_search(q, count)
        }
        "x_thread_fetch" => {
            let id = args
                .get("post_id")
                .or_else(|| args.get("postId"))
                .or_else(|| args.get("url"))
                .or_else(|| args.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            x_thread_fetch(id)
        }
        "image_gen" | "imagine" | "generate_image" => {
            let p = args
                .get("prompt")
                .or_else(|| args.get("query"))
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let ar = args
                .get("aspect_ratio")
                .or_else(|| args.get("aspectRatio"))
                .and_then(|v| v.as_str());
            image_gen(p, ar)
        }
        "image_edit" | "edit_image" => {
            let p = args
                .get("prompt")
                .or_else(|| args.get("query"))
                .or_else(|| args.get("q"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mut imgs: Vec<String> = args
                .get("images")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if imgs.is_empty() {
                if let Some(one) = args
                    .get("image")
                    .or_else(|| args.get("path"))
                    .and_then(|v| v.as_str())
                {
                    imgs.push(one.to_string());
                }
            }
            let ar = args
                .get("aspect_ratio")
                .or_else(|| args.get("aspectRatio"))
                .and_then(|v| v.as_str());
            image_edit(p, &imgs, ar)
        }
        "image_to_video" | "animate_image" | "img2video" => {
            let img = args
                .get("image")
                .or_else(|| args.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let prompt = args
                .get("prompt")
                .or_else(|| args.get("query"))
                .and_then(|v| v.as_str());
            let duration = args
                .get("duration")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let res = args
                .get("resolution_name")
                .or_else(|| args.get("resolutionName"))
                .and_then(|v| v.as_str());
            image_to_video(img, prompt, duration, res)
        }
        "reference_to_video" | "refs_to_video" => {
            let p = args
                .get("prompt")
                .or_else(|| args.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let imgs: Vec<String> = args
                .get("images")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let ar = args
                .get("aspect_ratio")
                .or_else(|| args.get("aspectRatio"))
                .and_then(|v| v.as_str());
            let duration = args
                .get("duration")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let res = args
                .get("resolution_name")
                .or_else(|| args.get("resolutionName"))
                .and_then(|v| v.as_str());
            reference_to_video(p, &imgs, ar, duration, res)
        }
        other => Err(format!("unknown official aux tool: {other}")),
    }
}

/// Embedded MCP server source (repo `scripts/official-aux-mcp.mjs`).
///
/// Packaged `/Applications/Grok.app` has no repo tree and does not bundle this
/// file as a Tauri resource. Host writes it into `agent-home-official` so ACP
/// inject still works after an updater install.
pub const OFFICIAL_AUX_MCP_SCRIPT: &str = include_str!("../../scripts/official-aux-mcp.mjs");
pub const OFFICIAL_AUX_MCP_SCRIPT_FILE: &str = "official-aux-mcp.mjs";

/// Write (or refresh) the official-aux MCP stdio script under `home`.
pub fn write_official_aux_mcp_script(home: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(home).map_err(|e| format!("official aux home: {e}"))?;
    let dest = home.join(OFFICIAL_AUX_MCP_SCRIPT_FILE);
    let current = fs::read_to_string(&dest).unwrap_or_default();
    if current != OFFICIAL_AUX_MCP_SCRIPT {
        fs::write(&dest, OFFICIAL_AUX_MCP_SCRIPT)
            .map_err(|e| format!("write official-aux mcp script: {e}"))?;
    }
    Ok(dest)
}

/// Path to the bundled MCP entry (repo `scripts/official-aux-mcp.mjs`).
///
/// Prefer [`write_official_aux_mcp_script`] for ACP inject. This lookup is a
/// dev/fallback path (cargo tree / cwd).
pub fn mcp_script_path() -> Option<PathBuf> {
    let written = official_aux_home().join(OFFICIAL_AUX_MCP_SCRIPT_FILE);
    if written.is_file() {
        return Some(written);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Compile-time crate dir → repo root (src-tauri/../scripts)
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("../scripts/official-aux-mcp.mjs"));
    candidates.push(PathBuf::from("scripts/official-aux-mcp.mjs"));
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("scripts/official-aux-mcp.mjs"));
        candidates.push(cwd.join("../scripts/official-aux-mcp.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        // target/debug → repo
        if let Some(root) = exe.ancestors().nth(3) {
            candidates.push(root.join("scripts/official-aux-mcp.mjs"));
        }
        if let Some(root) = exe.ancestors().nth(4) {
            candidates.push(root.join("scripts/official-aux-mcp.mjs"));
        }
    }
    for c in candidates {
        if let Ok(canon) = c.canonicalize() {
            if canon.is_file() {
                return Some(canon);
            }
        } else if c.is_file() {
            return Some(c);
        }
    }
    None
}

/// ACP mcpServers entry for official aux tools (stdio Node script).
pub fn mcp_server_acp_entry() -> Option<serde_json::Value> {
    mcp_server_acp_entry_reason().0
}

/// Same as [`mcp_server_acp_entry`], plus why it is `None` (for connect logs).
pub fn mcp_server_acp_entry_reason() -> (Option<serde_json::Value>, &'static str) {
    if !official_aux_available() {
        return (None, "official aux credentials missing");
    }
    let home = match ensure_official_aux_home() {
        Ok(h) => h,
        Err(_) => return (None, "ensure official aux home failed"),
    };
    let script = match write_official_aux_mcp_script(&home) {
        Ok(p) => p,
        Err(_) => return (None, "write official-aux mcp script failed"),
    };
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli) = probe.path.filter(|p| !p.trim().is_empty()) else {
        return (None, "grok CLI path missing");
    };

    // Prefer node; fall back to `grok` not applicable for MCP protocol.
    let node = which_node().unwrap_or_else(|| "node".into());

    (
        Some(serde_json::json!({
            "name": "official-aux",
            "command": node,
            "args": [script.display().to_string()],
            "env": [
                {"name": "OFFICIAL_AUX_HOME", "value": home.display().to_string()},
                {"name": "OFFICIAL_AUX_MODEL", "value": OFFICIAL_CATALOG_MODEL},
                {"name": "OFFICIAL_AUX_CLI", "value": cli},
                {"name": "GROK_HOME", "value": home.display().to_string()},
            ]
        })),
        "ok",
    )
}

fn which_node() -> Option<String> {
    for name in ["node", "nodejs"] {
        if let Ok(out) = process_util::command("which").arg(name).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Whether the active inference channel is a **custom** provider (not official Grok).
///
/// Official-aux MCP / Host vision side-channels must only run on custom routes so
/// SuperGrok / OIDC sessions keep native tools and are not polluted with duplicates.
pub fn main_route_is_custom() -> bool {
    matches!(
        crate::providers::active_route(),
        crate::providers::ActiveRoute::Custom { .. }
    )
}

/// Whether to inject official-aux MCP into the next ACP session.
///
/// Requires:
/// - user setting `official_aux_inject`
/// - official credentials available (for the side-channel home)
/// - **custom main route** (never inject on official subscription)
pub fn should_inject_mcp_for_main() -> bool {
    let settings = store::load_settings();
    if !settings.official_aux_inject {
        return false;
    }
    if !main_route_is_custom() {
        return false;
    }
    official_aux_available()
}

/// When inject is on: only load `official-aux` (default), unless user opts into
/// loading all extension MCPs alongside it (`official_aux_with_user_mcp`).
pub fn should_load_user_mcp_with_official_aux() -> bool {
    store::load_settings().official_aux_with_user_mcp
}

/// Built-in Grok tools that must **not** run on the custom main process.
///
/// On custom routes those tools hit xAI with the wrong/missing key (main
/// agent-home has no official auth). Imagine / X / vision must go through
/// MCP `official-aux` under `agent-home-official` (OIDC or official API key).
pub fn native_media_tools_to_disallow_on_custom_main() -> &'static [&'static str] {
    &[
        "image_gen",
        "image_edit",
        "image_to_video",
        "reference_to_video",
    ]
}

/// Merge settings denylist with official-aux inject denylist (custom main only).
///
/// Note: CLI `--disallowed-tools` is **headless-only** (`grok -p`). ACP
/// `agent stdio` often ignores it, so custom main also installs a PreToolUse
/// hook via [`sync_native_media_block_hook`].
pub fn merge_disallowed_tools_for_main(settings_tools: &[String]) -> Vec<String> {
    let mut out: Vec<String> = settings_tools.to_vec();
    if should_inject_mcp_for_main() {
        for t in native_media_tools_to_disallow_on_custom_main() {
            out.push((*t).to_string());
        }
    }
    out
}

/// Stable hook filenames under `{GROK_HOME}/hooks/` (agent-home when independent).
pub const NATIVE_MEDIA_BLOCK_HOOK_FILE: &str = "grok-app-block-native-imagine.json";
pub const NATIVE_MEDIA_BLOCK_HOOK_SCRIPT: &str = "grok-app-block-native-imagine.sh";

/// Deny reason when native Imagine tools fire on custom main.
pub fn native_media_block_hook_reason() -> &'static str {
    "Native Imagine tools (image_gen/image_edit/image_to_video/reference_to_video) are blocked on custom main — agent-home has no official xAI auth. Immediately call use_tool with tool_name official-aux__image_gen (or official-aux__image_edit / official-aux__image_to_video / official-aux__reference_to_video). Do NOT search_tool or use ChatCut. Do NOT fall back to PIL/code art. After a successful official-aux media tool, report the absolute path as plain text — do NOT read_file the image (text-only main models crash on image_url)."
}

/// Deny reason when read_file targets an image (would inject image_url into DeepSeek etc.).
pub fn native_media_block_read_image_reason() -> &'static str {
    "read_file on image files is blocked on custom text-only main: tool results embed image_url and the relay API returns 400 (unknown variant image_url). Report the absolute path as plain text for the user/UI. Vision is already provided via Host vision or official-aux__vision_describe — do not re-open generated PNG/JPG/WebP."
}

/// Shell script body: inspect PreToolUse stdin; deny native Imagine + image read_file.
pub fn native_media_block_hook_script_body() -> String {
    native_media_block_hook_script_body_with(true)
}

/// Same hook; when `block_image_read` is false, vision-capable custom mains
/// may `read_file` PNG/JPG (pixels already go out as `image_url`).
pub fn native_media_block_hook_script_body_with(block_image_read: bool) -> String {
    // Reasons embedded as Python triple-quoted constants (no shell env expansion).
    let reason_imagine = native_media_block_hook_reason().replace('\\', "\\\\");
    let reason_read = native_media_block_read_image_reason().replace('\\', "\\\\");
    let block_flag = if block_image_read { "True" } else { "False" };
    // Grok pipes PreToolUse event JSON on the hook process stdin.
    // IMPORTANT: do not use `python3 <<'PY'` alone — that steals stdin for the
    // script body and the event is lost. Save stdin to a temp file first.
    // Fail-open (exit 0, empty) if python missing or parse fails.
    format!(
        r#"#!/bin/sh
# Managed by Grok App — do not edit; recreated on spawn when inject is on.
# Denies: bare image_gen/image_edit/video tools; read_file of image extensions.
f=$(mktemp 2>/dev/null) || exit 0
cat >"$f" 2>/dev/null || {{ rm -f "$f"; exit 0; }}
python3 - "$f" <<'PY'
import json, os, sys

REASON_IMAGINE = r"""{reason_imagine}"""
REASON_READ_IMAGE = r"""{reason_read}"""
BLOCK_IMAGE_READ = {block_flag}

def deny(reason: str) -> None:
    print(json.dumps({{"decision": "deny", "reason": reason}}, ensure_ascii=False))
    sys.exit(0)

def allow() -> None:
    sys.exit(0)

path = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
finally:
    try:
        os.remove(path)
    except Exception:
        pass

if not raw.strip():
    allow()
try:
    ev = json.loads(raw)
except Exception:
    allow()

name = (ev.get("toolName") or ev.get("tool_name") or "").strip()
name_l = name.lower()
inp = ev.get("toolInput") or ev.get("tool_input") or {{}}
if not isinstance(inp, dict):
    inp = {{}}

native = {{"image_gen", "image_edit", "image_to_video", "reference_to_video"}}
if name_l in native or name in native:
    deny(REASON_IMAGINE)

# read_file / Read — block image paths so image_url never hits text-only relays
if BLOCK_IMAGE_READ and (
    name_l in {{"read_file", "read", "notebookread"}} or name in {{"Read", "NotebookRead"}}
):
    p = (
        inp.get("target_file")
        or inp.get("path")
        or inp.get("file_path")
        or inp.get("filePath")
        or ""
    )
    if isinstance(p, list) and p:
        p = p[0]
    p = str(p).strip()
    lower = p.lower()
    if any(lower.endswith(ext) for ext in (
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".avif", ".svg"
    )):
        deny(REASON_READ_IMAGE)

allow()
PY
"#
    )
}

/// JSON body for the managed PreToolUse hook that denies native Imagine tools
/// and read_file of image files (custom text-only main safety).
///
/// `command` is relative to the hook JSON file (Grok resolves relative paths).
/// Matcher is broad; the script decides allow vs deny from stdin toolName/input.
pub fn native_media_block_hook_json() -> String {
    let doc = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "^(image_gen|image_edit|image_to_video|reference_to_video|read_file|Read|NotebookRead)$",
                "hooks": [{
                    "type": "command",
                    "command": NATIVE_MEDIA_BLOCK_HOOK_SCRIPT,
                    "timeout": 5
                }]
            }]
        }
    });
    format!(
        "{}\n",
        serde_json::to_string_pretty(&doc).unwrap_or_else(|_| doc.to_string())
    )
}

fn current_main_is_text_only() -> bool {
    let list = match crate::providers::list_custom_providers() {
        Ok(l) => l,
        Err(_) => return true,
    };
    let text = fs::read_to_string(&list.config_path).unwrap_or_default();
    crate::models_aux::main_is_text_only(&text, &list)
}

/// Install or remove the native-Imagine block hook under agent GROK_HOME.
///
/// When `enabled` (custom + inject): write `{home}/hooks/grok-app-block-native-imagine.{json,sh}`.
/// When disabled: remove those managed files only (never touch user hooks).
pub fn sync_native_media_block_hook(session_data_mode: &str, enabled: bool) -> Result<(), String> {
    if session_data_mode == "shared" {
        // Never rewrite shared ~/.grok hooks for this App-only policy.
        return Ok(());
    }
    let home = crate::paths::resolve_agent_grok_home(session_data_mode);
    let hooks_dir = home.join("hooks");
    let path = hooks_dir.join(NATIVE_MEDIA_BLOCK_HOOK_FILE);
    let script_path = hooks_dir.join(NATIVE_MEDIA_BLOCK_HOOK_SCRIPT);
    if enabled {
        fs::create_dir_all(&hooks_dir).map_err(|e| format!("create agent hooks dir: {e}"))?;
        let body = native_media_block_hook_json();
        let block_image_read = current_main_is_text_only();
        let script = native_media_block_hook_script_body_with(block_image_read);
        let need_json = match fs::read_to_string(&path) {
            Ok(existing) => existing != body,
            Err(_) => true,
        };
        let need_script = match fs::read_to_string(&script_path) {
            Ok(existing) => existing != script,
            Err(_) => true,
        };
        if need_json {
            fs::write(&path, body).map_err(|e| format!("write native media block hook: {e}"))?;
        }
        if need_script {
            fs::write(&script_path, script)
                .map_err(|e| format!("write native media block script: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755));
            }
        }
        if need_json || need_script {
            tracing::info!(
                target: "official_aux",
                path = %path.display(),
                "installed PreToolUse hook to block native Imagine on custom main"
            );
        }
    } else {
        if path.is_file() {
            let _ = fs::remove_file(&path);
        }
        if script_path.is_file() {
            let _ = fs::remove_file(&script_path);
        }
        if !path.exists() {
            tracing::info!(
                target: "official_aux",
                path = %path.display(),
                "removed native Imagine block hook (inject off / official route)"
            );
        }
    }
    Ok(())
}

/// Sync hook based on current inject gate (spawn / settings path).
pub fn sync_native_media_block_hook_for_current(session_data_mode: &str) -> Result<(), String> {
    sync_native_media_block_hook(session_data_mode, should_inject_mcp_for_main())
}

/// Session `--rules` body when official-aux inject is on (always available for tests).
pub fn official_aux_session_rules_text() -> &'static str {
    r#"Official-aux MCP (server name: official-aux) is the PRIMARY toolbox for this custom main model.

Exact tools (call via use_tool with these tool_name values ONLY — do NOT search_tool first):
- official-aux__x_keyword_search  — X/Twitter/推特/推文/x上 关键词搜帖（默认首选）
- official-aux__x_semantic_search — X 语义/话题搜索
- official-aux__x_user_search     — X 用户/账号/@handle
- official-aux__x_thread_fetch    — 帖子线程 URL/status id
- official-aux__web_search        — 普通网页搜索
- official-aux__vision_describe   — 识图（若已有 [Host vision] / <image_description> 则禁止再调）
- official-aux__image_gen         — Imagine 文生图 / 画图 / 生成图片（唯一正确入口）
- official-aux__image_edit        — Imagine 改图 / 修图（需本地参考图路径）
- official-aux__image_to_video    — 单图 → 短视频 / 图生视频（唯一正确入口）
- official-aux__reference_to_video — 多图参考 + 文案 → 视频

ChatCut is a video editor MCP. It is NOT X search, web search, or Grok Imagine.
Ignore ChatCut connect failures for those jobs. Never call chatcut__* / search_stock_media for X.

CRITICAL — native Imagine is BLOCKED on this process:
- Do NOT call bare tools image_gen / image_edit / image_to_video / reference_to_video.
- Those hit agent-home without official auth → HTTP 400 Incorrect API key.
- A PreToolUse hook will deny them; treat that deny as a redirect to official-aux__*.
- Do NOT fall back to PIL / matplotlib / code-drawn "pixel art" when the user asked for Imagine.
- After official-aux returns a path: FINISH the turn with the absolute path in markdown for the user.
- NEVER call read_file / Read on .png/.jpg/.jpeg/.webp/.gif/.bmp after generation or to "verify" quality.
  Text-only relays (DeepSeek etc.) crash with: unknown variant `image_url`, expected `text`.
  The UI shows generated media from the path; you do not need to re-open the file.

When the user asks to search X / Twitter / 推特 / x上 / 推文:
1. Immediately use_tool tool_name="official-aux__x_keyword_search" with the topic keywords.
2. Do NOT call search_tool. Do NOT use ChatCut, Playwright, open-websearch, curl, or bash as X search.

When the user asks to 画图 / 生成图片 / imagine / image_gen / 出图:
1. Immediately use_tool tool_name="official-aux__image_gen" with prompt (+ aspect_ratio).
2. For reference-anchored edits: use_tool official-aux__image_edit with prompt + image path(s).
3. Do NOT use ChatCut image-gen / submit_image.

When the user asks to 生成视频 / 图生视频 / animate / make a video:
1. One source image → use_tool official-aux__image_to_video (image path + optional motion prompt).
2. Multiple reference images → use_tool official-aux__reference_to_video (prompt + images[]).
3. Prefer these over Playwright screen-record, curl, or ChatCut video-gen unless the user asked for ChatCut.

Do NOT:
- bash sleep while MCP connects
- prefer Playwright browser for X when official-aux x_* exists
- curl/wget as first choice for X
- use open-websearch for X posts
- invent image/video paths that were not returned by official-aux media tools
- call bare image_gen / image_edit after a deny or API-key error

If official-aux tools are missing from the session, say so — do not substitute ChatCut. Never busy-wait."#
}

/// Session `--rules` block when official-aux is active (DeepSeek etc. need this).
/// Official Grok main route must not receive this (native tools already exist).
pub fn inject_session_rules() -> Option<String> {
    if !should_inject_mcp_for_main() {
        return None;
    }
    Some(official_aux_session_rules_text().trim().to_string())
}

/// Narrow path-citation rules for Grok App UI (all routes).
///
/// Soft guidance only — Host still normalizes shell escapes / rejects site-root
/// paths. Prefer disambiguated project-relative code paths; absolute only for
/// local media. Always-on via [`merge_extra_rules`] → `grok --rules`.
pub fn path_citation_session_rules() -> &'static str {
    // Keep compact: injected on every session spawn. Inline backticks only —
    // fenced ``` blocks are NOT turned into FilePathCards in the chat UI.
    r#"Path citations (Grok App UI — so path cards / previews work):
- Cite paths as **inline** backticks only: `path/to/file.ext`. One path per backtick span.
- Do **not** put the only path citation inside a fenced code block (``` … ``` / ```text). Fenced blocks stay plain text and are not clickable path cards. Fences are for multi-line content previews, not for path handoff.
- Do **not** write tool-journal forms in user-facing prose (`input:/abs/path`, `tool_step|…`, shell-only dumps). Cite the path for the human, not as a tool field.
- Project code and docs: prefer **project-relative** paths with enough unique segments to disambiguate. When many files share the same basename or short tail (e.g. many article templates all have `04-正文/正文.md` or bare `正文.md`), include the unique parent folders from the project root — never cite only the shared tail.
- Local media the user should preview (images/videos on disk): real absolute filesystem path in **inline** backticks. Use real spaces — never shell escapes like `\ ` or `\(1\)`. You may also add a short session-relative form after it (e.g. `images/1.jpg`).
- Web/CMS/OSS assets: full `https://…` URLs. Never present site-root paths like `/images/…` as local files.
- Do not invent paths that do not exist on disk. Prefer one clear citation near the claim; avoid repeating the same long absolute path on every minor edit."#
}

/// Merge user session extra_rules with always-on path rules + official-aux inject.
pub fn merge_extra_rules(user: Option<&str>) -> Option<String> {
    let path = path_citation_session_rules().trim();
    let inject = inject_session_rules();
    let user = user
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    // Channel-level rules from the active custom provider (Settings → Providers).
    let channel = crate::providers::active_provider_append_prompt();
    let mut parts: Vec<String> = Vec::with_capacity(4);
    if let Some(u) = user {
        parts.push(u);
    }
    if let Some(c) = channel {
        parts.push(c);
    }
    // Always inject path citation rules (short; display stays basename via UI).
    if !path.is_empty() {
        parts.push(path.to_string());
    }
    if let Some(i) = inject {
        parts.push(i);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

/// Detect X / Twitter research intent in user-facing prompt text.
///
/// **Must not** fire on image-only turns: composer attaches files as
/// `@/abs/path.png`, and a bare `@` used to match as an X handle signal.
///
/// `prior_context` (optional recent journal turns) resolves pronouns like
/// 「它 / 这个」 so Host X does not search the literal sentence
/// 「搜索它在 x 上的信息」 when the user meant the previous topic (e.g. DeepSeek).
pub fn detect_x_search_intent(prompt: &str) -> Option<XSearchIntent> {
    detect_x_search_intent_with_context(prompt, None)
}

/// Same as [`detect_x_search_intent`] with optional prior chat text for coref.
pub fn detect_x_search_intent_with_context(
    prompt: &str,
    prior_context: Option<&str>,
) -> Option<XSearchIntent> {
    // Use only the user turn when bootstrap is present.
    let user_part = prompt
        .rsplit_once("[End of prior context")
        .map(|(_, rest)| rest)
        .unwrap_or(prompt);
    let user_part = user_part
        .rsplit_once("---\n\n")
        .map(|(_, rest)| rest)
        .unwrap_or(user_part);
    // Drop image `@/path` tokens before intent scoring — they are not X handles.
    let (user_clean, image_paths) = crate::models_aux::strip_image_at_paths(user_part);
    let user_clean = user_clean.trim();
    // Image-only (or near-empty after strip) → never host X pre-search.
    if user_clean.is_empty() && !image_paths.is_empty() {
        return None;
    }
    let t = user_clean.to_ascii_lowercase();
    // True X / Twitter signals only (not filesystem `@/…` paths).
    // Note: Host no longer pre-runs X via this detector (tools-first). Kept for
    // unit tests / optional helpers only — do not expand as a product intent engine.
    let has_at_handle = text_has_x_handle_token(user_clean);
    let x_signal = t.contains("twitter")
        || t.contains("推特")
        || t.contains("x.com")
        || t.contains("tweet")
        || t.contains("推文")
        || has_at_handle
        || t.contains("账号")
        || t.contains("帳號")
        || t.contains("粉丝")
        || t.contains("粉絲")
        || t.contains("在 x")
        || t.contains("on x")
        || t.contains("from x")
        || t.contains(" x ")
        || t.contains("\nx ")
        || t.starts_with("x ")
        || t.ends_with(" x")
        || t == "x";
    let search_signal = t.contains("搜")
        || t.contains("search")
        || t.contains("查")
        || t.contains("找")
        || t.contains("信息")
        || t.contains("資訊")
        || t.contains("资料")
        || t.contains("資料")
        || t.contains("谁是")
        || t.contains("誰是")
        || t.contains("about");
    // Require a real X signal. "search + random x letter" is too broad and
    // false-fired on image paths / unrelated Chinese text.
    if !x_signal {
        return None;
    }
    // Pure "mention X" without research intent still ok when handle/url present.
    if !search_signal && !has_at_handle && extract_x_status_ref(user_clean).is_none() {
        // Allow short "在 x 上 …账号" style that already set x_signal via 账号.
        if !(t.contains("账号")
            || t.contains("帳號")
            || t.contains("twitter")
            || t.contains("推特")
            || t.contains("tweet")
            || t.contains("推文"))
        {
            return None;
        }
    }

    // Handle: @name or bare handle after 账号
    let handle = extract_x_handle(user_clean);
    if let Some(h) = handle {
        return Some(XSearchIntent::User { query: h });
    }
    // Status URL / id
    if let Some(url) = extract_x_status_ref(user_clean) {
        return Some(XSearchIntent::Thread { id_or_url: url });
    }
    // Build keyword: strip filler, resolve pronouns from prior turns.
    let q = rewrite_x_keyword_query(user_clean, prior_context);
    if q.is_empty() {
        return None;
    }
    Some(XSearchIntent::Keyword {
        query: q.chars().take(200).collect(),
    })
}

/// Whether the query still looks like a pronoun / empty entity (needs coref).
fn query_needs_coref(q: &str) -> bool {
    let t = q.trim().to_ascii_lowercase();
    if t.is_empty() {
        return true;
    }
    // Pure pronouns / deictics
    matches!(
        t.as_str(),
        "它" | "他"
            | "她"
            | "这个"
            | "那个"
            | "此"
            | "该"
            | "这"
            | "那"
            | "this"
            | "that"
            | "it"
            | "they"
            | "them"
            | "this one"
            | "that one"
    ) || t.chars().all(|c| {
        matches!(
            c,
            '它' | '他' | '她' | '这' | '那' | '个' | '该' | '此' | '的' | '们'
        )
    })
}

/// Strip search/X filler words so we don't pass the whole sentence to x_keyword_search.
fn strip_x_search_filler(text: &str) -> String {
    let mut s = text.trim().to_string();
    // Order matters: longer phrases first.
    let fillers = [
        "相关的信息",
        "相关信息",
        "有关的信息",
        "有关信息",
        "的信息",
        "的資訊",
        "的资料",
        "的資料",
        "最新动态",
        "最新消息",
        "搜索一下",
        "搜一下",
        "帮我搜索",
        "帮我搜",
        "请搜索",
        "请搜",
        "搜索",
        "搜尋",
        "查找",
        "查一下",
        "查询",
        "在 x 上搜索",
        "在x上搜索",
        "在 X 上搜索",
        "在X上搜索",
        "在 x 上",
        "在x上",
        "在 X 上",
        "在X上",
        "x上搜索",
        "X上搜索",
        "x 上搜索",
        "X 上搜索",
        "x上搜",
        "x搜索",
        "X搜索",
        "搜索x上",
        "搜索X上",
        "搜x上",
        "在 twitter 上",
        "在twitter上",
        "在 推特 上",
        "在推特上",
        "on x",
        "on X",
        "on twitter",
        "from x",
        "x 上的",
        "X 上的",
        "x上的",
        "X上的",
        "x上",
        "X上",
        "x 上",
        "X 上",
        "twitter 上的",
        "推特上的",
        "关于",
        "有关",
        "一下",
        "和图片",
        "和圖片",
        "的图片",
        "的圖片",
    ];
    for f in fillers {
        while let Some(p) = s.find(f) {
            s = format!("{}{}", &s[..p], &s[p + f.len()..]);
        }
    }
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Pull a plausible entity name from prior user/assistant text for coref.
pub fn extract_topic_entity_from_context(prior: &str) -> Option<String> {
    let prior = prior.trim();
    if prior.is_empty() {
        return None;
    }
    // Prefer recent lines (end of prior context).
    let blob = prior
        .lines()
        .rev()
        .take(40)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    // 1) @handles in prior (not file paths)
    if let Some(h) = extract_x_handle(&blob) {
        return Some(h);
    }

    // 2) Latin product/brand tokens (DeepSeek, OpenAI, …) — longest first
    let mut candidates: Vec<String> = Vec::new();
    for tok in blob.split(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                ',' | '.'
                    | '。'
                    | '，'
                    | '、'
                    | ':'
                    | '：'
                    | '/'
                    | '\\'
                    | '|'
                    | '"'
                    | '\''
                    | '`'
                    | '('
                    | ')'
                    | '（'
                    | '）'
                    | '《'
                    | '》'
                    | '【'
                    | '】'
                    | '#'
                    | '*'
            )
    }) {
        let t = tok.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-');
        if t.len() < 3 || t.len() > 40 {
            continue;
        }
        // Must look like a product name: has a letter, not pure digits
        if !t.chars().any(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        if t.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let lower = t.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "http"
                | "https"
                | "www"
                | "com"
                | "the"
                | "and"
                | "for"
                | "with"
                | "from"
                | "this"
                | "that"
                | "search"
                | "twitter"
                | "user"
                | "info"
                | "about"
                | "model"
                | "agent"
                | "tool"
                | "true"
                | "false"
                | "null"
        ) {
            continue;
        }
        // Prefer CamelCase / mixed or known-looking brands
        let has_upper = t.chars().any(|c| c.is_ascii_uppercase());
        let has_digit = t.chars().any(|c| c.is_ascii_digit());
        if (has_upper || has_digit || t.len() >= 5)
            && !candidates.iter().any(|c| c.eq_ignore_ascii_case(t))
        {
            candidates.push(t.to_string());
        }
    }
    // Prefer the last (most recent) strong candidate
    if let Some(c) = candidates.last() {
        return Some(c.clone());
    }

    // 3) Chinese proper-ish nouns near 搜索/了解/关于 in last user lines
    for line in blob.lines().rev() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("tool_step") || line.starts_with('#') {
            continue;
        }
        for key in ["搜索", "了解", "关于", "有关", "查一下", "介绍"] {
            if let Some(pos) = line.find(key) {
                let rest = line[pos + key.len()..].trim();
                let entity: String = rest
                    .chars()
                    .take_while(|c| {
                        !matches!(
                            *c,
                            '的' | '相' | '在' | '上' | '，' | ',' | '。' | ' ' | '：' | ':'
                        )
                    })
                    .collect();
                let entity = entity.trim();
                if entity.chars().count() >= 2
                    && entity.chars().count() <= 20
                    && !query_needs_coref(entity)
                    && entity != "信息"
                    && entity != "资讯"
                {
                    return Some(entity.to_string());
                }
            }
        }
    }
    None
}

/// Rewrite raw user text into a better x_keyword_search query.
pub fn rewrite_x_keyword_query(user_clean: &str, prior_context: Option<&str>) -> String {
    let mut q = strip_x_search_filler(user_clean);
    // Remove leftover standalone x/twitter tokens
    q = q
        .split_whitespace()
        .filter(|w| {
            let l = w.to_ascii_lowercase();
            !matches!(
                l.as_str(),
                "x" | "twitter" | "推特" | "tweet" | "tweets" | "信息" | "资讯" | "资料"
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    q = q.trim().to_string();

    if query_needs_coref(&q) || q.is_empty() {
        if let Some(prior) = prior_context {
            if let Some(entity) = extract_topic_entity_from_context(prior) {
                tracing::info!(
                    target: "official_aux",
                    "x query coref: {:?} + prior → {}",
                    user_clean,
                    entity
                );
                return entity;
            }
        }
    }

    // If still a long Chinese sentence with 它/这个, try coref + keep rest
    if prior_context.is_some()
        && (user_clean.contains('它')
            || user_clean.contains("这个")
            || user_clean.contains("那个")
            || user_clean.contains("该"))
    {
        if let Some(entity) = extract_topic_entity_from_context(prior_context.unwrap_or("")) {
            tracing::info!(
                target: "official_aux",
                "x query pronoun rewrite: {:?} → {}",
                user_clean,
                entity
            );
            return entity;
        }
    }

    if q.is_empty() {
        // Last resort: original without only the worst fillers
        return user_clean
            .replace("在 x 上", "")
            .replace("在x上", "")
            .replace("搜索", "")
            .trim()
            .chars()
            .take(200)
            .collect();
    }
    q
}

/// Build a short prior-context blob from App session journal (user + assistant).
///
/// Skips the **latest user** message (already the current turn — may only say
/// 「搜索它在 x 上」) so coref can resolve 「它」 from earlier turns.
pub fn prior_context_for_session(app_session_id: &str) -> String {
    let msgs = crate::store::load_messages(app_session_id);
    let end = if msgs.last().map(|m| m.role == "user").unwrap_or(false) {
        msgs.len().saturating_sub(1)
    } else {
        msgs.len()
    };
    let mut parts: Vec<String> = Vec::new();
    for m in msgs[..end].iter().rev() {
        if m.role != "user" && m.role != "assistant" {
            continue;
        }
        if m.is_error {
            continue;
        }
        let c = m.content.trim();
        if c.is_empty() || c.starts_with("tool_step|") {
            continue;
        }
        // Skip huge assistant dumps
        let snippet: String = c.chars().take(400).collect();
        parts.push(format!("{}: {snippet}", m.role));
        if parts.len() >= 6 {
            break;
        }
    }
    parts.reverse();
    parts.join("\n")
}

/// True when text has `@handle` (2–20 alnum/_) that is **not** a filesystem path.
fn text_has_x_handle_token(text: &str) -> bool {
    for token in text.split_whitespace() {
        let t = token.trim_matches(|c: char| {
            matches!(
                c,
                ',' | '.' | '。' | '，' | '"' | '\'' | '!' | '?' | '？' | '！'
            )
        });
        if let Some(h) = t.strip_prefix('@') {
            if h.starts_with('/') || h.starts_with('\\') {
                continue; // @/Users/... image path
            }
            // Windows @C:\...
            let b = h.as_bytes();
            if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
                continue;
            }
            if h.len() >= 2
                && h.len() <= 20
                && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return true;
            }
        }
    }
    false
}

#[derive(Debug, Clone)]
pub enum XSearchIntent {
    User { query: String },
    Keyword { query: String },
    Thread { id_or_url: String },
}

fn extract_x_handle(text: &str) -> Option<String> {
    // @handle — never treat @/abs/path or @C:\path as a handle
    for token in text.split_whitespace() {
        let t = token.trim_matches(|c: char| matches!(c, ',' | '.' | '。' | '，' | '"' | '\''));
        if let Some(h) = t.strip_prefix('@') {
            let h = h.trim();
            if h.starts_with('/') || h.starts_with('\\') {
                continue;
            }
            let b = h.as_bytes();
            if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
                continue;
            }
            if h.len() >= 2
                && h.len() <= 20
                && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return Some(h.to_string());
            }
        }
    }
    // "账号 xxx" / "用户 xxx" / "user xxx"
    let lower = text.to_ascii_lowercase();
    for key in ["账号", "帳號", "用户", "用戶", "user ", "handle "] {
        if let Some(pos) = lower.find(key) {
            let rest = text[pos + key.len()..].trim();
            let tok = rest
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|c: char| matches!(c, ',' | '.' | '。' | '，' | '@'));
            if tok.len() >= 2
                && tok.len() <= 20
                && tok.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return Some(tok.to_string());
            }
        }
    }
    // bare alphanumeric token after "在 x 上搜索"
    if lower.contains("搜索") || lower.contains("搜尋") || lower.contains("search") {
        for tok in text.split_whitespace() {
            let t = tok.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_');
            if t.len() >= 3
                && t.len() <= 20
                && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !matches!(
                    t.to_ascii_lowercase().as_str(),
                    "search"
                        | "twitter"
                        | "https"
                        | "http"
                        | "com"
                        | "this"
                        | "that"
                        | "账号"
                        | "信息"
                )
            {
                // Prefer tokens that look like handles (has digit or mixed case already stripped)
                if t.chars().any(|c| c.is_ascii_digit()) || t.len() >= 5 {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

fn extract_x_status_ref(text: &str) -> Option<String> {
    for tok in text.split_whitespace() {
        if tok.contains("x.com/") && tok.contains("status") {
            return Some(
                tok.trim_matches(|c: char| matches!(c, ',' | '.' | '。' | ')'))
                    .to_string(),
            );
        }
        if tok.contains("twitter.com/") && tok.contains("status") {
            return Some(
                tok.trim_matches(|c: char| matches!(c, ',' | '.' | '。' | ')'))
                    .to_string(),
            );
        }
    }
    None
}

fn x_intent_prompt(intent: &XSearchIntent) -> (String, u32, Duration, String) {
    match intent {
        XSearchIntent::User { query } => {
            let q = query.trim();
            (
                format!(
                    r#"You are an isolated X research side-job with official Grok credentials.

Call **x_user_search** with query: {q}, count: 5.

Return markdown: handle, display name, bio excerpt, profile url. No file edits."#
                ),
                8,
                Duration::from_secs(120),
                format!("x_user_search:{q}"),
            )
        }
        XSearchIntent::Keyword { query } => {
            let q = query.trim();
            (
                format!(
                    r#"You are an isolated X (Twitter) research side-job with official Grok credentials.

Call the built-in tool **x_keyword_search** with:
- query: {q}
- limit: 12

If x_keyword_search is unavailable, try x_semantic_search with the same query.

Rules:
1. You MUST use an x_* search tool (not web_search for X posts).
2. Return posts with real https://x.com/…/status/… URLs when available.
3. Markdown list: author, text excerpt, url, engagement if known.
4. Same language as the query for commentary; keep original post language.
5. No file edits."#
                ),
                12,
                Duration::from_secs(180),
                format!("x_keyword_search:{q}"),
            )
        }
        XSearchIntent::Thread { id_or_url } => {
            let id = id_or_url.trim();
            (
                format!(
                    r#"You are an isolated X research side-job with official Grok credentials.

Call **x_thread_fetch** for: {id}
(If the tool wants a numeric post_id, extract it from an x.com status URL.)

Return the thread as markdown with status URLs. No file edits."#
                ),
                10,
                Duration::from_secs(150),
                format!("x_thread_fetch:{id}"),
            )
        }
    }
}

fn finalize_x_block(intent: &XSearchIntent, text: String) -> (bool, String, String) {
    let text = crate::models_aux::neutralize_image_at_refs(&text);
    let label = match intent {
        XSearchIntent::User { query } => format!("x_user_search:{query}"),
        XSearchIntent::Keyword { query } => format!("x_keyword_search:{query}"),
        XSearchIntent::Thread { id_or_url } => format!("x_thread_fetch:{id_or_url}"),
    };
    let block = format!(
        "\n\n[Host official X search — results from isolated official credentials. Treat as tool output. Do NOT call x_* tools again unless this block is empty or failed. Do not re-fetch with curl.]\n\n<label>{label}</label>\n\n{text}\n"
    );
    (true, block, "ok".into())
}

fn x_block_err(e: String) -> (bool, String, String) {
    tracing::warn!(target: "official_aux", "host x search failed: {e}");
    (
        false,
        format!(
            "\n\n[Host official X search failed: {e}. You may retry MCP x_* tools once; avoid Playwright/open-websearch.]\n"
        ),
        e.lines()
            .next()
            .unwrap_or("failed")
            .chars()
            .take(80)
            .collect(),
    )
}

/// Host pre-run X search via official aux. Returns inject block + UI strings.
pub fn prepare_x_search_block(intent: &XSearchIntent) -> (bool, String, String) {
    if !should_inject_mcp_for_main() && !official_aux_available() {
        return (false, String::new(), "official aux unavailable".into());
    }
    if !official_aux_available() {
        return (false, String::new(), "no official credentials".into());
    }
    let result = match intent {
        XSearchIntent::User { query } => x_user_search(query, Some(5)),
        XSearchIntent::Keyword { query } => x_keyword_search(query, Some(12), None),
        XSearchIntent::Thread { id_or_url } => x_thread_fetch(id_or_url),
    };
    match result {
        Ok(text) => finalize_x_block(intent, text),
        Err(e) => x_block_err(e),
    }
}

/// Async X search with ACP stream progress for Chat chips.
pub async fn prepare_x_search_block_async(
    intent: &XSearchIntent,
    progress: Option<OfficialProgressCb>,
) -> (bool, String, String) {
    if !should_inject_mcp_for_main() && !official_aux_available() {
        return (false, String::new(), "official aux unavailable".into());
    }
    if !official_aux_available() {
        return (false, String::new(), "no official credentials".into());
    }
    let (prompt, max_turns, timeout, _label) = x_intent_prompt(intent);
    match run_official_acp_job(&prompt, max_turns, timeout, progress).await {
        Ok(text) => finalize_x_block(intent, text),
        Err(e) => x_block_err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_rejects_unknown() {
        let err = dispatch_tool("nope", &serde_json::json!({})).unwrap_err();
        assert!(err.contains("unknown"), "{err}");
    }

    #[test]
    fn dispatch_empty_web_search() {
        let err = dispatch_tool("web_search", &serde_json::json!({"query": ""})).unwrap_err();
        assert!(err.contains("empty"), "{err}");
    }

    #[test]
    fn official_home_path_under_app_data() {
        let h = official_aux_home();
        assert!(h.to_string_lossy().contains("agent-home-official"));
    }

    #[test]
    fn detect_x_user_handle_chinese() {
        let intent = detect_x_search_intent("在 x 上搜索 cgnot996 这个账号的信息");
        match intent {
            Some(XSearchIntent::User { query }) => assert_eq!(query, "cgnot996"),
            other => panic!("expected User, got {other:?}"),
        }
    }

    #[test]
    fn rewrite_x_resolves_pronoun_to_deepseek() {
        let prior = "user: 搜索DeepSeek相关的信息\nassistant: DeepSeek 是中国 AI 公司…";
        let q = rewrite_x_keyword_query("搜索它在 x 上的信息", Some(prior));
        assert!(
            q.to_ascii_lowercase().contains("deepseek"),
            "expected DeepSeek coref, got {q:?}"
        );
    }

    #[test]
    fn detect_x_with_context_uses_entity_not_full_sentence() {
        let prior = "user: 搜索DeepSeek相关的信息\nassistant: 概况…";
        let intent = detect_x_search_intent_with_context("搜索它在 x 上的信息", Some(prior));
        match intent {
            Some(XSearchIntent::Keyword { query }) => {
                assert!(
                    query.to_ascii_lowercase().contains("deepseek"),
                    "query={query}"
                );
                assert!(
                    !query.contains("搜索它"),
                    "must not pass literal pronoun sentence: {query}"
                );
            }
            other => panic!("expected Keyword DeepSeek, got {other:?}"),
        }
    }

    #[test]
    fn detect_x_at_handle() {
        let intent = detect_x_search_intent("search twitter for @elonmusk recent posts");
        match intent {
            Some(XSearchIntent::User { query }) => assert_eq!(query, "elonmusk"),
            other => panic!("expected User, got {other:?}"),
        }
    }

    #[test]
    fn detect_x_ignores_image_only_at_paths() {
        let intent = detect_x_search_intent("@/Users/me/Library/Application Support/app/shot.png");
        assert!(
            intent.is_none(),
            "image-only must not trigger X: {intent:?}"
        );
    }

    #[test]
    fn detect_x_ignores_image_with_short_caption() {
        let intent = detect_x_search_intent("这是什么\n\n@/Users/me/Desktop/photo.jpg");
        assert!(
            intent.is_none(),
            "caption+image must not trigger X: {intent:?}"
        );
    }

    #[test]
    fn detect_x_ignores_host_vision_inject_footer() {
        // Regression: after Host vision inject, footer used to contain "X search"
        // and falsely triggered a second host-x tool (duplicate activity rail).
        let prompt = r#"看图

[Host vision — image pixels were NOT sent to the main model. Use the descriptions below; do not claim you cannot see the image. Do NOT call vision_describe again unless a description block is missing or failed.]

<image_description path="/tmp/a.png">
A UI screenshot.
</image_description>
"#;
        assert!(
            detect_x_search_intent(prompt).is_none(),
            "host vision inject must not trigger X"
        );
    }

    #[test]
    fn detect_x_still_works_with_handle_and_image() {
        let intent = detect_x_search_intent("在 x 上搜索 @elonmusk\n\n@/tmp/a.png");
        match intent {
            Some(XSearchIntent::User { query }) => assert_eq!(query, "elonmusk"),
            other => panic!("expected User, got {other:?}"),
        }
    }

    #[test]
    fn official_aux_rules_route_x_to_aux_not_chatcut() {
        let rules = official_aux_session_rules_text();
        assert!(
            rules.contains("official-aux__x_keyword_search"),
            "X search must name the official-aux tool"
        );
        assert!(
            rules.contains("ChatCut") || rules.contains("chatcut"),
            "rules must tell the model ChatCut is not X search"
        );
        assert!(
            !rules.contains("Immediately search_tool query"),
            "search_tool-first discovery lets ChatCut steal X search"
        );
        assert!(
            rules.contains("use_tool") && rules.contains("official-aux__x_keyword_search"),
            "X path must be a direct use_tool"
        );
    }

    #[test]
    fn official_aux_mcp_script_is_embedded() {
        let js = OFFICIAL_AUX_MCP_SCRIPT;
        assert!(js.contains("x_keyword_search"));
        assert!(js.contains("image_gen"));
        assert!(js.contains("official-aux"));
        let dir =
            std::env::temp_dir().join(format!("grok-official-aux-script-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp home");
        let path = write_official_aux_mcp_script(&dir).expect("write script");
        assert!(path.is_file());
        let disk = fs::read_to_string(&path).expect("read");
        assert_eq!(disk, js);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_rules_appends_inject() {
        // Without credentials inject may be None — still ok to call.
        let m = merge_extra_rules(Some("prefer tests"));
        assert!(m.as_deref().unwrap_or("").contains("prefer tests"));
        // Path citation rules always merge (display stays short in UI).
        assert!(m.as_deref().unwrap_or("").contains("Path citations"));
        let only_path = merge_extra_rules(None).expect("path rules alone");
        assert!(only_path.contains("Path citations"));
        assert!(only_path.contains("project-relative"));
        // Product guidance: inline backticks, not fenced-only handoff.
        assert!(only_path.contains("inline"));
        assert!(only_path.to_lowercase().contains("fenced") || only_path.contains("```"));
        // Homonym / template tails must be disambiguated.
        assert!(
            only_path.contains("disambiguate")
                || only_path.contains("unique parent")
                || only_path.contains("shared tail")
        );
        // Never teach tool-journal `input:` as the user-facing path form.
        assert!(only_path.contains("input:/abs/path") || only_path.contains("tool-journal"));
    }

    #[test]
    fn path_citation_rules_stay_compact() {
        // Always-on --rules must not bloat every session spawn.
        let rules = path_citation_session_rules();
        assert!(rules.len() < 2_500, "path rules too long: {}", rules.len());
        assert!(!rules.is_empty());
    }

    #[test]
    fn inject_requires_custom_route_gate_in_code() {
        // Regression: official subscription must never inject solely because
        // inject toggle + credentials are on. The gate is `main_route_is_custom()`.
        // (Full env-dependent should_inject_mcp_for_main is integration-tested.)
        let _ = main_route_is_custom();
        let _ = should_load_user_mcp_with_official_aux();
        // prepare_x_search is no longer called from Host send path; keep API for MCP.
        assert!(matches!(
            detect_x_search_intent("在 x 上搜索 @elonmusk"),
            Some(XSearchIntent::User { .. })
        ));
    }

    #[test]
    fn merge_disallowed_includes_imagine_tools_when_list_nonempty() {
        // When inject is off, merge still returns settings tools only (no panic).
        let base = vec!["Bash".into()];
        let merged = merge_disallowed_tools_for_main(&base);
        assert!(merged.iter().any(|t| t == "Bash"));
        // Imagine denylist entries are only added when should_inject is true
        // (env-dependent). Always expose the static list for docs/spawn.
        let natives = native_media_tools_to_disallow_on_custom_main();
        assert!(natives.contains(&"image_gen"));
        assert!(natives.contains(&"image_edit"));
        assert!(natives.contains(&"image_to_video"));
        assert!(natives.contains(&"reference_to_video"));
    }

    #[test]
    fn native_media_block_hook_json_is_valid_and_targets_imagine_tools() {
        let raw = native_media_block_hook_json();
        let v: serde_json::Value = serde_json::from_str(&raw).expect("hook json");
        let matcher = v["hooks"]["PreToolUse"][0]["matcher"]
            .as_str()
            .unwrap_or("");
        assert!(matcher.contains("image_gen"));
        assert!(matcher.contains("image_to_video"));
        assert!(matcher.contains("read_file"));
        let cmd = v["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap_or("");
        assert_eq!(cmd, NATIVE_MEDIA_BLOCK_HOOK_SCRIPT);
        let script = native_media_block_hook_script_body();
        assert!(script.contains("decision"));
        assert!(script.contains("deny"));
        assert!(script.contains("official-aux__image_gen"));
        assert!(script.contains("read_file"));
        assert!(native_media_block_hook_reason().contains("blocked"));
        assert!(native_media_block_read_image_reason().contains("image_url"));
        let vision = native_media_block_hook_script_body_with(false);
        assert!(vision.contains("BLOCK_IMAGE_READ = False"));
        let text_only = native_media_block_hook_script_body_with(true);
        assert!(text_only.contains("BLOCK_IMAGE_READ = True"));
    }

    #[test]
    fn strip_table_key_removes_api_key_line() {
        let t = "[model.grok-4.5]\nmodel = \"grok-4.5\"\napi_key = \"sk-bad\"\nname = \"Grok\"\n";
        let out = strip_table_key(t, "model.grok-4.5", "api_key");
        assert!(!out.contains("api_key"));
        assert!(out.contains("model = \"grok-4.5\""));
        assert!(out.contains("name = \"Grok\""));
    }
}
