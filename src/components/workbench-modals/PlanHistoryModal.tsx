import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { PlanHistoryList } from "@/components/PlanHistoryList";
import type { PlanHistoryEntry } from "@/lib/planHistory";

export function PlanHistoryModal(props: {
  locale: Locale;
  open: boolean;
  existingSessionIds: string[];
  onClose: () => void;
  onOpen: (entry: PlanHistoryEntry) => void;
  onOpenSession: (entry: PlanHistoryEntry) => void;
  onRequestClearAll: () => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("plan.historyTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="plan-history-modal"
      footer={
        <button
          type="button"
          className="btn btn--ghost"
          onClick={props.onClose}
        >
          {tr("common.close")}
        </button>
      }
    >
      <p className="plan-history-modal__desc">{tr("plan.historyDesc")}</p>
      <PlanHistoryList
        locale={props.locale}
        labels={{
          empty: tr("plan.historyEmpty"),
          emptyFilter: tr("plan.historyEmptyFilter"),
          open: tr("plan.historyOpen"),
          openSession: tr("plan.historyOpenSession"),
          clearAll: tr("plan.historyClear"),
          searchPlaceholder: tr("plan.historySearchPlaceholder"),
          filterAll: tr("plan.historyFilterAll"),
          decisionApproved: tr("plan.historyDecisionApproved"),
          decisionAbandoned: tr("plan.historyDecisionAbandoned"),
          decisionCompleted: tr("plan.historyDecisionCompleted"),
          listAria: tr("plan.historyTitle"),
        }}
        existingSessionIds={props.existingSessionIds}
        onOpen={props.onOpen}
        onOpenSession={props.onOpenSession}
        onRequestClearAll={props.onRequestClearAll}
      />
    </GlassModal>
  );
}
