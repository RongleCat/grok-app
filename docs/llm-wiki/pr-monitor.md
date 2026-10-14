# PR monitor — a session's PR watches, and the follow-up turns they deliver

A chat watches pull requests. A pull request is opened against a **repository**,
so the chat offers the repository's open PRs instead of guessing which one
belongs to the checked-out branch: a watch is one PR of the repository, owned by
one session, and a session may watch as many as it likes.

The host watches them. On its tick it polls each due PR with a single
`gh pr view --json …`, reads what actually changed, and delivers the follow-up
turn **into that session**; the client renders what the host pushes.

## User-visible behavior

- The branch menu's **Pull request** section lists the repository's open PRs —
  drafts included, newest update first, up to 30 — one compact row each: the row
  shows `#1316 Feat title…`, its state, its checks rollup and its head branch,
  opens the PR hub deep link, and carries its own watch control as a trailing
  bell. A chat that follows several PRs stays a short list, each bell sits on the
  PR it controls, and toggling one leaves the menu open for the next.
- The head branch a row names is the **PR's own property** (read-only metadata),
  never a filter and never a binding.
- The branch chip shows how many PRs this chat follows (`2 watching`) and names
  none of them.
- The section is shown whenever the repository's PR list is readable, including
  the honest "No open pull requests". No `gh`, not a git repository, no project,
  or a read failure → the section stays away and the menu keeps the branch area
  as it is. The app never invents a PR.
- The repository's PRs are read once each time the branch menu opens, including
  after a failed read, and a project change during that read starts the new
  project's read when the old one finishes. Watches are the host's business and
  are pushed, so the client never polls for them.
- Watching is per session: another chat's watches are neither shown nor
  stoppable here, and the same PR can be watched by two chats (each gets its own
  host poll and its own follow-up).

## What wakes the session

While a watch is mounted, the host polls `gh pr view <n> --json …` on its tick
(one call covers the PR fields, the conversation and the CI rows) and reads the
change semantically. These changes produce a follow-up turn in the watching chat:

| Change | Follow-up |
| --- | --- |
| New comment / review | the shipped comment block, with the comment's full body |
| CI not failing → failing | the shipped fix-CI block with the failed check rows |
| CI not green → green | change list + task line |
| PR state / mergeability / title change | change list + task line |

Not a wake: a re-poll of the same revision, a partial CI recovery that is still
failing, a draft toggle, or an edit inside an already-seen comment. The belt is a
stable fingerprint per watch: an unchanged poll does not wake, and mounting seeds
the baseline so a mount cannot fire a wake. A poll error is still pushed, and a
later poll that only clears that error is pushed too.

## Delivery rules

- The turn is delivered through the same host path the local session API uses
  (`session_api::prepare_send` + `dispatch_turn`), and the agent answers it.
- It is **marked as injected**, not shown as the user's own message. The origin
  travels with the turn, never with its text: `dispatch_turn` arms the chat
  (`injected_prompts`, origin `pr_monitor` for a wake, `external` for the session
  API) and the turn runner takes the arm while it writes the user row, so the row
  wears `marker: "auto_wake"`. Nothing is matched by text — a user who later types
  or pastes the same words still gets a normal user row — and an arm whose turn
  never went out is dropped, including when dispatch is cancelled before the row
  is written. `isInjectedPromptMarker` (`auto_wake` + the older
  `interjection`)
  keeps such a row **inside the turn before it** — it opens no new turn, so the
  answer reads as a continuation — and the thread draws one quiet line
  (`.lobe-chat-auto-wake`, first line of the prompt, full text on hover) instead
  of a user bubble.
- A chat with **no live agent process** (never connected, or recycled after
  idling) is connected first, so a wake really reaches the chat it was mounted
  for.
- A running turn is **never interrupted**: while the chat streams, connects or
  waits on a permission prompt the wake waits, and it is delivered as soon as
  that chat is idle — at most one turn per chat per pass. The waiting notice
  ("will follow up when this chat is free") is sent once per change set, not once
  per tick.
- One PR carries **one** wake. A change that arrives while a wake waits joins it
  — one line per kind, the newest observation wins, and a `from → to` pair keeps
  the value it started from — instead of stacking up turns.
- The last failure is retried once; a wake that still cannot land is reported as
  failed with the reason, and is then dropped.
- Once the PR is merged or closed, that change is delivered and the watch is
  dropped with a `settled` notice.
- The follow-up text is localized (15 locales, `en` is the key authority) by a
  host-side catalog, since the host writes the turn with no UI involved. Secrets
  a comment may paste (`sk-…`, `xai-…`, `Bearer …`) are redacted first.
- Copy the client renders (section, bells, chip count, toasts) stays in
  `src/i18n/`.

## Watches are session-bound and process-lifetime

- A watch belongs to the session that mounted it. Switching worktree, branch or
  chat does not drop it: the watched PR keeps waking the chat it was mounted for
  until that chat is deleted, the PR is done, or the user stops the watch.
- Another session's watches are invisible here; stop a watch from any branch
  menu of the chat that owns it.
- Poll failures are logged (`pr_monitor`) and pushed to the section, including
  when the error text changes or a later poll clears it, so a broken `gh` auth
  never looks like "nothing is happening".
- Deleting the chat (`session_delete`) stops its watches.

## Host side

`src-tauri/src/pr_monitor.rs` owns the watches:

- in-memory registry keyed by **session id**, each holding its PR watches;
  commands `pr_monitor_watch` / `pr_monitor_unwatch` / `pr_monitor_state`;
- one tick loop that works with the window hidden to the tray; a mount seeds its
  own baseline, so no client nudge is needed;
- events `pr-monitor://state` (the session's watch rows, pushed after any change)
  and `pr-monitor://wake` (queued / delivered / settled / failed);
- fingerprint dedup, one `gh pr view --json` call per poll covering PR fields,
  comments, reviews and the CI rows a fix-CI block needs;
- the semantic diff, the coalesced pending wake and the prompt live here too;
- `src-tauri/src/pr_monitor_i18n.rs` holds the follow-up copy (15 locales).

`gh` stdout is parsed, so the shared runner clears `FORCE_COLOR` /
`CLICOLOR_FORCE` / `CLICOLOR` and sets `NO_COLOR=1`
(`process_util::apply_no_color_env_std`). Inheriting a colored terminal used to
wrap `--json` output in ANSI escapes, which made parsing fail and the PR list
look empty.

## The agent's own handle (MCP tools)

The branch menu is the human path to a watch. The agent gets its own path, so a
PR it just opened is followed without anyone clicking a bell:

- The host injects a `pr-monitor` MCP server into the session's `mcpServers` at
  connect (and again on a hot MCP swap), scoped to that one chat, including when
  the chat reuses a process that was prewarmed before the chat existed. The script is
  embedded in the host and written to `{app_data}/mcp/pr-monitor/`
  (`src-tauri/src/pr_monitor/mcp.rs`, `scripts/pr-monitor-mcp.mjs`), so packaged
  installs work with no repo tree.
- Tools: `pr_watch` (mount, defaults to the chat's project), `pr_unwatch` (stop)
  and `pr_watches` (what this chat follows, with state / checks / last error).
  They talk to the running host over the loopback session API below, with the
  same token the session API uses; the injected env carries the endpoint file,
  the chat id and the chat's project.
- Loopback routes (127.0.0.1, token-gated, same server as the session API):
  `GET /v1/pr-monitor/watches?session_id=`, `POST /v1/pr-monitor/watches`
  (`session_id`, `project_path`, `pr_number`, `interval_secs?`),
  `DELETE /v1/pr-monitor/watches` (`session_id`, `pr_number`). They call the
  same host commands the UI calls, so the menu and the agent cannot disagree
  about what a chat is watching — and a mount from the agent shows up in the
  menu immediately (the host pushes `pr-monitor://state`).
- Wrap-up policy lives with the tools, not in the wake prompt: `pr_watch`'s
  description says to mount right after `gh pr create`; `pr_unwatch`'s names both
  sides — the agent merges its own PR (`gh pr merge`) and cleans the branch when
  the user wants it merged, and simply stops when someone else merged or closed
  it. The host still does the mechanical half — a merged/closed PR gets exactly
  one follow-up turn and the watch is dropped after it — so a contributor's watch
  ends even if the agent never calls `pr_unwatch`.

## Honest limits

- Watches live in the app process: hiding to the tray keeps them, fully quitting
  the app stops them and drops wakes that were still waiting, and there is no
  separate daemon.
- Watches are **not persisted**. Reopening the app does not silently resume a
  watch.
- At most 32 watches per session (each costs one `gh` call per interval);
  mounting past that fails with a soft error.
- Desktop only (a mirror client has no host poller), and it needs an
  authenticated `gh` on `PATH`.
- The agent tools need the host to be running: with the app closed the MCP
  server still starts but every call reports the missing endpoint instead of
  pretending to watch.

## Related

- Section: `src/components/ComposerPrListSection.tsx` (rows, inline bells)
  rendered by `ComposerWorktreeMenu`; rows are built by `prListRows`
  (`src/lib/prMonitor.ts`) from the host's state.
- Agent tools: `scripts/pr-monitor-mcp.mjs` (stdio MCP, no dependencies) +
  `src-tauri/src/pr_monitor/mcp.rs` (embed, write, ACP entry) injected by
  `src-tauri/src/extensions.rs`; routes in `src-tauri/src/session_api.rs`.
- Tracker: the plan docs under `docs/plans/` (`2026-10-10-pr-monitor-wake-spec.md`,
  `2026-10-12-pr-monitor-session-bound-spec.md`, `2026-10-12-pr-monitor-agent-tool-spec.md`).
- Decision record: ADR 0005 (a watch is session-bound, not branch-bound).
- Reuse, not replacement: `GitPrHubPanel` stays the detail view; a row opens it
  through `prHubDeepLink`.
- Prompt reuse: the host composes the same blocks the PR hub's buttons use
  (`src/lib/prReviewWorkbench.ts`: fix-CI, comment).
