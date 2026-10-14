import { describe, expect, it } from "vitest";
import { turnErrorContinuesOnRetry } from "./errors";

describe("turnErrorContinuesOnRetry", () => {
  it("continues a bare network error like the #1324 pill", () => {
    expect(turnErrorContinuesOnRetry("**NETWORK_PROVIDER**")).toBe(true);
    expect(
      turnErrorContinuesOnRetry("**NETWORK_PROVIDER**\n\nturn_timeout"),
    ).toBe(true);
    expect(
      turnErrorContinuesOnRetry("**NETWORK_PROVIDER**\n\nagent_disconnected"),
    ).toBe(true);
    expect(turnErrorContinuesOnRetry("**CONNECT_FAILED**")).toBe(true);
    expect(turnErrorContinuesOnRetry("**AGENT_CRASHED**")).toBe(true);
    expect(turnErrorContinuesOnRetry("agent_disconnected")).toBe(true);
    expect(
      turnErrorContinuesOnRetry("stream closed before response.completed"),
    ).toBe(true);
  });

  it("does not continue quota, auth, sandbox, or permission failures", () => {
    expect(
      turnErrorContinuesOnRetry(
        "**NETWORK_PROVIDER**\n\nsubscription:free-usage-exhausted: You've used all the included free usage",
      ),
    ).toBe(false);
    expect(turnErrorContinuesOnRetry("**AUTH_FAILED**")).toBe(false);
    expect(turnErrorContinuesOnRetry("**QUOTA_EXCEEDED**")).toBe(false);
    expect(
      turnErrorContinuesOnRetry(
        "**AGENT_CRASHED**\n\nbwrap: setting up uid map: Permission denied",
      ),
    ).toBe(false);
    expect(turnErrorContinuesOnRetry("**PERMISSION_DENIED**")).toBe(false);
    expect(turnErrorContinuesOnRetry("")).toBe(false);
  });
});
