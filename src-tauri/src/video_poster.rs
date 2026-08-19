//! Cached video cover frames for chat cards.
//!
//! Extract one still (ffmpeg when available) into
//! `~/.grok-app/cache/video-posters/{hash}.jpg` keyed by path + mtime + size
//! so reopening a session never re-decodes the full clip.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::path_scope;
use crate::paths;
use crate::process_util;

/// Max longest edge for poster JPEG (chat card is ≤360px wide).
const POSTER_MAX_EDGE: u32 = 720;

/// ffmpeg wall-clock budget (large files can seek slowly).
const FFMPEG_TIMEOUT_SECS: u64 = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPosterResult {
    /// Absolute path of the JPEG poster on disk.
    pub poster_path: String,
    /// True when the file already existed under the cache key.
    pub from_cache: bool,
}

/// `{app_data}/cache/video-posters`
pub fn video_posters_dir() -> PathBuf {
    paths::video_posters_dir()
}

fn cache_key_for(path: &Path, mtime_secs: u64, size: u64) -> String {
    let mut hasher = Sha256::new();
    // Normalize separators so Windows / Unix path forms share a key when equal.
    let norm = path.to_string_lossy().replace('\\', "/");
    hasher.update(norm.as_bytes());
    hasher.update(b"\0");
    hasher.update(mtime_secs.to_le_bytes());
    hasher.update(size.to_le_bytes());
    let dig = hasher.finalize();
    // Short hex is enough; full 32 bytes keeps collisions negligible.
    dig.iter().take(20).map(|b| format!("{b:02x}")).collect()
}

fn poster_path_for_key(key: &str) -> PathBuf {
    video_posters_dir().join(format!("{key}.jpg"))
}

fn video_meta(path: &Path) -> Result<(u64, u64), String> {
    let meta = fs::metadata(path).map_err(|e| format!("stat video: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok((mtime, size))
}

fn looks_like_video(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "mp4" | "webm" | "mov" | "mkv" | "m4v" | "avi" | "mpeg" | "mpg" | "ogv" | "3gp"
    )
}

/// Resolve ffmpeg binary (PATH + common install locations).
fn find_ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = which::which("ffmpeg") {
        if process_util::looks_runnable(&p) {
            return Some(p);
        }
    }
    // Common macOS / Linux installs not always on GUI app PATH.
    let candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if process_util::looks_runnable(&p) {
            return Some(p);
        }
    }
    #[cfg(windows)]
    {
        // where.exe sometimes finds what which crate misses under GUI PATH.
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

/// Extract one frame near the start into `out` (JPEG).
fn extract_with_ffmpeg(ffmpeg: &Path, video: &Path, out: &Path) -> Result<(), String> {
    // Seek a bit past 0 to avoid pure black intro frames on many clips.
    // scale: longest edge ≤ POSTER_MAX_EDGE, keep aspect.
    let scale = format!(
        "scale='min({POSTER_MAX_EDGE},iw)':'min({POSTER_MAX_EDGE},ih)':force_original_aspect_ratio=decrease"
    );

    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg("0.5")
        .arg("-i")
        .arg(video)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(&scale)
        .arg("-q:v")
        .arg("5")
        .arg("-y")
        .arg(out)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    process_util::apply_no_window_std(&mut cmd);
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }

    let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(FFMPEG_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    use std::io::Read;
                    let _ = pipe.read_to_string(&mut stderr);
                }
                if !status.success() {
                    return Err(format!("ffmpeg failed ({status}): {}", stderr.trim()));
                }
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    tracing::warn!(
                        video = %video.display(),
                        "video poster: ffmpeg timed out after {}s",
                        FFMPEG_TIMEOUT_SECS
                    );
                    return Err("ffmpeg timeout".into());
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("ffmpeg wait: {e}")),
        }
    }

    if !out.is_file() || fs::metadata(out).map(|m| m.len()).unwrap_or(0) < 32 {
        return Err("ffmpeg produced empty poster".into());
    }
    Ok(())
}

/// Get or create a poster JPEG for a local video path.
pub fn ensure_video_poster(path: &str) -> Result<VideoPosterResult, String> {
    let raw = PathBuf::from(path.trim());
    if raw.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    let canonical = path_scope::require_allowed(&raw)?;
    if !looks_like_video(&canonical) {
        return Err("not a video file".into());
    }

    let (mtime, size) = video_meta(&canonical)?;
    let key = cache_key_for(&canonical, mtime, size);
    let poster = poster_path_for_key(&key);

    if poster.is_file() && fs::metadata(&poster).map(|m| m.len()).unwrap_or(0) >= 32 {
        return Ok(VideoPosterResult {
            poster_path: poster.display().to_string(),
            from_cache: true,
        });
    }

    // Ensure parent exists.
    if let Some(parent) = poster.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create poster dir: {e}"))?;
    }

    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    // Write to temp then rename for atomicity.
    let tmp = poster.with_extension("jpg.partial");
    let _ = fs::remove_file(&tmp);
    extract_with_ffmpeg(&ffmpeg, &canonical, &tmp)?;
    fs::rename(&tmp, &poster).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename poster: {e}")
    })?;

    Ok(VideoPosterResult {
        poster_path: poster.display().to_string(),
        from_cache: false,
    })
}

/// Persist a client-captured JPEG (canvas) into the same cache key as host extract.
/// `jpeg_bytes` is raw JPEG (not base64).
pub fn save_client_poster(path: &str, jpeg_bytes: &[u8]) -> Result<VideoPosterResult, String> {
    if jpeg_bytes.len() < 32 || jpeg_bytes.len() > 8 * 1024 * 1024 {
        return Err("invalid poster payload".into());
    }
    // Soft magic check
    if jpeg_bytes[0] != 0xFF || jpeg_bytes[1] != 0xD8 {
        return Err("not a jpeg".into());
    }

    let raw = PathBuf::from(path.trim());
    let canonical = path_scope::require_allowed(&raw)?;
    if !looks_like_video(&canonical) {
        return Err("not a video file".into());
    }

    let (mtime, size) = video_meta(&canonical)?;
    let key = cache_key_for(&canonical, mtime, size);
    let poster = poster_path_for_key(&key);

    if poster.is_file() && fs::metadata(&poster).map(|m| m.len()).unwrap_or(0) >= 32 {
        return Ok(VideoPosterResult {
            poster_path: poster.display().to_string(),
            from_cache: true,
        });
    }

    if let Some(parent) = poster.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create poster dir: {e}"))?;
    }
    let tmp = poster.with_extension("jpg.partial");
    fs::write(&tmp, jpeg_bytes).map_err(|e| format!("write poster: {e}"))?;
    fs::rename(&tmp, &poster).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename poster: {e}")
    })?;

    Ok(VideoPosterResult {
        poster_path: poster.display().to_string(),
        from_cache: false,
    })
}

/// Stable hash helper for tests (path-only, fixed mtime/size).
#[cfg(test)]
fn test_cache_key(path: &str, mtime: u64, size: u64) -> String {
    cache_key_for(Path::new(path), mtime, size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn cache_key_stable_and_sensitive() {
        let a = test_cache_key("/proj/a.mp4", 100, 1000);
        let b = test_cache_key("/proj/a.mp4", 100, 1000);
        let c = test_cache_key("/proj/a.mp4", 101, 1000);
        let d = test_cache_key(r"\proj\a.mp4", 100, 1000); // backslash normalized
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a, d);
        assert_eq!(a.len(), 40); // 20 bytes hex
    }

    #[test]
    fn looks_like_video_ext() {
        assert!(looks_like_video(Path::new("x.MP4")));
        assert!(looks_like_video(Path::new("x.webm")));
        assert!(!looks_like_video(Path::new("x.png")));
        assert!(!looks_like_video(Path::new("x")));
    }

    #[test]
    fn save_client_rejects_bad_payload() {
        let err = save_client_poster("/tmp/nope.mp4", b"short").unwrap_err();
        assert!(err.contains("invalid poster payload"));
        let mut not_jpeg = vec![0u8; 64];
        not_jpeg[0] = 0x00;
        not_jpeg[1] = 0x00;
        let err2 = save_client_poster("/tmp/nope.mp4", &not_jpeg).unwrap_err();
        // Either magic check or path scope (file missing) — both fail safely.
        assert!(
            err2.contains("jpeg")
                || err2.contains("path")
                || err2.contains("not found")
                || err2.contains("not allowed")
        );
    }

    #[test]
    fn save_client_roundtrip_under_app_home() {
        let _lock = paths::APP_HOME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home =
            std::env::temp_dir().join(format!("grok-app-poster-home-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("GROK_APP_HOME", &home);
        path_scope::refresh_from_store();

        let vid_dir = home.join("clips");
        fs::create_dir_all(&vid_dir).unwrap();
        let vid = vid_dir.join("story.mp4");
        {
            let mut f = fs::File::create(&vid).unwrap();
            f.write_all(b"fake-mp4-bytes-for-meta").unwrap();
        }

        // Minimal valid JPEG: SOI + EOI (too small for our 32-byte check) — pad.
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9];
        jpeg.resize(64, 0);

        let r = save_client_poster(vid.to_str().unwrap(), &jpeg).expect("save");
        assert!(!r.from_cache);
        assert!(Path::new(&r.poster_path).is_file());

        let r2 = save_client_poster(vid.to_str().unwrap(), &jpeg).expect("cache hit");
        assert!(r2.from_cache);
        assert_eq!(r.poster_path, r2.poster_path);

        std::env::remove_var("GROK_APP_HOME");
        path_scope::refresh_from_store();
        let _ = fs::remove_dir_all(&home);
    }
}
