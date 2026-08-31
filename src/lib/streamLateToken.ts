import { contentLooksLikeThought } from "./session/segments";

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

  const content = (turnAsst.content ?? "").trim();
  const thought = (turnAsst.thought ?? "").trim();
  const bodyEmpty = !content || contentLooksLikeThought(content, thought);
  // Empty body after early ready: thinking-only *or* tool-only. A long tool
  // turn settles the bubble (streaming=false, no thought) before the real
  // answer tokens arrive. Thought leaked into `content` is not a settled
  // answer either — dropping the real tail left CoT painted as the reply
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

/** Gaps after attempt 0: 400 + 500 + 800ms (1700ms). Host post-turn reconcile
 *  last delay is 750ms and the disk write can still be in flight after that. */
export const JOURNAL_REHYDRATE_RETRY_GAPS_MS = [400, 500, 800] as const;

/**
 * End-of-turn UI rehydrate must not re-parse agent `chat_history` / `updates`.
 * Host `post_turn_reconcile` already merged those rows. Passing `reconcile: true`
 * here stacked a second jsonl parse on `session_messages` while the Host still
 * held the process store lock — on Windows that wait sat inside the WebView
 * WndProc and froze the window (#754).
 */
export const JOURNAL_REHYDRATE_RECONCILE = false;

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
