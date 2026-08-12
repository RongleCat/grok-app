import { describe, expect, it } from "vitest";
import {
  dropGateClock,
  dropGateClocks,
  gateClockKey,
  resumeGateClock,
} from "./gateClock";

describe("resumeGateClock", () => {
  it("starts a clock on first sight", () => {
    const clocks = new Map<string, number>();
    const key = gateClockKey("s1", 7);
    expect(resumeGateClock(clocks, key, 1_000_000)).toBe(1_000_000);
    expect(clocks.get(key)).toBe(1_000_000);
  });

  it("resumes instead of restarting when the gate remounts", () => {
    // "New chat" (or switching chats) unmounts the permission bar / modal;
    // coming back must continue the same countdown, not hand out a fresh one.
    const clocks = new Map<string, number>();
    const key = gateClockKey("s1", 7);
    const started = resumeGateClock(clocks, key, 1_000_000);
    expect(resumeGateClock(clocks, key, 1_020_000)).toBe(started);
  });

  it("gives a follow-up request in the same chat its own clock", () => {
    const clocks = new Map<string, number>();
    resumeGateClock(clocks, gateClockKey("s1", 7), 1_000_000);
    expect(resumeGateClock(clocks, gateClockKey("s1", 8), 1_020_000)).toBe(
      1_020_000,
    );
  });

  it("ignores a corrupt stored value", () => {
    const clocks = new Map<string, number>();
    const key = gateClockKey("s1", 7);
    clocks.set(key, Number.NaN);
    expect(resumeGateClock(clocks, key, 1_000_000)).toBe(1_000_000);
  });
});

describe("dropGateClocks", () => {
  it("restarts after the chat's clocks are dropped", () => {
    const clocks = new Map<string, number>();
    const key = gateClockKey("s1", 7);
    resumeGateClock(clocks, key, 1_000_000);
    dropGateClocks(clocks, "s1");
    expect(clocks.size).toBe(0);
    expect(resumeGateClock(clocks, key, 1_020_000)).toBe(1_020_000);
  });

  it("drops only the given chat's clocks", () => {
    const clocks = new Map<string, number>();
    resumeGateClock(clocks, gateClockKey("s1", 1), 1_000);
    resumeGateClock(clocks, gateClockKey("s2", 1), 2_000);
    // A chat id that merely shares a prefix must survive.
    resumeGateClock(clocks, gateClockKey("s10", 1), 3_000);
    dropGateClocks(clocks, "s1");
    expect([...clocks.keys()].sort()).toEqual(["s10:1", "s2:1"]);
  });

  it("drops a single request's clock", () => {
    const clocks = new Map<string, number>();
    resumeGateClock(clocks, gateClockKey("s1", 1), 1_000);
    resumeGateClock(clocks, gateClockKey("s1", 2), 2_000);
    dropGateClock(clocks, gateClockKey("s1", 1));
    expect([...clocks.keys()]).toEqual(["s1:2"]);
  });
});
