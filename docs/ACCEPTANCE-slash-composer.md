# Acceptance · Slash / Skills / Goal / Doctor (Wave A)

Run after implementation. Every item is pass/fail.

## A. Doctor (fix)

| # | Check | How |
|---|--------|-----|
| D1 | Doctor modal is **not** a bare JSON `<pre>` | Open Doctor from Settings / sidebar / tray |
| D2 | Shows check rows with status ok/warn/fail | CLI found, auth, data root, backend |
| D3 | **Re-run** refreshes report | Click re-run; loading then new timestamp |
| D4 | **Copy** puts redacted report on clipboard | Paste elsewhere |
| D5 | Slash `/doctor` opens same modal | Type `/doctor` Enter in composer |
| D6 | i18n: all Doctor chrome via `t()` | Switch locale |

## B. Skills data

| # | Check | How |
|---|--------|-----|
| S1 | `skills_list` / inspect returns invocable skills | Host command or UI list non-empty when CLI present |
| S2 | Plus menu Skills section lists real skills (or empty state) | Open + menu |
| S3 | Skills filter by name/description | Type `/aih` → aihot-like skills; `/rc` and `/review-` highlight `review-commit` |

## C. Contenteditable + chips

| # | Check | How |
|---|--------|-----|
| C1 | Composer is contenteditable (not textarea) | Inspect DOM |
| C2 | Selecting a skill inserts **inline** chip at caret | Type text, `/skill`, Enter mid-sentence |
| C3 | Backspace deletes whole chip | Caret after chip, Backspace |
| C4 | IME Enter does not send | Chinese IME compose + Enter |
| C5 | Shift+Enter newline; Enter sends when palette closed | |

## D. Slash palette UX

| # | Check | How |
|---|--------|-----|
| P1 | `/` at start opens palette | |
| P2 | `hello /` (space before slash) opens palette | |
| P3 | `https://` mid-path does **not** open | type url-like without space rule |
| P4 | ↑↓ moves highlight; hover uses same style | |
| P5 | Esc closes palette | |
| P6 | Sections: commands then skills | |

## E. Modes & actions

| # | Check | How |
|---|--------|-----|
| M1 | `/goal` enables goal chip + goal placeholder | |
| M2 | Clear goal chip turns mode off | |
| M3 | Send with goal prefixes agent text with `/goal` | Observe network/log or journal |
| M4 | `/plan` sets plan mode (Access menu reflects) | |
| M5 | `/compact` confirm → sends `/compact` | |
| M6 | `/status` opens status modal | |
| M7 | `/mcp` opens MCP status modal | |
| M8 | Plan and Goal mutually exclusive | |

## F. History & send

| # | Check | How |
|---|--------|-----|
| H1 | User bubble shows skill chips for `[[skill:…]]` | Send with skill |
| H2 | Agent receives `/skill-name` form | Backend / inspect prompt |
| H3 | Edit last user message restores chips | |
| H4 | Attachments still work with chips | |

## G. Regression

| # | Check | How |
|---|--------|-----|
| R1 | `pnpm test` green | |
| R2 | `pnpm typecheck` green | |
| R3 | Existing composer send without slash still works | |
