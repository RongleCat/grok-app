/**
 * Wallpaper source picker: search X, Imagine generate, or manage library.
 * Host orchestrates Grok headless tools; FE shows masonry gallery + apply.
 *
 * UX:
 * - Custom Select (not native <select>)
 * - X results: 3-col masonry, natural image height (scroll on outer shell —
 *   never overflow-y on the column-count element or later cards vanish)
 * - Imagine results: full-width cards
 * - Click loads original → ImageViewer preview → footer to set background
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import { useImageViewerOptional } from "@/components/ImageViewer";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import {
  dedupeGalleryItems,
  errorCodeFromSearchResult,
  fileFromAbsolutePath,
  libraryEntriesToGalleryItems,
  parseWallpaperSourceError,
  resolveApplySource,
  type WallpaperGalleryItem,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";
import {
  classifyWallpaperGalleryError,
  countGalleryByKind,
  filterGalleryItems,
  isWallpaperGallerySoftFail,
  resolveWallpaperGalleryEmptyState,
  wallpaperGalleryErrorTitleKey,
  wallpaperGalleryHasActiveFilters,
  wallpaperGalleryKindFilterLabelKey,
  WALLPAPER_GALLERY_KIND_FILTERS,
  type WallpaperGalleryKindFilter,
} from "@/lib/wallpaperGalleryPro";
import { WallpaperPrepareError } from "@/lib/themeSkin";
import { resolveImageSrcSync } from "@/lib/imageSrc";
import type { MessageKey } from "@/i18n";

export type WallpaperSourceTab = "x" | "imagine" | "library";

export type WallpaperSourceModalProps = {
  open: boolean;
  onClose: () => void;
  initialTab?: WallpaperSourceTab;
  t: (
    key: MessageKey,
    vars?: Record<string, string | number | undefined | null>,
  ) => string;
  /** Apply prepared File via parent (prepareWallpaperFromFile + onWallpaper). */
  onPickFile: (file: File) => void | Promise<void>;
  /** Jump to Account settings when login is required. */
  onRequestLogin?: () => void;
};

function errorMessage(
  t: WallpaperSourceModalProps["t"],
  code: WallpaperSourceErrorCode,
): string {
  const key = `settings.wallpaperSource.err.${code}` as MessageKey;
  const msg = t(key);
  return msg === key ? t("settings.wallpaperSource.err.generic") : msg;
}

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

/**
 * Resolve a local absolute path or media URL suitable for ImageViewer / apply.
 * Remote URLs are downloaded into the wallpaper library first (original quality).
 */
async function ensureLocalMedia(
  item: WallpaperGalleryItem,
): Promise<{ path: string; name?: string; mime?: string }> {
  const src = resolveApplySource(item);
  if (src.kind === "path") {
    return { path: src.path };
  }
  const fetched = await api.wallpaperFetchMedia(
    src.url,
    item.source === "imagine" ? "imagine" : "x",
  );
  return { path: fetched.path, name: fetched.name, mime: fetched.mime };
}

export function WallpaperSourceModal({
  open,
  onClose,
  initialTab = "x",
  t,
  onPickFile,
  onRequestLogin,
}: WallpaperSourceModalProps) {
  const viewer = useImageViewerOptional();
  const [tab, setTab] = useState<WallpaperSourceTab>(initialTab);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"top" | "latest">("top");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [items, setItems] = useState<WallpaperGalleryItem[]>([]);
  /** Client-side gallery filter (not the X search box). */
  const [galleryFilter, setGalleryFilter] = useState("");
  const [kindFilter, setKindFilter] =
    useState<WallpaperGalleryKindFilter>("all");
  /** True after at least one search/generate finished this open. */
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WallpaperSourceErrorCode | null>(
    null,
  );
  const [statusHint, setStatusHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setSelectedId(null);
    setPreviewingId(null);
    setGalleryFilter("");
    setKindFilter(initialTab === "library" ? "image" : "all");
    setHasSearched(false);
    setItems([]);
  }, [open, initialTab]);

  const kindCounts = useMemo(() => countGalleryByKind(items), [items]);

  const visibleItems = useMemo(
    () =>
      filterGalleryItems(items, {
        query: galleryFilter,
        kind: kindFilter,
      }),
    [items, galleryFilter, kindFilter],
  );

  const filtersActive = wallpaperGalleryHasActiveFilters({
    query: galleryFilter,
    kind: kindFilter,
  });

  const emptyState = useMemo(() => {
    const base = resolveWallpaperGalleryEmptyState({
      loading: busy,
      query: galleryFilter,
      itemCount: visibleItems.length,
      error: errorCode
        ? { code: errorCode, message: error ?? errorCode }
        : error,
      totalCount: items.length,
      kindFilter,
      hasSearched,
    });
    if (!base) return null;
    // Library tab: honest idle / empty copy (disk cache, not X/Imagine search).
    if (tab === "library" && (base.kind === "idle" || base.kind === "empty")) {
      return {
        ...base,
        titleKey:
          base.kind === "empty"
            ? "settings.wallpaperSource.empty.noResults"
            : "settings.wallpaperSource.emptyGallery",
        hintKey: "settings.wallpaperSource.empty.libraryIdleHint",
      };
    }
    return base;
  }, [
    busy,
    galleryFilter,
    visibleItems.length,
    errorCode,
    error,
    items.length,
    kindFilter,
    hasSearched,
    tab,
  ]);

  const galleryErrorKind = useMemo(() => {
    if (!errorCode && !error) return null;
    // Prefer structured code + detail so desktop-only / free-text still classify
    // (e.g. generic + "desktop app" → host soft-fail).
    return classifyWallpaperGalleryError(
      errorCode
        ? { code: errorCode, message: error ?? errorCode }
        : error,
    );
  }, [errorCode, error]);

  const clearGalleryFilters = useCallback(() => {
    setGalleryFilter("");
    setKindFilter("all");
  }, []);

  const selected = useMemo(
    () => visibleItems.find((i) => i.id === selectedId) ?? null,
    [visibleItems, selectedId],
  );

  const sortOptions = useMemo(
    () => [
      { value: "top", label: t("settings.wallpaperSource.sortTop") },
      { value: "latest", label: t("settings.wallpaperSource.sortLatest") },
    ],
    [t],
  );

  const aspectOptions = useMemo(
    () => [
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "1:1", label: "1:1" },
      { value: "4:3", label: "4:3" },
      { value: "auto", label: "auto" },
    ],
    [],
  );

  const runXSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setErrorCode("empty");
      setError(errorMessage(t, "empty"));
      return;
    }
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.searching"));
    setSelectedId(null);
    setGalleryFilter("");
    setKindFilter("all");
    try {
      const res = await api.wallpaperXSearch(q, sort);
      const list = dedupeGalleryItems(res.items || []);
      const code = errorCodeFromSearchResult({ ...res, items: list });
      setHasSearched(true);
      if (code) {
        // Honest empty/error — never invent CDN gallery cards
        setItems([]);
        setErrorCode(code);
        setError(errorMessage(t, code));
      } else {
        setItems(list);
        setError(null);
        setErrorCode(null);
      }
    } catch (e) {
      setHasSearched(true);
      setItems([]);
      const code = parseWallpaperSourceError(e);
      setErrorCode(code);
      setError(errorMessage(t, code));
    } finally {
      setBusy(false);
      setStatusHint(null);
    }
  }, [query, sort, t]);

  const runImagine = useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      setErrorCode("empty");
      setError(errorMessage(t, "empty"));
      return;
    }
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.generating"));
    setSelectedId(null);
    setGalleryFilter("");
    setKindFilter("all");
    try {
      const res = await api.wallpaperImagine(p, aspect);
      const list = dedupeGalleryItems(res.items || []);
      const code = errorCodeFromSearchResult({ ...res, items: list });
      setHasSearched(true);
      if (code) {
        setItems([]);
        setErrorCode(code);
        setError(errorMessage(t, code));
      } else {
        setItems(list);
        setError(null);
        setErrorCode(null);
        if (list[0]) setSelectedId(list[0].id);
      }
    } catch (e) {
      setHasSearched(true);
      setItems([]);
      const code = parseWallpaperSourceError(e);
      setErrorCode(code);
      setError(errorMessage(t, code));
    } finally {
      setBusy(false);
      setStatusHint(null);
    }
  }, [prompt, aspect, t]);

  const dropItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const loadLibrary = useCallback(async () => {
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.libraryLoading"));
    setSelectedId(null);
    setGalleryFilter("");
    // Static first: default kind chip to images (video still available via chip).
    setKindFilter("image");
    try {
      const entries = await api.wallpaperLibraryList(96);
      const list = libraryEntriesToGalleryItems(entries, { staticFirst: true });
      setHasSearched(true);
      setItems(list);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      setHasSearched(true);
      setItems([]);
      const code = parseWallpaperSourceError(e);
      setErrorCode(code);
      setError(errorMessage(t, code));
    } finally {
      setBusy(false);
      setStatusHint(null);
    }
  }, [t]);

  useEffect(() => {
    if (!open || tab !== "library") return;
    void loadLibrary();
    // loadLibrary is stable on `t`; re-run when opening library tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  /**
   * Soft-delete a library file. Failures keep the card and show a soft warn —
   * never invent a successful delete.
   */
  const deleteLibraryItem = useCallback(
    async (item: WallpaperGalleryItem, ev?: { preventDefault(): void; stopPropagation(): void }) => {
      ev?.preventDefault();
      ev?.stopPropagation();
      if (busy || applying || previewingId) return;
      const path = item.localPath?.trim();
      if (!path) return;
      if (!isDesktopHost()) {
        setErrorCode("generic");
        setError(t("settings.wallpaperSource.err.desktopOnly"));
        return;
      }
      setStatusHint(t("settings.wallpaperSource.deleting"));
      try {
        await api.wallpaperLibraryDelete(path);
        dropItem(item.id);
        setError(null);
        setErrorCode(null);
      } catch (e) {
        const code = parseWallpaperSourceError(e);
        setErrorCode(code);
        setError(
          code === "url_blocked"
            ? t("settings.wallpaperSource.err.deleteDenied")
            : t("settings.wallpaperSource.err.deleteFailed"),
        );
      } finally {
        setStatusHint(null);
      }
    },
    [busy, applying, previewingId, t, dropItem],
  );

  /**
   * Click card: load original into library if needed, open ImageViewer, mark selected.
   * User then confirms with footer "Set as background".
   */
  const openItemPreview = useCallback(
    async (item: WallpaperGalleryItem) => {
      if (busy || applying || previewingId) return;
      if (!isDesktopHost()) {
        setErrorCode("generic");
        setError(t("settings.wallpaperSource.err.desktopOnly"));
        return;
      }
      setSelectedId(item.id);
      setPreviewingId(item.id);
      setError(null);
      setErrorCode(null);
      setStatusHint(t("settings.wallpaperSource.loadingOriginal"));
      try {
        // Ensure current item is local (download orig for remote X media)
        const local = await ensureLocalMedia(item);
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  localPath: local.path,
                  fullUrl: it.fullUrl.startsWith("http")
                    ? it.fullUrl
                    : `file://${local.path}`,
                }
              : it,
          ),
        );

        // Only open downloadable / already-local siblings in the lightbox
        // (visible set only — never invent off-filter CDN cards).
        const viable = visibleItems.filter(
          (it) => it.id === item.id || it.localPath || it.fullUrl.startsWith("http"),
        );
        const slides = viable.map((it) => {
          const path =
            it.id === item.id
              ? local.path
              : it.localPath ||
                (it.fullUrl.startsWith("file://")
                  ? decodeURIComponent(it.fullUrl.replace(/^file:\/\//, ""))
                  : it.fullUrl);
          return {
            src: path,
            title:
              it.textPreview ||
              it.prompt ||
              (it.username ? `@${it.username}` : undefined),
            alt: it.prompt || it.textPreview || undefined,
          };
        });
        const idx = Math.max(
          0,
          viable.findIndex((it) => it.id === item.id),
        );
        viewer.open(slides, idx);
      } catch (e) {
        // Undownloadable: drop from gallery (do not keep broken cards)
        dropItem(item.id);
        const code = parseWallpaperSourceError(e);
        setErrorCode(code);
        setError(errorMessage(t, code));
      } finally {
        setPreviewingId(null);
        setStatusHint(null);
      }
    },
    [busy, applying, previewingId, visibleItems, t, viewer, dropItem],
  );

  const applySelected = useCallback(async () => {
    if (!selected) return;
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    setApplying(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.applying"));
    try {
      const local = await ensureLocalMedia(selected);
      const file = await fileFromAbsolutePath(local.path, {
        name: local.name,
        mime: local.mime,
      });
      await onPickFile(file);
      onClose();
    } catch (e) {
      // prepareWallpaperFromFile errors use settings.wallpaper.err.* keys
      if (e instanceof WallpaperPrepareError) {
        const key = `settings.wallpaper.err.${e.code}` as MessageKey;
        const msg = t(key);
        setErrorCode("generic");
        setError(msg === key ? t("settings.wallpaper.err.generic") : msg);
        return;
      }
      const code = parseWallpaperSourceError(e);
      setErrorCode(code);
      setError(errorMessage(t, code));
    } finally {
      setApplying(false);
      setStatusHint(null);
    }
  }, [selected, t, onPickFile, onClose]);

  const authNeeded = errorCode === "auth_required";
  const locked = busy || applying || previewingId !== null;
  const isImagineLayout = tab === "imagine";
  const isLibraryTab = tab === "library";
  const showGalleryFilters = items.length > 0 || filtersActive;
  const softFailError =
    galleryErrorKind != null && isWallpaperGallerySoftFail(galleryErrorKind);
  // Error banner already carries detail for empty/error — avoid stacking the
  // same honesty block; still show loading / idle / filter-empty surfaces.
  const showEmptyBlock =
    emptyState != null &&
    (emptyState.kind === "loading" ||
      emptyState.kind === "idle" ||
      emptyState.kind === "filter_empty" ||
      !error);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={t("settings.wallpaperSource.title")}
      size="lg"
      className="wallpaper-source-modal"
      wrapBody
      bodyClassName="wallpaper-source-modal__body"
      closeLabel={t("common.close")}
      footer={
        <>
          <span className="wallpaper-source-footer-hint">
            {selected
              ? t("settings.wallpaperSource.previewThenApply")
              : t("settings.wallpaperSource.clickToPreview")}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={applying}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={!selected || locked}
            onClick={() => void applySelected()}
          >
            {applying
              ? t("settings.wallpaperSource.applying")
              : t("settings.wallpaperSource.apply")}
          </button>
        </>
      }
    >
      <div className="wallpaper-source-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "x"}
          className={
            "wallpaper-source-tabs__btn" +
            (tab === "x" ? " wallpaper-source-tabs__btn--active" : "")
          }
          onClick={() => {
            setTab("x");
            setItems([]);
            setHasSearched(false);
            setSelectedId(null);
            setError(null);
            setErrorCode(null);
          }}
          disabled={locked}
        >
          {t("settings.wallpaperFromX")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "imagine"}
          className={
            "wallpaper-source-tabs__btn" +
            (tab === "imagine" ? " wallpaper-source-tabs__btn--active" : "")
          }
          onClick={() => {
            setTab("imagine");
            setItems([]);
            setHasSearched(false);
            setSelectedId(null);
            setError(null);
            setErrorCode(null);
          }}
          disabled={locked}
        >
          {t("settings.wallpaperImagine")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "library"}
          className={
            "wallpaper-source-tabs__btn" +
            (tab === "library" ? " wallpaper-source-tabs__btn--active" : "")
          }
          onClick={() => {
            setTab("library");
            setError(null);
            setErrorCode(null);
          }}
          disabled={locked}
        >
          {t("settings.wallpaperLibrary")}
        </button>
      </div>

      {tab === "x" ? (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.xHint")}
          </p>
          <div className="wallpaper-source-form__row">
            <input
              type="search"
              className="wallpaper-source-form__input"
              value={query}
              placeholder={t("settings.wallpaperSource.xPlaceholder")}
              disabled={locked}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runXSearch();
                }
              }}
            />
            <Select
              className="wallpaper-source-form__select"
              value={sort}
              options={sortOptions}
              disabled={locked}
              aria-label={t("settings.wallpaperSource.sort")}
              onChange={(v) => setSort(v === "latest" ? "latest" : "top")}
              placement="down"
            />
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked || !query.trim()}
              onClick={() => void runXSearch()}
            >
              {busy
                ? t("settings.wallpaperSource.searching")
                : t("settings.wallpaperSource.search")}
            </button>
          </div>
        </div>
      ) : tab === "imagine" ? (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.imagineHint")}
          </p>
          <textarea
            className="wallpaper-source-form__textarea"
            value={prompt}
            placeholder={t("settings.wallpaperSource.imaginePlaceholder")}
            disabled={locked}
            rows={3}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="wallpaper-source-form__row">
            <Select
              className="wallpaper-source-form__select"
              value={aspect}
              options={aspectOptions}
              disabled={locked}
              aria-label={t("settings.wallpaperSource.aspect")}
              onChange={setAspect}
              placement="down"
            />
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked || !prompt.trim()}
              onClick={() => void runImagine()}
            >
              {busy
                ? t("settings.wallpaperSource.generating")
                : t("settings.wallpaperSource.generate")}
            </button>
          </div>
        </div>
      ) : (
        <div className="wallpaper-source-form">
          <p className="wallpaper-source-form__hint">
            {t("settings.wallpaperSource.libraryHint")}
          </p>
          <div className="wallpaper-source-form__row">
            <button
              type="button"
              className="btn btn--solid"
              disabled={locked}
              onClick={() => void loadLibrary()}
            >
              {busy
                ? t("settings.wallpaperSource.libraryLoading")
                : t("settings.wallpaperSource.libraryRefresh")}
            </button>
          </div>
        </div>
      )}

      {statusHint ? (
        <p className="wallpaper-source-status" role="status">
          {statusHint}
        </p>
      ) : null}

      {error ? (
        <div
          className={
            "wallpaper-source-error" +
            (softFailError ? " wallpaper-source-error--soft" : "")
          }
          role="alert"
        >
          {galleryErrorKind ? (
            <span
              className={
                "wallpaper-source-err-chip" +
                (softFailError ? " wallpaper-source-err-chip--soft" : "")
              }
              data-kind={galleryErrorKind}
            >
              {t(wallpaperGalleryErrorTitleKey(galleryErrorKind) as MessageKey)}
            </span>
          ) : null}
          <p>{error}</p>
          {authNeeded && onRequestLogin ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onRequestLogin}
            >
              {t("settings.wallpaperSource.goLogin")}
            </button>
          ) : null}
        </div>
      ) : null}

      {showGalleryFilters ? (
        <div className="wallpaper-source-filters">
          <div
            className="wallpaper-source-chips"
            role="toolbar"
            aria-label={t("settings.wallpaperSource.kindLabel")}
          >
            {WALLPAPER_GALLERY_KIND_FILTERS.map((id) => {
              const n = kindCounts[id];
              // Hide zero-count chips except "all" and the active selection.
              if (id !== "all" && n === 0 && kindFilter !== id) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className={
                    "wallpaper-source-chip" +
                    (kindFilter === id ? " is-active" : "")
                  }
                  aria-pressed={kindFilter === id}
                  disabled={locked && id !== kindFilter}
                  onClick={() => setKindFilter(id)}
                >
                  <span>
                    {t(
                      wallpaperGalleryKindFilterLabelKey(id) as MessageKey,
                    )}
                  </span>
                  <span className="wallpaper-source-chip-count">{n}</span>
                </button>
              );
            })}
          </div>
          <input
            type="search"
            className="wallpaper-source-form__input wallpaper-source-filters__query"
            value={galleryFilter}
            placeholder={t("settings.wallpaperSource.filterPlaceholder")}
            disabled={locked}
            onChange={(e) => setGalleryFilter(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={t("settings.wallpaperSource.filterPlaceholder")}
          />
          {filtersActive ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={clearGalleryFilters}
              disabled={locked}
            >
              {t("settings.wallpaperSource.clearFilters")}
            </button>
          ) : null}
        </div>
      ) : null}

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
                {isLibraryTab ? (
                  <button
                    type="button"
                    className="wallpaper-masonry__delete"
                    disabled={locked}
                    onClick={(e) => void deleteLibraryItem(item, e)}
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
    </GlassModal>
  );
}
