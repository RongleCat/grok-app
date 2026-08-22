//! Cross-platform process / path helpers (Windows GUI spawn, home dir, PATH).

#![allow(dead_code)] // residual-clippy: tokio_command helper
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::thread;

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

/// Whether process env already has a non-empty `HOME`.
fn home_env_present() -> bool {
    std::env::var_os("HOME").is_some_and(|v| !v.is_empty())
}

/// Ensure child sees `$HOME` when the parent GUI process does not.
///
/// Windows apps launched from Start Menu / Explorer typically only have
/// `USERPROFILE`, not `HOME`. Grok Build CLI hub resolves data under
/// `$GROK_HOME` **or** `$HOME/.grok` and errors with
/// `neither $GROK_HOME nor $HOME is set` when both are missing
/// (e.g. `grok worktree db path|stats|rebuild`).
///
/// Does **not** set `GROK_HOME` — agent/session paths set that explicitly
/// (independent vs shared). Worktree / update / probe CLIs should use the
/// user's real home (`USERPROFILE` on Windows) via `HOME`.
pub fn ensure_home_env_std(cmd: &mut StdCommand) {
    if home_env_present() {
        return;
    }
    let home = user_home();
    if home.as_os_str().is_empty() || home == Path::new(".") {
        return;
    }
    cmd.env("HOME", home);
}

/// Same as [`ensure_home_env_std`] for `tokio::process::Command`.
pub fn ensure_home_env_tokio(cmd: &mut tokio::process::Command) {
    if home_env_present() {
        return;
    }
    let home = user_home();
    if home.as_os_str().is_empty() || home == Path::new(".") {
        return;
    }
    cmd.env("HOME", home);
}

/// Standard env for GUI-spawned Grok CLI / sibling tools:
/// no-window (Windows), enriched PATH, and HOME when missing.
pub fn apply_cli_env_std(cmd: &mut StdCommand) {
    apply_no_window_std(cmd);
    ensure_home_env_std(cmd);
    if let Some(path_env) = enriched_path_env() {
        cmd.env("PATH", path_env);
    }
}

/// Same as [`apply_cli_env_std`] for `tokio::process::Command`.
pub fn apply_cli_env_tokio(cmd: &mut tokio::process::Command) {
    apply_no_window_tokio(cmd);
    ensure_home_env_tokio(cmd);
    if let Some(path_env) = enriched_path_env() {
        cmd.env("PATH", path_env);
    }
}

/// Build a `std::process::Command` with Windows console hidden (Fixes #162)
/// and HOME filled in for GUI-spawned CLI tools on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> StdCommand {
    let mut cmd = StdCommand::new(program);
    apply_no_window_std(&mut cmd);
    ensure_home_env_std(&mut cmd);
    cmd
}

/// Build a `tokio::process::Command` with Windows console hidden + HOME.
pub fn tokio_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    apply_no_window_tokio(&mut cmd);
    ensure_home_env_tokio(&mut cmd);
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
        if !std::fs::metadata(path)
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return false;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
        false
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

/// Push `p` onto `parts` if non-empty and not already present.
fn push_path_part(parts: &mut Vec<String>, p: &str) {
    if p.is_empty() {
        return;
    }
    if !parts.iter().any(|x| x == p) {
        parts.push(p.to_string());
    }
}

/// Push directory only when it exists (for optional user installs like conda).
fn push_path_dir_if_exists(parts: &mut Vec<String>, dir: &Path) {
    if dir.is_dir() {
        push_path_part(parts, &dir.to_string_lossy());
    }
}

/// Common user-level Python/Node/env manager bin dirs (conda, pyenv, nvm, asdf…).
///
/// GUI apps (Dock / Finder) inherit a sparse PATH and never load `~/.zshrc`, so
/// agent shell-outs miss tools that work in Terminal. Only **existing** dirs are
/// returned so PATH is not bloated with dead roots.
///
/// Pure helper (takes `home`) for unit tests.
pub fn user_tool_path_dirs(home: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push_dir = |p: PathBuf| {
        if p.is_dir() && !out.iter().any(|x| x == &p) {
            out.push(p);
        }
    };

    // Active conda/mamba from parent env (e.g. app launched from an activated shell).
    for key in ["CONDA_PREFIX", "MAMBA_ROOT_PREFIX", "CONDA_ROOT"] {
        if let Ok(v) = std::env::var(key) {
            if v.is_empty() {
                continue;
            }
            let root = PathBuf::from(&v);
            #[cfg(target_os = "windows")]
            {
                push_dir(root.join("Scripts"));
                push_dir(root.join("Library").join("bin"));
                push_dir(root.join("bin"));
            }
            #[cfg(not(target_os = "windows"))]
            {
                push_dir(root.join("bin"));
                push_dir(root.join("condabin"));
            }
        }
    }
    // CONDA_EXE=/…/bin/conda → parent bin (+ condabin).
    if let Ok(exe) = std::env::var("CONDA_EXE") {
        if let Some(bin) = Path::new(&exe).parent() {
            push_dir(bin.to_path_buf());
            if let Some(root) = bin.parent() {
                #[cfg(target_os = "windows")]
                push_dir(root.join("Scripts"));
                #[cfg(not(target_os = "windows"))]
                push_dir(root.join("condabin"));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let names = [
            "miniconda3",
            "Miniconda3",
            "anaconda3",
            "Anaconda3",
            "mambaforge",
            "Mambaforge",
            "miniforge3",
            "Miniforge3",
            "micromamba",
        ];
        for name in names {
            let root = home.join(name);
            push_dir(root.join("Scripts"));
            push_dir(root.join("Library").join("bin"));
            push_dir(root.join("condabin"));
            push_dir(root.join("bin"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for name in ["miniconda3", "Miniconda3", "anaconda3", "Anaconda3"] {
                let root = local.join(name);
                push_dir(root.join("Scripts"));
                push_dir(root.join("Library").join("bin"));
                push_dir(root.join("condabin"));
            }
        }
        push_dir(home.join(".pyenv").join("pyenv-win").join("shims"));
        push_dir(home.join(".pyenv").join("pyenv-win").join("bin"));
        if let Ok(nvm) = std::env::var("NVM_HOME") {
            push_dir(PathBuf::from(nvm));
        }
        if let Ok(nvm_sym) = std::env::var("NVM_SYMLINK") {
            push_dir(PathBuf::from(nvm_sym));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let conda_roots = [
            home.join("miniconda3"),
            home.join("anaconda3"),
            home.join("miniforge3"),
            home.join("mambaforge"),
            home.join("micromamba"),
            home.join("opt").join("miniconda3"),
            home.join("opt").join("anaconda3"),
            home.join("opt").join("miniforge3"),
            home.join("opt").join("mambaforge"),
            PathBuf::from("/opt/homebrew/Caskroom/miniconda/base"),
            PathBuf::from("/opt/homebrew/Caskroom/miniforge/base"),
            PathBuf::from("/usr/local/Caskroom/miniconda/base"),
            PathBuf::from("/usr/local/Caskroom/miniforge/base"),
            PathBuf::from("/opt/miniconda3"),
            PathBuf::from("/opt/anaconda3"),
            PathBuf::from("/opt/miniforge3"),
        ];
        for root in conda_roots {
            push_dir(root.join("bin"));
            push_dir(root.join("condabin"));
        }
        push_dir(home.join(".pyenv").join("shims"));
        push_dir(home.join(".pyenv").join("bin"));
        push_dir(home.join(".asdf").join("shims"));
        push_dir(home.join(".asdf").join("bin"));
        push_dir(home.join(".local").join("share").join("fnm"));
        push_dir(home.join(".volta").join("bin"));
    }

    // nvm (unix-style ~/.nvm): alias/default is often a major (`22`) or nested
    // alias (`lts/*`), not the on-disk folder (`v22.22.0`). Exact join misses
    // node → GUI `grok update --check` (installer=npm) fails with ENOENT.
    for bin in nvm_node_bin_dirs(home) {
        push_dir(bin);
    }

    out
}

/// Resolve nvm-managed Node `…/bin` directories under `home/.nvm`.
///
/// Pure helper (takes `home`) for unit tests. Returns only existing dirs.
pub fn nvm_node_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let nvm_root = home.join(".nvm");
    if !nvm_root.is_dir() {
        return Vec::new();
    }
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(bin) = resolve_nvm_ref_to_bin(&nvm_root, "default", 0) {
        if bin.is_dir() {
            out.push(bin);
        }
    }
    // Fallback when default is missing / broken: newest installed node.
    if out.is_empty() {
        if let Some(bin) = newest_nvm_node_bin(&nvm_root) {
            if bin.is_dir() {
                out.push(bin);
            }
        }
    }
    out
}

/// Resolve an nvm alias or version label to `versions/node/<ver>/bin`.
///
/// Walks nested aliases (`default` → `22` → `v22.22.0`, `lts/*` → …) and
/// prefix-matches major-only labels against installed folders.
fn resolve_nvm_ref_to_bin(nvm_root: &Path, raw: &str, depth: u8) -> Option<PathBuf> {
    if depth > 12 {
        return None;
    }
    let name = raw.trim();
    if name.is_empty() {
        return None;
    }

    // Alias files first so `default` / `lts/iron` / major shims resolve correctly.
    let alias_path = nvm_root.join("alias").join(name);
    if alias_path.is_file() {
        if let Ok(target) = std::fs::read_to_string(&alias_path) {
            let t = target.trim();
            if !t.is_empty() && t != name {
                if let Some(bin) = resolve_nvm_ref_to_bin(nvm_root, t, depth + 1) {
                    return Some(bin);
                }
            }
        }
    }

    let versions = nvm_root.join("versions").join("node");
    if !versions.is_dir() {
        return None;
    }

    // Exact on-disk names: `v22.22.0`, bare `22.22.0`, or raw alias text.
    let stripped = name.trim_start_matches('v');
    for cand in [
        versions.join(name).join("bin"),
        versions.join(format!("v{stripped}")).join("bin"),
        versions.join(stripped).join("bin"),
    ] {
        if cand.is_dir() {
            return Some(cand);
        }
    }

    // Prefix / major match: alias `22` → highest `v22.*` install.
    fuzzy_match_nvm_version_bin(&versions, name)
}

fn fuzzy_match_nvm_version_bin(versions_dir: &Path, query: &str) -> Option<PathBuf> {
    let q = query.trim().trim_start_matches('v');
    if q.is_empty() || q.contains('/') {
        return None;
    }
    let mut hits: Vec<(String, PathBuf)> = Vec::new();
    let rd = std::fs::read_dir(versions_dir).ok()?;
    for entry in rd.flatten() {
        let fname = entry.file_name().to_string_lossy().into_owned();
        let n = fname.trim_start_matches('v').to_string();
        if n == q || n.starts_with(&format!("{q}.")) {
            let bin = entry.path().join("bin");
            if bin.is_dir() {
                hits.push((n, bin));
            }
        }
    }
    hits.sort_by(|a, b| cmp_loose_semver(&a.0, &b.0));
    hits.pop().map(|(_, bin)| bin)
}

fn newest_nvm_node_bin(nvm_root: &Path) -> Option<PathBuf> {
    let versions = nvm_root.join("versions").join("node");
    if !versions.is_dir() {
        return None;
    }
    let mut hits: Vec<(String, PathBuf)> = Vec::new();
    let rd = std::fs::read_dir(&versions).ok()?;
    for entry in rd.flatten() {
        let fname = entry.file_name().to_string_lossy().into_owned();
        let n = fname.trim_start_matches('v').to_string();
        let bin = entry.path().join("bin");
        if bin.is_dir() {
            hits.push((n, bin));
        }
    }
    hits.sort_by(|a, b| cmp_loose_semver(&a.0, &b.0));
    hits.pop().map(|(_, bin)| bin)
}

/// Compare dotted version-ish strings (`22.9.0` vs `22.22.0`) by numeric parts.
fn cmp_loose_semver(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    parse(a).cmp(&parse(b))
}

/// Build PATH suitable for GUI-spawned agent processes.
///
/// Starts from the process PATH, then appends common CLI install locations and
/// **existing** user tool roots (conda/mamba/pyenv/…) so nested shell tools
/// resolve like an interactive Terminal session without loading shell rc files.
pub fn enriched_path_env() -> Option<String> {
    let sep = path_list_separator();
    let mut parts: Vec<String> = Vec::new();

    if let Ok(cur) = std::env::var("PATH") {
        for p in cur.split(sep) {
            push_path_part(&mut parts, p);
        }
    }

    let home = user_home();
    let home_s = home.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        push_path_part(&mut parts, &format!(r"{home_s}\.grok\bin"));
        push_path_part(&mut parts, &format!(r"{home_s}\.local\bin"));
        push_path_part(&mut parts, &format!(r"{home_s}\.cargo\bin"));
        push_path_part(&mut parts, &format!(r"{home_s}\AppData\Local\pnpm"));
        push_path_part(&mut parts, &format!(r"{home_s}\AppData\Roaming\npm"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            push_path_part(&mut parts, &format!(r"{local}\Programs"));
            push_path_part(&mut parts, &format!(r"{local}\Microsoft\WinGet\Links"));
        }
        push_path_part(&mut parts, r"C:\Program Files\nodejs");
        push_path_part(&mut parts, r"C:\Program Files\Git\cmd");
        push_path_part(&mut parts, r"C:\Program Files\Git\bin");
    }
    #[cfg(not(target_os = "windows"))]
    {
        push_path_part(&mut parts, &format!("{home_s}/.grok/bin"));
        push_path_part(&mut parts, &format!("{home_s}/.local/bin"));
        push_path_part(&mut parts, &format!("{home_s}/.cargo/bin"));
        push_path_part(&mut parts, &format!("{home_s}/.bun/bin"));
        push_path_part(&mut parts, "/opt/homebrew/bin");
        push_path_part(&mut parts, "/usr/local/bin");
        push_path_part(&mut parts, "/usr/bin");
        push_path_part(&mut parts, "/bin");
    }

    for d in user_tool_path_dirs(&home) {
        push_path_dir_if_exists(&mut parts, &d);
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(&sep.to_string()))
    }
}

/// Fire-and-forget background work that **must not** take down the process.
///
/// Named thread + `catch_unwind`: panics become error logs instead of process abort
/// when they would otherwise escape an unhandled thread (Rust default: abort on
/// uncaught panic in non-main threads depends on panic strategy; release often
/// aborts). Prefer this over bare `std::thread::spawn` for optional host chores.
pub fn spawn_named_catch<F>(name: impl Into<String>, f: F)
where
    F: FnOnce() + Send + 'static,
{
    let name = name.into();
    let label = name.clone();
    let result = thread::Builder::new().name(name).spawn(move || {
        if let Err(payload) = catch_unwind(AssertUnwindSafe(f)) {
            let msg = if let Some(s) = payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".into()
            };
            tracing::error!(thread = %label, panic = %msg, "background task panicked (caught)");
        }
    });
    if let Err(e) = result {
        tracing::error!(error = %e, "failed to spawn named background task");
    }
}

/// Strip Windows extended-length prefix (`\\?\C:\…` / `\\?\UNC\…` / `//?/`) so
/// shell tools (`explorer /select,`) can open the real path. Canonicalize often
/// returns `\\?\C:\…`; explorer then falls back to the default This PC view.
pub fn strip_extended_path_prefix(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    if let Some(rest) = s.strip_prefix("//?/") {
        return rest.replace('/', "\\");
    }
    s.to_string()
}

/// Native display path for OS file-manager reveal/select.
///
/// - Canonical when possible (resolves `.` / `..` / symlinks)
/// - Windows: backslashes, no `\\?\` prefix
pub fn path_for_file_manager(path: &Path) -> String {
    let pb = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    let raw = pb.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        return strip_extended_path_prefix(&raw).replace('/', "\\");
    }
    #[cfg(not(target_os = "windows"))]
    {
        raw.into_owned()
    }
}

/// Percent-encode a local path for a `file://` URI (Linux ShowItems).
fn file_uri_from_path(path: &str) -> String {
    // file:// + absolute path; encode non-unreserved octets.
    let mut out = String::from("file://");
    for b in path.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Reveal a path in the OS file manager and **select** the item when possible.
///
/// | OS | Method |
/// |----|--------|
/// | macOS | `open -R <path>` |
/// | Windows | `explorer /select,<native-path>` (no CREATE_NO_WINDOW) |
/// | Linux | `org.freedesktop.FileManager1.ShowItems` → fallback `xdg-open` parent |
///
/// Important: do **not** use [`command`] here on Windows — `CREATE_NO_WINDOW`
/// makes explorer open a default page instead of selecting the file.
pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("path not found: {}", path.display()));
    }
    let path_s = path_for_file_manager(path);

    #[cfg(target_os = "macos")]
    {
        use std::process::Stdio;
        StdCommand::new("open")
            .args(["-R", &path_s])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("open -R: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // Split `/select,` and path (same as doctor export / side_browser download).
        // Combined `/select,C:\path with spaces` is fragile; two args handle spaces.
        // Do not set CREATE_NO_WINDOW — explorer is a GUI process.
        StdCommand::new("explorer")
            .args(["/select,", &path_s])
            .spawn()
            .map_err(|e| format!("explorer /select: {e}"))?;
        // explorer often returns non-zero even when the window opens — ignore status.
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::process::Stdio;
        let uri = file_uri_from_path(&path_s);
        // Prefer FileManager1.ShowItems so the file is selected (Nautilus, Dolphin, …).
        // dbus-send needs quotes around the URI when it contains special chars.
        let shown = StdCommand::new("dbus-send")
            .args([
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:\"{uri}\""),
                "string:\"\"",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if shown {
            return Ok(());
        }
        // Fallback: open parent directory (no select).
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| path.to_path_buf());
        let parent_s = path_for_file_manager(&parent);
        StdCommand::new("xdg-open")
            .arg(&parent_s)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("xdg-open: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("reveal not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_home_nonempty() {
        assert!(!user_home().as_os_str().is_empty());
    }

    #[test]
    fn strip_extended_path_prefix_windows_style() {
        assert_eq!(
            strip_extended_path_prefix(r"\\?\C:\Users\a\b.png"),
            r"C:\Users\a\b.png"
        );
        assert_eq!(
            strip_extended_path_prefix(r"\\?\UNC\server\share\f.png"),
            r"\\server\share\f.png"
        );
        assert_eq!(
            strip_extended_path_prefix(r"C:\Users\a\b.png"),
            r"C:\Users\a\b.png"
        );
        assert_eq!(strip_extended_path_prefix("/Users/a/b"), "/Users/a/b");
    }

    #[test]
    fn ensure_home_env_uses_userprofile_fallback_when_home_absent() {
        // Serialise against other env-mutating tests in this crate.
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let prev_home = std::env::var_os("HOME");
        let prev_profile = std::env::var_os("USERPROFILE");
        // Simulate Windows GUI: no HOME, only USERPROFILE (Unix falls back the same way).
        std::env::remove_var("HOME");
        std::env::set_var("USERPROFILE", "/tmp/grok-app-win-home-sim");
        assert!(!home_env_present());
        let home = user_home();
        assert_eq!(home, PathBuf::from("/tmp/grok-app-win-home-sim"));
        // Must not panic; Command env is opaque so we only assert resolution path.
        let mut cmd = StdCommand::new("true");
        ensure_home_env_std(&mut cmd);
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        match prev_profile {
            Some(v) => std::env::set_var("USERPROFILE", v),
            None => std::env::remove_var("USERPROFILE"),
        }
    }

    #[test]
    fn ensure_home_env_skips_when_home_already_set() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let prev_home = std::env::var_os("HOME");
        std::env::set_var("HOME", "/tmp/grok-app-home-test");
        assert!(home_env_present());
        // Should not panic / should be a no-op path.
        let mut cmd = StdCommand::new("true");
        ensure_home_env_std(&mut cmd);
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn enriched_path_has_separator() {
        if let Some(p) = enriched_path_env() {
            assert!(!p.is_empty());
            #[cfg(target_os = "windows")]
            assert!(p.contains(';') || !p.contains(':'));
        }
    }

    #[test]
    fn user_tool_path_dirs_only_existing() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-path-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        // Missing install → empty extras from home scan (env may still add some).
        let missing = user_tool_path_dirs(&tmp);
        // No conda under empty temp home; env-based entries may exist.
        for d in &missing {
            assert!(d.is_dir(), "returned non-dir {}", d.display());
        }
        // Create a fake miniconda3/bin → must appear.
        let bin = tmp.join("miniconda3").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let found = user_tool_path_dirs(&tmp);
        assert!(
            found.iter().any(|p| p == &bin),
            "expected {:?} in {:?}",
            bin,
            found
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn nvm_resolves_major_alias_default_to_installed_bin() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-nvm-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        // Real-world shape: alias/default = "22", install at versions/node/v22.22.0
        let bin = tmp
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v22.22.0")
            .join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        // Older patch also present — must pick highest.
        let older = tmp
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v22.9.0")
            .join("bin");
        std::fs::create_dir_all(&older).unwrap();
        let alias_dir = tmp.join(".nvm").join("alias");
        std::fs::create_dir_all(&alias_dir).unwrap();
        std::fs::write(alias_dir.join("default"), "22\n").unwrap();

        let dirs = nvm_node_bin_dirs(&tmp);
        assert_eq!(dirs, vec![bin.clone()], "got {dirs:?}");

        // Also exposed via user_tool_path_dirs.
        let tools = user_tool_path_dirs(&tmp);
        assert!(
            tools.iter().any(|p| p == &bin),
            "expected nvm bin in user_tool_path_dirs: {tools:?}"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn nvm_resolves_nested_lts_alias() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-nvm-lts-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        let bin = tmp
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v20.18.1")
            .join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let alias = tmp.join(".nvm").join("alias");
        std::fs::create_dir_all(alias.join("lts")).unwrap();
        std::fs::write(alias.join("default"), "lts/iron\n").unwrap();
        std::fs::write(alias.join("lts").join("iron"), "v20.18.1\n").unwrap();

        let dirs = nvm_node_bin_dirs(&tmp);
        assert_eq!(dirs, vec![bin]);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn nvm_falls_back_to_newest_when_default_missing() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-nvm-fallback-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        let v18 = tmp
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v18.20.0")
            .join("bin");
        let v22 = tmp
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v22.22.0")
            .join("bin");
        std::fs::create_dir_all(&v18).unwrap();
        std::fs::create_dir_all(&v22).unwrap();
        // No alias/default
        let dirs = nvm_node_bin_dirs(&tmp);
        assert_eq!(dirs, vec![v22]);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn cmp_loose_semver_orders_patch_and_minor() {
        assert_eq!(
            cmp_loose_semver("22.9.0", "22.22.0"),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            cmp_loose_semver("22.22.0", "22.22.0"),
            std::cmp::Ordering::Equal
        );
        assert_eq!(
            cmp_loose_semver("23.0.0", "22.99.0"),
            std::cmp::Ordering::Greater
        );
    }

    #[test]
    fn enriched_path_includes_existing_tool_dirs() {
        let Some(path) = enriched_path_env() else {
            return;
        };
        let sep = path_list_separator();
        let parts: Vec<&str> = path.split(sep).filter(|s| !s.is_empty()).collect();
        assert!(!parts.is_empty());
        // Dedup preserved: no consecutive identical empties; unique membership.
        let mut seen = std::collections::HashSet::new();
        for p in &parts {
            assert!(seen.insert(*p), "duplicate PATH entry: {p}");
        }
    }

    #[test]
    fn spawn_named_catch_swallows_panic() {
        let (tx, rx) = std::sync::mpsc::channel();
        spawn_named_catch("test-panic-catch", move || {
            let _ = tx.send(());
            panic!("expected test panic");
        });
        // Task should start; panic must not kill the test process.
        let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
