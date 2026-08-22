/**
 * Ask-user questionnaire settle policy (#844).
 *
 * Waiting on `session_resolve_ask_user` before hiding the modal left every
 * control `disabled={busy}` for the whole Host stdin timeout when the agent
 * was wedged. Dismiss first; restore only a failed accept if this chat is
 * still showing the same request.
 */

export type AskUserSettleDecision = "accepted" | "cancelled";

export type AskUserSettlePayload = {
  rpcId: number;
  sessionId: string;
};

export type AskUserSettleOutcome =
  | { kind: "dismiss" }
  | { kind: "restore"; error: unknown };

/** Dismiss / X stay clickable while an accept IPC is in flight. */
export function askUserDismissLocked(_busy: boolean): boolean {
  return false;
}

/** First settle for an rpcId wins; a second accept/cancel is a no-op. */
export function canClaimAskUserSettle(
  claimedRpcId: number | null | undefined,
  rpcId: number,
): boolean {
  return claimedRpcId !== rpcId;
}

/**
 * After a failed ACP reply, reopen the questionnaire only for a failed
 * accept on the same chat with no newer request.
 */
export function shouldRestoreAskUserOnError(input: {
  decision: AskUserSettleDecision;
  payload: AskUserSettlePayload;
  viewingSessionId: string | null | undefined;
  currentRpcId: number | null | undefined;
}): boolean {
  if (input.decision !== "accepted") return false;
  if (!input.viewingSessionId) return false;
  if (input.viewingSessionId !== input.payload.sessionId) return false;
  if (input.currentRpcId != null && input.currentRpcId !== input.payload.rpcId) {
    return false;
  }
  return true;
}

/** Drop the stored gate only if no newer questionnaire owns this chat. */
export function shouldClearAskUserGate(input: {
  settledRpcId: number;
  currentRpcId: number | null | undefined;
}): boolean {
  return input.currentRpcId == null || input.currentRpcId === input.settledRpcId;
}

export async function settleAskUserDecision(input: {
  payload: AskUserSettlePayload;
  decision: AskUserSettleDecision;
  answers?: Record<string, string> | null;
  viewingSessionId: () => string | null | undefined;
  currentRpcId: () => number | null | undefined;
  resolve: (args: {
    decision: AskUserSettleDecision;
    answers?: Record<string, string> | null;
    rpcId: number;
    sessionId: string;
  }) => Promise<unknown>;
}): Promise<AskUserSettleOutcome> {
  try {
    await input.resolve({
      decision: input.decision,
      answers: input.answers ?? null,
      rpcId: input.payload.rpcId,
      sessionId: input.payload.sessionId,
    });
    return { kind: "dismiss" };
  } catch (error) {
    if (
      shouldRestoreAskUserOnError({
        decision: input.decision,
        payload: input.payload,
        viewingSessionId: input.viewingSessionId(),
        currentRpcId: input.currentRpcId(),
      })
    ) {
      return { kind: "restore", error };
    }
    return { kind: "dismiss" };
  }
}
