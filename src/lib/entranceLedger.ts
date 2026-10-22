/**
 * One-shot ledger for block entrance.
 *
 * Expanding / collapsing, the stream-end handoff to the virtual window, and
 * phase merging all remount the same block; if entrance fired on every mount,
 * those remounts would replay a whole batch of rows at once and read as a
 * flicker. This ledger tracks stable ids: each block plays entrance only once
 * per app lifetime.
 *
 * Only blocks claimed while streaming occupy a key; history blocks never
 * claim, so they never replay later either.
 */

const claimed = new Set<string>();

/** Guards against unbounded growth in long sessions; past the cap the set is
 * cleared, which only affects entrance for later blocks. */
const MAX_CLAIMS = 4000;

/**
 * Try to claim a block's entrance slot.
 *
 * @param key Stable identifier (tool call id / phase id, …).
 * @returns `true` on the first claim, `false` for the same key afterwards.
 */
export function claimEntrance(key: string): boolean {
  if (!key) return false;
  if (claimed.has(key)) return false;
  if (claimed.size >= MAX_CLAIMS) claimed.clear();
  claimed.add(key);
  return true;
}

/** Test-only: clear the ledger so cases do not leak into each other. */
export function resetEntranceLedger(): void {
  claimed.clear();
}
