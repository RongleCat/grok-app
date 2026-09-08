import {
  IconClose,
  IconEdit,
  IconUpload,
  IconImagine,
  IconPlay,
  IconVideo,
} from "@/components/icons";
import { Select } from "@/components/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MessageKey } from "@/i18n";
import { resolveImageSrcSync } from "@/lib/imageSrc";
import {
  WALLPAPER_VIDEO_DURATIONS,
  WALLPAPER_VIDEO_RESOLUTIONS,
  type WallpaperImagineControlsModel,
} from "@/lib/wallpaperImagine";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number | undefined | null>,
) => string;

export type { WallpaperImagineControlsModel } from "@/lib/wallpaperImagine";

function localPreview(item: WallpaperGalleryItem): string | null {
  if (item.localPath) return resolveImageSrcSync(item.localPath);
  if (!item.fullUrl.startsWith("file://")) return null;
  try {
    return resolveImageSrcSync(
      decodeURIComponent(item.fullUrl.replace(/^file:\/\//, "")),
    );
  } catch {
    return null;
  }
}

function sourceTitle(item: WallpaperGalleryItem): string | null {
  return (
    item.textPreview ||
    item.prompt ||
    item.sourceName ||
    (item.username ? `@${item.username}` : null)
  );
}

export function WallpaperImagineControls({
  t,
  locked,
  model,
}: {
  t: Translate;
  locked: boolean;
  model: WallpaperImagineControlsModel;
}) {
  const {
    mode,
    prompt,
    aspect,
    aspectOptions,
    videoDuration,
    videoResolution,
    videoSource,
    videoSourcePath,
    videoSourcePreview,
    videoSourceStatus,
    generating,
    cancelling,
    onModeChange,
    onPromptChange,
    onAspectChange,
    onVideoDurationChange,
    onVideoResolutionChange,
    onClearVideoSource,
    onUploadSource,
    onGenerate,
    onCancelGeneration,
  } = model;
  const preparingSource = videoSourceStatus === "preparing";
  const hardLocked = locked && !preparingSource && !generating;
  const sourceReady = videoSourceStatus === "ready" && !!videoSourcePath;
  const cancellableGeneration = generating;
  const generateDisabled =
    hardLocked ||
    (mode === "image" ? !prompt.trim() : !sourceReady) ||
    (mode === "edit" && !prompt.trim()) ||
    cancelling;
  const previewSrc = videoSource
    ? videoSourcePreview ||
      (videoSourcePath ? resolveImageSrcSync(videoSourcePath) : null) ||
      localPreview(videoSource)
    : null;
  const durationOptions = WALLPAPER_VIDEO_DURATIONS.map((seconds) => ({
    value: String(seconds),
    label: t("settings.wallpaperSource.videoDurationSeconds", { seconds }),
  }));
  const resolutionOptions = WALLPAPER_VIDEO_RESOLUTIONS.map((value) => ({
    value,
    label: value,
  }));
  const localizedAspectOptions = aspectOptions.map((option) =>
    option.value === "auto"
      ? { ...option, label: t("policy.auto") }
      : option,
  );

  return (
    <div className="wallpaper-source-form wallpaper-imagine-form">
      <SegmentedControl
        value={mode}
        ariaLabel={t("settings.wallpaperSource.imagineMode")}
        className="wallpaper-imagine-form__mode"
        disabled={generating || cancelling || hardLocked}
        options={[
          {
            value: "image",
            label: (
              <>
                <IconImagine size={14} />
                <span>{t("settings.wallpaperSource.kind.image")}</span>
              </>
            ),
          },
          {
            value: "edit",
            label: (
              <>
                <IconEdit size={14} />
                <span>{t("settings.wallpaperSource.editImage")}</span>
              </>
            ),
          },
          {
            value: "video",
            label: (
              <>
                <IconVideo size={14} />
                <span>{t("settings.wallpaperSource.kind.video")}</span>
              </>
            ),
          },
        ]}
        onChange={(value) => onModeChange(value)}
      />

      {mode !== "image" ? (
        <div
          className="wallpaper-imagine-source"
          data-state={videoSourceStatus}
          aria-live="polite"
        >
          <span className="wallpaper-imagine-source__thumb" aria-hidden>
            {previewSrc ? (
              <img src={previewSrc} alt="" referrerPolicy="no-referrer" />
            ) : (
              <IconImagine size={18} />
            )}
          </span>
          <span className="wallpaper-imagine-source__copy">
            <span className="wallpaper-imagine-source__label">
              {t("settings.wallpaperSource.sourceImage")}
            </span>
            <span className="wallpaper-imagine-source__value">
              {preparingSource
                ? t("settings.wallpaperSource.videoSourcePreparing")
                : videoSource
                  ? sourceTitle(videoSource) ||
                    t("settings.wallpaperSource.videoSourceReady")
                  : t("settings.wallpaperSource.videoSourceMissing")}
            </span>
          </span>
          <button
            type="button"
            className="wallpaper-imagine-source__clear"
            disabled={generating || cancelling || hardLocked}
            onClick={onUploadSource}
            aria-label={t("settings.wallpaperSource.uploadImage")}
            title={t("settings.wallpaperSource.uploadImage")}
          >
            <IconUpload size={16} />
          </button>
          {videoSource ? (
            <button
              type="button"
              className="wallpaper-imagine-source__clear"
              disabled={generating || cancelling}
              onClick={onClearVideoSource}
              aria-label={t("settings.wallpaperSource.removeSourceImage")}
              title={t("settings.wallpaperSource.removeSourceImage")}
            >
              <IconClose size={15} />
            </button>
          ) : null}
        </div>
      ) : null}

      <textarea
        className="wallpaper-source-form__textarea"
        value={prompt}
        aria-label={t(
          mode === "video"
            ? "settings.wallpaperSource.videoPromptPlaceholder"
            : mode === "edit" ? "settings.wallpaperSource.editPlaceholder"
            : "settings.wallpaperSource.imaginePlaceholder",
        )}
        placeholder={t(
          mode === "video"
            ? "settings.wallpaperSource.videoPromptPlaceholder"
            : mode === "edit" ? "settings.wallpaperSource.editPlaceholder"
            : "settings.wallpaperSource.imaginePlaceholder",
        )}
        disabled={generating || cancelling || hardLocked}
        rows={2}
        onChange={(event) => onPromptChange(event.target.value)}
      />
      <div className="wallpaper-source-form__row wallpaper-imagine-form__options">
        {mode !== "video" ? (
          <Select
            className="wallpaper-source-form__select"
            value={aspect}
            options={localizedAspectOptions}
            disabled={generating || cancelling || hardLocked}
            aria-label={t("settings.wallpaperSource.aspect")}
            onChange={onAspectChange}
            placement="down"
          />
        ) : mode === "video" ? (
          <>
            <Select
              className="wallpaper-source-form__select"
              value={String(videoDuration)}
              options={durationOptions}
              disabled={generating || cancelling || hardLocked}
              aria-label={t("settings.wallpaperSource.videoDuration")}
              onChange={(value) =>
                onVideoDurationChange(value === "10" ? 10 : 6)
              }
              placement="down"
            />
            <Select
              className="wallpaper-source-form__select"
              value={videoResolution}
              options={resolutionOptions}
              disabled={generating || cancelling || hardLocked}
              aria-label={t("settings.wallpaperSource.videoResolution")}
              onChange={(value) =>
                onVideoResolutionChange(value === "720p" ? "720p" : "480p")
              }
              placement="down"
            />
          </>
        ) : null}
        <button
          type="button"
          className={cancellableGeneration ? "btn btn--ghost" : "btn btn--solid"}
          disabled={generating ? cancelling : generateDisabled}
          aria-busy={generating}
          onClick={cancellableGeneration ? onCancelGeneration : onGenerate}
        >
          {generating ? (
            cancelling ? (
              t("settings.wallpaperSource.cancellingVideo")
            ) : (
              t("common.cancel")
            )
          ) : mode === "video" ? (
            <>
              <IconPlay size={15} />
              <span>{t("settings.wallpaperSource.generateVideo")}</span>
            </>
          ) : mode === "edit" ? (
            <><IconEdit size={15} /><span>{t("settings.wallpaperSource.editImage")}</span></>
          ) : (
            t("settings.wallpaperSource.generate")
          )}
        </button>
      </div>
    </div>
  );
}
