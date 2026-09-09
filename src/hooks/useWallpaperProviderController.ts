import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useWallpaperRemoteSearch } from "./useWallpaperRemoteSearch";
import {
  appendWallpaperGalleryItems,
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";
import {
  wallpaperRemoteUiError,
  type WallpaperRemoteSearchResult,
  type WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";
import type { MessageKey } from "@/i18n";

export type WallpaperProviderBackgroundProgress = {
  source: WallpaperRemoteSource;
  query: string;
  items: WallpaperGalleryItem[];
};

export type WallpaperProviderBackgroundResult = {
  source: WallpaperRemoteSource;
  query: string;
  phase: "search" | "loadMore";
  result: WallpaperRemoteSearchResult | null;
  error: unknown | null;
  /** Pagination state produced by this background operation, when available. */
  providerContinuation?: WallpaperProviderContinuationState;
};

export type WallpaperProviderBackgroundState = {
  source: WallpaperRemoteSource;
  query: string;
  state: WallpaperProviderContinuationState;
};

type Options = {
  enabled: boolean;
  source: WallpaperRemoteSource | null;
  query: string;
  items: WallpaperGalleryItem[];
  t: (
    key: MessageKey,
    vars?: Record<string, string | number | undefined | null>,
  ) => string;
  setItems: Dispatch<SetStateAction<WallpaperGalleryItem[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setErrorCode: Dispatch<SetStateAction<WallpaperSourceErrorCode | null>>;
  setStatusHint: Dispatch<SetStateAction<string | null>>;
  setHasSearched: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  /** Return true when results for a source should update the visible panel. */
  isSourceVisible?: (source: WallpaperRemoteSource) => boolean;
  /** Receive progressive/result updates while their source is in the background. */
  onBackgroundProgress?: (event: WallpaperProviderBackgroundProgress) => void;
  onBackgroundResult?: (event: WallpaperProviderBackgroundResult) => void;
  /** Receive a completed prefetch state while its source is in the background. */
  onBackgroundState?: (event: WallpaperProviderBackgroundState) => void;
};

type Continuation = {
  source: WallpaperRemoteSource;
  query: string;
};

type PrefetchOutcome = {
  continuation: Continuation;
  result: WallpaperRemoteSearchResult | null;
  error: unknown | null;
};

export type WallpaperProviderContinuationState = {
  continuation: Continuation | null;
  prefetched: PrefetchOutcome | null;
};

function sameContinuation(
  left: Continuation,
  right: Continuation,
): boolean {
  return left.source === right.source && left.query === right.query;
}

export function useWallpaperProviderController({
  enabled,
  source,
  query,
  items,
  t,
  setItems,
  setError,
  setErrorCode,
  setStatusHint,
  setHasSearched,
  setSelectedId,
  isSourceVisible: isSourceVisibleProp,
  onBackgroundProgress,
  onBackgroundResult,
  onBackgroundState,
}: Options) {
  const remote = useWallpaperRemoteSearch();
  const generation = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const continuationRef = useRef<Continuation | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadingMoreSourceRef = useRef<WallpaperRemoteSource | null>(null);
  const [prefetching, setPrefetching] = useState(false);
  const prefetchingRef = useRef(false);
  const prefetchGeneration = useRef(0);
  const prefetchOutcome = useRef<PrefetchOutcome | null>(null);
  const prefetchPromise = useRef<Promise<PrefetchOutcome | null> | null>(null);
  const prefetchTarget = useRef<Continuation | null>(null);
  const progressiveSeen = useRef(new Set<string>());
  const activeQuery = useRef<string | null>(null);
  const normalized = query.trim().replace(/\s+/g, " ");
  const previousInput = useRef({ source, normalized });
  const currentInput = useRef({ enabled, source });
  currentInput.current = { enabled, source };
  const defaultIsSourceVisible = useCallback(
    (candidate: WallpaperRemoteSource) =>
      currentInput.current.enabled && currentInput.current.source === candidate,
    [],
  );
  const isSourceVisible = isSourceVisibleProp ?? defaultIsSourceVisible;

  const updateContinuation = useCallback((next: Continuation | null) => {
    continuationRef.current = next;
    setContinuation(next);
  }, []);

  const discardPrefetch = useCallback(() => {
    prefetchGeneration.current += 1;
    prefetchingRef.current = false;
    prefetchOutcome.current = null;
    prefetchPromise.current = null;
    prefetchTarget.current = null;
    setPrefetching(false);
  }, []);

  const startPrefetch = useCallback(
    (next: Continuation) => {
      const revision = prefetchGeneration.current + 1;
      prefetchGeneration.current = revision;
      prefetchingRef.current = true;
      prefetchOutcome.current = null;
      prefetchTarget.current = next;
      activeQuery.current = next.query;
      setPrefetching(true);

      let task: Promise<PrefetchOutcome | null>;
      task = remote
        .loadMore(next.source, next.query)
        .then(
          (result): PrefetchOutcome | null => {
            if (prefetchGeneration.current !== revision) return null;
            const outcome = {
              continuation: next,
              result,
              error: null,
            } satisfies PrefetchOutcome;
            if (
              continuationRef.current &&
              sameContinuation(continuationRef.current, next)
            ) {
              prefetchOutcome.current = outcome;
            }
            onBackgroundState?.({
              source: next.source,
              query: next.query,
              state: { continuation: next, prefetched: outcome },
            });
            return outcome;
          },
          (error): PrefetchOutcome | null => {
            if (prefetchGeneration.current !== revision) return null;
            const outcome = {
              continuation: next,
              result: null,
              error,
            } satisfies PrefetchOutcome;
            if (
              continuationRef.current &&
              sameContinuation(continuationRef.current, next)
            ) {
              prefetchOutcome.current = outcome;
            }
            onBackgroundState?.({
              source: next.source,
              query: next.query,
              state: { continuation: next, prefetched: outcome },
            });
            return outcome;
          },
        )
        .finally(() => {
          if (prefetchGeneration.current !== revision) return;
          if (prefetchPromise.current !== task) return;
          prefetchingRef.current = false;
          prefetchPromise.current = null;
          prefetchTarget.current = null;
          setPrefetching(false);
        });
      prefetchPromise.current = task;
    },
    [onBackgroundState, remote.loadMore],
  );

  const cancel = useCallback(async () => {
    generation.current += 1;
    loadingMoreRef.current = false;
    loadingMoreSourceRef.current = null;
    setLoadingMore(false);
    discardPrefetch();
    progressiveSeen.current.clear();
    activeQuery.current = null;
    updateContinuation(null);
    return remote.cancel();
  }, [discardPrefetch, remote.cancel, updateContinuation]);

  const capture = useCallback(
    (): WallpaperProviderContinuationState => {
      const active = continuationRef.current;
      const prefetched = prefetchOutcome.current;
      return {
        continuation: active,
        prefetched:
          active && prefetched && sameContinuation(prefetched.continuation, active)
            ? prefetched
            : null,
      };
    },
    [],
  );

  const restore = useCallback(
    (state: WallpaperProviderContinuationState) => {
      // Switching tabs restores only that source's pagination snapshot. Any
      // in-flight request keeps its own source ownership until it completes.
      updateContinuation(state.continuation);
      prefetchOutcome.current = state.prefetched;
      progressiveSeen.current.clear();
    },
    [updateContinuation],
  );

  const clear = useCallback(() => {
    updateContinuation(null);
    return cancel();
  }, [cancel, updateContinuation]);

  useEffect(() => {
    const previous = previousInput.current;
    // A query edit invalidates the old continuation/prefetch. A source change
    // is usually just a tab switch, so leave its foreground request running.
    if (
      source !== null &&
      previous.source === source &&
      previous.normalized !== normalized
    ) {
      const ownsRemoteRequest = remote.source === source;
      if (ownsRemoteRequest) generation.current += 1;
      if (loadingMoreSourceRef.current === source) {
        loadingMoreRef.current = false;
        loadingMoreSourceRef.current = null;
        setLoadingMore(false);
      }
      if (prefetchTarget.current?.source === source) {
        discardPrefetch();
      } else {
        prefetchOutcome.current = null;
      }
      updateContinuation(null);
      if (ownsRemoteRequest) {
        activeQuery.current = null;
        void remote.cancel();
      }
    }
    previousInput.current = { source, normalized };
  }, [
    discardPrefetch,
    normalized,
    remote.cancel,
    remote.source,
    source,
    updateContinuation,
  ]);

  useEffect(() => {
    const activeSource = remote.source;
    if (!activeSource) {
      return;
    }
    if (remote.progressiveItems.length === 0) {
      progressiveSeen.current.clear();
      return;
    }
    const fresh = remote.progressiveItems.filter((item) => {
      const key = `${item.source}:${item.id}:${item.fullUrl}`;
      if (progressiveSeen.current.has(key)) return false;
      progressiveSeen.current.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    // A prefetched page must stay hidden until the user requests it, including
    // while its source tab is in the background.
    if (prefetchingRef.current) return;
    const activeQueryValue =
      activeQuery.current ?? continuationRef.current?.query ?? normalized;
    if (!isSourceVisible(activeSource)) {
      onBackgroundProgress?.({
        source: activeSource,
        query: activeQueryValue,
        items: fresh,
      });
      return;
    }
    if (activeSource !== source) return;
    setHasSearched(true);
    setItems((current) =>
      loadingMoreSourceRef.current === activeSource
        ? appendWallpaperGalleryItems(current, fresh)
        : appendWallpaperGalleryItems([], fresh),
    );
  }, [
    enabled,
    isSourceVisible,
    loadingMore,
    normalized,
    onBackgroundProgress,
    prefetching,
    remote.progressiveItems,
    remote.source,
    setHasSearched,
    setItems,
    source,
  ]);

  const search = useCallback(async () => {
    if (
      !enabled ||
      !source ||
      !normalized ||
      (loadingMoreRef.current &&
        loadingMoreSourceRef.current === source) ||
      (remote.busy && remote.source === source && !prefetchingRef.current)
    ) {
      return;
    }
    const revision = ++generation.current;
    discardPrefetch();
    progressiveSeen.current.clear();
    loadingMoreRef.current = false;
    loadingMoreSourceRef.current = null;
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setLoadingMore(false);
    setItems([]);
    setSelectedId(null);
    setHasSearched(false);
    updateContinuation(null);
    activeQuery.current = normalized;
    try {
      const result = await remote.search(source, normalized);
      if (!result || revision !== generation.current) return;
      const code = wallpaperRemoteUiError(result);
      const nextContinuation = result.hasMore
        ? { source, query: normalized }
        : null;
      if (!isSourceVisible(source)) {
        onBackgroundResult?.({
          source,
          query: normalized,
          phase: "search",
          result,
          error: null,
          providerContinuation: {
            continuation: nextContinuation,
            prefetched: null,
          },
        });
        return;
      }
      updateContinuation(nextContinuation);
      setHasSearched(true);
      if (code && code !== "empty") {
        setErrorCode(code);
        setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
        setStatusHint(null);
        return;
      }
      const nextItems = appendWallpaperGalleryItems([], result.items);
      setItems(nextItems);
      if (code === "empty") {
        setErrorCode("empty");
        setError(t("settings.wallpaperSource.err.empty"));
        setStatusHint(null);
        return;
      }
      setStatusHint(
        t(
          result.cacheHit
            ? "settings.wallpaperSource.remote.completeCached"
            : "settings.wallpaperSource.remote.complete",
          {
            count: nextItems.length,
            seconds: (result.durationMs / 1000).toFixed(1),
          },
        ),
      );
      if (nextContinuation) startPrefetch(nextContinuation);
    } catch (error) {
      if (revision !== generation.current) return;
      if (!isSourceVisible(source)) {
        onBackgroundResult?.({
          source,
          query: normalized,
          phase: "search",
          result: null,
          error,
        });
        return;
      }
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
      setStatusHint(null);
    }
  }, [
    discardPrefetch,
    enabled,
    isSourceVisible,
    normalized,
    onBackgroundResult,
    remote.busy,
    remote.search,
    setError,
    setErrorCode,
    setHasSearched,
    setItems,
    setSelectedId,
    setStatusHint,
    source,
    startPrefetch,
    t,
    updateContinuation,
  ]);

  const loadMore = useCallback(async () => {
    const active = continuationRef.current;
    if (
      !enabled ||
      !source ||
      !active ||
      active.source !== source ||
      active.query !== normalized ||
      (loadingMoreRef.current &&
        loadingMoreSourceRef.current === source) ||
      (remote.busy && remote.source === source && !prefetchingRef.current)
    ) {
      return;
    }
    let revision = generation.current;
    if (remote.busy && remote.source !== active.source) {
      revision = ++generation.current;
      activeQuery.current = null;
      void remote.cancel();
    }
    const initialItems = itemsRef.current;
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    progressiveSeen.current.clear();
    activeQuery.current = active.query;
    loadingMoreRef.current = true;
    loadingMoreSourceRef.current = active.source;
    setLoadingMore(true);
    try {
      let prefetched = prefetchOutcome.current;
      if (
        !prefetched &&
        prefetchTarget.current &&
        !sameContinuation(prefetchTarget.current, active)
      ) {
        discardPrefetch();
      }
      const prefetchRevision = prefetchGeneration.current;
      if (
        !prefetched &&
        prefetchPromise.current &&
        prefetchTarget.current &&
        sameContinuation(prefetchTarget.current, active)
      ) {
        prefetched = await prefetchPromise.current;
      }
      if (
        revision !== generation.current ||
        prefetchRevision !== prefetchGeneration.current ||
        (isSourceVisible(active.source) &&
          (!continuationRef.current ||
            !sameContinuation(continuationRef.current, active)))
      ) {
        return;
      }
      if (
        prefetched &&
        !sameContinuation(prefetched.continuation, active)
      ) {
        prefetched = null;
      }
      if (prefetched) prefetchOutcome.current = null;

      const prefetchedCode = prefetched?.result
        ? wallpaperRemoteUiError(prefetched.result)
        : null;
      if (
        prefetched?.error ||
        (prefetchedCode !== null && prefetchedCode !== "empty")
      ) {
        prefetched = null;
      }
      let result = prefetched?.result ?? null;
      if (!result) {
        activeQuery.current = active.query;
        result = await remote.loadMore(active.source, active.query);
      }
      if (!result || revision !== generation.current) return;
      const code = wallpaperRemoteUiError(result);
      // A provider error did not consume the page, even when its transport
      // envelope cannot truthfully advertise hasMore. Keep the cursor so the
      // user can retry the same page.
      const nextContinuation =
        code && code !== "empty" ? active : result.hasMore ? active : null;
      if (!isSourceVisible(active.source)) {
        onBackgroundResult?.({
          source: active.source,
          query: active.query,
          phase: "loadMore",
          result,
          error: null,
          providerContinuation: {
            continuation: nextContinuation,
            prefetched: null,
          },
        });
        return;
      }
      if (
        !continuationRef.current ||
        !sameContinuation(continuationRef.current, active)
      ) {
        return;
      }
      updateContinuation(nextContinuation);
      setHasSearched(true);
      if (code && code !== "empty") {
        setErrorCode(code);
        setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
        setStatusHint(null);
        return;
      }
      const nextItems = appendWallpaperGalleryItems(initialItems, result.items);
      setItems(nextItems);
      if (code === "empty") {
        if (result.hasMore) {
          setErrorCode("empty");
          setError(t("settings.wallpaperSource.err.empty"));
          setStatusHint(null);
        } else {
          setStatusHint(t("settings.wallpaperSource.noMore"));
        }
        return;
      }
      setStatusHint(
        t("settings.wallpaperSource.remote.loadedMore", {
          count: result.items.length,
          total: nextItems.length,
        }),
      );
      if (nextContinuation) startPrefetch(nextContinuation);
    } catch (error) {
      if (revision !== generation.current) return;
      if (!isSourceVisible(active.source)) {
        onBackgroundResult?.({
          source: active.source,
          query: active.query,
          phase: "loadMore",
          result: null,
          error,
        });
        return;
      }
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
      setStatusHint(null);
    } finally {
      if (revision === generation.current) {
        loadingMoreRef.current = false;
        loadingMoreSourceRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [
    enabled,
    isSourceVisible,
    normalized,
    onBackgroundResult,
    remote.busy,
    remote.loadMore,
    setError,
    setErrorCode,
    setHasSearched,
    setItems,
    setStatusHint,
    source,
    startPrefetch,
    t,
    updateContinuation,
  ]);

  const canLoadMore =
    continuation?.source === source && continuation.query === normalized;

  return {
    busy:
      (source !== null &&
        isSourceVisible(source) &&
        loadingMore &&
        loadingMoreSourceRef.current === source) ||
      (source !== null &&
        isSourceVisible(source) &&
        remote.busy &&
        remote.source === source &&
        !prefetching),
    loadingMore:
      source !== null && loadingMoreSourceRef.current === source
        ? loadingMore
        : false,
    cancel,
    capture,
    restore,
    clear,
    search,
    loadMore,
    canLoadMore,
    stage:
      source !== null &&
      isSourceVisible(source) &&
      remote.source === source
        ? prefetching && !loadingMore
          ? null
          : remote.stage
        : null,
  };
}
