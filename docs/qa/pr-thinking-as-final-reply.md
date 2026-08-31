## Summary

Fixes #968. After thinking ends, the real answer can already be on the message / journal while the live timeline still paints CoT as the reply. Switching sessions remounts from disk and looks right. Same family as #697; this path is thought-only live `segments` (or thought leaked into `content`) winning over the body field.

Paint uses `messageSegments`. If `segments` is thought-only, the content field is ignored. Weave can also derive-wipe the body. Late assistant tokens after settle used to mint a second bubble or get dropped. Stream `done` could flush before pending thought.

## Type of change
- [x] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / chore

## What changed

- `messageSegments` / `ensureSegments` append a content segment when the field has a real answer and live segs do not.
- Late body tokens bind to the settled current-turn assistant. Late thought does not re-open 思考中.
- Journal heal still lifts when live content *is* the thought, even if it is longer than the journal answer. Heal window covers Host post-turn reconcile.
- Stream coalescer drains the other kind (thought vs assistant) before a `done` tick.

## Checklist
- [x] I ran `pnpm typecheck` and `pnpm test` (targeted session/stream tests; 133 passed)
- [ ] I ran `cargo test` in `src-tauri` (no Host change)
- [x] User-facing strings go through `src/i18n/messages.ts` (en + zh)
- [x] No `window.confirm` / `prompt` / `alert` for product dialogs
- [x] Docs / `docs/llm-wiki` updated if behavior changed
- [x] No secrets (`secrets.json`, tokens, `auth.json`) included
