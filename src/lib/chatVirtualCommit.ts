/**
 * Urgent vs background lane for a chat virtual-window commit.
 *
 * Viewport rows stay on the urgent path. Overscan-only growth is chunked
 * and may render as a transition.
 */

import {
  chatRichBandNeedsFollowUp,
  chatRichBandsOverlap,
  intersectChatRichBand,
  nextChatRichBand,
} from "@/lib/chatRowPaintPolicy";
import {
  CHAT_DEFERRED_MOUNT_ROWS_PER_COMMIT,
  CHAT_RICH_MAX_ROWS,
  CHAT_VIEWPORT_COVER_MARGIN_PX,
  chatViewportRowRange,
  clampDeferredWindowExpansion,
  type ChatVirtualWindow,
} from "@/lib/chatVirtualList";

export function planChatVirtualWindowCommit(input: {
  next: ChatVirtualWindow;
  committed: ChatVirtualWindow;
  offsets: readonly number[];
  count: number;
  viewTop: number;
  viewBottom: number;
  pinToBottom: boolean;
  freezeRich: boolean;
  scrollTopWasWritten: boolean;
  forceIndices?: readonly number[];
}): {
  window: ChatVirtualWindow;
  deferrable: boolean;
  needsFollowUp: boolean;
} {
  let next = input.next;
  const { committed, offsets, count } = input;
  const cTopPx = offsets[Math.min(committed.start, count)] ?? 0;
  const cBottomPx = offsets[Math.min(committed.end, count)] ?? 0;
  const committedCoversViewport =
    cTopPx <= Math.max(0, input.viewTop - CHAT_VIEWPORT_COVER_MARGIN_PX) &&
    cBottomPx >=
      Math.min(next.totalHeight, input.viewBottom + CHAT_VIEWPORT_COVER_MARGIN_PX);
  const committedRich = {
    richStart: committed.richStart,
    richEnd: committed.richEnd,
  };
  const targetRichEarly = {
    richStart: next.richStart,
    richEnd: next.richEnd,
  };
  const viewRows = chatViewportRowRange({
    offsets,
    viewTop: input.viewTop,
    viewBottom: input.viewBottom,
    geoStart: next.start,
    geoEnd: next.end,
  });
  const viewBand = {
    richStart: viewRows.viewStart,
    richEnd: viewRows.viewEnd,
  };
  const liveRich = intersectChatRichBand(
    committedRich,
    next.start,
    next.end,
  );
  const richHole =
    !input.freezeRich && !chatRichBandsOverlap(liveRich, targetRichEarly);
  const viewportRichHole = !chatRichBandsOverlap(liveRich, viewBand);
  const deferrable =
    !input.scrollTopWasWritten &&
    committedCoversViewport &&
    !richHole &&
    !viewportRichHole;

  let needsFollowUp = false;
  if (deferrable) {
    const clamped = clampDeferredWindowExpansion({
      targetStart: next.start,
      targetEnd: next.end,
      committedStart: committed.start,
      committedEnd: committed.end,
      pinToBottom: input.pinToBottom,
      maxRows: CHAT_DEFERRED_MOUNT_ROWS_PER_COMMIT,
      forceIndices: input.forceIndices,
    });
    if (clamped.start !== next.start || clamped.end !== next.end) {
      next = {
        ...next,
        start: clamped.start,
        end: clamped.end,
        paddingTop: offsets[clamped.start] ?? 0,
        paddingBottom: Math.max(
          0,
          next.totalHeight -
            (offsets[Math.min(clamped.end, count)] ?? next.totalHeight),
        ),
      };
      needsFollowUp = true;
    }
  }

  const targetRich = {
    richStart: next.richStart,
    richEnd: next.richEnd,
  };
  const steppedRich = nextChatRichBand({
    target: targetRich,
    committed: committedRich,
    geoStart: next.start,
    geoEnd: next.end,
    scrolling: input.freezeRich,
    pinToBottom: input.pinToBottom,
    forceIndices: input.forceIndices,
    maxRows: CHAT_RICH_MAX_ROWS,
    viewStart: viewRows.viewStart,
    viewEnd: viewRows.viewEnd,
  });
  next = {
    ...next,
    richStart: steppedRich.richStart,
    richEnd: steppedRich.richEnd,
  };
  if (
    !input.freezeRich &&
    chatRichBandNeedsFollowUp(
      steppedRich,
      intersectChatRichBand(targetRich, next.start, next.end),
    )
  ) {
    needsFollowUp = true;
  }
  return { window: next, deferrable, needsFollowUp };
}
