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
  type RefObject,
  type UIEvent,
} from "react";
import {
  STICK_ESCAPE_MIN_DELTA_PX,
  STICK_ESCAPE_WHEEL_DELTA,
  STICK_OPEN_FOLLOW_MS,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  isConversationOpenFollowActive,
  isHardBottom,
  isHeightDeltaNoise,
  isNearBottom,
  nextStickPinState,
  pinnedFollowDelayForLayout,
  shouldClampPinnedOverscroll,
  shouldClampPinnedStreamDrift,
  shouldEscapePinnedScroll,
  takeProgrammaticStickScroll,
} from "@/lib/stickToBottom";


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
  /** Fine-grained subscription for BackBottom button to avoid parent component re-renders. */
  subscribeShowBack: (cb: (val: boolean) => void) => () => void;
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
  /**
   * Keep following journal hydrate / image decode after a chat switch.
   * Wheel escape still wins (see isConversationOpenFollowActive).
   */
  const openFollowUntilRef = useRef(0);
  const conversationKeyRef = useRef(conversationKey);
  if (conversationKeyRef.current !== conversationKey) {
    conversationKeyRef.current = conversationKey;
    escapedRef.current = false;
    isPinnedRef.current = true;
    userIntentDownRef.current = false;
    lastScrollTopRef.current = 0;
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    openFollowUntilRef.current = now + STICK_OPEN_FOLLOW_MS;
  }
  const showBackRef = useRef(false);
  const showBackListenersRef = useRef<Set<(val: boolean) => void>>(new Set());
  const scrollDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subscribeShowBack = useCallback((cb: (val: boolean) => void) => {
    showBackListenersRef.current.add(cb);
    cb(showBackRef.current);
    return () => {
      showBackListenersRef.current.delete(cb);
    };
  }, []);

  const syncShowBack = useCallback(() => {
    const el = viewportRef.current;
    let next = false;
    if (el) {
      const overflow = el.scrollHeight > el.clientHeight + 40;
      next = !isPinnedRef.current && overflow;
    }
    if (next !== showBackRef.current) {
      showBackRef.current = next;
      for (const listener of showBackListenersRef.current) {
        listener(next);
      }
    }
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
      const ignore =
        ignoreScrollTopRef.current ?? takeProgrammaticStickScroll(el);
      lastScrollTopRef.current = scrollTop;
      ignoreScrollTopRef.current = undefined;

      // Programmatic follow can interleave with a user scroll-up in one event.
      if (ignore != null && ignore > scrollTop) {
        lastScrollTop = ignore;
      }

      const maxTop = bottomScrollTop(el.scrollHeight, el.clientHeight);
      // Default 10px event + slow-trackpad accumulation from the locked
      // bottom. Never use a sub-pixel minDelta: thinking / tool collapse and
      // the next body round routinely move 2–8px off hard bottom, and that
      // used to drop pin so the rest of the stream grew below the fold.
      const shouldEscapeStick = shouldEscapePinnedScroll({
        pinned: isPinnedRef.current,
        escaped: escapedRef.current,
        scrollTop,
        previousScrollTop: lastScrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
      const isMovingUp = scrollTop < lastScrollTop - 0.5;
      const meaningfulDown =
        scrollTop - lastScrollTop >= STICK_ESCAPE_MIN_DELTA_PX;

      // Instant escape on intentional user upward gesture (not browser-clamp).
      // Never write back to scrollTop on upward leave.
      if (shouldEscapeStick) {
        userIntentDownRef.current = false;
        isPinnedRef.current = false;
        escapedRef.current = true;
        syncShowBack();
        return;
      }

      // While locked at bottom: only clamp positive overscroll past max.
      if (isPinnedRef.current && !escapedRef.current) {
        if (shouldClampPinnedOverscroll(scrollTop, maxTop)) {
          applyScrollTop(maxTop);
          return;
        }
        return;
      }

      if (isMovingUp) userIntentDownRef.current = false;
      if (meaningfulDown) userIntentDownRef.current = true;

      // ResizeObserver scroll races: suppress ambiguous resize-only events.
      // Never drop a clear scroll-down / intent-down hard-bottom landing —
      // those are how the user re-engages stick after reading history.
      // @see https://github.com/WICG/resize-observer/issues/25
      if (scrollDebounceTimerRef.current != null) {
        clearTimeout(scrollDebounceTimerRef.current);
      }
      scrollDebounceTimerRef.current = setTimeout(() => {
        scrollDebounceTimerRef.current = null;
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
        const scrollingUp = isMovingUp;
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
      }, 16);
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
      if (scrollDebounceTimerRef.current != null) {
        clearTimeout(scrollDebounceTimerRef.current);
        scrollDebounceTimerRef.current = null;
      }
    };
  }, [enabled, conversationKey, syncShowBack, applyScrollTop]);

  // Conversation switch → re-pin and jump to bottom before paint so the
  // virtual list's layout effect sees pin=true (otherwise it windows from
  // leftover scrollTop / the previous chat's browse range). Extra frames +
  // a short follow window cover journal hydrate and image/PDF decode.
  useLayoutEffect(() => {
    if (!enabled) return;
    escapedRef.current = false;
    isPinnedRef.current = true;
    userIntentDownRef.current = false;
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    openFollowUntilRef.current = now + STICK_OPEN_FOLLOW_MS;
    scrollToBottom("instant");
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      scrollToBottom("instant");
      raf2 = requestAnimationFrame(() => {
        if (!cancelled && !escapedRef.current) scrollToBottom("instant");
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
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
    let previousViewportWidth: number | undefined = el.clientWidth;
    let viewportWidthChanged = false;
    let raf = 0;
    let mediaFollowTimer: ReturnType<typeof setTimeout> | null = null;

    const onHeightChange = (height: number) => {
      const widthMoved = viewportWidthChanged;
      viewportWidthChanged = false;
      const difference = height - (previousHeight ?? height);
      // Thought-stream / font / 1–3px reflow: skip full follow machinery so
      // micro reflows do not bounce — BUT still clamp if many small stream
      // deltas stacked and left us off hard bottom while pinned (smooth
      // thinking/body reveal is usually 2–7px per frame).
      if (
        previousHeight != null &&
        isHeightDeltaNoise(difference) &&
        !widthMoved
      ) {
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
      // screenshots is one snap, not one per file. Width interpolation
      // (aside / env gutter) must follow this frame or the column jumps
      // up until the motion ends, then snaps back.
      // Opening a chat: image cards / journal rows often land after the
      // first pin. Follow immediately only while still pinned — never
      // re-engage if the user already scrolled into history.
      const opening = isConversationOpenFollowActive({
        now:
          typeof performance !== "undefined" &&
          typeof performance.now === "function"
            ? performance.now()
            : Date.now(),
        until: openFollowUntilRef.current,
        escaped: escapedRef.current,
      });
      const delay = pinnedFollowDelayForLayout({
        heightDelta: difference,
        viewportWidthChanged: widthMoved,
        conversationOpening: opening && isPinnedRef.current,
      });
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
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        onHeightChange(measureContentHeight());
      });
    };

    const ro = new ResizeObserver((entries) => {
      // Coalesce multi-node notifications to one frame. Always read the
      // content column height from the DOM — viewport RO entries report
      // client box size, which is not what we want for grow/shrink.
      for (const entry of entries) {
        if (entry.target !== el) continue;
        const w = entry.contentRect.width;
        if (
          previousViewportWidth != null &&
          Math.abs(w - previousViewportWidth) >= 0.5
        ) {
          viewportWidthChanged = true;
        }
        previousViewportWidth = w;
      }
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
    showBack: showBackRef.current,
    subscribeShowBack,
  };
}
