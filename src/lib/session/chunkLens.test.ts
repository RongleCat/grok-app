import { describe, expect, it } from "vitest";
import { sanitizeChunkLens } from "./chunkLens";

describe("sanitizeChunkLens", () => {
  it("accepts lengths that add up to the text", () => {
    expect(sanitizeChunkLens("Hello world.", [6, 6])).toEqual([6, 6]);
    expect(sanitizeChunkLens("", [])).toEqual([]);
    expect(sanitizeChunkLens("abc", [0, 3])).toEqual([0, 3]);
  });

  it("counts UTF-16 code units for CJK and emoji", () => {
    expect(sanitizeChunkLens("世界😀", [2, 2])).toEqual([2, 2]);
    expect(sanitizeChunkLens("世界😀", [4])).toEqual([4]);
    // Byte length (10) or code-point count (3) must not be accepted.
    expect(sanitizeChunkLens("世界😀", [10])).toBeUndefined();
    expect(sanitizeChunkLens("世界😀", [3])).toBeUndefined();
  });

  it("rejects a sum that does not match the text", () => {
    expect(sanitizeChunkLens("Hello world.", [6, 5])).toBeUndefined();
    expect(sanitizeChunkLens("Hello world.", [])).toBeUndefined();
  });

  it("rejects non-integer, negative, or non-finite entries", () => {
    expect(sanitizeChunkLens("abc", [1.5, 1.5])).toBeUndefined();
    expect(sanitizeChunkLens("abc", [-1, 4])).toBeUndefined();
    expect(sanitizeChunkLens("abc", [Number.NaN, 3])).toBeUndefined();
    expect(sanitizeChunkLens("abc", [Number.POSITIVE_INFINITY])).toBeUndefined();
    expect(sanitizeChunkLens("abc", ["3"])).toBeUndefined();
  });

  it("rejects non-array lengths and non-string text", () => {
    expect(sanitizeChunkLens("abc", undefined)).toBeUndefined();
    expect(sanitizeChunkLens("abc", 3)).toBeUndefined();
    expect(sanitizeChunkLens(null, [3])).toBeUndefined();
    expect(sanitizeChunkLens(undefined, [3])).toBeUndefined();
  });
});
