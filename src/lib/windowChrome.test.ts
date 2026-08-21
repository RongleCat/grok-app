import { describe, expect, it, vi } from "vitest";
import {
  CAPTION_BUTTON_TOGGLE_DEFER_MS,
  maximizeLooksNoop,
  osMaximizeWaitMs,
  scheduleCaptionButtonToggle,
  shouldAcceptTitlebarMaximize,
  shouldFakeMaximizeFallback,
  TITLEBAR_MAXIMIZE_DEBOUNCE_MS,
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
  it("only waits on the Linux work-area fill path", () => {
    expect(osMaximizeWaitMs(true)).toBe(40);
    expect(osMaximizeWaitMs(false)).toBe(0);
  });
});

describe("scheduleCaptionButtonToggle", () => {
  it("defers past mouse-up so Windows does not drag-to-restore", () => {
    expect(CAPTION_BUTTON_TOGGLE_DEFER_MS).toBeGreaterThan(0);
    vi.useFakeTimers();
    const fn = vi.fn();
    scheduleCaptionButtonToggle(fn, CAPTION_BUTTON_TOGGLE_DEFER_MS);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CAPTION_BUTTON_TOGGLE_DEFER_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
