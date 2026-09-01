
/// Optional git unified diff for a path under a project (session Changes panel).
/// Soft-fails: returns `available: false` when git is missing, path is outside
/// the repo, or the file has no diff — never hard-requires git.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffResult {
    pub available: bool,
    pub diff: Option<String>,
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn git_file_diff(
    project_path: String,
    path: String,
) -> Result<GitFileDiffResult, String> {
    // Fast guards on the runtime; the diff process spawns run on the blocking
    // pool so a big diff cannot stall other queued commands.
    let project = normalize_fs_path(&project_path);
    let target = normalize_fs_path(&path);
    if project.is_empty() || target.is_empty() {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: None,
            reason: Some("project not a directory".into()),
        });
    }

    // Prefer project-relative when under root (git -C wants repo-relative paths).
    let rel = {
        let t = std::path::PathBuf::from(&target);
        match t.strip_prefix(&proj) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                // Also try string prefix (macOS /var vs /private/var etc. is best-effort)
                let p = project.trim_end_matches('/').replace('\\', "/");
                let a = target.replace('\\', "/");
                if a.starts_with(&(p.clone() + "/")) {
                    a[p.len() + 1..].to_string()
                } else {
                    target.clone()
                }
            }
        }
    };
    if rel.is_empty() || rel == "." {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("not a file path".into()),
        });
    }

    tauri::async_runtime::spawn_blocking(move || git_file_diff_blocking(project, rel))
        .await
        .map_err(|e| format!("git file diff worker panicked: {e}"))?
}

fn git_file_diff_blocking(project: String, rel: String) -> Result<GitFileDiffResult, String> {

    // Soft check: is git on PATH?
    let git_ok = crate::process_util::command("git")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !git_ok {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("git not available".into()),
        });
    }

    // Confirm we are inside a work tree
    let inside = crate::process_util::command("git")
        .args(["-C", &project, "rev-parse", "--is-inside-work-tree"])
        .output();
    let inside_ok = inside
        .as_ref()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside_ok {
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("not a git repository".into()),
        });
    }
    // Working tree + index vs HEAD (covers staged and unstaged edits).
    let out = crate::process_util::command("git")
        .args([
            "-C",
            &project,
            "diff",
            "--no-color",
            "--no-ext-diff",
            "HEAD",
            "--",
            &rel,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        // Untracked new file: try against empty tree
        let untracked = crate::process_util::command("git")
            .args([
                "-C",
                &project,
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                &rel,
            ])
            .output();
        if let Ok(u) = untracked {
            // git --no-index exits 1 when files differ — still useful
            let text = String::from_utf8_lossy(&u.stdout).to_string();
            if !text.trim().is_empty() {
                return Ok(GitFileDiffResult {
                    available: true,
                    diff: Some(text.chars().take(400_000).collect()),
                    relative_path: Some(rel),
                    reason: None,
                });
            }
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some(if err.is_empty() {
                "git diff failed".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() {
        // Maybe untracked
        let untracked = crate::process_util::command("git")
            .args([
                "-C",
                &project,
                "ls-files",
                "--error-unmatch",
                "--",
                &rel,
            ])
            .status();
        let tracked = untracked.map(|s| s.success()).unwrap_or(false);
        if !tracked {
            // Show full file as addition via --no-index when possible
            let abs = std::path::PathBuf::from(&project).join(&rel);
            if abs.is_file() {
                let u = crate::process_util::command("git")
                    .args([
                        "-C",
                        &project,
                        "diff",
                        "--no-color",
                        "--no-ext-diff",
                        "--no-index",
                        "--",
                        "/dev/null",
                        abs.to_string_lossy().as_ref(),
                    ])
                    .output();
                if let Ok(u) = u {
                    let t = String::from_utf8_lossy(&u.stdout).to_string();
                    if !t.trim().is_empty() {
                        return Ok(GitFileDiffResult {
                            available: true,
                            diff: Some(t.chars().take(400_000).collect()),
                            relative_path: Some(rel),
                            reason: None,
                        });
                    }
                }
            }
        }
        return Ok(GitFileDiffResult {
            available: false,
            diff: None,
            relative_path: Some(rel),
            reason: Some("no diff".into()),
        });
    }

    Ok(GitFileDiffResult {
        available: true,
        diff: Some(text.chars().take(400_000).collect()),
        relative_path: Some(rel),
        reason: None,
    })
}

// ── Workspace git status (Changes panel: Session + Workspace) ──────────────

/// Soft-check git on PATH + project is inside a work tree.
fn git_probe_work_tree(project: &str) -> Result<(), String> {
    let git_ok = crate::process_util::command("git")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !git_ok {
        return Err("git not available".into());
    }
    let inside = crate::process_util::command("git")
        .args(["-C", project, "rev-parse", "--is-inside-work-tree"])
        .output();
    let inside_ok = inside
        .as_ref()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside_ok {
        return Err("not a git repository".into());
    }
    Ok(())
}

/// `git -C <project> -c core.quotepath=false …` — keeps UTF-8 paths unescaped so
/// Chinese / non-ASCII names don't arrive as `"\346\211…"`.
fn git_in_project(project: &str) -> std::process::Command {
    let mut cmd = crate::process_util::command("git");
    cmd.args(["-C", project, "-c", "core.quotepath=false"]);
    cmd
}

/// Decode git C-style quoted path (`"foo\346\211…"`) → UTF-8; strip stray quotes.
fn decode_git_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.len() >= 2 {
        let b = s.as_bytes();
        if (b[0] == b'"' && b[b.len() - 1] == b'"')
            || (b[0] == b'\'' && b[b.len() - 1] == b'\'')
        {
            s = s[1..s.len() - 1].to_string();
        }
    }
    // Strip leftover edge quotes (partial corruption).
    while s.starts_with('"') {
        s = s[1..].to_string();
    }
    while s.ends_with('"') {
        s.pop();
    }
    // C-style unescape: \nnn octal, \\, \", \n, \t, \r
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            let n = bytes[i + 1];
            if (b'0'..=b'7').contains(&n) {
                let mut val: u32 = 0;
                let mut j = i + 1;
                let mut count = 0;
                while j < bytes.len() && count < 3 && (b'0'..=b'7').contains(&bytes[j]) {
                    val = (val << 3) + (bytes[j] - b'0') as u32;
                    j += 1;
                    count += 1;
                }
                out.push(val as u8);
                i = j;
                continue;
            }
            match n {
                b'n' => out.push(b'\n'),
                b't' => out.push(b'\t'),
                b'r' => out.push(b'\r'),
                b'"' | b'\\' | b'\'' => out.push(n),
                _ => {
                    out.push(b'\\');
                    out.push(n);
                }
            }
            i += 2;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    let decoded = String::from_utf8_lossy(&out).into_owned();
    decoded.replace('\\', "/")
}

/// One row from `git status --porcelain=v1` for the Workspace Changes section.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    /// Repo-relative path (forward slashes).
    pub path: String,
    /// Absolute path under the project root when possible.
    pub absolute_path: String,
    /// Two-char porcelain code (e.g. ` M`, `M `, `??`, `A `).
    pub status: String,
    /// Index (staged) status char, or space.
    pub index_status: String,
    /// Worktree status char, or space.
    pub worktree_status: String,
    /// Coarse kind: modified | added | deleted | untracked | renamed | copied | typechange | conflict | ignored | unknown
    pub kind: String,
    /// Basename for list rows.
    pub name: String,
    /// Rename/copy source path when present.
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub available: bool,
    pub files: Vec<GitStatusEntry>,
    pub branch: Option<String>,
    pub reason: Option<String>,
}

/// Classify porcelain XY code into a coarse kind string (mirrors frontend helper).
fn git_status_kind(x: char, y: char) -> &'static str {
    if x == '?' && y == '?' {
        return "untracked";
    }
    if x == '!' && y == '!' {
        return "ignored";
    }
    if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        return "conflict";
    }
    // Prefer worktree letter, then index
    for c in [y, x] {
        match c {
            'R' => return "renamed",
            'C' => return "copied",
            'A' => return "added",
            'D' => return "deleted",
            'T' => return "typechange",
            'M' => return "modified",
            _ => {}
        }
    }
    if x != ' ' || y != ' ' {
        return "modified";
    }
    "unknown"
}

fn git_entry_basename(rel: &str) -> String {
    let n = rel.replace('\\', "/");
    n.rsplit('/').next().unwrap_or(rel).to_string()
}

/// Parse one porcelain v1 line into an entry (pure; unit-tested).
#[cfg(test)]
fn parse_porcelain_line(line: &str, project: &str) -> Option<GitStatusEntry> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() < 3 {
        return None;
    }
    let bytes = line.as_bytes();
    // Standard: XY SPACE path…  (status is always 2 chars)
    let x = bytes[0] as char;
    let y = bytes[1] as char;
    // Must have a separator after XY
    if bytes.len() < 4 {
        return None;
    }
    // skip optional space after XY
    let rest = line[2..].trim_start();
    if rest.is_empty() {
        return None;
    }

    let (path, original_path) = if rest.contains(" -> ") {
        // rename / copy: "old -> new"
        let mut parts = rest.splitn(2, " -> ");
        let old = parts.next().unwrap_or("").trim().to_string();
        let new = parts.next().unwrap_or("").trim().to_string();
        if new.is_empty() {
            return None;
        }
        (new, if old.is_empty() { None } else { Some(old) })
    } else {
        // Unquoted path (porcelain without -z does not quote unless special chars;
        // strip surrounding quotes when present).
        let p = rest.trim().trim_matches('"').to_string();
        (p, None)
    };

    let path = path.replace('\\', "/");
    if path.is_empty() {
        return None;
    }

    let abs = join_project_rel(project, &path);

    let status = format!("{x}{y}");
    Some(GitStatusEntry {
        path: path.clone(),
        absolute_path: abs,
        status,
        index_status: x.to_string(),
        worktree_status: y.to_string(),
        kind: git_status_kind(x, y).to_string(),
        name: git_entry_basename(&path),
        original_path,
    })
}

/// Join project root + repo-relative path with `/` for UI (platform-neutral).
fn join_project_rel(project: &str, rel: &str) -> String {
    let root = project.trim_end_matches(['/', '\\']).replace('\\', "/");
    let r = rel.trim_start_matches('/').replace('\\', "/");
    if root.is_empty() {
        r
    } else if r.is_empty() {
        root
    } else {
        format!("{root}/{r}")
    }
}

/// List modified / untracked / added files under a project (Workspace Changes).
/// Soft-fails when git is missing or the path is not a repo.
///
/// `git status` is a process spawn + full worktree walk (untracked dirs
/// included) and the dirty chip polls it every few seconds. It runs on the
/// blocking pool so a big repo cannot stall the async runtime.
#[tauri::command]
pub async fn git_status(project_path: String) -> Result<GitStatusResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some("project not a directory".into()),
        });
    }

    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch: None,
            reason: Some(reason),
        });
    }

    tauri::async_runtime::spawn_blocking(move || git_status_blocking(project))
        .await
        .map_err(|e| format!("git status worker panicked: {e}"))?
}

fn git_status_blocking(project: String) -> Result<GitStatusResult, String> {
    let branch = crate::process_util::command("git")
        .args(["-C", &project, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b.is_empty() || b == "HEAD" {
                    None
                } else {
                    Some(b)
                }
            } else {
                None
            }
        });

    // Porcelain v1: untracked as `??`, no ignored noise, relative paths.
    let out = crate::process_util::command("git")
        .args([
            "-C",
            &project,
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "-z",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitStatusResult {
            available: false,
            files: vec![],
            branch,
            reason: Some(if err.is_empty() {
                "git status failed".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    // -z: records separated by NUL. Each record is `XY path` or for renames
    // `XY` + space + old + NUL + new (git uses two NUL fields for rename).
    // Actually with -z: "XY path\0" and for rename "R  oldpath\0newpath\0".
    let raw = out.stdout;
    let mut files: Vec<GitStatusEntry> = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        // find next NUL
        let end = raw[i..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| i + p)
            .unwrap_or(raw.len());
        if end == i {
            break;
        }
        let chunk = String::from_utf8_lossy(&raw[i..end]).into_owned();
        i = end + 1;

        if chunk.len() < 3 {
            continue;
        }
        let x = chunk.as_bytes()[0] as char;
        let y = chunk.as_bytes()[1] as char;
        // After XY there is a space then path (when not rename split).
        let rest = chunk[2..].trim_start();

        // Rename/copy: first field is "XY oldpath", second field (next NUL record) is newpath.
        let is_rename = x == 'R' || x == 'C' || y == 'R' || y == 'C';
        let (path, original_path) = if is_rename && i < raw.len() {
            let end2 = raw[i..]
                .iter()
                .position(|&b| b == 0)
                .map(|p| i + p)
                .unwrap_or(raw.len());
            let newp = String::from_utf8_lossy(&raw[i..end2])
                .trim()
                .replace('\\', "/");
            i = end2 + 1;
            let old = rest.trim().replace('\\', "/");
            (newp, if old.is_empty() { None } else { Some(old) })
        } else {
            (rest.trim().replace('\\', "/"), None)
        };

        if path.is_empty() {
            continue;
        }

        let abs = join_project_rel(&project, &path);

        files.push(GitStatusEntry {
            path: path.clone(),
            absolute_path: abs,
            status: format!("{x}{y}"),
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            kind: git_status_kind(x, y).to_string(),
            name: git_entry_basename(&path),
            original_path,
        });
    }

    // Cap for UI responsiveness
    if files.len() > 2000 {
        files.truncate(2000);
    }

    Ok(GitStatusResult {
        available: true,
        files,
        branch,
        reason: None,
    })
}

// ── Review panel bulk bundle (one IPC for all workspace diffs) ──────────────

/// One file in the review stack: stats + optional unified patch body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewFile {
    pub path: String,
    pub absolute_path: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub added: i32,
    pub removed: i32,
    /// Per-file unified diff (may be truncated). None for binary / empty.
    pub diff: Option<String>,
    pub binary: bool,
}

/// Bulk workspace review payload — avoids N× `git_file_diff` process spawns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewBundleResult {
    pub available: bool,
    pub branch: Option<String>,
    /// Short upstream ref when set (e.g. `origin/main`).
    pub upstream: Option<String>,
    pub files: Vec<GitReviewFile>,
    pub total_added: i32,
    pub total_removed: i32,
    pub reason: Option<String>,
}

/// Cap total unified patch text returned to the UI (chars).
const REVIEW_DIFF_CHAR_CAP: usize = 1_500_000;
/// Cap per-file patch text.
const REVIEW_FILE_DIFF_CHAR_CAP: usize = 250_000;

/// Split multi-file `git diff` output into (path, patch) pairs.
fn split_unified_multi_diff(raw: &str) -> Vec<(String, String)> {
    let text = raw.replace("\r\n", "\n").replace('\r', "\n");
    if text.trim().is_empty() {
        return Vec::new();
    }
    let mut out: Vec<(String, String)> = Vec::new();
    let mut cur_path: Option<String> = None;
    let mut cur_buf = String::new();

    let flush = |path: &mut Option<String>, buf: &mut String, acc: &mut Vec<(String, String)>| {
        if let Some(p) = path.take() {
            if !buf.is_empty() {
                acc.push((p, std::mem::take(buf)));
            } else {
                buf.clear();
            }
        } else {
            buf.clear();
        }
    };

    for line in text.split('\n') {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush(&mut cur_path, &mut cur_buf, &mut out);
            // `a/foo b/foo` or with quotes — prefer b/ path.
            let path = parse_diff_git_path(rest);
            cur_path = path;
            cur_buf.push_str(line);
            cur_buf.push('\n');
            continue;
        }
        if cur_path.is_none() {
            // preamble without header — ignore
            continue;
        }
        cur_buf.push_str(line);
        cur_buf.push('\n');
    }
    flush(&mut cur_path, &mut cur_buf, &mut out);
    out
}

fn parse_diff_git_path(rest: &str) -> Option<String> {
    // Formats: `a/path b/path`, `"a/path with space" "b/path with space"`,
    // and C-style quoted non-ASCII: `"a/docs/Agent\346\211…"`
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }
    // Prefer the b/ side (second path). Parse quoted tokens so spaces inside
    // paths don't split, then decode_git_path for octal escapes.
    let parts: Vec<String> = if rest.contains('"') {
        let mut v = Vec::new();
        let mut cur = String::new();
        let mut in_q = false;
        for ch in rest.chars() {
            if ch == '"' {
                in_q = !in_q;
                // Keep the quote chars out; decode_git_path handles unquoted body.
                continue;
            }
            if ch == ' ' && !in_q {
                if !cur.is_empty() {
                    v.push(std::mem::take(&mut cur));
                }
                continue;
            }
            cur.push(ch);
        }
        if !cur.is_empty() {
            v.push(cur);
        }
        v
    } else {
        // Unquoted — only safe when path has no spaces (git default).
        rest.split_whitespace()
            .map(|s| s.to_string())
            .collect()
    };
    parts
        .last()
        .map(|s| strip_diff_ab_prefix(s))
        .map(|s| decode_git_path(&s))
        .filter(|s| !s.is_empty())
}

fn strip_diff_ab_prefix(s: &str) -> String {
    let t = s.trim().trim_matches('"');
    if let Some(r) = t.strip_prefix("a/").or_else(|| t.strip_prefix("b/")) {
        r.to_string()
    } else {
        t.to_string()
    }
}

fn count_diff_plus_minus(patch: &str) -> (i32, i32) {
    let mut added = 0i32;
    let mut removed = 0i32;
    for line in patch.split('\n') {
        if line.starts_with("+++") || line.starts_with("---") || line.starts_with("diff ") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

/// One soft-fail bulk load for Review tab: status + numstat + full HEAD diff.
///
/// The whole bundle is several `git` spawns plus patch parsing — blocking
/// pool, so the Review tab loading a big workspace cannot stall the runtime.
#[tauri::command]
pub async fn git_review_bundle(project_path: String) -> Result<GitReviewBundleResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitReviewBundleResult {
            available: false,
            branch: None,
            upstream: None,
            files: vec![],
            total_added: 0,
            total_removed: 0,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitReviewBundleResult {
            available: false,
            branch: None,
            upstream: None,
            files: vec![],
            total_added: 0,
            total_removed: 0,
            reason: Some("project not a directory".into()),
        });
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitReviewBundleResult {
            available: false,
            branch: None,
            upstream: None,
            files: vec![],
            total_added: 0,
            total_removed: 0,
            reason: Some(reason),
        });
    }

    tauri::async_runtime::spawn_blocking(move || git_review_bundle_blocking(project))
        .await
        .map_err(|e| format!("git review bundle worker panicked: {e}"))?
}

fn git_review_bundle_blocking(
    project: String,
) -> Result<GitReviewBundleResult, String> {
    let branch = git_in_project(&project)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b.is_empty() || b == "HEAD" {
                    None
                } else {
                    Some(b)
                }
            } else {
                None
            }
        });

    let upstream = git_in_project(&project)
        .args([
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let u = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if u.is_empty() {
                    None
                } else {
                    Some(u)
                }
            } else {
                None
            }
        });

    // Status for kinds / untracked list
    let status_out = git_in_project(&project)
        .args([
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "-z",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let mut status_by_path: std::collections::HashMap<String, (String, String, char, char)> =
        std::collections::HashMap::new();
    // path -> (status XY, kind, x, y)
    if status_out.status.success() {
        let raw = status_out.stdout;
        let mut i = 0;
        while i < raw.len() {
            let end = raw[i..]
                .iter()
                .position(|&b| b == 0)
                .map(|p| i + p)
                .unwrap_or(raw.len());
            if end == i {
                break;
            }
            let chunk = String::from_utf8_lossy(&raw[i..end]).into_owned();
            i = end + 1;
            if chunk.len() < 3 {
                continue;
            }
            let x = chunk.as_bytes()[0] as char;
            let y = chunk.as_bytes()[1] as char;
            let rest = chunk[2..].trim_start();
            let is_rename = x == 'R' || x == 'C' || y == 'R' || y == 'C';
            let path = if is_rename && i < raw.len() {
                let end2 = raw[i..]
                    .iter()
                    .position(|&b| b == 0)
                    .map(|p| i + p)
                    .unwrap_or(raw.len());
                let newp = decode_git_path(&String::from_utf8_lossy(&raw[i..end2]));
                i = end2 + 1;
                newp
            } else {
                decode_git_path(rest)
            };
            if path.is_empty() {
                continue;
            }
            let kind = git_status_kind(x, y).to_string();
            status_by_path.insert(path, (format!("{x}{y}"), kind, x, y));
        }
    }

    // Numstat for +/− (tracked vs HEAD)
    let mut stats: std::collections::HashMap<String, (i32, i32, bool)> =
        std::collections::HashMap::new();
    if let Ok(ns) = git_in_project(&project)
        .args(["diff", "--numstat", "HEAD"])
        .output()
    {
        if ns.status.success() {
            for line in String::from_utf8_lossy(&ns.stdout).split('\n') {
                let line = line.trim_end();
                if line.is_empty() {
                    continue;
                }
                let mut parts = line.split('\t');
                let a = parts.next().unwrap_or("");
                let r = parts.next().unwrap_or("");
                let p = decode_git_path(parts.next().unwrap_or(""));
                if p.is_empty() {
                    continue;
                }
                if a == "-" || r == "-" {
                    stats.insert(p, (0, 0, true));
                } else {
                    let added = a.parse::<i32>().unwrap_or(0);
                    let removed = r.parse::<i32>().unwrap_or(0);
                    stats.insert(p, (added, removed, false));
                }
            }
        }
    }

    // Full working tree + index vs HEAD patch (single process)
    let mut patches: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if let Ok(diff_out) = git_in_project(&project)
        .args(["diff", "--no-color", "--no-ext-diff", "HEAD"])
        .output()
    {
        if diff_out.status.success() {
            let text = String::from_utf8_lossy(&diff_out.stdout);
            let capped: String = text.chars().take(REVIEW_DIFF_CHAR_CAP).collect();
            for (path, patch) in split_unified_multi_diff(&capped) {
                let clean = decode_git_path(&path);
                if clean.is_empty() {
                    continue;
                }
                let body: String = patch.chars().take(REVIEW_FILE_DIFF_CHAR_CAP).collect();
                patches.insert(clean, body);
            }
        }
    }

    // Build file list: union of status + patches + stats
    let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for p in status_by_path.keys() {
        paths.insert(p.clone());
    }
    for p in patches.keys() {
        paths.insert(p.clone());
    }
    for p in stats.keys() {
        paths.insert(p.clone());
    }

    let mut files: Vec<GitReviewFile> = Vec::new();
    let mut total_added = 0i32;
    let mut total_removed = 0i32;

    for path in paths {
        if path.is_empty() {
            continue;
        }
        let (status, kind, _x, _y) = status_by_path
            .get(&path)
            .cloned()
            .unwrap_or_else(|| (" M".into(), "modified".into(), ' ', 'M'));
        let (mut added, mut removed, binary_stat) =
            stats.get(&path).copied().unwrap_or((0, 0, false));
        let patch = patches.get(&path).cloned();
        let binary = binary_stat
            || patch
                .as_ref()
                .map(|p| p.contains("Binary files ") || p.contains("GIT binary patch"))
                .unwrap_or(false);

        if !binary {
            if let Some(ref p) = patch {
                if added == 0 && removed == 0 {
                    let (a, r) = count_diff_plus_minus(p);
                    added = a;
                    removed = r;
                }
            }
        }

        // Untracked: no HEAD diff — synthesize add-only from working tree when small text
        let mut final_patch = if binary { None } else { patch };
        if kind == "untracked" && final_patch.is_none() && !binary {
            let abs = join_project_rel(&project, &path);
            if let Ok(meta) = std::fs::metadata(&abs) {
                if meta.is_file() && meta.len() <= 128 * 1024 {
                    if let Ok(bytes) = std::fs::read(&abs) {
                        // Skip obvious binary
                        let is_bin = bytes.iter().take(8000).any(|&b| b == 0);
                        if !is_bin {
                            if let Ok(content) = String::from_utf8(bytes) {
                                let mut synth = format!("diff --git a/{path} b/{path}\n");
                                synth.push_str("new file mode 100644\n");
                                synth.push_str("--- /dev/null\n");
                                synth.push_str(&format!("+++ b/{path}\n"));
                                let lines: Vec<&str> = content.split('\n').collect();
                                let n = lines.len() as i32;
                                synth.push_str(&format!("@@ -0,0 +1,{n} @@\n"));
                                for l in &lines {
                                    synth.push('+');
                                    synth.push_str(l);
                                    synth.push('\n');
                                }
                                added = n;
                                removed = 0;
                                final_patch = Some(
                                    synth.chars().take(REVIEW_FILE_DIFF_CHAR_CAP).collect(),
                                );
                            }
                        } else {
                            // binary untracked
                            files.push(GitReviewFile {
                                path: path.clone(),
                                absolute_path: abs,
                                name: git_entry_basename(&path),
                                kind,
                                status,
                                added: 0,
                                removed: 0,
                                diff: None,
                                binary: true,
                            });
                            continue;
                        }
                    }
                }
            }
        }

        total_added += added;
        total_removed += removed;
        files.push(GitReviewFile {
            path: path.clone(),
            absolute_path: join_project_rel(&project, &path),
            name: git_entry_basename(&path),
            kind,
            status,
            added,
            removed,
            diff: final_patch,
            binary,
        });
    }

    // Cap file count for UI
    if files.len() > 2000 {
        files.truncate(2000);
    }

    Ok(GitReviewBundleResult {
        available: true,
        branch,
        upstream,
        files,
        total_added,
        total_removed,
        reason: None,
    })
}

/// File content at HEAD for a path under a project (before snapshot for diffs).
/// Soft-fails for untracked files / missing git / binary truncation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShowFileResult {
    pub available: bool,
    pub content: Option<String>,
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn git_show_file(
    project_path: String,
    path: String,
) -> Result<GitShowFileResult, String> {
    let project = normalize_fs_path(&project_path);
    let target = normalize_fs_path(&path);
    if project.is_empty() || target.is_empty() {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("project not a directory".into()),
        });
    }

    let rel = {
        let t = std::path::PathBuf::from(&target);
        match t.strip_prefix(&proj) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                let p = project.trim_end_matches('/').replace('\\', "/");
                let a = target.replace('\\', "/");
                if a.starts_with(&(p.clone() + "/")) {
                    a[p.len() + 1..].to_string()
                } else {
                    // path may already be repo-relative
                    target.replace('\\', "/")
                }
            }
        }
    };
    if rel.is_empty() || rel == "." {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: None,
            reason: Some("not a file path".into()),
        });
    }

    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some(reason),
        });
    }

    tauri::async_runtime::spawn_blocking(move || git_show_file_blocking(project, rel))
        .await
        .map_err(|e| format!("git show file worker panicked: {e}"))?
}

fn git_show_file_blocking(project: String, rel: String) -> Result<GitShowFileResult, String> {
    // `git show HEAD:path` — fails for untracked / missing at HEAD
    let out = crate::process_util::command("git")
        .args(["-C", &project, "show", &format!("HEAD:{rel}")])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some(if err.is_empty() {
                "not in HEAD".into()
            } else {
                err.chars().take(200).collect()
            }),
        });
    }

    // Reject obvious binary (NUL in first 8k)
    let sample_end = out.stdout.len().min(8192);
    if out.stdout[..sample_end].contains(&0) {
        return Ok(GitShowFileResult {
            available: false,
            content: None,
            relative_path: Some(rel),
            reason: Some("binary file".into()),
        });
    }

    let text = String::from_utf8_lossy(&out.stdout).to_string();
    Ok(GitShowFileResult {
        available: true,
        content: Some(text.chars().take(400_000).collect()),
        relative_path: Some(rel),
        reason: None,
    })
}

// ── Diff accept / reject / restore (Changes panel) ──────────────────────────

/// Resolve a project-relative or absolute path under the project root only.
/// Returns (canonical_project_root, relative_posix, absolute_path).
/// Pure lexical check against project; does not require the file to exist.
fn resolve_path_under_project(
    project_path: &str,
    path: &str,
) -> Result<(std::path::PathBuf, String, std::path::PathBuf), String> {
    let project = normalize_fs_path(project_path);
    let target = normalize_fs_path(path);
    if project.is_empty() || target.is_empty() {
        return Err("empty path".into());
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Err("project not a directory".into());
    }
    // Canonical project root when possible; always path-scoped below.
    let root = proj.canonicalize().unwrap_or(proj);

    let target_pb = std::path::PathBuf::from(&target);
    let (rel, abs) = if target_pb.is_absolute() {
        let abs_norm = target_pb.canonicalize().unwrap_or(target_pb.clone());
        let rel = match abs_norm.strip_prefix(&root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                let p = root.to_string_lossy().replace('\\', "/");
                let a = abs_norm.to_string_lossy().replace('\\', "/");
                let p = p.trim_end_matches('/').to_string();
                if a.starts_with(&(p.clone() + "/")) {
                    a[p.len() + 1..].to_string()
                } else {
                    return Err("path outside project root".into());
                }
            }
        };
        if rel.is_empty() || rel == "." {
            return Err("not a file path".into());
        }
        if rel.contains("..") {
            return Err("path escapes project root".into());
        }
        (rel, abs_norm)
    } else {
        // Relative under project — reject `..` components.
        // On Windows, Path::is_absolute is false for Unix-style "/etc/passwd";
        // do not strip a leading slash and treat it as project-relative.
        if target.starts_with('/') || target.starts_with('\\') {
            return Err("path outside project root".into());
        }
        let rel = target
            .trim_start_matches("./")
            .replace('\\', "/");
        if rel.is_empty() || rel == "." {
            return Err("not a file path".into());
        }
        for comp in std::path::Path::new(&rel).components() {
            match comp {
                std::path::Component::Normal(_) | std::path::Component::CurDir => {}
                _ => return Err("path escapes project root".into()),
            }
        }
        let abs = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        (rel, abs)
    };

    // Final guard: abs must stay under root lexically
    let abs_s = abs.to_string_lossy().replace('\\', "/");
    let root_s = root.to_string_lossy().replace('\\', "/");
    let root_prefix = root_s.trim_end_matches('/').to_string() + "/";
    if abs_s != root_s.trim_end_matches('/') && !abs_s.starts_with(&root_prefix) {
        return Err("path outside project root".into());
    }
    Ok((root, rel, abs))
}

/// Result of writing full file content under the project (accept / restore / reject-before).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyFilePatchResult {
    pub ok: bool,
    pub absolute_path: Option<String>,
    pub relative_path: Option<String>,
    pub reason: Option<String>,
}

/// Write UTF-8 content to a path under the project only (create parents if needed).
/// Used by Changes Accept / Restore and non-git reject (write before snapshot).
#[tauri::command]
pub async fn apply_file_patch(
    project_path: String,
    path: String,
    content: String,
) -> Result<ApplyFilePatchResult, String> {
    let (root, rel, abs) = match resolve_path_under_project(&project_path, &path) {
        Ok(v) => v,
        Err(reason) => {
            return Ok(ApplyFilePatchResult {
                ok: false,
                absolute_path: None,
                relative_path: None,
                reason: Some(reason),
            });
        }
    };

    // Cap size (same order as resource-pane text save)
    const MAX_BYTES: usize = 2 * 1024 * 1024;
    if content.len() > MAX_BYTES {
        return Ok(ApplyFilePatchResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            reason: Some(format!("content too large (max {MAX_BYTES} bytes)")),
        });
    }

    // Up to 2MB temp-write + rename — blocking pool.
    tauri::async_runtime::spawn_blocking(move || apply_file_patch_blocking(root, rel, abs, content))
        .await
        .map_err(|e| format!("file write worker panicked: {e}"))?
}

fn apply_file_patch_blocking(
    root: std::path::PathBuf,
    rel: String,
    abs: std::path::PathBuf,
    content: String,
) -> Result<ApplyFilePatchResult, String> {
    if let Some(parent) = abs.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Ok(ApplyFilePatchResult {
                ok: false,
                absolute_path: Some(abs.to_string_lossy().to_string()),
                relative_path: Some(rel),
                reason: Some(format!("create parent: {e}")),
            });
        }
    }

    // Atomic-ish write via temp + rename in same directory
    let parent = abs.parent().unwrap_or(root.as_path());
    let tmp = parent.join(format!(
        ".{}.grok-patch-{}",
        abs.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file"),
        std::process::id()
    ));
    if let Err(e) = std::fs::write(&tmp, content.as_bytes()) {
        return Ok(ApplyFilePatchResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            reason: Some(format!("write temp: {e}")),
        });
    }
    if let Err(e) = std::fs::rename(&tmp, &abs) {
        let _ = std::fs::remove_file(&tmp);
        return Ok(ApplyFilePatchResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            reason: Some(format!("rename into place: {e}")),
        });
    }

    // Grant for media/re-open
    crate::path_scope::grant_path(&abs);

    Ok(ApplyFilePatchResult {
        ok: true,
        absolute_path: Some(abs.to_string_lossy().to_string()),
        relative_path: Some(rel),
        reason: None,
    })
}

/// Result of restoring a path to HEAD (or deleting untracked with confirm).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutFileResult {
    pub ok: bool,
    pub absolute_path: Option<String>,
    pub relative_path: Option<String>,
    /// When true, caller must re-invoke with confirm_untracked=true.
    pub needs_untracked_confirm: bool,
    pub reason: Option<String>,
    /// Action taken: restored | deleted | none
    pub action: Option<String>,
}

/// Restore path to HEAD via `git checkout -- path` (reject agent/workspace edits).
/// Soft-fails when git is missing or project is not a repo.
/// Never deletes untracked files unless `confirm_untracked` is true.
#[tauri::command]
pub async fn git_checkout_file(
    project_path: String,
    path: String,
    confirm_untracked: bool,
) -> Result<GitCheckoutFileResult, String> {
    let (root, rel, abs) = match resolve_path_under_project(&project_path, &path) {
        Ok(v) => v,
        Err(reason) => {
            return Ok(GitCheckoutFileResult {
                ok: false,
                absolute_path: None,
                relative_path: None,
                needs_untracked_confirm: false,
                reason: Some(reason),
                action: Some("none".into()),
            });
        }
    };
    let project = root.to_string_lossy().to_string();

    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitCheckoutFileResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            needs_untracked_confirm: false,
            reason: Some(reason),
            action: Some("none".into()),
        });
    }

    // File delete / `git checkout` / `git restore` are process spawns plus
    // disk writes — run on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || {
        git_checkout_file_blocking(project, rel, abs, confirm_untracked)
    })
    .await
    .map_err(|e| format!("git checkout worker panicked: {e}"))?
}

fn git_checkout_file_blocking(
    project: String,
    rel: String,
    abs: std::path::PathBuf,
    confirm_untracked: bool,
) -> Result<GitCheckoutFileResult, String> {
    // Is path tracked?
    let tracked = crate::process_util::command("git")
        .args(["-C", &project, "ls-files", "--error-unmatch", "--", &rel])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !tracked {
        // Untracked: only wipe with explicit confirm
        if !confirm_untracked {
            return Ok(GitCheckoutFileResult {
                ok: false,
                absolute_path: Some(abs.to_string_lossy().to_string()),
                relative_path: Some(rel),
                needs_untracked_confirm: true,
                reason: Some("untracked file requires confirm".into()),
                action: Some("none".into()),
            });
        }
        if abs.is_file() {
            if let Err(e) = std::fs::remove_file(&abs) {
                return Ok(GitCheckoutFileResult {
                    ok: false,
                    absolute_path: Some(abs.to_string_lossy().to_string()),
                    relative_path: Some(rel),
                    needs_untracked_confirm: false,
                    reason: Some(format!("delete untracked: {e}")),
                    action: Some("none".into()),
                });
            }
        } else if abs.is_dir() {
            // Refuse recursive dir wipe for safety
            return Ok(GitCheckoutFileResult {
                ok: false,
                absolute_path: Some(abs.to_string_lossy().to_string()),
                relative_path: Some(rel),
                needs_untracked_confirm: false,
                reason: Some("refusing to delete untracked directory".into()),
                action: Some("none".into()),
            });
        }
        // Already gone counts as success
        return Ok(GitCheckoutFileResult {
            ok: true,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            needs_untracked_confirm: false,
            reason: None,
            action: Some("deleted".into()),
        });
    }

    // Tracked: restore HEAD into index + worktree for this path only
    let out = crate::process_util::command("git")
        .args(["-C", &project, "checkout", "HEAD", "--", &rel])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        // Fallback: git restore (newer git)
        let out2 = crate::process_util::command("git")
            .args([
                "-C",
                &project,
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                &rel,
            ])
            .output();
        if let Ok(o2) = out2 {
            if o2.status.success() {
                return Ok(GitCheckoutFileResult {
                    ok: true,
                    absolute_path: Some(abs.to_string_lossy().to_string()),
                    relative_path: Some(rel),
                    needs_untracked_confirm: false,
                    reason: None,
                    action: Some("restored".into()),
                });
            }
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitCheckoutFileResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            needs_untracked_confirm: false,
            reason: Some(if err.is_empty() {
                "git checkout failed".into()
            } else {
                err.chars().take(200).collect()
            }),
            action: Some("none".into()),
        });
    }

    Ok(GitCheckoutFileResult {
        ok: true,
        absolute_path: Some(abs.to_string_lossy().to_string()),
        relative_path: Some(rel),
        needs_untracked_confirm: false,
        reason: None,
        action: Some("restored".into()),
    })
}

