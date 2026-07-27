# Diagnostics center

Stable error classes and CLI install trust signals.

## Four product classes

| Class | User action |
|-------|-------------|
| CLI not found | Open Doctor / set CLI path |
| Auth failed | Open Account / Providers |
| Network / provider | Reconnect or check relay |
| Agent crashed | Reconnect session |

Free-form host messages are classified when codes are missing.

## CLI install

Install progress reports when no published checksum is available.
`GROK_CLI_REQUIRE_CHECKSUM=1` refuses unverified installs.

## Verify

1. Point CLI path at a missing binary — deck suggests Doctor, not “auth failed”.
2. Use a bad API key — auth deck, not “CLI not found”.
3. Install CLI without checksum sidecar — progress mentions unverified allowlist path.
