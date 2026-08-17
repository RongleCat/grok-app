/**
 * Windowing thresholds for Grok activity step lists (TimelinePhaseBlock).
 * Pure helpers — unit-test without DOM.
 *
 * Short lists keep a full DOM map (identical pre-virtualization UX).
 * Longer lists use VirtualList inside a max-height scroller.
 * Expand open/user-toggled sets live on the parent so remounts do not wipe them.
 */

import { toolStepDefaultOpen } from "./toolStepsAutoCollapsePref";

/** Virtualize when step count exceeds this (≤ threshold → full map). */
export const GROK_ACTIVITY_VIRTUALIZE_THRESHOLD = 14;

/**
 * Fixed row height for windowed activity steps.
 * Matches virtual CSS on `.grok-act__steps--virtual .grok-act__step`
 * (label 13px × 1.4 + icon padding ≈ 34–36px).
 */
export const GROK_ACTIVITY_STEP_ROW_PX = 36;

/** Max rows visible in the virtual scroller before overflow. */
export const GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS = 18;

/**
 * Mapped (speech / expanded) lists use this CSS cap — not N × 36.
 * Must stay in sync with `.grok-act__steps--capped { max-height: min(70vh, 40rem) }`.
 */
export const GROK_ACTIVITY_MAPPED_CAP_PX = 640;

/** True when the list should use VirtualList + max-height scroller. */
export function shouldVirtualizeGrokActivitySteps(stepCount: number): boolean {
  return stepCount > GROK_ACTIVITY_VIRTUALIZE_THRESHOLD;
}

/**
 * Fixed VirtualList row height cannot host expanded detail.
 * Leave windowing whenever any step is expanded (parent owns expanded keys so
 * the virtual→map remount does not wipe open state).
 */
export function shouldVirtualizeActivityWithExpand(
  stepCount: number,
  expandedKeyCount: number,
  liveBodyCount = 0,
): boolean {
  return (
    shouldVirtualizeGrokActivitySteps(stepCount) &&
    expandedKeyCount === 0 &&
    liveBodyCount === 0
  );
}

/**
 * Parent-owned expand set update. Remounts must call this only on real user
 * toggles / policy defaults — never clear a key solely because a row unmounted.
 */
export function applyActivityStepExpand(
  prev: ReadonlySet<string>,
  key: string,
  open: boolean,
): Set<string> {
  const k = (key || "").trim();
  if (!k) return prev instanceof Set ? prev : new Set(prev);
  const has = prev.has(k);
  if (open === has) return prev instanceof Set ? prev : new Set(prev);
  const next = new Set(prev);
  if (open) next.add(k);
  else next.delete(k);
  return next;
}

/** Parent-owned expand + user-toggle sets for activity step rows. */
export type ActivityStepExpandState = {
  expandedKeys: ReadonlySet<string>;
  /** Keys the user manually opened/closed — policy must not override. */
  userToggledKeys: ReadonlySet<string>;
};

export function emptyActivityStepExpandState(): ActivityStepExpandState {
  return { expandedKeys: new Set(), userToggledKeys: new Set() };
}

/**
 * Desired open for a step with detail body.
 * Matches TimelineToolRow: running → open; finished → !autoCollapse;
 * user-toggled → null (leave current expandedKeys alone).
 * No-body → null.
 */
export function resolveActivityStepExpandDesired(opts: {
  hasBody: boolean;
  running: boolean;
  autoCollapse: boolean;
  userToggled: boolean;
}): boolean | null {
  if (!opts.hasBody) return null;
  if (opts.userToggled) return null;
  return toolStepDefaultOpen(opts.running, opts.autoCollapse);
}

/**
 * Apply default/running policy without wiping user toggles.
 * Always sets expandedKeys to wantOpen when policy applies — including
 * collapsing running→finished under default autoCollapse=true.
 */
export function applyActivityStepExpandPolicy(
  state: ActivityStepExpandState,
  key: string,
  opts: {
    hasBody: boolean;
    running: boolean;
    autoCollapse: boolean;
  },
): ActivityStepExpandState {
  const k = (key || "").trim();
  if (!k) return state;
  const userToggled = state.userToggledKeys.has(k);
  const want = resolveActivityStepExpandDesired({
    hasBody: opts.hasBody,
    running: opts.running,
    autoCollapse: opts.autoCollapse,
    userToggled,
  });
  if (want === null) return state;
  const expandedKeys = applyActivityStepExpand(state.expandedKeys, k, want);
  if (expandedKeys === state.expandedKeys) return state;
  return { expandedKeys, userToggledKeys: state.userToggledKeys };
}

/** User click: mark key as user-managed and set open. Survives remount. */
export function applyActivityStepUserToggle(
  state: ActivityStepExpandState,
  key: string,
  open: boolean,
): ActivityStepExpandState {
  const k = (key || "").trim();
  if (!k) return state;
  const userToggledKeys = new Set(state.userToggledKeys);
  userToggledKeys.add(k);
  const expandedKeys = applyActivityStepExpand(state.expandedKeys, k, open);
  return { expandedKeys, userToggledKeys };
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

/**
 * Whether a mapped (non-virtual) step list should use the tall CSS cap.
 * Speech / expanded rows are variable height — never reuse the virtual
 * N × rowPx math or flex will crush them into that box.
 */
export function shouldCapMappedGrokActivitySteps(stepCount: number): boolean {
  return shouldVirtualizeGrokActivitySteps(stepCount);
}
