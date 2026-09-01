/// Delete a path under the project only (non-git untracked reject after confirm).
#[tauri::command]
pub async fn delete_project_file(
    project_path: String,
    path: String,
    confirm: bool,
) -> Result<GitCheckoutFileResult, String> {
    if !confirm {
        return Ok(GitCheckoutFileResult {
            ok: false,
            absolute_path: None,
            relative_path: None,
            needs_untracked_confirm: true,
            reason: Some("delete requires confirm".into()),
            action: Some("none".into()),
        });
    }
    let (_root, rel, abs) = match resolve_path_under_project(&project_path, &path) {
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
    if abs.is_dir() {
        return Ok(GitCheckoutFileResult {
            ok: false,
            absolute_path: Some(abs.to_string_lossy().to_string()),
            relative_path: Some(rel),
            needs_untracked_confirm: false,
            reason: Some("refusing to delete directory".into()),
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
                reason: Some(format!("delete: {e}")),
                action: Some("none".into()),
            });
        }
    }
    Ok(GitCheckoutFileResult {
        ok: true,
        absolute_path: Some(abs.to_string_lossy().to_string()),
        relative_path: Some(rel),
        needs_untracked_confirm: false,
        reason: None,
        action: Some("deleted".into()),
    })
}

#[cfg(test)]
mod git_status_parse_tests {
    use super::*;

    #[test]
    fn porcelain_modified_worktree() {
        let e = parse_porcelain_line(" M src/app.ts", "/proj").expect("entry");
        assert_eq!(e.path, "src/app.ts");
        assert_eq!(e.status, " M");
        assert_eq!(e.kind, "modified");
        assert_eq!(e.name, "app.ts");
        assert!(e.absolute_path.ends_with("src/app.ts"));
    }

    #[test]
    fn porcelain_untracked() {
        let e = parse_porcelain_line("?? new.md", "/proj").expect("entry");
        assert_eq!(e.kind, "untracked");
        assert_eq!(e.path, "new.md");
    }

    #[test]
    fn porcelain_added_staged() {
        let e = parse_porcelain_line("A  foo/bar.rs", "/repo").expect("entry");
        assert_eq!(e.kind, "added");
        assert_eq!(e.index_status, "A");
    }

    #[test]
    fn porcelain_rename() {
        let e = parse_porcelain_line("R  old.ts -> new.ts", "/repo").expect("entry");
        assert_eq!(e.kind, "renamed");
        assert_eq!(e.path, "new.ts");
        assert_eq!(e.original_path.as_deref(), Some("old.ts"));
    }

    #[test]
    fn porcelain_conflict() {
        let e = parse_porcelain_line("UU merge.txt", "/repo").expect("entry");
        assert_eq!(e.kind, "conflict");
    }

    #[test]
    fn porcelain_deleted() {
        let e = parse_porcelain_line(" D gone.ts", "/repo").expect("entry");
        assert_eq!(e.kind, "deleted");
    }

    #[test]
    fn kind_helpers() {
        assert_eq!(git_status_kind('?', '?'), "untracked");
        assert_eq!(git_status_kind('M', ' '), "modified");
        assert_eq!(git_status_kind(' ', 'M'), "modified");
        assert_eq!(git_status_kind('A', ' '), "added");
        assert_eq!(git_status_kind('D', ' '), "deleted");
    }

    #[test]
    fn resolve_path_under_project_relative_ok() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-diff-accept-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        let r = resolve_path_under_project(
            &tmp.to_string_lossy(),
            "src/hello.ts",
        );
        assert!(r.is_ok(), "{r:?}");
        let (_root, rel, abs) = r.unwrap();
        assert_eq!(rel, "src/hello.ts");
        // Path separators differ on Windows — compare POSIX form.
        let abs_posix = abs.to_string_lossy().replace('\\', "/");
        assert!(
            abs_posix.ends_with("src/hello.ts"),
            "abs={abs_posix}"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_path_under_project_rejects_escape() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-diff-escape-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        let r = resolve_path_under_project(&tmp.to_string_lossy(), "../outside.txt");
        assert!(r.is_err(), "parent escape should fail: {r:?}");
        // Unix-style absolute must not become project-relative (Windows Path::is_absolute is false).
        let r2 = resolve_path_under_project(&tmp.to_string_lossy(), "/etc/passwd");
        assert!(r2.is_err(), "unix absolute should fail: {r2:?}");
        let r3 = resolve_path_under_project(&tmp.to_string_lossy(), "\\\\server\\share\\x");
        assert!(r3.is_err(), "unc-style should fail: {r3:?}");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

// ── Git worktrees (issue #42) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreesResult {
    pub available: bool,
    pub worktrees: Vec<GitWorktreeEntry>,
    pub reason: Option<String>,
    /// Absolute `~/.grok` used for CLI-aligned worktree placement / detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_grok_home: Option<String>,
}

/// Parse `git worktree list --porcelain` (pure; unit-tested).
pub fn parse_worktree_porcelain(raw: &str) -> Vec<GitWorktreeEntry> {
    let text = raw.replace("\r\n", "\n");
    if text.trim().is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut path = String::new();
        let mut head: Option<String> = None;
        let mut branch: Option<String> = None;
        let mut detached = false;
        let mut locked = false;
        let mut prunable = false;

        for line in block.lines() {
            let t = line.trim_end();
            if let Some(rest) = t.strip_prefix("worktree ") {
                path = rest.trim().replace('\\', "/");
                while path.ends_with('/') && path.len() > 1 {
                    path.pop();
                }
            } else if let Some(rest) = t.strip_prefix("HEAD ") {
                let h = rest.trim();
                head = if h.is_empty() {
                    None
                } else {
                    Some(h.to_string())
                };
            } else if let Some(rest) = t.strip_prefix("branch ") {
                let r = rest.trim();
                branch = if let Some(name) = r.strip_prefix("refs/heads/") {
                    Some(name.to_string())
                } else if r.is_empty() {
                    None
                } else {
                    Some(r.to_string())
                };
            } else if t == "detached" {
                detached = true;
            } else if t.starts_with("locked") {
                locked = true;
            } else if t.starts_with("prunable") {
                prunable = true;
            }
        }

        if path.is_empty() {
            continue;
        }
        if detached {
            branch = None;
        }
        out.push(GitWorktreeEntry {
            path,
            head,
            branch,
            detached,
            is_main: out.is_empty(),
            locked,
            prunable,
        });
    }
    // First entry is main
    for (i, w) in out.iter_mut().enumerate() {
        w.is_main = i == 0;
    }
    out
}

/// List linked git worktrees for a project folder. Soft-fails without git / non-repo.
#[tauri::command]
pub async fn git_worktrees_list(project_path: String) -> Result<GitWorktreesResult, String> {
    let cli_home = shared_cli_grok_home()
        .to_string_lossy()
        .replace('\\', "/");
    let cli_grok_home = Some(normalize_fs_path(&cli_home));
    let project = normalize_fs_path(&project_path);
    if project.is_empty() {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some("empty path".into()),
            cli_grok_home,
        });
    }
    let proj = std::path::PathBuf::from(&project);
    if !proj.is_dir() {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some("project not a directory".into()),
            cli_grok_home,
        });
    }
    if let Err(reason) = git_probe_work_tree(&project) {
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some(reason),
            cli_grok_home,
        });
    }

    // Porcelain list touches every registered worktree on disk — blocking pool.
    tauri::async_runtime::spawn_blocking(move || git_worktrees_list_blocking(project, cli_grok_home))
        .await
        .map_err(|e| format!("git worktrees list worker panicked: {e}"))?
}

fn git_worktrees_list_blocking(
    project: String,
    cli_grok_home: Option<String>,
) -> Result<GitWorktreesResult, String> {
    let out = crate::process_util::command("git")
        .args(["-C", &project, "worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Ok(GitWorktreesResult {
            available: false,
            worktrees: vec![],
            reason: Some(if err.is_empty() {
                "git worktree list failed".into()
            } else {
                err.chars().take(200).collect()
            }),
            cli_grok_home,
        });
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    let worktrees = parse_worktree_porcelain(&raw);
    Ok(GitWorktreesResult {
        available: true,
        worktrees,
        reason: None,
        cli_grok_home,
    })
}

#[cfg(test)]
mod git_worktree_parse_tests {
    use super::*;

    #[test]
    fn parses_main_and_linked() {
        let raw = "\
worktree /Users/me/repo
HEAD abcdef
branch refs/heads/main

worktree /Users/me/repo-feat
HEAD fedcba
branch refs/heads/feat/x

worktree /Users/me/repo-d
HEAD 112233
detached
";
        let list = parse_worktree_porcelain(raw);
        assert_eq!(list.len(), 3);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch.as_deref(), Some("feat/x"));
        assert!(!list[1].is_main);
        assert!(list[2].detached);
        assert!(list[2].branch.is_none());
    }

    #[test]
    fn empty_input() {
        assert!(parse_worktree_porcelain("").is_empty());
    }
}

/// Reveal a path in the system file manager (Finder / Explorer / Files).
///
/// Selects the file when the OS supports it. Cross-platform details live in
/// [`crate::process_util::reveal_in_file_manager`] (Windows: no CREATE_NO_WINDOW,
/// strip `\\?\`, native backslashes; Linux: D-Bus ShowItems; macOS: `open -R`).
#[tauri::command]
pub async fn path_reveal(path: String) -> Result<(), String> {
    let p = normalize_fs_path(&path);
    if p.is_empty() {
        return Err("empty path".into());
    }
    let pb = std::path::PathBuf::from(&p);
    // Off the async runtime so a wedged shell cannot stall the IPC loop.
    tokio::task::spawn_blocking(move || crate::process_util::reveal_in_file_manager(&pb))
        .await
        .map_err(|e| e.to_string())?
}

/// Add project via native folder dialog; optional auto-trust.
#[tauri::command]
pub async fn project_add_dialog(trust: bool) -> Result<Option<Project>, String> {
    let folder = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("添加项目 / Add project")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = folder else {
        return Ok(None);
    };
    let p = store::add_project(path.display().to_string(), trust)?;
    Ok(Some(p))
}

