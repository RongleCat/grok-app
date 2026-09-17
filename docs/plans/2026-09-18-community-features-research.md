# Community features: research and implementation scheme

Date: 2026-09-18  
Issues: #1232 (project multi-root), #1235 (chat column width), #1234 (split chats)  
Status: **scheme only** — do not implement until 铁柱拍板.

Related: [2026-09-12-issue-1194-multi-root-workspace-design.md](./2026-09-12-issue-1194-multi-root-workspace-design.md), PR #1237.

---

## How other tools do it

### Extra folders / multi-root

| Product | Binding | Write | Config vs data |
|---|---|---|---|
| **Cursor** | **Workspace-level** `.code-workspace` folders. File → Add Folder to Workspace. One agent session targets the whole workspace (3.2+). | Agent edits all roots. | Each root can have `.cursor/rules`; skills/commands from all roots. Worktrees / Cloud Agents need a single git root. |
| **Codex** | **Primary folder + extras.** CLI `--add-dir` (repeatable). GUI: extra folders on a project; primary stays Git / AGENTS.md / skills root. Persist `sandbox_workspace_write.writable_roots`. | `--add-dir` grants write beyond cwd. | Extra dirs are data roots, not a second project config root. |
| **Claude Code** | Three layers: `--add-dir` (launch), `/add-dir` (this session), `permissions.additionalDirectories` in `.claude/settings.json` (**project persistent**). | Same permission mode as cwd. | Extra dirs are file access, not a full `.claude/` config root (skills/commands only for `--add-dir`, not the settings-file list). |
| **Grok App today** | **Session-level** workspace (`workspaces.json` + `SessionMeta.workspace_id`). Extra write only via custom sandbox profile; Independent can write `agent-home/sandbox.toml`; Shared stays read-only unless the user maintains `~/.grok/sandbox.toml`. | Extra write = `extra_write_active` after smoke + `--sandbox app_ws_*`. | Extra roots are `data_only` (no extra-root AGENTS.md / hooks). |

Cursor is closest to “this project always includes the backend.” Codex/Claude are closest to our current model (primary cwd + extra dirs), but they persist extras on the **project**, not per chat.

### Chat column width on large screens

| Product | Behavior |
|---|---|
| **Cursor** | Agent panel is resizable; **message body used to be a fixed max-width** (4K users complained). Nightly/later builds started using more of the panel. Same request as #1235. |
| **VS Code / Cody** | Chat now fills the sidebar width (Sourcegraph changelog: “chat wasn't using the full sidebar width”). |
| **ChatGPT / Claude.ai** | Reading column stays capped (~readable line length); full-bleed is rare because 100+ char lines hurt. |
| **Grok App today** | **Already shipped:** Settings → Appearance → Interface → **Chat reading width** (`narrow` 640 / `medium` 800 / `wide` 1000 / `full`). CSS `--chat-width-max` on `.lobe-chat__inner` and composer. Default medium. |

#1235’s “custom proportion, keep padding” is a **slider on top of an existing control**, not a missing feature. Point users at Wide/Full first.

### Split / multi-chat on one screen

| Product | Behavior |
|---|---|
| **Claude Code Desktop** (v1.2581+) | Movable panes (chat, diff, terminal, file, plan). Drag header to dock; not “two full agent chats” as the default. GitHub #48688 asked for side-by-side chats; closed as not planned. |
| **VS Code 1.134** | Drag chats / subagent chats into a **grid group**; layout restores. |
| **Windows 11 Snap** | OS-level 2/3/4 region snap; any windows, not product chrome. |
| **Warp / HiveTerm / CC-Panes** | Terminal split of **CLI processes**, not in-app chat columns. |
| **Grok App today** | Secondary **session windows** (`open_session_window`, `#/session/<id>`). Sidebar + aside already split (`paneSplitMotion`). No in-window chat grid. |

---

## #1232 — project-level default extra folders

**User job:** “This frontend project should always include the backend folder.”

**Already true after #1237:** new chats inherit the project’s existing workspace. Missing: a **project-owned default**, a sidebar entry, and “every chat in this project” copy.

### Approaches

| | A. Inherit only (status quo + #1237) | B. `Project.defaultWorkspaceId` (recommended) | C. Codex-style Workspace object in the sidebar |
|---|---|---|---|
| UX | Modal on a chat; new chats copy it | Project menu: “Default extra folders…” | Second tree of Workspaces |
| Persist | `workspaces.json` keyed by `primaryProjectId` | Same + `projects.json` default id | New first-class list |
| Cost | Done | S/M | L, AppWorkbench freeze risk |

**Recommend B.** One workspace record per project remains the default; the project row points at it. Session can still detach (`workspace_id = "-"`).

### v1 slice (if approved)

1. `Project.default_workspace_id: Option<String>`.
2. Project context menu + Composer “Workspace roots…” already open the same modal; on save, write the project default.
3. `bind_default_workspace_if_unbound` prefers `project.default_workspace_id` over `recentWorkspaceId`.
4. Doctor / chip: “project default · N extra roots”.
5. No extra-root AGENTS.md (keep #1194 `data_only`) until CLI has native multi-root trust.

**Out:** mixing SSH + local; treating extras as sidebar projects; rewriting `~/.grok` in Shared mode.

---

## #1235 — large-screen chat column

**User job:** less empty margin on a wide monitor; keep inner padding.

**Already true:** Appearance → Chat reading width. Reply on the issue: use **Wide** or **Full**.

### Remaining (P2)

| | A. Discoverability only | B. Percent slider (user’s “中间比例”) | C. Per-window drag of the reading column |
|---|---|---|---|
| UX | Hint in empty large-screen chrome | Settings slider 50–100% of pane | Drag gutters |
| Cost | Copy + maybe a one-time tip | M (i18n + catalog + CSS var) | L, fights `--chat-width-max` |

**Recommend A now, B later.** Do not add a second width system. If B: `html { --chat-width-max: min(N%, 100%) }` with existing padding; register `appearance.chatWidthCustom` in `settingsCatalog`.

---

## #1234 — drag-to-split chats

**User job:** two (or more) live chats on one large screen.

### Approaches

| | A. Use existing secondary windows + Snap | B. In-window 2-up split (recommended v1) | C. Full tiling WM (Claude Desktop / VS Code grid) |
|---|---|---|---|
| UX | Drag a chat to a new window; OS snaps | Drop a sidebar chat on the transcript → left/right columns | Arbitrary pane graph |
| Live agent | Already works (session-keyed Host) | Same Host pool; two composers | Same + layout persistence |
| Cost | Docs | M/L (new pane, two composers, focus, DnD) | XL, AppWorkbench freeze |

**Recommend B as v1, C later.**

### v1 slice (if approved)

1. Drag a sidebar session onto the main transcript (or session menu “Split right”).
2. Main workbench becomes two columns; each column is the existing composer+transcript stack keyed by `sessionId`.
3. Max **2** panes in v1. Close pane = that column goes away; session stays in the sidebar.
4. Persist `{ left, right }` session ids in layout prefs (not AppWorkbench `useState` — domain hook).
5. Reuse `open_session_window` as “pop out” from a split pane.
6. Windows 11 Snap remains for two **windows**; we do not reimplement Snap inside the webview.

**Out of v1:** 2×2 grid, mixing terminal/diff panes, drag from another desktop window.

### Risks

- Two live streams: Host already demotes peers to background; UI must show which column is focused for Send/Stop.
- Composer state must not live in AppWorkbench (growth freeze).
- DnD vs existing file/project drop (`useAppDragDrop`).

---

## Suggested order (after bug PR #1237)

1. Ship #1237 (inherit + delete/import + detach sentinel + archive copy).
2. Close or narrow #1235: document Wide/Full; keep open only if custom % is wanted.
3. #1232 slice B if the reporter still wants project-menu defaults after inherit.
4. #1234 only with an explicit “2-up in the main window” yes — otherwise keep secondary windows.
