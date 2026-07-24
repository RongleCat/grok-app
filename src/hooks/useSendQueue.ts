import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { Attachment } from "@/lib/attachments";
import type { SessionSnapshot, SessionState } from "@/lib/session";
import {
  canShowQueueButton,
  claimQueueHead,
  dropQueuesForSessions,
  enqueueSend,
  getQueueForKey,
  makeQueuedSend,
  migrateDraftQueue,
  queueSessionKey,
  removeQueuedSend,
  requeueAfterFlushFail,
  SEND_QUEUE_MAX,
  setQueueForKey,
  shouldEnqueueSend,
  type QueuedSend,
} from "@/lib/sendQueue";

export type ExecuteSendFromQueue = (opts: {
  storedDisplay: string;
  att: Attachment[];
  goalMode: boolean;
  fromQueue: true;
  targetSessionId: string | null;
}) => Promise<boolean>;

export type UseSendQueueOptions = {
  sessionId: string | null;
  sessionState: SessionState;
  connecting: boolean;
  liveHostRef: RefObject<SessionSnapshot>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  sendInFlightRef: MutableRefObject<boolean>;
  /** Always call via ref so flush sees the latest executeSend. */
  executeSendRef: MutableRefObject<ExecuteSendFromQueue>;
  showToast: (msg: string, ms?: number) => void;
  labels: {
    queued: string;
    sendFailed: string;
    droppedOldest: (n: number, max: number) => string;
  };
};

/**
 * Per-session follow-up send queue: enqueue while busy, auto-flush when idle,
 * claim/requeue on flush failure, hold after fail to avoid spin.
 */
export function useSendQueue({
  sessionId,
  sessionState,
  connecting,
  liveHostRef,
  viewingSessionIdRef,
  sendInFlightRef,
  executeSendRef,
  showToast,
  labels,
}: UseSendQueueOptions) {
  const [sendQueueByKey, setSendQueueByKey] = useState<
    Record<string, QueuedSend[]>
  >({});
  const sendQueueByKeyRef = useRef(sendQueueByKey);
  sendQueueByKeyRef.current = sendQueueByKey;

  const queueFlushHoldRef = useRef(false);
  /** UI-visible hold (ref alone does not re-render). */
  const [flushHold, setFlushHold] = useState(false);
  const flushQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const activeQueue = useMemo(
    () => getQueueForKey(sendQueueByKey, queueSessionKey(sessionId)),
    [sendQueueByKey, sessionId],
  );

  const setHold = useCallback((on: boolean) => {
    queueFlushHoldRef.current = on;
    setFlushHold(on);
  }, []);

  const releaseFlushHold = useCallback(() => {
    setHold(false);
  }, [setHold]);

  const cancelFlushTimer = useCallback(() => {
    if (flushQueueTimerRef.current) {
      clearTimeout(flushQueueTimerRef.current);
      flushQueueTimerRef.current = null;
    }
  }, []);

  const writeMap = useCallback((next: Record<string, QueuedSend[]>) => {
    sendQueueByKeyRef.current = next;
    setSendQueueByKey(next);
  }, []);

  /** Enqueue a follow-up for the current session. Returns dropped count. */
  const enqueue = useCallback(
    (input: {
      storedDisplay: string;
      attachments: Attachment[];
      goalMode: boolean;
    }) => {
      const key = queueSessionKey(sessionId);
      const item = makeQueuedSend(input);
      const r = enqueueSend(getQueueForKey(sendQueueByKeyRef.current, key), item);
      writeMap(setQueueForKey(sendQueueByKeyRef.current, key, r.queue));
      if (r.dropped > 0) {
        showToast(labels.droppedOldest(r.dropped, SEND_QUEUE_MAX), 3200);
      } else {
        showToast(labels.queued, 2200);
      }
      return r.dropped;
    },
    [sessionId, showToast, labels, writeMap],
  );

  const removeItem = useCallback(
    (id: string) => {
      const key = queueSessionKey(sessionId);
      const next = setQueueForKey(
        sendQueueByKeyRef.current,
        key,
        removeQueuedSend(getQueueForKey(sendQueueByKeyRef.current, key), id),
      );
      writeMap(next);
      if (!getQueueForKey(next, key).length) cancelFlushTimer();
    },
    [sessionId, writeMap, cancelFlushTimer],
  );

  const clearQueue = useCallback(() => {
    const key = queueSessionKey(sessionId);
    cancelFlushTimer();
    writeMap(setQueueForKey(sendQueueByKeyRef.current, key, []));
  }, [sessionId, writeMap, cancelFlushTimer]);

  const clearDraftQueue = useCallback(() => {
    writeMap(setQueueForKey(sendQueueByKeyRef.current, "__draft__", []));
  }, [writeMap]);

  const dropSessions = useCallback(
    (sessionIds: Iterable<string>) => {
      const next = dropQueuesForSessions(
        sendQueueByKeyRef.current,
        sessionIds,
      );
      if (next !== sendQueueByKeyRef.current) writeMap(next);
    },
    [writeMap],
  );

  const migrateDraft = useCallback(
    (newSessionId: string) => {
      const next = migrateDraftQueue(sendQueueByKeyRef.current, newSessionId);
      if (next !== sendQueueByKeyRef.current) writeMap(next);
    },
    [writeMap],
  );

  const flush = useCallback(() => {
    if (sendInFlightRef.current) return;
    if (connecting) return;
    if (queueFlushHoldRef.current) return;
    const live = liveHostRef.current;
    const viewId = viewingSessionIdRef.current;
    if (live.sessionId && viewId && live.sessionId !== viewId) return;
    if (shouldEnqueueSend(live.state, false)) return;

    const claimKey = queueSessionKey(viewId ?? live.sessionId);
    const claimed = claimQueueHead(sendQueueByKeyRef.current, claimKey);
    if (!claimed) return;
    const { head } = claimed;
    const targetSessionId = claimKey === "__draft__" ? null : claimKey;
    writeMap(claimed.byKey);

    void (async () => {
      const ok = await executeSendRef.current({
        storedDisplay: head.storedDisplay,
        att: head.attachments,
        goalMode: head.goalMode,
        fromQueue: true,
        targetSessionId,
      });
      if (ok) return;
      const r = requeueAfterFlushFail(
        sendQueueByKeyRef.current,
        claimKey,
        head,
      );
      writeMap(r.byKey);
      setHold(true);
      if (r.dropped > 0) {
        showToast(labels.droppedOldest(r.dropped, SEND_QUEUE_MAX), 3500);
      } else {
        showToast(labels.sendFailed, 3500);
      }
    })();
  }, [
    connecting,
    liveHostRef,
    viewingSessionIdRef,
    sendInFlightRef,
    executeSendRef,
    showToast,
    labels,
    writeMap,
    setHold,
  ]);

  // Clear flush hold once a real turn is in progress again.
  useEffect(() => {
    if (
      sessionState === "streaming" ||
      sessionState === "awaiting_permission"
    ) {
      setHold(false);
    }
  }, [sessionState, setHold]);

  // Auto-send next queued follow-up when the agent becomes idle.
  useEffect(() => {
    if (sessionState !== "ready" && sessionState !== "idle") return;
    if (connecting || sendInFlightRef.current || queueFlushHoldRef.current) {
      return;
    }
    const key = queueSessionKey(sessionId);
    if (!getQueueForKey(sendQueueByKeyRef.current, key).length) return;
    cancelFlushTimer();
    flushQueueTimerRef.current = setTimeout(() => {
      flushQueueTimerRef.current = null;
      flush();
    }, 40);
    return () => cancelFlushTimer();
  }, [
    sessionState,
    sessionId,
    connecting,
    sendQueueByKey,
    flush,
    cancelFlushTimer,
    sendInFlightRef,
  ]);

  /** Clear hold and try flush immediately (user retry). */
  const resumeFlush = useCallback(() => {
    setHold(false);
    // Defer so ref/state settle before claim.
    window.setTimeout(() => flush(), 0);
  }, [setHold, flush]);

  return {
    activeQueue,
    flushHold,
    enqueue,
    removeItem,
    clearQueue,
    clearDraftQueue,
    dropSessions,
    migrateDraft,
    releaseFlushHold,
    resumeFlush,
    shouldEnqueue: (state: SessionState, conn: boolean) =>
      shouldEnqueueSend(state, conn),
    canShowQueueButton: (state: SessionState, conn: boolean, hasBody: boolean) =>
      canShowQueueButton(state, conn, hasBody),
  };
}
