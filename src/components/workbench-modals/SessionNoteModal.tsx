import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import {
  clampSessionNoteInput,
  SESSION_NOTE_MAX_LENGTH,
  validateSessionNote,
} from "@/lib/sessionNotes";
import { promptStatusClass } from "@/components/workbench-modals/promptStatusClass";

export function SessionNoteModal(props: {
  locale: Locale;
  open: boolean;
  sessionTitle: string | null;
  draft: string;
  baseline: string;
  hadStored: boolean;
  showClear: boolean;
  onClose: () => void;
  onSave: () => void;
  onClear: () => void;
  onDraftChange: (value: string) => void;
}) {
  const tr = createT(props.locale);
  const v = validateSessionNote({
    draft: props.draft,
    baseline: props.baseline,
    hadStored: props.hadStored,
  });
  const cls = promptStatusClass(v.severity);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.noteTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="session-note-modal"
      footer={
        <div className="session-note-modal__actions">
          {props.showClear ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onClear}
            >
              {tr("session.noteClear")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={props.onSave}
          >
            {tr("common.save")}
          </button>
        </div>
      }
    >
      <p className="session-note-modal__hint">
        {tr("session.noteHint", { n: String(SESSION_NOTE_MAX_LENGTH) })}
      </p>
      {props.sessionTitle ? (
        <p className="session-note-modal__session" title={props.sessionTitle}>
          {props.sessionTitle}
        </p>
      ) : null}
      {v.statusKey ? (
        <p className={cls.status} role="status">
          {tr(v.statusKey)}
        </p>
      ) : null}
      <textarea
        className={"session-note-modal__textarea" + cls.textarea}
        value={props.draft}
        onChange={(e) => {
          const next = clampSessionNoteInput(
            e.target.value,
            SESSION_NOTE_MAX_LENGTH,
          );
          props.onDraftChange(next.value);
        }}
        placeholder={tr("session.notePlaceholder")}
        maxLength={SESSION_NOTE_MAX_LENGTH}
        spellCheck
        aria-label={tr("session.noteTitle")}
      />
      <p className={"session-note-modal__count" + cls.count} aria-live="polite">
        {tr("session.noteChars", {
          n: String(v.budget.rawLen),
          max: String(v.budget.max),
        })}
      </p>
    </GlassModal>
  );
}
