# Remote control security

- Phone mirror defaults to **read-only**; enable “Allow phone to send” for writes (in-app confirm + persistent warning banner while write is on).
- Phone mirror HTTP **defaults to loopback** (`127.0.0.1`). Same-LAN access is opt-in (“Allow same Wi-Fi”, in-app confirm) and rebinds `0.0.0.0`; copy/QR then use the detected LAN IPv4. Token path still required; HTTP stays unencrypted.
- While write is on, the Connect panel lists **allowlisted write RPC categories** and shows a **broad-surface** warning (full allowlist is open; filesystem / desktop-only commands stay blocked).
- Optional **max phone clients** (1–16, default 4): extra WebSocket upgrades get HTTP 503 (soft-fail). Connect panel shows a live cap bar/chip, full/near-full honesty, zero-client empty state when host is up, and never invents clients while stopped.
- Toggling write access writes an audit line to `app.log` (no tokens/URLs). Local write-ACL audit ring (localStorage) also records enable/disable, rotate, host start/stop — never secrets.
- **Regenerate link** requires in-app confirm (mentions connected client count), rotates the token, disconnects old QR sessions; host logs `token_tail` only.
- Auth rejection and host start logs **redact** path tokens / public URLs (`/t/<redacted>/…`, `token_tail`).
- IM allow-from and LINE signature checks ship in 0.1.9+.

## Security ops surface (overview)

Settings → **Remote control** → **IM** → Bridge overview shows a unified **Security ops** checklist (pure helpers in `src/lib/remoteSecurityOps.ts`):

| Check | Honesty |
|-------|---------|
| Allow-from ACL | Aggregate open (`*`) / restricted / empty across channel instances; link to edit allow-from |
| Inbound rate limit | Soft per-chat + global limiter is always-on in-process; rate-hit posture is warn, never silent drop |
| Bridge health | Listening / degraded / error / stopped from host status |
| Phone mirror write | Default off (read-only); warn when write is enabled |
| Remote YOLO | Off by default; enable requires GlassModal confirm |
| Live claim | Never invent live WS/Gateway without Bridge linked |

- **Copy summary** exports a redacted multi-line report (no tokens/URLs).
- **Dangerous-write confirms** inventory lists known in-app confirms (mirror write / LAN bind / rotate / stop / audit clear · remote YOLO · channel delete · timeline clear) — all GlassModal / `setAppDialog`, never `window.confirm`.
- Risk badge: `ok` · `warn` · `danger` (open ACL + write, or write + auth error → danger).
