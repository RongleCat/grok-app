/**
 * Agent questionnaire for `_x.ai/ask_user_question`.
 * GlassModal shell — no window.confirm / prompt / alert.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import type { AskUserPayload, AskUserQuestionItem } from "@/lib/session";

export type AskUserLabels = {
  title: string;
  submit: string;
  cancel: string;
  otherPlaceholder: string;
  freeTextHint: string;
  multiHint: string;
  close: string;
};

type Props = {
  payload: AskUserPayload | null;
  labels: AskUserLabels;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

function questionKey(q: AskUserQuestionItem, index: number): string {
  return q.question?.trim() || q.id || String(index);
}

export function AskUserModal({ payload, labels, onSubmit, onCancel }: Props) {
  const questions = payload?.questions ?? [];
  const open = Boolean(payload && questions.length > 0);

  // Per-question selected option ids (multi = set of ids).
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  // Per-question free-text override / free-text-only answer.
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Reset when a new questionnaire arrives.
  useEffect(() => {
    if (!payload) {
      setSelected({});
      setFreeText({});
      setBusy(false);
      return;
    }
    setSelected({});
    setFreeText({});
    setBusy(false);
  }, [payload?.rpcId]);

  const canSubmit = useMemo(() => {
    if (!questions.length) return false;
    return questions.every((q, i) => {
      const key = questionKey(q, i);
      const text = (freeText[key] || "").trim();
      if (text) return true;
      const sel = selected[key] || [];
      return sel.length > 0;
    });
  }, [questions, selected, freeText]);

  const toggleOption = (q: AskUserQuestionItem, index: number, optionId: string) => {
    const key = questionKey(q, index);
    setSelected((prev) => {
      const cur = prev[key] || [];
      if (q.multiSelect) {
        const has = cur.includes(optionId);
        return {
          ...prev,
          [key]: has ? cur.filter((id) => id !== optionId) : [...cur, optionId],
        };
      }
      return { ...prev, [key]: [optionId] };
    });
    // Choosing an option clears free-text for that question.
    setFreeText((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const buildAnswers = (): Record<string, string> => {
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      const key = questionKey(q, i);
      const text = (freeText[key] || "").trim();
      if (text) {
        answers[key] = text;
        return;
      }
      const sel = selected[key] || [];
      if (!sel.length) return;
      const labelsFor = sel.map((id) => {
        const opt = q.options.find((o) => o.id === id);
        return opt?.label || id;
      });
      answers[key] = labelsFor.join(", ");
    });
    return answers;
  };

  const submit = async (answers: Record<string, string>) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(answers);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onCancel();
    } finally {
      setBusy(false);
    }
  };

  // Single-select, single question, option click → immediate answer.
  const quickPick =
    questions.length === 1 &&
    !questions[0]?.multiSelect &&
    (questions[0]?.options?.length ?? 0) > 0;

  return (
    <GlassModal
      open={open}
      onClose={() => void cancel()}
      title={labels.title}
      size="md"
      closeLabel={labels.close}
      closeOnOverlay={false}
      wrapBody
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || !canSubmit}
            onClick={() => void submit(buildAnswers())}
          >
            {labels.submit}
          </button>
        </>
      }
    >
      <div className="ask-user">
        {questions.map((q, qi) => {
          const key = questionKey(q, qi);
          const sel = selected[key] || [];
          const text = freeText[key] || "";
          return (
            <div
              key={q.id || key}
              className="ask-user__q"
              role="group"
              aria-labelledby={`ask-user-q-${qi}`}
            >
              <div className="ask-user__prompt" id={`ask-user-q-${qi}`}>
                {q.question}
              </div>
              {q.multiSelect ? (
                <div className="ask-user__hint" id={`ask-user-hint-${qi}`}>
                  {labels.multiHint}
                </div>
              ) : null}
              {q.options?.length ? (
                <div
                  className="ask-user__options"
                  role="group"
                  aria-labelledby={`ask-user-q-${qi}`}
                >
                  {q.options.map((opt) => {
                    const active = sel.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={
                          "ask-user__opt" + (active ? " ask-user__opt--active" : "")
                        }
                        disabled={busy}
                        aria-pressed={active}
                        onClick={() => {
                          if (quickPick) {
                            void submit({ [key]: opt.label });
                            return;
                          }
                          toggleOption(q, qi, opt.id);
                        }}
                      >
                        <span className="ask-user__opt-label">{opt.label}</span>
                        {opt.description ? (
                          <span className="ask-user__opt-desc">{opt.description}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <label className="ask-user__free">
                <span className="ask-user__free-hint">
                  {q.options?.length ? labels.freeTextHint : labels.otherPlaceholder}
                </span>
                <textarea
                  className="ask-user__textarea"
                  rows={2}
                  value={text}
                  disabled={busy}
                  placeholder={labels.otherPlaceholder}
                  aria-label={
                    q.options?.length
                      ? labels.freeTextHint
                      : labels.otherPlaceholder
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    setFreeText((prev) => ({ ...prev, [key]: v }));
                    if (v.trim() && !q.multiSelect) {
                      // Free text replaces single selection.
                      setSelected((prev) => ({ ...prev, [key]: [] }));
                    }
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
    </GlassModal>
  );
}
