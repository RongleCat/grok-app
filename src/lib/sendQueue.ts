import type { Attachment } from "@/lib/attachments";
import { previewStoredAsSlash } from "@/lib/draftDoc";
import { isSessionBusy, type SessionState } from "@/lib/session";

/** Max follow-ups kept per session (FIFO drop oldest when exceeded). */
export const SEND_QUEUE_MAX = 20;

export interface QueuedSend {
  id: string;
  /** Display form stored in journal / user bubble (`[[skill:…]]` tokens). */
  storedDisplay: string;
  attachments: Attachment[];
  goalMode: boolean;
  createdAt: number;
}

export function queueSessionKey(sessionId: string | null | undefined): string {
  return sessionId ?? "__draft__";
}

function newQueueId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `q-${c.randomUUID()}`;
  }
  // Extremely old runtimes only — still better than Date.now alone.
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function makeQueuedSend(input: {
  storedDisplay: string;
  attachments: Attachment[];
  goalMode: boolean;
  now?: number;
}): QueuedSend {
  return {
    id: newQueueId(),
    storedDisplay: input.storedDisplay,
    attachments: input.attachments.map((a) => ({ ...a })),
    goalMode: input.goalMode,
    createdAt: input.now ?? Date.now(),
  };
}

export type QueuePreviewLabels = {
  /** When only attachments and count > 1; may include `{n}`. */
  filesCount: (n: number) => string;
  /** Fallback when no text and no attachments. */
  empty?: string;
};

/** Preview for queue strip (single line, truncated). */
export function queuePreviewText(
  storedDisplay: string,
  attachments: Attachment[],
  maxLen = 72,
  labels?: QueuePreviewLabels,
): string {
  const line = previewStoredAsSlash(storedDisplay)
    .replace(/\s+/g, " ")
    .trim();
  if (line) {
    return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
  }
  if (attachments.length === 1) return attachments[0]!.name;
  if (attachments.length > 1) {
    return labels?.filesCount(attachments.length) ?? String(attachments.length);
  }
  return labels?.empty ?? "";
}

/**
 * Whether the composer should enqueue instead of calling the agent now.
 *
 * Same “busy” surface as {@link isSessionBusy}, plus the UI `connecting`
 * flag — except `awaiting_permission`, where the user must decide first
 * (and `canType` is false). Keeps the busy set from drifting.
 *
 * **Only the viewed session’s own busy state** enqueues. Host busy on a
 * *different* chat must **not** enqueue — that path is multi-session
 * concurrent send (`executeSend` demotes the foreign turn and spawns).
 * Enqueuing on foreign busy caused empty “new chat” queues (cross-session
 * anomaly) and serialised all work behind one turn.
 */
export function shouldEnqueueSend(
  state: SessionState,
  connecting: boolean,
): boolean {
  if (state === "awaiting_permission") return false;
  return connecting || isSessionBusy(state);
}

/**
 * Whether Host live is busy on a different session than the viewed one.
 *
 * Used for diagnostics / UI hints only — **not** for enqueue gating.
 * Concurrent send on draft/other chat should demote+spawn, not queue.
 */
export function isForeignLiveBusy(
  liveSessionId: string | null | undefined,
  liveState: SessionState | null | undefined,
  viewedSessionId: string | null | undefined,
): boolean {
  if (!liveSessionId || !liveState) return false;
  if (!isSessionBusy(liveState)) return false;
  // Draft view (null) while any live session is busy → foreign
  if (viewedSessionId == null || viewedSessionId === "") {
    return true;
  }
  return liveSessionId !== viewedSessionId;
}

/**
 * Whether auto-flush / claim should wait because the *claimed* session is
 * the one currently busy on Host (same-session follow-up queue).
 *
 * Draft (`viewId` null) is never “the same” as a live host id — flush may
 * demote and materialize a new chat. Foreign busy also does not block flush
 * of another session’s queue.
 */
export function shouldHoldFlushForLive(
  liveSessionId: string | null | undefined,
  liveState: SessionState | null | undefined,
  claimSessionId: string | null | undefined,
): boolean {
  if (!liveSessionId || !liveState) return false;
  if (!isSessionBusy(liveState)) return false;
  // Draft queue is never the live mid-turn session.
  if (claimSessionId == null || claimSessionId === "") return false;
  return liveSessionId === claimSessionId;
}

/**
 * Append item; drop oldest if over max.
 * Returns the new queue and how many oldest items were discarded.
 */
export function enqueueSend(
  queue: QueuedSend[],
  item: QueuedSend,
  max = SEND_QUEUE_MAX,
): { queue: QueuedSend[]; dropped: number } {
  const next = [...queue, item];
  if (next.length <= max) return { queue: next, dropped: 0 };
  const dropped = next.length - max;
  return { queue: next.slice(dropped), dropped };
}

export function removeQueuedSend(
  queue: QueuedSend[],
  id: string,
): QueuedSend[] {
  return queue.filter((q) => q.id !== id);
}

export type QueuedSendPatch = {
  storedDisplay?: string;
  attachments?: Attachment[];
  goalMode?: boolean;
};

/**
 * Patch a queued item by id.
 * Returns the same array ref when id is missing, the patch is a no-op, or
 * the result would be empty (no text and no attachments).
 */
export function updateQueuedSend(
  queue: QueuedSend[],
  id: string,
  patch: QueuedSendPatch,
): QueuedSend[] {
  const idx = queue.findIndex((q) => q.id === id);
  if (idx < 0) return queue;

  const cur = queue[idx]!;
  const nextDisplay =
    patch.storedDisplay !== undefined ? patch.storedDisplay : cur.storedDisplay;
  const nextAttachments =
    patch.attachments !== undefined
      ? patch.attachments.map((a) => ({ ...a }))
      : cur.attachments;
  const nextGoal =
    patch.goalMode !== undefined ? patch.goalMode : cur.goalMode;

  // Reject empty body with no attachments (caller may also validate).
  if (!nextDisplay.trim() && nextAttachments.length === 0) {
    return queue;
  }

  const displayChanged = nextDisplay !== cur.storedDisplay;
  const goalChanged = nextGoal !== cur.goalMode;
  const attChanged =
    patch.attachments !== undefined &&
    (nextAttachments.length !== cur.attachments.length ||
      nextAttachments.some((a, i) => {
        const b = cur.attachments[i];
        return (
          !b ||
          a.path !== b.path ||
          a.name !== b.name ||
          a.isDir !== b.isDir
        );
      }));

  if (!displayChanged && !goalChanged && !attChanged) {
    return queue;
  }

  const next = queue.slice();
  next[idx] = {
    ...cur,
    storedDisplay: nextDisplay,
    attachments: nextAttachments,
    goalMode: nextGoal,
  };
  return next;
}

/** Pop head; returns [head | null, rest]. */
export function dequeueSend(
  queue: QueuedSend[],
): [QueuedSend | null, QueuedSend[]] {
  if (!queue.length) return [null, queue];
  const [head, ...rest] = queue;
  return [head ?? null, rest];
}

/**
 * Put an item back at the front (e.g. flush claimed then executeSend failed).
 * No-op if the same id is already present.
 *
 * Over max: same FIFO as {@link enqueueSend} — drop oldest from the *rest*
 * (not the requeued head), so a failed claim is never discarded to make room.
 */
export function requeueAtFront(
  queue: QueuedSend[],
  item: QueuedSend,
  max = SEND_QUEUE_MAX,
): { queue: QueuedSend[]; dropped: number } {
  if (queue.some((q) => q.id === item.id)) {
    return { queue, dropped: 0 };
  }
  if (max <= 0) return { queue: [], dropped: queue.length + 1 };
  // Room for restored head + up to max-1 of the existing queue.
  const room = max - 1;
  const dropped = Math.max(0, queue.length - room);
  const rest = dropped > 0 ? queue.slice(dropped) : queue;
  return { queue: [item, ...rest], dropped };
}

export function getQueueForKey(
  byKey: Record<string, QueuedSend[]>,
  key: string,
): QueuedSend[] {
  return byKey[key] ?? [];
}

export function setQueueForKey(
  byKey: Record<string, QueuedSend[]>,
  key: string,
  queue: QueuedSend[],
): Record<string, QueuedSend[]> {
  if (!queue.length) {
    if (!(key in byKey)) return byKey;
    const next = { ...byKey };
    delete next[key];
    return next;
  }
  return { ...byKey, [key]: queue };
}

/**
 * Draft session materializes → move `__draft__` follow-ups onto the real id.
 * Appends after any items already keyed by `sessionId`.
 */
export function migrateDraftQueue(
  byKey: Record<string, QueuedSend[]>,
  sessionId: string,
): Record<string, QueuedSend[]> {
  const draftQ = byKey["__draft__"];
  if (!draftQ?.length) return byKey;
  const next = { ...byKey };
  delete next["__draft__"];
  const existing = next[sessionId] ?? [];
  next[sessionId] = [...existing, ...draftQ];
  return next;
}

/** Drop queue keys for permanently deleted sessions. */
export function dropQueuesForSessions(
  byKey: Record<string, QueuedSend[]>,
  sessionIds: Iterable<string>,
): Record<string, QueuedSend[]> {
  let changed = false;
  const next = { ...byKey };
  for (const id of sessionIds) {
    if (id in next) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : byKey;
}

/**
 * Claim head for flush (optimistic dequeue). Caller must requeue on send fail.
 * Returns null when empty.
 */
export function claimQueueHead(
  byKey: Record<string, QueuedSend[]>,
  key: string,
): { head: QueuedSend; byKey: Record<string, QueuedSend[]> } | null {
  const q = getQueueForKey(byKey, key);
  const [head, rest] = dequeueSend(q);
  if (!head) return null;
  return { head, byKey: setQueueForKey(byKey, key, rest) };
}

/**
 * After claim + failed executeSend: put head back (prefer post-migrate key).
 */
export function requeueAfterFlushFail(
  byKey: Record<string, QueuedSend[]>,
  key: string,
  head: QueuedSend,
): { byKey: Record<string, QueuedSend[]>; dropped: number } {
  const r = requeueAtFront(getQueueForKey(byKey, key), head);
  return { byKey: setQueueForKey(byKey, key, r.queue), dropped: r.dropped };
}

/**
 * Whether the busy-state Queue button should render (not permission wait).
 * Enter/send still use {@link shouldEnqueueSend} alone for the enqueue path.
 * Same-session busy only — never for foreign live turns.
 */
export function canShowQueueButton(
  state: SessionState,
  connecting: boolean,
  hasBody: boolean,
): boolean {
  return hasBody && shouldEnqueueSend(state, connecting);
}
