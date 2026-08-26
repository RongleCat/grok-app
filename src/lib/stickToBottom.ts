/**
 * Chat scroll "stick to bottom" helpers.
 *
 * While the user is following, new content keeps the viewport pinned.
 * After an intentional scroll-up (`escaped`), we do NOT re-pin merely
 * because the viewport is still within the near-bottom threshold — that
 * thrash is what makes the chat bounce while the user is reading.
 * Re-pin when they scroll down again and land on the absolute bottom,
 * send a message, or switch conversation.
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
 * run the full follow machinery (avoids up-down flicker while thinking grows).
 * Slightly higher than 1–2px so virtual-list spacer remeasure does not thrash.
 *
 * Callers must still clamp when pinned and scrollTop has drifted off hard
 * bottom — smooth stream often grows 2–7px per frame, and stacking pure
 * "noise" skips leaves the viewport stranded above the latest tokens.
 * See {@link shouldClampPinnedStreamDrift}.
 */
export const STICK_HEIGHT_NOISE_PX = 8;

/**
 * Content growth this large is media / virtual-window rebuild, not a stream
 * token. Follow immediately and every image decode snaps the transcript up.
 */
export const STICK_MEDIA_HEIGHT_PX = 24;

/** Trailing delay so a decode storm becomes one pin snap. */
export const STICK_MEDIA_FOLLOW_DELAY_MS = 64;

/**
 * Minimum upward scroll (px) to leave stick-lock.
 * Keep this aligned with {@link STICK_ESCAPE_WHEEL_DELTA}: a 10–12px
 * trackpad nudge used to be clamped by the scroll handler and then
 * unpinned by wheel, which is the #703 jitter.
 */
export const STICK_ESCAPE_MIN_DELTA_PX = 10;

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

/**
 * While pinned, only rubber-band / overscroll *past* max should snap back.
 * An upward scroll that stays at or below maxTop is the user leaving the
 * bottom — fighting it with applyScrollTop is the #703 jitter.
 */
export function shouldClampPinnedOverscroll(
  scrollTop: number,
  maxTop: number,
): boolean {
  return scrollTop > maxTop + 0.5;
}

/**
 * `stickBump` on streaming/permission edge: only when this is the *same*
 * user turn (regenerate / approval). A new last user id already force-sticks.
 */
export function shouldBumpStickOnBusyEdge(
  lastUserId: string | null,
  prevLastUserId: string | null,
): boolean {
  return lastUserId === prevLastUserId;
}

/**
 * `forceStickKey` is last-user-id + bump. Journal hydrate rewrites the
 * optimistic `u-${ts}` to a uuid without adding a user — treating that as a
 * new key instant-scrolls at settle.
 *
 * Not #714 / #703 (pin yank / double stick on send). This only freezes the
 * id when the user *count* is unchanged. New send / rewind / conversation
 * switch still take `nextId`.
 */
export function stabilizeStickUserId(input: {
  prevId: string | null;
  nextId: string | null;
  prevUserCount: number;
  nextUserCount: number;
  conversationChanged?: boolean;
}): string | null {
  if (input.conversationChanged) return input.nextId;
  if (input.nextUserCount !== input.prevUserCount) return input.nextId;
  if (input.prevId && input.nextId && input.prevId !== input.nextId) {
    return input.prevId;
  }
  return input.nextId;
}

/**
 * Escape pin when the viewport has moved far enough off the absolute
 * bottom, even if no single wheel/scroll event was large.
 *
 * Pixel-mode trackpads send many 2–8px ticks. Escape used to require ≥10px
 * in *one* event (`isMeaningfulScrollUp`), so those ticks never released
 * the pin. The list kept using the "stuck at bottom" window and the screen
 * did not walk into history until a harder flick.
 */
export function shouldReleaseStickOnDistanceFromBottom(input: {
  pinned: boolean;
  escaped?: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  minDeltaPx?: number;
}): boolean {
  if (!input.pinned || input.escaped) return false;
  const min = input.minDeltaPx ?? STICK_ESCAPE_MIN_DELTA_PX;
  return (
    distanceFromBottom(
      input.scrollTop,
      input.scrollHeight,
      input.clientHeight,
    ) >= min
  );
}

/**
 * Virtual-list layout may snap to max while stick is still pinned. Do that
 * only if the user is still on the bottom. If they already scrolled away,
 * snapping is the "wheel turns, screen does not move" freeze.
 */
export function shouldSnapPinnedLayoutToBottom(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  minLeavePx?: number;
}): boolean {
  const min = input.minLeavePx ?? STICK_ESCAPE_MIN_DELTA_PX;
  return (
    distanceFromBottom(
      input.scrollTop,
      input.scrollHeight,
      input.clientHeight,
    ) < min
  );
}

/**
 * Whether an upward scroll should release stick-to-bottom.
 *
 * Escape only when the viewport actually left the bottom **and** ended
 * strictly above the hard bottom. A "scroll-up" that parks on the absolute
 * bottom is a browser clamp, not an intentional leave: content above the
 * viewport shrank (tool phase auto-collapse, virtual row remeasure,
 * markdown reflow) or the viewport grew (composer / panel resize), so the
 * browser forced scrollTop down to the new max. Escaping there drops pin
 * for the rest of the turn — the answer keeps growing below the fold and the
 * viewport never follows again ("streaming does not stick to bottom").
 *
 * A real user scroll-up always ends strictly above the hard bottom, so it
 * still escapes normally.
 */
export function shouldReleaseStickOnScrollUp(input: {
  /** True while auto-follow is engaged (stream / initial state). */
  pinned: boolean;
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  minDeltaPx?: number;
  hardPx?: number;
}): boolean {
  const {
    pinned,
    scrollTop,
    previousScrollTop,
    scrollHeight,
    clientHeight,
  } = input;
  if (!pinned) return false;
  if (!isMeaningfulScrollUp(scrollTop, previousScrollTop, input.minDeltaPx)) {
    return false;
  }
  // Browser clamp after shrink / resize lands exactly on the new max → the
  // viewport ends at the hard bottom even though it "moved up".
  if (isHardBottom(scrollTop, scrollHeight, clientHeight, input.hardPx)) {
    return false;
  }
  return true;
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

/**
 * Delay before stick-follow after a content-height change.
 * Stream tokens (small) follow this frame. Image/PDF decode jumps wait so
 * a row of screenshots does not bounce the chat once per file.
 */
export function pinnedFollowDelayMs(
  heightDelta: number,
  mediaPx: number = STICK_MEDIA_HEIGHT_PX,
  delayMs: number = STICK_MEDIA_FOLLOW_DELAY_MS,
): number {
  if (!Number.isFinite(heightDelta)) return 0;
  if (Math.abs(heightDelta) < mediaPx) return 0;
  return delayMs;
}

/**
 * Aside / env-gutter width interpolation reflows the column every frame.
 * Media delay would wait until the interpolation stops, then snap — the
 * transcript jumps up, then back to the bottom. Follow immediately.
 */
export function pinnedFollowDelayForLayout(input: {
  heightDelta: number;
  viewportWidthChanged: boolean;
}): number {
  if (input.viewportWidthChanged) return 0;
  return pinnedFollowDelayMs(input.heightDelta);
}

/**
 * While stick is pinned, stream/thinking often grows a few px per frame
 * (smooth reveal). Those deltas are "noise" for bounce suppression, but
 * stacked they leave the viewport off the true bottom. Callers should still
 * clamp scrollTop when this returns true.
 *
 * Returns false when escaped (user reading history) or already hard-bottom.
 */
export function shouldClampPinnedStreamDrift(
  pinned: boolean,
  escaped: boolean,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slackPx: number = 0.5,
): boolean {
  if (!pinned || escaped) return false;
  const maxTop = bottomScrollTop(scrollHeight, clientHeight);
  return Math.abs(scrollTop - maxTop) > slackPx;
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
 *
 * While escaped, do NOT re-pin from the 100px near band. A trackpad bounce
 * or 10px down-tick after leaving the bottom sits well inside that band;
 * snapping to max scrollTop is the "jitter when I reach / leave the end"
 * bug. Re-engage only after they land on the absolute bottom again.
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
  // Stay pinned while following and still near the tail. Never use this
  // path to *clear* escape — that yank is the bottom jitter.
  if (!state.escaped && input.nearBottom) {
    return { pinned: true, escaped: false };
  }
  return state;
}
