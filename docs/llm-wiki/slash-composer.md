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
| Settings → Extensions | Skills + MCP list with **per-item enable toggles**, bulk **Enable all**, refresh; project cwd when a workbench project is active |
| `/mcp` slash | Quick `McpStatusModal`; **Manage in Settings** opens Extensions |
| Composer `+` / slash skills | Invocable **and enabled** skills only (chips); loaded via `skills_list` |

### Enable + inject (L03)

- **Prefs:** `{app_data}/extensions.json` — `mcp` / `skills` name → `bool`. Missing name = **enabled** (opt-out).
- **UI:** Toggle persists immediately (`extensions_set_mcp` / `extensions_set_skill`). Bulk enable via `extensions_enable_all_*`.
- **MCP inject (session open):** Host builds ACP `mcpServers` from `grok mcp list --json` (full command/args/env or url) filtered by prefs, and passes them on `session/new` / `session/load` (see `acp_client::open_session`).
- **Dual write:** Independent mode also mirrors `enabled` under agent-home `config.toml` (`[mcp_servers.<name>]`). Shared mode updates `~/.grok/config.toml` enabled flags on user toggle.
- **Live agent:** MCP pref change → `SessionManager::apply_extensions_mcp_change` soft-respawns so the next connect re-injects.
- **Skills:** App filter only (slash palette / chips). Agent still discovers skill files on disk.

Host commands: `skills_list`, `inspect_mcp`, `extensions_get`, `extensions_set_mcp`, `extensions_set_skill`, `extensions_enable_all_mcp`, `extensions_enable_all_skills`.  
CLI missing → actionable error with link to **Settings → CLI / Runtime**.  
Reveal skill paths / agent-home when paths are available (`path_reveal`).  
Pure helpers: `src/lib/extensionsUi.ts` (+ enable-set merge/filter). Host: `src-tauri/src/extensions.rs`. UI: `src/components/ExtensionsPanel.tsx`.

## Acceptance (Wave A)

See `docs/ACCEPTANCE-slash-composer.md`.
