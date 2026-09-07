import * as api from "@/lib/api";
import { createWallpaperRequestId } from "@/lib/wallpaperRequest";
import type { WallpaperFetchResult } from "@/lib/wallpaperSource";

const activeRequests = new Set<string>();
const pendingByUrl = new Map<string, Promise<WallpaperFetchResult>>();

/**
 * Download one Saved original through the isolated Host bridge. Concurrent
 * preview/apply actions for the same URL share a single validated transfer.
 */
export function fetchGrokAlbumMedia(
  rawUrl: string,
): Promise<WallpaperFetchResult> {
  const url = rawUrl.trim();
  const existing = pendingByUrl.get(url);
  if (existing) return existing;

  const requestId = createWallpaperRequestId();
  activeRequests.add(requestId);
  const request = api.wallpaperGrokAlbumFetchMedia(url, requestId).finally(() => {
    activeRequests.delete(requestId);
    if (pendingByUrl.get(url) === request) pendingByUrl.delete(url);
  });
  pendingByUrl.set(url, request);
  return request;
}

/** Cancel every Saved original request owned by the current renderer lifecycle. */
export function cancelGrokAlbumMediaRequests(): void {
  const requestIds = Array.from(activeRequests);
  activeRequests.clear();
  pendingByUrl.clear();
  const targeted = requestIds.length
    ? api.wallpaperGrokAlbumCancelRequests(requestIds)
    : Promise.resolve(0);
  void Promise.allSettled([
    targeted,
    api.wallpaperGrokAlbumCancelAllRequests(),
  ]);
}

/** Test helper. */
export function grokAlbumMediaRequestState(): {
  active: number;
  pending: number;
} {
  return { active: activeRequests.size, pending: pendingByUrl.size };
}
