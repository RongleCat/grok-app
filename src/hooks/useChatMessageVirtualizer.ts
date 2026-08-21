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
 * - Pinned: no per-row scrollTop snap. Image/PDF decode used to snap on
 *   every commit, then the window layout snapped again (bounce-up).
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
  shouldWriteScrollOnRowCommit,
  shouldVirtualizeChat,
  type ChatVirtualWindow,
} from "@/lib/chatVirtualList";
import { resolveStreamOverscanScale } from "@/lib/streamRenderPolicy";
import {
  cancelFrameSchedule,
  emptyFrameSchedule,
  scheduleOnFrame,
  type FrameSchedule,
} from "@/lib/frameSchedule";
import {
  isPaneSplitMotionActive,
  runAfterPaneSplitMotion,
} from "@/lib/paneSplitMotion";

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
  } = args;

  let estimatedTotal = 0;
  if (enabled && itemCount > 0 && itemCount < threshold) {
    for (let i = 0; i < itemCount; i++) {
      const est = getEstimateHeight?.(i);
      estimatedTotal +=
        est != null && Number.isFinite(est) && est >= 0
          ? est
          : CHAT_DEFAULT_ROW_ESTIMATE_PX;
    }
  }
  const virtualized = shouldVirtualizeChat({
    itemCount,
    threshold,
    enabled,
    estimatedTotalHeight: estimatedTotal,
  });
  const heightsRef = useRef<Map<string, number>>(new Map());
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const estimateRef = useRef(getEstimateHeight);
  estimateRef.current = getEstimateHeight;
  const forceRef = useRef(forceIndices);
  forceRef.current = forceIndices;
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const virtualizedRef = useRef(virtualized);
  virtualizedRef.current = virtualized;
  const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Programmatic scrollTop from height correction — ignore once for stick. */
  const ignoreScrollAdjustRef = useRef(false);
  /** Per-index ResizeObserver so image/video decode updates height after mount. */
  const rowObserversRef = useRef<Map<number, ResizeObserver>>(new Map());
  /** Coalesce scroll-driven recomputes to one paint (rAF + mixed-Hz fallback). */
  const scrollFrameRef = useRef<FrameSchedule>(emptyFrameSchedule());
  /**
   * True while the user is actively scrolling. Height remeasures that rebuild
   * the virtual window mid-fling were the main "everything jitters on scroll"
   * source (estimate→actual + paddingTop churn). Defer those until idle.
   */
  const scrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Height commits landed during scroll — recompute once when idle. */
  const pendingHeightRecomputeRef = useRef(false);
  /**
   * Measures taken mid-scroll. Applied to heightsRef only after scroll idle
   * so window offsets stay stable during the gesture (no padding flash).
   */
  const pendingHeightsRef = useRef<Map<string, number>>(new Map());
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
    const count = itemCountRef.current;
    const version = heightsVersionRef.current;
    const cached = offsetsCacheRef.current;
    if (
      cached &&
      cached.version === version &&
      cached.count === count
    ) {
      return cached.offsets;
    }
    const offsets = cumulativeOffsets(count, getHeight);
    offsetsCacheRef.current = { version, count, offsets };
    return offsets;
  }, [getHeight]);

  const recomputeNow = useCallback(() => {
    const count = itemCountRef.current;
    if (!virtualizedRef.current) {
      setWin((prev) => {
        const next = full(count);
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
      setWin(full(count));
      return;
    }
    const pin = !!isPinnedRef.current;
    const offsets = getOffsets();
    const next = computeChatVirtualWindow({
      count,
      getHeight,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
      overscanPx: resolveChatOverscanPx({
        viewportHeight: el.clientHeight,
        pinToBottom: pin,
        scale: resolveStreamOverscanScale(
          typeof document !== "undefined" &&
            document.documentElement.dataset.streamPerf === "1",
        ),
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
      // Ignore sub-pixel spacer thrash when the visible range is unchanged
      // (pin or browse) — main source of bottom / mid-scroll flash.
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        Math.abs(prev.paddingTop - next.paddingTop) < 4 &&
        Math.abs(prev.paddingBottom - next.paddingBottom) < 4 &&
        Math.abs(prev.totalHeight - next.totalHeight) < 8
      ) {
        return prev;
      }
      return next;
    });
  }, [viewportRef, isPinnedRef, getHeight, getOffsets]);

  const recompute = useCallback(() => {
    // Never rebuild the virtual window from height churn mid-scroll — that
    // paddingTop flash is the universal scroll jitter.
    if (scrollingRef.current) {
      pendingHeightRecomputeRef.current = true;
      return;
    }
    // Coalesce measure storms (tall markdown + table reflow) into one window update.
    // When pinned, use a longer debounce so spacer remeasure does not flash the tail.
    if (recomputeTimerRef.current != null) {
      clearTimeout(recomputeTimerRef.current);
    }
    const delay = isPinnedRef.current ? 72 : 48;
    recomputeTimerRef.current = setTimeout(() => {
      recomputeTimerRef.current = null;
      recomputeNow();
    }, delay);
  }, [recomputeNow, isPinnedRef]);

  // Scroll → recompute window range only (rAF). Height-driven rebuilds wait for idle.
  // Do not list itemCount: a send must not tear down scroll/RO while old row
  // observers still fire with a stale count (window fight = flash).
  useEffect(() => {
    if (!virtualized) {
      setWin(full(itemCountRef.current));
      return;
    }
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      if (ignoreScrollAdjustRef.current) {
        ignoreScrollAdjustRef.current = false;
        return;
      }
      // Pin-lock follow / clamp writes look like scroll events. Treating
      // them as a user fling buffers height commits for 140ms, then flushes
      // a spacer jump that stick snaps back — bounce at the locked bottom.
      if (isPinnedRef.current) {
        scheduleOnFrame(scrollFrameRef.current, recomputeNow);
        return;
      }
      scrollingRef.current = true;
      if (scrollIdleTimerRef.current != null) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        scrollIdleTimerRef.current = null;
        scrollingRef.current = false;
        // Flush measures deferred during the fling.
        const pending = pendingHeightsRef.current;
        if (pending.size > 0) {
          for (const [k, h] of pending) {
            heightsRef.current.set(k, h);
          }
          pending.clear();
          heightsVersionRef.current += 1;
          offsetsCacheRef.current = null;
          pendingHeightRecomputeRef.current = true;
        }
        if (pendingHeightRecomputeRef.current) {
          pendingHeightRecomputeRef.current = false;
          recomputeNow();
        }
      }, 140);
      // One window update per paint while flinging. Timeout fallback covers
      // mixed 120Hz/75Hz displays where rAF can skip a 75Hz vsync.
      scheduleOnFrame(scrollFrameRef.current, recomputeNow);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Viewport chrome resize only — not content (content RO was thrashy).
    const ro = new ResizeObserver(() => {
      if (scrollingRef.current || isPaneSplitMotionActive()) {
        pendingHeightRecomputeRef.current = true;
        if (isPaneSplitMotionActive()) {
          runAfterPaneSplitMotion(() => {
            pendingHeightRecomputeRef.current = false;
            recomputeNow();
          });
        }
        return;
      }
      recompute();
    });
    ro.observe(el);
    recomputeNow();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelFrameSchedule(scrollFrameRef.current);
      if (recomputeTimerRef.current != null) {
        clearTimeout(recomputeTimerRef.current);
        recomputeTimerRef.current = null;
      }
      if (scrollIdleTimerRef.current != null) {
        clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
    };
  }, [virtualized, viewportRef, recompute, recomputeNow, conversationKey]);

  // Streaming growth / force index changes while mounted.
  useLayoutEffect(() => {
    if (!virtualized) return;
    recomputeNow();
  }, [virtualized, itemCount, forceIndices, recomputeNow]);

  // After a pin-window spacer commit, snap before paint so the user never
  // sees one frame of "scrolled up" then stick yanking back.
  useLayoutEffect(() => {
    if (!virtualized || !isPinnedRef.current) return;
    const v = viewportRef.current;
    if (!v) return;
    const top = Math.max(0, v.scrollHeight - v.clientHeight);
    if (Math.abs(v.scrollTop - top) > 0.5) {
      ignoreScrollAdjustRef.current = true;
      v.scrollTop = top;
    }
  }, [
    virtualized,
    win.start,
    win.end,
    win.paddingTop,
    win.paddingBottom,
    win.totalHeight,
    isPinnedRef,
    viewportRef,
  ]);

  // Drop row observers when virtualization turns off.
  useEffect(() => {
    if (virtualized) return;
    for (const ro of rowObserversRef.current.values()) ro.disconnect();
    rowObserversRef.current.clear();
  }, [virtualized]);

  const commitRowHeight = useCallback(
    (index: number, el: HTMLElement) => {
      if (!virtualizedRef.current) return;
      if (runAfterPaneSplitMotion(() => commitRowHeight(index, el))) return;
      const key = getKeyRef.current(index);
      const nextH = Math.round(el.getBoundingClientRect().height);
      const prevMeasured = heightsRef.current.get(key);
      const estRaw = estimateRef.current?.(index);
      const estimateH =
        estRaw != null && Number.isFinite(estRaw) && estRaw >= 0
          ? Math.round(estRaw)
          : CHAT_DEFAULT_ROW_ESTIMATE_PX;
      // First paint used the estimate in offsets; treat it as the previous
      // height so estimate→actual can keep the viewport anchored.
      const prevH = prevMeasured ?? estimateH;

      if (prevMeasured != null) {
        if (!shouldCommitRowHeight(prevMeasured, nextH)) return;
      } else if (Math.abs(nextH - estimateH) < 4) {
        // Close enough to estimate — record without rebuilding the window.
        if (scrollingRef.current) {
          pendingHeightsRef.current.set(key, nextH);
        } else {
          heightsRef.current.set(key, nextH);
        }
        return;
      }

      // Mid-scroll: buffer only — do not mutate live offsets until idle.
      if (scrollingRef.current) {
        pendingHeightsRef.current.set(key, nextH);
        pendingHeightRecomputeRef.current = true;
        return;
      }

      heightsRef.current.set(key, nextH);
      heightsVersionRef.current += 1;
      offsetsCacheRef.current = null;

      const pin = !!isPinnedRef.current;
      const viewport = viewportRef.current;
      if (viewport && !pin && Math.abs(nextH - prevH) >= 4) {
        // Offsets for scroll anchor must use prevH for this row.
        heightsRef.current.set(key, prevH);
        const offsetsBefore = cumulativeOffsets(itemCountRef.current, (i) => {
          const k = getKeyRef.current(i);
          const m = heightsRef.current.get(k);
          if (m != null) return m;
          const e = estimateRef.current?.(i);
          if (e != null && Number.isFinite(e) && e >= 0) return e;
          return CHAT_DEFAULT_ROW_ESTIMATE_PX;
        });
        heightsRef.current.set(key, nextH);
        const rowOffset = offsetsBefore[index] ?? 0;
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

      recompute();
      // Pinned: do not snap here. Each image/PDF decode used to write
      // scrollTop, then the debounced window layout wrote it again — bounce.
      // One snap lives in the window-metrics layout effect after coalesce.
      if (pin && viewport && shouldWriteScrollOnRowCommit(true)) {
        const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        if (Math.abs(viewport.scrollTop - top) > 0.5) {
          ignoreScrollAdjustRef.current = true;
          viewport.scrollTop = top;
        }
      }
    },
    [isPinnedRef, viewportRef, recompute],
  );

  const commitRowHeightRef = useRef(commitRowHeight);
  commitRowHeightRef.current = commitRowHeight;

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
        if (!el || !virtualizedRef.current) return;

        // Immediate sample (mount) + observe media/layout growth afterward.
        commitRowHeightRef.current(index, el);
        // Coalesce RO storms (multi-image decode) — one commit per frame.
        let roRaf = 0;
        const ro = new ResizeObserver(() => {
          if (roRaf) return;
          roRaf = requestAnimationFrame(() => {
            roRaf = 0;
            commitRowHeightRef.current(index, el);
          });
        });
        ro.observe(el);
        rowObserversRef.current.set(index, ro);
      };
      measureCallbackCacheRef.current.set(index, cb);
      return cb;
    },
    [],
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
