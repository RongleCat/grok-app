/**
 * PLAN-MODE-PRO — pure helpers for plan mode / plan panel UX.
 *
 * Contextual empty states for Resources → Plan, open-in-resources
 * affordances on the sticky bar, and side-mode pin policy so empty
 * states are actually reachable (not bounced back to Files).
 *
 * No DOM / Tauri / i18n side effects — callers pass `tr(key)`.
 */

import type { PlanBarKind, PlanBarModel } from "@/lib/planStatus";

/** Empty-state kinds when Resources is on Plan but there is no live plan card. */
export type PlanResourceEmptyKind =
  | "disabled"
  | "plan_mode"
  | "user_closed"
  | "idle";

export type PlanResourceEmptyTitleKey =
  | "resources.plan"
  | "plan.waiting"
  | "plan.emptyDisabledTitle"
  | "plan.emptyClosedTitle";

export type PlanResourceEmptyHintKey =
  | "resources.planEmpty"
  | "plan.emptyPlanModeHint"
  | "plan.emptyDisabledHint"
  | "plan.emptyClosedHint"
  | "plan.emptyIdleHint";

export type PlanResourceEmptyPresentation = {
  kind: PlanResourceEmptyKind;
  titleKey: PlanResourceEmptyTitleKey;
  hintKey: PlanResourceEmptyHintKey;
  /** Offer "Plan history" CTA when archive may help. */
  showHistoryCta: boolean;
};

export type PlanResourceEmptyInput = {
  /** Live plan chrome is showing (body / entries / gate). */
  planVisible: boolean;
  /** Settings: allow plan mode (spawn without --no-plan). */
  planEnabled: boolean;
  /** User hard-dismissed this plan cycle. */
  userClosed: boolean;
  /** Composer access mode (`plan` | `agent` | …). */
  composerMode: string;
  /** Local archive has at least one entry. */
  hasHistory: boolean;
};

/**
 * Resolve empty-state presentation for Resources → Plan.
 * Returns `null` when the live PlanReviewPanel should render.
 */
export function resolvePlanResourceEmptyState(
  input: PlanResourceEmptyInput,
): PlanResourceEmptyPresentation | null {
  if (input.planVisible) return null;

  const hasHistory = !!input.hasHistory;

  if (!input.planEnabled) {
    return {
      kind: "disabled",
      titleKey: "plan.emptyDisabledTitle",
      hintKey: "plan.emptyDisabledHint",
      showHistoryCta: hasHistory,
    };
  }

  if (input.userClosed) {
    return {
      kind: "user_closed",
      titleKey: "plan.emptyClosedTitle",
      hintKey: "plan.emptyClosedHint",
      showHistoryCta: true,
    };
  }

  if ((input.composerMode ?? "").trim().toLowerCase() === "plan") {
    return {
      kind: "plan_mode",
      titleKey: "plan.waiting",
      hintKey: "plan.emptyPlanModeHint",
      showHistoryCta: hasHistory,
    };
  }

  return {
    kind: "idle",
    titleKey: "resources.plan",
    hintKey: hasHistory ? "plan.emptyIdleHint" : "resources.planEmpty",
    showHistoryCta: hasHistory,
  };
}

/**
 * Sticky bar should offer 「在资源中打开」 for plan chrome kinds.
 * Goal strip is unrelated; hidden never shows a bar.
 */
export function shouldOfferOpenInResources(input: {
  barKind: PlanBarKind;
  planVisible: boolean;
}): boolean {
  switch (input.barKind) {
    case "plan_review":
      return true;
    case "plan_progress":
      return !!input.planVisible;
    case "plan_mode":
      // Open Resources → Plan empty/waiting even before the agent drafts.
      return true;
    case "goal":
    case "hidden":
    default:
      return false;
  }
}

/**
 * Convenience over a resolved bar model.
 */
export function shouldOfferOpenInResourcesFromModel(
  model: Pick<PlanBarModel, "kind">,
  planVisible: boolean,
): boolean {
  return shouldOfferOpenInResources({ barKind: model.kind, planVisible });
}

/**
 * When plan becomes non-visible, leave Plan side only if the user did not
 * pin it via open-in-resources / planFocusKey.
 */
export function shouldAutoLeavePlanSideMode(input: {
  sideModeIsPlan: boolean;
  planVisible: boolean;
  userPinnedPlanSide: boolean;
}): boolean {
  if (!input.sideModeIsPlan) return false;
  if (input.planVisible) return false;
  if (input.userPinnedPlanSide) return false;
  return true;
}

/**
 * Whether the Resources chrome Plan toggle should appear.
 * Visible plan, plan mode, hard-closed cycle, or user pin.
 */
export function shouldShowPlanChromeButton(input: {
  planVisible: boolean;
  composerMode: string;
  userClosed: boolean;
  userPinnedPlanSide: boolean;
}): boolean {
  if (input.planVisible) return true;
  if (input.userPinnedPlanSide) return true;
  if (input.userClosed) return true;
  if ((input.composerMode ?? "").trim().toLowerCase() === "plan") return true;
  return false;
}

/**
 * Whether PlanReviewPanel has expandable body/steps (not a blank waiting card).
 */
export function planHasExpandableContent(input: {
  body?: string | null;
  entries?: unknown[] | null;
}): boolean {
  if ((input.body ?? "").trim()) return true;
  if (Array.isArray(input.entries) && input.entries.length > 0) return true;
  return false;
}

/**
 * Empty copy inside an expanded PlanReviewPanel when body+entries are blank.
 * Distinct from the Resources-level empty state (no live plan at all).
 */
export type PlanPanelInnerEmptyKind = "waiting" | "blank";

export function resolvePlanPanelInnerEmpty(input: {
  waiting: boolean;
  hasExpandableContent: boolean;
}): PlanPanelInnerEmptyKind | null {
  if (input.hasExpandableContent) return null;
  return input.waiting ? "waiting" : "blank";
}

/** Stable i18n key for PlanReviewPanel inner empty. */
export function planPanelInnerEmptyLabelKey(
  kind: PlanPanelInnerEmptyKind,
): "plan.waiting" | "plan.empty" {
  return kind === "waiting" ? "plan.waiting" : "plan.empty";
}

/**
 * Product loop: after Approve & build, leave transient composer plan mode so
 * the sticky bar does not re-show the idle “Plan mode” chip while the agent
 * executes. Request-changes keeps plan mode; hard-dismiss leaves mode as-is
 * (user may still want plan mode for a new draft).
 */
export function shouldExitComposerPlanModeAfterDecision(input: {
  decision: "approved" | "cancelled" | "abandoned";
  composerMode: string;
}): boolean {
  if ((input.composerMode ?? "").trim().toLowerCase() !== "plan") return false;
  return input.decision === "approved";
}

/**
 * Side Workbench / Resources: open or focus the Plan tab.
 * Live plan visibility auto-opens; planFocusKey bumps open even when the
 * plan is not yet visible (bare plan-mode chip → open-in-resources empty).
 */
export function shouldOpenPlanSideTab(input: {
  autoOpenEnabled: boolean;
  planVisible: boolean;
  focusKey: number | null | undefined;
  lastFocusKey: number | null;
}): { open: boolean; nextLastFocusKey: number | null } {
  if (!input.autoOpenEnabled) {
    return { open: false, nextLastFocusKey: input.lastFocusKey };
  }
  let nextLast = input.lastFocusKey;
  let focusBump = false;
  if (input.focusKey != null && input.focusKey !== input.lastFocusKey) {
    focusBump = true;
    nextLast = input.focusKey;
  }
  return {
    open: !!input.planVisible || focusBump,
    nextLastFocusKey: nextLast,
  };
}
