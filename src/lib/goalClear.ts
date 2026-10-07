/**
 * Tell the live CLI to leave goal mode. The command is `/goal clear`
 * (Grok Build: status | pause | resume | clear). There is no separate RPC.
 * A session that is not ready yet is remembered and flushed once it is.
 * A send that throws stays remembered so the next ready flush can try again.
 * A send already in flight is not started a second time.
 */

import { sessionSend } from "@/lib/api/session";

const GOAL_CLEAR_TEXT = "/goal clear";

export type GoalClearQueue = {
  arm: (sessionId: string | null | undefined, state: string) => void;
  flush: (sessionId: string | null | undefined, state: string) => void;
};

export function createGoalClearQueue(
  send: (sessionId: string) => Promise<void>,
): GoalClearQueue {
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  const deliver = (sessionId: string) => {
    pending.add(sessionId);
    if (inFlight.has(sessionId)) return;
    inFlight.add(sessionId);
    void send(sessionId).then(
      () => {
        pending.delete(sessionId);
        inFlight.delete(sessionId);
      },
      () => {
        inFlight.delete(sessionId);
      },
    );
  };
  return {
    arm(sessionId, state) {
      const id = (sessionId ?? "").trim();
      if (!id) return;
      if (state === "ready") {
        deliver(id);
        return;
      }
      pending.add(id);
    },
    flush(sessionId, state) {
      const id = (sessionId ?? "").trim();
      if (!id || state !== "ready" || !pending.has(id)) return;
      deliver(id);
    },
  };
}

export const sessionGoalClear = createGoalClearQueue(async (sessionId) => {
  try {
    await sessionSend(GOAL_CLEAR_TEXT, GOAL_CLEAR_TEXT, sessionId, []);
  } catch (e) {
    if (String(e).includes("CONNECT_FAILED")) return;
    console.warn("goal clear failed", e);
    throw e;
  }
});
