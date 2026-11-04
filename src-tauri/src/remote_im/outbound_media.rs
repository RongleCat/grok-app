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
    /// Zero-based line indices that produced this candidate.
    pub lines: Vec<usize>,
}

/// Find whole-line paths in the reply. The display text is returned untouched;
/// callers remove only lines that were uploaded successfully.
pub fn extract(text: &str) -> Vec<OutboundCandidate> {
    let mut candidates: Vec<OutboundCandidate> = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let Some(path) = line_path(line) else {
            continue;
        };
        if let Some(existing) = candidates.iter_mut().find(|c| c.path == path) {
            if !existing.lines.contains(&index) {
                existing.lines.push(index);
            }
            continue;
        }
        if candidates.len() >= MAX_OUTBOUND_FILES {
            continue;
        }
        candidates.push(OutboundCandidate {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "attachment".into()),
            kind: kind_for_path(&path),
            path,
            lines: vec![index],
        });
    }
    candidates
}

/// Drop the given zero-based line indices from the reply text.
pub fn remove_lines(text: &str, lines: &[usize]) -> String {
    let drop: HashSet<usize> = lines.iter().copied().collect();
    text.lines()
        .enumerate()
        .filter(|(index, _)| !drop.contains(index))
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
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
        let text = "报告如下。\n/Users/me/chart.png\n请查收。";
        let refs = extract(text);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].path, PathBuf::from("/Users/me/chart.png"));
        assert_eq!(refs[0].kind, AttachmentKind::Image);
        assert_eq!(refs[0].lines, vec![1]);
        assert_eq!(remove_lines(text, &refs[0].lines), "报告如下。\n请查收。");
    }

    #[test]
    fn supports_at_prefix_and_markdown_links() {
        let refs = extract("@/tmp/a.bin\n[download](/tmp/report.pdf)");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].kind, AttachmentKind::File);
        assert_eq!(refs[1].kind, AttachmentKind::File);
    }

    #[test]
    fn ignores_inline_paths_and_dedupes_line_refs() {
        let text = "看 /tmp/a.png 这张\n/tmp/a.png\n/tmp/a.png";
        let refs = extract(text);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].lines, vec![1, 2]);
        assert_eq!(remove_lines(text, &refs[0].lines), "看 /tmp/a.png 这张");
    }

    #[test]
    fn caps_candidates() {
        let lines: Vec<String> = (0..20).map(|i| format!("/tmp/{i}.bin")).collect();
        let refs = extract(&lines.join("\n"));
        assert_eq!(refs.len(), MAX_OUTBOUND_FILES);
    }

    #[test]
    fn recognizes_windows_drive_paths() {
        assert!(is_absolute_path_text("C:\\Users\\me\\a.png"));
        assert!(is_absolute_path_text("D:/data/a.csv"));
        assert!(!is_absolute_path_text("relative/a.png"));
    }
}
