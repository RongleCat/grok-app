/**
 * Resource workbench multi-file tabs — pure open / close / activate / dirty helpers.
 *
 * ResourceViewer keeps rich preview/edit state on each tab; this module owns
 * the strip model: path identity, MRU order, max cap + LRU drop, empty state.
 * No DOM / Tauri / i18n side effects.
 */

import { normalizePath, pathBaseName } from "@/lib/sessionChanges";

/** Soft cap on open resource tabs (LRU drop when exceeded). */
export const RESOURCE_TABS_MAX = 12;

export type ResourceTab = {
  id: string;
  /** Normalized path or URL used for dedupe. */
  path: string;
  name: string;
  kind?: string;
  dirty?: boolean;
};

export type ResourceTabsState = {
  tabs: ResourceTab[];
  activeId: string | null;
};

export type OpenResourceTabMeta = {
  name?: string;
  kind?: string;
  /** Reuse an id when focusing an already-open rich tab. */
  id?: string;
  dirty?: boolean;
};

export type OpenResourceTabResult = ResourceTabsState & {
  /** Focused / opened tab id (always set when path is non-empty). */
  activeId: string;
  /** True when a new tab row was created. */
  created: boolean;
  /** Tab ids dropped by LRU when over max. */
  droppedIds: string[];
  /** True when at least one dropped tab was dirty (soft-fail honesty). */
  droppedDirty: boolean;
};

export type ResourceTabsEmptyKind = "no_tabs";

export type ResourceTabsEmptyTitleKey = "resources.emptyPreview";
export type ResourceTabsEmptyHintKey = "resources.emptyPreviewHint";

export type ResourceTabsEmptyPresentation = {
  kind: ResourceTabsEmptyKind;
  titleKey: ResourceTabsEmptyTitleKey;
  hintKey: ResourceTabsEmptyHintKey;
};

/** Soft-fail notice when open exceeds {@link RESOURCE_TABS_MAX}. */
export type ResourceTabsCapSoftFail = {
  kind: "cap";
  messageKey: "resources.tabsMaxSoftFail";
  dirtyMessageKey: "resources.tabsMaxSoftFailDirty";
  max: number;
  droppedCount: number;
  droppedDirty: boolean;
};

/**
 * Files workbench layout: preview and tree are simultaneous when the tree is
 * visible — never an exclusive stack flip for normal open.
 */
export type FilesWorkbenchSplitLayout =
  | { mode: "split"; treeVisible: true }
  | { mode: "solo"; treeVisible: false };

export function resolveFilesWorkbenchSplitLayout(input: {
  treeVisible: boolean;
}): FilesWorkbenchSplitLayout {
  if (input.treeVisible) return { mode: "split", treeVisible: true };
  return { mode: "solo", treeVisible: false };
}

/**
 * Soft-fail presentation when open drops LRU tabs. Returns null when nothing
 * was dropped (under cap).
 */
export function resolveResourceTabsCapSoftFail(input: {
  droppedIds: readonly string[];
  droppedDirty?: boolean;
  max?: number;
}): ResourceTabsCapSoftFail | null {
  const n = Array.isArray(input.droppedIds) ? input.droppedIds.length : 0;
  if (n <= 0) return null;
  const max = clampMax(input.max);
  return {
    kind: "cap",
    messageKey: "resources.tabsMaxSoftFail",
    dirtyMessageKey: "resources.tabsMaxSoftFailDirty",
    max,
    droppedCount: n,
    droppedDirty: !!input.droppedDirty,
  };
}

/**
 * Pick LRU drop index (end of list = oldest). Prefer clean tabs so dirty
 * buffers are not silently discarded; fall back to any non-protected tab.
 */
export function pickResourceTabLruDropIndex(
  tabs: readonly ResourceTab[],
  protectId: string,
): number {
  const list = Array.isArray(tabs) ? tabs : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i]!;
    if (t.id === protectId) continue;
    if (!t.dirty) return i;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.id !== protectId) return i;
  }
  return -1;
}

/** True when closing `id` should confirm discard (dirty honesty). */
export function shouldConfirmCloseResourceTab(
  tabs: readonly ResourceTab[],
  id: string,
): boolean {
  const t = (Array.isArray(tabs) ? tabs : []).find((x) => x.id === id);
  return !!t?.dirty;
}

/**
 * Close the active tab (or first tab when activeId is null). Pure strip model.
 */
export function closeActiveResourceTab(
  tabs: ResourceTab[],
  activeId: string | null,
): ResourceTabsState {
  const list = Array.isArray(tabs) ? tabs : [];
  const id = activeId ?? list[0]?.id;
  if (!id) return { tabs: list, activeId: null };
  return closeResourceTab(list, activeId, id);
}

/**
 * Normalize a tab path key for equality.
 * File paths use {@link normalizePath}; URL schemes keep `://` intact.
 */
export function normalizeResourceTabPath(path: string): string {
  const raw = (path || "").trim();
  if (!raw) return "";
  // http(s)://, file://, media://, etc. — do not collapse scheme slashes.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return normalizePath(raw);
}

/** True when two path keys refer to the same tab after normalize. */
export function resourceTabPathsEqual(a: string, b: string): boolean {
  const na = normalizeResourceTabPath(a);
  const nb = normalizeResourceTabPath(b);
  if (!na || !nb) return false;
  return na === nb;
}

function newTabId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `tab_${c.randomUUID()}`;
  }
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function clampMax(max: number | undefined): number {
  if (max == null || !Number.isFinite(max)) return RESOURCE_TABS_MAX;
  return Math.max(1, Math.floor(max));
}

/**
 * Open or focus a path. Dedupes by normalized path (or explicit meta.id),
 * moves the hit to the front (MRU), and drops LRU entries when over `max`
 * (default {@link RESOURCE_TABS_MAX}). Clean tabs are dropped before dirty
 * ones so unsaved buffers are not discarded silently.
 */
export function openResourceTab(
  tabs: ResourceTab[],
  path: string,
  meta?: OpenResourceTabMeta,
  max: number = RESOURCE_TABS_MAX,
): OpenResourceTabResult {
  const list = Array.isArray(tabs) ? tabs : [];
  const norm = normalizeResourceTabPath(path);
  const cap = clampMax(max);

  // Prefer explicit id, then path match.
  let existingIdx = -1;
  if (meta?.id) {
    existingIdx = list.findIndex((t) => t.id === meta.id);
  }
  if (existingIdx < 0 && norm) {
    existingIdx = list.findIndex(
      (t) => normalizeResourceTabPath(t.path) === norm,
    );
  }

  if (existingIdx >= 0) {
    const hit = list[existingIdx]!;
    const updated: ResourceTab = {
      ...hit,
      path: norm || hit.path,
      name: meta?.name ?? hit.name,
      kind: meta?.kind ?? hit.kind,
      dirty: meta?.dirty ?? hit.dirty,
    };
    const rest = list.filter((_, i) => i !== existingIdx);
    return {
      tabs: [updated, ...rest],
      activeId: updated.id,
      created: false,
      droppedIds: [],
      droppedDirty: false,
    };
  }

  // Empty path → no-op (keep strip unchanged).
  if (!norm) {
    return {
      tabs: list,
      activeId: list[0]?.id ?? "",
      created: false,
      droppedIds: [],
      droppedDirty: false,
    };
  }

  const id = meta?.id || newTabId();
  const tab: ResourceTab = {
    id,
    path: norm,
    name: (meta?.name || pathBaseName(norm) || norm).trim() || norm,
    kind: meta?.kind,
    dirty: meta?.dirty ?? false,
  };
  let next = [tab, ...list];
  const droppedIds: string[] = [];
  let droppedDirty = false;
  while (next.length > cap) {
    const dropIdx = pickResourceTabLruDropIndex(next, id);
    if (dropIdx < 0) break;
    const drop = next[dropIdx]!;
    if (drop.dirty) droppedDirty = true;
    droppedIds.push(drop.id);
    next = next.filter((_, i) => i !== dropIdx);
  }
  return {
    tabs: next,
    activeId: id,
    created: true,
    droppedIds,
    droppedDirty,
  };
}

/**
 * Close a tab by id. When closing the active tab, prefer the left neighbor
 * (newer / MRU side), else the right, else null.
 */
export function closeResourceTab(
  tabs: ResourceTab[],
  activeId: string | null,
  id: string,
): ResourceTabsState {
  const list = Array.isArray(tabs) ? tabs : [];
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) {
    return { tabs: list, activeId };
  }
  const next = list.filter((t) => t.id !== id);
  if (activeId !== id) {
    return { tabs: next, activeId };
  }
  const neighbor = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
  return { tabs: next, activeId: neighbor?.id ?? null };
}

/** Activate a tab by id (no reorder). Unknown id leaves state unchanged. */
export function setActiveTab(
  tabs: ResourceTab[],
  id: string,
): ResourceTabsState {
  const list = Array.isArray(tabs) ? tabs : [];
  if (!list.some((t) => t.id === id)) {
    return { tabs: list, activeId: list.find((t) => t.id)?.id ?? null };
  }
  return { tabs: list, activeId: id };
}

/** Set or clear the dirty flag on a tab (strip model only). */
export function markTabDirty(
  tabs: ResourceTab[],
  id: string,
  dirty: boolean,
): ResourceTab[] {
  const list = Array.isArray(tabs) ? tabs : [];
  return list.map((t) => (t.id === id ? { ...t, dirty: !!dirty } : t));
}

/**
 * Empty-state for the files tab strip / preview when nothing is open.
 * Returns null when at least one tab is present.
 */
export function resolveResourceTabsEmptyState(input: {
  tabCount: number;
  /** Side mode is informational; empty files strip applies whenever count is 0. */
  sideMode?: string;
}): ResourceTabsEmptyPresentation | null {
  const n = Number(input.tabCount);
  if (Number.isFinite(n) && n > 0) return null;
  return {
    kind: "no_tabs",
    titleKey: "resources.emptyPreview",
    hintKey: "resources.emptyPreviewHint",
  };
}
