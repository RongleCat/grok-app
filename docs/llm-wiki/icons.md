# App icons vs tray icons

Two **separate** pipelines — never mix them.

| Surface | Source | Outputs |
|--------|--------|---------|
| Dock / taskbar / `.app` / Windows `.exe` | `src-tauri/icons/icon (1).png` (copied as `icon-source.png`) | `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` |
| macOS menu bar | `docs/svg/logo.svg` | `tray-icon.png` (**36×36**, @2x for 18pt bar), `tray-16` / `tray-32`, `tray-source.png` |
| Windows system tray | `docs/svg/logo.svg` → `tray-32.png` | `tray-win-light.png` (black tile, white glyph), `tray-win-dark.png` (white glyph on transparency, no fill tile). Host picks by **taskbar** theme (`SystemUsesLightTheme`) and swaps live. |

## Rules

1. **App / dock** uses the full-color artwork from `icon (1).png` only. Listed in `tauri.conf.json` → `bundle.icon`.
2. **Tray / status bar** uses marks from `logo.svg` only. Embedded in `src-tauri/src/tray.rs` via `include_bytes!`. **macOS**: monochrome template + `icon_as_template(true)` (the bar inverts it). **Windows**: contrast badges (`tray-win-light.png` / `tray-win-dark.png`) — there is no template invert, so a black glyph vanishes on a dark taskbar. Light taskbars keep the black tile; dark taskbars use a **white glyph on transparency** (not a white rounded tile, and not black-on-transparent). Do not follow the in-app theme; follow the taskbar (`SystemUsesLightTheme`).
3. Do not point the tray at `icon.png` or the dock at `tray-*.png`.
4. Menu-bar icons must stay **padded** (~14% margin) and **retina-sized** (36px for 18pt display). Tiny unpadded rasters look like a blob on Retina.

## Close vs Quit

- Window close (traffic light / self-drawn close / `window.close`) → **hide to tray** (`CloseRequested` + `prevent_close` + `tray::hide_to_tray`):
  - **macOS**: main window hides; **Dock icon stays** (`ActivationPolicy::Regular` + `set_dock_visibility(true)`). Do **not** switch to Accessory on user close — that removed the Dock icon and broke click-to-reopen (the pet overlay is skip-taskbar and does not count as the workbench).
  - **Windows**: taskbar button removed via `win_shell::set_main_window_skip_taskbar` (`WS_EX_TOOLWINDOW` + `ITaskbarList::DeleteTab`). Do **not** use bare `set_skip_taskbar` alone — incomplete restore breaks **Show Desktop** when this is the only window.
  - Status bar / system tray icon stays.
  - Headless `--start-in-tray` / fire-due uses `hide_to_tray_accessory` (Dock hidden + Accessory).
- **Windows unread overlay** (opt-in, **default off**, independent of dock/tray `trayBusyBadge`): frontend `tray_set_windows_overlay` uses `WebviewWindow::set_overlay_icon` (16×16 painted badge from `win_taskbar_overlay`). `set_busy_count` does **not** drive the overlay. Do **not** call `set_badge_count` on Windows — Tauri documents it as unsupported and wry no-ops it. Re-apply the last overlay count after AddTab.
- Reopen via **Dock click** (`RunEvent::Reopen` → `show_main_window`) or tray **Open Grok** / menu actions.
- **Windows shell**: `win_shell.rs` sets process AppUserModelID from the bundled `identifier` (release `com.grokapp.desktop`; `pnpm dev` overlay `com.grokapp.desktop.dev`) and re-asserts `WS_EX_APPWINDOW` / `WS_MINIMIZEBOX` / taskbar tab on setup and every show so Explorer **Show Desktop** (taskbar far-right) minimizes the window even when it is alone.
- **Quit Grok** in the tray menu (or app quit) fully exits.

## Window chrome by platform

| Platform | Config file | Title bar |
|----------|-------------|-----------|
| macOS | `tauri.macos.conf.json` | `decorations` + `titleBarStyle: Overlay` + native traffic lights |
| Windows | `tauri.windows.conf.json` | `decorations: false` + self-drawn min/max/close (`WindowControls`) |

Do **not** rely on Overlay / traffic lights on Windows — they are mac-only.

## Regenerate

```bash
./scripts/generate-icons.sh
# Windows badges only (no sips / ImageMagick):
python3 scripts/tray_win_badge.py src-tauri/icons/tray-32.png src-tauri/icons
```

## Tray menu (Codex / ChatGPT style)

Built in `src-tauri/src/tray.rs`:

- **Recent** — up to 8 non-archived sessions (`title · project`)
- **More** — Settings… / Doctor / Account
- **Usage** — disabled status from `account_billing_cache.json`
- **New Chat** / **Open Grok** / **Quit Grok**

Frontend listens for `tray://new-chat`, `tray://open-session`, `tray://open-settings`, `tray://open-doctor` and calls `tray_refresh` after sessions / account updates.
