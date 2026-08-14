import { describe, expect, it } from "vitest";
import {
  classifyHeatmapError,
  heatmapDayHasActivity,
  heatmapErrorView,
  heatmapHasSamples,
  heatmapSummaryChips,
  listHeatmapGranularityChips,
  resolveHeatmapEmptyState,
  resolveHeatmapErrorChip,
  summarizeHeatmapRange,
  type HeatmapUsageDay,
} from "./heatmapUsagePro";

const sampleDays: HeatmapUsageDay[] = [
  { date: "2026-04-01", requests: 0, tokens: 0 },
  { date: "2026-04-02", requests: 2, tokens: 1200 },
  { date: "2026-04-03", requests: 0, tokens: 0 },
  { date: "2026-04-04", requests: 1, tokens: 50 },
];

const emptyCalendar: HeatmapUsageDay[] = [
  { date: "2026-04-01", requests: 0, tokens: 0 },
  { date: "2026-04-02", requests: 0, tokens: 0 },
];

describe("heatmapDayHasActivity / heatmapHasSamples", () => {
  it("treats zero-padded calendar rows as no activity", () => {
    expect(heatmapDayHasActivity({ requests: 0, tokens: 0 })).toBe(false);
    expect(heatmapDayHasActivity({ requests: 1, tokens: 0 })).toBe(true);
    expect(heatmapDayHasActivity({ requests: 0, tokens: 10 })).toBe(true);
    expect(heatmapDayHasActivity(null)).toBe(false);
  });

  it("never invents samples from empty or zero-filled lists", () => {
    expect(heatmapHasSamples(null)).toBe(false);
    expect(heatmapHasSamples([])).toBe(false);
    expect(heatmapHasSamples(emptyCalendar)).toBe(false);
    expect(heatmapHasSamples(sampleDays)).toBe(true);
  });
});

describe("summarizeHeatmapRange", () => {
  it("counts honesty over full list", () => {
    const s = summarizeHeatmapRange(sampleDays);
    expect(s).toMatchObject({
      dayCount: 4,
      activeDays: 2,
      totalRequests: 3,
      totalTokens: 1250,
      hasActivity: true,
      isEmptyCalendar: false,
    });
  });

  it("clips to inclusive range without inventing missing days", () => {
    const s = summarizeHeatmapRange(sampleDays, {
      start: "2026-04-02",
      end: "2026-04-03",
    });
    expect(s).toMatchObject({
      dayCount: 2,
      activeDays: 1,
      totalRequests: 2,
      totalTokens: 1200,
      hasActivity: true,
    });
  });

  it("empty calendar summary is honest (not fake quota)", () => {
    const s = summarizeHeatmapRange(emptyCalendar);
    expect(s.hasActivity).toBe(false);
    expect(s.isEmptyCalendar).toBe(true);
    expect(s.totalTokens).toBe(0);
    expect(s.totalRequests).toBe(0);
    expect(heatmapSummaryChips(s)).toBeNull();
  });

  it("range with no activity → empty summary chips null", () => {
    const s = summarizeHeatmapRange(sampleDays, {
      start: "2026-04-01",
      end: "2026-04-01",
    });
    expect(s.hasActivity).toBe(false);
    expect(heatmapSummaryChips(s)).toBeNull();
  });

  it("null / invalid days never invent counts", () => {
    expect(summarizeHeatmapRange(null).dayCount).toBe(0);
    expect(
      summarizeHeatmapRange([
        { date: "", requests: 9, tokens: 9 },
        { date: "2026-01-01", requests: NaN, tokens: -1 },
      ]).hasActivity,
    ).toBe(false);
  });
});

describe("classifyHeatmapError / heatmapErrorView", () => {
  it("classifies host_only | network | empty | other", () => {
    expect(classifyHeatmapError("need tauri")).toBe("host_only");
    expect(classifyHeatmapError({ code: "host_only" })).toBe("host_only");
    expect(classifyHeatmapError("network offline")).toBe("network");
    expect(classifyHeatmapError(new Error("Failed to fetch"))).toBe("network");
    expect(classifyHeatmapError("no activity data under sessions")).toBe(
      "empty",
    );
    expect(classifyHeatmapError({ code: "empty" })).toBe("empty");
    expect(classifyHeatmapError("something weird")).toBe("other");
    expect(classifyHeatmapError(null)).toBe("other");
  });

  it("error view is always soft-fail with i18n keys", () => {
    const v = heatmapErrorView("need_tauri");
    expect(v.softFail).toBe(true);
    expect(v.kind).toBe("host_only");
    expect(v.titleKey).toBe("account.heatmap.err.host_only");
    expect(v.hintKey).toBe("account.heatmap.err.host_onlyHint");
  });

  it("resolveHeatmapErrorChip null when no error", () => {
    expect(resolveHeatmapErrorChip(null)).toBeNull();
    expect(resolveHeatmapErrorChip("")).toBeNull();
    expect(resolveHeatmapErrorChip("offline")?.kind).toBe("network");
  });
});

describe("resolveHeatmapEmptyState", () => {
  it("loading only when no samples yet (keeps grid on refresh)", () => {
    expect(
      resolveHeatmapEmptyState({
        loading: true,
        hasSamples: false,
      })?.kind,
    ).toBe("loading");
    // Existing samples stay visible while refreshing.
    expect(
      resolveHeatmapEmptyState({
        loading: true,
        hasSamples: true,
        error: "network",
      }),
    ).toBeNull();
  });

  it("error soft-fails only when there are no samples (never invent cells)", () => {
    const e = resolveHeatmapEmptyState({
      loading: false,
      hasSamples: false,
      error: "need tauri",
    });
    expect(e?.kind).toBe("error");
    expect(e?.softFail).toBe(true);
    expect(e?.error?.kind).toBe("host_only");
    expect(e?.showClearRange).toBe(false);
    // Error chip belongs in chrome; grid stays if samples exist.
    expect(
      resolveHeatmapEmptyState({
        loading: false,
        hasSamples: true,
        error: "network offline",
      }),
    ).toBeNull();
  });

  it("no_data when loaded without samples (zero calendar is not data)", () => {
    const e = resolveHeatmapEmptyState({
      loading: false,
      hasSamples: false,
    });
    expect(e).toMatchObject({
      kind: "no_data",
      titleKey: "account.heatmap.noData",
      bodyKey: "account.heatmap.noDataHint",
      softFail: true,
    });
  });

  it("range_empty when overall samples exist but range does not", () => {
    const e = resolveHeatmapEmptyState({
      loading: false,
      hasSamples: true,
      range: { start: "2026-04-01", end: "2026-04-01" },
      rangeHasSamples: false,
    });
    expect(e).toMatchObject({
      kind: "range_empty",
      titleKey: "account.heatmap.rangeEmpty",
      showClearRange: true,
      softFail: false,
    });
  });

  it("null when samples exist and no empty range", () => {
    expect(
      resolveHeatmapEmptyState({
        loading: false,
        hasSamples: true,
      }),
    ).toBeNull();
    expect(
      resolveHeatmapEmptyState({
        loading: false,
        hasSamples: true,
        range: { start: "2026-04-02", end: "2026-04-02" },
        rangeHasSamples: true,
      }),
    ).toBeNull();
  });
});

describe("listHeatmapGranularityChips", () => {
  it("orders day · week · cumulative with active state", () => {
    expect(listHeatmapGranularityChips("day")).toEqual([
      { id: "day", labelKey: "account.heatmap.day", active: true },
      { id: "week", labelKey: "account.heatmap.week", active: false },
      {
        id: "cumulative",
        labelKey: "account.heatmap.cumulative",
        active: false,
      },
    ]);
    expect(listHeatmapGranularityChips("week")[1]?.active).toBe(true);
    expect(listHeatmapGranularityChips("cumulative")[2]?.active).toBe(true);
    expect(listHeatmapGranularityChips(null)[0]?.active).toBe(true);
  });
});

describe("heatmapSummaryChips", () => {
  it("exposes honest counts only when activity exists", () => {
    const chips = heatmapSummaryChips(summarizeHeatmapRange(sampleDays));
    expect(chips).toMatchObject({
      activeDays: 2,
      totalTokens: 1250,
      totalRequests: 3,
      activeDaysKey: "account.heatmap.activeDays",
      totalTokensKey: "account.heatmap.totalTokens",
      sessionsKey: "account.heatmap.sessionsCount",
    });
  });
});
