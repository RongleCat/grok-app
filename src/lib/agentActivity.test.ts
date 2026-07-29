import { describe, expect, it } from "vitest";
import {
  collectActivitySessions,
  isActiveSessionSnapshot,
  otherBusySessions,
  stoppableActivitySessions,
} from "./agentActivity";
import { emptyLiveSnapshot, type SessionLiveMap } from "./sessionLiveStore";

describe("isActiveSessionSnapshot", () => {
  it("flags streaming / permission / connecting", () => {
    const base = emptyLiveSnapshot("s1", 1);
    expect(isActiveSessionSnapshot({ ...base, state: "streaming" })).toBe(true);
    expect(
      isActiveSessionSnapshot({
        ...base,
        state: "ready",
        awaitingPermission: true,
      }),
    ).toBe(true);
    expect(isActiveSessionSnapshot({ ...base, state: "connecting" })).toBe(
      true,
    );
    expect(isActiveSessionSnapshot({ ...base, state: "ready" })).toBe(false);
    expect(isActiveSessionSnapshot(null)).toBe(false);
  });
});

describe("collectActivitySessions", () => {
  it("aggregates busy sessions with titles", () => {
    const liveMap: SessionLiveMap = {
      a: {
        ...emptyLiveSnapshot("a", 10),
        state: "streaming",
        liveToolTitle: "bash",
      },
      b: {
        ...emptyLiveSnapshot("b", 20),
        state: "awaiting_permission",
        awaitingPermission: true,
      },
      c: { ...emptyLiveSnapshot("c", 5), state: "ready" },
    };
    const rows = collectActivitySessions({
      liveMap,
      sessions: [
        { id: "a", title: "Fix CI" },
        { id: "b", title: "Review PR" },
      ],
      currentSessionId: "a",
      untitledLabel: "Untitled",
    });
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b"]);
    expect(rows[0]!.isCurrent).toBe(true);
    expect(rows[0]!.liveToolTitle).toBe("bash");
    expect(rows[1]!.status).toBe("awaiting_permission");
    expect(otherBusySessions(rows).map((r) => r.sessionId)).toEqual(["b"]);
    expect(stoppableActivitySessions(rows).map((r) => r.sessionId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("stoppableActivitySessions keeps only stream / permission / connecting", () => {
    const rows = [
      {
        sessionId: "a",
        title: "A",
        status: "streaming" as const,
        liveToolTitle: null,
        isCurrent: false,
        updatedAt: 1,
      },
      {
        sessionId: "b",
        title: "B",
        status: "ready" as const,
        liveToolTitle: null,
        isCurrent: false,
        updatedAt: 2,
      },
      {
        sessionId: "c",
        title: "C",
        status: "connecting" as const,
        liveToolTitle: null,
        isCurrent: true,
        updatedAt: 3,
      },
    ];
    expect(stoppableActivitySessions(rows).map((r) => r.sessionId)).toEqual([
      "a",
      "c",
    ]);
  });
});
