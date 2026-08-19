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
});
