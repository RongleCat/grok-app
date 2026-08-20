import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { ForkConfirmState } from "@/hooks/useAppDialogs";
import type { ForkAgentCheckboxState } from "@/lib/sessionFork";

export function ForkConfirmModal(props: {
  locale: Locale;
  confirm: ForkConfirmState | null;
  busy: boolean;
  restoreCode: boolean;
  agentCheckbox: ForkAgentCheckboxState;
  onRestoreCodeChange: (value: boolean) => void;
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
      open={!!props.confirm}
      onClose={close}
      title={tr("session.forkTitle")}
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
            disabled={props.busy || !props.confirm}
            onClick={props.onConfirm}
          >
            {props.busy ? tr("session.forkWorking") : tr("session.fork")}
          </button>
        </>
      }
    >
      <div className="fork-confirm">
        <p className="fork-confirm__msg">
          {props.confirm?.throughUserPromptIndex != null &&
          props.confirm.throughUserPromptIndex !== undefined
            ? tr("session.forkConfirmPartial")
            : tr("session.forkConfirm")}
        </p>
        <label className="fork-confirm__restore">
          <input
            type="checkbox"
            checked={props.restoreCode}
            disabled={props.busy}
            onChange={(e) => props.onRestoreCodeChange(e.target.checked)}
          />
          <span>{tr("session.forkRestoreCode")}</span>
        </label>
        <p className="fork-confirm__hint">{tr("session.forkRestoreCodeHint")}</p>
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
        <p className="fork-confirm__hint">
          {tr(box.hintKey as MessageKey)}
        </p>
      </div>
    </GlassModal>
  );
}
