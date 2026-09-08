import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  dedupeGalleryItems,
  errorCodeFromSearchResult,
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";
import {
  buildWallpaperVideoPrompt,
  type WallpaperImagineMode,
  type WallpaperImagineControlsModel,
  type WallpaperVideoDuration,
  type WallpaperVideoResolution,
  type WallpaperVideoSourceStatus,
} from "@/lib/wallpaperImagine";
import { createWallpaperRequestId } from "@/lib/wallpaperRequest";
import { peekGrokAlbumThumbnail } from "@/lib/grokAlbumThumbnail";
import { peekRemoteWallpaperThumbnail } from "@/lib/remoteWallpaperThumbnail";
import {
  cancelGrokAlbumMediaRequests,
  cancelRemoteWallpaperMediaRequests,
  ensureLocalWallpaperMedia,
} from "@/lib/wallpaperSourceMedia";
import { isWallpaperRemoteSource } from "@/lib/wallpaperRemoteSearch";
import {
  WALLPAPER_ASPECT_OPTIONS,
  wallpaperSourceErrorMessage,
} from "@/lib/wallpaperSourcePresentation";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) => string;

type ControllerOptions = {
  onGenerated?: () => void;
  open: boolean;
  enabled: boolean;
  t: Translate;
  setItems: Dispatch<SetStateAction<WallpaperGalleryItem[]>>;
  setHasSearched: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setErrorCode: Dispatch<SetStateAction<WallpaperSourceErrorCode | null>>;
  setStatusHint: Dispatch<SetStateAction<string | null>>;
  setGalleryFilter: Dispatch<SetStateAction<string>>;
  setKindFilter: Dispatch<SetStateAction<"all" | "image" | "video">>;
};

export function useWallpaperImagineController({
  onGenerated,
  open,
  enabled,
  t,
  setItems,
  setHasSearched,
  setSelectedId,
  setError,
  setErrorCode,
  setStatusHint,
  setGalleryFilter,
  setKindFilter,
}: ControllerOptions) {
  const [mode, setModeState] = useState<WallpaperImagineMode>("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadGenerationRef = useRef(0);
  const [aspect, setAspect] = useState("16:9");
  const [videoDuration, setVideoDuration] =
    useState<WallpaperVideoDuration>(6);
  const [videoResolution, setVideoResolution] =
    useState<WallpaperVideoResolution>("480p");
  const [videoSource, setVideoSource] =
    useState<WallpaperGalleryItem | null>(null);
  const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
  const [videoSourcePreview, setVideoSourcePreview] =
    useState<string | null>(null);
  const [videoSourceStatus, setVideoSourceStatus] =
    useState<WallpaperVideoSourceStatus>("idle");
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const preparationGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const activeVideoRequestRef = useRef<string | null>(null);
  const cancelledVideoRequestsRef = useRef(new Set<string>());
  const videoSourceRef = useRef<WallpaperGalleryItem | null>(videoSource);
  videoSourceRef.current = videoSource;
  const prompt = mode === "video" ? videoPrompt : mode === "edit" ? editPrompt : imagePrompt;
  const setPrompt = useCallback(
    (value: string) => {
      if (mode === "video") setVideoPrompt(value);
      else if (mode === "edit") setEditPrompt(value);
      else setImagePrompt(value);
    },
    [mode],
  );

  const cancelSourcePreparation = useCallback(
    (source: WallpaperGalleryItem | null) => {
      preparationGenerationRef.current += 1;
      if (source?.source === "grok_album") {
        cancelGrokAlbumMediaRequests();
      } else if (source && isWallpaperRemoteSource(source.source)) {
        void cancelRemoteWallpaperMediaRequests();
      }
    },
    [],
  );

  const cancelGeneration = useCallback(async () => {
    const requestId = activeVideoRequestRef.current;
    if (!requestId || cancelling) return;
    const generation = operationGenerationRef.current;
    cancelledVideoRequestsRef.current.add(requestId);
    setCancelling(true);
    try {
      await api.wallpaperImageToVideoCancel(requestId);
    } catch (error) {
      cancelledVideoRequestsRef.current.delete(requestId);
      if (
        generation !== operationGenerationRef.current ||
        activeVideoRequestRef.current !== requestId
      ) {
        return;
      }
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(wallpaperSourceErrorMessage(t, code));
      setCancelling(false);
    }
  }, [cancelling, setError, setErrorCode, t]);

  const cancelInFlight = useCallback(() => {
    uploadGenerationRef.current += 1;
    operationGenerationRef.current += 1;
    cancelSourcePreparation(videoSourceRef.current);
    const requestId = activeVideoRequestRef.current;
    activeVideoRequestRef.current = null;
    if (requestId) {
      cancelledVideoRequestsRef.current.add(requestId);
      void api.wallpaperImageToVideoCancel(requestId).catch(() => false);
    }
  }, [cancelSourcePreparation]);

  const cancelAll = useCallback(() => {
    cancelInFlight();
    setGenerating(false);
    setCancelling(false);
    setUploading(false);
    setVideoSourceStatus(videoSourcePath ? "ready" : "idle");
    setStatusHint(null);
  }, [cancelInFlight, setStatusHint, videoSourcePath]);

  useEffect(
    () => () => {
      // Do not enqueue React state updates during unmount. Generation tokens
      // reject late completions while Host-side work is cancelled best-effort.
      cancelInFlight();
    },
    [cancelInFlight],
  );

  useEffect(() => {
    if (open) return;
    cancelAll();
    setModeState("image");
    setImagePrompt("");
    setVideoPrompt("");
    setEditPrompt("");
    setAspect("16:9");
    setVideoDuration(6);
    setVideoResolution("480p");
    setVideoSource(null);
    setVideoSourcePath(null);
    setVideoSourcePreview(null);
    setVideoSourceStatus("idle");
  }, [cancelAll, open]);

  useEffect(() => {
    if (
      !enabled ||
      mode === "image" ||
      !videoSource ||
      videoSourcePath
    ) {
      return;
    }

    const generation = ++preparationGenerationRef.current;
    let active = true;
    let settled = false;
    setVideoSourceStatus("preparing");
    setStatusHint(t("settings.wallpaperSource.videoSourcePreparing"));
    void ensureLocalWallpaperMedia(videoSource)
      .then((local) => {
        if (!active || generation !== preparationGenerationRef.current) return;
        if (local.mime && !local.mime.startsWith("image/")) {
          throw new Error("imagine_source_invalid");
        }
        settled = true;
        setVideoSourcePath(local.path);
        setVideoSourceStatus("ready");
        setError(null);
        setErrorCode(null);
        setStatusHint(null);
      })
      .catch((error) => {
        if (!active || generation !== preparationGenerationRef.current) return;
        settled = true;
        const code = parseWallpaperSourceError(error);
        const sourceCode: WallpaperSourceErrorCode =
          code === "generic" ? "imagine_source_invalid" : code;
        setVideoSourceStatus("error");
        setErrorCode(sourceCode);
        setError(wallpaperSourceErrorMessage(t, sourceCode));
        setStatusHint(null);
      });

    return () => {
      active = false;
      if (generation === preparationGenerationRef.current && !settled) {
        cancelSourcePreparation(videoSource);
        setStatusHint(null);
      }
    };
  }, [
    cancelSourcePreparation,
    enabled,
    mode,
    setError,
    setErrorCode,
    setStatusHint,
    t,
    videoSource,
    videoSourcePath,
  ]);

  const setMode = useCallback(
    (next: WallpaperImagineMode) => {
      uploadGenerationRef.current += 1;
      setUploading(false);
      if (next === "image" && mode !== "image") {
        cancelSourcePreparation(videoSource);
        setVideoSourceStatus(videoSourcePath ? "ready" : "idle");
      }
      setModeState(next);
      setError(null);
      setErrorCode(null);
      setStatusHint(null);
    },
    [
      cancelSourcePreparation,
      mode,
      setError,
      setErrorCode,
      setStatusHint,
      videoSource,
      videoSourcePath,
    ],
  );

  const beginVideoFromItem = useCallback(
    (item: WallpaperGalleryItem, targetMode: "video" | "edit" = "video") => {
      uploadGenerationRef.current += 1;
      setUploading(false);
      cancelSourcePreparation(videoSource);
      setModeState(targetMode);
      if (targetMode === "video") setVideoPrompt(buildWallpaperVideoPrompt(t, item));
      else setEditPrompt("");
      setVideoSource(item);
      setVideoSourcePath(item.localPath?.trim() || null);
      setVideoSourcePreview(
        item.source === "grok_album"
          ? peekGrokAlbumThumbnail(item.thumbUrl || item.fullUrl)
          : isWallpaperRemoteSource(item.source)
            ? peekRemoteWallpaperThumbnail(item)
            : null,
      );
      setVideoSourceStatus(item.localPath?.trim() ? "ready" : "idle");
      setError(null);
      setErrorCode(null);
      setStatusHint(null);
    },
    [
      cancelSourcePreparation,
      setError,
      setErrorCode,
      setStatusHint,
      t,
      videoSource,
    ],
  );

  const clearVideoSource = useCallback(() => {
    uploadGenerationRef.current += 1;
    setUploading(false);
    cancelSourcePreparation(videoSource);
    setVideoSource(null);
    setVideoSourcePath(null);
    setVideoSourcePreview(null);
    setVideoSourceStatus("idle");
    setVideoPrompt("");
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
  }, [cancelSourcePreparation, setError, setErrorCode, setStatusHint, videoSource]);

  const beginEditFromItem = useCallback(
    (item: WallpaperGalleryItem) => beginVideoFromItem(item, "edit"),
    [beginVideoFromItem],
  );

  const uploadSource = useCallback(async () => {
    if (generating || uploading || mode === "image") return;
    if (!api.isDesktopHost()) {
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    const generation = ++uploadGenerationRef.current;
    setUploading(true);
    try {
      const paths = await api.pickAttachFiles();
      if (generation !== uploadGenerationRef.current || !paths.length) return;
      if (paths.length !== 1) throw new Error("imagine_source_invalid");
      const local = await api.wallpaperImportImage(paths[0]);
      if (generation !== uploadGenerationRef.current) return;
      beginVideoFromItem({
        id: `upload-${local.path}`, source: "library", kind: "image",
        localPath: local.path, fullUrl: `file://${local.path}`, thumbUrl: "",
        textPreview: paths[0].split(/[\\/]/).pop() || local.name,
      }, mode);
    } catch (error) {
      if (generation !== uploadGenerationRef.current) return;
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(wallpaperSourceErrorMessage(t, code));
    } finally {
      if (generation === uploadGenerationRef.current) setUploading(false);
    }
  }, [beginVideoFromItem, generating, mode, setError, setErrorCode, t, uploading]);

  const generate = useCallback(async () => {
    if (generating || cancelling || uploading) return;
    const trimmedPrompt = prompt.trim();
    if (mode !== "video" && !trimmedPrompt) {
      setErrorCode("empty");
      setError(wallpaperSourceErrorMessage(t, "empty"));
      return;
    }
    if (
      mode !== "image" &&
      (!videoSourcePath || videoSourceStatus !== "ready")
    ) {
      setErrorCode("imagine_source_invalid");
      setError(wallpaperSourceErrorMessage(t, "imagine_source_invalid"));
      return;
    }
    if (!api.isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }

    const generation = ++operationGenerationRef.current;
    const requestId = createWallpaperRequestId();
    if (requestId) activeVideoRequestRef.current = requestId;
    setGenerating(true);
    setCancelling(false);
    setError(null);
    setErrorCode(null);
    setStatusHint(
      t(
        mode === "video"
          ? "settings.wallpaperSource.generatingVideo"
          : "settings.wallpaperSource.generating",
      ),
    );
    setSelectedId(null);
    setGalleryFilter("");
    setKindFilter("all");

    try {
      const result =
        mode === "video"
          ? await api.wallpaperImageToVideo(
              videoSourcePath!,
              trimmedPrompt,
              videoDuration,
              videoResolution,
              requestId!,
            )
          : mode === "edit"
            ? await api.wallpaperImageEdit(videoSourcePath!, trimmedPrompt, aspect, requestId!)
            : await api.wallpaperImagine(trimmedPrompt, aspect, requestId);
      if (generation !== operationGenerationRef.current) return;
      if (
        requestId &&
        (cancelledVideoRequestsRef.current.has(requestId) ||
          result.errorCode === "cancelled")
      ) {
        setError(null);
        setErrorCode(null);
        return;
      }

      const list = dedupeGalleryItems(result.items || []);
      const code = errorCodeFromSearchResult({ ...result, items: list });
      setHasSearched(true);
      if (code) {
        setErrorCode(code);
        setError(wallpaperSourceErrorMessage(t, code));
        return;
      }
      setItems(list);
      onGenerated?.();
      setError(null);
      setErrorCode(null);
      if (list[0]) setSelectedId(list[0].id);
    } catch (error) {
      if (generation !== operationGenerationRef.current) return;
      if (requestId && cancelledVideoRequestsRef.current.has(requestId)) {
        setError(null);
        setErrorCode(null);
        return;
      }
      setHasSearched(true);
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(wallpaperSourceErrorMessage(t, code));
    } finally {
      if (requestId) {
        cancelledVideoRequestsRef.current.delete(requestId);
        if (activeVideoRequestRef.current === requestId) {
          activeVideoRequestRef.current = null;
        }
      }
      if (generation === operationGenerationRef.current) {
        setGenerating(false);
        setCancelling(false);
        setStatusHint(null);
      }
    }
  }, [
    aspect,
    onGenerated,
    cancelling,
    generating,
    mode,
    prompt,
    setError,
    setErrorCode,
    setGalleryFilter,
    setHasSearched,
    setItems,
    setKindFilter,
    setSelectedId,
    setStatusHint,
    t,
    videoDuration,
    videoResolution,
    videoSourcePath,
    videoSourceStatus,
    uploading,
  ]);

  const controls = useMemo<WallpaperImagineControlsModel>(
    () => ({
      mode,
      prompt,
      aspect,
      aspectOptions: WALLPAPER_ASPECT_OPTIONS,
      videoDuration,
      videoResolution,
      videoSource,
      videoSourcePath,
      videoSourcePreview,
      videoSourceStatus,
      generating,
      cancelling,
      onModeChange: setMode,
      onPromptChange: setPrompt,
      onAspectChange: setAspect,
      onVideoDurationChange: setVideoDuration,
      onVideoResolutionChange: setVideoResolution,
      onClearVideoSource: clearVideoSource,
      onUploadSource: uploadSource,
      onGenerate: generate,
      onCancelGeneration: cancelGeneration,
    }),
    [
      aspect,
      cancelGeneration,
      cancelling,
      clearVideoSource,
      generate,
      generating,
      mode,
      prompt,
      setMode,
      videoDuration,
      videoResolution,
      videoSource,
      videoSourcePath,
      videoSourcePreview,
      videoSourceStatus,
      uploadSource,
    ],
  );

  const reuseImagePrompt = useCallback((item: WallpaperGalleryItem) => {
    const savedPrompt = item.metadata?.prompt || item.prompt;
    if (!savedPrompt?.trim() || generating || uploading || cancelling) return;
    setMode("image");
    // Set the image draft directly: setPrompt still closes over the old mode
    // during this event, which could otherwise overwrite the edit/video draft.
    setImagePrompt(savedPrompt);
    const ratio = item.metadata?.generation?.aspectRatio;
    setAspect(WALLPAPER_ASPECT_OPTIONS.some((option) => option.value === ratio) ? ratio! : "auto");
  }, [generating, uploading, cancelling, setMode]);

  return {
    mode,
    prompt,
    aspect,
    videoDuration,
    videoResolution,
    videoSource,
    videoSourcePath,
    videoSourcePreview,
    videoSourceStatus,
    generating,
    cancelling,
    busy:
      generating ||
      uploading ||
      (enabled && mode !== "image" && videoSourceStatus === "preparing"),
    setMode,
    setPrompt,
    setAspect,
    setVideoDuration,
    setVideoResolution,
    beginVideoFromItem,
    beginEditFromItem,
    reuseImagePrompt,
    clearVideoSource,
    generate,
    cancelGeneration,
    cancelAll,
    controls,
  };
}
