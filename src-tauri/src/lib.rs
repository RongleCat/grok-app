//! Grok App Host — real ACP default (`grok agent stdio`).

mod account;

mod account_profiles;

mod acp_client;

#[cfg(test)]
mod acp_golden_test;

mod agent_auto_wake;

mod agent_codebase_indexing;

mod agent_config_edit;

mod agent_config_view;

mod agent_home_config;

mod agent_memory;

mod agent_memory_embed;

mod agent_prefs;

mod agent_privacy;

mod agent_subagent_wt_snap;

mod agent_subagents;

mod agent_todo_gate;

mod agent_two_pass_compaction;

mod agent_workflows;

mod agents_catalog;

mod app_menu;

mod app_update;

mod audit_ledger;

mod automation_runner;

mod batch_agents;

mod cc_switch_import;

mod cli_install;

mod cli_probe;

mod cli_sessions;

mod cli_update;

mod cli_worktrees;

mod wsl_backend;

mod ssh_remote;

mod side_browser_blob;
mod side_browser_host;

mod commands;

mod pet_window;
mod theme_editor_window;

mod editors;

mod error;

mod extensions;
mod mcp_oauth;

mod fs_browser;

mod git_pr_hub;

mod hooks;

#[cfg(test)]
mod integration_test;

mod journal_throttle;

mod leader;

mod logging;

mod managed_setup;

mod media_protocol;

mod media_server;

mod mirror;

mod mock_acp;

mod models_aux;

mod models_catalog;

mod official_aux;

mod path_scope;

mod paths;

mod plan_chrome;

mod permission;

#[cfg(test)]
mod permission_host_test;

mod permission_rules;

mod process_limits;

mod process_util;

mod project_codebase_search;

mod project_rules;

mod provider_headers;

mod providers;

mod proxy;

mod relay_stream_proxy;

mod pty_host;

mod remote_im;

mod schedules_launch_agent;

mod secrets;

mod serve;

mod session_content_search;

mod session_fsm;

mod session_import;

mod session_attach;

mod session_api;

mod session_manager;

mod session_title;

mod skill_compat;

mod skill_edit;

mod store;

mod store_lock;

mod stream_emit;

mod pending_quit;
mod stream_stall;

mod streaming_acp_ndjson;

mod streaming_messages_json;

mod supergrok_quota;

mod support_bundle;

mod tool_heartbeat;

mod tray;

mod tray_i18n;

mod win_taskbar_overlay;

mod os_theme;

mod system_fonts;

mod desktop_notify;

mod turn_complete;

mod turn_interrupt;

mod turn_lease;

mod host_runtime;

mod win_crash;

mod updater;

mod image_thumb;
mod video_poster;

mod voice_auth;

mod voice_host;

mod voice_stt;

mod voice_tools;

mod wallpaper_source;

mod window_min;

mod skin_catalog;
mod skin_deeplink;
mod skin_disk;
mod skin_image_bake;
mod skin_net;
mod skin_pack;
mod skin_presets;
mod skin_staging;
mod skin_video_bake;

#[cfg(windows)]
mod win_shell;

mod x_evidence;

use std::sync::Arc;

use mirror::MirrorHost;

use session_manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Session list / continue-by-id CLI must not open a window or steal focus
    // via the single-instance plugin. Exit before any Tauri builder setup.
    if session_api::try_run_cli() {
        std::process::exit(session_api::run_cli());
    }

    let _ = paths::ensure_app_dirs();

    logging::init();

    crate::host_runtime::on_process_start();
    crate::win_crash::install();

    let context = tauri::generate_context!();

    // Windows: AppUserModelID before window/taskbar so Show Desktop / jump lists
    // treat us as a normal app (matches NSIS shortcut AUMID / `pnpm dev` overlay).

    #[cfg(windows)]
    win_shell::set_process_app_user_model_id(&context.config().identifier);

    let session_mgr = Arc::new(SessionManager::new());

    let mirror_host = Arc::new(MirrorHost::from_env());

    let voice_host = Arc::new(voice_host::VoiceHost::new());

    let remote_im_state = Arc::new(remote_im::RemoteImState {
        inner: tokio::sync::Mutex::new(remote_im::BridgeRuntime::default()),
    });

    let pending_skin = Arc::new(skin_deeplink::PendingSlot::default());

    // Attach `tauri-plugin-updater` only when release CI injected GROK_UPDATER_*

    // (build.rs → cfg) and this is a non-debug binary. Crate is always linked for ACL.

    fn maybe_register_updater(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        #[cfg(grok_updater_enabled)]
        {
            if !cfg!(debug_assertions) {
                return builder.plugin(tauri_plugin_updater::Builder::new().build());
            }
        }

        builder
    }

    let builder = tauri::Builder::default()
        // Must be registered first so a second process exits and focuses the primary window.
        // One-shot `--fire-due-schedules`: do not steal focus; ask primary to fire once.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Defense in depth: session CLI is handled before the builder.
            // If argv still arrives here, do not focus-steal the primary window.
            if session_api::parse_cli(&argv).is_ok() {
                return;
            }

            let fire_due = argv.iter().any(|a| a == automation_runner::FIRE_DUE_FLAG);

            if fire_due {
                use tauri::Manager;

                if let Some(mgr) = app.try_state::<Arc<SessionManager>>() {
                    let h = app.clone();

                    let m = mgr.inner().clone();

                    tauri::async_runtime::spawn(async move {
                        let outcome = automation_runner::fire_due_once(&h, &m).await;

                        tracing::info!(

                            target: "automation_runner",

                            kind = %outcome.kind,

                            "secondary-instance oneshot relayed to primary"

                        );
                    });
                }

                return;
            }

            let kind = skin_deeplink::ingest_argv_into(app, &argv);
            if kind != skin_deeplink::ArgvIngest::FireDue {
                // Same restore path as tray Open — taskbar + shell styles included.
                tray::show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // Always register process so release builds can relaunch after install.
        .plugin(tauri_plugin_process::init())
        // Native OS notifications (polyfills Web Notification API in the WebView).
        // Without this, WKWebView reports Notification.permission=denied and the app
        // never appears in System Settings → Notifications — desktop alerts stay dead.
        .plugin(tauri_plugin_notification::init())
        // Login-item plugin only; never auto-enable. Enable/disable is driven by
        // AppSettings.launch_at_login in setup + settings_set. Safe for `cargo test`
        // (tests never call run(); init does not touch the OS login list).
        .plugin(tauri_plugin_autostart::Builder::new().build())
        // Remember main window size / position / maximize across launches.
        // Desktop-only dependency (see Cargo.toml target cfg).
        .plugin({
            use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};
            WindowStateBuilder::new()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                // Primary workbench only — secondary `session-*` windows keep defaults.
                .with_filter(|label| label == "main")
                // Do NOT auto-restore on window-ready: that runs deferred on the main
                // thread (after the window is already shown), so the default 1200×800
                // frame flashes first and then snaps to the saved bounds. The main
                // window starts hidden (visible:false in tauri conf) and setup creates
                // it at the saved geometry — see setup below.
                .skip_initial_state("main")
                // Do not restore VISIBLE: close-to-tray leaves the window hidden; a
                // saved `visible:false` would make the next launch appear headless.
                // Do not restore DECORATIONS: macOS Overlay vs Windows frameless
                // come from platform tauri conf, not last-run chrome state.
                .build()
        });

    // Register the updater only in configured release builds; omit it locally.

    // Requires GROK_UPDATER_* env at compile time (build.rs) + non-debug binary.

    let builder = maybe_register_updater(builder);

    builder

        .manage(session_mgr)

        .manage(mirror_host)

        .manage(voice_host)

        .manage(remote_im_state)

        .manage(pending_skin)

        // Range-capable media streaming (video/audio/pdf) — never loads multi‑GB into RAM.

        // Bounded pool + catch_unwind: unbounded spawn + protocol panics have aborted the

        // whole process (SIGABRT / "panic in a function that cannot unwind") when chat

        // fan-out many concurrent Range/image loads (e.g. large session mp4 + QC frames).

        .register_asynchronous_uri_scheme_protocol("media", |_ctx, request, responder| {

            media_protocol::dispatch(request, responder);

        })
        // Side-browser blob:/data: download bridge (ChatCut export etc. — WKWebView
        // does not fire on_download for createObjectURL + <a download>).
        .register_asynchronous_uri_scheme_protocol("sbdl", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let label = ctx.webview_label().to_string();
            side_browser_blob::dispatch_async(app, label, request, responder);
        })

        // Close button / Alt+F4: hide to tray (default) or ask frontend to quit.

        // When close-to-tray is off, prevent default so App can confirm if agents are busy

        // — unless keep_tray_for_schedules is on and any automation is enabled (still tray).

        // Tray "Quit Grok" emits the same event (see tray.rs). Force exit: `app_force_quit`.

        // Close button / Alt+F4 on **main**: hide to tray (default) or ask frontend to quit.

        // Secondary session windows (`session-*`) always close for real — they must not

        // hide the whole app to tray or trigger busy-quit confirm for a view-only pane.

        // Tray "Quit Grok" emits app://close-requested on main (see tray.rs).

        // Force exit: `app_force_quit`.

        .on_menu_event(|app, event| {
            app_menu::handle_menu_event(app, event);
        })
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager, WindowEvent};

            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    // Pet overlay: hide (keep prefs in sync). Do not destroy the HWND
                    // via File>Close — that used to leave the toggle stuck.
                    if window.label() == pet_window::PET_WINDOW_LABEL {
                        api.prevent_close();
                        let _ = pet_window::hide_pet(window.app_handle());
                        return;
                    }
                    // Only the primary workbench owns tray-hide / quit-confirm.
                    // Secondary session windows (`session-*`) close for real.
                    if window.label() != "main" {
                        return;
                    }

                    let settings = store::load_settings();
                    let any_enabled = store::load_automations().iter().any(|a| a.enabled);
                    let hide = automation_runner::should_hide_to_tray_on_close(
                        settings.close_to_tray,
                        settings.keep_tray_for_schedules,
                        any_enabled,
                    );

                    if hide {
                        api.prevent_close();
                        // hide_to_tray persists geometry before hide (plugin only
                        // flushes on Exit by default).
                        tray::hide_to_tray(window.app_handle());
                    } else {
                        // Always prevent_close so FE can confirm when busy — but arm a
                        // host failsafe so a wedged WebView cannot trap the process.
                        api.prevent_close();
                        // Flush latest size before quit-confirm so a kill during the
                        // dialog still restores the resized frame next launch.
                        persist_main_window_state(window.app_handle());
                        let app = window.app_handle().clone();
                        let _ = window.emit("app://close-requested", ());
                        crate::pending_quit::schedule_pending_quit(&app);
                    }
                }
                // Plugin keeps in-memory state on Resized/Moved but only writes disk
                // on process Exit. Debounce-persist so force-quit / crash / tauri-dev
                // restart / OS reboot still remember the last user size.
                WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. }
                    if window.label() == "main" =>
                {
                    window_min::apply_main(window.app_handle());
                    schedule_persist_main_window_state(window.app_handle());
                }
                WindowEvent::Resized(_)
                    if window.label() == "main" => {
                        schedule_persist_main_window_state(window.app_handle());
                    }
                WindowEvent::Focused(focused) if window.label() == "main" => {
                    // Launch first-interaction dead-zone diagnosis: trace every
                    // key-window transition so a lost activation race is visible
                    // in the log (first click / ⌘, eaten = no Focused(true)).
                    tracing::info!("main window focused={focused}");
                }
                _ => {}
            }
        })

        .setup(|app| {

            crate::path_scope::refresh_from_store();

            use tauri::Manager;

            // ── 1) Main window first so the WebView starts loading the UI while
            // host services (media/relay/tray/prewarm) come up in parallel.
            // create:false + baked geometry; never flash default size then snap.
            let saved_geometry = load_restored_main_geometry(app);
            let scale = scale_factor_for_saved(app, saved_geometry.as_ref());
            let on_monitor = saved_geometry
                .as_ref()
                .and_then(|g| saved_on_monitor(app, g));
            let mut main_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or_else(|| "main window config missing".to_string())?;
            main_cfg.visible = false;
            main_cfg.focus = false;
            // Comfort min from JSON, capped so Win+Left/Right can be a true half.
            let comfort_w = main_cfg.min_width.unwrap_or(900.0);
            let comfort_h = main_cfg.min_height.unwrap_or(600.0);
            let snap_mon = on_monitor
                .clone()
                .or_else(|| app.primary_monitor().ok().flatten());
            let (min_w, min_h) =
                window_min::cap_for_monitor(comfort_w, comfort_h, snap_mon.as_ref());
            main_cfg.min_width = Some(min_w);
            main_cfg.min_height = Some(min_h);
            if let Some(g) = &saved_geometry {
                let (mut w, mut h) = (g.width as f64 / scale, g.height as f64 / scale);
                w = w.max(min_w);
                h = h.max(min_h);
                main_cfg.width = w;
                main_cfg.height = h;
                let (px, py) = if g.maximized {
                    (g.prev_x as f64 / scale, g.prev_y as f64 / scale)
                } else {
                    (g.x as f64 / scale, g.y as f64 / scale)
                };
                if on_monitor.is_some() {
                    main_cfg.x = Some(px);
                    main_cfg.y = Some(py);
                    main_cfg.center = false;
                } else {
                    main_cfg.x = None;
                    main_cfg.y = None;
                    main_cfg.center = true;
                }
                main_cfg.maximized = false;
                main_cfg.fullscreen = g.fullscreen;
            } else {
                main_cfg.center = true;
            }
            // Concrete light|dark + locale for boot shell + window chrome.
            let boot_settings = store::load_settings();
            let boot_theme = resolve_boot_theme(&boot_settings.theme);
            let boot_locale = tray_i18n::Locale::parse(&boot_settings.locale);
            let boot_locale_tag = boot_locale.as_tag();
            let boot_os_lang = tray_i18n::detect_os_lang_tag();
            let boot_html_lang = boot_locale.html_lang();
            let boot_theme_script = format!(
                r#"(function(){{try{{Object.defineProperty(window,"__GROK_BOOT_THEME__",{{value:{theme:?},writable:false,configurable:false}});Object.defineProperty(window,"__GROK_BOOT_LOCALE__",{{value:{locale:?},writable:false,configurable:false}});Object.defineProperty(window,"__GROK_BOOT_OS_LANG__",{{value:{os_lang:?},writable:false,configurable:false}});var d=document.documentElement;if(d){{d.setAttribute("data-theme",{theme:?});d.setAttribute("lang",{html_lang:?});}}}}catch(e){{}}}})();"#,
                theme = boot_theme,
                locale = boot_locale_tag,
                os_lang = boot_os_lang,
                html_lang = boot_html_lang
            );
            let window = tauri::WebviewWindowBuilder::from_config(app, &main_cfg)?
                .visible(false)
                .accept_first_mouse(true)
                .initialization_script(&boot_theme_script)
                .on_page_load(|window, payload| {
                    // Cold-launch first-click / first-key dead zone: the
                    // set_focus() right after show() occasionally loses the
                    // activation race, leaving a key window whose app is still
                    // INACTIVE (macOS cooperative activation silently ignores
                    // activateIgnoringOtherApps from a background process — e.g.
                    // dev launched from a terminal). isKeyWindow is then true,
                    // so an is_focused guard would wrongly skip; clicks still
                    // land (accept_first_mouse) but NO key events reach the app
                    // while NSApp is inactive — ⌘, stays dead until one click
                    // activates us. Reassert unconditionally ONCE when the page
                    // has loaded, then repair the residual stuck state (key
                    // window + inactive app) with guarded retries. Note: tao's
                    // set_focus short-circuits while hidden — setup shows the
                    // window synchronously before any page load can finish,
                    // which this reassert relies on.
                    use std::sync::atomic::{AtomicBool, Ordering};
                    static REASSERTED: AtomicBool = AtomicBool::new(false);
                    if payload.event() != tauri::webview::PageLoadEvent::Finished {
                        return;
                    }
                    if REASSERTED.swap(true, Ordering::SeqCst) {
                        return;
                    }
                    let app_active_at_load = ns_app_is_active();
                    tracing::info!(
                        focused_at_load = window.is_focused().unwrap_or(false),
                        app_active_at_load,
                        "main page loaded — reasserting launch focus/activation"
                    );
                    let _ = window.set_focus();
                    {
                        let w = window.clone();
                        let _ = window.run_on_main_thread(move || {
                            point_keys_at_webview(&w);
                        });
                    }
                    if !app_active_at_load && cfg!(target_os = "macos") {
                        // Repair loop for the pathological state: the window
                        // claims key while NSApp is inactive (cooperative
                        // activation denied/raced). Retry a few times over ~2s.
                        // Guard: if the user deliberately switched away, our
                        // window loses key → bail instead of yanking them back;
                        // once active, stop immediately.
                        let w = window.clone();
                        tauri::async_runtime::spawn(async move {
                            for attempt in 1..=8u8 {
                                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                                if ns_app_is_active() {
                                    return;
                                }
                                if !w.is_focused().unwrap_or(false) {
                                    tracing::info!(
                                        attempt,
                                        "launch activation repair: window lost key (user moved on or pet briefly keyed)"
                                    );
                                    return;
                                }
                                tracing::info!(attempt, "repairing launch activation (key window + inactive app)");
                                let _ = w.set_focus();
                                let wr = w.clone();
                                let _ = w.run_on_main_thread(move || {
                                    point_keys_at_webview(&wr);
                                });
                            }
                            tracing::warn!("launch activation repair gave up; first click will activate");
                        });
                    }
                })
                .build()?;
            #[cfg(debug_assertions)]
            {
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/dev/icon.png"))
                {
                    if let Err(e) = window.set_icon(icon) {
                        tracing::warn!("debug white icon: {e}");
                    }
                }
            }
            window_min::apply_main(window.app_handle());

            #[cfg(target_os = "macos")]
            {
                // Transparent for vibrancy; CSS / boot shell paints the surface.
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
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

            #[cfg(not(target_os = "macos"))]
            {
                // Match tokens --bg-app (dark #0d0d0d / light #f4f4f6).
                let (r, g, b) = if boot_theme == "light" {
                    (244, 244, 246)
                } else {
                    (13, 13, 13)
                };
                let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
            }

            // Lock WebView / native form chrome to the boot theme on every OS.
            // Windows WebView2 otherwise follows the OS scheme, so number/date/time
            // inputs paint as black boxes on a light Settings page (Agent tab).
            // Live follow-system on Windows is os_theme::watch → frontend — this
            // lock freezes prefers-color-scheme inside WebView2.
            let _ = window.set_theme(Some(if boot_theme == "light" {
                tauri::Theme::Light
            } else {
                tauri::Theme::Dark
            }));

            #[cfg(windows)]
            win_shell::ensure_main_window_shell_integration(&window);

            let want_maximized = saved_geometry
                .as_ref()
                .map(|g| g.maximized)
                .unwrap_or(false);
            if want_maximized {
                // Maximize is async on macOS — one main-loop tick while hidden so
                // the first visible frame is already full-size.
                let _ = window.maximize();
                let w = window.clone();
                let _ = window.run_on_main_thread(move || {
                    let _ = w.show();
                    let _ = w.set_focus();
                });
            } else {
                // Show immediately — do not block_on host services first (that
                // freezes the main loop and delays WebView paint).
                let _ = window.show();
                let _ = window.set_focus();
            }

            // ── 2) Non-UI host work off the critical path (WebView already open).

            // Editors / terminals / git GUIs: non-blocking background scan + cache.
            editors::start_background_scan_on_launch(app.handle().clone());

            // Media HTTP + relay proxy: never block setup/show. Frontend uses
            // try_state / soft-fail until ready (ensureMediaEndpoint retries).
            {
                let handle = app.handle().clone();
                let session_mgr = app.state::<Arc<SessionManager>>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    match media_server::start().await {
                        Ok(h) => {
                            tracing::info!(
                                base_url = %h.endpoint.base_url,
                                "media server ready"
                            );
                            handle.manage(h);
                        }
                        Err(e) => {
                            tracing::error!(
                                error = %e,
                                "media server failed to start — local media previews may break"
                            );
                        }
                    }
                    match session_api::start(handle.clone(), session_mgr).await {
                        Ok(h) => {
                            tracing::info!(url = %h.url, "session api ready");
                            handle.manage(h);
                        }
                        Err(e) => {
                            tracing::error!(
                                error = %e,
                                "session api failed to start — external list/send is unavailable"
                            );
                        }
                    }
                    if let Err(e) = relay_stream_proxy::ensure_started().await {
                        tracing::warn!(error = %e, "relay stream proxy failed to start");
                    }
                    // Repair does sync FS I/O + ensure_started_blocking. After
                    // ensure_started().await the port fast-path avoids nested
                    // block_on on this worker; spawn_blocking also keeps FS off
                    // the async pool.
                    match tauri::async_runtime::spawn_blocking(
                        relay_stream_proxy::repair_sanitize_proxy_bases,
                    )
                    .await
                    {
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => {
                            tracing::warn!(
                                error = %e,
                                "relay stream proxy base_url repair failed"
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                "relay stream proxy base_url repair join failed"
                            );
                        }
                    }
                });
            }

            // App menu: own ⌘W / Ctrl+W so FE can close side tabs before the window.
            // Replaces Tauri's default PredefinedMenuItem::close_window binding.
            if let Err(e) = app_menu::install(app.handle()) {
                tracing::warn!("app menu setup: {e}");
            }

            // Menu-bar / system tray — logo.svg tray icon (not dock app icon)
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("tray setup: {e}");
            }

            // Windows: AppsUseLightTheme → frontend (WebView2 matchMedia stays frozen).
            os_theme::watch(app.handle());

            // Cold-start argv: grok:// or *.grokskin → pending. Never steal fire-due.
            if !automation_runner::wants_fire_due_schedules() {
                let args: Vec<String> = std::env::args().collect();
                skin_deeplink::ingest_argv_into(app.handle(), &args);
            }

            // Plugin URL + Apple Event must honor fire-due the same as argv:
            // no pending, no emit, no window focus.
            if !automation_runner::wants_fire_due_schedules() {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                match app.deep_link().get_current() {
                    Ok(Some(urls)) => {
                        for u in urls {
                            skin_deeplink::ingest_uri_string(&handle, u.as_str());
                        }
                    }
                    Ok(None) => {}
                    Err(e) => tracing::debug!(target: "skin_deeplink", "get_current: {e}"),
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if automation_runner::wants_fire_due_schedules() {
                        return;
                    }
                    for u in event.urls() {
                        skin_deeplink::ingest_uri_string(&handle, u.as_str());
                    }
                });
            }

            // macOS: pin notification delivery to com.grokapp.desktop and request
            // UNUserNotificationCenter auth so Grok appears in System Settings.
            desktop_notify::request_permission_on_startup();

            // I03: recycle idle agent processes; session metadata stays on disk.
            // I06: surface cancel UI when a stream is pure-silent for too long.
            {
                use tauri::Manager;

                let mgr = app.state::<Arc<SessionManager>>().inner().clone();

                mgr.start_idle_watchdog(app.handle().clone());

                mgr.start_stream_stall_watchdog(app.handle().clone());

                // Prewarm competes with frontend probeCli (`grok --version`) if
                // both spawn at t=0. Delay so first paint + gate probe win.
                {
                    let mgr = Arc::clone(&mgr);
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
                        mgr.prewarm(app_handle).await;
                    });
                }

                // Scheduled automations: host tick works while window is in tray
                // (and with --start-in-tray / keep_tray_for_schedules). No daemon.
                // One-shot `--fire-due-schedules`: fire at most one due task then exit
                // (honest helper — not KeepAlive continuous daemon).
                if automation_runner::wants_fire_due_schedules() {
                    automation_runner::start_oneshot(app.handle().clone(), mgr);
                } else {
                    automation_runner::start(app.handle().clone(), mgr);
                }
            }

            // LaunchAgent / helper / oneshot: open into tray so schedules fire without focus steal.

            if schedules_launch_agent::wants_start_in_tray()

                || automation_runner::wants_fire_due_schedules()

            {

                tray::hide_to_tray_accessory(app.handle());

            }

            // Remote IM: restore Feishu/Weixin connectors after App restart so
            // already-bound channels keep receiving messages without a manual Start.
            // Defer a short beat so the main window can paint / frontend hydrate first
            // (Weixin long-poll + Feishu WS connect can log for a long time otherwise
            // and looks like a hang on the last "ilink long-poll starting" line).
            {
                use tauri::Manager;

                remote_im::set_app_handle(app.handle().clone());

                let rim = app.state::<Arc<remote_im::RemoteImState>>().inner().clone();

                let rim_watch = rim.clone();

                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    tracing::info!("remote_im: deferred autostart begin");
                    remote_im::try_autostart(&rim).await;
                    tracing::info!("remote_im: deferred autostart finished");
                });

                // Crash / exit recovery while bridge stays enabled.
                remote_im::start_health_watchdog(rim_watch);
            }

            // Headless mirror auto-start (GROK_MIRROR_HEADLESS=1) — off by default.

            {

                use tauri::Manager;

                let host = app.state::<Arc<MirrorHost>>().inner().clone();

                let mgr = app.state::<Arc<SessionManager>>().inner().clone();

                mirror::maybe_autostart(host, app.handle().clone(), mgr);

            }

            // Re-apply OS login item from AppSettings (default off). Does not enable

            // unless the user opted in; repairs drift if the OS entry was removed.

            {

                use tauri_plugin_autostart::ManagerExt;

                let want = store::load_settings().launch_at_login;

                let autolaunch = app.autolaunch();

                match autolaunch.is_enabled() {

                    Ok(on) if on != want => {

                        let res = if want {

                            autolaunch.enable()

                        } else {

                            autolaunch.disable()

                        };

                        if let Err(e) = res {

                            tracing::warn!("launch-at-login sync: {e}");

                        }

                    }

                    Ok(_) => {}

                    Err(e) => tracing::warn!("launch-at-login is_enabled: {e}"),

                }

            }

            let pet_prefs = pet_window::load_prefs();
            if pet_prefs.enabled && pet_prefs.visible {
                if let Err(e) = pet_window::show_pet(app.handle()) {
                    tracing::warn!("pet restore: {e}");
                }
            }

            Ok(())

        })

        .invoke_handler(tauri::generate_handler![

            commands::session_get_state,

            commands::session_connect,

            commands::session_prewarm,

            commands::session_send,

            session_api::session_api_status,

            session_api::session_api_reveal_token_file,

            session_api::session_api_install_cli,

            session_api::session_api_remove_cli,

            session_api::session_api_reveal_cli_link,

            commands::session_interject,

            commands::session_stop,

            commands::session_disconnect,

            commands::session_reattach,

            commands::session_resolve_permission,
            commands::session_pending_permission,

            commands::session_resolve_plan,

            commands::session_plan_chrome_get,

            commands::session_plan_chrome_set,

            commands::session_agent_plan_snapshot,

            commands::session_resolve_ask_user,

            commands::probe_cli,

            commands::wsl_status,

            ssh_remote::ssh_list_hosts,

            ssh_remote::ssh_test_host,

            ssh_remote::ssh_watch_start,

            ssh_remote::ssh_watch_stop,

            ssh_remote::ssh_list_dir,
            ssh_remote::ssh_read_file,
            ssh_remote::ssh_write_file,

            ssh_remote::ssh_list_sessions,
            ssh_remote::ssh_open_session,
            ssh_remote::ssh_delete_sessions,
            ssh_remote::ssh_browser_prepare,

            commands::cli_repair_agent_sidecar,

            commands::acp_test_connection,

            commands::acp_server_probe,

            commands::cli_install_latest,

            commands::cli_install_commands,

            commands::cli_update_check,

            commands::cli_update_install,

            commands::pick_cli_binary,

            commands::pick_agent_profile,

            commands::open_external_url,

            commands::app_check_update,

            updater::is_auto_update_supported,

            updater::is_updater_plugin_enabled,

            updater::updater_status,

            updater::prepare_for_app_update,

            commands::voice_status,

            commands::voice_transcribe,

            commands::projects_list,

            commands::general_workspace_path,

            commands::project_add,

            commands::project_add_ssh,

            commands::project_add_dialog,

            commands::project_remove,

            commands::project_relocate,

            commands::project_trust,

            commands::project_set_permission_policy,

            commands::project_set_sandbox_profile,

            commands::project_rename,

            commands::project_set_pinned,

            commands::projects_reorder,

            commands::project_set_color,

            commands::project_reveal,

            commands::project_rules_list,

            commands::project_rules_ensure_template,

            commands::project_archive_sessions,

            commands::sessions_list,

            commands::sessions_search,

            commands::cli_sessions_list,

            commands::cli_sessions_search,

            commands::cli_session_import,

            commands::cli_sessions_import_all,

            commands::cli_sessions_delete,

            commands::cli_session_find_latest_for_cwd,

            commands::cli_session_continue_cwd,

            commands::session_create,

            commands::open_session_window,

            theme_editor_window::open_theme_editor_window,

            commands::focus_main_window,

            commands::session_delete,

            commands::session_rename,

            commands::session_set_archived,

            commands::session_set_pinned,

            commands::session_set_worktree,

            commands::session_set_json_schema,

            commands::session_set_project,

            commands::session_move_to_project,

            commands::session_set_plugin_dirs,

            commands::session_set_extra_rules,

            commands::session_set_max_agent_turns,

            commands::session_set_system_prompt_override,

            commands::session_set_no_ask_user,

            commands::session_set_fork_agent_session,

            commands::session_set_scheduled,

            commands::session_messages,

            commands::session_interrupt_context,

            commands::session_media_root,

            commands::session_resolve_relative_media,

            commands::media_server_endpoint,

            commands::media_file_info,

            commands::media_read_file_chunk,

            commands::settings_get,

            commands::store_take_quarantine,

            commands::settings_set,

            commands::memory_clear,

            commands::memory_list,

            commands::memory_delete_file,

            commands::agent_config_toml_read,

            commands::memory_search,

            commands::memory_embed_config_get,

            commands::memory_embed_config_set,

            commands::settings_remember_last_session,

            commands::models_list_available,

            commands::agents_catalog,

            commands::composer_prefs_resolve,

            commands::composer_prefs_set,

            commands::session_set_policy,

            commands::permission_rules_get,

            commands::permission_rules_set,

            commands::agent_config_edit_get,

            commands::agent_config_edit_set,

            commands::privacy_config_get,

            commands::privacy_config_set,

            commands::codebase_indexing_get,

            commands::codebase_indexing_set,

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

            commands::network_probe,

            commands::probe_streaming_acp_ndjson,

            commands::agents_recycle_all,

            commands::cli_doctor_fix,

            commands::export_support_bundle,

            commands::process_budget_snapshot,

            commands::audit_ledger_list,

            commands::audit_ledger_clear,

            commands::audit_ledger_prune,

            commands::audit_ledger_export,

            commands::export_session_bundle,

            commands::session_cli_export,

            commands::export_bytes_save,

            commands::session_trace_export,

            commands::reset_app_data,

            commands::skills_list,

            commands::skills_compat_set,

            commands::skill_read,

            commands::skill_write,

            commands::skill_roots,

            commands::skill_create,

            commands::agents_list,

            commands::workflows_list,

            commands::workflows_run,

            commands::workflows_create,

            commands::agents_scaffold,

            commands::inspect_mcp,

            commands::project_inspect,

            commands::extensions_get,

            commands::extensions_set_mcp,

            commands::extensions_set_skill,

            commands::extensions_enable_all_mcp,

            commands::extensions_enable_all_skills,

            commands::mcp_add,
            commands::mcp_oauth_start,
            commands::mcp_oauth_status,

            commands::mcp_remove,

            commands::mcp_doctor,

            commands::plugins_list,

            commands::plugin_enable,

            commands::plugin_disable,

            commands::plugin_uninstall,

            commands::plugin_details,

            commands::plugin_install,

            commands::plugin_update,

            commands::plugin_validate,

            commands::hooks_list,

            commands::hooks_reveal,

            commands::hooks_open_dir,

            commands::hooks_ensure_dir,

            commands::hooks_try_run,

            commands::setup_preview,

            commands::setup_install,

            commands::managed_setup_status,

            commands::marketplace_list,

            commands::marketplace_available,

            commands::marketplace_plugin_meta_index,

            commands::marketplace_add,

            commands::marketplace_remove,

            commands::marketplace_update,

            leader::leader_status,

            leader::leader_list,

            leader::leader_info,

            leader::leader_start,

            leader::leader_stop,

            leader::leader_kill_all,

            serve::serve_status,

            serve::serve_start,

            serve::serve_stop,

            serve::serve_tcp_probe,

            commands::pick_directory,

            commands::pick_attach_files,

            commands::pick_attach_folder,

            commands::save_temp_attachment,

            commands::clipboard_paste_image,

            commands::clipboard_file_paths,

            commands::clipboard_write_image_path,

            commands::clipboard_write_image,

            commands::paths_classify,

            commands::path_open,

            commands::path_reveal,

            commands::media_video_poster,

            commands::media_video_poster_save,

            commands::media_image_thumb,

            commands::git_file_diff,

            commands::git_status,

            commands::git_review_bundle,

            commands::git_worktrees_list,

            commands::git_worktree_add,

            commands::git_worktree_remove,

            commands::git_worktree_gc,

            commands::git_worktree_compare,

            commands::git_push_branch,

            commands::gh_pr_create,

            git_pr_hub::git_pr_list,

            git_pr_hub::git_pr_view,

            git_pr_hub::git_pr_checks,

            git_pr_hub::git_pr_comments,

            cli_worktrees::cli_worktrees_list,

            cli_worktrees::cli_worktree_db_path,

            cli_worktrees::cli_worktree_db_stats,

            cli_worktrees::cli_worktree_db_rebuild,

            commands::git_show_file,

            commands::apply_file_patch,

            commands::git_checkout_file,

            commands::delete_project_file,

            commands::fs_list_dir,

            commands::project_codebase_search,

            commands::fs_read_file,

            commands::fs_write_file,

            commands::fs_write_absolute,

            tray::tray_refresh,

            tray::tray_set_busy_count,

            tray::tray_set_windows_overlay,

            os_theme::os_theme_current,

            system_fonts::list_system_font_families,

            desktop_notify::desktop_notify_show,

            desktop_notify::desktop_notify_available,

            commands::app_force_quit,
            commands::app_cancel_pending_quit,

            commands::fs_read_absolute,

            commands::fs_open_path,

            commands::fs_resolve_path,

            commands::session_auto_title,

            commands::automations_list,

            commands::automation_create,

            commands::automation_update,

            commands::automation_set_enabled,

            commands::automation_mark_run,

            commands::automation_delete,

            commands::automation_runner_status,

            commands::schedules_launch_agent_status,

            commands::schedules_launch_agent_set_enabled,

            commands::schedules_launch_agent_reveal_helper,

            commands::account_status,

            commands::account_login,

            commands::account_login_cancel,
            commands::account_login_submit_code,

            commands::account_logout,

            commands::account_open_usage,

            commands::account_open_subscribe,

            commands::accounts_list,

            commands::accounts_quota,

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

            commands::providers_test_model,

            commands::providers_balance,

            commands::providers_cc_switch_scan,

            commands::providers_cc_switch_import,

            commands::models_aux_get,

            commands::models_aux_set,

            commands::models_aux_apply_save_grok,

            commands::models_aux_reset_defaults,

            commands::models_aux_headless,

            commands::models_aux_web_search,

            commands::official_aux_status,

            commands::official_aux_ensure_home,

            commands::official_aux_dispatch,

            commands::official_aux_web_search,

            commands::official_aux_x_keyword_search,

            commands::official_aux_x_semantic_search,

            commands::official_aux_x_user_search,

            commands::official_aux_x_thread_fetch,

            commands::official_aux_vision_describe,

            commands::editors_list,

            commands::open_in_editor,

            mirror::mirror_status,

            mirror::mirror_rotate_token,

            mirror::mirror_set_read_only,

            mirror::mirror_set_max_clients,

            mirror::mirror_set_allow_lan,

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

            commands::wallpaper_x_search,

            commands::wallpaper_fetch_media,

            commands::wallpaper_imagine,

            commands::wallpaper_library_list,

            commands::wallpaper_library_delete,

            commands::skin_pick_open,
            commands::skin_pick_save,
            commands::skin_pack_inspect,
            commands::skin_inspect_abort,
            commands::skin_pack_export,
            commands::skin_staging_begin,
            commands::skin_staging_append,
            commands::skin_staging_abort,
            commands::skin_preset_list,
            commands::skin_preset_save_from_upload,
            commands::skin_preset_save_from_inspect,
            commands::skin_preset_materialize,
            commands::skin_preset_delete,
            commands::skin_preset_rename,
            commands::skin_preset_replace_from_upload,
            commands::skin_preset_export,
            commands::skin_undo_prepare,
            commands::skin_undo_append,
            commands::skin_undo_commit,
            commands::skin_undo_abort,
            commands::skin_catalog_fetch,
            commands::skin_catalog_download,
            commands::skin_catalog_preview_path,
            commands::skin_sources_list,
            commands::skin_sources_add,
            commands::skin_sources_remove,
            commands::skin_sources_set_enabled,
            commands::skin_import_take_pending,
            commands::skin_pack_fetch_url,

            commands::streaming_messages_json_probe,

            commands::batch_agents_headless,

            commands::x_evidence_search,

            commands::x_evidence_list,

            commands::x_evidence_get,

            commands::x_evidence_stats,

            commands::x_quote_pack,

            commands::path_exists_many,

            commands::terminal_pty_spawn,

            commands::terminal_pty_write,

            commands::terminal_pty_resize,

            commands::terminal_pty_kill,

            commands::side_browser_create,

            commands::side_browser_close,

            commands::side_browser_list,

            commands::side_browser_navigate,

            commands::side_browser_reload,

            commands::side_browser_url,

            commands::side_browser_eval,

            commands::side_browser_snapshot,

            commands::side_browser_install_download_hook,

            pet_window::pet_prefs_get,
            pet_window::pet_prefs_set,
            pet_window::pet_show,
            pet_window::pet_hide,
            pet_window::pet_toggle,
            pet_window::pet_is_visible,
            pet_window::pet_set_ignore_cursor,
            pet_window::pet_set_dragging,
            pet_window::pet_nudge,
            pet_window::pet_set_menu_open,
            pet_window::pet_webview_ready,
            pet_window::pet_overlay_policy,
            pet_window::pet_push_focus,
            pet_window::pet_get_focus,
            pet_window::pet_open_settings,
            pet_window::pet_focus_session,
            pet_window::pet_show_main,
            pet_window::pet_hide_main,
            pet_window::pet_push_tasks,
            pet_window::pet_get_tasks,
            pet_window::pet_set_hit_chrome,

        ])

        .build(context)

        .expect("error while building Grok App")

        .run(|app, event| {

            // macOS: Dock click. The pet overlay is a visible skip-taskbar
            // window, so `has_visible_windows` stays true and must not block
            // bringing the workbench back.

            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = &event {
                    if !automation_runner::wants_fire_due_schedules() {
                        for url in urls {
                            skin_deeplink::ingest_opened_url(app, url);
                        }
                        tray::show_main_window(app);
                    }
                }
                if let tauri::RunEvent::Reopen { .. } = event {
                    tray::show_main_window(app);
                }
            }

            // Full exit (tray Quit / Cmd+Q): tear down mirror host + cloudflared group.

            if let tauri::RunEvent::Exit = event {

                use tauri::Manager;

                pet_window::persist_pet_window_pos(app);

                crate::host_runtime::on_process_shutdown();

                if let Some(host) = app.try_state::<Arc<MirrorHost>>() {

                    host.inner().stop_sync();

                }

            }

            let _ = (app, &event);

        });
}

/// NSApp activation state. Key events only reach the web while the app is
/// ACTIVE; a key window on an inactive app is the launch dead-zone pathology
/// (macOS cooperative activation silently denies background self-activation).
#[cfg(target_os = "macos")]
fn ns_app_is_active() -> bool {
    use objc2::{class, msg_send, runtime::AnyObject};
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return false;
        }
        msg_send![app, isActive]
    }
}

#[cfg(not(target_os = "macos"))]
fn ns_app_is_active() -> bool {
    true
}

/// Point the key window's first responder at the WKWebView so key events reach
/// the DOM (web shortcuts like ⌘,). `makeKeyAndOrderFront` alone can leave the
/// NSWindow itself as initial first responder: app ACTIVE + window key, yet
/// every keystroke dies in the responder chain until one click focuses the
/// web view. Idempotent; logs when it had to re-point.
#[cfg(target_os = "macos")]
fn point_keys_at_webview(win: &tauri::WebviewWindow) {
    use objc2::{class, msg_send, runtime::AnyObject};
    let (Ok(ns_win), Ok(ns_view)) = (win.ns_window(), win.ns_view()) else {
        return;
    };
    unsafe {
        let ns_win = ns_win as *mut AnyObject;
        let ns_view = ns_view as *mut AnyObject;
        let resp: *mut AnyObject = msg_send![ns_win, firstResponder];
        let resp_is_webview: bool = msg_send![resp, isKindOfClass: class!(WKWebView)];
        if !resp_is_webview {
            tracing::info!("main first responder is not the webview — re-pointing keys at DOM");
            let _: () = msg_send![ns_win, makeFirstResponder: ns_view];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn point_keys_at_webview(_win: &tauri::WebviewWindow) {}

/// Resolve AppSettings.theme (`system` | `light` | `dark`) to a concrete
/// boot theme for the static shell and native chrome before React loads.
fn resolve_boot_theme(pref: &str) -> &'static str {
    match pref.trim().to_ascii_lowercase().as_str() {
        "light" => "light",
        "dark" => "dark",
        // system / empty / unknown
        _ => {
            if os_theme::os_prefers_dark() {
                "dark"
            } else {
                "light"
            }
        }
    }
}

/// Flags we persist for the primary workbench (must match plugin builder).
fn main_window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

/// Immediately write main-window geometry to `.window-state.json`.
fn persist_main_window_state(app: &tauri::AppHandle) {
    use tauri_plugin_window_state::AppHandleExt;
    if let Err(e) = app.save_window_state(main_window_state_flags()) {
        tracing::debug!(error = %e, "window-state save failed");
    }
}

/// Debounced disk flush after resize/move (coalesces rapid drag events).
fn schedule_persist_main_window_state(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicU64, Ordering};

    static GENERATION: AtomicU64 = AtomicU64::new(0);
    let gen = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if GENERATION.load(Ordering::Relaxed) != gen {
            return;
        }
        // macOS deadlock guard (#735): save_window_state holds the plugin's
        // cache mutex while querying window geometry. Off the main thread the
        // getters block on the main thread, which may itself be waiting on
        // that mutex inside the plugin's Resized handler. Hop back first.
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || persist_main_window_state(&app2));
    });
}

/// Saved main-window bounds from the window-state plugin's file (physical px).
struct RestoredMainGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    /// Position before maximize (plugin uses this when restoring a maximized window).
    prev_x: i32,
    prev_y: i32,
    maximized: bool,
    fullscreen: bool,
}

/// Read the saved main-window geometry written by tauri-plugin-window-state.
/// Returns None on first launch or when the file is missing/unparseable.
fn load_restored_main_geometry(app: &tauri::App) -> Option<RestoredMainGeometry> {
    use tauri::Manager;
    let bytes = std::fs::read(app.path().app_config_dir().ok()?.join(".window-state.json")).ok()?;
    let root: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let m = root.get("main")?;
    let width = m.get("width")?.as_u64()? as u32;
    let height = m.get("height")?.as_u64()? as u32;
    if width == 0 || height == 0 {
        return None;
    }
    let x = m.get("x")?.as_i64()? as i32;
    let y = m.get("y")?.as_i64()? as i32;
    Some(RestoredMainGeometry {
        width,
        height,
        x,
        y,
        prev_x: m
            .get("prev_x")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(x),
        prev_y: m
            .get("prev_y")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
            .unwrap_or(y),
        maximized: m
            .get("maximized")
            .and_then(|b| b.as_bool())
            .unwrap_or(false),
        fullscreen: m
            .get("fullscreen")
            .and_then(|b| b.as_bool())
            .unwrap_or(false),
    })
}

/// The monitor intersecting the saved bounds, if any — mirrors the plugin's
/// monitor-intersection guard so a disconnected display cannot strand the
/// window off-screen.
fn saved_on_monitor(app: &tauri::App, g: &RestoredMainGeometry) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    monitors.into_iter().find(|m| {
        let p = m.position();
        let s = m.size();
        let (left, top) = (p.x, p.y);
        let (right, bottom) = (p.x + s.width as i32, p.y + s.height as i32);
        [
            (g.x, g.y),
            (g.x + g.width as i32, g.y),
            (g.x, g.y + g.height as i32),
            (g.x + g.width as i32, g.y + g.height as i32),
        ]
        .into_iter()
        .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
    })
}

/// Scale factor to convert saved physical bounds into the logical pixels the
/// window builder expects — prefers the monitor the window will land on.
fn scale_factor_for_saved(app: &tauri::App, g: Option<&RestoredMainGeometry>) -> f64 {
    if let Some(g) = g {
        if let Some(m) = saved_on_monitor(app, g) {
            return m.scale_factor();
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0)
}
