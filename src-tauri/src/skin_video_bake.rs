//! Bake video wallpaper for share/export: crop the visible focus slice and
//! trim to clip, then reset focus/clip so cover-fill matches the editor look.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use crate::process_util;

const BAKE_TIMEOUT_SECS: u64 = 180;
const FOCUS_MAX_ZOOM: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelCrop {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VideoBakePlan {
    pub crop: Option<PixelCrop>,
    pub clip: Option<(f64, f64)>,
}

fn clamp(n: f64, min: f64, max: f64) -> f64 {
    if !n.is_finite() {
        return min;
    }
    n.max(min).min(max)
}

fn even_floor(n: i64) -> i64 {
    let n = n.max(0);
    n - (n % 2)
}

pub fn even_pixel_crop(x: f64, y: f64, w: f64, h: f64, media_w: u32, media_h: u32) -> PixelCrop {
    let mw = even_floor(media_w as i64).max(2);
    let mh = even_floor(media_h as i64).max(2);
    let mut x = even_floor(x.floor() as i64);
    let mut y = even_floor(y.floor() as i64);
    let mut w = even_floor(w.floor() as i64).max(2);
    let mut h = even_floor(h.floor() as i64).max(2);
    if x + w > mw {
        x = even_floor(mw - w).max(0);
    }
    if y + h > mh {
        y = even_floor(mh - h).max(0);
    }
    if x + w > mw {
        w = even_floor(mw - x).max(2);
    }
    if y + h > mh {
        h = even_floor(mh - y).max(2);
    }
    PixelCrop {
        x: x as u32,
        y: y as u32,
        w: w as u32,
        h: h as u32,
    }
}

fn cover_visible_size(media_w: f64, media_h: f64, view_aspect: f64, zoom: f64) -> (f64, f64) {
    let mw = media_w.max(1.0);
    let mh = media_h.max(1.0);
    let va = if view_aspect.is_finite() && view_aspect > 0.0 {
        view_aspect
    } else {
        16.0 / 10.0
    };
    let z = clamp(zoom, 1.0, FOCUS_MAX_ZOOM);
    let media_aspect = mw / mh;
    let (mut w, mut h) = if media_aspect > va {
        let h = mh / z;
        (h * va, h)
    } else {
        let w = mw / z;
        (w, w / va)
    };
    w = w.min(mw);
    h = h.min(mh);
    (w, h)
}

fn focus_visible_xywh(
    media_w: u32,
    media_h: u32,
    view_aspect: f64,
    cx: f64,
    cy: f64,
    zoom: f64,
) -> (f64, f64, f64, f64) {
    let mw = media_w.max(1) as f64;
    let mh = media_h.max(1) as f64;
    let cx = clamp(cx, 0.0, 1.0);
    let cy = clamp(cy, 0.0, 1.0);
    let zoom = clamp(zoom, 1.0, FOCUS_MAX_ZOOM);
    let (vw, vh) = cover_visible_size(mw, mh, view_aspect, zoom);
    let x = clamp(cx * mw - vw / 2.0, 0.0, mw - vw);
    let y = clamp(cy * mh - vh / 2.0, 0.0, mh - vh);
    (x, y, vw, vh)
}

pub fn pixel_crop_from_focus(
    media_w: u32,
    media_h: u32,
    view_aspect: f64,
    cx: f64,
    cy: f64,
    zoom: f64,
) -> PixelCrop {
    let (x, y, vw, vh) = focus_visible_xywh(media_w, media_h, view_aspect, cx, cy, zoom);
    even_pixel_crop(x, y, vw, vh, media_w, media_h)
}

/// Still-image crop: exact pixels, no yuv420p even rounding.
pub fn pixel_crop_from_focus_raw(
    media_w: u32,
    media_h: u32,
    view_aspect: f64,
    cx: f64,
    cy: f64,
    zoom: f64,
) -> PixelCrop {
    let mw = media_w.max(1);
    let mh = media_h.max(1);
    let (x, y, vw, vh) = focus_visible_xywh(mw, mh, view_aspect, cx, cy, zoom);
    let mut x = x.floor().max(0.0) as u32;
    let mut y = y.floor().max(0.0) as u32;
    let mut w = vw.floor().max(1.0) as u32;
    let mut h = vh.floor().max(1.0) as u32;
    if x + w > mw {
        x = mw.saturating_sub(w);
    }
    if y + h > mh {
        y = mh.saturating_sub(h);
    }
    if x + w > mw {
        w = mw.saturating_sub(x).max(1);
    }
    if y + h > mh {
        h = mh.saturating_sub(y).max(1);
    }
    PixelCrop { x, y, w, h }
}

fn is_default_focus(cx: f64, cy: f64, zoom: f64) -> bool {
    (cx - 0.5).abs() < 1e-6 && (cy - 0.5).abs() < 1e-6 && (zoom - 1.0).abs() < 1e-6
}

fn is_full_frame(crop: &PixelCrop, media_w: u32, media_h: u32) -> bool {
    crop.x <= 1 && crop.y <= 1 && crop.w + 2 >= media_w && crop.h + 2 >= media_h
}

fn parse_focus(v: &Value) -> (f64, f64, f64) {
    let cx = v.get("cx").and_then(|x| x.as_f64()).unwrap_or(0.5);
    let cy = v.get("cy").and_then(|x| x.as_f64()).unwrap_or(0.5);
    let zoom = v.get("zoom").and_then(|x| x.as_f64()).unwrap_or(1.0);
    (
        clamp(cx, 0.0, 1.0),
        clamp(cy, 0.0, 1.0),
        clamp(zoom, 1.0, FOCUS_MAX_ZOOM),
    )
}

fn parse_clip(v: &Value) -> Option<(f64, f64)> {
    let start = v.get("start").and_then(|x| x.as_f64())?;
    let end = v.get("end").and_then(|x| x.as_f64())?;
    if !start.is_finite() || !end.is_finite() || end - start < 0.25 {
        return None;
    }
    Some((start.max(0.0), end))
}

pub fn plan_video_bake(
    media_w: u32,
    media_h: u32,
    view_aspect: Option<f64>,
    focus: Option<&Value>,
    clip: Option<&Value>,
) -> Option<VideoBakePlan> {
    let mw = media_w.max(1);
    let mh = media_h.max(1);
    let aspect = view_aspect
        .filter(|a| a.is_finite() && *a > 0.0)
        .unwrap_or(mw as f64 / mh as f64);
    let mut crop = None;
    let (cx, cy, zoom) = focus.map(parse_focus).unwrap_or((0.5, 0.5, 1.0));
    let c = pixel_crop_from_focus(mw, mh, aspect, cx, cy, zoom);
    if !is_full_frame(&c, mw, mh) {
        crop = Some(c);
    }
    let clip = clip.and_then(parse_clip);
    if crop.is_none() && clip.is_none() {
        return None;
    }
    Some(VideoBakePlan { crop, clip })
}

/// Spatial crop only (no time clip). Used for still-image wallpaper export.
pub fn plan_image_bake(
    media_w: u32,
    media_h: u32,
    view_aspect: Option<f64>,
    focus: Option<&Value>,
) -> Option<PixelCrop> {
    let mw = media_w.max(1);
    let mh = media_h.max(1);
    let aspect = view_aspect
        .filter(|a| a.is_finite() && *a > 0.0)
        .unwrap_or(mw as f64 / mh as f64);
    let (cx, cy, zoom) = focus.map(parse_focus).unwrap_or((0.5, 0.5, 1.0));
    let c = pixel_crop_from_focus_raw(mw, mh, aspect, cx, cy, zoom);
    if is_full_frame(&c, mw, mh) {
        return None;
    }
    Some(c)
}

fn find_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = which::which("ffmpeg") {
        if process_util::looks_runnable(&p) {
            return Some(p);
        }
    }
    for c in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ] {
        let p = PathBuf::from(c);
        if process_util::looks_runnable(&p) {
            return Some(p);
        }
    }
    #[cfg(windows)]
    {
        let mut cmd = process_util::command("where");
        cmd.arg("ffmpeg");
        process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = PathBuf::from(line.trim());
                    if process_util::looks_runnable(&p) {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

fn probe_size(ffmpeg: &Path, src: &Path) -> Option<(u32, u32)> {
    let probe = ffmpeg
        .parent()
        .map(|d| d.join("ffprobe"))
        .filter(|p| process_util::looks_runnable(p))
        .or_else(|| which::which("ffprobe").ok());
    if let Some(ffprobe) = probe {
        let mut cmd = Command::new(ffprobe);
        cmd.arg("-v")
            .arg("error")
            .arg("-select_streams")
            .arg("v:0")
            .arg("-show_entries")
            .arg("stream=width,height")
            .arg("-of")
            .arg("csv=s=x:p=0")
            .arg(src)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        process_util::apply_no_window_std(&mut cmd);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                let mut it = s.trim().split('x');
                if let (Some(w), Some(h)) = (it.next(), it.next()) {
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                        if w > 0 && h > 0 {
                            return Some((w, h));
                        }
                    }
                }
            }
        }
    }
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-i")
        .arg(src)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    let out = cmd.output().ok()?;
    let err = String::from_utf8_lossy(&out.stderr);
    let re = regex_first_size(&err)?;
    Some(re)
}

fn regex_first_size(s: &str) -> Option<(u32, u32)> {
    // "1920x1080" in ffmpeg -i banner
    for token in s.split(|c: char| !c.is_ascii_digit() && c != 'x') {
        if let Some((w, h)) = token.split_once('x') {
            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                if w >= 16 && h >= 16 && w < 16_000 && h < 16_000 {
                    return Some((w, h));
                }
            }
        }
    }
    None
}

fn run_ffmpeg(mut cmd: Command) -> Result<(), String> {
    process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("invalid_pack: ffmpeg spawn: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(BAKE_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err("invalid_pack: ffmpeg bake failed".into());
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return Err("invalid_pack: ffmpeg bake timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("invalid_pack: ffmpeg wait: {e}")),
        }
    }
}

pub fn bake_video(src: &Path, dest: &Path, plan: &VideoBakePlan) -> Result<(u32, u32), String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg_required: ffmpeg is required to crop/trim a video wallpaper for sharing".to_string()
    })?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("invalid_pack: {e}"))?;
    }
    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y");
    if let Some((start, _)) = plan.clip {
        cmd.arg("-ss").arg(format!("{start:.3}"));
    }
    cmd.arg("-i").arg(src);
    if let Some((start, end)) = plan.clip {
        let dur = (end - start).max(0.25);
        cmd.arg("-t").arg(format!("{dur:.3}"));
    }
    if let Some(c) = &plan.crop {
        cmd.arg("-vf")
            .arg(format!("crop={}:{}:{}:{}", c.w, c.h, c.x, c.y));
    }
    cmd.arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-crf")
        .arg("23")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-an")
        .arg("-movflags")
        .arg("+faststart")
        .arg(dest)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Err(e) = run_ffmpeg(cmd) {
        let _ = std::fs::remove_file(dest);
        return Err(e);
    }
    if !dest.is_file() {
        let _ = std::fs::remove_file(dest);
        return Err("invalid_pack: baked video missing".into());
    }
    let (w, h) = plan
        .crop
        .as_ref()
        .map(|c| (c.w, c.h))
        .or_else(|| probe_size(&ffmpeg, dest))
        .unwrap_or((0, 0));
    Ok((w, h))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoBakeStatus {
    NotNeeded,
    Baked,
    /// Crop/trim wanted, but no ffmpeg — keep original file + focus/clip.
    SkippedNoFfmpeg,
}

/// Crop/trim `src` when the wallpaper object asks for it. Updates `wall` and
/// returns the path to pack (baked temp or original). Does not mutate `src`.
/// Missing ffmpeg is a soft skip: the original file and focus/clip stay so
/// the receiver can still match the editor look.
pub fn maybe_bake_wallpaper_video(
    src: &Path,
    wall: &mut Map<String, Value>,
) -> Result<(PathBuf, VideoBakeStatus), String> {
    maybe_bake_wallpaper_video_with(src, wall, find_ffmpeg())
}

fn maybe_bake_wallpaper_video_with(
    src: &Path,
    wall: &mut Map<String, Value>,
    ffmpeg: Option<PathBuf>,
) -> Result<(PathBuf, VideoBakeStatus), String> {
    let kind = wall
        .get("kind")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if kind != "video" {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), VideoBakeStatus::NotNeeded));
    }
    let (mw, mh) = match (
        wall.get("width").and_then(|x| x.as_u64()).map(|n| n as u32),
        wall.get("height")
            .and_then(|x| x.as_u64())
            .map(|n| n as u32),
    ) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => match ffmpeg.as_ref().and_then(|ff| probe_size(ff, src)) {
            Some(s) => s,
            None => (0, 0),
        },
    };
    if mw == 0 || mh == 0 {
        let needs_crop = wall.get("focus").is_some_and(|f| {
            let (cx, cy, zoom) = parse_focus(f);
            !is_default_focus(cx, cy, zoom)
        });
        if needs_crop {
            wall.remove("viewAspect");
            let status = if ffmpeg.is_none() {
                VideoBakeStatus::SkippedNoFfmpeg
            } else {
                VideoBakeStatus::NotNeeded
            };
            return Ok((src.to_path_buf(), status));
        }
    }
    let view_aspect = wall.get("viewAspect").and_then(|x| x.as_f64());
    let plan = plan_video_bake(
        mw.max(2),
        mh.max(2),
        view_aspect,
        wall.get("focus"),
        wall.get("clip"),
    );
    let Some(plan) = plan else {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), VideoBakeStatus::NotNeeded));
    };
    if ffmpeg.is_none() {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), VideoBakeStatus::SkippedNoFfmpeg));
    }
    let dest = std::env::temp_dir().join(format!(
        "grok-skin-bake-{}-{}.mp4",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let (w, h) = match bake_video(src, &dest, &plan) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
    };
    wall.insert("file".into(), Value::String("assets/wallpaper.mp4".into()));
    wall.insert("kind".into(), Value::String("video".into()));
    wall.insert("mime".into(), Value::String("video/mp4".into()));
    if w > 0 {
        wall.insert("width".into(), Value::from(w));
    }
    if h > 0 {
        wall.insert("height".into(), Value::from(h));
    }
    // Reset to the editor default so cover-fill of the baked file matches
    // the original + focus look at the exporter window aspect.
    wall.insert(
        "focus".into(),
        serde_json::json!({ "cx": 0.5, "cy": 0.5, "zoom": 1.0 }),
    );
    wall.remove("clip");
    wall.remove("viewAspect");
    let bytes = std::fs::read(&dest).map_err(|e| {
        let _ = std::fs::remove_file(&dest);
        format!("invalid_pack: {e}")
    })?;
    let mut hasher = sha2::Sha256::new();
    use sha2::Digest;
    hasher.update(&bytes);
    wall.insert(
        "sha256".into(),
        Value::String(hex::encode(hasher.finalize())),
    );
    Ok((dest, VideoBakeStatus::Baked))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_window_default_focus_skips_spatial_bake() {
        let focus = serde_json::json!({ "cx": 0.5, "cy": 0.5, "zoom": 1 });
        assert!(plan_video_bake(1920, 1080, Some(1920.0 / 1080.0), None, None).is_none());
        assert!(plan_video_bake(1920, 1080, Some(16.0 / 9.0), Some(&focus), None).is_none());
    }

    #[test]
    fn default_focus_still_crops_current_cover_window() {
        let plan = plan_video_bake(1920, 1080, Some(1.6), None, None).unwrap();
        let c = plan.crop.unwrap();
        assert!(c.w < 1920);
        assert_eq!(c.w % 2, 0);
    }

    #[test]
    fn zoomed_focus_plans_smaller_even_crop() {
        let focus = serde_json::json!({ "cx": 0.4, "cy": 0.35, "zoom": 2.0 });
        let plan = plan_video_bake(1920, 1080, Some(1.6), Some(&focus), None).unwrap();
        let c = plan.crop.unwrap();
        assert_eq!(c.w % 2, 0);
        assert_eq!(c.h % 2, 0);
        assert_eq!(c.x % 2, 0);
        assert_eq!(c.y % 2, 0);
        assert!(c.w < 1920);
        assert!(c.h < 1080);
        assert!(c.x + c.w <= 1920);
        assert!(c.y + c.h <= 1080);
        assert!(plan.clip.is_none());
    }

    #[test]
    fn clip_only_no_spatial_crop() {
        let clip = serde_json::json!({ "start": 2.0, "end": 8.0 });
        let plan = plan_video_bake(1920, 1080, Some(16.0 / 9.0), None, Some(&clip)).unwrap();
        assert!(plan.crop.is_none());
        assert_eq!(plan.clip, Some((2.0, 8.0)));
    }

    #[test]
    fn image_plan_uses_raw_crop_and_skips_matching_window() {
        assert!(plan_image_bake(1920, 1080, Some(1920.0 / 1080.0), None).is_none());
        let def = serde_json::json!({ "cx": 0.5, "cy": 0.5, "zoom": 1 });
        assert!(plan_image_bake(1920, 1080, Some(16.0 / 9.0), Some(&def)).is_none());
        let cover = plan_image_bake(1920, 1080, Some(1.6), None).unwrap();
        assert!(cover.w < 1920);
        let focus = serde_json::json!({ "cx": 0.4, "cy": 0.35, "zoom": 2.0 });
        let c = plan_image_bake(1920, 1080, Some(1.6), Some(&focus)).unwrap();
        assert_eq!(
            c,
            PixelCrop {
                x: 336,
                y: 108,
                w: 864,
                h: 540
            }
        );
    }

    #[test]
    fn zoomed_focus_crop_matches_editor_math() {
        let focus = serde_json::json!({ "cx": 0.4, "cy": 0.35, "zoom": 2.0 });
        let plan = plan_video_bake(1920, 1080, Some(1.6), Some(&focus), None).unwrap();
        let c = plan.crop.unwrap();
        assert_eq!(
            c,
            PixelCrop {
                x: 336,
                y: 108,
                w: 864,
                h: 540
            }
        );
    }

    #[test]
    fn maybe_bake_skips_and_strips_view_aspect() {
        let dir = std::env::temp_dir().join(format!("bake-skip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wallpaper.mp4");
        std::fs::write(&src, b"not-a-video").unwrap();
        let mut wall = serde_json::json!({
            "kind": "video",
            "width": 1920,
            "height": 1080,
            "viewAspect": 1.7777777777777777,
            "focus": { "cx": 0.5, "cy": 0.5, "zoom": 1 }
        })
        .as_object()
        .cloned()
        .unwrap();
        let (out, status) = maybe_bake_wallpaper_video(&src, &mut wall).unwrap();
        assert_eq!(out, src);
        assert_eq!(status, VideoBakeStatus::NotNeeded);
        assert!(wall.get("viewAspect").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_ffmpeg_keeps_original_and_focus_clip() {
        let dir = std::env::temp_dir().join(format!("bake-noff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wallpaper.mp4");
        std::fs::write(&src, b"not-a-video").unwrap();
        let mut wall = serde_json::json!({
            "kind": "video",
            "width": 1920,
            "height": 1080,
            "viewAspect": 1.6,
            "focus": { "cx": 0.4, "cy": 0.35, "zoom": 2.0 },
            "clip": { "start": 2.0, "end": 8.0 }
        })
        .as_object()
        .cloned()
        .unwrap();
        let (out, status) = maybe_bake_wallpaper_video_with(&src, &mut wall, None).unwrap();
        assert_eq!(out, src);
        assert_eq!(status, VideoBakeStatus::SkippedNoFfmpeg);
        assert!(wall.get("viewAspect").is_none());
        assert_eq!(wall["focus"]["zoom"], 2.0);
        assert_eq!(wall["clip"]["start"], 2.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bake_crop_and_clip_when_ffmpeg_present() {
        let Some(ffmpeg) = find_ffmpeg() else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("bake-ff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        let mut cmd = std::process::Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=10",
            "-t",
            "2",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&src)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        crate::process_util::apply_no_window_std(&mut cmd);
        if !cmd.status().map(|s| s.success()).unwrap_or(false) {
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        let mut wall = serde_json::json!({
            "kind": "video",
            "width": 320,
            "height": 240,
            "viewAspect": 16.0 / 10.0,
            "focus": { "cx": 0.4, "cy": 0.35, "zoom": 2.0 },
            "clip": { "start": 0.5, "end": 1.5 }
        })
        .as_object()
        .cloned()
        .unwrap();
        let (baked, status) = maybe_bake_wallpaper_video(&src, &mut wall).expect("bake");
        assert_eq!(status, VideoBakeStatus::Baked);
        assert_ne!(baked, src);
        assert!(baked.is_file());
        assert_eq!(wall.get("kind").and_then(|x| x.as_str()), Some("video"));
        assert_eq!(wall.get("mime").and_then(|x| x.as_str()), Some("video/mp4"));
        assert!(wall.get("clip").is_none());
        assert!(wall.get("viewAspect").is_none());
        let focus = wall.get("focus").cloned().unwrap();
        assert_eq!(focus["cx"], 0.5);
        assert_eq!(focus["cy"], 0.5);
        assert_eq!(focus["zoom"], 1.0);
        let bw = wall.get("width").and_then(|x| x.as_u64()).unwrap();
        let bh = wall.get("height").and_then(|x| x.as_u64()).unwrap();
        assert!(bw < 320);
        assert!(bh < 240);
        assert_eq!(bw % 2, 0);
        assert_eq!(bh % 2, 0);
        let _ = std::fs::remove_file(&baked);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
