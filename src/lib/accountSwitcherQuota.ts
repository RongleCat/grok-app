/**
 * User-menu multi-account quota list.
 *
 * Reuses SuperGrok honesty helpers — never invents 0% / 100% when the probe
 * is silent. Switching still goes through `account_switch`.
 */

import {
  resolveQuotaPercents,
  type QuotaBillingLike,
} from "./accountQuotaHonesty";

export type SwitcherQuota = {
  remainingPercent: number | null;
  usedPercent: number | null;
  resetsAt: string | null;
  available: boolean;
};

export function switcherDisplayName(a: {
  displayName?: string | null;
  label: string;
  email?: string | null;
}): string {
  const name = (a.displayName || "").trim();
  if (name) return name;
  const label = (a.label || "").replace(/\s*·\s*\d+(?:\.\d+)?%\s*.*$/, "").trim();
  if (label) return label;
  return (a.email || "").trim() || "Grok";
}

export function isSwitcherQuotaKnown(
  q: SwitcherQuota | null | undefined,
): boolean {
  if (!q || !q.available) return false;
  return (
    (q.remainingPercent != null && Number.isFinite(q.remainingPercent)) ||
    (q.usedPercent != null && Number.isFinite(q.usedPercent))
  );
}

/** Map a Host `accounts_quota` row through the same honesty rules as billing. */
export function quotaFromHostItem(item: {
  remainingPercent?: number | null;
  usedPercent?: number | null;
  resetsAt?: string | null;
  available: boolean;
}): SwitcherQuota {
  if (!item.available) {
    return {
      remainingPercent: null,
      usedPercent: null,
      resetsAt: null,
      available: false,
    };
  }
  const percents = resolveQuotaPercents({
    remainingPercent: item.remainingPercent,
    creditUsagePercent: item.usedPercent,
    available: item.available,
  } satisfies QuotaBillingLike);
  const known =
    percents.remainingPercent != null || percents.usedPercent != null;
  return {
    remainingPercent: percents.remainingPercent,
    usedPercent: percents.usedPercent,
    resetsAt: item.resetsAt ?? null,
    available: known,
  };
}

export function liveQuotaFromBilling(
  billing: QuotaBillingLike | null | undefined,
  resetsAt?: string | null,
): SwitcherQuota {
  const percents = resolveQuotaPercents(billing);
  const known =
    percents.remainingPercent != null || percents.usedPercent != null;
  return {
    remainingPercent: percents.remainingPercent,
    usedPercent: percents.usedPercent,
    resetsAt: resetsAt ?? null,
    available: known,
  };
}

/**
 * Prefer a successful `accounts_quota` row.
 * Current account falls back to the live `account_status` snapshot so the
 * active row does not flash empty while other accounts are still probing.
 * Other accounts stay null (UI shows "—") until a real probe returns.
 */
export function mergeAccountQuota(
  id: string,
  email: string | null | undefined,
  fetched: Record<string, SwitcherQuota>,
  current: {
    id?: string | null;
    email?: string | null;
    remaining: number | null;
    used: number | null;
    resetsAt?: string | null;
  },
): SwitcherQuota | null {
  const hit = fetched[id];
  if (isSwitcherQuotaKnown(hit)) return hit;

  const isCurrent =
    (!!current.id && current.id === id) ||
    (!!email && !!current.email && email === current.email);
  const live: SwitcherQuota | null = isCurrent
    ? {
        remainingPercent: current.remaining,
        usedPercent: current.used,
        resetsAt: current.resetsAt ?? null,
        available:
          (current.remaining != null && Number.isFinite(current.remaining)) ||
          (current.used != null && Number.isFinite(current.used)),
      }
    : null;

  if (isSwitcherQuotaKnown(live)) return live;
  if (hit) {
    return {
      remainingPercent: null,
      usedPercent: null,
      resetsAt: null,
      available: false,
    };
  }
  return live;
}
