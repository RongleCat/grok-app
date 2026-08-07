/**
 * Copy an image onto the system clipboard.
 *
 * Desktop (Tauri): Host arboard is required — WebView ClipboardItem is a silent
 * no-op on macOS WKWebView (Feishu paste empty). Prefer reading the local file
 * via `clipboard_write_image_path` (extracted from media HTTP URLs when needed).
 */

import {
  clipboardWriteImage,
  clipboardWriteImagePath,
  isTauri,
} from "@/lib/api";
import { resolveImageSrc } from "@/lib/imageSrc";

export type CopyImageResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "fetch" | "encode" | "write" };

function canWriteImage(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof ClipboardItem !== "undefined"
  );
}

function looksAbsoluteFsPath(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.startsWith("\\\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  return t.startsWith("/");
}

/**
 * Loopback media URL → absolute filesystem path.
 * Shape: http://127.0.0.1:{port}/v1/media?t=…&p={encodeURIComponent(absPath)}
 */
export function absPathFromMediaHttpUrl(src: string): string | null {
  try {
    const u = new URL(src);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
    if (!u.pathname.includes("/v1/media")) return null;
    const p = u.searchParams.get("p");
    if (!p || !looksAbsoluteFsPath(p)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Blob → base64 (no data: prefix) for Host `clipboard_write_image`. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Draw arbitrary image blob into a PNG blob (clipboard-friendly). */
async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!png) throw new Error("toBlob failed");
    return png;
  } finally {
    bitmap.close();
  }
}

/** Draw a loaded HTMLImageElement into a PNG blob. */
async function htmlImageToPng(img: HTMLImageElement): Promise<Blob> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!(w > 0 && h > 0)) throw new Error("empty image");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!png) throw new Error("toBlob failed");
  return png;
}

async function writePngBlobNative(png: Blob): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const b64 = await blobToBase64(png);
    await clipboardWriteImage(b64);
    return true;
  } catch {
    return false;
  }
}

async function writePngBlobWeb(png: Blob): Promise<boolean> {
  if (!canWriteImage()) return false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function writeLocalPath(path: string): Promise<boolean> {
  if (!isTauri() || !looksAbsoluteFsPath(path)) return false;
  try {
    await clipboardWriteImagePath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy from an already-loaded <img> (chat card). Tries path → media URL path →
 * canvas → fetch.
 */
export async function copyImageFromHtmlImage(
  img: HTMLImageElement,
  opts?: { localPath?: string | null },
): Promise<CopyImageResult> {
  const local = (opts?.localPath || "").trim();
  if (local && (await writeLocalPath(local))) return { ok: true };

  const src = (img.currentSrc || img.src || "").trim();
  const fromMedia = absPathFromMediaHttpUrl(src);
  if (fromMedia && (await writeLocalPath(fromMedia))) return { ok: true };

  if (looksAbsoluteFsPath(src) && (await writeLocalPath(src))) {
    return { ok: true };
  }

  // Canvas from the painted pixels (works when same-origin / CORS-clean).
  try {
    const png = await htmlImageToPng(img);
    if (await writePngBlobNative(png)) return { ok: true };
    if (await writePngBlobWeb(png)) return { ok: true };
  } catch {
    /* tainted canvas or empty */
  }

  if (src) return copyImageFromSrc(src);
  return { ok: false, reason: "write" };
}

/**
 * Copy image at `src` (viewable URL / data URL / media HTTP) to clipboard as PNG.
 */
export async function copyImageFromSrc(src: string): Promise<CopyImageResult> {
  const trimmed = (src || "").trim();
  if (!trimmed) return { ok: false, reason: "fetch" };

  if (await writeLocalPath(trimmed)) return { ok: true };

  const fromMedia = absPathFromMediaHttpUrl(trimmed);
  if (fromMedia && (await writeLocalPath(fromMedia))) return { ok: true };

  let blob: Blob;
  try {
    const res = await fetch(trimmed);
    if (!res.ok) return { ok: false, reason: "fetch" };
    blob = await res.blob();
  } catch {
    return { ok: false, reason: "fetch" };
  }

  let png: Blob;
  try {
    png = await blobToPng(blob);
  } catch {
    return { ok: false, reason: "encode" };
  }

  if (await writePngBlobNative(png)) return { ok: true };
  if (await writePngBlobWeb(png)) return { ok: true };
  return {
    ok: false,
    reason: canWriteImage() || isTauri() ? "write" : "unsupported",
  };
}

/**
 * Copy image from a local absolute path (or already-viewable URL).
 */
export async function copyImageFromPath(
  pathOrUrl: string,
): Promise<CopyImageResult> {
  const raw = (pathOrUrl || "").trim();
  if (!raw) return { ok: false, reason: "fetch" };

  if (await writeLocalPath(raw)) return { ok: true };

  const fromMedia = absPathFromMediaHttpUrl(raw);
  if (fromMedia && (await writeLocalPath(fromMedia))) return { ok: true };

  const src = await resolveImageSrc(raw);
  if (!src) return { ok: false, reason: "fetch" };
  return copyImageFromSrc(src);
}
