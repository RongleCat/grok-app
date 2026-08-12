//! Headless `--output-format streaming-json` probe (CLI 0.2.117+).
//!
//! In 0.2.117+, headless `streaming-json` emits NDJSON of agent-native ACP
//! session updates. This module soft-gates the flag and runs a short probe
//! for the Diagnostics UI. It is **not** `streaming-messages-json`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

/// First CLI that documents ACP-shaped `streaming-json` NDJSON.
pub const STREAMING_ACP_NDJSON_MIN_CLI: (u64, u64, u64) = (0, 2, 117);

pub const STREAMING_ACP_NDJSON_OUTPUT_FORMAT: &str = "streaming-json";

/// Distinct CLI format — never pass this from this module.
#[allow(dead_code)]
pub const STREAMING_MESSAGES_JSON_OUTPUT_FORMAT: &str = "streaming-messages-json";

pub const DEFAULT_PROBE_PROMPT: &str = "Reply with exactly the word ok and nothing else.";

/// Soft-gate: `Some(true)` ≥ 0.2.117, `Some(false)` older, `None` unparseable.
pub fn cli_supports_streaming_acp_ndjson(raw_version: &str) -> Option<bool> {
    let token = crate::cli_probe::extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= STREAMING_ACP_NDJSON_MIN_CLI)
}

/// `--output-format streaming-json` when version is known ≥ 0.2.117; else empty.
pub fn streaming_json_output_format_args_soft(raw_cli_version: Option<&str>) -> Vec<String> {
    match raw_cli_version {
        Some(v) if cli_supports_streaming_acp_ndjson(v) == Some(true) => vec![
            "--output-format".into(),
            STREAMING_ACP_NDJSON_OUTPUT_FORMAT.into(),
        ],
        _ => Vec::new(),
    }
}

/// Headless probe argv (no binary). Soft-gates output-format.
pub fn streaming_acp_ndjson_probe_args(
    prompt: &str,
    raw_cli_version: Option<&str>,
    always_approve: bool,
    max_turns: u32,
    cwd: Option<&str>,
) -> Vec<String> {
    let prompt = {
        let t = prompt.trim();
        if t.is_empty() {
            DEFAULT_PROBE_PROMPT
        } else {
            t
        }
    };
    let turns = max_turns.clamp(1, 4);
    let mut args = vec![
        "--no-auto-update".into(),
        "-p".into(),
        prompt.to_string(),
        "--max-turns".into(),
        turns.to_string(),
    ];
    if always_approve {
        args.push("--always-approve".into());
    }
    if let Some(c) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--cwd".into());
        args.push(c.to_string());
    }
    args.extend(streaming_json_output_format_args_soft(raw_cli_version));
    args
}

pub fn probe_args_include_streaming_json(args: &[String]) -> bool {
    args.windows(2)
        .any(|w| w[0] == "--output-format" && w[1] == STREAMING_ACP_NDJSON_OUTPUT_FORMAT)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingAcpNdjsonProbeResult {
    pub ok: bool,
    pub supported: Option<bool>,
    pub version: Option<String>,
    pub min_version: String,
    pub binary: Option<String>,
    pub args: Vec<String>,
    pub used_streaming_json: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub error: Option<String>,
    /// Duration of the child process in milliseconds.
    pub duration_ms: u64,
}

fn min_version_str() -> String {
    let (a, b, c) = STREAMING_ACP_NDJSON_MIN_CLI;
    format!("{a}.{b}.{c}")
}

fn resolve_binary(manual_path: Option<&str>) -> Option<PathBuf> {
    let probe = crate::cli_probe::probe_cli(manual_path);
    probe.path.map(PathBuf::from).filter(|p| p.is_file())
}

fn apply_agent_env(cmd: &mut Command) {
    let mode = crate::store::load_settings().session_data_mode;
    let custom_route = matches!(
        crate::providers::active_route(),
        crate::providers::ActiveRoute::Custom { .. }
    );
    let grok_home = crate::paths::resolve_inference_grok_home(&mode, custom_route);
    let _ = std::fs::create_dir_all(&grok_home);
    cmd.env("GROK_HOME", &grok_home);
    if crate::paths::needs_agent_home_spawn_prep(&mode, custom_route) {
        crate::providers::prepare_route_auth_for_agent();
    }
    crate::process_util::ensure_home_env_std(cmd);
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    crate::proxy::apply_to_std_command(cmd);
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(45);

/// Run a short headless turn and return raw stdout NDJSON for the FE parser.
pub fn run_streaming_acp_ndjson_probe(
    prompt: Option<&str>,
    manual_cli_path: Option<&str>,
    cwd: Option<&str>,
) -> StreamingAcpNdjsonProbeResult {
    let min_version = min_version_str();
    let binary = match resolve_binary(manual_cli_path) {
        Some(p) => p,
        None => {
            return StreamingAcpNdjsonProbeResult {
                ok: false,
                supported: None,
                version: None,
                min_version,
                binary: None,
                args: vec![],
                used_streaming_json: false,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
                error: Some("CLI binary not found".into()),
                duration_ms: 0,
            };
        }
    };

    let version = crate::cli_probe::read_version_of(&binary);
    let supported = version
        .as_deref()
        .and_then(cli_supports_streaming_acp_ndjson);

    let prompt_s = prompt.unwrap_or(DEFAULT_PROBE_PROMPT);
    let args = streaming_acp_ndjson_probe_args(prompt_s, version.as_deref(), true, 1, cwd);
    let used_streaming_json = probe_args_include_streaming_json(&args);

    if supported == Some(false) {
        let err = format!("CLI too old for ACP-shaped streaming-json (need ≥ {min_version})");
        return StreamingAcpNdjsonProbeResult {
            ok: false,
            supported: Some(false),
            version,
            min_version,
            binary: Some(binary.display().to_string()),
            args,
            used_streaming_json: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            error: Some(err),
            duration_ms: 0,
        };
    }

    if !used_streaming_json {
        return StreamingAcpNdjsonProbeResult {
            ok: false,
            supported,
            version,
            min_version,
            binary: Some(binary.display().to_string()),
            args,
            used_streaming_json: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            error: Some(
                "Could not soft-enable --output-format streaming-json (unknown CLI version)".into(),
            ),
            duration_ms: 0,
        };
    }

    let work_dir: PathBuf = cwd
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir);

    let started = std::time::Instant::now();
    let mut cmd = Command::new(&binary);
    cmd.args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_agent_env(&mut cmd);
    crate::process_util::apply_no_window_std(&mut cmd);

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return StreamingAcpNdjsonProbeResult {
                ok: false,
                supported,
                version,
                min_version,
                binary: Some(binary.display().to_string()),
                args,
                used_streaming_json,
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
                error: Some(format!("spawn failed: {e}")),
                duration_ms: started.elapsed().as_millis() as u64,
            };
        }
    };

    // Wait with timeout (std thread + kill).
    let result = wait_with_timeout(child, PROBE_TIMEOUT);
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        WaitOutcome::Done {
            status,
            stdout,
            stderr,
        } => {
            let code = status.code();
            let ok = status.success() || !stdout.trim().is_empty();
            StreamingAcpNdjsonProbeResult {
                ok,
                supported,
                version,
                min_version,
                binary: Some(binary.display().to_string()),
                args,
                used_streaming_json,
                exit_code: code,
                stdout: redact_preview(&stdout, 256 * 1024),
                stderr: redact_preview(&stderr, 32 * 1024),
                timed_out: false,
                error: if ok {
                    None
                } else {
                    Some(format!("probe exit {:?}", code.unwrap_or(-1)))
                },
                duration_ms,
            }
        }
        WaitOutcome::TimedOut { stdout, stderr } => StreamingAcpNdjsonProbeResult {
            ok: false,
            supported,
            version,
            min_version,
            binary: Some(binary.display().to_string()),
            args,
            used_streaming_json,
            exit_code: None,
            stdout: redact_preview(&stdout, 256 * 1024),
            stderr: redact_preview(&stderr, 32 * 1024),
            timed_out: true,
            error: Some(format!(
                "probe timed out after {}s",
                PROBE_TIMEOUT.as_secs()
            )),
            duration_ms,
        },
        WaitOutcome::Error(e) => StreamingAcpNdjsonProbeResult {
            ok: false,
            supported,
            version,
            min_version,
            binary: Some(binary.display().to_string()),
            args,
            used_streaming_json,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            error: Some(e),
            duration_ms,
        },
    }
}

enum WaitOutcome {
    Done {
        status: std::process::ExitStatus,
        stdout: String,
        stderr: String,
    },
    TimedOut {
        stdout: String,
        stderr: String,
    },
    Error(String),
}

fn wait_with_timeout(mut child: std::process::Child, timeout: Duration) -> WaitOutcome {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child.stdout.take().map(read_to_string).unwrap_or_default();
                let stderr = child.stderr.take().map(read_to_string).unwrap_or_default();
                return WaitOutcome::Done {
                    status,
                    stdout,
                    stderr,
                };
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let stdout = child.stdout.take().map(read_to_string).unwrap_or_default();
                    let stderr = child.stderr.take().map(read_to_string).unwrap_or_default();
                    return WaitOutcome::TimedOut { stdout, stderr };
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return WaitOutcome::Error(format!("wait failed: {e}")),
        }
    }
}

fn read_to_string<R: std::io::Read>(mut r: R) -> String {
    let mut buf = String::new();
    let _ = r.read_to_string(&mut buf);
    buf
}

fn redact_preview(s: &str, max: usize) -> String {
    let redacted = crate::store::redact_text(s);
    if redacted.len() <= max {
        return redacted;
    }
    let mut out = redacted.chars().take(max).collect::<String>();
    out.push('…');
    out
}

/// Whether `path` looks like a usable cwd for the probe (exists + dir).
#[allow(dead_code)]
pub fn is_probe_cwd(path: &Path) -> bool {
    path.is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_gate_at_0_2_117() {
        assert_eq!(
            cli_supports_streaming_acp_ndjson("grok 0.2.117"),
            Some(true)
        );
        assert_eq!(cli_supports_streaming_acp_ndjson("0.2.200"), Some(true));
        assert_eq!(cli_supports_streaming_acp_ndjson("0.2.116"), Some(false));
        assert_eq!(cli_supports_streaming_acp_ndjson(""), None);
        assert_eq!(cli_supports_streaming_acp_ndjson("nope"), None);
    }

    #[test]
    fn soft_args_only_when_supported() {
        let expected: Vec<String> =
            vec!["--output-format".to_string(), "streaming-json".to_string()];
        assert_eq!(
            streaming_json_output_format_args_soft(Some("grok 0.2.117")),
            expected
        );
        assert!(streaming_json_output_format_args_soft(Some("0.2.100")).is_empty());
        assert!(streaming_json_output_format_args_soft(None).is_empty());
    }

    #[test]
    fn probe_args_include_format_when_gated() {
        let args = streaming_acp_ndjson_probe_args("ping", Some("0.2.117"), true, 1, Some("/tmp"));
        assert!(probe_args_include_streaming_json(&args));
        assert!(args.iter().any(|a| a == "--always-approve"));
        assert!(args.iter().any(|a| a == "ping"));
        assert!(!args
            .iter()
            .any(|a| a == STREAMING_MESSAGES_JSON_OUTPUT_FORMAT));

        let old = streaming_acp_ndjson_probe_args("ping", Some("0.2.50"), true, 1, None);
        assert!(!probe_args_include_streaming_json(&old));
    }

    #[test]
    fn empty_prompt_uses_default() {
        let args = streaming_acp_ndjson_probe_args("  ", Some("0.2.117"), false, 9, None);
        assert!(args.iter().any(|a| a == DEFAULT_PROBE_PROMPT));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--max-turns" && w[1] == "4"));
        assert!(!args.iter().any(|a| a == "--always-approve"));
    }
}
