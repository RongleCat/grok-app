import type { MouseEvent } from "react";
import type { MessageKey } from "@/i18n";
import type { WallpaperSourceModalProps, WallpaperSourceTab } from "./WallpaperSourceModal";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import type { WallpaperGalleryEmptyPresentation } from "@/lib/wallpaperGalleryPro";
import { resolveWallpaperXCitation } from "@/lib/xEvidenceCitation";
import { resolveImageSrcSync } from "@/lib/imageSrc";

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
  openXStatus: (url: string) => void;
  requestDeleteLibraryItem: (item: WallpaperGalleryItem, event: MouseEvent) => void;
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

export function WallpaperSourceGallery({
  t, tab, busy, locked, visibleItems, selectedId, previewingId,
  showEmptyBlock, emptyState, clearGalleryFilters, openItemPreview,
  dropItem, openXStatus, requestDeleteLibraryItem,
}: Props) {
  const isImagineLayout = tab === "imagine";
  const isLibraryTab = tab === "library";
  return (
    <>
      {/*
        Scroll shell must wrap multi-column masonry. Putting overflow-y +
        max-height on the column-count element packs overflow into extra
        horizontal columns that get clipped (only the first few thumbs show).
      */}
      <div
        className="wallpaper-masonry-scroll"
        role="list"
        aria-label={t("settings.wallpaperSource.gallery")}
        aria-busy={busy || previewingId !== null}
        tabIndex={visibleItems.length > 0 ? 0 : undefined}
      >
        <div
          className={
            "wallpaper-masonry" +
            (isImagineLayout ? " wallpaper-masonry--full" : "")
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
          {visibleItems.map((item) => {
            const active = item.id === selectedId;
            const loadingThis = previewingId === item.id;
            const src = itemThumbSrc(item);
            const cite =
              item.source === "x" || (!item.source && tab === "x")
                ? resolveWallpaperXCitation(item)
                : null;
            return (
              <div
                key={item.id}
                className={
                  "wallpaper-masonry__card-wrap" +
                  (isLibraryTab ? " wallpaper-masonry__card-wrap--library" : "")
                }
                role="listitem"
              >
                <button
                  type="button"
                  className={
                    "wallpaper-masonry__card" +
                    (active ? " wallpaper-masonry__card--selected" : "") +
                    (loadingThis ? " wallpaper-masonry__card--loading" : "")
                  }
                  disabled={locked && !loadingThis}
                  onClick={() => void openItemPreview(item)}
                  aria-label={t("settings.wallpaperSource.openPreview")}
                >
                  <img
                    src={src}
                    alt={item.textPreview || item.prompt || item.username || ""}
                    className="wallpaper-masonry__img"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => {
                      // Thumb failed — remove undownloadable / broken entry
                      dropItem(item.id);
                    }}
                  />
                  <span className="wallpaper-masonry__meta">
                    {loadingThis
                      ? t("settings.wallpaperSource.loadingOriginal")
                      : null}
                    {!loadingThis && item.username
                      ? `@${item.username}`
                      : null}
                    {!loadingThis && item.likes != null
                      ? ` · ♥ ${item.likes}`
                      : null}
                    {!loadingThis &&
                    !isLibraryTab &&
                    item.source === "imagine"
                      ? t("settings.wallpaperImagine")
                      : null}
                    {!loadingThis && isLibraryTab
                      ? item.source === "imagine"
                        ? t("settings.wallpaperImagine")
                        : item.source === "x"
                          ? t("settings.wallpaperFromX")
                          : t("settings.wallpaperLibrary")
                      : null}
                  </span>
                </button>
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
                          openXStatus(cite.statusUrl!);
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
                {isLibraryTab ? (
                  <button
                    type="button"
                    className="wallpaper-masonry__delete"
                    disabled={locked}
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
      </div>
    </>
  );
}
