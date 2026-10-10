import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUBAGENT_STORE_MAX_RUNS,
  SUBAGENT_STORE_MAX_SESSIONS,
  subagentStore,
} from "./subagentStore";
import type { SubagentEventPayload } from "./session/subagents";

function spawned(sessionId: string, subagentId: string): SubagentEventPayload {
  return { sessionId, phase: "spawned", subagentId };
}

describe("subagentStore", () => {
  beforeEach(() => {
    subagentStore.resetForTests();
  });

  it("keeps sessions isolated and reads are reference-stable", () => {
    // Arrange
    subagentStore.apply(spawned("s1", "a1"));
    subagentStore.apply(spawned("s2", "b1"));

    // Act
    const first = subagentStore.list("s1");
    const again = subagentStore.list("s1");

    // Assert
    expect(first.map((r) => r.subagentId)).toEqual(["a1"]);
    expect(subagentStore.list("s2").map((r) => r.subagentId)).toEqual(["b1"]);
    // Same reference while unchanged — useSyncExternalStore needs this.
    expect(again).toBe(first);
    // Unknown / missing session reads return the shared empty list.
    expect(subagentStore.list("nope")).toBe(subagentStore.list(null));
  });

  it("ignores payloads with no session or a blank id", () => {
    // Act
    subagentStore.apply({ phase: "spawned", subagentId: "a1" });
    subagentStore.apply({ sessionId: "   ", phase: "spawned", subagentId: "a1" });

    // Assert
    expect(subagentStore.list("")).toHaveLength(0);
    expect(subagentStore.list("   ")).toHaveLength(0);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    // Arrange
    const listener = vi.fn();
    const unsubscribe = subagentStore.subscribe(listener);

    // Act
    subagentStore.apply(spawned("s1", "a1"));
    subagentStore.apply({ sessionId: "s1", phase: "progress" });

    // Assert
    expect(listener).toHaveBeenCalledTimes(1);

    // Act
    unsubscribe();
    subagentStore.apply(spawned("s1", "a2"));

    // Assert
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("bounds runs per session and evicts the least recently touched session", () => {
    // Arrange / Act — overflow one session's run list
    for (let i = 0; i < SUBAGENT_STORE_MAX_RUNS + 5; i += 1) {
      subagentStore.apply(spawned("s1", `a${i}`));
    }

    // Assert
    const runs = subagentStore.list("s1");
    expect(runs).toHaveLength(SUBAGENT_STORE_MAX_RUNS);
    expect(runs[runs.length - 1]!.subagentId).toBe(
      `a${SUBAGENT_STORE_MAX_RUNS + 4}`,
    );

    // Arrange / Act — overflow the session map; s1 is touched last so it stays
    for (let i = 0; i < SUBAGENT_STORE_MAX_SESSIONS; i += 1) {
      subagentStore.apply(spawned(`sess-${i}`, "x"));
    }
    subagentStore.apply(spawned("s1", "a-keep"));

    // Assert
    expect(subagentStore.list("s1").length).toBeGreaterThan(0);
    expect(subagentStore.list("sess-0")).toHaveLength(0);
  });
});
