/**
 * Live “思考中 / Thinking for” wall-clock.
 *
 * The workbench turn clock can briefly (or leftover) be an older session’s
 * start. Thinking.tsx used to only pull the anchor *earlier*, so a stale
 * 50-minute clock stuck, and a later correction (this turn’s real start)
 * was ignored. After remount the same block showed the honest duration.
 */

export function parseCreatedAtMs(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Next live-timer origin.
 *
 * - Trust `startedAt` whenever it is a finite number (earlier *or* later).
 * - If `startedAt` is missing, keep the previous origin so a remount flicker
 *   does not reset to “1s”.
 * - First paint with no clock: `nowMs`.
 */
export function nextThinkingStartAnchor(opts: {
  prevAnchor: number | null;
  startedAt: number | null | undefined;
  nowMs: number;
}): number {
  const incoming =
    typeof opts.startedAt === "number" && Number.isFinite(opts.startedAt)
      ? opts.startedAt
      : null;
  if (incoming != null) return incoming;
  if (opts.prevAnchor != null) return opts.prevAnchor;
  return opts.nowMs;
}

/**
 * Do not start the live timer before this assistant bubble existed.
 * A leftover previous-session `turnStartedAt` is older than `createdAt`
 * and would show “思考中 51分…”.
 */
export function clampThinkingStartToMessage(opts: {
  turnStartedAt: number | null | undefined;
  messageCreatedAtMs: number | null | undefined;
}): number | null {
  const turn =
    typeof opts.turnStartedAt === "number" &&
    Number.isFinite(opts.turnStartedAt)
      ? opts.turnStartedAt
      : null;
  const created =
    typeof opts.messageCreatedAtMs === "number" &&
    Number.isFinite(opts.messageCreatedAtMs)
      ? opts.messageCreatedAtMs
      : null;
  if (turn == null) return created;
  if (created == null) return turn;
  return Math.max(turn, created);
}
