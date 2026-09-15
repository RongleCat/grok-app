/// Typed Rules/Commands Host commands (#1222).

#[tauri::command]
pub async fn customize_commands_list(
    project_path: Option<String>,
) -> Result<crate::customize_commands::CustomCommandListResult, String> {
    let project_path = project_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::customize_commands::list_custom_commands(project_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn customize_command_create(
    name: String,
    body: String,
    scope: Option<String>,
    project_path: Option<String>,
) -> Result<crate::customize_commands::CustomCommandEntry, String> {
    let name = name.clone();
    let body = body.clone();
    let scope = scope.clone();
    let project_path = project_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::customize_commands::create_custom_command(
            &name,
            &body,
            scope.as_deref(),
            project_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
