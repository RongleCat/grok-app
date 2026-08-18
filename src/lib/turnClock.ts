/**
 * Per-chat turn-clock keys.
 *
 * Draft (new-chat) sends have no session id yet. The workbench stores that
 * clock under the same sentinel as the send-queue draft key (`__draft__`) and
 * copies it onto the materialized id after `sessionCreate`.
 */

export const DRAFT_TURN_CLOCK_KEY = "__draft__";

/** Map a viewed / send-target id onto the clock map key. */
export function resolveTurnClockKey(
  sessionId: string | null | undefined,
): string {
  return sessionId ?? DRAFT_TURN_CLOCK_KEY;
}

/**
 * Whether updating `clockSessionId` should rewrite the on-screen timer.
 * Draft page (`viewingSessionId == null`) only accepts the draft key.
 */
export function shouldSyncViewedTurnClock(args: {
  clockSessionId: string;
  viewingSessionId: string | null | undefined;
}): boolean {
  return args.clockSessionId === resolveTurnClockKey(args.viewingSessionId);
}

/**
 * Move a draft-page clock onto the real session id created by first send.
 * Keeps the existing start time so ghost-heal grace is measured from send,
 * not from a leftover previous chat.
 */
export function migrateDraftTurnClock(
  clocks: Map<string, number>,
  newSessionId: string,
): boolean {
  if (!newSessionId || newSessionId === DRAFT_TURN_CLOCK_KEY) return false;
  const at = clocks.get(DRAFT_TURN_CLOCK_KEY);
  if (at == null) return false;
  if (!clocks.has(newSessionId)) clocks.set(newSessionId, at);
  clocks.delete(DRAFT_TURN_CLOCK_KEY);
  return true;
}
