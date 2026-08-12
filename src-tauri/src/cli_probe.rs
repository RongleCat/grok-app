//! Probe Grok Build CLI on PATH and common locations (B01–B03).
//!
//! Cross-platform notes:
//! - macOS/Windows GUI apps often inherit a sparse PATH (Dock / Explorer), so we
//!   always scan official install dirs + an enriched PATH, not only `which`.
//! - Windows: `.exe` / `.cmd` / `.bat`, PATHEXT, `USERPROFILE`, WinGet/Scoop.
//! - macOS: `~/.grok/bin`, Homebrew Intel/ARM, `~/.local/bin`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::process_util::{self, user_home};

/// Last ACP `agentVersion` observed from `initialize` / TCP probe.
/// Soft cache for Doctor / Runtime honesty — never gates session open.
static LAST_ACP_AGENT_VERSION: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));

/// Remember a live ACP agent version banner (best-effort).
pub fn record_acp_agent_version(raw: Option<&str>) {
    let Some(s) = raw.map(str::trim).filter(|t| !t.is_empty()) else {
        return;
    };
    if let Ok(mut g) = LAST_ACP_AGENT_VERSION.lock() {
        *g = Some(s.to_string());
    }
}

/// Last recorded ACP agent version, if any session/probe has run this process.
pub fn last_acp_agent_version() -> Option<String> {
    LAST_ACP_AGENT_VERSION
        .lock()
        .ok()
        .and_then(|g| g.clone())
}

#[cfg(test)]
pub fn clear_last_acp_agent_version_for_test() {
    if let Ok(mut g) = LAST_ACP_AGENT_VERSION.lock() {
        *g = None;
    }
}

/// Minimum grok CLI version whose flag set `acp_client` is known to work with.
///
/// 0.2.112 is the first version that accepts `doctor --json`; older builds reject
/// it with a raw clap error (`unexpected argument '--'`) and also reject agent
/// flags the host spawns with, which surfaces to the user as `AGENT_CRASHED`
/// with no path to a fix. Bump this together with any change to the flag
/// placement in `acp_client::spawn_with_home`.
pub const MIN_CLI_VERSION: (u64, u64, u64) = (0, 2, 112);

/// Product **recommended** CLI line (Grok Build 1.0). Below this still boots when
/// ≥ [`MIN_CLI_VERSION`]; UI shows a soft upgrade chip, never a hard block.
pub const RECOMMENDED_CLI_VERSION: (u64, u64, u64) = (1, 0, 0);

/// Render [`MIN_CLI_VERSION`] as `x.y.z` for UI copy.
pub fn min_cli_version_str() -> String {
    let (a, b, c) = MIN_CLI_VERSION;
    format!("{a}.{b}.{c}")
}

/// Render [`RECOMMENDED_CLI_VERSION`] as `x.y.z` for UI copy.
pub fn recommended_cli_version_str() -> String {
    let (a, b, c) = RECOMMENDED_CLI_VERSION;
    format!("{a}.{b}.{c}")
}

/// Whether a raw `--version` banner meets the product recommended line.
///
/// - `Some(true)`  — ≥ 1.0.0  
/// - `Some(false)` — parseable but older (still may pass min floor)  
/// - `None`        — unparseable (fail-open, no chip pressure)
pub fn cli_meets_recommended(raw_version: &str) -> Option<bool> {
    let token = extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= RECOMMENDED_CLI_VERSION)
}

/// Normalize two version banners to semver cores and report skew.
///
/// `true` only when both parse and cores differ. Missing / unparseable → no skew.
pub fn version_tokens_skew(a: Option<&str>, b: Option<&str>) -> bool {
    let ta = a.and_then(extract_version_token);
    let tb = b.and_then(extract_version_token);
    match (ta, tb) {
        (Some(x), Some(y)) => x != y,
        _ => false,
    }
}

/// Resolve the sibling `agent` launcher next to a `grok` path (or official
/// `~/.grok/bin/agent`). Used for install skew detection only — App ACP always
/// spawns `grok`, never this binary.
pub fn resolve_agent_sidecar_path(grok_path: Option<&str>) -> Option<PathBuf> {
    if let Some(g) = grok_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(g);
        if let Some(dir) = p.parent() {
            #[cfg(target_os = "windows")]
            {
                let candidate = dir.join("agent.exe");
                if candidate.is_file() || candidate.is_symlink() {
                    return Some(candidate);
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let candidate = dir.join("agent");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    let home_agent = {
        #[cfg(target_os = "windows")]
        {
            user_home().join(r".grok\bin\agent.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            user_home().join(".grok/bin/agent")
        }
    };
    if home_agent.exists() {
        Some(home_agent)
    } else {
        None
    }
}

/// Probe version of the `agent` sidecar if present (best-effort, same timeout).
pub fn probe_agent_sidecar(grok_path: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(path) = resolve_agent_sidecar_path(grok_path) else {
        return (None, None);
    };
    let path_s = path.display().to_string();
    if !is_executable(&path) {
        return (Some(path_s), None);
    }
    let ver = read_version(&path);
    (Some(path_s), ver)
}

/// Relink/copy official `~/.grok/bin/agent` to match `~/.grok/bin/grok` (or the
/// probed grok path when under `~/.grok/bin`). Soft-fail when paths missing.
pub fn repair_agent_sidecar_link(grok_path: Option<&str>) -> Result<String, String> {
    let home_bin = user_home().join(".grok").join("bin");
    #[cfg(target_os = "windows")]
    let grok_bin = home_bin.join("grok.exe");
    #[cfg(not(target_os = "windows"))]
    let grok_bin = home_bin.join("grok");

    let grok = grok_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(grok_bin);

    if !grok.exists() {
        return Err("grok binary not found — install or locate CLI first".into());
    }

    #[cfg(target_os = "windows")]
    {
        let agent = home_bin.join("agent.exe");
        std::fs::create_dir_all(&home_bin).map_err(|e| e.to_string())?;
        let old = PathBuf::from(format!("{}.old", agent.display()));
        let _ = std::fs::remove_file(&old);
        if std::fs::copy(&grok, &agent).is_err() {
            let _ = std::fs::rename(&agent, &old);
            std::fs::copy(&grok, &agent).map_err(|e| format!("copy agent.exe: {e}"))?;
        }
        return Ok(agent.display().to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let agent = home_bin.join("agent");
        std::fs::create_dir_all(&home_bin).map_err(|e| e.to_string())?;
        // Prefer same relative target as grok when it is a symlink.
        let link_target = if grok
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            std::fs::read_link(&grok).unwrap_or_else(|_| grok.clone())
        } else {
            // Absolute path to the real binary when grok is a plain file.
            std::fs::canonicalize(&grok).unwrap_or_else(|_| grok.clone())
        };
        let _ = std::fs::remove_file(&agent);
        std::os::unix::fs::symlink(&link_target, &agent)
            .map_err(|e| format!("symlink agent → {}: {e}", link_target.display()))?;
        Ok(agent.display().to_string())
    }
}

/// Pull the first semver-looking token out of a `--version` line.
///
/// The CLI prints shapes like `grok 0.2.112`, `grok-cli v0.2.112 (abc1234)`, or
/// bare `0.2.112`; we only care about the numeric core.
pub fn extract_version_token(raw: &str) -> Option<String> {
    raw.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == ',')
        .map(|t| t.trim().trim_start_matches(['v', 'V']))
        .find(|t| {
            // Require at least `major.minor` with a leading digit so words like
            // "grok" or a git hash are not mistaken for a version.
            let mut parts = t.split('.');
            let major = parts.next().unwrap_or("");
            let minor = parts.next().unwrap_or("");
            !major.is_empty()
                && major.chars().all(|c| c.is_ascii_digit())
                && !minor.is_empty()
                && minor.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(|t| t.to_string())
}

/// Compare a raw `--version` line against [`MIN_CLI_VERSION`].
///
/// Returns `None` when the version cannot be parsed — an unknown version is
/// **not** treated as too old, so a CLI build with an unusual banner still
/// runs instead of being blocked by a false positive.
pub fn cli_version_supported(raw_version: &str) -> Option<bool> {
    let token = extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= MIN_CLI_VERSION)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeResult {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub candidates_tried: Vec<String>,
    /// CLI auth material present at ~/.grok/auth.json (not App secrets).
    pub cli_auth_present: bool,
    /// `Some(false)` when the CLI is older than [`MIN_CLI_VERSION`].
    /// `None` when the version could not be probed or parsed (NEW-03).
    pub version_supported: Option<bool>,
    /// Minimum version this app requires, so the UI need not hardcode it.
    pub min_version: String,
    /// Product recommended CLI line (Grok Build 1.0+). Soft guidance only.
    #[serde(default)]
    pub recommended_version: String,
    /// `Some(true)` when version ≥ recommended; `Some(false)` when older;
    /// `None` when unparseable / missing.
    #[serde(default)]
    pub meets_recommended: Option<bool>,
    /// Path of sibling `agent` binary if found (not used for App ACP spawn).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_path: Option<String>,
    /// `agent --version` banner when readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
    /// True when both `grok` and `agent` versions parse and differ.
    #[serde(default)]
    pub agent_binary_skew: bool,
    /// Last live ACP `initialize` / TCP-probe `agentVersion` (process cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acp_agent_version: Option<String>,
    /// True when probe `grok --version` and live ACP agentVersion cores differ.
    /// Soft-only: never blocks session open.
    #[serde(default)]
    pub acp_agent_version_skew: bool,
}

pub fn cli_auth_json_present() -> bool {
    user_home().join(".grok").join("auth.json").is_file()
}

/// Expand `~` / `%USERPROFILE%` / `%HOME%` so manual paths work on both OSes.
pub fn expand_user_path(raw: &str) -> PathBuf {
    let s = raw.trim();
    if s.is_empty() {
        return PathBuf::new();
    }

    // Unix-style home prefix
    if s == "~" {
        return user_home();
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return user_home().join(rest);
    }

    // Windows-style env vars (common when pasting paths)
    let mut out = s.to_string();
    for (key, val) in [
        ("%USERPROFILE%", std::env::var("USERPROFILE").ok()),
        (
            "%HOME%",
            std::env::var("HOME")
                .ok()
                .or_else(|| std::env::var("USERPROFILE").ok()),
        ),
        ("%LOCALAPPDATA%", std::env::var("LOCALAPPDATA").ok()),
        ("%APPDATA%", std::env::var("APPDATA").ok()),
    ] {
        if let Some(v) = val {
            // case-insensitive replace for %VAR%
            let lower = out.to_ascii_lowercase();
            let key_l = key.to_ascii_lowercase();
            if let Some(idx) = lower.find(&key_l) {
                let mut next = String::new();
                next.push_str(&out[..idx]);
                next.push_str(&v);
                next.push_str(&out[idx + key.len()..]);
                out = next;
            }
        }
    }

    PathBuf::from(out)
}

/// Binary basenames to look for (Windows includes extension variants).
fn binary_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["grok.exe", "grok.cmd", "grok.bat", "grok"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["grok"]
    }
}

fn push_unique(out: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<String>, p: PathBuf) {
    if p.as_os_str().is_empty() {
        return;
    }
    // Normalize for dedupe (Windows is case-insensitive)
    let key = {
        #[cfg(target_os = "windows")]
        {
            p.to_string_lossy().to_ascii_lowercase()
        }
        #[cfg(not(target_os = "windows"))]
        {
            p.to_string_lossy().to_string()
        }
    };
    if seen.insert(key) {
        out.push(p);
    }
}

fn push_bin_in_dir(
    out: &mut Vec<PathBuf>,
    seen: &mut std::collections::HashSet<String>,
    dir: PathBuf,
) {
    if dir.as_os_str().is_empty() {
        return;
    }
    for name in binary_names() {
        push_unique(out, seen, dir.join(name));
    }
}

/// Resolve `which` using the process PATH and, if needed, an enriched PATH
/// (GUI apps often miss `~/.grok/bin` / Homebrew / WinGet).
fn which_grok_variants() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let names = binary_names();

    for name in names {
        if let Ok(p) = which::which(name) {
            found.push(p);
        }
    }

    // Search enriched PATH directories explicitly (does not mutate process env).
    if let Some(enriched) = process_util::enriched_path_env() {
        let sep = process_util::path_list_separator();
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for name in names {
            if let Ok(p) = which::which_in(name, Some(&enriched), &cwd) {
                found.push(p);
            }
        }
        // Also brute-force join (covers dirs that exist but which_in misses).
        for dir in enriched.split(sep).filter(|d| !d.is_empty()) {
            for name in names {
                let p = PathBuf::from(dir).join(name);
                if p.is_file() {
                    found.push(p);
                }
            }
        }
    }

    found
}

fn candidate_paths(manual: Option<&str>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1) Manual path (settings / file picker) — highest priority
    if let Some(m) = manual {
        if !m.trim().is_empty() {
            let expanded = expand_user_path(m);
            push_unique(&mut out, &mut seen, expanded.clone());
            // Windows: user may omit .exe
            #[cfg(target_os = "windows")]
            {
                if expanded.extension().is_none() {
                    push_unique(&mut out, &mut seen, expanded.with_extension("exe"));
                }
            }
        }
    }

    // 2) Official default install layout (xAI install.sh / install.ps1)
    //    Prefer these over ambient PATH so GUI apps match CLI installs.
    let home = user_home();
    #[cfg(target_os = "windows")]
    {
        push_bin_in_dir(&mut out, &mut seen, home.join(r".grok\bin"));
        // Versioned downloads left by installer (before link/copy)
        if let Ok(rd) = std::fs::read_dir(home.join(r".grok\downloads")) {
            for ent in rd.flatten() {
                let p = ent.path();
                let name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if name.starts_with("grok-")
                    && (name.ends_with(".exe") || !name.contains('.'))
                    && !name.ends_with(".part")
                    && !name.ends_with(".tmp")
                    && !name.ends_with(".old")
                {
                    push_unique(&mut out, &mut seen, p);
                }
            }
        }
        push_bin_in_dir(&mut out, &mut seen, home.join(r".local\bin"));
        // Scoop shims
        push_bin_in_dir(&mut out, &mut seen, home.join(r"scoop\shims"));
        // WinGet / Local programs
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            push_bin_in_dir(&mut out, &mut seen, local.join(r"Microsoft\WinGet\Links"));
            push_bin_in_dir(&mut out, &mut seen, local.join(r"Programs\grok"));
            push_bin_in_dir(&mut out, &mut seen, local.join(r"grok\bin"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            push_bin_in_dir(&mut out, &mut seen, PathBuf::from(pf).join("grok"));
        }
        // Chocolatey
        push_bin_in_dir(
            &mut out,
            &mut seen,
            PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        push_bin_in_dir(&mut out, &mut seen, home.join(".grok/bin"));
        // Versioned downloads (symlink targets)
        if let Ok(rd) = std::fs::read_dir(home.join(".grok/downloads")) {
            for ent in rd.flatten() {
                let p = ent.path();
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with("grok-") && !name.ends_with(".part") && !name.contains(".tmp") {
                    push_unique(&mut out, &mut seen, p);
                }
            }
        }
        push_bin_in_dir(&mut out, &mut seen, home.join(".local/bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(".cargo/bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(".bun/bin"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/opt/homebrew/bin"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/usr/local/bin"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/usr/bin"));
    }

    // 3) PATH / which (process + enriched)
    for p in which_grok_variants() {
        push_unique(&mut out, &mut seen, p);
    }

    out
}

fn is_executable(path: &Path) -> bool {
    process_util::looks_runnable(path)
}

/// Public wrapper so spawn paths can gate on version without a full probe.
/// One extra `--version` exec per session start, which is negligible next to
/// spawning the agent itself.
pub fn read_version_of(path: &Path) -> Option<String> {
    read_version(path)
}

/// Wall-clock budget for a single `grok --version` (hung binaries must not
/// freeze the setup gate / async runtime forever).
const VERSION_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

fn read_version(path: &Path) -> Option<String> {
    use std::process::Stdio;
    use std::time::Instant;

    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // GUI-spawned probes: PATH + HOME + no console window (Windows).
    process_util::apply_cli_env_std(&mut cmd);

    let mut child = cmd.spawn().ok()?;
    let deadline = Instant::now() + VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = {
                    let mut s = String::new();
                    if let Some(mut pipe) = child.stdout.take() {
                        use std::io::Read;
                        let _ = pipe.read_to_string(&mut s);
                    }
                    s
                };
                let stderr = {
                    let mut s = String::new();
                    if let Some(mut pipe) = child.stderr.take() {
                        use std::io::Read;
                        let _ = pipe.read_to_string(&mut s);
                    }
                    s
                };
                if status.success() {
                    let line = stdout.lines().next()?.trim().to_string();
                    return if line.is_empty() { None } else { Some(line) };
                }
                // Some builds print version on stderr
                let line = stderr.lines().next()?.trim().to_string();
                if !line.is_empty() && line.to_ascii_lowercase().contains("grok") {
                    return Some(line);
                }
                return None;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    tracing::warn!(
                        path = %path.display(),
                        "cli --version timed out after {}s — killing",
                        VERSION_PROBE_TIMEOUT.as_secs()
                    );
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
}

fn classify_source(path: &Path, manual_first: bool) -> String {
    if manual_first {
        return "manual".into();
    }
    let s = path.to_string_lossy();
    let lower = s.to_ascii_lowercase();
    if lower.contains(".grok") {
        "common_path".into()
    } else {
        "path".into()
    }
}

pub fn probe_cli(manual_path: Option<&str>) -> CliProbeResult {
    let candidates = candidate_paths(manual_path);
    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let cli_auth_present = cli_auth_json_present();
    let manual_set = manual_path.map(|m| !m.trim().is_empty()).unwrap_or(false);

    // Prefer a candidate that both looks runnable AND answers --version.
    let mut fallback: Option<(PathBuf, String)> = None;

    for (i, path) in candidates.iter().enumerate() {
        if !is_executable(path) {
            continue;
        }
        let source = classify_source(path, manual_set && i == 0);
        if let Some(version) = read_version(path) {
            let version_supported = cli_version_supported(&version);
            let path_s = path.display().to_string();
            return finish_probe_result(
                true,
                Some(path_s),
                Some(version),
                source,
                tried,
                cli_auth_present,
                version_supported,
            );
        }
        if fallback.is_none() {
            fallback = Some((path.clone(), source));
        }
    }

    // Runnable file that failed --version still counts as "found" so the user
    // can try connecting; UI can show missing version.
    if let Some((path, source)) = fallback {
        return finish_probe_result(
            true,
            Some(path.display().to_string()),
            None,
            source,
            tried,
            cli_auth_present,
            None,
        );
    }

    finish_probe_result(
        false,
        None,
        None,
        "not_found".into(),
        tried,
        cli_auth_present,
        None,
    )
}

fn finish_probe_result(
    found: bool,
    path: Option<String>,
    version: Option<String>,
    source: String,
    candidates_tried: Vec<String>,
    cli_auth_present: bool,
    version_supported: Option<bool>,
) -> CliProbeResult {
    let meets_recommended = version
        .as_deref()
        .and_then(cli_meets_recommended);
    let (agent_path, agent_version) = if found {
        probe_agent_sidecar(path.as_deref())
    } else {
        (None, None)
    };
    let agent_binary_skew =
        version_tokens_skew(version.as_deref(), agent_version.as_deref());
    let acp_agent_version = last_acp_agent_version();
    let acp_agent_version_skew =
        version_tokens_skew(version.as_deref(), acp_agent_version.as_deref());
    CliProbeResult {
        found,
        path,
        version,
        source,
        candidates_tried,
        cli_auth_present,
        version_supported,
        min_version: min_cli_version_str(),
        recommended_version: recommended_cli_version_str(),
        meets_recommended,
        agent_path,
        agent_version,
        agent_binary_skew,
        acp_agent_version,
        acp_agent_version_skew,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_common_banners() {
        assert_eq!(
            extract_version_token("grok 0.2.112").as_deref(),
            Some("0.2.112")
        );
        assert_eq!(
            extract_version_token("grok-cli v0.2.112").as_deref(),
            Some("0.2.112")
        );
        assert_eq!(
            extract_version_token("grok 0.2.112 (a1b2c3d)").as_deref(),
            Some("0.2.112")
        );
        assert_eq!(extract_version_token("0.2.101").as_deref(), Some("0.2.101"));
        assert_eq!(extract_version_token("1.0").as_deref(), Some("1.0"));
    }

    #[test]
    fn version_extraction_ignores_non_version_tokens() {
        // A git hash or plain words must not be mistaken for a version.
        assert_eq!(extract_version_token("grok"), None);
        assert_eq!(extract_version_token("build a1b2c3d"), None);
        assert_eq!(extract_version_token(""), None);
    }

    #[test]
    fn version_gate_flags_old_cli() {
        // The exact pairing reported in the field: 0.2.101 fails, 0.2.112 passes.
        assert_eq!(cli_version_supported("grok 0.2.101"), Some(false));
        assert_eq!(cli_version_supported("grok 0.2.112"), Some(true));
        assert_eq!(cli_version_supported("grok 0.2.200"), Some(true));
        assert_eq!(cli_version_supported("grok 0.3.0"), Some(true));
        assert_eq!(cli_version_supported("grok 1.0.0"), Some(true));
        assert_eq!(cli_version_supported("grok 0.1.999"), Some(false));
    }

    #[test]
    fn unparseable_version_is_not_treated_as_too_old() {
        // Fail open: an unknown banner must not block a working CLI.
        assert_eq!(cli_version_supported("grok"), None);
        assert_eq!(cli_version_supported(""), None);
    }

    #[test]
    fn min_version_string_matches_constant() {
        assert_eq!(min_cli_version_str(), "0.2.112");
    }

    #[test]
    fn recommended_line_is_1_0_0() {
        assert_eq!(recommended_cli_version_str(), "1.0.0");
        assert_eq!(cli_meets_recommended("grok 1.0.0"), Some(true));
        assert_eq!(cli_meets_recommended("grok 1.0.0 (abc)"), Some(true));
        assert_eq!(cli_meets_recommended("grok 0.2.120"), Some(false));
        assert_eq!(cli_meets_recommended("grok 0.2.112"), Some(false));
        assert_eq!(cli_meets_recommended("nope"), None);
    }

    #[test]
    fn version_tokens_skew_detects_mismatch() {
        assert!(!version_tokens_skew(None, Some("1.0.0")));
        assert!(!version_tokens_skew(Some("grok 1.0.0"), Some("1.0.0")));
        assert!(version_tokens_skew(
            Some("grok 1.0.0"),
            Some("grok 0.2.118")
        ));
        assert!(!version_tokens_skew(Some("grok"), Some("1.0.0")));
    }

    #[test]
    fn acp_agent_version_cache_drives_probe_skew() {
        clear_last_acp_agent_version_for_test();
        assert!(last_acp_agent_version().is_none());
        record_acp_agent_version(None);
        assert!(last_acp_agent_version().is_none());
        record_acp_agent_version(Some("  "));
        assert!(last_acp_agent_version().is_none());
        record_acp_agent_version(Some("grok 0.2.118 (deadbeef)"));
        assert_eq!(
            last_acp_agent_version().as_deref(),
            Some("grok 0.2.118 (deadbeef)")
        );
        assert!(version_tokens_skew(
            Some("grok 1.0.0"),
            last_acp_agent_version().as_deref()
        ));
        assert!(!version_tokens_skew(
            Some("grok 0.2.118"),
            last_acp_agent_version().as_deref()
        ));
        clear_last_acp_agent_version_for_test();
    }

    #[test]
    fn probe_returns_structure() {
        let r = probe_cli(None);
        assert!(!r.candidates_tried.is_empty() || r.found);
        if r.found {
            assert!(r.path.is_some());
            assert!(r
                .version
                .as_ref()
                .map(|v| v.contains("grok") || !v.is_empty())
                .unwrap_or(true));
        }
    }

    #[test]
    fn probe_finds_local_grok_when_installed() {
        let r = probe_cli(None);
        // Soft if CI lacks grok.
        let home = user_home();
        let likely_installed = which::which("grok").is_ok()
            || home.join(".grok/bin/grok").exists()
            || home.join(r".grok\bin\grok").exists()
            || home.join(r".grok\bin\grok.exe").exists()
            || which::which("grok.exe").is_ok();
        if likely_installed {
            assert!(
                r.found,
                "expected local grok, tried {:?}",
                r.candidates_tried
            );
            assert!(r.path.is_some());
        }
    }

    #[test]
    fn auth_path_uses_user_home() {
        // Just ensure we don't panic; presence is machine-dependent.
        let _ = cli_auth_json_present();
    }

    #[test]
    fn expand_user_path_tilde() {
        let p = expand_user_path("~/foo/bar");
        assert!(p.starts_with(user_home()));
        assert!(
            p.ends_with(Path::new("foo").join("bar"))
                || p.to_string_lossy().ends_with("foo/bar")
                || p.to_string_lossy().ends_with(r"foo\bar")
        );
    }

    #[test]
    fn expand_user_path_empty() {
        assert!(expand_user_path("  ").as_os_str().is_empty());
    }

    #[test]
    fn candidates_include_platform_defaults() {
        let c = candidate_paths(None);
        let joined = c
            .iter()
            .map(|p| p.to_string_lossy().to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join("\n");
        // Both platforms should consider the official bin dir.
        assert!(
            joined.contains(".grok") && (joined.contains("bin") || joined.contains("grok")),
            "candidates missing official layout: {c:?}"
        );
    }

    #[test]
    fn manual_path_is_first_candidate() {
        let fake = if cfg!(target_os = "windows") {
            r"C:\custom\grok.exe"
        } else {
            "/custom/grok"
        };
        let c = candidate_paths(Some(fake));
        assert!(!c.is_empty());
        assert_eq!(c[0], PathBuf::from(fake));
    }
}
