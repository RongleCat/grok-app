import { describe, expect, it } from "vitest";
import {
  fallbackPetOverlayPolicy,
  petDragPassedSlop,
  petPointerStep,
  petShouldManualDrag,
} from "./petDrag";

describe("petDragPassedSlop", () => {
  it("stays put under the slop", () => {
    expect(petDragPassedSlop(3, 4, 6)).toBe(false);
  });

  it("starts after the slop", () => {
    expect(petDragPassedSlop(0, 6, 6)).toBe(true);
    expect(petDragPassedSlop(5, 5, 6)).toBe(true);
  });
});

describe("petShouldManualDrag", () => {
  it("is the Wayland path when cursor click-through is off", () => {
    expect(petShouldManualDrag({ cursorClickThrough: false })).toBe(true);
    expect(petShouldManualDrag({ cursorClickThrough: true })).toBe(false);
  });
});

describe("petPointerStep", () => {
  it("prefers movementX/Y (screenX is stubbed on WebKitGTK Wayland)", () => {
    const step = petPointerStep(
      { movementX: 4, movementY: -3, screenX: 0, screenY: 0 },
      { x: 0, y: 0 },
    );
    expect(step.dx).toBe(4);
    expect(step.dy).toBe(-3);
  });

  it("falls back to screen delta when movement is zero", () => {
    const step = petPointerStep(
      { movementX: 0, movementY: 0, screenX: 120, screenY: 80 },
      { x: 100, y: 70 },
    );
    expect(step.dx).toBe(20);
    expect(step.dy).toBe(10);
  });
});

describe("fallbackPetOverlayPolicy", () => {
  it("compacts desktop Linux (no cursor poll)", () => {
    expect(fallbackPetOverlayPolicy("Mozilla/5.0 (X11; Linux x86_64)")).toEqual(
      { compactIdle: true, cursorClickThrough: false },
    );
  });

  it("keeps the full overlay on Android / mac / Win", () => {
    expect(
      fallbackPetOverlayPolicy("Mozilla/5.0 (Linux; Android 14)"),
    ).toEqual({ compactIdle: false, cursorClickThrough: true });
    expect(fallbackPetOverlayPolicy("Mozilla/5.0 (Macintosh)")).toEqual({
      compactIdle: false,
      cursorClickThrough: true,
    });
  });
});
