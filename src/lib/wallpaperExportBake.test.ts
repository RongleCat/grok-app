import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER_FOCUS } from "./wallpaperFocus";
import {
  bakedWallpaperReset,
  evenPixelCrop,
  isFullFrameCrop,
  pixelCropFromFocus,
  pixelCropFromFocusRaw,
  planImageBake,
  planVideoBake,
} from "./wallpaperExportBake";

describe("planVideoBake", () => {
  it("skips spatial bake when the current window matches the media", () => {
    expect(
      planVideoBake({
        mediaW: 1920,
        mediaH: 1080,
        viewAspect: 1920 / 1080,
        focus: DEFAULT_WALLPAPER_FOCUS,
        clip: null,
      }),
    ).toBeNull();
  });

  it("crops the current cover window even at default focus", () => {
    const plan = planVideoBake({
      mediaW: 1920,
      mediaH: 1080,
      viewAspect: 16 / 10,
      focus: DEFAULT_WALLPAPER_FOCUS,
      clip: null,
    });
    expect(plan?.crop).not.toBeNull();
    expect(plan!.crop!.w).toBeLessThan(1920);
  });

  it("plans a spatial crop for zoomed/panned focus and resets to a smaller rect", () => {
    const plan = planVideoBake({
      mediaW: 1920,
      mediaH: 1080,
      viewAspect: 16 / 10,
      focus: { cx: 0.4, cy: 0.35, zoom: 2 },
      clip: null,
    });
    expect(plan).not.toBeNull();
    expect(plan!.crop).not.toBeNull();
    expect(plan!.clip).toBeNull();
    const c = plan!.crop!;
    expect(c.w % 2).toBe(0);
    expect(c.h % 2).toBe(0);
    expect(c.x % 2).toBe(0);
    expect(c.y % 2).toBe(0);
    expect(c.w).toBeLessThan(1920);
    expect(c.h).toBeLessThan(1080);
    expect(c.x + c.w).toBeLessThanOrEqual(1920);
    expect(c.y + c.h).toBeLessThanOrEqual(1080);
  });

  it("plans a time trim without spatial crop for clip-only", () => {
    const plan = planVideoBake({
      mediaW: 1920,
      mediaH: 1080,
      viewAspect: 16 / 9,
      focus: DEFAULT_WALLPAPER_FOCUS,
      clip: { start: 2, end: 8 },
    });
    expect(plan).toEqual({
      crop: null,
      clip: { start: 2, end: 8 },
    });
  });
});

describe("evenPixelCrop", () => {
  it("forces even dimensions inside the media", () => {
    const c = evenPixelCrop({ x: 1, y: 3, w: 101, h: 51 }, 1920, 1080);
    expect(c.x % 2).toBe(0);
    expect(c.y % 2).toBe(0);
    expect(c.w % 2).toBe(0);
    expect(c.h % 2).toBe(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1920);
  });
});

describe("pixelCropFromFocus", () => {
  it("default focus at media aspect is effectively full frame", () => {
    const c = pixelCropFromFocus(1920, 1080, 1920 / 1080, DEFAULT_WALLPAPER_FOCUS);
    expect(isFullFrameCrop(c, 1920, 1080)).toBe(true);
  });

  it("matches the editor visible slice for a zoomed/panned 16:10 window", () => {
    expect(
      pixelCropFromFocus(1920, 1080, 1.6, { cx: 0.4, cy: 0.35, zoom: 2 }),
    ).toEqual({ x: 336, y: 108, w: 864, h: 540 });
  });
});

describe("planImageBake", () => {
  it("skips when the current window matches the media", () => {
    expect(
      planImageBake({
        mediaW: 1920,
        mediaH: 1080,
        viewAspect: 1920 / 1080,
        focus: DEFAULT_WALLPAPER_FOCUS,
      }),
    ).toBeNull();
  });

  it("crops the current cover window even at default focus", () => {
    const c = planImageBake({
      mediaW: 1920,
      mediaH: 1080,
      viewAspect: 16 / 10,
      focus: DEFAULT_WALLPAPER_FOCUS,
    });
    expect(c).not.toBeNull();
    expect(c!.w).toBeLessThan(1920);
  });

  it("crops the same visible slice as the editor", () => {
    expect(
      pixelCropFromFocusRaw(1920, 1080, 1.6, { cx: 0.4, cy: 0.35, zoom: 2 }),
    ).toEqual({ x: 336, y: 108, w: 864, h: 540 });
    expect(
      planImageBake({
        mediaW: 1920,
        mediaH: 1080,
        viewAspect: 1.6,
        focus: { cx: 0.4, cy: 0.35, zoom: 2 },
      }),
    ).toEqual({ x: 336, y: 108, w: 864, h: 540 });
  });
});

describe("bakedWallpaperReset", () => {
  it("returns default focus and no clip", () => {
    expect(bakedWallpaperReset()).toEqual({
      focus: DEFAULT_WALLPAPER_FOCUS,
      clip: null,
    });
  });
});
