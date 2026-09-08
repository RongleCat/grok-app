import * as api from "@/lib/api";
import {
  cancelGrokAlbumMediaRequests,
  fetchGrokAlbumMedia,
} from "@/lib/grokAlbumMedia";
import { createWallpaperRequestId } from "@/lib/wallpaperRequest";
import {
  resolveApplySource,
  type WallpaperGalleryItem,
  type WallpaperMediaRecord,
} from "@/lib/wallpaperSource";
import {
  isWallpaperRemoteSource,
  type WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";
import { clearRemoteWallpaperThumbnailCache } from "@/lib/remoteWallpaperThumbnail";

export const EMPTY_WALLPAPER_IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

export { cancelGrokAlbumMediaRequests };

export async function cancelRemoteWallpaperMediaRequests(): Promise<void> {
  clearRemoteWallpaperThumbnailCache();
  await Promise.allSettled([api.wallpaperRemoteCancelAllMediaRequests()]);
}

export type LocalWallpaperMedia = {
  path: string;
  name?: string;
  mime?: string;
  metadata?: WallpaperMediaRecord;
};

type EnsureLocalWallpaperMediaOptions = {
  signal?: AbortSignal;
};

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function awaitAbortable<T>(
  request: Promise<T>,
  signal: AbortSignal | undefined,
  cancel?: () => Promise<unknown>,
): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      if (cancel) void cancel().catch(() => {});
      finish(() => reject(abortReason(signal)));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void request.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Materialize a remote original and persist its source metadata in the catalog. */
export async function ensureLocalWallpaperMedia(
  item: WallpaperGalleryItem,
  options: EnsureLocalWallpaperMediaOptions = {},
): Promise<LocalWallpaperMedia> {
  const { signal } = options;
  throwIfAborted(signal);
  const source = resolveApplySource(item);
  if (source.kind === "path") {
    return {
      path: source.path,
      ...(item.metadata ? { metadata: item.metadata } : {}),
    };
  }

  let fetched;
  if (item.source === "grok_album") {
    fetched = signal
      ? await fetchGrokAlbumMedia(source.url, { signal })
      : await fetchGrokAlbumMedia(source.url);
  } else if (isWallpaperRemoteSource(item.source)) {
    const requestId = createWallpaperRequestId();
    fetched = await awaitAbortable(
      api.wallpaperRemoteFetchMedia(
        item.source as WallpaperRemoteSource,
        source.url,
        requestId,
      ),
      signal,
      () => api.wallpaperRemoteCancelMediaRequests([requestId]),
    );
  } else {
    fetched = await awaitAbortable(
      api.wallpaperFetchMedia(
        source.url,
        item.source === "imagine" ? "imagine" : "x",
      ),
      signal,
    );
  }

  throwIfAborted(signal);
  const metadata = await api.wallpaperLibraryRemember(fetched.path, item);
  throwIfAborted(signal);
  return {
    path: fetched.path,
    name: fetched.name,
    mime: fetched.mime,
    metadata,
  };
}
