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

  it("lets the user toggle task bubbles", () => {
    expect(src).toContain("settings.pet.bubbles");
    expect(src).toContain("bubblesEnabled");
  });

  it("lets the user pick dismiss seconds, progress bar, and bubble look", () => {
    expect(src).toContain("settings.pet.bubbleDismiss");
    expect(src).toContain("bubbleDismissSec");
    expect(src).toContain("settings.pet.progressBar");
    expect(src).toContain("progressBarEnabled");
    expect(src).toContain("settings.pet.bubbleLook");
    expect(src).toContain("PET_BUBBLE_SHAPES");
    expect(src).toContain("PET_BUBBLE_STYLES");
  });
});
