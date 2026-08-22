import { describe, expect, it } from "vitest";
import {
  petNormXOnWorkArea,
  petShouldMirrorFace,
  petMarkScreenCenter,
} from "./petFaceMirror";

describe("petShouldMirrorFace", () => {
  it("keeps the authored face on the left half (bottom-left)", () => {
    expect(petShouldMirrorFace(0)).toBe(false);
    expect(petShouldMirrorFace(0.5)).toBe(false);
  });

  it("mirrors on the right half (bottom-right)", () => {
    expect(petShouldMirrorFace(0.51)).toBe(true);
    expect(petShouldMirrorFace(1)).toBe(true);
  });

  it("does not mirror invalid positions", () => {
    expect(petShouldMirrorFace(Number.NaN)).toBe(false);
  });
});

describe("petNormXOnWorkArea", () => {
  it("maps the mark centre onto 0..1 across the work area", () => {
    expect(petNormXOnWorkArea({ cx: 100, left: 100, width: 1000 })).toBe(0);
    expect(petNormXOnWorkArea({ cx: 1100, left: 100, width: 1000 })).toBe(1);
    expect(petNormXOnWorkArea({ cx: 600, left: 100, width: 1000 })).toBe(0.5);
  });

  it("returns 0 when the work area has no width", () => {
    expect(petNormXOnWorkArea({ cx: 10, left: 0, width: 0 })).toBe(0);
  });
});

describe("petMarkScreenCenter", () => {
  it("adds the CSS box onto the window screen origin", () => {
    expect(
      petMarkScreenCenter({
        screenX: 200,
        screenY: 40,
        rect: { left: 10, top: 20, width: 100, height: 80 },
      }),
    ).toEqual({ cx: 260, cy: 100 });
  });
});
