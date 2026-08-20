import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  clampSessionTextInput,
  validateSessionTextField,
} from "@/lib/rulesPromptPro";
import { SESSION_SYSTEM_PROMPT_MAX_CHARS } from "@/lib/sessionSystemPrompt";
import { promptStatusClass } from "@/components/workbench-modals/promptStatusClass";

export function SessionSysPromptModal(props: {
  locale: Locale;
  open: boolean;
  sessionTitle: string | null;
  draft: string;
  baseline: string;
  hadStored: boolean;
  showClear: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  onClear: () => void;
  onDraftChange: (value: string) => void;
}) {
  const tr = createT(props.locale);
  const v = validateSessionTextField({
    field: "system_prompt",
    draft: props.draft,
    baseline: props.baseline,
    hadStored: props.hadStored,
  });
  const cls = promptStatusClass(v.severity);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.sysPromptTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="session-sys-prompt-modal"
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      footer={
        <div className="session-sys-prompt-modal__actions">
          {props.showClear ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={props.busy}
              onClick={props.onClear}
            >
              {tr("session.sysPromptClear")}
            </button>
          ) : null}
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
            className="btn btn--primary"
            disabled={props.busy}
            onClick={props.onSave}
          >
            {props.busy ? tr("resources.saving") : tr("common.save")}
          </button>
        </div>
      }
    >
      <p className="session-sys-prompt-modal__hint">
        {tr("session.sysPromptHint", {
          n: String(SESSION_SYSTEM_PROMPT_MAX_CHARS),
        })}
      </p>
      {props.sessionTitle ? (
        <p
          className="session-sys-prompt-modal__session"
          title={props.sessionTitle}
        >
          {props.sessionTitle}
        </p>
      ) : null}
      {v.statusKey ? (
        <p className={cls.status} role="status">
          {tr(v.statusKey)}
        </p>
      ) : null}
      {props.error ? (
        <p className="session-prompt-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <textarea
        className={"session-sys-prompt-modal__textarea" + cls.textarea}
        value={props.draft}
        onChange={(e) => {
          const next = clampSessionTextInput(
            e.target.value,
            SESSION_SYSTEM_PROMPT_MAX_CHARS,
          );
          props.onDraftChange(next.value);
        }}
        placeholder={tr("session.sysPromptPlaceholder")}
        maxLength={SESSION_SYSTEM_PROMPT_MAX_CHARS}
        spellCheck={false}
        disabled={props.busy}
        aria-label={tr("session.sysPromptTitle")}
      />
      <p
        className={"session-sys-prompt-modal__count" + cls.count}
        aria-live="polite"
      >
        {tr("session.sysPromptChars", {
          n: String(v.budget.rawLen),
          max: String(v.budget.max),
        })}
      </p>
    </GlassModal>
  );
}
