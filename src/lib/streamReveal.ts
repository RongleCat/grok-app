/**
 * Pure computation behind stream reveal: offset mapping, the animation
 * threshold, and splitting text nodes on model chunk boundaries.
 *
 * Coordinate conventions:
 * - `chunkEnds` and `revealFrom` use UTF-16 offsets into the **normalized
 *   source** (the string after `normalizeMarkdownMath`, i.e. what ReactMarkdown
 *   actually parses), matching HAST `position`.
 * - Boundaries stored on message segments are raw stream-text coordinates and
 *   are mapped through {@link mapOffsetsThroughNormalization} before rendering.
 */

import {
  MARKDOWN_MATH_REWRITES,
  applyMarkdownMathRewrite,
  type MarkdownMathRewriteMatch,
} from "./markdownMath";

/**
 * Largest index in one batch of stagger. With a 24ms step, `6 × 24ms = 144ms`;
 * chunks past the cap share the last delay so the display never falls behind
 * the network.
 */
export const STREAM_REVEAL_MAX_INDEX = 6;

/** Split result inside one normalized text node. */
export type StreamRevealSegment = {
  text: string;
  /** Plays only when this segment ends past the animation threshold. */
  animate: boolean;
  /** In-batch stagger index (0..{@link STREAM_REVEAL_MAX_INDEX}); 0 when it
   * does not play. */
  index: number;
};

/** Offset of one rewrite pass in the new coordinates. An `offset` inside the
 * rewritten range snaps to the aligned position in the replacement. */
function mapPassOffset(
  offset: number,
  matches: readonly MarkdownMathRewriteMatch[],
): number {
  let delta = 0;
  for (const match of matches) {
    if (offset <= match.start) break;
    if (offset >= match.end) {
      delta += match.replacement.length - (match.end - match.start);
      continue;
    }
    return (
      match.start + delta + Math.min(offset - match.start, match.replacement.length)
    );
  }
  return offset + delta;
}

/**
 * Maps offsets in `raw` (the source before normalization) into the coordinates
 * of `normalizeMarkdownMath(raw)`. Scans the real rewrite matches pass by pass
 * instead of estimating per character.
 */
export function mapOffsetsThroughNormalization(
  raw: string,
  offsets: readonly number[],
): number[] {
  if (!raw || offsets.length === 0) return offsets.slice();
  let mapped = offsets.slice();
  let source = raw;
  for (const rewrite of MARKDOWN_MATH_REWRITES) {
    const { text, matches } = applyMarkdownMathRewrite(source, rewrite);
    if (matches.length) mapped = mapped.map((o) => mapPassOffset(o, matches));
    source = text;
  }
  return mapped;
}

/**
 * Reveal state of one streamed message.
 *
 * `revealFrom` is frozen once when the message mounts and never advances
 * afterwards: a span that already animated is never flipped back to "static"
 * on the next parse tick (which would cut the animation short), and a remount
 * (collapse / expand, virtualization scroll-back) never replays painted text.
 */
export type StreamRevealState = {
  /** Animation threshold (normalized coordinates): chunks ending at or before
   * it never play. */
  revealFrom: number;
  /** Chunk end position (normalized coordinates) → in-batch index assigned on
   * first paint, reused across re-parses. */
  indices: Map<number, number>;
  /** First chunk end (raw stream coordinates, only used to detect "a different
   * message"). */
  firstChunkEnd: number | null;
  /** Largest raw length seen; a shorter value means a different message
   * (rewrite / new reply). */
  maxRawLength: number;
};

/**
 * Reveal state for the first frame at mount: existing text never plays, only
 * chunks that arrive afterwards do.
 *
 * @param mappedEnds Cumulative boundaries in normalized coordinates.
 * @param rawEnds Cumulative boundaries in raw stream coordinates (message
 * identity).
 * @param paintedLength Length of the painted source.
 * @param hasPaintedText Whether the first frame has visible text; a
 * whitespace-only placeholder does not count.
 */
export function createStreamRevealState(
  mappedEnds: readonly number[],
  rawEnds: readonly number[],
  paintedLength: number,
  hasPaintedText: boolean = paintedLength > 0,
): StreamRevealState {
  const known = mappedEnds.at(-1);
  return {
    // Trailing characters appended by soft-close are not model output, so the
    // threshold must not exceed the painted length — a short chunk would
    // otherwise be swallowed by them. The threshold is always frozen, with no
    // exception for the first segment: a remount from collapse / expand must
    // not replay text that is still streaming.
    revealFrom:
      known == null
        ? // History content with no boundaries: it is all existing text and
          // never replays.
          hasPaintedText
          ? paintedLength
          : 0
        : Math.min(known, paintedLength),
    indices: new Map(),
    // Message identity uses raw coordinates: math normalization shifts the
    // mapped offsets, so they cannot identify the message.
    firstChunkEnd: rawEnds[0] ?? null,
    maxRawLength: rawEnds.at(-1) ?? 0,
  };
}

/**
 * Advances the reveal state by one frame.
 *
 * - A shorter raw text or a different first chunk boundary means a different
 *   message: freeze the threshold again and clear the indices.
 * - With `outputMotionEnabled` false, the threshold moves to the current
 *   painted length and the indices are cleared: everything on screen settles
 *   while motion is off, and only chunks arriving after re-enabling play.
 * - When enabled, only chunks actually painted this frame get an index;
 *   boundaries that already have one keep it, so `--reveal-i` is never
 *   rewritten while an animation is running.
 */
export function syncStreamRevealState(
  state: StreamRevealState,
  mappedEnds: readonly number[],
  rawEnds: readonly number[],
  paintedLength: number,
  outputMotionEnabled: boolean = true,
): StreamRevealState {
  const rawFirst = rawEnds[0] ?? null;
  const rawLength = rawEnds.at(-1) ?? 0;
  const switchedMessage =
    rawLength < state.maxRawLength ||
    (rawFirst != null &&
      state.firstChunkEnd != null &&
      rawFirst !== state.firstChunkEnd);
  if (switchedMessage) {
    const fresh = createStreamRevealState(
      mappedEnds,
      rawEnds,
      paintedLength,
    );
    if (!outputMotionEnabled) {
      fresh.revealFrom = Math.max(fresh.revealFrom, paintedLength);
    }
    return fresh;
  }

  if (state.firstChunkEnd == null) state.firstChunkEnd = rawFirst;
  state.maxRawLength = Math.max(state.maxRawLength, rawLength);

  if (!outputMotionEnabled) {
    state.revealFrom = Math.max(state.revealFrom, paintedLength);
    state.indices.clear();
    return state;
  }

  let nextIndex = 0;
  for (const end of mappedEnds) {
    if (end > paintedLength || end <= state.revealFrom) continue;
    if (state.indices.has(end)) continue;
    state.indices.set(end, Math.min(nextIndex, STREAM_REVEAL_MAX_INDEX));
    nextIndex += 1;
  }
  return state;
}

/** Input for one text node: node value, source range, mapped boundaries, and
 * the animation threshold. */
export type TextNodeRevealInput = {
  value: string;
  /** Node start in the normalized source. */
  start: number;
  /** Node end in the normalized source (exclusive). */
  end: number;
  /** Mapped cumulative chunk end offsets; may extend past the node range. */
  chunkEnds: readonly number[];
  /** Animation threshold frozen at mount; chunks ending at or before it never
   * play. */
  revealFrom: number;
  /** In-batch stagger index for a boundary; already-rendered boundaries must
   * get the same value back. */
  indexOf: (end: number) => number;
};

/**
 * Splits one text node on chunk boundaries. Boundaries are clamped to the node
 * range; when the node value length differs from the source range (entity
 * decoding, etc.) the whole node is one unit, so the split never lands inside
 * the wrong character.
 */
export function splitTextNodeByChunkEnds(
  input: TextNodeRevealInput,
): StreamRevealSegment[] {
  const { value, start, end, chunkEnds, revealFrom, indexOf } = input;
  if (!value || end <= start) return [];

  const revealIndex = (boundary: number): number =>
    Math.max(0, Math.min(indexOf(boundary), STREAM_REVEAL_MAX_INDEX));

  if (value.length !== end - start) {
    const animate = end > revealFrom;
    return [
      { text: value, animate, index: animate ? revealIndex(end) : 0 },
    ];
  }

  const out: StreamRevealSegment[] = [];
  const boundaries = [
    ...chunkEnds.filter((offset) => offset > start && offset < end),
    end,
  ];
  let cursor = start;
  for (const boundary of boundaries) {
    const text = value.slice(cursor - start, boundary - start);
    if (text) {
      const animate = boundary > revealFrom;
      out.push({
        text,
        animate,
        index: animate ? revealIndex(boundary) : 0,
      });
    }
    cursor = boundary;
  }
  return out;
}
