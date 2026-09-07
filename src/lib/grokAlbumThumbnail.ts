import * as api from "@/lib/api";
import { isGrokAlbumMediaUrl } from "@/lib/grokAlbum";
import { createWallpaperThumbnailCache } from "@/lib/wallpaperThumbnailCache";

const thumbnails = createWallpaperThumbnailCache({
  cancelRequests: api.wallpaperGrokAlbumCancelRequests,
});

function normalizedAlbumUrl(url: string): string {
  return url.trim();
}

export function peekGrokAlbumThumbnail(url: string): string | null {
  return thumbnails.peek(normalizedAlbumUrl(url));
}

export function subscribeGrokAlbumThumbnail(
  url: string,
  listener: () => void,
): () => void {
  return thumbnails.subscribe(normalizedAlbumUrl(url), listener);
}

export function resolveGrokAlbumThumbnail(
  url: string,
): Promise<string | null> {
  const normalized = normalizedAlbumUrl(url);
  if (!isGrokAlbumMediaUrl(normalized)) return Promise.resolve(null);
  return thumbnails.resolve(normalized, (requestId) =>
    api.wallpaperGrokAlbumThumbnail(normalized, requestId),
  );
}

export async function warmGrokAlbumThumbnails(
  urls: readonly string[],
): Promise<void> {
  const unique = Array.from(
    new Set(urls.map(normalizedAlbumUrl).filter(Boolean)),
  ).slice(0, 40);
  await Promise.all(unique.map(resolveGrokAlbumThumbnail));
}

export function forgetGrokAlbumThumbnail(url: string): void {
  thumbnails.forget(normalizedAlbumUrl(url));
}

export function clearGrokAlbumThumbnailCache(): void {
  thumbnails.clear();
}

/** Test helper. */
export function grokAlbumThumbnailQueueState(): {
  active: number;
  queued: number;
  cached: number;
} {
  return thumbnails.state();
}
