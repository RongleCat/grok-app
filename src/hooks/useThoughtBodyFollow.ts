/**
 * Keep a capped live-thinking body scrolled to its latest tokens.
 * Sets scrollTop on the inner scroller only — never scrollIntoView.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  nextThoughtBodyEscaped,
  shouldFollowThoughtBody,
  shouldPinThoughtBodyOnSettle,
  thoughtBodyFollowTop,
} from "@/lib/thoughtBodyFollow";

export function useThoughtBodyFollow(input: {
  live: boolean;
  expanded: boolean;
  /** Content / step text. Kept for caller convenience — following is driven
   * by the ResizeObserver below, not by per-token effect re-runs. */
  followKey: string;
}): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const escapedRef = useRef(false);
  const liveRef = useRef(input.live);
  const expandedRef = useRef(input.expanded);
  const wasLiveRef = useRef(input.live);
  if (input.live && !liveRef.current) escapedRef.current = false;
  liveRef.current = input.live;
  expandedRef.current = input.expanded;

  const pinToTail = () => {
    const el = ref.current;
    if (!el) return;
    const top = thoughtBodyFollowTop(el.scrollHeight, el.clientHeight);
    if (Math.abs(el.scrollTop - top) > 0.5) el.scrollTop = top;
  };

  const follow = () => {
    if (
      !shouldFollowThoughtBody({
        live: liveRef.current,
        expanded: expandedRef.current,
        escaped: escapedRef.current,
      })
    ) {
      return;
    }
    pinToTail();
  };

  useLayoutEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = input.live;
    if (
      shouldPinThoughtBodyOnSettle({
        wasLive,
        live: input.live,
        expanded: input.expanded,
        escaped: escapedRef.current,
      })
    ) {
      pinToTail();
    } else {
      follow();
    }
    const el = ref.current;
    if (!el || !input.live || !input.expanded) return;
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // followKey is intentionally NOT a dep: the observer fires on content
    // growth, so re-creating it per stream token is pure churn.
  }, [input.live, input.expanded]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      escapedRef.current = nextThoughtBodyEscaped({
        live: liveRef.current,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        prevEscaped: escapedRef.current,
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [input.live, input.expanded]);

  return ref;
}
