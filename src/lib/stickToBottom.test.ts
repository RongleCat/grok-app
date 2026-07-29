import { describe, expect, it } from "vitest";
import {
  STICK_ESCAPE_MIN_DELTA_PX,
  STICK_HEIGHT_NOISE_PX,
  STICK_HARD_BOTTOM_PX,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  distanceFromBottom,
  isHardBottom,
  isHeightDeltaNoise,
  isMeaningfulScrollUp,
  isNearBottom,
  nextStickPinState,
} from "./stickToBottom";

describe("distanceFromBottom", () => {
  it("is 0 at bottom", () => {
    expect(distanceFromBottom(400, 900, 500)).toBe(0);
  });

  it("grows as user scrolls up", () => {
    expect(distanceFromBottom(300, 900, 500)).toBe(100);
    expect(distanceFromBottom(0, 900, 500)).toBe(400);
  });

  it("never goes negative when overscrolled", () => {
    expect(distanceFromBottom(500, 900, 500)).toBe(0);
  });
});

describe("isNearBottom", () => {
  const sh = 1000;
  const ch = 400;

  it("true at bottom and within threshold", () => {
    expect(isNearBottom(600, sh, ch, 100)).toBe(true); // distance 0
    expect(isNearBottom(520, sh, ch, 100)).toBe(true); // distance 80
  });

  it("false when scrolled past threshold", () => {
    expect(isNearBottom(400, sh, ch, 100)).toBe(false); // distance 200
    expect(isNearBottom(499, sh, ch, 100)).toBe(false); // distance 101
  });

  it("true when content does not overflow", () => {
    expect(isNearBottom(0, 300, 400, 100)).toBe(true);
  });

  it("uses default threshold", () => {
    expect(STICK_TO_BOTTOM_THRESHOLD_PX).toBe(100);
    // distance = 100 → still near with default
    expect(isNearBottom(500, 1000, 400)).toBe(true);
    // distance = 101 → released
    expect(isNearBottom(499, 1000, 400)).toBe(false);
  });
});

describe("bottomScrollTop", () => {
  it("parks at max scroll", () => {
    expect(bottomScrollTop(1000, 400)).toBe(600);
  });

  it("is 0 when content shorter than viewport", () => {
    expect(bottomScrollTop(200, 400)).toBe(0);
  });
});

describe("isHeightDeltaNoise", () => {
  it("ignores sub-noise reflows (thinking stream flicker)", () => {
    expect(isHeightDeltaNoise(0)).toBe(true);
    expect(isHeightDeltaNoise(1)).toBe(true);
    expect(isHeightDeltaNoise(3)).toBe(true);
    expect(isHeightDeltaNoise(-2)).toBe(true);
    expect(isHeightDeltaNoise(7)).toBe(true);
    expect(STICK_HEIGHT_NOISE_PX).toBe(8);
  });

  it("passes real growth / collapse through", () => {
    expect(isHeightDeltaNoise(8)).toBe(false);
    expect(isHeightDeltaNoise(24)).toBe(false);
    expect(isHeightDeltaNoise(-40)).toBe(false);
  });
});

describe("isMeaningfulScrollUp", () => {
  it("ignores micro jitter at the locked bottom", () => {
    expect(isMeaningfulScrollUp(595, 600)).toBe(false); // 5px
    expect(isMeaningfulScrollUp(590, 600)).toBe(false); // 10px
    expect(STICK_ESCAPE_MIN_DELTA_PX).toBe(14);
  });

  it("accepts a clear upward drag", () => {
    expect(isMeaningfulScrollUp(580, 600)).toBe(true); // 20px
    expect(isMeaningfulScrollUp(586, 600)).toBe(true); // 14px
  });
});

describe("isHardBottom", () => {
  it("true within hard band", () => {
    expect(isHardBottom(600, 1000, 400, 2)).toBe(true); // distance 0
    expect(isHardBottom(598, 1000, 400, 2)).toBe(true); // distance 2
    expect(STICK_HARD_BOTTOM_PX).toBe(2);
  });

  it("false outside hard band", () => {
    expect(isHardBottom(597, 1000, 400, 2)).toBe(false); // distance 3
  });
});

describe("nextStickPinState", () => {
  it("scroll-up escapes and unpins even when still near bottom", () => {
    // This is the bounce bug: old logic re-pinned because near stayed true.
    const next = nextStickPinState(
      { pinned: true, escaped: false },
      { scrollingUp: true, scrollingDown: false, nearBottom: true },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("scroll-up wins over hardBottom (leaving the end)", () => {
    const next = nextStickPinState(
      { pinned: true, escaped: false },
      {
        scrollingUp: true,
        scrollingDown: false,
        nearBottom: true,
        hardBottom: true,
        userIntentDown: true,
      },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("does not re-pin while escaped just because near bottom", () => {
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      { scrollingUp: false, scrollingDown: false, nearBottom: true },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("does not re-pin on hardBottom alone without down intent", () => {
    // Micro scroll-up left user inside hard band; idle event must not bounce.
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      {
        scrollingUp: false,
        scrollingDown: false,
        nearBottom: true,
        hardBottom: true,
        userIntentDown: false,
      },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("scroll-down clears escape; re-pins when near", () => {
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      { scrollingUp: false, scrollingDown: true, nearBottom: true },
    );
    expect(next).toEqual({ pinned: true, escaped: false });
  });

  it("scroll-down while still far keeps escape (no mid-list re-pin)", () => {
    // Virtualized/short scrollHeight must not clear escape mid-document —
    // otherwise a false nearBottom on the next frame yanks to the tail.
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      { scrollingUp: false, scrollingDown: true, nearBottom: false },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("hard bottom + down intent re-engages without a positive scroll delta", () => {
    // User scrolled toward latest; last event has scrollingDown=false at max.
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      {
        scrollingUp: false,
        scrollingDown: false,
        nearBottom: true,
        hardBottom: true,
        userIntentDown: true,
      },
    );
    expect(next).toEqual({ pinned: true, escaped: false });
  });
});
