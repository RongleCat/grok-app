/**
 * Recently-used session ring (VS Code / Cursor Ctrl+Tab).
 *
 * First Ctrl+Tab is ping-pong with the previous chat. Holding Ctrl and
 * tapping Tab walks a frozen snapshot; releasing Ctrl commits the visit
 * (moves that id to the front). Immediate reorder on each tap would trap
 * you between two chats and never reach a third.
 */

export const SESSION_MRU_MAX = 20;
export const SESSION_MRU_STORAGE_KEY = "grok.sessionMru";

export type SessionMruDir = "next" | "prev";

export type SessionMruCycle = {
  snapshot: string[];
  index: number;
};

/** Minimal storage so unit tests need no jsdom. */
export interface SessionMruStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionMruStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function trimId(id: string | null | undefined): string {
  return (id ?? "").trim();
}

/**
 * Dedupe, drop empties, cap. First occurrence wins (caller puts newest first).
 */
export function normalizeSessionMru(
  ids: readonly unknown[],
  max = SESSION_MRU_MAX,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Move `id` to the front. Empty / whitespace id is a no-op. */
export function touchSessionMru(
  list: readonly string[],
  id: string | null | undefined,
  max = SESSION_MRU_MAX,
): string[] {
  const tid = trimId(id);
  if (!tid) return normalizeSessionMru(list, max);
  return normalizeSessionMru([tid, ...list], max);
}

/** Keep ids that still exist in the live catalog. */
export function filterSessionMru(
  list: readonly string[],
  liveIds: readonly string[],
): string[] {
  const live = new Set<string>();
  for (const id of liveIds) {
    const t = trimId(id);
    if (t) live.add(t);
  }
  return list.filter((id) => live.has(id));
}

/**
 * Frozen cycle list: current (if live) then MRU hits that are still live.
 * Does not append never-visited sidebar rows — this is recency, not visual order.
 */
export function sessionMruSnapshot(
  list: readonly string[],
  liveIds: readonly string[],
  currentId: string | null | undefined,
): string[] {
  const live = new Set<string>();
  for (const id of liveIds) {
    const t = trimId(id);
    if (t) live.add(t);
  }
  const snapshot: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const id = trimId(raw);
    if (!id || !live.has(id) || seen.has(id)) return;
    seen.add(id);
    snapshot.push(id);
  };
  push(trimId(currentId));
  for (const id of list) push(id);
  return snapshot;
}

export function stepSessionMruIndex(
  length: number,
  index: number,
  dir: SessionMruDir,
): number {
  if (length <= 0) return 0;
  if (dir === "next") return (index + 1 + length) % length;
  return (index - 1 + length) % length;
}

/**
 * Start a Ctrl-held cycle. Returns null when there is nowhere to go
 * (empty, or a single live row that is already current).
 *
 * New-chat (no current id) with one recent row → that row.
 */
export function beginSessionMruCycle(
  list: readonly string[],
  liveIds: readonly string[],
  currentId: string | null | undefined,
  dir: SessionMruDir,
): SessionMruCycle | null {
  const snapshot = sessionMruSnapshot(list, liveIds, currentId);
  const current = trimId(currentId);
  if (snapshot.length === 0) return null;
  if (snapshot.length === 1 && current && snapshot[0] === current) {
    return null;
  }
  const start = current && snapshot[0] === current ? 0 : -1;
  return {
    snapshot,
    index: stepSessionMruIndex(snapshot.length, start, dir),
  };
}

export function stepSessionMruCycle(
  cycle: SessionMruCycle,
  dir: SessionMruDir,
): SessionMruCycle {
  return {
    snapshot: cycle.snapshot,
    index: stepSessionMruIndex(cycle.snapshot.length, cycle.index, dir),
  };
}

export function sessionMruCycleTarget(
  cycle: SessionMruCycle | null,
): string | null {
  if (!cycle || cycle.snapshot.length === 0) return null;
  return cycle.snapshot[cycle.index] ?? null;
}

export type SessionMruPanelRow = {
  id: string;
  title: string;
  projectName: string;
};

export type SessionMruPanelState = {
  rows: SessionMruPanelRow[];
  index: number;
} | null;

/** Snapshot + labels for the Ctrl-held switcher panel. */
export function buildSessionMruPanelState(
  cycle: SessionMruCycle | null,
  getRow: (id: string) => { title: string; projectName: string } | null,
): SessionMruPanelState {
  if (!cycle || cycle.snapshot.length === 0) return null;
  const index =
    cycle.index < 0
      ? 0
      : cycle.index >= cycle.snapshot.length
        ? cycle.snapshot.length - 1
        : cycle.index;
  return {
    index,
    rows: cycle.snapshot.map((id) => {
      const row = getRow(id);
      return {
        id,
        title: (row?.title ?? "").trim(),
        projectName: (row?.projectName ?? "").trim(),
      };
    }),
  };
}

export type SessionMruChordEvent = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
};

/**
 * Ctrl+Tab / Ctrl+Shift+Tab on every OS.
 * Cmd+Tab is the OS app switcher — never match meta.
 */
export function matchSessionMruChord(
  e: SessionMruChordEvent,
): SessionMruDir | null {
  if (e.isComposing) return null;
  if (e.repeat) return null;
  if (e.metaKey || e.altKey) return null;
  if (!e.ctrlKey) return null;
  const isTab = e.key === "Tab" || e.code === "Tab";
  if (!isTab) return null;
  return e.shiftKey ? "prev" : "next";
}

/** Ctrl keyup ends the frozen cycle (VS Code: release modifier to commit). */
export function isSessionMruModifierKey(e: {
  key: string;
  code?: string;
}): boolean {
  return (
    e.key === "Control" ||
    e.code === "ControlLeft" ||
    e.code === "ControlRight"
  );
}

export function parseSessionMru(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      value = JSON.parse(s) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return normalizeSessionMru(value);
}

export function loadSessionMru(storage?: SessionMruStorage | null): string[] {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return [];
  try {
    return parseSessionMru(store.getItem(SESSION_MRU_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveSessionMru(
  list: readonly string[],
  storage?: SessionMruStorage | null,
): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;
  try {
    store.setItem(
      SESSION_MRU_STORAGE_KEY,
      JSON.stringify(normalizeSessionMru(list)),
    );
  } catch {
    /* quota / private mode */
  }
}
