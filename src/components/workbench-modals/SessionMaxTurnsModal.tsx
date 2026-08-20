import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { MAX_AGENT_TURNS_CAP } from "@/lib/sessionMaxAgentTurns";

export function SessionMaxTurnsModal(props: {
  locale: Locale;
  open: boolean;
  sessionTitle: string | null;
  draft: string;
  globalTurns: number;
  showClear: boolean;
  onClose: () => void;
  onSave: () => void;
  onClear: () => void;
  onDraftChange: (value: string) => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.maxTurnsTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      wrapBody
      className="session-max-turns-modal"
      footer={
        <div className="session-max-turns-modal__actions">
          {props.showClear ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onClear}
            >
              {tr("session.maxTurnsClear")}
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
      <p className="session-max-turns-modal__hint">
        {tr("session.maxTurnsHint", {
          max: String(MAX_AGENT_TURNS_CAP),
          global:
            props.globalTurns > 0
              ? String(props.globalTurns)
              : tr("session.maxTurnsGlobalUnlimited"),
        })}
      </p>
      {props.sessionTitle ? (
        <p
          className="session-max-turns-modal__session"
          title={props.sessionTitle}
        >
          {props.sessionTitle}
        </p>
      ) : null}
      <input
        className="session-max-turns-modal__input"
        type="number"
        min={0}
        max={MAX_AGENT_TURNS_CAP}
        step={1}
        value={props.draft}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw.trim()) {
            props.onDraftChange("");
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          const clamped = Math.min(
            MAX_AGENT_TURNS_CAP,
            Math.max(0, Math.round(n)),
          );
          props.onDraftChange(String(clamped));
        }}
        placeholder={tr("session.maxTurnsPlaceholder")}
        aria-label={tr("session.maxTurnsTitle")}
      />
    </GlassModal>
  );
}
