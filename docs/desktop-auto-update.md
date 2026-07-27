# Desktop auto-update

Grok App uses the same **Tauri 2 updater** shape as Minos / Buzz: signed release
artifacts, a rolling `latest.json` endpoint, in-app check/download/install, and
a hard stop of managed agent / mirror / voice / IM processes before binary swap.

## Architecture

```
CI release
  ├── vX.Y.Z                 user-facing installers (DMG / AppImage / NSIS …)
  └── grok-desktop-latest    rolling updater release
        └── latest.json  + per-platform archive + .sig
                 ▲
                 │ check()
        Desktop  tauri-plugin-updater  (release builds only)
                 │ prepare_for_app_update → stop agents / mirror / voice / IM
                 │ install + relaunch
        UI: Settings → About
```

Unsigned / local builds keep the previous GitHub “open release page” path.

## App pieces

| Piece | Location |
|-------|----------|
| Build-time gate | `build.rs` → `cfg(grok_updater_enabled)` when both `GROK_UPDATER_*` env vars are set (crate always linked for ACL) |
| Release conf delta | `scripts/build-release-config.mjs` → `src-tauri/tauri.release.conf.json` (gitignored — always regenerate) |
| Plugin register | `src-tauri/src/lib.rs` (cfg + non-debug only) |
| Platform support | `is_auto_update_supported` — Linux requires AppImage (`APPIMAGE` env) |
| Pre-relaunch teardown | `prepare_for_app_update` — **only after** successful `install()`, never before |
| Frontend state machine | `src/hooks/useUpdater.ts` + `UpdaterProvider` (single path: plugin or GitHub) |
| UI | Settings → About (`AboutUpdateRow`) |
| Capabilities | `updater:allow-*`, `process:allow-restart` |

Local `pnpm dev` / debug builds **never** enable the updater plugin (no
feature, no env), so dev binaries never hit a production endpoint.

### Install / teardown order (P0)

```
download → install() → prepare_for_app_update() → relaunch()
```

If `install()` fails, agents / voice / IM / mirror stay running.

## Secrets (GitHub Actions)

| Secret / variable | Purpose |
|-------------------|---------|
| `GROK_UPDATER_PUBLIC_KEY` | minisign public key embedded in the app |
| `TAURI_SIGNING_PRIVATE_KEY` | minisign private key for signing updater archives |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | password for the private key (empty string OK) |
| Apple signing / notarize secrets | codesign + notarize DMG / .app (recommended for macOS Gatekeeper) |

Generate a keypair once (see [Tauri updater](https://v2.tauri.app/plugin/updater/)):

```sh
pnpm tauri signer generate -w ~/.tauri/grok-app.key
# public key → GROK_UPDATER_PUBLIC_KEY
# private key file contents → TAURI_SIGNING_PRIVATE_KEY
```

## Rolling endpoint

```text
https://github.com/<owner>/grok-app/releases/download/grok-desktop-latest/latest.json
```

Publish two GitHub releases per cut:

1. **`vX.Y.Z`** — human installers + notes
2. **`grok-desktop-latest`** — updater archives + `latest.json` (clobber each release)

## Build steps (outline)

```sh
export GROK_UPDATER_PUBLIC_KEY=...
export GROK_UPDATER_ENDPOINT=https://github.com/<owner>/grok-app/releases/download/grok-desktop-latest/latest.json
export TAURI_SIGNING_PRIVATE_KEY=...
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...

# 1) Write tauri.release.conf.json (gitignored — required before --config)
node scripts/build-release-config.mjs

# 2) Same GROK_UPDATER_* env must still be set so build.rs enables registration
pnpm tauri build --config src-tauri/tauri.release.conf.json
```

Without step 1, `tauri build --config src-tauri/tauri.release.conf.json` fails with
file not found. The crate is always a hard dependency (Tauri ACL); only
**registration** is gated by the env cfg.

After all platforms upload assets to `vX.Y.Z`:

```sh
TAG=v0.1.9 REPO=<owner>/grok-app bash scripts/assemble-updater-manifest.sh
```

Platform keys: `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64`.

## Linux note

Only **AppImage** supports in-app update. `.deb` / `.rpm` installs see
`manual-required` and open the GitHub releases page.

## macOS note

Codesign + notarize the `.app` / DMG in CI when Apple secrets are present.
After notarization, rebuild the updater `.tar.gz` from the signed app and
re-sign with the Tauri updater key (same pattern as Buzz) if you notarize
post-build.

## Manual verification

1. `pnpm typecheck` / `pnpm test` — UI unit tests
2. `cargo test --manifest-path src-tauri/Cargo.toml updater::` — Rust helpers
3. Settings → About shows **manual GitHub check** on local builds (expected)
4. Release smoke: build with both env vars, confirm `is_updater_plugin_enabled`
   is true in a release binary, and that check hits `latest.json`
