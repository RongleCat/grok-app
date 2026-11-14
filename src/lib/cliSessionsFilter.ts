/**
 * Pure helpers for filtering CLI session rows in Settings → General.
 */

export type CliSessionFilterRow = {
  agentSessionId: string;
  title: string;
  cwd?: string | null;
  /** First user prompt when known (local fallback / enriched list). */
  firstPrompt?: string | null;
};

/**
 * Filter CLI session rows by free-text query.
 * Case-insensitive match on title, agent session id, cwd, and first prompt.
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
    const prompt = r.firstPrompt?.toLowerCase() ?? "";
    if (prompt && prompt.includes(q)) return true;
    return false;
  });
}

/** Count every unlinked row, including stubs, for the destructive delete action. */
export function countUnlinkedCliSessions(rows: Array<{ alreadyLinked: boolean }>): number {
  return rows.reduce((n, r) => n + (r.alreadyLinked ? 0 : 1), 0);
}

/** Count the next host-eligible import batch; older hosts fall back to unlinked rows. */
export function countBulkImportableCliSessions(
  rows: Array<{ alreadyLinked: boolean; bulkImportable?: boolean }>,
  limit = 50,
): number {
  return Math.min(limit, rows.reduce((n, r) => n + (!r.alreadyLinked && r.bulkImportable !== false ? 1 : 0), 0));
}
