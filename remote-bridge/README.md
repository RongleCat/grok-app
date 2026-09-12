# remote-bridge (historical / reference)

> **Deprecated for Grok App runtime — do not extend.**  
> Remote IM connectors now run **in-process in Rust**: `src-tauri/src/remote_im/`.  
> Host does **not** spawn this Node package; it is not part of the pnpm
> workspace, not type-checked in CI, and has no test coverage.

This directory remains as a protocol reference (Feishu long-connection, engine ideas) migrated from agent-connect. Do not install `@ronglecat/agent-connect` for the App. Fixes to Remote IM behavior belong in `src-tauri/src/remote_im/`, not here.

Active path:

- `src-tauri/src/remote_im/channels/` — Feishu WS, Telegram, Discord, Slack, DingTalk, WeCom, generic
- `src-tauri/src/remote_im/engine.rs` — `/p` `/r` / Grok turns
- `src-tauri/src/remote_im/bridge.rs` — start/stop status IPC
