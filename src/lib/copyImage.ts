/**
 * Copy an image (from URL / data URL / asset protocol) onto the system clipboard.
 * ClipboardItem typically requires image/png — we convert when needed.
 *
 * In Tauri, prefer the native `clipboard_write_image` command (arboard). WebView
 * `navigator.clipboard.write(image/png)` is unreliable on macOS WKWebView and
 * often fails silently so paste into Feishu / other apps gets nothing.
 */

import { clipboardWriteImage, isTauri } from "@/lib/api";
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

/**
 * Copy image at `src` (viewable URL) to clipboard as PNG.
 */
export async function copyImageFromSrc(src: string): Promise<CopyImageResult> {
  let blob: Blob;
  try {
    const res = await fetch(src);
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

  // Prefer native OS clipboard (arboard). WebView ClipboardItem often fails.
  if (isTauri()) {
    try {
      const b64 = await blobToBase64(png);
      await clipboardWriteImage(b64);
      return { ok: true };
    } catch {
      /* fall through to web clipboard */
    }
  }

  if (!canWriteImage()) return { ok: false, reason: "unsupported" };

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return { ok: true };
  } catch {
    return { ok: false, reason: "write" };
  }
}

/**
 * Copy image from a local absolute path (or already-viewable URL).
 */
export async function copyImageFromPath(
  pathOrUrl: string,
): Promise<CopyImageResult> {
  const src = await resolveImageSrc(pathOrUrl);
  if (!src) return { ok: false, reason: "fetch" };
  return copyImageFromSrc(src);
}
