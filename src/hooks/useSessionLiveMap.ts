/**
 * React bindings for sessionLiveMapStore.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  sessionLiveMapStore,
  type LiveMapBusyMeta,
} from "@/lib/sessionLiveMapStore";
import {
  busySessionIds,
  type SessionLiveMap,
} from "@/lib/sessionLiveStore";

/** Full live map — use in panels that need every session row. */
export function useLiveMap(): SessionLiveMap {
  return useSyncExternalStore(
    sessionLiveMapStore.subscribeMap,
    sessionLiveMapStore.getMapSnapshot,
    sessionLiveMapStore.getMapSnapshot,
  );
}

const EMPTY_LIVE_MAP: SessionLiveMap = Object.freeze({}) as SessionLiveMap;

/**
 * Subscribe to the full live map only while `enabled` is true.
 * When panels (dashboard / reliability / stall) are closed, the
 * workbench shell does not re-render on every tool-title liveMap tick.
 */
export function useLiveMapWhen(enabled: boolean): SessionLiveMap {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled) return () => {};
      return sessionLiveMapStore.subscribeMap(onStoreChange);
    },
    [enabled],
  );
  const getSnapshot = useCallback((): SessionLiveMap => {
    if (!enabled) return EMPTY_LIVE_MAP;
    return sessionLiveMapStore.getMapSnapshot();
  }, [enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Busy membership only — sidebar chrome / tray badge. */
export function useLiveMapBusyMeta(): LiveMapBusyMeta {
  return useSyncExternalStore(
    sessionLiveMapStore.subscribeBusy,
    sessionLiveMapStore.getBusySnapshot,
    sessionLiveMapStore.getBusySnapshot,
  );
}

export function useLiveMapBusyIds(): Set<string> {
  const meta = useLiveMapBusyMeta();
  return useMemo(() => {
    if (!meta.busyKey) return new Set<string>();
    return new Set(meta.busyKey.split("\0").filter(Boolean));
  }, [meta.busyKey]);
}

export function useLiveMapActions() {
  const setLiveMap = useCallback(
    (next: SessionLiveMap | ((prev: SessionLiveMap) => SessionLiveMap)) => {
      sessionLiveMapStore.setLiveMap(next);
    },
    [],
  );
  return { setLiveMap };
}

/** Stable busy id set from a one-shot map read (event handlers). */
export function peekBusySessionIds(): Set<string> {
  return busySessionIds(sessionLiveMapStore.getMap());
}
