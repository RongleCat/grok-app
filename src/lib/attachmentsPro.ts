/**
 * ATTACHMENTS-PRO — pure helpers for composer attach paste / drop / pick
 * and attachment preview honesty.
 *
 * Classifies host / WebView failures into stable kinds for i18n labels,
 * silent cancel, and never invents “attached” / “ready” without signals.
 * No DOM / Tauri side effects.
 */

/** Host paste cap (matches `save_temp_attachment` / clipboard paste). */
export const ATTACHMENT_PASTE_MAX_BYTES = 40 * 1024 * 1024;

/** Stable failure modes for paste, drop, pick, open, and preview. */
export type AttachErrorKind =
  | "empty"
  | "too_large"
  | "invalid_payload"
  | "write_failed"
  | "clipboard_open"
  | "clipboard_image"
  | "no_media"
  | "host_only"
  | "dropped_none"
  | "paths_failed"
  | "cancelled"
  | "unsupported"
  | "open_failed"
  | "preview_failed"
  | "unreadable"
  | "other";

/** Where the failure was observed (affects default copy slightly). */
export type AttachErrorSource =
  | "paste"
  | "drop"
  | "pick"
  | "native_clipboard"
  | "open"
  | "preview"
  | "other";

/**
 * Honest image/thumb lifecycle for chips and cards.
 * `ready` only when a loadable src exists and has not failed.
 * Never invent success for missing paths.
 */
export type AttachPreviewPhase =
  | "idle"
  | "pending"
  | "ready"
  | "broken"
  | "missing";

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as { code?: unknown; message?: unknown; reason?: unknown };
    const parts = [o.code, o.message, o.reason]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
  }
  return "";
}

/**
 * Classify a thrown value / host error into a stable kind.
 * Prefer explicit `code` and known host messages over free-form text.
 */
export function classifyAttachError(err: unknown): AttachErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (code === "cancelled" || code === "cancel" || code === "user_cancelled") {
    return "cancelled";
  }
  if (code === "unsupported") return "unsupported";
  if (code === "empty" || code === "empty_payload") return "empty";
  if (code === "too_large" || code === "too-large") return "too_large";
  if (code === "host_only" || code === "need_tauri") return "host_only";
  if (code === "no_media" || code === "no-media" || code === "no_image") {
    return "no_media";
  }
  if (code === "dropped_none" || code === "dropped-none") return "dropped_none";
  if (code === "clipboard_open" || code === "clipboard-open") {
    return "clipboard_open";
  }
  if (code === "clipboard_image" || code === "clipboard-image") {
    return "clipboard_image";
  }
  if (code === "write_failed" || code === "write-failed") return "write_failed";
  if (code === "invalid_payload" || code === "invalid-payload") {
    return "invalid_payload";
  }
  if (code === "open_failed" || code === "open-failed") return "open_failed";
  if (code === "preview_failed" || code === "preview-failed") {
    return "preview_failed";
  }
  if (code === "unreadable" || code === "not_readable" || code === "notreadableerror") {
    return "unreadable";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // User dismissed native picker / dialog — silent.
  if (
    /\bcancel(led)?\b/.test(s) ||
    s.includes("user cancelled") ||
    s.includes("user canceled") ||
    s.includes("dismissed")
  ) {
    return "cancelled";
  }

  if (s.includes("unsupported") || code === "unsupported") {
    return "unsupported";
  }

  // Host: empty attachment payload / empty image
  if (
    s.includes("empty attachment payload") ||
    s.includes("clipboard image payload is empty") ||
    s.trim() === "empty" ||
    s.trim() === "empty image" ||
    s.includes("empty image")
  ) {
    return "empty";
  }

  // Host: attachment too large (max 40 MiB)
  if (
    s.includes("too large") ||
    s.includes("max 40") ||
    s.includes("40 mib") ||
    s.includes("40mb")
  ) {
    return "too_large";
  }

  // Host: invalid base64 / decode
  if (
    s.includes("invalid base64") ||
    s.includes("base64") ||
    s.includes("decode image") ||
    s.includes("png encode")
  ) {
    return "invalid_payload";
  }

  // Host: write attachment: …
  if (
    s.includes("write attachment") ||
    s.includes("could not write") ||
    s.includes("failed to write") ||
    (s.includes("write") && s.includes("attachment"))
  ) {
    return "write_failed";
  }

  // Host: clipboard open: …
  if (
    s.includes("clipboard open") ||
    s.includes("clipboard task") ||
    (s.includes("clipboard") && (s.includes("permission") || s.includes("denied")))
  ) {
    return "clipboard_open";
  }

  // Host: clipboard image: … / truncated
  if (
    s.includes("clipboard image") ||
    s.includes("clipboard image truncated") ||
    s.includes("rgba buffer") ||
    s.includes("truncated")
  ) {
    return "clipboard_image";
  }

  if (
    s.includes("no image") ||
    s.includes("no media") ||
    s.includes("content not available") ||
    s.includes("clipboard is empty")
  ) {
    return "no_media";
  }

  if (
    s.includes("need tauri") ||
    s.includes("desktop only") ||
    s.includes("host only") ||
    s.includes("not available in browser")
  ) {
    return "host_only";
  }

  if (
    s.includes("could not read dropped") ||
    s.includes("dropped none") ||
    s.includes("no paths") ||
    s.includes("dropped paths")
  ) {
    return "dropped_none";
  }

  if (
    s.includes("path open") ||
    s.includes("failed to open") ||
    s.includes("open path") ||
    s.includes("no application")
  ) {
    return "open_failed";
  }

  if (
    s.includes("preview") &&
    (s.includes("fail") || s.includes("error") || s.includes("load"))
  ) {
    return "preview_failed";
  }

  if (
    s.includes("failed to load") ||
    s.includes("load file") ||
    s.includes("cannot resolve")
  ) {
    return "preview_failed";
  }

  // WebView2 / Chromium: Explorer-copied files (esp. .dmp) fail File.arrayBuffer().
  if (
    s.includes("notreadableerror") ||
    s.includes("could not be read, typically due to permission") ||
    s.includes("not readable")
  ) {
    return "unreadable";
  }

  // Generic path classify / attach path failures
  if (
    s.includes("paths_classify") ||
    s.includes("classify") && s.includes("path")
  ) {
    return "paths_failed";
  }

  return "other";
}

/**
 * i18n message key for a classified attach error.
 * Keep keys stable; map source only when it improves honesty.
 */
export function attachErrorMessageKey(
  kind: AttachErrorKind,
  source: AttachErrorSource = "other",
): string {
  switch (kind) {
    case "empty":
      return "attach.err.empty";
    case "too_large":
      return "attach.err.tooLarge";
    case "invalid_payload":
      return "attach.err.invalidPayload";
    case "write_failed":
      return "attach.err.writeFailed";
    case "clipboard_open":
      return "attach.err.clipboardOpen";
    case "clipboard_image":
      return "attach.err.clipboardImage";
    case "no_media":
      return "attach.err.noMedia";
    case "host_only":
      return "attach.err.hostOnly";
    case "dropped_none":
      return "attach.droppedNone";
    case "paths_failed":
      return "attach.err.pathsFailed";
    case "cancelled":
      return "attach.err.cancelled";
    case "unsupported":
      return "mirror.unsupported";
    case "open_failed":
      return "attach.err.openFailed";
    case "preview_failed":
      return "attach.err.previewFailed";
    case "unreadable":
      return "attach.err.unreadable";
    case "other":
    default:
      if (source === "paste" || source === "native_clipboard") {
        return "composer.attachPasteFailed";
      }
      if (source === "drop") return "attach.droppedNone";
      if (source === "pick") return "composer.attachPickedNone";
      return "composer.attachPasteFailed";
  }
}

/** Cancelled pick / dialog should not toast as a failure. */
export function attachErrorSilent(kind: AttachErrorKind): boolean {
  return kind === "cancelled";
}

/**
 * Resolve user-facing error copy from a thrown value.
 * Returns message key + whether to stay silent + optional short detail.
 */
export function resolveAttachError(
  err: unknown,
  source: AttachErrorSource = "other",
): {
  kind: AttachErrorKind;
  messageKey: string;
  silent: boolean;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifyAttachError(err);
  const messageKey = attachErrorMessageKey(kind, source);
  const silent = attachErrorSilent(kind);
  const raw = errText(err).trim();
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, silent, detail };
}

/**
 * When native clipboard returns no path:
 * - expectMedia true → honest “no image” (user clearly pasted media)
 * - expectMedia false → silent (soft try on empty-looking paste)
 */
export function resolveNativeClipboardEmpty(opts?: {
  expectMedia?: boolean;
}): {
  kind: AttachErrorKind;
  messageKey: string;
  silent: boolean;
  detail: string;
} {
  if (opts?.expectMedia) {
    return {
      kind: "no_media",
      messageKey: attachErrorMessageKey("no_media", "native_clipboard"),
      silent: false,
      detail: "",
    };
  }
  return {
    kind: "no_media",
    messageKey: attachErrorMessageKey("no_media", "native_clipboard"),
    silent: true,
    detail: "",
  };
}

/** Browser / non-Tauri cannot persist Web File blobs for @path. */
export function resolveHostOnlyAttach(source: AttachErrorSource = "paste"): {
  kind: AttachErrorKind;
  messageKey: string;
  silent: boolean;
  detail: string;
} {
  return {
    kind: "host_only",
    messageKey: attachErrorMessageKey("host_only", source),
    silent: false,
    detail: "",
  };
}

/**
 * Honest preview phase from chip/card image state.
 * Never returns `ready` without a src; `missing` when path is known-absent.
 */
export function deriveAttachPreviewPhase(input: {
  /** Whether this attachment is an image we try to thumb. */
  isImage: boolean;
  /** Resolved thumb / media URL when available. */
  hasSrc: boolean;
  /** Image element onError / decode failure. */
  loadFailed?: boolean;
  /** Host path exists flag when known (false → missing). */
  exists?: boolean | null;
  /** Directory attachments never image-preview. */
  isDir?: boolean;
}): AttachPreviewPhase {
  if (input.isDir || !input.isImage) return "idle";
  if (input.exists === false) return "missing";
  if (input.loadFailed) return "broken";
  if (input.hasSrc) return "ready";
  return "pending";
}

/** i18n key for a preview phase label (chip title / aria). */
export function attachPreviewMessageKey(
  phase: AttachPreviewPhase,
): string | null {
  switch (phase) {
    case "broken":
      return "attach.preview.broken";
    case "missing":
      return "attach.preview.missing";
    case "pending":
      return "attach.preview.pending";
    case "ready":
    case "idle":
    default:
      return null;
  }
}

/**
 * Format a short success toast for one or many attachments.
 * Pure — returns i18n key + vars; never claims success for empty lists.
 */
export function resolveAttachSavedToast(input: {
  count: number;
  /** Preferred display name for a single item. */
  name?: string | null;
}): {
  ok: boolean;
  messageKey: string;
  vars: Record<string, string>;
} {
  const n = Math.max(0, Math.floor(Number(input.count) || 0));
  if (n <= 0) {
    return {
      ok: false,
      messageKey: "composer.attachPickedNone",
      vars: {},
    };
  }
  if (n === 1) {
    const name = (input.name || "").trim() || "file";
    return {
      ok: true,
      messageKey: "composer.attachSaved",
      vars: { name },
    };
  }
  return {
    ok: true,
    messageKey: "composer.attachSaved",
    vars: { name: String(n) },
  };
}

/**
 * Whether a File list is empty after size filtering (honest “nothing to attach”).
 */
export function isEmptyAttachFileList(
  files: Array<{ size?: number } | null | undefined> | null | undefined,
): boolean {
  if (!files?.length) return true;
  return !files.some((f) => f != null && (f.size ?? 0) > 0);
}

/**
 * Cap check for pre-host paste size (bytes). Pure signal for UI.
 * Host still enforces the same limit.
 */
export function isAttachPayloadTooLarge(byteLength: number): boolean {
  return (
    Number.isFinite(byteLength) &&
    byteLength > ATTACHMENT_PASTE_MAX_BYTES
  );
}

/**
 * Build localError string from a resolved attach error + translator.
 * Appends short detail for `other` only when useful.
 *
 * `tr` is typed loosely so callers can pass `createT()` (MessageKey) without casts.
 */
export function formatAttachErrorMessage(
  resolved: {
    messageKey: string;
    silent: boolean;
    detail: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tr: (key: any, vars?: Record<string, string>) => string,
): string | null {
  if (resolved.silent) return null;
  const base = tr(resolved.messageKey);
  if (resolved.detail && resolved.detail !== base) {
    // Avoid duplicating the same generic paste-failed text.
    if (!base.toLowerCase().includes(resolved.detail.toLowerCase())) {
      return `${base} (${resolved.detail})`;
    }
  }
  return base;
}
