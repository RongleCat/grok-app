/**
 * Resolve a previewable URL for local files.
 * Video / audio / PDF / large binary use the Host loopback media HTTP server
 * (HTTP Range, bounded chunks) so multi‑GB files never load fully into memory.
 * HTML is rendered via HtmlBrowser (srcDoc) — not via this URL helper —
 * because `file://` is blocked inside Tauri's main webview iframes.
 */

import type { FsReadResult } from "@/lib/api";
import { isTauri } from "@/lib/api";
import {
  ensureMediaEndpoint,
  localPathToMediaHttpUrl,
  resolveImageSrcSync,
} from "@/lib/imageSrc";

/** Prefer Range-capable media HTTP for streaming kinds (not HTML). */
function useMediaHttp(kind: string): boolean {
  return (
    kind === "video" ||
    kind === "audio" ||
    kind === "pdf" ||
    kind === "image"
  );
}

/** Kinds that load binary via media URL for rich client-side render. */
export function isOfficeKind(kind: string): boolean {
  return (
    kind === "docx" ||
    kind === "xlsx" ||
    kind === "pptx" ||
    kind === "odf" ||
    kind === "office" ||
    kind === "pdf"
  );
}

/**
 * Absolute filesystem path → `file://` URL (encode segments; keep `/`).
 * Used for local HTML so relative CSS/JS resolve like a real browser tab.
 */
export function pathToFileUrl(absolutePath: string): string {
  let p = absolutePath.trim().replace(/\\/g, "/");
  if (!p) return "";
  // Windows drive → file:///C:/...
  const win = p.match(/^([A-Za-z]:)(\/.*)?$/);
  if (win) {
    const drive = win[1]!;
    const rest = win[2] || "/";
    const segs = rest.split("/").map((s) => (s ? encodeURIComponent(s) : ""));
    return `file:///${drive}${segs.join("/")}`;
  }
  if (!p.startsWith("/")) p = `/${p}`;
  const segs = p.split("/").map((s, i) => (i === 0 || !s ? "" : encodeURIComponent(s)));
  // segs[0] is empty before first / → join gives leading /
  return `file://${segs.join("/")}`;
}

/**
 * Convert absolute path → URL the webview can load.
 * Loopback media HTTP for range streaming kinds; image helper for the rest.
 */
export async function pathToPreviewUrl(
  absolutePath: string,
  kind?: string,
): Promise<string | null> {
  if (!absolutePath) return null;
  // HTML is handled by HtmlBrowser (srcDoc); asset URL is only a fetch fallback
  if (!isTauri()) {
    if (kind === "html") return pathToFileUrl(absolutePath);
    return null;
  }

  await ensureMediaEndpoint();

  if (!kind || useMediaHttp(kind) || isOfficeKind(kind)) {
    const http = localPathToMediaHttpUrl(absolutePath);
    if (http) return http;
  }

  // Shared path with chat images (HTTP or cold-start media:// fallback).
  return resolveImageSrcSync(absolutePath);
}

export async function resolvePreviewSrc(
  preview: FsReadResult,
): Promise<string | null> {
  // HTML: don't put file:// into iframe src (blank). HtmlBrowser uses text/srcDoc.
  if (preview.kind === "html") {
    return null;
  }

  // Prefer stream path for video/audio/pdf/large image
  if (preview.stream && preview.absolutePath && isTauri()) {
    const url = await pathToPreviewUrl(preview.absolutePath, preview.kind);
    if (url) return url;
  }

  if (preview.base64 && preview.mime) {
    return `data:${preview.mime};base64,${preview.base64}`;
  }

  // Streamable kinds without flag (legacy) still try absolute path
  if (
    preview.absolutePath &&
    isTauri() &&
    (preview.kind === "video" ||
      preview.kind === "audio" ||
      preview.kind === "pdf" ||
      preview.kind === "image" ||
      isOfficeKind(preview.kind))
  ) {
    return pathToPreviewUrl(preview.absolutePath, preview.kind);
  }

  return null;
}

/** Fetch local file bytes for office renderers (docx-preview / xlsx / pdfjs). */
export async function fetchPreviewArrayBuffer(
  absolutePath: string,
  kind?: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  const url = await pathToPreviewUrl(absolutePath, kind);
  if (!url) {
    throw new Error("cannot resolve local file URL");
  }
  // Large files: assemble Range chunks (server caps each response at 2 MiB).
  return fetchViaRange(url, { kind, signal });
}

export const OFFICE_PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
export const PDF_PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
const PREVIEW_RANGE_CHUNK_BYTES = 2 * 1024 * 1024;

interface FetchViaRangeOptions {
  kind?: string;
  signal?: AbortSignal;
  /** Test seam; production uses the browser's fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam; production always uses the media server's 2 MiB window. */
  chunkSize?: number;
}

interface ParsedContentRange {
  start: number;
  end: number;
  total: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function previewBudget(kind?: string): { maxBytes: number; label: "office" | "pdf" } {
  return kind === "pdf"
    ? { maxBytes: PDF_PREVIEW_MAX_BYTES, label: "pdf" }
    : { maxBytes: OFFICE_PREVIEW_MAX_BYTES, label: "office" };
}

function parseContentRange(header: string | null): ParsedContentRange | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

function validateContentLength(response: Response, expected: number): void {
  const raw = response.headers.get("content-length");
  if (raw == null) return;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length !== expected) {
    throw new Error("invalid Content-Length for preview range");
  }
}

function tooLargeError(label: "office" | "pdf", maxBytes: number): Error {
  return new Error(
    `file too large for in-app ${label} preview (max ${maxBytes} bytes)`,
  );
}

/**
 * Fetch a full rich-document body using bounded, validated Range windows.
 * Exported for deterministic regression tests.
 */
export async function fetchViaRange(
  url: string,
  options: FetchViaRangeOptions = {},
): Promise<ArrayBuffer> {
  const { maxBytes, label } = previewBudget(options.kind);
  const fetchImpl = options.fetchImpl ?? fetch;
  const chunkSize = options.chunkSize ?? PREVIEW_RANGE_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("invalid preview range chunk size");
  }
  throwIfAborted(options.signal);
  const first = await fetchImpl(url, { signal: options.signal });
  if (!first.ok) {
    throw new Error(`failed to load file (${first.status})`);
  }

  // Full body available
  if (first.status === 200) {
    const announcedLength = Number(first.headers.get("content-length"));
    if (Number.isFinite(announcedLength) && announcedLength > maxBytes) {
      throw tooLargeError(label, maxBytes);
    }
    const full = await first.arrayBuffer();
    if (full.byteLength > maxBytes) throw tooLargeError(label, maxBytes);
    return full;
  }

  if (first.status !== 206) {
    throw new Error(`failed to load file (${first.status})`);
  }

  // Validate the advertised total before reading or allocating the response.
  const initialRange = parseContentRange(first.headers.get("content-range"));
  if (!initialRange || initialRange.start !== 0) {
    throw new Error("invalid Content-Range for preview response");
  }
  if (initialRange.total > maxBytes) {
    throw tooLargeError(label, maxBytes);
  }
  const expectedInitialEnd =
    Math.min(initialRange.total, chunkSize) - 1;
  if (initialRange.end !== expectedInitialEnd) {
    throw new Error("invalid Content-Range for preview response");
  }
  const initialLength = expectedInitialEnd + 1;
  validateContentLength(first, initialLength);
  const firstBuf = new Uint8Array(await first.arrayBuffer());
  if (firstBuf.byteLength !== initialLength) {
    throw new Error("invalid preview range body length");
  }

  // Allocate once after the strict budget check, then copy one bounded chunk at
  // a time. This avoids retaining the whole file in chunks plus a second copy.
  const out = new Uint8Array(initialRange.total);
  out.set(firstBuf, 0);
  let next = initialRange.end + 1;

  while (next < initialRange.total) {
    throwIfAborted(options.signal);
    const requestedEnd = Math.min(
      next + chunkSize - 1,
      initialRange.total - 1,
    );
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=${next}-${requestedEnd}` },
      signal: options.signal,
    });
    if (!res.ok || res.status !== 206) {
      throw new Error(`failed to load file range (${res.status})`);
    }
    const range = parseContentRange(res.headers.get("content-range"));
    if (
      !range ||
      range.start !== next ||
      range.end !== requestedEnd ||
      range.total !== initialRange.total
    ) {
      throw new Error("invalid Content-Range for preview response");
    }
    const expectedLength = range.end - range.start + 1;
    validateContentLength(res, expectedLength);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength !== expectedLength) {
      throw new Error("invalid preview range body length");
    }
    out.set(buf, range.start);
    next = range.end + 1;
  }

  return out.buffer;
}
