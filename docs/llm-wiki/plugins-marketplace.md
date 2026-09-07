# Plugin marketplace (App)

Install and manage Grok Build plugins from **Settings → Extensions → Plugins** without a separate Market tab. Catalog lives under **可安装 / Installable** on the plugins page.

## Current behavior

| Action | Where | Effect |
|--------|--------|--------|
| Recommended | Plugins → **推荐** | ChatCut (`https://github.com/ChatCut-Inc/agent-plugin#codex`) and **X API** (`https://github.com/RongleCat/x-api`); **never auto-install**; GlassModal confirm then `plugin install --trust` |
| List installed | Plugins → **已安装** | `grok plugin list --json` + inspect enrich; primary control = enable toggle; update/validate/details/uninstall under expand |
| Details / uninstall / update | Expanded installed row | CLI; GlassModal confirms uninstall |
| **Validate** | Path-install **Validate** (local folder only), or installed-row validate | `grok plugin validate [path]`; in-form summary + GlassModal; soft-fail if CLI too old / missing |
| Browse catalog | Plugins → **发现 / Discover** | ensure `https://github.com/openai/plugins` (idempotent soft-fail) then `plugin list --json --available` (cached) |
| Install from catalog | Discover row → confirm | `plugin install --trust` then `plugin enable` + soft-respawn |
| Manual install | Discover → **+** (`settings-anchor-ext-plugins-install`) | GlassModal: local folder via **Choose folder** or paste; git URL / `owner/repo[#subdir]`; optional Validate; then confirm |
| Marketplace sources | Discover → sources gear | add / remove / refresh git sources (**never** delete user sources when ensuring openai) |

Skills / MCP enable toggles remain App-side (`extensions.json` + ACP inject). **Plugins follow CLI/config as source of truth** — do not invent a second store under `~/.grok-app`.

Installed plugin `.mcp.json` servers (GUI path install included) are listed under **Extensions → MCP → From plugins**. Host expands `${CLAUDE_PLUGIN_ROOT}` / `${GROK_PLUGIN_ROOT}` and injects them on session open; it does not copy them into `~/.grok/config.toml`.

Plugin MCP auth is **not** ChatCut’s HTTP `mcp_oauth_start`. For `x-api`, the row **Authorize** button opens a GlassModal: console four tokens (App-owner) or OAuth 2 PKCE localhost (`http://127.0.0.1:8787/callback`). Credentials stay in `~/.x-api/credentials.json`.

The Host sends CLI arguments through a private stdin pipe to its embedded Node launcher. Legacy plugins still receive `process.argv` in memory, but no auth secrets appear in the OS command line. Never reintroduce a direct `node script --api-secret ...` spawn; keep output redaction and timeout cleanup.

**Deep link:** `#/settings/extensions/market` → Plugins tab (installable anchor `settings-anchor-ext-plugins-catalog`). Search for marketplace/市场 hits the same entry.

## Catalog UX

1. **Default filter** prefers **openai/plugins** when that source is configured; otherwise **All sources**. Other chips (xAI Official, user sources) remain available.
2. **Ensure openai/plugins**: entering installable load path lists sources; if missing, `marketplaceAdd` then optional update. Failures soft-fail with visible warn copy; existing sources still load.
3. **Cache**: first load runs CLI; re-entering within ~6h uses in-memory cache. “Refresh catalog” forces a reload. Install/add/remove sources invalidate or patch the cache.
4. **Detail panel**: catalog row opens GlassModal detail. **Install** / **Reinstall** use GlassModal confirm (no `window.confirm`). On success the plugin is **trusted and enabled**, then soft-respawn.
5. **Install failure recovery**: classified row errors + Retry (`pluginMarketPro`). Soft-fail capability gaps use warn tone.
6. **Catalog empty honesty**: loading · CLI missing · CLI too old · offline/network · load error · no sources · empty catalog · empty filter · empty query — distinct title/hint/CTA. Never invent catalog rows when the CLI fails.
7. **Installed badge**: installable rows that are already installed show Installed / reinstall path rather than a second blind install.

## Component counts

CLI often returns top-level `skill_count: 0` / `has_mcp: false` while `components` is filled. Host parsing (Rust + TS) enriches counts from `components.skills` / `mcpServers` / `hooks` / `agents`.

## Safety

- Never auto-install.
- Install always passes `--trust` for non-interactive UI; confirmation copy states third-party code runs with agent permissions.
- Prefer marketplace name pins (`name@xAI Official`) when the same id exists in multiple catalogs.

## i18n

All user-facing strings under `ext.plugins.*` / `ext.market.*` (en + zh + zh-TW).

## Non-goals

- Publishing plugins from the App.
- Parallel package managers (npm/pip) outside `grok plugin`.
- Hand-maintained catalog under app data (always CLI marketplace sources).

## Roadmap (v2)

Codex-first store + workbench + `@plugin.command` design:  
[docs/plans/2026-07-29-plugin-system-v2-design.md](../plans/2026-07-29-plugin-system-v2-design.md).  
（以 v2 为准；已删 panel-host 试验方向作废。）
