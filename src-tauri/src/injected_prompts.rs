//! A turn the Host started on its own must not read as the user's own message.
//!
//! A PR-monitor wake and an external `--session-send` dispatch a real turn, so
//! the CLI journals it as a user message; the transcript would show it as if the
//! user had typed it ("I sent this and never said anything").
//!
//! The origin therefore travels **with the turn**, not with its text: the send
//! path arms the app session immediately before it sends
//! (`session_api::dispatch_turn`), and the turn runner takes the arm while it
//! writes the user row (`session_manager::turn`). Nothing is matched by text, so
//! a user who later types or pastes the very same words still gets a normal user
//! row — there is no window in which a look-alike could be mislabelled.
//!
//! One turn runs per chat at a time (`session_turn_busy` + the turn lease), so a
//! single per-session slot is enough. An arm is dropped when the send never went
//! out (connect/send error), so it cannot leak onto a later user turn.

/// Marker the transcript uses for a row the Host injected.
pub const MARKER: &str = "auto_wake";

use std::collections::HashMap;
use std::sync::Mutex;

/// App session → the origin of the turn in flight right now.
static ARMED: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn with_armed<T>(f: impl FnOnce(&mut HashMap<String, String>) -> T) -> Option<T> {
    let mut guard = ARMED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    Some(f(map))
}

/// Mark the next turn of `session_id` as injected by `origin`.
///
/// Origins today: `pr_monitor` (a wake) and `external` (the session API).
pub fn arm(session_id: &str, origin: &str) {
    let session = session_id.trim();
    if session.is_empty() || origin.trim().is_empty() {
        return;
    }
    with_armed(|map| {
        map.insert(session.to_string(), origin.trim().to_string());
    });
}

/// The marker the row being written must wear, consuming the arm.
pub fn take_armed_marker(session_id: &str) -> Option<String> {
    let session = session_id.trim();
    if session.is_empty() {
        return None;
    }
    with_armed(|map| map.remove(session))
        .flatten()
        .map(|_| MARKER.to_string())
}

/// Forget an arm whose turn never went out.
pub fn disarm(session_id: &str) {
    let session = session_id.trim();
    if session.is_empty() {
        return;
    }
    with_armed(|map| {
        map.remove(session);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_arm_is_taken_once() {
        arm("t-take", "pr_monitor");
        assert_eq!(take_armed_marker("t-take").as_deref(), Some(MARKER));
        // The row is written once: a second turn in the same chat is the user's.
        assert!(take_armed_marker("t-take").is_none());
    }

    #[test]
    fn a_disarmed_turn_stays_a_user_row() {
        arm("t-disarm", "external");
        disarm("t-disarm");
        assert!(take_armed_marker("t-disarm").is_none());
    }

    #[test]
    fn nothing_is_armed_by_default_and_blanks_are_ignored() {
        assert!(take_armed_marker("t-untouched").is_none());
        assert!(take_armed_marker("").is_none());
        arm("", "pr_monitor");
        arm("t-blank-origin", "   ");
        assert!(take_armed_marker("t-blank-origin").is_none());
    }

    #[test]
    fn arming_twice_keeps_the_last_origin() {
        arm("t-twice", "external");
        arm("t-twice", "pr_monitor");
        assert_eq!(take_armed_marker("t-twice").as_deref(), Some(MARKER));
        assert!(take_armed_marker("t-twice").is_none());
    }
}
