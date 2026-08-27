/**
 * Wallpaper source helpers — X search + Imagine gallery types and pure logic.
 */

export type WallpaperSourceKind = "x" | "imagine" | "library";

export type WallpaperGalleryItem = {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  kind: "image" | "video" | string;
  width?: number | null;
  height?: number | null;
  source: WallpaperSourceKind | string;
  username?: string | null;
  postUrl?: string | null;
  textPreview?: string | null;
  likes?: number | null;
  localPath?: string | null;
  prompt?: string | null;
};

export type WallpaperSearchResult = {
  items: WallpaperGalleryItem[];
  errorCode?: string | null;
  message?: string | null;
};

export type WallpaperFetchResult = {
  path: string;
  mime: string;
  bytes: number;
  name: string;
};

export type WallpaperLibraryEntry = {
  path: string;
  name: string;
  source: string;
  kind: string;
  bytes: number;
  modifiedMs: number;
};

export type WallpaperSourceErrorCode =
  | "auth_required"
  | "cli_missing"
  | "search_failed"
  | "empty"
  | "download_failed"
  | "url_blocked"
  | "imagine_failed"
  | "timeout"
  | "generic";

/** Map host error strings / codes to a stable UI code. */
export function parseWallpaperSourceError(err: unknown): WallpaperSourceErrorCode {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
  const s = raw.toLowerCase();
  if (s.includes("auth_required")) return "auth_required";
  if (s.includes("cli_missing")) return "cli_missing";
  if (
    s.includes("url_blocked") ||
    s.includes("path_not_allowed") ||
    s.includes("path_denied")
  ) {
    return "url_blocked";
  }
  // Local media:// / path reads used when applying Imagine / library items
  if (
    s.includes("download_failed") ||
    s.includes("read_failed") ||
    s.includes("short read") ||
    (s.includes("download") && !s.includes("delete"))
  ) {
    return "download_failed";
  }
  if (s.includes("desktop_only")) return "generic";
  // timeout before imagine so "imagine timeout" is not swallowed as imagine_failed
  if (s.includes("timeout") || s.includes("timed out")) return "timeout";
  if (s.includes("imagine_failed")) return "imagine_failed";
  // wallpaper_imagine command path failures (not every string with "imagine")
  if (s.includes("wallpaper_imagine") || /\bimagine\b/.test(s)) {
    return "imagine_failed";
  }
  if (s.includes("empty")) return "empty";
  if (s.includes("search_failed") || s.includes("search")) return "search_failed";
  // delete soft-fail stays generic — UI shows warn without inventing success
  if (s.includes("delete_failed")) return "generic";
  return "generic";
}

export function errorCodeFromSearchResult(
  result: WallpaperSearchResult,
): WallpaperSourceErrorCode | null {
  if (result.items.length > 0) return null;
  const code = (result.errorCode || "").toLowerCase();
  if (!code) return "empty";
  if (code === "auth_required") return "auth_required";
  if (code === "cli_missing") return "cli_missing";
  if (code === "search_failed") return "search_failed";
  if (code === "imagine_failed") return "imagine_failed";
  if (code === "empty") return "empty";
  if (code === "timeout") return "timeout";
  return "generic";
}

/** Deduplicate gallery items by fullUrl / localPath. */
export function dedupeGalleryItems(
  items: WallpaperGalleryItem[],
): WallpaperGalleryItem[] {
  const seen = new Set<string>();
  const out: WallpaperGalleryItem[] = [];
  for (const it of items) {
    const key = (it.localPath || it.fullUrl || it.id).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Loopback media HTTP (and legacy media://) answers bare GETs of large files
 * with **206 + first 2 MiB only** (video Range streaming). A naive
 * `fetch(url).blob()` therefore truncates Imagine PNGs / large X downloads and
 * `prepareWallpaperFromFile` fails with a cryptic decode error. Always
 * reassemble via Range (or accept a true 200).
 *
 * Exported for unit tests.
 */
export const MEDIA_PROTO_CHUNK = 2 * 1024 * 1024;

/** Parse `Content-Range: bytes start-end/total` → total length. */
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const m = /bytes\s+\d+-\d+\/(\d+)\s*$/i.exec(header.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Fetch an entire media HTTP (or legacy media://) resource, reassembling Range chunks.
 *
 * `opts.chunkSize` is for unit tests only (default = media protocol 2 MiB).
 */
export async function fetchEntireMediaBlob(
  url: string,
  fetchImpl: typeof fetch = fetch,
  opts?: { chunkSize?: number },
): Promise<Blob> {
  const chunkSize = opts?.chunkSize ?? MEDIA_PROTO_CHUNK;
  // Probe total size with a 1-byte Range (media protocol always supports it).
  const probe = await fetchImpl(url, {
    headers: { Range: "bytes=0-0" },
  });
  if (!(probe.ok || probe.status === 206)) {
    throw new Error(`read_failed: HTTP ${probe.status}`);
  }

  const totalFromRange = parseContentRangeTotal(
    probe.headers.get("content-range"),
  );
  // Consume probe body so the connection can close cleanly.
  try {
    await probe.arrayBuffer();
  } catch {
    /* ignore */
  }

  if (totalFromRange === 0) {
    return new Blob([]);
  }

  // No Content-Range → host returned a full 200 for the probe; just GET once.
  if (totalFromRange == null) {
    const full = await fetchImpl(url);
    if (!full.ok) {
      throw new Error(`read_failed: HTTP ${full.status}`);
    }
    return full.blob();
  }

  if (totalFromRange <= chunkSize) {
    const one = await fetchImpl(url, {
      headers: { Range: `bytes=0-${totalFromRange - 1}` },
    });
    if (!(one.ok || one.status === 206)) {
      throw new Error(`read_failed: HTTP ${one.status}`);
    }
    return one.blob();
  }

  const parts: Blob[] = [];
  let got = 0;
  for (let start = 0; start < totalFromRange; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalFromRange - 1);
    const part = await fetchImpl(url, {
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (!(part.ok || part.status === 206)) {
      throw new Error(`read_failed: HTTP ${part.status} at ${start}-${end}`);
    }
    const blob = await part.blob();
    got += blob.size;
    parts.push(blob);
  }
  if (got < totalFromRange) {
    throw new Error(
      `read_failed: short read (${got}/${totalFromRange} bytes)`,
    );
  }
  return new Blob(parts);
}

/** Bounded raw Tauri IPC chunk size (must match Host `MAX_IPC_CHUNK`). */
export const MEDIA_IPC_CHUNK = 8 * 1024 * 1024;

/** Wallpaper video ceiling (must match Host `MAX_IPC_FILE`). */
export const MEDIA_IPC_MAX_FILE = 200 * 1024 * 1024;

type MediaFileInfo = {
  bytes: number;
  mime: string;
  name: string;
};

type MediaInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

function ipcBytesToArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
  }
  // Normalize test doubles and bridges that serialize byte buffers as arrays.
  // Production Tauri returns an ArrayBuffer for `tauri::ipc::Response`.
  if (
    Array.isArray(value) &&
    value.every(
      (byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255,
    )
  ) {
    return Uint8Array.from(value as number[]).buffer;
  }
  throw new Error("read_failed: invalid IPC byte response");
}

/**
 * Read a complete allowlisted media file through bounded raw Tauri IPC.
 *
 * WebView2 can reject page-script `fetch()` to 127.0.0.1 before the request
 * reaches the Host CORS handler. Raw IPC avoids that browser network gate
 * while the Host still enforces `path_scope` and a 200 MiB total cap.
 * `opts.chunkSize` is for unit tests only.
 */
export async function readLocalMediaBlobViaIpc(
  absolutePath: string,
  invokeImpl?: MediaInvoke,
  opts?: { chunkSize?: number },
): Promise<{ blob: Blob; info: MediaFileInfo }> {
  const invoke: MediaInvoke =
    invokeImpl ?? ((await import("@tauri-apps/api/core")).invoke as MediaInvoke);
  const rawInfo = await invoke("media_file_info", {
    path: absolutePath,
  });
  if (!rawInfo || typeof rawInfo !== "object") {
    throw new Error("read_failed: invalid media metadata");
  }

  const candidate = rawInfo as Partial<MediaFileInfo>;
  const bytes = Number(candidate.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MEDIA_IPC_MAX_FILE) {
    throw new Error("read_failed: invalid media size");
  }
  const chunkSize = opts?.chunkSize ?? MEDIA_IPC_CHUNK;
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > MEDIA_IPC_CHUNK
  ) {
    throw new Error("read_failed: invalid IPC chunk size");
  }

  const info: MediaFileInfo = {
    bytes,
    mime:
      typeof candidate.mime === "string" && candidate.mime.trim()
        ? candidate.mime
        : "application/octet-stream",
    name:
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name
        : absolutePath.split(/[/\\]/).pop() || "wallpaper",
  };

  const parts: ArrayBuffer[] = [];
  let got = 0;
  for (let offset = 0; offset < bytes; offset += chunkSize) {
    const length = Math.min(chunkSize, bytes - offset);
    const raw = await invoke("media_read_file_chunk", {
      path: absolutePath,
      offset,
      length,
    });
    const part = ipcBytesToArrayBuffer(raw);
    if (part.byteLength !== length) {
      throw new Error(
        `read_failed: short IPC read (${part.byteLength}/${length} bytes at ${offset})`,
      );
    }
    got += part.byteLength;
    parts.push(part);
  }
  if (got !== bytes) {
    throw new Error(`read_failed: short IPC read (${got}/${bytes} bytes)`);
  }
  return { blob: new Blob(parts, { type: info.mime }), info };
}

/**
 * Load a local absolute path into a File for prepareWallpaperFromFile.
 * Uses bounded raw Tauri IPC so WebView2 local-network policy cannot block it.
 */
export async function fileFromAbsolutePath(
  absolutePath: string,
  opts?: { name?: string; mime?: string },
): Promise<File> {
  // Browser / unit tests: no Tauri
  if (
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  ) {
    throw new Error("desktop_only");
  }

  let result: Awaited<ReturnType<typeof readLocalMediaBlobViaIpc>>;
  try {
    result = await readLocalMediaBlobViaIpc(absolutePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("path_not_allowed")) throw new Error("path_not_allowed");
    if (msg.startsWith("read_failed")) throw e instanceof Error ? e : new Error(msg);
    throw new Error(`read_failed: ${msg}`);
  }

  const { blob, info } = result;
  if (!blob.size) {
    throw new Error("read_failed: empty file");
  }

  const name =
    opts?.name ||
    info.name ||
    absolutePath.split(/[/\\]/).pop() ||
    "wallpaper.jpg";
  const fallbackMime = mimeFromName(name);
  const type =
    opts?.mime ||
    (blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : fallbackMime);
  return new File([blob], name, { type });
}

/** Prefer local path when present (Imagine / library). */
export function resolveApplySource(
  item: WallpaperGalleryItem,
): { kind: "path"; path: string } | { kind: "url"; url: string } {
  if (item.localPath && item.localPath.trim()) {
    return { kind: "path", path: item.localPath.trim() };
  }
  // file:// from host scan
  if (item.fullUrl.startsWith("file://")) {
    const p = item.fullUrl.replace(/^file:\/\//, "");
    return { kind: "path", path: decodeURIComponent(p) };
  }
  return { kind: "url", url: item.fullUrl };
}

// ── Library (x / imagine disk cache) ─────────────────────────────────────────

/** Stable id for a library disk row (path + mtime). */
export function libraryEntryId(entry: WallpaperLibraryEntry): string {
  const path = (entry.path || "").trim();
  const name = (entry.name || path.split(/[/\\]/).pop() || "file").trim();
  return `library-${entry.modifiedMs}-${name}-${shortHash(path || name)}`;
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** True when library entry is a still image (static-first library apply). */
export function isStaticImageLibraryEntry(
  entry: Pick<WallpaperLibraryEntry, "kind" | "name">,
): boolean {
  const kind = String(entry.kind || "").toLowerCase();
  if (kind === "video" || kind.startsWith("video/")) return false;
  const name = String(entry.name || "").toLowerCase();
  if (/\.(mp4|m4v|webm|mov)(\?|$)/i.test(name)) return false;
  return true;
}

/**
 * Sort library rows with static images first (then by modifiedMs desc).
 * Does not invent rows — only reorders / optionally drops video.
 */
export function sortLibraryEntriesStaticFirst(
  entries: readonly WallpaperLibraryEntry[],
  opts?: { imagesOnly?: boolean },
): WallpaperLibraryEntry[] {
  const imagesOnly = opts?.imagesOnly === true;
  const list = imagesOnly
    ? entries.filter(isStaticImageLibraryEntry)
    : [...entries];
  return list.sort((a, b) => {
    const av = isStaticImageLibraryEntry(a) ? 0 : 1;
    const bv = isStaticImageLibraryEntry(b) ? 0 : 1;
    if (av !== bv) return av - bv;
    return (b.modifiedMs || 0) - (a.modifiedMs || 0);
  });
}

/** Map a host library row to a gallery card (local path only). */
export function libraryEntryToGalleryItem(
  entry: WallpaperLibraryEntry,
): WallpaperGalleryItem {
  const path = (entry.path || "").trim();
  const abs = path.startsWith("file://")
    ? decodeURIComponent(path.replace(/^file:\/\//, ""))
    : path;
  const fileUrl = abs ? `file://${abs}` : "";
  const kind =
    String(entry.kind || "").toLowerCase() === "video" ||
    /\.(mp4|m4v|webm|mov)$/i.test(entry.name || abs)
      ? "video"
      : "image";
  const source = (entry.source || "library").trim() || "library";
  return {
    id: libraryEntryId(entry),
    thumbUrl: fileUrl,
    fullUrl: fileUrl,
    kind,
    source,
    localPath: abs || null,
    textPreview: entry.name || null,
    username: null,
    postUrl: null,
    prompt: null,
    likes: null,
    width: null,
    height: null,
  };
}

/**
 * Convert host library list → gallery items.
 * `staticFirst` (default true): images before video, no invented CDN rows.
 * `imagesOnly`: drop video rows entirely (static-first library apply path).
 */
export function libraryEntriesToGalleryItems(
  entries: readonly WallpaperLibraryEntry[],
  opts?: { staticFirst?: boolean; imagesOnly?: boolean },
): WallpaperGalleryItem[] {
  const staticFirst = opts?.staticFirst !== false;
  const ordered = staticFirst
    ? sortLibraryEntriesStaticFirst(entries, { imagesOnly: opts?.imagesOnly })
    : opts?.imagesOnly
      ? entries.filter(isStaticImageLibraryEntry)
      : [...entries];
  return dedupeGalleryItems(ordered.map(libraryEntryToGalleryItem));
}

