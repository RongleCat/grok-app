#[tauri::command]
pub async fn pick_directory() -> Result<Option<String>, String> {
    // rfd must run off the async runtime (main-thread dialog on macOS via spawn_blocking)
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择项目目录 / Choose project folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.map(|p| {
        crate::path_scope::grant_path(&p);
        p.display().to_string()
    }))
}

/// Native multi-file picker for composer attachments. Returns empty vec if cancelled.
#[tauri::command]
pub async fn pick_attach_files() -> Result<Vec<String>, String> {
    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("附加文件 / Attach files")
            .pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(files
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            crate::path_scope::grant_path(&p);
            p.display().to_string()
        })
        .collect())
}

/// Native folder picker for attaching a directory as `@path` (optional).
#[tauri::command]
pub async fn pick_attach_folder() -> Result<Option<String>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("附加文件夹 / Attach folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(folder.map(|p| { crate::path_scope::grant_path(&p); p.display().to_string() }))
}

/// Save clipboard / webview File bytes into app attachments dir; return classified path.
/// Used when paste has image data without a filesystem path (screenshots, browser copy).
#[tauri::command]
pub async fn save_temp_attachment(
    bytes_base64: String,
    suggested_name: Option<String>,
    mime: Option<String>,
) -> Result<PathEntry, String> {
    use base64::Engine;
    let raw = bytes_base64.trim();
    // Accept data-URL prefix if present
    let b64 = raw
        .split(',')
        .next_back()
        .unwrap_or(raw)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.is_empty() {
        return Err("empty attachment payload".into());
    }
    // Cap paste size at 40 MiB to avoid runaway memory
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("attachment too large (max 40 MiB)".into());
    }

    let mime = mime.unwrap_or_default().to_lowercase();
    let ext = mime_to_ext(&mime).unwrap_or_else(|| {
        suggested_name
            .as_deref()
            .and_then(|n| {
                std::path::Path::new(n)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_lowercase())
            })
            .unwrap_or_else(|| "bin".into())
    });

    let safe_name = sanitize_attachment_name(
        suggested_name.as_deref(),
        &ext,
    );
    let dir = crate::paths::attachments_paste_dir();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let file_name = format!("{stamp}-{safe_name}");
    let path = dir.join(&file_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("write attachment: {e}"))?;

    let path_str = path.display().to_string();
    Ok(PathEntry {
        path: path_str.clone(),
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or(file_name),
        is_dir: false,
        exists: true,
    })
}

/// Read an image from the OS clipboard (screenshots) and save under attachments/paste.
/// Used when the WebView paste event has no File objects (common on macOS WKWebView).
/// Returns `None` when the clipboard has no image.
#[tauri::command]
pub async fn clipboard_paste_image() -> Result<Option<PathEntry>, String> {
    tauri::async_runtime::spawn_blocking(clipboard_paste_image_sync)
        .await
        .map_err(|e| format!("clipboard task: {e}"))?
}

/// Write a PNG (base64, no data: prefix) to the OS clipboard as an image.
/// WebView `navigator.clipboard.write(image/png)` is unreliable in Tauri.
#[tauri::command]
pub async fn clipboard_write_image(bytes_base64: String) -> Result<(), String> {
    let raw = bytes_base64.trim().to_string();
    if raw.is_empty() {
        return Err("clipboard image payload is empty".into());
    }
    tauri::async_runtime::spawn_blocking(move || clipboard_write_image_sync(&raw))
        .await
        .map_err(|e| format!("clipboard write task: {e}"))?
}

/// Write a local image file to the OS clipboard (arboard).
/// Prefer this over WebView fetch + ClipboardItem for chat cards with a known path.
#[tauri::command]
pub async fn clipboard_write_image_path(path: String) -> Result<(), String> {
    let raw = path.trim().to_string();
    if raw.is_empty() {
        return Err("clipboard image path is empty".into());
    }
    tauri::async_runtime::spawn_blocking(move || clipboard_write_image_path_sync(&raw))
        .await
        .map_err(|e| format!("clipboard write path task: {e}"))?
}

fn clipboard_write_image_bytes(bytes: &[u8]) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};

    if bytes.is_empty() {
        return Err("clipboard image payload is empty".into());
    }
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("clipboard image too large (max 40 MiB)".into());
    }

    let dyn_img = image::load_from_memory(bytes).map_err(|e| format!("decode image: {e}"))?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 {
        return Err("empty image".into());
    }

    let mut cb = Clipboard::new().map_err(|e| format!("clipboard open: {e}"))?;
    let data = ImageData {
        width: w as usize,
        height: h as usize,
        bytes: rgba.into_raw().into(),
    };
    cb.set_image(data)
        .map_err(|e| format!("clipboard set image: {e}"))?;
    Ok(())
}

fn clipboard_write_image_sync(bytes_base64: &str) -> Result<(), String> {
    use base64::Engine;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    clipboard_write_image_bytes(&bytes)
}

fn clipboard_write_image_path_sync(path: &str) -> Result<(), String> {
    use std::path::Path;

    let raw = path.trim();
    if raw.is_empty() {
        return Err("clipboard image path is empty".into());
    }
    if raw.contains('\0') {
        return Err("invalid path".into());
    }
    let candidate = Path::new(raw);
    // Chat images are often outside the initial trusted-project roots but were
    // already granted when media/thumb loaded. User-initiated copy should re-grant
    // the on-disk file (same as attach pickers) so path_scope matches display.
    if candidate.is_file() {
        crate::path_scope::grant_path(candidate);
    }
    let p = crate::path_scope::require_allowed(candidate)?;
    if !p.is_file() {
        return Err(format!("not a file: {raw}"));
    }
    let meta = std::fs::metadata(&p).map_err(|e| format!("stat image: {e}"))?;
    if meta.len() > 40 * 1024 * 1024 {
        return Err("clipboard image too large (max 40 MiB)".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("read image: {e}"))?;
    clipboard_write_image_bytes(&bytes)
}

fn clipboard_paste_image_sync() -> Result<Option<PathEntry>, String> {
    use arboard::Clipboard;

    let mut cb = Clipboard::new().map_err(|e| format!("clipboard open: {e}"))?;
    let img = match cb.get_image() {
        Ok(img) => img,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(format!("clipboard image: {e}")),
    };

    let w = img.width;
    let h = img.height;
    if w == 0 || h == 0 {
        return Ok(None);
    }
    let expected = w.saturating_mul(h).saturating_mul(4);
    if img.bytes.len() < expected {
        return Err(format!(
            "clipboard image truncated ({} < {})",
            img.bytes.len(),
            expected
        ));
    }

    let png = rgba_to_png_bytes(w, h, &img.bytes[..expected])?;
    if png.len() > 40 * 1024 * 1024 {
        return Err("attachment too large (max 40 MiB)".into());
    }

    let dir = crate::paths::attachments_paste_dir();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let file_name = format!("{stamp}-paste.png");
    let path = dir.join(&file_name);
    std::fs::write(&path, &png).map_err(|e| format!("write attachment: {e}"))?;

    Ok(Some(PathEntry {
        path: path.display().to_string(),
        name: file_name,
        is_dir: false,
        exists: true,
    }))
}

/// Encode raw RGBA8 pixels as PNG (clipboard / paste path).
fn rgba_to_png_bytes(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    if width == 0 || height == 0 {
        return Err("empty image".into());
    }
    let expected = width.saturating_mul(height).saturating_mul(4);
    if rgba.len() < expected {
        return Err("rgba buffer too short".into());
    }
    let mut png = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png);
    encoder
        .write_image(
            &rgba[..expected],
            width as u32,
            height as u32,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("png encode: {e}"))?;
    if png.is_empty() {
        return Err("png encode produced empty buffer".into());
    }
    Ok(png)
}

#[cfg(test)]
mod clipboard_paste_tests {
    use super::rgba_to_png_bytes;

    #[test]
    fn rgba_one_pixel_encodes_png_signature() {
        // 1×1 opaque red
        let rgba = [255u8, 0, 0, 255];
        let png = rgba_to_png_bytes(1, 1, &rgba).expect("encode");
        assert!(png.len() > 8);
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
    }

    #[test]
    fn rgba_rejects_short_buffer() {
        assert!(rgba_to_png_bytes(2, 2, &[0u8; 4]).is_err());
    }
}

fn mime_to_ext(mime: &str) -> Option<String> {
    let m = mime.split(';').next().unwrap_or(mime).trim();
    Some(
        match m {
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            "image/svg+xml" => "svg",
            "image/heic" => "heic",
            "image/avif" => "avif",
            "application/pdf" => "pdf",
            "text/plain" => "txt",
            "text/markdown" => "md",
            "application/json" => "json",
            "video/mp4" => "mp4",
            "video/webm" => "webm",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/wav" | "audio/x-wav" => "wav",
            _ => return None,
        }
        .into(),
    )
}

fn sanitize_attachment_name(suggested: Option<&str>, ext: &str) -> String {
    let base = suggested
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("paste");
    let stem = std::path::Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("paste");
    let mut cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        cleaned = "paste".into();
    }
    // Cap stem length
    if cleaned.len() > 64 {
        cleaned.truncate(64);
    }
    let has_ext = std::path::Path::new(base)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false);
    let _ = has_ext;
    format!("{cleaned}.{ext}")
}

/// Classify dropped / picked paths for drag-drop UX (file vs folder).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub exists: bool,
}

/// Normalize OS / browser path strings (file:// URLs, percent-encoding, trailing slashes).
fn normalize_fs_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return s;
    }
    // file://localhost/Users/... or file:///Users/...
    if let Some(rest) = s.strip_prefix("file://") {
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        s = rest.to_string();
        // percent-decode common escapes (spaces, CJK, etc.)
        if s.contains('%') {
            if let Ok(decoded) = urlencoding_lite_decode(&s) {
                s = decoded;
            }
        }
    }
    // drop trailing slash except root
    while s.len() > 1 && (s.ends_with('/') || s.ends_with('\\')) {
        s.pop();
    }
    s
}

/// Minimal percent-decoder (avoid extra crate).
fn urlencoding_lite_decode(input: &str) -> Result<String, ()> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = |c: u8| -> Option<u8> {
                    match c {
                        b'0'..=b'9' => Some(c - b'0'),
                        b'a'..=b'f' => Some(c - b'a' + 10),
                        b'A'..=b'F' => Some(c - b'A' + 10),
                        _ => None,
                    }
                };
                match (h(bytes[i + 1]), h(bytes[i + 2])) {
                    (Some(a), Some(b)) => {
                        out.push((a << 4) | b);
                        i += 3;
                    }
                    _ => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

#[tauri::command]
pub fn paths_classify(paths: Vec<String>) -> Vec<PathEntry> {
    paths
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .map(|raw| {
            let p = normalize_fs_path(&raw);
            let pb = std::path::PathBuf::from(&p);
            let name = pb
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| p.clone());
            // Prefer metadata; if path is missing, still return entry so UI can attach it.
            let meta = std::fs::metadata(&pb).ok();
            let exists = meta.is_some();
            let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
            // User-attached / chat-history paths often sit outside trusted project
            // roots (Desktop, Downloads, Screenshots). Grant them so media://
            // previews in the composer and thread can load.
            if exists {
                crate::path_scope::grant_path(&pb);
            }
            PathEntry {
                path: p,
                name,
                is_dir,
                exists,
            }
        })
        .collect()
}

/// Cached video cover for chat cards: path + mtime + size → JPEG under app cache.
/// Prefer disk cache; extract with ffmpeg when missing. Frontend may also save a
/// canvas capture via [`media_video_poster_save`].
#[tauri::command]
pub async fn media_video_poster(path: String) -> Result<crate::video_poster::VideoPosterResult, String> {
    tokio::task::spawn_blocking(move || crate::video_poster::ensure_video_poster(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Persist a client-captured JPEG poster (canvas) into the same cache key.
#[tauri::command]
pub async fn media_video_poster_save(
    path: String,
    jpeg_base64: String,
) -> Result<crate::video_poster::VideoPosterResult, String> {
    tokio::task::spawn_blocking(move || {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(jpeg_base64.trim())
            .map_err(|e| format!("invalid base64: {e}"))?;
        crate::video_poster::save_client_poster(&path, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cached chat image thumb (JPEG under app cache). Local path or http(s) URL.
/// Chat cards load the thumb via loopback media; lightbox keeps the original.
#[tauri::command]
pub async fn media_image_thumb(
    path_or_url: String,
) -> Result<crate::image_thumb::ImageThumbResult, String> {
    tokio::task::spawn_blocking(move || crate::image_thumb::ensure_image_thumb(&path_or_url))
        .await
        .map_err(|e| e.to_string())?
}

/// Open a file or folder with the OS default application.
///
/// Spawn is fully detached (null stdio, no wait). Holding a pipe or waiting on
/// the default handler used to freeze/black-out the main WebView when opening
/// large PDFs or other slow handlers from the chat file card.
#[tauri::command]
pub async fn path_open(path: String) -> Result<(), String> {
    let p = normalize_fs_path(&path);
    if p.is_empty() {
        return Err("empty path".into());
    }
    let pb = std::path::PathBuf::from(&p);
    if !pb.exists() {
        return Err(format!("path not found: {p}"));
    }
    // Off the async runtime so a slow spawn cannot stall the IPC loop.
    tokio::task::spawn_blocking(move || path_open_detached(&p))
        .await
        .map_err(|e| e.to_string())?
}

fn path_open_detached(p: &str) -> Result<(), String> {
    use std::process::Stdio;
    #[cfg(target_os = "macos")]
    {
        crate::process_util::command("open")
            .arg(p)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // Prefer ShellExecute-style open via `cmd /C start "" <path>`.
        // Null stdio + CREATE_NO_WINDOW (via process_util::command) avoids a
        // flash console and keeps the app UI responsive.
        crate::process_util::command("cmd")
            .args(["/C", "start", "", p])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::process_util::command("xdg-open")
            .arg(p)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
