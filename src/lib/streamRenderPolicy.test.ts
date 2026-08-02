import { describe, expect, it } from "vitest";
import {
  shouldUsePlainStreamBody,
  STREAM_PLAIN_TEXT_CHAR_THRESHOLD,
} from "./streamRenderPolicy";

describe("shouldUsePlainStreamBody", () => {
  it("is false when not streaming", () => {
    expect(shouldUsePlainStreamBody(0, false)).toBe(false);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD + 100, false),
    ).toBe(false);
  });

  it("is false while streaming below the char threshold", () => {
    expect(shouldUsePlainStreamBody(0, true)).toBe(false);
    expect(shouldUsePlainStreamBody(100, true)).toBe(false);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD - 1, true),
    ).toBe(false);
  });

  it("is true while streaming at or past the char threshold", () => {
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD, true),
    ).toBe(true);
    expect(
      shouldUsePlainStreamBody(STREAM_PLAIN_TEXT_CHAR_THRESHOLD + 1, true),
    ).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(shouldUsePlainStreamBody(50, true, 100)).toBe(false);
    expect(shouldUsePlainStreamBody(100, true, 100)).toBe(true);
  });
});
