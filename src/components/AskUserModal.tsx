/**
 * Agent questionnaire for `_x.ai/ask_user_question`.
 * GlassModal shell — no window.confirm / prompt / alert.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import type { AskUserPayload, AskUserQuestionItem } from "@/lib/session";
import { askUserTimeoutRemainingSec } from "@/lib/askUserTimeout";
import { dropGateClock, gateClockKey, resumeGateClock } from "@/lib/gateClock";

/**
 * Auto-cancel clocks by request, shared across mounts of this singleton modal.
 *
 * The modal closes whenever the user leaves the chat (switching chats and "new
 * chat" both clear the pending questionnaire), so starting the clock at mount
 * gave the request a fresh full timeout on every return — it could never
 * auto-cancel. Entries are dropped once the request is answered or dismissed.
 */
const askUserClocks = new Map<string, number>();

export type AskUserLabels = {
  title: string;
  submit: string;
  cancel: string;
  otherPlaceholder: string;
  freeTextHint: string;
  multiHint: string;
  close: string;
  /** e.g. "Auto-dismiss in {seconds}s" — `{seconds}` replaced. */
  autoCancelCountdown?: string;
};

type Props = {
  payload: AskUserPayload | null;
  labels: AskUserLabels;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  /**
   * App-enforced auto-cancel after N seconds (0 / missing = off).
   * Same cancel path as Dismiss; independent of CLI toolset timeout.
   */
  timeoutSec?: number;
};

function questionKey(q: AskUserQuestionItem, index: number): string {
  return q.question?.trim() || q.id || String(index);
}

function formatCountdown(template: string, seconds: number): string {
  return template.replace(/\{seconds\}/g, String(seconds));
}

export function AskUserModal({
  payload,
  labels,
  onSubmit,
  onCancel,
  timeoutSec = 0,
}: Props) {
  const questions = payload?.questions ?? [];
  const open = Boolean(payload && questions.length > 0);

  // Per-question selected option ids (multi = set of ids).
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  // Per-question free-text override / free-text-only answer.
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const timedOutRef = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Stable cancel handle so parent re-renders do not reset the countdown.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Reset when a new questionnaire arrives.
  useEffect(() => {
    if (!payload) {
      setSelected({});
      setFreeText({});
      setBusy(false);
      setCountdownSec(null);
      timedOutRef.current = false;
      return;
    }
    setSelected({});
    setFreeText({});
    setBusy(false);
    timedOutRef.current = false;
  }, [payload?.rpcId]);

  // Optional auto-cancel after N seconds (Settings → Permissions; 0 = off).
  useEffect(() => {
    if (!open || !payload || !(timeoutSec > 0)) {
      setCountdownSec(null);
      return;
    }
    // Resume this request's clock — the modal remounts on every return to the
    // chat, and a fresh `Date.now()` here reset the countdown each time.
    const clockKey = gateClockKey(payload.sessionId, payload.rpcId);
    const startedAt = resumeGateClock(askUserClocks, clockKey);
    timedOutRef.current = false;
    setCountdownSec(askUserTimeoutRemainingSec(startedAt, timeoutSec));
    const tick = window.setInterval(() => {
      setCountdownSec(
        askUserTimeoutRemainingSec(startedAt, timeoutSec, Date.now()),
      );
    }, 250);
    const t = window.setTimeout(
      () => {
        if (timedOutRef.current || busyRef.current) return;
        timedOutRef.current = true;
        dropGateClock(askUserClocks, clockKey);
        void onCancelRef.current();
      },
      Math.max(0, timeoutSec * 1000 - (Date.now() - startedAt)),
    );
    return () => {
      window.clearTimeout(t);
      window.clearInterval(tick);
      setCountdownSec(null);
    };
  }, [open, payload?.sessionId, payload?.rpcId, timeoutSec]);

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

  /** The request is settled — its clock must not outlive it. */
  const dropClock = () => {
    if (!payload) return;
    dropGateClock(
      askUserClocks,
      gateClockKey(payload.sessionId, payload.rpcId),
    );
  };

  const submit = async (answers: Record<string, string>) => {
    if (busy) return;
    setBusy(true);
    dropClock();
    try {
      await onSubmit(answers);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    dropClock();
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

  const countdownLabel =
    countdownSec != null &&
    countdownSec > 0 &&
    labels.autoCancelCountdown
      ? formatCountdown(labels.autoCancelCountdown, countdownSec)
      : null;

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
          {countdownLabel ? (
            <span className="ask-user__countdown" aria-live="polite">
              {countdownLabel}
            </span>
          ) : null}
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
