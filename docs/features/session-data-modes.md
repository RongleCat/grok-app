# Session data modes

| Mode | Data root | Use when |
|------|-----------|----------|
| Independent (default) | `~/.grok-app` | App-only history |
| Shared | CLI `GROK_HOME` / `~/.grok` | Same sessions as terminal |

## Behaviour

- Switching modes explains risk and recycles live agents.
- CLI session import requires shared mode.
- Importing config from grok-go does not flip mode to shared.

## Verify

1. Independent → import CLI session — error points at shared mode.
2. Switch to shared with confirm → list/import CLI sessions.
3. Switch back — histories do not silently merge.
