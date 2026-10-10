/**
 * Per-session subagent telemetry store.
 *
 * The host broadcasts `session://subagent` from the CLI's
 * `subagent_spawned` / `subagent_progress` / `subagent_finished`
 * notifications. {@link ./session/subagents} merges those pushes; this module
 * keeps one merged list per App session.
 *
 * The subscription is established app-level (see `useSessionHostEvents`), not
 * by the Tasks panel, because that panel mounts on demand — telemetry that
 * arrived before the user opened it cannot be backfilled.
 */

import {
  applySubagentEvent,
  type SubagentEventPayload,
  type SubagentRun,
} from "./session/subagents";

export type { SubagentEventPayload, SubagentRun };

type Listener = () => void;

const EMPTY: readonly SubagentRun[] = [];

/** Sessions kept at once; the least recently touched is evicted first. */
export const SUBAGENT_STORE_MAX_SESSIONS = 32;

/** Runs kept per session; oldest are dropped first. */
export const SUBAGENT_STORE_MAX_RUNS = 100;

class SubagentStore {
  /** Insertion order doubles as LRU order (`touch` re-inserts the key). */
  private readonly bySession = new Map<string, SubagentRun[]>();
  private readonly listeners = new Set<Listener>();
  private rev = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bump-on-change revision — identity for useSyncExternalStore. */
  getSnapshot = (): number => this.rev;

  /** Merged runs for one session, in spawn order. Stable when unchanged. */
  list(sessionId: string | null | undefined): readonly SubagentRun[] {
    if (!sessionId) return EMPTY;
    return this.bySession.get(sessionId) ?? EMPTY;
  }

  apply(payload: SubagentEventPayload): void {
    const sid =
      typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    if (!sid) return;
    const prev = this.bySession.get(sid) ?? [];
    const next = applySubagentEvent(prev, payload);
    if (next === prev) return;
    // Re-insert so the most recently active session is last (newest) in the
    // eviction order; Map keeps insertion order.
    this.bySession.delete(sid);
    this.bySession.set(
      sid,
      next.length > SUBAGENT_STORE_MAX_RUNS
        ? next.slice(next.length - SUBAGENT_STORE_MAX_RUNS)
        : next,
    );
    while (this.bySession.size > SUBAGENT_STORE_MAX_SESSIONS) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === undefined) break;
      this.bySession.delete(oldest);
    }
    this.rev += 1;
    for (const l of this.listeners) l();
  }

  resetForTests(): void {
    this.bySession.clear();
    this.rev += 1;
    for (const l of this.listeners) l();
  }
}

export const subagentStore = new SubagentStore();
