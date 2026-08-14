/**
 * Codex-style heatmap stats: totals, peak, longest chat, streaks.
 * Honest — never invent 0 as a known figure when there is no activity.
 */

import { heatmapDayHasActivity, type HeatmapUsageDay } from "./heatmapUsagePro";

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

/** Hours/minutes in the locale (Codex-style stat strip). */
export function formatStatDuration(
  secs: number | null | undefined,
  locale = "en",
): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const zh = locale === "zh" || locale === "zh-TW";
  if (zh) {
    if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
    if (m > 0) return s > 0 ? `${m}分${s}秒` : `${m}分`;
    return `${s}秒`;
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}
