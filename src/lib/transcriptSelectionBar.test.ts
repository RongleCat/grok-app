import { describe, expect, it } from "vitest";
import {
  eventTargetElement,
  isSelectionInsideTranscript,
  reduceSelectionBar,
  selectionBarFromRead,
  selectionBarsEqual,
  shouldCommitPointerUp,
  shouldCommitSelectionChange,
} from "./transcriptSelectionBar";

describe("eventTargetElement", () => {
  it("returns null for non-nodes", () => {
    expect(eventTargetElement(null)).toBeNull();
  });
});

describe("shouldCommitSelectionChange", () => {
  it("skips while the primary pointer is down (drag-select)", () => {
    expect(
      shouldCommitSelectionChange({ primaryPointerDown: true }),
    ).toBe(false);
    expect(
      shouldCommitSelectionChange({ primaryPointerDown: false }),
    ).toBe(true);
  });
});

describe("shouldCommitPointerUp", () => {
  it("commits only when the gesture started in the transcript", () => {
    expect(shouldCommitPointerUp({ startedInTranscript: true })).toBe(true);
    expect(shouldCommitPointerUp({ startedInTranscript: false })).toBe(false);
  });
});

describe("isSelectionInsideTranscript", () => {
  it("requires the root and at least one endpoint inside it", () => {
    const inside = { id: "in" } as unknown as Node;
    const outside = { id: "out" } as unknown as Node;
    const root = {
      contains(node: Node | null) {
        return node === inside;
      },
    };
    expect(isSelectionInsideTranscript(inside, outside, root)).toBe(true);
    expect(isSelectionInsideTranscript(outside, inside, root)).toBe(true);
    expect(isSelectionInsideTranscript(outside, outside, root)).toBe(false);
    expect(isSelectionInsideTranscript(inside, inside, null)).toBe(false);
  });
});

describe("selectionBarFromRead / selectionBarsEqual", () => {
  it("places the bar under the range midpoint", () => {
    const bar = selectionBarFromRead({
      text: "hello",
      sourceMessageId: "m1",
      rect: { left: 100, width: 40, bottom: 50 },
    });
    expect(bar).toEqual({
      x: 100 + 20 - 140,
      y: 58,
      text: "hello",
      sourceMessageId: "m1",
    });
  });

  it("treats sub-pixel moves as equal so React can skip", () => {
    const a = selectionBarFromRead({
      text: "hello",
      rect: { left: 10, width: 10, bottom: 20 },
    });
    const b = selectionBarFromRead({
      text: "hello",
      rect: { left: 10.4, width: 10, bottom: 20.4 },
    });
    expect(selectionBarsEqual(a, b)).toBe(true);
    expect(
      selectionBarsEqual(a, { ...b, text: "hello world" }),
    ).toBe(false);
  });
});

describe("reduceSelectionBar", () => {
  const shown = selectionBarFromRead({
    text: "kept",
    rect: { left: 0, width: 10, bottom: 10 },
  });

  it("keeps the bar when the native selection collapses", () => {
    expect(reduceSelectionBar(shown, null)).toBe(shown);
  });

  it("returns the previous object when placement and text match", () => {
    const next = selectionBarFromRead({
      text: "kept",
      rect: { left: 0.2, width: 10, bottom: 10.2 },
    });
    expect(reduceSelectionBar(shown, next)).toBe(shown);
  });

  it("replaces when the excerpt changes", () => {
    const next = selectionBarFromRead({
      text: "new",
      rect: { left: 0, width: 10, bottom: 10 },
    });
    expect(reduceSelectionBar(shown, next)).toEqual(next);
  });
});
