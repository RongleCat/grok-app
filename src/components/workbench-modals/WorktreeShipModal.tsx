import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import * as api from "@/lib/api";

export type WorktreeShipSuccess = {
  prUrl: string;
  prNumber: number | null;
};

export function WorktreeShipModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  success: WorktreeShipSuccess | null;
  title: string;
  body: string;
  createPr: boolean;
  draft: boolean;
  branch: string | null;
  status: string | null;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onCreatePrChange: (value: boolean) => void;
  onDraftChange: (value: boolean) => void;
  onOpenPrHub: (prNumber: number | null) => void;
  onToast: (message: string, ms: number) => void;
}) {
  const tr = createT(props.locale);
  const success = props.success;
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={
        success
          ? tr("composer.worktreeShipSuccessTitle")
          : tr("composer.worktreeShipTitle")
      }
      size="md"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      footer={
        success ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onClose}
              data-testid="ship-success-done"
            >
              {tr("composer.worktreeShipDone")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => props.onOpenPrHub(success.prNumber)}
              data-testid="ship-open-pr-hub"
            >
              {tr("composer.worktreeShipOpenInHub")}
            </button>
          </>
        ) : (
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
              className="btn btn--solid"
              disabled={props.busy || !props.title.trim()}
              onClick={() => {
                void props.onSubmit();
              }}
              data-testid="ship-submit"
            >
              {props.busy
                ? props.status || tr("composer.worktreeShipRunning")
                : props.createPr
                  ? tr("composer.worktreeShipConfirmPr")
                  : tr("composer.worktreeShipConfirmPush")}
            </button>
          </>
        )
      }
    >
      {success ? (
        <div className="wt-ship wt-ship--success" data-testid="ship-success">
          <p className="wt-ship__hint">
            {tr("composer.worktreeShipDonePr", { url: success.prUrl })}
          </p>
          <p className="wt-ship__success-url" title={success.prUrl}>
            {success.prUrl}
          </p>
          <div className="wt-ship__success-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                void api.openExternalUrl(success.prUrl).catch(() => {
                  props.onToast(
                    tr("composer.worktreeShipOpenBrowserFailed"),
                    3500,
                  );
                });
              }}
              data-testid="ship-open-browser"
            >
              {tr("composer.worktreeShipOpenInBrowser")}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => props.onOpenPrHub(success.prNumber)}
            >
              {tr("composer.worktreeShipOpenInHub")}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="wt-ship"
          onSubmit={(e) => {
            e.preventDefault();
            if (props.busy || !props.title.trim()) return;
            void props.onSubmit();
          }}
        >
          <p className="wt-ship__hint">{tr("composer.worktreeShipHint")}</p>
          {props.branch ? (
            <p className="wt-ship__branch">
              {tr("composer.worktreeShipBranch", { branch: props.branch })}
            </p>
          ) : null}
          <label className="wt-ship__field">
            <span className="wt-ship__label">
              {tr("composer.worktreeShipTitleField")}
            </span>
            <input
              className="settings-input"
              value={props.title}
              onChange={(e) => props.onTitleChange(e.target.value)}
              placeholder={tr("composer.worktreeShipTitlePlaceholder")}
              autoComplete="off"
              autoFocus
              disabled={props.busy}
              spellCheck={true}
              data-testid="ship-title"
            />
          </label>
          <label className="wt-ship__field">
            <span className="wt-ship__label">
              {tr("composer.worktreeShipBodyField")}
            </span>
            <textarea
              className="settings-input wt-ship__body"
              value={props.body}
              onChange={(e) => props.onBodyChange(e.target.value)}
              placeholder={tr("composer.worktreeShipBodyPlaceholder")}
              rows={5}
              disabled={props.busy}
              spellCheck={true}
              data-testid="ship-body"
            />
          </label>
          <label className="wt-ship__check">
            <input
              type="checkbox"
              checked={props.createPr}
              disabled={props.busy}
              onChange={(e) => props.onCreatePrChange(e.target.checked)}
            />
            <span>{tr("composer.worktreeShipCreatePr")}</span>
          </label>
          <label className="wt-ship__check">
            <input
              type="checkbox"
              checked={props.draft}
              disabled={props.busy || !props.createPr}
              onChange={(e) => props.onDraftChange(e.target.checked)}
            />
            <span>{tr("composer.worktreeShipDraft")}</span>
          </label>
          {props.status ? (
            <p className="wt-ship__status" aria-live="polite">
              {props.status}
            </p>
          ) : null}
          {props.error ? (
            <p className="wt-ship__error" role="alert">
              {props.error}
            </p>
          ) : null}
        </form>
      )}
    </GlassModal>
  );
}
