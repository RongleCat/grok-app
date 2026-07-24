//! Host session manager: real ACP default; mock only if GROK_APP_ACP=mock.
//!
//! Process policy (I01–I03):
//! - One ACP process per live/parked App session (up to `maxConcurrentAgents`, default 3).
//! - Switching chats parks a Ready process instead of killing it (when under the cap).
//! - Idle processes are soft-recycled after `agentIdleMinutes` (default 30); session meta stays.
//!
//! Streaming performance (I04 / I06):
//! - Mid-stream journal upserts are throttled (≥500ms or paragraph / force).
//! - Pure stream silence past `streamStallSeconds` emits `session://stream_stall`.

use std::collections::HashMap;
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
use crate::mock_acp::{self, MockConnectMode, MockStreamHandle, StreamChunk};
use crate::permission::{
    extract_path_target, extract_shell_command, may_auto_allow, may_auto_deny, pick_option_id,
    scope_key, PermissionPolicy, SessionAllowCache,
};
use crate::process_limits::{
    can_spawn_process, is_idle_expired, normalize_idle_minutes, normalize_max_concurrent,
    process_limit_message,
};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored, MessageAttachmentStored, SessionMeta};
use crate::stream_stall::{
    normalize_stream_stall_seconds, should_emit_stall, stream_stall_message,
};

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
    /// Throttle mid-stream assistant journal upserts (I04).
    journal_throttle: JournalWriteThrottle,
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
    pub fn start_stream_stall_watchdog(self: &Arc<Self>, app: AppHandle) {
        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                mgr.tick_stream_stall(&app);
            }
        });
    }

    fn touch_activity_locked(s: &mut LiveSession) {
        s.last_activity = Instant::now();
    }

    /// Stream chunk or tool activity — advances stall deadline (I06).
    fn touch_stream_progress_locked(s: &mut LiveSession) {
        let now = Instant::now();
        s.last_activity = now;
        s.last_stream_progress = now;
        s.last_stall_emit = None;
    }

    fn stream_stall_seconds_from_settings() -> u32 {
        normalize_stream_stall_seconds(store::load_settings().stream_stall_seconds)
    }

    fn emit_stream_stall(app: &AppHandle, session_id: &str, stall_seconds: u32) {
        let _ = app.emit(
            "session://stream_stall",
            serde_json::json!({
                "sessionId": session_id,
                "stallSeconds": stall_seconds,
                "code": "STREAM_STALL",
                "message": stream_stall_message(stall_seconds),
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

    /// I06: if live session is Streaming with pure silence, emit cancel prompt.
    fn tick_stream_stall(&self, app: &AppHandle) {
        let stall_secs = Self::stream_stall_seconds_from_settings();
        let now = Instant::now();
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return;
        };
        // Only pure streaming silence — not permission / plan / ask-user waits.
        if s.fsm.state() != SessionState::Streaming {
            return;
        }
        if s.streaming_message_id.is_none() {
            return;
        }
        if !should_emit_stall(s.last_stream_progress, s.last_stall_emit, stall_secs, now) {
            return;
        }
        s.last_stall_emit = Some(now);
        let sid = s.app_session_id.clone();
        drop(guard);
        tracing::warn!(
            "stream stall: session={sid} silence≥{stall_secs}s — emitting cancel prompt"
        );
        Self::emit_stream_stall(app, &sid, stall_secs);
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

    /// Drop dead parked entries; return killed count (for logging).
    fn sweep_dead_parked(&self) -> usize {
        let mut parked = self.parked.lock();
        let before = parked.len();
        parked.retain(|_, p| p.acp.is_alive());
        before.saturating_sub(parked.len())
    }

    /// Park or background the current live session so focus can move.
    ///
    /// - Ready → warm `parked` (idle process).
    /// - Streaming / AwaitingPermission → `background` (keeps full LiveSession + event pump).
    /// - Capacity exceeded → error (PROCESS_LIMIT).
    fn try_park_live(&self) -> Result<(), AgentError> {
        let max = Self::max_concurrent_from_settings();
        let mut guard = self.inner.lock();
        let Some(s) = guard.as_mut() else {
            return Ok(());
        };
        // Nothing to park
        if s.acp.as_ref().is_none_or(|c| !c.is_alive()) {
            return Ok(());
        }
        match s.fsm.state() {
            SessionState::Ready if s.streaming_message_id.is_none() => {
                let acp = match s.acp.take() {
                    Some(c) if c.is_alive() => c,
                    Some(_) | None => return Ok(()),
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
            SessionState::Idle | SessionState::Disconnected => Ok(()),
            // Busy: keep full LiveSession in background so streaming continues.
            SessionState::Streaming
            | SessionState::AwaitingPermission
            | SessionState::Connecting => {
                // +1 for the demoted session already counted as live; need room.
                let others = self.active_process_count().saturating_sub(1);
                if others.saturating_add(1) > max {
                    return Err(AgentError::new(
                        AgentErrorCode::ProcessLimit,
                        format!(
                            "Session is busy and process limit ({max}) is full. Stop a turn or raise the limit. {}",
                            process_limit_message(max)
                        ),
                    ));
                }
                let Some(live) = guard.take() else {
                    return Ok(());
                };
                let sid = live.app_session_id.clone();
                drop(guard);
                tracing::info!(
                    "acp demote busy session to background sid={sid} state={:?}",
                    live.fsm.state()
                );
                self.background.lock().insert(sid, live);
                Ok(())
            }
            other => Err(AgentError::new(
                AgentErrorCode::ProcessLimit,
                format!(
                    "Session is busy ({other:?}). Stop the turn or wait, then switch chats. {}",
                    process_limit_message(max)
                ),
            )),
        }
    }

    /// If a background session finished its turn (Ready), convert to warm parked.
    fn promote_background_ready_to_parked(&self, app_session_id: &str) {
        let mut bg = self.background.lock();
        let ready = bg.get(app_session_id).is_some_and(|s| {
            matches!(s.fsm.state(), SessionState::Ready)
                && s.streaming_message_id.is_none()
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
            journal_throttle: JournalWriteThrottle::with_default_interval(),
        })
    }

    /// Kill oldest parked agents until under capacity (or none left).
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

    /// Idle recycle for live + parked (I03).
    async fn tick_idle_recycle(&self, app: &AppHandle) {
        let idle_mins = Self::idle_minutes_from_settings();
        let now = Instant::now();
        self.sweep_dead_parked();

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

        // Live: only when Ready (not mid-turn)
        let live_kill = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                let idle = is_idle_expired(s.last_activity, idle_mins, now);
                let ready = matches!(s.fsm.state(), SessionState::Ready)
                    && s.streaming_message_id.is_none();
                if idle && ready {
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

        let cwd = project_path
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));

        // Ensure app session meta
        let mut meta = if let Some(id) = app_session_id {
            store::load_sessions_index()
                .into_iter()
                .find(|s| s.id == id)
                .unwrap_or_else(|| {
                    store::create_session(None, Some("New chat".into()), false)
                        .expect("create session")
                })
        } else {
            store::create_session(None, Some("New chat".into()), false).map_err(|e| e)?
        };

        // Resolve model / effort / permission / mode for this project+session scope.
        let prefs = store::resolve_composer_prefs(
            meta.project_id.as_deref(),
            Some(meta.id.as_str()),
        );
        let policy = PermissionPolicy::parse(&prefs.permission_policy);
        let agent_model = crate::providers::agent_spawn_model_id(&prefs.model_id);

        // Already live on this App session with a healthy agent → no-op (or soft re-bind prefs).
        {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.app_session_id == meta.id
                    && s.project_path == project_path
                    && s.acp.as_ref().is_some_and(|c| c.is_alive())
                    && matches!(s.fsm.state(), SessionState::Ready)
                    && s.streaming_message_id.is_none()
                    && s.effort.as_deref() == Some(prefs.effort.as_str())
                {
                    Self::touch_activity_locked(s);
                    tracing::info!(
                        "acp connect no-op: already ready session={}",
                        meta.id
                    );
                    return Ok(self.snapshot());
                }
            }
        }

        // Target already streaming in background → promote to focus.
        if self.background.lock().contains_key(&meta.id) {
            if let Err(e) = self.try_park_live() {
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
            if let Err(e) = self.try_park_live() {
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

        // Cross-session warm reuse: same process, switch ACP session without respawn.
        // Only when target is not a different parked agent and flags match.
        let reuse_pair = {
            let same_focus = self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id == meta.id)
                .unwrap_or(false);
            if same_focus {
                None
            } else {
                Self::take_reusable_acp(&self.inner, &cwd, &project_path, &prefs, policy)
            }
        };

        if reuse_pair.is_some() {
            // Keep process; drop LiveSession shell so we can rebind (1 process stays).
            let _ = self.inner.lock().take();
            Self::emit_state(&app, &self.snapshot());
        } else {
            // Park live Ready agent when switching focus (multi-warm). Busy → error.
            let live_sid = self
                .inner
                .lock()
                .as_ref()
                .map(|s| s.app_session_id.clone());
            if live_sid.as_deref() != Some(meta.id.as_str()) {
                if let Err(e) = self.try_park_live() {
                    Self::emit_process_limit(&app, Some(&meta.id), max_concurrent);
                    return Err(format!("{}: {}", e.code.as_str(), e.message));
                }
                // Clear disconnected / dead live shell so we can rebuild.
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_ref() {
                        if s.app_session_id != meta.id
                            || s.acp.is_none()
                            || !matches!(s.fsm.state(), SessionState::Ready)
                        {
                            let _ = guard.take();
                        }
                    }
                }
            } else {
                // Same session reconnect / flag change — kill any leftover process.
                let leftover = {
                    let mut guard = self.inner.lock();
                    guard.take().and_then(|mut s| s.acp.take())
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

        // Warm reuse must keep the original process_id so the event pump still routes.
        let process_id = reuse_pair
            .as_ref()
            .map(|(pid, _)| pid.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
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
                journal_throttle: JournalWriteThrottle::with_default_interval(),
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

        let (client, reused_process, process_id) = if let Some((pid, existing)) = reuse_pair {
            tracing::info!(
                "acp warm reuse process cwd={} effort={} app_session={}",
                cwd.display(),
                prefs.effort,
                meta.id
            );
            (existing, true, pid)
        } else {
            // Capacity: free LRU parked if needed, else reject.
            self.sweep_dead_parked();
            let active = self.active_process_count();
            // active does not yet include this new spawn (live has no acp).
            if !can_spawn_process(active, max_concurrent) {
                // Try freeing one parked LRU slot.
                self.free_parked_for_capacity(&app, 1).await;
            }
            let active = self.active_process_count();
            if !can_spawn_process(active, max_concurrent) {
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

            // Real ACP cold spawn
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

            let (client, mut events) =
                match AcpClient::spawn_with_options(cli_path, cwd, spawn_opts) {
                    Ok(v) => v,
                    Err(e) => {
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
            (client, false, process_id)
        };

        let open_result = if reused_process {
            client.open_session(resume_agent_sid.as_deref()).await
        } else {
            client
                .initialize_and_open_session(resume_agent_sid.as_deref())
                .await
        };

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
                        "agent session resumed id={agent_sid} (full context) warm={reused_process}"
                    );
                } else if need_bootstrap {
                    tracing::info!(
                        "agent session new id={agent_sid}; will bootstrap journal history on first send warm={reused_process}"
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

    /// Detach a live ACP client when spawn-critical flags match the next connect.
    /// Event pump keeps running on the Arc; caller rebinds into a new LiveSession.
    /// Prefer park+spawn for multi-session; this path keeps a single process for same cwd.
    /// Returns `(process_id, client)` so the event pump tag stays valid.
    fn take_reusable_acp(
        inner: &Mutex<Option<LiveSession>>,
        cwd: &std::path::Path,
        project_path: &Option<String>,
        prefs: &store::ComposerPrefs,
        next_policy: PermissionPolicy,
    ) -> Option<(ProcessId, Arc<AcpClient>)> {
        let mut guard = inner.lock();
        let s = guard.as_mut()?;
        if !matches!(s.fsm.state(), SessionState::Ready) {
            return None;
        }
        if s.streaming_message_id.is_some() {
            return None;
        }
        if s.project_path != *project_path {
            return None;
        }
        let client = s.acp.as_ref()?;
        if !client.is_alive() {
            return None;
        }
        // Effort is a spawn flag — mismatch requires cold respawn.
        if s.effort.as_deref() != Some(prefs.effort.as_str()) {
            return None;
        }
        // YOLO maps to `--always-approve` at spawn time.
        let prev_yolo = s.policy == PermissionPolicy::AlwaysApprove;
        let next_yolo = next_policy == PermissionPolicy::AlwaysApprove;
        if prev_yolo != next_yolo {
            return None;
        }
        // cwd must match the process (project path or orphan fallback).
        if client.cwd() != cwd {
            return None;
        }
        let pid = s.process_id.clone();
        s.acp.take().map(|c| (pid, c))
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
                let (app_sid, mid, thought_phase) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Drop stream chunks that arrive while no turn is in flight.
                        // On session resume (session/load) the CLI may replay the past
                        // transcript as agent_message_chunk notifications; without this
                        // guard they'd be re-emitted as live session://stream and the
                        // UI would re-type the whole history on every session switch.
                        if !matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            tracing::debug!(
                                "acp stream dropped: fsm={:?} (not in a live turn)",
                                s.fsm.state()
                            );
                            return;
                        }
                        // Stream chunk = progress (I06); not pure silence.
                        Self::touch_stream_progress_locked(s);
                        // Prefer agent-supplied messageId; otherwise keep the turn id.
                        if let Some(ref mid_in) = message_id {
                            if s.streaming_message_id.as_ref() != Some(mid_in) {
                                // New assistant message id mid-turn (rare) — adopt it.
                                if s.streaming_message_id.is_none()
                                    || matches!(kind, StreamKind::Assistant)
                                {
                                    s.streaming_message_id = Some(mid_in.clone());
                                }
                            }
                        }
                        if s.streaming_message_id.is_none() {
                            s.streaming_message_id =
                                Some(message_id.unwrap_or_else(|| Uuid::new_v4().to_string()));
                        }
                        // Split thinking whenever it resumes after body text so the UI
                        // can interleave thought ↔ content (not stack all thoughts on top).
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
                                s.stream_last_was_assistant = true;
                                "none"
                            }
                        };
                        // I04: throttled mid-stream journal (force on terminal done chunk).
                        let para = is_paragraph_break(&text);
                        Self::maybe_flush_stream_journal(s, done, para);
                        (
                            s.app_session_id.clone(),
                            s.streaming_message_id.clone().unwrap_or_default(),
                            thought_phase,
                        )
                    } else {
                        return;
                    }
                };
                let payload = serde_json::json!({
                    "sessionId": app_sid,
                    "messageId": mid,
                    "text": text,
                    "done": done,
                    "kind": match kind {
                        StreamKind::Assistant => "assistant",
                        StreamKind::Thought => "thought",
                    },
                    "thoughtPhase": thought_phase,
                });
                let _ = app.emit("session://stream", payload);
            }
            AcpEvent::PromptComplete { stop_reason: _ } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        Self::touch_stream_progress_locked(s);
                        // Force-flush assistant turn (I04 end-of-turn path).
                        Self::maybe_flush_stream_journal(s, true, false);
                        s.stream_buf.clear();
                        s.stream_thought.clear();
                        s.stream_last_was_assistant = false;
                        s.stream_attachments.clear();
                        s.journal_throttle.reset();
                        if s.fsm.state() == SessionState::Streaming
                            || s.fsm.state() == SessionState::AwaitingPermission
                        {
                            let _ = s.fsm.end_stream();
                        }
                        s.streaming_message_id = None;
                        s.last_stall_emit = None;
                    }
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
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
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
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            if s.fsm.state() == SessionState::AwaitingPermission {
                                let _ = s.fsm.permission_resolved_continue();
                            }
                        }
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

                let app_sid = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Tool events count as progress so long tools never false-stall (I06).
                        Self::touch_stream_progress_locked(s);
                        s.app_session_id.clone()
                    } else {
                        String::new()
                    }
                };

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
                        if let Some(id) = rpc_id {
                            s.pending_plan_rpc_id = Some(id);
                        }
                        s.app_session_id.clone()
                    } else {
                        String::new()
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
                        s.pending_ask_user_rpc_id = Some(rpc_id);
                        s.app_session_id.clone()
                    } else {
                        String::new()
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
                let (app_sid, mid, thought_phase) = {
                    let mut bg = self.background.lock();
                    let Some(s) = bg.get_mut(app_session_id) else {
                        return;
                    };
                    if !matches!(
                        s.fsm.state(),
                        SessionState::Streaming | SessionState::AwaitingPermission
                    ) {
                        return;
                    }
                    Self::touch_stream_progress_locked(s);
                    if let Some(ref mid_in) = message_id {
                        if s.streaming_message_id.as_ref() != Some(mid_in)
                            && (s.streaming_message_id.is_none()
                                || matches!(kind, StreamKind::Assistant))
                        {
                            s.streaming_message_id = Some(mid_in.clone());
                        }
                    }
                    if s.streaming_message_id.is_none() {
                        s.streaming_message_id =
                            Some(message_id.unwrap_or_else(|| Uuid::new_v4().to_string()));
                    }
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
                            s.stream_last_was_assistant = true;
                            "none"
                        }
                    };
                    let para = is_paragraph_break(&text);
                    Self::maybe_flush_stream_journal(s, done, para);
                    (
                        s.app_session_id.clone(),
                        s.streaming_message_id.clone().unwrap_or_default(),
                        thought_phase,
                    )
                };
                let _ = app.emit(
                    "session://stream",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "messageId": mid,
                        "text": text,
                        "done": done,
                        "kind": match kind {
                            StreamKind::Assistant => "assistant",
                            StreamKind::Thought => "thought",
                        },
                        "thoughtPhase": thought_phase,
                    }),
                );
            }
            AcpEvent::PromptComplete { stop_reason: _ } => {
                {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::touch_stream_progress_locked(s);
                        Self::maybe_flush_stream_journal(s, true, false);
                        s.stream_buf.clear();
                        s.stream_thought.clear();
                        s.stream_last_was_assistant = false;
                        s.stream_attachments.clear();
                        s.journal_throttle.reset();
                        if matches!(
                            s.fsm.state(),
                            SessionState::Streaming | SessionState::AwaitingPermission
                        ) {
                            let _ = s.fsm.end_stream();
                        }
                        s.streaming_message_id = None;
                        s.last_stall_emit = None;
                    }
                }
                self.promote_background_ready_to_parked(app_session_id);
                // Snapshot is focused live — still emit so sidebar busy flags can refresh.
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
                    Self::emit_state(app, &self.snapshot());
                }
            }
            AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                raw: _,
            } => {
                let app_sid = {
                    let mut bg = self.background.lock();
                    if let Some(s) = bg.get_mut(app_session_id) {
                        Self::touch_stream_progress_locked(s);
                        s.app_session_id.clone()
                    } else {
                        return;
                    }
                };
                let live_title = if !title.is_empty() {
                    title
                } else {
                    kind.clone()
                };
                let st = if status.is_empty() {
                    "in_progress"
                } else {
                    status.as_str()
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
            }
            AcpEvent::ProcessExited { .. } => {
                let mut bg = self.background.lock();
                if let Some(mut s) = bg.remove(app_session_id) {
                    let _ = s.fsm.crash("Agent process exited (background)");
                    s.acp = None;
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
    pub async fn rewind_drop_last_user_turn(
        self: &Arc<Self>,
        app: AppHandle,
    ) -> Result<SessionSnapshot, String> {
        let (backend, app_sid, acp, user_prompt_count) = {
            let guard = self.inner.lock();
            let s = guard.as_ref().ok_or("no active session")?;
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

    pub async fn send_message(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        display_text: Option<String>,
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

        // If agent is a fresh session/new, wrap recent journal into the prompt once.
        let (backend, app_sid, acp, agent_prompt) = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no active session")?;
            s.fsm.begin_stream().map_err(|e| e.to_string())?;
            Self::touch_stream_progress_locked(s);
            let mid = Uuid::new_v4().to_string();
            s.streaming_message_id = Some(mid.clone());
            s.stream_buf.clear();
            s.stream_thought.clear();
            s.stream_last_was_assistant = false;
            s.stream_attachments.clear();
            s.journal_throttle.reset();
            s.last_stall_emit = None;
            s.provider_retry_attempt = 0;
            s.provider_retry_aborted = false;

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
                            if s.fsm.state() == SessionState::Streaming {
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
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

        let acp = acp.ok_or("ACP client missing")?;
        let mgr = Arc::clone(self);
        let app2 = app.clone();
        tokio::spawn(async move {
            if let Err(e) = acp.prompt(&agent_prompt).await {
                {
                    let mut guard = mgr.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Skip if host already recorded a retry-exhausted error this turn.
                        if !s.provider_retry_aborted {
                            SessionManager::record_turn_error(s, &app2, &e);
                            let _ = s.fsm.fail_with(e);
                        }
                    }
                }
                SessionManager::emit_state(&app2, &mgr.snapshot());
            }
        });

        Ok(self.snapshot())
    }

    pub async fn stop(self: &Arc<Self>, app: AppHandle) -> Result<SessionSnapshot, String> {
        let acp = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no active session")?;
            if let Some(h) = s.mock_stream.take() {
                h.request_stop();
            }
            let was_busy = s.fsm.state() == SessionState::Streaming
                || s.fsm.state() == SessionState::AwaitingPermission;
            let partial = s.stream_buf.trim().to_string();
            // Journal a cancel marker so UI history is not left as user-only silence.
            if was_busy {
                // I04: force-flush partial assistant before cancel marker.
                Self::maybe_flush_stream_journal(s, true, false);
                let mid = Uuid::new_v4().to_string();
                let content = if partial.is_empty() {
                    "turn_cancelled|user_stop".to_string()
                } else {
                    format!("turn_cancelled|user_stop|partial:{}", partial.chars().take(200).collect::<String>())
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
            }
            if was_busy {
                let _ = s.fsm.end_stream();
            }
            s.streaming_message_id = None;
            s.stream_buf.clear();
            s.stream_thought.clear();
            s.stream_last_was_assistant = false;
            s.stream_attachments.clear();
            s.journal_throttle.reset();
            s.last_stall_emit = None;
            s.acp.clone()
        };
        if let Some(acp) = acp {
            let _ = acp.cancel().await;
        }
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
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
    /// Soft-respawn the live agent process so the next connect reloads agent-visible
    /// state (MCP mcpServers injection, plugin enable/disable, prefs) without a full
    /// disconnect toast. Public for Extensions / plugin settings mutations.
    pub async fn soft_respawn(&self, app: &AppHandle) {
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(s) = guard.as_mut() {
                if s.acp.is_none() {
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
            Self::emit_state(app, &self.snapshot());
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
        if !matches!(effort.as_str(), "high" | "medium" | "low") {
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

    pub async fn resolve_permission(
        self: &Arc<Self>,
        app: AppHandle,
        rpc_id: u64,
        decision: String,
        option_id: Option<String>,
        scope: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        let acp = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no session")?;
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
            s.acp.clone()
        };

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
            acp.respond_permission(rpc_id, outcome)
                .await
                .map_err(|e| e)?;
        }
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
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
    ) -> Result<SessionSnapshot, String> {
        let (acp, id) = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no session")?;
            Self::touch_activity_locked(s);
            let id = rpc_id.or(s.pending_plan_rpc_id.take());
            (s.acp.clone(), id)
        };
        let id = id.ok_or_else(|| "no pending plan approval".to_string())?;
        let acp = acp.ok_or_else(|| "ACP client missing".to_string())?;
        acp.respond_exit_plan_mode(id, &decision, feedback).await?;
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
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
    ) -> Result<SessionSnapshot, String> {
        let (acp, id) = {
            let mut guard = self.inner.lock();
            let s = guard.as_mut().ok_or("no session")?;
            let id = rpc_id.or(s.pending_ask_user_rpc_id.take());
            // Clear pending id even if rpc_id was explicit.
            if rpc_id.is_some() {
                s.pending_ask_user_rpc_id = None;
            }
            (s.acp.clone(), id)
        };
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
        let snap = self.snapshot();
        Self::emit_state(&app, &snap);
        Ok(snap)
    }

    async fn disconnect_inner(&self, app: &AppHandle) {
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(mut s) = guard.take() {
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                // I04: flush any in-flight stream before dropping the process.
                Self::maybe_flush_stream_journal(&mut s, true, false);
                s.acp.take()
            } else {
                None
            }
        };
        if let Some(acp) = acp {
            acp.kill().await;
        }
        // Keep parked warm agents — full app teardown can clear them later.
        Self::emit_state(app, &self.snapshot());
    }

    pub async fn disconnect(self: &Arc<Self>, app: AppHandle) -> Result<SessionSnapshot, String> {
        // Drop the focused process only. Parked warm agents stay until idle recycle
        // or capacity eviction so reopening another chat can unpark quickly.
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
