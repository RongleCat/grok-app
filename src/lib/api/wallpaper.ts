import type {
  WallpaperRemoteSearchBatch,
  WallpaperRemoteSearchProgress,
  WallpaperRemoteSearchResult,
  WallpaperRemoteSource,
  WallpaperRemoteThumbnail,
} from "../wallpaperRemoteSearch";
/** API domain: wallpaper */

import {
  invoke,
  listen,
} from "./host";
import { prepareWallpaperVideoImage } from "../wallpaperVideoImage";

import type {
  WallpaperFetchResult,
  WallpaperGalleryItem,
  WallpaperLibraryEntry,
  WallpaperSearchResult,
} from "../wallpaperSource";
import type {
  GrokAlbumSnapshot,
  GrokAlbumThumbnail,
} from "../grokAlbum";
import type {
  WallpaperVideoDuration,
  WallpaperVideoResolution,
} from "../wallpaperImagine";
export type {
  WallpaperFetchResult,
  WallpaperGalleryItem,
  WallpaperLibraryEntry,
  WallpaperSearchResult,
} from "../wallpaperSource";

// ── Wallpaper sources (X search + Imagine) ──────────────────────────────────

export async function wallpaperXSearch(
  query: string,
  sort?: "top" | "latest",
  requestId?: string,
): Promise<WallpaperSearchResult> {
  return invoke<WallpaperSearchResult>("wallpaper_x_search", {
    query,
    sort: sort ?? null,
    requestId: requestId ?? null,
  });
}

export async function wallpaperXSearchCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("wallpaper_x_search_cancel", { requestId });
}

export async function listenWallpaperXSearchProgress(
  handler: (progress: import("../wallpaperXSearch").WallpaperXSearchProgress) => void,
): Promise<() => void> {
  return listen<import("../wallpaperXSearch").WallpaperXSearchProgress>(
    "wallpaper://x-search-progress", handler,
  );
}

export async function wallpaperFetchMedia(
  url: string,
  source?: string,
): Promise<WallpaperFetchResult> {
  return invoke<WallpaperFetchResult>("wallpaper_fetch_media", {
    url,
    source: source ?? null,
  });
}

export async function wallpaperImagine(
  prompt: string,
  aspectRatio?: string,
  requestId?: string,
): Promise<WallpaperSearchResult> {
  return invoke<WallpaperSearchResult>("wallpaper_imagine", {
    prompt,
    aspectRatio: aspectRatio ?? null,
    requestId: requestId ?? null,
  });
}

const imagePreparations = new Map<string, AbortController>();

export async function wallpaperImportImage(
  sourcePath: string,
): Promise<WallpaperFetchResult> {
  const sourcePngBase64 = await prepareWallpaperVideoImage(
    sourcePath,
    new AbortController().signal,
  );
  return invoke<WallpaperFetchResult>("wallpaper_import_image", {
    sourcePath,
    sourcePngBase64,
  });
}

export async function wallpaperImageEdit(
  sourcePath: string,
  prompt: string,
  aspectRatio: string,
  requestId: string,
): Promise<WallpaperSearchResult> {
  const preparation = new AbortController();
  imagePreparations.set(requestId, preparation);
  try {
    const sourcePngBase64 = await prepareWallpaperVideoImage(
      sourcePath,
      preparation.signal,
    );
    preparation.signal.throwIfAborted();
    return await invoke<WallpaperSearchResult>("wallpaper_image_edit", {
      sourcePath,
      sourcePngBase64,
      prompt,
      aspectRatio,
      requestId,
    });
  } finally {
    if (imagePreparations.get(requestId) === preparation) {
      imagePreparations.delete(requestId);
    }
  }
}

export async function wallpaperImageToVideo(
  sourcePath: string,
  motionPrompt: string,
  duration: WallpaperVideoDuration,
  resolutionName: WallpaperVideoResolution,
  requestId: string,
): Promise<WallpaperSearchResult> {
  const preparation = new AbortController();
  imagePreparations.set(requestId, preparation);
  try {
    const sourcePngBase64 = await prepareWallpaperVideoImage(
      sourcePath,
      preparation.signal,
    );
    preparation.signal.throwIfAborted();
    return await invoke<WallpaperSearchResult>("wallpaper_image_to_video", {
      sourcePath,
      sourcePngBase64,
      motionPrompt: motionPrompt.trim() || null,
      duration,
      resolutionName,
      requestId,
    });
  } finally {
    if (imagePreparations.get(requestId) === preparation) {
      imagePreparations.delete(requestId);
    }
  }
}

export async function wallpaperImageToVideoCancel(
  requestId: string,
): Promise<boolean> {
  imagePreparations.get(requestId)?.abort();
  return invoke<boolean>("wallpaper_image_to_video_cancel", { requestId });
}

export async function wallpaperLibraryList(
  limit?: number,
): Promise<WallpaperLibraryEntry[]> {
  return invoke<WallpaperLibraryEntry[]>("wallpaper_library_list", {
    limit: limit ?? null,
  });
}

export type WallpaperLibraryQuery = {
  query: string;
  kind: "all" | "image" | "video";
  purpose?: import("../wallpaperSource").WallpaperLibraryPurpose;
};

export type WallpaperLibraryPage = {
  items: WallpaperLibraryEntry[];
  nextCursor: string | null;
  total: number;
  kindCounts: { all: number; image: number; video: number };
};

export async function wallpaperLibraryPage(
  query: WallpaperLibraryQuery,
  cursor: string | null = null,
): Promise<WallpaperLibraryPage> {
  return invoke<WallpaperLibraryPage>("wallpaper_library_page", {
    query,
    cursor,
    limit: 48,
  });
}

type WallpaperLibraryRememberItem = Pick<
  WallpaperGalleryItem,
  | "source"
  | "fullUrl"
  | "sourceUrl"
  | "sourceName"
  | "authorName"
  | "authorUrl"
  | "username"
  | "postUrl"
  | "license"
  | "licenseUrl"
  | "textPreview"
>;

export async function wallpaperLibraryRemember(
  path: string,
  item: WallpaperLibraryRememberItem,
  favorite?: boolean,
): Promise<import("../wallpaperSource").WallpaperMediaRecord> {
  return invoke("wallpaper_library_remember", {
    path,
    metadata: {
      source: item.source,
      mediaUrl: item.fullUrl,
      sourceUrl: item.sourceUrl || item.postUrl || null,
      sourceName: item.sourceName ?? null,
      authorName: item.authorName || item.username || null,
      authorUrl: item.authorUrl ?? null,
      license: item.license ?? null,
      licenseUrl: item.licenseUrl ?? null,
      title: item.textPreview ?? null,
    },
    favorite: favorite ?? null,
  });
}

export type WallpaperLibraryMatch = {
  index: number;
  path: string;
  metadata: import("../wallpaperSource").WallpaperMediaRecord;
};

export async function wallpaperLibraryLookup(
  requests: Array<{ source: string; mediaUrl: string }>,
): Promise<WallpaperLibraryMatch[]> {
  return invoke("wallpaper_library_lookup", { requests });
}

export async function wallpaperLibraryFindById(
  id: string,
): Promise<WallpaperLibraryEntry | null> {
  return invoke("wallpaper_library_find_by_id", { id });
}

// ── Grok Imagine saved album (isolated consumer WebView) ───────────────────

export async function wallpaperGrokAlbumOpen(title: string): Promise<void> {
  await invoke<void>("wallpaper_grok_album_open", { title });
}

export async function wallpaperGrokAlbumSnapshot(): Promise<GrokAlbumSnapshot> {
  return invoke<GrokAlbumSnapshot>("wallpaper_grok_album_snapshot");
}

export async function wallpaperGrokAlbumRefresh(): Promise<void> {
  await invoke<void>("wallpaper_grok_album_refresh");
}

export async function wallpaperGrokAlbumLoadMore(
  backgroundOnly = false,
): Promise<GrokAlbumSnapshot> {
  return invoke<GrokAlbumSnapshot>("wallpaper_grok_album_load_more", {
    backgroundOnly,
  });
}

export async function wallpaperGrokAlbumThumbnail(
  url: string,
  requestId: string,
): Promise<GrokAlbumThumbnail> {
  return invoke<GrokAlbumThumbnail>("wallpaper_grok_album_thumbnail", {
    url,
    requestId,
  });
}

export async function wallpaperGrokAlbumCancelRequests(
  requestIds: string[],
): Promise<number> {
  return invoke<number>("wallpaper_grok_album_cancel_requests", { requestIds });
}

export async function wallpaperGrokAlbumCancelAllRequests(): Promise<number> {
  return invoke<number>("wallpaper_grok_album_cancel_all_requests");
}

export async function wallpaperGrokAlbumFetchMedia(
  url: string,
  requestId: string,
): Promise<WallpaperFetchResult> {
  return invoke<WallpaperFetchResult>("wallpaper_grok_album_fetch_media", {
    url,
    requestId,
  });
}

// ── X Evidence Rail (search → local evidence store → quote pack) ────────────
// Design: docs/features/x-search.md — every X search result becomes a local
// evidence row with a stable id; later turns list / re-read / quote it.

export interface XEvidenceItem {
  evidenceId: string;
  statusId?: string;
  url?: string;
  author?: string;
  text?: string;
  createdAt?: string;
  likes?: number;
  query?: string;
  sessionTag?: string;
  source: string;
  verified: boolean;
  fetchedAtMs: number;
}

export interface XSearchEnvelope {
  ok: boolean;
  errorCode?: string;
  message?: string;
  query: string;
  evidence: XEvidenceItem[];
  newCount: number;
  unverifiedCount: number;
}

export interface XEvidenceFilter {
  sessionTag?: string;
  queryContains?: string;
  author?: string;
  limit?: number;
}

export interface XQuotePack {
  markdown: string;
  path?: string;
  count: number;
}

export async function xEvidenceSearch(
  query: string,
  limit?: number,
  sessionTag?: string,
): Promise<XSearchEnvelope> {
  return invoke<XSearchEnvelope>("x_evidence_search", {
    query,
    limit: limit ?? null,
    sessionTag: sessionTag ?? null,
  });
}

export async function xEvidenceList(
  filter?: XEvidenceFilter,
): Promise<XEvidenceItem[]> {
  return invoke<XEvidenceItem[]>("x_evidence_list", {
    filter: filter ?? null,
  });
}

export async function xEvidenceGet(ids: string[]): Promise<XEvidenceItem[]> {
  return invoke<XEvidenceItem[]>("x_evidence_get", { ids });
}

export async function xQuotePack(
  ids: string[],
  title?: string,
): Promise<XQuotePack> {
  return invoke<XQuotePack>("x_quote_pack", { ids, title: title ?? null });
}

export interface XEvidenceStats {
  total: number;
  todayNew: number;
  weekPacks: number;
}

export async function xEvidenceStats(): Promise<XEvidenceStats> {
  return invoke<XEvidenceStats>("x_evidence_stats");
}

export async function wallpaperLibraryDelete(path: string): Promise<void> {
  await invoke<void>("wallpaper_library_delete", { path });
}


export async function listenWallpaperXSearchBatch(
  handler: (batch: import("../wallpaperXSearch").WallpaperXSearchBatch) => void,
): Promise<() => void> {
  return listen<import("../wallpaperXSearch").WallpaperXSearchBatch>("wallpaper://x-search-batch", handler);
}

export async function wallpaperXSearchMore(continuationId: string, requestId: string): Promise<WallpaperSearchResult> {
  return invoke<WallpaperSearchResult>("wallpaper_x_search_more", { continuationId, requestId });
}

export async function wallpaperRemoteSearch(
  source: WallpaperRemoteSource,
  query: string,
  requestId?: string,
): Promise<WallpaperRemoteSearchResult> {
  return invoke<WallpaperRemoteSearchResult>("wallpaper_remote_search", {
    source,
    query,
    requestId: requestId ?? null,
  });
}

export async function wallpaperRemoteSearchMore(
  source: WallpaperRemoteSource,
  query: string,
  requestId?: string,
): Promise<WallpaperRemoteSearchResult> {
  return invoke<WallpaperRemoteSearchResult>("wallpaper_remote_search_more", {
    source,
    query,
    requestId: requestId ?? null,
  });
}

export async function wallpaperRemoteSearchCancel(
  source: WallpaperRemoteSource,
  requestId: string,
): Promise<boolean> {
  return invoke<boolean>("wallpaper_remote_search_cancel", {
    source,
    requestId,
  });
}

export function listenWallpaperRemoteSearchProgress(
  handler: (progress: WallpaperRemoteSearchProgress) => void,
): Promise<() => void> {
  return listen<WallpaperRemoteSearchProgress>(
    "wallpaper://remote-search-progress",
    handler,
  );
}

export function listenWallpaperRemoteSearchBatch(
  handler: (batch: WallpaperRemoteSearchBatch) => void,
): Promise<() => void> {
  return listen<WallpaperRemoteSearchBatch>(
    "wallpaper://remote-search-batch",
    handler,
  );
}

export async function wallpaperRemoteFetchMedia(
  source: WallpaperRemoteSource,
  url: string,
  requestId: string,
): Promise<WallpaperFetchResult> {
  return invoke<WallpaperFetchResult>("wallpaper_remote_fetch_media", {
    source,
    url,
    requestId,
  });
}

export async function wallpaperRemoteThumbnail(
  source: WallpaperRemoteSource,
  url: string,
  requestId: string,
): Promise<WallpaperRemoteThumbnail> {
  return invoke<WallpaperRemoteThumbnail>("wallpaper_remote_thumbnail", {
    source,
    url,
    requestId,
  });
}

export async function wallpaperRemoteCancelMediaRequests(
  requestIds: string[],
): Promise<number> {
  return invoke<number>("wallpaper_remote_cancel_media_requests", {
    requestIds,
  });
}

export async function wallpaperRemoteCancelAllMediaRequests(): Promise<number> {
  return invoke<number>("wallpaper_remote_cancel_all_media_requests");
}
