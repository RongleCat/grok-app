//! Spawn-side pure helpers for `grok agent stdio`: CLI flag builders,
//! capability probes (`cli_supports_*`), normalizers, and env mutation.
//! Extracted from `acp_client.rs` — this module holds only pure fns over
//! primitives/Command so flag behavior stays testable without a client.

use tokio::process::Command;

/// Pure helper: top-level CLI args for `--fork-session`.
///
/// `["--fork-session"]` when enabled; empty otherwise. The TUI requires this
/// with `--resume`/`--continue`. Host `agent stdio` uses ACP `session/fork`
/// instead of bare CLI flags (CLI errors without resume).
pub fn fork_session_spawn_flags(enabled: bool) -> Vec<&'static str> {
    if enabled {
        vec!["--fork-session"]
    } else {
        vec![]
    }
}

/// Extract the forked agent session id from an ACP fork response.
///
/// Accepts standard `sessionId` or Grok extension `newSessionId`. Rejects empty
/// and equal-to-source ids (fork must allocate a **new** id).
pub fn parse_fork_session_id(
    result: &serde_json::Value,
    source_session_id: &str,
) -> Option<String> {
    let raw = result
        .get("sessionId")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("newSessionId").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    // Fork semantics require a distinct id; reuse would mutate the source.
    if raw == source_session_id.trim() {
        return None;
    }
    Some(raw.to_string())
}

/// `session/set_mode` walks product-mode aliases. A transport failure is not
/// "unknown modeId" — abort the rest so agent mode cannot spend 5×45s and
/// leave fork + parent chats stuck on 连接中.
pub fn set_mode_abort_remaining_candidates(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("rpc timeout")
        || e.contains("rpc channel closed")
        || e.contains("stdout closed")
        || e.contains("write session/set_mode failed")
}

/// Pure helper: top-level CLI args for session extra rules (before `agent`).
///
/// `["--rules", text]` — empty when none. Trims, drops empty, clamps length.
pub fn extra_rules_spawn_flags(rules: Option<&str>) -> Vec<String> {
    let normalized = crate::store::sanitize_extra_rules(rules.map(|s| s.to_string()));
    match normalized {
        Some(text) => vec!["--rules".into(), text],
        None => Vec::new(),
    }
}

/// Pure helper: top-level `grok --trust` when the App folder is trusted.
///
/// Headless ACP has no interactive trust prompt; without this flag CLI skips
/// startup loading of project instructions (AGENTS.md) and project skills.
pub fn folder_trust_spawn_flags(trusted: bool) -> Vec<&'static str> {
    if trusted {
        vec!["--trust"]
    } else {
        vec![]
    }
}

/// Pure helper: top-level CLI args for system prompt override (before `agent`).
///
/// `["--system-prompt-override", text]` — empty when none.
/// Trims, strips NUL, drops empty, clamps length. Prefer the long flag name
/// (CLI also accepts `--system-prompt`).
pub fn system_prompt_override_spawn_flags(prompt: Option<&str>) -> Vec<String> {
    let normalized = crate::store::sanitize_system_prompt_override(prompt.map(|s| s.to_string()));
    match normalized {
        Some(text) => vec!["--system-prompt-override".into(), text],
        None => Vec::new(),
    }
}

/// Pure helper: agent-option CLI args for session plugin dirs (before `stdio`).
///
/// `["--plugin-dir", path, …]` — empty when no dirs. Trims, drops empty, dedupes.
pub fn plugin_dir_spawn_flags(dirs: &[String]) -> Vec<String> {
    let paths = crate::store::normalize_plugin_dirs(dirs.iter().cloned());
    let mut out = Vec::with_capacity(paths.len() * 2);
    for p in paths {
        out.push("--plugin-dir".into());
        out.push(p);
    }
    out
}

/// Map App policy → CLI `--permission-mode` value (policy only; no plan/YOLO override).
///
/// Official CLI enum: `default | acceptEdits | auto | dontAsk | bypassPermissions | plan`.
pub fn cli_permission_mode(policy: &str) -> &'static str {
    use crate::permission::PermissionPolicy;
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::Auto => "auto",
        PermissionPolicy::AlwaysApprove => "bypassPermissions",
        // Host session allow-list is applied in-process; CLI still asks.
        PermissionPolicy::AllowForSession
        | PermissionPolicy::AllowOnce
        | PermissionPolicy::Deny
        | PermissionPolicy::Ask => "default",
    }
}

/// Resolve effective CLI `--permission-mode` from App policy + product session mode.
///
/// Precedence (Grok Build): YOLO / `always_approve` → `bypassPermissions`;
/// product `plan` mode → `plan`; else policy table.
pub fn resolve_cli_permission_mode(policy: &str, product_mode: Option<&str>) -> &'static str {
    use crate::permission::PermissionPolicy;
    if matches!(
        PermissionPolicy::parse(policy),
        PermissionPolicy::AlwaysApprove
    ) {
        return "bypassPermissions";
    }
    if product_mode
        .map(|m| m.trim().eq_ignore_ascii_case("plan"))
        .unwrap_or(false)
    {
        return "plan";
    }
    cli_permission_mode(policy)
}

/// Top-level spawn args: `["--permission-mode", "<mode>"]`.
pub fn permission_mode_spawn_flags(policy: &str, product_mode: Option<&str>) -> [String; 2] {
    let mode = resolve_cli_permission_mode(policy, product_mode);
    ["--permission-mode".into(), mode.into()]
}

/// Whether agent should also get `--always-approve` (YOLO / bypassPermissions).
pub fn should_pass_always_approve(policy: &str, product_mode: Option<&str>) -> bool {
    resolve_cli_permission_mode(policy, product_mode) == "bypassPermissions"
}

/// Whether `id` is safe to pass as CLI `--reasoning-effort <id>`.
///
/// Accepts official Grok tiers (`low` / `medium` / `high`) and custom-channel
/// ids such as `max` / `xhigh`. Rejects empty, overly long, or non-token shapes.
/// Passed as a separate argv element (not shell-interpolated).
pub fn is_spawnable_reasoning_effort(id: &str) -> bool {
    let t = id.trim();
    if t.is_empty() || t.len() > 64 {
        return false;
    }
    let mut chars = t.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Pure spawn plan for the OS-level sandbox profile.
///
/// `--sandbox` is a **top-level** `grok` flag (not under `agent` / `stdio`),
/// and the CLI also reads `GROK_SANDBOX`. When the profile is off/empty we
/// apply neither so the agent stays unrestricted (CLI default).
///
/// Soft-fail: known-old CLIs (&lt; 0.2.112) omit the flag/env so clap does not
/// reject unknown `--sandbox` (AGENT_CRASHED). Unknown versions still emit
/// (forward-compatible with current Grok Build).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpawnSpec {
    pub profile: String,
}

/// First App-aligned floor where `--sandbox` / `GROK_SANDBOX` is expected.
pub const SANDBOX_MIN_CLI: (u64, u64, u64) = (0, 2, 112);

impl SandboxSpawnSpec {
    /// Build from a settings value. `None` means do not pass sandbox flags/env.
    pub fn from_setting(profile: &str) -> Option<Self> {
        let p = profile.trim();
        if p.is_empty() || p.eq_ignore_ascii_case("off") {
            return None;
        }
        Some(Self {
            profile: p.to_ascii_lowercase(),
        })
    }

    /// Top-level CLI args: `["--sandbox", "<profile>"]` (before `agent`).
    pub fn cli_args(&self) -> [String; 2] {
        ["--sandbox".into(), self.profile.clone()]
    }

    /// Env var name + value for `GROK_SANDBOX`.
    pub fn env_pair(&self) -> (String, String) {
        ("GROK_SANDBOX".into(), self.profile.clone())
    }
}

/// `Some(true)` when CLI ≥ sandbox min; `Some(false)` when older; `None` unparseable.
pub fn cli_supports_sandbox(raw_version: &str) -> Option<bool> {
    let token = crate::cli_probe::extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= SANDBOX_MIN_CLI)
}

/// Soft-fail: whether to apply sandbox flags/env for this CLI version.
///
/// - Known ≥ 0.2.112 → apply
/// - Known older → omit
/// - Unknown / missing → apply (forward-compatible; modern CLI accepts the flag)
pub fn should_apply_sandbox(raw_cli_version: Option<&str>) -> bool {
    match raw_cli_version {
        Some(v) => cli_supports_sandbox(v) != Some(false),
        None => true,
    }
}

/// Pure helper used by spawn + unit tests: args + env when sandbox is on.
pub fn sandbox_spawn_flags(profile: &str) -> Option<(Vec<String>, (String, String))> {
    let spec = SandboxSpawnSpec::from_setting(profile)?;
    Some((spec.cli_args().to_vec(), spec.env_pair()))
}

/// Soft-fail variant: omit when CLI is known older than {@link SANDBOX_MIN_CLI}.
pub fn sandbox_spawn_flags_soft(
    profile: &str,
    raw_cli_version: Option<&str>,
) -> Option<(Vec<String>, (String, String))> {
    if !should_apply_sandbox(raw_cli_version) {
        return None;
    }
    sandbox_spawn_flags(profile)
}

// ── Compaction mode / detail (CLI 0.2.117+) ────────────────────────────────
//
// Top-level: `--compaction-mode summary|transcript|segments` → GROK_COMPACTION_MODE
//            `--compaction-detail none|minimal|balanced|verbose` → GROK_COMPACTION_DETAIL
// Detail only affects `segments` (CLI default verbose). Host always sets env
// (ignored by older CLIs); CLI flags pass only when version ≥ 0.2.117.

/// First CLI version that accepts the compaction flags.
pub const COMPACTION_CLI_FLAGS_MIN: (u64, u64, u64) = (0, 2, 117);

pub const DEFAULT_COMPACTION_MODE: &str = "summary";
pub const DEFAULT_COMPACTION_DETAIL: &str = "verbose";

/// Normalize settings / UI value → known mode id.
pub fn normalize_compaction_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "transcript" => "transcript",
        "segments" => "segments",
        "summary" | "" => DEFAULT_COMPACTION_MODE,
        _ => DEFAULT_COMPACTION_MODE,
    }
}

/// Normalize settings / UI value → known detail id.
pub fn normalize_compaction_detail(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "none" => "none",
        "minimal" => "minimal",
        "balanced" => "balanced",
        "verbose" | "" => DEFAULT_COMPACTION_DETAIL,
        _ => DEFAULT_COMPACTION_DETAIL,
    }
}

/// Detail only applies when mode is `segments`.
pub fn compaction_detail_applies(mode: &str) -> bool {
    normalize_compaction_mode(mode) == "segments"
}

/// Top-level CLI argv for mode + optional detail (before `agent`).
pub fn compaction_spawn_args(mode: &str, detail: &str) -> Vec<String> {
    let m = normalize_compaction_mode(mode);
    let mut args = vec!["--compaction-mode".into(), m.into()];
    if compaction_detail_applies(m) {
        let d = normalize_compaction_detail(detail);
        args.push("--compaction-detail".into());
        args.push(d.into());
    }
    args
}

/// Env pairs for the agent process (always safe on older CLIs).
pub fn compaction_spawn_env(mode: &str, detail: &str) -> Vec<(String, String)> {
    let m = normalize_compaction_mode(mode);
    let mut out = vec![("GROK_COMPACTION_MODE".into(), m.into())];
    if compaction_detail_applies(m) {
        out.push((
            "GROK_COMPACTION_DETAIL".into(),
            normalize_compaction_detail(detail).into(),
        ));
    }
    out
}

/// Whether CLI flags should be passed (not only env).
/// Unknown / unparseable version → false (env-only soft-fail).
pub fn cli_supports_compaction_flags(raw_version: Option<&str>) -> bool {
    let Some(raw) = raw_version.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let Some(token) = crate::cli_probe::extract_version_token(raw) else {
        return false;
    };
    let Some(parsed) = crate::app_update::parse_semver(&token) else {
        return false;
    };
    parsed >= COMPACTION_CLI_FLAGS_MIN
}

/// Apply env always; CLI flags only when `pass_cli_flags` is true.
pub fn apply_compaction_to_command(
    cmd: &mut Command,
    mode: &str,
    detail: &str,
    pass_cli_flags: bool,
) {
    for (k, v) in compaction_spawn_env(mode, detail) {
        cmd.env(k, v);
    }
    if pass_cli_flags {
        for a in compaction_spawn_args(mode, detail) {
            cmd.arg(a);
        }
    }
}

pub const MAX_AGENT_TURNS_CAP: u32 = 200;
pub const MIN_AGENT_TURNS: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaxTurnsSpawnSpec {
    pub turns: u32,
}

impl MaxTurnsSpawnSpec {
    pub fn from_setting(raw: Option<u32>) -> Option<Self> {
        let n = raw?;
        if n == 0 {
            return None;
        }
        Some(Self {
            turns: n.clamp(MIN_AGENT_TURNS, MAX_AGENT_TURNS_CAP),
        })
    }

    pub fn cli_args(&self) -> [String; 2] {
        ["--max-turns".into(), self.turns.to_string()]
    }
}

pub fn normalize_max_agent_turns(raw: Option<u32>) -> Option<u32> {
    MaxTurnsSpawnSpec::from_setting(raw).map(|s| s.turns)
}

/// Session override wins when set (1–200); else global settings. 0 / None = inherit.
pub fn resolve_max_agent_turns(session: Option<u32>, global: Option<u32>) -> Option<u32> {
    normalize_max_agent_turns(session).or_else(|| normalize_max_agent_turns(global))
}

pub fn max_turns_cli_args(raw: Option<u32>) -> Option<Vec<String>> {
    let spec = MaxTurnsSpawnSpec::from_setting(raw)?;
    Some(spec.cli_args().to_vec())
}

// ── Background wait policy (CLI 0.2.117+, headless-first) ──────────────────

/// First CLI that accepts `--no-wait-for-background` / `--background-wait-timeout`.
pub const BACKGROUND_WAIT_MIN_CLI: (u64, u64, u64) = (0, 2, 117);

pub const MIN_BACKGROUND_WAIT_TIMEOUT_SEC: u32 = 1;
pub const MAX_BACKGROUND_WAIT_TIMEOUT_SEC: u32 = 3600;
pub const DEFAULT_BACKGROUND_WAIT_TIMEOUT_SEC: u32 = 600;

/// `wait` (default) | `no_wait` | `timeout`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackgroundWaitPolicy {
    Wait,
    NoWait,
    Timeout,
}

impl BackgroundWaitPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wait => "wait",
            Self::NoWait => "no_wait",
            Self::Timeout => "timeout",
        }
    }
}

/// Normalize a settings policy string. Unknown / empty → `wait`.
pub fn normalize_background_wait_policy(raw: &str) -> BackgroundWaitPolicy {
    let s = raw.trim().to_ascii_lowercase().replace('-', "_");
    match s.as_str() {
        "" | "wait" | "default" => BackgroundWaitPolicy::Wait,
        "no_wait" | "nowait" | "no_wait_for_background" | "false" => BackgroundWaitPolicy::NoWait,
        "timeout" | "timed" | "secs" | "seconds" => BackgroundWaitPolicy::Timeout,
        _ => BackgroundWaitPolicy::Wait,
    }
}

/// Clamp timeout seconds for `--background-wait-timeout` (1–3600).
pub fn normalize_background_wait_timeout_sec(raw: u32) -> u32 {
    raw.clamp(
        MIN_BACKGROUND_WAIT_TIMEOUT_SEC,
        MAX_BACKGROUND_WAIT_TIMEOUT_SEC,
    )
}

/// Top-level CLI argv for the policy. Empty for `wait` (CLI default).
pub fn background_wait_spawn_flags(policy: &str, timeout_sec: u32) -> Vec<String> {
    match normalize_background_wait_policy(policy) {
        BackgroundWaitPolicy::Wait => Vec::new(),
        BackgroundWaitPolicy::NoWait => vec!["--no-wait-for-background".into()],
        BackgroundWaitPolicy::Timeout => {
            let secs = normalize_background_wait_timeout_sec(timeout_sec);
            vec!["--background-wait-timeout".into(), secs.to_string()]
        }
    }
}

/// Whether two policy+timeout pairs are equivalent after normalize.
pub fn background_wait_settings_equal(
    a_policy: &str,
    a_timeout: u32,
    b_policy: &str,
    b_timeout: u32,
) -> bool {
    let pa = normalize_background_wait_policy(a_policy);
    let pb = normalize_background_wait_policy(b_policy);
    if pa != pb {
        return false;
    }
    if pa != BackgroundWaitPolicy::Timeout {
        return true;
    }
    normalize_background_wait_timeout_sec(a_timeout)
        == normalize_background_wait_timeout_sec(b_timeout)
}

/// `Some(true)` when CLI ≥ 0.2.117; `Some(false)` when older; `None` unparseable.
pub fn cli_supports_background_wait(raw_version: &str) -> Option<bool> {
    let token = crate::cli_probe::extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= BACKGROUND_WAIT_MIN_CLI)
}

/// Soft-fail gate: emit flags only when the CLI is known to support them.
///
/// - Known ≥ 0.2.117 → policy flags
/// - Known older / unknown + non-default → omit (avoid clap crash)
/// - Default `wait` → empty always
pub fn background_wait_spawn_flags_soft(
    policy: &str,
    timeout_sec: u32,
    raw_cli_version: Option<&str>,
) -> Vec<String> {
    let args = background_wait_spawn_flags(policy, timeout_sec);
    if args.is_empty() {
        return args;
    }
    match raw_cli_version {
        Some(v) if cli_supports_background_wait(v) == Some(true) => args,
        _ => Vec::new(),
    }
}

// ── Include partial stream events (CLI 0.2.117+, headless) ─────────────────

/// First CLI that accepts `--include-partial-messages`.
pub const INCLUDE_PARTIAL_MESSAGES_MIN_CLI: (u64, u64, u64) = (0, 2, 117);

/// Anthropic Messages API NDJSON wire format (pairs with partial stream events).
pub const HEADLESS_FORMAT_STREAMING_MESSAGES_JSON: &str = "streaming-messages-json";

/// ACP-native streaming NDJSON (Remote IM default; no partial stream events).
pub const HEADLESS_FORMAT_STREAMING_JSON: &str = "streaming-json";

/// True when format is `streaming-messages-json` (aliases normalized).
pub fn is_streaming_messages_json_format(format: &str) -> bool {
    let s = format.trim().to_ascii_lowercase().replace('_', "-");
    matches!(
        s.as_str(),
        "streaming-messages-json" | "streaming-message-json" | "messages-json"
    )
}

/// Top-level CLI flags for `--include-partial-messages`.
/// Empty unless `enabled` **and** format is `streaming-messages-json`.
pub fn include_partial_messages_spawn_flags(
    enabled: bool,
    output_format: &str,
) -> Vec<&'static str> {
    if enabled && is_streaming_messages_json_format(output_format) {
        vec!["--include-partial-messages"]
    } else {
        vec![]
    }
}

/// `Some(true)` when CLI ≥ 0.2.117; `Some(false)` when older; `None` unparseable.
pub fn cli_supports_include_partial_messages(raw_version: &str) -> Option<bool> {
    let token = crate::cli_probe::extract_version_token(raw_version)?;
    let parsed = crate::app_update::parse_semver(&token)?;
    Some(parsed >= INCLUDE_PARTIAL_MESSAGES_MIN_CLI)
}

/// Soft-fail gate: emit flag only when CLI is known to support it.
///
/// - Known ≥ 0.2.117 + enabled + streaming-messages-json → flag
/// - Known older / unknown → omit (avoid clap crash)
/// - Disabled or wrong format → empty always
pub fn include_partial_messages_spawn_flags_soft(
    enabled: bool,
    output_format: &str,
    raw_cli_version: Option<&str>,
) -> Vec<&'static str> {
    let args = include_partial_messages_spawn_flags(enabled, output_format);
    if args.is_empty() {
        return args;
    }
    match raw_cli_version {
        Some(v) if cli_supports_include_partial_messages(v) == Some(true) => args,
        _ => vec![],
    }
}

/// Load AppSettings + soft-gate for spawn sites (headless / ACP).
pub fn background_wait_spawn_flags_from_settings(
    settings: &crate::store::AppSettings,
    raw_cli_version: Option<&str>,
) -> Vec<String> {
    background_wait_spawn_flags_soft(
        &settings.background_wait_policy,
        settings.background_wait_timeout_sec,
        raw_cli_version,
    )
}

/// Resolve headless format + partial flag for Remote IM / diagnostics when the
/// user enables partial stream events.
///
/// - Partial on + CLI ≥ 0.2.117 → `streaming-messages-json` + flag
/// - Otherwise → `streaming-json` (no flag; soft-fail older CLI)
pub fn resolve_headless_stream_for_partial(
    include_partial: bool,
    raw_cli_version: Option<&str>,
) -> (&'static str, Vec<&'static str>) {
    let can = raw_cli_version.and_then(cli_supports_include_partial_messages) == Some(true);
    if include_partial && can {
        (
            HEADLESS_FORMAT_STREAMING_MESSAGES_JSON,
            vec!["--include-partial-messages"],
        )
    } else {
        (HEADLESS_FORMAT_STREAMING_JSON, vec![])
    }
}

/// Load settings + CLI version soft-gate for Remote IM headless.
pub fn resolve_headless_stream_from_settings(
    settings: &crate::store::AppSettings,
    raw_cli_version: Option<&str>,
) -> (&'static str, Vec<&'static str>) {
    resolve_headless_stream_for_partial(settings.include_partial_messages, raw_cli_version)
}

pub fn disable_web_search_spawn_flags(disable: bool) -> Vec<&'static str> {
    if disable {
        vec!["--disable-web-search"]
    } else {
        vec![]
    }
}

/// Session override wins when `Some`; else global Settings.
/// When effective true, spawn passes top-level `--no-ask-user` (CLI ≥ 0.2.117).
pub fn resolve_no_ask_user(session: Option<bool>, global: bool) -> bool {
    session.unwrap_or(global)
}

/// Top-level CLI flags for `--no-ask-user`. Empty when off (CLI default).
pub fn no_ask_user_spawn_flags(enabled: bool) -> Vec<&'static str> {
    if enabled {
        vec!["--no-ask-user"]
    } else {
        vec![]
    }
}

/// Normalize tool ids for `--disallowed-tools`: trim, drop empty, dedupe
/// case-insensitively (first spelling wins).
pub fn normalize_disallowed_tools(tools: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in tools {
        for piece in raw.split(',') {
            let t = piece.trim();
            if t.is_empty() {
                continue;
            }
            let key = t.to_ascii_lowercase();
            if seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            out.push(t.to_string());
        }
    }
    out
}

/// Spawn argv for denylist: `["--disallowed-tools", "a,b"]` or empty.
pub fn disallowed_tools_spawn_flags(tools: &[String]) -> Vec<String> {
    let cleaned = normalize_disallowed_tools(tools);
    if cleaned.is_empty() {
        return Vec::new();
    }
    vec!["--disallowed-tools".into(), cleaned.join(",")]
}

/// Order-independent, case-insensitive equality for soft-respawn flip checks.
pub fn disallowed_tools_equal(a: &[String], b: &[String]) -> bool {
    let mut aa: Vec<String> = normalize_disallowed_tools(a)
        .into_iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    let mut bb: Vec<String> = normalize_disallowed_tools(b)
        .into_iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    aa.sort();
    bb.sort();
    aa == bb
}

/// Normalize tool ids for `--tools` allowlist: same rules as denylist.
pub fn normalize_allowed_tools(tools: &[String]) -> Vec<String> {
    normalize_disallowed_tools(tools)
}

/// Spawn argv for allowlist: `["--tools", "a,b"]` or empty (CLI default = all).
pub fn allowed_tools_spawn_flags(tools: &[String]) -> Vec<String> {
    let cleaned = normalize_allowed_tools(tools);
    if cleaned.is_empty() {
        return Vec::new();
    }
    vec!["--tools".into(), cleaned.join(",")]
}

/// Order-independent, case-insensitive equality for soft-respawn flip checks.
pub fn allowed_tools_equal(a: &[String], b: &[String]) -> bool {
    disallowed_tools_equal(a, b)
}

pub fn no_plan_spawn_flags(plan_enabled: bool) -> Vec<&'static str> {
    if plan_enabled {
        vec![]
    } else {
        vec!["--no-plan"]
    }
}

pub fn leader_spawn_flag(use_leader: bool) -> &'static str {
    if use_leader {
        "--leader"
    } else {
        "--no-leader"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSpawnSpec {
    pub name: String,
}

impl AgentSpawnSpec {
    pub fn from_setting(raw: &str) -> Option<Self> {
        let name = crate::agents_catalog::normalize_preferred_agent(raw)?;
        Some(Self { name })
    }

    pub fn cli_args(&self) -> [String; 2] {
        ["--agent".into(), self.name.clone()]
    }
}

pub fn preferred_agent_spawn_flags(raw: &str) -> Option<Vec<String>> {
    crate::agents_catalog::agent_spawn_cli_args(raw)
}

/// Pure: agent-option `["--agent-profile", path]` when Settings path is set.
pub fn agent_profile_spawn_flags(raw: &str) -> Option<Vec<String>> {
    crate::agents_catalog::agent_profile_spawn_cli_args(raw)
}

/// Pure: top-level `["--agents", json]` when Settings agents JSON is set.
pub fn agents_json_spawn_flags(raw: &str) -> Option<Vec<String>> {
    crate::agents_catalog::agents_json_spawn_cli_args(raw)
}

pub(crate) fn apply_grok_build_proxy_env(
    cmd: &mut tokio::process::Command,
    native: &crate::providers::GrokBuildProxySpawn,
) {
    // Process-scoped only: expose the relay as Grok Build's native model
    // catalog / chat proxy and authenticate with the provider key. Never write
    // or log these values outside this child.
    cmd.env("GROK_MODELS_BASE_URL", &native.base_url);
    cmd.env("GROK_MODELS_LIST_URL", &native.models_url);
    cmd.env("GROK_CLI_CHAT_PROXY_BASE_URL", &native.base_url);
    cmd.env("XAI_API_KEY", &native.api_key);
}

/// Whether this ACP process should call `authenticate(cached_token)`.
///
/// Skip when:
/// - **custom relay** — Grok Build sends OIDC once `cached_token` succeeds,
///   even when the request URL is a custom relay (HTTP 400 Incorrect API key
///   / 401). `cached_token` reads `~/.grok/auth.json`, which official login
///   must keep for Account billing / official-aux. Clearing only agent-home
///   `auth.json` is not enough.
/// - **unsigned-in** — no usable cached token (`auth.json` missing, or no
///   `key` / `access_token` / `refresh_token`). The CLI has nothing to load;
///   sending `authenticate` waits `AUTH_TIMEOUT_SECS` twice then soft-fails
///   (~24s of ERROR logs) while the workbench still opens idle.
///
/// Keep the call when the official route is signed in. The #528
/// signed-in-but-agent-home-stale path still re-syncs and retries once.
pub fn should_authenticate_cached_token(custom_route: bool, has_cached_token: bool) -> bool {
    !custom_route && has_cached_token
}

/// Host-side probe: official OIDC material exists for `cached_token`.
///
/// Uses [`crate::account::read_auth_profile`] (canonical `~/.grok/auth.json`
/// preferred over an empty agent-home copy). Does not unlock the App keychain
/// or treat an official API key as a cached token — those are not what
/// `authenticate(cached_token)` loads.
pub fn has_cached_token_for_authenticate() -> bool {
    crate::account::read_auth_profile().signed_in
}
