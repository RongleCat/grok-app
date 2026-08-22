#!/usr/bin/env bash
# Launch `pnpm dev` (white dock icon) from a real Terminal so it is not
# inherited from a Grok-agent sandbox.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_HOME="$ROOT/.cargo-home"
export CARGO_TARGET_DIR="$ROOT/src-tauri/target"
export PATH="$ROOT/node_modules/.bin:$PATH"
# Keep app data *outside* the repo. Host heartbeats inside the tree make Vite
# full-reload the WebView and the splash never settles.
export GROK_APP_HOME="${GROK_APP_HOME:-${TMPDIR:-/tmp}/grok-app-dev-home}"
mkdir -p "$GROK_APP_HOME/logs"
SEED="$ROOT/.grok-app-dev-home/settings.json"
if [[ -f "$SEED" && ! -f "$GROK_APP_HOME/settings.json" ]]; then
  cp "$SEED" "$GROK_APP_HOME/settings.json"
fi
cd "$ROOT"
# --no-watch: cargo rebuilds of src-tauri would remount the splash in a loop.
exec node node_modules/@tauri-apps/cli/tauri.js dev --config src-tauri/tauri.dev.conf.json --no-watch
