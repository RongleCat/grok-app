import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { createT, type Locale } from "@/i18n";
import { IconClose } from "@/components/icons";
import type { AppDialog } from "@/lib/app/appDialogTypes";

type ConfirmDialog = Extract<NonNullable<AppDialog>, { kind: "confirm" }>;

export function AppDialogHost(props: {
  locale: Locale;
  dialog: NonNullable<AppDialog>;
  dialogRef: RefObject<AppDialog>;
  panelRef: RefObject<HTMLDivElement | null>;
  confirmBtnRef: RefObject<HTMLButtonElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  error: string;
  onDismiss: () => void;
  onInputChange: (value: string) => void;
  onClearError: () => void;
  onConfirm: (dialog: ConfirmDialog) => void;
  onPromptSubmit: (value: string) => void;
}) {
  const tr = createT(props.locale);
  const dialog = props.dialog;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="overlay app-dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onDismiss();
      }}
    >
      <div
        ref={props.panelRef}
        className="modal app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="app-dialog-title" className="modal-title">
            {dialog.title}
          </h2>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={() => props.onDismiss()}
            aria-label={tr("common.close")}
          >
            <IconClose size={16} />
          </button>
        </header>
        {dialog.kind === "confirm" ? (
          <form
            className="app-dialog__form"
            onSubmit={(e) => {
              e.preventDefault();
              const latest = props.dialogRef.current;
              if (!latest || latest.kind !== "confirm") return;
              props.onConfirm(latest);
            }}
          >
            <p className="app-dialog__msg">{dialog.message}</p>
            <div className="app-dialog__actions modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => props.onDismiss()}
              >
                {tr("common.cancel")}
              </button>
              <button
                ref={props.confirmBtnRef}
                type="submit"
                className={`btn ${dialog.danger ? "btn--danger" : "btn--solid"}`}
              >
                {dialog.confirmLabel || tr("common.confirm")}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="app-dialog__form"
            onSubmit={(e) => {
              e.preventDefault();
              props.onPromptSubmit(props.inputValue);
            }}
          >
            {dialog.message ? (
              <p className="app-dialog__msg">{dialog.message}</p>
            ) : null}
            <input
              ref={props.inputRef}
              className="app-dialog__input"
              value={props.inputValue}
              placeholder={dialog.placeholder}
              onChange={(e) => {
                props.onInputChange(e.target.value);
                if (props.error) props.onClearError();
              }}
              autoComplete="off"
              aria-invalid={props.error ? true : undefined}
              aria-describedby={props.error ? "app-dialog-error" : undefined}
            />
            <div className="app-dialog__actions modal-actions">
              {props.error ? (
                <p
                  id="app-dialog-error"
                  className="app-dialog__error"
                  role="alert"
                >
                  {props.error}
                </p>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => props.onDismiss()}
              >
                {tr("common.cancel")}
              </button>
              <button type="submit" className="btn btn--solid">
                {dialog.submitLabel || tr("common.save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
