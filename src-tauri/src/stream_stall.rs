//! Stream stall watchdog policy (I06).
//!
//! While a turn is streaming, pure silence (no stream chunks / tool activity)
//! past a configurable timeout surfaces a cancel prompt. Long-running tools
//! that still emit tool events must not count as stalled.

use std::time::{Duration, Instant};

/// Spec default: 120s without stream/tool progress.
pub const DEFAULT_STREAM_STALL_SECONDS: u32 = 120;

/// Hard clamp for settings (avoid 0 / absurd values).
pub const MIN_STREAM_STALL_SECONDS: u32 = 15;
pub const MAX_STREAM_STALL_SECONDS: u32 = 15 * 60;

/// Normalize user/settings value for stream stall timeout (seconds).
pub fn normalize_stream_stall_seconds(raw: u32) -> u32 {
    raw.clamp(MIN_STREAM_STALL_SECONDS, MAX_STREAM_STALL_SECONDS)
}

/// Stall window from settings seconds.
pub fn stall_duration(stall_seconds: u32) -> Duration {
    Duration::from_secs(u64::from(normalize_stream_stall_seconds(stall_seconds)))
}

/// Instant when a turn with `last_progress` becomes eligible for stall UI.
pub fn stall_deadline(last_progress: Instant, stall_seconds: u32) -> Instant {
    last_progress + stall_duration(stall_seconds)
}

/// True when `now` is at or past the stall deadline.
pub fn is_stream_stalled(last_progress: Instant, stall_seconds: u32, now: Instant) -> bool {
    now >= stall_deadline(last_progress, stall_seconds)
}

/// Whether the host should emit another `session://stream_stall` notification.
///
/// Emits on first cross into stalled, then again every full stall window while
/// silence continues (so “Keep waiting” can re-prompt later).
pub fn should_emit_stall(
    last_progress: Instant,
    last_emit: Option<Instant>,
    stall_seconds: u32,
    now: Instant,
) -> bool {
    if !is_stream_stalled(last_progress, stall_seconds, now) {
        return false;
    }
    match last_emit {
        None => true,
        Some(t) => is_stream_stalled(t, stall_seconds, now),
    }
}

/// Human-readable stall message (English; UI maps via i18n).
pub fn stream_stall_message(stall_seconds: u32) -> String {
    let secs = normalize_stream_stall_seconds(stall_seconds);
    format!(
        "No stream or tool progress for about {secs}s. Cancel this turn or keep waiting."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clamps() {
        assert_eq!(normalize_stream_stall_seconds(0), MIN_STREAM_STALL_SECONDS);
        assert_eq!(normalize_stream_stall_seconds(120), 120);
        assert_eq!(
            normalize_stream_stall_seconds(99_999),
            MAX_STREAM_STALL_SECONDS
        );
    }

    #[test]
    fn not_stalled_before_deadline() {
        let t0 = Instant::now();
        let now = t0 + Duration::from_secs(60);
        assert!(!is_stream_stalled(t0, 120, now));
    }

    #[test]
    fn stalled_at_and_after_deadline() {
        let t0 = Instant::now();
        let at = t0 + Duration::from_secs(120);
        let after = at + Duration::from_secs(1);
        assert!(is_stream_stalled(t0, 120, at));
        assert!(is_stream_stalled(t0, 120, after));
    }

    #[test]
    fn tool_progress_resets_deadline() {
        let t0 = Instant::now();
        let tool = t0 + Duration::from_secs(100);
        // 50s after last tool event with 120s window — not stalled.
        assert!(!is_stream_stalled(tool, 120, tool + Duration::from_secs(50)));
        assert!(is_stream_stalled(tool, 120, tool + Duration::from_secs(120)));
    }

    #[test]
    fn emit_once_then_again_after_full_window() {
        let t0 = Instant::now();
        let stall_at = t0 + Duration::from_secs(120);
        assert!(should_emit_stall(t0, None, 120, stall_at));
        // Just after first emit: do not re-spam.
        assert!(!should_emit_stall(
            t0,
            Some(stall_at),
            120,
            stall_at + Duration::from_secs(10)
        ));
        // Full window after last emit: re-prompt (Keep waiting).
        assert!(should_emit_stall(
            t0,
            Some(stall_at),
            120,
            stall_at + Duration::from_secs(120)
        ));
    }

    #[test]
    fn no_emit_when_not_stalled() {
        let t0 = Instant::now();
        assert!(!should_emit_stall(
            t0,
            None,
            120,
            t0 + Duration::from_secs(30)
        ));
    }

    #[test]
    fn message_includes_seconds() {
        let m = stream_stall_message(120);
        assert!(m.contains("120"), "{m}");
    }

    #[test]
    fn defaults_match_spec() {
        assert_eq!(DEFAULT_STREAM_STALL_SECONDS, 120);
        assert_eq!(MIN_STREAM_STALL_SECONDS, 15);
    }
}
