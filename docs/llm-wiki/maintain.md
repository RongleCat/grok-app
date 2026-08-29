# Open-source maintenance (Grok App)

Single playbook for humans and AI maintainers: intake → triage → review → ship.

Related: [release.md](./release.md) (tag / CHANGELOG), [CONTRIBUTING.md](../../CONTRIBUTING.md), [i18n.md](./i18n.md), [dialogs.md](./dialogs.md).

---

## Goals

1. **Capture** community feedback (GitHub Issues, X, PR comments) into trackable Issues.
2. **Triage** severity (`priority:p0|p1|p2`) and area labels within ~48h of report when possible.
3. **Review** external PRs with a fixed checklist; merge small safe fixes fast.
4. **Fix** P0/P1 on `main` with tests + i18n; close Issues from commit/PR body.
5. **Ship** via CHANGELOG + `release-tag.sh` when a batch of fixes is ready (see [release.md](./release.md)).  
   Each release **must** refresh README circular contributor avatars (`scripts/update-contributors.py`; no square table / contrib.rocks dual track).

---

## Labels (required vocabulary)

| Label | Use |
|-------|-----|
| `bug` / `enhancement` / `documentation` | Type |
| `priority:p0` | Blocks core usage (login, send, stuck UI, data loss) |
| `priority:p1` | Major UX / platform breakage |
| `priority:p2` | Polish, nice-to-have, backlog |
| `area:composer` | Input, paste, attachments, + menu |
| `area:session` | Streaming, history, permissions, agent connect |
| `area:auth` | OAuth / account / quota |
| `area:i18n` | Locale strings / hard-coded language |
| `platform:macos` / `platform:windows` | OS-specific |
| `from:community` | X / Discord / external report |
| `good first issue` | Small, well-scoped for newcomers |
| `triage` | Not yet prioritized |

Issue forms: `.github/ISSUE_TEMPLATE/`.

---

## Intake sources

| Source | Action |
|--------|--------|
| GitHub Issues | Primary tracker; use templates |
| X replies under launch posts | Open Issue with `from:community` + screenshot links |
| GitHub Discussions / email | Convert to Issue if actionable |
| PR comments | Fix in PR or open follow-up Issue |

**Do not** leave real bugs only in chat threads.

### X → Issue checklist

1. Quote user handle + post URL  
2. OS / app version if known  
3. Screenshot media URLs  
4. Labels + priority  
5. Link related PRs  

---

## Triage flow

```text
New Issue
  → label type + platform + area
  → priority:p0|p1|p2 (or leave triage)
  → assign or leave unassigned
  → P0: fix or workaround same day if possible
  → P1: target next patch release
  → P2: backlog / good first issue
```

### Priority guide

- **P0**: cannot log in / send / attach; infinite lock; crash loops; silent data wipe  
- **P1**: wrong platform chrome; multi-instance; duplicate history; broken permission allow  
- **P2**: thinking default collapse; Linux package; multi-account; web history import  

---

## PR review (community + maintainer)

### Must pass

- [ ] `pnpm typecheck` && `pnpm test` && `pnpm lint` && `pnpm build:ui`  
- [ ] `python3 scripts/check-code-quality-gates.py --mode final`  
- [ ] `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test` (or CI green)  
- [ ] User-facing strings via `src/i18n/messages.ts` (**en + zh** same keys)  
- [ ] No `window.confirm` / `prompt` / `alert`  
- [ ] No OS-default select/menu chrome; no bare transparent `.menu-panel`; overlays use project components + solid/glass surface (see [dialogs.md](./dialogs.md))  
- [ ] No secrets, `auth.json`, local agent homes  
- [ ] Scope matches description; no drive-by refactors  

**Agents:** if the user asked for a PR, run the list above locally first. Do not open a PR or hand over a compare URL while it is red.

### Merge policy

| Kind | Policy |
|------|--------|
| Small bugfix, clear root cause, tests | Squash-merge after CI / local check |
| Feature / large refactor | Request changes or design note first |
| i18n / permission / agent protocol | Prefer maintainer re-verify against real CLI |
| Security | Follow SECURITY.md; do not discuss exploits in public Issues |

### Adopted community PRs (examples)

- **#1** locale-aware session titles — **merge** (correct i18n for LLM rename)  
- **#2** Grok Build underscore permission optionIds — **merge** (fixes shell tool allow failures)

After merge: thank author on PR; close linked Issues; mention in CHANGELOG under next version (one short sentence per bullet for the What's New popup; see [release.md](./release.md)); **then clean branches** (next section).

---

## Agent git workflow

Product rules stay in `AGENTS.md` items 1–8. Git process lives here so a bugfix squash does not mix with contributor workflow.

### Commit then push

After a fix or feature lands as a local `git commit` on a branch that tracks `origin`, **`git push` in the same turn**. Do not leave commits only on this machine. Opening a PR from GitHub without push ships a stale tip. Skip push only when the user explicitly says not to, or the branch has no remote yet (then `git push -u origin HEAD`). Never push secrets, `auth.json`, personal config, or `.hypergrep/`.

### Local CI before opening a PR

If the user asks for a PR, or you are about to open one / hand them a compare URL as “ready to PR”: run the **same checks as** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) **locally**, and they must pass. Do not open a PR, do not tell the user it is ready, and do not give `compare?...&expand=1` as a go-ahead while these are red. Fix first.

Frontend (repo root):

```bash
pnpm typecheck
pnpm test
pnpm lint
python3 scripts/check-code-quality-gates.py --mode final
python3 scripts/publish-website-downloads.py --self-test
pnpm build:ui
```

Rust (`src-tauri`):

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

CHANGELOG Unreleased first sentences must stay ≤ 90 characters (`whatsNew.test.ts`). Local red = not done. This machine can only run macOS clippy/tests; still run them. Do not assume GitHub CI will catch it.

---

## Branch hygiene (merged / finished work)

**Rule:** after work lands on `main` (GitHub merge, squash, or batch integrate), **promptly and safely** delete the remote feature branch and local leftovers. Stale branches hide real WIP and confuse agents.

### When to clean

| Trigger | Action |
|---------|--------|
| PR **MERGED** on GitHub | Delete remote head branch (GitHub “Delete branch” or `git push origin :branch`) |
| PR **CLOSED** with “merged via integrate / squash into main” (not the green Merge button) | Same as merged — content is on `main`; remote branch is obsolete |
| Local `pr-*` / `rebase-pr-*` / `integrate/*` / `merge/*` / `feat/*` with **no unique commits** vs `origin/main` | Delete local branch |
| Git worktree whose branch is fully contained in `main` and has a clean tree | `git worktree remove <path>` then delete the branch |
| After a multi-PR batch land | `git fetch --prune` and sweep remotes + locals in one pass |

### Safe identification (do not guess)

1. `git fetch --prune origin`
2. Fully merged (fast-forward / true merge):  
   `git branch -r --merged origin/main` and `git merge-base --is-ancestor origin/<b> origin/main`
3. Squash / batch integrate (commits not ancestors, but already landed):  
   - `gh pr view <n> --json state,mergedAt` → `MERGED`, **or**  
   - closing comment says integrated / landed on main, **and**  
   - feature symbols / paths exist on `origin/main` (spot-check), **or**  
   - `git cherry -v origin/main <branch>` shows only `-` (already applied)
4. **Never** delete only because a PR is `CLOSED` — confirm content is on `main` or the change was intentionally abandoned.

### Never delete without checks

| Keep / stop | Why |
|-------------|-----|
| `main` (and default branch) | Always |
| Branch with **unique commits** not on `main` and still wanted | Real WIP |
| Branch checked out in a **worktree** | Remove/move worktree first (`git worktree list`) |
| **Locked** Claude/agent worktrees | Unlock or end session first |
| Open PR still targeting the branch | Wait until merge/close |
| Uncommitted changes or meaningful **stash** only on that tree | Save or discard deliberately first |

Stashes are **repo-wide** (shared across worktrees). Removing a worktree does not delete stashes — prune stashes separately if needed.

### Commands (maintainer / agent)

```bash
# Remote: delete landed heads (example batch)
git push origin :feat/foo :fix/bar

# Local: fully contained in main
git branch -d <branch>          # refuses if not merged
# After squash/batch confirmed on main:
git branch -D <branch>

# Worktree fully behind main + clean tree
git worktree remove /path/to/wt
git branch -D <wt-branch>

git fetch --prune
```

Prefer **delete remote soon after land**, then local. Do not force-push `main`. Do not `git push --delete` branches that still have open PRs or unmerged unique work.

### Agent obligations

1. After merging or confirming a land → offer or run branch cleanup in the same session when practical.  
2. Report what was deleted vs what was kept (and why).  
3. If unsure (CLOSED but no integrate note), **verify against `main`** before deleting.  
4. Batch integrate closers (`integrate/remaining-prs`, etc.): treat closed feature remotes as deletable once symbols are on `main`.

---

## Fix → close loop

1. Branch from latest `main`  
2. One concern per PR when possible  
3. Commit body: `Fixes #N` or `Closes #N`  
4. Update `docs/llm-wiki/*` if product rule changed  
5. After land: thank author; close Issues; **delete remote + local finished branches** (see Branch hygiene)  
6. After ship: verify closed Issues; reopen if regression  

---

## Maintenance automation

| Mechanism | Location |
|-----------|----------|
| CI (typecheck, vitest, UI build, cargo test mac+win) | `.github/workflows/ci.yml` |
| Release builds + notes | `.github/workflows/release.yml` + `scripts/release-tag.sh` |
| Stale / needs-info (optional) | can add `actions/stale` later |
| PR template | `.github/PULL_REQUEST_TEMPLATE.md` |

### Maintainer weekly checklist

1. `gh issue list --label priority:p0` — empty or owned  
2. `gh pr list` — review open community PRs  
3. Scan X launch thread for new bugs → Issues  
4. Bump CHANGELOG unreleased notes if fixing on main  
5. When enough P0/P1 landed → [release.md](./release.md)  
6. **Branch hygiene:** `git fetch --prune`; drop merged remotes/locals and idle worktrees (see above)  

---

## Agent / AI handoff rules

When an agent maintains this repo:

1. Read this file + `Agents.md` + relevant llm-wiki pages  
2. Prefer **Issues first**, then code  
3. Prefer **merging good community PRs** over reimplementing  
4. Never force-push `main`; never tag without CHANGELOG section  
5. Redact tokens in logs and Issue bodies  
6. After multi-issue work: leave a short status in the PR / reply (what fixed, what remains)  
7. **After land:** safely clear merged remote/local branches and finished worktrees (Branch hygiene) — do not leave long-lived `pr-*` / integrate leftovers  
8. **App shell + AppWorkbench freeze:** never add new `useState` or feature blocks to `src/App.tsx` or `src/app/AppWorkbench.tsx`; put them in domain providers/hooks/components. Combined lines may only decrease (gate ceilings in `scripts/check-code-quality-gates.py`).
---

## Current community backlog snapshot (launch feedback)

Captured from X open-source thread (2026-07-24). Track as GitHub Issues with `from:community`.

| Topic | Priority | Status |
|-------|----------|--------|
| Paste image + file picker in + menu | P0 | ✅ 0.1.1+ (paste / + Files; dead “coming later” string removed) |
| Composer lock when stream stalls | P0 | ✅ 0.1.3 #37 stall cancel + #40 send queue; type allowed except permission |
| Duplicate history on next send / session switch | P0 | ✅ 0.1.3 #35 FSM gate + `clearPriorTurnStreaming`; regression test |
| Login auth code / relay path | P0 | ⏸ deferred (official OAuth works; custom relay separate) |
| Agent connect / provider errors | P0 | ⏳ keep improving G11 copy |
| Permission optionId hyphen vs underscore | P0 | ✅ PR #2 |
| Multi-open Dock | P1 | ✅ single-instance plugin (re-verify if dual Dock icons remain) |
| Titlebar panel toggle overflow | P1 | ✅ traffic-light safe inset 96px |
| Composer placeholder occlusion | P1 | ✅ DOM-aware placeholder hide |
| Thinking / long-chat scroll flicker | P1 | ✅ height-noise filter on stick-to-bottom |
| Plan/Goal sticky bar | P1 | ✅ PR #41 |
| Session title hard-coded Chinese | P1 | ✅ PR #1 |
| Thinking collapse preference | P2 | ✅ auto-collapse default + remember |
| Multi account | P2 | ✅ 0.1.1 |
| Grok Web history import | P2 | ❌ out of scope (local sessions) |
| git worktree UX | P2 | ✅ #46 list+switch; create via project chip (sibling path; no remove) |
| Claude-Code-like pure chat shell | P2 | ❌ product is Agent workbench |
| Arch Linux package | P2 | ✅ document AppImage on Arch (+ optional AUR later) |
| Plugin marketplace install UI | P2 | 💬 design note (CLI remains SoT for install) |
