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

/**
 * Move `owner`'s claim from `fromKey` to `toKey`.
 * A late `sessionCreate` must not do this after a takeover replaced the claim:
 * that would drop the newer draft and park the typed text on an empty chat.
 * Refuses, and mutates nothing, when `owner` no longer holds `fromKey` or
 * `toKey` is already taken.
 */
export function rebindConnectClaim(
  claims: Set<string>,
  owners: Map<string, ConnectClaim>,
  fromKey: string,
  toKey: string,
  owner: ConnectClaim,
): boolean {
  const current = owners.get(fromKey);
  if (!claims.has(fromKey) || !current || current.id !== owner.id) return false;
  if (fromKey !== toKey && claims.has(toKey)) return false;
  claims.delete(fromKey);
  owners.delete(fromKey);
  claims.add(toKey);
  owners.set(toKey, owner);
  return true;
}
