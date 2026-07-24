/**
 * Composer clipboard helpers — paste images/files into attachments.
 *
 * Tauri / WKWebView often omits File objects from the paste event for
 * screenshots (only `image/png` types, or nothing usable). Callers should:
 * 1. collectFilesFromDataTransfer(clipboardData)
 * 2. if empty + clipboardLooksLikeMedia → readClipboardMediaFiles()
 * 3. if still empty → native Host clipboard (arboard)
 */

/** Collect File objects from a paste/drop DataTransfer (deduped). */
export function collectFilesFromDataTransfer(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];
  const fileMap = new Map<string, File>();

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) {
      const f = data.files.item(i);
      if (f) fileMap.set(fileKey(f), f);
    }
  }

  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      // Screenshots: kind "file" + type image/*; some WebViews only expose type.
      if (item.kind === "file" || item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) fileMap.set(fileKey(f), f);
      }
    }
  }

  return Array.from(fileMap.values());
}

function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.type}:${f.lastModified}`;
}

/**
 * True when the paste payload likely carries binary media even if File
 * extraction returned nothing (common for macOS screenshot → WKWebView).
 */
export function clipboardLooksLikeMedia(
  data: DataTransfer | null | undefined,
): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  if (types.some((t) => t === "Files" || t.startsWith("image/"))) return true;
  if (data.files && data.files.length > 0) return true;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      if (item.kind === "file") return true;
      if (item.type.startsWith("image/")) return true;
    }
  }
  return false;
}

/** Plain text from paste (normalized newlines). */
export function clipboardPlainText(
  data: DataTransfer | null | undefined,
): string {
  if (!data) return "";
  const plain =
    data.getData("text/plain") || data.getData("text") || "";
  return plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** file:// only paste — skip inserting as text when we already attached files. */
export function isFileUrlOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^file:\/\//i.test(t) && !t.includes("\n");
}

function extForMime(mime: string): string {
  const m = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/bmp") return "bmp";
  if (m === "image/svg+xml") return "svg";
  if (m.startsWith("image/")) return m.slice("image/".length) || "png";
  return "bin";
}

/**
 * Async Clipboard API fallback (Chromium / some WKWebView builds).
 * Returns empty array when denied, unsupported, or no image items.
 */
export async function readClipboardMediaFiles(): Promise<File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return [];
  }
  try {
    const items = await navigator.clipboard.read();
    const out: File[] = [];
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith("image/") && type !== "application/pdf") continue;
        try {
          const blob = await item.getType(type);
          if (!blob || blob.size === 0) continue;
          const ext = extForMime(type);
          out.push(
            new File([blob], `paste.${ext}`, {
              type: type || blob.type || "application/octet-stream",
              lastModified: Date.now(),
            }),
          );
        } catch {
          /* type not readable */
        }
      }
    }
    return out;
  } catch {
    // NotAllowedError / empty clipboard / no permission
    return [];
  }
}
