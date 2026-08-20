import { GlassModal } from "@/components/GlassModal";

export function ConfirmCopyModal(props: {
  open: boolean;
  title: string;
  body: string;
  closeLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  confirmTestId?: string;
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      size="sm"
      closeLabel={props.closeLabel}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {props.cancelLabel}
          </button>
          <button
            type="button"
            className={
              props.danger ? "btn btn--solid btn--danger" : "btn btn--solid"
            }
            data-testid={props.confirmTestId}
            disabled={props.confirmDisabled}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <p className="rp-modal-copy" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {props.body}
      </p>
    </GlassModal>
  );
}
