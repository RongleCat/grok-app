/** Sticky plan/goal strip — stays put while the in-thread plan card scrolls away. */

import { useMemo } from "react";
import { IconCheck, IconPlan, IconClose } from "@/components/icons";
import {
  formatPlanFraction,
  resolvePlanBarModel,
  shouldShowPlanBar,
  type PlanBarModel,
} from "@/lib/planStatus";
import { shouldOfferOpenInResourcesFromModel } from "@/lib/planModePro";

export type PlanStatusBarLabels = {
  goal: string;
  planMode: string;
  progress: string;
  review: string;
  done: string;
  resume: string;
  fraction: string;
  current: string;
  approve: string;
  changes: string;
  dismiss: string;
  /** Exit bare plan-mode chip (composer plan → agent). Falls back to dismiss. */
  exitPlanMode?: string;
  expand: string;
  /** Exit goal mode (goal strip only). */
  clearGoal: string;
  aria: string;
};

export type PlanStatusBarProps = {
  goalMode: boolean;
  mode: string;
  planVisible: boolean;
  planWaiting: boolean;
  planRpcId?: number | null;
  /** Restored chrome waiting for Build re-park / reconnect. */
  planNeedsResume?: boolean;
  entries: unknown[];
  labels: PlanStatusBarLabels;
  onApprove?: () => void;
  /** Optional revision note (same contract as PlanReviewPanel). */
  onRequestChanges?: (note?: string) => void;
  onDismiss?: () => void;
  /** Exit the bare plan-mode chip (mode === "plan", no plan body). */
  onExitPlanMode?: () => void;
  /** Exit goal mode from the sticky goal strip. */
  onClearGoal?: () => void;
  /** Scroll / focus the in-thread plan card when present. */
  onOpenDetails?: () => void;
};

function headlineFor(model: PlanBarModel, labels: PlanStatusBarLabels): string {
  switch (model.headlineKey) {
    case "planBar.goal":
      return labels.goal;
    case "planBar.planMode":
      return labels.planMode;
    case "planBar.progress":
      return labels.progress;
    case "planBar.review":
      return labels.review;
    case "planBar.done":
      return labels.done;
    case "planBar.resume":
      return labels.resume;
    default:
      return labels.planMode;
  }
}

export function PlanStatusBar({
  goalMode,
  mode,
  planVisible,
  planWaiting,
  planRpcId = null,
  planNeedsResume = false,
  entries,
  labels,
  onApprove,
  onRequestChanges,
  onDismiss,
  onExitPlanMode,
  onClearGoal,
  onOpenDetails,
}: PlanStatusBarProps) {
  const model = useMemo(
    () =>
      resolvePlanBarModel({
        goalMode,
        mode,
        planVisible,
        planWaiting,
        planRpcId,
        planNeedsResume,
        entries,
      }),
    [goalMode, mode, planVisible, planWaiting, planRpcId, planNeedsResume, entries],
  );

  if (!shouldShowPlanBar(model)) return null;

  const fraction = formatPlanFraction(model.progress);
  const headline = headlineFor(model, labels);
  const kindClass =
    model.kind === "goal"
      ? "plan-bar--goal"
      : model.kind === "plan_review"
        ? "plan-bar--review"
        : model.kind === "plan_progress"
          ? "plan-bar--progress"
          : "plan-bar--mode";

  return (
    <div
      className={`plan-bar ${kindClass}`}
      role="status"
      aria-live="polite"
      aria-label={labels.aria}
      data-testid="plan-status-bar"
      data-kind={model.kind}
    >
      <div className="plan-bar__main">
        <span className="plan-bar__icon" aria-hidden>
          {model.headlineKey === "planBar.done" ? (
            <IconCheck size={14} />
          ) : (
            <IconPlan size={14} />
          )}
        </span>
        <div className="plan-bar__text">
          <div className="plan-bar__headline">
            <strong>{headline}</strong>
            {fraction ? (
              <span className="plan-bar__fraction">
                {labels.fraction.replace("{n}", fraction)}
              </span>
            ) : null}
          </div>
          {model.currentLabel ? (
            <div className="plan-bar__current" title={model.currentLabel}>
              <span className="plan-bar__current-label">{labels.current}</span>
              <span className="plan-bar__current-step">{model.currentLabel}</span>
            </div>
          ) : null}
        </div>
      </div>

      {model.progress.total > 0 ? (
        <div
          className="plan-bar__meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={model.progress.total}
          aria-valuenow={model.progress.completed}
          aria-label={fraction || headline}
        >
          <div
            className="plan-bar__meter-fill"
            style={{ width: `${model.progress.percent}%` }}
          />
        </div>
      ) : null}

      <div className="plan-bar__actions">
        {shouldOfferOpenInResourcesFromModel(model, planVisible) &&
        onOpenDetails ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn"
            onClick={onOpenDetails}
            data-testid="plan-bar-open-resources"
            title={labels.expand}
          >
            {labels.expand}
          </button>
        ) : null}
        {model.showActions && onApprove ? (
          <button
            type="button"
            className="btn btn--solid btn--sm plan-bar__btn"
            onClick={onApprove}
          >
            {labels.approve}
          </button>
        ) : null}
        {model.showActions && onRequestChanges ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn"
            onClick={() => onRequestChanges()}
          >
            {labels.changes}
          </button>
        ) : null}
        {model.kind === "goal" && onClearGoal ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn plan-bar__btn--clear-goal"
            onClick={onClearGoal}
            data-testid="plan-status-clear-goal"
            title={labels.clearGoal}
          >
            <IconClose size={12} />
            <span>{labels.clearGoal}</span>
          </button>
        ) : null}
        {(model.kind === "plan_progress" ||
          model.kind === "plan_review" ||
          planVisible) &&
        onDismiss ? (
          <button
            type="button"
            className="icon-btn plan-bar__close"
            onClick={() => void onDismiss()}
            aria-label={labels.dismiss}
            title={labels.dismiss}
          >
            <IconClose size={14} />
          </button>
        ) : null}
        {model.kind === "plan_mode" && onExitPlanMode ? (
          <button
            type="button"
            className="icon-btn plan-bar__close"
            onClick={() => onExitPlanMode()}
            aria-label={labels.exitPlanMode ?? labels.dismiss}
            title={labels.exitPlanMode ?? labels.dismiss}
            data-testid="plan-status-exit-plan-mode"
          >
            <IconClose size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
