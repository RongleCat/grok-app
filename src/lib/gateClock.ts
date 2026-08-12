/**
 * Shared clocks for agent gates (tool permission, ask-user questionnaire).
 *
 * A gate's auto-deny / auto-cancel deadline belongs to the *request*, not to
 * the UI showing it. Both gates unmount whenever the user leaves the chat —
 * "new chat" clears the active request, and so does switching chats — so
 * reading the start time from the mount handed every return a fresh full
 * timeout: the countdown restarted and the deadline never arrived.
 *
 * Callers keep a `Map` (a ref in a component, a module-level map for a
 * singleton modal) and resume from it instead.
 */

/**
 * Identity of one gate's clock.
 *
 * Keyed by request rather than by chat: a follow-up request in the same chat
 * starts its own countdown, while leaving and re-entering the chat resumes the
 * one already running.
 */
export function gateClockKey(
  sessionId: string,
  rpcId: number | string,
): string {
  return `${sessionId}:${rpcId}`;
}

/** Start a request's clock, or resume the one it already has. */
export function resumeGateClock(
  clocks: Map<string, number>,
  key: string,
  nowMs: number = Date.now(),
): number {
  const started = clocks.get(key);
  if (started != null && Number.isFinite(started)) return started;
  clocks.set(key, nowMs);
  return nowMs;
}

/** Drop a chat's clocks once its request is answered / cancelled / expired. */
export function dropGateClocks(
  clocks: Map<string, number>,
  sessionId: string,
): void {
  const prefix = `${sessionId}:`;
  for (const key of [...clocks.keys()]) {
    if (key.startsWith(prefix)) clocks.delete(key);
  }
}

/** Drop a single request's clock (answered, or its modal closed for good). */
export function dropGateClock(clocks: Map<string, number>, key: string): void {
  clocks.delete(key);
}
