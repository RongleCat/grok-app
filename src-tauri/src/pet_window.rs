//! Desktop pet overlay — extra transparent always-on-top webview.
//!
//! The main window owns session focus; this module owns show/hide, position,
//! click-through on empty pixels, and prefs persistence. Status changes never
//! call `set_focus` on the pet window.
//!
//! The overlay is **not focusable on macOS/Windows**. Tao's `show()` on macOS
//! always calls `makeKeyAndOrderFront`, which would otherwise make the pet
//! the key window. WKWebView then eats the first click on the workbench just
//! to focus it. `focusable(false)` maps to `canBecomeKeyWindow = NO` /
//! `WS_EX_NOACTIVATE` so the pet stays above other apps without stealing key.
//!
//! Linux/KWin drops pointer events on `accept_focus=false` windows, so the
//! overlay stays focusable there and does not yield key on the same click.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::menu::Menu;
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
    WebviewWindowBuilder,
};

pub const PET_WINDOW_LABEL: &str = "pet";
const PREFS_FILE: &str = "pet-prefs.json";

/// Cursor/hit poll while the overlay is on screen or being dragged.
pub const PET_CURSOR_WATCH_ACTIVE_MS: u64 = 64;
/// Hidden / disabled overlay — do not wake every frame.
pub const PET_CURSOR_WATCH_IDLE_MS: u64 = 500;

/// Sleep between pet cursor-watch ticks.
pub fn pet_cursor_watch_sleep_ms(want_show: bool, visible: bool, dragging: bool) -> u64 {
    if dragging {
        return PET_CURSOR_WATCH_ACTIVE_MS;
    }
    if !want_show || !visible {
        return PET_CURSOR_WATCH_IDLE_MS;
    }
    PET_CURSOR_WATCH_ACTIVE_MS
}

static DRAGGING: AtomicBool = AtomicBool::new(false);
static MENU_OPEN: AtomicBool = AtomicBool::new(false);
static WATCH_STARTED: AtomicBool = AtomicBool::new(false);
static WEBVIEW_READY: AtomicBool = AtomicBool::new(false);
static WANT_SHOW: AtomicBool = AtomicBool::new(false);
/// `u8::MAX` = unknown. 0/1 = last `set_ignore_cursor_events` value.
static LAST_IGNORE_CURSOR: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(u8::MAX);
static CACHED_SIZE_PX: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(128);
static SHOW_LOCK: Mutex<()> = Mutex::new(());

const PET_INIT_SCRIPT_PREFIX: &str = r#"(function(){try{document.documentElement.setAttribute("data-pet-shell","1");var s=document.createElement("style");s.setAttribute("data-pet-boot","1");s.textContent="html,html[data-theme],body,#root,.boot-gate{background:transparent!important;background-image:none!important;background-color:transparent!important;} .boot-gate{display:none!important;visibility:hidden!important;opacity:0!important;}";document.documentElement.appendChild(s);"#;

fn pet_init_script(prefs: &PetPrefs) -> String {
    let boot = serde_json::json!({
        "shape": prefs.shape,
        "color": prefs.color,
        "eyeColor": prefs.eye_color,
        "expression": prefs.expression,
        "sizePx": prefs.size_px,
        "bubblesEnabled": prefs.bubbles_enabled,
        "progressBarEnabled": prefs.progress_bar_enabled,
        "bubbleDismissSec": prefs.bubble_dismiss_sec,
        "bubbleShape": prefs.bubble_shape,
        "bubbleStyle": prefs.bubble_style,
    });
    format!(
        "{prefix}window.__GROK_PET_BOOT__={boot};}}catch(e){{}}}})();",
        prefix = PET_INIT_SCRIPT_PREFIX,
        boot = boot
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPrefs {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub visible: bool,
    #[serde(default = "default_shape")]
    pub shape: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_eye_color")]
    pub eye_color: String,
    #[serde(default = "default_expression")]
    pub expression: String,
    #[serde(default = "default_size")]
    pub size_px: u32,
    #[serde(default = "default_bubbles")]
    pub bubbles_enabled: bool,
    #[serde(default)]
    pub progress_bar_enabled: bool,
    #[serde(default = "default_dismiss")]
    pub bubble_dismiss_sec: u32,
    #[serde(default = "default_bubble_shape")]
    pub bubble_shape: String,
    #[serde(default = "default_bubble_style")]
    pub bubble_style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    /// Logical overlay size at the last persist. Used so reopen can keep the
    /// mark (bottom-center) when bubbles / compact / size_px change the frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlay_w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overlay_h: Option<f64>,
}

fn default_shape() -> String {
    "hex".into()
}
fn default_color() -> String {
    "green".into()
}
fn default_eye_color() -> String {
    "auto".into()
}
fn default_expression() -> String {
    "neutre".into()
}
fn default_size() -> u32 {
    128
}
fn default_bubbles() -> bool {
    true
}
fn default_dismiss() -> u32 {
    15
}
fn default_bubble_shape() -> String {
    "round".into()
}
fn default_bubble_style() -> String {
    "ink".into()
}

impl Default for PetPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            visible: false,
            shape: default_shape(),
            color: default_color(),
            eye_color: default_eye_color(),
            expression: default_expression(),
            size_px: default_size(),
            bubbles_enabled: default_bubbles(),
            progress_bar_enabled: false,
            bubble_dismiss_sec: default_dismiss(),
            bubble_shape: default_bubble_shape(),
            bubble_style: default_bubble_style(),
            x: None,
            y: None,
            overlay_w: None,
            overlay_h: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PetFocusPayload {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_title: Option<String>,
    #[serde(default)]
    pub rank: u32,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub composing: bool,
}

static LAST_FOCUS: Mutex<Option<PetFocusPayload>> = Mutex::new(None);
static LAST_TASKS: Mutex<Vec<PetTaskPayload>> = Mutex::new(Vec::new());
static HIT_CHROME: Mutex<PetHitChrome> = Mutex::new(PetHitChrome::empty());

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PetTaskPayload {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_title: Option<String>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub progress: f32,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy)]
struct PetHitChrome {
    valid: bool,
    mark_cx: f64,
    mark_cy: f64,
    mark_r: f64,
    bubble_x: f64,
    bubble_y: f64,
    bubble_w: f64,
    bubble_h: f64,
    window_w: f64,
    window_h: f64,
}

impl PetHitChrome {
    const fn empty() -> Self {
        Self {
            valid: false,
            mark_cx: 0.0,
            mark_cy: 0.0,
            mark_r: 0.0,
            bubble_x: 0.0,
            bubble_y: 0.0,
            bubble_w: 0.0,
            bubble_h: 0.0,
            window_w: 0.0,
            window_h: 0.0,
        }
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        if !self.valid {
            return false;
        }
        let dx = x - self.mark_cx;
        let dy = y - self.mark_cy;
        if dx * dx + dy * dy <= self.mark_r * self.mark_r {
            return true;
        }
        self.bubble_w > 0.0
            && self.bubble_h > 0.0
            && x >= self.bubble_x
            && x <= self.bubble_x + self.bubble_w
            && y >= self.bubble_y
            && y <= self.bubble_y + self.bubble_h
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetHitChromeIn {
    pub mark_cx: f64,
    pub mark_cy: f64,
    pub mark_r: f64,
    #[serde(default)]
    pub bubble_x: f64,
    #[serde(default)]
    pub bubble_y: f64,
    #[serde(default)]
    pub bubble_w: f64,
    #[serde(default)]
    pub bubble_h: f64,
    #[serde(default)]
    pub window_w: f64,
    #[serde(default)]
    pub window_h: f64,
}

fn prefs_path() -> std::path::PathBuf {
    crate::paths::app_data_root().join(PREFS_FILE)
}

pub fn load_prefs() -> PetPrefs {
    let _ = crate::paths::ensure_app_dirs();
    let path = prefs_path();
    let prefs = match std::fs::read_to_string(&path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or_default(),
        _ => PetPrefs::default(),
    };
    let prefs = normalize_prefs(prefs);
    CACHED_SIZE_PX.store(prefs.size_px.max(64), Ordering::Relaxed);
    prefs
}

pub fn save_prefs(prefs: &PetPrefs) -> Result<(), String> {
    let _ = crate::paths::ensure_app_dirs();
    CACHED_SIZE_PX.store(prefs.size_px.max(64), Ordering::Relaxed);
    let s = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    crate::store_lock::write_bytes_atomic(&prefs_path(), s.as_bytes())
}

fn normalize_prefs(mut p: PetPrefs) -> PetPrefs {
    let shapes = [
        "blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem",
        "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf",
    ];
    if !shapes.contains(&p.shape.as_str()) {
        p.shape = default_shape();
    }
    let colors = [
        "black", "white", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet",
        "magenta", "gray",
    ];
    if !colors.contains(&p.color.as_str()) {
        p.color = default_color();
    }
    if p.eye_color != "auto" && !colors.contains(&p.eye_color.as_str()) {
        p.eye_color = default_eye_color();
    }
    let expressions = [
        "neutre",
        "attentif",
        "surpris",
        "excite",
        "heureux",
        "hilare",
        "colere",
        "triste",
        "effraye",
        "mefiant",
        "confus",
        "curieux",
        "fier",
        "timide",
        "blase",
        "somnolent",
    ];
    if !expressions.contains(&p.expression.as_str()) {
        p.expression = default_expression();
    }
    p.size_px = if p.size_px <= 112 {
        96
    } else if p.size_px >= 144 {
        160
    } else {
        128
    };
    let bubble_shapes = ["round", "pill", "card", "ticket", "cloud", "slash"];
    if !bubble_shapes.contains(&p.bubble_shape.as_str()) {
        p.bubble_shape = default_bubble_shape();
    }
    let bubble_styles = ["ink", "glass", "solid", "paper", "outline", "accent"];
    if !bubble_styles.contains(&p.bubble_style.as_str()) {
        p.bubble_style = default_bubble_style();
    }
    p.bubble_dismiss_sec = p.bubble_dismiss_sec.clamp(3, 120);
    p
}

fn window_logical_size(size_px: u32) -> f64 {
    // Extra pad so the in-app context menu can sit next to the mark
    // while empty pixels stay click-through via the cursor watch.
    f64::from(size_px) + 96.0
}

/// Must match `petOverlayWidth` / `petBubbleViewportHeight` in JS.
const PET_BUBBLE_WIDTH_PX: f64 = 216.0;
/// Chip drop-shadow pad (matches JS `PET_BUBBLE_SHADOW_PAD`).
const PET_BUBBLE_SHADOW_PAD: f64 = 20.0;
/// 3 visible rows + shadow pad: 3*68 + 2*6 + 10 + 40. Always reserved so the mark does not jump.
const PET_BUBBLE_VIEWPORT_H: f64 = 266.0;
/// Matches `.pet-overlay` padding-bottom — mark sits on the bottom, not centered.
const PET_MARK_BOTTOM_PAD: f64 = 16.0;
/// Matches `PET_COMPACT_PAD` in JS — idle Wayland window hugs the mark.
const PET_COMPACT_PAD: f64 = 8.0;

fn overlay_extent(size_px: u32) -> (f64, f64) {
    overlay_extent_for(size_px, true)
}

fn overlay_extent_for(size_px: u32, bubbles: bool) -> (f64, f64) {
    let mark = window_logical_size(size_px);
    if bubbles {
        (
            mark + PET_BUBBLE_WIDTH_PX + PET_BUBBLE_SHADOW_PAD * 2.0,
            mark + PET_BUBBLE_VIEWPORT_H,
        )
    } else {
        (mark, mark)
    }
}

fn overlay_compact(size_px: u32) -> (f64, f64) {
    (
        f64::from(size_px) + PET_COMPACT_PAD * 2.0,
        f64::from(size_px) + PET_COMPACT_PAD + PET_MARK_BOTTOM_PAD,
    )
}

fn overlay_expanded_now(bubbles: bool) -> bool {
    if !pet_wayland_display() {
        return true;
    }
    if MENU_OPEN.load(Ordering::Relaxed) {
        return true;
    }
    if !bubbles {
        return false;
    }
    LAST_TASKS.lock().map(|g| !g.is_empty()).unwrap_or(false)
}

fn overlay_extent_now(size_px: u32, bubbles: bool) -> (f64, f64) {
    if overlay_expanded_now(bubbles) {
        overlay_extent_for(size_px, bubbles)
    } else {
        overlay_compact(size_px)
    }
}

/// Tao/GTK reports (0, 0) for global cursor on Wayland — never treat that
/// as a real pointer. `GDK_BACKEND=x11` stays on the X11 click-through path.
pub fn wayland_display_from_env(wayland_display: Option<&str>, gdk_backend: Option<&str>) -> bool {
    let backend = gdk_backend.unwrap_or("").trim();
    if backend.eq_ignore_ascii_case("x11") {
        return false;
    }
    if backend.eq_ignore_ascii_case("wayland") {
        return true;
    }
    wayland_display
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

pub fn pet_wayland_display() -> bool {
    wayland_display_from_env(
        std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        std::env::var("GDK_BACKEND").ok().as_deref(),
    )
}

/// `None` = leave ignore-cursor unchanged (Wayland: polling is unusable).
/// `Some(true)` = click-through empty pixels.
pub fn pet_poll_ignore_cursor(wayland: bool, over: bool) -> Option<bool> {
    if wayland {
        None
    } else {
        Some(!over)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetOverlayPolicy {
    pub compact_idle: bool,
    pub cursor_click_through: bool,
}

pub fn pet_overlay_policy_for(wayland: bool) -> PetOverlayPolicy {
    PetOverlayPolicy {
        compact_idle: wayland,
        cursor_click_through: !wayland,
    }
}

/// KWin/Mutter drop pointer events when `accept_focus` is false. macOS/Windows
/// need the opposite so `show()` cannot steal the workbench's first click.
pub fn pet_overlay_focusable(linux: bool) -> bool {
    linux
}

/// Immediate Focused(true) → yield cancels the click / move serial on Linux.
pub fn should_yield_key_on_pet_focus(linux: bool, dragging: bool, menu_open: bool) -> bool {
    !linux && !dragging && !menu_open
}

pub fn pet_nudge_origin(x: f64, y: f64, dx: f64, dy: f64) -> (f64, f64) {
    (x + dx, y + dy)
}

fn mark_center_physical(
    win_x: f64,
    win_y: f64,
    win_w: f64,
    win_h: f64,
    size_px: u32,
    scale_factor: f64,
) -> (f64, f64) {
    let scale = scale_factor.max(0.5);
    let cx = win_x + win_w / 2.0;
    let cy = win_y + win_h - (PET_MARK_BOTTOM_PAD + f64::from(size_px) / 2.0) * scale;
    (cx, cy)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct WorkRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

const PET_SCREEN_PAD: f64 = 24.0;
const PET_MIN_VISIBLE: f64 = 48.0;

fn overlay_overlaps_work(x: f64, y: f64, w: f64, h: f64, work: WorkRect) -> bool {
    let x1 = x.max(work.x);
    let y1 = y.max(work.y);
    let x2 = (x + w).min(work.x + work.w);
    let y2 = (y + h).min(work.y + work.h);
    x2 - x1 >= PET_MIN_VISIBLE && y2 - y1 >= PET_MIN_VISIBLE
}

fn default_pet_pos(work: WorkRect, overlay_w: f64, overlay_h: f64) -> (f64, f64) {
    (
        (work.x + work.w - overlay_w - PET_SCREEN_PAD).max(work.x),
        (work.y + work.h - overlay_h - PET_SCREEN_PAD).max(work.y),
    )
}

/// Settings / identity writes often carry stale x/y from the last `pet_prefs_get`.
/// Drag persist does not emit, so those values must never replace the live origin.
pub fn keep_live_overlay_pos(prev: &PetPrefs, next: &mut PetPrefs) {
    next.x = prev.x;
    next.y = prev.y;
    next.overlay_w = prev.overlay_w;
    next.overlay_h = prev.overlay_h;
}

/// Place the window so the mark (bottom-center) stays put when overlay size changes.
pub fn restore_overlay_origin(
    saved_x: f64,
    saved_y: f64,
    saved_w: Option<f64>,
    saved_h: Option<f64>,
    next_w: f64,
    next_h: f64,
) -> (f64, f64) {
    let (Some(w), Some(h)) = (saved_w, saved_h) else {
        return (saved_x, saved_y);
    };
    if w <= 0.0 || h <= 0.0 || !w.is_finite() || !h.is_finite() {
        return (saved_x, saved_y);
    }
    let mark_x = saved_x + w / 2.0;
    let mark_bottom = saved_y + h;
    (mark_x - next_w / 2.0, mark_bottom - next_h)
}

/// `Moved` while hidden can report 0,0 if startDragging never cleared DRAGGING.
pub fn should_persist_on_moved(dragging: bool, visible: bool) -> bool {
    dragging && visible
}

/// Pointer-up persist must run even when `pet_set_dragging(true)` lost the race.
pub fn should_persist_after_drag_flag(dragging: bool) -> bool {
    !dragging
}

pub fn overlay_pos_is_persistable(x: f64, y: f64) -> bool {
    x.is_finite() && y.is_finite()
}

fn clamped_saved_overlay_pos(
    prefs: &PetPrefs,
    overlay_w: f64,
    overlay_h: f64,
    app: &AppHandle,
) -> Option<(f64, f64)> {
    let (x, y) = (prefs.x?, prefs.y?);
    if !overlay_pos_is_persistable(x, y) {
        return None;
    }
    let (x, y) =
        restore_overlay_origin(x, y, prefs.overlay_w, prefs.overlay_h, overlay_w, overlay_h);
    let (works, primary) = monitor_work_rects(app);
    Some(clamp_pet_overlay_pos(
        x, y, overlay_w, overlay_h, &works, primary,
    ))
}

/// Keep a saved overlay on a still-connected display. A disconnected monitor
/// used to park the pet at prefs x/y forever (invisible, prefs still "on").
fn clamp_pet_overlay_pos(
    x: f64,
    y: f64,
    overlay_w: f64,
    overlay_h: f64,
    works: &[WorkRect],
    primary: WorkRect,
) -> (f64, f64) {
    if works
        .iter()
        .any(|work| overlay_overlaps_work(x, y, overlay_w, overlay_h, *work))
    {
        return (x, y);
    }
    default_pet_pos(primary, overlay_w, overlay_h)
}

fn work_rect_from_monitor(m: &tauri::Monitor) -> WorkRect {
    let scale = m.scale_factor().max(0.1);
    let wa = m.work_area();
    WorkRect {
        x: f64::from(wa.position.x) / scale,
        y: f64::from(wa.position.y) / scale,
        w: f64::from(wa.size.width) / scale,
        h: f64::from(wa.size.height) / scale,
    }
}

fn monitor_work_rects(app: &AppHandle) -> (Vec<WorkRect>, WorkRect) {
    let works: Vec<WorkRect> = app
        .available_monitors()
        .ok()
        .map(|ms| ms.iter().map(work_rect_from_monitor).collect())
        .unwrap_or_default();
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| work_rect_from_monitor(&m))
        .or_else(|| works.first().copied())
        .unwrap_or(WorkRect {
            x: 0.0,
            y: 0.0,
            w: 1280.0,
            h: 800.0,
        });
    (works, primary)
}

fn persist_window_pos(app: &AppHandle) {
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(scale) = win.scale_factor() else {
        return;
    };
    let Ok(pos) = win.outer_position() else {
        return;
    };
    let scale = scale.max(0.1);
    let logical = LogicalPosition::<f64>::from_physical(pos, scale);
    if !overlay_pos_is_persistable(logical.x, logical.y) {
        return;
    }
    let mut prefs = load_prefs();
    prefs.x = Some(logical.x);
    prefs.y = Some(logical.y);
    if let Ok(size) = win.inner_size() {
        let logical_size = LogicalSize::<f64>::from_physical(size, scale);
        if logical_size.width.is_finite() && logical_size.width > 0.0 {
            prefs.overlay_w = Some(logical_size.width);
        }
        if logical_size.height.is_finite() && logical_size.height > 0.0 {
            prefs.overlay_h = Some(logical_size.height);
        }
    }
    let _ = save_prefs(&prefs);
}

/// Flush the live overlay origin (hide / quit). No-op when the HWND is already gone.
pub fn persist_pet_window_pos(app: &AppHandle) {
    persist_window_pos(app);
}

/// Physical cursor vs logical hit chrome (mark disc + task-bubble stack).
pub fn pet_cursor_over_chrome(
    cursor_x: f64,
    cursor_y: f64,
    win_x: f64,
    win_y: f64,
    win_w: f64,
    win_h: f64,
    size_px: u32,
    scale_factor: f64,
    chrome: &PetHitChrome,
) -> bool {
    let scale = scale_factor.max(0.5);
    if chrome.valid {
        let x = (cursor_x - win_x) / scale;
        let y = (cursor_y - win_y) / scale;
        return chrome.contains(x, y);
    }
    pet_cursor_over_mark(
        cursor_x,
        cursor_y,
        win_x,
        win_y,
        win_w,
        win_h,
        size_px,
        scale_factor,
    )
}

/// Physical hit radius for the living mark.
/// `size_px` is CSS/logical; cursor + window geometry are physical.
pub fn pet_hit_radius(size_px: u32, scale_factor: f64) -> f64 {
    f64::from(size_px.max(64)) * scale_factor.max(0.5) * 0.52
}

pub fn pet_cursor_over_mark(
    cursor_x: f64,
    cursor_y: f64,
    win_x: f64,
    win_y: f64,
    win_w: f64,
    win_h: f64,
    size_px: u32,
    scale_factor: f64,
) -> bool {
    let (cx, cy) = mark_center_physical(win_x, win_y, win_w, win_h, size_px, scale_factor);
    let r = pet_hit_radius(size_px, scale_factor);
    let dx = cursor_x - cx;
    let dy = cursor_y - cy;
    dx * dx + dy * dy <= r * r
}

fn apply_window_chrome(win: &tauri::WebviewWindow) {
    let _ = win.set_always_on_top(true);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_decorations(false);
    let _ = win.set_shadow(false);
    let _ = win.set_focusable(pet_overlay_focusable(cfg!(target_os = "linux")));
    detach_native_menu(win);
    if pet_wayland_display() {
        let _ = win.set_ignore_cursor_events(false);
    }
}

/// Keep a window-local empty menu so `AppHandle::set_menu` (locale refresh)
/// does not re-attach File / Edit / Window / Help to this overlay.
fn detach_native_menu(#[allow(unused_variables)] win: &tauri::WebviewWindow) {
    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(empty) = Menu::new(win.app_handle()) {
            let _ = win.set_menu(empty);
        }
        let _ = win.hide_menu();
    }
    #[cfg(windows)]
    crate::win_shell::strip_overlay_native_menu(win);
    hide_linux_menubar(win);
}

/// GTK `app.set_menu` reapplies the menubar on every ApplicationWindow.
/// An empty muda menu is not enough — KDE still paints Edit/Window/Help.
fn hide_linux_menubar(win: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        let w = win.clone();
        let handle = w.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Ok(gtk_win) = w.gtk_window() {
                gtk::prelude::ApplicationWindowExt::set_show_menubar(&gtk_win, false);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = win;
    }
}

/// Re-apply overlay chrome after the app-wide menu is installed or refreshed.
pub fn reassert_overlay_chrome(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        apply_window_chrome(&win);
    }
}

/// True when the overlay HWND is actually up. Prefs can lag after File>Close.
pub fn overlay_is_up(app: &AppHandle) -> bool {
    app.get_webview_window(PET_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// After hide(), a leftover visible HWND would need a second hide (Windows
/// transparent always-on-top windows can report success while staying painted).
#[cfg(test)]
pub fn hide_needs_destroy(hide_reported_ok: bool, still_visible: bool) -> bool {
    still_visible || !hide_reported_ok
}

fn lock_show() -> std::sync::MutexGuard<'static, ()> {
    SHOW_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// `None` on platforms where we cannot read the physical mouse button.
fn primary_mouse_down() -> Option<bool> {
    #[cfg(windows)]
    {
        Some(crate::win_shell::primary_mouse_button_down())
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Clear drag when the OS took the mouse and never delivered pointerup.
pub fn drag_should_clear(dragging: bool, button_down: Option<bool>) -> bool {
    dragging && button_down == Some(false)
}

fn finish_os_drag(app: &AppHandle) {
    if DRAGGING.swap(false, Ordering::Relaxed) {
        persist_window_pos(app);
        if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
            apply_window_chrome(&win);
        }
    }
}

/// Give the workbench key/activation back when the overlay stole it.
///
/// Do not raise a hidden or minimized main window — the pet can float alone
/// over other apps.
pub fn should_return_main_key(pet_focused: bool, main_visible: bool, main_minimized: bool) -> bool {
    pet_focused && main_visible && !main_minimized
}

/// After `show()`, macOS `makeKeyAndOrderFront` can make the overlay the key
/// window even when `focusable(false)` keeps `is_focused()` false.
pub fn should_force_return_main_key_after_show(
    linux: bool,
    main_visible: bool,
    main_minimized: bool,
) -> bool {
    !linux && main_visible && !main_minimized
}

/// Skip redundant `set_ignore_cursor_events` — repeating it every poll tick
/// remaps mouse routing in the workbench and arms session drag on a click.
pub fn pet_ignore_cursor_should_apply(prev: Option<bool>, next: bool) -> bool {
    prev != Some(next)
}

fn last_ignore_cursor() -> Option<bool> {
    match LAST_IGNORE_CURSOR.load(Ordering::Relaxed) {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

fn remember_ignore_cursor(next: bool) {
    LAST_IGNORE_CURSOR.store(if next { 1 } else { 0 }, Ordering::Relaxed);
}

fn forget_ignore_cursor() {
    LAST_IGNORE_CURSOR.store(u8::MAX, Ordering::Relaxed);
}

fn yield_key_to_main(app: &AppHandle, after_show: bool) {
    let Some(pet) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    let pet_focused = pet.is_focused().unwrap_or(false);
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let main_visible = main.is_visible().unwrap_or(false);
    let main_minimized = main.is_minimized().unwrap_or(false);
    let steal = should_return_main_key(pet_focused, main_visible, main_minimized)
        || (after_show
            && should_force_return_main_key_after_show(
                cfg!(target_os = "linux"),
                main_visible,
                main_minimized,
            ));
    if !steal {
        return;
    }
    let _ = main.set_focus();
}

fn emit_prefs(app: &AppHandle, prefs: &PetPrefs) {
    let _ = app.emit("pet://prefs", prefs);
}

fn reveal_if_wanted(win: &tauri::WebviewWindow) {
    if !WANT_SHOW.load(Ordering::SeqCst) {
        return;
    }
    apply_window_chrome(win);
    let _ = win.show();
    apply_window_chrome(win);
    yield_key_to_main(win.app_handle(), true);
}

/// Build (or reuse) the overlay. Never focuses the pet window.
pub fn ensure_pet_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(PET_WINDOW_LABEL) {
        apply_window_chrome(&existing);
        return Ok(existing);
    }
    let prefs = normalize_prefs(load_prefs());
    let (side_w, side_h) = overlay_extent_now(prefs.size_px, prefs.bubbles_enabled);
    WEBVIEW_READY.store(false, Ordering::SeqCst);
    let mut builder = WebviewWindowBuilder::new(
        app,
        PET_WINDOW_LABEL,
        WebviewUrl::App("index.html#/pet".into()),
    )
    .title("Grok Pet")
    .inner_size(side_w, side_h)
    .min_inner_size(96.0, 96.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .focusable(pet_overlay_focusable(cfg!(target_os = "linux")))
    .shadow(false)
    .accept_first_mouse(true)
    .initialization_script(pet_init_script(&prefs))
    .on_page_load(|win, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }
        WEBVIEW_READY.store(true, Ordering::SeqCst);
        apply_window_chrome(&win);
        reveal_if_wanted(&win);
    });
    // Own an empty menu so the app-wide File/Edit/Window/Help bar is not inherited.
    #[cfg(not(target_os = "macos"))]
    if let Ok(empty) = Menu::new(app) {
        builder = builder.menu(empty);
    }

    if let Some((x, y)) = clamped_saved_overlay_pos(&prefs, side_w, side_h, app) {
        builder = builder.position(x, y);
    }

    let win = builder.build().map_err(|e| format!("pet window: {e}"))?;
    apply_window_chrome(&win);
    let handle = app.clone();
    win.on_window_event(move |ev| {
        match ev {
            tauri::WindowEvent::Moved(_) => {
                // Size-sync / show must not overwrite the user's drag position.
                // Hide/destroy can report 0,0 while startDragging left DRAGGING set.
                let visible = handle
                    .get_webview_window(PET_WINDOW_LABEL)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if should_persist_on_moved(DRAGGING.load(Ordering::Relaxed), visible) {
                    persist_window_pos(&handle);
                }
            }
            tauri::WindowEvent::Focused(true) => {
                // show() uses makeKeyAndOrderFront even when focused(false).
                // If the workbench is already up, give key back immediately.
                // Skip while dragging / menu is open so pointer capture stays.
                // On Linux a same-tick yield eats the click (KWin) and the
                // xdg_toplevel.move serial — show_pet already yields.
                if should_yield_key_on_pet_focus(
                    cfg!(target_os = "linux"),
                    DRAGGING.load(Ordering::Relaxed),
                    MENU_OPEN.load(Ordering::Relaxed),
                ) {
                    yield_key_to_main(&handle, false);
                }
            }
            tauri::WindowEvent::Destroyed => {
                WEBVIEW_READY.store(false, Ordering::SeqCst);
                if WANT_SHOW.swap(false, Ordering::SeqCst) {
                    let mut prefs = load_prefs();
                    if prefs.visible {
                        prefs.visible = false;
                        let _ = save_prefs(&prefs);
                        emit_prefs(&handle, &prefs);
                    }
                }
            }
            _ => {}
        }
    });
    start_cursor_watch(app.clone());
    Ok(win)
}

pub fn show_pet(app: &AppHandle) -> Result<(), String> {
    let _guard = lock_show();
    let mut prefs = normalize_prefs(load_prefs());
    prefs.enabled = true;
    prefs.visible = true;
    save_prefs(&prefs)?;
    let win = ensure_pet_window(app)?;
    apply_window_chrome(&win);
    let (side_w, side_h) = overlay_extent_now(prefs.size_px, prefs.bubbles_enabled);
    let _ = win.set_size(LogicalSize::new(side_w, side_h));
    if let Some((x, y)) = clamped_saved_overlay_pos(&prefs, side_w, side_h, app) {
        let _ = win.set_position(LogicalPosition::new(x, y));
        if prefs.x != Some(x)
            || prefs.y != Some(y)
            || prefs.overlay_w != Some(side_w)
            || prefs.overlay_h != Some(side_h)
        {
            prefs.x = Some(x);
            prefs.y = Some(y);
            prefs.overlay_w = Some(side_w);
            prefs.overlay_h = Some(side_h);
            let _ = save_prefs(&prefs);
        }
    }
    WANT_SHOW.store(true, Ordering::SeqCst);
    forget_ignore_cursor();
    // Transparent boot (index.html + init script) already hides the splash.
    // Do not wait on WEBVIEW_READY — first toggle used to look like a no-op
    // while the pet bundle was still booting.
    win.show().map_err(|e| e.to_string())?;
    apply_window_chrome(&win);
    if !win.is_visible().unwrap_or(false) {
        let _ = win.show();
        apply_window_chrome(&win);
    }
    yield_key_to_main(app, true);
    // GTK reapplies the app menubar on map; strip again after realize.
    let later = win.clone();
    tauri::async_runtime::spawn(async move {
        for ms in [50_u64, 250, 800] {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            apply_window_chrome(&later);
        }
    });
    Ok(())
}

pub fn hide_pet(app: &AppHandle) -> Result<(), String> {
    let _guard = lock_show();
    persist_window_pos(app);
    DRAGGING.store(false, Ordering::Relaxed);
    WANT_SHOW.store(false, Ordering::SeqCst);
    let mut prefs = normalize_prefs(load_prefs());
    prefs.visible = false;
    save_prefs(&prefs)?;
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = win.set_ignore_cursor_events(true);
        remember_ignore_cursor(true);
        win.hide().map_err(|e| e.to_string())?;
        // Do not destroy() here: CloseRequested (File>Close) also calls hide_pet,
        // and destroy-from-that-handler can deadlock the window event loop.
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        }
    }
    Ok(())
}

pub fn start_cursor_watch(app: AppHandle) {
    if WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let wayland = pet_wayland_display();
        loop {
            let want = WANT_SHOW.load(Ordering::SeqCst);
            let dragging = DRAGGING.load(Ordering::Relaxed);
            let visible = app
                .get_webview_window(PET_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            tokio::time::sleep(Duration::from_millis(pet_cursor_watch_sleep_ms(
                want, visible, dragging,
            )))
            .await;
            if !want && !dragging {
                continue;
            }
            let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
                continue;
            };
            if wayland {
                // Tao stubs global cursor at (0, 0) on Wayland. Polling that
                // would set ignore_cursor_events(true) forever. Compact window
                // + local pointer events instead.
                if DRAGGING.load(Ordering::Relaxed) && drag_should_clear(true, primary_mouse_down())
                {
                    finish_os_drag(&app);
                }
                continue;
            }
            if DRAGGING.load(Ordering::Relaxed) {
                // startDragging() often eats WebView pointerup. If the button is
                // already up, the whole padded overlay would stay a hit target.
                if drag_should_clear(true, primary_mouse_down()) {
                    finish_os_drag(&app);
                } else {
                    let _ = win.set_ignore_cursor_events(false);
                    continue;
                }
            }
            if MENU_OPEN.load(Ordering::Relaxed) {
                let _ = win.set_ignore_cursor_events(false);
                continue;
            }
            let visible = win.is_visible().unwrap_or(false);
            if !visible {
                continue;
            }
            let Ok(cursor) = app.cursor_position() else {
                continue;
            };
            let Ok(pos) = win.outer_position() else {
                continue;
            };
            let Ok(size) = win.outer_size() else {
                continue;
            };
            let scale = win.scale_factor().unwrap_or(1.0);
            let size_px = CACHED_SIZE_PX.load(Ordering::Relaxed);
            let chrome = HIT_CHROME
                .lock()
                .map(|g| *g)
                .unwrap_or(PetHitChrome::empty());
            let over = pet_cursor_over_chrome(
                cursor.x,
                cursor.y,
                f64::from(pos.x),
                f64::from(pos.y),
                f64::from(size.width),
                f64::from(size.height),
                size_px,
                scale,
                &chrome,
            );
            if let Some(ignore) = pet_poll_ignore_cursor(false, over) {
                if pet_ignore_cursor_should_apply(last_ignore_cursor(), ignore) {
                    let _ = win.set_ignore_cursor_events(ignore);
                    remember_ignore_cursor(ignore);
                }
            }
            // Screen-space look target so eyes track the pointer even when
            // the overlay is click-through (no webview pointer events).
            let (fallback_cx, fallback_cy) = mark_center_physical(
                f64::from(pos.x),
                f64::from(pos.y),
                f64::from(size.width),
                f64::from(size.height),
                size_px,
                scale,
            );
            let mark_cx = if chrome.valid {
                f64::from(pos.x) + chrome.mark_cx * scale
            } else {
                fallback_cx
            };
            let mark_cy = if chrome.valid {
                f64::from(pos.y) + chrome.mark_cy * scale
            } else {
                fallback_cy
            };
            let local_r = pet_hit_radius(size_px, scale);
            let _ = app.emit(
                "pet://cursor",
                serde_json::json!({
                    "dx": cursor.x - mark_cx,
                    "dy": cursor.y - mark_cy,
                    "localR": local_r,
                }),
            );
        }
    });
}

#[tauri::command]
pub fn pet_webview_ready(app: AppHandle) -> Result<PetOverlayPolicy, String> {
    WEBVIEW_READY.store(true, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        reveal_if_wanted(&win);
    }
    Ok(pet_overlay_policy_for(pet_wayland_display()))
}

#[tauri::command]
pub fn pet_overlay_policy() -> PetOverlayPolicy {
    pet_overlay_policy_for(pet_wayland_display())
}

#[tauri::command]
pub fn pet_prefs_get() -> PetPrefs {
    normalize_prefs(load_prefs())
}

#[tauri::command]
pub fn pet_prefs_set(app: AppHandle, prefs: PetPrefs) -> Result<PetPrefs, String> {
    persist_window_pos(&app);
    let prev = load_prefs();
    let mut next = normalize_prefs(prefs);
    keep_live_overlay_pos(&prev, &mut next);
    save_prefs(&next)?;
    if next.enabled && next.visible {
        show_pet(&app)?;
        if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
            let (side_w, side_h) = overlay_extent_now(next.size_px, next.bubbles_enabled);
            let _ = win.set_size(LogicalSize::new(side_w, side_h));
        }
    } else {
        hide_pet(&app)?;
    }
    let saved = normalize_prefs(load_prefs());
    emit_prefs(&app, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn pet_show(app: AppHandle) -> Result<PetPrefs, String> {
    show_pet(&app)?;
    let prefs = normalize_prefs(load_prefs());
    emit_prefs(&app, &prefs);
    Ok(prefs)
}

#[tauri::command]
pub fn pet_hide(app: AppHandle) -> Result<PetPrefs, String> {
    hide_pet(&app)?;
    let prefs = normalize_prefs(load_prefs());
    emit_prefs(&app, &prefs);
    Ok(prefs)
}

#[tauri::command]
pub fn pet_toggle(app: AppHandle) -> Result<PetPrefs, String> {
    // Follow the real HWND, not just prefs — File>Close / failed hide used to
    // invert the next /pet click so the overlay looked stuck.
    if overlay_is_up(&app) {
        hide_pet(&app)?;
    } else {
        show_pet(&app)?;
    }
    let next = normalize_prefs(load_prefs());
    emit_prefs(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn pet_is_visible(app: AppHandle) -> bool {
    app.get_webview_window(PET_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn pet_set_ignore_cursor(app: AppHandle, ignore: bool) -> Result<(), String> {
    // Wayland global cursor is (0, 0); click-through would stick forever.
    let ignore = if pet_wayland_display() { false } else { ignore };
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pet_set_dragging(app: AppHandle, dragging: bool) {
    DRAGGING.store(dragging, Ordering::Relaxed);
    if should_persist_after_drag_flag(dragging) {
        persist_window_pos(&app);
    }
}

/// Move the overlay by logical CSS pixels. Wayland `startDragging` needs a
/// live button serial; late JS IPC does not have one.
#[tauri::command]
pub fn pet_nudge(app: AppHandle, dx: f64, dy: f64) {
    if !dx.is_finite() || !dy.is_finite() || (dx == 0.0 && dy == 0.0) {
        return;
    }
    let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };
    DRAGGING.store(true, Ordering::Relaxed);
    let handle = win.clone();
    let _ = handle.run_on_main_thread(move || {
        let Ok(scale) = win.scale_factor() else {
            return;
        };
        let Ok(pos) = win.outer_position() else {
            return;
        };
        let scale = scale.max(0.1);
        let (x, y) = pet_nudge_origin(f64::from(pos.x) / scale, f64::from(pos.y) / scale, dx, dy);
        let _ = win.set_position(LogicalPosition::new(x, y));
    });
}

#[tauri::command]
pub fn pet_set_menu_open(app: AppHandle, open: bool) {
    MENU_OPEN.store(open, Ordering::Relaxed);
    if open {
        if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
            let _ = win.set_ignore_cursor_events(false);
        }
    }
}

#[tauri::command]
pub fn pet_push_focus(app: AppHandle, focus: PetFocusPayload) -> Result<(), String> {
    if let Ok(mut g) = LAST_FOCUS.lock() {
        *g = Some(focus.clone());
    }
    // Broadcast only — never focus the overlay.
    let _ = app.emit("pet://focus", &focus);
    Ok(())
}

#[tauri::command]
pub fn pet_get_focus() -> Option<PetFocusPayload> {
    LAST_FOCUS.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn pet_open_settings(app: AppHandle) -> Result<(), String> {
    crate::tray::show_main_window(&app);
    let _ = app.emit(
        "tray://open-settings",
        serde_json::json!({ "section": "pet" }),
    );
    Ok(())
}

#[tauri::command]
pub fn pet_focus_session(app: AppHandle, session_id: String) -> Result<(), String> {
    crate::tray::show_main_window(&app);
    let id = session_id.trim();
    if !id.is_empty() {
        let _ = app.emit(
            "tray://open-session",
            serde_json::json!({ "sessionId": id }),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn pet_show_main(app: AppHandle) {
    crate::tray::show_main_window(&app);
}

#[tauri::command]
pub fn pet_hide_main(app: AppHandle) {
    crate::tray::hide_to_tray(&app);
}

#[tauri::command]
pub fn pet_push_tasks(app: AppHandle, tasks: Vec<PetTaskPayload>) -> Result<(), String> {
    if let Ok(mut g) = LAST_TASKS.lock() {
        *g = tasks.clone();
    }
    let _ = app.emit("pet://tasks", &tasks);
    Ok(())
}

#[tauri::command]
pub fn pet_get_tasks() -> Vec<PetTaskPayload> {
    LAST_TASKS
        .lock()
        .ok()
        .map(|g| g.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn pet_set_hit_chrome(chrome: PetHitChromeIn) {
    let size = f64::from(CACHED_SIZE_PX.load(Ordering::Relaxed).max(64));
    let max_r = size * 0.52 * 1.2;
    let (max_w, max_h) = overlay_extent(CACHED_SIZE_PX.load(Ordering::Relaxed).max(64));
    if let Ok(mut g) = HIT_CHROME.lock() {
        *g = PetHitChrome {
            valid: chrome.mark_r > 0.0 || chrome.bubble_w > 0.0,
            mark_cx: chrome.mark_cx,
            mark_cy: chrome.mark_cy,
            mark_r: chrome.mark_r.max(0.0).min(max_r),
            bubble_x: chrome.bubble_x,
            bubble_y: chrome.bubble_y,
            bubble_w: chrome.bubble_w.max(0.0).min(max_w),
            bubble_h: chrome.bubble_h.max(0.0).min(max_h),
            window_w: chrome.window_w.max(0.0),
            window_h: chrome.window_h.max(0.0),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_watch_sleeps_longer_when_hidden() {
        assert_eq!(
            pet_cursor_watch_sleep_ms(true, true, false),
            PET_CURSOR_WATCH_ACTIVE_MS
        );
        assert_eq!(
            pet_cursor_watch_sleep_ms(true, true, true),
            PET_CURSOR_WATCH_ACTIVE_MS
        );
        assert_eq!(
            pet_cursor_watch_sleep_ms(false, false, false),
            PET_CURSOR_WATCH_IDLE_MS
        );
        assert_eq!(
            pet_cursor_watch_sleep_ms(true, false, false),
            PET_CURSOR_WATCH_IDLE_MS
        );
        assert_eq!(
            pet_cursor_watch_sleep_ms(false, false, true),
            PET_CURSOR_WATCH_ACTIVE_MS
        );
    }

    #[test]
    fn pet_init_script_hides_boot_gate() {
        let script = pet_init_script(&PetPrefs::default());
        assert!(script.contains("data-pet-shell"));
        assert!(script.contains("boot-gate"));
        assert!(script.contains("transparent"));
        assert!(script.contains("display:none"));
        assert!(script.contains("__GROK_PET_BOOT__"));
        assert!(script.contains("green"));
    }

    #[test]
    fn pet_init_script_embeds_saved_color() {
        let prefs = PetPrefs {
            color: "violet".into(),
            shape: "cloud".into(),
            ..Default::default()
        };
        let script = pet_init_script(&normalize_prefs(prefs));
        assert!(script.contains("violet"));
        assert!(script.contains("cloud"));
        assert!(script.contains("__GROK_PET_BOOT__"));
    }

    #[test]
    fn normalize_clamps_identity() {
        let p = normalize_prefs(PetPrefs {
            shape: "nope".into(),
            color: "neon".into(),
            size_px: 12,
            ..Default::default()
        });
        assert_eq!(p.shape, "hex");
        assert_eq!(p.color, "green");
        assert_eq!(p.eye_color, "auto");
        assert_eq!(p.size_px, 96);
        let eyes = normalize_prefs(PetPrefs {
            eye_color: "neon".into(),
            ..Default::default()
        });
        assert_eq!(eyes.eye_color, "auto");
        let black_eyes = normalize_prefs(PetPrefs {
            eye_color: "black".into(),
            ..Default::default()
        });
        assert_eq!(black_eyes.eye_color, "black");
        let white = normalize_prefs(PetPrefs {
            color: "white".into(),
            eye_color: "white".into(),
            ..Default::default()
        });
        assert_eq!(white.color, "white");
        assert_eq!(white.eye_color, "white");
        let bean = normalize_prefs(PetPrefs {
            shape: "bean".into(),
            ..Default::default()
        });
        assert_eq!(bean.shape, "bean");
        let leaf = normalize_prefs(PetPrefs {
            shape: "leaf".into(),
            ..Default::default()
        });
        assert_eq!(leaf.shape, "leaf");
        let expr = normalize_prefs(PetPrefs {
            expression: "nope".into(),
            ..Default::default()
        });
        assert_eq!(expr.expression, "neutre");
        let happy = normalize_prefs(PetPrefs {
            expression: "heureux".into(),
            ..Default::default()
        });
        assert_eq!(happy.expression, "heureux");
        let bubbles = normalize_prefs(PetPrefs {
            bubble_shape: "nope".into(),
            bubble_style: "neon".into(),
            bubble_dismiss_sec: 1,
            ..Default::default()
        });
        assert_eq!(bubbles.bubble_shape, "round");
        assert_eq!(bubbles.bubble_style, "ink");
        assert_eq!(bubbles.bubble_dismiss_sec, 3);
        assert!(!bubbles.progress_bar_enabled);
    }

    #[test]
    fn overlay_extent_matches_js_width_and_does_not_use_hit_chrome() {
        let (w, h) = overlay_extent(128);
        assert_eq!(w, 128.0 + 96.0 + 216.0 + 40.0);
        assert_eq!(h, 128.0 + 96.0 + 266.0);
        let (w0, h0) = overlay_extent_for(128, false);
        assert_eq!(w0, 128.0 + 96.0);
        assert_eq!(h0, 128.0 + 96.0);
    }

    #[test]
    fn hide_needs_destroy_when_hwnd_stays_up() {
        assert!(hide_needs_destroy(true, true));
        assert!(hide_needs_destroy(false, false));
        assert!(!hide_needs_destroy(true, false));
    }

    #[test]
    fn drag_clears_only_when_button_is_known_up() {
        assert!(drag_should_clear(true, Some(false)));
        assert!(!drag_should_clear(true, Some(true)));
        assert!(!drag_should_clear(true, None));
        assert!(!drag_should_clear(false, Some(false)));
    }

    #[test]
    fn hit_radius_is_logical_size_times_scale_times_half() {
        // Shipped formula: r = size_px * scale_factor() * 0.52
        assert_eq!(pet_hit_radius(128, 1.0), 128.0 * 1.0 * 0.52);
        assert_eq!(pet_hit_radius(128, 2.0), 128.0 * 2.0 * 0.52);
        assert_eq!(pet_hit_radius(160, 2.0), 160.0 * 2.0 * 0.52);
    }

    #[test]
    fn retina_hit_covers_the_mark_not_just_logical_pixels() {
        // 128 logical @ 2x → physical mark ~256px; center of that disc is a hit.
        let scale = 2.0;
        let size_px = 128u32;
        let (log_w, log_h) = overlay_extent(size_px);
        let win_w = log_w * scale;
        let win_h = log_h * scale;
        let (_, mark_cy) = mark_center_physical(0.0, 0.0, win_w, win_h, size_px, scale);
        let r = pet_hit_radius(size_px, scale);
        assert!(r > 120.0, "retina radius must exceed logical 66px: {r}");
        assert!(pet_cursor_over_mark(
            win_w / 2.0,
            mark_cy,
            0.0,
            0.0,
            win_w,
            win_h,
            size_px,
            scale,
        ));
        // Far corner of the padded window is click-through.
        assert!(!pet_cursor_over_mark(
            2.0, 2.0, 0.0, 0.0, win_w, win_h, size_px, scale,
        ));
    }

    #[test]
    fn chrome_hit_covers_bubbles_above_the_mark() {
        let chrome = PetHitChrome {
            valid: true,
            mark_cx: 130.0,
            mark_cy: 200.0,
            mark_r: 50.0,
            bubble_x: 22.0,
            bubble_y: 8.0,
            bubble_w: 216.0,
            bubble_h: 80.0,
            window_w: 260.0,
            window_h: 280.0,
        };
        let scale = 2.0;
        let win_w = 260.0 * scale;
        let win_h = 280.0 * scale;
        // Center of a bubble in physical pixels.
        assert!(pet_cursor_over_chrome(
            130.0 * scale,
            40.0 * scale,
            0.0,
            0.0,
            win_w,
            win_h,
            128,
            scale,
            &chrome,
        ));
        // Mark disc.
        assert!(pet_cursor_over_chrome(
            130.0 * scale,
            200.0 * scale,
            0.0,
            0.0,
            win_w,
            win_h,
            128,
            scale,
            &chrome,
        ));
        // Empty padding stays click-through.
        assert!(!pet_cursor_over_chrome(
            4.0, 4.0, 0.0, 0.0, win_w, win_h, 128, scale, &chrome,
        ));
    }

    #[test]
    fn overlay_does_not_keep_key_when_workbench_is_up() {
        assert!(should_return_main_key(true, true, false));
        assert!(
            !should_return_main_key(false, true, false),
            "pet never took key — leave main alone"
        );
        assert!(
            !should_return_main_key(true, false, false),
            "hidden workbench must stay hidden (pet can float over other apps)"
        );
        assert!(
            !should_return_main_key(true, true, true),
            "minimized workbench must not be raised"
        );
    }

    #[test]
    fn show_forces_main_key_back_when_pet_is_unfocused() {
        // macOS show() uses makeKeyAndOrderFront while focusable(false)
        // keeps is_focused() false — still stole key from the workbench.
        assert!(should_force_return_main_key_after_show(false, true, false));
        assert!(
            !should_force_return_main_key_after_show(true, true, false),
            "Linux same-tick yield eats the overlay click"
        );
        assert!(!should_force_return_main_key_after_show(
            false, false, false
        ));
        assert!(!should_force_return_main_key_after_show(false, true, true));
    }

    #[test]
    fn ignore_cursor_only_applies_when_the_value_changes() {
        assert!(pet_ignore_cursor_should_apply(None, true));
        assert!(!pet_ignore_cursor_should_apply(Some(true), true));
        assert!(pet_ignore_cursor_should_apply(Some(true), false));
        assert!(!pet_ignore_cursor_should_apply(Some(false), false));
    }

    #[test]
    fn clamp_returns_saved_pos_when_still_on_a_display() {
        let laptop = WorkRect {
            x: 0.0,
            y: 0.0,
            w: 1680.0,
            h: 1050.0,
        };
        assert_eq!(
            clamp_pet_overlay_pos(1200.0, 650.0, 448.0, 368.0, &[laptop], laptop),
            (1200.0, 650.0)
        );
        let external = WorkRect {
            x: 1680.0,
            y: -200.0,
            w: 1920.0,
            h: 1080.0,
        };
        assert_eq!(
            clamp_pet_overlay_pos(2100.0, 400.0, 448.0, 368.0, &[laptop, external], laptop),
            (2100.0, 400.0),
            "a pet parked on a still-connected second display must stay there"
        );
    }

    #[test]
    fn clamp_relocates_when_saved_pos_is_off_every_display() {
        // Live bug: prefs x=2673 y=1287 after the external monitor went away.
        let laptop = WorkRect {
            x: 0.0,
            y: 0.0,
            w: 1680.0,
            h: 1050.0,
        };
        assert_eq!(
            clamp_pet_overlay_pos(2673.0, 1287.0, 448.0, 368.0, &[laptop], laptop),
            (1680.0 - 448.0 - 24.0, 1050.0 - 368.0 - 24.0)
        );
    }

    #[test]
    fn linux_overlay_stays_focusable_for_pointer_events() {
        assert!(pet_overlay_focusable(true));
        assert!(!pet_overlay_focusable(false));
    }

    #[test]
    fn linux_focus_does_not_yield_key_on_the_same_click() {
        assert!(!should_yield_key_on_pet_focus(true, false, false));
        assert!(should_yield_key_on_pet_focus(false, false, false));
        assert!(!should_yield_key_on_pet_focus(false, true, false));
        assert!(!should_yield_key_on_pet_focus(false, false, true));
    }

    #[test]
    fn nudge_adds_logical_delta() {
        assert_eq!(pet_nudge_origin(100.0, 200.0, -4.0, 6.5), (96.0, 206.5));
    }

    #[test]
    fn wayland_env_detects_display_and_respects_x11_backend() {
        assert!(wayland_display_from_env(Some("wayland-0"), None));
        assert!(wayland_display_from_env(Some("wayland-0"), Some("wayland")));
        assert!(!wayland_display_from_env(Some("wayland-0"), Some("x11")));
        assert!(!wayland_display_from_env(None, None));
        assert!(!wayland_display_from_env(Some(""), None));
    }

    #[test]
    fn wayland_poll_never_sets_click_through() {
        assert_eq!(pet_poll_ignore_cursor(true, false), None);
        assert_eq!(pet_poll_ignore_cursor(true, true), None);
        assert_eq!(pet_poll_ignore_cursor(false, false), Some(true));
        assert_eq!(pet_poll_ignore_cursor(false, true), Some(false));
    }

    #[test]
    fn wayland_policy_is_compact_without_cursor_click_through() {
        let wayland = pet_overlay_policy_for(true);
        assert!(wayland.compact_idle);
        assert!(!wayland.cursor_click_through);
        let other = pet_overlay_policy_for(false);
        assert!(!other.compact_idle);
        assert!(other.cursor_click_through);
    }

    #[test]
    fn compact_overlay_hugs_the_mark() {
        let (w, h) = overlay_compact(128);
        assert_eq!(w, 128.0 + 8.0 * 2.0);
        assert_eq!(h, 128.0 + 8.0 + 16.0);
    }

    #[test]
    fn settings_write_must_not_clobber_a_newer_drag_origin() {
        let prev = PetPrefs {
            x: Some(512.0),
            y: Some(288.0),
            overlay_w: Some(448.0),
            overlay_h: Some(368.0),
            color: "green".into(),
            ..Default::default()
        };
        let mut next = PetPrefs {
            x: Some(0.0),
            y: Some(0.0),
            overlay_w: Some(1.0),
            overlay_h: Some(1.0),
            color: "violet".into(),
            ..Default::default()
        };
        keep_live_overlay_pos(&prev, &mut next);
        assert_eq!(next.x, Some(512.0));
        assert_eq!(next.y, Some(288.0));
        assert_eq!(next.overlay_w, Some(448.0));
        assert_eq!(next.overlay_h, Some(368.0));
        assert_eq!(next.color, "violet");
    }

    #[test]
    fn restore_keeps_the_mark_when_overlay_size_changes() {
        assert_eq!(
            restore_overlay_origin(100.0, 200.0, Some(400.0), Some(300.0), 400.0, 300.0),
            (100.0, 200.0),
            "same size must restore the window origin"
        );
        assert_eq!(
            restore_overlay_origin(100.0, 200.0, Some(400.0), Some(300.0), 400.0, 400.0),
            (100.0, 100.0),
            "taller overlay grows upward so the mark stays put"
        );
        assert_eq!(
            restore_overlay_origin(100.0, 200.0, Some(400.0), Some(300.0), 500.0, 300.0),
            (50.0, 200.0),
            "wider overlay keeps the mark horizontally centered"
        );
        assert_eq!(
            restore_overlay_origin(100.0, 200.0, None, None, 500.0, 400.0),
            (100.0, 200.0),
            "legacy prefs without saved size keep the window origin"
        );
    }

    #[test]
    fn hide_must_not_persist_a_drag_move_after_the_window_is_gone() {
        assert!(should_persist_on_moved(true, true));
        assert!(
            !should_persist_on_moved(true, false),
            "hide/destroy can report 0,0 while DRAGGING is still set"
        );
        assert!(!should_persist_on_moved(false, true));
        assert!(should_persist_after_drag_flag(false));
        assert!(!should_persist_after_drag_flag(true));
        assert!(overlay_pos_is_persistable(12.0, 40.0));
        assert!(!overlay_pos_is_persistable(f64::NAN, 1.0));
        assert!(!overlay_pos_is_persistable(1.0, f64::INFINITY));
    }
}
