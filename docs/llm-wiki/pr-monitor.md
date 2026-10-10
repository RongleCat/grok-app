# PR monitor — branch-bound PR chip and session wake

The composer context bar shows the workspace folder and the current branch. The
PR monitor bands a **pull request** into that same branch chip and, once
mounted, wakes the chat when the PR really changes.

## User-visible behavior

- The PR is the one **bound to the current branch**, following git semantics:
  the PR whose head branch is the checked-out branch (a branch has at most one
  open PR; the newest open one wins). Detached HEAD has no branch, so no PR.
- The chip shows the PR only while it is **watched**: `branch` then
  `#1316 Feat title truncated…` (title capped at 36 code points, ellipsized,
  whitespace collapsed, never split mid surrogate pair).
- The branch menu gains a **Pull request** section: the PR row (state + checks
  rollup, opens the PR hub deep link), the watch toggle, the last change that
  woke the session, and how many follow-ups are waiting.
- No PR, `gh` missing, not a git repo, no project, or detached HEAD → the branch
  area shows the branch only. The app never invents a PR.

## What wakes the session

While a watch is mounted, the host polls `gh pr view <n> --json …` on its tick
and emits `pr-monitor://update` only when the snapshot fingerprint moves. The
frontend then reads the change semantically. These changes produce a follow-up
turn in the watched chat:

| Change | Follow-up |
| --- | --- |
| New comment / review | `buildPrCommentPrompt` with the full body, then the task line |
| CI not failing → failing | `buildFixCiPrompt` with the failed check rows |
| CI not green → green | change list + task line |
| PR state / mergeability / title change | change list + task line |

Not a wake: a re-poll of the same revision, a partial CI recovery that is still
failing, a draft toggle, or an edit inside an already-seen comment. The belt for
this is that each delivered wake carries a key of `PR number + revision +
change set`, and a key is delivered at most once.

## Delivery rules

- The follow-up is sent through the shipped `session_send` path, so it appears
  in the chat as a normal user turn and the agent answers it.
- The wake goes to the session the watch was **mounted for** (the host records
  it), so switching chats or branches cannot re-route a follow-up.
- A running turn is never interrupted: while the session streams, connects or
  waits on a permission prompt, the wake is queued (with a short notice) and
  delivered when the chat is idle.
- Each change is delivered once. Delivering it also clears the host's copy, so
  a UI remount cannot deliver the same change a second time.
- Once the PR is merged or closed, that change is delivered and the watch is
  then stopped — the host would otherwise poll a finished PR forever.
- Copy is localized (15 locales, `en` is the key authority).

## Mounts are sticky and process-lifetime

- A mount belongs to the session + branch that created it. Switching
  worktree, branch or chat does **not** drop it: the watched PR keeps waking the
  session it was mounted for, even when that branch is no longer on screen.
- Stop a watch from its branch's menu (or let the PR merge/close).
- Poll failures are logged (`pr_monitor`) and shown as a hint in the branch
  menu, so a broken `gh` auth never looks like "nothing is happening".

## Host side

`src-tauri/src/pr_monitor.rs` owns the polls:

- in-memory registry keyed by `projectPath` + `branch`; commands
  `pr_monitor_watch` / `pr_monitor_unwatch` / `pr_monitor_list` /
  `pr_monitor_poll_now` / `pr_monitor_consume_pending`;
- one tick loop that works with the window hidden to the tray;
- fingerprint dedup: mounting seeds the baseline so a mount cannot fire a wake,
  and an unchanged poll emits nothing;
- one `gh pr view --json` call per poll covering PR fields, comments and reviews;
- the last unconsumed change is kept per watcher, so a UI that remounted can
  still drain it (`pr_monitor_consume_pending`) instead of losing the wake;
- a watcher that is re-mounted for a different PR while a poll is in flight
  discards that stale result instead of seeding the new watcher's baseline.

The host only reports **that** the PR changed and hands over both snapshots. The
semantic diff and the prompt live in the frontend
(`src/lib/prMonitor.ts`, `src/hooks/usePrMonitor.ts`) so the wake can be
localized and reuse the existing PR prompt builders.

`gh` stdout is parsed, so the shared runner clears `FORCE_COLOR` /
`CLICOLOR_FORCE` / `CLICOLOR` and sets `NO_COLOR=1`
(`process_util::apply_no_color_env_std`). Inheriting a colored terminal used to
wrap `--json` output in ANSI escapes, which made parsing fail and the PR list
look empty.

## Honest limits

- Watches live in the app process: hiding to the tray keeps them, fully quitting
  the app stops them, and there is no separate daemon.
- Mounts are **not persisted**. Reopening the app does not silently resume a
  watch; the chip shows a PR only while that session actually watches it.
- At most 32 watchers are mounted at once (each costs one `gh` call per
  interval); mounting past that fails with a soft error.
- Desktop only (a mirror client has no host poller), and it needs an
  authenticated `gh` on `PATH`.
- One `gh pr list` read per project/branch change to resolve the bound PR — the
  same read the PR hub already performs.

## Related

- Tracker: Linear `BOR-98` (spec) with `BOR-99` … `BOR-102` (tracer-bullet tickets).
- Reuse, not replacement: `GitPrHubPanel` stays the detail view; the chip opens
  it through `prHubDeepLink`.
- Prompt reuse: `src/lib/prReviewWorkbench.ts` (`buildFixCiPrompt`,
  `buildPrCommentPrompt`).
