//! Mirror WebSocket RPC method dispatch (DESIGN §7.2).

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::AppHandle;

use super::MirrorHost;
use crate::session_manager::SessionManager;
use crate::store;

/// Protocol version advertised in `mirror://hello`.
pub const PROTOCOL_VERSION: u32 = 1;

/// Write RPC methods blocked when the host is in read-only mode.
/// Keep in sync with `src/lib/mirrorWriteSurface.ts` (UI category list).
pub const WRITE_METHODS: &[&str] = &[
    "session.send",
    "session.stop",
    "session.create",
    "session.resolvePermission",
    "session.answerAskUser",
    "session.reviewPlan",
    "session.delete",
    "session.rename",
];

#[derive(Debug, Clone)]
pub struct RpcError {
    pub code: &'static str,
    pub message: String,
}

impl RpcError {
    pub fn unsupported(method: &str) -> Self {
        Self {
            code: "UNSUPPORTED",
            message: format!("unsupported method: {method}"),
        }
    }

    pub fn bad_params(msg: impl Into<String>) -> Self {
        Self {
            code: "BAD_PARAMS",
            message: msg.into(),
        }
    }

    pub fn host(msg: impl Into<String>) -> Self {
        Self {
            code: "HOST_ERROR",
            message: msg.into(),
        }
    }

    pub fn no_ctx() -> Self {
        Self {
            code: "NOT_READY",
            message: "mirror host context not attached (app/session manager)".into(),
        }
    }
}

/// Dispatch one RPC method. Unknown methods → `UNSUPPORTED` (WS stays open).
pub async fn dispatch(
    method: &str,
    params: Value,
    host: &MirrorHost,
    app: Option<&AppHandle>,
    mgr: Option<&Arc<SessionManager>>,
) -> Result<Value, RpcError> {
    // Read-only sessions can observe but not drive the agent.
    if host.is_read_only() && WRITE_METHODS.contains(&method) {
        return Err(RpcError::unsupported("mirror is in read-only mode"));
    }

    match method {
        // ── Read path (Slice 3) ───────────────────────────────────────────
        "projects.list" => {
            let list = store::load_projects();
            Ok(serde_json::to_value(list).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "sessions.list" => {
            let list = store::load_sessions_index();
            Ok(serde_json::to_value(list).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.messages" => {
            let id = param_string(&params, &["sessionId", "session_id", "id"])
                .ok_or_else(|| RpcError::bad_params("sessionId required"))?;
            // Same as desktop `session_messages`: recover missing assistant bodies
            // and backfill user attachment cards from agent chat_history.
            let _ = crate::cli_sessions::try_reconcile_linked_session(&id);
            let msgs = store::load_messages(&id);
            Ok(serde_json::to_value(msgs).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.getState" => {
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?;
            let snap = mgr.snapshot();
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "account.status" => {
            // Light: skip heavy billing refresh unless client asks.
            let refresh = params
                .get("refreshBilling")
                .or_else(|| params.get("refresh_billing"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let include_usage = params
                .get("includeLocalUsage")
                .or_else(|| params.get("include_local_usage"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let status = crate::account::account_status_opts(None, refresh, include_usage).await;
            Ok(serde_json::to_value(status).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "settings.get" => {
            let s = store::load_settings();
            // Subset safe for phone display (no secret paths beyond what desktop already exposes).
            Ok(json!({
                "theme": s.theme,
                "locale": s.locale,
                "sessionDataMode": s.session_data_mode,
                "permissionPolicy": s.permission_policy,
                "modelId": s.model_id,
                "effort": s.effort,
                "mode": s.mode,
                "composerPrefsScope": s.composer_prefs_scope,
                "maxConcurrentAgents": s.max_concurrent_agents,
                "agentIdleMinutes": s.agent_idle_minutes,
                "streamStallSeconds": s.stream_stall_seconds,
                "onboardingDone": true,
                "setupSkipped": true,
                "setupWizardCompleted": true,
                "authSetupDeferred": true,
                "defaultOpenTarget": s.default_open_target,
                "manualCliPath": null,
                "acpServerAddr": s.acp_server_addr,
            }))
        }
        "models.list" => {
            let models = crate::models_catalog::list_available_models();
            Ok(serde_json::to_value(models).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "composer.prefsResolve" => {
            let project_id = param_string(&params, &["projectId", "project_id"]);
            let session_id = param_string(&params, &["sessionId", "session_id"]);
            let prefs = store::resolve_composer_prefs(project_id.as_deref(), session_id.as_deref());
            Ok(serde_json::to_value(prefs).map_err(|e| RpcError::host(e.to_string()))?)
        }

        // ── Composer voice dictation (phone STT) ─────────────────────────────
        // Minimal disclosure: `voice.status` returns only a boolean availability
        // (+ opaque reason/authSource class), never any secret material.
        "voice.status" => {
            let status = crate::voice_stt::voice_status();
            Ok(serde_json::to_value(status).map_err(|e| RpcError::host(e.to_string()))?)
        }
        // Stateless STT: decode base64 audio on the host and POST to xAI STT.
        // The same call the desktop `voice_transcribe` command uses, unchanged.
        "voice.transcribe" => {
            // audioBase64 is required and must be a raw base64 string (no data: URL).
            let audio_base64 = params
                .get("audioBase64")
                .or_else(|| params.get("audio_base64"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| RpcError::bad_params("audioBase64 required"))?;
            // Hygiene cap far above real dictation size (~24 MB of base64 text,
            // i.e. ~18 MB of audio). Rejects abusive frames before we decode.
            // The mirror WS frame cap (axum 64 MiB default) is the outer bound.
            const MAX_AUDIO_BASE64_BYTES: usize = 24 * 1024 * 1024;
            if audio_base64.len() > MAX_AUDIO_BASE64_BYTES {
                return Err(RpcError::bad_params(format!(
                    "audioBase64 too large: {} bytes (max {})",
                    audio_base64.len(),
                    MAX_AUDIO_BASE64_BYTES
                )));
            }
            let filename = param_string(&params, &["filename"]);
            let mime = param_string(&params, &["mime"]);
            let locale = param_string(&params, &["locale"]);
            let result = crate::voice_stt::voice_transcribe(
                audio_base64.to_string(),
                filename,
                mime,
                locale,
            )
            .await;
            Ok(serde_json::to_value(result).map_err(|e| RpcError::host(e.to_string()))?)
        }

        // ── Focus / connect (Slice 4) ─────────────────────────────────────
        "session.connect" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let project_path = param_string(&params, &["projectPath", "project_path"]);
            let session_id = param_string(&params, &["sessionId", "session_id"]);
            let mode = param_string(&params, &["mode"]);
            let snap = mgr
                .connect(app, project_path, session_id, mode)
                .await
                .map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.create" => {
            let project_id = param_string(&params, &["projectId", "project_id"]);
            let title = param_string(&params, &["title"]);
            let scheduled = params
                .get("scheduled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let meta =
                store::create_session(project_id, title, scheduled).map_err(RpcError::host)?;
            // Desktop + every other mirror client must see the new row without a
            // manual refresh (the index was mutated behind their back).
            notify_sessions_changed(app, "create", &meta.id);
            Ok(serde_json::to_value(meta).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.rename" => {
            let id = param_string(&params, &["id", "sessionId", "session_id"])
                .ok_or_else(|| RpcError::bad_params("id required"))?;
            let title = param_string(&params, &["title"])
                .ok_or_else(|| RpcError::bad_params("title required"))?;
            let meta = store::rename_session(&id, &title).map_err(RpcError::host)?;
            // Same as `commands::session_rename`: keep live meta aligned so a
            // mid-stream session://state does not revive the old title.
            if let (Some(app), Some(mgr)) = (app, mgr) {
                let _ = mgr.apply_title(app, &meta.id, &meta.title);
            }
            notify_sessions_changed(app, "rename", &meta.id);
            Ok(serde_json::to_value(meta).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.autoTitle" => {
            let id = param_string(&params, &["id", "sessionId", "session_id"])
                .ok_or_else(|| RpcError::bad_params("id required"))?;
            let first_message = param_string(&params, &["firstMessage", "first_message"])
                .ok_or_else(|| RpcError::bad_params("firstMessage required"))?;
            let meta = crate::session_title::auto_title_session_fast(&id, &first_message)
                .map_err(RpcError::host)?;
            if let (Some(app), Some(mgr)) = (app, mgr) {
                let _ = mgr.apply_title(app, &meta.id, &meta.title);
                crate::session_title::refine_title_in_background(
                    app.clone(),
                    Arc::clone(mgr),
                    id,
                    first_message,
                );
            }
            notify_sessions_changed(app, "autoTitle", &meta.id);
            Ok(serde_json::to_value(meta).map_err(|e| RpcError::host(e.to_string()))?)
        }

        // ── Write path (Slice 5 / AC5) ────────────────────────────────────
        "session.send" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let text = param_string(&params, &["text"])
                .ok_or_else(|| RpcError::bad_params("text required"))?;
            let display_text = param_string(&params, &["displayText", "display_text"]);
            let attachments = param_attachments(&params);
            // Connect-before-send if client names a session that is not focused.
            let target = param_string(&params, &["sessionId", "session_id"]);
            if let Some(sid) = target.clone() {
                let focused = mgr.snapshot().session_id;
                if focused.as_deref() != Some(sid.as_str()) {
                    mgr.connect(app.clone(), None, Some(sid), None)
                        .await
                        .map_err(RpcError::host)?;
                }
            } else if mgr.snapshot().session_id.is_none() {
                return Err(RpcError::host(
                    "no active session — call session.connect or pass sessionId",
                ));
            }
            // Pass the id through so Host re-focuses if another chat stole the
            // live slot between connect and send. Attachments land on the user
            // journal row so history reloads image/file cards.
            let snap = mgr
                .send_message(app, text, display_text, attachments, target)
                .await
                .map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.stop" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let session_id = param_string(&params, &["sessionId", "session_id"]);
            let snap = mgr.stop(app, session_id).await.map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }

        // ── Interactive gates (Slice 6) ──────────────────────────────────
        "session.resolvePermission" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let rpc_id = param_u64(&params, &["rpcId", "rpc_id"])
                .ok_or_else(|| RpcError::bad_params("rpcId required"))?;
            let decision = param_string(&params, &["decision"])
                .ok_or_else(|| RpcError::bad_params("decision required"))?;
            let option_id = param_string(&params, &["optionId", "option_id"]);
            let scope_key = param_string(&params, &["scopeKey", "scope_key", "scope"]);
            let client_options = params.get("options").cloned();
            let client_tool = param_string(&params, &["toolName", "tool_name"]);
            let snap = mgr
                .resolve_permission(
                    app,
                    rpc_id,
                    decision,
                    option_id,
                    scope_key,
                    param_string(&params, &["sessionId", "session_id"]),
                    client_options,
                    client_tool,
                )
                .await
                .map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.resolvePlan" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let decision = param_string(&params, &["decision"])
                .ok_or_else(|| RpcError::bad_params("decision required"))?;
            let feedback = param_string(&params, &["feedback"]);
            let rpc_id = param_u64(&params, &["rpcId", "rpc_id"]);
            let snap = mgr
                .resolve_plan(
                    app,
                    decision,
                    feedback,
                    rpc_id,
                    param_string(&params, &["sessionId", "session_id"]),
                )
                .await
                .map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }
        "session.resolveAskUser" => {
            let app = app.ok_or_else(RpcError::no_ctx)?.clone();
            let mgr = mgr.ok_or_else(RpcError::no_ctx)?.clone();
            let decision = param_string(&params, &["decision"])
                .ok_or_else(|| RpcError::bad_params("decision required"))?;
            let answers = params.get("answers").cloned().filter(|v| !v.is_null());
            let rpc_id = param_u64(&params, &["rpcId", "rpc_id"]);
            let snap = mgr
                .resolve_ask_user(
                    app,
                    decision,
                    answers,
                    rpc_id,
                    param_string(&params, &["sessionId", "session_id"]),
                )
                .await
                .map_err(RpcError::host)?;
            Ok(serde_json::to_value(snap).map_err(|e| RpcError::host(e.to_string()))?)
        }

        // Explicitly unsupported desktop-only (never crash UI)
        "pick_directory" | "pick_attach_files" | "pick_cli_binary" | "pick_agent_profile"
        | "path_open" | "path_reveal" | "open_in_editor" | "cli_install_latest"
        | "account_login" | "account.login" | "reset_app_data" | "fs_list_dir" | "fs_read_file" => {
            Err(RpcError::unsupported(method))
        }

        _ => Err(RpcError::unsupported(method)),
    }
}

/// Light account blob for hello (no billing refresh).
pub async fn account_summary_light(_app: &AppHandle) -> Value {
    let status = crate::account::account_status(None, false).await;
    json!({
        "signedIn": status.profile.signed_in,
        "displayName": status.profile.display_name.clone()
            .or(status.profile.email.clone()),
        "email": status.profile.email,
        "channel": status.channel,
    })
}

/// Tell every attached surface (desktop WebView + all mirror clients) that the
/// sessions index changed, so each can re-run `sessions.list`. Fired only from
/// the mirror RPC write path — desktop commands already refresh in-process.
fn notify_sessions_changed(app: Option<&AppHandle>, reason: &str, session_id: &str) {
    if let Some(app) = app {
        super::fanout_event(
            app,
            "sessions://changed",
            json!({ "reason": reason, "sessionId": session_id }),
        );
    }
}

fn param_string(params: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = params.get(*k) {
            if v.is_null() {
                continue;
            }
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

/// Optional file/image cards on `session.send` (camelCase wire shape).
fn param_attachments(params: &Value) -> Option<Vec<store::MessageAttachmentStored>> {
    let raw = params
        .get("attachments")
        .or_else(|| params.get("Attachments"))?;
    if raw.is_null() {
        return None;
    }
    let arr = raw.as_array()?;
    let mut out = Vec::new();
    for item in arr {
        let Some(path) = item
            .get("path")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                std::path::Path::new(path)
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.to_string())
            });
        let is_dir = item
            .get("isDir")
            .or_else(|| item.get("is_dir"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        out.push(store::MessageAttachmentStored {
            path: path.to_string(),
            name,
            is_dir,
        });
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn param_u64(params: &Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(v) = params.get(*k) {
            if v.is_null() {
                continue;
            }
            if let Some(n) = v.as_u64() {
                return Some(n);
            }
            if let Some(n) = v.as_i64() {
                if n >= 0 {
                    return Some(n as u64);
                }
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.trim().parse::<u64>() {
                    return Some(n);
                }
            }
            if let Some(f) = v.as_f64() {
                if f.is_finite() && f >= 0.0 && f == f.trunc() {
                    return Some(f as u64);
                }
            }
        }
    }
    None
}
