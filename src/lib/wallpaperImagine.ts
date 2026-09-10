import type { MessageKey } from "@/i18n";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";

export type WallpaperImagineMode = "image" | "edit" | "video";
export type WallpaperVideoDuration = 6 | 10;
export type WallpaperVideoResolution = "480p" | "720p";
export type WallpaperVideoSourceStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "error";

export type WallpaperImagineResult = {
  items: WallpaperGalleryItem[];
  errorCode?: string | null;
  message?: string | null;
  catalogRecoveryId?: string | null;
};

export type WallpaperImagineRecovery = {
  recoveryId: string;
  item: WallpaperGalleryItem;
};

export type WallpaperImagineControlsModel = {
  mode: WallpaperImagineMode;
  prompt: string;
  aspect: string;
  aspectOptions: Array<{ value: string; label: string }>;
  videoDuration: WallpaperVideoDuration;
  videoResolution: WallpaperVideoResolution;
  videoSource: WallpaperGalleryItem | null;
  videoSourcePath: string | null;
  videoSourcePreview: string | null;
  videoSourceStatus: WallpaperVideoSourceStatus;
  generating: boolean;
  cancelling: boolean;
  catalogRecoveryCount: number;
  recoveringCatalog: boolean;
  onModeChange: (value: WallpaperImagineMode) => void;
  onPromptChange: (value: string) => void;
  onAspectChange: (value: string) => void;
  onVideoDurationChange: (value: WallpaperVideoDuration) => void;
  onVideoResolutionChange: (value: WallpaperVideoResolution) => void;
  onClearVideoSource: () => void;
  onUploadSource: () => void;
  onGenerate: () => void;
  onCancelGeneration: () => void;
  onRetryCatalogSave: () => void;
};

export const WALLPAPER_VIDEO_DURATIONS: readonly WallpaperVideoDuration[] = [
  6, 10,
] as const;

export const WALLPAPER_VIDEO_RESOLUTIONS: readonly WallpaperVideoResolution[] = [
  "480p",
  "720p",
] as const;

const MAX_VIDEO_SOURCE_CONTEXT_CHARS = 240;
const SOURCE_CONTEXT_URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;
const SOURCE_CONTEXT_HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i;
const SOURCE_CONTEXT_FILE_RE = /^[^\\/\n]+\.(?:avif|bmp|gif|heic|jpe?g|png|webp)$/i;

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) => string;

type VideoPromptSource = Pick<WallpaperGalleryItem, "source" | "prompt" | "textPreview">;

/** Remote captions and Saved timestamps must never become agent instructions. */
export function wallpaperVideoSourceContext(
  item: VideoPromptSource,
): string | null {
  if (item.source !== "imagine") return null;
  for (const raw of [item.prompt]) {
    const normalized =
      raw
        ?.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim() ?? "";
    if (
      normalized.length < 3 ||
      SOURCE_CONTEXT_URL_RE.test(normalized) ||
      SOURCE_CONTEXT_HOST_RE.test(normalized) ||
      SOURCE_CONTEXT_FILE_RE.test(normalized) ||
      (/^@\S+$/.test(normalized) && !normalized.includes(" "))
    ) {
      continue;
    }
    const chars = Array.from(normalized);
    return chars.length > MAX_VIDEO_SOURCE_CONTEXT_CHARS
      ? `${chars.slice(0, MAX_VIDEO_SOURCE_CONTEXT_CHARS - 1).join("")}…`
      : normalized;
  }
  return null;
}

/** Build an immediate, editable motion prompt without a model/network call. */
export function buildWallpaperVideoPrompt(
  t: Translate,
  item: VideoPromptSource,
): string {
  const context = wallpaperVideoSourceContext(item);
  return context
    ? t("settings.wallpaperSource.videoPromptDefaultWithContext", { context })
    : t("settings.wallpaperSource.videoPromptDefault");
}

export function isWallpaperImageItem(
  item: Pick<WallpaperGalleryItem, "kind">,
): boolean {
  const kind = item.kind.trim().toLowerCase();
  return kind !== "video" && !kind.startsWith("video/");
}
