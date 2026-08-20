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
  applyExternalQueueTake,
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
  type ExternalQueueTake,
  type QueueMoveDirection,
  type QueuedSend,
  type QueuedSendPatch,
} from "@/lib/sendQueue";

export type ExecuteSendFromQueue = (opts: {
  storedDisplay: string;
  att: Attachment[];
  quotes?: import("@/lib/composerQuotes").ComposerQuote[];
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
  /** Optional session-keyed claims; the boolean remains a legacy fallback. */
  sendInFlightRef: MutableRefObject<boolean>;
  sendInFlightBySessionRef?: MutableRefObject<Set<string>>;
  connectingBySessionRef?: MutableRefObject<Set<string>>;
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
  sendInFlightBySessionRef,
  connectingBySessionRef,
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

  const queueFlushHoldByKeyRef = useRef<Set<string>>(new Set());
  /** UI-visible hold (ref alone does not re-render). */
  const [flushHold, setFlushHold] = useState(false);
  const flushQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeQueue = useMemo(
    () => getQueueForKey(sendQueueByKey, queueSessionKey(sessionId)),
    [sendQueueByKey, sessionId],
  );

  const viewedQueueKey = useCallback(
    () => queueSessionKey(viewingSessionIdRef.current ?? sessionId),
    [sessionId, viewingSessionIdRef],
  );

  const isSendInFlightForKey = useCallback(
    (key: string) =>
      sendInFlightBySessionRef
        ? sendInFlightBySessionRef.current.has(key)
        : sendInFlightRef.current,
    [sendInFlightBySessionRef, sendInFlightRef],
  );

  const isConnectingForKey = useCallback(
    (key: string) =>
      connectingBySessionRef
        ? connectingBySessionRef.current.has(key)
        : connecting,
    [connectingBySessionRef, connecting],
  );

  const setHoldForKey = useCallback(
    (key: string, on: boolean) => {
      const holds = queueFlushHoldByKeyRef.current;
      if (on) holds.add(key);
      else holds.delete(key);
      // The strip represents the queue currently on screen only. A failed
      // background queue must not paint/hold this session's composer.
      setFlushHold(holds.has(viewedQueueKey()));
    },
    [viewedQueueKey],
  );

  const setHold = useCallback(
    (on: boolean) => setHoldForKey(viewedQueueKey(), on),
    [setHoldForKey, viewedQueueKey],
  );

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
    let unlistenTake: (() => void) | undefined;
    let retryTimer: number | null = null;
    let wakeRetry: (() => void) | null = null;
    const onPush = (push: ExternalQueuePush) => {
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
    };
    const onTake = (take: ExternalQueueTake) => {
      if (cancelled) return;
      const r = applyExternalQueueTake(sendQueueByKeyRef.current, take);
      if (!r.removed) return;
      writeMap(r.byKey);
    };
    const register = async () => {
      let attempt = 0;
      while (!cancelled) {
        try {
          const fn = await api.listen<ExternalQueuePush>(
            "session://send_queue",
            onPush,
          );
          const fnTake = await api.listen<ExternalQueueTake>(
            "session://send_queue_take",
            onTake,
          );
          if (cancelled) {
            fn();
            fnTake();
          } else {
            unlisten = fn;
            unlistenTake = fnTake;
          }
          return;
        } catch (e) {
          if (cancelled) return;
          const delayMs = Math.min(5_000, 250 * 2 ** Math.min(attempt, 4));
          attempt += 1;
          if (attempt === 1 || attempt % 5 === 0) {
            console.warn(
              "[send-queue] external listener registration failed; retrying",
              e,
            );
          }
          await new Promise<void>((resolve) => {
            wakeRetry = resolve;
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              wakeRetry = null;
              resolve();
            }, delayMs);
          });
        }
      }
    };
    void register();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      wakeRetry?.();
      wakeRetry = null;
      unlisten?.();
      unlistenTake?.();
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
      quotes?: import("@/lib/composerQuotes").ComposerQuote[];
      goalMode: boolean;
    }) => {
      // Prefer viewing ref so a mid-render session switch cannot mis-key the item.
      const key = queueSessionKey(viewingSessionIdRef.current ?? sessionId);
      const item = makeQueuedSend(input);
      const r = enqueueSend(
        getQueueForKey(sendQueueByKeyRef.current, key),
        item,
      );
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
    setHoldForKey(key, false);
    return plan;
  }, [sessionId, writeMap, cancelFlushTimer, setHoldForKey]);

  /** Pure clear plan for the viewed queue (does not mutate). */
  const planClearQueue = useCallback((): ClearSendQueuePlan => {
    const key = queueSessionKey(sessionId);
    return planClearSendQueue(getQueueForKey(sendQueueByKeyRef.current, key));
  }, [sessionId]);

  const clearDraftQueue = useCallback(() => {
    writeMap(setQueueForKey(sendQueueByKeyRef.current, "__draft__", []));
    setHoldForKey("__draft__", false);
  }, [writeMap, setHoldForKey]);

  const dropSessions = useCallback(
    (sessionIds: Iterable<string>) => {
      const next = dropQueuesForSessions(sendQueueByKeyRef.current, sessionIds);
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
    const live = liveHostRef.current;
    const viewId = viewingSessionIdRef.current;
    // Strict isolation: only ever claim the *viewed* session's queue.
    // Never fall back to live.sessionId (that mixed draft UI with foreign queues).
    const claimKey = queueSessionKey(viewId);
    if (isSendInFlightForKey(claimKey)) return;
    if (isConnectingForKey(claimKey)) return;
    if (queueFlushHoldByKeyRef.current.has(claimKey)) return;
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
      try {
        const ok = await executeSendRef.current({
          storedDisplay: head.storedDisplay,
          att: head.attachments,
          quotes: head.quotes,
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
        // Hold only while the session is still live/busy. Terminal failures
        // (error/cancel/disconnect) must release the key so it can recover.
        const liveAfter = liveHostRef.current;
        const terminal =
          liveAfter.state === "ready" ||
          liveAfter.state === "disconnected" ||
          !!liveAfter.lastError;
        setHoldForKey(claimKey, !terminal);
        if (r.dropped > 0) {
          showToast(labels.droppedOldest(r.dropped, SEND_QUEUE_MAX), 3500);
        } else {
          showToast(labels.sendFailed, 3500);
        }
      } catch (e) {
        // Keep a rejected executeSend from leaving the queue claimed or the
        // hold permanently wedged. Requeue is idempotent by item id.
        const r = requeueAfterFlushFail(
          sendQueueByKeyRef.current,
          claimKey,
          head,
        );
        writeMap(r.byKey);
        setHoldForKey(claimKey, false);
        console.warn("[send-queue] flush failed", e);
      }
    })();
  }, [
    liveHostRef,
    viewingSessionIdRef,
    sendInFlightRef,
    sendInFlightBySessionRef,
    connectingBySessionRef,
    executeSendRef,
    showToast,
    labels,
    writeMap,
    setHoldForKey,
    isSendInFlightForKey,
    isConnectingForKey,
  ]);

  // Clear the viewed key's hold once a real turn is in progress again, and on
  // terminal/disconnected transitions. Holds for other sessions remain local.
  const previousSessionStateRef = useRef(sessionState);
  useEffect(() => {
    const key = viewedQueueKey();
    const wasBusy =
      previousSessionStateRef.current === "streaming" ||
      previousSessionStateRef.current === "awaiting_permission";
    const isBusy =
      sessionState === "streaming" || sessionState === "awaiting_permission";
    if (isBusy || (wasBusy && !isBusy) || sessionState === "disconnected") {
      setHoldForKey(key, false);
    }
    previousSessionStateRef.current = sessionState;
  }, [sessionState, sessionId, setHoldForKey, viewedQueueKey]);

  // Keep the visible strip in sync when navigation changes without touching
  // another session's hold bit.
  useEffect(() => {
    setFlushHold(queueFlushHoldByKeyRef.current.has(viewedQueueKey()));
  }, [sessionId, viewedQueueKey]);

  // Auto-send next queued follow-up when *this viewed session* can take a turn.
  useEffect(() => {
    if (sessionState !== "ready" && sessionState !== "idle") return;
    const viewId = viewingSessionIdRef.current ?? sessionId;
    const key = queueSessionKey(viewId);
    if (
      isConnectingForKey(key) ||
      isSendInFlightForKey(key) ||
      queueFlushHoldByKeyRef.current.has(key)
    ) {
      return;
    }
    // Viewed key only — never the live host's key when they differ.
    const viewed = getQueueForKey(sendQueueByKeyRef.current, key);
    if (!viewed.length) return;
    // Host owns `source: external` drain; GUI only displays those rows.
    if (viewed[0]?.source === "external") return;
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
    sendQueueByKey,
    flush,
    cancelFlushTimer,
    sendInFlightRef,
    sendInFlightBySessionRef,
    connectingBySessionRef,
    isConnectingForKey,
    isSendInFlightForKey,
    viewedQueueKey,
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
