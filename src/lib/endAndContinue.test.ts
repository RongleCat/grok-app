import { describe, expect, it, vi } from "vitest";
import {
  decideChipContinue,
  decideEndAndContinue,
  runChipContinue,
  runEndAndContinue,
  waitForHostReady,
  type ContinueSendArgs,
} from "./endAndContinue";

const display = "continue";

function sendRecorder() {
  const sent: ContinueSendArgs[] = [];
  return {
    sent,
    send: async (args: ContinueSendArgs) => {
      sent.push(args);
    },
  };
}

describe("decideEndAndContinue", () => {
  it("does not send while the host is still streaming", () => {
    expect(
      decideEndAndContinue({
        alreadyBusy: false,
        cancelDelivered: true,
        hostState: "streaming",
      }),
    ).toBe("not_ready");
  });

  it("sends only for ready or idle after a delivered cancel", () => {
    expect(
      decideEndAndContinue({
        alreadyBusy: false,
        cancelDelivered: true,
        hostState: "ready",
      }),
    ).toBe("send");
    expect(
      decideEndAndContinue({
        alreadyBusy: false,
        cancelDelivered: true,
        hostState: "idle",
      }),
    ).toBe("send");
  });

  it("does not send when cancel was not delivered", () => {
    expect(
      decideEndAndContinue({
        alreadyBusy: false,
        cancelDelivered: false,
        hostState: "ready",
      }),
    ).toBe("cancel_failed");
  });
});

describe("runEndAndContinue", () => {
  it("ignores a second click while the first stop is still in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stops = 0;
    let busy = false;
    const { sent, send } = sendRecorder();
    const start = () => {
      if (busy) {
        return runEndAndContinue({
          alreadyBusy: true,
          sessionId: "sid-a",
          stop: async () => {
            stops += 1;
            return true;
          },
          readHostUntil: async () => "ready",
          send,
          storedDisplay: display,
          notifyNotSent: () => {},
        });
      }
      busy = true;
      return runEndAndContinue({
        alreadyBusy: false,
        sessionId: "sid-a",
        stop: async () => {
          stops += 1;
          await gate;
          return true;
        },
        readHostUntil: async () => "ready",
        send,
        storedDisplay: display,
        notifyNotSent: () => {},
      });
    };
    const first = start();
    const second = start();
    release();
    await Promise.all([first, second]);
    expect(stops).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("does not send when cancel fails", async () => {
    const notify = vi.fn();
    const { sent, send } = sendRecorder();
    const decision = await runEndAndContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      stop: async () => false,
      readHostUntil: async () => "ready",
      send,
      storedDisplay: display,
      notifyNotSent: notify,
    });
    expect(decision).toBe("cancel_failed");
    expect(sent).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not send when the host stays streaming past the ready wait", async () => {
    const notify = vi.fn();
    const { sent, send } = sendRecorder();
    const decision = await runEndAndContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      stop: async () => true,
      readHostUntil: async () => "streaming",
      send,
      storedDisplay: display,
      notifyNotSent: notify,
    });
    expect(decision).toBe("not_ready");
    expect(sent).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("sends to the session captured at click after the viewed chat changes", async () => {
    let viewed = "sid-a";
    const { sent, send } = sendRecorder();
    await runEndAndContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      stop: async (sid) => {
        viewed = "sid-b";
        expect(sid).toBe("sid-a");
        return true;
      },
      readHostUntil: async (sid) => (sid === "sid-a" ? "ready" : "streaming"),
      send,
      storedDisplay: display,
      notifyNotSent: () => {},
    });
    expect(viewed).toBe("sid-b");
    expect(sent[0]?.targetSessionId).toBe("sid-a");
    expect(sent[0]?.agentTextOverride).not.toMatch(/host process restarted/i);
    expect(sent[0]?.agentTextOverride).toMatch(/model stream was cut off/i);
  });
});

describe("runChipContinue", () => {
  it("sends the stop prompt for user_stop without calling stop", async () => {
    const { sent, send } = sendRecorder();
    const decision = await runChipContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      reason: "user_stop",
      hostState: "ready",
      loadInterruptContext: async () => {
        throw new Error("interrupt context is not for user_stop");
      },
      send,
      storedDisplay: display,
      notifyNotReady: () => {},
    });
    expect(decision).toBe("send_after_stop");
    expect(sent[0]?.agentTextOverride).toMatch(/model stream was cut off/i);
    expect(sent[0]?.targetSessionId).toBe("sid-a");
  });

  it("toasts and does not send user_stop while the host is still streaming", async () => {
    const notify = vi.fn();
    const { sent, send } = sendRecorder();
    const decision = await runChipContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      reason: "user_stop",
      hostState: "streaming",
      loadInterruptContext: async () => null,
      send,
      storedDisplay: display,
      notifyNotReady: notify,
    });
    expect(decision).toBe("not_ready");
    expect(sent).toHaveLength(0);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("sends a continue prompt for a dropped connection without rewind", async () => {
    const { sent, send } = sendRecorder();
    const decision = await runChipContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      reason: "transport",
      hostState: "disconnected",
      loadInterruptContext: async () => {
        throw new Error("transport continue must not load a restart context");
      },
      send,
      storedDisplay: display,
      notifyNotReady: () => {},
    });
    expect(decision).toBe("send_after_transport");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.targetSessionId).toBe("sid-a");
    expect(sent[0]?.agentTextOverride).toMatch(/connection to the model dropped/i);
    expect(sent[0]?.agentTextOverride).not.toMatch(/host process restarted/i);
    expect(sent[0]?.storedDisplay).toBe(display);
  });

  it("does not send a transport continue while the turn is still streaming", async () => {
    const { sent, send } = sendRecorder();
    const decision = await runChipContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      reason: "transport",
      hostState: "streaming",
      loadInterruptContext: async () => null,
      send,
      storedDisplay: display,
      notifyNotReady: () => {},
    });
    expect(decision).toBe("ignore");
    expect(sent).toHaveLength(0);
  });

  it("keeps the restart prompt for host_exit and skips a live stream", async () => {
    expect(
      decideChipContinue({
        alreadyBusy: false,
        reason: "host_exit",
        hostState: "streaming",
      }),
    ).toBe("ignore");
    const { sent, send } = sendRecorder();
    const decision = await runChipContinue({
      alreadyBusy: false,
      sessionId: "sid-a",
      reason: "host_exit",
      hostState: "ready",
      loadInterruptContext: async () => ({
        command: "npm test",
        title: "tests",
        toolName: "shell",
      }),
      send,
      storedDisplay: display,
      notifyNotReady: () => {},
    });
    expect(decision).toBe("send_after_restart");
    expect(sent[0]?.agentTextOverride).toMatch(/host process restarted/i);
  });
});

describe("waitForHostReady", () => {
  it("returns the last host state when the wait expires", async () => {
    vi.useFakeTimers();
    const pending = waitForHostReady("sid", () => "streaming", 100, 20);
    await vi.advanceTimersByTimeAsync(120);
    await expect(pending).resolves.toBe("streaming");
    vi.useRealTimers();
  });
});
