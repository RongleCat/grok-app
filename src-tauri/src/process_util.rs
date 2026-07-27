//! Cross-platform process / path helpers (Windows GUI spawn, home dir, PATH).

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

/// User home directory.
///
/// - **Windows:** prefer `USERPROFILE` (matches PowerShell / install.ps1).  
///   Fall back to `HOME` only if USERPROFILE is missing (Git Bash sometimes sets HOME).
/// - **Unix/macOS:** `HOME`.
pub fn user_home() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(h) = std::env::var("USERPROFILE") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        if let Ok(h) = std::env::var("HOME") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        return PathBuf::from(".");
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(h) = std::env::var("HOME") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        // Rare fallback
        if let Ok(h) = std::env::var("USERPROFILE") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        PathBuf::from(".")
    }
}

/// PATH list separator for the current OS.
pub fn path_list_separator() -> char {
    #[cfg(target_os = "windows")]
    {
        ';'
    }
    #[cfg(not(target_os = "windows"))]
    {
        ':'
    }
}

/// Hide console window when spawning CLI tools from a GUI app (Windows).
pub fn apply_no_window_std(cmd: &mut StdCommand) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// Same as [`apply_no_window_std`] for `tokio::process::Command`.
pub fn apply_no_window_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd;
}

/// Build a `std::process::Command` with Windows console hidden (Fixes #162).
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> StdCommand {
    let mut cmd = StdCommand::new(program);
    apply_no_window_std(&mut cmd);
    cmd
}

/// Build a `tokio::process::Command` with Windows console hidden.
pub fn tokio_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    apply_no_window_tokio(&mut cmd);
    cmd
}

/// Whether a path looks runnable as a CLI binary on this OS.
///
/// Follows symlinks (`is_file` / metadata). On Windows accepts `.exe`/`.cmd`/`.bat`/`.com`
/// and extension-less files (MSYS installs). On Unix requires any execute bit.
pub fn looks_runnable(path: &Path) -> bool {
    // `is_file` follows symlinks; also accept symlink-to-file that metadata sees as file.
    if !path.is_file() {
        // Windows: broken symlink or reparse point still listed — try metadata
        if path.symlink_metadata().is_err() {
            return false;
        }
        // Symlink that does not resolve: not runnable
        if !std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false) {
            return false;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
        return false;
    }
    #[cfg(not(unix))]
    {
        // Windows: .exe / .cmd / .bat / no extension (some installers / shims).
        match path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref()
        {
            Some("exe") | Some("cmd") | Some("bat") | Some("com") => true,
            None => true,
            Some(_) => false,
        }
    }
}

/// Build PATH suitable for GUI-spawned agent processes.
pub fn enriched_path_env() -> Option<String> {
    let sep = path_list_separator();
    let mut parts: Vec<String> = Vec::new();
    let push = |parts: &mut Vec<String>, p: &str| {
        if p.is_empty() {
            return;
        }
        if !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    };

    if let Ok(cur) = std::env::var("PATH") {
        for p in cur.split(sep) {
            push(&mut parts, p);
        }
    }

    let home = user_home();
    let home_s = home.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        push(&mut parts, &format!(r"{home_s}\.grok\bin"));
        push(&mut parts, &format!(r"{home_s}\.local\bin"));
        push(&mut parts, &format!(r"{home_s}\.cargo\bin"));
        push(&mut parts, &format!(r"{home_s}\AppData\Local\pnpm"));
        push(&mut parts, &format!(r"{home_s}\AppData\Roaming\npm"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            push(&mut parts, &format!(r"{local}\Programs"));
            push(&mut parts, &format!(r"{local}\Microsoft\WinGet\Links"));
        }
        push(&mut parts, r"C:\Program Files\nodejs");
        push(&mut parts, r"C:\Program Files\Git\cmd");
        push(&mut parts, r"C:\Program Files\Git\bin");
    }
    #[cfg(not(target_os = "windows"))]
    {
        push(&mut parts, &format!("{home_s}/.grok/bin"));
        push(&mut parts, &format!("{home_s}/.local/bin"));
        push(&mut parts, &format!("{home_s}/.cargo/bin"));
        push(&mut parts, &format!("{home_s}/.bun/bin"));
        push(&mut parts, "/opt/homebrew/bin");
        push(&mut parts, "/usr/local/bin");
        push(&mut parts, "/usr/bin");
        push(&mut parts, "/bin");
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(&sep.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_home_nonempty() {
        assert!(!user_home().as_os_str().is_empty());
    }

    #[test]
    fn enriched_path_has_separator() {
        if let Some(p) = enriched_path_env() {
            assert!(!p.is_empty());
            #[cfg(target_os = "windows")]
            assert!(p.contains(';') || !p.contains(':'));
        }
    }
}
