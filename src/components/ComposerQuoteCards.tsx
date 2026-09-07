/**
 * Composer: compact "N notes" chip (edit in a pop).
 * Sent bubble: excerpt + comment inline — never hide the comment behind a count.
 */

import { useEffect, useId, useRef, useState } from "react";
import { IconBlockquote, IconClose } from "@/components/icons";
import { HighlightedText } from "@/components/HighlightedText";
import type { ComposerQuote } from "@/lib/composerQuotes";

export function ComposerQuoteCards({
  quotes,
  onCommentChange,
  onRemove,
  labels,
}: {
  quotes: ComposerQuote[];
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  labels: {
    list: string;
    count: string;
    remove: string;
    commentPlaceholder: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!quotes.length) return null;
  return (
    <div className="composer__quotes" ref={rootRef} aria-label={labels.list}>
      <button
        type="button"
        className="composer-quote-chip"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        title={labels.count}
      >
        <IconBlockquote size={14} />
        <span>{labels.count}</span>
      </button>
      {open ? (
        <div className="composer-quote-pop" id={panelId} role="dialog">
          {quotes.map((q, i) => (
            <article key={q.id} className="composer-quote-pop__item">
              <header className="composer-quote-pop__head">
                <span className="composer-quote-pop__idx">{i + 1}</span>
                <button
                  type="button"
                  className="composer-quote__x"
                  aria-label={labels.remove}
                  onClick={() => onRemove(q.id)}
                >
                  <IconClose size={12} />
                </button>
              </header>
              <blockquote className="composer-quote__text">{q.text}</blockquote>
              <textarea
                className="composer-quote__note"
                rows={2}
                value={q.comment}
                placeholder={labels.commentPlaceholder}
                onChange={(e) => onCommentChange(q.id, e.target.value)}
              />
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function UserQuoteCards({
  quotes,
  listLabel,
  findQuery,
}: {
  quotes: ComposerQuote[];
  listLabel: string;
  findQuery?: string;
}) {
  if (!quotes.length) return null;
  return (
    <div className="user-quote-list" aria-label={listLabel}>
      {quotes.map((q) => {
        const note = q.comment.trim();
        return (
          <article key={q.id} className="user-quote">
            <blockquote className="user-quote__text">
              {quoteText(q.text, findQuery)}
            </blockquote>
            {note ? (
              <p className="user-quote__note">{quoteText(note, findQuery)}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function quoteText(text: string, findQuery?: string) {
  if (findQuery?.trim()) {
    return (
      <HighlightedText text={text} query={findQuery} activeOccurrence={null} />
    );
  }
  return text;
}
