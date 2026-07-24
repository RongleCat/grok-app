# Slash composer · Skills · Doctor

Product rules for the slash palette, skill chips, mode markers, and Doctor.

## Composer document model

- Draft is **segments**, not a plain string: `text | skill`.
- Skills render as **inline chips** inside the editor (not a top-only chip bar).
- Mode markers (`goal`, and plan via session mode) live in the **composer toolbar**, not in the body.
- Storage / user bubble text uses stable tokens: `[[skill:name]]`.
- Agent prompt serialization:
  - Skills → `/name` tokens (Grok Build invocable form), then plain text.
  - Goal mode on → prefix `/goal\n`.
  - Attachments still append `@/abs/path` lines via `buildAgentPrompt`.

## Slash trigger

Open when the caret is immediately after a `/` that is:

1. at the start of the draft, or
2. preceded by whitespace.

Filter by the query after `/` (name + description fuzzy contains).  
↑↓ highlight, Enter apply, Esc close. Hover and keyboard share the same `is-active` style.  
While the palette is open, Enter does **not** send the message.

## Item kinds

| kind | Result |
|------|--------|
| `mode` | Toolbar chip / session mode (`goal`, `plan`) |
| `skill` | Insert inline skill chip at caret |
| `action` | Host action (modal, navigation, toggle) — no body insert |
| `prompt` | Insert or send a slash command string |

## Doctor

Doctor is a **structured health UI**, not a raw JSON dump.

- Host builds a report with **checks** (`ok` | `warn` | `fail`) plus raw detail for copy.
- UI: pass/warn/fail rows, summary, copy, re-run, close.
- Entry points: sidebar/settings/tray/slash `/doctor` all open the same modal.

## Skills / MCP management (Extensions)

Full management surface: **Settings → Extensions** (`#/settings/extensions`).

| Surface | Role |
|---------|------|
| Settings → Extensions | Skills list + MCP servers (name, source/transport, path/target, vendor, compatibility); refresh; project cwd when a workbench project is active |
| `/mcp` slash | Quick `McpStatusModal`; **Manage in Settings** opens Extensions |
| Composer `+` / slash skills | Invocable skills only (chips); loaded via `skills_list` |

Host commands: `skills_list`, `inspect_mcp` (both optional `projectPath` → `grok inspect --json` cwd).  
CLI missing → actionable error with link to **Settings → CLI / Runtime**.  
Reveal skill paths / agent-home when paths are available (`path_reveal`).  
Pure helpers: `src/lib/extensionsUi.ts`. UI: `src/components/ExtensionsPanel.tsx`.

## Acceptance (Wave A)

See `docs/ACCEPTANCE-slash-composer.md`.
