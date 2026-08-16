//! Local session API for external integrations (#626 first slice).
//!
//! Loopback HTTP (127.0.0.1, token file) + CLI that talks to the same Host
//! helpers. Lists Grok App sessions and continues one by id + prompt.
//! Does not create a new chat. Does not interrupt a running turn.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::paths::{app_data_root, ensure_app_dirs};
use crate::session_manager::SessionManager;
use crate::store::{self, SessionMeta};

pub const SESSIONS_FLAG: &str = "--sessions";
pub const SESSION_SEND_FLAG: &str = "--session-send";
pub const PROMPT_FLAG: &str = "--prompt";
pub const PROMPT_FILE_FLAG: &str = "--prompt-file";
pub const IDEMPOTENCY_FLAG: &str = "--idempotency-key";
pub const INCLUDE_ARCHIVED_FLAG: &str = "--include-archived";

const ENDPOINT_FILE: &str = "session-api.json";
const IDEMPOTENCY_FILE: &str = "session-api-idempotency.json";
const IDEMPOTENCY_CAP: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    TurnStarted,
    Busy,
    NotFound,
    AppNotRunning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub updated_at: String,
    pub archived: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub prompt: String,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub ok: bool,
    pub status: TurnStatus,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointFile {
    pub url: String,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionApiStatus {
    pub listening: bool,
    pub url: Option<String>,
    pub token_file: String,
}

pub struct SessionApiHandle {
    pub url: String,
    shutdown: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

impl Drop for SessionApiHandle {
    fn drop(&mut self) {
        if let Some(tx) = self
            .shutdown
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = tx.send(());
        }
        let _ = fs::remove_file(endpoint_path());
    }
}

#[derive(Clone)]
struct HttpState {
    token: String,
    mgr: Arc<SessionManager>,
    app: AppHandle,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    include_archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    List {
        include_archived: bool,
    },
    Send {
        session_id: String,
        prompt: String,
        idempotency_key: Option<String>,
    },
}

pub fn parse_cli(argv: &[String]) -> Result<CliCommand, String> {
    let args: Vec<&str> = argv.iter().skip(1).map(String::as_str).collect();
    if args.iter().any(|a| *a == SESSIONS_FLAG) {
        return Ok(CliCommand::List {
            include_archived: args.iter().any(|a| *a == INCLUDE_ARCHIVED_FLAG),
        });
    }
    if let Some(i) = args.iter().position(|a| *a == SESSION_SEND_FLAG) {
        let session_id = args
            .get(i + 1)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.starts_with("--"))
            .ok_or_else(|| "usage: --session-send <session-id> --prompt <text>".to_string())?;
        let prompt = parse_prompt(&args)?;
        if prompt.trim().is_empty() {
            return Err("empty prompt".into());
        }
        let idempotency_key = flag_value(&args, IDEMPOTENCY_FLAG);
        return Ok(CliCommand::Send {
            session_id,
            prompt,
            idempotency_key,
        });
    }
    Err("not a session-api command".into())
}

fn flag_value(args: &[&str], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| *a == flag)
        .and_then(|i| args.get(i + 1))
        .map(|s| (*s).to_string())
        .filter(|s| !s.starts_with("--"))
}

fn parse_prompt(args: &[&str]) -> Result<String, String> {
    if let Some(text) = flag_value(args, PROMPT_FLAG) {
        return Ok(text);
    }
    if let Some(path) = flag_value(args, PROMPT_FILE_FLAG) {
        if path == "-" {
            use std::io::Read;
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| e.to_string())?;
            return Ok(buf);
        }
        return fs::read_to_string(path).map_err(|e| e.to_string());
    }
    Err("provide --prompt <text> or --prompt-file <path>".into())
}

pub fn list_sessions(include_archived: bool) -> Vec<SessionListItem> {
    let projects = store::load_projects();
    let mut rows: Vec<SessionListItem> = store::load_sessions_index()
        .into_iter()
        .filter(|s| include_archived || !s.archived)
        .map(|s| map_session(s, &projects))
        .collect();
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    rows
}

fn map_session(s: SessionMeta, projects: &[store::Project]) -> SessionListItem {
    let project_name = s.project_id.as_ref().and_then(|pid| {
        projects
            .iter()
            .find(|p| &p.id == pid)
            .map(|p| p.name.clone())
    });
    SessionListItem {
        id: s.id,
        title: s.title,
        project_id: s.project_id,
        project_name,
        updated_at: s.updated_at.to_rfc3339(),
        archived: s.archived,
        pinned: s.pinned,
    }
}

pub fn endpoint_path() -> PathBuf {
    app_data_root().join(ENDPOINT_FILE)
}

pub fn read_endpoint_file() -> Option<EndpointFile> {
    let raw = fs::read_to_string(endpoint_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_endpoint_file(ep: &EndpointFile) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = endpoint_path();
    let body = serde_json::to_string_pretty(ep).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn token_ok(headers: &HeaderMap, expected: &str) -> bool {
    if let Some(v) = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
    {
        let rest = v.strip_prefix("Bearer ").unwrap_or(v).trim();
        if constant_time_eq(rest, expected) {
            return true;
        }
    }
    if let Some(v) = headers.get("x-grok-token").and_then(|h| h.to_str().ok()) {
        return constant_time_eq(v.trim(), expected);
    }
    false
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IdempotencyStore {
    #[serde(default)]
    entries: Vec<IdempotencyEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdempotencyEntry {
    key: String,
    result: TurnResult,
}

fn idempotency_path() -> PathBuf {
    app_data_root().join(IDEMPOTENCY_FILE)
}

pub fn recall_idempotency(key: &str) -> Option<TurnResult> {
    let raw = fs::read_to_string(idempotency_path()).ok()?;
    let store: IdempotencyStore = serde_json::from_str(&raw).ok()?;
    store
        .entries
        .into_iter()
        .find(|e| e.key == key)
        .map(|e| e.result)
}

pub fn remember_idempotency(key: &str, result: &TurnResult) {
    let _ = ensure_app_dirs();
    let mut store = fs::read_to_string(idempotency_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<IdempotencyStore>(&raw).ok())
        .unwrap_or_default();
    store.entries.retain(|e| e.key != key);
    store.entries.push(IdempotencyEntry {
        key: key.to_string(),
        result: result.clone(),
    });
    if store.entries.len() > IDEMPOTENCY_CAP {
        let drop_n = store.entries.len() - IDEMPOTENCY_CAP;
        store.entries.drain(0..drop_n);
    }
    if let Ok(body) = serde_json::to_string_pretty(&store) {
        let _ = fs::write(idempotency_path(), body);
    }
}

pub fn classify_send_error(err: &str) -> TurnStatus {
    let e = err.to_ascii_lowercase();
    if e.contains("still running") || e.contains("task_already_running") {
        return TurnStatus::Busy;
    }
    if e.contains("session not found") || e.contains("not found") {
        return TurnStatus::NotFound;
    }
    TurnStatus::Error
}

pub fn prepare_send(session_id: &str, prompt: &str) -> Result<PreparedSend, TurnResult> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(TurnResult {
            ok: false,
            status: TurnStatus::Error,
            session_id: session_id.to_string(),
            idempotency_key: None,
            message: Some("empty prompt".into()),
        });
    }
    let list = store::load_sessions_index();
    let Some(meta) = list.into_iter().find(|s| s.id == session_id) else {
        return Err(TurnResult {
            ok: false,
            status: TurnStatus::NotFound,
            session_id: session_id.to_string(),
            idempotency_key: None,
            message: Some("session not found".into()),
        });
    };
    let projects = store::load_projects();
    if let Some(ref pid) = meta.project_id {
        let Some(p) = projects.iter().find(|p| &p.id == pid) else {
            return Err(TurnResult {
                ok: false,
                status: TurnStatus::Error,
                session_id: session_id.to_string(),
                idempotency_key: None,
                message: Some(format!("project not found: {pid}")),
            });
        };
        if !p.trusted {
            return Err(TurnResult {
                ok: false,
                status: TurnStatus::Error,
                session_id: session_id.to_string(),
                idempotency_key: None,
                message: Some(format!("project not trusted: {}", p.name)),
            });
        }
        if !p.path_ok {
            return Err(TurnResult {
                ok: false,
                status: TurnStatus::Error,
                session_id: session_id.to_string(),
                idempotency_key: None,
                message: Some(format!("project path missing: {}", p.name)),
            });
        }
    }
    // Prefer a linked worktree cwd (same as the composer), else the project path.
    // `connect` treats this as mock_mode=None — never pass SessionMeta.mode.
    let project_path = meta
        .worktree_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            meta.project_id.as_ref().and_then(|pid| {
                projects
                    .iter()
                    .find(|p| &p.id == pid)
                    .map(|p| p.path.clone())
            })
        });
    Ok(PreparedSend {
        session_id: meta.id,
        project_path,
        prompt: prompt.to_string(),
    })
}

pub struct PreparedSend {
    pub session_id: String,
    pub project_path: Option<String>,
    pub prompt: String,
}

pub async fn dispatch_turn(
    app: &AppHandle,
    mgr: &Arc<SessionManager>,
    req: PreparedSend,
) -> TurnResult {
    let sid = req.session_id.clone();
    if let Err(e) = mgr
        .connect(app.clone(), req.project_path, Some(sid.clone()), None)
        .await
    {
        return TurnResult {
            ok: false,
            status: TurnStatus::Error,
            session_id: sid,
            idempotency_key: None,
            message: Some(format!("connect failed: {e}")),
        };
    }
    match mgr
        .send_message(app.clone(), req.prompt, None, None, Some(sid.clone()))
        .await
    {
        Ok(_) => TurnResult {
            ok: true,
            status: TurnStatus::TurnStarted,
            session_id: sid,
            idempotency_key: None,
            message: None,
        },
        Err(e) => TurnResult {
            ok: false,
            status: classify_send_error(&e),
            session_id: sid,
            idempotency_key: None,
            message: Some(e),
        },
    }
}

async fn handle_turn(
    state: &HttpState,
    session_id: &str,
    body: TurnRequest,
) -> (StatusCode, Json<TurnResult>) {
    let key = body
        .idempotency_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(ref k) = key {
        if let Some(prev) = recall_idempotency(k) {
            return (status_for(&prev.status), Json(prev));
        }
    }
    let prepared = match prepare_send(session_id, &body.prompt) {
        Ok(p) => p,
        Err(mut r) => {
            r.idempotency_key = key.clone();
            if let Some(ref k) = key {
                remember_idempotency(k, &r);
            }
            return (status_for(&r.status), Json(r));
        }
    };
    let mut result = dispatch_turn(&state.app, &state.mgr, prepared).await;
    result.idempotency_key = key.clone();
    if let Some(ref k) = key {
        remember_idempotency(k, &result);
    }
    (status_for(&result.status), Json(result))
}

fn status_for(s: &TurnStatus) -> StatusCode {
    match s {
        TurnStatus::TurnStarted => StatusCode::OK,
        TurnStatus::Busy => StatusCode::CONFLICT,
        TurnStatus::NotFound => StatusCode::NOT_FOUND,
        TurnStatus::AppNotRunning => StatusCode::SERVICE_UNAVAILABLE,
        TurnStatus::Error => StatusCode::BAD_REQUEST,
    }
}

fn unauthorized() -> impl IntoResponse {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "ok": false,
            "status": "error",
            "message": "missing or invalid token",
        })),
    )
}

async fn get_sessions(
    State(state): State<HttpState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    if !token_ok(&headers, &state.token) {
        return unauthorized().into_response();
    }
    Json(list_sessions(q.include_archived)).into_response()
}

async fn post_turn(
    State(state): State<HttpState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
    Json(body): Json<TurnRequest>,
) -> impl IntoResponse {
    if !token_ok(&headers, &state.token) {
        return unauthorized().into_response();
    }
    let (code, json) = handle_turn(&state, &session_id, body).await;
    (code, json).into_response()
}

async fn get_health(State(state): State<HttpState>, headers: HeaderMap) -> impl IntoResponse {
    if !token_ok(&headers, &state.token) {
        return unauthorized().into_response();
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn start(app: AppHandle, mgr: Arc<SessionManager>) -> Result<SessionApiHandle, String> {
    let token = random_token();
    let state = HttpState {
        token: token.clone(),
        mgr,
        app,
    };
    let router = Router::new()
        .route("/v1/health", get(get_health))
        .route("/v1/sessions", get(get_sessions))
        .route("/v1/sessions/{id}/turns", post(post_turn))
        .with_state(state);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("session api bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("session api local_addr: {e}"))?
        .port();
    let url = format!("http://127.0.0.1:{port}");
    write_endpoint_file(&EndpointFile {
        url: url.clone(),
        token,
        pid: Some(std::process::id()),
    })?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let serve = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(e) = serve.await {
            tracing::error!(error = %e, "session api http server exited");
        }
    });
    tracing::info!(%url, "session api listening (loopback, token-gated)");
    Ok(SessionApiHandle {
        url,
        shutdown: std::sync::Mutex::new(Some(shutdown_tx)),
    })
}

pub fn status(app: Option<&AppHandle>) -> SessionApiStatus {
    let listening = app
        .and_then(|a| a.try_state::<SessionApiHandle>().map(|_| true))
        .unwrap_or(false);
    let file = read_endpoint_file();
    SessionApiStatus {
        listening,
        url: file.map(|f| f.url),
        token_file: endpoint_path().display().to_string(),
    }
}

#[tauri::command]
pub fn session_api_status(app: AppHandle) -> SessionApiStatus {
    status(Some(&app))
}

#[tauri::command]
pub async fn session_api_reveal_token_file() -> Result<String, String> {
    let path = endpoint_path();
    if !path.is_file() {
        return Err("session API is not listening — start Grok App first".into());
    }
    let shown = path.display().to_string();
    let pb = path.clone();
    tokio::task::spawn_blocking(move || crate::process_util::reveal_in_file_manager(&pb))
        .await
        .map_err(|e| e.to_string())??;
    Ok(shown)
}

/// Client-only CLI. Does not start the desktop window.
pub fn run_cli() -> i32 {
    #[cfg(windows)]
    attach_parent_console();
    let argv: Vec<String> = std::env::args().collect();
    match parse_cli(&argv) {
        Ok(CliCommand::List { include_archived }) => {
            let rows = match read_endpoint_file() {
                Some(ep) => match http_list(&ep, include_archived) {
                    Ok(rows) => rows,
                    Err(e) => {
                        eprintln!("session-api: {e}; falling back to local index");
                        list_sessions(include_archived)
                    }
                },
                None => list_sessions(include_archived),
            };
            match serde_json::to_string_pretty(&rows) {
                Ok(s) => {
                    println!("{s}");
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
        Ok(CliCommand::Send {
            session_id,
            prompt,
            idempotency_key,
        }) => {
            let Some(ep) = read_endpoint_file() else {
                let out = TurnResult {
                    ok: false,
                    status: TurnStatus::AppNotRunning,
                    session_id,
                    idempotency_key,
                    message: Some(
                        "Grok App is not running. Start the app (or leave it in the tray), then retry."
                            .into(),
                    ),
                };
                print_turn(&out);
                return 2;
            };
            match http_send(&ep, &session_id, &prompt, idempotency_key.as_deref()) {
                Ok(r) => {
                    print_turn(&r);
                    if r.ok {
                        0
                    } else if r.status == TurnStatus::Busy {
                        3
                    } else if r.status == TurnStatus::AppNotRunning {
                        2
                    } else {
                        1
                    }
                }
                Err(e) => {
                    let out = TurnResult {
                        ok: false,
                        status: TurnStatus::AppNotRunning,
                        session_id,
                        idempotency_key,
                        message: Some(format!(
                            "Grok App is not reachable ({e}). Start the app (or leave it in the tray), then retry."
                        )),
                    };
                    print_turn(&out);
                    2
                }
            }
        }
        Err(e) => {
            if e.contains("not a session-api command") {
                return -1;
            }
            eprintln!("{e}");
            1
        }
    }
}

fn print_turn(r: &TurnResult) {
    match serde_json::to_string_pretty(r) {
        Ok(s) => println!("{s}"),
        Err(e) => eprintln!("{e}"),
    }
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}

fn http_list(ep: &EndpointFile, include_archived: bool) -> Result<Vec<SessionListItem>, String> {
    let url = format!(
        "{}/v1/sessions?include_archived={}",
        ep.url.trim_end_matches('/'),
        include_archived
    );
    let res = http_client()?
        .get(url)
        .header(header::AUTHORIZATION, format!("Bearer {}", ep.token))
        .send()
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.json().map_err(|e| e.to_string())
}

fn http_send(
    ep: &EndpointFile,
    session_id: &str,
    prompt: &str,
    idempotency_key: Option<&str>,
) -> Result<TurnResult, String> {
    let url = format!(
        "{}/v1/sessions/{}/turns",
        ep.url.trim_end_matches('/'),
        session_id
    );
    let body = TurnRequest {
        prompt: prompt.to_string(),
        idempotency_key: idempotency_key.map(str::to_string),
    };
    let res = http_client()?
        .post(url)
        .header(header::AUTHORIZATION, format!("Bearer {}", ep.token))
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    res.json().map_err(|e| e.to_string())
}

/// Try CLI; `true` means the process should exit (caller uses [`run_cli`] status).
pub fn try_run_cli() -> bool {
    let argv: Vec<String> = std::env::args().collect();
    match parse_cli(&argv) {
        Ok(_) => true,
        Err(e) => !e.contains("not a session-api command"),
    }
}

#[cfg(windows)]
fn attach_parent_console() {
    type BOOL = i32;
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> BOOL;
    }
    unsafe {
        let _ = AttachConsole(0xFFFF_FFFF);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_and_send() {
        let list = parse_cli(&[
            "grok-app".into(),
            "--sessions".into(),
            "--include-archived".into(),
        ])
        .unwrap();
        assert_eq!(
            list,
            CliCommand::List {
                include_archived: true
            }
        );
        let send = parse_cli(&[
            "grok-app".into(),
            "--session-send".into(),
            "abc-123".into(),
            "--prompt".into(),
            "hello there".into(),
            "--idempotency-key".into(),
            "k1".into(),
        ])
        .unwrap();
        assert_eq!(
            send,
            CliCommand::Send {
                session_id: "abc-123".into(),
                prompt: "hello there".into(),
                idempotency_key: Some("k1".into()),
            }
        );
        assert!(parse_cli(&["grok-app".into()]).is_err());
    }

    #[test]
    fn classify_busy_and_missing() {
        assert_eq!(
            classify_send_error("CONNECT_FAILED: chat x is still running its previous turn"),
            TurnStatus::Busy
        );
        assert_eq!(
            classify_send_error("session not found"),
            TurnStatus::NotFound
        );
        assert_eq!(classify_send_error("boom"), TurnStatus::Error);
    }

    #[test]
    fn token_header_accepts_bearer() {
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, "Bearer secret".parse().unwrap());
        assert!(token_ok(&h, "secret"));
        assert!(!token_ok(&h, "other"));
    }

    #[test]
    fn token_header_accepts_x_grok_token() {
        let mut h = HeaderMap::new();
        h.insert("x-grok-token", "secret".parse().unwrap());
        assert!(token_ok(&h, "secret"));
        assert!(!token_ok(&h, "other"));
    }

    #[test]
    fn send_without_prompt_is_cli_error() {
        let err =
            parse_cli(&["grok-app".into(), "--session-send".into(), "abc".into()]).unwrap_err();
        assert!(err.contains("prompt"), "{err}");
        assert!(try_run_cli_argv(&[
            "grok-app".into(),
            "--session-send".into(),
            "abc".into(),
        ]));
        assert!(!try_run_cli_argv(&["grok-app".into()]));
    }

    fn try_run_cli_argv(argv: &[String]) -> bool {
        match parse_cli(argv) {
            Ok(_) => true,
            Err(e) => !e.contains("not a session-api command"),
        }
    }
}
