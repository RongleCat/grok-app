//! When to finish a turn after `_x.ai/session/prompt_complete` (issue #52).
//!
//! Agents sometimes emit prompt_complete while tools are still running, or while
//! the host is waiting on permission / ask_user / plan review. Ending the UI
//! turn early makes long tasks look "interrupted" even though the agent is busy.
//!
//! ## Background shell tools
//!
//! Grok Build may mark a long `run_terminal_command` as `completed` with a `[bg]`
//! title (handed off to a background task), then keep streaming
//! `tool_call_update` with `status=in_progress` for stdout. Host must not treat
//! those late updates as re-opening the tool — otherwise `open_tool_ids` never
//! clears, `prompt_complete` stays deferred, and tool heartbeats prevent stall
//! heal from recovering.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

/// Terminal tool statuses — not counted as in-flight.
pub fn is_terminal_tool_status(status: &str) -> bool {
    let s = if status.is_empty() {
        "in_progress"
    } else {
        status
    };
    let lower = s.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "completed" | "complete" | "failed" | "error" | "cancelled" | "canceled" | "rejected"
    )
}

/// Whether PromptComplete should wait before calling `end_stream`.
pub fn should_defer_prompt_complete(
    awaiting_permission: bool,
    pending_plan: bool,
    pending_ask_user: bool,
    open_tool_count: usize,
) -> bool {
    awaiting_permission || pending_plan || pending_ask_user || open_tool_count > 0
}

/// Whether a `session://stream` `done:true` tick may close the UI turn.
///
/// `session/prompt` often resolves (or the 3s `prompt_complete` fallback
/// fires) while tools are still open. Forwarding that empty done tick makes
/// the transcript show 工作了 + copy/retry while the Host FSM is still
/// Streaming — the frozen-tail / stuck-composer bug.
pub fn should_emit_stream_done(
    prompt_in_flight: bool,
    awaiting_permission: bool,
    pending_plan: bool,
    pending_ask_user: bool,
    open_tool_count: usize,
) -> bool {
    !prompt_in_flight
        && !should_defer_prompt_complete(
            awaiting_permission,
            pending_plan,
            pending_ask_user,
            open_tool_count,
        )
}

/// Update open-tool tracking for one tool_call / tool_call_update.
///
/// **Monotonic terminal:** once a tool id is terminal this turn, later
/// `in_progress` / empty-status updates must not re-insert it into `open`.
/// That is the CLI background-shell pattern and is never used by normal tools
/// (they only go pending → in_progress → terminal).
///
/// Returns `true` if `open` changed (insert or remove).
pub fn note_tool_open_status(
    open: &mut HashSet<String>,
    terminal: &mut HashSet<String>,
    seen_at: &mut HashMap<String, Instant>,
    tool_call_id: &str,
    status: &str,
    now: Instant,
) -> bool {
    if tool_call_id.is_empty() {
        return false;
    }
    if is_terminal_tool_status(status) {
        terminal.insert(tool_call_id.to_string());
        let removed = open.remove(tool_call_id);
        seen_at.remove(tool_call_id);
        return removed;
    }
    // Do not re-open after terminal (bg stdout after completed([bg])).
    if terminal.contains(tool_call_id) {
        return false;
    }
    let inserted = open.insert(tool_call_id.to_string());
    seen_at.insert(tool_call_id.to_string(), now);
    inserted
}

/// Force-release a tool from open tracking (task_backgrounded / task_completed).
/// Does not write journal rows — only Host turn accounting.
pub fn release_tool_from_open(
    open: &mut HashSet<String>,
    terminal: &mut HashSet<String>,
    seen_at: &mut HashMap<String, Instant>,
    tool_call_id: &str,
) -> bool {
    if tool_call_id.is_empty() {
        return false;
    }
    terminal.insert(tool_call_id.to_string());
    let removed = open.remove(tool_call_id);
    seen_at.remove(tool_call_id);
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_statuses() {
        assert!(is_terminal_tool_status("completed"));
        assert!(is_terminal_tool_status("FAILED"));
        assert!(is_terminal_tool_status("cancelled"));
        assert!(!is_terminal_tool_status("in_progress"));
        assert!(!is_terminal_tool_status(""));
        assert!(!is_terminal_tool_status("pending"));
    }

    #[test]
    fn defer_while_tools_or_gates() {
        assert!(!should_defer_prompt_complete(false, false, false, 0));
        assert!(should_defer_prompt_complete(true, false, false, 0));
        assert!(should_defer_prompt_complete(false, true, false, 0));
        assert!(should_defer_prompt_complete(false, false, true, 0));
        assert!(should_defer_prompt_complete(false, false, false, 2));
    }

    #[test]
    fn stream_done_suppressed_while_prompt_or_tools_live() {
        assert!(should_emit_stream_done(false, false, false, false, 0));
        assert!(!should_emit_stream_done(true, false, false, false, 0));
        assert!(!should_emit_stream_done(false, false, false, false, 1));
        assert!(!should_emit_stream_done(false, true, false, false, 0));
    }

    #[test]
    fn normal_tool_open_then_complete() {
        let mut open = HashSet::new();
        let mut terminal = HashSet::new();
        let mut seen = HashMap::new();
        let now = Instant::now();
        let id = "call-1";

        assert!(note_tool_open_status(
            &mut open,
            &mut terminal,
            &mut seen,
            id,
            "in_progress",
            now
        ));
        assert!(open.contains(id));
        assert!(!terminal.contains(id));
        assert_eq!(open.len(), 1);

        // Mid-tool progress keeps it open (and refreshes seen_at).
        assert!(!note_tool_open_status(
            &mut open,
            &mut terminal,
            &mut seen,
            id,
            "in_progress",
            now
        ));
        assert!(open.contains(id));

        assert!(note_tool_open_status(
            &mut open,
            &mut terminal,
            &mut seen,
            id,
            "completed",
            now
        ));
        assert!(open.is_empty());
        assert!(terminal.contains(id));
        assert!(!should_defer_prompt_complete(
            false,
            false,
            false,
            open.len()
        ));
    }

    #[test]
    fn background_shell_completed_then_in_progress_does_not_reopen() {
        // Repro: call-f1b6b6f2… completed([bg]) then dozens of in_progress updates.
        let mut open = HashSet::new();
        let mut terminal = HashSet::new();
        let mut seen = HashMap::new();
        let now = Instant::now();
        let id = "call-f1b6b6f2-5e0f-413e-bafa-42a7ba048a01-10";

        note_tool_open_status(&mut open, &mut terminal, &mut seen, id, "in_progress", now);
        assert_eq!(open.len(), 1);

        note_tool_open_status(&mut open, &mut terminal, &mut seen, id, "completed", now);
        assert!(open.is_empty());

        for _ in 0..40 {
            assert!(!note_tool_open_status(
                &mut open,
                &mut terminal,
                &mut seen,
                id,
                "in_progress",
                now
            ));
        }
        assert!(
            open.is_empty(),
            "bg stdout must not re-open a terminal tool"
        );
        assert!(!should_defer_prompt_complete(
            false,
            false,
            false,
            open.len()
        ));
    }

    #[test]
    fn release_from_task_events() {
        let mut open = HashSet::new();
        let mut terminal = HashSet::new();
        let mut seen = HashMap::new();
        let now = Instant::now();
        let id = "call-bg-1";

        note_tool_open_status(&mut open, &mut terminal, &mut seen, id, "in_progress", now);
        assert!(release_tool_from_open(
            &mut open,
            &mut terminal,
            &mut seen,
            id
        ));
        assert!(open.is_empty());
        assert!(terminal.contains(id));

        // Later stdout updates still ignored.
        note_tool_open_status(&mut open, &mut terminal, &mut seen, id, "in_progress", now);
        assert!(open.is_empty());
    }

    #[test]
    fn independent_tools_unaffected() {
        let mut open = HashSet::new();
        let mut terminal = HashSet::new();
        let mut seen = HashMap::new();
        let now = Instant::now();

        note_tool_open_status(&mut open, &mut terminal, &mut seen, "a", "in_progress", now);
        note_tool_open_status(&mut open, &mut terminal, &mut seen, "b", "in_progress", now);
        note_tool_open_status(&mut open, &mut terminal, &mut seen, "a", "completed", now);
        assert!(open.contains("b"));
        assert!(!open.contains("a"));
        // b still open → defer
        assert!(should_defer_prompt_complete(
            false,
            false,
            false,
            open.len()
        ));
        note_tool_open_status(&mut open, &mut terminal, &mut seen, "b", "failed", now);
        assert!(open.is_empty());
    }
}
