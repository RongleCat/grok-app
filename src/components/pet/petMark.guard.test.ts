import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "PetMark.tsx"), "utf8");

describe("PetMark long-run paint", () => {
  it("throttles rAF commits and pauses while the overlay is hidden", () => {
    expect(src).toContain("petPaintMinMs");
    expect(src).toContain("visibilitychange");
    expect(src).toContain("document.hidden");
  });

  it("does not subscribe the settings rest preview to screen-space cursor", () => {
    expect(src).toContain("!restOnlyRef.current");
    expect(src).toContain("pet://cursor");
  });

  it("mirrors the face from Host overlay position, not window.screenX", () => {
    expect(src).toContain("petReadOverlayFrame");
    expect(src).toContain("petShouldMirrorFromOverlay");
    expect(src).toContain('scaleX(-1)');
    expect(src).toContain("onMoved");
    expect(src).toContain("draggingRef.current");
  });
});
