/// One row read from the linked CLI `updates.jsonl`.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardRow {
    pub id: String,
    pub status: String,
}

/// Background tasks and subagents for one chat.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardSnapshot {
    pub tasks: Vec<TaskBoardRow>,
    pub subagents: Vec<TaskBoardRow>,
}

/// Current rows for one chat. The panel polls this.
/// Each call reads the CLI session's `updates.jsonl`.
#[tauri::command]
pub fn task_board_snapshot(session_id: String) -> TaskBoardSnapshot {
    let snap = crate::cli_sessions::task_statuses_for_app_session(&session_id);
    let map = |rows: Vec<(String, String)>| {
        rows.into_iter()
            .map(|(id, status)| TaskBoardRow { id, status })
            .collect()
    };
    TaskBoardSnapshot {
        tasks: map(snap.tasks),
        subagents: map(snap.subagents),
    }
}
