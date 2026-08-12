/**
 * Process-only Plan tab body — PlanReviewPanel when live; contextual empty
 * states (parity with ResourceViewer plan empty) otherwise.
 */

import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import { PlanReviewPanel } from "@/components/PlanReviewPanel";
import type { PlanReviewState } from "@/lib/planBody";
import { resolvePlanResourceEmptyState } from "@/lib/planModePro";

export type PlanTabChrome = {
  /** Composer access mode (`plan` | `agent` | …). */
  composerMode?: string;
  /** Settings: allow plan mode (false → spawn --no-plan). Default true. */
  planEnabled?: boolean;
  /** User hard-dismissed this plan cycle. */
  userClosed?: boolean;
  /** Local plan history archive is non-empty. */
  hasHistory?: boolean;
};

export type PlanTabProps = {
  locale: Locale | string;
  plan?: PlanReviewState | null;
  planFocusKey?: number | null;
  /** PLAN-MODE-PRO empty-state context. */
  planChrome?: PlanTabChrome | null;
  onApprovePlan?: () => void;
  onRequestPlanChanges?: (note?: string) => void;
  onDismissPlan?: () => void;
  /** Open local plan history archive. */
  onOpenPlanHistory?: () => void;
};

export function PlanTab({
  locale,
  plan = null,
  planFocusKey = null,
  planChrome = null,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
  onOpenPlanHistory,
}: PlanTabProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);

  const planResourceEmpty = useMemo(
    () =>
      resolvePlanResourceEmptyState({
        planVisible: !!plan?.visible,
        planEnabled: planChrome?.planEnabled !== false,
        userClosed: !!planChrome?.userClosed,
        composerMode: planChrome?.composerMode ?? "agent",
        hasHistory: !!planChrome?.hasHistory,
      }),
    [
      plan?.visible,
      planChrome?.planEnabled,
      planChrome?.userClosed,
      planChrome?.composerMode,
      planChrome?.hasHistory,
    ],
  );

  if (!plan?.visible) {
    return (
      <div className="sw-plan" data-testid="side-plan-tab">
        <div
          className={
            "rp__empty-state plan-resource-empty plan-resource-empty--" +
            (planResourceEmpty?.kind ?? "idle")
          }
          data-testid="plan-resource-empty"
          data-empty-kind={planResourceEmpty?.kind ?? "idle"}
          role="status"
        >
          <div className="rp__empty-title plan-resource-empty__title">
            {tr(planResourceEmpty?.titleKey ?? "resources.plan")}
          </div>
          <div className="rp__empty-desc plan-resource-empty__hint">
            {tr(planResourceEmpty?.hintKey ?? "resources.planEmpty")}
          </div>
          {(planResourceEmpty?.showHistoryCta ?? false) && onOpenPlanHistory ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm plan-resource-empty__cta"
              onClick={onOpenPlanHistory}
              data-testid="plan-resource-empty-history"
            >
              {tr("plan.history")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sw-plan" data-testid="side-plan-tab">
      <PlanReviewPanel
        plan={plan}
        forceExpandKey={planFocusKey}
        labels={{
          ready: tr("plan.ready"),
          waiting: tr("plan.waiting"),
          progress: tr("planBar.progress"),
          done: tr("planBar.done"),
          empty: tr("plan.empty"),
          approve: tr("plan.approve"),
          changes: tr("plan.changes"),
          dismiss: tr("plan.dismiss"),
          steps: tr("plan.steps"),
          fraction: tr("planBar.fraction"),
          expandDetails: tr("plan.expandDetails"),
          collapseDetails: tr("plan.collapseDetails"),
          current: tr("planBar.current"),
          edit: tr("plan.edit"),
          cancelEdit: tr("plan.cancelEdit"),
          requestWithDraft: tr("plan.requestWithDraft"),
          approveDirtyHint: tr("plan.approveDirtyHint"),
          draftPlaceholder: tr("plan.draftPlaceholder"),
          draftAria: tr("plan.draftAria"),
          discardTitle: tr("plan.discardTitle"),
          discardMessage: tr("plan.discardMessage"),
          discardConfirm: tr("plan.discardConfirm"),
          discardCancel: tr("common.cancel"),
          draftEmpty: tr("plan.draftEmpty"),
          draftTooLong: tr("plan.draftTooLong"),
          close: tr("common.close"),
        }}
        onApprove={onApprovePlan}
        onRequestChanges={onRequestPlanChanges}
        onDismiss={onDismissPlan}
      />
    </div>
  );
}
