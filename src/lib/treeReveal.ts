/**
 * Sidebar project / Other-sessions expand. WKWebView drops transitions
 * unless both ends are concrete px on the inline style (same lesson as
 * paneSplitMotion — `grid-template-rows: 0fr/1fr` snaps like
 * `width: 0 !important`).
 */

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
