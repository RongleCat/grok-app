import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";

export function PlanReviseModal(props: {
  locale: Locale;
  open: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const tr = createT(props.locale);
  const close = () => {
    props.onClose();
  };
  return (
    <GlassModal
      open={props.open}
      onClose={close}
      title={tr("plan.reviseNoteTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      wrapBody
      className="plan-revise-modal"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={close}>
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            onClick={props.onSubmit}
            data-testid="plan-revise-submit"
          >
            {tr("plan.reviseNoteSubmit")}
          </button>
        </>
      }
    >
      <p className="plan-revise-modal__desc">{tr("plan.reviseNoteDesc")}</p>
      <label className="plan-revise-modal__field">
        <span className="sr-only">{tr("plan.reviseNotePlaceholder")}</span>
        <textarea
          className="plan-revise-modal__textarea"
          value={props.note}
          onChange={(e) => props.onNoteChange(e.target.value)}
          placeholder={tr("plan.reviseNotePlaceholder")}
          rows={4}
          autoFocus
          data-testid="plan-revise-note"
        />
      </label>
    </GlassModal>
  );
}
