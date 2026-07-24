# Session continuity & context compact

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
| `maxConcurrentAgents` | **3** | Cap on live + parked warm agent processes. Switching Ready chats **parks** the prior process (same session id). Over capacity → `PROCESS_LIMIT` + UI toast; LRU parked may be recycled for capacity. |
| `agentIdleMinutes` | **30** | Background watchdog soft-kills idle Ready agents (live + parked). **Session meta + journal stay**; next send reconnects (`session/load` or bootstrap). Emits `session://idle_recycled`. |

Same-cwd warm reuse (one process, switch ACP session) still applies when spawn flags match; otherwise multi-session parks up to the concurrent cap.

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

## Agent activity visibility (Codex-style)

Presentation rules (non-intrusive):

1. Historical `tool_step` rows stay in the journal but are **not** stacked in the transcript.
2. Live UI is a **single plain text line** (e.g. `Listing files in private persona folder`) under the current assistant bubble (or at the live edge if no assistant yet).
3. Only the **running** tool is shown (`pickRunningTurnTool`); successive tools **replace** the line; when the tool completes (content can resume) the line **disappears**; the next tool call shows again.
4. Quiet “thinking” only when busy with no running tool and no streaming assistant.

| Piece | Behavior |
|-------|----------|
| Live tools | Host emits `session://tool`; UI upserts `tool_step` messages in state |
| Visible UI | `LiveToolText` — one muted title line, no card / no “tool” chrome |
| Cancel / abort | `turn_cancelled` marker + toast |
| Session UUID hint | Host injects a narrow search hint when user asks to resume a session by UUID |

Docs peer: Codex-style mid-stream tool title — never multi-row stack, never heavy tool card.

## Acceptance

1. Reopen a multi-turn App session after killing the agent process → next send either loads the same `agentSessionId` or injects bootstrap so the model knows prior turns.  
2. Soft-respawn (permission change) → resume preferred.  
3. Brand-new chat → no bootstrap, plain `session/new`.  
4. `/compact` still only runs when the user (or agent auto-threshold) triggers it on the agent side.
