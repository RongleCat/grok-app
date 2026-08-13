# ChatCut (Codex plugin) in Grok App

Grok App consumes the **upstream ChatCut Codex package** (`ChatCut-Inc/agent-plugin` → `codex/`) without permanently forking skill bodies.

## Package layout

| Upstream (Codex) | Grok consumable (adapter output) |
|------------------|----------------------------------|
| `.codex-plugin/plugin.json` | `.grok-plugin/plugin.json` |
| `.mcp.json` (`url`, `http_headers`, `oauth_resource`) | same + mirrored `headers` for ACP |
| `skills/*` | **copy** of upstream skills (no content rewrite; re-adapt overwrites) |
| `assets/` | copy from upstream |

**Pin:** `vendor/chatcut-agent-plugin.pin` (git URL + commit).  
**Clone (not committed, large ffmpeg assets):** `vendor/chatcut-agent-plugin/codex/` via:

```bash
node scripts/chatcut-plugin-start.mjs --fetch
```

**Minimal fixture (tests):** `src/lib/fixtures/chatcut-codex-minimal/`.

## Protocol parity

| Surface | Value |
|---------|--------|
| MCP URL | `https://api.chatcut.io/api/external-mcp/mcp` |
| OAuth resource | same URL |
| Header | `x-chatcut-mcp-surface: codex` until ChatCut documents a Grok surface |

Do **not** invent a `grok` surface value without upstream support — tools will break.

## OAuth lifetime (Host responsibility)

Discovery of the authorization server is **per MCP URL** (RFC 9728 well-known on that origin). Do **not** fall back to ChatCut’s well-known endpoint for other servers — that sends Appwrite (and every other remote MCP) to `api.chatcut.io` (#605).

ChatCut’s AS issues **short-lived access tokens** (`expires_in` ≈ 3600s) plus a **`refresh_token`** when scope includes `offline_access`. The official plugin does **not** refresh; Codex does (Keychain + silent refresh). Grok App Host must:

1. Persist `access_token` + `refresh_token` + `client_id` + `token_endpoint` in `mcp_credentials.json` (agent-home and `~/.grok`, mode `0600`).
2. Before ACP `mcpServers` inject, **silent-refresh** when access is expired or within ~5 minutes of expiry.
3. Update `Authorization: Bearer …` in MCP config after refresh.

Without a stored `refresh_token` (legacy one-shot authorize), the user must **authorize once more** after upgrading; subsequent sessions stay long-lived until the refresh grant is revoked.

## Editor handoff → system default browser

Codex skills may request an in-app / “codex-internal-browser” handoff. Grok App **defaults to the OS system browser** instead: the side **Resources → EmbeddedBrowser** WebView cannot reliably play ChatCut media or run the full editor.

1. Tool result / link contains `browserHandoff`, `editorUrl`, `liveProject`, or `openStrategy.preferredMode: codex-internal-browser`.
2. Pure helpers in `src/lib/chatcutHandoff.ts` choose:
   - **Default open** = system browser via `openExternalUrl` / shell open.
   - **URL** = prefer `browserHandoff.url`, else `editorUrl`; apply locale; **strip** Codex-only params (`dockviewLayout`, `editor-boot-token`).
   - **Billing/pricing** = system browser (same path).
   - **Opt-in only** = `forceEditorInApp: true` → side Resources EmbeddedBrowser (legacy; keeps internal params).
3. Host `session://tool` path and chat link clicks open the system browser (deduped). They do **not** open the aside EmbeddedBrowser by default.

Locale path rule (same as Codex skills): zh → `/zh/…`, es → `/es/…`, else English default.

## Install / enable

### Settings → Extensions (recommended)

App **Settings → Extensions → Plugins → 推荐** offers ChatCut as an optional install:

| Field | Value |
|-------|--------|
| Install source | `https://github.com/ChatCut-Inc/agent-plugin#codex` |
| Match installed | name `codex` / `chatcut` (case-insensitive) **or** path/source containing `ChatCut-Inc/agent-plugin` |
| Confirm | GlassModal only — never auto-install, never silent trust without confirm |

After install, enable/disable from the recommended or installed row; MCP OAuth still under **扩展 → MCP**.

### Session data mode vs MCP (shared default)

Product default is **`sessionDataMode: shared`** → agent / doctor use CLI home **`~/.grok`** (same as terminal `grok mcp …`).

In **independent** mode, agent / doctor use App agent-home:

`~/Library/Application Support/com.grokapp.grok-app/agent-home`

while bare terminal still writes **`~/.grok`**.  
If MCP only exists under `~/.grok` while the App is independent, the App list may still show it (merged), but **doctor reports `MCP server 'chatcut' not found`** and **no 授权 button** until the server is present in agent-home.

**Fix (independent):** re-run MCP 诊断 in App (auto-mirrors user HTTP MCP into agent-home), or add:

```toml
# agent-home/config.toml
[mcp_servers.chatcut]
url = "https://api.chatcut.io/api/external-mcp/mcp"
enabled = true

[mcp_servers.chatcut.headers]
x-chatcut-mcp-surface = "codex"
```

### Where is 授权?

**设置 → 扩展 → MCP → `chatcut` 行**

1. 点该行的 **诊断**
2. 失败为 OAuth 后出现 **授权…**（远程 HTTP 服务器也会直接显示授权入口）
3. 按向导：Grok Build TUI `/mcps` → 对 chatcut 按 `i` 做交互式 OAuth；或打开诊断给出的浏览器 URL
4. 完成后点「我已授权 — 刷新诊断」
5. **新开对话** 再试 ChatCut 工具

CLI 没有 `grok mcp login`（skill 里的 Codex 命令在 Grok 无效）。

```bash
# 1) Adapt + validate (no ChatCut account required)
node scripts/chatcut-plugin-start.mjs --fetch

# 2) Install adapted tree (use absolute path — relative paths may be parsed as git shorthand)
grok plugin install --trust "$(pwd)/vendor/chatcut-grok-adapted"
grok plugin enable chatcut   # name from plugin.json

# 3) Or register MCP only (headers required) — prefer under agent GROK_HOME when independent:
GROK_HOME="$HOME/Library/Application Support/com.grokapp.grok-app/agent-home" \
  grok mcp add chatcut https://api.chatcut.io/api/external-mcp/mcp -t http \
  -H 'x-chatcut-mcp-surface: codex'
```

> Adapter **copies** skills into the adapted tree (CLI install does not follow symlinks). Do not hand-edit those copies — re-pull + re-adapt overwrites them.

Skills attach via the plugin install path; App Extensions prefs still gate MCP enable on session open (`mcpServers` inject).

## Migration (Codex → Grok, future re-pulls)

1. **Re-pull** upstream: `node scripts/chatcut-plugin-start.mjs --fetch` (updates pin commit as needed).
2. **Re-adapt**: same script regenerates `vendor/chatcut-grok-adapted` (skills symlinked — not hand-edited copies).
3. Re-install / enable plugin if the CLI copy is stale.
4. Never maintain a divergent skill fork under `src/` or App data; craft skills stay upstream-owned.

## Gaps vs Codex host tools

| Codex host | Grok equivalent |
|------------|-----------------|
| `control-in-app-browser` / `node_repl` browser runtime | Resources `EmbeddedBrowser` (open/focus URL) |
| Full browser-control tool_search API | Not 1:1 — open URL + user interacts in pane |
| `codex mcp login chatcut` | `grok mcp` OAuth flow / Extensions MCP wizard |

## Code map

- `src/lib/chatcutHandoff.ts` — URL policy (pure, unit-tested)
- `src/lib/chatcutCodexAdapter.ts` — Codex → Grok manifest/MCP (pure)
- `scripts/chatcut-plugin-start.mjs` — fetch / adapt / validate simulation
- `src/hooks/useSessionHostEvents.ts` — auto-open on `session://tool`
- `src/app/AppWorkbench.tsx` — ChatCut link click → Resources
- Host: `extract_tool_ui_fields` surfaces ChatCut URLs from MCP `rawOutput`
