/**
 * Format DeepSeek (and future) balance DTOs for footer / menu chips.
 * Amounts stay strings — never invent "0.00".
 */

import type { ProviderBalanceLine, ProviderBalanceResult } from "@/lib/api";

/** Prefer CNY, then USD, else first row with a total. */
export function pickPrimaryBalance(
  balances?: ProviderBalanceLine[] | null,
): ProviderBalanceLine | null {
  if (!balances?.length) return null;
  const withTotal = balances.filter(
    (b) => typeof b.totalBalance === "string" && b.totalBalance.trim() !== "",
  );
  if (!withTotal.length) return null;
  const cny = withTotal.find((b) => b.currency.toUpperCase() === "CNY");
  if (cny) return cny;
  const usd = withTotal.find((b) => b.currency.toUpperCase() === "USD");
  if (usd) return usd;
  return withTotal[0] ?? null;
}

/** Footer one-liner: `110.00 CNY` or null when nothing honest to show. */
export function formatProviderBalanceLine(
  result: ProviderBalanceResult | null | undefined,
): string | null {
  if (!result?.ok) return null;
  const primary = pickPrimaryBalance(result.balances);
  if (!primary) return null;
  const total = primary.totalBalance.trim();
  if (!total) return null;
  const cur = primary.currency.trim();
  return cur ? `${total} ${cur}` : total;
}

/** Compact detail: `赠送 10.00 · 充值 100.00` style parts (caller localizes labels). */
export function formatProviderBalanceDetailParts(
  result: ProviderBalanceResult | null | undefined,
): { granted: string; toppedUp: string; currency: string } | null {
  if (!result?.ok) return null;
  const primary = pickPrimaryBalance(result.balances);
  if (!primary) return null;
  return {
    granted: primary.grantedBalance.trim(),
    toppedUp: primary.toppedUpBalance.trim(),
    currency: primary.currency.trim(),
  };
}

/** Session memory cache entry for active-provider balance. */
export type ProviderBalanceCache = {
  providerId: string;
  fetchedAt: number;
  result: ProviderBalanceResult;
};

export const PROVIDER_BALANCE_TTL_MS = 5 * 60 * 1000;

export function isProviderBalanceCacheFresh(
  cache: ProviderBalanceCache | null | undefined,
  providerId: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!cache || !providerId) return false;
  if (cache.providerId !== providerId) return false;
  if (!cache.result.ok) return false;
  return now - cache.fetchedAt < PROVIDER_BALANCE_TTL_MS;
}
