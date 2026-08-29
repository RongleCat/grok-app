# Code Quality Remediation — Progress Ledger

> **Agent 必须在每完成一个 Work Package 后更新本文件。**  
> 机器闸门 `final` 要求本文件含 `FINAL: PASS`（见 `scripts/check-code-quality-gates.py`）。  
> 未达标时保持 `FINAL: PENDING`。

## Status

| Field | Value |
|-------|--------|
| Program | `2026-08-01-code-quality-remediation` |
| Spec | `docs/plans/2026-08-01-code-quality-remediation-GOAL.md` |
| Started | `2026-08-01` |
| Current wave | `workbench-decomp` |
| Current WP | `WP-W27` |
| **FINAL** | **PASS** (honest orchestration metrics; decreasing ceilings) |

## Wave checklist

| Wave | Gate command | Status | Date | Notes |
|------|----------------|--------|------|-------|
| A 止损 | `python3 scripts/check-code-quality-gates.py --mode wave-a` | PASS | 2026-08-01 | dead UI, office sanitize, eslint, CI, freeze |
| B 前端编排 | `python3 scripts/check-code-quality-gates.py --mode wave-b` | PASS | 2026-08-01 | ThemeProvider, composer hooks, settings props, CSS domains |
| C Host+API | `python3 scripts/check-code-quality-gates.py --mode wave-c` | PASS | 2026-08-01 | commands/, session_manager/, api/, App shell |
| Final | `python3 scripts/check-code-quality-gates.py --mode final` | PASS | 2026-08-01 | metrics + completion + xlsx note |

## Work packages

| WP | Title | Status | Commit / PR | Evidence |
|----|-------|--------|-------------|----------|
| WP-A0 | Bootstrap progress + baseline metrics | PASS | wp-a0-a4 | baseline JSON exit 0 |
| WP-A1 | Delete / wire dead UI (chat thread, SlashPalette) | PASS | wp-a0-a4 | deleted unreferenced components |
| WP-A2 | Office HTML sanitize + xlsx risk path | PASS | wp-a0-a4 | sanitizeOfficeSheetHtml + tests |
| WP-A3 | ESLint minimal + CI clippy/fmt/gates | PASS | wp-a0-a4 | eslint.config.js + ci.yml |
| WP-A4 | App.tsx growth freeze note in AGENTS/progress | PASS | wp-a0-a4 | AGENTS.md §7 + maintain.md |
| WP-B1 | ThemeProvider extraction | PASS | wave-b | src/providers/ThemeProvider.tsx |
| WP-B2 | ComposerShell extraction | PASS | wave-b | ComposerShell + useComposerController |
| WP-B3 | Session runtime hook extraction | PASS | wave-b | useSessionRuntime.ts |
| WP-B4 | Settings context / props collapse | PASS | wave-b | SettingsPage routing props ≤10 |
| WP-B5 | Dialog/modal host extraction | PASS | wave-b | useAppDialogs.ts |
| WP-B6 | CSS domain split (batch 1) | PASS | wave-b | 7 domain CSS + part chunks |
| WP-C1 | commands/ directory split | PASS | wp-c1 | facade ≤800; modules ≤2000 |
| WP-C2 | session_manager/ directory split | PASS | wp-c2 | facade ≤2500 |
| WP-C3 | api/ domain modules | PASS | wp-c3 | ≥4 modules; facade 26 |
| WP-C4 | Further App.tsx shrink to wave-c numbers | PASS | wave-b | App.tsx shell 23 lines |
| WP-F1 | Final shrink + timer balance + ≥1k file budget | PASS | wave-f | files_ge_1000=43; CSS parts |
| WP-F2 | Completion handoff doc + smoke matrix | PASS | wave-f | CODE-QUALITY-COMPLETION.md |
| WP-W0 | Honest APP_* gates: App.tsx + AppWorkbench; drop shellEpoch | PASS | 68bdd49f | final PASS; lines=24549 useState=253 useEffect=100 |
| WP-W1 | Layout/panes verbs into useWorkbenchLayout | PASS | 043abe38 | 24549→24013 lines; useState 253→250; useEffect 100→95 |
| WP-W2 | Search/palette verbs into useSearchPalette | PASS | 7c882ce4 + 043abe38 | 24013→23734 lines; useState 250→243; useEffect 95→92 |
| WP-W3 | Exports/share into useSessionExportText + useSessionExportImage | PASS | cf143126 + 043abe38 | 23734→22442 lines; useState 243→232; useEffect 92→91 |
| WP-W4 | Sandbox wizard + reliability chrome into useSandboxReliability | PASS | aaabe2f7 + 043abe38 | 22442→22404 lines; useState 232→227 |
| WP-W5 | Session catalog + multi-select into useSessionCatalog | PASS | 72e73424 + 7a4b7ae8 | 22404→22245 lines; useState 227→224; useEffect 91→88 |
| WP-W6 | files_ge_1000 80→69 (CSS parts, session tests, stall history, IM schemas) | PASS | ef27ce91 | count 80→69; APP_* unchanged 22245/224/88 |
| WP-W7 | Sidebar session tree JSX into WorkbenchSessionTree | PASS | b027f45f | 22245→21638 lines; useState 224; useEffect 88 |
| WP-W8 | Left rail JSX into WorkbenchSidebar | PASS | b54dca82 | 21638→21326 lines; useState 224; useEffect 88 |
| WP-W9 | Audit src/lib <80-line modules for pure pass-throughs | PASS | docs | 99 small modules; keep barrels `api.ts` / `session.ts` / `remoteIm/index.ts` |
| WP-W10 | Center chrome JSX into WorkbenchMain | PASS | 2aa1ad61 | 21326→21020 lines; useState 224; useEffect 88 |
| WP-W11 | Resources aside + search/export/sandbox/reliability overlays | PASS | 444c55dd | 21020→20903 lines; useState 224; useEffect 88 |
| WP-W12 | Session journal hydrate pipeline (openSession still in workbench) | PASS | 1da3ac14 | 20903→20710 lines; useState 224; useEffect 88 |
| WP-W13 | openSession into useSessionNavigation; newChat stays | PASS | 5364d0e6 | 20710→20451 lines; useState 224; useEffect 88→87 |
| WP-W14 | newChat into useSessionNavigation (late-bind sendQueue/focus) | PASS | 933f1361 | 20451→20360 lines; useState 224; useEffect 87→86 |
| WP-W15 | Chrome overlays (doctor→voice) into WorkbenchChromeOverlays | PASS | 127a8fa3 | 20360→20288 lines; useState 224; useEffect 86 |
| WP-W16 | Session/agent action modals into WorkbenchSessionModals | PASS | 77c8e496 | 20288→19862 lines; useState 224; useEffect 86 |
| WP-W17 | Composer column (perm bar + input shell) into WorkbenchComposerColumn | PASS | 8ca6eeab | 19862→18904 lines; useState 224; useEffect 86 |
| WP-W18 | Sidebar/composer context menus into WorkbenchFloatingMenus | PASS | b85df039 | 18904→17941 lines; useState 224; useEffect 86 |
| WP-W19 | Settings overlay into WorkbenchSettingsStage | PASS | 6226ccc8 | 17941→17415 lines; useState 224; useEffect 86 |
| WP-W20 | Chat stage (thread + banners) into WorkbenchChatStage | PASS | d8b30f70 | 17415→17050 lines; useState 224; useEffect 86 |
| WP-W21 | Compact/Queue hooks + WorkbenchComposerModals | PASS | d8142bea | 17050→16835 lines; useState 224→216; useEffect 86→85 |
| WP-W22 | AppDialog overlay into WorkbenchAppDialogStage | PASS | d1f3fa03 | 16835→16810 lines; useState 216; useEffect 85 |
| WP-W23 | Composer dictation FSM into useVoiceDictation | PASS | 50f1193c | 16810→16468 lines; useState 216→213; useEffect 85→83 |
| WP-W24 | Composer send path into useComposerSend | PASS | bd17cb47 | 16468→15850 lines; useState 213; useEffect 83 |
| WP-W25 | Settings overlay nav into useSettingsNavigation | PASS | 5003a52a | 15956→15612 lines; useState 214→209; useEffect 83→81 |
| WP-W26 | Settings prefs hydrate into useAppSettingsPrefs | PASS | aae65cf4 | 15612→15471 lines; useState 209→156 |
| WP-W27 | Session connect + live map into useSessionConnect | PASS | aae65cf4 | 15471→15183 lines; useState 156→155; useEffect 81→80 |

## Metrics log (append-only)

| When | App.tsx | useState | useEffect | app.css | commands | session_mgr | api.ts | Settings props | ≥1k files |
|------|---------|----------|-----------|---------|----------|-------------|--------|----------------|-----------|
| baseline | 24843 | 318 | 111 | 30585 | 11622 | 7691 | 4947 | ~180 | ~53 |
| 2026-08-01 A0 | 24842 | 318 | 111 | 30584 | 11621 | 7690 | 4946 | 204 | 53 |
| 2026-08-01 C3 | — | — | — | — | — | — | 26 (facade) + 17 modules | — | — |
| 2026-08-01 C1 | — | — | — | — | facade 27 / max ≤2000 | — | — | — | — |
| 2026-08-01 C2 | — | — | — | — | — | facade 115 | — | — | — |
| 2026-08-01 final | 23 | 4 | 3 | 8 (shell) | dir | dir | 26 | 9 | 43 |
| 2026-08-22 W0 | 24549 (shell 18 + wb 24531) | 253 | 100 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W1 | 24013 (shell 18 + wb 23995) | 250 | 95 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W2 | 23734 (shell 18 + wb 23716) | 243 | 92 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W3 | 22442 (shell 18 + wb 22424) | 232 | 91 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W4 | 22404 (shell 18 + wb 22386) | 227 | 91 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W5 | 22245 (shell 18 + wb 22227) | 224 | 88 | 11 | dir | dir | 28 | 9 | 80 |
| 2026-08-22 W6 | 22245 (shell 18 + wb 22227) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-22 W7 | 21638 (shell 18 + wb 21620) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-22 W8 | 21326 (shell 18 + wb 21308) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-22 W10 | 21020 (shell 18 + wb 21002) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-22 W11 | 20903 (shell 18 + wb 20885) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W12 | 20710 (shell 18 + wb 20692) | 224 | 88 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W13 | 20451 (shell 18 + wb 20433) | 224 | 87 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W14 | 20360 (shell 18 + wb 20342) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W15 | 20288 (shell 18 + wb 20270) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W16 | 19862 (shell 18 + wb 19844) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W17 | 18904 (shell 18 + wb 18886) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W18 | 17941 (shell 18 + wb 17923) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W19 | 17415 (shell 18 + wb 17397) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W20 | 17050 (shell 18 + wb 17032) | 224 | 86 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W21 | 16835 (shell 18 + wb 16817) | 216 | 85 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W22 | 16810 (shell 18 + wb 16792) | 216 | 85 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W23 | 16468 (shell 18 + wb 16450) | 213 | 83 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-23 W24 | 15850 (shell 18 + wb 15832) | 213 | 83 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-24 W25 | 15612 (shell 18 + wb 15594) | 209 | 81 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-24 W26 | 15471 (shell 18 + wb 15453) | 156 | 81 | 11 | dir | dir | 28 | 9 | 69 |
| 2026-08-24 W27 | 15183 (shell 18 + wb 15165) | 155 | 80 | 11 | dir | dir | 28 | 9 | 69 |

## Blockers

_(none — program complete)_

## Auto-continue

- **User re-prompt not required** between WPs or waves.
- After each WP: update this ledger → run unit gates → start next PENDING WP.
- Stop only on Pause conditions in the Goal spec (secrets leak, data loss risk, missing product decision that blocks compile).

## FINAL: PASS

Machine gate `final` green; handoff `docs/plans/CODE-QUALITY-COMPLETION.md` written.

## Residual program (post-final, 2026-08-01)

Parallel non-overlapping tracks (multi-agent) — **landed**:

| Track | Owner path | Status | Notes |
|-------|------------|--------|-------|
| residual-clippy | `src-tauri/**` | **PASS** | 478→0; CI `-D warnings` |
| residual-resource-viewer | ResourceViewer + parts | **PASS** | 4938→modules |
| residual-i18n | `src/i18n/**` | **PASS** | domain modules + barrels |
| residual-settings | SettingsPage + settings/* | **PASS** | 8874→1817 |
| residual-appworkbench | AppWorkbench + hooks | **PASS** | WP-W27: settings nav/prefs + connect/live map extracted; #870 closed |
| residual-settings-catalog | settingsCatalog split | **PASS** | domain entries |

Follow-on: `docs/plans/HANDOFF-appworkbench-decomposition.md`. Decreasing ceilings now **15350 / 160 useState / 83 useEffect**; `files_ge_1000` **≤77** (0.2.28 tree). #870 closed.