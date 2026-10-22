import { describe, expect, it } from "vitest";
import {
  STREAM_REVEAL_MAX_INDEX,
  createStreamRevealState,
  mapOffsetsThroughNormalization,
  splitTextNodeByChunkEnds,
  syncStreamRevealState,
  type TextNodeRevealInput,
} from "./streamReveal";

const noIndex = () => 0;

function split(
  input: Partial<TextNodeRevealInput> & { value: string },
) {
  return splitTextNodeByChunkEnds({
    start: 0,
    end: input.value.length,
    chunkEnds: [],
    revealFrom: 0,
    indexOf: noIndex,
    ...input,
  });
}

describe("mapOffsetsThroughNormalization", () => {
  it("shifts offsets after a shrink rewrite and leaves earlier ones alone", () => {
    const raw = "a \\(x+y\\) b";

    const mapped = mapOffsetsThroughNormalization(raw, [0, 2, 9, 10]);

    expect(mapped).toEqual([0, 2, 7, 8]);
  });

  it("clamps offsets that land inside a rewritten range", () => {
    const raw = "a \\(x+y\\) b";

    expect(mapOffsetsThroughNormalization(raw, [5])).toEqual([5]);
  });

  it("composes passes and follows a growth rewrite", () => {
    const raw = "[ I=\\int_1^2 x ]";

    const mapped = mapOffsetsThroughNormalization(raw, [raw.length]);

    expect(mapped[0]).toBe("$$ I=\\int_1^2 x $$".length);
  });

  it("is identity when nothing is rewritten", () => {
    const raw = "plain **text**";

    expect(mapOffsetsThroughNormalization(raw, [0, 5, 13])).toEqual([0, 5, 13]);
  });

  it("returns an empty list for no offsets", () => {
    expect(mapOffsetsThroughNormalization("\\[x\\]", [])).toEqual([]);
  });
});

describe("splitTextNodeByChunkEnds", () => {
  it("animates every chunk when the threshold is zero", () => {
    const segments = split({
      value: "Hello world.",
      chunkEnds: [6, 12],
      indexOf: (end) => (end === 6 ? 0 : 3),
    });

    expect(segments).toEqual([
      { text: "Hello ", animate: true, index: 0 },
      { text: "world.", animate: true, index: 3 },
    ]);
  });

  it("never animates chunks at or before the threshold", () => {
    const segments = split({
      value: "Hello world.",
      chunkEnds: [6, 12],
      revealFrom: 6,
    });

    expect(segments).toEqual([
      { text: "Hello ", animate: false, index: 0 },
      { text: "world.", animate: true, index: 0 },
    ]);
  });

  it("does not animate when everything is at or before the threshold", () => {
    const segments = split({
      value: "Hello world.",
      chunkEnds: [6, 12],
      revealFrom: 12,
    });

    expect(segments.every((s) => !s.animate)).toBe(true);
  });

  it("clamps chunk ends to the node range and keeps the threshold monotone", () => {
    const segments = split({
      value: "bcdef",
      start: 2,
      end: 7,
      chunkEnds: [2, 4, 20],
      revealFrom: 3,
    });

    expect(segments).toEqual([
      { text: "bc", animate: true, index: 0 },
      { text: "def", animate: true, index: 0 },
    ]);
  });

  it("clamps stagger indexes to the per-batch cap", () => {
    const segments = split({
      value: "abcdef",
      chunkEnds: [1, 2, 3, 4, 5, 6],
      indexOf: (end) => end,
    });

    expect(segments.map((s) => s.index)).toEqual([
      1, 2, 3, 4, 5, STREAM_REVEAL_MAX_INDEX,
    ]);
  });

  it("treats an entity-decoded node as one unit", () => {
    const segments = split({
      value: "Fish & chips",
      start: 0,
      end: 17,
      revealFrom: 4,
      indexOf: () => 2,
    });

    expect(segments).toEqual([
      { text: "Fish & chips", animate: true, index: 2 },
    ]);
  });

  it("returns nothing for empty text or an empty range", () => {
    expect(split({ value: "" })).toEqual([]);
    expect(split({ value: "", start: 3, end: 3 })).toEqual([]);
  });
});

describe("stream reveal state", () => {
  it("freezes the threshold at mount and clamps it to the painted length", () => {
    const state = createStreamRevealState([6, 20], [6, 20], 11);

    expect(state.revealFrom).toBe(11);
    expect(createStreamRevealState([], [], 0).revealFrom).toBe(0);
  });

  it("freezes the threshold for a single-chunk message", () => {
    // No exception for a single chunk either: collapse then expand remounts,
    // and the threshold must cover painted text.
    expect(createStreamRevealState([6], [6], 6).revealFrom).toBe(6);
    // History content without boundaries does not replay either.
    expect(createStreamRevealState([], [], 10, true).revealFrom).toBe(10);
  });

  it("assigns a fresh batch index each time new chunks are painted", () => {
    const state = createStreamRevealState([], [], 0);

    syncStreamRevealState(state, [6, 12], [6, 12], 6);
    expect([...state.indices]).toEqual([[6, 0]]);

    syncStreamRevealState(state, [6, 12], [6, 12], 12);
    expect([...state.indices]).toEqual([
      [6, 0],
      [12, 0],
    ]);

    syncStreamRevealState(state, [6, 12], [6, 12], 12);
    expect([...state.indices]).toEqual([
      [6, 0],
      [12, 0],
    ]);
  });

  it("numbers several chunks painted in one tick 0..6 and reuses them", () => {
    const state = createStreamRevealState([], [], 0);
    const raw = [1, 2, 3, 4, 5, 6, 7, 8];
    const mapped = [...raw];

    syncStreamRevealState(state, mapped, raw, 8);

    expect(mapped.map((end) => state.indices.get(end))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 6,
    ]);

    syncStreamRevealState(state, [...mapped, 9], [...raw, 9], 9);
    expect(state.indices.get(9)).toBe(0);
  });

  it("never assigns an index to a chunk at or before the threshold", () => {
    const state = createStreamRevealState([6, 12], [6, 12], 12);

    expect(state.revealFrom).toBe(12);

    syncStreamRevealState(state, [6, 12, 18], [6, 12, 18], 18);

    expect(state.indices.has(6)).toBe(false);
    expect(state.indices.has(12)).toBe(false);
    expect(state.indices.get(18)).toBe(0);
  });

  it("settles painted chunks while output motion is off", () => {
    const state = createStreamRevealState([], [], 0);

    syncStreamRevealState(state, [6, 12], [6, 12], 12);
    expect(state.indices.size).toBe(2);

    syncStreamRevealState(state, [6, 12], [6, 12], 12, false);
    expect(state.revealFrom).toBe(12);
    expect(state.indices.size).toBe(0);

    syncStreamRevealState(state, [6, 12, 18], [6, 12, 18], 18, false);
    expect(state.revealFrom).toBe(18);
    expect(state.indices.size).toBe(0);

    syncStreamRevealState(state, [6, 12, 18, 24], [6, 12, 18, 24], 24, true);
    expect(state.indices.has(18)).toBe(false);
    expect(state.indices.get(24)).toBe(0);
  });

  it("settles a brand-new reply while output motion is off", () => {
    const state = createStreamRevealState([6], [6], 6);

    syncStreamRevealState(state, [6], [6], 6, false);

    expect(state.revealFrom).toBe(6);
    expect(state.indices.size).toBe(0);
  });

  it("resets when the raw content shrinks or the first chunk changes", () => {
    const state = createStreamRevealState([], [], 0);
    syncStreamRevealState(state, [6, 12], [6, 12], 12);

    const shrunk = syncStreamRevealState(state, [6], [6], 6);

    expect(shrunk).not.toBe(state);
    expect(shrunk.indices.size).toBe(0);
    // Only one chunk left after the rewrite: the threshold stays frozen at the
    // painted length, so nothing replays.
    expect(shrunk.revealFrom).toBe(6);

    const grown = createStreamRevealState([], [], 0);
    syncStreamRevealState(grown, [6, 12], [6, 12], 12);
    const switched = syncStreamRevealState(grown, [4, 9], [4, 9], 12);

    expect(switched).not.toBe(grown);
    expect(switched.revealFrom).toBe(9);
  });

  it("keeps identity on raw offsets when normalization shifts mapped ones", () => {
    const state = createStreamRevealState([4, 8], [6, 14], 8);
    expect(state.revealFrom).toBe(8);

    const next = syncStreamRevealState(state, [2, 8, 12], [6, 14, 20], 12);

    expect(next).toBe(state);
    expect(next.revealFrom).toBe(8);
  });
});
