# Wallpaper media details QA

Date: 2026-09-08

Branch: `feat/wallpaper-media-details`

Base: `2e84d1d2` (`feat/wallpaper-catalog-actions` / PR #1108)

## Scope

- Open metadata details from every visible wallpaper card.
- Present only recorded dimensions, bytes, provenance, prompt and generation
  parameters; unknown historical fields remain explicit.
- Resolve a generated item's parent through the bounded catalog ID lookup.
- Keep nested Escape, focus restoration and late parent lookups isolated.
- Reuse a recorded prompt by prefilling Imagine without starting generation.

Video lightbox support, per-source scroll restoration and generation execution
are intentionally outside this branch.

## Focused verification

- `WallpaperMediaDetails`: dimensions, requested parameters, unknown fields,
  URL credential/query stripping, parent navigation, missing/error retry,
  late-response invalidation, nested Escape and pending-preview cancellation.
- `WallpaperSourceGallery`: item-specific details entry, prompt reuse, and
  closing stale details when filtering removes a card.
- `WallpaperSourceModal`: library prompt reuse switches to Imagine and preserves
  the text without invoking generation.
- `ImageViewer`: synchronous layer ownership across open, close and unmount.

Focused result: 4 files / 20 tests passed.

## Repository gates

- `pnpm typecheck`
- `pnpm test`: 615 files, 7,217 tests passed
- `pnpm lint`
- `pnpm deps:check`
- `pnpm audit:prod`: no known production vulnerabilities
- `python scripts/check-code-quality-gates.py --mode final`
- `python scripts/publish-website-downloads.py --self-test`: 3 tests passed
- `pnpm build:ui`
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets -- -D warnings`
- Windows Common Controls manifest harness: 1,806 tests passed, 1 ignored;
  empty binary harness passed
- `git diff --check`

The direct Windows `cargo test` launcher reproduced the known pre-harness
`0xc0000139` process-start failure. Embedding the repository's test manifest and
removing only conflicting third-party API-set DLL directories from `PATH`
entered the real test assertions and produced the Rust result above.

## Visual verification boundary

The preceding catalog-actions branch exercised the shared cards and nested
source modal on a real Windows desktop in dark/light themes and a 900 x 600
window. This branch adds focused DOM interaction and layout coverage for the
details layer, but the native Computer Use RPC was unavailable during final
submission review, so no additional automated desktop click-through is claimed.
The pull request remains **UI hold** for maintainer visual review.

## Residual boundaries

- Parent lookup can only recover an unchanged file still represented in the
  local catalog; replacement and deletion deliberately return no parent.
- Historical files without metadata display `Not recorded` rather than inferred
  source or generation claims.
- The operation labels describe stored audit data. This branch does not expose
  new edit or video-generation controls.
