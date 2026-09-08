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


## Public image provider Host contract

Openverse and Pexels have separate fixed-endpoint adapters under
`wallpaper_provider_search`. The Host accepts a source, bounded query and request
ID through `wallpaper_remote_search`, `wallpaper_remote_search_more`, and cancel.
Web search is rejected in this slice. Source-picker controls arrive separately;
this change registers the working Host commands without exposing a new UI.

The provider query removes generic wallpaper/size terms. Each page targets 20
verified images (two 20-candidate Openverse pages, or 40 Pexels candidates), with
at most 10 simultaneous image probes, an 8-second per-probe timeout, 12-second
validation budget, and 30-second overall search budget. Results may be fewer
when candidates fail validation. The API key is supplied only to Pexels' fixed
endpoint; redirects on credentialed requests are rejected.

Only validated image DTOs and source/author/license links cross IPC. The shared
media path checks public HTTPS destinations and redirect hops, MIME/signature,
response completeness and body limits. Thumbnails use bounded Host decoding;
original images are written in the selected source directory. Cancellation
covers search, probes, media reads and thumbnail work; request IDs isolate late
events. Search/page caches are bounded to 64 entries with a 10-minute TTL and
Pexels credential revision in their identity. The Host retains continuation
cursors, buffered results and source Referer origins; credentials/cursors are
not returned to the renderer. Media request cancellation supports bounded
pre-cancellation before registration.

The UI follow-up keeps exactly one provider page ahead after every successful
page while leaving it hidden until the user chooses “load more”. A click waits
for an in-flight prefetch or consumes a completed one without another Host
request, then starts at most one replacement prefetch when more pages remain.
Hidden progress and failures are not surfaced as foreground state. A failed
prefetch is discarded, so an explicit click makes one fresh foreground request;
that request is never auto-retried and its failure preserves existing cards and
the continuation. Query/source changes, close and cancellation invalidate late
prefetch results and cancel the active Host request.

Grok Saved, catalog metadata and generation integrations remain separate
changes. Tests use synthetic provider responses and media fixtures; passing
tests do not claim live provider availability or account validation.

## Web image discovery Host contract

Web discovery is an independent source and never enters or augments X results.
The renderer supplies only a bounded query and request ID. The Host reads the
existing Grok Build OAuth credential and calls the fixed
`https://cli-chat-proxy.grok.com/v1/responses` endpoint with `grok-4.6`, low
effort, `store: false`, a strict source-page JSON schema, and only the hosted
`web_search` tool. Endpoint, model, tool limits, bearer token and headers are
not configurable from IPC, and redirects never receive the bearer token.

An initial search runs three complementary lanes and targets up to 20 verified
images; “load more” runs one smaller lane. The Host accepts only real HTTPS
source-page URLs, fetches bounded initial HTML through the DNS-pinned safe HTTPS
transport, and extracts `og:image`, `twitter:image`, and JSON-LD metadata. Each
candidate image is then revalidated for public destination, redirects,
signature, MIME, byte size, dimensions and wallpaper quality. The source page
and media URL remain separate provenance fields. No cookies, browser storage,
OAuth values, URL paths from prior results, or raw provider responses are
logged or returned to the renderer.

Search/page caches are bounded by credential revision and query. Continuation
prompts receive only bounded source hostnames, never source URL paths, query
strings or fragments. Cancellation covers Responses, page discovery and image
validation, including bounded pre-cancellation before request registration.
The source picker exposes Web only through this fixed Host route. It reuses the
same request-ID isolation, progressive batches, hidden one-page prefetch,
explicit load-more retry and validated remote-media download path as the public
providers. Synthetic fixtures prove parsing, budgets, cache, cancellation and
SSRF boundaries, not live account availability.

## Grok Saved Host bridge

Grok Saved uses a dedicated persistent Tauri WebView at
`https://grok.com/imagine/saved`. The window is absent from every Tauri
capability, restricts top-level navigation to first-party Grok/xAI pages plus
the supported Google and Apple sign-in pages, and denies new windows and
downloads. The Host never reads or exports cookies, storage, authorization
headers, request signatures, or raw API responses.

Renderer callers select only fixed Host commands. The Host executes bundled
JavaScript that returns a bounded allowlisted media DTO; caller-provided scripts,
endpoints, headers and credentials are not accepted. Album media must remain on
`assets.grok.com`. Navigation, window close, account/page revision changes and
explicit cancellation invalidate cached metadata and active transfers.

Manual unauthenticated HTTP/SOCKS5 proxy settings are pinned to the isolated
WebView on Windows and Linux. Unsupported schemes, authenticated proxies,
Direct mode and macOS Manual mode fail closed instead of silently taking a
different route; saving a proxy change destroys the existing album window.

Thumbnail and selected-original requests race the isolated signed-in WebView
against a credential-free Host request. Only the first valid result continues,
and both routes converge on the existing URL, redirect, byte-limit, MIME and
signature checks. Thumbnails stay in memory. A selected original is written
once under the distinct `grok_album` library source.

The personal source group exposes Grok Saved with explicit closed, loading,
verification, sign-in, ready and wrong-page states. The first 20 items are
visible while one further 20-item page is warmed without revealing it. “Load
more” first consumes that warm page and then starts one replacement warmup.
Background sync and warmup do not lock existing cards. Closing the picker,
switching sources or detecting a page/account revision cancels media work and
clears renderer thumbnail state. The main renderer never loads an
`assets.grok.com` thumbnail or original directly; selected originals must cross
the isolated Host bridge before preview or wallpaper application.

## Public image provider UI

The source picker groups the sources delivered so far into discovery, creation
and personal sections. Discovery exposes X, Web, Openverse and Pexels; creation
exposes Imagine; personal exposes Grok Saved and the local library. The grouped
strip stays on one horizontally scrollable row in narrow windows.

Openverse works without user credentials. Pexels reads only the Host's masked
credential status and writes replacement/removal requests through the existing
secrets commands; the renderer never receives the stored key. A rejected key
opens an editable replacement field, removal requires an in-app confirmation,
and search stays disabled while credential status is unknown or unavailable.

Provider results use the bounded Host thumbnail path and keep their source,
author and licence links separate from the image-preview action. A thumbnail
failure leaves the result card available so selecting it can still fetch the
validated original. Initial searches replace the old gallery; explicit “load
more” appends deduplicated results while leaving current cards selectable.
Paging failures preserve the gallery and continuation for retry. The separate
prefetch follow-up described above adds one-page-ahead loading without changing
this page's visible controls.

## Local library catalog Host contract

The local wallpaper library keeps its media files in the existing wallpaper
root and stores only bounded metadata in an atomic `.catalog.json`. Records have
a stable media ID, source and purpose, favorite state, known dimensions, optional
prompt/generation lineage, and sanitized HTTPS attribution fields. Remote media
identity is stored as a source-scoped SHA-256 key; raw media URLs, credentials,
headers and private album responses are not written to the catalog.

`wallpaper_library_page` filters the complete scanned library by query, media
kind and purpose before paging. A page contains at most 96 items (48 by default)
and uses a query- and page-size-bound snapshot cursor. At most eight snapshots
live for 30 minutes. Images sort before videos, then by descending modification
time and path. New files appear on a new snapshot; files deleted during paging
are skipped without shifting the remaining snapshot order. Hidden entries,
symbolic links and paths outside the wallpaper root are never traversed.

`wallpaper_library_remember` accepts only an existing, signature-validated media
file inside the wallpaper root. It bounds text metadata, strips query strings and
fragments from public attribution URLs, and can change favorite state without
deleting the file. `wallpaper_library_lookup` accepts at most 96 source/media URL
pairs and returns only unchanged local files; replacements at the same path get a
new identity and cannot inherit an old remote-origin association. Lookup by media
ID applies the same containment, signature and replacement checks. The legacy
list and delete commands remain registered for existing clients.
