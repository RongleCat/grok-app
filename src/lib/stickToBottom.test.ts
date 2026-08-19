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
  shouldBumpStickOnBusyEdge,
  shouldClampPinnedOverscroll,
  shouldClampPinnedStreamDrift,
  shouldReleaseStickOnScrollUp,
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

describe("shouldClampPinnedStreamDrift", () => {
  // Viewport 400, content grew to 1000 → max scrollTop = 600.
  const sh = 1000;
  const ch = 400;

  it("clamps when pinned and stream micro-growth left us off bottom", () => {
    // Many 2–7px noise deltas stacked: scrollTop still 580 while max is 600.
    expect(shouldClampPinnedStreamDrift(true, false, 580, sh, ch)).toBe(true);
  });

  it("does not clamp when already hard at bottom", () => {
    expect(shouldClampPinnedStreamDrift(true, false, 600, sh, ch)).toBe(false);
    expect(shouldClampPinnedStreamDrift(true, false, 599.6, sh, ch)).toBe(
      false,
    );
  });

  it("does not clamp when user escaped (reading history)", () => {
    expect(shouldClampPinnedStreamDrift(false, true, 200, sh, ch)).toBe(false);
    expect(shouldClampPinnedStreamDrift(true, true, 200, sh, ch)).toBe(false);
  });

  it("does not clamp when unpinned without escape flag either", () => {
    expect(shouldClampPinnedStreamDrift(false, false, 200, sh, ch)).toBe(false);
  });
});

describe("isMeaningfulScrollUp", () => {
  it("ignores micro jitter at the locked bottom", () => {
    expect(isMeaningfulScrollUp(595, 600)).toBe(false); // 5px
    expect(isMeaningfulScrollUp(591, 600)).toBe(false); // 9px
    expect(STICK_ESCAPE_MIN_DELTA_PX).toBe(10);
  });

  it("accepts a clear upward drag aligned with the wheel threshold", () => {
    expect(isMeaningfulScrollUp(580, 600)).toBe(true); // 20px
    expect(isMeaningfulScrollUp(590, 600)).toBe(true); // 10px
  });
});

describe("shouldClampPinnedOverscroll", () => {
  it("clamps only past max (rubber-band)", () => {
    expect(shouldClampPinnedOverscroll(601, 600)).toBe(true);
    expect(shouldClampPinnedOverscroll(600.6, 600)).toBe(true);
  });

  it("does not fight an upward leave of a few pixels", () => {
    expect(shouldClampPinnedOverscroll(600, 600)).toBe(false);
    expect(shouldClampPinnedOverscroll(595, 600)).toBe(false);
    expect(shouldClampPinnedOverscroll(590, 600)).toBe(false);
  });
});

describe("shouldBumpStickOnBusyEdge", () => {
  it("bumps regenerate / permission on the same user turn", () => {
    expect(shouldBumpStickOnBusyEdge("u1", "u1")).toBe(true);
    expect(shouldBumpStickOnBusyEdge(null, null)).toBe(true);
  });

  it("does not bump when a new user message already force-sticks", () => {
    expect(shouldBumpStickOnBusyEdge("u2", "u1")).toBe(false);
    expect(shouldBumpStickOnBusyEdge("u1", null)).toBe(false);
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

describe("shouldReleaseStickOnScrollUp", () => {
  // Viewport 600 tall, content 1200 → max scrollTop = 600.
  const sh = 1200;
  const ch = 600;

  it("escapes on a real scroll-up that lands above the hard bottom", () => {
    // From bottom (600) up to 550 → 50px up, not clamped.
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 550,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
  });

  it("does NOT escape when a browser clamp parks the viewport on the bottom", () => {
    // Content above the viewport shrank (tool phase auto-collapse / virtual
    // remeasure) → browser forced scrollTop from 600 down to the new max 400
    // (scrollHeight shrank to 1000). This is not an intentional leave and
    // must keep following the stream.
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 400,
        previousScrollTop: 600,
        scrollHeight: 1000,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("does NOT escape when the viewport grew and clamped to the new max", () => {
    // clientHeight grew 600 → 800; scrollHeight 1200 → max 400. The browser
    // pulled scrollTop 600 → 400 to keep it within bounds.
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 400,
        previousScrollTop: 600,
        scrollHeight: 1200,
        clientHeight: 800,
      }),
    ).toBe(false);
  });

  it("does NOT escape on micro jitter below the escape delta", () => {
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 592,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("does NOT escape when pin is already released", () => {
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: false,
        scrollTop: 400,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("escapes when the scroll-up ends inside the near band but above hard bottom", () => {
    // 40px up from bottom (600 → 560) — near threshold (100) but the user
    // genuinely left; must escape like before.
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 560,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
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

  it("does not re-pin from the near band after escape (bottom jitter)", () => {
    // Escaped 14–80px from the end; a down-tick is still "near" (100px).
    // Snapping to max here is the bounce when landing / leaving the bottom.
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      {
        scrollingUp: false,
        scrollingDown: true,
        nearBottom: true,
        hardBottom: false,
        userIntentDown: true,
      },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
  });

  it("scroll-down + intent re-pins only on the hard bottom after escape", () => {
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      {
        scrollingUp: false,
        scrollingDown: true,
        nearBottom: true,
        hardBottom: true,
        userIntentDown: true,
      },
    );
    expect(next).toEqual({ pinned: true, escaped: false });
  });

  it("layout thrash scrollingDown without intent does not re-pin while escaped", () => {
    // Height shrink clamp raises scrollTop → synthetic scrollingDown + near.
    // Must not re-engage stick (media-heavy chat bounce after scroll-up).
    const next = nextStickPinState(
      { pinned: false, escaped: true },
      {
        scrollingUp: false,
        scrollingDown: true,
        nearBottom: true,
        userIntentDown: false,
      },
    );
    expect(next).toEqual({ pinned: false, escaped: true });
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
