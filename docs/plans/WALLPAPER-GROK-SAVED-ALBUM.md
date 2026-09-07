# Grok Imagine saved album as a wallpaper source

Status: delivery in progress; secure Host bridge is the first review slice

## Goal

Add `https://grok.com/imagine/saved` as an independent wallpaper source without changing X search, reusing Grok Build OAuth, or exporting Grok web credentials.

## Security contract

- The album opens in a dedicated Tauri WebView window with its own persistent data directory.
- On Windows and Linux, a valid unauthenticated Manual `http` / `socks5` proxy is pinned directly to that remote WebView (`socks5h` is normalized to WebView SOCKSv5). System/PAC/env modes retain the native WebView route. Unsupported manual schemes, proxy authentication, Direct mode, and macOS Manual mode fail closed instead of silently using another route. Saving a proxy change destroys the existing album window so its next open uses the new route; the isolated persistent profile preserves the official sign-in session.
- The album window label is deliberately absent from every Tauri capability, so remote content has no IPC access.
- Navigation is restricted to HTTPS first-party Grok/xAI pages and the explicitly supported identity-provider sign-in pages. New-window requests and downloads are denied.
- Cookies, authorization headers, request signatures, storage values, and raw API responses are never read, returned, persisted, or logged by Grok App.
- The Host runs only fixed, bundled JavaScript against the album page. Frontend callers cannot supply scripts.
- The bridge returns an allowlisted DTO only: media URL, optional thumbnail URL, media kind, dimensions, creation time, and post id. Host validation accepts media only from `assets.grok.com` and caps item counts and field lengths.
- Album metadata is held in memory only while the current Saved page instance remains active; top-level navigation and window close clear it. Only a wallpaper that the user previews or applies is downloaded through the existing media allowlist into the app wallpaper library under the distinct `grok_album` source.
- Album cards never load `assets.grok.com` directly from the main WebView because the CDN rejects that cross-site context. For each revalidated generated-media URL, the isolated signed-in WebView and the credential-free Host proxy race; the first successful route produces an in-memory JPEG thumbnail (480 px edge, 512 KiB output cap, four concurrent jobs), and the losing route is cancelled. The current 20 cards and one 20-card lookahead may be warmed; switching sources clears the frontend cache, and no thumbnail is written to disk or the wallpaper library.
- A user-selected original races the configured credential-free Host proxy against a fixed `credentials: include` fetch in the isolated Saved WebView. The WebView-managed login state never leaves that page. If the WebView wins, its Blob stays inside the isolated page and is read back in bounded 512 KiB binary chunks; if the Host wins, the WebView job is cooperatively cancelled and cleaned up. Both routes converge before the sole save point, which reapplies the URL allowlist, 200 MiB limit, MIME/real-signature checks, and writes only the validated file under the `grok_album` library source. Cookies, tokens, storage, headers, and raw API responses never cross the bridge.

## User flow

1. Appearance -> wallpaper exposes a separate `Grok album` entry and source tab.
2. `Open / sign in` focuses the dedicated official Grok window. If the signed-out Saved route renders only its empty shell, the fixed bootstrap returns to the official Grok home page so its own sign-in button is usable. Later uses reuse the isolated cookie store.
3. `Sync current page` copies only validated media metadata into the wallpaper gallery.
4. `Load more` scrolls the official saved page, waits for its own infinite loader, then merges newly rendered cards. It does not call undocumented REST endpoints directly.
5. Search in v1 is the official page's own search/filter interaction plus the existing local gallery filter. A direct `/rest/media/search/query` integration remains out of scope until xAI publishes a supported contract.
6. Preview/apply races the signed-in isolated WebView against the credential-free Host proxy and accepts the first successful route before the existing signature validation, single local-library save, and wallpaper preparation pipeline.

## Delivery slices

### Slice 1 - secure read-only path

- Dedicated window lifecycle and domain allowlist.
- Persistent isolated WebView storage.
- Login/loading/ready/closed status without Cookie inspection.
- First rendered-page metadata snapshot and strict validation.

### Slice 2 - wallpaper source UX

- Source entry, tab, controls, gallery mapping, preview and apply.
- Manual refresh and load-more through official-page scrolling.
- In-memory dedupe and one-batch-ahead cache where it does not move a visible user-controlled page.

### Slice 3 - product completeness

- Fifteen locale catalogs in lockstep.
- Settings search catalog registration.
- Unit/security tests and wallpaper-search documentation.
- Typecheck, frontend tests/build, Rust formatting/tests, and a real desktop smoke test.

## Acceptance state

The original development branch completed deterministic and Windows acceptance,
but review delivery is intentionally split. Slice 1 contains only the isolated
window, fixed-script metadata bridge, request cancellation, proxy pinning, and
validated thumbnail/original-media transport. It does not expose the source in
the renderer. Slice 2 will add the source UI and rerun the full desktop flow on
top of the reviewed Host contract.

## Explicit non-goals

- No Grok Build OAuth token reuse for grok.com.
- No Cookie/token export, auth-file import, or raw WebView storage access.
- No direct calls to undocumented Grok consumer REST endpoints.
- No coupling to or behavior change in the X wallpaper-search route.
- No automatic upload, push, or pull request.
