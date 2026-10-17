import { describe, expect, it } from "vitest";
import { PET_SIZE_DEFAULT, PET_SIZE_MAX, PET_SIZE_MIN, normalizePetSize } from "./petIdentity";

describe("normalizePetSize", () => {
  it("clamps and snaps to 8px stops", () => {
    expect(normalizePetSize(12)).toBe(PET_SIZE_MIN);
    expect(normalizePetSize(999)).toBe(PET_SIZE_MAX);
    expect(normalizePetSize(131)).toBe(128);
    expect(normalizePetSize(140)).toBe(144);
    expect(normalizePetSize("nope")).toBe(PET_SIZE_DEFAULT);
  });
  it("keeps the legacy presets", () => {
    for (const n of [96, 128, 160]) expect(normalizePetSize(n)).toBe(n);
  });
});
