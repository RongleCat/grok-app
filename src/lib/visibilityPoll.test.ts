import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldPollTickVisible,
  startVisibilityPoll,
} from "./visibilityPoll";

describe("shouldPollTickVisible", () => {
  it("runs for visible / unknown states and skips hidden", () => {
    expect(shouldPollTickVisible("visible")).toBe(true);
    expect(shouldPollTickVisible(null)).toBe(true);
    expect(shouldPollTickVisible(undefined)).toBe(true);
    expect(shouldPollTickVisible("hidden")).toBe(false);
  });
});

describe("startVisibilityPoll", () => {
  type Handler = () => void;
  let intervalHandler: Handler | null = null;
  let visibilityHandler: Handler | null = null;
  let cleared: unknown[] = [];
  let visible = true;

  const harness = () => ({
    isVisible: () => visible,
    addListener: (h: Handler) => {
      visibilityHandler = h;
    },
    removeListener: (h: Handler) => {
      if (visibilityHandler === h) visibilityHandler = null;
    },
    setIntervalFn: (h: Handler) => {
      intervalHandler = h;
      return 7;
    },
    clearIntervalFn: (id: unknown) => {
      cleared.push(id);
    },
  });

  beforeEach(() => {
    intervalHandler = null;
    visibilityHandler = null;
    cleared = [];
    visible = true;
  });

  it("ticks on the interval while visible and skips while hidden", () => {
    const tick = vi.fn();
    const handle = startVisibilityPoll({ tick, ...harness() });
    expect(intervalHandler).toBeTruthy();

    intervalHandler!();
    expect(tick).toHaveBeenCalledTimes(1);

    visible = false;
    intervalHandler!();
    intervalHandler!();
    expect(tick).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect(cleared).toEqual([7]);
  });

  it("fires a catch-up tick when the window becomes visible again", () => {
    const tick = vi.fn();
    const handle = startVisibilityPoll({ tick, ...harness() });
    expect(tick).toHaveBeenCalledTimes(0);

    visible = false;
    visibilityHandler!();
    expect(tick).toHaveBeenCalledTimes(0);

    visible = true;
    visibilityHandler!();
    expect(tick).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it("dispose removes the visibility listener", () => {
    const tick = vi.fn();
    const handle = startVisibilityPoll({ tick, ...harness() });
    handle.dispose();
    expect(visibilityHandler).toBeNull();
  });
});
