//! Desktop auto-update helpers (Tauri updater plugin + process relaunch).
//!
//! Runtime registration only when release CI injects `GROK_UPDATER_PUBLIC_KEY` +
//! `GROK_UPDATER_ENDPOINT` (`build.rs` → `cfg(grok_updater_enabled)`) on a
//! non-debug binary. The crate itself is always a hard dependency so Tauri ACL
//! can resolve `updater:allow-*` permissions at build time.
//!
//! Local / unsigned builds keep the manual GitHub path via the frontend state
//! machine (`app_check_update`).
//!
//! ## Teardown ordering (P0)
//!
//! Call [`prepare_for_app_update`] **only after** `update.install()` succeeds and
//! **before** `relaunch()`. If install fails, children must stay alive — there is
//! no in-process recovery for recycled agents / stopped IM / mirror.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, State};
use tracing::info;

use crate::mirror::MirrorHost;
use crate::remote_im::RemoteImState;
use crate::session_manager::SessionManager;
use crate::voice_host::VoiceHost;

/// Process-wide guard so prepare-for-update does not race with itself.
///
/// Only set after a successful install path begins teardown. Not reset on
/// failure because prepare is no longer called before install (see module docs).
static UPDATE_SHUTDOWN_DONE: AtomicBool = AtomicBool::new(false);

/// Returns `true` when the running install supports Tauri's auto-updater.
///
/// On Linux, Tauri's updater only works for AppImage bundles. The AppImage
/// runtime sets `APPIMAGE` when the binary is executed from an AppImage.
/// `.deb` / `.rpm` packages surface a manual-download path instead.
///
/// On macOS and Windows every supported install format is auto-updatable.
#[tauri::command]
pub fn is_auto_update_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var("APPIMAGE").is_ok()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// True when this binary was built with pubkey + endpoint injected
/// (`GROK_UPDATER_*` at compile time) and is not a debug build.
#[tauri::command]
pub fn is_updater_plugin_enabled() -> bool {
    cfg!(grok_updater_enabled) && !cfg!(debug_assertions)
}

/// Stop managed agent children / hosts before process relaunch after a staged install.
///
/// Must run **after** a successful `update.install()` and **before** `relaunch()`
/// so a failed install never leaves the app without agents / IM / mirror.
///
/// `remote_im.inner` is held only for the duration of `stop_async`. That method
/// uses a separate global `runtime_slot` mutex (not `remote_im.inner`) and
/// parking_lot fields on `BridgeRuntime` — audited: no re-lock of `inner`.
#[tauri::command]
pub async fn prepare_for_app_update(
    app: AppHandle,
    mgr: State<'_, Arc<SessionManager>>,
    mirror: State<'_, Arc<MirrorHost>>,
    voice: State<'_, Arc<VoiceHost>>,
    remote_im: State<'_, Arc<RemoteImState>>,
) -> Result<(), String> {
    if UPDATE_SHUTDOWN_DONE.swap(true, Ordering::SeqCst) {
        info!(target: "grok_app::updater", "prepare_for_app_update already completed");
        return Ok(());
    }

    info!(target: "grok_app::updater", "stopping managed processes before app relaunch");

    // Voice realtime session first (network + tool delegation).
    let _ = voice.stop(&app).await;

    // Remote IM connectors (Feishu / Weixin / …).
    // Hold `inner` only while stop_async runs; stop_async does not re-enter `inner`.
    {
        let mut rt = remote_im.inner.lock().await;
        if let Err(e) = rt.stop_async().await {
            tracing::warn!(target: "grok_app::updater", error = %e, "remote_im stop during prepare_for_app_update");
        }
    }

    // Kill live + background ACP agent processes; session metadata stays on disk.
    mgr.recycle_all_agents(&app, "app_update").await;

    // Mirror HTTP host + cloudflared tunnel.
    mirror.stop_sync();

    info!(target: "grok_app::updater", "managed processes stopped; safe to relaunch");
    Ok(())
}

/// Reset guard — only for tests.
#[cfg(test)]
pub fn reset_update_shutdown_guard_for_tests() {
    UPDATE_SHUTDOWN_DONE.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_update_supported_is_bool() {
        let _ = is_auto_update_supported();
        assert!(!is_updater_plugin_enabled() || cfg!(grok_updater_enabled));
    }

    #[test]
    fn plugin_enabled_false_in_debug_without_cfg() {
        if cfg!(debug_assertions) {
            assert!(!is_updater_plugin_enabled());
        }
    }

    #[test]
    fn shutdown_guard_is_idempotent_flag() {
        reset_update_shutdown_guard_for_tests();
        assert!(!UPDATE_SHUTDOWN_DONE.load(Ordering::SeqCst));
        UPDATE_SHUTDOWN_DONE.store(true, Ordering::SeqCst);
        assert!(UPDATE_SHUTDOWN_DONE.load(Ordering::SeqCst));
        reset_update_shutdown_guard_for_tests();
    }
}
