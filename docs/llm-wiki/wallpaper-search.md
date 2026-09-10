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

The Appearance card exposes only local choose/replace and the unified source
picker. X routing stays inside the X search row instead of occupying permanent
space in Appearance. The picker groups sources into discovery, creation and
personal sections: X, Web, Openverse and Pexels; Imagine; Grok Saved and the
local library. All seven labeled sources stay visible: roomy windows use one
row, narrower windows use two grouped rows, and very narrow discovery controls
use a 2-by-2 grid. Source changes never call `scrollIntoView` or hide earlier
sources in a horizontally scrolled strip.

Openverse works without user credentials. Pexels reads only the Host's masked
credential status and writes replacement/removal requests through the existing
secrets commands; the renderer never receives the stored key. A rejected key
opens an editable replacement field, removal requires an in-app confirmation,
and search stays disabled while credential status is unknown or unavailable.

Provider results use the provider's dedicated thumbnail URL through the bounded
Host thumbnail path, falling back to the validated original only when no safe
thumbnail URL exists. Once a result is present in the local catalog, its card
uses the loopback media endpoint instead of downloading the remote thumbnail
again. Remote image requests normally advertise only formats supported by the
Host decoder; in particular, they never advertise AVIF and then fail thumbnail
decoding. Openverse's fixed thumbnail endpoint requires a low-priority wildcard
fallback on a cold request, so only that exact endpoint receives one; its response
still passes the same MIME, signature and decoder validation. Source, author and
licence links remain separate from the image-preview action. A thumbnail failure
leaves the result card available so selecting it can still fetch the validated
original. Initial searches replace the old gallery;
explicit “load more” appends deduplicated results while leaving current cards
selectable.
The load-more action sits after the current cards inside the result scroller.
Paged grids keep DOM order so revealing a prefetched page does not redistribute
existing cards; known media dimensions preserve each thumbnail ratio, with a
stable fallback for unknown dimensions. Source, author and licence attribution
stays on one compact row. Paging failures preserve the gallery and continuation
for retry. The separate prefetch follow-up described above adds one-page-ahead
loading without changing this page's visible controls.

## Per-source browsing history

While the source picker remains open, each of its seven sources keeps an
independent browsing snapshot. A snapshot includes the search query and sort,
visible rows, selected card, gallery filters, local-library collection,
completion text, continuation state and gallery scroll position. Returning to a
source restores that state instead of presenting a blank gallery or repeating a
completed request. A completed provider prefetch remains available for the next
explicit load-more action; an in-flight request is still cancelled on source
change and is never adopted late.

History is renderer-memory only, expires after 20 minutes and rejects snapshots
above 2,000 rows. Closing the picker clears every source snapshot. The local
library waits for its query cache to become current before restoring scroll, so
returning to a cached query does not add a Host page request. Catalog mutations
update stored snapshots so restored cards cannot regress favorite or local-path
state.

Grok Saved stores only its filters, selection and scroll position; authenticated
album rows remain owned by the isolated album controller and are never copied
into generic source history. Its scroll is restored only after the matching
album revision is ready. A page, account or identity revision clears the saved
filters, selection and scroll. Replacing or removing the Pexels credential also
clears its prior continuation and browsing snapshot.

## Local library catalog Host contract

The local wallpaper library keeps its media files in the existing wallpaper
root and stores only bounded metadata in an atomic `.catalog.json`. Records have
a stable media ID, source and purpose, favorite state, measured dimensions and
video duration when the container exposes them, optional prompt/generation
lineage, and sanitized HTTPS attribution fields. Remote media
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

## Catalog actions in the source picker

Each media card offers a local favorite toggle. Remote originals are downloaded
through their existing source-specific Host path and registered with source,
author and license metadata before saving favorite state. Cards with an existing
local path reuse that file. Unfavoriting removes the card from the Favorites
view immediately but preserves the media file in All media.

Search results recover unchanged local paths, known dimensions and favorite
state through catalog lookups of at most 96 source/media pairs. Late lookups
cannot overwrite a newer favorite or update a closed source. Grok Saved cards
are eligible only while the isolated album reports ready; this lookup does not
replace its authentication or media-transfer boundary.

While a favorite is saving, duplicate toggles and preview/delete/apply actions
on that card are disabled. Source changes and close invalidate pending UI
updates. Failures preserve the previous favorite state and allow retry; a
successful retry clears the save error. A catalog failure during preview keeps
the card available, since a metadata failure does not invalidate the image.
Removing a visible row also updates its collection and media-kind counts; a
later snapshot page cannot restore the old counts. An empty filtered library
offers the existing clear-filter action instead of claiming no files are saved.

## Media details and generation lineage

Every visible card exposes a separate information action. The nested details
dialog shows known pixel dimensions, file size, source, author, license, local
path, prompt and recorded generation parameters without making unknown legacy
fields appear authoritative. Public attribution actions accept only HTTPS URLs
without embedded credentials and remove query strings and fragments before
opening them.

Generated media can resolve its recorded parent through the catalog's bounded
ID lookup. Missing, replaced or invalid parents leave the current details open
with a retryable message. Late lookups are discarded after close or card
replacement. A parent preview owns Escape before the nested details dialog and
is cancelled if the details layer closes while preview resolution is pending.

Prompt reuse only prefills the existing Imagine form and switches to that
source when needed; it never starts generation automatically. Filtering away a
card closes its details and restoring the card does not reopen stale UI state.

## Imagine generation, image editing and image-to-video

The Imagine source owns three explicit modes: generate an image, edit a selected
image, and animate a selected image. Every image card can open the edit or video
mode; video cards expose neither action. Selecting an action first materializes
the image through its existing source-specific Host path. Public providers keep
their HTTPS, signature and provenance checks, while Grok Saved keeps its isolated
WebView bridge. Browser cookies, tokens and caller-supplied headers never cross
into the main renderer or these generation commands.

Plain image generation uses a fresh UUID request, output directory and restricted
`image_gen` session. Image editing uses the same bounded source snapshot and the
restricted `image_edit` tool. `auto` sends one reference; explicit `16:9`, `9:16`,
`1:1` and `4:3` edits send the same immutable snapshot twice so the upstream
multi-reference contract applies its native aspect ratio. The Host audits exactly
one completed call with the requested prompt, ratio and source. It rejects changed
arguments, extra calls, ambiguous outputs and stale files instead of scanning an
older output directory or trusting final model prose. Neither operation retries or
creates variants automatically.

Video mode immediately fills an editable, localized motion prompt without another
model or network request. Only an Imagine item's original prompt may contribute up
to 240 Unicode characters of scene context; captions, URLs, Saved timestamps and
copy from every other source are excluded. Control and bidi characters are removed
while ZWJ and ZWNJ are preserved. The available options are 6 or 10 seconds and
480p or 720p, defaulting to 6 seconds and 480p.

`wallpaper_image_to_video` runs the local Grok Build CLI with low effort, at most
three turns and a 420-second hard timeout. The runner fixes `--tools` to the one
requested media tool, disallows `search_tool,use_tool`, disables web search and
subagents, creates a new session UUID, and uses the canonical shared `GROK_HOME`.
The renderer cannot choose a model, tool, CLI argument or output directory. The
Host accepts only the one audited result from that session's `videos` directory,
then revalidates path containment, signature, MIME, extension and the 200 MiB
limit before copying it into the owned wallpaper directory.

AVIF, WebP and GIF inputs are decoded in the app WebView to a PNG with a 2,048 px
maximum edge. Raw IPC input is limited to 40 MiB and the encoded PNG to 20 MiB.
The Host independently validates the original path inside the wallpaper root,
limits decoding to 16,384 px per edge, 50 million pixels and 256 MiB allocation,
applies EXIF orientation after bounded resizing, strips metadata and writes a new
task-local PNG snapshot. No shell, ffmpeg or user-installed converter is used.

All three modes share sticky UUID cancellation, including cancellation that arrives
before Host registration. Cancelling, closing the picker, leaving Imagine or
unmounting terminates the process tree, ignores late renderer results and removes
failed task output. Successful media is registered in the catalog as generated
content with the audited prompt and parameters; edit and video records also keep
the source media as their parent. A catalog write failure preserves the generated
file and returns that verified gallery item with `catalog_write_failed`, never an
empty result and never a second generation. The Host also writes a bounded recovery
descriptor under the wallpaper root. Only its opaque UUID crosses IPC; output and
parent relative paths, byte sizes, SHA-256 hashes, prompt and generation parameters
remain Host-owned. Pending descriptors are rediscovered after restart.

The explicit retry action performs only the catalog transaction. It revalidates the
UUID, root containment, media kind, byte size and hashes of both output and parent
before restoring the original lineage. Missing or replaced files fail closed,
concurrent/repeated retries are idempotent, and late renderer completions cannot
update a closed picker or a different source.
Requested video duration remains a generation parameter; MP4/WebM dimensions and
duration are measured from the saved file and stored separately. Existing video
records are upgraded on the next library scan without changing their media ID.

Upstream failures are classified only after auditing the complete tool log. Known
tool-owned HTTP and transport prefixes map to stable auth, access, rate-limit,
request, upstream, network and timeout codes. URLs, response bodies and model text
are never parsed for error classification. The form and existing gallery remain
available for an explicit manual retry.
