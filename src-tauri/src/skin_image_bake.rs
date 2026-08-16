//! Bake still-image wallpaper for share/export: crop the visible focus slice
//! and reset focus so cover-fill matches the editor look.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::skin_video_bake::{plan_image_bake, PixelCrop};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageBakeStatus {
    NotNeeded,
    Baked,
    /// Animated gif/webp — keep original + focus so the loop is not flattened.
    SkippedAnimated,
}

fn write_default_focus(wall: &mut Map<String, Value>) {
    wall.insert(
        "focus".into(),
        serde_json::json!({ "cx": 0.5, "cy": 0.5, "zoom": 1.0 }),
    );
    wall.remove("viewAspect");
}

fn is_animated_gif(bytes: &[u8]) -> bool {
    let Ok(dec) = image::codecs::gif::GifDecoder::new(Cursor::new(bytes)) else {
        return false;
    };
    use image::AnimationDecoder;
    dec.into_frames().nth(1).is_some()
}

fn is_animated_webp(bytes: &[u8]) -> bool {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let mut i = 12usize;
    while i + 8 <= bytes.len() {
        let tag = &bytes[i..i + 4];
        let size = u32::from_le_bytes([bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]])
            as usize;
        let data_at = i + 8;
        if tag == b"VP8X" && data_at < bytes.len() {
            // Bit 1 of the VP8X flags byte is animation.
            return (bytes[data_at] & 0x02) != 0;
        }
        if tag == b"ANIM" {
            return true;
        }
        i = data_at.saturating_add(size).saturating_add(size % 2);
        if size == 0 {
            break;
        }
    }
    false
}

fn encode_cropped(
    img: image::DynamicImage,
    src_ext: &str,
) -> Result<(Vec<u8>, &'static str, &'static str), String> {
    let mut buf = Vec::new();
    match src_ext {
        "jpg" | "jpeg" => {
            let rgb = img.to_rgb8();
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
            enc.encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| format!("invalid_pack: jpeg encode: {e}"))?;
            Ok((buf, "jpg", "image/jpeg"))
        }
        _ => {
            img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| format!("invalid_pack: png encode: {e}"))?;
            Ok((buf, "png", "image/png"))
        }
    }
}

fn crop_image(img: &image::DynamicImage, crop: PixelCrop) -> image::DynamicImage {
    img.crop_imm(crop.x, crop.y, crop.w, crop.h)
}

/// Crop `src` when wallpaper focus asks for it. Does not mutate `src`.
/// Animated gif/webp are left intact with focus kept.
pub fn maybe_bake_wallpaper_image(
    src: &Path,
    wall: &mut Map<String, Value>,
) -> Result<(PathBuf, ImageBakeStatus), String> {
    let kind = wall
        .get("kind")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if kind == "video" {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), ImageBakeStatus::NotNeeded));
    }
    let bytes = std::fs::read(src).map_err(|e| format!("invalid_pack: {e}"))?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "gif" && is_animated_gif(&bytes) {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), ImageBakeStatus::SkippedAnimated));
    }
    if (ext == "webp" || bytes.starts_with(b"RIFF")) && is_animated_webp(&bytes) {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), ImageBakeStatus::SkippedAnimated));
    }
    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i,
        Err(_) => {
            wall.remove("viewAspect");
            return Ok((src.to_path_buf(), ImageBakeStatus::NotNeeded));
        }
    };
    // Plan against the decoded file — meta width/height can be stale.
    let mw = img.width();
    let mh = img.height();
    let view_aspect = wall.get("viewAspect").and_then(|x| x.as_f64());
    let Some(crop) = plan_image_bake(mw, mh, view_aspect, wall.get("focus")) else {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), ImageBakeStatus::NotNeeded));
    };
    if crop.x + crop.w > mw || crop.y + crop.h > mh {
        wall.remove("viewAspect");
        return Ok((src.to_path_buf(), ImageBakeStatus::NotNeeded));
    }
    let cropped = crop_image(&img, crop);
    let (out_bytes, out_ext, out_mime) = encode_cropped(cropped, &ext)?;
    let dest = std::env::temp_dir().join(format!(
        "grok-skin-img-bake-{}-{}.{out_ext}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("invalid_pack: {e}"))?;
    }
    if let Err(e) = std::fs::write(&dest, &out_bytes) {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("invalid_pack: {e}"));
    }
    wall.insert(
        "file".into(),
        Value::String(format!("assets/wallpaper.{out_ext}")),
    );
    wall.insert("kind".into(), Value::String("image".into()));
    wall.insert("mime".into(), Value::String(out_mime.into()));
    wall.insert("width".into(), Value::from(crop.w));
    wall.insert("height".into(), Value::from(crop.h));
    write_default_focus(wall);
    let mut hasher = sha2::Sha256::new();
    use sha2::Digest;
    hasher.update(&out_bytes);
    wall.insert("sha256".into(), Value::String(hex::encode(hasher.finalize())));
    Ok((dest, ImageBakeStatus::Baked))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_png(dir: &Path, w: u32, h: u32) -> PathBuf {
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([20, 80, 160]));
        let path = dir.join("src.png");
        image::DynamicImage::ImageRgb8(img)
            .save(&path)
            .expect("save png");
        path
    }

    #[test]
    fn default_focus_skips() {
        let dir = std::env::temp_dir().join(format!("img-bake-skip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = write_png(&dir, 64, 40);
        let mut wall = serde_json::json!({
            "kind": "image",
            "width": 64,
            "height": 40,
            "viewAspect": 1.6,
            "focus": { "cx": 0.5, "cy": 0.5, "zoom": 1 }
        })
        .as_object()
        .cloned()
        .unwrap();
        let (out, status) = maybe_bake_wallpaper_image(&src, &mut wall).unwrap();
        assert_eq!(out, src);
        assert_eq!(status, ImageBakeStatus::NotNeeded);
        assert!(wall.get("viewAspect").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn current_window_cover_crops_without_manual_focus() {
        let dir = std::env::temp_dir().join(format!("img-bake-cover-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = write_png(&dir, 64, 40);
        let mut wall = serde_json::json!({
            "kind": "image",
            "viewAspect": 1.0
        })
        .as_object()
        .cloned()
        .unwrap();
        let (baked, status) = maybe_bake_wallpaper_image(&src, &mut wall).unwrap();
        assert_eq!(status, ImageBakeStatus::Baked);
        let img = image::open(&baked).expect("open baked");
        assert_eq!(img.width(), 40);
        assert_eq!(img.height(), 40);
        assert_eq!(wall["focus"]["zoom"], 1.0);
        let _ = std::fs::remove_file(&baked);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zoomed_focus_writes_smaller_png_and_resets_focus() {
        let dir = std::env::temp_dir().join(format!("img-bake-crop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = write_png(&dir, 1920, 1080);
        let mut wall = serde_json::json!({
            "kind": "image",
            "width": 1920,
            "height": 1080,
            "viewAspect": 1.6,
            "focus": { "cx": 0.4, "cy": 0.35, "zoom": 2.0 }
        })
        .as_object()
        .cloned()
        .unwrap();
        let (baked, status) = maybe_bake_wallpaper_image(&src, &mut wall).unwrap();
        assert_eq!(status, ImageBakeStatus::Baked);
        assert_ne!(baked, src);
        assert!(baked.is_file());
        let img = image::open(&baked).expect("open baked");
        assert!(img.width() < 1920);
        assert!(img.height() < 1080);
        assert_eq!(wall.get("kind").and_then(|x| x.as_str()), Some("image"));
        assert_eq!(wall.get("mime").and_then(|x| x.as_str()), Some("image/png"));
        assert!(wall.get("viewAspect").is_none());
        assert_eq!(wall["focus"]["cx"], 0.5);
        assert_eq!(wall["focus"]["cy"], 0.5);
        assert_eq!(wall["focus"]["zoom"], 1.0);
        assert_eq!(img.width(), wall["width"].as_u64().unwrap() as u32);
        assert_eq!(img.height(), wall["height"].as_u64().unwrap() as u32);
        let _ = std::fs::remove_file(&baked);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_crop_matches_editor_math() {
        let c = crate::skin_video_bake::pixel_crop_from_focus_raw(
            1920, 1080, 1.6, 0.4, 0.35, 2.0,
        );
        assert_eq!(c, PixelCrop { x: 336, y: 108, w: 864, h: 540 });
    }
}
