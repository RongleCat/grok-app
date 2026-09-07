/** Pure helpers for sidebar multi-select (archive / restore). */

/** Cmd (macOS) or Ctrl (Windows/Linux) — Finder-style additive select. */
export function isSelectModifierEvent(e: {
  metaKey?: boolean;
  ctrlKey?: boolean;
}): boolean {
  return !!(e.metaKey || e.ctrlKey);
}

/** Toggle `id` membership; always returns a new Set. */
export function toggleIdInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Union `ids` into a new Set. */
export function addIdsToSet(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = new Set(selected);
  for (const id of ids) next.add(id);
  return next;
}

/**
 * Inclusive range of ids between `fromId` and `toId` in `orderedIds`.
 * If either endpoint is missing, returns only `toId` (when present) or empty.
 */
export function rangeIdsInclusive(
  orderedIds: readonly string[],
  fromId: string,
  toId: string,
): string[] {
  const a = orderedIds.indexOf(fromId);
  const b = orderedIds.indexOf(toId);
  if (b < 0) return [];
  if (a < 0) return [toId];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return orderedIds.slice(lo, hi + 1);
}

/** True when `ids` is non-empty and every id is already in `selected`. */
export function areAllIdsSelected(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): boolean {
  if (ids.length === 0) return false;
  for (const id of ids) {
    if (!selected.has(id)) return false;
  }
  return true;
}

/**
 * Group select for a project / Default workspace folder:
 * if every id is already selected, remove them; otherwise add them all.
 * Always returns a new Set (empty `ids` still copies).
 */
export function toggleIdsInSet(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = new Set(selected);
  if (ids.length === 0) return next;
  if (areAllIdsSelected(next, ids)) {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
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
