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

/** Materialize a remote original and persist its source metadata in the catalog. */
export async function ensureLocalWallpaperMedia(
  item: WallpaperGalleryItem,
): Promise<LocalWallpaperMedia> {
  const source = resolveApplySource(item);
  if (source.kind === "path") {
    return {
      path: source.path,
      ...(item.metadata ? { metadata: item.metadata } : {}),
    };
  }

  let fetched;
  if (item.source === "grok_album") {
    fetched = await fetchGrokAlbumMedia(source.url);
  } else if (isWallpaperRemoteSource(item.source)) {
    fetched = await api.wallpaperRemoteFetchMedia(
      item.source as WallpaperRemoteSource,
      source.url,
      createWallpaperRequestId(),
    );
  } else {
    fetched = await api.wallpaperFetchMedia(
      source.url,
      item.source === "imagine" ? "imagine" : "x",
    );
  }

  const metadata = await api.wallpaperLibraryRemember(fetched.path, item);
  return {
    path: fetched.path,
    name: fetched.name,
    mime: fetched.mime,
    metadata,
  };
}
