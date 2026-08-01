/**
 * TRACE-HISTORY-PRO — pure helpers for session trace export history UX.
 *
 * Paths-only history (never archive contents). Filter chips · empty honesty ·
 * clear plan with count · size display · uploaded badge honesty.
 * Never invents sizes, remote URLs, or upload flags from paths alone.
 */

import {
  filterTraceHistory as filterTraceHistoryByQuery,
  formatTraceHistorySize,
  type TraceHistoryEntry,
} from "@/lib/traceHistory";

// ── Scope chips ──────────────────────────────────────────────────────────────

/** First-class scope chips for the traces list (All · Local · Uploaded). */
export type TraceHistoryScope = "all" | "local" | "uploaded";

/** Ordered chip list. */
export const TRACE_HISTORY_SCOPES: readonly TraceHistoryScope[] = [
  "all",
  "local",
  "uploaded",
] as const;

/** Combined free-text + upload-scope filter. */
export type TraceHistoryFilterOpts = {
  query?: string | null;
  /**
   * When true: only entries with `uploaded === true`.
   * When false: only local (not uploaded).
   * When undefined/null: no upload filter (same as scope `all`).
   * Prefer {@link scope} when both are set.
   */
  uploadedOnly?: boolean | null;
  /** Preferred chip scope; wins over `uploadedOnly` when set. */
  scope?: TraceHistoryScope | null;
};

/** Normalize chip scope from `scope` and/or `uploadedOnly`. */
export function normalizeTraceHistoryScope(
  scope?: TraceHistoryScope | string | null,
  uploadedOnly?: boolean | null,
): TraceHistoryScope {
  if (scope === "all" || scope === "local" || scope === "uploaded") {
    return scope;
  }
  if (uploadedOnly === true) return "uploaded";
  if (uploadedOnly === false) return "local";
  return "all";
}

/**
 * True when an entry matches a scope chip.
 * Uploaded badge honesty: only `uploaded === true` counts as uploaded —
 * never inferred from path or size.
 */
export function traceMatchesScope(
  entry: Pick<TraceHistoryEntry, "uploaded"> | null | undefined,
  scope: TraceHistoryScope | null | undefined,
): boolean {
  if (!entry) return false;
  const s = scope ?? "all";
  if (s === "all") return true;
  if (s === "uploaded") return entry.uploaded === true;
  // local
  return entry.uploaded !== true;
}

/**
 * Filter by free-text query and/or upload scope (AND).
 *
 * Accepts a string (query-only, backward-compatible) or
 * `{ query; uploadedOnly?; scope? }`. Does not invent rows.
 * Reuses base path/title/sessionId substring match for the query.
 */
export function filterTraceHistory(
  entries: readonly TraceHistoryEntry[],
  opts: TraceHistoryFilterOpts | string = {},
): TraceHistoryEntry[] {
  if (!entries?.length) return [];
  const filter: TraceHistoryFilterOpts =
    typeof opts === "string" ? { query: opts } : (opts ?? {});
  const scope = normalizeTraceHistoryScope(filter.scope, filter.uploadedOnly);

  let list: TraceHistoryEntry[] =
    scope === "all"
      ? [...entries]
      : entries.filter((e) => traceMatchesScope(e, scope));

  const q = (filter.query ?? "").trim();
  if (q) {
    list = filterTraceHistoryByQuery(list, q);
  }
  return list;
}

/**
 * True when scope chip or free-text narrows the list
 * (used for filter-empty honesty and clear-filters CTA).
 */
export function hasActiveTraceHistoryFilters(
  opts: TraceHistoryFilterOpts | string | null | undefined,
): boolean {
  if (opts == null) return false;
  if (typeof opts === "string") return opts.trim().length > 0;
  const scope = normalizeTraceHistoryScope(opts.scope, opts.uploadedOnly);
  return scope !== "all" || Boolean((opts.query ?? "").trim());
}

// ── Meta counts ──────────────────────────────────────────────────────────────

/** Per-chip counts; `total` is list length. */
export type TraceHistoryMetaCounts = {
  total: number;
  local: number;
  uploaded: number;
};

/**
 * Count uploaded vs local entries.
 * Uploaded only when `uploaded === true` — never invent from paths.
 */
export function countTraceHistoryMeta(
  entries: readonly TraceHistoryEntry[] | null | undefined,
): TraceHistoryMetaCounts {
  const list = Array.isArray(entries) ? entries : [];
  let uploaded = 0;
  for (const e of list) {
    if (e?.uploaded === true) uploaded += 1;
  }
  const total = list.length;
  return {
    total,
    uploaded,
    local: Math.max(0, total - uploaded),
  };
}

// ── Empty honesty ────────────────────────────────────────────────────────────

export type TraceHistoryEmptyKind = "empty" | "filter_empty";

export type TraceHistoryEmptyPresentation = {
  kind: TraceHistoryEmptyKind;
  /** Primary title i18n key under session.traces*. */
  titleKey: string;
  /** Optional hint i18n key. */
  hintKey: string | null;
  /** Offer clear-filters CTA. */
  showClearFilters: boolean;
};

export type TraceHistoryEmptyInput = {
  /** Total history rows (pre filter). */
  total: number;
  /** Visible rows after filters. */
  filtered: number;
  /** Status chip or free-text active (optional; inferred from query/scope). */
  hasFilters?: boolean;
  query?: string | null;
  scope?: TraceHistoryScope | null;
  uploadedOnly?: boolean | null;
};

/**
 * Resolve which empty surface to show for the traces list.
 * Returns `null` when filtered rows should render.
 *
 * Priority:
 * 1. filtered > 0 → null
 * 2. total == 0 → empty (export prompt)
 * 3. total > 0 + filters + filtered == 0 → filter_empty
 *
 * Never invents history when the ring buffer is empty.
 */
export function resolveTraceHistoryEmptyState(
  input: TraceHistoryEmptyInput,
): TraceHistoryEmptyPresentation | null {
  const total = Math.max(0, Math.floor(Number(input.total) || 0));
  const filtered = Math.max(0, Math.floor(Number(input.filtered) || 0));

  if (filtered > 0) return null;

  const hasFilters =
    input.hasFilters != null
      ? Boolean(input.hasFilters)
      : hasActiveTraceHistoryFilters({
          query: input.query,
          scope: input.scope,
          uploadedOnly: input.uploadedOnly,
        });

  if (total === 0) {
    return {
      kind: "empty",
      titleKey: "session.tracesEmpty",
      hintKey: "session.tracesEmptyHint",
      showClearFilters: false,
    };
  }

  if (hasFilters) {
    return {
      kind: "filter_empty",
      titleKey: "session.tracesEmptyFilter",
      hintKey: "session.tracesEmptyFilterHint",
      showClearFilters: true,
    };
  }

  // Total > 0 but filtered 0 without filters should not happen; soft fallback.
  return {
    kind: "empty",
    titleKey: "session.tracesEmpty",
    hintKey: "session.tracesEmptyHint",
    showClearFilters: false,
  };
}

// ── Clear plan ───────────────────────────────────────────────────────────────

/**
 * Plan a clear-all of the path list (does not delete archive files).
 * Callers open GlassModal when `confirmNeeded`, then apply via `clearTraceHistory`.
 */
export type ClearTraceHistoryPlan = {
  ok: true;
  count: number;
  /** True when the UI should open a confirm (count > 0). */
  confirmNeeded: boolean;
  /** Next list after clear (always empty). */
  next: TraceHistoryEntry[];
  /** Safe meta for logs / toasts — count only. */
  logMeta: { clearedCount: number } | null;
};

/**
 * Plan clear-all with honest count (paths only — never file I/O).
 */
export function planClearTraceHistory(
  entries: readonly TraceHistoryEntry[] | null | undefined,
): ClearTraceHistoryPlan {
  const count = Array.isArray(entries) ? entries.length : 0;
  return {
    ok: true,
    count,
    confirmNeeded: count > 0,
    next: [],
    logMeta: count > 0 ? { clearedCount: count } : null,
  };
}

// ── Size display ─────────────────────────────────────────────────────────────

/**
 * Human-readable size for list rows. Returns null when unknown —
 * never invents sizes from path or title.
 * Pure — B/KB/MB/GB unit abbreviations (no i18n).
 */
export function formatTraceSize(
  sizeBytes: number | null | undefined,
): string | null {
  return formatTraceHistorySize(sizeBytes);
}

// ── Chip / badge label keys ──────────────────────────────────────────────────

/** Label i18n key for a scope chip. */
export function traceHistoryScopeLabelKey(scope: TraceHistoryScope): string {
  switch (scope) {
    case "local":
      return "session.tracesFilter.local";
    case "uploaded":
      return "session.tracesFilter.uploaded";
    case "all":
    default:
      return "session.tracesFilter.all";
  }
}

/**
 * Whether the uploaded badge may render for a row.
 * Honest: only when the history flag is exactly true (CLI/host reported
 * upload success). Never from path patterns or non-empty size alone.
 */
export function shouldShowTraceUploadedBadge(
  entry: Pick<TraceHistoryEntry, "uploaded"> | null | undefined,
): boolean {
  return entry?.uploaded === true;
}
