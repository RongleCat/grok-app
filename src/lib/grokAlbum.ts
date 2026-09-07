import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import type { WallpaperGalleryEmptyPresentation } from "@/lib/wallpaperGalleryPro";

export const GROK_ALBUM_PAGE_SIZE = 20;

export type GrokAlbumStatus =
  | "closed"
  | "loading"
  | "verification"
  | "sign_in"
  | "ready"
  | "other_page";

export type GrokAlbumMedia = {
  mediaUrl: string;
  thumbnailUrl?: string | null;
  kind: "image" | "video" | string;
  width?: number | null;
  height?: number | null;
  createdAt?: string | null;
  postId?: string | null;
};

export type GrokAlbumSnapshot = {
  status: GrokAlbumStatus;
  items: GrokAlbumMedia[];
  total: number;
  canLoadMore: boolean;
  newItems: number;
  prefetchSkipped: boolean;
  pageChanged: boolean;
};

export type GrokAlbumThumbnail = {
  dataUrl: string;
  width: number;
  height: number;
};

export type GrokAlbumErrorCode =
  | "desktop_only"
  | "window"
  | "bridge"
  | "proxy"
  | "timeout"
  | "generic";

/** Defense in depth for Host-returned media metadata. */
export function isGrokAlbumMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.hostname === "assets.grok.com" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      url.pathname.includes("/generated/")
    );
  } catch {
    return false;
  }
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function grokAlbumMediaToGalleryItem(
  media: GrokAlbumMedia,
): WallpaperGalleryItem | null {
  if (!isGrokAlbumMediaUrl(media.mediaUrl)) return null;
  const kind = media.kind === "video" ? "video" : "image";
  const thumb = media.thumbnailUrl || media.mediaUrl;
  if (!isGrokAlbumMediaUrl(thumb)) return null;
  return {
    id: `grok-album-${shortHash(media.mediaUrl)}`,
    thumbUrl: thumb,
    fullUrl: media.mediaUrl,
    kind,
    width:
      Number.isFinite(media.width) && Number(media.width) > 0
        ? Number(media.width)
        : null,
    height:
      Number.isFinite(media.height) && Number(media.height) > 0
        ? Number(media.height)
        : null,
    source: "grok_album",
    username: null,
    postUrl: null,
    textPreview: media.createdAt || null,
    likes: null,
    localPath: null,
    prompt: null,
  };
}

export function grokAlbumItemsToGallery(
  items: readonly GrokAlbumMedia[],
): WallpaperGalleryItem[] {
  const seen = new Set<string>();
  const gallery: WallpaperGalleryItem[] = [];
  for (const media of items) {
    const item = grokAlbumMediaToGalleryItem(media);
    if (!item || seen.has(item.fullUrl)) continue;
    seen.add(item.fullUrl);
    gallery.push(item);
  }
  return gallery;
}

export function nextGrokAlbumVisibleCount(input: {
  current: number;
  available: number;
  pageSize?: number;
}): number {
  const pageSize = Math.max(1, Math.floor(input.pageSize || GROK_ALBUM_PAGE_SIZE));
  const current = Math.max(0, Math.floor(input.current || 0));
  const available = Math.max(0, Math.floor(input.available || 0));
  return Math.min(available, current + pageSize);
}

export function resolveGrokAlbumEmptyPresentation(
  base: WallpaperGalleryEmptyPresentation,
  status: GrokAlbumStatus,
): WallpaperGalleryEmptyPresentation {
  if (status === "ready") {
    return {
      ...base,
      titleKey:
        base.kind === "empty"
          ? "settings.wallpaperSource.empty.noResults"
          : "settings.wallpaperSource.emptyGallery",
      hintKey: "settings.wallpaperSource.grokAlbum.emptyHint",
    };
  }
  return {
    ...base,
    kind: status === "loading" ? "loading" : "idle",
    titleKey: `settings.wallpaperSource.grokAlbum.status.${status}`,
    hintKey:
      status === "sign_in"
        ? "settings.wallpaperSource.grokAlbum.emptySignInHint"
        : "settings.wallpaperSource.grokAlbum.emptyHint",
  };
}

export function parseGrokAlbumError(err: unknown): GrokAlbumErrorCode {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";
  const text = raw.toLowerCase();
  if (text.includes("desktop_only")) return "desktop_only";
  if (text.includes("timeout")) return "timeout";
  if (text.includes("album_proxy")) return "proxy";
  if (text.includes("album_window") || text.includes("album_profile")) {
    return "window";
  }
  if (text.includes("album_bridge") || text.includes("album_page")) {
    return "bridge";
  }
  return "generic";
}
