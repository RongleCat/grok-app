/**
 * Sidebar chat title commit. Empty or unchanged drafts are ignored.
 * `current` is the on-screen title (untitled fallback when the row has none).
 */
export function nextSessionTitle(
  draft: string,
  current: string,
): string | null {
  const next = draft.trim();
  if (!next) return null;
  if (next === current.trim()) return null;
  return next;
}
