/**
 * Utilities for folding/collapsing oversized user message bubbles.
 *
 * Prevents browser layout locks and UI clutter when user pastes
 * large code snippets, error traces, logs, or multi-paragraph text.
 */

export const USER_MSG_FOLD_MAX_CHARS = 700;
export const USER_MSG_FOLD_MAX_LINES = 12;
export const USER_MSG_PREVIEW_CHARS = 350;
export const USER_MSG_PREVIEW_LINES = 6;

/** True if the user text exceeds length or line count threshold. */
export function shouldFoldUserMessage(text?: string | null): boolean {
  if (!text) return false;
  if (text.length >= USER_MSG_FOLD_MAX_CHARS) return true;
  const lineCount = (text.match(/\n/g) || []).length + 1;
  return lineCount >= USER_MSG_FOLD_MAX_LINES;
}

/** Returns the truncated preview text with an ellipsis. */
export function previewUserMessageText(text?: string | null): string {
  if (!text) return "";
  const lines = text.split("\n");
  if (lines.length > USER_MSG_PREVIEW_LINES) {
    const head = lines.slice(0, USER_MSG_PREVIEW_LINES).join("\n");
    if (head.length > USER_MSG_PREVIEW_CHARS) {
      return head.slice(0, USER_MSG_PREVIEW_CHARS).trimEnd() + "…";
    }
    return head.trimEnd() + "\n…";
  }
  if (text.length > USER_MSG_PREVIEW_CHARS) {
    return text.slice(0, USER_MSG_PREVIEW_CHARS).trimEnd() + "…";
  }
  return text;
}
