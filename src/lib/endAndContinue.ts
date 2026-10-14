import {
  buildContinueAfterStopPrompt,
  buildContinueAfterTransportPrompt,
  buildContinueAgentPrompt,
  type ContinueInterruptContext,
} from "./continueInterruptedTurn";

export const END_AND_CONTINUE_READY_MS = 4000;
export const END_AND_CONTINUE_POLL_MS = 50;

export type EndAndContinueDecision =
  | "ignore"
  | "cancel_failed"
  | "not_ready"
  | "send";

export type ChipContinueDecision =
  | "ignore"
  | "not_ready"
  | "send_after_stop"
  | "send_after_restart"
  | "send_after_transport";

const READY_STATES = new Set(["ready", "idle"]);

export function hostStateIsReady(state: string | null | undefined): boolean {
  return READY_STATES.has((state || "").toLowerCase());
}

/**
 * End-and-continue may send only after cancel was delivered and the raw host
 * state is ready or idle. A stop latch that unlocks Send while the host is
 * still streaming does not count.
 */
export function decideEndAndContinue(input: {
  alreadyBusy: boolean;
  cancelDelivered: boolean;
  hostState: string | null | undefined;
}): EndAndContinueDecision {
  if (input.alreadyBusy) return "ignore";
  if (!input.cancelDelivered) return "cancel_failed";
  if (hostStateIsReady(input.hostState)) return "send";
  return "not_ready";
}

export function continuePromptKind(
  reason: string | null | undefined,
): "after_stop" | "after_restart" | "after_transport" | null {
  const r = (reason || "").toLowerCase();
  if (r === "user_stop") return "after_stop";
  if (r === "host_exit" || r === "agent_exit") return "after_restart";
  // Error-row retry after a dropped connection. Not a host restart.
  if (r === "transport") return "after_transport";
  return null;
}

export function decideChipContinue(input: {
  alreadyBusy: boolean;
  reason: string | null | undefined;
  hostState: string | null | undefined;
}): ChipContinueDecision {
  if (input.alreadyBusy) return "ignore";
  const kind = continuePromptKind(input.reason);
  if (!kind) return "ignore";
  if (kind === "after_stop") {
    return hostStateIsReady(input.hostState) ? "send_after_stop" : "not_ready";
  }
  const st = (input.hostState || "").toLowerCase();
  if (
    st === "streaming" ||
    st === "awaiting_permission" ||
    st === "connecting"
  ) {
    return "ignore";
  }
  if (kind === "after_transport") return "send_after_transport";
  return "send_after_restart";
}

export type ContinueSendArgs = {
  storedDisplay: string;
  att: [];
  goalMode: false;
  targetSessionId: string;
  agentTextOverride: string;
};

export async function waitForHostReady(
  sessionId: string,
  readHostState: (sessionId: string) => string | null | undefined,
  timeoutMs = END_AND_CONTINUE_READY_MS,
  pollMs = END_AND_CONTINUE_POLL_MS,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = readHostState(sessionId) ?? null;
  while (!hostStateIsReady(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    last = readHostState(sessionId) ?? null;
  }
  return last;
}

export async function runEndAndContinue(input: {
  alreadyBusy: boolean;
  sessionId: string;
  stop: (sessionId: string) => Promise<boolean>;
  readHostUntil: (sessionId: string) => Promise<string | null>;
  send: (args: ContinueSendArgs) => Promise<unknown>;
  storedDisplay: string;
  notifyNotSent: () => void;
}): Promise<EndAndContinueDecision> {
  if (input.alreadyBusy) return "ignore";
  const sid = input.sessionId;
  const cancelDelivered = await input.stop(sid);
  const hostState = await input.readHostUntil(sid);
  const decision = decideEndAndContinue({
    alreadyBusy: false,
    cancelDelivered,
    hostState,
  });
  if (decision === "send") {
    await input.send({
      storedDisplay: input.storedDisplay,
      att: [],
      goalMode: false,
      targetSessionId: sid,
      agentTextOverride: buildContinueAfterStopPrompt(),
    });
    return decision;
  }
  if (decision === "cancel_failed" || decision === "not_ready") {
    input.notifyNotSent();
  }
  return decision;
}

export async function runChipContinue(input: {
  alreadyBusy: boolean;
  sessionId: string;
  reason: string;
  hostState: string | null | undefined;
  loadInterruptContext: () => Promise<ContinueInterruptContext | null>;
  send: (args: ContinueSendArgs) => Promise<unknown>;
  storedDisplay: string;
  notifyNotReady: () => void;
}): Promise<ChipContinueDecision> {
  const decision = decideChipContinue({
    alreadyBusy: input.alreadyBusy,
    reason: input.reason,
    hostState: input.hostState,
  });
  if (decision === "ignore") return decision;
  if (decision === "not_ready") {
    input.notifyNotReady();
    return decision;
  }
  const agentTextOverride =
    decision === "send_after_stop"
      ? buildContinueAfterStopPrompt()
      : decision === "send_after_transport"
        ? buildContinueAfterTransportPrompt()
        : buildContinueAgentPrompt(await input.loadInterruptContext());
  await input.send({
    storedDisplay: input.storedDisplay,
    att: [],
    goalMode: false,
    targetSessionId: input.sessionId,
    agentTextOverride,
  });
  return decision;
}
