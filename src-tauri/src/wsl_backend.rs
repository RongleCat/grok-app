//! Windows WSL backend for Grok Build CLI.
//!
//! When `AppSettings.cli_backend == "wsl"`, the host spawns:
//!   `wsl.exe [-d Distro] --cd <linux_cwd> -- env KEY=VAL… <linux_cli> <grok args…>`
//! instead of a native Windows `grok.exe`. Users who installed the CLI only
//! inside WSL can run the desktop app without a separate ACP TCP tunnel.
//!
//! Priority: `acp_server_addr` (API mode) still wins over WSL and native spawn.
//! Non-Windows builds ignore `cli_backend=wsl` and stay on native.

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::cli_probe::{
    cli_meets_recommended, cli_version_supported, extract_version_token, min_cli_version_str,
    recommended_cli_version_str, CliProbeResult,
};
use crate::process_util;
use crate::store::AppSettings;

/// Settings value for native Windows/macOS/Linux CLI spawn.
pub const CLI_BACKEND_NATIVE: &str = "native";
/// Settings value for spawning through `wsl.exe` (Windows only).
pub const CLI_BACKEND_WSL: &str = "wsl";

const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// Normalized WSL launch config (only `Some` when backend is active on Windows).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLaunch {
    /// Empty = default WSL distro.
    pub distro: Option<String>,
    /// Absolute or PATH-relative CLI path **inside** WSL (e.g. `grok`, `~/.grok/bin/grok`).
    pub linux_cli: String,
}

/// Whether settings request the WSL spawn path on this host.
pub fn wsl_backend_active(settings: &AppSettings) -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = settings;
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        normalize_cli_backend(&settings.cli_backend) == CLI_BACKEND_WSL
    }
}

/// Normalize stored backend id (`native` | `wsl`). Unknown → `native`.
pub fn normalize_cli_backend(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        CLI_BACKEND_WSL => CLI_BACKEND_WSL.into(),
        _ => CLI_BACKEND_NATIVE.into(),
    }
}

/// Build launch config when WSL backend is active; `None` otherwise.
pub fn resolve_wsl_launch(settings: &AppSettings) -> Option<WslLaunch> {
    if !wsl_backend_active(settings) {
        return None;
    }
    let distro = settings
        .wsl_distro
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let linux_cli = settings
        .wsl_cli_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("grok")
        .to_string();
    Some(WslLaunch { distro, linux_cli })
}

/// Sentinel path stored on the ACP client when the process is WSL-backed.
pub fn wsl_display_path(launch: &WslLaunch) -> PathBuf {
    let distro = launch.distro.as_deref().unwrap_or("default");
    PathBuf::from(format!("wsl://{distro}/{}", launch.linux_cli))
}

/// Convert a Windows path to a WSL mount path (`C:\Users\a` → `/mnt/c/Users/a`).
///
/// Pure string mapping (no `wslpath` spawn). Handles:
/// - `C:\…` / `C:/…`
/// - `\\?\C:\…` long paths
/// - `\\wsl$\Distro\…` / `\\wsl.localhost\Distro\…` → Linux path without distro prefix
pub fn windows_path_to_wsl(path: &Path) -> Result<String, String> {
    let raw = path.to_string_lossy();
    if raw.trim().is_empty() {
        return Err("empty path".into());
    }
    let mut s = raw.replace('\\', "/");
    // Strip extended-length prefix
    if let Some(rest) = s.strip_prefix("//?/") {
        s = rest.to_string();
    }
    // \\wsl$\Ubuntu\home\x → /home/x
    for prefix in ["//wsl$/", "//wsl.localhost/"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            // rest = "Ubuntu/home/x" or "Ubuntu"
            if let Some(idx) = rest.find('/') {
                let linux = &rest[idx..];
                return Ok(if linux.is_empty() {
                    "/".into()
                } else {
                    linux.to_string()
                });
            }
            return Ok("/".into());
        }
    }
    // Drive letter: C:/Users/...
    let bytes = s.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        if drive.is_ascii_alphabetic() {
            let rest = &s[2..];
            let rest = if rest.is_empty() {
                ""
            } else if rest.starts_with('/') {
                rest
            } else {
                return Err(format!("invalid Windows path: {raw}"));
            };
            return Ok(format!("/mnt/{drive}{rest}"));
        }
    }
    // Already looks like a Linux path (forward-slash absolute)
    if s.starts_with('/') {
        return Ok(s);
    }
    Err(format!("cannot map path to WSL: {raw}"))
}

/// Locate `wsl.exe` (PATH, then System32).
pub fn find_wsl_exe() -> Option<PathBuf> {
    if let Ok(p) = which::which("wsl.exe") {
        return Some(p);
    }
    if let Ok(p) = which::which("wsl") {
        return Some(p);
    }
    // Standard location even when PATH is sparse (GUI apps).
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let candidate = system_root.join("System32").join("wsl.exe");
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// List installed WSL distro names (`wsl.exe -l -q`). Best-effort; empty on failure.
pub fn list_wsl_distros() -> Vec<String> {
    let Some(wsl) = find_wsl_exe() else {
        return Vec::new();
    };
    let mut cmd = StdCommand::new(wsl);
    cmd.args(["-l", "-q"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    process_util::apply_no_window_std(&mut cmd);
    let Ok(out) = cmd.output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    // `wsl -l` often emits UTF-16 LE on Windows.
    let text = decode_wsl_list_output(&out.stdout);
    text.lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        // Drop the default marker suffix if present
        .map(|s| s.trim_end_matches('*').trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn decode_wsl_list_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.len() % 2 == 0 {
        // UTF-16 LE BOM or high null density → treat as UTF-16 LE
        let looks_utf16 = bytes[0] == 0xFF && bytes[1] == 0xFE
            || bytes
                .chunks(2)
                .filter(|c| c.len() == 2 && c[1] == 0)
                .count()
                > bytes.len() / 4;
        if looks_utf16 {
            let u16s: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let start = if u16s.first() == Some(&0xFEFF) { 1 } else { 0 };
            return String::from_utf16_lossy(&u16s[start..]);
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Settings-aware CLI probe: WSL backend probes inside the distro, otherwise native.
///
/// Central dispatcher so every spawn/probe gate (connect cold spawn, prewarm,
/// Settings probe) agrees on where `grok` lives. Without this, a WSL-only install
/// fails connect with `CliNotFound` because the native probe never looks inside WSL.
pub fn probe_cli_for_settings(settings: &AppSettings, manual_path: Option<&str>) -> CliProbeResult {
    if wsl_backend_active(settings) {
        probe_wsl_cli(settings)
    } else {
        crate::cli_probe::probe_cli(manual_path)
    }
}

/// Probe Grok Build CLI **inside** WSL for settings / doctor.
pub fn probe_wsl_cli(settings: &AppSettings) -> CliProbeResult {
    let launch = match resolve_wsl_launch(settings) {
        Some(l) => l,
        None => {
            return empty_not_found_probe("wsl_inactive");
        }
    };
    let Some(wsl) = find_wsl_exe() else {
        return empty_not_found_probe("wsl_exe_missing");
    };

    let (path_out, version_out, ok) = run_wsl_cli_probe(&wsl, &launch);
    let display = wsl_display_path(&launch).display().to_string();
    let path = path_out
        .filter(|p| !p.is_empty())
        .or_else(|| Some(display.clone()));
    let version = version_out.filter(|v| !v.trim().is_empty());
    let version_supported = version.as_deref().and_then(cli_version_supported);
    let meets_recommended = version.as_deref().and_then(cli_meets_recommended);

    // Auth lives inside WSL home — we cannot cheaply read it; leave false
    // unless version probe succeeded (user likely has a working install).
    let cli_auth_present = false;

    CliProbeResult {
        found: ok || version.is_some(),
        path,
        version: version.clone(),
        source: "wsl".into(),
        candidates_tried: vec![
            display,
            launch.linux_cli.clone(),
            launch
                .distro
                .clone()
                .unwrap_or_else(|| "(default distro)".into()),
        ],
        cli_auth_present,
        version_supported,
        min_version: min_cli_version_str(),
        recommended_version: recommended_cli_version_str(),
        meets_recommended,
        agent_path: None,
        agent_version: None,
        agent_binary_skew: false,
        acp_agent_version: crate::cli_probe::last_acp_agent_version(),
        acp_agent_version_skew: crate::cli_probe::version_tokens_skew(
            version.as_deref(),
            crate::cli_probe::last_acp_agent_version().as_deref(),
        ),
    }
}

fn empty_not_found_probe(source: &str) -> CliProbeResult {
    CliProbeResult {
        found: false,
        path: None,
        version: None,
        source: source.into(),
        candidates_tried: Vec::new(),
        cli_auth_present: false,
        version_supported: None,
        min_version: min_cli_version_str(),
        recommended_version: recommended_cli_version_str(),
        meets_recommended: None,
        agent_path: None,
        agent_version: None,
        agent_binary_skew: false,
        acp_agent_version: crate::cli_probe::last_acp_agent_version(),
        acp_agent_version_skew: false,
    }
}

/// Read `--version` of the WSL CLI (used at spawn time for soft-fail flags).
pub fn read_wsl_version(launch: &WslLaunch) -> Option<String> {
    let wsl = find_wsl_exe()?;
    let (_, version, _) = run_wsl_cli_probe(&wsl, launch);
    version
}

fn run_wsl_cli_probe(wsl: &Path, launch: &WslLaunch) -> (Option<String>, Option<String>, bool) {
    // Expand optional ~ and prefer explicit path; otherwise PATH + ~/.grok/bin.
    // Print: first line = resolved path, rest = --version banner.
    let script = r#"
set -e
export PATH="$HOME/.grok/bin:$HOME/.local/bin:$PATH"
CLI_RAW="$1"
if [ -n "$CLI_RAW" ] && [ "$CLI_RAW" != "grok" ]; then
  case "$CLI_RAW" in
    "~/"*) CLI="${HOME}/${CLI_RAW#~/}" ;;
    *) CLI="$CLI_RAW" ;;
  esac
else
  CLI="$(command -v grok 2>/dev/null || true)"
  if [ -z "$CLI" ] && [ -x "$HOME/.grok/bin/grok" ]; then
    CLI="$HOME/.grok/bin/grok"
  fi
fi
if [ -z "$CLI" ]; then
  echo ""
  echo "grok not found in WSL PATH or ~/.grok/bin" >&2
  exit 127
fi
echo "$CLI"
"$CLI" --version 2>&1 || true
"#;

    let mut cmd = StdCommand::new(wsl);
    if let Some(ref d) = launch.distro {
        cmd.arg("-d").arg(d);
    }
    cmd.arg("--")
        .arg("bash")
        .arg("-lc")
        .arg(script)
        .arg("grok-wsl-probe")
        .arg(&launch.linux_cli)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return (None, None, false),
    };
    let deadline = Instant::now() + VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    use std::io::Read;
                    let _ = pipe.read_to_string(&mut stdout);
                }
                let mut lines = stdout.lines().map(str::trim).filter(|l| !l.is_empty());
                let path = lines.next().map(|s| s.to_string());
                let version_line = lines
                    .find(|l| {
                        l.to_ascii_lowercase().contains("grok")
                            || extract_version_token(l).is_some()
                    })
                    .map(|s| s.to_string())
                    .or_else(|| {
                        // Single-line --version sometimes only on first line after path
                        path.as_ref().and_then(|_| None)
                    });
                // If path line itself looks like a version banner, treat carefully
                let (resolved_path, version) = match (&path, &version_line) {
                    (Some(p), Some(v)) => (Some(p.clone()), Some(v.clone())),
                    (Some(p), None) => {
                        if extract_version_token(p).is_some()
                            || p.to_ascii_lowercase().contains("grok ")
                        {
                            (None, Some(p.clone()))
                        } else {
                            (Some(p.clone()), None)
                        }
                    }
                    (None, Some(v)) => (None, Some(v.clone())),
                    _ => (None, None),
                };
                let ok = status.success() || version.is_some();
                return (resolved_path, version, ok);
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (None, None, false);
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            Err(_) => return (None, None, false),
        }
    }
}

/// Characters allowed in a WSL CLI path segment (after optional `~/`).
///
/// Deliberately excludes shell metacharacters (`;|&$`'"\\` etc.) so settings
/// never enter a `bash -lc` script body as untrusted interpolation.
fn is_safe_wsl_cli_path(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p.len() > 512 {
        return false;
    }
    // Disallow absolute path traversal via ".." components (still allow `.grok`).
    if p.split('/').any(|seg| seg == "..") {
        return false;
    }
    p.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '~' | '+'))
}

/// Start a tokio `Command` that runs the Linux CLI inside WSL.
///
/// Shape:
/// `wsl.exe [-d Distro] --cd <linux_cwd> -- <linux_cli> …`
/// or, when `linux_cli` uses `~`, expand via argv-safe `bash -lc` (path is `$1`,
/// never interpolated into the script string).
///
/// Caller appends Grok flags (`--no-auto-update`, `agent`, `stdio`, …) and sets
/// env vars on the **Windows** process. Call [`apply_wslenv`] after envs so
/// selected variables (with `/p` path translation for `GROK_HOME`) reach Linux.
pub fn start_wsl_tokio_command(
    launch: &WslLaunch,
    linux_cwd: &str,
) -> Result<tokio::process::Command, String> {
    let wsl = find_wsl_exe().ok_or_else(|| {
        "wsl.exe not found — install WSL or switch CLI backend to native".to_string()
    })?;
    if !is_safe_wsl_cli_path(&launch.linux_cli) {
        return Err(format!(
            "invalid WSL CLI path (unsafe characters): {}",
            launch.linux_cli
        ));
    }
    if let Some(ref d) = launch.distro {
        // Distro names from `wsl -l` are short tokens; reject metacharacters.
        if !d
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        {
            return Err(format!("invalid WSL distro name: {d}"));
        }
    }
    let mut cmd = tokio::process::Command::new(wsl);
    process_util::apply_no_window_tokio(&mut cmd);
    if let Some(ref d) = launch.distro {
        cmd.arg("-d").arg(d);
    }
    if !linux_cwd.is_empty() {
        cmd.arg("--cd").arg(linux_cwd);
    }
    cmd.arg("--");
    let cli = launch.linux_cli.as_str();
    if cli.starts_with("~/") || cli == "~" {
        // Expand tilde via argv — path is never concatenated into the script body.
        // $1 = relative path under $HOME (or "grok" for bare `~`); remaining "$@" = grok args.
        let rest = if cli == "~" {
            "grok"
        } else {
            cli.trim_start_matches("~/")
        };
        if rest.is_empty() || !is_safe_wsl_cli_path(rest) {
            return Err(format!("invalid WSL CLI path under ~: {cli}"));
        }
        cmd.arg("bash");
        cmd.arg("-lc");
        cmd.arg(r#"cli="$HOME/$1"; shift; exec "$cli" "$@""#);
        cmd.arg("grok-wsl");
        cmd.arg(rest);
    } else {
        cmd.arg(cli);
    }
    Ok(cmd)
}

/// Propagate Host env vars into the WSL Linux process via `WSLENV`.
///
/// `GROK_HOME/p` asks WSL to translate the Windows path to `/mnt/…`.
/// Do **not** forward Windows `PATH` (it breaks Linux tool resolution).
const WSLENV_KEYS: &str = concat!(
    "GROK_HOME/p:",
    "GROK_CLAUDE_MCPS_ENABLED:",
    "GROK_CURSOR_MCPS_ENABLED:",
    "GROK_SANDBOX:",
    "GROK_MEMORY:",
    "GROK_SUBAGENT_WORKTREE_SNAPSHOT:",
    "GROK_MODELS_BASE_URL:",
    "GROK_MODELS_LIST_URL:",
    "GROK_CLI_CHAT_PROXY_BASE_URL:",
    "XAI_API_KEY:",
    "HTTP_PROXY:",
    "HTTPS_PROXY:",
    "http_proxy:",
    "https_proxy:",
    "ALL_PROXY:",
    "all_proxy:",
    "NO_PROXY:",
    "no_proxy:",
    "SSL_CERT_FILE/p:",
    "REQUESTS_CA_BUNDLE/p:",
    "CURL_CA_BUNDLE/p"
);

pub fn apply_wslenv(cmd: &mut tokio::process::Command) {
    // Keys we commonly set on the agent process. Unknown keys are ignored by WSL.
    cmd.env("WSLENV", WSLENV_KEYS);
}

/// Tauri-facing probe result for the Settings WSL card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    pub available: bool,
    pub wsl_exe: Option<String>,
    pub distros: Vec<String>,
    pub backend_active: bool,
    pub probe: Option<CliProbeResult>,
    pub error: Option<String>,
}

/// Collect WSL availability + optional CLI probe for Settings.
pub fn wsl_status(settings: &AppSettings) -> WslStatus {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = settings;
        return WslStatus {
            available: false,
            wsl_exe: None,
            distros: Vec::new(),
            backend_active: false,
            probe: None,
            error: Some("WSL backend is only available on Windows".into()),
        };
    }
    #[cfg(target_os = "windows")]
    {
        let wsl_exe = find_wsl_exe().map(|p| p.display().to_string());
        let available = wsl_exe.is_some();
        let distros = if available {
            list_wsl_distros()
        } else {
            Vec::new()
        };
        let backend_active = wsl_backend_active(settings);
        let probe = if backend_active && available {
            Some(probe_wsl_cli(settings))
        } else {
            None
        };
        let error = if !available {
            Some("wsl.exe not found".into())
        } else {
            None
        };
        WslStatus {
            available,
            wsl_exe,
            distros,
            backend_active,
            probe,
            error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn normalize_backend_ids() {
        assert_eq!(normalize_cli_backend("wsl"), "wsl");
        assert_eq!(normalize_cli_backend("WSL"), "wsl");
        assert_eq!(normalize_cli_backend("native"), "native");
        assert_eq!(normalize_cli_backend(""), "native");
        assert_eq!(normalize_cli_backend("docker"), "native");
    }

    #[test]
    fn windows_drive_to_mnt() {
        let p = PathBuf::from(r"C:\Users\alice\proj");
        assert_eq!(windows_path_to_wsl(&p).unwrap(), "/mnt/c/Users/alice/proj");
        let p2 = PathBuf::from(r"D:/code");
        assert_eq!(windows_path_to_wsl(&p2).unwrap(), "/mnt/d/code");
    }

    #[test]
    fn extended_prefix_stripped() {
        let p = PathBuf::from(r"\\?\C:\Work\app");
        assert_eq!(windows_path_to_wsl(&p).unwrap(), "/mnt/c/Work/app");
    }

    #[test]
    fn wsl_share_path() {
        let p = PathBuf::from(r"\\wsl$\Ubuntu\home\alice\.grok");
        assert_eq!(windows_path_to_wsl(&p).unwrap(), "/home/alice/.grok");
    }

    #[test]
    fn linux_path_passthrough() {
        assert_eq!(
            windows_path_to_wsl(Path::new("/home/x")).unwrap(),
            "/home/x"
        );
    }

    #[test]
    fn display_path_format() {
        let l = WslLaunch {
            distro: Some("Ubuntu".into()),
            linux_cli: "~/.grok/bin/grok".into(),
        };
        assert_eq!(
            wsl_display_path(&l).to_string_lossy(),
            "wsl://Ubuntu/~/.grok/bin/grok"
        );
    }

    #[test]
    fn forwards_native_grok_proxy_env_without_path_translation() {
        for key in [
            "GROK_MODELS_BASE_URL:",
            "GROK_MODELS_LIST_URL:",
            "GROK_CLI_CHAT_PROXY_BASE_URL:",
            "XAI_API_KEY:",
        ] {
            assert!(WSLENV_KEYS.contains(key), "missing {key}");
        }
        assert!(!WSLENV_KEYS.contains("XAI_API_KEY/p"));
    }

    #[test]
    fn decode_utf16_wsl_list() {
        // "Ubuntu\n" in UTF-16 LE
        let mut bytes = Vec::new();
        for c in "Ubuntu\n".encode_utf16() {
            bytes.extend_from_slice(&c.to_le_bytes());
        }
        let s = decode_wsl_list_output(&bytes);
        assert!(s.contains("Ubuntu"));
    }

    #[test]
    fn safe_wsl_cli_path_rejects_injection() {
        assert!(is_safe_wsl_cli_path("grok"));
        assert!(is_safe_wsl_cli_path("~/.grok/bin/grok"));
        assert!(is_safe_wsl_cli_path("/usr/local/bin/grok"));
        assert!(!is_safe_wsl_cli_path("~/bin/grok; echo pwned"));
        assert!(!is_safe_wsl_cli_path("grok$(id)"));
        assert!(!is_safe_wsl_cli_path("a|b"));
        assert!(!is_safe_wsl_cli_path("../etc/passwd"));
        assert!(!is_safe_wsl_cli_path(""));
    }
}
