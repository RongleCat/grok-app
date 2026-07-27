//! Project-scoped filesystem browser for the right-pane resource viewer.
//! All paths are resolved under an explicit project root (no escape).

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use base64::Engine;
use serde::Serialize;

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB text preview
const MAX_BINARY_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB image / pdf
/// Office packages streamed to the UI for rich render (docx-preview / xlsx / pdf).
const MAX_OFFICE_STREAM_BYTES: u64 = 40 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub ext: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResult {
    pub relative_path: String,
    pub name: String,
    /// Absolute filesystem path for stream preview (video/audio/image via asset protocol).
    pub absolute_path: String,
    pub size: u64,
    pub kind: String,
    pub mime: String,
    pub text: Option<String>,
    pub base64: Option<String>,
    /// Prefer streaming the file path instead of embedding base64 (media / large files).
    pub stream: bool,
    pub truncated: bool,
    pub error: Option<String>,
    /// Last modified time (ms since UNIX epoch) for dirty/conflict checks when editing.
    #[serde(default)]
    pub mtime_ms: u64,
}

/// Result of writing a text file from the resource pane.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResult {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub mtime_ms: u64,
}

fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ok_result(
    path: &Path,
    relative_path: String,
    name: String,
    size: u64,
    kind: String,
    mime: String,
    text: Option<String>,
    base64: Option<String>,
    stream: bool,
    truncated: bool,
    error: Option<String>,
) -> FsReadResult {
    FsReadResult {
        relative_path,
        name,
        absolute_path: path.to_string_lossy().to_string(),
        size,
        kind,
        mime,
        text,
        base64,
        stream,
        truncated,
        error,
        mtime_ms: file_mtime_ms(path),
    }
}

fn normalize_rel(relative: &str) -> String {
    relative
        .trim()
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn join_rel(parent: &str, name: &str) -> String {
    let p = normalize_rel(parent);
    if p.is_empty() {
        name.to_string()
    } else {
        format!("{p}/{name}")
    }
}

fn lexical_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = normalize_rel(relative);
    let mut out = root.to_path_buf();
    if rel.is_empty() || rel == "." {
        return Ok(out);
    }
    for comp in Path::new(&rel).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("path escapes project root".into());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("absolute path not allowed".into());
            }
        }
    }
    // Ensure still under root (lexical)
    if !out.starts_with(root) {
        return Err("path escapes project root".into());
    }
    Ok(out)
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn guess_kind(ext: &str, is_dir: bool) -> &'static str {
    if is_dir {
        return "dir";
    }
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => "image",
        "pdf" => "pdf",
        "mp4" | "webm" | "mov" | "mkv" => "video",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" => "audio",
        "json" | "jsonc" => "json",
        "md" | "mdx" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "css" | "scss" | "less" => "css",
        "csv" | "tsv" => "csv",
        "xml" | "yml" | "yaml" | "toml" | "ini" | "env" | "conf" | "config" => "config",
        // Office Open XML / ODF — extract text for preview
        "docx" | "docm" | "dotx" | "dotm" => "docx",
        "xlsx" | "xlsm" | "xltx" | "xltm" => "xlsx",
        "pptx" | "pptm" | "potx" | "potm" => "pptx",
        "odt" | "ods" | "odp" => "odf",
        "doc" | "xls" | "ppt" => "office_legacy",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "kt" | "swift" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "sh" | "bash" | "zsh" | "sql" | "vue"
        | "svelte" | "dart" | "lua" | "r" | "scala" | "zig" | "ex" | "exs" | "clj" | "fs"
        | "fsx" | "gradle" | "dockerfile" | "makefile" | "cmake" | "mdc" | "map" => "code",
        "txt" | "log" | "gitignore" | "gitattributes" | "editorconfig" | "lock" | "license" => {
            "text"
        }
        "zip" | "tar" | "gz" | "tgz" | "bz2" | "7z" | "rar" | "xz" => "archive",
        "woff" | "woff2" | "ttf" | "otf" | "eot" => "font",
        _ => "text",
    }
}

fn mime_of(ext: &str, kind: &str) -> String {
    match (kind, ext) {
        ("image", "png") => "image/png".into(),
        ("image", "jpg" | "jpeg") => "image/jpeg".into(),
        ("image", "gif") => "image/gif".into(),
        ("image", "webp") => "image/webp".into(),
        ("image", "svg") => "image/svg+xml".into(),
        ("image", "bmp") => "image/bmp".into(),
        ("image", "ico") => "image/x-icon".into(),
        ("image", "avif") => "image/avif".into(),
        ("pdf", _) => "application/pdf".into(),
        ("video", "mp4") => "video/mp4".into(),
        ("video", "webm") => "video/webm".into(),
        ("video", "mov") => "video/quicktime".into(),
        ("audio", "mp3") => "audio/mpeg".into(),
        ("audio", "wav") => "audio/wav".into(),
        ("audio", "ogg") => "audio/ogg".into(),
        ("json", _) => "application/json".into(),
        ("markdown", _) => "text/markdown".into(),
        ("html", _) => "text/html".into(),
        ("css", _) => "text/css".into(),
        ("csv", "tsv") => "text/tab-separated-values".into(),
        ("csv", _) => "text/csv".into(),
        ("docx", _) => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into()
        }
        ("xlsx", _) => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into()
        }
        ("pptx", _) => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into()
        }
        ("odf", "odt") => "application/vnd.oasis.opendocument.text".into(),
        ("odf", "ods") => "application/vnd.oasis.opendocument.spreadsheet".into(),
        ("odf", "odp") => "application/vnd.oasis.opendocument.presentation".into(),
        _ if kind == "code" || kind == "text" || kind == "config" || kind == "office" => {
            "text/plain".into()
        }
        _ => "application/octet-stream".into(),
    }
}

/// Strip XML tags and decode a few common entities for OOXML / ODF preview text.
fn xml_to_plain(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 4);
    let mut in_tag = false;
    let mut chars = xml.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            in_tag = true;
            // Paragraph / break markers → newline
            let rest: String = chars.clone().take(12).collect();
            let lower = rest.to_ascii_lowercase();
            if lower.starts_with("w:p ")
                || lower.starts_with("w:p>")
                || lower.starts_with("/w:p>")
                || lower.starts_with("w:br")
                || lower.starts_with("w:cr")
                || lower.starts_with("text:p")
                || lower.starts_with("/text:p")
                || lower.starts_with("a:p ")
                || lower.starts_with("a:p>")
                || lower.starts_with("/a:p")
            {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            continue;
        }
        if c == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        if c == '&' {
            let ent: String = chars.clone().take(8).collect();
            if let Some(decoded) = decode_entity(&ent) {
                out.push_str(decoded.0);
                for _ in 0..decoded.1 {
                    chars.next();
                }
                continue;
            }
        }
        out.push(c);
    }
    // collapse 3+ newlines
    let mut cleaned = String::new();
    let mut nl = 0;
    for c in out.chars() {
        if c == '\n' {
            nl += 1;
            if nl <= 2 {
                cleaned.push(c);
            }
        } else if c == '\r' {
            continue;
        } else {
            nl = 0;
            cleaned.push(c);
        }
    }
    cleaned.trim().to_string()
}

fn decode_entity(s: &str) -> Option<(&'static str, usize)> {
    if s.starts_with("amp;") {
        Some(("&", 4))
    } else if s.starts_with("lt;") {
        Some(("<", 3))
    } else if s.starts_with("gt;") {
        Some((">", 3))
    } else if s.starts_with("quot;") {
        Some(("\"", 5))
    } else if s.starts_with("apos;") {
        Some(("'", 5))
    } else if s.starts_with("nbsp;") {
        Some((" ", 5))
    } else {
        None
    }
}

fn read_zip_entry_text(path: &Path, entry_name: &str) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip: {e}"))?;
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|e| format!("zip entry {entry_name}: {e}"))?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("read zip entry: {e}"))?;
    Ok(buf)
}

fn read_zip_entries_matching(path: &Path, prefix: &str, suffix: &str) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip: {e}"))?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("zip index: {e}"))?;
        let name = entry.name().to_string();
        if name.starts_with(prefix) && name.ends_with(suffix) {
            names.push(name);
        }
    }
    names.sort();
    let mut texts = Vec::new();
    for name in names {
        let mut entry = archive
            .by_name(&name)
            .map_err(|e| format!("zip entry {name}: {e}"))?;
        let mut buf = String::new();
        if entry.read_to_string(&mut buf).is_ok() {
            texts.push(buf);
        }
    }
    Ok(texts)
}

/// Extract plain text from Office Open XML / ODF packages.
fn extract_office_text(path: &Path, kind: &str) -> Result<String, String> {
    match kind {
        "docx" => {
            let xml = read_zip_entry_text(path, "word/document.xml")?;
            let text = xml_to_plain(&xml);
            if text.is_empty() {
                Err("docx has no extractable text".into())
            } else {
                Ok(text)
            }
        }
        "xlsx" => {
            // shared strings + all sheet xml
            let mut parts = Vec::new();
            if let Ok(ss) = read_zip_entry_text(path, "xl/sharedStrings.xml") {
                let t = xml_to_plain(&ss);
                if !t.is_empty() {
                    parts.push(t);
                }
            }
            let sheets = read_zip_entries_matching(path, "xl/worksheets/", ".xml")?;
            for (i, xml) in sheets.into_iter().enumerate() {
                let t = xml_to_plain(&xml);
                if !t.is_empty() {
                    parts.push(format!("--- Sheet {} ---\n{t}", i + 1));
                }
            }
            if parts.is_empty() {
                Err("xlsx has no extractable text".into())
            } else {
                Ok(parts.join("\n\n"))
            }
        }
        "pptx" => {
            let slides = read_zip_entries_matching(path, "ppt/slides/slide", ".xml")?;
            let mut parts = Vec::new();
            for (i, xml) in slides.into_iter().enumerate() {
                let t = xml_to_plain(&xml);
                if !t.is_empty() {
                    parts.push(format!("--- Slide {} ---\n{t}", i + 1));
                }
            }
            if parts.is_empty() {
                Err("pptx has no extractable text".into())
            } else {
                Ok(parts.join("\n\n"))
            }
        }
        "odf" => {
            let xml = read_zip_entry_text(path, "content.xml")?;
            let text = xml_to_plain(&xml);
            if text.is_empty() {
                Err("odf has no extractable text".into())
            } else {
                Ok(text)
            }
        }
        _ => Err("unsupported office format".into()),
    }
}

pub fn list_dir(project_root: &str, relative: &str) -> Result<Vec<FsEntry>, String> {
    let root = PathBuf::from(project_root);
    if !root.is_dir() {
        return Err(format!("project root is not a directory: {project_root}"));
    }
    let parent_rel = normalize_rel(relative);
    let dir = lexical_join(&root, &parent_rel)?;
    if !dir.is_dir() {
        return Err(format!("not a directory: {parent_rel}"));
    }
    let mut entries = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        // Always hide VCS / macOS noise (never list .git directory or contents entry).
        if name == ".DS_Store" || name == ".git" || name == "Thumbs.db" {
            continue;
        }
        let meta = match ent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        // Always build relative path from parent + name (never absolute)
        let rel = join_rel(&parent_rel, &name);
        entries.push(FsEntry {
            name: name.clone(),
            relative_path: rel,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            ext: if is_dir { String::new() } else { ext_of(&name) },
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

pub fn read_file(project_root: &str, relative: &str) -> Result<FsReadResult, String> {
    let root = PathBuf::from(project_root);
    if !root.is_dir() {
        return Err(format!("project root is not a directory: {project_root}"));
    }
    let rel_in = normalize_rel(relative);
    if rel_in.is_empty() {
        return Err("empty relative path".into());
    }
    let path = lexical_join(&root, &rel_in)?;
    if !path.is_file() {
        return Err(format!("not a file: {rel_in}"));
    }
    read_path(path, rel_in)
}

/// Write UTF-8 text under a project root (resource pane Save).
///
/// When `expected_mtime_ms` is `Some` and the on-disk mtime differs, returns
/// `Err` starting with `CONFLICT:` so the UI can offer reload vs overwrite
/// (agent or external editor may have written the same path).
pub fn write_text_file(
    project_root: &str,
    relative: &str,
    content: &str,
    expected_mtime_ms: Option<u64>,
) -> Result<FsWriteResult, String> {
    let root = PathBuf::from(project_root);
    if !root.is_dir() {
        return Err(format!("project root is not a directory: {project_root}"));
    }
    let rel_in = normalize_rel(relative);
    if rel_in.is_empty() {
        return Err("empty relative path".into());
    }
    let path = lexical_join(&root, &rel_in)?;
    write_text_at_path(path, rel_in, content, expected_mtime_ms)
}

/// Write UTF-8 text to an absolute path opened in the resource pane.
pub fn write_text_absolute(
    absolute: &str,
    content: &str,
    expected_mtime_ms: Option<u64>,
) -> Result<FsWriteResult, String> {
    let raw = absolute.trim();
    if raw.is_empty() {
        return Err("empty path".into());
    }
    if raw.contains('\0') {
        return Err("invalid path".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_file() {
        return Err(format!("not a file: {raw}"));
    }
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| raw.to_string());
    write_text_at_path(path, name, content, expected_mtime_ms)
}

fn write_text_at_path(
    path: PathBuf,
    relative_path: String,
    content: &str,
    expected_mtime_ms: Option<u64>,
) -> Result<FsWriteResult, String> {
    if !path.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    let bytes = content.as_bytes();
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err(format!(
            "file too large to save in-app (max {MAX_TEXT_BYTES} bytes)"
        ));
    }

    if let Some(expected) = expected_mtime_ms {
        if expected > 0 {
            let actual = file_mtime_ms(&path);
            if actual > 0 && actual != expected {
                return Err(format!(
                    "CONFLICT: file changed on disk (mtime {actual}, expected {expected})"
                ));
            }
        }
    }

    // Atomic-ish: write temp then rename within same directory.
    let parent = path
        .parent()
        .ok_or_else(|| "invalid parent directory".to_string())?;
    let tmp_name = format!(
        ".{}.grok-save-{}",
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file"),
        std::process::id()
    );
    let tmp = parent.join(tmp_name);
    fs::write(&tmp, bytes).map_err(|e| format!("write temp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename into place: {e}")
    })?;

    let meta = fs::metadata(&path).map_err(|e| format!("stat after write: {e}"))?;
    Ok(FsWriteResult {
        relative_path,
        absolute_path: path.to_string_lossy().to_string(),
        size: meta.len(),
        mtime_ms: file_mtime_ms(&path),
    })
}

/// Read any absolute filesystem path for chat → resource pane preview.
/// Not limited to a project root (agent outputs, session media, etc.).
pub fn read_absolute_file(absolute: &str) -> Result<FsReadResult, String> {
    let raw = absolute.trim();
    if raw.is_empty() {
        return Err("empty path".into());
    }
    if raw.contains('\0') {
        return Err("invalid path".into());
    }
    let path = PathBuf::from(raw);
    let path = path
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    if !path.is_file() {
        return Err(format!("not a file: {raw}"));
    }
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| raw.to_string());
    // relative_path field carries the absolute path for absolute opens
    read_path(path, name)
}

/// True when a path token uses shell-style wildcards (agent docs often write
/// `docs/plans/2026-03-15-foo*.md` instead of the exact filename).
fn path_has_glob(s: &str) -> bool {
    s.chars().any(|c| c == '*' || c == '?')
}

/// Match `name` against a simple shell-style pattern (`*` = any run, `?` = one char).
/// No character classes, no recursive `**` — enough for agent basename globs.
fn simple_glob_match(pattern: &str, name: &str) -> bool {
    fn rec(p: &[u8], n: &[u8]) -> bool {
        let mut i = 0usize;
        let mut j = 0usize;
        let mut star_p: Option<usize> = None;
        let mut star_n: usize = 0;
        while j < n.len() {
            if i < p.len() && (p[i] == b'?' || p[i] == n[j]) {
                i += 1;
                j += 1;
            } else if i < p.len() && p[i] == b'*' {
                star_p = Some(i);
                star_n = j;
                i += 1;
            } else if let Some(sp) = star_p {
                i = sp + 1;
                star_n += 1;
                j = star_n;
            } else {
                return false;
            }
        }
        while i < p.len() && p[i] == b'*' {
            i += 1;
        }
        i == p.len()
    }
    rec(pattern.as_bytes(), name.as_bytes())
}

/// Resolve a relative path that contains `*` / `?` under `base`.
/// Only the final path segment may be a glob; parent dirs must exist exactly.
///
/// - 0 matches → None
/// - 1 match → Some(path)
/// - many matches → prefer shortest basename (agent `foo*.md` usually means
///   the canonical short name), then lexicographic; still returns one hit so
///   chat cards can open.
fn resolve_relative_glob(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim().trim_start_matches("./").replace('\\', "/");
    if rel.is_empty() || !path_has_glob(&rel) {
        return None;
    }
    // Reject path-segment globs in parent components (avoid broad scans).
    let mut parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let file_pat = parts.pop()?;
    if !path_has_glob(file_pat) {
        return None;
    }
    if parts.iter().any(|p| path_has_glob(p)) {
        return None;
    }
    let mut dir = base.to_path_buf();
    for p in &parts {
        dir = dir.join(p);
    }
    if !dir.is_dir() {
        return None;
    }
    let mut hits: Vec<PathBuf> = Vec::new();
    let rd = fs::read_dir(&dir).ok()?;
    for ent in rd.flatten() {
        let ft = match ent.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !ft.is_file() {
            continue;
        }
        let name = ent.file_name();
        let name_str = name.to_string_lossy();
        if simple_glob_match(file_pat, name_str.as_ref()) {
            hits.push(ent.path());
        }
    }
    match hits.len() {
        0 => None,
        1 => hits.pop(),
        _ => {
            hits.sort_by(|a, b| {
                let an = a
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let bn = b
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                an.len()
                    .cmp(&bn.len())
                    .then_with(|| an.to_lowercase().cmp(&bn.to_lowercase()))
            });
            hits.into_iter().next()
        }
    }
}

/// Open a path for chat cards: absolute file, project-relative, sibling under
/// project parent (e.g. `知识库/...` next to `ai-center/`), or suffix search.
/// Strip agent ellipsis truncation: `.../a/b/c.jpg` → `a/b/c.jpg`.
/// Does **not** strip a leading `/` from real absolute paths.
fn strip_path_ellipsis(path: &str) -> String {
    let mut t = path.trim().replace('\\', "/");
    let mut stripped_ellipsis = false;
    // Leading .../ or …/
    while t.starts_with("...") || t.starts_with('…') {
        stripped_ellipsis = true;
        if let Some(rest) = t.strip_prefix("...") {
            t = rest.trim_start_matches('/').to_string();
        } else if let Some(rest) = t.strip_prefix('…') {
            t = rest.trim_start_matches('/').to_string();
        } else {
            break;
        }
    }
    // Mid-path /.../
    if t.contains("/.../") {
        stripped_ellipsis = true;
        if let Some(tail) = t.rsplit("/.../").next() {
            t = tail.to_string();
        }
    }
    if t.contains("/…/") {
        stripped_ellipsis = true;
        if let Some(tail) = t.rsplit("/…/").next() {
            t = tail.to_string();
        }
    }
    t = t.trim_start_matches("./").to_string();
    // Only drop a leftover leading slash when we actually removed ellipsis
    // (absolute paths like `/Users/...` must stay absolute).
    if stripped_ellipsis {
        t = t.trim_start_matches('/').to_string();
    }
    t
}

pub fn open_path_smart(project_root: Option<&str>, path: &str) -> Result<FsReadResult, String> {
    let raw_in = path.trim();
    if raw_in.is_empty() {
        return Err("empty path".into());
    }
    if raw_in.contains('\0') {
        return Err("invalid path".into());
    }
    // Normalize ellipsis-truncated agent paths before any lookup.
    let raw = {
        let stripped = strip_path_ellipsis(raw_in);
        if stripped.is_empty() {
            raw_in.to_string()
        } else if stripped != raw_in.trim().replace('\\', "/") {
            stripped
        } else {
            raw_in.replace('\\', "/")
        }
    };

    // 1) Absolute path that exists
    let as_path = PathBuf::from(&raw);
    if as_path.is_absolute() {
        if as_path.is_file() {
            let canon = as_path
                .canonicalize()
                .map_err(|e| format!("path not found: {e}"))?;
            let name = canon
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| raw.to_string());
            return read_path(canon, name);
        }
        // Absolute but missing — try suffix under project / parent
        if let Some(found) = search_under_project_and_parent(project_root, &raw) {
            let name = found
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| raw.to_string());
            return read_path(found, name);
        }
        return Err(format!("not a file: {raw}"));
    }

    // 2) Relative: project_root/rel, then parent(project)/rel, then suffix
    let rel = raw.trim_start_matches("./");
    if let Some(root) = project_root {
        let root_pb = PathBuf::from(root);
        if root_pb.is_dir() {
            let joined = root_pb.join(rel);
            if joined.is_file() {
                let canon = joined
                    .canonicalize()
                    .map_err(|e| format!("path not found: {e}"))?;
                let name = canon
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| raw.to_string());
                return read_path(canon, name);
            }

            // 2b) Agent basename globs: `docs/plans/2026-03-15-foo*.md`
            if path_has_glob(rel) {
                if let Some(found) = resolve_relative_glob(&root_pb, rel) {
                    let canon = found
                        .canonicalize()
                        .map_err(|e| format!("path not found: {e}"))?;
                    let name = canon
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| raw.to_string());
                    return read_path(canon, name);
                }
                // Also try under project parent (sibling knowledge-base layouts)
                if let Some(parent) = root_pb.parent() {
                    if parent.is_dir() {
                        if let Some(found) = resolve_relative_glob(parent, rel) {
                            let canon = found
                                .canonicalize()
                                .map_err(|e| format!("path not found: {e}"))?;
                            let name = canon
                                .file_name()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| raw.to_string());
                            return read_path(canon, name);
                        }
                        // Sibling project folders: try each child once
                        if let Ok(rd) = fs::read_dir(parent) {
                            for ent in rd.flatten() {
                                let p = ent.path();
                                if p == root_pb || !p.is_dir() {
                                    continue;
                                }
                                if let Some(found) = resolve_relative_glob(&p, rel) {
                                    let canon = found
                                        .canonicalize()
                                        .map_err(|e| format!("path not found: {e}"))?;
                                    let name = canon
                                        .file_name()
                                        .map(|s| s.to_string_lossy().to_string())
                                        .unwrap_or_else(|| raw.to_string());
                                    return read_path(canon, name);
                                }
                            }
                        }
                    }
                }
            }

            // 3) Sibling *path* under parent — e.g. path already starts with `知识库/…`
            //    project = .../document/ai-center
            //    path    = 知识库/wiki/.../x.md
            //    real    = .../document/知识库/wiki/.../x.md
            if let Some(parent) = root_pb.parent() {
                if parent.is_dir() {
                    let sibling = parent.join(rel);
                    if sibling.is_file() {
                        let canon = sibling
                            .canonicalize()
                            .map_err(|e| format!("path not found: {e}"))?;
                        let name = canon
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| raw.to_string());
                        return read_path(canon, name);
                    }

                    // 3b) Path is relative to a *sibling folder* of the project
                    //    (shared knowledge base layout):
                    //    project = .../document/ai-center
                    //    path    = raw/articles/x/foo/README.md
                    //    real    = .../document/知识库/raw/articles/x/foo/README.md
                    //    Only exact join under each sibling — no recursive scan.
                    if let Ok(rd) = fs::read_dir(parent) {
                        for ent in rd.flatten() {
                            let p = ent.path();
                            if p == root_pb || !p.is_dir() {
                                continue;
                            }
                            let joined = p.join(rel);
                            if joined.is_file() {
                                let canon = joined
                                    .canonicalize()
                                    .map_err(|e| format!("path not found: {e}"))?;
                                let name = canon
                                    .file_name()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_else(|| raw.to_string());
                                return read_path(canon, name);
                            }
                        }
                    }
                }
            }

            // 4) Suffix search under project (monorepo subfolder paths)
            if let Some(found) = find_file_by_suffix(&root_pb, &raw) {
                let name = found
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| raw.to_string());
                return read_path(found, name);
            }

            // 5) Suffix under parent when first segment is a direct child of parent
            //    (e.g. first segment `知识库` under `document/`).
            if let Some(parent) = root_pb.parent() {
                if parent.is_dir() {
                    if let Some(first) = Path::new(rel).components().next() {
                        let first_name = first.as_os_str();
                        let candidate_root = parent.join(first_name);
                        if candidate_root.is_dir() {
                            if let Some(found) = find_file_by_suffix(&candidate_root, &raw) {
                                let name = found
                                    .file_name()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_else(|| raw.to_string());
                                return read_path(found, name);
                            }
                        }
                    }

                    // 5b) Multi-segment relative path: suffix-search under each
                    //     sibling when the path has enough structure (≥2 segs)
                    //     so bare `README.md` does not scan all siblings.
                    let segs: Vec<_> = Path::new(rel)
                        .components()
                        .filter_map(|c| match c {
                            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                            _ => None,
                        })
                        .collect();
                    if segs.len() >= 2 {
                        if let Ok(rd) = fs::read_dir(parent) {
                            for ent in rd.flatten() {
                                let p = ent.path();
                                if p == root_pb || !p.is_dir() {
                                    continue;
                                }
                                if let Some(found) = find_file_by_suffix(&p, &raw) {
                                    let name = found
                                        .file_name()
                                        .map(|s| s.to_string_lossy().to_string())
                                        .unwrap_or_else(|| raw.to_string());
                                    return read_path(found, name);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!("not a file: {raw}"))
}

fn search_under_project_and_parent(
    project_root: Option<&str>,
    path_or_suffix: &str,
) -> Option<PathBuf> {
    let root = project_root?;
    let root_pb = PathBuf::from(root);
    if root_pb.is_dir() {
        if let Some(found) = find_file_by_suffix(&root_pb, path_or_suffix) {
            return Some(found);
        }
        if let Some(parent) = root_pb.parent() {
            if parent.is_dir() {
                // Prefer exact join of path tail under parent children
                let candidates = suffix_candidates(path_or_suffix);
                for suf in candidates {
                    let joined = parent.join(&suf);
                    if joined.is_file() {
                        return Some(joined);
                    }
                }
            }
        }
    }
    None
}

/// Walk project (skip heavy dirs) looking for a path ending with `suffix`.
/// Tries longest suffix first: `05-handoff/next.md` before `next.md`.
///
/// Safety:
/// - Multi-segment suffixes (`a/b/c.md`) are specific enough → first BFS hit.
/// - Bare basenames (`README.md`) only succeed when **exactly one** match exists
///   under the walk — never pick an arbitrary homonym.
fn find_file_by_suffix(root: &Path, path_or_suffix: &str) -> Option<PathBuf> {
    let candidates = suffix_candidates(path_or_suffix);
    for suf in candidates {
        if let Some(found) = find_one_suffix(root, &suf) {
            return Some(found);
        }
    }
    None
}

fn find_one_suffix(root: &Path, suffix: &str) -> Option<PathBuf> {
    use std::collections::VecDeque;

    if suffix.is_empty() {
        return None;
    }
    let skip = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".next",
        "vendor",
        ".cache",
        "repos",
        ".venv",
        "venv",
        "__pycache__",
        ".turbo",
        "coverage",
        "out",
    ];
    // Prefer monorepo-ish roots so handoff/research files are visited early.
    let priority = [
        "projects",
        "docs",
        "src",
        "playbook",
        "programs",
        "memory",
        "ops",
        "wiki",
        "knowledge",
        "05-handoff",
        "01-research",
        "02-plan",
        "03-build",
        "04-review",
    ];
    let is_basename = !suffix.contains('/') && !suffix.contains('\\');
    let needle = format!("/{suffix}");
    // Bare names: wider scan + uniqueness check. Multi-segment: smaller budget.
    let max_visits: usize = if is_basename { 50_000 } else { 15_000 };

    let is_priority = |name: &str| priority.iter().any(|p| *p == name);

    let matches_file = |path: &Path, file_name: &str| -> bool {
        if is_basename {
            return file_name == suffix;
        }
        let s = path.to_string_lossy().replace('\\', "/");
        s.ends_with(&needle) || s.ends_with(suffix)
    };

    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    let mut hits: Vec<PathBuf> = Vec::new();

    // Seed: priority children of root first (true BFS), then the rest.
    if let Ok(rd) = fs::read_dir(root) {
        let mut rest = Vec::new();
        for ent in rd.flatten() {
            let name = ent.file_name();
            let name_str = name.to_string_lossy();
            if skip.iter().any(|s| *s == name_str.as_ref()) {
                continue;
            }
            let p = ent.path();
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if is_priority(name_str.as_ref()) {
                    queue.push_back(p);
                } else {
                    rest.push(p);
                }
            } else if matches_file(&p, name_str.as_ref()) {
                if !is_basename {
                    // Specific multi-segment (or root-level exact): take first hit.
                    return Some(p);
                }
                hits.push(p);
            }
        }
        for p in rest {
            queue.push_back(p);
        }
    }

    let mut visits = 0usize;
    while let Some(dir) = queue.pop_front() {
        if visits >= max_visits {
            break;
        }
        let rd = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let mut later_dirs = Vec::new();
        for ent in rd.flatten() {
            visits += 1;
            if visits >= max_visits {
                break;
            }
            let name = ent.file_name();
            let name_str = name.to_string_lossy();
            if skip.iter().any(|s| *s == name_str.as_ref()) {
                continue;
            }
            let p = ent.path();
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if is_priority(name_str.as_ref()) {
                    queue.push_front(p);
                } else {
                    later_dirs.push(p);
                }
                continue;
            }
            if matches_file(&p, name_str.as_ref()) {
                if !is_basename {
                    // Path-like suffix is specific enough (e.g. `05-handoff/foo.md`).
                    return Some(p);
                }
                hits.push(p);
                // Keep scanning bare names so we can reject ambiguous homonyms.
            }
        }
        for p in later_dirs {
            queue.push_back(p);
        }
    }

    if !is_basename {
        return None;
    }

    // Bare basename: only auto-open when unique under the scanned tree.
    match hits.len() {
        1 => hits.pop(),
        _ => None, // 0 or many → do not guess
    }
}

/// Build suffix search keys from a path: full rel, then shorter tails.
fn suffix_candidates(path: &str) -> Vec<String> {
    let t = path
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/");
    let t = t.trim_start_matches('/');
    if t.is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<&str> = t.split('/').filter(|s| !s.is_empty()).collect();
    // If absolute-looking leftover, keep all components
    if parts.is_empty() {
        return Vec::new();
    }
    // Drop drive-like first component on windows-ish absolute tails
    if parts[0].ends_with(':') {
        parts.remove(0);
    }
    let mut out = Vec::new();
    let max = parts.len().min(5);
    for n in (1..=max).rev() {
        let suf = parts[parts.len() - n..].join("/");
        if !out.iter().any(|x: &String| x == &suf) {
            out.push(suf);
        }
    }
    out
}

fn read_path(path: PathBuf, rel_in: String) -> Result<FsReadResult, String> {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel_in.clone());
    let meta = fs::metadata(&path).map_err(|e| format!("stat: {e}"))?;
    let size = meta.len();
    let ext = ext_of(&name);
    let mut kind = guess_kind(&ext, false).to_string();
    let mime = mime_of(&ext, &kind);

    // Office OOXML: stream path to frontend rich preview (docx-preview / SheetJS).
    // Keep original kind (docx|xlsx|pptx) so the UI can pick the right renderer.
    if matches!(kind.as_str(), "docx" | "xlsx" | "pptx" | "odf") {
        if size > MAX_OFFICE_STREAM_BYTES {
            return Ok(ok_result(
                &path,
                rel_in,
                name,
                size,
                kind,
                mime,
                None,
                None,
                true,
                true,
                Some(format!(
                    "file too large for in-app office preview (>{MAX_OFFICE_STREAM_BYTES} bytes)"
                )),
            ));
        }
        // Optional plain-text fallback for tiny extract failures in UI
        let text_fallback = extract_office_text(&path, &kind).ok().map(|t| {
            if t.len() as u64 > MAX_TEXT_BYTES {
                t.chars().take(MAX_TEXT_BYTES as usize).collect()
            } else {
                t
            }
        });
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            kind,
            mime,
            text_fallback,
            None,
            true, // stream → frontend fetches binary via asset/media URL
            false,
            None,
        ));
    }

    if kind == "office_legacy" {
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            "binary".into(),
            mime,
            None,
            None,
            false,
            false,
            Some(
                "legacy .doc/.xls/.ppt is not supported — save as .docx/.xlsx/.pptx to preview"
                    .into(),
            ),
        ));
    }

    // Video / audio — always stream via absolute path (no base64; supports multi‑GB files)
    if matches!(kind.as_str(), "video" | "audio") {
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            kind,
            mime,
            None,
            None,
            true,
            false,
            None,
        ));
    }

    // Image / PDF — stream path for large files; small images may embed as base64
    if matches!(kind.as_str(), "image" | "pdf") {
        // Never return raw SVG markup for innerHTML — stream as image.
        if ext == "svg" {
            return Ok(ok_result(
                &path,
                rel_in,
                name,
                size,
                "image".into(),
                mime,
                None,
                None,
                true,
                false,
                None,
            ));
        }
        // Prefer stream for anything over 2 MiB (webview loads via asset protocol)
        if size > 2 * 1024 * 1024 {
            return Ok(ok_result(
                &path,
                rel_in,
                name,
                size,
                kind,
                mime,
                None,
                None,
                true,
                false,
                None,
            ));
        }
        let bytes = fs::read(&path).map_err(|e| format!("read: {e}"))?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            kind,
            mime,
            None,
            Some(b64),
            false,
            false,
            None,
        ));
    }

    if matches!(kind.as_str(), "font" | "archive") {
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            kind,
            mime,
            None,
            None,
            false,
            false,
            Some("no inline preview for this format".into()),
        ));
    }

    // Text-like (incl. unknown → try as text)
    let truncated = size > MAX_TEXT_BYTES;
    let bytes = if truncated {
        let mut f = fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
        let mut buf = vec![0u8; MAX_TEXT_BYTES as usize];
        let n = f.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        buf.truncate(n);
        buf
    } else {
        fs::read(&path).map_err(|e| format!("read: {e}"))?
    };

    let nulls = bytes.iter().filter(|b| **b == 0).count();
    if !bytes.is_empty() && nulls > bytes.len() / 50 {
        kind = "binary".into();
        return Ok(ok_result(
            &path,
            rel_in,
            name,
            size,
            kind,
            "application/octet-stream".into(),
            None,
            None,
            false,
            false,
            Some("binary file (no text preview)".into()),
        ));
    }

    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(ok_result(
        &path,
        rel_in,
        name,
        size,
        kind,
        mime,
        Some(text),
        None,
        false,
        truncated,
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rejects_escape() {
        let dir = tempfile_dir();
        let err = list_dir(dir.to_str().unwrap(), "../").unwrap_err();
        assert!(
            err.contains("escape") || err.contains("not a directory") || err.contains("resolve"),
            "{err}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_and_reads() {
        let dir = tempfile_dir();
        let f = dir.join("hello.md");
        let mut file = fs::File::create(&f).unwrap();
        writeln!(file, "# hi").unwrap();
        let entries = list_dir(dir.to_str().unwrap(), "").unwrap();
        assert!(entries.iter().any(|e| e.name == "hello.md"));
        assert!(entries.iter().any(|e| e.relative_path == "hello.md"));
        let r = read_file(dir.to_str().unwrap(), "hello.md").unwrap();
        assert_eq!(r.kind, "markdown");
        assert!(r.text.unwrap().contains("# hi"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn nested_relative_paths() {
        let dir = tempfile_dir();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/a.ts"), "export const x = 1;\n").unwrap();
        let entries = list_dir(dir.to_str().unwrap(), "src").unwrap();
        assert_eq!(entries[0].relative_path, "src/a.ts");
        let r = read_file(dir.to_str().unwrap(), "src/a.ts").unwrap();
        assert_eq!(r.kind, "code");
        assert!(r.text.unwrap().contains("export"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hides_git_directory() {
        let dir = tempfile_dir();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git/config"), "x").unwrap();
        fs::write(dir.join("readme.md"), "# hi").unwrap();
        let entries = list_dir(dir.to_str().unwrap(), "").unwrap();
        assert!(
            entries.iter().all(|e| e.name != ".git"),
            "entries: {:?}",
            entries.iter().map(|e| &e.name).collect::<Vec<_>>()
        );
        assert!(entries.iter().any(|e| e.name == "readme.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_sibling_under_parent() {
        // project = <tmp>/document/ai-center
        // file    = <tmp>/document/知识库/wiki/x.md
        // agent writes relative: 知识库/wiki/x.md
        let dir = tempfile_dir();
        let project = dir.join("document").join("ai-center");
        let kb = dir
            .join("document")
            .join("知识库")
            .join("wiki")
            .join("concepts");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&kb).unwrap();
        let name = "AI超级员工多角色Agent边界架构.md";
        let file = kb.join(name);
        fs::write(&file, b"# boundary\n").unwrap();
        let rel = format!("知识库/wiki/concepts/{name}");
        let r = open_path_smart(Some(project.to_str().unwrap()), &rel);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, name);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_absolute_exists() {
        let dir = tempfile_dir();
        let f = dir.join("abs.md");
        fs::write(&f, b"ok").unwrap();
        let r = open_path_smart(None, f.to_str().unwrap());
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, "abs.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_bare_filename_under_projects() {
        // Agent often writes just `continuation-handoff.md` after citing the full path.
        let dir = tempfile_dir();
        let nested = dir
            .join("projects")
            .join("2026-07-demo")
            .join("05-handoff");
        fs::create_dir_all(&nested).unwrap();
        // noise that would exhaust a shallow/unprioritized walk
        for i in 0..40 {
            let noise = dir.join("noise").join(format!("pkg{i}")).join("src");
            fs::create_dir_all(&noise).unwrap();
            let _ = fs::File::create(noise.join("index.js"));
        }
        let name = "continuation-handoff.md";
        fs::write(nested.join(name), b"# handoff\n").unwrap();
        let r = open_path_smart(Some(dir.to_str().unwrap()), name);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, name);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_ellipsis_truncated_under_kb() {
        // Agent writes: .../MANISH/2071/img_000.jpg
        // Real: document/知识库/operations/.../MANISH/2071/img_000.jpg
        let dir = tempfile_dir();
        let project = dir.join("document").join("ai-center");
        let nested = dir
            .join("document")
            .join("知识库")
            .join("operations")
            .join("2026-07-04")
            .join("images")
            .join("MANISH1027512")
            .join("2071078312290791476");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("img_000.jpg"), b"fakejpg").unwrap();
        let truncated = ".../MANISH1027512/2071078312290791476/img_000.jpg";
        let r = open_path_smart(Some(project.to_str().unwrap()), truncated);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, "img_000.jpg");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_under_sibling_knowledge_base() {
        // project = <tmp>/document/ai-center
        // file    = <tmp>/document/知识库/raw/articles/x/demo/README.md
        // agent writes: raw/articles/x/demo/README.md  (relative to 知识库)
        let dir = tempfile_dir();
        let project = dir.join("document").join("ai-center");
        let nested = dir
            .join("document")
            .join("知识库")
            .join("raw")
            .join("articles")
            .join("x")
            .join("demo");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("README.md"), b"# demo\n").unwrap();
        let rel = "raw/articles/x/demo/README.md";
        let r = open_path_smart(Some(project.to_str().unwrap()), rel);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, "README.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_bare_filename_rejects_ambiguous() {
        let dir = tempfile_dir();
        let a = dir.join("projects").join("a").join("05-handoff");
        let b = dir.join("projects").join("b").join("05-handoff");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let name = "continuation-handoff.md";
        fs::write(a.join(name), b"a\n").unwrap();
        fs::write(b.join(name), b"b\n").unwrap();
        // Two same basenames → must not pick either arbitrarily.
        let r = open_path_smart(Some(dir.to_str().unwrap()), name);
        assert!(r.is_err(), "expected ambiguous bare name to fail, got {r:?}");
        // Multi-segment still works.
        let r2 = open_path_smart(
            Some(dir.to_str().unwrap()),
            &format!("projects/a/05-handoff/{name}"),
        );
        assert!(r2.is_ok(), "{r2:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn simple_glob_match_basics() {
        assert!(simple_glob_match("foo*.md", "foo.md"));
        assert!(simple_glob_match("foo*.md", "foo-bar.md"));
        assert!(simple_glob_match(
            "2026-03-15-tiezhu-picture-book*.md",
            "2026-03-15-tiezhu-picture-book.md"
        ));
        assert!(simple_glob_match(
            "2026-03-15-tiezhu-picture-book*.md",
            "2026-03-15-tiezhu-picture-book-v2.md"
        ));
        assert!(!simple_glob_match("foo*.md", "bar.md"));
        assert!(simple_glob_match("img_???.jpg", "img_000.jpg"));
        assert!(!simple_glob_match("img_???.jpg", "img_00.jpg"));
        assert!(simple_glob_match("*.md", "readme.md"));
    }

    #[test]
    fn open_path_smart_agent_basename_glob() {
        // Chat cards often cite `docs/plans/2026-03-15-foo*.md` (wildcard).
        let dir = tempfile_dir();
        let plans = dir.join("docs").join("plans");
        fs::create_dir_all(&plans).unwrap();
        let name = "2026-03-15-tiezhu-picture-book.md";
        fs::write(plans.join(name), b"# plan\n").unwrap();
        // noise
        fs::write(plans.join("other.md"), b"# other\n").unwrap();
        let pattern = "docs/plans/2026-03-15-tiezhu-picture-book*.md";
        let r = open_path_smart(Some(dir.to_str().unwrap()), pattern);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, name);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_path_smart_agent_glob_prefers_shortest() {
        let dir = tempfile_dir();
        let plans = dir.join("docs").join("plans");
        fs::create_dir_all(&plans).unwrap();
        fs::write(
            plans.join("2026-03-15-tiezhu-picture-book-extra.md"),
            b"# long\n",
        )
        .unwrap();
        fs::write(plans.join("2026-03-15-tiezhu-picture-book.md"), b"# short\n").unwrap();
        let pattern = "docs/plans/2026-03-15-tiezhu-picture-book*.md";
        let r = open_path_smart(Some(dir.to_str().unwrap()), pattern);
        assert!(r.is_ok(), "{r:?}");
        assert_eq!(r.unwrap().name, "2026-03-15-tiezhu-picture-book.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn xml_to_plain_strips_tags() {
        let xml = r#"<w:document><w:p><w:t>小猪去买菜</w:t></w:p><w:p><w:t>第二段</w:t></w:p></w:document>"#;
        let t = xml_to_plain(xml);
        assert!(t.contains("小猪去买菜"), "{t}");
        assert!(t.contains("第二段"), "{t}");
    }

    #[test]
    fn reads_minimal_docx() {
        let dir = tempfile_dir();
        let docx = dir.join("sample.docx");
        write_minimal_docx(&docx, "Hello DOCX preview");
        let r = read_file(dir.to_str().unwrap(), "sample.docx").unwrap();
        // UI picks renderer by concrete kind (docx|xlsx|pptx), not a generic "office".
        assert_eq!(r.kind, "docx");
        assert!(
            r.text.as_ref().unwrap().contains("Hello DOCX preview"),
            "{:?}",
            r.text
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_roundtrip_and_mtime() {
        let dir = tempfile_dir();
        let rel = "notes/hello.md";
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join(rel), b"v1\n").unwrap();
        let r = read_file(dir.to_str().unwrap(), rel).unwrap();
        assert!(r.mtime_ms > 0 || cfg!(target_os = "windows"));
        let w = write_text_file(
            dir.to_str().unwrap(),
            rel,
            "v2\n",
            Some(r.mtime_ms),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dir.join(rel)).unwrap(), "v2\n");
        assert_eq!(w.size, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_conflict_when_mtime_differs() {
        let dir = tempfile_dir();
        let rel = "a.txt";
        fs::write(dir.join(rel), b"disk\n").unwrap();
        let r = read_file(dir.to_str().unwrap(), rel).unwrap();
        // Stale expected mtime (not equal to on-disk) → conflict without sleeping.
        let stale = if r.mtime_ms == 0 {
            1
        } else {
            r.mtime_ms.wrapping_add(1_000_000)
        };
        let err = write_text_file(dir.to_str().unwrap(), rel, "mine\n", Some(stale))
            .unwrap_err();
        assert!(
            err.starts_with("CONFLICT:"),
            "expected conflict, got {err}"
        );
        assert_eq!(fs::read_to_string(dir.join(rel)).unwrap(), "disk\n");
        // Force overwrite without expected mtime.
        write_text_file(dir.to_str().unwrap(), rel, "mine\n", None).unwrap();
        assert_eq!(fs::read_to_string(dir.join(rel)).unwrap(), "mine\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_rejects_escape() {
        let dir = tempfile_dir();
        let err = write_text_file(dir.to_str().unwrap(), "../x.txt", "nope", None).unwrap_err();
        assert!(err.contains("escape") || err.contains("absolute"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    fn write_minimal_docx(path: &Path, body: &str) {
        use std::io::Write;
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("[Content_Types].xml", opts).unwrap();
        zip.write_all(
            br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#,
        )
        .unwrap();
        zip.start_file("word/document.xml", opts).unwrap();
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{body}</w:t></w:r></w:p></w:body>
</w:document>"#
        );
        zip.write_all(xml.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    fn tempfile_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("grok-fs-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
}

