/**
 * Pure helpers for the ask-user questionnaire form (composer gate + demo modal).
 */
import type { AskUserQuestionItem } from "../session";

export function askUserQuestionKey(
  q: Pick<AskUserQuestionItem, "question" | "id">,
  index: number,
): string {
  return q.question?.trim() || q.id || String(index);
}

export function askUserCanSubmit(
  questions: AskUserQuestionItem[],
  selected: Record<string, string[]>,
  freeText: Record<string, string>,
): boolean {
  if (!questions.length) return false;
  return questions.every((q, i) => {
    const key = askUserQuestionKey(q, i);
    if ((freeText[key] || "").trim()) return true;
    return (selected[key] || []).length > 0;
  });
}

export function askUserBuildAnswers(
  questions: AskUserQuestionItem[],
  selected: Record<string, string[]>,
  freeText: Record<string, string>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((q, i) => {
    const key = askUserQuestionKey(q, i);
    const text = (freeText[key] || "").trim();
    if (text) {
      answers[key] = text;
      return;
    }
    const sel = selected[key] || [];
    if (!sel.length) return;
    answers[key] = sel
      .map((id) => q.options.find((o) => o.id === id)?.label || id)
      .join(", ");
  });
  return answers;
}

/** Drop empty descriptions and CLI echoes that just repeat the label. */
export function askUserVisibleDescription(
  label: string,
  description?: string | null,
): string | null {
  const desc = (description ?? "").trim();
  if (!desc) return null;
  if (desc.toLowerCase() === label.trim().toLowerCase()) return null;
  return desc;
}

/** Hide a free-text hint that is the same string as the field placeholder. */
export function askUserShowFreeHint(hint: string, placeholder: string): boolean {
  return hint.trim() !== placeholder.trim();
}

/** Single-question cards use the question as the title instead of a badge. */
export function askUserBarHeading(
  questions: Array<Pick<AskUserQuestionItem, "question">>,
  fallbackTitle: string,
): string {
  if (questions.length === 1) {
    const q = questions[0]?.question?.trim() ?? "";
    if (q) return q;
  }
  return fallbackTitle;
}

const PENDING_PREVIEW_MAX = 42;

/** First question, clipped for the collapsed composer chip. */
export function askUserPendingPreview(
  questions: Array<Pick<AskUserQuestionItem, "question">>,
  maxChars: number = PENDING_PREVIEW_MAX,
): string {
  const first = questions[0]?.question?.trim() ?? "";
  if (!first) return "";
  if (first.length <= maxChars) return first;
  const clip = Math.max(1, maxChars - 1);
  return `${first.slice(0, clip).trimEnd()}…`;
}
