import { describe, expect, it, vi } from "vitest";
import {
  askUserDismissLocked,
  canClaimAskUserSettle,
  settleAskUserDecision,
  shouldClearAskUserGate,
  shouldRestoreAskUserOnError,
} from "./askUserSettle";

const payload = { rpcId: 7, sessionId: "s1" };

describe("askUserDismissLocked", () => {
  it("never locks Dismiss / X while accept IPC is in flight (#844)", () => {
    expect(askUserDismissLocked(false)).toBe(false);
    expect(askUserDismissLocked(true)).toBe(false);
  });
});

describe("canClaimAskUserSettle", () => {
  it("lets the first accept or cancel claim the request", () => {
    expect(canClaimAskUserSettle(null, 7)).toBe(true);
  });

  it("rejects a second settle for the same rpcId", () => {
    expect(canClaimAskUserSettle(7, 7)).toBe(false);
  });
});

describe("shouldRestoreAskUserOnError", () => {
  it("restores a failed accept on the same chat", () => {
    expect(
      shouldRestoreAskUserOnError({
        decision: "accepted",
        payload,
        viewingSessionId: "s1",
        currentRpcId: null,
      }),
    ).toBe(true);
  });

  it("does not restore a failed cancel", () => {
    expect(
      shouldRestoreAskUserOnError({
        decision: "cancelled",
        payload,
        viewingSessionId: "s1",
        currentRpcId: null,
      }),
    ).toBe(false);
  });

  it("does not restore after the user left the chat", () => {
    expect(
      shouldRestoreAskUserOnError({
        decision: "accepted",
        payload,
        viewingSessionId: "s2",
        currentRpcId: null,
      }),
    ).toBe(false);
  });

  it("does not restore over a newer questionnaire", () => {
    expect(
      shouldRestoreAskUserOnError({
        decision: "accepted",
        payload,
        viewingSessionId: "s1",
        currentRpcId: 8,
      }),
    ).toBe(false);
  });
});

describe("shouldClearAskUserGate", () => {
  it("clears when nothing newer is showing", () => {
    expect(shouldClearAskUserGate({ settledRpcId: 7, currentRpcId: null })).toBe(
      true,
    );
    expect(shouldClearAskUserGate({ settledRpcId: 7, currentRpcId: 7 })).toBe(
      true,
    );
  });

  it("keeps a newer questionnaire that arrived during IPC", () => {
    expect(shouldClearAskUserGate({ settledRpcId: 7, currentRpcId: 8 })).toBe(
      false,
    );
  });
});

describe("settleAskUserDecision", () => {
  it("dismisses after a successful accept", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const out = await settleAskUserDecision({
      payload,
      decision: "accepted",
      answers: { q: "yes" },
      viewingSessionId: () => "s1",
      currentRpcId: () => null,
      resolve,
    });
    expect(out).toEqual({ kind: "dismiss" });
    expect(resolve).toHaveBeenCalledWith({
      decision: "accepted",
      answers: { q: "yes" },
      rpcId: 7,
      sessionId: "s1",
    });
  });

  it("restores a failed accept so the user can retry", async () => {
    const err = new Error("stdin write timeout");
    const out = await settleAskUserDecision({
      payload,
      decision: "accepted",
      viewingSessionId: () => "s1",
      currentRpcId: () => null,
      resolve: vi.fn().mockRejectedValue(err),
    });
    expect(out).toEqual({ kind: "restore", error: err });
  });

  it("does not restore over a newer questionnaire that arrived during IPC", async () => {
    const out = await settleAskUserDecision({
      payload,
      decision: "accepted",
      viewingSessionId: () => "s1",
      currentRpcId: () => 8,
      resolve: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    expect(out).toEqual({ kind: "dismiss" });
  });

  it("still hides after a failed cancel", async () => {
    const out = await settleAskUserDecision({
      payload,
      decision: "cancelled",
      viewingSessionId: () => "s1",
      currentRpcId: () => null,
      resolve: vi.fn().mockRejectedValue(new Error("gone")),
    });
    expect(out).toEqual({ kind: "dismiss" });
  });
});
