/**
 * Plan review workbench (resource pane).
 *
 * - **Awaiting review** (`rpcId`): expand by default — Markdown + approve/revise.
 * - **In progress** (entries, no gate): collapsed by default — top progress only;
 *   click header / expand control to show steps + detail body.
 */

import { useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { OverlayScroll } from "@/components/OverlayScroll";
import { IconChevronDown, IconChevronRight, IconPlan } from "@/components/icons";
import {
  planActionsEnabled,
  planDisplayMarkdown,
  planIsAwaitingReview,
  type PlanReviewState,
} from "@/lib/planBody";
import {
  computePlanProgress,
  formatPlanFraction,
  parsePlanEntries,
  resolvePlanBarModel,
} from "@/lib/planStatus";

export type PlanReviewPanelLabels = {
  ready: string;
  waiting: string;
  progress: string;
  done: string;
  empty: string;
  approve: string;
  changes: string;
  dismiss: string;
  steps: string;
  fraction: string;
  /** Expand control when collapsed. */
  expandDetails: string;
  /** Collapse control when expanded. */
  collapseDetails: string;
  current: string;
};

export type PlanReviewPanelProps = {
  plan: PlanReviewState;
  labels: PlanReviewPanelLabels;
  /** When set, forces expand (e.g. user clicked 详情 during progress). */
  forceExpandKey?: number | null;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  onDismiss?: () => void;
};

export function PlanReviewPanel({
  plan,
  labels,
  forceExpandKey = null,
  onApprove,
  onRequestChanges,
  onDismiss,
}: PlanReviewPanelProps) {
  const hasBody = !!plan.body.trim();
  const entries = useMemo(
    () => parsePlanEntries(plan.entries),
    [plan.entries],
  );
  const progress = useMemo(() => computePlanProgress(entries), [entries]);
  const fraction = formatPlanFraction(progress);
  const canAct = planActionsEnabled(plan);
  const awaitingReview = planIsAwaitingReview(plan);

  const model = useMemo(
    () =>
      resolvePlanBarModel({
        goalMode: false,
        mode: "agent",
        planVisible: plan.visible,
        planWaiting: plan.waiting,
        planRpcId: plan.rpcId,
        entries: plan.entries,
      }),
    [plan.visible, plan.waiting, plan.rpcId, plan.entries],
  );

  // Real planContent markdown only (do not dump raw entries as MD when collapsed).
  const detailMarkdown = useMemo(() => {
    if (hasBody) return plan.body.trim();
    // Review with only entries: still show structured list below, no raw dump.
    if (awaitingReview && !entries.length) {
      return planDisplayMarkdown(plan.body, plan.entries);
    }
    return "";
  }, [hasBody, plan.body, plan.entries, awaitingReview, entries.length]);

  const statusLabel =
    model.headlineKey === "planBar.progress"
      ? labels.progress
      : model.headlineKey === "planBar.done"
        ? labels.done
        : model.headlineKey === "planBar.review"
          ? labels.ready
          : plan.waiting && !canAct
            ? labels.waiting
            : labels.ready;

  // Review gate → expanded; pure progress → collapsed until user opens.
  const defaultExpanded = awaitingReview || (hasBody && entries.length === 0);
  const [expanded, setExpanded] = useState(defaultExpanded);

  // When plan identity / gate flips, reset expand policy.
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded, plan.rpcId, plan.title]);

  // 详情 / planFocusKey: force expand so steps+detail are visible.
  useEffect(() => {
    if (forceExpandKey == null) return;
    setExpanded(true);
  }, [forceExpandKey]);

  const hasExpandableContent =
    entries.length > 0 || !!detailMarkdown || !!planDisplayMarkdown(plan.body, plan.entries);

  const toggleExpand = () => {
    if (!hasExpandableContent) return;
    setExpanded((v) => !v);
  };

  return (
    <div
      className={
        "plan-review" +
        (expanded ? " plan-review--expanded" : " plan-review--collapsed")
      }
      data-testid="plan-review-panel"
      data-plan-card
    >
      <header className="plan-review__header">
        <button
          type="button"
          className="plan-review__title-row plan-review__title-row--btn"
          onClick={toggleExpand}
          disabled={!hasExpandableContent}
          aria-expanded={expanded}
        >
          <span className="plan-review__icon" aria-hidden>
            <IconPlan size={16} />
          </span>
          <div className="plan-review__titles">
            <div className="plan-review__status">{statusLabel}</div>
            <h2 className="plan-review__title">{plan.title || statusLabel}</h2>
            {!expanded && model.currentLabel ? (
              <div className="plan-review__current" title={model.currentLabel}>
                <span className="plan-review__current-label">{labels.current}</span>
                <span className="plan-review__current-step">
                  {model.currentLabel}
                </span>
              </div>
            ) : null}
          </div>
          {fraction ? (
            <span className="plan-review__fraction">
              {labels.fraction.replace("{n}", fraction)}
            </span>
          ) : null}
          {hasExpandableContent ? (
            <span className="plan-review__chevron" aria-hidden>
              {expanded ? (
                <IconChevronDown size={16} />
              ) : (
                <IconChevronRight size={16} />
              )}
            </span>
          ) : null}
        </button>

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
          {hasExpandableContent ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={toggleExpand}
            >
              {expanded ? labels.collapseDetails : labels.expandDetails}
            </button>
          ) : null}
          {canAct && onApprove ? (
            <button
              type="button"
              className="btn btn--solid btn--sm"
              onClick={onApprove}
            >
              {labels.approve}
            </button>
          ) : null}
          {canAct && onRequestChanges ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
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

      {expanded ? (
        <OverlayScroll className="plan-review__scroll">
          <div className="plan-review__body">
            {entries.length > 0 ? (
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

            {detailMarkdown ? (
              <div
                className={
                  "plan-review__md" +
                  (entries.length > 0 ? " plan-review__md--after-steps" : "")
                }
              >
                <MarkdownBody>{detailMarkdown}</MarkdownBody>
              </div>
            ) : !entries.length ? (
              <p className="plan-review__empty">{labels.empty}</p>
            ) : null}
          </div>
        </OverlayScroll>
      ) : null}
    </div>
  );
}
