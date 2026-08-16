/**
 * Bake plan for sharing a video wallpaper: crop the visible focus slice and
 * trim to the clip, then reset focus/clip so cover-fill of the new file
 * matches the editor look at the exporter's window aspect.
 */

import {
  DEFAULT_WALLPAPER_FOCUS,
  normalizeWallpaperFocus,
  wallpaperVisibleRect,
  type WallpaperFocus,
} from "./wallpaperFocus";
import { parseWallpaperClip, type WallpaperClip } from "./wallpaperClip";

export type PixelCrop = { x: number; y: number; w: number; h: number };

export type VideoBakePlan = {
  crop: PixelCrop | null;
  clip: WallpaperClip | null;
};

export function readViewportAspect(): number {
  if (typeof document !== "undefined") {
    const el = document.querySelector(".app-wallpaper-media");
    if (el instanceof HTMLElement) {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 1 && h > 1) return w / h;
    }
  }
  if (typeof window === "undefined") return 16 / 10;
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 800;
  return w / Math.max(1, h);
}

function evenFloor(n: number): number {
  const i = Math.max(0, Math.floor(n));
  return i - (i % 2);
}

/** ffmpeg yuv420p needs even x/y/w/h. */
export function evenPixelCrop(
  crop: PixelCrop,
  mediaW: number,
  mediaH: number,
): PixelCrop {
  const mw = Math.max(2, evenFloor(mediaW) || mediaW);
  const mh = Math.max(2, evenFloor(mediaH) || mediaH);
  let x = evenFloor(crop.x);
  let y = evenFloor(crop.y);
  let w = Math.max(2, evenFloor(crop.w));
  let h = Math.max(2, evenFloor(crop.h));
  if (x + w > mw) x = Math.max(0, evenFloor(mw - w));
  if (y + h > mh) y = Math.max(0, evenFloor(mh - h));
  if (x + w > mw) w = Math.max(2, evenFloor(mw - x));
  if (y + h > mh) h = Math.max(2, evenFloor(mh - y));
  return { x, y, w, h };
}

export function pixelCropFromFocus(
  mediaW: number,
  mediaH: number,
  viewAspect: number,
  focus: WallpaperFocus,
): PixelCrop {
  const vis = wallpaperVisibleRect(mediaW, mediaH, viewAspect, focus);
  return evenPixelCrop(
    {
      x: vis.x * mediaW,
      y: vis.y * mediaH,
      w: vis.w * mediaW,
      h: vis.h * mediaH,
    },
    mediaW,
    mediaH,
  );
}

/** Still-image crop: no yuv420p even rounding. */
export function pixelCropFromFocusRaw(
  mediaW: number,
  mediaH: number,
  viewAspect: number,
  focus: WallpaperFocus,
): PixelCrop {
  const vis = wallpaperVisibleRect(mediaW, mediaH, viewAspect, focus);
  const mw = Math.max(1, Math.round(mediaW));
  const mh = Math.max(1, Math.round(mediaH));
  let x = Math.max(0, Math.floor(vis.x * mw));
  let y = Math.max(0, Math.floor(vis.y * mh));
  let w = Math.max(1, Math.floor(vis.w * mw));
  let h = Math.max(1, Math.floor(vis.h * mh));
  if (x + w > mw) x = Math.max(0, mw - w);
  if (y + h > mh) y = Math.max(0, mh - h);
  if (x + w > mw) w = Math.max(1, mw - x);
  if (y + h > mh) h = Math.max(1, mh - y);
  return { x, y, w, h };
}

export function planImageBake(input: {
  mediaW: number;
  mediaH: number;
  viewAspect?: number;
  focus?: WallpaperFocus | null;
}): PixelCrop | null {
  const mw = Math.max(1, Math.round(input.mediaW));
  const mh = Math.max(1, Math.round(input.mediaH));
  const aspect =
    input.viewAspect && input.viewAspect > 0 ? input.viewAspect : mw / mh;
  const focus = normalizeWallpaperFocus(input.focus);
  const c = pixelCropFromFocusRaw(mw, mh, aspect, focus);
  if (isFullFrameCrop(c, mw, mh)) return null;
  return c;
}

export function isFullFrameCrop(
  crop: PixelCrop,
  mediaW: number,
  mediaH: number,
): boolean {
  return crop.x <= 1 && crop.y <= 1 && crop.w >= mediaW - 2 && crop.h >= mediaH - 2;
}

export function planVideoBake(input: {
  mediaW: number;
  mediaH: number;
  viewAspect?: number;
  focus?: WallpaperFocus | null;
  clip?: WallpaperClip | null;
}): VideoBakePlan | null {
  const mw = Math.max(1, Math.round(input.mediaW));
  const mh = Math.max(1, Math.round(input.mediaH));
  const aspect =
    input.viewAspect && input.viewAspect > 0 ? input.viewAspect : mw / mh;
  const focus = normalizeWallpaperFocus(input.focus);
  let crop: PixelCrop | null = null;
  const c = pixelCropFromFocus(mw, mh, aspect, focus);
  if (!isFullFrameCrop(c, mw, mh)) crop = c;
  const clip = parseWallpaperClip(input.clip);
  if (!crop && !clip) return null;
  return { crop, clip };
}

export function bakedWallpaperReset(): {
  focus: WallpaperFocus;
  clip: null;
} {
  return { focus: { ...DEFAULT_WALLPAPER_FOCUS }, clip: null };
}
