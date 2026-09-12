/**
 * Auto-cancel clocks for `_x.ai/ask_user_question`.
 *
 * Shared across mounts of the composer gate (and the settings demo modal).
 * Switching chats unmounts the UI; resuming the same request must not reset
 * the deadline.
 */
import { dropGateClock } from "../gateClock";

const askUserClocks = new Map<string, number>();

export function getAskUserClocks(): Map<string, number> {
  return askUserClocks;
}

/** Drop auto-cancel clocks for every AskUser request on `sessionId`. */
export function dropAskUserClocks(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of [...askUserClocks.keys()]) {
    if (key.startsWith(prefix) || key === sessionId) {
      askUserClocks.delete(key);
    }
  }
}

export function dropAskUserClock(key: string): void {
  dropGateClock(askUserClocks, key);
}
