import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";

export function PromptHistoryClearModal(props: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("promptHistory.clearRecentConfirmTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="prompt-history-clear-confirm"
            onClick={props.onConfirm}
          >
            {tr("promptHistory.clearRecentConfirmAction")}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {tr("promptHistory.clearRecentConfirmBody")}
      </p>
    </GlassModal>
  );
}
