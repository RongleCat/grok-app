import { describe, expect, it } from "vitest";
import { computeTipPos } from "./tooltip";

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("computeTipPos", () => {
  it("centers above the anchor when there is room", () => {
    const r = rect(200, 200, 40, 28);
    const pos = computeTipPos(r, 120, 24, "top", 800, 600);
    expect(pos.place).toBe("top");
    // Center of anchor is 220; tip left = 220 - 60 = 160
    expect(pos.left).toBe(160);
    expect(pos.top).toBe(200 - 6 - 24);
  });

  it("clamps left when tip would overflow the left edge", () => {
    const r = rect(4, 200, 24, 24);
    const pos = computeTipPos(r, 200, 24, "top", 400, 600);
    expect(pos.left).toBe(8); // margin
  });

  it("clamps left when tip would overflow the right edge", () => {
    const r = rect(380, 200, 24, 24);
    const pos = computeTipPos(r, 200, 24, "top", 400, 600);
    // vw - margin - tipW = 400 - 8 - 200 = 192
    expect(pos.left).toBe(192);
  });

  it("flips to bottom when not enough space above", () => {
    const r = rect(100, 20, 40, 24);
    const pos = computeTipPos(r, 100, 40, "top", 800, 600);
    expect(pos.place).toBe("bottom");
    expect(pos.top).toBe(20 + 24 + 6);
  });

  it("keeps tip inside viewport vertically near the top", () => {
    const r = rect(100, 4, 40, 20);
    const pos = computeTipPos(r, 100, 40, "top", 800, 600);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + 40).toBeLessThanOrEqual(600 - 8);
  });

  it("caps maxWidth to the viewport", () => {
    const r = rect(50, 100, 20, 20);
    const pos = computeTipPos(r, 400, 24, "bottom", 200, 400);
    expect(pos.maxWidth).toBe(200 - 16);
  });

  it("honors a larger per-tip max when the viewport allows it", () => {
    const r = rect(200, 200, 40, 24);
    const pos = computeTipPos(r, 480, 40, "top", 1200, 800, 520);
    expect(pos.maxWidth).toBe(520);
  });
});
