/**
 * Decide whether a stream text chunk may still be applied when the focused
 * Host session is no longer "live streaming" (ready/idle after early
 * prompt_complete).
 *
 * Returns true when the UI still needs the tokens (streaming bubble or empty
 * assistant body after thinking). Returns false for pure post-turn replays
 * that would double-append into a finished bubble.
 */

export type LateTokenMessage = {
  role?: string;
  marker?: string | null;
  streaming?: boolean;
  content?: string | null;
  /** Joined thought text when known (live segments may leave content empty). */
  thought?: string | null;
};

/**
 * @param hostLiveStreaming - {@link isSessionLiveStreaming}(host.state)
 * @param chunkIsForFocusedHost - chunk.sessionId === focused liveHost.sessionId
 * @param messages - cached messages for that session (turn-local scan)
 */
export function shouldApplyLateStreamText(opts: {
  hostLiveStreaming: boolean;
  chunkIsForFocusedHost: boolean;
  messages: LateTokenMessage[];
}): boolean {
  if (!opts.chunkIsForFocusedHost) return true;
  if (opts.hostLiveStreaming) return true;

  const msgs = opts.messages;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "user" && m.marker !== "interjection") {
      lastUserIdx = i;
      break;
    }
  }

  let turnAsst: LateTokenMessage | null = null;
  for (let i = msgs.length - 1; i > lastUserIdx; i--) {
    const m = msgs[i]!;
    if (m.role === "assistant") {
      turnAsst = m;
      break;
    }
  }

  // No assistant yet → first body/thought chunk after early ready.
  if (!turnAsst) return true;

  if (turnAsst.streaming) return true;

  const bodyEmpty = !((turnAsst.content ?? "").trim());
  // Empty body after early ready: thinking-only *or* tool-only. A long tool
  // turn settles the bubble (streaming=false, no thought) before the real
  // answer tokens arrive. Dropping those tokens left the viewed chat blank
  // until the user switched sessions and remounted from disk.
  if (bodyEmpty) return true;

  // Settled with a body already present → drop post-turn replays that
  // would double-append into the finished bubble.
  return false;
}

/**
 * Stream `done` flips liveMap to `ready`. The session://state ready
 * handler then sees ready→ready and skips journal heal
 * (`isTurnDoneReadyTransition` is false). Heal the viewed chat on
 * stream done so a dropped tail is lifted without a remount.
 */
export function shouldHealJournalOnStreamDone(opts: {
  isViewingSession: boolean;
  streamDone: boolean;
}): boolean {
  return opts.streamDone && opts.isViewingSession;
}

/** Gaps after attempt 0: 400ms then +500ms (900ms), covering Host's 750ms flush. */
export const JOURNAL_REHYDRATE_RETRY_GAPS_MS = [400, 500] as const;

/**
 * Early `session://stream` `done:true` (prompt_complete / prompt RPC
 * fallback) must not freeze the bubble while Host is still mid-turn.
 * A later fragment would then render as 工作了 + copy/MD/retry under a
 * still-live 工作中 rail.
 */
export function shouldIgnorePrematureStreamDone(opts: {
  hostLiveStreaming: boolean;
  hasRunningTool: boolean;
}): boolean {
  return opts.hostLiveStreaming || opts.hasRunningTool;
}
