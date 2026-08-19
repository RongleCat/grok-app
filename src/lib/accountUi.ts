/** Display helpers for official account / billing / local usage. */

import type {
  AccountProfile,
  AccountStatus,
  BillingSnapshot,
} from "./api";
import type { SuperGrokBrandKind } from "@/components/SuperGrokMark";
import {
  ZH_HANS_UNITS,
  ZH_HANT_UNITS,
  formatEnglishCompactCount,
  formatMyriadCount,
  isTraditionalChinese,
  myriadUnitsFor,
} from "./formatCompactCount";
import { intlLocale, isTightScript } from "@/i18n";

export function accountDisplayName(
  profile: AccountProfile,
  fallback = "Local",
): string {
  return (
    profile.displayName?.trim() ||
    profile.email?.trim() ||
    fallback
  );
}

export function accountInitials(profile: AccountProfile): string {
  const name = accountDisplayName(profile, "G");
  if (name.includes("@")) {
    return name.slice(0, 1).toUpperCase();
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function channelLabelKey(channel: string): string {
  switch (channel) {
    case "official_oauth":
      return "account.channel.oauth";
    case "official_key":
      return "account.channel.key";
    case "relay":
      return "account.channel.relay";
    default:
      return "account.channel.none";
  }
}

export function tierLabel(
  billing: BillingSnapshot,
  channel: string,
): string {
  if (billing.subscriptionTier?.trim()) {
    return billing.subscriptionTier.trim();
  }
  if (channel === "official_oauth") return "Grok Build";
  if (channel === "official_key") return "API Key";
  if (channel === "relay") return "Relay";
  return "—";
}

/**
 * Pick SuperGrok brand mark for empty-session hero.
 * Uses official display strings from /v1/settings (e.g. "SuperGrok Heavy")
 * and API enums (SuperGrokPro → Heavy).
 */
export function superGrokBrandKind(
  billing: BillingSnapshot | null | undefined,
  signedIn: boolean,
): SuperGrokBrandKind | null {
  if (!signedIn) return null;
  const raw = (billing?.subscriptionTier ?? "").trim();
  if (raw) {
    const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
    // SuperGrokPro is the API enum for SuperGrok Heavy (confirmed live).
    if (compact.includes("heavy") || compact === "supergrokpro") {
      return "heavy";
    }
    if (
      compact.includes("supergrok") ||
      compact.includes("grokpro") ||
      compact.includes("xpremium") ||
      compact.includes("premiumplus")
    ) {
      return "supergrok";
    }
  }
  // Paid Grok Build session without a recognized name — still show SuperGrok mark.
  if (billing?.available || billing?.isUnifiedBillingUser) {
    return "supergrok";
  }
  return null;
}

/** localStorage key — last known SuperGrok wordmark for instant welcome paint. */
export const SUPERGROK_BRAND_CACHE_KEY = "grok-app.supergrokBrandKind";

export function isSuperGrokBrandKind(v: unknown): v is SuperGrokBrandKind {
  return v === "supergrok" || v === "heavy";
}

/**
 * Read last successful brand kind. Used so the new-session logo does not wait
 * on accountStatus + billing network (SVG itself is inline and instant).
 */
export function loadCachedSuperGrokBrand(
  storage: Storage | null | undefined = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): SuperGrokBrandKind | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SUPERGROK_BRAND_CACHE_KEY);
    return isSuperGrokBrandKind(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist brand after a live resolve so the next welcome session paints immediately. */
export function saveCachedSuperGrokBrand(
  kind: SuperGrokBrandKind | null,
  storage: Storage | null | undefined = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    if (kind) storage.setItem(SUPERGROK_BRAND_CACHE_KEY, kind);
    else storage.removeItem(SUPERGROK_BRAND_CACHE_KEY);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Live billing result wins; fall back to cache while account is still loading
 * so welcome logo is not blocked by quota network.
 *
 * Custom relay route: always show the plain SuperGrok mark (never Heavy).
 * Heavy is an official SuperGrok membership brand and does not apply to relays.
 *
 * Default fallback is the plain **SuperGrok** wordmark: official account state
 * loss (auth.json missing/unreadable, billing blip, transient signed-out) must
 * never blank the new-session brand surface above the composer. A confirmed
 * Heavy tier still wins via `live`; cached Heavy is only trusted while the
 * account is still loading.
 */
export function resolveWelcomeBrandKind(
  live: SuperGrokBrandKind | null,
  cached: SuperGrokBrandKind | null,
  opts?: {
    accountReady?: boolean;
    signedIn?: boolean;
    /** Active inference channel is a custom OpenAI-compatible provider. */
    customRoute?: boolean;
  },
): SuperGrokBrandKind {
  if (opts?.customRoute) {
    return "supergrok";
  }
  if (live) return live;
  // Once we know the user is signed out, never flash a stale Heavy mark — but
  // still default to the plain SuperGrok wordmark instead of blanking it.
  if (opts?.accountReady && opts.signedIn === false) return "supergrok";
  return cached ?? "supergrok";
}

export function usagePercent(billing: BillingSnapshot): number | null {
  if (
    billing.creditUsagePercent != null &&
    Number.isFinite(billing.creditUsagePercent)
  ) {
    // Allow slight overflow past 100 like grok-go.
    return Math.max(0, Math.min(200, billing.creditUsagePercent));
  }
  if (
    billing.remainingPercent != null &&
    Number.isFinite(billing.remainingPercent)
  ) {
    return Math.max(0, 100 - billing.remainingPercent);
  }
  if (
    billing.monthlyLimit != null &&
    billing.monthlyLimit > 0 &&
    billing.includedUsed != null
  ) {
    return Math.max(
      0,
      Math.min(100, (billing.includedUsed / billing.monthlyLimit) * 100),
    );
  }
  return null;
}

/**
 * Compact counts for account / heatmap / call logs.
 * zh / zh-TW: 千 / 万·萬 / 亿·億. Other locales (incl. en): K / M / B.
 */
export function formatCompactNumber(
  n: number | null | undefined,
  locale: string = "zh",
): string {
  return formatLocaleCount(n, locale);
}

/**
 * Chinese compact count: 百 / 千 / 万·萬 / 亿·億 (not English k/M).
 * `zh-TW` uses 萬/億; simplified (default) uses 万/亿.
 * Bands: ≥1e8 亿, ≥1e4 万, ≥1e3 千, ≥100 百, else integer/1dp.
 *
 * Always formats in Chinese regardless of the id passed — callers that want
 * per-locale behaviour use {@link formatLocaleCount} instead.
 */
export function formatChineseCount(
  n: number | null | undefined,
  locale: string = "zh",
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = isTraditionalChinese(locale) ? ZH_HANT_UNITS : ZH_HANS_UNITS;
  return formatMyriadCount(n, units);
}

/**
 * Locale-aware compact number: myriad units (百/千/万·萬 · 백/천/만) for the CJK
 * locales that group by 10^4, K/M/B everywhere else.
 */
export function formatLocaleCount(
  n: number | null | undefined,
  locale: string = "zh",
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = myriadUnitsFor(locale);
  if (!units) {
    return formatEnglishCompactCount(n);
  }
  return formatMyriadCount(n, units);
}

/** Local calendar day `YYYY-MM-DD` for an ISO timestamp (heatmap / call-log filter). */
export function localDateKeyFromIso(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDuration(secs: number | null | undefined): string {
  if (secs == null || secs <= 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Compact message footer time, e.g. `星期二15:23` / `火15:23` / `Tue 15:23`.
 * CJK weekday abbreviations butt against the clock with no separating space.
 */
export function formatMessageTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const loc = intlLocale(locale);
  const weekday = new Intl.DateTimeFormat(loc, { weekday: "short" }).format(d);
  const hm = new Intl.DateTimeFormat(loc, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return isTightScript(locale) ? `${weekday}${hm}` : `${weekday} ${hm}`;
}

export function formatRelativeTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), {
    numeric: "auto",
  });
  const sec = Math.round(diff / 1000);
  if (Math.abs(sec) < 60) return rtf.format(-sec, "second");
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 48) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  return rtf.format(-day, "day");
}

/**
 * Quota refresh time for menus: month, day and clock in local time.
 *
 * The order and separators come from the locale. Hand-building `MM-DD HH:mm`
 * reads as a date only to someone who already expects month first — a German
 * user parses `04-15` as the 4th of month 15, and an en-US user loses the
 * am/pm their clock format needs.
 */
export function formatQuotaResetTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(t));
}

export function isAccountConnected(status: AccountStatus | null): boolean {
  if (!status) return false;
  return (
    status.profile.signedIn ||
    status.hasOfficialKey ||
    status.hasRelayKey ||
    status.cliAuthPresent
  );
}
