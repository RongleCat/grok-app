import { describe, expect, it } from "vitest";
import {
  computeHeatmapStreaks,
  cumulativeTokenSeries,
  formatStatDuration,
  summarizeHeatmapStats,
} from "./heatmapStats";
import type { HeatmapUsageDay } from "./heatmapUsagePro";

const days = (rows: Array<[string, number]>): HeatmapUsageDay[] =>
  rows.map(([date, tokens]) => ({
    date,
    tokens,
    requests: tokens > 0 ? 1 : 0,
  }));

describe("computeHeatmapStreaks", () => {
  it("counts consecutive active days and allows a same-day grace", () => {
    const list = days([
      ["2026-08-10", 10],
      ["2026-08-11", 0],
      ["2026-08-12", 4],
      ["2026-08-13", 8],
      ["2026-08-14", 2],
    ]);
    expect(computeHeatmapStreaks(list, "2026-08-14")).toEqual({
      current: 3,
      longest: 3,
    });
    // Today still empty — yesterday keeps the streak.
    expect(computeHeatmapStreaks(list, "2026-08-15").current).toBe(3);
    expect(computeHeatmapStreaks(list, "2026-08-16").current).toBe(0);
  });

  it("returns zeros when nothing is active", () => {
    expect(computeHeatmapStreaks(days([["2026-08-14", 0]]), "2026-08-14")).toEqual({
      current: 0,
      longest: 0,
    });
  });
});

describe("summarizeHeatmapStats", () => {
  it("reports totals, peak, duration, and streaks without inventing zeros", () => {
    const stats = summarizeHeatmapStats(
      days([
        ["2026-08-12", 100],
        ["2026-08-13", 500],
        ["2026-08-14", 50],
      ]),
      [{ durationSecs: 120 }, { durationSecs: 3600 }],
      "2026-08-14",
    );
    expect(stats).toEqual({
      totalTokens: 650,
      peakTokens: 500,
      peakDate: "2026-08-13",
      longestDurationSecs: 3600,
      currentStreak: 3,
      longestStreak: 3,
    });
  });

  it("returns null figures when the calendar has no activity", () => {
    const stats = summarizeHeatmapStats(
      days([["2026-08-14", 0]]),
      [],
      "2026-08-14",
    );
    expect(stats.totalTokens).toBeNull();
    expect(stats.peakTokens).toBeNull();
    expect(stats.currentStreak).toBeNull();
    expect(stats.longestDurationSecs).toBeNull();
  });
});

describe("cumulativeTokenSeries", () => {
  it("accumulates only positive token days", () => {
    expect(
      cumulativeTokenSeries(
        days([
          ["2026-08-12", 100],
          ["2026-08-13", 0],
          ["2026-08-14", 50],
        ]),
      ),
    ).toEqual([100, 100, 150]);
  });
});

describe("formatStatDuration", () => {
  it("uses locale-aware hours and minutes", () => {
    // Units come from CLDR narrow forms, so Chinese reads 小时/分钟 rather than
    // the abbreviated 分 the old hand-written fork produced.
    expect(formatStatDuration(34560, "zh")).toBe("9小时36分钟");
    expect(formatStatDuration(34560, "en")).toBe("9h 36m");
    expect(formatStatDuration(0, "zh")).toBe("—");
    expect(formatStatDuration(null)).toBe("—");
  });

  it("translates the units for every added locale", () => {
    // Before the CLDR switch these all fell into the English branch.
    expect(formatStatDuration(34560, "ja")).toBe("9時間36分");
    expect(formatStatDuration(34560, "ko")).toBe("9시간 36분");
    expect(formatStatDuration(90, "ja")).toBe("1分30秒");
  });

  it("joins CJK parts without a space and Latin parts with one", () => {
    expect(formatStatDuration(34560, "ja")).not.toContain(" ");
    expect(formatStatDuration(34560, "zh")).not.toContain(" ");
    expect(formatStatDuration(34560, "de")).toContain(" ");
  });
});
