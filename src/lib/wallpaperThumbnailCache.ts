import { createWallpaperRequestId } from "@/lib/wallpaperRequest";

export type WallpaperThumbnailPayload = {
  dataUrl: string;
  width: number;
  height: number;
};

type CacheListener = () => void;

type QueueJob = {
  revision: number;
  run: () => void;
  cancel: () => void;
};

export type WallpaperThumbnailCacheOptions = {
  cancelRequests: (requestIds: string[]) => Promise<number>;
  maxConcurrent?: number;
  maxEntries?: number;
  maxDataUrlLength?: number;
  failureCooldownMs?: number;
};

export type WallpaperThumbnailCache = {
  peek: (key: string) => string | null;
  subscribe: (key: string, listener: CacheListener) => () => void;
  resolve: (
    key: string,
    load: (requestId: string) => Promise<WallpaperThumbnailPayload>,
  ) => Promise<string | null>;
  forget: (key: string) => void;
  clear: () => void;
  state: () => { active: number; queued: number; cached: number };
};

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_ENTRIES = 80;
const DEFAULT_MAX_DATA_URL_LENGTH = 768 * 1024;
const DEFAULT_FAILURE_COOLDOWN_MS = 15_000;

function validThumbnailResult(
  input: WallpaperThumbnailPayload,
  maxDataUrlLength: number,
): boolean {
  return (
    typeof input?.dataUrl === "string" &&
    input.dataUrl.length > "data:image/jpeg;base64,".length &&
    input.dataUrl.length <= maxDataUrlLength &&
    input.dataUrl.startsWith("data:image/jpeg;base64,") &&
    Number.isFinite(input.width) &&
    input.width > 0 &&
    Number.isFinite(input.height) &&
    input.height > 0
  );
}

export function createWallpaperThumbnailCache({
  cancelRequests,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxDataUrlLength = DEFAULT_MAX_DATA_URL_LENGTH,
  failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
}: WallpaperThumbnailCacheOptions): WallpaperThumbnailCache {
  const resolved = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();
  const failedUntil = new Map<string, number>();
  const queue: QueueJob[] = [];
  const activeRequestIds = new Set<string>();
  const listeners = new Map<string, Set<CacheListener>>();
  let activeJobs = 0;
  let revision = 0;

  const notify = (key: string) => {
    for (const listener of Array.from(listeners.get(key) ?? [])) listener();
  };

  const remember = (key: string, dataUrl: string, shouldNotify = true) => {
    const changed = resolved.get(key) !== dataUrl;
    resolved.delete(key);
    resolved.set(key, dataUrl);
    while (resolved.size > maxEntries) {
      const oldest = resolved.keys().next().value as string | undefined;
      if (!oldest) break;
      resolved.delete(oldest);
    }
    if (shouldNotify && changed) notify(key);
  };

  const peek = (key: string): string | null => {
    const normalized = key.trim();
    const hit = resolved.get(normalized);
    if (!hit) return null;
    remember(normalized, hit, false);
    return hit;
  };

  const pumpQueue = () => {
    while (activeJobs < maxConcurrent && queue.length > 0) {
      const job = queue.shift();
      if (!job) return;
      if (job.revision !== revision) {
        job.cancel();
        continue;
      }
      activeJobs += 1;
      job.run();
    }
  };

  const enqueue = <T>(
    requestRevision: number,
    run: () => Promise<T>,
  ): Promise<T | null> =>
    new Promise<T | null>((resolve, reject) => {
      let settled = false;
      const resolveOnce = (value: T | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      queue.push({
        revision: requestRevision,
        cancel: () => resolveOnce(null),
        run: () => {
          void run()
            .then(resolveOnce, reject)
            .finally(() => {
              activeJobs = Math.max(0, activeJobs - 1);
              pumpQueue();
            });
        },
      });
      pumpQueue();
    });

  const resolve = (
    key: string,
    load: (requestId: string) => Promise<WallpaperThumbnailPayload>,
  ): Promise<string | null> => {
    const normalized = key.trim();
    if (!normalized) return Promise.resolve(null);
    const hit = peek(normalized);
    if (hit) return Promise.resolve(hit);
    const inFlight = pending.get(normalized);
    if (inFlight) return inFlight;
    if ((failedUntil.get(normalized) || 0) > Date.now()) {
      return Promise.resolve(null);
    }

    const requestRevision = revision;
    const requestId = createWallpaperRequestId();
    const request = enqueue(requestRevision, async () => {
      if (requestRevision !== revision) return null;
      activeRequestIds.add(requestId);
      try {
        const result = await load(requestId);
        if (
          requestRevision !== revision ||
          !validThumbnailResult(result, maxDataUrlLength)
        ) {
          return null;
        }
        remember(normalized, result.dataUrl);
        failedUntil.delete(normalized);
        return result.dataUrl;
      } catch {
        if (requestRevision === revision) {
          failedUntil.set(normalized, Date.now() + failureCooldownMs);
        }
        return null;
      } finally {
        activeRequestIds.delete(requestId);
      }
    }).finally(() => {
      if (pending.get(normalized) === request) pending.delete(normalized);
    });
    pending.set(normalized, request);
    return request;
  };

  const subscribe = (key: string, listener: CacheListener): (() => void) => {
    const normalized = key.trim();
    let entries = listeners.get(normalized);
    if (!entries) {
      entries = new Set();
      listeners.set(normalized, entries);
    }
    entries.add(listener);
    return () => {
      entries?.delete(listener);
      if (entries?.size === 0) listeners.delete(normalized);
    };
  };

  const forget = (key: string) => {
    const normalized = key.trim();
    resolved.delete(normalized);
    failedUntil.set(normalized, Date.now() + failureCooldownMs);
    notify(normalized);
  };

  const clear = () => {
    revision += 1;
    const subscribedKeys = Array.from(listeners.keys());
    const requestIds = Array.from(activeRequestIds);
    if (requestIds.length > 0) {
      void cancelRequests(requestIds).catch(() => {
        // Revision guards still reject late Host results.
      });
    }
    for (const job of queue.splice(0)) job.cancel();
    resolved.clear();
    pending.clear();
    failedUntil.clear();
    for (const key of subscribedKeys) notify(key);
  };

  return {
    peek,
    subscribe,
    resolve,
    forget,
    clear,
    state: () => ({
      active: activeJobs,
      queued: queue.length,
      cached: resolved.size,
    }),
  };
}
