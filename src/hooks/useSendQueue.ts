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
import * as api from "@/lib/api";
import type { SessionSnapshot, SessionState } from "@/lib/session";
import {
  applyClearSendQueuePlan,
  applyExternalQueuePush,
  claimQueueHead,
  dropQueuesForSessions,
  enqueueSend,
  getQueueForKey,
  makeQueuedSend,
  migrateDraftQueue,
  moveQueuedSend,
  planClearSendQueue,
  queuePreviewText,
  queueSessionKey,
  removeQueuedSend,
  reorderQueuedSend,
  requeueAfterFlushFail,
  SEND_QUEUE_MAX,
  setQueueForKey,
  shouldEnqueueSend,
  shouldHoldFlushForLive,
  updateQueuedSend,
  type ClearSendQueuePlan,
  type ExternalQueuePush,
  type QueueMoveDirection,
  type QueuedSend,
  type QueuedSendPatch,
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
  /** Primary window only — secondary has its own queue map and must not double-send. */
  acceptExternal?: boolean;
  labels: {
    sendFailed: string;
    droppedOldest: (n: number, max: number) => string;
    externalAdded?: (preview: string) => string;
    externalAddedOther?: (preview: string) => string;
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
  acceptExternal = false,
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

  // Host session API: mid-turn external prompts join this same map so the
  // composer strip updates immediately (drawing / tools / streaming).
  useEffect(() => {
    if (!acceptExternal || !api.hasHost()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void api
      .listen<ExternalQueuePush>("session://send_queue", (push) => {
        if (cancelled) return;
        const r = applyExternalQueuePush(sendQueueByKeyRef.current, push);
        if (!r.added) return;
        writeMap(r.byKey);
        if (r.dropped > 0) {
          showToast(labels.droppedOldest(r.dropped, SEND_QUEUE_MAX), 3200);
        }
        const preview = queuePreviewText(push.prompt ?? "", [], 48);
        const viewId = viewingSessionIdRef.current ?? sessionId;
        const same = !!viewId && viewId === (push.sessionId ?? "").trim();
        const toast = same
          ? labels.externalAdded?.(preview)
          : labels.externalAddedOther?.(preview);
        if (toast) showToast(toast, same ? 2800 : 4200);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    acceptExternal,
    labels,
    sessionId,
    showToast,
    viewingSessionIdRef,
    writeMap,
  ]);

  /** Enqueue a follow-up for the *viewed* session (ref, not stale React id). */
  const enqueue = useCallback(
    (input: {
      storedDisplay: string;
      attachments: Attachment[];
      goalMode: boolean;
    }) => {
      // Prefer viewing ref so a mid-render session switch cannot mis-key the item.
      const key = queueSessionKey(
        viewingSessionIdRef.current ?? sessionId,
      );
      const item = makeQueuedSend(input);
      const r = enqueueSend(getQueueForKey(sendQueueByKeyRef.current, key), item);
      writeMap(setQueueForKey(sendQueueByKeyRef.current, key, r.queue));
      if (r.dropped > 0) {
        showToast(labels.droppedOldest(r.dropped, SEND_QUEUE_MAX), 3200);
      }
      return r.dropped;
    },
    [sessionId, viewingSessionIdRef, showToast, labels, writeMap],
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

  const updateItem = useCallback(
    (id: string, patch: QueuedSendPatch) => {
      const key = queueSessionKey(sessionId);
      const prev = getQueueForKey(sendQueueByKeyRef.current, key);
      const updated = updateQueuedSend(prev, id, patch);
      if (updated === prev) return false;
      writeMap(setQueueForKey(sendQueueByKeyRef.current, key, updated));
      return true;
    },
    [sessionId, writeMap],
  );

  /** Reorder one step; does not pause or trigger flush beyond normal state. */
  const moveItem = useCallback(
    (id: string, direction: QueueMoveDirection) => {
      const key = queueSessionKey(sessionId);
      const prev = getQueueForKey(sendQueueByKeyRef.current, key);
      const updated = moveQueuedSend(prev, id, direction);
      if (updated === prev) return false;
      writeMap(setQueueForKey(sendQueueByKeyRef.current, key, updated));
      return true;
    },
    [sessionId, writeMap],
  );

  /** Reorder by index (clamp via pure helper); same flush semantics as moveItem. */
  const reorderItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      const key = queueSessionKey(sessionId);
      const prev = getQueueForKey(sendQueueByKeyRef.current, key);
      const updated = reorderQueuedSend(prev, fromIndex, toIndex);
      if (updated === prev) return false;
      writeMap(setQueueForKey(sendQueueByKeyRef.current, key, updated));
      return true;
    },
    [sessionId, writeMap],
  );

  /**
   * Clear the viewed session queue.
   * Prefer planning with {@link planClearQueue} + GlassModal confirm when
   * `confirmNeeded` before calling this (never window.confirm).
   */
  const clearQueue = useCallback((): ClearSendQueuePlan => {
    const key = queueSessionKey(sessionId);
    const prev = getQueueForKey(sendQueueByKeyRef.current, key);
    const plan = planClearSendQueue(prev);
    cancelFlushTimer();
    writeMap(applyClearSendQueuePlan(sendQueueByKeyRef.current, key, plan));
    return plan;
  }, [sessionId, writeMap, cancelFlushTimer]);

  /** Pure clear plan for the viewed queue (does not mutate). */
  const planClearQueue = useCallback((): ClearSendQueuePlan => {
    const key = queueSessionKey(sessionId);
    return planClearSendQueue(getQueueForKey(sendQueueByKeyRef.current, key));
  }, [sessionId]);

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
    // Strict isolation: only ever claim the *viewed* session's queue.
    // Never fall back to live.sessionId (that mixed draft UI with foreign queues).
    const claimKey = queueSessionKey(viewId);
    if (!getQueueForKey(sendQueueByKeyRef.current, claimKey).length) return;

    // Same-session busy only: wait for this chat's turn to finish.
    // Foreign busy must NOT block — executeSend demotes and spawns concurrent work.
    if (shouldHoldFlushForLive(live.sessionId, live.state, viewId)) {
      return;
    }

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

  // Auto-send next queued follow-up when *this viewed session* can take a turn.
  useEffect(() => {
    if (sessionState !== "ready" && sessionState !== "idle") return;
    if (connecting || sendInFlightRef.current || queueFlushHoldRef.current) {
      return;
    }
    // Viewed key only — never the live host's key when they differ.
    const viewId = viewingSessionIdRef.current ?? sessionId;
    const key = queueSessionKey(viewId);
    if (!getQueueForKey(sendQueueByKeyRef.current, key).length) return;
    const live = liveHostRef.current;
    // Hold only when this same session is mid-turn on Host.
    if (shouldHoldFlushForLive(live.sessionId, live.state, viewId)) {
      return;
    }
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
    viewingSessionIdRef,
    liveHostRef,
  ]);

  /** Clear hold and try flush immediately (user retry). */
  const resumeFlush = useCallback(() => {
    setHold(false);
    // Defer so ref/state settle before claim.
    window.setTimeout(() => flush(), 0);
  }, [setHold, flush]);

  /** Pause auto-flush (e.g. while editing a queued item). */
  const pauseFlush = useCallback(() => {
    setHold(true);
  }, [setHold]);

  return {
    activeQueue,
    flushHold,
    enqueue,
    removeItem,
    updateItem,
    moveItem,
    reorderItem,
    clearQueue,
    planClearQueue,
    clearDraftQueue,
    dropSessions,
    migrateDraft,
    releaseFlushHold,
    pauseFlush,
    resumeFlush,
    shouldEnqueue: (state: SessionState, conn: boolean) =>
      shouldEnqueueSend(state, conn),
    canShowQueueButton: (
      state: SessionState,
      conn: boolean,
      hasBody: boolean,
    ) => hasBody && shouldEnqueueSend(state, conn),
  };
}
