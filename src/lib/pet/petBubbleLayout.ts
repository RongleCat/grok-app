/**
 * Slide task chips horizontally so they stay on-screen.
 * The living mark never moves — no layout flip, no window recentering.
 * Overlay height always reserves the 3-chip viewport so chips cannot
 * push the mark or make it jump when they appear/disappear.
 */

import { PET_BUBBLE_WIDTH, petBubbleViewportHeight } from "./petTasks";

export const PET_BUBBLE_EDGE_PAD = 16;

/** Extra width on each side of the mark so chips can slide without flipping. */
export function petOverlayWidth(sizePx: number, bubbles = true): number {
  return sizePx + 96 + (bubbles ? PET_BUBBLE_WIDTH : 0);
}

export function petOverlayHeight(sizePx: number, bubbles = true): number {
  return sizePx + 96 + (bubbles ? petBubbleViewportHeight() : 0);
}

export function petBubblesEnabled(
  prefs: { bubblesEnabled?: boolean } | null | undefined,
): boolean {
  return prefs?.bubblesEnabled !== false;
}

/**
 * Pixels to translate the chip stack (negative = left).
 * `leftGap` / `rightGap` are mark-center → work-area edges.
 * `maxOffset` is how far the stack can slide and still stay inside the overlay.
 */
export function petBubbleOffsetX(input: {
  leftGap: number;
  rightGap: number;
  bubbleWidth?: number;
  maxOffset?: number;
  pad?: number;
}): number {
  const bubble = input.bubbleWidth ?? PET_BUBBLE_WIDTH;
  const pad = input.pad ?? PET_BUBBLE_EDGE_PAD;
  const need = bubble / 2 + pad;
  const left = Number.isFinite(input.leftGap) ? input.leftGap : need;
  const right = Number.isFinite(input.rightGap) ? input.rightGap : need;
  let dx = 0;
  if (right < need) dx -= need - right;
  if (left < need) dx += need - left;
  const cap = input.maxOffset ?? bubble;
  if (dx > cap) return cap;
  if (dx < -cap) return -cap;
  return dx;
}
