/**
 * Plan review workbench (resource pane).
 *
 * - **Awaiting review** (`rpcId`): expand by default — Markdown + approve/revise.
 * - **In progress** (entries, no gate): collapsed by default — top progress only;
 *   click header / expand control to show steps + detail body.
 * - **Edit canvas**: when the exit_plan_mode gate is open, users can edit plan
 *   markdown locally; dirty drafts disable Approve and send via request-changes
 *   with clear revised-plan markers (see `planEditCanvas`).
 */

import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
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
  buildRequestChangesNoteFromDraft,
  planDraftIsDirty,
  planEditEmptyState,
  sanitizePlanDraft,
  validatePlanDraft,
} from "@/lib/planEditCanvas";
import {
  planHasExpandableContent,
  planPanelInnerEmptyLabelKey,
  resolvePlanPanelInnerEmpty,
} from "@/lib/planModePro";
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
  /** Enter local plan draft edit mode. */
  edit: string;
  /** Leave edit mode (clean). */
  cancelEdit: string;
  /** Primary when draft is dirty — send revised plan via request-changes. */
  requestWithDraft: string;
  /** Hint when Approve is disabled because the draft is dirty. */
  approveDirtyHint: string;
  /** Textarea aria / placeholder. */
  draftPlaceholder: string;
  draftAria: string;
  /** Discard dirty draft confirm modal. */
  discardTitle: string;
  discardMessage: string;
  discardConfirm: string;
  discardCancel: string;
  /** Soft-fail when draft is empty / too long. */
  draftEmpty: string;
  draftTooLong: string;
  /** Close dialog button label. */
  close: string;
};

export type PlanReviewPanelProps = {
  plan: PlanReviewState;
  labels: PlanReviewPanelLabels;
  /** When set, forces expand (e.g. user clicked 详情 during progress). */
  forceExpandKey?: number | null;
  onApprove?: () => void;
  /**
   * Request plan revisions. Optional `note` is free-form feedback for the agent.
   * Callers may open a note modal first, then invoke with the string (empty ok).
   * When the edit canvas sends a dirty draft, `note` includes revised-plan markers.
   */
  onRequestChanges?: (note?: string) => void;
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
  const editAvail = planEditEmptyState({ canAct, hasBody });

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

  /** Baseline for dirty checks — full body, else steps rendered as markdown. */
  const originalBody = useMemo(() => {
    if (plan.body) return sanitizePlanDraft(plan.body);
    return sanitizePlanDraft(planDisplayMarkdown(plan.body, plan.entries));
  }, [plan.body, plan.entries]);

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(originalBody);
  const [discardOpen, setDiscardOpen] = useState(false);

  const dirty = planDraftIsDirty(originalBody, draft);
  const draftValidation = validatePlanDraft(draft);

  // When plan identity / gate flips, reset expand policy and leave edit mode.
  useEffect(() => {
    setExpanded(defaultExpanded);
    setEditing(false);
    setDraft(originalBody);
    setDiscardOpen(false);
  }, [defaultExpanded, plan.rpcId, plan.title, originalBody]);

  // 详情 / planFocusKey: force expand so steps+detail are visible.
  useEffect(() => {
    if (forceExpandKey == null) return;
    setExpanded(true);
  }, [forceExpandKey]);

  const hasExpandableContent =
    planHasExpandableContent({ body: detailMarkdown || plan.body, entries }) ||
    !!planDisplayMarkdown(plan.body, plan.entries) ||
    editing;

  const innerEmptyKind = resolvePlanPanelInnerEmpty({
    waiting: plan.waiting && !canAct,
    hasExpandableContent,
  });
  const innerEmptyLabel =
    innerEmptyKind != null
      ? planPanelInnerEmptyLabelKey(innerEmptyKind) === "plan.waiting"
        ? labels.waiting
        : labels.empty
      : null;

  const toggleExpand = () => {
    if (!hasExpandableContent) return;
    setExpanded((v) => !v);
  };

  const enterEdit = () => {
    setDraft(originalBody);
    setEditing(true);
    setExpanded(true);
  };

  const leaveEditClean = () => {
    setEditing(false);
    setDraft(originalBody);
    setDiscardOpen(false);
  };

  const requestCancelEdit = () => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    leaveEditClean();
  };

  const submitDraftChanges = () => {
    if (!onRequestChanges) return;
    if (!dirty) {
      onRequestChanges();
      return;
    }
    if (!draftValidation.ok) return;
    const note = buildRequestChangesNoteFromDraft({
      originalBody,
      draft,
    });
    onRequestChanges(note);
    leaveEditClean();
  };

  const approveDisabled = dirty;
  const draftErrorLabel =
    editing && dirty && !draftValidation.ok
      ? draftValidation.reason === "too_long"
        ? labels.draftTooLong
        : labels.draftEmpty
      : null;

  return (
    <div
      className={
        "plan-review" +
        (expanded ? " plan-review--expanded" : " plan-review--collapsed") +
        (editing ? " plan-review--editing" : "")
      }
      data-testid="plan-review-panel"
      data-plan-card
      data-plan-editing={editing ? "true" : undefined}
      data-plan-dirty={dirty ? "true" : undefined}
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
          {hasExpandableContent && !editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={toggleExpand}
            >
              {expanded ? labels.collapseDetails : labels.expandDetails}
            </button>
          ) : null}
          {editAvail.canEdit && !editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={enterEdit}
              data-testid="plan-review-edit"
            >
              {labels.edit}
            </button>
          ) : null}
          {editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={requestCancelEdit}
              data-testid="plan-review-cancel-edit"
            >
              {labels.cancelEdit}
            </button>
          ) : null}
          {canAct && onApprove ? (
            <button
              type="button"
              className="btn btn--solid btn--sm"
              onClick={onApprove}
              disabled={approveDisabled}
              title={approveDisabled ? labels.approveDirtyHint : undefined}
              data-testid="plan-review-approve"
            >
              {labels.approve}
            </button>
          ) : null}
          {canAct && onRequestChanges && editing && dirty ? (
            <button
              type="button"
              className="btn btn--solid btn--sm"
              onClick={submitDraftChanges}
              disabled={!draftValidation.ok}
              data-testid="plan-review-request-with-draft"
            >
              {labels.requestWithDraft}
            </button>
          ) : null}
          {canAct && onRequestChanges && !(editing && dirty) ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => onRequestChanges()}
              data-testid="plan-review-request-changes"
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
        {approveDisabled && canAct ? (
          <p
            className="plan-review__dirty-hint"
            role="status"
            data-testid="plan-review-dirty-hint"
          >
            {labels.approveDirtyHint}
          </p>
        ) : null}
        {draftErrorLabel ? (
          <p
            className="plan-review__draft-error"
            role="alert"
            data-testid="plan-review-draft-error"
          >
            {draftErrorLabel}
          </p>
        ) : null}
      </header>

      {expanded ? (
        <OverlayScroll className="plan-review__scroll">
          <div className="plan-review__body">
            {entries.length > 0 && !editing ? (
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

            {editing ? (
              <div className="plan-review__editor">
                <textarea
                  className="plan-review__textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={labels.draftPlaceholder}
                  aria-label={labels.draftAria}
                  spellCheck={false}
                  data-testid="plan-review-draft"
                />
              </div>
            ) : detailMarkdown ? (
              <div
                className={
                  "plan-review__md" +
                  (entries.length > 0 ? " plan-review__md--after-steps" : "")
                }
              >
                <MarkdownBody>{detailMarkdown}</MarkdownBody>
              </div>
            ) : !entries.length && innerEmptyLabel ? (
              <p
                className={
                  "plan-review__empty" +
                  (innerEmptyKind === "waiting"
                    ? " plan-review__empty--waiting"
                    : "")
                }
                data-empty-kind={innerEmptyKind ?? undefined}
              >
                {innerEmptyLabel}
              </p>
            ) : null}
          </div>
        </OverlayScroll>
      ) : null}

      <GlassModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title={labels.discardTitle}
        size="sm"
        closeLabel={labels.close}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDiscardOpen(false)}
            >
              {labels.discardCancel}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={leaveEditClean}
              data-testid="plan-review-discard-confirm"
            >
              {labels.discardConfirm}
            </button>
          </>
        }
      >
        <p className="plan-review__discard-msg">{labels.discardMessage}</p>
      </GlassModal>
    </div>
  );
}
