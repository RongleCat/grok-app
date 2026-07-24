# ACP golden fixtures

Deterministic wire samples for the Host ACP surface (`acp_client`, `mock_acp`,
permission option mapping). Exercised by `src/acp_golden_test.rs` via
`cargo test --lib acp_golden` — **no network, no real CLI**.

| File | Covers |
|------|--------|
| `handshake_initialize.json` | Host `initialize` params |
| `stream_chunks.json` | `session/update` thought + assistant chunks |
| `stop_cancel.json` | Host `session/cancel` + mock stop done shape |
| `permission_request.json` | `session/request_permission` + `pick_option_id` |
| `ask_user_question.json` | `_x.ai/ask_user_question` parse + replies |
| `exit_plan_mode.json` | `_x.ai/exit_plan_mode` + plan sessionUpdate |
| `mock_stream.json` | In-process mock token stream for prompt `hi` |

## When to update

Update fixtures **in the same PR** as any change to:

- `wire_*` / `decode_*` helpers in `src/acp_client.rs`
- `mock_reply_for` / `chunk_text` / stream spawn in `src/mock_acp.rs`
- `pick_option_id` mapping in `src/permission.rs`
- Protocol notes in `docs/SPIKE-ACP.md`

CI runs the full `cargo test` suite on every PR; the golden module is required
for ACP protocol changes.

## How to regenerate

From repo root (or `src-tauri`):

```bash
# 1. If mock reply text or chunk size changed, recompute mock_stream.json:
cd src-tauri
cargo test --lib acp_golden::mock_stream_matches_fixture -- --nocapture

# 2. Failures print expected vs actual. For mock chunks, run:
cargo test --lib acp_golden::print_mock_stream_chunks -- --ignored --nocapture
# then paste the JSON array into mock_stream.json → expectedChunks / expectedFullText.

# 3. For host wire builders, adjust the matching *.json hostRequest / hostReply*
#    fields to equal the `wire_*` functions (tests assert equality either way).

# 4. Re-run:
cargo test --lib acp_golden
```

Do **not** hand-edit fixtures to “make CI green” without updating production
builders/parsers — the suite is the contract.
