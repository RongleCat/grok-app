# Remote control security

- IM channels require a non-empty allow-from list before enable (`*` allowed).
- LINE webhook defaults to **127.0.0.1:8081**, loopback bind; optional `allow_external`.
- LINE validates `X-Line-Signature` (HMAC-SHA256).
- Connector bind/exit errors write `lastError` so UI is not a false green "connected".
