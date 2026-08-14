/**
 * HEATMAP-USAGE-PRO — pure helpers for Account activity heatmap honesty.
 *
 * Rules:
 * - Never invent activity cells or SuperGrok quota from local session signals.
 * - Zero-filled calendar days are **not** samples (host pads ~371 empty days).
 * - Soft-fail when Host / network fails or usage is empty — warn, do not fake data.
 * - No DOM / Tauri side effects.
 *
 * See docs/llm-wiki/account.md (heatmap = local ~/.grok/sessions signals).
 */

import {
  dateInHeatRange,
  type HeatRange,
  type HeatmapRangeDay,
} from "@/lib/heatmapRange";

// ── Day / sample honesty ─────────────────────────────────────────────────────

/** Minimal day shape accepted by pro helpers. */
export type HeatmapUsageDay = HeatmapRangeDay & {
  costUsd?: number;
};

/**
 * True when a day has real local activity (sessions/requests or tokens).
 * Zero-padded host calendar rows return false.
 */
export function heatmapDayHasActivity(
  day: Pick<HeatmapUsageDay, "requests" | "tokens"> | null | undefined,
): boolean {
  if (!day) return false;
  const r = Number(day.requests);
  const t = Number(day.tokens);
  return (Number.isFinite(r) && r > 0) || (Number.isFinite(t) && t > 0);
}

/**
 * True when at least one day in the list has real activity.
 * Empty / null lists → false (never invent samples).
 */
export function heatmapHasSamples(
  days: readonly HeatmapUsageDay[] | null | undefined,
): boolean {
  if (!days || days.length === 0) return false;
  for (const d of days) {
    if (heatmapDayHasActivity(d)) return true;
  }
  return false;
}

// ── Range summary ────────────────────────────────────────────────────────────

/**
 * Honest counts for a day list, optionally clipped to an inclusive range.
 * Missing days contribute nothing; zeros never become fake activity.
 */
export type HeatmapRangeSummary = {
  /** Calendar rows considered (after optional range clip). */
  dayCount: number;
  /** Days with requests > 0 or tokens > 0. */
  activeDays: number;
  /** Sum of known session/request counts. */
  totalRequests: number;
  /** Sum of known tokens. */
  totalTokens: number;
  /** True when activeDays > 0. */
  hasActivity: boolean;
  /**
   * True when we only have zero-filled (or empty) calendar rows —
   * UI should prefer empty honesty over a “busy” total chip.
   */
  isEmptyCalendar: boolean;
};

/**
 * Summarize heatmap days with honest counts.
 * When `range` is set, only days inside that inclusive range are counted.
 */
export function summarizeHeatmapRange(
  days: readonly HeatmapUsageDay[] | null | undefined,
  range?: HeatRange | null,
): HeatmapRangeSummary {
  const list = Array.isArray(days) ? days : [];
  let dayCount = 0;
  let activeDays = 0;
  let totalRequests = 0;
  let totalTokens = 0;

  for (const d of list) {
    if (!d?.date) continue;
    if (range && !dateInHeatRange(d.date, range)) continue;
    dayCount += 1;
    const r = Number(d.requests);
    const t = Number(d.tokens);
    const req = Number.isFinite(r) && r > 0 ? Math.floor(r) : 0;
    const tok = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
    if (req > 0 || tok > 0) {
      activeDays += 1;
      totalRequests += req;
      totalTokens += tok;
    }
  }

  const hasActivity = activeDays > 0;
  return {
    dayCount,
    activeDays,
    totalRequests,
    totalTokens,
    hasActivity,
    isEmptyCalendar: !hasActivity,
  };
}

// ── Error classification ─────────────────────────────────────────────────────

/**
 * Stable heatmap / account-status failure kinds.
 * - `host_only` — browser / mirror without desktop Host
 * - `network` — transport / offline while loading status
 * - `empty` — host returned no usage path / empty signals root
 * - `other` — unclassified soft-fail
 */
export type HeatmapErrorKind = "host_only" | "network" | "empty" | "other";

export type HeatmapErrorView = {
  kind: HeatmapErrorKind;
  /** Soft-fail: never invent cells/quota; warn chrome only. */
  softFail: boolean;
  /** Short detail excerpt (no secrets expected). */
  detail: string;
  /** i18n title key under account.heatmap.err.*. */
  titleKey: string;
  /** i18n hint key under account.heatmap.err.*. */
  hintKey: string;
};

function errText(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const code =
      typeof (err as Error & { code?: unknown }).code === "string"
        ? String((err as Error & { code?: string }).code)
        : "";
    return `${code} ${err.message} ${err.name}`.trim();
  }
  if (typeof err === "object") {
    const o = err as {
      code?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    const parts = [o.code, o.message, o.reason, o.error]
      .filter((x) => x != null && String(x).trim())
      .map(String);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c.trim().toLowerCase();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return "";
}

/**
 * Classify heatmap / account_status failures into a stable kind.
 * Prefer explicit codes and known host phrases over free-form text.
 */
export function classifyHeatmapError(err: unknown): HeatmapErrorKind {
  if (err == null || err === "") return "other";

  const code = errCode(err);
  if (
    code === "host_only" ||
    code === "host-only" ||
    code === "need_tauri" ||
    code === "need-tauri" ||
    code === "desktop_only"
  ) {
    return "host_only";
  }
  if (
    code === "network" ||
    code === "offline" ||
    code === "econnrefused" ||
    code === "etimedout" ||
    code === "timeout"
  ) {
    return "network";
  }
  if (
    code === "empty" ||
    code === "no_data" ||
    code === "no-data" ||
    code === "not_found" ||
    code === "enoent"
  ) {
    return "empty";
  }

  const s = errText(err).toLowerCase();
  if (!s.trim()) return "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser|webview\s+only|requires\s+the\s+(tauri|desktop)/i.test(
      s,
    )
  ) {
    return "host_only";
  }
  if (
    /network|offline|fetch\s+failed|failed\s+to\s+fetch|econnrefused|enotfound|etimedout|timed?\s*out|dns|connection\s+(reset|refused|error)|socket/i.test(
      s,
    )
  ) {
    return "network";
  }
  if (
    /no\s+(activity|usage|sessions?|signals?|heatmap|data)|empty\s+(heatmap|usage|sessions?)|signals?\.json|~\.?\/\.grok\/sessions|sessions?\s+(dir|folder|path)\s+(missing|not\s+found)/i.test(
      s,
    )
  ) {
    return "empty";
  }

  return "other";
}

/**
 * Build soft-fail presentation for a heatmap load error.
 * All kinds soft-fail — never invent activity cells or quota.
 */
export function heatmapErrorView(err: unknown): HeatmapErrorView {
  const kind = classifyHeatmapError(err);
  const detail = errText(err).trim().slice(0, 280);
  return {
    kind,
    softFail: true,
    detail,
    titleKey: `account.heatmap.err.${kind}`,
    hintKey: `account.heatmap.err.${kind}Hint`,
  };
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/**
 * Contextual empty surfaces for the heatmap body.
 * - `loading` — status still fetching
 * - `error` — classified Host/network failure (soft-fail)
 * - `no_data` — loaded but no real activity samples
 * - `range_empty` — overall samples exist; selected day/week has none
 */
export type HeatmapEmptyKind = "loading" | "error" | "no_data" | "range_empty";

export type HeatmapEmptyState = {
  kind: HeatmapEmptyKind;
  /** Primary title i18n key under account.heatmap.*. */
  titleKey: string;
  /** Optional body / hint i18n key. */
  bodyKey: string | null;
  /**
   * Soft-fail chrome (warn chip) vs quiet empty.
   * loading / no_data / range_empty are quiet; error is soft-warn.
   */
  softFail: boolean;
  /** When kind === "error", the classified error view. */
  error: HeatmapErrorView | null;
  /** Offer clear-range CTA when a selected range is empty. */
  showClearRange: boolean;
};

export type HeatmapEmptyInput = {
  loading: boolean;
  /**
   * True when any day in the **full** heatmap has real activity.
   * Prefer {@link heatmapHasSamples}(days) — do not pass dayCount > 0 alone
   * (host pads empty calendar rows).
   */
  hasSamples: boolean;
  /**
   * Selected day/week range, if any.
   * When set and overall has samples but the range does not, → range_empty.
   */
  range?: HeatRange | null;
  /**
   * True when the selected range has activity.
   * Ignored when `range` is null. Prefer summarizing the range with
   * {@link summarizeHeatmapRange}.
   */
  rangeHasSamples?: boolean;
  /** Optional Host / account_status error (soft-fail). */
  error?: unknown;
};

/**
 * Resolve which empty surface to show for the heatmap body.
 * Returns `null` when the contribution grid should render (real samples,
 * and either no range or range has activity).
 *
 * Priority:
 * 1. loading → loading (only when no samples yet — keep grid on refresh)
 * 2. error + !hasSamples → error (soft-fail; never invent cells)
 * 3. !hasSamples → no_data
 * 4. range set + !rangeHasSamples → range_empty
 * 5. otherwise null (render grid; error chip may still show in chrome)
 *
 * Never invents activity cells or SuperGrok quota.
 */
export function resolveHeatmapEmptyState(
  opts: HeatmapEmptyInput,
): HeatmapEmptyState | null {
  const hasErr = opts.error != null && opts.error !== "";

  // Keep an existing grid visible while a background refresh is in flight.
  if (opts.loading && !opts.hasSamples) {
    return {
      kind: "loading",
      titleKey: "account.heatmap.loading",
      bodyKey: "account.heatmap.loadingHint",
      softFail: false,
      error: null,
      showClearRange: false,
    };
  }

  if (hasErr && !opts.hasSamples) {
    const view = heatmapErrorView(opts.error);
    return {
      kind: "error",
      titleKey: view.titleKey,
      bodyKey: view.hintKey,
      softFail: true,
      error: view,
      showClearRange: false,
    };
  }

  if (!opts.hasSamples) {
    return {
      kind: "no_data",
      titleKey: "account.heatmap.noData",
      bodyKey: "account.heatmap.noDataHint",
      softFail: true,
      error: null,
      showClearRange: false,
    };
  }

  const range = opts.range ?? null;
  if (range && opts.rangeHasSamples === false) {
    return {
      kind: "range_empty",
      titleKey: "account.heatmap.rangeEmpty",
      bodyKey: "account.heatmap.rangeEmptyHint",
      softFail: false,
      error: null,
      showClearRange: true,
    };
  }

  return null;
}

// ── Range chip presentation ──────────────────────────────────────────────────

/** Day / week / cumulative chips (Account heatmap toggle). */
export type HeatmapGranularity = "day" | "week" | "cumulative";

export type HeatmapGranularityChip = {
  id: HeatmapGranularity;
  /** i18n label key. */
  labelKey:
    | "account.heatmap.day"
    | "account.heatmap.week"
    | "account.heatmap.cumulative";
  active: boolean;
};

/** Ordered day · week · cumulative chips with active state. */
export function listHeatmapGranularityChips(
  active: HeatmapGranularity | null | undefined,
): HeatmapGranularityChip[] {
  const a: HeatmapGranularity =
    active === "week"
      ? "week"
      : active === "cumulative"
        ? "cumulative"
        : "day";
  return [
    {
      id: "day",
      labelKey: "account.heatmap.day",
      active: a === "day",
    },
    {
      id: "week",
      labelKey: "account.heatmap.week",
      active: a === "week",
    },
    {
      id: "cumulative",
      labelKey: "account.heatmap.cumulative",
      active: a === "cumulative",
    },
  ];
}

/**
 * Summary chip keys for the title meta row.
 * Returns null when empty calendar (caller hides total inventing "0 tokens"
 * as if it were SuperGrok quota).
 */
export type HeatmapSummaryChips = {
  /** i18n key with `{count}` for active days. */
  activeDaysKey: "account.heatmap.activeDays";
  activeDays: number;
  /** i18n key with `{count}` for total tokens (caller formats count). */
  totalTokensKey: "account.heatmap.totalTokens";
  totalTokens: number;
  /** i18n key with `{count}` for sessions/requests. */
  sessionsKey: "account.heatmap.sessionsCount";
  totalRequests: number;
};

/**
 * Build honest summary chips from a range summary.
 * Returns `null` when there is no activity (never invent quota-looking zeros).
 */
export function heatmapSummaryChips(
  summary: HeatmapRangeSummary,
): HeatmapSummaryChips | null {
  if (!summary.hasActivity) return null;
  return {
    activeDaysKey: "account.heatmap.activeDays",
    activeDays: summary.activeDays,
    totalTokensKey: "account.heatmap.totalTokens",
    totalTokens: summary.totalTokens,
    sessionsKey: "account.heatmap.sessionsCount",
    totalRequests: summary.totalRequests,
  };
}

/** Soft-fail error chip for the heatmap title row. */
export type HeatmapErrorChip = {
  kind: HeatmapErrorKind;
  titleKey: string;
  hintKey: string;
  softFail: true;
};

/**
 * Resolve an error chip for the heatmap chrome.
 * Returns `null` when there is no error.
 */
export function resolveHeatmapErrorChip(
  error: unknown,
): HeatmapErrorChip | null {
  if (error == null || error === "") return null;
  const view = heatmapErrorView(error);
  return {
    kind: view.kind,
    titleKey: view.titleKey,
    hintKey: view.hintKey,
    softFail: true,
  };
}
