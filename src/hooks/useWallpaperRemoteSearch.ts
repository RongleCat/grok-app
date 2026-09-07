import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import * as api from "@/lib/api";
import {
  createWallpaperRemoteSearchRequestId,
  isWallpaperRemoteSearchBatch,
  isWallpaperRemoteSearchProgress,
  type WallpaperRemoteSearchBatch,
  type WallpaperRemoteSearchProgress,
  type WallpaperRemoteSearchResult,
  type WallpaperRemoteSearchStage,
  type WallpaperRemoteSource,
} from "@/lib/wallpaperRemoteSearch";
import {
  dedupeGalleryItems,
  type WallpaperGalleryItem,
} from "@/lib/wallpaperSource";

export type WallpaperRemoteSearchClient = {
  search: (
    source: WallpaperRemoteSource,
    query: string,
    requestId: string,
  ) => Promise<WallpaperRemoteSearchResult>;
  searchMore: (
    source: WallpaperRemoteSource,
    query: string,
    requestId: string,
  ) => Promise<WallpaperRemoteSearchResult>;
  cancel: (
    source: WallpaperRemoteSource,
    requestId: string,
  ) => Promise<boolean>;
  listenProgress: (
    handler: (progress: WallpaperRemoteSearchProgress) => void,
  ) => Promise<() => void>;
  listenBatch: (
    handler: (batch: WallpaperRemoteSearchBatch) => void,
  ) => Promise<() => void>;
};

const DEFAULT_CLIENT: WallpaperRemoteSearchClient = {
  search: api.wallpaperRemoteSearch,
  searchMore: api.wallpaperRemoteSearchMore,
  cancel: api.wallpaperRemoteSearchCancel,
  listenProgress: api.listenWallpaperRemoteSearchProgress,
  listenBatch: api.listenWallpaperRemoteSearchBatch,
};

type ActiveRequest = {
  source: WallpaperRemoteSource;
  requestId: string;
};

type ProgressiveState = {
  items: WallpaperGalleryItem[];
  accumulatedCount: number;
  done: boolean;
  seenBatchIndexes: ReadonlySet<number>;
};

type ProgressiveAction =
  | { type: "reset" }
  | { type: "batch"; batch: WallpaperRemoteSearchBatch };

const EMPTY_PROGRESSIVE: ProgressiveState = {
  items: [],
  accumulatedCount: 0,
  done: false,
  seenBatchIndexes: new Set(),
};

function progressiveReducer(
  state: ProgressiveState,
  action: ProgressiveAction,
): ProgressiveState {
  if (action.type === "reset") return EMPTY_PROGRESSIVE;
  const { batch } = action;
  if (state.seenBatchIndexes.has(batch.batchIndex)) {
    return batch.done && !state.done ? { ...state, done: true } : state;
  }
  const seenBatchIndexes = new Set(state.seenBatchIndexes);
  seenBatchIndexes.add(batch.batchIndex);
  const items = dedupeGalleryItems([...state.items, ...batch.items]);
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

export type UseWallpaperRemoteSearchResult = {
  busy: boolean;
  source: WallpaperRemoteSource | null;
  requestId: string | null;
  stage: WallpaperRemoteSearchStage | null;
  progressiveItems: WallpaperGalleryItem[];
  progressiveCount: number;
  progressiveDone: boolean;
  search: (
    source: WallpaperRemoteSource,
    query: string,
  ) => Promise<WallpaperRemoteSearchResult | null>;
  loadMore: (
    source: WallpaperRemoteSource,
    query: string,
  ) => Promise<WallpaperRemoteSearchResult | null>;
  cancel: () => Promise<boolean>;
};

export function useWallpaperRemoteSearch(
  client: WallpaperRemoteSearchClient = DEFAULT_CLIENT,
  requestIdFactory: () => string = createWallpaperRemoteSearchRequestId,
): UseWallpaperRemoteSearchResult {
  const [busy, setBusy] = useState(false);
  const [activeSource, setActiveSource] =
    useState<WallpaperRemoteSource | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [stage, setStage] = useState<WallpaperRemoteSearchStage | null>(null);
  const [progressive, dispatchProgressive] = useReducer(
    progressiveReducer,
    EMPTY_PROGRESSIVE,
  );
  const activeRef = useRef<ActiveRequest | null>(null);
  const generationRef = useRef(0);
  const invocationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    let disposed = false;
    let unlistenProgress: (() => void) | null = null;
    let unlistenBatch: (() => void) | null = null;
    void client
      .listenProgress((progress) => {
        const active = activeRef.current;
        if (
          !isWallpaperRemoteSearchProgress(progress) ||
          !active ||
          progress.requestId !== active.requestId ||
          progress.source !== active.source ||
          !mountedRef.current
        ) {
          return;
        }
        setStage(progress.stage);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlistenProgress = cleanup;
      })
      .catch(() => undefined);
    void client
      .listenBatch((batch) => {
        const active = activeRef.current;
        if (
          !isWallpaperRemoteSearchBatch(batch) ||
          !active ||
          batch.requestId !== active.requestId ||
          batch.source !== active.source ||
          !mountedRef.current
        ) {
          return;
        }
        dispatchProgressive({ type: "batch", batch });
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlistenBatch = cleanup;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlistenProgress?.();
      unlistenBatch?.();
    };
  }, [client]);

  const clearUi = useCallback(() => {
    if (!mountedRef.current) return;
    setBusy(false);
    setActiveSource(null);
    setRequestId(null);
    setStage(null);
    dispatchProgressive({ type: "reset" });
  }, []);

  const cancelActive = useCallback(async (): Promise<boolean> => {
    const active = activeRef.current;
    if (!active) return false;
    generationRef.current += 1;
    activeRef.current = null;
    clearUi();
    try {
      return await client.cancel(active.source, active.requestId);
    } catch {
      return false;
    }
  }, [clearUi, client]);

  const cancel = useCallback((): Promise<boolean> => {
    invocationRef.current += 1;
    return cancelActive();
  }, [cancelActive]);

  const run = useCallback(
    async (
      operation: "initial" | "more",
      source: WallpaperRemoteSource,
      query: string,
    ): Promise<WallpaperRemoteSearchResult | null> => {
      const invocation = invocationRef.current + 1;
      invocationRef.current = invocation;
      if (activeRef.current) await cancelActive();
      if (!mountedRef.current || invocationRef.current !== invocation) {
        return null;
      }
      const nextRequestId = requestIdFactory();
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      activeRef.current = { source, requestId: nextRequestId };
      if (mountedRef.current) {
        setBusy(true);
        setActiveSource(source);
        setRequestId(nextRequestId);
        setStage("preparing");
        dispatchProgressive({ type: "reset" });
      }
      try {
        const result = await (operation === "more"
          ? client.searchMore(source, query, nextRequestId)
          : client.search(source, query, nextRequestId));
        if (
          generationRef.current !== generation ||
          activeRef.current?.requestId !== nextRequestId ||
          activeRef.current.source !== source ||
          result.source !== source
        ) {
          return null;
        }
        return result;
      } catch (error) {
        if (
          generationRef.current !== generation ||
          activeRef.current?.requestId !== nextRequestId
        ) {
          return null;
        }
        throw error;
      } finally {
        if (
          generationRef.current === generation &&
          activeRef.current?.requestId === nextRequestId
        ) {
          activeRef.current = null;
          clearUi();
        }
      }
    },
    [cancelActive, clearUi, client, requestIdFactory],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invocationRef.current += 1;
      generationRef.current += 1;
      const active = activeRef.current;
      activeRef.current = null;
      if (active) {
        void client.cancel(active.source, active.requestId).catch(() => false);
      }
    };
  }, [client]);

  const search = useCallback(
    (source: WallpaperRemoteSource, query: string) =>
      run("initial", source, query),
    [run],
  );

  const loadMore = useCallback(
    (source: WallpaperRemoteSource, query: string) =>
      run("more", source, query),
    [run],
  );

  return {
    busy,
    source: activeSource,
    requestId,
    stage,
    progressiveItems: progressive.items,
    progressiveCount: progressive.accumulatedCount,
    progressiveDone: progressive.done,
    search,
    loadMore,
    cancel,
  };
}
