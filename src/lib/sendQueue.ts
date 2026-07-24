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
 */
export function shouldEnqueueSend(
  state: SessionState,
  connecting: boolean,
): boolean {
  if (state === "awaiting_permission") return false;
  return connecting || isSessionBusy(state);
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
 */
export function canShowQueueButton(
  state: SessionState,
  connecting: boolean,
  hasBody: boolean,
): boolean {
  return hasBody && shouldEnqueueSend(state, connecting);
}
