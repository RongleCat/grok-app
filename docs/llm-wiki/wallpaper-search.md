# Wallpaper X search quality

The existing Appearance wallpaper search uses Grok Build CLI. The Host parses
model candidates, validates image responses, merges duplicates, and ranks the
remaining items before returning the existing gallery IPC shape.

- The first CLI round requests two X search tool calls. When fewer than six
  validated images remain, one supplementary round requests one further call
  and includes already-seen references. These are prompt budgets, not a promise
  that the model performs exactly that many calls or returns a fixed count.
- Each round retains at most 40 candidates; the ranked gallery returns at most
  16 images. Supplement failure preserves usable first-round results.
- Image probes read at most 64 KiB of response data, including when the server
  ignores Range. Signatures and declared MIME must agree; HTML/error responses
  are rejected. Recoverable JPEG/PNG/GIF dimensions inform ranking.
- Deduplication uses normalized media identity and status/media-index evidence.
  Missing dimensions and author/post data can be filled from duplicate entries.
  Ranking evidence stays in the Host and is not serialized over IPC.
- Redirects must remain on the existing HTTPS media allowlist and are bounded.
  Requests retain the application proxy settings.
- Full media downloads require HTTP 200 without Content-Range, enforce the
  200 MiB limit while reading, validate the signature/MIME, and choose the stored
  extension from the detected type. This download path also serves Imagine.

Tests in `src-tauri/src/wallpaper_source.rs` cover URL identity, deduplication,
ranking, supplement thresholds, signatures, dimensions, redirects and rejection
of partial download responses. Network availability, model relevance and actual
result counts still depend on the live service and require manual verification.
