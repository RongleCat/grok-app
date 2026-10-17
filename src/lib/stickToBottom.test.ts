import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STICK_ESCAPE_MIN_DELTA_PX,
  STICK_BOTTOM_REBOUND_INTENT_MS,
  STICK_BOTTOM_REBOUND_SETTLE_MS,
  STICK_HEIGHT_NOISE_PX,
  STICK_TO_BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  distanceFromBottom,
  isHeightDeltaNoise,
  isMeaningfulScrollUp,
  isNearBottom,
  pinnedFollowDelayMs,
  pinnedFollowDelayForLayout,
  pinnedWindowRestoreDist,
  shouldBumpStickOnBusyEdge,
  stabilizeStickUserId,
  shouldClampPinnedOverscroll,
  shouldEscapePinnedScroll,
  shouldClampPinnedStreamDrift,
  shouldRecoverPinnedLayoutClamp,
  shouldRecoverPinnedClampBeforePaint,
  STICK_CLAMP_GUARD_INPUT_QUIET_MS,
  PINNED_LAYOUT_CLAMP_RECOVER_PX,
  shouldForcePinnedSnapOnOpen,
  shouldReleaseStickOnDistanceFromBottom,
  shouldSnapPinnedLayoutToBottom,
  shouldSettleBottomRebound,
  shouldEscapePinnedWheel,
  isConversationOpenFollowActive,
  transcriptStickIdentity,
  shouldFollowPinnedMediaReveal,
  shouldSnapToTailOnTurnSettle,
  STICK_MEDIA_FOLLOW_DELAY_MS,
  STICK_MEDIA_HEIGHT_PX,
  STICK_OPEN_FOLLOW_MS,
} from "./stickToBottom";

describe("bottom overscroll rebound", () => {
  it("settles a recent downward rebound inside the tail band", () => {
    expect(
      shouldSettleBottomRebound({
        downIntentActive: true,
        previousScrollTop: 610,
        scrollTop: 590,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("covers a queue/composer height increase during the rebound", () => {
    // Old bottom was 600. Queue chrome adds 40px before the elastic settle.
    expect(
      shouldSettleBottomRebound({
        downIntentActive: true,
        previousScrollTop: 620,
        scrollTop: 600,
        scrollHeight: 1040,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("does not steal a real reverse gesture or history scroll", () => {
    expect(
      shouldSettleBottomRebound({
        downIntentActive: false,
        previousScrollTop: 620,
        scrollTop: 600,
        scrollHeight: 1040,
        clientHeight: 400,
      }),
    ).toBe(false);
    expect(
      shouldSettleBottomRebound({
        downIntentActive: true,
        previousScrollTop: 500,
        scrollTop: 450,
        scrollHeight: 1200,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it("uses a grace longer than the quiet settle window", () => {
    expect(STICK_BOTTOM_REBOUND_INTENT_MS).toBeGreaterThan(
      STICK_BOTTOM_REBOUND_SETTLE_MS,
    );
  });
});

describe("shouldEscapePinnedWheel", () => {
  it("escapes on any upward tick while the transcript overflows", () => {
    expect(
      shouldEscapePinnedWheel({
        pinned: true,
        escaped: false,
        deltaY: -1,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(true);
  });

  it("does not escape downward ticks or already-escaped / no-overflow", () => {
    expect(
      shouldEscapePinnedWheel({
        pinned: true,
        escaped: false,
        deltaY: 8,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
    expect(
      shouldEscapePinnedWheel({
        pinned: true,
        escaped: true,
        deltaY: -20,
        scrollHeight: 1000,
        clientHeight: 400,
      }),
    ).toBe(false);
    expect(
      shouldEscapePinnedWheel({
        pinned: true,
        escaped: false,
        deltaY: -20,
        scrollHeight: 400,
        clientHeight: 400,
      }),
    ).toBe(false);
  });
});

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

describe("pinnedFollowDelayMs", () => {
  it("follows stream-sized growth this frame", () => {
    expect(pinnedFollowDelayMs(0)).toBe(0);
    expect(pinnedFollowDelayMs(8)).toBe(0);
    expect(pinnedFollowDelayMs(23)).toBe(0);
  });

  it("coalesces image/PDF-sized jumps", () => {
    expect(STICK_MEDIA_HEIGHT_PX).toBe(24);
    expect(pinnedFollowDelayMs(24)).toBe(STICK_MEDIA_FOLLOW_DELAY_MS);
    expect(pinnedFollowDelayMs(400)).toBe(STICK_MEDIA_FOLLOW_DELAY_MS);
  });

  it("follows shrinks this frame (thought auto-collapse, #1246)", () => {
    expect(pinnedFollowDelayMs(-180)).toBe(0);
    expect(pinnedFollowDelayMs(-24)).toBe(0);
  });

  it("treats non-finite as immediate", () => {
    expect(pinnedFollowDelayMs(Number.NaN)).toBe(0);
  });
});

describe("pinnedFollowDelayForLayout", () => {
  it("follows immediately when the viewport width is interpolating", () => {
    expect(
      pinnedFollowDelayForLayout({
        heightDelta: 400,
        viewportWidthChanged: true,
      }),
    ).toBe(0);
  });

  it("keeps the media delay when only height jumped", () => {
    expect(
      pinnedFollowDelayForLayout({
        heightDelta: 400,
        viewportWidthChanged: false,
      }),
    ).toBe(STICK_MEDIA_FOLLOW_DELAY_MS);
  });

  it("follows shrinks immediately even when only height jumped (#1246)", () => {
    expect(
      pinnedFollowDelayForLayout({
        heightDelta: -220,
        viewportWidthChanged: false,
      }),
    ).toBe(0);
  });

  it("follows image-sized jumps immediately while a chat is opening", () => {
    expect(
      pinnedFollowDelayForLayout({
        heightDelta: 400,
        viewportWidthChanged: false,
        conversationOpening: true,
      }),
    ).toBe(0);
  });
});

describe("pinnedWindowRestoreDist", () => {
  it("snaps to the tail while stick is still following (#1246)", () => {
    expect(
      pinnedWindowRestoreDist({
        pinned: true,
        forceOpen: false,
        preCommitDist: 220,
      }),
    ).toBe(0);
  });

  it("keeps pre-commit distance after the user left the tail", () => {
    expect(
      pinnedWindowRestoreDist({
        pinned: false,
        forceOpen: false,
        preCommitDist: 180,
      }),
    ).toBe(180);
  });
});

describe("isConversationOpenFollowActive", () => {
  it("stays active for the open-follow window while still pinned", () => {
    expect(STICK_OPEN_FOLLOW_MS).toBeGreaterThanOrEqual(400);
    expect(
      isConversationOpenFollowActive({
        now: 100,
        until: 500,
        escaped: false,
      }),
    ).toBe(true);
  });

  it("stops when the user leaves the bottom or the window elapses", () => {
    expect(
      isConversationOpenFollowActive({
        now: 100,
        until: 500,
        escaped: true,
      }),
    ).toBe(false);
    expect(
      isConversationOpenFollowActive({
        now: 500,
        until: 500,
        escaped: false,
      }),
    ).toBe(false);
  });
});

describe("shouldSnapToTailOnTurnSettle", () => {
  it("keeps a following viewport on the stream tail when the turn ends", () => {
    expect(
      shouldSnapToTailOnTurnSettle({
        wasBusy: true,
        nowBusy: false,
        wasPinned: true,
      }),
    ).toBe(true);
  });

  it("does not yank a user who left the tail mid-stream", () => {
    expect(
      shouldSnapToTailOnTurnSettle({
        wasBusy: true,
        nowBusy: false,
        wasPinned: false,
      }),
    ).toBe(false);
  });

  it("does not snap on send or while still streaming", () => {
    expect(
      shouldSnapToTailOnTurnSettle({
        wasBusy: false,
        nowBusy: true,
        wasPinned: true,
      }),
    ).toBe(false);
    expect(
      shouldSnapToTailOnTurnSettle({
        wasBusy: true,
        nowBusy: true,
        wasPinned: true,
      }),
    ).toBe(false);
    expect(
      shouldSnapToTailOnTurnSettle({
        wasBusy: false,
        nowBusy: false,
        wasPinned: true,
      }),
    ).toBe(false);
  });

  it("wires turn-settle tail snap in the transcript", () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../components/lobe-chat/ConversationThread.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("shouldSnapToTailOnTurnSettle");
    expect(src).toContain("splitChatLiveTail");
  });
});

describe("transcriptStickIdentity", () => {
  it("stays pending until the journal has rows or is confirmed ready", () => {
    expect(
      transcriptStickIdentity({
        sessionKey: "s1",
        hasMessages: false,
        journalReady: false,
      }),
    ).toBe("s1:pending");
  });

  it("becomes ready when cached or hydrated rows exist", () => {
    expect(
      transcriptStickIdentity({
        sessionKey: "s1",
        hasMessages: true,
        journalReady: false,
      }),
    ).toBe("s1:ready");
    expect(
      transcriptStickIdentity({
        sessionKey: "s1",
        hasMessages: false,
        journalReady: true,
      }),
    ).toBe("s1:ready");
  });

  it("does not change again as the live turn grows", () => {
    const open = transcriptStickIdentity({
      sessionKey: "s1",
      hasMessages: true,
      journalReady: true,
    });
    const later = transcriptStickIdentity({
      sessionKey: "s1",
      hasMessages: true,
      journalReady: true,
    });
    expect(open).toBe(later);
    expect(open).toBe("s1:ready");
  });
});

describe("shouldFollowPinnedMediaReveal", () => {
  it("follows when pinned and new media cards appear after open", () => {
    expect(
      shouldFollowPinnedMediaReveal({
        pinned: true,
        prevMediaCount: 0,
        nextMediaCount: 7,
      }),
    ).toBe(true);
  });

  it("does not yank a user who has left the bottom", () => {
    expect(
      shouldFollowPinnedMediaReveal({
        pinned: false,
        prevMediaCount: 0,
        nextMediaCount: 7,
      }),
    ).toBe(false);
  });

  it("ignores non-increasing attachment counts", () => {
    expect(
      shouldFollowPinnedMediaReveal({
        pinned: true,
        prevMediaCount: 7,
        nextMediaCount: 7,
      }),
    ).toBe(false);
    expect(
      shouldFollowPinnedMediaReveal({
        pinned: true,
        prevMediaCount: 7,
        nextMediaCount: 3,
      }),
    ).toBe(false);
  });
});

describe("shouldForcePinnedSnapOnOpen", () => {
  it("lands on the tail even when leftover distance looks like a leave", () => {
    expect(
      shouldForcePinnedSnapOnOpen({
        pinned: true,
        forceOpenSnap: true,
      }),
    ).toBe(true);
    expect(
      shouldSnapPinnedLayoutToBottom({
        scrollTop: 0,
        scrollHeight: 8000,
        clientHeight: 600,
      }),
    ).toBe(false);
  });

  it("does not yank after the user has escaped", () => {
    expect(
      shouldForcePinnedSnapOnOpen({
        pinned: false,
        forceOpenSnap: true,
        escaped: true,
      }),
    ).toBe(false);
    expect(
      shouldForcePinnedSnapOnOpen({
        pinned: true,
        forceOpenSnap: false,
      }),
    ).toBe(false);
  });

  it("virtualizer open-snap follows the live stick flag, not a hardcoded pin", () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../hooks/useChatMessageVirtualizer.ts",
      ),
      "utf8",
    );
    expect(src).toContain("pinned: !!isPinnedRef.current");
    expect(src).toContain("shouldWritePinnedWindowScrollTop");
    expect(src).toContain("scrollTopAfterHeightChange");
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

describe("shouldReleaseStickOnDistanceFromBottom", () => {
  const sh = 1000;
  const ch = 400;
  // maxTop = 600

  it("stays pinned for tiny ticks under 10px from the bottom", () => {
    expect(
      shouldReleaseStickOnDistanceFromBottom({
        pinned: true,
        scrollTop: 595,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false); // 5px
    expect(
      shouldReleaseStickOnDistanceFromBottom({
        pinned: true,
        scrollTop: 591,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false); // 9px
  });

  it("releases after accumulated 10px even if no single tick was 10px", () => {
    // Three 4px trackpad ticks: 600 → 596 → 592 → 588. Last event is 4px,
    // so isMeaningfulScrollUp is false; distance from bottom is 12px.
    expect(isMeaningfulScrollUp(588, 592)).toBe(false);
    expect(
      shouldReleaseStickOnDistanceFromBottom({
        pinned: true,
        scrollTop: 588,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
  });

  it("does not release when unpinned or already escaped", () => {
    const away = {
      scrollTop: 500,
      scrollHeight: sh,
      clientHeight: ch,
    };
    expect(
      shouldReleaseStickOnDistanceFromBottom({ pinned: false, ...away }),
    ).toBe(false);
    expect(
      shouldReleaseStickOnDistanceFromBottom({
        pinned: true,
        escaped: true,
        ...away,
      }),
    ).toBe(false);
  });
});

describe("shouldSnapPinnedLayoutToBottom", () => {
  const sh = 1000;
  const ch = 400;

  it("snaps only while still near the absolute bottom", () => {
    expect(
      shouldSnapPinnedLayoutToBottom({
        scrollTop: 600,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true);
    expect(
      shouldSnapPinnedLayoutToBottom({
        scrollTop: 592,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(true); // 8px, still under leave threshold
  });

  it("does not snap once the user has left by 10px", () => {
    expect(
      shouldSnapPinnedLayoutToBottom({
        scrollTop: 590,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
    expect(
      shouldSnapPinnedLayoutToBottom({
        scrollTop: 400,
        scrollHeight: sh,
        clientHeight: ch,
      }),
    ).toBe(false);
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

describe("stabilizeStickUserId", () => {
  it("keeps the optimistic id when journal rewrites the last user", () => {
    expect(
      stabilizeStickUserId({
        prevId: "u-1787240481019",
        nextId: "857cd02c-7159-41a2-8083-ce28d831e5b7",
        prevUserCount: 12,
        nextUserCount: 12,
      }),
    ).toBe("u-1787240481019");
  });

  it("takes the new id on a new send or rewind", () => {
    expect(
      stabilizeStickUserId({
        prevId: "u-1",
        nextId: "u-2",
        prevUserCount: 11,
        nextUserCount: 12,
      }),
    ).toBe("u-2");
    expect(
      stabilizeStickUserId({
        prevId: "u-2",
        nextId: "u-1",
        prevUserCount: 12,
        nextUserCount: 11,
      }),
    ).toBe("u-1");
  });

  it("takes the new id on conversation switch", () => {
    expect(
      stabilizeStickUserId({
        prevId: "u-1",
        nextId: "other-user",
        prevUserCount: 12,
        nextUserCount: 12,
        conversationChanged: true,
      }),
    ).toBe("other-user");
  });
});

describe("shouldRecoverPinnedLayoutClamp", () => {
  it("recovers a pinned viewport parked far off the bottom by a layout clamp", () => {
    // scrollHeight 9000, clientHeight 848 → maxTop 8152; clamp parked at 7889
    expect(
      shouldRecoverPinnedLayoutClamp({
        pinned: true,
        escaped: false,
        scrollTop: 7889,
        scrollHeight: 9000,
        clientHeight: 848,
      }),
    ).toBe(true);
  });

  it("ignores sub-threshold drift while pinned", () => {
    const maxTop = bottomScrollTop(9000, 848);
    expect(
      shouldRecoverPinnedLayoutClamp({
        pinned: true,
        escaped: false,
        scrollTop: maxTop - (PINNED_LAYOUT_CLAMP_RECOVER_PX - 1),
        scrollHeight: 9000,
        clientHeight: 848,
      }),
    ).toBe(false);
  });

  it("never fires once the user escaped (reading history)", () => {
    expect(
      shouldRecoverPinnedLayoutClamp({
        pinned: false,
        escaped: true,
        scrollTop: 100,
        scrollHeight: 9000,
        clientHeight: 848,
      }),
    ).toBe(false);
  });
});

describe("shouldRecoverPinnedClampBeforePaint", () => {
  it("restores a browser-clamped pinned viewport while input-quiet", () => {
    // #1257: scrollTop 9460 clamped to 8182 (dist 1278) with no JS writer,
    // 2.6s after the last trackpad input — must recover before paint.
    expect(
      shouldRecoverPinnedClampBeforePaint({
        pinned: true,
        escaped: false,
        scrollTop: 8182,
        scrollHeight: 10307,
        clientHeight: 847,
        msSinceUserInput: 2600,
      }),
    ).toBe(true);
  });

  it("never fights a fresh user gesture", () => {
    expect(
      shouldRecoverPinnedClampBeforePaint({
        pinned: true,
        escaped: false,
        scrollTop: 8182,
        scrollHeight: 10307,
        clientHeight: 847,
        msSinceUserInput: STICK_CLAMP_GUARD_INPUT_QUIET_MS - 1,
      }),
    ).toBe(false);
  });

  it("stays silent for sub-threshold drift and after escape", () => {
    const maxTop = bottomScrollTop(10307, 847);
    expect(
      shouldRecoverPinnedClampBeforePaint({
        pinned: true,
        escaped: false,
        scrollTop: maxTop - (PINNED_LAYOUT_CLAMP_RECOVER_PX - 1),
        scrollHeight: 10307,
        clientHeight: 847,
        msSinceUserInput: 5000,
      }),
    ).toBe(false);
    expect(
      shouldRecoverPinnedClampBeforePaint({
        pinned: false,
        escaped: true,
        scrollTop: 8182,
        scrollHeight: 10307,
        clientHeight: 847,
        msSinceUserInput: 5000,
      }),
    ).toBe(false);
  });
});

describe("shouldEscapePinnedScroll hard-bottom clamp exemption (#1257)", () => {
  it("does not escape an input-quiet scroll-up from the hard bottom (layout clamp)", () => {
    // #1257: pin write 10510, maxTop 10511 (gutter drift) — the overscroll
    // exemption missed by 1px; the clamp to 9623 then escaped and parked the
    // reader mid-message with no recovery.
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        escaped: false,
        scrollTop: 9623,
        previousScrollTop: 10510,
        scrollHeight: 10957,
        clientHeight: 446,
        msSinceUserInput: 211,
      }),
    ).toBe(false);
  });

  it("still escapes a real gesture right after input", () => {
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        escaped: false,
        scrollTop: 9623,
        previousScrollTop: 10510,
        scrollHeight: 10957,
        clientHeight: 446,
        msSinceUserInput: 40,
      }),
    ).toBe(true);
  });

  it("keeps the exemption alive while the stream grows the max (#1257 mid-stream)", () => {
    // Pin write landed on the old max (14727-421); by the time the clamp
    // scroll event fires the stream has grown the max to 14334 — the old
    // write must still count as "on the hard bottom at write time".
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        escaped: false,
        scrollTop: 14157,
        previousScrollTop: 14306,
        scrollHeight: 14755,
        previousScrollHeight: 14727,
        clientHeight: 421,
        msSinceUserInput: 6600,
      }),
    ).toBe(false);
  });

  it("does not exempt a previous position away from the hard bottom", () => {
    expect(
      shouldEscapePinnedScroll({
        pinned: true,
        escaped: false,
        scrollTop: 9623,
        previousScrollTop: 10300,
        scrollHeight: 10957,
        clientHeight: 446,
        msSinceUserInput: 5000,
      }),
    ).toBe(true);
  });
});

describe("shouldSnapToTailOnTurnSettle near-tail recovery (#1257)", () => {
  const settle = (over: Partial<Parameters<typeof shouldSnapToTailOnTurnSettle>[0]>) =>
    shouldSnapToTailOnTurnSettle({
      wasBusy: true,
      nowBusy: false,
      wasPinned: false,
      ...over,
    });

  it("snaps a lost pin that still sits near the tail", () => {
    // Pin lost to a clamp/remount race mid-turn; tail must not stay hidden
    // under the floating composer when the turn finishes.
    expect(settle({ distFromBottom: 800, snapWithinPx: 1200 })).toBe(true);
  });

  it("never yanks a deep history reader back to the tail", () => {
    expect(settle({ distFromBottom: 5000, snapWithinPx: 1200 })).toBe(false);
  });

  it("keeps the classic pinned path and ignores the band when pinned", () => {
    expect(settle({ wasPinned: true })).toBe(true);
    expect(settle({ wasPinned: true, distFromBottom: 5000, snapWithinPx: 1200 })).toBe(
      true,
    );
  });

  it("does not snap an unpinned viewport when distance is unknown", () => {
    expect(settle({})).toBe(false);
  });
});
