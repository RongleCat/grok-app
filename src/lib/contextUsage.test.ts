import { describe, expect, it } from "vitest";
import {
  buildCompactSlashCommand,
  estimateContextBreakdown,
  estimateTokensFromMessages,
  estimateTokensFromText,
  formatContextChipLabel,
  formatTokenCount,
  hydrateContextUsageFromMessages,
  INITIAL_CONTEXT_USAGE,
  mergeCompactTokensBefore,
  isSystemLikeMessage,
  isToolActivityMessage,
  mergeKnownBucketsIntoBreakdown,
  reduceContextUsage,
  resolveContextUsageDisplay,
} from "./contextUsage";

describe("formatTokenCount", () => {
  it("handles edge and Chinese scale bands (百/千/万/亿)", () => {
    expect(formatTokenCount(-1)).toBe("—");
    expect(formatTokenCount(NaN)).toBe("—");
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(100)).toBe("1百");
    expect(formatTokenCount(500)).toBe("5百");
    expect(formatTokenCount(999)).toBe("10百");
    expect(formatTokenCount(1000)).toBe("1千");
    expect(formatTokenCount(1500)).toBe("1.5千");
    expect(formatTokenCount(10_000)).toBe("1万");
    expect(formatTokenCount(12_400)).toBe("1.2万");
    expect(formatTokenCount(1_000_000)).toBe("100万");
    expect(formatTokenCount(1_500_000)).toBe("150万");
  });

  it("uses 萬/億 for zh-TW", () => {
    expect(formatTokenCount(12_400, "zh-TW")).toBe("1.2萬");
    expect(formatTokenCount(100_000_000, "zh-TW")).toBe("1億");
    expect(formatTokenCount(1_000_000, "zh-TW")).toBe("100萬");
  });
});

describe("formatContextChipLabel", () => {
  it("prefixes estimate and uses em dash when unknown", () => {
    expect(formatContextChipLabel(null, "unknown")).toBe("—");
    expect(formatContextChipLabel(1200, "known")).toBe("1.2千");
    expect(formatContextChipLabel(1200, "estimated")).toBe("~1.2千");
    expect(formatContextChipLabel(12_000, "known", "zh-TW")).toBe("1.2萬");
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

describe("estimateContextBreakdown", () => {
  it("splits user / assistant / thought with ceil(chars/4)", () => {
    const b = estimateContextBreakdown([
      { id: "u", role: "user", content: "a".repeat(8) }, // 2
      {
        id: "a",
        role: "assistant",
        content: "b".repeat(12), // 3
        thought: "c".repeat(4), // 1
      },
      {
        id: "t",
        role: "tool",
        content: "d".repeat(8), // tools: 2
        marker: "tool_step",
      },
    ]);
    expect(b.userTokens).toBe(2);
    expect(b.assistantTokens).toBe(3);
    expect(b.thoughtTokens).toBe(1);
    expect(b.toolsTokens).toBe(2);
    expect(b.systemTokens).toBe(0);
    expect(b.historyTokens).toBe(6); // user+assistant+thought rollup
    expect(b.totalTokens).toBe(8); // + tools; history not double-counted
    expect(b.estimated).toBe(true);
  });

  it("classifies system-like and tool/activity messages", () => {
    const b = estimateContextBreakdown([
      { id: "sys", role: "system", content: "a".repeat(8) }, // system 2
      { id: "u", role: "user", content: "b".repeat(4) }, // user 1
      {
        id: "a",
        role: "assistant",
        content: "c".repeat(4), // assistant 1
        thought: "d".repeat(8), // thought 2
      },
      {
        id: "t",
        role: "tool",
        content: "e".repeat(12), // tools 3
        marker: "tool_step",
      },
      {
        id: "act",
        role: "activity",
        content: "f".repeat(4), // tools 1
      },
      {
        id: "c",
        role: "tool",
        marker: "context_compact",
        content: "ignored".repeat(50),
      },
      {
        id: "x",
        role: "tool",
        marker: "turn_cancelled",
        content: "ignored".repeat(50),
      },
    ]);
    expect(b.systemTokens).toBe(2);
    expect(b.userTokens).toBe(1);
    expect(b.assistantTokens).toBe(1);
    expect(b.thoughtTokens).toBe(2);
    expect(b.toolsTokens).toBe(4);
    expect(b.historyTokens).toBe(4); // 1+1+2
    expect(b.totalTokens).toBe(10); // 1+1+2+2+4
    expect(b.estimated).toBe(true);
  });

  it("returns zeros for empty transcript (tools-only still counts tools)", () => {
    const empty = estimateContextBreakdown([]);
    expect(empty).toEqual({
      userTokens: 0,
      assistantTokens: 0,
      thoughtTokens: 0,
      systemTokens: 0,
      toolsTokens: 0,
      historyTokens: 0,
      totalTokens: 0,
      estimated: true,
    });

    const toolsOnly = estimateContextBreakdown([
      { id: "t", role: "tool", content: "abcd", marker: "tool_step" },
    ]);
    expect(toolsOnly.toolsTokens).toBe(1);
    expect(toolsOnly.userTokens).toBe(0);
    expect(toolsOnly.totalTokens).toBe(1);
    expect(toolsOnly.historyTokens).toBe(0);
  });
});

describe("isToolActivityMessage / isSystemLikeMessage", () => {
  it("identifies tool_step, tool role, activity; excludes compact chrome", () => {
    expect(
      isToolActivityMessage({
        id: "1",
        role: "tool",
        marker: "tool_step",
        content: "x",
      }),
    ).toBe(true);
    expect(
      isToolActivityMessage({ id: "2", role: "activity", content: "y" }),
    ).toBe(true);
    expect(
      isToolActivityMessage({
        id: "3",
        role: "tool",
        marker: "context_compact",
        content: "z",
      }),
    ).toBe(false);
    expect(
      isSystemLikeMessage({ id: "4", role: "system", content: "sys" }),
    ).toBe(true);
    expect(
      isSystemLikeMessage({
        id: "5",
        role: "assistant",
        marker: "system_prompt",
        content: "p",
      }),
    ).toBe(true);
    expect(
      isSystemLikeMessage({ id: "6", role: "user", content: "hi" }),
    ).toBe(false);
  });
});

describe("mergeKnownBucketsIntoBreakdown", () => {
  it("prefers agent system/tools/history without inventing missing fields", () => {
    const est = estimateContextBreakdown([
      { id: "u", role: "user", content: "abcd" }, // 1
      {
        id: "t",
        role: "tool",
        content: "efgh",
        marker: "tool_step",
      }, // tools 1
    ]);
    const merged = mergeKnownBucketsIntoBreakdown(est, {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      systemTokens: 50,
      toolsTokens: 30,
      historyTokens: null,
    });
    expect(merged?.systemTokens).toBe(50);
    expect(merged?.toolsTokens).toBe(30);
    // history stays estimated rollup when agent did not report it
    expect(merged?.historyTokens).toBe(1);
    expect(merged?.knownBuckets).toEqual({
      system: true,
      tools: true,
      history: undefined,
    });
    expect(merged?.userTokens).toBe(1);
  });

  it("builds breakdown from known buckets alone", () => {
    const merged = mergeKnownBucketsIntoBreakdown(null, {
      inputTokens: null,
      outputTokens: null,
      totalTokens: 9000,
      systemTokens: 800,
      toolsTokens: 1200,
      historyTokens: 7000,
    });
    expect(merged).toMatchObject({
      systemTokens: 800,
      toolsTokens: 1200,
      historyTokens: 7000,
      totalTokens: 9000, // history + system + tools when no role sum
      estimated: false,
      knownBuckets: { system: true, tools: true, history: true },
    });
  });
});

describe("reduceContextUsage", () => {
  it("reset returns initial", () => {
    const s = reduceContextUsage(
      {
        knownTokens: 100,
        lastCompactMessageId: "c1",
        lastCompact: { trigger: "auto", tokensAfter: 100 },
        knownUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
      { type: "reset" },
    );
    expect(s).toEqual(INITIAL_CONTEXT_USAGE);
  });

  it("usage stores agent-reported totals", () => {
    const s = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      systemTokens: 10,
      toolsTokens: 20,
      historyTokens: 120,
      source: "usage",
    });
    expect(s.knownTokens).toBe(150);
    expect(s.knownUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      systemTokens: 10,
      toolsTokens: 20,
      historyTokens: 120,
      source: "usage",
    });
    expect(s.lastCompactMessageId).toBeNull();
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
    expect(d.breakdown).toBeNull();
  });

  it("estimates from messages when never compacted", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [
      { id: "u", role: "user", content: "a".repeat(40) }, // 10 tokens
    ]);
    expect(d.source).toBe("estimated");
    expect(d.tokens).toBe(10);
    expect(d.label).toBe("~10");
    expect(d.breakdown).toEqual({
      userTokens: 10,
      assistantTokens: 0,
      thoughtTokens: 0,
      systemTokens: 0,
      toolsTokens: 0,
      historyTokens: 10,
      totalTokens: 10,
      estimated: true,
    });
  });

  it("includes role breakdown on estimated multi-role transcript", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [
      { id: "u", role: "user", content: "abcd" }, // 1
      {
        id: "a",
        role: "assistant",
        content: "efgh", // 1
        thought: "ijkl", // 1
      },
    ]);
    expect(d.source).toBe("estimated");
    expect(d.breakdown?.userTokens).toBe(1);
    expect(d.breakdown?.assistantTokens).toBe(1);
    expect(d.breakdown?.thoughtTokens).toBe(1);
    expect(d.breakdown?.historyTokens).toBe(3);
    expect(d.breakdown?.systemTokens).toBe(0);
    expect(d.breakdown?.toolsTokens).toBe(0);
    expect(d.breakdown?.estimated).toBe(true);
  });

  it("surfaces agent-reported system/tools/history without tilde path", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 9000,
      systemTokens: 800,
      toolsTokens: 1200,
      historyTokens: 7000,
      source: "usage",
    });
    const d = resolveContextUsageDisplay(state, []);
    expect(d.source).toBe("known");
    expect(d.tokens).toBe(9000);
    expect(d.breakdown?.systemTokens).toBe(800);
    expect(d.breakdown?.toolsTokens).toBe(1200);
    expect(d.breakdown?.historyTokens).toBe(7000);
    expect(d.breakdown?.knownBuckets).toEqual({
      system: true,
      tools: true,
      history: true,
    });
    expect(d.breakdown?.estimated).toBe(false);
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
    expect(d.label).toBe("4万");
    // No visible user/assistant content → no breakdown rows
    expect(d.breakdown).toBeNull();
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
    expect(d.breakdown?.userTokens).toBe(1);
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
    // Visible split still available as estimated free/unknown note path
    expect(d.breakdown?.userTokens).toBe(100);
    expect(d.breakdown?.estimated).toBe(true);
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

describe("mergeCompactTokensBefore", () => {
  it("prefers agent-reported tokensBefore over UI estimate", () => {
    expect(mergeCompactTokensBefore(120_000, 99_000)).toBe(120_000);
    expect(mergeCompactTokensBefore(0, 50)).toBe(0);
  });

  it("falls back to UI estimate when agent omits before", () => {
    expect(mergeCompactTokensBefore(undefined, 42_000)).toBe(42_000);
    expect(mergeCompactTokensBefore(null, 100)).toBe(100);
    expect(mergeCompactTokensBefore(NaN, 10)).toBe(10);
  });

  it("returns undefined when both missing or invalid", () => {
    expect(mergeCompactTokensBefore(undefined, null)).toBeUndefined();
    expect(mergeCompactTokensBefore(-1, -5)).toBeUndefined();
  });
});

describe("buildCompactSlashCommand", () => {
  it("omits note when empty or whitespace", () => {
    expect(buildCompactSlashCommand("")).toBe("/compact");
    expect(buildCompactSlashCommand("   ")).toBe("/compact");
  });

  it("appends trimmed note", () => {
    expect(buildCompactSlashCommand(" keep decisions ")).toBe(
      "/compact keep decisions",
    );
  });
});
