/**
 * Questionnaire body shared by the composer gate and the demo modal.
 */
import { useState } from "react";
import {
  askUserQuestionKey,
  askUserShowFreeHint,
  askUserVisibleDescription,
} from "@/lib/askUser/askUserForm";
import { nextAskUserOptionIndex } from "@/lib/askUser/askUserKeyboard";
import { resolveAskUserOptionsLayout } from "@/lib/askUser/askUserOptionsLayout";
import type { AskUserQuestionItem } from "@/lib/session";

export type AskUserFormLabels = {
  otherPlaceholder: string;
  freeTextHint: string;
  multiHint: string;
};

type Props = {
  questions: AskUserQuestionItem[];
  selected: Record<string, string[]>;
  freeText: Record<string, string>;
  busy: boolean;
  labels: AskUserFormLabels;
  onToggleOption: (
    q: AskUserQuestionItem,
    index: number,
    optionId: string,
  ) => void;
  onFreeText: (key: string, value: string, clearSingleSelect: boolean) => void;
  onQuickPick?: (key: string, label: string) => void;
  /** Modal-only: single-select option click submits immediately. */
  immediateSingleSelect?: boolean;
  /** When the question is already the card title, skip repeating it. */
  hidePrompts?: boolean;
};

export function AskUserForm({
  questions,
  selected,
  freeText,
  busy,
  labels,
  onToggleOption,
  onFreeText,
  onQuickPick,
  immediateSingleSelect = false,
  hidePrompts = false,
}: Props) {
  const quickPick =
    immediateSingleSelect &&
    questions.length === 1 &&
    !questions[0]?.multiSelect &&
    (questions[0]?.options?.length ?? 0) > 0;

  return (
    <div className="ask-user">
      {questions.map((q, qi) => {
        const key = askUserQuestionKey(q, qi);
        const sel = selected[key] || [];
        const text = freeText[key] || "";
        const layout = resolveAskUserOptionsLayout(q.options ?? []);
        return (
          <AskUserQuestion
            key={q.id || key}
            q={q}
            qi={qi}
            qKey={key}
            sel={sel}
            text={text}
            layout={layout}
            busy={busy}
            labels={labels}
            hidePrompt={hidePrompts}
            quickPick={quickPick}
            onToggleOption={onToggleOption}
            onFreeText={onFreeText}
            onQuickPick={onQuickPick}
          />
        );
      })}
    </div>
  );
}

function AskUserQuestion({
  q,
  qi,
  qKey,
  sel,
  text,
  layout,
  busy,
  labels,
  hidePrompt,
  quickPick,
  onToggleOption,
  onFreeText,
  onQuickPick,
}: {
  q: AskUserQuestionItem;
  qi: number;
  qKey: string;
  sel: string[];
  text: string;
  layout: "row" | "stack";
  busy: boolean;
  labels: AskUserFormLabels;
  hidePrompt: boolean;
  quickPick: boolean;
  onToggleOption: Props["onToggleOption"];
  onFreeText: Props["onFreeText"];
  onQuickPick?: Props["onQuickPick"];
}) {
  const hasOptions = (q.options?.length ?? 0) > 0;
  const [customOpen, setCustomOpen] = useState(() => !hasOptions || Boolean(text.trim()));
  const showCustom = !hasOptions || customOpen || Boolean(text.trim());
  const freeHint = hasOptions ? labels.freeTextHint : labels.otherPlaceholder;
  const showFreeHint = askUserShowFreeHint(freeHint, labels.otherPlaceholder);
  const labelledBy = hidePrompt ? "ask-user-bar-title" : `ask-user-q-${qi}`;

  return (
    <div
      className="ask-user__q"
      role="group"
      aria-labelledby={labelledBy}
    >
      {hidePrompt ? null : (
        <div className="ask-user__prompt" id={`ask-user-q-${qi}`}>
          {q.question}
        </div>
      )}
      {q.multiSelect ? (
        <div className="ask-user__hint">{labels.multiHint}</div>
      ) : null}
      {hasOptions ? (
        <div
          className={
            "ask-user__options" +
            (layout === "row" ? " ask-user__options--row" : "")
          }
          role={q.multiSelect ? "group" : "radiogroup"}
          aria-labelledby={labelledBy}
          onKeyDown={(e) => {
            const buttons = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                ".ask-user__opt",
              ),
            );
            const i = buttons.indexOf(e.target as HTMLButtonElement);
            if (i < 0) return;
            const next = nextAskUserOptionIndex(i, e.key, buttons.length);
            if (next == null) return;
            e.preventDefault();
            buttons[next]?.focus();
          }}
        >
          {q.options.map((opt) => {
            const active = sel.includes(opt.id);
            const desc = askUserVisibleDescription(opt.label, opt.description);
            return (
              <button
                key={opt.id}
                type="button"
                className={
                  "ask-user__opt" + (active ? " ask-user__opt--active" : "")
                }
                disabled={busy}
                role={q.multiSelect ? "checkbox" : "radio"}
                aria-checked={active}
                onClick={() => {
                  if (quickPick && onQuickPick) {
                    onQuickPick(qKey, opt.label);
                    return;
                  }
                  onToggleOption(q, qi, opt.id);
                }}
              >
                <span className="ask-user__opt-label">{opt.label}</span>
                {desc ? <span className="ask-user__opt-desc">{desc}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {hasOptions && !showCustom ? (
        <button
          type="button"
          className="ask-user__custom-toggle"
          disabled={busy}
          onClick={() => setCustomOpen(true)}
        >
          {labels.freeTextHint}
        </button>
      ) : (
        <label className="ask-user__free">
          {showFreeHint ? (
            <span className="ask-user__free-hint">{freeHint}</span>
          ) : null}
          <textarea
            className="ask-user__textarea"
            rows={1}
            value={text}
            disabled={busy}
            placeholder={labels.otherPlaceholder}
            aria-label={
              hasOptions ? labels.freeTextHint : labels.otherPlaceholder
            }
            onChange={(e) => {
              const v = e.target.value;
              onFreeText(qKey, v, Boolean(v.trim() && !q.multiSelect));
            }}
          />
        </label>
      )}
    </div>
  );
}
