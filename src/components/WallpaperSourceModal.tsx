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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallpaperProviderController } from "@/hooks/useWallpaperProviderController";
import { useWallpaperGrokAlbum } from "@/hooks/useWallpaperGrokAlbum";
import { useWallpaperImagineController } from "@/hooks/useWallpaperImagineController";
import { useWallpaperItemPreview } from "@/hooks/useWallpaperItemPreview";
import { useWallpaperLibrary } from "@/hooks/useWallpaperLibrary";
import { useWallpaperCatalogMetadata } from "@/hooks/useWallpaperCatalogMetadata";
import { useWallpaperMediaActions } from "@/hooks/useWallpaperMediaActions";
import { useWallpaperSourceHistory } from "@/hooks/useWallpaperSourceHistory";
import { WallpaperProviderControls } from "./WallpaperProviderControls";
import { GrokAlbumSourcePanel } from "./GrokAlbumSourcePanel";
import { WallpaperSourceGallery } from "./WallpaperSourceGallery";
import { WallpaperSourceFooter } from "./WallpaperSourceFooter";
import { WallpaperSourceTabs } from "./WallpaperSourceTabs";
import { useWallpaperXSearch } from "@/hooks/useWallpaperXSearch";
import { WallpaperXRouteControl } from "./WallpaperXRouteControl";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import { WallpaperSourceControls } from "./WallpaperSourceControls";
import { useImageViewerOptional } from "@/components/ImageViewerContext";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import {
  dedupeGalleryItems,
  appendWallpaperGalleryItems,
  errorCodeFromSearchResult,
  fileFromAbsolutePath,
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperLibraryPurpose,
  type WallpaperSourceKind,
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
  cancelRemoteWallpaperMediaRequests,
  ensureLocalWallpaperMedia,
} from "@/lib/wallpaperSourceMedia";
import { isWallpaperImageItem } from "@/lib/wallpaperImagine";
import type { MessageKey } from "@/i18n";

export type WallpaperSourceTab = WallpaperSourceKind;

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
  const sourceHistory = useWallpaperSourceHistory();
  const pendingHistoryRestore = useRef<WallpaperSourceTab | null>(null);
  const pendingScrollRestore = useRef<{
    tab: WallpaperSourceTab;
    top: number;
  } | null>(null);
  const grokAlbum = useWallpaperGrokAlbum(open && tab === "grok_album", open);
  const albumHistoryRevision = useRef(grokAlbum.historyRevision);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"top" | "latest">("top");
  const [items, setItems] = useState<WallpaperGalleryItem[]>([]);
  /** Client-side gallery filter (not the X search box). */
  const [galleryFilter, setGalleryFilter] = useState("");
  const [kindFilter, setKindFilter] =
    useState<WallpaperGalleryKindFilter>("all");
  const [libraryPurpose, setLibraryPurpose] =
    useState<WallpaperLibraryPurpose>("all");
  const library = useWallpaperLibrary(
    open && tab === "library",
    galleryFilter,
    kindFilter,
    open,
    libraryPurpose,
  );
  const updateMediaItem = useCallback(
    (item: WallpaperGalleryItem) => {
      setItems((previous) =>
        previous.map((row) => (row.id === item.id ? item : row)),
      );
      sourceHistory.updateItem(item);
      library.updateItem(item);
      setError(null);
      setErrorCode(null);
    },
    [library.updateItem, sourceHistory.updateItem],
  );
  const reportMediaError = useCallback(() => {
    setErrorCode("generic");
    setError(t("settings.wallpaperSource.library.saveFailed"));
  }, [t]);
  const mediaActions = useWallpaperMediaActions({
    open,
    source: tab,
    onChanged: updateMediaItem,
    onError: reportMediaError,
  });
  useWallpaperCatalogMetadata(
    open &&
      tab !== "library" &&
      (tab !== "grok_album" || grokAlbum.status === "ready"),
    items,
    setItems,
    reportMediaError,
  );
  /** True after at least one search/generate finished this open. */
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<{
    id: string;
    query: string;
    sort: "top" | "latest";
  } | null>(null);
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
  const sourceGenerationRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WallpaperSourceErrorCode | null>(
    null,
  );
  const [statusHint, setStatusHint] = useState<string | null>(null);
  /** Soft citation honesty after an X search (verified / unverified counts). */
  const [citeSummary, setCiteSummary] = useState<string | null>(null);

  const imagineController = useWallpaperImagineController({
    onGenerated: library.refresh,
    open,
    enabled: open && tab === "imagine",
    t,
    setItems,
    setHasSearched,
    setSelectedId,
    setError,
    setErrorCode,
    setStatusHint,
    setGalleryFilter,
    setKindFilter,
  });

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
    xBusy ||
    routeSaving ||
    provider.busy ||
    imagineController.busy ||
    (tab === "library" && (library.busy || library.loadingMore)) ||
    (tab === "grok_album" && grokAlbum.busy);
  const interactionLocked =
    (provider.busy && !provider.loadingMore) ||
    routeSaving ||
    (xBusy && !loadingMore) ||
    imagineController.busy ||
    applying ||
    previewingId !== null;
  const close = useCallback(() => {
    sourceGenerationRef.current += 1;
    viewer.close?.();
    void cancelX();
    void provider.cancel();
    cancelGrokAlbumMediaRequests();
    void cancelRemoteWallpaperMediaRequests().catch(() => {});
    imagineController.cancelAll();
    onClose();
  }, [
    cancelX,
    imagineController.cancelAll,
    onClose,
    provider.cancel,
    viewer,
  ]);
  useEffect(() => {
    if (!open || tab !== "x") void cancelX();
  }, [open, tab, cancelX]);
  useEffect(() => {
    sourceGenerationRef.current += 1;
    sourceHistory.clear();
    pendingHistoryRestore.current = null;
    pendingScrollRestore.current = null;
    setApplying(false);
    if (!open) return;
    setTab(initialTab);
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setCiteSummary(null);
    setSelectedId(null);
    setPreviewingId(null);
    setGalleryFilter("");
    setKindFilter("all");
    setLibraryPurpose("all");
    setHasSearched(false);
    setItems([]);
    setContinuation(null);
  }, [open, initialTab, sourceHistory.clear]);

  useEffect(
    () => () => {
      sourceGenerationRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (pendingHistoryRestore.current !== tab) return;
    const saved = sourceHistory.get(tab);
    if (saved?.providerContinuation) {
      provider.restore(saved.providerContinuation);
    }
    pendingHistoryRestore.current = null;
  }, [provider.restore, sourceHistory.get, tab]);

  useEffect(() => {
    if (!open || tab !== "library") return;
    setItems(library.items);
    setHasSearched(library.hasLoaded);
    setErrorCode(library.error);
    setError(library.error ? errorMessage(t, library.error) : null);
  }, [
    open,
    tab,
    library.items,
    library.hasLoaded,
    library.error,
    t,
  ]);

  useEffect(() => {
    if (!open || tab !== "grok_album") return;
    setItems((current) => {
      const previous = new Map(current.map((item) => [item.id, item]));
      return grokAlbum.items.map((item) => {
        const saved = previous.get(item.id);
        return saved?.localPath
          ? {
              ...item,
              localPath: saved.localPath,
              metadata: saved.metadata,
            }
          : item;
      });
    });
    setHasSearched(grokAlbum.hasSynced);
    setSelectedId((current) =>
      current && grokAlbum.items.some((item) => item.id === current)
        ? current
        : null,
    );
  }, [open, tab, grokAlbum.items, grokAlbum.hasSynced]);

  useEffect(() => {
    if (!open || tab !== "grok_album") return;
    const changed =
      albumHistoryRevision.current !== grokAlbum.historyRevision;
    albumHistoryRevision.current = grokAlbum.historyRevision;
    if (
      !changed &&
      (grokAlbum.status === "ready" || grokAlbum.status === "loading")
    ) {
      return;
    }
    sourceGenerationRef.current += 1;
    viewer.close?.();
    cancelGrokAlbumMediaRequests();
    setApplying(false);
    setPreviewingId(null);
    setStatusHint(null);
    // A revision can represent a different page or account. Do not carry a
    // materialized path from the previous authenticated album into it.
    setItems(grokAlbum.items);
    setGalleryFilter("");
    setKindFilter("all");
    setSelectedId(null);
    sourceHistory.clear("grok_album");
    if (sourceHistory.scrollRef.current) {
      sourceHistory.scrollRef.current.scrollTop = 0;
    }
    if (pendingScrollRestore.current?.tab === "grok_album") {
      pendingScrollRestore.current = null;
    }
  }, [
    grokAlbum.items,
    grokAlbum.historyRevision,
    grokAlbum.status,
    open,
    sourceHistory.clear,
    sourceHistory.scrollRef,
    tab,
    viewer.close,
  ]);

  const galleryItems =
    xBusy && !loadingMore && progressiveItems.length > 0
      ? progressiveItems
      : items;
  const kindCounts = useMemo(
    () =>
      tab === "library" ? library.kindCounts : countGalleryByKind(galleryItems),
    [galleryItems, library.kindCounts, tab],
  );

  const visibleItems = useMemo(
    () =>
      tab === "library"
        ? galleryItems
        : filterGalleryItems(galleryItems, {
            query: galleryFilter,
            kind: kindFilter,
          }),
    [galleryItems, galleryFilter, kindFilter, tab],
  );

  useLayoutEffect(() => {
    const pending = pendingScrollRestore.current;
    const scroller = sourceHistory.scrollRef.current;
    if (!open || !pending || pending.tab !== tab || !scroller) return;
    if (
      tab === "grok_album" &&
      (grokAlbum.status !== "ready" ||
        albumHistoryRevision.current !== grokAlbum.historyRevision ||
        items.length !== grokAlbum.items.length ||
        items.some((item, index) => item.id !== grokAlbum.items[index]?.id))
    ) {
      return;
    }
    if (
      tab === "library" &&
      (!library.hasLoaded || items !== library.items)
    ) {
      return;
    }
    if (busy && visibleItems.length === 0) return;
    scroller.scrollTop = pending.top;
    pendingScrollRestore.current = null;
  }, [
    busy,
    grokAlbum.historyRevision,
    grokAlbum.items,
    grokAlbum.status,
    items,
    library.hasLoaded,
    library.items,
    open,
    sourceHistory.scrollRef,
    tab,
    visibleItems.length,
  ]);

  const filtersActive =
    wallpaperGalleryHasActiveFilters({
      query: galleryFilter,
      kind: kindFilter,
    }) ||
    (tab === "library" && libraryPurpose !== "all");

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
      if (filtersActive) {
        return {
          ...base,
          kind: "filter_empty" as const,
          titleKey: "settings.wallpaperSource.empty.filterEmpty",
          hintKey: "settings.wallpaperSource.empty.filterEmptyHint",
          // The library filter row already offers this action.
          showClearFilters: false,
        };
      }
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
    filtersActive,
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
    setLibraryPurpose("all");
  }, []);

  const changeTab = useCallback(
    (nextTab: WallpaperSourceTab) => {
      if (nextTab === tab) return;
      sourceHistory.save(tab, {
        query,
        sort,
        items: galleryItems,
        selectedId,
        galleryFilter,
        kindFilter,
        libraryPurpose,
        hasSearched: hasSearched || galleryItems.length > 0,
        statusHint,
        citeSummary,
        xContinuation: continuation,
        providerContinuation: providerSource ? provider.capture() : null,
        scrollTop: sourceHistory.scrollRef.current?.scrollTop ?? 0,
      });
      const saved = sourceHistory.get(nextTab);
      pendingHistoryRestore.current = nextTab;
      pendingScrollRestore.current = {
        tab: nextTab,
        top: saved?.scrollTop ?? 0,
      };

      sourceGenerationRef.current += 1;
      viewer.close?.();
      void provider.cancel();
      cancelGrokAlbumMediaRequests();
      void cancelRemoteWallpaperMediaRequests().catch(() => {});
      if (tab === "imagine") imagineController.cancelAll();

      setTab(nextTab);
      setQuery(saved?.query ?? "");
      setSort(saved?.sort ?? "top");
      setItems(saved?.items ?? []);
      setHasSearched(saved?.hasSearched ?? false);
      setSelectedId(saved?.selectedId ?? null);
      setError(null);
      setErrorCode(null);
      setStatusHint(saved?.statusHint ?? null);
      setCiteSummary(saved?.citeSummary ?? null);
      setContinuation(saved?.xContinuation ?? null);
      setGalleryFilter(saved?.galleryFilter ?? "");
      setKindFilter(saved?.kindFilter ?? "all");
      setLibraryPurpose(saved?.libraryPurpose ?? "all");
    },
    [
      citeSummary,
      continuation,
      galleryFilter,
      galleryItems,
      hasSearched,
      kindFilter,
      imagineController.cancelAll,
      libraryPurpose,
      provider.cancel,
      provider.capture,
      providerSource,
      query,
      selectedId,
      sort,
      sourceHistory.get,
      sourceHistory.save,
      sourceHistory.scrollRef,
      statusHint,
      tab,
      viewer,
    ],
  );

  const selected = useMemo(
    () => visibleItems.find((i) => i.id === selectedId) ?? null,
    [visibleItems, selectedId],
  );

  const runProviderSearch = useCallback(() => {
    sourceGenerationRef.current += 1;
    viewer.close?.();
    void cancelRemoteWallpaperMediaRequests().catch(() => {});
    return provider.search();
  }, [provider.search, viewer]);

  const refreshGrokAlbum = useCallback(
    (sync: boolean) => {
      sourceGenerationRef.current += 1;
      viewer.close?.();
      cancelGrokAlbumMediaRequests();
      return sync ? grokAlbum.sync() : grokAlbum.refresh();
    },
    [grokAlbum.refresh, grokAlbum.sync, viewer],
  );

  const runXSearch = useCallback(async () => {
    if (xBusy || routeSaving) return;
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
    sourceGenerationRef.current += 1;
    viewer.close?.();
    cancelGrokAlbumMediaRequests();
    void cancelRemoteWallpaperMediaRequests().catch(() => {});
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
  }, [query, sort, t, searchX, viewer, xBusy, routeSaving]);

  const dropItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const loadLibrary = useCallback(async () => {
    library.refresh();
  }, [library.refresh]);

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
        library.remove(item.id);
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
    [busy, applying, previewingId, t, dropItem, library.remove],
  );

  const openItemPreview = useWallpaperItemPreview({
    interactionLocked,
    busyIds: mediaActions.busyIds,
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
  });

  const openExternalSource = useCallback((url: string) => {
    void api.openExternalUrl(url).catch(() => {
      /* soft-fail: citation open is best-effort */
    });
  }, []);

  const generateVideoFromItem = useCallback(
    (item: WallpaperGalleryItem) => {
      if (interactionLocked || !isWallpaperImageItem(item)) return;
      imagineController.beginVideoFromItem(item);
      if (tab !== "imagine") changeTab("imagine");
    },
    [
      changeTab,
      imagineController.beginVideoFromItem,
      interactionLocked,
      tab,
    ],
  );

  const editImageFromItem = useCallback(
    (item: WallpaperGalleryItem) => {
      if (interactionLocked || !isWallpaperImageItem(item)) return;
      imagineController.beginEditFromItem(item);
      if (tab !== "imagine") changeTab("imagine");
    },
    [
      changeTab,
      imagineController.beginEditFromItem,
      interactionLocked,
      tab,
    ],
  );

  const applySelected = useCallback(async () => {
    if (!selected || mediaActions.busyIds.has(selected.id)) return;
    if (!isDesktopHost()) {
      setErrorCode("generic");
      setError(t("settings.wallpaperSource.err.desktopOnly"));
      return;
    }
    const sourceGeneration = sourceGenerationRef.current;
    setApplying(true);
    setError(null);
    setErrorCode(null);
    setStatusHint(t("settings.wallpaperSource.applying"));
    try {
      const local = await ensureLocalWallpaperMedia(selected);
      if (sourceGeneration !== sourceGenerationRef.current) return;
      // Local evidence ring for X picks only (path + status url meta; no cloud).
      if ((selected.source || "x") === "x") {
        const pick = wallpaperXEvidenceFromGalleryItem(selected, local.path);
        if (pick) recordWallpaperXEvidencePick(pick);
      }
      const file = await fileFromAbsolutePath(local.path, {
        name: local.name,
        mime: local.mime,
      });
      if (sourceGeneration !== sourceGenerationRef.current) return;
      await onPickFile(file);
      if (sourceGeneration !== sourceGenerationRef.current) return;
      onClose();
    } catch (e) {
      if (sourceGeneration !== sourceGenerationRef.current) return;
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
      if (sourceGeneration === sourceGenerationRef.current) {
        setApplying(false);
        setStatusHint(null);
      }
    }
  }, [selected, t, onPickFile, onClose, mediaActions.busyIds]);

  const runLoadMore = useCallback(async () => {
    if (!continuation || xBusy || applying || routeSaving) return;
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
  }, [continuation, xBusy, applying, routeSaving, searchMore, t]);

  const closeModalLayer = useCallback(() => {
    if (viewer.isOpen?.()) {
      viewer.close?.();
      return;
    }
    close();
  }, [close, viewer]);

  const authNeeded = errorCode === "auth_required";
  const locked = busy || applying || previewingId !== null;
  const showGalleryFilters =
    tab === "library" || galleryItems.length > 0 || filtersActive;
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
        onClose={closeModalLayer}
        title={t("settings.wallpaperSource.title")}
        size="lg"
        className="wallpaper-source-modal"
        wrapBody
        bodyClassName="wallpaper-source-modal__body"
        closeLabel={t("common.close")}
        footer={
          <WallpaperSourceFooter
            t={t}
            applying={applying}
            applyDisabled={
              selected === null ||
              interactionLocked ||
              (selected !== null && mediaActions.busyIds.has(selected.id))
            }
            onClose={close}
            onApply={() => void applySelected()}
          />
        }
      >
        <WallpaperSourceTabs
          t={t}
          value={tab}
          disabled={applying || previewingId !== null}
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
              search={runProviderSearch}
              cancel={provider.cancel}
              onSaved={() => {
                sourceGenerationRef.current += 1;
                viewer.close?.();
                void cancelRemoteWallpaperMediaRequests().catch(() => {});
                sourceHistory.clear("pexels");
                void provider.clear();
                setItems([]);
                setHasSearched(false);
                setSelectedId(null);
                setGalleryFilter("");
                setKindFilter("all");
                setError(null);
                setErrorCode(null);
                setStatusHint(null);
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
                void refreshGrokAlbum(true);
              }}
              onRefresh={() => {
                void refreshGrokAlbum(false);
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
              imagine={imagineController.controls}
              busy={busy}
              xBusy={xBusy}
              locked={locked}
              setQuery={setQuery}
              setSort={setSort}
              runXSearch={runXSearch}
              cancelXSearch={cancelX}
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
            <div
              className={
                "wallpaper-source-filters" +
                (tab === "library" ? " wallpaper-library-toolbar" : "")
              }
            >
              {tab === "library" ? (
                <Select
                  className="wallpaper-library-toolbar__collection"
                  value={libraryPurpose}
                  options={(
                    ["all", "favorites", "generated", "cache"] as const
                  ).map((value) => ({
                    value,
                    label: t(
                      `settings.wallpaperSource.library.${value}` as MessageKey,
                    ),
                  }))}
                  onChange={(value) =>
                    setLibraryPurpose(value as WallpaperLibraryPurpose)
                  }
                  aria-label={t(
                    "settings.wallpaperSource.library.collection" as MessageKey,
                  )}
                  disabled={locked}
                />
              ) : null}
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
              disabled={xBusy || applying || routeSaving}
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
          {tab === "library" && library.canLoadMore ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={library.loadingMore || applying}
              onClick={() => {
                void library.loadMore();
              }}
            >
              {t(
                library.loadingMore
                  ? "settings.wallpaperSource.remote.progress.loadingMore"
                  : "settings.wallpaperSource.loadMore",
              )}
            </button>
          ) : null}
          <WallpaperSourceGallery
            scrollRef={sourceHistory.scrollRef}
            favoriteBusyIds={mediaActions.busyIds}
            onToggleFavorite={(item) => {
              void mediaActions.toggleFavorite(item);
            }}
            onReusePrompt={(item) => {
              if (interactionLocked) return;
              imagineController.reuseImagePrompt(item);
              if (tab !== "imagine") changeTab("imagine");
            }}
            onGenerateVideo={generateVideoFromItem}
            onEditImage={editImageFromItem}
            t={t}
            tab={tab}
            busy={busy}
            locked={interactionLocked}
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
