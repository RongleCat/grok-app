import type { WallpaperGalleryItem } from "./wallpaperSource";
import type { WallpaperSearchResult } from "./wallpaperSource";
import { createWallpaperRequestId } from "./wallpaperRequest";

export const WALLPAPER_X_SEARCH_MODES = [
  "cli",
  "responses_preview",
  "auto",
] as const;

export type WallpaperXSearchMode = (typeof WALLPAPER_X_SEARCH_MODES)[number];

export const DEFAULT_WALLPAPER_X_SEARCH_MODE: WallpaperXSearchMode = "cli";

export type WallpaperXSearchMeta = NonNullable<WallpaperSearchResult["meta"]>;

export const WALLPAPER_X_SEARCH_STAGES = [
  "preparing",
  "searching_x",
  "validating",
  "supplementing",
  "falling_back",
  "done",
] as const;

export type WallpaperXSearchStage =
  (typeof WALLPAPER_X_SEARCH_STAGES)[number];

export type WallpaperXSearchProgress = {
  requestId: string;
  stage: WallpaperXSearchStage;
};

export function createWallpaperXSearchRequestId(): string {
  return createWallpaperRequestId();
}

export function isWallpaperXSearchProgress(
  value: unknown,
): value is WallpaperXSearchProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<WallpaperXSearchProgress>;
  return (
    typeof progress.requestId === "string" &&
    progress.requestId.length > 0 &&
    WALLPAPER_X_SEARCH_STAGES.includes(progress.stage as WallpaperXSearchStage)
  );
}

export type WallpaperXSearchBatch = {
  requestId: string;
  batchIndex: number;
  items: WallpaperGalleryItem[];
  accumulatedCount: number;
  done: boolean;
};

export function isWallpaperXSearchBatch(
  value: unknown,
): value is WallpaperXSearchBatch {
  if (!value || typeof value !== "object") return false;
  const batch = value as Partial<WallpaperXSearchBatch>;
  return (
    typeof batch.requestId === "string" &&
    batch.requestId.length > 0 &&
    Number.isInteger(batch.batchIndex) &&
    (batch.batchIndex ?? 0) >= 1 &&
    Array.isArray(batch.items) &&
    batch.items.every(isWallpaperGalleryItem) &&
    Number.isInteger(batch.accumulatedCount) &&
    (batch.accumulatedCount ?? -1) >= batch.items.length &&
    typeof batch.done === "boolean"
  );
}

function isWallpaperGalleryItem(value: unknown): value is WallpaperGalleryItem {
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
    typeof item.source === "string" &&
    item.source.length > 0
  );
}

export type WallpaperXSearchFallbackReasonKey =
  | "settings.wallpaperSource.route.fallback.auth"
  | "settings.wallpaperSource.route.fallback.network"
  | "settings.wallpaperSource.route.fallback.compatibility"
  | "settings.wallpaperSource.route.fallback.empty"
  | "settings.wallpaperSource.route.fallback.circuit"
  | "settings.wallpaperSource.route.fallback.other";

export type WallpaperXSearchRouteSummary = {
  key:
    | "settings.wallpaperSource.route.cli"
    | "settings.wallpaperSource.route.responses"
    | "settings.wallpaperSource.route.fallback"
    | "settings.wallpaperSource.route.fallbackTimed";
  seconds: string;
  responsesSeconds?: string;
  cliSeconds?: string;
  reasonKey?: WallpaperXSearchFallbackReasonKey;
  cacheHit: boolean;
};

export type WallpaperXSearchProgressMessageKey =
  | "settings.wallpaperSource.progress.preparing"
  | "settings.wallpaperSource.searching"
  | "settings.wallpaperSource.progress.validating"
  | "settings.wallpaperSource.progress.supplementing"
  | "settings.wallpaperSource.progress.fallingBack";

export function wallpaperXSearchProgressMessageKey(
  stage: WallpaperXSearchStage | null | undefined,
): WallpaperXSearchProgressMessageKey | null {
  switch (stage) {
    case "preparing":
      return "settings.wallpaperSource.progress.preparing";
    case "searching_x":
      return "settings.wallpaperSource.searching";
    case "validating":
      return "settings.wallpaperSource.progress.validating";
    case "supplementing":
      return "settings.wallpaperSource.progress.supplementing";
    case "falling_back":
      return "settings.wallpaperSource.progress.fallingBack";
    default:
      return null;
  }
}

/** Unknown or missing persisted values must never opt users into preview mode. */
export function normalizeWallpaperXSearchMode(
  raw: unknown,
): WallpaperXSearchMode {
  return raw === "responses_preview" || raw === "auto"
    ? raw
    : DEFAULT_WALLPAPER_X_SEARCH_MODE;
}

export function wallpaperXSearchFallbackReasonKey(
  reason: string | null | undefined,
): WallpaperXSearchFallbackReasonKey {
  switch ((reason ?? "").trim().toLowerCase()) {
    case "oauth_unavailable":
    case "oauth_expired":
    case "responses_unauthorized":
      return "settings.wallpaperSource.route.fallback.auth";
    case "responses_server_error":
    case "responses_timeout":
    case "responses_tls":
    case "responses_network":
      return "settings.wallpaperSource.route.fallback.network";
    case "responses_bad_request":
    case "responses_invalid_json":
    case "responses_protocol":
    case "responses_search_budget_exceeded":
      return "settings.wallpaperSource.route.fallback.compatibility";
    case "responses_empty":
      return "settings.wallpaperSource.route.fallback.empty";
    case "responses_circuit_open":
      return "settings.wallpaperSource.route.fallback.circuit";
    default:
      return "settings.wallpaperSource.route.fallback.other";
  }
}

export function wallpaperXSearchRouteSummary(
  meta: WallpaperXSearchMeta | null | undefined,
): WallpaperXSearchRouteSummary | null {
  if (!meta || !Number.isFinite(meta.durationMs) || meta.durationMs < 0) {
    return null;
  }
  const seconds = (meta.durationMs / 1000).toFixed(1);
  const cacheHit = meta.cacheHit === true;
  if (meta.routeUsed === "cli" && meta.fallbackReason) {
    const responsesSeconds = durationSeconds(meta.responsesDurationMs);
    const cliSeconds = durationSeconds(meta.cliDurationMs);
    if (!cacheHit && responsesSeconds !== null && cliSeconds !== null) {
      return {
        key: "settings.wallpaperSource.route.fallbackTimed",
        seconds,
        responsesSeconds,
        cliSeconds,
        reasonKey: wallpaperXSearchFallbackReasonKey(meta.fallbackReason),
        cacheHit: false,
      };
    }
    return {
      key: "settings.wallpaperSource.route.fallback",
      seconds,
      reasonKey: wallpaperXSearchFallbackReasonKey(meta.fallbackReason),
      cacheHit,
    };
  }
  if (meta.routeUsed === "responses") {
    return {
      key: "settings.wallpaperSource.route.responses",
      seconds,
      cacheHit,
    };
  }
  if (meta.routeUsed === "cli") {
    return {
      key: "settings.wallpaperSource.route.cli",
      seconds,
      cacheHit,
    };
  }
  return null;
}

function durationSeconds(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? (value / 1000).toFixed(1)
    : null;
}
