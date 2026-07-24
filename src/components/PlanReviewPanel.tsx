/**
 * Plan review workbench — full markdown body + step list + approve/revise.
 * Used by ResourceViewer (primary) and optionally thread compact views.
 */

import { useMemo } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { OverlayScroll } from "@/components/OverlayScroll";
import { IconPlan } from "@/components/icons";
import {
  planActionsEnabled,
  planDisplayMarkdown,
  type PlanReviewState,
} from "@/lib/planBody";
import {
  computePlanProgress,
  formatPlanFraction,
  parsePlanEntries,
} from "@/lib/planStatus";

export type PlanReviewPanelLabels = {
  ready: string;
  waiting: string;
  empty: string;
  approve: string;
  changes: string;
  dismiss: string;
  steps: string;
  fraction: string;
  openInResources?: string;
};

export type PlanReviewPanelProps = {
  plan: PlanReviewState;
  labels: PlanReviewPanelLabels;
  /** Compact: shorter header, used if ever embedded elsewhere. */
  compact?: boolean;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  onDismiss?: () => void;
};

export function PlanReviewPanel({
  plan,
  labels,
  compact = false,
  onApprove,
  onRequestChanges,
  onDismiss,
}: PlanReviewPanelProps) {
  const hasBody = !!plan.body.trim();
  const markdown = useMemo(
    () => planDisplayMarkdown(plan.body, plan.entries),
    [plan.body, plan.entries],
  );
  const entries = useMemo(
    () => parsePlanEntries(plan.entries),
    [plan.entries],
  );
  const progress = useMemo(() => computePlanProgress(entries), [entries]);
  const fraction = formatPlanFraction(progress);
  const canAct = planActionsEnabled(plan);
  const statusLabel = plan.waiting && !canAct ? labels.waiting : labels.ready;
  // Steps list only when body is real planContent (avoid duplicating synthesized MD).
  const showStepsList = hasBody && entries.length > 0;

  return (
    <div
      className={
        "plan-review" + (compact ? " plan-review--compact" : "")
      }
      data-testid="plan-review-panel"
      data-plan-card
    >
      <header className="plan-review__header">
        <div className="plan-review__title-row">
          <span className="plan-review__icon" aria-hidden>
            <IconPlan size={16} />
          </span>
          <div className="plan-review__titles">
            <div className="plan-review__status">{statusLabel}</div>
            <h2 className="plan-review__title">{plan.title || statusLabel}</h2>
          </div>
          {fraction ? (
            <span className="plan-review__fraction">
              {labels.fraction.replace("{n}", fraction)}
            </span>
          ) : null}
        </div>
        {progress.total > 0 ? (
          <div
            className="plan-review__meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
          >
            <div
              className="plan-review__meter-fill"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        ) : null}
        <div className="plan-review__actions">
          {onApprove ? (
            <button
              type="button"
              className="btn btn--solid btn--sm"
              disabled={!canAct}
              onClick={onApprove}
            >
              {labels.approve}
            </button>
          ) : null}
          {onRequestChanges ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!canAct}
              onClick={onRequestChanges}
            >
              {labels.changes}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onDismiss}
            >
              {labels.dismiss}
            </button>
          ) : null}
        </div>
      </header>

      <OverlayScroll className="plan-review__scroll">
        <div className="plan-review__body">
          {markdown ? (
            <div className="plan-review__md">
              <MarkdownBody>{markdown}</MarkdownBody>
            </div>
          ) : (
            <p className="plan-review__empty">{labels.empty}</p>
          )}

          {showStepsList ? (
            <section className="plan-review__steps">
              <h3 className="plan-review__steps-title">{labels.steps}</h3>
              <ol className="plan-review__steps-list">
                {entries.map((e, i) => (
                  <li
                    key={`${i}-${e.content.slice(0, 24)}`}
                    className={
                      "plan-review__step plan-review__step--" + e.status
                    }
                  >
                    <span className="plan-review__step-status" aria-hidden>
                      {e.status === "completed"
                        ? "✓"
                        : e.status === "in_progress"
                          ? "●"
                          : e.status === "cancelled"
                            ? "–"
                            : "○"}
                    </span>
                    <span className="plan-review__step-text">{e.content}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </OverlayScroll>
    </div>
  );
}
