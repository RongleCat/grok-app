import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api";
import {
  GROK_ALBUM_PAGE_SIZE,
  grokAlbumItemsToGallery,
  nextGrokAlbumVisibleCount,
  parseGrokAlbumError,
  type GrokAlbumErrorCode,
  type GrokAlbumSnapshot,
} from "@/lib/grokAlbum";
import {
  clearGrokAlbumThumbnailCache,
  warmGrokAlbumThumbnails,
} from "@/lib/grokAlbumThumbnail";
import { cancelGrokAlbumMediaRequests } from "@/lib/grokAlbumMedia";

const EMPTY_SNAPSHOT: GrokAlbumSnapshot = {
  status: "closed",
  items: [],
  total: 0,
  canLoadMore: false,
  newItems: 0,
  prefetchSkipped: false,
  pageChanged: false,
};

const POLL_MS = 1_800;
const PREFETCH_DELAY_MS = 450;
const PREFETCH_RETRY_MS = 5_000;

type GrokAlbumOperation =
  | "opening"
  | "syncing"
  | "refreshing"
  | "loading_more";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Grok Imagine saved-album state.
 *
 * The hook reveals cached items in 20-item increments and keeps one additional
 * 20-item page warm when the official album window is not focused. Authentication
 * and request signing remain entirely inside that WebView.
 */
export function useWallpaperGrokAlbum(enabled: boolean, modalOpen = true) {
  const [snapshot, setSnapshot] =
    useState<GrokAlbumSnapshot>(EMPTY_SNAPSHOT);
  const [visibleCount, setVisibleCount] = useState(GROK_ALBUM_PAGE_SIZE);
  const [operation, setOperation] = useState<GrokAlbumOperation | null>(null);
  const [hasSynced, setHasSynced] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [errorCode, setErrorCode] = useState<GrokAlbumErrorCode | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const syncInFlightRef = useRef<number | null>(null);
  const prefetchInFlightRef = useRef<number | null>(null);
  const loadMoreInFlightRef = useRef<{
    generation: number;
    backgroundOnly: boolean;
    promise: Promise<GrokAlbumSnapshot>;
  } | null>(null);
  const lastPrefetchAttemptRef = useRef(0);
  const prefetchPausedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const previousEnabledRef = useRef(enabled);
  const generationRef = useRef(0);
  const observedGenerationRef = useRef(enabled ? -1 : 0);
  const initialSignInGenerationRef = useRef<number | null>(null);
  if (previousEnabledRef.current !== enabled) {
    previousEnabledRef.current = enabled;
    generationRef.current += 1;
  }
  enabledRef.current = enabled;

  const acceptSnapshot = useCallback(
    (next: GrokAlbumSnapshot, generation: number): boolean => {
      if (!enabledRef.current || generation !== generationRef.current) {
        return false;
      }
      const awaitingInitialSnapshot =
        observedGenerationRef.current !== generation;
      if (
        awaitingInitialSnapshot &&
        next.status === "sign_in" &&
        initialSignInGenerationRef.current !== generation
      ) {
        initialSignInGenerationRef.current = generation;
        setSnapshot({ ...EMPTY_SNAPSHOT, status: "loading" });
        return false;
      }
      initialSignInGenerationRef.current = null;
      observedGenerationRef.current = generation;
      if (next.pageChanged || (next.status !== "ready" && next.status !== "loading")) {
        setHistoryRevision((value) => value + 1);
      }
      if (next.pageChanged) {
        clearGrokAlbumThumbnailCache();
        cancelGrokAlbumMediaRequests();
        setVisibleCount(GROK_ALBUM_PAGE_SIZE);
        setExhausted(false);
        prefetchPausedRef.current = false;
        lastPrefetchAttemptRef.current = 0;
      }
      setSnapshot(next);
      if (next.status === "ready") {
        setHasSynced(true);
      } else {
        clearGrokAlbumThumbnailCache();
        cancelGrokAlbumMediaRequests();
        setHasSynced(false);
        if (next.status !== "loading") setVisibleCount(GROK_ALBUM_PAGE_SIZE);
        setExhausted(false);
        prefetchPausedRef.current = false;
      }
      if (next.newItems > 0) {
        setExhausted(false);
        prefetchPausedRef.current = false;
      }
      setErrorCode(null);
      return true;
    },
    [],
  );

  const sync = useCallback(
    async (quiet = false): Promise<GrokAlbumSnapshot | null> => {
      const generation = generationRef.current;
      if (!enabledRef.current) return null;
      if (!isDesktopHost()) {
        if (!quiet) setErrorCode("desktop_only");
        return null;
      }
      const pendingLoadMore =
        loadMoreInFlightRef.current?.generation === generation
          ? loadMoreInFlightRef.current.promise
          : null;
      if (pendingLoadMore && quiet) return null;
      if (syncInFlightRef.current === generation) return null;
      syncInFlightRef.current = generation;
      if (!quiet) setOperation("syncing");
      try {
        const next = pendingLoadMore
          ? await pendingLoadMore
          : await api.wallpaperGrokAlbumSnapshot();
        return acceptSnapshot(next, generation) ? next : null;
      } catch (err) {
        if (enabledRef.current && generation === generationRef.current) {
          const awaitingInitialSnapshot =
            observedGenerationRef.current !== generation;
          if (!quiet || awaitingInitialSnapshot) {
            setErrorCode(parseGrokAlbumError(err));
          }
          if (awaitingInitialSnapshot) {
            initialSignInGenerationRef.current = null;
            observedGenerationRef.current = generation;
            setSnapshot({ ...EMPTY_SNAPSHOT });
          }
        }
        return null;
      } finally {
        if (syncInFlightRef.current === generation) {
          syncInFlightRef.current = null;
        }
        if (!quiet && generation === generationRef.current) setOperation(null);
      }
    },
    [acceptSnapshot],
  );

  const open = useCallback(
    async (title: string): Promise<void> => {
      const generation = generationRef.current;
      if (!isDesktopHost()) {
        setErrorCode("desktop_only");
        return;
      }
      setOperation("opening");
      setErrorCode(null);
      try {
        await api.wallpaperGrokAlbumOpen(title);
        await delay(250);
        if (generation !== generationRef.current || !enabledRef.current) return;
        await sync(true);
      } catch (err) {
        if (generation === generationRef.current && enabledRef.current) {
          setErrorCode(parseGrokAlbumError(err));
        }
      } finally {
        if (generation === generationRef.current) setOperation(null);
      }
    },
    [sync],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    if (!isDesktopHost()) {
      setErrorCode("desktop_only");
      return;
    }
    setOperation("refreshing");
    setErrorCode(null);
    setVisibleCount(GROK_ALBUM_PAGE_SIZE);
    setExhausted(false);
    setHasSynced(false);
    prefetchPausedRef.current = false;
    lastPrefetchAttemptRef.current = 0;
    try {
      await api.wallpaperGrokAlbumRefresh();
      if (generation !== generationRef.current || !enabledRef.current) return;
      setSnapshot({ ...EMPTY_SNAPSHOT, status: "loading" });
      await delay(250);
      await sync(true);
    } catch (err) {
      if (generation === generationRef.current && enabledRef.current) {
        setErrorCode(parseGrokAlbumError(err));
      }
    } finally {
      if (generation === generationRef.current) setOperation(null);
    }
  }, [sync]);

  const allItems = useMemo(
    () =>
      snapshot.status === "ready"
        ? grokAlbumItemsToGallery(snapshot.items)
        : [],
    [snapshot.items, snapshot.status],
  );
  const items = useMemo(
    () => allItems.slice(0, visibleCount),
    [allItems, visibleCount],
  );

  const requestLoadMore = useCallback(
    (
      backgroundOnly: boolean,
      generation: number,
    ): Promise<GrokAlbumSnapshot> => {
      const existing = loadMoreInFlightRef.current;
      if (existing?.generation === generation) return existing.promise;
      const request = api
        .wallpaperGrokAlbumLoadMore(backgroundOnly)
        .finally(() => {
          if (loadMoreInFlightRef.current?.promise === request) {
            loadMoreInFlightRef.current = null;
          }
        });
      loadMoreInFlightRef.current = {
        generation,
        backgroundOnly,
        promise: request,
      };
      return request;
    },
    [],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    const target = visibleCount + GROK_ALBUM_PAGE_SIZE;
    if (allItems.length >= target) {
      prefetchPausedRef.current = false;
      setVisibleCount(target);
      return;
    }
    if (!snapshot.canLoadMore || exhausted) {
      setVisibleCount((current) =>
        nextGrokAlbumVisibleCount({
          current,
          available: allItems.length,
        }),
      );
      return;
    }
    setOperation("loading_more");
    setErrorCode(null);
    prefetchPausedRef.current = false;
    try {
      const reusedBackgroundWarmup =
        loadMoreInFlightRef.current?.generation === generation &&
        loadMoreInFlightRef.current.backgroundOnly;
      let next: GrokAlbumSnapshot;
      try {
        next = await requestLoadMore(false, generation);
      } catch (error) {
        // A rejected hidden warmup is not the user's foreground attempt. Once
        // the rejected promise has cleared its in-flight slot, retry the
        // explicit request exactly once; its own failure remains visible.
        if (
          !reusedBackgroundWarmup ||
          generation !== generationRef.current ||
          !enabledRef.current
        ) {
          throw error;
        }
        next = await requestLoadMore(false, generation);
      }
      // A foreground click can race the one-page-ahead warmup and reuse its
      // promise. Retry once as the explicit foreground action when Host either
      // skipped that background scroll or found no page while it still reports
      // that more content may exist.
      const warmupAvailable = grokAlbumItemsToGallery(next.items).length;
      if (
        next.prefetchSkipped ||
        (reusedBackgroundWarmup &&
          next.canLoadMore &&
          next.newItems === 0 &&
          warmupAvailable < target)
      ) {
        next = await requestLoadMore(false, generation);
      }
      if (next.prefetchSkipped) return;
      if (!acceptSnapshot(next, generation)) return;
      const available = grokAlbumItemsToGallery(next.items).length;
      setVisibleCount(Math.min(target, available));
      if (next.newItems === 0 && available < target) setExhausted(true);
    } catch (err) {
      if (generation === generationRef.current && enabledRef.current) {
        setErrorCode(parseGrokAlbumError(err));
      }
    } finally {
      if (generation === generationRef.current) setOperation(null);
    }
  }, [
    acceptSnapshot,
    allItems.length,
    exhausted,
    requestLoadMore,
    snapshot.canLoadMore,
    visibleCount,
  ]);

  const prefetch = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    const shown = Math.min(visibleCount, allItems.length);
    const warmTarget = shown + GROK_ALBUM_PAGE_SIZE;
    if (
      !enabled ||
      snapshot.status !== "ready" ||
      !snapshot.canLoadMore ||
      exhausted ||
      allItems.length >= warmTarget ||
      prefetchPausedRef.current ||
      prefetchInFlightRef.current === generation ||
      loadMoreInFlightRef.current?.generation === generation
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastPrefetchAttemptRef.current < PREFETCH_RETRY_MS) return;
    lastPrefetchAttemptRef.current = now;
    prefetchInFlightRef.current = generation;
    try {
      const next = await requestLoadMore(true, generation);
      if (!next.prefetchSkipped) {
        if (!acceptSnapshot(next, generation)) return;
        const available = grokAlbumItemsToGallery(next.items).length;
        if (next.newItems === 0 && available < warmTarget) {
          // Four Host-side scroll attempts produced no next page. Stop
          // repeatedly disturbing the official page in the background; an
          // explicit Load more remains a fresh retry.
          prefetchPausedRef.current = true;
        }
      }
    } catch {
      // Background warming is optional and never replaces an explicit error.
    } finally {
      if (prefetchInFlightRef.current === generation) {
        prefetchInFlightRef.current = null;
      }
    }
  }, [
    acceptSnapshot,
    allItems.length,
    enabled,
    exhausted,
    requestLoadMore,
    snapshot.canLoadMore,
    snapshot.status,
    visibleCount,
  ]);

  useEffect(() => {
    // StrictMode replays effect cleanup/setup without rerendering. Restore the
    // lifecycle ref before the replayed sync so cleanup cannot permanently
    // disable the hook.
    enabledRef.current = enabled;
    if (!enabled) {
      observedGenerationRef.current = generationRef.current;
      clearGrokAlbumThumbnailCache();
      cancelGrokAlbumMediaRequests();
      setSnapshot(EMPTY_SNAPSHOT);
      if (!modalOpen) setVisibleCount(GROK_ALBUM_PAGE_SIZE);
      setHasSynced(false);
      setExhausted(false);
      setOperation(null);
      setErrorCode(null);
      syncInFlightRef.current = null;
      prefetchInFlightRef.current = null;
      loadMoreInFlightRef.current = null;
      initialSignInGenerationRef.current = null;
      prefetchPausedRef.current = false;
      lastPrefetchAttemptRef.current = 0;
      return;
    }
    void sync(true);
  }, [enabled, modalOpen, sync]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      generationRef.current += 1;
      syncInFlightRef.current = null;
      prefetchInFlightRef.current = null;
      loadMoreInFlightRef.current = null;
      initialSignInGenerationRef.current = null;
      clearGrokAlbumThumbnailCache();
      cancelGrokAlbumMediaRequests();
    },
    [],
  );

  useEffect(() => {
    if (!enabled || snapshot.status === "closed") return;
    const timer = window.setInterval(() => void sync(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, snapshot.status, sync]);

  useEffect(() => {
    if (!enabled || snapshot.status !== "ready") return;
    const warm = () => void prefetch();
    const first = window.setTimeout(warm, PREFETCH_DELAY_MS);
    const retry = window.setInterval(warm, PREFETCH_RETRY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(retry);
    };
  }, [enabled, prefetch, snapshot.status]);

  useEffect(() => {
    if (!enabled || snapshot.status !== "ready" || allItems.length === 0) {
      return;
    }
    const warmThrough = visibleCount + GROK_ALBUM_PAGE_SIZE;
    const urls = allItems
      .slice(0, warmThrough)
      .map((item) => item.thumbUrl || item.fullUrl);
    void warmGrokAlbumThumbnails(urls);
  }, [allItems, enabled, snapshot.status, visibleCount]);

  const initializing =
    enabled && observedGenerationRef.current !== generationRef.current;
  const busy = operation !== null || initializing;

  return {
    historyRevision,
    status: !enabled ? "closed" : initializing ? "loading" : snapshot.status,
    items,
    cachedCount: allItems.length,
    visibleCount: items.length,
    busy,
    syncing: operation === "syncing" || operation === "refreshing",
    loadingMore: operation === "loading_more",
    hasSynced,
    errorCode,
    canLoadMore:
      allItems.length > items.length || (!exhausted && snapshot.canLoadMore),
    open,
    refresh,
    sync,
    loadMore,
  };
}
