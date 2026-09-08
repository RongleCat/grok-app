# Wallpaper source history QA

Date: 2026-09-08

Branch: `feat/wallpaper-source-history`

Base: `c7e1dafc` (`feat/wallpaper-media-details` / PR #1109)

## Scope

- Preserve each wallpaper source's query, sort, visible rows, selection,
  filters, status text and scroll position while the source picker stays open.
- Restore X and provider continuation state, including a completed hidden
  provider prefetch, without starting a replacement search.
- Reuse the local library's bounded query cache before restoring its scroll
  position, so returning to a filter does not add a Host request.
- Keep Grok Saved rows inside the authenticated controller while restoring only
  safe UI state after that controller reports ready.
- Invalidate stale Grok Saved state after page/account revision changes and
  stale Pexels state after credential changes.
- Clear all source history when the picker closes.

Persistent history across picker sessions, accounts or app restarts is
intentionally outside this branch.

## Focused verification

- Source history bounds, 20-minute expiry, authenticated-row exclusion and
  catalog metadata synchronization.
- Provider result, query, completed prefetch and scroll restoration without a
  duplicate search or page request.
- X cancellation remains single-shot when switching sources.
- Grok Saved video filter and scroll restoration waits for ready state, then a
  new history revision resets the filter and scroll.
- Local library query, media kind, collection and scroll restoration uses the
  existing hook cache without another Host page request.
- Closing and reopening the picker starts with empty source history.

Focused result: 6 files / 32 tests passed.

## Repository gates

- `pnpm typecheck`
- `pnpm test`: 616 files, 7,224 tests passed
- `pnpm lint`
- `pnpm deps:check`
- `pnpm audit:prod`: no known production vulnerabilities
- `python scripts/check-code-quality-gates.py --mode final`
- `python scripts/publish-website-downloads.py --self-test`: 3 tests passed
- `pnpm build:ui`
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets -- -D warnings`
- Windows Common Controls manifest harness: 1,806 tests passed, 1 ignored
- Empty binary harness: passed (0 tests)
- `git diff --check`

## Visual verification boundary

This branch adds no new source, command or visible control. It changes the
behavior users observe when returning to an existing source. DOM tests cover
the state and scroll transitions, but no additional native desktop
click-through is claimed. The pull request remains **UI hold** for maintainer
review with the rest of the wallpaper picker batch.

## Residual boundaries

- History is renderer memory with a 20-minute TTL and a 2,000-item per-source
  bound; closing the picker deliberately clears it.
- An in-flight hidden provider prefetch is cancelled on source change. Only a
  completed, validated page can be restored for the next explicit load-more.
- Grok Saved state is discarded when its isolated page or account identity
  changes; authenticated media rows are never copied into general history.
