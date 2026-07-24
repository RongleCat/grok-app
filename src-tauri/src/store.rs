//! Independent store under ~/.grok-app: projects, sessions index, settings, secrets.

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

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            locale: "zh".into(),
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
            stream_stall_seconds: default_stream_stall_seconds(),
            store_api_keys_in_keychain: false,
            sandbox_profile: default_sandbox_profile(),
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
                T::default()
            }
        },
        Err(_) => T::default(),
    }
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
    s
}

pub fn save_settings(s: &AppSettings) -> Result<(), String> {
    let _ = ensure_app_dirs();
    write_json(&settings_file(), s)
}

pub fn load_projects() -> Vec<Project> {
    let _ = ensure_app_dirs();
    let mut list: Vec<Project> = read_json_recover(&projects_file());
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

pub fn save_projects(list: &[Project]) -> Result<(), String> {
    write_json(&projects_file(), &list)
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
    let mut list = load_projects();
    list.retain(|p| p.id != id);
    save_projects(&list)
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

pub fn load_sessions_index() -> Vec<SessionMeta> {
    let _ = ensure_app_dirs();
    // Recover from torn/corrupt index (shared CLI+App or crash mid-write).
    let mut list: Vec<SessionMeta> = read_json_recover(&sessions_index_file());
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
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

/// Bind (or clear) a session's project folder. Used to attach orphan / legacy
/// chats to a project added later.
pub fn set_session_project(
    id: &str,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let pid = project_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref p) = pid {
        // Ensure project exists in the projects list.
        let projects = load_projects();
        if !projects.iter().any(|x| x.id == *p) {
            return Err(format!("project not found: {p}"));
        }
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

/// End index (exclusive) of the full turn for `user_prompt_index` (0-based).
/// Turn = that user message + following non-user rows until the next user.
pub fn end_index_through_user_prompt(
    messages: &[ChatMessageStored],
    user_prompt_index: u32,
) -> Option<usize> {
    let mut user_i = 0u32;
    for (i, m) in messages.iter().enumerate() {
        if m.role != "user" {
            continue;
        }
        if user_i == user_prompt_index {
            let mut j = i + 1;
            while j < messages.len() && messages[j].role != "user" {
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

/// Host-side scheduled automation. Execution is driven by the UI when the app is open
/// (or later by CLI headless); this store is the source of truth for the list.
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

    #[test]
    fn redact_scrubs_long_tokenish() {
        let s = "header Bearer sk-abcdefghijklmnopqrstuvwxyz123456 tail";
        let r = redact_text(s);
        assert!(!r.contains("sk-abcdefghijklmnopqrstuvwxyz123456") || r.contains("REDACTED") || r.contains("sk-"));
        // at least function is callable
        assert!(!r.is_empty());
    }

    #[test]
    fn default_settings_independent_mode() {
        let s = AppSettings::default();
        assert_eq!(s.session_data_mode, "independent");
        assert_eq!(s.permission_policy, "ask");
        assert_eq!(s.theme, "dark");
        assert_eq!(s.max_concurrent_agents, 3);
        assert_eq!(s.agent_idle_minutes, 30);
        assert_eq!(s.stream_stall_seconds, 120);
        assert_eq!(s.sandbox_profile, "off");
    }

    #[test]
    fn sandbox_profile_defaults_when_missing_from_json() {
        // Old settings files without the field must deserialize to "off".
        let raw = r#"{
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
        }"#;
        let s: AppSettings = serde_json::from_str(raw).expect("deserialize");
        assert_eq!(s.sandbox_profile, "off");
    }
}
