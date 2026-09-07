import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import { createWallpaperXSearchRequestId, isWallpaperXSearchProgress, type WallpaperXSearchProgress, type WallpaperXSearchStage } from "@/lib/wallpaperXSearch";
import type { WallpaperSearchResult } from "@/lib/wallpaperSource";

export type WallpaperXSearchClient = {
  search: (query: string, sort: "top" | "latest", requestId: string) => Promise<WallpaperSearchResult>;
  cancel: (requestId: string) => Promise<boolean>;
  listenProgress: (handler: (progress: WallpaperXSearchProgress) => void) => Promise<() => void>;
};

const DEFAULT_CLIENT: WallpaperXSearchClient = {
  search: api.wallpaperXSearch,
  cancel: api.wallpaperXSearchCancel,
  listenProgress: api.listenWallpaperXSearchProgress,
};

export function useWallpaperXSearch(
  client: WallpaperXSearchClient = DEFAULT_CLIENT,
  requestIdFactory: () => string = createWallpaperXSearchRequestId,
) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<WallpaperXSearchStage | null>(null);
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void client.listenProgress((event) => {
      if (!disposed && isWallpaperXSearchProgress(event) && event.requestId === active.current) {
        setStage(event.stage);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch(() => { /* Progress is advisory; the invoke result is authoritative. */ });
    return () => {
      disposed = true;
      mounted.current = false;
      generation.current += 1;
      const id = active.current;
      active.current = null;
      unlisten?.();
      if (id) void client.cancel(id).catch(() => false);
    };
  }, [client]);

  const cancel = useCallback((): Promise<boolean> => {
    const id = active.current;
    generation.current += 1;
    active.current = null;
    if (mounted.current) {
      setBusy(false);
      setStage(null);
    }
    return id ? client.cancel(id).catch(() => false) : Promise.resolve(false);
  }, [client]);

  const search = useCallback(async (query: string, sort: "top" | "latest") => {
    if (!mounted.current) return null;
    // Invalidate synchronously: a slow cancel acknowledgement must not delay
    // replacement or let a third request be overwritten by a waiting second.
    void cancel();
    const id = requestIdFactory();
    const revision = ++generation.current;
    active.current = id;
    setBusy(true);
    setStage("preparing");
    const current = () => mounted.current && generation.current === revision && active.current === id;
    try {
      const result = await client.search(query, sort, id);
      return current() && result.errorCode !== "cancelled" ? result : null;
    } catch (error) {
      if (!current()) return null;
      throw error;
    } finally {
      if (current()) {
        active.current = null;
        setBusy(false);
        setStage(null);
      }
    }
  }, [cancel, client, requestIdFactory]);

  return { busy, stage, search, cancel };
}
