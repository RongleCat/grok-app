/**
 * Pure helpers for filtering CLI session rows in Settings → General.
 */

export type CliSessionFilterRow = {
  agentSessionId: string;
  title: string;
  cwd?: string | null;
};

/**
 * Filter CLI session rows by free-text query.
 * Case-insensitive match on title, agent session id, and cwd.
 * Empty/whitespace query → all rows (preserves order).
 */
export function filterCliSessions<T extends CliSessionFilterRow>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if (r.title.toLowerCase().includes(q)) return true;
    if (r.agentSessionId.toLowerCase().includes(q)) return true;
    const cwd = r.cwd?.toLowerCase() ?? "";
    if (cwd && cwd.includes(q)) return true;
    return false;
  });
}

/**
 * Count not-yet-linked rows (for bulk import button).
 */
export function countUnlinkedCliSessions(
  rows: Array<{ alreadyLinked: boolean }>,
): number {
  return rows.reduce((n, r) => n + (r.alreadyLinked ? 0 : 1), 0);
}
