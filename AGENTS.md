# Agent notes — Grok App

## Read first

1. **`docs/llm-wiki/`** — product rules for agents (i18n, Grok Build catalog).  
   - [media-delivery.md](docs/llm-wiki/media-delivery.md) — local file previews: loopback HTTP + path resolve (not raw `media://` in product paths)  
   - [i18n.md](docs/llm-wiki/i18n.md) — all UI strings via `src/i18n/`  
   - [settings-ia.md](docs/llm-wiki/settings-ia.md) — **settings IA**: tabs, search registry (`settingsCatalog`), deep links; every new setting must be registered  
   - [dialogs.md](docs/llm-wiki/dialogs.md) — **no `window.confirm` / `prompt` / `alert`**; **no OS-default controls**; reuse `Select` / `ContextMenu` / panel CSS; **no transparent menus**; **no stacking bugs**
   - [catalog.md](docs/llm-wiki/catalog.md) — models / effort / YOLO  
   - [automations.md](docs/llm-wiki/automations.md) — automation design (Build `/loop` / scheduler; non-blocking)  
   - [account.md](docs/llm-wiki/account.md) — official login, membership, quota, heatmap  
   - [providers.md](docs/llm-wiki/providers.md) — custom relays, agent `GROK_HOME`, editors  
   - [model-routing.md](docs/llm-wiki/model-routing.md) — **official tool inject for custom main only** (never official subscription; MCP `official-aux` tools-first; Host vision for text-only custom)
   - [session-continuity.md](docs/llm-wiki/session-continuity.md) — load/bootstrap; **pasted UUIDs default to Grok App session ids** (not CLI agent ids)
   - [session-api.md](docs/llm-wiki/session-api.md) — **local session API**: list + continue-by-id (#626 first slice)
   - [setup.md](docs/llm-wiki/setup.md) — first-run gate (CLI required, account optional)  
   - [icons.md](docs/llm-wiki/icons.md) — app dock icons vs tray/status-bar icons (never mix)  
   - [remote-im.md](docs/llm-wiki/remote-im.md) — **Remote IM** GUI 配置全渠道 · Bridge · Grok Build；goal 见 `docs/plans/GOAL-remote-im.md`  
   - [maintain.md](docs/llm-wiki/maintain.md) — **open-source maintenance**: Issues triage, PR review, community intake, ship loop, **branch hygiene**
   - [chatcut.md](docs/llm-wiki/chatcut.md) — **ChatCut Codex plugin**: adapter, MCP surface header, Resources browser handoff, re-pull migration

1b. **Release (AI handoff)** — **[docs/llm-wiki/release.md](docs/llm-wiki/release.md)** is the single source for ship steps. Platforms / local build: [docs/BUILD.md](docs/BUILD.md). Window chrome: `tauri.macos.conf.json` (Overlay) vs `tauri.windows.conf.json` (frameless).  
   - Never tag without `## [X.Y.Z]` in `CHANGELOG.md`.  
   - GitHub Release body = `scripts/changelog-for-release.py` (**version changes only**; install/`xattr` live in README).  
   - Do not hand-edit Release notes only on GitHub; change the script + CHANGELOG.  
   - **Contributors**: every release refresh circular-avatar galleries via `python3 scripts/update-contributors.py` (README.md / README_EN.md / README_ZH.md / README_RU.md markers). No square table + contrib.rocks dual track.

1c. **Open-source surface** — public docs: `README.md` / `README_EN.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`. Do not commit secrets, `auth.json`, or local agent homes.

2. Do **not** hardcode user-facing copy in any language. Use `createT(locale)` / `t()`. Fifteen locales ship (`de` `en` `es` `fil` `fr` `id` `it` `ja` `ko` `pt-BR` `ru` `ta` `uk` `zh` `zh-TW`); `en` is the key authority. Complete catalogs must stay in lockstep with `en`; `ru` is English-backed. Never fork a date or number format on `locale === "zh"` — use `intlLocale()` / `isTightScript()`. See [i18n.md](docs/llm-wiki/i18n.md).

2b. **Dialogs & overlays** — never use `window.confirm` / `window.prompt` / `window.alert` in Tauri UI. Use App `setAppDialog`, `GlassModal`, or the same in-app portal + modal/menu CSS. Prefer existing panel styles (`.cmm__pop`, solid context `.menu-panel`, `.modal`); frosted glass is **not** required. Details: [docs/llm-wiki/dialogs.md](docs/llm-wiki/dialogs.md).

2c. **No system-default UI chrome** — do **not** ship native `<select>`, OS-default dropdowns, or browser context menus for product actions. Reuse project components: `Select`, `ContextMenu`, `Composer*Menu`, `OpenLocationButton`, existing `.cmm__pop` / glass / context surfaces. Bare `.menu-panel` has **layout only and no background** — always attach a solid context class, a glass-listed class, or an already-styled panel variant. **Forbidden**: fully transparent dropdown/context panels; content stacking bugs (missing portal, wrong z-index, click-through, clipped menus). See [docs/llm-wiki/dialogs.md](docs/llm-wiki/dialogs.md).

3. When adding models or permission modes, update `src/lib/grokCatalog.ts` **and** `docs/llm-wiki/catalog.md`.

3b. Default `session_data_mode` is **shared** (`GROK_HOME=~/.grok`, same as terminal Grok Build). **Independent** mode uses `~/.grok-app/agent-home` and is where App rewrites agent `config.toml` (custom providers, privacy, workflows, …). Shared mode refuses rewriting `~/.grok`. Do not leave relay keys only in App secrets.

4. Prefer real Grok Build CLI behavior (`grok models`, `--always-approve`, `--effort`).

5. Assistant messages: render markdown (`MarkdownBody`); user messages: gray bubble, no role labels.

6. **Branch hygiene** — after work lands on `main` (merge, squash, or batch integrate), promptly and safely delete finished remote/local branches and idle worktrees. Confirm with `git fetch --prune`, ancestor / `gh pr` / feature-on-main checks; never delete open-PR heads, unique WIP, or worktree-checked-out branches without removing the worktree first. Details: [docs/llm-wiki/maintain.md](docs/llm-wiki/maintain.md#branch-hygiene-merged--finished-work).

7. **App.tsx growth freeze** — do **not** add new `useState` / large feature blocks to `src/App.tsx`. New product state and UI must land in domain modules (`src/providers/`, `src/hooks/`, `src/components/`, `src/lib/`). During code-quality remediation App line count may only decrease relative to the WP start baseline (see `docs/plans/CODE-QUALITY-PROGRESS.md`).
