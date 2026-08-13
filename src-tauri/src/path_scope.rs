//! Unified path allowlist for absolute filesystem access.
//!
//! Used by loopback media HTTP / legacy `media://` (SEC-01) and
//! `fs_read_absolute` / `fs_write_absolute` (SEC-09).
//! Only trusted project roots, the App data root, system temp, and explicitly
//! granted one-off paths may be read/written.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::RwLock;

fn roots() -> &'static RwLock<Vec<PathBuf>> {
    static R: OnceLock<RwLock<Vec<PathBuf>>> = OnceLock::new();
    R.get_or_init(|| RwLock::new(Vec::new()))
}

fn extra_grants() -> &'static RwLock<Vec<PathBuf>> {
    static G: OnceLock<RwLock<Vec<PathBuf>>> = OnceLock::new();
    G.get_or_init(|| RwLock::new(Vec::new()))
}

/// Rebuild allowlisted roots from the project store + app data + temp.
/// Call on startup and whenever projects are added / removed / relocated / trusted.
pub fn refresh_from_store() {
    let mut next: Vec<PathBuf> = crate::store::load_projects()
        .into_iter()
        .filter(|p| p.trusted)
        .filter_map(|p| PathBuf::from(p.path).canonicalize().ok())
        .collect();

    if let Ok(app) = crate::paths::app_data_root().canonicalize() {
        next.push(app);
    } else {
        // Dir may not exist yet — still allow the logical root.
        next.push(crate::paths::app_data_root());
    }

    if let Ok(tmp) = std::env::temp_dir().canonicalize() {
        next.push(tmp);
    } else {
        next.push(std::env::temp_dir());
    }

    // Agent session media (`images/`, `videos/`) lives under GROK_HOME.
    // Independent mode is already under app_data; shared mode is `~/.grok` and
    // must be listed so chat image/video cards can load via media HTTP.
    let settings = crate::store::load_settings();
    let agent_home = crate::paths::resolve_agent_grok_home(&settings.session_data_mode);
    if let Ok(c) = agent_home.canonicalize() {
        next.push(c);
    } else {
        next.push(agent_home);
    }

    // CLI default home (`~/.grok`): marketplace-cache logos + installed-plugins
    // assets for Settings → Extensions cards (may differ from independent agent-home).
    let user_grok = crate::process_util::user_home().join(".grok");
    if let Ok(c) = user_grok.canonicalize() {
        next.push(c);
    } else {
        next.push(user_grok);
    }

    // Dedup while preserving order.
    let mut seen = std::collections::HashSet::new();
    next.retain(|p| seen.insert(p.clone()));

    *roots().write() = next;
}

/// Grant a one-off absolute path (e.g. user-picked file outside projects).
///
/// Files are granted **exactly** — never the parent directory. Granting the
/// parent used to let loopback media serve siblings (e.g. `~/.ssh/id_rsa`
/// classified from journal history also unlocked `id_rsa.pub`). Re-reads of
/// the same file still work because `is_allowed` treats the grant as a root
/// that matches that path.
pub fn grant_path(path: &Path) {
    let grant = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut g = extra_grants().write();
    if !g.iter().any(|x| x == &grant) {
        g.push(grant);
        // Cap grants so a long-running process cannot grow unbounded.
        const MAX_GRANTS: usize = 256;
        if g.len() > MAX_GRANTS {
            let drain = g.len() - MAX_GRANTS;
            g.drain(0..drain);
        }
    }
}

/// True when `path` sits under an allowed root (after canonicalize when possible).
pub fn is_allowed(path: &Path) -> bool {
    let candidate = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    is_allowed_canonical(&candidate)
}

fn is_allowed_canonical(path: &Path) -> bool {
    if roots().read().is_empty() {
        // Lazy init on first check (tests / early calls before setup).
        refresh_from_store();
    }
    let under_root = roots().read().iter().any(|r| path_under_root(path, r));
    if under_root {
        return true;
    }
    extra_grants()
        .read()
        .iter()
        .any(|r| path_under_root(path, r))
}

fn path_under_root(path: &Path, root: &Path) -> bool {
    if path == root {
        return true;
    }
    // Use component-wise prefix so `/foo` does not match `/foobar`.
    let mut path_comps = path.components();
    for rc in root.components() {
        match path_comps.next() {
            Some(pc) if pc == rc => {}
            _ => return false,
        }
    }
    true
}

/// Canonicalize + allowlist gate. Returns the canonical path on success.
pub fn require_allowed(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    if !is_allowed_canonical(&canonical) {
        tracing::warn!(
            path = %canonical.display(),
            "path_scope: denied absolute path outside allowlisted roots"
        );
        return Err("path not allowed: outside trusted project or app data roots".into());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn with_isolated_roots(project: &Path, app: &Path, include_temp: bool, f: impl FnOnce()) {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", app);
        let _ = fs::create_dir_all(app);
        let _ = fs::create_dir_all(project);
        let projects_file = app.join("projects.json");
        let _ = fs::write(&projects_file, "[]");
        // Install a deterministic root set (optional temp) so tests do not depend on the
        // real machine project list or always-on temp allow.
        let mut next = Vec::new();
        if let Ok(c) = project.canonicalize() {
            next.push(c);
        }
        if let Ok(c) = app.canonicalize() {
            next.push(c);
        } else {
            next.push(app.to_path_buf());
        }
        if include_temp {
            if let Ok(c) = std::env::temp_dir().canonicalize() {
                next.push(c);
            }
        }
        *roots().write() = next;
        *extra_grants().write() = Vec::new();
        f();
        *extra_grants().write() = Vec::new();
        *roots().write() = Vec::new();
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
    }

    #[test]
    fn allows_path_under_project() {
        let tmp = std::env::temp_dir().join(format!("grok-scope-{}", std::process::id()));
        let project = tmp.join("proj");
        let app = tmp.join("app");
        let _ = fs::create_dir_all(&project);
        let file = project.join("readme.md");
        fs::write(&file, "hi").unwrap();
        with_isolated_roots(&project, &app, false, || {
            assert!(is_allowed(&file));
            assert!(require_allowed(&file).is_ok());
        });
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn denies_path_outside_roots() {
        let tmp = std::env::temp_dir().join(format!("grok-scope-out-{}", std::process::id()));
        let project = tmp.join("proj");
        let app = tmp.join("app");
        let _ = fs::create_dir_all(&project);
        let _ = fs::create_dir_all(tmp.join("other"));
        let outside = tmp.join("other").join("secret.txt");
        fs::write(&outside, "secret").unwrap();
        // No global temp root — sibling of project must be denied.
        with_isolated_roots(&project, &app, false, || {
            assert!(!is_allowed(&outside));
            assert!(require_allowed(&outside).is_err());
        });
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn grant_path_allows_one_off() {
        let tmp = std::env::temp_dir().join(format!("grok-scope-grant-{}", std::process::id()));
        let project = tmp.join("proj");
        let app = tmp.join("app");
        let other = tmp.join("picked");
        let _ = fs::create_dir_all(&project);
        let _ = fs::create_dir_all(&other);
        let file = other.join("picked.md");
        fs::write(&file, "x").unwrap();
        with_isolated_roots(&project, &app, false, || {
            assert!(!is_allowed(&file));
            grant_path(&file);
            assert!(is_allowed(&file));
            let sibling = other.join("secret.key");
            fs::write(&sibling, "no").unwrap();
            assert!(
                !is_allowed(&sibling),
                "granting a file must not unlock siblings in the parent dir"
            );
        });
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn prefix_does_not_match_sibling_name() {
        // /foo should not allow /foobar
        let foo = PathBuf::from("/foo");
        let foobar = PathBuf::from("/foobar/x");
        assert!(!path_under_root(&foobar, &foo));
        assert!(path_under_root(Path::new("/foo/bar"), &foo));
    }
}
