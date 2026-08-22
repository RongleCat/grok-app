/**
 * Horizontal face flip when the overlay sits on the right of the work area.
 * Bottom-left keeps the authored ¾-right look; bottom-right is a CSS scaleX(-1).
 */

import { clamp } from "./bloub/math";

export function petShouldMirrorFace(nx: number): boolean {
  return Number.isFinite(nx) && nx > 0.5;
}

export function petNormXOnWorkArea(input: {
  cx: number;
  left: number;
  width: number;
}): number {
  if (!(input.width > 0) || !Number.isFinite(input.cx)) return 0;
  return clamp((input.cx - input.left) / input.width);
}

export function petMarkScreenCenter(input: {
  screenX: number;
  screenY: number;
  rect: { left: number; top: number; width: number; height: number };
}): { cx: number; cy: number } {
  return {
    cx: input.screenX + input.rect.left + input.rect.width / 2,
    cy: input.screenY + input.rect.top + input.rect.height / 2,
  };
}
