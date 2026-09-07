//! AppImage WebKitGTK helpers on Linux.
//!
//! Two related failures show up on Wayland hosts (Hyprland + AMD, Arch):
//!
//! 1. The CI-bundled Ubuntu WebKitGTK aborts the UI process with
//!    `Could not create default EGL display: EGL_BAD_PARAMETER` (#539).
//! 2. `WebKitNetworkProcess` / `WebKitWebProcess` keep file-backed mappings
//!    into the AppImage squashfs. When the FUSE mount is torn down on quit
//!    (or a wrapper kills `--appimage-mount`), the leftover helper gets
//!    `SIGBUS`/`BUS_ADRERR`.
//!
//! When the host has WebKitGTK 4.1, re-exec with `LD_LIBRARY_PATH` +
//! `WEBKIT_EXEC_PATH` pointing at it — same combo as
//! `scripts/run-linux-appimage-system-webkit.sh`. Helpers then live on the
//! host filesystem, so FUSE teardown cannot yank their code pages.
//!
//! On bundled-WebKit fallback, wait for those helpers before the process
//! returns so the AppImage runtime unmounts a quiet tree.
//!
//! Opt out: `GROK_SKIP_SYSTEM_WEBKIT=1`.

use std::env;
use std::fs;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const SKIP_ENV: &str = "GROK_SKIP_SYSTEM_WEBKIT";
const APPLIED_ENV: &str = "GROK_SYSTEM_WEBKIT";

const LIB_CANDIDATES: &[&str] = &["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"];

const EXEC_CANDIDATES: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1",
    "/usr/lib64/webkit2gtk-4.1",
    "/usr/lib/webkit2gtk-4.1",
];

const HELPER_WAIT: Duration = Duration::from_secs(3);
const HELPER_POLL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemWebkit {
    pub lib_dir: PathBuf,
    pub exec_dir: PathBuf,
}

pub fn detect_system_webkit() -> Option<SystemWebkit> {
    detect_system_webkit_in(LIB_CANDIDATES, EXEC_CANDIDATES)
}

pub fn detect_system_webkit_in(lib_dirs: &[&str], exec_dirs: &[&str]) -> Option<SystemWebkit> {
    let lib_dir = lib_dirs.iter().map(Path::new).find(|d| {
        d.join("libwebkit2gtk-4.1.so.0").is_file() || d.join("libwebkit2gtk-4.1.so").is_file()
    })?;
    let exec_dir = exec_dirs.iter().map(Path::new).find(|d| {
        d.join("WebKitNetworkProcess").is_file() || d.join("WebKitWebProcess").is_file()
    })?;
    Some(SystemWebkit {
        lib_dir: lib_dir.to_path_buf(),
        exec_dir: exec_dir.to_path_buf(),
    })
}

pub fn running_inside_appimage() -> bool {
    env::var_os("APPDIR").is_some() || env::var_os("APPIMAGE").is_some()
}

/// Re-exec this binary against host WebKitGTK when launched from an AppImage.
///
/// Must run **before** [`crate::host_runtime::on_process_start`]: the first
/// process is replaced, so it must not write a heartbeat the successor would
/// treat as an unclean shutdown.
pub fn maybe_reexec_for_system_webkit() {
    if env::var_os(SKIP_ENV).is_some() || env::var_os(APPLIED_ENV).is_some() {
        return;
    }
    if !running_inside_appimage() {
        return;
    }
    let Some(paths) = detect_system_webkit() else {
        return;
    };

    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(_) => PathBuf::from("/proc/self/exe"),
    };
    let mut cmd = Command::new(exe);
    cmd.args(env::args_os().skip(1));
    cmd.env(APPLIED_ENV, "1");
    cmd.env("WEBKIT_EXEC_PATH", &paths.exec_dir);

    let mut ld = paths.lib_dir.display().to_string();
    if let Ok(old) = env::var("LD_LIBRARY_PATH") {
        if !old.is_empty() {
            ld.push(':');
            ld.push_str(&old);
        }
    }
    cmd.env("LD_LIBRARY_PATH", ld);

    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        cmd.env("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        cmd.env("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    let err = cmd.exec();
    eprintln!("grok-app: system WebKit re-exec failed: {err}");
}

pub fn log_system_webkit_choice() {
    if env::var_os(SKIP_ENV).is_some() {
        tracing::info!("Linux WebKit: GROK_SKIP_SYSTEM_WEBKIT set; using bundled libraries");
        return;
    }
    if env::var_os(APPLIED_ENV).is_some() {
        tracing::info!(
            exec = env::var("WEBKIT_EXEC_PATH").ok(),
            "Linux WebKit: re-exec'd against host WebKitGTK 4.1"
        );
        return;
    }
    if running_inside_appimage() {
        tracing::info!(
            "Linux WebKit: AppImage host has no WebKitGTK 4.1; bundled helpers may SIGBUS on unmount"
        );
    }
}

pub fn is_appimage_webkit_helper(exe: &Path, appdir: &Path) -> bool {
    let Some(name) = exe.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if name != "WebKitNetworkProcess" && name != "WebKitWebProcess" {
        return false;
    }
    exe.starts_with(appdir)
}

fn running_appimage_webkit_helper_pids(appdir: &Path) -> Vec<i32> {
    let mut out = Vec::new();
    let Ok(proc) = fs::read_dir("/proc") else {
        return out;
    };
    let self_pid = std::process::id() as i32;
    for ent in proc.flatten() {
        let pid: i32 = match ent.file_name().to_str().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        if pid == self_pid {
            continue;
        }
        let Ok(exe) = fs::read_link(ent.path().join("exe")) else {
            continue;
        };
        if is_appimage_webkit_helper(&exe, appdir) {
            out.push(pid);
        }
    }
    out
}

fn libc_kill(pid: i32, sig: i32) {
    unsafe {
        libc::kill(pid, sig);
    }
}

/// Block until AppImage-backed WebKit helpers exit, then SIGTERM stragglers.
///
/// Call from `RunEvent::Exit` so the AppImage runtime unmounts after mappings
/// are gone. No-op when not inside an AppImage.
pub fn wait_for_appimage_webkit_helpers() {
    let Some(appdir) = env::var_os("APPDIR") else {
        return;
    };
    let appdir = PathBuf::from(appdir);
    let deadline = Instant::now() + HELPER_WAIT;
    loop {
        let pids = running_appimage_webkit_helper_pids(&appdir);
        if pids.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            tracing::warn!(
                count = pids.len(),
                "Linux WebKit: AppImage helpers still mapped; sending SIGTERM before unmount"
            );
            for pid in pids {
                libc_kill(pid, libc::SIGTERM);
            }
            thread::sleep(HELPER_POLL);
            return;
        }
        thread::sleep(HELPER_POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    fn tmp() -> PathBuf {
        let p = env::temp_dir().join(format!(
            "grok-linux-webkit-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn detect_requires_lib_and_helper() {
        let root = tmp();
        let lib = root.join("lib");
        let exec = root.join("webkit2gtk-4.1");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&exec).unwrap();
        File::create(lib.join("libwebkit2gtk-4.1.so.0")).unwrap();
        File::create(exec.join("WebKitNetworkProcess")).unwrap();

        let found = detect_system_webkit_in(&[lib.to_str().unwrap()], &[exec.to_str().unwrap()])
            .expect("detect");
        assert_eq!(found.lib_dir, lib);
        assert_eq!(found.exec_dir, exec);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detect_none_without_helper_binary() {
        let root = tmp();
        let lib = root.join("lib");
        let exec = root.join("webkit2gtk-4.1");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&exec).unwrap();
        File::create(lib.join("libwebkit2gtk-4.1.so.0")).unwrap();
        assert!(
            detect_system_webkit_in(&[lib.to_str().unwrap()], &[exec.to_str().unwrap()]).is_none()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn helper_match_is_appdir_scoped() {
        let appdir = Path::new("/tmp/.mount_Grok.XXXX");
        assert!(is_appimage_webkit_helper(
            &appdir.join("usr/lib/webkit2gtk-4.1/WebKitNetworkProcess"),
            appdir
        ));
        assert!(is_appimage_webkit_helper(
            &appdir.join("usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess"),
            appdir
        ));
        assert!(!is_appimage_webkit_helper(
            Path::new("/usr/lib/webkit2gtk-4.1/WebKitNetworkProcess"),
            appdir
        ));
        assert!(!is_appimage_webkit_helper(
            &appdir.join("usr/bin/grok-app"),
            appdir
        ));
    }
}
