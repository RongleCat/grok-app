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
    /// Coalesced stream IPC buffer (host backpressure).
    pub(super) pending_stream_emit: Option<PendingStreamEmit>,
    /// Bumped when a delayed flush is scheduled; stale tasks no-op.
    pub(super) stream_emit_flush_gen: u64,
    /// Last `session://tool_heartbeat` emit (long open tools).
    pub(super) last_tool_heartbeat_emit: Option<Instant>,
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
        let mcp_tool = pick_str(&["/rawOutput/tool_name", "/rawInput/tool_name"]);
        let mcp_server = pick_str(&["/rawOutput/server_name", "/rawOutput/server"]);
        let meta_name = pick_str(&["/_meta/x.ai/tool/name", "/_meta/x.ai/tool/label"]);
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
            if let Some(n) = pick_str(&["/_meta/x.ai/tool/name", "/rawInput/variant"]) {
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
            let _ = store::save_messages(app_sid, &msgs);
        }
    } else {
        let _ = store::append_message(
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
        );
    }
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
        return t.to_string();
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
pub(super) fn tool_journal_richer(prev: &str, next: &str) -> bool {
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
                // Prefer remote URLs and real local paths; skip non-media.
                if n.starts_with("http://")
                    || n.starts_with("https://")
                    || is_local_media_fs_path(&n)
                {
                    return Some(n);
                }
            }
        }
    }
    // Bare absolute path token (stop at whitespace / quote / paren / markdown)
    let mut start = None;
    for (i, ch) in text.char_indices() {
        if ch == '/' && start.is_none() {
            start = Some(i);
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
                    if is_local_media_fs_path(&n) || {
                        (n.starts_with("http://") || n.starts_with("https://"))
                            && is_media_fs_path(&n)
                    } {
                        return Some(n);
                    }
                }
                start = None;
            }
        }
    }
    None
}

/// Pull media path/URL from ACP tool_call / tool_call_update payload
/// (image_gen, image_edit, image_to_video, reference_to_video, MCP / ChatCut, …).
/// Returns normalized local path or https URL (never protocol-relative / placeholders).
pub(super) fn extract_generated_media_path(raw: &serde_json::Value) -> Option<String> {
    let accept = |s: &str| -> Option<String> {
        let n = normalize_media_ref(s)?;
        if is_media_fs_path(&n) {
            Some(n)
        } else {
            None
        }
    };
    // ImageGen / ImageEdit / video tools rawOutput
    if let Some(path) = raw
        .pointer("/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if let Some(n) = accept(path) {
            return Some(n);
        }
    }
    // Nested under toolCall (some hosts wrap)
    if let Some(path) = raw
        .pointer("/toolCall/rawOutput/path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if let Some(n) = accept(path) {
            return Some(n);
        }
    }
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
    // content[].content.text is often a JSON string with {"path":"..."} or markdown path
    if let Some(arr) = raw.get("content").and_then(|v| v.as_array()) {
        for item in arr {
            let text = item
                .pointer("/content/text")
                .or_else(|| item.get("text"))
                .and_then(|v| v.as_str());
            if let Some(t) = text {
                if let Ok(j) = serde_json::from_str::<serde_json::Value>(t) {
                    if let Some(path) = j.get("path").and_then(|v| v.as_str()) {
                        if let Some(n) = accept(path) {
                            return Some(n);
                        }
                    }
                    // ChatCut: editorUrl / thumbnail / browserHandoff.image
                    for key in ["thumbnail", "thumbnailUrl", "imageUrl", "url", "editorUrl"] {
                        if let Some(u) = j.get(key).and_then(|v| v.as_str()) {
                            if let Some(n) = accept(u) {
                                return Some(n);
                            }
                        }
                    }
                }
                if let Some(p) = first_media_path_in_text(t) {
                    return Some(p);
                }
            }
        }
    }
    None
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
pub(super) fn append_journal_attachment_refs(
    content: String,
    atts: &[MessageAttachmentStored],
) -> String {
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    // Drop trailing blanks so we can rejoin cleanly.
    while lines.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        lines.pop();
    }
    let mut existing: std::collections::HashSet<String> = lines
        .iter()
        .filter_map(|l| {
            let t = l.trim();
            t.strip_prefix('@').map(|p| p.trim().to_string())
        })
        .collect();
    let mut added = false;
    for a in atts {
        let path = a.path.trim();
        if path.is_empty() || !existing.insert(path.to_string()) {
            continue;
        }
        if !added && !lines.is_empty() {
            lines.push(String::new());
        }
        lines.push(format!("@{path}"));
        added = true;
    }
    lines.join("\n")
}

/// Result of taking agent processes out of live / background / parked maps.
pub(super) struct DrainedAgents {
    pub(super) acps: Vec<Arc<AcpClient>>,
    pub(super) had_live_shell: bool,
    pub(super) background_count: usize,
    pub(super) parked_count: usize,
}

/// Pure policy: should connect keep the live agent process instead of respawning?
///
/// Terminal states never preserve — leftover busy flags after a failed turn
/// (`deferred_prompt_complete`, open tools, …) must not block reconnect.
pub(super) fn connect_should_preserve_live_process(state: SessionState, busy: bool) -> bool {
    match state {
        SessionState::Streaming | SessionState::AwaitingPermission | SessionState::Connecting => {
            true
        }
        SessionState::Ready => busy,
        SessionState::Idle | SessionState::Disconnected => false,
    }
}
