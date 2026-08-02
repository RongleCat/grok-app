/**
 * Merge high-frequency stream chunks before React setState.
 * Same session + messageId + kind text is concatenated; terminal `done`
 * and thought phase boundaries flush immediately.
 *
 * Adaptive flushMs targets fewer setMessages/sec on lower-core (Intel) machines
 * without delaying turn-end honesty (`done` / phase boundaries stay immediate).
 */

export type CoalesceStreamChunk = {
  sessionId?: string | null;
  messageId?: string | null;
  text?: string | null;
  done?: boolean | null;
  kind?: string | null;
  thoughtPhase?: string | null;
};

/**
 * Default stream coalesce interval (ms). Used when core count is mid-range
 * or when the caller does not pass an explicit flushMs.
 * Higher than the historical 48ms to cut React message flushes on long turns.
 */
export const STREAM_COALESCE_FLUSH_MS = 110;

/**
 * Pick a stream flush interval from hardware concurrency.
 * Fewer cores → longer batch window (Intel MBP / low-power laptops).
 * More cores → slightly snappier UI updates.
 */
export function resolveStreamFlushMs(
  hardwareConcurrency: number = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency || 8
    : 8,
): number {
  if (hardwareConcurrency <= 8) return 128;
  if (hardwareConcurrency <= 12) return STREAM_COALESCE_FLUSH_MS;
  return 72;
}

/** Stable key for mergeable stream rows. */
export function streamCoalesceKey(chunk: CoalesceStreamChunk): string {
  const sid = chunk.sessionId ?? "";
  const mid = chunk.messageId ?? "";
  const kind = chunk.kind ?? "assistant";
  return `${sid}\0${mid}\0${kind}`;
}

/** Whether this chunk must not wait in the batch buffer. */
export function streamChunkNeedsImmediateFlush(chunk: CoalesceStreamChunk): boolean {
  if (chunk.done) return true;
  const phase = (chunk.thoughtPhase ?? "").toLowerCase();
  // Phase boundary opens a new thought block — flush prior + this promptly.
  if (phase === "new" || phase === "open") return true;
  return false;
}

/**
 * Merge `next` into `prev` when they share the coalesce key.
 * Returns null when they cannot merge (caller should flush prev first).
 */
export function mergeStreamChunks(
  prev: CoalesceStreamChunk,
  next: CoalesceStreamChunk,
): CoalesceStreamChunk | null {
  if (streamCoalesceKey(prev) !== streamCoalesceKey(next)) return null;
  const text = `${prev.text ?? ""}${next.text ?? ""}`;
  const done = !!(prev.done || next.done);
  // Prefer the latest non-empty thought phase (new/open/continue).
  const thoughtPhase =
    next.thoughtPhase && next.thoughtPhase !== "none"
      ? next.thoughtPhase
      : prev.thoughtPhase;
  return {
    ...prev,
    ...next,
    text,
    done,
    thoughtPhase: thoughtPhase ?? next.thoughtPhase ?? prev.thoughtPhase,
  };
}

export type StreamCoalescerOptions = {
  /** Max hold time before a non-terminal batch is flushed (default STREAM_COALESCE_FLUSH_MS). */
  flushMs?: number;
  /** Deliver one (possibly merged) chunk to the UI reducer. */
  onFlush: (chunk: CoalesceStreamChunk) => void;
};

/**
 * Batches stream chunks per key. Call `push` from the Tauri event listener
 * and `dispose` on unmount / cancel.
 */
export class StreamCoalescer {
  private readonly flushMs: number;
  private readonly onFlush: (chunk: CoalesceStreamChunk) => void;
  private pending = new Map<string, CoalesceStreamChunk>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(opts: StreamCoalescerOptions) {
    this.flushMs = Math.max(8, opts.flushMs ?? STREAM_COALESCE_FLUSH_MS);
    this.onFlush = opts.onFlush;
  }

  /** Current flush interval (ms). */
  get intervalMs(): number {
    return this.flushMs;
  }

  push(chunk: CoalesceStreamChunk): void {
    if (this.disposed) return;
    const key = streamCoalesceKey(chunk);
    const existing = this.pending.get(key);
    if (existing) {
      const merged = mergeStreamChunks(existing, chunk);
      if (merged) {
        if (streamChunkNeedsImmediateFlush(merged)) {
          this.pending.delete(key);
          this.onFlush(merged);
          this.armOrClear();
          return;
        }
        this.pending.set(key, merged);
        this.armOrClear();
        return;
      }
      // Different shape (shouldn't for same key) — flush old.
      this.pending.delete(key);
      this.onFlush(existing);
    }

    if (streamChunkNeedsImmediateFlush(chunk) || !(chunk.text ?? "")) {
      this.onFlush(chunk);
      this.armOrClear();
      return;
    }

    this.pending.set(key, chunk);
    this.armOrClear();
  }

  /** Flush all pending immediately (turn end / unmount). */
  flushAll(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const c of items) this.onFlush(c);
  }

  dispose(): void {
    this.flushAll();
    this.disposed = true;
  }

  private armOrClear(): void {
    if (this.pending.size === 0) {
      if (this.timer != null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAll();
      // Trailing re-arm: if onFlush callbacks pushed more chunks, schedule again.
      this.armOrClear();
    }, this.flushMs);
  }
}

// ─── High-frequency non-stream batching (tool progress / detail) ────────────

export type TimedBatchQueueOptions<T> = {
  /** Max hold time before a non-terminal batch is flushed. */
  flushMs?: number;
  /** Deliver the ordered batch to the UI (single setState preferred). */
  onFlush: (items: T[]) => void;
  /** When true, flush immediately including this item (terminal statuses). */
  shouldFlushImmediate?: (item: T) => boolean;
};

/**
 * Order-preserving timer batch for heterogeneous high-frequency events
 * (e.g. `session://tool` progress/detail). Unlike {@link StreamCoalescer},
 * items are not text-merged — they are applied in sequence in one flush.
 */
export class TimedBatchQueue<T> {
  private readonly flushMs: number;
  private readonly onFlush: (items: T[]) => void;
  private readonly shouldFlushImmediate?: (item: T) => boolean;
  private pending: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(opts: TimedBatchQueueOptions<T>) {
    this.flushMs = Math.max(8, opts.flushMs ?? STREAM_COALESCE_FLUSH_MS);
    this.onFlush = opts.onFlush;
    this.shouldFlushImmediate = opts.shouldFlushImmediate;
  }

  push(item: T): void {
    if (this.disposed) return;
    this.pending.push(item);
    if (this.shouldFlushImmediate?.(item)) {
      this.flushAll();
      return;
    }
    this.armOrClear();
  }

  flushAll(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const items = this.pending;
    this.pending = [];
    this.onFlush(items);
  }

  dispose(): void {
    this.flushAll();
    this.disposed = true;
  }

  private armOrClear(): void {
    if (this.pending.length === 0) {
      if (this.timer != null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (this.timer != null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAll();
      // Trailing re-arm if flush callbacks enqueued more work.
      this.armOrClear();
    }, this.flushMs);
  }
}

/** Terminal tool statuses that must not wait in the tool batch buffer. */
export function toolEventNeedsImmediateFlush(status?: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return (
    s === "completed" ||
    s === "failed" ||
    s === "error" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "done"
  );
}
