import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { RewindConfirmState } from "@/hooks/useAppDialogs";

export function RewindConfirmModal(props: {
  locale: Locale;
  confirm: RewindConfirmState | null;
  busy: boolean;
  error?: string | null;
  restoreFiles: boolean;
  onRestoreFilesChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = createT(props.locale);
  const close = () => {
    if (props.busy) return;
    props.onClose();
  };
  return (
    <GlassModal
      open={!!props.confirm}
      onClose={close}
      title={tr("session.rewindTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      className="rewind-confirm-modal"
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
            className="btn btn--danger"
            disabled={props.busy || !props.confirm}
            onClick={props.onConfirm}
          >
            {tr("session.rewindConfirmLabel")}
          </button>
        </>
      }
    >
      <div className="rewind-confirm">
        <p className="rewind-confirm__msg">
          {tr("session.rewindConfirm")}
          {props.confirm?.preview ? `\n\n“${props.confirm.preview}”` : ""}
        </p>
        <label className="rewind-confirm__restore">
          <input
            type="checkbox"
            checked={props.restoreFiles}
            disabled={props.busy}
            onChange={(e) => props.onRestoreFilesChange(e.target.checked)}
          />
          <span>{tr("session.rewindRestoreFiles")}</span>
        </label>
        <p className="rewind-confirm__hint">
          {tr("session.rewindRestoreFilesHint")}
        </p>
        {props.error ? (
          <p className="rewind-confirm__error" role="alert">
            {props.error}
          </p>
        ) : null}
      </div>
    </GlassModal>
  );
}
