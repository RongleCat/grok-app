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
 * After switching chats, keep following growth (journal hydrate, image/PDF
 * decode) even if leftover scrollTop looks far from the new tail.
 * Wheel/touch escape still wins immediately.
 */
export const STICK_OPEN_FOLLOW_MS = 800;

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

/**
 * Keep a recent gesture toward the tail alive across compositor rubber-band.
 * WebView2 may report the rebound as a decreasing `scrollTop` even though the
 * user never reversed direction.
 */
export const STICK_BOTTOM_REBOUND_INTENT_MS = 320;

/** Quiet window after the last rebound scroll event before snapping to max. */
export const STICK_BOTTOM_REBOUND_SETTLE_MS = 96;

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
 * A downward wheel/touch gesture can overshoot the tail and rebound upward.
 * That decreasing `scrollTop` is not a request to read history. Recover only
 * inside the near-bottom band and only while the downward intent is current;
 * a real reverse wheel/touch gesture clears that intent before scroll events.
 */
export function shouldSettleBottomRebound(input: {
  downIntentActive: boolean;
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  thresholdPx?: number;
}): boolean {
  if (!input.downIntentActive) return false;
  if (input.previousScrollTop - input.scrollTop < 0.5) return false;
  return isNearBottom(
    input.scrollTop,
    input.scrollHeight,
    input.clientHeight,
    input.thresholdPx,
  );
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
 * Stick / virtual-list identity for a viewed chat.
 *
 * `sessionKey` alone fires on sidebar click while the journal is still empty,
 * so the first pin lands on the loading placeholder and never runs again
 * when rows appear. Pending → ready is the land-on-latest signal. After
 * ready, streaming growth must not change this string (browsing / live
 * follow stay with pin + ResizeObserver, not a new conversation switch).
 */
export function transcriptStickIdentity(input: {
  sessionKey?: string | null;
  hasMessages: boolean;
  journalReady: boolean;
}): string {
  const key = input.sessionKey || "chat";
  const ready = input.hasMessages || input.journalReady;
  return `${key}:${ready ? "ready" : "pending"}`;
}

/**
 * Journal open paints text first; relative media (`foo.png` in ticks) is
 * resolved in a later IPC pass and attached as cards. If stick is still
 * following, that reveal must re-pin to the new bottom. A user who already
 * left the tail is not yanked.
 */
export function shouldFollowPinnedMediaReveal(input: {
  pinned: boolean;
  prevMediaCount: number;
  nextMediaCount: number;
}): boolean {
  if (!input.pinned) return false;
  return input.nextMediaCount > input.prevMediaCount;
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

/**
 * Pixel-mode trackpad: many 2–8px ticks never hit {@link STICK_ESCAPE_MIN_DELTA_PX}
 * in one event. Release once the viewport has walked ≥ that far off the
 * bottom *from a position that was still in the leave band*.
 *
 * Must not treat stream / phase growth as a leave. Thinking collapse, a new
 * tool row, or the next body round grows the tail; scrollTop stays put and
 * distance jumps to tens/hundreds of px until follow lands. A 2–6px spacer
 * tick there is layout, not the user walking away from the locked bottom.
 */
export function shouldReleaseStickOnSlowScrollUp(input: {
  pinned: boolean;
  escaped?: boolean;
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  minDeltaPx?: number;
}): boolean {
  if (!input.pinned || input.escaped) return false;
  const min = input.minDeltaPx ?? STICK_ESCAPE_MIN_DELTA_PX;
  if (input.previousScrollTop - input.scrollTop < 0.5) return false;
  const prevDist = distanceFromBottom(
    input.previousScrollTop,
    input.scrollHeight,
    input.clientHeight,
  );
  if (prevDist >= min) return false;
  return (
    distanceFromBottom(
      input.scrollTop,
      input.scrollHeight,
      input.clientHeight,
    ) >= min
  );
}

/**
 * Scroll-event pin release used by the chat hook.
 *
 * Do **not** pass a sub-pixel `minDeltaPx` into {@link shouldReleaseStickOnScrollUp}:
 * thinking / tool auto-collapse and markdown settle routinely move 2–8px
 * without landing on the hard bottom, and that used to drop pin until the
 * next user send (stream then grows below the fold).
 */
export function shouldEscapePinnedScroll(input: {
  pinned: boolean;
  escaped?: boolean;
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  if (
    shouldReleaseStickOnScrollUp({
      pinned: input.pinned,
      scrollTop: input.scrollTop,
      previousScrollTop: input.previousScrollTop,
      scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight,
    })
  ) {
    return true;
  }
  return shouldReleaseStickOnSlowScrollUp(input);
}

/**
 * Virtual-list pin-snap writes `scrollTop` without going through the stick
 * hook. Remember that assignment so the next scroll event is not treated as
 * a user leave. Entries older than {@link PROGRAMMATIC_STICK_SCROLL_TTL_MS}
 * are ignored (a missed event must not swallow a later flick).
 */
export const PROGRAMMATIC_STICK_SCROLL_TTL_MS = 100;

type ProgrammaticStickScroll = { top: number; at: number };

const programmaticStickScroll = new WeakMap<Element, ProgrammaticStickScroll>();

export function markProgrammaticStickScroll(el: Element, top: number): void {
  programmaticStickScroll.set(el, { top, at: nowMs() });
}

/** Consume a recent pin-snap; stale or missing → undefined. */
export function takeProgrammaticStickScroll(el: Element): number | undefined {
  const v = programmaticStickScroll.get(el);
  if (!v) return undefined;
  programmaticStickScroll.delete(el);
  if (nowMs() - v.at > PROGRAMMATIC_STICK_SCROLL_TTL_MS) return undefined;
  return v.top;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
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
  /** Session just opened — do not wait out the media coalesce window. */
  conversationOpening?: boolean;
}): number {
  if (input.viewportWidthChanged) return 0;
  if (input.conversationOpening) return 0;
  return pinnedFollowDelayMs(input.heightDelta);
}

/** True while a just-opened chat should keep snapping to the tail. */
export function isConversationOpenFollowActive(input: {
  now: number;
  until: number;
  escaped: boolean;
}): boolean {
  if (input.escaped) return false;
  return input.now < input.until;
}

/**
 * Opening a chat must land on the tail even if leftover distance from the
 * previous transcript (or the loading placeholder) looks like a user leave.
 */
export function shouldForcePinnedSnapOnOpen(input: {
  pinned: boolean;
  forceOpenSnap: boolean;
  escaped?: boolean;
}): boolean {
  return input.pinned && input.forceOpenSnap && !input.escaped;
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
