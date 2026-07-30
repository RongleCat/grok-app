/**
 * Recent session-trace export history (localStorage ring buffer).
 *
 * Stores **paths only** — never file contents (traces can be large).
 * Entries: { sessionId, title?, path, exportedAt }, max ~20, newest first.
 */

export type TraceHistoryEntry = {
  sessionId: string;
  title?: string;
  path: string;
  exportedAt: string;
};

export const TRACE_HISTORY_STORAGE_KEY = "grok.traceHistory";
export const TRACE_HISTORY_MAX = 20;

/** Fired on `window` after a successful record (detail = entries). */
export const TRACE_HISTORY_CHANGE_EVENT = "grok-trace-history-change";

/** Minimal storage surface so unit tests need no jsdom. */
export interface TraceHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TraceHistoryStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/**
 * Basename of a path for UI labels (no FS I/O).
 * Handles POSIX and Windows separators.
 */
export function traceHistoryFileName(path: string): string {
  const p = (path || "").trim();
  if (!p) return "";
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Normalize one raw object into a TraceHistoryEntry, or null if invalid.
 * Only known fields; no free-form payload that could carry secrets.
 */
export function parseTraceHistoryEntry(raw: unknown): TraceHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sessionId =
    typeof o.sessionId === "string" ? o.sessionId.trim() : "";
  const path = typeof o.path === "string" ? o.path.trim() : "";
  if (!sessionId || !path) return null;
  // Reject obviously empty / control-char only paths
  if (!path.replace(/[\s\u0000-\u001f]/g, "").length) return null;

  const exportedAt =
    typeof o.exportedAt === "string" && o.exportedAt.trim()
      ? o.exportedAt.trim()
      : new Date(0).toISOString();

  const titleRaw = o.title;
  let title: string | undefined;
  if (typeof titleRaw === "string") {
    const t = titleRaw.trim();
    // Cap title length for storage / UI; never store multi-kb blobs as "title"
    if (t) title = t.slice(0, 200);
  }

  return { sessionId, path, exportedAt, ...(title ? { title } : {}) };
}

/**
 * Parse stored JSON into a clean, newest-first list (capped).
 * Tolerates corrupt / partial data.
 */
export function parseTraceHistory(
  raw: unknown,
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  let list: unknown[] = [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  } else {
    return [];
  }

  const out: TraceHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const e = parseTraceHistoryEntry(item);
    if (!e) continue;
    // Dedup by path (same file should appear once, keep first = newest)
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pure ring-buffer push: newest first, max length, dedupe by path.
 * Does not touch storage.
 */
export function pushTraceHistory(
  existing: readonly TraceHistoryEntry[],
  entry: TraceHistoryEntry,
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const next = parseTraceHistoryEntry(entry);
  if (!next) return parseTraceHistory(existing, max);
  const rest = existing.filter((e) => e.path !== next.path);
  return parseTraceHistory([next, ...rest], max);
}

export function loadTraceHistory(
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  try {
    return parseTraceHistory(
      storage.getItem(TRACE_HISTORY_STORAGE_KEY),
      max,
    );
  } catch {
    /* private mode */
    return [];
  }
}

export function saveTraceHistory(
  entries: readonly TraceHistoryEntry[],
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): void {
  const clean = parseTraceHistory(entries, max);
  try {
    storage.setItem(TRACE_HISTORY_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Record a successful export: load → push → save → notify.
 * Returns the updated list (paths only).
 */
export function recordTraceExport(
  input: {
    sessionId: string;
    path: string;
    title?: string | null;
    exportedAt?: string;
  },
  storage: TraceHistoryStorage = defaultStorage(),
  max = TRACE_HISTORY_MAX,
): TraceHistoryEntry[] {
  const entry: TraceHistoryEntry = {
    sessionId: input.sessionId,
    path: input.path,
    exportedAt: input.exportedAt || new Date().toISOString(),
    ...(input.title && String(input.title).trim()
      ? { title: String(input.title).trim().slice(0, 200) }
      : {}),
  };
  const next = pushTraceHistory(loadTraceHistory(storage, max), entry, max);
  saveTraceHistory(next, storage, max);
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(TRACE_HISTORY_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
  return next;
}

/** Short label for list rows: title, else session id prefix. */
export function traceHistoryLabel(entry: TraceHistoryEntry): string {
  const t = (entry.title || "").trim();
  if (t) return t;
  const id = entry.sessionId.trim();
  if (id.length <= 12) return id;
  return id.slice(0, 8) + "…";
}
