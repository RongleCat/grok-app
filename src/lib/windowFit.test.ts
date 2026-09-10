import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIT_PAD,
  measureWorkbenchFitNeed,
  windowFitTargetWidth,
  windowFitWouldGrow,
} from "./windowFit";
import {
  DEFAULT_LAYOUT,
  MAIN_CHAT_MIN_WIDTH,
  requiredWorkbenchInnerWidth,
} from "./layout";

function rect(width: number): DOMRect {
  return {
    width,
    height: 100,
    top: 0,
    left: 0,
    bottom: 100,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function el(
  className: string,
  width: number,
): { classList: { contains: (c: string) => boolean }; getBoundingClientRect: () => DOMRect } {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  return {
    classList: {
      contains: (c: string) => classes.has(c),
    },
    getBoundingClientRect: () => rect(width),
  };
}

describe("windowFitWouldGrow", () => {
  const railOpen = {
    sidebarCollapsed: false,
    sidebarWidth: DEFAULT_LAYOUT.sidebarWidth,
    asideCollapsed: true,
    asideWidth: DEFAULT_LAYOUT.asideWidth,
  } as const;

  const bothOpen = {
    ...railOpen,
    asideCollapsed: false,
  };

  it("matches the grow request (required inner width plus fit pad)", () => {
    expect(windowFitTargetWidth(railOpen)).toBe(
      Math.ceil(requiredWorkbenchInnerWidth(railOpen) + FIT_PAD),
    );
    expect(windowFitTargetWidth(bothOpen)).toBe(
      Math.ceil(requiredWorkbenchInnerWidth(bothOpen) + FIT_PAD),
    );
  });

  it("does not grow when the viewport already meets required+pad", () => {
    const target = windowFitTargetWidth(railOpen);
    expect(windowFitWouldGrow(target, railOpen)).toBe(false);
    expect(windowFitWouldGrow(target + 80, railOpen)).toBe(false);
  });

  it("grows when the viewport is below required+pad", () => {
    const target = windowFitTargetWidth(railOpen);
    expect(windowFitWouldGrow(target - 1, railOpen)).toBe(true);
    const bothTarget = windowFitTargetWidth(bothOpen);
    expect(windowFitWouldGrow(bothTarget - 1, bothOpen)).toBe(true);
    expect(windowFitWouldGrow(bothTarget, bothOpen)).toBe(false);
  });

  it("does not grow on a missing or zero viewport", () => {
    expect(windowFitWouldGrow(0, railOpen)).toBe(false);
    expect(windowFitWouldGrow(Number.NaN, railOpen)).toBe(false);
  });
});

describe("measureWorkbenchFitNeed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when main is wide enough", () => {
    const map: Record<string, ReturnType<typeof el>> = {
      ".main": el("main", 500),
      ".sidebar": el("sidebar", 268),
      ".aside:not(.aside--hidden):not(.aside--collapsed)": el("aside", 400),
    };
    vi.stubGlobal("document", {
      querySelector: (sel: string) => map[sel] ?? null,
    });
    expect(measureWorkbenchFitNeed()).toBeNull();
  });

  it("sums panes when main is crushed", () => {
    const map: Record<string, ReturnType<typeof el>> = {
      ".main": el("main", 200),
      ".sidebar": el("sidebar", 268),
      ".aside:not(.aside--hidden):not(.aside--collapsed)": el("aside", 400),
    };
    vi.stubGlobal("document", {
      querySelector: (sel: string) => map[sel] ?? null,
    });
    expect(measureWorkbenchFitNeed()).toBe(268 + MAIN_CHAT_MIN_WIDTH + 400);
  });

  it("ignores hidden sidebar", () => {
    const map: Record<string, ReturnType<typeof el>> = {
      ".main": el("main", 180),
      ".sidebar": el("sidebar sidebar--hidden", 0),
    };
    vi.stubGlobal("document", {
      querySelector: (sel: string) => map[sel] ?? null,
    });
    expect(measureWorkbenchFitNeed()).toBe(MAIN_CHAT_MIN_WIDTH);
  });
});
