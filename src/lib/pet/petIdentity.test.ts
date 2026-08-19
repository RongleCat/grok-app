import { describe, expect, it } from "vitest";
import {
  isPetColor,
  isPetEyeColor,
  normalizePetEyeColor,
  PET_COLORS,
  PET_EYE_COLORS,
  PET_INK,
  petEyeFill,
} from "./petIdentity";

describe("pet eye color", () => {
  it("treats unknown values as auto (theme contrast)", () => {
    expect(normalizePetEyeColor(undefined)).toBe("auto");
    expect(normalizePetEyeColor("neon")).toBe("auto");
    expect(isPetEyeColor("gold")).toBe(true);
    expect(isPetEyeColor("neon")).toBe(false);
  });

  it("maps auto to the theme background token and named colors to ink", () => {
    expect(petEyeFill("auto")).toContain("--bg");
    expect(petEyeFill("gold")).toBe("#F0C14A");
    expect(PET_EYE_COLORS[0]).toBe("auto");
  });

  it("keeps a white body pale and punches dark auto-eyes", () => {
    expect(isPetColor("white")).toBe(true);
    expect(PET_COLORS).toContain("white");
    expect(PET_INK.white.light).toBe(PET_INK.white.dark);
    expect(petEyeFill("auto", "white")).toBe("#161616");
    expect(petEyeFill("auto", "green")).toContain("--bg");
  });
});
