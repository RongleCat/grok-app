/**
 * Owns transcript quote-toolbar state so ConversationThread does not
 * re-render on every selectionchange while dragging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { setDraft } from "@/lib/composerDraftStore";
import {
  eventTargetElement,
  readTranscriptSelection,
  reduceSelectionBar,
  selectionBarFromRead,
  shouldCommitPointerUp,
  shouldCommitSelectionChange,
  type TranscriptSelectionBar,
} from "@/lib/transcriptSelectionBar";
import { TranscriptSelectionToolbar } from "@/components/TranscriptSelectionToolbar";
import type { ComposerSendKeyPref } from "@/lib/composerSendKey";

export type TranscriptSelectionToolbarHostProps = {
  scrollRef: { current: HTMLElement | null };
  sessionId?: string | null;
  onAddQuote?: (quote: {
    text: string;
    comment: string;
    sourceMessageId?: string;
  }) => void;
  onCopyText: (text: string) => void;
  /** Same Enter / ⌘Ctrl+Enter preference as the composer. */
  sendPref: ComposerSendKeyPref;
  labels: {
    copy: string;
    addQuote: string;
    commentPlaceholder: string;
    commentSubmit: string;
    enterHint: string;
    modEnterHint: string;
  };
};

export function TranscriptSelectionToolbarHost({
  scrollRef,
  sessionId,
  onAddQuote,
  onCopyText,
  sendPref,
  labels,
}: TranscriptSelectionToolbarHostProps) {
  const [bar, setBar] = useState<TranscriptSelectionBar | null>(null);
  const [comment, setComment] = useState("");
  const barText = bar?.text;
  const primaryDownRef = useRef(false);
  const startedInTranscriptRef = useRef(false);

  useEffect(() => {
    setComment("");
  }, [barText]);

  useEffect(() => {
    setBar(null);
    setComment("");
  }, [sessionId]);

  const close = useCallback(() => {
    setBar(null);
    setComment("");
  }, []);

  useEffect(() => {
    let raf = 0;
    const commit = () => {
      const raw = readTranscriptSelection(
        window.getSelection(),
        scrollRef.current,
      );
      setBar((prev) =>
        reduceSelectionBar(prev, raw ? selectionBarFromRead(raw) : null),
      );
    };
    const queue = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        commit();
      });
    };
    const onSel = () => {
      if (
        !shouldCommitSelectionChange({
          primaryPointerDown: primaryDownRef.current,
        })
      ) {
        return;
      }
      queue();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = eventTargetElement(e.target);
      if (el?.closest(".sel-toolbar")) return;
      primaryDownRef.current = true;
      const root = scrollRef.current;
      const node = e.target instanceof Node ? e.target : null;
      startedInTranscriptRef.current = !!(root && node && root.contains(node));
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const started = startedInTranscriptRef.current;
      primaryDownRef.current = false;
      startedInTranscriptRef.current = false;
      if (shouldCommitPointerUp({ startedInTranscript: started })) queue();
    };
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  useEffect(() => {
    if (!bar) return;
    const onDoc = (e: MouseEvent) => {
      const el = eventTargetElement(e.target);
      if (el?.closest(".sel-toolbar")) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [bar, close]);

  if (!bar) return null;

  const excerpt = bar.text;
  const sourceMessageId = bar.sourceMessageId;

  return (
    <TranscriptSelectionToolbar
      x={bar.x}
      y={bar.y}
      text={excerpt}
      comment={comment}
      onCommentChange={setComment}
      onCopy={() => {
        onCopyText(excerpt);
        close();
      }}
      onAddQuote={() => {
        const trimmed = excerpt.trim();
        if (!trimmed) return;
        if (onAddQuote) {
          onAddQuote({
            text: trimmed,
            comment: comment.trim(),
            sourceMessageId,
          });
        } else {
          setDraft((prev) => {
            if (!prev) return trimmed;
            return /\s$/.test(prev) ? prev + trimmed : prev + "\n\n" + trimmed;
          });
        }
        close();
        window.getSelection()?.removeAllRanges();
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(".composer__input");
          if (!el || el.getAttribute("contenteditable") === "false") return;
          el.focus({ preventScroll: false });
        });
      }}
      onClose={close}
      sendPref={sendPref}
      labels={labels}
    />
  );
}
