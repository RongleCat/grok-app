/**
 * Resolve a local filesystem path (or remote URL) to something an <img> can load.
 *
 * Primary delivery: Host loopback HTTP media server
 *   `http://127.0.0.1:{port}/v1/media?t={token}&p={encodeURIComponent(absPath)}`
 * Token-gated + path_scope on the Host. Works for WebView, browser tools, and
 * future web clients talking to a local Host.
 *
 * Fallback (only if the media server is not ready yet): Tauri `media://` via
 * convertFileSrc — kept for cold-start races, not the steady-state path.
 *
 * Resolution is sync + cached so chat image cards never flash through a
 * zero-height state that collapses scrollHeight while reading history.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/api";
import {
  isFusedQueryKeyPath,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  normalizeLocalPathToken,
} from "@/lib/pathNormalize";

/** Cache path → viewable URL (or null on hard failure). */
const resolveCache = new Map<string, string | null>();

export type MediaServerEndpoint = {
  baseUrl: string;
  token: string;
};

let mediaEndpoint: MediaServerEndpoint | null = null;
let mediaEndpointPromise: Promise<MediaServerEndpoint | null> | null = null;

/**
 * External caches (chat thumb displayCache, aspect cache) register here so a
 * media endpoint change (new port/token) drops stale loopback URLs.
 */
type EndpointChangeListener = () => void;
const endpointChangeListeners = new Set<EndpointChangeListener>();

/** Subscribe to media endpoint changes (returns unsubscribe). */
export function onMediaEndpointChange(fn: EndpointChangeListener): () => void {
  endpointChangeListeners.add(fn);
  return () => {
    endpointChangeListeners.delete(fn);
  };
}

/** Current loopback media endpoint (null before ready / outside Tauri). */
export function getMediaEndpoint(): MediaServerEndpoint | null {
  return mediaEndpoint;
}

/** Already-viewable URL schemes (incl. loopback media HTTP). */
export function isViewableSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("asset:") ||
    src.startsWith("media:") ||
    src.startsWith("https://asset.localhost") ||
    src.startsWith("http://asset.localhost") ||
    src.startsWith("https://media.localhost") ||
    src.startsWith("http://media.localhost") ||
    src.includes("://asset.localhost") ||
    src.includes("://media.localhost")
  );
}

/**
 * ChatCut / MCP often emit protocol-relative media URLs (`//bucket.s3…/x.jpg`)
 * or angle-bracket placeholders (`/<frame-name>.jpg`). Those must not hit the
 * loopback media server as local paths.
 *
 * Returns a normalized viewable URL, a cleaned local path, or null to skip.
 */
export function normalizeMediaRef(pathOrUrl: string): string | null {
  const raw = (pathOrUrl ?? "").trim();
  if (!raw) return null;
  // Template placeholders from tool schemas (not real files).
  if (raw.includes("<") || raw.includes(">") || raw.includes("{") || raw.includes("}")) {
    return null;
  }
  // Protocol-relative URL → https (ChatCut S3 thumbnails, CDN frames).
  // Distinguish from "///abs" oddities: //host/… has a hostname segment.
  if (raw.startsWith("//") && !raw.startsWith("///")) {
    const rest = raw.slice(2);
    const host = rest.split("/")[0] ?? "";
    // Require a dot (domain) or known host shape so //relative/local is not forced https.
    if (host.includes(".") || host.includes("localhost") || host.includes("amazonaws")) {
      return `https:${raw}`;
    }
  }
  if (isViewableSrc(raw)) return raw;
  // CMS/site roots must not hit loopback media as local paths.
  if (isSiteRootAbsolutePath(raw)) return null;
  // Fused query keys (`t:/Users/…`) are never local paths.
  if (isFusedQueryKeyPath(raw)) return null;
  // Shell-unescape + collapse accidental double slashes on real local abs only.
  const local = normalizeLocalPathToken(raw);
  if (local && isRealLocalAbsolutePath(local)) return local;
  if (/^[A-Za-z]:[\\/]/.test(raw) && !isFusedQueryKeyPath(raw)) {
    return normalizeLocalPathToken(raw) || raw;
  }
  // Relative tokens (images/1.jpg) pass through for pathMap resolve upstream.
  if (local && !local.startsWith("/")) return local;
  return local || raw;
}

function looksAbsoluteFsPath(raw: string): boolean {
  // Protocol-relative //host is NOT a filesystem path.
  if (raw.startsWith("//")) return false;
  // Only real local roots — never `/images/...` CMS paths.
  return isRealLocalAbsolutePath(raw);
}

/**
 * Build a token-gated loopback URL for an absolute filesystem path.
 * Returns null when the media server endpoint is not yet known.
 */
export function localPathToMediaHttpUrl(absPath: string): string | null {
  const ep = mediaEndpoint;
  if (!ep?.baseUrl || !ep.token) return null;
  // Last line of defense: a fused `t:/Users/…` query-key path must never hit
  // the media server (path_scope 403 → broken-looking cards on remount).
  if (isFusedQueryKeyPath(absPath)) return null;
  const base = ep.baseUrl.replace(/\/$/, "");
  return `${base}/v1/media?t=${encodeURIComponent(ep.token)}&p=${encodeURIComponent(absPath)}`;
}

/** Whether the loopback media server endpoint is ready. */
export function isMediaEndpointReady(): boolean {
  return !!(mediaEndpoint?.baseUrl && mediaEndpoint?.token);
}

/**
 * Inject endpoint from Host (or tests). Clears the path→url cache so prior
 * nulls (server not ready) can re-resolve, and notifies dependent caches
 * (chat thumb displayCache) when the endpoint actually changed.
 */
export function setMediaEndpoint(ep: MediaServerEndpoint | null): void {
  const changed =
    !!mediaEndpoint !== !!ep ||
    (mediaEndpoint && ep &&
      (mediaEndpoint.baseUrl !== ep.baseUrl || mediaEndpoint.token !== ep.token));
  mediaEndpoint = ep;
  resolveCache.clear();
  if (changed) {
    for (const fn of endpointChangeListeners) {
      try {
        fn();
      } catch {
        /* listener errors must not break endpoint setup */
      }
    }
  }
}

/**
 * Fetch endpoint from Host once. Safe to call multiple times; concurrent
 * callers share one promise. No-op outside Tauri desktop.
 */
export async function ensureMediaEndpoint(): Promise<MediaServerEndpoint | null> {
  if (mediaEndpoint) return mediaEndpoint;
  if (!isTauri()) return null;
  if (mediaEndpointPromise) return mediaEndpointPromise;

  mediaEndpointPromise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Host starts the media server async after first paint — brief retries
      // cover the cold-start race without blocking UI boot.
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const ep = await invoke<MediaServerEndpoint>("media_server_endpoint");
          if (ep?.baseUrl && ep?.token) {
            setMediaEndpoint(ep);
            return ep;
          }
        } catch {
          /* not managed yet */
        }
        await new Promise((r) => setTimeout(r, 40 + attempt * 30));
      }
      return null;
    } finally {
      mediaEndpointPromise = null;
    }
  })();

  return mediaEndpointPromise;
}

/**
 * Sync resolve (preferred for chat cards).
 * Returns null when the path cannot be turned into a viewable src.
 */
export function resolveImageSrcSync(pathOrUrl: string): string | null {
  const input = pathOrUrl.trim();
  if (!input) return null;

  const normalized = normalizeMediaRef(input);
  if (normalized == null) {
    // Placeholder / rejected ref (incl. fused `t:/Users/…` query keys) —
    // cache under original key so we do not retry.
    resolveCache.set(input, null);
    return null;
  }
  if (isViewableSrc(normalized)) {
    resolveCache.set(input, normalized);
    return normalized;
  }

  if (resolveCache.has(input)) {
    return resolveCache.get(input) ?? null;
  }

  // Ellipsis-truncated paths need host smart-open first.
  if (
    normalized.startsWith("...") ||
    normalized.startsWith("…") ||
    normalized.includes("/.../")
  ) {
    resolveCache.set(input, null);
    return null;
  }

  if (!looksAbsoluteFsPath(normalized)) {
    resolveCache.set(input, null);
    return null;
  }

  // Preferred: loopback HTTP (token + path_scope on Host).
  const httpUrl = localPathToMediaHttpUrl(normalized);
  if (httpUrl) {
    resolveCache.set(input, httpUrl);
    return httpUrl;
  }

  if (!isTauri()) {
    resolveCache.set(input, null);
    return null;
  }

  // Cold-start fallback: custom media:// until ensureMediaEndpoint() finishes.
  try {
    const url = convertFileSrc(normalized, "media");
    resolveCache.set(input, url);
    return url;
  } catch {
    try {
      const url = convertFileSrc(normalized);
      resolveCache.set(input, url);
      return url;
    } catch {
      resolveCache.set(input, null);
      return null;
    }
  }
}

/**
 * Async resolve — ensures media endpoint is loaded, then returns HTTP URL.
 * Prefer this for first paint after app boot when cards may mount before init.
 */
export async function resolveImageSrc(
  pathOrUrl: string,
): Promise<string | null> {
  const raw = pathOrUrl.trim();
  if (!raw) return null;
  const pre = normalizeMediaRef(raw);
  if (pre && isViewableSrc(pre)) return pre;
  if (pre && looksAbsoluteFsPath(pre) && isTauri()) {
    await ensureMediaEndpoint();
    // Drop stale entries from before endpoint was ready:
    // - null (hard fail while server was down)
    // - media:// / asset:// cold-start fallback (prefer loopback HTTP)
    const cached = resolveCache.get(raw);
    if (
      cached == null ||
      (typeof cached === "string" &&
        (cached.startsWith("media:") ||
          cached.includes("media.localhost") ||
          cached.startsWith("asset:") ||
          cached.includes("asset.localhost")))
    ) {
      resolveCache.delete(raw);
    }
  }
  return resolveImageSrcSync(raw);
}

/** Resolve many paths; preserves order, drops failures. */
export async function resolveImageSrcs(
  paths: string[],
): Promise<{ path: string; src: string }[]> {
  if (paths.some(looksAbsoluteFsPath) && isTauri()) {
    await ensureMediaEndpoint();
  }
  const out: { path: string; src: string }[] = [];
  for (const path of paths) {
    const src = resolveImageSrcSync(path);
    if (src) out.push({ path, src });
  }
  return out;
}

/** Drop a cached resolve (including a sticky null) so a later retry can hit disk. */
export function invalidateImageSrc(pathOrUrl: string): void {
  const key = pathOrUrl.trim();
  if (key) resolveCache.delete(key);
}

/** Test helper — clear the resolve cache. */
export function clearImageSrcCache(): void {
  resolveCache.clear();
}

/** Test helper — reset media endpoint. */
export function resetMediaEndpointForTests(): void {
  mediaEndpoint = null;
  mediaEndpointPromise = null;
  resolveCache.clear();
}

/** Test helper — clear endpoint listeners. */
export function clearMediaEndpointListenersForTests(): void {
  endpointChangeListeners.clear();
}
