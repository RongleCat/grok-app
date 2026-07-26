/**
 * Composer prompt history — CLI-like ↑/↓ recall of prior user prompts.
 *
 * History is newest-first (index 0 = most recent user message).
 * Index `null` means not browsing (live draft).
 */

export type PromptHistoryStep = {
  /** Index into history (0 = newest), or null when not browsing. */
  index: number | null;
  /** Draft text to apply ("" when leaving history). */
  text: string;
};

/**
 * Extract prior user prompt strings from session messages, newest first.
 * Skips mid-turn interjections and empty / whitespace-only content. Keeps stored display form
 * (`[[skill:…]]` tokens) so the composer can re-render chips.
 */
export function collectUserPromptHistory(
  messages: ReadonlyArray<{
    role: string;
    content?: string | null;
    marker?: string;
  }>,
): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || m.marker === "interjection") continue;
    const c = m.content ?? "";
    if (!c.trim()) continue;
    out.push(c);
  }
  return out;
}

/**
 * Compute next history index for ↑ / ↓.
 * - null means "live empty draft" (not browsing)
 * - up from null → 0; up clamps at oldest
 * - down from 0 → null (clear); down from null stays null
 */
export function nextPromptHistoryIndex(
  currentIndex: number | null,
  historyLength: number,
  direction: "up" | "down",
): number | null {
  if (historyLength <= 0) return null;
  if (direction === "up") {
    if (currentIndex == null) return 0;
    return Math.min(currentIndex + 1, historyLength - 1);
  }
  // down
  if (currentIndex == null) return null;
  if (currentIndex <= 0) return null;
  return currentIndex - 1;
}

/**
 * Pure step: given history (newest first) and direction, return next
 * index + text for the composer.
 */
export function stepPromptHistory(
  history: readonly string[],
  currentIndex: number | null,
  direction: "up" | "down",
): PromptHistoryStep {
  const index = nextPromptHistoryIndex(
    currentIndex,
    history.length,
    direction,
  );
  if (index == null) return { index: null, text: "" };
  return { index, text: history[index] ?? "" };
}

/**
 * Whether ↑/↓ should be claimed for history navigation.
 * Parent must ensure slash palette is closed before calling.
 *
 * - ArrowUp: only when draft is empty (start) or already browsing
 * - ArrowDown: only while already browsing (forward / clear)
 */
export function shouldHandlePromptHistoryKey(input: {
  key: string;
  draftEmpty: boolean;
  browsing: boolean;
  historyLength: number;
}): boolean {
  if (input.historyLength <= 0) return false;
  if (input.key !== "ArrowUp" && input.key !== "ArrowDown") return false;
  if (input.key === "ArrowUp") {
    return input.draftEmpty || input.browsing;
  }
  return input.browsing;
}
