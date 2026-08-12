# First-run setup gate

Product rules for the **full-screen initialization wizard** before the workbench home.

## Goals

1. **Hard gate:** Grok Build CLI must be found and runnable before entering home.
2. **Soft gate:** Official login / API key / custom relay may be **skipped**.
3. Match app chrome (tokens, logo, dark/light); **no scrollbars** on the gate page.
4. Install uses **multi-mirror** download with retries (same bases as official `install.sh`).

## Flow

```
boot → probe CLI (≤3s per --version; Host spawn_blocking)
  ├─ timeout (FE 12s) → loading chrome + Retry / open Setup (not infinite spin)
  ├─ no CLI → SetupWizard step Runtime (install required)
  ├─ CLI ok + !setupWizardCompleted → Account step (skippable)
  └─ CLI ok + setupWizardCompleted → home
```

### Step 1 — Runtime (cannot skip)

| Action | Host |
|--------|------|
| Detect | `probe_cli` — mac + Windows (see below) |
| Auto install | `cli_install_latest` + event `setup://cli-install-progress` |
| Manual path | `pick_cli_binary` → `manualCliPath` |
| **WSL backend (Windows)** | Settings → Runtime → CLI → **Use WSL for Grok Build** (`cliBackend=wsl`). Spawns `wsl.exe [-d distro] --cd /mnt/… -- grok agent stdio` when the binary exists only inside WSL. Optional `wslDistro` / `wslCliPath`. **ACP server (API mode)** still wins when `acpServerAddr` is set. |
| Fallback | Copy official install command / open docs |

Mirrors (order):

1. `https://storage.googleapis.com/grok-build-public-artifacts/cli` (preferred — more reliable in CN)
2. `https://x.ai/cli`

Each mirror is tried multiple times before failing over.

**Checksum trust:** download is HTTPS-allowlisted; streamed SHA-256 is always computed. If the mirror publishes a sidecar, **mismatch aborts**. Official mirrors currently omit sidecars (same as `install.sh` / `install.ps1`), so **missing checksum is allowed by default** and stored as `checksum_verified: false`. Strict fail-closed: `GROK_CLI_REQUIRE_CHECKSUM=1` (override with Settings → Runtime “Allow unverified CLI install” or `GROK_CLI_ALLOW_UNVERIFIED=1`).

**Trust grades (UI):** pure `src/lib/cliTrustSupplyChain.ts` maps install outcomes to grades `verified` · `missing_sidecar` · `mismatch` · `unverified_allowed` · `unknown` — never invents sidecar presence. Setup shows a risk chip on missing sidecar / mismatch (hard-fail honesty; no force on mismatch). Settings → Runtime shows a trust chip for the last App-managed install; Doctor adds a `cli_checksum` finding when `lastCliChecksumVerified` is known.

### Step 2 — Account (skippable)

OAuth, official key, relay, import CLI / grok-go. No `window.prompt`.

### Step 3 — Ready → Enter

Persists `setupWizardCompleted: true`. If account skipped: `authSetupDeferred: true`.

## Settings fields

| Field | Role |
|-------|------|
| `setupWizardCompleted` | Wizard finished with CLI ready |
| `authSetupDeferred` | User skipped account step |
| `onboardingDone` / `setupSkipped` | Legacy; migrated when CLI present |

## UI

- Component: `src/components/SetupWizard.tsx`
- Styles: `src/styles/setup-wizard.css` (overflow hidden, no scrollbars)
- i18n: `setup.*` keys in `src/i18n/messages.ts`

## Honesty (SETUP-GATE-PRO)

Pure helpers: `src/lib/setupGatePro.ts` (+ tests).

| Rule | Behavior |
|------|----------|
| Hard CLI | `canEnterHome` / boot `resolveSetupGateBoot` never mark **ready** without `cliFound` |
| Soft account | Account step is always skippable; `buildAuthDeferredFlags` never sets deferred when auth is ok |
| Errors | Install/probe/account failures classified (`checksum_missing`, `mirror`, `network`, …) with stable `setup.error.*` titles + recovery hints |
| Ready checklist | Never soft-ok CLI; auth row is soft when skipped |
| Legacy migrate | Older `onboardingDone` / `setupSkipped` + CLI → write `setupWizardCompleted` once |

Checksum: missing sidecar may offer **Install without checksum**; **mismatch never** offers unverified force. Grades + chips: `cliTrustSupplyChain` (`resolveChecksumTrustGrade` / `planInstallWithoutChecksum`).

## CLI probe (mac + Windows)

`cli_probe::probe_cli` must work when the app is launched from Dock / Explorer (sparse PATH):

| Source | macOS | Windows |
|--------|-------|---------|
| Official install | `~/.grok/bin/grok` (+ downloads) | `%USERPROFILE%\.grok\bin\grok.exe` (+ downloads) |
| Package managers | Homebrew `/opt/homebrew`, `/usr/local` | WinGet Links, Scoop shims, Chocolatey |
| PATH | process PATH + enriched PATH scan | same; names `grok.exe` / `.cmd` / `.bat` |
| Manual | `~` expansion | `~` / `%USERPROFILE%` / auto-append `.exe` |
| Home dir | `$HOME` | **`USERPROFILE` first** (not MSYS `$HOME`) |

`--version` is preferred; a runnable binary without version still counts as found.

## Commands

| Command | Role |
|---------|------|
| `probe_cli` | Detect binary (cross-platform) |
| `cli_install_latest` | Download + link into `~/.grok` |
| `cli_install_commands` | Platform shell command + docs URL |
| `pick_cli_binary` | File picker |
| `open_external_url` | Open install docs |

## Managed configuration (enterprise, optional)

Settings → Runtime → **Managed setup** (`ManagedSetupPanel`):

1. **CLI ready** (hard dependency; same as first-run Runtime).
2. **Team login / `GROK_DEPLOYMENT_KEY`** (or `[endpoints].deployment_key`).
3. **Preview** — `grok setup --json` (writes nothing; secrets redacted).
4. **Install** — `grok setup` with in-app confirm (no `window.confirm`); soft-respawns agent.
5. **Verify local status** — host `managed_setup_status` soft-probes:
   - `managed_config.toml` / `requirements.toml` / `managed_config.sig.json` / `managed_identity.sig.json` under active `GROK_HOME`
   - system `/etc/grok/managed_config.toml` when present (Unix)
   - `grok inspect` flags `managedSettingsActive` / `Exists` / `Path` when CLI works
   - **explicit** inspect/doctor signature verification fields when present (`signatureVerified` etc.) → `signatureVerified` + `signatureVerifySource`; otherwise `presenceOnly: true`

Signature UI status (pure `deriveSignatureStatus` / `buildSignatureView`):

| Status | Meaning |
|--------|---------|
| `absent` | No managed artifacts |
| `present_unverified` | Files / inspect flags present; App did **not** crypto-verify |
| `verify_ok` | **Only** when host/CLI/doctor explicitly reported verification success |
| `verify_failed` | CLI rejected signature / envelope, or host reported verified=false |
| `soft_fail` | Probe/inspect unavailable or status unknown |

The App **does not re-verify cryptographic signatures**; path presence and `managedSettingsActive` never invent `verify_ok`. CLI rejects bad signatures before writing. Soft-fail when CLI/inspect is missing.

## OS install caveats (before the wizard)

The setup gate assumes the **desktop package already launches**. OS blocks and update-channel honesty are documented for users in the README — do not invent signature / SmartScreen status in the wizard:

| Topic | Source of truth |
|-------|-----------------|
| macOS Gatekeeper / “damaged” / `xattr -cr` | README → *macOS “damaged” / Gatekeeper* (中文：*macOS 无法打开 / 提示已损坏*) |
| Windows SmartScreen (unsigned / unknown publisher) | README → *Install* → Windows SmartScreen |
| In-app auto-update needs **signed** production builds | [desktop-auto-update.md](../desktop-auto-update.md); unsigned / dev stay on GitHub manual download |

Doctor / Windows day-use checklist may surface related rows but **must not invent** notarization or SmartScreen state.

## Non-goals

- Embedding the CLI binary in the app package (B04).
- Silent download without multi-mirror retry.
- Forcing project selection before home.
- App-side re-implementation of managed-config crypto verification.
- Claiming silent auto-update for unsigned / local builds (see [desktop-auto-update.md](../desktop-auto-update.md)).
