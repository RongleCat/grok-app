// ─── Automations ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn automations_list() -> Result<Vec<store::Automation>, String> {
    Ok(store::load_automations())
}

#[tauri::command]
pub async fn automation_create(
    input: store::AutomationInput,
) -> Result<store::Automation, String> {
    store::create_automation(input)
}

#[tauri::command]
pub async fn automation_update(
    id: String,
    input: store::AutomationInput,
) -> Result<store::Automation, String> {
    store::update_automation(&id, input)
}

#[tauri::command]
pub async fn automation_set_enabled(
    id: String,
    enabled: bool,
) -> Result<store::Automation, String> {
    store::set_automation_enabled(&id, enabled)
}

#[tauri::command]
pub async fn automation_mark_run(
    id: String,
    last_run_at: String,
    next_run_at: Option<String>,
) -> Result<store::Automation, String> {
    let last = chrono::DateTime::parse_from_rfc3339(&last_run_at)
        .map(|d| d.with_timezone(&chrono::Utc))
        .map_err(|e| e.to_string())?;
    let next = match next_run_at {
        Some(s) if !s.is_empty() => Some(
            chrono::DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&chrono::Utc))
                .map_err(|e| e.to_string())?,
        ),
        _ => None,
    };
    store::mark_automation_run(&id, last, next)
}

#[tauri::command]
pub async fn automation_delete(id: String) -> Result<(), String> {
    store::delete_automation(&id)
}

/// Host automation_runner snapshot (tray-only ok; not a separate daemon).
#[tauri::command]
pub async fn automation_runner_status(
) -> Result<crate::automation_runner::AutomationRunnerStatus, String> {
    Ok(crate::automation_runner::status())
}

/// macOS schedules LaunchAgent helper status (honest full-app restart only).
#[tauri::command]
pub async fn schedules_launch_agent_status(
) -> Result<crate::schedules_launch_agent::SchedulesLaunchAgentStatus, String> {
    let enabled = store::load_settings_async().await.schedules_launch_agent;
    Ok(crate::schedules_launch_agent::status(enabled))
}

/// Enable/disable the optional schedules LaunchAgent helper and persist setting.
#[tauri::command]
pub async fn schedules_launch_agent_set_enabled(
    enabled: bool,
) -> Result<crate::schedules_launch_agent::SchedulesLaunchAgentStatus, String> {
    let status = if enabled {
        crate::schedules_launch_agent::enable()?
    } else {
        crate::schedules_launch_agent::disable()?
    };
    let mut settings = store::load_settings_async().await;
    // Non-macOS never claims enabled; install is a no-op there.
    settings.schedules_launch_agent = enabled && status.supported;
    store::save_settings_async(&settings).await?;
    Ok(crate::schedules_launch_agent::status(
        settings.schedules_launch_agent,
    ))
}

/// Reveal the generated helper directory in Finder / Explorer (when present).
#[tauri::command]
pub async fn schedules_launch_agent_reveal_helper() -> Result<String, String> {
    let dir = crate::schedules_launch_agent::helper_dir();
    if !dir.is_dir() {
        // Generate files so the user can inspect without enabling the agent.
        crate::schedules_launch_agent::generate_helper_files()?;
    }
    let path = dir.display().to_string();
    path_reveal(path.clone()).await?;
    Ok(path)
}

