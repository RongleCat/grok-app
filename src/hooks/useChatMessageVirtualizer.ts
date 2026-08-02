/**
 * Variable-height message window for ConversationThread.
 * Respects stick-to-bottom: when pinned, always mounts the tail; when
 * escaped, windows by scrollTop and corrects scrollTop on height remeasure.
 *
 * Bounce defenses:
 * - Content-aware estimates (caller) so scrollHeight is not wildly short.
 * - Ignore shrink thrash / sub-pixel remeasure.
 * - Only shift scrollTop when a row **fully above** the viewport changes height
 *   (tall media assistants that straddle the fold expand in place).
 * - Per-row ResizeObserver so image/video decode updates height cache (callback
 *   refs alone only fire on mount).
 * - Debounced recompute so measure storms cannot oscillate the window.
 *
 * Long-session perf:
 * - rAF-coalesce scroll recomputes (one window update per frame while flinging).
 * - Cache cumulative offsets until a height commit or itemCount change.
 * - Adaptive overscan via {@link resolveChatOverscanPx}.
 * - Force-index expand capped while escaped (see chatVirtualList).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  CHAT_DEFAULT_ROW_ESTIMATE_PX,
  CHAT_VIRTUALIZE_THRESHOLD,
  computeChatVirtualWindow,
  cumulativeOffsets,
  resolveChatOverscanPx,
  scrollTopAfterHeightChange,
  shouldCommitRowHeight,
  type ChatVirtualWindow,
} from "@/lib/chatVirtualList";
import { resolveStreamOverscanScale } from "@/lib/chatVirtualPolicy";

export type UseChatMessageVirtualizerArgs = {
  itemCount: number;
  getKey: (index: number) => string;
  /** Content-aware estimate before first measure (critical for tall answers). */
  getEstimateHeight?: (index: number) => number;
  viewportRef: RefObject<HTMLElement | null>;
  /** Stick pin flag from useStickToBottom (ref, not reactive). */
  isPinnedRef: RefObject<boolean>;
  /** Reset height cache when conversation switches. */
  conversationKey?: string | number | null;
  /** Always-mounted indices (find match, streaming row, …). */
  forceIndices?: readonly number[];
  /** Below this count, render everything (no spacers). */
  threshold?: number;
  enabled?: boolean;
  /**
   * When true, shrink adaptive overscan so stream-tail updates mount fewer
   * off-screen markdown/tool siblings (low-power friendly).
   */
  streaming?: boolean;
};

export type UseChatMessageVirtualizerResult = {
  /** True when windowing is active. */
  virtualized: boolean;
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
  /** Attach to each row wrapper for measurement. */
  measureRef: (index: number) => (el: HTMLElement | null) => void;
  /** Recompute after scroll (also driven by native scroll listener). */
  onViewportScroll: () => void;
};

const full = (count: number): ChatVirtualWindow => ({
  start: 0,
  end: count,
  paddingTop: 0,
  paddingBottom: 0,
  totalHeight: 0,
});

export function useChatMessageVirtualizer(
  args: UseChatMessageVirtualizerArgs,
): UseChatMessageVirtualizerResult {
  const {
    itemCount,
    getKey,
    getEstimateHeight,
    viewportRef,
    isPinnedRef,
    conversationKey = null,
    forceIndices = [],
    threshold = CHAT_VIRTUALIZE_THRESHOLD,
    enabled = true,
    streaming = false,
  } = args;

  const virtualized = enabled && itemCount >= threshold;
  const overscanScale = resolveStreamOverscanScale(streaming);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const estimateRef = useRef(getEstimateHeight);
  estimateRef.current = getEstimateHeight;
  const forceRef = useRef(forceIndices);
  forceRef.current = forceIndices;
  const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Programmatic scrollTop from height correction — ignore once for stick. */
  const ignoreScrollAdjustRef = useRef(false);
  /** Per-index ResizeObserver so media decode updates height after mount. */
  const rowObserversRef = useRef<Map<number, ResizeObserver>>(new Map());
  /** Coalesce scroll-driven recomputes to one per animation frame. */
  const scrollRafRef = useRef<number | null>(null);
  /**
   * Bump when any committed height changes so the offset cache invalidates.
   * Avoids O(n) cumulative rebuild on every scroll when heights are stable.
   */
  const heightsVersionRef = useRef(0);
  const offsetsCacheRef = useRef<{
    version: number;
    count: number;
    offsets: number[];
  } | null>(null);

  const [win, setWin] = useState<ChatVirtualWindow>(() => full(itemCount));

  // Drop height cache on conversation change.
  useEffect(() => {
    heightsRef.current.clear();
    heightsVersionRef.current = 0;
    offsetsCacheRef.current = null;
    for (const ro of rowObserversRef.current.values()) ro.disconnect();
    rowObserversRef.current.clear();
    setWin(full(itemCount));
  }, [conversationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getHeight = useCallback((index: number) => {
    const key = getKeyRef.current(index);
    const measured = heightsRef.current.get(key);
    if (measured != null) return measured;
    const est = estimateRef.current?.(index);
    // Allow 0 (inlined tool_step spacers). Previously `est > 0` fell through to
    // DEFAULT and invented ~120px × N empty rows after long agent turns.
    // Allow explicit 0 estimates (collapsed/inlined tool rows). Previously
    // `est > 0` forced a 120px default for 0, which inflated long tool tails
    // and made the pin window land on a blank viewport.
    if (est != null && Number.isFinite(est) && est >= 0) return est;
    return CHAT_DEFAULT_ROW_ESTIMATE_PX;
  }, []);

  const getOffsets = useCallback(() => {
    const version = heightsVersionRef.current;
    const cached = offsetsCacheRef.current;
    if (
      cached &&
      cached.version === version &&
      cached.count === itemCount
    ) {
      return cached.offsets;
    }
    const offsets = cumulativeOffsets(itemCount, getHeight);
    offsetsCacheRef.current = { version, count: itemCount, offsets };
    return offsets;
  }, [itemCount, getHeight]);

  const recomputeNow = useCallback(() => {
    if (!virtualized) {
      setWin((prev) => {
        const next = full(itemCount);
        return prev.start === next.start &&
          prev.end === next.end &&
          prev.paddingTop === 0 &&
          prev.paddingBottom === 0
          ? prev
          : next;
      });
      return;
    }
    const el = viewportRef.current;
    if (!el) {
      setWin(full(itemCount));
      return;
    }
    const pin = !!isPinnedRef.current;
    const offsets = getOffsets();
    const next = computeChatVirtualWindow({
      count: itemCount,
      getHeight,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
      overscanPx: resolveChatOverscanPx({
        viewportHeight: el.clientHeight,
        pinToBottom: pin,
        scale: overscanScale,
      }),
      pinToBottom: pin,
      forceIndices: forceRef.current,
      offsets,
    });
    setWin((prev) => {
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        prev.paddingTop === next.paddingTop &&
        prev.paddingBottom === next.paddingBottom &&
        prev.totalHeight === next.totalHeight
      ) {
        return prev;
      }
      // Ignore sub-pixel spacer thrash while pinned (same window range) —
      // that was a main source of bottom flash / bounce.
      if (
        pin &&
        prev.start === next.start &&
        prev.end === next.end &&
        Math.abs(prev.paddingTop - next.paddingTop) < 3 &&
        Math.abs(prev.paddingBottom - next.paddingBottom) < 3 &&
        Math.abs(prev.totalHeight - next.totalHeight) < 6
      ) {
        return prev;
      }
      return next;
    });
  }, [
    virtualized,
    itemCount,
    viewportRef,
    isPinnedRef,
    getHeight,
    getOffsets,
    overscanScale,
  ]);

  const recompute = useCallback(() => {
    // Coalesce measure storms (tall markdown + table reflow) into one window update.
    // When pinned, use a longer debounce so spacer remeasure does not flash the tail.
    if (recomputeTimerRef.current != null) {
      clearTimeout(recomputeTimerRef.current);
    }
    const delay = isPinnedRef.current ? 72 : 32;
    recomputeTimerRef.current = setTimeout(() => {
      recomputeTimerRef.current = null;
      recomputeNow();
    }, delay);
  }, [recomputeNow, isPinnedRef]);

  // Scroll → recompute (rAF-coalesced so flings don't rebuild every event).
  useEffect(() => {
    if (!virtualized) {
      setWin(full(itemCount));
      return;
    }
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      if (ignoreScrollAdjustRef.current) {
        ignoreScrollAdjustRef.current = false;
        return;
      }
      // One window update per frame while the user is flinging through history.
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        recomputeNow();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    recomputeNow();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (recomputeTimerRef.current != null) {
        clearTimeout(recomputeTimerRef.current);
        recomputeTimerRef.current = null;
      }
    };
  }, [virtualized, itemCount, viewportRef, recompute, recomputeNow, conversationKey]);

  // Streaming growth / force index changes while mounted.
  useLayoutEffect(() => {
    if (!virtualized) return;
    recomputeNow();
  }, [virtualized, itemCount, forceIndices, recomputeNow]);

  // Drop row observers when virtualization turns off.
  useEffect(() => {
    if (virtualized) return;
    for (const ro of rowObserversRef.current.values()) ro.disconnect();
    rowObserversRef.current.clear();
  }, [virtualized]);

  const commitRowHeight = useCallback(
    (index: number, el: HTMLElement) => {
      if (!virtualized) return;
      const key = getKeyRef.current(index);
      const nextH = Math.round(el.getBoundingClientRect().height);
      const prevH = heightsRef.current.get(key);
      if (!shouldCommitRowHeight(prevH, nextH)) return;

      const pin = !!isPinnedRef.current;
      const viewport = viewportRef.current;
      // Only correct scroll when we already had a committed height (remeasure),
      // not on first measure from estimate — large first deltas at the viewport
      // edge were a primary bounce source for diagram rows.
      if (viewport && prevH != null && !pin) {
        const offsets = getOffsets();
        // Use prev height for this row when computing rowOffset (cache may
        // still hold the old value until we write nextH below).
        const rowOffset = offsets[index] ?? 0;
        const delta = nextH - prevH;
        const adjusted = scrollTopAfterHeightChange({
          scrollTop: viewport.scrollTop,
          rowOffset,
          prevHeight: prevH,
          delta,
          pinToBottom: false,
        });
        if (Math.abs(adjusted - viewport.scrollTop) > 0.5) {
          ignoreScrollAdjustRef.current = true;
          viewport.scrollTop = adjusted;
        }
      }

      heightsRef.current.set(key, nextH);
      heightsVersionRef.current += 1;
      offsetsCacheRef.current = null;
      recompute();
      // Stay glued to the true bottom after a height commit while pinned —
      // avoids one-frame empty play at the tail then snap-back flash.
      if (pin && viewport) {
        requestAnimationFrame(() => {
          if (!isPinnedRef.current || !viewportRef.current) return;
          const v = viewportRef.current;
          const top = Math.max(0, v.scrollHeight - v.clientHeight);
          if (Math.abs(v.scrollTop - top) > 0.5) {
            ignoreScrollAdjustRef.current = true;
            v.scrollTop = top;
          }
        });
      }
    },
    [virtualized, getOffsets, isPinnedRef, viewportRef, recompute],
  );

  /**
   * Stable per-index ref callbacks. Returning a fresh function from measureRef(i)
   * on every render makes React detach/reattach the ref → ResizeObserver thrash
   * and scroll jank on multi-turn chats (#280).
   */
  const measureCallbackCacheRef = useRef<
    Map<number, (el: HTMLElement | null) => void>
  >(new Map());

  // Drop cached callbacks when virtualization turns off or conversation changes.
  useEffect(() => {
    measureCallbackCacheRef.current.clear();
  }, [conversationKey, virtualized]);

  const measureRef = useCallback(
    (index: number) => {
      const cached = measureCallbackCacheRef.current.get(index);
      if (cached) return cached;
      const cb = (el: HTMLElement | null) => {
        const prevRo = rowObserversRef.current.get(index);
        if (prevRo) {
          prevRo.disconnect();
          rowObserversRef.current.delete(index);
        }
        if (!el || !virtualized) return;

        // Immediate sample (mount) + observe media/layout growth afterward.
        commitRowHeight(index, el);
        const ro = new ResizeObserver(() => {
          commitRowHeight(index, el);
        });
        ro.observe(el);
        rowObserversRef.current.set(index, ro);
      };
      measureCallbackCacheRef.current.set(index, cb);
      return cb;
    },
    [virtualized, commitRowHeight],
  );

  if (!virtualized) {
    return {
      virtualized: false,
      start: 0,
      end: itemCount,
      paddingTop: 0,
      paddingBottom: 0,
      measureRef,
      onViewportScroll: recomputeNow,
    };
  }

  return {
    virtualized: true,
    start: win.start,
    end: win.end,
    paddingTop: win.paddingTop,
    paddingBottom: win.paddingBottom,
    measureRef,
    onViewportScroll: recomputeNow,
  };
}
