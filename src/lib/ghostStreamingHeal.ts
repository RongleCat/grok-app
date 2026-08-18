/**
 * Ghost streaming heal — pure policy for optimistic UI busy with no Host turn.
 *
 * Send path paints user bubble + empty streaming assistant immediately, then
 * awaits ensureConnected / sessionSend. If that never reaches the agent (lock
 * hang, dropped IPC, connect race), Host stays Ready while UI shows
 * "Thinking…" forever. Host stream-stall only runs when Host is actually
 * Streaming — so pure frontend ghosts need a separate client heal.
 *
 * Detection (all must hold):
 * - UI has an empty streaming assistant (no body, no running tools)
 * - Viewed session looks streaming
 * - Host/liveMap for that session is NOT mid-turn (ready/idle/absent)
 * - Elapsed since turnStartedAt ≥ grace window
 *
 * Heal (UI-side only): strip optimistic user + empty assistant, unlock busy,
 * restore text to composer so the user can retry without hunting Stop.
 */

import type { SessionState } from "./session";
import { isSessionLiveStreaming } from "./session";
import { queueSessionKey } from "./sendQueue";

/**
 * Wait this long after optimistic send before considering Host-absent a ghost.
 * Slightly above 30s so cold WSL/`ensureConnected` paths can finish without a
 * false heal; sendInFlight still short-circuits independently.
 */
export const GHOST_STREAMING_GRACE_MS = 45_000;

/** Poll interval while a pre-token empty stream is showing. */
export const GHOST_STREAMING_POLL_MS = 5_000;

export type GhostChatMessage = {
  id: string;
  role: string;
  content?: string;
  streaming?: boolean;
  /** Tool / marker rows are not pure assistant shells. */
  marker?: string | null;
};

export type GhostStreamingEvidence = {
  /** Workbench session FSM (may be optimistic). */
  uiSessionState: SessionState;
  /** Viewed app session id (null on draft). */
  viewedSessionId: string | null;
  messages: GhostChatMessage[];
  /** Epoch ms when UI entered this turn's busy (optimistic or Host). */
  turnStartedAt: number | null;
  nowMs: number;
  /**
   * Host/liveMap state for the viewed session when known.
   * `null` = no row yet (never projected as busy).
   */
  hostStateForSession: SessionState | null | undefined;
  /**
   * When true, `executeSend` is still awaiting ensureConnected/sessionSend —
   * never heal (WSL cold start can exceed grace while Host row is still null).
   */
  sendInFlight?: boolean;
  graceMs?: number;
};

export type GhostStreamingTurn = {
  /** Indices into the message list to remove. */
  dropIds: string[];
  /** Display text of the optimistic user bubble (restore to composer). */
  restoreComposerText: string;
  userMessageId: string;
  assistantMessageId: string;
};

function isEmptyStreamingAssistant(m: GhostChatMessage): boolean {
  if (m.role !== "assistant") return false;
  if (!m.streaming) return false;
  if (m.marker) return false;
  const body = (m.content ?? "").trim();
  return body.length === 0;
}

/**
 * Find the trailing optimistic ghost turn: user + empty streaming assistant.
 * Returns null when tools / body / non-streaming assistant are present.
 */
export function findOptimisticGhostTurn(
  messages: GhostChatMessage[],
): GhostStreamingTurn | null {
  if (messages.length < 2) return null;
  const last = messages[messages.length - 1]!;
  if (!isEmptyStreamingAssistant(last)) return null;
  // Any earlier streaming assistant with body → not a pure ghost shell.
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.streaming && (m.content ?? "").trim()) {
      return null;
    }
  }
  // Walk back over non-user noise (should not exist, but be safe).
  let userIdx = messages.length - 2;
  while (userIdx >= 0 && messages[userIdx]!.role !== "user") {
    // Tool rows mean a real turn started.
    if (
      messages[userIdx]!.role === "tool" ||
      messages[userIdx]!.marker === "tool_step"
    ) {
      return null;
    }
    userIdx--;
  }
  if (userIdx < 0) return null;
  const user = messages[userIdx]!;
  if (user.role !== "user") return null;
  const restoreComposerText = user.content ?? "";
  return {
    dropIds: [user.id, last.id],
    restoreComposerText,
    userMessageId: user.id,
    assistantMessageId: last.id,
  };
}

/**
 * Whether ghost-heal should treat a send as still in flight for this view.
 *
 * New-chat first send claims `__draft__` and only moves that claim onto the
 * real id *after* `ensureConnected` returns. `setSession(newId)` happens
 * earlier, so a heal tick on the materialized id must still see the draft
 * claim — otherwise it thinks Host is idle and restores the composer while
 * `sessionSend` is about to run (or already running).
 *
 * A live `__draft__` claim counts for *every* viewed id (including a
 * different chat). That can delay an unrelated heal until the draft send
 * settles; it will not skip a real ghost forever.
 */
export function ghostSendInFlight(
  claims: Iterable<string>,
  viewedSessionId: string | null | undefined,
): boolean {
  const set = claims instanceof Set ? claims : new Set(claims);
  if (set.has(queueSessionKey(viewedSessionId))) return true;
  if (set.has(queueSessionKey(null))) return true;
  return false;
}

/**
 * True when Host evidence says this chat is not mid-turn.
 * Missing liveMap row counts as "not mid-turn" (optimistic send never
 * projected Host busy for this id).
 */
export function hostLooksIdleForSession(
  hostStateForSession: SessionState | null | undefined,
): boolean {
  if (hostStateForSession == null) return true;
  if (isSessionLiveStreaming(hostStateForSession)) return false;
  if (hostStateForSession === "awaiting_permission") return false;
  if (hostStateForSession === "connecting") return false;
  return true;
}

/**
 * Whether the UI should auto-heal a ghost optimistic stream.
 */
export function shouldHealGhostStreaming(e: GhostStreamingEvidence): boolean {
  // In-flight IPC: Host may not have projected streaming yet — not a ghost.
  if (e.sendInFlight) return false;
  const grace = e.graceMs ?? GHOST_STREAMING_GRACE_MS;
  if (e.turnStartedAt == null) return false;
  if (e.nowMs - e.turnStartedAt < grace) return false;

  // Only heal pre-token optimistic shells — never mid-tool / mid-body.
  const turn = findOptimisticGhostTurn(e.messages);
  if (!turn) return false;

  // UI must still claim busy (session FSM or empty streaming assistant).
  const uiBusy =
    e.uiSessionState === "streaming" ||
    e.uiSessionState === "awaiting_permission" ||
    e.messages.some(isEmptyStreamingAssistant);
  if (!uiBusy) return false;

  // Host must look idle for this chat (or never projected busy).
  if (!hostLooksIdleForSession(e.hostStateForSession)) return false;

  return true;
}

/** Drop optimistic ghost messages; keep everything else. */
export function stripGhostTurnMessages<T extends GhostChatMessage>(
  messages: T[],
  dropIds: Iterable<string>,
): T[] {
  const drop = dropIds instanceof Set ? dropIds : new Set(dropIds);
  if (!drop.size) return messages;
  return messages.filter((m) => !drop.has(m.id));
}
