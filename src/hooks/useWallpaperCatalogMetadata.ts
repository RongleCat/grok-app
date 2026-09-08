import { useEffect, type Dispatch, type SetStateAction } from "react";
import { wallpaperLibraryLookup, type WallpaperLibraryMatch } from "@/lib/api";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";

/** Hydrate search cards from the local catalog without exposing private files. */
export function useWallpaperCatalogMetadata(
  enabled: boolean,
  items: WallpaperGalleryItem[],
  setItems: Dispatch<SetStateAction<WallpaperGalleryItem[]>>,
  onError: () => void,
) {
  const requestKey = JSON.stringify(
    items
      .filter((item) => !item.metadata && item.fullUrl.startsWith("https://"))
      .map((item) => ({ source: item.source, mediaUrl: item.fullUrl })),
  );

  useEffect(() => {
    if (!enabled) return;
    const requests: Array<{ source: string; mediaUrl: string }> =
      JSON.parse(requestKey);
    if (!requests.length) return;

    let active = true;
    void (async () => {
      const matches = new Map<string, WallpaperLibraryMatch>();
      for (let offset = 0; offset < requests.length && active; offset += 96) {
        const batch = requests.slice(offset, offset + 96);
        for (const match of await wallpaperLibraryLookup(batch)) {
          const request = batch[match.index];
          if (request) {
            matches.set(
              JSON.stringify([request.source, request.mediaUrl]),
              match,
            );
          }
        }
      }
      if (!active || !matches.size) return;

      setItems((previous) =>
        previous.map((item) => {
          const match = matches.get(
            JSON.stringify([item.source, item.fullUrl]),
          );
          // A favorite saved while lookup was pending is newer than its snapshot.
          return !item.metadata && match
            ? {
                ...item,
                localPath: match.path,
                metadata: match.metadata,
                width: match.metadata.width ?? item.width,
                height: match.metadata.height ?? item.height,
              }
            : item;
        }),
      );
    })().catch(() => {
      if (active) onError();
    });

    return () => {
      active = false;
    };
  }, [enabled, requestKey, setItems, onError]);
}
