import { describe, expect, it } from "vitest";
import {
  clampPetMarkHitRadius,
  expectedPetMarkHitRadius,
  hitChromeCssScale,
  scaleHitLen,
} from "./petHitChrome";

describe("pet hit chrome after drag", () => {
  it("clamps a ballooned mark radius back to the known size", () => {
    const expected = expectedPetMarkHitRadius(128);
    expect(expected).toBeCloseTo(66.56);
    expect(clampPetMarkHitRadius(66.56, 128)).toBeCloseTo(66.56);
    expect(clampPetMarkHitRadius(400, 128)).toBeCloseTo(expected * 1.2);
  });

  it("detects a physical-pixel overlay rect and scales lengths down", () => {
    expect(hitChromeCssScale(440, 440)).toBe(1);
    expect(hitChromeCssScale(880, 440)).toBe(2);
    expect(scaleHitLen(256, 2)).toBe(128);
    expect(scaleHitLen(128, 1)).toBe(128);
  });
});
