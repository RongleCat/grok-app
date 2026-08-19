//! Process diagnostics logging: stderr + rolling file under app data `logs/`.
//!
//! File logs enable post-mortem of mid-turn agent exits and host timeouts
//! when the GUI process is launched from Finder (no terminal).
//!
//! Panic messages are written **synchronously** (in addition to the non-blocking
//! file sink) so `abort()` after a Rust panic still leaves a diagnostic trail.

#![allow(dead_code)] // residual-clippy: logs_dir helper
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Kept alive for the process lifetime so the non-blocking writer drains.
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

/// Default filter when `RUST_LOG` is unset.
pub const DEFAULT_ENV_FILTER: &str = "info";

/// Initialize dual-sink tracing (stderr + daily rolling file). Safe to call once.
pub fn init() {
    let _ = crate::paths::ensure_app_dirs();
    let log_dir = crate::paths::app_data_root().join("logs");

    install_panic_hook(log_dir.clone());

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_ENV_FILTER));

    let file_appender = tracing_appender::rolling::daily(&log_dir, "app.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true)
        .with_ansi(true);

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_target(true)
        .with_ansi(false);

    // Prefer dual sinks; fall back to stderr-only if registry init races in tests.
    if tracing_subscriber::registry()
        .with(filter)
        .with(stderr_layer)
        .with(file_layer)
        .try_init()
        .is_err()
    {
        // Tests or a second setup call — leave existing subscriber alone.
        return;
    }

    tracing::info!(
        target: "grok_app::logging",
        path = %log_dir.display(),
        "diagnostic file logging enabled (daily rotate app.log.YYYY-MM-DD)"
    );
}

/// Absolute path of the logs directory (may not exist until first write).
pub fn logs_dir() -> PathBuf {
    crate::paths::app_data_root().join("logs")
}

/// Append one line to today's rolling file and flush. Survives a wedged
/// `tracing-appender` worker (lossy non-blocking sink can go silent while
/// Host is still serving commands).
pub fn sync_diag(message: &str) {
    let log_dir = logs_dir();
    let _ = std::fs::create_dir_all(&log_dir);
    let day = chrono::Local::now().format("%Y-%m-%d");
    let path = log_dir.join(format!("app.log.{day}"));
    let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let line = format!("{ts}  WARN grok_app::logging: {message}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = f.write_all(line.as_bytes());
        let _ = f.flush();
    }
}

/// Install a panic hook that **sync-writes** to `logs/panic.log` and today's
/// `app.log.YYYY-MM-DD` before chaining to the previous hook.
///
/// Non-blocking `tracing-appender` can lose the final lines on `abort()`; this
/// path uses plain `OpenOptions` so post-crash forensics still see the message.
/// A force-captured backtrace is appended when available (release builds often
/// lack symbols, but frame addresses still help post-mortem).
fn install_panic_hook(log_dir: PathBuf) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>");
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<dyn Any>".into()
        };
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");
        // force_capture works even when RUST_BACKTRACE is unset (Finder launches).
        let bt = std::backtrace::Backtrace::force_capture();
        let line = format!("{ts} PANIC thread={name} at {location}: {payload}\n{bt}\n");

        // Best-effort sync writes — never panic inside the hook.
        let _ = std::fs::create_dir_all(&log_dir);
        let panic_path = log_dir.join("panic.log");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&panic_path)
        {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
        let day = chrono::Local::now().format("%Y-%m-%d");
        let daily = log_dir.join(format!("app.log.{day}"));
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&daily)
        {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
        // Always surface on stderr for terminal launches.
        eprint!("{line}");

        prev(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_dir_under_app_data() {
        let dir = logs_dir();
        assert!(dir.ends_with("logs"), "{dir:?}");
    }
}
