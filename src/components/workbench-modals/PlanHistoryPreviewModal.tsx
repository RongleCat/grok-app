import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { MarkdownBody } from "@/components/MarkdownBody";
import { formatListTimestamp } from "@/lib/formatDateTime";
import type { PlanHistoryEntry } from "@/lib/planHistory";

export function PlanHistoryPreviewModal(props: {
  locale: Locale;
  entry: PlanHistoryEntry | null;
  canOpenSession: boolean;
  onClose: () => void;
  onOpenSession: () => void;
}) {
  const tr = createT(props.locale);
  const entry = props.entry;
  return (
    <GlassModal
      open={!!entry}
      onClose={props.onClose}
      title={tr("plan.historyPreviewTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="plan-history-preview-modal"
      footer={
        <>
          {entry && props.canOpenSession ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onOpenSession}
            >
              {tr("plan.historyOpenSession")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("common.close")}
          </button>
        </>
      }
    >
      {entry ? (
        <div className="plan-history-preview">
          <div className="plan-history-preview__meta">
            <span>
              {entry.decision === "approved"
                ? tr("plan.historyDecisionApproved")
                : entry.decision === "abandoned"
                  ? tr("plan.historyDecisionAbandoned")
                  : tr("plan.historyDecisionCompleted")}
            </span>
            {entry.title ? (
              <span title={entry.title}>{entry.title}</span>
            ) : null}
            {entry.at ? (
              <span>{formatListTimestamp(entry.at, props.locale)}</span>
            ) : null}
          </div>
          {entry.bodyPreview.trim() ? (
            <MarkdownBody locale={props.locale}>{entry.bodyPreview}</MarkdownBody>
          ) : (
            <div className="plan-history-preview__empty">
              {tr("plan.historyPreviewEmpty")}
            </div>
          )}
        </div>
      ) : null}
    </GlassModal>
  );
}
