import { useEffect, useRef, useState, type ReactNode } from "react";
import { wallpaperLibraryFindById } from "@/lib/api/wallpaper";
import { trapTabKey } from "@/lib/a11yFocus";
import { formatWorkDuration } from "@/lib/formatWorkDuration";
import { intlLocale, resolveLocaleFromSystem, type MessageKey } from "@/i18n";
import {
  libraryEntryToGalleryItem,
  type WallpaperGalleryItem,
} from "@/lib/wallpaperSource";
import { GlassModal } from "./GlassModal";
import { useImageViewerOptional } from "./ImageViewerContext";

type Props = {
  item: WallpaperGalleryItem | null;
  t: (
    key: MessageKey,
    vars?: Record<string, string | number | undefined | null>,
  ) => string;
  locked: boolean;
  onClose: () => void;
  onOpenSource: (url: string) => void;
  onReusePrompt?: (item: WallpaperGalleryItem) => void;
};

const sourceLabels: Record<string, MessageKey> = {
  x: "settings.wallpaperFromX",
  web: "settings.wallpaperWeb",
  openverse: "settings.wallpaperOpenverse",
  pexels: "settings.wallpaperPexels",
  imagine: "settings.wallpaperImagine",
  grok_album: "settings.wallpaperGrokAlbum",
  library: "settings.wallpaperLibrary",
};

export function WallpaperMediaDetails(props: Props) {
  return props.item ? (
    <MediaDetailsContent {...props} item={props.item} key={props.item.id} />
  ) : null;
}

function MediaDetailsContent({
  item: resultItem,
  t,
  locked,
  onClose,
  onOpenSource,
  onReusePrompt,
}: Props & { item: WallpaperGalleryItem }) {
  const [parents, setParents] = useState<WallpaperGalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const request = useRef(0);
  const pending = useRef(false);
  const ownsPreview = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const viewer = useImageViewerOptional();
  const item = parents[parents.length - 1] ?? resultItem;
  const locale = resolveLocaleFromSystem(
    document.documentElement.lang || navigator.language,
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (viewer.isOpen()) {
          viewer.close();
          ownsPreview.current = false;
        } else {
          closeRef.current();
        }
      } else if (event.key === "Tab" && !viewer.isOpen()) {
        trapTabKey(event, contentRef.current?.closest('[role="dialog"]'));
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      request.current += 1;
      if (ownsPreview.current) viewer.close();
      document.removeEventListener("keydown", onKey, true);
    };
  }, [viewer]);

  const openParent = async () => {
    const id = item.metadata?.parentId;
    if (!id || locked || pending.current) return;
    const revision = ++request.current;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      const entry = await wallpaperLibraryFindById(id);
      if (revision !== request.current) return;
      if (
        !entry ||
        entry.metadata?.id !== id ||
        id === resultItem.metadata?.id ||
        parents.some((parent) => parent.metadata?.id === id)
      ) {
        setError("settings.wallpaperSource.details.parentMissing");
        return;
      }
      setParents((previous) => [
        ...previous,
        libraryEntryToGalleryItem(entry),
      ]);
    } catch {
      if (revision === request.current) {
        setError("settings.wallpaperSource.details.parentFailed");
      }
    } finally {
      if (revision === request.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  };

  const metadata = item.metadata;
  const unknown = t("settings.wallpaperSource.details.unknown");
  const width = metadata?.width ?? item.width;
  const height = metadata?.height ?? item.height;
  const dimensions =
    Number(width) > 0 && Number(height) > 0
      ? `${width} × ${height}`
      : unknown;
  const durationMs = metadata?.durationMs;
  const mediaDuration =
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
      ? durationMs < 60_000
        ? t("chat.duration.seconds", {
            n: new Intl.NumberFormat(intlLocale(locale), {
              maximumFractionDigits: 1,
            }).format(durationMs / 1_000),
          })
        : formatWorkDuration(Math.round(durationMs / 1_000), locale)
      : unknown;
  const prompt = metadata?.prompt || item.prompt;
  const generation = metadata?.generation;
  const row = (key: MessageKey, value: ReactNode) => (
    <div className="wallpaper-details__row" key={key}>
      <dt>{t(key)}</dt>
      <dd>{value || unknown}</dd>
    </div>
  );
  const link = (
    label: string | null | undefined,
    raw: string | null | undefined,
  ) => {
    let url: URL;
    try {
      url = new URL(raw || "");
    } catch {
      return label || unknown;
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      return label || unknown;
    }
    url.search = "";
    url.hash = "";
    return (
      <button
        type="button"
        className="wallpaper-attribution__link"
        disabled={locked}
        onClick={() => onOpenSource(url.href)}
      >
        {label || url.hostname}
      </button>
    );
  };
  const source = metadata?.source || item.source;
  const bytes = metadata?.bytes;
  const fileSize =
    bytes != null && Number.isFinite(bytes) && bytes >= 0
      ? new Intl.NumberFormat(intlLocale(locale), {
          style: "unit",
          unit:
            bytes >= 1_000_000
              ? "megabyte"
              : bytes >= 1_000
                ? "kilobyte"
                : "byte",
          unitDisplay: "short",
          maximumFractionDigits: 1,
        }).format(
          bytes /
            (bytes >= 1_000_000 ? 1_000_000 : bytes >= 1_000 ? 1_000 : 1),
        )
      : unknown;

  return (
    <GlassModal
      open
      onClose={onClose}
      title={t("settings.wallpaperSource.details.title")}
      closeLabel={t("image.close")}
      size="lg"
      wrapBody
      className="wallpaper-details"
      footer={
        <>
          {parents.length > 0 ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={loading}
              onClick={() => {
                setParents([]);
                setError(null);
              }}
            >
              {t("settings.wallpaperSource.details.back")}
            </button>
          ) : null}
          {item.metadata?.parentId ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={locked || loading}
              aria-busy={loading}
              onClick={() => void openParent()}
            >
              {t(
                loading
                  ? "media.loading"
                  : "settings.wallpaperSource.details.parent",
              )}
            </button>
          ) : null}
          {parents.length > 0 && item.localPath ? (
            <button
              className="btn btn--ghost"
              type="button"
              disabled={locked || loading}
              onClick={() => {
                ownsPreview.current = true;
                viewer.open([
                  {
                    src: item.localPath!,
                    kind: item.kind === "video" ? "video" : "image",
                    title: item.textPreview || undefined,
                  },
                ]);
              }}
            >
              {t("settings.wallpaperSource.openPreview")}
            </button>
          ) : null}
          {prompt?.trim() && onReusePrompt ? (
            <button
              className="btn btn--primary"
              type="button"
              disabled={locked || loading}
              onClick={() => onReusePrompt(item)}
            >
              {t("settings.wallpaperSource.details.reuse")}
            </button>
          ) : null}
        </>
      }
    >
      <div ref={contentRef}>
        {error ? (
          <p role="alert" className="wallpaper-details__error">
            {t(error)}
          </p>
        ) : null}
        <p className="wallpaper-details__title">
          {metadata?.title || item.textPreview || unknown}
        </p>
        <dl className="wallpaper-details__fields">
          {row("settings.wallpaperSource.details.dimensions", dimensions)}
          {item.kind === "video"
            ? row(
                "settings.wallpaperSource.details.mediaDuration",
                mediaDuration,
              )
            : null}
          {row("settings.wallpaperSource.details.bytes", fileSize)}
          {row(
            "settings.wallpaperSource.details.source",
            link(
              metadata?.sourceName ||
                item.sourceName ||
                (sourceLabels[source] ? t(sourceLabels[source]) : unknown),
              metadata?.sourceUrl || item.sourceUrl || item.postUrl,
            ),
          )}
          {row(
            "settings.wallpaperSource.details.author",
            link(
              metadata?.authorName || item.authorName || item.username,
              metadata?.authorUrl || item.authorUrl,
            ),
          )}
          {row(
            "settings.wallpaperSource.details.license",
            link(
              metadata?.license || item.license,
              metadata?.licenseUrl || item.licenseUrl,
            ),
          )}
          {generation ? (
            <>
              {row(
                "settings.wallpaperSource.details.operation",
                generation.operation === "image_gen"
                  ? t("settings.wallpaperImagine")
                  : generation.operation === "image_edit"
                    ? t("settings.wallpaperSource.editImage")
                    : generation.operation === "image_to_video"
                      ? t("settings.wallpaperSource.generateVideoFromImage")
                      : unknown,
              )}
              {row(
                "settings.wallpaperSource.details.ratio",
                generation.aspectRatio,
              )}
              {row(
                "settings.wallpaperSource.details.resolution",
                generation.resolution,
              )}
              {row(
                "settings.wallpaperSource.details.duration",
                generation.duration
                  ? formatWorkDuration(generation.duration, locale)
                  : unknown,
              )}
              {row(
                "settings.wallpaperSource.details.model",
                generation.requestedModel,
              )}
            </>
          ) : null}
          {row("settings.wallpaperSource.details.path", item.localPath)}
        </dl>
        <div className="wallpaper-details__prompt">
          <h3>{t("settings.wallpaperSource.details.prompt")}</h3>
          <p>{prompt || unknown}</p>
        </div>
      </div>
    </GlassModal>
  );
}
