import { useCallback, useEffect, useRef, useState } from "react";
import { wallpaperLibraryPage, type WallpaperLibraryPage } from "@/lib/api";
import {
  libraryEntriesToGalleryItems,
  parseWallpaperSourceError,
  type WallpaperGalleryItem,
  type WallpaperLibraryPurpose,
  type WallpaperSourceErrorCode,
} from "@/lib/wallpaperSource";

type State = {
  items: WallpaperGalleryItem[];
  page: WallpaperLibraryPage | null;
  busy: boolean;
  loadingMore: boolean;
  hasLoaded: boolean;
  error: WallpaperSourceErrorCode | null;
};

type Entry = { key: string; created: number; value: State };

const emptyState: State = {
  items: [],
  page: null,
  busy: false,
  loadingMore: false,
  hasLoaded: false,
  error: null,
};

// Expire before the Host's snapshot; appending must not renew its age.
const CACHE_TTL = 20 * 60 * 1000;
const MAX_CACHED_QUERIES = 8;
const MAX_CACHED_ITEMS = 2_000;

function excludeLibraryItems(
  previous: Entry,
  shouldRemove: (item: WallpaperGalleryItem) => boolean,
): Entry {
  const removed = previous.value.items.filter(shouldRemove);
  if (!removed.length) return previous;
  const removedIds = new Set(removed.map((item) => item.id));
  const removedVideos = removed.filter((item) => item.kind === "video").length;
  const page = previous.value.page;
  return {
    ...previous,
    value: {
      ...previous.value,
      items: previous.value.items.filter((item) => !removedIds.has(item.id)),
      page: page
        ? {
            ...page,
            total: Math.max(0, page.total - removed.length),
            kindCounts: {
              all: Math.max(0, page.kindCounts.all - removed.length),
              image: Math.max(
                0,
                page.kindCounts.image - (removed.length - removedVideos),
              ),
              video: Math.max(0, page.kindCounts.video - removedVideos),
            },
          }
        : null,
    },
  };
}

export function useWallpaperLibrary(
  enabled: boolean,
  query: string,
  kind: "all" | "image" | "video",
  open = true,
  purpose: WallpaperLibraryPurpose = "all",
) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const entryRef = useRef<Entry | null>(null);
  const replaceEntry = useCallback((next: Entry | null) => {
    entryRef.current = next;
    setEntry(next);
  }, []);
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<string, Entry>());
  const generation = useRef(0);
  const loading = useRef(false);
  const normalizedQuery = query.trim();
  const key = JSON.stringify([normalizedQuery, kind, purpose]);
  const candidate = entry?.key === key ? entry : cache.current.get(key);
  // Expiry fences future paging/restoration; it must not erase visible rows
  // during an unrelated render while the user is inspecting the library.
  const currentEntry = candidate;
  const state = open ? currentEntry?.value ?? emptyState : emptyState;

  const publish = useCallback(
    (next: Entry) => {
      cache.current.delete(next.key);
      if (
        next.value.hasLoaded &&
        next.value.page &&
        next.value.items.length <= MAX_CACHED_ITEMS
      ) {
        while (cache.current.size >= MAX_CACHED_QUERIES) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        cache.current.set(next.key, next);
      }
      replaceEntry(next);
    },
    [replaceEntry],
  );

  useEffect(() => {
    const current = ++generation.current;
    loading.current = false;
    if (!open) {
      cache.current.clear();
      replaceEntry(null);
      return;
    }
    if (!enabled) return;
    const saved = cache.current.get(key);
    if (saved && Date.now() - saved.created < CACHE_TTL) {
      publish({
        ...saved,
        value: { ...saved.value, busy: false, loadingMore: false },
      });
      return;
    }
    cache.current.delete(key);
    const created = Date.now();
    replaceEntry({ key, created, value: { ...emptyState, busy: true } });
    loading.current = true;
    const timer = setTimeout(() => {
      void wallpaperLibraryPage({
        query: normalizedQuery,
        kind,
        ...(purpose !== "all" ? { purpose } : {}),
      })
        .then((page) => {
          if (current !== generation.current) return;
          publish({
            key,
            created,
            value: {
              items: libraryEntriesToGalleryItems(page.items, {
                staticFirst: false,
              }),
              page,
              busy: false,
              loadingMore: false,
              hasLoaded: true,
              error: null,
            },
          });
        })
        .catch((error) => {
          if (current !== generation.current) return;
          publish({
            key,
            created,
            value: {
              ...emptyState,
              hasLoaded: true,
              error: parseWallpaperSourceError(error),
            },
          });
        })
        .finally(() => {
          if (current === generation.current) loading.current = false;
        });
    }, normalizedQuery ? 180 : 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      loading.current = false;
    };
  }, [
    enabled,
    open,
    normalizedQuery,
    kind,
    purpose,
    key,
    revision,
    publish,
    replaceEntry,
  ]);

  const refresh = useCallback(() => {
    cache.current.clear();
    generation.current += 1;
    replaceEntry(null);
    setRevision((value) => value + 1);
  }, [replaceEntry]);

  const loadMore = useCallback(async () => {
    const cursor = currentEntry?.value.page?.nextCursor;
    if (!enabled || !open || !cursor || !currentEntry || loading.current) return;
    if (Date.now() - currentEntry.created >= CACHE_TTL) {
      refresh();
      return;
    }
    loading.current = true;
    const current = generation.current;
    const previous = currentEntry;
    replaceEntry({
      ...previous,
      value: { ...previous.value, loadingMore: true, error: null },
    });
    try {
      const page = await wallpaperLibraryPage(
        {
          query: normalizedQuery,
          kind,
          ...(purpose !== "all" ? { purpose } : {}),
        },
        cursor,
      );
      if (current !== generation.current) return;
      // Favorite/delete actions remain available while paging. Merge into the
      // current rows so a late page cannot undo a completed local mutation.
      const latest = entryRef.current ?? previous;
      publish({
        ...latest,
        value: {
          ...latest.value,
          items: [
            ...latest.value.items,
            ...libraryEntriesToGalleryItems(page.items, { staticFirst: false }),
          ],
          page: {
            ...page,
            // Host counts belong to the original snapshot. Keep adjustments
            // from local removals, including those completed before loadMore.
            total: latest.value.page?.total ?? page.total,
            kindCounts: latest.value.page?.kindCounts ?? page.kindCounts,
          },
          error: null,
          loadingMore: false,
        },
      });
    } catch (error) {
      if (current !== generation.current) return;
      const latest = entryRef.current ?? previous;
      publish({
        ...latest,
        value: {
          ...latest.value,
          loadingMore: false,
          error: parseWallpaperSourceError(error),
        },
      });
    } finally {
      if (current === generation.current) loading.current = false;
    }
  }, [
    enabled,
    open,
    currentEntry,
    normalizedQuery,
    kind,
    purpose,
    publish,
    refresh,
    replaceEntry,
  ]);

  const remove = useCallback(
    (id: string) => {
      const withoutItem = (previous: Entry) =>
        excludeLibraryItems(previous, (item) => item.id === id);
      for (const [cachedKey, previous] of cache.current) {
        cache.current.set(cachedKey, withoutItem(previous));
      }
      replaceEntry(entryRef.current ? withoutItem(entryRef.current) : null);
    },
    [replaceEntry],
  );

  const updateItem = useCallback(
    (item: WallpaperGalleryItem) => {
      const patchEntry = (previous: Entry): Entry => {
        if (
          JSON.parse(previous.key)[2] === "favorites" &&
          !item.metadata?.favorite
        ) {
          return excludeLibraryItems(
            previous,
            (row) => row.localPath === item.localPath,
          );
        }
        return {
          ...previous,
          value: {
            ...previous.value,
            items: previous.value.items.map((row) =>
              row.localPath === item.localPath
                ? { ...row, metadata: item.metadata }
                : row,
            ),
          },
        };
      };
      // A new favorite/download can affect views which have not loaded that row.
      cache.current.clear();
      replaceEntry(entryRef.current ? patchEntry(entryRef.current) : null);
    },
    [replaceEntry],
  );

  return {
    ...state,
    busy: enabled && state.busy,
    loadingMore: enabled && state.loadingMore,
    kindCounts: state.page?.kindCounts ?? { all: 0, image: 0, video: 0 },
    canLoadMore: !!state.page?.nextCursor,
    loadMore,
    refresh,
    remove,
    updateItem,
  };
}
