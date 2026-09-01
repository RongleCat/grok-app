//! Session manager types and pure helpers.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::acp_client::{AcpClient, StreamKind};
use crate::error::AgentError;
use crate::journal_throttle::JournalWriteThrottle;
use crate::mock_acp::MockStreamHandle;
use crate::permission::{PermissionPolicy, SessionAllowCache};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored, MessageAttachmentStored, SessionMeta};
use crate::stream_stall::StallTier;

/// Outcome of one stall-watchdog pass on a single live/background session.
#[derive(Debug)]
pub(super) enum StallTickAction {
    Healed {
        session_id: String,
    },
    /// Force-ended streaming turn (cancel hung ACP prompt). Not produced by the
    /// stall watchdog anymore — user tasks only end via explicit stop. Kept so
    /// `apply_stall_tick_action` can still handle recovery events if reintroduced.
    #[allow(dead_code)]
    HardEnded {
        session_id: String,
        stall_seconds: u32,
        /// Why we ended (logging / UI code).
        reason: &'static str,
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
pub(super) fn sanitize_error_detail(raw: &str) -> String {
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

/// Pending `_x.ai/ask_user_question` questionnaire, shaped exactly like the
/// `session://ask_user` event so a restore and a live emit are interchangeable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiAskUserRequest {
    pub rpc_id: u64,
    pub session_id: String,
    pub tool_call_id: Option<String>,
    pub questions: Vec<crate::acp_client::AskUserQuestionItem>,
}

/// Identity for routing ACP event pumps when multiple processes are warm.
pub(super) type ProcessId = String;

/// Buffered `session://stream` payload awaiting coalesce flush.
pub(super) struct PendingStreamEmit {
    pub(super) kind: StreamKind,
    pub(super) message_id: String,
    pub(super) text: String,
    pub(super) thought_phase: String,
    pub(super) done: bool,
    pub(super) first_at: Instant,
}

pub(crate) struct LiveSession {
    pub(super) app_session_id: String,
    /// Stable id for the agent process / event pump (not the App session id).
    pub(super) process_id: ProcessId,
    pub(super) meta: SessionMeta,
    pub(super) fsm: SessionFsm,
    pub(super) backend: String,
    pub(super) acp: Option<Arc<AcpClient>>,
    pub(super) mock_stream: Option<MockStreamHandle>,
    pub(super) streaming_message_id: Option<String>,
    /// Stable identity for one user-prompt turn. Survives assistant row splits
    /// (e.g. mid-turn interjection / Steer).
    pub(super) active_turn_id: Option<String>,
    /// Keep the host-created assistant id after an interjection splits the turn.
    /// The agent may continue emitting its original messageId, which must not
    /// merge post-interjection output back into the frozen pre-interjection row.
    pub(super) stream_message_id_locked: bool,
    /// Accumulated assistant text for current turn (persisted on complete).
    pub(super) stream_buf: String,
    pub(super) stream_thought: String,
    /// Last emitted chunk was assistant body — next thought opens a new phase
    /// so thinking and body can interleave (think → write → think → write).
    pub(super) stream_last_was_assistant: bool,
    /// Image/file paths produced this turn (image_gen / image_edit).
    pub(super) stream_attachments: Vec<MessageAttachmentStored>,
    pub(super) model_id: Option<String>,
    /// Effort applied to the live agent process (from last spawn).
    pub(super) effort: Option<String>,
    /// Product mode: agent | plan | ask (ACP session/set_mode).
    pub(super) product_mode: Option<String>,
    pub(super) project_path: Option<String>,
    pub(super) allow_cache: SessionAllowCache,
    pub(super) policy: PermissionPolicy,
    /// Last provider retry attempt observed this turn (0 = none).
    pub(super) provider_retry_attempt: u32,
    /// Host already aborted this turn after max retries (avoid double cancel).
    pub(super) provider_retry_aborted: bool,
    /// After session/new (load failed), first prompt should carry journal history.
    pub(super) needs_history_bootstrap: bool,
    /// Pending `_x.ai/exit_plan_mode` JSON-RPC id awaiting user Approve / revise.
    pub(super) pending_plan_rpc_id: Option<u64>,
    /// Pending `_x.ai/ask_user_question` JSON-RPC id awaiting user answers.
    pub(super) pending_ask_user_rpc_id: Option<u64>,
    /// Full UI payload of the pending questionnaire, for the same reason as
    /// `pending_permission_ui`: `session://ask_user` is a one-shot emit, and the
    /// agent blocks on the reverse RPC until it is answered. Without a restore
    /// path a reload left the chat stuck "thinking" with no gate to click, and
    /// the stall watchdog deliberately skips sessions holding an ask gate.
    pub(super) pending_ask_user_ui: Option<UiAskUserRequest>,
    /// Pending `session/request_permission` JSON-RPC id for this session (#524).
    /// Cleared on resolve or when the owning agent process is recycled/killed.
    pub(super) pending_permission_rpc_id: Option<u64>,
    /// ACP `options` list for the pending permission (used to coerce wire
    /// optionIds so UI fallbacks like `always-allow` never override a
    /// tool-scoped id such as `allow-always-command`).
    pub(super) pending_permission_options: Option<serde_json::Value>,
    /// Tool name for the pending permission (empty-options session fallback
    /// needs family-aware wire ids — shell → allow-always-command, #542).
    pub(super) pending_permission_tool_name: Option<String>,
    /// Full UI payload of the pending permission. `session://permission` is a
    /// one-shot emit — a WebView that reloads/remounts while a turn waits on
    /// approval misses it and the chat looks stuck "thinking" forever. The
    /// frontend pulls this on session open to restore the approval bar.
    pub(super) pending_permission_ui: Option<UiPermissionRequest>,
    /// Last user/agent activity (send, stream, permission, connect).
    pub(super) last_activity: Instant,
    /// Last stream chunk or tool event (I06 stall watchdog). Permission waits do not update this.
    pub(super) last_stream_progress: Instant,
    /// Last time we emitted `session://stream_stall` for the current silence window.
    pub(super) last_stall_emit: Option<Instant>,
    /// Soft stall banners already shown this turn (capped; prefer silent heal).
    pub(super) stall_soft_emits: u32,
    /// Throttle mid-stream assistant journal upserts (I04).
    pub(super) journal_throttle: JournalWriteThrottle,
    /// Tool calls still pending/in_progress this turn (#52 early prompt_complete).
    pub(super) open_tool_ids: HashSet<String>,
    /// Last tool event time per open id (orphan leak recovery).
    pub(super) open_tool_seen_at: HashMap<String, Instant>,
    /// Tool ids that reached a terminal status this turn (monotonic: never re-open).
    /// Prevents background-shell stdout `in_progress` after completed(`[bg]`) from
    /// leaking `open_tool_ids` and stranding deferred `prompt_complete`.
    pub(super) terminal_tool_ids: HashSet<String>,
    /// `prompt_complete` arrived while tools/gates still open; finish when clear.
    pub(super) deferred_prompt_complete: Option<String>,
    /// Tool events observed during the current turn (empty-run soft signal).
    pub(super) tools_this_turn: u32,
    /// Non-empty assistant body observed this turn (sticky until turn ends).
    pub(super) saw_model_output: bool,
    /// A `session/prompt` RPC is dispatched and has not resolved yet.
    ///
    /// Authoritative "this chat is working" flag — the FSM is not, because the
    /// agent may fire `prompt_complete` early (which Readies the FSM) and then
    /// keep streaming. While this is set the session can never be parked or
    /// idle-recycled, and its stream chunks are always applied.
    pub(super) prompt_in_flight: bool,
    /// True once this visit (connect → park) dispatched a prompt. Sessions
    /// that were only opened to look at get detached (no warm process kept)
    /// when the user switches away — only chats that actually sent work stay
    /// warm. Busy turns are never affected (they demote to background).
    pub(super) sent_prompt_this_visit: bool,
    /// Coalesced stream IPC buffer (host backpressure).
    pub(super) pending_stream_emit: Option<PendingStreamEmit>,
    /// Bumped when a delayed flush is scheduled; stale tasks no-op.
    pub(super) stream_emit_flush_gen: u64,
    /// Last `session://tool_heartbeat` emit (long open tools).
    pub(super) last_tool_heartbeat_emit: Option<Instant>,
}

/// Process prewarmed while the user composes a new chat (spawn + init + auth
/// only, no session). Spawn cwd is the App default workspace; project chats
/// with a non-`off` OS sandbox must cold-spawn instead of reusing this (#986).
pub(crate) struct PrewarmedProcess {
    pub(super) acp: Arc<AcpClient>,
    pub(super) process_id: ProcessId,
    pub(super) policy: PermissionPolicy,
    pub(super) effort: Option<String>,
    pub(super) sandbox_profile: Option<String>,
    #[allow(dead_code)]
    pub(super) model_id: Option<String>,
    pub(super) created_at: Instant,
    #[allow(dead_code)]
    pub(super) backend: String,
}

/// Prewarm slot state. A process that was detached (viewed-only session) is
/// killed and replaced so its accumulated CLI actors do not slow the next
/// `session/load` (the CLI waits up to 5s for an old session thread).
pub(crate) enum PrewarmState {
    None,
    /// initialize+auth in flight; connect may wait briefly for it.
    Spawning {
        since: Instant,
    },
    Ready(PrewarmedProcess),
}

/// Ready agent process parked while another App session is focused (I01/I02).
pub(crate) struct ParkedAgent {
    pub(super) process_id: ProcessId,
    pub(super) app_session_id: String,
    pub(super) meta: SessionMeta,
    pub(super) acp: Arc<AcpClient>,
    pub(super) last_activity: Instant,
    pub(super) model_id: Option<String>,
    pub(super) effort: Option<String>,
    pub(super) product_mode: Option<String>,
    pub(super) project_path: Option<String>,
    pub(super) policy: PermissionPolicy,
    /// Process-level `--sandbox` profile at spawn (reuse gate).
    #[allow(dead_code)]
    pub(super) sandbox_profile: Option<String>,
    pub(super) needs_history_bootstrap: bool,
    pub(super) backend: String,
}

/// How many journal messages (user+assistant) to carry when session/load fails.
pub(super) const HISTORY_BOOTSTRAP_MAX_MSGS: usize = 16;
/// Cap each message body in the bootstrap block.
pub(super) const HISTORY_BOOTSTRAP_PER_MSG_CHARS: usize = 2_000;
/// Cap total bootstrap text (excluding the new user turn).
pub(super) const HISTORY_BOOTSTRAP_MAX_CHARS: usize = 14_000;

/// Build a continuity preamble from App journal when agent session is new.
/// Keeps recent turns so the model still "remembers" the chat after respawn.
pub(super) fn build_history_bootstrap(app_session_id: &str) -> Option<String> {
    let msgs = store::load_messages(app_session_id);
    let turns = crate::session_attach::compact_user_assistant_turns_with(
        &msgs,
        HISTORY_BOOTSTRAP_MAX_MSGS,
        HISTORY_BOOTSTRAP_PER_MSG_CHARS,
        HISTORY_BOOTSTRAP_MAX_CHARS,
        crate::session_attach::NestedAttach::Expand,
        &crate::session_attach::StoreAttachJournal,
    )?;
    let mut body = String::from(
        "[Prior conversation context — this chat continues an existing Grok App session. \
The agent process was restarted; use the following transcript for continuity ONLY. \
Rules: do NOT re-greet; do NOT restate, quote, or re-answer prior assistant turns; \
do NOT reprint the transcript in your reply; answer ONLY the new user message below.]\n\n",
    );
    body.push_str(&turns);
    body.push_str("---\n\n[End of prior context. Continue with the user's new message below.]\n");
    Some(body)
}

/// Cap content snippets emitted on live tool events (diff panel).
pub(super) const TOOL_CONTENT_SNIPPET_MAX: usize = 200_000;

/// Extract human-visible path + detail from tool_call payload for activity UI.
/// path includes file paths **and** web_fetch URLs (`rawInput.url`) so reload
/// can show Grok-style “Browsed host/path” instead of bare “Tool”.
/// Also surfaces ChatCut `browserHandoff.url` / `editorUrl` from MCP rawOutput
/// so the UI can open Resources EmbeddedBrowser (Codex internal-browser parity).
pub(super) fn extract_tool_ui_fields(raw: &serde_json::Value) -> (Option<String>, Option<String>) {
    let path = raw
        .pointer("/locations/0/path")
        .or_else(|| raw.pointer("/rawInput/path"))
        .or_else(|| raw.pointer("/rawInput/file_path"))
        .or_else(|| raw.pointer("/rawInput/filePath"))
        .or_else(|| raw.pointer("/rawInput/target_file"))
        .or_else(|| raw.pointer("/rawInput/targetFile"))
        // web_fetch / browse / open_page
        .or_else(|| raw.pointer("/rawInput/url"))
        .or_else(|| raw.pointer("/rawInput/uri"))
        .or_else(|| raw.pointer("/rawInput/href"))
        // ChatCut MCP handoff (prefer internal browser URL over clean editorUrl)
        .or_else(|| raw.pointer("/rawOutput/browserHandoff/url"))
        .or_else(|| raw.pointer("/rawOutput/structuredContent/browserHandoff/url"))
        .or_else(|| raw.pointer("/rawOutput/content/browserHandoff/url"))
        .or_else(|| raw.pointer("/rawOutput/editorUrl"))
        .or_else(|| raw.pointer("/rawOutput/structuredContent/editorUrl"))
        .or_else(|| raw.pointer("/rawOutput/liveProject/url"))
        .or_else(|| raw.pointer("/content/browserHandoff/url"))
        .or_else(|| raw.pointer("/content/editorUrl"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| extract_chatcut_url_from_raw_text(raw));
    let command = raw
        .pointer("/rawInput/command")
        .or_else(|| raw.pointer("/rawInput/cmd"))
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(240).collect::<String>());
    let detail = command.or_else(|| {
        raw.pointer("/rawInput/query")
            .or_else(|| raw.pointer("/rawInput/pattern"))
            .or_else(|| raw.pointer("/rawInput/search"))
            .or_else(|| raw.pointer("/rawInput/q"))
            .or_else(|| raw.pointer("/rawInput/description"))
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(240).collect::<String>())
    });
    // When ChatCut handoff lives only in structured JSON text, surface a compact
    // detail snippet so frontend pure helpers can still parse browserHandoff.
    let detail = detail.or_else(|| extract_chatcut_detail_snippet(raw));
    (detail, path)
}

/// Scan rawOutput / content string blobs for a ChatCut editor or handoff URL.
fn extract_chatcut_url_from_raw_text(raw: &serde_json::Value) -> Option<String> {
    const PTRS: &[&str] = &[
        "/rawOutput",
        "/rawOutput/content",
        "/rawOutput/text",
        "/content",
        "/content/text",
    ];
    for p in PTRS {
        if let Some(s) = raw.pointer(p).and_then(|v| {
            if let Some(t) = v.as_str() {
                Some(t.to_string())
            } else {
                // Serialize small objects that may contain browserHandoff
                serde_json::to_string(v).ok()
            }
        }) {
            if let Some(url) = find_chatcut_editor_url_in_text(&s) {
                return Some(url);
            }
        }
    }
    None
}

fn extract_chatcut_detail_snippet(raw: &serde_json::Value) -> Option<String> {
    // Prefer compact JSON with handoff keys when present.
    for p in [
        "/rawOutput/browserHandoff",
        "/rawOutput/structuredContent",
        "/rawOutput",
    ] {
        if let Some(v) = raw.pointer(p) {
            if v.get("browserHandoff").is_some()
                || v.get("editorUrl").is_some()
                || v.get("liveProject").is_some()
                || p.ends_with("browserHandoff")
            {
                if let Ok(s) = serde_json::to_string(v) {
                    if s.contains("chatcut")
                        || s.contains("browserHandoff")
                        || s.contains("editorUrl")
                    {
                        return Some(s.chars().take(1200).collect());
                    }
                }
            }
        }
    }
    None
}

fn find_chatcut_editor_url_in_text(text: &str) -> Option<String> {
    // Prefer browserHandoff.url JSON field when present.
    if let Some(idx) = text.find("browserHandoff") {
        let slice = &text[idx..];
        if let Some(url) = find_https_url_near(slice, "chatcut") {
            return Some(url);
        }
    }
    if let Some(idx) = text.find("editorUrl") {
        let slice = &text[idx..];
        if let Some(url) = find_https_url_near(slice, "chatcut") {
            return Some(url);
        }
    }
    find_https_url_near(text, "chatcut.io").filter(|u| {
        u.contains("/editor") || u.contains("dockviewLayout") || u.contains("editor-boot-token")
    })
}

fn find_https_url_near(text: &str, must_contain: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 8 < bytes.len() {
        if bytes[i..].starts_with(b"https://") || bytes[i..].starts_with(b"http://") {
            let start = i;
            i += 8;
            while i < bytes.len() {
                let c = bytes[i];
                if c.is_ascii_whitespace()
                    || c == b'"'
                    || c == b'\''
                    || c == b'<'
                    || c == b'>'
                    || c == b')'
                    || c == b']'
                    || c == b'}'
                    || c == b','
                {
                    break;
                }
                i += 1;
            }
            let url = String::from_utf8_lossy(&bytes[start..i])
                .trim_end_matches(['.', ';', ':'])
                .to_string();
            if url.to_ascii_lowercase().contains(must_contain) {
                return Some(url);
            }
            continue;
        }
        i += 1;
    }
    None
}

/// Normalize ACP kind tokens so journal reload classifies correctly.
pub(super) fn normalize_tool_kind_for_journal(kind: &str, title: &str) -> String {
    let k = kind.trim().to_ascii_lowercase();
    let t = title.trim().to_ascii_lowercase();
    if k == "fetch" || t.starts_with("fetch:") || t == "web_fetch" || t.contains("web_fetch") {
        return "web_fetch".into();
    }
    if k == "search" || t.starts_with("web search") || t.contains("web_search") {
        return "web_search".into();
    }
    if k == "search_tool" || t == "search_tool" || t.starts_with("search tools") {
        return "search_tool".into();
    }
    if k == "use_tool" || t == "use_tool" || t.contains("__") {
        return "use_tool".into();
    }
    if !kind.trim().is_empty() {
        return kind.trim().to_string();
    }
    String::new()
}

/// Read the grok CLI tool meta block (`_meta["x.ai/tool"]`).
///
/// The key contains a literal `/`, so a JSON Pointer must escape it as `~1`
/// (RFC 6901). Plain `/_meta/x.ai/tool/...` never resolves and silently
/// dropped the machine tool name — journals then recorded `tool_step|…|tool|tool`.
pub(super) fn tool_meta(raw: &serde_json::Value) -> Option<&serde_json::Value> {
    raw.pointer("/_meta/x.ai~1tool")
        .or_else(|| raw.pointer("/_meta/tool"))
}

/// String field from the CLI tool meta block (`name` / `label` / `kind`).
pub(super) fn tool_meta_str(raw: &serde_json::Value, field: &str) -> Option<String> {
    tool_meta(raw)?
        .get(field)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Tool identity learned from the in_progress `tool_call` notification.
///
/// The grok CLI sends the full identity (`title`, `kind`, `toolName`, `rawInput`)
/// only on the *start* notification; the terminal `tool_call_update` is status-only
/// (`{toolCallId, status, content, rawOutput, locations}`) — without this map
/// the journal would record bare `tool_step|completed|tool|tool`.
#[derive(Debug, Clone, Default)]
pub(crate) struct ToolIdentity {
    /// Machine tool name, e.g. `read_file` (from `toolName`).
    pub(super) name: String,
    /// Human title, e.g. `Read` / `Run Command`.
    pub(super) title: String,
    /// CLI kind category, e.g. `read` / `execute` / `search`.
    pub(super) kind: String,
    /// Call argument worth showing (target file / command / query / url).
    pub(super) input: Option<String>,
}

/// Recover the tool call argument worth surfacing in the UI
/// (`rawInput` from the start notification).
pub(crate) fn extract_tool_input(raw: &serde_json::Value) -> Option<String> {
    let ri = raw.get("rawInput").or_else(|| raw.get("raw_input"))?;
    // Bare string first — some shell wrappers send `rawInput: "ls -la"`.
    // Must run before `as_object()?` or the string branch is dead code.
    if let Some(s) = ri.as_str() {
        let t = s.trim();
        if !t.is_empty() && t != "null" {
            return Some(t.to_string());
        }
    }
    let obj = ri.as_object()?;
    const ORDER: [&str; 11] = [
        "target_file",
        "target_directory",
        "file_path",
        "path",
        "folder",
        "dir",
        "command",
        "cmd",
        "query",
        "url",
        "description",
    ];
    for key in ORDER {
        if let Some(v) = obj.get(key) {
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() && t != "null" {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

/// Remember tool identity when a notification carries any of it. Never
/// downgrades an existing richer record with a sparse payload (terminal
/// updates arrive after the start notification and are status-only).
///
/// `map`: app session id → tool call id → identity.
pub(super) fn remember_tool_identity(
    map: &std::sync::Mutex<HashMap<String, HashMap<String, ToolIdentity>>>,
    app_sid: &str,
    tool_call_id: &str,
    title: &str,
    kind: &str,
    raw: &serde_json::Value,
) {
    if app_sid.is_empty() || tool_call_id.is_empty() {
        return;
    }
    let name = raw
        .get("toolName")
        .or_else(|| raw.get("tool_name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        // grok CLI never sends a top-level `toolName`: the machine name lives in
        // `_meta["x.ai/tool"].name` on the start notification only.
        .or_else(|| tool_meta_str(raw, "name"))
        .unwrap_or_default();
    let t = title.trim();
    let k = kind.trim();
    let input = extract_tool_input(raw);
    let sparse = t.is_empty() && k.is_empty() && name.is_empty() && input.is_none();
    if sparse {
        return;
    }
    let mut map = map.lock().expect("tool identity map poisoned");
    let per = map.entry(app_sid.to_string()).or_default();
    // Cap per-session entries so long-lived hosts cannot grow unboundedly.
    if per.len() >= 2000 && !per.contains_key(tool_call_id) {
        return;
    }
    let existing = per.get(tool_call_id);
    let richer = existing.is_none_or(|e| {
        let e_sparse =
            e.name.is_empty() && e.title.is_empty() && e.kind.is_empty() && e.input.is_none();
        let mine_sparse = name.is_empty() && t.is_empty() && k.is_empty() && input.is_none();
        !e_sparse
            || mine_sparse
            || (e.title.is_empty() && !t.is_empty())
            || (e.kind.is_empty() && !k.is_empty())
            || (e.name.is_empty() && !name.is_empty())
            || (e.input.is_none() && input.is_some())
    });
    if richer {
        per.insert(
            tool_call_id.to_string(),
            ToolIdentity {
                name,
                title: t.to_string(),
                kind: k.to_string(),
                input,
            },
        );
    }
}

/// Recover identity for a sparse terminal event from the start notification.
/// Returns `(title, kind, name, input)` — falls back to the event's own
/// values; `name` is the machine tool name, `input` the call argument.
pub(super) fn resolve_tool_identity(
    map: &std::sync::Mutex<HashMap<String, HashMap<String, ToolIdentity>>>,
    app_sid: &str,
    tool_call_id: &str,
    title: &str,
    kind: &str,
) -> (String, String, String, Option<String>) {
    if app_sid.is_empty() || tool_call_id.is_empty() {
        return (title.to_string(), kind.to_string(), String::new(), None);
    }
    let map = map.lock().expect("tool identity map poisoned");
    let Some(id) = map.get(app_sid).and_then(|m| m.get(tool_call_id)) else {
        return (title.to_string(), kind.to_string(), String::new(), None);
    };
    let t = title.trim();
    let k = kind.trim();
    let title_out = if t.is_empty() || t.eq_ignore_ascii_case("tool") {
        if !id.title.is_empty() && !id.title.eq_ignore_ascii_case("tool") {
            id.title.clone()
        } else if !id.name.is_empty() {
            id.name.clone()
        } else {
            title.to_string()
        }
    } else {
        title.to_string()
    };
    let kind_out = if k.is_empty() || k.eq_ignore_ascii_case("tool") {
        if !id.kind.is_empty() && !id.kind.eq_ignore_ascii_case("tool") {
            id.kind.clone()
        } else if !id.name.is_empty() {
            id.name.clone()
        } else {
            kind.to_string()
        }
    } else {
        kind.to_string()
    };
    (title_out, kind_out, id.name.clone(), id.input.clone())
}

/// Recover tool kind/title when the completed `tool_call_update` is sparse
/// (status-only payloads leave title empty → journal became `tool_step|completed||tool`).
pub(super) fn enrich_tool_identity_from_raw(
    raw: &serde_json::Value,
    title: &str,
    kind: &str,
) -> (String, String) {
    let mut title_out = title.trim().to_string();
    let mut kind_out = kind.trim().to_string();

    let pick_str = |ptrs: &[&str]| -> Option<String> {
        for p in ptrs {
            if let Some(s) = raw.pointer(p).and_then(|v| v.as_str()).map(str::trim) {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
        None
    };

    if title_out.is_empty() || title_out.eq_ignore_ascii_case("tool") {
        // Top-level camelCase `toolName` (grok CLI start payloads).
        if let Some(tn) = raw
            .get("toolName")
            .or_else(|| raw.get("tool_name"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            title_out = tn.to_string();
        }
        let mcp_tool = pick_str(&["/rawOutput/tool_name", "/rawInput/tool_name"]);
        let mcp_server = pick_str(&["/rawOutput/server_name", "/rawOutput/server"]);
        let meta_name = tool_meta_str(raw, "name").or_else(|| tool_meta_str(raw, "label"));
        let variant = pick_str(&["/rawInput/variant"]);
        let update_title = pick_str(&["/title"]);

        if let (Some(tool), Some(server)) = (mcp_tool.as_ref(), mcp_server.as_ref()) {
            title_out = if tool.contains("__") {
                tool.clone()
            } else {
                format!("{server}__{tool}")
            };
        } else if let Some(tn) = mcp_tool {
            title_out = tn;
        } else if let Some(t) = update_title.filter(|t| !t.eq_ignore_ascii_case("tool")) {
            title_out = t;
        } else if let Some(n) = meta_name {
            title_out = match n.as_str() {
                "search_tool" | "SearchTool" => "search_tool".into(),
                "use_tool" | "UseTool" => "use_tool".into(),
                other => other.to_string(),
            };
        } else if let Some(v) = variant {
            title_out = match v.as_str() {
                "SearchTool" => "search_tool".into(),
                "UseTool" => "use_tool".into(),
                other => other.to_string(),
            };
        } else if let Some(q) = pick_str(&["/rawInput/query"]) {
            title_out = format!("Search tools: \"{q}\"");
        }
    }

    if kind_out.is_empty() || kind_out.eq_ignore_ascii_case("other") {
        kind_out = normalize_tool_kind_for_journal(&kind_out, &title_out);
        if kind_out.is_empty() {
            if let Some(n) = tool_meta_str(raw, "name").or_else(|| pick_str(&["/rawInput/variant"]))
            {
                kind_out = match n.as_str() {
                    "SearchTool" | "search_tool" => "search_tool".into(),
                    "UseTool" | "use_tool" => "use_tool".into(),
                    other => other.to_ascii_lowercase(),
                };
            }
        }
        if kind_out.is_empty() && !title_out.is_empty() {
            kind_out = normalize_tool_kind_for_journal("", &title_out);
        }
        if kind_out.is_empty() {
            kind_out = "tool".into();
        }
    }

    if title_out.is_empty() {
        title_out = if kind_out != "tool" {
            kind_out.replace('_', " ")
        } else {
            "tool".into()
        };
    }

    (kind_out, title_out)
}

/// Persist a Host side-channel tool (vision) into the session journal so
/// reload weaves it into the same activity rail as native ACP tools.
pub(super) fn journal_host_tool_step(
    app_sid: &str,
    tool_call_id: &str,
    status: &str,
    kind: &str,
    title: &str,
    detail: &str,
) {
    if app_sid.is_empty() || tool_call_id.is_empty() {
        return;
    }
    let st = if status.is_empty() {
        "completed"
    } else {
        status
    };
    let kind_store = if kind.is_empty() { "tool" } else { kind };
    let label = if title.trim().is_empty() {
        kind_store
    } else {
        title.trim()
    };
    let mut content = format!("tool_step|{st}|{kind_store}|{label}");
    let d = detail.trim();
    if !d.is_empty() {
        content.push('\n');
        // Cap journal size; UI already holds live stream via session://tool.
        content.push_str(&d.chars().take(6_000).collect::<String>());
    }
    let mid = format!("tool-{tool_call_id}");
    let mut msgs = store::load_messages(app_sid);
    if let Some(slot) = msgs.iter_mut().find(|m| m.id == mid) {
        if tool_journal_richer(&slot.content, &content) {
            slot.content = content;
            slot.marker = Some("tool_step".into());
            slot.is_error = matches!(st, "failed" | "error");
            if let Err(e) = store::save_messages(app_sid, &msgs) {
                tracing::error!(session = %app_sid, tool = %tool_call_id, "host tool journal update failed: {e}");
            }
        }
    } else {
        if let Err(e) = store::append_message(
            app_sid,
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
        ) {
            tracing::error!(session = %app_sid, tool = %tool_call_id, "host tool journal append failed: {e}");
        }
    }
}

/// Collapse newlines/whitespace so `tool_step|status|kind|title` stays one line.
/// Multi-line shell titles (`Execute \`line1\nline2\``) previously broke journal
/// parsing: only the first line was header, and the `input:` marker got buried.
pub(super) fn tool_journal_one_line(raw: &str, max_chars: usize) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    collapsed.chars().take(max_chars).collect()
}

/// Prefer human-readable journal labels (never bare “tool” when we have better).
pub(super) fn tool_journal_label(
    title: &str,
    kind: &str,
    detail: &Option<String>,
    path: &Option<String>,
) -> String {
    let t = title.trim();
    if !t.is_empty() && !t.eq_ignore_ascii_case("tool") && t != "web_fetch" && t != "web_search" {
        // Always single-line — header format is `tool_step|…|title`.
        return tool_journal_one_line(t, 240);
    }
    // "Fetch: https://…" style titles from tool_call_update
    if t.to_ascii_lowercase().starts_with("fetch:") {
        return t.to_string();
    }
    if let Some(p) = path.as_ref().filter(|p| !p.is_empty()) {
        return p.clone();
    }
    if let Some(d) = detail.as_ref().filter(|d| !d.is_empty()) {
        return d.clone();
    }
    let k = kind.trim();
    if !k.is_empty() && !k.eq_ignore_ascii_case("tool") {
        return k.replace('_', " ");
    }
    if !t.is_empty() {
        return t.to_string();
    }
    "tool".into()
}

/// True if `next` journal body is richer than `prev` (do not downgrade on upsert).
pub(crate) fn tool_journal_richer(prev: &str, next: &str) -> bool {
    if prev == next {
        return false;
    }
    let prev_generic = prev.contains("|tool") || prev.ends_with("|tool");
    let next_generic = next.contains("|tool\n") || next.ends_with("|tool");
    if prev_generic && !next_generic {
        return true;
    }
    if !prev_generic && next_generic {
        return false;
    }
    // Prefer rows with URL / multi-line detail
    let score = |s: &str| {
        let mut n = s.len();
        if s.contains("https://") || s.contains("http://") {
            n += 500;
        }
        if s.contains('\n') {
            n += 100;
        }
        n
    };
    score(next) > score(prev)
}

pub(super) fn take_tool_content_str(v: Option<&serde_json::Value>) -> Option<String> {
    let s = v.and_then(|x| x.as_str())?;
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(TOOL_CONTENT_SNIPPET_MAX).collect())
}

/// Optional before/after text for the session diff panel (from rawInput when present).
/// - str_replace / search_replace: old_string → before, new_string → after
/// - write / create_file: contents → after
pub(super) fn extract_tool_content_snippets(
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

/// Cap persisted tool output so a single `cat` of a huge file cannot bloat the
/// journal. The live event carries the same cap; the UI scrolls inside expand.
pub(super) const TOOL_OUTPUT_MAX: usize = 20_000;

/// Same cap, re-exported for the CLI session importer (`cli_sessions`).
pub(crate) const TOOL_OUTPUT_MAX_PUB: usize = TOOL_OUTPUT_MAX;

/// Marker line that separates the legacy `tool_step|` body from real tool
/// output. Everything before it keeps the historical layout byte-for-byte, so
/// old journals and the positional `detail\npath` heuristic stay valid; the
/// parser only has to split on this line. Chosen to never collide with stdout.
pub(crate) const TOOL_OUTPUT_SENTINEL: &str = "\u{1}output";

/// Real tool **output** from the ACP terminal `tool_call_update`.
///
/// Grok CLI puts what the tool produced in `content[]`, which this crate
/// previously never read — so `detail` only ever held the *call argument*
/// echoed back from `rawInput`, and read/list/search tools (no command/query
/// key) produced no expandable body at all.
///
/// Shapes observed on the wire:
/// - `{"type":"content","content":{"type":"text","text":"…"}}` — stdout / file text
/// - `{"type":"diff","path":…,"oldText":…,"newText":…}` — edit/write preview
///
/// Diff entries are summarized as a `--- path` header (the diff panel renders
/// the real before/after via {@link extract_tool_content_snippets}).
pub(super) fn extract_tool_output(raw: &serde_json::Value) -> Option<String> {
    let items = raw.get("content")?.as_array()?;
    let mut out = String::new();
    for item in items {
        // Bare string entries (lenient wrappers).
        if let Some(s) = item.as_str() {
            push_output_chunk(&mut out, s);
            continue;
        }
        let obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };
        let ty = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if ty == "diff" {
            let path = obj.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if !path.is_empty() {
                push_output_chunk(&mut out, &format!("--- {path}"));
            }
            continue;
        }
        // `{type:"content", content:{type:"text", text:"…"}}`
        let text = obj
            .get("content")
            .and_then(|c| c.get("text"))
            .and_then(|v| v.as_str())
            // Some wrappers inline the text one level up.
            .or_else(|| obj.get("text").and_then(|v| v.as_str()));
        if let Some(t) = text {
            push_output_chunk(&mut out, t);
        }
        if out.chars().count() >= TOOL_OUTPUT_MAX {
            break;
        }
    }
    let trimmed = out.trim_end();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(TOOL_OUTPUT_MAX).collect())
}

fn push_output_chunk(out: &mut String, chunk: &str) {
    if chunk.trim().is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(chunk);
}

/// When user asks to open a Grok App / foreign agent session by UUID, steer tools.
pub(super) fn session_lookup_host_hint(user_text: &str) -> Option<String> {
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

pub(super) fn regex_is_session_uuid(text: &str) -> bool {
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

pub(super) fn is_uuid_str(s: &str) -> bool {
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

/// Normalize a media path/URL from MCP / ChatCut tool text.
/// - Protocol-relative `//host/…` → `https://host/…` (S3 thumbnails)
/// - Angle-bracket placeholders (`/<frame-name>.jpg`) → reject
/// - Collapse `//` only inside local absolute paths
pub(super) fn normalize_media_ref(path: &str) -> Option<String> {
    let t = path.trim();
    if t.is_empty() {
        return None;
    }
    if t.contains('<') || t.contains('>') || t.contains('{') || t.contains('}') {
        return None;
    }
    // Protocol-relative remote URL (not /// weird absolute).
    if t.starts_with("//") && !t.starts_with("///") {
        let host = t.trim_start_matches('/').split('/').next().unwrap_or("");
        if host.contains('.') || host.eq_ignore_ascii_case("localhost") {
            return Some(format!("https:{t}"));
        }
        return None;
    }
    if t.starts_with("https://") || t.starts_with("http://") {
        return Some(t.to_string());
    }
    if t.starts_with('/') {
        // Local absolute: collapse accidental double slashes (…/T//chatcut-…).
        let collapsed = t
            .split('/')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("/");
        return Some(format!("/{collapsed}"));
    }
    // Windows absolute
    if t.len() > 3 && t.as_bytes().get(1) == Some(&b':') {
        return Some(t.to_string());
    }
    None
}

/// True for local filesystem media paths (not remote http(s) / protocol-relative).
pub(super) fn is_local_media_fs_path(path: &str) -> bool {
    let Some(n) = normalize_media_ref(path) else {
        return false;
    };
    if n.starts_with("http://") || n.starts_with("https://") {
        return false;
    }
    is_media_fs_path(&n)
}

/// First media ref found in free text (MCP / markdown).
/// Prefers remote https media URLs, then local absolute media paths.
pub(super) fn first_media_path_in_text(text: &str) -> Option<String> {
    // Explicit https://…media
    for token in text.split_whitespace() {
        let t = token.trim_matches(|c: char| matches!(c, '`' | '"' | '\'' | ')' | ']' | '(' | '['));
        if let Some(n) = normalize_media_ref(t) {
            if (n.starts_with("http://") || n.starts_with("https://")) && is_media_fs_path(&n) {
                return Some(n);
            }
        }
    }
    // ` /abs/path/to/file.jpg ` or `//cdn/…`
    for part in text.split('`') {
        let p = part.trim();
        if let Some(n) = normalize_media_ref(p) {
            if is_media_fs_path(&n) {
                // Prefer remote URLs and multi-segment local paths; skip
                // single-segment false extracts like `/img_001.png`.
                if n.starts_with("http://") || n.starts_with("https://") {
                    return Some(n);
                }
                if is_plausible_local_media_abs(&n) {
                    return Some(n);
                }
            }
        }
    }
    // Bare absolute path token (stop at whitespace / quote / paren / markdown).
    // Only start at a path boundary — never mid-relative like `media/img_001.png`
    // where the `/` would false-extract `/img_001.png` (breaks chat attachments).
    let mut start = None;
    for (i, ch) in text.char_indices() {
        if ch == '/' && start.is_none() {
            let prev_ok = if i == 0 {
                true
            } else {
                // Previous char must not be part of a relative path segment.
                let prev = text[..i].chars().next_back().unwrap_or('\0');
                matches!(
                    prev,
                    ' ' | '\n'
                        | '\r'
                        | '\t'
                        | '`'
                        | '"'
                        | '\''
                        | '('
                        | '['
                        | '='
                        | ':'
                        | ','
                        | '（'
                        | '!'
                        | '<'
                        | '>'
                )
            };
            if prev_ok {
                start = Some(i);
            }
            continue;
        }
        if let Some(s) = start {
            let end = matches!(
                ch,
                ' ' | '\n' | '\r' | '\t' | '"' | '\'' | ')' | ']' | '`' | '（' | '）'
            );
            if end || i + ch.len_utf8() >= text.len() {
                let end_i = if end { i } else { text.len() };
                let candidate = text[s..end_i].trim_end_matches(['.', ',', ';', '。', '，']);
                if let Some(n) = normalize_media_ref(candidate) {
                    // Reject single-segment abs media (`/img_001.png`) — almost always
                    // a false extract; real workspace media has ≥2 segments.
                    if is_plausible_local_media_abs(&n)
                        || ((n.starts_with("http://") || n.starts_with("https://"))
                            && is_media_fs_path(&n))
                    {
                        return Some(n);
                    }
                }
                start = None;
            }
        }
    }
    None
}

/// Local media abs path worth attaching: real multi-segment FS path, not
/// `/basename.png` false extracts from markdown relatives.
pub(super) fn is_plausible_local_media_abs(path: &str) -> bool {
    if !is_local_media_fs_path(path) {
        return false;
    }
    let n = normalize_media_ref(path).unwrap_or_else(|| path.to_string());
    if n.starts_with("http://") || n.starts_with("https://") {
        return false;
    }
    // Windows drive always multi-part enough.
    if n.len() > 3 && n.as_bytes().get(1) == Some(&b':') {
        return true;
    }
    let segs: Vec<&str> = n.split('/').filter(|s| !s.is_empty()).collect();
    segs.len() >= 2
}

/// Accept normalized media refs for attach candidates.
fn accept_media_ref(s: &str) -> Option<String> {
    let n = normalize_media_ref(s)?;
    if !is_media_fs_path(&n) {
        return None;
    }
    if n.starts_with("http://") || n.starts_with("https://") {
        return Some(n);
    }
    // Local: require multi-segment abs (reject `/img_001.png` false extracts).
    if is_plausible_local_media_abs(&n) {
        Some(n)
    } else {
        None
    }
}

/// Structured media only: `rawOutput.path`, JSON `path` / thumbnail keys.
/// These are intentional tool outputs (image_gen, ChatCut create_project, …)
/// and may force a path_scope grant even outside default roots.
pub(super) fn extract_structured_media_path(raw: &serde_json::Value) -> Option<String> {
    // ImageGen / ImageEdit / video tools rawOutput
    if let Some(path) = raw
        .pointer("/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if let Some(n) = accept_media_ref(path) {
            return Some(n);
        }
    }
    // Nested under toolCall (some hosts wrap)
    if let Some(path) = raw
        .pointer("/toolCall/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if let Some(n) = accept_media_ref(path) {
            return Some(n);
        }
    }
    // content[].content.text as JSON with path / thumbnail fields
    if let Some(arr) = raw.get("content").and_then(|v| v.as_array()) {
        for item in arr {
            let text = item
                .pointer("/content/text")
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str());
            if let Some(t) = text {
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(t) {
                    if let Some(path) = j.get("path").and_then(|v| v.as_str()) {
                        if let Some(n) = accept_media_ref(path) {
                            return Some(n);
                        }
                    }
                    // ChatCut: thumbnail / imageUrl (not freeform editorUrl text)
                    for key in ["thumbnail", "thumbnailUrl", "imageUrl"] {
                        if let Some(u) = j.get(key).and_then(|v| v.as_str()) {
                            if let Some(n) = accept_media_ref(u) {
                                return Some(n);
                            }
                        }
                    }
                }
            }
        }
    }
    // Top-level structured ChatCut fields
    for key in [
        "/rawOutput/thumbnail",
        "/rawOutput/thumbnailUrl",
        "/rawOutput/imageUrl",
        "/rawOutput/structuredContent/thumbnail",
        "/rawOutput/structuredContent/thumbnailUrl",
    ] {
        if let Some(u) = raw.pointer(key).and_then(|v| v.as_str()) {
            if let Some(n) = accept_media_ref(u) {
                return Some(n);
            }
        }
    }
    None
}

/// Freeform media scan in tool text (OkayOutput markdown, content text paths).
/// Soft attach only — do not force-grant paths outside path_scope / project.
pub(super) fn extract_freeform_media_path(raw: &serde_json::Value) -> Option<String> {
    // MCP use_tool result: rawOutput.output.OkayOutput | output (string)
    for key in [
        "/rawOutput/output/OkayOutput",
        "/rawOutput/output",
        "/rawOutput/output/text",
        "/toolCall/rawOutput/output/OkayOutput",
        "/toolCall/rawOutput/output",
    ] {
        if let Some(t) = raw.pointer(key).and_then(|v| v.as_str()) {
            if let Some(p) = first_media_path_in_text(t) {
                return Some(p);
            }
        }
    }
    if let Some(arr) = raw.get("content").and_then(|v| v.as_array()) {
        for item in arr {
            let text = item
                .pointer("/content/text")
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str());
            if let Some(t) = text {
                // Skip pure JSON objects handled as structured above; still scan
                // freeform markdown that happens to parse as JSON without path keys.
                if let Some(p) = first_media_path_in_text(t) {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// True when a tool may legitimately surface media refs in its *freeform*
/// output text (MCP / image / vision / web-research tools).
///
/// Terminal, file-read, search, edit and plan tools print arbitrary text —
/// e.g. a `curl` scrape of a homepage lists image URLs purely incidentally.
/// Scanning their output for https media would attach an unrelated image card
/// to the assistant message (azhen-irene.jpg from a CDN-review curl).
/// Structured `rawOutput` media (image_gen, ChatCut thumbnail keys) is still
/// trusted unconditionally via `extract_structured_media_path`.
///
/// Kept capable: `web_fetch` / `web_search` (research content may carry
/// relevant media refs), image/video tools, MCP `use_tool` (ChatCut
/// plain-text thumbs) and unknown tools (default-on avoids regressing new
/// MCP servers). Sparse terminal updates that lost their identity are caught
/// by the `rawInput.command` hint.
pub(super) fn tool_is_media_capable(
    name: &str,
    kind: &str,
    title: &str,
    raw: &serde_json::Value,
) -> bool {
    let n = name.to_ascii_lowercase();
    let k = kind.to_ascii_lowercase();
    let t = title.to_ascii_lowercase();
    // Terminal command execution: stdout is arbitrary.
    if k.contains("execute")
        || k.contains("terminal")
        || k.contains("shell")
        || n.contains("terminal")
        || n.contains("shell")
        || t.contains("execute")
        || t.contains("run command")
    {
        return false;
    }
    // Local file read / search / edit / plan tools (media-delivery.md:
    // freeform from reads / ls / markdown attaches only allowlisted locals).
    if n.starts_with("read")
        || n.starts_with("list")
        || n.starts_with("grep")
        || n.starts_with("search")
        || n.starts_with("write")
        || n.starts_with("markdown")
        || n.starts_with("todo")
        || k.starts_with("read")
        || k.starts_with("list")
        || k.starts_with("grep")
        || k.starts_with("search")
        || k.starts_with("write")
        || k.starts_with("markdown")
    {
        return false;
    }
    // Background task plumbing.
    if n.contains("command_or_subagent") || n.contains("kill_command") || k.contains("subagent") {
        return false;
    }
    // Sparse terminal updates may lack identity: a `command` argument is a
    // free-text execution signal (MCP image tools never carry one).
    let has_command = raw
        .pointer("/rawInput/command")
        .or_else(|| raw.pointer("/raw_input/command"))
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if has_command {
        return false;
    }
    true
}

/// Pull media path/URL from ACP tool_call / tool_call_update payload
/// (image_gen, image_edit, image_to_video, reference_to_video, MCP / ChatCut, …).
/// Returns normalized local path or https URL (never protocol-relative / placeholders).
/// Prefers structured fields, then freeform text.
///
/// Live attach uses structured/freeform separately (different grant policy);
/// this composite remains for tests and any caller that only needs the path.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn extract_generated_media_path(raw: &serde_json::Value) -> Option<String> {
    extract_structured_media_path(raw).or_else(|| extract_freeform_media_path(raw))
}

/// Decide whether a completed tool should persist a chat image/video card.
///
/// - Structured `rawOutput.path` (image_gen / image_edit / ChatCut thumbs):
///   force-grant, even outside the project.
/// - Freeform text: only media-capable tools (not read / list / terminal).
/// - `path_hint` (`locations` / `target_file`): same gate as freeform.
///   A `read_file` of a user-attached image is already on the user bubble;
///   attaching it again paints a leftover ImageUi that 403s outside the
///   project (`~/Documents/图片/…`).
pub(super) fn completed_tool_media_attachment(
    raw: &serde_json::Value,
    name: &str,
    kind: &str,
    title: &str,
    project_path: Option<&str>,
    status: &str,
) -> Option<String> {
    if status != "completed" {
        return None;
    }
    let capable = tool_is_media_capable(name, kind, title, raw);
    let structured = extract_structured_media_path(raw);
    let freeform = if structured.is_none() && capable {
        extract_freeform_media_path(raw)
    } else {
        None
    };
    if let Some(p) = structured.as_deref() {
        if let Some(out) = prepare_media_attachment_path(p, project_path, true) {
            return Some(out);
        }
    }
    if let Some(p) = freeform.as_deref() {
        if let Some(out) = prepare_media_attachment_path(p, project_path, false) {
            return Some(out);
        }
    }
    if capable {
        let (_, hint) = extract_tool_ui_fields(raw);
        if let Some(p) = hint.as_deref().filter(|s| !s.is_empty()) {
            return prepare_media_attachment_path(p, project_path, false);
        }
    }
    None
}

/// Normalize + gate a media path before persisting as a chat attachment.
///
/// - Remote `http(s)` media: always ok when it looks like media.
/// - Local: file must exist and be multi-segment (no `/img_001.png` false extracts).
/// - `force_grant`: structured tool outputs may live outside default path_scope
///   roots (Desktop image_gen, etc.) — grant so loopback media HTTP can serve them.
/// - Soft (freeform / path_hint): only attach when already allowlisted or under
///   the session project — prevents incidental reads of `~/.codex/.../logo.png`
///   from becoming dead paperclip thumbs.
pub(super) fn prepare_media_attachment_path(
    path: &str,
    project_path: Option<&str>,
    force_grant: bool,
) -> Option<String> {
    let n = normalize_media_ref(path).unwrap_or_else(|| path.to_string());
    if n.starts_with("http://") || n.starts_with("https://") {
        return if is_media_fs_path(&n) { Some(n) } else { None };
    }
    if !is_plausible_local_media_abs(&n) {
        return None;
    }
    let pb = std::path::Path::new(&n);
    if !pb.is_file() {
        return None;
    }
    let allowed = crate::path_scope::is_allowed(pb);
    let under_project = project_path
        .map(|proj| {
            let proj_p = std::path::Path::new(proj);
            if pb.starts_with(proj_p) {
                return true;
            }
            match (pb.canonicalize(), proj_p.canonicalize()) {
                (Ok(c), Ok(r)) => c.starts_with(r),
                _ => false,
            }
        })
        .unwrap_or(false);
    if force_grant || allowed || under_project {
        // Always grant so history thumbs work without relying on a later
        // paths_classify race (live stream attach used to skip grant → paperclip).
        crate::path_scope::grant_path(pb);
        Some(n)
    } else {
        None
    }
}

pub(super) fn is_image_fs_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".avif",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

pub(super) fn is_video_fs_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [
        ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".ogv", ".mpeg", ".mpg",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

pub(super) fn is_media_fs_path(path: &str) -> bool {
    is_image_fs_path(path) || is_video_fs_path(path)
}

pub(super) fn attachment_from_path(path: &str) -> MessageAttachmentStored {
    // Normalize ChatCut protocol-relative / placeholder / double-slash paths.
    let path = normalize_media_ref(path).unwrap_or_else(|| path.to_string());
    let name = if path.starts_with("http://") || path.starts_with("https://") {
        path.rsplit('/').next().unwrap_or(path.as_str()).to_string()
    } else {
        std::path::Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone())
    };
    // Percent-decode display name when possible (ChatCut S3 keys).
    let name = urlencoding_soft_decode(&name);
    MessageAttachmentStored {
        path,
        name,
        is_dir: false,
    }
}

fn urlencoding_soft_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Append sole-line `@/abs/path` refs for journal dual-write (idempotent).
///
/// Preserves **internal** blank lines in the user body. Only a trailing run of
/// blank lines at the end of the body (before the `@path` block) is normalized
/// to a single separator empty line — mirrors FE `parseAttachmentsFromContent`.
pub(super) fn append_journal_attachment_refs(
    content: String,
    atts: &[MessageAttachmentStored],
) -> String {
    if atts.is_empty() {
        return content.replace("\r\n", "\n").replace('\r', "\n");
    }
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    // Peel existing trailing sole-line @path refs so we can re-merge idempotently.
    let mut prior_refs: Vec<String> = Vec::new();
    while let Some(last) = lines.last() {
        let t = last.trim();
        if let Some(rest) = t.strip_prefix('@') {
            let path = rest.trim();
            if !path.is_empty() {
                prior_refs.push(lines.pop().unwrap());
                continue;
            }
        }
        break;
    }
    prior_refs.reverse();

    // Drop only trailing blank lines of the body — keep internal `\n\n`.
    while lines.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        lines.pop();
    }

    let mut existing: std::collections::HashSet<String> = prior_refs
        .iter()
        .filter_map(|l| {
            l.trim()
                .strip_prefix('@')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
        })
        .collect();

    let mut new_refs: Vec<String> = Vec::new();
    for a in atts {
        let path = a.path.trim();
        if path.is_empty() || !existing.insert(path.to_string()) {
            continue;
        }
        new_refs.push(format!("@{path}"));
    }

    let mut refs = prior_refs;
    refs.extend(new_refs);
    if refs.is_empty() {
        return lines.join("\n");
    }
    if !lines.is_empty() {
        lines.push(String::new());
    }
    lines.extend(refs);
    lines.join("\n")
}

/// Result of taking agent processes out of live / background / parked / prewarm maps.
pub(super) struct DrainedAgents {
    pub(super) acps: Vec<Arc<AcpClient>>,
    pub(super) had_live_shell: bool,
    pub(super) background_count: usize,
    pub(super) parked_count: usize,
    /// Ready prewarm processes drained (Spawning slots are cleared without a kill handle).
    pub(super) prewarm_count: usize,
}

/// Whole-connect budget: lock wait + spawn + initialize + load/new.
/// Sibling-task timer so a blocking ACP poll cannot starve it; lock wait is
/// inside this budget (otherwise Connecting never times out).
pub const CONNECT_WALL_CLOCK_SECS: u64 = 90;

/// Idle recycle / disconnect must not wait forever for `connect_lock`.
pub const CONNECT_LOCK_WATCHDOG_SECS: u64 = 5;

/// `AcpClient::kill` under the recycle watchdog — a hung child must not
/// pin `connect_lock` for the rest of the process lifetime.
pub const ACP_KILL_TIMEOUT_SECS: u64 = 5;

/// Hard bound for initialize / openSession RPC inside `connect_lock`.
/// Must stay below the 90s wall-clock so a wedged handshake fails closed
/// without waiting for abort as the only backstop.
pub const CONNECT_HANDSHAKE_BUDGET_SECS: u64 = 60;

/// Consecutive idle-recycle skips before `connect_lock busy` escalates from
/// warn to error with holder context. Idle recycle ticks every 30s, so 12
/// skips is about six minutes — long enough that a 90s wall-clock abort
/// should already have run.
pub const CONNECT_LOCK_BUSY_ESCALATE_TICKS: u32 = 12;

/// Child spawned during connect, recorded before it is bound into a live
/// slot so a wall-clock abort can still `kill_acp_bounded` it.
#[derive(Clone)]
pub struct PendingAcpChild {
    pub session_id: Option<String>,
    pub process_id: String,
    pub acp: std::sync::Arc<crate::acp_client::AcpClient>,
}

/// Who currently holds `connect_lock` (best-effort diagnostics).
#[derive(Clone, Debug)]
pub struct ConnectLockHolderInfo {
    pub session_id: Option<String>,
    pub phase: &'static str,
    pub since: std::time::Instant,
}

/// Why a connect attempt gave up. `lock_acquired` is false when we never
/// entered `connect_inner`.
pub fn connect_gave_up_reason(lock_acquired: bool) -> &'static str {
    if lock_acquired {
        "connect timed out"
    } else {
        "connect lock busy"
    }
}

/// Latest-wins generation: only the current attempt may enter `connect_inner`.
pub fn connect_attempt_still_current(current: u64, attempt_gen: u64) -> bool {
    current == attempt_gen
}

/// Invalidate `attempt_gen` only if it is still the latest connect.
pub fn next_connect_epoch_on_timeout(current: u64, attempt_gen: u64) -> u64 {
    if current == attempt_gen {
        attempt_gen.wrapping_add(1)
    } else {
        current
    }
}

/// Pure policy: should connect keep the live agent process instead of respawning?
///
/// Terminal states never preserve — leftover busy flags after a failed turn
/// (`deferred_prompt_complete`, open tools, …) must not block reconnect.
///
/// `Connecting` is **not** healthy: handshake is unfinished. Preserving it
/// made every later `session_connect` no-op the same Connecting snapshot
/// until the app was restarted.
pub(super) fn connect_should_preserve_live_process(state: SessionState, busy: bool) -> bool {
    match state {
        SessionState::Streaming | SessionState::AwaitingPermission => true,
        SessionState::Connecting => false,
        SessionState::Ready => busy,
        SessionState::Idle | SessionState::Disconnected => false,
    }
}

/// Whether `ProcessExited` should fail the FSM (crash / connect_failed).
///
/// Connecting used to be excluded so initialize could report a richer error.
/// If that waiter is gone, the session stayed Connecting until restart.
pub(super) fn process_exit_should_fail_fsm(state: SessionState, has_err: bool) -> bool {
    if has_err {
        return false;
    }
    matches!(
        state,
        SessionState::Ready
            | SessionState::Streaming
            | SessionState::AwaitingPermission
            | SessionState::Connecting
    )
}

/// Wall-clock timeout may only tear down an unfinished handshake.
pub(super) fn should_fail_connect_on_wall_clock(state: SessionState) -> bool {
    matches!(state, SessionState::Connecting)
}

/// User Stop / Retry on a handshake must abort it (not treat it as a turn).
pub(super) fn stop_should_abort_handshake(state: SessionState) -> bool {
    matches!(state, SessionState::Connecting)
}

/// Pure policy: may a provider `retry_state` fail the host turn / write chat error?
///
/// Excludes `Connecting` so `session/load` reconnect residual retries cannot
/// journal-poison an idle chat. See diagnostic session 65fa7759 (NETWORK_PROVIDER
/// rows on reconnect without `session/prompt`).
pub(super) fn should_apply_provider_retry_abort_flags(
    prompt_in_flight: bool,
    has_streaming_message: bool,
    has_open_tools: bool,
    deferred_prompt_complete: bool,
    state: SessionState,
) -> bool {
    if prompt_in_flight {
        return true;
    }
    if has_streaming_message || has_open_tools || deferred_prompt_complete {
        return true;
    }
    matches!(
        state,
        SessionState::Streaming | SessionState::AwaitingPermission
    )
}

#[cfg(test)]
mod journal_attach_tests {
    use super::append_journal_attachment_refs;
    use crate::store::MessageAttachmentStored;

    fn att(path: &str) -> MessageAttachmentStored {
        MessageAttachmentStored {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            is_dir: false,
        }
    }

    #[test]
    fn append_preserves_internal_blank_lines() {
        let body = "a\n\nb\n\nc".to_string();
        let out = append_journal_attachment_refs(body, &[att("/tmp/shot.png")]);
        assert_eq!(out, "a\n\nb\n\nc\n\n@/tmp/shot.png");
        assert!(out.contains("a\n\nb\n\nc"));
    }

    #[test]
    fn append_idempotent() {
        let once = append_journal_attachment_refs("hello\n\nworld".into(), &[att("/tmp/a.txt")]);
        let twice = append_journal_attachment_refs(once.clone(), &[att("/tmp/a.txt")]);
        assert_eq!(once, twice);
    }
}
