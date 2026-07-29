/**
 * Variable-height virtual window for the main chat transcript.
 *
 * Designed to coexist with stick-to-bottom:
 * - When `pinToBottom`, always include the last row and build the window upward
 *   so streaming tail stays mounted.
 * - Spacers keep total scrollHeight stable so pin/escape math stays valid.
 */

/** Only virtualize long threads — short chats keep full DOM (identical UX). */
export const CHAT_VIRTUALIZE_THRESHOLD = 48;

/** Fallback height before a row is measured (px). */
export const CHAT_DEFAULT_ROW_ESTIMATE_PX = 120;

/** Cap a single estimated row so one mega-answer cannot dominate scroll math. */
export const CHAT_MAX_ROW_ESTIMATE_PX = 8000;

/** Extra px above/below the viewport when browsing history. */
export const CHAT_OVERSCAN_PX = 1200;

/** When pinned, pull in more history above the tail so pin feels continuous. */
export const CHAT_PIN_OVERSCAN_PX = 1600;

/**
 * Content-aware row estimate so tall assistant answers (diagrams, tables)
 * are not first measured as ~120px (that underestimates scrollHeight and
 * makes mid-document look "near bottom" → stick bounce).
 */
export function estimateChatRowHeight(input: {
  contentLength?: number;
  thoughtLength?: number;
  role?: string;
  /** When true, row is typically height-0 (inlined tool / hidden journal step). */
  collapsed?: boolean;
}): number {
  // Collapsed tool_step rows used to estimate 40–120px then measure 0, which
  // inflated scrollHeight and left the pin window on a blank tail.
  if (input.collapsed) return 0;
  const content = Math.max(0, input.contentLength ?? 0);
  const thought = Math.max(0, input.thoughtLength ?? 0);
  const role = (input.role ?? "assistant").toLowerCase();
  // Journal tool rows are almost always inlined into the assistant timeline
  // (height 0). Prefer a tiny estimate so long agent turns do not fake a tall
  // scroll range that collapses after measure.
  if (role === "tool") {
    // Standalone tool timeline row (~one line) only if it has real content.
    if (content <= 0) return 0;
    return 36;
  }
  // ~42 chars/line in the bubble, ~20px line height, role chrome.
  const lines = Math.ceil((content + thought * 0.5) / 42);
  const chrome = role === "user" ? 72 : 96;
  const raw = chrome + lines * 20;
  return Math.min(
    CHAT_MAX_ROW_ESTIMATE_PX,
    Math.max(CHAT_DEFAULT_ROW_ESTIMATE_PX, raw),
  );
}

export type ChatVirtualWindow = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
};

/** Cumulative offsets: offsets[i] = sum(heights[0..i)). Length = count+1. */
export function cumulativeOffsets(
  count: number,
  getHeight: (index: number) => number,
): number[] {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) {
    const h = Math.max(0, getHeight(i));
    offsets[i + 1] = (offsets[i] ?? 0) + h;
  }
  return offsets;
}

/**
 * Compute the visible index range + spacers for a variable-height list.
 */
export function computeChatVirtualWindow(input: {
  count: number;
  getHeight: (index: number) => number;
  scrollTop: number;
  viewportHeight: number;
  overscanPx?: number;
  /** Stick-to-bottom active — force include last item, prefer tail. */
  pinToBottom?: boolean;
  /** Indices that must stay mounted (find hit, streaming assistant, …). */
  forceIndices?: readonly number[];
}): ChatVirtualWindow {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  const offsets = cumulativeOffsets(count, input.getHeight);
  const totalHeight = offsets[count] ?? 0;
  const viewportHeight = Math.max(0, input.viewportHeight);
  const pin = !!input.pinToBottom;
  const overscan = Math.max(
    0,
    input.overscanPx ?? (pin ? CHAT_PIN_OVERSCAN_PX : CHAT_OVERSCAN_PX),
  );

  // When pinned, treat the viewport as parked on the absolute bottom so the
  // window always covers the streaming tail even if scrollTop lags one frame.
  let viewTop = Math.max(0, input.scrollTop);
  let viewBottom = viewTop + viewportHeight;
  if (pin) {
    viewBottom = totalHeight;
    viewTop = Math.max(0, totalHeight - Math.max(viewportHeight, 1));
  }

  const rangeTop = Math.max(0, viewTop - overscan);
  const rangeBottom = Math.min(totalHeight, viewBottom + overscan);

  // First index whose bottom edge is past rangeTop.
  let start = 0;
  for (let i = 0; i < count; i++) {
    const bottom = offsets[i + 1] ?? 0;
    if (bottom > rangeTop) {
      start = i;
      break;
    }
    start = i;
  }

  // First index whose top is >= rangeBottom (exclusive end).
  let end = count;
  for (let i = start; i < count; i++) {
    const top = offsets[i] ?? 0;
    if (top >= rangeBottom) {
      end = i;
      break;
    }
  }
  if (end <= start) end = Math.min(count, start + 1);

  if (pin) {
    end = count;
  }

  // Force-include indices (find match, live assistant, last user, …).
  if (input.forceIndices?.length) {
    for (const raw of input.forceIndices) {
      const i = Math.floor(raw);
      if (i < 0 || i >= count) continue;
      if (i < start) start = i;
      if (i >= end) end = i + 1;
    }
  }

  start = Math.max(0, Math.min(start, count - 1));
  end = Math.max(start + 1, Math.min(end, count));

  const paddingTop = offsets[start] ?? 0;
  const rendered = (offsets[end] ?? 0) - paddingTop;
  const paddingBottom = Math.max(0, totalHeight - paddingTop - rendered);

  return { start, end, paddingTop, paddingBottom, totalHeight };
}

/**
 * When a row above the viewport changes height, shift scrollTop so the
 * visible content does not jump (critical when reading history / escaped).
 */
export function scrollTopAfterHeightChange(input: {
  scrollTop: number;
  rowOffset: number;
  delta: number;
  pinToBottom: boolean;
}): number {
  if (input.pinToBottom) return input.scrollTop;
  if (input.delta === 0) return input.scrollTop;
  // Only rows strictly above the current viewport top affect scroll position.
  // Rows that straddle or sit below the viewport top expand downward — do not
  // shift scrollTop (that is what made tall diagram rows "bounce").
  if (input.rowOffset >= input.scrollTop - 0.5) return input.scrollTop;
  return Math.max(0, input.scrollTop + input.delta);
}

/**
 * Whether a remeasure should update the height cache.
 * Ignore tiny flicker; resist shrink thrash (markdown/code reflow) that
 * oscillates padding and fights stick-to-bottom.
 */
export function shouldCommitRowHeight(
  prev: number | undefined,
  next: number,
): boolean {
  if (next < 0) return false;
  // Collapsed / inlined tool spacers measure 0 — must commit so pin windows
  // do not keep inflated estimates and paint a blank tail.
  if (next === 0) {
    if (prev == null) return true;
    if (prev === 0) return false;
    return true;
  }
  if (prev == null) return true;
  const delta = next - prev;
  if (Math.abs(delta) < 2) return false;
  // Allow growth freely; only accept shrinks that are meaningful and stable.
  if (delta < 0 && Math.abs(delta) < Math.max(24, prev * 0.08)) {
    return false;
  }
  return true;
}
