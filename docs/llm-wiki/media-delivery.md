# Media delivery (local files)

## Model

| Layer | Responsibility |
|-------|----------------|
| **Resolve** | Token in chat / attachments → verified absolute path (session + project + grants) |
| **Deliver** | Absolute path → viewable URL for `<img>` / `<video>` / `fetch` |

## Delivery: loopback HTTP (primary)

Host starts a process-local axum server on `127.0.0.1:0` at app boot (`media_server.rs`).

```
GET http://127.0.0.1:{port}/v1/media?t={token}&p={urlencode(absPath)}
```

- **Token**: random per process; frontend loads via `media_server_endpoint` / `ensureMediaEndpoint()`.
- **path_scope**: same allowlist as fs absolute APIs (trusted projects, app data, agent home, grants).
- **Images**: no-Range GET returns **full 200 body** (up to 40 MiB). `<img>` cannot reassemble Range/206 — truncating at 2 MiB breaks chat thumbs and composer drops.
- **Range**: 206 + max 2 MiB chunk for video/audio/PDF (and Range requests on any type).
- **CORS**: main-window origins only (for `fetch` / copy / office reassembly); never `*`.
- **CSP**: `img-src` / `media-src` / `connect-src` allow `http://127.0.0.1:*`.

Frontend entry: `src/lib/imageSrc.ts` (`localPathToMediaHttpUrl`, `resolveImageSrc*`).  
Preview/office: `src/lib/filePreviewSrc.ts` (reassembles multi-Range for full-file readers).

## Chat image thumbs (performance)

Chat **card** layout does **not** re-stream full multi-MB originals on every virtual-list remount.

| Layer | Behavior |
|-------|----------|
| Host | `media_image_thumb` → `{app_data}/cache/image-thumbs/{hash}.jpg` (≤480px edge, JPEG). Local key = path+mtime+size; remote https key = URL. |
| Frontend | `resolveChatImageThumb` / `ImageUi` card mode loads thumb via loopback media; lightbox still opens original path/URL. |
| HTTP | Image responses: `Cache-Control: private, max-age=604800` + weak ETag. |

Very small locals (≤96 KiB) may skip re-encode and serve the original path.  
Video covers remain separate (`video-posters` + ffmpeg).

## Fallback

`media://` custom protocol remains registered for cold-start races only. Steady-state UI should use HTTP URLs.

## Security notes

- Bind **only** loopback.
- Never put filesystem paths in the path segment without token.
- Embedded browser webviews do **not** receive the token; they cannot read local media via this server.
- Do not reintroduce `Access-Control-Allow-Origin: *` for media.

## Path citation (agent + UI)

| Kind | Agent should write | UI |
|------|--------------------|-----|
| Local media to preview | Real absolute path in **inline** backticks (real spaces, no shell `\ `) | ImageUi / VideoUi via loopback media |
| Project code/docs | Project-relative with **enough unique segments** (not bare `正文.md` / shared `04-正文/正文.md` when many exist) | FilePathCard; Host smart open + session path map (last-touch) |
| Web/CMS assets | Full `https://…` | URL card — never treat `/images/…` as local FS |

### How the agent must cite (product rule)

Host injects always-on **path citation** text into session `grok --rules` via `path_citation_session_rules` → `merge_extra_rules` (`official_aux.rs`). Soft guidance only, but the UI contract is hard:

1. **Inline backticks only** for clickable path cards: `` `path/to/file` ``.  
   Fenced blocks (```` ``` ```` / ```` ```text ````) stay plain `CodeBlock` — **not** FilePathCards. Do not put the only path handoff inside a fence.
2. **Not tool-journal form** in user-facing prose: no `input:/abs/path`, no `tool_step|…` dumps as the citation style.
3. **Disambiguate homonyms**: article / template trees often share short tails (`正文.md`, `04-正文/正文.md`). Cite from project root with unique parents so Host + path map open the right file.
4. **Spaces**: write real spaces in absolute paths (e.g. `Mac Studio…`); never shell-escape `\ `.
5. **Optional line jump**: `` `path/to/file.ts:42` `` or `` `path/to/file.ts:42:10` `` (line / line:col). UI opens the side preview scrolled to that line when possible; external `open_in_editor` gets `-g path:line`. Invalid lines soft-fail (open file, no jump). Parse helpers: `src/lib/pathLineCitation.ts`.

Frontend path map (`sessionPathMap.ts`) collects tool `input:` / last-touched abs paths so short tokens in the same session can still resolve after tools ran — but **user-facing citations should still be unambiguous** without relying on that.

Frontend normalize (`src/lib/pathNormalize.ts` + `src/lib/attachments.ts`):

- Shell-unescape POSIX paths (`file\ \(1\).png` → `file (1).png`)
- Reject site-root absolutes (`/images/…`) for media HTTP
- Fail soft: unresolved relative media → plain code (not broken ImageUi)
- **FilePathCard**: only interactive chrome after Host confirms a real on-disk path (or URL). Unresolved / missing tokens stay plain inline code — never a dead clickable card
- Bare media basenames (`manycore.png`) stay as inline code unless pathMap maps them to a real local abs
- **Plausible local media abs** (`isPlausibleLocalMediaAbs`, host-aligned): POSIX needs ≥2 path segments — never mount VideoUi/ImageUi on `/replica_v2.mp4` mid-path false extracts after space + CJK folder names (`…/grok 美女视频/file.mp4`)
- Bare extract: no mid-path re-match after CJK (unless known root glue `换成/Users/…`); root walk soft-continues through unescaped spaces (`Application Support`, Downloads CJK folders)
- Windows drive + `~/…` media paths stay valid

## Chat attachments (tool → journal → thumb)

| Source | Policy |
|--------|--------|
| Structured tool output (`rawOutput.path`, ChatCut `thumbnail*`) | Attach + **grant** path_scope (may live outside default roots) |
| Freeform text / tool path_hint (reads, ls, markdown) | Attach only if file exists **and** already allowlisted or under session project — no incidental `~/.codex/plugins/...` logos |
| Freeform https in **terminal / file / search tool output** | **Never attach** — command stdout is arbitrary (a `curl` scrape listing image URLs would otherwise become an unrelated chat image card). Gate: `tool_is_media_capable` in `types.rs` |
| Remote `https://` media (ChatCut S3 thumbs, web-research fetches) | Always attach |
| False extracts (`/img_001.png` from `![](media/img_001.png)`) | Never attach; frontend `isDisplayableAttachmentPath` also drops them |

History load calls `paths_classify` (grants existing local paths, drops missing locals) so thumbs do not flash as dead paperclips.

## Related

- Path resolution: `session_resolve_relative_media`, `attachments.ts`, `sessionPathMap.ts`, `pathNormalize.ts`
- Attach gate: `prepare_media_attachment_path` / `extract_structured_media_path` in `session_manager/types.rs`
- Allowlist: `path_scope.rs`
