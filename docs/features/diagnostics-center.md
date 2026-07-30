# Diagnostics center

Free-form host errors are classified into product decks (CLI / auth / network / crash) via `classifyErrorMessage` / `resolveErrorDeckCode`.

## Reliability / Observability panel

UI entry points: command palette (`reliability` / observability), Settings → Runtime → Tools, Doctor → Advanced.

Pure assembly: `src/lib/reliabilityCenter.ts` (`buildReliabilityCenter` / `assembleReliabilityCenter`) from:

| Card | Source |
|------|--------|
| Busy sessions | `liveMap` via activity rules (titles from session list) |
| Stall signals | Active soft stall, liveMap `terminalReason: stall`, in-memory hard_end ring |
| Recent errors | Current error-deck banner + in-memory ring of prior cards |

Actions reuse Host APIs: `exportSupportBundle`, open Doctor. Does **not** scrape secrets from logs into the UI. Empty states are explicit when no signals are present.

## Host file logs

On startup the Host enables dual-sink tracing:

| Sink | Location |
|------|----------|
| stderr | When launched from a terminal |
| Daily rolling file | `{app_data}/logs/app.log.YYYY-MM-DD` |

`RUST_LOG` still controls the filter (default `info`). Support bundles and Doctor can pick up the `logs/` directory after a mid-turn failure.

## Tool heartbeat (protocol)

While a turn has open tool call ids, Host emits (about every 25s):

```json
{
  "sessionId": "…",
  "toolCallIds": ["…"],
  "openCount": 1,
  "intervalSecs": 25
}
```

Event name: `session://tool_heartbeat`. Purpose: re-arm stream-stall progress and
give UI/diagnostics an explicit “tools still open” signal without requiring CLI
progress lines. Heartbeats stop if the oldest open tool exceeds 3 hours.
