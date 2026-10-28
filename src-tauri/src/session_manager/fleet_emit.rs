//! Forward a background-fleet snapshot to the open chat.
//! Kept out of `events_bg` so that pump stays under the file-size gate.

use tauri::{AppHandle, Emitter};

pub(super) fn emit_fleet_update(
    app: &AppHandle,
    app_session_id: &str,
    kind: &str,
    body: &serde_json::Value,
) {
    let _ = app.emit(
        "session://fleet",
        serde_json::json!({
            "sessionId": app_session_id,
            "kind": kind,
            "body": body,
        }),
    );
}
