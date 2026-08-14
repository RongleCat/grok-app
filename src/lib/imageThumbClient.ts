/**
 * Client-side chat image thumb resolver.
 * Host materializes ≤480px JPEG under app cache; we map original path/url →
 * loopback media URL for the thumb so virtual-list remounts stay cheap.
 */

import * as api from "@/lib/api";
import {
  ensureMediaEndpoint,
  getMediaEndpoint,
  isViewableSrc,
  localPathToMediaHttpUrl,
  onMediaEndpointChange,
  resolveImageSrc,
} from "@/lib/imageSrc";
import { isFusedQueryKeyPath } from "@/lib/pathNormalize";
import { setImageAspect } from "@/lib/imageAspectCache";

export type ThumbResolve = {
  /** src for <img> in chat card (thumb or fallback original). */
  displaySrc: string;
  /** Full original for lightbox (path or url). */
  fullKey: string;
  width: number;
  height: number;
  fromCache: boolean;
};

/** Session memory: original path/url → displaySrc (loopback to thumb file). */
const displayCache = new Map<string, ThumbResolve>();

// A media server restart (new port/token) invalidates every cached loopback
// URL — drop them so the next remount re-resolves with the live endpoint.
onMediaEndpointChange(() => {
  displayCache.clear();
});

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function isLocalAbs(s: string): boolean {
  const t = s.trim();
  if (!t || isHttpUrl(t)) return false;
  if (t.startsWith("data:") || t.startsWith("blob:")) return false;
  if (isFusedQueryKeyPath(t)) return false;
  return t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t);
}

/** Whether this source is eligible for Host thumb cache (local or remote image URL). */
export function canUseImageThumb(src: string, path?: string): boolean {
  const p = (path || "").trim();
  if (p && isLocalAbs(p)) return true;
  const s = (src || "").trim();
  if (isLocalAbs(s)) return true;
  if (isHttpUrl(s) && !s.includes("127.0.0.1") && !s.includes("localhost")) {
    return true;
  }
  return false;
}

function cacheKey(src: string, path?: string): string {
  const p = (path || "").trim();
  if (p && isLocalAbs(p)) return p.replace(/\\/g, "/");
  return (src || "").trim();
}

/** Sync lookup of the session thumb cache — remounts must first-paint this. */
export function peekChatImageThumb(
  src: string,
  path?: string,
): ThumbResolve | null {
  const key = cacheKey(src, path);
  if (!key) return null;
  return displayCache.get(key) ?? null;
}

/**
 * Next `<img src>` after a thumb resolve. Never wipe a working live URL
 * when materialization returns null / empty (journal remount would flash
 * a broken card over a still-valid https original).
 */
export function nextChatCardDisplaySrc(
  current: string | null | undefined,
  thumb: ThumbResolve | null | undefined,
): string | null {
  const next = (thumb?.displaySrc || "").trim();
  if (next) return next;
  const keep = (current || "").trim();
  return keep || null;
}

/**
 * Resolve a chat-card display URL, preferring a Host-cached thumb.
 * Falls back to normal media resolve when thumb fails.
 */
export async function resolveChatImageThumb(
  src: string,
  path?: string,
): Promise<ThumbResolve | null> {
  const key = cacheKey(src, path);
  if (!key) return null;

  const hit = displayCache.get(key);
  if (hit) return hit;

  // Thumb materialization is desktop Host only (not phone mirror).
  if (!api.isDesktopHost()) {
    const url =
      (isViewableSrc(src) ? src : null) || (await resolveImageSrc(src));
    if (!url) return null;
    const r: ThumbResolve = {
      displaySrc: url,
      fullKey: path || src,
      width: 0,
      height: 0,
      fromCache: false,
    };
    displayCache.set(key, r);
    return r;
  }

  if (!canUseImageThumb(src, path)) {
    const url = await resolveImageSrc(path || src);
    if (!url) return null;
    const r: ThumbResolve = {
      displaySrc: url,
      fullKey: path || src,
      width: 0,
      height: 0,
      fromCache: false,
    };
    displayCache.set(key, r);
    return r;
  }

  const target =
    path && isLocalAbs(path)
      ? path
      : isLocalAbs(src)
        ? src
        : src.trim();

  try {
    await ensureMediaEndpoint();
    let thumb: api.ImageThumbResult | null = null;
    try {
      thumb = await api.mediaImageThumb(target);
    } catch {
      // Reopen race: history paints before openSession's paths_classify grants
      // land, so Downloads / Desktop media 403 on the first paint. Re-classify
      // (force-grant) once, then retry the thumb materialization.
      try {
        await api.pathsClassify([target]);
      } catch {
        /* classify failure is not fatal — fall through to full resolve */
      }
      thumb = await api.mediaImageThumb(target).catch(() => null);
    }
    if (thumb?.thumbPath) {
      let display =
        localPathToMediaHttpUrl(thumb.thumbPath) ||
        (await resolveImageSrc(thumb.thumbPath));
      if (!display) {
        // Endpoint race — retry once.
        await ensureMediaEndpoint();
        display =
          localPathToMediaHttpUrl(thumb.thumbPath) ||
          (await resolveImageSrc(thumb.thumbPath));
      }
      if (display) {
        if (thumb.width > 0 && thumb.height > 0) {
          setImageAspect(src, path, thumb.width / thumb.height, [
            path || "",
            target,
          ]);
        }
        const r: ThumbResolve = {
          displaySrc: display,
          fullKey: path || src,
          width: thumb.width || 0,
          height: thumb.height || 0,
          fromCache: !!thumb.fromCache,
        };
        displayCache.set(key, r);
        return r;
      }
    }
  } catch {
    /* fall through to full resolve */
  }

  const url = await resolveImageSrc(path && isLocalAbs(path) ? path : src);
  if (!url) return null;
  const r: ThumbResolve = {
    displaySrc: url,
    fullKey: path || src,
    width: 0,
    height: 0,
    fromCache: false,
  };
  displayCache.set(key, r);
  return r;
}

/** Test helper. */
export function clearChatImageThumbClientCache(): void {
  displayCache.clear();
}

/** Test helper — access current endpoint for cache-staleness assertions. */
export function getThumbCacheEndpoint(): string | null {
  const ep = getMediaEndpoint();
  return ep ? `${ep.baseUrl}?t=${ep.token}` : null;
}
