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
import { scrollPerfDebug } from "@/lib/scrollPerfDebug";
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
import { shouldSnapPinnedLayoutToBottom } from "@/lib/stickToBottom";

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
  /** Shared ResizeObserver so image/video/layout growth updates height without per-row RO thrash. */
  const sharedRowObserverRef = useRef<ResizeObserver | null>(null);
  const observedElementsRef = useRef<Map<HTMLElement, number>>(new Map());
  const observedIndicesRef = useRef<Map<number, HTMLElement>>(new Map());
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
    if (sharedRowObserverRef.current) {
      sharedRowObserverRef.current.disconnect();
      sharedRowObserverRef.current = null;
    }
    observedElementsRef.current.clear();
    observedIndicesRef.current.clear();
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
    const t0 = performance.now();
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
    const recomputeDuration = performance.now() - t0;
    scrollPerfDebug.recordRecomputeTime(recomputeDuration, {
      start: next.start,
      end: next.end,
      total: count,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      paddingTop: next.paddingTop,
      paddingBottom: next.paddingBottom,
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
      scrollPerfDebug.recordScrollStart();
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
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
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
          })
        : null;
    ro?.observe(el);
    recomputeNow();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
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
    if (Math.abs(v.scrollTop - top) <= 0.5) return;
    // User already left the bottom (trackpad ticks). Snapping here is the
    // "wheel turns, screen does not move" freeze until a hard flick.
    if (
      !shouldSnapPinnedLayoutToBottom({
        scrollTop: v.scrollTop,
        scrollHeight: v.scrollHeight,
        clientHeight: v.clientHeight,
      })
    ) {
      return;
    }
    ignoreScrollAdjustRef.current = true;
    v.scrollTop = top;
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
    if (sharedRowObserverRef.current) {
      sharedRowObserverRef.current.disconnect();
      sharedRowObserverRef.current = null;
    }
    observedElementsRef.current.clear();
    observedIndicesRef.current.clear();
  }, [virtualized]);

  const commitRowHeight = useCallback(
    (index: number, el: HTMLElement, measuredHeight?: number) => {
      if (!virtualizedRef.current) return;
      if (runAfterPaneSplitMotion(() => commitRowHeight(index, el, measuredHeight))) return;
      const key = getKeyRef.current(index);
      const nextH =
        measuredHeight != null && Number.isFinite(measuredHeight) && measuredHeight >= 0
          ? Math.round(measuredHeight)
          : Math.round(el.getBoundingClientRect().height);
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

  const ensureSharedObserver = useCallback(() => {
    if (sharedRowObserverRef.current || typeof ResizeObserver === "undefined") {
      return sharedRowObserverRef.current;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const index = observedElementsRef.current.get(el);
        if (index === undefined) continue;
        let h = 0;
        if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
          const bs = entry.borderBoxSize[0];
          if (bs && Number.isFinite(bs.blockSize) && bs.blockSize > 0) {
            h = bs.blockSize;
          }
        } else if (entry.contentRect && Number.isFinite(entry.contentRect.height)) {
          h = entry.contentRect.height;
        }
        if (h <= 0) {
          h = el.getBoundingClientRect().height;
        }
        commitRowHeightRef.current(index, el, h);
      }
    });
    sharedRowObserverRef.current = ro;
    return ro;
  }, []);

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
        const ro = ensureSharedObserver();
        const prevEl = observedIndicesRef.current.get(index);
        if (prevEl && prevEl !== el) {
          ro?.unobserve(prevEl);
          observedElementsRef.current.delete(prevEl);
          observedIndicesRef.current.delete(index);
        }
        if (!el || !virtualizedRef.current) return;

        observedElementsRef.current.set(el, index);
        observedIndicesRef.current.set(index, el);
        if (ro) {
          ro.observe(el);
        } else {
          // Fallback if ResizeObserver is unavailable (e.g. test environment)
          commitRowHeightRef.current(index, el);
        }
      };
      measureCallbackCacheRef.current.set(index, cb);
      return cb;
    },
    [ensureSharedObserver],
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
