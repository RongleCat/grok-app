import { describe, expect, it } from "vitest";
import {
  GROK_ACTIVITY_STEP_ROW_PX,
  GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS,
  GROK_ACTIVITY_VIRTUALIZE_THRESHOLD,
  grokActivityVirtualMaxHeightPx,
  shouldVirtualizeGrokActivitySteps,
} from "./grokActivityVirtualize";

describe("grokActivityVirtualize", () => {
  it("keeps short lists non-virtual (≤ threshold)", () => {
    expect(shouldVirtualizeGrokActivitySteps(0)).toBe(false);
    expect(shouldVirtualizeGrokActivitySteps(1)).toBe(false);
    expect(
      shouldVirtualizeGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD),
    ).toBe(false);
  });

  it("virtualizes when count exceeds threshold", () => {
    expect(
      shouldVirtualizeGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 1),
    ).toBe(true);
    expect(shouldVirtualizeGrokActivitySteps(100)).toBe(true);
  });

  it("maxHeight is min(visibleRows, count) × row height", () => {
    expect(grokActivityVirtualMaxHeightPx(0)).toBe(0);
    expect(grokActivityVirtualMaxHeightPx(5)).toBe(5 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(grokActivityVirtualMaxHeightPx(15)).toBe(
      GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX,
    );
    expect(grokActivityVirtualMaxHeightPx(100)).toBe(
      GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX,
    );
  });

  it("row height constant matches virtual CSS contract (30px)", () => {
    expect(GROK_ACTIVITY_STEP_ROW_PX).toBe(30);
    expect(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD).toBe(14);
    expect(GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS).toBe(12);
  });
});
