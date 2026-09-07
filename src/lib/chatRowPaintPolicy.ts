/**
 * Markdown paint vs geometric window.
 *
 * Compositor owns finger tracking (full refresh). This module only decides
 * which mounted rows run ReactMarkdown:
 * - During a gesture / fling, freeze the committed rich band (geo-clamped).
 * - Once idle, snap to the full target if the viewport moved; extra overscan
 *   beyond an overlapping band still hydrates a few rows per frame.
 * - Pin snaps to the tail when the finger is up.
 */

export type ChatRichBand = {
  richStart: number;
  richEnd: number;
};

/** New markdown rows per idle commit when expanding overscan, not filling a hole. */
export const CHAT_RICH_HYDRATE_ROWS_PER_COMMIT = 3;

export function chatRichBandIsEmpty(band: ChatRichBand): boolean {
  return band.richEnd <= band.richStart;
}

export function chatRowPaint(
  index: number,
  band: ChatRichBand,
): "rich" | "shell" {
  if (chatRichBandIsEmpty(band)) return "shell";
  return index >= band.richStart && index < band.richEnd ? "rich" : "shell";
}

export function intersectChatRichBand(
  band: ChatRichBand,
  geoStart: number,
  geoEnd: number,
): ChatRichBand {
  const s = Math.max(band.richStart, geoStart);
  const e = Math.min(band.richEnd, geoEnd);
  if (e <= s) return { richStart: geoStart, richEnd: geoStart };
  return { richStart: s, richEnd: e };
}

export function chatRichBandsOverlap(a: ChatRichBand, b: ChatRichBand): boolean {
  if (chatRichBandIsEmpty(a) || chatRichBandIsEmpty(b)) return false;
  return a.richStart < b.richEnd && b.richStart < a.richEnd;
}

function includeForceIndices(
  band: ChatRichBand,
  geoStart: number,
  geoEnd: number,
  forceIndices: readonly number[] | undefined,
): ChatRichBand {
  if (!forceIndices?.length) return band;
  let s = band.richStart;
  let e = band.richEnd;
  let any = e > s;
  for (const raw of forceIndices) {
    const i = Math.floor(raw);
    if (i < geoStart || i >= geoEnd) continue;
    if (!any) {
      s = i;
      e = i + 1;
      any = true;
      continue;
    }
    if (i >= s && i < e) continue;
    if (i === e) e = i + 1;
    else if (i === s - 1) s = i;
  }
  if (!any) return band;
  return { richStart: s, richEnd: e };
}

export function chatRichBandNeedsFollowUp(
  committed: ChatRichBand,
  target: ChatRichBand,
): boolean {
  return (
    committed.richStart !== target.richStart ||
    committed.richEnd !== target.richEnd
  );
}

/**
 * Step the committed markdown band toward `target`.
 *
 * Gesture/fling: freeze (geo-clamp only). Idle hole: whole target in one
 * commit. Idle overlap: expand at most hydrateRows. Pin: snap to tail.
 */
export function nextChatRichBand(input: {
  target: ChatRichBand;
  committed: ChatRichBand;
  geoStart: number;
  geoEnd: number;
  scrolling: boolean;
  pinToBottom?: boolean;
  forceIndices?: readonly number[];
  hydrateRows?: number;
  maxRows?: number;
}): ChatRichBand {
  const geoStart = input.geoStart;
  const geoEnd = Math.max(geoStart, input.geoEnd);
  const target = includeForceIndices(
    intersectChatRichBand(input.target, geoStart, geoEnd),
    geoStart,
    geoEnd,
    input.forceIndices,
  );

  if (input.pinToBottom && !input.scrolling) {
    return target;
  }

  const live = includeForceIndices(
    intersectChatRichBand(input.committed, geoStart, geoEnd),
    geoStart,
    geoEnd,
    input.forceIndices,
  );

  if (input.scrolling) {
    return live;
  }

  if (chatRichBandIsEmpty(live) || !chatRichBandsOverlap(live, target)) {
    return target;
  }

  const cap = Math.max(1, input.hydrateRows ?? CHAT_RICH_HYDRATE_ROWS_PER_COMMIT);
  let s = live.richStart;
  let e = live.richEnd;
  let budget = cap;
  if (target.richStart < s && budget > 0) {
    const take = Math.min(budget, s - target.richStart);
    s -= take;
    budget -= take;
  }
  if (target.richEnd > e && budget > 0) {
    const take = Math.min(budget, target.richEnd - e);
    e += take;
  }
  if (target.richStart > s) s = target.richStart;
  if (target.richEnd < e) e = target.richEnd;
  if (e <= s) return { richStart: geoStart, richEnd: geoStart };
  return { richStart: s, richEnd: e };
}
