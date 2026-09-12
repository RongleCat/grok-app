/**
 * Demo / settings preview for `_x.ai/ask_user_question`.
 * Live chat uses AskUserBar (composer gate) — this stays a GlassModal.
 */
import { GlassModal } from "@/components/GlassModal";
import { AskUserForm } from "@/components/AskUserForm";
import { useAskUserQuestionnaire } from "@/hooks/useAskUserQuestionnaire";
import { dropAskUserClocks } from "@/lib/askUser/askUserClocks";
import { askUserDismissLocked } from "@/lib/askUser/askUserSettle";
import type { AskUserPayload } from "@/lib/session";

export { dropAskUserClocks };

export type AskUserLabels = {
  title: string;
  submit: string;
  cancel: string;
  otherPlaceholder: string;
  freeTextHint: string;
  multiHint: string;
  close: string;
  autoCancelCountdown?: string;
};

type Props = {
  payload: AskUserPayload | null;
  labels: AskUserLabels;
  onSubmit: (answers: Record<string, string>) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  timeoutSec?: number;
};

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
        </>
      }
    >
      <AskUserForm
        questions={questions}
        selected={selected}
        freeText={freeText}
        busy={busy}
        labels={labels}
        onToggleOption={toggleOption}
        onFreeText={writeFreeText}
        immediateSingleSelect
        onQuickPick={(key, label) => {
          void submit(onSubmit, { [key]: label });
        }}
      />
    </GlassModal>
  );
}
