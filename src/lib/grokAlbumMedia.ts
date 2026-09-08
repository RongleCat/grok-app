import * as api from "@/lib/api";
import { createWallpaperRequestId } from "@/lib/wallpaperRequest";
import type { WallpaperFetchResult } from "@/lib/wallpaperSource";

const activeRequests = new Set<string>();
type PendingMediaRequest = {
  requestId: string;
  promise: Promise<WallpaperFetchResult>;
  consumers: Set<symbol>;
  settled: boolean;
  cancelRequested: boolean;
};

const pendingByUrl = new Map<string, PendingMediaRequest>();

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function cancelIfUnused(url: string, pending: PendingMediaRequest): void {
  if (
    pending.settled ||
    pending.cancelRequested ||
    pending.consumers.size > 0
  ) {
    return;
  }
  pending.cancelRequested = true;
  if (pendingByUrl.get(url) === pending) pendingByUrl.delete(url);
  void api.wallpaperGrokAlbumCancelRequests([pending.requestId]).catch(() => {});
}

/**
 * Download one Saved original through the isolated Host bridge. Concurrent
 * preview/apply actions for the same URL share a single validated transfer.
 */
export function fetchGrokAlbumMedia(
  rawUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<WallpaperFetchResult> {
  const url = rawUrl.trim();
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  let pending = pendingByUrl.get(url);
  if (!pending) {
    const requestId = createWallpaperRequestId();
    const hostRequest = api.wallpaperGrokAlbumFetchMedia(url, requestId);
    const owned: PendingMediaRequest = {
      requestId,
      promise: hostRequest,
      consumers: new Set(),
      settled: false,
      cancelRequested: false,
    };
    activeRequests.add(requestId);
    owned.promise = hostRequest.then(
      (result) => {
        owned.settled = true;
        activeRequests.delete(requestId);
        if (pendingByUrl.get(url) === owned) pendingByUrl.delete(url);
        return result;
      },
      (error: unknown) => {
        owned.settled = true;
        activeRequests.delete(requestId);
        if (pendingByUrl.get(url) === owned) pendingByUrl.delete(url);
        throw error;
      },
    );
    pendingByUrl.set(url, owned);
    pending = owned;
  }

  const owned = pending;
  const consumer = Symbol(url);
  owned.consumers.add(consumer);
  return new Promise<WallpaperFetchResult>((resolve, reject) => {
    let consumerSettled = false;
    const release = (cancel: boolean) => {
      if (consumerSettled) return false;
      consumerSettled = true;
      signal?.removeEventListener("abort", onAbort);
      owned.consumers.delete(consumer);
      if (cancel) cancelIfUnused(url, owned);
      return true;
    };
    const onAbort = () => {
      if (release(true)) reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    void owned.promise.then(
      (result) => {
        if (release(false)) resolve(result);
      },
      (error: unknown) => {
        if (release(false)) reject(error);
      },
    );
  });
}

/** Cancel every Saved original request owned by the current renderer lifecycle. */
export function cancelGrokAlbumMediaRequests(): void {
  const requestIds = Array.from(activeRequests);
  for (const pending of pendingByUrl.values()) {
    pending.cancelRequested = true;
  }
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
