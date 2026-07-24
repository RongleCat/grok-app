//! Real ACP client: spawn `grok agent stdio`, JSON-RPC line framing.
//! Default production transport. Mock only when GROK_APP_ACP=mock.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex as ParkingMutex;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};
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
    Error {
        error: AgentError,
    },
    Stderr {
        line: String,
    },
    ProcessExited {
        code: Option<i32>,
    },
}

/// Host circuit-breaker: after this many provider retries, cancel the turn
/// (Codex-like). Agent may advertise a higher max (e.g. 15); we still stop at 5.
pub const HOST_PROVIDER_MAX_RETRIES: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Assistant,
    Thought,
}

struct Pending {
    method: String,
    tx: oneshot::Sender<Result<Value, String>>,
}

const HANDSHAKE_TIMEOUT_SECS: u64 = 45;
const AUTH_TIMEOUT_SECS: u64 = 12;
const PROMPT_TIMEOUT_SECS: u64 = 600;
/// After `_x.ai/session/prompt_complete`, wait this long for the real JSON-RPC
/// `session/prompt` result/error before treating the turn as successfully done.
/// Official subscription failures often emit prompt_complete first, then error.
const PROMPT_COMPLETE_FALLBACK_GRACE_MS: u64 = 3000;

pub struct AcpClient {
    /// The spawned CLI process, or `None` in API mode (connected to a remote
    /// ACP server over TCP instead of spawning `grok agent stdio`).
    child: AsyncMutex<Option<Child>>,
    /// Write half of the transport (child stdin, or the TCP write half). Both
    /// impl `AsyncWrite`, so the JSON-RPC line protocol is transport-agnostic.
    stdin: AsyncMutex<Option<Box<dyn AsyncWrite + Unpin + Send>>>,
    next_id: AtomicU64,
    pending: ParkingMutex<HashMap<u64, Pending>>,
    event_tx: mpsc::UnboundedSender<AcpEvent>,
    agent_session_id: ParkingMutex<Option<String>>,
    cli_path: PathBuf,
    cwd: PathBuf,
    stopped: AtomicBool,
    reader_alive: AtomicBool,
    /// Recent stderr lines for crash diagnostics (ring, newest last).
    stderr_tail: ParkingMutex<Vec<String>>,
}

/// Options applied at agent process start (CLI flags).
#[derive(Debug, Clone, Default)]
pub struct SpawnOptions {
    pub model_id: Option<String>,
    pub effort: Option<String>,
    /// App permission policy id (ask / accept_edits / …).
    pub permission_policy: Option<String>,
}

/// Map App policy → CLI `--permission-mode` value.
pub fn cli_permission_mode(policy: &str) -> &'static str {
    use crate::permission::PermissionPolicy;
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::AlwaysApprove => "bypassPermissions",
        // Host session allow-list is applied in-process; CLI still asks.
        PermissionPolicy::AllowForSession
        | PermissionPolicy::AllowOnce
        | PermissionPolicy::Deny
        | PermissionPolicy::Ask => "default",
    }
}

/// Pure spawn plan for the OS-level sandbox profile.
///
/// `--sandbox` is a **top-level** `grok` flag (not under `agent` / `stdio`),
/// and the CLI also reads `GROK_SANDBOX`. When the profile is off/empty we
/// apply neither so the agent stays unrestricted (CLI default).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpawnSpec {
    pub profile: String,
}

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

/// Pure helper used by spawn + unit tests: args + env when sandbox is on.
pub fn sandbox_spawn_flags(profile: &str) -> Option<(Vec<String>, (String, String))> {
    let spec = SandboxSpawnSpec::from_setting(profile)?;
    Some((spec.cli_args().to_vec(), spec.env_pair()))
}

impl AcpClient {
    pub fn use_mock() -> bool {
        std::env::var("GROK_APP_ACP")
            .map(|v| v.eq_ignore_ascii_case("mock"))
            .unwrap_or(false)
    }

    pub fn spawn(
        cli_path: PathBuf,
        cwd: PathBuf,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<AcpEvent>), AgentError> {
        Self::spawn_with_options(cli_path, cwd, SpawnOptions::default())
    }

    pub fn spawn_with_options(
        cli_path: PathBuf,
        cwd: PathBuf,
        opts: SpawnOptions,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<AcpEvent>), AgentError> {
        let settings = crate::store::load_settings();
        Self::spawn_with_home(cli_path, cwd, &settings.session_data_mode, opts)
    }

    /// Spawn `grok agent stdio` with GROK_HOME from session_data_mode.
    pub fn spawn_with_home(
        cli_path: PathBuf,
        cwd: PathBuf,
        session_data_mode: &str,
        opts: SpawnOptions,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<AcpEvent>), AgentError> {
        // API mode: if an ACP server address is configured, connect over TCP
        // instead of spawning a local CLI. The server drives an agent running
        // elsewhere (WSL/SSH/container) but speaks the identical ACP protocol.
        if let Some(addr) = crate::store::load_settings()
            .acp_server_addr
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Self::connect_tcp(addr, cwd);
        }

        if !cli_path.exists() {
            return Err(AgentError::new(
                AgentErrorCode::CliNotFound,
                format!("CLI not found: {}", cli_path.display()),
            ));
        }

        let (event_tx, event_rx) = mpsc::unbounded_channel();

        // GUI apps often inherit a sparse PATH; keep absolute cli_path but enrich PATH
        // so nested tools (npx, node, git) resolve when the agent shells out.
        //
        // Flag placement (CLI 0.2.x):
        //   `grok agent [OPTIONS] stdio`  — model / effort / always-approve are **agent** options
        //   Flags after `stdio` are rejected (`unexpected argument '--model'`).
        //   `--permission-mode` is top-level `grok` only — not accepted by `grok agent`;
        //   Host enforces permission policy on session/request_permission; YOLO uses --always-approve.
        let grok_home = crate::paths::resolve_agent_grok_home(session_data_mode);
        let _ = std::fs::create_dir_all(&grok_home);
        if session_data_mode != "shared" {
            // Official → sync OIDC; custom → strip auth.json (api_key only).
            crate::providers::prepare_route_auth_for_agent();
            if let Some(ref pol) = opts.permission_policy {
                let _ = crate::agent_prefs::sync_permission_to_agent_profile(
                    session_data_mode,
                    pol,
                );
            }
        }

        // Composer may hold a catalog id while the active channel is a custom
        // provider — resolve to the route id Grok Build actually understands.
        let spawn_model = crate::providers::agent_spawn_model_id(
            opts.model_id.as_deref().unwrap_or(""),
        );

        // Flag placement (CLI 0.2.x):
        //   top-level: `grok --no-auto-update [--sandbox PROFILE] agent …`
        //   agent opts: `--model` / `--reasoning-effort` / `--always-approve` before `stdio`
        // Skip background update checks so ACP handshakes are not delayed on launch.
        // `--sandbox` is top-level only (not accepted by `grok agent` / `stdio`);
        // also set GROK_SANDBOX so nested tools inherit the same profile.
        let settings = crate::store::load_settings();
        let sandbox = SandboxSpawnSpec::from_setting(&settings.sandbox_profile);

        let mut cmd = Command::new(&cli_path);
        cmd.arg("--no-auto-update");
        if let Some(ref sb) = sandbox {
            for a in sb.cli_args() {
                cmd.arg(a);
            }
        }
        cmd.arg("agent");
        if !spawn_model.is_empty() {
            cmd.args(["--model", &spawn_model]);
        }
        if let Some(ref e) = opts.effort {
            let e = e.trim();
            if matches!(e, "high" | "medium" | "low") {
                cmd.args(["--reasoning-effort", e]);
            }
        }
        if let Some(ref pol) = opts.permission_policy {
            // Only always-approve maps to an agent flag; other modes are Host-side.
            if cli_permission_mode(pol) == "bypassPermissions" {
                cmd.arg("--always-approve");
            }
        }
        cmd.arg("stdio");
        cmd.current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        crate::process_util::apply_no_window_tokio(&mut cmd);
        if let Some(path) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path);
        }
        cmd.env("GROK_HOME", &grok_home);
        if let Some(ref sb) = sandbox {
            let (k, v) = sb.env_pair();
            cmd.env(k, v);
        }
        tracing::info!(
            "acp: spawn GROK_HOME={} mode={} auth_present={} route={:?} composer_model={:?} spawn_model={} yolo={} sandbox={:?}",
            grok_home.display(),
            session_data_mode,
            grok_home.join("auth.json").is_file(),
            crate::providers::active_route(),
            opts.model_id.as_deref(),
            spawn_model,
            opts.permission_policy
                .as_deref()
                .map(cli_permission_mode)
                == Some("bypassPermissions"),
            sandbox.as_ref().map(|s| s.profile.as_str())
        );

        let mut child = cmd.spawn().map_err(|e| {
            AgentError::new(
                AgentErrorCode::CliNotFound,
                format!("failed to spawn grok agent stdio: {e}"),
            )
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AgentError::new(AgentErrorCode::AgentCrashed, "no stdin on child")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AgentError::new(AgentErrorCode::AgentCrashed, "no stdout on child")
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AgentError::new(AgentErrorCode::AgentCrashed, "no stderr on child")
        })?;

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
            stderr_tail: ParkingMutex::new(Vec::new()),
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
                                let _ = c.event_tx.send(AcpEvent::Stderr { line: t });
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
    /// Sync (uses a blocking connect + `from_std`) to match `spawn_with_home`;
    /// must be called from within the Tokio runtime.
    pub fn connect_tcp(
        addr: &str,
        cwd: PathBuf,
    ) -> Result<(Arc<Self>, mpsc::UnboundedReceiver<AcpEvent>), AgentError> {
        let std_stream = std::net::TcpStream::connect(addr).map_err(|e| {
            AgentError::new(
                AgentErrorCode::CliNotFound,
                format!("failed to connect ACP server {addr}: {e}"),
            )
        })?;
        std_stream.set_nonblocking(true).map_err(|e| {
            AgentError::new(AgentErrorCode::AgentCrashed, format!("socket setup: {e}"))
        })?;
        let stream = TcpStream::from_std(std_stream).map_err(|e| {
            AgentError::new(AgentErrorCode::AgentCrashed, format!("socket adopt: {e}"))
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
            stderr_tail: ParkingMutex::new(Vec::new()),
        });
        client.start_read_loop(Box::new(read_half));
        Ok((client, event_rx))
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
                line.clear();
                match reader.read_line(&mut line).await {
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
            c.reader_alive.store(false, Ordering::SeqCst);
            let detail = c.format_exit_detail("Agent stream closed (EOF)");
            c.fail_all_pending(&detail);
            let _ = c.event_tx.send(AcpEvent::ProcessExited { code: None });
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
                if let Some(p) = self.pending.lock().remove(&id) {
                    if let Some(err) = msg.get("error") {
                        let full = format_jsonrpc_error(err);
                        warn!("acp ← {} id={id} error: {}", p.method, full);
                        let _ = p.tx.send(Err(full));
                    } else {
                        let _ = p.tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                    }
                } else if let Some(err) = msg.get("error") {
                    // Race: prompt_complete fallback already resolved pending, but the
                    // real RPC error arrived later (official subscription / provider fails).
                    // Must still surface the error — do not drop as "unknown id".
                    let full = format_jsonrpc_error(err);
                    warn!(
                        "acp late error response id={id} (pending already resolved): {full}"
                    );
                    let _ = self.event_tx.send(AcpEvent::Error {
                        error: classify_rpc_error(&full),
                    });
                } else {
                    debug!(
                        "acp late ok response id={id} (pending already resolved); keys={:?}",
                        msg.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>())
                    );
                }
                // also surface prompt complete via result stopReason
                if let Some(sr) = msg
                    .pointer("/result/stopReason")
                    .and_then(|v| v.as_str())
                {
                    let _ = self.event_tx.send(AcpEvent::PromptComplete {
                        stop_reason: sr.to_string(),
                    });
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
                    .send(decode_permission_request(rpc_id, &params));
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
                        let _ = self.event_tx.send(AcpEvent::Plan {
                            entries: params
                                .get("entries")
                                .cloned()
                                .unwrap_or(json!([])),
                            body: plan_content,
                            rpc_id: Some(rpc_id),
                            tool_call_id,
                        });
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
                            let _ = self.event_tx.send(AcpEvent::AskUserQuestion {
                                rpc_id,
                                tool_call_id: parsed.tool_call_id,
                                questions: parsed.questions,
                                raw: params,
                            });
                        }
                    }
                    return;
                }
            }

            // True notifications: no id. (If id is present, must reply — never swallow.)
            if req_id.is_none() {
                // Official + xAI-extended session updates (retry_state, chunks, tools…).
                if method == "session/update" || method == "_x.ai/session/update" {
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
                    let _ = self.event_tx.send(AcpEvent::PromptComplete {
                        stop_reason: stop.clone(),
                    });
                    // Grace period: free waiters only if the RPC result never arrives.
                    self.schedule_prompt_complete_fallback(stop);
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

    /// Wait briefly for the real session/prompt JSON-RPC result; only then Ok-complete.
    fn schedule_prompt_complete_fallback(self: &Arc<Self>, stop_reason: String) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(
                PROMPT_COMPLETE_FALLBACK_GRACE_MS,
            ))
            .await;
            this.complete_pending_prompt_fallback(&stop_reason);
        });
    }

    /// If agent never returned a session/prompt result after prompt_complete, free waiters.
    fn complete_pending_prompt_fallback(&self, stop_reason: &str) {
        let mut pending = self.pending.lock();
        let prompt_ids: Vec<u64> = pending
            .iter()
            .filter(|(_, p)| p.method == "session/prompt")
            .map(|(id, _)| *id)
            .collect();
        for id in prompt_ids {
            if let Some(p) = pending.remove(&id) {
                info!(
                    "acp completing session/prompt id={id} via delayed prompt_complete fallback (no RPC result yet)"
                );
                let _ = p.tx.send(Ok(json!({ "stopReason": stop_reason })));
            }
        }
    }

    fn handle_session_update(&self, params: &Value) {
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
            let _ = self.event_tx.send(ev);
        }
    }

    async fn write_line(&self, value: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| "stdin closed".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Parse compact-related sessionUpdate → (trigger, before, after, summary, note)
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
    let trigger = if trigger_raw.eq_ignore_ascii_case("manual") || kind.contains("manual")
    {
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
        Some((
            trigger,
            tokens_before,
            tokens_after,
            summary_preview,
            note,
        ))
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
                let head =
                    format!("rpc channel closed while waiting for {method} (id={id})");
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
    /// sessions under GROK_HOME). Fall back to `session/new`.
    /// Returns `(session_id, resumed)`.
    pub async fn initialize_and_open_session(
        &self,
        resume_session_id: Option<&str>,
    ) -> Result<(String, bool), AgentError> {
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

        info!(
            "acp initialized agentVersion={:?} loadSession={:?}",
            init.pointer("/_meta/agentVersion")
                .or_else(|| init.pointer("/agentVersion")),
            init.pointer("/agentCapabilities/loadSession")
                .or_else(|| init.pointer("/capabilities/loadSession"))
        );

        // Best-effort cached auth — short timeout so a hung auth cannot burn 120s.
        match self
            .request_timeout(
                "authenticate",
                json!({ "methodId": "cached_token" }),
                AUTH_TIMEOUT_SECS,
            )
            .await
        {
            Ok(_) => info!("acp authenticate cached_token ok"),
            Err(e) => warn!("acp authenticate soft-fail (continuing): {e}"),
        }

        self.open_session(resume_session_id).await
    }

    /// Open or resume an ACP session on an already-initialized agent process.
    /// Used for cold connect after `initialize` and for warm process reuse when
    /// switching App sessions without respawning CLI.
    /// Returns `(session_id, resumed)`.
    ///
    /// Injects **enabled** MCP servers (App Extensions prefs + `grok mcp list`)
    /// into `mcpServers` so independent GROK_HOME and shared mode both see tools.
    pub async fn open_session(
        &self,
        resume_session_id: Option<&str>,
    ) -> Result<(String, bool), AgentError> {
        let cwd = self.cwd.to_string_lossy().to_string();
        if !self.cwd.is_dir() {
            return Err(AgentError::new(
                AgentErrorCode::AgentCrashed,
                format!("project cwd is not a directory: {cwd}"),
            ));
        }

        // Build ACP mcpServers off the async runtime (CLI list / file IO).
        let project_cwd = cwd.clone();
        let mcp_servers = tauri::async_runtime::spawn_blocking(move || {
            crate::extensions::build_session_mcp_servers(Some(project_cwd.as_str()))
        })
        .await
        .unwrap_or_else(|_| serde_json::json!([]));
        let mcp_count = mcp_servers.as_array().map(|a| a.len()).unwrap_or(0);
        info!("acp session open injecting mcpServers count={mcp_count}");

        // Prefer resuming the previous agent session for full native context.
        if let Some(rid) = resume_session_id.map(str::trim).filter(|s| !s.is_empty()) {
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
                    let _ = self.event_tx.send(AcpEvent::State {
                        backend: "grok_agent_stdio".into(),
                        agent_session_id: Some(sid.clone()),
                        model_id,
                    });
                    return Ok((sid, true));
                }
                Err(e) => {
                    warn!("acp session/load failed ({e}); falling back to session/new");
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
                        result.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>())
                    ),
                )
            })?
            .to_string();

        *self.agent_session_id.lock() = Some(sid.clone());
        let model_id = result
            .pointer("/models/currentModelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let _ = self.event_tx.send(AcpEvent::State {
            backend: "grok_agent_stdio".into(),
            agent_session_id: Some(sid.clone()),
            model_id,
        });

        Ok((sid, false))
    }

    /// Back-compat: always create a new session.
    pub async fn initialize_and_new_session(&self) -> Result<String, AgentError> {
        self.initialize_and_open_session(None)
            .await
            .map(|(sid, _)| sid)
    }

    /// Switch model on the live agent session (`session/set_model`).
    pub async fn set_model(&self, model_id: &str) -> Result<(), String> {
        let model_id = model_id.trim();
        if model_id.is_empty() {
            return Err("model id empty".into());
        }
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no agent session".to_string())?;
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
            let _ = self.event_tx.send(AcpEvent::State {
                backend: "grok_agent_stdio".into(),
                agent_session_id: Some(sid),
                model_id: Some(mid.to_string()),
            });
        } else {
            let _ = self.event_tx.send(AcpEvent::State {
                backend: "grok_agent_stdio".into(),
                agent_session_id: Some(sid),
                model_id: Some(model_id.to_string()),
            });
        }
        Ok(())
    }

    /// Switch product session mode (`session/set_mode`). Tries candidate modeIds.
    pub async fn set_mode(&self, product_mode: &str) -> Result<String, String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no agent session".to_string())?;
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
                }
            }
        }
        Err(format!("session/set_mode: {last_err}"))
    }

    fn map_handshake_err(&self, phase: &str, e: String) -> AgentError {
        let detail = self.format_exit_detail(&format!("{phase}: {e}"));
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

    pub async fn prompt(&self, text: &str) -> Result<(), AgentError> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::new(AgentErrorCode::AgentCrashed, "no session"))?;

        self.stopped.store(false, Ordering::SeqCst);

        // Fire and wait for completion in background via request future
        let this_params = wire_session_prompt_params(&sid, text);

        let result = self
            .request_timeout("session/prompt", this_params, PROMPT_TIMEOUT_SECS)
            .await
            .map_err(|e| classify_rpc_error(&e))?;

        let stop = result
            .get("stopReason")
            .and_then(|v| v.as_str())
            .unwrap_or("end_turn")
            .to_string();

        let _ = self.event_tx.send(AcpEvent::Stream {
            kind: StreamKind::Assistant,
            text: String::new(),
            message_id: None,
            done: true,
        });
        let _ = self.event_tx.send(AcpEvent::PromptComplete {
            stop_reason: stop,
        });
        Ok(())
    }

    /// Cancel in-flight prompt (ACP notification — no id).
    pub async fn cancel(&self) -> Result<(), String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no session".to_string())?;
        self.stopped.store(true, Ordering::SeqCst);
        self.notify("session/cancel", wire_session_cancel_params(&sid))
            .await
    }

    /// List rewind points (one per user prompt). Grok extension `x.ai/rewind/points`.
    pub async fn rewind_points(&self) -> Result<Value, String> {
        let sid = self
            .agent_session_id
            .lock()
            .clone()
            .ok_or_else(|| "no session".to_string())?;
        self.request(
            "x.ai/rewind/points",
            json!({ "sessionId": sid }),
        )
        .await
    }

    /// Truncate agent conversation to a user-prompt index (and optionally restore files).
    /// Grok extension `x.ai/rewind/execute` — `targetPromptIndex` is 0-based user turn index.
    ///
    /// Semantics (TUI `/rewind`): discard everything **after** the selected turn.
    /// For "edit last user message", pass the **previous** user-turn index, or when
    /// editing the only user message use index `0` with a full clear via host journal.
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
        // Prefer conversation truncate; file restore is optional (edit-resend usually false).
        let mut params = json!({
            "sessionId": sid,
            "targetPromptIndex": target_prompt_index,
        });
        if let Some(obj) = params.as_object_mut() {
            obj.insert("restoreFiles".into(), Value::Bool(restore_files));
            // Some builds accept this camelCase alias.
            obj.insert("restore_files".into(), Value::Bool(restore_files));
        }
        self.request("x.ai/rewind/execute", params).await
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
            if matches!(result.get("outcome").and_then(|v| v.as_str()), Some("accepted")) {
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
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
        *self.stdin.lock().await = None;
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
    Accepted { answers: Value },
    Cancelled,
}

// ── Wire builders / pure decoders (locked by tests/fixtures/acp/) ────────────

/// Host → agent `initialize` params. Golden: `handshake_initialize.json`.
pub fn wire_initialize_params() -> Value {
    json!({
        "protocolVersion": 1,
        "clientInfo": { "name": "grok-app", "version": "0.1.0" },
        "capabilities": {}
    })
}

/// Host → agent `session/prompt` params.
pub fn wire_session_prompt_params(session_id: &str, text: &str) -> Value {
    json!({
        "sessionId": session_id,
        "prompt": [{ "type": "text", "text": text }]
    })
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
    let tool_name = tool_call
        .get("kind")
        .or_else(|| tool_call.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let options = params.get("options").cloned().unwrap_or(json!([]));
    AcpEvent::PermissionRequest {
        rpc_id,
        tool_call_id,
        tool_name,
        title,
        options,
        raw: params.clone(),
    }
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
            let title_l = title.to_ascii_lowercase();
            let kind_l = k.to_ascii_lowercase();
            if status == "completed"
                && (title_l.contains("compact")
                    || kind_l.contains("compact")
                    || tool_call_id.to_ascii_lowercase().contains("compact"))
            {
                out.push(AcpEvent::ContextCompact {
                    trigger: "manual".into(),
                    tokens_before: None,
                    tokens_after: None,
                    summary_preview: None,
                    note: Some(title.clone()),
                });
            }
            out.push(AcpEvent::ToolCall {
                tool_call_id,
                title,
                kind: k,
                status,
                raw: update.clone(),
            });
        }
        "retry_state" => {
            let attempt = update
                .get("attempt")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
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
        "tokens_used"
        | "compaction"
        | "compaction_completed"
        | "context_compact"
        | "auto_compact"
        | "compaction_checkpoint" => {
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
        _ => {
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
            let title = update
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if title.contains("compact") {
                out.push(AcpEvent::ContextCompact {
                    trigger: if title.contains("auto") {
                        "auto".into()
                    } else {
                        "manual".into()
                    },
                    tokens_before: None,
                    tokens_after: None,
                    summary_preview: None,
                    note: update
                        .get("title")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }
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
    if lower.contains("401")
        || lower.contains("auth")
        || lower.contains("unauthor")
        || lower.contains("login")
        || lower.contains("access denied")
        || lower.contains("authentication code")
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
        || lower.contains("rpc channel closed")
        || lower.contains("shell_api_error")
        || lower.contains("no available channels")
        || lower.contains("provider retries")
        || lower.contains("service unavailable")
    {
        // Timeouts / provider 503 / channel-empty are network-provider, not process crash.
        AgentError::new(AgentErrorCode::NetworkProvider, e)
    } else if lower.contains("not found") && lower.contains("cli") {
        AgentError::new(AgentErrorCode::CliNotFound, e)
    } else {
        AgentError::new(AgentErrorCode::AgentCrashed, e)
    }
}

/// Whether host should stop waiting and fail the turn (Codex-like 5-retry cap).
pub fn should_abort_provider_retry(attempt: u32, max_retries: u32, status: &str) -> bool {
    let status = status.to_lowercase();
    if status.contains("fail")
        || status.contains("exhaust")
        || status.contains("gave_up")
        || status.contains("give_up")
        || status == "error"
    {
        return true;
    }
    let cap = max_retries.min(HOST_PROVIDER_MAX_RETRIES).max(1);
    attempt >= cap
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

/// Lightweight connectivity check for **API mode**: TCP-connect to an ACP
/// server (`host:port`), perform the `initialize` handshake, and report the
/// agent version / current model. Creates no client and no session — just
/// confirms the address is reachable and speaks ACP. Bounded by timeouts so
/// a wrong address / silent port fails fast.
pub async fn probe_acp_server(addr: &str) -> AcpProbeResult {
    use tokio::time::{timeout, Duration};

    let stream = match timeout(Duration::from_secs(5), TcpStream::connect(addr)).await {
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
                return AcpProbeResult::fail(
                    "connected, but no ACP initialize result in response",
                );
            }
            let meta = &result["_meta"];
            AcpProbeResult {
                ok: true,
                agent_version: meta["agentVersion"].as_str().map(String::from),
                model: meta["modelState"]["currentModelId"]
                    .as_str()
                    .map(String::from),
                error: None,
            }
        }
        Ok(Ok(_)) => {
            AcpProbeResult::fail("server closed the connection (EOF) before responding")
        }
        Ok(Err(e)) => AcpProbeResult::fail(format!("read failed: {e}")),
        Err(_) => AcpProbeResult::fail("connected, but no ACP response within 20s"),
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;

    #[test]
    fn abort_at_host_cap_even_if_agent_allows_more() {
        assert!(!should_abort_provider_retry(1, 15, "retrying"));
        assert!(!should_abort_provider_retry(4, 15, "retrying"));
        assert!(should_abort_provider_retry(5, 15, "retrying"));
        assert!(should_abort_provider_retry(6, 15, "retrying"));
    }

    #[test]
    fn abort_on_failed_status() {
        assert!(should_abort_provider_retry(1, 15, "failed"));
        assert!(should_abort_provider_retry(1, 15, "exhausted"));
    }

    #[test]
    fn respect_lower_agent_max() {
        assert!(!should_abort_provider_retry(1, 3, "retrying"));
        assert!(should_abort_provider_retry(3, 3, "retrying"));
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
mod live_handshake_tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn live_initialize_session_new_under_30s() {
        if std::env::var("GROK_APP_LIVE_ACP").ok().as_deref() != Some("1") {
            eprintln!("skip live ACP (set GROK_APP_LIVE_ACP=1)");
            return;
        }
        let cli = which::which("grok").or_else(|_| {
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
        }).expect("grok cli");
        let cwd = std::env::current_dir().unwrap();
        let t0 = std::time::Instant::now();
        let (client, mut events) = AcpClient::spawn(cli, cwd).expect("spawn");
        // drain events in bg
        tokio::spawn(async move {
            while let Some(ev) = events.recv().await {
                eprintln!("ev: {:?}", std::mem::discriminant(&ev));
            }
        });
        let sid = tokio::time::timeout(Duration::from_secs(45), client.initialize_and_new_session())
            .await
            .expect("overall timeout")
            .expect("handshake");
        eprintln!("OK session={} in {:?}", sid, t0.elapsed());
        client.kill().await;
        assert!(!sid.is_empty());
    }
}
