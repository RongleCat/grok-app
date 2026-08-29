/**
 * @vitest-environment jsdom
 *
 * Scroll-release / escape / pin-state portion of the stick-to-bottom
 * decision table (split from stickToBottom.test.ts to stay under the
 * 1k-line budget). Same helpers, same coverage — see
 * stickToBottom.test.ts for the pin/follow/media half.
 */
import { describe, expect, it } from "vitest";
import {
  STICK_HARD_BOTTOM_PX,
  STICK_MIN_VIEWPORT_HEIGHT_PX,
  isHardBottom,
  isStickViewportUnreliable,
  markProgrammaticStickScroll,
  nextStickPinState,
  shouldEscapePinnedScroll,
  shouldIgnoreProgrammaticStickLeave,
  shouldReleaseStickOnScrollUp,
  shouldReleaseStickOnSlowScrollUp,
  shouldRestorePinnedFollowOnViewportReady,
  takeProgrammaticStickScroll,
} from "./stickToBottom";

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

  it("minDeltaPx 0.5 would treat thinking/tool reflow as a leave", () => {
    // Hook used to pass minDeltaPx: 0.5. A 6px leftover after auto-collapse
    // or spacer remeasure then dropped pin for the rest of the turn.
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 594,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
        minDeltaPx: 0.5,
      }),
    ).toBe(true);
    expect(
      shouldReleaseStickOnScrollUp({
        pinned: true,
        scrollTop: 594,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });
});

describe("shouldReleaseStickOnSlowScrollUp", () => {
  // Viewport 400, content 1000 → max scrollTop = 600.
  const sh = 1000;
  const ch = 400;

  it("releases once pixel-mode ticks walk 10px off the locked bottom", () => {
    // Three 4px ticks: 600 → 596 → 592 → 588. Last event is 4px.
    expect(
      shouldReleaseStickOnSlowScrollUp({
        pinned: true,
        scrollTop: 588,
        previousScrollTop: 592,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
  });

  it("does not release a 4px tick still inside the 10px band", () => {
    expect(
      shouldReleaseStickOnSlowScrollUp({
        pinned: true,
        scrollTop: 596,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("does not treat stream/phase growth as a leave", () => {
    // Thinking finished / tools started: content grew 80px, follow has not
    // landed yet (560 is already 40px off). A 4px spacer tick must not unpin.
    expect(
      shouldReleaseStickOnSlowScrollUp({
        pinned: true,
        scrollTop: 556,
        previousScrollTop: 560,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("does not release when scrollTop did not move up", () => {
    expect(
      shouldReleaseStickOnSlowScrollUp({
        pinned: true,
        scrollTop: 600,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });
});

describe("shouldEscapePinnedScroll", () => {
  const sh = 1200;
  const ch = 600;

  it("keeps following after thinking/tool/body phase jitter", () => {
    // 6–8px leftover from auto-collapse / virtual remeasure / markdown settle.
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 592,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 594,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
  });

  it("keeps following when the next round grows while still off hard bottom", () => {
    // Body finished, next thinking row mounted: scrollHeight jumped, we are
    // 40px off until follow. Layout tick of 4px must not drop pin.
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 556,
        previousScrollTop: 560,
        scrollHeight: 1040,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("still escapes a real flick off the bottom", () => {
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 550,
        previousScrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
  });

  it("still escapes slow trackpad once 10px off the locked bottom", () => {
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 588,
        previousScrollTop: 592,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("does not escape a shrink clamp that parks on the new max", () => {
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        scrollTop: 400,
        previousScrollTop: 600,
        scrollHeight: 1000,
        clientHeight: ch,
      }),
    ).toBe(false);
  });
});

describe("programmatic stick scroll ignore", () => {
  it("hands the written top to the next scroll event once", () => {
    const el = { id: "vp" } as unknown as Element;
    markProgrammaticStickScroll(el, 592);
    expect(takeProgrammaticStickScroll(el)).toBe(592);
    expect(takeProgrammaticStickScroll(el)).toBeUndefined();
  });
});

describe("unreliable viewport / programmatic leave", () => {
  it("treats hidden and tiny clientHeight as unreliable", () => {
    expect(isStickViewportUnreliable({ clientHeight: 800 })).toBe(false);
    expect(isStickViewportUnreliable({ clientHeight: 0 })).toBe(true);
    expect(
      isStickViewportUnreliable({
        clientHeight: STICK_MIN_VIEWPORT_HEIGHT_PX - 1,
      }),
    ).toBe(true);
    expect(
      isStickViewportUnreliable({ clientHeight: 800, hidden: true }),
    ).toBe(true);
    expect(
      isStickViewportUnreliable({ clientHeight: 800, hidden: false }),
    ).toBe(false);
  });

  it("restores tail follow only when coming back while still pinned", () => {
    expect(
      shouldRestorePinnedFollowOnViewportReady({
        pinned: true,
        escaped: false,
        viewportWasUnreliable: true,
        viewportIsReliable: true,
      }),
    ).toBe(true);
    expect(
      shouldRestorePinnedFollowOnViewportReady({
        pinned: false,
        escaped: true,
        viewportWasUnreliable: true,
        viewportIsReliable: true,
      }),
    ).toBe(false);
    expect(
      shouldRestorePinnedFollowOnViewportReady({
        pinned: true,
        escaped: false,
        viewportWasUnreliable: false,
        viewportIsReliable: true,
      }),
    ).toBe(false);
  });

  it("does not treat a tagged programmatic scrollTop write as a user leave", () => {
    expect(shouldIgnoreProgrammaticStickLeave(640)).toBe(true);
    expect(shouldIgnoreProgrammaticStickLeave(undefined)).toBe(false);
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
