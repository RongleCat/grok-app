/**
 * CLI-SESSIONS-SEARCH-PRO — pure helpers for Settings → CLI sessions:
 * linked/unlinked filter chips, ranked hit filter, empty honesty
 * (loading · searching · CLI missing · empty · filter/search empty),
 * classified soft-fail when CLI is missing, and import-selection honesty counts.
 *
 * Builds on `cliSessionsFilter` / `cliSessionsSearch`. No DOM / Tauri side effects.
 * Never invents CLI sessions.
 */

import {
  countUnlinkedCliSessions,
  filterCliSessions,
  type CliSessionFilterRow,
} from "@/lib/cliSessionsFilter";
import { looksLikeCliSearchUnsupported } from "@/lib/cliSessionsSearch";

// ── Filter chips ─────────────────────────────────────────────────────────────

/**
 * Link-state chip buckets for the CLI sessions list.
 * `all` = no link filter; `linked` / `unlinked` narrow by alreadyLinked.
 */
export type CliSessionsLinkFilter = "all" | "linked" | "unlinked";

/** Ordered chip list (All · Linked · Unlinked). */
export const CLI_SESSIONS_LINK_FILTERS: readonly CliSessionsLinkFilter[] = [
  "all",
  "linked",
  "unlinked",
] as const;

export const DEFAULT_CLI_SESSIONS_LINK_FILTER: CliSessionsLinkFilter = "all";

/** Per-chip counts; `all` is total length. */
export type CliSessionsLinkCounts = Record<CliSessionsLinkFilter, number>;

/** Count rows per link chip. */
export function countCliSessionsByLink(
  rows: readonly { alreadyLinked?: boolean | null }[],
): CliSessionsLinkCounts {
  const counts: CliSessionsLinkCounts = {
    all: rows.length,
    linked: 0,
    unlinked: 0,
  };
  for (const r of rows) {
    if (r.alreadyLinked) counts.linked += 1;
    else counts.unlinked += 1;
  }
  return counts;
}

/** Whether a row matches the link chip (`all` always matches). */
export function cliSessionMatchesLinkFilter(
  row: { alreadyLinked?: boolean | null } | null | undefined,
  filter: CliSessionsLinkFilter | null | undefined,
): boolean {
  if (!row) return false;
  const f = filter ?? "all";
  if (f === "all") return true;
  if (f === "linked") return !!row.alreadyLinked;
  return !row.alreadyLinked;
}

/** Filter by link chip only. */
export function filterCliSessionsByLink<
  T extends { alreadyLinked?: boolean | null },
>(rows: readonly T[], filter: CliSessionsLinkFilter | null | undefined): T[] {
  const f = filter ?? "all";
  if (f === "all") return rows as T[];
  return rows.filter((r) => cliSessionMatchesLinkFilter(r, f));
}

/** Combined free-text + link chip filter. */
export interface CliSessionsListFilter {
  query?: string | null;
  link?: CliSessionsLinkFilter | null;
}

/**
 * True when free-text or link chip narrows the list
 * (used for filter-empty honesty and clear-filters CTA).
 */
export function hasActiveCliSessionsFilters(
  filter: CliSessionsListFilter | null | undefined,
): boolean {
  if (!filter) return false;
  const link = filter.link ?? "all";
  const q = (filter.query ?? "").trim();
  return link !== "all" || q.length > 0;
}

// ── Filter + rank ────────────────────────────────────────────────────────────

/** Match tier for ranking (higher = better). */
export type CliSessionHitMatchTier =
  | "title_exact"
  | "title_prefix"
  | "title"
  | "id"
  | "prompt"
  | "cwd"
  | "none";

const TIER_SCORE: Record<CliSessionHitMatchTier, number> = {
  title_exact: 100,
  title_prefix: 80,
  title: 60,
  id: 50,
  prompt: 40,
  cwd: 30,
  none: 0,
};

/**
 * Best match tier for one row against a free-text query.
 * Empty query → `"none"` (caller should not re-rank).
 */
export function scoreCliSessionHit(
  row: CliSessionFilterRow,
  query: string,
): { tier: CliSessionHitMatchTier; score: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { tier: "none", score: 0 };

  const title = (row.title ?? "").toLowerCase();
  if (title === q) return { tier: "title_exact", score: TIER_SCORE.title_exact };
  if (title.startsWith(q)) {
    return { tier: "title_prefix", score: TIER_SCORE.title_prefix };
  }
  if (title.includes(q)) return { tier: "title", score: TIER_SCORE.title };

  const id = (row.agentSessionId ?? "").toLowerCase();
  if (id.includes(q)) return { tier: "id", score: TIER_SCORE.id };

  const prompt = (row.firstPrompt ?? "").toLowerCase();
  if (prompt && prompt.includes(q)) {
    return { tier: "prompt", score: TIER_SCORE.prompt };
  }

  const cwd = (row.cwd ?? "").toLowerCase();
  if (cwd && cwd.includes(q)) return { tier: "cwd", score: TIER_SCORE.cwd };

  return { tier: "none", score: 0 };
}

/**
 * Rank hits by match quality (title > id > first prompt > cwd).
 * Empty/whitespace query preserves input order.
 * Stable: equal scores keep original relative order.
 * Never invents rows.
 */
export function rankCliSessionHits<T extends CliSessionFilterRow>(
  rows: readonly T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q || rows.length <= 1) return rows as T[];

  return rows
    .map((row, index) => ({
      row,
      index,
      score: scoreCliSessionHit(row, q).score,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

/**
 * Filter CLI session hits by free-text + link chip, then rank by match quality.
 *
 * - Empty query + link `all` → all rows (input order).
 * - Free-text uses {@link filterCliSessions} (title / id / cwd / firstPrompt).
 * - Link chip AND free-text.
 * - Non-empty query re-ranks matches (never invents sessions).
 */
export function filterCliSessionHits<
  T extends CliSessionFilterRow & { alreadyLinked?: boolean | null },
>(rows: readonly T[], filter: CliSessionsListFilter | string = {}): T[] {
  const opts: CliSessionsListFilter =
    typeof filter === "string" ? { query: filter } : (filter ?? {});
  const q = (opts.query ?? "").trim();
  let out = filterCliSessionsByLink(rows, opts.link ?? "all") as T[];
  if (q) {
    out = filterCliSessions(out, q) as T[];
    out = rankCliSessionHits(out, q);
  }
  return out;
}

// ── Empty honesty ────────────────────────────────────────────────────────────

/** Contextual empty surfaces for the CLI sessions list body. */
export type CliSessionsEmptyKind =
  | "loading"
  | "searching"
  | "cli_missing"
  | "error"
  | "empty"
  | "filter_empty"
  | "search_empty";

export type CliSessionsEmptyTitleKey =
  | "settings.cliSessionsLoading"
  | "settings.cliSessionsSearching"
  | "settings.cliSessionsEmptyCliMissing"
  | "settings.cliSessionsEmpty"
  | "settings.cliSessionsFilterEmpty"
  | "settings.cliSessionsSearchEmpty"
  | "settings.cliSessionsEmptyError";

export type CliSessionsEmptyHintKey =
  | "settings.cliSessionsEmptyCliMissingHint"
  | "settings.cliSessionsEmptyHint"
  | "settings.cliSessionsFilterEmptyHint"
  | "settings.cliSessionsSearchEmptyHint"
  | "settings.cliSessionsEmptyErrorHint";

export type CliSessionsEmptyPresentation = {
  kind: CliSessionsEmptyKind;
  titleKey: CliSessionsEmptyTitleKey;
  hintKey: CliSessionsEmptyHintKey | null;
  /** Offer clear-filters CTA (query and/or link chip). */
  showClearFilters: boolean;
  /**
   * Soft-fail empty (CLI missing / capability gap) vs hard empty catalog.
   * UI should not escalate soft-fail to a crash banner.
   */
  softFail: boolean;
  /** Classified error kind when kind === "error" or "cli_missing". */
  errorKind?: CliSessionsSearchErrorKind | null;
};

export type CliSessionsEmptyInput = {
  loading?: boolean;
  /** Host CLI search in flight. */
  searching?: boolean;
  /**
   * Whether Grok Build CLI was found on PATH / configured path.
   * `false` → soft-fail empty when the list is empty (no invented sessions).
   * Omitted / `true` → normal empty catalog.
   */
  cliFound?: boolean | null;
  /** Free-text query (trim inside). */
  query?: string | null;
  /** Visible row count after filters / host search. */
  resultCount: number;
  /**
   * Unfiltered list size from host list (pre query/chip).
   * Defaults to `resultCount` when omitted.
   */
  totalCount?: number;
  /** Link chip; default `all`. */
  linkFilter?: CliSessionsLinkFilter | null;
  /** List or search error string. */
  error?: string | null;
};

/**
 * Resolve which empty surface to show for the CLI sessions list.
 * Returns `null` when filtered rows should render.
 *
 * Priority:
 * 1. resultCount > 0 → null
 * 2. loading + total == 0 → loading
 * 3. searching + filters + no rows → searching
 * 4. error + total == 0 → error (classified; soft when capability gap)
 * 5. cliFound === false + total == 0 → cli_missing soft-fail
 * 6. total == 0 → empty catalog
 * 7. filters + no visible rows → filter_empty / search_empty + clear CTA
 *
 * Never invents sessions when CLI is missing or list is empty.
 */
export function resolveCliSessionsEmptyState(
  input: CliSessionsEmptyInput,
): CliSessionsEmptyPresentation | null {
  const resultCount = Math.max(0, Number(input.resultCount) || 0);
  if (resultCount > 0) return null;

  const total =
    input.totalCount != null
      ? Math.max(0, Number(input.totalCount) || 0)
      : resultCount;
  const loading = Boolean(input.loading);
  const searching = Boolean(input.searching);
  const q = (input.query ?? "").trim();
  const link = input.linkFilter ?? "all";
  const filtersActive = hasActiveCliSessionsFilters({ query: q, link });
  const err = (input.error ?? "").trim();
  const cliFound = input.cliFound;

  if (loading && total === 0) {
    return {
      kind: "loading",
      titleKey: "settings.cliSessionsLoading",
      hintKey: null,
      showClearFilters: false,
      softFail: true,
    };
  }

  if (searching && filtersActive && resultCount === 0) {
    return {
      kind: "searching",
      titleKey: "settings.cliSessionsSearching",
      hintKey: null,
      showClearFilters: false,
      softFail: true,
    };
  }

  if (err && total === 0 && !loading) {
    const classified = classifyCliSessionsSearchError(err);
    return {
      kind: "error",
      titleKey: "settings.cliSessionsEmptyError",
      hintKey: "settings.cliSessionsEmptyErrorHint",
      showClearFilters: false,
      softFail: classified.softFail,
      errorKind: classified.kind,
    };
  }

  // Soft-fail when CLI is known missing and we have no on-disk rows.
  // Local list may still work without CLI; only show when truly empty.
  if (cliFound === false && total === 0 && !loading) {
    return {
      kind: "cli_missing",
      titleKey: "settings.cliSessionsEmptyCliMissing",
      hintKey: "settings.cliSessionsEmptyCliMissingHint",
      showClearFilters: false,
      softFail: true,
      errorKind: "cli_missing",
    };
  }

  if (!loading && total === 0) {
    return {
      kind: "empty",
      titleKey: "settings.cliSessionsEmpty",
      hintKey: "settings.cliSessionsEmptyHint",
      showClearFilters: false,
      softFail: false,
    };
  }

  if (!loading && total > 0 && resultCount === 0 && filtersActive) {
    // Link chip alone (or with query) → filter empty; query alone → search empty.
    if (link !== "all") {
      return {
        kind: "filter_empty",
        titleKey: "settings.cliSessionsFilterEmpty",
        hintKey: "settings.cliSessionsFilterEmptyHint",
        showClearFilters: true,
        softFail: false,
      };
    }
    return {
      kind: "search_empty",
      titleKey: "settings.cliSessionsSearchEmpty",
      hintKey: "settings.cliSessionsSearchEmptyHint",
      showClearFilters: true,
      softFail: false,
    };
  }

  return null;
}

// ── Error classification ─────────────────────────────────────────────────────

/** Stable soft-fail kinds for CLI sessions list / search host errors. */
export type CliSessionsSearchErrorKind =
  | "cli_missing"
  | "cli_unsupported"
  | "timeout"
  | "host_only"
  | "permission"
  | "other";

export type CliSessionsSearchErrorView = {
  kind: CliSessionsSearchErrorKind;
  /** Soft-fail: capability gap — warn, do not escalate. */
  softFail: boolean;
  /** Redacted / truncated detail for UI (never invents success). */
  detail: string;
  /** i18n title key under settings.cliSessions.err.*. */
  titleKey: string;
  /** i18n hint key under settings.cliSessions.err.*. */
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

/**
 * Classify a CLI sessions list / search host error for soft-fail presentation.
 */
export function classifyCliSessionsSearchError(
  err: unknown,
): CliSessionsSearchErrorView {
  const raw = errText(err);
  const detail = raw.trim().slice(0, 400);
  const s = raw.toLowerCase();

  let kind: CliSessionsSearchErrorKind = "other";

  if (
    /need[_\s-]?tauri|desktop\s+app|host[_\s-]?only|not\s+available\s+in\s+browser/i.test(
      s,
    )
  ) {
    kind = "host_only";
  } else if (
    /cli[_\s-]?missing|grok\s+build\s+(cli\s+)?not\s+found|cli\s+not\s+found|command\s+not\s+found|enoent|no\s+such\s+file|not\s+found\s+on\s+path|failed\s+to\s+run\s+grok/i.test(
      s,
    ) ||
    (s.includes("not found") && (s.includes("cli") || s.includes("grok")))
  ) {
    kind = "cli_missing";
  } else if (
    looksLikeCliSearchUnsupported(raw) ||
    /cli[_\s-]?too[_\s-]?old|unsupported\s+cli|unknown\s+(flag|option|command).*session|unrecognized\s+subcommand.*session|requires?\s+cli/i.test(
      s,
    )
  ) {
    kind = "cli_unsupported";
  } else if (/timed?\s*out|timeout/i.test(s)) {
    kind = "timeout";
  } else if (
    /permission\s+denied|eacces|access\s+denied|operation\s+not\s+permitted/i.test(
      s,
    )
  ) {
    kind = "permission";
  } else if (raw.trim()) {
    kind = "other";
  }

  const softFail =
    kind === "cli_missing" ||
    kind === "cli_unsupported" ||
    kind === "host_only" ||
    kind === "timeout";

  return {
    kind,
    softFail,
    detail,
    titleKey: `settings.cliSessions.err.${kind}`,
    hintKey: `settings.cliSessions.err.${kind}Hint`,
  };
}

/** Whether an error string should soft-fail (capability gap). */
export function isCliSessionsSearchSoftFailError(
  err: string | null | undefined,
): boolean {
  if (!(err ?? "").trim()) return false;
  return classifyCliSessionsSearchError(err).softFail;
}

// ── Import selection honesty ─────────────────────────────────────────────────

export type CliSessionImportableRow = {
  agentSessionId: string;
  alreadyLinked?: boolean | null;
  /** On-disk session folder; empty/missing → remote-only (cannot delete locally). */
  dir?: string | null;
  title?: string | null;
};

/**
 * Honest counts for bulk import / delete selection.
 * Never invents importable rows — only counts what the list actually has.
 *
 * - `selected` — input length
 * - `importable` — not already linked (will attempt import)
 * - `alreadyLinked` — skip on import-all (open path only)
 * - `remoteOnly` — no on-disk `dir` (delete disabled; import may still work via id)
 * - `deletable` — unlinked with a local `dir`
 * - `skipped` — already linked (same as alreadyLinked; alias for CTA copy)
 */
export type CliSessionsImportPlan = {
  selected: number;
  importable: number;
  alreadyLinked: number;
  remoteOnly: number;
  deletable: number;
  skipped: number;
  /** True when import-all would attempt at least one import. */
  hasImportable: boolean;
  /** True when delete-unlinked would attempt at least one delete. */
  hasDeletable: boolean;
};

/**
 * Plan honesty counts for the current selection (usually full list or filtered).
 * Empty input → zero counts; never fabricates sessions.
 */
export function planImportSelection(
  rows: readonly CliSessionImportableRow[] | null | undefined,
): CliSessionsImportPlan {
  const list = rows ?? [];
  let importable = 0;
  let alreadyLinked = 0;
  let remoteOnly = 0;
  let deletable = 0;

  for (const r of list) {
    const linked = !!r.alreadyLinked;
    const hasDir = !!(r.dir ?? "").trim();
    if (linked) {
      alreadyLinked += 1;
    } else {
      importable += 1;
      if (hasDir) deletable += 1;
    }
    if (!hasDir) remoteOnly += 1;
  }

  return {
    selected: list.length,
    importable,
    alreadyLinked,
    remoteOnly,
    deletable,
    skipped: alreadyLinked,
    hasImportable: importable > 0,
    hasDeletable: deletable > 0,
  };
}

/**
 * Stable i18n key for a link chip label.
 */
export function cliSessionsLinkFilterLabelKey(
  filter: CliSessionsLinkFilter,
):
  | "settings.cliSessions.filterAll"
  | "settings.cliSessions.filterLinked"
  | "settings.cliSessions.filterUnlinked" {
  switch (filter) {
    case "linked":
      return "settings.cliSessions.filterLinked";
    case "unlinked":
      return "settings.cliSessions.filterUnlinked";
    case "all":
    default:
      return "settings.cliSessions.filterAll";
  }
}

/** Re-export for callers that only need the unlinked count helper. */
export { countUnlinkedCliSessions };
