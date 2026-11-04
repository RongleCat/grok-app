//! Extract local file paths the agent wants to send back to the IM channel.
//!
//! Contract: one absolute path per line (optionally prefixed with `@`), or a
//! markdown image/file link. Paths are returned in order, deduped and capped.

use crate::attachments::AttachmentKind;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const MAX_OUTBOUND_FILES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundCandidate {
    pub path: PathBuf,
    pub kind: AttachmentKind,
    pub name: String,
}

/// Split reply text into display text and candidate paths.
///
/// Only whole-line paths are removed; prose that merely mentions a path stays.
pub fn extract(text: &str) -> (String, Vec<OutboundCandidate>) {
    let mut kept: Vec<&str> = Vec::new();
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines() {
        let Some(path) = line_path(line) else {
            kept.push(line);
            continue;
        };
        let normalized = path.to_string_lossy().to_string();
        if candidates.len() >= MAX_OUTBOUND_FILES {
            // Over the cap: keep the line so the user can still see it.
            kept.push(line);
            continue;
        }
        if !seen.insert(normalized) {
            // Duplicate candidate line: drop it from the display text.
            continue;
        }
        candidates.push(OutboundCandidate {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "attachment".into()),
            kind: kind_for_path(&path),
            path,
        });
    }
    let display = kept.join("\n").trim_end().to_string();
    (display, candidates)
}

fn line_path(line: &str) -> Option<PathBuf> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Markdown image / link: ![alt](/abs/path) or [name](/abs/path)
    if let Some((prefix, rest)) = trimmed.split_once("](") {
        if (prefix.starts_with("![") || prefix.starts_with('['))
            && rest.ends_with(')')
            && !rest[..rest.len() - 1].contains(')')
        {
            let target = rest[..rest.len() - 1].trim();
            let target = target.trim_matches('<').trim_matches('>');
            if is_absolute_path_text(target) {
                return Some(PathBuf::from(target));
            }
        }
    }
    let candidate = trimmed.strip_prefix('@').unwrap_or(trimmed);
    if is_absolute_path_text(candidate) {
        Some(PathBuf::from(candidate))
    } else {
        None
    }
}

fn is_absolute_path_text(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.contains('\n') {
        return false;
    }
    // POSIX absolute, or a Windows drive path.
    let bytes = value.as_bytes();
    if value.starts_with('/') {
        return true;
    }
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

pub fn kind_for_path(path: &Path) -> AttachmentKind {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "heic" | "avif" => AttachmentKind::Image,
        "mp3" | "m4a" | "opus" | "ogg" | "wav" | "flac" => AttachmentKind::Audio,
        "mp4" | "mov" | "webm" | "mkv" => AttachmentKind::Video,
        _ => AttachmentKind::File,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sole_line_paths_and_keeps_prose() {
        let (display, refs) = extract("报告如下。\n/Users/me/chart.png\n请查收。");
        assert_eq!(display, "报告如下。\n请查收。");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].path, PathBuf::from("/Users/me/chart.png"));
        assert_eq!(refs[0].kind, AttachmentKind::Image);
        assert_eq!(refs[0].name, "chart.png");
    }

    #[test]
    fn supports_at_prefix_and_markdown_links() {
        let (_, refs) = extract("@/tmp/a.bin\n[download](/tmp/report.pdf)");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[1].kind, AttachmentKind::File);
    }

    #[test]
    fn ignores_inline_paths_and_dedupes() {
        let (display, refs) = extract("看 /tmp/a.png 这张\n/tmp/a.png\n/tmp/a.png");
        assert_eq!(display, "看 /tmp/a.png 这张");
        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn caps_candidates() {
        let lines: Vec<String> = (0..20).map(|i| format!("/tmp/{i}.bin")).collect();
        let (_, refs) = extract(&lines.join("\n"));
        assert_eq!(refs.len(), MAX_OUTBOUND_FILES);
    }

    #[test]
    fn recognizes_windows_drive_paths() {
        assert!(is_absolute_path_text("C:\\Users\\me\\a.png"));
        assert!(is_absolute_path_text("D:/data/a.csv"));
        assert!(!is_absolute_path_text("relative/a.png"));
    }
}
