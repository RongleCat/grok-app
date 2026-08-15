//! App data roots: UI store under app data (`~/.grok-app` / Win: %APPDATA%/grok-app).
//! Agent `GROK_HOME` defaults to shared CLI home (`~/.grok`); independent mode uses `agent-home`.

use std::fs;
use std::path::{Path, PathBuf};

use directories::ProjectDirs;

#[cfg(test)]
pub(crate) static APP_HOME_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn app_data_root() -> PathBuf {
    if let Ok(custom) = std::env::var("GROK_APP_HOME") {
        return PathBuf::from(custom);
    }
    if let Some(proj) = ProjectDirs::from("com", "grokapp", "grok-app") {
        return proj.data_dir().to_path_buf();
    }
    // Fallback
    dirs_fallback()
}

fn dirs_fallback() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("grok-app");
        }
    }
    crate::process_util::user_home().join(".grok-app")
}

pub fn ensure_app_dirs() -> std::io::Result<PathBuf> {
    let root = app_data_root();
    std::fs::create_dir_all(root.join("projects"))?;
    std::fs::create_dir_all(root.join("sessions"))?;
    std::fs::create_dir_all(root.join("logs"))?;
    // Agent profile (config.toml / optional auth) when session_data_mode=independent.
    std::fs::create_dir_all(root.join("agent-home"))?;
    // Clipboard paste / picker-written attachment files.
    std::fs::create_dir_all(root.join("attachments").join("paste"))?;
    // Multi-account auth snapshots.
    std::fs::create_dir_all(root.join("accounts"))?;
    // Default workspace for chats with no user-picked project (agent file I/O).
    std::fs::create_dir_all(general_workspace_dir())?;
    // Wallpaper library (X downloads + Imagine outputs).
    std::fs::create_dir_all(root.join("wallpapers").join("x"))?;
    std::fs::create_dir_all(root.join("wallpapers").join("imagine"))?;
    std::fs::create_dir_all(root.join("wallpapers").join("library"))?;
    // Chat video cover frames (ffmpeg / client canvas JPEG).
    std::fs::create_dir_all(root.join("cache").join("video-posters"))?;
    // Chat image thumbs (resized JPEG for virtual-list remounts).
    std::fs::create_dir_all(root.join("cache").join("image-thumbs"))?;
    // Appearance skin packs: local presets + inspect/upload staging.
    std::fs::create_dir_all(skin_staging_inspect_dir())?;
    std::fs::create_dir_all(skin_staging_upload_dir())?;
    std::fs::create_dir_all(skin_catalog_cache_dir())?;
    crate::skin_staging::gc_expired_staging();
    Ok(root)
}

/// `{app_data}/skin-presets` — local library + undo + staging.
pub fn skin_presets_dir() -> PathBuf {
    let dir = app_data_root().join("skin-presets");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// `{app_data}/skin-presets/.staging/inspect`
pub fn skin_staging_inspect_dir() -> PathBuf {
    let dir = skin_presets_dir().join(".staging").join("inspect");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// `{app_data}/skin-presets/.staging/upload`
pub fn skin_staging_upload_dir() -> PathBuf {
    let dir = skin_presets_dir().join(".staging").join("upload");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// `{app_data}/skin-catalog-cache`
pub fn skin_catalog_cache_dir() -> PathBuf {
    let dir = app_data_root().join("skin-catalog-cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Disk cache for chat video posters: `{app_data}/cache/video-posters`.
pub fn video_posters_dir() -> PathBuf {
    let dir = app_data_root().join("cache").join("video-posters");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Disk cache for chat image thumbs: `{app_data}/cache/image-thumbs`.
pub fn image_thumbs_dir() -> PathBuf {
    let dir = app_data_root().join("cache").join("image-thumbs");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Stable cwd for orphan / unassigned chats — under app data so agents can
/// create/edit files without binding a user folder.
///
/// `{app_data}/workspaces/general`
pub fn general_workspace_dir() -> PathBuf {
    app_data_root().join("workspaces").join("general")
}

/// Directory for pasted / saved composer attachments (absolute paths for `@path` refs).
pub fn attachments_paste_dir() -> PathBuf {
    let dir = app_data_root().join("attachments").join("paste");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// GROK_HOME for independent mode: App-owned agent profile (providers, config).
pub fn agent_home_dir() -> PathBuf {
    app_data_root().join("agent-home")
}

pub fn agent_config_toml() -> PathBuf {
    agent_home_dir().join("config.toml")
}

/// Resolve GROK_HOME for a spawned agent process.
pub fn resolve_agent_grok_home(session_data_mode: &str) -> PathBuf {
    if session_data_mode.trim().eq_ignore_ascii_case("shared") {
        return crate::process_util::user_home().join(".grok");
    }
    let _ = ensure_app_dirs();
    agent_home_dir()
}

/// Custom providers always live in App `agent-home/config.toml` (never written
/// into shared `~/.grok`). Spawn must point `GROK_HOME` there even when
/// `session_data_mode=shared` so third-party keys work without official login (#557).
pub fn resolve_inference_grok_home(session_data_mode: &str, custom_route: bool) -> PathBuf {
    if custom_route {
        let _ = ensure_app_dirs();
        return agent_home_dir();
    }
    resolve_agent_grok_home(session_data_mode)
}

/// Whether spawn prep must touch App agent-home (auth strip/sync, config heal).
///
/// - Independent mode always uses agent-home.
/// - Shared + official uses `~/.grok` and skips agent-home rewrites.
/// - Shared + custom still uses agent-home (relay `config.toml` + api_key).
pub fn needs_agent_home_spawn_prep(session_data_mode: &str, custom_route: bool) -> bool {
    custom_route || !session_data_mode.trim().eq_ignore_ascii_case("shared")
}

pub fn projects_file() -> PathBuf {
    app_data_root().join("projects.json")
}

pub fn sessions_index_file() -> PathBuf {
    app_data_root().join("sessions_index.json")
}

pub fn settings_file() -> PathBuf {
    app_data_root().join("settings.json")
}

/// On-disk secrets metadata (+ API-key fallback when OS keychain is unavailable).
/// Sensitive keys prefer the OS keychain; see [`crate::secrets`].
pub fn secrets_file() -> PathBuf {
    app_data_root().join("secrets.json")
}

pub fn session_dir(session_id: &str) -> PathBuf {
    app_data_root().join("sessions").join(session_id)
}

/// Host-side scheduled automations (shell list; execution via agent sessions).
pub fn automations_file() -> PathBuf {
    app_data_root().join("automations.json")
}

/// App MCP/Skills enable prefs (`extensions.json`).
pub fn extensions_file() -> PathBuf {
    app_data_root().join("extensions.json")
}

/// Percent-encode a path the way Grok Build names session folders under
/// `GROK_HOME/sessions/` (encodeURIComponent of the absolute cwd).
pub fn percent_encode_path_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    out
}

/// Locate the on-disk agent session directory for a given agent session id.
/// Layout: `{GROK_HOME}/sessions/{percent-encoded-cwd}/{agent_session_id}/`
///
/// `cwd_hint` (project path) avoids a directory scan when known.
pub fn find_agent_session_dir(
    agent_session_id: &str,
    cwd_hint: Option<&str>,
    session_data_mode: &str,
) -> Option<PathBuf> {
    if agent_session_id.is_empty() {
        return None;
    }
    let home = resolve_agent_grok_home(session_data_mode);
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return None;
    }

    if let Some(cwd) = cwd_hint.filter(|s| !s.is_empty()) {
        let encoded = percent_encode_path_component(cwd);
        let candidate = sessions.join(encoded).join(agent_session_id);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    // Fallback: scan cwd folders for this agent session id
    let Ok(entries) = fs::read_dir(&sessions) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let candidate = path.join(agent_session_id);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

/// Join agent session root + relative path like `images/1.jpg`.
/// Rejects `..` segments. Returns None if the resolved file is missing.
pub fn resolve_session_relative_media(session_root: &Path, relative: &str) -> Option<PathBuf> {
    let rel = relative.trim().trim_start_matches("./");
    if rel.is_empty() {
        return None;
    }
    if Path::new(rel).is_absolute() {
        return None;
    }
    let mut clean = PathBuf::new();
    for comp in Path::new(rel).components() {
        use std::path::Component;
        match comp {
            Component::Normal(s) => clean.push(s),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return None;
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return None;
    }
    let full = session_root.join(clean);
    if full.is_file() {
        Some(full)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_root_is_absolute_or_relative_path() {
        let p = app_data_root();
        assert!(!p.as_os_str().is_empty());
    }

    #[test]
    fn percent_encode_matches_encode_uri_component_style() {
        let cwd = "/Users/me/Downloads/5 天 course";
        let enc = percent_encode_path_component(cwd);
        assert!(enc.starts_with("%2FUsers%2Fme%2FDownloads%2F5%20"));
        assert!(enc.contains("%E5%A4%A9") || enc.contains("%"));
        assert!(!enc.contains('/'));
    }

    #[test]
    fn resolve_session_relative_rejects_parent() {
        let root = PathBuf::from("/tmp/session");
        assert!(resolve_session_relative_media(&root, "../etc/passwd").is_none());
        assert!(resolve_session_relative_media(&root, "/etc/passwd").is_none());
    }

    #[test]
    fn inference_home_custom_route_uses_agent_home_even_when_shared() {
        let shared_official = resolve_inference_grok_home("shared", false);
        assert!(
            shared_official.ends_with(".grok"),
            "shared+official → ~/.grok, got {}",
            shared_official.display()
        );

        let shared_custom = resolve_inference_grok_home("shared", true);
        assert!(
            shared_custom.ends_with("agent-home"),
            "shared+custom → agent-home, got {}",
            shared_custom.display()
        );

        let indep_custom = resolve_inference_grok_home("independent", true);
        assert!(
            indep_custom.ends_with("agent-home"),
            "independent+custom → agent-home, got {}",
            indep_custom.display()
        );

        let indep_official = resolve_inference_grok_home("independent", false);
        assert!(
            indep_official.ends_with("agent-home"),
            "independent+official → agent-home, got {}",
            indep_official.display()
        );
    }

    #[test]
    fn agent_home_spawn_prep_gate() {
        assert!(needs_agent_home_spawn_prep("shared", true));
        assert!(!needs_agent_home_spawn_prep("shared", false));
        assert!(needs_agent_home_spawn_prep("independent", false));
        assert!(needs_agent_home_spawn_prep("independent", true));
        assert!(!needs_agent_home_spawn_prep("Shared", false));
        assert!(needs_agent_home_spawn_prep("SHARED", true));
    }
}
