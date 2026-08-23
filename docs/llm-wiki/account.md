# Official Grok Build account

Product rules for **official login, membership, quota, and usage** in Grok App.

## Goals

1. Sign in with the **same** Grok Build CLI auth (`grok login`), not a parallel OAuth stack.
2. Show account + membership at two depths:
   - **User menu sheet** (sidebar footer click): compact identity, plan, quota bar, login/logout, jump to settings.
   - **Settings → Account**: full profile, subscription, quota, token activity heatmap, recent session call logs, CLI path, Doctor.
3. Never log tokens, API keys, or `auth.json` secrets (redact).

## Auth sources (priority for “connected”)

| Channel | Source | Notes |
|---------|--------|--------|
| `official_oauth` | `~/.grok/auth.json` via `grok login --oauth` / `--device-auth` | Preferred for membership + billing |
| `official_key` | App secrets `officialApiKey` (OS keychain preferred; `secrets.json` fallback) | CI / paste key; limited billing |
| `relay` | App secrets relay base + key (key in OS keychain preferred) | Custom OpenAI-compatible |
| `none` | — | Prompt login |

CLI auth is shared with Grok Build TUI (hot-reload of `auth.json` is CLI-side).

### Independent mode gotcha (fixed)

| Step | Path |
|------|------|
| `grok login` / App login | writes `~/.grok/auth.json` |
| Agent spawn (`session_data_mode=shared`, product default) | `GROK_HOME=~/.grok` |
| Agent spawn (`session_data_mode=independent`) | `GROK_HOME=~/.grok-app/agent-home` |

Host **must** sync `auth.json` into agent-home on login and before each ACP spawn **when the official route is active**; otherwise the UI shows signed-in while the agent reports `auth_kind=none` → HTTP 401. Logout clears both copies.

**Custom route + official login:** keep `~/.grok/auth.json` (billing / official-aux) but do **not** copy it into the custom main agent-home, and do **not** call ACP `authenticate(cached_token)` on that process. `cached_token` reads `~/.grok/auth.json` even when `GROK_HOME` is agent-home; Grok Build then sends OIDC to the relay (`HTTP 400 Incorrect API key` / 401). Symptom: relay works until the user signs in, and works again immediately after logout.

### Warm process recycle after auth change

Syncing the file is not enough while multi-session **parked** / **prewarm** CLI processes still hold credentials loaded at spawn time. Connect prefers a Ready prewarm when policy/effort/route match.

| Event | Host action |
|-------|-------------|
| Login success | `prepare_route_auth_for_agent` (official sync / custom clear) + `recycle_all_agents(..., "account_auth")` |
| Logout | clear agent-home auth + `recycle_all_agents(..., "account_auth")` |
| Multi-account switch | snapshot → `~/.grok/auth.json` + `prepare_route_auth_for_agent` + `recycle_all_agents(..., "account_auth")` |
| Provider route activate | `prepare_route_auth_for_agent` + `recycle_all_agents(..., "provider_route")` |

`recycle_all_agents` drains **live + background + parked + prewarm**. Do **not** use `session_disconnect` alone after login (that only parks and leaves prewarm alive).

### Multi-project switch re-login (#525 / #528)

| Failure mode | Fix |
|--------------|-----|
| agent-home empty/stale after custom route, UI reads it as signed-out | `read_auth_profile` prefers **better** of agent-home vs `~/.grok` (signed-in → refresh → not expired → canonical) |
| mtime-only sync skipped restore of good `~/.grok` over newer empty agent-home | `sync_cli_auth_to_agent_home` compares **bytes** |
| Process reuse gate used `is_custom_provider_id(modelId)` — custom sessions store **upstream** model ids, so custom processes looked "official" and were reused after auth strip | Store `custom_route` on `AcpClient` at spawn from `active_route()`; gate uses that |
| Warm reuse skipped `prepare_route_auth` | Connect warm path re-runs `prepare_route_auth_for_agent` before `session/load` |
| Official `authenticate(cached_token)` soft-fail left process with no OIDC | Official path re-syncs auth and **retries authenticate once** |

### AUTH_FAILED UI subtypes (Error Deck)

Host may still emit `AUTH_FAILED`. The App banner refines with error text + `providers_list.activeSource`:

| Deck code | Typical signal | Primary recovery |
|-----------|----------------|------------------|
| `AUTH_NO_CONTEXT` | `no auth context` / `auth_kind=none` | Account re-login + **Reconnect** (fresh agent) |
| `AUTH_API_KEY` | Incorrect / invalid API key (often HTTP 400) | Providers / Account keys |
| `AUTH_CUSTOM_PROVIDER` | Active route is **custom** | Providers (key / switch Official) — **not** “only re-login” |
| `AUTH_FAILED` | Other 401 / expired | Account + Providers |

Never tell the user that official OAuth alone fixes a bad custom relay key.

## Host commands

| Command | Role |
|---------|------|
| `account_status` | Profile (redacted) + channel + billing snapshot + local heatmap + call logs |
| `account_login` | Spawn `grok login --oauth` or `--device-auth` |
| `account_logout` | Spawn `grok logout` (fallback: remove auth.json) |
| `account_open_usage` | Open `https://grok.com/?_s=usage` |
| `account_open_subscribe` | Open SuperGrok / subscription manage URL |
| `accounts_list` / `account_save_current` / `account_switch` / `account_remove` | Multi-account snapshots under `~/.grok-app/accounts/` |
| `accounts_quota` | Best-effort SuperGrok remaining % for every saved snapshot (parallel; never invent 0% / 100% on probe failure) |
| `session_import_transcript(_file)` | Import markdown/JSON chat into a new local session |

### Multi-account

- After successful login, Host **auto-snapshots** auth into `accounts/<id>/auth.json`.
- Switch copies snapshot → `~/.grok/auth.json` + agent-home, then disconnects live ACP.
- UI: the sidebar **user menu** lists saved official accounts (honest remaining %, click → `account_switch`). Clicking the active row still opens **Settings → Account**. Custom-provider / signed-out cards stay unchanged. Settings → Account keeps the full switcher / remove / rename UI.
  **「添加账号」** saves the current profile (if signed in) then starts OAuth login.

### Login failures (Access denied)

xAI may refuse device-code generation on some networks. Product response:

1. Surface long-form error + tips (VPN / device code / custom provider).
2. Prefer **Device code** path when OAuth fails; auto-open verification URL when CLI prints it.
3. Do not invent a parallel OAuth — always go through Grok Build CLI.

### Browser “copy code into Grok Build” page (optional fallback)

**Default path is unchanged:** browser OAuth / device poll finishes automatically; App only waits for `grok login` exit + `auth.json`. No paste required.

Some auth.x.ai sessions (not always) show a long code and ask to **paste into Grok Build**. Optional handling only:

1. While login is in progress, Account panel shows a **collapsed** “paste code?” toggle — expand only if that page appears.
2. Host keeps `grok login` stdin open but **writes nothing** unless the user submits.
3. `account_login_submit_code` feeds one line when needed; auto OAuth is not blocked or replaced.
4. Do not refresh the browser page while waiting.
5. If paste is missed and login times out: start sign-in again, or use **Device code** (CLI shows code → enter on website).

### Conversation import (not Grok.com cloud history)

Grok Build CLI does **not** expose grok.com web history. Supported migration:

- Settings → Account → **Recent sessions**: **Import & open** on a row, or **Import listed** for the visible table. Row `id` is the CLI agent session id; Host `cli_session_import` copies `chat_history.jsonl` into an App journal (idempotent if already linked). Host `validate_agent_session_id` rejects empty / path / `..` ids before any session-dir join (same helper as CLI session delete).
- Settings → General → App → **CLI sessions**: search / import all (cap 50) / open linked chats.
- Sidebar empty state: **Import from Grok Build** when local call logs exist and the sidebar has ≤1 unarchived chat.
- Settings → Account → **Import conversation** (`.md` / `.json` / `.txt`)
- Formats: `## User` / `## Assistant` markdown, or JSON `[{role,content}]`

CLI import may add an **untrusted** App project for the session cwd (skips `$HOME`, `/`, and shallow paths). Trust still requires the usual project confirm.

## Settings IA

- **Account** (`settings.nav.account`): profile, SuperGrok quota, heatmap, call logs only.
- **CLI / Runtime** (`settings.nav.runtime`): binary path + Doctor — **not** mixed into Account.

## Billing / quota (aligned with grok-go)

Primary path (same as grok-go `quota.rs`):

- `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`
- Body: empty gRPC-web frame `00 00 00 00 00`
- Headers: Bearer OAuth token + `Content-Type: application/grpc-web+proto`, `x-grpc-web: 1`, `Origin/Referer: grok.com`

Fallback (confirmed live JSON):

- `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with `x-grok-client-mode: cli`
- Nested `config.creditUsagePercent`, `productUsage[]`, period start/end

### Subscription tier (brand-facing)

Quota endpoints **do not** return SuperGrok vs SuperGrok Heavy. Fetch in parallel with quota:

| Source | Field | Example |
|--------|-------|---------|
| `GET …/v1/settings` | `subscription_tier_display` | `"SuperGrok Heavy"` (preferred UI string) |
| `GET …/v1/user?include=subscription` | `subscriptionTier` | `"SuperGrokPro"` (API enum → Heavy) |
| JWT claim `tier` | numeric | soft fallback only (`≥5` → Heavy, `≥2` → SuperGrok) |

Never invent `"SuperGrok"` for paywall bodies (GrowthBook whitelist uses official enums). Map enums only for **display** / brand SVG selection.

- `subscriptionTier` → `BillingSnapshot.subscriptionTier` (display label)
- Empty-session brand: `SuperGrokMark` (`supergrok` \| `heavy`) above the floating composer
- **Custom relay active** (`providers` `activeSource === "custom"`): always show plain **SuperGrok**, never Heavy (Heavy is official membership branding only)
- Assets: `docs/svg/SuperGrok.svg`, `docs/svg/SuperGrokHeavy.svg` (Heavy badge via CSS `data-theme`, not Tailwind `dark:`)

UI shows **remaining %** (100 − used), product tags, reset time — same semantics as grok-go Accounts.

Cache successes under `~/.grok-app/account_billing_cache.json`.

### Auto-refresh (10 minutes)

Official SuperGrok quota is re-probed **every 10 minutes** in the background (plus on boot, opening Settings → Account, opening the user menu, login / switch, and the manual **Refresh quota** button). The same `account` snapshot feeds:

- Settings → Account
- Sidebar footer + user-menu sheet (bottom-left)
- Tray **Usage** line (`account_billing_cache.json` after `tray_refresh`)
- Usage-limit modal (picks the newer `billing.fetchedAt`)

Background ticks are **quiet** (no spinner) and **billing-only** (`include_local_usage=false` — skip the heatmap / call-log walk). Soft-fail keeps the last snapshot; never invent remaining %. Unmount / disable **disposes** the interval and `visibilitychange` listener and drops in-flight Host replies (`isCurrent`) so they cannot `setState` on a dead tree.

### Chat turn when included usage is exhausted

Official `429` + `subscription:free-usage-exhausted` is **terminal**. Grok Build CLI shows **“You hit your free usage limit.”** (and the provider sentence “You've used all the included free usage…”). Host must abort the provider retry loop immediately and emit `QUOTA_EXCEEDED` with that sentence family. Do **not** record it as `NETWORK_PROVIDER` / “Provider request failed after N attempts”. A bare 429 without exhaustion text is a different CLI card: **“Rate limited”** / “The service is busy. Wait a minute and send again.” Transient relay flaps still retry. The free-usage deck primary action is Account.

## Heatmap & call logs

- Heatmap UI ported from grok-go `components/heatmap.tsx` (GitHub green levels, month labels, tooltip).
- Stats strip (Codex-style): total / peak tokens, longest chat, current + longest streak. Views: day · week · cumulative (running-total cell color).
- Data: local `~/.grok/sessions/**/signals.json` → `requests` / `tokens` for ~371 days (not SuperGrok billing).
- Call logs: recent sessions with model, turns, usage tokens, context occupancy, duration, mtime.

## UI copy

All strings via `src/i18n/messages.ts` (`account.*` keys). See [i18n.md](./i18n.md).

## Security

- Profile DTO never includes `key` / `refresh_token` / raw access tokens.
- Login stdout/stderr must not be dumped to app logs if they may contain secrets.
- Doctor / export still go through existing redact paths.
