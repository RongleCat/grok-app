import { afterEach, describe, expect, it } from "vitest";
import {
  applySessionSpendTurn,
  clearSessionSpendStore,
  emptySessionSpend,
  formatApiDuration,
  formatExactTokenCount,
  formatUsdFromTicks,
  formatUsageResetTime,
  getSessionSpend,
  hasSessionSpend,
  ingestSessionSpend,
  isSessionSpendBillingSource,
  sessionSpendCacheHitRate,
  usdFromCostTicks,
} from "./sessionSpend";

const turn = {
  source: "turn_completed",
  inputTokens: 127_521,
  outputTokens: 2_554,
  totalTokens: 130_075,
  cachedReadTokens: 69_504,
  reasoningTokens: 1_698,
  modelCalls: 3,
  apiDurationMs: 56_883,
  costUsdTicks: 2_011_100_000,
} as const;

afterEach(() => {
  clearSessionSpendStore();
});

describe("isSessionSpendBillingSource", () => {
  it("accepts turn_completed and rejects occupancy / prompt_result", () => {
    expect(isSessionSpendBillingSource("turn_completed")).toBe(true);
    expect(isSessionSpendBillingSource("response_completed")).toBe(false);
    expect(isSessionSpendBillingSource("turn_usage")).toBe(false);
    expect(isSessionSpendBillingSource("prompt_result")).toBe(false);
    expect(isSessionSpendBillingSource("context_size")).toBe(false);
    expect(isSessionSpendBillingSource("compact")).toBe(false);
    expect(isSessionSpendBillingSource("tokens_used")).toBe(false);
  });
});

describe("applySessionSpendTurn", () => {
  it("sums two billing turns", () => {
    const a = applySessionSpendTurn(emptySessionSpend(), turn, 1_000);
    const b = applySessionSpendTurn(
      a,
      {
        ...turn,
        inputTokens: 150_375,
        outputTokens: 1_619,
        totalTokens: 151_994,
        cachedReadTokens: 96_384,
        reasoningTokens: 856,
        modelCalls: 3,
        apiDurationMs: 39_968,
        costUsdTicks: 1_658_880_000,
      },
      2_000,
    );
    expect(b.inputTokens).toBe(277_896);
    expect(b.outputTokens).toBe(4_173);
    expect(b.totalTokens).toBe(282_069);
    expect(b.cachedReadTokens).toBe(165_888);
    expect(b.reasoningTokens).toBe(2_554);
    expect(b.modelCalls).toBe(6);
    expect(b.apiDurationMs).toBe(96_851);
    expect(b.costUsdTicks).toBe(3_669_980_000);
  });

  it("ignores occupancy events", () => {
    const next = applySessionSpendTurn(
      emptySessionSpend(),
      { source: "context_size", totalTokens: 27_148 },
      1_000,
    );
    expect(hasSessionSpend(next)).toBe(false);
  });

  it("ignores prompt_result so the same turn is not double-counted", () => {
    const once = applySessionSpendTurn(emptySessionSpend(), turn, 1_000);
    const again = applySessionSpendTurn(
      once,
      { ...turn, source: "prompt_result" },
      1_100,
    );
    expect(again).toEqual(once);
  });

  it("dedupes an identical turn_completed replay inside the window", () => {
    const once = applySessionSpendTurn(emptySessionSpend(), turn, 1_000);
    const again = applySessionSpendTurn(once, turn, 1_500);
    expect(again.modelCalls).toBe(3);
    expect(again.inputTokens).toBe(127_521);
  });

  it("accepts a later identical-looking turn after the window", () => {
    const once = applySessionSpendTurn(emptySessionSpend(), turn, 1_000);
    const again = applySessionSpendTurn(once, turn, 5_000);
    expect(again.modelCalls).toBe(6);
  });

  it("does not add cache-heavy fragments that lack modelCalls", () => {
    const once = applySessionSpendTurn(
      emptySessionSpend(),
      {
        source: "turn_completed",
        inputTokens: 65_402,
        outputTokens: 2_268,
        totalTokens: 67_670,
        cachedReadTokens: 46_848,
        reasoningTokens: 762,
        modelCalls: 3,
        apiDurationMs: 44_692,
        costUsdTicks: 741_400_000,
      },
      1_000,
    );
    const again = applySessionSpendTurn(
      once,
      {
        source: "turn_completed",
        inputTokens: 22_887,
        outputTokens: 3_288,
        cachedReadTokens: 97_152,
        reasoningTokens: 1_419,
      },
      1_100,
    );
    expect(again.inputTokens).toBe(65_402);
    expect(again.cachedReadTokens).toBe(46_848);
    expect(again.modelCalls).toBe(3);
    expect(sessionSpendCacheHitRate(again)).toBe(72);
  });

  it("accepts a turn_completed snapshot even when modelCalls is missing", () => {
    const next = applySessionSpendTurn(
      emptySessionSpend(),
      {
        source: "turn_completed",
        inputTokens: 65_402,
        outputTokens: 2_268,
        totalTokens: 67_670,
        cachedReadTokens: 46_848,
      },
      1_000,
    );
    expect(next.inputTokens).toBe(65_402);
    expect(next.cachedReadTokens).toBe(46_848);
    expect(sessionSpendCacheHitRate(next)).toBe(72);
  });

  it("clamps per-turn cache to input", () => {
    const next = applySessionSpendTurn(
      emptySessionSpend(),
      {
        source: "turn_completed",
        inputTokens: 10_000,
        outputTokens: 1,
        totalTokens: 10_001,
        cachedReadTokens: 48_000,
        modelCalls: 1,
      },
      1_000,
    );
    expect(next.cachedReadTokens).toBe(10_000);
  });

  it("marks incomplete / partial flags", () => {
    const next = applySessionSpendTurn(
      emptySessionSpend(),
      { ...turn, usageIsIncomplete: true, costIsPartial: true },
      1_000,
    );
    expect(next.usageIsIncomplete).toBe(true);
    expect(next.costIsPartial).toBe(true);
  });
});

describe("usdFromCostTicks", () => {
  it("maps live journal ticks to TUI-style dollars", () => {
    expect(usdFromCostTicks(2_011_100_000)).toBeCloseTo(2.0111, 6);
    expect(formatUsdFromTicks(3_200_100_000)).toBe("$3.2001");
    expect(formatUsdFromTicks(null)).toBeNull();
  });
});

describe("formatApiDuration", () => {
  it("matches TUI 1m28s / seconds / hours", () => {
    expect(formatApiDuration(88_000)).toBe("1m28s");
    expect(formatApiDuration(56_000)).toBe("56s");
    expect(formatApiDuration(3_600_000)).toBe("1h");
    expect(formatApiDuration(3_723_000)).toBe("1h2m3s");
    expect(formatApiDuration(0)).toBe("—");
    expect(formatApiDuration(null)).toBe("—");
  });
});

describe("sessionSpendCacheHitRate", () => {
  it("is cached / input, capped at 100", () => {
    expect(
      sessionSpendCacheHitRate({
        inputTokens: 3_080_038,
        cachedReadTokens: 3_057_664,
      }),
    ).toBe(99);
    expect(
      sessionSpendCacheHitRate({
        inputTokens: 5_103_343,
        cachedReadTokens: 7_448_832,
      }),
    ).toBe(100);
    expect(
      sessionSpendCacheHitRate({ inputTokens: 0, cachedReadTokens: 10 }),
    ).toBeNull();
  });
});

describe("formatExactTokenCount", () => {
  it("uses locale grouping", () => {
    expect(formatExactTokenCount(3_080_038, "en")).toBe("3,080,038");
  });
});

describe("formatUsageResetTime", () => {
  it("formats a local 24h clock", () => {
    const iso = new Date(2026, 7, 14, 14, 5, 0).toISOString();
    expect(formatUsageResetTime(iso, "en")).toBe("August 14, 14:05");
  });

  it("returns empty for missing / invalid", () => {
    expect(formatUsageResetTime(null)).toBe("");
    expect(formatUsageResetTime("nope")).toBe("");
  });
});

describe("ingestSessionSpend store", () => {
  it("keeps sessions isolated", () => {
    ingestSessionSpend("a", turn, 1_000);
    ingestSessionSpend(
      "b",
      { source: "turn_completed", modelCalls: 1, inputTokens: 10 },
      1_000,
    );
    expect(getSessionSpend("a").modelCalls).toBe(3);
    expect(getSessionSpend("b").modelCalls).toBe(1);
    expect(getSessionSpend("missing").modelCalls).toBe(0);
  });
});
