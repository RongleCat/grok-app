import { describe, expect, it } from "vitest";
import {
  estimateCostUsd,
  formatCostUsd,
  normalizeModelIdForRates,
  resolveModelRates,
} from "./estimateCost";

describe("normalizeModelIdForRates", () => {
  it("lowercases, strips provider prefix and variants", () => {
    expect(normalizeModelIdForRates("  XAI/Grok-4.5:latest  ")).toBe(
      "grok-4.5",
    );
    expect(normalizeModelIdForRates("grok-3@rev2")).toBe("grok-3");
    expect(normalizeModelIdForRates("")).toBe(null);
    expect(normalizeModelIdForRates(null)).toBe(null);
  });
});

describe("resolveModelRates", () => {
  it("matches exact and prefix families", () => {
    expect(resolveModelRates("grok-4.5")?.key).toBe("grok-4.5");
    expect(resolveModelRates("grok-4.6")?.key).toBe("grok-4.6");
    expect(resolveModelRates("grok-3-mini-fast")?.key).toBe("grok-3-mini");
    expect(resolveModelRates("provider/grok-2-vision-1212")?.key).toBe(
      "grok-2-vision",
    );
    expect(resolveModelRates("totally-unknown-model")).toBe(null);
  });
});

describe("estimateCostUsd", () => {
  it("returns null total for unknown model (tokens only path)", () => {
    const r = estimateCostUsd(10_000, "mystery-llm");
    expect(r.totalUsd).toBe(null);
    expect(r.precision).toBe("none");
    expect(r.modelKey).toBe(null);
  });

  it("uses input+output rates when both known", () => {
    // 1M in @ $3 + 1M out @ $15 = $18
    const r = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "grok-4.5",
    );
    expect(r.modelKey).toBe("grok-4.5");
    expect(r.basis).toBe("input_output");
    expect(r.precision).toBe("estimate");
    expect(r.inputUsd).toBeCloseTo(3, 6);
    expect(r.outputUsd).toBeCloseTo(15, 6);
    expect(r.totalUsd).toBeCloseTo(18, 6);
  });

  it("uses Grok 4.6 official-style $2/$6 rates", () => {
    const r = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "grok-4.6",
    );
    expect(r.modelKey).toBe("grok-4.6");
    expect(r.inputUsd).toBeCloseTo(2, 6);
    expect(r.outputUsd).toBeCloseTo(6, 6);
    expect(r.totalUsd).toBeCloseTo(8, 6);
  });

  it("accepts a bare total and blends rates", () => {
    // blended (3+15)/2 = 9 per 1M → 100k tokens → $0.9
    const r = estimateCostUsd(100_000, "grok-4.5");
    expect(r.basis).toBe("total_blended");
    expect(r.totalUsd).toBeCloseTo(0.9, 6);
    expect(r.inputUsd).toBe(null);
    expect(r.outputUsd).toBe(null);
  });

  it("handles input-only / output-only", () => {
    const i = estimateCostUsd({ inputTokens: 500_000 }, "grok-3");
    expect(i.basis).toBe("input_only");
    expect(i.totalUsd).toBeCloseTo(1.5, 6);

    const o = estimateCostUsd({ outputTokens: 100_000 }, "grok-3");
    expect(o.basis).toBe("output_only");
    expect(o.totalUsd).toBeCloseTo(1.5, 6);
  });

  it("returns empty dollars when tokens missing but model known", () => {
    const r = estimateCostUsd({}, "grok-4.5");
    expect(r.modelKey).toBe("grok-4.5");
    expect(r.totalUsd).toBe(null);
    expect(r.precision).toBe("none");
  });

  it("ignores negative / non-finite token counts", () => {
    const r = estimateCostUsd(
      { inputTokens: -1, outputTokens: Number.NaN, totalTokens: Infinity },
      "grok-4.5",
    );
    expect(r.totalUsd).toBe(null);
  });
});

describe("formatCostUsd", () => {
  it("uses coarse precision and estimate tilde", () => {
    expect(formatCostUsd(null)).toBe("—");
    expect(formatCostUsd(Number.NaN)).toBe("—");
    expect(formatCostUsd(0)).toBe("~$0");
    expect(formatCostUsd(0.00123)).toBe("~$0.0012");
    expect(formatCostUsd(0.1234)).toBe("~$0.123");
    expect(formatCostUsd(12.345)).toBe("~$12.35");
    expect(formatCostUsd(12.345, false)).toBe("$12.35");
  });
});
