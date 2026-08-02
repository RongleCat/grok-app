/**
 * Windowing thresholds for Grok activity step lists (TimelinePhaseBlock).
 * Pure helpers — unit-test without DOM.
 *
 * Short lists keep a full DOM map (identical pre-virtualization UX).
 * Longer lists use VirtualList inside a max-height scroller.
 */

/** Virtualize when step count exceeds this (≤ threshold → full map). */
export const GROK_ACTIVITY_VIRTUALIZE_THRESHOLD = 14;

/**
 * Fixed row height for windowed activity steps.
 * Matches virtual CSS on `.grok-act__steps--virtual .grok-act__step`
 * (natural non-virtual rows are ~line 1.4×15 + padding ≈ 30–31px).
 */
export const GROK_ACTIVITY_STEP_ROW_PX = 30;

/** Max rows visible in the virtual scroller before overflow. */
export const GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS = 12;

/** True when the list should use VirtualList + max-height scroller. */
export function shouldVirtualizeGrokActivitySteps(stepCount: number): boolean {
  return stepCount > GROK_ACTIVITY_VIRTUALIZE_THRESHOLD;
}

/**
 * maxHeight for the virtual steps scroller: min(visibleRows, count) × rowPx.
 * Empty / non-positive counts return 0.
 */
export function grokActivityVirtualMaxHeightPx(stepCount: number): number {
  const n = Math.min(
    GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS,
    Math.max(0, Math.floor(stepCount)),
  );
  return n * GROK_ACTIVITY_STEP_ROW_PX;
}
