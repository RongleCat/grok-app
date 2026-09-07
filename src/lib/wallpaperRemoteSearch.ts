import type { WallpaperGalleryItem } from "./wallpaperSource";
import { createWallpaperRequestId } from "./wallpaperRequest";

export const WALLPAPER_REMOTE_SOURCES = [
  "web",
  "openverse",
  "pexels",
] as const;

export type WallpaperRemoteSource = (typeof WALLPAPER_REMOTE_SOURCES)[number];

export const WALLPAPER_REMOTE_SEARCH_STAGES = [
  "preparing",
  "searching_web",
  "searching_provider",
  "fetching_sources",
  "validating_images",
  "loading_more",
  "done",
] as const;

export type WallpaperRemoteSearchStage =
  (typeof WALLPAPER_REMOTE_SEARCH_STAGES)[number];

export type WallpaperRemoteSearchResult = {
  source: WallpaperRemoteSource;
  items: WallpaperGalleryItem[];
  errorCode?: string | null;
  message?: string | null;
  hasMore: boolean;
  cacheHit: boolean;
  durationMs: number;
};

export type WallpaperRemoteThumbnail = {
  dataUrl: string;
  width: number;
  height: number;
};

export type WallpaperRemoteSearchProgress = {
  requestId: string;
  source: WallpaperRemoteSource;
  stage: WallpaperRemoteSearchStage;
};

export type WallpaperRemoteSearchBatch = {
  requestId: string;
  source: WallpaperRemoteSource;
  batchIndex: number;
  items: WallpaperGalleryItem[];
  accumulatedCount: number;
  done: boolean;
};

export function createWallpaperRemoteSearchRequestId(): string {
  return createWallpaperRequestId();
}

export function isWallpaperRemoteSource(
  value: unknown,
): value is WallpaperRemoteSource {
  return WALLPAPER_REMOTE_SOURCES.includes(value as WallpaperRemoteSource);
}

function isGalleryItem(value: unknown): value is WallpaperGalleryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WallpaperGalleryItem>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.thumbUrl === "string" &&
    item.thumbUrl.length > 0 &&
    typeof item.fullUrl === "string" &&
    item.fullUrl.length > 0 &&
    typeof item.kind === "string" &&
    item.kind.length > 0 &&
    isWallpaperRemoteSource(item.source)
  );
}

export function isWallpaperRemoteSearchProgress(
  value: unknown,
): value is WallpaperRemoteSearchProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<WallpaperRemoteSearchProgress>;
  return (
    typeof progress.requestId === "string" &&
    progress.requestId.length > 0 &&
    isWallpaperRemoteSource(progress.source) &&
    WALLPAPER_REMOTE_SEARCH_STAGES.includes(
      progress.stage as WallpaperRemoteSearchStage,
    )
  );
}

export function isWallpaperRemoteSearchBatch(
  value: unknown,
): value is WallpaperRemoteSearchBatch {
  if (!value || typeof value !== "object") return false;
  const batch = value as Partial<WallpaperRemoteSearchBatch>;
  return (
    typeof batch.requestId === "string" &&
    batch.requestId.length > 0 &&
    isWallpaperRemoteSource(batch.source) &&
    Number.isInteger(batch.batchIndex) &&
    (batch.batchIndex ?? 0) >= 1 &&
    Array.isArray(batch.items) &&
    batch.items.every(
      (item) => isGalleryItem(item) && item.source === batch.source,
    ) &&
    Number.isInteger(batch.accumulatedCount) &&
    (batch.accumulatedCount ?? -1) >= batch.items.length &&
    typeof batch.done === "boolean"
  );
}

export type WallpaperRemoteProgressMessageKey =
  | "settings.wallpaperSource.remote.progress.preparing"
  | "settings.wallpaperSource.remote.progress.searchingWeb"
  | "settings.wallpaperSource.remote.progress.searchingOpenverse"
  | "settings.wallpaperSource.remote.progress.searchingPexels"
  | "settings.wallpaperSource.remote.progress.fetchingSources"
  | "settings.wallpaperSource.remote.progress.validatingImages"
  | "settings.wallpaperSource.remote.progress.loadingMore";

export function wallpaperRemoteProgressMessageKey(
  stage: WallpaperRemoteSearchStage | null | undefined,
  source?: WallpaperRemoteSource | null,
): WallpaperRemoteProgressMessageKey | null {
  switch (stage) {
    case "preparing":
      return "settings.wallpaperSource.remote.progress.preparing";
    case "searching_web":
      return "settings.wallpaperSource.remote.progress.searchingWeb";
    case "searching_provider":
      return source === "pexels"
        ? "settings.wallpaperSource.remote.progress.searchingPexels"
        : "settings.wallpaperSource.remote.progress.searchingOpenverse";
    case "fetching_sources":
      return "settings.wallpaperSource.remote.progress.fetchingSources";
    case "validating_images":
      return "settings.wallpaperSource.remote.progress.validatingImages";
    case "loading_more":
      return "settings.wallpaperSource.remote.progress.loadingMore";
    default:
      return null;
  }
}

export type WallpaperRemoteUiError =
  | "auth_required"
  | "pexels_key_required"
  | "pexels_key_invalid"
  | "rate_limited"
  | "timeout"
  | "empty"
  | "search_failed"
  | "service_unavailable"
  | "generic";

export function wallpaperRemoteUiError(
  result: WallpaperRemoteSearchResult,
): WallpaperRemoteUiError | null {
  if (result.items.length > 0) return null;
  const code = (result.errorCode ?? "").trim().toLowerCase();
  if (!code || code === "empty" || code === "responses_empty") return "empty";
  if (
    code === "oauth_unavailable" ||
    code === "oauth_expired" ||
    code === "responses_unauthorized"
  ) {
    return "auth_required";
  }
  if (code === "pexels_key_missing") return "pexels_key_required";
  if (code === "pexels_key_invalid") return "pexels_key_invalid";
  if (code === "responses_rate_limited" || code === "provider_rate_limited") {
    return "rate_limited";
  }
  if (code === "responses_timeout" || code === "provider_timeout") {
    return "timeout";
  }
  if (
    code === "responses_network" ||
    code === "responses_tls" ||
    code === "provider_network"
  ) {
    return "search_failed";
  }
  if (
    code === "responses_server_error" ||
    code === "responses_bad_request" ||
    code === "responses_invalid_json" ||
    code === "responses_protocol" ||
    code === "responses_tool_not_called" ||
    code === "responses_tool_budget_exceeded" ||
    code === "provider_service_unavailable" ||
    code === "provider_protocol"
  ) {
    return "service_unavailable";
  }
  return "generic";
}
