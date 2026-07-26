import { describe, expect, it } from "vitest";
import {
  collectUserPromptHistory,
  nextPromptHistoryIndex,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
} from "./composerPromptHistory";

describe("collectUserPromptHistory", () => {
  it("returns user contents newest first", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second" },
      { role: "assistant", content: "ok2" },
      { role: "user", content: "third" },
    ]);
    expect(history).toEqual(["third", "second", "first"]);
  });

  it("skips empty / whitespace-only user messages", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "  " },
      { role: "user", content: "" },
      { role: "user", content: null },
      { role: "user", content: "keep" },
      { role: "tool", content: "tool noise" },
    ]);
    expect(history).toEqual(["keep"]);
  });

  it("skips mid-turn interjections", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "build a form" },
      { role: "assistant", content: "working" },
      {
        role: "user",
        content: "use existing components",
        marker: "interjection",
      },
      { role: "assistant", content: "done" },
      { role: "user", content: "add validation" },
    ]);

    expect(history).toEqual(["add validation", "build a form"]);
  });

  it("preserves stored skill tokens", () => {
    const history = collectUserPromptHistory([
      { role: "user", content: "[[skill:foo]] hello" },
    ]);
    expect(history).toEqual(["[[skill:foo]] hello"]);
  });

  it("returns empty for no messages", () => {
    expect(collectUserPromptHistory([])).toEqual([]);
  });
});

describe("nextPromptHistoryIndex", () => {
  it("starts at newest on first up", () => {
    expect(nextPromptHistoryIndex(null, 3, "up")).toBe(0);
  });

  it("walks older on repeated up and clamps", () => {
    expect(nextPromptHistoryIndex(0, 3, "up")).toBe(1);
    expect(nextPromptHistoryIndex(1, 3, "up")).toBe(2);
    expect(nextPromptHistoryIndex(2, 3, "up")).toBe(2);
  });

  it("walks newer on down and clears past newest", () => {
    expect(nextPromptHistoryIndex(2, 3, "down")).toBe(1);
    expect(nextPromptHistoryIndex(1, 3, "down")).toBe(0);
    expect(nextPromptHistoryIndex(0, 3, "down")).toBe(null);
    expect(nextPromptHistoryIndex(null, 3, "down")).toBe(null);
  });

  it("returns null when history is empty", () => {
    expect(nextPromptHistoryIndex(null, 0, "up")).toBe(null);
    expect(nextPromptHistoryIndex(0, 0, "down")).toBe(null);
  });
});

describe("stepPromptHistory", () => {
  const history = ["newest", "mid", "oldest"];

  it("fills draft with newest on first up", () => {
    expect(stepPromptHistory(history, null, "up")).toEqual({
      index: 0,
      text: "newest",
    });
  });

  it("cycles older then clears past newest on down", () => {
    expect(stepPromptHistory(history, 0, "up")).toEqual({
      index: 1,
      text: "mid",
    });
    expect(stepPromptHistory(history, 1, "down")).toEqual({
      index: 0,
      text: "newest",
    });
    expect(stepPromptHistory(history, 0, "down")).toEqual({
      index: null,
      text: "",
    });
  });

  it("handles empty history", () => {
    expect(stepPromptHistory([], null, "up")).toEqual({
      index: null,
      text: "",
    });
  });
});

describe("shouldHandlePromptHistoryKey", () => {
  it("claims ArrowUp only when empty or browsing", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(true);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: false,
        browsing: true,
        historyLength: 2,
      }),
    ).toBe(true);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: false,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
  });

  it("claims ArrowDown only while browsing", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowDown",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowDown",
        draftEmpty: false,
        browsing: true,
        historyLength: 2,
      }),
    ).toBe(true);
  });

  it("ignores other keys and empty history", () => {
    expect(
      shouldHandlePromptHistoryKey({
        key: "Enter",
        draftEmpty: true,
        browsing: false,
        historyLength: 2,
      }),
    ).toBe(false);
    expect(
      shouldHandlePromptHistoryKey({
        key: "ArrowUp",
        draftEmpty: true,
        browsing: false,
        historyLength: 0,
      }),
    ).toBe(false);
  });
});
