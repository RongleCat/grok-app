/**
 * Follow the latest tokens inside a capped live-thinking scroller.
 *
 * `.grok-thought__body` / `.grok-act__thought-body` cap at ~220–240px so a
 * long CoT does not bury the answer. Outer chat stick-to-bottom only sees
 * that box. Short thoughts fit; long live thoughts grow *inside* the box
 * with no follow unless callers set scrollTop here.
 *
 * Never use Element.scrollIntoView — it walks the chat ancestor and drops
 * stick-to-bottom (#931 class of bugs).
 */

/** Leave inner follow once the user is this far off the inner bottom. */
export const THOUGHT_BODY_ESCAPE_PX = 10;

/** Landing here re-engages follow (same band as outer hard bottom). */
export const THOUGHT_BODY_HARD_BOTTOM_PX = 2;

export function thoughtBodyDistanceFromBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function thoughtBodyFollowTop(
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight);
}

export function shouldFollowThoughtBody(input: {
  live: boolean;
  expanded: boolean;
  escaped: boolean;
}): boolean {
  return input.live && input.expanded && !input.escaped;
}

/**
 * Live→done while the thought is still open: pin once more so the last
 * tokens stay in the capped box. Collapsed thoughts unmount the body.
 * A user who flicked up mid-stream is not yanked.
 */
export function shouldPinThoughtBodyOnSettle(input: {
  wasLive: boolean;
  live: boolean;
  expanded: boolean;
  escaped: boolean;
}): boolean {
  return (
    input.wasLive && !input.live && input.expanded && !input.escaped
  );
}

/**
 * Inner pin/escape. Re-pin on hard bottom. Escape at ≥10px. Keep the
 * previous flag in the 2–10px band so stream growth does not thrash.
 */
export function nextThoughtBodyEscaped(input: {
  live: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  prevEscaped: boolean;
}): boolean {
  if (!input.live) return false;
  const dist = thoughtBodyDistanceFromBottom(
    input.scrollTop,
    input.scrollHeight,
    input.clientHeight,
  );
  if (dist <= THOUGHT_BODY_HARD_BOTTOM_PX) return false;
  if (dist >= THOUGHT_BODY_ESCAPE_PX) return true;
  return input.prevEscaped;
}
