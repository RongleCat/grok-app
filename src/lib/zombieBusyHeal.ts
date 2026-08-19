/**
 * Unlock a finished turn whose UI never left busy.
 *
 * After the last assistant body is painted and Host is idle (or Host itself
 * went stale), the workbench can still sit on streaming + 思考中 + Stop, and a
 * leftover ensureConnected claim paints 连接中 so the next send never leaves.
 * Ghost heal only strips *empty* optimistic shells — this path keeps the reply.
 */

import type { SessionState } from "./session";
import { hostLooksIdleForSession } from "./ghostStreamingHeal";

/** Host already idle: wait a beat so a real ready event can land first. */
export const ZOMBIE_BUSY_GRACE_MS = 8_000;

/**
 * Host still says streaming/connecting but the transcript is done.
 * Matches the connect wall-clock so a late think→tool loop is not cut off.
 */
export const ZOMBIE_BUSY_HOST_STALE_MS = 90_000;

export type ZombieBusyMessage = {
  role: string;
  content?: string;
  streaming?: boolean;
  marker?: string | null;
};

export type ZombieBusyEvidence = {
  uiSessionState: SessionState;
  uiConnecting?: boolean;
  messages: readonly ZombieBusyMessage[];
  turnStartedAt: number | null;
  nowMs: number;
  hostStateForSession: SessionState | null | undefined;
  sendInFlight?: boolean;
  /** In-flight ensureConnected count; 0 means a leftover 连接中 claim leaked. */
  connectInFlightCount?: number;
  graceMs?: number;
  hostStaleMs?: number;
};

export function transcriptLooksTurnComplete(
  messages: readonly ZombieBusyMessage[],
): boolean {
  if (messages.some((m) => m.streaming)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return false;
    if (m.marker === "turn_end" || m.marker === "turn_cancelled") return true;
    if (m.role === "assistant" && (m.content ?? "").trim()) return true;
  }
  return false;
}

function uiLooksBusy(e: ZombieBusyEvidence): boolean {
  return (
    e.uiSessionState === "streaming" ||
    e.uiSessionState === "awaiting_permission" ||
    e.uiConnecting === true
  );
}

/** Leftover 连接中 with no handshake actually running. */
export function shouldReleaseStaleConnectingClaim(e: ZombieBusyEvidence): boolean {
  if (!e.uiConnecting) return false;
  if (e.sendInFlight) return false;
  if ((e.connectInFlightCount ?? 0) > 0) return false;
  return true;
}

export function shouldHealZombieBusy(e: ZombieBusyEvidence): boolean {
  if (e.sendInFlight) return false;
  if (!uiLooksBusy(e)) return false;
  if (!transcriptLooksTurnComplete(e.messages)) return false;

  const hostIdle = hostLooksIdleForSession(e.hostStateForSession);
  const started = e.turnStartedAt;
  const elapsed = started != null ? e.nowMs - started : Number.POSITIVE_INFINITY;

  if (hostIdle) {
    const grace = e.graceMs ?? ZOMBIE_BUSY_GRACE_MS;
    return started == null || elapsed >= grace;
  }

  const stale = e.hostStaleMs ?? ZOMBIE_BUSY_HOST_STALE_MS;
  return started != null && elapsed >= stale;
}
