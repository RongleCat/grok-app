/**
 * Keep a scroll viewport pinned to the bottom while the user is following,
 * and release pin after they scroll up (wheel / touch / scrollbar).
 *
 * Pin model mirrors use-stick-to-bottom's escapedFromLock:
 * - User scroll-up escapes; we do NOT re-pin merely because they are still
 *   within the near-bottom threshold (that thrash is what causes bounce).
 * - Re-pin only after they scroll down again and land on the absolute
 *   bottom, or after force-stick / conversation switch.
 * - Programmatic follows are instant and ignored by the scroll handler so
 *   resize + stream growth cannot fight the user mid-gesture.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";
import {
  STICK_ESCAPE_MIN_DELTA_PX,
  STICK_ESCAPE_WHEEL_DELTA,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  isHardBottom,
  isHeightDeltaNoise,
  isMeaningfulScrollUp,
  isNearBottom,
  nextStickPinState,
  pinnedFollowDelayMs,
  shouldClampPinnedOverscroll,
  shouldClampPinnedStreamDrift,
  shouldReleaseStickOnScrollUp,
} from "@/lib/stickToBottom";
import { runAfterPaneSplitMotion } from "@/lib/paneSplitMotion";

export type UseStickToBottomOptions = {
  /** Re-pin when the conversation identity changes (session / first message). */
  conversationKey?: string | number | null;
  /** Force re-pin (e.g. user just sent a message). */
  forceStickKey?: string | number | null;
  /** px from bottom still considered "near" for re-engage. Default 100. */
  thresholdPx?: number;
  enabled?: boolean;
};

export type UseStickToBottomResult = {
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Optional: attach to the content column for more accurate resize observe. */
  contentRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** True while auto-follow is active (ref, not reactive). */
  isPinnedRef: RefObject<boolean>;
  /** Reactive: show "back to bottom" control when user has scrolled up. */
  showBack: boolean;
};

export function useStickToBottom(
  options: UseStickToBottomOptions = {},
): UseStickToBottomResult {
  const {
    conversationKey = null,
    forceStickKey = null,
    thresholdPx = STICK_TO_BOTTOM_THRESHOLD_PX,
    enabled = true,
  } = options;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Auto-follow stream / growth. */
  const isPinnedRef = useRef(true);
  /**
   * User intentionally left the bottom. Stays true until they scroll down
   * (or force-stick). Prevents re-pin while still inside the near threshold.
   */
  const escapedRef = useRef(false);
  /**
   * Last intentional user gesture toward latest content. Cleared on scroll-up.
   * Used with hardBottom so landing at max scrollTop re-pins even when the
   * final scroll event has no positive delta.
   */
  const userIntentDownRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  /** scrollTop we just wrote — used to ignore synthetic scroll events. */
  const ignoreScrollTopRef = useRef<number | undefined>(undefined);
  /** Non-zero while a content resize is being applied (race with scroll). */
  const resizeDifferenceRef = useRef(0);
  const thresholdRef = useRef(thresholdPx);
  thresholdRef.current = thresholdPx;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [showBack, setShowBack] = useState(false);

  const syncShowBack = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      setShowBack(false);
      return;
    }
    const overflow = el.scrollHeight > el.clientHeight + 40;
    setShowBack(!isPinnedRef.current && overflow);
  }, []);

  const applyScrollTop = useCallback((top: number) => {
    const el = viewportRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - top) < 1) {
      ignoreScrollTopRef.current = el.scrollTop;
      return;
    }
    // Force instant assignment even if CSS scroll-behavior is smooth.
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = top;
    ignoreScrollTopRef.current = el.scrollTop;
    lastScrollTopRef.current = el.scrollTop;
    if (prev) el.style.scrollBehavior = prev;
    else el.style.removeProperty("scroll-behavior");
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "instant") => {
      const el = viewportRef.current;
      if (!el) return;
      escapedRef.current = false;
      isPinnedRef.current = true;
      userIntentDownRef.current = false;
      const top = bottomScrollTop(el.scrollHeight, el.clientHeight);
      if (behavior === "smooth" && typeof el.scrollTo === "function") {
        // Smooth is only for the explicit "back to bottom" button.
        // Mark ignore with the target so intermediate events don't re-escape.
        ignoreScrollTopRef.current = top;
        el.scrollTo({ top, behavior: "smooth" });
        // Snap pin state; showBack clears once we land near bottom via scroll.
        const start = performance.now();
        const tick = () => {
          if (!viewportRef.current) return;
          const near = isNearBottom(
            viewportRef.current.scrollTop,
            viewportRef.current.scrollHeight,
            viewportRef.current.clientHeight,
            thresholdRef.current,
          );
          if (near || performance.now() - start > 600) {
            applyScrollTop(
              bottomScrollTop(
                viewportRef.current.scrollHeight,
                viewportRef.current.clientHeight,
              ),
            );
            isPinnedRef.current = true;
            escapedRef.current = false;
            syncShowBack();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        applyScrollTop(top);
      }
      syncShowBack();
    },
    [applyScrollTop, syncShowBack],
  );

  const followIfPinned = useCallback(() => {
    if (!isPinnedRef.current || !enabledRef.current) return;
    const el = viewportRef.current;
    if (!el) return;
    applyScrollTop(bottomScrollTop(el.scrollHeight, el.clientHeight));
  }, [applyScrollTop]);

  // React onScroll is a no-op passthrough — real logic is on native listeners
  // so we never miss passive wheel/scroll during streaming.
  const onScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    /* native handler owns pin state */
  }, []);

  // Wheel / touch / scroll / resize — native, passive.
  useEffect(() => {
    if (!enabled) return;
    const el = viewportRef.current;
    if (!el) return;

    const handleScroll = () => {
      const scrollTop = el.scrollTop;
      let lastScrollTop = lastScrollTopRef.current;
      const ignore = ignoreScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      ignoreScrollTopRef.current = undefined;

      // Programmatic follow can interleave with a user scroll-up in one event.
      if (ignore != null && ignore > scrollTop) {
        lastScrollTop = ignore;
      }

      const maxTop = bottomScrollTop(el.scrollHeight, el.clientHeight);
      const meaningfulUp = isMeaningfulScrollUp(scrollTop, lastScrollTop);
      const meaningfulDown =
        scrollTop - lastScrollTop >= STICK_ESCAPE_MIN_DELTA_PX;

      // While locked at bottom: only snap rubber-band past max. Do not
      // write an upward leave back to the bottom — that fights the
      // trackpad and is the #703 jitter.
      if (isPinnedRef.current && !escapedRef.current && !meaningfulUp) {
        if (shouldClampPinnedOverscroll(scrollTop, maxTop)) {
          applyScrollTop(maxTop);
        }
        return;
      }

      // Clear intentional leave — escape immediately so stream growth cannot
      // yank the reader back during the same gesture. A scroll-up that ends
      // parked on the absolute bottom is a browser clamp (content shrank
      // above / viewport grew → scrollTop forced to the new max), not an
      // intentional leave — escaping there stops mid-stream following.
      if (
        shouldReleaseStickOnScrollUp({
          pinned: isPinnedRef.current,
          scrollTop,
          previousScrollTop: lastScrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        })
      ) {
        userIntentDownRef.current = false;
        isPinnedRef.current = false;
        escapedRef.current = true;
        syncShowBack();
        return;
      }

      if (meaningfulUp) userIntentDownRef.current = false;
      if (meaningfulDown) userIntentDownRef.current = true;

      // ResizeObserver scroll races: suppress ambiguous resize-only events.
      // Never drop a clear scroll-down / intent-down hard-bottom landing —
      // those are how the user re-engages stick after reading history.
      // @see https://github.com/WICG/resize-observer/issues/25
      window.setTimeout(() => {
        if (ignore != null && scrollTop === ignore) return;

        // Still locked (e.g. no escape this frame)? Snap rubber-band only.
        if (isPinnedRef.current && !escapedRef.current) {
          const top = bottomScrollTop(el.scrollHeight, el.clientHeight);
          if (shouldClampPinnedOverscroll(el.scrollTop, top)) {
            applyScrollTop(top);
          }
          syncShowBack();
          return;
        }

        const near = isNearBottom(
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
          thresholdRef.current,
        );
        const hard = isHardBottom(
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
        );
        const intentDown = userIntentDownRef.current;
        const scrollingUp = meaningfulUp;
        const scrollingDown = meaningfulDown;

        if (
          resizeDifferenceRef.current !== 0 &&
          !scrollingDown &&
          !(hard && intentDown)
        ) {
          return;
        }

        const next = nextStickPinState(
          {
            pinned: isPinnedRef.current,
            escaped: escapedRef.current,
          },
          {
            scrollingUp,
            scrollingDown,
            nearBottom: near,
            hardBottom: hard && !scrollingUp,
            userIntentDown: intentDown && !scrollingUp,
          },
        );
        isPinnedRef.current = next.pinned;
        escapedRef.current = next.escaped;
        if (next.pinned) {
          userIntentDownRef.current = false;
          applyScrollTop(
            bottomScrollTop(el.scrollHeight, el.clientHeight),
          );
        }
        syncShowBack();
      }, 1);
    };

    const handleWheel = (e: WheelEvent) => {
      // Small ticks at the locked bottom (trackpad / elastic) — stay pinned.
      if (
        isPinnedRef.current &&
        !escapedRef.current &&
        Math.abs(e.deltaY) < STICK_ESCAPE_WHEEL_DELTA
      ) {
        return;
      }
      // deltaY < 0 → user reading history. Escape only on a clear gesture
      // so concurrent content-growth follow cannot yank the viewport back.
      if (
        e.deltaY <= -STICK_ESCAPE_WHEEL_DELTA &&
        el.scrollHeight > el.clientHeight
      ) {
        userIntentDownRef.current = false;
        if (isPinnedRef.current) {
          escapedRef.current = true;
          isPinnedRef.current = false;
          syncShowBack();
        }
        return;
      }
      // deltaY > 0 → scrolling toward latest. Mark intent so a no-delta
      // hard-bottom landing (max scrollTop) still re-pins.
      if (e.deltaY >= STICK_ESCAPE_WHEEL_DELTA) {
        userIntentDownRef.current = true;
        if (escapedRef.current) {
          requestAnimationFrame(() => {
            if (!viewportRef.current) return;
            const v = viewportRef.current;
            // Hard bottom only — the 100px near band yanks back after a
            // trackpad escape and is the bottom-of-chat jitter.
            if (
              isHardBottom(v.scrollTop, v.scrollHeight, v.clientHeight)
            ) {
              escapedRef.current = false;
              isPinnedRef.current = true;
              userIntentDownRef.current = false;
              applyScrollTop(
                bottomScrollTop(v.scrollHeight, v.clientHeight),
              );
              syncShowBack();
            }
          });
        }
      }
    };

    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (touchY == null || y == null) return;
      const dy = y - touchY;
      // Finger moves down → content moves up (reading history).
      // Require a clear drag so a light touch at the locked bottom does not
      // unstick and then snap back (bounce + flash).
      if (dy > STICK_ESCAPE_MIN_DELTA_PX) {
        userIntentDownRef.current = false;
        if (isPinnedRef.current) {
          escapedRef.current = true;
          isPinnedRef.current = false;
          syncShowBack();
        }
      } else if (dy < -STICK_ESCAPE_MIN_DELTA_PX) {
        // Finger moves up → content moves down (toward latest)
        userIntentDownRef.current = true;
      }
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
      // After a fling toward latest, re-pin only if we settled on the end.
      if (userIntentDownRef.current && escapedRef.current) {
        requestAnimationFrame(() => {
          if (!viewportRef.current) return;
          const v = viewportRef.current;
          if (isHardBottom(v.scrollTop, v.scrollHeight, v.clientHeight)) {
            escapedRef.current = false;
            isPinnedRef.current = true;
            userIntentDownRef.current = false;
            syncShowBack();
          }
        });
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    lastScrollTopRef.current = el.scrollTop;

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, conversationKey, syncShowBack, applyScrollTop]);

  // Conversation switch → re-pin and jump to bottom.
  useEffect(() => {
    if (!enabled) return;
    escapedRef.current = false;
    isPinnedRef.current = true;
    userIntentDownRef.current = false;
    const id = requestAnimationFrame(() => scrollToBottom("instant"));
    return () => cancelAnimationFrame(id);
  }, [conversationKey, enabled, scrollToBottom]);

  // User sent / turn became busy → force follow even if they had scrolled up.
  // Layout first so the virtual list's itemCount effect sees pin=true in the
  // same frame (avoids a browse-window flash, then a snap). One rAF covers
  // the new bubble height that is not measured until after paint.
  useLayoutEffect(() => {
    if (!enabled || forceStickKey == null || forceStickKey === "") return;
    escapedRef.current = false;
    isPinnedRef.current = true;
    userIntentDownRef.current = false;
    scrollToBottom("instant");
    const raf = requestAnimationFrame(() => scrollToBottom("instant"));
    return () => cancelAnimationFrame(raf);
  }, [forceStickKey, enabled, scrollToBottom]);

  // Content growth / shrink while pinned.
  useEffect(() => {
    if (!enabled) return;
    const el = viewportRef.current;
    if (!el) return;

    let previousHeight: number | undefined;
    let raf = 0;
    let mediaFollowTimer: ReturnType<typeof setTimeout> | null = null;

    const onHeightChange = (height: number) => {
      const difference = height - (previousHeight ?? height);
      // Thought-stream / font / 1–3px reflow: skip full follow machinery so
      // micro reflows do not bounce — BUT still clamp if many small stream
      // deltas stacked and left us off hard bottom while pinned (smooth
      // thinking/body reveal is usually 2–7px per frame).
      if (previousHeight != null && isHeightDeltaNoise(difference)) {
        previousHeight = height;
        if (
          shouldClampPinnedStreamDrift(
            isPinnedRef.current,
            escapedRef.current,
            el.scrollTop,
            el.scrollHeight,
            el.clientHeight,
          )
        ) {
          applyScrollTop(bottomScrollTop(el.scrollHeight, el.clientHeight));
        }
        return;
      }
      resizeDifferenceRef.current = difference;

      // Browser can leave scrollTop past max after a shrink — clamp without
      // treating it as a user scroll (would thrash pin / jump to top).
      const maxTop = bottomScrollTop(el.scrollHeight, el.clientHeight);
      if (el.scrollTop > maxTop + 1) {
        applyScrollTop(maxTop);
      }

      if (
        difference < 0 &&
        !escapedRef.current &&
        isNearBottom(
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
          thresholdRef.current,
        )
      ) {
        // Shrink while still following (markdown reflow): stay pinned so the
        // next grow does not leave a gap. Never re-engage if user escaped.
        isPinnedRef.current = true;
      }

      // Defense: pin can be dropped without an intentional escape after a
      // browser clamp / virtual remeasure race (escaped stays false). If the
      // user is still parked on the absolute bottom, re-engage follow so the
      // rest of the stream keeps sticking. Intentional escape blocks this
      // (reading history is never yanked back down).
      if (
        !isPinnedRef.current &&
        !escapedRef.current &&
        isHardBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
      ) {
        isPinnedRef.current = true;
      }

      // Grow, shrink, or viewport-only resize: follow only while pinned.
      // Do NOT compensate scrollTop while escaped — stream growth is almost
      // always at the bottom; adding the full height delta would yank the
      // user down. Large jumps (image/PDF decode) wait so a storm of
      // screenshots is one snap, not one per file.
      const delay = pinnedFollowDelayMs(difference);
      if (delay <= 0) {
        if (mediaFollowTimer != null) {
          clearTimeout(mediaFollowTimer);
          mediaFollowTimer = null;
        }
        followIfPinned();
      } else {
        if (mediaFollowTimer != null) clearTimeout(mediaFollowTimer);
        mediaFollowTimer = setTimeout(() => {
          mediaFollowTimer = null;
          followIfPinned();
        }, delay);
      }

      previousHeight = height;
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (resizeDifferenceRef.current === difference) {
            resizeDifferenceRef.current = 0;
          }
        }, 1);
      });
    };

    const measureContentHeight = () => {
      const content = contentRef.current ?? el.firstElementChild;
      if (content instanceof HTMLElement) return content.offsetHeight;
      return el.scrollHeight;
    };

    const scheduleMeasure = () => {
      if (runAfterPaneSplitMotion(scheduleMeasure)) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        onHeightChange(measureContentHeight());
      });
    };

    const ro = new ResizeObserver(() => {
      // Coalesce multi-node notifications to one frame. Always read the
      // content column height from the DOM — viewport RO entries report
      // client box size, which is not what we want for grow/shrink.
      scheduleMeasure();
    });

    const content = contentRef.current ?? el.firstElementChild;
    if (content) ro.observe(content);
    // Viewport size changes (window / stage chrome) also need a re-follow.
    ro.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (mediaFollowTimer != null) clearTimeout(mediaFollowTimer);
      ro.disconnect();
    };
  }, [enabled, conversationKey, applyScrollTop, followIfPinned]);

  return {
    viewportRef,
    contentRef,
    onScroll,
    scrollToBottom,
    isPinnedRef,
    showBack,
  };
}
