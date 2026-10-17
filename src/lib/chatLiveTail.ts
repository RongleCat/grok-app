/**
 * Split the streaming tail out of the virtual list.
 *
 * A running last row inside an absolutely-positioned / spacer-measured window
 * grows in DOM first; ResizeObserver then backfills totalSize/scrollTop one
 * frame later — that is the bounce at the stream tail. Keep only the last
 * streaming message in normal flow; settled history stays windowed.
 */

export type ChatLiveTailRow = {
  streaming?: boolean;
};

export type ChatLiveTailSplit<T extends ChatLiveTailRow> = {
  history: readonly T[];
  live: T | null;
  liveIndex: number | null;
};

export function splitChatLiveTail<T extends ChatLiveTailRow>(
  messages: readonly T[],
): ChatLiveTailSplit<T> {
  const liveIndex = messages.length - 1;
  const live = messages[liveIndex];
  if (!live?.streaming) {
    return { history: messages, live: null, liveIndex: null };
  }
  return {
    history: messages.slice(0, liveIndex),
    live,
    liveIndex,
  };
}

/**
 * The live tail just settled back into the virtual window (streaming end).
 * The remounted row lands on an estimate height while pinned height commits
 * never rewrite scrollTop (scrollTopAfterHeightChange returns it unchanged),
 * so the estimate error stays parked unless the viewport snaps once more
 * after the remount settles. Only a following viewport snaps — never yank a
 * user who left the tail mid-stream.
 */
export function shouldStickOnLiveTailSettle(input: {
  prevLiveTailId: string | null;
  liveTailId: string | null;
  pinned: boolean;
}): boolean {
  if (input.prevLiveTailId == null) return false;
  if (input.liveTailId != null) return false;
  return input.pinned;
}
