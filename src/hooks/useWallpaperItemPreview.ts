import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  ImageSlideInput,
  ImageViewerApi,
} from "@/components/ImageViewerContext";
import type { MessageKey } from "@/i18n";
import { isDesktopHost } from "@/lib/api";
import { peekGrokAlbumThumbnail } from "@/lib/grokAlbumThumbnail";
import { peekRemoteWallpaperThumbnail } from "@/lib/remoteWallpaperThumbnail";
import { isWallpaperRemoteSource } from "@/lib/wallpaperRemoteSearch";
import {
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";
import {
  EMPTY_WALLPAPER_IMAGE_PLACEHOLDER,
  ensureLocalWallpaperMedia,
} from "@/lib/wallpaperSourceMedia";
import { wallpaperSourceErrorMessage } from "@/lib/wallpaperSourcePresentation";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) => string;

type PreviewOptions = {
  interactionLocked: boolean;
  busyIds: ReadonlySet<string>;
  visibleItems: WallpaperGalleryItem[];
  sourceGenerationRef: RefObject<number>;
  viewer: ImageViewerApi;
  t: Translate;
  setItems: Dispatch<SetStateAction<WallpaperGalleryItem[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setPreviewingId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setErrorCode: Dispatch<SetStateAction<WallpaperSourceErrorCode | null>>;
  setStatusHint: Dispatch<SetStateAction<string | null>>;
};

function slideTitle(item: WallpaperGalleryItem): string | undefined {
  return (
    item.textPreview ||
    item.prompt ||
    (item.username ? `@${item.username}` : undefined)
  );
}

function decodedFilePath(url: string): string {
  return decodeURIComponent(url.replace(/^file:\/\//, ""));
}

export function useWallpaperItemPreview({
  interactionLocked,
  busyIds,
  visibleItems,
  sourceGenerationRef,
  viewer,
  t,
  setItems,
  setSelectedId,
  setPreviewingId,
  setError,
  setErrorCode,
  setStatusHint,
}: PreviewOptions) {
  return useCallback(
    async (item: WallpaperGalleryItem) => {
      if (interactionLocked || busyIds.has(item.id)) return;
      if (!isDesktopHost()) {
        setErrorCode("generic");
        setError(t("settings.wallpaperSource.err.desktopOnly"));
        return;
      }

      const sourceGeneration = sourceGenerationRef.current;
      setSelectedId(item.id);
      setPreviewingId(item.id);
      setError(null);
      setErrorCode(null);

      const lazyAlbumPreview = item.source === "grok_album";
      const lazyRemotePreview = isWallpaperRemoteSource(item.source);
      const eagerLocalPreview = !lazyAlbumPreview && !lazyRemotePreview;
      if (eagerLocalPreview) {
        setStatusHint(t("settings.wallpaperSource.loadingOriginal"));
      }

      try {
        const local = eagerLocalPreview
          ? await ensureLocalWallpaperMedia(item)
          : null;
        if (sourceGeneration !== sourceGenerationRef.current) return;

        if (local) {
          setItems((previous) =>
            previous.map((candidate) =>
              candidate.id === item.id
                ? {
                    ...candidate,
                    localPath: local.path,
                    metadata: local.metadata ?? candidate.metadata,
                    fullUrl: candidate.fullUrl.startsWith("http")
                      ? candidate.fullUrl
                      : `file://${local.path}`,
                  }
                : candidate,
            ),
          );
        }

        const viable = visibleItems.filter(
          (candidate) =>
            candidate.id === item.id ||
            !!candidate.localPath ||
            candidate.fullUrl.startsWith("http"),
        );
        const slides: ImageSlideInput[] = viable.map((candidate) => {
          const lazyAlbumOriginal =
            candidate.source === "grok_album" &&
            !candidate.localPath &&
            candidate.fullUrl.startsWith("http");
          if (lazyAlbumOriginal) {
            const thumbnail =
              peekGrokAlbumThumbnail(
                candidate.thumbUrl || candidate.fullUrl,
              ) || EMPTY_WALLPAPER_IMAGE_PLACEHOLDER;
            return {
              src: thumbnail,
              kind: "image",
              title: slideTitle(candidate),
              alt: candidate.prompt || candidate.textPreview || undefined,
              onView: () => {
                if (sourceGeneration === sourceGenerationRef.current) {
                  setSelectedId(candidate.id);
                }
              },
              originalErrorMessage: (error) =>
                wallpaperSourceErrorMessage(
                  t,
                  parseWallpaperSourceError(error),
                ),
              loadOriginal: async (signal) => {
                if (sourceGeneration !== sourceGenerationRef.current) {
                  return null;
                }
                try {
                  const loaded = await ensureLocalWallpaperMedia(candidate, {
                    signal,
                  });
                  if (sourceGeneration !== sourceGenerationRef.current) {
                    return null;
                  }
                  setItems((previous) =>
                    previous.map((current) =>
                      current.id === candidate.id
                        ? {
                            ...current,
                            localPath: loaded.path,
                            metadata: loaded.metadata ?? current.metadata,
                            fullUrl: current.fullUrl.startsWith("http")
                              ? current.fullUrl
                              : `file://${loaded.path}`,
                          }
                        : current,
                    ),
                  );
                  return {
                    src: loaded.path,
                    kind: candidate.kind === "video" ? "video" : "image",
                    mime: loaded.mime,
                    poster:
                      candidate.kind === "video" ? thumbnail : undefined,
                  };
                } catch (error) {
                  if (sourceGeneration !== sourceGenerationRef.current) {
                    return null;
                  }
                  throw error;
                }
              },
            };
          }

          const lazyRemoteOriginal =
            isWallpaperRemoteSource(candidate.source) &&
            !candidate.localPath &&
            candidate.fullUrl.startsWith("http");
          if (lazyRemoteOriginal) {
            return {
              src:
                peekRemoteWallpaperThumbnail(candidate) ||
                candidate.thumbUrl ||
                candidate.fullUrl,
              kind: "image",
              title: slideTitle(candidate),
              alt: candidate.prompt || candidate.textPreview || undefined,
              onView: () => {
                if (sourceGeneration === sourceGenerationRef.current) {
                  setSelectedId(candidate.id);
                }
              },
              originalErrorMessage: (error) =>
                wallpaperSourceErrorMessage(
                  t,
                  parseWallpaperSourceError(error),
                ),
              loadOriginal: async (signal) => {
                if (sourceGeneration !== sourceGenerationRef.current) {
                  return null;
                }
                try {
                  const loaded = await ensureLocalWallpaperMedia(candidate, {
                    signal,
                  });
                  if (sourceGeneration !== sourceGenerationRef.current) {
                    return null;
                  }
                  setItems((previous) =>
                    previous.map((current) =>
                      current.id === candidate.id
                        ? {
                            ...current,
                            localPath: loaded.path,
                            metadata: loaded.metadata ?? current.metadata,
                          }
                        : current,
                    ),
                  );
                  return {
                    src: loaded.path,
                    kind: "image" as const,
                    mime: loaded.mime,
                  };
                } catch (error) {
                  if (sourceGeneration !== sourceGenerationRef.current) {
                    return null;
                  }
                  throw error;
                }
              },
            };
          }

          const path =
            candidate.id === item.id && local
              ? local.path
              : candidate.localPath ||
                (candidate.fullUrl.startsWith("file://")
                  ? decodedFilePath(candidate.fullUrl)
                  : candidate.fullUrl);
          return {
            src: path,
            kind: candidate.kind === "video" ? "video" : "image",
            mime: candidate.id === item.id ? local?.mime : undefined,
            title: slideTitle(candidate),
            alt: candidate.prompt || candidate.textPreview || undefined,
            onView: () => {
              if (sourceGeneration === sourceGenerationRef.current) {
                setSelectedId(candidate.id);
              }
            },
          };
        });
        const index = Math.max(
          0,
          viable.findIndex((candidate) => candidate.id === item.id),
        );
        viewer.open(slides, index);
      } catch (error) {
        if (sourceGeneration !== sourceGenerationRef.current) return;
        const code = parseWallpaperSourceError(error);
        setErrorCode(code);
        setError(wallpaperSourceErrorMessage(t, code));
      } finally {
        if (sourceGeneration === sourceGenerationRef.current) {
          setPreviewingId(null);
          setStatusHint(null);
        }
      }
    },
    [
      busyIds,
      interactionLocked,
      setError,
      setErrorCode,
      setItems,
      setPreviewingId,
      setSelectedId,
      setStatusHint,
      sourceGenerationRef,
      t,
      viewer,
      visibleItems,
    ],
  );
}
