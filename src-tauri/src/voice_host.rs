//! Live voice host: full-duplex xAI realtime + host tools → SessionManager.
//!
//! Modes:
//! - `GROK_APP_VOICE=mock` — no network; tool path + state machine for tests/UI dev
//! - default — WebSocket to `wss://api.x.ai/v1/realtime?model=grok-voice-latest`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::session_manager::SessionManager;
use crate::store;
use crate::voice_auth;
use crate::voice_tools;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSessionState {
    pub active: bool,
    pub mode: String,
    pub project_path: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub mock: bool,
    pub listening: bool,
    pub speaking: bool,
    /// Model / host-tool turn in progress (not listening, not speaking).
    pub thinking: bool,
    /// In-flight Build tool name when a host tool is running (honest loop status).
    pub active_tool: Option<String>,
    /// Tool-loop status token: tool_running | permission_pending | completed | soft_fail | error.
    pub tool_status: Option<String>,
    /// When true (default), ending voice does not stop delegated Build agents.
    pub keep_agents_on_end: bool,
    pub error: Option<String>,
    pub delegated_session_ids: Vec<String>,
}

impl Default for VoiceSessionState {
    fn default() -> Self {
        Self {
            active: false,
            mode: "idle".into(),
            project_path: None,
            project_id: None,
            project_name: None,
            mock: false,
            listening: false,
            speaking: false,
            thinking: false,
            active_tool: None,
            tool_status: None,
            keep_agents_on_end: true,
            error: None,
            delegated_session_ids: vec![],
        }
    }
}

struct LiveVoiceInner {
    state: VoiceSessionState,
    /// Outbound PCM base64 chunks from the frontend mic.
    audio_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    stop: Arc<AtomicBool>,
    /// Bumped on each tool start and on voice stop so late finishes soft-fail.
    tool_generation: u64,
}

pub struct VoiceHost {
    inner: Mutex<LiveVoiceInner>,
}

impl Default for VoiceHost {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceHost {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LiveVoiceInner {
                state: VoiceSessionState::default(),
                audio_tx: None,
                stop: Arc::new(AtomicBool::new(false)),
                tool_generation: 0,
            }),
        }
    }

    pub fn snapshot(&self) -> VoiceSessionState {
        self.inner.lock().state.clone()
    }

    pub fn is_mock_env() -> bool {
        std::env::var("GROK_APP_VOICE")
            .map(|v| v == "mock")
            .unwrap_or(false)
    }

    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        mgr: Arc<SessionManager>,
        project_path: Option<String>,
        project_id: Option<String>,
        project_name: Option<String>,
        keep_agents_on_end: bool,
    ) -> Result<VoiceSessionState, String> {
        self.stop_internal(&app, None, false).await;

        let mock = Self::is_mock_env();
        let settings = store::load_settings();
        let voice_id = if settings.voice_id.trim().is_empty() {
            "eve".into()
        } else {
            settings.voice_id.clone()
        };

        let stop = Arc::new(AtomicBool::new(false));
        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        {
            let mut g = self.inner.lock();
            g.stop = stop.clone();
            g.audio_tx = Some(audio_tx);
            g.tool_generation = 0;
            g.state = VoiceSessionState {
                active: true,
                mode: if mock { "mock".into() } else { "live".into() },
                project_path: project_path.clone(),
                project_id: project_id.clone(),
                project_name: project_name.clone(),
                mock,
                listening: true,
                speaking: false,
                thinking: false,
                active_tool: None,
                tool_status: None,
                keep_agents_on_end,
                error: None,
                delegated_session_ids: vec![],
            };
        }
        self.emit_state(&app);

        if mock {
            let host = Arc::clone(self);
            let app2 = app.clone();
            tokio::spawn(async move {
                let _ = app2.emit(
                    "voice://transcript",
                    json!({
                        "role": "assistant",
                        "text": "Live voice mock is ready. Ask me to start an agent task.",
                        "final": true
                    }),
                );
                let mut st = host.snapshot();
                st.speaking = false;
                st.listening = true;
                host.inner.lock().state = st;
                host.emit_state(&app2);
            });
            return Ok(self.snapshot());
        }

        let token = voice_auth::resolve_bearer_token()?;
        let instructions =
            voice_tools::live_voice_instructions(project_path.as_deref(), project_name.as_deref());
        let tools = voice_tools::tool_definitions();

        let host = Arc::clone(self);
        let app2 = app.clone();
        tokio::spawn(async move {
            if let Err(e) = run_realtime_loop(
                host,
                app2.clone(),
                mgr,
                token,
                voice_id,
                instructions,
                tools,
                audio_rx,
                stop,
                project_path,
                project_id,
            )
            .await
            {
                warn!(target: "voice", "realtime loop ended: {e}");
                let _ = app2.emit("voice://error", json!({ "message": e }));
            }
        });

        Ok(self.snapshot())
    }

    pub async fn stop(&self, app: &AppHandle, mgr: &Arc<SessionManager>) -> VoiceSessionState {
        self.stop_internal(app, Some(mgr), true).await;
        self.emit_state(app);
        self.snapshot()
    }

    /// Stop voice: cancel in-flight host tools (soft_fail/cancelled); optionally
    /// stop delegated Build agents when `keep_agents_on_end` is false.
    async fn stop_internal(
        &self,
        app: &AppHandle,
        mgr: Option<&Arc<SessionManager>>,
        clear_audio: bool,
    ) {
        let (stop_flag, active_tool, delegated, keep_agents) = {
            let mut g = self.inner.lock();
            g.stop.store(true, Ordering::SeqCst);
            // Invalidate any in-flight execute_tool so late finishes soft-fail.
            g.tool_generation = g.tool_generation.wrapping_add(1);
            if clear_audio {
                g.audio_tx = None;
            }
            let tool = g.state.active_tool.clone();
            let delegated = g.state.delegated_session_ids.clone();
            let keep = g.state.keep_agents_on_end;
            g.state.active = false;
            g.state.listening = false;
            g.state.speaking = false;
            g.state.thinking = false;
            g.state.active_tool = None;
            g.state.tool_status = None;
            g.state.mode = "idle".into();
            (g.stop.clone(), tool, delegated, keep)
        };
        stop_flag.store(true, Ordering::SeqCst);

        // Honest cancel of the host tool currently running (if any).
        if let Some(name) = active_tool {
            let out = voice_tools::soft_fail_result(
                "cancelled",
                "voice stopped — in-flight Build tool cancelled",
            );
            emit_tool_event(
                app,
                json!({
                    "name": name,
                    "status": "soft_fail",
                    "reason": "cancelled",
                    "errorClass": "cancelled",
                    "message": "voice stopped — in-flight Build tool cancelled",
                    "result": out,
                }),
            );
            let _ = app.emit(
                "voice://tool_result",
                json!({
                    "name": name,
                    "status": "soft_fail",
                    "reason": "cancelled",
                    "result": out,
                }),
            );
        }

        // Optional: cancel delegated agent turns when user opted out of keep.
        if voice_tools::should_cancel_delegated_agents_on_voice_stop(keep_agents) {
            if let Some(mgr) = mgr {
                for sid in delegated {
                    let _ = mgr.stop(app.clone(), Some(sid)).await;
                }
            }
        }

        // tiny yield so tasks notice
        tokio::task::yield_now().await;
    }

    pub fn push_pcm(&self, pcm: Vec<u8>) -> Result<(), String> {
        let g = self.inner.lock();
        if !g.state.active {
            return Err("voice session not active".into());
        }
        if let Some(tx) = &g.audio_tx {
            let _ = tx.send(pcm);
        }
        Ok(())
    }

    /// Mock / debug: run a host tool as if the voice model requested it.
    pub async fn invoke_tool(
        &self,
        app: &AppHandle,
        mgr: &Arc<SessionManager>,
        name: &str,
        args_json: &str,
    ) -> Result<Value, String> {
        let snap = self.snapshot();
        if !snap.active && !Self::is_mock_env() {
            // allow tool tests even when not "live" in mock
        }
        execute_tool(app, mgr, self, &snap, name, args_json).await
    }

    fn emit_state(&self, app: &AppHandle) {
        let st = self.snapshot();
        let _ = app.emit("voice://state", st);
    }

    fn push_delegated(&self, session_id: &str) {
        // Never invent / store blank ids from incomplete tool results.
        let Some(sid) = voice_tools::recordable_delegated_session_id(Some(session_id)) else {
            return;
        };
        let mut g = self.inner.lock();
        if !g.state.delegated_session_ids.iter().any(|s| s == &sid) {
            g.state.delegated_session_ids.push(sid);
        }
    }
}

fn set_thinking(host: &VoiceHost, app: &AppHandle, thinking: bool) {
    let mut st = host.snapshot();
    st.thinking = thinking;
    if thinking {
        st.listening = false;
        st.speaking = false;
    } else if st.active && !st.speaking {
        st.listening = true;
        st.active_tool = None;
        st.tool_status = None;
    }
    host.inner.lock().state = st;
    host.emit_state(app);
}

fn set_active_tool(host: &VoiceHost, app: &AppHandle, tool: Option<&str>, status: Option<&str>) {
    let mut st = host.snapshot();
    st.active_tool = tool.map(|s| s.to_string());
    st.tool_status = status.map(|s| s.to_string());
    if tool.is_some() {
        st.thinking = true;
        st.listening = false;
        st.speaking = false;
    }
    host.inner.lock().state = st;
    host.emit_state(app);
}

fn begin_tool(host: &VoiceHost, app: &AppHandle, name: &str) -> u64 {
    let gen = {
        let mut g = host.inner.lock();
        g.tool_generation = g.tool_generation.wrapping_add(1);
        g.tool_generation
    };
    set_thinking(host, app, true);
    set_active_tool(host, app, Some(name), Some("tool_running"));
    gen
}

fn tool_still_current(host: &VoiceHost, gen: u64) -> bool {
    let g = host.inner.lock();
    g.tool_generation == gen && !g.stop.load(Ordering::SeqCst)
}

fn emit_tool_event(app: &AppHandle, payload: Value) {
    let _ = app.emit("voice://tool", payload);
}

async fn execute_tool(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    host: &VoiceHost,
    snap: &VoiceSessionState,
    name: &str,
    args_json: &str,
) -> Result<Value, String> {
    let gen = begin_tool(host, app, name);
    emit_tool_event(
        app,
        json!({
            "name": name,
            "status": "tool_running",
            "args": args_json,
        }),
    );

    // Bail early if voice already stopped before we run the tool body.
    if !tool_still_current(host, gen) {
        let out = voice_tools::soft_fail_result(
            "cancelled",
            "voice stopped — Build tool cancelled before start",
        );
        set_active_tool(host, app, None, None);
        set_thinking(host, app, false);
        emit_tool_event(
            app,
            json!({
                "name": name,
                "status": "soft_fail",
                "reason": "cancelled",
                "errorClass": "cancelled",
                "result": out,
            }),
        );
        return Ok(out);
    }

    let result = execute_tool_inner(app, mgr, host, snap, name, args_json).await;

    // Voice stop (or a newer tool) invalidated this generation — soft-fail cancel.
    if !tool_still_current(host, gen) {
        let out = voice_tools::soft_fail_result(
            "cancelled",
            "voice stopped — in-flight Build tool cancelled",
        );
        set_active_tool(host, app, None, None);
        set_thinking(host, app, false);
        emit_tool_event(
            app,
            json!({
                "name": name,
                "status": "soft_fail",
                "reason": "cancelled",
                "errorClass": "cancelled",
                "message": "voice stopped — in-flight Build tool cancelled",
                "result": out,
            }),
        );
        let _ = app.emit(
            "voice://tool_result",
            json!({
                "name": name,
                "status": "soft_fail",
                "reason": "cancelled",
                "result": out,
            }),
        );
        return Ok(out);
    }

    set_active_tool(host, app, None, None);
    set_thinking(host, app, false);

    match result {
        Ok(out) => {
            let soft = voice_tools::soft_fail_reason(&out);
            // VOX-BUILD-FULL: completed | soft_fail (not legacy ok).
            let status = if soft.is_some() {
                "soft_fail"
            } else {
                "completed"
            };
            let mut payload = json!({
                "name": name,
                "status": status,
                "args": args_json,
                "result": out,
            });
            if let Some(reason) = soft {
                payload
                    .as_object_mut()
                    .map(|o| o.insert("reason".into(), json!(reason)));
            }
            if let Some(sid) = out
                .get("session_id")
                .or_else(|| out.get("sessionId"))
                .and_then(|x| x.as_str())
            {
                payload
                    .as_object_mut()
                    .map(|o| o.insert("sessionId".into(), json!(sid)));
            }
            // Surface permission wait honestly when agent reports awaiting_permission.
            if out.get("awaiting_permission").and_then(|x| x.as_bool()) == Some(true) {
                if let Some(o) = payload.as_object_mut() {
                    o.insert("status".into(), json!("permission_pending"));
                }
                set_active_tool(host, app, Some(name), Some("permission_pending"));
            }
            emit_tool_event(app, payload.clone());
            let _ = app.emit(
                "voice://tool_result",
                json!({
                    "name": name,
                    "status": payload.get("status").cloned().unwrap_or(json!(status)),
                    "result": out,
                }),
            );
            Ok(out)
        }
        Err(e) => {
            let class = voice_tools::classify_tool_error(&e);
            // Soft-fail CLI missing / permission deny / cancel: return structured
            // result so the voice model can narrate without killing the session.
            if voice_tools::is_soft_tool_error(class) {
                let out = voice_tools::soft_fail_result(class, &e);
                emit_tool_event(
                    app,
                    json!({
                        "name": name,
                        "status": "soft_fail",
                        "reason": class,
                        "errorClass": class,
                        "message": e,
                        "result": out,
                    }),
                );
                let _ = app.emit(
                    "voice://tool_result",
                    json!({
                        "name": name,
                        "status": "soft_fail",
                        "reason": class,
                        "result": out,
                    }),
                );
                return Ok(out);
            }
            emit_tool_event(
                app,
                json!({
                    "name": name,
                    "status": "error",
                    "reason": class,
                    "errorClass": class,
                    "message": e,
                }),
            );
            let _ = app.emit(
                "voice://error",
                json!({
                    "message": format!("tool {name}: {e}"),
                    "errorClass": class,
                }),
            );
            Err(e)
        }
    }
}

async fn execute_tool_inner(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    host: &VoiceHost,
    snap: &VoiceSessionState,
    name: &str,
    args_json: &str,
) -> Result<Value, String> {
    if VoiceHost::is_mock_env() {
        let out = voice_tools::mock_execute_tool(name, args_json)?;
        if let Some(sid) = voice_tools::recordable_delegated_session_id(
            out.get("session_id").and_then(|x| x.as_str()),
        ) {
            host.push_delegated(&sid);
            host.emit_state(app);
        }
        return Ok(out);
    }

    let tool =
        voice_tools::VoiceToolName::parse(name).ok_or_else(|| format!("unknown tool: {name}"))?;

    let out = match tool {
        voice_tools::VoiceToolName::ListSessions => {
            let args = voice_tools::parse_list_sessions_args(args_json)?;
            let limit = args.limit.unwrap_or(20).min(50) as usize;
            let mut sessions = store::load_sessions_index();
            if let Some(pid) = &snap.project_id {
                sessions.retain(|s| s.project_id.as_deref() == Some(pid.as_str()));
            }
            store::sort_sessions_by_pin_then_updated(&mut sessions);
            sessions.truncate(limit);
            let rows: Vec<Value> = sessions
                .into_iter()
                .map(|s| {
                    json!({
                        "id": s.id,
                        "title": s.title,
                        "projectId": s.project_id,
                        "updatedAt": s.updated_at,
                    })
                })
                .collect();
            json!({ "sessions": rows })
        }
        voice_tools::VoiceToolName::CreateAgentSession => {
            let args = voice_tools::parse_create_agent_args(args_json)?;
            let meta = store::create_session(
                snap.project_id.clone(),
                args.title.or_else(|| Some("Voice task".into())),
                false,
            )?;
            // Connect + send on that session (becomes live host).
            let path = snap.project_path.clone();
            mgr.connect(app.clone(), path, Some(meta.id.clone()), None)
                .await?;
            mgr.send_message(
                app.clone(),
                args.prompt.clone(),
                None,
                None,
                Some(meta.id.clone()),
            )
            .await?;
            host.push_delegated(&meta.id);
            host.emit_state(app);
            let _ = app.emit(
                "session://index_changed",
                json!({ "reason": "voice_delegate", "sessionId": meta.id }),
            );
            json!({
                "session_id": meta.id,
                "title": meta.title,
                "state": "streaming",
                "accepted_prompt": args.prompt
            })
        }
        voice_tools::VoiceToolName::PromptAgent => {
            let args = voice_tools::parse_prompt_agent_args(args_json)?;
            if let Some(sid) = &args.session_id {
                mgr.connect(
                    app.clone(),
                    snap.project_path.clone(),
                    Some(sid.clone()),
                    None,
                )
                .await?;
                host.push_delegated(sid);
            }
            mgr.send_message(
                app.clone(),
                args.prompt.clone(),
                None,
                None,
                args.session_id.clone(),
            )
            .await?;
            let live = mgr.snapshot();
            json!({
                "session_id": live.session_id,
                "state": live.state,
                "accepted_prompt": args.prompt
            })
        }
        voice_tools::VoiceToolName::GetAgentStatus => {
            let args = voice_tools::parse_session_ref_args(args_json)?;
            if let Some(sid) = &args.session_id {
                let _ = mgr
                    .connect(
                        app.clone(),
                        snap.project_path.clone(),
                        Some(sid.clone()),
                        None,
                    )
                    .await;
            }
            let live = mgr.snapshot();
            let state_str = format!("{:?}", live.state).to_lowercase();
            // Prefer serde snake_case via json round-trip for honesty.
            let state_json = serde_json::to_value(live.state)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or(state_str);
            let awaiting_permission = state_json == "awaiting_permission";
            json!({
                "session_id": live.session_id,
                "state": live.state,
                "title": live.title,
                "backend": live.backend,
                "lastError": live.last_error,
                "awaiting_permission": awaiting_permission,
            })
        }
        voice_tools::VoiceToolName::CancelAgent => {
            let args = voice_tools::parse_session_ref_args(args_json)?;
            if let Some(sid) = &args.session_id {
                let _ = mgr
                    .connect(
                        app.clone(),
                        snap.project_path.clone(),
                        Some(sid.clone()),
                        None,
                    )
                    .await;
            }
            let live = mgr.stop(app.clone(), args.session_id.clone()).await?;
            json!({
                "session_id": live.session_id,
                "state": live.state,
                "cancelled": true
            })
        }
    };

    Ok(out)
}

#[allow(clippy::too_many_arguments)]
async fn run_realtime_loop(
    host: Arc<VoiceHost>,
    app: AppHandle,
    mgr: Arc<SessionManager>,
    token: String,
    voice_id: String,
    instructions: String,
    tools: Vec<Value>,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    stop: Arc<AtomicBool>,
    _project_path: Option<String>,
    _project_id: Option<String>,
) -> Result<(), String> {
    let url = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
    let mut req = url
        .into_client_request()
        .map_err(|e| format!("ws request: {e}"))?;
    req.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| format!("auth header: {e}"))?,
    );

    let (ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("voice websocket connect failed: {e}"))?;
    info!(target: "voice", "realtime connected");

    let (mut write, mut read) = ws.split();

    // Configure session
    let update = json!({
        "type": "session.update",
        "session": {
            "voice": voice_id,
            "instructions": instructions,
            "turn_detection": { "type": "server_vad" },
            "tools": tools,
            "modalities": ["text", "audio"]
        }
    });
    write
        .send(Message::Text(update.to_string().into()))
        .await
        .map_err(|e| format!("session.update send: {e}"))?;

    let _ = app.emit(
        "voice://transcript",
        json!({
            "role": "system",
            "text": "Live voice connected.",
            "final": true
        }),
    );

    // Writer task: forward mic PCM as binary (or base64 events depending on API).
    let stop_w = stop.clone();
    let write_task = tokio::spawn(async move {
        while !stop_w.load(Ordering::SeqCst) {
            tokio::select! {
                chunk = audio_rx.recv() => {
                    match chunk {
                        Some(pcm) if !pcm.is_empty() => {
                            // Send raw PCM binary frames (xAI STT style) and also
                            // an input_audio_buffer append for OpenAI-compatible realtime.
                            let b64 = B64.encode(&pcm);
                            let msg = json!({
                                "type": "input_audio_buffer.append",
                                "audio": b64
                            });
                            if write.send(Message::Text(msg.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        Some(_) => {}
                        None => break,
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(50)) => {}
            }
        }
        let _ = write.send(Message::Close(None)).await;
    });

    // Reader loop
    while !stop.load(Ordering::SeqCst) {
        let next = tokio::time::timeout(std::time::Duration::from_millis(200), read.next()).await;
        let msg = match next {
            Ok(Some(Ok(m))) => m,
            Ok(Some(Err(e))) => return Err(format!("ws read: {e}")),
            Ok(None) => break,
            Err(_) => continue,
        };
        match msg {
            Message::Text(t) => {
                handle_server_event(&host, &app, &mgr, &t).await;
            }
            Message::Binary(bin) => {
                // Some servers stream raw audio frames.
                let b64 = B64.encode(&bin);
                let _ = app.emit("voice://audio", json!({ "delta": b64 }));
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    stop.store(true, Ordering::SeqCst);
    let _ = write_task.await;
    let mut st = host.snapshot();
    st.active = false;
    st.mode = "idle".into();
    host.inner.lock().state = st;
    host.emit_state(&app);
    Ok(())
}

include!("voice_host_more.rs");
