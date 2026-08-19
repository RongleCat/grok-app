/**
 * Codex-style heatmap stats: totals, peak, longest chat, streaks.
 * Honest — never invent 0 as a known figure when there is no activity.
 */

import { heatmapDayHasActivity, type HeatmapUsageDay } from "./heatmapUsagePro";
import { intlLocale, isTightScript } from "@/i18n";

export type HeatmapCallLogLike = {
  durationSecs?: number | null;
};

export type HeatmapActivityStats = {
  totalTokens: number | null;
  peakTokens: number | null;
  peakDate: string | null;
  longestDurationSecs: number | null;
  currentStreak: number | null;
  longestStreak: number | null;
};

function ymdParts(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function daysBetweenYmd(a: string, b: string): number | null {
  const pa = ymdParts(a);
  const pb = ymdParts(b);
  if (!pa || !pb) return null;
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((db - da) / 86_400_000);
}

function isConsecutive(prev: string, next: string): boolean {
  return daysBetweenYmd(prev, next) === 1;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Consecutive active-day streaks from a padded calendar.
 * Current streak: walk back from today. Today empty still counts yesterday
 * (same-day grace). Older gaps reset to 0.
 */
export function computeHeatmapStreaks(
  days: readonly HeatmapUsageDay[],
  today = formatLocalYmd(new Date()),
): { current: number; longest: number } {
  const active = days
    .filter((d) => d?.date && heatmapDayHasActivity(d))
    .map((d) => d.date)
    .sort();
  if (active.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < active.length; i++) {
    if (isConsecutive(active[i - 1]!, active[i]!)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  const last = active[active.length - 1]!;
  const gap = daysBetweenYmd(last, today);
  if (gap == null || gap > 1) {
    return { current: 0, longest };
  }

  let current = 1;
  for (let i = active.length - 1; i > 0; i--) {
    if (isConsecutive(active[i - 1]!, active[i]!)) current += 1;
    else break;
  }
  return { current, longest };
}

export function summarizeHeatmapStats(
  days: readonly HeatmapUsageDay[] | null | undefined,
  logs: readonly HeatmapCallLogLike[] | null | undefined,
  today?: string,
): HeatmapActivityStats {
  const list = Array.isArray(days) ? days : [];
  let total = 0;
  let peak = 0;
  let peakDate: string | null = null;
  let any = false;

  for (const d of list) {
    if (!d?.date) continue;
    const t = Number(d.tokens);
    if (!Number.isFinite(t) || t <= 0) continue;
    any = true;
    const tok = Math.floor(t);
    total += tok;
    if (tok > peak) {
      peak = tok;
      peakDate = d.date;
    }
  }

  let longestDur = 0;
  if (Array.isArray(logs)) {
    for (const row of logs) {
      const s = Number(row.durationSecs);
      if (Number.isFinite(s) && s > longestDur) longestDur = Math.floor(s);
    }
  }

  const streaks = computeHeatmapStreaks(list, today);

  if (!any) {
    return {
      totalTokens: null,
      peakTokens: null,
      peakDate: null,
      longestDurationSecs: longestDur > 0 ? longestDur : null,
      currentStreak: null,
      longestStreak: null,
    };
  }

  return {
    totalTokens: total,
    peakTokens: peak,
    peakDate,
    longestDurationSecs: longestDur > 0 ? longestDur : null,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
  };
}

/** Running token totals in calendar order (padding zeros stay 0). */
export function cumulativeTokenSeries(
  days: readonly HeatmapUsageDay[],
): number[] {
  let run = 0;
  return days.map((d) => {
    const t = Number(d.tokens);
    if (d?.date && Number.isFinite(t) && t > 0) run += Math.floor(t);
    return run;
  });
}

type DurationUnit = "hour" | "minute" | "second";

/** ASCII suffixes used when the runtime lacks `Intl.NumberFormat` unit style. */
const DURATION_FALLBACK: Record<DurationUnit, string> = {
  hour: "h",
  minute: "m",
  second: "s",
};

/**
 * CLDR narrow duration units are compact and written in the locale's own script
 * for every language shipped here — except Japanese, whose narrow forms are the
 * Latin `h` / `m` / `s`. Those read as untranslated next to Japanese UI copy, so
 * Japanese uses its own suffixes. (CLDR's Japanese *short* forms are correct but
 * insert a space, `9 時間`, which Japanese typography does not want.)
 */
const DURATION_UNIT_OVERRIDES: Record<string, Record<DurationUnit, string>> = {
  ja: { hour: "時間", minute: "分", second: "秒" },
};

/**
 * `9h` / `9時間` / `9시간` / `9 ч` — narrow unit for the locale.
 * Falls back to ASCII suffixes if the runtime rejects the unit style.
 */
function formatDurationPart(
  value: number,
  unit: DurationUnit,
  locale: string,
): string {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  const override = DURATION_UNIT_OVERRIDES[primary];
  if (override) return `${value}${override[unit]}`;
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "unit",
      unit,
      unitDisplay: "narrow",
    }).format(value);
  } catch {
    return `${value}${DURATION_FALLBACK[unit]}`;
  }
}

/**
 * Hours/minutes in the locale (Codex-style stat strip).
 *
 * Units come from CLDR rather than a zh/en fork, so every shipped locale gets
 * its own suffix. CJK joins the two parts without a space (`1時間30分`);
 * everything else keeps one (`1h 30m`).
 */
export function formatStatDuration(
  secs: number | null | undefined,
  locale = "en",
): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sep = isTightScript(locale) ? "" : " ";
  const part = (v: number, u: DurationUnit) => formatDurationPart(v, u, locale);

  if (h > 0) {
    return m > 0 ? `${part(h, "hour")}${sep}${part(m, "minute")}` : part(h, "hour");
  }
  if (m > 0) {
    return s > 0
      ? `${part(m, "minute")}${sep}${part(s, "second")}`
      : part(m, "minute");
  }
  return part(s, "second");
}
