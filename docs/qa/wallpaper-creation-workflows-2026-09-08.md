# Wallpaper creation workflows QA

Date: 2026-09-08

Branch: `feat/wallpaper-creation-workflows`

Base: `5cdc4d21` (`feat/wallpaper-source-history` / PR #1110)

## Scope

- Replace the previous prompt-and-path Imagine handoff with one restricted,
  cancellable `image_gen` invocation whose arguments and output are audited.
- Add explicit image-edit and image-to-video modes, with source preparation,
  editable prompts, supported ratio/duration/resolution controls and actions on
  every image card.
- Keep remote and Grok Saved credentials inside their existing Host boundaries;
  generation receives only a validated local snapshot.
- Decode AVIF, WebP and GIF in the renderer when needed, then independently
  validate and normalize bounded image pixels in the Host, including JPEG EXIF
  orientation.
- Register generated media, parameters and parent-image relationships in the
  local catalog. Treat a successful catalog transaction as the commit point so
  a racing cancellation cannot leave a record whose file was deleted.
- Classify only audited tool-owned HTTP and transport errors, including a stable
  network failure code, without parsing model text, URLs or response bodies.

## Focused verification

- Exactly one allowed media tool call, exact request arguments, fresh session
  identity, ambiguous/stale output rejection and bounded session-log parsing.
- Sticky UUID cancellation before registration, process cancellation and late
  renderer-result rejection.
- Valid image/video signatures, extension agreement, directory containment,
  copy limits, source normalization and EXIF rotation.
- Mode-specific prompt state, local editable video prompt defaults, upload,
  source preparation, error recovery and image-card edit/video actions.
- Network failure propagation and the catalog commit-point race regression.

The complete frontend run included 56 focused Imagine, API, media-conversion,
controller, controls and gallery assertions. The Rust Imagine module ran 28
focused assertions through the Windows manifest harness.

## Repository gates

- `pnpm typecheck`
- `pnpm test`: 621 files, 7,278 tests passed
- `pnpm lint`
- `pnpm deps:check`
- `pnpm audit:prod`: no known production dependency vulnerabilities
- `python scripts/check-code-quality-gates.py --mode final`: pass, 80 files at
  or above 1,000 lines (repository ceiling 80; this branch adds none)
- `python scripts/publish-website-downloads.py --self-test`: 3 tests passed
- `pnpm build:ui`
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets -- -D warnings`
- Windows Common Controls manifest harness: 1,834 tests passed, 1 ignored
- Empty binary harness: passed (0 tests)
- `git diff --check`
- Changed-file secret scan: no credentials, auth files, user email or local
  workspace paths

The production UI build retains pre-existing Rollup circular/dynamic-import and
large-chunk warnings; it completed successfully. Direct Windows `cargo test`
still stops before assertions with `0xc0000139`, so the repository manifest
harness was used. Its temporary PATH scrub preserved Windows system directories
and changed no persistent machine setting.

## Visual verification boundary

DOM tests cover the full controls, busy/error states, source preparation and
gallery actions. No additional native desktop click-through or live account
generation was performed on this rebuilt delivery branch, so this record does
not claim new real-account acceptance. The pull request remains **UI hold** for
maintainer visual and account-level review.

## Issue review and residual boundaries

GitHub searches for wallpaper Imagine, generation and image-to-video found no
direct matching open or closed Issue. The unrelated wallpaper display and
stream-performance Issues returned by the broad search were already closed, so
this branch does not declare a `Fixes` relationship.

- Generation still depends on a compatible signed-in Grok Build CLI and the
  account's upstream media entitlement; failures never trigger an automatic
  retry or a second paid generation.
- Supported video options remain 6/10 seconds and 480p/720p. The renderer cannot
  choose arbitrary tools, model names, CLI flags or output locations.
- This batch renders local generated video cards with metadata preloading. The
  separate full-screen video-preview/editor-provider and final narrow-window
  layout work remain outside this branch.
