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
}: Options) {
  const remote = useWallpaperRemoteSearch();
  const generation = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const continuationRef = useRef<Continuation | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [prefetching, setPrefetching] = useState(false);
  const prefetchingRef = useRef(false);
  const prefetchGeneration = useRef(0);
  const prefetchOutcome = useRef<PrefetchOutcome | null>(null);
  const prefetchPromise = useRef<Promise<PrefetchOutcome | null> | null>(null);
  const normalized = query.trim().replace(/\s+/g, " ");

  const updateContinuation = useCallback((next: Continuation | null) => {
    continuationRef.current = next;
    setContinuation(next);
  }, []);

  const discardPrefetch = useCallback(() => {
    prefetchGeneration.current += 1;
    prefetchingRef.current = false;
    prefetchOutcome.current = null;
    prefetchPromise.current = null;
    setPrefetching(false);
  }, []);

  const startPrefetch = useCallback(
    (next: Continuation) => {
      const revision = prefetchGeneration.current + 1;
      prefetchGeneration.current = revision;
      prefetchingRef.current = true;
      prefetchOutcome.current = null;
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
            prefetchOutcome.current = outcome;
            return outcome;
          },
          (error): PrefetchOutcome | null => {
            if (prefetchGeneration.current !== revision) return null;
            const outcome = {
              continuation: next,
              result: null,
              error,
            } satisfies PrefetchOutcome;
            prefetchOutcome.current = outcome;
            return outcome;
          },
        )
        .finally(() => {
          if (prefetchGeneration.current !== revision) return;
          prefetchingRef.current = false;
          if (prefetchPromise.current === task) prefetchPromise.current = null;
          setPrefetching(false);
        });
      prefetchPromise.current = task;
    },
    [remote.loadMore],
  );

  const cancel = useCallback(async () => {
    generation.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    discardPrefetch();
    return remote.cancel();
  }, [discardPrefetch, remote.cancel]);

  const capture = useCallback(
    (): WallpaperProviderContinuationState => ({
      continuation: continuationRef.current,
      prefetched: prefetchOutcome.current,
    }),
    [],
  );

  const restore = useCallback(
    (state: WallpaperProviderContinuationState) => {
      generation.current += 1;
      loadingMoreRef.current = false;
      discardPrefetch();
      updateContinuation(state.continuation);
      prefetchOutcome.current = state.prefetched;
      setLoadingMore(false);
    },
    [discardPrefetch, updateContinuation],
  );

  const clear = useCallback(() => {
    updateContinuation(null);
    return cancel();
  }, [cancel, updateContinuation]);

  useEffect(() => {
    generation.current += 1;
    discardPrefetch();
    updateContinuation(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    void remote.cancel();
  }, [
    discardPrefetch,
    enabled,
    normalized,
    remote.cancel,
    source,
    updateContinuation,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !source ||
      prefetchingRef.current ||
      remote.source !== source ||
      remote.progressiveItems.length === 0
    ) {
      return;
    }
    setHasSearched(true);
    setItems((current) =>
      loadingMore
        ? appendWallpaperGalleryItems(current, remote.progressiveItems)
        : appendWallpaperGalleryItems([], remote.progressiveItems),
    );
  }, [
    enabled,
    loadingMore,
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
      loadingMoreRef.current ||
      (remote.busy && !prefetchingRef.current)
    ) {
      return;
    }
    const revision = ++generation.current;
    discardPrefetch();
    loadingMoreRef.current = false;
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    setLoadingMore(false);
    setItems([]);
    setSelectedId(null);
    setHasSearched(false);
    updateContinuation(null);
    try {
      const result = await remote.search(source, normalized);
      if (!result || revision !== generation.current) return;
      setHasSearched(true);
      const code = wallpaperRemoteUiError(result);
      if (code && code !== "empty") {
        setErrorCode(code);
        setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
        setStatusHint(null);
        return;
      }
      const nextItems = appendWallpaperGalleryItems([], result.items);
      setItems(nextItems);
      const nextContinuation = result.hasMore
        ? { source, query: normalized }
        : null;
      updateContinuation(nextContinuation);
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
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
      setStatusHint(null);
    }
  }, [
    discardPrefetch,
    enabled,
    normalized,
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
      loadingMoreRef.current ||
      (remote.busy && !prefetchingRef.current)
    ) {
      return;
    }
    const revision = generation.current;
    const prefetchRevision = prefetchGeneration.current;
    const initialItems = itemsRef.current;
    setError(null);
    setErrorCode(null);
    setStatusHint(null);
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let prefetched = prefetchOutcome.current;
      if (!prefetched && prefetchPromise.current) {
        prefetched = await prefetchPromise.current;
      }
      if (
        revision !== generation.current ||
        prefetchRevision !== prefetchGeneration.current ||
        !continuationRef.current ||
        !sameContinuation(continuationRef.current, active)
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
      const result =
        prefetched?.result ??
        (await remote.loadMore(active.source, active.query));
      if (!result || revision !== generation.current) return;
      if (
        !continuationRef.current ||
        !sameContinuation(continuationRef.current, active)
      ) {
        return;
      }

      setHasSearched(true);
      const code = wallpaperRemoteUiError(result);
      if (code && code !== "empty") {
        setErrorCode(code);
        setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
        setStatusHint(null);
        return;
      }
      const nextItems = appendWallpaperGalleryItems(initialItems, result.items);
      setItems(nextItems);
      const nextContinuation = result.hasMore ? active : null;
      updateContinuation(nextContinuation);
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
      const code = parseWallpaperSourceError(error);
      setErrorCode(code);
      setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
      setStatusHint(null);
    } finally {
      if (revision === generation.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [
    enabled,
    normalized,
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
    busy: loadingMore || (remote.busy && !prefetching),
    loadingMore,
    cancel,
    capture,
    restore,
    clear,
    search,
    loadMore,
    canLoadMore,
    stage: prefetching && !loadingMore ? null : remote.stage,
  };
}
