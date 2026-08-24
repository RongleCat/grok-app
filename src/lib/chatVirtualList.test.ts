import { describe, expect, it } from "vitest";
import {
  CHAT_FORCE_EXPAND_MAX_GAP,
  CHAT_OVERSCAN_MAX_PX,
  CHAT_OVERSCAN_MIN_PX,
  CHAT_PIN_OVERSCAN_MAX_PX,
  CHAT_PIN_OVERSCAN_MIN_PX,
  CHAT_VIRTUALIZE_THRESHOLD,
  applyForceIndices,
  computeChatVirtualWindow,
  cumulativeOffsets,
  estimateChatRowHeight,
  findEndIndex,
  findStartIndex,
  resolveChatOverscanPx,
  scrollTopAfterHeightChange,
  shouldCommitRowHeight,
  shouldWriteScrollOnRowCommit,
  shouldVirtualizeChat,
  splitVirtSpacerHeights,
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

  it("nearby forceIndices expands the window when escaped", () => {
    // Natural window ~ indices 30–34 with overscan 0.
    const w = computeChatVirtualWindow({
      count: 40,
      getHeight: fixed(100),
      scrollTop: 3000,
      viewportHeight: 400,
      pinToBottom: false,
      overscanPx: 0,
      forceIndices: [28],
    });
    expect(w.start).toBeLessThanOrEqual(28);
    expect(w.end).toBeGreaterThan(28);
  });

  it("distant forceIndices do not mount the whole tail when escaped", () => {
    // Reading mid-history must not expand end to the last row just because
    // idle force includes last user/assistant (long-session jank).
    const w = computeChatVirtualWindow({
      count: 200,
      getHeight: fixed(100),
      scrollTop: 5000,
      viewportHeight: 400,
      pinToBottom: false,
      overscanPx: 100,
      forceIndices: [0, 199],
    });
    expect(w.start).toBeGreaterThan(10);
    expect(w.end).toBeLessThan(100);
    // Natural window stays local — far force is ignored while escaped.
    expect(w.end - w.start).toBeLessThan(30);
  });

  it("pin forceIndices still expand to early rows (blank-pin defense)", () => {
    const heights = [80, 2000, ...Array(64).fill(40)];
    const w = computeChatVirtualWindow({
      count: heights.length,
      getHeight: (i) => heights[i] ?? 0,
      scrollTop: 0,
      viewportHeight: 600,
      pinToBottom: true,
      overscanPx: 400,
      forceIndices: [0, 1],
    });
    expect(w.end).toBe(heights.length);
    expect(w.start).toBe(0);
  });

  it("threshold virtualizes multi-turn agent chats without waiting for 50 rows", () => {
    // Short welcome/1-turn chats stay fully mounted; 3–4 tool-heavy turns should window.
    expect(CHAT_VIRTUALIZE_THRESHOLD).toBeGreaterThanOrEqual(12);
    expect(CHAT_VIRTUALIZE_THRESHOLD).toBeLessThanOrEqual(28);
  });

  it("accepts precomputed offsets (scroll-path cache)", () => {
    const count = 80;
    const offsets = cumulativeOffsets(count, fixed(50));
    const w = computeChatVirtualWindow({
      count,
      getHeight: fixed(50),
      scrollTop: 800,
      viewportHeight: 300,
      overscanPx: 50,
      offsets,
    });
    expect(w.totalHeight).toBe(4000);
    expect(w.paddingTop + (w.end - w.start) * 50 + w.paddingBottom).toBe(
      w.totalHeight,
    );
  });

  it("binary search matches linear scan on long lists", () => {
    const count = 2000;
    const getHeight = (i: number) => 40 + (i % 7) * 10;
    const offsets = cumulativeOffsets(count, getHeight);
    // Spot-check several y positions.
    for (const y of [0, 1, 500, 12_345, 50_000, 999_999]) {
      let linearStart = 0;
      for (let i = 0; i < count; i++) {
        const bottom = offsets[i + 1] ?? 0;
        if (bottom > y) {
          linearStart = i;
          break;
        }
        linearStart = i;
      }
      let linearEnd = count;
      for (let i = 0; i < count; i++) {
        const top = offsets[i] ?? 0;
        if (top >= y) {
          linearEnd = i;
          break;
        }
      }
      expect(findStartIndex(offsets, y)).toBe(linearStart);
      expect(findEndIndex(offsets, y)).toBe(linearEnd);
    }
  });
});

describe("resolveChatOverscanPx", () => {
  it("honors explicit override", () => {
    expect(
      resolveChatOverscanPx({
        viewportHeight: 800,
        overscanPx: 123,
      }),
    ).toBe(123);
  });

  it("clamps browse overscan for tiny and huge viewports", () => {
    const tiny = resolveChatOverscanPx({ viewportHeight: 200 });
    const huge = resolveChatOverscanPx({ viewportHeight: 4000 });
    expect(tiny).toBeGreaterThanOrEqual(CHAT_OVERSCAN_MIN_PX);
    expect(huge).toBeLessThanOrEqual(CHAT_OVERSCAN_MAX_PX);
    expect(huge).toBeGreaterThan(tiny);
  });

  it("pin overscan is larger than browse for the same viewport", () => {
    const vh = 900;
    const browse = resolveChatOverscanPx({ viewportHeight: vh });
    const pin = resolveChatOverscanPx({
      viewportHeight: vh,
      pinToBottom: true,
    });
    expect(pin).toBeGreaterThan(browse);
    expect(pin).toBeGreaterThanOrEqual(CHAT_PIN_OVERSCAN_MIN_PX);
    expect(pin).toBeLessThanOrEqual(CHAT_PIN_OVERSCAN_MAX_PX);
  });

  it("does not shrink pin overscan under stream-perf scale", () => {
    const vh = 811;
    const pin = resolveChatOverscanPx({
      viewportHeight: vh,
      pinToBottom: true,
    });
    const scaled = resolveChatOverscanPx({
      viewportHeight: vh,
      pinToBottom: true,
      scale: 0.55,
    });
    expect(scaled).toBe(pin);
    const browse = resolveChatOverscanPx({ viewportHeight: vh, scale: 0.55 });
    const browseFull = resolveChatOverscanPx({ viewportHeight: vh });
    expect(browse).toBeLessThan(browseFull);
  });

  it("shrinks browse overscan on long transcripts so scroll stays windowed (#881)", () => {
    const vh = 900;
    const short = resolveChatOverscanPx({ viewportHeight: vh, rowCount: 12 });
    const long = resolveChatOverscanPx({ viewportHeight: vh, rowCount: 180 });
    const veryLong = resolveChatOverscanPx({
      viewportHeight: vh,
      rowCount: 400,
    });
    expect(long).toBeLessThan(short);
    expect(veryLong).toBeLessThan(long);
    expect(veryLong).toBeGreaterThanOrEqual(900);
  });

  it("does not shrink pin overscan for long transcripts", () => {
    const vh = 900;
    const pin = resolveChatOverscanPx({
      viewportHeight: vh,
      pinToBottom: true,
    });
    const pinLong = resolveChatOverscanPx({
      viewportHeight: vh,
      pinToBottom: true,
      rowCount: 400,
    });
    expect(pinLong).toBe(pin);
  });
});

describe("applyForceIndices", () => {
  it("expands freely when pinned", () => {
    const r = applyForceIndices({
      start: 40,
      end: 50,
      count: 100,
      pinToBottom: true,
      forceIndices: [2, 99],
    });
    expect(r.start).toBe(2);
    expect(r.end).toBe(100);
  });

  it("only expands within max gap when escaped", () => {
    const r = applyForceIndices({
      start: 40,
      end: 50,
      count: 100,
      pinToBottom: false,
      maxGap: CHAT_FORCE_EXPAND_MAX_GAP,
      forceIndices: [40 - CHAT_FORCE_EXPAND_MAX_GAP, 90],
    });
    expect(r.start).toBe(40 - CHAT_FORCE_EXPAND_MAX_GAP);
    // 90 is far past end — ignored.
    expect(r.end).toBe(50);
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

  it("collapsed thinking does not inflate the first-paint estimate", () => {
    const bodyOnly = estimateChatRowHeight({
      contentLength: 240,
      role: "assistant",
    });
    const withCollapsedThought = estimateChatRowHeight({
      contentLength: 240,
      thoughtLength: 1800,
      role: "assistant",
    });
    // Default UI collapses thinking when the turn is done. Counting the
    // CoT made estimates hundreds of px taller than the measured row.
    expect(withCollapsedThought - bodyOnly).toBeLessThan(48);
    const expanded = estimateChatRowHeight({
      contentLength: 240,
      thoughtLength: 1800,
      thoughtExpanded: true,
      role: "assistant",
    });
    expect(expanded).toBeGreaterThan(withCollapsedThought + 200);
  });

  it("image cards boost height more than 36px chips (virtual scroll)", () => {
    const chips = estimateChatRowHeight({
      contentLength: 80,
      role: "assistant",
      attachmentCount: 6,
    });
    const images = estimateChatRowHeight({
      contentLength: 80,
      role: "assistant",
      imageCardCount: 6,
    });
    expect(images).toBeGreaterThan(chips);
    // 6 cards → 2 rows × ~160px
    expect(images - chips).toBeGreaterThanOrEqual(200);
  });
});

describe("shouldWriteScrollOnRowCommit", () => {
  it("never writes scrollTop from a row commit while pinned", () => {
    expect(shouldWriteScrollOnRowCommit(true)).toBe(false);
  });

  it("still allows escaped history-anchor writes", () => {
    expect(shouldWriteScrollOnRowCommit(false)).toBe(true);
  });
});

describe("shouldCommitRowHeight", () => {
  it("accepts first measure and real growth", () => {
    expect(shouldCommitRowHeight(undefined, 400)).toBe(true);
    expect(shouldCommitRowHeight(120, 3000)).toBe(true);
  });

  it("commits zero height for inlined tool spacers (not phantom scroll)", () => {
    expect(shouldCommitRowHeight(undefined, 0)).toBe(true);
    expect(shouldCommitRowHeight(40, 0)).toBe(true);
    expect(shouldCommitRowHeight(0, 0)).toBe(false);
  });

  it("pin window still reaches early rows when trailing heights are 0", () => {
    // user + assistant + 64 zero-height tools (cc6d8b01-style journal)
    const heights = [80, 2000, ...Array(64).fill(0)];
    const w = computeChatVirtualWindow({
      count: heights.length,
      getHeight: (i) => heights[i] ?? 0,
      scrollTop: 0,
      viewportHeight: 600,
      pinToBottom: true,
      overscanPx: 1600,
    });
    expect(w.end).toBe(heights.length);
    // Must include the assistant at index 1 (not only trailing zeros).
    expect(w.start).toBeLessThanOrEqual(1);
    expect(w.totalHeight).toBe(2080);
  });

  it("pin window with inflated tool estimates misses early content (regression)", () => {
    // Pre-fix: 64 tools estimated at 40px each — pin only sees the tail.
    const heights = [80, 2000, ...Array(64).fill(40)];
    const w = computeChatVirtualWindow({
      count: heights.length,
      getHeight: (i) => heights[i] ?? 0,
      scrollTop: 0,
      viewportHeight: 600,
      pinToBottom: true,
      overscanPx: 400,
    });
    expect(w.start).toBeGreaterThan(1);
  });

  it("ignores tiny flicker and small shrink thrash", () => {
    expect(shouldCommitRowHeight(400, 401)).toBe(false);
    expect(shouldCommitRowHeight(400, 403)).toBe(false); // <4px floor
    expect(shouldCommitRowHeight(400, 390)).toBe(false);
    expect(shouldCommitRowHeight(400, 405)).toBe(true); // ≥4px growth
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
        prevHeight: 80,
        delta: 40,
        pinToBottom: true,
      }),
    ).toBe(500);
  });

  it("shifts when entire row was above viewport and grows", () => {
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 100,
        prevHeight: 80,
        delta: 40,
        pinToBottom: false,
      }),
    ).toBe(540);
  });

  it("does not shift tall straddling media row growth (near-bottom bounce)", () => {
    // Assistant starts at 100, height 800; user reading lower half at scrollTop 500.
    // Images load (+200) at bottom of the same row — must not yank down.
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 100,
        prevHeight: 800,
        delta: 200,
        pinToBottom: false,
      }),
    ).toBe(500);
  });

  it("ignores rows at or below viewport top", () => {
    expect(
      scrollTopAfterHeightChange({
        scrollTop: 500,
        rowOffset: 500,
        prevHeight: 120,
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

describe("long transcript window scale", () => {
  it("keeps a bounded mount set on a 500-message history browse", () => {
    const count = 500;
    const w = computeChatVirtualWindow({
      count,
      getHeight: fixed(120),
      scrollTop: 20_000,
      viewportHeight: 800,
      pinToBottom: false,
      // Idle force of last user + last assistant — must not swallow the list.
      forceIndices: [count - 2, count - 1],
    });
    const mounted = w.end - w.start;
    // Viewport 800 + doubled adaptive overscan (4800px each side) ≈ 10400px
    // / 120 ≈ ~88 rows. Still bounded — nowhere near the 500-row list.
    expect(mounted).toBeLessThan(120);
    expect(w.end).toBeLessThan(count - 10);
    expect(w.start).toBeGreaterThan(50);
  });

  it("pin window start does not jump across a mid-list zero-height plateau", () => {
    // Real session shape: two assistant replies with hundreds of inlined
    // tool_step zeros between them. viewTop sitting on the plateau used to
    // flip start from message A to message B (stacked/flickering text).
    const heights = [
      80,
      400,
      ...Array(220).fill(0),
      300,
      72,
      240,
    ];
    const count = heights.length;
    const getHeight = (i: number) => heights[i] ?? 0;
    const total = heights.reduce((a, b) => a + b, 0);
    const laterTop = 80 + 400;
    const laterIndex = 2 + 220;
    const justBefore = computeChatVirtualWindow({
      count,
      getHeight,
      scrollTop: laterTop - 1,
      viewportHeight: 700,
      pinToBottom: false,
      overscanPx: 0,
    });
    const onPlateau = computeChatVirtualWindow({
      count,
      getHeight,
      scrollTop: laterTop,
      viewportHeight: 700,
      pinToBottom: false,
      overscanPx: 0,
    });
    expect(justBefore.totalHeight).toBe(total);
    expect(onPlateau.totalHeight).toBe(total);
    // Both must keep the earlier real assistant (index 1). Pre-fix, landing
    // exactly on the plateau jumped start to `laterIndex` (222).
    expect(justBefore.start).toBeLessThanOrEqual(1);
    expect(onPlateau.start).toBeLessThanOrEqual(1);
    expect(onPlateau.start).toBe(justBefore.start);
    expect(onPlateau.end).toBeGreaterThan(laterIndex);
  });

  it("pin still mounts the tail on a 500-message stream", () => {
    const count = 500;
    const w = computeChatVirtualWindow({
      count,
      getHeight: fixed(120),
      scrollTop: 0,
      viewportHeight: 800,
      pinToBottom: true,
      forceIndices: [count - 2, count - 1],
    });
    expect(w.end).toBe(count);
    expect(w.paddingBottom).toBe(0);
    // Not the whole list — only overscan above the tail.
    expect(w.start).toBeGreaterThan(count - 80);
  });
});

describe("shouldVirtualizeChat", () => {
  it("windows by row count or estimated height", () => {
    expect(
      shouldVirtualizeChat({ itemCount: 2, threshold: 16, estimatedTotalHeight: 200 }),
    ).toBe(false);
    expect(
      shouldVirtualizeChat({ itemCount: 16, threshold: 16, estimatedTotalHeight: 200 }),
    ).toBe(true);
    expect(
      shouldVirtualizeChat({
        itemCount: 2,
        threshold: 16,
        estimatedTotalHeight: 5000,
      }),
    ).toBe(true);
    expect(
      shouldVirtualizeChat({
        itemCount: 80,
        enabled: false,
        estimatedTotalHeight: 50_000,
      }),
    ).toBe(false);
  });
});

describe("splitVirtSpacerHeights", () => {
  it("returns nothing for empty / non-positive", () => {
    expect(splitVirtSpacerHeights(0)).toEqual([]);
    expect(splitVirtSpacerHeights(-10)).toEqual([]);
  });

  it("keeps a short spacer as one box", () => {
    expect(splitVirtSpacerHeights(400)).toEqual([400]);
  });

  it("chunks a tall spacer under the compositor cap", () => {
    expect(splitVirtSpacerHeights(9000, 4096)).toEqual([4096, 4096, 808]);
  });
});
