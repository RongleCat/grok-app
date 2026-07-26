import { describe, expect, it } from "vitest";
import { getQueueForKey, makeQueuedSend } from "@/lib/sendQueue";
import { claimQueueHeadForFlush } from "./useSendQueue";

function queueMap() {
  return {
    "session-1": [
      makeQueuedSend({
        storedDisplay: "queued follow-up",
        attachments: [],
        goalMode: false,
        now: 1,
      }),
    ],
  };
}

function claim(
  byKey: ReturnType<typeof queueMap>,
  pause: { flushPaused: boolean; flushPauseCurrent: boolean },
) {
  return claimQueueHeadForFlush({
    byKey,
    liveState: "ready",
    liveSessionId: "session-1",
    viewingSessionId: "session-1",
    sendInFlight: false,
    connecting: false,
    flushHeld: false,
    ...pause,
  });
}

describe("useSendQueue flush pause", () => {
  it("does not claim while flushPaused is rendered true", () => {
    const byKey = queueMap();

    expect(
      claim(byKey, { flushPaused: true, flushPauseCurrent: false }),
    ).toBeNull();
    expect(getQueueForKey(byKey, "session-1")).toHaveLength(1);
  });

  it("does not claim when the synchronous pause ref leads the render state", () => {
    const byKey = queueMap();

    expect(
      claim(byKey, { flushPaused: false, flushPauseCurrent: true }),
    ).toBeNull();
    expect(getQueueForKey(byKey, "session-1")).toHaveLength(1);
  });

  it("resumes claiming once pause is released and the session is idle", () => {
    const byKey = queueMap();

    expect(
      claim(byKey, { flushPaused: true, flushPauseCurrent: true }),
    ).toBeNull();

    const resumed = claim(byKey, {
      flushPaused: false,
      flushPauseCurrent: false,
    });
    expect(resumed?.head.storedDisplay).toBe("queued follow-up");
    expect(getQueueForKey(resumed?.byKey ?? byKey, "session-1")).toEqual([]);
  });
});
