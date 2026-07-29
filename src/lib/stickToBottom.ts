/**
 * Chat scroll "stick to bottom" helpers.
 *
 * While the user is following, new content keeps the viewport pinned.
 * After an intentional scroll-up (`escaped`), we do NOT re-pin merely
 * because the viewport is still within the near-bottom threshold — that
 * thrash is what makes the chat bounce while the user is reading.
 * Re-pin when they scroll down again and land near the bottom, land on
 * the absolute bottom, send a message, or switch conversation.
 */

/** Distance from bottom (px) still treated as "near" for re-engage. */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 100;

/**
 * Absolute bottom band (px). Landing here always re-engages follow —
 * covers the common "I scrolled to the end but pin didn't come back" case
 * when the last scroll event has no positive delta (already maxed).
 */
export const STICK_HARD_BOTTOM_PX = 2;

/**
 * Sub-pixel / font / thought-stream reflows under this delta should not
 * force a scroll follow (avoids up-down flicker while thinking grows).
 * Slightly higher than 1–2px so virtual-list spacer remeasure does not thrash.
 */
export const STICK_HEIGHT_NOISE_PX = 8;

/**
 * Minimum upward scroll (px) to leave stick-lock.
 * Trackpad jitter, elastic overscroll, and 1–2px virtual height corrections
 * used to "unlock" the bottom then yank back — felt like bounce + flash.
 */
export const STICK_ESCAPE_MIN_DELTA_PX = 14;

/**
 * Wheel deltaY (negative = read history) must exceed this to escape pin.
 * Tiny trackpad ticks at the bottom otherwise unstick then re-snap.
 */
export const STICK_ESCAPE_WHEEL_DELTA = 10;

/** True when the upward scroll is large enough to intentionally leave the bottom. */
export function isMeaningfulScrollUp(
  scrollTop: number,
  previousScrollTop: number,
  minDeltaPx: number = STICK_ESCAPE_MIN_DELTA_PX,
): boolean {
  return previousScrollTop - scrollTop >= minDeltaPx;
}

export function distanceFromBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

/** True when viewport is close enough to the bottom to re-engage follow. */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  // No overflow → always "at bottom"
  if (scrollHeight <= clientHeight + 1) return true;
  return distanceFromBottom(scrollTop, scrollHeight, clientHeight) <= thresholdPx;
}

/** True when the viewport is parked on the absolute bottom. */
export function isHardBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  hardPx: number = STICK_HARD_BOTTOM_PX,
): boolean {
  if (scrollHeight <= clientHeight + 1) return true;
  return distanceFromBottom(scrollTop, scrollHeight, clientHeight) <= hardPx;
}

/** Target scrollTop that parks the viewport at the bottom. */
export function bottomScrollTop(
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/** True when a content-height delta is noise and should not re-follow. */
export function isHeightDeltaNoise(
  difference: number,
  noisePx: number = STICK_HEIGHT_NOISE_PX,
): boolean {
  return Math.abs(difference) < noisePx;
}

/** Pin + escape lock used by the chat scroll hook. */
export type StickPinState = {
  /** Auto-follow content growth. */
  pinned: boolean;
  /** User intentionally left the bottom; blocks threshold re-pin. */
  escaped: boolean;
};

/**
 * Pure transition for scroll-driven pin updates.
 * Direction is from user scroll (not programmatic follows).
 *
 * `userIntentDown`: last user gesture was toward the latest content
 * (wheel/touch/scrollbar down). Combined with hardBottom this re-engages
 * even when the final scroll event has no positive delta at max scrollTop.
 * It does NOT re-engage after a scroll-up that left the user still inside
 * the near-bottom band (that thrash is the bounce bug).
 */
export function nextStickPinState(
  state: StickPinState,
  input: {
    scrollingUp: boolean;
    scrollingDown: boolean;
    nearBottom: boolean;
    /** Parked on absolute bottom. */
    hardBottom?: boolean;
    /** Last user gesture was toward bottom (wheel/touch/scroll down). */
    userIntentDown?: boolean;
  },
): StickPinState {
  // Scroll-up always wins first: even a 1px pull away from the bottom
  // must escape so stream growth cannot yank the reader back down.
  if (input.scrollingUp) {
    return { pinned: false, escaped: true };
  }
  // Absolute bottom after an intentional move toward latest → re-engage.
  // Covers "scrolled to end but last event has no delta" without bouncing
  // users who only nudged 1px up and are still inside the hard band.
  if (input.hardBottom && (input.scrollingDown || input.userIntentDown)) {
    return { pinned: true, escaped: false };
  }
  let { pinned, escaped } = state;
  // Only clear escape when the user has actually reached the bottom band.
  // Clearing escape on any scroll-down while mid-list was safe when
  // scrollHeight matched real content — with virtualized/estimated heights
  // a short totalHeight made mid-document look "near bottom", then the next
  // frame re-pinned and yanked the viewport (bounce at tall messages).
  if (input.scrollingDown && input.nearBottom) {
    escaped = false;
    pinned = true;
  } else if (!escaped && input.nearBottom) {
    pinned = true;
  }
  return { pinned, escaped };
}
