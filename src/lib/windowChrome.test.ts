/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  applyViewportPan,
  maximizeLooksNoop,
  osMaximizeWaitMs,
  shouldAcceptTitlebarMaximize,
  shouldFakeMaximizeFallback,
  TITLEBAR_MAXIMIZE_DEBOUNCE_MS,
  viewportPanFromOffset,
  VIEWPORT_PAN_CLASS,
  VIEWPORT_PAN_X_VAR,
  VIEWPORT_PAN_Y_VAR,
} from "./windowChrome";

describe("shouldAcceptTitlebarMaximize", () => {
  it("debounces the second click of a drag-region pair", () => {
    expect(shouldAcceptTitlebarMaximize(1000, 1000)).toBe(false);
    expect(shouldAcceptTitlebarMaximize(1000, 1000 + 399)).toBe(false);
    expect(
      shouldAcceptTitlebarMaximize(1000, 1000 + TITLEBAR_MAXIMIZE_DEBOUNCE_MS),
    ).toBe(true);
  });
});

describe("maximizeLooksNoop", () => {
  it("is true only when the flag did not flip", () => {
    expect(maximizeLooksNoop(false, false)).toBe(true);
    expect(maximizeLooksNoop(true, true)).toBe(true);
    expect(maximizeLooksNoop(false, true)).toBe(false);
    expect(maximizeLooksNoop(true, false)).toBe(false);
  });
});

describe("shouldFakeMaximizeFallback", () => {
  it("is Linux-only — Windows/mac must use OS maximize, not setSize fill", () => {
    expect(shouldFakeMaximizeFallback("linux")).toBe(true);
    expect(shouldFakeMaximizeFallback("win")).toBe(false);
    expect(shouldFakeMaximizeFallback("mac")).toBe(false);
    expect(shouldFakeMaximizeFallback("other")).toBe(false);
  });
});

describe("osMaximizeWaitMs", () => {
  it("waits longer when there is no work-area fill fallback", () => {
    expect(osMaximizeWaitMs(true)).toBeLessThan(osMaximizeWaitMs(false));
    expect(osMaximizeWaitMs(true)).toBe(40);
    expect(osMaximizeWaitMs(false)).toBe(280);
  });
});

describe("viewportPanFromOffset", () => {
  it("returns null when the visual viewport is not panned", () => {
    expect(viewportPanFromOffset(0, 0)).toBeNull();
    expect(viewportPanFromOffset(0.2, -0.2)).toBeNull();
  });

  it("negates top/left offset so chrome stays pinned in the frame", () => {
    expect(viewportPanFromOffset(0, 48)).toEqual({ x: 0, y: -48 });
    expect(viewportPanFromOffset(12.6, 20.4)).toEqual({ x: -13, y: -20 });
  });
});

describe("applyViewportPan", () => {
  it("sets CSS vars while panned and clears them at identity", () => {
    const root = document.createElement("html");
    applyViewportPan(root, { x: 0, y: -48 });
    expect(root.classList.contains(VIEWPORT_PAN_CLASS)).toBe(true);
    expect(root.style.getPropertyValue(VIEWPORT_PAN_X_VAR)).toBe("0px");
    expect(root.style.getPropertyValue(VIEWPORT_PAN_Y_VAR)).toBe("-48px");
    applyViewportPan(root, null);
    expect(root.classList.contains(VIEWPORT_PAN_CLASS)).toBe(false);
    expect(root.style.getPropertyValue(VIEWPORT_PAN_X_VAR)).toBe("");
    expect(root.style.getPropertyValue(VIEWPORT_PAN_Y_VAR)).toBe("");
  });
});
