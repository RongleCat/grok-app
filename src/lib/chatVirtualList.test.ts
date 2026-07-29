import { describe, expect, it } from "vitest";
import {
  CHAT_VIRTUALIZE_THRESHOLD,
  computeChatVirtualWindow,
  cumulativeOffsets,
  estimateChatRowHeight,
  scrollTopAfterHeightChange,
  shouldCommitRowHeight,
} from "./chatVirtualList";

const fixed = (h: number) => () => h;

describe("computeChatVirtualWindow", () => {
  it("empty list", () => {
    expect(
      computeChatVirtualWindow({
        count: 0,
        getHeight: fixed(100),
        scrollTop: 0,
        viewportHeight: 400,
      }),
    ).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
    });
  });

  it("pinToBottom always ends at count", () => {
    const w = computeChatVirtualWindow({
      count: 50,
      getHeight: fixed(100),
      scrollTop: 0,
      viewportHeight: 400,
      pinToBottom: true,
      overscanPx: 200,
    });
    expect(w.end).toBe(50);
    expect(w.totalHeight).toBe(5000);
    // Window covers the tail
    expect(w.start).toBeLessThan(50);
    expect(w.paddingBottom).toBe(0);
  });

  it("history browse windows mid-list", () => {
    const w = computeChatVirtualWindow({
      count: 40,
      getHeight: fixed(100),
      scrollTop: 1000,
      viewportHeight: 400,
      pinToBottom: false,
      overscanPx: 100,
    });
    expect(w.start).toBeGreaterThan(0);
    expect(w.end).toBeLessThan(40);
    expect(w.paddingTop + (w.end - w.start) * 100 + w.paddingBottom).toBe(
      w.totalHeight,
    );
  });

  it("forceIndices expands the window", () => {
    const w = computeChatVirtualWindow({
      count: 40,
      getHeight: fixed(100),
      scrollTop: 3000,
      viewportHeight: 400,
      pinToBottom: false,
      overscanPx: 0,
      forceIndices: [2],
    });
    expect(w.start).toBeLessThanOrEqual(2);
    expect(w.end).toBeGreaterThan(2);
  });

  it("threshold constant is high enough to skip short chats", () => {
    expect(CHAT_VIRTUALIZE_THRESHOLD).toBeGreaterThanOrEqual(40);
  });
});

describe("estimateChatRowHeight", () => {
  it("grows with long assistant bodies (org-chart style answers)", () => {
    const short = estimateChatRowHeight({ contentLength: 80, role: "assistant" });
    const long = estimateChatRowHeight({ contentLength: 7300, role: "assistant" });
    expect(long).toBeGreaterThan(short);
    expect(long).toBeGreaterThan(1500);
  });

  it("user bubbles stay relatively compact", () => {
    const h = estimateChatRowHeight({ contentLength: 40, role: "user" });
    expect(h).toBeLessThan(200);
  });

  it("collapsed / empty tool rows estimate 0 (no blank pin tail)", () => {
    expect(estimateChatRowHeight({ role: "tool", collapsed: true })).toBe(0);
    expect(estimateChatRowHeight({ role: "tool", contentLength: 0 })).toBe(0);
    expect(
      estimateChatRowHeight({ role: "tool", contentLength: 20 }),
    ).toBeLessThan(50);
  });
});

describe("shouldCommitRowHeight", () => {
  it("accepts first measure and real growth", () => {
    expect(shouldCommitRowHeight(undefined, 400)).toBe(true);
    expect(shouldCommitRowHeight(120, 3000)).toBe(true);
  });

  it("ignores tiny flicker and small shrink thrash", () => {
    expect(shouldCommitRowHeight(400, 401)).toBe(false);
    expect(shouldCommitRowHeight(400, 390)).toBe(false);
  });

  it("commits zero height so collapsed spacers correct estimates", () => {
    expect(shouldCommitRowHeight(undefined, 0)).toBe(true);
    expect(shouldCommitRowHeight(120, 0)).toBe(true);
    expect(shouldCommitRowHeight(0, 0)).toBe(false);
  });
});

describe("scrollTopAfterHeightChange", () => {
  it("does not adjust when pinned", () => {
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 100,
        delta: 40,
        pinToBottom: true,
      }),
    ).toBe(500);
  });

  it("shifts when row above viewport grows", () => {
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 100,
        delta: 40,
        pinToBottom: false,
      }),
    ).toBe(540);
  });

  it("ignores rows at or below viewport top", () => {
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 500,
        delta: 40,
        pinToBottom: false,
      }),
    ).toBe(500);
  });
});

describe("cumulativeOffsets", () => {
  it("builds prefix sums", () => {
    expect(cumulativeOffsets(3, (i) => (i + 1) * 10)).toEqual([0, 10, 30, 60]);
  });
});
