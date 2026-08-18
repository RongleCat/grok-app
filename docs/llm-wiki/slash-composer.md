# Slash composer · Skills · Doctor

Product rules for the slash palette, skill chips, mode markers, and Doctor.

## Workspace chip (desktop)

Desktop chat **always** shows `ComposerProjectMenu` on the context bar above the input (`composer__context-bar`), including the unbound **默认工作区 / Default workspace** state. The menu reuses the existing picker: list projects, add a folder, or clear back to the default workspace (`workspaces/general` cwd). Git worktree chip stays only when a real project folder is bound.

Phone layout does **not** mount this bar — project pick/add stays on `PhoneComposerToolsSheet`. Sidebar **Projects** `+` remains a second entry.

Gate: `showComposerProjectRow = !phoneLayout` in `AppWorkbench` (do not require `welcomeSession` or `activeProject`).

## Composer document model

- Draft is **segments**, not a plain string: `text | skill | chat`.
- Skills render as **inline chips** inside the editor (not a top-only chip bar).
- Attached chats render as **composer chips** (`ChatRefChip`); the editor skips `chat` segments so `[[chat:uuid]]` never becomes typed text.
- Mode markers (`goal`, and plan via session mode) live in the **composer toolbar**, not in the body.
- Storage / user bubble text uses stable tokens: `[[skill:name]]`, `[[chat:<session-uuid>]]`.
- Agent prompt serialization:
  - Skills → `/name` tokens (Grok Build invocable form), then plain text.
  - Chat tokens are **not** sent as agent text. Host `session_attach` expands ids into a compact transcript prefix (max 3 chats). Source journals are unchanged.
  - Goal task on → prefix `/goal\n` (finite objective until done — **not** a scheduled timer; copy says 目标任务 / Goal task).
  - Attachments still append `@/abs/path` lines via `buildAgentPrompt`.
- Goal chip + schedule: with Goal on, normal sends do **not** enter silent automation-setup wrap (unless the session is sticky “Create with AI”). Unexpected `grok-automation` fences confirm before create — see [automations.md](./automations.md).

## Slash trigger

Open when the caret is immediately after a `/` that is:

1. at the start of the draft, or
2. preceded by whitespace.

Filter by the query after `/`: exact name, prefix (including a trailing hyphen), kebab initials (`/rc` → `review-commit`), then name substring. Description is fallback only when no name hits.  
↑↓ highlight, Enter apply, Esc close. Hover and keyboard share the same `is-active` style.  
While the palette is open, Enter does **not** send the message.

## Item kinds

| kind | Result |
|------|--------|
| `mode` | Toolbar chip / session mode (`goal`, `plan`) |
| `skill` | Insert inline skill chip at caret |
| `action` | Host action (modal, navigation, toggle) — no body insert |
| `prompt` | Insert or send a slash command string |

## Prompt history (`/history` · empty ↑)

Two scopes in one picker:

| Tab | Source |
|-----|--------|
| **This chat** | Current session user prompts (Build-aligned ↑/↓ browse) |
| **Recent (all chats)** | Cross-session ring in `localStorage` (`grok.recentPromptHistory`): `{ text, sessionId, at }`, max 50, consecutive identical text deduped, text truncated for storage |

| Entry | Behavior |
|-------|----------|
| `/history` | Opens picker above composer; filter focuses; newest-first list (defaults to **This chat**, falls back to **Recent** if empty) |
| Empty composer **↑** | Opens the same picker on **This chat** and fills the newest session prompt; further **↑/↓** step (older / newer); **↓** past newest closes and clears |
| List nav | **↑/↓** · **Home/End** · **PageUp/PageDown** move highlight; Enter/Tab apply; Esc close |
| Select | Click / Enter / Tab drops the prompt into the composer (keeps `[[skill:…]]` tokens) |
| Successful send | Appends display text + session id to the recent ring |
| Clear recent | Recent tab only — **Clear** uses in-app `GlassModal` (never `window.confirm`); does not alter this chat’s messages |
| Remove one | Recent rows can remove a single ring entry (persists to localStorage) |
| Empty filter | When a query hides every row, offer **Clear filter** |

Helpers: `src/lib/composerPromptHistory.ts` (session + list nav/empty), `src/lib/recentPromptHistory.ts` (cross-session clear/remove). UI: `PromptHistoryPanel`.

## Attach another chat (`/attach-chat` · sidebar drag)

Codex-style **context attach**, not a journal merge.

| Entry | Behavior |
|-------|----------|
| `/attach-chat` or composer `+` | Opens a picker of other local sessions (excludes self, archived, already attached). Recent + same-project first. |
| Sidebar context menu / `⋯` | **Attach to current chat** — does not switch the open thread |
| Sidebar row | Always-visible labeled **Attach to current chat** on the left (hidden on the open row). |
| Sidebar drag | **Hold the left ⋮⋮ grip only**. Row body drag moves the chat between projects. Ghost chip follows the pointer. Drop on the composer (Esc or drop on sidebar cancels). |
| Composer chips | Up to 3. Click opens the source chat. If the source has newer `updatedAt`, the chip notes new messages are already included on send. |
| Send | Journal stores `[[chat:<uuid>]]` in the user bubble. Host prefixes a compact user/assistant transcript for the agent only |
| Limits | Max 3 chats; last 16 user/assistant turns; ~2k chars/turn; ~14k chars/chat |

Helpers: `src/lib/chatAttach.ts`. Host: `src-tauri/src/session_attach.rs`. UI: `AttachChatPanel`, `ChatRefChip`.

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

### Project vs global skills

`skills_list` merges:

1. **`grok inspect --json`** under the active session `GROK_HOME` (user / plugin / bundled / project when CLI reports them)
2. **Host disk scan** of `{activeProject}/.grok/skills/*/SKILL.md`

Then it **drops Claude/Cursor compat skills** when discovery is off:

- App overlay `extensions.json` `discoverExternalSkills === false`, or
- Active `config.toml` `[compat.claude] skills = false` / `[compat.cursor] skills = false`

Settings → Extensions → Skills has a **Discover Claude / Cursor skills** switch. Independent mode also writes those config.toml keys. Shared mode updates the App overlay only (never rewrites `~/.grok`). Hidden rows are omitted from this list and from slash / + (not greyed-out leftovers).

**Name collision (case-insensitive): project wins.** Project rows show a compact **`[Project]` / `[项目]`** tag after the skill name in Extensions, `+` / slash skill rows, and the skills task picker; global/user/plugin rows stay untagged. Create-skill still supports user or project scope under Settings → Extensions → Skills.

### Auto-refresh after conversation install

App slash / + palette is a **snapshot** from `skills_list` (inspect + project disk). Grok Build itself reloads skill files when they change on disk, but the App catalog does not until reloaded.

| Trigger | Behavior |
|---------|----------|
| Settings → Extensions skill toggle / create | `onSkillsPrefsChanged` → bump reload token |
| **Chat turn installs skills** (write `SKILL.md` under skill roots, `plugin install`, `npx skills`, `/create-skill`, …) | Host `session://tool` → `toolEventSuggestsSkillCatalogChange` → debounced `skills_list` (~900ms) |

Helpers: `src/lib/skillCatalogRefresh.ts`. Wired in `useSessionHostEvents` (`onSkillCatalogMaybeStale`) + `AppWorkbench` reload token. No app restart / new session required for newly installed **user-invocable** skills to appear in the palette (agent-side discovery remains CLI disk reload).

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
