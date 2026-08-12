//! Headless Grok turns for Remote IM (spawn `grok -p` streaming; ACP fallback later).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::context::{extract_context_signals, ContextCompactSnapshot, ContextUsageSnapshot};

pub struct GrokTurnResult {
    pub text: String,
    pub session_id: Option<String>,
    pub error: Option<String>,
    pub usage: Option<ContextUsageSnapshot>,
    pub compact: Option<ContextCompactSnapshot>,
}

pub fn resolve_grok_binary() -> PathBuf {
    if let Ok(p) = which::which("grok") {
        return p;
    }
    let home = crate::process_util::user_home();
    let candidates = [
        home.join(".grok/bin/grok"),
        PathBuf::from("/usr/local/bin/grok"),
        PathBuf::from("/opt/homebrew/bin/grok"),
    ];
    for c in candidates {
        if c.is_file() {
            return c;
        }
    }
    PathBuf::from("grok")
}

/// Same GROK_HOME the App uses for ACP inference.
/// Independent / custom route → agent-home; shared + official → ~/.grok.
/// Without this, `/r` resumes with an agent session id that only exists under agent-home
/// and the CLI reports "Session not found locally" + remote 404.
pub fn resolve_remote_grok_home() -> PathBuf {
    let mode = crate::store::load_settings().session_data_mode;
    let custom_route = matches!(
        crate::providers::active_route(),
        crate::providers::ActiveRoute::Custom { .. }
    );
    crate::paths::resolve_inference_grok_home(&mode, custom_route)
}

fn apply_agent_env(cmd: &mut Command) {
    let grok_home = resolve_remote_grok_home();
    let _ = std::fs::create_dir_all(&grok_home);
    cmd.env("GROK_HOME", &grok_home);
    // Independent / custom: App-synced auth/providers (same as ACP spawn path).
    let mode = crate::store::load_settings().session_data_mode;
    let custom_route = matches!(
        crate::providers::active_route(),
        crate::providers::ActiveRoute::Custom { .. }
    );
    if crate::paths::needs_agent_home_spawn_prep(&mode, custom_route) {
        crate::providers::prepare_route_auth_for_agent();
    }
    // GUI-spawned processes often lack ~/.grok/bin on PATH.
    if let Ok(path) = std::env::var("PATH") {
        let home = crate::process_util::user_home();
        let extra = [
            home.join(".grok/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        let mut parts: Vec<String> = path.split(':').map(|s| s.to_string()).collect();
        for e in extra {
            let s = e.to_string_lossy().to_string();
            if e.is_dir() && !parts.iter().any(|p| p == &s) {
                parts.insert(0, s);
            }
        }
        cmd.env("PATH", parts.join(":"));
    }
    // Same proxy injection as ACP spawn (NEW-02) — without this, Remote IM
    // turns go direct and only work when the OS has TUN.
    crate::proxy::apply_to_tokio_command(cmd);
}

/// One-shot headless turn with JSON-line stream parse (compatible with Grok Build CLI).
pub async fn run_turn(
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    on_delta: Option<tokio::sync::mpsc::Sender<String>>,
) -> GrokTurnResult {
    let binary = resolve_grok_binary();
    // Soft-fail older CLIs for bg-wait flags and partial stream format upgrade.
    let settings = crate::store::load_settings();
    let cli_ver = crate::cli_probe::read_version_of(&binary);
    let bg_wait =
        crate::acp_client::background_wait_spawn_flags_from_settings(&settings, cli_ver.as_deref());
    let (fmt, partial) =
        crate::acp_client::resolve_headless_stream_from_settings(&settings, cli_ver.as_deref());
    let args = super::control_plane::grok_turn_cli_args_full(
        prompt,
        session_id,
        always_approve,
        fmt,
        &partial,
        &bg_wait,
    );

    let mut cmd = Command::new(&binary);
    cmd.args(&args)
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_agent_env(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    tracing::info!(
        binary = %binary.display(),
        cwd = %work_dir.display(),
        resume = ?session_id,
        grok_home = %resolve_remote_grok_home().display(),
        "remote_im: grok turn start"
    );

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return GrokTurnResult {
                text: String::new(),
                session_id: None,
                error: Some(format!("spawn grok failed: {e}")),
                usage: None,
                compact: None,
            };
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut acc = String::new();
    let mut out_sid: Option<String> = None;
    let mut err_msg: Option<String> = None;
    let mut context_usage: Option<ContextUsageSnapshot> = None;
    let mut context_compact: Option<ContextCompactSnapshot> = None;

    // Drain stderr concurrently so the child cannot block on a full pipe.
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !buf.is_empty() {
                    buf.push('\n');
                }
                buf.push_str(&line);
            }
        }
        buf
    });

    if let Some(out) = stdout {
        let mut lines = BufReader::new(out).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let signals = extract_context_signals(&v);
                if signals.usage.is_some() {
                    context_usage = signals.usage;
                }
                if signals.compact.is_some() {
                    context_compact = signals.compact;
                }
                if let Some(sid) = v
                    .get("session_id")
                    .or_else(|| v.get("sessionId"))
                    .and_then(|x| x.as_str())
                {
                    out_sid = Some(sid.to_string());
                }
                let ty = v
                    .get("type")
                    .or_else(|| v.get("event"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if ty == "text" || ty == "assistant" || ty == "content_block_delta" {
                    let delta = v
                        .get("data")
                        .or_else(|| v.get("text"))
                        .or_else(|| v.pointer("/delta/text"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if !delta.is_empty() {
                        acc.push_str(delta);
                        if let Some(ref tx) = on_delta {
                            let _ = tx.send(delta.to_string()).await;
                        }
                    }
                }
                if ty == "error" {
                    err_msg = Some(
                        v.get("message")
                            .or_else(|| v.get("error"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("grok error")
                            .to_string(),
                    );
                }
            } else {
                // plain text line fallback (CLI often prints resume errors here)
                acc.push_str(&line);
                acc.push('\n');
                if let Some(ref tx) = on_delta {
                    let _ = tx.send(format!("{line}\n")).await;
                }
            }
        }
    }

    let status = child.wait().await;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if let Ok(st) = status {
        if !st.success() && acc.trim().is_empty() {
            let se = stderr_text.trim();
            err_msg = Some(if se.is_empty() {
                format!("grok exit {:?}", st.code())
            } else {
                se.chars().take(800).collect()
            });
        }
    }

    // Resume failed under wrong home historically; if we still got a "not found" style
    // error with no useful answer, retry once without --resume so the user is not stuck.
    let resume_failed = session_id.is_some()
        && (acc.contains("not found locally")
            || acc.contains("Failed to restore session")
            || acc.contains("404 Not Found")
            || err_msg
                .as_ref()
                .map(|e| {
                    e.contains("not found") || e.contains("404") || e.contains("Failed to restore")
                })
                .unwrap_or(false));

    if resume_failed {
        tracing::warn!(
            resume = ?session_id,
            cwd = %work_dir.display(),
            grok_home = %resolve_remote_grok_home().display(),
            "remote_im: --resume failed; retrying without resume (new turn in same workdir)"
        );
        let mut fresh = run_turn_simple(work_dir, prompt, None, always_approve).await;
        if fresh.text.trim().is_empty() && fresh.error.is_none() {
            fresh.error = Some(format!(
                "无法恢复会话 `{}`（本地 agent-home 未命中）。已尝试新开一轮但无输出。",
                session_id.unwrap_or("")
            ));
        } else if !fresh.text.trim().is_empty() {
            // Prefix a short notice so user knows history was not loaded.
            let notice = format!(
                "⚠️ 未能恢复历史会话 `{}`，已在同一项目下新开一轮。\n\n",
                session_id.unwrap_or("")
            );
            fresh.text = format!("{notice}{}", fresh.text);
        }
        return fresh;
    }

    // If streaming-json path yields nothing useful, retry simple -p but KEEP resume.
    if acc.trim().is_empty()
        && context_usage.is_none()
        && context_compact.is_none()
        && err_msg
            .as_ref()
            .map(|e| e.contains("exit") || e.contains("spawn"))
            .unwrap_or(true)
    {
        let mut simple = run_turn_simple(work_dir, prompt, session_id, always_approve).await;
        // Prefer stream-path session id; else keep requested resume id for continuity.
        if simple.session_id.is_none() {
            simple.session_id = session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or(out_sid);
        }
        if simple.usage.is_none() {
            simple.usage = context_usage;
        }
        if simple.compact.is_none() {
            simple.compact = context_compact;
        }
        return simple;
    }

    GrokTurnResult {
        text: acc.trim().to_string(),
        session_id: out_sid.or_else(|| {
            session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }),
        error: err_msg,
        usage: context_usage,
        compact: context_compact,
    }
}

async fn run_turn_simple(
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
) -> GrokTurnResult {
    let binary = resolve_grok_binary();
    // Plain -p path; still pass --resume when bound (AC1/AC5 multi-turn).
    let mut args = vec!["-p".to_string(), prompt.to_string()];
    if always_approve {
        args.push("--always-approve".into());
    }
    if let Some(sid) = session_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }
    let mut cmd = Command::new(&binary);
    cmd.args(&args)
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_agent_env(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output().await {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let err = if !out.status.success() && text.is_empty() {
                Some(if stderr.is_empty() {
                    format!("grok exit {:?}", out.status.code())
                } else {
                    stderr
                })
            } else {
                None
            };
            GrokTurnResult {
                text,
                // Preserve resume id when CLI does not echo a new session id.
                session_id: session_id
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                error: err,
                usage: None,
                compact: None,
            }
        }
        Err(e) => GrokTurnResult {
            text: String::new(),
            session_id: session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            error: Some(e.to_string()),
            usage: None,
            compact: None,
        },
    }
}

/// Exposed for unit tests: simple-path argv must include resume.
#[cfg(test)]
pub fn simple_turn_cli_args(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
) -> Vec<String> {
    let mut args = vec!["-p".to_string(), prompt.to_string()];
    if always_approve {
        args.push("--always-approve".into());
    }
    if let Some(sid) = session_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_fallback_keeps_resume_flag() {
        let args = simple_turn_cli_args("hi", Some("sess-abc"), false);
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--resume" && w[1] == "sess-abc"),
            "simple path must pass --resume for multi-turn after /r: {args:?}"
        );
        let no = simple_turn_cli_args("hi", None, true);
        assert!(!no.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn remote_grok_home_matches_app_inference_home() {
        let mode = crate::store::load_settings().session_data_mode;
        let custom_route = matches!(
            crate::providers::active_route(),
            crate::providers::ActiveRoute::Custom { .. }
        );
        let home = resolve_remote_grok_home();
        let expected = crate::paths::resolve_inference_grok_home(&mode, custom_route);
        assert_eq!(home, expected);
        // Independent or custom route: agent-home (not bare ~/.grok).
        if mode != "shared" || custom_route {
            assert!(
                home.ends_with("agent-home") || home.to_string_lossy().contains("agent-home"),
                "inference GROK_HOME should be agent-home when independent/custom, got {}",
                home.display()
            );
        }
    }
}
