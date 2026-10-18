//! Windows WSL backend for Grok Build CLI.
//!
//! When `AppSettings.cli_backend == "wsl"`, the host spawns:
//!   `wsl.exe [-d Distro] --cd <linux_cwd> --exec <linux_cli> <grok args…>`
//! instead of a native Windows `grok.exe`. Users who installed the CLI only
//! inside WSL can run the desktop app without a separate ACP TCP tunnel.
//!
//! Priority: `acp_server_addr` (API mode) still wins over WSL and native spawn.
//! Non-Windows builds ignore `cli_backend=wsl` and stay on native.

#![cfg_attr(not(windows), allow(dead_code))]

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

// #546: never pass `bash -lc` / `wsl -- cmd` from the GUI; always `--exec` an absolute path.

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
        false
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
    // An absolute linux_cli would render `wsl://d//abs` — keep one separator.
    let cli = launch.linux_cli.trim_start_matches('/');
    PathBuf::from(format!("wsl://{distro}/{cli}"))
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
    if bytes.len() >= 2 && bytes.len().is_multiple_of(2) {
        // UTF-16 LE BOM or high null density → treat as UTF-16 LE
        let looks_utf16 = bytes[0] == 0xFF && bytes[1] == 0xFE
            || bytes
                .chunks(2)
                .filter(|c| c.len() == 2 && c[1] == 0)
                .count()
                > bytes.len() / 4;
        if looks_utf16 {
            let u16s: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|&c| u16::from_le_bytes(c))
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
    // Never use `bash -lc` here -- wsl.exe expands `$VAR` from the Windows env
    // into the script argv (#546 follow-up). Always direct-exec an absolute path.
    let absolute = match resolve_wsl_cli_absolute(wsl, launch) {
        Some(p) => p,
        None => return (None, None, false),
    };
    let resolved = WslLaunch {
        distro: launch.distro.clone(),
        linux_cli: absolute,
    };
    if let Some((path, version, ok)) = run_wsl_direct_probe(wsl, &resolved) {
        return (path, version, ok);
    }
    (None, None, false)
}

/// Resolve settings `linux_cli` to an absolute Linux path without a login shell.
///
/// - `/abs` -> unchanged
/// - `~/rest` / `~` -> `printenv HOME` + rest (or `grok`)
/// - bare `grok` -> `which grok` when it returns an absolute path, else
///   `$HOME/.grok/bin/grok` (via printenv) when that binary answers `--version`
fn resolve_wsl_cli_absolute(wsl: &Path, launch: &WslLaunch) -> Option<String> {
    let cli = launch.linux_cli.trim();
    if cli.is_empty() || !is_safe_wsl_cli_path(cli) {
        return None;
    }
    if cli.starts_with('/') {
        return Some(cli.to_string());
    }
    if cli.starts_with("~/") || cli == "~" {
        let home = wsl_printenv(wsl, launch.distro.as_deref(), "HOME")?;
        let rest = if cli == "~" {
            "grok"
        } else {
            cli.trim_start_matches("~/")
        };
        if rest.is_empty() || !is_safe_wsl_cli_path(rest) {
            return None;
        }
        let home = home.trim().trim_end_matches('/');
        if home.is_empty() || !home.starts_with('/') {
            return None;
        }
        return Some(format!("{home}/{rest}"));
    }
    // Bare name (typically `grok`): `which grok` first, then ~/.grok/bin/grok.
    if let Some(which) = wsl_which_grok(wsl, launch.distro.as_deref()) {
        if which.starts_with('/') && is_safe_wsl_cli_path(&which) {
            return Some(which);
        }
    }
    // Fallback: $HOME/.grok/bin/grok when it answers `--version`.
    if let Some(home) = wsl_printenv(wsl, launch.distro.as_deref(), "HOME") {
        let home = home.trim().trim_end_matches('/');
        if home.starts_with('/') && !home.is_empty() {
            let candidate = format!("{home}/.grok/bin/grok");
            if is_safe_wsl_cli_path(&candidate) {
                let trial = WslLaunch {
                    distro: launch.distro.clone(),
                    linux_cli: candidate.clone(),
                };
                if let Some((_, _, ok)) = run_wsl_direct_probe(wsl, &trial) {
                    if ok {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

/// `wsl [-d Distro] --exec printenv NAME` -- no shell, no `$` in argv.
fn wsl_printenv(wsl: &Path, distro: Option<&str>, name: &str) -> Option<String> {
    let mut cmd = StdCommand::new(wsl);
    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }
    cmd.arg("--exec")
        .arg("printenv")
        .arg(name)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let (out, success) = wait_wsl_probe(&mut child)?;
    if !success {
        return None;
    }
    let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(line.to_string())
}

/// `wsl [-d Distro] --exec which grok` -- no shell metacharacters in argv.
fn wsl_which_grok(wsl: &Path, distro: Option<&str>) -> Option<String> {
    let mut cmd = StdCommand::new(wsl);
    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }
    cmd.arg("--exec")
        .arg("which")
        .arg("grok")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let (out, success) = wait_wsl_probe(&mut child)?;
    if !success {
        return None;
    }
    let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(line.to_string())
}

/// Wait for a probe child up to `VERSION_PROBE_TIMEOUT`, then return its
/// combined stdout+stderr text plus the exit status. `None` on timeout or a
/// wait error (caller treats as "probe could not run" → fallback allowed).
fn wait_wsl_probe(child: &mut std::process::Child) -> Option<(String, bool)> {
    let deadline = Instant::now() + VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                use std::io::Read;
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut out);
                }
                // Some CLIs print their banner on stderr — merge it too.
                if let Some(mut pipe) = child.stderr.take() {
                    let mut err = String::new();
                    let _ = pipe.read_to_string(&mut err);
                    out.push_str(&err);
                }
                return Some((out, status.success()));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            Err(_) => return None,
        }
    }
}

/// `wsl [-d Distro] --exec <cli> --version` argv for an absolute `linux_cli`.
/// Pure argv builder so the probe shape is unit-testable off Windows.
fn wsl_direct_probe_args(launch: &WslLaunch) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(ref d) = launch.distro {
        args.push("-d".into());
        args.push(d.clone());
    }
    args.push("--exec".into());
    args.push(launch.linux_cli.clone());
    args.push("--version".into());
    args
}

/// Probe an absolute `linux_cli` via direct exec — no login shell. `None` when
/// the process could not be spawned / timed out / produced nothing usable, so
/// the caller treats this as "probe could not run".
fn run_wsl_direct_probe(
    wsl: &Path,
    launch: &WslLaunch,
) -> Option<(Option<String>, Option<String>, bool)> {
    if !is_safe_wsl_cli_path(&launch.linux_cli) {
        return None;
    }
    let mut cmd = StdCommand::new(wsl);
    for a in wsl_direct_probe_args(launch) {
        cmd.arg(a);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let (out, success) = wait_wsl_probe(&mut child)?;
    let version = out
        .lines()
        .map(str::trim)
        .find(|l| {
            !l.is_empty()
                && (l.to_ascii_lowercase().contains("grok") || extract_version_token(l).is_some())
        })
        .map(|s| s.to_string());
    let ok = success || version.is_some();
    Some((Some(launch.linux_cli.clone()), version, ok))
}

/// Characters allowed in a WSL CLI path segment (after optional `~/`).
///
/// Deliberately excludes shell metacharacters so settings paths cannot be used
/// for argument injection when passed to wsl.exe as a direct-exec argv.
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

/// Resolve, `mkdir -p`, and optionally `ln -s` Windows `auth.json` into Linux GROK_HOME.
///
/// Returns the Linux-native path to set as process `GROK_HOME` (never `/mnt/…`).
pub fn ensure_linux_grok_home(
    launch: &WslLaunch,
    override_path: Option<&str>,
    windows_shared_home: &Path,
) -> Result<String, String> {
    let wsl = find_wsl_exe().ok_or_else(|| {
        "wsl.exe not found -- install WSL or switch CLI backend to native".to_string()
    })?;
    let linux_home = wsl_printenv(&wsl, launch.distro.as_deref(), "HOME")
        .ok_or_else(|| "could not resolve WSL $HOME (printenv HOME failed)".to_string())?;
    let linux_grok = crate::paths::resolve_wsl_linux_grok_home(override_path, &linux_home)?;
    seed_linux_grok_home(
        &wsl,
        launch.distro.as_deref(),
        &linux_grok,
        windows_shared_home,
    )?;
    Ok(linux_grok)
}

/// `mkdir -p` Linux GROK_HOME; if `auth.json` is missing there and Windows shared
/// `~/.grok/auth.json` exists, `ln -s` **only** that file (never the directory).
fn seed_linux_grok_home(
    wsl: &Path,
    distro: Option<&str>,
    linux_grok_home: &str,
    windows_shared_home: &Path,
) -> Result<(), String> {
    if !crate::paths::is_safe_wsl_grok_home_path(linux_grok_home) {
        return Err(format!("unsafe WSL GROK_HOME: {linux_grok_home}"));
    }
    wsl_exec_status(wsl, distro, &["mkdir", "-p", linux_grok_home])
        .map_err(|e| format!("mkdir -p {linux_grok_home} inside WSL failed: {e}"))?;

    let linux_auth_present = wsl_test_exists(wsl, distro, &format!("{linux_grok_home}/auth.json"));
    let windows_auth_present = windows_shared_home.join("auth.json").is_file();
    let windows_shared_wsl = windows_path_to_wsl(windows_shared_home).ok();
    let plan = crate::paths::plan_wsl_auth_json_link(
        linux_grok_home,
        linux_auth_present,
        windows_shared_wsl.as_deref(),
        windows_auth_present,
    );
    match plan {
        crate::paths::WslAuthLinkPlan::SkipAlreadyPresent
        | crate::paths::WslAuthLinkPlan::SkipNoWindowsAuth => Ok(()),
        crate::paths::WslAuthLinkPlan::Link {
            windows_auth_wsl,
            linux_auth,
        } => {
            if !crate::paths::is_safe_wsl_grok_home_path(&windows_auth_wsl)
                || !crate::paths::is_safe_wsl_grok_home_path(&linux_auth)
            {
                return Err("unsafe auth.json link paths".into());
            }
            match wsl_exec_status(wsl, distro, &["ln", "-s", &windows_auth_wsl, &linux_auth]) {
                Ok(()) => Ok(()),
                Err(e) => {
                    tracing::warn!(
                        target: "wsl_backend",
                        error = %e,
                        "WSL auth.json symlink failed; continuing without it"
                    );
                    Ok(())
                }
            }
        }
    }
}

fn wsl_test_exists(wsl: &Path, distro: Option<&str>, path: &str) -> bool {
    wsl_exec_status(wsl, distro, &["test", "-e", path]).is_ok()
}

/// Run `wsl [-d] --exec <argv…>` and return Ok when the process exits 0.
fn wsl_exec_status(wsl: &Path, distro: Option<&str>, argv: &[&str]) -> Result<(), String> {
    if argv.is_empty() {
        return Err("empty wsl exec argv".into());
    }
    let mut cmd = StdCommand::new(wsl);
    if let Some(d) = distro {
        cmd.arg("-d").arg(d);
    }
    cmd.arg("--exec");
    for a in argv {
        cmd.arg(a);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("spawn wsl --exec: {e}"))?;
    let (_out, success) =
        wait_wsl_probe(&mut child).ok_or_else(|| "wsl --exec timed out".to_string())?;
    if success {
        Ok(())
    } else {
        Err("wsl --exec exited non-zero".into())
    }
}

/// Start a tokio `Command` that runs the Linux CLI inside WSL.
///
/// Shape:
/// `wsl.exe [-d Distro] --cd <linux_cwd> --exec <absolute_linux_cli> …`
///
/// `~` / bare `grok` are resolved to an absolute path first (`printenv HOME` /
/// direct `--version` probe) so we never pass `bash -lc` through wsl.exe.
///
/// Caller appends Grok flags (`--no-auto-update`, `agent`, `stdio`, …) and sets
/// env vars on the **Windows** process. Call [`apply_wslenv`] after envs so
/// selected variables reach Linux (`GROK_HOME` as-is, no `/p`).
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
    // Resolve ~/ or bare `grok` to an absolute path on the host -- never bash -lc.
    let absolute_cli = resolve_wsl_cli_absolute(&wsl, launch).ok_or_else(|| {
        format!(
            "could not resolve WSL CLI path to an absolute Linux path: {}",
            launch.linux_cli
        )
    })?;

    let mut cmd = tokio::process::Command::new(wsl);
    process_util::apply_no_window_tokio(&mut cmd);
    if let Some(ref d) = launch.distro {
        cmd.arg("-d").arg(d);
    }
    if !linux_cwd.is_empty() {
        cmd.arg("--cd").arg(linux_cwd);
    }
    cmd.arg("--exec");
    cmd.arg(absolute_cli);
    Ok(cmd)
}

/// Propagate Host env vars into the WSL Linux process via `WSLENV`.
///
/// `GROK_HOME` is a Linux-native path (`~/.grok` inside the distro). Do **not**
/// use `/p` translation — that would rewrite it onto `/mnt/c/…` (DrvFS) and
/// break sandbox `bwrap --ro-bind` of `managed_config.toml` / `requirements.toml`.
/// Do **not** forward Windows `PATH` (it breaks Linux tool resolution).
const WSLENV_KEYS: &str = concat!(
    "GROK_HOME:",
    "GROK_CONFIG:",
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
        WslStatus {
            available: false,
            wsl_exe: None,
            distros: Vec::new(),
            backend_active: false,
            probe: None,
            error: Some("WSL backend is only available on Windows".into()),
        }
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
        let abs = WslLaunch {
            distro: Some("Ubuntu-24.04".into()),
            linux_cli: "/root/.grok/bin/grok".into(),
        };
        assert_eq!(
            wsl_display_path(&abs).to_string_lossy(),
            "wsl://Ubuntu-24.04/root/.grok/bin/grok"
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
    fn grok_home_is_forwarded_without_path_translation() {
        assert!(
            WSLENV_KEYS.contains("GROK_HOME:"),
            "GROK_HOME must be forwarded as-is"
        );
        assert!(
            !WSLENV_KEYS.contains("GROK_HOME/p"),
            "GROK_HOME/p would map Linux ~/.grok onto /mnt/c and break sandbox binds"
        );
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
    fn direct_probe_args_shape() {
        let l = WslLaunch {
            distro: Some("Ubuntu-24.04".into()),
            linux_cli: "/root/.grok/bin/grok".into(),
        };
        assert_eq!(
            wsl_direct_probe_args(&l),
            vec![
                "-d",
                "Ubuntu-24.04",
                "--exec",
                "/root/.grok/bin/grok",
                "--version"
            ]
        );
        let d = WslLaunch {
            distro: None,
            linux_cli: "/usr/local/bin/grok".into(),
        };
        assert_eq!(
            wsl_direct_probe_args(&d),
            vec!["--exec", "/usr/local/bin/grok", "--version"]
        );
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
