# Wallpaper X search quality

The existing Appearance wallpaper search uses Grok Build CLI. The Host parses
model candidates, validates image responses, merges duplicates, and ranks the
remaining items before returning the existing gallery IPC shape.

## Request lifecycle

`wallpaper_x_search` accepts an optional UUID requestId (older callers may omit
it). `wallpaper_x_search_cancel` cancels only that request. A bounded 30-second
pre-cancel record handles cancellation arriving before registration; duplicate
active identifiers are rejected and request guards clean up on completion/drop.

The Host emits `wallpaper://x-search-progress` with requestId and stage:
preparing, searching_x, validating, supplementing, done. Progress is advisory;
the invoke result remains authoritative. Cancellation interrupts CLI execution
and image validation; the existing output-drain/process-tree cleanup is retained.

The picker offers Cancel search, cancels on close/tab change/unmount, and ignores
late results/errors/progress. Replacement searches invalidate the previous
generation synchronously without waiting for a cancellation acknowledgement.
There is no result cache in this slice; account-sensitive caching belongs to
the later progressive-search implementation.

## Responses preview

The X picker exposes a persisted route setting. Missing or unknown settings use
CLI. Only `responses_preview` enables the fixed Build compatibility endpoint
`https://cli-chat-proxy.grok.com/v1/responses`, model `grok-4.6`, effort `low`, and
the read-only `x_search` tool. Requests set `store: false`; no endpoint/model/tool
or bearer is accepted from the frontend, and bearer redirects are disabled.

`account/build_oauth.rs` reads canonical official credentials in the Host. It
selects the current Build scope before the legacy scope, rejects issuer/client
conflicts and expired credentials, and includes a private salted content tag in
credential revisions. Tokens never cross IPC or enter logs. No refresh or login
is attempted by wallpaper search.

The client reads bounded response bodies and requires completed X tool-call
evidence before accepting gallery JSON. The existing image quality pipeline
validates the candidates. Responses runs three concurrent lanes sharing one OAuth
read and HTTP client. Each lane targets eight images and permits at most three X
tool calls (nine across the request). Direct, visual variation and discovery
prompts diversify results. Each validated lane emits a request-scoped batch;
results are deduplicated and ranked to at most 24 images. A failed lane preserves
useful results from the other lanes. If all fail, rate/budget errors take priority
to prevent an additional CLI request. Cancellation drops all pending lanes.

The picker displays batches as they arrive; the final invoke result is authoritative.
The hook rejects malformed, duplicate and foreign-request batches and clears them
on replacement/cancel. Batch event failure cannot prevent the final result from
showing. Automatic prefetch is a separate follow-up slice.

Eligible failures fall back once to CLI. Rate limits, cancellation and tool-budget
violations never trigger a second route. Three counted failures open a ten-minute
circuit; credential content changes reset it. The picker reports the actual route,
fallback reason and total duration. This compatibility endpoint may change; neither
subscription availability nor account-risk guarantees are implied by preview mode.

Hook and picker tests cover replacement, late responses, progress ownership and
close/tab cancellation. Host tests cover UUIDs, pre-cancel expiry/capacity,
registry cleanup, waiter wakeup, and cancellation of a synthetic CLI process.

## Image quality

- The first CLI round requests two X search tool calls. When fewer than six
  validated images remain, one supplementary round requests one further call
  and includes already-seen references. These are prompt budgets, not a promise
  that the model performs exactly that many calls or returns a fixed count.
- Each CLI round retains at most 40 candidates; the ranked CLI gallery returns at most
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

## Responses result cache

Explicit Responses preview searches reuse successful validated galleries for ten
minutes in a Host-only LRU with at most 32 entries. Keys include normalized query,
sort and the salted credential content revision. Only metadata is kept in memory;
no token, image bytes or disk cache is added. CLI/default/auto and CLI fallbacks
are not cached because their account/provider scope differs from official OAuth.

Every lookup revalidates OAuth scope and expiry. Expired/missing/replaced credentials
cannot retrieve the old entry. A credential change during a request prevents cache
insertion. Failures and cancelled work are not cached; cancellation and cache writes
share a commit gate. Reads update LRU order but never extend the ten-minute TTL.

A hit emits a request-scoped terminal batch and the normal final result. Metadata
reports cacheHit, the new requestId, lookup duration and zero new search calls;
the picker labels the result as cached. Cache reuse saves repeat searches only;
it does not improve the first live request or guarantee an old CDN URL remains
reachable. Existing preview/download validation continues to handle expired media.

## Explicit Responses enrichment

A successful initial result offers one additional eight-item request. The Host
returns an opaque continuationId only when its bounded cache stores that gallery;
the frontend submits that id and a new requestId, not query text or media URLs.
Changing query/sort hides the previous continuation. Default CLI never offers it.

A continuation is an exclusive lease bound to the original credential revision.
In-flight entries survive TTL/eviction and cannot be overwritten by another search.
Cancellation, network failures and dropped futures restore the opportunity to retry;
success or a confirmed empty batch consumes it once. A consumed cached result no
longer advertises continuation. The provider uses the validated OAuth snapshot;
credential validity and revision are checked again before returning its result.

Enrichment performs one Responses request with at most three X tool calls, using
the existing media/post identities as exclusions. It validates and deduplicates
against the original gallery, never falls back to CLI and never auto-retries.
The final result is appended only after the Host validates its identity. Existing
images remain visible/selectable while enrichment runs; errors keep them intact,
and an empty batch displays the localized no-more hint. Closing/cancelling rejects
late results. This slice does not automatically prefetch or repeat enrichment.
