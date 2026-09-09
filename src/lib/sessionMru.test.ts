import { describe, expect, it } from "vitest";
import {
  beginSessionMruCycle,
  buildSessionMruPanelState,
  filterSessionMru,
  isSessionMruModifierKey,
  loadSessionMru,
  matchSessionMruChord,
  normalizeSessionMru,
  parseSessionMru,
  saveSessionMru,
  sessionMruCycleTarget,
  sessionMruSnapshot,
  stepSessionMruCycle,
  stepSessionMruIndex,
  touchSessionMru,
  type SessionMruChordEvent,
  type SessionMruStorage,
} from "./sessionMru";

function chord(
  over: Partial<SessionMruChordEvent> & Pick<SessionMruChordEvent, "key">,
): SessionMruChordEvent {
  return {
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  };
}

describe("normalizeSessionMru / touchSessionMru", () => {
  it("dedupes, trims, drops empties, and caps", () => {
    expect(
      normalizeSessionMru([" a ", "b", "a", "", "  ", 1, "c"], 2),
    ).toEqual(["a", "b"]);
  });

  it("moves a visit to the front", () => {
    expect(touchSessionMru(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(touchSessionMru(["a"], "z")).toEqual(["z", "a"]);
    expect(touchSessionMru(["a"], "  ")).toEqual(["a"]);
    expect(touchSessionMru(["a"], null)).toEqual(["a"]);
  });
});

describe("filterSessionMru / snapshot", () => {
  it("drops ids that are no longer live", () => {
    expect(filterSessionMru(["a", "gone", "b"], ["b", "a"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("puts the current live id first, then recents, and skips never-visited live rows", () => {
    expect(sessionMruSnapshot(["b", "a"], ["a", "b", "c"], "a")).toEqual([
      "a",
      "b",
    ]);
    expect(sessionMruSnapshot(["b", "a"], ["a", "b"], null)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("beginSessionMruCycle", () => {
  it("ping-pongs two chats on next and prev", () => {
    const next = beginSessionMruCycle(["b", "a"], ["a", "b"], "b", "next");
    expect(next).toEqual({ snapshot: ["b", "a"], index: 1 });
    expect(sessionMruCycleTarget(next)).toBe("a");
    const prev = beginSessionMruCycle(["b", "a"], ["a", "b"], "b", "prev");
    expect(sessionMruCycleTarget(prev)).toBe("a");
  });

  it("walks three chats while the snapshot stays frozen", () => {
    const first = beginSessionMruCycle(
      ["c", "b", "a"],
      ["a", "b", "c"],
      "c",
      "next",
    );
    expect(sessionMruCycleTarget(first)).toBe("b");
    const second = stepSessionMruCycle(first!, "next");
    expect(sessionMruCycleTarget(second)).toBe("a");
    const third = stepSessionMruCycle(second, "next");
    expect(sessionMruCycleTarget(third)).toBe("c");
    expect(third.snapshot).toEqual(["c", "b", "a"]);
  });

  it("opens the most recent chat from an empty new-chat surface", () => {
    const cycle = beginSessionMruCycle(["b", "a"], ["a", "b"], null, "next");
    expect(sessionMruCycleTarget(cycle)).toBe("b");
  });

  it("no-ops when there is nowhere to go", () => {
    expect(beginSessionMruCycle(["a"], ["a"], "a", "next")).toBeNull();
    expect(beginSessionMruCycle([], ["a"], "a", "next")).toBeNull();
    expect(beginSessionMruCycle(["gone"], ["a"], "a", "next")).toBeNull();
  });

  it("builds switcher rows from the frozen cycle", () => {
    const cycle = beginSessionMruCycle(["b", "a"], ["a", "b"], "b", "next");
    expect(
      buildSessionMruPanelState(cycle, (id) => ({
        title: id === "a" ? " Alpha " : "Beta",
        projectName: id === "a" ? " proj " : "",
      })),
    ).toEqual({
      index: 1,
      rows: [
        { id: "b", title: "Beta", projectName: "" },
        { id: "a", title: "Alpha", projectName: "proj" },
      ],
    });
    expect(buildSessionMruPanelState(null, () => null)).toBeNull();
  });

  it("wraps prev from the current chat to the oldest recent", () => {
    const cycle = beginSessionMruCycle(
      ["c", "b", "a"],
      ["a", "b", "c"],
      "c",
      "prev",
    );
    expect(sessionMruCycleTarget(cycle)).toBe("a");
  });
});

describe("stepSessionMruIndex", () => {
  it("wraps both directions", () => {
    expect(stepSessionMruIndex(3, 0, "next")).toBe(1);
    expect(stepSessionMruIndex(3, 2, "next")).toBe(0);
    expect(stepSessionMruIndex(3, 0, "prev")).toBe(2);
    expect(stepSessionMruIndex(0, 0, "next")).toBe(0);
  });
});

describe("matchSessionMruChord", () => {
  it("matches Ctrl+Tab / Ctrl+Shift+Tab and ignores Cmd/Alt/repeat/IME", () => {
    expect(matchSessionMruChord(chord({ key: "Tab" }))).toBe("next");
    expect(matchSessionMruChord(chord({ key: "Tab", shiftKey: true }))).toBe(
      "prev",
    );
    expect(matchSessionMruChord(chord({ key: "Tab", code: "Tab" }))).toBe(
      "next",
    );
    expect(
      matchSessionMruChord(chord({ key: "Tab", metaKey: true })),
    ).toBeNull();
    expect(
      matchSessionMruChord(chord({ key: "Tab", altKey: true })),
    ).toBeNull();
    expect(
      matchSessionMruChord(chord({ key: "Tab", ctrlKey: false })),
    ).toBeNull();
    expect(
      matchSessionMruChord(chord({ key: "Tab", repeat: true })),
    ).toBeNull();
    expect(
      matchSessionMruChord(chord({ key: "Tab", isComposing: true })),
    ).toBeNull();
    expect(matchSessionMruChord(chord({ key: "t" }))).toBeNull();
  });

  it("treats Control keyup as the cycle modifier", () => {
    expect(isSessionMruModifierKey({ key: "Control" })).toBe(true);
    expect(isSessionMruModifierKey({ key: "c", code: "ControlLeft" })).toBe(
      true,
    );
    expect(isSessionMruModifierKey({ key: "Tab" })).toBe(false);
  });
});

describe("session MRU storage", () => {
  it("parses corrupt payloads as empty", () => {
    expect(parseSessionMru(null)).toEqual([]);
    expect(parseSessionMru("nope")).toEqual([]);
    expect(parseSessionMru({ ids: ["a"] })).toEqual([]);
    expect(parseSessionMru([" a ", "", "a", "b"])).toEqual(["a", "b"]);
  });

  it("round-trips through a fake store", () => {
    const mem: Record<string, string> = {};
    const storage: SessionMruStorage = {
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => {
        mem[k] = v;
      },
    };
    saveSessionMru(["z", "y"], storage);
    expect(loadSessionMru(storage)).toEqual(["z", "y"]);
  });
});
