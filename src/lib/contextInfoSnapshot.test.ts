import { describe, expect, it } from "vitest";
import {
  classifyContextSlashLine,
  contextShareLabel,
  parseContextInfoPayload,
} from "./contextInfoSnapshot";

const screenshot = {
  result: {
    sessionId: "s1",
    model: "grok-4.7",
    context: {
      used: 3300,
      total: 500000,
      systemPromptTokens: 1400,
      messageTokens: 2000,
      freeTokens: 496700,
      usagePct: 1,
      autoCompactThresholdPercent: 80,
      toolDefinitionsCount: 25,
      toolDefinitionsTokens: 9300,
      compactionCount: 0,
      turnCount: 0,
      toolCallCount: 0,
      messageCount: 2,
      usageCategories: [
        { label: "Skills", tokens: 4800, detail: "53 skills" },
        { label: "Workflows", tokens: 182, detail: "2 workflows" },
        { label: "MCP servers", tokens: 107, detail: "1 server" },
      ],
    },
  },
};

describe("parseContextInfoPayload", () => {
  it("matches the pager split for a 3.3k / 500k window", () => {
    const view = parseContextInfoPayload(screenshot);
    expect(view).toMatchObject({
      used: 3300,
      total: 500000,
      systemTokens: 1400,
      messageTokens: 1900,
      overheadTokens: 0,
      freeTokens: 496700,
      autoCompactPercent: 80,
      autoCompactRemaining: 396700,
      autoCompactNow: false,
      model: "grok-4.7",
      toolDefinitionsCount: 25,
      toolDefinitionsTokens: 9300,
    });
    expect(view?.percent).toBeCloseTo(0.66, 2);
    expect(view?.categories.map((c) => c.label)).toEqual([
      "Skills",
      "Workflows",
      "MCP servers",
    ]);
    expect(view?.bar.filter((c) => c === "free")).toHaveLength(99);
    expect(view?.bar.filter((c) => c !== "free")).toHaveLength(1);
  });

  it("puts the leftover used cell in overhead when categories round to zero", () => {
    const view = parseContextInfoPayload(screenshot);
    expect(view?.bar[0]).toBe("overhead");
    expect(view?.bar.slice(1).every((cell) => cell === "free")).toBe(true);
  });

  it("accepts a bare session-info object and snake_case fields", () => {
    const view = parseContextInfoPayload({
      model_display_name: "Grok 4.7",
      context: {
        used: 50,
        total: 100,
        system_prompt_tokens: 10,
        message_tokens: 20,
        usage_pct: 50,
        auto_compact_threshold_percent: 80,
      },
    });
    expect(view).toMatchObject({
      model: "Grok 4.7",
      systemTokens: 10,
      messageTokens: 20,
      overheadTokens: 20,
      freeTokens: 50,
      autoCompactNow: false,
    });
  });

  it("flags auto-compact when the integer percent has reached the threshold", () => {
    const view = parseContextInfoPayload({
      context: { used: 80, total: 100, usagePct: 80, autoCompactThresholdPercent: 80 },
    });
    expect(view?.autoCompactNow).toBe(true);
    expect(view?.autoCompactRemaining).toBe(0);
  });

  it("rejects payloads without a context object", () => {
    expect(parseContextInfoPayload({ result: { sessionId: "s" } })).toBeNull();
    expect(parseContextInfoPayload("not json")).toBeNull();
  });
});

describe("contextShareLabel", () => {
  it("uses one decimal under 10% and floors a tiny share at 0.1%", () => {
    expect(contextShareLabel(1400, 500000)).toBe("0.3%");
    expect(contextShareLabel(2000, 500000)).toBe("0.4%");
    expect(contextShareLabel(496700, 500000)).toBe("99%");
    expect(contextShareLabel(1, 1_000_000)).toBe("0.1%");
    expect(contextShareLabel(0, 500000)).toBe("0.0%");
  });
});

describe("classifyContextSlashLine", () => {
  it("accepts /context and leaves /context-window alone", () => {
    expect(classifyContextSlashLine("/context")).toEqual({ args: "" });
    expect(classifyContextSlashLine("  /Context  ")).toEqual({ args: "" });
    expect(classifyContextSlashLine("/context-window")).toBeNull();
    expect(classifyContextSlashLine("/context-window 500k")).toBeNull();
    expect(classifyContextSlashLine("/context\n\nmore")).toBeNull();
  });
});
