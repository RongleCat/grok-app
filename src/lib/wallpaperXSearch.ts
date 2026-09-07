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
