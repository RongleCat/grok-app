//! Support zip: Doctor snapshot + redacted logs for bug reports.
//! Never includes secrets.json, auth tokens, or raw API keys.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::Utc;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::paths;
use crate::store;

const MAX_LOG_FILES: usize = 12;
const MAX_LOG_BYTES_EACH: u64 = 512 * 1024;

/// Build a support zip under the system temp dir (caller may move/reveal it).
pub fn write_support_bundle(doctor_json: &str) -> Result<PathBuf, String> {
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
    let meta = serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "generatedAt": Utc::now().to_rfc3339(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "dataRootExists": root.is_dir(),
        "sessionCount": store::load_sessions_index().len(),
        "projectCount": store::load_projects().len(),
    });
    let meta_s = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    zip.start_file("meta.json", opts)
        .map_err(|e| format!("zip meta: {e}"))?;
    zip.write_all(meta_s.as_bytes())
        .map_err(|e| format!("write meta: {e}"))?;

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
        entries.sort_by(|a, b| b.0.cmp(&a.0));
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
- meta.json — app/OS versions and counts\n\
- logs/ — recent log files (redacted, size-capped)\n\
\n\
This archive never includes secrets.json or account auth snapshots.\n\
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

/// Wipe App-owned data under the data root. Does not touch ~/.grok (CLI home).
///
/// `keep_secrets`: when true, leave secrets.json and accounts/ in place.
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
    let mut files = vec![
        "projects.json",
        "sessions_index.json",
        "automations.json",
        "settings.json",
        "extensions.json",
    ];
    if !keep_secrets {
        files.push("secrets.json");
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
        return Err(format!(
            "Reset partially failed: {}",
            errors.join("; ")
        ));
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
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn reset_keeps_secrets_when_requested() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-reset-test-{}",
            std::process::id()
        ));
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
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-bundle-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("logs")).unwrap();
        fs::write(tmp.join("logs").join("app.log"), "hello sk-thisisalongfaketoken123456 and ok").unwrap();
        fs::write(tmp.join("settings.json"), r#"{"locale":"en"}"#).unwrap();
        fs::write(tmp.join("secrets.json"), r#"{"officialApiKey":"sk-secret"}"#).unwrap();

        std::env::set_var("GROK_APP_HOME", &tmp);
        let zip_path = write_support_bundle(r#"{"summary":{"ok":1}}"#).expect("bundle");
        assert!(zip_path.is_file());
        let bytes = fs::read(&zip_path).unwrap();
        // secrets.json must not appear as a zip entry name / content
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(!as_str.contains("secrets.json"));
        assert!(!as_str.contains("sk-secret"));
        let _ = fs::remove_file(&zip_path);
        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
