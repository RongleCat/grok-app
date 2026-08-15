# Custom providers & agent profile

Product rules for **OpenAI-compatible relays** (CPA / sub2api / OneAPI / self-hosted) and how they reach Grok Build.

## Agent transport (shared with Grok Desktop)

Both Grok App and community **Grok Desktop** drive intelligence the same way:

| Layer | Implementation |
|-------|----------------|
| Runtime | **Grok Build CLI** binary (`grok`) |
| Entry | `grok agent stdio` |
| Protocol | **ACP** (Agent Client Protocol) JSON-RPC over stdio |
| Client | Desktop Host (`AcpClient`) — **not** a reimplemented agent brain |

Desktop never reimplements tools/sampling. It is an ACP client + UI shell.

## Agent profile (`GROK_HOME`)

| Session data mode | `GROK_HOME` for spawned agent |
|-------------------|-------------------------------|
| `shared` (default) | `~/.grok` (same home as terminal Grok Build CLI) |
| `independent` | `~/.grok-app/agent-home` (or `$GROK_APP_HOME/agent-home`) |

Custom providers are written to **`$GROK_HOME/config.toml`** as `[model.<id>]` sections so the agent can use `base_url` + `api_key` without OAuth fallback.

## Provider model (L2)

| Field | Role |
|-------|------|
| `id` | Config section slug (`[model.<id>]`) |
| `name` | Channel display label (provider card / menu group) |
| `baseUrl` | OpenAI-compatible root, usually ends with `/v1` |
| `baseUrlFullPath` | When **true**, host stores the URL as typed and **does not** auto-append `/v1` (App TOML `app_base_url_full_path`). Default **false** = legacy auto-`/v1` for CPA/sub2api. Use for gateways like Volcengine Ark Coding Plan (`…/api/coding`, `…/api/coding/v3`). Settings UI: switch **完整路径 / Full path** next to Base URL label. |
| `apiKey` | Required for custom relay; never returned plaintext to UI |
| `model` | **Active** request body model id (written to config `model = …`) |
| `models` | Multi-model catalog (`[{id, name}]`); App field `app_models` JSON in TOML (ignored by Grok Build). Each entry has request id + **display name** for composer chip |
| `efforts` | Reasoning-effort options for this channel (`[{id, name, isDefault}]`); App field `app_efforts` JSON. Composer effort menu uses this on custom route. Empty → Grok `low`/`medium`/`high` fallback |
| `contextWindow` | Optional token cap → TOML `context_window` as a **bare integer** (never `"1000000"`). Grok Build rejects string type and falls back to 200k (#538). Composer can set it; list/upsert preserves and reloads. Missing → UI chip uses `DEFAULT_CUSTOM_CONTEXT_WINDOW` (200k) only. |
| `apiBackend` | Message format: `responses` (default) \| `chat_completions` \| `messages` |
| `supportsVision` | App field `app_supports_vision`. When **true**, this custom channel is treated as multimodal: image `@path` stays in the prompt (CLI injects pixels) and the custom-main hook does **not** block `read_file` on PNG/JPG. Names / model ids that look like Grok / GPT-4o / Claude / Gemini already count as vision even when this is off. Unknown relays stay text-only (Host vision / path note) so DeepSeek-style APIs do not 400 on `image_url`. |
| `providerMode` | Explicit transport semantics: `generic` (default) or `grok_build_proxy`. Never infer this from a provider id or hostname. |
| `isDefault` | Maps to `[models].default` (set only via **Use** / composer pick activate, not a form checkbox) |

**Integer TOML fields:** Host writes `context_window = 1000000` (CLI-compatible). On `providers_list`, legacy quoted string forms are repaired in place. Other model edits must not drop or re-quote this field.

### Presets (add provider)

Add flow opens a **preset gallery** (`providerPresets.ts`):

| Preset | Models | Default efforts |
|--------|--------|-----------------|
| **Custom** | empty (user fills) | Grok `low`/`medium`/`high` |
| **DeepSeek** | `deepseek-v4-flash`, `deepseek-v4-pro` | `low` / `high` / `xhigh` / `max` (docs mapping table; default `high`) |
| **Amux** | `grok-4.6` + `grok-4.5` | Official Grok `low`/`medium`/`high`/`xhigh` (default `xhigh`) |
| **Yun API** | `grok-4.6` + `grok-4.5` | Official Grok `low`/`medium`/`high`/`xhigh` (default `xhigh`) |
| **OpenCode Go** | `deepseek-v4-flash`, `deepseek-v4-pro` | DeepSeek efforts (default `high`) |
| **火山方舟** (Volcengine Ark) | `deepseek-v4-flash` | Grok `low`/`medium`/`high`/`max` (default `medium`); **full path** on |

| Preset | Base | Get API Key |
|--------|------|-------------|
| DeepSeek | `https://api.deepseek.com/v1` (`chat_completions`) | https://platform.deepseek.com/ |
| Amux | `https://api.amux.ai/v1` (`responses`) | https://api.amux.ai/register?aff=Vccp |
| Yun API | `https://api.yunyi.ai/v1` (`responses`) | https://api.yunyi.ai/register/?aff_code=W0iw |
| OpenCode Go | `https://opencode.ai/zen/go/v1` (`chat_completions`) | https://opencode.ai/ |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/plan/v3` (`chat_completions`, **full path**) | https://console.volcengine.com/ark |

### Protocol pitfall (OpenCode Go / DeepSeek)

Grok Build’s stream parsers are strict. OpenCode Zen Go historically breaks both backends:

| Backend | Failure mode |
|---------|----------------|
| `responses` | Non-OpenAI frames (`{"type":"ping"}`) or `response.*.delta` **without** `sequence_number` → CLI worker fatal |
| `chat_completions` | Trailer frames like `{"choices":[],"x-opencode-type":"inference-cost",…}` **without** required `id` → `Failed to deserialize ChatCompletionChunk` → same crash |

**App fix (automatic):**

1. Prefer preset `api_backend = "chat_completions"` for OpenCode Go (do **not** use `responses`).
2. Host starts a **loopback SSE sanitize proxy** (`relay_stream_proxy`): rewrites that provider’s `base_url` to `http://127.0.0.1:{port}/r/{id}/v1`, stores the real host in `app_upstream_base_url` (CLI ignores unknown keys), and **drops** cost / ping / missing-`id` frames before Grok Build sees them.
3. Settings UI still shows the real upstream URL; repair runs on app start and `providers_list`.

Form shows a **Get API Key** text control under the key field when the channel matches a preset (by id or base host). Opens the URL via `open_external_url`.

CPA / sub2api / grok-go remain generic OpenAI-compatible relays.

### Grok Build-compatible relay mode

Use `providerMode = grok_build_proxy` only for a relay that intentionally
implements Grok Build's model catalog and native proxy contract. This mode is
separate from ordinary `[model.<id>]` relays:

| Concern | Host contract |
|---------|---------------|
| Opt-in | Explicit Settings selection, stored as `app_provider_mode = "grok_build_proxy"`; no BeefAPI or hostname special case |
| Protocol | `responses` only |
| Capability gate | Save reads the live `/models` response and requires every selected model to exist with `supports_backend_search = true` |
| ACP model | Spawn uses the real selected model id, such as `grok-4.6`, rather than the provider section alias |
| Child environment | Only the target `grok agent stdio` process receives `GROK_MODELS_BASE_URL`, `GROK_MODELS_LIST_URL`, `GROK_CLI_CHAT_PROXY_BASE_URL`, and `XAI_API_KEY` |
| Generic compatibility | Generic providers keep `[model.<id>]`, provider-alias spawn, and the existing stream sanitizer behavior |
| Apply | Editing the active provider recycles warm ACP processes; the next send starts with the new catalog and capability contract |

The key stays write-only from the UI and is never included in spawn logs.
`WSLENV` forwards the native URL/key variables without path translation; macOS,
Linux, and native Windows inherit them directly on the child command. This mode
does not enable `official-aux`, does not mix official OAuth into the relay home,
and does not require a second xAI credential.

## Settings UI (Account → Custom providers)

Left / right split (`ProvidersPanel`):

| Side | Content |
|------|---------|
| Left | **Add provider** on top; list of cards. Official Grok card first **only if** signed in / CLI auth / official key; otherwise list starts empty. |
| Right | Create/edit form when adding or selecting a custom card; official detail when selecting the official card; empty placeholder otherwise. |

Each card has **Use** to activate that route (`providers_activate`). Clicking a card opens detail/edit. No long intro copy, agent-home path, or separate “active route” switcher.

### Custom route requires independent data mode (#557)

Custom providers are written only under App **agent-home** `config.toml`. Default `session_data_mode=shared` uses `GROK_HOME=~/.grok`, where those sections are invisible — so third-party channels would fail without official login.

| Event | Host action |
|-------|-------------|
| `providers_activate(custom)` / set custom as default | Force `session_data_mode=independent` when still `shared`; set `switchedToIndependent` on the result |
| `prepare_route_auth_for_agent` on custom | Heal the same way before spawn |
| UI | Toast `prov.switchedToIndependent`; refresh Settings session-data control |

Official route does **not** force mode back to shared.

## Official tool injection

Settings → Account → **Extras** → toggle **Inject official tools** (`official_aux_inject`).

**Only while the active main route is a custom provider.** Official Grok subscription sessions never inject `official-aux` (native tools only).

When the toggle is on, credentials exist, and the route is custom: MCP **official-aux** (`web_search`, all `x_*`, `vision_describe`) under `agent-home-official`. Default does **not** also load extension MCPs (`official_aux_with_user_mcp` off) so tools are not stuck behind 30s Playwright timeouts. Does **not** put `auth.json` back into the custom main agent-home. See [model-routing.md](./model-routing.md).

## Route switching (auth isolation)

Grok Build 0.2.x will send **OIDC** when `auth.json` is present — even if the request URL is a custom relay. That produces:

`Unauthorized (401) from https://api.example.com/v1/responses` with `Auth: Oidc`.

Verified working combinations:

| Route | `[models].default` | agent `--model` | agent-home `auth.json` |
|-------|--------------------|-----------------|------------------------|
| Custom relay | provider id (`yunyi`) | **provider id** | **removed** (api_key only) |
| Official | `grok` | catalog id (`grok-4.6`) | **synced** from `~/.grok` |

Host must rebind both sides on every switch and before each ACP spawn (`prepare_route_auth_for_agent` + `agent_spawn_model_id`). Composer catalog `modelId` remains the official selection preference; spawn resolves the channel id separately. **Alternate activate entry:** picking a custom provider row in the composer model menu also calls `providers_activate` (same Host path as Settings **Use**).

## Host commands

| Command | Role |
|---------|------|
| `providers_list` | Providers + default (no raw keys); blocking pool |
| `providers_upsert` | Create/update; empty key keeps previous; recycles warm agents when default/active route changes (`provider_route`) so next send applies without app restart |
| `providers_remove` | Delete section; recycles warm agents |
| `providers_set_default` | Set default model id; recycles warm agents |
| `providers_activate` | Switch official/custom route + rebind auth; recycles warm agents |
| `providers_ping` | `GET {base}/models` RTT |
| `providers_list_models` | Fetch remote model ids |
| `providers_test_model` | Per-model probe: one tiny non-streaming inference request to `{base}/chat/completions` (\| `/responses` \| `/v1/messages` by `api_backend`); success = HTTP 2xx |
| `providers_balance` | Account balance / plan probe (Phase 1: **DeepSeek only**) |
| `providers_cc_switch_scan` | Read-only scan of local **CC Switch** Grok Build providers |
| `providers_cc_switch_import` | Import selected CC Switch rows into custom providers |
| `editors_list` | Detected local IDEs |
| `open_in_editor` | Open path in chosen editor |

### Balance probe (Phase 1: DeepSeek)

| Item | Detail |
|------|--------|
| When | Channel id/host is DeepSeek (`deepseek` / `api.deepseek.com`) — **not** DeepSeek models on OpenCode Go / 火山方舟 |
| Endpoint | `GET https://api.deepseek.com/user/balance` (origin root; strip `/v1` from stored base) |
| Auth | Bearer `api_key` from agent-home (or form draft) |
| UI | Settings → Custom providers **Check balance** (full lines); sidebar footer + UserMenu one-liner `110.00 CNY` when active |
| Cache | Session memory, 5 min TTL; refresh on UserMenu open / explicit button; no disk, no polling |
| Honesty | Never invent `0.00` on failure; amounts stay **strings** |

Wire shape (confirmed):

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

Future providers (Coding Plan quotas, etc.) add adapters under the same `providers_balance` command.

**Live apply (#376):** Do **not** only park the live agent (`session_disconnect`) after provider edits — parked processes keep old OIDC/`config.toml` in memory. Host `recycle_all_agents(..., "provider_route")` after route-affecting writes. Settings UI always clears “Saving…” in `finally` and soft-fails apply errors with a toast (config is already on disk).

## Import from CC Switch (#167)

Settings → Account → Custom providers → **Import from CC Switch**.

| Step | Behavior |
|------|----------|
| Detect | Resolve `cc-switch.db` (see paths below); open SQLite **read-only** |
| Scope | `providers` where `app_type = 'grokbuild'` |
| Preview | Multi-select list (no full API keys; status badges) |
| Import | Map TOML → current agent-home `config.toml`; **same id overwrites** (no UI toggle); does not auto-activate route |
| Native capability | An explicit `app_provider_mode` is honored. Otherwise a Responses provider is promoted to `grok_build_proxy` only when its selected real model advertises `supports_backend_search = true` in the live `/models` response |
| Apply | Any successful import recycles warm ACP children so the next send cannot reuse stale provider semantics |

### CC Switch data paths (cross-platform)

| Priority | Location |
|----------|----------|
| 1 | `GROK_APP_CC_SWITCH_DIR` or `CC_SWITCH_HOME` env (if set and contains db) |
| 2 | Tauri Store override: `app_config_dir_override` in `app_paths.json` under `com.ccswitch.desktop` |
| 3 | **Default:** `{user_home}/.cc-switch/cc-switch.db` (macOS / Windows / Linux) |
| 4 | Windows only: `{HOME}/.cc-switch/cc-switch.db` when Profile default is missing (v3.10.3 legacy) |

Store file locations:

| OS | `app_paths.json` |
|----|------------------|
| macOS | `~/Library/Application Support/com.ccswitch.desktop/app_paths.json` |
| Windows | `%APPDATA%\com.ccswitch.desktop\app_paths.json` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/com.ccswitch.desktop/app_paths.json` |

Official CC Switch rows are not imported as custom relays. Proxy-takeover placeholders (`PROXY_MANAGED`, `127.0.0.1:…`) are rejected.
Capability detection never matches provider names or hosts. Explicit native mode
fails closed when the live catalog cannot validate it; implicit probe failures
preserve the previous generic import behavior.

## Security

- UI only sees `hasApiKey`.
- Logs must redact keys (existing redact paths).
- Official OAuth (`auth.json`) stays separate from relay keys.

## Sponsorship (L3, future)

Recommended catalog / paid naming sits **above** L2 as templates only. Keys always user-owned. See `docs/分析-Grok-Desktop对照报告.md` §7.
