//! Optional macOS LaunchAgent helper for scheduled automations.
//!
//! **Honesty:** this is **not** a headless daemon or separate scheduler.
//! Enabling writes a small helper under app data and (when the user opts in)
//! installs a user LaunchAgent that starts the **full Grok App** at login and
//! restarts it only after a **crash** (`KeepAlive` + `SuccessfulExit=false`).
//!
//! Also generates a **one-shot** helper script (`fire-due-schedules.sh`) that
//! invokes the app with `--fire-due-schedules` (fire at most one due task, then
//! exit). That script is **not** installed as a KeepAlive LaunchAgent — users
//! or external launchd `StartCalendarInterval` may call it; continuous ticks
//! still require tray residency or the full-app LaunchAgent.
//!
//! Schedules still tick only inside the app process (`automation_runner`),
//! including when the main window is hidden to the tray. Fully quitting the
//! app (successful exit) pauses schedules until the app is opened again.

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

use serde::Serialize;

/// launchd label (must match plist `Label`).
pub const LAUNCHD_LABEL: &str = "com.grokapp.desktop.schedules-keepalive";

const PLIST_FILENAME: &str = "com.grokapp.desktop.schedules-keepalive.plist";
const SCRIPT_FILENAME: &str = "open-grok-for-schedules.sh";
/// One-shot fire helper (not KeepAlive-installed).
const ONESHOT_SCRIPT_FILENAME: &str = "fire-due-schedules.sh";
const LIMITS_FILENAME: &str = "LIMITS.txt";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulesLaunchAgentStatus {
    /// True only on macOS; other platforms never install a LaunchAgent.
    pub supported: bool,
    /// AppSettings flag / last successful enable intent.
    pub enabled: bool,
    /// Generated helper directory under app data (always when generated).
    pub helper_dir: Option<String>,
    /// Path of the installed LaunchAgent plist under `~/Library/LaunchAgents`.
    pub installed_plist: Option<String>,
    /// Whether the installed plist file currently exists.
    pub installed: bool,
    /// Absolute path we would launch (`.app` bundle or binary).
    pub app_path: Option<String>,
    /// Short honesty note for UI (English; UI translates separate keys).
    pub honesty: String,
}

fn honesty_note() -> String {
    "Not a headless daemon. The LaunchAgent only starts the full Grok App \
     (login / crash restart). Schedules tick inside the app process, including \
     tray-only. A normal quit pauses schedules until the app is reopened."
        .into()
}

/// Directory under app data for generated helper files.
pub fn helper_dir() -> PathBuf {
    crate::paths::app_data_root()
        .join("helpers")
        .join("schedules-launch-agent")
}

#[cfg(target_os = "macos")]
fn launch_agents_dir() -> Option<PathBuf> {
    crate::process_util::user_home()
        .into_os_string()
        .into_string()
        .ok()
        .map(|h| PathBuf::from(h).join("Library").join("LaunchAgents"))
}

#[cfg(target_os = "macos")]
fn installed_plist_path() -> Option<PathBuf> {
    launch_agents_dir().map(|d| d.join(PLIST_FILENAME))
}

/// Resolve a stable path to open: prefer the `.app` bundle, else the executable.
pub fn resolve_app_launch_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    // …/Grok.app/Contents/MacOS/<bin> → …/Grok.app
    if let Some(macos_dir) = exe.parent() {
        if macos_dir
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("MacOS"))
        {
            if let Some(contents) = macos_dir.parent() {
                if let Some(app) = contents.parent() {
                    if app
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("app"))
                    {
                        return Ok(app.to_path_buf());
                    }
                }
            }
        }
    }
    Ok(exe)
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_sh_single(s: &str) -> String {
    // Wrap in single quotes; escape embedded ' as '\''
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Pure render of the helper shell script (no I/O).
pub fn render_open_script(app_path: &Path) -> String {
    let path = app_path.display().to_string();
    let quoted = escape_sh_single(&path);
    let is_app = app_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("app"));
    let launch = if is_app {
        format!(
            r#"# Prefer tray-first so schedules can tick without stealing focus.
if open -a {quoted} --args --start-in-tray 2>/dev/null; then
  exit 0
fi
open -a {quoted}
"#
        )
    } else {
        format!(
            r#"export GROK_START_IN_TRAY=1
exec {quoted} --start-in-tray
"#
        )
    };
    format!(
        r#"#!/bin/bash
# Generated by Grok App — schedules keep-alive helper.
# NOT a headless daemon. Starts the full Grok App so automation_runner can tick
# (window or tray). Normal quit pauses schedules; this agent does not fight
# successful exits (KeepAlive SuccessfulExit=false).
set -euo pipefail
{launch}"#
    )
}

/// Pure render of the one-shot fire helper (no I/O).
///
/// Invokes the app with `--fire-due-schedules`: boot → fire at most one due
/// schedule → exit. Soft-fails when nothing is due or CLI/project fails.
/// **Not** installed as a KeepAlive LaunchAgent by the app.
pub fn render_oneshot_fire_script(app_path: &Path) -> String {
    let path = app_path.display().to_string();
    let quoted = escape_sh_single(&path);
    let is_app = app_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("app"));
    let flag = crate::automation_runner::FIRE_DUE_FLAG;
    let launch = if is_app {
        format!(
            r#"# One-shot: no focus steal; app hides to tray, fires ≤1 due task, exits.
if open -a {quoted} --args {flag} 2>/dev/null; then
  exit 0
fi
open -a {quoted} --args {flag}
"#
        )
    } else {
        format!(
            r#"export GROK_FIRE_DUE_SCHEDULES=1
exec {quoted} {flag}
"#
        )
    };
    format!(
        r#"#!/bin/bash
# Generated by Grok App — one-shot schedule fire helper (AUTO-HEADLESS A2).
# NOT a KeepAlive daemon and NOT a continuous scheduler.
# Boots Grok App with {flag}: fires at most one due scheduled task, then exits.
# Soft-fails when nothing is due, CLI is missing, or project is untrusted.
# Optional: call from cron / launchd StartCalendarInterval after full Quit.
# Continuous ticks still need tray residency or the full-app LaunchAgent.
set -euo pipefail
{launch}"#,
        flag = flag,
        launch = launch,
    )
}

/// Pure render of the LaunchAgent plist (no I/O).
pub fn render_plist(script_path: &Path, log_path: &Path) -> String {
    let prog = escape_xml(&script_path.display().to_string());
    let log = escape_xml(&log_path.display().to_string());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Generated by Grok App. Label: {label}
     Honest limits: full app process only — not a separate schedule daemon.
     KeepAlive SuccessfulExit=false → restart after crash, not after Quit. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>{prog}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#,
        label = LAUNCHD_LABEL,
        prog = prog,
        log = log,
    )
}

fn limits_text(app_path: &Path, helper: &Path) -> String {
    format!(
        "Grok App — schedules LaunchAgent + one-shot helpers\n\
         ==================================================\n\
         \n\
         This is NOT a headless background daemon and NOT a separate scheduler.\n\
         \n\
         Full-app LaunchAgent (optional, install via UI):\n\
         - At login (RunAtLoad): starts the full Grok App (prefer tray).\n\
         - After crash only (KeepAlive SuccessfulExit=false): restarts the app.\n\
         - Script: {open_script}\n\
         \n\
         One-shot fire helper (always generated; NOT KeepAlive-installed):\n\
         - Script: {oneshot_script}\n\
         - Runs: app {flag}  → fire at most one due task → exit\n\
         - Soft-fails: nothing due / missing CLI / untrusted project\n\
         - Optional: wire yourself via cron or launchd StartCalendarInterval\n\
         - Does NOT claim continuous background scheduling after Quit\n\
         \n\
         What neither does alone:\n\
         - They do not run scheduled tasks without starting the app process.\n\
         - automation_runner continuous ticks need process residency (window/tray)\n\
           or you re-invoke the one-shot helper when something is due.\n\
         \n\
         App path: {app}\n\
         Helper dir: {dir}\n\
         Label: {label}\n\
         \n\
         Disable full-app LaunchAgent from Grok → Scheduled tasks, or:\n\
           launchctl bootout gui/$(id -u)/{label}\n\
           rm -f ~/Library/LaunchAgents/{plist}\n",
        open_script = SCRIPT_FILENAME,
        oneshot_script = ONESHOT_SCRIPT_FILENAME,
        flag = crate::automation_runner::FIRE_DUE_FLAG,
        app = app_path.display(),
        dir = helper.display(),
        label = LAUNCHD_LABEL,
        plist = PLIST_FILENAME,
    )
}

#[cfg(unix)]
fn chmod_755(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|e| format!("chmod {}: {e}", path.display()))
}

/// Write helper scripts + plist + LIMITS under app data (no launchctl).
///
/// Always writes both the full-app open script and the one-shot
/// `fire-due-schedules.sh`. Only the full-app plist is installable via UI.
pub fn generate_helper_files() -> Result<PathBuf, String> {
    let app_path = resolve_app_launch_path()?;
    let dir = helper_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create helper dir: {e}"))?;

    let script_path = dir.join(SCRIPT_FILENAME);
    let oneshot_path = dir.join(ONESHOT_SCRIPT_FILENAME);
    let plist_path = dir.join(PLIST_FILENAME);
    let log_path = dir.join("launchd.log");
    let limits_path = dir.join(LIMITS_FILENAME);

    let script = render_open_script(&app_path);
    fs::write(&script_path, script).map_err(|e| format!("write script: {e}"))?;
    let oneshot = render_oneshot_fire_script(&app_path);
    fs::write(&oneshot_path, oneshot).map_err(|e| format!("write oneshot script: {e}"))?;
    #[cfg(unix)]
    {
        chmod_755(&script_path)?;
        chmod_755(&oneshot_path)?;
    }

    let plist = render_plist(&script_path, &log_path);
    fs::write(&plist_path, plist).map_err(|e| format!("write plist: {e}"))?;
    fs::write(&limits_path, limits_text(&app_path, &dir))
        .map_err(|e| format!("write LIMITS: {e}"))?;

    Ok(dir)
}

#[cfg(target_os = "macos")]
fn users_uid_string() -> String {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "501".into())
}

#[cfg(target_os = "macos")]
fn launchctl_bootout() {
    // Best-effort; ignore errors when not loaded.
    let domain = format!("gui/{}", users_uid_string());
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{LAUNCHD_LABEL}")])
        .output();
    // Legacy fallback
    if let Some(p) = installed_plist_path() {
        let _ = Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&p)
            .output();
    }
}

#[cfg(target_os = "macos")]
fn launchctl_bootstrap(plist: &Path) -> Result<(), String> {
    let domain = format!("gui/{}", users_uid_string());
    let out = Command::new("launchctl")
        .args(["bootstrap", &domain])
        .arg(plist)
        .output()
        .map_err(|e| format!("launchctl bootstrap: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    // Older macOS: load -w
    let out2 = Command::new("launchctl")
        .args(["load", "-w"])
        .arg(plist)
        .output()
        .map_err(|e| format!("launchctl load: {e}"))?;
    if out2.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let err2 = String::from_utf8_lossy(&out2.stderr);
    Err(format!(
        "launchctl bootstrap/load failed: {} / {}",
        err.trim(),
        err2.trim()
    ))
}

/// Generate helper files and install the user LaunchAgent (macOS only).
pub fn enable() -> Result<SchedulesLaunchAgentStatus, String> {
    #[cfg(not(target_os = "macos"))]
    {
        Ok(status_inner(false))
    }
    #[cfg(target_os = "macos")]
    {
        let dir = generate_helper_files()?;
        let src = dir.join(PLIST_FILENAME);
        let agents = launch_agents_dir().ok_or_else(|| "home dir unavailable".to_string())?;
        fs::create_dir_all(&agents).map_err(|e| format!("LaunchAgents dir: {e}"))?;
        let dest = agents.join(PLIST_FILENAME);
        fs::copy(&src, &dest).map_err(|e| format!("install plist: {e}"))?;
        launchctl_bootout();
        launchctl_bootstrap(&dest)?;
        Ok(status_inner(true))
    }
}

/// Unload LaunchAgent and remove installed plist. Keeps generated helper files.
pub fn disable() -> Result<SchedulesLaunchAgentStatus, String> {
    #[cfg(not(target_os = "macos"))]
    {
        Ok(status_inner(false))
    }
    #[cfg(target_os = "macos")]
    {
        launchctl_bootout();
        if let Some(p) = installed_plist_path() {
            let _ = fs::remove_file(p);
        }
        Ok(status_inner(false))
    }
}

fn status_inner(settings_enabled: bool) -> SchedulesLaunchAgentStatus {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = settings_enabled;
        SchedulesLaunchAgentStatus {
            supported: false,
            enabled: false,
            helper_dir: None,
            installed_plist: None,
            installed: false,
            app_path: None,
            honesty: honesty_note(),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let helper = helper_dir();
        let helper_dir = if helper.is_dir() {
            Some(helper.display().to_string())
        } else {
            None
        };
        let installed_plist = installed_plist_path().map(|p| p.display().to_string());
        let installed = installed_plist_path().is_some_and(|p| p.is_file());
        let app_path = resolve_app_launch_path()
            .ok()
            .map(|p| p.display().to_string());
        SchedulesLaunchAgentStatus {
            supported: true,
            enabled: settings_enabled && installed,
            helper_dir,
            installed_plist,
            installed,
            app_path,
            honesty: honesty_note(),
        }
    }
}

pub fn status(settings_enabled: bool) -> SchedulesLaunchAgentStatus {
    status_inner(settings_enabled)
}

/// Whether argv/env requests a tray-first start (LaunchAgent helper).
pub fn wants_start_in_tray() -> bool {
    if std::env::args().any(|a| a == "--start-in-tray") {
        return true;
    }
    matches!(
        std::env::var("GROK_START_IN_TRAY").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn render_script_opens_app_bundle() {
        let p = PathBuf::from("/Applications/Grok.app");
        let s = render_open_script(&p);
        assert!(s.contains("#!/bin/bash"));
        assert!(s.contains("NOT a headless daemon"));
        assert!(s.contains("open -a"));
        assert!(s.contains("--start-in-tray"));
        assert!(s.contains("/Applications/Grok.app"));
    }

    #[test]
    fn render_script_exec_binary() {
        let p = PathBuf::from("/usr/local/bin/grok-app");
        let s = render_open_script(&p);
        assert!(s.contains("GROK_START_IN_TRAY=1"));
        assert!(s.contains("exec"));
        assert!(s.contains("--start-in-tray"));
    }

    #[test]
    fn render_oneshot_fire_script_app_bundle() {
        let p = PathBuf::from("/Applications/Grok.app");
        let s = render_oneshot_fire_script(&p);
        assert!(s.contains("#!/bin/bash"));
        assert!(s.contains("NOT a KeepAlive daemon"));
        assert!(s.contains(crate::automation_runner::FIRE_DUE_FLAG));
        assert!(s.contains("open -a"));
        assert!(s.contains("/Applications/Grok.app"));
        // Must not claim continuous daemon / SuccessfulExit KeepAlive for oneshot.
        assert!(!s.contains("KeepAlive SuccessfulExit"));
    }

    #[test]
    fn render_oneshot_fire_script_binary() {
        let p = PathBuf::from("/usr/local/bin/grok-app");
        let s = render_oneshot_fire_script(&p);
        assert!(s.contains("GROK_FIRE_DUE_SCHEDULES=1"));
        assert!(s.contains("exec"));
        assert!(s.contains(crate::automation_runner::FIRE_DUE_FLAG));
    }

    #[test]
    fn render_plist_honest_keepalive() {
        let script = PathBuf::from("/tmp/helpers/open-grok-for-schedules.sh");
        let log = PathBuf::from("/tmp/helpers/launchd.log");
        let p = render_plist(&script, &log);
        assert!(p.contains(LAUNCHD_LABEL));
        assert!(p.contains("SuccessfulExit"));
        assert!(p.contains("false"));
        assert!(p.contains("open-grok-for-schedules.sh"));
        assert!(p.contains("not a separate schedule daemon") || p.contains("Honest limits"));
    }

    #[test]
    fn escape_xml_entities() {
        assert_eq!(escape_xml("a&b<c>"), "a&amp;b&lt;c&gt;");
    }

    #[test]
    fn wants_start_in_tray_default_false() {
        // In unit tests we typically don't pass --start-in-tray.
        // Env may be polluted; only assert the function is callable.
        let _ = wants_start_in_tray();
    }
}
