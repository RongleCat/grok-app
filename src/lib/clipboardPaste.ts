/**
 * Composer clipboard helpers — paste images/files into attachments.
 *
 * Tauri / WKWebView often omits File objects from the paste event for
 * screenshots (only `image/png` types, or nothing usable). Callers should:
 * 1. collectFilesFromDataTransfer(clipboardData)
 * 2. if OS file-list paste (Explorer/Finder) → native Host file paths
 * 3. if empty + clipboardLooksLikeMedia → readClipboardMediaFiles()
 * 4. if still empty → native Host clipboard image (arboard)
 *
 * Always dedupe before attach: WebViews often expose the same blob via both
 * `data.files` and `data.items`, or multiple image/* MIME flavors.
 */

/** Collect File objects from a paste/drop DataTransfer (deduped). */
export function collectFilesFromDataTransfer(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data) return [];
  const fileMap = new Map<string, File>();

  const add = (f: File | null | undefined) => {
    if (!f || f.size <= 0) return;
    const key = fileKey(f);
    if (!fileMap.has(key)) fileMap.set(key, f);
  };

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) {
      add(data.files.item(i));
    }
  }

  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      // Screenshots: kind "file" + type image/*; some WebViews only expose type.
      if (item.kind === "file" || item.type.startsWith("image/")) {
        add(item.getAsFile());
      }
    }
  }

  return Array.from(fileMap.values());
}

/** Absolute path on Tauri/WebView File objects when the host filled it in. */
export function fileNativePath(f: File): string {
  const p = (f as File & { path?: string }).path;
  return typeof p === "string" ? p.trim() : "";
}

/**
 * Explorer / Finder file copy. Distinct from a screenshot (`image/png` types
 * with no `Files` list): WebView File blobs from CF_HDROP are often
 * unreadable (`NotReadableError`), so the Host must use native paths.
 */
export function clipboardLooksLikeOsFiles(
  data: DataTransfer | null | undefined,
): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  if (types.some((t) => t === "Files" || t === "text/uri-list")) return true;
  if (data.files && data.files.length > 0) return true;
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      if (item.kind === "file" && !item.type.startsWith("image/")) return true;
    }
  }
  return false;
}

/** Chromium/WebView2 cannot read the pasted File blob (locked / sandboxed). */
export function isNotReadableBlobError(err: unknown): boolean {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name)
      : "";
  if (name === "NotReadableError") return true;
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : err == null
        ? ""
        : String(err);
  return /notreadableerror|could not be read, typically due to permission/i.test(
    msg,
  );
}

/**
 * Stable identity for paste/drop File objects.
 * Do not use `lastModified`: `files` vs `items.getAsFile()` often return
 * distinct wrappers with different timestamps for the same payload.
 */
export function fileKey(f: File): string {
  const name = (f.name || "").trim().toLowerCase();
  const type = (f.type || "").trim().toLowerCase();
  // Generic clipboard names vary by OS; size+type is the real identity.
  if (
    !name ||
    name === "image.png" ||
    name === "image.jpg" ||
    name === "image.jpeg" ||
    name === "blob" ||
    name === "null" ||
    name.startsWith("paste.")
  ) {
    return `anon:${f.size}:${type || "application/octet-stream"}`;
  }
  return `${name}:${f.size}:${type}`;
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

/** Prefer a single representation per clipboard item (avoid png+jpeg doubles). */
function pickPreferredMediaType(types: readonly string[]): string | null {
  const media = types.filter(
    (t) => t.startsWith("image/") || t === "application/pdf",
  );
  if (!media.length) return null;
  const rank = (t: string): number => {
    if (t === "image/png") return 0;
    if (t === "image/jpeg" || t === "image/jpg") return 1;
    if (t === "image/webp") return 2;
    if (t === "image/gif") return 3;
    if (t === "application/pdf") return 4;
    return 10;
  };
  return [...media].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Async Clipboard API fallback (Chromium / some WKWebView builds).
 * Returns empty array when denied, unsupported, or no image items.
 * At most one file per ClipboardItem (OS often exposes several image/* flavors).
 */
export async function readClipboardMediaFiles(): Promise<File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return [];
  }
  try {
    const items = await navigator.clipboard.read();
    const out: File[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const type = pickPreferredMediaType(item.types);
      if (!type) continue;
      try {
        const blob = await item.getType(type);
        if (!blob || blob.size === 0) continue;
        const mime = type || blob.type || "application/octet-stream";
        const ext = extForMime(mime);
        const file = new File([blob], `paste.${ext}`, {
          type: mime,
          lastModified: Date.now(),
        });
        const key = fileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(file);
      } catch {
        /* type not readable */
      }
    }
    return out;
  } catch {
    // NotAllowedError / empty clipboard / no permission
    return [];
  }
}
