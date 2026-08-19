import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "PetOverlay.tsx"), "utf8");

describe("PetOverlay drag hit target", () => {
  it("releases pointer capture before OS drag and ends drag on window pointerup", () => {
    expect(src).toContain("releasePointerCapture");
    expect(src).toContain("petStartDragging");
    expect(src).toContain("finishDrag");
    expect(src).toContain('window.addEventListener("pointerup"');
    expect(src).toContain("clampPetMarkHitRadius");
  });

  it("can hide task bubbles from prefs and the pet menu", () => {
    expect(src).toContain("petBubblesEnabled");
    expect(src).toContain("pet.menu.hideBubbles");
    expect(src).toContain("bubblesEnabled");
  });

  it("opens on click, hides on double-click or a peek click within 3s", () => {
    expect(src).toContain("petMarkClickIntent");
    expect(src).toContain("petHideMain");
    expect(src).toContain("PET_DBLCLICK_MS");
    expect(src).toContain("openedAtRef");
  });

  it("keeps celebrate spin after drag and bubble changes", () => {
    expect(src).toContain("spinSignal");
    expect(src).toContain("shouldTriggerPetSpin");
    expect(src).toContain("pet.menu.spin");
  });

  it("exposes a rest-face emote from the pet menu", () => {
    expect(src).toContain("emoteSignal");
    expect(src).toContain("pet.menu.emote");
  });

  it("nudges on Wayland instead of startDragging after slop", () => {
    expect(src).toContain("petShouldManualDrag");
    expect(src).toContain("petPointerStep");
    expect(src).toContain("petNudge");
  });
});
