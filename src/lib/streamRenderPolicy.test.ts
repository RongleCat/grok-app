import { describe, expect, it } from "vitest";
import {
  CHAT_VIRTUALIZE_THRESHOLD_PERF,
  resolveStreamOverscanScale,
} from "./streamRenderPolicy";

describe("streamRenderPolicy", () => {
  it("virtualize threshold is early enough for multi-turn agent chats", () => {
    expect(CHAT_VIRTUALIZE_THRESHOLD_PERF).toBe(16);
  });

  it("idle overscan scale is 1", () => {
    expect(resolveStreamOverscanScale(false)).toBe(1);
    expect(resolveStreamOverscanScale(false, 2)).toBe(1);
  });

  it("streaming shrinks overscan more on low-power cores", () => {
    const low = resolveStreamOverscanScale(true, 2);
    const mid = resolveStreamOverscanScale(true, 8);
    const high = resolveStreamOverscanScale(true, 16);
    expect(low).toBe(0.55);
    expect(mid).toBe(0.65);
    expect(high).toBe(0.75);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(high);
  });
});
