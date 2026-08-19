/**
 * Settings → 宠物: visibility is a switch, two-way bound to the overlay window.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "PetSection.tsx"), "utf8");

describe("PetSection visibility switch", () => {
  it("uses UiSwitch, not a checkbox", () => {
    expect(src).toContain("UiSwitch");
    expect(src).not.toContain("UiCheck");
    expect(src).not.toMatch(/type=["']checkbox["']/);
    expect(src).not.toMatch(/<input[\s>]/);
  });

  it("toggles the overlay via petShow/petHide and listens for prefs", () => {
    expect(src).toContain("petShow");
    expect(src).toContain("petHide");
    expect(src).toContain("pet://prefs");
    expect(src).toContain("onToggleWindow");
  });

  it("lets the user pick an eye color from a swatch grid", () => {
    expect(src).toContain("PET_EYE_COLORS");
    expect(src).toContain("settings.pet.eyeColor");
    expect(src).toContain("eyeColor");
    expect(src).not.toMatch(/type=["']color["']/);
  });
});
