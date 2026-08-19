/**
 * Hit-test chrome for the pet overlay (mark disc + optional bubble stack).
 *
 * After OS drag, WebView2 sometimes reports getBoundingClientRect in a
 * different pixel space (or the wrapper stretches to the padded window).
 * Clamp measurements back to the known logical mark size.
 */

export function expectedPetMarkHitRadius(sizePx: number): number {
  return Math.max(64, sizePx) * 0.52;
}

/** Allow 20% layout noise; reject overlay-sized balloons after a drag glitch. */
export function clampPetMarkHitRadius(measuredR: number, sizePx: number): number {
  const expected = expectedPetMarkHitRadius(sizePx);
  if (!Number.isFinite(measuredR) || measuredR <= 0) return expected;
  return Math.min(measuredR, expected * 1.2);
}

/**
 * If the overlay's bounding box is much larger than the known logical size,
 * treat the rects as physical (or a stretched window) and scale them down.
 */
export function hitChromeCssScale(
  measuredOverlayW: number,
  expectedOverlayW: number,
): number {
  if (!(measuredOverlayW > 0) || !(expectedOverlayW > 0)) return 1;
  const ratio = measuredOverlayW / expectedOverlayW;
  return ratio > 1.3 ? ratio : 1;
}

export function scaleHitLen(n: number, cssScale: number): number {
  if (!(cssScale > 0) || !Number.isFinite(n)) return n;
  return n / cssScale;
}
