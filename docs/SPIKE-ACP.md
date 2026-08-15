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

## Long-term GUI transport audit (2026-08-15)

**CLI under audit:** Grok Build `1.0.4`.

### Conclusion

Keep ACP as the primary GUI interface. ACP preserves the agent runtime, tool
loop, session store, permission reverse RPC, and semantic streaming events.
The BeefAPI search failure was not an ACP limitation. It was a Grok App adapter
error that launched a Grok Build-compatible relay as a generic `[model.<id>]`
provider alias and therefore hid the remote model catalog capability.

The fix is the explicit `grok_build_proxy` provider mode documented in
`llm-wiki/providers.md`. It binds the native model catalog/proxy environment on
the target ACP child and launches the real model id. Generic providers are not
changed.

### Evidence matrix

Legend: **wire** means an observed or fixture-backed ACP request/event, **CLI**
means Grok Build 1.0.4 help/runtime surface, and **gap** means no fresh isolated
live capture was available in this audit.

| Capability | TUI / headless | ACP and Grok App | Classification |
|------------|----------------|------------------|----------------|
| Dynamic web search | Headless 1.0.4 against isolated BeefAPI produced native `server_tool_use` and a search result when the model catalog env was present. TUI uses the same catalog/runtime, but no fresh interactive TUI wire capture was recorded. | Direct 1.0.4 ACP A/B produced `tool_call` and `tool_call_update` for `web_search` with the native endpoint; provider-alias ACP did not. | App adapter gap, fixed by native relay mode |
| Dynamic X search | Isolated 1.0.4 headless completed native X search. Earlier 1.0.3 repeated runs showed high latency variance. | The same native catalog is exposed to ACP. Fresh post-fix 1.0.4 X wire capture remains a gap because the dedicated token available to this worktree is stale. | Native semantics available; reliability/live rerun gap |
| Client tools | Headless tool calls are native CLI behavior. | ACP emits `tool_call` and `tool_call_update`; Host keeps call id, status, title, input, output, and completion. Golden fixtures and decoder tests cover the loop. | Full native semantic surface |
| MCP | CLI supports configured MCP servers. | Host sends `mcpServers` on `session/new`, `session/load`, and `session/fork`, and can call `_x.ai/session/update_mcp_servers`. | Full core surface plus Grok extension for hot update |
| Parallel tool calls | Isolated 1.0.3 headless observed two pending client calls before either completed. | ACP carries independent tool call ids and updates; Host does not serialize them. No fresh 1.0.4 parallel live capture in this audit. | Protocol complete; current live evidence gap |
| Permission request | CLI permission modes are launch flags. | Agent can reverse-call `session/request_permission`; Host returns the selected option id. Fixtures cover request and reply. Agent policy may auto-execute and omit a request. | Full when the agent emits it |
| Thinking, text, tool streaming | Headless streaming JSON describes native ACP session updates. | Host consumes `agent_thought_chunk`, `agent_message_chunk`, `tool_call`, and `tool_call_update` directly. | Full native semantic surface |
| Session new/load/resume/fork | CLI exposes resume and fork. | Host implements `session/new`, `session/load`, standard `session/fork`, and Grok extension fallback. Journal bootstrap is only a fallback after load failure. | Full, with honest fallback |
| Cancel | CLI can stop an active turn. | Host sends `session/cancel`; deterministic fixture covers the wire and state transition. | Full core surface |
| Disconnect and process restart | Headless per-turn mode naturally exits. TUI owns one process. | Host can recycle the child and reload a persisted agent session. An interrupted in-flight turn is not claimed to resume at the exact token/tool boundary. | Session recovery complete; in-flight continuity gap |
| Attachments and vision | CLI accepts file-path prompt references. | App currently serializes attachments into the text prompt as `@absolute/path`; `session/prompt` carries text content blocks only. This preserves CLI file semantics but does not expose a native ACP image content block. | Current App adapter limitation |
| Background tasks | CLI exposes background waiting/task behavior. | Host decodes `task_backgrounded` and `task_completed` and keeps the tool row open until completion. | Grok extension exposed; fresh live capture gap |
| Subagents | CLI exposes subagent flags and runtime behavior. | Host passes subagent configuration and consumes their tool/task events, but parent-child presentation is partly best-effort because the event stream does not always include stable linkage. | Usable extension with metadata gap |

### Alternatives

| Path | Agent-brain reuse | Session/tool fidelity | Cross-platform and maintenance | Recommendation |
|------|-------------------|-----------------------|--------------------------------|----------------|
| Embed TUI | Reuses CLI | Terminal escape/state scraping, weak semantic UI events | High terminal-emulation and accessibility cost | Do not use as the main GUI path |
| Run `grok -p` each turn | Reuses sampling | Loses warm process, reverse permission flow, semantic live session control, and efficient resume | Simple process launch but poor product semantics | Only for bounded diagnostics or side jobs |
| ACP | Reuses the whole runtime | Semantic requests, updates, permissions, tools, MCP, and sessions | Stable stdio/TCP boundary; portable child process model | Primary path |
| Hybrid | ACP for chat; targeted CLI/headless only for unsupported one-shot operations | Keeps core semantics while allowing narrow fallbacks | Maintainable if fallbacks stay explicit and small | Use only for proven ACP exposure gaps |

### Acceptance boundary

This audit supports ACP as the long-term main interface without reimplementing
the agent brain. It does not claim that every Grok CLI feature is standardized
ACP. Grok extensions remain necessary for MCP hot update, task events, and some
fork/interject behavior. Fresh post-fix production acceptance still requires an
isolated dedicated BeefAPI token for both `grok-4.5` and `grok-4.6`, covering
web search and X search without printing or persisting the token.
