import { afterEach, describe, expect, it } from "vitest";
import {
  busySessionIds,
  emptyLiveSnapshot,
  inferTurnProgressFromMessages,
  isSessionLiveBusy,
  markSawModelOutput,
  markSawToolActivity,
  mergeTurnProgressFromMessages,
  projectHostIntoLiveMap,
  resumeStateForSession,
  settleStoppedSessionInLiveMap,
  settleStoppedSessionSnapshot,
  upsertLiveSnapshot,
  mayPromoteStreamingFromStreamChunk,
} from "./sessionLiveStore";
import {
  getFinishedTurns,
  resetFinishedTurnsForTests,
} from "./sessionFinishedTurns";
import type { ChatMessage } from "./session";

afterEach(() => {
  resetFinishedTurnsForTests();
});

describe("sessionLiveStore", () => {
  it("tracks multi-session busy", () => {
    let map = {};
    map = projectHostIntoLiveMap(map, {
      sessionId: "a",
      state: "streaming",
      streamingMessageId: "m1",
    });
    map = projectHostIntoLiveMap(map, {
      sessionId: "b",
      state: "awaiting_permission",
    });
    map = projectHostIntoLiveMap(map, {
      sessionId: "c",
      state: "ready",
    });
    const busy = busySessionIds(map);
    expect(busy.has("a")).toBe(true);
    expect(busy.has("b")).toBe(true);
    expect(busy.has("c")).toBe(false);
    expect(isSessionLiveBusy(map, "a")).toBe(true);
  });

  it("clears live tool when host leaves streaming", () => {
    let map = upsertLiveSnapshot(
      {},
      {
        sessionId: "a",
        state: "streaming",
        liveToolTitle: "Reading x",
        liveToolId: "t1",
      },
    );
    map = projectHostIntoLiveMap(map, { sessionId: "a", state: "ready" });
    expect(map.a!.liveToolTitle).toBeNull();
    expect(map.a!.state).toBe("ready");
    expect(map.a!.terminalReason).toBe("agent_exit");
  });

  it("stamps terminalReason only when leaving a live turn", () => {
    const cold = projectHostIntoLiveMap(
      {},
      { sessionId: "b", state: "ready" },
    );
    expect(cold.b!.terminalReason).toBeNull();

    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
    );
    expect(map.a!.terminalReason).toBeNull();
    map = projectHostIntoLiveMap(map, { sessionId: "a", state: "ready" });
    expect(map.a!.terminalReason).toBe("agent_exit");
    map = projectHostIntoLiveMap(map, {
      sessionId: "a",
      state: "streaming",
      streamingMessageId: "m2",
    });
    expect(map.a!.terminalReason).toBeNull();
    expect(getFinishedTurns()).toEqual({});
  });

  it("persists a finished turn so Kanban can remount without liveMap", () => {
    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming" },
      1,
    );
    expect(getFinishedTurns()).toEqual({});
    map = projectHostIntoLiveMap(map, { sessionId: "a", state: "ready" }, 2);
    expect(getFinishedTurns()).toEqual({ a: 2 });
    map = projectHostIntoLiveMap(
      map,
      { sessionId: "a", state: "streaming" },
      3,
    );
    expect(getFinishedTurns()).toEqual({});
    expect(map.a!.state).toBe("streaming");
  });

  it("settles only the stopped session so its sidebar busy state clears", () => {
    let map = projectHostIntoLiveMap(
      {},
      {
        sessionId: "a",
        state: "awaiting_permission",
        streamingMessageId: "m1",
      },
      1,
    );
    map = projectHostIntoLiveMap(
      map,
      { sessionId: "b", state: "streaming", streamingMessageId: "m2" },
      2,
    );

    map = settleStoppedSessionInLiveMap(map, "a", 3);

    expect(busySessionIds(map).has("a")).toBe(false);
    expect(busySessionIds(map).has("b")).toBe(true);
    expect(map.a).toMatchObject({
      state: "ready",
      streamingMessageId: null,
      awaitingPermission: false,
      startedAt: null,
    });
  });

  it("does not create or rewrite entries when the session is not busy", () => {
    const empty = {};
    expect(settleStoppedSessionInLiveMap(empty, "missing", 2)).toBe(empty);
    expect(empty).not.toHaveProperty("missing");

    const ready = projectHostIntoLiveMap(
      {},
      { sessionId: "done", state: "ready" },
      1,
    );
    expect(settleStoppedSessionInLiveMap(ready, "done", 2)).toBe(ready);
    expect(ready.done!.updatedAt).toBe(1);
  });

  it("settles matching snapshots but preserves a foreign live host", () => {
    const viewed = {
      sessionId: "a",
      state: "streaming" as const,
      streamingMessageId: "m1",
      title: "A",
    };
    const foreignHost = {
      sessionId: "b",
      state: "streaming" as const,
      streamingMessageId: "m2",
    };

    expect(settleStoppedSessionSnapshot(viewed, "a")).toEqual({
      ...viewed,
      state: "ready",
      streamingMessageId: null,
    });
    expect(settleStoppedSessionSnapshot(foreignHost, "a")).toBe(foreignHost);
  });

  it("empty snapshot defaults", () => {
    const s = emptyLiveSnapshot("x", 1);
    expect(s.sessionId).toBe("x");
    expect(s.state).toBe("idle");
  });

  it("keeps other sessions busy when host focuses a different chat", () => {
    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
    );
    // User switches to B (host focus) — A must remain busy in the map.
    map = projectHostIntoLiveMap(map, {
      sessionId: "b",
      state: "ready",
    });
    expect(busySessionIds(map).has("a")).toBe(true);
    expect(busySessionIds(map).has("b")).toBe(false);
    expect(map.a!.state).toBe("streaming");
    expect(map.b!.state).toBe("ready");
  });

  it("re-attaches a background turn when its chat is reopened", () => {
    // A is streaming in background; Host focus sits on B.
    const map = projectHostIntoLiveMap({}, {
      sessionId: "a",
      state: "streaming",
      streamingMessageId: "m-a",
    });
    const live = { sessionId: "b", state: "ready" as const };

    // Opening A must keep the spinner + stream pipeline, not show it as done.
    expect(resumeStateForSession("a", live, map)).toEqual({
      state: "streaming",
      streamingMessageId: "m-a",
    });
    // Host live slot always wins for its own chat.
    expect(resumeStateForSession("b", live, map)).toEqual({
      state: "ready",
      streamingMessageId: null,
    });
    // A chat with no live work opens idle.
    expect(resumeStateForSession("c", live, map)).toEqual({
      state: "idle",
      streamingMessageId: null,
    });
  });

  it("does not resurrect a finished background chat as streaming", () => {
    let map = projectHostIntoLiveMap({}, {
      sessionId: "a",
      state: "streaming",
      streamingMessageId: "m-a",
    });
    map = projectHostIntoLiveMap(map, { sessionId: "a", state: "ready" });
    expect(
      resumeStateForSession("a", { sessionId: null, state: "idle" }, map),
    ).toEqual({ state: "idle", streamingMessageId: null });
  });

  it("keeps awaiting_permission attached on reopen", () => {
    const map = projectHostIntoLiveMap({}, {
      sessionId: "a",
      state: "awaiting_permission",
      streamingMessageId: "m-a",
    });
    expect(
      resumeStateForSession("a", { sessionId: "b", state: "ready" }, map).state,
    ).toBe("awaiting_permission");
  });

  it("keeps sawModelOutput sticky across streaming host projections", () => {
    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
    );
    map = markSawModelOutput(map, "a");
    map = projectHostIntoLiveMap(map, {
      sessionId: "a",
      state: "streaming",
      streamingMessageId: "m1",
    });
    expect(map.a!.sawModelOutput).toBe(true);
    // Leaving the turn clears flags.
    map = projectHostIntoLiveMap(map, { sessionId: "a", state: "ready" });
    expect(map.a!.sawModelOutput).toBe(false);
  });

  it("markSawModelOutput is identity when already true (no thrash)", () => {
    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
    );
    map = markSawModelOutput(map, "a");
    const again = markSawModelOutput(map, "a");
    expect(again).toBe(map);
  });

  it("markSawToolActivity is identity when already true", () => {
    let map = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
    );
    map = markSawToolActivity(map, "a");
    const again = markSawToolActivity(map, "a");
    expect(again).toBe(map);
  });

  it("upsertLiveSnapshot is identity when fields unchanged", () => {
    let map = upsertLiveSnapshot(
      {},
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
      1,
    );
    const again = upsertLiveSnapshot(
      map,
      { sessionId: "a", state: "streaming", streamingMessageId: "m1" },
      99,
    );
    expect(again).toBe(map);
  });

  it("infers turn progress from journal after last user message", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "t1", role: "tool", content: "tool_step|completed||read", marker: "tool_step" },
      { id: "a1", role: "assistant", content: "done report" },
    ];
    expect(inferTurnProgressFromMessages(msgs)).toEqual({
      sawModelOutput: true,
      sawToolActivity: true,
    });
    let map = mergeTurnProgressFromMessages({}, "s", msgs);
    expect(map.s!.sawModelOutput).toBe(true);
    expect(map.s!.sawToolActivity).toBe(true);
  });

  it("does not re-promote settled sessions from late stream tokens (#225)", () => {
    expect(mayPromoteStreamingFromStreamChunk(undefined, { done: false })).toBe(
      true,
    );
    expect(mayPromoteStreamingFromStreamChunk(undefined, { done: true })).toBe(
      false,
    );
    const streaming = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "streaming" },
    ).a!;
    expect(mayPromoteStreamingFromStreamChunk(streaming, { done: false })).toBe(
      true,
    );
    expect(mayPromoteStreamingFromStreamChunk(streaming, { done: true })).toBe(
      false,
    );
    const ready = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "ready" },
    ).a!;
    expect(mayPromoteStreamingFromStreamChunk(ready, { done: false })).toBe(
      false,
    );
    const idle = projectHostIntoLiveMap(
      {},
      { sessionId: "a", state: "idle" },
    ).a!;
    expect(mayPromoteStreamingFromStreamChunk(idle, { done: false })).toBe(
      false,
    );
  });

});
