//! Per-ACP-process `GROK_HOME` so official and custom chats do not share
//! `agent-home/auth.json` (#1293).
//!
//! The canonical agent-home stays the file the app writes (config, sessions,
//! memory, skills, and the auth mirror used for login heal). Each spawned
//! process gets `{app data}/agent-proc/<id>/`:
//!
//! - `auth.json` is a private copy for an official process, and absent for a
//!   custom process. It is never a link back to the canonical file.
//! - `hooks` and `bundled` are real directories. `hooks-paths` and `config.toml`
//!   are private regular files (`st_nlink` == 1). The CLI sandbox refuses a
//!   symlink on those directories, a hard-linked hook JSON, and a hard-linked
//!   `config.toml`. A link would fail every sandboxed chat at startup.
//! - other entries are links to the canonical home, so resume still sees one
//!   sessions directory. `config.toml` is a spawn-time copy: the sandbox
//!   rejects a second name for that inode.
//!
//! Callers hold `route_auth_lock` across canonical writes and `create`. The
//! snapshot is immutable after that; nested tools inherit `GROK_HOME`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::app_data_root;

const SHARED_DIR_NAMES: &[&str] = &["sessions", "memory", "skills"];
const AUTH_FILE: &str = "auth.json";

/// `{app data}/agent-proc`
pub fn agent_proc_root() -> PathBuf {
    app_data_root().join("agent-proc")
}

/// Seal a private home for one process whose canonical `GROK_HOME` is `canonical`
/// (always the app agent-home). Official auth is copied from `~/.grok/auth.json`.
pub fn create(canonical: &Path, custom_route: bool) -> Result<PathBuf, String> {
    let cli = crate::process_util::user_home()
        .join(".grok")
        .join(AUTH_FILE);
    let mirror = canonical.join(AUTH_FILE);
    // Prefer the login file. Fall back to the agent-home mirror when a CLI
    // subprocess deleted `~/.grok/auth.json` and heal has not copied it back.
    let auth = if custom_route {
        None
    } else if cli.is_file() {
        Some(cli)
    } else if mirror.is_file() {
        Some(mirror)
    } else {
        None
    };
    create_from(canonical, custom_route, auth.as_deref())
}

/// Same as [`create`], with an explicit official auth file for tests.
pub fn create_from(
    canonical: &Path,
    custom_route: bool,
    official_auth: Option<&Path>,
) -> Result<PathBuf, String> {
    fs::create_dir_all(canonical).map_err(|e| format!("create canonical agent home: {e}"))?;
    let root = agent_proc_root();
    fs::create_dir_all(&root).map_err(|e| format!("create agent-proc: {e}"))?;
    let dir = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&dir).map_err(|e| format!("create proc home: {e}"))?;
    if let Err(e) = populate(&dir, canonical, custom_route, official_auth) {
        discard(&dir);
        return Err(e);
    }
    tracing::info!(
        target: "agent_proc_home",
        custom_route,
        home = %dir.display(),
        "sealed private GROK_HOME"
    );
    Ok(dir)
}

fn populate(
    dir: &Path,
    canonical: &Path,
    custom_route: bool,
    official_auth: Option<&Path>,
) -> Result<(), String> {
    for name in SHARED_DIR_NAMES {
        let path = canonical.join(name);
        if !path.exists() {
            fs::create_dir_all(&path).map_err(|e| format!("create {name}: {e}"))?;
        }
    }
    let entries = fs::read_dir(canonical).map_err(|e| format!("read agent home: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read agent home entry: {e}"))?;
        let name = entry.file_name();
        if name == AUTH_FILE {
            continue;
        }
        let src = entry.path();
        let dest = dir.join(&name);
        // CLI >= 1.0.60: `bundled` must be a real directory, same as `hooks`.
        if name == "hooks" || name == "bundled" {
            materialize_real_tree(&src, &dest)?;
            continue;
        }
        // `config.toml` must be its own inode. A hard link (`st_nlink` > 1)
        // makes the sandbox refuse to start (#1338, #1341).
        if name == "hooks-paths" || name == "config.toml" {
            copy_private_file(&src, &dest)?;
            continue;
        }
        share_entry(&src, &dest)?;
    }
    if custom_route {
        return Ok(());
    }
    if let Some(src) = official_auth {
        if src.is_file() {
            write_private_auth(src, &dir.join(AUTH_FILE))?;
        }
    }
    Ok(())
}

/// Copy a file's bytes into a new inode. `hard_link` would leave `st_nlink` > 1,
/// which the sandbox rejects for hook JSON and for `config.toml`.
fn copy_private_file(src: &Path, dest: &Path) -> Result<(), String> {
    let bytes = fs::read(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    fs::write(dest, &bytes).map_err(|e| format!("write {}: {e}", dest.display()))?;
    Ok(())
}

/// Real directory tree. Symlinks are followed and written as real files or
/// directories so no path component under `hooks` or `bundled` is a link.
fn materialize_real_tree(src: &Path, dest: &Path) -> Result<(), String> {
    materialize_node(src, dest, 0)
}

fn materialize_node(src: &Path, dest: &Path, depth: u32) -> Result<(), String> {
    if depth > 16 {
        return Err(format!("sealed tree too deep: {}", src.display()));
    }
    let meta = fs::metadata(src).map_err(|e| format!("stat {}: {e}", src.display()))?;
    if meta.is_dir() {
        fs::create_dir(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
        let entries = fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("read {}: {e}", src.display()))?;
            materialize_node(&entry.path(), &dest.join(entry.file_name()), depth + 1)?;
        }
        Ok(())
    } else {
        copy_private_file(src, dest)
    }
}

fn share_entry(src: &Path, dest: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(src).map_err(|e| format!("stat {}: {e}", src.display()))?;
    let followed_dir = fs::metadata(src).map(|m| m.is_dir()).unwrap_or(false);
    if meta.is_dir() || followed_dir {
        link_dir(src, dest).map_err(|e| format!("link {}: {e}", src.display()))
    } else {
        share_file(src, dest).map_err(|e| format!("share {}: {e}", src.display()))
    }
}

fn share_file(src: &Path, dest: &Path) -> std::io::Result<()> {
    match fs::hard_link(src, dest) {
        Ok(()) => Ok(()),
        Err(err) => {
            tracing::warn!(
                target: "agent_proc_home",
                src = %src.display(),
                error = %err,
                "hard link failed; copied the file instead"
            );
            fs::copy(src, dest).map(|_| ())
        }
    }
}

fn write_private_auth(src: &Path, dest: &Path) -> Result<(), String> {
    let bytes = fs::read(src).map_err(|e| format!("read official auth: {e}"))?;
    fs::write(dest, &bytes).map_err(|e| format!("write proc auth: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dest, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Directory symlink on Unix, junction on Windows. Junctions do not need
/// developer mode, and `remove_dir` drops the link without following it.
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "mklink", "/J"]).arg(link).arg(target);
        crate::process_util::apply_no_window_std(&mut cmd);
        let out = cmd.output()?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            Err(std::io::Error::other(format!(
                "mklink /J failed: {err}{stdout}"
            )))
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link);
        Err(std::io::Error::other(
            "private agent home links are not supported on this os",
        ))
    }
}

/// Delete one sealed home. Refuses any path that is not a direct child of
/// `agent-proc`, and unlinks directory links instead of following them.
pub fn discard(dir: &Path) {
    if !is_managed_proc_home(dir) {
        tracing::warn!(
            target: "agent_proc_home",
            home = %dir.display(),
            "refusing to discard a path outside agent-proc"
        );
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = remove_proc_child(&path);
        }
    }
    let _ = fs::remove_dir(dir);
}

fn remove_proc_child(path: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        // Directory symlink / junction: remove the link, never the target.
        fs::remove_dir(path).or_else(|_| fs::remove_file(path))
    } else if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn is_managed_proc_home(dir: &Path) -> bool {
    let Ok(root) = agent_proc_root().canonicalize() else {
        return false;
    };
    let Ok(dir) = dir.canonicalize() else {
        return false;
    };
    dir.parent() == Some(root.as_path())
}

/// Drop sealed homes left by a crashed process. The app is single-instance,
/// so at startup none of these directories belong to a live child.
pub fn sweep_orphans() {
    let Ok(entries) = fs::read_dir(agent_proc_root()) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            discard(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn with_app_home<T>(f: impl FnOnce(PathBuf) -> T) -> T {
        static TEST_LOCK: Mutex<()> = Mutex::new(());
        let _test = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _env = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "grok-proc-home-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let out = f(tmp.clone());
        match prev {
            Some(value) => std::env::set_var("GROK_APP_HOME", value),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
        out
    }

    fn canonical_with_config(root: &Path) -> PathBuf {
        let canonical = root.join("agent-home");
        fs::create_dir_all(canonical.join("sessions")).unwrap();
        fs::write(canonical.join("sessions").join("keep.txt"), b"session").unwrap();
        fs::write(canonical.join("config.toml"), b"default = \"grok\"\n").unwrap();
        canonical
    }

    #[test]
    fn official_and_custom_snapshots_do_not_share_auth() {
        with_app_home(|root| {
            let canonical = canonical_with_config(&root);
            fs::write(canonical.join(AUTH_FILE), b"canonical-oidc").unwrap();
            let auth_src = root.join("cli-auth.json");
            fs::write(&auth_src, b"{\"access_token\":\"secret\"}").unwrap();

            let official = create_from(&canonical, false, Some(&auth_src)).unwrap();
            let custom = create_from(&canonical, true, Some(&auth_src)).unwrap();

            assert_eq!(
                fs::read(official.join(AUTH_FILE)).unwrap(),
                fs::read(&auth_src).unwrap()
            );
            assert!(!custom.join(AUTH_FILE).exists());
            assert_eq!(
                fs::read(official.join("sessions").join("keep.txt")).unwrap(),
                b"session"
            );
            assert_eq!(
                fs::read(custom.join("sessions").join("keep.txt")).unwrap(),
                b"session"
            );

            fs::write(&auth_src, b"changed-later").unwrap();
            fs::write(canonical.join(AUTH_FILE), b"rewritten").unwrap();
            assert_eq!(
                fs::read(official.join(AUTH_FILE)).unwrap(),
                b"{\"access_token\":\"secret\"}"
            );
            assert!(!custom.join(AUTH_FILE).exists());

            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let src_ino = fs::metadata(&auth_src).unwrap().ino();
                let snap_ino = fs::metadata(official.join(AUTH_FILE)).unwrap().ino();
                assert_ne!(src_ino, snap_ino);
                let canon_cfg = fs::metadata(canonical.join("config.toml")).unwrap();
                let snap_cfg = fs::metadata(official.join("config.toml")).unwrap();
                assert_ne!(canon_cfg.ino(), snap_cfg.ino());
                assert_eq!(snap_cfg.nlink(), 1);
                let mode = fs::metadata(official.join(AUTH_FILE)).unwrap().mode() & 0o777;
                assert_eq!(mode, 0o600);
            }
        });
    }

    #[test]
    fn discard_removes_the_snapshot_and_keeps_canonical_sessions() {
        with_app_home(|root| {
            let canonical = canonical_with_config(&root);
            let auth_src = root.join("cli-auth.json");
            fs::write(&auth_src, b"token").unwrap();
            let official = create_from(&canonical, false, Some(&auth_src)).unwrap();
            let marker = canonical.join("sessions").join("keep.txt");

            discard(&official);
            assert!(!official.exists());
            assert_eq!(fs::read(&marker).unwrap(), b"session");

            discard(&canonical);
            assert!(canonical.exists());
            assert_eq!(fs::read(&marker).unwrap(), b"session");
        });
    }

    #[test]
    fn hooks_are_a_real_tree_and_hook_files_are_not_hardlinked() {
        with_app_home(|root| {
            let canonical = canonical_with_config(&root);
            let hook_src = root.join("hook-target.json");
            fs::write(&hook_src, b"{\"event\":\"Stop\"}\n").unwrap();
            let hooks = canonical.join("hooks");
            fs::create_dir_all(hooks.join("nested")).unwrap();
            // Canonical itself may use a symlink and a hard link. The sealed
            // home must not preserve either: the sandbox rejects both.
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(&hook_src, hooks.join("linked.json")).unwrap();
            }
            #[cfg(not(unix))]
            {
                fs::write(hooks.join("linked.json"), b"{\"event\":\"Stop\"}\n").unwrap();
            }
            fs::hard_link(&hook_src, hooks.join("nested").join("aliased.json")).unwrap();
            fs::write(canonical.join("hooks-paths"), b"/tmp/hooks-extra\n").unwrap();

            let sealed = create_from(&canonical, true, None).unwrap();
            let sealed_hooks = sealed.join("hooks");
            let hook_meta = fs::symlink_metadata(&sealed_hooks).unwrap();
            assert!(hook_meta.is_dir());
            assert!(
                !hook_meta.file_type().is_symlink(),
                "sealed hooks must be a real directory"
            );
            let linked = sealed_hooks.join("linked.json");
            let linked_meta = fs::symlink_metadata(&linked).unwrap();
            assert!(linked_meta.is_file());
            assert!(!linked_meta.file_type().is_symlink());
            assert_eq!(fs::read(&linked).unwrap(), b"{\"event\":\"Stop\"}\n");
            let aliased = sealed_hooks.join("nested").join("aliased.json");
            assert!(fs::symlink_metadata(&aliased).unwrap().is_file());
            assert_eq!(fs::read(&aliased).unwrap(), b"{\"event\":\"Stop\"}\n");
            assert_eq!(
                fs::read(sealed.join("hooks-paths")).unwrap(),
                b"/tmp/hooks-extra\n"
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                assert_eq!(fs::metadata(&aliased).unwrap().nlink(), 1);
                assert_ne!(
                    fs::metadata(&hook_src).unwrap().ino(),
                    fs::metadata(&aliased).unwrap().ino()
                );
                assert_eq!(fs::metadata(sealed.join("hooks-paths")).unwrap().nlink(), 1);
                assert_ne!(
                    fs::metadata(canonical.join("hooks-paths")).unwrap().ino(),
                    fs::metadata(sealed.join("hooks-paths")).unwrap().ino()
                );
                // sessions stay shared
                assert_eq!(
                    fs::metadata(canonical.join("sessions")).unwrap().ino(),
                    fs::metadata(sealed.join("sessions")).unwrap().ino()
                );
            }
        });
    }

    #[test]
    fn bundled_is_a_real_tree_and_config_is_not_hardlinked() {
        with_app_home(|root| {
            let canonical = canonical_with_config(&root);
            let bundled_src = root.join("bundled-src");
            fs::create_dir(&bundled_src).unwrap();
            fs::write(bundled_src.join("skill.md"), b"bundled-skill\n").unwrap();
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(&bundled_src, canonical.join("bundled")).unwrap();
            }
            #[cfg(not(unix))]
            {
                let bundled = canonical.join("bundled");
                fs::create_dir(&bundled).unwrap();
                fs::write(bundled.join("skill.md"), b"bundled-skill\n").unwrap();
            }

            let sealed = create_from(&canonical, true, None).unwrap();
            let sealed_bundled = sealed.join("bundled");
            let bundled_meta = fs::symlink_metadata(&sealed_bundled).unwrap();
            assert!(bundled_meta.is_dir());
            assert!(
                !bundled_meta.file_type().is_symlink(),
                "sealed bundled must be a real directory"
            );
            let skill = sealed_bundled.join("skill.md");
            let skill_meta = fs::symlink_metadata(&skill).unwrap();
            assert!(skill_meta.is_file());
            assert!(!skill_meta.file_type().is_symlink());
            assert_eq!(fs::read(&skill).unwrap(), b"bundled-skill\n");

            let sealed_config = sealed.join("config.toml");
            assert_eq!(
                fs::read(&sealed_config).unwrap(),
                fs::read(canonical.join("config.toml")).unwrap()
            );
            fs::write(&sealed_config, b"sealed-only\n").unwrap();
            assert_eq!(
                fs::read(canonical.join("config.toml")).unwrap(),
                b"default = \"grok\"\n",
                "canonical config must stay a separate file"
            );

            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                assert_eq!(fs::metadata(&skill).unwrap().nlink(), 1);
                assert_ne!(
                    fs::metadata(bundled_src.join("skill.md")).unwrap().ino(),
                    fs::metadata(&skill).unwrap().ino()
                );
                assert_eq!(fs::metadata(&sealed_config).unwrap().nlink(), 1);
                assert_ne!(
                    fs::metadata(canonical.join("config.toml")).unwrap().ino(),
                    fs::metadata(&sealed_config).unwrap().ino()
                );
                assert_eq!(
                    fs::metadata(canonical.join("sessions")).unwrap().ino(),
                    fs::metadata(sealed.join("sessions")).unwrap().ino()
                );
            }
        });
    }

    #[test]
    fn sweep_drops_orphans_only() {
        with_app_home(|root| {
            let canonical = canonical_with_config(&root);
            let auth_src = root.join("cli-auth.json");
            fs::write(&auth_src, b"token").unwrap();
            let first = create_from(&canonical, false, Some(&auth_src)).unwrap();
            let second = create_from(&canonical, true, Some(&auth_src)).unwrap();
            sweep_orphans();
            assert!(!first.exists());
            assert!(!second.exists());
            assert!(canonical.join("sessions").join("keep.txt").is_file());
        });
    }
}
