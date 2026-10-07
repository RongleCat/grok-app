import { describe, expect, it, vi } from "vitest";
import { sessionSend } from "@/lib/api/session";
import { createGoalClearQueue, sessionGoalClear } from "./goalClear";

vi.mock("@/lib/api/session", () => ({
  sessionSend: vi.fn(),
}));

describe("createGoalClearQueue", () => {
  it("sends immediately when the session is ready", () => {
    const send = vi.fn(async () => {});
    const q = createGoalClearQueue(send);
    q.arm("s1", "ready");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("s1");
  });

  it("waits until that same session is ready, and does not clear another chat", async () => {
    const send = vi.fn(async () => {});
    const q = createGoalClearQueue(send);
    q.arm("s1", "streaming");
    q.flush("s2", "ready");
    q.flush("s1", "streaming");
    expect(send).not.toHaveBeenCalled();
    q.flush("s1", "ready");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("s1");
  });

  it("ignores an empty session id", () => {
    const send = vi.fn(async () => {});
    const q = createGoalClearQueue(send);
    q.arm(null, "ready");
    q.arm("  ", "ready");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the clear pending when send rejects, and retries on the next flush", async () => {
    const send = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const q = createGoalClearQueue(send);
    q.arm("s1", "ready");
    expect(send).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    q.flush("s1", "ready");
    expect(send).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    q.flush("s1", "ready");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not start a second send while the first is in flight", async () => {
    let resolveSend: () => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const q = createGoalClearQueue(send);
    q.arm("s1", "ready");
    q.flush("s1", "ready");
    q.arm("s1", "ready");
    expect(send).toHaveBeenCalledTimes(1);
    resolveSend();
    await Promise.resolve();
    q.flush("s1", "ready");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("sessionGoalClear", () => {
  it("does not retry when the host is not connected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(sessionSend).mockReset();
    vi.mocked(sessionSend).mockRejectedValueOnce(new Error("CONNECT_FAILED"));
    sessionGoalClear.arm("connect-1", "ready");
    await Promise.resolve();
    await Promise.resolve();
    sessionGoalClear.flush("connect-1", "ready");
    expect(sessionSend).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("retries after a send error that is not a connect failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(sessionSend).mockReset();
    vi.mocked(sessionSend)
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof sessionSend>>);
    sessionGoalClear.arm("disk-1", "ready");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sessionSend).toHaveBeenCalledTimes(1);
    sessionGoalClear.flush("disk-1", "ready");
    await Promise.resolve();
    expect(sessionSend).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
