/**
 * Sidebar project-folder expand/collapse persistence helpers.
 *
 * Product rule: missing id ⇒ expanded, except a crowded tree with no
 * persisted collapse state starts collapsed (#1230).
 * Only collapsed folders are stored (`sidebarCollapsedProjectIds`).
 */

/** Many open folders × a few chats each stutter; collapse until the user opens some. */
export const SIDEBAR_AUTO_COLLAPSE_PROJECT_THRESHOLD = 12;

/** Build expand map for known project ids from persisted collapsed ids. */
export function expandMapFromCollapsedIds(
  projectIds: string[],
  collapsedIds: string[] | null | undefined,
): Record<string, boolean> {
  const collapsed = new Set(
    (collapsedIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const crowded =
    projectIds.length >= SIDEBAR_AUTO_COLLAPSE_PROJECT_THRESHOLD &&
    collapsed.size === 0;
  const map: Record<string, boolean> = {};
  for (const id of projectIds) {
    if (collapsed.has(id) || crowded) map[id] = false;
    else map[id] = true;
  }
  return map;
}

/** Ids that should be written to settings (explicitly collapsed). */
export function collapsedIdsFromExpandMap(
  map: Record<string, boolean>,
): string[] {
  return Object.entries(map)
    .filter(([, open]) => open === false)
    .map(([id]) => id)
    .sort();
}

/** True when two collapsed-id lists encode the same set. */
export function sameCollapsedIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}
