//! Interactive PTY host for Side Workbench terminal tabs.
//! Spawns user `$SHELL -l -i` and streams I/O to the UI via Tauri events.
//!
//! Session ids are always unique UUIDs. Reusing ids is unsafe: an old reader
//! thread can `remove()` a newer session with the same key and kill it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const EVENT_DATA: &str = "terminal://data";
const EVENT_EXIT: &str = "terminal://exit";

/// Coalesce window for `terminal://data` (flood of 8KiB reads).
pub const PTY_DATA_FLUSH_MS: u64 = 16;
/// Flush once the batch reaches this many UTF-8 bytes.
pub const PTY_DATA_FLUSH_CHARS: usize = 4096;

pub fn should_flush_pty_data(pending_chars: usize, force: bool) -> bool {
    if pending_chars == 0 {
        return false;
    }
    force || pending_chars >= PTY_DATA_FLUSH_CHARS
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnResult {
    pub session_id: String,
    pub shell: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    session_id: String,
    code: Option<u32>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Unix process-group kill only; Windows uses `ChildKiller`.
    #[cfg(unix)]
    pid: Option<u32>,
}

fn sessions() -> &'static Mutex<HashMap<String, PtySession>> {
    static S: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolve_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        let t = s.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    #[cfg(windows)]
    {
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        if Path::new("/bin/zsh").exists() {
            return "/bin/zsh".into();
        }
        "/bin/bash".into()
    }
}

fn resolve_cwd(project_path: Option<&str>) -> String {
    if let Some(p) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        if Path::new(p).is_dir() {
            return p.to_string();
        }
    }
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into())
}

/// TERM / truecolor so Starship powerline + 24-bit palettes emit SGR.
fn apply_interactive_term_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "grok-app");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
}

/// Force CLI color. Empty `NO_COLOR` still disables themes — must remove it.
fn apply_cli_color_env(cmd: &mut CommandBuilder) {
    cmd.env_remove("NO_COLOR");
    cmd.env("CLICOLOR", "1");
    cmd.env("CLICOLOR_FORCE", "1");
    cmd.env("FORCE_COLOR", "1");
}

/// Spawn an interactive login shell in a PTY; stream output on `terminal://data`.
///
/// `session_id` from the client is **ignored** for identity — we always allocate
/// a fresh UUID so remounts / Strict Mode cannot collide with a dying reader.
///
/// When `ssh_alias` is set, spawn `ssh -tt` (ControlMaster) instead of a local
/// `$SHELL`. The remote path is not a local `std::fs` cwd.
pub fn spawn(
    app: AppHandle,
    _session_id: Option<String>,
    project_path: Option<String>,
    ssh_alias: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<PtySpawnResult, String> {
    let sid = format!("pty_{}", Uuid::new_v4());
    let alias = ssh_alias
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let cols = cols.max(20);
    let rows = rows.max(5);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let (shell, cwd, mut cmd) = if let Some(alias) = alias {
        if !crate::ssh_remote::is_safe_ssh_alias(alias) {
            return Err("invalid SSH host alias".into());
        }
        let remote_cwd = project_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let argv = crate::ssh_remote::ssh_pty_argv(alias, remote_cwd)?;
        let mut cmd = CommandBuilder::new(&argv[0]);
        for a in argv.iter().skip(1) {
            cmd.arg(a);
        }
        // GUI Windows processes often have USERPROFILE but no HOME. Git's
        // OpenSSH reads ~/.ssh/config from HOME.
        let home = crate::process_util::user_home();
        if !home.as_os_str().is_empty() && home != *std::path::Path::new(".") {
            cmd.env("HOME", home.as_os_str());
        }
        if let Some(path) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path);
        }
        let cwd = remote_cwd.unwrap_or("").to_string();
        (format!("ssh {alias}"), cwd, cmd)
    } else {
        let shell = resolve_shell();
        let cwd = resolve_cwd(project_path.as_deref());
        let mut cmd = CommandBuilder::new(&shell);
        let lower = shell.to_lowercase();
        if !lower.contains("powershell") && !lower.ends_with("cmd.exe") {
            // Login + interactive so user rc / oh-my-zsh load (PLAN).
            cmd.arg("-l");
            cmd.arg("-i");
        }
        cmd.cwd(&cwd);
        cmd.env("SHELL", &shell);
        (shell, cwd, cmd)
    };
    apply_interactive_term_env(&mut cmd);
    // UTF-8 locale so multi-byte / OMZ glyphs render correctly.
    let lang = std::env::var("LANG")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "en_US.UTF-8".into());
    cmd.env("LANG", &lang);
    if std::env::var("LC_ALL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .is_none()
    {
        cmd.env("LC_ALL", &lang);
    }
    if std::env::var("LC_CTYPE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .is_none()
    {
        cmd.env("LC_CTYPE", &lang);
    }
    apply_cli_color_env(&mut cmd);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell: {e}"))?;

    // Drop slave after spawn so the child is the only holder of the slave fd
    // (portable-pty / Unix convention).
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {e}"))?;

    // Waiter owns Child; kill() uses clone_killer so we can signal while wait() blocks.
    let killer = child.clone_killer();
    #[cfg(unix)]
    let pid = child.process_id();
    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<Option<u32>>();
    thread::Builder::new()
        .name(format!("pty-child-{sid}"))
        .spawn(move || {
            let code = child.wait().ok().map(|st| st.exit_code());
            let _ = exit_tx.send(code);
        })
        .map_err(|e| format!("spawn child waiter: {e}"))?;

    {
        let mut g = sessions()
            .lock()
            .map_err(|e| format!("sessions lock: {e}"))?;
        g.insert(
            sid.clone(),
            PtySession {
                writer,
                master: pair.master,
                killer,
                #[cfg(unix)]
                pid,
            },
        );
    }

    let app_r = app.clone();
    let sid_r = sid.clone();
    let app_emit = app_r.clone();
    let sid_emit = sid_r.clone();
    let (tx, rx) = mpsc::channel::<String>();
    thread::Builder::new()
        .name(format!("pty-emit-{sid}"))
        .spawn(move || {
            let mut batch = String::new();
            let flush = |batch: &mut String, force: bool| {
                if !should_flush_pty_data(batch.len(), force) {
                    return;
                }
                if batch.is_empty() {
                    return;
                }
                let data = std::mem::take(batch);
                let _ = app_emit.emit(
                    EVENT_DATA,
                    &PtyDataPayload {
                        session_id: sid_emit.clone(),
                        data,
                    },
                );
            };
            loop {
                match rx.recv_timeout(Duration::from_millis(PTY_DATA_FLUSH_MS)) {
                    Ok(chunk) => {
                        batch.push_str(&chunk);
                        flush(&mut batch, false);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => flush(&mut batch, true),
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        flush(&mut batch, true);
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("spawn pty emit: {e}"))?;
    thread::Builder::new()
        .name(format!("pty-read-{sid}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            // Hold incomplete UTF-8 sequences across reads so CJK/emoji stay intact.
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let data = match String::from_utf8(pending.clone()) {
                            Ok(s) => {
                                pending.clear();
                                s
                            }
                            Err(e) => {
                                let valid = e.utf8_error().valid_up_to();
                                if valid == 0 {
                                    if pending.len() > 16 {
                                        let s = String::from_utf8_lossy(&pending).into_owned();
                                        pending.clear();
                                        s
                                    } else {
                                        continue;
                                    }
                                } else {
                                    let s = String::from_utf8_lossy(&pending[..valid]).into_owned();
                                    pending.drain(..valid);
                                    s
                                }
                            }
                        };
                        if data.is_empty() {
                            continue;
                        }
                        if tx.send(data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            if !pending.is_empty() {
                let data = String::from_utf8_lossy(&pending).into_owned();
                let _ = tx.send(data);
            }
            // Only remove *this* id — never a later remount (unique UUID).
            if let Ok(mut g) = sessions().lock() {
                g.remove(&sid_r);
            }
            let code = exit_rx
                .recv_timeout(std::time::Duration::from_millis(800))
                .ok()
                .flatten();
            let _ = app_r.emit(
                EVENT_EXIT,
                &PtyExitPayload {
                    session_id: sid_r,
                    code,
                },
            );
        })
        .map_err(|e| format!("spawn reader: {e}"))?;

    Ok(PtySpawnResult {
        session_id: sid,
        shell,
        cwd,
        cols,
        rows,
    })
}

pub fn write_bytes(session_id: &str, data: &str) -> Result<(), String> {
    let mut g = sessions()
        .lock()
        .map_err(|e| format!("sessions lock: {e}"))?;
    let sess = g
        .get_mut(session_id)
        .ok_or_else(|| format!("pty session not found: {session_id}"))?;
    sess.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("pty write: {e}"))?;
    let _ = sess.writer.flush();
    Ok(())
}

pub fn resize(session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let g = sessions()
        .lock()
        .map_err(|e| format!("sessions lock: {e}"))?;
    let sess = g
        .get(session_id)
        .ok_or_else(|| format!("pty session not found: {session_id}"))?;
    sess.master
        .resize(PtySize {
            rows: rows.max(5),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize: {e}"))?;
    Ok(())
}

pub fn kill(session_id: &str) -> Result<(), String> {
    let mut g = sessions()
        .lock()
        .map_err(|e| format!("sessions lock: {e}"))?;
    let Some(mut sess) = g.remove(session_id) else {
        return Ok(());
    };
    drop(g);
    let _ = sess.killer.kill();
    #[cfg(unix)]
    if let Some(pid) = sess.pid {
        if pid > 1 {
            // SIGHUP + closed PTY is not enough for jobs that ignore hangup.
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }
    // Drop master/writer after signalling so the slave EOF races the kill.
    drop(sess);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_str(cmd: &CommandBuilder, key: &str) -> Option<String> {
        cmd.get_env(key).map(|v| v.to_string_lossy().into_owned())
    }

    #[test]
    fn pty_data_flushes_on_size_or_force() {
        assert!(!should_flush_pty_data(0, false));
        assert!(!should_flush_pty_data(0, true));
        assert!(!should_flush_pty_data(16, false));
        assert!(should_flush_pty_data(16, true));
        assert!(should_flush_pty_data(PTY_DATA_FLUSH_CHARS, false));
        assert!(should_flush_pty_data(PTY_DATA_FLUSH_CHARS + 1, false));
    }

    #[test]
    fn interactive_term_env_advertises_truecolor() {
        let mut cmd = CommandBuilder::new("zsh");
        apply_interactive_term_env(&mut cmd);
        assert_eq!(env_str(&cmd, "TERM").as_deref(), Some("xterm-256color"));
        assert_eq!(env_str(&cmd, "COLORTERM").as_deref(), Some("truecolor"));
        assert_eq!(env_str(&cmd, "TERM_PROGRAM").as_deref(), Some("grok-app"));
    }

    #[test]
    fn kill_unknown_session_is_ok() {
        assert!(kill("pty_missing").is_ok());
        assert!(kill("pty_missing").is_ok());
    }

    #[test]
    fn cli_color_env_removes_no_color() {
        let mut cmd = CommandBuilder::new("zsh");
        cmd.env("NO_COLOR", "1");
        apply_cli_color_env(&mut cmd);
        assert_eq!(env_str(&cmd, "NO_COLOR"), None);
        assert_eq!(env_str(&cmd, "CLICOLOR").as_deref(), Some("1"));
        assert_eq!(env_str(&cmd, "CLICOLOR_FORCE").as_deref(), Some("1"));
        assert_eq!(env_str(&cmd, "FORCE_COLOR").as_deref(), Some("1"));
    }
}
