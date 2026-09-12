// In-place git branch list + switch (composer branch chip).
// Argv only — no shell. Soft-fails when git / repo missing.

const GIT_BRANCH_LIST_CAP: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    pub current: bool,
    pub remote: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesResult {
    pub available: bool,
    pub branches: Vec<GitBranchEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSwitchBranchResult {
    pub available: bool,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_branch: Option<String>,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn git_branch_name_ok(name: &str) -> bool {
    if name.is_empty() || name.len() > 256 {
        return false;
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    if name.ends_with('.') || name.ends_with(".lock") {
        return false;
    }
    if name.contains('\0')
        || name.contains('\n')
        || name.contains('\r')
        || name.contains('\t')
        || name.contains(' ')
        || name.contains("..")
        || name.contains("@{")
        || name.contains('\\')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains("//")
    {
        return false;
    }
    true
}

fn sanitize_git_branch_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("branch name is required".into());
    }
    if !git_branch_name_ok(name) {
        return Err("invalid branch name".into());
    }
    Ok(name.to_string())
}

fn is_remote_head_ref(name: &str) -> bool {
    let s = name.trim();
    s == "HEAD" || s.ends_with("/HEAD")
}

fn local_name_from_remote_ref(name: &str) -> String {
    match name.find('/') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_string(),
        _ => name.to_string(),
    }
}

fn normalize_worktree_field(raw: &str) -> Option<String> {
    let mut p = raw.trim().replace('\\', "/");
    while p.ends_with('/') && p.len() > 1 {
        p.pop();
    }
    if p.is_empty() {
        None
    } else {
        Some(p)
    }
}

/// Local: `HEAD\\tref\\tsha\\tupstream\\tworktreepath`
/// Remote: `ref\\tsha`
pub fn parse_git_branch_for_each_ref(raw: &str, remote: bool) -> Vec<GitBranchEntry> {
    let text = raw.replace("\r\n", "\n");
    let mut out = Vec::new();
    for line in text.lines() {
        if out.len() >= GIT_BRANCH_LIST_CAP {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        if remote {
            let name = cols.first().map(|s| s.trim()).unwrap_or("");
            if name.is_empty() || is_remote_head_ref(name) || !git_branch_name_ok(name) {
                continue;
            }
            let sha = cols
                .get(1)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            out.push(GitBranchEntry {
                name: name.to_string(),
                sha,
                current: false,
                remote: true,
                upstream: Some(name.to_string()),
                worktree_path: None,
            });
            continue;
        }
        let head = cols.first().map(|s| s.trim()).unwrap_or("");
        let name = cols.get(1).map(|s| s.trim()).unwrap_or("");
        if name.is_empty() || !git_branch_name_ok(name) {
            continue;
        }
        let sha = cols
            .get(2)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let upstream = cols
            .get(3)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let worktree_path = cols
            .get(4)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .and_then(normalize_worktree_field);
        out.push(GitBranchEntry {
            name: name.to_string(),
            sha,
            current: head == "*",
            remote: false,
            upstream,
            worktree_path,
        });
    }
    out
}

pub fn merge_git_branch_lists(
    local: Vec<GitBranchEntry>,
    remote: Vec<GitBranchEntry>,
) -> Vec<GitBranchEntry> {
    let mut names: std::collections::HashSet<String> =
        local.iter().map(|b| b.name.to_ascii_lowercase()).collect();
    let mut extra = Vec::new();
    for row in remote {
        if !row.remote {
            continue;
        }
        if is_remote_head_ref(&row.name) {
            continue;
        }
        let local_name = local_name_from_remote_ref(&row.name);
        if local_name.is_empty() {
            continue;
        }
        let key = local_name.to_ascii_lowercase();
        if names.contains(&key) {
            continue;
        }
        names.insert(key);
        extra.push(row);
        if local.len() + extra.len() >= GIT_BRANCH_LIST_CAP {
            break;
        }
    }
    let mut out = local;
    out.extend(extra);
    out.truncate(GIT_BRANCH_LIST_CAP);
    out
}

pub fn classify_git_switch_error(stderr: &str, stdout: &str) -> (String, Option<String>) {
    let text = format!("{stderr}\n{stdout}");
    let lower = text.to_ascii_lowercase();
    let else_re = regex_first_path(&text);
    if else_re.is_some() || lower.contains("already used by worktree") {
        return ("elsewhere".into(), else_re);
    }
    if lower.contains("would be overwritten by checkout")
        || lower.contains("please commit your changes or stash")
        || lower.contains("your local changes to the following files")
    {
        return ("dirty".into(), None);
    }
    if lower.contains("invalid reference")
        || lower.contains("unknown revision")
        || lower.contains("did not match any file(s) known to git")
        || lower.contains("not a valid object name")
    {
        return ("not_found".into(), None);
    }
    if lower.contains("not a valid branch name")
        || lower.contains("invalid branch name")
        || (lower.contains("fatal:") && lower.contains("isn't a valid"))
    {
        return ("invalid".into(), None);
    }
    if lower.contains("not a git repository") || lower.contains("not a git repo") {
        return ("not_a_git_repo".into(), None);
    }
    ("failed".into(), None)
}

fn regex_first_path(text: &str) -> Option<String> {
    // fatal: 'feat' is already used by worktree at '/path'
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(idx) = lower.find("already used by worktree at") {
            let rest = line[idx + "already used by worktree at".len()..].trim();
            let p = rest.trim_matches('\'').trim();
            if !p.is_empty() {
                return normalize_worktree_field(p);
            }
        }
        if let Some(idx) = lower.find("already checked out at") {
            let rest = line[idx + "already checked out at".len()..].trim();
            let p = rest.trim_matches('\'').trim();
            if !p.is_empty() {
                return normalize_worktree_field(p);
            }
        }
    }
    None
}

fn git_switch_unavailable(stderr: &str, stdout: &str) -> bool {
    let lower = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    lower.contains("is not a git command") || lower.contains("unknown command")
}

fn empty_branches(reason: &str) -> GitBranchesResult {
    GitBranchesResult {
        available: false,
        branches: vec![],
        current: None,
        reason: Some(reason.into()),
        truncated: false,
        total: 0,
    }
}

fn switch_fail(
    available: bool,
    kind: &str,
    branch: Option<String>,
    previous: Option<String>,
    worktree_path: Option<String>,
    reason: Option<String>,
) -> GitSwitchBranchResult {
    GitSwitchBranchResult {
        available,
        ok: false,
        branch,
        previous_branch: previous,
        kind: kind.into(),
        worktree_path,
        reason,
    }
}

/// List local branches + remote-only refs for a project folder.
#[tauri::command]
pub async fn git_branches_list(project_path: String) -> Result<GitBranchesResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(empty_branches("empty path"));
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(empty_branches("project not a directory"));
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        let kind = if reason.contains("git not available") {
            "git not available"
        } else {
            reason.as_str()
        };
        return Ok(empty_branches(kind));
    }
    tauri::async_runtime::spawn_blocking(move || git_branches_list_blocking(project))
        .await
        .map_err(|e| format!("git branches list worker panicked: {e}"))?
}

fn git_branches_list_blocking(project: String) -> Result<GitBranchesResult, String> {
    let local_out = git_in_project(&project)
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%09%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(worktreepath)",
            "refs/heads/",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !local_out.status.success() {
        let err = String::from_utf8_lossy(&local_out.stderr)
            .trim()
            .to_string();
        let reason = if err.is_empty() {
            "git for-each-ref failed".to_string()
        } else {
            err.chars().take(200).collect()
        };
        return Ok(GitBranchesResult {
            available: false,
            branches: vec![],
            current: None,
            reason: Some(reason),
            truncated: false,
            total: 0,
        });
    }
    let remote_out = git_in_project(&project)
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%09%(objectname:short)",
            "refs/remotes/",
        ])
        .output()
        .ok();
    let local = parse_git_branch_for_each_ref(&String::from_utf8_lossy(&local_out.stdout), false);
    let remote = remote_out
        .filter(|o| o.status.success())
        .map(|o| parse_git_branch_for_each_ref(&String::from_utf8_lossy(&o.stdout), true))
        .unwrap_or_default();
    let merged = merge_git_branch_lists(local, remote);
    let total = merged.len();
    let current = merged.iter().find(|b| b.current).map(|b| b.name.clone());
    Ok(GitBranchesResult {
        available: true,
        truncated: total >= GIT_BRANCH_LIST_CAP,
        total,
        current,
        branches: merged,
        reason: None,
    })
}

/// In-place `git switch` in the project's worktree. Soft-fail envelope.
/// `start_point` set → create a local tracking branch from that remote ref.
#[tauri::command]
pub async fn git_switch_branch(
    mgr: State<'_, Arc<SessionManager>>,
    project_path: String,
    branch: String,
    start_point: Option<String>,
) -> Result<GitSwitchBranchResult, String> {
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(switch_fail(
            false,
            "failed",
            None,
            None,
            None,
            Some("empty path".into()),
        ));
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(switch_fail(
            false,
            "failed",
            None,
            None,
            None,
            Some("project not a directory".into()),
        ));
    }
    // Refuse replacing the worktree while any live/background agent turn is
    // still bound here — otherwise a background chat keeps writing against the
    // branch the user just left.
    let project_id = store::load_projects()
        .into_iter()
        .find(|p| normalize_fs_path(&p.path) == project)
        .map(|p| p.id);
    if let Some(sid) =
        mgr.any_busy_turn_for_project(project_id.as_deref(), &project)
    {
        return Ok(switch_fail(
            true,
            "agent_busy",
            None,
            None,
            None,
            Some(format!("agent turn still running in session {sid}")),
        ));
    }
    let name = match sanitize_git_branch_name(&branch) {
        Ok(n) => n,
        Err(reason) => {
            return Ok(switch_fail(true, "invalid", None, None, None, Some(reason)));
        }
    };
    let start = match start_point
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(s) => match sanitize_git_branch_name(s) {
            Ok(n) => Some(n),
            Err(reason) => {
                return Ok(switch_fail(
                    true,
                    "invalid",
                    Some(name),
                    None,
                    None,
                    Some(reason),
                ));
            }
        },
        None => None,
    };
    if let Err(reason) = git_probe_work_tree(&project) {
        let kind = if reason.contains("git not available") {
            "git_not_available"
        } else {
            "not_a_git_repo"
        };
        return Ok(switch_fail(
            false,
            kind,
            Some(name),
            None,
            None,
            Some(reason),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || git_switch_branch_blocking(project, name, start))
        .await
        .map_err(|e| format!("git switch worker panicked: {e}"))?
}

fn git_switch_run(project: &str, args: &[&str]) -> Result<std::process::Output, String> {
    git_in_project(project)
        .args(args)
        .output()
        .map_err(|e| e.to_string())
}

fn git_switch_branch_blocking(
    project: String,
    name: String,
    start: Option<String>,
) -> Result<GitSwitchBranchResult, String> {
    let previous = git_in_project(&project)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if !o.status.success() {
                return None;
            }
            let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if b.is_empty() || b == "HEAD" {
                None
            } else {
                Some(b)
            }
        });

    if previous.as_deref() == Some(name.as_str()) && start.is_none() {
        return Ok(GitSwitchBranchResult {
            available: true,
            ok: true,
            branch: Some(name),
            previous_branch: previous,
            kind: "ok".into(),
            worktree_path: None,
            reason: None,
        });
    }

    let primary = if let Some(ref sp) = start {
        git_switch_run(&project, &["switch", "--track", sp])?
    } else {
        git_switch_run(&project, &["switch", &name])?
    };

    let mut used = primary;
    if !used.status.success() {
        let stderr = String::from_utf8_lossy(&used.stderr).to_string();
        let stdout = String::from_utf8_lossy(&used.stdout).to_string();
        if git_switch_unavailable(&stderr, &stdout) {
            used = if let Some(ref sp) = start {
                git_switch_run(&project, &["checkout", "--track", sp])?
            } else {
                git_switch_run(&project, &["checkout", &name])?
            };
        } else if start.is_some()
            && (stderr.to_ascii_lowercase().contains("already exists")
                || stderr.to_ascii_lowercase().contains("a branch named"))
        {
            used = git_switch_run(&project, &["switch", &name])?;
            if !used.status.success() {
                let s2 = String::from_utf8_lossy(&used.stderr).to_string();
                let o2 = String::from_utf8_lossy(&used.stdout).to_string();
                if git_switch_unavailable(&s2, &o2) {
                    used = git_switch_run(&project, &["checkout", &name])?;
                }
            }
        }
    }

    let stderr = String::from_utf8_lossy(&used.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&used.stdout).trim().to_string();
    if used.status.success() {
        let current = git_in_project(&project)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .ok()
            .and_then(|o| {
                if !o.status.success() {
                    return None;
                }
                let b = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if b.is_empty() || b == "HEAD" {
                    None
                } else {
                    Some(b)
                }
            })
            .or(Some(name.clone()));
        return Ok(GitSwitchBranchResult {
            available: true,
            ok: true,
            branch: current,
            previous_branch: previous,
            kind: "ok".into(),
            worktree_path: None,
            reason: None,
        });
    }

    let (kind, wt) = classify_git_switch_error(&stderr, &stdout);
    let reason = if !stderr.is_empty() {
        stderr.chars().take(400).collect()
    } else if !stdout.is_empty() {
        stdout.chars().take(400).collect()
    } else {
        "git switch failed".into()
    };
    Ok(switch_fail(
        true,
        &kind,
        Some(name),
        previous,
        wt,
        Some(reason),
    ))
}

#[cfg(test)]
mod git_branch_parse_tests {
    use super::*;

    #[test]
    fn parses_local_and_skips_bad_names() {
        let raw = "\
*\tmain\tabc\torigin/main\t/Users/me/repo
\tfeat/login\tdef\t\t
\t-bad\t111\t\t
";
        let list = parse_git_branch_for_each_ref(raw, false);
        assert_eq!(list.len(), 2);
        assert!(list[0].current);
        assert_eq!(list[0].name, "main");
        assert_eq!(list[0].worktree_path.as_deref(), Some("/Users/me/repo"));
        assert_eq!(list[1].name, "feat/login");
        assert!(!list[1].current);
    }

    #[test]
    fn parses_remote_skips_head() {
        let raw = "\
origin/HEAD\tabc
origin/main\tabc
origin/new-remote\t999
";
        let list = parse_git_branch_for_each_ref(raw, true);
        assert_eq!(
            list.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(),
            vec!["origin/main", "origin/new-remote"]
        );
        assert!(list.iter().all(|b| b.remote));
    }

    #[test]
    fn merge_drops_remotes_with_local_names() {
        let local = parse_git_branch_for_each_ref(
            "*\tmain\tabc\torigin/main\t/repo\n\tfeat/x\tdef\t\t\n",
            false,
        );
        let remote = parse_git_branch_for_each_ref(
            "origin/main\tabc\norigin/feat/x\tdef\norigin/only\t111\n",
            true,
        );
        let merged = merge_git_branch_lists(local, remote);
        let names: Vec<_> = merged.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, vec!["main", "feat/x", "origin/only"]);
    }

    #[test]
    fn classify_dirty_and_elsewhere() {
        let (k, p) = classify_git_switch_error(
            "error: Your local changes to the following files would be overwritten by checkout:\nPlease commit your changes or stash them before you switch branches.\n",
            "",
        );
        assert_eq!(k, "dirty");
        assert!(p.is_none());
        let (k2, p2) = classify_git_switch_error(
            "fatal: 'feat' is already used by worktree at '/tmp/repo-feat'\n",
            "",
        );
        assert_eq!(k2, "elsewhere");
        assert_eq!(p2.as_deref(), Some("/tmp/repo-feat"));
    }

    #[test]
    fn sanitize_rejects_flags() {
        assert!(sanitize_git_branch_name("-b").is_err());
        assert!(sanitize_git_branch_name("feat/login").is_ok());
        assert!(sanitize_git_branch_name("origin/main").is_ok());
    }
}
