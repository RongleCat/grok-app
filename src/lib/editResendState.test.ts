import { describe, expect, it } from "vitest";
import { shouldHoldFlushForLive } from "@/lib/sendQueue";
import {
  optimisticLiveHostForEditResend,
  restoreOptimisticLiveHost,
  shellReadyAfterRewindFailure,
} from "./editResendState";

const snap = (
  sessionId: string | null,
  state: "ready" | "streaming" | "disconnected",
) => ({ sessionId, state, lastError: null });

describe("edit-resend rewind failure", () => {
  it("marks ready only when the shell is still the rewind target", () => {
    const other = snap("chat-b", "streaming");
    expect(shellReadyAfterRewindFailure(other, "chat-a")).toEqual(other);

    const target = snap("chat-a", "streaming");
    expect(shellReadyAfterRewindFailure(target, "chat-a").state).toBe("ready");

    const draft = snap(null, "streaming");
    expect(shellReadyAfterRewindFailure(draft, null).state).toBe("streaming");

    const already = snap("chat-a", "ready");
    expect(shellReadyAfterRewindFailure(already, "chat-a")).toBe(already);
  });

  it("restores the optimistic liveHost streaming flag for that chat", () => {
    const before = snap("chat-a", "ready");
    const optimistic = snap("chat-a", "streaming");
    const restored = restoreOptimisticLiveHost(
      optimistic,
      before,
      "chat-a",
      true,
    );
    expect(restored).toEqual(before);
    expect(
      shouldHoldFlushForLive(restored.sessionId, restored.state, "chat-a"),
    ).toBe(false);

    const other = snap("chat-b", "streaming");
    expect(
      restoreOptimisticLiveHost(other, before, "chat-a", true),
    ).toEqual(other);
    expect(
      restoreOptimisticLiveHost(other, before, "chat-a", false),
    ).toEqual(other);

    const moved = snap("chat-a", "disconnected");
    expect(
      restoreOptimisticLiveHost(moved, before, "chat-a", true),
    ).toEqual(moved);
  });

  it("does not stamp streaming onto a different chat's live host", () => {
    const other = snap("chat-b", "streaming");
    expect(optimisticLiveHostForEditResend(other, "chat-a")).toBe(other);
    expect(optimisticLiveHostForEditResend(snap("chat-a", "ready"), "chat-a")).toEqual(
      snap("chat-a", "streaming"),
    );
  });
});
