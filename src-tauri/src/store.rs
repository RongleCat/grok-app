//! Independent store under ~/.grok-app: projects, sessions index, settings, secrets.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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
            model_id: "grok-4.6".into(),
            // Grok 4.6 product default (Extra High).
            effort: "xhigh".into(),
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
    /// Per-project OS sandbox profile override (`off` / `workspace` / …).
    /// `None` → use app Settings `sandboxProfile`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_profile: Option<String>,
    /// Optional sidebar accent color: named token (`blue` / `green` / …) or `#rgb` / `#rrggbb`.
    /// `None` → no color accent (migration-safe default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
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
    /// Optional JSON Schema for structured model output (`grok --json-schema`).
    /// Empty / unset → no constraint. Validated on the client before save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json_schema: Option<String>,
    /// Created by shell scheduled automation (`runAutomation`).
    #[serde(default)]
    pub scheduled: bool,
    /// Absolute path of a linked git worktree this chat was opened against.
    /// Empty/missing on normal project sessions (migration-safe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    /// Branch name (no `refs/heads/`) when known for [`Self::worktree_path`].
    pub worktree_branch: Option<String>,
    /// Explicit worktree-bound chat flag. Default false for older index rows.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_worktree_session: bool,
    /// Session-only plugin directories passed as CLI `--plugin-dir` on spawn
    /// (repeatable). Does not change global Extensions / `~/.grok` plugins.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plugin_dirs: Vec<String>,
    /// Optional per-session extra rules appended via top-level `grok --rules`.
    /// Empty / unset → no flag. Soft-respawn reloads on change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_rules: Option<String>,
    /// Optional per-session `--max-turns` override (1–200).
    /// `None` / 0 → inherit global `AppSettings.max_agent_turns`. Soft-respawn on change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_agent_turns: Option<u32>,
    /// Optional per-session system prompt override via top-level
    /// `grok --system-prompt-override` (alias `--system-prompt`).
    /// Empty / unset → no flag. Soft-respawn reloads on change.
    /// Never log the full value (may contain secrets / PII).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt_override: Option<String>,
    /// One-shot CLI `--fork-session` semantics: on next connect, fork the agent
    /// session (ACP `session/fork`) so the chat gets a **new** agent session id
    /// with the source’s context instead of reusing via `session/load`.
    /// Requires `agent_session_id` as the source; cleared after connect attempt.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub fork_agent_session: bool,
    /// Optional per-session override for CLI top-level `--no-ask-user`
    /// (disables `ask_user_question` for the agent process; CLI ≥ 0.2.117).
    /// `None` → inherit global `AppSettings.no_ask_user`. Soft-respawn on change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_ask_user: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(default = "default_locale")]
    pub locale: String,
    /// One-shot: factory locale `en` → `system` so first-run follows OS language.
    /// Missing field deserializes as false so existing installs migrate once.
    #[serde(default)]
    pub locale_follow_system_migrated: bool,
    pub session_data_mode: String,
    pub manual_cli_path: Option<String>,
    /// CLI launch backend: `native` (default) or `wsl` (Windows only — spawn via `wsl.exe`).
    #[serde(default = "default_cli_backend")]
    pub cli_backend: String,
    /// Optional WSL distro name when `cli_backend == "wsl"`. Empty = default distro.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
    /// Path to `grok` **inside** WSL (e.g. `grok`, `~/.grok/bin/grok`). Empty = `grok` on WSL PATH.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_cli_path: Option<String>,
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
    /// Pure stream silence before Keep waiting / End turn (I06). Default 600s (10 min).
    #[serde(default = "default_stream_stall_seconds")]
    pub stream_stall_seconds: u32,
    /// True once the stream-stall default migration (120/180 → 600) has run.
    #[serde(default)]
    pub stream_stall_default_migrated: bool,
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
    /// Grok Build compaction mode (CLI 0.2.117+): `summary` | `transcript` | `segments`.
    /// Passed as top-level `--compaction-mode` / `GROK_COMPACTION_MODE` at spawn.
    /// Default `summary` (CLI default). Soft-respawns on change.
    #[serde(default = "default_compaction_mode")]
    pub compaction_mode: String,
    /// Segments verbatim detail (CLI 0.2.117+): `none` | `minimal` | `balanced` | `verbose`.
    /// Only affects `--compaction-mode segments`. Passed as `--compaction-detail` /
    /// `GROK_COMPACTION_DETAIL`. Default `verbose` (CLI default). Soft-respawns on change.
    #[serde(default = "default_compaction_detail")]
    pub compaction_detail: String,
    /// Prefire two-pass compaction (CLI **0.2.117+** config
    /// `two_pass_compaction_enabled` + env `GROK_TWO_PASS_COMPACTION`).
    /// Default **false** (opt-in). Independent mode writes the top-level agent-home
    /// key; spawn sets env (soft-fail when CLI is known older). Soft-respawns.
    #[serde(default)]
    pub two_pass_compaction_enabled: bool,
    /// Cap agent turns per process via top-level `grok --max-turns N`.
    /// `None` or `0` = omit the flag (CLI default / unlimited).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_agent_turns: Option<u32>,
    /// Headless background-wait policy after the first agent turn
    /// (`wait` | `no_wait` | `timeout`). CLI 0.2.117+; default `wait`
    /// (omit flags). Affects headless `-p` / automations-like paths;
    /// top-level flags are also passed on ACP spawn when the CLI is new
    /// enough (soft-fail older builds).
    #[serde(default = "default_background_wait_policy")]
    pub background_wait_policy: String,
    /// Seconds for `--background-wait-timeout` when policy is `timeout`.
    /// Clamped 1–3600; default 600 (CLI default when waiting).
    #[serde(default = "default_background_wait_timeout_sec")]
    pub background_wait_timeout_sec: u32,
    /// When true, headless paths that use `--output-format streaming-messages-json`
    /// also pass `--include-partial-messages` (CLI 0.2.117+) so incremental
    /// `stream_event` deltas are emitted. Default false. Soft-fails on older
    /// CLIs (flag omitted). Only valid with streaming-messages-json.
    #[serde(default)]
    pub include_partial_messages: bool,
    /// When true, spawn agents with top-level `--disable-web-search` so
    /// `web_search` / `web_fetch` tools are removed. Default false (CLI default).
    #[serde(default)]
    pub disable_web_search: bool,
    /// Inject MCP **official-aux** (isolated official auth) into **custom**
    /// main-route sessions only: `web_search`, all `x_*`, `vision_describe`.
    /// Default **true**. Never applies on official Grok subscription route.
    /// Grayed out in UI when no CLI login / official API key. Soft-respawns.
    #[serde(default = "default_true")]
    pub official_aux_inject: bool,
    /// When official-aux inject is on, also load the user's other MCP servers
    /// into the same session. Default **false** so flaky Playwright /
    /// open-websearch handshakes do not block official-aux tools for ~30s.
    #[serde(default)]
    pub official_aux_with_user_mcp: bool,
    /// When true, spawn agents with top-level `--no-ask-user` so the agent
    /// does not emit `ask_user_question` questionnaires (CLI ≥ 0.2.117).
    /// Default false (CLI default — agent may still ask). Soft-respawn on change.
    /// Per-session override: [`SessionMeta::no_ask_user`].
    #[serde(default)]
    pub no_ask_user: bool,
    /// Built-in tool ids to deny via top-level `grok --disallowed-tools a,b`.
    /// Default empty (CLI default — all tools available). Coexists with
    /// [`Self::disable_web_search`]; changing the list soft-respawns agents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disallowed_tools: Vec<String>,
    /// Built-in tool ids to allow via top-level `grok --tools a,b`.
    /// Default empty = omit flag (CLI default — all tools). When non-empty,
    /// restricts the agent to the listed tools. Coexists with
    /// [`Self::disallowed_tools`] (allowlist restricts; denylist still applies).
    /// Changing the list soft-respawns agents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_tools: Vec<String>,
    /// Enable CLI TodoGate (turn-end nudge when todos are still pending /
    /// in_progress). Default **false** (CLI built-in default). When true, spawn
    /// passes top-level `--todo-gate` (CLI 0.2.117+; overrides remote
    /// `todo_gate_enabled`). Independent mode also writes agent-home
    /// `todo_gate_enabled` / `todo_gate_max_fires_per_prompt`. Soft-respawns.
    #[serde(default)]
    pub todo_gate_enabled: bool,
    /// Cap TodoGate fires per prompt (1–20). Default 3. Written to independent
    /// agent-home config as `todo_gate_max_fires_per_prompt`. Soft-respawns.
    #[serde(default = "default_todo_gate_max_fires")]
    pub todo_gate_max_fires_per_prompt: u32,
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
    /// Sidebar “Other sessions” (orphan) section expanded. Default **true**
    /// (matches historical cold-start behavior). Missing field ⇒ open.
    #[serde(default = "default_true")]
    pub sidebar_other_sessions_open: bool,
    /// One-shot: flipped product default so launch opens a draft new chat
    /// (reopen-last-session defaulted to false). Existing installs run this once.
    #[serde(default)]
    pub startup_new_chat_default_migrated: bool,
    /// One-shot: product effort default medium → high (Grok Build 1.0 align).
    /// Missing field deserializes as false so existing installs migrate once.
    #[serde(default)]
    pub effort_default_migrated: bool,
    /// One-shot: product official default grok-4.5 → grok-4.6.
    /// Missing field deserializes as false so existing installs migrate once.
    #[serde(default)]
    pub official_model_default_migrated: bool,
    /// One-shot: official grok-4.6 product effort high → xhigh.
    #[serde(default)]
    pub official_effort_xhigh_migrated: bool,
    /// One-shot: lift stamped session/project `effort: high` rows to xhigh
    /// (the previous flag only migrated `settings.effort`).
    #[serde(default)]
    pub official_effort_xhigh_rows_migrated: bool,
    /// One-shot: product workflows default off → on (CLI ≥0.2.111 / 1.0 align).
    #[serde(default)]
    pub workflows_default_migrated: bool,
    /// When true (default), agents may enter plan mode. When false, spawn with
    /// top-level `--no-plan` so plan mode is disabled for that process.
    #[serde(default = "default_plan_enabled")]
    pub plan_enabled: bool,
    /// Allow Grok Build subagent spawning (`Agent` / task tools). Default **true**
    /// (CLI default). When false, spawn forces `--no-subagents` + `GROK_SUBAGENTS=0`
    /// and independent mode writes `[subagents] enabled = false`.
    #[serde(default = "default_true")]
    pub subagents_enabled: bool,
    /// Enable CLI subagent worktree snapshot (CLI **0.2.117+** config
    /// `subagent_worktree_snapshot_enabled` + env `GROK_SUBAGENT_WORKTREE_SNAPSHOT`).
    /// Default **false** (opt-in). Independent mode writes the top-level agent-home
    /// key; spawn sets env (soft-fail when CLI is known older). Soft-respawns.
    #[serde(default)]
    pub subagent_worktree_snapshot_enabled: bool,
    /// Enable CLI auto-wake (config `auto_wake_enabled`): when on, Grok Build may
    /// inject a synthetic turn after background work completes (bash / monitor /
    /// task / loop). Default **false** (opt-in; CLI default not documented).
    /// Independent mode writes the top-level agent-home key only (no invented env
    /// override — `GROK_AUTO_WAKE` is pattern-shaped). Soft-respawns so the next
    /// agent process reloads config. Older CLIs that ignore the key soft-fail.
    #[serde(default)]
    pub auto_wake_enabled: bool,
    /// Enable Grok Build workflows (`workflows_enabled` in agent-home config.toml).
    /// Default **true** (aligned with Grok Build CLI ≥0.2.111 / 1.0). Workflows are
    /// Rhai scripts under `~/.grok/workflows` / project `.grok/workflows` run by the
    /// CLI `workflow` tool. App lists names + headless smoke/run; no visual editor.
    /// Independent mode writes the top-level key; shared mode does not rewrite
    /// `~/.grok`. Soft-respawns on change.
    #[serde(default = "default_true")]
    pub workflows_enabled: bool,
    /// Preferred Grok Build agent definition for new agent processes
    /// (`explore` / `plan` / `general-purpose` / custom name under `~/.grok/agents`).
    /// Empty / `default` / `none` → omit top-level `--agent` (CLI default).
    /// Applied at spawn only; changing it soft-respawns the live agent.
    #[serde(default)]
    pub preferred_agent: String,
    /// Optional path to a Grok Build agent profile file
    /// (`grok agent --agent-profile <PATH>`). Empty → omit the flag.
    /// Spawn-time only; does not rewrite shared `~/.grok`. Soft-respawns on change.
    #[serde(default)]
    pub agent_profile_path: String,
    /// Optional inline subagent definitions JSON for top-level
    /// `grok --agents <JSON>`. Empty → omit the flag. Must be a JSON object map
    /// when set; invalid values are rejected on save. Spawn-time only — does
    /// not write into shared `~/.grok`. Soft-respawns on change.
    #[serde(default)]
    pub agents_json: String,
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
    /// When true (default), if any scheduled automation is **enabled**, window
    /// close still hides to tray even when [`Self::close_to_tray`] is off — so
    /// `automation_runner` keeps ticking. Not a daemon: full quit still pauses.
    #[serde(default = "default_true")]
    pub keep_tray_for_schedules: bool,
    /// macOS only: user opted into the schedules LaunchAgent helper (login +
    /// crash restart of the **full app**). Default false. Not a headless daemon.
    #[serde(default)]
    pub schedules_launch_agent: bool,
    /// Register an OS login item so the app starts at user login (default off).
    /// Synced to the OS via tauri-plugin-autostart on change / setup.
    #[serde(default)]
    pub launch_at_login: bool,
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
    /// sidecar even if `GROK_CLI_REQUIRE_CHECKSUM=1`. Default **false**.
    /// Missing sidecars are already allowed by default (official mirrors omit
    /// them); mismatch always aborts. See `cli_install::require_published_checksum`.
    #[serde(default)]
    pub allow_unverified_cli_install: bool,
    /// Result of the last App-managed CLI install (`Some(true)` = sidecar matched).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_cli_checksum_verified: Option<bool>,
    /// Tool audit ledger retention in days (`7` | `30` | `90` | `0` = unlimited).
    /// Applied on write/rotate and via explicit prune. Default **0** (unlimited).
    #[serde(default)]
    pub audit_ledger_retention_days: u32,
}

fn default_composer_prefs_scope() -> String {
    "global".into()
}

fn default_open_target() -> String {
    "finder".into()
}

fn default_cli_backend() -> String {
    crate::wsl_backend::CLI_BACKEND_NATIVE.into()
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
    // New installs + missing field: Workspace isolation (matches App DEFAULT_SANDBOX_PROFILE).
    // Existing settings that already persist "off" are unchanged.
    "workspace".into()
}

fn default_compaction_mode() -> String {
    crate::acp_client::DEFAULT_COMPACTION_MODE.into()
}

fn default_compaction_detail() -> String {
    crate::acp_client::DEFAULT_COMPACTION_DETAIL.into()
}

fn default_reopen_last_session() -> bool {
    false
}

fn default_plan_enabled() -> bool {
    true
}

fn default_background_wait_policy() -> String {
    "wait".into()
}

fn default_background_wait_timeout_sec() -> u32 {
    crate::acp_client::DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC
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

fn default_todo_gate_max_fires() -> u32 {
    crate::agent_todo_gate::DEFAULT_TODO_GATE_MAX_FIRES
}

fn default_locale() -> String {
    "system".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            // Follow OS language (zh / zh-TW / en). Users can lock a catalog in Settings.
            locale: default_locale(),
            locale_follow_system_migrated: true,
            // Product default: share GROK_HOME (~/.grok) with terminal Grok Build CLI.
            // Existing installs keep whatever is already persisted in settings.json.
            session_data_mode: "shared".into(),
            manual_cli_path: None,
            cli_backend: default_cli_backend(),
            wsl_distro: None,
            wsl_cli_path: None,
            permission_policy: "ask".into(),
            model_id: Some("grok-4.6".into()),
            effort: Some("xhigh".into()),
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
            stream_stall_default_migrated: true,
            store_api_keys_in_keychain: false,
            sandbox_profile: default_sandbox_profile(),
            experimental_memory: false,
            compaction_mode: default_compaction_mode(),
            compaction_detail: default_compaction_detail(),
            two_pass_compaction_enabled: false,
            max_agent_turns: None,
            background_wait_policy: default_background_wait_policy(),
            background_wait_timeout_sec: default_background_wait_timeout_sec(),
            include_partial_messages: false,
            disable_web_search: false,
            official_aux_inject: true,
            official_aux_with_user_mcp: false,
            no_ask_user: false,
            disallowed_tools: Vec::new(),
            allowed_tools: Vec::new(),
            todo_gate_enabled: false,
            todo_gate_max_fires_per_prompt: default_todo_gate_max_fires(),
            reopen_last_session: default_reopen_last_session(),
            last_session_id: None,
            last_project_id: None,
            sidebar_collapsed_project_ids: Vec::new(),
            sidebar_other_sessions_open: true,
            // Fresh defaults already match the new-chat-on-launch product rule.
            startup_new_chat_default_migrated: true,
            // Fresh installs already use 1.0-aligned effort / workflows defaults.
            effort_default_migrated: true,
            official_model_default_migrated: true,
            official_effort_xhigh_migrated: true,
            official_effort_xhigh_rows_migrated: true,
            workflows_default_migrated: true,
            plan_enabled: default_plan_enabled(),
            subagents_enabled: true,
            subagent_worktree_snapshot_enabled: false,
            auto_wake_enabled: false,
            workflows_enabled: true,
            preferred_agent: String::new(),
            agent_profile_path: String::new(),
            agents_json: String::new(),
            use_leader: false,
            voice_id: default_voice_id(),
            voice_dictation_auto_send: false,
            voice_keep_agents_on_end: true,
            close_to_tray: default_close_to_tray(),
            keep_tray_for_schedules: true,
            schedules_launch_agent: false,
            launch_at_login: false,
            notify_on_turn_done: true,
            notify_on_permission: true,
            proxy_mode: default_proxy_mode(),
            proxy_url: None,
            proxy_no_proxy: None,
            allow_unverified_cli_install: false,
            last_cli_checksum_verified: None,
            audit_ledger_retention_days: 0,
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

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
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
    if let Some(next) =
        crate::process_limits::migrate_max_concurrent(s.max_concurrent_agents, s.pool_size_migrated)
    {
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
    // One-time: stream stall soft window 120/180 → 600 (10 min). Installs that
    // only ever stored the product default must not keep false-stalling; a
    // deliberate custom value is left alone (flag still set so we do not re-ask).
    if let Some(next) = crate::stream_stall::migrate_stream_stall_seconds(
        s.stream_stall_seconds,
        s.stream_stall_default_migrated,
    ) {
        tracing::info!(
            "settings migration: streamStallSeconds {} → {}",
            s.stream_stall_seconds,
            next
        );
        s.stream_stall_seconds = next;
        s.stream_stall_default_migrated = true;
        let _ = write_json(&settings_file(), &s);
    } else if !s.stream_stall_default_migrated {
        s.stream_stall_default_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: product default is draft new-chat on launch (not restore last).
    // Prior builds defaulted reopen_last_session=true, so existing settings
    // keep restoring a chat and look like "first session selected" on every boot.
    if !s.startup_new_chat_default_migrated {
        s.reopen_last_session = false;
        s.startup_new_chat_default_migrated = true;
        tracing::info!("settings migration: reopenLastSession → false (start on new chat)");
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: Grok Build 1.0 effort default medium → high. Unset / empty /
    // legacy product default medium lift to high; deliberate low/high/max kept.
    if !s.effort_default_migrated {
        if let Some(next) = migrate_legacy_effort_default(s.effort.as_deref()) {
            tracing::info!(
                "settings migration: effort {:?} → {} (Grok Build 1.0 default)",
                s.effort,
                next
            );
            s.effort = Some(next);
        }
        s.effort_default_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: official catalog default grok-4.5 → grok-4.6. Unset / empty /
    // legacy product default grok-4.5 lift; deliberate other ids kept.
    if !s.official_model_default_migrated {
        if let Some(next) = migrate_legacy_official_model_default(s.model_id.as_deref()) {
            tracing::info!(
                "settings migration: modelId {:?} → {} (Grok 4.6 default)",
                s.model_id,
                next
            );
            s.model_id = Some(next);
        }
        s.official_model_default_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: official 4.6 product effort high → xhigh. Unset / empty / the
    // previous product default high lift; deliberate low/medium/max stay.
    // Skip custom-provider route ids (not grok-* / empty).
    if !s.official_effort_xhigh_migrated {
        if official_route_should_default_xhigh(s.model_id.as_deref()) {
            if let Some(next) = migrate_official_effort_to_xhigh(s.effort.as_deref()) {
                tracing::info!(
                    "settings migration: effort {:?} → {} (Grok 4.6 default)",
                    s.effort,
                    next
                );
                s.effort = Some(next);
            }
        }
        s.official_effort_xhigh_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    if !s.official_effort_xhigh_rows_migrated {
        migrate_official_effort_xhigh_rows(s.model_id.as_deref());
        s.official_effort_xhigh_rows_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: factory UI locale `en` → `system` so Chinese (and other)
    // OS languages apply on first launch / existing installs that never
    // locked a language. Explicit zh / zh-TW / system stay.
    if !s.locale_follow_system_migrated {
        if let Some(next) = migrate_legacy_locale_default(Some(s.locale.as_str())) {
            tracing::info!(
                "settings migration: locale {:?} → {} (follow OS language)",
                s.locale,
                next
            );
            s.locale = next;
        }
        s.locale_follow_system_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    // One-time: product workflows default off → on (CLI ≥0.2.111 / 1.0).
    // Only lifts false → true once; users who turn it off again stay off.
    if !s.workflows_default_migrated {
        if !s.workflows_enabled {
            tracing::info!("settings migration: workflowsEnabled false → true (CLI default)");
            s.workflows_enabled = true;
            let _ =
                crate::agent_workflows::sync_workflows_to_agent_profile(&s.session_data_mode, true);
        }
        s.workflows_default_migrated = true;
        let _ = write_json(&settings_file(), &s);
    }
    s
}

/// Product default effort for cold start / fallback (Grok Build 1.0 = high).
pub const DEFAULT_REASONING_EFFORT: &str = "high";

/// One-shot effort migration: lift unset / empty / legacy `"medium"` product
/// default to [`DEFAULT_REASONING_EFFORT`]. Returns `Some(new)` when the stored
/// value should change; `None` when it should be left alone (already high, or
/// deliberate low/max/custom). Callers still set the migrated flag either way.
pub fn migrate_legacy_effort_default(stored: Option<&str>) -> Option<String> {
    match stored.map(str::trim).filter(|s| !s.is_empty()) {
        None => Some(DEFAULT_REASONING_EFFORT.into()),
        Some("medium") => Some(DEFAULT_REASONING_EFFORT.into()),
        Some(_) => None,
    }
}

/// Product default official catalog model (Grok 4.6, 2026-08).
pub const DEFAULT_OFFICIAL_MODEL_ID: &str = "grok-4.6";

/// One-shot official-model migration: lift unset / empty / legacy `"grok-4.5"`
/// product default to [`DEFAULT_OFFICIAL_MODEL_ID`]. Explicit other ids stay.
pub fn migrate_legacy_official_model_default(stored: Option<&str>) -> Option<String> {
    match stored.map(str::trim).filter(|s| !s.is_empty()) {
        None => Some(DEFAULT_OFFICIAL_MODEL_ID.into()),
        Some("grok-4.5") => Some(DEFAULT_OFFICIAL_MODEL_ID.into()),
        Some(_) => None,
    }
}

/// One-shot: lift the old factory locale `"en"` (or empty) to `"system"`.
/// Explicit `zh` / `zh-TW` / `system` / other catalog ids stay.
pub fn migrate_legacy_locale_default(stored: Option<&str>) -> Option<String> {
    match stored.map(str::trim).filter(|s| !s.is_empty()) {
        None => Some("system".into()),
        Some(v) if v.eq_ignore_ascii_case("en") => Some("system".into()),
        Some(_) => None,
    }
}

pub const DEFAULT_OFFICIAL_EFFORT: &str = "xhigh";

fn official_route_should_default_xhigh(model_id: Option<&str>) -> bool {
    match model_id.map(str::trim).filter(|s| !s.is_empty()) {
        None => true,
        Some(id) => id.starts_with("grok-"),
    }
}

/// Lift unset / empty / previous official default `"high"` to xhigh.
pub fn migrate_official_effort_to_xhigh(stored: Option<&str>) -> Option<String> {
    match stored.map(str::trim).filter(|s| !s.is_empty()) {
        None => Some(DEFAULT_OFFICIAL_EFFORT.into()),
        Some("high") => Some(DEFAULT_OFFICIAL_EFFORT.into()),
        Some(_) => None,
    }
}

/// Session / project row: lift `high` → `xhigh` only for official 4.6 (or
/// inherited global official 4.6). grok-4.5 and custom ids stay put.
pub fn row_should_lift_official_high_to_xhigh(
    row_model_id: Option<&str>,
    row_effort: Option<&str>,
    global_model_id: Option<&str>,
) -> bool {
    if row_effort.map(str::trim) != Some("high") {
        return false;
    }
    match row_model_id.map(str::trim).filter(|s| !s.is_empty()) {
        None => official_route_should_default_xhigh(global_model_id),
        Some("grok-4.6") => true,
        Some(_) => false,
    }
}

fn migrate_official_effort_xhigh_rows(global_model_id: Option<&str>) {
    let mut sessions = load_sessions_index();
    let mut sessions_changed = false;
    for s in &mut sessions {
        if row_should_lift_official_high_to_xhigh(
            s.model_id.as_deref(),
            s.effort.as_deref(),
            global_model_id,
        ) {
            s.effort = Some(DEFAULT_OFFICIAL_EFFORT.into());
            sessions_changed = true;
        }
    }
    if sessions_changed {
        if let Err(e) = save_sessions_index(&sessions) {
            tracing::warn!("effort row migration: sessions_index: {e}");
        }
    }
    let mut projects = load_projects();
    let mut projects_changed = false;
    for p in &mut projects {
        if row_should_lift_official_high_to_xhigh(
            p.model_id.as_deref(),
            p.effort.as_deref(),
            global_model_id,
        ) {
            p.effort = Some(DEFAULT_OFFICIAL_EFFORT.into());
            projects_changed = true;
        }
    }
    if projects_changed {
        if let Err(e) = save_projects(&projects) {
            tracing::warn!("effort row migration: projects: {e}");
        }
    }
}

/// Clamp a remembered effort to the catalog of the resolved model.
/// grok-4.5 has no xhigh → high. Unknown / custom catalogs are left alone.
pub fn clamp_effort_for_model(model_id: &str, effort: &str) -> String {
    let allowed: &[&str] = match model_id.trim() {
        "grok-4.5" => &["low", "medium", "high"],
        "" | "grok-4.6" => &["low", "medium", "high", "xhigh"],
        id if id.starts_with("grok-") => &["low", "medium", "high", "xhigh"],
        _ => return effort.to_string(),
    };
    if allowed
        .iter()
        .any(|id| id.eq_ignore_ascii_case(effort.trim()))
    {
        return effort.to_string();
    }
    // Only clamp the official overflow: 4.5 has no xhigh → high.
    // Leave custom / unknown ids (e.g. max) untouched.
    if effort.trim().eq_ignore_ascii_case("xhigh")
        && allowed.iter().any(|a| a.eq_ignore_ascii_case("high"))
    {
        return "high".to_string();
    }
    effort.to_string()
}

pub fn save_settings(s: &AppSettings) -> Result<(), String> {
    let _ = ensure_app_dirs();
    write_json(&settings_file(), s)
}

/// Stable pin partition: all pinned first, then unpinned.
/// Relative order within each group is preserved (user order / file order).
/// Does **not** sort by `last_opened_at` — sidebar order is manual.
pub fn apply_project_pin_partition(list: &mut Vec<Project>) {
    let mut pinned = Vec::with_capacity(list.len());
    let mut unpinned = Vec::with_capacity(list.len());
    for p in list.drain(..) {
        if p.pinned {
            pinned.push(p);
        } else {
            unpinned.push(p);
        }
    }
    list.extend(pinned);
    list.extend(unpinned);
}

/// Rebuild project list from an explicit id order, then pin-partition.
/// Unknown ids are skipped; projects missing from `ordered_ids` are appended
/// in their previous relative order (then partitioned).
pub fn reorder_projects_by_ids(list: &[Project], ordered_ids: &[String]) -> Vec<Project> {
    let mut by_id: std::collections::HashMap<String, Project> =
        list.iter().cloned().map(|p| (p.id.clone(), p)).collect();
    let mut next = Vec::with_capacity(list.len());
    let mut seen = std::collections::HashSet::new();
    for id in ordered_ids {
        if seen.contains(id) {
            continue;
        }
        if let Some(p) = by_id.remove(id) {
            seen.insert(id.clone());
            next.push(p);
        }
    }
    // Preserve prior relative order for anything not in ordered_ids.
    for p in list {
        if !seen.contains(&p.id) {
            if let Some(rest) = by_id.remove(&p.id) {
                next.push(rest);
            }
        }
    }
    apply_project_pin_partition(&mut next);
    next
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
    // Pin group first; keep manual order within each group (no last_opened sort).
    apply_project_pin_partition(&mut list);
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
        sandbox_profile: None,
        color: None,
    };
    // New projects land at the end of the unpinned group (after pin partition).
    list.push(p.clone());
    apply_project_pin_partition(&mut list);
    save_projects(&list)?;
    Ok(p)
}

/// Persist a user-defined sidebar project order.
/// Pin groups are re-applied so unpinned items cannot sit above pinned ones.
pub fn reorder_projects(ordered_ids: Vec<String>) -> Result<Vec<Project>, String> {
    let list = load_projects();
    if list.is_empty() {
        return Ok(list);
    }
    let next = reorder_projects_by_ids(&list, &ordered_ids);
    save_projects(&next)?;
    Ok(next)
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
    let idx = list
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    if list[idx].pinned == pinned {
        return Ok(list[idx].clone());
    }
    let mut p = list.remove(idx);
    p.pinned = pinned;
    // Pin → end of pinned group; unpin → end of list (unpinned group).
    if pinned {
        let insert_at = list.iter().filter(|x| x.pinned).count();
        list.insert(insert_at, p.clone());
    } else {
        list.push(p.clone());
    }
    apply_project_pin_partition(&mut list);
    save_projects(&list)?;
    Ok(p)
}

/// Named project accent tokens (sidebar color dot).
pub const PROJECT_COLOR_TOKENS: &[&str] = &["blue", "green", "orange", "purple", "pink", "gray"];

/// Normalize a project color value.
///
/// Accepts:
/// - named tokens: `blue` | `green` | `orange` | `purple` | `pink` | `gray`
/// - hex: `#rgb` / `#rrggbb` (case-insensitive; output lowercased)
///
/// Empty / `none` / `inherit` / `default` / `clear` → `None`.
/// Unknown values → `None` (treat as clear so bad data cannot stick).
pub fn normalize_project_color(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "none" | "inherit" | "default" | "clear" | "null" | "undefined"
    ) {
        return None;
    }
    if PROJECT_COLOR_TOKENS.iter().any(|tok| *tok == lower) {
        return Some(lower);
    }
    if let Some(hex) = normalize_hex_color(&lower) {
        return Some(hex);
    }
    None
}

/// Validate and canonicalize `#rgb` / `#rrggbb` to lowercase hex.
fn normalize_hex_color(raw: &str) -> Option<String> {
    let s = raw.trim();
    if !s.starts_with('#') {
        return None;
    }
    let body = &s[1..];
    let ok = matches!(body.len(), 3 | 6) && body.bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        return None;
    }
    Some(format!("#{}", body.to_ascii_lowercase()))
}

/// Set or clear a project sidebar accent color.
///
/// `color = None` / empty / `"none"` clears the accent.
/// Invalid values are rejected (not silently cleared) so the UI can show an error.
pub fn set_project_color(id: &str, color: Option<String>) -> Result<Project, String> {
    let next = match color {
        None => None,
        Some(raw) => {
            let t = raw.trim();
            if t.is_empty()
                || t.eq_ignore_ascii_case("none")
                || t.eq_ignore_ascii_case("inherit")
                || t.eq_ignore_ascii_case("default")
                || t.eq_ignore_ascii_case("clear")
            {
                None
            } else {
                Some(
                    normalize_project_color(t).ok_or_else(|| {
                        format!(
                            "invalid project color (use blue|green|orange|purple|pink|gray or #hex): {t}"
                        )
                    })?,
                )
            }
        }
    };
    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    p.color = next;
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
pub fn set_project_permission_policy(id: &str, policy: Option<String>) -> Result<Project, String> {
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

/// Known OS sandbox profiles (align with `SandboxSpawnSpec` / frontend helper).
pub const SANDBOX_PROFILES: &[&str] = &["off", "workspace", "read-only", "strict", "devbox"];

/// Normalize a sandbox profile string. Empty / inherit → `None`.
/// Unknown values → `None` (caller may fall back to default).
pub fn normalize_sandbox_profile(raw: &str) -> Option<String> {
    let t = raw.trim().to_ascii_lowercase();
    if t.is_empty()
        || t == "inherit"
        || t == "app_default"
        || t == "app-default"
        || t == "default"
        || t == "none"
    {
        return None;
    }
    if SANDBOX_PROFILES.iter().any(|p| *p == t) {
        Some(t)
    } else {
        None
    }
}

/// Effective sandbox for spawn: project override (when set) wins over global.
pub fn resolve_sandbox_profile(global: &str, project_override: Option<&str>) -> String {
    if let Some(raw) = project_override {
        if let Some(p) = normalize_sandbox_profile(raw) {
            return p;
        }
    }
    normalize_sandbox_profile(global).unwrap_or_else(default_sandbox_profile)
}

/// Set or clear a project-level OS sandbox profile.
///
/// `profile = None` / empty / `"inherit"` clears the override so Settings apply.
/// Requires a trusted project (same gate as permission tier).
pub fn set_project_sandbox_profile(id: &str, profile: Option<String>) -> Result<Project, String> {
    let mut list = load_projects();
    let p = list
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "project not found".to_string())?;
    if !p.trusted {
        return Err("trust this project before setting a sandbox profile".into());
    }

    let next = match profile {
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
                Some(
                    normalize_sandbox_profile(t)
                        .ok_or_else(|| format!("unknown sandbox profile: {t}"))?,
                )
            }
        }
    };
    p.sandbox_profile = next;
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
        json_schema: None,
        scheduled,
        worktree_path: None,
        worktree_branch: None,
        is_worktree_session: false,
        plugin_dirs: Vec::new(),
        extra_rules: None,
        max_agent_turns: None,
        system_prompt_override: None,
        fork_agent_session: false,
        no_ask_user: None,
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

/// Attach or clear worktree linkage on a session (path/branch/badge flag).
/// Empty path clears all three fields. Does not bump `updated_at` (organizational).
pub fn set_session_worktree(
    id: &str,
    worktree_path: Option<String>,
    worktree_branch: Option<String>,
) -> Result<SessionMeta, String> {
    let path = worktree_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let branch = worktree_branch
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    if let Some(p) = path {
        s.worktree_path = Some(p);
        s.worktree_branch = branch;
        s.is_worktree_session = true;
    } else {
        s.worktree_path = None;
        s.worktree_branch = None;
        s.is_worktree_session = false;
    }
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Soft cap aligned with the frontend helper (~256 KiB).
const JSON_SCHEMA_MAX_CHARS: usize = 256 * 1024;

/// Persist optional structured-output JSON Schema for a session.
/// Pass `None` or empty string to clear. Host re-parses lightly (object JSON).
pub fn set_session_json_schema(
    id: &str,
    json_schema: Option<String>,
) -> Result<SessionMeta, String> {
    let normalized = match json_schema {
        None => None,
        Some(raw) => {
            let t = raw.trim();
            if t.is_empty() {
                None
            } else {
                if t.len() > JSON_SCHEMA_MAX_CHARS {
                    return Err("json schema too large".into());
                }
                let v: serde_json::Value =
                    serde_json::from_str(t).map_err(|e| format!("invalid json schema: {e}"))?;
                if !v.is_object() {
                    return Err("json schema must be a JSON object".into());
                }
                Some(
                    serde_json::to_string_pretty(&v)
                        .map_err(|e| format!("invalid json schema: {e}"))?,
                )
            }
        }
    };
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.json_schema = normalized;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Normalize session plugin dirs: trim, drop empty, dedupe (first wins).
pub fn normalize_plugin_dirs(dirs: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for d in dirs {
        let t = d.trim().to_string();
        if t.is_empty() {
            continue;
        }
        if !seen.insert(t.clone()) {
            continue;
        }
        out.push(t);
    }
    out
}

/// Set session-only `--plugin-dir` paths (empty clears). Does not touch global plugins.
pub fn set_session_plugin_dirs(id: &str, plugin_dirs: Vec<String>) -> Result<SessionMeta, String> {
    let dirs = normalize_plugin_dirs(plugin_dirs);
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.plugin_dirs = dirs;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Soft cap aligned with the frontend helper (~32 KiB).
const EXTRA_RULES_MAX_CHARS: usize = 32 * 1024;

/// Soft cap for system prompt override (~32 KiB), aligned with the frontend helper.
const SYSTEM_PROMPT_OVERRIDE_MAX_CHARS: usize = 32 * 1024;

/// Trim + clamp session extra rules. Empty after trim → `None` (clear).
pub fn sanitize_extra_rules(raw: Option<String>) -> Option<String> {
    match raw {
        None => None,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else if t.len() > EXTRA_RULES_MAX_CHARS {
                Some(t.chars().take(EXTRA_RULES_MAX_CHARS).collect())
            } else {
                Some(t.to_string())
            }
        }
    }
}

/// Trim, strip NUL bytes, and clamp session system prompt override.
/// Empty after sanitize → `None` (clear). Never log the returned value.
pub fn sanitize_system_prompt_override(raw: Option<String>) -> Option<String> {
    match raw {
        None => None,
        Some(s) => {
            // Strip NULs so the value cannot break argv / TOML / log lines.
            let cleaned: String = s.chars().filter(|c| *c != '\0').collect();
            let t = cleaned.trim();
            if t.is_empty() {
                None
            } else if t.chars().count() > SYSTEM_PROMPT_OVERRIDE_MAX_CHARS {
                Some(t.chars().take(SYSTEM_PROMPT_OVERRIDE_MAX_CHARS).collect())
            } else {
                Some(t.to_string())
            }
        }
    }
}

/// Set or clear per-session extra rules (`grok --rules` on next spawn).
/// Pass `None` or empty/whitespace to clear.
pub fn set_session_extra_rules(
    id: &str,
    extra_rules: Option<String>,
) -> Result<SessionMeta, String> {
    let normalized = sanitize_extra_rules(extra_rules);
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.extra_rules = normalized;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Set or clear per-session max agent turns (`grok --max-turns` on next spawn).
///
/// Pass `None` or `0` to clear (inherit global settings). Values are clamped to 1–200
/// via [`crate::acp_client::normalize_max_agent_turns`].
pub fn set_session_max_agent_turns(
    id: &str,
    max_agent_turns: Option<u32>,
) -> Result<SessionMeta, String> {
    let normalized = crate::acp_client::normalize_max_agent_turns(max_agent_turns);
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.max_agent_turns = normalized;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Set or clear per-session system prompt override
/// (`grok --system-prompt-override` on next spawn).
/// Pass `None` or empty/whitespace to clear. Soft-respawn is handled by the command.
/// Set or clear per-session `--no-ask-user` override.
/// `None` inherits global `AppSettings.no_ask_user`.
pub fn set_session_no_ask_user(id: &str, no_ask_user: Option<bool>) -> Result<SessionMeta, String> {
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.no_ask_user = no_ask_user;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

pub fn set_session_system_prompt_override(
    id: &str,
    system_prompt_override: Option<String>,
) -> Result<SessionMeta, String> {
    let normalized = sanitize_system_prompt_override(system_prompt_override);
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    s.system_prompt_override = normalized;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Bind (or clear) a session's project folder. Used to attach orphan / legacy
/// chats to a project added later. Clearing (`None`) returns the chat to
/// "其他会话"; agent cwd still uses the general workspace directory.
pub fn set_session_project(id: &str, project_id: Option<String>) -> Result<SessionMeta, String> {
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
    let path = session_dir(session_id).join("messages.json");
    crate::store_lock::with_exclusive_lock(&path, || {
        let mut msgs: Vec<ChatMessageStored> = read_json_recover(&path);
        if let Some(slot) = msgs.iter_mut().find(|m| m.id == msg.id) {
            *slot = msg;
        } else {
            msgs.push(msg);
        }
        let s = serde_json::to_string_pretty(&msgs).map_err(|e| e.to_string())?;
        crate::store_lock::write_bytes_replace(&path, s.as_bytes())
    })
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

/// Fork a session: new journal + meta, same project.
///
/// By default the fork has **no** `agent_session_id` (next connect uses `session/new`
/// and journal bootstrap). When `fork_agent_session` is true and the source has an
/// agent id, the fork carries that id with `fork_agent_session=true` so the next
/// connect uses CLI `--fork-session` semantics (ACP `session/fork` produces a new
/// agent id with full parent context; the source agent session is left untouched).
///
/// `through_user_prompt_index`: when set, copy only through that user turn (inclusive).
pub fn fork_session(
    source_id: &str,
    through_user_prompt_index: Option<u32>,
    title: Option<String>,
    fork_agent_session: bool,
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
    // Worktree linkage follows the source project/cwd story.
    meta.worktree_path = source.worktree_path.clone();
    meta.worktree_branch = source.worktree_branch.clone();
    meta.is_worktree_session = source.is_worktree_session;
    meta.plugin_dirs = source.plugin_dirs.clone();
    meta.extra_rules = source.extra_rules.clone();
    meta.max_agent_turns = source.max_agent_turns;
    meta.system_prompt_override = source.system_prompt_override.clone();
    meta.no_ask_user = source.no_ask_user;
    // CLI --fork-session: resume parent agent context under a new agent id.
    let source_agent = source
        .agent_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if fork_agent_session {
        if let Some(aid) = source_agent {
            meta.agent_session_id = Some(aid);
            meta.fork_agent_session = true;
        }
    }
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

/// Set or clear the one-shot CLI `--fork-session` flag on a session.
///
/// When `true`, next connect forks `agent_session_id` into a new agent id.
/// Requires a non-empty `agent_session_id` to enable; otherwise stores `false`.
pub fn set_session_fork_agent_session(
    id: &str,
    fork_agent_session: bool,
) -> Result<SessionMeta, String> {
    let mut list = load_sessions_index();
    let s = list
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "session not found".to_string())?;
    let has_agent = s
        .agent_session_id
        .as_deref()
        .map(str::trim)
        .is_some_and(|a| !a.is_empty());
    s.fork_agent_session = fork_agent_session && has_agent;
    s.updated_at = Utc::now();
    let clone = s.clone();
    save_sessions_index(&list)?;
    Ok(clone)
}

/// Clear the one-shot fork flag after a connect attempt (success or fallthrough).
pub fn clear_session_fork_agent_session(id: &str) -> Result<SessionMeta, String> {
    set_session_fork_agent_session(id, false)
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
    list.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
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

fn collect_agent_home_api_keys() -> Vec<String> {
    let home = crate::paths::resolve_agent_grok_home(&load_settings().session_data_mode);
    let path = home.join("config.toml");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        let Some(rest) = t
            .strip_prefix("api_key")
            .or_else(|| t.strip_prefix("\"api_key\""))
        else {
            continue;
        };
        let rest = rest.trim().trim_start_matches('=').trim();
        let val = rest.trim_matches('"').trim_matches('\'').trim();
        if val.len() >= 8 {
            out.push(val.to_string());
        }
    }
    out
}

/// Redact secrets from a string for logs/Doctor export.
pub fn redact_text(input: &str) -> String {
    let mut out = input.to_string();
    let secrets = load_secrets();
    let mut keys: Vec<String> = [
        secrets.official_api_key.clone(),
        secrets.relay_api_key.clone(),
    ]
    .into_iter()
    .flatten()
    .collect();
    keys.extend(collect_agent_home_api_keys());
    for key in keys {
        if key.len() >= 8 {
            out = out.replace(&key, "[REDACTED]");
        }
    }
    // common token scrubbing without regex crate
    let mut cleaned = String::with_capacity(out.len());
    for word in out.split_whitespace() {
        if word.len() > 20
            && (word.starts_with("sk-") || word.starts_with("xai-") || word.contains("Bearer"))
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
            .unwrap_or_else(|| "grok-4.6".into()),
        settings
            .effort
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "xhigh".into()),
        if settings.mode.trim().is_empty() {
            "agent".into()
        } else {
            // Heal a `plan` default already written by an older build: plan mode
            // must never be inherited by a new session.
            non_plan_mode(&settings.mode)
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
/// Model / mode follow `composer_prefs_scope`.
/// Permission and effort always cascade session → project → global (L10), and
/// untrusted projects force Ask regardless of stored tiers.
pub fn resolve_composer_prefs(project_id: Option<&str>, session_id: Option<&str>) -> ComposerPrefs {
    use crate::permission::effective_permission_policy;

    let settings = load_settings();
    let scope = ComposerPrefsScope::parse(&settings.composer_prefs_scope);
    let (g_model, g_effort, g_mode, g_policy) = global_prefs(&settings);

    let sess = session_id.and_then(|id| load_sessions_index().into_iter().find(|s| s.id == id));
    let proj = sess
        .as_ref()
        .and_then(|s| s.project_id.as_deref())
        .or(project_id)
        .and_then(|id| load_projects().into_iter().find(|p| p.id == id));

    // Permission: always cascade (independent of model memory scope).
    let permission_policy = effective_permission_policy(
        &g_policy,
        proj.as_ref().map(|p| p.trusted),
        proj.as_ref().and_then(|p| p.permission_policy.as_deref()),
        sess.as_ref().and_then(|s| s.permission_policy.as_deref()),
    )
    .as_str()
    .to_string();

    // Effort: always cascade session → project → global, like permission and
    // unlike model. Reasoning effort is a per-chat decision — under the default
    // global scope a single `settings.effort` served every chat, so raising
    // effort in a new chat silently rewrote every older chat on that model.
    // `settings.effort` now only seeds chats that never chose one.
    let effort = sess
        .as_ref()
        .and_then(|s| s.effort.clone())
        .filter(|x| !x.trim().is_empty())
        .or_else(|| {
            proj.as_ref()
                .and_then(|p| p.effort.clone())
                .filter(|x| !x.trim().is_empty())
        })
        .unwrap_or(g_effort);

    let mut prefs = match scope {
        ComposerPrefsScope::Global => ComposerPrefs {
            model_id: g_model,
            effort,
            mode: g_mode,
            permission_policy,
            scope: scope.as_str().into(),
            source: "global".into(),
        },
        ComposerPrefsScope::Project => {
            if let Some(p) = proj {
                ComposerPrefs {
                    model_id: p.model_id.filter(|s| !s.is_empty()).unwrap_or(g_model),
                    effort,
                    mode: p
                        .mode
                        .filter(|s| !s.is_empty())
                        // Project defaults never carry plan mode (heals old data).
                        .map(|m| non_plan_mode(&m))
                        .unwrap_or(g_mode),
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: "project".into(),
                }
            } else {
                ComposerPrefs {
                    model_id: g_model,
                    effort,
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
            let p_mode = proj
                .as_ref()
                .and_then(|p| p.mode.clone())
                .filter(|s| !s.is_empty())
                // A project default of `plan` is never inherited (heals old data).
                .map(|m| non_plan_mode(&m))
                .unwrap_or(g_mode.clone());

            if let Some(s) = sess {
                ComposerPrefs {
                    model_id: s.model_id.filter(|x| !x.is_empty()).unwrap_or(p_model),
                    effort,
                    mode: s.mode.filter(|x| !x.is_empty()).unwrap_or(p_mode),
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: "session".into(),
                }
            } else {
                ComposerPrefs {
                    model_id: p_model,
                    effort,
                    mode: p_mode,
                    permission_policy,
                    scope: scope.as_str().into(),
                    source: if proj.is_some() { "project" } else { "global" }.into(),
                }
            }
        }
    };
    prefs.effort = clamp_effort_for_model(&prefs.model_id, &prefs.effort);
    prefs
}

/// Plan mode is a **transient, per-session** state, never a sticky default.
///
/// It used to be persisted like any other mode, so a single `/plan` wrote
/// `mode: "plan"` into global settings and every later session started in plan
/// mode. Session scope may still record it (that session really is planning);
/// global / project defaults drop it.
fn sticky_mode(mode: Option<String>) -> Option<String> {
    match mode {
        Some(m) if m.trim().eq_ignore_ascii_case("plan") => None,
        other => other,
    }
}

/// Read a stored default mode, healing a `plan` value already on disk.
pub(crate) fn non_plan_mode(mode: &str) -> String {
    let m = mode.trim();
    if m.is_empty() || m.eq_ignore_ascii_case("plan") {
        return "agent".into();
    }
    m.to_string()
}

/// Persist `effort` on the session row.
///
/// Returns the value back when there is no row to write to (draft chat that has
/// not been created yet, or an unknown id) so the caller can seed the global
/// default instead of dropping the choice.
fn save_effort_on_session(
    session_id: Option<&str>,
    effort: String,
) -> Result<Option<String>, String> {
    let Some(sid) = session_id.filter(|s| !s.is_empty()) else {
        return Ok(Some(effort));
    };
    let mut list = load_sessions_index();
    let Some(sess) = list.iter_mut().find(|s| s.id == sid) else {
        return Ok(Some(effort));
    };
    sess.effort = Some(effort);
    sess.updated_at = Utc::now();
    save_sessions_index(&list)?;
    Ok(None)
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

    // Effort is remembered per chat (see `resolve_composer_prefs`). Under the
    // global / project scope it must not land in `settings.effort`, or raising
    // effort in one chat rewrites every other chat that never chose its own.
    // Session scope already writes the row further down.
    let effort = if matches!(scope, ComposerPrefsScope::Session) {
        effort
    } else {
        match effort {
            Some(v) => save_effort_on_session(session_id, v)?,
            None => None,
        }
    };

    match scope {
        ComposerPrefsScope::Global => {
            let mut s = settings;
            if let Some(v) = model_id {
                s.model_id = Some(v);
            }
            if let Some(v) = effort {
                s.effort = Some(v);
            }
            if let Some(v) = sticky_mode(mode) {
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
                    if let Some(v) = sticky_mode(mode.clone()) {
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
            if let Some(v) = sticky_mode(mode) {
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
                    if let Some(v) = sticky_mode(mode) {
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
                if let Some(v) = sticky_mode(mode) {
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
    fn non_plan_mode_heals_plan_default() {
        // Plan mode must never be a sticky default: empty or "plan" → "agent".
        assert_eq!(non_plan_mode(""), "agent");
        assert_eq!(non_plan_mode("plan"), "agent");
        assert_eq!(non_plan_mode("PLAN"), "agent");
        assert_eq!(non_plan_mode("agent"), "agent");
        assert_eq!(non_plan_mode("ask"), "ask");
    }

    #[test]
    fn sticky_mode_drops_plan_for_global_persistence() {
        assert_eq!(sticky_mode(None), None);
        assert_eq!(sticky_mode(Some("plan".into())), None);
        assert_eq!(sticky_mode(Some("PLAN".into())), None);
        // Real sticky modes pass through.
        assert_eq!(sticky_mode(Some("agent".into())), Some("agent".into()));
        assert_eq!(sticky_mode(Some("ask".into())), Some("ask".into()));
    }

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
    fn normalize_project_color_tokens_and_hex() {
        for tok in PROJECT_COLOR_TOKENS {
            assert_eq!(
                normalize_project_color(tok).as_deref(),
                Some(*tok),
                "token {tok}"
            );
            assert_eq!(
                normalize_project_color(&format!("  {}  ", tok.to_uppercase())).as_deref(),
                Some(*tok)
            );
        }
        assert_eq!(normalize_project_color("#ABC").as_deref(), Some("#abc"));
        assert_eq!(
            normalize_project_color("#a1b2c3").as_deref(),
            Some("#a1b2c3")
        );
        assert_eq!(
            normalize_project_color("  #FfEeDd  ").as_deref(),
            Some("#ffeedd")
        );
    }

    #[test]
    fn normalize_project_color_clears_and_rejects() {
        for raw in [
            "", "   ", "none", "NONE", "inherit", "default", "clear", "null",
        ] {
            assert_eq!(normalize_project_color(raw), None, "raw={raw:?}");
        }
        assert_eq!(normalize_project_color("red"), None);
        assert_eq!(normalize_project_color("#gg0000"), None);
        assert_eq!(normalize_project_color("#12"), None);
        assert_eq!(normalize_project_color("#12345"), None);
        assert_eq!(normalize_project_color("abc"), None);
        assert_eq!(normalize_project_color("a1b2c3"), None); // missing #
    }

    #[test]
    fn project_color_serde_default_missing_field() {
        // Legacy projects.json rows without `color` deserialize to None.
        let json = r#"{
            "id": "p1",
            "name": "Demo",
            "path": "/tmp/demo",
            "trusted": true,
            "lastOpenedAt": "2026-01-01T00:00:00Z",
            "pathOk": true
        }"#;
        let p: Project = serde_json::from_str(json).expect("legacy project");
        assert!(p.color.is_none());
        assert!(!p.pinned);
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
    fn default_settings_shared_mode() {
        let s = AppSettings::default();
        assert_eq!(s.session_data_mode, "shared");
        assert_eq!(s.permission_policy, "ask");
        assert_eq!(s.theme, "system");
        assert_eq!(s.locale, "system");
        assert!(s.locale_follow_system_migrated);
        assert_eq!(s.max_concurrent_agents, 8);
        assert_eq!(s.agent_idle_minutes, 30);
        assert_eq!(s.stream_stall_seconds, 600);
        assert!(s.stream_stall_default_migrated);
        assert_eq!(s.sandbox_profile, "workspace");
        assert!(!s.experimental_memory);
        assert_eq!(s.compaction_mode, "summary");
        assert_eq!(s.compaction_detail, "verbose");
        assert!(!s.two_pass_compaction_enabled);
        assert_eq!(s.max_agent_turns, None);
        assert_eq!(s.background_wait_policy, "wait");
        assert_eq!(s.background_wait_timeout_sec, 600);
        assert!(!s.include_partial_messages);
        assert!(!s.disable_web_search);
        assert!(!s.no_ask_user);
        assert!(s.disallowed_tools.is_empty());
        assert!(s.allowed_tools.is_empty());
        assert!(s.plan_enabled);
        assert!(s.subagents_enabled);
        assert!(!s.subagent_worktree_snapshot_enabled);
        assert!(s.workflows_enabled);
        assert!(s.effort_default_migrated);
        assert!(s.official_model_default_migrated);
        assert!(s.workflows_default_migrated);
        assert_eq!(s.effort.as_deref(), Some("xhigh"));
        assert_eq!(s.model_id.as_deref(), Some("grok-4.6"));
        assert!(s.official_effort_xhigh_migrated);
        assert!(s.official_effort_xhigh_rows_migrated);
        assert_eq!(s.preferred_agent, "");
        assert_eq!(s.agent_profile_path, "");
        assert_eq!(s.agents_json, "");
        assert!(!s.use_leader);
    }

    #[test]
    fn migrate_legacy_effort_lifts_medium_and_unset() {
        assert_eq!(migrate_legacy_effort_default(None).as_deref(), Some("high"));
        assert_eq!(
            migrate_legacy_effort_default(Some("")).as_deref(),
            Some("high")
        );
        assert_eq!(
            migrate_legacy_effort_default(Some("  medium  ")).as_deref(),
            Some("high")
        );
        assert_eq!(migrate_legacy_effort_default(Some("low")), None);
        assert_eq!(migrate_legacy_effort_default(Some("high")), None);
        assert_eq!(migrate_legacy_effort_default(Some("max")), None);
    }

    #[test]
    fn migrate_legacy_official_model_lifts_4_5_and_unset() {
        assert_eq!(
            migrate_legacy_official_model_default(None).as_deref(),
            Some("grok-4.6")
        );
        assert_eq!(
            migrate_legacy_official_model_default(Some("")).as_deref(),
            Some("grok-4.6")
        );
        assert_eq!(
            migrate_legacy_official_model_default(Some("  grok-4.5  ")).as_deref(),
            Some("grok-4.6")
        );
        assert_eq!(
            migrate_legacy_official_model_default(Some("grok-4.6")),
            None
        );
        assert_eq!(
            migrate_legacy_official_model_default(Some("custom-relay")),
            None
        );
    }

    #[test]
    fn migrate_official_effort_lifts_high_and_unset() {
        assert_eq!(
            migrate_official_effort_to_xhigh(None).as_deref(),
            Some("xhigh")
        );
        assert_eq!(
            migrate_official_effort_to_xhigh(Some("  high  ")).as_deref(),
            Some("xhigh")
        );
        assert_eq!(migrate_official_effort_to_xhigh(Some("low")), None);
        assert_eq!(migrate_official_effort_to_xhigh(Some("medium")), None);
        assert_eq!(migrate_official_effort_to_xhigh(Some("xhigh")), None);
    }

    #[test]
    fn official_effort_row_lift_skips_4_5_and_custom() {
        assert!(row_should_lift_official_high_to_xhigh(
            Some("grok-4.6"),
            Some("high"),
            Some("grok-4.6"),
        ));
        assert!(row_should_lift_official_high_to_xhigh(
            None,
            Some("high"),
            Some("grok-4.6"),
        ));
        assert!(!row_should_lift_official_high_to_xhigh(
            Some("grok-4.5"),
            Some("high"),
            Some("grok-4.6"),
        ));
        assert!(!row_should_lift_official_high_to_xhigh(
            Some("my-relay"),
            Some("high"),
            Some("grok-4.6"),
        ));
        assert!(!row_should_lift_official_high_to_xhigh(
            Some("grok-4.6"),
            Some("low"),
            Some("grok-4.6"),
        ));
    }

    #[test]
    fn clamp_effort_drops_xhigh_on_4_5() {
        assert_eq!(clamp_effort_for_model("grok-4.5", "xhigh"), "high");
        assert_eq!(clamp_effort_for_model("grok-4.6", "xhigh"), "xhigh");
        assert_eq!(clamp_effort_for_model("custom-relay", "xhigh"), "xhigh");
    }

    #[test]
    fn migrate_legacy_locale_en_to_system() {
        assert_eq!(
            migrate_legacy_locale_default(Some("en")).as_deref(),
            Some("system")
        );
        assert_eq!(
            migrate_legacy_locale_default(Some("EN")).as_deref(),
            Some("system")
        );
        assert_eq!(migrate_legacy_locale_default(Some("zh")), None);
        assert_eq!(migrate_legacy_locale_default(Some("zh-TW")), None);
        assert_eq!(migrate_legacy_locale_default(Some("system")), None);
        assert_eq!(
            migrate_legacy_locale_default(Some("")).as_deref(),
            Some("system")
        );
        assert_eq!(
            migrate_legacy_locale_default(None).as_deref(),
            Some("system")
        );
    }

    #[test]
    fn legacy_json_locale_en_is_unmigrated() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.locale, "en");
        assert!(!s.locale_follow_system_migrated);
    }

    #[test]
    fn legacy_json_effort_medium_deserializes_unmigrated() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.effort.as_deref(), Some("medium"));
        assert!(!s.effort_default_migrated);
        assert!(!s.workflows_default_migrated);
        // Missing workflowsEnabled → new serde default true (cold field only);
        // persisted false from old AppSettings still migrates via flag in load_settings.
        assert!(s.workflows_enabled);
    }

    #[test]
    fn workflows_enabled_false_when_explicit_in_json() {
        let raw = r#"{
            "theme": "dark",
            "locale": "en",
            "sessionDataMode": "independent",
            "manualCliPath": null,
            "permissionPolicy": "ask",
            "modelId": null,
            "effort": "high",
            "mode": "agent",
            "onboardingDone": true,
            "setupSkipped": false,
            "workflowsEnabled": false
        }"#;
        let s: AppSettings = serde_json::from_str(raw).expect("deserialize");
        assert!(!s.workflows_enabled);
        assert!(!s.workflows_default_migrated);
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
    fn resolve_sandbox_profile_prefers_project_override() {
        assert_eq!(
            resolve_sandbox_profile("workspace", Some("strict")),
            "strict"
        );
        assert_eq!(resolve_sandbox_profile("strict", Some("off")), "off");
        assert_eq!(
            resolve_sandbox_profile("workspace", Some("inherit")),
            "workspace"
        );
        assert_eq!(resolve_sandbox_profile("workspace", None), "workspace");
        assert_eq!(resolve_sandbox_profile("bogus", Some("")), "workspace");
        assert_eq!(
            resolve_sandbox_profile("  WorkSpace  ", Some("  DEVBOX  ")),
            "devbox"
        );
    }

    #[test]
    fn sandbox_profile_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.sandbox_profile, "workspace");
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
    fn agent_profile_path_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.agent_profile_path, "");
    }

    #[test]
    fn agents_json_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.agents_json, "");
    }

    #[test]
    fn agents_json_round_trips_camel_case() {
        let s = AppSettings {
            agents_json: r#"{"reviewer":{"prompt":"x"}}"#.into(),
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"agentsJson\""));
        let back: AppSettings = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.agents_json, r#"{"reviewer":{"prompt":"x"}}"#);
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
    fn no_ask_user_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.no_ask_user);
    }

    #[test]
    fn session_no_ask_user_defaults_none_when_missing() {
        let raw = r#"{"id":"s1","projectId":null,"title":"t","agentSessionId":null,"createdAt":"2020-01-01T00:00:00Z","updatedAt":"2020-01-01T00:00:00Z"}"#;
        let m: SessionMeta = serde_json::from_str(raw).expect("legacy session without noAskUser");
        assert!(m.no_ask_user.is_none());
    }

    #[test]
    fn disallowed_tools_defaults_empty_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.disallowed_tools.is_empty());
    }

    #[test]
    fn disallowed_tools_round_trips_camel_case() {
        let s = AppSettings {
            disallowed_tools: vec!["web_search".into(), "write".into()],
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"disallowedTools\""));
        let back: AppSettings = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(
            back.disallowed_tools,
            vec!["web_search".to_string(), "write".to_string()]
        );
    }

    #[test]
    fn allowed_tools_defaults_empty_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.allowed_tools.is_empty());
    }

    #[test]
    fn allowed_tools_round_trips_camel_case() {
        let s = AppSettings {
            allowed_tools: vec!["web_search".into(), "write".into()],
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"allowedTools\""));
        let back: AppSettings = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(
            back.allowed_tools,
            vec!["web_search".to_string(), "write".to_string()]
        );
    }

    #[test]
    fn include_partial_messages_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.include_partial_messages);
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
    fn subagent_worktree_snapshot_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.subagent_worktree_snapshot_enabled);
        assert!(!AppSettings::default().subagent_worktree_snapshot_enabled);
    }

    #[test]
    fn auto_wake_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.auto_wake_enabled);
        assert!(!AppSettings::default().auto_wake_enabled);
    }

    #[test]
    fn workflows_enabled_defaults_true_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.workflows_enabled);
        assert!(AppSettings::default().workflows_enabled);
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
    fn sidebar_other_sessions_open_defaults_true_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.sidebar_other_sessions_open);
        assert!(AppSettings::default().sidebar_other_sessions_open);
        let closed: AppSettings = serde_json::from_str(
            r#"{"theme":"system","locale":"en","sessionDataMode":"independent","permissionPolicy":"ask","mode":"agent","onboardingDone":false,"setupSkipped":false,"sidebarOtherSessionsOpen":false}"#,
        )
        .expect("deserialize closed");
        assert!(!closed.sidebar_other_sessions_open);
    }

    #[test]
    fn launch_at_login_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.launch_at_login);
        assert!(!AppSettings::default().launch_at_login);
    }

    #[test]
    fn keep_tray_for_schedules_defaults_true_when_missing() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(s.keep_tray_for_schedules);
        assert!(AppSettings::default().keep_tray_for_schedules);
        assert!(!s.schedules_launch_agent);
        assert!(!AppSettings::default().schedules_launch_agent);
    }

    #[test]
    fn compaction_mode_detail_defaults_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.compaction_mode, "summary");
        assert_eq!(s.compaction_detail, "verbose");
        let d = AppSettings::default();
        assert_eq!(d.compaction_mode, "summary");
        assert_eq!(d.compaction_detail, "verbose");
    }

    #[test]
    fn two_pass_compaction_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.two_pass_compaction_enabled);
        assert!(!AppSettings::default().two_pass_compaction_enabled);
    }

    #[test]
    fn experimental_memory_defaults_false_when_missing_from_json() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert!(!s.experimental_memory);
    }

    #[test]
    fn audit_ledger_retention_defaults_unlimited_when_missing() {
        let s: AppSettings = serde_json::from_str(legacy_settings_json()).expect("deserialize");
        assert_eq!(s.audit_ledger_retention_days, 0);
        assert_eq!(AppSettings::default().audit_ledger_retention_days, 0);
    }

    #[test]
    fn session_plugin_dirs_default_empty_and_normalize() {
        let raw = r#"{"id":"s1","projectId":null,"title":"t","agentSessionId":null,"createdAt":"2020-01-01T00:00:00Z","updatedAt":"2020-01-01T00:00:00Z"}"#;
        let m: SessionMeta = serde_json::from_str(raw).expect("legacy session without pluginDirs");
        assert!(m.plugin_dirs.is_empty());
        assert_eq!(
            normalize_plugin_dirs(vec!["  /a  ".into(), "".into(), "/a".into(), "/b".into()]),
            vec!["/a".to_string(), "/b".to_string()]
        );
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
            json_schema: None,
            scheduled: false,
            worktree_path: None,
            worktree_branch: None,
            is_worktree_session: false,
            plugin_dirs: Vec::new(),
            extra_rules: None,
            max_agent_turns: None,
            system_prompt_override: None,
            fork_agent_session: false,
            no_ask_user: None,
        }
    }

    #[test]
    fn session_extra_rules_default_none_and_sanitize() {
        let raw = r#"{"id":"s1","projectId":null,"title":"t","agentSessionId":null,"createdAt":"2020-01-01T00:00:00Z","updatedAt":"2020-01-01T00:00:00Z"}"#;
        let m: SessionMeta = serde_json::from_str(raw).expect("legacy session without extraRules");
        assert!(m.extra_rules.is_none());
        assert_eq!(sanitize_extra_rules(None), None);
        assert_eq!(sanitize_extra_rules(Some("  ".into())), None);
        assert_eq!(
            sanitize_extra_rules(Some("  prefer tests  ".into())).as_deref(),
            Some("prefer tests")
        );
        let long = "x".repeat(EXTRA_RULES_MAX_CHARS + 10);
        let capped = sanitize_extra_rules(Some(long)).expect("capped");
        assert_eq!(capped.chars().count(), EXTRA_RULES_MAX_CHARS);
    }

    #[test]
    fn session_max_agent_turns_default_none_and_normalize() {
        let raw = r#"{"id":"s1","projectId":null,"title":"t","agentSessionId":null,"createdAt":"2020-01-01T00:00:00Z","updatedAt":"2020-01-01T00:00:00Z"}"#;
        let m: SessionMeta =
            serde_json::from_str(raw).expect("legacy session without maxAgentTurns");
        assert!(m.max_agent_turns.is_none());
        assert_eq!(crate::acp_client::normalize_max_agent_turns(None), None);
        assert_eq!(crate::acp_client::normalize_max_agent_turns(Some(0)), None);
        assert_eq!(
            crate::acp_client::normalize_max_agent_turns(Some(50)),
            Some(50)
        );
        assert_eq!(
            crate::acp_client::normalize_max_agent_turns(Some(1)),
            Some(1)
        );
        assert_eq!(
            crate::acp_client::normalize_max_agent_turns(Some(200)),
            Some(200)
        );
        assert_eq!(
            crate::acp_client::normalize_max_agent_turns(Some(999)),
            Some(200)
        );
    }

    #[test]
    fn session_system_prompt_override_default_none_and_sanitize() {
        let raw = r#"{"id":"s1","projectId":null,"title":"t","agentSessionId":null,"createdAt":"2020-01-01T00:00:00Z","updatedAt":"2020-01-01T00:00:00Z"}"#;
        let m: SessionMeta =
            serde_json::from_str(raw).expect("legacy session without systemPromptOverride");
        assert!(m.system_prompt_override.is_none());
        assert_eq!(sanitize_system_prompt_override(None), None);
        assert_eq!(sanitize_system_prompt_override(Some("  ".into())), None);
        assert_eq!(
            sanitize_system_prompt_override(Some("  You are helpful  ".into())).as_deref(),
            Some("You are helpful")
        );
        // Strip NUL bytes.
        assert_eq!(
            sanitize_system_prompt_override(Some("a\0b\0c".into())).as_deref(),
            Some("abc")
        );
        assert_eq!(sanitize_system_prompt_override(Some("\0\0".into())), None);
        let long = "x".repeat(SYSTEM_PROMPT_OVERRIDE_MAX_CHARS + 10);
        let capped = sanitize_system_prompt_override(Some(long)).expect("capped");
        assert_eq!(capped.chars().count(), SYSTEM_PROMPT_OVERRIDE_MAX_CHARS);
    }

    #[test]
    fn general_workspace_dir_exists_without_sidebar_project() {
        let _ = ensure_app_dirs();
        let path = ensure_general_workspace_dir().expect("ensure dir");
        assert!(path.is_dir());
        let listed = load_projects();
        assert!(
            listed
                .iter()
                .all(|p| p.id != GENERAL_PROJECT_ID && !p.system),
            "general must not appear as a project: {:?}",
            listed.iter().map(|p| &p.id).collect::<Vec<_>>()
        );
    }

    #[test]
    fn create_session_defaults_to_orphan() {
        // Isolated home: parallel tests share default data dir and can race
        // atomic renames into sessions_index (macOS CI flake).
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-create-orphan-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let meta = create_session(None, Some("t".into()), false).expect("create");
        assert!(meta.project_id.is_none(), "got {:?}", meta.project_id);
        let _ = delete_session(&meta.id);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn set_session_worktree_marks_and_clears() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-wt-meta-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let meta = create_session(None, Some("wt".into()), false).expect("create");
        assert!(!meta.is_worktree_session);
        assert!(meta.worktree_path.is_none());
        let marked = set_session_worktree(
            &meta.id,
            Some("/tmp/repo-feat".into()),
            Some("feat/x".into()),
        )
        .expect("set");
        assert!(marked.is_worktree_session);
        assert_eq!(marked.worktree_path.as_deref(), Some("/tmp/repo-feat"));
        assert_eq!(marked.worktree_branch.as_deref(), Some("feat/x"));
        let cleared = set_session_worktree(&meta.id, None, None).expect("clear");
        assert!(!cleared.is_worktree_session);
        assert!(cleared.worktree_path.is_none());
        let _ = delete_session(&meta.id);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn session_meta_deserializes_without_worktree_fields() {
        let raw = r#"{
            "id":"s1","projectId":null,"title":"t",
            "agentSessionId":null,
            "createdAt":"2020-01-01T00:00:00Z",
            "updatedAt":"2020-01-01T00:00:00Z",
            "modelId":null,"archived":false,"pinned":false,"scheduled":false
        }"#;
        let m: SessionMeta = serde_json::from_str(raw).expect("legacy meta");
        assert!(!m.is_worktree_session);
        assert!(m.worktree_path.is_none());
        assert!(m.worktree_branch.is_none());
    }

    #[test]
    fn migrate_legacy_general_project_rehomes_sessions() {
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
            sandbox_profile: None,
            color: None,
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
                json_schema: None,
                scheduled: false,
                worktree_path: None,
                worktree_branch: None,
                is_worktree_session: false,
                plugin_dirs: Vec::new(),
                extra_rules: None,
                max_agent_turns: None,
                system_prompt_override: None,
                fork_agent_session: false,
                no_ask_user: None,
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

    fn sample_project(id: &str, pinned: bool, opened: DateTime<Utc>) -> Project {
        Project {
            id: id.into(),
            name: id.into(),
            path: format!("/tmp/{id}"),
            trusted: true,
            last_opened_at: opened,
            path_ok: true,
            pinned,
            system: false,
            model_id: None,
            effort: None,
            mode: None,
            permission_policy: None,
            sandbox_profile: None,
            color: None,
        }
    }

    #[test]
    fn project_pin_partition_preserves_relative_order() {
        let t1 = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let t2 = Utc.with_ymd_and_hms(2024, 1, 2, 0, 0, 0).unwrap();
        let t3 = Utc.with_ymd_and_hms(2024, 1, 3, 0, 0, 0).unwrap();
        let mut list = vec![
            sample_project("u-old", false, t1),
            sample_project("p-b", true, t2),
            sample_project("u-new", false, t3),
            sample_project("p-a", true, t1),
        ];
        apply_project_pin_partition(&mut list);
        let ids: Vec<&str> = list.iter().map(|p| p.id.as_str()).collect();
        // Relative order within each group preserved (not last_opened).
        assert_eq!(ids, vec!["p-b", "p-a", "u-old", "u-new"]);
    }

    #[test]
    fn reorder_projects_by_ids_clamps_unpinned_below_pinned() {
        let t = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let list = vec![
            sample_project("p1", true, t),
            sample_project("p2", true, t),
            sample_project("u1", false, t),
            sample_project("u2", false, t),
        ];
        // Client tries to put unpinned above pinned — host pin-partitions back.
        let ordered = ["u2", "p2", "u1", "p1"]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        let next = reorder_projects_by_ids(&list, &ordered);
        let ids: Vec<&str> = next.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["p2", "p1", "u2", "u1"]);
    }

    #[test]
    fn reorder_projects_by_ids_reorders_within_groups() {
        let t = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let list = vec![
            sample_project("p1", true, t),
            sample_project("p2", true, t),
            sample_project("u1", false, t),
            sample_project("u2", false, t),
        ];
        let ordered = ["p2", "p1", "u2", "u1"]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        let next = reorder_projects_by_ids(&list, &ordered);
        let ids: Vec<&str> = next.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["p2", "p1", "u2", "u1"]);
    }

    #[test]
    fn set_project_pinned_moves_to_group_end() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-pin-order-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();
        let t = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let seed = vec![
            sample_project("p1", true, t),
            sample_project("u1", false, t),
            sample_project("u2", false, t),
        ];
        write_json(&projects_file(), &seed).expect("seed");
        set_project_pinned("u1", true).expect("pin");
        let listed = load_projects();
        let ids: Vec<&str> = listed.iter().map(|p| p.id.as_str()).collect();
        // u1 becomes pinned and lands at end of pinned group.
        assert_eq!(ids, vec!["p1", "u1", "u2"]);
        set_project_pinned("p1", false).expect("unpin");
        let listed2 = load_projects();
        let ids2: Vec<&str> = listed2.iter().map(|p| p.id.as_str()).collect();
        // p1 unpinned → end of unpinned group.
        assert_eq!(ids2, vec!["u1", "u2", "p1"]);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
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

    #[test]
    fn effort_stays_per_session_under_global_scope() {
        // Effort is a per-chat decision even when model/mode memory is global:
        // raising it in one chat used to rewrite `settings.effort` and therefore
        // every other chat that had already picked its own.
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-effort-scope-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();

        let a = create_session(None, Some("a".into()), false).expect("create a");
        let b = create_session(None, Some("b".into()), false).expect("create b");
        save_composer_prefs(None, Some(&a.id), None, Some("low".into()), None, None)
            .expect("a low");
        save_composer_prefs(None, Some(&b.id), None, Some("max".into()), None, None)
            .expect("b max");

        assert_eq!(resolve_composer_prefs(None, Some(&a.id)).effort, "low");
        assert_eq!(resolve_composer_prefs(None, Some(&b.id)).effort, "max");
        // The global seed for future chats is left untouched by a per-chat change.
        assert_eq!(load_settings().effort.as_deref(), Some("xhigh"));

        let _ = delete_session(&a.id);
        let _ = delete_session(&b.id);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn draft_effort_seeds_global_without_touching_existing_sessions() {
        // A draft chat has no row yet, so its effort seeds the default for the
        // next chat — it must not leak into a chat that already chose one.
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-effort-draft-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = ensure_app_dirs();

        let existing = create_session(None, Some("kept".into()), false).expect("create");
        save_composer_prefs(
            None,
            Some(&existing.id),
            None,
            Some("max".into()),
            None,
            None,
        )
        .expect("existing max");

        save_composer_prefs(None, None, None, Some("low".into()), None, None).expect("draft low");

        assert_eq!(
            resolve_composer_prefs(None, Some(&existing.id)).effort,
            "max",
            "an existing chat keeps its own effort"
        );
        assert_eq!(load_settings().effort.as_deref(), Some("low"));
        // A brand-new chat inherits the seed.
        assert_eq!(resolve_composer_prefs(None, None).effort, "low");

        let _ = delete_session(&existing.id);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
