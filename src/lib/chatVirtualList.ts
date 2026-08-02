/**
 * Variable-height virtual window for the main chat transcript.
 *
 * Designed to coexist with stick-to-bottom:
 * - When `pinToBottom`, always include the last row and build the window upward
 *   so streaming tail stays mounted.
 * - Spacers keep total scrollHeight stable so pin/escape math stays valid.
 *
 * Perf (long sessions):
 * - Binary search over cumulative offsets (O(log n) range find).
 * - Adaptive overscan scales with viewport (not fixed multi-screen mounts).
 * - Force-indices expand only nearby when escaped — distant tail force must
 *   not mount the entire remainder of a long chat (history-browse jank).
 * - Multi-turn agent chats (tool/phase rows) virtualize earlier than pure Q&A.
 */

import { CHAT_VIRTUALIZE_THRESHOLD_PERF } from "./streamRenderPolicy";

/**
 * Only virtualize longer threads — short chats keep full DOM.
 * Multi-turn agent sessions grow row count quickly (tools/phases), so the
 * threshold is intentionally lower than a pure chat transcript (was 48).
 */
export const CHAT_VIRTUALIZE_THRESHOLD = CHAT_VIRTUALIZE_THRESHOLD_PERF;

/** Fallback height before a row is measured (px). */
export const CHAT_DEFAULT_ROW_ESTIMATE_PX = 120;

/** Cap a single estimated row so one mega-answer cannot dominate scroll math. */
export const CHAT_MAX_ROW_ESTIMATE_PX = 8000;

/** Baseline extra px above/below the viewport when browsing history. */
export const CHAT_OVERSCAN_PX = 1200;

/** Baseline when pinned: more history above the tail so pin feels continuous. */
export const CHAT_PIN_OVERSCAN_PX = 1600;

/** Floor / ceiling for adaptive overscan (px). */
export const CHAT_OVERSCAN_MIN_PX = 700;
export const CHAT_OVERSCAN_MAX_PX = 1800;
export const CHAT_PIN_OVERSCAN_MIN_PX = 1000;
export const CHAT_PIN_OVERSCAN_MAX_PX = 2400;

/**
 * Max index gap when expanding the window for `forceIndices` while **escaped**.
 * Beyond this, locate/find must scroll the target into the natural window first
 * (ConversationThread already coarse-jumps `scrollTop`). Expanding across the
 * whole list defeated virtualization on multi-hundred-message threads.
 */
export const CHAT_FORCE_EXPAND_MAX_GAP = 12;

/**
 * Content-aware row estimate so tall assistant answers (diagrams, tables)
 * are not first measured as ~120px (that underestimates scrollHeight and
 * makes mid-document look "near bottom" → stick bounce).
 *
 * Media: fixed-size attachment thumbs (~64px) and inline video cards (~240px)
 * are not reflected in `contentLength` — include them so first paint is closer
 * to final height (fewer remeasure snaps near the bottom).
 */
export function estimateChatRowHeight(input: {
  contentLength?: number;
  thoughtLength?: number;
  role?: string;
  /** Message attachment cards (images/files under the bubble). */
  attachmentCount?: number;
  /** True when body likely embeds a local video card. */
  hasVideoCard?: boolean;
  /**
   * Inlined / collapsed tool rows (tool_step woven into an assistant timeline).
   * Must estimate 0 so the virtual pin window is not filled with phantom spacer
   * height — long agent turns otherwise paint a blank transcript.
   */
  collapsed?: boolean;
}): number {
  if (input.collapsed) return 0;
  const content = Math.max(0, input.contentLength ?? 0);
  const thought = Math.max(0, input.thoughtLength ?? 0);
  const role = (input.role ?? "assistant").toLowerCase();
  // Empty tool journal rows must not inflate the pin window (blank transcript).
  if (
    role === "tool" &&
    content === 0 &&
    thought === 0 &&
    !(input.attachmentCount && input.attachmentCount > 0) &&
    !input.hasVideoCard
  ) {
    return 0;
  }
  // ~42 chars/line in the bubble, ~20px line height, role chrome.
  const lines = Math.ceil((content + thought * 0.5) / 42);
  const chrome = role === "user" ? 72 : role === "tool" ? 28 : 96;
  const atts = Math.max(0, input.attachmentCount ?? 0);
  // 64px thumbs + gap, wrap ~5 per row in a ~360px stack.
  const attRows = atts > 0 ? Math.ceil(atts / 5) : 0;
  const attBoost = attRows * 74;
  const videoBoost = input.hasVideoCard ? 260 : 0;
  const raw = chrome + lines * 20 + attBoost + videoBoost;
  // Tool rows are compact; do not floor them at the assistant default (120px).
  const floor = role === "tool" ? 0 : CHAT_DEFAULT_ROW_ESTIMATE_PX;
  return Math.min(CHAT_MAX_ROW_ESTIMATE_PX, Math.max(floor, raw));
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
 * Adaptive overscan in px.
 * Scales with viewport so large monitors do not mount multi-screen markdown
 * windows, while short viewports still get enough runway for fling.
 * Optional `scale` multiplies after clamp (stream tail shrinks mounts).
 */
export function resolveChatOverscanPx(input: {
  viewportHeight: number;
  pinToBottom?: boolean;
  /** Explicit override (tests / callers). When set, `scale` still applies. */
  overscanPx?: number;
  /**
   * Multiplier after adaptive/override value (default 1).
   * Streaming callers pass resolveStreamOverscanScale (~0.55–0.75).
   */
  scale?: number;
}): number {
  let base: number;
  if (input.overscanPx != null && Number.isFinite(input.overscanPx)) {
    base = Math.max(0, input.overscanPx);
  } else {
    const vh = Math.max(0, input.viewportHeight);
    if (input.pinToBottom) {
      // ~1.5 viewports above the tail + small baseline, clamped.
      const raw = vh * 1.5 + 200;
      base = Math.round(
        Math.min(
          CHAT_PIN_OVERSCAN_MAX_PX,
          Math.max(CHAT_PIN_OVERSCAN_MIN_PX, raw, CHAT_PIN_OVERSCAN_PX * 0.75),
        ),
      );
    } else {
      // History browse: ~1 viewport of runway.
      const raw = vh * 1.1 + 100;
      base = Math.round(
        Math.min(
          CHAT_OVERSCAN_MAX_PX,
          Math.max(CHAT_OVERSCAN_MIN_PX, raw, CHAT_OVERSCAN_PX * 0.6),
        ),
      );
    }
  }
  const scale =
    input.scale != null && Number.isFinite(input.scale)
      ? Math.max(0, input.scale)
      : 1;
  if (scale === 1) return base;
  return Math.round(base * scale);
}

/**
 * First index whose bottom edge is past `y` (row intersects or sits below y).
 * `offsets` length = count + 1. O(log n).
 */
export function findStartIndex(offsets: number[], y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  if (y <= 0) return 0;
  // First i with offsets[i+1] > y.
  let lo = 0;
  let hi = count - 1;
  let ans = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bottom = offsets[mid + 1] ?? 0;
    if (bottom > y) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/**
 * First index whose top is ≥ `y` (exclusive end candidate). O(log n).
 */
export function findEndIndex(offsets: number[], y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  // First i with offsets[i] >= y; if none, count.
  let lo = 0;
  let hi = count;
  let ans = count;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (mid >= count) {
      ans = count;
      break;
    }
    const top = offsets[mid] ?? 0;
    if (top >= y) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return Math.min(count, ans);
}

/**
 * Expand [start, end) to include force indices.
 * - When pinned: always expand (blank-pin defense for tool-heavy tails).
 * - When escaped: only expand if within {@link CHAT_FORCE_EXPAND_MAX_GAP}
 *   of the natural window so history browse does not mount the whole tail.
 */
export function applyForceIndices(input: {
  start: number;
  end: number;
  count: number;
  forceIndices?: readonly number[];
  pinToBottom?: boolean;
  maxGap?: number;
}): { start: number; end: number } {
  let { start, end } = input;
  const count = input.count;
  const pin = !!input.pinToBottom;
  const maxGap = input.maxGap ?? CHAT_FORCE_EXPAND_MAX_GAP;
  if (!input.forceIndices?.length || count <= 0) {
    return { start, end };
  }
  for (const raw of input.forceIndices) {
    const i = Math.floor(raw);
    if (i < 0 || i >= count) continue;
    if (pin) {
      if (i < start) start = i;
      if (i >= end) end = i + 1;
      continue;
    }
    // Escaped: nearby expand only.
    if (i < start) {
      if (start - i <= maxGap) start = i;
    }
    if (i >= end) {
      // Distance from last included index (end - 1) to i.
      if (i - (end - 1) <= maxGap) end = i + 1;
    }
  }
  return { start, end };
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
  /**
   * Optional precomputed cumulative offsets (length count+1).
   * Callers that recompute on every scroll can cache these until heights change.
   */
  offsets?: readonly number[];
}): ChatVirtualWindow {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 };
  }

  const offsets: number[] =
    input.offsets && input.offsets.length === count + 1
      ? (input.offsets as number[])
      : cumulativeOffsets(count, input.getHeight);
  const totalHeight = offsets[count] ?? 0;
  const viewportHeight = Math.max(0, input.viewportHeight);
  const pin = !!input.pinToBottom;
  const overscan = resolveChatOverscanPx({
    viewportHeight,
    pinToBottom: pin,
    overscanPx: input.overscanPx,
  });

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

  let start = findStartIndex(offsets, rangeTop);
  let end = findEndIndex(offsets, rangeBottom);
  if (end <= start) end = Math.min(count, start + 1);

  if (pin) {
    end = count;
  }

  ({ start, end } = applyForceIndices({
    start,
    end,
    count,
    forceIndices: input.forceIndices,
    pinToBottom: pin,
  }));

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
 *
 * Important: only shift when the **entire previous row** was above the
 * viewport top. A tall media-heavy assistant often *straddles* the viewport
 * (row top above, images/video at the bottom still on screen). Treating
 * “row top above fold” as “fully above” used to add the full growth delta
 * and yank the reader toward the bottom (flash-snap near end of chat).
 */
export function scrollTopAfterHeightChange(input: {
  scrollTop: number;
  rowOffset: number;
  /** Committed height before this remeasure (used for straddle detection). */
  prevHeight: number;
  delta: number;
  pinToBottom: boolean;
}): number {
  if (input.pinToBottom) return input.scrollTop;
  if (input.delta === 0) return input.scrollTop;
  const oldBottom = input.rowOffset + Math.max(0, input.prevHeight);
  // Entire old row was strictly above the viewport → keep anchor stable.
  if (oldBottom <= input.scrollTop + 0.5) {
    return Math.max(0, input.scrollTop + input.delta);
  }
  // Straddles or sits at/below the fold — grow/shrink in place.
  return input.scrollTop;
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
  // Zero-height rows are real (inlined tool_step journal spacers). Rejecting
  // them left phantom scroll space (~40–120px × N tools) and pin-to-bottom
  // only mounted empty spacers — chat history looked blank after long agent
  // turns (tools woven into the assistant, rows still in the array).
  if (next === 0) {
    return prev == null || prev !== 0;
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
