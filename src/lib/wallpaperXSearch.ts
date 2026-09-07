import type { WallpaperGalleryItem } from "./wallpaperSource";

export type WallpaperXSearchStage =
  | "preparing"
  | "searching_x"
  | "validating"
  | "supplementing"
  | "falling_back"
  | "done";

export type WallpaperXSearchProgress = {
  requestId: string;
  stage: WallpaperXSearchStage;
};

export function createWallpaperXSearchRequestId(): string {
  return crypto.randomUUID();
}

export function isWallpaperXSearchProgress(value: unknown): value is WallpaperXSearchProgress {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.requestId === "string" && event.requestId.length > 0 &&
    typeof event.stage === "string" &&
    ["preparing", "searching_x", "validating", "supplementing", "falling_back", "done"].includes(event.stage);
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
