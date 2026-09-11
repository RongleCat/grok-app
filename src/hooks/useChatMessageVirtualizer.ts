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
 * - Overscan-only window commits render via startTransition ("background
 *   mounting"): when the committed window still covers the viewport, new rows
 *   are pure pre-mounting, so React may time-slice them and scroll/input can
 *   interrupt. Only a viewport hole forces the urgent lane.
 * - Markdown paint is a narrower band than the geo window. Gestures freeze
 *   the rich band (compositor still scrolls). Idle hole fills the whole
 *   target in one urgent commit; extra overscan hydrates a few rows per frame.
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CHAT_DEFAULT_ROW_ESTIMATE_PX,
  CHAT_RICH_MAX_ROWS,
  CHAT_VIRTUALIZE_THRESHOLD,
  chatOpenPinWindow,
  computeChatVirtualWindow,
  cumulativeOffsets,
  shiftOffsetsAfter,
  resolveChatOverscanPx,
  shouldCommitRowHeight,
  shouldVirtualizeChat,
  type ChatVirtualWindow,
} from "@/lib/chatVirtualList";
import {
  chatRichBandNeedsFollowUp,
  chatRichBandsOverlap,
  intersectChatRichBand,
  nextChatRichBand,
} from "@/lib/chatRowPaintPolicy";
import { scrollPerfDebug } from "@/lib/scrollPerfDebug";
import {
  isStreamPerfActive,
  resolveStreamOverscanScale,
} from "@/lib/streamRenderPolicy";
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
import {
  distanceFromBottom,
  markProgrammaticStickScroll,
  shouldForcePinnedSnapOnOpen,
  STICK_MIN_VIEWPORT_HEIGHT_PX,
  isStickViewportUnreliable,
} from "@/lib/stickToBottom";
import { createScrollVelocityTracker } from "@/lib/scrollVelocity";
import {
  fullChatVirtualWindow,
  type UseChatMessageVirtualizerArgs,
  type UseChatMessageVirtualizerResult,
} from "@/hooks/chatMessageVirtualizerShared";

export type {
  UseChatMessageVirtualizerArgs,
  UseChatMessageVirtualizerResult,
} from "@/hooks/chatMessageVirtualizerShared";

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
  /** High-precision physics velocity tracker (derivative of scrollTop / dt). */
  const velocityTrackerRef = useRef(createScrollVelocityTracker());
  /**
   * True while the user is actively scrolling or flinging with non-zero momentum.
   */
  const scrollingRef = useRef(false);
  /** Primary pointer is down on the scroller (touch / pen / mouse drag). */
  const fingerDownRef = useRef(false);
  /** Height delta above viewport absorbed by spacer during active scroll. */
  const pendingAnchorOffsetRef = useRef(0);
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

  const [win, setWin] = useState<ChatVirtualWindow>(() => fullChatVirtualWindow(itemCount));
  const winRef = useRef(win);
  winRef.current = win;
  /**
   * Window as last committed to the DOM. Transition commits lag winRef, and
   * the urgent-vs-background decision must be made against what the user can
   * actually see mounted, not against the latest scheduled window.
   */
  const committedWinRef = useRef(win);
  useLayoutEffect(() => {
    committedWinRef.current = win;
  }, [win]);
  /**
   * Distance from the bottom captured right before a pinned window commit.
   * The post-commit snap restores this distance instead of trusting
   * post-commit reads, which cannot distinguish user movement from
   * scrollHeight drift caused by the freshly mounted rows.
   */
  const pinnedPreCommitBottomDistRef = useRef(0);
  /**
   * Next pin-window commit after a conversation switch must land on the tail
   * even if leftover scrollTop is far from the new bottom.
   */
  const forceOpenSnapRef = useRef(false);
  const conversationKeyRef = useRef(conversationKey);
  if (conversationKeyRef.current !== conversationKey) {
    conversationKeyRef.current = conversationKey;
    heightsRef.current.clear();
    heightsVersionRef.current = 0;
    offsetsCacheRef.current = null;
    pendingAnchorOffsetRef.current = 0;
    pinnedPreCommitBottomDistRef.current = 0;
    forceOpenSnapRef.current = true;
    fingerDownRef.current = false;
    scrollingRef.current = false;
    if (sharedRowObserverRef.current) {
      sharedRowObserverRef.current.disconnect();
      sharedRowObserverRef.current = null;
    }
    observedElementsRef.current.clear();
    observedIndicesRef.current.clear();
    const nextWin = virtualized
      ? chatOpenPinWindow(itemCount)
      : fullChatVirtualWindow(itemCount);
    winRef.current = nextWin;
    committedWinRef.current = nextWin;
    setWin(nextWin);
  }

  /**
   * Mirror scrollingRef onto the viewport as data-scrolling so CSS can turn
   * off pointer events (kills per-frame :hover style recalc mid-gesture).
   *
   * Disable is immediate; restore is debounced. Each attribute flip costs a
   * full-list style recalc, and slow drags "settle" for a few frames between
   * wheel ticks — without the debounce one gesture toggled hover 31 times.
   */
  const hoverRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** While pinned, release scrollingRef after trackpad idle so thinking growth can pin-follow (#1172). */
  const pinnedScrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const setScrollingUi = useCallback(
    (active: boolean) => {
      const el = viewportRef.current;
      if (!el) return;
      if (hoverRestoreTimerRef.current != null) {
        clearTimeout(hoverRestoreTimerRef.current);
        hoverRestoreTimerRef.current = null;
      }
      if (active) {
        if (el.dataset.scrolling !== "1") {
          el.dataset.scrolling = "1";
        }
        return;
      }
      if (el.dataset.scrolling !== "1") return;
      hoverRestoreTimerRef.current = setTimeout(() => {
        hoverRestoreTimerRef.current = null;
        const v = viewportRef.current;
        if (v && v.dataset.scrolling === "1") {
          delete v.dataset.scrolling;
        }
      }, 220);
    },
    [viewportRef],
  );

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

  const recomputeNow = useCallback((options?: { sampleVelocity?: boolean }) => {
    const count = itemCountRef.current;
    if (!virtualizedRef.current) {
      const next = fullChatVirtualWindow(count);
      const prev = winRef.current;
      if (
        prev.start === next.start &&
        prev.end === next.end &&
        prev.paddingTop === 0 &&
        prev.paddingBottom === 0
      ) {
        return;
      }
      winRef.current = next;
      setWin(next);
      return;
    }
    const el = viewportRef.current;
    if (!el) {
      const next = fullChatVirtualWindow(count);
      winRef.current = next;
      setWin(next);
      return;
    }
    // Hidden / 0-height WebView: a pin window built with clientHeight 0
    // writes scrollTop against the full transcript and lands mid-chat
    // when the app is focused again.
    if (
      isStickViewportUnreliable({
        clientHeight: el.clientHeight,
        hidden: typeof document !== "undefined" && document.hidden,
      })
    ) {
      return;
    }
    const t0 = performance.now();
    const pin = !!isPinnedRef.current || forceOpenSnapRef.current;

    // Pinned window ignores scrollTop, so a compositor pan must not run
    // pin-snap / rich-target commits while the finger is still down.
    if (pin && fingerDownRef.current) {
      return;
    }

    // Do NOT clear scrollingRef here while pinned. Trackpad leave-bottom
    // arrives as wheel → scroll without fingerDown; clearing would let
    // pin-snap yank sub-10px escapes back to the tail (#1159). Programmatic
    // pin-follow never sets scrollingRef (see onScroll programmaticPinFollow),
    // so streaming height commits stay unblocked.

    // A synchronous scrollTop write below must land with its compensating
    // paddingTop in the same commit — a deferred (transition) commit would
    // paint one frame of visible jump. Forces the urgent lane.
    let scrollTopWasWritten = false;

    // Velocity-driven motion tracking: only sample when requested by scroll/rAF loop.
    // Pinned idle release of scrollingRef is owned by pinnedScrollIdleTimer (#1172).
    if (options?.sampleVelocity && !pin) {
      const velState = velocityTrackerRef.current.sample(el.scrollTop, t0);
      if (velState.isMoving) {
        scrollingRef.current = true;
        // Schedule next rAF to continue tracking velocity decay until motion settles
        scheduleOnFrame(scrollFrameRef.current, () =>
          recomputeNow({ sampleVelocity: true }),
        );
      } else if (scrollingRef.current) {
        scrollingRef.current = false;
        setScrollingUi(false);
        // Motion settled (velocity == 0): safely flush absorbed anchor offset to scrollTop!
        const flushOffset = pendingAnchorOffsetRef.current;
        pendingAnchorOffsetRef.current = 0;
        if (Math.abs(flushOffset) > 0.5) {
          ignoreScrollAdjustRef.current = true;
          el.scrollTop += flushOffset;
          scrollTopWasWritten = true;
        }
      }
    }

    const offsets = getOffsets();
    let next = computeChatVirtualWindow({
      count,
      getHeight,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
      overscanPx: resolveChatOverscanPx({
        viewportHeight: el.clientHeight,
        pinToBottom: pin,
        rowCount: count,
        scale: resolveStreamOverscanScale(isStreamPerfActive()),
      }),
      pinToBottom: pin,
      forceIndices: forceRef.current,
      offsets,
    });

    // Urgent-vs-background lane decision, made against the DOM-committed
    // window (winRef can run ahead of pending transition commits): if the
    // committed window still covers the viewport plus a margin, this update
    // only grows/trims overscan — pure pre-mounting. That holds for pinned
    // windows too (tail covered ⇒ expansion upward is background work).
    const committed = committedWinRef.current;
    const cTopPx = offsets[Math.min(committed.start, count)] ?? 0;
    const cBottomPx = offsets[Math.min(committed.end, count)] ?? 0;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    const coverMarginPx = 240;
    const committedCoversViewport =
      cTopPx <= Math.max(0, viewTop - coverMarginPx) &&
      cBottomPx >= Math.min(next.totalHeight, viewBottom + coverMarginPx);
    const committedRich = {
      richStart: committed.richStart,
      richEnd: committed.richEnd,
    };
    const targetRichEarly = {
      richStart: next.richStart,
      richEnd: next.richEnd,
    };
    const freezeRich = fingerDownRef.current || scrollingRef.current;
    const richHole =
      !freezeRich &&
      !chatRichBandsOverlap(
        intersectChatRichBand(committedRich, next.start, next.end),
        targetRichEarly,
      );
    const deferrable =
      !scrollTopWasWritten && committedCoversViewport && !richHole;

    // Chunked pre-mounting: a deferred expansion mounts at most a few rows
    // per commit, and an rAF loop walks the window to the full target.
    // Without the cap, a pin↔browse window swing after re-pinning committed
    // ten rows (five "Worked for …" phase blocks) at once — a ~100ms commit
    // even on the transition lane, because the DOM commit is atomic.
    if (deferrable) {
      const MAX_MOUNT_ROWS_PER_COMMIT = 3;
      let s = next.start;
      let e = next.end;
      const sFloor = committed.start - MAX_MOUNT_ROWS_PER_COMMIT;
      if (
        s < sFloor &&
        !forceRef.current.some((i) => i >= s && i < sFloor)
      ) {
        s = sFloor;
      }
      const eCeil = committed.end + MAX_MOUNT_ROWS_PER_COMMIT;
      if (
        !pin &&
        e > eCeil &&
        !forceRef.current.some((i) => i >= eCeil && i < e)
      ) {
        e = eCeil;
      }
      if (s !== next.start || e !== next.end) {
        next = {
          ...next,
          start: s,
          end: e,
          paddingTop: offsets[s] ?? 0,
          paddingBottom: Math.max(
            0,
            next.totalHeight - (offsets[Math.min(e, count)] ?? next.totalHeight),
          ),
        };
        scheduleOnFrame(scrollFrameRef.current, () => recomputeNow());
      }
    }

    const targetRich = {
      richStart: next.richStart,
      richEnd: next.richEnd,
    };
    const steppedRich = nextChatRichBand({
      target: targetRich,
      committed: {
        richStart: committed.richStart,
        richEnd: committed.richEnd,
      },
      geoStart: next.start,
      geoEnd: next.end,
      scrolling: freezeRich,
      pinToBottom: pin,
      forceIndices: forceRef.current,
      maxRows: CHAT_RICH_MAX_ROWS,
    });
    next = {
      ...next,
      richStart: steppedRich.richStart,
      richEnd: steppedRich.richEnd,
    };
    if (
      !freezeRich &&
      chatRichBandNeedsFollowUp(
        steppedRich,
        intersectChatRichBand(targetRich, next.start, next.end),
      )
    ) {
      scheduleOnFrame(scrollFrameRef.current, () => recomputeNow());
    }

    const effectivePaddingTop = Math.max(
      0,
      next.paddingTop - pendingAnchorOffsetRef.current,
    );
    const adjustedNext =
      effectivePaddingTop !== next.paddingTop
        ? { ...next, paddingTop: effectivePaddingTop }
        : next;

    if (import.meta.env.DEV) {
      const recomputeDuration = performance.now() - t0;
      scrollPerfDebug.recordRecomputeTime(recomputeDuration, {
        start: adjustedNext.start,
        end: adjustedNext.end,
        total: count,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        paddingTop: adjustedNext.paddingTop,
        paddingBottom: adjustedNext.paddingBottom,
      });
    }

    const prev = winRef.current;
    if (
      prev.start === adjustedNext.start &&
      prev.end === adjustedNext.end &&
      prev.richStart === adjustedNext.richStart &&
      prev.richEnd === adjustedNext.richEnd &&
      (scrollingRef.current || (
        prev.paddingTop === adjustedNext.paddingTop &&
        prev.paddingBottom === adjustedNext.paddingBottom &&
        prev.totalHeight === adjustedNext.totalHeight
      ))
    ) {
      return;
    }

    // Capture the distance-from-bottom *before* this commit lands. The pinned
    // snap effect restores it: post-commit reads cannot tell "user scrolled
    // up" from "mounted rows shifted scrollHeight", and judging on post-commit
    // numbers made >10px measurement drift refuse the snap (bottom bounce).
    if (pin) {
      pinnedPreCommitBottomDistRef.current = forceOpenSnapRef.current
        ? 0
        : distanceFromBottom(
            el.scrollTop,
            el.scrollHeight,
            el.clientHeight,
          );
    }

    winRef.current = adjustedNext;

    // Background-mount lane: render pure-overscan updates as a transition so
    // React can time-slice the row mounts and scroll frames stay clean. A
    // viewport hole must commit urgently or the user scrolls into blank space.
    if (deferrable) {
      startTransition(() => {
        setWin(adjustedNext);
      });
      return;
    }
    setWin(adjustedNext);
  }, [viewportRef, isPinnedRef, getHeight, getOffsets, setScrollingUi]);

  const recompute = useCallback(() => {
    // Never rebuild the virtual window from height churn mid-scroll — that
    // paddingTop flash is the universal scroll jitter. Finger-down slow
    // pans can sit below the velocity stop threshold; contact still counts.
    if (scrollingRef.current || fingerDownRef.current) {
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
      setWin(fullChatVirtualWindow(itemCountRef.current));
      return;
    }
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      if (import.meta.env.DEV) {
        scrollPerfDebug.recordScrollStart();
      }
      if (ignoreScrollAdjustRef.current) {
        ignoreScrollAdjustRef.current = false;
        return;
      }
      // Stream growth follows the pinned tail by writing scrollTop, which also
      // emits a native scroll event. It is not a user gesture and must not
      // toggle data-scrolling: wallpaper surfaces react to that attribute and
      // WebView2 can expose a transient opaque/compositor frame. Explicit
      // wheel/touch/scrollbar input has already set one of these refs.
      const programmaticPinFollow =
        isPinnedRef.current &&
        !fingerDownRef.current &&
        !scrollingRef.current;
      if (!programmaticPinFollow) {
        scrollingRef.current = true;
        setScrollingUi(true);
      }
      if (isPinnedRef.current && fingerDownRef.current) return;
      scheduleOnFrame(scrollFrameRef.current, () =>
        recomputeNow({ sampleVelocity: true }),
      );
    };

    const onUserInteraction = () => {
      const v = viewportRef.current;
      if (v) {
        velocityTrackerRef.current.reset(v.scrollTop, performance.now());
      }
      scrollingRef.current = true;
      setScrollingUi(true);
      // Pinned wheel/touchmove: keep scrolling during the gesture (#1159), but
      // release after idle so streaming thinking/tool height can pin-follow (#1172).
      if (pinnedScrollIdleTimerRef.current != null) {
        clearTimeout(pinnedScrollIdleTimerRef.current);
        pinnedScrollIdleTimerRef.current = null;
      }
      if (isPinnedRef.current) {
        pinnedScrollIdleTimerRef.current = setTimeout(() => {
          pinnedScrollIdleTimerRef.current = null;
          if (fingerDownRef.current) return;
          if (!isPinnedRef.current) return;
          scrollingRef.current = false;
          setScrollingUi(false);
          scheduleOnFrame(scrollFrameRef.current, () => recomputeNow());
        }, 160);
      }
      if (isPinnedRef.current && fingerDownRef.current) return;
      scheduleOnFrame(scrollFrameRef.current, () =>
        recomputeNow({ sampleVelocity: true }),
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      fingerDownRef.current = true;
    };
    const endContact = () => {
      if (!fingerDownRef.current) return;
      fingerDownRef.current = false;
      // Touch/pen lift while pinned: release the scroll freeze so streaming
      // height commits resume. Trackpad wheel never sets fingerDown, so this
      // does not reintroduce the #1159 pin-snap yank on leave-bottom.
      if (isPinnedRef.current) {
        scrollingRef.current = false;
        pendingAnchorOffsetRef.current = 0;
        setScrollingUi(false);
      }
      scheduleOnFrame(scrollFrameRef.current, () =>
        recomputeNow({ sampleVelocity: true }),
      );
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      endContact();
    };
    const onPointerCancel = (e: PointerEvent) => {
      // Direct-manipulation pan: Chromium MUST pointercancel, then never
      // pointerup. The finger is still down. Touch: touchend clears. Pen
      // cancel is a real abort (no TouchEvent stream).
      if (!e.isPrimary) return;
      if (e.pointerType === "touch") return;
      endContact();
    };
    const onTouchStart = () => {
      fingerDownRef.current = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      endContact();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserInteraction, { passive: true });
    el.addEventListener("touchmove", onUserInteraction, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerCancel, { passive: true });
    // Viewport chrome resize only — not content (content RO was thrashy).
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (scrollingRef.current || fingerDownRef.current) {
              return;
            }
            if (isPinnedRef.current) {
              scheduleOnFrame(scrollFrameRef.current, () => recomputeNow());
              return;
            }
            if (isPaneSplitMotionActive()) {
              runAfterPaneSplitMotion(() => {
                recomputeNow();
              });
              return;
            }
            recompute();
          })
        : null;
    ro?.observe(el);
    recomputeNow();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserInteraction);
      el.removeEventListener("touchmove", onUserInteraction);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (hoverRestoreTimerRef.current != null) {
        clearTimeout(hoverRestoreTimerRef.current);
        hoverRestoreTimerRef.current = null;
      }
      if (pinnedScrollIdleTimerRef.current != null) {
        clearTimeout(pinnedScrollIdleTimerRef.current);
        pinnedScrollIdleTimerRef.current = null;
      }
      delete el.dataset.scrolling;
      ro?.disconnect();
      cancelFrameSchedule(scrollFrameRef.current);
      if (recomputeTimerRef.current != null) {
        clearTimeout(recomputeTimerRef.current);
        recomputeTimerRef.current = null;
      }
    };
  }, [virtualized, viewportRef, recompute, recomputeNow, conversationKey, setScrollingUi]);

  // Streaming growth / force index changes while mounted.
  useLayoutEffect(() => {
    if (!virtualized) return;
    recomputeNow();
  }, [virtualized, itemCount, forceIndices, recomputeNow]);

  // After a pin-window spacer commit, restore the pre-commit distance from
  // the bottom before paint, so a commit whose mounted heights differ from
  // the cached estimates is displacement-neutral (no bottom bounce).
  useLayoutEffect(() => {
    if (!virtualized) return;
    if (fingerDownRef.current) return;
    const forceOpen = shouldForcePinnedSnapOnOpen({
      pinned: true,
      forceOpenSnap: forceOpenSnapRef.current,
    });
    if (!isPinnedRef.current && !forceOpen) return;
    const v = viewportRef.current;
    if (!v) return;
    if (v.clientHeight < STICK_MIN_VIEWPORT_HEIGHT_PX) return;
    // When stick still says pinned, always restore the bottom offset.
    // Streaming thinking/tool growth can inflate pre-commit dist above the
    // escape threshold without the user leaving the tail (#1172). True
    // leave-bottom is owned by useStickToBottom flipping isPinnedRef.
    // Mid-gesture yank is prevented by scrollingRef / fingerDown above and
    // by not clearing scrollingRef during the wheel itself (#1159).
    let dist = pinnedPreCommitBottomDistRef.current;
    if (forceOpen) {
      dist = 0;
    }
    const top = Math.max(0, v.scrollHeight - v.clientHeight);
    const desired = Math.max(0, top - dist);
    if (Math.abs(v.scrollTop - desired) > 0.5) {
      ignoreScrollAdjustRef.current = true;
      markProgrammaticStickScroll(v, desired);
      v.scrollTop = desired;
    }
    // Placeholder windows use totalHeight 0; keep the flag until the real
    // spacer commit so leftover distance cannot skip the tail snap.
    if (forceOpen && win.totalHeight > 0) {
      forceOpenSnapRef.current = false;
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
      if (
        !isPinnedRef.current &&
        runAfterPaneSplitMotion(() =>
          commitRowHeight(index, el, measuredHeight),
        )
      )
        return;
      const key = getKeyRef.current(index);
      const nextH =
        measuredHeight != null &&
        Number.isFinite(measuredHeight) &&
        measuredHeight >= 0
          ? Math.round(measuredHeight)
          : Math.round(el.getBoundingClientRect().height);
      const prevMeasured = heightsRef.current.get(key);
      const estRaw = estimateRef.current?.(index);
      const estimateH =
        estRaw != null && Number.isFinite(estRaw) && estRaw >= 0
          ? Math.round(estRaw)
          : CHAT_DEFAULT_ROW_ESTIMATE_PX;
      const prevH = prevMeasured ?? estimateH;

      if (import.meta.env.DEV) {
        scrollPerfDebug.recordHeightMeasurement(index, key, nextH, estimateH);
      }

      if (prevMeasured != null) {
        if (!shouldCommitRowHeight(prevMeasured, nextH)) return;
      } else if (Math.abs(nextH - estimateH) < 4) {
        heightsRef.current.set(key, nextH);
        return;
      }

      // Pre-commit offsets before cache invalidation to determine if row is above viewport
      const offsetsBefore = getOffsets();
      const rowOffset = offsetsBefore[index] ?? 0;
      const viewport = viewportRef.current;
      const isFullyAboveViewport =
        viewport && rowOffset + prevH <= viewport.scrollTop + 0.5;

      // Measurement instant commit
      const delta = nextH - prevH;
      heightsRef.current.set(key, nextH);
      heightsVersionRef.current += 1;

      // Only this row changed, so patch the suffix instead of paying a height
      // lookup per row on the next read. The shift is derived from the height
      // already inside `offsetsBefore` rather than from `delta`, because an
      // unmeasured row contributes its *unrounded* estimate there while `prevH`
      // is rounded — using `delta` would drift the suffix on every commit.
      const nextOffsets =
        index >= 0 && index + 1 < offsetsBefore.length
          ? shiftOffsetsAfter(
              offsetsBefore,
              index,
              nextH - ((offsetsBefore[index + 1] ?? 0) - rowOffset),
            )
          : null;
      offsetsCacheRef.current = nextOffsets
        ? {
            version: heightsVersionRef.current,
            count: itemCountRef.current,
            offsets: nextOffsets,
          }
        : null;

      // Compensate height changes for rows above the viewport
      if (!isPinnedRef.current && isFullyAboveViewport && Math.abs(delta) > 0.5) {
        if (scrollingRef.current || fingerDownRef.current) {
          // Mid-scroll: absorb into top spacer without writing scrollTop (preserves smooth gesture)
          pendingAnchorOffsetRef.current += delta;
        } else if (viewport) {
          // Idle reading: synchronously adjust scrollTop to keep on-screen content locked in place
          ignoreScrollAdjustRef.current = true;
          viewport.scrollTop += delta;
        }
      }

      recompute();
    },
    [getOffsets, recompute, viewportRef, isPinnedRef],
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
        if (h <= 0) continue;
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
      richStart: 0,
      richEnd: itemCount,
      rowHeight: getHeight,
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
    richStart: win.richStart,
    richEnd: win.richEnd,
    rowHeight: getHeight,
    measureRef,
    onViewportScroll: recomputeNow,
  };
}
