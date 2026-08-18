/**
 * Bottom terminal panel — pure model.
 * `open` / `height` are layout; `tabs` / `activeId` are per-project.
 */

export const BOTTOM_TERMINAL_TABS_MAX = 12;
export const BOTTOM_TERMINAL_HEIGHT_DEFAULT = 240;
export const BOTTOM_TERMINAL_HEIGHT_MIN = 120;
export const BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY = "grok.bottomTerminal.height";
export const BOTTOM_TERMINAL_ORPHAN_KEY = "__orphan__";

export type BottomTerminalTab = {
  id: string;
  sessionKey: string;
  name: string;
};

export type BottomTerminalState = {
  open: boolean;
  height: number;
  tabs: BottomTerminalTab[];
  activeId: string | null;
};

export type BottomTerminalProjectSlice = {
  tabs: BottomTerminalTab[];
  activeId: string | null;
};

/** Minimal storage surface so unit tests need no jsdom. */
export interface BottomTerminalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyBottomTerminalState(): BottomTerminalState {
  return {
    open: false,
    height: BOTTOM_TERMINAL_HEIGHT_DEFAULT,
    tabs: [],
    activeId: null,
  };
}

export function clampBottomTerminalHeight(
  height: number,
  maxPx?: number,
): number {
  const n = Number.isFinite(height)
    ? Math.round(height)
    : BOTTOM_TERMINAL_HEIGHT_DEFAULT;
  const min = BOTTOM_TERMINAL_HEIGHT_MIN;
  const cap =
    maxPx != null && Number.isFinite(maxPx) && maxPx > min
      ? Math.floor(maxPx)
      : Number.POSITIVE_INFINITY;
  return Math.min(cap, Math.max(min, n));
}

export function loadBottomTerminalHeight(
  storage?: BottomTerminalStorage | null,
): number {
  if (!storage) return BOTTOM_TERMINAL_HEIGHT_DEFAULT;
  try {
    const raw = storage.getItem(BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY);
    if (raw == null || raw === "") return BOTTOM_TERMINAL_HEIGHT_DEFAULT;
    const n = Number(raw);
    return clampBottomTerminalHeight(n);
  } catch {
    return BOTTOM_TERMINAL_HEIGHT_DEFAULT;
  }
}

export function saveBottomTerminalHeight(
  height: number,
  storage?: BottomTerminalStorage | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      BOTTOM_TERMINAL_HEIGHT_STORAGE_KEY,
      String(clampBottomTerminalHeight(height)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function newTabId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `bt_${c.randomUUID()}`;
  }
  return `bt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createBottomTerminalTab(meta?: {
  id?: string;
  sessionKey?: string;
  name?: string;
}): BottomTerminalTab {
  const id = meta?.id || newTabId();
  return {
    id,
    sessionKey: meta?.sessionKey || id,
    name: (meta?.name || "").trim() || "side.tab.terminal",
  };
}

function clampMax(max: number | undefined): number {
  if (max == null || !Number.isFinite(max)) return BOTTOM_TERMINAL_TABS_MAX;
  return Math.max(1, Math.floor(max));
}

/** Always mint a new shell tab and open the panel. */
export function addBottomTerminalTab(
  state: BottomTerminalState,
  meta?: { id?: string; sessionKey?: string; name?: string },
  max: number = BOTTOM_TERMINAL_TABS_MAX,
): BottomTerminalState {
  const tab = createBottomTerminalTab(meta);
  const cap = clampMax(max);
  let tabs = [tab, ...state.tabs];
  if (tabs.length > cap) tabs = tabs.slice(0, cap);
  return {
    ...state,
    open: true,
    tabs,
    activeId: tab.id,
  };
}

export function closeBottomTerminalTab(
  state: BottomTerminalState,
  tabId: string,
): BottomTerminalState {
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  if (tabs.length === state.tabs.length) return state;
  if (tabs.length === 0) {
    return { ...state, tabs, activeId: null, open: false };
  }
  const activeId =
    state.activeId === tabId ? (tabs[0]?.id ?? null) : state.activeId;
  return { ...state, tabs, activeId };
}

export function setActiveBottomTerminalTab(
  state: BottomTerminalState,
  tabId: string,
): BottomTerminalState {
  if (!state.tabs.some((t) => t.id === tabId)) return state;
  if (state.activeId === tabId) return state;
  return { ...state, activeId: tabId };
}

export function setBottomTerminalHeight(
  state: BottomTerminalState,
  height: number,
  maxPx?: number,
): BottomTerminalState {
  const next = clampBottomTerminalHeight(height, maxPx);
  if (next === state.height) return state;
  return { ...state, height: next };
}

export function openBottomTerminal(
  state: BottomTerminalState,
): BottomTerminalState {
  if (state.tabs.length === 0) return addBottomTerminalTab(state);
  if (state.open) return state;
  return { ...state, open: true };
}

export function closeBottomTerminal(
  state: BottomTerminalState,
): BottomTerminalState {
  if (!state.open) return state;
  return { ...state, open: false };
}

/** Closed → open (create first tab if needed). Open → close (keep tabs). */
export function toggleBottomTerminal(
  state: BottomTerminalState,
): BottomTerminalState {
  return state.open ? closeBottomTerminal(state) : openBottomTerminal(state);
}

export function bottomTerminalProjectKey(
  projectId: string | null | undefined,
): string {
  const id = (projectId ?? "").trim();
  return id || BOTTOM_TERMINAL_ORPHAN_KEY;
}

export function takeBottomTerminalProjectSlice(
  state: BottomTerminalState,
): BottomTerminalProjectSlice {
  return { tabs: state.tabs, activeId: state.activeId };
}

export function applyBottomTerminalProjectSlice(
  state: BottomTerminalState,
  slice: BottomTerminalProjectSlice | undefined,
): BottomTerminalState {
  const next = slice ?? { tabs: [], activeId: null };
  return {
    ...state,
    tabs: next.tabs,
    activeId: next.activeId,
  };
}

/**
 * Stash `fromKey` tabs, restore `toKey` (empty if first visit).
 * Same key is a no-op. `open` / `height` are preserved.
 */
export function switchBottomTerminalProject(
  state: BottomTerminalState,
  store: ReadonlyMap<string, BottomTerminalProjectSlice>,
  fromKey: string,
  toKey: string,
): {
  state: BottomTerminalState;
  store: Map<string, BottomTerminalProjectSlice>;
} {
  const nextStore = new Map(store);
  if (fromKey === toKey) {
    return { state, store: nextStore };
  }
  nextStore.set(fromKey, takeBottomTerminalProjectSlice(state));
  return {
    state: applyBottomTerminalProjectSlice(state, nextStore.get(toKey)),
    store: nextStore,
  };
}
