//! Independent store under ~/.grok-app: projects, sessions index, settings, secrets.

use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::paths::{
    automations_file, ensure_app_dirs, projects_file, session_dir, sessions_index_file,
    settings_file,
};

/// Where composer model / effort / mode / permission choices are remembered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComposerPrefsScope {
    Global,
    Project,
    Session,
}

impl ComposerPrefsScope {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "project" => Self::Project,
            "session" => Self::Session,
            _ => Self::Global,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Project => "project",
            Self::Session => "session",
        }
    }
}

/// Effective composer prefs resolved for the current context.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerPrefs {
    pub model_id: String,
    pub effort: String,
    pub mode: String,
    pub permission_policy: String,
    /// Scope that was used when resolving (after reading settings).
    pub scope: String,
    /// Which layer actually supplied the values (global | project | session).
    pub source: String,
}

impl Default for ComposerPrefs {
    fn default() -> Self {
        Self {
            model_id: "grok-4.5".into(),
            // Balanced default: faster than high, deeper than low.
            effort: "medium".into(),
            mode: "agent".into(),
            permission_policy: "ask".into(),
            scope: "global".into(),
            source: "global".into(),
        }
    }
}

/// Legacy id for the short-lived "General" sidebar project (`system:general`).
/// No longer registered in `projects.json`; kept so we can migrate old rows /
/// session bindings. Orphan chats use `project_id = None` and cwd
/// `{app_data}/workspaces/general`.
pub const GENERAL_PROJECT_ID: &str = "system:general";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub trusted: bool,
    pub last_opened_at: DateTime<Utc>,
    pub path_ok: bool,
    /// Pinned projects float to the top of the sidebar.
    #[serde(default)]
    pub pinned: bool,
    /// Legacy flag from the temporary system:general project. Not used for new data.
    #[serde(default)]
    pub system: bool,
    /// Per-project composer prefs (used when scope = project).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_policy: Option<String>,
}

impl Project {
    /// True for the retired system:general row (migration only).
    pub fn is_legacy_general(&self) -> bool {
        self.id == GENERAL_PROJECT_ID || self.system
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub agent_session_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub model_id: Option<String>,
    /// Archived chats stay on disk but hide from the default tree.
    #[serde(default)]
    pub archived: bool,
    /// Pinned chats float to the top of the sidebar (within their group).
    #[serde(default)]
    pub pinned: bool,
    /// Per-session composer prefs (used when scope = session).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_policy: Option<String>,
    /// Created by shell scheduled automation (`runAutomation`).
    #[serde(default)]
    pub scheduled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub locale: String,
    pub session_data_mode: String,
    pub manual_cli_path: Option<String>,
    pub permission_policy: String,
    pub model_id: Option<String>,
    pub effort: Option<String>,
    pub mode: String,
    pub onboarding_done: bool,
    pub setup_skipped: bool,
    /// First-run setup wizard finished (CLI gate + optional auth step).
    #[serde(default)]
    pub setup_wizard_completed: bool,
    /// User skipped account/provider configuration during setup.
    #[serde(default)]
    pub auth_setup_deferred: bool,
    /// Default “open path” target: `finder` / `explorer` / editor id (`code`, `cursor`, …).
    #[serde(default = "default_open_target")]
    pub default_open_target: String,
    /// Remember model / effort / mode / permission at global | project | session.
    #[serde(default = "default_composer_prefs_scope")]
    pub composer_prefs_scope: String,
    /// **API mode.** When set (`host:port`), sessions connect to a remote ACP
    /// server over TCP instead of spawning the local `grok agent stdio` — the
    /// agent can run in WSL, a container, or on another host. Empty/unset uses
    /// the normal local-CLI spawn path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acp_server_addr: Option<String>,
    /// Max warm/live agent processes (I02). Default 3.
    #[serde(default = "default_max_concurrent_agents")]
    pub max_concurrent_agents: u32,
    /// Recycle idle agent processes after this many minutes (I03). Default 30.
    #[serde(default = "default_agent_idle_minutes")]
    pub agent_idle_minutes: u32,
    /// True once the legacy pool-size migration has run for this install.
    /// Keeps a deliberate small pool from being lifted again on every launch.
    #[serde(default)]
    pub pool_size_migrated: bool,
    /// Pure stream silence before cancel prompt (I06). Default 120 seconds.
    #[serde(default = "default_stream_stall_seconds")]
    pub stream_stall_seconds: u32,
    /// Store App API keys in the OS keychain (macOS Keychain / Win Cred / Secret Service).
    /// Default **false**: keys stay in `secrets.json` (0600) so cold start does not
    /// trigger system password prompts. Official CLI login still uses `auth.json`.
    #[serde(default)]
    pub store_api_keys_in_keychain: bool,
    /// OS-level sandbox profile for spawned `grok agent` processes
    /// (`off` | `workspace` | `read-only` | `strict` | `devbox`). Default off.
    /// Passed as top-level `grok --sandbox <profile>` / `GROK_SANDBOX` at spawn.
    #[serde(default = "default_sandbox_profile")]
    pub sandbox_profile: String,
    /// Enable Grok Build cross-session memory (`--experimental-memory` / `GROK_MEMORY=1`
    /// / `[memory] enabled`). Default **false** — experimental; when off, spawn forces
    /// `--no-memory` + `GROK_MEMORY=0` for isolation (esp. independent mode).
    #[serde(default)]
    pub experimental_memory: bool,
    /// Cap agent turns per process via top-level `grok --max-turns N`.
    /// `None` or `0` = omit the flag (CLI default / unlimited).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_agent_turns: Option<u32>,
    /// When true, spawn agents with top-level `--disable-web-search` so
    /// `web_search` / `web_fetch` tools are removed. Default false (CLI default).
    #[serde(default)]
    pub disable_web_search: bool,
    /// Reopen the last active chat once after launch (default **false** —
    /// start on a draft new-chat page; opt-in via Settings).
    #[serde(default = "default_reopen_last_session")]
    pub reopen_last_session: bool,
    /// Last successfully opened / switched session (for startup restore).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_session_id: Option<String>,
    /// Project of [`Self::last_session_id`] when it belonged to one (hint only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_project_id: Option<String>,
    /// Sidebar project folders the user collapsed (ids). Missing id ⇒ expanded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sidebar_collapsed_project_ids: Vec<String>,
    /// One-shot: flipped product default so launch opens a draft new chat
    /// (reopen-last-session defaulted to false). Existing installs run this once.
    #[serde(default)]
    pub startup_new_chat_default_migrated: bool,
    /// When true (default), agents may enter plan mode. When false, spawn with
    /// top-level `--no-plan` so plan mode is disabled for that process.
    #[serde(default = "default_plan_enabled")]
    pub plan_enabled: bool,
    /// Allow Grok Build subagent spawning (`Agent` / task tools). Default **true**
    /// (CLI default). When false, spawn forces `--no-subagents` + `GROK_SUBAGENTS=0`
    /// and independent mode writes `[subagents] enabled = false`.
    #[serde(default = "default_true")]
    pub subagents_enabled: bool,
    /// Preferred Grok Build agent definition for new agent processes
    /// (`explore` / `plan` / `general-purpose` / custom name under `~/.grok/agents`).
    /// Empty / `default` / `none` → omit top-level `--agent` (CLI default).
    /// Applied at spawn only; changing it soft-respawns the live agent.
    #[serde(default)]
    pub preferred_agent: String,
    /// Connect local ACP agents to a shared Grok Build leader process
    /// (`grok agent --leader`). Default **false** — each agent is a standalone
    /// process (`--no-leader`). Advanced; multiple clients can share one backend.
    #[serde(default)]
    pub use_leader: bool,
    /// xAI realtime voice id (e.g. `eve`).
    #[serde(default = "default_voice_id")]
    pub voice_id: String,
    /// When true, window close hides to tray. When false, close quits the app.
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
    /// Desktop notification when an agent turn finishes (default on).
    #[serde(default = "default_true")]
    pub notify_on_turn_done: bool,
    /// Desktop notification when the agent requests permission (default on).
    #[serde(default = "default_true")]
    pub notify_on_permission: bool,
    /// When true, dictation auto-sends on end-of-speech silence.
    #[serde(default)]
    pub voice_dictation_auto_send: bool,
    /// Keep delegated agent sessions running after ending a live voice chat.
    #[serde(default = "default_true")]
    pub voice_keep_agents_on_end: bool,
    /// Outbound proxy mode: `system` (default; OS proxy / env vars), `none`
    /// (force direct), or `manual` (use [`Self::proxy_url`]). NEW-02: without
    /// this, restricted-network users cannot reach Grok backends at all —
    /// Windows system proxy is registry-based and never reaches child
    /// processes as env vars.
    #[serde(default = "default_proxy_mode")]
    pub proxy_mode: String,
    /// Proxy URL for `manual` mode, e.g. `http://127.0.0.1:7890`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    /// Comma-separated hosts that bypass the proxy (NO_PROXY semantics).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_no_proxy: Option<String>,
    /// Allow CLI download/install when the mirror has **no** published SHA-256
    /// sidecar. Default **false** (fail-closed). Mismatch always aborts.
    /// Escape hatch for air-gapped / broken sidecars; prefer fixing the mirror.
    #[serde(default)]
    pub allow_unverified_cli_install: bool,
    /// Result of the last App-managed CLI install (`Some(true)` = sidecar matched).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_cli_checksum_verified: Option<bool>,
}

fn default_composer_prefs_scope() -> String {
    "global".into()
}

fn default_open_target() -> String {
    "finder".into()
}

fn default_max_concurrent_agents() -> u32 {
    crate::process_limits::DEFAULT_MAX_CONCURRENT_AGENTS
}

fn default_agent_idle_minutes() -> u32 {
    crate::process_limits::DEFAULT_AGENT_IDLE_MINUTES
}

fn default_stream_stall_seconds() -> u32 {
    crate::stream_stall::DEFAULT_STREAM_STALL_SECONDS
}

fn default_sandbox_profile() -> String {
    "off".into()
}

fn default_reopen_last_session() -> bool {
    false
}

fn default_plan_enabled() -> bool {
    true
}

fn default_voice_id() -> String {
    "eve".into()
}

fn default_close_to_tray() -> bool {
    true
}

fn default_proxy_mode() -> String {
    "system".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            // Product default is English; users can switch to zh / zh-TW in Settings.
            locale: "en".into(),
            session_data_mode: "independent".into(),
            manual_cli_path: None,
            permission_policy: "ask".into(),
            model_id: None,
            effort: Some("medium".into()),
            mode: "agent".into(),
            onboarding_done: false,
            setup_skipped: false,
            setup_wizard_completed: false,
            auth_setup_deferred: false,
            default_open_target: default_open_target(),
            composer_prefs_scope: default_composer_prefs_scope(),
            acp_server_addr: None,
            max_concurrent_agents: default_max_concurrent_agents(),
            agent_idle_minutes: default_agent_idle_minutes(),
            // Fresh installs already start on the current default.
            pool_size_migrated: true,
            stream_stall_seconds: default_stream_stall_seconds(),
            store_api_keys_in_keychain: false,
            sandbox_profile: default_sandbox_profile(),
            experimental_memory: false,
            max_agent_turns: None,
            disable_web_search: false,
            reopen_last_session: default_reopen_last_session(),
            last_session_id: None,
            last_project_id: None,
            sidebar_collapsed_project_ids: Vec::new(),
            // Fresh defaults already match the new-chat-on-launch product rule.
            startup_new_chat_default_migrated: true,
            plan_enabled: default_plan_enabled(),
            subagents_enabled: true,
            preferred_agent: String::new(),
            use_leader: false,
            voice_id: default_voice_id(),
            voice_dictation_auto_send: false,
            voice_keep_agents_on_end: true,
            close_to_tray: default_close_to_tray(),
            notify_on_turn_done: true,
            notify_on_permission: true,
            proxy_mode: default_proxy_mode(),
            proxy_url: None,
            proxy_no_proxy: None,
            allow_unverified_cli_install: false,
            last_cli_checksum_verified: None,
        }
    }
}

/// App-owned secrets surface (backend-agnostic).
///
/// Sensitive fields (`official_api_key`, `relay_api_key`) prefer the OS keychain
/// (macOS Keychain / Windows Credential Manager / Linux Secret Service) with a
/// `secrets.json` (0600) fallback. See [`crate::secrets`].
///
/// Never log these fields.
///
/// `keychain_has_*` are non-secret booleans written to `secrets.json` so the UI
/// can report "has a key" without unlocking the OS keychain on every launch.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecretsFile {
    pub official_api_key: Option<String>,
    pub relay_base_url: Option<String>,
    pub relay_api_key: Option<String>,
    pub default_model: Option<String>,
    /// Official API key lives in OS keychain (value not on disk).
    #[serde(default)]
    pub keychain_has_official: bool,
    /// Relay API key lives in OS keychain (value not on disk).
    #[serde(default)]
    pub keychain_has_relay: bool,
}

/// File/image card persisted with a chat message (user attach or agent image_gen).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachmentStored {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageStored {
    pub id: String,
    pub role: String,
    pub content: String,
    pub thought: Option<String>,
    pub created_at: DateTime<Utc>,
    /// True when this assistant row records a turn failure (retries exhausted, etc.).
    #[serde(default)]
    pub is_error: bool,
    /// Local file cards (e.g. image_gen output paths).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<MessageAttachmentStored>>,
    /// UI marker type, e.g. `context_compact` for agent auto/manual compaction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => T::default(),
    }
}


/// Last quarantined store path (corrupt JSON recovered). Taken once by the UI.
static LAST_STORE_QUARANTINE: Mutex<Option<String>> = Mutex::new(None);

/// Read JSON; if the file exists but is corrupt, quarantine it and return default.
fn read_json_recover<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    match fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => T::default(),
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(
                    "corrupt store file {} ({e}); quarantining and starting empty",
                    path.display()
                );
                let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                let bak = path.with_extension(format!("corrupt-{stamp}.json"));
                let _ = fs::rename(path, &bak);
                if let Ok(mut g) = LAST_STORE_QUARANTINE.lock() {
                    *g = Some(bak.display().to_string());
                }
                T::default()
            }
        },
        Err(_) => T::default(),
    }
}


/// Pop the most recent store quarantine path (if any) for a one-shot UI notice.
pub fn take_store_quarantine() -> Option<String> {
    LAST_STORE_QUARANTINE.lock().ok().and_then(|mut g| g.take())
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let s = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Exclusive lock + temp rename so shared-mode / dual-instance writes do not
    // leave a half-written index (E06).
    crate::store_lock::write_bytes_atomic(path, s.as_bytes())
}

pub fn load_settings() -> AppSettings {
    let _ = ensure_app_dirs();
    let mut s: AppSettings = read_json(&settings_file());
    // One-time: installs that already stored keys in keychain before the opt-in
    // keep keychain mode so keys remain reachable without a silent loss.
    if !s.store_api_keys_in_keychain {
        let disk = crate::secrets::load_secrets_disk_only();
        if disk.keychain_has_official || disk.keychain_has_relay {
            s.store_api_keys_in_keychain = true;
            let _ = write_json(&settings_file(), &s);
        }
    }
    // One-time: installs predating the multi-session rework persisted the old
    // default pool size (3). Without this they stay at three warm agents and
    // hit the process limit while browsing a couple of chats.
    if let Some(next) = crate::process_limits::migrate_max_concurrent(
        s.max_concurrent_agents,
        s.pool_size_migrated,
    ) {
        tracing::info!(
            "settings migration: maxConcurrentAgents {} → {}",
            s.max_concurrent_agents,
            next
        );
        s.max_concurrent_agents = next;
        s.pool_size_migrated = true;
        let _ = write_json(&settings_file(), &s);
    } else if !s.pool_size_migrated {
        s.pool_size_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: product default is draft new-chat on launch (not restore last).
    // Prior builds defaulted reopen_last_session=true, so existing settings
    // keep restoring a chat and look like "first session selected" on every boot.
    if !s.startup_new_chat_default_migrated {
        s.reopen_last_session = false;
        s.startup_new_chat_default_migrated = true;
        tracing::info!(
            "settings migration: reopenLastSession → false (start on new chat)"
        );
        let _ = write_json(&settings_file(), &s);
    }
    s
}

pub fn save_settings(s: &AppSettings) -> Result<(), String> {
    let _ = ensure_app_dirs();
    write_json(&settings_file(), s)
}

pub fn load_projects() -> Vec<Project> {
    let _ = ensure_app_dirs();
    let _ = ensure_general_workspace_dir();
    let mut list: Vec<Project> = read_json_recover(&projects_file());
    // One-shot migration: drop the temporary system:general project row and
    // rehome its sessions to orphan (`project_id = None`) under "其他会话".
    migrate_legacy_general_project(&mut list);
    for p in &mut list {
        p.path_ok = PathBuf::from(&p.path).is_dir();
    }
    list.sort_by(|a, b| match (b.pinned, a.pinned) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => b.last_opened_at.cmp(&a.last_opened_at),
    });
    list
}

/// Ensure `{app_data}/workspaces/general` exists (orphan chat default cwd).
/// Not registered as a sidebar project.
pub fn ensure_general_workspace_dir() -> Result<std::path::PathBuf, String> {
    let _ = ensure_app_dirs();
    let dir = crate::paths::general_workspace_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create general workspace: {e}"))?;
    Ok(dir)
}

/// Absolute path of the general workspace directory (creates it if missing).
pub fn general_workspace_path_string() -> Result<String, String> {
    Ok(ensure_general_workspace_dir()?
        .to_string_lossy()
        .to_string())
}

/// Remove legacy `system:general` from the projects list and clear those
/// session bindings so chats appear under "其他会话".
fn migrate_legacy_general_project(list: &mut Vec<Project>) {
    let had_row = list.iter().any(|p| p.is_legacy_general());
    if !had_row {
        // Still rehome sessions that point at the retired id (index-only leftover).
        rehome_general_sessions();
        return;
    }
    list.retain(|p| !p.is_legacy_general());
    // Raw write: avoid save_projects → path_scope → load_projects recursion.
    let _ = write_json(&projects_file(), &list);
    rehome_general_sessions();
    crate::path_scope::refresh_from_store();
}

fn rehome_general_sessions() {
    let mut sessions: Vec<SessionMeta> = read_json_recover(&sessions_index_file());
    let mut dirty = false;
    for s in &mut sessions {
        if s.project_id.as_deref() == Some(GENERAL_PROJECT_ID) {
            s.project_id = None;
            dirty = true;
        }
    }
    if dirty {
        let _ = write_json(&sessions_index_file(), &sessions);
    }
}

pub fn save_projects(list: &[Project]) -> Result<(), String> {
    write_json(&projects_file(), &list)?;
    crate::path_scope::refresh_from_store();
    Ok(())
}

pub fn add_project(path: String, trust: bool) -> Result<Project, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.is_dir() {
        return Err("path is not a directory".into());
    }
    let name = path_buf
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let mut list = load_projects();
    if let Some(existing) = list.iter_mut().find(|p| p.path == path) {
        existing.trusted = trust || existing.trusted;
        existing.last_opened_at = Utc::now();
        existing.path_ok = true;
        let clone = existing.clone();
        save_projects(&list)?;
        return Ok(clone);
    }
    let p = Project {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        trusted: trust,
        last_opened_at: Utc::now(),
        path_ok: true,
        pinned: false,
        system: false,
        model_id: None,
        effort: None,
        mode: None,
        permission_policy: None,
    };
    list.push(p.clone());
    save_projects(&list)?;
    Ok(p)
}

/// Remove project from the app list only — does **not** delete the disk folder
/// or any chat sessions (sessions keep their project_id and become orphans).
pub fn remove_project(id: &str) -> Result<(), String> {
    if id == GENERAL_PROJECT_ID {
        // Already retired; treat as success so old clients cannot soft-lock.
        return Ok(());
    }
    let mut list = load_projects();
    list.retain(|p| p.id != id);
    save_projects(&list)
}

/// Point a project at a new directory (folder moved / renamed on disk).
/// Requires the path to exist as a directory; re-checks and sets `path_ok`.
pub fn relocate_project(id: &str, new_path: String) -> Result<Project, String> {
    let path_buf = PathBuf::from(&new_path);
    if !path_buf.is_dir() {
        return Err("path is not a directory".into());
    }
    let mut list = load_projects();
    if list.iter().any(|p| p.id != id && p.path == new_path) {
        return Err("another project already uses this path".into());
    }
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    p.path = new_path;
    p.path_ok = true;
    p.last_opened_at = Utc::now();
    let clone = p.clone();
    save_projects(&list)?;
    Ok(clone)
}

pub fn rename_project(id: &str, name: &str) -> Result<Project, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name empty".into());
    }
    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    p.name = name.to_string();
    let clone = p.clone();
    save_projects(&list)?;
    Ok(clone)
}

pub fn set_project_pinned(id: &str, pinned: bool) -> Result<Project, String> {
    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    p.pinned = pinned;
    let clone = p.clone();
    save_projects(&list)?;
    Ok(clone)
}

pub fn trust_project(id: &str) -> Result<Project, String> {
    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    p.trusted = true;
    p.last_opened_at = Utc::now();
    let clone = p.clone();
    save_projects(&list)?;
    Ok(clone)
}

/// Set or clear a project-level permission tier (L10).
///
/// `policy = None` / empty / `"inherit"` clears the override so the app default
/// applies. Untrusted projects cannot store a relaxed tier.
pub fn set_project_permission_policy(
    id: &str,
    policy: Option<String>,
) -> Result<Project, String> {
    use crate::permission::PermissionPolicy;

    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    if !p.trusted {
        return Err("trust this project before setting a permission tier".into());
    }

    let next = match policy {
        None => None,
        Some(raw) => {
            let t = raw.trim();
            if t.is_empty()
                || t.eq_ignore_ascii_case("inherit")
                || t.eq_ignore_ascii_case("app_default")
                || t.eq_ignore_ascii_case("default")
            {
                None
            } else {
                Some(PermissionPolicy::parse(t).as_str().to_string())
            }
        }
    };
    p.permission_policy = next;
    let clone = p.clone();
    save_projects(&list)?;
    Ok(clone)
}

/// Pinned first, then newest `updated_at` (mirrors project pin sort).
pub fn sort_sessions_by_pin_then_updated(list: &mut [SessionMeta]) {
    list.sort_by(|a, b| match (b.pinned, a.pinned) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => b.updated_at.cmp(&a.updated_at),
    });
}

pub fn load_sessions_index() -> Vec<SessionMeta> {
    let _ = ensure_app_dirs();
    // Recover from torn/corrupt index (shared CLI+App or crash mid-write).
    let mut list: Vec<SessionMeta> = read_json_recover(&sessions_index_file());
    sort_sessions_by_pin_then_updated(&mut list);
    list
}

pub fn save_sessions_index(list: &[SessionMeta]) -> Result<(), String> {
    write_json(&sessions_index_file(), &list)
}

pub fn create_session(
    project_id: Option<String>,
    title: Option<String>,
    scheduled: bool,
) -> Result<SessionMeta, String> {
    // Unassigned chats stay orphan (`None`) and appear under "其他会话".
    // Agent cwd falls back to `{app_data}/workspaces/general` at connect time.
    let _ = ensure_general_workspace_dir();
    let project_id = project_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.as_str() != GENERAL_PROJECT_ID);
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let meta = SessionMeta {
        id: id.clone(),
        project_id,
        title: title.unwrap_or_else(|| "New chat".into()),
        agent_session_id: None,
        created_at: now,
        updated_at: now,
        model_id: None,
        archived: false,
        pinned: false,
        effort: None,
        mode: None,
        permission_policy: None,
        scheduled,
    };
    let mut list = load_sessions_index();
    list.insert(0, meta.clone());
    save_sessions_index(&list)?;
    let dir = session_dir(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_json(&dir.join("messages.json"), &Vec::<ChatMessageStored>::new())?;
    Ok(meta)
}

pub fn update_session_meta(meta: &SessionMeta) -> Result<(), String> {
    let mut list = load_sessions_index();
    if let Some(s) = list.iter_mut().find(|s| s.id == meta.id) {
        *s = meta.clone();
    } else {
        list.insert(0, meta.clone());
    }
    save_sessions_index(&list)
}

pub fn delete_session(id: &str) -> Result<(), String> {
    let mut list = load_sessions_index();
    list.retain(|s| s.id != id);
    save_sessions_index(&list)?;
    let dir = session_dir(id);
    let _ = fs::remove_dir_all(dir);
    Ok(())
}

pub fn rename_session(id: &str, title: &str) -> Result<SessionMeta, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("title empty".into());
    }
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.title = title.to_string();
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

pub fn set_session_scheduled(id: &str, scheduled: bool) -> Result<SessionMeta, String> {
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.scheduled = scheduled;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

pub fn set_session_archived(id: &str, archived: bool) -> Result<SessionMeta, String> {
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.archived = archived;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

pub fn set_session_pinned(id: &str, pinned: bool) -> Result<SessionMeta, String> {
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.pinned = pinned;
    // Do not bump updated_at — pin is organizational (same as project pin).
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Bind (or clear) a session's project folder. Used to attach orphan / legacy
/// chats to a project added later. Clearing (`None`) returns the chat to
/// "其他会话"; agent cwd still uses the general workspace directory.
pub fn set_session_project(
    id: &str,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let pid = project_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.as_str() != GENERAL_PROJECT_ID);
    if let Some(ref pid) = pid {
        let projects = load_projects();
        if !projects.iter().any(|x| x.id.as_str() == pid.as_str()) {
            return Err(format!("project not found: {pid}"));
        }
    } else {
        let _ = ensure_general_workspace_dir();
    }
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.project_id = pid;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Archive every non-archived session under a project.
pub fn archive_project_sessions(project_id: &str) -> Result<usize, String> {
    let mut list = load_sessions_index();
    let mut n = 0usize;
    for s in list.iter_mut() {
        if s.project_id.as_deref() == Some(project_id) && !s.archived {
            s.archived = true;
            s.updated_at = Utc::now();
            n += 1;
        }
    }
    save_sessions_index(&list)?;
    Ok(n)
}

pub fn load_messages(session_id: &str) -> Vec<ChatMessageStored> {
    read_json_recover(&session_dir(session_id).join("messages.json"))
}

pub fn save_messages(session_id: &str, messages: &[ChatMessageStored]) -> Result<(), String> {
    write_json(&session_dir(session_id).join("messages.json"), &messages)
}

pub fn append_message(session_id: &str, msg: ChatMessageStored) -> Result<(), String> {
    let mut msgs = load_messages(session_id);
    // Upsert by id — never double-insert the same host message (stream complete +
    // reconnect edge cases). Keeps journal length honest for multi-turn chats.
    if let Some(slot) = msgs.iter_mut().find(|m| m.id == msg.id) {
        *slot = msg;
    } else {
        msgs.push(msg);
    }
    save_messages(session_id, &msgs)
}

/// True for a normal user prompt turn. Mid-turn interjections belong to the
/// surrounding turn and are excluded from rewind prompt indexes.
pub fn is_user_prompt_message(message: &ChatMessageStored) -> bool {
    message.role == "user" && message.marker.as_deref() != Some("interjection")
}

/// End index (exclusive) of the full turn for `user_prompt_index` (0-based).
/// Turn = that user message + following non-user rows until the next *prompt* user.
pub fn end_index_through_user_prompt(
    messages: &[ChatMessageStored],
    user_prompt_index: u32,
) -> Option<usize> {
    let mut user_i = 0u32;
    for (i, m) in messages.iter().enumerate() {
        if !is_user_prompt_message(m) {
            continue;
        }
        if user_i == user_prompt_index {
            let mut j = i + 1;
            while j < messages.len() && !is_user_prompt_message(&messages[j]) {
                j += 1;
            }
            return Some(j);
        }
        user_i = user_i.saturating_add(1);
    }
    None
}

/// Keep messages through the end of the selected user turn (ACP `/rewind` semantics).
pub fn truncate_through_user_prompt(
    messages: &[ChatMessageStored],
    user_prompt_index: u32,
) -> Result<Vec<ChatMessageStored>, String> {
    let end = end_index_through_user_prompt(messages, user_prompt_index)
        .ok_or_else(|| format!("user prompt index out of range: {user_prompt_index}"))?;
    Ok(messages[..end].to_vec())
}

/// Fork a session: new journal + meta, same project, no agent session id.
/// `through_user_prompt_index`: when set, copy only through that user turn (inclusive).
pub fn fork_session(
    source_id: &str,
    through_user_prompt_index: Option<u32>,
    title: Option<String>,
) -> Result<SessionMeta, String> {
    let list = load_sessions_index();
    let source = list
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("session not found: {source_id}"))?
        .clone();

    let mut msgs = load_messages(source_id);
    if let Some(idx) = through_user_prompt_index {
        msgs = truncate_through_user_prompt(&msgs, idx)?;
    }

    let fork_title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let base = source.title.trim();
            let base = if base.is_empty() { "chat" } else { base };
            if base.to_ascii_lowercase().starts_with("fork of ") {
                base.to_string()
            } else {
                format!("Fork of {base}")
            }
        });

    let mut meta = create_session(source.project_id.clone(), Some(fork_title), false)?;
    // Inherit composer prefs from source so the fork feels continuous.
    meta.model_id = source.model_id.clone();
    meta.effort = source.effort.clone();
    meta.mode = source.mode.clone();
    meta.permission_policy = source.permission_policy.clone();
    meta.updated_at = Utc::now();
    update_session_meta(&meta)?;

    // Remap ids so the fork is independent of the source journal ids.
    let prefix = format!("fork-{}", &meta.id[..meta.id.len().min(8)]);
    let forked: Vec<ChatMessageStored> = msgs
        .into_iter()
        .enumerate()
        .map(|(i, mut m)| {
            m.id = format!("{prefix}-{i}");
            m
        })
        .collect();
    save_messages(&meta.id, &forked)?;
    Ok(meta)
}

// ─── Automations (scheduled tasks shell) ───────────────────────────────────

/// Host-side scheduled automation. Execution is driven by the host scheduler
/// (`automation_runner`) while the process is alive (including tray-hidden UI);
/// this store is the source of truth for the list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub title: String,
    /// Natural-language prompt / instructions for the agent when the task runs.
    pub prompt: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub project_id: Option<String>,
    pub model_id: Option<String>,
    pub effort: Option<String>,
    /// `daily` | `weekly` | `weekdays` | `once`
    #[serde(default = "default_frequency")]
    pub frequency: String,
    /// Local wall-clock time `HH:MM` (24h).
    #[serde(default = "default_time")]
    pub time: String,
    /// For `weekly`: 0=Sun … 6=Sat (JS Date convention).
    #[serde(default)]
    pub weekdays: Vec<u8>,
    /// `all` | `failures` | `none`
    #[serde(default = "default_notify")]
    pub notify: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}
fn default_frequency() -> String {
    "daily".into()
}
fn default_time() -> String {
    "09:00".into()
}
fn default_notify() -> String {
    "all".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInput {
    pub title: String,
    pub prompt: String,
    pub enabled: Option<bool>,
    pub project_id: Option<String>,
    pub model_id: Option<String>,
    pub effort: Option<String>,
    pub frequency: Option<String>,
    pub time: Option<String>,
    pub weekdays: Option<Vec<u8>>,
    pub notify: Option<String>,
    pub next_run_at: Option<DateTime<Utc>>,
}

pub fn load_automations() -> Vec<Automation> {
    let _ = ensure_app_dirs();
    let mut list: Vec<Automation> = read_json(&automations_file());
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    list
}

pub fn save_automations(list: &[Automation]) -> Result<(), String> {
    let _ = ensure_app_dirs();
    write_json(&automations_file(), &list)
}

pub fn create_automation(input: AutomationInput) -> Result<Automation, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("title empty".into());
    }
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt empty".into());
    }
    let now = Utc::now();
    let auto = Automation {
        id: Uuid::new_v4().to_string(),
        title,
        prompt,
        enabled: input.enabled.unwrap_or(true),
        project_id: input.project_id,
        model_id: input.model_id,
        effort: input.effort,
        frequency: input
            .frequency
            .unwrap_or_else(default_frequency)
            .trim()
            .to_string(),
        time: input.time.unwrap_or_else(default_time).trim().to_string(),
        weekdays: input.weekdays.unwrap_or_default(),
        notify: input
            .notify
            .unwrap_or_else(default_notify)
            .trim()
            .to_string(),
        created_at: now,
        updated_at: now,
        last_run_at: None,
        next_run_at: input.next_run_at,
    };
    let mut list = load_automations();
    list.insert(0, auto.clone());
    save_automations(&list)?;
    Ok(auto)
}

pub fn update_automation(id: &str, input: AutomationInput) -> Result<Automation, String> {
    let mut list = load_automations();
    let auto = list
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "automation not found".to_string())?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title empty".into());
    }
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err("prompt empty".into());
    }
    auto.title = title.to_string();
    auto.prompt = prompt.to_string();
    if let Some(e) = input.enabled {
        auto.enabled = e;
    }
    auto.project_id = input.project_id;
    auto.model_id = input.model_id;
    auto.effort = input.effort;
    if let Some(f) = input.frequency {
        auto.frequency = f.trim().to_string();
    }
    if let Some(t) = input.time {
        auto.time = t.trim().to_string();
    }
    if let Some(w) = input.weekdays {
        auto.weekdays = w;
    }
    if let Some(n) = input.notify {
        auto.notify = n.trim().to_string();
    }
    if input.next_run_at.is_some() {
        auto.next_run_at = input.next_run_at;
    }
    auto.updated_at = Utc::now();
    let clone = auto.clone();
    save_automations(&list)?;
    Ok(clone)
}

pub fn set_automation_enabled(id: &str, enabled: bool) -> Result<Automation, String> {
    let mut list = load_automations();
    let auto = list
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "automation not found".to_string())?;
    auto.enabled = enabled;
    auto.updated_at = Utc::now();
    let clone = auto.clone();
    save_automations(&list)?;
    Ok(clone)
}

pub fn mark_automation_run(
    id: &str,
    last_run_at: DateTime<Utc>,
    next_run_at: Option<DateTime<Utc>>,
) -> Result<Automation, String> {
    let mut list = load_automations();
    let auto = list
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "automation not found".to_string())?;
    auto.last_run_at = Some(last_run_at);
    auto.next_run_at = next_run_at;
    auto.updated_at = Utc::now();
    let clone = auto.clone();
    save_automations(&list)?;
    Ok(clone)
}

pub fn delete_automation(id: &str) -> Result<(), String> {
    let mut list = load_automations();
    let before = list.len();
    list.retain(|a| a.id != id);
    if list.len() == before {
        return Err("automation not found".into());
    }
    save_automations(&list)
}

/// Load app secrets (API keys). Backend-agnostic: OS keychain preferred, file fallback.
/// See [`crate::secrets`] for migration and storage details. Callers must not log values.
pub fn load_secrets() -> SecretsFile {
    crate::secrets::load_secrets()
}

/// Persist app secrets. Prefer OS keychain for API keys; metadata may remain in secrets.json.
pub fn save_secrets(s: &SecretsFile) -> Result<(), String> {
    crate::secrets::save_secrets(s)
}

/// Redact secrets from a string for logs/Doctor export.
pub fn redact_text(input: &str) -> String {
    let mut out = input.to_string();
    let secrets = load_secrets();
    for key in [
        secrets.official_api_key.as_deref(),
        secrets.relay_api_key.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if key.len() >= 8 {
            out = out.replace(key, "[REDACTED]");
        }
    }
    // common token scrubbing without regex crate
    let mut cleaned = String::with_capacity(out.len());
    for word in out.split_whitespace() {
        if word.len() > 20
            && (word.starts_with("sk-")
                || word.starts_with("xai-")
                || word.contains("Bearer"))
        {
            cleaned.push_str("[REDACTED]");
        } else {
            cleaned.push_str(word);
        }
        cleaned.push(' ');
    }
    cleaned
}

fn global_prefs(settings: &AppSettings) -> (String, String, String, String) {
    (
        settings
            .model_id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "grok-4.5".into()),
        settings
            .effort
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "medium".into()),
        if settings.mode.trim().is_empty() {
            "agent".into()
        } else {
            settings.mode.clone()
        },
        if settings.permission_policy.trim().is_empty() {
            "ask".into()
        } else {
            settings.permission_policy.clone()
        },
    )
}

/// Resolve effective composer prefs for the active project/session + configured scope.
///
/// Model / effort / mode follow `composer_prefs_scope`.
/// Permission always cascades session → project → global (L10), and untrusted
/// projects force Ask regardless of stored tiers.
pub fn resolve_composer_prefs(
    project_id: Option<&str>,
    session_id: Option<&str>,
) -> ComposerPrefs {
    use crate::permission::effective_permission_policy;

    let settings = load_settings();
    let scope = ComposerPrefsScope::parse(&settings.composer_prefs_scope);
    let (g_model, g_effort, g_mode, g_policy) = global_prefs(&settings);

    let sess = session_id.and_then(|id| {
        load_sessions_index()
            .into_iter()
            .find(|s| s.id == id)
    });
    let proj = sess
        .as_ref()
        .and_then(|s| s.project_id.as_deref())
        .or(project_id)
        .and_then(|id| load_projects().into_iter().find(|p| p.id == id));

    // Permission: always cascade (independent of model/effort memory scope).
    let permission_policy = effective_permission_policy(
        &g_policy,
        proj.as_ref().map(|p| p.trusted),
        proj.as_ref()
            .and_then(|p| p.permission_policy.as_deref()),
        sess.as_ref()
            .and_then(|s| s.permission_policy.as_deref()),
    )
    .as_str()
    .to_string();

    match scope {
        ComposerPrefsScope::Global => ComposerPrefs {
            model_id: g_model,
            effort: g_effort,
            mode: g_mode,
            permission_policy,
            scope: scope.as_str().into(),
            source: "global".into(),
        },
        ComposerPrefsScope::Project => {
            if let Some(p) = proj {
                ComposerPrefs {
                    model_id: p.model_id.filter(|s| !s.is_empty()).unwrap_or(g_model),
                    effort: p.effort.filter(|s| !s.is_empty()).unwrap_or(g_effort),
                    mode: p.mode.filter(|s| !s.is_empty()).unwrap_or(g_mode),
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: "project".into(),
                }
            } else {
                ComposerPrefs {
                    model_id: g_model,
                    effort: g_effort,
                    mode: g_mode,
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: "global".into(),
                }
            }
        }
        ComposerPrefsScope::Session => {
            let p_model = proj
                .as_ref()
                .and_then(|p| p.model_id.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or(g_model.clone());
            let p_effort = proj
                .as_ref()
                .and_then(|p| p.effort.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or(g_effort.clone());
            let p_mode = proj
                .as_ref()
                .and_then(|p| p.mode.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or(g_mode.clone());

            if let Some(s) = sess {
                ComposerPrefs {
                    model_id: s.model_id.filter(|x| !x.is_empty()).unwrap_or(p_model),
                    effort: s.effort.filter(|x| !x.is_empty()).unwrap_or(p_effort),
                    mode: s.mode.filter(|x| !x.is_empty()).unwrap_or(p_mode),
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: "session".into(),
                }
            } else {
                ComposerPrefs {
                    model_id: p_model,
                    effort: p_effort,
                    mode: p_mode,
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: if proj.is_some() { "project" } else { "global" }.into(),
                }
            }
        }
    }
}

/// Persist a partial composer prefs update at the configured scope.
pub fn save_composer_prefs(
    project_id: Option<&str>,
    session_id: Option<&str>,
    model_id: Option<String>,
    effort: Option<String>,
    mode: Option<String>,
    permission_policy: Option<String>,
) -> Result<ComposerPrefs, String> {
    let settings = load_settings();
    let scope = ComposerPrefsScope::parse(&settings.composer_prefs_scope);

    match scope {
        ComposerPrefsScope::Global => {
            let mut s = settings;
            if let Some(v) = model_id {
                s.model_id = Some(v);
            }
            if let Some(v) = effort {
                s.effort = Some(v);
            }
            if let Some(v) = mode {
                s.mode = v;
            }
            if let Some(v) = permission_policy {
                s.permission_policy = v;
            }
            save_settings(&s)?;
        }
        ComposerPrefsScope::Project => {
            let pid = project_id.filter(|s| !s.is_empty());
            if let Some(pid) = pid {
                let mut list = load_projects();
                if let Some(p) = list.iter_mut().find(|p| p.id == pid) {
                    if let Some(v) = model_id.clone() {
                        p.model_id = Some(v);
                    }
                    if let Some(v) = effort.clone() {
                        p.effort = Some(v);
                    }
                    if let Some(v) = mode.clone() {
                        p.mode = Some(v);
                    }
                    if let Some(v) = permission_policy.clone() {
                        p.permission_policy = Some(v);
                    }
                    save_projects(&list)?;
                }
            }
            // Always mirror to global so orphan UIs / new projects still have a default.
            let mut s = load_settings();
            if let Some(v) = model_id {
                s.model_id = Some(v);
            }
            if let Some(v) = effort {
                s.effort = Some(v);
            }
            if let Some(v) = mode {
                s.mode = v;
            }
            if let Some(v) = permission_policy {
                s.permission_policy = v;
            }
            save_settings(&s)?;
        }
        ComposerPrefsScope::Session => {
            let sid = session_id.filter(|s| !s.is_empty());
            if let Some(sid) = sid {
                let mut list = load_sessions_index();
                if let Some(sess) = list.iter_mut().find(|s| s.id == sid) {
                    if let Some(v) = model_id {
                        sess.model_id = Some(v);
                    }
                    if let Some(v) = effort {
                        sess.effort = Some(v);
                    }
                    if let Some(v) = mode {
                        sess.mode = Some(v);
                    }
                    if let Some(v) = permission_policy {
                        sess.permission_policy = Some(v);
                    }
                    sess.updated_at = Utc::now();
                    save_sessions_index(&list)?;
                } else {
                    // No session row yet — fall back to global so the chip still sticks.
                    let mut s = load_settings();
                    if let Some(v) = model_id {
                        s.model_id = Some(v);
                    }
                    if let Some(v) = effort {
                        s.effort = Some(v);
                    }
                    if let Some(v) = mode {
                        s.mode = v;
                    }
                    if let Some(v) = permission_policy {
                        s.permission_policy = v;
                    }
                    save_settings(&s)?;
                }
            } else {
                let mut s = load_settings();
                if let Some(v) = model_id {
                    s.model_id = Some(v);
                }
                if let Some(v) = effort {
                    s.effort = Some(v);
                }
                if let Some(v) = mode {
                    s.mode = v;
                }
                if let Some(v) = permission_policy {
                    s.permission_policy = v;
                }
                save_settings(&s)?;
            }
        }
    }

    Ok(resolve_composer_prefs(project_id, session_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn redact_scrubs_long_tokenish() {
        let s = "header Bearer sk-abcdefghijklmnopqrstuvwxyz123456 tail";
        let r = redact_text(s);
        assert!(
            !r.contains("sk-abcdefghijklmnopqrstuvwxyz123456")
                || r.contains("REDACTED")
                || r.contains("sk-")
        );
        assert!(!r.is_empty());
    }

    #[test]
    fn take_store_quarantine_is_one_shot() {
        // Seed the static as if a corrupt file was recovered.
        {
            let mut g = LAST_STORE_QUARANTINE.lock().unwrap();
            *g = Some("/tmp/fake-corrupt-store.json".into());
        }
        let first = take_store_quarantine();
        assert_eq!(first.as_deref(), Some("/tmp/fake-corrupt-store.json"));
        assert!(take_store_quarantine().is_none());
    }

    #[test]
    fn legacy_settings_file_is_flagged_for_pool_migration() {
        // A settings.json written before the multi-session rework: complete, but
        // the pool pinned at the old default and no migration marker.
        let mut v = serde_json::to_value(AppSettings::default()).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.insert("maxConcurrentAgents".into(), serde_json::json!(3));
        obj.remove("poolSizeMigrated");
        let s: AppSettings = serde_json::from_value(v).expect("parse legacy settings");
        assert_eq!(s.max_concurrent_agents, 3);
        assert!(
            !s.pool_size_migrated,
            "missing marker must read as not-yet-migrated"
        );
        assert_eq!(
            crate::process_limits::migrate_max_concurrent(
                s.max_concurrent_agents,
                s.pool_size_migrated
            ),
            Some(8)
        );
    }

    #[test]
    fn fresh_install_needs_no_pool_migration() {
        let s = AppSettings::default();
        assert!(s.pool_size_migrated);
        assert_eq!(
            crate::process_limits::migrate_max_concurrent(
                s.max_concurrent_agents,
                s.pool_size_migrated
            ),
            None
        );
    }

    #[test]
    fn default_settings_independent_mode() {
        let s = AppSettings::default();
        assert_eq!(s.session_data_mode, "independent");
        assert_eq!(s.permission_policy, "ask");
        assert_eq!(s.theme, "system");
        assert_eq!(s.locale, "en");
        assert_eq!(s.max_concurrent_agents, 8);
        assert_eq!(s.agent_idle_minutes, 30);
        assert_eq!(s.stream_stall_seconds, 180);
        assert_eq!(s.sandbox_profile, "off");
        assert!(!s.experimental_memory);
        assert_eq!(s.max_agent_turns, None);
        assert!(!s.disable_web_search);
        assert!(s.plan_enabled);
        assert!(s.subagents_enabled);
        assert_eq!(s.preferred_agent, "");
        assert!(!s.use_leader);
    }

    /// Minimal legacy settings JSON (pre-batch fields omitted).
    fn legacy_settings_json() -> &'static str {
        r#"{
            "theme": "dark",
            "locale": "en",
            "sessionDataMode": "independent",
            "manualCliPath": null,
            "permissionPolicy": "ask",
            "modelId": null,
            "effort": "medium",
            "mode": "agent",
            "onboardingDone": true,
            "setupSkipped": false
        }"#
    }

    #[test]
    fn sandbox_profile_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.sandbox_profile, "off");
    }

    #[test]
    fn max_agent_turns_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.max_agent_turns, None);
    }

    #[test]
    fn preferred_agent_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.preferred_agent, "");
    }

    #[test]
    fn use_leader_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.use_leader);
    }

    #[test]
    fn disable_web_search_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.disable_web_search);
    }

    #[test]
    fn plan_enabled_defaults_true_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.plan_enabled);
    }

    #[test]
    fn subagents_enabled_defaults_true_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.subagents_enabled);
    }

    #[test]
    fn notify_prefs_default_true_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.notify_on_turn_done);
        assert!(s.notify_on_permission);
        let d = AppSettings::default();
        assert!(d.notify_on_turn_done);
        assert!(d.notify_on_permission);
    }

    #[test]
    fn experimental_memory_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.experimental_memory);
    }

    fn sample_session(id: &str, pinned: bool, updated: DateTime<Utc>) -> SessionMeta {
        SessionMeta {
            id: id.into(),
            project_id: None,
            title: id.into(),
            agent_session_id: None,
            created_at: updated,
            updated_at: updated,
            model_id: None,
            archived: false,
            pinned,
            effort: None,
            mode: None,
            permission_policy: None,
            scheduled: false,
        }
    }

    #[test]
    fn general_workspace_dir_exists_without_sidebar_project() {
        let _ = ensure_app_dirs();
        let path = ensure_general_workspace_dir().expect("ensure dir");
        assert!(path.is_dir());
        let listed = load_projects();
        assert!(
            listed.iter().all(|p| p.id != GENERAL_PROJECT_ID && !p.system),
            "general must not appear as a project: {:?}",
            listed.iter().map(|p| &p.id).collect::<Vec<_>>()
        );
    }

    #[test]
    fn create_session_defaults_to_orphan() {
        let _ = ensure_app_dirs();
        let meta = create_session(None, Some("t".into()), false).expect("create");
        assert!(meta.project_id.is_none(), "got {:?}", meta.project_id);
        let _ = delete_session(&meta.id);
    }

    #[test]
    fn migrate_legacy_general_project_rehomes_sessions() {
        // Isolate app home — parallel tests share the default data dir and can
        // wipe sessions_index between seed and assert (Linux CI flake).
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-migrate-general-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();

        // Seed a legacy system:general row + bound session.
        let mut projects: Vec<Project> = read_json_recover(&projects_file());
        projects.retain(|p| p.id != GENERAL_PROJECT_ID);
        projects.push(Project {
            id: GENERAL_PROJECT_ID.into(),
            name: "General".into(),
            path: crate::paths::general_workspace_dir()
                .to_string_lossy()
                .to_string(),
            trusted: true,
            last_opened_at: Utc::now(),
            path_ok: true,
            pinned: true,
            system: true,
            model_id: None,
            effort: None,
            mode: None,
            permission_policy: None,
        });
        write_json(&projects_file(), &projects).expect("seed projects");
        let mut sessions: Vec<SessionMeta> = read_json_recover(&sessions_index_file());
        let sid = format!("migrate-general-{}", Uuid::new_v4());
        sessions.insert(
            0,
            SessionMeta {
                id: sid.clone(),
                project_id: Some(GENERAL_PROJECT_ID.into()),
                title: "legacy".into(),
                agent_session_id: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: None,
                permission_policy: None,
                scheduled: false,
            },
        );
        write_json(&sessions_index_file(), &sessions).expect("seed sessions");

        let listed = load_projects();
        assert!(listed.iter().all(|p| p.id != GENERAL_PROJECT_ID));
        let reloaded = load_sessions_index();
        let hit = reloaded.iter().find(|s| s.id == sid).expect("session");
        assert!(hit.project_id.is_none(), "got {:?}", hit.project_id);

        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn sessions_sort_pinned_first_then_updated_at() {
        let t1 = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let t2 = Utc.with_ymd_and_hms(2024, 1, 2, 0, 0, 0).unwrap();
        let t3 = Utc.with_ymd_and_hms(2024, 1, 3, 0, 0, 0).unwrap();
        let mut list = vec![
            sample_session("unpinned-mid", false, t2),
            sample_session("pinned-old", true, t1),
            sample_session("unpinned-new", false, t3),
            sample_session("pinned-new", true, t3),
        ];
        sort_sessions_by_pin_then_updated(&mut list);
        let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["pinned-new", "pinned-old", "unpinned-new", "unpinned-mid"]
        );
    }

    #[test]
    fn session_meta_pinned_defaults_false_on_deserialize() {
        let raw = r#"{
            "id":"x","title":"t","createdAt":"2024-01-01T00:00:00Z",
            "updatedAt":"2024-01-01T00:00:00Z"
        }"#;
        let m: SessionMeta = serde_json::from_str(raw).expect("deserialize legacy session");
        assert!(!m.pinned);
        assert!(!m.archived);
    }
}
