import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import * as api from "@/lib/api";
import { createWallpaperXSearchRequestId, isWallpaperXSearchBatch, type WallpaperXSearchBatch, isWallpaperXSearchProgress, type WallpaperXSearchProgress, type WallpaperXSearchStage } from "@/lib/wallpaperXSearch";
import { dedupeGalleryItems, type WallpaperGalleryItem, type WallpaperSearchResult } from "@/lib/wallpaperSource";

export type WallpaperXSearchClient = {
  search: (query: string, sort: "top" | "latest", requestId: string) => Promise<WallpaperSearchResult>;
  listenBatch: (handler: (batch: WallpaperXSearchBatch) => void) => Promise<() => void>;
  cancel: (requestId: string) => Promise<boolean>;
  listenProgress: (handler: (progress: WallpaperXSearchProgress) => void) => Promise<() => void>;
};

const DEFAULT_CLIENT: WallpaperXSearchClient = {
  search: api.wallpaperXSearch,
  cancel: api.wallpaperXSearchCancel,
  listenProgress: api.listenWallpaperXSearchProgress,
  listenBatch: api.listenWallpaperXSearchBatch,
};

type ProgressiveState = {
  items: WallpaperGalleryItem[];
  accumulatedCount: number;
  done: boolean;
  seenBatchIndexes: ReadonlySet<number>;
};

type ProgressiveAction =
  | { type: "reset" }
  | { type: "batch"; batch: WallpaperXSearchBatch };

const EMPTY_PROGRESSIVE_STATE: ProgressiveState = {
  items: [],
  accumulatedCount: 0,
  done: false,
  seenBatchIndexes: new Set(),
};

function progressiveReducer(
  state: ProgressiveState,
  action: ProgressiveAction,
): ProgressiveState {
  if (action.type === "reset") return EMPTY_PROGRESSIVE_STATE;
  const { batch } = action;
  if (state.seenBatchIndexes.has(batch.batchIndex)) {
    const done = state.done || batch.done;
    return done === state.done ? state : { ...state, done };
  }
  const items = dedupeGalleryItems([...state.items, ...batch.items]);
  const seenBatchIndexes = new Set(state.seenBatchIndexes);
  seenBatchIndexes.add(batch.batchIndex);
  return {
    items,
    accumulatedCount: Math.max(
      state.accumulatedCount,
      batch.accumulatedCount,
      items.length,
    ),
    done: state.done || batch.done,
    seenBatchIndexes,
  };
}

export function useWallpaperXSearch(
  client: WallpaperXSearchClient = DEFAULT_CLIENT,
  requestIdFactory: () => string = createWallpaperXSearchRequestId,
) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<WallpaperXSearchStage | null>(null);
  const [progressive, dispatchProgressive] = useReducer(progressiveReducer, EMPTY_PROGRESSIVE_STATE);
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenBatch: (() => void) | undefined;
    void client.listenBatch((event) => {
      if (!disposed && mounted.current && isWallpaperXSearchBatch(event) && event.requestId === active.current) {
        dispatchProgressive({ type: "batch", batch: event });
      }
    }).then((cleanup) => { if (disposed) cleanup(); else unlistenBatch = cleanup; })
      .catch(() => { /* Invoke result remains authoritative if event registration fails. */ });
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
      unlistenBatch?.();
      if (id) void client.cancel(id).catch(() => false);
    };
  }, [client]);

  const cancel = useCallback((): Promise<boolean> => {
    const id = active.current;
    generation.current += 1;
    active.current = null;
    if (mounted.current) {
      dispatchProgressive({ type: "reset" });
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

  return { busy, stage, search, cancel, progressiveItems: progressive.items };
}
