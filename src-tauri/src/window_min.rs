//! Main-window OS min size vs tiling.
//!
//! Config `minWidth` / `minHeight` are a comfort floor. Aero Snap, Win+arrows,
//! and tiling WMs refuse to size below `WM_GETMINMAXINFO` / the Tauri min, so a
//! 900px floor on a 1440-wide work area becomes ~2/3 of the screen. Cap the OS
//! min to half the current monitor work area (taskbar excluded). Large
//! displays keep 900×600; moving onto a bigger screen restores that floor.

use tauri::{AppHandle, LogicalSize, Manager, Monitor};

/// Comfort fallback when the window config omits min size.
const FALLBACK_MIN_W: f64 = 900.0;
const FALLBACK_MIN_H: f64 = 600.0;

/// Cap one axis: never larger than half of `work` (floored so min ≤ true half).
pub fn snap_friendly_min(comfort: f64, work: f64) -> f64 {
    let comfort = if comfort.is_finite() && comfort > 0.0 {
        comfort
    } else {
        1.0
    };
    if !work.is_finite() || work <= 0.0 {
        return comfort;
    }
    let half = (work / 2.0).floor();
    if half <= 0.0 {
        return comfort;
    }
    comfort.min(half)
}

pub fn snap_friendly_min_size(
    comfort_w: f64,
    comfort_h: f64,
    work_w: f64,
    work_h: f64,
) -> (f64, f64) {
    (
        snap_friendly_min(comfort_w, work_w),
        snap_friendly_min(comfort_h, work_h),
    )
}

/// Logical work-area size (taskbar excluded), matching OS snap.
pub fn work_logical(monitor: &Monitor) -> (f64, f64) {
    let scale = monitor.scale_factor().max(0.1);
    let s = monitor.work_area().size;
    (f64::from(s.width) / scale, f64::from(s.height) / scale)
}

pub fn cap_for_monitor(comfort_w: f64, comfort_h: f64, monitor: Option<&Monitor>) -> (f64, f64) {
    match monitor {
        Some(m) => {
            let (ww, wh) = work_logical(m);
            snap_friendly_min_size(comfort_w, comfort_h, ww, wh)
        }
        None => (
            snap_friendly_min(comfort_w, f64::INFINITY),
            snap_friendly_min(comfort_h, f64::INFINITY),
        ),
    }
}

fn comfort_from_config(app: &AppHandle) -> (f64, f64) {
    let w = app.config().app.windows.iter().find(|w| w.label == "main");
    (
        w.and_then(|c| c.min_width)
            .filter(|v| v.is_finite() && *v > 0.0)
            .unwrap_or(FALLBACK_MIN_W),
        w.and_then(|c| c.min_height)
            .filter(|v| v.is_finite() && *v > 0.0)
            .unwrap_or(FALLBACK_MIN_H),
    )
}

/// Recompute OS min from the main window's current monitor.
pub fn apply_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (cw, ch) = comfort_from_config(app);
    let monitor = window.current_monitor().ok().flatten();
    let (min_w, min_h) = cap_for_monitor(cw, ch, monitor.as_ref());
    let _ = window.set_min_size(Some(LogicalSize::new(min_w, min_h)));
}

#[cfg(test)]
mod tests {
    use super::{snap_friendly_min, snap_friendly_min_size};

    #[test]
    fn half_of_1440_beats_comfort_900() {
        // 1440×900 @ 100%, work 1440×852. Win+Right half = 720.
        assert_eq!(snap_friendly_min(900.0, 1440.0), 720.0);
        assert_eq!(snap_friendly_min(600.0, 852.0), 426.0);
    }

    #[test]
    fn large_display_keeps_comfort() {
        assert_eq!(snap_friendly_min(900.0, 1920.0), 900.0);
        assert_eq!(snap_friendly_min(900.0, 2560.0), 900.0);
        // 1080 work height: half is 540, so comfort 600 cannot be kept.
        assert_eq!(snap_friendly_min(600.0, 1080.0), 540.0);
        // 1200+ work height keeps 600.
        assert_eq!(snap_friendly_min(600.0, 1200.0), 600.0);
    }

    #[test]
    fn scaled_1080p_and_1366() {
        assert_eq!(snap_friendly_min(900.0, 1280.0), 640.0); // 1920@150%
        assert_eq!(snap_friendly_min(900.0, 1366.0), 683.0);
        assert_eq!(snap_friendly_min(900.0, 1536.0), 768.0); // 1920@125%
    }

    #[test]
    fn floor_keeps_min_at_or_below_half() {
        assert_eq!(snap_friendly_min(900.0, 1001.0), 500.0);
    }

    #[test]
    fn missing_work_keeps_comfort() {
        assert_eq!(snap_friendly_min(900.0, f64::INFINITY), 900.0);
        assert_eq!(snap_friendly_min(900.0, 0.0), 900.0);
        assert_eq!(snap_friendly_min(900.0, f64::NAN), 900.0);
    }

    #[test]
    fn size_caps_both_axes() {
        assert_eq!(
            snap_friendly_min_size(900.0, 600.0, 1440.0, 852.0),
            (720.0, 426.0)
        );
        assert_eq!(
            snap_friendly_min_size(900.0, 600.0, 1920.0, 1080.0),
            (900.0, 540.0)
        );
        assert_eq!(
            snap_friendly_min_size(900.0, 600.0, 1920.0, 1200.0),
            (900.0, 600.0)
        );
    }
}
