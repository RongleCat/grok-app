import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { TraceHistoryList } from "@/components/TraceHistoryList";

export function TracesHistoryModal(props: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.tracesTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="trace-history-modal"
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
      <p className="trace-history-modal__desc">{tr("session.tracesDesc")}</p>
      <TraceHistoryList
        locale={props.locale}
        labels={{
          empty: tr("session.tracesEmpty"),
          emptyFilter: tr("session.tracesEmptyFilter"),
          reveal: tr("session.tracesReveal"),
          copyPath: tr("session.tracesCopyPath"),
          copied: tr("session.tracesCopied"),
          remove: tr("session.tracesRemove"),
          clearAll: tr("session.tracesClearAll"),
          clearConfirmTitle: tr("session.tracesClearConfirmTitle"),
          clearConfirmMessage: tr("session.tracesClearConfirmMessage"),
          clearConfirmAction: tr("session.tracesClearConfirmAction"),
          cancel: tr("common.cancel"),
          searchPlaceholder: tr("session.tracesSearch"),
          listAria: tr("session.tracesTitle"),
          uploadedBadge: tr("session.tracesUploadedBadge"),
        }}
        onError={props.onError}
      />
    </GlassModal>
  );
}
