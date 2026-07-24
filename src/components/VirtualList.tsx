/**
 * Lightweight fixed-row virtual list (no extra deps).
 * Discovers the nearest scroll parent (e.g. OverlayScroll viewport) and
 * windows children by scrollTop / rowHeight. Short lists render fully.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  computeVirtualWindow,
  scrollTopForIndex,
  SIDEBAR_VIRTUALIZE_THRESHOLD,
  type VirtualWindow,
} from "@/lib/virtualList";

export type VirtualListProps<T> = {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  rowHeight: number;
  /** Flex gap between rows. Default 0. */
  gap?: number;
  overscan?: number;
  /**
   * Render every item when `items.length` is below this.
   * Default: SIDEBAR_VIRTUALIZE_THRESHOLD.
   */
  threshold?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * When set and present in `items`, keep that row scrolled into view
   * (active session, etc.). Re-runs when the key changes.
   */
  scrollToKey?: string | null;
};

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function windowsEqual(a: VirtualWindow, b: VirtualWindow): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.paddingTop === b.paddingTop &&
    a.paddingBottom === b.paddingBottom &&
    a.totalHeight === b.totalHeight
  );
}

const fullWindow = (count: number): VirtualWindow => ({
  start: 0,
  end: count,
  paddingTop: 0,
  paddingBottom: 0,
  totalHeight: 0,
});

export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  rowHeight,
  gap = 0,
  overscan,
  threshold = SIDEBAR_VIRTUALIZE_THRESHOLD,
  className,
  style,
  scrollToKey,
}: VirtualListProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const count = items.length;
  const shouldVirtualize = count >= threshold;

  const [win, setWin] = useState<VirtualWindow>(() => fullWindow(count));

  const recompute = useCallback(() => {
    const root = rootRef.current;
    if (!root || !shouldVirtualize) {
      setWin((prev) => {
        const next = fullWindow(count);
        return windowsEqual(prev, next) ? prev : next;
      });
      return;
    }

    const scrollParent = scrollParentRef.current ?? findScrollParent(root);
    scrollParentRef.current = scrollParent;

    if (!scrollParent) {
      setWin((prev) => {
        const next = fullWindow(count);
        return windowsEqual(prev, next) ? prev : next;
      });
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    // How far into the list the viewport top sits (list-local Y).
    const scrollOffset = parentRect.top - rootRect.top;
    const next = computeVirtualWindow({
      itemCount: count,
      rowHeight,
      gap,
      scrollOffset,
      viewportHeight: scrollParent.clientHeight,
      overscan,
    });
    setWin((prev) => (windowsEqual(prev, next) ? prev : next));
  }, [count, rowHeight, gap, overscan, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize) {
      setWin(fullWindow(count));
      return;
    }

    const root = rootRef.current;
    if (!root) return;

    const scrollParent = findScrollParent(root);
    scrollParentRef.current = scrollParent;

    const onScroll = () => recompute();
    scrollParent?.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => recompute());
    ro.observe(root);
    if (scrollParent) ro.observe(scrollParent);

    recompute();

    return () => {
      scrollParent?.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [recompute, shouldVirtualize, count]);

  // Keep the active/scroll target row in view when its key changes.
  useLayoutEffect(() => {
    if (scrollToKey == null || scrollToKey === "") return;
    const index = items.findIndex(
      (item, i) => getKey(item, i) === scrollToKey,
    );
    if (index < 0) return;

    const root = rootRef.current;
    if (!root) return;
    const scrollParent = scrollParentRef.current ?? findScrollParent(root);
    if (!scrollParent) return;
    scrollParentRef.current = scrollParent;

    const rootRect = root.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const listOffsetTop =
      rootRect.top - parentRect.top + scrollParent.scrollTop;

    const nextTop = scrollTopForIndex(index, {
      itemCount: count,
      rowHeight,
      gap,
      viewportHeight: scrollParent.clientHeight,
      currentScrollTop: scrollParent.scrollTop,
      listOffsetTop,
    });
    if (nextTop !== scrollParent.scrollTop) {
      scrollParent.scrollTop = nextTop;
    }
    // Recompute after scroll so the target row is mounted.
    recompute();
    // scrollToKey-driven only (not every items identity change while scrolling).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToKey, count, rowHeight, gap]);

  if (!shouldVirtualize) {
    // Same structure as a plain mapped list — no spacers, no extra wrappers.
    return (
      <div ref={rootRef} className={className} style={style}>
        {items.map((item, index) => (
          <Fragment key={getKey(item, index)}>
            {renderItem(item, index)}
          </Fragment>
        ))}
      </div>
    );
  }

  const { start, end, paddingTop, paddingBottom } = win;
  const slice = items.slice(start, end);

  return (
    <div
      ref={rootRef}
      className={
        className
          ? `virtual-list virtual-list--windowed ${className}`
          : "virtual-list virtual-list--windowed"
      }
      style={{
        ...style,
        // Spacers are siblings; row gap lives on the inner body only.
        gap: 0,
      }}
    >
      {paddingTop > 0 ? (
        <div
          className="virtual-list__spacer"
          style={{ height: paddingTop, flexShrink: 0 }}
          aria-hidden
        />
      ) : null}
      <div
        className="virtual-list__body"
        style={{
          display: "flex",
          flexDirection: "column",
          gap,
        }}
      >
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <Fragment key={getKey(item, index)}>
              {renderItem(item, index)}
            </Fragment>
          );
        })}
      </div>
      {paddingBottom > 0 ? (
        <div
          className="virtual-list__spacer"
          style={{ height: paddingBottom, flexShrink: 0 }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
