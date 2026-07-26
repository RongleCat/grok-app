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
- **Create / GC** live in the branch menu (not the project menu).
- **Remove:** host supports `git_worktree_remove` for non-main trees; UI wiring may lag — prefer GC for stale admin records.

### Create worktree

From the branch / worktree menu:

- **New worktree…** — create + bind current session/cwd to the new path.
- **New worktree & chat…** — create, then open a **draft new chat** whose project path is the worktree (agent cwd).

1. User enters a **name** (required) and optional **start point** (branch / tag / commit).
2. Host runs `git worktree add -b <name> <path> [<start_point>]` with argv (no shell).
3. On success: refresh the list, `project_add` with trust inherited from the source project when possible, then either bind the open session or call `newChat(worktreeProject)`.

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

### GC / prune

Menu action **Clean stale worktrees…** → GlassModal dry-run preview (`git worktree prune -v --dry-run`), then apply. Optional force → `--expire now`. Does **not** delete live worktrees. Host: `git_worktree_gc`.

## Non-goals (MVP)

- Full branch browser / remote fetch / same-directory `git checkout`
- In-place checkout of an arbitrary local branch without a worktree

## Implementation

- Host: `git_worktrees_list`, `git_worktree_add`, `git_worktree_remove`, `git_worktree_gc` (`src-tauri/src/commands.rs`) — argv only, no shell
- Pure path / name helpers: `sanitize_worktree_name`, `build_worktree_sibling_path` (+ unit tests)
- Frontend pure helpers: `src/lib/gitWorktree.ts` (+ unit tests)
- UI:
  - Project: `ComposerProjectMenu` (folder only)
  - Branch / worktree: `ComposerWorktreeMenu` (context bar chip)
  - Create + GC dialogs in `App.tsx`
