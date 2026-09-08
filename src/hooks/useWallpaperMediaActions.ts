import { useCallback, useEffect, useRef, useState } from "react";
import { wallpaperLibraryRemember } from "@/lib/api";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import { ensureLocalWallpaperMedia } from "@/lib/wallpaperSourceMedia";

type Options = {
  open: boolean;
  source: string;
  onChanged: (item: WallpaperGalleryItem) => void;
  onError: (error: unknown) => void;
};

export function useWallpaperMediaActions({
  open,
  source,
  onChanged,
  onError,
}: Options) {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    pending.current.clear();
    setBusyIds(new Set());
    return () => {
      generation.current += 1;
    };
  }, [open, source]);

  const toggleFavorite = useCallback(
    async (item: WallpaperGalleryItem) => {
      if (!open || pending.current.has(item.id)) return;
      pending.current.add(item.id);
      const current = generation.current;
      setBusyIds(new Set(pending.current));
      try {
        const local = await ensureLocalWallpaperMedia(item);
        if (current !== generation.current) return;
        const metadata = await wallpaperLibraryRemember(
          local.path,
          item,
          !item.metadata?.favorite,
        );
        if (current !== generation.current) return;
        onChanged({
          ...item,
          localPath: local.path,
          metadata,
        });
      } catch (error) {
        if (current === generation.current) onError(error);
      } finally {
        if (current === generation.current) {
          pending.current.delete(item.id);
          setBusyIds(new Set(pending.current));
        }
      }
    },
    [open, onChanged, onError],
  );

  return { busyIds, toggleFavorite };
}
