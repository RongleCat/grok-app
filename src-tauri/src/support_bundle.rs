//! Support zip: Doctor snapshot + redacted logs for bug reports.
//! Never includes secrets.json, OS keychain material, auth tokens, or raw API keys.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::paths;
use crate::store;

/// Wall-clock budget for CLI probe during diagnostic export (must not block).
const EXPORT_CLI_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Best-effort CLI probe with a hard wall-clock timeout so export never stalls
/// when `grok --version` hangs on a bad path.
fn soft_cli_probe_for_export(manual_path: Option<&str>) -> serde_json::Value {
    let manual = manual_path.map(|s| s.to_string());
    let (tx, rx) = mpsc::channel();
    let _ = std::thread::Builder::new()
        .name("export-cli-probe".into())
        .spawn(move || {
            let probe = crate::cli_probe::probe_cli(manual.as_deref());
            let _ = tx.send(serde_json::json!({
                "found": probe.found,
                "path": probe.path,
                "version": probe.version,
                "source": probe.source,
            }));
        });
    match rx.recv_timeout(EXPORT_CLI_PROBE_TIMEOUT) {
        Ok(v) => v,
        Err(_) => serde_json::json!({
            "found": null,
            "skipped": true,
            "reason": "cli_probe_timeout",
            "timeoutSecs": EXPORT_CLI_PROBE_TIMEOUT.as_secs(),
        }),
    }
}

const MAX_LOG_FILES: usize = 12;
const MAX_LOG_BYTES_EACH: u64 = 512 * 1024;

/// Max bytes accepted for an optional stall-timeline snapshot from the UI.
const MAX_STALL_TIMELINE_BYTES: usize = 256 * 1024;

/// Build a support zip under the system temp dir (caller may move/reveal it).
///
/// `stall_timeline_json` is an optional Reliability-center stall timeline snapshot
/// (structured signals only). Always redacted; never required.
pub fn write_support_bundle(
    doctor_json: &str,
    stall_timeline_json: Option<&str>,
) -> Result<PathBuf, String> {
    let root = paths::app_data_root();
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let out = std::env::temp_dir().join(format!("grok-app-support-{stamp}.zip"));

    let file = fs::File::create(&out).map_err(|e| format!("create zip: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // 1) Doctor report (already structured; scrub any leaked secrets)
    let doctor_safe = store::redact_text(doctor_json);
    zip.start_file("doctor.json", opts)
        .map_err(|e| format!("zip doctor: {e}"))?;
    zip.write_all(doctor_safe.as_bytes())
        .map_err(|e| format!("write doctor: {e}"))?;

    // 2) Safe settings snapshot (no secrets)
    if let Ok(settings_raw) = fs::read_to_string(paths::settings_file()) {
        let scrubbed = store::redact_text(&settings_raw);
        zip.start_file("settings.json", opts)
            .map_err(|e| format!("zip settings: {e}"))?;
        zip.write_all(scrubbed.as_bytes())
            .map_err(|e| format!("write settings: {e}"))?;
    }

    // 3) Environment / versions (no home path expansion of secrets)
    // Soft CLI probe: app + CLI version for community bug reports; never blocks.
    let settings = store::load_settings();
    let cli = soft_cli_probe_for_export(settings.manual_cli_path.as_deref());
    let meta = serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "generatedAt": Utc::now().to_rfc3339(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "dataRootExists": root.is_dir(),
        "sessionCount": store::load_sessions_index().len(),
        "projectCount": store::load_projects().len(),
        "hasStallTimeline": stall_timeline_json
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
        "cli": cli,
    });
    let meta_s = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    zip.start_file("meta.json", opts)
        .map_err(|e| format!("zip meta: {e}"))?;
    zip.write_all(meta_s.as_bytes())
        .map_err(|e| format!("write meta: {e}"))?;

    // 3b) Optional Reliability-center stall timeline (redacted structured snapshot)
    if let Some(raw) = stall_timeline_json.map(str::trim).filter(|s| !s.is_empty()) {
        let capped = if raw.len() > MAX_STALL_TIMELINE_BYTES {
            // Prefer keeping a truncated valid-ish prefix over dropping entirely.
            &raw[..MAX_STALL_TIMELINE_BYTES]
        } else {
            raw
        };
        let scrubbed = store::redact_text(capped);
        zip.start_file("stall-timeline.json", opts)
            .map_err(|e| format!("zip stall-timeline: {e}"))?;
        zip.write_all(scrubbed.as_bytes())
            .map_err(|e| format!("write stall-timeline: {e}"))?;
    }

    // 4) Recent log files (capped + redacted)
    let log_dir = root.join("logs");
    if log_dir.is_dir() {
        let mut entries: Vec<(SystemTime, PathBuf)> = fs::read_dir(&log_dir)
            .map_err(|e| format!("read logs: {e}"))?
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if !p.is_file() {
                    return None;
                }
                let modified = e.metadata().ok()?.modified().ok()?;
                Some((modified, p))
            })
            .collect();
        entries.sort_by_key(|b| std::cmp::Reverse(b.0));
        for (i, (_mtime, path)) in entries.into_iter().take(MAX_LOG_FILES).enumerate() {
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("log-{i}.txt"));
            // Skip anything that looks like secrets dump
            let lower = name.to_ascii_lowercase();
            if lower.contains("secret") || lower.contains("auth") || lower.contains("token") {
                continue;
            }
            let text = read_capped_text(&path, MAX_LOG_BYTES_EACH)?;
            let scrubbed = store::redact_text(&text);
            zip.start_file(format!("logs/{name}"), opts)
                .map_err(|e| format!("zip log {name}: {e}"))?;
            zip.write_all(scrubbed.as_bytes())
                .map_err(|e| format!("write log {name}: {e}"))?;
        }
    }

    // README for the recipient
    let readme = "Grok App support bundle\n\
\n\
Contents:\n\
- doctor.json — health checks (paths only, no keys)\n\
- settings.json — app settings with secrets redacted\n\
- meta.json — app/OS/CLI versions and counts (CLI probe may be skipped on timeout)\n\
- stall-timeline.json — optional Reliability-center stall snapshot (redacted)\n\
- logs/ — recent log files (redacted, size-capped)\n\
\n\
This archive never includes secrets.json or account auth snapshots.\n\
Full chat journals use session → Export diagnostic package (separate zip).\n\
";
    zip.start_file("README.txt", opts)
        .map_err(|e| format!("zip readme: {e}"))?;
    zip.write_all(readme.as_bytes())
        .map_err(|e| format!("write readme: {e}"))?;

    zip.finish().map_err(|e| format!("finish zip: {e}"))?;
    Ok(out)
}

fn read_capped_text(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    let len = meta.len();
    if len > max_bytes {
        // Tail the file so recent errors are kept
        use std::io::Seek;
        use std::io::SeekFrom;
        let skip = len - max_bytes;
        file.seek(SeekFrom::Start(skip))
            .map_err(|e| format!("seek {}: {e}", path.display()))?;
        let mut buf = String::new();
        buf.push_str(&format!(
            "[…truncated {} bytes from start of {}…]\n",
            skip,
            path.file_name().and_then(|s| s.to_str()).unwrap_or("log")
        ));
        file.read_to_string(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        Ok(buf)
    } else {
        let mut buf = String::new();
        file.read_to_string(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        Ok(buf)
    }
}

const MAX_AGENT_FILES: usize = 24;
const MAX_AGENT_FILE_BYTES: u64 = 768 * 1024;
const MAX_AGENT_TOTAL_BYTES: u64 = 6 * 1024 * 1024;

/// Full session diagnostic zip for bug reports (messages, meta, logs, agent trail).
/// Never includes secrets.json, auth tokens, or raw API keys.
///
/// `runtime_json` is optional live/parked process snapshot from SessionManager.
pub fn write_session_bundle(
    session_id: &str,
    runtime_json: Option<serde_json::Value>,
) -> Result<PathBuf, String> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err("session id is empty".into());
    }

    let meta = store::load_sessions_index()
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or_else(|| format!("session not found: {session_id}"))?;

    let messages = store::load_messages(session_id);
    let settings = store::load_settings();
    let projects = store::load_projects();
    let project = meta
        .project_id
        .as_ref()
        .and_then(|pid| projects.iter().find(|p| &p.id == pid).cloned());
    let project_path = project.as_ref().map(|p| p.path.clone());

    let agent_dir = meta.agent_session_id.as_ref().and_then(|aid| {
        paths::find_agent_session_dir(aid, project_path.as_deref(), &settings.session_data_mode)
    });

    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let short_id: String = session_id.chars().take(8).collect();
    let out = std::env::temp_dir().join(format!("grok-app-session-{short_id}-{stamp}.zip"));

    let file = fs::File::create(&out).map_err(|e| format!("create zip: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // ── meta.json ──────────────────────────────────────────────────────────
    let export_meta = serde_json::json!({
        "kind": "session_diagnostic_bundle",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "generatedAt": Utc::now().to_rfc3339(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "sessionId": session_id,
        "sessionTitle": meta.title,
        "agentSessionId": meta.agent_session_id,
        "projectId": meta.project_id,
        "projectName": project.as_ref().map(|p| p.name.clone()),
        "projectPath": project_path,
        "sessionDataMode": settings.session_data_mode,
        "agentDirFound": agent_dir.is_some(),
        "messageCount": messages.len(),
        "hasRuntimeSnapshot": runtime_json.is_some(),
    });
    write_zip_str(&mut zip, opts, "meta.json", &pretty_json(&export_meta)?)?;

    // ── host/session_meta.json ─────────────────────────────────────────────
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    write_zip_str(
        &mut zip,
        opts,
        "host/session_meta.json",
        &store::redact_text(&meta_json),
    )?;

    // ── host/messages.json ─────────────────────────────────────────────────
    let msgs_json = serde_json::to_string_pretty(&messages).map_err(|e| e.to_string())?;
    write_zip_str(
        &mut zip,
        opts,
        "host/messages.json",
        &store::redact_text(&msgs_json),
    )?;

    // ── host/transcript.md ─────────────────────────────────────────────────
    let md = messages_to_markdown(
        &meta.title,
        project.as_ref().map(|p| p.name.as_str()),
        project_path.as_deref(),
        session_id,
        &messages,
    );
    write_zip_str(
        &mut zip,
        opts,
        "host/transcript.md",
        &store::redact_text(&md),
    )?;

    // ── host/settings.json (redacted) ──────────────────────────────────────
    if let Ok(settings_raw) = fs::read_to_string(paths::settings_file()) {
        write_zip_str(
            &mut zip,
            opts,
            "host/settings.json",
            &store::redact_text(&settings_raw),
        )?;
    }

    // ── host/runtime.json (optional live process) ──────────────────────────
    if let Some(rt) = runtime_json {
        write_zip_str(&mut zip, opts, "host/runtime.json", &pretty_json(&rt)?)?;
    }

    // ── host/project.json ──────────────────────────────────────────────────
    if let Some(p) = project.as_ref() {
        let safe = serde_json::json!({
            "id": p.id,
            "name": p.name,
            "path": p.path,
            "trusted": p.trusted,
            "permissionPolicy": p.permission_policy,
        });
        write_zip_str(&mut zip, opts, "host/project.json", &pretty_json(&safe)?)?;
    }

    // ── host/cli_probe.json ────────────────────────────────────────────────
    // Soft budget: probe can walk multiple candidates with --version timeouts.
    // Export must never wait unbounded — drop probe after a short wall clock.
    let probe_json = soft_cli_probe_for_export(settings.manual_cli_path.as_deref());
    write_zip_str(
        &mut zip,
        opts,
        "host/cli_probe.json",
        &pretty_json(&probe_json)?,
    )?;

    // ── logs/ — app log dir (if any) ───────────────────────────────────────
    append_app_logs(&mut zip, opts)?;

    // ── agent/ — Grok Build session trail ──────────────────────────────────
    if let Some(dir) = agent_dir.as_ref() {
        append_agent_session_files(&mut zip, opts, dir)?;
        let note = serde_json::json!({
            "pathExists": true,
            // Path is useful for maintainers; home prefix is fine, no secrets.
            "resolvedPath": dir.display().to_string(),
        });
        write_zip_str(&mut zip, opts, "agent/resolved.json", &pretty_json(&note)?)?;
    } else {
        write_zip_str(
            &mut zip,
            opts,
            "agent/resolved.json",
            &pretty_json(&serde_json::json!({
                "pathExists": false,
                "reason": "agent session directory not found (orphan, recycled, or never connected)",
            }))?,
        )?;
    }

    let readme = format!(
        "Grok App session diagnostic bundle\n\
\n\
Session: {session_id}\n\
Title: {}\n\
Generated: {}\n\
\n\
Contents:\n\
- meta.json — export metadata (app/OS versions)\n\
- host/session_meta.json — App session index row\n\
- host/messages.json — full chat journal (redacted)\n\
- host/transcript.md — human-readable transcript\n\
- host/settings.json — app settings (secrets redacted)\n\
- host/runtime.json — live/parked process snapshot (if attached)\n\
- host/project.json — bound project (if any)\n\
- host/cli_probe.json — Grok Build CLI discovery\n\
- logs/ — recent App log files (if present)\n\
- agent/ — Grok Build session trail (events, history, terminal logs)\n\
\n\
Never includes secrets.json, OS keychain material, or raw API keys.\n\
Attach this zip when reporting bugs such as early end_turn / mid-task stop.\n\
",
        meta.title,
        Utc::now().to_rfc3339()
    );
    write_zip_str(&mut zip, opts, "README.txt", &readme)?;

    zip.finish().map_err(|e| format!("finish zip: {e}"))?;
    Ok(out)
}

fn pretty_json(v: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string_pretty(v).map_err(|e| e.to_string())
}

fn write_zip_str(
    zip: &mut ZipWriter<fs::File>,
    opts: SimpleFileOptions,
    name: &str,
    body: &str,
) -> Result<(), String> {
    zip.start_file(name, opts)
        .map_err(|e| format!("zip start {name}: {e}"))?;
    zip.write_all(body.as_bytes())
        .map_err(|e| format!("zip write {name}: {e}"))?;
    Ok(())
}

fn messages_to_markdown(
    title: &str,
    project_name: Option<&str>,
    project_path: Option<&str>,
    session_id: &str,
    messages: &[store::ChatMessageStored],
) -> String {
    let mut lines: Vec<String> = Vec::new();
    let t = title.trim();
    lines.push(format!("# {}", if t.is_empty() { "Untitled" } else { t }));
    lines.push(String::new());
    let mut meta_lines = Vec::new();
    if let Some(n) = project_name.filter(|s| !s.is_empty()) {
        meta_lines.push(format!("- Project: {n}"));
    }
    if let Some(p) = project_path.filter(|s| !s.is_empty()) {
        meta_lines.push(format!("- Path: {p}"));
    }
    meta_lines.push(format!("- Session: {session_id}"));
    meta_lines.push(format!("- Exported: {}", Utc::now().to_rfc3339()));
    lines.extend(meta_lines);
    lines.push(String::new());
    lines.push("---".into());
    lines.push(String::new());

    for m in messages {
        let body = m.content.trim();
        let thought = m.thought.as_deref().unwrap_or("").trim();
        if body.is_empty() && thought.is_empty() {
            continue;
        }
        if m.role == "tool" && body.is_empty() {
            continue;
        }
        let heading = match m.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            "tool" => "Tool",
            other => other,
        };
        lines.push(format!("## {heading}"));
        lines.push(format!("*{}*", m.created_at.to_rfc3339()));
        lines.push(String::new());
        if !thought.is_empty() {
            lines.push("<details>".into());
            lines.push("<summary>Thinking</summary>".into());
            lines.push(String::new());
            lines.push(thought.into());
            lines.push(String::new());
            lines.push("</details>".into());
            lines.push(String::new());
        }
        if !body.is_empty() {
            lines.push(body.into());
            lines.push(String::new());
        }
        if m.is_error {
            lines.push("_error marker_".into());
            lines.push(String::new());
        }
        if let Some(marker) = m.marker.as_ref() {
            lines.push(format!("_marker: {marker}_"));
            lines.push(String::new());
        }
    }
    let joined = lines.join("\n");
    let mut out = String::new();
    let mut nl = 0;
    for ch in joined.chars() {
        if ch == '\n' {
            nl += 1;
            if nl <= 2 {
                out.push(ch);
            }
        } else {
            nl = 0;
            out.push(ch);
        }
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn append_app_logs(zip: &mut ZipWriter<fs::File>, opts: SimpleFileOptions) -> Result<(), String> {
    let log_dir = paths::app_data_root().join("logs");
    if !log_dir.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<(SystemTime, PathBuf)> = fs::read_dir(&log_dir)
        .map_err(|e| format!("read logs: {e}"))?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_file() {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((modified, p))
        })
        .collect();
    entries.sort_by_key(|b| std::cmp::Reverse(b.0));
    for (i, (_mtime, path)) in entries.into_iter().take(MAX_LOG_FILES).enumerate() {
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("log-{i}.txt"));
        let lower = name.to_ascii_lowercase();
        if lower.contains("secret") || lower.contains("auth") || lower.contains("token") {
            continue;
        }
        let text = read_capped_text(&path, MAX_LOG_BYTES_EACH)?;
        let scrubbed = store::redact_text(&text);
        write_zip_str(zip, opts, &format!("logs/{name}"), &scrubbed)?;
    }
    Ok(())
}

fn append_agent_session_files(
    zip: &mut ZipWriter<fs::File>,
    opts: SimpleFileOptions,
    agent_dir: &Path,
) -> Result<(), String> {
    let mut files: Vec<(SystemTime, PathBuf, String)> = Vec::new();
    collect_agent_files(agent_dir, agent_dir, &mut files, 0)?;
    files.sort_by_key(|b| std::cmp::Reverse(b.0));

    let mut total: u64 = 0;
    let mut count = 0usize;
    for (_mtime, path, rel) in files {
        if count >= MAX_AGENT_FILES {
            break;
        }
        if total >= MAX_AGENT_TOTAL_BYTES {
            break;
        }
        let lower = rel.to_ascii_lowercase();
        if lower.ends_with(".lock")
            || lower.contains("secret")
            || lower.contains("auth.json")
            || lower.ends_with(".png")
            || lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".gif")
            || lower.ends_with(".webp")
            || lower.ends_with(".mp4")
            || lower.ends_with(".zip")
        {
            continue;
        }
        // Prefer text-ish agent trail files.
        let allow = lower.ends_with(".json")
            || lower.ends_with(".jsonl")
            || lower.ends_with(".txt")
            || lower.ends_with(".log")
            || lower.ends_with(".md");
        if !allow {
            continue;
        }
        let text = match read_capped_text(&path, MAX_AGENT_FILE_BYTES) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let bytes = text.len() as u64;
        if total.saturating_add(bytes) > MAX_AGENT_TOTAL_BYTES && count > 0 {
            break;
        }
        let scrubbed = store::redact_text(&text);
        let zip_name = format!("agent/{}", rel.replace('\\', "/"));
        write_zip_str(zip, opts, &zip_name, &scrubbed)?;
        total = total.saturating_add(bytes);
        count += 1;
    }
    Ok(())
}

fn collect_agent_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<(SystemTime, PathBuf, String)>,
    depth: usize,
) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_agent_files(root, &path, out, depth + 1)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| {
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("file")
                    .to_string()
            });
        let modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        out.push((modified, path, rel));
    }
    Ok(())
}

/// Wipe App-owned data under the data root. Does not touch ~/.grok (CLI home).
///
/// `keep_secrets`: when true, leave secrets.json, OS keychain app secrets, and accounts/ in place.
pub fn reset_app_data(keep_secrets: bool) -> Result<serde_json::Value, String> {
    let root = paths::app_data_root();
    if !root.exists() {
        let _ = paths::ensure_app_dirs();
        return Ok(serde_json::json!({
            "ok": true,
            "dataRoot": root.display().to_string(),
            "removed": [],
            "keptSecrets": keep_secrets,
        }));
    }

    let mut removed: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // Directories that always go
    for name in ["sessions", "projects", "attachments", "logs", "agent-home"] {
        let p = root.join(name);
        if p.exists() {
            match fs::remove_dir_all(&p) {
                Ok(()) => removed.push(name.into()),
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
    }

    if !keep_secrets {
        let accounts = root.join("accounts");
        if accounts.exists() {
            match fs::remove_dir_all(&accounts) {
                Ok(()) => removed.push("accounts".into()),
                Err(e) => errors.push(format!("accounts: {e}")),
            }
        }
    }

    // Index / config files
    let files = vec![
        "projects.json",
        "sessions_index.json",
        "automations.json",
        "settings.json",
        "extensions.json",
    ];
    if !keep_secrets {
        // Wipe OS keychain entries + secrets.json (no-op parts when missing).
        match crate::secrets::wipe_all_secrets() {
            Ok(()) => {
                removed.push("secrets.json".into());
                removed.push("keychain:app-secrets".into());
            }
            Err(e) => errors.push(format!("secrets wipe: {e}")),
        }
    }
    for name in files {
        let p = root.join(name);
        if p.is_file() {
            match fs::remove_file(&p) {
                Ok(()) => removed.push(name.into()),
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
    }

    // Recreate empty skeleton so the next boot works
    paths::ensure_app_dirs().map_err(|e| format!("recreate dirs: {e}"))?;

    if !errors.is_empty() {
        return Err(format!("Reset partially failed: {}", errors.join("; ")));
    }

    Ok(serde_json::json!({
        "ok": true,
        "dataRoot": root.display().to_string(),
        "removed": removed,
        "keptSecrets": keep_secrets,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_keeps_secrets_when_requested() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!("grok-app-reset-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("sessions")).unwrap();
        fs::write(tmp.join("sessions_index.json"), "[]").unwrap();
        fs::write(tmp.join("secrets.json"), r#"{"officialApiKey":"sk-test"}"#).unwrap();
        fs::write(tmp.join("settings.json"), "{}").unwrap();

        std::env::set_var("GROK_APP_HOME", &tmp);
        let result = reset_app_data(true).expect("reset");
        assert!(result["ok"].as_bool().unwrap());
        assert!(tmp.join("secrets.json").is_file());
        assert!(!tmp.join("sessions_index.json").is_file());
        assert!(tmp.join("sessions").is_dir()); // recreated empty
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn support_bundle_creates_zip_without_secrets() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!("grok-app-bundle-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("logs")).unwrap();
        fs::write(
            tmp.join("logs").join("app.log"),
            "hello sk-thisisalongfaketoken123456 and ok",
        )
        .unwrap();
        fs::write(tmp.join("settings.json"), r#"{"locale":"en"}"#).unwrap();
        fs::write(
            tmp.join("secrets.json"),
            r#"{"officialApiKey":"sk-secret"}"#,
        )
        .unwrap();

        std::env::set_var("GROK_APP_HOME", &tmp);
        let zip_path = write_support_bundle(r#"{"summary":{"ok":1}}"#, None).expect("bundle");
        assert!(zip_path.is_file());
        let bytes = fs::read(&zip_path).unwrap();
        // secrets.json must not appear as a zip entry name / content
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(!as_str.contains("secrets.json"));
        assert!(!as_str.contains("sk-secret"));
        assert!(!as_str.contains("stall-timeline.json"));

        // meta.json always present with appVersion + cli probe object (honest empty ok).
        let file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).expect("open zip");
        let mut meta_entry = archive.by_name("meta.json").expect("meta.json entry");
        let mut meta_body = String::new();
        meta_entry.read_to_string(&mut meta_body).expect("read meta");
        assert!(meta_body.contains("appVersion"), "meta must include appVersion");
        assert!(
            meta_body.contains("\"cli\""),
            "meta must include cli probe object: {meta_body}"
        );
        assert!(!meta_body.contains("sk-secret"));

        let _ = fs::remove_file(&zip_path);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn redact_text_scrubs_api_keys_from_doctor_payload() {
        // Prove support-bundle redaction path for doctor JSON (no secrets leak).
        let raw = r#"{"msg":"token sk-doctor-secret-value-long","ok":true}"#;
        let scrubbed = store::redact_text(raw);
        assert!(
            !scrubbed.contains("sk-doctor-secret-value-long"),
            "api key must be redacted: {scrubbed}"
        );
        assert!(scrubbed.contains("[REDACTED]") || !scrubbed.contains("sk-doctor"));
    }

    #[test]
    fn support_bundle_includes_redacted_stall_timeline() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp =
            std::env::temp_dir().join(format!("grok-app-bundle-stall-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("settings.json"), r#"{"locale":"en"}"#).unwrap();
        // Present so redact_text can scrub known key material if it leaks into the snapshot.
        fs::write(
            tmp.join("secrets.json"),
            r#"{"officialApiKey":"sk-stall-secret-key-value"}"#,
        )
        .unwrap();

        std::env::set_var("GROK_APP_HOME", &tmp);
        let timeline = r#"{
  "kind": "stall_timeline",
  "source": "reliability_center",
  "count": 1,
  "signals": [{
    "id": "evt:hard_end:s1:1",
    "sessionId": "s1",
    "title": "Long run",
    "kind": "hard_end",
    "stallSeconds": 90,
    "tier": "hard",
    "reason": "stall sk-stall-secret-key-value",
    "at": 1
  }]
}"#;
        let zip_path =
            write_support_bundle(r#"{"summary":{"ok":1}}"#, Some(timeline)).expect("bundle");
        assert!(zip_path.is_file());
        let bytes = fs::read(&zip_path).unwrap();
        let as_str = String::from_utf8_lossy(&bytes);
        // Entry name lives in the central directory (uncompressed).
        assert!(as_str.contains("stall-timeline.json"));
        assert!(!as_str.contains("secrets.json"));

        // Deflated payload: open the archive and read the entry.
        let file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).expect("open zip");
        let mut entry = archive
            .by_name("stall-timeline.json")
            .expect("stall-timeline entry");
        let mut body = String::new();
        entry.read_to_string(&mut body).expect("read timeline");
        assert!(body.contains("stall_timeline") || body.contains("hard_end"));
        assert!(body.contains("Long run"));
        assert!(
            !body.contains("sk-stall-secret-key-value"),
            "secret must be redacted from stall timeline: {body}"
        );
        assert!(body.contains("[REDACTED]") || !body.contains("sk-stall"));

        let _ = fs::remove_file(&zip_path);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn session_bundle_includes_messages_without_secrets() {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-session-bundle-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("sessions")).unwrap();
        fs::create_dir_all(tmp.join("logs")).unwrap();
        fs::write(
            tmp.join("settings.json"),
            r#"{"locale":"en","sessionDataMode":"independent"}"#,
        )
        .unwrap();
        fs::write(
            tmp.join("secrets.json"),
            r#"{"officialApiKey":"sk-session-secret-value"}"#,
        )
        .unwrap();
        fs::write(
            tmp.join("logs").join("app.log"),
            "log sk-session-secret-value end",
        )
        .unwrap();

        std::env::set_var("GROK_APP_HOME", &tmp);
        let session =
            store::create_session(None, Some("Export test".into()), false).expect("create session");
        store::append_message(
            &session.id,
            store::ChatMessageStored {
                id: "m1".into(),
                role: "user".into(),
                content: "hello with sk-session-secret-value".into(),
                thought: None,
                created_at: chrono::Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
        )
        .expect("append");

        let zip_path = write_session_bundle(
            &session.id,
            Some(serde_json::json!({ "slot": "live", "state": "Ready" })),
        )
        .expect("session bundle");
        assert!(zip_path.is_file());
        let bytes = fs::read(&zip_path).unwrap();
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(!as_str.contains("sk-session-secret-value"));
        assert!(!as_str.contains("secrets.json"));
        // Zip central directory should list expected entries
        assert!(as_str.contains("host/messages.json") || as_str.contains("messages.json"));
        assert!(as_str.contains("README.txt") || as_str.contains("meta.json"));
        let _ = fs::remove_file(&zip_path);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
