/// Max name-status rows returned by the host (client may cap further for display).
const GIT_WORKTREE_COMPARE_ENTRY_CAP: usize = 2_000;

/// Soft-fail compare of two worktree paths via `git diff --name-status <base>...<other>`.
///
/// Prefer explicit branch names when provided; otherwise resolve each path's HEAD.
/// Both paths must be directories inside the same git common dir. Never merges/applies.
#[tauri::command]
pub async fn git_worktree_compare(
    base_path: String,
    other_path: String,
    base_branch: Option<String>,
    other_branch: Option<String>,
) -> Result<GitWorktreeCompareResult, String> {
    let base = normalize_fs_path(&base_path);
    let other = normalize_fs_path(&other_path);

    let empty = |reason: &str| GitWorktreeCompareResult {
        available: false,
        entries: vec![],
        raw: None,
        reason: Some(reason.into()),
        base: base.clone(),
        other: other.clone(),
        base_ref: None,
        other_ref: None,
        truncated: false,
        total: 0,
    };

    if base.is_empty() || other.is_empty() {
        return Ok(empty("missing_path"));
    }
    if worktree_paths_equal(&base, &other) {
        return Ok(empty("same_path"));
    }
    if base.starts_with('-') || other.starts_with('-') {
        return Ok(empty("invalid path"));
    }

    let base_pb = std::path::PathBuf::from(&base);
    let other_pb = std::path::PathBuf::from(&other);
    if !base_pb.is_dir() || !other_pb.is_dir() {
        return Ok(empty("missing_path"));
    }

    if let Err(reason) = git_probe_work_tree(&base) {
        return Ok(empty(&reason));
    }
    if let Err(reason) = git_probe_work_tree(&other) {
        return Ok(empty(&reason));
    }

    // Same repository (shared common dir) — refuse unrelated paths.
    let base_common = git_rev_parse_path(&base, "--git-common-dir");
    let other_common = git_rev_parse_path(&other, "--git-common-dir");
    match (base_common.as_ref(), other_common.as_ref()) {
        (Some(a), Some(b)) if !worktree_paths_equal(a, b) => {
            return Ok(empty("not same repository"));
        }
        (None, _) | (_, None) => {
            return Ok(empty("not a git repository"));
        }
        _ => {}
    }

    let base_ref = resolve_compare_ref(&base, base_branch.as_deref());
    let other_ref = resolve_compare_ref(&other, other_branch.as_deref());
    let (Some(left), Some(right)) = (base_ref.as_ref(), other_ref.as_ref()) else {
        return Ok(empty("could not resolve refs"));
    };

    // Cross-worktree diff spans two checkouts — blocking pool.
    let base_cloned = base.clone();
    let other_cloned = other.clone();
    let left_cloned = left.clone();
    let right_cloned = right.clone();
    tauri::async_runtime::spawn_blocking(move || {
        git_worktree_compare_blocking(base_cloned, other_cloned, left_cloned, right_cloned)
    })
    .await
    .map_err(|e| format!("git worktree compare worker panicked: {e}"))?
}

fn git_worktree_compare_blocking(
    base: String,
    other: String,
    left: String,
    right: String,
) -> Result<GitWorktreeCompareResult, String> {
    // Safe argv — never go through a shell.
    // `git -C <base> diff --name-status <left>...<right>`
    let range = format!("{left}...{right}");
    let out = crate::process_util::command("git")
        .args(["-C", &base, "diff", "--name-status", &range])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err
        };
        return Ok(GitWorktreeCompareResult {
            available: false,
            entries: vec![],
            raw: None,
            reason: Some(if err.is_empty() {
                "git diff failed".into()
            } else {
                err.chars().take(400).collect()
            }),
            base,
            other,
            base_ref: Some(left.clone()),
            other_ref: Some(right.clone()),
            truncated: false,
            total: 0,
        });
    }

    let raw_full = String::from_utf8_lossy(&out.stdout).to_string();
    let parsed = parse_name_status(&raw_full);
    let total = parsed.len();
    let truncated = total > GIT_WORKTREE_COMPARE_ENTRY_CAP;
    let entries: Vec<GitWorktreeCompareEntry> = parsed
        .into_iter()
        .take(GIT_WORKTREE_COMPARE_ENTRY_CAP)
        .collect();
    // Cap raw for IPC size honesty.
    let raw = Some(raw_full.chars().take(200_000).collect::<String>());

    Ok(GitWorktreeCompareResult {
        available: true,
        entries,
        raw,
        reason: None,
        base,
        other,
        base_ref: Some(left.clone()),
        other_ref: Some(right.clone()),
        truncated,
        total,
    })
}

/// Resolve a compare ref: prefer sanitized branch name, else `rev-parse HEAD`.
fn resolve_compare_ref(project: &str, branch: Option<&str>) -> Option<String> {
    if let Some(b) = branch.map(str::trim).filter(|s| !s.is_empty()) {
        if b.starts_with('-') || b.contains('\0') || b.contains('\n') || b.contains('\r') {
            // Fall through to HEAD — never pass option-like / control refs.
        } else if b.len() <= 256 && !b.contains("..") {
            // Verify ref resolves under this worktree.
            if let Some(full) = git_rev_parse_output(project, b) {
                // Return the user-facing branch name when it resolves (nicer UI);
                // three-dot range accepts branch names.
                let _ = full;
                return Some(b.to_string());
            }
        }
    }
    git_rev_parse_output(project, "HEAD")
}

fn git_rev_parse_output(project: &str, rev: &str) -> Option<String> {
    let out = crate::process_util::command("git")
        .args(["-C", project, "rev-parse", "--verify", rev])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// `git rev-parse <flag>` absolute-ish path (for --git-common-dir).
fn git_rev_parse_path(project: &str, flag: &str) -> Option<String> {
    let out = crate::process_util::command("git")
        .args(["-C", project, "rev-parse", flag])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    // Relative common-dir → resolve against project.
    let pb = std::path::PathBuf::from(&s);
    let abs = if pb.is_absolute() {
        pb
    } else {
        std::path::PathBuf::from(project).join(pb)
    };
    let canon = abs.canonicalize().unwrap_or(abs);
    Some(normalize_fs_path(&canon.to_string_lossy()))
}

/// Parse `git diff --name-status` stdout (mirrors frontend `parseNameStatus`).
fn parse_name_status(raw: &str) -> Vec<GitWorktreeCompareEntry> {
    let text = raw.replace("\r\n", "\n");
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim_end();
        if t.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = if t.contains('\t') {
            t.split('\t').collect()
        } else {
            t.split_whitespace().collect()
        };
        if parts.len() < 2 {
            continue;
        }
        let status = parts[0].trim();
        if status.is_empty() {
            continue;
        }
        if parts.len() >= 3 {
            let old = parts[1].trim().replace('\\', "/");
            let newp = parts[2].trim().replace('\\', "/");
            if old.is_empty() && newp.is_empty() {
                continue;
            }
            out.push(GitWorktreeCompareEntry {
                status: status.to_string(),
                path: if newp.is_empty() {
                    old.clone()
                } else {
                    newp
                },
                old_path: if old.is_empty() { None } else { Some(old) },
            });
        } else {
            let path = parts[1].trim().replace('\\', "/");
            if path.is_empty() {
                continue;
            }
            out.push(GitWorktreeCompareEntry {
                status: status.to_string(),
                path,
                old_path: None,
            });
        }
    }
    out
}

#[cfg(test)]
mod git_worktree_compare_parse_tests {
    use super::*;

    #[test]
    fn parse_name_status_amd() {
        let raw = "A\tsrc/new.ts\nM\tREADME.md\nD\told.txt\n";
        let list = parse_name_status(raw);
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].status, "A");
        assert_eq!(list[0].path, "src/new.ts");
        assert!(list[0].old_path.is_none());
        assert_eq!(list[1].status, "M");
        assert_eq!(list[2].status, "D");
    }

    #[test]
    fn parse_name_status_rename() {
        let raw = "R100\told/a.ts\tnew/a.ts\n";
        let list = parse_name_status(raw);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].status, "R100");
        assert_eq!(list[0].path, "new/a.ts");
        assert_eq!(list[0].old_path.as_deref(), Some("old/a.ts"));
    }

    #[test]
    fn parse_name_status_empty() {
        assert!(parse_name_status("").is_empty());
        assert!(parse_name_status("\n\n").is_empty());
    }
}

// ── Worktree ship flow (push + gh pr create) ────────────────────────────────

/// Soft-fail result of `git push -u origin HEAD` under a project path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushBranchResult {
    pub available: bool,
    pub ok: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub reason: Option<String>,
}

/// Soft-fail result of `gh pr create` under a project path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPrCreateResult {
    pub available: bool,
    pub ok: bool,
    pub url: Option<String>,
    pub repo: Option<String>,
    pub base: Option<String>,
    pub head: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub reason: Option<String>,
}

fn ship_redact_output(s: &str, max: usize) -> String {
    let scrubbed = store::redact_text(s);
    let t = scrubbed.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        t.chars().take(max).collect::<String>() + "…"
    }
}

/// Parse `git@host:org/repo.git` / `https://host/org/repo.git` → `org/repo` (pure).
pub fn parse_github_owner_repo(url: &str) -> Option<String> {
    let s = url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches(".GIT");
    if s.is_empty() {
        return None;
    }
    // SSH: git@github.com:org/repo
    if let Some(idx) = s.find(':') {
        let rest = &s[idx + 1..];
        if !rest.contains("://") && rest.contains('/') {
            let parts: Vec<&str> = rest
                .trim_start_matches('/')
                .split('/')
                .filter(|p| !p.is_empty())
                .collect();
            if parts.len() >= 2 {
                return Some(format!(
                    "{}/{}",
                    parts[parts.len() - 2],
                    parts[parts.len() - 1]
                ));
            }
        }
    }
    // HTTPS path: take last two segments
    let parts: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() >= 2 {
        let org = parts[parts.len() - 2];
        let repo = parts[parts.len() - 1];
        if !org.is_empty() && !repo.is_empty() && !org.contains('@') {
            return Some(format!("{org}/{repo}"));
        }
    }
    None
}

fn github_owner_from_repo(owner_repo: &str) -> Option<&str> {
    let (o, _) = owner_repo.split_once('/')?;
    let o = o.trim();
    if o.is_empty() {
        None
    } else {
        Some(o)
    }
}

/// Build `gh --head` value for forks (`owner:branch`) or same-repo bare branch.
pub fn build_gh_head_ref(
    branch: &str,
    origin_owner_repo: Option<&str>,
    base_owner_repo: Option<&str>,
) -> String {
    let b = branch.trim();
    if b.is_empty() {
        return String::new();
    }
    let origin_owner = origin_owner_repo.and_then(github_owner_from_repo);
    let base_owner = base_owner_repo.and_then(github_owner_from_repo);
    match (origin_owner, base_owner) {
        (Some(o), Some(base)) if o != base => format!("{o}:{b}"),
        _ => b.to_string(),
    }
}

/// Extract first GitHub PR URL from gh stdout/stderr (pure).
pub fn parse_gh_pr_url(output: &str) -> Option<String> {
    // https://github.com/org/repo/pull/123
    let bytes = output.as_bytes();
    let needle = b"https://github.com/";
    let mut i = 0;
    while i + needle.len() < bytes.len() {
        if bytes[i..].starts_with(needle) {
            let start = i;
            let mut end = i + needle.len();
            while end < bytes.len() {
                let c = bytes[end];
                if c.is_ascii_alphanumeric()
                    || c == b'/'
                    || c == b'-'
                    || c == b'_'
                    || c == b'.'
                {
                    end += 1;
                } else {
                    break;
                }
            }
            let candidate = &output[start..end];
            if candidate.contains("/pull/") {
                // Trim trailing punctuation
                let cleaned = candidate
                    .trim_end_matches(|c: char| !c.is_ascii_alphanumeric());
                if cleaned.contains("/pull/") {
                    return Some(cleaned.to_string());
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
    None
}

/// Sanitize PR title for argv (single line, required).
pub fn sanitize_pr_title(raw: &str) -> Result<String, String> {
    let s = raw
        .replace(['\0', '\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if s.is_empty() {
        return Err("PR title is required".into());
    }
    if s.chars().count() > 256 {
        return Err("PR title too long (max 256)".into());
    }
    Ok(s)
}

/// Sanitize PR body (allow multiline; strip NUL).
pub fn sanitize_pr_body(raw: Option<&str>) -> Result<String, String> {
    let s = raw.unwrap_or("").replace('\0', "").replace("\r\n", "\n").replace('\r', "\n");
    if s.chars().count() > 65_536 {
        return Err("PR body too long".into());
    }
    Ok(s)
}

/// Sanitize `owner/repo` for `--repo`.
pub fn sanitize_github_repo_arg(raw: Option<&str>) -> Result<Option<String>, String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty());
    let Some(s) = s else {
        return Ok(None);
    };
    if s.starts_with('-') {
        return Err("repo must not start with '-'".into());
    }
    if s.len() > 200 {
        return Err("repo too long".into());
    }
    let mut parts = s.split('/');
    let org = parts.next().unwrap_or("");
    let name = parts.next().unwrap_or("");
    if parts.next().is_some() || org.is_empty() || name.is_empty() {
        return Err("repo must be owner/name".into());
    }
    if !org
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("repo must be owner/name".into());
    }
    Ok(Some(format!("{org}/{name}")))
}

fn sanitize_ship_branch(raw: Option<&str>) -> Result<Option<String>, String> {
    let s = raw.map(str::trim).filter(|s| !s.is_empty());
    let Some(s) = s else {
        return Ok(None);
    };
    if s.starts_with('-') {
        return Err("branch must not start with '-'".into());
    }
    if s.len() > 256 || s.contains('\0') || s.contains('\n') || s.contains('\r') {
        return Err("invalid branch".into());
    }
    if s == "HEAD" || s == "@" {
        return Ok(None);
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
    {
        return Err("branch contains invalid characters".into());
    }
    Ok(Some(s.to_string()))
}

/// Build argv for `git push -u origin HEAD` (no binary; pure).
pub fn build_git_push_args(project: &str) -> Result<Vec<String>, String> {
    let project = normalize_fs_path(project);
    if project.is_empty() {
        return Err("empty path".into());
    }
    if project.starts_with('-') {
        return Err("invalid project path".into());
    }
    Ok(vec![
        "-C".into(),
        project,
        "push".into(),
        "-u".into(),
        "origin".into(),
        "HEAD".into(),
    ])
}

/// Build argv for `gh pr create` (no binary; pure).
pub fn build_gh_pr_create_args(
    title: &str,
    body: &str,
    draft: bool,
    base: &str,
    head: Option<&str>,
    repo: Option<&str>,
) -> Result<Vec<String>, String> {
    let title = sanitize_pr_title(title)?;
    let body = sanitize_pr_body(Some(body))?;
    let base = sanitize_ship_branch(Some(base))?
        .unwrap_or_else(|| "main".into());
    let repo = sanitize_github_repo_arg(repo)?;
    let head = match head {
        Some(h) if !h.trim().is_empty() => {
            let h = h.trim();
            if h.starts_with('-') || h.contains('\0') || h.contains('\n') {
                return Err("invalid head".into());
            }
            Some(h.to_string())
        }
        _ => None,
    };

    let mut args = vec![
        "pr".into(),
        "create".into(),
        "--title".into(),
        title,
        "--body".into(),
        body,
    ];
    if let Some(r) = repo {
        args.push("--repo".into());
        args.push(r);
    }
    args.push("--base".into());
    args.push(base);
    if let Some(h) = head {
        args.push("--head".into());
        args.push(h);
    }
    if draft {
        args.push("--draft".into());
    }
    Ok(args)
}

fn git_remote_url(project: &str, name: &str) -> Option<String> {
    let out = crate::process_util::command("git")
        .args(["-C", project, "remote", "get-url", name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn git_current_branch(project: &str) -> Option<String> {
    let out = crate::process_util::command("git")
        .args(["-C", project, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let b = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if b.is_empty() || b == "HEAD" {
        None
    } else {
        Some(b)
    }
}

fn probe_binary_on_path(bin: &str) -> bool {
    let mut cmd = crate::process_util::command(bin);
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn apply_ship_process_env(cmd: &mut std::process::Command) {
    if let Some(path_env) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    #[cfg(unix)]
    {
        if std::path::Path::new("/usr/bin/ssh").exists() {
            cmd.env("GIT_SSH_COMMAND", "/usr/bin/ssh");
        }
    }
}

/// Push the current HEAD branch to `origin` (`git push -u origin HEAD`).
/// Soft-fails when git / remote / non-repo are missing (available=false).
#[tauri::command]
pub async fn git_push_branch(project_path: String) -> Result<GitPushBranchResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitPushBranchResult {
            available: false,
            ok: false,
            branch: None,
            remote: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitPushBranchResult {
            available: false,
            ok: false,
            branch: None,
            remote: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("project not a directory".into()),
        });
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitPushBranchResult {
            available: false,
            ok: false,
            branch: None,
            remote: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some(reason),
        });
    }

    let branch = git_current_branch(&project);
    let remote = git_remote_url(&project, "origin");
    if remote.is_none() {
        return Ok(GitPushBranchResult {
            available: false,
            ok: false,
            branch,
            remote: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("no origin remote".into()),
        });
    }

    let args = build_git_push_args(&project)?;
    let project_for_cmd = project.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = crate::process_util::command("git");
        apply_ship_process_env(&mut cmd);
        cmd.args(&args)
            .current_dir(&project_for_cmd)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let stdout = ship_redact_output(&String::from_utf8_lossy(&out.stdout), 4000);
    let stderr = ship_redact_output(&String::from_utf8_lossy(&out.stderr), 4000);
    if out.status.success() {
        Ok(GitPushBranchResult {
            available: true,
            ok: true,
            branch,
            remote,
            stdout,
            stderr,
            reason: None,
        })
    } else {
        let reason = if !stderr.is_empty() {
            stderr.chars().take(400).collect()
        } else if !stdout.is_empty() {
            stdout.chars().take(400).collect()
        } else {
            "git push failed".into()
        };
        Ok(GitPushBranchResult {
            available: true,
            ok: false,
            branch,
            remote,
            stdout,
            stderr,
            reason: Some(reason),
        })
    }
}

/// Create a GitHub pull request via `gh pr create` (argv only, no shell).
/// Soft-fails when `gh` is missing. Never reports ok without a PR URL.
#[tauri::command]
pub async fn gh_pr_create(
    project_path: String,
    title: String,
    body: Option<String>,
    draft: Option<bool>,
    base: Option<String>,
    head: Option<String>,
    repo: Option<String>,
) -> Result<GhPrCreateResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GhPrCreateResult {
            available: false,
            ok: false,
            url: None,
            repo: None,
            base: None,
            head: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("empty path".into()),
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GhPrCreateResult {
            available: false,
            ok: false,
            url: None,
            repo: None,
            base: None,
            head: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("project not a directory".into()),
        });
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GhPrCreateResult {
            available: false,
            ok: false,
            url: None,
            repo: None,
            base: None,
            head: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some(reason),
        });
    }

    if !probe_binary_on_path("gh") {
        return Ok(GhPrCreateResult {
            available: false,
            ok: false,
            url: None,
            repo: None,
            base: None,
            head: None,
            stdout: String::new(),
            stderr: String::new(),
            reason: Some("gh not available".into()),
        });
    }

    let branch = git_current_branch(&project);
    let origin_url = git_remote_url(&project, "origin");
    let upstream_url = git_remote_url(&project, "upstream");
    let origin_or = origin_url.as_deref().and_then(parse_github_owner_repo);
    let upstream_or = upstream_url.as_deref().and_then(parse_github_owner_repo);

    let repo_arg = match sanitize_github_repo_arg(repo.as_deref())? {
        Some(r) => Some(r),
        None => upstream_or.clone().or_else(|| origin_or.clone()),
    };
    let base_branch = sanitize_ship_branch(base.as_deref())?
        .unwrap_or_else(|| "main".into());
    let head_ref = if let Some(h) = head.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if h.starts_with('-') || h.contains('\0') || h.contains('\n') {
            return Err("invalid head".into());
        }
        Some(h.to_string())
    } else if let Some(ref b) = branch {
        let h = build_gh_head_ref(
            b,
            origin_or.as_deref(),
            repo_arg.as_deref(),
        );
        if h.is_empty() {
            None
        } else {
            Some(h)
        }
    } else {
        None
    };

    let title_s = sanitize_pr_title(&title)?;
    let body_s = sanitize_pr_body(body.as_deref())?;
    let draft_flag = draft.unwrap_or(false);
    let args = build_gh_pr_create_args(
        &title_s,
        &body_s,
        draft_flag,
        &base_branch,
        head_ref.as_deref(),
        repo_arg.as_deref(),
    )?;

    let project_for_cmd = project.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = crate::process_util::command("gh");
        apply_ship_process_env(&mut cmd);
        cmd.args(&args)
            .current_dir(&project_for_cmd)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let stdout = ship_redact_output(&String::from_utf8_lossy(&out.stdout), 4000);
    let stderr = ship_redact_output(&String::from_utf8_lossy(&out.stderr), 4000);
    let combined = format!("{stdout}\n{stderr}");
    let url = parse_gh_pr_url(&combined);

    if out.status.success() {
        if let Some(u) = url {
            Ok(GhPrCreateResult {
                available: true,
                ok: true,
                url: Some(u),
                repo: repo_arg,
                base: Some(base_branch),
                head: head_ref,
                stdout,
                stderr,
                reason: None,
            })
        } else {
            // Never fake success without a URL.
            Ok(GhPrCreateResult {
                available: true,
                ok: false,
                url: None,
                repo: repo_arg,
                base: Some(base_branch),
                head: head_ref,
                stdout,
                stderr,
                reason: Some("gh pr create succeeded but PR URL missing".into()),
            })
        }
    } else {
        let reason = if !stderr.is_empty() {
            stderr.chars().take(400).collect()
        } else if !stdout.is_empty() {
            stdout.chars().take(400).collect()
        } else {
            "gh pr create failed".into()
        };
        Ok(GhPrCreateResult {
            available: true,
            ok: false,
            url,
            repo: repo_arg,
            base: Some(base_branch),
            head: head_ref,
            stdout,
            stderr,
            reason: Some(reason),
        })
    }
}

#[cfg(test)]
mod ship_flow_tests {
    use super::*;

    #[test]
    fn parse_github_owner_repo_ssh_https() {
        assert_eq!(
            parse_github_owner_repo("git@github.com:RongleCat/grok-app.git").as_deref(),
            Some("RongleCat/grok-app")
        );
        assert_eq!(
            parse_github_owner_repo("https://github.com/sonnemusk/grok-app.git").as_deref(),
            Some("sonnemusk/grok-app")
        );
    }

    #[test]
    fn build_gh_head_fork_vs_same() {
        assert_eq!(
            build_gh_head_ref(
                "feat/wt-ship-flow",
                Some("sonnemusk/grok-app"),
                Some("RongleCat/grok-app"),
            ),
            "sonnemusk:feat/wt-ship-flow"
        );
        assert_eq!(
            build_gh_head_ref(
                "feat/x",
                Some("RongleCat/grok-app"),
                Some("RongleCat/grok-app"),
            ),
            "feat/x"
        );
    }

    #[test]
    fn parse_gh_pr_url_extracts() {
        let out = "Creating pull request for feat/x into main in RongleCat/grok-app\n\nhttps://github.com/RongleCat/grok-app/pull/99\n";
        assert_eq!(
            parse_gh_pr_url(out).as_deref(),
            Some("https://github.com/RongleCat/grok-app/pull/99")
        );
        assert!(parse_gh_pr_url("nope").is_none());
    }

    #[test]
    fn build_git_push_args_ok() {
        let a = build_git_push_args("/Users/me/repo").unwrap();
        assert_eq!(
            a,
            vec!["-C", "/Users/me/repo", "push", "-u", "origin", "HEAD"]
        );
        assert!(build_git_push_args("").is_err());
        assert!(build_git_push_args("-C").is_err());
    }

    #[test]
    fn build_gh_pr_create_args_fork_shape() {
        let a = build_gh_pr_create_args(
            "feat: ship",
            "body",
            true,
            "main",
            Some("sonnemusk:feat/wt-ship-flow"),
            Some("RongleCat/grok-app"),
        )
        .unwrap();
        assert!(a.windows(2).any(|w| w == ["--repo", "RongleCat/grok-app"]));
        assert!(a
            .windows(2)
            .any(|w| w == ["--head", "sonnemusk:feat/wt-ship-flow"]));
        assert!(a.iter().any(|x| x == "--draft"));
        assert!(a.windows(2).any(|w| w == ["--title", "feat: ship"]));
    }

    #[test]
    fn sanitize_pr_title_required() {
        assert!(sanitize_pr_title("  ").is_err());
        assert_eq!(sanitize_pr_title("Hello\nworld").unwrap(), "Hello world");
    }
}

