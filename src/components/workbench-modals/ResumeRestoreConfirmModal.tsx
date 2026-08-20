import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { ForkAgentCheckboxState } from "@/lib/sessionFork";

export function ResumeRestoreConfirmModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  agentCheckbox: ForkAgentCheckboxState;
  onForkCliSessionChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = createT(props.locale);
  const close = () => {
    if (props.busy) return;
    props.onClose();
  };
  const box = props.agentCheckbox;
  return (
    <GlassModal
      open={props.open}
      onClose={close}
      title={tr("session.resumeRestoreTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      className="fork-confirm-modal"
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={props.busy || !props.open}
            onClick={props.onConfirm}
          >
            {props.busy
              ? tr("session.resumeRestoreWorking")
              : tr("session.resumeRestore")}
          </button>
        </>
      }
    >
      <div className="fork-confirm">
        <p className="fork-confirm__msg">
          {tr("session.resumeRestoreConfirm")}
        </p>
        <p className="fork-confirm__hint">{tr("session.resumeRestoreHint")}</p>
        <label
          className={
            "fork-confirm__restore" +
            (box.disabled ? " fork-confirm__restore--disabled" : "")
          }
        >
          <input
            type="checkbox"
            checked={box.checked}
            disabled={props.busy || box.disabled}
            onChange={(e) => {
              if (box.disabled) return;
              props.onForkCliSessionChange(e.target.checked);
            }}
            aria-disabled={box.disabled || undefined}
          />
          <span>{tr("session.forkCliSession")}</span>
        </label>
        <p className="fork-confirm__hint">{tr(box.hintKey as MessageKey)}</p>
      </div>
    </GlassModal>
  );
}
