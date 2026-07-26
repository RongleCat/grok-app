# SPIKE · Grok Build ACP (`grok agent stdio`)

**Date:** 2026-07-21  
**CLI:** `grok 0.2.106` (`/Users/ronglecat/.grok/bin/grok`)  
**Host:** macOS arm64

## Handshake (proven)

```text
→ initialize { protocolVersion: 1, clientInfo, capabilities }
← result { protocolVersion: 1, agentCapabilities, authMethods, _meta.agentVersion }
→ session/new { cwd, mcpServers: [/* enabled MCP from Extensions prefs + grok mcp list */] }
  or session/load { sessionId, cwd, mcpServers: [...] }  // App: resume prior agentSessionId when possible
  // Empty only when no servers discovered or all disabled in Settings → Extensions
← result { sessionId, models }
→ session/prompt { sessionId, prompt: [{type:"text", text}] }
  // App: if load failed and journal has turns, first prompt may be prefixed with history bootstrap
← session/update agent_thought_chunk* + agent_message_chunk*
← result { stopReason: "end_turn", ... }
```

Optional: `authenticate { methodId: "cached_token" }` uses `~/.grok/auth.json`.

## Stream events observed

| sessionUpdate | Meaning |
|---------------|---------|
| `agent_thought_chunk` | Reasoning stream (fold in UI) |
| `agent_message_chunk` | Assistant text stream |
| `available_commands_update` | Slash commands |
| `tool_call` / `tool_call_update` | Tool lifecycle (when tools used) |

Client must handle server→client RPC: `session/request_permission` (allow/deny options).

### `_x.ai/ask_user_question` (Host UI)

Agent reverse-request when the `ask_user_question` tool needs answers. Wire method is `_x.ai/ask_user_question` (leading `_` on the wire).

- **Params (flat):** `{ sessionId, toolCallId?, questions: [{ question, options, multiSelect? }] }` — also accepts a single flat `{ question, options|choices }` form.
- **Host:** parse → `AcpEvent::AskUserQuestion` → emit `session://ask_user` → App GlassModal.
- **Reply (`session_resolve_ask_user`):**
  - Accepted: `{ "outcome": "accepted", "answers": { "<question>": "<answer>" }, "partial_answers": {} }`
  - Dismiss: `{ "outcome": "cancelled" }`

## Stop

`session/cancel { sessionId }` cancels in-flight prompt; Host maps to FSM Streaming→Ready.

## Auth methods

- `cached_token` — existing CLI login  
- `grok.com` — interactive OAuth (not used by App in P0; prefer key/import)

## Models / effort

`session/new` returns `models.currentModelId` (e.g. `grok-4.5`) and `reasoningEfforts` (high/medium/low).

## App contract

- Default transport: real `grok agent stdio`  
- Mock only if `GROK_APP_ACP=mock`  
- Independent data root: `~/.grok-app` (sessions/projects); CLI auth may still live in `~/.grok`

## Tool write + permission note (2026-07-21)

- `session/prompt` can drive a real **write** tool; files under cwd are created (`SPIKE_PERM*.txt`).
- This host’s `~/.grok/config.toml` has `permission_mode = "always-approve"` / session `yolo` often true → Agent **may not emit** `session/request_permission` and auto-executes tools.
- With isolated `GROK_HOME` + `permission_mode = "ask"` + `yolo = false`, writes still completed **without** `session/request_permission` on CLI 0.2.106 (Agent-side policy). Host still implements full request_permission response path + optionId mapping (`allow_once` / `allow_always` / `reject_once`) for when the Agent does emit it.
- Host **must** still gate session-allow via `is_outside_project` (wired in `may_auto_allow`).

## Evidence

- Handshake + `PONG_SPIKE` / `M01_OK` stream logs.
- Tool write: `.spike-proj/SPIKE_PERM*.txt`.
- Host permission unit/integration: `cargo test permission` / `permission_host_test`.
- Host ask_user parse unit tests: `cargo test ask_user_question`.

## Golden fixtures (T06 · required for ACP changes)

Protocol regression samples live under:

```text
src-tauri/tests/fixtures/acp/
```

| Fixture | Asserts |
|---------|---------|
| `handshake_initialize.json` | Host `initialize` params (`wire_initialize_params`) |
| `stream_chunks.json` | `session/update` thought + assistant → `decode_session_update` |
| `stop_cancel.json` | `session/cancel` params + mock mid-stream stop done chunk |
| `permission_request.json` | `decode_permission_request` + `pick_option_id` + reply envelopes |
| `ask_user_question.json` | `parse_ask_user_question_params` + Host replies |
| `exit_plan_mode.json` | plan update decode + `wire_exit_plan_mode_result` |
| `mock_stream.json` | `mock_acp` deterministic chunks for prompt `hi` |

**CI:** `.github/workflows/ci.yml` `cargo test` runs the suite on every PR (macOS / Windows / Linux). Any ACP wire or mock change **must** keep `cargo test --lib acp_golden` green.

**Regenerate** when the protocol or mock reply drifts — see  
[`src-tauri/tests/fixtures/acp/README.md`](../src-tauri/tests/fixtures/acp/README.md):

```bash
cd src-tauri
cargo test --lib acp_golden
# mock chunks only:
cargo test --lib acp_golden::print_mock_stream_chunks -- --ignored --nocapture
```
