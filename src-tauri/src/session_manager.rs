//! Host session manager: real ACP default; mock only if GROK_APP_ACP=mock.
//!
//! Process policy (I01–I03) — multi-session, no monopoly:
//! - One ACP process per App session (live / background-busy / parked-ready).
//! - Switching chats **never** cancels a busy turn: Streaming / AwaitingPermission
//!   / open tools / deferred prompt_complete demote to `background` (event pump
//!   kept). Only true idle Ready parks warm.
//! - Processes are **not** stolen across App sessions (no same-cwd rebind).
//! - Cap: `maxConcurrentAgents` (default 8, cap 32). Over cap → reclaim idle
//!   parked first; `PROCESS_LIMIT` only when busy slots are full. **Never** kill
//!   background-busy or open-tool turns for capacity.
//! - Idle recycle after `agentIdleMinutes` (default 30); session meta stays.
//! - soft_respawn skips mid-turn live sessions.
//!
//! Streaming performance (I04 / I06):
//! - Mid-stream journal upserts are throttled (≥500ms or paragraph / force).
//! - Pure stream silence: silent heal (orphan tools / ready-eligible end) first,
//!   then at most one soft `session://stream_stall` per turn; hard silence
//!   force-ends the turn while keeping the journal.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{
    should_abort_provider_retry, AcpClient, AcpEvent, AskUserOutcome, PermissionOutcome,
    StreamKind, HOST_PROVIDER_MAX_RETRIES,
};
use crate::cli_probe;
use crate::error::{AgentError, AgentErrorCode};
use crate::journal_throttle::{is_paragraph_break, JournalWriteThrottle};
use crate::stream_emit::{
    should_flush_stream_emit, stream_emit_can_merge, DEFAULT_STREAM_EMIT_MAX_CHARS,
    DEFAULT_STREAM_EMIT_MS,
};
use crate::tool_heartbeat::should_emit_tool_heartbeat;
use crate::mock_acp::{self, MockConnectMode, MockStreamHandle, StreamChunk};
use crate::permission::{
    extract_path_target, extract_shell_command, may_auto_allow, may_auto_deny, pick_option_id,
    scope_key, PermissionPolicy, SessionAllowCache,
};
use crate::process_limits::{
    can_spawn_process, is_idle_expired, normalize_idle_minutes, normalize_max_concurrent,
    parked_slots_to_free_for_spawn, process_limit_message,
};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored, MessageAttachmentStored, SessionMeta};
use crate::stream_stall::{
    hard_stall_seconds, is_hard_stalled, is_stream_stalled, journal_tool_is_terminal,
    normalize_stream_stall_seconds, should_emit_soft_stall, should_prune_open_tool_id,
    stall_tier_from_evidence, stream_stall_message, StallTier,
};
use crate::turn_complete::{is_terminal_tool_status, should_defer_prompt_complete};

/// Outcome of one stall-watchdog pass on a single live/background session.
enum StallTickAction {
    Healed {
        session_id: String,
    },
    HardEnded {
        session_id: String,
        stall_seconds: u32,
    },
    SoftStall {
        session_id: String,
        stall_seconds: u32,
        tier: StallTier,
        saw_model_output: bool,
        saw_tool_activity: bool,
    },
}

/// Strip bulky MCP/RPC dumps so chat errors stay human-readable.
/// Full stderr is still logged via `tracing` on the ACP client side.
fn sanitize_error_detail(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return s;
    }
    // Drop `; stderr: …` / `stderr: …` tails from format_exit_detail legacy messages.
    if let Some(idx) = s.find("; stderr:") {
        s.truncate(idx);
    } else if let Some(idx) = s.find("stderr:") {
        s.truncate(idx);
    }
    // Strip ANSI SGR if any leaked through.
    let mut cleaned = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() && !bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
            continue;
        }
        cleaned.push(bytes[i] as char);
        i += 1;
    }
    let s = cleaned.trim().to_string();
    // Compact known host timeouts to a short stable tag (UI maps via code + this).
    let lower = s.to_lowercase();
    if lower.contains("rpc timeout") && lower.contains("session/prompt") {
        return "turn_timeout".into();
    }
    if lower.contains("rpc channel closed") {
        return "agent_disconnected".into();
    }
    // Cap leftover technical lines.
    if s.len() > 160 {
        let mut end = 160;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        return format!("{}…", &s[..end]);
    }
    s
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub state: SessionState,
    pub last_error: Option<AgentError>,
    pub streaming_message_id: Option<String>,
    pub backend: String,
    pub model_id: Option<String>,
    pub project_path: Option<String>,
    pub title: String,
}

/// One user-prompt checkpoint for the rewind timeline UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindPointDto {
    pub prompt_index: u32,
    pub message_id: Option<String>,
    pub preview: String,
}

/// Result of `session_rewind_execute` — local journal is source of truth for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindExecuteResult {
    pub snapshot: SessionSnapshot,
    /// False when agent rewind extension failed / unsupported / disconnected.
    pub agent_ok: bool,
    pub agent_error: Option<String>,
    pub local_ok: bool,
    pub kept_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPermissionRequest {
    pub rpc_id: u64,
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub title: String,
    pub preview: String,
    pub scope_key: String,
    pub options: serde_json::Value,
}

/// Identity for routing ACP event pumps when multiple processes are warm.
type ProcessId = String;

/// Buffered `session://stream` payload awaiting coalesce flush.
struct PendingStreamEmit {
    kind: StreamKind,
    message_id: String,
    text: String,
    thought_phase: String,
    done: bool,
    first_at: Instant,
}

struct LiveSession {
    app_session_id: String,
    /// Stable id for the agent process / event pump (not the App session id).
    process_id: ProcessId,
    meta: SessionMeta,
    fsm: SessionFsm,
    backend: String,
    acp: Option<Arc<AcpClient>>,
    mock_stream: Option<MockStreamHandle>,
    streaming_message_id: Option<String>,
    /// Stable identity for one user-prompt turn. Survives assistant row splits
    /// (e.g. mid-turn interjection / Steer).
    active_turn_id: Option<String>,
    /// Keep the host-created assistant id after an interjection splits the turn.
    /// The agent may continue emitting its original messageId, which must not
    /// merge post-interjection output back into the frozen pre-interjection row.
    stream_message_id_locked: bool,
    /// Accumulated assistant text for current turn (persisted on complete).
    stream_buf: String,
    stream_thought: String,
    /// Last emitted chunk was assistant body — next thought opens a new phase
    /// so thinking and body can interleave (think → write → think → write).
    stream_last_was_assistant: bool,
    /// Image/file paths produced this turn (image_gen / image_edit).
    stream_attachments: Vec<MessageAttachmentStored>,
    model_id: Option<String>,
    /// Effort applied to the live agent process (from last spawn).
    effort: Option<String>,
    /// Product mode: agent | plan | ask (ACP session/set_mode).
    product_mode: Option<String>,
    project_path: Option<String>,
    allow_cache: SessionAllowCache,
    policy: PermissionPolicy,
    /// Last provider retry attempt observed this turn (0 = none).
    provider_retry_attempt: u32,
    /// Host already aborted this turn after max retries (avoid double cancel).
    provider_retry_aborted: bool,
    /// After session/new (load failed), first prompt should carry journal history.
    needs_history_bootstrap: bool,
    /// Pending `_x.ai/exit_plan_mode` JSON-RPC id awaiting user Approve / revise.
    pending_plan_rpc_id: Option<u64>,
    /// Pending `_x.ai/ask_user_question` JSON-RPC id awaiting user answers.
    pending_ask_user_rpc_id: Option<u64>,
    /// Last user/agent activity (send, stream, permission, connect).
    last_activity: Instant,
    /// Last stream chunk or tool event (I06 stall watchdog). Permission waits do not update this.
    last_stream_progress: Instant,
    /// Last time we emitted `session://stream_stall` for the current silence window.
    last_stall_emit: Option<Instant>,
    /// Soft stall banners already shown this turn (capped; prefer silent heal).
    stall_soft_emits: u32,
    /// Throttle mid-stream assistant journal upserts (I04).
    journal_throttle: JournalWriteThrottle,
    /// Tool calls still pending/in_progress this turn (#52 early prompt_complete).
    open_tool_ids: HashSet<String>,
    /// Last tool event time per open id (orphan leak recovery).
    open_tool_seen_at: HashMap<String, Instant>,
    /// `prompt_complete` arrived while tools/gates still open; finish when clear.
    deferred_prompt_complete: Option<String>,
    /// Tool events observed during the current turn (empty-run soft signal).
    tools_this_turn: u32,
    /// Non-empty assistant body observed this turn (sticky until turn ends).
    saw_model_output: bool,
    /// A `session/prompt` RPC is dispatched and has not resolved yet.
    ///
    /// Authoritative "this chat is working" flag — the FSM is not, because the
    /// agent may fire `prompt_complete` early (which Readies the FSM) and then
    /// keep streaming. While this is set the session can never be parked or
    /// idle-recycled, and its stream chunks are always applied.
    prompt_in_flight: bool,
    /// Coalesced stream IPC buffer (host backpressure).
    pending_stream_emit: Option<PendingStreamEmit>,
    /// Bumped when a delayed flush is scheduled; stale tasks no-op.
    stream_emit_flush_gen: u64,
    /// Last `session://tool_heartbeat` emit (long open tools).
    last_tool_heartbeat_emit: Option<Instant>,
}

/// Ready agent process parked while another App session is focused (I01/I02).
struct ParkedAgent {
    process_id: ProcessId,
    app_session_id: String,
    meta: SessionMeta,
    acp: Arc<AcpClient>,
    last_activity: Instant,
    model_id: Option<String>,
    effort: Option<String>,
    product_mode: Option<String>,
    project_path: Option<String>,
    policy: PermissionPolicy,
    needs_history_bootstrap: bool,
    backend: String,
}

/// How many journal messages (user+assistant) to carry when session/load fails.
const HISTORY_BOOTSTRAP_MAX_MSGS: usize = 16;
/// Cap each message body in the bootstrap block.
const HISTORY_BOOTSTRAP_PER_MSG_CHARS: usize = 2_000;
/// Cap total bootstrap text (excluding the new user turn).
const HISTORY_BOOTSTRAP_MAX_CHARS: usize = 14_000;

/// Build a continuity preamble from App journal when agent session is new.
/// Keeps recent turns so the model still "remembers" the chat after respawn.
fn build_history_bootstrap(app_session_id: &str) -> Option<String> {
    let msgs = store::load_messages(app_session_id);
    // Take last N non-empty user/assistant turns (errors abbreviated).
    let mut picked: Vec<&store::ChatMessageStored> = Vec::new();
    for m in msgs.iter().rev() {
        if m.role != "user" && m.role != "assistant" {
            continue;
        }
        if m.content.trim().is_empty() {
            continue;
        }
        picked.push(m);
        if picked.len() >= HISTORY_BOOTSTRAP_MAX_MSGS {
            break;
        }
    }
    if picked.is_empty() {
        return None;
    }
    picked.reverse();

    let mut body = String::from(
        "[Prior conversation context — this chat continues an existing Grok App session. \
The agent process was restarted; use the following transcript for continuity ONLY. \
Rules: do NOT re-greet; do NOT restate, quote, or re-answer prior assistant turns; \
do NOT reprint the transcript in your reply; answer ONLY the new user message below.]\n\n",
    );
    let header_len = body.len();

    for m in picked {
        let role = if m.role == "user" {
            "User"
        } else if m.is_error {
            "Assistant (error)"
        } else {
            "Assistant"
        };
        let mut content = m.content.trim().to_string();
        // Soft-trim huge tool dumps / tables for bootstrap.
        if content.len() > HISTORY_BOOTSTRAP_PER_MSG_CHARS {
            let keep = HISTORY_BOOTSTRAP_PER_MSG_CHARS.saturating_sub(40);
            content = format!(
                "{}…\n[truncated {} chars]",
                content.chars().take(keep).collect::<String>(),
                m.content.len()
            );
        }
        let block = format!("### {role}\n{content}\n\n");
        if body.len() - header_len + block.len() > HISTORY_BOOTSTRAP_MAX_CHARS {
            body.push_str("### …\n[earlier turns omitted for length]\n\n");
            break;
        }
        body.push_str(&block);
    }
    body.push_str("---\n\n[End of prior context. Continue with the user's new message below.]\n");
    Some(body)
}

/// Cap content snippets emitted on live tool events (diff panel).
const TOOL_CONTENT_SNIPPET_MAX: usize = 200_000;

/// Extract human-visible path + detail from tool_call payload for activity UI.
fn extract_tool_ui_fields(raw: &serde_json::Value) -> (Option<String>, Option<String>) {
    let path = raw
        .pointer("/locations/0/path")
        .or_else(|| raw.pointer("/rawInput/path"))
        .or_else(|| raw.pointer("/rawInput/file_path"))
        .or_else(|| raw.pointer("/rawInput/filePath"))
        .or_else(|| raw.pointer("/rawInput/target_file"))
        .or_else(|| raw.pointer("/rawInput/targetFile"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let command = raw
        .pointer("/rawInput/command")
        .or_else(|| raw.pointer("/rawInput/cmd"))
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(240).collect::<String>());
    let detail = command.or_else(|| {
        raw.pointer("/rawInput/query")
            .or_else(|| raw.pointer("/rawInput/pattern"))
            .or_else(|| raw.pointer("/rawInput/description"))
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(240).collect::<String>())
    });
    (detail, path)
}

fn take_tool_content_str(v: Option<&serde_json::Value>) -> Option<String> {
    let s = v.and_then(|x| x.as_str())?;
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(TOOL_CONTENT_SNIPPET_MAX).collect())
}

/// Optional before/after text for the session diff panel (from rawInput when present).
/// - str_replace / search_replace: old_string → before, new_string → after
/// - write / create_file: contents → after
fn extract_tool_content_snippets(
    raw: &serde_json::Value,
) -> (Option<String>, Option<String>) {
    let before = take_tool_content_str(
        raw.pointer("/rawInput/old_string")
            .or_else(|| raw.pointer("/rawInput/oldString"))
            .or_else(|| raw.pointer("/rawInput/old_str"))
            .or_else(|| raw.pointer("/rawInput/previous"))
            .or_else(|| raw.pointer("/rawInput/before")),
    );
    let after = take_tool_content_str(
        raw.pointer("/rawInput/new_string")
            .or_else(|| raw.pointer("/rawInput/newString"))
            .or_else(|| raw.pointer("/rawInput/new_str"))
            .or_else(|| raw.pointer("/rawInput/contents"))
            .or_else(|| raw.pointer("/rawInput/content"))
            .or_else(|| raw.pointer("/rawInput/new_contents"))
            .or_else(|| raw.pointer("/rawInput/after")),
    );
    (before, after)
}

/// When user asks to open a Grok App / foreign agent session by UUID, steer tools.
fn session_lookup_host_hint(user_text: &str) -> Option<String> {
    let t = user_text.trim();
    // UUID v4-ish
    let uuid_re = regex_is_session_uuid(t);
    if !uuid_re {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    let asks = lower.contains("会话")
        || lower.contains("session")
        || lower.contains("上下文")
        || lower.contains("继续")
        || lower.contains("resume")
        || lower.contains("复述")
        || lower.contains("历史");
    if !asks {
        return None;
    }
    Some(
        "[Host hint — session lookup]\n\
This looks like a request to read a **Grok App / agent session** by UUID.\n\
Do **not** scan the whole home directory or assume Claude/Codex/Cursor storage first.\n\
Prefer, in order:\n\
1. Grok App journal: `~/Library/Application Support/com.grokapp.grok-app/sessions/<id>/messages.json` \
(and `sessions_index.json` for meta).\n\
2. Grok agent-home: `…/com.grokapp.grok-app/agent-home/sessions/<encoded-cwd>/<agentSessionId>/` \
(chat_history.jsonl, updates.jsonl) — map app session id via sessions_index.agentSessionId.\n\
3. Only if missing there, try Claude/Codex/Cursor resume paths with a **narrow** query.\n\
Avoid unbounded `find ~` / multi-GB scans; use index files and known roots.\n\
[/Host hint]\n"
            .to_string(),
    )
}

fn regex_is_session_uuid(text: &str) -> bool {
    // Match standard UUID anywhere in the message.
    let bytes = text.as_bytes();
    // Simple scan for 8-4-4-4-12 hex pattern
    let s = text;
    let mut i = 0;
    let chars: Vec<char> = s.chars().collect();
    while i + 36 <= chars.len() {
        let slice: String = chars[i..i + 36].iter().collect();
        if is_uuid_str(&slice) {
            return true;
        }
        i += 1;
    }
    let _ = bytes;
    false
}

fn is_uuid_str(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    let hex = |c: u8| c.is_ascii_hexdigit();
    for (i, &c) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if c != b'-' {
                    return false;
                }
            }
            _ => {
                if !hex(c) {
                    return false;
                }
            }
        }
    }
    true
}

/// Pull absolute media path from ACP tool_call / tool_call_update payload
/// (image_gen, image_edit, image_to_video, reference_to_video, …).
fn extract_generated_media_path(raw: &serde_json::Value) -> Option<String> {
    // ImageGen / ImageEdit / video tools rawOutput
    if let Some(path) = raw
        .pointer("/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(path.to_string());
    }
    // Nested under toolCall (some hosts wrap)
    if let Some(path) = raw
        .pointer("/toolCall/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(path.to_string());
    }
    // content[].content.text is often a JSON string with {"path":"..."}
    if let Some(arr) = raw.get("content").and_then(|v| v.as_array()) {
        for item in arr {
            let text = item
                .pointer("/content/text")
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str());
            if let Some(t) = text {
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(t) {
                    if let Some(path) = j.get("path").and_then(|v| v.as_str()) {
                        if !path.is_empty() {
                            return Some(path.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn is_image_fs_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".avif",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn is_video_fs_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".ogv", ".mpeg", ".mpg",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn is_media_fs_path(path: &str) -> bool {
    is_image_fs_path(path) || is_video_fs_path(path)
}

fn attachment_from_path(path: &str) -> MessageAttachmentStored {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    MessageAttachmentStored {
        path: path.to_string(),
        name,
        is_dir: false,
    }
}

pub struct SessionManager {
    /// Currently focused live session (UI-bound for send).
    inner: Mutex<Option<LiveSession>>,
    /// Busy sessions still receiving ACP events (streaming / permission).
    /// Keyed by app session id. Enables multi-session parallel streaming.
    background: Mutex<HashMap<String, LiveSession>>,
    /// Warm Ready agents for other App sessions (keyed by app session id).
    parked: Mutex<HashMap<String, ParkedAgent>>,
    /// Serialize connect / park / unpark so openSession prefetch cannot race first send.
    connect_lock: tokio::sync::Mutex<()>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            background: Mutex::new(HashMap::new()),
            parked: Mutex::new(HashMap::new()),
            connect_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// True when any live or background session is mid-turn (streaming / tools / connect).
    /// Used by the host automation scheduler to avoid stealing agent slots.
    pub fn any_turn_busy(&self) -> bool {
        {
            let guard = self.inner.lock();
            if let Some(s) = guard.as_ref() {
                if s.prompt_in_flight
                    || matches!(
                        s.fsm.state(),
                        SessionState::Streaming
                            | SessionState::AwaitingPermission
                            | SessionState::Connecting
                    )
                    || !s.open_tool_ids.is_empty()
                {
                    return true;
                }
            }
        }
        let bg = self.background.lock();
        for s in bg.values() {
            if s.prompt_in_flight
                || matches!(
                    s.fsm.state(),
                    SessionState::Streaming
                        | SessionState::AwaitingPermission
                        | SessionState::Connecting
                )
                || !s.open_tool_ids.is_empty()
            {
                return true;
            }
        }
        false
    }

    /// Background idle recycle loop (I03). Safe to call once from app setup.
    pub fn start_idle_watchdog(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                mgr.tick_idle_recycle(&app).await;
            }
        });
    }

    /// Background stream stall detector (I06). Safe to call once from app setup.
    /// Also drives long-tool heartbeats on the same 5s tick.
    pub fn start_stream_stall_watchdog(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                mgr.tick_tool_heartbeats(&app);
                mgr.tick_stream_stall(&app);
            }
        });
    }

    fn touch_activity_locked(s: &mut LiveSession) {
        s.last_activity = Instant::now();
    }

    /// Stream chunk or tool activity — advances stall deadline (I06).

    /// `session/load` (and similar resume paths) replay history while no prompt
    /// RPC is in flight. UI history must come only from the App journal — any
    /// turn side-effect event (`tool_call`, plan, stream, …) must be dropped.
    ///
    /// Gate on `prompt_in_flight` (not the FSM): early `prompt_complete` Readies
    /// the FSM while the agent may still stream live output.
    #[inline]
    fn is_session_load_replay(prompt_in_flight: bool) -> bool {
        !prompt_in_flight
    }

    /// Soft signal when a non-ask turn ends with **no user-visible answer** and
    /// zero tool events (diagnostic aid for #52).
    ///
    /// Successful pure-text replies (assistant body present, no tools) must
    /// **not** toast — that was false-positive spam on every chatty turn (#128).
    /// Call **before** stream buffers are cleared.
    ///
    /// Also suppress when the journal already has an assistant body after the
    /// last user turn (Host buffers can disagree with agent output after
    /// replay gating / early finish races).
    fn empty_run_signal_from_live(
        s: &LiveSession,
        stop_reason: &str,
    ) -> Option<(String, String, String)> {
        let had_body = !s.stream_buf.trim().is_empty() || s.saw_model_output;
        let tools = s.tools_this_turn;
        let mode = s.product_mode.clone().unwrap_or_else(|| "agent".into());
        let app_sid = s.app_session_id.clone();
        // Zero tools + no body: agent "finished" without a reply the user can read
        // (thought-only / blank). Body without tools is a normal Q&A turn.
        let empty = tools == 0
            && !had_body
            && mode != "ask"
            && !s.provider_retry_aborted
            && stop_reason != "cancelled"
            && stop_reason != "stop";
        if empty {
            if Self::journal_has_assistant_after_last_user(&app_sid) {
                tracing::debug!(
                    target: "session",
                    session = %app_sid,
                    "empty-run suppressed: journal already has assistant after last user"
                );
                return None;
            }
            Some((app_sid, stop_reason.to_string(), mode))
        } else {
            None
        }
    }

    /// True when the journal has a non-empty assistant after the most recent user row.
    fn journal_has_assistant_after_last_user(app_session_id: &str) -> bool {
        let msgs = store::load_messages(app_session_id);
        let last_user = msgs
            .iter()
            .rposition(|m| m.role == "user" && !m.content.trim().is_empty());
        let Some(ui) = last_user else {
            return false;
        };
        msgs[ui + 1..].iter().any(|m| {
            m.role == "assistant" && !m.is_error && !m.content.trim().is_empty()
        })
    }

    /// Finish turn when a deferred `prompt_complete` is safe (#52).
    /// Returns `Some(empty_run)` if finished (`None` inside = finished, not empty);
    /// returns `None` if still deferred.
    fn try_finish_deferred_prompt_complete(
        s: &mut LiveSession,
    ) -> Option<Option<(String, String, String)>> {
        let Some(stop_reason) = s.deferred_prompt_complete.clone() else {
            return None;
        };
        // The `session/prompt` RPC has not resolved → the agent may still emit
        // more text (it fires `prompt_complete` early). Ending the turn here is
        // what truncated answers mid-sentence and made the chat look stuck.
        // `schedule_prompt_complete_fallback` releases the waiter once the agent
        // has gone quiet (and `PROMPT_TIMEOUT_SECS` caps a wedged RPC), so this
        // cannot hang.
        if s.prompt_in_flight {
            return None;
        }
        let awaiting_perm = s.fsm.state() == SessionState::AwaitingPermission;
        if should_defer_prompt_complete(
            awaiting_perm,
            s.pending_plan_rpc_id.is_some(),
            s.pending_ask_user_rpc_id.is_some(),
            s.open_tool_ids.len(),
        ) {
            return None;
        }
        let empty = Self::empty_run_signal_from_live(s, &stop_reason);
        s.deferred_prompt_complete = None;
        // Force-flush assistant turn (I04 end-of-turn path).
        Self::maybe_flush_stream_journal(s, true, false);
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
        s.open_tool_ids.clear();
        s.tools_this_turn = 0;
        if s.fsm.state() == SessionState::Streaming
            || s.fsm.state() == SessionState::AwaitingPermission
        {
            let _ = s.fsm.end_stream();
        }
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.last_stall_emit = None;
        tracing::info!(
            "acp turn finished after deferred prompt_complete stop={stop_reason}"
        );
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        s.open_tool_seen_at.clear();
        Some(empty)
    }

    /// Tool call ids that already have a terminal journal row (`tool-{id}`).
    fn journal_terminal_tool_ids(app_session_id: &str) -> HashSet<String> {
        let mut out = HashSet::new();
        for m in store::load_messages(app_session_id) {
            if m.role != "tool" {
                continue;
            }
            let Some(call_id) = m.id.strip_prefix("tool-") else {
                continue;
            };
            if journal_tool_is_terminal(&m.content) {
                out.insert(call_id.to_string());
            }
        }
        out
    }

    /// True when the journal has a non-empty, non-error assistant body (any turn).
    /// Used only as a silent heal signal when Host is stuck Streaming after work finished.
    fn journal_has_assistant_body(app_session_id: &str) -> bool {
        store::load_messages(app_session_id).iter().rev().any(|m| {
            m.role == "assistant" && !m.is_error && !m.content.trim().is_empty()
        })
    }

    /// Drop leaked open tool ids (journal already terminal, or aged without updates).
    fn prune_orphan_open_tools(s: &mut LiveSession, now: Instant) -> usize {
        if s.open_tool_ids.is_empty() {
            return 0;
        }
        let terminal = Self::journal_terminal_tool_ids(&s.app_session_id);
        let mut drop_ids: Vec<String> = Vec::new();
        for id in s.open_tool_ids.iter() {
            let last = s
                .open_tool_seen_at
                .get(id)
                .copied()
                .unwrap_or(s.last_stream_progress);
            let journal_done = terminal.contains(id);
            if should_prune_open_tool_id(last, now, journal_done) {
                drop_ids.push(id.clone());
            }
        }
        let n = drop_ids.len();
        for id in drop_ids {
            s.open_tool_ids.remove(&id);
            s.open_tool_seen_at.remove(&id);
            tracing::info!(
                target: "session",
                session = %s.app_session_id,
                tool_id = %id,
                "pruned orphan open_tool_id (stall heal)"
            );
        }
        n
    }

    /// Force-end a Streaming turn while preserving journal (silent heal / hard stall).
    fn force_end_streaming_turn(s: &mut LiveSession, reason: &str) {
        // Drop any unsent stream IPC so the UI does not get a late partial after Ready.
        s.pending_stream_emit = None;
        Self::maybe_flush_stream_journal(s, true, false);
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
        s.open_tool_ids.clear();
        s.open_tool_seen_at.clear();
        s.deferred_prompt_complete = None;
        s.tools_this_turn = 0;
        s.prompt_in_flight = false;
        if s.fsm.state() == SessionState::Streaming
            || s.fsm.state() == SessionState::AwaitingPermission
        {
            let _ = s.fsm.end_stream();
        }
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.last_stall_emit = None;
        s.stall_soft_emits = 0;
        s.saw_model_output = false;
        tracing::info!(
            target: "session",
            session = %s.app_session_id,
            reason,
            "force-ended stuck streaming turn (journal preserved)"
        );
    }

    /// Silent heal before any stall UI. Returns true if the turn was ended.
    fn heal_stuck_streaming_turn(s: &mut LiveSession, now: Instant) -> bool {
        if s.fsm.state() != SessionState::Streaming {
            return false;
        }
        // Never auto-end while waiting on a human gate.
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return false;
        }

        Self::prune_orphan_open_tools(s, now);

        // Deferred prompt_complete may finish once tools are cleared.
        if Self::try_finish_deferred_prompt_complete(s).is_some() {
            return true;
        }

        // Pure stuck FSM: RPC done, no tools, no deferred finish left.
        if !s.prompt_in_flight
            && s.open_tool_ids.is_empty()
            && s.deferred_prompt_complete.is_none()
        {
            Self::force_end_streaming_turn(s, "ready_eligible_silent_heal");
            return true;
        }

        false
    }

    /// Emit empty-run toast event if the finish result says so.
    fn emit_empty_run_if_any(
        app: &AppHandle,
        empty: Option<(String, String, String)>,
    ) {
        let Some((app_sid, reason, mode)) = empty else {
            return;
        };
        tracing::info!(
            target: "session",
            session = %app_sid,
            stop_reason = %reason,
            mode = %mode,
            "turn ended with no assistant body and zero tool calls (soft empty-run signal)"
        );
        let _ = app.emit(
            "session://turn_empty_run",
            serde_json::json!({
                "sessionId": app_sid,
                "stopReason": reason,
                "mode": mode,
                "toolCount": 0,
            }),
        );
    }

    fn touch_stream_progress_locked(s: &mut LiveSession) {
        let now = Instant::now();
        s.last_activity = now;
        s.last_stream_progress = now;
        s.last_stall_emit = None;
    }

    fn stream_stall_seconds_from_settings() -> u32 {
        normalize_stream_stall_seconds(store::load_settings().stream_stall_seconds)
    }

    fn emit_stream_stall(
        app: &AppHandle,
        session_id: &str,
        stall_seconds: u32,
        tier: StallTier,
        saw_model_output: bool,
        saw_tool_activity: bool,
    ) {
        let _ = app.emit(
            "session://stream_stall",
            serde_json::json!({
                "sessionId": session_id,
                "stallSeconds": stall_seconds,
                "code": "STREAM_STALL",
                "message": stream_stall_message(stall_seconds),
                "tier": tier.as_str(),
                "sawModelOutput": saw_model_output,
                "sawToolActivity": saw_tool_activity,
            }),
        );
    }

    /// Persist accumulated assistant stream (I04). `force` bypasses the throttle.
    fn maybe_flush_stream_journal(s: &mut LiveSession, force: bool, paragraph_break: bool) {
        let has_content = !s.stream_buf.is_empty()
            || !s.stream_thought.is_empty()
            || !s.stream_attachments.is_empty();
        if !has_content {
            return;
        }
        let now = Instant::now();
        if !s
            .journal_throttle
            .should_flush(now, force, paragraph_break)
        {
            return;
        }
        let mid = s
            .streaming_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if s.streaming_message_id.is_none() {
            s.streaming_message_id = Some(mid.clone());
        }
        let atts = if s.stream_attachments.is_empty() {
            None
        } else {
            Some(s.stream_attachments.clone())
        };
        let _ = store::append_message(
            &s.app_session_id,
            ChatMessageStored {
                id: mid,
                role: "assistant".into(),
                content: s.stream_buf.clone(),
                thought: if s.stream_thought.is_empty() {
                    None
                } else {
                    Some(s.stream_thought.clone())
                },
                created_at: chrono::Utc::now(),
                is_error: false,
                attachments: atts,
                marker: None,
            },
        );
        s.meta.updated_at = chrono::Utc::now();
        let _ = store::update_session_meta(&s.meta);
        s.journal_throttle.mark_flushed(now);
        if force {
            s.journal_throttle.reset();
        }
    }

    fn stream_kind_str(kind: StreamKind) -> &'static str {
        match kind {
            StreamKind::Assistant => "assistant",
            StreamKind::Thought => "thought",
        }
    }

    /// Emit one coalesced stream payload (or no-op).
    fn flush_pending_stream_emit(s: &mut LiveSession, app: &AppHandle) {
        let Some(p) = s.pending_stream_emit.take() else {
            return;
        };
        if p.text.is_empty() && !p.done {
            return;
        }
        let _ = app.emit(
            "session://stream",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "messageId": p.message_id,
                "text": p.text,
                "done": p.done,
                "kind": Self::stream_kind_str(p.kind),
                "thoughtPhase": p.thought_phase,
            }),
        );
    }

    /// Buffer stream IPC; flush on force / char budget / merge break / timer.
    /// Returns whether a delayed flush task should be scheduled.
    fn queue_stream_emit(
        s: &mut LiveSession,
        app: &AppHandle,
        kind: StreamKind,
        message_id: String,
        text: String,
        thought_phase: &str,
        done: bool,
    ) -> bool {
        let kind_s = Self::stream_kind_str(kind);
        let force = done
            || thought_phase.eq_ignore_ascii_case("new")
            || thought_phase.eq_ignore_ascii_case("open");

        if let Some(pending) = s.pending_stream_emit.as_ref() {
            let can = stream_emit_can_merge(
                Self::stream_kind_str(pending.kind),
                &pending.message_id,
                kind_s,
                &message_id,
                thought_phase,
            );
            if !can {
                Self::flush_pending_stream_emit(s, app);
            }
        }

        let now = Instant::now();
        if let Some(pending) = s.pending_stream_emit.as_mut() {
            pending.text.push_str(&text);
            pending.done = pending.done || done;
            // Keep first non-none thought phase for the batch (UI phase open).
            if pending.thought_phase == "none"
                || pending.thought_phase.is_empty()
            {
                pending.thought_phase = thought_phase.to_string();
            }
            let flush = should_flush_stream_emit(
                pending.first_at,
                pending.text.len(),
                now,
                force,
                DEFAULT_STREAM_EMIT_MAX_CHARS,
                Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
            );
            if flush {
                Self::flush_pending_stream_emit(s, app);
                return false;
            }
            return true; // still pending → ensure timer
        }

        // Fresh buffer
        if force || text.is_empty() {
            // Emit immediately (done tick / phase boundary / empty marker).
            let _ = app.emit(
                "session://stream",
                serde_json::json!({
                    "sessionId": s.app_session_id,
                    "messageId": message_id,
                    "text": text,
                    "done": done,
                    "kind": kind_s,
                    "thoughtPhase": thought_phase,
                }),
            );
            return false;
        }

        s.pending_stream_emit = Some(PendingStreamEmit {
            kind,
            message_id,
            text,
            thought_phase: thought_phase.to_string(),
            done,
            first_at: now,
        });
        true
    }

    fn schedule_stream_emit_flush(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: String,
        gen: u64,
    ) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(DEFAULT_STREAM_EMIT_MS)).await;
            mgr.flush_stream_emit_if_gen(&app, &session_id, gen);
        });
    }

    fn flush_stream_emit_if_gen(&self, app: &AppHandle, session_id: &str, gen: u64) {
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == session_id && s.stream_emit_flush_gen == gen {
                    if let Some(p) = s.pending_stream_emit.as_ref() {
                        if should_flush_stream_emit(
                            p.first_at,
                            p.text.len(),
                            Instant::now(),
                            false,
                            DEFAULT_STREAM_EMIT_MAX_CHARS,
                            Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
                        ) {
                            Self::flush_pending_stream_emit(s, app);
                        }
                    }
                    return;
                }
            }
        }
        let mut bg = self.background.lock();
        if let Some(s) = bg.get_mut(session_id) {
            if s.stream_emit_flush_gen == gen {
                if let Some(p) = s.pending_stream_emit.as_ref() {
                    if should_flush_stream_emit(
                        p.first_at,
                        p.text.len(),
                        Instant::now(),
                        false,
                        DEFAULT_STREAM_EMIT_MAX_CHARS,
                        Duration::from_millis(DEFAULT_STREAM_EMIT_MS),
                    ) {
                        Self::flush_pending_stream_emit(s, app);
                    }
                }
            }
        }
    }

    /// Open-tool heartbeat: re-arm stall progress + emit explicit protocol event.
    fn tick_tool_heartbeats(&self, app: &AppHandle) {
        let now = Instant::now();
        let mut emits: Vec<(String, Vec<String>, u64)> = Vec::new();

        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if let Some(e) = Self::maybe_tool_heartbeat_on_session(s, now) {
                    emits.push(e);
                }
            }
        }
        {
            let mut bg = self.background.lock();
            for s in bg.values_mut() {
                if let Some(e) = Self::maybe_tool_heartbeat_on_session(s, now) {
                    emits.push(e);
                }
            }
        }

        for (sid, tool_ids, open_count) in emits {
            let _ = app.emit(
                "session://tool_heartbeat",
                serde_json::json!({
                    "sessionId": sid,
                    "toolCallIds": tool_ids,
                    "openCount": open_count,
                    "intervalSecs": crate::tool_heartbeat::TOOL_HEARTBEAT_INTERVAL_SECS,
                }),
            );
        }
    }

    fn maybe_tool_heartbeat_on_session(
        s: &mut LiveSession,
        now: Instant,
    ) -> Option<(String, Vec<String>, u64)> {
        if s.open_tool_ids.is_empty() {
            return None;
        }
        if !matches!(
            s.fsm.state(),
            SessionState::Streaming | SessionState::AwaitingPermission
        ) && !s.prompt_in_flight
        {
            return None;
        }
        let oldest = s.open_tool_seen_at.values().copied().min();
        if !should_emit_tool_heartbeat(
            s.open_tool_ids.len(),
            s.last_tool_heartbeat_emit,
            oldest,
            now,
        ) {
            return None;
        }
        // Re-arm stall progress — long tools without intermediate tool events
        // must not false-trigger soft/hard stream stall.
        Self::touch_stream_progress_locked(s);
        s.last_tool_heartbeat_emit = Some(now);
        let ids: Vec<String> = s.open_tool_ids.iter().cloned().collect();
        let n = ids.len() as u64;
        Some((s.app_session_id.clone(), ids, n))
    }

    /// Start a fresh assistant journal/UI row after a mid-turn interjection.
    fn begin_post_interjection_stream(s: &mut LiveSession) {
        s.streaming_message_id = Some(Uuid::new_v4().to_string());
        s.stream_message_id_locked = true;
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.journal_throttle.reset();
    }

    /// Select the active interjection target (backend, app session id, turn id,
    /// optional ACP client) from a live session, validating that a streaming
    /// turn is in progress.
    ///
    /// Pure (no `AppHandle`) so the rejection path is unit-testable without
    /// `tauri::test::mock_app()`, which crashes the Windows test binary
    /// (`STATUS_ENTRYPOINT_NOT_FOUND`, tauri #14580 / #13419).
    fn pick_interjection_target(
        s: &LiveSession,
    ) -> Result<(String, String, String, Option<Arc<AcpClient>>), String> {
        if !(s.prompt_in_flight || s.fsm.state() == SessionState::Streaming) {
            return Err("interjection requires a streaming turn".into());
        }
        let turn_id = s
            .active_turn_id
            .clone()
            .ok_or("interjection requires an active turn")?;
        Ok((
            s.backend.clone(),
            s.app_session_id.clone(),
            turn_id,
            s.acp.clone(),
        ))
    }

    fn is_interjection_turn_active(
        s: &LiveSession,
        app_session_id: &str,
        turn_id: &str,
    ) -> bool {
        s.app_session_id == app_session_id
            && s.active_turn_id.as_deref() == Some(turn_id)
            && (s.prompt_in_flight
                || matches!(
                    s.fsm.state(),
                    SessionState::Streaming | SessionState::AwaitingPermission
                ))
    }

    /// Persist an interjection at the current stream boundary while holding the
    /// session lock. Emitting before unlock guarantees UI order vs stream chunks.
    fn commit_interjection_boundary<R: tauri::Runtime>(
        s: &mut LiveSession,
        app: &AppHandle<R>,
        message: &ChatMessageStored,
        expected_app_session_id: &str,
        expected_turn_id: &str,
    ) -> Result<(), String> {
        if !Self::is_interjection_turn_active(
            s,
            expected_app_session_id,
            expected_turn_id,
        ) {
            return Err("interjection turn is no longer active".into());
        }
        Self::maybe_flush_stream_journal(s, true, false);
        // ACP interject already landed — journal is best-effort; always split stream id.
        if let Err(e) = store::append_message(&s.app_session_id, message.clone()) {
            tracing::error!("interjection journal append failed: {e}");
        }
        s.meta.updated_at = message.created_at;
        if let Err(e) = store::update_session_meta(&s.meta) {
            tracing::warn!("interjection meta update failed: {e}");
        }
        Self::begin_post_interjection_stream(s);
        let _ = app.emit(
            "session://interjection",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "message": message,
            }),
        );
        Ok(())
    }

    /// Adopt agent message id unless host locked the id after an interjection split.
    fn ensure_stream_message_id(s: &mut LiveSession, kind: StreamKind, message_id: Option<String>) {
        if !s.stream_message_id_locked {
            if let Some(ref mid_in) = message_id {
                if s.streaming_message_id.as_ref() != Some(mid_in)
                    && (s.streaming_message_id.is_none() || matches!(kind, StreamKind::Assistant))
                {
                    s.streaming_message_id = Some(mid_in.clone());
                }
            }
        }
        if s.streaming_message_id.is_none() {
            s.streaming_message_id =
                Some(message_id.unwrap_or_else(|| Uuid::new_v4().to_string()));
        }
    }

    /// I06: silence → silent heal first; soft banner only if still stuck; hard end last.
    fn tick_stream_stall(&self, app: &AppHandle) {
        let stall_secs = Self::stream_stall_seconds_from_settings();
        let now = Instant::now();

        // Heal live focus slot.
        let live_action = {
            let mut guard = self.inner.lock();
            guard
                .as_mut()
                .and_then(|s| Self::tick_stream_stall_on_session(s, stall_secs, now))
        };
        self.apply_stall_tick_action(app, live_action);

        // Heal background busy turns (no soft UI — only silent/hard end).
        let bg_actions: Vec<StallTickAction> = {
            let mut bg = self.background.lock();
            bg.values_mut()
                .filter_map(|s| {
                    Self::tick_stream_stall_on_session(s, stall_secs, now).and_then(|a| {
                        // Background: heal/hard only — do not steal focus with soft banner.
                        match a {
                            StallTickAction::SoftStall { .. } => None,
                            other => Some(other),
                        }
                    })
                })
                .collect()
        };
        for a in bg_actions {
            self.apply_stall_tick_action(app, Some(a));
        }
    }

    /// Per-session stall tick decision (mutates session when healing).
    fn tick_stream_stall_on_session(
        s: &mut LiveSession,
        stall_secs: u32,
        now: Instant,
    ) -> Option<StallTickAction> {
        // Only pure streaming silence — not permission / plan / ask-user waits.
        if s.fsm.state() != SessionState::Streaming {
            return None;
        }
        if s.streaming_message_id.is_none() {
            return None;
        }
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return None;
        }
        // No silence yet — keep working.
        if !is_stream_stalled(s.last_stream_progress, stall_secs, now) {
            return None;
        }

        // 1) Silent heal (orphan tools + deferred complete + ready-eligible).
        if Self::heal_stuck_streaming_turn(s, now) {
            return Some(StallTickAction::Healed {
                session_id: s.app_session_id.clone(),
            });
        }

        // 2) Hard silence → force end, keep journal.
        if is_hard_stalled(s.last_stream_progress, stall_secs, now) {
            let sid = s.app_session_id.clone();
            Self::force_end_streaming_turn(s, "hard_stall_timeout");
            return Some(StallTickAction::HardEnded {
                session_id: sid,
                stall_seconds: hard_stall_seconds(stall_secs),
            });
        }

        // 3) Soft banner (capped once per turn) — still less interruptive.
        if !should_emit_soft_stall(
            s.last_stream_progress,
            s.last_stall_emit,
            stall_secs,
            s.stall_soft_emits,
            now,
        ) {
            return None;
        }
        s.last_stall_emit = Some(now);
        s.stall_soft_emits = s.stall_soft_emits.saturating_add(1);
        let saw_model = s.saw_model_output
            || !s.stream_buf.trim().is_empty()
            || Self::journal_has_assistant_body(&s.app_session_id);
        if saw_model {
            s.saw_model_output = true;
        }
        let saw_tools = s.tools_this_turn > 0 || !s.open_tool_ids.is_empty();
        // Terminal candidate: body present and no open tools — prefer maybe_done copy.
        let terminal_candidate =
            saw_model && s.open_tool_ids.is_empty() && s.deferred_prompt_complete.is_none();
        let tier = stall_tier_from_evidence(saw_model, saw_tools, terminal_candidate);
        Some(StallTickAction::SoftStall {
            session_id: s.app_session_id.clone(),
            stall_seconds: stall_secs,
            tier,
            saw_model_output: saw_model,
            saw_tool_activity: saw_tools,
        })
    }

    fn apply_stall_tick_action(&self, app: &AppHandle, action: Option<StallTickAction>) {
        let Some(action) = action else {
            return;
        };
        match action {
            StallTickAction::Healed { session_id } => {
                tracing::info!(
                    target: "session",
                    session = %session_id,
                    "stream stall heal succeeded — turn Ready"
                );
                Self::emit_runtime(
                    app,
                    &SessionSnapshot {
                        session_id: Some(session_id),
                        agent_session_id: None,
                        state: SessionState::Ready,
                        last_error: None,
                        streaming_message_id: None,
                        backend: Self::backend_name(),
                        model_id: None,
                        project_path: None,
                        title: String::new(),
                    },
                );
                Self::emit_state(app, &self.snapshot());
            }
            StallTickAction::HardEnded {
                session_id,
                stall_seconds,
            } => {
                tracing::warn!(
                    target: "session",
                    session = %session_id,
                    stall_seconds,
                    "hard stream stall — force-ended turn, journal kept"
                );
                Self::emit_runtime(
                    app,
                    &SessionSnapshot {
                        session_id: Some(session_id.clone()),
                        agent_session_id: None,
                        state: SessionState::Ready,
                        last_error: None,
                        streaming_message_id: None,
                        backend: Self::backend_name(),
                        model_id: None,
                        project_path: None,
                        title: String::new(),
                    },
                );
                let _ = app.emit(
                    "session://stream_stall_hard_end",
                    serde_json::json!({
                        "sessionId": session_id,
                        "stallSeconds": stall_seconds,
                        "code": "STREAM_STALL_HARD_END",
                    }),
                );
                Self::emit_state(app, &self.snapshot());
            }
            StallTickAction::SoftStall {
                session_id,
                stall_seconds,
                tier,
                saw_model_output,
                saw_tool_activity,
            } => {
                tracing::warn!(
                    target: "session",
                    session = %session_id,
                    stall_seconds,
                    tier = tier.as_str(),
                    "stream soft stall — emitting keep-waiting prompt"
                );
                Self::emit_stream_stall(
                    app,
                    &session_id,
                    stall_seconds,
                    tier,
                    saw_model_output,
                    saw_tool_activity,
                );
            }
        }
    }

    /// Live + background + parked processes that still have a living ACP child.
    fn active_process_count(&self) -> u32 {
        let live = self
            .inner
            .lock()
            .as_ref()
            .and_then(|s| s.acp.as_ref())
            .filter(|c| c.is_alive())
            .is_some() as u32;
        let background = self
            .background
            .lock()
            .values()
            .filter(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
            .count() as u32;
        let parked = self
            .parked
            .lock()
            .values()
            .filter(|p| p.acp.is_alive())
            .count() as u32;
        live + background + parked
    }

    fn max_concurrent_from_settings() -> u32 {
        normalize_max_concurrent(store::load_settings().max_concurrent_agents)
    }

    fn idle_minutes_from_settings() -> u32 {
        normalize_idle_minutes(store::load_settings().agent_idle_minutes)
    }

    fn emit_idle_recycled(app: &AppHandle, session_id: &str, reason: &str) {
        let _ = app.emit(
            "session://idle_recycled",
            serde_json::json!({
                "sessionId": session_id,
                "reason": reason,
            }),
        );
    }

    fn emit_process_limit(app: &AppHandle, session_id: Option<&str>, max: u32) {
        let _ = app.emit(
            "session://process_limit",
            serde_json::json!({
                "sessionId": session_id,
                "maxConcurrentAgents": max,
                "code": "PROCESS_LIMIT",
                "message": process_limit_message(max),
            }),
        );
    }

    /// Drop dead parked entries; return removed count (for logging).
    fn sweep_dead_parked(&self) -> usize {
        let mut parked = self.parked.lock();
        let before = parked.len();
        parked.retain(|_, p| p.acp.is_alive());
        before.saturating_sub(parked.len())
    }

    /// Drop background shells whose ACP child is gone (stale mid-turn maps).
    fn sweep_dead_background(&self) -> usize {
        let mut bg = self.background.lock();
        let before = bg.len();
        bg.retain(|_, s| s.acp.as_ref().is_some_and(|c| c.is_alive()));
        before.saturating_sub(bg.len())
    }

    /// Live + background process count (excludes reclaimable parked idle).
    /// Used for diagnostics / limit messaging after parked reclaim.
    fn busy_process_count(&self) -> u32 {
        let live = self
            .inner
            .lock()
            .as_ref()
            .and_then(|s| s.acp.as_ref())
            .filter(|c| c.is_alive())
            .is_some() as u32;
        let background = self
            .background
            .lock()
            .values()
            .filter(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
            .count() as u32;
        live + background
    }

    /// True while a turn is still in flight — must demote to `background`, never park.
    /// Includes open tools / deferred prompt_complete even if FSM already Ready
    /// (early prompt_complete + long-running find/subagent).
    fn live_session_is_busy(s: &LiveSession) -> bool {
        // Authoritative: the prompt RPC has not resolved, so the agent is still
        // producing output for this chat no matter what the FSM says. Parking
        // here dropped the rest of the answer on the floor (parked agents get no
        // event routing) while the agent happily finished the turn.
        if s.prompt_in_flight {
            return true;
        }
        if matches!(
            s.fsm.state(),
            SessionState::Streaming
                | SessionState::AwaitingPermission
                | SessionState::Connecting
        ) {
            return true;
        }
        if s.streaming_message_id.is_some() {
            return true;
        }
        if !s.open_tool_ids.is_empty() {
            return true;
        }
        if s.deferred_prompt_complete.is_some() {
            return true;
        }
        if s.pending_plan_rpc_id.is_some() || s.pending_ask_user_rpc_id.is_some() {
            return true;
        }
        false
    }

    /// Park or background the current live session so focus can move.
    ///
    /// - Idle Ready (no open tools) → warm `parked`.
    /// - Busy (FSM or open tools / deferred complete) → `background` (event pump kept).
    /// - Demoting a busy turn always succeeds (never cancel for focus).
    fn try_park_live(&self) -> Result<(), AgentError> {
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return Ok(());
        };
        // Nothing to park
        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
            // Drop dead shell so connect can rebuild.
            let _ = guard.take();
            return Ok(());
        }

        // Busy (incl. open tools while FSM Ready) → background, never park/reclaim.
        if Self::live_session_is_busy(s) {
            let Some(live) = guard.take() else {
                return Ok(());
            };
            let sid = live.app_session_id.clone();
            let st = live.fsm.state();
            let tools = live.open_tool_ids.len();
            drop(guard);
            tracing::info!(
                "acp demote busy session to background sid={sid} state={st:?} open_tools={tools}"
            );
            self.background.lock().insert(sid, live);
            return Ok(());
        }

        match s.fsm.state() {
            SessionState::Ready => {
                let acp = match s.acp.take() {
                    Some(c) if c.is_alive() => c,
                    Some(_) | None => {
                        let _ = guard.take();
                        return Ok(());
                    }
                };
                let parked = ParkedAgent {
                    process_id: s.process_id.clone(),
                    app_session_id: s.app_session_id.clone(),
                    meta: s.meta.clone(),
                    acp,
                    last_activity: s.last_activity,
                    model_id: s.model_id.clone(),
                    effort: s.effort.clone(),
                    product_mode: s.product_mode.clone(),
                    project_path: s.project_path.clone(),
                    policy: s.policy,
                    needs_history_bootstrap: s.needs_history_bootstrap,
                    backend: s.backend.clone(),
                };
                let _ = guard.take();
                drop(guard);
                self.parked
                    .lock()
                    .insert(parked.app_session_id.clone(), parked);
                Ok(())
            }
            SessionState::Idle | SessionState::Disconnected => {
                // Detach dead/idle shell without killing if no acp; drop shell.
                let _ = guard.take();
                Ok(())
            }
            other => Err(AgentError::new(
                AgentErrorCode::ProcessLimit,
                format!(
                    "Session is busy ({other:?}). Stop the turn or wait, then switch chats. {}",
                    process_limit_message(Self::max_concurrent_from_settings())
                ),
            )),
        }
    }

    /// Like `try_park_live`, then emit `session://runtime` for the demoted session.
    fn try_park_live_emit(&self, app: &AppHandle) -> Result<(), AgentError> {
        let pre = self.inner.lock().as_ref().map(|s| {
            let busy = Self::live_session_is_busy(s);
            let mut snap = Self::snapshot_from_live(s);
            if busy && snap.state == SessionState::Ready {
                // Open tools while Ready — project as streaming so UI keeps busy.
                snap.state = SessionState::Streaming;
            }
            (busy, snap)
        });
        self.try_park_live()?;
        if let Some((busy, snap)) = pre {
            if busy {
                Self::emit_runtime(app, &snap);
            } else if snap.state == SessionState::Ready {
                let mut parked_snap = snap;
                parked_snap.streaming_message_id = None;
                Self::emit_runtime(app, &parked_snap);
            }
        }
        Ok(())
    }

    /// If a background session finished its turn (Ready, no open tools), park warm.
    fn promote_background_ready_to_parked(&self, app_session_id: &str) {
        let mut bg = self.background.lock();
        let ready = bg.get(app_session_id).is_some_and(|s| {
            matches!(s.fsm.state(), SessionState::Ready)
                && !s.prompt_in_flight
                && s.streaming_message_id.is_none()
                && s.open_tool_ids.is_empty()
                && s.deferred_prompt_complete.is_none()
                && s.pending_plan_rpc_id.is_none()
                && s.pending_ask_user_rpc_id.is_none()
                && s.acp.as_ref().is_some_and(|c| c.is_alive())
        });
        if !ready {
            return;
        }
        let Some(mut s) = bg.remove(app_session_id) else {
            return;
        };
        drop(bg);
        let Some(acp) = s.acp.take() else {
            return;
        };
        let parked = ParkedAgent {
            process_id: s.process_id.clone(),
            app_session_id: s.app_session_id.clone(),
            meta: s.meta.clone(),
            acp,
            last_activity: s.last_activity,
            model_id: s.model_id.clone(),
            effort: s.effort.clone(),
            product_mode: s.product_mode.clone(),
            project_path: s.project_path.clone(),
            policy: s.policy,
            needs_history_bootstrap: s.needs_history_bootstrap,
            backend: s.backend.clone(),
        };
        self.parked
            .lock()
            .insert(parked.app_session_id.clone(), parked);
        tracing::info!(
            "acp background session ready → parked sid={}",
            app_session_id
        );
    }

    /// Promote a parked agent into the live slot (caller must have cleared live).
    fn unpark_to_live(&self, app_session_id: &str) -> Option<LiveSession> {
        let parked = self.parked.lock().remove(app_session_id)?;
        if !parked.acp.is_alive() {
            return None;
        }
        let mut fsm = SessionFsm::new();
        // Parked agents were Ready; restore Ready without connect handshake.
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        Some(LiveSession {
            app_session_id: parked.app_session_id,
            process_id: parked.process_id,
            meta: parked.meta,
            fsm,
            backend: parked.backend,
            acp: Some(parked.acp),
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: parked.model_id,
            effort: parked.effort,
            product_mode: parked.product_mode,
            project_path: parked.project_path,
            allow_cache: SessionAllowCache::default(),
            policy: parked.policy,
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: parked.needs_history_bootstrap,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        })
    }

    /// Run `f` on a session's runtime state wherever it currently sits —
    /// the live focus slot **or** a demoted `background` turn.
    ///
    /// Session-scoped commands (permission / plan / ask_user answers) must use
    /// this instead of reaching for `self.inner`: the pending JSON-RPC id lives
    /// on the session that asked, and that session may have been demoted when
    /// the user switched chats. Answering against the live slot sent the reply
    /// to the wrong ACP child, so the background turn waited forever.
    ///
    /// Parked agents are idle Ready and hold no pending RPC — not searched.
    fn with_session_mut<R>(
        &self,
        app_session_id: &str,
        f: impl FnOnce(&mut LiveSession) -> R,
    ) -> Option<R> {
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_session_id {
                    return Some(f(s));
                }
            }
        }
        let mut bg = self.background.lock();
        bg.get_mut(app_session_id).map(f)
    }

    /// True when `app_session_id` currently owns the live focus slot.
    fn is_live_session(&self, app_session_id: &str) -> bool {
        self.inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.app_session_id == app_session_id)
    }

    /// Emit the right runtime event for a session touched out-of-focus:
    /// `session://state` when it is live, `session://runtime` when demoted.
    fn emit_for_session(&self, app: &AppHandle, app_session_id: &str) {
        if self.is_live_session(app_session_id) {
            Self::emit_state(app, &self.snapshot());
            return;
        }
        let snap = self
            .background
            .lock()
            .get(app_session_id)
            .map(Self::snapshot_from_live);
        if let Some(snap) = snap {
            Self::emit_runtime(app, &snap);
        }
    }

    /// Move `target_sid` into the live focus slot **without spawning**.
    ///
    /// Demotes the current live session first (busy → `background`, Ready →
    /// `parked`), then promotes the target from `background` / `parked`.
    /// Returns `false` when the target has no warm process — the caller must
    /// `connect` (cold spawn) instead.
    ///
    /// `send` calls this under `connect_lock` so a concurrent warm connect
    /// cannot swap the live slot between the caller's connect and its send
    /// (that delivered prompts into a foreign chat and left empty-journal
    /// zombie sessions behind).
    fn focus_session(&self, app: &AppHandle, target_sid: &str) -> Result<bool, AgentError> {
        if self
            .inner
            .lock()
            .as_ref()
            .is_some_and(|s| {
                s.app_session_id == target_sid && s.acp.as_ref().is_some_and(|c| c.is_alive())
            })
        {
            return Ok(true);
        }
        let in_background = self.background.lock().contains_key(target_sid);
        let in_parked = self.parked.lock().contains_key(target_sid);
        if !in_background && !in_parked {
            return Ok(false);
        }

        self.try_park_live_emit(app)?;
        // Never overwrite a shell that still holds a living ACP child.
        if self
            .inner
            .lock()
            .as_ref()
            .is_some_and(|s| s.acp.as_ref().is_some_and(|c| c.is_alive()))
        {
            self.try_park_live()?;
        }
        let _ = self.inner.lock().take();

        if in_background {
            if let Some(live) = self.background.lock().remove(target_sid) {
                *self.inner.lock() = Some(live);
                tracing::info!("acp focus: background → live sid={target_sid}");
                Self::emit_state(app, &self.snapshot());
                return Ok(true);
            }
        }
        if let Some(live) = self.unpark_to_live(target_sid) {
            *self.inner.lock() = Some(live);
            tracing::info!("acp focus: parked → live sid={target_sid}");
            Self::emit_state(app, &self.snapshot());
            return Ok(true);
        }
        // Parked process died between the check and the promote → cold spawn.
        Ok(false)
    }

    /// Kill oldest parked agents until `need_slots` are freed (or none left).
    /// Parked = Ready idle; never touches background busy turns.
    async fn free_parked_for_capacity(&self, app: &AppHandle, need_slots: u32) {
        if need_slots == 0 {
            return;
        }
        for _ in 0..need_slots {
            let victim = {
                let mut parked = self.parked.lock();
                let key = parked
                    .iter()
                    .min_by_key(|(_, p)| p.last_activity)
                    .map(|(k, _)| k.clone());
                key.and_then(|k| parked.remove(&k))
            };
            let Some(p) = victim else {
                break;
            };
            tracing::info!(
                "process limit: recycling parked session={} process={}",
                p.app_session_id,
                p.process_id
            );
            p.acp.kill().await;
            Self::emit_idle_recycled(app, &p.app_session_id, "capacity");
        }
    }

    /// Move every finished `background` turn into `parked`.
    ///
    /// `background` is only reclaimable via `parked`, and it is only drained on
    /// the events that end a turn. A turn that ended by any other route (error,
    /// stop, a missed completion) left its agent sitting in `background`
    /// forever: it counted against the pool but no reclaim path could ever free
    /// it, so the app reported "all slots busy" with nothing running.
    fn sweep_finished_background_to_parked(&self) {
        let keys: Vec<String> = self.background.lock().keys().cloned().collect();
        for k in keys {
            self.promote_background_ready_to_parked(&k);
        }
    }

    /// Before spawn: reclaim idle parked until there is room (never kill busy).
    async fn reclaim_parked_until_can_spawn(&self, app: &AppHandle, max_concurrent: u32) {
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns are idle warm agents — make them reclaimable
        // before deciding the pool is full of running work.
        self.sweep_finished_background_to_parked();
        // Free enough parked slots for one new process (may free multiple).
        let active = self.active_process_count();
        let need = parked_slots_to_free_for_spawn(active, max_concurrent);
        if need > 0 {
            self.free_parked_for_capacity(app, need).await;
        }
        // If still full (e.g. free returned fewer), keep freeing until spawnable or empty.
        while !can_spawn_process(self.active_process_count(), max_concurrent) {
            let parked_n = self.parked.lock().len();
            if parked_n == 0 {
                break;
            }
            self.free_parked_for_capacity(app, 1).await;
        }
    }

    /// Idle recycle for live + parked (I03).
    async fn tick_idle_recycle(&self, app: &AppHandle) {
        let idle_mins = Self::idle_minutes_from_settings();
        let now = Instant::now();
        self.sweep_dead_parked();
        self.sweep_dead_background();
        // Finished background turns become parked so the idle window applies.
        self.sweep_finished_background_to_parked();

        // Parked first
        let expired_parked: Vec<ParkedAgent> = {
            let mut parked = self.parked.lock();
            let keys: Vec<String> = parked
                .iter()
                .filter(|(_, p)| is_idle_expired(p.last_activity, idle_mins, now))
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| parked.remove(&k))
                .collect()
        };
        for p in expired_parked {
            tracing::info!(
                "idle recycle parked session={} after {}min",
                p.app_session_id,
                idle_mins
            );
            p.acp.kill().await;
            Self::emit_idle_recycled(app, &p.app_session_id, "idle");
        }

        // Live: only true idle Ready (never mid-turn / open tools).
        let live_kill = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let idle = is_idle_expired(s.last_activity, idle_mins, now);
                let ready_idle = matches!(s.fsm.state(), SessionState::Ready)
                    && !Self::live_session_is_busy(s);
                if idle && ready_idle {
                    if let Some(acp) = s.acp.take() {
                        s.fsm.soft_disconnect();
                        s.needs_history_bootstrap = false;
                        Some((s.app_session_id.clone(), acp))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };
        if let Some((sid, acp)) = live_kill {
            tracing::info!("idle recycle live session={sid} after {idle_mins}min");
            acp.kill().await;
            Self::emit_idle_recycled(app, &sid, "idle");
            Self::emit_state(app, &self.snapshot());
        }
    }

    fn backend_name() -> String {
        if AcpClient::use_mock() {
            "mock_acp".into()
        } else {
            "grok_agent_stdio".into()
        }
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        let guard = self.inner.lock();
        match guard.as_ref() {
            None => SessionSnapshot {
                session_id: None,
                agent_session_id: None,
                state: SessionState::Idle,
                last_error: None,
                streaming_message_id: None,
                backend: Self::backend_name(),
                model_id: None,
                project_path: None,
                title: String::new(),
            },
            Some(s) => SessionSnapshot {
                session_id: Some(s.app_session_id.clone()),
                agent_session_id: s.meta.agent_session_id.clone(),
                state: s.fsm.state(),
                last_error: s.fsm.last_error().cloned(),
                streaming_message_id: s.streaming_message_id.clone(),
                backend: s.backend.clone(),
                model_id: s.model_id.clone(),
                project_path: s.project_path.clone(),
                title: s.meta.title.clone(),
            },
        }
    }

    /// Runtime diagnostics for a session export package (live, background, or parked).
    /// Returns `None` when the session is not currently attached to a process.
    pub fn diagnostic_runtime_for(&self, app_session_id: &str) -> Option<serde_json::Value> {
        {
            let guard = self.inner.lock();
            if let Some(s) = guard.as_ref() {
                if s.app_session_id == app_session_id {
                    return Some(Self::live_runtime_json(s, "live"));
                }
            }
        }
        {
            let bg = self.background.lock();
            if let Some(s) = bg.get(app_session_id) {
                // Overnight / demoted busy turns live here — export must see them.
                return Some(Self::live_runtime_json(s, "background"));
            }
        }
        let parked = self.parked.lock();
        if let Some(p) = parked.get(app_session_id) {
            return Some(serde_json::json!({
                "slot": "parked",
                "state": "Ready",
                "backend": p.backend,
                "modelId": p.model_id,
                "effort": p.effort,
                "mode": p.product_mode,
                "permissionPolicy": p.policy.as_str(),
                "projectPath": p.project_path,
                "agentSessionId": p.meta.agent_session_id,
                "processId": p.process_id,
                "agentAlive": p.acp.is_alive(),
                "cwd": p.acp.cwd().display().to_string(),
                "streamingMessageId": serde_json::Value::Null,
                "toolsThisTurn": 0,
                "openToolCount": 0,
                "promptInFlight": false,
                "needsHistoryBootstrap": p.needs_history_bootstrap,
                "lastError": serde_json::Value::Null,
            }));
        }
        None
    }

    fn live_runtime_json(s: &LiveSession, slot: &str) -> serde_json::Value {
        let cwd = s.acp.as_ref().map(|c| c.cwd().display().to_string());
        let agent_alive = s.acp.as_ref().is_some_and(|c| c.is_alive());
        serde_json::json!({
            "slot": slot,
            "state": format!("{:?}", s.fsm.state()),
            "backend": s.backend,
            "modelId": s.model_id,
            "effort": s.effort,
            "mode": s.product_mode,
            "permissionPolicy": s.policy.as_str(),
            "projectPath": s.project_path,
            "agentSessionId": s.meta.agent_session_id,
            "processId": s.process_id,
            "agentAlive": agent_alive,
            "cwd": cwd,
            "streamingMessageId": s.streaming_message_id,
            "toolsThisTurn": s.tools_this_turn,
            "openToolCount": s.open_tool_ids.len(),
            "promptInFlight": s.prompt_in_flight,
            "needsHistoryBootstrap": s.needs_history_bootstrap,
            "lastError": s.fsm.last_error().map(|e| {
                serde_json::json!({
                    "code": e.code.as_str(),
                    "message": e.message,
                })
            }),
        })
    }

    /// Keep live session meta title in sync after store rename / auto-title.
    /// Without this, later `session://state` events re-emit the stale connect-time title
    /// and wipe sidebar / header renames.
    pub fn apply_title(&self, app: &AppHandle, session_id: &str, title: &str) -> bool {
        let title = title.trim();
        if title.is_empty() {
            return false;
        }
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return false;
        };
        if s.app_session_id != session_id {
            return false;
        }
        if s.meta.title == title {
            return true;
        }
        s.meta.title = title.to_string();
        s.meta.updated_at = chrono::Utc::now();
        drop(guard);
        Self::emit_state(app, &self.snapshot());
        true
    }

    fn emit_state(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://state", snap);
    }

    /// Multi-session runtime for a non-focused session (background / parked).
    /// Does **not** move the live focus slot — UI projects this into `liveMap` only.
    fn emit_runtime(app: &AppHandle, snap: &SessionSnapshot) {
        let _ = app.emit("session://runtime", snap);
    }

    fn snapshot_from_live(s: &LiveSession) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(s.app_session_id.clone()),
            agent_session_id: s.meta.agent_session_id.clone(),
            state: s.fsm.state(),
            last_error: s.fsm.last_error().cloned(),
            streaming_message_id: s.streaming_message_id.clone(),
            backend: s.backend.clone(),
            model_id: s.model_id.clone(),
            project_path: s.project_path.clone(),
            title: s.meta.title.clone(),
        }
    }

    fn snapshot_from_parked(p: &ParkedAgent) -> SessionSnapshot {
        SessionSnapshot {
            session_id: Some(p.app_session_id.clone()),
            agent_session_id: p.meta.agent_session_id.clone(),
            state: SessionState::Ready,
            last_error: None,
            streaming_message_id: None,
            backend: p.backend.clone(),
            model_id: p.model_id.clone(),
            project_path: p.project_path.clone(),
            title: p.meta.title.clone(),
        }
    }

    /// Persist + push a chat-visible error for a failed turn (retries exhausted, RPC fail, …).
    /// Updates UI via `session://turn_error` so the optimistic thinking bubble becomes a record.
    ///
    /// Content is intentionally short (code + compact reason). The UI maps codes to i18n copy
    /// and must not dump raw RPC/MCP stderr into the chat bubble.
    fn record_turn_error(s: &mut LiveSession, app: &AppHandle, err: &AgentError) {
        let mid = s
            .streaming_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let code = err.code.as_str();
        let detail = sanitize_error_detail(err.message.trim());
        // Persist machine-readable code first so the frontend can i18n the summary.
        let content = if detail.is_empty() {
            format!("**{code}**")
        } else {
            format!("**{code}**\n\n{detail}")
        };
        let _ = store::append_message(
            &s.app_session_id,
            ChatMessageStored {
                id: mid.clone(),
                role: "assistant".into(),
                content: content.clone(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: true,
                attachments: None,
                marker: None,
            },
        );
        s.meta.updated_at = chrono::Utc::now();
        let _ = store::update_session_meta(&s.meta);
        s.stream_buf.clear();
        s.stream_thought.clear();
        s.stream_last_was_assistant = false;
        s.stream_attachments.clear();
        s.streaming_message_id = None;
        s.active_turn_id = None;
        s.stream_message_id_locked = false;
        s.prompt_in_flight = false;
        s.journal_throttle.reset();
        s.last_stall_emit = None;

        let _ = app.emit(
            "session://turn_error",
            serde_json::json!({
                "sessionId": s.app_session_id,
                "messageId": mid,
                "code": code,
                "message": detail,
                "content": content,
            }),
        );
    }

    pub async fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let _connect_guard = self.connect_lock.lock().await;
        self.connect_inner(app, project_path, app_session_id, mock_mode)
            .await
    }

    async fn connect_inner(
        self: &Arc<Self>,
        app: AppHandle,
        project_path: Option<String>,
        app_session_id: Option<String>,
        mock_mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let settings = store::load_settings();
        let max_concurrent = normalize_max_concurrent(settings.max_concurrent_agents);
        self.sweep_dead_parked();

        // Ensure app session meta — never panic on disk/index races.
        let mut meta = if let Some(id) = app_session_id {
            if let Some(existing) = store::load_sessions_index()
                .into_iter()
                .find(|s| s.id == id)
            {
                existing
            } else {
                store::create_session(None, Some("New chat".into()), false)
                    .map_err(|e| format!("create session: {e}"))?
            }
        } else {
            store::create_session(None, Some("New chat".into()), false)
                .map_err(|e| format!("create session: {e}"))?
        };

        // Legacy orphan sessions (no project_id) attach to the general workspace.
        if meta.project_id.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            let _ = store::ensure_general_project();
            meta.project_id = Some(store::GENERAL_PROJECT_ID.into());
            let _ = store::update_session_meta(&meta);
        }

        // Resolve cwd: explicit path → session's project path → general workspace.
        // Never use process cwd (Dock-launched macOS apps often have cwd `/`).
        let cwd = {
            let from_arg = project_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(std::path::PathBuf::from);
            let from_meta = meta.project_id.as_deref().and_then(|pid| {
                store::load_projects()
                    .into_iter()
                    .find(|p| p.id == pid)
                    .map(|p| std::path::PathBuf::from(p.path))
            });
            from_arg
                .or(from_meta)
                .unwrap_or_else(|| {
                    let _ = store::ensure_general_project();
                    crate::paths::general_workspace_dir()
                })
        };
        let project_path = Some(cwd.to_string_lossy().to_string());

        tracing::info!(
            target: "session",
            session = %meta.id,
            resume_agent = ?meta.agent_session_id,
            cwd = %cwd.display(),
            "connect open_start"
        );

        // Resolve model / effort / permission / mode for this project+session scope.
        let prefs = store::resolve_composer_prefs(
            meta.project_id.as_deref(),
            Some(meta.id.as_str()),
        );
        let policy = PermissionPolicy::parse(&prefs.permission_policy);
        let agent_model = crate::providers::agent_spawn_model_id(&prefs.model_id);

        // Already live on this App session with a healthy agent → no-op.
        // Includes mid-turn (streaming / open tools): never respawn or cancel.
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == meta.id
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
                {
                    let mid_turn = Self::live_session_is_busy(s);
                    let ready_match = matches!(s.fsm.state(), SessionState::Ready)
                        && !Self::live_session_is_busy(s)
                        && s.project_path == project_path
                        && s.effort.as_deref() == Some(prefs.effort.as_str());
                    if mid_turn || ready_match {
                        Self::touch_activity_locked(s);
                        tracing::info!(
                            "acp connect no-op: already live session={} state={:?} busy={}",
                            meta.id,
                            s.fsm.state(),
                            mid_turn
                        );
                        return Ok(self.snapshot());
                    }
                }
            }
        }

        // Target already streaming in background → promote to focus.
        if self.background.lock().contains_key(&meta.id) {
            if let Err(e) = self.try_park_live_emit(&app) {
                Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                return Err(format!("{}: {}", e.code.as_str(), e.message));
            }
            if let Some(live) = self.background.lock().remove(&meta.id) {
                *self.inner.lock() = Some(live);
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                tracing::info!("acp promoted background session to live sid={}", meta.id);
                return Ok(snap);
            }
        }

        // Target already parked (warm multi-session) → unpark.
        if self.parked.lock().contains_key(&meta.id) {
            // Park current live if needed (busy → demote to background / park).
            if let Err(e) = self.try_park_live_emit(&app) {
                Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                return Err(format!("{}: {}", e.code.as_str(), e.message));
            }
            if let Some(live) = self.unpark_to_live(&meta.id) {
                // Refresh prefs on shell (model may have changed in UI).
                let mut live = live;
                live.model_id = Some(prefs.model_id.clone());
                live.effort = Some(prefs.effort.clone());
                live.product_mode = Some(prefs.mode.clone());
                live.policy = policy;
                live.project_path = project_path.clone();
                live.meta.model_id = Some(prefs.model_id.clone());
                live.meta.mode = Some(prefs.mode.clone());
                live.meta.effort = Some(prefs.effort.clone());
                live.meta.permission_policy = Some(prefs.permission_policy.clone());
                // Best-effort align agent process to channel prefs.
                if let Some(acp) = live.acp.clone() {
                    if let Err(e) = acp.set_model(&agent_model).await {
                        tracing::warn!("acp set_model on unpark soft-fail: {e}");
                    }
                    if let Err(e) = acp.set_mode(&prefs.mode).await {
                        tracing::warn!("acp set_mode on unpark soft-fail: {e}");
                    }
                }
                *self.inner.lock() = Some(live);
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                tracing::info!("acp unparked warm session={}", meta.id);
                return Ok(snap);
            }
            // Parked process died — fall through to cold spawn.
        }

        // Multi-session: never steal another App session's process (no same-cwd
        // rebind). Each chat keeps its own ACP child — park Ready / background
        // busy, then unpark or cold-spawn for the target.
        {
            let live_sid = self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone());
            if live_sid.as_deref() != Some(meta.id.as_str()) {
                if let Err(e) = self.try_park_live_emit(&app) {
                    Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                    return Err(format!("{}: {}", e.code.as_str(), e.message));
                }
                // Never Drop a shell that still holds a live ACP — re-park/demote.
                {
                    let still_busy = self
                        .inner
                        .lock()
                        .as_ref()
                        .is_some_and(|s| {
                            s.acp.as_ref().is_some_and(|c| c.is_alive())
                                && (Self::live_session_is_busy(s)
                                    || matches!(s.fsm.state(), SessionState::Ready))
                        });
                    if still_busy {
                        // try_park should have moved it; force another demote/park.
                        let _ = self.try_park_live();
                    }
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_ref() {
                        // Only drop empty / dead shells (no acp).
                        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
                            let _ = guard.take();
                        } else if s.app_session_id != meta.id {
                            // Safety: never leave a foreign session in live when connecting.
                            drop(guard);
                            let _ = self.try_park_live();
                        }
                    }
                }
            } else {
                // Same session reconnect / flag change — kill any leftover process.
                // Busy turns on *this* session keep the process (mid-turn no-op above).
                let leftover = {
                    let mut guard = self.inner.lock();
                    let busy = guard
                        .as_ref()
                        .is_some_and(Self::live_session_is_busy);
                    if busy {
                        None
                    } else {
                        guard.take().and_then(|mut s| s.acp.take())
                    }
                };
                if let Some(acp) = leftover {
                    acp.kill().await;
                }
            }
            Self::emit_state(&app, &self.snapshot());
        }

        // Independent GROK_HOME: push permission into agent config before spawn so
        // dontAsk / acceptEdits / YOLO apply agent-side (not only Host).
        if let Err(e) = crate::agent_prefs::sync_permission_to_agent_profile(
            &settings.session_data_mode,
            &prefs.permission_policy,
        ) {
            tracing::warn!("sync agent permission prefs: {e}");
        }

        // Fresh process id per connect (each App session owns its ACP child).
        let process_id = Uuid::new_v4().to_string();
        {
            let mut fsm = SessionFsm::new();
            fsm.start_connect().map_err(|e| e.to_string())?;
            let now = Instant::now();
            *self.inner.lock() = Some(LiveSession {
                app_session_id: meta.id.clone(),
                process_id: process_id.clone(),
                meta: meta.clone(),
                fsm,
                backend: Self::backend_name(),
                acp: None,
                mock_stream: None,
                streaming_message_id: None,
                active_turn_id: None,
                stream_message_id_locked: false,
                stream_buf: String::new(),
                stream_thought: String::new(),
                stream_last_was_assistant: false,
                stream_attachments: Vec::new(),
                model_id: Some(prefs.model_id.clone()),
                effort: Some(prefs.effort.clone()),
                product_mode: Some(prefs.mode.clone()),
                project_path: project_path.clone(),
                allow_cache: SessionAllowCache::default(),
                policy,
                provider_retry_attempt: 0,
                provider_retry_aborted: false,
                needs_history_bootstrap: false,
                pending_plan_rpc_id: None,
                pending_ask_user_rpc_id: None,
                last_activity: now,
                last_stream_progress: now,
                last_stall_emit: None,
                stall_soft_emits: 0,
                journal_throttle: JournalWriteThrottle::with_default_interval(),
                open_tool_ids: HashSet::new(),
                open_tool_seen_at: HashMap::new(),
                deferred_prompt_complete: None,
                tools_this_turn: 0,
            saw_model_output: false,
                prompt_in_flight: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
            });
        }
        Self::emit_state(&app, &self.snapshot());

        let use_mock = AcpClient::use_mock()
            || mock_mode.as_deref() == Some("mock")
            || mock_mode.as_deref() == Some("fail_cli_not_found");

        if use_mock {
            return self.connect_mock(app, mock_mode).await;
        }

        // Remember prior agent session for resume (before we overwrite meta).
        let resume_agent_sid = meta.agent_session_id.clone();
        let journal_has_history = store::load_messages(&meta.id).iter().any(|m| {
            (m.role == "user" || m.role == "assistant")
                && !m.content.trim().is_empty()
                && !m.is_error
        });

        // Capacity: reclaim idle parked first (they fill the pool when browsing
        // chats). Never kill background-busy turns. Live shell has no acp yet.
        self.reclaim_parked_until_can_spawn(&app, max_concurrent)
            .await;
        let active = self.active_process_count();
        let busy = self.busy_process_count();
        if !can_spawn_process(active, max_concurrent) {
            tracing::warn!(
                "process limit: cannot spawn session={} active={} busy={} parked={} max={}",
                meta.id,
                active,
                busy,
                self.parked.lock().len(),
                max_concurrent
            );
            let err = AgentError::new(
                AgentErrorCode::ProcessLimit,
                process_limit_message(max_concurrent),
            );
            {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    let _ = s.fsm.connect_failed(err.clone());
                }
            }
            Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
            let snap = self.snapshot();
            Self::emit_state(&app, &snap);
            return Ok(snap);
        }

        // Real ACP cold spawn (one process per App session — no cross-session rebind).
        let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
        if !probe.found {
            {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    let _ = s.fsm.connect_failed(AgentError::new(
                        AgentErrorCode::CliNotFound,
                        "Grok Build CLI not found. Install Grok Build or set path in Settings.",
                    ));
                }
            }
            let snap = self.snapshot();
            Self::emit_state(&app, &snap);
            return Ok(snap);
        }

        let cli_path = std::path::PathBuf::from(probe.path.unwrap());
        let spawn_opts = crate::acp_client::SpawnOptions {
            model_id: Some(agent_model.clone()),
            effort: Some(prefs.effort.clone()),
            permission_policy: Some(prefs.permission_policy.clone()),
        };

        let (client, mut events) = match AcpClient::spawn_with_options(cli_path, cwd, spawn_opts)
        {
            Ok(v) => {
                tracing::info!(
                    target: "session",
                    session = %meta.id,
                    process = %process_id,
                    "connect spawn_ok"
                );
                v
            }
            Err(e) => {
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect spawn_fail"
                );
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(e);
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                return Ok(snap);
            }
        };

        // Event pump tagged with process_id (multi-process routing).
        {
            let mgr = Arc::clone(self);
            let app_ev = app.clone();
            let pid = process_id.clone();
            tokio::spawn(async move {
                while let Some(ev) = events.recv().await {
                    mgr.handle_acp_event(&app_ev, &pid, ev).await;
                }
            });
        }

        tracing::info!(
            target: "session",
            session = %meta.id,
            resume_agent = ?resume_agent_sid,
            "connect session_open_begin"
        );
        let open_result = client
            .initialize_and_open_session(resume_agent_sid.as_deref())
            .await;

        match open_result {
            Ok((agent_sid, resumed)) => {
                // Align live agent model / product mode with active channel.
                if let Err(e) = client.set_model(&agent_model).await {
                    tracing::warn!("acp set_model after session open soft-fail: {e}");
                }
                if let Err(e) = client.set_mode(&prefs.mode).await {
                    tracing::warn!("acp set_mode after session open soft-fail: {e}");
                }
                // Native resume = full agent context. Fresh session + existing UI
                // journal → bootstrap history into the next prompt.
                let need_bootstrap = !resumed && journal_has_history;
                if resumed {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        "connect session_open_ok resumed=true (full context)"
                    );
                } else if need_bootstrap {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        "connect session_open_ok resumed=false; will bootstrap journal on first send"
                    );
                } else {
                    tracing::info!(
                        target: "session",
                        session = %meta.id,
                        agent = %agent_sid,
                        "connect session_open_ok resumed=false"
                    );
                }
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.handshake_ok();
                        s.acp = Some(client);
                        s.process_id = process_id;
                        s.meta.agent_session_id = Some(agent_sid);
                        s.meta.model_id = Some(prefs.model_id.clone());
                        s.meta.mode = Some(prefs.mode.clone());
                        s.meta.effort = Some(prefs.effort.clone());
                        s.meta.permission_policy = Some(prefs.permission_policy.clone());
                        s.model_id = Some(prefs.model_id.clone());
                        s.effort = Some(prefs.effort.clone());
                        s.product_mode = Some(prefs.mode.clone());
                        s.backend = "grok_agent_stdio".into();
                        s.needs_history_bootstrap = need_bootstrap;
                        Self::touch_activity_locked(s);
                        meta = s.meta.clone();
                    }
                }
                let _ = store::update_session_meta(&meta);
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
            Err(e) => {
                tracing::warn!(
                    target: "session",
                    session = %meta.id,
                    code = e.code.as_str(),
                    error = %e.message,
                    "connect session_open_fail"
                );
                client.kill().await;
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(e);
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
        }
    }

    async fn connect_mock(
        self: &Arc<Self>,
        app: AppHandle,
        mode: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let mode = match mode.as_deref() {
            Some("fail_cli_not_found") => MockConnectMode::FailCliNotFound,
            _ => MockConnectMode::Success,
        };
        tokio::time::sleep(Duration::from_millis(80)).await;
        match mode {
            MockConnectMode::Success => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.handshake_ok();
                        s.backend = "mock_acp".into();
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
            MockConnectMode::FailCliNotFound => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.connect_failed(AgentError::new(
                            AgentErrorCode::CliNotFound,
                            "Mock: CLI not found (GROK_APP_ACP=mock demo)",
                        ));
                        s.backend = "mock_acp".into();
                    }
                }
                let snap = self.snapshot();
                Self::emit_state(&app, &snap);
                Ok(snap)
            }
        }
    }

    /// Move a parked agent back into `background` because its process is still
    /// emitting turn events. Parked means "idle Ready, safe to reclaim" — an
    /// agent that is still talking must never sit there, or its output is
    /// dropped (parked agents get no event routing) while the turn completes
    /// agent-side. Returns true when the session is now in `background`.
    fn rescue_parked_to_background(&self, process_id: &str) -> Option<String> {
        let key = {
            let parked = self.parked.lock();
            parked
                .iter()
                .find(|(_, p)| p.process_id == process_id)
                .map(|(k, _)| k.clone())
        }?;
        let p = self.parked.lock().remove(&key)?;
        tracing::warn!(
            "acp rescue: parked session still streaming → background sid={} process={}",
            p.app_session_id,
            p.process_id
        );
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let now = Instant::now();
        let live = LiveSession {
            app_session_id: p.app_session_id.clone(),
            process_id: p.process_id,
            meta: p.meta,
            fsm,
            backend: p.backend,
            acp: Some(p.acp),
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: p.model_id,
            effort: p.effort,
            product_mode: p.product_mode,
            project_path: p.project_path,
            allow_cache: SessionAllowCache::default(),
            policy: p.policy,
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: p.needs_history_bootstrap,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            // The agent is mid-turn; keep it un-parkable until the turn ends.
            prompt_in_flight: true,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        };
        let sid = live.app_session_id.clone();
        self.background.lock().insert(sid.clone(), live);
        Some(sid)
    }

    /// Short event name for diagnostics (no payload — journals stay readable).
    fn event_kind_name(ev: &AcpEvent) -> &'static str {
        match ev {
            AcpEvent::State { .. } => "state",
            AcpEvent::Stream { .. } => "stream",
            AcpEvent::ToolCall { .. } => "tool_call",
            AcpEvent::Plan { .. } => "plan",
            AcpEvent::AskUserQuestion { .. } => "ask_user",
            AcpEvent::PermissionRequest { .. } => "permission",
            AcpEvent::PromptComplete { .. } => "prompt_complete",
            AcpEvent::RetryState { .. } => "retry_state",
            AcpEvent::ContextCompact { .. } => "context_compact",
            AcpEvent::UsageReported { .. } => "usage",
            AcpEvent::Error { .. } => "error",
            AcpEvent::ProcessExited { .. } => "process_exited",
            AcpEvent::Stderr { .. } => "stderr",
        }
    }

    /// Turn-bearing events must reach their session; bookkeeping ones may be dropped.
    fn event_carries_turn_output(ev: &AcpEvent) -> bool {
        matches!(
            ev,
            AcpEvent::Stream { .. }
                | AcpEvent::ToolCall { .. }
                | AcpEvent::PromptComplete { .. }
                | AcpEvent::PermissionRequest { .. }
                | AcpEvent::Plan { .. }
                | AcpEvent::AskUserQuestion { .. }
                | AcpEvent::Error { .. }
                | AcpEvent::ProcessExited { .. }
        )
    }

    async fn handle_acp_event(self: &Arc<Self>, app: &AppHandle, process_id: &str, ev: AcpEvent) {
        // Route events to the focused live session **or** a background busy session
        // (multi-session parallel streaming). Idle parked agents should not emit.
        let is_live = self
            .inner
            .lock()
            .as_ref()
            .map(|s| s.process_id == process_id)
            .unwrap_or(false);
        let bg_sid = if !is_live {
            self.background
                .lock()
                .iter()
                .find(|(_, s)| s.process_id == process_id)
                .map(|(id, _)| id.clone())
        } else {
            None
        };

        if !is_live {
            if let Some(sid) = bg_sid {
                self.handle_acp_event_on_background(app, &sid, ev).await;
                return;
            }
            if let AcpEvent::ProcessExited { .. } = &ev {
                let mut parked = self.parked.lock();
                parked.retain(|_, p| p.process_id != process_id);
                let mut bg = self.background.lock();
                bg.retain(|_, s| s.process_id != process_id);
                return;
            }
            // Still talking but parked (should be impossible now that
            // `prompt_in_flight` blocks parking — keep the recovery anyway).
            if Self::event_carries_turn_output(&ev) {
                if let Some(sid) = self.rescue_parked_to_background(process_id) {
                    self.handle_acp_event_on_background(app, &sid, ev).await;
                    return;
                }
                // Never fail silently: a dropped chunk is a truncated answer.
                tracing::warn!(
                    "acp event dropped: no session owns process={process_id} ev={}",
                    Self::event_kind_name(&ev)
                );
            }
            return;
        }

        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                // Host stream backpressure: coalesce high-frequency tokens.
                let need_schedule = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Replay guard: on session resume (`session/load`) the CLI
                        // replays the past transcript as agent_message_chunk
                        // notifications. Without a guard the UI re-types the whole
                        // history on every session switch.
                        //
                        // Gate on `prompt_in_flight`, NOT on the FSM: the agent can
                        // fire `prompt_complete` early (which Readies the FSM) and
                        // keep streaming for many more seconds. Gating on the FSM
                        // silently truncated those answers mid-sentence.
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "acp stream dropped: no prompt in flight (fsm={:?}) — replay",
                                s.fsm.state()
                            );
                            return;
                        }
                        // Agent resumed talking after an early prompt_complete —
                        // re-open the turn so the tail is captured and shown.
                        if s.fsm.state() == SessionState::Ready && s.fsm.begin_stream().is_ok() {
                            tracing::info!(
                                "acp turn re-opened: chunk after early prompt_complete sid={}",
                                s.app_session_id
                            );
                        }
                        // Stream chunk = progress (I06); not pure silence.
                        Self::touch_stream_progress_locked(s);
                        // Prefer agent-supplied messageId unless an interjection
                        // deliberately split this turn into a new host-owned row.
                        Self::ensure_stream_message_id(s, kind, message_id);
                        // Split thinking whenever it resumes after *non-empty* body
                        // text so the UI can interleave thought ↔ content. Empty
                        // assistant ticks must not open a new phase — they caused
                        // journal multi-phase markers that reloaded as trailing
                        // "思考 2 / 思考 3" under the answer.
                        let thought_phase = match kind {
                            StreamKind::Thought => {
                                let phase = if s.stream_last_was_assistant {
                                    if !s.stream_thought.is_empty() {
                                        s.stream_thought.push_str("\n\n⟪phase⟫\n\n");
                                    }
                                    s.stream_last_was_assistant = false;
                                    "new"
                                } else if s.stream_thought.is_empty() {
                                    "open"
                                } else {
                                    "continue"
                                };
                                s.stream_thought.push_str(&text);
                                phase
                            }
                            StreamKind::Assistant => {
                                s.stream_buf.push_str(&text);
                                // Only real body text flips the phase boundary.
                                if !text.trim().is_empty() {
                                    s.stream_last_was_assistant = true;
                                    s.saw_model_output = true;
                                }
                                "none"
                            }
                        };
                        // I04: throttled mid-stream journal (force on terminal done chunk).
                        let para = is_paragraph_break(&text);
                        Self::maybe_flush_stream_journal(s, done, para);
                        let mid = s.streaming_message_id.clone().unwrap_or_default();
                        let need = Self::queue_stream_emit(
                            s,
                            app,
                            kind,
                            mid,
                            text,
                            thought_phase,
                            done,
                        );
                        if need {
                            s.stream_emit_flush_gen =
                                s.stream_emit_flush_gen.wrapping_add(1);
                            Some((s.app_session_id.clone(), s.stream_emit_flush_gen))
                        } else {
                            None
                        }
                    } else {
                        return;
                    }
                };
                if let Some((sid, gen)) = need_schedule {
                    self.schedule_stream_emit_flush(app.clone(), sid, gen);
                }
            }
            AcpEvent::PromptComplete {
                stop_reason,
                authoritative,
            } => {
                let empty_run = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Flush any buffered stream before turn-end signals.
                        Self::flush_pending_stream_emit(s, app);
                        Self::touch_stream_progress_locked(s);
                        // Only the RPC result ends the turn. It is ordered after
                        // every chunk, so clearing here cannot truncate output.
                        if authoritative {
                            s.prompt_in_flight = false;
                        }
                        s.deferred_prompt_complete = Some(stop_reason.clone());
                        // #52: do not Ready the UI while tools / permission / ask_user / plan
                        // are still open — agent often fires prompt_complete early.
                        match Self::try_finish_deferred_prompt_complete(s) {
                            None => {
                                tracing::info!(
                                    "acp prompt_complete deferred stop={stop_reason} tools={} perm={} plan={} ask={}",
                                    s.open_tool_ids.len(),
                                    s.fsm.state() == SessionState::AwaitingPermission,
                                    s.pending_plan_rpc_id.is_some(),
                                    s.pending_ask_user_rpc_id.is_some(),
                                );
                                None
                            }
                            Some(empty) => empty,
                        }
                    } else {
                        None
                    }
                };
                Self::emit_state(app, &self.snapshot());
                Self::emit_empty_run_if_any(app, empty_run);
            }
            AcpEvent::PermissionRequest {
                rpc_id,
                tool_call_id,
                tool_name,
                title,
                options,
                raw,
            } => {
                // During session/load replay, never surface a permission UI or
                // leave the agent blocked on a historical tool approval.
                let replay_acp = {
                    let guard = self.inner.lock();
                    guard.as_ref().and_then(|s| {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            s.acp.clone()
                        } else {
                            None
                        }
                    })
                };
                if let Some(acp) = replay_acp {
                    let option_id = pick_option_id(&options, "allow_once")
                        .or_else(|| pick_option_id(&options, "allow"))
                        .unwrap_or_else(|| "allow_once".into());
                    tracing::debug!(
                        "acp permission auto-resolved during load replay tool={tool_name}"
                    );
                    let _ = acp
                        .respond_permission(
                            rpc_id,
                            PermissionOutcome::Selected { option_id },
                        )
                        .await;
                    return;
                }

                let preview = raw.to_string();
                let path_target = extract_path_target(&raw);
                let shell_command = extract_shell_command(&raw);
                let sk_source = if path_target.is_empty() {
                    title.clone()
                } else {
                    path_target.clone()
                };
                let sk = scope_key(&tool_name, &sk_source);
                let (auto, auto_deny, session_id, project_path) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        Self::touch_activity_locked(s);
                        let _ = s.fsm.await_permission();
                        // Use live session policy (updated by chip / settings_set / set_policy).
                        // Do NOT re-read only global settings — project/session scope would break.
                        let root = s
                            .project_path
                            .as_ref()
                            .map(std::path::PathBuf::from);
                        let auto = may_auto_allow(
                            s.policy,
                            &s.allow_cache,
                            &sk,
                            root.as_deref(),
                            &path_target,
                            &tool_name,
                            &shell_command,
                        );
                        let auto_deny = !auto && may_auto_deny(s.policy);
                        (
                            auto,
                            auto_deny,
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                        )
                    } else {
                        return;
                    }
                };
                let _ = project_path; // reserved for future UI badge
                if auto {
                    let acp = self.inner.lock().as_ref().and_then(|s| s.acp.clone());
                    if let Some(acp) = acp {
                        // Grok Build shell prompts use underscore optionIds (allow_once /
                        // allow_command_always / reject). Hyphenated ACP-style fallbacks
                        // are rejected as "unknown permission option".
                        let option_id = pick_option_id(&options, "allow_once")
                            .or_else(|| pick_option_id(&options, "allow_always"))
                            .or_else(|| pick_option_id(&options, "allow_command_always"))
                            .or_else(|| pick_option_id(&options, "always_allow_all_sessions"))
                            .or_else(|| pick_option_id(&options, "allow"))
                            .unwrap_or_else(|| "allow_once".into());
                        let _ = acp
                            .respond_permission(
                                rpc_id,
                                PermissionOutcome::Selected { option_id },
                            )
                            .await;
                        let empty = {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                if s.fsm.state() == SessionState::AwaitingPermission {
                                    let _ = s.fsm.permission_resolved_continue();
                                }
                                Self::try_finish_deferred_prompt_complete(s).flatten()
                            } else {
                                None
                            }
                        };
                        Self::emit_empty_run_if_any(app, empty);
                    }
                } else if auto_deny {
                    let acp = self.inner.lock().as_ref().and_then(|s| s.acp.clone());
                    if let Some(acp) = acp {
                        let option_id = pick_option_id(&options, "reject_once")
                            .or_else(|| pick_option_id(&options, "reject_always"))
                            .or_else(|| pick_option_id(&options, "reject"))
                            .or_else(|| pick_option_id(&options, "deny"))
                            .unwrap_or_else(|| "reject".into());
                        let _ = acp
                            .respond_permission(
                                rpc_id,
                                PermissionOutcome::Selected { option_id },
                            )
                            .await;
                        let empty = {
                            let mut guard = self.inner.lock();
                            if let Some(s) = guard.as_mut() {
                                if s.fsm.state() == SessionState::AwaitingPermission {
                                    let _ = s.fsm.permission_resolved_continue();
                                }
                                Self::try_finish_deferred_prompt_complete(s).flatten()
                            } else {
                                None
                            }
                        };
                        Self::emit_empty_run_if_any(app, empty);
                    }
                } else {
                    let req = UiPermissionRequest {
                        rpc_id,
                        session_id,
                        tool_call_id,
                        tool_name,
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options,
                    };
                    let _ = app.emit("session://permission", &req);
                    Self::emit_state(app, &self.snapshot());
                }
            }
            AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw,
            } => {
                // Replay guard (P0): session/load floods tool_call history.
                // UI journal is source of truth — do not re-emit, re-write journal,
                // or mutate open_tool_ids during resume.
                {
                    let guard = self.inner.lock();
                    if let Some(s) = guard.as_ref() {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "acp tool_call dropped: no prompt in flight (replay) id={tool_call_id} status={status}"
                            );
                            return;
                        }
                    } else {
                        return;
                    }
                }

                let media_path = if status == "completed" {
                    extract_generated_media_path(&raw).filter(|p| is_media_fs_path(p))
                } else {
                    None
                };

                let (detail, path_hint) = extract_tool_ui_fields(&raw);
                let path_out = media_path
                    .clone()
                    .or(path_hint)
                    .filter(|p| !p.is_empty());
                let (before_snip, after_snip) = extract_tool_content_snippets(&raw);

                if let Some(path) = media_path.as_ref() {
                    let att = attachment_from_path(path);
                    let (app_sid, mid) = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            Self::touch_stream_progress_locked(s);
                            if !s.stream_attachments.iter().any(|a| a.path == att.path) {
                                s.stream_attachments.push(att.clone());
                            }
                            (
                                s.app_session_id.clone(),
                                s.streaming_message_id.clone().unwrap_or_default(),
                            )
                        } else {
                            (String::new(), String::new())
                        }
                    };
                    // Keep event name for backward compat; used for image + video.
                    let _ = app.emit(
                        "session://generated_image",
                        serde_json::json!({
                            "sessionId": app_sid,
                            "messageId": mid,
                            "path": att.path,
                            "name": att.name,
                            "toolCallId": tool_call_id,
                            "kind": if is_video_fs_path(path) { "video" } else { "image" },
                        }),
                    );
                }

                let (app_sid, empty_run) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Tool events count as progress so long tools never false-stall (I06).
                        Self::touch_stream_progress_locked(s);
                        if !tool_call_id.is_empty() {
                            if is_terminal_tool_status(&status) {
                                s.open_tool_ids.remove(&tool_call_id);
                                s.open_tool_seen_at.remove(&tool_call_id);
                            } else {
                                s.open_tool_ids.insert(tool_call_id.clone());
                                s.open_tool_seen_at
                                    .insert(tool_call_id.clone(), Instant::now());
                            }
                        }
                        s.tools_this_turn = s.tools_this_turn.saturating_add(1);
                        // Tools settled → apply deferred prompt_complete if any (#52).
                        let empty = Self::try_finish_deferred_prompt_complete(s).flatten();
                        (s.app_session_id.clone(), empty)
                    } else {
                        (String::new(), None)
                    }
                };
                Self::emit_empty_run_if_any(app, empty_run);

                // Live tool activity for UI — prefer human call text over bare "tool".
                let live_title = if !title.is_empty() && title.to_ascii_lowercase() != "tool" {
                    title.clone()
                } else if let Some(ref d) = detail {
                    d.clone()
                } else if let Some(ref p) = path_out {
                    p.clone()
                } else if !kind.is_empty() && kind.to_ascii_lowercase() != "tool" {
                    kind.replace('_', " ")
                } else {
                    String::new()
                };
                let _ = app.emit(
                    "session://tool",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "title": live_title,
                        "kind": kind,
                        "status": if status.is_empty() { "in_progress" } else { &status },
                        "path": path_out,
                        "detail": detail,
                        // Optional content snippets for the session Changes / diff panel.
                        "before": before_snip,
                        "after": after_snip,
                    }),
                );

                // Persist completed/failed tool steps so reload still shows work trail.
                let st = if status.is_empty() {
                    "in_progress"
                } else {
                    status.as_str()
                };
                if matches!(st, "completed" | "failed" | "error" | "cancelled")
                    && !app_sid.is_empty()
                    && !tool_call_id.is_empty()
                {
                    let label = if !title.is_empty() {
                        title.clone()
                    } else if !kind.is_empty() {
                        kind.clone()
                    } else {
                        "tool".into()
                    };
                    let mut content = format!("tool_step|{st}|{kind}|{label}");
                    if let Some(ref d) = detail {
                        content.push('\n');
                        content.push_str(&d.chars().take(400).collect::<String>());
                    }
                    if let Some(ref p) = path_out {
                        content.push('\n');
                        content.push_str(p);
                    }
                    let mid = format!("tool-{tool_call_id}");
                    // Upsert: replace prior journal row with same id if any.
                    let mut msgs = store::load_messages(&app_sid);
                    if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
                        slot.content = content.clone();
                        slot.marker = Some("tool_step".into());
                        let _ = store::save_messages(&app_sid, &msgs);
                    } else {
                        let _ = store::append_message(
                            &app_sid,
                            ChatMessageStored {
                                id: mid,
                                role: "tool".into(),
                                content,
                                thought: None,
                                created_at: chrono::Utc::now(),
                                is_error: matches!(st, "failed" | "error"),
                                attachments: None,
                                marker: Some("tool_step".into()),
                            },
                        );
                    }
                }
            }
            AcpEvent::Plan {
                entries,
                body,
                rpc_id,
                tool_call_id,
            } => {
                let app_sid = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "acp plan dropped: no prompt in flight (replay)"
                            );
                            return;
                        }
                        if let Some(id) = rpc_id {
                            s.pending_plan_rpc_id = Some(id);
                        }
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
                let _ = app.emit(
                    "session://plan",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "entries": entries,
                        "body": body,
                        "rpcId": rpc_id,
                        "toolCallId": tool_call_id,
                        "waiting": rpc_id.is_none(),
                    }),
                );
            }
            AcpEvent::AskUserQuestion {
                rpc_id,
                tool_call_id,
                questions,
                raw: _,
            } => {
                let app_sid = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "acp ask_user dropped: no prompt in flight (replay)"
                            );
                            return;
                        }
                        s.pending_ask_user_rpc_id = Some(rpc_id);
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
                let _ = app.emit(
                    "session://ask_user",
                    serde_json::json!({
                        "rpcId": rpc_id,
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "questions": questions,
                    }),
                );
            }
            AcpEvent::Error { error } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if !s.provider_retry_aborted {
                            Self::record_turn_error(s, app, &error);
                        }
                        let _ = s.fsm.fail_with(error);
                    }
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::ProcessExited { .. } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let st = s.fsm.state();
                        if matches!(
                            st,
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            // I04: flush partial assistant before cancel marker.
                            Self::maybe_flush_stream_journal(s, true, false);
                            let mid = Uuid::new_v4().to_string();
                            let content = "turn_cancelled|agent_exit".to_string();
                            let _ = store::append_message(
                                &s.app_session_id,
                                ChatMessageStored {
                                    id: mid.clone(),
                                    role: "tool".into(),
                                    content: content.clone(),
                                    thought: None,
                                    created_at: chrono::Utc::now(),
                                    is_error: true,
                                    attachments: None,
                                    marker: Some("turn_cancelled".into()),
                                },
                            );
                            let _ = app.emit(
                                "session://turn_marker",
                                serde_json::json!({
                                    "sessionId": s.app_session_id,
                                    "messageId": mid,
                                    "marker": "turn_cancelled",
                                    "reason": "agent_exit",
                                    "content": content,
                                }),
                            );
                        }
                        // During Connecting, leave error to initialize/connect_failed
                        // (fail_all_pending already surfaces a richer stderr-backed message).
                        let has_err = s.fsm.last_error().is_some();
                        if !has_err
                            && matches!(
                                st,
                                SessionState::Ready
                                    | SessionState::Streaming
                                    | SessionState::AwaitingPermission
                            )
                        {
                            let _ = s.fsm.crash("Agent process exited");
                        }
                        s.acp = None;
                        s.open_tool_ids.clear();
                        s.deferred_prompt_complete = None;
                        s.streaming_message_id = None;
                        s.active_turn_id = None;
                        s.stream_message_id_locked = false;
                        s.prompt_in_flight = false;
                    }
                }
                // Also drop any parked entry with this process id (defensive).
                self.parked
                    .lock()
                    .retain(|_, p| p.process_id != process_id);
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::State {
                backend,
                agent_session_id,
                model_id,
            } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        s.backend = backend;
                        if let Some(id) = agent_session_id {
                            s.meta.agent_session_id = Some(id);
                        }
                        if model_id.is_some() {
                            s.model_id = model_id;
                        }
                    }
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::Stderr { line } => {
                // Always land agent stderr in the diagnostic log (post-mortem).
                tracing::warn!(target: "acp_stderr", "{line}");
                let _ = app.emit("session://stderr", serde_json::json!({ "line": line }));
            }
            AcpEvent::RetryState {
                attempt,
                max_retries,
                reason,
                status,
            } => {
                let cap = max_retries.min(HOST_PROVIDER_MAX_RETRIES).max(1);
                let abort = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        s.provider_retry_attempt = attempt;
                        if s.provider_retry_aborted {
                            false
                        } else {
                            should_abort_provider_retry(attempt, max_retries, &status)
                        }
                    } else {
                        false
                    }
                };

                let _ = app.emit(
                    "session://retry",
                    serde_json::json!({
                        "attempt": attempt,
                        "maxRetries": cap,
                        "reason": reason,
                        "status": status,
                        "aborting": abort,
                    }),
                );

                if abort {
                    let acp = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            if s.provider_retry_aborted {
                                None
                            } else {
                                s.provider_retry_aborted = true;
                                let msg = if reason.trim().is_empty() {
                                    format!(
                                        "Provider request failed after {cap} retries (attempt {attempt})"
                                    )
                                } else {
                                    format!(
                                        "Provider request failed after {cap} retries (attempt {attempt}): {reason}"
                                    )
                                };
                                let err = AgentError::new(AgentErrorCode::NetworkProvider, msg);
                                // Chat-visible error row (must happen before clearing stream ids)
                                Self::record_turn_error(s, app, &err);
                                let _ = s.fsm.fail_with(err);
                                s.acp.clone()
                            }
                        } else {
                            None
                        }
                    };
                    if let Some(acp) = acp {
                        let abort_msg = format!(
                            "provider retries exhausted (host cap {HOST_PROVIDER_MAX_RETRIES})"
                        );
                        acp.abort_pending_prompts(&abort_msg);
                        let _ = acp.cancel().await;
                    }
                    Self::emit_state(app, &self.snapshot());
                }
            }
            AcpEvent::ContextCompact {
                trigger,
                tokens_before,
                tokens_after,
                summary_preview,
                note,
            } => {
                let (app_sid, content) = {
                    let guard = self.inner.lock();
                    let Some(s) = guard.as_ref() else {
                        return;
                    };
                    // Compact markers during load/replay would spam the journal.
                    if Self::is_session_load_replay(s.prompt_in_flight) {
                        tracing::debug!(
                            "acp context_compact dropped: no prompt in flight (replay)"
                        );
                        return;
                    }
                    let mut parts = Vec::new();
                    if trigger == "manual" {
                        parts.push("manual".to_string());
                    } else {
                        parts.push("auto".to_string());
                    }
                    if let (Some(b), Some(a)) = (tokens_before, tokens_after) {
                        parts.push(format!("tokens:{b}->{a}"));
                    } else if let Some(b) = tokens_before {
                        parts.push(format!("tokens_before:{b}"));
                    } else if let Some(a) = tokens_after {
                        parts.push(format!("tokens_after:{a}"));
                    }
                    if let Some(n) = note.as_ref().filter(|s| !s.is_empty()) {
                        parts.push(format!("note:{n}"));
                    }
                    // Machine-readable line for UI; human copy is i18n on frontend.
                    let mut content = format!("context_compact|{}", parts.join("|"));
                    if let Some(sum) = summary_preview
                        .as_ref()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                    {
                        content.push('\n');
                        content.push_str(sum);
                    }
                    (s.app_session_id.clone(), content)
                };
                let mid = Uuid::new_v4().to_string();
                let _ = store::append_message(
                    &app_sid,
                    ChatMessageStored {
                        id: mid.clone(),
                        role: "tool".into(),
                        content: content.clone(),
                        thought: None,
                        created_at: chrono::Utc::now(),
                        is_error: false,
                        attachments: None,
                        marker: Some("context_compact".into()),
                    },
                );
                let _ = app.emit(
                    "session://context_compact",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "messageId": mid,
                        "trigger": trigger,
                        "tokensBefore": tokens_before,
                        "tokensAfter": tokens_after,
                        "summaryPreview": summary_preview,
                        "note": note,
                        "content": content,
                    }),
                );
            }
            AcpEvent::UsageReported {
                total_tokens,
                input_tokens,
                output_tokens,
                source,
            } => {
                let app_sid = {
                    let guard = self.inner.lock();
                    let Some(s) = guard.as_ref() else {
                        return;
                    };
                    if Self::is_session_load_replay(s.prompt_in_flight) {
                        return;
                    }
                    s.app_session_id.clone()
                };
                let _ = app.emit(
                    "session://usage",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "totalTokens": total_tokens,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "source": source,
                    }),
                );
            }
        }
    }

    /// Apply ACP events for a session demoted to background (still streaming).
    /// Emits the same `session://*` events with that session's id so the UI can
    /// update caches without focus, and permissions are not applied to the wrong chat.
    async fn handle_acp_event_on_background(
        self: &Arc<Self>,
        app: &AppHandle,
        app_session_id: &str,
        ev: AcpEvent,
    ) {
        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                let need_schedule = {
                    let mut bg = self.background.lock();
                    let Some(s) = bg.get_mut(app_session_id) else {
                        return;
                    };
                    // Same rule as the live path: gate on `prompt_in_flight`,
                    // never on the FSM (early prompt_complete + more text).
                    //
                    // A background chat never runs `session/load` — a drop here
                    // after the RPC resolved is a real lost chunk and must leave
                    // a trace.
                    if Self::is_session_load_replay(s.prompt_in_flight) {
                        tracing::warn!(
                            "background stream chunk dropped after turn close sid={} fsm={:?} len={}",
                            app_session_id,
                            s.fsm.state(),
                            text.len()
                        );
                        return;
                    }
                    if s.fsm.state() == SessionState::Ready {
                        let _ = s.fsm.begin_stream();
                    }
                    Self::touch_stream_progress_locked(s);
                    Self::ensure_stream_message_id(s, kind, message_id);
                    let thought_phase = match kind {
                        StreamKind::Thought => {
                            let phase = if s.stream_last_was_assistant {
                                if !s.stream_thought.is_empty() {
                                    s.stream_thought.push_str("\n\n⟪phase⟫\n\n");
                                }
                                s.stream_last_was_assistant = false;
                                "new"
                            } else if s.stream_thought.is_empty() {
                                "open"
                            } else {
                                "continue"
                            };
                            s.stream_thought.push_str(&text);
                            phase
                        }
                        StreamKind::Assistant => {
                            s.stream_buf.push_str(&text);
                            // Only real body text flips the phase boundary.
                            if !text.trim().is_empty() {
                                s.stream_last_was_assistant = true;
                                s.saw_model_output = true;
                            }
                            "none"
                        }
                    };
                    let para = is_paragraph_break(&text);
                    Self::maybe_flush_stream_journal(s, done, para);
                    let mid = s.streaming_message_id.clone().unwrap_or_default();
                    let need = Self::queue_stream_emit(
                        s,
                        app,
                        kind,
                        mid,
                        text,
                        thought_phase,
                        done,
                    );
                    if need {
                        s.stream_emit_flush_gen =
                            s.stream_emit_flush_gen.wrapping_add(1);
                        Some((s.app_session_id.clone(), s.stream_emit_flush_gen))
                    } else {
                        None
                    }
                };
                if let Some((sid, gen)) = need_schedule {
                    self.schedule_stream_emit_flush(app.clone(), sid, gen);
                }
            }
            AcpEvent::PromptComplete {
                stop_reason,
                authoritative,
            } => {
                let finished = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::flush_pending_stream_emit(s, app);
                        Self::touch_stream_progress_locked(s);
                        if authoritative {
                            s.prompt_in_flight = false;
                        }
                        s.deferred_prompt_complete = Some(stop_reason.clone());
                        // Keep turn open while tools still running (long find / subagent).
                        match Self::try_finish_deferred_prompt_complete(s) {
                            None => {
                                tracing::info!(
                                    "background prompt_complete deferred sid={} tools={}",
                                    app_session_id,
                                    s.open_tool_ids.len()
                                );
                                false
                            }
                            Some(_) => true,
                        }
                    } else {
                        false
                    }
                };
                if finished {
                    self.promote_background_ready_to_parked(app_session_id);
                    Self::emit_runtime(
                        app,
                        &SessionSnapshot {
                            session_id: Some(app_session_id.to_string()),
                            agent_session_id: None,
                            state: SessionState::Ready,
                            last_error: None,
                            streaming_message_id: None,
                            backend: Self::backend_name(),
                            model_id: None,
                            project_path: None,
                            title: String::new(),
                        },
                    );
                } else {
                    // Still busy in background — keep liveMap streaming.
                    Self::emit_runtime(
                        app,
                        &SessionSnapshot {
                            session_id: Some(app_session_id.to_string()),
                            agent_session_id: None,
                            state: SessionState::Streaming,
                            last_error: None,
                            streaming_message_id: None,
                            backend: Self::backend_name(),
                            model_id: None,
                            project_path: None,
                            title: String::new(),
                        },
                    );
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::PermissionRequest {
                rpc_id,
                tool_call_id,
                tool_name,
                title,
                options,
                raw,
            } => {
                let preview = raw.to_string();
                let path_target = extract_path_target(&raw);
                let shell_command = extract_shell_command(&raw);
                let sk_source = if path_target.is_empty() {
                    title.clone()
                } else {
                    path_target.clone()
                };
                let sk = scope_key(&tool_name, &sk_source);
                let (auto, auto_deny, session_id, project_path, acp) = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::touch_activity_locked(s);
                        let _ = s.fsm.await_permission();
                        let root = s.project_path.as_ref().map(std::path::PathBuf::from);
                        let auto = may_auto_allow(
                            s.policy,
                            &s.allow_cache,
                            &sk,
                            root.as_deref(),
                            &path_target,
                            &tool_name,
                            &shell_command,
                        );
                        let auto_deny = may_auto_deny(s.policy) && !auto;
                        (
                            auto,
                            auto_deny,
                            s.app_session_id.clone(),
                            s.project_path.clone(),
                            s.acp.clone(),
                        )
                    } else {
                        return;
                    }
                };
                let _ = project_path;
                if auto {
                    if let Some(acp) = acp {
                        let option_id = pick_option_id(&options, "allow_once")
                            .or_else(|| pick_option_id(&options, "allow"))
                            .unwrap_or_else(|| "allow_once".into());
                        let _ = acp
                            .respond_permission(
                                rpc_id,
                                PermissionOutcome::Selected { option_id },
                            )
                            .await;
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
                    }
                } else if auto_deny {
                    if let Some(acp) = acp {
                        let option_id = pick_option_id(&options, "reject_once")
                            .or_else(|| pick_option_id(&options, "reject"))
                            .unwrap_or_else(|| "reject".into());
                        let _ = acp
                            .respond_permission(
                                rpc_id,
                                PermissionOutcome::Selected { option_id },
                            )
                            .await;
                        let mut bg = self.background.lock();
                        if let Some(s) = bg.get_mut(app_session_id) {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
                    }
                } else {
                    let req = UiPermissionRequest {
                        rpc_id,
                        session_id: session_id.clone(),
                        tool_call_id,
                        tool_name,
                        title,
                        preview: preview.chars().take(2000).collect(),
                        scope_key: sk,
                        options,
                    };
                    let _ = app.emit("session://permission", &req);
                    // Tell UI this permission belongs to a non-focused session.
                    let _ = app.emit(
                        "session://background_permission",
                        serde_json::json!({ "sessionId": session_id }),
                    );
                }
                // Runtime for *this* session, not the live slot: the sidebar
                // must show which chat is waiting (or resumed), otherwise a
                // demoted turn looks idle while it blocks on approval.
                let bg_snap = self
                    .background
                    .lock()
                    .get(app_session_id)
                    .map(Self::snapshot_from_live);
                if let Some(snap) = bg_snap {
                    Self::emit_runtime(app, &snap);
                }
            }
            AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw: _,
            } => {
                let (app_sid, live_title, st, finished) = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        // Defensive: background turns never load-replay, but if
                        // prompt_in_flight is already false, do not mutate journal.
                        if Self::is_session_load_replay(s.prompt_in_flight) {
                            tracing::debug!(
                                "background tool_call dropped after turn close sid={} id={tool_call_id}",
                                app_session_id
                            );
                            return;
                        }
                        Self::touch_stream_progress_locked(s);
                        if !tool_call_id.is_empty() {
                            if is_terminal_tool_status(&status) {
                                s.open_tool_ids.remove(&tool_call_id);
                                s.open_tool_seen_at.remove(&tool_call_id);
                            } else {
                                s.open_tool_ids.insert(tool_call_id.clone());
                                s.open_tool_seen_at
                                    .insert(tool_call_id.clone(), Instant::now());
                            }
                        }
                        s.tools_this_turn = s.tools_this_turn.saturating_add(1);
                        let finished =
                            matches!(Self::try_finish_deferred_prompt_complete(s), Some(_));
                        let live_title = if !title.is_empty() {
                            title.clone()
                        } else if !kind.is_empty() {
                            kind.clone()
                        } else {
                            "tool".into()
                        };
                        let st = if status.is_empty() {
                            "in_progress".to_string()
                        } else {
                            status.clone()
                        };
                        // Persist tool_step like live path so journal survives switch.
                        if matches!(
                            st.as_str(),
                            "completed" | "failed" | "error" | "cancelled"
                        ) && !tool_call_id.is_empty()
                        {
                            let content =
                                format!("tool_step|{st}|{kind}|{live_title}");
                            let mid = format!("tool-{tool_call_id}");
                            let mut msgs = store::load_messages(&s.app_session_id);
                            if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
                                slot.content = content.clone();
                                slot.marker = Some("tool_step".into());
                                let _ = store::save_messages(&s.app_session_id, &msgs);
                            } else {
                                let _ = store::append_message(
                                    &s.app_session_id,
                                    ChatMessageStored {
                                        id: mid,
                                        role: "tool".into(),
                                        content,
                                        thought: None,
                                        created_at: chrono::Utc::now(),
                                        is_error: matches!(st.as_str(), "failed" | "error"),
                                        attachments: None,
                                        marker: Some("tool_step".into()),
                                    },
                                );
                            }
                        }
                        (s.app_session_id.clone(), live_title, st, finished)
                    } else {
                        return;
                    }
                };
                let _ = app.emit(
                    "session://tool",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "title": live_title,
                        "kind": kind,
                        "status": st,
                    }),
                );
                if finished {
                    self.promote_background_ready_to_parked(app_session_id);
                    Self::emit_runtime(
                        app,
                        &SessionSnapshot {
                            session_id: Some(app_session_id.to_string()),
                            agent_session_id: None,
                            state: SessionState::Ready,
                            last_error: None,
                            streaming_message_id: None,
                            backend: Self::backend_name(),
                            model_id: None,
                            project_path: None,
                            title: String::new(),
                        },
                    );
                }
            }
            AcpEvent::ProcessExited { .. } => {
                let mut bg = self.background.lock();
                if let Some(mut s) = bg.remove(app_session_id) {
                    let busy = Self::live_session_is_busy(&s)
                        || matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        );
                    if busy {
                        Self::maybe_flush_stream_journal(&mut s, true, false);
                        let mid = Uuid::new_v4().to_string();
                        let content = "turn_cancelled|agent_exit".to_string();
                        let _ = store::append_message(
                            &s.app_session_id,
                            ChatMessageStored {
                                id: mid.clone(),
                                role: "tool".into(),
                                content: content.clone(),
                                thought: None,
                                created_at: chrono::Utc::now(),
                                is_error: true,
                                attachments: None,
                                marker: Some("turn_cancelled".into()),
                            },
                        );
                        let _ = app.emit(
                            "session://turn_marker",
                            serde_json::json!({
                                "sessionId": s.app_session_id,
                                "messageId": mid,
                                "marker": "turn_cancelled",
                                "reason": "agent_exit",
                                "content": content,
                            }),
                        );
                        tracing::warn!(
                            "background agent process exited mid-turn sid={}",
                            s.app_session_id
                        );
                    }
                    let _ = s.fsm.crash("Agent process exited (background)");
                    s.acp = None;
                    s.open_tool_ids.clear();
                    s.streaming_message_id = None;
                    s.active_turn_id = None;
                    s.stream_message_id_locked = false;
                    s.deferred_prompt_complete = None;
                    s.prompt_in_flight = false;
                    let mut snap = Self::snapshot_from_live(&s);
                    snap.state = SessionState::Disconnected;
                    Self::emit_runtime(app, &snap);
                }
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::Error { error } => {
                {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::record_turn_error(s, app, &error);
                        let _ = s.fsm.fail_with(error);
                    }
                }
                self.promote_background_ready_to_parked(app_session_id);
                Self::emit_state(app, &self.snapshot());
            }
            AcpEvent::UsageReported {
                total_tokens,
                input_tokens,
                output_tokens,
                source,
            } => {
                let _ = app.emit(
                    "session://usage",
                    serde_json::json!({
                        "sessionId": app_session_id,
                        "totalTokens": total_tokens,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "source": source,
                    }),
                );
            }
            _ => {
                // ask_user / plan / stderr / retry — still forward with session id when possible
                tracing::debug!("background acp event ignored variant for sid={app_session_id}");
            }
        }
    }

    /// Drop the last user turn (and everything after) on the agent + local journal.
    /// Used before re-sending an edited last user message so the previous assistant
    /// reply is replaced, not stacked.
    ///
    /// Agent path: `x.ai/rewind/execute` (Grok Build extension).
    /// Local path: truncate `messages.json` to keep only messages before the last user row.
    /// Drop the last user turn before an edit-resend.
    ///
    /// `session_id` guards against a concurrent connect moving the live slot
    /// between the caller's connect and this call — truncating the wrong chat's
    /// journal is unrecoverable, so a mismatch errors instead of guessing.
    pub async fn rewind_drop_last_user_turn(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let (backend, app_sid, acp, user_prompt_count) = {
            let guard = self.inner.lock();
            let s = guard.as_ref().ok_or("no active session")?;
            if let Some(target) = session_id.as_deref() {
                if s.app_session_id != target {
                    return Err(format!(
                        "{}: chat {target} is not focused — reconnect and retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
            }
            if s.fsm.state() == SessionState::Streaming
                || s.fsm.state() == SessionState::AwaitingPermission
            {
                return Err("cannot edit while a turn is running".into());
            }
            let msgs = store::load_messages(&s.app_session_id);
            let user_prompt_count = msgs.iter().filter(|m| m.role == "user").count() as u32;
            if user_prompt_count == 0 {
                return Err("no user message to rewind".into());
            }
            (
                s.backend.clone(),
                s.app_session_id.clone(),
                s.acp.clone(),
                user_prompt_count,
            )
        };

        // Agent: discard last user turn. TUI semantics keep the selected turn and drop after;
        // so for "drop last user" we target the previous turn when count > 1.
        // When count == 1, execute target 0 with best-effort; host journal is the source of truth for UI.
        if backend != "mock_acp" && !AcpClient::use_mock() {
            if let Some(client) = acp {
                let target = user_prompt_count.saturating_sub(1);
                // Prefer rewinding to previous turn (keep 0..n-2, drop n-1..).
                // When only one user turn: try target 0 then clear local journal fully.
                let exec_index = if user_prompt_count <= 1 {
                    0u32
                } else {
                    // Keep through previous user turn → drop last.
                    user_prompt_count - 2
                };
                match client.rewind_execute(exec_index, false).await {
                    Ok(_) => {
                        tracing::info!(
                            target: "session",
                            "rewind_drop_last_user_turn: agent rewound target={exec_index} (user_turns={user_prompt_count})"
                        );
                    }
                    Err(e) => {
                        // Fallback: try targeting the last turn itself (some builds discard at/after index).
                        tracing::warn!(
                            target: "session",
                            error = %e,
                            "rewind_execute({exec_index}) failed; trying last-turn index {target}"
                        );
                        if let Err(e2) = client.rewind_execute(target, false).await {
                            tracing::warn!(
                                target: "session",
                                error = %e2,
                                "agent rewind failed; local journal still truncated"
                            );
                        }
                    }
                }
            }
        }

        // Local journal: keep messages strictly before the last user message.
        let msgs = store::load_messages(&app_sid);
        let mut cut = msgs.len();
        for (i, m) in msgs.iter().enumerate().rev() {
            if m.role == "user" {
                cut = i;
                break;
            }
        }
        let kept: Vec<_> = msgs.into_iter().take(cut).collect();
        store::save_messages(&app_sid, &kept)?;

        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                s.meta.updated_at = chrono::Utc::now();
                let _ = store::update_session_meta(&s.meta);
            }
        }
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
    }

    /// List rewind points for an app session journal (one per user prompt).
    /// Prefer the local journal so the UI timeline always matches what the user sees.
    pub fn list_rewind_points(&self, session_id: Option<String>) -> Result<Vec<RewindPointDto>, String> {
        let app_sid = match session_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                s.app_session_id.clone()
            }
        };
        // Ensure session exists in the index (or at least has a journal dir).
        let known = store::load_sessions_index()
            .iter()
            .any(|s| s.id == app_sid);
        if !known && store::load_messages(&app_sid).is_empty() {
            return Err(format!("session not found: {app_sid}"));
        }
        Ok(Self::rewind_points_from_journal(&app_sid))
    }

    fn rewind_points_from_journal(app_sid: &str) -> Vec<RewindPointDto> {
        let msgs = store::load_messages(app_sid);
        let mut out = Vec::new();
        let mut idx = 0u32;
        for m in msgs {
            if m.role != "user" {
                continue;
            }
            let raw = m.content.split_whitespace().collect::<Vec<_>>().join(" ");
            let preview = if raw.chars().count() > 80 {
                let truncated: String = raw.chars().take(79).collect();
                format!("{truncated}…")
            } else if raw.is_empty() {
                "…".into()
            } else {
                raw
            };
            out.push(RewindPointDto {
                prompt_index: idx,
                message_id: Some(m.id),
                preview,
            });
            idx = idx.saturating_add(1);
        }
        out
    }

    /// Rewind a session to a user-prompt index (keep that turn, drop after).
    /// Always truncates the local journal. Agent `x.ai/rewind/execute` is best-effort
    /// when this session is the live ACP session.
    pub async fn rewind_to_prompt_index(
        self: &Arc<Self>,
        app: AppHandle,
        target_prompt_index: u32,
        restore_files: bool,
        session_id: Option<String>,
    ) -> Result<RewindExecuteResult, String> {
        let app_sid = match session_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                s.app_session_id.clone()
            }
        };

        // Block if *this* session is mid-turn on the live host.
        let (live_match, backend, acp, busy) = {
            let guard = self.inner.lock();
            match guard.as_ref() {
                Some(s) if s.app_session_id == app_sid => {
                    let busy = s.fsm.state() == SessionState::Streaming
                        || s.fsm.state() == SessionState::AwaitingPermission;
                    (true, s.backend.clone(), s.acp.clone(), busy)
                }
                _ => (false, String::new(), None, false),
            }
        };
        if busy {
            return Err("cannot rewind while a turn is running".into());
        }

        let msgs = store::load_messages(&app_sid);
        let user_count = msgs.iter().filter(|m| m.role == "user").count() as u32;
        if user_count == 0 {
            return Err("no user messages to rewind".into());
        }
        if target_prompt_index >= user_count {
            return Err(format!(
                "user prompt index out of range: {target_prompt_index} (have {user_count})"
            ));
        }

        let mut agent_ok = true;
        let mut agent_error: Option<String> = None;

        // Agent path only when this is the live session with a real ACP client.
        if live_match && backend != "mock_acp" && !AcpClient::use_mock() {
            if let Some(client) = acp {
                match client
                    .rewind_execute(target_prompt_index, restore_files)
                    .await
                {
                    Ok(_) => {
                        tracing::info!(
                            target: "session",
                            "rewind_to_prompt_index: agent rewound target={target_prompt_index}"
                        );
                    }
                    Err(e) => {
                        agent_ok = false;
                        agent_error = Some(e.clone());
                        tracing::warn!(
                            target: "session",
                            error = %e,
                            "agent rewind failed; applying local journal truncate only"
                        );
                    }
                }
            } else {
                agent_ok = false;
                agent_error = Some("agent not connected".into());
            }
        } else if !live_match {
            agent_ok = false;
            agent_error = Some("session not live; local journal only".into());
        }

        let kept = store::truncate_through_user_prompt(&msgs, target_prompt_index)?;
        let kept_count = kept.len();
        store::save_messages(&app_sid, &kept)?;

        // Touch meta updated_at for index sort.
        if let Some(mut meta) = store::load_sessions_index()
            .into_iter()
            .find(|s| s.id == app_sid)
        {
            meta.updated_at = chrono::Utc::now();
            let _ = store::update_session_meta(&meta);
            if live_match {
                let mut guard = self.inner.lock();
                if let Some(s) = guard.as_mut() {
                    if s.app_session_id == app_sid {
                        s.meta.updated_at = meta.updated_at;
                    }
                }
            }
        }

        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(RewindExecuteResult {
            snapshot: snap,
            agent_ok,
            agent_error,
            local_ok: true,
            kept_count,
        })
    }

    /// Send one user turn.
    ///
    /// `session_id` names the chat the prompt belongs to. It is **not** optional
    /// in practice: without it the prompt lands on whatever happens to hold the
    /// live slot, and a concurrent connect (warm prefetch, sidebar switch,
    /// automation) between the caller's connect and this call routed turns into
    /// a foreign chat. When given, the target is focused first (promoted from
    /// `background` / unparked) under `connect_lock`; if it has no warm process
    /// the call fails with `CONNECT_FAILED` so the UI can reconnect and retry
    /// instead of silently writing into another session's journal.
    pub async fn send_message(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        display_text: Option<String>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty message".into());
        }
        // Journal stores UI form when provided (skill chips); agent still receives `text`.
        let journal_content = display_text
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| text.clone());

        // Serialize against connect for the whole focus + turn-open window, so
        // the slot cannot move between the target check and `begin_stream`.
        let _focus_guard = self.connect_lock.lock().await;
        if let Some(target) = session_id.as_deref() {
            if !self.is_live_session(target) {
                match self.focus_session(&app, target) {
                    Ok(true) => {}
                    Ok(false) => {
                        return Err(format!(
                            "{}: chat {target} has no live agent process — reconnect and retry",
                            AgentErrorCode::ConnectFailed.as_str()
                        ));
                    }
                    Err(e) => return Err(format!("{}: {}", e.code.as_str(), e.message)),
                }
            }
        }

        // If agent is a fresh session/new, wrap recent journal into the prompt once.
        let (backend, app_sid, acp, agent_prompt) = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no active session")?;
            if let Some(target) = session_id.as_deref() {
                if s.app_session_id != target {
                    return Err(format!(
                        "{}: chat {target} lost focus before send — retry",
                        AgentErrorCode::ConnectFailed.as_str()
                    ));
                }
            }
            // One prompt per chat at a time. The FSM alone is not enough: an
            // early prompt_complete Readies it while the agent is still working,
            // and a second `session/prompt` would then be dispatched into a busy
            // agent (the CLI rejects it as `task_already_running`).
            if s.prompt_in_flight {
                return Err(format!(
                    "{}: chat {} is still running its previous turn",
                    AgentErrorCode::ConnectFailed.as_str(),
                    s.app_session_id
                ));
            }
            s.fsm.begin_stream().map_err(|e| e.to_string())?;
            s.prompt_in_flight = true;
            Self::touch_stream_progress_locked(s);
            s.active_turn_id = Some(Uuid::new_v4().to_string());
            s.stream_message_id_locked = false;
            let mid = Uuid::new_v4().to_string();
            s.streaming_message_id = Some(mid.clone());
            s.stream_buf.clear();
            s.stream_thought.clear();
            s.stream_last_was_assistant = false;
            s.stream_attachments.clear();
            s.journal_throttle.reset();
            s.last_stall_emit = None;
            s.open_tool_ids.clear();
            s.open_tool_seen_at.clear();
            s.deferred_prompt_complete = None;
            s.stall_soft_emits = 0;
            s.saw_model_output = false;
            s.provider_retry_attempt = 0;
            s.provider_retry_aborted = false;
            s.tools_this_turn = 0;

            let mut agent_prompt = text.clone();
            if s.needs_history_bootstrap {
                if let Some(ctx) = build_history_bootstrap(&s.app_session_id) {
                    agent_prompt = format!("{ctx}\n{text}");
                    tracing::info!(
                        "history bootstrap attached ({} chars) for session {}",
                        ctx.len(),
                        s.app_session_id
                    );
                }
                s.needs_history_bootstrap = false;
            }
            // P2: steer session-by-UUID lookups to App/agent-home roots (avoid home-wide find).
            if let Some(hint) = session_lookup_host_hint(&text) {
                agent_prompt = format!("{hint}\n{agent_prompt}");
            }

            // persist user message (display form for skill chips on reload)
            // Journal stores the user-facing turn only — not the bootstrap wrapper.
            let _ = store::append_message(
                &s.app_session_id,
                ChatMessageStored {
                    id: Uuid::new_v4().to_string(),
                    role: "user".into(),
                    content: journal_content.clone(),
                    thought: None,
                    created_at: chrono::Utc::now(),
                    is_error: false,
                    attachments: None,
                    marker: None,
                },
            );
            (
                s.backend.clone(),
                s.app_session_id.clone(),
                s.acp.clone(),
                agent_prompt,
            )
        };
        Self::emit_state(&app, &self.snapshot());

        if backend == "mock_acp" || AcpClient::use_mock() {
            let message_id = self
                .inner
                .lock()
                .as_ref()
                .and_then(|s| s.streaming_message_id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let mgr = Arc::clone(self);
            let app_done = app.clone();
            let handle = mock_acp::spawn_fake_stream(
                app_sid,
                message_id,
                agent_prompt,
                Duration::from_millis(25),
                move |chunk: StreamChunk| {
                    let _ = app_done.emit(
                        "session://stream",
                        serde_json::json!({
                            "sessionId": chunk.session_id,
                            "messageId": chunk.message_id,
                            "text": chunk.text,
                            "done": chunk.done,
                            "kind": "assistant"
                        }),
                    );
                    let mut guard = mgr.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        SessionManager::touch_stream_progress_locked(s);
                        s.stream_buf.push_str(&chunk.text);
                        // I04: throttle mid-stream; force on terminal done.
                        let para = is_paragraph_break(&chunk.text);
                        SessionManager::maybe_flush_stream_journal(s, chunk.done, para);
                        if chunk.done {
                            s.stream_buf.clear();
                            s.journal_throttle.reset();
                            s.last_stall_emit = None;
                            // Mock backend has no `session/prompt` RPC — its
                            // terminal chunk is the authoritative completion.
                            s.prompt_in_flight = false;
                            if s.fsm.state() == SessionState::Streaming {
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
                                s.active_turn_id = None;
                                s.stream_message_id_locked = false;
                            }
                        }
                    }
                    drop(guard);
                    if chunk.done {
                        SessionManager::emit_state(&app_done, &mgr.snapshot());
                    }
                },
            );
            if let Some(s) = self.inner.lock().as_mut() {
                s.mock_stream = Some(handle);
            }
            return Ok(self.snapshot());
        }

        // Bail *after* the turn was opened → roll it back, or the chat is stuck
        // forever: `prompt_in_flight` blocks both parking and the next send.
        let Some(acp) = acp else {
            self.with_session_mut(&app_sid, |s| {
                s.prompt_in_flight = false;
                s.streaming_message_id = None;
                s.active_turn_id = None;
                s.stream_message_id_locked = false;
                if s.fsm.state() == SessionState::Streaming {
                    let _ = s.fsm.end_stream();
                }
            });
            Self::emit_state(&app, &self.snapshot());
            return Err("ACP client missing".into());
        };
        let mgr = Arc::clone(self);
        let app2 = app.clone();
        let turn_sid = app_sid.clone();
        tokio::spawn(async move {
            let outcome = acp.prompt(&agent_prompt).await;
            if let Err(e) = outcome {
                // Route by session id: this chat may have been demoted to
                // background while the prompt ran, and the live slot now holds
                // someone else's turn — recording the error there would blame
                // the wrong chat.
                mgr.with_session_mut(&turn_sid, |s| {
                    // The RPC failed, so no authoritative PromptComplete will
                    // arrive. Release the turn or the chat stays un-parkable
                    // and refuses further sends.
                    s.prompt_in_flight = false;
                    // Skip if host already recorded a retry-exhausted error this turn.
                    if !s.provider_retry_aborted {
                        SessionManager::record_turn_error(s, &app2, &e);
                        let _ = s.fsm.fail_with(e);
                    }
                });
                mgr.emit_for_session(&app2, &turn_sid);
            }
        });

        Ok(self.snapshot())
    }

    /// Stop the turn on `session_id` (defaults to the live focus slot).
    ///
    /// Targets background turns too: the user can watch a demoted chat and hit
    /// Stop there, which previously cancelled whichever chat held focus.

    /// Inject guidance into the currently streaming turn without cancelling it.
    ///
    /// `session_id` names the chat (live or background). Omitting it uses the
    /// focused live slot. Does **not** rewrite the follow-up send queue.
    pub async fn interject_message<R: tauri::Runtime>(
        &self,
        app: AppHandle<R>,
        text: String,
        display_text: Option<String>,
        attachments: Option<Vec<MessageAttachmentStored>>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("empty interjection".into());
        }
        let journal_content = display_text
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| text.clone());
        let attachments = attachments.filter(|items| !items.is_empty());
        let target = session_id.as_deref();

        let (backend, app_sid, turn_id, acp) = {
            if let Some(t) = target {
                let guard = self.inner.lock();
                if let Some(s) = guard.as_ref().filter(|s| s.app_session_id == t) {
                    Self::pick_interjection_target(s)?
                } else {
                    drop(guard);
                    let background = self.background.lock();
                    let s = background
                        .get(t)
                        .ok_or_else(|| format!("interjection: chat {t} is not active"))?;
                    Self::pick_interjection_target(s)?
                }
            } else {
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or("no active session")?;
                Self::pick_interjection_target(s)?
            }
        };

        if backend != "mock_acp" && !AcpClient::use_mock() {
            acp.ok_or("ACP client missing")?.interject(&text).await?;
        }

        let created_at = chrono::Utc::now();
        let message = ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role: "user".into(),
            content: journal_content,
            thought: None,
            created_at,
            is_error: false,
            attachments,
            marker: Some("interjection".into()),
        };

        // Session may move between live/background while the ACP RPC is in flight.
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == app_sid {
                    Self::commit_interjection_boundary(
                        s, &app, &message, &app_sid, &turn_id,
                    )?;
                    return Ok(self.snapshot());
                }
            }
        }
        {
            let mut background = self.background.lock();
            if let Some(s) = background.get_mut(&app_sid) {
                Self::commit_interjection_boundary(
                    s, &app, &message, &app_sid, &turn_id,
                )?;
                return Ok(self.snapshot());
            }
        }

        Err("interjection turn is no longer active".into())
    }

    pub async fn stop(
        self: &Arc<Self>,
        app: AppHandle,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = match session_id {
            Some(sid) => sid,
            None => self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone())
                .ok_or("no active session")?,
        };
        let app_for_marker = app.clone();
        let acp = self
            .with_session_mut(&target, move |s| {
                let app = app_for_marker;
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                let was_busy = s.fsm.state() == SessionState::Streaming
                    || s.fsm.state() == SessionState::AwaitingPermission
                    || s.streaming_message_id.is_some()
                    || !s.open_tool_ids.is_empty();
                let partial = s.stream_buf.trim().to_string();
                // Journal a cancel marker so UI history is not left as user-only silence.
                if was_busy {
                    // I04: force-flush partial assistant before cancel marker.
                    Self::maybe_flush_stream_journal(s, true, false);
                    let mid = Uuid::new_v4().to_string();
                    let content = if partial.is_empty() {
                        "turn_cancelled|user_stop".to_string()
                    } else {
                        format!(
                            "turn_cancelled|user_stop|partial:{}",
                            partial.chars().take(200).collect::<String>()
                        )
                    };
                    let _ = store::append_message(
                        &s.app_session_id,
                        ChatMessageStored {
                            id: mid.clone(),
                            role: "tool".into(),
                            content: content.clone(),
                            thought: None,
                            created_at: chrono::Utc::now(),
                            is_error: false,
                            attachments: None,
                            marker: Some("turn_cancelled".into()),
                        },
                    );
                    let _ = app.emit(
                        "session://turn_marker",
                        serde_json::json!({
                            "sessionId": s.app_session_id,
                            "messageId": mid,
                            "marker": "turn_cancelled",
                            "reason": "user_stop",
                            "content": content,
                        }),
                    );
                    if s.fsm.state() == SessionState::Streaming
                        || s.fsm.state() == SessionState::AwaitingPermission
                    {
                        let _ = s.fsm.end_stream();
                    }
                }
                s.streaming_message_id = None;
                s.active_turn_id = None;
                s.stream_message_id_locked = false;
                s.stream_buf.clear();
                s.stream_thought.clear();
                s.stream_last_was_assistant = false;
                s.stream_attachments.clear();
                s.open_tool_ids.clear();
                s.deferred_prompt_complete = None;
                // Cancelled: the prompt RPC resolves as cancelled, so release the
                // turn here too — otherwise the chat can never be parked again.
                s.prompt_in_flight = false;
                s.journal_throttle.reset();
                s.last_stall_emit = None;
                s.acp.clone()
            })
            .ok_or("no active session")?;
        if let Some(acp) = acp {
            let _ = acp.cancel().await;
        }
        // Stopped background turn is Ready again → park it warm.
        self.promote_background_ready_to_parked(&target);
        self.emit_for_session(&app, &target);
        Ok(self.snapshot())
    }

    /// Update live Host policy (in-memory). Prefer `apply_permission_policy` for full sync.
    pub fn set_permission_policy(&self, policy: PermissionPolicy) {
        if let Some(s) = self.inner.lock().as_mut() {
            s.policy = policy;
        }
    }

    /// Soft-drop live agent so next send re-spawns with new spawn flags / config.
    /// Keeps `agent_session_id` so reconnect can `session/load`; if load fails,
    /// journal bootstrap still fills the gap.
    ///
    /// **Never** kills a mid-turn live session (open tools / streaming). Callers
    /// that mutate MCP/prefs while busy should wait until Ready.
    /// Background busy sessions are left untouched.
    pub async fn soft_respawn(&self, app: &AppHandle) {
        self.soft_respawn_with_reason(app, "settings").await;
    }

    /// Soft-respawn and tell the UI why the agent process was reloaded.
    pub async fn soft_respawn_with_reason(&self, app: &AppHandle, reason: &str) {
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.acp.is_none() {
                    return;
                }
                if Self::live_session_is_busy(s) {
                    tracing::warn!(
                        "soft_respawn skipped: live session mid-turn sid={} state={:?}",
                        s.app_session_id,
                        s.fsm.state()
                    );
                    return;
                }
                let acp = s.acp.take();
                // Prefer resume on next connect; bootstrap only if load fails.
                s.needs_history_bootstrap = false;
                s.fsm.soft_disconnect();
                // New process gets a new id on next connect.
                s.process_id = String::new();
                acp
            } else {
                None
            }
        };
        if let Some(acp) = acp {
            acp.kill().await;
            let _ = app.emit(
                "session://agent_soft_respawn",
                serde_json::json!({ "reason": reason }),
            );
            Self::emit_state(app, &self.snapshot());
        }
    }

    /// Counts of tracked live shell / background / parked entries (alive or not).
    /// Used by diagnostics and unit tests — not the same as `active_process_count`.
    pub fn tracked_agent_map_counts(&self) -> (usize, usize, usize) {
        let live = self.inner.lock().is_some() as usize;
        let background = self.background.lock().len();
        let parked = self.parked.lock().len();
        (live, background, parked)
    }

    /// Drop every warm agent process (live + background + parked).
    ///
    /// Used when `session_data_mode` flips independent↔shared so no process keeps
    /// the previous `GROK_HOME`. App session meta + journals stay; live shell is
    /// soft-disconnected and its `agent_session_id` is cleared (old agent dirs are
    /// under a different data root — reconnect should `session/new` + bootstrap).
    /// Emits `session://agents_recycled` for UI toasts.
    pub async fn recycle_all_agents(&self, app: &AppHandle, reason: &str) {
        let drained = self.drain_all_agent_slots();
        let total = drained.acps.len();
        for acp in drained.acps {
            acp.kill().await;
        }
        tracing::info!(
            "recycle_all_agents reason={reason} killed={total} (live_shell={} bg={} parked={})",
            drained.had_live_shell as u8,
            drained.background_count,
            drained.parked_count
        );
        let _ = app.emit(
            "session://agents_recycled",
            serde_json::json!({
                "reason": reason,
                "killed": total,
                "background": drained.background_count,
                "parked": drained.parked_count,
            }),
        );
        Self::emit_state(app, &self.snapshot());
    }

    /// Take live ACP + all background/parked agents out of maps (no kill).
    /// Live shell stays (soft-disconnected, agent_session_id cleared when present).
    /// Background/parked maps are emptied.
    fn drain_all_agent_slots(&self) -> DrainedAgents {
        let mut acps: Vec<Arc<AcpClient>> = Vec::new();
        let mut had_live_shell = false;

        // Live
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                had_live_shell = true;
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                // Persist any in-flight assistant text before we drop the process.
                Self::maybe_flush_stream_journal(s, true, false);
                s.stream_buf.clear();
                s.stream_thought.clear();
                s.stream_last_was_assistant = false;
                s.stream_attachments.clear();
                s.journal_throttle.reset();
                s.streaming_message_id = None;
                s.active_turn_id = None;
                s.stream_message_id_locked = false;
                s.open_tool_ids.clear();
                s.deferred_prompt_complete = None;
                s.tools_this_turn = 0;
                s.pending_plan_rpc_id = None;
                s.pending_ask_user_rpc_id = None;
                s.provider_retry_attempt = 0;
                s.provider_retry_aborted = false;
                if let Some(acp) = s.acp.take() {
                    acps.push(acp);
                }
                s.fsm.soft_disconnect();
                s.process_id = String::new();
                // Old agent session lives under previous GROK_HOME — do not resume.
                if s.meta.agent_session_id.take().is_some() {
                    let _ = store::update_session_meta(&s.meta);
                }
                // Connect will set bootstrap from journal when session/new runs.
                s.needs_history_bootstrap = false;
            }
        }

        // Background busy streams
        let background: HashMap<String, LiveSession> = {
            let mut bg = self.background.lock();
            std::mem::take(&mut *bg)
        };
        let background_count = background.len();
        for (_, mut s) in background {
            if let Some(h) = s.mock_stream.take() {
                h.request_stop();
            }
            Self::maybe_flush_stream_journal(&mut s, true, false);
            if let Some(acp) = s.acp.take() {
                acps.push(acp);
            }
        }

        // Parked warm agents
        let parked: HashMap<String, ParkedAgent> = {
            let mut p = self.parked.lock();
            std::mem::take(&mut *p)
        };
        let parked_count = parked.len();
        for (_, p) in parked {
            acps.push(p.acp);
        }

        DrainedAgents {
            acps,
            had_live_shell,
            background_count,
            parked_count,
        }
    }

    /// Apply permission: Host policy + agent-home config + respawn when process flags change.
    pub async fn apply_permission_policy(
        &self,
        app: &AppHandle,
        policy_str: &str,
    ) -> Result<(), String> {
        let policy = PermissionPolicy::parse(policy_str);
        let settings = store::load_settings();
        let _ = crate::agent_prefs::sync_permission_to_agent_profile(
            &settings.session_data_mode,
            policy.as_str(),
        );

        let need_respawn = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let prev = s.policy;
                s.policy = policy;
                s.meta.permission_policy = Some(policy.as_str().into());
                let _ = store::update_session_meta(&s.meta);
                // Any policy change can affect agent-side enforcement / --always-approve.
                prev != policy && s.acp.is_some()
            } else {
                false
            }
        };
        if need_respawn {
            self.soft_respawn(app).await;
        }
        Ok(())
    }

    /// Apply model id on the live ACP session (best-effort session/set_model).
    pub async fn set_model(&self, model_id: String) -> Result<(), String> {
        let model_id = model_id.trim().to_string();
        if model_id.is_empty() {
            return Err("model id empty".into());
        }
        // Store composer preference; agent receives channel-resolved id.
        let agent_model = crate::providers::agent_spawn_model_id(&model_id);
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                s.model_id = Some(model_id.clone());
                s.meta.model_id = Some(model_id.clone());
                let _ = store::update_session_meta(&s.meta);
                s.acp.clone()
            } else {
                None
            }
        };
        if let Some(acp) = acp {
            acp.set_model(&agent_model).await?;
        }
        Ok(())
    }

    /// Apply product mode via session/set_mode; soft-respawn if agent rejects.
    pub async fn apply_product_mode(
        &self,
        app: &AppHandle,
        mode: String,
    ) -> Result<(), String> {
        let mode = mode.trim().to_ascii_lowercase();
        if !matches!(mode.as_str(), "agent" | "plan" | "ask") {
            return Err(format!("invalid mode: {mode}"));
        }
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let same = s.product_mode.as_deref() == Some(mode.as_str());
                s.product_mode = Some(mode.clone());
                s.meta.mode = Some(mode.clone());
                let _ = store::update_session_meta(&s.meta);
                if same {
                    None
                } else {
                    s.acp.clone()
                }
            } else {
                None
            }
        };
        if let Some(acp) = acp {
            if let Err(e) = acp.set_mode(&mode).await {
                tracing::warn!("set_mode failed, soft-respawn: {e}");
                self.soft_respawn(app).await;
            }
        }
        Ok(())
    }

    /// Soft-respawn when MCP enable prefs change so the next connect injects
    /// the updated `mcpServers` set (and agent-home config is re-read).
    pub async fn apply_extensions_mcp_change(&self, app: &AppHandle) {
        let live = {
            let guard = self.inner.lock();
            guard.as_ref().map(|s| s.acp.is_some()).unwrap_or(false)
        };
        if live {
            tracing::info!("extensions: MCP prefs changed — soft-respawn live agent");
            self.soft_respawn(app).await;
        }
    }

    /// Record desired effort. CLI has no mid-session set_effort RPC; soft-drop the
    /// live agent so the next connect re-spawns with `--reasoning-effort`.
    pub async fn set_effort_and_respawn_needed(
        &self,
        app: &AppHandle,
        effort: String,
    ) -> Result<(), String> {
        let effort = effort.trim().to_string();
        // Accept CLI catalog values; unknown efforts still fail closed with a clear error.
        let ok = matches!(
            effort.as_str(),
            "low" | "medium" | "high" | "xhigh" | "max" | "none"
        ) || (effort.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            && (2..=32).contains(&effort.len()));
        if !ok {
            return Err(format!("invalid effort: {effort}"));
        }
        let need = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let same = s.effort.as_deref() == Some(effort.as_str());
                s.effort = Some(effort.clone());
                s.meta.effort = Some(effort);
                let _ = store::update_session_meta(&s.meta);
                !same && s.acp.is_some()
            } else {
                false
            }
        };
        if need {
            self.soft_respawn(app).await;
        }
        Ok(())
    }

    pub fn current_context_ids(&self) -> (Option<String>, Option<String>) {
        let guard = self.inner.lock();
        match guard.as_ref() {
            Some(s) => (s.meta.project_id.clone(), Some(s.app_session_id.clone())),
            None => (None, None),
        }
    }

    /// Answer a pending tool permission for `session_id` (defaults to live).
    ///
    /// `session_id` comes from `session://permission`; background turns raise
    /// permissions too (`session://background_permission`), and their rpc id
    /// belongs to *their* ACP child. Resolving against the live slot dropped the
    /// answer on the wrong process and left the background turn stuck forever.
    pub async fn resolve_permission(
        self: &Arc<Self>,
        app: AppHandle,
        rpc_id: u64,
        decision: String,
        option_id: Option<String>,
        scope: Option<String>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = self.resolve_target_session(session_id)?;
        let (acp, empty_run) = self
            .with_session_mut(&target, |s| {
                Self::touch_activity_locked(s);
                // "allow_session" decision caches scope_key for H05 (works under Ask chip too)
                if decision == "allow_session" || decision == "allow_for_session" {
                    if let Some(sk) = scope {
                        s.allow_cache.allow(sk);
                    }
                }
                if s.fsm.state() == SessionState::AwaitingPermission {
                    let _ = s.fsm.permission_resolved_continue();
                }
                // Permission cleared — may finish a deferred prompt_complete (#52).
                let empty = Self::try_finish_deferred_prompt_complete(s).flatten();
                (s.acp.clone(), empty)
            })
            .ok_or("no session")?;

        if let Some(acp) = acp {
            let outcome = match decision.as_str() {
                "cancel" => PermissionOutcome::Cancelled,
                "deny" => PermissionOutcome::Selected {
                    option_id: option_id.unwrap_or_else(|| "reject".into()),
                },
                _ => PermissionOutcome::Selected {
                    // Prefer client-supplied optionId from Agent options list
                    option_id: option_id.unwrap_or_else(|| "allow_once".into()),
                },
            };
            acp.respond_permission(rpc_id, outcome).await?;
        }
        self.emit_for_session(&app, &target);
        Self::emit_empty_run_if_any(&app, empty_run);
        Ok(self.snapshot())
    }

    /// Session a gate answer applies to: explicit id, else the live focus slot.
    fn resolve_target_session(&self, session_id: Option<String>) -> Result<String, String> {
        match session_id {
            Some(sid) if !sid.is_empty() => Ok(sid),
            _ => self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone())
                .ok_or_else(|| "no session".to_string()),
        }
    }

    /// Resolve pending `_x.ai/exit_plan_mode` (Approve & build / request changes / abandon).
    ///
    /// `decision`: "approved" | "cancelled" | "abandoned"
    /// Optional `feedback` is sent only with cancelled (revise).
    pub async fn resolve_plan(
        &self,
        app: AppHandle,
        decision: String,
        feedback: Option<String>,
        rpc_id: Option<u64>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = self.resolve_target_session(session_id)?;
        let (acp, id) = self
            .with_session_mut(&target, |s| {
                Self::touch_activity_locked(s);
                let id = rpc_id.or(s.pending_plan_rpc_id.take());
                (s.acp.clone(), id)
            })
            .ok_or("no session")?;
        let id = id.ok_or_else(|| "no pending plan approval".to_string())?;
        let acp = acp.ok_or_else(|| "ACP client missing".to_string())?;
        acp.respond_exit_plan_mode(id, &decision, feedback).await?;
        let empty_run = self
            .with_session_mut(&target, |s| {
                Self::try_finish_deferred_prompt_complete(s).flatten()
            })
            .flatten();
        self.emit_for_session(&app, &target);
        Self::emit_empty_run_if_any(&app, empty_run);
        Ok(self.snapshot())
    }

    /// Resolve pending `_x.ai/ask_user_question` (answers or cancel).
    ///
    /// `decision`: "accepted" | "cancelled"
    /// `answers`: object map of question text → answer string (required for accepted).
    pub async fn resolve_ask_user(
        &self,
        app: AppHandle,
        decision: String,
        answers: Option<serde_json::Value>,
        rpc_id: Option<u64>,
        session_id: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let target = self.resolve_target_session(session_id)?;
        let (acp, id) = self
            .with_session_mut(&target, |s| {
                let id = rpc_id.or(s.pending_ask_user_rpc_id.take());
                // Clear pending id even if rpc_id was explicit.
                if rpc_id.is_some() {
                    s.pending_ask_user_rpc_id = None;
                }
                (s.acp.clone(), id)
            })
            .ok_or("no session")?;
        let id = id.ok_or_else(|| "no pending ask_user_question".to_string())?;
        let acp = acp.ok_or_else(|| "ACP client missing".to_string())?;
        let outcome = match decision.as_str() {
            "accepted" | "answered" | "accept" => {
                let answers = answers.unwrap_or_else(|| serde_json::json!({}));
                AskUserOutcome::Accepted { answers }
            }
            _ => AskUserOutcome::Cancelled,
        };
        acp.respond_ask_user_question(id, outcome).await?;
        let empty_run = self
            .with_session_mut(&target, |s| {
                Self::try_finish_deferred_prompt_complete(s).flatten()
            })
            .flatten();
        self.emit_for_session(&app, &target);
        Self::emit_empty_run_if_any(&app, empty_run);
        Ok(self.snapshot())
    }

    /// Clear the live focus slot without aborting mid-turn work.
    /// - Busy (streaming / open tools) → demote to `background` (keeps ACP + pump).
    /// - Idle Ready → warm `parked`.
    /// - Only kills when there is a leftover dead/orphan acp that could not be parked.
    async fn disconnect_inner(&self, app: &AppHandle) {
        // Prefer demote/park over kill so "new chat" / UI clear never aborts turns.
        if let Err(e) = self.try_park_live_emit(app) {
            tracing::warn!(
                "disconnect demote/park soft-fail: {} {}",
                e.code.as_str(),
                e.message
            );
        }
        // If something is still live with a healthy acp, force another demote.
        if self.inner.lock().as_ref().is_some_and(|s| {
            s.acp.as_ref().is_some_and(|c| c.is_alive())
        }) {
            let _ = self.try_park_live();
        }
        // Drop empty shells only; never Drop a LiveSession that still owns acp.
        let orphan = {
            let mut guard = self.inner.lock();
            match guard.as_mut() {
                Some(s) if s.acp.as_ref().is_some_and(|c| c.is_alive()) => {
                    // Still couldn't park — last resort keep process in background.
                    tracing::warn!(
                        "disconnect: forcing background for sid={}",
                        s.app_session_id
                    );
                    drop(guard);
                    let _ = self.try_park_live();
                    None
                }
                Some(s) => {
                    if let Some(h) = s.mock_stream.take() {
                        h.request_stop();
                    }
                    let acp = s.acp.take();
                    let _ = guard.take();
                    acp
                }
                None => None,
            }
        };
        if let Some(acp) = orphan {
            // Dead / non-alive client handle only.
            if !acp.is_alive() {
                acp.kill().await;
            } else {
                // Alive but unparkable — do not kill; leave Arc drop alone would kill.
                // Re-insert as anonymous? Safer to kill only if not busy — we already
                // tried demote. Keep process alive by forgetting kill.
                tracing::warn!("disconnect: orphan alive acp left without map entry — killing");
                acp.kill().await;
            }
        }
        Self::emit_state(app, &self.snapshot());
    }

    pub async fn disconnect(self: &Arc<Self>, app: AppHandle) -> Result<SessionSnapshot, String> {
        // Clear live focus without aborting background/parked multi-session work.
        self.disconnect_inner(&app).await;
        Ok(self.snapshot())
    }

    pub async fn reattach(self: &Arc<Self>, app: AppHandle) -> Result<SessionSnapshot, String> {
        let (project, sid) = {
            let guard = self.inner.lock();
            match guard.as_ref() {
                Some(s) => (s.project_path.clone(), Some(s.app_session_id.clone())),
                None => (None, None),
            }
        };
        self.connect(app, project, sid, None).await
    }
}

/// Result of taking agent processes out of live / background / parked maps.
struct DrainedAgents {
    acps: Vec<Arc<AcpClient>>,
    had_live_shell: bool,
    background_count: usize,
    parked_count: usize,
}

#[cfg(test)]
mod recycle_tests {
    use super::*;

    #[test]
    fn drain_all_agent_slots_clears_empty_maps() {
        let mgr = SessionManager::new();
        assert_eq!(mgr.tracked_agent_map_counts(), (0, 0, 0));
        assert_eq!(mgr.active_process_count(), 0);

        let drained = mgr.drain_all_agent_slots();
        assert!(drained.acps.is_empty());
        assert!(!drained.had_live_shell);
        assert_eq!(drained.background_count, 0);
        assert_eq!(drained.parked_count, 0);

        // Maps stay empty; safe to call again (idempotent).
        assert_eq!(mgr.tracked_agent_map_counts(), (0, 0, 0));
        assert_eq!(mgr.active_process_count(), 0);
        let again = mgr.drain_all_agent_slots();
        assert!(again.acps.is_empty());
        assert_eq!(again.background_count, 0);
        assert_eq!(again.parked_count, 0);
    }
}

/// Session-scoped command routing (multi-session): an explicit `sessionId`
/// must never silently fall back to whatever holds the live focus slot.
#[cfg(test)]
mod session_routing_tests {
    use super::*;

    #[test]
    fn explicit_target_wins_over_live_slot() {
        let mgr = SessionManager::new();
        // No live session at all — an explicit id is still honoured.
        assert_eq!(
            mgr.resolve_target_session(Some("chat-b".into())).unwrap(),
            "chat-b"
        );
    }

    #[test]
    fn blank_target_falls_back_to_live_and_errors_when_none() {
        let mgr = SessionManager::new();
        assert!(mgr.resolve_target_session(None).is_err());
        // Empty string is treated as "unspecified", not as a session id.
        assert!(mgr.resolve_target_session(Some(String::new())).is_err());
    }

    #[test]
    fn unknown_session_never_resolves_to_another_chat() {
        let mgr = SessionManager::new();
        assert!(mgr.with_session_mut("chat-a", |_| ()).is_none());
        assert!(!mgr.is_live_session("chat-a"));
    }

    #[test]
    fn turn_output_events_are_never_droppable() {
        // Anything that carries answer text, tool state, or a gate must be
        // routed to its session — silently returning truncates the answer.
        assert!(SessionManager::event_carries_turn_output(
            &AcpEvent::Stream {
                kind: StreamKind::Assistant,
                text: "hi".into(),
                message_id: None,
                done: false,
            }
        ));
        assert!(SessionManager::event_carries_turn_output(
            &AcpEvent::PromptComplete {
                stop_reason: "end_turn".into(),
                authoritative: true,
            }
        ));
        assert!(SessionManager::event_carries_turn_output(
            &AcpEvent::ProcessExited { code: None }
        ));
        // Pure telemetry may be dropped when no session owns the process.
        assert!(!SessionManager::event_carries_turn_output(
            &AcpEvent::Stderr { line: "noise".into() }
        ));
        assert_eq!(
            SessionManager::event_kind_name(&AcpEvent::PromptComplete {
                stop_reason: "end_turn".into(),
                authoritative: false,
            }),
            "prompt_complete"
        );
    }

    #[test]
    fn rescue_is_noop_when_no_parked_agent_owns_the_process() {
        let mgr = SessionManager::new();
        assert!(mgr.rescue_parked_to_background("no-such-process").is_none());
    }

    fn sample_live_for_empty_run(body: &str, thought: &str, tools: u32, mode: &str) -> LiveSession {
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let _ = fsm.begin_stream();
        let now = Instant::now();
        LiveSession {
            app_session_id: "session-1".into(),
            process_id: "process-1".into(),
            meta: SessionMeta {
                id: "session-1".into(),
                project_id: None,
                title: "Test".into(),
                agent_session_id: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: Some(mode.into()),
                permission_policy: None,
                scheduled: false,
            },
            fsm,
            backend: "mock_acp".into(),
            acp: None,
            mock_stream: None,
            streaming_message_id: Some("a1".into()),
            active_turn_id: Some("turn-1".into()),
            stream_message_id_locked: false,
            stream_buf: body.into(),
            stream_thought: thought.into(),
            stream_last_was_assistant: !body.is_empty(),
            stream_attachments: Vec::new(),
            model_id: None,
            effort: None,
            product_mode: Some(mode.into()),
            project_path: None,
            allow_cache: SessionAllowCache::default(),
            policy: PermissionPolicy::default(),
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: false,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            deferred_prompt_complete: None,
            tools_this_turn: tools,
            saw_model_output: false,
            prompt_in_flight: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        }
    }

    #[test]
    fn empty_run_does_not_signal_when_assistant_body_exists_without_tools() {
        // #128: pure-text agent replies must not toast.
        let s = sample_live_for_empty_run("Here is a normal answer.", "", 0, "agent");
        assert!(SessionManager::empty_run_signal_from_live(&s, "end_turn").is_none());
    }

    #[test]
    fn empty_run_signals_when_no_body_and_no_tools() {
        let s = sample_live_for_empty_run("", "thinking only", 0, "agent");
        let sig = SessionManager::empty_run_signal_from_live(&s, "end_turn")
            .expect("thought-only zero-tool turn should soft-signal");
        assert_eq!(sig.0, "session-1");
        assert_eq!(sig.2, "agent");
    }

    #[test]
    fn empty_run_skips_ask_mode_and_tool_turns() {
        let ask = sample_live_for_empty_run("", "", 0, "ask");
        assert!(SessionManager::empty_run_signal_from_live(&ask, "end_turn").is_none());
        let tools = sample_live_for_empty_run("", "", 2, "agent");
        assert!(SessionManager::empty_run_signal_from_live(&tools, "end_turn").is_none());
    }

    #[test]
    fn session_load_replay_gate_matches_prompt_in_flight() {
        // session/load replay: no prompt RPC → drop stream/tool/plan side effects.
        assert!(SessionManager::is_session_load_replay(false));
        // Live turn (prompt in flight): apply all side effects.
        assert!(!SessionManager::is_session_load_replay(true));
    }

    #[test]
    fn empty_run_skips_when_saw_model_output_even_if_buf_cleared() {
        let mut s = sample_live_for_empty_run("", "", 0, "agent");
        s.saw_model_output = true;
        assert!(SessionManager::empty_run_signal_from_live(&s, "end_turn").is_none());
    }

    #[test]
    fn journal_assistant_after_last_user_detects_answered_turn() {
        let _lock = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-replay-gate-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = crate::paths::ensure_app_dirs();
        let sid = "replay-gate-test-session";
        let _ = store::append_message(
            sid,
            ChatMessageStored {
                id: "u1".into(),
                role: "user".into(),
                content: "hello".into(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
        );
        assert!(!SessionManager::journal_has_assistant_after_last_user(sid));
        let _ = store::append_message(
            sid,
            ChatMessageStored {
                id: "a1".into(),
                role: "assistant".into(),
                content: "world".into(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
        );
        assert!(SessionManager::journal_has_assistant_after_last_user(sid));
        std::env::remove_var("GROK_APP_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn interjection_starts_host_owned_stream_segment() {
        // Minimal LiveSession-shaped fields via a throwaway session on the manager.
        // We only need stream id lock semantics — use begin_post_interjection_stream.
        // Build through connect path is heavy; construct via unpark-style fields by
        // reusing ensure_stream_message_id after begin_post_interjection_stream on a
        // hand-built session inside the lock.
        let mgr = SessionManager::new();
        // Use a mock live session from existing patterns if any — otherwise skip build.
        // Direct unit: call ensure after setting locked on an empty shell via private API
        // through begin_post_interjection_stream requiring &mut LiveSession.
        // We'll assemble a minimal session matching LiveSession fields by sending
        // through the manager's public surface is hard; use sample via FSM.
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        let _ = fsm.begin_stream();
        let now = Instant::now();
        let mut session = LiveSession {
            app_session_id: "session-1".into(),
            process_id: "process-1".into(),
            meta: SessionMeta {
                id: "session-1".into(),
                project_id: None,
                title: "Test".into(),
                agent_session_id: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: None,
                permission_policy: None,
                scheduled: false,
            },
            fsm,
            backend: "mock_acp".into(),
            acp: None,
            mock_stream: None,
            streaming_message_id: Some("agent-message-1".into()),
            active_turn_id: Some("turn-1".into()),
            stream_message_id_locked: false,
            stream_buf: "before".into(),
            stream_thought: String::new(),
            stream_last_was_assistant: true,
            stream_attachments: Vec::new(),
            model_id: None,
            effort: None,
            product_mode: None,
            project_path: None,
            allow_cache: SessionAllowCache::default(),
            policy: PermissionPolicy::default(),
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: false,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: true,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        };

        SessionManager::begin_post_interjection_stream(&mut session);
        let post_id = session
            .streaming_message_id
            .clone()
            .expect("post-interjection message id");
        assert_ne!(post_id, "agent-message-1");
        assert!(session.stream_message_id_locked);
        assert!(session.stream_buf.is_empty());

        SessionManager::ensure_stream_message_id(
            &mut session,
            StreamKind::Assistant,
            Some("agent-message-1".into()),
        );
        assert_eq!(session.streaming_message_id.as_deref(), Some(post_id.as_str()));

        assert!(SessionManager::is_interjection_turn_active(
            &session, "session-1", "turn-1",
        ));
        assert!(!SessionManager::is_interjection_turn_active(
            &session, "session-2", "turn-1",
        ));
        session.prompt_in_flight = false;
        session.fsm.end_stream().unwrap();
        session.active_turn_id = None;
        assert!(!SessionManager::is_interjection_turn_active(
            &session, "session-1", "turn-1",
        ));
        let _ = mgr; // keep manager constructed for parity with other tests
    }

    #[test]
    fn pick_interjection_target_rejects_non_streaming_session() {
        let mgr = SessionManager::new();
        let mut fsm = SessionFsm::new();
        let _ = fsm.start_connect();
        let _ = fsm.handshake_ok();
        // Ready, not streaming
        let now = Instant::now();
        *mgr.inner.lock() = Some(LiveSession {
            app_session_id: "session-1".into(),
            process_id: "process-1".into(),
            meta: SessionMeta {
                id: "session-1".into(),
                project_id: None,
                title: "Test".into(),
                agent_session_id: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                model_id: None,
                archived: false,
                pinned: false,
                effort: None,
                mode: None,
                permission_policy: None,
                scheduled: false,
            },
            fsm,
            backend: "mock_acp".into(),
            acp: None,
            mock_stream: None,
            streaming_message_id: None,
            active_turn_id: None,
            stream_message_id_locked: false,
            stream_buf: String::new(),
            stream_thought: String::new(),
            stream_last_was_assistant: false,
            stream_attachments: Vec::new(),
            model_id: None,
            effort: None,
            product_mode: None,
            project_path: None,
            allow_cache: SessionAllowCache::default(),
            policy: PermissionPolicy::default(),
            provider_retry_attempt: 0,
            provider_retry_aborted: false,
            needs_history_bootstrap: false,
            pending_plan_rpc_id: None,
            pending_ask_user_rpc_id: None,
            last_activity: now,
            last_stream_progress: now,
            last_stall_emit: None,
            stall_soft_emits: 0,
            journal_throttle: JournalWriteThrottle::with_default_interval(),
            open_tool_ids: HashSet::new(),
            open_tool_seen_at: HashMap::new(),
            deferred_prompt_complete: None,
            tools_this_turn: 0,
            saw_model_output: false,
            prompt_in_flight: false,
            pending_stream_emit: None,
            stream_emit_flush_gen: 0,
            last_tool_heartbeat_emit: None,
        });
        // Same validation `interject_message` runs first, without AppHandle.
        // `tauri::test::mock_app()` needs the `test` feature and crashes the
        // Windows test binary (STATUS_ENTRYPOINT_NOT_FOUND, tauri #14580).
        let guard = mgr.inner.lock();
        match SessionManager::pick_interjection_target(
            guard.as_ref().expect("live session set"),
        ) {
            Ok(_) => panic!("ready session must reject interjection"),
            Err(err) => assert_eq!(err, "interjection requires a streaming turn"),
        }
    }
}

