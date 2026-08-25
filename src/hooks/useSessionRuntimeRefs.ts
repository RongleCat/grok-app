/**
 * Keep mutable refs aligned with external session runtime stores without
 * forcing App shell re-renders. Event handlers read refs for latest values.
 */

import { useEffect, useRef } from "react";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import { sessionShellStore } from "@/lib/sessionShellStore";
import type { SessionSnapshot } from "@/lib/session";
import type { SessionLiveMap } from "@/lib/sessionLiveStore";

export function useSessionRuntimeRefs(opts?: {
  liveMap?: SessionLiveMap;
  liveHost?: SessionSnapshot;
}) {
  const liveMapRef = useRef(sessionLiveMapStore.getMap());
  const liveHostRef = useRef(sessionShellStore.getLiveHost());

  // Mirror latest render values when provided (same-render freshness).
  // Use !== undefined so empty liveMap {} still updates the ref.
  if (opts && "liveMap" in opts && opts.liveMap !== undefined) {
    liveMapRef.current = opts.liveMap;
  }
  if (opts && "liveHost" in opts && opts.liveHost !== undefined) {
    liveHostRef.current = opts.liveHost;
  }

  useEffect(() => {
    const unsubMap = sessionLiveMapStore.subscribeMap(() => {
      liveMapRef.current = sessionLiveMapStore.getMap();
    });
    const unsubHost = sessionShellStore.subscribeLiveHost(() => {
      liveHostRef.current = sessionShellStore.getLiveHost();
    });
    liveMapRef.current = sessionLiveMapStore.getMap();
    liveHostRef.current = sessionShellStore.getLiveHost();
    return () => {
      unsubMap();
      unsubHost();
    };
  }, []);

  return { liveMapRef, liveHostRef };
}
