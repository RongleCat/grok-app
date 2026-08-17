/**
 * Persist recently finished agent turns so Kanban Done survives a pane
 * remount even when the in-memory liveMap row is gone.
 */

const STORAGE_KEY = "grok-app.finishedAgentTurns";
const MAX_ENTRIES = 80;

export type FinishedTurnsMap = Record<string, number>;

type Listener = () => void;

let memory: FinishedTurnsMap | null = null;
const listeners = new Set<Listener>();

function readStorage(): FinishedTurnsMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: FinishedTurnsMap = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!key || typeof value !== "number" || !Number.isFinite(value)) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStorage(map: FinishedTurnsMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota */
  }
}

function load(): FinishedTurnsMap {
  if (!memory) memory = readStorage();
  return memory;
}

function prune(map: FinishedTurnsMap): FinishedTurnsMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  entries.sort((a, b) => b[1] - a[1]);
  const next: FinishedTurnsMap = {};
  for (const [id, at] of entries.slice(0, MAX_ENTRIES)) next[id] = at;
  return next;
}

function commit(next: FinishedTurnsMap): void {
  memory = next;
  writeStorage(next);
  for (const listener of [...listeners]) listener();
}

export function getFinishedTurns(): FinishedTurnsMap {
  // Same reference until commit() — required by useSyncExternalStore.
  return load();
}

export function subscribeFinishedTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rememberFinishedTurn(sessionId: string, at: number): void {
  const id = sessionId.trim();
  if (!id || !Number.isFinite(at)) return;
  const cur = load();
  if (cur[id] === at) return;
  commit(prune({ ...cur, [id]: at }));
}

export function forgetFinishedTurn(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  const cur = load();
  if (!(id in cur)) return;
  const next = { ...cur };
  delete next[id];
  commit(next);
}

export function resetFinishedTurnsForTests(): void {
  memory = {};
  listeners.clear();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
