/**
 * MEDIA-LOAD-PRO — pure helpers for local media / preview load failures.
 *
 * Classifies Host media-server, image decode, and resource preview failures
 * into stable kinds for honest i18n copy. Never invents “ready” without a
 * successful load signal. No DOM / Tauri side effects.
 *
 * Security: loopback media URLs must stay on local hosts only
 * (`127.0.0.1` / `localhost` / `::1`). Never treat non-local hosts as media delivery.
 */

import { isFusedQueryKeyPath } from "@/lib/pathNormalize";

/** Stable failure modes for chat images, resource preview, and media players. */
export type MediaLoadErrorKind =
  | "missing_path"
  | "untrusted"
  | "host_only"
  | "broken_blob"
  | "timeout"
  | "too_large"
  | "unsupported_type"
  | "media_server_unavailable"
  | "other";

/** Where the failure was observed (affects default copy slightly). */
export type MediaLoadErrorSource =
  | "image"
  | "preview"
  | "media"
  | "office"
  | "resolve"
  | "other";

/** Honest image / media lifecycle for UI chrome. */
export type MediaLoadPhase =
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
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      status?: unknown;
    };
    const parts = [o.code, o.status, o.message, o.reason]
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
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

function errStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
    if (typeof s === "string" && /^\d{3}$/.test(s.trim())) return Number(s);
  }
  const m = /\b([45]\d{2})\b/.exec(errText(err));
  return m ? Number(m[1]) : null;
}

/**
 * True when a URL is a token-gated loopback media HTTP endpoint (or cold-start
 * media:// / asset://). Rejects non-local http(s) hosts so UI never treats a
 * remote server as local media delivery.
 */
export function isSafeLocalMediaUrl(url: string | null | undefined): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (
    raw.startsWith("media:") ||
    raw.startsWith("asset:") ||
    raw.includes("://media.localhost") ||
    raw.includes("://asset.localhost")
  ) {
    return true;
  }
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "[::1]" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

/**
 * Classify a thrown value / host / media-element error into a stable kind.
 * Prefer explicit `code`, HTTP status, and known Host messages over free text.
 */
export function classifyMediaLoadError(err: unknown): MediaLoadErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "missing_path" ||
    code === "missing-path" ||
    code === "not_found" ||
    code === "enoent"
  ) {
    return "missing_path";
  }
  if (
    code === "untrusted" ||
    code === "path_not_allowed" ||
    code === "path-not-allowed" ||
    code === "forbidden"
  ) {
    return "untrusted";
  }
  if (
    code === "host_only" ||
    code === "need_tauri" ||
    code === "host-only"
  ) {
    return "host_only";
  }
  if (
    code === "broken_blob" ||
    code === "broken-blob" ||
    code === "decode" ||
    code === "media_err_decode"
  ) {
    return "broken_blob";
  }
  if (code === "timeout" || code === "timed_out" || code === "timed-out") {
    return "timeout";
  }
  if (
    code === "too_large" ||
    code === "file_too_large" ||
    code === "payload_too_large"
  ) {
    return "too_large";
  }
  if (
    code === "unsupported_type" ||
    code === "unsupported-type" ||
    code === "unsupported" ||
    code === "media_err_src_not_supported"
  ) {
    return "unsupported_type";
  }
  if (
    code === "media_server_unavailable" ||
    code === "media-server-unavailable" ||
    code === "media_server" ||
    code === "no_endpoint"
  ) {
    return "media_server_unavailable";
  }
  if (code === "network" || code === "media_err_network") {
    return "media_server_unavailable";
  }
  if (code === "aborted" || code === "media_err_aborted") {
    return "other";
  }

  const status = errStatus(err);
  if (status === 404) return "missing_path";
  if (status === 403 || status === 401) return "untrusted";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "too_large";
  if (status === 415) return "unsupported_type";
  if (status === 502 || status === 503 || status === 0) {
    return "media_server_unavailable";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  // HTMLMediaElement / FileMediaPlayer short codes
  if (s === "timeout" || s.includes("timed out") || s.includes("timeout")) {
    return "timeout";
  }
  if (s.includes("too large") || s.includes("payload too large")) {
    return "too_large";
  }
  if (
    s === "unsupported" ||
    s.includes("src_not_supported") ||
    s.includes("not supported") ||
    s.includes("unsupported type") ||
    s.includes("unsupported format") ||
    s.includes("no in-app preview") ||
    s.includes("format has no")
  ) {
    return "unsupported_type";
  }
  if (
    s === "decode" ||
    s.includes("decode") ||
    s.includes("broken blob") ||
    s.includes("invalid image") ||
    s.includes("corrupt") ||
    s.includes("empty/small blob")
  ) {
    return "broken_blob";
  }
  if (
    s.includes("path not allowed") ||
    s.includes("not allowed") ||
    s.includes("untrusted") ||
    s.includes("unauthorized") ||
    s.includes("forbidden") ||
    s.includes("outside allowlist") ||
    s.includes("outside path scope")
  ) {
    return "untrusted";
  }
  if (
    s.includes("file not found") ||
    s.includes("no such file") ||
    s.includes("enoent") ||
    s.includes("missing path") ||
    s.includes("path missing") ||
    s.includes("does not exist") ||
    /\b404\b/.test(s)
  ) {
    return "missing_path";
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
    s.includes("cannot resolve local file url") ||
    s.includes("cannot resolve") ||
    s.includes("media server") ||
    s.includes("media endpoint") ||
    s.includes("endpoint not ready") ||
    s.includes("connection refused") ||
    s.includes("failed to fetch") ||
    s === "network" ||
    s.includes("econnrefused") ||
    s.includes("net::err")
  ) {
    return "media_server_unavailable";
  }
  if (
    s.includes("failed to load file") ||
    s.includes("failed to load") ||
    s.includes("load file range")
  ) {
    // Prefer status when present; generic load fail → other with detail.
    if (/\b404\b/.test(s)) return "missing_path";
    if (/\b403\b/.test(s) || /\b401\b/.test(s)) return "untrusted";
    if (/\b415\b/.test(s)) return "unsupported_type";
    return "other";
  }

  return "other";
}

/**
 * Extract the `p=` path from a token-gated loopback media URL, or null when
 * the src is not a loopback media URL (or has no path).
 * Returns the *decoded* path exactly as the media server would resolve it.
 */
export function mediaUrlPathParam(
  src: string | null | undefined,
): string | null {
  const raw = (src || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:|\/)/i.test(raw)) {
    return null;
  }
  try {
    const u = new URL(raw);
    if (!u.pathname.includes("/v1/media")) return null;
    const p = u.searchParams.get("p");
    return p && p.trim() ? p.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Whether `<img onError>` should lock the chat card as broken.
 * Ignore leftover abort from a src swap (https → cached thumb on remount)
 * and explicit media-element abort codes.
 */
export function shouldApplyChatImageLoadError(input: {
  failedSrc?: string | null;
  paintedSrc?: string | null;
  mediaElementError?: string | null;
}): boolean {
  const err = (input.mediaElementError || "").trim().toLowerCase();
  if (err === "aborted" || err === "media_err_aborted") return false;
  const failed = (input.failedSrc || "").trim();
  const painted = (input.paintedSrc || "").trim();
  if (failed && painted && failed !== painted) return false;
  return true;
}

/**
 * Classify resolve / paint failures when we have path context but no thrown value.
 * Used by chat image cards when `resolveImageSrc` returns null or `<img onError>`.
 */
export function classifyMediaSrcFailure(input: {
  pathOrUrl?: string | null;
  /** Resolved viewable URL when any. */
  resolvedSrc?: string | null;
  /** `<img>` / media element reported load failure. */
  loadFailed?: boolean;
  /** Host path exists when known (false → missing). */
  exists?: boolean | null;
  /** Running inside Tauri desktop host. */
  isTauri?: boolean;
  /** Loopback media server endpoint ready. */
  mediaEndpointReady?: boolean;
  /** HTTP status from a probe / Range fetch when known. */
  httpStatus?: number | null;
  /** Short media-element code: aborted|network|decode|unsupported|timeout. */
  mediaElementError?: string | null;
}): MediaLoadErrorKind {
  if (input.exists === false) return "missing_path";

  if (input.httpStatus != null) {
    return classifyMediaLoadError({ status: input.httpStatus });
  }

  if (input.mediaElementError) {
    return classifyMediaLoadError(input.mediaElementError);
  }

  const path = (input.pathOrUrl || "").trim();
  if (!path) return "missing_path";

  // Fused media query keys (`t:/Users/…`) are allowlist/parsing artifacts —
  // never “corrupted file” copy.
  if (isFusedQueryKeyPath(path)) return "untrusted";

  // Explicit host-only when browser and absolute FS path.
  if (input.isTauri === false) {
    const looksAbs =
      path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
    if (looksAbs && !input.resolvedSrc) return "host_only";
  }

  if (input.loadFailed) {
    // Decode/network failure after we had a src.
    if (input.resolvedSrc) {
      if (
        input.resolvedSrc.startsWith("blob:") ||
        input.resolvedSrc.startsWith("data:")
      ) {
        return "broken_blob";
      }
      // Loopback media URL: classify by what the server would have answered.
      // A fused `t:/Users/…` p= param is a path_scope/parsing denial, and a
      // missing p= means the URL was malformed — neither is a corrupt file.
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:|\/)/i.test(input.resolvedSrc)) {
        const mediaPath = mediaUrlPathParam(input.resolvedSrc);
        if (mediaPath == null) return "media_server_unavailable";
        if (isFusedQueryKeyPath(mediaPath)) return "untrusted";
      }
      // Remote CDN / markdown images: honest decode failure, not allowlist.
      // (Untrusted is reserved for Host path_scope / media-server 403.)
      return "broken_blob";
    }
    return "other";
  }

  if (!input.resolvedSrc) {
    if (
      path.startsWith("...") ||
      path.startsWith("…") ||
      path.includes("/.../")
    ) {
      return "missing_path";
    }
    if (input.mediaEndpointReady === false && input.isTauri) {
      return "media_server_unavailable";
    }
    if (input.isTauri === false) return "host_only";
    // Absolute path that could not be resolved — prefer media server when
    // endpoint unknown; otherwise missing.
    if (input.mediaEndpointReady === false) {
      return "media_server_unavailable";
    }
    return "missing_path";
  }

  return "other";
}

/** i18n message key for a classified media load error. */
export function mediaLoadErrorMessageKey(kind: MediaLoadErrorKind): string {
  switch (kind) {
    case "missing_path":
      return "media.err.missingPath";
    case "untrusted":
      return "media.err.untrusted";
    case "host_only":
      return "media.err.hostOnly";
    case "broken_blob":
      return "media.err.brokenBlob";
    case "timeout":
      return "media.err.timeout";
    case "too_large":
      return "media.err.tooLarge";
    case "unsupported_type":
      return "media.err.unsupportedType";
    case "media_server_unavailable":
      return "media.err.mediaServerUnavailable";
    case "other":
    default:
      return "media.err.other";
  }
}

/**
 * Resolve user-facing error copy from a thrown value / media code.
 */
export function resolveMediaLoadError(
  err: unknown,
  _source: MediaLoadErrorSource = "other",
): {
  kind: MediaLoadErrorKind;
  messageKey: string;
  /** Short technical detail for debug suffix (empty when not useful). */
  detail: string;
} {
  const kind = classifyMediaLoadError(err);
  const messageKey = mediaLoadErrorMessageKey(kind);
  const raw = errText(err).trim();
  let detail = "";
  if (
    kind === "other" &&
    raw &&
    !/^error:\s*$/i.test(raw) &&
    raw.length < 200 &&
    // Skip bare media-element codes we already mapped away from other
    !/^(aborted|network|decode|unsupported|timeout|unknown)$/i.test(raw)
  ) {
    detail = raw.replace(/^Error:\s*/i, "").trim();
  }
  return { kind, messageKey, detail };
}

/**
 * Resolve copy from path/src resolve context (no thrown value).
 */
export function resolveMediaSrcFailure(input: {
  pathOrUrl?: string | null;
  resolvedSrc?: string | null;
  loadFailed?: boolean;
  exists?: boolean | null;
  isTauri?: boolean;
  mediaEndpointReady?: boolean;
  httpStatus?: number | null;
  mediaElementError?: string | null;
}): {
  kind: MediaLoadErrorKind;
  messageKey: string;
  detail: string;
} {
  const kind = classifyMediaSrcFailure(input);
  return {
    kind,
    messageKey: mediaLoadErrorMessageKey(kind),
    detail: "",
  };
}

/**
 * Honest phase for image / media chrome.
 * Never returns `ready` without a src; `missing` when path is known-absent.
 */
export function deriveMediaLoadPhase(input: {
  hasSrc: boolean;
  loadFailed?: boolean;
  exists?: boolean | null;
  /** Non-media content (skip preview chrome). */
  idle?: boolean;
}): MediaLoadPhase {
  if (input.idle) return "idle";
  if (input.exists === false) return "missing";
  if (input.loadFailed) return "broken";
  if (input.hasSrc) return "ready";
  return "pending";
}

/** i18n key for a load phase label (title / aria), or null when not needed. */
export function mediaLoadPhaseMessageKey(
  phase: MediaLoadPhase,
): string | null {
  switch (phase) {
    case "broken":
      return "media.err.brokenBlob";
    case "missing":
      return "media.err.missingPath";
    case "pending":
      return "media.loading";
    case "ready":
    case "idle":
    default:
      return null;
  }
}

/**
 * Build display string from a resolved media error + translator.
 * Appends short detail for `other` only when useful.
 *
 * `tr` is typed loosely so callers can pass `createT()` (MessageKey) without casts.
 */
export function formatMediaLoadErrorMessage(
  resolved: {
    messageKey: string;
    detail: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tr: (key: any, vars?: Record<string, string>) => string,
): string {
  const base = tr(resolved.messageKey);
  if (resolved.detail && resolved.detail !== base) {
    if (!base.toLowerCase().includes(resolved.detail.toLowerCase())) {
      return `${base} (${resolved.detail})`;
    }
  }
  return base;
}

/**
 * All classified media.err.* keys (for building label maps in UI).
 */
export const MEDIA_LOAD_ERROR_KINDS: readonly MediaLoadErrorKind[] = [
  "missing_path",
  "untrusted",
  "host_only",
  "broken_blob",
  "timeout",
  "too_large",
  "unsupported_type",
  "media_server_unavailable",
  "other",
] as const;

/** Build kind → translated label map (for ImageUi / FileMediaPlayer labels). */
export function mediaLoadErrorLabelMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tr: (key: any, vars?: Record<string, string>) => string,
): Record<MediaLoadErrorKind, string> {
  const out = {} as Record<MediaLoadErrorKind, string>;
  for (const kind of MEDIA_LOAD_ERROR_KINDS) {
    out[kind] = tr(mediaLoadErrorMessageKey(kind));
  }
  return out;
}
