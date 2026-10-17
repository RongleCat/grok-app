/**
 * Per-chat connect claim ownership.
 *
 * A claim keeps two connects for one chat from racing. If the owner's Host
 * call never settles, its claim must not block that chat forever: a waiter
 * that outlives the connect budget may take it over, and the old owner's late
 * release is then ignored so it cannot drop the newer claim.
 */

export type ConnectClaim = { readonly id: number; readonly at: number };

let nextClaimId = 1;

export function newConnectClaim(now: number = Date.now()): ConnectClaim {
  return { id: nextClaimId++, at: now };
}

/** True when the current claim is older than the budget (owner presumed wedged). */
export function claimIsStale(
  claim: ConnectClaim | undefined,
  now: number,
  budgetMs: number,
): boolean {
  if (!claim) return true;
  return now - claim.at >= budgetMs;
}

/**
 * Whether `owner` may release the key currently held by `current`.
 * No owner (legacy/bulk callers) or no recorded claim → release.
 */
export function claimReleasableBy(
  current: ConnectClaim | undefined,
  owner: ConnectClaim | undefined,
): boolean {
  if (!owner || !current) return true;
  return current.id === owner.id;
}
