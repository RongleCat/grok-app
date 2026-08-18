import { describe, expect, it } from "vitest";
import {
  DRAFT_TURN_CLOCK_KEY,
  migrateDraftTurnClock,
  resolveTurnClockKey,
  shouldSyncViewedTurnClock,
} from "./turnClock";

describe("turnClock", () => {
  it("resolveTurnClockKey uses the draft sentinel when id is missing", () => {
    expect(resolveTurnClockKey(null)).toBe(DRAFT_TURN_CLOCK_KEY);
    expect(resolveTurnClockKey(undefined)).toBe(DRAFT_TURN_CLOCK_KEY);
    expect(resolveTurnClockKey("s1")).toBe("s1");
  });

  it("syncs the viewed clock for the draft page and the matching session", () => {
    expect(
      shouldSyncViewedTurnClock({
        clockSessionId: DRAFT_TURN_CLOCK_KEY,
        viewingSessionId: null,
      }),
    ).toBe(true);
    expect(
      shouldSyncViewedTurnClock({
        clockSessionId: "s1",
        viewingSessionId: null,
      }),
    ).toBe(false);
    expect(
      shouldSyncViewedTurnClock({
        clockSessionId: "s1",
        viewingSessionId: "s1",
      }),
    ).toBe(true);
    expect(
      shouldSyncViewedTurnClock({
        clockSessionId: "s2",
        viewingSessionId: "s1",
      }),
    ).toBe(false);
  });

  it("migrates a draft clock onto the materialized session id", () => {
    const clocks = new Map<string, number>([[DRAFT_TURN_CLOCK_KEY, 1_000]]);
    expect(migrateDraftTurnClock(clocks, "s-new")).toBe(true);
    expect(clocks.get("s-new")).toBe(1_000);
    expect(clocks.has(DRAFT_TURN_CLOCK_KEY)).toBe(false);
  });

  it("does not overwrite a clock the new session already started", () => {
    const clocks = new Map<string, number>([
      [DRAFT_TURN_CLOCK_KEY, 1_000],
      ["s-new", 2_000],
    ]);
    expect(migrateDraftTurnClock(clocks, "s-new")).toBe(true);
    expect(clocks.get("s-new")).toBe(2_000);
    expect(clocks.has(DRAFT_TURN_CLOCK_KEY)).toBe(false);
  });

  it("is a no-op when there is no draft clock", () => {
    const clocks = new Map<string, number>([["s1", 1_000]]);
    expect(migrateDraftTurnClock(clocks, "s-new")).toBe(false);
    expect(clocks.size).toBe(1);
  });

  it("refuses to migrate onto an empty or draft key", () => {
    const clocks = new Map<string, number>([[DRAFT_TURN_CLOCK_KEY, 1_000]]);
    expect(migrateDraftTurnClock(clocks, "")).toBe(false);
    expect(migrateDraftTurnClock(clocks, DRAFT_TURN_CLOCK_KEY)).toBe(false);
    expect(clocks.get(DRAFT_TURN_CLOCK_KEY)).toBe(1_000);
  });
});
