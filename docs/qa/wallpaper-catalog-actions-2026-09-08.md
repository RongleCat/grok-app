# Wallpaper catalog actions QA

Date: 2026-09-08

Branch: `feat/wallpaper-catalog-actions`

Base: `db7d6469` (`feat/wallpaper-library-ui` / PR #1106)

## Scope

- Restore local catalog metadata on search, provider, Imagine and Grok Saved cards.
- Favorite or unfavorite any visible media card through the existing catalog.
- Materialize remote originals through their source-specific Host path before saving.
- Keep preview, apply and delete from racing a favorite write for the same card.
- Preserve cards and allow retry after catalog persistence failures.

Media details, source scroll restoration and generation/video workflows are not
part of this branch.

## Automated checks

- `pnpm typecheck`
- `pnpm test`: 613 files, 7,205 tests passed
- `pnpm lint`
- `python scripts/check-code-quality-gates.py --mode final`
- `python scripts/publish-website-downloads.py --self-test`: 3 tests passed
- `pnpm build:ui`
- `pnpm deps:check`
- `pnpm audit:prod`: no known production vulnerabilities
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets -- -D warnings`
- Windows manifest harness: 1,806 tests passed, 1 ignored; empty binary harness passed

Focused coverage includes bounded lookup batches, late-response invalidation,
favorite-write deduplication, retry after failure, preview/write races, paging
races, remote provenance persistence and removal from the Favorites view without
deleting the file.

## Windows desktop QA

Built the branch with a separate Tauri identifier and isolated `GROK_APP_HOME`.
Used three deterministic PNG fixtures (landscape, portrait and square); no user
account, secret, network result or existing wallpaper directory was used.

- Dark theme: all three aspect ratios rendered, with favorite and delete controls
  separated at opposite top corners.
- Favorite: button changed to the pressed state and `.catalog.json` recorded the
  expected 800 x 800 dimensions and `favorite: true`.
- Restart: reopening the library restored the pressed favorite state from disk.
- Favorites collection: showed only the saved item.
- Unfavorite: removed the item immediately from Favorites, retained the original
  file byte-for-byte, and persisted `favorite: false`.
- Light theme: favorite buttons, cards, labels and footer remained readable.
- 900 x 600 window: the modal, source strip, filters, cards and footer stayed
  usable without control overlap.

Desktop QA exposed one issue before submission: after unfavoriting the final item,
the card disappeared but the kind count still showed one and the empty text implied
the library itself was empty. The final branch adjusts collection counts, protects
them from a late page response and shows the filtered-empty presentation. Regression
tests cover unfavoriting both before and during an in-flight page request.

## Residual boundaries

- Live provider availability and relevance remain external-service behavior and
  were not exercised by the synthetic desktop fixture run.
- This changes visible card chrome, so the PR is marked **UI hold** for maintainer
  review and is not merged by the agent.
