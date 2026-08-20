import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  clampSessionTextInput,
  validateSessionTextField,
} from "@/lib/rulesPromptPro";
import { SESSION_EXTRA_RULES_MAX_CHARS } from "@/lib/sessionExtraRules";
import { promptStatusClass } from "@/components/workbench-modals/promptStatusClass";

export function SessionRulesModal(props: {
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
    field: "extra_rules",
    draft: props.draft,
    baseline: props.baseline,
    hadStored: props.hadStored,
  });
  const cls = promptStatusClass(v.severity);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.rulesTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="session-rules-modal"
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      footer={
        <div className="session-rules-modal__actions">
          {props.showClear ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={props.busy}
              onClick={props.onClear}
            >
              {tr("session.rulesClear")}
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
      <p className="session-rules-modal__hint">
        {tr("session.rulesHint", { n: String(SESSION_EXTRA_RULES_MAX_CHARS) })}
      </p>
      {props.sessionTitle ? (
        <p className="session-rules-modal__session" title={props.sessionTitle}>
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
        className={"session-rules-modal__textarea" + cls.textarea}
        value={props.draft}
        onChange={(e) => {
          const next = clampSessionTextInput(
            e.target.value,
            SESSION_EXTRA_RULES_MAX_CHARS,
          );
          props.onDraftChange(next.value);
        }}
        placeholder={tr("session.rulesPlaceholder")}
        maxLength={SESSION_EXTRA_RULES_MAX_CHARS}
        spellCheck={false}
        disabled={props.busy}
        aria-label={tr("session.rulesTitle")}
      />
      <p className={"session-rules-modal__count" + cls.count} aria-live="polite">
        {tr("session.rulesChars", {
          n: String(v.budget.rawLen),
          max: String(v.budget.max),
        })}
      </p>
    </GlassModal>
  );
}
