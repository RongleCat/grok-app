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
  const [continuation, setContinuation] = useState<{
    source: WallpaperRemoteSource;
    query: string;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const normalized = query.trim().replace(/\s+/g, " ");

  const cancel = useCallback(async () => {
    generation.current += 1;
    setLoadingMore(false);
    return remote.cancel();
  }, [remote.cancel]);

  useEffect(() => {
    generation.current += 1;
    setContinuation(null);
    setLoadingMore(false);
    void remote.cancel();
  }, [enabled, source, normalized, remote.cancel]);

  useEffect(() => {
    if (
      !enabled ||
      !source ||
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
    remote.progressiveItems,
    remote.source,
    setHasSearched,
    setItems,
    source,
  ]);

  const run = useCallback(
    async (more: boolean) => {
      if (!enabled || !source || !normalized || remote.busy) return;
      if (
        more &&
        (!continuation ||
          continuation.source !== source ||
          continuation.query !== normalized)
      ) {
        return;
      }
      const revision = ++generation.current;
      const initialItems = items;
      setError(null);
      setErrorCode(null);
      setStatusHint(null);
      setLoadingMore(more);
      if (!more) {
        setItems([]);
        setSelectedId(null);
        setHasSearched(false);
        setContinuation(null);
      }
      try {
        const result = await (more
          ? remote.loadMore(source, normalized)
          : remote.search(source, normalized));
        if (!result || revision !== generation.current) return;
        setHasSearched(true);
        const code = wallpaperRemoteUiError(result);
        if (code && code !== "empty") {
          setErrorCode(code);
          setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
          setStatusHint(null);
          return;
        }
        const nextItems = more
          ? appendWallpaperGalleryItems(initialItems, result.items)
          : appendWallpaperGalleryItems([], result.items);
        setItems(nextItems);
        setContinuation(result.hasMore ? { source, query: normalized } : null);
        if (code === "empty") {
          if (more) {
            setStatusHint(t("settings.wallpaperSource.noMore"));
          } else {
            setErrorCode("empty");
            setError(t("settings.wallpaperSource.err.empty"));
            setStatusHint(null);
          }
        } else {
          setStatusHint(
            more
              ? t("settings.wallpaperSource.remote.loadedMore", {
                  count: result.items.length,
                  total: nextItems.length,
                })
              : t(
                  result.cacheHit
                    ? "settings.wallpaperSource.remote.completeCached"
                    : "settings.wallpaperSource.remote.complete",
                  {
                    count: nextItems.length,
                    seconds: (result.durationMs / 1000).toFixed(1),
                  },
                ),
          );
        }
      } catch (error) {
        if (revision !== generation.current) return;
        const code = parseWallpaperSourceError(error);
        setErrorCode(code);
        setError(t(`settings.wallpaperSource.err.${code}` as MessageKey));
        setStatusHint(null);
      } finally {
        if (revision === generation.current) setLoadingMore(false);
      }
    },
    [
      continuation,
      enabled,
      items,
      normalized,
      remote.busy,
      remote.loadMore,
      remote.search,
      setError,
      setErrorCode,
      setHasSearched,
      setItems,
      setSelectedId,
      setStatusHint,
      source,
      t,
    ],
  );

  const search = useCallback(() => run(false), [run]);
  const loadMore = useCallback(() => run(true), [run]);
  const canLoadMore =
    continuation?.source === source && continuation.query === normalized;

  return {
    busy: remote.busy,
    loadingMore,
    cancel,
    search,
    loadMore,
    canLoadMore,
    stage: remote.stage,
  };
}
