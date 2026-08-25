/**
 * Session runtime: messages / liveMap / stop latch / viewing session coordination.
 * Owns projection state so AppWorkbench stays a shell over Host event wiring + send.
 *
 * Stream hot path uses external stores so token growth does not force every
 * workbench subscriber to reconcile (Intel Retina multi-turn).
 *
 * Full liveMap is NOT subscribed here — use {@link useLiveMapWhen} in panels
 * that need every session row. Shell only tracks busy membership.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canStopWithStopLatch,
  createStopLatchState,
  type StopLatchState,
} from "@/lib/stopLatch";
import { isSessionLiveStreaming, type ChatMessage } from "@/lib/session";
import {
  settleStoppedSessionInLiveMap,
  settleStoppedSessionSnapshot,
  type SessionLiveMap,
} from "@/lib/sessionLiveStore";
import { reconcileUiBusyGate } from "@/lib/sessionPhase";
import { type ViewFocus } from "@/lib/viewFocus";
import { canLiveParticipate } from "@/lib/multiWindow";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";
import {
  useTranscriptActions,
  useTranscriptMeta,
} from "@/hooks/useSessionTranscript";
import {
  useLiveMapActions,
  useLiveMapBusyIds,
} from "@/hooks/useSessionLiveMap";
import {
  useFocusedSession,
  useLiveHost,
  useSessionShellActions,
} from "@/hooks/useSessionShell";
import { useSessionRuntimeRefs } from "@/hooks/useSessionRuntimeRefs";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";

export type { SessionLiveMap };

export function useSessionRuntime(opts?: {
  isSecondaryWindow?: boolean;
}) {
  const isSecondaryWindow = opts?.isSecondaryWindow ?? false;

  const session = useFocusedSession();
  const liveHost = useLiveHost();
  const { setSession, setLiveHost } = useSessionShellActions();

  const { setLiveMap } = useLiveMapActions();
  const busyIdsFromStore = useLiveMapBusyIds();
  // Refs only — no full-map React subscription on the workbench shell.
  const { liveMapRef, liveHostRef } = useSessionRuntimeRefs({ liveHost });

  /** Stop interrupt honesty latch (force unlock after budget). */
  const [stopLatch, setStopLatch] = useState<StopLatchState>(() =>
    createStopLatchState(),
  );
  const stopLatchRef = useRef<StopLatchState>(createStopLatchState());
  stopLatchRef.current = stopLatch;

  const transcriptMeta = useTranscriptMeta();
  const { setMessages, patchSessionMessages: patchStore } =
    useTranscriptActions();
  /**
   * Structural shell mirror — token growth does not update this array.
   * ConversationThreadLive subscribes to full content separately.
   */
  const [messages, setShellMessages] = useState<ChatMessage[]>(() =>
    sessionTranscriptStore.getMessages(),
  );
  useEffect(() => {
    setShellMessages(sessionTranscriptStore.getMessages());
  }, [transcriptMeta.structuralRev]);

  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    return sessionTranscriptStore.subscribeContent(() => {
      messagesRef.current = sessionTranscriptStore.getMessages();
    });
  }, []);
  messagesRef.current = sessionTranscriptStore.getMessages();

  const messagesBySessionRef = useRef(sessionTranscriptStore.getBySessionMap());
  const viewingSessionIdRef = useRef<string | null>(null);
  const viewEpochRef = useRef(0);

  useEffect(() => {
    sessionTranscriptStore.setViewingSessionId(session.sessionId);
    sessionTranscriptStore.setViewingIdResolver(
      () => viewingSessionIdRef.current,
    );
    return () => sessionTranscriptStore.setViewingIdResolver(null);
  }, [session.sessionId]);

  useEffect(() => {
    if (viewingSessionIdRef.current == null && session.sessionId) {
      viewingSessionIdRef.current = session.sessionId;
    }
  }, [session.sessionId]);

  const currentViewFocus = useCallback(
    (): ViewFocus => ({
      sessionId: viewingSessionIdRef.current,
      epoch: viewEpochRef.current,
    }),
    [],
  );
  const bumpViewEpoch = useCallback(() => {
    viewEpochRef.current += 1;
  }, []);

  const patchSessionMessages = useCallback(
    (
      targetSessionId: string | undefined | null,
      reduce: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      patchStore(targetSessionId, reduce);
    },
    [patchStore],
  );

  /**
   * Prefer the store Set identity when host does not inject an extra id —
   * keeps sidebar memo/`busyIds.has` stable across unrelated shell re-renders.
   */
  const busyIds = useMemo(() => {
    if (
      !liveHost.sessionId ||
      !isSessionLiveStreaming(liveHost.state) ||
      busyIdsFromStore.has(liveHost.sessionId)
    ) {
      return busyIdsFromStore;
    }
    const set = new Set(busyIdsFromStore);
    set.add(liveHost.sessionId);
    return set;
  }, [busyIdsFromStore, liveHost.sessionId, liveHost.state]);

  const settleStoppedSessionUi = useCallback(
    (sessionId: string) => {
      setLiveMap((prev) => {
        const next = settleStoppedSessionInLiveMap(prev, sessionId);
        liveMapRef.current = next;
        return next;
      });
      setLiveHost((prev) => {
        const next = settleStoppedSessionSnapshot(prev, sessionId);
        liveHostRef.current = next;
        return next;
      });
      setSession((prev) => settleStoppedSessionSnapshot(prev, sessionId));
    },
    [setLiveMap, setLiveHost, setSession, liveMapRef, liveHostRef],
  );

  const stopGate = useMemo(
    () =>
      reconcileUiBusyGate({
        hostState: session.state,
        stopLatch,
      }),
    [session.state, stopLatch],
  );

  const effectiveCanSend =
    stopGate.sendable && canLiveParticipate(isSecondaryWindow);
  const effectiveCanStop =
    canLiveParticipate(isSecondaryWindow) &&
    canStopWithStopLatch(session.state, stopLatch);

  /** Latest full map for event handlers (always fresh; not a React subscription). */
  const getLiveMap = useCallback(() => sessionLiveMapStore.getMap(), []);

  return {
    session,
    setSession,
    liveHost,
    setLiveHost,
    liveHostRef,
    /** @deprecated Prefer getLiveMap() / useLiveMapWhen — kept as ref for Host events. */
    liveMapRef,
    setLiveMap,
    stopLatch,
    setStopLatch,
    stopLatchRef,
    messages,
    setMessages,
    messagesRef,
    messagesBySessionRef,
    viewingSessionIdRef,
    viewEpochRef,
    currentViewFocus,
    bumpViewEpoch,
    patchSessionMessages,
    busyIds,
    getLiveMap,
    settleStoppedSessionUi,
    stopGate,
    effectiveCanSend,
    effectiveCanStop,
    /** Structural transcript meta for shell empty/streaming gates. */
    transcriptMeta,
  };
}
