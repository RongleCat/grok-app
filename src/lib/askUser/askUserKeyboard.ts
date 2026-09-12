/**
 * Keyboard policy for the ask-user composer gate.
 *
 * Enter submits; IME candidate-commit Enter (composition / keyCode 229)
 * must not submit. Arrow keys move among options.
 */

export type AskUserKeyEvent = {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

/** Chinese/Japanese IME uses Enter to pick a candidate — never treat as submit. */
export function isAskUserImeCommit(e: AskUserKeyEvent): boolean {
  if (e.isComposing) return true;
  if (e.keyCode === 229) return true;
  return e.key === "Process" || e.key === "Unidentified";
}

/** Plain Enter submits. Shift+Enter stays a newline in the custom field. */
export function shouldAskUserSubmitOnEnter(e: AskUserKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
  if (isAskUserImeCommit(e)) return false;
  return true;
}

export function nextAskUserOptionIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (current + 1) % count;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (current - 1 + count) % count;
  }
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
