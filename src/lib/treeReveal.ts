/**
 * Sidebar project / Other-sessions expand. WKWebView drops transitions
 * unless both ends are concrete px on the inline style (same lesson as
 * paneSplitMotion — `grid-template-rows: 0fr/1fr` snaps like
 * `width: 0 !important`).
 */

/** Matches `--motion-pane`. Extra slack keeps the node mounted through rAF. */
export const TREE_REVEAL_MS = 320;
export const TREE_REVEAL_PRESENCE_MS = TREE_REVEAL_MS + 64;

export type TreeRevealSize = number | "auto";

export type TreeRevealSizeStyle = {
  height: number;
  minHeight: number;
  maxHeight: number;
};

export function treeRevealSizeStyle(heightPx: number): TreeRevealSizeStyle {
  const n = Math.max(0, heightPx);
  return { height: n, minHeight: n, maxHeight: n };
}

export function applyTreeRevealSize(
  el: HTMLElement,
  size: TreeRevealSize,
): void {
  if (size === "auto") {
    el.style.height = "";
    el.style.minHeight = "";
    el.style.maxHeight = "";
    return;
  }
  const v = `${Math.max(0, Math.round(size))}px`;
  el.style.height = v;
  el.style.minHeight = v;
  el.style.maxHeight = v;
}

/** First paint of an already-open section must not animate from 0. */
export function shouldAnimateTreeReveal(opts: {
  isFirstCommit: boolean;
  reducedMotion: boolean;
}): boolean {
  if (opts.isFirstCommit || opts.reducedMotion) return false;
  return true;
}

/**
 * Close must paint a locked px height, then 0. Writing auto→0 in one
 * commit is the WKWebView snap (same as promoting 0→N before paint).
 */
export function treeRevealCloseSteps(contentPx: number): {
  lockPx: number;
  endPx: number;
} {
  return { lockPx: Math.max(0, Math.round(contentPx)), endPx: 0 };
}

export function measureTreeRevealContent(inner: HTMLElement | null): number {
  if (!inner) return 0;
  const direct = Math.round(inner.scrollHeight);
  if (direct > 0) return direct;
  let sum = 0;
  for (let i = 0; i < inner.children.length; i++) {
    sum += inner.children[i].getBoundingClientRect().height;
  }
  return Math.round(sum);
}

let motionCount = 0;
const idle = new Set<() => void>();

export function isTreeRevealMotionActive(): boolean {
  return motionCount > 0;
}

export function beginTreeRevealMotion(): () => void {
  motionCount += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    motionCount = Math.max(0, motionCount - 1);
    if (motionCount > 0) return;
    const waiters = [...idle];
    idle.clear();
    for (const fn of waiters) fn();
  };
}

/** Queue `fn` until expand/collapse ends. Returns true when deferred. */
export function runAfterTreeRevealMotion(fn: () => void): boolean {
  if (motionCount === 0) return false;
  idle.add(fn);
  return true;
}

export function resetTreeRevealMotionForTests(): void {
  motionCount = 0;
  idle.clear();
}
