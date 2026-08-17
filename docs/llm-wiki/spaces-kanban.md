# Project Spaces and Agent Kanban

Product surfaces from the leftover of #655 (Design Mode already landed as #636).

## Spaces

A Space is a **sidebar grouping of projects** (Work / Personal / …).

- Not a git workspace, not `GROK_HOME`, not the general agent cwd.
- Existing installs stay on **All projects** until the user creates or switches a space.
- Membership: `projectId → spaceId` in App settings (`projectSpaces`, `activeProjectSpaceId`, `projectSpaceById`).
- Default space cannot be deleted. Deleting a space moves its projects to Default.
- UI: `SpaceSwitcher` above the project list. Palette action `new-space`. Prompt errors stay inline (do not dismiss on invalid name).

Source: `src/lib/projectSpaces.ts`, `src/hooks/useProjectSpaces.ts`, `src/components/SpaceSwitcher.tsx`.

## Agent Kanban

`#/kanban` is an **Orca-style agent-run board**, not a personal to-do list.

| Column | Meaning |
|--------|---------|
| Needs you | Permission / ask-user / blocked |
| Working | Live streaming or tools |
| Done | Turn just finished |
| Idle | Hidden unless the user turns it on |

- Cards are **sessions**. Click opens that chat.
- Placement is derived from `liveMap` + session meta (`buildTaskBoard`), then remapped in `src/lib/kanbanBoard.ts`.
- Opening a Done card marks it seen (`grok-app.agentKanbanPrefs`) so it can move toward Idle.
- Just-finished turns persist in `grok-app.finishedAgentTurns` so Done survives remounting the pane after `liveMap` drops the row.

Source: `src/lib/kanbanBoard.ts`, `src/lib/sessionFinishedTurns.ts`, `src/components/KanbanBoardPage.tsx`. Hash route next to `#/automations`.

## Do not mix

- **Design Mode** is Browser inspect/send-to-composer (`docs` for #636). Do not land Design Mode hardening in this surface.
- **Automations** (`#/automations`) are scheduled tasks. Kanban is live agent runs.
- **Task board / batch agents** remain separate palette entries.
