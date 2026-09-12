//! Host-side stream emit backpressure (coalesce `session://stream` IPC).
//!
//! Every token used to `app.emit` immediately, which flooded the WebView on
//! long answers. Buffer per turn and flush on a short timer, char budget,
//! phase boundary, or terminal `done`.

use std::time::{Duration, Instant};

/// Default coalesce window (ms) before a non-forced flush.
pub const DEFAULT_STREAM_EMIT_MS: u64 = 40;
/// Flush once pending text reaches this many UTF-8 bytes (approx chars).
pub const DEFAULT_STREAM_EMIT_MAX_CHARS: usize = 600;
#[allow(dead_code)]
pub const MIN_STREAM_EMIT_MS: u64 = 8;
#[allow(dead_code)]
pub const MAX_STREAM_EMIT_MS: u64 = 250;

#[allow(dead_code)]
pub fn normalize_stream_emit_ms(raw: u64) -> u64 {
    raw.clamp(MIN_STREAM_EMIT_MS, MAX_STREAM_EMIT_MS)
}

/// Whether a buffered stream emit should flush now.
pub fn should_flush_stream_emit(
    first_buffered_at: Instant,
    pending_chars: usize,
    now: Instant,
    force: bool,
    max_chars: usize,
    interval: Duration,
) -> bool {
    if force {
        return true;
    }
    if pending_chars == 0 {
        return false;
    }
    if pending_chars >= max_chars {
        return true;
    }
    now.saturating_duration_since(first_buffered_at) >= interval
}

/// Kind/message identity change or phase open must not merge into the buffer.
pub fn stream_emit_can_merge(
    pending_kind: &str,
    pending_message_id: &str,
    next_kind: &str,
    next_message_id: &str,
    next_thought_phase: &str,
) -> bool {
    if pending_kind != next_kind {
        return false;
    }
    if pending_message_id != next_message_id {
        return false;
    }
    let phase = next_thought_phase.to_ascii_lowercase();
    // New thought block must start a fresh emit so the UI can open a phase.
    if phase == "new" || phase == "open" {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_and_char_budget_flush() {
        let t0 = Instant::now();
        assert!(!should_flush_stream_emit(
            t0,
            10,
            t0,
            false,
            600,
            Duration::from_millis(40)
        ));
        assert!(should_flush_stream_emit(
            t0,
            600,
            t0,
            false,
            600,
            Duration::from_millis(40)
        ));
        assert!(should_flush_stream_emit(
            t0,
            1,
            t0,
            true,
            600,
            Duration::from_millis(40)
        ));
    }

    #[test]
    fn interval_flush() {
        let t0 = Instant::now();
        let later = t0 + Duration::from_millis(40);
        assert!(should_flush_stream_emit(
            t0,
            8,
            later,
            false,
            600,
            Duration::from_millis(40)
        ));
    }

    #[test]
    fn merge_rules() {
        assert!(stream_emit_can_merge(
            "assistant",
            "m1",
            "assistant",
            "m1",
            "none"
        ));
        assert!(stream_emit_can_merge(
            "thought", "m1", "thought", "m1", "continue"
        ));
        assert!(!stream_emit_can_merge(
            "thought", "m1", "thought", "m1", "new"
        ));
        assert!(!stream_emit_can_merge(
            "assistant",
            "m1",
            "thought",
            "m1",
            "none"
        ));
        assert!(!stream_emit_can_merge(
            "assistant",
            "m1",
            "assistant",
            "m2",
            "none"
        ));
    }
}
