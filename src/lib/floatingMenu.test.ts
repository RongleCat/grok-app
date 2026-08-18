import { describe, expect, it, beforeAll } from "vitest";
import {
  FLOATING_MENU_Z_INDEX,
  computeFloatingPos,
  floatingStyle,
} from "./floatingMenu";

beforeAll(() => {
  Object.defineProperty(globalThis, "innerWidth", {
    value: 1024,
    configurable: true,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    value: 768,
    configurable: true,
  });
});

function rect(
  partial: Partial<DOMRect> & {
    top: number;
    left: number;
    width: number;
    height: number;
  },
): DOMRect {
  const bottom = partial.top + partial.height;
  const right = partial.left + partial.width;
  return {
    x: partial.left,
    y: partial.top,
    top: partial.top,
    left: partial.left,
    width: partial.width,
    height: partial.height,
    bottom,
    right,
    toJSON: () => ({}),
  };
}

describe("computeFloatingPos", () => {
  it("prefers above when more space above", () => {
    const r = rect({ top: 600, left: 40, width: 120, height: 32 });
    const pos = computeFloatingPos(r, {
      placement: "auto",
      estHeight: 200,
      fitContent: false,
      width: 200,
    });
    expect(pos.placeAbove).toBe(true);
    expect(pos.top).toBeLessThan(r.top + 1);
  });

  it("honors placement down", () => {
    const r = rect({ top: 100, left: 40, width: 80, height: 28 });
    const pos = computeFloatingPos(r, {
      placement: "down",
      fitContent: false,
      width: 160,
    });
    expect(pos.placeAbove).toBe(false);
    expect(pos.top).toBeGreaterThan(r.bottom);
  });

  it("clamps left within viewport for fixed width", () => {
    const r = rect({ top: 100, left: 9000, width: 80, height: 28 });
    const pos = computeFloatingPos(r, {
      width: 200,
      fitContent: false,
      placement: "down",
    });
    expect(pos.left + pos.width).toBeLessThanOrEqual(1024);
  });

  it("matchTriggerWidth expands fixed panel", () => {
    const r = rect({ top: 100, left: 20, width: 280, height: 32 });
    const pos = computeFloatingPos(r, {
      width: 100,
      matchTriggerWidth: true,
      fitContent: false,
      placement: "down",
    });
    expect(pos.width).toBeGreaterThanOrEqual(280);
  });

  it("fitContent leaves width 0 (CSS max-content)", () => {
    const r = rect({ top: 100, left: 40, width: 80, height: 28 });
    const pos = computeFloatingPos(r, { placement: "down", fitContent: true });
    expect(pos.fitContent).toBe(true);
    expect(pos.width).toBe(0);
    expect(pos.maxWidth).toBeGreaterThan(100);
    expect(pos.align).toBe("start");
  });

  it("align end hangs panel from trigger right edge", () => {
    // Trigger near the trailing chrome edge; panel wider than trigger.
    const r = rect({ top: 48, left: 960, width: 32, height: 28 });
    const pos = computeFloatingPos(r, {
      placement: "down",
      fitContent: false,
      width: 260,
      align: "end",
    });
    expect(pos.align).toBe("end");
    // Panel right ≈ trigger right (within viewport clamp).
    expect(pos.left + pos.width).toBeCloseTo(r.right, 0);
  });
});

describe("floatingStyle", () => {
  it("uses translateY for above placement", () => {
    const s = floatingStyle({
      left: 10,
      top: 100,
      width: 200,
      placeAbove: true,
      maxHeight: 200,
      maxWidth: 1000,
      fitContent: false,
      align: "start",
    });
    expect(s?.transform).toContain("translateY(-100%)");
    expect(s?.position).toBe("fixed");
    expect(s?.width).toBe(200);
  });

  it("skips the placeAbove transform when CSS owns motion", () => {
    const s = floatingStyle(
      {
        left: 10,
        top: 100,
        width: 200,
        placeAbove: true,
        maxHeight: 200,
        maxWidth: 1000,
        fitContent: false,
        align: "start",
      },
      { anchorTransform: false },
    );
    expect(s?.transform).toBeUndefined();
  });

  it("stacks above modal overlay (z-index 12000)", () => {
    const s = floatingStyle({
      left: 10,
      top: 100,
      width: 200,
      placeAbove: false,
      maxHeight: 200,
      maxWidth: 1000,
      fitContent: false,
      align: "start",
    });
    expect(s?.zIndex).toBe(FLOATING_MENU_Z_INDEX);
    expect(FLOATING_MENU_Z_INDEX).toBeGreaterThan(12000);
  });

  it("hides panel until settled to avoid open flash", () => {
    const s = floatingStyle(
      {
        left: 10,
        top: 100,
        width: 200,
        placeAbove: false,
        maxHeight: 200,
        maxWidth: 1000,
        fitContent: true,
        align: "start",
      },
      { settled: false },
    );
    expect(s?.visibility).toBe("hidden");
    expect(s?.pointerEvents).toBe("none");
  });

  it("uses max-content when fitContent", () => {
    const s = floatingStyle(
      {
        left: 10,
        top: 100,
        width: 0,
        placeAbove: false,
        maxHeight: 200,
        maxWidth: 800,
        fitContent: true,
        align: "start",
      },
      { minWidth: 120 },
    );
    expect(s?.width).toBe("max-content");
    expect(s?.minWidth).toBe(120);
    expect(s?.maxWidth).toBe(800);
  });
});
