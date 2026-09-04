/**
 * Floating toolbar after selecting transcript text.
 * Comment is always available on the selection; Add-to-chat stores the excerpt
 * as its own note (no extra comment box in the composer).
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconBlockquote, IconCopy } from "@/components/icons";
import { shouldSendOnKeydown } from "@/lib/composerSendKey";

export type TranscriptSelectionToolbarProps = {
  x: number;
  y: number;
  text: string;
  comment: string;
  onCommentChange: (value: string) => void;
  onCopy: () => void;
  onAddQuote: () => void;
  onClose: () => void;
  labels: {
    copy: string;
    addQuote: string;
    commentPlaceholder: string;
    commentSubmit: string;
    enterHint: string;
  };
};

export function TranscriptSelectionToolbar({
  x,
  y,
  text,
  comment,
  onCommentChange,
  onCopy,
  onAddQuote,
  onClose,
  labels,
}: TranscriptSelectionToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const left = Math.max(8, Math.min(x, window.innerWidth - 320));
  const top = Math.max(8, y);

  return createPortal(
    <div
      ref={rootRef}
      className="sel-toolbar sel-toolbar--comment"
      style={{ left, top }}
      role="toolbar"
      aria-label={labels.addQuote}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement | null;
        if (t?.closest("textarea, input")) return;
        e.preventDefault();
      }}
    >
      <div className="sel-toolbar__preview" title={text}>
        {text.length > 72 ? `${text.slice(0, 72)}…` : text}
      </div>
      <textarea
        className="sel-toolbar__textarea"
        rows={3}
        value={comment}
        placeholder={labels.commentPlaceholder}
        onChange={(e) => onCommentChange(e.target.value)}
        onKeyDown={(e) => {
          if (
            shouldSendOnKeydown(
              {
                key: e.key,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
              },
              "enter",
            )
          ) {
            e.preventDefault();
            onAddQuote();
          }
        }}
      />
      <div className="sel-toolbar__row">
        <div className="sel-toolbar__actions">
          <button type="button" className="sel-toolbar__btn" onClick={onCopy}>
            <IconCopy size={14} />
            {labels.copy}
          </button>
          <button
            type="button"
            className="sel-toolbar__btn sel-toolbar__btn--primary"
            onClick={onAddQuote}
          >
            <IconBlockquote size={14} />
            {labels.addQuote}
          </button>
        </div>
        <span className="sel-toolbar__enter-hint">{labels.enterHint}</span>
      </div>
    </div>,
    document.body,
  );
}
