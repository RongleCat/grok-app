import type { Ref } from "react";
import { createT, type Locale } from "@/i18n";
import { IconClose } from "@/components/icons";
import type { RewindTimelineState } from "@/hooks/useAppDialogs";

export function RewindTimelineModal(props: {
  locale: Locale;
  timeline: RewindTimelineState | null;
  busy: boolean;
  panelRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onPick: (promptIndex: number, preview: string) => void;
}) {
  const tr = createT(props.locale);
  const timeline = props.timeline;
  if (!timeline) return null;
  return (
    <div
      className="overlay"
      role="presentation"
      onClick={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <div
        ref={props.panelRef}
        className="modal rewind-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="rewind-modal-title" className="modal-title">
            {tr("session.rewindTitle")}
          </h2>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={props.onClose}
            aria-label={tr("common.close")}
            disabled={props.busy}
          >
            <IconClose size={16} />
          </button>
        </header>
        <p className="rewind-modal__msg">{tr("session.rewindHint")}</p>
        <div className="rewind-modal__list" role="list">
          {timeline.points.map((p) => {
            const isLast =
              p.promptIndex ===
              timeline.points[timeline.points.length - 1]?.promptIndex;
            return (
              <button
                key={`${p.promptIndex}-${p.messageId ?? ""}`}
                type="button"
                role="listitem"
                className="rewind-modal__item"
                disabled={props.busy || isLast}
                title={
                  isLast ? tr("session.rewindNoop") : tr("message.rewindHere")
                }
                onClick={() => {
                  if (isLast) return;
                  props.onPick(p.promptIndex, p.preview);
                }}
              >
                <span className="rewind-modal__idx">#{p.promptIndex + 1}</span>
                <span className="rewind-modal__preview">
                  {p.preview || "…"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
