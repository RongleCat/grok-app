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
import { useWallpaperProviderController } from "@/hooks/useWallpaperProviderController";
import { useWallpaperGrokAlbum } from "@/hooks/useWallpaperGrokAlbum";
import { createWallpaperRequestId } from "@/lib/wallpaperRequest";
import { WallpaperProviderControls } from "./WallpaperProviderControls";
import { GrokAlbumSourcePanel } from "./GrokAlbumSourcePanel";
import { WallpaperSourceGallery } from "./WallpaperSourceGallery";
import { WallpaperSourceFooter } from "./WallpaperSourceFooter";
import { WallpaperSourceTabs } from "./WallpaperSourceTabs";
import { useWallpaperXSearch } from "@/hooks/useWallpaperXSearch";
import { WallpaperXRouteControl } from "./WallpaperXRouteControl";
import { GlassModal } from "@/components/GlassModal";
import { WallpaperSourceControls } from "./WallpaperSourceControls";
import { useImageViewerOptional } from "@/components/ImageViewerContext";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import {
  dedupeGalleryItems,
  appendWallpaperGalleryItems,
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
import {
  countWallpaperXCitations,
  recordWallpaperXEvidencePick,
  wallpaperXEvidenceFromGalleryItem,
  wallpaperXSearchCitationSummaryKey,
} from "@/lib/xEvidenceCitation";
import { WallpaperPrepareError } from "@/lib/themeSkin";
import { wallpaperRemoteProgressMessageKey } from "@/lib/wallpaperRemoteSearch";
import { resolveGrokAlbumEmptyPresentation } from "@/lib/grokAlbum";
import {
  cancelGrokAlbumMediaRequests,
  fetchGrokAlbumMedia,
} from "@/lib/grokAlbumMedia";
import type { MessageKey } from "@/i18n";

export type WallpaperSourceTab =
  | "x"
  | "web"
  | "imagine"
  | "grok_album"
  | "library"
  | "openverse"
  | "pexels";

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
  if (
    item.source === "web" ||
    item.source === "openverse" ||
    item.source === "pexels"
  ) {
    const fetched = await api.wallpaperRemoteFetchMedia(
      item.source,
      src.url,
      createWallpaperRequestId(),
    );
    return { path: fetched.path, name: fetched.name, mime: fetched.mime };
  }
  if (item.source === "grok_album") {
    const fetched = await fetchGrokAlbumMedia(src.url);
    return { path: fetched.path, name: fetched.name, mime: fetched.mime };
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
  const grokAlbum = useWallpaperGrokAlbum(open && tab === "grok_album", open);
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
  const [continuation, setContinuation] = useState<{
    id: string;
    query: string;
    sort: "top" | "latest";
  } | null>(null);
  const [operationBusy, setBusy] = useState(false);
  const [routeSaving, setRouteSaving] = useState(false);
  const {
    busy: xBusy,
    loadingMore,
    loadMore: searchMore,
    stage: xStage,
    progressiveItems,
    search: searchX,
    cancel: cancelX,
  } = useWallpaperXSearch();
  const [applying, setApplying] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WallpaperSourceErrorCode | null>(
    null,
  );
  const [statusHint, setStatusHint] = useState<string | null>(null);
  /** Soft citation honesty after an X search (verified / unverified counts). */
  const [citeSummary, setCiteSummary] = useState<string | null>(null);

  const providerSource =
    tab === "web" || tab === "openverse" || tab === "pexels" ? tab : null;
  const provider = useWallpaperProviderController({
    enabled: open && providerSource !== null,
    source: providerSource,
    query,
    items,
    t,
    setItems,
    setError,
    setErrorCode,
    setStatusHint,
    setHasSearched,
    setSelectedId,
  });
  const providerProgressKey = wallpaperRemoteProgressMessageKey(
    provider.stage,
    providerSource,
  );
  const busy =
    operationBusy ||
    xBusy ||
    routeSaving ||
    provider.busy ||
    (tab === "grok_album" && grokAlbum.busy);
  const close = useCallback(() => {
    void cancelX();
    void provider.cancel();
    cancelGrokAlbumMediaRequests();
    onClose();
  }, [cancelX, provider.cancel, onClose]);
  useEffect(() => {
    if (!open || tab !== "x") void cancelX();
  }, [open, tab, cancelX]);
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setCiteSummary(null);
    setSelectedId(null);
    setPreviewingId(null);
    setGalleryFilter("");
    setKindFilter(initialTab === "library" ? "image" : "all");
    setHasSearched(false);
    setItems([]);
    setContinuation(null);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || tab !== "grok_album") return;
    setItems((current) => {
      const previous = new Map(current.map((item) => [item.id, item]));
      return grokAlbum.items.map((item) => {
        const saved = previous.get(item.id);
        return saved?.localPath ? { ...item, localPath: saved.localPath } : item;
      });
    });
    setHasSearched(grokAlbum.hasSynced);
    setSelectedId((current) =>
      current && grokAlbum.items.some((item) => item.id === current)
        ? current
        : null,
    );
  }, [open, tab, grokAlbum.items, grokAlbum.hasSynced]);

  const galleryItems =
    xBusy && !loadingMore && progressiveItems.length > 0
      ? progressiveItems
      : items;
  const kindCounts = useMemo(
    () => countGalleryByKind(galleryItems),
    [galleryItems],
  );

  const visibleItems = useMemo(
    () =>
      filterGalleryItems(galleryItems, {
        query: galleryFilter,
        kind: kindFilter,
      }),
    [galleryItems, galleryFilter, kindFilter],
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
      totalCount: galleryItems.length,
      kindFilter,
      hasSearched,
    });
    if (!base) return null;
    // Library tab: honest idle / empty copy (disk cache, not X/Imagine search).
    if (tab === "grok_album") {
      return resolveGrokAlbumEmptyPresentation(base, grokAlbum.status);
    }
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
    galleryItems.length,
    kindFilter,
    hasSearched,
    tab,
    grokAlbum.status,
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

  const changeTab = useCallback((nextTab: WallpaperSourceTab) => {
    void provider.cancel();
    if (tab === "grok_album" && nextTab !== "grok_album") {
      cancelGrokAlbumMediaRequests();
    }
    setTab(nextTab);
    setItems([]);
    setHasSearched(false);
    setSelectedId(null);
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setCiteSummary(null);
    setContinuation(null);
    setGalleryFilter("");
    setKindFilter(nextTab === "library" ? "image" : "all");
  }, [provider.cancel, tab]);

  const selected = useMemo(
    () => visibleItems.find((i) => i.id === selectedId) ?? null,
    [visibleItems, selectedId],
  );

  const runXSearch = useCallback(async () => {
    if (xBusy || operationBusy || routeSaving) return;
    setContinuation(null);
    const q = query.trim();
    if (!q) {
      setErrorCode("empty");
      setError(errorMessage(t, "empty"));
      setCiteSummary(null);
      return;
    }
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      setCiteSummary(null);
      return;
    }
    setError(null);
    setErrorCode(null);
    setCiteSummary(null);
    setStatusHint(null);
    setSelectedId(null);
    setGalleryFilter("");
    setKindFilter("all");
    try {
      const res = await searchX(q, sort);
      if (!res) return;
      if (res.meta) {
        const { routeUsed, durationMs, fallbackReason } = res.meta;
        const reason = fallbackReason?.includes("oauth") || fallbackReason?.includes("unauthorized")
          ? "auth"
          : fallbackReason?.includes("circuit") ? "circuit"
            : fallbackReason?.includes("empty") ? "empty"
              : /network|timeout|tls|server/.test(fallbackReason ?? "") ? "network"
                : "compatibility";
        const routeLabel = t(fallbackReason
          ? "settings.wallpaperSource.route.fallback"
          : routeUsed === "responses" ? "settings.wallpaperSource.route.responses" : "settings.wallpaperSource.route.cli", {
          seconds: (durationMs / 1000).toFixed(1),
          reason: t(`settings.wallpaperSource.route.fallback.${reason}` as MessageKey),
        });
        setStatusHint(res.meta.cacheHit ? t("settings.wallpaperSource.route.cached", { route: routeLabel }) : routeLabel);
      }
      const list = dedupeGalleryItems(res.items || []);
      const code = errorCodeFromSearchResult({ ...res, items: list });
      setHasSearched(true);
      if (code) {
        // Honest empty/error — never invent CDN gallery cards
        setItems([]);
        setErrorCode(code);
        setError(errorMessage(t, code));
        const emptyKey = wallpaperXSearchCitationSummaryKey({
          itemCount: 0,
          verified: 0,
          unverified: 0,
          errorCode: code,
        });
        setCiteSummary(
          emptyKey
            ? t(emptyKey as MessageKey, { verified: 0, unverified: 0 })
            : null,
        );
      } else {
        setItems(list);
        if (res.meta?.continuationId) setContinuation({ id: res.meta.continuationId, query: q, sort });
        setError(null);
        setErrorCode(null);
        const counts = countWallpaperXCitations(list);
        const sumKey = wallpaperXSearchCitationSummaryKey({
          itemCount: counts.total,
          verified: counts.verified,
          unverified: counts.unverified,
        });
        setCiteSummary(
          sumKey
            ? t(sumKey as MessageKey, {
                verified: counts.verified,
                unverified: counts.unverified,
              })
            : null,
        );
      }
    } catch (e) {
      setHasSearched(true);
      setItems([]);
      setCiteSummary(null);
      const code = parseWallpaperSourceError(e);
      setErrorCode(code);
      setError(errorMessage(t, code));
    }
  }, [query, sort, t, searchX, xBusy, operationBusy, routeSaving]);

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
    setCiteSummary(null);
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
  const [deleteConfirm, setDeleteConfirm] = useState<WallpaperGalleryItem | null>(
    null,
  );

  const requestDeleteLibraryItem = useCallback(
    (item: WallpaperGalleryItem, ev?: { preventDefault(): void; stopPropagation(): void }) => {
      ev?.preventDefault();
      ev?.stopPropagation();
      if (busy || applying || previewingId) return;
      setDeleteConfirm(item);
    },
    [busy, applying, previewingId],
  );

  const deleteLibraryItem = useCallback(
    async (item: WallpaperGalleryItem) => {
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
      if (
        (provider.busy && !provider.loadingMore) ||
        operationBusy ||
        routeSaving ||
        (xBusy && !loadingMore) ||
        applying ||
        previewingId
      ) {
        return;
      }
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
        const viable = visibleItems.filter((it) => {
          if (it.id === item.id || it.localPath) return true;
          // Saved URLs carry browser-session signatures. Never hand another
          // one to the main renderer; each selected original must cross the
          // isolated Host bridge first.
          if (item.source === "grok_album") return false;
          return it.fullUrl.startsWith("http");
        });
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
    [
      provider.busy,
      provider.loadingMore,
      operationBusy,
      routeSaving,
      xBusy,
      loadingMore,
      applying,
      previewingId,
      visibleItems,
      t,
      viewer,
      dropItem,
    ],
  );

  const openExternalSource = useCallback((url: string) => {
    void api.openExternalUrl(url).catch(() => {
      /* soft-fail: citation open is best-effort */
    });
  }, []);

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
      // Local evidence ring for X picks only (path + status url meta; no cloud).
      if ((selected.source || "x") === "x") {
        const pick = wallpaperXEvidenceFromGalleryItem(selected, local.path);
        if (pick) recordWallpaperXEvidencePick(pick);
      }
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

  const runLoadMore = useCallback(async () => {
    if (!continuation || xBusy || operationBusy || applying || routeSaving) return;
    setError(null);
    setErrorCode(null);
    try {
      const result = await searchMore(continuation.id);
      if (!result) return;
      if (!result.errorCode) {
        setItems(previous => appendWallpaperGalleryItems(previous, result.items));
        setContinuation(null);
        setCiteSummary(null);
        setStatusHint(null);
      } else if (result.errorCode === "empty") {
        setContinuation(null);
        setStatusHint(t("settings.wallpaperSource.noMore"));
      } else {
        if (result.errorCode === "load_more_unavailable" || result.errorCode.startsWith("oauth_")) setContinuation(null);
        const code = parseWallpaperSourceError(result.errorCode);
        setErrorCode(code);
        setError(errorMessage(t, code));
      }
    } catch (error) {
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(errorMessage(t, code));
    }
  }, [continuation, xBusy, operationBusy, applying, routeSaving, searchMore, t]);

  const authNeeded = errorCode === "auth_required";
  const locked = busy || applying || previewingId !== null;
  const galleryLocked =
    (provider.busy && !provider.loadingMore) ||
    operationBusy ||
    routeSaving ||
    (xBusy && !loadingMore) ||
    applying ||
    previewingId !== null;
  const showGalleryFilters = galleryItems.length > 0 || filtersActive;
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
    <>
      <GlassModal
        open={open}
        onClose={close}
        title={t("settings.wallpaperSource.title")}
        size="lg"
        className="wallpaper-source-modal"
        wrapBody
        bodyClassName="wallpaper-source-modal__body"
        closeLabel={t("common.close")}
        footer={
          <WallpaperSourceFooter
            t={t}
            selected={selected !== null}
            locked={galleryLocked}
            applying={applying}
            onClose={close}
            applySelected={applySelected}
          />
        }
      >
        <WallpaperSourceTabs
          t={t}
          value={tab}
          disabled={operationBusy || applying || previewingId !== null}
          panelId="wallpaper-source-panel"
          onChange={changeTab}
        />

        <div
          id="wallpaper-source-panel"
          className="wallpaper-source-panel"
          role="tabpanel"
          aria-labelledby={`wallpaper-source-tab-${tab}`}
        >
          {providerSource ? (
            <WallpaperProviderControls
              source={providerSource}
              query={query}
              busy={provider.busy}
              locked={locked}
              invalidKey={errorCode === "pexels_key_invalid"}
              t={t}
              setQuery={setQuery}
              search={provider.search}
              cancel={provider.cancel}
              onSaved={() => {
                setError(null);
                setErrorCode(null);
              }}
            />
          ) : tab === "grok_album" ? (
            <GrokAlbumSourcePanel
              t={t}
              status={grokAlbum.status}
              busy={grokAlbum.busy}
              syncing={grokAlbum.syncing}
              cachedCount={grokAlbum.cachedCount}
              visibleCount={grokAlbum.visibleCount}
              errorCode={grokAlbum.errorCode}
              onOpen={() => {
                void grokAlbum.open(t("settings.wallpaperGrokAlbum"));
              }}
              onSync={() => {
                void grokAlbum.sync();
              }}
              onRefresh={() => {
                void grokAlbum.refresh();
              }}
            />
          ) : (
            <WallpaperSourceControls
              t={t}
              xRouteControl={
                open && isDesktopHost() ? (
                  <WallpaperXRouteControl
                    t={t}
                    disabled={locked}
                    onSavingChange={setRouteSaving}
                  />
                ) : null
              }
              tab={tab}
              query={query}
              sort={sort}
              prompt={prompt}
              aspect={aspect}
              busy={busy}
              xBusy={xBusy}
              locked={locked}
              setQuery={setQuery}
              setSort={setSort}
              setPrompt={setPrompt}
              setAspect={setAspect}
              runXSearch={runXSearch}
              cancelXSearch={cancelX}
              runImagine={runImagine}
              loadLibrary={loadLibrary}
            />
          )}

          {xBusy && xStage ? (
            <p className="wallpaper-source-status" role="status">
              {t(
                xStage === "falling_back"
                  ? "settings.wallpaperSource.progress.fallingBack"
                  : xStage === "validating"
                    ? "settings.wallpaperSource.progress.validating"
                    : xStage === "supplementing"
                      ? "settings.wallpaperSource.progress.supplementing"
                      : xStage === "preparing"
                        ? "settings.wallpaperSource.progress.preparing"
                        : "settings.wallpaperSource.searching",
              )}
            </p>
          ) : null}
          {provider.busy && providerProgressKey ? (
            <p className="wallpaper-source-status" role="status">
              {t(providerProgressKey)}
            </p>
          ) : null}
          {statusHint ? (
            <p className="wallpaper-source-status" role="status">
              {statusHint}
            </p>
          ) : null}

          {citeSummary && tab === "x" ? (
            <p
              className="wallpaper-source-cite-summary"
              role="status"
              data-soft-fail="1"
            >
              {citeSummary}
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
                    (softFailError
                      ? " wallpaper-source-err-chip--soft"
                      : "")
                  }
                  data-kind={galleryErrorKind}
                >
                  {t(
                    wallpaperGalleryErrorTitleKey(
                      galleryErrorKind,
                    ) as MessageKey,
                  )}
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
                onChange={(event) => setGalleryFilter(event.target.value)}
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

          {tab === "x" &&
          continuation &&
          continuation.query === query.trim() &&
          continuation.sort === sort ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={xBusy || operationBusy || applying || routeSaving}
              onClick={() => void runLoadMore()}
            >
              {t(
                loadingMore
                  ? "settings.wallpaperSource.searching"
                  : "settings.wallpaperSource.loadMore",
              )}
            </button>
          ) : null}

          {providerSource && provider.canLoadMore ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={provider.busy || applying}
              onClick={() => {
                void provider.loadMore();
              }}
            >
              {t(
                provider.loadingMore
                  ? "settings.wallpaperSource.remote.progress.loadingMore"
                  : "settings.wallpaperSource.loadMore",
              )}
            </button>
          ) : null}
          {tab === "grok_album" && grokAlbum.canLoadMore ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={grokAlbum.loadingMore || applying || previewingId !== null}
              onClick={() => {
                void grokAlbum.loadMore();
              }}
            >
              {t(
                grokAlbum.loadingMore
                  ? "settings.wallpaperSource.remote.progress.loadingMore"
                  : "settings.wallpaperSource.loadMore",
              )}
            </button>
          ) : null}
          <WallpaperSourceGallery
            t={t}
            tab={tab}
            busy={busy}
            locked={galleryLocked}
            visibleItems={visibleItems}
            selectedId={selectedId}
            previewingId={previewingId}
            showEmptyBlock={showEmptyBlock}
            emptyState={emptyState}
            clearGalleryFilters={clearGalleryFilters}
            openItemPreview={openItemPreview}
            dropItem={dropItem}
            openExternalSource={openExternalSource}
            requestDeleteLibraryItem={requestDeleteLibraryItem}
          />
        </div>
      </GlassModal>
      <GlassModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title={t("wallpaper.library.deleteConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDeleteConfirm(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid btn--danger"
              data-testid="wallpaper-library-delete-confirm"
              onClick={() => {
                const item = deleteConfirm;
                setDeleteConfirm(null);
                if (item) void deleteLibraryItem(item);
              }}
            >
              {t("wallpaper.library.deleteConfirmAction")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">
          {t("wallpaper.library.deleteConfirm")}
        </p>
      </GlassModal>
    </>
  );
}
