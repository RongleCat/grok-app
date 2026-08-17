import type { Attachment } from "@/lib/attachments";
import type { ComposerQuote } from "@/lib/composerQuotes";
import { previewStoredAsSlash } from "@/lib/draftDoc";
import { isSessionBusy, type SessionState } from "@/lib/session";

/** Max follow-ups kept per session (FIFO drop oldest when exceeded). */
export const SEND_QUEUE_MAX = 20;

export type QueuedSendSource = "composer" | "external";

export interface QueuedSend {
  id: string;
  /** Display form stored in journal / user bubble (`[[skill:…]]` tokens). */
  storedDisplay: string;
  attachments: Attachment[];
  quotes?: ComposerQuote[];
  goalMode: boolean;
  createdAt: number;
  /** Absent / composer = typed in this window. `external` = session API. */
  source?: QueuedSendSource;
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
  quotes?: ComposerQuote[];
  goalMode: boolean;
  now?: number;
  id?: string;
  source?: QueuedSendSource;
}): QueuedSend {
  return {
    id: input.id && input.id.trim() ? input.id : newQueueId(),
    storedDisplay: input.storedDisplay,
    attachments: input.attachments.map((a) => ({ ...a })),
    quotes: input.quotes?.map((q) => ({ ...q })),
    goalMode: input.goalMode,
    createdAt: input.now ?? Date.now(),
    source: input.source,
  };
}

/** Host `session://send_queue` payload (camelCase). */
export type ExternalQueuePush = {
  sessionId?: string;
  itemId?: string;
  prompt?: string;
  source?: string;
  createdAt?: number;
};

/**
 * Merge an external (session API) follow-up into the per-session map.
 * Dedups by `itemId` across keys so main + event replay do not double.
 */
export function applyExternalQueuePush(
  byKey: Record<string, QueuedSend[]>,
  push: ExternalQueuePush,
  max = SEND_QUEUE_MAX,
): { byKey: Record<string, QueuedSend[]>; dropped: number; added: boolean } {
  const sessionId = (push.sessionId ?? "").trim();
  const itemId = (push.itemId ?? "").trim();
  const prompt = (push.prompt ?? "").trim();
  if (!sessionId || sessionId === "__draft__" || !itemId || !prompt) {
    return { byKey, dropped: 0, added: false };
  }
  for (const rows of Object.values(byKey)) {
    if (rows.some((row) => row.id === itemId)) {
      return { byKey, dropped: 0, added: false };
    }
  }
  const item = makeQueuedSend({
    id: itemId,
    storedDisplay: prompt,
    attachments: [],
    goalMode: false,
    now: typeof push.createdAt === "number" ? push.createdAt : undefined,
    source: "external",
  });
  const key = queueSessionKey(sessionId);
  const r = enqueueSend(getQueueForKey(byKey, key), item, max);
  return {
    byKey: setQueueForKey(byKey, key, r.queue),
    dropped: r.dropped,
    added: true,
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
 * **Only a live turn** on the viewed session enqueues (`streaming`).
 * `connecting` is handshake / warm-connect (fork, first open, reconnect) —
 * not a turn. Enqueueing there parks the first message after fork until
 * connect finishes, and “Guide” cannot steer a turn that has not started.
 * First send must go through `executeSend` → `ensureConnected`.
 *
 * `awaiting_permission` does not enqueue — the user must decide first
 * (`canType` is false).
 *
 * The UI `connecting` flag is **process-global** (any `ensureConnected`,
 * including reconnect / compact / another chat’s spawn). It must **not**
 * gate enqueue: treating it as busy re-created the empty “new chat →
 * 本会话队列” anomaly while a foreign connect was in flight (R7 class).
 * Same-session follow-ups already flip `session.state` to `streaming`
 * optimistically in `executeSend` before that flag is set.
 *
 * Host busy on a *different* chat must **not** enqueue either — that path
 * is multi-session concurrent send (`executeSend` demotes + spawns).
 *
 * @param _connecting Kept for call-site compatibility; ignored for gating.
 */
export function shouldEnqueueSend(
  state: SessionState,
  _connecting: boolean,
): boolean {
  return state === "streaming";
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
  // Only a live turn holds flush. Handshake `connecting` must not park the
  // queue — executeSend waits on ensureConnected instead.
  if (
    liveState !== "streaming" &&
    liveState !== "awaiting_permission"
  ) {
    return false;
  }
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

export type QueueMoveDirection = "up" | "down";

/**
 * Move a queued item one step toward the head (`up`) or tail (`down`).
 * Immutable; returns the same array ref when id is missing, the move would
 * leave the bounds, or the queue has fewer than two items.
 */
export function moveQueuedSend(
  queue: QueuedSend[],
  id: string,
  direction: QueueMoveDirection,
): QueuedSend[] {
  if (queue.length < 2) return queue;
  const idx = queue.findIndex((q) => q.id === id);
  if (idx < 0) return queue;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= queue.length) return queue;
  const next = queue.slice();
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item!);
  return next;
}

/**
 * Move the item at `fromIndex` to `toIndex`. Both indices are clamped into
 * `[0, length-1]`. Immutable; returns the same array ref when the queue has
 * fewer than two items or the clamped indices are equal (no-op).
 */
export function reorderQueuedSend(
  queue: QueuedSend[],
  fromIndex: number,
  toIndex: number,
): QueuedSend[] {
  if (queue.length < 2) return queue;
  if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return queue;
  const from = Math.max(0, Math.min(queue.length - 1, Math.trunc(fromIndex)));
  const to = Math.max(0, Math.min(queue.length - 1, Math.trunc(toIndex)));
  if (from === to) return queue;
  const next = queue.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
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
 * Same-session FSM busy only — never for foreign live turns or global connect.
 */
export function canShowQueueButton(
  state: SessionState,
  connecting: boolean,
  hasBody: boolean,
): boolean {
  return hasBody && shouldEnqueueSend(state, connecting);
}

// ---------------------------------------------------------------------------
// SEND-QUEUE-PRO — clear plan · empty honesty · strip state · reorder
// ---------------------------------------------------------------------------
// Pure helpers for the composer queue strip. Clear always goes through an
// in-app confirm (GlassModal) when count > 0 — never window.confirm.
// Log meta and summaries never include message bodies.

/** Counts for clear dialog / toast honesty (no message bodies). */
export type SendQueueSummary = {
  count: number;
  /** Items that carry at least one attachment. */
  withAttachments: number;
  /** Items with goalMode enabled. */
  goalModeCount: number;
  max: number;
  isEmpty: boolean;
  isFull: boolean;
  /** True when up/down reorder is meaningful (≥ 2 items). */
  canReorder: boolean;
};

/** Summarize a queue without reading message bodies into log meta. */
export function summarizeSendQueue(
  queue: readonly QueuedSend[] | null | undefined,
  max: number = SEND_QUEUE_MAX,
): SendQueueSummary {
  const list = Array.isArray(queue) ? queue : [];
  const count = list.length;
  let withAttachments = 0;
  let goalModeCount = 0;
  for (const item of list) {
    if (item.attachments?.length) withAttachments += 1;
    if (item.goalMode) goalModeCount += 1;
  }
  const cap = max > 0 ? max : 0;
  return {
    count,
    withAttachments,
    goalModeCount,
    max: cap,
    isEmpty: count === 0,
    isFull: cap > 0 && count >= cap,
    canReorder: count >= 2,
  };
}

/** True when move up/down / index reorder can change order. */
export function canReorderSendQueue(
  queue: readonly QueuedSend[] | null | undefined,
): boolean {
  return Array.isArray(queue) && queue.length >= 2;
}

/**
 * Pure clear-all plan for the viewed session queue.
 * Never mutates; never includes message bodies in logMeta.
 */
export type ClearSendQueuePlan = {
  ok: true;
  count: number;
  /** True when the UI should open a confirm (count > 0). */
  confirmNeeded: boolean;
  /** Next list after clear (always empty). */
  next: QueuedSend[];
  /** Safe meta for logs / toasts — count only. */
  logMeta: { clearedCount: number } | null;
  summary: SendQueueSummary;
};

/**
 * Plan a clear-all of the session queue.
 * Callers open GlassModal when `confirmNeeded`, then apply via
 * {@link applyClearSendQueuePlan} / hook `clearQueue`.
 */
export function planClearSendQueue(
  queue: readonly QueuedSend[] | null | undefined,
  max: number = SEND_QUEUE_MAX,
): ClearSendQueuePlan {
  const summary = summarizeSendQueue(queue, max);
  const count = summary.count;
  return {
    ok: true,
    count,
    confirmNeeded: count > 0,
    next: [],
    logMeta: count > 0 ? { clearedCount: count } : null,
    summary,
  };
}

/**
 * Apply a clear plan to a session key in the by-key map.
 * No-op (same ref) when the key is already absent and the plan is empty.
 */
export function applyClearSendQueuePlan(
  byKey: Record<string, QueuedSend[]>,
  key: string,
  plan: ClearSendQueuePlan,
): Record<string, QueuedSend[]> {
  return setQueueForKey(byKey, key, plan.next);
}

/** Composer strip presentation kinds. */
export type SendQueueStripKind = "empty" | "queued" | "hold";

export type SendQueueStripState = {
  kind: SendQueueStripKind;
  /** Whether the strip should render above the composer. */
  visible: boolean;
  count: number;
  canClear: boolean;
  canReorder: boolean;
  showHold: boolean;
};

/**
 * Resolve strip chrome for the active session queue.
 * Empty queues are not visible (strip hidden) — use
 * {@link resolveSendQueueEmptyState} for empty-honesty copy when needed.
 */
export function resolveSendQueueStripState(opts: {
  queue: readonly QueuedSend[] | null | undefined;
  flushHold?: boolean;
  max?: number;
}): SendQueueStripState {
  const summary = summarizeSendQueue(opts.queue, opts.max ?? SEND_QUEUE_MAX);
  const hold = Boolean(opts.flushHold) && summary.count > 0;
  if (summary.isEmpty) {
    return {
      kind: "empty",
      visible: false,
      count: 0,
      canClear: false,
      canReorder: false,
      showHold: false,
    };
  }
  return {
    kind: hold ? "hold" : "queued",
    visible: true,
    count: summary.count,
    canClear: true,
    canReorder: summary.canReorder,
    showHold: hold,
  };
}

/** Honest empty kinds when the strip has nothing to show. */
export type SendQueueEmptyKind = "empty";

export type SendQueueEmptyState = {
  kind: SendQueueEmptyKind;
  /** i18n key for empty title. */
  titleKey: "composer.queueEmptyTitle";
  /** i18n key for empty body. */
  bodyKey: "composer.queueEmptyBody";
};

/**
 * Resolve empty-state presentation for the queue strip region.
 * Returns `null` when there is at least one queued item (no empty UI).
 */
export function resolveSendQueueEmptyState(opts: {
  count: number;
}): SendQueueEmptyState | null {
  const n = Math.max(0, Math.floor(opts.count || 0));
  if (n > 0) return null;
  return {
    kind: "empty",
    titleKey: "composer.queueEmptyTitle",
    bodyKey: "composer.queueEmptyBody",
  };
}
