/**
 * Side Workbench pure model — multi-kind tabs, picker catalog, open/close/activate.
 * No DOM / Tauri / i18n side effects. Plan is process-created only (not in picker).
 */

export const SIDE_TABS_MAX = 24;

/** User-creatable kinds via empty state / `+` picker. */
export type SidePickerKind = "file" | "browser" | "terminal" | "review" | "skills";

/** All tab kinds including process-only plan. */
export type SideTabKind = SidePickerKind | "plan";

export type SideTab =
  | {
      id: string;
      kind: "file";
      path?: string;
      name: string;
      /** 1-based line from path:line open (soft-fail if out of range). */
      line?: number | null;
      column?: number | null;
    }
  | { id: string; kind: "browser"; url?: string; title?: string; name: string }
  | { id: string; kind: "terminal"; sessionKey: string; name: string }
  | { id: string; kind: "review"; name: string }
  | { id: string; kind: "skills"; name: string }
  | { id: string; kind: "plan"; planRef?: string; name: string };

export type SideWorkbenchState = {
  tabs: SideTab[];
  activeId: string | null;
  /** File tree visible inside files workspace (Phase 1). */
  treeVisible: boolean;
  /** Expand side workbench into chat area. */
  expanded: boolean;
};

export type SidePickerOption = {
  kind: SidePickerKind;
  /** i18n key for label */
  labelKey: string;
  /** Optional shortcut display key (i18n or raw chord) */
  shortcutKey?: string;
};

export type CreateSideTabMeta = {
  id?: string;
  name?: string;
  path?: string;
  url?: string;
  title?: string;
  planRef?: string;
  sessionKey?: string;
  /** 1-based line for file path:line open. */
  line?: number | null;
  column?: number | null;
};

export type OpenSideTabResult = SideWorkbenchState & {
  activeId: string;
  created: boolean;
  droppedIds: string[];
};

/**
 * Catalog shortcut id per picker kind (wired in App global keydown).
 * Display chords come from the shortcut registry (defaults + remaps).
 */
export const SIDE_PICKER_SHORTCUT_IDS = {
  file: "sideFiles",
  browser: "sideBrowser",
  terminal: "sideTerminal",
} as const;

const PICKER_BASE: SidePickerOption[] = [
  {
    kind: "file",
    labelKey: "side.picker.file",
    shortcutKey: "side.picker.fileShortcut",
  },
  {
    kind: "browser",
    labelKey: "side.picker.browser",
    shortcutKey: "side.picker.browserShortcut",
  },
  {
    kind: "terminal",
    labelKey: "side.picker.terminal",
    shortcutKey: "side.picker.terminalShortcut",
  },
  {
    kind: "skills",
    labelKey: "side.picker.skills",
  },
  {
    kind: "review",
    labelKey: "side.picker.review",
  },
];

/** Kinds never offered in empty state / `+` menus. */
export const SIDE_PICKER_EXCLUDED: readonly SideTabKind[] = ["plan"];

export function emptySideWorkbenchState(): SideWorkbenchState {
  return {
    tabs: [],
    activeId: null,
    // File tree is opt-in — opening a file must not force the tree open.
    treeVisible: false,
    expanded: false,
  };
}

/**
 * Picker options for empty state and `+` menu.
 * Review only when `isGitProject`; never includes plan or side-chat.
 */
export function sidePickerOptions(opts: {
  isGitProject: boolean;
}): SidePickerOption[] {
  return PICKER_BASE.filter((o) => {
    if (o.kind === "review") return !!opts.isGitProject;
    return true;
  });
}

/** True when kind may be created from the user picker. */
export function isPickerCreatableKind(
  kind: SideTabKind,
  opts: { isGitProject: boolean },
): boolean {
  if (kind === "plan") return false;
  if (kind === "review") return !!opts.isGitProject;
  return (
    kind === "file" ||
    kind === "browser" ||
    kind === "terminal" ||
    kind === "skills"
  );
}

function newTabId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `side_${c.randomUUID()}`;
  }
  return `side_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function clampMax(max: number | undefined): number {
  if (max == null || !Number.isFinite(max)) return SIDE_TABS_MAX;
  return Math.max(1, Math.floor(max));
}

/**
 * Default tab chip labels are **i18n keys** (not English prose).
 * UI resolves via `createT` / `resolveSideTabLabel`. Custom path/title
 * names stay as plain display strings.
 */
export const SIDE_TAB_DEFAULT_NAME_KEYS: Record<SideTabKind, string> = {
  file: "side.tab.file",
  browser: "side.tab.browser",
  terminal: "side.tab.terminal",
  review: "side.tab.review",
  skills: "side.tab.skills",
  plan: "side.tab.plan",
};

/** True when `name` is a Side Workbench i18n label key (not a path/title). */
export function isSideTabNameKey(name: string): boolean {
  const n = (name || "").trim();
  return n.startsWith("side.tab.") || n.startsWith("side.picker.");
}

function defaultName(kind: SideTabKind, meta?: CreateSideTabMeta): string {
  if (meta?.name?.trim()) return meta.name.trim();
  if (kind === "file" && meta?.path) {
    const parts = meta.path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || meta.path;
  }
  if (kind === "browser") {
    const titled = meta?.title?.trim() || meta?.url?.trim();
    if (titled) return titled;
  }
  return SIDE_TAB_DEFAULT_NAME_KEYS[kind];
}

function buildTab(kind: SideTabKind, meta?: CreateSideTabMeta): SideTab {
  const id = meta?.id || newTabId();
  const name = defaultName(kind, meta);
  switch (kind) {
    case "file":
      return {
        id,
        kind,
        path: meta?.path,
        name,
        line: meta?.line ?? null,
        column: meta?.column ?? null,
      };
    case "browser":
      return {
        id,
        kind,
        url: meta?.url,
        title: meta?.title,
        name,
      };
    case "terminal":
      return {
        id,
        kind,
        sessionKey: meta?.sessionKey || id,
        name,
      };
    case "review":
      return { id, kind, name };
    case "skills":
      return { id, kind, name };
    case "plan":
      return { id, kind, planRef: meta?.planRef, name };
  }
}

/**
 * Create or focus a tab of the given kind.
 * - file: dedupe by path when path provided
 * - browser: dedupe by url when url provided
 * - review / plan / skills: single instance (focus existing)
 * - terminal: **always create a new tab** unless meta.id matches an existing
 *   tab (shortcut / picker = new shell; never focus-reuse another terminal)
 */
export function openSideTab(
  state: SideWorkbenchState,
  kind: SideTabKind,
  meta?: CreateSideTabMeta,
  max: number = SIDE_TABS_MAX,
): OpenSideTabResult {
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  const cap = clampMax(max);

  let existingIdx = -1;
  if (meta?.id) {
    existingIdx = tabs.findIndex((t) => t.id === meta.id);
  }
  if (existingIdx < 0 && kind === "file" && meta?.path) {
    const p = meta.path.trim();
    existingIdx = tabs.findIndex(
      (t) => t.kind === "file" && (t.path || "").trim() === p,
    );
  }
  if (existingIdx < 0 && kind === "browser" && meta?.url) {
    const u = meta.url.trim().replace(/\/+$/, "");
    existingIdx = tabs.findIndex(
      (t) =>
        t.kind === "browser" &&
        (t.url || "").trim().replace(/\/+$/, "") === u,
    );
  }
  if (existingIdx < 0 && (kind === "review" || kind === "plan" || kind === "skills")) {
    existingIdx = tabs.findIndex((t) => t.kind === kind);
  }
  // Files workspace: single shared tree container (not one tab per file).
  // File path opens are handled inside ResourceViewer multi-preview tabs.
  if (existingIdx < 0 && kind === "file" && !meta?.path) {
    existingIdx = tabs.findIndex((t) => t.kind === "file" && !t.path);
  }

  if (existingIdx >= 0) {
    const hit = tabs[existingIdx]!;
    // Refresh path:line focus when re-opening the same file citation.
    const refreshed: SideTab =
      hit.kind === "file" && kind === "file"
        ? {
            ...hit,
            line: meta?.line ?? null,
            column: meta?.column ?? null,
            name: meta?.name?.trim() || hit.name,
            path: meta?.path?.trim() || hit.path,
          }
        : hit;
    const rest = tabs.filter((_, i) => i !== existingIdx);
    const nextTabs = [refreshed, ...rest];
    return {
      ...state,
      tabs: nextTabs,
      activeId: refreshed.id,
      created: false,
      droppedIds: [],
    };
  }

  const tab = buildTab(kind, meta);
  let next = [tab, ...tabs];
  const droppedIds: string[] = [];
  while (next.length > cap) {
    const drop = next[next.length - 1]!;
    droppedIds.push(drop.id);
    next = next.slice(0, -1);
  }
  return {
    ...state,
    tabs: next,
    activeId: tab.id,
    created: true,
    droppedIds,
  };
}

/** Open from picker — rejects non-creatable kinds. */
export function openSideTabFromPicker(
  state: SideWorkbenchState,
  kind: SideTabKind,
  opts: { isGitProject: boolean },
  meta?: CreateSideTabMeta,
): OpenSideTabResult | SideWorkbenchState {
  if (!isPickerCreatableKind(kind, opts)) {
    return state;
  }
  return openSideTab(state, kind, meta);
}

export function closeSideTab(
  state: SideWorkbenchState,
  tabId: string,
): SideWorkbenchState {
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  if (tabs.length === state.tabs.length) return state;
  let activeId = state.activeId;
  if (activeId === tabId) {
    activeId = tabs[0]?.id ?? null;
  }
  return { ...state, tabs, activeId };
}

/**
 * Close the active side tab (falls back to the first tab).
 * No-op when the strip is empty.
 */
export function closeActiveSideTab(
  state: SideWorkbenchState,
): SideWorkbenchState {
  const id = state.activeId ?? state.tabs[0]?.id;
  if (!id) return state;
  return closeSideTab(state, id);
}

/**
 * What Close / ⌘W should do next for the side workbench strip.
 * - `side-tab` — close that tab id (active, or first when active is missing)
 * - `window` — fall through to window close (empty strip or collapsed aside)
 *
 * Collapsed leftover tabs must not steal ⌘W from the window.
 */
export type SideStripCloseTarget =
  | { kind: "side-tab"; tabId: string }
  | { kind: "window" };

export type SideStripCloseOpts = {
  /** When true, side chrome is hidden — never prefer leftover strip tabs. */
  asideCollapsed?: boolean;
  /**
   * Optional dirty side-tab ids. When the chosen tab is dirty, callers should
   * confirm discard before applying the close (middle-click / × / ⌘W share this).
   */
  dirtyTabIds?: ReadonlySet<string> | readonly string[];
};

function dirtySideTabIdSet(
  dirtyTabIds?: SideStripCloseOpts["dirtyTabIds"],
): ReadonlySet<string> | null {
  if (!dirtyTabIds) return null;
  if (dirtyTabIds instanceof Set) return dirtyTabIds;
  return new Set(dirtyTabIds);
}

function isDirtySideTabId(
  tabId: string,
  dirtyTabIds?: SideStripCloseOpts["dirtyTabIds"],
): boolean {
  const set = dirtySideTabIdSet(dirtyTabIds);
  return set ? set.has(tabId) : false;
}

/**
 * Pure decision: close active side tab vs fall through to window close.
 * Does not mutate state — pair with {@link applySideStripClose} or
 * {@link closeSideTab} after any discard confirm.
 */
export function resolveSideStripCloseTarget(
  state: Pick<SideWorkbenchState, "tabs" | "activeId">,
  opts?: SideStripCloseOpts,
): SideStripCloseTarget {
  if (opts?.asideCollapsed) return { kind: "window" };
  if (!state.tabs.length) return { kind: "window" };
  const tabId = state.activeId ?? state.tabs[0]?.id;
  if (!tabId) return { kind: "window" };
  // Guard: activeId can lag behind a removed tab — fall back to first strip entry.
  if (!state.tabs.some((t) => t.id === tabId)) {
    const first = state.tabs[0]?.id;
    if (!first) return { kind: "window" };
    return { kind: "side-tab", tabId: first };
  }
  return { kind: "side-tab", tabId };
}

/**
 * Whether closing `tabId` (× / middle-click / ⌘W) needs an unsaved-discard prompt.
 */
export function sideTabCloseNeedsConfirm(
  tabId: string,
  opts?: Pick<SideStripCloseOpts, "dirtyTabIds">,
): boolean {
  return isDirtySideTabId(tabId, opts?.dirtyTabIds);
}

/**
 * Apply browser-like Close / ⌘W against the strip.
 * Returns next state and whether the host should close the window instead.
 * Does **not** auto-discard dirty tabs — when `dirtyTabIds` marks the target,
 * returns the prior state with `needsConfirm: true` and no mutation.
 */
export function applySideStripClose(
  state: SideWorkbenchState,
  opts?: SideStripCloseOpts,
): {
  state: SideWorkbenchState;
  closeWindow: boolean;
  closedTabId: string | null;
  needsConfirm: boolean;
} {
  const target = resolveSideStripCloseTarget(state, opts);
  if (target.kind === "window") {
    return {
      state,
      closeWindow: true,
      closedTabId: null,
      needsConfirm: false,
    };
  }
  if (isDirtySideTabId(target.tabId, opts?.dirtyTabIds)) {
    return {
      state,
      closeWindow: false,
      closedTabId: target.tabId,
      needsConfirm: true,
    };
  }
  const next = closeSideTab(state, target.tabId);
  return {
    state: next,
    closeWindow: false,
    closedTabId: target.tabId,
    needsConfirm: false,
  };
}

/**
 * ⌘W / Ctrl+W — close the active side tab when the strip has tabs
 * (browser-style; empty strip leaves the chord for window close).
 */
export function isCloseSideTabChord(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  return e.key === "w" || e.key === "W";
}

/**
 * Middle mouse button (button === 1) on a tab chip — browser-style close.
 */
export function isSideTabMiddleClick(e: {
  button: number;
}): boolean {
  return e.button === 1;
}

/**
 * Keep only `tabId`; close every other tab.
 * No-op when tab missing or already alone.
 */
export function closeOtherSideTabs(
  state: SideWorkbenchState,
  tabId: string,
): SideWorkbenchState {
  const hit = state.tabs.find((t) => t.id === tabId);
  if (!hit) return state;
  if (state.tabs.length <= 1) {
    return state.activeId === tabId ? state : { ...state, activeId: tabId };
  }
  return { ...state, tabs: [hit], activeId: tabId };
}

/** Close every tab (empty workbench). */
export function closeAllSideTabs(
  state: SideWorkbenchState,
): SideWorkbenchState {
  if (state.tabs.length === 0 && state.activeId == null) return state;
  return { ...state, tabs: [], activeId: null };
}

/**
 * Close all tabs strictly to the left of `tabId` in strip order
 * (lower index = left in the tab bar).
 */
export function closeSideTabsToLeft(
  state: SideWorkbenchState,
  tabId: string,
): SideWorkbenchState {
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx <= 0) return state;
  const tabs = state.tabs.slice(idx);
  return rebindActiveAfterClose(state, tabs, tabId);
}

/**
 * Close all tabs strictly to the right of `tabId` in strip order
 * (higher index = right in the tab bar).
 */
export function closeSideTabsToRight(
  state: SideWorkbenchState,
  tabId: string,
): SideWorkbenchState {
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0 || idx >= state.tabs.length - 1) return state;
  const tabs = state.tabs.slice(0, idx + 1);
  return rebindActiveAfterClose(state, tabs, tabId);
}

/** Prefer `preferredId` when still present; otherwise first remaining / null. */
function rebindActiveAfterClose(
  state: SideWorkbenchState,
  tabs: SideTab[],
  preferredId: string,
): SideWorkbenchState {
  let activeId = state.activeId;
  if (!tabs.some((t) => t.id === activeId)) {
    activeId = tabs.some((t) => t.id === preferredId)
      ? preferredId
      : (tabs[0]?.id ?? null);
  }
  return { ...state, tabs, activeId };
}

/** True for POSIX/Windows absolute filesystem paths (not bare filenames). */
export function isFsAbsolutePath(p: string): boolean {
  const s = (p || "").trim();
  if (!s) return false;
  if (s.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (s.startsWith("\\\\")) return true;
  return false;
}

/** Join project root + relative path using the root's path style. */
export function joinProjectPath(projectRoot: string, relative: string): string {
  const root = projectRoot.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "");
  if (!root) return rel;
  if (!rel) return root;
  const useWin = /\\/.test(root) || /^[A-Za-z]:/.test(root);
  if (useWin) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root.replace(/\\/g, "/")}/${rel.replace(/\\/g, "/")}`;
}

/**
 * Absolute filesystem path for “复制路径” — **file preview tabs only**.
 * - Requires `kind === "file"` and a non-empty `path` (never `name`/basename).
 * - Absolute paths returned as stored.
 * - Relative paths resolved against `projectRoot`; without root → null
 *   (do not copy a bare relative segment or filename).
 * - Browser / terminal / review / plan → null (menu item hidden).
 */
export function sideTabCopyPath(
  tab: SideTab,
  projectRoot?: string | null,
): string | null {
  if (tab.kind !== "file") return null;
  const p = (tab.path || "").trim();
  if (!p) return null;
  if (isFsAbsolutePath(p)) return p;
  const root = (projectRoot || "").trim();
  if (!root) return null;
  return joinProjectPath(root, p);
}

/** @deprecated Use {@link sideTabCopyPath} (file absolute only). */
export function sideTabCopyText(
  tab: SideTab,
  projectRoot?: string | null,
): string | null {
  return sideTabCopyPath(tab, projectRoot);
}

/** Whether the tab bar has any neighbor left/right of `tabId`. */
export function sideTabNeighborFlags(
  tabs: SideTab[],
  tabId: string,
): { hasLeft: boolean; hasRight: boolean; hasOthers: boolean } {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) {
    return { hasLeft: false, hasRight: false, hasOthers: false };
  }
  return {
    hasLeft: idx > 0,
    hasRight: idx < tabs.length - 1,
    hasOthers: tabs.length > 1,
  };
}

export function setActiveSideTab(
  state: SideWorkbenchState,
  tabId: string,
): SideWorkbenchState {
  if (!state.tabs.some((t) => t.id === tabId)) return state;
  if (state.activeId === tabId) return state;
  return { ...state, activeId: tabId };
}

export function setSideExpanded(
  state: SideWorkbenchState,
  expanded: boolean,
): SideWorkbenchState {
  if (state.expanded === expanded) return state;
  return { ...state, expanded };
}

export function toggleSideExpanded(
  state: SideWorkbenchState,
): SideWorkbenchState {
  return setSideExpanded(state, !state.expanded);
}

export function setTreeVisible(
  state: SideWorkbenchState,
  treeVisible: boolean,
): SideWorkbenchState {
  if (state.treeVisible === treeVisible) return state;
  return { ...state, treeVisible };
}

export function activeSideTab(
  state: SideWorkbenchState,
): SideTab | null {
  if (!state.activeId) return null;
  return state.tabs.find((t) => t.id === state.activeId) ?? null;
}

/**
 * Raw chip label (may be an i18n key). Prefer {@link resolveSideTabLabel}
 * in UI so keys become localized strings.
 */
export function sideTabLabel(tab: SideTab): string {
  return (tab.name || SIDE_TAB_DEFAULT_NAME_KEYS[tab.kind] || tab.kind).trim();
}

/**
 * Localize tab chip text. Pass `tr` from createT(locale).
 * Path/title custom names pass through unchanged.
 */
export function resolveSideTabLabel(
  tab: SideTab,
  tr: (key: string) => string,
): string {
  const raw = sideTabLabel(tab);
  if (isSideTabNameKey(raw)) return tr(raw);
  return raw;
}

/** Whether env「变更」may jump to review (git-only). */
export function envReviewJumpEnabled(isGitProject: boolean): boolean {
  return !!isGitProject;
}
