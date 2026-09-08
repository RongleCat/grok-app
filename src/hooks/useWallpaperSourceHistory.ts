import { useCallback, useRef } from "react";
import type { WallpaperProviderContinuationState } from "./useWallpaperProviderController";
import type {
  WallpaperGalleryItem,
  WallpaperLibraryPurpose,
  WallpaperSourceKind,
} from "@/lib/wallpaperSource";
import type { WallpaperGalleryKindFilter } from "@/lib/wallpaperGalleryPro";

export type WallpaperSourceSnapshot = {
  query: string;
  sort: "top" | "latest";
  items: WallpaperGalleryItem[];
  selectedId: string | null;
  galleryFilter: string;
  kindFilter: WallpaperGalleryKindFilter;
  libraryPurpose: WallpaperLibraryPurpose;
  hasSearched: boolean;
  statusHint: string | null;
  citeSummary: string | null;
  xContinuation: {
    id: string;
    query: string;
    sort: "top" | "latest";
  } | null;
  providerContinuation: WallpaperProviderContinuationState | null;
  scrollTop: number;
};

const HISTORY_TTL_MS = 20 * 60 * 1000;
const MAX_ITEMS_PER_SOURCE = 2_000;

type HistoryEntry = {
  value: WallpaperSourceSnapshot;
  createdAt: number;
};

export function useWallpaperSourceHistory() {
  const entries = useRef(new Map<WallpaperSourceKind, HistoryEntry>());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const save = useCallback(
    (source: WallpaperSourceKind, value: WallpaperSourceSnapshot) => {
      // Saved-page rows remain owned by the isolated authenticated controller.
      const items = source === "grok_album" ? [] : [...value.items];
      if (items.length > MAX_ITEMS_PER_SOURCE) {
        entries.current.delete(source);
        return;
      }
      entries.current.set(source, {
        value: {
          ...value,
          items,
          scrollTop: Number.isFinite(value.scrollTop)
            ? Math.max(0, value.scrollTop)
            : 0,
        },
        createdAt: Date.now(),
      });
    },
    [],
  );

  const get = useCallback((source: WallpaperSourceKind) => {
    const entry = entries.current.get(source);
    if (!entry || Date.now() - entry.createdAt > HISTORY_TTL_MS) {
      entries.current.delete(source);
      return null;
    }
    return entry.value;
  }, []);

  const clear = useCallback((source?: WallpaperSourceKind) => {
    if (source) entries.current.delete(source);
    else entries.current.clear();
  }, []);

  const updateItem = useCallback((item: WallpaperGalleryItem) => {
    for (const entry of entries.current.values()) {
      entry.value.items = entry.value.items.map((row) => {
        const sameItem =
          (row.source === item.source && row.id === item.id) ||
          Boolean(row.localPath && row.localPath === item.localPath);
        return sameItem
          ? {
              ...row,
              localPath: item.localPath,
              metadata: item.metadata,
              width: item.width ?? row.width,
              height: item.height ?? row.height,
            }
          : row;
      });
    }
  }, []);

  return { save, get, clear, updateItem, scrollRef };
}
