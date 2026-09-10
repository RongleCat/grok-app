# Git worktrees

Community request: [issue #42](https://github.com/RongleCat/grok-app/issues/42).  
CLI alignment: Grok Build **0.2.114+** `--worktree` / `--worktree-ref` and `~/.grok/worktrees/`.

## Behavior

When the active project path is a git work tree, the **new-session context bar** shows a **branch chip** (`ComposerWorktreeMenu`) next to the project picker. Opening it lists **local branches** (in-place `git switch`) and linked worktrees from:

```bash
git worktree list --porcelain
```

- Selecting a **branch** runs in-place `git switch` in the current worktree (same directory). Remote-only rows create a local tracking branch (`git switch --track`). A branch already checked out in another linked worktree switches to that worktree instead of failing.
- Selecting a worktree binds the open session (or draft context) to that path as agent **cwd**.
- If the path is already a project, switch only; otherwise `project_add` (trust inherited from the current project when possible).
- Soft-fail when `git` is missing or the folder is not a repo (same spirit as Workspace Changes git status).
- **UI:** branch chip is hidden until host confirms `available: true` (non-git → no branch chip). Project menu no longer embeds worktrees.
- **Create / remove / GC** live in the branch menu (not the project menu).
- **Remove:** per-row trash on **non-main** linked worktrees → in-app confirm → host `git_worktree_remove` (force retry if dirty). Never removes main. Removing the active cwd switches to main. Use **GC** for stale admin records of folders already gone.
- **Session badge:** worktree-bound chats show a compact chip in the sidebar:
  - **`CLI`** — path under `~/.grok/worktrees/` (Grok Build CLI home layout)
  - **`WT`** — sibling / other linked worktree
  Meta is written when **New worktree & chat** creates the session (`worktreePath` / `worktreeBranch` / `isWorktreeSession` on `SessionMeta`). Fallback: if the session’s project path matches a **non-main** entry from `git worktree list`, badge without meta.
- **Session menu (WT/CLI only):** Reveal worktree · Copy path · Remove worktree (same in-app confirm / force path as the branch menu). Apply/merge onto main is out of scope.

### Create worktree

From the branch / worktree menu:

- **New worktree…** — create + bind current session/cwd to the new path.
- **New worktree & chat…** — create, then open a **new session** whose project path is the worktree (agent cwd) and persist worktree meta on that session.

1. User enters a **name** (required), chooses **location** (default CLI home; optional sibling), and optional **start point** (branch / tag / commit — same idea as CLI `--worktree-ref` / `--ref`).
2. Host runs `git worktree add -b <name> <path> [<start_point>]` with argv (no shell).
3. On success: refresh the list, `project_add` with trust inherited from the source project when possible, then either bind the open session (and tag it) or `session_create` + `session_set_worktree` and open that session.

**Path layout (default — CLI-aligned):**

```text
{GROK_HOME}/worktrees/<main_basename>/<name>
```

Example: main `/Users/me/Code/oss-grok-app` + name `feat` → `~/.grok/worktrees/oss-grok-app/feat`.

This matches Grok Build 0.2.x (`grok --worktree=feat`, `grok worktree list` paths under `~/.grok/worktrees/<repo>/…`). `GROK_HOME` for placement is always the shared CLI home (`~/.grok`), not App independent agent-home — worktrees are filesystem layout shared with the terminal CLI.

**Optional sibling layout:**

```text
<main_parent>/<main_basename>-<name>
```

Example: main `/Users/me/repo` + name `feat` → `/Users/me/repo-feat`.

| Choice | Why |
|--------|-----|
| **CLI home** `~/.grok/worktrees/<repo>/<name>` (**default**) | Aligns with Grok Build `--worktree` / subagent worktrees; keeps checkouts out of the project parent; same path family as `grok worktree list`. |
| **Sibling** `../<repo>-<name>` | Classic `git worktree add ../repo-feat` practice when you want the tree next to the primary clone. |
| In-repo `.worktrees/<name>` | Avoided for create — keeps build/tooling ignore noise out of the main tree. |

Name rules: letters, digits, `.` `_` `-` only; max 64; no path separators; must not start with `-` (so it cannot look like a git flag).  
Start-point rules: optional; max 256; no NUL/newlines; must not start with `-`.

Errors are shown when the folder is not a git repository, `git` is missing, the path already exists, or `git worktree add` fails (message surfaced in the dialog).

### Remove live worktree

Per-row trash icon on linked (non-main) entries in the branch menu:

1. In-app confirm shows path + branch; warns if removing the active cwd.
2. Host runs `git worktree remove [--force] <path>` with argv (no shell); refuses main.
3. On dirty/locked failure, second confirm offers force.
4. Refresh list; if the removed path was the active project, switch to main worktree.

### GC / prune

Menu action **Clean stale worktrees…** → GlassModal dry-run preview (`git worktree prune -v --dry-run`), then apply. Optional force → `--expire now`. Does **not** delete live worktrees. Host: `git_worktree_gc`.

### Compare with main

From a **linked** (non-main) worktree, the branch menu offers **Compare with main…**:

1. GlassModal loads `git diff --name-status <main>...<other>` (host `git_worktree_compare`, cwd = main root). Soft-fail when same path, missing dirs, not git, or different repos.
2. Summary chips (added / modified / deleted / renamed) + scrollable file list with A/M/D/R badges. Display cap 500 with honest overflow count.
3. Per-row **Copy path** and **Reveal** (path under the other worktree). **Close** only — no merge / selective apply (out of scope).
4. Pure helpers: `src/lib/worktreeCompare.ts` (`planWorktreeCompare`, `parseNameStatus`, `summarizeCompareEntries`, `capCompareEntries`).

### Ship / Open PR

From a worktree-bound session or the branch menu / Changes → Workspace:

1. **Ship…** opens a GlassModal (title, body, draft checkbox, “open PR after push”). Never `window.confirm` / `prompt` / `alert`.
2. Host runs `git push -u origin HEAD` (`git_push_branch`) with argv only, `GIT_SSH_COMMAND=/usr/bin/ssh` when present, soft-fail when git / origin / non-repo missing.
3. Optional `gh pr create` (`gh_pr_create`) with `--repo` / `--base` / `--head` inferred from remotes (fork: `upstream` as PR target, `origin` owner as `--head owner:branch`). Soft-fail when `gh` missing. **Never** reports success without a PR URL.
4. On success with a PR URL: success panel shows the URL + **Open in browser** + **Open in PR hub** (deep link `#/settings/runtime/tools?pr=N` → Runtime → Tools hub card, optional row highlight). Soft-fail toast if project/hub unavailable.
5. Pure helpers + tests: `src/lib/wtShipFlow.ts` (push/PR argv) · `src/lib/prHubDeepLink.ts` (hash parse/build). Output is redacted before UI/toasts.

### CLI worktrees list (`grok worktree list`)

The branch menu also shows a **CLI worktrees** section fed by the Grok Build index (not only `git worktree list`):

```bash
grok worktree list --json   # preferred
grok worktree list          # text fallback when --json unsupported
```

- Host: `cli_worktrees_list` (`src-tauri/src/cli_worktrees.rs`) — soft-fail when CLI missing; optional `--all` / `--repo`.
- Pure parsers: JSON + text table → `{ id, name, path, branch?, status?, kind?, pathOk, … }` (+ Rust/TS unit tests).
- UI: section under create/GC actions — **Refresh**, per-row **Reveal**, click row to **open as session cwd** only when `pathOk` (folder exists). Does not replace App create/remove/GC for git-linked trees.
- Rows are filtered to the active project when `source_repo` / `repo_name` / path slug match; otherwise the full (capped) list is shown.

### CLI worktree DB (`grok worktree db`, 0.2.117+)

Settings → **Runtime → CLI → CLI worktree DB** surfaces the Grok Build worktree index file:

```bash
grok worktree db path      # print DB path (often ~/.grok/worktrees.db)
grok worktree db stats     # total / alive / dead / size (text; JSON parse ready)
grok worktree db rebuild   # filesystem scan → rebuild index
```

- Host: `cli_worktree_db_path` · `cli_worktree_db_stats` · `cli_worktree_db_rebuild` in `cli_worktrees.rs` — timeout, soft-fail when CLI missing or pre-0.2.117 (unrecognized `db` subcommand).
- Pure parsers: stats text + optional JSON; rebuild report (`Discovered` / `Registered` / `Already tracked`); Rust + TS unit tests.
- UI: path (copy / reveal), stats summary, **Rebuild** with in-app confirm (`GlassModal` — never `window.confirm`). Rebuild does not delete worktree folders.

## Non-goals (MVP)

- Fetch remotes from the branch menu / create a new local branch from an arbitrary ref (remote-only rows still check out tracking branches)
- Discard uncommitted changes to force a switch (`git switch --discard-changes`)
- Apply / merge worktree branch back onto main from the session menu (open folder + remove only)
- Registering App-created trees into the CLI `worktrees.db` index from create UI (use **CLI worktree DB → Rebuild** to rescan)
- CLI `worktree rm` / `gc` / `show` from the App (list + open/reveal only; DB path/stats/rebuild are separate)

## Implementation

- Host: `git_worktrees_list` (includes `cliGrokHome`), `git_branches_list`, `git_switch_branch` (in-place `git switch`, `--track` for remote-only; checkout fallback on old git), `git_worktree_add` (`layout`: `cli` \| `sibling`), `git_worktree_remove`, `git_worktree_gc`, `git_push_branch`, `gh_pr_create`, `session_set_worktree` (`src-tauri/src/commands.rs`) — argv only, no shell
- Host: `cli_worktrees_list` (`src-tauri/src/cli_worktrees.rs`) — `grok worktree list [--json]` soft-fail envelope
- Store: optional `SessionMeta.worktree_path` / `worktree_branch` / `is_worktree_session` (serde defaults; skip empty)
- Pure path / name helpers: `sanitize_worktree_name`, `sanitize_worktree_ref`, `build_worktree_cli_path`, `build_worktree_sibling_path`, `build_worktree_path_for_layout` (+ unit tests)
- Frontend pure helpers: `src/lib/gitWorktree.ts` — list/parse + path builders + `resolveSessionWorktreeBadge` / tooltip / layout detect (+ unit tests)
- Frontend pure helpers: `src/lib/gitBranches.ts` — `for-each-ref` parse, sanitize, remote merge, switch-error classify (+ unit tests)
- Frontend pure helpers: `src/lib/cliWorktrees.ts` — CLI JSON/text parse, project filter, open-as-cwd gate (+ unit tests)
- Frontend pure helpers: `src/lib/wtShipFlow.ts` — push/PR argv builders, remote/fork head resolve, outcome combine (no fake success) (+ unit tests)
- Frontend pure helpers: `src/lib/prHubDeepLink.ts` — ship → PR hub hash `#/settings/runtime/tools?pr=N` parse/build + PR number from URL (+ unit tests)
- UI:
  - Project: `ComposerProjectMenu` (folder only)
  - Branch / worktree: `ComposerWorktreeMenu` (context bar chip; in-place branch list + search; per-row remove; **Ship…**; **CLI worktrees** section)
  - Sidebar **CLI** / **WT** badge + session context menu manage actions (**Ship…**)
  - Changes → Workspace: **Ship…** when git branch known
  - Create (layout radios + ref validation) + remove confirm + GC + Ship dialogs in `App.tsx`
