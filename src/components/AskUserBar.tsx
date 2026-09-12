/**
 * Composer-column gate for `_x.ai/ask_user_question`.
 * Non-modal: chat stays scrollable. Collapse ≠ dismiss (#891).
 */
import { useEffect, useRef, useState } from "react";
import { AskUserForm } from "@/components/AskUserForm";
import { IconChevronUp, IconMinimize } from "@/components/icons";
import { useAskUserQuestionnaire } from "@/hooks/useAskUserQuestionnaire";
import { askUserDismissLocked } from "@/lib/askUser/askUserSettle";
import { askUserBarHeading, askUserPendingPreview } from "@/lib/askUser/askUserForm";
import { shouldAskUserSubmitOnEnter } from "@/lib/askUser/askUserKeyboard";
import type { AskUserPayload } from "@/lib/session";

export type AskUserBarLabels = {
  title: string;
  submit: string;
  cancel: string;
  otherPlaceholder: string;
  freeTextHint: string;
  multiHint: string;
  minimize: string;
  restore: string;
  pendingChip: string;
  autoCancelCountdown?: string;
};

type Props = {
  payload: AskUserPayload | null;
  labels: AskUserBarLabels;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  timeoutSec?: number;
};

function formatCountdown(template: string, seconds: number): string {
  return template.replace(/\{seconds\}/g, String(seconds));
}

export function AskUserBar({
  payload,
  labels,
  onSubmit,
  onCancel,
  timeoutSec = 0,
}: Props) {
  const {
    questions,
    open,
    selected,
    writeFreeText,
    freeText,
    busy,
    countdownSec,
    canSubmit,
    toggleOption,
    submit,
    cancel,
  } = useAskUserQuestionnaire(payload, timeoutSec, onCancel);
  const [collapsed, setCollapsed] = useState(false);
  const canSubmitRef = useRef(canSubmit);
  canSubmitRef.current = canSubmit;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = () => {
    void submit(onSubmit);
  };

  useEffect(() => {
    setCollapsed(false);
  }, [payload?.rpcId]);

  useEffect(() => {
    if (!open || collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCollapsed(true);
        return;
      }
      if (
        shouldAskUserSubmitOnEnter(e) &&
        canSubmitRef.current &&
        !busyRef.current
      ) {
        e.preventDefault();
        e.stopPropagation();
        submitRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, collapsed]);

  if (!open || !payload) return null;

  const countdownLabel =
    countdownSec != null &&
    countdownSec > 0 &&
    labels.autoCancelCountdown
      ? formatCountdown(labels.autoCancelCountdown, countdownSec)
      : null;

  const heading = askUserBarHeading(questions, labels.title);
  const hidePrompts = questions.length === 1;

  if (collapsed) {
    const preview = askUserPendingPreview(questions);
    return (
      <button
        type="button"
        className="ask-user-bar ask-user-bar--collapsed"
        onClick={() => setCollapsed(false)}
        aria-label={labels.pendingChip}
        title={labels.restore}
      >
        <span className="ask-user-bar__preview">
          {preview || labels.pendingChip}
        </span>
        {countdownLabel ? (
          <span className="ask-user-bar__countdown" aria-live="polite">
            {countdownLabel}
          </span>
        ) : null}
        <IconChevronUp size={14} aria-hidden />
      </button>
    );
  }

  return (
    <div
      className="ask-user-bar"
      role="region"
      aria-labelledby="ask-user-bar-title"
    >
      <div className="sr-only" aria-live="assertive">
        {heading}
      </div>
      <div className="ask-user-bar__head">
        <h2 className="ask-user-bar__title" id="ask-user-bar-title">
          {heading}
        </h2>
        {countdownLabel ? (
          <span className="ask-user-bar__countdown" aria-live="polite">
            {countdownLabel}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-btn ask-user-bar__minimize"
          onClick={() => setCollapsed(true)}
          aria-label={labels.minimize}
        >
          <IconMinimize size={16} />
        </button>
      </div>
      <div className="ask-user-bar__main">
        <div className="ask-user-bar__body">
          <AskUserForm
            questions={questions}
            selected={selected}
            freeText={freeText}
            busy={busy}
            labels={labels}
            hidePrompts={hidePrompts}
            onToggleOption={toggleOption}
            onFreeText={writeFreeText}
            onQuickPick={(key, label) => {
              void submit(onSubmit, { [key]: label });
            }}
          />
        </div>
        <div className="ask-user-bar__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={askUserDismissLocked(busy)}
            onClick={() => void cancel()}
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || !canSubmit}
            onClick={() => void submit(onSubmit)}
          >
            {labels.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
