/**
 * Pure windowing math for fixed-height lists (sidebar sessions, etc.).
 * Zero-deps — used by VirtualList; safe to unit-test without DOM.
 *
 * Matches `.tree-l3` CSS: height 30px, list gap 2px (see app.css).
 */

/** Fixed session row height in the project tree (`.tree-l3`). */
export const SIDEBAR_SESSION_ROW_HEIGHT = 30;

/** Flex gap between session rows (`.tree-l3-list` / orphan stack). */
export const SIDEBAR_SESSION_ROW_GAP = 2;

/**
 * Below this count, VirtualList renders every row (no spacers).
 * Keeps short project groups identical to pre-virtualization DOM.
 */
export const SIDEBAR_VIRTUALIZE_THRESHOLD = 32;

/** Default extra rows above/below the viewport. */
export const DEFAULT_OVERSCAN = 6;

export type VirtualWindowInput = {
  itemCount: number;
  rowHeight: number;
  /** Space between rows (flex gap). Default 0. */
  gap?: number;
  /**
   * How far the viewport has scrolled into the list.
   * 0 = list top aligned with viewport top.
   * Negative = list starts below the viewport top (not yet reached).
   */
  scrollOffset: number;
  viewportHeight: number;
  overscan?: number;
};

export type VirtualWindow = {
  /** Inclusive start index. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** Spacer height above the first rendered row. */
  paddingTop: number;
  /** Spacer height below the last rendered row. */
  paddingBottom: number;
  /** Full list content height (all rows + gaps). */
  totalHeight: number;
};

/** Distance from list top to the start of `index` (0-based). */
export function itemOffset(
  index: number,
  rowHeight: number,
  gap = 0,
): number {
  if (index <= 0) return 0;
  return index * (rowHeight + gap);
}

/** Total height of `itemCount` fixed rows with `gap` between them. */
export function totalListHeight(
  itemCount: number,
  rowHeight: number,
  gap = 0,
): number {
  if (itemCount <= 0) return 0;
  if (rowHeight < 0 || gap < 0) return 0;
  return itemCount * rowHeight + Math.max(0, itemCount - 1) * gap;
}

/**
 * Compute the visible slice + spacers for a fixed-row list.
 * Indices are clamped to `[0, itemCount]`; empty lists return zeros.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const rowHeight = input.rowHeight;
  const gap = input.gap ?? 0;
  const overscan = Math.max(0, Math.floor(input.overscan ?? DEFAULT_OVERSCAN));
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollOffset = input.scrollOffset;

  const totalHeight = totalListHeight(itemCount, rowHeight, gap);

  if (itemCount === 0 || rowHeight <= 0) {
    return {
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
    };
  }

  const stride = rowHeight + gap;
  // Content range intersecting the viewport (list-local Y).
  const visibleTop = Math.max(0, scrollOffset);
  const visibleBottom = Math.max(
    visibleTop,
    scrollOffset + viewportHeight,
  );

  // Item i occupies [i * stride, i * stride + rowHeight).
  let start = Math.floor(visibleTop / stride);
  // First index whose start is >= visibleBottom is past the viewport;
  // also include the row that straddles visibleBottom when it starts earlier.
  let end = Math.ceil(visibleBottom / stride);
  // If visibleBottom lands in the gap after a row, ceil still points past it.

  start = Math.max(0, start - overscan);
  end = Math.min(itemCount, end + overscan);

  if (start >= end) {
    // Degenerate (e.g. zero viewport): show a single row near the offset.
    start = Math.min(
      Math.max(0, Math.floor(Math.max(0, scrollOffset) / stride)),
      itemCount - 1,
    );
    end = start + 1;
  }

  const paddingTop = itemOffset(start, rowHeight, gap);
  const renderedHeight = totalListHeight(end - start, rowHeight, gap);
  const paddingBottom = Math.max(0, totalHeight - paddingTop - renderedHeight);

  return {
    start,
    end,
    paddingTop,
    paddingBottom,
    totalHeight,
  };
}

/**
 * Clamp scrollTop so item `index` is fully visible in a viewport of
 * `viewportHeight`, with optional margin.
 */
export function scrollTopForIndex(
  index: number,
  opts: {
    itemCount: number;
    rowHeight: number;
    gap?: number;
    viewportHeight: number;
    currentScrollTop: number;
    /** List top offset within the scroll content. */
    listOffsetTop: number;
    margin?: number;
  },
): number {
  const {
    itemCount,
    rowHeight,
    gap = 0,
    viewportHeight,
    currentScrollTop,
    listOffsetTop,
    margin = 4,
  } = opts;
  if (itemCount <= 0 || index < 0 || index >= itemCount) {
    return currentScrollTop;
  }

  const itemTop = listOffsetTop + itemOffset(index, rowHeight, gap);
  const itemBottom = itemTop + rowHeight;
  const viewTop = currentScrollTop;
  const viewBottom = currentScrollTop + viewportHeight;

  if (itemTop < viewTop + margin) {
    return Math.max(0, itemTop - margin);
  }
  if (itemBottom > viewBottom - margin) {
    return Math.max(0, itemBottom - viewportHeight + margin);
  }
  return currentScrollTop;
}
