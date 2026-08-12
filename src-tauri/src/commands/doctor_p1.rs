
/// Mark onboarding complete after a config import. Never flips `session_data_mode`
/// (E05: import ≠ shared — user must switch mode explicitly).
fn apply_import_onboarding_done(settings: &mut AppSettings) {
    settings.onboarding_done = true;
}

#[tauri::command]
pub async fn import_grok_cli_config() -> Result<serde_json::Value, String> {
    let home = crate::process_util::user_home();
    let auth = home.join(".grok").join("auth.json");
    let config = home.join(".grok").join("config.toml");
    let mut msg = Vec::new();
    if auth.is_file() {
        msg.push("Found ~/.grok/auth.json (CLI will use cached_token)".to_string());
    } else {
        msg.push("No ~/.grok/auth.json".to_string());
    }
    if config.is_file() {
        msg.push("Found ~/.grok/config.toml".to_string());
    }
    let mut settings = store::load_settings();
    apply_import_onboarding_done(&mut settings);
    store::save_settings(&settings)?;
    Ok(serde_json::json!({
        "ok": auth.is_file(),
        "messages": msg,
    }))
}

#[tauri::command]
pub async fn import_grok_go_config() -> Result<serde_json::Value, String> {
    // Common grok-go config locations (read-only)
    let home = crate::process_util::user_home();
    let home_s = home.to_string_lossy();
    let mut candidates: Vec<String> = vec![
        format!("{home_s}/.grok-go/config.json"),
        format!("{home_s}/Library/Application Support/com.grokgo.desktop/config.json"),
        format!("{home_s}/Library/Application Support/GrokGo/config.json"),
    ];
    // Windows app-data layouts (cfg-gated; mut used only on Windows).
    if let Some(extra) = windows_grok_go_config_candidates() {
        candidates.extend(extra);
    }
    for c in candidates {
        let p = std::path::PathBuf::from(&c);
        if p.is_file() {
            let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
            let v: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            // Try common keys without logging secrets
            let mut secrets = store::load_secrets();
            if let Some(key) = v
                .pointer("/apiKey")
                .or_else(|| v.pointer("/api_key"))
                .or_else(|| v.pointer("/key"))
                .and_then(|x| x.as_str())
            {
                secrets.relay_api_key = Some(key.to_string());
            }
            if let Some(base) = v
                .pointer("/baseUrl")
                .or_else(|| v.pointer("/base_url"))
                .or_else(|| v.pointer("/endpoint"))
                .and_then(|x| x.as_str())
            {
                secrets.relay_base_url = Some(base.to_string());
            }
            store::save_secrets(&secrets)?;
            let mut settings = store::load_settings();
            apply_import_onboarding_done(&mut settings);
            store::save_settings(&settings)?;
            return Ok(serde_json::json!({
                "ok": true,
                "path": c,
                "message": "Imported grok-go config (keys stored, not logged)."
            }));
        }
    }
    Err("grok-go config not found in known locations".into())
}

#[cfg(test)]
mod import_settings_tests {
    use super::*;

    #[test]
    fn import_onboarding_does_not_flip_session_data_mode() {
        // E05: import_grok_* must not flip session_data_mode (product default is shared).
        let mut s = AppSettings::default();
        assert_eq!(s.session_data_mode, "shared");
        s.onboarding_done = false;
        apply_import_onboarding_done(&mut s);
        assert!(s.onboarding_done);
        assert_eq!(s.session_data_mode, "shared");

        // If user already chose independent, import still leaves it alone.
        s.session_data_mode = "independent".into();
        apply_import_onboarding_done(&mut s);
        assert_eq!(s.session_data_mode, "independent");
    }
}

/// Structured Doctor check row (UI consumes `checks`; `raw` is for copy/export).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorCheck {
    id: String,
    level: String,
    title: String,
    detail: String,
    meta: serde_json::Value,
}

fn doctor_check(
    id: &str,
    level: &str,
    title: &str,
    detail: String,
    meta: serde_json::Value,
) -> DoctorCheck {
    DoctorCheck {
        id: id.into(),
        level: level.into(),
        title: title.into(),
        detail,
        meta,
    }
}

#[tauri::command]
pub async fn doctor_report() -> Result<serde_json::Value, String> {
    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let projects = store::load_projects();
    let sessions = store::load_sessions_index();
    let secrets = store::load_secrets();
    let auth_path_buf = crate::process_util::user_home()
        .join(".grok")
        .join("auth.json");
    let auth_ok = auth_path_buf.is_file();
    let auth_path = auth_path_buf.display().to_string();
    let data_root_path = crate::paths::app_data_root();
    let data_root = data_root_path.display().to_string();
    let log_dir_path = data_root_path.join("logs");
    let log_dir = log_dir_path.display().to_string();
    let log_dir_exists = log_dir_path.is_dir();
    let backend_default = if crate::acp_client::AcpClient::use_mock() {
        "mock_acp"
    } else {
        "grok_agent_stdio"
    };
    let has_official_key = secrets.official_api_key.is_some();
    let has_relay = secrets.relay_base_url.is_some() && secrets.relay_api_key.is_some();
    // Never include secret values — only which backend holds them.
    let secrets_backend = match crate::secrets::active_backend() {
        crate::secrets::SecretsBackendKind::Keychain => "keychain",
        crate::secrets::SecretsBackendKind::File => "file",
    };

    // Flat snapshot for clipboard / legacy consumers (no secret values).
    let raw = serde_json::json!({
        "cli": {
            "found": probe.found,
            "path": probe.path,
            "version": probe.version,
            "source": probe.source,
            "checksumVerified": settings.last_cli_checksum_verified,
            "minVersion": probe.min_version,
            "recommendedVersion": probe.recommended_version,
            "meetsRecommended": probe.meets_recommended,
            "versionSupported": probe.version_supported,
            "agentPath": probe.agent_path,
            "agentVersion": probe.agent_version,
            "agentBinarySkew": probe.agent_binary_skew,
            "acpAgentVersion": probe.acp_agent_version,
            "acpAgentVersionSkew": probe.acp_agent_version_skew,
        },
        "auth": {
            "cliAuthJson": auth_ok,
            "authPath": auth_path,
            "hasOfficialKey": has_official_key,
            "hasRelay": has_relay,
            "secretsBackend": secrets_backend,
        },
        "workspace": {
            "projectCount": projects.len(),
            "sessionCount": sessions.len(),
            "dataRoot": data_root,
            "sessionDataMode": settings.session_data_mode,
        },
        "logs": {
            "dir": log_dir,
            "exists": log_dir_exists,
        },
        "app": {
            "version": env!("CARGO_PKG_VERSION"),
            "backendDefault": backend_default,
            "nonOfficial": true,
            "license": "MIT",
        }
    });

    let mut checks: Vec<DoctorCheck> = Vec::with_capacity(6);

    // 1) CLI
    let checksum_verified = settings.last_cli_checksum_verified;
    if probe.found {
        let ver = probe.version.as_deref().unwrap_or("unknown");
        let path = probe.path.as_deref().unwrap_or("—");
        let checksum_note = match checksum_verified {
            Some(true) => " · last install checksum verified",
            Some(false) => " · last install missing checksum sidecar",
            None => "",
        };
        let rec_note = match probe.meets_recommended {
            Some(true) => format!(" · recommended ≥ {}", probe.recommended_version),
            Some(false) => format!(
                " · below recommended {} (still supported if ≥ {})",
                probe.recommended_version, probe.min_version
            ),
            None => String::new(),
        };
        let level = if probe.version_supported == Some(false) {
            "fail"
        } else if probe.meets_recommended == Some(false) {
            "warn"
        } else {
            "ok"
        };
        checks.push(doctor_check(
            "cli",
            level,
            "Grok Build CLI",
            format!(
                "Found {ver} ({}) at {path}{checksum_note}{rec_note}",
                probe.source
            ),
            serde_json::json!({
                "found": true,
                "path": probe.path,
                "version": probe.version,
                "source": probe.source,
                "checksumVerified": checksum_verified,
                "minVersion": probe.min_version,
                "recommendedVersion": probe.recommended_version,
                "meetsRecommended": probe.meets_recommended,
                "versionSupported": probe.version_supported,
            }),
        ));
    } else {
        checks.push(doctor_check(
            "cli",
            "fail",
            "Grok Build CLI",
            "Grok Build CLI not found. Install from Settings → Runtime or the setup wizard."
                .into(),
            serde_json::json!({
                "found": false,
                "path": probe.path,
                "version": probe.version,
                "source": probe.source,
                "candidatesTried": probe.candidates_tried,
                "checksumVerified": checksum_verified,
            }),
        ));
    }

    // 1a) grok vs agent binary skew (App spawns grok only; TUI/external may use agent).
    if probe.agent_binary_skew {
        checks.push(doctor_check(
            "cli_agent_skew",
            "warn",
            "CLI agent binary skew",
            format!(
                "grok reports {:?} but sibling agent reports {:?}. App ACP uses grok; \
                 external `agent` may be stale. Repair from Settings → Runtime · CLI or reinstall.",
                probe.version, probe.agent_version
            ),
            serde_json::json!({
                "grokPath": probe.path,
                "grokVersion": probe.version,
                "agentPath": probe.agent_path,
                "agentVersion": probe.agent_version,
                "repairable": true,
            }),
        ));
    }

    // 1a2) probe `grok --version` vs last live ACP initialize agentVersion.
    // Soft warn only — never blocks session open. Empty cache → no finding.
    if probe.acp_agent_version_skew {
        checks.push(doctor_check(
            "cli_acp_version_skew",
            "warn",
            "CLI vs ACP agentVersion skew",
            format!(
                "probed grok reports {:?} but last ACP initialize reported {:?}. \
                 Restart sessions after CLI update, reinstall Grok Build CLI, or \
                 (API mode) confirm the remote agent binary matches Settings → Runtime.",
                probe.version, probe.acp_agent_version
            ),
            serde_json::json!({
                "grokPath": probe.path,
                "grokVersion": probe.version,
                "acpAgentVersion": probe.acp_agent_version,
                "softFail": true,
            }),
        ));
    }

    // 1b) CLI install checksum trust (only when App recorded a last install).
    // Never invents verified; mismatch never reaches install ok.
    if let Some(verified) = checksum_verified {
        if verified {
            checks.push(doctor_check(
                "cli_checksum",
                "ok",
                "CLI install checksum",
                "Last App-managed CLI install matched a published SHA-256 sidecar."
                    .into(),
                serde_json::json!({ "checksumVerified": true }),
            ));
        } else {
            checks.push(doctor_check(
                "cli_checksum",
                "warn",
                "CLI install checksum",
                "Last App-managed CLI install had no published SHA-256 sidecar \
                 (HTTPS allowlist + binary probe only; not cryptographically verified)."
                    .into(),
                serde_json::json!({ "checksumVerified": false }),
            ));
        }
    }

    // 1c) Linux: AppArmor unprivileged userns can block bubblewrap sandbox (#541).
    #[cfg(target_os = "linux")]
    {
        let userns_path = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
        let sandbox = settings.sandbox_profile.as_str();
        match std::fs::read_to_string(userns_path) {
            Ok(raw) => {
                let restricted = raw.trim() == "1";
                if restricted && sandbox != "off" {
                    checks.push(doctor_check(
                        "linux_userns",
                        "warn",
                        "Linux user namespaces",
                        format!(
                            "kernel.apparmor_restrict_unprivileged_userns=1 (common on Ubuntu 24.04). \
                             Default sandbox profile `{sandbox}` uses bubblewrap and may fail with \
                             SANDBOX_BLOCKED / \"Agent process ended\". Fix: \
                             `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` \
                             (persist under /etc/sysctl.d/), or Settings → Runtime → Sandbox → off."
                        ),
                        serde_json::json!({
                            "restricted": true,
                            "sandboxProfile": sandbox,
                            "sysctlPath": userns_path,
                        }),
                    ));
                } else if restricted {
                    checks.push(doctor_check(
                        "linux_userns",
                        "ok",
                        "Linux user namespaces",
                        "Unprivileged user namespaces are restricted, but sandbox is off \
                         (bubblewrap skipped)."
                            .into(),
                        serde_json::json!({
                            "restricted": true,
                            "sandboxProfile": sandbox,
                        }),
                    ));
                } else {
                    checks.push(doctor_check(
                        "linux_userns",
                        "ok",
                        "Linux user namespaces",
                        "Unprivileged user namespaces allowed (sandbox bubblewrap should work)."
                            .into(),
                        serde_json::json!({
                            "restricted": false,
                            "sandboxProfile": sandbox,
                        }),
                    ));
                }
            }
            Err(_) => {
                // Kernel without this sysctl (or non-AppArmor) — skip noise.
            }
        }
    }

    // 2) Auth — warn if no CLI auth, official key, or relay
    let auth_sources: Vec<&str> = [
        auth_ok.then_some("cliAuthJson"),
        has_official_key.then_some("officialKey"),
        has_relay.then_some("relay"),
    ]
    .into_iter()
    .flatten()
    .collect();
    if auth_sources.is_empty() {
        checks.push(doctor_check(
            "auth",
            "warn",
            "Authentication",
            format!(
                "No CLI auth (~/.grok/auth.json), official API key, or relay configured. Path: {auth_path}"
            ),
            serde_json::json!({
                "cliAuthJson": auth_ok,
                "authPath": auth_path,
                "hasOfficialKey": has_official_key,
                "hasRelay": has_relay,
            }),
        ));
    } else {
        checks.push(doctor_check(
            "auth",
            "ok",
            "Authentication",
            format!("Auth available via: {}", auth_sources.join(", ")),
            serde_json::json!({
                "cliAuthJson": auth_ok,
                "authPath": auth_path,
                "hasOfficialKey": has_official_key,
                "hasRelay": has_relay,
            }),
        ));
    }

    // 3) Workspace
    let data_root_ok = data_root_path.is_dir() || data_root_path.parent().is_some();
    let workspace_level = if data_root_path.exists() || data_root_ok {
        "ok"
    } else {
        "warn"
    };
    checks.push(doctor_check(
        "workspace",
        workspace_level,
        "Workspace",
        format!(
            "{} projects · {} sessions · dataRoot {data_root} · mode {}",
            projects.len(),
            sessions.len(),
            settings.session_data_mode
        ),
        serde_json::json!({
            "projectCount": projects.len(),
            "sessionCount": sessions.len(),
            "dataRoot": data_root,
            "sessionDataMode": settings.session_data_mode,
        }),
    ));

    // 4) Backend
    let (backend_level, backend_detail) = if backend_default == "mock_acp" {
        (
            "warn",
            "Using mock ACP backend (dev). Production uses grok_agent_stdio.".to_string(),
        )
    } else {
        (
            "ok",
            format!("Agent backend: {backend_default}"),
        )
    };
    checks.push(doctor_check(
        "backend",
        backend_level,
        "Backend",
        backend_detail,
        serde_json::json!({
            "backendDefault": backend_default,
            "version": env!("CARGO_PKG_VERSION"),
        }),
    ));

    // 5) Logs dir
    let (logs_level, logs_detail) = if log_dir_exists {
        ("ok", format!("Logs directory: {log_dir}"))
    } else {
        (
            "warn",
            format!("Logs directory not created yet: {log_dir}"),
        )
    };
    checks.push(doctor_check(
        "logs",
        logs_level,
        "Logs",
        logs_detail,
        serde_json::json!({
            "dir": log_dir,
            "exists": log_dir_exists,
        }),
    ));

    // Grok Build CLI `doctor --json` (terminal/clipboard/color findings).
    // Runs on a blocking pool so slow/hung CLI cannot stall the async runtime.
    let cli_doctor = tauri::async_runtime::spawn_blocking(run_cli_doctor_json)
        .await
        .unwrap_or_else(|e| {
            serde_json::json!({
                "available": false,
                "error": format!("cli doctor worker panicked: {e}"),
                "report": serde_json::Value::Null,
            })
        });

    let mut ok = 0u32;
    let mut warn = 0u32;
    let mut fail = 0u32;
    for c in &checks {
        match c.level.as_str() {
            "ok" => ok += 1,
            "warn" => warn += 1,
            "fail" => fail += 1,
            _ => {}
        }
    }

    // Flat snapshot also carries CLI doctor for support zip (no secret values).
    let mut raw = raw;
    if let Some(obj) = raw.as_object_mut() {
        obj.insert("cliDoctor".into(), cli_doctor.clone());
    }

    Ok(serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "summary": { "ok": ok, "warn": warn, "fail": fail },
        "checks": checks,
        "cliDoctor": cli_doctor,
        "raw": raw,
    }))
}

/// Timeout for `grok doctor --json` (host env probes; keep short).
const CLI_DOCTOR_TIMEOUT_SECS: u64 = 15;

/// Run probed CLI `doctor --json`. Returns a stable envelope for the UI parser.
/// Never includes secret values — only CLI doctor facts/findings/probeNotes.
fn run_cli_doctor_json() -> serde_json::Value {
    match run_grok_cli_args(&["doctor", "--json"], CLI_DOCTOR_TIMEOUT_SECS) {
        Ok((stdout, stderr, status_ok)) => {
            let trimmed = stdout.trim();
            if trimmed.is_empty() {
                // An old CLI rejects `--json` with a raw clap error like
                // `error: unexpected argument '--'`. Surfacing that verbatim tells
                // the user nothing actionable, so map it to the real cause (NEW-03).
                if looks_like_unsupported_flag(&stderr) {
                    return serde_json::json!({
                        "available": false,
                        "error": format!(
                            "grok CLI does not support `doctor --json`; version {} or newer is required",
                            crate::cli_probe::min_cli_version_str()
                        ),
                        "reason": "cli_too_old",
                        "minVersion": crate::cli_probe::min_cli_version_str(),
                        "report": serde_json::Value::Null,
                        "exitOk": status_ok,
                    });
                }
                let detail = if stderr.trim().is_empty() {
                    "grok doctor returned no output".to_string()
                } else {
                    format!("grok doctor returned no JSON: {}", truncate_cli_err(&stderr, 240))
                };
                return serde_json::json!({
                    "available": false,
                    "error": detail,
                    "report": serde_json::Value::Null,
                    "exitOk": status_ok,
                });
            }
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(report) => serde_json::json!({
                    "available": true,
                    "error": serde_json::Value::Null,
                    "report": report,
                    "exitOk": status_ok,
                }),
                Err(e) => serde_json::json!({
                    "available": false,
                    "error": format!("Failed to parse grok doctor JSON: {e}"),
                    "report": serde_json::Value::Null,
                    "exitOk": status_ok,
                    "stdoutPreview": truncate_cli_err(trimmed, 200),
                }),
            }
        }
        Err(e) => serde_json::json!({
            "available": false,
            "error": e,
            "report": serde_json::Value::Null,
        }),
    }
}

/// Grok endpoints probed by the network self-check (NEW-02 / NEW-07).
const NET_PROBE_TARGETS: &[(&str, &str)] = &[
    ("auth", "https://auth.x.ai/.well-known/openid-configuration"),
    ("chat", "https://cli-chat-proxy.grok.com/"),
    ("api", "https://api.x.ai/"),
];

/// Per-endpoint reachability probe through the effective proxy. Any HTTP
/// response (including 401/404) counts as reachable — we test the network
/// path, not authentication. Short curl-style probes can pass while streaming
/// fails, so this is a hint, not a guarantee.
#[tauri::command]
pub async fn network_probe() -> Result<serde_json::Value, String> {
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("grok-app-net-probe")
        .build()
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for (key, url) in NET_PROBE_TARGETS {
        let started = std::time::Instant::now();
        let out = client.get(*url).send().await;
        let ms = started.elapsed().as_millis() as u64;
        match out {
            Ok(resp) => results.push(serde_json::json!({
                "key": key,
                "url": url,
                "ok": true,
                "status": resp.status().as_u16(),
                "millis": ms,
            })),
            Err(e) => results.push(serde_json::json!({
                "key": key,
                "url": url,
                "ok": false,
                // reqwest errors don't leak proxy credentials in Display.
                "error": e.to_string(),
                "millis": ms,
            })),
        }
    }
    let all_ok = results
        .iter()
        .all(|r| r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false));
    // Include redacted effective proxy so Settings can show system/PAC/manual
    // honesty (avoids "probe ok but only TUN works" confusion).
    Ok(serde_json::json!({
        "allOk": all_ok,
        "targets": results,
        "effective": crate::proxy::effective_snapshot(),
    }))
}

/// Headless probe: `grok -p … --output-format streaming-json` (CLI ≥ 0.2.117).
/// Soft-gated — older CLIs get a structured "too old" result, not a hard crash.
/// Returns redacted stdout NDJSON for the Diagnostics ACP-NDJSON panel.
#[tauri::command]
pub async fn probe_streaming_acp_ndjson(
    prompt: Option<String>,
    manual_path: Option<String>,
    cwd: Option<String>,
) -> Result<crate::streaming_acp_ndjson::StreamingAcpNdjsonProbeResult, String> {
    // Blocking child wait — offload from the async runtime.
    tokio::task::spawn_blocking(move || {
        crate::streaming_acp_ndjson::run_streaming_acp_ndjson_probe(
            prompt.as_deref(),
            manual_path.as_deref(),
            cwd.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("probe task failed: {e}"))
}

/// Heuristic: stderr shapes an old CLI emits when it rejects a flag the app
/// depends on (clap's `unexpected argument` / `unrecognized option` family).
/// Used to translate raw CLI noise into a "CLI too old" diagnosis (NEW-03).
fn looks_like_unsupported_flag(stderr: &str) -> bool {
    let s = stderr.to_ascii_lowercase();
    s.contains("unexpected argument")
        || s.contains("unrecognized option")
        || s.contains("unknown flag")
        || s.contains("unknown option")
        || s.contains("invalid option")
}

fn truncate_cli_err(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let head: String = t.chars().take(max).collect();
    format!("{head}…")
}

/// Write a redacted support zip (Doctor JSON + logs + optional stall timeline) and return its path.
/// Optionally opens a save dialog so the user can pick the destination.
///
/// `stall_timeline_json` is optional Reliability-center snapshot JSON (structured only).
#[tauri::command]
pub async fn export_support_bundle(
    doctor_json: Option<String>,
    stall_timeline_json: Option<String>,
) -> Result<serde_json::Value, String> {
    let doctor = if let Some(j) = doctor_json.filter(|s| !s.trim().is_empty()) {
        j
    } else {
        // Build a fresh report when the UI did not pass one.
        let report = doctor_report().await?;
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    };

    let stall = stall_timeline_json
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());

    // Zip + native save dialog must not block the async runtime (macOS rfd hangs).
    let tmp = tauri::async_runtime::spawn_blocking(move || {
        crate::support_bundle::write_support_bundle(&doctor, stall.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    save_and_reveal_file(
        tmp,
        "Save support bundle",
        "grok-app-support.zip",
        "Zip",
        &["zip"],
    )
    .await
}

/// Full session diagnostic zip: messages, meta, settings, CLI probe, agent trail, logs.
/// Redacts secrets. Opens a save dialog and reveals the file.
///
/// Never blocks the app indefinitely: zip build and save dialog each run on
/// blocking threads; reveal is fire-and-forget; zip has a wall-clock budget.
#[tauri::command]
pub async fn export_session_bundle(
    session_id: String,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("session id is empty".into());
    }
    // Snapshot runtime under the session lock *before* long zip work so we do
    // not hold SessionManager while packing files / opening dialogs.
    let runtime = mgr.diagnostic_runtime_for(&sid);
    let sid_for_zip = sid.clone();
    let zip_fut = tauri::async_runtime::spawn_blocking(move || {
        crate::support_bundle::write_session_bundle(&sid_for_zip, runtime)
    });
    // Generous but finite — huge agent trails / slow disks must not hang forever.
    let tmp = match tokio::time::timeout(std::time::Duration::from_secs(90), zip_fut).await {
        Ok(join) => join.map_err(|e| e.to_string())??,
        Err(_) => {
            return Err(
                "diagnostic export timed out while packing files (90s). Try again or free disk."
                    .into(),
            )
        }
    };
    let short: String = sid.chars().take(8).collect();
    let suggested = format!("grok-app-session-{short}.zip");
    // Save dialog can wait on the user, but runs on a blocking pool thread so
    // other Tauri commands (including force-quit) keep working.
    save_and_reveal_file(
        tmp,
        "Save session diagnostic bundle",
        &suggested,
        "Zip",
        &["zip"],
    )
    .await
}

/// Export the Grok Build CLI session trace (`grok trace <agent_id>`).
///
/// - `local_only` (default **true** for safety): when true, pass `--local` so the
///   CLI only writes a local archive. When false, omit `--local` so the CLI may
///   also upload (network).
/// - Resolves `agent_session_id` from live/parked runtime or session meta.
/// - Opens a save dialog for the `.tar.gz` and reveals the file.
/// - Returns `{ ok, path, sizeBytes?, uploaded?, localOnly }` — never secrets/URLs.
/// Export a CLI-linked session transcript via `grok export <agentSessionId> [OUTPUT]`.
///
/// Resolves `agent_session_id` from live/parked runtime or session meta.
/// Returns markdown text for the frontend to download (blob). Callers should
/// soft-fail to the local App journal when this errors (no agent, CLI missing,
/// timeout, etc.).
#[tauri::command]
pub async fn session_cli_export(
    session_id: String,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("session id is empty".into());
    }

    let live_agent = mgr.diagnostic_runtime_for(&sid).and_then(|rt| {
        rt.get("agentSessionId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    });

    tauri::async_runtime::spawn_blocking(move || {
        session_cli_export_blocking(&sid, live_agent.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

const CLI_EXPORT_TIMEOUT_SECS: u64 = 60;

fn session_cli_export_blocking(
    session_id: &str,
    live_agent_session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    let agent_sid = live_agent_session_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            meta.agent_session_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .ok_or_else(|| {
            "No agent session linked. Start a conversation first so the App has an agent session id."
                .to_string()
        })?;

    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };
    let grok_home = crate::paths::resolve_agent_grok_home(&settings.session_data_mode);

    let short: String = agent_sid.chars().take(8).collect();
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let tmp = std::env::temp_dir().join(format!("grok-export-{short}-{stamp}.md"));
    let tmp_s = tmp.to_string_lossy().to_string();

    // `grok export <SESSION_ID> [OUTPUT]` — positional output path (not -o).
    let args = vec![
        "export".to_string(),
        agent_sid.clone(),
        tmp_s.clone(),
    ];

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args);
        cmd.env("GROK_HOME", &grok_home);
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });

    let output = match rx.recv_timeout(std::time::Duration::from_secs(CLI_EXPORT_TIMEOUT_SECS)) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return Err(store::redact_text(&format!("Failed to run grok export: {e}")));
        }
        Err(_) => {
            return Err(format!(
                "grok export timed out after {CLI_EXPORT_TIMEOUT_SECS}s"
            ));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "grok export failed".into()
        };
        return Err(store::redact_text(&msg)
            .trim()
            .chars()
            .take(1200)
            .collect());
    }

    // Prefer the file we asked for; fall back to stdout (CLI may print MD when path fails).
    let markdown = if tmp.is_file() {
        let body = std::fs::read_to_string(&tmp).map_err(|e| {
            store::redact_text(&format!("Failed to read grok export output: {e}"))
        })?;
        let _ = std::fs::remove_file(&tmp);
        body
    } else if !stdout.is_empty() {
        stdout
    } else {
        return Err("grok export succeeded but produced no markdown".into());
    };

    if markdown.trim().is_empty() {
        return Err("grok export produced empty markdown".into());
    }

    Ok(serde_json::json!({
        "ok": true,
        "markdown": markdown,
        "agentSessionId": agent_sid,
        "source": "cli",
    }))
}

/// Export the Grok Build CLI session trace (`grok trace <agent_id> --local`).
/// Resolves `agent_session_id` from live/parked runtime or session meta.
/// Opens a save dialog for the `.tar.gz` and reveals the file.
#[tauri::command]
pub async fn session_trace_export(
    session_id: String,
    local_only: Option<bool>,
    mgr: State<'_, Arc<SessionManager>>,
) -> Result<serde_json::Value, String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("session id is empty".into());
    }
    // Default true: local-only is the safe path; upload requires explicit false.
    let local_only = local_only.unwrap_or(true);

    // Prefer live/parked agent id (may be newer than the index), then meta.
    let live_agent = mgr.diagnostic_runtime_for(&sid).and_then(|rt| {
        rt.get("agentSessionId")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    });

    tauri::async_runtime::spawn_blocking(move || {
        session_trace_export_blocking(&sid, live_agent.as_deref(), local_only)
    })
    .await
    .map_err(|e| e.to_string())?
}

const TRACE_EXPORT_TIMEOUT_SECS: u64 = 90;
/// Upload may need extra time for network transfer of large archives.
const TRACE_EXPORT_UPLOAD_TIMEOUT_SECS: u64 = 180;

/// Detect whether CLI JSON indicates a remote upload completed.
/// Presence-only: never returns or stores remote URLs / tokens.
fn trace_cli_reports_uploaded(cli_json: Option<&serde_json::Value>) -> bool {
    let Some(v) = cli_json else {
        return false;
    };
    if v.get("uploaded").and_then(|x| x.as_bool()) == Some(true) {
        return true;
    }
    let status = v
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if matches!(
        status.as_str(),
        "uploaded" | "upload_complete" | "upload-complete" | "ok_uploaded"
    ) {
        return true;
    }
    // Remote info keys — truthy non-empty string means upload path ran.
    // Do not persist these values (may contain URLs).
    for key in ["remote_url", "upload_url", "share_url", "object_path"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            if !s.trim().is_empty() {
                return true;
            }
        }
    }
    false
}

fn session_trace_export_blocking(
    session_id: &str,
    live_agent_session_id: Option<&str>,
    local_only: bool,
) -> Result<serde_json::Value, String> {
    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    let agent_sid = live_agent_session_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            meta.agent_session_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .ok_or_else(|| {
            "No agent session linked. Start a conversation first so the App has an agent session id."
                .to_string()
        })?;

    let settings = store::load_settings();
    let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    let Some(cli_path) = probe.path.filter(|_| probe.found) else {
        return Err("Grok Build CLI not found".into());
    };
    let grok_home = crate::paths::resolve_agent_grok_home(&settings.session_data_mode);

    let short: String = agent_sid.chars().take(8).collect();
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let tmp = std::env::temp_dir().join(format!("grok-trace-{short}-{stamp}.tar.gz"));
    let tmp_s = tmp.to_string_lossy().to_string();

    // `grok trace <id>` uploads unless `--local`. Default App path keeps `--local`.
    let mut args = vec!["trace".to_string(), agent_sid.clone()];
    if local_only {
        args.push("--local".to_string());
    }
    args.push("-o".to_string());
    args.push(tmp_s.clone());
    args.push("--json".to_string());

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&cli_path);
        cmd.args(&args);
        cmd.env("GROK_HOME", &grok_home);
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let _ = tx.send(cmd.output());
    });

    let timeout_secs = if local_only {
        TRACE_EXPORT_TIMEOUT_SECS
    } else {
        TRACE_EXPORT_UPLOAD_TIMEOUT_SECS
    };
    let output = match rx.recv_timeout(std::time::Duration::from_secs(timeout_secs)) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return Err(store::redact_text(&format!("Failed to run grok trace: {e}")));
        }
        Err(_) => {
            return Err(format!("grok trace timed out after {timeout_secs}s"));
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "grok trace failed".into()
        };
        return Err(store::redact_text(&msg)
            .trim()
            .chars()
            .take(1200)
            .collect());
    }

    let cli_json = serde_json::from_str::<serde_json::Value>(&stdout).ok();
    // Only claim uploaded when we intentionally allowed network upload.
    let uploaded = !local_only && trace_cli_reports_uploaded(cli_json.as_ref());

    // Prefer the archive we asked for; fall back to JSON local_path from CLI.
    let archive = if tmp.is_file() {
        tmp
    } else {
        let from_json = cli_json.as_ref().and_then(|v| {
            v.get("local_path")
                .and_then(|p| p.as_str())
                .map(std::path::PathBuf::from)
        });
        match from_json {
            Some(p) if p.is_file() => p,
            _ => {
                let detail = if !stdout.is_empty() {
                    store::redact_text(&stdout)
                } else {
                    "archive file not created".into()
                };
                return Err(format!(
                    "grok trace succeeded but archive missing: {}",
                    detail.trim().chars().take(400).collect::<String>()
                ));
            }
        }
    };

    let suggested = format!("grok-trace-{short}.tar.gz");
    // Already on a blocking thread (session_trace_export spawns us).
    let mut result = save_and_reveal_file_blocking(
        archive,
        "Save session trace",
        &suggested,
        "Trace archive",
        &["tar.gz".into(), "gz".into(), "tgz".into()],
    )?;
    if let Some(obj) = result.as_object_mut() {
        obj.insert("localOnly".into(), serde_json::json!(local_only));
        // Paths-only history may note uploaded=true; never attach remote URLs.
        if uploaded {
            obj.insert("uploaded".into(), serde_json::json!(true));
        }
    }
    Ok(result)
}

