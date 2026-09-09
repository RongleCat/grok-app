import {
  useEffect,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import type { MessageKey } from "@/i18n";
import type { WallpaperSourceModalProps, WallpaperSourceTab } from "./WallpaperSourceModal";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import type { WallpaperGalleryEmptyPresentation } from "@/lib/wallpaperGalleryPro";
import { resolveWallpaperXCitation } from "@/lib/xEvidenceCitation";
import { ensureMediaEndpoint, resolveImageSrcSync } from "@/lib/imageSrc";
import { WallpaperProviderThumbnail } from "./WallpaperProviderThumbnail";
import { GrokAlbumThumbnail } from "./GrokAlbumThumbnail";
import { WallpaperMediaDetails } from "./WallpaperMediaDetails";
import { WallpaperSourceAttribution } from "./WallpaperSourceAttribution";
import { IconEdit, IconHeart, IconInfo, IconPlay } from "./icons";
import { isWallpaperImageItem } from "@/lib/wallpaperImagine";

type Props = {
  t: WallpaperSourceModalProps["t"];
  tab: WallpaperSourceTab;
  busy: boolean;
  locked: boolean;
  visibleItems: WallpaperGalleryItem[];
  selectedId: string | null;
  previewingId: string | null;
  showEmptyBlock: boolean;
  emptyState: WallpaperGalleryEmptyPresentation | null;
  clearGalleryFilters: () => void;
  openItemPreview: (item: WallpaperGalleryItem) => Promise<void>;
  dropItem: (id: string) => void;
  openExternalSource: (url: string) => void;
  requestDeleteLibraryItem: (item: WallpaperGalleryItem, event: MouseEvent) => void;
  favoriteBusyIds?: ReadonlySet<string>;
  onToggleFavorite?: (item: WallpaperGalleryItem) => void;
  onReusePrompt?: (item: WallpaperGalleryItem) => void;
  onGenerateVideo: (item: WallpaperGalleryItem) => void;
  onEditImage: (item: WallpaperGalleryItem) => void;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
};

/** Thumb / list preview (remote thumb OK). */
function itemThumbSrc(item: WallpaperGalleryItem): string {
  if (item.localPath) {
    return (
      resolveImageSrcSync(item.localPath) ||
      item.thumbUrl ||
      item.fullUrl
    );
  }
  if (item.fullUrl.startsWith("file://")) {
    const p = decodeURIComponent(item.fullUrl.replace(/^file:\/\//, ""));
    return resolveImageSrcSync(p) || item.thumbUrl || item.fullUrl;
  }
  return item.thumbUrl || item.fullUrl;
}

function itemActionAccessibleName(
  t: WallpaperSourceModalProps["t"],
  actionKey: MessageKey,
  item: WallpaperGalleryItem,
  index: number,
): string {
  const context =
    item.textPreview?.trim() ||
    item.prompt?.trim() ||
    item.username?.trim() ||
    item.sourceName?.trim() ||
    item.id.trim() ||
    String(index + 1);
  return `${t(actionKey)}: ${context}`;
}

function sourceLabelKey(item: WallpaperGalleryItem): MessageKey {
  if (item.source === "imagine") return "settings.wallpaperImagine";
  if (item.source === "grok_album") return "settings.wallpaperGrokAlbum";
  if (item.source === "x") return "settings.wallpaperFromX";
  if (item.source === "web") return "settings.wallpaperWeb";
  if (item.source === "openverse") return "settings.wallpaperOpenverse";
  if (item.source === "pexels") return "settings.wallpaperPexels";
  return "settings.wallpaperLibrary";
}

export function WallpaperSourceGallery({
  t,
  tab,
  busy,
  locked,
  visibleItems,
  selectedId,
  previewingId,
  showEmptyBlock,
  emptyState,
  clearGalleryFilters,
  openItemPreview,
  dropItem,
  openExternalSource,
  requestDeleteLibraryItem,
  favoriteBusyIds,
  onToggleFavorite,
  onReusePrompt,
  onGenerateVideo,
  onEditImage,
  canLoadMore,
  loadingMore,
  onLoadMore,
  scrollRef,
}: Props) {
  const isImagineLayout = tab === "imagine";
  const isLibraryTab = tab === "library";
  const stableAppendLayout = !isImagineLayout;
  const [, refreshMediaSources] = useState(0);
  const [details, setDetails] = useState<{ tab: string; id: string } | null>(
    null,
  );
  const detailsItem =
    details?.tab === tab
      ? visibleItems.find((item) => item.id === details.id) ?? null
      : null;

  useEffect(() => {
    setDetails((current) =>
      current?.tab === tab &&
      visibleItems.some((item) => item.id === current.id)
        ? current
        : null,
    );
  }, [tab, visibleItems]);

  useEffect(() => {
    let mounted = true;
    void ensureMediaEndpoint()
      .then(() => {
        if (mounted) refreshMediaSources((value) => value + 1);
      })
      .catch(() => {
        // Keep the existing source fallback; endpoint boot may be retried by
        // the normal media resolver on the next user action.
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      {/*
        Scroll shell must wrap multi-column masonry. Putting overflow-y +
        max-height on the column-count element packs overflow into extra
        horizontal columns that get clipped (only the first few thumbs show).
      */}
      <div
        ref={scrollRef}
        className={
          "wallpaper-masonry-scroll" +
          (isImagineLayout ? " wallpaper-masonry-scroll--imagine" : "")
        }
        role="list"
        aria-label={t("settings.wallpaperSource.gallery")}
        aria-busy={busy || previewingId !== null}
        tabIndex={visibleItems.length > 0 ? 0 : undefined}
      >
        <div
          className={
            "wallpaper-masonry" +
            (isImagineLayout ? " wallpaper-masonry--full" : "") +
            (stableAppendLayout ? " wallpaper-masonry--stable" : "")
          }
        >
          {showEmptyBlock && emptyState ? (
            <div
              className={
                "wallpaper-masonry__empty" +
                (emptyState.kind === "filter_empty"
                  ? " wallpaper-masonry__empty--filter"
                  : "") +
                (emptyState.kind === "error"
                  ? " wallpaper-masonry__empty--error"
                  : "")
              }
              data-kind={emptyState.kind}
              data-soft-fail={emptyState.softFail ? "1" : "0"}
            >
              <p className="wallpaper-masonry__empty-title">
                {t(emptyState.titleKey as MessageKey)}
              </p>
              {emptyState.hintKey ? (
                <p className="wallpaper-masonry__empty-hint">
                  {t(emptyState.hintKey as MessageKey)}
                </p>
              ) : null}
              {emptyState.showClearFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearGalleryFilters}
                >
                  {t("settings.wallpaperSource.clearFilters")}
                </button>
              ) : null}
            </div>
          ) : null}
          {visibleItems.map((item, index) => {
            const active = item.id === selectedId;
            const loadingThis = previewingId === item.id;
            const src = itemThumbSrc(item);
            const canCreateFromImage = isWallpaperImageItem(item);
            const localMedia =
              !!item.localPath || item.fullUrl.startsWith("file://");
            const localVideo =
              item.kind === "video" &&
              localMedia;
            const cite =
              item.source === "x" || (!item.source && tab === "x")
                ? resolveWallpaperXCitation(item)
                : null;
            const mediaAspectRatio =
              Number(item.width) > 0 && Number(item.height) > 0
                ? `${Number(item.width)} / ${Number(item.height)}`
                : stableAppendLayout
                  ? "16 / 10"
                  : undefined;
            const meta = loadingThis
              ? t("settings.wallpaperSource.loadingOriginal")
              : [
                  item.username ? `@${item.username}` : null,
                  item.likes != null ? `♥ ${item.likes}` : null,
                  isLibraryTab ? t(sourceLabelKey(item)) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
            return (
              <div
                key={item.id}
                className={
                  "wallpaper-masonry__card-wrap" +
                  (isLibraryTab ? " wallpaper-masonry__card-wrap--library" : "")
                }
                role="listitem"
              >
                <div
                  className={
                    "wallpaper-masonry__card" +
                    (active ? " wallpaper-masonry__card--selected" : "") +
                    (loadingThis ? " wallpaper-masonry__card--loading" : "")
                  }
                >
                  <div
                    className="wallpaper-masonry__media-shell"
                    style={
                      mediaAspectRatio
                        ? { aspectRatio: mediaAspectRatio }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="wallpaper-masonry__preview"
                      disabled={
                        (locked && !loadingThis) ||
                        favoriteBusyIds?.has(item.id)
                      }
                      onClick={() => void openItemPreview(item)}
                      aria-pressed={active}
                      aria-label={t("settings.wallpaperSource.openPreview")}
                    >
                      <span className="wallpaper-masonry__media">
                        {item.source === "grok_album" && !isLibraryTab ? (
                          <GrokAlbumThumbnail
                            url={item.thumbUrl || item.fullUrl}
                            alt={
                              item.textPreview ||
                              item.prompt ||
                              item.username ||
                              ""
                            }
                            width={item.width}
                            height={item.height}
                            itemId={item.id}
                            onUnavailable={dropItem}
                          />
                        ) : !isLibraryTab &&
                          !localMedia &&
                          (item.source === "openverse" ||
                            item.source === "pexels") ? (
                          <WallpaperProviderThumbnail item={item} t={t} />
                        ) : localVideo ? (
                          <video
                            src={src}
                            className="wallpaper-masonry__img"
                            muted
                            playsInline
                            preload="metadata"
                            aria-hidden="true"
                            onError={() => dropItem(item.id)}
                          />
                        ) : (
                          <img
                            src={src}
                            alt={
                              item.textPreview ||
                              item.prompt ||
                              item.username ||
                              ""
                            }
                            className="wallpaper-masonry__img"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => {
                              // Thumb failed - remove undownloadable / broken entry.
                              dropItem(item.id);
                            }}
                          />
                        )}
                      </span>
                    </button>
                    {canCreateFromImage ? (
                      <>
                        <button
                          type="button"
                          className="wallpaper-masonry__video-action wallpaper-masonry__edit-action"
                          disabled={locked || loadingThis}
                          aria-label={itemActionAccessibleName(
                            t,
                            "settings.wallpaperSource.editImage",
                            item,
                            index,
                          )}
                          title={t("settings.wallpaperSource.editImage")}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onEditImage(item);
                          }}
                        >
                          <IconEdit size={16} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="wallpaper-masonry__video-action"
                          disabled={locked || loadingThis}
                          aria-label={itemActionAccessibleName(
                            t,
                            "settings.wallpaperSource.generateVideoFromImage",
                            item,
                            index,
                          )}
                          title={t(
                            "settings.wallpaperSource.generateVideoFromImage",
                          )}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onGenerateVideo(item);
                          }}
                        >
                          <IconPlay size={16} aria-hidden />
                        </button>
                      </>
                    ) : null}
                  </div>
                  {meta ? (
                    <span className="wallpaper-masonry__meta">{meta}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="wallpaper-masonry__details"
                  disabled={locked || favoriteBusyIds?.has(item.id)}
                  title={t("settings.wallpaperSource.details.title")}
                  aria-label={itemActionAccessibleName(
                    t,
                    "settings.wallpaperSource.details.title",
                    item,
                    index,
                  )}
                  onClick={() => setDetails({ tab, id: item.id })}
                >
                  <IconInfo size={15} aria-hidden />
                </button>
                {!loadingThis ? (
                  <WallpaperSourceAttribution
                    item={item}
                    t={t}
                    disabled={locked}
                    onOpen={openExternalSource}
                  />
                ) : null}
                {cite && !loadingThis ? (
                  <div
                    className={
                      "wallpaper-masonry__cite" +
                      (cite.state === "verified"
                        ? " wallpaper-masonry__cite--verified"
                        : " wallpaper-masonry__cite--unverified")
                    }
                    title={t(cite.hintKey as MessageKey)}
                  >
                    {cite.state === "verified" && cite.statusUrl ? (
                      <button
                        type="button"
                        className="wallpaper-masonry__cite-btn"
                        disabled={locked}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openExternalSource(cite.statusUrl!);
                        }}
                        title={t("settings.wallpaperSource.cite.openPost")}
                        aria-label={t("settings.wallpaperSource.cite.openPost")}
                      >
                        {t(cite.labelKey as MessageKey)}
                      </button>
                    ) : (
                      <span className="wallpaper-masonry__cite-badge">
                        {t(cite.labelKey as MessageKey)}
                      </span>
                    )}
                  </div>
                ) : null}
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className="wallpaper-masonry__favorite"
                    disabled={locked || favoriteBusyIds?.has(item.id)}
                    aria-busy={favoriteBusyIds?.has(item.id) || undefined}
                    aria-pressed={!!item.metadata?.favorite}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleFavorite(item);
                    }}
                    aria-label={t(
                      item.metadata?.favorite
                        ? "settings.wallpaperSource.library.unfavorite"
                        : "settings.wallpaperSource.library.favorite",
                    )}
                    title={t(
                      item.metadata?.favorite
                        ? "settings.wallpaperSource.library.unfavorite"
                        : "settings.wallpaperSource.library.favorite",
                    )}
                  >
                    <IconHeart size={15} aria-hidden />
                  </button>
                ) : null}
                {isLibraryTab ? (
                  <button
                    type="button"
                    className="wallpaper-masonry__delete"
                    disabled={locked || favoriteBusyIds?.has(item.id)}
                    onClick={(e) => requestDeleteLibraryItem(item, e)}
                    aria-label={t("settings.wallpaperSource.delete")}
                    title={t("settings.wallpaperSource.delete")}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {canLoadMore ? (
          <div className="wallpaper-source-load-more">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={locked || loadingMore}
              aria-busy={loadingMore}
              onClick={onLoadMore}
            >
              {t(
                loadingMore
                  ? "settings.wallpaperSource.loadingMore"
                  : "settings.wallpaperSource.loadMore",
              )}
            </button>
          </div>
        ) : null}
      </div>
      <WallpaperMediaDetails
        item={detailsItem}
        t={t}
        locked={locked}
        onClose={() => setDetails(null)}
        onOpenSource={openExternalSource}
        onReusePrompt={
          onReusePrompt
            ? (item) => {
                setDetails(null);
                onReusePrompt(item);
              }
            : undefined
        }
      />
    </>
  );
}
