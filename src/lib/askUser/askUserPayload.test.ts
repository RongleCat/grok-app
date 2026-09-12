import { describe, expect, it } from "vitest";
import { isValidAskUserPayload } from "./askUserPayload";
import type { AskUserPayload } from "../session";

function payload(over: Partial<AskUserPayload> = {}): AskUserPayload {
  return {
    rpcId: 1,
    sessionId: "s1",
    questions: [{ question: "q?", options: [], header: "" } as any],
    ...over,
  };
}

describe("isValidAskUserPayload", () => {
  it("accepts a valid payload", () => {
    expect(isValidAskUserPayload(payload())).toBe(true);
  });

  it("accepts rpcId = 0 (JSON-RPC ids start at 0)", () => {
    // Regression: a truthy guard dropped id=0 questions, the modal never
    // showed, and the turn hung until cancelled.
    expect(isValidAskUserPayload(payload({ rpcId: 0 }))).toBe(true);
  });

  it("rejects missing rpcId", () => {
    expect(isValidAskUserPayload(payload({ rpcId: undefined as any }))).toBe(
      false,
    );
    expect(isValidAskUserPayload(payload({ rpcId: null as any }))).toBe(false);
  });

  it("rejects empty / missing questions", () => {
    expect(isValidAskUserPayload(payload({ questions: [] }))).toBe(false);
    expect(
      isValidAskUserPayload(payload({ questions: undefined as any })),
    ).toBe(false);
  });

  it("rejects null / undefined payload", () => {
    expect(isValidAskUserPayload(null)).toBe(false);
    expect(isValidAskUserPayload(undefined)).toBe(false);
  });
});
