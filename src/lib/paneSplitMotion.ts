/**
 * Desktop split pane open/close motion.
 *
 * Click-toggle cannot use `width: 0 !important` vs an inline width: WKWebView
 * drops the CSS transition (drag feels smooth because it only changes inline
 * width). Settled 0-or-open px stay on the inline style; CSS interpolates
 * width/min/max/flex-basis together so flex cannot snap the used size.
 * Do not persist in-flight pixels to layout prefs.
 */

export const PANE_SPLIT_MOTION_CLASS = "workbench--pane-motion";
export const PANE_SPLIT_SIDEBAR_MOTION_CLASS = "workbench--sidebar-motion";
export const PANE_SPLIT_ASIDE_MOTION_CLASS = "workbench--aside-motion";
export const PANE_SPLIT_MOTION_TIMEOUT_MS = 380;

export type BeginPaneSplitMotionOpts = {
  nowMs?: number;
  timeoutMs?: number;
  /** Cover native child Webviews (aside box is changing). */
  cover?: boolean;
  /** Add the workbench width-motion class (sidebar / aside). */
  width?: boolean;
  /** Left rail box is interpolating. */
  sidebar?: boolean;
  /** Aside box is interpolating. */
  aside?: boolean;
};

export type PaneSplitSizeStyle = {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flexBasis?: number;
  height?: number;
  minHeight?: number;
};

type MotionToken = {
  id: number;
  cover: boolean;
  width: boolean;
  sidebar: boolean;
  aside: boolean;
};

let nextTokenId = 1;
const tokens = new Map<number, MotionToken>();
const deferred = new Set<() => void>();
const bumpListeners = new Set<() => void>();
let flushRaf = 0;

export function shouldStartPaneSplitMotion(opts: {
  reducedMotion: boolean;
  isFirstCommit: boolean;
  collapsedChanged: boolean;
}): boolean {
  if (opts.isFirstCommit) return false;
  return opts.collapsedChanged;
}

export function prefersReducedMotion(
  media?: { matches: boolean } | null,
): boolean {
  return Boolean(media?.matches);
}

export function paneWidthTarget(collapsed: boolean, openWidth: number): number {
  if (collapsed) return 0;
  return Math.max(0, openWidth);
}

/**
 * Write the used flex size as one tuple. Only setting `width`/`height` lets
 * flex-basis/min/max snap the box and kill the CSS transition.
 */
export function paneSplitSizeStyle(
  sizePx: number,
  axis: "x" | "y",
  _resizing = false,
): PaneSplitSizeStyle {
  const n = Math.max(0, sizePx);
  if (axis === "y") {
    return { height: n, minHeight: n, flexBasis: n };
  }
  return { width: n, minWidth: n, maxWidth: n, flexBasis: n };
}

function hasTokens(): boolean {
  return tokens.size > 0;
}

export function isPaneSplitMotionActive(_nowMs = Date.now()): boolean {
  return hasTokens();
}

export function isPaneSplitWidthMotionActive(): boolean {
  for (const t of tokens.values()) {
    if (t.width) return true;
  }
  return false;
}

export function isPaneSplitCoverActive(): boolean {
  for (const t of tokens.values()) {
    if (t.cover) return true;
  }
  return false;
}

export function isPaneSplitSidebarMotionActive(): boolean {
  for (const t of tokens.values()) {
    if (t.sidebar) return true;
  }
  return false;
}

export function isPaneSplitAsideMotionActive(): boolean {
  for (const t of tokens.values()) {
    if (t.aside) return true;
  }
  return false;
}

export function beginPaneSplitMotion(
  opts: BeginPaneSplitMotionOpts = {},
): number {
  const id = nextTokenId++;
  tokens.set(id, {
    id,
    cover: Boolean(opts.cover),
    width: opts.width !== false,
    sidebar: Boolean(opts.sidebar),
    aside: Boolean(opts.aside),
  });
  return id;
}

export function endPaneSplitMotion(id?: number, _nowMs = Date.now()): void {
  if (id == null) {
    tokens.clear();
    scheduleDeferredFlush();
    return;
  }
  if (!tokens.delete(id)) return;
  if (!hasTokens()) scheduleDeferredFlush();
}

export function bumpPaneSplitMotion(): void {
  if (!hasTokens()) return;
  for (const fn of [...bumpListeners]) fn();
}

export function subscribePaneSplitMotionBump(fn: () => void): () => void {
  bumpListeners.add(fn);
  return () => {
    bumpListeners.delete(fn);
  };
}

/** Queue `fn` until motion ends. Returns true when deferred. */
export function runAfterPaneSplitMotion(fn: () => void): boolean {
  if (!hasTokens()) return false;
  deferred.add(fn);
  return true;
}

/**
 * Run `fn` after pane motion has been idle for `settleMs`.
 * Rapid sidebar toggles coalesce into one call so xterm/PTY do not SIGWINCH
 * on every open/close (prompt twitch).
 */
export function scheduleAfterPaneSplitMotion(
  fn: () => void,
  settleMs = 180,
): () => void {
  let timer = 0;
  const clear = () => {
    if (timer && typeof window !== "undefined") {
      window.clearTimeout(timer);
    }
    timer = 0;
  };
  const arm = () => {
    if (hasTokens()) {
      runAfterPaneSplitMotion(arm);
      return;
    }
    if (typeof window === "undefined" || settleMs <= 0) {
      fn();
      return;
    }
    clear();
    timer = window.setTimeout(() => {
      timer = 0;
      if (hasTokens()) {
        runAfterPaneSplitMotion(arm);
        return;
      }
      fn();
    }, settleMs);
  };
  arm();
  return clear;
}

function cancelDeferredFlush(): void {
  if (!flushRaf) return;
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(flushRaf);
  }
  flushRaf = 0;
}

/** After the motion class leaves the DOM so host rects are settled. */
function scheduleDeferredFlush(): void {
  if (typeof requestAnimationFrame !== "function") {
    flushDeferred();
    return;
  }
  if (flushRaf) return;
  flushRaf = requestAnimationFrame(() => {
    flushRaf = 0;
    if (!hasTokens()) flushDeferred();
  });
}

function flushDeferred(): void {
  const pending = [...deferred];
  deferred.clear();
  for (const fn of pending) {
    try {
      fn();
    } catch {
      /* isolate listeners */
    }
  }
}

export function resetPaneSplitMotionForTests(): void {
  cancelDeferredFlush();
  tokens.clear();
  deferred.clear();
  bumpListeners.clear();
  nextTokenId = 1;
}
