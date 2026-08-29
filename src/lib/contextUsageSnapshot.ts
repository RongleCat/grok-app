/**
 * Per-session usage snapshot (localStorage) for the context usage chip.
 *
 * `turn_completed` usage is streamed live but NOT persisted in the host
 * journal, so a reopened session falls back to the chars/CJK estimate and
 * the chip reads as ~0%. Keep a small per-session snapshot (last
 * agent-reported context size) and restore it on hydrate so history
 * sessions show real usage. Compact markers still win: they carry
 * authoritative post-compact snapshots.
 *
 * Split from contextUsage.ts (1k-line budget); re-exported there.
 */
import {
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  type ContextUsageMessage,
  type ContextUsageState,
} from "./contextUsage";

// ---------------------------------------------------------------------------
// SESSION-USAGE SNAPSHOT (localStorage)
// ---------------------------------------------------------------------------
// `turn_completed` usage is streamed live but NOT persisted in the host
// journal, so a reopened session falls back to the chars/CJK estimate and the
// chip reads as ~0%. Keep a small per-session snapshot (last agent-reported
// context size) and restore it on hydrate so history sessions show real usage.
// Compact markers still win: they carry authoritative post-compact snapshots.

const SESSION_USAGE_SNAPSHOT_KEY = "grok.sessionUsageSnapshots";
const SESSION_USAGE_SNAPSHOT_MAX = 200;

export type SessionUsageSnapshot = {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  systemTokens: number | null;
  toolsTokens: number | null;
  historyTokens: number | null;
  cachedReadTokens: number | null;
  costUsdTicks: number | null;
  /** CLI context window (tokens) at snapshot time — restore ring denominator. */
  contextWindow?: number | null;
  /** CLI integer percentage at snapshot time (auto_compact_started style). */
  percentage?: number | null;
  source: string | null;
  updatedAt: number;
};

function snapshotStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readSnapshotMap(
  storage: Storage | null = snapshotStorage(),
): Record<string, SessionUsageSnapshot> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SESSION_USAGE_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, SessionUsageSnapshot>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Persist the latest agent-reported usage for a session (all sessions, not only focused). */
export function saveSessionUsageSnapshot(
  sessionId: string,
  usage: Omit<SessionUsageSnapshot, "updatedAt">,
  storage: Storage | null = snapshotStorage(),
): void {
  if (!storage || !sessionId) return;
  try {
    const map = readSnapshotMap(storage);
    map[sessionId] = { ...usage, updatedAt: Date.now() };
    const entries = Object.entries(map);
    if (entries.length > SESSION_USAGE_SNAPSHOT_MAX) {
      entries.sort(
        (a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0),
      );
      const keep = Object.fromEntries(entries.slice(0, SESSION_USAGE_SNAPSHOT_MAX));
      storage.setItem(SESSION_USAGE_SNAPSHOT_KEY, JSON.stringify(keep));
    } else {
      storage.setItem(SESSION_USAGE_SNAPSHOT_KEY, JSON.stringify(map));
    }
  } catch {
    /* quota / private mode */
  }
}

/** Last agent-reported usage for a session, or null. */
export function loadSessionUsageSnapshot(
  sessionId: string,
  storage: Storage | null = snapshotStorage(),
): SessionUsageSnapshot | null {
  if (!sessionId) return null;
  const map = readSnapshotMap(storage);
  return map[sessionId] ?? null;
}

/** Remove a session's snapshot (session deleted / forgotten). */
export function clearSessionUsageSnapshot(
  sessionId: string,
  storage: Storage | null = snapshotStorage(),
): void {
  if (!sessionId) return;
  try {
    const map = readSnapshotMap(storage);
    if (!(sessionId in map)) return;
    delete map[sessionId];
    storage?.setItem(SESSION_USAGE_SNAPSHOT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Hydrate a session's context usage, then restore the last real
 * agent-reported usage snapshot when the journal has no compact markers
 * (compact snapshots are authoritative and win).
 */
export function restoreContextUsageForSession(
  sessionId: string,
  messages: ContextUsageMessage[],
  storage: Storage | null = snapshotStorage(),
): ContextUsageState {
  const base = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
    type: "hydrate",
    messages,
  });
  if (base.knownTokens != null || base.lastCompact != null) return base;
  const snap = loadSessionUsageSnapshot(sessionId, storage);
  if (!snap) return base;
  return reduceContextUsage(base, {
    type: "usage",
    totalTokens: snap.totalTokens ?? undefined,
    inputTokens: snap.inputTokens ?? undefined,
    outputTokens: snap.outputTokens ?? undefined,
    systemTokens: snap.systemTokens ?? undefined,
    toolsTokens: snap.toolsTokens ?? undefined,
    historyTokens: snap.historyTokens ?? undefined,
    cachedReadTokens: snap.cachedReadTokens ?? undefined,
    costUsdTicks: snap.costUsdTicks ?? undefined,
    contextWindow: snap.contextWindow ?? undefined,
    percentage: snap.percentage ?? undefined,
    source: snap.source ?? "restored",
  });
}
