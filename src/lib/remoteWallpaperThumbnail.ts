import * as api from "@/lib/api";
import {
  isWallpaperRemoteSource,
  type WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import { createWallpaperThumbnailCache } from "@/lib/wallpaperThumbnailCache";

const thumbnails = createWallpaperThumbnailCache({
  cancelRequests: api.wallpaperRemoteCancelMediaRequests,
});

type RemoteThumbnailInput = Pick<
  WallpaperGalleryItem,
  "source" | "thumbUrl" | "fullUrl"
>;

type RemoteThumbnailTarget = {
  key: string;
  source: WallpaperRemoteSource;
  url: string;
};

function safeHttpsUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function targetFor(input: RemoteThumbnailInput): RemoteThumbnailTarget | null {
  if (!isWallpaperRemoteSource(input.source)) return null;
  const url = safeHttpsUrl(input.thumbUrl || input.fullUrl);
  if (!url) return null;
  return {
    source: input.source,
    url,
    key: `${input.source}\u0000${url}`,
  };
}

export function peekRemoteWallpaperThumbnail(
  input: RemoteThumbnailInput,
): string | null {
  const target = targetFor(input);
  return target ? thumbnails.peek(target.key) : null;
}

export function subscribeRemoteWallpaperThumbnail(
  input: RemoteThumbnailInput,
  listener: () => void,
): () => void {
  const target = targetFor(input);
  return target ? thumbnails.subscribe(target.key, listener) : () => undefined;
}

export function resolveRemoteWallpaperThumbnail(
  input: RemoteThumbnailInput,
): Promise<string | null> {
  const target = targetFor(input);
  if (!target) return Promise.resolve(null);
  return thumbnails.resolve(target.key, (requestId) =>
    api.wallpaperRemoteThumbnail(target.source, target.url, requestId),
  );
}

export function forgetRemoteWallpaperThumbnail(
  input: RemoteThumbnailInput,
): void {
  const target = targetFor(input);
  if (target) thumbnails.forget(target.key);
}

export function clearRemoteWallpaperThumbnailCache(): void {
  thumbnails.clear();
}

/** Test helper. */
export function remoteWallpaperThumbnailQueueState(): {
  active: number;
  queued: number;
  cached: number;
} {
  return thumbnails.state();
}
