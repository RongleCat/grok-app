import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { GitWorktreeGcResult } from "@/lib/api";

export function WorktreeGcModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  previewBusy: boolean;
  force: boolean;
  preview: GitWorktreeGcResult | null;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onForceChange: (value: boolean) => void;
}) {
  const tr = createT(props.locale);
  const close = () => {
    if (props.busy) return;
    props.onClose();
  };
  return (
    <GlassModal
      open={props.open}
      onClose={close}
      title={tr("composer.worktreeGcTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy}
            onClick={close}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={props.busy || props.previewBusy}
            onClick={() => {
              void props.onSubmit();
            }}
          >
            {props.busy
              ? tr("composer.worktreeGcRunning")
              : tr("composer.worktreeGcConfirm")}
          </button>
        </>
      }
    >
      <div className="wt-gc">
        <p className="wt-gc__hint">{tr("composer.worktreeGcHint")}</p>
        <label className="wt-gc__force">
          <input
            type="checkbox"
            checked={props.force}
            disabled={props.busy || props.previewBusy}
            onChange={(e) => props.onForceChange(e.target.checked)}
          />
          <span>{tr("composer.worktreeGcForce")}</span>
        </label>
        <div className="wt-gc__preview-head">
          {tr("composer.worktreeGcPreview")}
        </div>
        {props.previewBusy ? (
          <p className="wt-gc__preview-status">
            {tr("composer.worktreeGcPreviewLoading")}
          </p>
        ) : props.preview ? (
          <>
            {(props.preview.prunable?.length ?? 0) > 0 ? (
              <p className="wt-gc__prunable">
                {tr("composer.worktreeGcPrunable", {
                  n: String(props.preview.prunable?.length ?? 0),
                })}
              </p>
            ) : null}
            {(props.preview.output ?? "").trim() ||
            (props.preview.prunable?.length ?? 0) > 0 ? (
              <pre className="wt-gc__output" tabIndex={0}>
                {(props.preview.output ?? "").trim() ||
                  (Array.isArray(props.preview.prunable)
                    ? props.preview.prunable.join("\n")
                    : "")}
              </pre>
            ) : (
              <p className="wt-gc__preview-status">
                {tr("composer.worktreeGcPreviewEmpty")}
              </p>
            )}
          </>
        ) : props.error ? null : (
          <p className="wt-gc__preview-status">
            {tr("composer.worktreeGcPreviewEmpty")}
          </p>
        )}
        {props.error ? (
          <p className="wt-gc__error" role="alert">
            {props.error}
          </p>
        ) : null}
      </div>
    </GlassModal>
  );
}
