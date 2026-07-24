import { describe, expect, it } from "vitest";
import {
  estimateTokensFromMessages,
  estimateTokensFromText,
  formatContextChipLabel,
  formatTokenCount,
  hydrateContextUsageFromMessages,
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  resolveContextUsageDisplay,
} from "./contextUsage";

describe("formatTokenCount", () => {
  it("handles edge and scale bands", () => {
    expect(formatTokenCount(-1)).toBe("—");
    expect(formatTokenCount(NaN)).toBe("—");
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(10_000)).toBe("10k");
    expect(formatTokenCount(12_400)).toBe("12k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});

describe("formatContextChipLabel", () => {
  it("prefixes estimate and uses em dash when unknown", () => {
    expect(formatContextChipLabel(null, "unknown")).toBe("—");
    expect(formatContextChipLabel(1200, "known")).toBe("1.2k");
    expect(formatContextChipLabel(1200, "estimated")).toBe("~1.2k");
  });
});

describe("estimateTokensFromText / messages", () => {
  it("uses ceil(chars/4)", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
  });

  it("sums user/assistant only", () => {
    const n = estimateTokensFromMessages([
      { id: "u", role: "user", content: "abcd" }, // 1
      { id: "a", role: "assistant", content: "efgh", thought: "ijkl" }, // 2
      {
        id: "t",
        role: "tool",
        content: "context_compact",
        marker: "context_compact",
      },
      { id: "tool", role: "tool", content: "tool_step|x", marker: "tool_step" },
    ]);
    expect(n).toBe(3);
  });
});

describe("reduceContextUsage", () => {
  it("reset returns initial", () => {
    const s = reduceContextUsage(
      {
        knownTokens: 100,
        lastCompactMessageId: "c1",
        lastCompact: { trigger: "auto", tokensAfter: 100 },
      },
      { type: "reset" },
    );
    expect(s).toEqual(INITIAL_CONTEXT_USAGE);
  });

  it("compact stores tokensAfter as known", () => {
    const s = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      trigger: "manual",
      tokensBefore: 1000,
      tokensAfter: 400,
      messageId: "c1",
      summaryPreview: "kept auth",
    });
    expect(s.knownTokens).toBe(400);
    expect(s.lastCompactMessageId).toBe("c1");
    expect(s.lastCompact?.trigger).toBe("manual");
    expect(s.lastCompact?.tokensBefore).toBe(1000);
    expect(s.lastCompact?.summaryPreview).toBe("kept auth");
  });

  it("compact without tokens clears knownTokens (honest unknown)", () => {
    const base = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      tokensAfter: 500,
      messageId: "c0",
    });
    const s = reduceContextUsage(base, {
      type: "compact",
      trigger: "auto",
      messageId: "c1",
    });
    expect(s.knownTokens).toBeNull();
    expect(s.lastCompactMessageId).toBe("c1");
    expect(s.lastCompact?.tokensAfter).toBeUndefined();
  });

  it("hydrate picks latest compact marker", () => {
    const s = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "hydrate",
      messages: [
        {
          id: "c1",
          role: "tool",
          marker: "context_compact",
          compactMeta: {
            trigger: "auto",
            tokensBefore: 900,
            tokensAfter: 300,
          },
        },
        { id: "u", role: "user", content: "hi" },
        {
          id: "c2",
          role: "tool",
          marker: "context_compact",
          compactMeta: {
            trigger: "manual",
            tokensBefore: 800,
            tokensAfter: 200,
          },
        },
      ],
    });
    expect(s.knownTokens).toBe(200);
    expect(s.lastCompactMessageId).toBe("c2");
    expect(s.lastCompact?.trigger).toBe("manual");
  });
});

describe("resolveContextUsageDisplay", () => {
  it("empty session is unknown", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, []);
    expect(d.source).toBe("unknown");
    expect(d.label).toBe("—");
    expect(d.tokens).toBeNull();
  });

  it("estimates from messages when never compacted", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [
      { id: "u", role: "user", content: "a".repeat(40) }, // 10 tokens
    ]);
    expect(d.source).toBe("estimated");
    expect(d.tokens).toBe(10);
    expect(d.label).toBe("~10");
  });

  it("uses known tokens after compact with no further messages", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      tokensAfter: 40_000,
      messageId: "c1",
      tokensBefore: 120_000,
    });
    const d = resolveContextUsageDisplay(state, [
      {
        id: "c1",
        role: "tool",
        marker: "context_compact",
        compactMeta: { tokensAfter: 40_000 },
      },
    ]);
    expect(d.source).toBe("known");
    expect(d.tokens).toBe(40_000);
    expect(d.label).toBe("40k");
  });

  it("adds post-compact estimate with ~ prefix", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      tokensAfter: 100,
      messageId: "c1",
    });
    const d = resolveContextUsageDisplay(state, [
      { id: "c1", role: "tool", marker: "context_compact" },
      { id: "u", role: "user", content: "abcd" }, // +1
    ]);
    expect(d.source).toBe("estimated");
    expect(d.tokens).toBe(101);
    expect(d.label.startsWith("~")).toBe(true);
  });

  it("compact without tokens stays unknown (no full-history estimate)", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      trigger: "manual",
      messageId: "c1",
    });
    // knownTokens stays null; lastCompact set
    expect(state.knownTokens).toBeNull();
    const d = resolveContextUsageDisplay(state, [
      { id: "c1", role: "tool", marker: "context_compact" },
      { id: "u", role: "user", content: "a".repeat(400) },
    ]);
    expect(d.source).toBe("unknown");
    expect(d.label).toBe("—");
    expect(d.lastCompact?.trigger).toBe("manual");
  });
});

describe("hydrateContextUsageFromMessages", () => {
  it("returns initial when no compact rows", () => {
    expect(
      hydrateContextUsageFromMessages([
        { id: "u", role: "user", content: "hi" },
      ]),
    ).toEqual(INITIAL_CONTEXT_USAGE);
  });
});
