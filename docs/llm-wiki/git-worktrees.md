# Git worktrees

Community request: [issue #42](https://github.com/RongleCat/grok-app/issues/42).

## Behavior

When the active project path is a git work tree, the **new-session context bar** shows a **branch chip** (`ComposerWorktreeMenu`) next to the project picker. Opening it lists linked worktrees from:

```bash
git worktree list --porcelain
```

- Selecting a worktree binds the open session (or draft context) to that path as agent **cwd**.
- If the path is already a project, switch only; otherwise `project_add` (trust inherited from the current project when possible).
- Soft-fail when `git` is missing or the folder is not a repo (same spirit as Workspace Changes git status).
- **UI:** branch chip is hidden until host confirms `available: true` (non-git → no branch chip). Project menu no longer embeds worktrees.
- **Create / remove / GC** live in the branch menu (not the project menu).
- **Remove:** per-row trash on **non-main** linked worktrees → in-app confirm → host `git_worktree_remove` (force retry if dirty). Never removes main. Removing the active cwd switches to main. Use **GC** for stale admin records of folders already gone.
- **Session badge:** worktree-bound chats show a compact **WT** chip in the sidebar. Meta is written when **New worktree & chat** creates the session (`worktreePath` / `worktreeBranch` / `isWorktreeSession` on `SessionMeta`). Fallback: if the session’s project path matches a **non-main** entry from `git worktree list`, badge without meta.
- **Session menu (WT only):** Reveal worktree · Copy path · Remove worktree (same in-app confirm / force path as the branch menu). Apply/merge onto main is out of scope.

### Create worktree

From the branch / worktree menu:

- **New worktree…** — create + bind current session/cwd to the new path.
- **New worktree & chat…** — create, then open a **new session** whose project path is the worktree (agent cwd) and persist worktree meta on that session.

1. User enters a **name** (required) and optional **start point** (branch / tag / commit).
2. Host runs `git worktree add -b <name> <path> [<start_point>]` with argv (no shell).
3. On success: refresh the list, `project_add` with trust inherited from the source project when possible, then either bind the open session (and tag it) or `session_create` + `session_set_worktree` and open that session.

**Path layout (sibling of main worktree):**

```text
<main_parent>/<main_basename>-<name>
```

Example: main `/Users/me/repo` + name `feat` → `/Users/me/repo-feat`.

| Choice | Why |
|--------|-----|
| **Sibling** `../<repo>-<name>` (preferred) | Matches common `git worktree add ../repo-feat` practice; checkouts sit next to the primary clone; same pattern as porcelain list samples. |
| In-repo `.worktrees/<name>` | Avoided for create — keeps build/tooling ignore noise out of the main tree and matches sibling-first docs. |

Name rules: letters, digits, `.` `_` `-` only; max 64; no path separators; must not start with `-` (so it cannot look like a git flag).

Errors are shown when the folder is not a git repository, `git` is missing, the path already exists, or `git worktree add` fails (message surfaced in the dialog).

### Remove live worktree

Per-row trash icon on linked (non-main) entries in the branch menu:

1. In-app confirm shows path + branch; warns if removing the active cwd.
2. Host runs `git worktree remove [--force] <path>` with argv (no shell); refuses main.
3. On dirty/locked failure, second confirm offers force.
4. Refresh list; if the removed path was the active project, switch to main worktree.

### GC / prune

Menu action **Clean stale worktrees…** → GlassModal dry-run preview (`git worktree prune -v --dry-run`), then apply. Optional force → `--expire now`. Does **not** delete live worktrees. Host: `git_worktree_gc`.

## Non-goals (MVP)

- Full branch browser / remote fetch / same-directory `git checkout`
- In-place checkout of an arbitrary local branch without a worktree
- Apply / merge worktree branch back onto main from the session menu (open folder + remove only)

## Implementation

- Host: `git_worktrees_list`, `git_worktree_add`, `git_worktree_remove`, `git_worktree_gc`, `session_set_worktree` (`src-tauri/src/commands.rs`) — argv only, no shell
- Store: optional `SessionMeta.worktree_path` / `worktree_branch` / `is_worktree_session` (serde defaults; skip empty)
- Pure path / name helpers: `sanitize_worktree_name`, `build_worktree_sibling_path` (+ unit tests)
- Frontend pure helpers: `src/lib/gitWorktree.ts` — list/parse + `resolveSessionWorktreeBadge` / tooltip (+ unit tests)
- UI:
  - Project: `ComposerProjectMenu` (folder only)
  - Branch / worktree: `ComposerWorktreeMenu` (context bar chip; per-row remove)
  - Sidebar **WT** badge + session context menu manage actions
  - Create + remove confirm + GC dialogs in `App.tsx`
