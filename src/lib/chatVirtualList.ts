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
 */

import { CHAT_VIRTUALIZE_THRESHOLD_PERF } from "@/lib/streamRenderPolicy";

/**
 * Virtualize once the transcript has this many rows (tool steps count).
 * Kept low so multi-turn agent chats window the DOM before the UI freezes
 * on integrated-GPU / Retina laptops (see streamRenderPolicy).
 */
export const CHAT_VIRTUALIZE_THRESHOLD = CHAT_VIRTUALIZE_THRESHOLD_PERF;

/**
 * Also virtualize when estimated transcript height exceeds this, even with
 * few rows (one long article still creates a compositor-killing layer).
 */
export const CHAT_VIRTUALIZE_HEIGHT_PX = 4000;

/**
 * Max height of one spacer element. A single 50k-px box becomes one GPU
 * layer and WebView/WebKit go blank (community: long article / long chat).
 */
export const CHAT_VIRT_SPACER_CHUNK_PX = 4096;

/** Fallback height before a row is measured (px). */
export const CHAT_DEFAULT_ROW_ESTIMATE_PX = 120;

/** Cap a single estimated row so one mega-answer cannot dominate scroll math. */
export const CHAT_MAX_ROW_ESTIMATE_PX = 8000;

/** Baseline extra px above/below the viewport when browsing history. */
export const CHAT_OVERSCAN_PX = 4800;

/** Baseline when pinned: more history above the tail so pin feels continuous. */
export const CHAT_PIN_OVERSCAN_PX = 6400;

/** Floor / ceiling for adaptive overscan (px). */
export const CHAT_OVERSCAN_MIN_PX = 2800;
export const CHAT_OVERSCAN_MAX_PX = 9200;
export const CHAT_PIN_OVERSCAN_MIN_PX = 3600;
export const CHAT_PIN_OVERSCAN_MAX_PX = 10400;

/**
 * Max index gap when expanding the window for `forceIndices` while **escaped**.
 * Beyond this, locate/find must scroll the target into the natural window first
 * (ConversationThread already coarse-jumps `scrollTop`). Expanding across the
 * whole list defeated virtualization on multi-hundred-message threads.
 */
export const CHAT_FORCE_EXPAND_MAX_GAP = 12;

/**
 * Chat ImageUi card max height (must match ImageUi CHAT_IMAGE_CARD_MAX_H).
 * Used for virtual-row pre-estimates so multi-image turns do not under-scroll.
 */
export const CHAT_IMAGE_CARD_ESTIMATE_H = 160; // 150px card + gap
/** Typical images per wrapping row in the assistant body (~240px cards). */
export const CHAT_IMAGE_CARDS_PER_ROW = 3;

/**
 * Content-aware row estimate so tall assistant answers (diagrams, tables)
 * are not first measured as ~120px (that underestimates scrollHeight and
 * makes mid-document look "near bottom" → stick bounce).
 *
 * Estimates are coarse and intentional: they only seed the prefix-sum table
 * before rows mount. Real heights commit to `heightsRef` via measureRef.
 */
export function estimateChatRowHeight(input: {
  contentLength?: number;
  thoughtLength?: number;
  role?: string;
  rawContent?: string;
  toolCount?: number;
  /**
   * Non-image attachment chips (file/folder under the bubble), or user-strip
   * 36px thumbs when role is user.
   */
  attachmentCount?: number;
  /**
   * Assistant image cards (inline path tokens + leftover bottom gallery).
   * Each card is up to ~150px tall; several wrap per row.
   */
  imageCardCount?: number;
  /** True when body likely embeds a local video card. */
  hasVideoCard?: boolean;
  /**
   * Inlined / collapsed tool rows (tool_step woven into an assistant timeline).
   * Must estimate 0 so the virtual pin window is not filled with phantom spacer
   * height — long agent turns otherwise paint a blank transcript.
   */
  collapsed?: boolean;
  /**
   * Thinking fold is open (live stream, or user set keep-open). Default is
   * collapsed — do not count thoughtLength or first-paint overshoots by
   * hundreds of px and the pin window jumps between assistants (flicker).
   */
  thoughtExpanded?: boolean;
}): number {
  if (input.collapsed) return 0;
  const rawText = input.rawContent ?? "";
  const content = Math.max(0, input.contentLength ?? rawText.length);
  const thoughtRaw = Math.max(0, input.thoughtLength ?? 0);
  const thought = input.thoughtExpanded === true ? thoughtRaw : 0;
  const role = (input.role ?? "assistant").toLowerCase();
  const imageCards = Math.max(0, input.imageCardCount ?? 0);
  // Empty tool journal rows must not inflate the pin window (blank transcript).
  if (
    role === "tool" &&
    content === 0 &&
    thoughtRaw === 0 &&
    !(input.attachmentCount && input.attachmentCount > 0) &&
    imageCards === 0 &&
    !input.hasVideoCard
  ) {
    return 0;
  }
  // Collapsed CoT is a ~38px "Thought" chip.
  const thoughtChrome = !input.thoughtExpanded && thoughtRaw > 0 ? 38 : 0;
  // Tool phase activity header ("Worked for ...") is ~42px
  const toolPhaseChrome = (input.toolCount ?? 0) > 0 ? 42 : 0;

  // Modern chat width (~700-900px): ~50-65 chars per line typical.
  const charsPerLine = role === "user" ? 50 : 65;
  // Account for explicit newlines in markdown/code
  const explicitNewlines = rawText ? (rawText.match(/\n/g) || []).length : 0;
  // Code fence chrome (header bar + padding) ~56px per fence
  const codeBlockCount = rawText ? (rawText.match(/```/g) || []).length / 2 : 0;
  const codeChrome = Math.floor(codeBlockCount) * 56;

  const charLines = Math.ceil((content + thought * 0.5) / charsPerLine);
  const effectiveLines = Math.max(charLines, explicitNewlines + 1);
  const lineHeight = role === "assistant" ? 23 : 20;
  const chrome = role === "user" ? 44 : role === "tool" ? 24 : 64;
  const atts = Math.max(0, input.attachmentCount ?? 0);
  // 36px chips + gap; user strip packs to ~70% width (~6–8 chips/row typical).
  // Collapsed default shows ≤3 + "+N" (≤4 slots) on one row when possible.
  const slots = atts > 3 ? 4 : atts;
  const attRows = slots > 0 ? Math.ceil(slots / 6) : 0;
  const attBoost = attRows * 44;
  // Image cards wrap; ~3 per row at chat width, each ≤150px + margin.
  const imgRows =
    imageCards > 0
      ? Math.ceil(imageCards / CHAT_IMAGE_CARDS_PER_ROW)
      : 0;
  const imgBoost = imgRows * CHAT_IMAGE_CARD_ESTIMATE_H;
  const videoBoost = input.hasVideoCard ? 260 : 0;
  const raw =
    chrome +
    effectiveLines * lineHeight +
    thoughtChrome +
    toolPhaseChrome +
    codeChrome +
    attBoost +
    imgBoost +
    videoBoost;
  // Tool rows are compact; do not floor them at the assistant default (120px).
  const floor = role === "tool" ? 0 : 80;
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
 */
export function resolveChatOverscanPx(input: {
  viewportHeight: number;
  pinToBottom?: boolean;
  /** Explicit override (tests / callers). */
  overscanPx?: number;
  /**
   * 0–1 scale applied after clamp (stream-perf on low-power clients mounts
   * fewer offscreen markdown rows).
   */
  scale?: number;
  /** Transcript row count. Long chats shrink browse overscan (#881). */
  rowCount?: number;
}): number {
  if (input.overscanPx != null && Number.isFinite(input.overscanPx)) {
    return Math.max(0, input.overscanPx);
  }
  const vh = Math.max(0, input.viewportHeight);
  let px: number;
  if (input.pinToBottom) {
    // ~3.6 viewports above the tail + small baseline, clamped. Doubled once
    // overscan mounts moved off the urgent lane (startTransition in the
    // virtualizer): more runway costs idle time, not scroll frames.
    const raw = vh * 3.6 + 600;
    px = Math.round(
      Math.min(
        CHAT_PIN_OVERSCAN_MAX_PX,
        Math.max(CHAT_PIN_OVERSCAN_MIN_PX, raw, CHAT_PIN_OVERSCAN_PX),
      ),
    );
  } else {
    // History browse: ~2.4 viewports of runway (doubled, see pin note).
    const raw = vh * 2.4 + 600;
    px = Math.round(
      Math.min(
        CHAT_OVERSCAN_MAX_PX,
        Math.max(CHAT_OVERSCAN_MIN_PX, raw, CHAT_OVERSCAN_PX),
      ),
    );
  }
  // Pin window must not shrink under stream-perf. Scaling it down mid-turn
  // then restoring at ready jumps start by a few rows — one tail flash.
  if (input.pinToBottom) return px;
  let scale =
    input.scale != null && Number.isFinite(input.scale)
      ? Math.min(1, Math.max(0.35, input.scale))
      : 1;
  const rows = input.rowCount ?? 0;
  if (rows >= 80) {
    scale *= rows >= 240 ? 0.42 : rows >= 140 ? 0.55 : 0.72;
  }
  return Math.round(px * scale);
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
 * If `start` sits on a 0-height plateau (many inlined/collapsed tool rows
 * sharing one offset), walk back to the last non-zero row before that run.
 * A 1px viewTop change otherwise jumps start across the whole plateau and
 * remounts a different set of real messages (transcript flicker).
 */
export function snapVirtualStartBeforeZeroRun(
  offsets: readonly number[],
  start: number,
): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let i = Math.max(0, Math.min(Math.floor(start), count - 1));
  while (i > 0 && offsets[i] === offsets[i - 1]) {
    i--;
  }
  if (i > 0 && i < count && offsets[i] === offsets[i + 1]) {
    i--;
  }
  return i;
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

  start = snapVirtualStartBeforeZeroRun(offsets, start);

  start = Math.max(0, Math.min(start, count - 1));
  end = Math.max(start + 1, Math.min(end, count));

  const paddingTop = offsets[start] ?? 0;
  const rendered = (offsets[end] ?? 0) - paddingTop;
  const paddingBottom = Math.max(0, totalHeight - paddingTop - rendered);

  return { start, end, paddingTop, paddingBottom, totalHeight };
}

/** Window the DOM when row count or estimated height is large enough. */
export function shouldVirtualizeChat(input: {
  itemCount: number;
  threshold?: number;
  enabled?: boolean;
  estimatedTotalHeight?: number;
  heightThreshold?: number;
}): boolean {
  if (input.enabled === false) return false;
  const count = Math.max(0, input.itemCount);
  const rowThreshold = input.threshold ?? CHAT_VIRTUALIZE_THRESHOLD;
  if (count >= rowThreshold) return true;
  const height = input.estimatedTotalHeight ?? 0;
  const heightThreshold = input.heightThreshold ?? CHAT_VIRTUALIZE_HEIGHT_PX;
  return height >= heightThreshold;
}

/**
 * Split a virtual spacer into compositor-safe chunks so one tall empty
 * box cannot blank the WebView layer.
 */
export function splitVirtSpacerHeights(
  total: number,
  chunkPx: number = CHAT_VIRT_SPACER_CHUNK_PX,
): number[] {
  const h = Math.max(0, Math.round(total));
  const chunk = Math.max(1, Math.round(chunkPx));
  if (h <= 0) return [];
  if (h <= chunk) return [h];
  const out: number[] = [];
  let left = h;
  while (left > 0) {
    const next = Math.min(chunk, left);
    out.push(next);
    left -= next;
  }
  return out;
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
 *
 * Image-heavy rows used to oscillate by a few px after decode (scrollbar
 * gutter / subpixel) → virtual window rebuild → visible chat "shiver".
 */
/**
 * Whether a row-height commit may write scrollTop while stick-pinned.
 *
 * Per-row image/PDF decode used to snap to max on every commit, then the
 * virtual window rebuild snapped again. That is the bounce-up on long
 * media-heavy turns. Pinned snaps belong on the coalesced window layout,
 * not on each ResizeObserver.
 */
export function shouldWriteScrollOnRowCommit(pinned: boolean): boolean {
  return !pinned;
}

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
  // 4px floor: ignores subpixel + scrollbar-gutter flicker after images settle.
  if (Math.abs(delta) < 4) return false;
  // Allow growth freely; only accept shrinks that are meaningful and stable.
  if (delta < 0 && Math.abs(delta) < Math.max(24, prev * 0.08)) {
    return false;
  }
  return true;
}
