import { describe, expect, it } from "vitest";
import {
  COMPOSER_DRAFT_STATS_KEY,
  DEFAULT_SHOW_COMPOSER_DRAFT_STATS,
  computeDraftStats,
  countDraftChars,
  countDraftWords,
  loadComposerDraftStatsPref,
  parseComposerDraftStatsPref,
  saveComposerDraftStatsPref,
  type DraftStatsStorage,
} from "./draftStats";

function memoryStorage(
  initial: Record<string, string> = {},
): DraftStatsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("countDraftChars", () => {
  it("counts empty as 0", () => {
    expect(countDraftChars("")).toBe(0);
  });

  it("counts ASCII characters including spaces and newlines", () => {
    expect(countDraftChars("hi")).toBe(2);
    expect(countDraftChars("a b")).toBe(3);
    expect(countDraftChars("a\nb")).toBe(3);
  });

  it("counts Unicode code points (emoji-safe)", () => {
    expect(countDraftChars("你好")).toBe(2);
    // Single emoji may be one or more code points; surrogate pairs collapse via [...]
    expect(countDraftChars("👍")).toBe(1);
    expect(countDraftChars("a👍b")).toBe(3);
  });
});

describe("countDraftWords", () => {
  it("returns 0 for empty / whitespace-only", () => {
    expect(countDraftWords("")).toBe(0);
    expect(countDraftWords("   ")).toBe(0);
    expect(countDraftWords("\n\t")).toBe(0);
  });

  it("splits on whitespace runs", () => {
    expect(countDraftWords("hello")).toBe(1);
    expect(countDraftWords("hello world")).toBe(2);
    expect(countDraftWords("  one   two\tthree\nfour  ")).toBe(4);
  });

  it("treats CJK without spaces as a single token", () => {
    expect(countDraftWords("你好世界")).toBe(1);
    expect(countDraftWords("你好 世界")).toBe(2);
  });
});

describe("computeDraftStats", () => {
  it("marks empty / whitespace-only as empty with zero counts", () => {
    expect(computeDraftStats("")).toEqual({
      chars: 0,
      words: 0,
      empty: true,
    });
    expect(computeDraftStats("  \n ")).toEqual({
      chars: 0,
      words: 0,
      empty: true,
    });
  });

  it("returns chars and words for non-empty drafts", () => {
    expect(computeDraftStats("hi there")).toEqual({
      chars: 8,
      words: 2,
      empty: false,
    });
    expect(computeDraftStats("hello")).toEqual({
      chars: 5,
      words: 1,
      empty: false,
    });
  });

  it("preserves internal whitespace in char count", () => {
    const stats = computeDraftStats("a  b");
    expect(stats.empty).toBe(false);
    expect(stats.chars).toBe(4);
    expect(stats.words).toBe(2);
  });
});

describe("composer draft stats preference", () => {
  it("defaults to true", () => {
    expect(DEFAULT_SHOW_COMPOSER_DRAFT_STATS).toBe(true);
    expect(parseComposerDraftStatsPref(null)).toBe(true);
    expect(parseComposerDraftStatsPref("")).toBe(true);
    expect(parseComposerDraftStatsPref("maybe")).toBe(true);
    expect(loadComposerDraftStatsPref(memoryStorage())).toBe(true);
  });

  it("parses true/false variants", () => {
    expect(parseComposerDraftStatsPref("1")).toBe(true);
    expect(parseComposerDraftStatsPref("true")).toBe(true);
    expect(parseComposerDraftStatsPref(true)).toBe(true);
    expect(parseComposerDraftStatsPref("0")).toBe(false);
    expect(parseComposerDraftStatsPref("false")).toBe(false);
    expect(parseComposerDraftStatsPref(false)).toBe(false);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveComposerDraftStatsPref(false, s);
    expect(s.data[COMPOSER_DRAFT_STATS_KEY]).toBe("0");
    expect(loadComposerDraftStatsPref(s)).toBe(false);
    saveComposerDraftStatsPref(true, s);
    expect(s.data[COMPOSER_DRAFT_STATS_KEY]).toBe("1");
    expect(loadComposerDraftStatsPref(s)).toBe(true);
  });
});
