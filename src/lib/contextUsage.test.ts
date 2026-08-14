import { describe, expect, it } from "vitest";
import {
  breakdownHasSignal,
  buildCompactSlashCommand,
  COMPACT_PRESET_CLI_INTENSITY,
  COMPACT_PRESET_IDS,
  DEFAULT_COMPACT_PRESET,
  estimateCompactAfterTokens,
  estimateContextBreakdown,
  estimateTokensFromMessages,
  estimateTokensFromText,
  formatCompactBeforeAfterRange,
  formatContextChipLabel,
  formatTokenCount,
  hasContextUsageData,
  hydrateContextUsageFromMessages,
  INITIAL_CONTEXT_USAGE,
  isCompactPresetId,
  isSystemLikeMessage,
  isToolActivityMessage,
  knownUsageHasSignal,
  knownUsageTotalIsOccupancy,
  isLikelyBillingAggregateUsage,
  isOccupancyUsageSource,
  mergeCompactTokensBefore,
  mergeKnownBucketsIntoBreakdown,
  contextPercent,
  contextPercentCliStyle,
  reduceContextUsage,
  resolveCompactNoteBody,
  resolveContextUsageDisplay,
  resolveContextUsageSurface,
  resolveOccupancyPercent,
  resolveOccupancyWindow,
  isContextCompactContent,
  isContextCompactMessage,
  saveSessionUsageSnapshot,
  loadSessionUsageSnapshot,
  clearSessionUsageSnapshot,
  restoreContextUsageForSession,
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

describe("contextPercent", () => {
  it("returns null when tokens or window is unknown", () => {
    expect(contextPercent(null, 200_000)).toBeNull();
    expect(contextPercent(0, 200_000)).toBeNull();
    expect(contextPercent(1_000, null)).toBeNull();
    expect(contextPercent(1_000, 0)).toBeNull();
  });

  it("never flattens tiny real usage to an integer 0%", () => {
    expect(contextPercent(50, 200_000)).toBe(0.03);
    expect(contextPercent(1, 200_000)).toBe(0.01);
    expect(contextPercent(1, 1_000_000)).toBe(0.01);
  });

  it("keeps sub-10% decimals and whole percents", () => {
    expect(contextPercent(1_000, 200_000)).toBe(0.5);
    expect(contextPercent(2_000, 200_000)).toBe(1);
    expect(contextPercent(120_000, 200_000)).toBe(60);
    expect(contextPercent(180_000, 200_000)).toBe(90);
  });

  it("caps at 100", () => {
    expect(contextPercent(400_000, 200_000)).toBe(100);
  });
});

describe("estimateTokensFromText / messages", () => {
  it("uses ceil(chars/4) for latin text", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
  });

  it("uses ~1.5 chars/token for CJK text (not 4)", () => {
    expect(estimateTokensFromText("你好世界")).toBe(3); // 4字 / 1.5 = 2.67 → 3
    expect(estimateTokensFromText("我们正在排查上下文统计")).toBe(8); // 11字/1.5 = 7.33 → 8
  });

  it("sums user/assistant/tool content, skips journal chrome only", () => {
    const n = estimateTokensFromMessages([
      { id: "u", role: "user", content: "abcd" }, // 1
      { id: "a", role: "assistant", content: "efgh", thought: "ijkl" }, // 2
      {
        id: "t",
        role: "tool",
        content: "context_compact",
        marker: "context_compact",
      }, // skipped chrome
      { id: "tool", role: "tool", content: "abcd", marker: "tool_step" }, // 1 (tool content counts)
    ]);
    expect(n).toBe(4);
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
        agentContextWindow: 500_000,
        agentPercentage: 81,
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
      cachedReadTokens: null,
      cacheCreationTokens: null,
      reasoningTokens: null,
      costUsdTicks: null,
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

describe("hasContextUsageData / resolveContextUsageSurface", () => {
  it("hides brand-new empty sessions (no — chip)", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, []);
    expect(hasContextUsageData(d)).toBe(false);
    expect(resolveContextUsageSurface(d)).toBe("hidden");
  });

  it("is visible once estimated or known tokens exist", () => {
    const estimated = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [
      { id: "u", role: "user", content: "a".repeat(40) },
    ]);
    expect(hasContextUsageData(estimated)).toBe(true);
    expect(resolveContextUsageSurface(estimated)).toBe("visible");

    const known = resolveContextUsageDisplay(
      reduceContextUsage(INITIAL_CONTEXT_USAGE, {
        type: "usage",
        totalTokens: 1200,
      }),
      [],
    );
    expect(hasContextUsageData(known)).toBe(true);
    expect(resolveContextUsageSurface(known)).toBe("visible");
  });

  it("soft-fails when compact left tokens unknown (still surfaces —)", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "compact",
      trigger: "manual",
      messageId: "c1",
    });
    const d = resolveContextUsageDisplay(state, [
      { id: "c1", role: "tool", marker: "context_compact" },
    ]);
    expect(d.source).toBe("unknown");
    expect(d.tokens).toBeNull();
    expect(d.label).toBe("—");
    // Soft-fail honesty: show muted chip so user can re-compact / read detail.
    expect(hasContextUsageData(d)).toBe(true);
    expect(resolveContextUsageSurface(d)).toBe("soft_unknown");
  });

  it("soft-fails on partial agent usage without a total", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      inputTokens: 500,
      // no output, no total
    });
    const d = resolveContextUsageDisplay(state, []);
    expect(d.tokens).toBeNull();
    expect(d.source).toBe("unknown");
    expect(knownUsageHasSignal(d.knownUsage)).toBe(true);
    expect(resolveContextUsageSurface(d)).toBe("soft_unknown");
    expect(hasContextUsageData(d)).toBe(true);
  });
});

describe("breakdownHasSignal", () => {
  it("is false for pure-zero estimates", () => {
    expect(
      breakdownHasSignal({
        userTokens: 0,
        assistantTokens: 0,
        thoughtTokens: 0,
        systemTokens: 0,
        toolsTokens: 0,
        historyTokens: 0,
        totalTokens: 0,
        estimated: true,
      }),
    ).toBe(false);
    expect(breakdownHasSignal(null)).toBe(false);
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
    expect(resolveContextUsageSurface(d)).toBe("soft_unknown");
  });

  it("tools-only transcript soft-falls back to breakdown total as estimated", () => {
    const d = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [
      {
        id: "t",
        role: "tool",
        content: "a".repeat(40), // 10 tokens in tools bucket
        marker: "tool_step",
      },
    ]);
    // Chip total heuristic skips tools; pro path uses breakdown total.
    expect(d.source).toBe("estimated");
    expect(d.tokens).toBe(10);
    expect(d.label.startsWith("~")).toBe(true);
    expect(d.breakdown?.toolsTokens).toBe(10);
    expect(d.breakdown?.userTokens).toBe(0);
    expect(hasContextUsageData(d)).toBe(true);
  });

  it("known total without role split has null breakdown", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 9000,
    });
    const d = resolveContextUsageDisplay(state, []);
    expect(d.source).toBe("known");
    expect(d.breakdown).toBeNull();
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

  it("does not emit intensity flags while CLI support is off", () => {
    expect(COMPACT_PRESET_CLI_INTENSITY).toBe(false);
    expect(
      buildCompactSlashCommand("keep auth", { preset: "aggressive" }),
    ).toBe("/compact keep auth");
    expect(buildCompactSlashCommand("", { preset: "light" })).toBe(
      "/compact",
    );
  });
});

describe("compact presets", () => {
  it("exposes light / standard / aggressive with standard default", () => {
    expect(COMPACT_PRESET_IDS).toEqual(["light", "standard", "aggressive"]);
    expect(DEFAULT_COMPACT_PRESET).toBe("standard");
    expect(isCompactPresetId("light")).toBe(true);
    expect(isCompactPresetId("standard")).toBe(true);
    expect(isCompactPresetId("aggressive")).toBe(true);
    expect(isCompactPresetId("heavy")).toBe(false);
    expect(isCompactPresetId("")).toBe(false);
  });

  it("estimates after tokens with honest keep ratios (aggressive < standard < light)", () => {
    expect(estimateCompactAfterTokens(null, "standard")).toBeNull();
    expect(estimateCompactAfterTokens(0, "standard")).toBeNull();
    expect(estimateCompactAfterTokens(-10, "light")).toBeNull();
    const light = estimateCompactAfterTokens(100_000, "light")!;
    const standard = estimateCompactAfterTokens(100_000, "standard")!;
    const aggressive = estimateCompactAfterTokens(100_000, "aggressive")!;
    expect(aggressive).toBeLessThan(standard);
    expect(standard).toBeLessThan(light);
    expect(light).toBe(55_000);
    expect(standard).toBe(35_000);
    expect(aggressive).toBe(15_000);
    // Tiny contexts still yield at least 1 token estimate.
    expect(estimateCompactAfterTokens(1, "aggressive")).toBe(1);
  });

  it("resolveCompactNoteBody prefers field text over preset template", () => {
    expect(resolveCompactNoteBody("", "template keep")).toBe("template keep");
    expect(resolveCompactNoteBody("  custom  ", "template keep")).toBe(
      "custom",
    );
    expect(resolveCompactNoteBody("   ", "  ")).toBe("");
    expect(resolveCompactNoteBody("", null)).toBe("");
  });

  it("formatCompactBeforeAfterRange fills template with ~ for estimates", () => {
    expect(
      formatCompactBeforeAfterRange(12_000, 4_000, {
        beforeEstimated: true,
        afterEstimated: true,
        locale: "en",
        template: "{before} → {after}",
      }),
    ).toBe("~1.2万 → ~4千");
    expect(
      formatCompactBeforeAfterRange(10_000, null, {
        beforeEstimated: false,
        afterEstimated: true,
        locale: "zh",
        template: "{before} → {after}",
      }),
    ).toBe("1万 → —");
    expect(
      formatCompactBeforeAfterRange(null, null, {
        template: "{before} → {after}",
      }),
    ).toBeNull();
  });
});

describe("session usage snapshot (localStorage-backed)", () => {
  function mockStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    } as Storage;
  }

  it("saves and loads a per-session snapshot", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot(
      "sess-1",
      {
        totalTokens: 780_341,
        inputTokens: 775_187,
        outputTokens: 5_000,
        systemTokens: null,
        toolsTokens: null,
        historyTokens: null,
        cachedReadTokens: 600_000,
        costUsdTicks: null,
        source: "turn_completed",
      },
      st,
    );
    const snap = loadSessionUsageSnapshot("sess-1", st);
    expect(snap?.totalTokens).toBe(780_341);
    expect(snap?.source).toBe("turn_completed");
    expect(snap?.updatedAt).toBeGreaterThan(0);
    // Other sessions unaffected.
    expect(loadSessionUsageSnapshot("sess-2", st)).toBeNull();
  });

  it("overwrites on newer event and clears on demand", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot("sess-1", { totalTokens: 100, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "usage" }, st);
    saveSessionUsageSnapshot("sess-1", { totalTokens: 250, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "compact" }, st);
    expect(loadSessionUsageSnapshot("sess-1", st)?.totalTokens).toBe(250);
    clearSessionUsageSnapshot("sess-1", st);
    expect(loadSessionUsageSnapshot("sess-1", st)).toBeNull();
  });

  it("restoreContextUsageForSession prefers compact markers over snapshot", () => {
    const st = mockStorage();
    saveSessionUsageSnapshot("sess-c", { totalTokens: 900_000, inputTokens: null, outputTokens: null, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: null, costUsdTicks: null, source: "turn_completed" }, st);
    // Journal has a compact marker with tokensAfter=12_000 — authoritative.
    const state = restoreContextUsageForSession(
      "sess-c",
      [
        { id: "u", role: "user", content: "hi" },
        { id: "c", role: "tool", content: "context_compact", marker: "context_compact", compactMeta: { tokensAfter: 12_000 } },
      ],
      st,
    );
    expect(state.knownTokens).toBe(12_000);
    // Snapshot still retrievable but not used.
    expect(loadSessionUsageSnapshot("sess-c", st)?.totalTokens).toBe(900_000);
  });

  it("restoreContextUsageForSession keeps billing snapshot off the occupancy ring", () => {
    const st = mockStorage();
    // Real Grok shape: turn_completed multi-call sum must not drive the ring.
    saveSessionUsageSnapshot("sess-n", { totalTokens: 1_701_340, inputTokens: 1_681_484, outputTokens: 19_856, systemTokens: null, toolsTokens: null, historyTokens: null, cachedReadTokens: 1_581_440, costUsdTicks: null, source: "turn_completed" }, st);
    const state = restoreContextUsageForSession(
      "sess-n",
      [{ id: "u", role: "user", content: "hi" }],
      st,
    );
    // Billing fields still available for cache/cost UI.
    expect(state.knownUsage?.totalTokens).toBe(1_701_340);
    expect(state.knownUsage?.source).toBe("turn_completed");
    // Occupancy stays unset — ring falls back to estimate, not 340% of window.
    expect(state.knownTokens).toBeNull();
    const display = resolveContextUsageDisplay(state, [{ id: "u", role: "user", content: "hi" }], "zh", 500_000);
    expect(display.source).toBe("estimated");
    expect(display.tokens).toBeLessThan(100);
    expect((display.percent ?? 0) < 1).toBe(true);
  });

  it("treats prompt_result as billing so occupancy is not overwritten", () => {
    expect(
      isLikelyBillingAggregateUsage({
        source: "prompt_result",
        totalTokens: 1_701_340,
        inputTokens: 1_681_484,
        cachedReadTokens: 1_581_440,
      }),
    ).toBe(true);
  });

  it("context_size occupancy drives the ring; turn_completed billing does not overwrite it", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    expect(state.knownTokens).toBe(156_385);
    // Agentic turn ends with multi-call billing (19 modelCalls).
    state = reduceContextUsage(state, {
      type: "usage",
      totalTokens: 1_701_340,
      inputTokens: 1_681_484,
      outputTokens: 19_856,
      cachedReadTokens: 1_581_440,
      source: "turn_completed",
    });
    expect(state.knownTokens).toBe(156_385);
    expect(state.knownUsage?.totalTokens).toBe(1_701_340);
    const d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.tokens).toBe(156_385);
    expect(d.source).toBe("known");
    // CLI integer %: round(156385/500000*100) = 31
    expect(d.percent).toBe(31);
  });

  it("restores CLI context window + percentage from snapshot", () => {
    const st = mockStorage();
    // auto_compact_started occupancy with CLI denominator + integer %.
    saveSessionUsageSnapshot(
      "sess-w",
      {
        totalTokens: 402_603,
        inputTokens: null,
        outputTokens: null,
        systemTokens: null,
        toolsTokens: null,
        historyTokens: null,
        cachedReadTokens: null,
        costUsdTicks: null,
        contextWindow: 500_000,
        percentage: 81,
        source: "auto_compact_started",
      },
      st,
    );
    const state = restoreContextUsageForSession(
      "sess-w",
      [{ id: "u", role: "user", content: "hi" }],
      st,
    );
    expect(state.knownTokens).toBe(402_603);
    expect(state.agentContextWindow).toBe(500_000);
    expect(state.agentPercentage).toBe(81);
    // Ring % matches the CLI integer, not a catalog-window re-derivation.
    const d = resolveContextUsageDisplay(state, [], "zh", 128_000);
    expect(d.percent).toBe(81);
  });
});

describe("occupancy vs billing classification", () => {
  it("classifies stream meta and turn_completed correctly", () => {
    expect(isOccupancyUsageSource("context_size")).toBe(true);
    expect(isOccupancyUsageSource("auto_compact_started")).toBe(true);
    expect(isOccupancyUsageSource("turn_completed")).toBe(false);
    expect(
      isLikelyBillingAggregateUsage({
        source: "turn_completed",
        totalTokens: 1_701_340,
        inputTokens: 1_681_484,
        cachedReadTokens: 1_581_440,
      }),
    ).toBe(true);
    expect(
      knownUsageTotalIsOccupancy({
        inputTokens: null,
        outputTokens: null,
        totalTokens: 27_148,
        source: "context_size",
      }),
    ).toBe(true);
    expect(
      knownUsageTotalIsOccupancy({
        inputTokens: 1_681_484,
        outputTokens: 19_856,
        totalTokens: 1_701_340,
        cachedReadTokens: 1_581_440,
        source: "turn_completed",
      }),
    ).toBe(false);
  });
});

describe("isContextCompactContent / isContextCompactMessage", () => {
  it("accepts structured journal markers only", () => {
    expect(isContextCompactContent("context_compact")).toBe(true);
    expect(isContextCompactContent("context_compact|manual")).toBe(true);
    expect(
      isContextCompactContent("context_compact|auto|tokens:100->40\nkept"),
    ).toBe(true);
    expect(isContextCompactContent("context_compact\nsummary")).toBe(true);
  });

  it("rejects tool titles that merely contain the word compact", () => {
    expect(
      isContextCompactContent("Execute print('ALL POSTS compact') finished"),
    ).toBe(false);
    expect(isContextCompactContent("context_compaction_report")).toBe(false);
    expect(isContextCompactContent("run compact now")).toBe(false);
    expect(
      isContextCompactMessage({
        role: "tool",
        content: "python print('compact')",
      }),
    ).toBe(false);
  });

  it("honors explicit marker even without content prefix", () => {
    expect(
      isContextCompactMessage({
        marker: "context_compact",
        role: "tool",
        content: "ignored",
      }),
    ).toBe(true);
  });
});

describe("window resolve + display surface (500k honesty)", () => {
  it("resolveOccupancyWindow prefers agent 500k over catalog 200k", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 100_000,
      contextWindow: 500_000,
      source: "auto_compact_started",
    });
    expect(resolveOccupancyWindow(state, 200_000)).toBe(500_000);
    expect(resolveOccupancyWindow(state, null)).toBe(500_000);
  });

  it("catalog 500k is the ring denominator when agent window unset", () => {
    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    expect(resolveOccupancyWindow(state, 500_000)).toBe(500_000);
    const d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.windowSize).toBe(500_000);
    expect(d.percent).toBe(31);
    expect(d.source).toBe("known");
    expect(resolveContextUsageSurface(d)).toBe("visible");
  });

  it("empty session surface stays hidden; soft-unknown after compact without counts", () => {
    const empty = resolveContextUsageDisplay(INITIAL_CONTEXT_USAGE, [], "zh", 500_000);
    expect(resolveContextUsageSurface(empty)).toBe("hidden");
    expect(empty.windowSize).toBe(500_000);

    const soft = resolveContextUsageDisplay(
      reduceContextUsage(INITIAL_CONTEXT_USAGE, {
        type: "compact",
        trigger: "manual",
        messageId: "c1",
      }),
      [{ id: "c1", role: "tool", marker: "context_compact" }],
      "zh",
      500_000,
    );
    expect(soft.source).toBe("unknown");
    expect(soft.label).toBe("—");
    expect(resolveContextUsageSurface(soft)).toBe("soft_unknown");
  });

  it("estimated vs known labels stay honest on the display surface", () => {
    const estimated = resolveContextUsageDisplay(
      INITIAL_CONTEXT_USAGE,
      [{ id: "u", role: "user", content: "a".repeat(40) }],
      "zh",
      500_000,
    );
    expect(estimated.source).toBe("estimated");
    expect(estimated.label.startsWith("~")).toBe(true);
    expect(estimated.windowSize).toBe(500_000);

    const known = resolveContextUsageDisplay(
      reduceContextUsage(INITIAL_CONTEXT_USAGE, {
        type: "usage",
        totalTokens: 12_000,
        source: "context_size",
      }),
      [],
      "zh",
      500_000,
    );
    expect(known.source).toBe("known");
    expect(known.label.startsWith("~")).toBe(false);
  });
});

describe("CLI occupancy parity", () => {
  it("matches Grok Build auto_compact_started tokens + %", () => {
    // Live wire: tokens_used 402603 / context_window 500000 → percentage 81
    expect(contextPercentCliStyle(402_603, 500_000)).toBe(81);
    expect(contextPercentCliStyle(400_460, 500_000)).toBe(80);
    expect(contextPercentCliStyle(222_570, 256_000)).toBe(87);

    const state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    expect(state.knownTokens).toBe(402_603);
    expect(state.agentContextWindow).toBe(500_000);
    expect(state.agentPercentage).toBe(81);

    const d = resolveContextUsageDisplay(state, [], "zh", 128_000);
    // Prefer agent window over catalog fallback.
    expect(d.windowSize).toBe(500_000);
    expect(d.tokens).toBe(402_603);
    expect(d.source).toBe("known");
    expect(d.percent).toBe(81);
  });

  it("stream context_size uses CLI-style integer % with agent or catalog window", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 156_385,
      source: "context_size",
    });
    // No agent window yet — catalog 500k → round(31.277%) = 31
    expect(contextPercentCliStyle(156_385, 500_000)).toBe(31);
    let d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.percent).toBe(31);

    // Later auto_compact_started refreshes window + integer %
    state = reduceContextUsage(state, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    d = resolveContextUsageDisplay(state, [], "zh", 500_000);
    expect(d.tokens).toBe(402_603);
    expect(d.percent).toBe(81);
    expect(resolveOccupancyPercent(402_603, state, 500_000)).toBe(81);
  });

  it("auto_compact_completed tokens_after replaces occupancy", () => {
    let state = reduceContextUsage(INITIAL_CONTEXT_USAGE, {
      type: "usage",
      totalTokens: 402_603,
      contextWindow: 500_000,
      percentage: 81,
      source: "auto_compact_started",
    });
    state = reduceContextUsage(state, {
      type: "compact",
      tokensBefore: 402_603,
      tokensAfter: 34_179,
      trigger: "auto",
      messageId: "c1",
    });
    expect(state.knownTokens).toBe(34_179);
    expect(state.agentPercentage).toBeNull();
    expect(state.agentContextWindow).toBe(500_000);
    const d = resolveContextUsageDisplay(
      state,
      [
        {
          id: "c1",
          role: "tool",
          marker: "context_compact",
          compactMeta: { tokensAfter: 34_179 },
        },
      ],
      "zh",
      500_000,
    );
    expect(d.tokens).toBe(34_179);
    expect(d.percent).toBe(contextPercentCliStyle(34_179, 500_000));
  });
});
