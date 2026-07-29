/** Pure helpers for sidebar multi-select (archive / restore). */

/** Toggle `id` membership; always returns a new Set. */
export function toggleIdInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Drop ids that are no longer in `liveIds` (list refresh / archive).
 * Returns the same instance when nothing changes.
 */
export function pruneSelectedIds(
  selected: ReadonlySet<string>,
  liveIds: ReadonlySet<string>,
): Set<string> {
  if (selected.size === 0) return selected instanceof Set ? selected : new Set(selected);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (liveIds.has(id)) next.add(id);
    else changed = true;
  }
  if (!changed && selected instanceof Set) return selected;
  return next;
}
