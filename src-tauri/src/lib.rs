//! Grok App Host — real ACP default (`grok agent stdio`).

mod account;
mod account_profiles;
mod acp_client;
mod agent_memory;
mod agents_catalog;
mod agent_prefs;
mod app_update;
mod agent_subagents;
mod extensions;
mod hooks;
mod supergrok_quota;
mod cli_probe;
mod cli_install;
mod cli_update;
mod commands;
mod support_bundle;
mod editors;
mod error;
mod fs_browser;
mod media_protocol;
mod path_scope;
mod mirror;
mod mock_acp;
mod models_catalog;
mod paths;
mod process_util;
mod process_limits;
mod journal_throttle;
mod stream_stall;
mod cli_sessions;
mod turn_complete;
mod store_lock;
mod permission;
mod project_rules;
mod permission_rules;
mod providers;
mod secrets;
mod session_import;
mod session_content_search;
mod session_title;
#[cfg(test)]
mod permission_host_test;
#[cfg(test)]
mod integration_test;
#[cfg(test)]
mod acp_golden_test;
mod session_fsm;
mod session_manager;
mod store;
mod tray;
mod tray_i18n;
mod voice_auth;
mod voice_host;
mod voice_stt;
mod voice_tools;
mod remote_im;

use std::sync::Arc;

use mirror::MirrorHost;
use session_manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = paths::ensure_app_dirs();
    // Keep absolute-path allowlist in sync with trusted projects.
    path_scope::refresh_from_store();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let session_mgr = Arc::new(SessionManager::new());
    let mirror_host = Arc::new(MirrorHost::from_env());
    let voice_host = Arc::new(voice_host::VoiceHost::new());
    let remote_im_state = Arc::new(remote_im::RemoteImState {
        inner: tokio::sync::Mutex::new(remote_im::BridgeRuntime::default()),
    });

    tauri::Builder::default()
        // Must be registered first so a second process exits and focuses the primary window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(session_mgr)
        .manage(mirror_host)
        .manage(voice_host)
        .manage(remote_im_state)
        // Range-capable media streaming (video/audio/pdf) — never loads multi‑GB into RAM.
        .register_asynchronous_uri_scheme_protocol("media", |_ctx, request, responder| {
            std::thread::spawn(move || {
                let response = media_protocol::handle_request(request);
                responder.respond(response);
            });
        })
        // Close button / Alt+F4: hide to tray (default) or quit — Settings → General.
        // Full exit always available via tray "Quit Grok" or Cmd+Q.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                let close_to_tray = store::load_settings().close_to_tray;
                if close_to_tray {
                    api.prevent_close();
                    tray::hide_to_tray(window.app_handle());
                }
                // else: allow default close → process exit
            }
        })
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    // Transparent layers so CSS backdrop-filter / native vibrancy show through.
                    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                    // Frosted glass under transparent regions (sidebar). Solid main CSS covers the rest.
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    if let Err(e) = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        None,
                        Some(16.0),
                    ) {
                        tracing::warn!("window vibrancy: {e}");
                    }
                }
                // Windows / others: solid base matching dark theme (avoids white flash / WebView2 glitches).
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = window.set_background_color(Some(tauri::window::Color(13, 13, 13, 255)));
                }
            }
            // Menu-bar / system tray — logo.svg tray icon (not dock app icon)
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("tray setup: {e}");
            }
            // I03: recycle idle agent processes; session metadata stays on disk.
            // I06: surface cancel UI when a stream is pure-silent for too long.
            {
                use tauri::Manager;
                let mgr = app.state::<Arc<SessionManager>>().inner().clone();
                mgr.start_idle_watchdog(app.handle().clone());
                mgr.start_stream_stall_watchdog(app.handle().clone());
            }
            // Remote IM: restore Feishu/Weixin connectors after App restart so
            // already-bound channels keep receiving messages without a manual Start.
            {
                use tauri::Manager;
                remote_im::set_app_handle(app.handle().clone());
                let rim = app.state::<Arc<remote_im::RemoteImState>>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    remote_im::try_autostart(&rim).await;
                });
            }
            // Headless mirror auto-start (GROK_MIRROR_HEADLESS=1) — off by default.
            {
                use tauri::Manager;
                let host = app.state::<Arc<MirrorHost>>().inner().clone();
                let mgr = app.state::<Arc<SessionManager>>().inner().clone();
                mirror::maybe_autostart(host, app.handle().clone(), mgr);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_get_state,
            commands::session_connect,
            commands::session_send,
            commands::session_interject,
            commands::session_stop,
            commands::session_disconnect,
            commands::session_reattach,
            commands::session_resolve_permission,
            commands::session_resolve_plan,
            commands::session_resolve_ask_user,
            commands::probe_cli,
            commands::acp_test_connection,
            commands::cli_install_latest,
            commands::cli_install_commands,
            commands::cli_update_check,
            commands::cli_update_install,
            commands::pick_cli_binary,
            commands::open_external_url,
            commands::app_check_update,
            commands::voice_status,
            commands::voice_transcribe,
            commands::projects_list,
            commands::project_add,
            commands::project_add_dialog,
            commands::project_remove,
            commands::project_relocate,
            commands::project_trust,
            commands::project_set_permission_policy,
            commands::project_rename,
            commands::project_set_pinned,
            commands::project_reveal,
            commands::project_rules_list,
            commands::project_rules_ensure_template,
            commands::project_archive_sessions,
            commands::sessions_list,
            commands::sessions_search,
            commands::cli_sessions_list,
            commands::cli_session_import,
            commands::cli_sessions_import_all,
            commands::session_create,
            commands::session_delete,
            commands::session_rename,
            commands::session_set_archived,
            commands::session_set_pinned,
            commands::session_set_project,
            commands::session_set_scheduled,
            commands::session_messages,
            commands::session_media_root,
            commands::session_resolve_relative_media,
            commands::settings_get,
            commands::store_take_quarantine,
            commands::settings_set,
            commands::memory_clear,
            commands::settings_remember_last_session,
            commands::models_list_available,
            commands::agents_catalog,
            commands::composer_prefs_resolve,
            commands::composer_prefs_set,
            commands::session_set_policy,
            commands::permission_rules_get,
            commands::permission_rules_set,
            commands::session_set_model,
            commands::session_rewind_drop_last_user,
            commands::session_rewind_points,
            commands::session_rewind_execute,
            commands::session_fork,
            commands::secrets_get_masked,
            commands::secrets_set,
            commands::provider_ping,
            commands::import_grok_cli_config,
            commands::import_grok_go_config,
            commands::doctor_report,
            commands::cli_doctor_fix,
            commands::export_support_bundle,
            commands::export_session_bundle,
            commands::session_trace_export,
            commands::reset_app_data,
            commands::skills_list,
            commands::agents_list,
            commands::inspect_mcp,
            commands::project_inspect,
            commands::extensions_get,
            commands::extensions_set_mcp,
            commands::extensions_set_skill,
            commands::extensions_enable_all_mcp,
            commands::extensions_enable_all_skills,
            commands::mcp_add,
            commands::mcp_remove,
            commands::mcp_doctor,
            commands::plugins_list,
            commands::plugin_enable,
            commands::plugin_disable,
            commands::plugin_uninstall,
            commands::plugin_details,
            commands::plugin_install,
            commands::plugin_update,
            commands::hooks_list,
            commands::hooks_reveal,
            commands::hooks_open_dir,
            commands::hooks_ensure_dir,
            commands::setup_preview,
            commands::setup_install,
            commands::marketplace_list,
            commands::marketplace_available,
            commands::marketplace_add,
            commands::marketplace_remove,
            commands::marketplace_update,
            commands::leader_list,
            commands::leader_kill_all,
            commands::pick_directory,
            commands::pick_attach_files,
            commands::pick_attach_folder,
            commands::save_temp_attachment,
            commands::clipboard_paste_image,
            commands::paths_classify,
            commands::path_open,
            commands::path_reveal,
            commands::git_file_diff,
            commands::git_status,
            commands::git_worktrees_list,
            commands::git_worktree_add,
            commands::git_worktree_remove,
            commands::git_worktree_gc,
            commands::git_show_file,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_write_absolute,
            tray::tray_refresh,
            commands::fs_read_absolute,
            commands::fs_open_path,
            commands::session_auto_title,
            commands::automations_list,
            commands::automation_create,
            commands::automation_update,
            commands::automation_set_enabled,
            commands::automation_mark_run,
            commands::automation_delete,
            commands::account_status,
            commands::account_login,
            commands::account_login_cancel,
            commands::account_logout,
            commands::account_open_usage,
            commands::account_open_subscribe,
            commands::accounts_list,
            commands::account_save_current,
            commands::account_switch,
            commands::account_remove,
            commands::account_rename,
            commands::session_import_transcript,
            commands::session_import_transcript_file,
            commands::providers_list,
            commands::providers_upsert,
            commands::providers_remove,
            commands::providers_set_default,
            commands::providers_activate,
            commands::providers_ping,
            commands::providers_list_models,
            commands::editors_list,
            commands::open_in_editor,
            mirror::mirror_status,
            mirror::mirror_start,
            mirror::mirror_stop,
            voice_host::voice_state,
            voice_host::voice_start,
            voice_host::voice_stop,
            voice_host::voice_push_pcm,
            voice_host::voice_invoke_tool,
            voice_host::voice_dictation_transcribe,
            remote_im::remote_im_bridge_status,
            remote_im::remote_im_bridge_start,
            remote_im::remote_im_bridge_stop,
            remote_im::remote_im_bridge_set_config,
            remote_im::remote_im_bridge_reload,
            remote_im::remote_im_test_connection,
            remote_im::remote_im_scan_begin,
            remote_im::remote_im_scan_poll,
            remote_im::remote_im_list_instances,
            remote_im::remote_im_save_instance,
            remote_im::remote_im_delete_instance,
            remote_im::remote_im_doctor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Grok App")
        .run(|app, event| {
            // macOS: click Dock icon when all windows hidden → show main window again.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    tray::show_main_window(app);
                }
            }
            // Full exit (tray Quit / Cmd+Q): tear down mirror host + cloudflared group.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                if let Some(host) = app.try_state::<Arc<MirrorHost>>() {
                    host.inner().stop_sync();
                }
            }
            let _ = (app, &event);
        });
}
