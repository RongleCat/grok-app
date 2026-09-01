//! Real ACP client: spawn `grok agent stdio`, JSON-RPC line framing.
//! Default production transport. Mock only when GROK_APP_ACP=mock.

#![allow(dead_code)] // residual-clippy: spawn-flag helpers and unused field reads kept for protocol parity
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex as ParkingMutex;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex, Notify};
use tracing::{debug, error, info, warn};

use crate::error::{AgentError, AgentErrorCode};

#[derive(Debug, Clone)]
pub enum AcpEvent {
    State {
        backend: String,
        agent_session_id: Option<String>,
        model_id: Option<String>,
    },
    Stream {
        kind: StreamKind,
        text: String,
        message_id: Option<String>,
        done: bool,
    },
    ToolCall {
        tool_call_id: String,
        title: String,
        kind: String,
        status: String,
        raw: Value,
    },
    /// Background task handed off / finished (`task_backgrounded` / `task_completed`).
    ///
    /// Only affects Host open-tool accounting — does **not** rewrite journal tool
    /// rows. CLI may still stream `tool_call_update(in_progress)` after a
    /// completed(`[bg]`) tool; those must not keep the turn open.
    ToolOpenReleased {
        tool_call_id: String,
    },
    /// Live plan entries notification (sessionUpdate plan) and/or exit_plan_mode gate.
    Plan {
        entries: Value,
        /// Markdown / text body when available (exit_plan_mode planContent).
        body: Option<String>,
        /// Pending JSON-RPC id for `_x.ai/exit_plan_mode` (reply required).
        rpc_id: Option<u64>,
        tool_call_id: Option<String>,
    },
    /// Agent reverse-request `_x.ai/ask_user_question` (questionnaire / choices).
    AskUserQuestion {
        rpc_id: u64,
        tool_call_id: Option<String>,
        questions: Vec<AskUserQuestionItem>,
        raw: Value,
    },
    PermissionRequest {
        rpc_id: u64,
        tool_call_id: String,
        tool_name: String,
        title: String,
        options: Value,
        raw: Value,
    },
    PromptComplete {
        stop_reason: String,
        /// True only for the `session/prompt` RPC result — the real end of the
        /// turn, ordered after every chunk the agent sent.
        ///
        /// The `_x.ai/session/prompt_complete` *notification* fires early
        /// (tools still open, or more text still coming), so it must not be
        /// treated as terminal.
        authoritative: bool,
    },
    /// Provider/API retry loop (sessionUpdate = retry_state). Host caps retries.
    RetryState {
        attempt: u32,
        max_retries: u32,
        reason: String,
        status: String,
    },
    /// Context compaction (auto or manual `/compact`).
    ContextCompact {
        trigger: String,
        tokens_before: Option<u64>,
        tokens_after: Option<u64>,
        summary_preview: Option<String>,
        note: Option<String>,
    },
    /// Turn / context usage reported by the agent (when present).
    /// Prefer occupancy fields over UI char heuristics.
    ///
    /// Grok Build CLI occupancy (same as `/session-info` / auto-compact):
    ///   tokens_used / context_window → percentage
    /// Streamed as `params._meta.totalTokens` or `auto_compact_started.tokens_used`.
    /// Do **not** treat `turn_completed.usage.totalTokens` as occupancy (billing sum).
    UsageReported {
        /// Occupancy or billing total (see `source`).
        total_tokens: Option<u64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        /// Optional structured buckets (system / tools / history) when reported.
        system_tokens: Option<u64>,
        tools_tokens: Option<u64>,
        history_tokens: Option<u64>,
        /// Prompt-caching / reasoning / cost signals (ClaudeCode / Claude plans).
        cached_read_tokens: Option<u64>,
        cache_creation_tokens: Option<u64>,
        reasoning_tokens: Option<u64>,
        /// USD cost in integer ticks (see frontend `usdFromCostTicks`).
        cost_usd_ticks: Option<u64>,
        /// Model API rounds in this billing payload (`turn_completed.usage`).
        model_calls: Option<u64>,
        /// Summed reported per-call API time (ms). May under-count.
        api_duration_ms: Option<u64>,
        /// CLI `costIsPartial` — dollar figure may under-count.
        cost_is_partial: Option<bool>,
        /// CLI `usageIsIncomplete` — token/call totals may under-count.
        usage_is_incomplete: Option<bool>,
        /// Agent's model context window (CLI denominator for %).
        context_window: Option<u64>,
        /// Agent-reported integer percentage (CLI style), when present.
        percentage: Option<u64>,
        /// Optional raw kind for debugging (not shown to users).
        source: String,
    },
    Error {
        error: AgentError,
    },
    Stderr {
        line: String,
    },
    /// Hook lifecycle activity from ACP (`hook_execution` / `hook_annotation`).
    /// Forwarded to the UI for Settings → Extensions → Hooks “Recent activity”.
    HookActivity {
        /// Wire kind: `hook_execution` | `hook_annotation` | other.
        kind: String,
        /// Best-effort event name (PreToolUse, SessionStart, …).
        event_name: String,
        tool_name: Option<String>,
        /// True/false when status is known; None = info / annotation.
        ok: Option<bool>,
        /// Short detail (may still contain secrets — UI redacts).
        detail: String,
        /// Raw update object for richer client-side parsing (runs list, etc.).
        raw: Value,
    },
    /// Goal orchestration progress (CLI 0.2.117+ `sessionUpdate: goal_updated`).
    /// Forwarded as `session://goal` for Reliability “Goal orchestration”.
    /// Soft-fail: older CLIs never emit this — UI shows honest empty state.
    GoalUpdated {
        goal_id: Option<String>,
        /// `current_subagent_role` (classifier / planner / strategist / …).
        role: Option<String>,
        current_deliverable_title: Option<String>,
        completed_deliverables: Option<u32>,
        total_deliverables: Option<u32>,
        verifying_completion: Option<bool>,
        last_classifier_verdict: Option<String>,
        /// Raw update for client-side phase projection.
        raw: Value,
    },
    ProcessExited {
        code: Option<i32>,
    },
}

/// Host circuit-breaker: after this many provider retries, cancel the turn.
/// Custom relays / 中转 often flap mid-stream; 5 was too low and left users
/// stuck on "stream disconnected" after a few blips. Agent may advertise a
/// higher max; we still cap here so a wedged provider cannot retry forever.
///
/// Matches the CLI's own default (`xai-grok-sampler::retry::DEFAULT_MAX_RETRIES`
/// = 15). Capping below the CLI budget aborted turns the CLI would have
/// recovered (a relay that stabilizes between retry 12 and 15); keeping the
/// cap ≥ CLI default means only the CLI's own Fatal classification ends a
/// wedged turn.
pub const HOST_PROVIDER_MAX_RETRIES: u32 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Assistant,
    Thought,
}

struct Pending {
    method: String,
    tx: oneshot::Sender<Result<Value, String>>,
    /// Owning agent session (for session/prompt) — lets the prompt_complete
    /// fallback free only the right waiter when one process hosts several
    /// concurrent turns (concurrent multi-session).
    session_id: Option<String>,
}

const HANDSHAKE_TIMEOUT_SECS: u64 = 45;
const AUTH_TIMEOUT_SECS: u64 = 12;
/// Max wait for a single stdin write (JSON-RPC line). A wedged agent with a full
/// pipe used to block forever here — which froze interject ("引导"), cancel, and
/// any other Host→agent RPC before the request-level timeout could start.
const STDIN_WRITE_TIMEOUT_SECS: u64 = 8;
/// Max **silence** (no `session/update`) while waiting for `session/prompt`.
/// Every inbound update re-arms this window — do **not** cap on total turn age.
/// 30 minutes: a single image_gen can stay quiet longer than the old 10 min.
const PROMPT_IDLE_TIMEOUT_SECS: u64 = 1800;
/// Poll slice while waiting for the `session/prompt` oneshot.
const PROMPT_WAIT_SLICE_SECS: u64 = 5;
/// Legacy alias used in docs/comments — idle silence window for prompt RPC.
#[allow(dead_code)]
const PROMPT_TIMEOUT_SECS: u64 = PROMPT_IDLE_TIMEOUT_SECS;
/// After `_x.ai/session/prompt_complete`, wait this long for the real JSON-RPC
/// `session/prompt` result/error before treating the turn as successfully done.
/// Official subscription failures often emit prompt_complete first, then error.
/// Quiet window after an early `prompt_complete` before the pending
/// `session/prompt` waiter is released without an RPC result.
///
/// This is an **idle** window, not a deadline: every inbound `session/update`
/// re-arms it. The agent routinely fires `_x.ai/session/prompt_complete` while
/// it is still streaming the answer, and resolving the RPC on a fixed timer
/// ended the turn mid-answer — the host then dropped every later chunk as
/// replay, so the journal kept only a prefix and the chat looked stuck.
/// Prompt wait uses the same idle idea (`PROMPT_IDLE_TIMEOUT_SECS`) only —
/// total turn age is not a timeout.
const PROMPT_COMPLETE_FALLBACK_GRACE_MS: u64 = 3000;

/// Whether a `session/prompt` wait should fail for silence.
///
/// - `last_update`: last inbound `session/update` (None → use wait start as baseline)
/// - `wait_started`: when the RPC was dispatched
/// - `now`: current time
///
/// Progress resets the clock. A turn that keeps emitting updates may run
/// indefinitely; the user can Stop. Lost RPC / wedged silence still dies
/// after `idle_timeout`.
fn prompt_wait_should_timeout(
    last_update: Option<Instant>,
    wait_started: Instant,
    now: Instant,
    idle_timeout: Duration,
) -> bool {
    let baseline = last_update.unwrap_or(wait_started);
    now.saturating_duration_since(baseline) >= idle_timeout
}

/// Whether a pending prompt belongs to the fallback target session.
///
/// Only exact matches: both sides stamped with the same sid, or both unknown.
/// Cross-matching `(Some, None)` used to let session A's early `prompt_complete`
/// free session B's waiter on a shared process (P0-4). Unstamped / unique
/// fallbacks go through [`pending_prompt_ids_for`].
fn pending_prompt_matches(prompt_sid: Option<&str>, target: Option<&str>) -> bool {
    match (target, prompt_sid) {
        (Some(a), Some(b)) => a == b,
        (None, None) => true,
        _ => false,
    }
}

/// Select `session/prompt` waiters for a `prompt_complete` fallback.
///
/// Prefer exact sid matches. Only when that set is empty and **exactly one**
/// pending prompt exists, allow an unstamped/legacy pairing so single-session
/// CLI traffic without `sessionId` still completes.
fn pending_prompt_ids_for(pending: &HashMap<u64, Pending>, target: Option<&str>) -> Vec<u64> {
    let prompts: Vec<(u64, Option<&str>)> = pending
        .iter()
        .filter(|(_, p)| p.method == "session/prompt")
        .map(|(id, p)| (*id, p.session_id.as_deref()))
        .collect();
    let exact: Vec<u64> = prompts
        .iter()
        .filter(|(_, sid)| pending_prompt_matches(*sid, target))
        .map(|(id, _)| *id)
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    if prompts.len() == 1 {
        let (id, sid) = prompts[0];
        if target.is_none() || sid.is_none() {
            return vec![id];
        }
    }
    Vec::new()
}

/// Whether any prompt captured by a fallback is still awaiting its RPC result.
///
/// A fallback must stay bound to the prompt ids that existed when the matching
/// `prompt_complete` notification arrived. Looking up the session again later
/// can adopt a newer turn that started during the grace window.
fn has_pending_prompt_ids(pending: &HashMap<u64, Pending>, prompt_ids: &[u64]) -> bool {
    prompt_ids.iter().any(|id| {
        pending
            .get(id)
            .is_some_and(|p| p.method == "session/prompt")
    })
}

/// Remove only the prompt waiters captured by one fallback generation.
fn take_pending_prompt_ids(
    pending: &mut HashMap<u64, Pending>,
    prompt_ids: &[u64],
) -> Vec<(u64, Pending)> {
    prompt_ids
        .iter()
        .filter_map(|id| {
            let is_prompt = pending
                .get(id)
                .is_some_and(|p| p.method == "session/prompt");
            if is_prompt {
                pending.remove(id).map(|p| (*id, p))
            } else {
                None
            }
        })
        .collect()
}

/// Pure decision for the `prompt_complete` fallback: release the waiter only
/// when the agent has been quiet for `grace` since its last session update.
fn prompt_fallback_due(last_update: Option<Instant>, grace: Duration, now: Instant) -> bool {
    match last_update {
        None => true,
        Some(t) => now.saturating_duration_since(t) >= grace,
    }
}

pub struct AcpClient {
    /// The spawned CLI process, or `None` in API mode (connected to a remote
    /// ACP server over TCP instead of spawning `grok agent stdio`).
    child: AsyncMutex<Option<Child>>,
    /// Write half of the transport (child stdin, or the TCP write half). Both
    /// impl `AsyncWrite`, so the JSON-RPC line protocol is transport-agnostic.
    stdin: AsyncMutex<Option<Box<dyn AsyncWrite + Unpin + Send>>>,
    next_id: AtomicU64,
    pending: ParkingMutex<HashMap<u64, Pending>>,
    event_tx: mpsc::UnboundedSender<(Option<String>, AcpEvent)>,
    agent_session_id: ParkingMutex<Option<String>>,
    cli_path: PathBuf,
    cwd: PathBuf,
    stopped: AtomicBool,
    reader_alive: AtomicBool,
    /// Cancels the stdout/TCP read loop on an intentional shutdown. Without
    /// this, a remote ACP socket could keep its read half open and deliver late
    /// events after `kill()` had already released the session slot.
    reader_stop: Arc<Notify>,
    /// Recent stderr lines for crash diagnostics (ring, newest last).
    stderr_tail: ParkingMutex<Vec<String>>,
    /// Last inbound `session/update` per agent session id (P0-4).
    /// Stamped updates only extend that session's idle / prompt_complete grace.
    last_update_by_session: ParkingMutex<HashMap<String, Instant>>,
    /// Unstamped `session/update` (CLI omitted sessionId) — process-level only.
    last_update_unstamped: ParkingMutex<Option<Instant>>,
    /// Official side-channel: skip App MCP inject on session/new.
    empty_mcp_servers: bool,
    /// Effective `--sandbox` profile at spawn (process-level gate for parked reuse).
    sandbox_profile: ParkingMutex<Option<String>>,
    /// Route class at spawn: custom relay (api_key, no OIDC) vs official OIDC.
    /// Used by process reuse gate — must **not** be inferred from composer
    /// model id (custom routes often store the upstream model name, not the
    /// provider section id; that mis-labeled processes as "official" and
    /// let them be reused after auth.json was cleared → #528 re-login).
    custom_route: bool,
    /// Agent `initialize` advertisement for rewind RPCs.
    /// `None` = unknown (try RPC); `Some(false)` = skip; `Some(true)` = call.
    rewind_supported: ParkingMutex<Option<bool>>,
    /// OpenSSH alias this process was spawned with. Remote cwd is not local.
    ssh_alias: Option<String>,
}

/// Options applied at agent process start (CLI flags).
#[derive(Debug, Clone, Default)]
pub struct SpawnOptions {
    pub model_id: Option<String>,
    pub effort: Option<String>,
    /// App permission policy id (ask / accept_edits / …).
    pub permission_policy: Option<String>,
    /// Product session mode (`agent` | `plan` | `ask`) — plan maps to CLI `--permission-mode plan`.
    pub product_mode: Option<String>,
    /// Effective OS sandbox profile (`off` / `workspace` / …).
    /// When set, overrides `AppSettings.sandbox_profile` for this spawn.
    pub sandbox_profile: Option<String>,
    /// Optional JSON Schema for structured output (`grok --json-schema` top-level).
    /// When set, the model is constrained to produce matching JSON. Safe with
    /// `agent stdio` (verified: process stays up; ACP framing intact).
    pub json_schema: Option<String>,
    /// Session-only plugin directories → `grok agent --plugin-dir <DIR>` (repeatable).
    pub plugin_dirs: Vec<String>,
    /// Per-session extra rules → top-level `grok --rules <TEXT>` (before `agent`).
    pub extra_rules: Option<String>,
    /// Per-session max turns override → top-level `grok --max-turns N`.
    /// When set (after normalize), wins over `AppSettings.max_agent_turns`.
    pub max_agent_turns: Option<u32>,
    /// Per-session system prompt override → top-level
    /// `grok --system-prompt-override <TEXT>` (before `agent`).
    /// Never log the full value (may contain secrets / PII).
    pub system_prompt_override: Option<String>,
    /// Per-session override for top-level `grok --no-ask-user` (CLI ≥ 0.2.117).
    /// `Some(true|false)` wins over `AppSettings.no_ask_user`; `None` inherits.
    pub no_ask_user: Option<bool>,
    /// CLI `--fork-session` semantics: on open, fork the resume agent session
    /// into a **new** agent id (ACP `session/fork`) instead of `session/load`.
    /// Host sets this from `SessionMeta.fork_agent_session` for one-shot connect.
    pub fork_session: bool,
    /// When set, use this `GROK_HOME` instead of App session-data-mode home.
    /// Official aux side-channel uses `agent-home-official` so credentials never
    /// mix with a custom DeepSeek main process.
    pub grok_home_override: Option<std::path::PathBuf>,
    /// When true, `session/new` injects empty `mcpServers` (official side jobs
    /// must not re-inject the `official-aux` MCP that shells out to `grok -p`).
    pub empty_mcp_servers: bool,
    /// OpenSSH Host alias. When set, spawn `ssh -T` and run grok on that host
    /// (remote cwd). Do not treat `cwd` as a local `std::fs` path.
    pub ssh_alias: Option<String>,
}

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

fn apply_grok_build_proxy_env(
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

impl AcpClient {
    /// Effective sandbox profile this process was spawned with (reuse gate).
    pub fn sandbox_profile(&self) -> Option<String> {
        self.sandbox_profile.lock().clone()
    }

    pub fn use_mock() -> bool {
        std::env::var("GROK_APP_ACP")
            .map(|v| v.eq_ignore_ascii_case("mock"))
            .unwrap_or(false)
    }

    pub async fn spawn(
        cli_path: PathBuf,
        cwd: PathBuf,
    ) -> Result<
        (
            Arc<Self>,
            mpsc::UnboundedReceiver<(Option<String>, AcpEvent)>,
        ),
        AgentError,
    > {
        Self::spawn_with_options(cli_path, cwd, SpawnOptions::default()).await
    }

    pub async fn spawn_with_options(
        cli_path: PathBuf,
        cwd: PathBuf,
        opts: SpawnOptions,
    ) -> Result<
        (
            Arc<Self>,
            mpsc::UnboundedReceiver<(Option<String>, AcpEvent)>,
        ),
        AgentError,
    > {
        let settings = crate::store::load_settings();
        Self::spawn_with_home(cli_path, cwd, &settings.session_data_mode, opts).await
    }

    /// Spawn `grok agent stdio` with GROK_HOME from session_data_mode.
    pub async fn spawn_with_home(
        cli_path: PathBuf,
        cwd: PathBuf,
        session_data_mode: &str,
        opts: SpawnOptions,
    ) -> Result<
        (
            Arc<Self>,
            mpsc::UnboundedReceiver<(Option<String>, AcpEvent)>,
        ),
        AgentError,
    > {
        // API mode: if an ACP server address is configured, connect over TCP
        // instead of spawning a local CLI. The server drives an agent running
        // elsewhere (WSL/SSH/container) but speaks the identical ACP protocol.
        // Priority: TCP > SSH wrap > WSL spawn > native spawn.
        let settings_early = crate::store::load_settings();
        if let Some(addr) = settings_early
            .acp_server_addr
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Self::connect_tcp(addr, cwd).await;
        }

        let ssh_alias = opts
            .ssh_alias
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && crate::ssh_remote::is_safe_ssh_alias(s))
            .map(|s| s.to_string());

        let wsl_launch = if ssh_alias.is_some() {
            None
        } else {
            crate::wsl_backend::resolve_wsl_launch(&settings_early)
        };
        let cli_path = if let Some(ref w) = wsl_launch {
            crate::wsl_backend::wsl_display_path(w)
        } else if ssh_alias.is_some() {
            std::path::PathBuf::from("grok")
        } else {
            cli_path
        };

        if ssh_alias.is_none() && wsl_launch.is_none() && !cli_path.exists() {
            return Err(AgentError::new(
                AgentErrorCode::CliNotFound,
                format!("CLI not found: {}", cli_path.display()),
            ));
        }
        if wsl_launch.is_some() && crate::wsl_backend::find_wsl_exe().is_none() {
            return Err(AgentError::new(
                AgentErrorCode::CliNotFound,
                "wsl.exe not found — install WSL or set CLI backend to native".to_string(),
            ));
        }

        // Gate on CLI version BEFORE spawning (NEW-03). The flag set below is
        // 0.2.x-specific; an older CLI rejects it and dies, which the user only
        // ever sees as AGENT_CRASHED with no hint that the CLI is the problem.
        // Unknown/unparseable versions pass through — fail open, not closed.
        let version_raw = if ssh_alias.is_some() {
            None
        } else if let Some(ref w) = wsl_launch {
            crate::wsl_backend::read_wsl_version(w)
        } else {
            crate::cli_probe::read_version_of(&cli_path)
        };
        if let Some(raw) = version_raw.as_deref() {
            if crate::cli_probe::cli_version_supported(raw) == Some(false) {
                return Err(AgentError::new(
                    AgentErrorCode::CliTooOld,
                    format!(
                        "grok CLI {} is older than the required {}",
                        crate::cli_probe::extract_version_token(raw)
                            .unwrap_or_else(|| raw.trim().to_string()),
                        crate::cli_probe::min_cli_version_str()
                    ),
                ));
            }
        }

        let (event_tx, event_rx) = mpsc::unbounded_channel();

        // GUI apps often inherit a sparse PATH; keep absolute cli_path but enrich PATH
        // so nested tools (npx, node, git) resolve when the agent shells out.
        //
        // Flag placement (CLI 0.2.x):
        //   top-level: `grok --no-auto-update --permission-mode <MODE> [--sandbox …] agent …`
        //   agent opts: `--model` / `--reasoning-effort` / `--always-approve` before `stdio`
        //   Flags after `stdio` are rejected (`unexpected argument '--model'`).
        //   `--permission-mode` is top-level `grok` only — not under `grok agent`.
        let empty_mcp_servers = opts.empty_mcp_servers;
        let home_override = opts.grok_home_override.clone();
        // Route class is process-scoped (auth material + config.toml). Official
        // aux override home is always OIDC-side; main home follows active_route.
        // Custom relays live only in agent-home — force that GROK_HOME even when
        // session_data_mode=shared so third-party keys work without official login (#557).
        let custom_route = if home_override.is_some() {
            false
        } else {
            matches!(
                crate::providers::active_route(),
                crate::providers::ActiveRoute::Custom { .. }
            )
        };
        let grok_home = if let Some(ref h) = home_override {
            h.clone()
        } else {
            crate::paths::resolve_inference_grok_home(session_data_mode, custom_route)
        };
        let _ = std::fs::create_dir_all(&grok_home);
        // Prep agent-home when independent *or* custom (shared+custom still uses agent-home).
        // Side-channel with explicit home: never touch main agent-home auth.
        let agent_home_prep = ssh_alias.is_none()
            && home_override.is_none()
            && crate::paths::needs_agent_home_spawn_prep(session_data_mode, custom_route);
        // Preference syncs write independent-only; for shared+custom force independent
        // so agent-home receives permission / feature pins the relay process needs.
        let prep_mode = if custom_route {
            "independent"
        } else {
            session_data_mode
        };
        if agent_home_prep {
            // Official → sync OIDC; custom → strip auth.json (api_key only).
            crate::providers::prepare_route_auth_for_agent();
            if let Some(ref pol) = opts.permission_policy {
                let _ = crate::agent_prefs::sync_permission_to_agent_profile(prep_mode, pol);
            }
        }

        // Composer may hold a catalog id while the active channel is a custom
        // provider — resolve to the route id Grok Build actually understands.
        // Override home (official aux): pass model id through as catalog id.
        let grok_build_proxy = if ssh_alias.is_some() || home_override.is_some() {
            None
        } else {
            crate::providers::active_grok_build_proxy_spawn(opts.model_id.as_deref().unwrap_or(""))
        };
        let spawn_model = if ssh_alias.is_some() {
            let m = opts.model_id.as_deref().unwrap_or("").trim();
            if m.is_empty() || crate::providers::is_custom_provider_id(m) {
                crate::providers::OFFICIAL_CATALOG_MODEL.to_string()
            } else {
                m.to_string()
            }
        } else if let Some(ref native) = grok_build_proxy {
            native.model.clone()
        } else if home_override.is_some() {
            let m = opts.model_id.as_deref().unwrap_or("").trim();
            if m.is_empty() {
                crate::providers::OFFICIAL_CATALOG_MODEL.to_string()
            } else {
                m.to_string()
            }
        } else {
            crate::providers::agent_spawn_model_id(opts.model_id.as_deref().unwrap_or(""))
        };

        // Flag placement (CLI 0.2.x):
        //   top-level: `grok --no-auto-update --permission-mode <MODE> [--sandbox PROFILE] agent …`
        //   agent opts: `--model` / `--reasoning-effort` / `--always-approve` before `stdio`
        // Skip background update checks so ACP handshakes are not delayed on launch.
        // `--sandbox` / `--permission-mode` are top-level only (not under `grok agent`);
        // also set GROK_SANDBOX so nested tools inherit the same profile.
        let settings = crate::store::load_settings();
        // Project override (via SpawnOptions) wins over global Settings.
        let sandbox_raw = opts
            .sandbox_profile
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(settings.sandbox_profile.as_str());
        // Soft-fail known-old CLIs (omit --sandbox / GROK_SANDBOX) so clap
        // does not reject the flag. cli_ver is probed just below — compute
        // after version read.
        let sandbox_raw_owned = sandbox_raw.to_string();
        // Session override if set (1–200); else global Settings. 0 / None = inherit.
        let max_turns = MaxTurnsSpawnSpec::from_setting(resolve_max_agent_turns(
            opts.max_agent_turns,
            settings.max_agent_turns,
        ));
        let preferred_agent = AgentSpawnSpec::from_setting(&settings.preferred_agent);
        let agent_profile =
            crate::agents_catalog::normalize_agent_profile_path(&settings.agent_profile_path);
        let agents_json_args = agents_json_spawn_flags(&settings.agents_json);
        let subagents_enabled = settings.subagents_enabled;
        let subagent_wt_snap = settings.subagent_worktree_snapshot_enabled;
        let auto_wake_enabled = settings.auto_wake_enabled;
        let two_pass_compaction = settings.two_pass_compaction_enabled;
        let memory_enabled = settings.experimental_memory;
        // SSH Wave 4 always asks for --leader. The remote script fail-opens to
        // --no-leader if `~/.grok/leader.sock` never appears.
        let use_leader = ssh_alias.is_some() || settings.use_leader;
        let plan_enabled = settings.plan_enabled;
        let disable_web = settings.disable_web_search;
        // Session override wins when set; else global Settings.
        let no_ask_user = resolve_no_ask_user(opts.no_ask_user, settings.no_ask_user);
        // Custom main + official-aux inject: block native Imagine tools so the
        // model cannot call image_gen/image_edit against the wrong GROK_HOME
        // (HTTP 400 Incorrect API key). Force official-aux__* instead.
        let disallowed_tools =
            crate::official_aux::merge_disallowed_tools_for_main(&settings.disallowed_tools);
        let allowed_tools = settings.allowed_tools.clone();
        let todo_gate_enabled = settings.todo_gate_enabled;
        let todo_gate_max_fires = crate::agent_todo_gate::normalize_todo_gate_max_fires(Some(
            settings.todo_gate_max_fires_per_prompt,
        ));
        let compaction_mode = settings.compaction_mode.clone();
        let compaction_detail = settings.compaction_detail.clone();
        let spawn_policy = opts.permission_policy.as_deref().unwrap_or("ask");
        let spawn_product_mode = opts.product_mode.as_deref();
        // Headless-only in effect; still pass top-level when CLI ≥ 0.2.117 so
        // automations / future ACP paths share one policy. Soft-fail older CLIs.
        let cli_ver = version_raw.clone();
        let bg_wait_args = background_wait_spawn_flags_from_settings(&settings, cli_ver.as_deref());
        // Soft-fail known-old CLIs: omit --sandbox / GROK_SANDBOX.
        let sandbox = if should_apply_sandbox(cli_ver.as_deref()) {
            SandboxSpawnSpec::from_setting(&sandbox_raw_owned)
        } else {
            None
        };
        // Soft-fail older CLIs for GROK_SUBAGENT_WORKTREE_SNAPSHOT env.
        let cli_ver = version_raw.clone();

        if agent_home_prep {
            let _ = crate::agent_subagents::sync_subagents_to_agent_profile(
                prep_mode,
                subagents_enabled,
            );
            let _ = crate::agent_memory::sync_memory_to_agent_profile(prep_mode, memory_enabled);
            let _ = crate::agent_todo_gate::sync_todo_gate_to_agent_profile(
                prep_mode,
                todo_gate_enabled,
                todo_gate_max_fires,
            );
            let _ = crate::agent_subagent_wt_snap::sync_subagent_wt_snap_to_agent_profile(
                prep_mode,
                subagent_wt_snap,
            );
            let _ = crate::agent_auto_wake::sync_auto_wake_to_agent_profile(
                prep_mode,
                auto_wake_enabled,
            );
            let _ = crate::agent_two_pass_compaction::sync_two_pass_compaction_to_agent_profile(
                prep_mode,
                two_pass_compaction,
            );
            // Custom + inject: PreToolUse hook blocks native Imagine (ACP ignores
            // --disallowed-tools which is headless-only). Official route / inject
            // off removes the managed hook file.
            let _ = crate::official_aux::sync_native_media_block_hook_for_current(prep_mode);
            let _ = crate::extensions::sync_user_mcp_for_official_aux_inject(prep_mode);
            // Heal duplicate keys left by older upsert bugs (e.g. yolo vs yolo_mode).
            // Valid configs are never rewritten. Soft-fail so spawn still attempts.
            match crate::agent_home_config::ensure_agent_home_config_sane(prep_mode) {
                Ok(report) if report.changed => {
                    tracing::info!(
                        target: "acp_client",
                        removed = report.removed_duplicates,
                        backup = ?report.backup_path,
                        "agent-home config.toml healed before spawn"
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(
                        target: "acp_client",
                        error = %e,
                        "agent-home config.toml heal failed; spawn may AGENT_CRASHED"
                    );
                }
            }
        }

        // Native: `grok …`; WSL: `wsl.exe [-d] --cd <linux_cwd> -- <linux_cli> …`
        // SSH: collect grok flags first, then wrap as one remote `ssh -T` script.
        // OpenSSH joins the remote command into a single `-c` string — extra
        // argv after `bash -lc` is not a real argv array on the host.
        // (env vars set on the Windows process and forwarded via WSLENV).
        let mut cmd = if ssh_alias.is_some() {
            Command::new("grok")
        } else if let Some(ref w) = wsl_launch {
            let linux_cwd = crate::wsl_backend::windows_path_to_wsl(&cwd).map_err(|e| {
                AgentError::new(
                    AgentErrorCode::CliNotFound,
                    format!("WSL cwd path map failed: {e}"),
                )
            })?;
            crate::wsl_backend::start_wsl_tokio_command(w, &linux_cwd)
                .map_err(|e| AgentError::new(AgentErrorCode::CliNotFound, e))?
        } else {
            Command::new(&cli_path)
        };
        cmd.arg("--no-auto-update");
        // Compaction mode/detail (CLI 0.2.117+): always set env; flags only when
        // the probed binary is known to accept them (soft-fail on older CLIs).
        let pass_compaction_flags = cli_supports_compaction_flags(cli_ver.as_deref());
        apply_compaction_to_command(
            &mut cmd,
            &compaction_mode,
            &compaction_detail,
            pass_compaction_flags,
        );
        // Pin CLI permission mode so agent-side enforcement matches App policy / plan.
        for a in permission_mode_spawn_flags(spawn_policy, spawn_product_mode) {
            cmd.arg(a);
        }
        if let Some(ref sb) = sandbox {
            for a in sb.cli_args() {
                cmd.arg(a);
            }
        }
        if let Some(ref mt) = max_turns {
            for a in mt.cli_args() {
                cmd.arg(a);
            }
        }
        for a in &bg_wait_args {
            cmd.arg(a);
        }
        // Top-level `grok --json-schema <SCHEMA>` (before `agent`). Constrains
        // model output; headless docs mention --output-format json, but ACP
        // stdio still accepts the flag and keeps the process alive.
        if let Some(ref schema) = opts.json_schema {
            let s = schema.trim();
            if !s.is_empty() {
                cmd.arg("--json-schema");
                cmd.arg(s);
            }
        }
        // Top-level `grok --rules <RULES>` (before `agent`) — session-only
        // system-prompt append; not accepted under `grok agent` / `stdio`.
        for a in extra_rules_spawn_flags(opts.extra_rules.as_deref()) {
            cmd.arg(a);
        }
        // Top-level `grok --system-prompt-override <PROMPT>` (before `agent`) —
        // session-only full system prompt replacement (alias: --system-prompt).
        // Do not log the prompt body (may contain secrets / PII).
        for a in system_prompt_override_spawn_flags(opts.system_prompt_override.as_deref()) {
            cmd.arg(a);
        }
        for f in disable_web_search_spawn_flags(disable_web) {
            cmd.arg(f);
        }
        // Top-level `grok --no-ask-user` (before `agent`) — disables ask-user
        // questionnaires for this process (CLI ≥ 0.2.117).
        for f in no_ask_user_spawn_flags(no_ask_user) {
            cmd.arg(f);
        }
        for a in allowed_tools_spawn_flags(&allowed_tools) {
            cmd.arg(a);
        }
        for a in disallowed_tools_spawn_flags(&disallowed_tools) {
            cmd.arg(a);
        }
        // Top-level `grok --todo-gate` (CLI 0.2.117+). Overrides remote
        // todo_gate_enabled and the built-in default (false). Max fires is
        // config-only (independent agent-home); no CLI flag.
        crate::agent_todo_gate::apply_todo_gate_to_command(&mut cmd, todo_gate_enabled);
        for f in no_plan_spawn_flags(plan_enabled) {
            cmd.arg(f);
        }
        if let Some(ref agent) = preferred_agent {
            for a in agent.cli_args() {
                cmd.arg(a);
            }
        }
        // Top-level `grok --agents <JSON>` — inline subagent defs; empty omits.
        // Does not write into shared ~/.grok (spawn argv only).
        if let Some(ref aa) = agents_json_args {
            for a in aa {
                cmd.arg(a);
            }
        }
        crate::agent_subagents::apply_subagents_to_command(&mut cmd, subagents_enabled);
        crate::agent_memory::apply_memory_to_command(&mut cmd, memory_enabled);
        // Config-only surface (CLI 0.2.117+): env + independent agent-home key.
        crate::agent_subagent_wt_snap::apply_subagent_wt_snap_to_command(
            &mut cmd,
            subagent_wt_snap,
            cli_ver.as_deref(),
        );
        // Two-pass prefire compaction (CLI 0.2.117+): env + independent agent-home.
        crate::agent_two_pass_compaction::apply_two_pass_compaction_to_command(
            &mut cmd,
            two_pass_compaction,
            cli_ver.as_deref(),
        );
        crate::agent_auto_wake::apply_auto_wake_to_command(
            &mut cmd,
            auto_wake_enabled,
            session_data_mode,
        );
        cmd.arg("agent");
        cmd.arg(leader_spawn_flag(use_leader));
        // Agent option: `--agent-profile <PATH>` (before `stdio`). Path only —
        // does not rewrite app agent-home or shared ~/.grok. Skip on SSH — the
        // path is local and would not exist on the host.
        if ssh_alias.is_none() {
            if let Some(ref profile_path) = agent_profile {
                cmd.arg("--agent-profile");
                cmd.arg(profile_path);
            }
        }
        if !spawn_model.is_empty() {
            cmd.args(["--model", &spawn_model]);
        }
        if let Some(ref e) = opts.effort {
            let e = e.trim();
            // Pass any catalog/channel effort id (low/medium/high, max, …).
            // Do not hard-allowlist only Grok 3-tier — custom channels use max etc.
            if is_spawnable_reasoning_effort(e) {
                cmd.args(["--reasoning-effort", e]);
            }
        }
        if should_pass_always_approve(spawn_policy, spawn_product_mode) {
            cmd.arg("--always-approve");
        }
        // Session-only plugins (Agent SDKs / App): process-scoped, always trusted.
        // Does not write global Extensions or `~/.grok` install state.
        for a in plugin_dir_spawn_flags(&opts.plugin_dirs) {
            cmd.arg(a);
        }
        cmd.arg("stdio");
        if let Some(ref alias) = ssh_alias {
            let grok_args: Vec<String> = cmd
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            cmd = crate::ssh_remote::start_ssh_acp_command(
                alias,
                cwd.to_string_lossy().as_ref(),
                &grok_args,
            )
            .map_err(|e| AgentError::new(AgentErrorCode::ConnectFailed, e))?;
        }
        if ssh_alias.is_none() && wsl_launch.is_none() {
            cmd.current_dir(&cwd);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        crate::process_util::apply_no_window_tokio(&mut cmd);
        if ssh_alias.is_none() && wsl_launch.is_none() {
            crate::process_util::ensure_home_env_tokio(&mut cmd);
            if let Some(path) = crate::process_util::enriched_path_env() {
                cmd.env("PATH", path);
            }
        }
        if ssh_alias.is_none() {
            cmd.env("GROK_HOME", &grok_home);
        }
        if let Some(ref native) = grok_build_proxy {
            apply_grok_build_proxy_env(&mut cmd, native);
        }
        // Do NOT set GROK_IMAGE_DESCRIPTION_MODEL / GROK_WEB_SEARCH_MODEL on the
        // main agent process: when main is DeepSeek, those envs make CLI send
        // model id `grok-4.5` to the DeepSeek base_url (400). Generic custom
        // routes use Host prepare_agent_prompt + optional MCP official-aux;
        // grok_build_proxy gets search/X through the native catalog env above.
        // Attachment semantics are unchanged: ACP still sends @path text, not
        // a native image content block.
        //
        // Always disable Claude/Cursor MCP compat for App agent-home sessions.
        // Grok merges ~/.claude.json / Cursor MCP by default; those hang for ~30s
        // and pollute custom-main tool discovery. App injects only what it needs
        // via session mcpServers (official-aux / Extensions). Opt back in with
        // official_aux_with_user_mcp (Extensions MCPs), not Claude dump.
        // Grok docs: GROK_CLAUDE_MCPS_ENABLED / GROK_CURSOR_MCPS_ENABLED.
        cmd.env("GROK_CLAUDE_MCPS_ENABLED", "false");
        cmd.env("GROK_CURSOR_MCPS_ENABLED", "false");
        // Route agent traffic through the configured proxy (NEW-02). Windows
        // system proxy is registry-only and never reaches children as env vars.
        crate::proxy::apply_to_tokio_command(&mut cmd);
        if let Some(ref sb) = sandbox {
            let (k, v) = sb.env_pair();
            cmd.env(k, v);
        }
        // Forward selected env into the Linux process (path-translate GROK_HOME).
        if wsl_launch.is_some() {
            crate::wsl_backend::apply_wslenv(&mut cmd);
        }
        tracing::info!(
            "acp: spawn home={} ssh={:?} mode={} model={} effort={:?} native_grok_proxy={} sandbox={:?} max_turns={:?} fork_session={} no_ask_user={} leader={} subagents={} memory={} compaction_mode={} compaction_detail={} compaction_flags={} agent_profile={:?} agents_json={}",
            grok_home.display(),
            ssh_alias,
            session_data_mode,
            spawn_model,
            opts.effort,
            grok_build_proxy.is_some(),
            sandbox.as_ref().map(|s| s.profile.as_str()),
            max_turns.as_ref().map(|m| m.turns),
            opts.fork_session,
            no_ask_user,
            use_leader,
            subagents_enabled,
            memory_enabled,
            normalize_compaction_mode(&compaction_mode),
            if compaction_detail_applies(&compaction_mode) {
                normalize_compaction_detail(&compaction_detail)
            } else {
                "-"
            },
            pass_compaction_flags,
            agent_profile.as_deref(),
            agents_json_args.is_some(),
        );

        let mut child = cmd.spawn().map_err(|e| {
            let code = if ssh_alias.is_some() {
                AgentErrorCode::ConnectFailed
            } else {
                AgentErrorCode::CliNotFound
            };
            AgentError::new(code, format!("failed to spawn grok agent stdio: {e}"))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentError::new(AgentErrorCode::AgentCrashed, "no stdin on child"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::new(AgentErrorCode::AgentCrashed, "no stdout on child"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::new(AgentErrorCode::AgentCrashed, "no stderr on child"))?;

        let client = Arc::new(Self {
            child: AsyncMutex::new(Some(child)),
            stdin: AsyncMutex::new(Some(Box::new(stdin) as Box<dyn AsyncWrite + Unpin + Send>)),
            next_id: AtomicU64::new(1),
            pending: ParkingMutex::new(HashMap::new()),
            event_tx: event_tx.clone(),
            agent_session_id: ParkingMutex::new(None),
            cli_path,
            cwd,
            stopped: AtomicBool::new(false),
            reader_alive: AtomicBool::new(true),
            reader_stop: Arc::new(Notify::new()),
            stderr_tail: ParkingMutex::new(Vec::new()),
            last_update_by_session: ParkingMutex::new(HashMap::new()),
            last_update_unstamped: ParkingMutex::new(None),
            empty_mcp_servers,
            sandbox_profile: ParkingMutex::new(sandbox.map(|sb| sb.profile.clone())),
            custom_route,
            rewind_supported: ParkingMutex::new(None),
            ssh_alias: ssh_alias.clone(),
        });

        client.start_read_loop(Box::new(stdout));

        // stderr reader (separate tee + ring buffer)
        {
            let c = Arc::clone(&client);
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let t = line.trim_end().to_string();
                            if !t.is_empty() {
                                c.push_stderr(&t);
                                let _ = c.event_tx.send((None, AcpEvent::Stderr { line: t }));
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok((client, event_rx))
    }

    /// **API mode.** Connect to a remote ACP server over TCP (host:port)
    /// instead of spawning `grok agent stdio`. The server speaks the exact
    /// same newline-delimited JSON-RPC ACP protocol on the socket — this lets
    /// the app drive an agent running elsewhere (a WSL/SSH/container agent, a
    /// shared build host, or a `socat`-fronted CLI). No child process, no
    /// stderr stream; the read half is wired to the same line reader.
    ///
    /// Connect to an ACP server without blocking a Tokio worker. The explicit
    /// connect deadline is important for unreachable/half-open API endpoints:
    /// a synchronous `std::net::TcpStream::connect` here used to hold the
    /// session connect lock and starve every other chat until the OS timeout.
    pub async fn connect_tcp(
        addr: &str,
        cwd: PathBuf,
    ) -> Result<
        (
            Arc<Self>,
            mpsc::UnboundedReceiver<(Option<String>, AcpEvent)>,
        ),
        AgentError,
    > {
        const ACP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
        let stream = tokio::time::timeout(ACP_CONNECT_TIMEOUT, TcpStream::connect(addr))
            .await
            .map_err(|_| {
                AgentError::new(
                    AgentErrorCode::CliNotFound,
                    format!(
                        "ACP server connect timed out after {}s: {addr}",
                        ACP_CONNECT_TIMEOUT.as_secs()
                    ),
                )
            })?
            .map_err(|e| {
                AgentError::new(
                    AgentErrorCode::CliNotFound,
                    format!("failed to connect ACP server {addr}: {e}"),
                )
            })?;
        let _ = stream.set_nodelay(true);
        let (read_half, write_half) = stream.into_split();

        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let client = Arc::new(Self {
            child: AsyncMutex::new(None),
            stdin: AsyncMutex::new(Some(
                Box::new(write_half) as Box<dyn AsyncWrite + Unpin + Send>
            )),
            next_id: AtomicU64::new(1),
            pending: ParkingMutex::new(HashMap::new()),
            event_tx,
            agent_session_id: ParkingMutex::new(None),
            cli_path: PathBuf::from(format!("tcp://{addr}")),
            cwd,
            stopped: AtomicBool::new(false),
            reader_alive: AtomicBool::new(true),
            reader_stop: Arc::new(Notify::new()),
            stderr_tail: ParkingMutex::new(Vec::new()),
            last_update_by_session: ParkingMutex::new(HashMap::new()),
            last_update_unstamped: ParkingMutex::new(None),
            // TCP connect path keeps default MCP inject (not official side-channel).
            empty_mcp_servers: false,
            sandbox_profile: ParkingMutex::new(None),
            // Remote ACP: treat as official-class for reuse (no local auth strip).
            custom_route: false,
            rewind_supported: ParkingMutex::new(None),
            ssh_alias: None,
        });
        client.start_read_loop(Box::new(read_half));
        Ok((client, event_rx))
    }

    /// Whether this process was spawned for a custom relay route (api_key only).
    pub fn is_custom_route(&self) -> bool {
        self.custom_route
    }

    /// Spawn the transport read loop over any `AsyncRead` (child stdout or the
    /// TCP read half). Each newline-delimited JSON-RPC line is dispatched to
    /// [`handle_line`]; EOF fails pending requests and emits `ProcessExited`.
    fn start_read_loop(self: &Arc<Self>, reader: Box<dyn AsyncRead + Unpin + Send>) {
        let c = Arc::clone(self);
        tokio::spawn(async move {
            // Large session/update lines (available_commands) can be multi-MB.
            let mut reader = BufReader::with_capacity(8 * 1024 * 1024, reader);
            let mut line = String::new();
            loop {
                if !c.reader_alive.load(Ordering::SeqCst) {
                    return;
                }
                line.clear();
                let read = tokio::select! {
                    _ = c.reader_stop.notified() => return,
                    result = reader.read_line(&mut line) => result,
                };
                match read {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        Arc::clone(&c).handle_line(trimmed).await;
                    }
                    Err(e) => {
                        error!("acp read error: {e}");
                        break;
                    }
                }
            }
            // Do not turn an intentional kill into a second, late
            // `ProcessExited` event. The owner already transitioned the
            // session during `kill()`.
            if !c.reader_alive.swap(false, Ordering::SeqCst) {
                return;
            }
            // Stdout EOF normally follows child termination. Capture the
            // status when it is already available so the Host can distinguish
            // a clean/failed CLI exit from a remote TCP EOF. `try_wait` keeps
            // the reader task bounded if a malformed child leaves the handle
            // alive after closing stdout.
            let exit_code = {
                let mut child = c.child.lock().await;
                child
                    .as_mut()
                    .and_then(|process| process.try_wait().ok().flatten())
                    .and_then(|status| status.code())
            };
            let detail = c.format_exit_detail("Agent stream closed (EOF)");
            c.fail_all_pending(&detail);
            let _ = c
                .event_tx
                .send((None, AcpEvent::ProcessExited { code: exit_code }));
        });
    }

    fn push_stderr(&self, line: &str) {
        let mut buf = self.stderr_tail.lock();
        buf.push(line.to_string());
        const MAX: usize = 40;
        if buf.len() > MAX {
            let drain = buf.len() - MAX;
            buf.drain(0..drain);
        }
    }

    fn stderr_joined(&self) -> String {
        self.stderr_tail.lock().join(" | ")
    }

    fn format_exit_detail(&self, head: &str) -> String {
        let tail = self.stderr_joined();
        if tail.is_empty() {
            head.to_string()
        } else {
            // Cap length for UI
            let t = if tail.len() > 800 {
                format!("…{}", &tail[tail.len() - 800..])
            } else {
                tail
            };
            format!("{head}; stderr: {t}")
        }
    }

    fn fail_all_pending(&self, message: &str) {
        let pending: Vec<_> = self.pending.lock().drain().map(|(_, p)| p).collect();
        for p in pending {
            let _ = p.tx.send(Err(message.to_string()));
        }
    }

    async fn handle_line(self: Arc<Self>, line: &str) {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                warn!("acp non-json line: {e}: {}", &line[..line.len().min(200)]);
                return;
            }
        };

        // Response to our request (result or error present)
        if let Some(id) = json_id_u64(msg.get("id")) {
            if msg.get("result").is_some() || msg.get("error").is_some() {
                let mut pending_method: Option<String> = None;
                let mut pending_session: Option<String> = None;
                if let Some(p) = self.pending.lock().remove(&id) {
                    pending_method = Some(p.method.clone());
                    pending_session = p.session_id.clone();
                    if let Some(err) = msg.get("error") {
                        let full = format_jsonrpc_error(err);
                        warn!("acp ← {} id={id} error: {}", p.method, full);
                        let _ = p.tx.send(Err(full));
                    } else {
                        let _ =
                            p.tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                    }
                } else if let Some(err) = msg.get("error") {
                    // Race: prompt_complete fallback already resolved pending, but the
                    // real RPC error arrived later (official subscription / provider fails).
                    // Must still surface the error — do not drop as "unknown id".
                    let full = format_jsonrpc_error(err);
                    warn!("acp late error response id={id} (pending already resolved): {full}");
                    let _ = self.event_tx.send((
                        None,
                        AcpEvent::Error {
                            error: classify_rpc_error(&full),
                        },
                    ));
                } else {
                    debug!(
                        "acp late ok response id={id} (pending already resolved); keys={:?}",
                        msg.as_object()
                            .map(|o| o.keys().cloned().collect::<Vec<_>>())
                    );
                }
                // Authoritative turn end for session/prompt (#522):
                // Some CLI builds omit `result.stopReason` even after a successful
                // RPC. Always emit PromptComplete so Host clears prompt_in_flight
                // and leaves Streaming/busy. Prefer stopReason → stop_reason → end_turn.
                let is_prompt = pending_method
                    .as_deref()
                    .is_some_and(|m| m == "session/prompt")
                    || msg.pointer("/result/stopReason").is_some()
                    || msg.pointer("/result/stop_reason").is_some();
                if is_prompt && msg.get("result").is_some() {
                    let sr = msg
                        .pointer("/result/stopReason")
                        .or_else(|| msg.pointer("/result/stop_reason"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("end_turn");
                    let _ = self.event_tx.send((
                        pending_session.clone(),
                        AcpEvent::PromptComplete {
                            stop_reason: sr.to_string(),
                            authoritative: true,
                        },
                    ));
                }
                // session/prompt result.usage is a **billing aggregate** for the
                // turn (often summed across modelCalls). Frontend must NOT use it
                // as context-window occupancy — that lives on stream
                // params._meta.totalTokens (source: context_size).
                if let Some(usage) = msg
                    .pointer("/result/usage")
                    .or_else(|| msg.pointer("/result/_meta/usage"))
                {
                    let u64_field = |camel: &str, snake: &str| {
                        usage
                            .get(camel)
                            .or_else(|| usage.get(snake))
                            .and_then(|v| v.as_u64())
                            .filter(|n| *n > 0)
                    };
                    let _ = self.event_tx.send((
                        None,
                        AcpEvent::UsageReported {
                            total_tokens: u64_field("totalTokens", "total_tokens"),
                            input_tokens: u64_field("inputTokens", "input_tokens"),
                            output_tokens: u64_field("outputTokens", "output_tokens"),
                            system_tokens: None,
                            tools_tokens: None,
                            history_tokens: None,
                            cached_read_tokens: u64_field(
                                "cachedReadTokens",
                                "cache_read_input_tokens",
                            ),
                            cache_creation_tokens: u64_field(
                                "cacheCreationTokens",
                                "cache_creation_input_tokens",
                            ),
                            reasoning_tokens: u64_field("reasoningTokens", "reasoning_tokens"),
                            cost_usd_ticks: u64_field("costUsdTicks", "cost_usd_ticks"),
                            model_calls: u64_field("modelCalls", "model_calls"),
                            api_duration_ms: u64_field("apiDurationMs", "api_duration_ms"),
                            cost_is_partial: usage
                                .get("costIsPartial")
                                .or_else(|| usage.get("cost_is_partial"))
                                .and_then(|v| v.as_bool()),
                            usage_is_incomplete: usage
                                .get("usageIsIncomplete")
                                .or_else(|| usage.get("usage_is_incomplete"))
                                .and_then(|v| v.as_bool()),
                            context_window: None,
                            percentage: None,
                            // Distinct from sessionUpdate `turn_completed` so
                            // the UI does not double-count the same turn.
                            source: "prompt_result".to_string(),
                        },
                    ));
                }
                return;
            }
        }

        // Server request / notification
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            let req_id = json_id_u64(msg.get("id"));

            if method == "session/request_permission" {
                let rpc_id = req_id.unwrap_or(0);
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                let _ = self
                    .event_tx
                    .send((None, decode_permission_request(rpc_id, &params)));
                return;
            }

            // Grok Build plan gate / ask-user (wire method has leading `_`).
            // Params are FLAT: { sessionId, toolCallId, planContent } — not nested.
            // See minos grok_driver + agent-client-protocol ext_method.
            if let Some(bare) = method.strip_prefix('_') {
                if bare == "x.ai/exit_plan_mode" || bare == "x.ai/ask_user_question" {
                    let rpc_id = req_id.unwrap_or(0);
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    if bare == "x.ai/exit_plan_mode" {
                        let plan_content = params
                            .get("planContent")
                            .or_else(|| params.get("plan_content"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let tool_call_id = params
                            .get("toolCallId")
                            .or_else(|| params.get("tool_call_id"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        info!(
                            "acp exit_plan_mode id={rpc_id} plan_chars={}",
                            plan_content.as_ref().map(|s| s.len()).unwrap_or(0)
                        );
                        let _ = self.event_tx.send((
                            None,
                            AcpEvent::Plan {
                                entries: params.get("entries").cloned().unwrap_or(json!([])),
                                body: plan_content,
                                rpc_id: Some(rpc_id),
                                tool_call_id,
                            },
                        ));
                    } else {
                        // ask_user_question: surface UI; reply via respond_ask_user_question.
                        let parsed = parse_ask_user_question_params(&params);
                        info!(
                            "acp ask_user_question id={rpc_id} questions={} tool_call={:?}",
                            parsed.questions.len(),
                            parsed.tool_call_id
                        );
                        if parsed.questions.is_empty() {
                            // Nothing to show — cancel so the agent does not hang.
                            warn!("ask_user_question id={rpc_id}: empty questions, auto-cancel");
                            let reply = json!({
                                "jsonrpc": "2.0",
                                "id": rpc_id,
                                "result": { "outcome": "cancelled" }
                            });
                            if let Err(e) = self.write_line(&reply).await {
                                warn!("failed to auto-cancel empty ask_user_question: {e}");
                            }
                        } else {
                            let _ = self.event_tx.send((
                                None,
                                AcpEvent::AskUserQuestion {
                                    rpc_id,
                                    tool_call_id: parsed.tool_call_id,
                                    questions: parsed.questions,
                                    raw: params,
                                },
                            ));
                        }
                    }
                    return;
                }
            }

            // True notifications: no id. (If id is present, must reply — never swallow.)
            if req_id.is_none() {
                // Official + xAI-extended session updates (retry_state, chunks, tools…).
                if method == "session/update"
                    || method == "_x.ai/session/update"
                    || method == "_x.ai/session_notification"
                {
                    self.handle_session_update(msg.get("params").unwrap_or(&Value::Null));
                } else if method == "_x.ai/session/prompt_complete" {
                    // UI signal only — do NOT immediately Ok-complete session/prompt.
                    // Official path may still send a JSON-RPC *error* for the same id
                    // shortly after prompt_complete; completing early swallows that error.
                    let stop = msg
                        .pointer("/params/stopReason")
                        .or_else(|| msg.pointer("/params/stop_reason"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("end_turn")
                        .to_string();
                    // The notification envelope carries the owning sessionId —
                    // with concurrent turns on one process the fallback must
                    // only free that session's pending prompt.
                    let sid = msg
                        .pointer("/params/sessionId")
                        .or_else(|| msg.pointer("/params/session_id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let _ = self.event_tx.send((
                        sid.clone(),
                        AcpEvent::PromptComplete {
                            stop_reason: stop.clone(),
                            authoritative: false,
                        },
                    ));
                    // Grace period: free waiters only if the RPC result never arrives.
                    self.schedule_prompt_complete_fallback(sid, stop);
                } else {
                    debug!("acp notification ignored method={method}");
                }
                return;
            }

            // Unhandled server→client request with id: reply so agent does not hang.
            let id = req_id.unwrap();
            warn!("acp unhandled server request method={method} id={id}");
            let err = json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method not found: {method}"),
                }
            });
            if let Err(e) = self.write_line(&err).await {
                warn!("failed to reject unhandled method {method}: {e}");
            }
        }
    }

    fn touch_last_update(&self, session_id: Option<&str>, at: Instant) {
        if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
            self.last_update_by_session
                .lock()
                .insert(sid.to_string(), at);
        } else {
            *self.last_update_unstamped.lock() = Some(at);
        }
    }

    fn last_update_for(&self, session_id: Option<&str>) -> Option<Instant> {
        if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
            if let Some(t) = self.last_update_by_session.lock().get(sid).copied() {
                return Some(t);
            }
        }
        *self.last_update_unstamped.lock()
    }

    /// Release the `session/prompt` waiter only once the agent has actually gone
    /// quiet after its early `prompt_complete`.
    ///
    /// The agent fires `prompt_complete` before the answer is finished, so a
    /// fixed timer resolved the RPC while chunks were still arriving. That
    /// ended the turn early and every later chunk was discarded as replay —
    /// a truncated journal and a chat frozen mid-answer. Each `session/update`
    /// re-arms the window; idle + absolute prompt waits still cap a wedged RPC.
    ///
    /// `session_id` (from the notification envelope) scopes the fallback to
    /// one session's pending prompt when a process hosts several concurrent
    /// turns — another chat's early complete must not free this waiter.
    fn schedule_prompt_complete_fallback(
        self: &Arc<Self>,
        session_id: Option<String>,
        stop_reason: String,
    ) {
        let this = Arc::clone(self);
        let sid = session_id.as_deref().map(|s| s.to_string());
        // Capture this completion notification's exact RPC generation. A real
        // result may remove it before the timer wakes; a newer prompt in the
        // same session must never be adopted by this stale fallback.
        let prompt_ids = pending_prompt_ids_for(&self.pending.lock(), sid.as_deref());
        if prompt_ids.is_empty() {
            return;
        }
        tokio::spawn(async move {
            let grace = Duration::from_millis(PROMPT_COMPLETE_FALLBACK_GRACE_MS);
            loop {
                tokio::time::sleep(grace).await;
                // Real RPC result landed (or the turn was cancelled) — nothing to free.
                if !has_pending_prompt_ids(&this.pending.lock(), &prompt_ids) {
                    return;
                }
                let last = this.last_update_for(sid.as_deref());
                if prompt_fallback_due(last, grace, Instant::now()) {
                    break;
                }
                debug!(
                    "acp prompt_complete fallback re-armed: agent still streaming after early complete"
                );
            }
            this.complete_pending_prompt_fallback(&prompt_ids, &stop_reason);
        });
    }

    /// If agent never returned a session/prompt result after prompt_complete, free waiters.
    fn complete_pending_prompt_fallback(&self, prompt_ids: &[u64], stop_reason: &str) {
        let prompts = take_pending_prompt_ids(&mut self.pending.lock(), prompt_ids);
        for (id, p) in prompts {
            info!(
                "acp completing session/prompt id={id} via delayed prompt_complete fallback (no RPC result yet)"
            );
            let _ = p.tx.send(Ok(json!({ "stopReason": stop_reason })));
        }
    }

    fn handle_session_update(&self, params: &Value) {
        // Proof of life for the turn: re-arms the `prompt_complete` fallback so
        // an early completion notification cannot cut the answer short.
        // Stamp per-session so another chat on this process cannot extend
        // (or expire) this turn's grace window.
        let sid = params
            .get("sessionId")
            .or_else(|| params.get("session_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        self.touch_last_update(sid.as_deref(), Instant::now());
        // Multi-session routing: every update notification carries its
        // `sessionId` at params top level (Grok gateway envelope). Stamp the
        // decoded events so the SessionManager can route them to the right
        // App session when one process hosts several. Missing sid → None
        // (process-scoped fallback).
        let events = decode_session_update(params);
        if events.is_empty() {
            let update = params.get("update").unwrap_or(params);
            let kind = update
                .get("sessionUpdate")
                .or_else(|| update.get("session_update"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            debug!("acp session/update ignored kind={kind}");
        }
        for ev in events {
            if let AcpEvent::RetryState {
                attempt,
                max_retries,
                reason,
                status,
            } = &ev
            {
                info!(
                    "acp retry_state attempt={attempt}/{max_retries} status={status} reason={}",
                    reason.chars().take(160).collect::<String>()
                );
            }
            if let AcpEvent::ContextCompact {
                trigger,
                tokens_before,
                tokens_after,
                ..
            } = &ev
            {
                info!(
                    "acp context compact trigger={trigger} before={tokens_before:?} after={tokens_after:?}"
                );
            }
            let _ = self.event_tx.send((sid.clone(), ev));
        }
    }

    async fn write_line(&self, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        line.push('\n');
        // Bound stdin lock+write: a dead/wedged agent must not pin the Host
        // forever (interject / cancel / prompt all go through here).
        let write_fut = async {
            let mut guard = self.stdin.lock().await;
            let stdin = guard.as_mut().ok_or_else(|| "stdin closed".to_string())?;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        };
        match tokio::time::timeout(
            std::time::Duration::from_secs(STDIN_WRITE_TIMEOUT_SECS),
            write_fut,
        )
        .await
        {
            Ok(r) => r,
            Err(_) => {
                // Wedged agent: free waiters, surface ProcessExited so Host ends
                // the turn, and kill the child so the pool slot is not held as
                // "still working" overnight.
                self.reader_alive.store(false, Ordering::SeqCst);
                let head = format!(
                    "stdin write timeout after {STDIN_WRITE_TIMEOUT_SECS}s (agent may be wedged)"
                );
                let detail = self.format_exit_detail(&head);
                error!("{detail}");
                self.fail_all_pending(&detail);
                let _ = self
                    .event_tx
                    .send((None, AcpEvent::ProcessExited { code: None }));
                if tokio::time::timeout(
                    std::time::Duration::from_secs(STDIN_WRITE_TIMEOUT_SECS),
                    self.kill(),
                )
                .await
                .is_err()
                {
                    tracing::warn!(
                        secs = STDIN_WRITE_TIMEOUT_SECS,
                        "acp kill after stdin timeout also timed out"
                    );
                }
                Err(head)
            }
        }
    }
}

/// Pull a u64 from common token field names on a JSON object.
fn json_token_u64(obj: &Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = obj.get(*k).and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_i64().map(|i| i.max(0) as u64))
                .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
        }) {
            return Some(n);
        }
    }
    None
}

fn json_token_bool(obj: &Value, keys: &[&str]) -> Option<bool> {
    for k in keys {
        if let Some(b) = obj.get(*k).and_then(|v| v.as_bool()) {
            return Some(b);
        }
    }
    None
}

/// Parse turn/context usage from a sessionUpdate payload.
/// Supports nested `usage` objects and flat camel/snake fields.
/// Returns None when no usage signal is present (do not invent zeros).
pub fn parse_usage_update(kind: &str, update: &Value) -> Option<AcpEvent> {
    let usage_obj = update
        .get("usage")
        .or_else(|| update.get("tokenUsage"))
        .or_else(|| update.get("token_usage"))
        .or_else(|| update.get("tokens"))
        .filter(|v| v.is_object());

    let root = usage_obj.unwrap_or(update);

    let input = json_token_u64(
        root,
        &[
            "inputTokens",
            "input_tokens",
            "promptTokens",
            "prompt_tokens",
            "input",
        ],
    );
    let output = json_token_u64(
        root,
        &[
            "outputTokens",
            "output_tokens",
            "completionTokens",
            "completion_tokens",
            "output",
        ],
    );
    // Grok Build CLI occupancy field is `tokens_used` (auto_compact_started,
    // tokens_used updates). Prefer it over billing `totalTokens` when both exist
    // on the same object (should not happen on live wire).
    let occupancy = json_token_u64(
        root,
        &["tokens_used", "tokensUsed", "usedTokens", "used_tokens"],
    );
    let total = occupancy
        .or_else(|| {
            json_token_u64(
                root,
                &[
                    "totalTokens",
                    "total_tokens",
                    "contextTokens",
                    "context_tokens",
                    "tokens",
                    "total",
                ],
            )
        })
        .or_else(|| match (input, output) {
            (Some(i), Some(o)) => Some(i.saturating_add(o)),
            _ => None,
        });
    let system = json_token_u64(root, &["systemTokens", "system_tokens", "system"]);
    let tools = json_token_u64(
        root,
        &[
            "toolsTokens",
            "tools_tokens",
            "toolTokens",
            "tool_tokens",
            "tools",
        ],
    );
    let history = json_token_u64(
        root,
        &[
            "historyTokens",
            "history_tokens",
            "messagesTokens",
            "messages_tokens",
            "history",
        ],
    );
    // Prompt-caching / reasoning / cost signals (ClaudeCode / Claude plans).
    let cached_read = json_token_u64(
        root,
        &[
            "cachedReadTokens",
            "cached_read_tokens",
            "cache_read_input_tokens",
            "cachedTokens",
        ],
    );
    let cache_creation = json_token_u64(
        root,
        &[
            "cacheCreationTokens",
            "cache_creation_tokens",
            "cache_creation_input_tokens",
        ],
    );
    let reasoning = json_token_u64(root, &["reasoningTokens", "reasoning_tokens"]);
    let cost_usd_ticks = json_token_u64(root, &["costUsdTicks", "cost_usd_ticks"]);
    let model_calls = json_token_u64(root, &["modelCalls", "model_calls"]);
    let api_duration_ms = json_token_u64(
        root,
        &["apiDurationMs", "api_duration_ms", "duration_api_ms"],
    );
    let cost_is_partial = json_token_bool(root, &["costIsPartial", "cost_is_partial"]);
    let usage_is_incomplete = json_token_bool(root, &["usageIsIncomplete", "usage_is_incomplete"]);
    // CLI denominator + integer % (auto_compact_started / tokens_used).
    let context_window = json_token_u64(
        root,
        &["context_window", "contextWindow", "context_window_tokens"],
    )
    .or_else(|| {
        json_token_u64(
            update,
            &["context_window", "contextWindow", "context_window_tokens"],
        )
    });
    let percentage = json_token_u64(root, &["percentage", "percent", "context_usage_pct"])
        .or_else(|| json_token_u64(update, &["percentage", "percent", "context_usage_pct"]));

    // Kind hints alone are not enough — need at least one number.
    // Do not invent zeros for missing structured buckets.
    if total.is_none()
        && input.is_none()
        && output.is_none()
        && system.is_none()
        && tools.is_none()
        && history.is_none()
        && cached_read.is_none()
        && cache_creation.is_none()
        && reasoning.is_none()
        && cost_usd_ticks.is_none()
        && model_calls.is_none()
        && api_duration_ms.is_none()
        && occupancy.is_none()
    {
        return None;
    }

    // Avoid double-firing compact *completed* events that only carry before/after.
    // `auto_compact_started` carries tokens_used and must still emit occupancy.
    if kind.contains("compact")
        && !kind.contains("started")
        && total.is_none()
        && occupancy.is_none()
        && (update.get("tokens_before").is_some()
            || update.get("tokensBefore").is_some()
            || update.get("tokens_after").is_some()
            || update.get("tokensAfter").is_some())
    {
        return None;
    }

    // Normalize source so the frontend occupancy classifier matches CLI events.
    let source = if kind == "auto_compact_started" || kind.ends_with("auto_compact_started") {
        "auto_compact_started".to_string()
    } else if kind == "tokens_used"
        || (occupancy.is_some() && input.is_none() && output.is_none() && kind.is_empty())
    {
        "tokens_used".to_string()
    } else {
        kind.to_string()
    };

    Some(AcpEvent::UsageReported {
        total_tokens: total,
        input_tokens: input,
        output_tokens: output,
        system_tokens: system,
        tools_tokens: tools,
        history_tokens: history,
        cached_read_tokens: cached_read,
        cache_creation_tokens: cache_creation,
        reasoning_tokens: reasoning,
        cost_usd_ticks,
        model_calls,
        api_duration_ms,
        cost_is_partial,
        usage_is_incomplete,
        context_window,
        percentage,
        source,
    })
}

/// Parse compact-related sessionUpdate → (trigger, before, after, summary, note)
#[allow(clippy::type_complexity)]
fn parse_context_compact_update(
    kind: &str,
    update: &Value,
) -> Option<(
    String,
    Option<u64>,
    Option<u64>,
    Option<String>,
    Option<String>,
)> {
    let tokens_before = update
        .get("tokens_before")
        .or_else(|| update.get("tokensBefore"))
        .and_then(|v| v.as_u64());
    let tokens_after = update
        .get("tokens_after")
        .or_else(|| update.get("tokensAfter"))
        .and_then(|v| v.as_u64());
    let summary_preview = update
        .get("summary_preview")
        .or_else(|| update.get("summaryPreview"))
        .or_else(|| update.get("summary"))
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(500).collect::<String>());
    let note = update
        .get("note")
        .or_else(|| update.get("message"))
        .or_else(|| update.get("reason"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let trigger_raw = update
        .get("trigger")
        .or_else(|| update.get("trigger_type"))
        .or_else(|| update.get("triggerType"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let trigger = if trigger_raw.eq_ignore_ascii_case("manual") || kind.contains("manual") {
        "manual".to_string()
    } else if trigger_raw.eq_ignore_ascii_case("auto")
        || kind.contains("auto")
        || kind == "tokens_used"
        || kind == "compaction_checkpoint"
    {
        "auto".to_string()
    } else if !trigger_raw.is_empty() {
        trigger_raw.to_string()
    } else {
        "auto".to_string()
    };

    if tokens_before.is_some()
        || tokens_after.is_some()
        || summary_preview.is_some()
        || kind.contains("compact")
        || kind == "tokens_used"
        || kind == "compaction_checkpoint"
    {
        Some((trigger, tokens_before, tokens_after, summary_preview, note))
    } else {
        None
    }
}

impl AcpClient {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_timeout(method, params, HANDSHAKE_TIMEOUT_SECS)
            .await
    }

    async fn request_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_secs: u64,
    ) -> Result<Value, String> {
        if !self.reader_alive.load(Ordering::SeqCst) {
            return Err(format!(
                "agent stdout closed before {method}; {}",
                self.format_exit_detail("process dead")
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(
            id,
            Pending {
                method: method.to_string(),
                tx,
                session_id: None,
            },
        );
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        info!("acp → {method} id={id}");
        if let Err(e) = self.write_line(&msg).await {
            self.pending.lock().remove(&id);
            return Err(format!("write {method} failed: {e}"));
        }
        match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(r)) => match r {
                Ok(v) => {
                    info!("acp ← {method} id={id} ok");
                    Ok(v)
                }
                Err(e) => {
                    warn!("acp ← {method} id={id} error: {e}");
                    Err(e)
                }
            },
            Ok(Err(_)) => {
                let head = format!("rpc channel closed while waiting for {method} (id={id})");
                error!("{}", self.format_exit_detail(&head));
                Err(head)
            }
            Err(_) => {
                self.pending.lock().remove(&id);
                // Keep user-facing error short; log stderr separately (MCP noise must not
                // surface as NETWORK_PROVIDER detail in the chat).
                let head = format!("rpc timeout on {method} (id={id}) after {timeout_secs}s");
                let logged = self.format_exit_detail(&head);
                error!("{logged}");
                Err(head)
            }
        }
    }

    /// `session/prompt` wait: idle-based silence timeout, re-armed by every
    /// `session/update`. No absolute turn-age ceiling — a fixed wall clock
    /// killed healthy multi-image / multi-tool turns past 4 hours.
    async fn request_prompt(&self, params: Value) -> Result<Value, String> {
        let method = "session/prompt";
        if !self.reader_alive.load(Ordering::SeqCst) {
            return Err(format!(
                "agent stdout closed before {method}; {}",
                self.format_exit_detail("process dead")
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        // Stamp owning agent session so PromptComplete routes correctly and the
        // early-complete fallback only frees this chat's waiter (#522 multi-session).
        let prompt_sid = params
            .get("sessionId")
            .or_else(|| params.get("session_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        self.pending.lock().insert(
            id,
            Pending {
                method: method.to_string(),
                tx,
                session_id: prompt_sid.clone(),
            },
        );
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        info!("acp → {method} id={id}");
        if let Err(e) = self.write_line(&msg).await {
            self.pending.lock().remove(&id);
            return Err(format!("write {method} failed: {e}"));
        }

        let wait_started = Instant::now();
        // Mark activity at dispatch so pure silence is measured from send time.
        self.touch_last_update(prompt_sid.as_deref(), wait_started);
        let idle = Duration::from_secs(PROMPT_IDLE_TIMEOUT_SECS);
        let slice = Duration::from_secs(PROMPT_WAIT_SLICE_SECS);
        let mut rx = rx;

        loop {
            tokio::select! {
                r = &mut rx => {
                    match r {
                        Ok(Ok(v)) => {
                            info!("acp ← {method} id={id} ok");
                            return Ok(v);
                        }
                        Ok(Err(e)) => {
                            warn!("acp ← {method} id={id} error: {e}");
                            return Err(e);
                        }
                        Err(_) => {
                            let head = format!(
                                "rpc channel closed while waiting for {method} (id={id})"
                            );
                            error!("{}", self.format_exit_detail(&head));
                            return Err(head);
                        }
                    }
                }
                _ = tokio::time::sleep(slice) => {
                    if !self.reader_alive.load(Ordering::SeqCst) {
                        self.pending.lock().remove(&id);
                        let head = format!(
                            "agent stdout closed while waiting for {method} (id={id})"
                        );
                        error!("{}", self.format_exit_detail(&head));
                        return Err(head);
                    }
                    let last = self.last_update_for(prompt_sid.as_deref());
                    let now = Instant::now();
                    if prompt_wait_should_timeout(last, wait_started, now, idle) {
                        self.pending.lock().remove(&id);
                        let idle_secs = last
                            .unwrap_or(wait_started)
                            .elapsed()
                            .as_secs();
                        let head = format!(
                            "rpc timeout on {method} (id={id}) after {idle_secs}s idle (wall {}s)",
                            wait_started.elapsed().as_secs()
                        );
                        let logged = self.format_exit_detail(&head);
                        error!("{logged}");
                        return Err(head);
                    }
                }
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.write_line(&msg).await
    }

    /// True while the agent stdout reader is still alive (process usable).
    pub fn is_alive(&self) -> bool {
        self.reader_alive.load(Ordering::SeqCst)
    }

    /// Working directory this process was spawned with.
    pub fn cwd(&self) -> &std::path::Path {
        &self.cwd
    }

    /// Initialize + auth, then open a session.
    /// Prefer `session/load` when `resume_session_id` is set (Grok persists agent
    /// sessions under GROK_HOME). When `fork_session` is true, use ACP
    /// `session/fork` (CLI `--fork-session` semantics) for a **new** agent id
    /// with the source context. Fall back to `session/new`.
    /// Returns `(session_id, resumed)`.
    /// Initialize + best-effort auth, then open a session.
    /// Prefer `session/load` when `resume_session_id` is set (Grok persists agent
    /// sessions under GROK_HOME). When `fork_session` is true, use ACP
    /// `session/fork` (CLI `--fork-session` semantics) for a **new** agent id
    /// with the source context. Fall back to `session/new`.
    /// Returns `(session_id, resumed)`.
    pub async fn initialize_and_open_session(
        &self,
        resume_session_id: Option<&str>,
        fork_session: bool,
    ) -> Result<(String, bool), AgentError> {
        self.initialize_and_auth().await?;
        self.open_session(resume_session_id, fork_session).await
    }

    /// Initialize + best-effort cached auth only — no session.
    ///
    /// Used to prewarm a process while the user is still composing (new-chat
    /// draft) so the later `session/new` on a real project is near-instant.
    /// `session/new`'s cwd is a per-session parameter, so the prewarm spawn
    /// cwd does not bind the chat to a project.
    pub async fn initialize_and_auth(&self) -> Result<Value, AgentError> {
        // Do not advertise client fs methods we do not implement — avoids agent
        // hanging on fs/readTextFile while we never reply.
        let init = self
            .request_timeout(
                "initialize",
                wire_initialize_params(),
                HANDSHAKE_TIMEOUT_SECS,
            )
            .await
            .map_err(|e| self.map_handshake_err("initialize", e))?;

        let acp_agent_version = init
            .pointer("/_meta/agentVersion")
            .or_else(|| init.pointer("/agentVersion"))
            .and_then(|v| v.as_str());
        crate::cli_probe::record_acp_agent_version(acp_agent_version);
        info!(
            "acp initialized agentVersion={:?} loadSession={:?} rewind={:?}",
            acp_agent_version,
            init.pointer("/agentCapabilities/loadSession")
                .or_else(|| init.pointer("/capabilities/loadSession")),
            initialize_advertises_rewind(&init),
        );
        *self.rewind_supported.lock() = initialize_advertises_rewind(&init);

        // Live per-model context windows (ClaudeCode `_meta.modelState`).
        // Soft-fail silently when absent — Grok CLI does not expose this yet.
        let live_windows = parse_model_context_tokens(&init);
        if !live_windows.is_empty() {
            let n = live_windows.len();
            crate::models_catalog::merge_live_context_windows(live_windows);
            debug!("acp initialize merged {n} live context window(s)");
        }

        // Best-effort cached auth — short timeout so a hung auth cannot burn 120s.
        // Official independent mode: if the first attempt fails (stale/empty
        // agent-home after a custom-route clear, #528), re-sync ~/.grok →
        // agent-home and retry once before soft-continuing.
        //
        // Custom relays must skip this: `cached_token` reads ~/.grok/auth.json
        // (still present after official login for billing). Grok Build then
        // sends OIDC to the relay and the user sees “works until I sign in”.
        //
        // Unsigned-in official route must also skip: there is no token to
        // load, and the CLI authenticate RPC times out at 12s × 2.
        let has_cached_token = has_cached_token_for_authenticate();
        if should_authenticate_cached_token(self.custom_route, has_cached_token) {
            match self
                .request_timeout(
                    "authenticate",
                    json!({ "methodId": "cached_token" }),
                    AUTH_TIMEOUT_SECS,
                )
                .await
            {
                Ok(_) => info!("acp authenticate cached_token ok"),
                Err(e) => {
                    if let Err(sync_e) = crate::account::sync_cli_auth_to_agent_home() {
                        warn!("acp authenticate: re-sync auth before retry failed: {sync_e}");
                    }
                    match self
                        .request_timeout(
                            "authenticate",
                            json!({ "methodId": "cached_token" }),
                            AUTH_TIMEOUT_SECS,
                        )
                        .await
                    {
                        Ok(_) => {
                            info!("acp authenticate cached_token ok after auth re-sync");
                        }
                        Err(e2) => {
                            warn!(
                                "acp authenticate soft-fail after re-sync (continuing): first={e}; retry={e2}"
                            );
                        }
                    }
                }
            }
        } else if self.custom_route {
            info!("acp authenticate skipped (custom route: api_key only)");
        } else {
            info!("acp authenticate skipped (unsigned-in: no cached_token)");
        }
        Ok(init)
    }

    /// Open or resume an ACP session on an already-initialized agent process.
    /// Used for cold connect after `initialize` and for warm process reuse when
    /// switching App sessions without respawning CLI.
    /// Returns `(session_id, resumed)`.
    ///
    /// Injects **enabled** MCP servers (App Extensions prefs + `grok mcp list`)
    /// into `mcpServers` so independent GROK_HOME and shared mode both see tools.
    ///
    /// When `fork_session` is true and `resume_session_id` is set, tries
    /// `session/fork` (standard ACP) then `_x.ai/session/fork` (Grok extension)
    /// before falling back to `session/new` — never `session/load` (would reuse
    /// the source id and violate `--fork-session` semantics).
    pub async fn open_session(
        &self,
        resume_session_id: Option<&str>,
        fork_session: bool,
    ) -> Result<(String, bool), AgentError> {
        self.open_session_at(resume_session_id, fork_session, &self.cwd.to_string_lossy())
            .await
    }

    /// [`Self::open_session`] with a caller-supplied cwd.
    ///
    /// The CLI session cwd is per-session. OS sandbox write roots are **not** —
    /// they stay locked to spawn cwd for the process lifetime. Hosts must not
    /// warm-reuse a non-`off` sandboxed process onto a different project cwd
    /// (#986); cold-spawn with the target cwd instead.
    pub async fn open_session_at(
        &self,
        resume_session_id: Option<&str>,
        fork_session: bool,
        cwd: &str,
    ) -> Result<(String, bool), AgentError> {
        let cwd = cwd.to_string();
        if !crate::ssh_remote::acp_session_cwd_ok(self.ssh_alias.as_deref(), &cwd) {
            return Err(AgentError::new(
                AgentErrorCode::AgentCrashed,
                format!("project cwd is not a directory: {cwd}"),
            ));
        }

        // Build ACP mcpServers off the async runtime. **Never block connect** on
        // MCP/OAuth: connect builder skips network refresh + CLI list, and a
        // hard budget falls back to `[]` so session/new|load always proceeds.
        // Official aux side-channel uses empty inject (no nested official-aux MCP).
        // SSH: do not scan the remote path as a local project.
        let mcp_servers = if self.empty_mcp_servers || self.ssh_alias.is_some() {
            if self.ssh_alias.is_some() {
                info!("acp session open empty mcpServers (ssh remote)");
            } else {
                info!("acp session open empty mcpServers (side-channel)");
            }
            serde_json::json!([])
        } else {
            let project_cwd = cwd.clone();
            let budget = crate::extensions::MCP_CONNECT_BUDGET;
            let servers = match tokio::time::timeout(
                budget,
                tauri::async_runtime::spawn_blocking(move || {
                    crate::extensions::build_session_mcp_servers_for_connect(Some(
                        project_cwd.as_str(),
                    ))
                }),
            )
            .await
            {
                Ok(Ok(v)) => v,
                Ok(Err(join_e)) => {
                    warn!(
                        "acp session open mcpServers join error ({join_e}); empty inject (connect proceeds)"
                    );
                    serde_json::json!([])
                }
                Err(_) => {
                    warn!(
                        budget_ms = budget.as_millis() as u64,
                        "acp session open mcpServers exceeded budget; empty inject (connect proceeds)"
                    );
                    serde_json::json!([])
                }
            };
            let mcp_count = servers.as_array().map(|a| a.len()).unwrap_or(0);
            info!("acp session open injecting mcpServers count={mcp_count}");
            servers
        };

        if let Some(rid) = resume_session_id.map(str::trim).filter(|s| !s.is_empty()) {
            // CLI `--fork-session`: new agent session id with parent context.
            if fork_session {
                if let Some((sid, model_id)) = self.try_fork_session(rid, &cwd, &mcp_servers).await
                {
                    *self.agent_session_id.lock() = Some(sid.clone());
                    let _ = self.event_tx.send((
                        None,
                        AcpEvent::State {
                            backend: "grok_agent_stdio".into(),
                            agent_session_id: Some(sid.clone()),
                            model_id,
                        },
                    ));
                    // Full parent context was forked — treat like a successful resume
                    // for bootstrap purposes (no journal rewrite needed).
                    return Ok((sid, true));
                }
                warn!(
                    "acp session/fork failed for source={rid}; falling back to session/new (will not reuse source id)"
                );
                // Fall through to session/new — do not session/load (would mutate source).
            } else {
                // Prefer resuming the previous agent session for full native context.
                // Note: session/load replays history as ACP notifications; Host must
                // gate stream/tool side effects on `prompt_in_flight` (see session_manager).
                info!("acp session/load begin sessionId={rid} cwd={cwd}");
                match self
                    .request_timeout(
                        "session/load",
                        json!({
                            "sessionId": rid,
                            "cwd": cwd,
                            "mcpServers": mcp_servers.clone()
                        }),
                        HANDSHAKE_TIMEOUT_SECS,
                    )
                    .await
                {
                    Ok(result) => {
                        let sid = result
                            .get("sessionId")
                            .and_then(|v| v.as_str())
                            .unwrap_or(rid)
                            .to_string();
                        info!("acp session/load ok sessionId={sid}");
                        *self.agent_session_id.lock() = Some(sid.clone());
                        let model_id = result
                            .pointer("/models/currentModelId")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let _ = self.event_tx.send((
                            None,
                            AcpEvent::State {
                                backend: "grok_agent_stdio".into(),
                                agent_session_id: Some(sid.clone()),
                                model_id,
                            },
                        ));
                        return Ok((sid, true));
                    }
                    Err(e) => {
                        warn!("acp session/load fail ({e}); falling back to session/new");
                    }
                }
            }
        }

        let result = self
            .request_timeout(
                "session/new",
                json!({
                    "cwd": cwd,
                    "mcpServers": mcp_servers
                }),
                HANDSHAKE_TIMEOUT_SECS,
            )
            .await
            .map_err(|e| self.map_handshake_err("session/new", e))?;

        let sid = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AgentError::new(
                    AgentErrorCode::AgentCrashed,
                    format!(
                        "session/new missing sessionId; keys={:?}",
                        result
                            .as_object()
                            .map(|o| o.keys().cloned().collect::<Vec<_>>())
                    ),
                )
            })?
            .to_string();

        *self.agent_session_id.lock() = Some(sid.clone());
        let model_id = result
            .pointer("/models/currentModelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let _ = self.event_tx.send((
            None,
            AcpEvent::State {
                backend: "grok_agent_stdio".into(),
                agent_session_id: Some(sid.clone()),
                model_id,
            },
        ));

        Ok((sid, false))
    }

    /// Try standard ACP `session/fork`, then Grok `_x.ai/session/fork`.
    /// Returns `(new_session_id, model_id)` on success.
    async fn try_fork_session(
        &self,
        source_session_id: &str,
        cwd: &str,
        mcp_servers: &serde_json::Value,
    ) -> Option<(String, Option<String>)> {
        info!("acp session/fork begin sourceSessionId={source_session_id} cwd={cwd}");
        // Standard ACP ForkSessionRequest: sessionId + cwd + mcpServers.
        match self
            .request_timeout(
                "session/fork",
                json!({
                    "sessionId": source_session_id,
                    "cwd": cwd,
                    "mcpServers": mcp_servers.clone()
                }),
                HANDSHAKE_TIMEOUT_SECS,
            )
            .await
        {
            Ok(result) => {
                if let Some(sid) = parse_fork_session_id(&result, source_session_id) {
                    info!("acp session/fork ok newSessionId={sid}");
                    let model_id = result
                        .pointer("/models/currentModelId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    return Some((sid, model_id));
                }
                warn!("acp session/fork response missing sessionId");
            }
            Err(e) => {
                warn!("acp session/fork fail ({e}); trying _x.ai/session/fork");
            }
        }

        // Grok Build extension (vscode / older agents): sourceSessionId + sourceCwd + newCwd.
        match self
            .request_timeout(
                "_x.ai/session/fork",
                json!({
                    "sourceSessionId": source_session_id,
                    "sourceCwd": cwd,
                    "newCwd": cwd,
                }),
                HANDSHAKE_TIMEOUT_SECS,
            )
            .await
        {
            Ok(result) => {
                if let Some(sid) = parse_fork_session_id(&result, source_session_id) {
                    info!("acp _x.ai/session/fork ok newSessionId={sid}");
                    let model_id = result
                        .pointer("/models/currentModelId")
                        .and_then(|v| v.as_str())
                        .or_else(|| result.get("newModelId").and_then(|v| v.as_str()))
                        .map(|s| s.to_string());
                    return Some((sid, model_id));
                }
                warn!("acp _x.ai/session/fork response missing sessionId");
            }
            Err(e) => {
                warn!("acp _x.ai/session/fork fail ({e})");
            }
        }
        None
    }

    /// Back-compat: always create a new session.
    pub async fn initialize_and_new_session(&self) -> Result<String, AgentError> {
        self.initialize_and_open_session(None, false)
            .await
            .map(|(sid, _)| sid)
    }

    /// Hot-swap MCP servers on a live session (`_x.ai/session/update_mcp_servers`).
    ///
    /// The CLI re-initializes the server set in-process and waits for the
    /// handshake batch — no kill + respawn needed when only the MCP set
    /// changed (extensions enable/disable, `grok mcp list` drift).
    /// Falls back to the caller's soft-respawn path on any error.
    pub async fn update_mcp_servers(
        &self,
        session_id: &str,
        mcp_servers: Value,
    ) -> Result<Value, String> {
        self.request_timeout(
            "_x.ai/session/update_mcp_servers",
            json!({
                "sessionId": session_id,
                "mcpServers": mcp_servers,
            }),
            HANDSHAKE_TIMEOUT_SECS,
        )
        .await
    }

    /// Switch model on the live agent session (`session/set_model`).
    /// Switch model on the live agent session (`session/set_model`).
    /// Uses the process's most recently bound agent session id.
    pub async fn set_model(&self, model_id: &str) -> Result<(), String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no agent session".to_string())?;
        self.set_model_for(&sid, model_id).await
    }

    /// Switch model on an explicit session (`session/set_model`).
    /// Shared-process multi-session: callers MUST target the session they
    /// mean — the process-level "recently bound" id may belong to another
    /// App session on the same process.
    pub async fn set_model_for(&self, session_id: &str, model_id: &str) -> Result<(), String> {
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err("model id empty".into());
        }
        let sid = session_id.to_string();
        // ACP SetSessionModelRequest: sessionId + modelId (+ optional meta).
        let result = self
            .request(
                "session/set_model",
                json!({
                    "sessionId": sid,
                    "modelId": model_id,
                }),
            )
            .await
            .map_err(|e| format!("session/set_model: {e}"))?;
        // Best-effort: some agents echo currentModelId.
        if let Some(mid) = result
            .pointer("/models/currentModelId")
            .or_else(|| result.get("modelId"))
            .and_then(|v| v.as_str())
        {
            let _ = self.event_tx.send((
                None,
                AcpEvent::State {
                    backend: "grok_agent_stdio".into(),
                    agent_session_id: Some(sid),
                    model_id: Some(mid.to_string()),
                },
            ));
        } else {
            let _ = self.event_tx.send((
                None,
                AcpEvent::State {
                    backend: "grok_agent_stdio".into(),
                    agent_session_id: Some(sid),
                    model_id: Some(model_id.to_string()),
                },
            ));
        }
        Ok(())
    }

    /// Switch product session mode (`session/set_mode`). Tries candidate modeIds.
    /// Uses the process's most recently bound agent session id.
    pub async fn set_mode(&self, product_mode: &str) -> Result<String, String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no agent session".to_string())?;
        self.set_mode_for(&sid, product_mode).await
    }

    /// Switch product session mode on an explicit session (`session/set_mode`).
    pub async fn set_mode_for(
        &self,
        session_id: &str,
        product_mode: &str,
    ) -> Result<String, String> {
        let sid = session_id.to_string();
        let candidates = crate::agent_prefs::product_mode_candidates(product_mode);
        let mut last_err = String::from("no mode candidates");
        for mode_id in candidates {
            match self
                .request(
                    "session/set_mode",
                    json!({
                        "sessionId": sid,
                        "modeId": mode_id,
                    }),
                )
                .await
            {
                Ok(_) => {
                    tracing::info!("acp session/set_mode ok modeId={mode_id}");
                    return Ok(mode_id.to_string());
                }
                Err(e) => {
                    last_err = e;
                    tracing::debug!("acp session/set_mode {mode_id} soft-fail: {last_err}");
                    // Unknown modeId fails fast. A timeout / dead transport is
                    // not "try the next alias" — agent mode has 5 candidates ×
                    // 45s and left fork + parent chats stuck on 连接中.
                    if set_mode_abort_remaining_candidates(&last_err) {
                        break;
                    }
                }
            }
        }
        Err(format!("session/set_mode: {last_err}"))
    }

    fn map_handshake_err(&self, phase: &str, e: String) -> AgentError {
        let detail = self.format_exit_detail(&format!("{phase}: {e}"));
        // Bubblewrap / unprivileged userns must win over "stream closed" network mapping.
        if crate::error::looks_like_linux_sandbox_block(&detail)
            || crate::error::looks_like_linux_sandbox_block(&e)
        {
            return AgentError::new(AgentErrorCode::SandboxBlocked, detail);
        }
        let lower = detail.to_lowercase();
        if lower.contains("401")
            || lower.contains("auth")
            || lower.contains("unauthor")
            || lower.contains("login")
        {
            AgentError::new(AgentErrorCode::AuthFailed, detail)
        } else if lower.contains("network")
            || lower.contains("dns")
            || lower.contains("timeout")
            || lower.contains("5xx")
        {
            AgentError::new(AgentErrorCode::NetworkProvider, detail)
        } else {
            AgentError::new(AgentErrorCode::AgentCrashed, detail)
        }
    }

    /// Prompt the most recently bound agent session (`session/prompt`).
    pub async fn prompt(&self, text: &str) -> Result<(), AgentError> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::new(AgentErrorCode::AgentCrashed, "no session"))?;
        self.prompt_for(&sid, text).await
    }

    /// Prompt an explicit agent session (`session/prompt`).
    /// Shared-process multi-session: callers MUST pass the session they mean.
    pub async fn prompt_for(&self, session_id: &str, text: &str) -> Result<(), AgentError> {
        let sid = session_id.to_string();

        self.stopped.store(false, Ordering::SeqCst);

        // Fire and wait for completion in background via request future
        let this_params = wire_session_prompt_params(&sid, text);

        let result = self
            .request_prompt(this_params)
            .await
            .map_err(|e| classify_rpc_error(&e))?;

        let stop = result
            .get("stopReason")
            .or_else(|| result.get("stop_reason"))
            .and_then(|v| v.as_str())
            .unwrap_or("end_turn")
            .to_string();

        let _ = self.event_tx.send((
            Some(sid.clone()),
            AcpEvent::Stream {
                kind: StreamKind::Assistant,
                text: String::new(),
                message_id: None,
                done: true,
            },
        ));
        // Belt-and-suspenders with handle_line's unconditional PromptComplete
        // for session/prompt Ok (#522). Duplicate authoritative completes are
        // safe: second pass finds prompt_in_flight already false.
        let _ = self.event_tx.send((
            Some(sid),
            AcpEvent::PromptComplete {
                stop_reason: stop,
                authoritative: true,
            },
        ));
        Ok(())
    }

    /// Inject guidance into the active prompt without cancelling the turn.
    ///
    /// Grok Build soft-steer (not cancel-and-send). Wire method names:
    /// - CLI agent / TUI: `x.ai/interject` (canonical on grok 1.0.x)
    /// - Older / reverse-RPC style: `_x.ai/interject`
    ///
    /// Interject into the most recently bound agent session.
    pub async fn interject(&self, text: &str) -> Result<(), String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no agent session".to_string())?;
        self.interject_for(&sid, text).await
    }

    /// Interject into an explicit agent session (shared-process safe).
    ///
    /// Agent stdio registers **`_x.ai/interject`** (confirmed live: bare
    /// `x.ai/interject` returns -32601). Still fall back to `x.ai/interject`
    /// for hosts that only expose the unprefixed name.
    pub async fn interject_for(&self, session_id: &str, text: &str) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("empty interjection".into());
        }
        let params = wire_session_interject_params(session_id, text);
        match self.request("_x.ai/interject", params.clone()).await {
            Ok(_) => {
                info!("acp _x.ai/interject ok session={session_id}");
                Ok(())
            }
            Err(e) if rpc_looks_like_method_not_found(&e) => {
                warn!("acp _x.ai/interject not found ({e}); trying x.ai/interject");
                self.request("x.ai/interject", params)
                    .await
                    .map(|_| {
                        info!("acp x.ai/interject ok session={session_id}");
                    })
                    .map_err(|e2| format!("interject: {e2}"))
            }
            Err(e) => Err(format!("interject: {e}")),
        }
    }

    /// Cancel in-flight prompt on the most recently bound session (no id).
    pub async fn cancel(&self) -> Result<(), String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no session".to_string())?;
        self.cancel_for(&sid).await
    }

    /// Cancel in-flight prompt on an explicit session (shared-process safe).
    pub async fn cancel_for(&self, session_id: &str) -> Result<(), String> {
        self.stopped.store(true, Ordering::SeqCst);
        self.notify("session/cancel", wire_session_cancel_params(session_id))
            .await
    }

    /// Tell the CLI to unload idle sessions to disk (actor shutdown, cloud
    /// replica NOT finalized — still resumable via `session/load`).
    ///
    /// When the App detaches a viewed-only session, evicting its actor makes
    /// the next `session/load` fast: the CLI's reload waits up to 5s for the
    /// old session thread to finish, and an evicted (shutdown) thread finishes
    /// immediately instead of hanging for the whole deadline.
    pub async fn evict_sessions(&self, session_ids: &[String]) -> Result<Value, String> {
        let result = self
            .request_timeout(
                "x.ai/internal/evict_sessions",
                json!({ "sessionIds": session_ids }),
                5,
            )
            .await;
        if result.is_ok() {
            let mut map = self.last_update_by_session.lock();
            for sid in session_ids {
                map.remove(sid);
            }
        }
        result
    }

    /// List rewind points (one per user prompt). Grok extension `x.ai/rewind/points`.
    pub async fn rewind_points(&self) -> Result<Value, String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no session".to_string())?;
        self.rewind_points_for(&sid).await
    }

    /// List rewind points on an explicit session (shared-process safe).
    pub async fn rewind_points_for(&self, session_id: &str) -> Result<Value, String> {
        self.request("x.ai/rewind/points", json!({ "sessionId": session_id }))
            .await
    }

    /// Truncate agent conversation to a user-prompt index (and optionally restore files).
    /// Grok extension `x.ai/rewind/execute` — `targetPromptIndex` is 0-based user turn index.
    ///
    /// Semantics (TUI `/rewind`): discard everything **after** the selected turn.
    /// For "edit last user message", pass the **previous** user-turn index, or when
    /// editing the only user message use index `0` with a full clear via host journal.
    /// Truncate agent conversation on the most recently bound session.
    pub async fn rewind_execute(
        &self,
        target_prompt_index: u32,
        restore_files: bool,
    ) -> Result<Value, String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no session".to_string())?;
        self.rewind_execute_for(&sid, target_prompt_index, restore_files)
            .await
    }

    /// Truncate agent conversation on an explicit session (shared-process safe).
    ///
    /// Tries `x.ai/rewind/execute` then `_x.ai/rewind/execute` (stdio often
    /// registers the underscored ext-method, same as interject). Skips the RPC
    /// when `initialize` explicitly did not advertise rewind.
    pub async fn rewind_execute_for(
        &self,
        session_id: &str,
        target_prompt_index: u32,
        restore_files: bool,
    ) -> Result<Value, String> {
        if self.rewind_supported.lock().as_ref() == Some(&false) {
            // Phrase matches `rpc_looks_like_method_not_found` so callers
            // (journal drop-last) take the clean unsupported path, not the
            // last-turn fallback retry.
            return Err("rewind method not supported (not advertised by agent initialize)".into());
        }
        // Prefer conversation truncate; file restore is optional (edit-resend usually false).
        let mut params = json!({
            "sessionId": session_id,
            "targetPromptIndex": target_prompt_index,
        });
        if let Some(obj) = params.as_object_mut() {
            obj.insert("restoreFiles".into(), Value::Bool(restore_files));
            // Some builds accept this camelCase alias.
            obj.insert("restore_files".into(), Value::Bool(restore_files));
        }
        let mut last_err = String::new();
        for method in rewind_execute_method_candidates() {
            match self.request(method, params.clone()).await {
                Ok(v) => {
                    *self.rewind_supported.lock() = Some(true);
                    return Ok(v);
                }
                Err(e) if rpc_looks_like_method_not_found(&e) => {
                    last_err = e;
                }
                Err(e) => return Err(e),
            }
        }
        *self.rewind_supported.lock() = Some(false);
        Err(last_err)
    }

    /// Unblock a waiting `session/prompt` RPC (e.g. after host circuit-breaker cancel).
    pub fn abort_pending_prompts(&self, message: &str) {
        let mut pending = self.pending.lock();
        let ids: Vec<u64> = pending
            .iter()
            .filter(|(_, p)| p.method == "session/prompt")
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            if let Some(p) = pending.remove(&id) {
                let _ = p.tx.send(Err(message.to_string()));
            }
        }
    }

    pub async fn respond_permission(
        &self,
        rpc_id: u64,
        outcome: PermissionOutcome,
    ) -> Result<(), String> {
        let msg = wire_jsonrpc_result(rpc_id, wire_permission_result(&outcome));
        self.write_line(&msg).await
    }

    /// Reply to `_x.ai/exit_plan_mode` reverse-request.
    /// Wire body: `{ "outcome": "approved"|"cancelled"|"abandoned", "feedback"?: string }`.
    pub async fn respond_exit_plan_mode(
        &self,
        rpc_id: u64,
        outcome: &str,
        feedback: Option<String>,
    ) -> Result<(), String> {
        let result = wire_exit_plan_mode_result(outcome, feedback);
        let outcome_s = result
            .get("outcome")
            .and_then(|v| v.as_str())
            .unwrap_or("cancelled")
            .to_string();
        let msg = wire_jsonrpc_result(rpc_id, result);
        info!("acp → exit_plan_mode reply id={rpc_id} outcome={outcome_s}");
        self.write_line(&msg).await
    }

    /// Reply to `_x.ai/ask_user_question` reverse-request.
    ///
    /// Wire (internally-tagged `AskUserQuestionExtResponse`):
    /// - `{ "outcome": "accepted", "answers": { "<question>": "<answer>" }, "partial_answers": {} }`
    /// - `{ "outcome": "cancelled" }` when the user dismisses
    pub async fn respond_ask_user_question(
        &self,
        rpc_id: u64,
        outcome: AskUserOutcome,
    ) -> Result<(), String> {
        let result = wire_ask_user_result(&outcome);
        let msg = wire_jsonrpc_result(rpc_id, result.clone());
        info!(
            "acp → ask_user_question reply id={rpc_id} outcome={}",
            if matches!(
                result.get("outcome").and_then(|v| v.as_str()),
                Some("accepted")
            ) {
                "accepted"
            } else {
                "cancelled"
            }
        );
        self.write_line(&msg).await
    }

    pub fn agent_session_id(&self) -> Option<String> {
        self.agent_session_id.lock().clone()
    }

    pub async fn kill(&self) {
        // Stop both halves of the transport before touching the child. This is
        // essential for TCP ACP: closing only the writer left the reader task
        // alive and allowed ghost events from a remote peer after recycle.
        self.stopped.store(true, Ordering::SeqCst);
        self.reader_alive.store(false, Ordering::SeqCst);
        // `notify_waiters` only wakes tasks that are already waiting.  The
        // reader checks `reader_alive` immediately before entering `select!`,
        // so a kill racing that boundary could otherwise leave a TCP read
        // blocked forever.  `notify_one` stores a permit when no waiter exists,
        // making the cancellation edge-triggered and race-safe for the single
        // reader task.
        self.reader_stop.notify_one();
        self.fail_all_pending("agent stopped");
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
        *self.stdin.lock().await = None;
        self.last_update_by_session.lock().clear();
        *self.last_update_unstamped.lock() = None;
    }
}

#[derive(Debug, Clone)]
pub enum PermissionOutcome {
    Selected { option_id: String },
    Cancelled,
}

/// Client reply to `_x.ai/ask_user_question`.
#[derive(Debug, Clone)]
pub enum AskUserOutcome {
    /// Map of question text → selected label(s) and/or free-text answer.
    Accepted {
        answers: Value,
    },
    Cancelled,
}

// ── Wire builders / pure decoders (locked by tests/fixtures/acp/) ────────────

/// Host → agent `initialize` params. Golden: `handshake_initialize.json`.
pub fn wire_initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientInfo": { "name": "grok-app", "version": "0.1.0" },
        "capabilities": {
            "meta": {
                // Long-running bash/terminal commands stream incremental
                // output back to the client instead of sitting silent — the
                // UI shows progress instead of looking stalled.
                "x.ai/incrementalBashOutput": true,
                // Bash output without ANSI color codes (cleaner line dumps).
                "x.ai/bashOutputNoColor": true
            }
        }
    })
}

/// Extract per-model context window sizes from the `initialize` result's
/// `_meta.modelState.availableModels[].totalContextTokens` array.
///
/// ClaudeCode exposes live windows there; Grok CLI may not (soft-fail → empty).
/// Returned map is merged into `models_catalog` so the UI can show
/// "% of context used" without hardcoding per-model sizes.
pub fn parse_model_context_tokens(init: &Value) -> HashMap<String, u64> {
    let mut out = HashMap::new();
    let Some(models) = init
        .pointer("/_meta/modelState/availableModels")
        .and_then(|v| v.as_array())
    else {
        return out;
    };
    for m in models {
        let Some(id) = m.get("modelId").and_then(|v| v.as_str()) else {
            continue;
        };
        if let Some(tokens) = m
            .pointer("/_meta/totalContextTokens")
            .and_then(|v| v.as_u64())
        {
            out.insert(id.to_string(), tokens);
        }
    }
    out
}

/// Host → agent `session/prompt` params.
pub fn wire_session_prompt_params(session_id: &str, text: &str) -> Value {
    json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": text }]
    })
}

/// Host → agent `x.ai/interject` / `_x.ai/interject` params.
///
/// CLI TUI and agent use `{ sessionId, text }` (not `session/prompt` content blocks).
pub fn wire_session_interject_params(session_id: &str, text: &str) -> Value {
    json!({
        "sessionId": session_id,
        "text": text,
    })
}

/// Whether an ACP RPC error indicates the method name is unknown on this agent.
///
/// Used to fall back from `x.ai/interject` → `_x.ai/interject` (and similar dual tries).
pub fn rpc_looks_like_method_not_found(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("method not found")
        || lower.contains("-32601")
        || lower.contains("unknown method")
        || lower.contains("unknown ext_method")
        || lower.contains("method not supported")
}

/// Wire method names for conversation rewind (canonical, then stdio underscore).
pub fn rewind_execute_method_candidates() -> &'static [&'static str] {
    &["x.ai/rewind/execute", "_x.ai/rewind/execute"]
}

/// Parse `initialize` for rewind support.
///
/// - `Some(true)` when a methods list includes rewind
/// - `Some(false)` when an explicit methods list exists and omits rewind
/// - `None` when initialize does not publish a methods list (try RPC)
pub fn initialize_advertises_rewind(init: &Value) -> Option<bool> {
    const LISTS: &[&str] = &[
        "/_meta/extMethods",
        "/_meta/rpcMethods",
        "/_meta/methods",
        "/agentCapabilities/extMethods",
        "/agentCapabilities/_meta/extMethods",
        "/capabilities/extMethods",
    ];
    let mut saw_list = false;
    for pointer in LISTS {
        let Some(arr) = init.pointer(pointer).and_then(|v| v.as_array()) else {
            continue;
        };
        saw_list = true;
        for item in arr {
            let name = item.as_str().map(str::to_string).or_else(|| {
                item.get("method")
                    .or_else(|| item.get("name"))
                    .or_else(|| item.get("id"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            });
            if name.as_deref().is_some_and(method_looks_like_rewind) {
                return Some(true);
            }
        }
    }
    if saw_list {
        return Some(false);
    }
    None
}

fn method_looks_like_rewind(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("rewind/execute")
        || lower.contains("x.ai/rewind")
        || lower.contains("_x.ai/rewind")
        || lower == "rewind"
}

/// Host → agent `session/cancel` notification params.
pub fn wire_session_cancel_params(session_id: &str) -> Value {
    json!({ "sessionId": session_id })
}

/// Permission RPC result body (inside JSON-RPC `result`).
pub fn wire_permission_result(outcome: &PermissionOutcome) -> Value {
    match outcome {
        PermissionOutcome::Selected { option_id } => json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        }),
        PermissionOutcome::Cancelled => json!({
            "outcome": { "outcome": "cancelled" }
        }),
    }
}

/// Normalize + build `_x.ai/exit_plan_mode` reply body.
pub fn wire_exit_plan_mode_result(outcome: &str, feedback: Option<String>) -> Value {
    let outcome = match outcome {
        "approved" | "cancelled" | "abandoned" => outcome,
        "approve" | "yes" | "accept" => "approved",
        "abandon" | "quit" => "abandoned",
        _ => "cancelled",
    };
    let mut result = json!({ "outcome": outcome });
    if outcome == "cancelled" {
        if let Some(fb) = feedback.filter(|s| !s.trim().is_empty()) {
            result
                .as_object_mut()
                .unwrap()
                .insert("feedback".into(), Value::String(fb));
        }
    }
    result
}

/// `_x.ai/ask_user_question` reply body.
pub fn wire_ask_user_result(outcome: &AskUserOutcome) -> Value {
    match outcome {
        AskUserOutcome::Accepted { answers } => json!({
            "outcome": "accepted",
            "answers": answers,
            "partial_answers": {},
        }),
        AskUserOutcome::Cancelled => json!({ "outcome": "cancelled" }),
    }
}

/// Full JSON-RPC success envelope for a server→client request reply.
pub fn wire_jsonrpc_result(rpc_id: u64, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": result,
    })
}

/// Decode `session/request_permission` params into a host event.
pub fn decode_permission_request(rpc_id: u64, params: &Value) -> AcpEvent {
    let tool_call = params.get("toolCall").cloned().unwrap_or(Value::Null);
    let tool_call_id = tool_call
        .get("toolCallId")
        .or_else(|| tool_call.get("tool_call_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let title = tool_call
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Tool permission")
        .to_string();
    // Prefer real tool name over ACP kind labels like "execute" / "read".
    // Kind alone breaks tool-scoped session fallbacks (#542 shell →
    // allow-always-command).
    let tool_name = tool_call
        // `_meta` key is literally "x.ai/tool" — JSON Pointer needs `~1` (RFC 6901).
        .pointer("/_meta/x.ai~1tool/name")
        .or_else(|| tool_call.pointer("/_meta/tool/name"))
        .or_else(|| tool_call.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty() && s != "tool")
        .or_else(|| {
            // Title is often the tool id for Grok Build tools.
            let t = title.trim();
            if !t.is_empty() && t != "Tool permission" && !t.contains(' ') && t.contains('_') {
                Some(t.to_string())
            } else {
                None
            }
        })
        .or_else(|| {
            tool_call
                .get("kind")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "tool".into());
    // Options are usually top-level; accept a few alternate shapes so empty
    // lists don't force UI/Host generic fallbacks that CLI rejects (#542).
    let options = params
        .get("options")
        .cloned()
        .or_else(|| params.get("permissionOptions").cloned())
        .or_else(|| tool_call.get("options").cloned())
        .unwrap_or_else(|| json!([]));
    AcpEvent::PermissionRequest {
        rpc_id,
        tool_call_id,
        tool_name,
        title,
        options,
        raw: params.clone(),
    }
}

/// Best-effort decode of ACP hook session updates → a single UI event.
/// Field names vary across CLI builds; we accept both snake_case and camelCase.
pub fn parse_hook_activity_update(kind: &str, update: &Value) -> Option<AcpEvent> {
    let event_name = update
        .get("event_name")
        .or_else(|| update.get("eventName"))
        .or_else(|| update.get("hook_event_name"))
        .or_else(|| update.get("hookEventName"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_name = update
        .get("tool_name")
        .or_else(|| update.get("toolName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    let detail = update
        .get("detail")
        .or_else(|| update.get("message"))
        .or_else(|| update.get("text"))
        .or_else(|| update.get("reason"))
        .or_else(|| update.get("additional_context"))
        .or_else(|| update.get("additionalContext"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(500)
        .collect::<String>();
    let status = update
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ok = if let Some(b) = update.get("ok").and_then(|v| v.as_bool()) {
        Some(b)
    } else if status.is_empty() {
        // Aggregate from runs/hooks when present.
        let runs = update
            .get("hooks")
            .or_else(|| update.get("runs"))
            .or_else(|| update.get("entries"));
        if let Some(arr) = runs.and_then(|v| v.as_array()) {
            if arr.is_empty() {
                None
            } else {
                let any_fail = arr.iter().any(|e| {
                    let st = e
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    st.contains("fail")
                        || st.contains("error")
                        || st.contains("denied")
                        || st.contains("timeout")
                        || e.get("status").and_then(|v| v.get("Failed")).is_some()
                        || e.get("ok") == Some(&Value::Bool(false))
                });
                Some(!any_fail)
            }
        } else {
            None
        }
    } else if matches!(
        status.as_str(),
        "ok" | "success" | "succeeded" | "completed" | "allow" | "allowed"
    ) {
        Some(true)
    } else if matches!(
        status.as_str(),
        "fail"
            | "failed"
            | "error"
            | "denied"
            | "deny"
            | "block"
            | "blocked"
            | "timeout"
            | "timed_out"
            | "timedout"
    ) {
        Some(false)
    } else {
        None
    };

    // Annotation-only text: still surface when non-empty or known kind.
    let kind_l = kind.to_ascii_lowercase();
    if event_name.is_empty() && detail.is_empty() && tool_name.is_none() && ok.is_none() {
        // Keep a breadcrumb so the UI can show *something* for empty shells.
        if !kind_l.contains("hook") {
            return None;
        }
    }

    Some(AcpEvent::HookActivity {
        kind: kind.to_string(),
        event_name,
        tool_name,
        ok,
        detail,
        raw: update.clone(),
    })
}

/// Pure decode of CLI goal harness `goal_updated` (and soft goal_* variants).
fn parse_goal_updated(update: &Value) -> Option<AcpEvent> {
    let goal_id = update
        .get("goalId")
        .or_else(|| update.get("goal_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let role = update
        .get("currentSubagentRole")
        .or_else(|| update.get("current_subagent_role"))
        .or_else(|| update.get("role"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let current_deliverable_title = update
        .get("currentDeliverableTitle")
        .or_else(|| update.get("current_deliverable_title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let completed_deliverables = update
        .get("completedDeliverables")
        .or_else(|| update.get("completed_deliverables"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let total_deliverables = update
        .get("totalDeliverables")
        .or_else(|| update.get("total_deliverables"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let verifying_completion = update
        .get("verifyingCompletion")
        .or_else(|| update.get("verifying_completion"))
        .and_then(|v| v.as_bool());
    let last_classifier_verdict = update
        .get("lastClassifierVerdict")
        .or_else(|| update.get("last_classifier_verdict"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Require at least one goal-shaped field so we never invent empty noise.
    let has_shape = goal_id.is_some()
        || role.is_some()
        || current_deliverable_title.is_some()
        || completed_deliverables.is_some()
        || total_deliverables.is_some()
        || verifying_completion.is_some()
        || last_classifier_verdict.is_some()
        || update.get("objective").is_some()
        || update.get("deliverables").is_some();
    if !has_shape {
        // Still forward tagged goal_updated shells so the UI can note an empty pulse.
        let kind = update
            .get("sessionUpdate")
            .or_else(|| update.get("session_update"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if kind != "goal_updated" && kind != "goalUpdated" {
            return None;
        }
    }

    Some(AcpEvent::GoalUpdated {
        goal_id,
        role,
        current_deliverable_title,
        completed_deliverables,
        total_deliverables,
        verifying_completion,
        last_classifier_verdict,
        raw: update.clone(),
    })
}

/// Pure decode of `session/update` params → host events (no I/O).
/// Used by the live client and golden fixture tests.
pub fn decode_session_update(params: &Value) -> Vec<AcpEvent> {
    let update = params.get("update").unwrap_or(params);
    let kind = update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut out = Vec::new();
    match kind {
        "agent_message_chunk" => {
            let text = update
                .pointer("/content/text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let message_id = update
                .get("messageId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            out.push(AcpEvent::Stream {
                kind: StreamKind::Assistant,
                text,
                message_id,
                done: false,
            });
        }
        // Grok/Gemini emit agent_thought_chunk; some paths also use "thought".
        "agent_thought_chunk" | "thought" => {
            let text = update
                .pointer("/content/text")
                .and_then(|v| v.as_str())
                .or_else(|| update.get("text").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let message_id = update
                .get("messageId")
                .or_else(|| update.get("message_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if !text.is_empty() {
                out.push(AcpEvent::Stream {
                    kind: StreamKind::Thought,
                    text,
                    message_id,
                    done: false,
                });
            }
        }
        "plan" => {
            let entries = update.get("entries").cloned().unwrap_or(json!([]));
            let body = update
                .get("planContent")
                .or_else(|| update.get("plan_content"))
                .or_else(|| update.get("content"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            out.push(AcpEvent::Plan {
                entries,
                body,
                rpc_id: None,
                tool_call_id: None,
            });
        }
        "tool_call" | "tool_call_update" => {
            let tool_call_id = update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = update
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let k = update
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let status = update
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Never treat tool titles as compaction. Shell/scripts often embed
            // the word "compact" (e.g. `print("=== ALL POSTS compact ===")`) and
            // tool_call_update titles are the full command — substring matching
            // caused false context_compact|manual journal rows while CLI
            // compactionCount stayed 0. Real compact is sessionUpdate
            // auto_compact_completed / context_compact (+ tokens_before/after).
            out.push(AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind: k,
                status,
                raw: update.clone(),
            });
        }
        // Background shell: release open-tool accounting without journal churn.
        "task_backgrounded" => {
            let tool_call_id = update
                .get("tool_call_id")
                .or_else(|| update.get("toolCallId"))
                .or_else(|| update.get("task_id"))
                .or_else(|| update.get("taskId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !tool_call_id.is_empty() {
                out.push(AcpEvent::ToolOpenReleased { tool_call_id });
            }
        }
        "task_completed" => {
            let tool_call_id = update
                .pointer("/task_snapshot/task_id")
                .or_else(|| update.pointer("/taskSnapshot/taskId"))
                .or_else(|| update.get("tool_call_id"))
                .or_else(|| update.get("toolCallId"))
                .or_else(|| update.get("task_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !tool_call_id.is_empty() {
                out.push(AcpEvent::ToolOpenReleased { tool_call_id });
            }
        }
        "retry_state" => {
            let attempt = update.get("attempt").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let max_retries = update
                .get("max_retries")
                .or_else(|| update.get("maxRetries"))
                .and_then(|v| v.as_u64())
                .unwrap_or(HOST_PROVIDER_MAX_RETRIES as u64) as u32;
            let reason = update
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let status = update
                .get("type")
                .or_else(|| update.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("retrying")
                .to_string();
            out.push(AcpEvent::RetryState {
                attempt,
                max_retries,
                reason,
                status,
            });
        }
        // CLI occupancy + compact lifecycle (Grok Build 0.2.x wire).
        // auto_compact_started: { tokens_used, context_window, percentage }
        // auto_compact_completed: { tokens_before, tokens_after }
        "tokens_used"
        | "compaction"
        | "compaction_completed"
        | "context_compact"
        | "auto_compact"
        | "auto_compact_started"
        | "auto_compact_completed"
        | "auto_compact_failed"
        | "auto_compact_cancelled"
        | "compaction_checkpoint" => {
            // `auto_compact_started` / bare `tokens_used` are occupancy snapshots
            // (tokens_used + window), not compact completions — do not emit
            // ContextCompact without before/after (that would wipe the chip).
            let is_occupancy_only = kind == "tokens_used" || kind == "auto_compact_started";
            if !is_occupancy_only {
                if let Some((trigger, before, after, summary, note)) =
                    parse_context_compact_update(kind, update)
                {
                    out.push(AcpEvent::ContextCompact {
                        trigger,
                        tokens_before: before,
                        tokens_after: after,
                        summary_preview: summary,
                        note,
                    });
                }
            }
            // tokens_used / auto_compact_started → occupancy UsageReported.
            if let Some(ev) = parse_usage_update(kind, update) {
                out.push(ev);
            }
        }
        "usage" | "token_usage" | "tokenUsage" | "context_usage" | "contextUsage"
        | "turn_usage" | "turnUsage" | "turn_completed" | "response_completed" => {
            if let Some(ev) = parse_usage_update(kind, update) {
                out.push(ev);
            }
        }
        // Grok Build lifecycle hooks (scrollback annotations + execution status).
        "hook_execution" | "hook_annotation" | "hookExecution" | "hookAnnotation" => {
            if let Some(ev) = parse_hook_activity_update(kind, update) {
                out.push(ev);
            }
        }
        // Goal harness (CLI 0.2.117+): classifier / planner / strategist / verifier.
        "goal_updated" | "goalUpdated" => {
            if let Some(ev) = parse_goal_updated(update) {
                out.push(ev);
            }
        }
        _ => {
            // Soft-recognize other goal_* sessionUpdate kinds without inventing state.
            if kind.starts_with("goal_") || (kind.starts_with("goal") && kind.contains("update")) {
                if let Some(ev) = parse_goal_updated(update) {
                    out.push(ev);
                }
            }
            if let Some(ev) = parse_usage_update(kind, update) {
                out.push(ev);
            }
            // Structured compact only: before/after counters (not free-text titles).
            if update.get("tokens_before").is_some()
                || update.get("tokensBefore").is_some()
                || update.get("tokens_after").is_some()
                || update.get("tokensAfter").is_some()
            {
                if let Some((trigger, before, after, summary, note)) =
                    parse_context_compact_update(kind, update)
                {
                    out.push(AcpEvent::ContextCompact {
                        trigger,
                        tokens_before: before,
                        tokens_after: after,
                        summary_preview: summary,
                        note,
                    });
                    return out;
                }
            }
            // Do not invent ContextCompact from title text containing "compact".
        }
    }

    // Grok Build streams **context occupancy** on params._meta.totalTokens
    // (every thought/tool/message chunk). This is the real window fill — not
    // turn_completed.usage.totalTokens (which sums all modelCalls in the turn).
    // See contextUsage.ts: isLikelyBillingAggregateUsage.
    if let Some(n) = params
        .pointer("/_meta/totalTokens")
        .or_else(|| params.pointer("/_meta/total_tokens"))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_i64().map(|i| i.max(0) as u64))
                .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
        })
        .filter(|n| *n > 0)
    {
        // Skip if this update already emitted the same total via usage object
        // (avoid double occupancy events on a single packet).
        let already = out.iter().any(|ev| {
            matches!(
                ev,
                AcpEvent::UsageReported {
                    total_tokens: Some(t),
                    ..
                } if *t == n
            )
        });
        if !already {
            out.push(AcpEvent::UsageReported {
                total_tokens: Some(n),
                input_tokens: None,
                output_tokens: None,
                system_tokens: None,
                tools_tokens: None,
                history_tokens: None,
                cached_read_tokens: None,
                cache_creation_tokens: None,
                reasoning_tokens: None,
                cost_usd_ticks: None,
                model_calls: None,
                api_duration_ms: None,
                cost_is_partial: None,
                usage_is_incomplete: None,
                context_window: None,
                percentage: None,
                source: "context_size".to_string(),
            });
        }
    }

    out
}

/// One choice inside an ask-user question.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AskUserOption {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// One question presented by the agent.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestionItem {
    pub id: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<AskUserOption>,
    #[serde(default)]
    pub multi_select: bool,
}

#[derive(Debug, Clone)]
pub struct ParsedAskUserQuestion {
    pub tool_call_id: Option<String>,
    pub questions: Vec<AskUserQuestionItem>,
}

/// Parse flat `_x.ai/ask_user_question` params into UI-friendly questions.
///
/// Accepts several shapes seen on the wire / in tool schemas:
/// - `{ questions: [{ question, options, multiSelect? }] }`
/// - `{ question|prompt|text, options|choices }` (single question)
/// - option entries as strings or `{ label, description, id? }`
pub fn parse_ask_user_question_params(params: &Value) -> ParsedAskUserQuestion {
    let tool_call_id = params
        .get("toolCallId")
        .or_else(|| params.get("tool_call_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut questions = Vec::new();

    if let Some(arr) = params
        .get("questions")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
    {
        for (i, q) in arr.iter().enumerate() {
            if let Some(item) = parse_one_question(q, i) {
                questions.push(item);
            }
        }
    }

    if questions.is_empty() {
        // Flat single-question form.
        if let Some(item) = parse_one_question(params, 0) {
            // Only keep if there is real question text or options.
            if !item.question.is_empty() || !item.options.is_empty() {
                questions.push(item);
            }
        }
    }

    // Last-resort: string prompt field only.
    if questions.is_empty() {
        let text = params
            .get("prompt")
            .or_else(|| params.get("message"))
            .or_else(|| params.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !text.is_empty() {
            questions.push(AskUserQuestionItem {
                id: "0".into(),
                question: text,
                options: Vec::new(),
                multi_select: false,
            });
        }
    }

    ParsedAskUserQuestion {
        tool_call_id,
        questions,
    }
}

fn parse_one_question(q: &Value, index: usize) -> Option<AskUserQuestionItem> {
    if q.is_null() {
        return None;
    }
    // Bare string → free-text question.
    if let Some(s) = q.as_str() {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        return Some(AskUserQuestionItem {
            id: index.to_string(),
            question: s.to_string(),
            options: Vec::new(),
            multi_select: false,
        });
    }

    let obj = q.as_object()?;
    let question = obj
        .get("question")
        .or_else(|| obj.get("prompt"))
        .or_else(|| obj.get("text"))
        .or_else(|| obj.get("header"))
        .or_else(|| obj.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let multi_select = obj
        .get("multiSelect")
        .or_else(|| obj.get("multi_select"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let id = obj
        .get("id")
        .or_else(|| obj.get("questionId"))
        .or_else(|| obj.get("question_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| index.to_string());

    let options_val = obj
        .get("options")
        .or_else(|| obj.get("choices"))
        .cloned()
        .unwrap_or(json!([]));
    let options = parse_ask_user_options(&options_val);

    if question.is_empty() && options.is_empty() {
        return None;
    }

    Some(AskUserQuestionItem {
        id,
        question: if question.is_empty() {
            format!("Question {}", index + 1)
        } else {
            question
        },
        options,
        multi_select,
    })
}

fn parse_ask_user_options(v: &Value) -> Vec<AskUserOption> {
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (i, item) in arr.iter().enumerate() {
        if let Some(s) = item.as_str() {
            let label = s.trim();
            if label.is_empty() {
                continue;
            }
            out.push(AskUserOption {
                id: format!("opt-{i}"),
                label: label.to_string(),
                description: None,
            });
            continue;
        }
        let Some(obj) = item.as_object() else {
            continue;
        };
        let label = obj
            .get("label")
            .or_else(|| obj.get("name"))
            .or_else(|| obj.get("text"))
            .or_else(|| obj.get("title"))
            .or_else(|| obj.get("value"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if label.is_empty() {
            continue;
        }
        let id = obj
            .get("id")
            .or_else(|| obj.get("optionId"))
            .or_else(|| obj.get("option_id"))
            .or_else(|| obj.get("value"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("opt-{i}"));
        let description = obj
            .get("description")
            .or_else(|| obj.get("desc"))
            .or_else(|| obj.get("detail"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(AskUserOption {
            id,
            label,
            description,
        });
    }
    out
}

#[cfg(test)]
mod session_update_decode_tests {
    use super::*;

    #[test]
    fn decodes_task_backgrounded_and_completed_as_tool_open_released() {
        let bg = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "task_backgrounded",
                "tool_call_id": "call-f1b6b6f2-5e0f-413e-bafa-42a7ba048a01-10",
                "task_id": "call-f1b6b6f2-5e0f-413e-bafa-42a7ba048a01-10",
            }
        }));
        assert!(matches!(
            &bg[..],
            [AcpEvent::ToolOpenReleased { tool_call_id }]
                if tool_call_id == "call-f1b6b6f2-5e0f-413e-bafa-42a7ba048a01-10"
        ));

        let done = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "task_completed",
                "task_snapshot": {
                    "task_id": "call-bg-1",
                    "command": "sleep 1"
                },
                "will_wake": false
            }
        }));
        assert!(matches!(
            &done[..],
            [AcpEvent::ToolOpenReleased { tool_call_id }] if tool_call_id == "call-bg-1"
        ));
    }

    #[test]
    fn tool_call_update_still_decodes_as_tool_call() {
        let evs = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-1",
                "status": "in_progress",
                "title": "run_terminal_command"
            }
        }));
        assert!(matches!(
            &evs[..],
            [AcpEvent::ToolCall {
                tool_call_id,
                status,
                ..
            }] if tool_call_id == "call-1" && status == "in_progress"
        ));
    }

    #[test]
    fn native_web_search_tool_lifecycle_keeps_wire_identity_and_payload() {
        let pending = decode_session_update(&json!({
            "sessionId": "s-native-search",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "call-web-1",
                "status": "pending",
                "kind": "search",
                "title": "web_search",
                "rawInput": { "query": "Grok Build ACP" }
            }
        }));
        let completed = decode_session_update(&json!({
            "sessionId": "s-native-search",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-web-1",
                "status": "completed",
                "kind": "search",
                "title": "web_search",
                "content": [{ "type": "text", "text": "search result" }]
            }
        }));

        assert!(matches!(
            &pending[..],
            [AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw,
            }] if tool_call_id == "call-web-1"
                && title == "web_search"
                && kind == "search"
                && status == "pending"
                && raw.pointer("/rawInput/query").and_then(Value::as_str)
                    == Some("Grok Build ACP")
        ));
        assert!(matches!(
            &completed[..],
            [AcpEvent::ToolCall {
                tool_call_id,
                status,
                raw,
                ..
            }] if tool_call_id == "call-web-1"
                && status == "completed"
                && raw.pointer("/content/0/text").and_then(Value::as_str)
                    == Some("search result")
        ));
    }

    #[test]
    fn hook_execution_decodes_with_runs() {
        let evs = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "hook_execution",
                "event_name": "PreToolUse",
                "tool_name": "Bash",
                "hooks": [
                    { "name": "guard.sh", "status": "success" },
                    { "name": "bad", "status": "failed", "detail": "exit 1" }
                ]
            }
        }));
        assert!(matches!(
            &evs[..],
            [AcpEvent::HookActivity {
                kind,
                event_name,
                tool_name: Some(tool),
                ok: Some(false),
                ..
            }] if kind == "hook_execution"
                && event_name == "PreToolUse"
                && tool == "Bash"
        ));
    }

    #[test]
    fn hook_annotation_decodes_text() {
        let evs = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "hook_annotation",
                "text": "Hook annotation: stop_failure"
            }
        }));
        assert!(matches!(
            &evs[..],
            [AcpEvent::HookActivity {
                kind,
                detail,
                ..
            }] if kind == "hook_annotation" && detail.contains("stop_failure")
        ));
    }

    #[test]
    fn goal_updated_decodes_classifier_role() {
        let evs = decode_session_update(&json!({
            "update": {
                "sessionUpdate": "goal_updated",
                "goal_id": "g-1",
                "current_subagent_role": "goal classifier",
                "current_deliverable_title": "Ship UI",
                "completed_deliverables": 1,
                "total_deliverables": 3,
                "verifying_completion": true,
                "last_classifier_verdict": "not_achieved"
            }
        }));
        assert!(matches!(
            &evs[..],
            [AcpEvent::GoalUpdated {
                goal_id: Some(gid),
                role: Some(role),
                completed_deliverables: Some(1),
                total_deliverables: Some(3),
                verifying_completion: Some(true),
                last_classifier_verdict: Some(verdict),
                ..
            }] if gid == "g-1"
                && role.contains("classifier")
                && verdict == "not_achieved"
        ));
    }

    #[test]
    fn goal_updated_empty_shell_still_emits() {
        let evs = decode_session_update(&json!({
            "update": { "sessionUpdate": "goal_updated" }
        }));
        assert!(matches!(&evs[..], [AcpEvent::GoalUpdated { .. }]));
    }
}

#[cfg(test)]
mod usage_parse_tests {
    use super::*;

    #[test]
    fn parse_nested_usage_object() {
        let update = json!({
            "usage": {
                "inputTokens": 1200,
                "outputTokens": 340,
                "totalTokens": 1540
            }
        });
        let ev = parse_usage_update("usage", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                total_tokens,
                input_tokens,
                output_tokens,
                system_tokens,
                tools_tokens,
                history_tokens,
                ..
            } => {
                assert_eq!(total_tokens, Some(1540));
                assert_eq!(input_tokens, Some(1200));
                assert_eq!(output_tokens, Some(340));
                assert_eq!(system_tokens, None);
                assert_eq!(tools_tokens, None);
                assert_eq!(history_tokens, None);
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_flat_snake_case_sums_total() {
        let update = json!({
            "input_tokens": 10,
            "output_tokens": 5
        });
        let ev = parse_usage_update("turn_usage", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                total_tokens,
                input_tokens,
                output_tokens,
                ..
            } => {
                assert_eq!(input_tokens, Some(10));
                assert_eq!(output_tokens, Some(5));
                assert_eq!(total_tokens, Some(15));
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_structured_system_tools_history() {
        let update = json!({
            "usage": {
                "totalTokens": 9000,
                "systemTokens": 800,
                "toolsTokens": 1200,
                "historyTokens": 7000
            }
        });
        let ev = parse_usage_update("contextUsage", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                total_tokens,
                system_tokens,
                tools_tokens,
                history_tokens,
                ..
            } => {
                assert_eq!(total_tokens, Some(9000));
                assert_eq!(system_tokens, Some(800));
                assert_eq!(tools_tokens, Some(1200));
                assert_eq!(history_tokens, Some(7000));
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_usage_empty_returns_none() {
        assert!(parse_usage_update("usage", &json!({})).is_none());
        assert!(parse_usage_update("other", &json!({ "title": "hi" })).is_none());
    }
}

#[cfg(test)]
mod context_tokens_tests {
    use super::*;

    #[test]
    fn parse_real_model_state_shape() {
        // Mirrors ClaudeCode `initialize` `_meta.modelState.availableModels`.
        let init = json!({
            "_meta": {
                "agentVersion": "claudecode 1.0.0",
                "modelState": {
                    "availableModels": [
                        {
                            "modelId": "claude-sonnet-4",
                            "_meta": { "totalContextTokens": 200000 }
                        },
                        {
                            "modelId": "claude-opus-4",
                            "_meta": { "totalContextTokens": 200000 }
                        }
                    ]
                }
            }
        });
        let windows = parse_model_context_tokens(&init);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows.get("claude-sonnet-4"), Some(&200000));
        assert_eq!(windows.get("claude-opus-4"), Some(&200000));
    }

    #[test]
    fn empty_when_model_state_absent() {
        // Grok CLI does not expose `_meta.modelState` — must soft-fail to empty.
        assert!(parse_model_context_tokens(&json!({})).is_empty());
        assert!(parse_model_context_tokens(&json!({ "_meta": {} })).is_empty());
        assert!(parse_model_context_tokens(
            &json!({ "_meta": { "agentVersion": "grok 0.2.117" } })
        )
        .is_empty());
    }

    #[test]
    fn skips_models_without_window() {
        // Models lacking `_meta.totalContextTokens` are skipped (no zero invent).
        let init = json!({
            "_meta": {
                "modelState": {
                    "availableModels": [
                        { "modelId": "has-window", "_meta": { "totalContextTokens": 128000 } },
                        { "modelId": "no-window", "_meta": {} },
                        { "modelId": "no-meta" },
                        { "_meta": { "totalContextTokens": 999 } }
                    ]
                }
            }
        });
        let windows = parse_model_context_tokens(&init);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows.get("has-window"), Some(&128000));
        assert!(!windows.contains_key("no-window"));
        assert!(!windows.contains_key("no-meta"));
    }

    #[test]
    fn parse_usage_extracts_session_spend_fields() {
        let update = json!({
            "usage": {
                "inputTokens": 127521,
                "outputTokens": 2554,
                "totalTokens": 130075,
                "cachedReadTokens": 69504,
                "reasoningTokens": 1698,
                "modelCalls": 3,
                "apiDurationMs": 56883,
                "costUsdTicks": 2011100000u64,
                "costIsPartial": false,
                "usageIsIncomplete": true
            }
        });
        let ev = parse_usage_update("turn_completed", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                model_calls,
                api_duration_ms,
                cost_usd_ticks,
                cost_is_partial,
                usage_is_incomplete,
                source,
                ..
            } => {
                assert_eq!(model_calls, Some(3));
                assert_eq!(api_duration_ms, Some(56883));
                assert_eq!(cost_usd_ticks, Some(2011100000));
                assert_eq!(cost_is_partial, Some(false));
                assert_eq!(usage_is_incomplete, Some(true));
                assert_eq!(source, "turn_completed");
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_usage_extracts_cache_reasoning_cost_fields() {
        // ClaudeCode-style usage with prompt-caching + reasoning + cost.
        let update = json!({
            "usage": {
                "inputTokens": 10000,
                "outputTokens": 100,
                "totalTokens": 10100,
                "cachedReadTokens": 6000,
                "cacheCreationTokens": 1500,
                "reasoningTokens": 800,
                "costUsdTicks": 25
            }
        });
        let ev = parse_usage_update("usage", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                cached_read_tokens,
                cache_creation_tokens,
                reasoning_tokens,
                cost_usd_ticks,
                ..
            } => {
                assert_eq!(cached_read_tokens, Some(6000));
                assert_eq!(cache_creation_tokens, Some(1500));
                assert_eq!(reasoning_tokens, Some(800));
                assert_eq!(cost_usd_ticks, Some(25));
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_usage_cache_only_still_fires() {
        // A payload carrying only cache stats must still emit (no token buckets).
        let update = json!({
            "usage": {
                "cachedReadTokens": 4000,
                "reasoningTokens": 200
            }
        });
        let ev = parse_usage_update("usage", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported {
                input_tokens,
                cached_read_tokens,
                reasoning_tokens,
                ..
            } => {
                assert_eq!(input_tokens, None);
                assert_eq!(cached_read_tokens, Some(4000));
                assert_eq!(reasoning_tokens, Some(200));
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn parse_turn_completed_routes_to_usage() {
        // `turn_completed` / `response_completed` now route to parse_usage_update.
        let update = json!({
            "usage": { "totalTokens": 500, "inputTokens": 400, "outputTokens": 100 }
        });
        let ev = parse_usage_update("turn_completed", &update).expect("usage");
        match ev {
            AcpEvent::UsageReported { total_tokens, .. } => {
                assert_eq!(total_tokens, Some(500));
            }
            _ => panic!("expected UsageReported"),
        }
    }

    #[test]
    fn decode_stream_chunk_emits_context_size_from_params_meta() {
        // Live Grok shape: occupancy lives on params._meta, not update.usage.
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": { "type": "text", "text": "thinking…" }
            },
            "_meta": {
                "totalTokens": 27148,
                "updateType": "AgentThoughtChunk"
            }
        }));
        let size = evs.iter().find_map(|e| match e {
            AcpEvent::UsageReported {
                total_tokens,
                source,
                input_tokens,
                ..
            } if source == "context_size" => Some((*total_tokens, *input_tokens)),
            _ => None,
        });
        assert_eq!(size, Some((Some(27148), None)));
    }

    #[test]
    fn decode_turn_completed_keeps_billing_usage_and_optional_meta_size() {
        // Billing aggregate on update.usage; meta may omit occupancy.
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "turn_completed",
                "usage": {
                    "inputTokens": 1_681_484,
                    "outputTokens": 19_856,
                    "totalTokens": 1_701_340,
                    "cachedReadTokens": 1_581_440,
                    "modelCalls": 19
                }
            },
            "_meta": { "eventId": "e1" }
        }));
        let billing = evs.iter().find_map(|e| match e {
            AcpEvent::UsageReported {
                total_tokens,
                source,
                ..
            } if source == "turn_completed" => *total_tokens,
            _ => None,
        });
        assert_eq!(billing, Some(1_701_340));
        // No params._meta.totalTokens → no context_size event.
        assert!(evs.iter().all(|e| !matches!(
            e,
            AcpEvent::UsageReported { source, .. } if source == "context_size"
        )));
    }

    #[test]
    fn decode_auto_compact_started_emits_cli_occupancy_triplet() {
        // Live Grok Build wire from updates.jsonl:
        // tokens_used + context_window + percentage (same as /session-info).
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "auto_compact_started",
                "tokens_used": 402603,
                "context_window": 500000,
                "percentage": 81,
                "reason": "Context window 81% full"
            }
        }));
        let occ = evs.iter().find_map(|e| match e {
            AcpEvent::UsageReported {
                total_tokens,
                context_window,
                percentage,
                source,
                input_tokens,
                ..
            } if source == "auto_compact_started" => {
                Some((*total_tokens, *context_window, *percentage, *input_tokens))
            }
            _ => None,
        });
        assert_eq!(occ, Some((Some(402603), Some(500000), Some(81), None)));
        // Must not emit ContextCompact (no tokens_after yet).
        assert!(evs
            .iter()
            .all(|e| !matches!(e, AcpEvent::ContextCompact { .. })));
    }

    #[test]
    fn decode_auto_compact_completed_emits_compact_with_before_after() {
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "auto_compact_completed",
                "tokens_before": 402603,
                "tokens_after": 34179,
                "elapsed_ms": 33181
            }
        }));
        let compact = evs.iter().find_map(|e| match e {
            AcpEvent::ContextCompact {
                tokens_before,
                tokens_after,
                trigger,
                ..
            } => Some((*tokens_before, *tokens_after, trigger.clone())),
            _ => None,
        });
        assert_eq!(
            compact,
            Some((Some(402603), Some(34179), "auto".to_string()))
        );
    }

    /// Regression: session 08dddbec — tool_call_update title carried a python
    /// script with `print("=== ALL POSTS compact ===")`. Host used to emit
    /// ContextCompact(manual) and write false journal markers while CLI
    /// compactionCount stayed 0 and window was only ~26% full.
    #[test]
    fn decode_tool_title_with_compact_word_is_not_context_compact() {
        let title = "[bg] python3 << 'PY'\n\
#!/usr/bin/env python3\n\
# Re-fetch and keep ONLY tweets authored by target rest_id\n\
print(\"\\n=== ALL POSTS compact ===\")\n\
for t in posts:\n\
    print(t)\n\
PY";
        let evs = decode_session_update(&json!({
            "sessionId": "019fe423-886c-7951-b4f6-49c26b7276b7",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call-61d634aa-c1ae-424d-bc82-750e5377b990-27",
                "status": "completed",
                "kind": "execute",
                "title": title
            }
        }));
        assert!(
            evs.iter()
                .all(|e| !matches!(e, AcpEvent::ContextCompact { .. })),
            "tool title containing the word compact must not be ContextCompact: {evs:?}"
        );
        assert!(
            evs.iter().any(|e| matches!(
                e,
                AcpEvent::ToolCall { status, .. } if status == "completed"
            )),
            "expected ToolCall completed: {evs:?}"
        );
    }

    #[test]
    fn decode_unknown_update_title_with_compact_word_is_not_context_compact() {
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "mystery_status",
                "title": "Execute print('ALL POSTS compact') finished"
            }
        }));
        assert!(
            evs.iter()
                .all(|e| !matches!(e, AcpEvent::ContextCompact { .. })),
            "unknown update title must not invent compact: {evs:?}"
        );
    }

    #[test]
    fn decode_unknown_update_with_token_counters_still_emits_context_compact() {
        let evs = decode_session_update(&json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "custom_compaction_done",
                "tokens_before": 100_000,
                "tokens_after": 20_000,
                "trigger": "manual"
            }
        }));
        let compact = evs.iter().find_map(|e| match e {
            AcpEvent::ContextCompact {
                tokens_before,
                tokens_after,
                trigger,
                ..
            } => Some((*tokens_before, *tokens_after, trigger.clone())),
            _ => None,
        });
        assert_eq!(
            compact,
            Some((Some(100_000), Some(20_000), "manual".to_string()))
        );
    }
}

#[cfg(test)]
mod ask_user_question_tests {
    use super::*;

    #[test]
    fn parse_questions_array_with_object_options() {
        let params = json!({
            "sessionId": "s1",
            "toolCallId": "call-1",
            "questions": [{
                "question": "Which store?",
                "multiSelect": false,
                "options": [
                    { "label": "SQLite", "description": "Local file" },
                    { "label": "Postgres", "description": "Server" }
                ]
            }]
        });
        let p = parse_ask_user_question_params(&params);
        assert_eq!(p.tool_call_id.as_deref(), Some("call-1"));
        assert_eq!(p.questions.len(), 1);
        assert_eq!(p.questions[0].question, "Which store?");
        assert!(!p.questions[0].multi_select);
        assert_eq!(p.questions[0].options.len(), 2);
        assert_eq!(p.questions[0].options[0].label, "SQLite");
        assert_eq!(
            p.questions[0].options[0].description.as_deref(),
            Some("Local file")
        );
    }

    #[test]
    fn parse_flat_single_question_string_options() {
        let params = json!({
            "question": "Ship it?",
            "options": ["Yes", "No", "Later"]
        });
        let p = parse_ask_user_question_params(&params);
        assert_eq!(p.questions.len(), 1);
        assert_eq!(p.questions[0].question, "Ship it?");
        assert_eq!(
            p.questions[0]
                .options
                .iter()
                .map(|o| o.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Yes", "No", "Later"]
        );
    }

    #[test]
    fn parse_multi_select_and_snake_case() {
        let params = json!({
            "questions": [{
                "question": "Pick targets",
                "multi_select": true,
                "choices": [
                    { "name": "macOS" },
                    { "name": "Windows" }
                ]
            }]
        });
        let p = parse_ask_user_question_params(&params);
        assert_eq!(p.questions.len(), 1);
        assert!(p.questions[0].multi_select);
        assert_eq!(p.questions[0].options.len(), 2);
        assert_eq!(p.questions[0].options[1].label, "Windows");
    }

    #[test]
    fn parse_prompt_only_free_text() {
        let params = json!({ "prompt": "What should the package be named?" });
        let p = parse_ask_user_question_params(&params);
        assert_eq!(p.questions.len(), 1);
        assert_eq!(p.questions[0].question, "What should the package be named?");
        assert!(p.questions[0].options.is_empty());
    }

    #[test]
    fn parse_empty_params_yields_no_questions() {
        let p = parse_ask_user_question_params(&json!({}));
        assert!(p.questions.is_empty());
        assert!(p.tool_call_id.is_none());
    }
}

fn format_jsonrpc_error(err: &Value) -> String {
    let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    let message = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("rpc error")
        .to_string();
    let data = err
        .get("data")
        .map(|d| d.to_string())
        .filter(|s| s != "null" && !s.is_empty());
    match data {
        Some(d) => format!("{message} (code {code}, data: {d})"),
        None => format!("{message} (code {code})"),
    }
}

fn classify_rpc_error(e: &str) -> AgentError {
    // Linux bwrap / userns before "stream closed" → NetworkProvider (#541).
    if crate::error::looks_like_linux_sandbox_block(e) {
        return AgentError::new(AgentErrorCode::SandboxBlocked, e);
    }
    // Terminal included-usage / credit exhaustion first — keep the CLI sentence,
    // not a generic 429 / "provider retries exhausted" wrapper.
    if is_terminal_quota_reason(e) {
        return AgentError::new(AgentErrorCode::QuotaExceeded, humanize_quota_reason(e));
    }
    let lower = e.to_lowercase();
    if lower.contains("quota")
        || lower.contains("rate limit")
        || lower.contains("rate_limit")
        || lower.contains("429")
        || lower.contains("not entitled")
        || lower.contains("insufficient credit")
        || lower.contains("out of credits")
        || lower.contains("usage limit")
    {
        return AgentError::new(AgentErrorCode::QuotaExceeded, e);
    }
    if lower.contains("could not connect")
        || lower.contains("edit aborted")
        || lower.contains("no active session")
        || lower.contains("acp client missing")
        || lower.contains("no session")
    {
        return AgentError::new(AgentErrorCode::ConnectFailed, e);
    }
    // Auth / credentials. xAI often returns HTTP *400* with
    // "Incorrect API key provided" (not 401, and the string has no "auth"),
    // which previously fell through to AgentCrashed and showed the crash deck.
    if lower.contains("401")
        || lower.contains("auth")
        || lower.contains("unauthor")
        || lower.contains("login")
        || lower.contains("access denied")
        || lower.contains("authentication code")
        || lower.contains("incorrect api key")
        || lower.contains("invalid api key")
        || lower.contains("invalid or expired credentials")
        || lower.contains("bad-credentials")
        || lower.contains("bad credentials")
        || lower.contains("no auth context")
        || (lower.contains("api key")
            && (lower.contains("incorrect")
                || lower.contains("invalid")
                || lower.contains("missing")
                || lower.contains("not provided")
                || lower.contains("provided")))
    {
        return AgentError::new(AgentErrorCode::AuthFailed, e);
    }
    if lower.contains("subscription") || lower.contains("billing") || lower.contains("payment") {
        // Subscription/billing without explicit quota → treat as auth/entitlement.
        return AgentError::new(AgentErrorCode::AuthFailed, e);
    }
    if lower.contains("dns")
        || lower.contains("timeout")
        || lower.contains("network")
        || lower.contains("5xx")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("504")
        || lower.contains("rpc channel closed")
        || lower.contains("shell_api_error")
        || lower.contains("no available channels")
        || lower.contains("provider retries")
        || lower.contains("service unavailable")
        || lower.contains("stream disconnected")
        || lower.contains("stream closed")
        || lower.contains("before completion")
        || lower.contains("response.completed")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("econnreset")
        || lower.contains("temporarily unavailable")
    {
        // Timeouts / provider 5xx / mid-stream flaps are network-provider, not process crash.
        AgentError::new(AgentErrorCode::NetworkProvider, e)
    } else if lower.contains("not found") && lower.contains("cli") {
        AgentError::new(AgentErrorCode::CliNotFound, e)
    } else {
        AgentError::new(AgentErrorCode::AgentCrashed, e)
    }
}

#[cfg(test)]
mod classify_rpc_error_tests {
    use super::*;

    #[test]
    fn xai_incorrect_api_key_http_400_is_auth_not_crash() {
        // Support: CharlieLam 2026-08-05 — xAI returns 400 + "Incorrect API key"
        // (no "auth" / "401" substring). Must not land on AgentCrashed.
        let msg = r#"Internal error (code -32603, data: {"http_status":400,"message":"API error (status 400 Bad Request): invalid-argument: Incorrect API key provided. You can obtain an API key from https://console.x.ai."})"#;
        let err = classify_rpc_error(msg);
        assert_eq!(err.code, AgentErrorCode::AuthFailed, "msg={msg}");
    }

    #[test]
    fn invalid_or_expired_credentials_is_auth() {
        let msg = "cli-proxy HTTP 401: Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=none, upstream=PermissionDenied, reason=no auth context)";
        assert_eq!(classify_rpc_error(msg).code, AgentErrorCode::AuthFailed);
        assert_eq!(
            classify_rpc_error("WKE=unauthenticated:bad-credentials").code,
            AgentErrorCode::AuthFailed
        );
    }

    #[test]
    fn stream_closed_eof_is_network_not_crash() {
        assert_eq!(
            classify_rpc_error("Agent stream closed (EOF)").code,
            AgentErrorCode::NetworkProvider
        );
    }

    #[test]
    fn bwrap_uid_map_denial_is_sandbox_blocked_not_network() {
        // Ubuntu 24.04: EOF + bwrap stderr must not land on NetworkProvider (#541).
        let msg = "Agent stream closed (EOF); stderr: bwrap: setting up uid map: Permission denied";
        assert_eq!(
            classify_rpc_error(msg).code,
            AgentErrorCode::SandboxBlocked,
            "msg={msg}"
        );
    }

    #[test]
    fn process_exit_wording_still_crashes() {
        // Bare process-exit strings without network keywords stay crash.
        assert_eq!(
            classify_rpc_error("Agent process exited").code,
            AgentErrorCode::AgentCrashed
        );
    }

    #[test]
    fn provider_502_is_network() {
        assert_eq!(
            classify_rpc_error(
                "API error (status 502 Bad Gateway): upstream_error: Upstream service temporarily unavailable"
            )
            .code,
            AgentErrorCode::NetworkProvider
        );
    }

    #[test]
    fn free_usage_exhausted_429_is_quota_not_network() {
        let msg = "API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.6 for now. Usage resets over a rolling 24-hour window — tokens (actual/limit): 561857/500000. Upgrade to a Grok subscription for higher limits: https://grok.com/supergrok";
        let err = classify_rpc_error(msg);
        assert_eq!(err.code, AgentErrorCode::QuotaExceeded, "msg={msg}");
        assert!(
            err.message
                .contains("You've used all the included free usage"),
            "message={}",
            err.message
        );
        assert!(
            !err.message.contains("Provider request failed"),
            "message={}",
            err.message
        );
    }

    #[test]
    fn host_quota_abort_rpc_message_classifies_as_quota() {
        let reason = "API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.6 for now.";
        let abort = provider_retry_abort_rpc_message(reason);
        assert_eq!(
            classify_rpc_error(&abort).code,
            AgentErrorCode::QuotaExceeded,
            "abort={abort}"
        );
    }
}

/// Hard transport failures (no HTTP response) — fail after a few attempts so
/// a broken proxy / DNS outage cannot pin the UI as "thinking" for minutes.
const HARD_TRANSPORT_ABORT_ATTEMPTS: u32 = 3;

/// Terminal official/credit exhaustion — not a flaky 429 the host should ride out.
///
/// Real CLI/provider text looks like:
/// `API error (status 429 …): subscription:free-usage-exhausted: You've used all the included free usage…`
pub fn is_terminal_quota_reason(reason: &str) -> bool {
    let r = reason.to_ascii_lowercase();
    if r.is_empty() {
        return false;
    }
    r.contains("free-usage-exhausted")
        || r.contains("free_usage_exhausted")
        || r.contains("usage-exhausted")
        || r.contains("usage_exhausted")
        || r.contains("included free usage")
        || r.contains("included usage exhausted")
        || r.contains("you've used all")
        || r.contains("you have used all")
        || r.contains("used all the included")
        || r.contains("out of credits")
        || r.contains("insufficient credit")
        || r.contains("quota exceeded")
        || r.contains("quota_exceeded")
        || r.contains("额度用尽")
        || r.contains("额度已用尽")
        || r.contains("额度已用完")
        || r.contains("免費額度")
        || r.contains("免费额度已")
}

/// Prefer the CLI/provider sentence; drop HTTP / retry wrappers and billing CTA.
pub fn humanize_quota_reason(reason: &str) -> String {
    let trimmed = reason.trim();
    if trimmed.is_empty() {
        return "Included usage is exhausted".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    for needle in [
        "free-usage-exhausted:",
        "free_usage_exhausted:",
        "usage-exhausted:",
        "usage_exhausted:",
        "quota_exceeded:",
        "quota exceeded:",
    ] {
        if let Some(idx) = lower.find(needle) {
            let rest = trimmed[idx + needle.len()..].trim();
            if !rest.is_empty() {
                return truncate_quota_sentence(rest);
            }
        }
    }
    for needle in [
        "you've used all",
        "you have used all",
        "used all the included",
    ] {
        if let Some(idx) = lower.find(needle) {
            return truncate_quota_sentence(trimmed[idx..].trim());
        }
    }
    truncate_quota_sentence(trimmed)
}

fn truncate_quota_sentence(s: &str) -> String {
    let mut out = s;
    if let Some(idx) = out.find("tokens (actual") {
        out = out[..idx].trim_end_matches([' ', '—', '–', '-']);
    }
    let out = out.trim();
    if out.chars().count() > 280 {
        let end = out
            .char_indices()
            .nth(280)
            .map(|(i, _)| i)
            .unwrap_or(out.len());
        format!("{}…", &out[..end])
    } else {
        out.to_string()
    }
}

/// Chat-visible error when host stops waiting on `retry_state`.
pub fn provider_retry_abort_error(attempt: u32, cap: u32, reason: &str) -> AgentError {
    if is_terminal_quota_reason(reason) {
        AgentError::new(AgentErrorCode::QuotaExceeded, humanize_quota_reason(reason))
    } else {
        let msg = if reason.trim().is_empty() {
            format!("Provider request failed after {attempt} attempts (budget {cap})")
        } else {
            format!("Provider request failed after {attempt} attempts (budget {cap}): {reason}")
        };
        AgentError::new(AgentErrorCode::NetworkProvider, msg)
    }
}

/// Unblock `session/prompt` after a host circuit-break. Must classify as quota
/// when the reason is terminal, so a late RPC error cannot overwrite the deck.
pub fn provider_retry_abort_rpc_message(reason: &str) -> String {
    if is_terminal_quota_reason(reason) {
        format!(
            "included usage exhausted: {}",
            humanize_quota_reason(reason)
        )
    } else {
        format!("provider retries exhausted (host cap {HOST_PROVIDER_MAX_RETRIES})")
    }
}

/// True when the retry reason looks like a hard transport failure (not a flaky 5xx).
pub fn is_hard_transport_retry_reason(reason: &str) -> bool {
    let r = reason.to_ascii_lowercase();
    if r.is_empty() {
        return false;
    }
    r.contains("error sending request")
        || r.contains("connection reset")
        || r.contains("connection refused")
        || r.contains("network is unreachable")
        || r.contains("name or service not known")
        || r.contains("dns error")
        || r.contains("failed to lookup address")
        || r.contains("no route to host")
        || (r.contains("timed out") && (r.contains("connect") || r.contains("sending request")))
        || (r.contains("timeout") && r.contains("connect"))
}

/// Whether host should stop waiting and fail the turn.
///
/// - Terminal statuses (`exhausted` / `gave_up`) always abort.
/// - Terminal quota reasons (see [`is_terminal_quota_reason`]) abort immediately
///   so included-usage exhaustion is not ridden out as a flaky 429.
/// - Hard transport reasons (see [`is_hard_transport_retry_reason`]) abort after
///   a few attempts so the chat does not stay busy for the full 15-retry budget.
/// - Bare `failed` / `error` only abort once we have used most of the budget —
///   some relays emit `failed` on a single stream blip while still retrying.
/// - Otherwise abort when `attempt` reaches the host/agent cap.
pub fn should_abort_provider_retry(attempt: u32, max_retries: u32, status: &str) -> bool {
    should_abort_provider_retry_ex(attempt, max_retries, status, "")
}

/// Like [`should_abort_provider_retry`] but consults the human-readable reason
/// for hard-transport fail-fast and terminal quota.
pub fn should_abort_provider_retry_ex(
    attempt: u32,
    max_retries: u32,
    status: &str,
    reason: &str,
) -> bool {
    let status = status.to_lowercase();
    if status.contains("exhaust")
        || status.contains("gave_up")
        || status.contains("give_up")
        || status.contains("abort")
    {
        return true;
    }
    if is_terminal_quota_reason(reason) {
        return true;
    }
    if is_hard_transport_retry_reason(reason) && attempt >= HARD_TRANSPORT_ABORT_ATTEMPTS {
        return true;
    }
    let cap = max_retries.clamp(1, HOST_PROVIDER_MAX_RETRIES);
    // Soft-fail statuses: wait until we are near the cap so mid-stream flaps
    // (common on 中转) get more reconnect room before the turn is killed.
    if status.contains("fail") || status == "error" {
        let soft_floor = (cap.saturating_mul(2) / 3).max(1);
        return attempt >= soft_floor;
    }
    attempt >= cap
}

/// Parsed ACP API-mode server address (`host:port`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAcpServerAddr {
    pub host: String,
    pub port: u16,
}

impl ParsedAcpServerAddr {
    /// Target string for `TcpStream::connect` (brackets IPv6 hosts).
    pub fn connect_target(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

/// Parse `host:port` for API-mode ACP. Optional `ws://` / `wss://` / `tcp://` /
/// `http(s)://` scheme is stripped. Rejects empty host, invalid port, paths.
pub fn parse_acp_server_addr(raw: &str) -> Result<ParsedAcpServerAddr, String> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err("empty address".into());
    }

    // Optional scheme strip (paste-friendly).
    for prefix in ["ws://", "wss://", "tcp://", "http://", "https://"] {
        if let Some(rest) = s
            .get(..prefix.len())
            .filter(|p| p.eq_ignore_ascii_case(prefix))
            .and_then(|_| s.get(prefix.len()..))
        {
            s = rest.to_string();
            break;
        }
    }
    if let Some(at) = s.rfind('@') {
        s = s[at + 1..].to_string();
    }
    if s.contains('/') || s.contains('?') || s.contains('#') {
        return Err("not a host:port address".into());
    }
    let s = s.trim();
    if s.is_empty() {
        return Err("empty address".into());
    }

    let (host, port_raw): (String, String) = if s.starts_with('[') {
        let close = s.find(']').ok_or_else(|| "invalid host".to_string())?;
        if close <= 1 {
            return Err("empty host".into());
        }
        let host = s[1..close].to_string();
        let rest = &s[close + 1..];
        if !rest.starts_with(':') {
            return Err("missing port".into());
        }
        (host, rest[1..].to_string())
    } else {
        let Some(colon) = s.rfind(':') else {
            return Err("missing port".into());
        };
        // Bare IPv6 without brackets (multiple colons) — require [addr]:port.
        if s.find(':') != Some(colon) {
            return Err("not a host:port address".into());
        }
        (s[..colon].to_string(), s[colon + 1..].to_string())
    };

    let host = host.trim();
    let port_raw = port_raw.trim();
    if host.is_empty() {
        return Err("empty host".into());
    }
    if port_raw.is_empty() {
        return Err("missing port".into());
    }
    if host
        .chars()
        .any(|c| c.is_whitespace() || c == '/' || c == '?' || c == '#')
    {
        return Err("invalid host".into());
    }
    let host_ok = host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '%' | '-'))
        || host.chars().all(|c| c.is_ascii_hexdigit() || c == ':');
    if !host_ok {
        return Err("invalid host".into());
    }
    if !port_raw.chars().all(|c| c.is_ascii_digit()) || port_raw.len() > 5 {
        return Err("invalid port".into());
    }
    let port: u16 = port_raw.parse().map_err(|_| "invalid port".to_string())?;
    if port == 0 {
        return Err("invalid port".into());
    }

    Ok(ParsedAcpServerAddr {
        host: host.to_string(),
        port,
    })
}

/// TCP-only reachability probe for Settings → ACP server (no secrets, no RPC).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpServerProbeResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

impl AcpServerProbeResult {
    fn fail(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            latency_ms: None,
            error: Some(error.into()),
        }
    }
}

/// TCP connect to `host:port` with a ~2s timeout. Network path only — no
/// ACP handshake, no auth. Used by the Settings health check.
pub async fn acp_server_probe(addr: &str) -> AcpServerProbeResult {
    use tokio::time::{timeout, Duration};

    let parsed = match parse_acp_server_addr(addr) {
        Ok(p) => p,
        Err(e) => return AcpServerProbeResult::fail(e),
    };
    let target = parsed.connect_target();
    let started = Instant::now();
    match timeout(Duration::from_secs(2), TcpStream::connect(&target)).await {
        Ok(Ok(_stream)) => AcpServerProbeResult {
            ok: true,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        },
        Ok(Err(e)) => AcpServerProbeResult {
            ok: false,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: Some(format!("connect failed: {e}")),
        },
        Err(_) => AcpServerProbeResult::fail("connect timed out (2s)"),
    }
}

/// Result of an API-mode connectivity probe (see [`probe_acp_server`]).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpProbeResult {
    /// The server accepted a TCP connection and returned a valid ACP
    /// `initialize` result.
    pub ok: bool,
    pub agent_version: Option<String>,
    pub model: Option<String>,
    pub error: Option<String>,
}

impl AcpProbeResult {
    fn fail(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            agent_version: None,
            model: None,
            error: Some(error.into()),
        }
    }
}

/// Deeper connectivity check for **API mode**: TCP-connect to an ACP
/// server (`host:port`), perform the `initialize` handshake, and report the
/// agent version / current model. Creates no client and no session — just
/// confirms the address is reachable and speaks ACP. Bounded by timeouts so
/// a wrong address / silent port fails fast.
pub async fn probe_acp_server(addr: &str) -> AcpProbeResult {
    use tokio::time::{timeout, Duration};

    let target = match parse_acp_server_addr(addr) {
        Ok(p) => p.connect_target(),
        Err(e) => return AcpProbeResult::fail(e),
    };

    let stream = match timeout(Duration::from_secs(5), TcpStream::connect(&target)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return AcpProbeResult::fail(format!("connect failed: {e}")),
        Err(_) => return AcpProbeResult::fail("connect timed out (5s)"),
    };
    let _ = stream.set_nodelay(true);
    let (rd, mut wr) = stream.into_split();

    let req = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"grok-app-probe","version":"0"},"capabilities":{}}}"#;
    let write = async {
        wr.write_all(req.as_bytes()).await?;
        wr.write_all(b"\n").await?;
        wr.flush().await
    };
    if let Err(e) = write.await {
        return AcpProbeResult::fail(format!("write failed: {e}"));
    }

    let mut reader = BufReader::new(rd);
    let mut line = String::new();
    match timeout(Duration::from_secs(20), reader.read_line(&mut line)).await {
        Ok(Ok(n)) if n > 0 => {
            let v: Value = serde_json::from_str(line.trim()).unwrap_or(Value::Null);
            let result = &v["result"];
            if !result.is_object() {
                return AcpProbeResult::fail("connected, but no ACP initialize result in response");
            }
            let meta = &result["_meta"];
            let agent_version = meta["agentVersion"].as_str().map(String::from);
            crate::cli_probe::record_acp_agent_version(agent_version.as_deref());
            AcpProbeResult {
                ok: true,
                agent_version,
                model: meta["modelState"]["currentModelId"]
                    .as_str()
                    .map(String::from),
                error: None,
            }
        }
        Ok(Ok(_)) => AcpProbeResult::fail("server closed the connection (EOF) before responding"),
        Ok(Err(e)) => AcpProbeResult::fail(format!("read failed: {e}")),
        Err(_) => AcpProbeResult::fail("connected, but no ACP response within 20s"),
    }
}

#[cfg(test)]
mod acp_server_addr_tests {
    use super::*;

    #[test]
    fn parse_accepts_host_port() {
        let p = parse_acp_server_addr("127.0.0.1:8799").unwrap();
        assert_eq!(p.host, "127.0.0.1");
        assert_eq!(p.port, 8799);
        assert_eq!(p.connect_target(), "127.0.0.1:8799");
    }

    #[test]
    fn parse_strips_ws_scheme() {
        let p = parse_acp_server_addr("ws://localhost:2419").unwrap();
        assert_eq!(p.host, "localhost");
        assert_eq!(p.port, 2419);
    }

    #[test]
    fn parse_ipv6_brackets() {
        let p = parse_acp_server_addr("[::1]:8799").unwrap();
        assert_eq!(p.host, "::1");
        assert_eq!(p.port, 8799);
        assert_eq!(p.connect_target(), "[::1]:8799");
    }

    #[test]
    fn parse_rejects_empty_host_and_bad_port() {
        assert!(parse_acp_server_addr("").is_err());
        assert!(parse_acp_server_addr(":8799").is_err());
        assert!(parse_acp_server_addr("localhost").is_err());
        assert!(parse_acp_server_addr("localhost:0").is_err());
        assert!(parse_acp_server_addr("localhost:65536").is_err());
        assert!(parse_acp_server_addr("localhost:abc").is_err());
        assert!(parse_acp_server_addr("127.0.0.1:8799/path").is_err());
        assert!(parse_acp_server_addr("fe80::1").is_err());
    }

    #[tokio::test]
    async fn probe_invalid_addr_fails_fast() {
        let r = acp_server_probe("").await;
        assert!(!r.ok);
        assert!(r.error.is_some());
        assert!(r.latency_ms.is_none());
    }

    #[tokio::test]
    async fn probe_closed_port_reports_error() {
        // Connect to a high port that almost certainly has no listener.
        let r = acp_server_probe("127.0.0.1:1").await;
        assert!(!r.ok);
        assert!(r.error.is_some());
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;

    #[test]
    fn abort_at_host_cap_even_if_agent_allows_more() {
        assert!(!should_abort_provider_retry(1, 20, "retrying"));
        assert!(!should_abort_provider_retry(14, 20, "retrying"));
        assert!(should_abort_provider_retry(15, 20, "retrying"));
        assert!(should_abort_provider_retry(16, 20, "retrying"));
    }

    #[test]
    fn soft_fail_waits_until_near_cap() {
        // Bare "failed" mid-budget should not kill a flaky relay immediately.
        assert!(!should_abort_provider_retry(1, 12, "failed"));
        assert!(!should_abort_provider_retry(7, 12, "failed"));
        assert!(should_abort_provider_retry(8, 12, "failed")); // 2/3 of 12
        assert!(should_abort_provider_retry(1, 15, "exhausted"));
    }

    #[test]
    fn respect_lower_agent_max() {
        assert!(!should_abort_provider_retry(1, 3, "retrying"));
        assert!(should_abort_provider_retry(3, 3, "retrying"));
    }

    #[test]
    fn hard_transport_fails_fast() {
        let reason = "request error: error sending request for url (https://cli-chat-proxy.grok.com/v1/responses)";
        assert!(!should_abort_provider_retry_ex(1, 15, "retrying", reason));
        assert!(!should_abort_provider_retry_ex(2, 15, "retrying", reason));
        assert!(should_abort_provider_retry_ex(3, 15, "retrying", reason));
        // Transient 5xx-style reasons still use the full budget when status is retrying.
        assert!(!should_abort_provider_retry_ex(
            3,
            15,
            "retrying",
            "HTTP 503 Service Unavailable"
        ));
        assert!(is_hard_transport_retry_reason(reason));
        assert!(!is_hard_transport_retry_reason(
            "HTTP 503 Service Unavailable"
        ));
    }

    #[test]
    fn terminal_quota_fails_fast_and_is_not_a_bare_429() {
        let reason = "API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.6 for now. Usage resets over a rolling 24-hour window";
        assert!(is_terminal_quota_reason(reason));
        assert!(!is_terminal_quota_reason(
            "API error (status 429 Too Many Requests): rate limit, retry later"
        ));
        assert!(!is_terminal_quota_reason("HTTP 503 Service Unavailable"));
        assert!(should_abort_provider_retry_ex(1, 15, "retrying", reason));
        assert!(!should_abort_provider_retry_ex(
            1,
            15,
            "retrying",
            "API error (status 429 Too Many Requests): rate limit, retry later"
        ));
        let err = provider_retry_abort_error(1, 15, reason);
        assert_eq!(err.code, AgentErrorCode::QuotaExceeded);
        assert!(err
            .message
            .contains("You've used all the included free usage"));
        assert!(!err.message.contains("Provider request failed"));
        let net = provider_retry_abort_error(15, 15, "HTTP 503 Service Unavailable");
        assert_eq!(net.code, AgentErrorCode::NetworkProvider);
        assert!(net.message.contains("Provider request failed after 15"));
    }
}

#[cfg(test)]
mod prompt_fallback_tests {
    use super::*;

    fn grace() -> Duration {
        Duration::from_millis(PROMPT_COMPLETE_FALLBACK_GRACE_MS)
    }

    #[test]
    fn no_updates_yet_completes_immediately() {
        assert!(prompt_fallback_due(None, grace(), Instant::now()));
    }

    #[test]
    fn fallback_sid_match_is_scoped_per_session() {
        // Concurrent turns on one process: an explicit target only matches its
        // own session's prompt. Cross-None matching is no longer allowed (P0-4).
        assert!(pending_prompt_matches(Some("sidA"), Some("sidA")));
        assert!(!pending_prompt_matches(Some("sidA"), Some("sidB")));
        assert!(!pending_prompt_matches(None, Some("sidA")));
        assert!(!pending_prompt_matches(Some("sidA"), None));
        assert!(pending_prompt_matches(None, None));
    }

    #[test]
    fn silence_past_grace_completes() {
        let now = Instant::now();
        let last = now - grace() - Duration::from_millis(1);
        assert!(prompt_fallback_due(Some(last), grace(), now));
    }

    /// The regression: the agent keeps streaming after an early
    /// `prompt_complete`. Completing the RPC here truncated the answer.
    #[test]
    fn still_streaming_defers_completion() {
        let now = Instant::now();
        let last = now - Duration::from_millis(PROMPT_COMPLETE_FALLBACK_GRACE_MS / 2);
        assert!(!prompt_fallback_due(Some(last), grace(), now));
    }

    #[test]
    fn exactly_at_grace_boundary_completes() {
        let now = Instant::now();
        assert!(prompt_fallback_due(Some(now - grace()), grace(), now));
    }

    #[test]
    fn completed_turn_fallback_cannot_adopt_immediate_next_prompt() {
        let mut pending = HashMap::new();
        let (first_tx, _first_rx) = oneshot::channel();
        pending.insert(
            4,
            Pending {
                method: "session/prompt".into(),
                tx: first_tx,
                session_id: Some("sidA".into()),
            },
        );

        // Turn A emits prompt_complete, so its fallback captures only id=4.
        let captured = pending_prompt_ids_for(&pending, Some("sidA"));
        assert_eq!(captured, vec![4]);

        // Turn A's real RPC result lands, then the user immediately starts B.
        pending.remove(&4);
        let (second_tx, _second_rx) = oneshot::channel();
        pending.insert(
            5,
            Pending {
                method: "session/prompt".into(),
                tx: second_tx,
                session_id: Some("sidA".into()),
            },
        );

        // The stale fallback exits and cannot remove the newer waiter.
        assert!(!has_pending_prompt_ids(&pending, &captured));
        assert!(take_pending_prompt_ids(&mut pending, &captured).is_empty());
        assert!(pending.contains_key(&5));
    }
}

#[cfg(test)]
mod prompt_wait_timeout_tests {
    use super::*;

    fn idle() -> Duration {
        Duration::from_secs(PROMPT_IDLE_TIMEOUT_SECS)
    }

    #[test]
    fn healthy_activity_never_times_out() {
        let started = Instant::now();
        let last = started + Duration::from_secs(30 * 60);
        let now = last + Duration::from_secs(60);
        // 30+ min wall clock, but last update 60s ago — under 1800s idle.
        assert!(!prompt_wait_should_timeout(
            Some(last),
            started,
            now,
            idle()
        ));
    }

    #[test]
    fn pure_silence_hits_idle() {
        let started = Instant::now();
        let now = started + idle();
        assert!(prompt_wait_should_timeout(None, started, now, idle()));
    }

    #[test]
    fn stale_last_update_hits_idle() {
        let started = Instant::now();
        let last = started + Duration::from_secs(10);
        let now = last + idle();
        assert!(prompt_wait_should_timeout(Some(last), started, now, idle()));
    }

    #[test]
    fn long_running_with_fresh_updates_does_not_timeout() {
        let started = Instant::now();
        // Former 4h absolute ceiling plus a bit — still healthy if progress is fresh.
        let now = started + Duration::from_secs(5 * 60 * 60);
        let last = now - Duration::from_secs(1);
        assert!(!prompt_wait_should_timeout(
            Some(last),
            started,
            now,
            idle()
        ));
    }
}

#[cfg(test)]
mod background_wait_policy_tests {
    use super::*;

    #[test]
    fn normalize_policy_defaults_and_aliases() {
        assert_eq!(
            normalize_background_wait_policy(""),
            BackgroundWaitPolicy::Wait
        );
        assert_eq!(
            normalize_background_wait_policy("wait"),
            BackgroundWaitPolicy::Wait
        );
        assert_eq!(
            normalize_background_wait_policy("NO-WAIT"),
            BackgroundWaitPolicy::NoWait
        );
        assert_eq!(
            normalize_background_wait_policy("timeout"),
            BackgroundWaitPolicy::Timeout
        );
        assert_eq!(
            normalize_background_wait_policy("garbage"),
            BackgroundWaitPolicy::Wait
        );
    }

    #[test]
    fn timeout_clamps_1_to_3600() {
        assert_eq!(normalize_background_wait_timeout_sec(0), 1);
        assert_eq!(normalize_background_wait_timeout_sec(1), 1);
        assert_eq!(normalize_background_wait_timeout_sec(600), 600);
        assert_eq!(normalize_background_wait_timeout_sec(3600), 3600);
        assert_eq!(normalize_background_wait_timeout_sec(99999), 3600);
    }

    #[test]
    fn spawn_flags_for_each_policy() {
        assert!(background_wait_spawn_flags("wait", 600).is_empty());
        assert_eq!(
            background_wait_spawn_flags("no_wait", 600),
            vec!["--no-wait-for-background".to_string()]
        );
        assert_eq!(
            background_wait_spawn_flags("timeout", 90),
            vec!["--background-wait-timeout".to_string(), "90".to_string()]
        );
        assert_eq!(
            background_wait_spawn_flags("timeout", 0),
            vec!["--background-wait-timeout".to_string(), "1".to_string()]
        );
    }

    #[test]
    fn soft_gate_omits_on_old_or_unknown() {
        assert!(background_wait_spawn_flags_soft("no_wait", 600, Some("0.2.112")).is_empty());
        assert!(background_wait_spawn_flags_soft("timeout", 30, Some("grok 0.2.100")).is_empty());
        assert!(background_wait_spawn_flags_soft("no_wait", 600, None).is_empty());
        assert!(background_wait_spawn_flags_soft("no_wait", 600, Some("nope")).is_empty());
        assert!(background_wait_spawn_flags_soft("wait", 600, Some("0.2.112")).is_empty());
    }

    #[test]
    fn soft_gate_emits_on_new_cli() {
        assert_eq!(
            background_wait_spawn_flags_soft("no_wait", 600, Some("grok 0.2.117")),
            vec!["--no-wait-for-background".to_string()]
        );
        assert_eq!(
            background_wait_spawn_flags_soft("timeout", 45, Some("0.2.120")),
            vec!["--background-wait-timeout".to_string(), "45".to_string()]
        );
    }

    #[test]
    fn settings_equal_ignores_timeout_when_not_timeout_policy() {
        assert!(background_wait_settings_equal("wait", 1, "wait", 999));
        assert!(background_wait_settings_equal("no_wait", 1, "no_wait", 2));
        assert!(!background_wait_settings_equal("wait", 1, "no_wait", 1));
        assert!(background_wait_settings_equal("timeout", 60, "timeout", 60));
        assert!(!background_wait_settings_equal(
            "timeout", 60, "timeout", 120
        ));
    }

    #[test]
    fn cli_supports_background_wait_semver() {
        assert_eq!(cli_supports_background_wait("grok 0.2.117"), Some(true));
        assert_eq!(cli_supports_background_wait("0.2.116"), Some(false));
        assert_eq!(cli_supports_background_wait(""), None);
    }

    #[test]
    fn set_mode_stops_on_transport_errors_not_unknown_mode() {
        assert!(set_mode_abort_remaining_candidates(
            "rpc timeout on session/set_mode (id=5) after 45s"
        ));
        assert!(set_mode_abort_remaining_candidates(
            "rpc channel closed while waiting for session/set_mode (id=6)"
        ));
        assert!(set_mode_abort_remaining_candidates(
            "agent stdout closed before session/set_mode; process dead"
        ));
        assert!(!set_mode_abort_remaining_candidates(
            "Method not found (code -32601)"
        ));
        assert!(!set_mode_abort_remaining_candidates(
            "invalid params: unknown modeId"
        ));
    }
}

#[cfg(test)]
mod disallowed_tools_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(disallowed_tools_spawn_flags(&[]).is_empty());
        assert!(disallowed_tools_spawn_flags(&["".into(), "  ".into()]).is_empty());
    }

    #[test]
    fn builds_comma_separated_flag() {
        let args = disallowed_tools_spawn_flags(&[
            "  web_search  ".into(),
            "write".into(),
            "web_search".into(),
        ]);
        assert_eq!(
            args,
            vec![
                "--disallowed-tools".to_string(),
                "web_search,write".to_string(),
            ]
        );
    }

    #[test]
    fn splits_embedded_commas_and_dedupes_case_insensitively() {
        let cleaned = normalize_disallowed_tools(&[
            "Web_Search,write".into(),
            "WEB_SEARCH".into(),
            "Agent".into(),
        ]);
        assert_eq!(
            cleaned,
            vec![
                "Web_Search".to_string(),
                "write".to_string(),
                "Agent".to_string(),
            ]
        );
    }

    #[test]
    fn equality_is_order_and_case_insensitive() {
        assert!(disallowed_tools_equal(
            &["a".into(), "b".into()],
            &["B".into(), "A".into()]
        ));
        assert!(!disallowed_tools_equal(
            &["a".into()],
            &["a".into(), "b".into()]
        ));
    }
}

#[cfg(test)]
mod allowed_tools_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(allowed_tools_spawn_flags(&[]).is_empty());
        assert!(allowed_tools_spawn_flags(&["".into(), "  ".into()]).is_empty());
    }

    #[test]
    fn builds_comma_separated_flag() {
        let args = allowed_tools_spawn_flags(&[
            "  web_search  ".into(),
            "write".into(),
            "web_search".into(),
        ]);
        assert_eq!(
            args,
            vec!["--tools".to_string(), "web_search,write".to_string(),]
        );
    }

    #[test]
    fn splits_embedded_commas_and_dedupes_case_insensitively() {
        let cleaned = normalize_allowed_tools(&[
            "Web_Search,write".into(),
            "WEB_SEARCH".into(),
            "Agent".into(),
        ]);
        assert_eq!(
            cleaned,
            vec![
                "Web_Search".to_string(),
                "write".to_string(),
                "Agent".to_string(),
            ]
        );
    }

    #[test]
    fn equality_is_order_and_case_insensitive() {
        assert!(allowed_tools_equal(
            &["a".into(), "b".into()],
            &["B".into(), "A".into()]
        ));
        assert!(!allowed_tools_equal(
            &["a".into()],
            &["a".into(), "b".into()]
        ));
    }
}

#[cfg(test)]
mod fork_session_spawn_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn spawn_flags_toggle() {
        assert!(fork_session_spawn_flags(false).is_empty());
        assert_eq!(fork_session_spawn_flags(true), vec!["--fork-session"]);
    }

    #[test]
    fn parse_fork_id_standard_and_extension() {
        assert_eq!(
            parse_fork_session_id(&json!({ "sessionId": "child-1" }), "parent"),
            Some("child-1".into())
        );
        assert_eq!(
            parse_fork_session_id(&json!({ "newSessionId": "child-2" }), "parent"),
            Some("child-2".into())
        );
        // Reject empty / same-as-source (would not be a real fork).
        assert!(parse_fork_session_id(&json!({ "sessionId": "parent" }), "parent").is_none());
        assert!(parse_fork_session_id(&json!({ "sessionId": "  " }), "parent").is_none());
        assert!(parse_fork_session_id(&json!({}), "parent").is_none());
    }
}

#[cfg(test)]
mod grok_build_proxy_spawn_tests {
    use super::*;

    #[test]
    fn injects_native_proxy_env_only_on_target_command() {
        let native = crate::providers::GrokBuildProxySpawn {
            base_url: "https://relay.example/v1".into(),
            models_url: "https://relay.example/v1/models".into(),
            api_key: "runtime-only-key".into(),
            model: "grok-4.6".into(),
        };
        let mut cmd = tokio::process::Command::new("grok");
        apply_grok_build_proxy_env(&mut cmd, &native);
        let envs = cmd
            .as_std()
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_str()?, v?.to_str()?)))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            envs.get("GROK_MODELS_BASE_URL"),
            Some(&"https://relay.example/v1")
        );
        assert_eq!(
            envs.get("GROK_MODELS_LIST_URL"),
            Some(&"https://relay.example/v1/models")
        );
        assert_eq!(
            envs.get("GROK_CLI_CHAT_PROXY_BASE_URL"),
            Some(&"https://relay.example/v1")
        );
        assert_eq!(envs.get("XAI_API_KEY"), Some(&"runtime-only-key"));
    }
}

#[cfg(test)]
mod agent_profile_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(agent_profile_spawn_flags("").is_none());
        assert!(agent_profile_spawn_flags("  ").is_none());
        assert!(agent_profile_spawn_flags("a\nb").is_none());
    }

    #[test]
    fn builds_agent_option_pair() {
        assert_eq!(
            agent_profile_spawn_flags("  /tmp/agent.md  "),
            Some(vec![
                "--agent-profile".to_string(),
                "/tmp/agent.md".to_string()
            ])
        );
    }
}

#[cfg(test)]
mod agents_json_spawn_tests {
    use super::*;

    #[test]
    fn empty_or_invalid_omits_flag() {
        assert!(agents_json_spawn_flags("").is_none());
        assert!(agents_json_spawn_flags("  ").is_none());
        assert!(agents_json_spawn_flags("[]").is_none());
        assert!(agents_json_spawn_flags("{").is_none());
    }

    #[test]
    fn builds_top_level_pair() {
        assert_eq!(
            agents_json_spawn_flags(r#"  {"x":{"prompt":"hi"}}  "#),
            Some(vec![
                "--agents".to_string(),
                r#"{"x":{"prompt":"hi"}}"#.to_string()
            ])
        );
    }
}

#[cfg(test)]
mod reasoning_effort_spawn_tests {
    use super::*;

    #[test]
    fn accepts_official_and_custom_effort_ids() {
        assert!(is_spawnable_reasoning_effort("low"));
        assert!(is_spawnable_reasoning_effort("medium"));
        assert!(is_spawnable_reasoning_effort("high"));
        assert!(is_spawnable_reasoning_effort("max"));
        assert!(is_spawnable_reasoning_effort("xhigh"));
        assert!(is_spawnable_reasoning_effort("  max  "));
        assert!(is_spawnable_reasoning_effort("tier.2"));
        assert!(is_spawnable_reasoning_effort("effort_1"));
    }

    #[test]
    fn rejects_empty_or_non_token_ids() {
        assert!(!is_spawnable_reasoning_effort(""));
        assert!(!is_spawnable_reasoning_effort("   "));
        assert!(!is_spawnable_reasoning_effort("-high"));
        assert!(!is_spawnable_reasoning_effort("hi gh"));
        assert!(!is_spawnable_reasoning_effort("a".repeat(65).as_str()));
    }
}

#[cfg(test)]
mod permission_mode_spawn_tests {
    use super::*;

    #[test]
    fn maps_app_policies_to_cli_modes() {
        assert_eq!(cli_permission_mode("ask"), "default");
        assert_eq!(cli_permission_mode("accept_edits"), "acceptEdits");
        assert_eq!(cli_permission_mode("allow_for_session"), "default");
        assert_eq!(cli_permission_mode("auto"), "auto");
        assert_eq!(cli_permission_mode("dont_ask"), "dontAsk");
        assert_eq!(cli_permission_mode("always_approve"), "bypassPermissions");
        assert_eq!(cli_permission_mode("yolo"), "bypassPermissions");
    }

    #[test]
    fn resolve_yolo_beats_plan_and_policy() {
        assert_eq!(
            resolve_cli_permission_mode("always_approve", Some("plan")),
            "bypassPermissions"
        );
        assert_eq!(
            resolve_cli_permission_mode("accept_edits", Some("plan")),
            "plan"
        );
        assert_eq!(resolve_cli_permission_mode("ask", Some("agent")), "default");
        assert_eq!(resolve_cli_permission_mode("auto", Some("agent")), "auto");
    }

    #[test]
    fn spawn_flags_pin_permission_mode_and_yolo() {
        assert_eq!(
            permission_mode_spawn_flags("accept_edits", Some("agent")),
            ["--permission-mode".to_string(), "acceptEdits".to_string()]
        );
        assert_eq!(
            permission_mode_spawn_flags("ask", Some("plan")),
            ["--permission-mode".to_string(), "plan".to_string()]
        );
        assert!(should_pass_always_approve("always_approve", None));
        assert!(!should_pass_always_approve("auto", None));
        assert!(!should_pass_always_approve("ask", Some("plan")));
    }
}

#[cfg(test)]
mod plugin_dir_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(plugin_dir_spawn_flags(&[]).is_empty());
        assert!(plugin_dir_spawn_flags(&["".into(), "  ".into()]).is_empty());
    }

    #[test]
    fn builds_repeatable_plugin_dir_pairs() {
        let args =
            plugin_dir_spawn_flags(&["  /tmp/p1  ".into(), "/tmp/p2".into(), "/tmp/p1".into()]);
        assert_eq!(
            args,
            vec![
                "--plugin-dir".to_string(),
                "/tmp/p1".to_string(),
                "--plugin-dir".to_string(),
                "/tmp/p2".to_string(),
            ]
        );
    }
}

#[cfg(test)]
mod extra_rules_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(extra_rules_spawn_flags(None).is_empty());
        assert!(extra_rules_spawn_flags(Some("")).is_empty());
        assert!(extra_rules_spawn_flags(Some("   \n")).is_empty());
    }

    #[test]
    fn builds_top_level_rules_pair() {
        let args = extra_rules_spawn_flags(Some("  Always write tests  "));
        assert_eq!(
            args,
            vec!["--rules".to_string(), "Always write tests".to_string()]
        );
    }
}

#[cfg(test)]
mod system_prompt_override_spawn_tests {
    use super::*;

    #[test]
    fn empty_yields_no_flags() {
        assert!(system_prompt_override_spawn_flags(None).is_empty());
        assert!(system_prompt_override_spawn_flags(Some("")).is_empty());
        assert!(system_prompt_override_spawn_flags(Some("   \n")).is_empty());
        assert!(system_prompt_override_spawn_flags(Some("\0\0")).is_empty());
    }

    #[test]
    fn builds_top_level_override_pair() {
        let args = system_prompt_override_spawn_flags(Some("  You are helpful  "));
        assert_eq!(
            args,
            vec![
                "--system-prompt-override".to_string(),
                "You are helpful".to_string()
            ]
        );
    }

    #[test]
    fn strips_nul_before_spawn() {
        let args = system_prompt_override_spawn_flags(Some("a\0b\0c"));
        assert_eq!(
            args,
            vec!["--system-prompt-override".to_string(), "abc".to_string()]
        );
    }
}

#[cfg(test)]
mod max_turns_spawn_tests {
    use super::*;

    #[test]
    fn normalize_clamps_and_clears_zero() {
        assert_eq!(normalize_max_agent_turns(None), None);
        assert_eq!(normalize_max_agent_turns(Some(0)), None);
        assert_eq!(normalize_max_agent_turns(Some(1)), Some(1));
        assert_eq!(normalize_max_agent_turns(Some(50)), Some(50));
        assert_eq!(normalize_max_agent_turns(Some(200)), Some(200));
        assert_eq!(normalize_max_agent_turns(Some(999)), Some(200));
    }

    #[test]
    fn resolve_prefers_session_over_global() {
        assert_eq!(resolve_max_agent_turns(Some(40), Some(10)), Some(40));
        assert_eq!(resolve_max_agent_turns(None, Some(10)), Some(10));
        assert_eq!(resolve_max_agent_turns(Some(0), Some(10)), Some(10));
        assert_eq!(resolve_max_agent_turns(None, None), None);
        assert_eq!(resolve_max_agent_turns(Some(0), Some(0)), None);
        assert_eq!(resolve_max_agent_turns(Some(999), Some(10)), Some(200));
    }

    #[test]
    fn cli_args_pair() {
        assert_eq!(
            max_turns_cli_args(Some(25)),
            Some(vec!["--max-turns".into(), "25".into()])
        );
        assert!(max_turns_cli_args(None).is_none());
        assert!(max_turns_cli_args(Some(0)).is_none());
    }
}

#[cfg(test)]
mod no_ask_user_spawn_tests {
    use super::*;

    #[test]
    fn flags_only_when_enabled() {
        assert!(no_ask_user_spawn_flags(false).is_empty());
        assert_eq!(no_ask_user_spawn_flags(true), vec!["--no-ask-user"]);
    }

    #[test]
    fn session_override_wins_over_global() {
        assert!(!resolve_no_ask_user(None, false));
        assert!(resolve_no_ask_user(None, true));
        assert!(resolve_no_ask_user(Some(true), false));
        assert!(!resolve_no_ask_user(Some(false), true));
    }
}

#[cfg(test)]
mod include_partial_messages_tests {
    use super::*;

    #[test]
    fn format_gate() {
        assert!(is_streaming_messages_json_format("streaming-messages-json"));
        assert!(is_streaming_messages_json_format("STREAMING_MESSAGES_JSON"));
        assert!(!is_streaming_messages_json_format("streaming-json"));
        assert!(!is_streaming_messages_json_format("json"));
        assert!(!is_streaming_messages_json_format("plain"));
    }

    #[test]
    fn spawn_flags_only_when_enabled_and_messages_format() {
        assert_eq!(
            include_partial_messages_spawn_flags(true, "streaming-messages-json"),
            vec!["--include-partial-messages"]
        );
        assert!(include_partial_messages_spawn_flags(false, "streaming-messages-json").is_empty());
        assert!(include_partial_messages_spawn_flags(true, "streaming-json").is_empty());
        assert!(include_partial_messages_spawn_flags(true, "json").is_empty());
    }

    #[test]
    fn soft_fail_older_and_unknown_cli() {
        assert!(include_partial_messages_spawn_flags_soft(
            true,
            "streaming-messages-json",
            Some("0.2.112")
        )
        .is_empty());
        assert!(
            include_partial_messages_spawn_flags_soft(true, "streaming-messages-json", None)
                .is_empty()
        );
        assert!(include_partial_messages_spawn_flags_soft(
            true,
            "streaming-messages-json",
            Some("nope")
        )
        .is_empty());
        assert_eq!(
            include_partial_messages_spawn_flags_soft(
                true,
                "streaming-messages-json",
                Some("grok 0.2.117")
            ),
            vec!["--include-partial-messages"]
        );
    }

    #[test]
    fn resolve_upgrades_format_when_partial_on() {
        let (fmt, flags) = resolve_headless_stream_for_partial(true, Some("0.2.117"));
        assert_eq!(fmt, HEADLESS_FORMAT_STREAMING_MESSAGES_JSON);
        assert_eq!(flags, vec!["--include-partial-messages"]);

        let (fmt2, flags2) = resolve_headless_stream_for_partial(true, Some("0.2.100"));
        assert_eq!(fmt2, HEADLESS_FORMAT_STREAMING_JSON);
        assert!(flags2.is_empty());

        let (fmt3, flags3) = resolve_headless_stream_for_partial(false, Some("0.2.117"));
        assert_eq!(fmt3, HEADLESS_FORMAT_STREAMING_JSON);
        assert!(flags3.is_empty());
    }

    #[test]
    fn cli_supports_semver() {
        assert_eq!(
            cli_supports_include_partial_messages("grok 0.2.117"),
            Some(true)
        );
        assert_eq!(
            cli_supports_include_partial_messages("0.2.116"),
            Some(false)
        );
        assert_eq!(cli_supports_include_partial_messages(""), None);
    }
}

#[cfg(test)]
mod sandbox_spawn_tests {
    use super::*;

    #[test]
    fn off_and_empty_yield_no_flags() {
        assert!(SandboxSpawnSpec::from_setting("off").is_none());
        assert!(SandboxSpawnSpec::from_setting("OFF").is_none());
        assert!(SandboxSpawnSpec::from_setting("").is_none());
        assert!(SandboxSpawnSpec::from_setting("   ").is_none());
        assert!(sandbox_spawn_flags("off").is_none());
    }

    #[test]
    fn known_profiles_build_top_level_args_and_env() {
        for profile in ["workspace", "read-only", "strict", "devbox"] {
            let spec = SandboxSpawnSpec::from_setting(profile).expect(profile);
            assert_eq!(spec.profile, profile);
            assert_eq!(
                spec.cli_args(),
                ["--sandbox".to_string(), profile.to_string()]
            );
            assert_eq!(
                spec.env_pair(),
                ("GROK_SANDBOX".to_string(), profile.to_string())
            );
            let (args, env) = sandbox_spawn_flags(profile).unwrap();
            assert_eq!(args, vec!["--sandbox".to_string(), profile.to_string()]);
            assert_eq!(env, ("GROK_SANDBOX".to_string(), profile.to_string()));
        }
    }

    #[test]
    fn trims_and_lowercases_profile() {
        let spec = SandboxSpawnSpec::from_setting("  WorkSpace  ").unwrap();
        assert_eq!(spec.profile, "workspace");
        assert_eq!(
            spec.cli_args(),
            ["--sandbox".to_string(), "workspace".to_string()]
        );
    }

    #[test]
    fn cli_supports_sandbox_semver() {
        assert_eq!(cli_supports_sandbox("grok 0.2.112"), Some(true));
        assert_eq!(cli_supports_sandbox("0.2.117"), Some(true));
        assert_eq!(cli_supports_sandbox("0.2.111"), Some(false));
        assert_eq!(cli_supports_sandbox("0.2.100"), Some(false));
        assert_eq!(cli_supports_sandbox(""), None);
        assert_eq!(cli_supports_sandbox("nope"), None);
    }

    #[test]
    fn sandbox_spawn_flags_soft_omits_on_old_cli() {
        assert!(sandbox_spawn_flags_soft("workspace", Some("0.2.100")).is_none());
        assert!(sandbox_spawn_flags_soft("strict", Some("grok 0.2.111")).is_none());
        let (args, env) =
            sandbox_spawn_flags_soft("workspace", Some("0.2.112")).expect("supported");
        assert_eq!(args, vec!["--sandbox".to_string(), "workspace".to_string()]);
        assert_eq!(env, ("GROK_SANDBOX".to_string(), "workspace".to_string()));
        // Unknown version still applies (forward-compat).
        assert!(sandbox_spawn_flags_soft("workspace", None).is_some());
        assert!(sandbox_spawn_flags_soft("workspace", Some("dev")).is_some());
        // off always none
        assert!(sandbox_spawn_flags_soft("off", Some("0.2.117")).is_none());
    }
}

#[cfg(test)]
mod compaction_spawn_tests {
    use super::*;

    #[test]
    fn normalize_mode_and_detail() {
        assert_eq!(normalize_compaction_mode("summary"), "summary");
        assert_eq!(normalize_compaction_mode(" Transcript "), "transcript");
        assert_eq!(normalize_compaction_mode("SEGMENTS"), "segments");
        assert_eq!(normalize_compaction_mode(""), "summary");
        assert_eq!(normalize_compaction_mode("heavy"), "summary");
        assert_eq!(normalize_compaction_detail("none"), "none");
        assert_eq!(normalize_compaction_detail(" Minimal "), "minimal");
        assert_eq!(normalize_compaction_detail("BALANCED"), "balanced");
        assert_eq!(normalize_compaction_detail("verbose"), "verbose");
        assert_eq!(normalize_compaction_detail(""), "verbose");
        assert_eq!(normalize_compaction_detail("max"), "verbose");
    }

    #[test]
    fn detail_only_for_segments() {
        assert!(compaction_detail_applies("segments"));
        assert!(!compaction_detail_applies("summary"));
        assert!(!compaction_detail_applies("transcript"));
    }

    #[test]
    fn spawn_args_mode_and_optional_detail() {
        assert_eq!(
            compaction_spawn_args("transcript", "none"),
            vec!["--compaction-mode".to_string(), "transcript".to_string()]
        );
        assert_eq!(
            compaction_spawn_args("segments", "minimal"),
            vec![
                "--compaction-mode".to_string(),
                "segments".to_string(),
                "--compaction-detail".to_string(),
                "minimal".to_string(),
            ]
        );
        assert_eq!(
            compaction_spawn_args("bogus", "bogus"),
            vec!["--compaction-mode".to_string(), "summary".to_string()]
        );
    }

    #[test]
    fn spawn_env_detail_only_for_segments() {
        assert_eq!(
            compaction_spawn_env("summary", "minimal"),
            vec![("GROK_COMPACTION_MODE".into(), "summary".into())]
        );
        assert_eq!(
            compaction_spawn_env("segments", "none"),
            vec![
                ("GROK_COMPACTION_MODE".into(), "segments".into()),
                ("GROK_COMPACTION_DETAIL".into(), "none".into()),
            ]
        );
    }

    #[test]
    fn flags_gated_at_0_2_117() {
        assert!(cli_supports_compaction_flags(Some("grok 0.2.117")));
        assert!(cli_supports_compaction_flags(Some("grok 0.2.200")));
        assert!(cli_supports_compaction_flags(Some("0.3.0")));
        assert!(!cli_supports_compaction_flags(Some("grok 0.2.116")));
        assert!(!cli_supports_compaction_flags(Some("grok 0.2.112")));
        assert!(!cli_supports_compaction_flags(None));
        assert!(!cli_supports_compaction_flags(Some("")));
        assert!(!cli_supports_compaction_flags(Some("unknown")));
    }
}

fn json_id_u64(v: Option<&Value>) -> Option<u64> {
    let v = v?;
    if let Some(u) = v.as_u64() {
        return Some(u);
    }
    if let Some(i) = v.as_i64() {
        if i >= 0 {
            return Some(i as u64);
        }
    }
    if let Some(s) = v.as_str() {
        return s.parse().ok();
    }
    None
}

#[cfg(test)]
mod cached_token_route_tests {
    use super::*;

    #[test]
    fn rewind_unsupported_error_matches_method_not_found() {
        // journal drop-last routes on this predicate: a mismatch would send
        // the early-return error into the last-turn fallback retry path.
        assert!(rpc_looks_like_method_not_found(
            "rewind method not supported (not advertised by agent initialize)"
        ));
    }

    #[test]
    fn custom_route_must_not_authenticate_cached_token() {
        // Official login leaves ~/.grok/auth.json for billing / official-aux.
        // cached_token reads that file even when GROK_HOME is agent-home.
        // Loading OIDC into a custom-relay process makes Grok Build send OIDC
        // to the relay (HTTP 400/401) — "works until I sign in".
        assert!(!should_authenticate_cached_token(true, true));
        assert!(!should_authenticate_cached_token(true, false));
    }

    #[test]
    fn official_route_authenticates_only_when_cached_token_exists() {
        // Signed-in official: still send authenticate (and keep the #528
        // re-sync + one retry on soft-fail).
        assert!(should_authenticate_cached_token(false, true));
        // Unsigned-in (no auth.json / no usable token): skip entirely.
        // Sending authenticate here is a 12s × 2 timeout then soft-fail.
        assert!(!should_authenticate_cached_token(false, false));
    }
}

#[cfg(test)]
mod live_handshake_tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn live_initialize_session_new_under_30s() {
        if std::env::var("GROK_APP_LIVE_ACP").ok().as_deref() != Some("1") {
            eprintln!("skip live ACP (set GROK_APP_LIVE_ACP=1)");
            return;
        }
        let cli = which::which("grok")
            .or_else(|_| {
                let p = crate::process_util::user_home().join(".grok/bin/grok");
                if p.exists() {
                    Ok(p)
                } else {
                    let p2 = crate::process_util::user_home().join(r".grok\bin\grok.exe");
                    if p2.exists() {
                        Ok(p2)
                    } else {
                        Err(which::Error::CannotFindBinaryPath)
                    }
                }
            })
            .expect("grok cli");
        let cwd = std::env::current_dir().unwrap();
        let t0 = std::time::Instant::now();
        let (client, mut events) = AcpClient::spawn(cli, cwd).await.expect("spawn");
        // drain events in bg
        tokio::spawn(async move {
            while let Some((_sid, ev)) = events.recv().await {
                eprintln!("ev: {:?}", std::mem::discriminant(&ev));
            }
        });
        let sid =
            tokio::time::timeout(Duration::from_secs(45), client.initialize_and_new_session())
                .await
                .expect("overall timeout")
                .expect("handshake");
        eprintln!("OK session={} in {:?}", sid, t0.elapsed());
        client.kill().await;
        assert!(!sid.is_empty());
    }
}
