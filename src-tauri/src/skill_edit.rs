//! In-app SKILL.md editor — path allowlist + read/write under known skills roots.
//!
//! Writable roots (mirrors `src/lib/skillEditPath.ts`):
//! - `{user_home}/.grok/skills`
//! - `{agent_home}/skills` (App independent GROK_HOME)
//! - `{project}/.grok/skills` when a project path is provided
//!
//! Vendor/bundled/plugin trees are not allowlisted. Path traversal is rejected.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::paths::agent_home_dir;
use crate::process_util::user_home;

const MAX_SKILL_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

/// Result of reading a SKILL.md for the editor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReadResult {
    pub path: String,
    pub name: String,
    pub content: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub truncated: bool,
}

/// Result of writing a SKILL.md.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWriteResult {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
}

fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Build allowlisted skill roots (absolute strings, not necessarily existing).
pub fn build_skill_edit_roots(project_path: Option<&str>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if out.iter().any(|x| x == &p) {
            return;
        }
        out.push(p);
    };

    push(user_home().join(".grok").join("skills"));
    push(agent_home_dir().join("skills"));

    if let Some(raw) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        push(PathBuf::from(raw).join(".grok").join("skills"));
    }

    out
}

/// True when any component is ParentDir / CurDir (after empty check).
pub fn path_has_traversal(path: &Path) -> bool {
    path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::CurDir
        )
    })
}

/// Component-wise: path is equal to root or a descendant.
pub fn path_under_root(path: &Path, root: &Path) -> bool {
    if path_has_traversal(path) || path_has_traversal(root) {
        return false;
    }
    if path == root {
        return true;
    }
    let mut path_comps = path.components();
    for rc in root.components() {
        match path_comps.next() {
            Some(pc) if pc == rc => {}
            _ => return false,
        }
    }
    true
}

/// Resolve dir-or-file path to the SKILL.md file path (lexical only).
pub fn resolve_skill_md_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    if trimmed.contains('\0') {
        return Err("invalid path".into());
    }
    let path = PathBuf::from(trimmed);
    if path_has_traversal(&path) {
        return Err("path not allowed: traversal".into());
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name == "skill.md" {
        return Ok(path);
    }
    Ok(path.join("SKILL.md"))
}

/// Require that the path is `{root}/{skillName}/SKILL.md` under a known root.
pub fn require_skill_md_allowed(
    path: &Path,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    if path_has_traversal(path) {
        return Err("path not allowed: traversal".into());
    }
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if file_name != "skill.md" {
        return Err("path not allowed: only SKILL.md may be edited".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "path not allowed: missing skill directory".to_string())?;
    let skill_name = parent
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if skill_name.is_empty() || skill_name == ".." || skill_name == "." {
        return Err("path not allowed: invalid skill name".into());
    }
    if skill_name.eq_ignore_ascii_case("bundled") {
        return Err("path not allowed: bundled skills are read-only".into());
    }
    let skill_root = parent
        .parent()
        .ok_or_else(|| "path not allowed: outside skills root".to_string())?;

    // skill_root must equal one of the allowlisted roots (not a nested subfolder).
    let under = roots.iter().any(|r| paths_equal_loose(skill_root, r));

    if !under {
        tracing::warn!(
            path = %path.display(),
            "skill_edit: denied path outside allowlisted skills roots"
        );
        return Err("path not allowed: outside known skills roots".into());
    }

    // Prefer canonical when file exists (blocks symlink escape after allowlist).
    if path.exists() {
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("path not found: {e}"))?;
        // Re-check: canonical parent.parent must still match a root.
        let c_parent = canonical
            .parent()
            .ok_or_else(|| "path not allowed: missing skill directory".to_string())?;
        let c_root = c_parent
            .parent()
            .ok_or_else(|| "path not allowed: outside skills root".to_string())?;
        let ok = roots.iter().any(|r| {
            let rc = r.canonicalize().unwrap_or_else(|_| r.clone());
            paths_equal_loose(c_root, &rc)
        });
        if !ok {
            return Err("path not allowed: outside known skills roots".into());
        }
        return Ok(canonical);
    }

    Ok(path.to_path_buf())
}

fn paths_equal_loose(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    // Normalize by string form with unified separators for Windows.
    let sa = a.to_string_lossy().replace('\\', "/");
    let sb = b.to_string_lossy().replace('\\', "/");
    if sa == sb {
        return true;
    }
    #[cfg(windows)]
    {
        return sa.eq_ignore_ascii_case(&sb);
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Read SKILL.md under allowlisted roots.
pub fn skill_read(path: &str, project_path: Option<&str>) -> Result<SkillReadResult, String> {
    let resolved = resolve_skill_md_path(path)?;
    let roots = build_skill_edit_roots(project_path);
    let allowed = require_skill_md_allowed(&resolved, &roots)?;
    if !allowed.is_file() {
        return Err(format!("not a file: {}", allowed.display()));
    }
    let meta = fs::metadata(&allowed).map_err(|e| format!("stat: {e}"))?;
    let size = meta.len();
    if size > MAX_SKILL_BYTES {
        return Err(format!(
            "file too large to edit in-app (max {MAX_SKILL_BYTES} bytes)"
        ));
    }
    let content = fs::read_to_string(&allowed).map_err(|e| format!("read: {e}"))?;
    let name = allowed
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".into());
    Ok(SkillReadResult {
        path: allowed.to_string_lossy().to_string(),
        name,
        content,
        size,
        mtime_ms: file_mtime_ms(&allowed),
        truncated: false,
    })
}

/// Write SKILL.md under allowlisted roots (optional mtime conflict check).
pub fn skill_write(
    path: &str,
    content: &str,
    expected_mtime_ms: Option<u64>,
    project_path: Option<&str>,
) -> Result<SkillWriteResult, String> {
    let resolved = resolve_skill_md_path(path)?;
    let roots = build_skill_edit_roots(project_path);
    let allowed = require_skill_md_allowed(&resolved, &roots)?;
    if !allowed.is_file() {
        return Err(format!("not a file: {}", allowed.display()));
    }
    let bytes = content.as_bytes();
    if bytes.len() as u64 > MAX_SKILL_BYTES {
        return Err(format!(
            "file too large to save in-app (max {MAX_SKILL_BYTES} bytes)"
        ));
    }

    if let Some(expected) = expected_mtime_ms {
        if expected > 0 {
            let actual = file_mtime_ms(&allowed);
            if actual > 0 && actual != expected {
                return Err(format!(
                    "CONFLICT: file changed on disk (mtime {actual}, expected {expected})"
                ));
            }
        }
    }

    let parent = allowed
        .parent()
        .ok_or_else(|| "invalid parent directory".to_string())?;
    let tmp_name = format!(
        ".{}.grok-skill-save-{}",
        allowed
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("SKILL.md"),
        std::process::id()
    );
    let tmp = parent.join(tmp_name);
    fs::write(&tmp, bytes).map_err(|e| format!("write temp: {e}"))?;
    fs::rename(&tmp, &allowed).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename into place: {e}")
    })?;

    let meta = fs::metadata(&allowed).map_err(|e| format!("stat after write: {e}"))?;
    Ok(SkillWriteResult {
        path: allowed.to_string_lossy().to_string(),
        size: meta.len(),
        mtime_ms: file_mtime_ms(&allowed),
    })
}

/// Public roots list for the UI (string paths).
pub fn skill_roots_list(project_path: Option<&str>) -> Vec<String> {
    build_skill_edit_roots(project_path)
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn traversal_rejected() {
        assert!(path_has_traversal(Path::new("../etc")));
        assert!(path_has_traversal(Path::new("/a/../b")));
        assert!(!path_has_traversal(Path::new("/Users/me/.grok/skills/help/SKILL.md")));
    }

    #[test]
    fn under_root_no_prefix_false_positive() {
        assert!(path_under_root(
            Path::new("/Users/me/.grok/skills/help"),
            Path::new("/Users/me/.grok/skills")
        ));
        assert!(!path_under_root(
            Path::new("/Users/me/.grok/skills-evil"),
            Path::new("/Users/me/.grok/skills")
        ));
    }

    #[test]
    fn allowlist_user_skill() {
        let roots = vec![PathBuf::from("/Users/me/.grok/skills")];
        let path = PathBuf::from("/Users/me/.grok/skills/help/SKILL.md");
        // File may not exist — lexical allow still returns Ok(path).
        let got = require_skill_md_allowed(&path, &roots).unwrap();
        assert_eq!(got, path);
    }

    #[test]
    fn deny_bundled_and_outside() {
        let roots = vec![PathBuf::from("/Users/me/.grok/skills")];
        assert!(require_skill_md_allowed(
            Path::new("/Users/me/.grok/bundled/skills/pdf/SKILL.md"),
            &roots
        )
        .is_err());
        assert!(require_skill_md_allowed(Path::new("/etc/passwd"), &roots).is_err());
        assert!(require_skill_md_allowed(
            Path::new("/Users/me/.grok/skills/help/nested/SKILL.md"),
            &roots
        )
        .is_err());
    }

    #[test]
    fn read_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "grok-skill-edit-test-{}",
            std::process::id()
        ));
        let skill_dir = dir.join("skills").join("demo");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_md = skill_dir.join("SKILL.md");
        {
            let mut f = fs::File::create(&skill_md).unwrap();
            writeln!(f, "---\nname: demo\n---\nhello").unwrap();
        }

        // Temporarily treat temp skills as roots by calling require + write helpers.
        let roots = vec![dir.join("skills")];
        let allowed = require_skill_md_allowed(&skill_md, &roots).unwrap();
        assert!(allowed.is_file());

        let content = fs::read_to_string(&allowed).unwrap();
        assert!(content.contains("hello"));

        let new_body = "---\nname: demo\n---\nupdated\n";
        let parent = allowed.parent().unwrap();
        let tmp = parent.join(".SKILL.md.grok-skill-save-test");
        fs::write(&tmp, new_body).unwrap();
        fs::rename(&tmp, &allowed).unwrap();
        assert_eq!(fs::read_to_string(&allowed).unwrap(), new_body);

        let _ = fs::remove_dir_all(&dir);
    }
}
