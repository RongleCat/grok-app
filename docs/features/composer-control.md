# Composer control bar

Model and reasoning effort for the chat in view.

## Behaviour

- Switching model calls ACP `session/set_model` on the live agent and persists prefs.
- Effort is stored and applied on next agent connect (CLI has no mid-turn effort RPC).
- Failures surface as toasts instead of silent no-ops.

## Verify

1. Open a live chat, switch model — next turn uses the new model (or toast on failure).
2. Switch effort — agent soft-respawns; subsequent work uses the new effort.
3. Invalid model ids are rejected in the UI catalog.
