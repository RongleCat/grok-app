//! Host session manager: real ACP default; mock only if GROK_APP_ACP=mock.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::acp_client::{
    should_abort_provider_retry, AcpClient, AcpEvent, PermissionOutcome, StreamKind,
    HOST_PROVIDER_MAX_RETRIES,
};
use crate::cli_probe;
use crate::error::{AgentError, AgentErrorCode};
use crate::mock_acp::{self, MockConnectMode, MockStreamHandle, StreamChunk};
use crate::permission::{
    extract_path_target, extract_shell_command, may_auto_allow, may_auto_deny, pick_option_id,
    scope_key, PermissionPolicy,
    SessionAllowCache,
};
use crate::session_fsm::{SessionFsm, SessionState};
use crate::store::{self, ChatMessageStored, MessageAttachmentStored, SessionMeta};

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

struct LiveSession {
    app_session_id: String,
    meta: SessionMeta,
    fsm: SessionFsm,
    backend: String,
    acp: Option<Arc<AcpClient>>,
    mock_stream: Option<MockStreamHandle>,
    streaming_message_id: Option<String>,
    /// Accumulated assistant text for current turn (persisted on complete).
    stream_buf: String,
    stream_thought: String,
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
The agent process was restarted; use the following transcript for continuity. \
Do not re-greet or re-summarize unless asked.]\n\n",
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
    inner: Mutex<Option<LiveSession>>,
    /// Max concurrent agent processes (spec: 3). Single active for P0 simplicity + limit check.
    active_count: Mutex<u32>,
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
            active_count: Mutex::new(0),
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
        s.streaming_message_id = None;

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
        // Tear down existing
        self.disconnect_inner(&app).await;

        let settings = store::load_settings();

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

        // Independent GROK_HOME: push permission into agent config before spawn so
        // dontAsk / acceptEdits / YOLO apply agent-side (not only Host).
        if let Err(e) = crate::agent_prefs::sync_permission_to_agent_profile(
            &settings.session_data_mode,
            &prefs.permission_policy,
        ) {
            tracing::warn!("sync agent permission prefs: {e}");
        }

        {
            let mut fsm = SessionFsm::new();
            fsm.start_connect().map_err(|e| e.to_string())?;
            *self.inner.lock() = Some(LiveSession {
                app_session_id: meta.id.clone(),
                meta: meta.clone(),
                fsm,
                backend: Self::backend_name(),
                acp: None,
                mock_stream: None,
                streaming_message_id: None,
                stream_buf: String::new(),
                stream_thought: String::new(),
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

        // Real ACP
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

        // Channel-aware model: custom provider → route id; official → catalog id.
        let agent_model =
            crate::providers::agent_spawn_model_id(&prefs.model_id);

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

        {
            let mut n = self.active_count.lock();
            *n += 1;
        }

        // Event pump
        {
            let mgr = Arc::clone(self);
            let app_ev = app.clone();
            tokio::spawn(async move {
                while let Some(ev) = events.recv().await {
                    mgr.handle_acp_event(&app_ev, ev).await;
                }
            });
        }

        match client
            .initialize_and_open_session(resume_agent_sid.as_deref())
            .await
        {
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
                        "agent session resumed id={agent_sid} (full context)"
                    );
                } else if need_bootstrap {
                    tracing::info!(
                        "agent session new id={agent_sid}; will bootstrap journal history on first send"
                    );
                }
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        let _ = s.fsm.handshake_ok();
                        s.acp = Some(client);
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
                    let mut n = self.active_count.lock();
                    *n = n.saturating_sub(1);
                }
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

    async fn handle_acp_event(self: &Arc<Self>, app: &AppHandle, ev: AcpEvent) {
        match ev {
            AcpEvent::Stream {
                kind,
                text,
                message_id,
                done,
            } => {
                let (app_sid, mid) = {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        if s.streaming_message_id.is_none() {
                            s.streaming_message_id =
                                Some(message_id.unwrap_or_else(|| Uuid::new_v4().to_string()));
                        }
                        match kind {
                            StreamKind::Assistant => s.stream_buf.push_str(&text),
                            StreamKind::Thought => s.stream_thought.push_str(&text),
                        }
                        (
                            s.app_session_id.clone(),
                            s.streaming_message_id.clone().unwrap_or_default(),
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
                    }
                });
                let _ = app.emit("session://stream", payload);
            }
            AcpEvent::PromptComplete { stop_reason: _ } => {
                {
                    let mut guard = self.inner.lock();
                    if let Some(s) = guard.as_mut() {
                        // Persist assistant turn to independent session store
                        let has_atts = !s.stream_attachments.is_empty();
                        if !s.stream_buf.is_empty() || !s.stream_thought.is_empty() || has_atts {
                            let mid = s
                                .streaming_message_id
                                .clone()
                                .unwrap_or_else(|| Uuid::new_v4().to_string());
                            let atts = if has_atts {
                                Some(std::mem::take(&mut s.stream_attachments))
                            } else {
                                None
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
                        }
                        s.stream_buf.clear();
                        s.stream_thought.clear();
                        s.stream_attachments.clear();
                        if s.fsm.state() == SessionState::Streaming
                            || s.fsm.state() == SessionState::AwaitingPermission
                        {
                            let _ = s.fsm.end_stream();
                        }
                        s.streaming_message_id = None;
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

                if let Some(path) = media_path.as_ref() {
                    let att = attachment_from_path(path);
                    let (app_sid, mid) = {
                        let mut guard = self.inner.lock();
                        if let Some(s) = guard.as_mut() {
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
                    let guard = self.inner.lock();
                    guard
                        .as_ref()
                        .map(|s| s.app_session_id.clone())
                        .unwrap_or_default()
                };

                // Live tool activity for UI (Codex-style activity stream).
                let _ = app.emit(
                    "session://tool",
                    serde_json::json!({
                        "sessionId": app_sid,
                        "toolCallId": tool_call_id,
                        "title": title,
                        "kind": kind,
                        "status": if status.is_empty() { "in_progress" } else { &status },
                        "path": path_out,
                        "detail": detail,
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
            AcpEvent::Plan { entries } => {
                let _ = app.emit("session://plan", serde_json::json!({ "entries": entries }));
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
                    }
                }
                {
                    let mut n = self.active_count.lock();
                    *n = n.saturating_sub(1);
                }
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
            let mid = Uuid::new_v4().to_string();
            s.streaming_message_id = Some(mid.clone());
            s.stream_buf.clear();
            s.stream_thought.clear();
            s.stream_attachments.clear();
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
                    if chunk.done {
                        let mut guard = mgr.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            s.stream_buf.push_str(&chunk.text);
                            if !s.stream_buf.is_empty() {
                                let mid = s
                                    .streaming_message_id
                                    .clone()
                                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                                let _ = store::append_message(
                                    &s.app_session_id,
                                    ChatMessageStored {
                                        id: mid,
                                        role: "assistant".into(),
                                        content: s.stream_buf.clone(),
                                        thought: None,
                                        created_at: chrono::Utc::now(),
                                        is_error: false,
                                        attachments: None,
                                        marker: None,
                                    },
                                );
                            }
                            s.stream_buf.clear();
                            if s.fsm.state() == SessionState::Streaming {
                                let _ = s.fsm.end_stream();
                                s.streaming_message_id = None;
                            }
                        }
                        drop(guard);
                        SessionManager::emit_state(&app_done, &mgr.snapshot());
                    } else {
                        let mut guard = mgr.inner.lock();
                        if let Some(s) = guard.as_mut() {
                            s.stream_buf.push_str(&chunk.text);
                        }
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
    async fn soft_respawn(&self, app: &AppHandle) {
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

    async fn disconnect_inner(&self, app: &AppHandle) {
        let acp = {
            let mut guard = self.inner.lock();
            if let Some(mut s) = guard.take() {
                if let Some(h) = s.mock_stream.take() {
                    h.request_stop();
                }
                s.acp.take()
            } else {
                None
            }
        };
        if let Some(acp) = acp {
            acp.kill().await;
            let mut n = self.active_count.lock();
            *n = n.saturating_sub(1);
        }
        Self::emit_state(app, &self.snapshot());
    }

    pub async fn disconnect(self: &Arc<Self>, app: AppHandle) -> Result<SessionSnapshot, String> {
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
