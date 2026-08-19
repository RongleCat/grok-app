import { describe, expect, it } from "vitest";
import { PET_BUBBLE_WIDTH, petBubbleViewportHeight } from "./petTasks";
import {
  petBubbleOffsetX,
  petBubblesEnabled,
  petOverlayHeight,
  petOverlayWidth,
} from "./petBubbleLayout";

describe("petBubbleOffsetX", () => {
  it("slides left when the right gap cannot fit the chip", () => {
    const dx = petBubbleOffsetX({
      leftGap: 900,
      rightGap: 40,
      bubbleWidth: 216,
      maxOffset: 200,
    });
    expect(dx).toBeLessThan(0);
    expect(dx).toBeCloseTo(-(216 / 2 + 16 - 40), 5);
  });

  it("slides right when the left gap cannot fit the chip", () => {
    const dx = petBubbleOffsetX({
      leftGap: 20,
      rightGap: 800,
      bubbleWidth: 216,
      maxOffset: 200,
    });
    expect(dx).toBeGreaterThan(0);
  });

  it("stays put when both sides have room", () => {
    expect(
      petBubbleOffsetX({ leftGap: 500, rightGap: 500, bubbleWidth: 216 }),
    ).toBe(0);
  });

  it("clamps to maxOffset", () => {
    expect(
      petBubbleOffsetX({
        leftGap: 900,
        rightGap: 0,
        bubbleWidth: 216,
        maxOffset: 48,
      }),
    ).toBe(-48);
  });
});

describe("petOverlayWidth", () => {
  it("leaves room to slide a chip beside the mark", () => {
    expect(petOverlayWidth(128)).toBe(128 + 96 + PET_BUBBLE_WIDTH);
  });
});

describe("petOverlayHeight", () => {
  it("always reserves the 3-chip viewport so the mark does not jump", () => {
    expect(petOverlayHeight(128)).toBe(128 + 96 + petBubbleViewportHeight());
    expect(petOverlayHeight(160)).toBe(160 + 96 + petBubbleViewportHeight());
  });

  it("drops reserved chip space when bubbles are off", () => {
    expect(petOverlayWidth(128, false)).toBe(128 + 96);
    expect(petOverlayHeight(128, false)).toBe(128 + 96);
  });

  it("treats missing bubblesEnabled as on", () => {
    expect(petBubblesEnabled(undefined)).toBe(true);
    expect(petBubblesEnabled({ bubblesEnabled: false })).toBe(false);
    expect(petBubblesEnabled({ bubblesEnabled: true })).toBe(true);
  });
});
