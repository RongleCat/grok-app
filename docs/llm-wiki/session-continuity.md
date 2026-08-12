# Session continuity & context compact

## Session ID convention (for agents / debug paste)

When the user pastes a **session id** (UUID) into chat or issues for debugging:

| Default | Meaning |
|---------|---------|
| **Grok App session id** | UI journal under `{app_data}/sessions/<id>/` (`messages.json`, title, model prefs). This is what **复制会话 ID** / sidebar copy produce. |
| Agent session id | CLI id under `{GROK_HOME}/sessions/<encoded-cwd>/<agentSessionId>/` (`chat_history.jsonl`, `events.jsonl`). Linked as `agentSessionId` in `sessions_index.json`. |

**Lookup order for pasted UUIDs (unless the user explicitly says “agent session” / CLI id):**

1. `{app_data}/sessions/<uuid>/` + `sessions_index.json` entry  
2. If missing, optionally resolve as `agentSessionId` via `sessions_index` or scan `agent-home/sessions/**/<uuid>/`

App data root (macOS typical): `~/Library/Application Support/com.grokapp.grok-app/`.

## Problem

Grok App keeps a **UI journal** (`~/.…/sessions/<appSessionId>/messages.json`) separate from the **Agent session** under `GROK_HOME` (`agent-home/sessions/<encoded-cwd>/<agentSessionId>/`).

If the Host always called `session/new` on reconnect, the model only saw the latest user turn while the UI still showed full history — context looked “broken”.

## Strategy (Host)

### 1. Prefer native resume — `session/load`

On `session_connect` for an existing App session:

1. Spawn `grok agent stdio` with the same `GROK_HOME` / cwd.
2. `initialize` + `authenticate`.
3. If meta has `agentSessionId`, try **`session/load`** with that id + cwd.
4. On success → full agent context (tools, prior turns) restored.  
5. On failure → **`session/new`**, then mark **history bootstrap**.

**Replay gate (Host):** `session/load` replays history as ACP notifications
(`agent_message_chunk`, `tool_call`, plan entries, …). While **no**
`session/prompt` is in flight (`prompt_in_flight == false`), the Host **drops**
stream / tool / journal side effects:

- no re-typing into the UI stream  
- no `session://tool` storms  
- **no journal rewrites** (`messages.json` stays the UI source of truth)

**Human gates are not load-replay.** Grok Build may re-issue
`_x.ai/exit_plan_mode` after resume (`RestorePlanApproval` /
`awaiting_plan_approval`) with **no** prompt in flight. Host accepts Plan
events when `rpc_id` is set, or a plan gate is already pending, or a prompt is
in flight; only idle plan *notifications* without an open gate are dropped.
`ask_user_question` reverse-RPCs are never dropped as replay. Background
(demoted) turns handle Plan / AskUser the same way as live (emit + store
pending ids). Process exit / recycle clears pending gates and emits
`session://permissions_invalidated` (incl. `planRpcId`) so the UI drops ghost
Approve buttons.

**Plan chrome persistence (P1):** App session dir stores `plan_chrome.json`
(body, entries, closed flags, gate_stale). Host upserts on every live plan
event; UI also saves on dismiss/approve. On session open the UI loads chrome +
`session_agent_plan_snapshot` (agent `plan_mode.json` + `plan.md`). Restored
state never carries a live `rpcId` — Approve waits for Build re-park. Sticky
bar uses `planBar.resume` while `gateStale` / `awaitingAgentApproval`.

Live turns (`prompt_in_flight == true`) still apply stream + tools normally.
See crash investigation notes: ungated tool_call replay on open could thrash
Host/UI/disk and correlate with dual-process SIGABRT.

**Shared-process multi-session (P0):** warm reuse keeps co-tenant shells on one
CLI process. Host must **never** write load-replay / unstamped process traffic
into a **parked** co-tenant journal:

1. Bind live `process_id` (+ known `agentSessionId`) **before** `session/load`.  
2. Route by stamped agent session id; parked match → **drop** (no rescue).  
3. Unstamped turn events: unique mid-turn background → else live → else drop.  
   Never `rescue_parked` with fake `prompt_in_flight=true` (that caused
   cross-chat journal pollution + sticky “in progress”).

**Composer send target (P0, sticky cross-chat):** `openSession` also binds
shell `session.sessionId` immediately (not only after journal load). Send uses
`resolveComposerSendSessionId(viewing, shell)` and **prefers viewing** when they
disagree — otherwise text typed in chat B while A was still the shell id was
journaled into A (common when A was stuck “thinking”). Host `live_session_is_busy`
must not treat pure sticky Streaming (no `prompt_in_flight` / tools / deferred
gates) as forever-busy, or demote/focus for other chats stays blocked.

**Turn end journal heal (P0):** after every successful `session/prompt` Ok, Host
force-finishes sticky Streaming (#522) **and** runs
`try_reconcile_linked_session` over a short bounded retry window to pull missing
assistant/tool rows from agent `chat_history`. Filesystem reads run off the async
executor; every idempotent pass is aggregated before one
`session://journal_reconciled` event. This covers both dropped stream chunks and
a CLI history flush that becomes visible just after the prompt RPC returns
(user saw endless thinking while CLI already had the full answer). A per-session
journal lock prevents read-modify-write loss against an immediate next send; if
that newer turn is already running, the previous turn's remaining retries stop.

**UI transcript ownership (P0, #529):** `openSession` points `viewingSessionId`
at the target **before** disk journal load. Until messages swap, stream /
rehydrate / clear-streaming must **not** reduce against the previous chat's
array under the new id. Rules:

1. `sessionTranscriptStore` tracks `messagesOwnerSessionId` separately from
   viewing id; reducers use that session's own cache (or `[]`), never a foreign
   painted transcript.  
2. On switch, immediately `setMessages(cache[target] ?? [])` so owner matches
   viewing before any host event lands.  
3. Journal rehydrate upgrades only `messagesBySession[sid]`, never React prev
   from another project.

**Fast switch (Windows freeze / open storm):** rapid sidebar clicks must not
stack full open pipelines.

1. **Generation token** — every `openSession` / `newChat` bumps `openSessionGen`;
   after each `await`, abort UI writes when gen or viewing id no longer match.  
2. **Journal load without reconcile** — switch calls `session_messages` with
   `reconcile: false` (App `messages.json` only). Agent `chat_history` merge is
   **deferred** (~500ms) only if the user is still on that chat.  
3. **Warm connect debounce** (~350ms) — only the settled viewing session may
   call `sessionConnect`; pending timers clear on the next navigation.  
4. Host: `session_messages` / `paths_classify` run disk work on `spawn_blocking`
   so concurrent opens do not block the async runtime.

**Ghost streaming heal (optimistic send never reached Host):**

Send paints user bubble + empty streaming assistant immediately, then awaits
`ensureConnected` / `sessionSend`. If Host never enters a turn for that chat
(`liveMap[sid]` never becomes streaming), Host stream-stall does **not** run
(it only watches true Host Streaming). Client policy in
`src/lib/ghostStreamingHeal.ts` + `useGhostStreamingHeal`:

1. Empty trailing streaming assistant, no tools/body.  
2. Grace **30s** after `turnStartedAt`.  
3. `liveMap` for the viewed session is idle/missing (do **not** trust optimistic
   `liveHost.state`).  
4. Heal: strip optimistic user+assistant, unlock busy, bump `sendEpoch` so a
   hung `sessionSend` cannot re-dirty UI, restore text to composer, toast
   `agent.ghostStreamingHealed`.  

Real mid-turn silence still uses Host `STREAM_STALL` (soft banner; user End turn).

### 2. Fallback — journal bootstrap (reasonable turns)

When a **new** agent session is created but the App journal already has turns:

- On the **first** `session_send` only, prefix the agent prompt with a compact transcript of recent journal messages:
  - Up to **16** user/assistant messages  
  - **~2k chars** per message (truncated with note)  
  - **~14k chars** total for the block  
- Journal storage still writes only the user-facing turn (no bootstrap text in UI).
- Flag `needs_history_bootstrap` clears after that one send.

This covers load failure, wiped agent dirs, or agent version mismatches.

### 3. Soft-respawn

Permission / mode soft-respawn **keeps** `agentSessionId` so the next connect prefers `session/load`. Bootstrap runs only if load fails.

### 3b. Session data mode switch (E04)

When Settings flips `session_data_mode` independent↔shared, Host calls `recycle_all_agents` on live + background + parked processes (same kill/soft-disconnect paths as idle recycle). Live `agentSessionId` is cleared so reconnect does not `session/load` against the previous `GROK_HOME`. Journals stay. Emits `session://agents_recycled` for a short toast.

### 4. Process limits & idle recycle (I01–I03)

| Setting | Default | Behavior |
|---------|---------|----------|
| `maxConcurrentAgents` | **8** (cap **32**) | Cap on live + background-busy + parked processes. Switching Ready chats **parks** the prior process. Busy turns demote to **background** and keep streaming. Before spawn, **idle parked** are reclaimed until a slot frees; `PROCESS_LIMIT` only when slots are full of **busy** work. **Never** kill a busy background turn for focus. |
| `agentIdleMinutes` | **30** | Background watchdog soft-kills idle Ready agents (live + parked). **Session meta + journal stay**; next send reconnects (`session/load` or bootstrap). Emits `session://idle_recycled`. |

**Pool accounting rules (why "limit reached" must be rare and true):**

- The stored value wins over the default. Installs from the 3/8 era persisted
  `maxConcurrentAgents: 3`, so raising the default alone changed nothing for
  them — `migrate_max_concurrent` lifts a stored *legacy default* once and marks
  `poolSizeMigrated`, leaving any deliberate value alone.
- `background` is only reclaimable **via** `parked`. Finished background turns
  are swept to `parked` before every capacity decision and by the idle
  watchdog; otherwise a turn that ended off the normal path pinned a slot that
  nothing could free.
- `session://idle_recycled` with `reason: "capacity"` is the **success** path
  (a slot was freed, the spawn proceeded). Only `session://process_limit` means
  the pool is genuinely full of busy work — after parked reclaim, so the
  "all slots are busy turns" wording is accurate.

**No session monopoly:** each App session owns its ACP process. Focus switch never rebinds another chat’s process (`session/new` on a stolen child). UI listens to `session://stream` / `session://runtime` by `sessionId` so background turns keep updating after you leave the chat.

**Busy demote rules (must not park):** FSM `Streaming` / `AwaitingPermission` / `Connecting`, or non-empty `open_tool_ids`, or deferred `prompt_complete`, or pending plan/ask_user. Long tools (e.g. `find`) stay background-busy until terminal tool status. Capacity reclaim **only** kills idle `parked` Ready shells. `soft_respawn` is a no-op mid-turn. UI **skips warm `sessionConnect` on open** when another session is busy — first send still demotes+spawns.

**New chat / disconnect:** `newChat` must **not** call `sessionDisconnect` (that killed the live ACP and aborted turns when users hit 新建会话 right after send). Host `disconnect` demotes busy → background and parks Ready instead of killing. In-flight `executeSend` still runs `sessionSend` after `ensureConnected` even if the user already switched the draft UI.

**Send queue (per viewed session):** Follow-up enqueue only when *this* chat’s FSM is busy (`streaming` / `connecting` state). The process-global UI `connecting` flag (any `ensureConnected`) must **not** gate enqueue — that re-parked SuperGrok new-chat sends into “本会话队列” while another connect was in flight. Host mid-turn on another chat must **not** enqueue either — that send demotes the foreign turn and spawns concurrent work. Flush claims only the *viewed* session key (never fall back to live host id). Hold flush only when the claimed session is the busy live one.

### 4b. Session-scoped Host commands (no live-slot guessing)

`self.inner` (the live focus slot) is **not** an implicit command target. Every
turn-affecting command carries the chat it belongs to:

| Command | Target rule |
|---------|-------------|
| `session_send` | `sessionId` required in multi-session flows. Host makes that chat **promptable** under `connect_lock` (`ensure_promptable_session`): already-`background` keeps the process in place; `parked` while another chat is mid-turn unparks into **background** so the streaming focus is not stolen; otherwise promotes via demote+focus. No warm process → `CONNECT_FAILED` (UI cold-connects and retries the turn **once**). |
| `session_stop` | `sessionId` = the chat on screen; resolves via live **or** background. UI: composer Stop = **current** session only; Tasks/dashboard Stop all = **all busy**. |
| `session_rewind_drop_last_user` | `sessionId` must match the live slot, else error — truncating the wrong journal is unrecoverable. |
| `session_resolve_permission` / `_plan` / `_ask_user` | `sessionId` from the event payload. The pending rpc id belongs to the requesting chat's own ACP child. |

**Multi-window live slots:** secondary webviews share the process Host. Connecting
or sending on session B while A is streaming demotes A to `background` (stream
continues) or parks Ready A warm — never a silent kill. Secondary may passive
warm-connect; main still defers warm-connect while browsing a foreign mid-turn.
Pure policy: `src/lib/multiWindow.ts` (`planConnectToSession`,
`resolveStopTargets`, `concurrentConnectPreservesOther`).

**Why:** a warm `sessionConnect` (session open prefetch), a sidebar switch, or an
automation firing between the caller's `ensureConnected` and its `sessionSend`
moved the live slot. The send then landed on a *foreign* chat — cross-session
replies, and “has `agentSessionId`, empty journal” zombie sessions for the chat
that was supposed to receive it. Host now fails loudly instead of misrouting.
UI also defers warm-connect while a send/connect is in flight.

### 4c. Turn lifetime = `prompt_in_flight`, not the FSM

The agent fires `_x.ai/session/prompt_complete` **early** — while tools are open,
or with many seconds of answer text still to come. Treating that as the end of
the turn is how answers got truncated mid-sentence while the chat kept spinning.

`LiveSession.prompt_in_flight` is the authoritative "this chat is working" flag.
It is set when `session/prompt` is dispatched and cleared **only** by:

| Signal | Note |
|--------|------|
| `PromptComplete { authoritative: true }` | The `session/prompt` RPC result — ordered *after* every chunk the agent sent, so clearing here cannot truncate output. |
| prompt RPC error / timeout | Cleared against the **session id**, not the live slot (the chat may have been demoted mid-turn). |
| `stop` / `ProcessExited` / recorded turn error | Turn is over either way. |
| mock backend terminal chunk | Mock has no prompt RPC. |

`_x.ai/session/prompt_complete` arrives as `authoritative: false` and only
*defers*. `schedule_prompt_complete_fallback` is the escape hatch for an agent
that announces completion and then never returns the RPC result.

**That escape hatch must never front-run a talking agent.** It originally slept a
flat 3s and then resolved the pending `session/prompt` with a synthetic result —
which produced `authoritative: true` while chunks were still arriving, closing the
turn and sending the rest of the answer down the replay-drop path. Symptom:
journal holds a clean prefix of the answer, UI frozen mid-sentence, agent-side
`turn_ended outcome=completed`, no error anywhere. The window is therefore
**idle-based**: every inbound `session/update` re-arms it (`prompt_fallback_due`),
so the waiter is freed only after real silence.

**`session/prompt` wait (same idea):** not a fixed 600s wall clock. Host uses
`PROMPT_IDLE_TIMEOUT_SECS` (600s **silence** without `session/update`) plus
`PROMPT_ABSOLUTE_TIMEOUT_SECS` (4h) so multi-tool turns that keep emitting
progress can run past 10 minutes without a false `rpc timeout`.

### 4e. Host stream backpressure + long-tool heartbeat

| Mechanism | Behavior |
|-----------|----------|
| Stream emit coalesce | Per-turn buffer for `session://stream`. Flush on ~40ms idle, ≥600 chars, thought phase open/new, or `done`. Live + background paths. |
| Tool heartbeat | While `open_tool_ids` non-empty and turn busy: every **25s** re-arm `last_stream_progress` and emit `session://tool_heartbeat` `{ sessionId, toolCallIds, openCount, intervalSecs }`. Stops after **3h** age on oldest open tool (safety). |
| Stall interaction | Soft/hard stream stall only sees pure silence; heartbeats count as progress so long shell/find/subagent tools are not false-ended. |

Frontend also coalesces stream tokens (~48ms) before React `setState`.

### 4f. Main chat virtualization (scroll-safe)

When the transcript has **≥48** messages, the main chat uses a **variable-height**
virtual window (`chatVirtualList` + `useChatMessageVirtualizer`):

- Spacers preserve total `scrollHeight` so `useStickToBottom` pin / escape / re-pin
  and “Back to bottom” keep working.
- **Pinned** (following stream): always mount the tail; adaptive overscan builds
  upward (viewport-scaled, clamped).
- **Escaped** (user scrolled up): window by `scrollTop`; height remeasure of rows
  above the viewport adjusts `scrollTop` so content does not jump.
- Force-mounted nearby only while escaped (find match, streaming assistant, last
  user/assistant within a small index gap). Distant tail force **must not** expand
  the continuous window across the whole list — that defeated virtualization on
  long history browse. While pinned, force may still expand for blank-pin defense.
- Scroll recomputes are rAF-coalesced; cumulative offsets are cached until a height
  commit so flings stay O(log n) for range find, not O(n) every event.

Consequences, all of them load-bearing:

- **Replay guard** (`session/load` re-emitting old chunks) gates on
  `prompt_in_flight`, not on `fsm.state()`. A chunk that arrives while a prompt
  is in flight but the FSM already Readied **re-opens** the turn (`begin_stream`).
- `live_session_is_busy` includes `prompt_in_flight`, so a chat that is still
  talking can never be **parked** or idle-recycled — parked agents get no event
  routing, so parking a live turn silently discards the rest of the answer.
- `try_finish_deferred_prompt_complete` refuses to end the turn while the prompt
  RPC is unresolved.
- `send_message` rejects a second prompt on a chat that already has one in
  flight, instead of dispatching into a busy agent.

**Event ingress never fails silently.** `handle_acp_event` resolves the owning
session by `process_id` across live → background. If a turn-bearing event
(stream / tool / gate / exit) matches nothing, Host tries to rescue a
still-streaming **parked** agent back into `background`, and otherwise logs
`warn` with the process id. A dropped chunk is a truncated answer, so it must
never be a bare `return`.

### 4d. View focus: every draft needs an identity

`viewingSessionIdRef` is `null` for a draft — and **all drafts look alike**. Any
async path that captured "I started on a draft" and re-checked with `=== null`
would match a *different* draft the user opened since, and yank the workbench
back. Symptom: send a task, immediately open a new chat in another project, and
the moment the agent starts executing you are dragged back to the first chat.

`src/lib/viewFocus.ts` pairs the viewed id with a monotonic **epoch** bumped by
every user navigation (`openSession`, `newChat`, automation takeover). Rule:

> Capture `currentViewFocus()` **before** the first `await`; before writing any
> view state (`viewingSessionIdRef`, `setSession`, sidebar expand, optimistic
> bubbles), re-check with `shouldAdoptView` / `isViewingSendTarget`.

`isViewingSendTarget` compares real ids directly (reopening the same chat still
counts as watching it) and falls back to the epoch only for drafts.

**Thread order on reopen.** `mergeSessionMessagesById` places rows that exist
only in the journal **before the next row both sides share**, never at the tail.
Appending them meant that a cache holding just the streaming assistant (possible
after a mid-turn switch) rendered the user's own prompt *after* the whole
answer. Primary order is copied verbatim, including the repeated ids that
`tool_step` rows legitimately share. `snapshotOutgoingMessages` additionally
refuses to overwrite a populated session cache with an empty workbench view.

**Background gates:** a demoted chat can raise `session://permission` /
`session://ask_user`. The UI keeps them per `sessionId` and restores the bar when
you reopen that chat (toast + desktop notification meanwhile); it never steals a
draft's composer. Answers route to the requesting chat's process. A waiting
background chat emits its own `session://runtime`, so the sidebar shows which
chat is blocked.

## Who does `/compact`?

| Layer | Behavior |
|-------|----------|
| **Agent (Grok Build)** | **Primary.** Auto-compacts when context ≈ **85%** full (`[session] auto_compact_threshold_percent`). User can also run **`/compact [note]`** in-session. |
| **App Host / UI** | Does **not** auto-compress the agent window. Slash **`/compact`** is a user action: confirm dialog → send `/compact …` as a normal prompt to the agent. Host journal is **not** rewritten by compact (UI history stays full). |

### UI surface for compact (required)

Host listens for agent compact signals (`session/update` kinds such as `tokens_used` / `*compact*` / compact tools) and:

1. Appends a **journal marker** (`role: tool`, `marker: context_compact`)
2. Emits `session://context_compact` for live UI
3. Chat shows a **compact banner** (auto vs manual + optional token before→after + summary)
4. Short **toast** on live event

App history still shows full prior bubbles; the banner signals that **agent context** was compressed.

## Agent activity visibility (timeline + honesty)

Presentation rules (non-intrusive, audited 2026-07; timeline 2026-07-26):

1. **True timeline (while streaming)**: each tool is a `segments` entry (`kind: "tool"`) on the current-turn **assistant**, inserted when `applyToolEvent` fires. UI renders **thought → tool → content** in stream order inside the assistant bubble — not a bottom dump.
2. **Phase collapse (display layer)**: consecutive thought + tools form a **work phase**. When the phase ends (next **content**, or a **new thought after tools**, or turn idle), it collapses to one expandable chip (`TimelinePhaseBlock`). Expand to see reasoning + tool list. **Does not wait for final answer** — merge at phase boundary. Answer `content` never folds into a phase. Live trailing phase stays expanded while streaming.  
   **Layout (CodePilot-aligned)**: phase header = count badge + summary + caret-right; expanded body = **single left rail** (`border-l-2`); tool rows are flat 28px mono lines with **status dot on the right** (no nested left-dot + chevron stacks).
3. **Turn end + journal / reload**: Host often stores `U → assistant(final) → tool_step…` while tool `createdAt` is *earlier* than the assistant finalize time. `weaveToolsIntoAssistantSegments` (transcript paint + openSession + journal rehydrate) collects **all tools in the user-turn window** and rebuilds display segments as **thought → tools → content**. When the assistant is **finished** (`streaming: false`), live-interleaved segments are also forced into that same history layout via `reorderSegmentsToHistoryLayout` — no full app remount required. While still streaming, interleave is preserved. Message merge **must not re-sort by createdAt** (that produced `U → tools → A` and piled steps at the wrong end).
4. **No bottom turn-activity block** in the transcript. Failures are **quiet red dots / short hints** on timeline / phase rows only.
5. **Context grouping**: ≥3 consecutive read/search tools inside a phase expand as “Gathering context” (`TimelineContextGroup`).
6. **Standalone tool rows**: only when a tool arrives before any assistant bubble (and is not yet inlined), or a single tool without thought (not phase-worthy).
7. **Thinking labels**: content gist or duration — **never** 「思考 1 / 思考 2」 numbering.
8. **End of turn**: stop / stall / agent exit / permission deny / error → one **EndOfTurnChip** family. User Stop arms a **2s latch**.
9. Quiet “thinking” only when busy with no running tool and no streaming assistant.

| Piece | Behavior |
|-------|----------|
| Live tools | `session://tool` → `applyToolEvent` upserts `tool_step` **and** assistant `segments` |
| Timeline UI | `TimelineToolRow` / `TimelineContextGroup` inside assistant |
| Failed tools | Red mark on timeline row only |
| Tasks panel | Still `buildTurnActivity` / `collectSessionTasks` from `tool_step` rows |
| Cancel / stop | `turn_end` / `turn_cancelled` → `EndOfTurnChip` |
| Multi-session busy | `sessionLiveStore` |
| Session UUID hint | Host injects narrow search hint when resuming by UUID |

Old sessions without woven segments may still show tools after the answer body after weave — acceptable. New live turns keep stream order **until the turn ends**, then match history layout (tools above answer).

## Acceptance

1. Reopen a multi-turn App session after killing the agent process → next send either loads the same `agentSessionId` or injects bootstrap so the model knows prior turns.  
2. Soft-respawn (permission change) → resume preferred.  
3. Brand-new chat → no bootstrap, plain `session/new`.  
4. `/compact` still only runs when the user (or agent auto-threshold) triggers it on the agent side.
5. A streaming in chat A + send in chat B → B's turn goes to B (A's journal untouched), A finishes in background.
6. Chat A blocks on a tool permission while you read chat B → reopen A and the approval bar is still there and works.
7. Agent fires `prompt_complete` early and keeps writing → the full answer lands in the journal, and the turn ends when the prompt RPC resolves.
8. Reopening a chat that is streaming in background shows the live spinner / streaming bubble, not an idle-looking finished thread.
9. Send, then immediately open a new chat in another project → you stay on the new draft when the agent starts executing.
10. Switch away mid-turn and back → the thread reads user → thinking → tools → answer, with no prompt stranded at the bottom.
