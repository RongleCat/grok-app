//! Host process heartbeat so the next boot can tell a clean exit from a crash.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::turn_lease::list_active_lease_session_ids;

pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostRuntime {
    pub schema: u32,
    pub pid: u32,
    pub started_at: String,
    pub heartbeat_at: String,
    pub shutdown: bool,
    pub app_version: String,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UncleanRestartRecord {
    pub previous_pid: u32,
    pub started_at: String,
    pub heartbeat_at: String,
    pub dirty_lease_session_ids: Vec<String>,
}

pub fn runtime_path() -> PathBuf {
    crate::paths::app_data_root()
        .join("logs")
        .join("host_runtime.json")
}

pub fn unclean_log_path() -> PathBuf {
    crate::paths::app_data_root()
        .join("logs")
        .join("unclean-restart.log")
}

pub fn last_crash_path() -> PathBuf {
    crate::paths::app_data_root()
        .join("logs")
        .join("last_crash.txt")
}

pub fn read_runtime() -> Option<HostRuntime> {
    let raw = fs::read_to_string(runtime_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write_runtime(rt: &HostRuntime) -> std::io::Result<()> {
    let path = runtime_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(rt)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&json)?;
        f.flush()?;
    }
    fs::rename(tmp, path)?;
    Ok(())
}

/// Returns Some(record) when the previous process did not mark a clean shutdown.
pub fn detect_unclean(previous: Option<&HostRuntime>) -> Option<UncleanRestartRecord> {
    let prev = previous?;
    if prev.shutdown {
        return None;
    }
    Some(UncleanRestartRecord {
        previous_pid: prev.pid,
        started_at: prev.started_at.clone(),
        heartbeat_at: prev.heartbeat_at.clone(),
        dirty_lease_session_ids: list_active_lease_session_ids(),
    })
}

pub fn append_unclean(record: &UncleanRestartRecord) -> std::io::Result<()> {
    let path = unclean_log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut line = serde_json::to_string(record)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    line.push('\n');
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    f.write_all(line.as_bytes())?;
    f.flush()?;
    Ok(())
}

pub fn on_process_start() {
    let previous = read_runtime();
    if let Some(record) = detect_unclean(previous.as_ref()) {
        tracing::warn!(
            target: "grok_app::host_runtime",
            pid = record.previous_pid,
            dirty = record.dirty_lease_session_ids.len(),
            "previous host process did not shut down cleanly"
        );
        if let Err(e) = append_unclean(&record) {
            tracing::warn!("unclean-restart log write failed: {e}");
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    let rt = HostRuntime {
        schema: SCHEMA,
        pid: std::process::id(),
        started_at: now.clone(),
        heartbeat_at: now,
        shutdown: false,
        app_version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
    };
    if let Err(e) = write_runtime(&rt) {
        tracing::warn!("host_runtime write failed: {e}");
    }
    crate::turn_interrupt::heal_all_active_leases();
}

pub fn touch_heartbeat() {
    let Some(mut rt) = read_runtime() else {
        return;
    };
    rt.heartbeat_at = chrono::Utc::now().to_rfc3339();
    let _ = write_runtime(&rt);
}

pub fn on_process_shutdown() {
    let Some(mut rt) = read_runtime() else {
        return;
    };
    rt.shutdown = true;
    rt.heartbeat_at = chrono::Utc::now().to_rfc3339();
    let _ = write_runtime(&rt);
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn with_home<T>(f: impl FnOnce() -> T) -> T {
        let _g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "grok-host-runtime-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let prev = std::env::var("GROK_APP_HOME").ok();
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = crate::paths::ensure_app_dirs();
        let out = f();
        match prev {
            Some(v) => std::env::set_var("GROK_APP_HOME", v),
            None => std::env::remove_var("GROK_APP_HOME"),
        }
        let _ = fs::remove_dir_all(&tmp);
        out
    }

    fn sample(shutdown: bool) -> HostRuntime {
        HostRuntime {
            schema: SCHEMA,
            pid: 4242,
            started_at: "2026-08-19T03:43:08Z".into(),
            heartbeat_at: "2026-08-19T03:45:47Z".into(),
            shutdown,
            app_version: "0.2.22".into(),
            os: "windows".into(),
        }
    }

    #[test]
    fn previous_shutdown_false_records_unclean() {
        with_home(|| {
            write_runtime(&sample(false)).unwrap();
            let rec = detect_unclean(read_runtime().as_ref()).expect("unclean");
            assert_eq!(rec.previous_pid, 4242);
            append_unclean(&rec).unwrap();
            let log = fs::read_to_string(unclean_log_path()).unwrap();
            assert!(log.contains("\"previousPid\":4242"));
        });
    }

    #[test]
    fn previous_shutdown_true_is_clean() {
        assert!(detect_unclean(Some(&sample(true))).is_none());
    }

    #[test]
    fn missing_file_is_clean() {
        assert!(detect_unclean(None).is_none());
    }

    #[test]
    fn on_process_start_writes_fresh_runtime() {
        with_home(|| {
            write_runtime(&sample(false)).unwrap();
            on_process_start();
            let rt = read_runtime().unwrap();
            assert!(!rt.shutdown);
            assert_eq!(rt.pid, std::process::id());
            assert!(unclean_log_path().is_file());
        });
    }

    #[test]
    fn on_process_shutdown_marks_clean() {
        with_home(|| {
            on_process_start();
            on_process_shutdown();
            assert!(read_runtime().unwrap().shutdown);
        });
    }
}
