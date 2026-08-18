/**
 * File drag-drop helpers (HTML5 DataTransfer + Tauri native path events).
 *
 * Windows WebView2: Tauri's native handler *replaces* the WebView2 drop
 * target, so HTML5 `Files` is empty unless `dragDropEnabled` is false.
 * See tauri.windows.conf.json. Path-less File blobs are saved via Host temp.
 */

import { dataTransferHasSession } from "@/lib/chatAttach";

/** How long HTML5 drop should yield to a just-handled Tauri OS drop. */
export const HTML5_NATIVE_DROP_GUARD_MS = 400;

/** True when this drag looks like OS files (Explorer / Finder / Nautilus). */
export function isFileDrag(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  // Sidebar → composer attach-chat. WKWebView may also list `Files`.
  if (dataTransferHasSession(data)) return false;
  const types = Array.from(data.types ?? []);
  if (
    types.includes("Files") ||
    types.includes("application/x-moz-file") ||
    types.includes("text/uri-list")
  ) {
    return true;
  }
  if (data.files && data.files.length > 0) return true;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind === "file") return true;
    }
  }
  return false;
}

/** Absolute paths from WebView `File.path` (Electron / some WKWebView). */
export function pathsFromDroppedFiles(files: Iterable<File>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const path = ((f as File & { path?: string }).path || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Skip the HTML5 fallback when Tauri already consumed this OS drop.
 * Prevents a second temp-file attach of the same Explorer/Finder files.
 */
export function shouldSkipHtml5AfterNative(
  nativeDropAtMs: number,
  nowMs: number,
  windowMs: number = HTML5_NATIVE_DROP_GUARD_MS,
): boolean {
  if (!(nativeDropAtMs > 0) || !(nowMs >= 0)) return false;
  const dt = nowMs - nativeDropAtMs;
  return dt >= 0 && dt < windowMs;
}
