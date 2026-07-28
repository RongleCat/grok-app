import { describe, expect, it } from "vitest";
import {
  dateInHeatRange,
  heatRangesEqual,
  sumHeatInRange,
} from "@/components/Heatmap";
import type { HeatmapDay } from "@/lib/api";

describe("heat range helpers", () => {
  it("compares ranges", () => {
    expect(heatRangesEqual(null, null)).toBe(true);
    expect(heatRangesEqual({ start: "a", end: "b" }, null)).toBe(false);
    expect(
      heatRangesEqual(
        { start: "2026-04-01", end: "2026-04-07" },
        { start: "2026-04-01", end: "2026-04-07" },
      ),
    ).toBe(true);
  });

  it("includes dates in inclusive range", () => {
    const r = { start: "2026-04-06", end: "2026-04-12" };
    expect(dateInHeatRange("2026-04-06", r)).toBe(true);
    expect(dateInHeatRange("2026-04-12", r)).toBe(true);
    expect(dateInHeatRange("2026-04-05", r)).toBe(false);
    expect(dateInHeatRange("2026-04-13", r)).toBe(false);
  });

  it("sums heatmap days in range", () => {
    const days: HeatmapDay[] = [
      { date: "2026-04-06", requests: 1, tokens: 100, costUsd: 0 },
      { date: "2026-04-07", requests: 2, tokens: 50, costUsd: 0 },
      { date: "2026-04-10", requests: 9, tokens: 900, costUsd: 0 },
    ];
    expect(
      sumHeatInRange(days, { start: "2026-04-06", end: "2026-04-07" }),
    ).toEqual({ requests: 3, tokens: 150 });
  });
});
