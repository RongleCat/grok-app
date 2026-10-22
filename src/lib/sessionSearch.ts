/** Pure helpers for the sidebar / command-palette search. */

import { caseInsensitiveSpans } from "./caseFoldIndex";

export type SearchableSession = {
  id: string;
  title: string;
  projectId?: string | null;
  archived?: boolean;
};

export type SearchableProject = {
  id: string;
  name: string;
  path: string;
};

/** Content hit from journal scan (`sessions_search`). */
export type SessionContentHit = {
  id: string;
  title: string;
  projectId?: string | null;
  snippet: string;
  matchCount: number;
  updatedAt?: string;
  archived?: boolean;
};

export type SessionSearchHits = {
  matchedSessions: SearchableSession[];
  matchedProjects: SearchableProject[];
};

/**
 * Keyword hybrid search scope (no embeddings).
 * - `all` — title/project + message content (default hybrid)
 * - `title` — session title / id / project only; skip journal scan
 * - `content` — message body only; prefer content ranking
 */
export type SessionSearchMode = "all" | "title" | "content";

export const SESSION_SEARCH_MODES: readonly SessionSearchMode[] = [
  "all",
  "title",
  "content",
] as const;

export const DEFAULT_SESSION_SEARCH_MODE: SessionSearchMode = "all";

/**
 * Ranking strategy for session search.
 * - `keyword` — substring match only (default; stable order)
 * - `hybrid` — keyword + lightweight token-overlap ranking on titles/snippets
 *
 * Honest local hybrid only — no cloud embeddings / embedding API.
 */
export type SessionSearchRankMode = "keyword" | "hybrid";

export const SESSION_SEARCH_RANK_MODES: readonly SessionSearchRankMode[] = [
  "keyword",
  "hybrid",
] as const;

export const DEFAULT_SESSION_SEARCH_RANK_MODE: SessionSearchRankMode =
  "keyword";

/** Default for include-archived chip (off = live sessions only). */
export const DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED = false;

export type SessionSearchFilterOpts = {
  maxSessions?: number;
  maxProjects?: number;
  includeArchived?: boolean;
  mode?: SessionSearchMode;
  /** Ranking / match expansion mode. Default `keyword`. */
  rankMode?: SessionSearchRankMode;
};

export type SessionSearchMergeOpts = {
  maxSessions?: number;
  includeArchived?: boolean;
  mode?: SessionSearchMode;
  /** Re-rank merged rows when `hybrid`. Default `keyword`. */
  rankMode?: SessionSearchRankMode;
};

/** Palette row: title/project hit and/or content match. */
export type MergedSessionHit = {
  id: string;
  title: string;
  projectId?: string | null;
  /** First content snippet when the journal matched. */
  snippet?: string;
  matchCount?: number;
  /** True when title/id/project matched the query. */
  titleMatch: boolean;
  /** True when message body matched. */
  contentMatch: boolean;
  archived?: boolean;
  /** Optional score when hybrid ranking is active (higher = better). */
  score?: number;
};

/** Compact badge kind for a merged row (UI labels via i18n). */
export type SessionSearchBadge = "title" | "content" | "both";

/**
 * Whether the UI should invoke `sessions_search` for this query + mode.
 * Title-only mode skips the journal scan; empty query never scans.
 */
export function shouldScanSessionContent(
  query: string,
  mode: SessionSearchMode = "all",
): boolean {
  if (mode === "title") return false;
  return query.trim().length > 0;
}

/**
 * Badge kind from match flags. Null when neither (e.g. empty-query recents).
 */
export function sessionSearchBadge(
  hit: Pick<MergedSessionHit, "titleMatch" | "contentMatch">,
): SessionSearchBadge | null {
  if (hit.titleMatch && hit.contentMatch) return "both";
  if (hit.titleMatch) return "title";
  if (hit.contentMatch) return "content";
  return null;
}

/**
 * Stable i18n message key for a search badge.
 * Callers pass the key to `tr()` / `t()`.
 */
export function sessionSearchBadgeLabelKey(
  badge: SessionSearchBadge,
): "search.badgeTitle" | "search.badgeContent" | "search.badgeBoth" {
  switch (badge) {
    case "title":
      return "search.badgeTitle";
    case "content":
      return "search.badgeContent";
    case "both":
      return "search.badgeBoth";
  }
}

/**
 * Parse / normalize a rank mode. Invalid → keyword.
 */
export function parseSessionSearchRankMode(
  raw: unknown,
): SessionSearchRankMode {
  if (raw === "hybrid" || raw === "semantic" || raw === "token") {
    return "hybrid";
  }
  return "keyword";
}

/**
 * Parse / normalize a search mode. Invalid → all.
 */
export function parseSessionSearchMode(raw: unknown): SessionSearchMode {
  if (raw === "title" || raw === "content" || raw === "all") return raw;
  return DEFAULT_SESSION_SEARCH_MODE;
}

/** Stable i18n key for a mode chip label. */
export function sessionSearchModeLabelKey(
  mode: SessionSearchMode,
): "search.modeAll" | "search.modeTitle" | "search.modeContent" {
  switch (mode) {
    case "title":
      return "search.modeTitle";
    case "content":
      return "search.modeContent";
    case "all":
    default:
      return "search.modeAll";
  }
}

/** Stable i18n key for a rank-mode chip label. */
export function sessionSearchRankModeLabelKey(
  mode: SessionSearchRankMode,
): "search.rankKeyword" | "search.rankHybrid" {
  return mode === "hybrid" ? "search.rankHybrid" : "search.rankKeyword";
}

/**
 * Palette filter chip state (scope + archived). Rank mode is a separate pref.
 * Query is free text and not considered a "filter chip" for clear-filters.
 */
export type SessionSearchFilterState = {
  mode: SessionSearchMode;
  includeArchived: boolean;
};

export function defaultSessionSearchFilterState(): SessionSearchFilterState {
  return {
    mode: DEFAULT_SESSION_SEARCH_MODE,
    includeArchived: DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED,
  };
}

/**
 * Whether non-default scope chips are active.
 * - mode other than `all` narrows the search
 * - includeArchived expands to archived sessions (non-default, still "active")
 */
export function hasActiveSessionSearchFilters(
  state: Partial<SessionSearchFilterState> | undefined,
): boolean {
  if (!state) return false;
  const mode = state.mode ?? DEFAULT_SESSION_SEARCH_MODE;
  const includeArchived =
    state.includeArchived ?? DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED;
  if (mode !== DEFAULT_SESSION_SEARCH_MODE) return true;
  if (includeArchived !== DEFAULT_SESSION_SEARCH_INCLUDE_ARCHIVED) return true;
  return false;
}

/** Reset scope chips to defaults (does not touch query or rank mode). */
export function clearSessionSearchFilters(): SessionSearchFilterState {
  return defaultSessionSearchFilterState();
}

/**
 * Empty-state kinds for the chats list in the command palette.
 * `null` means there are session hits — no empty UI.
 */
export type SessionSearchEmptyKind =
  | "idle"
  | "loading"
  | "no_matches"
  | "filtered";

export type SessionSearchEmptyInput = {
  query: string;
  /** Merged session hit count for the chats section. */
  sessionHitCount: number;
  contentLoading: boolean;
  mode: SessionSearchMode;
  includeArchived: boolean;
  rankMode: SessionSearchRankMode;
};

export type SessionSearchEmptyTitleKey =
  | "search.noRecent"
  | "search.searchingContent"
  | "search.noMatches";

export type SessionSearchEmptyHintKey =
  | "search.noRecentHint"
  | "search.searchingContentHint"
  | "search.noMatchesHintTitle"
  | "search.noMatchesHintContent"
  | "search.noMatchesHintKeyword"
  | "search.noMatchesHintHybrid"
  | "search.noMatchesHintArchived";

export type SessionSearchEmptyPresentation = {
  kind: SessionSearchEmptyKind;
  titleKey: SessionSearchEmptyTitleKey;
  hintKey: SessionSearchEmptyHintKey;
  /** Offer "Clear filters" when scope chips are non-default. */
  showClearFilters: boolean;
};

/**
 * Resolve empty-state presentation for the palette chats section.
 * Returns `null` when there are session hits (no empty UI).
 *
 * Honest local search only — hints never claim cloud embeddings.
 */
export function resolveSessionSearchEmptyState(
  input: SessionSearchEmptyInput,
): SessionSearchEmptyPresentation | null {
  if (input.sessionHitCount > 0) return null;

  const q = input.query.trim();
  const mode = parseSessionSearchMode(input.mode);
  const rankMode = parseSessionSearchRankMode(input.rankMode);
  const includeArchived = !!input.includeArchived;
  const filtersActive = hasActiveSessionSearchFilters({
    mode,
    includeArchived,
  });

  if (!q) {
    return {
      kind: "idle",
      titleKey: "search.noRecent",
      hintKey: "search.noRecentHint",
      showClearFilters: filtersActive,
    };
  }

  if (
    input.contentLoading &&
    shouldScanSessionContent(q, mode)
  ) {
    return {
      kind: "loading",
      titleKey: "search.searchingContent",
      hintKey: "search.searchingContentHint",
      showClearFilters: false,
    };
  }

  if (mode === "title") {
    return {
      kind: "filtered",
      titleKey: "search.noMatches",
      hintKey: "search.noMatchesHintTitle",
      showClearFilters: true,
    };
  }

  if (mode === "content") {
    return {
      kind: "filtered",
      titleKey: "search.noMatches",
      hintKey: "search.noMatchesHintContent",
      showClearFilters: true,
    };
  }

  // mode === "all"
  if (includeArchived) {
    // Already expanded archived; rank-based hint.
    return {
      kind: "filtered",
      titleKey: "search.noMatches",
      hintKey:
        rankMode === "keyword"
          ? "search.noMatchesHintKeyword"
          : "search.noMatchesHintHybrid",
      showClearFilters: true,
    };
  }

  // Default filters: soft hint to try archived when keyword/hybrid still empty.
  if (rankMode === "keyword") {
    return {
      kind: "no_matches",
      titleKey: "search.noMatches",
      hintKey: "search.noMatchesHintKeyword",
      showClearFilters: false,
    };
  }

  return {
    kind: "no_matches",
    titleKey: "search.noMatches",
    // Hybrid already on → suggest archived as next step.
    hintKey: "search.noMatchesHintArchived",
    showClearFilters: false,
  };
}

/** Tiny English stop set — not a full NLP pipeline. */
const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "it",
  "at",
  "by",
  "as",
  "be",
  "with",
]);

/**
 * Tokenize free text for lightweight overlap ranking.
 * Lowercases, splits on non-alphanumeric (CJK ideographs as single tokens).
 */
export function tokenizeSearchText(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  // Letters/digits runs; CJK ideographs as individual tokens for better overlap.
  const parts = lower.match(/[a-z0-9]+|[\u3400-\u9fff\uf900-\ufaff]/g);
  if (!parts) return [];
  // Drop ultra-short / stopword latin noise (keep CJK singles).
  return parts.filter((t) => {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(t)) return true;
    if (t.length < 2) return false;
    if (SEARCH_STOPWORDS.has(t)) return false;
    return true;
  });
}

/**
 * Fraction of query tokens that appear in `text` (recall over query tokens).
 * Returns 0..1. Empty query tokens → 0.
 */
export function tokenOverlapScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const hay = text.toLowerCase();
  if (!hay) return 0;
  let hits = 0;
  for (const t of queryTokens) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / queryTokens.length;
}

/**
 * Score a candidate row for hybrid ranking (higher is better).
 * Keyword mode callers typically skip sorting by this.
 *
 * Weights (local heuristic only — not embeddings):
 * - full phrase in title/id
 * - token recall on title / snippet
 * - content match count
 */
export function scoreSessionSearchHit(
  query: string,
  hit: {
    title: string;
    id?: string;
    snippet?: string;
    titleMatch?: boolean;
    contentMatch?: boolean;
    matchCount?: number;
  },
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const tokens = tokenizeSearchText(q);
  const title = hit.title ?? "";
  const titleLower = title.toLowerCase();
  const idLower = (hit.id ?? "").toLowerCase();
  const snippet = hit.snippet ?? "";
  const snippetLower = snippet.toLowerCase();

  let score = 0;

  if (titleLower.includes(q)) score += 100;
  if (idLower.includes(q)) score += 40;

  score += tokenOverlapScore(tokens, title) * 45;
  if (snippet) {
    if (snippetLower.includes(q)) score += 20;
    score += tokenOverlapScore(tokens, snippet) * 30;
  }

  if (hit.titleMatch) score += 5;
  if (hit.contentMatch) {
    score += 10;
    score += Math.min(hit.matchCount ?? 0, 10);
  }

  return score;
}

/** True when free text matches query under the given rank mode. */
function textMatchesQuery(
  text: string,
  qLower: string,
  tokens: string[],
  rankMode: SessionSearchRankMode,
): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(qLower)) return true;
  if (rankMode !== "hybrid") return false;
  // Hybrid expands recall: any significant query token is enough to include.
  return tokens.some((t) => lower.includes(t));
}

/**
 * Filter sessions and projects by a free-text query.
 * Matches session title / id, and project name / path.
 * When a query matches a project, its sessions are also included.
 *
 * Mode:
 * - `content` + non-empty query → no title/project session hits (content merge only)
 * - `title` / `all` → normal title/project matching
 * Empty query always returns recent items (respecting includeArchived).
 *
 * With `rankMode: "hybrid"`, matching expands to per-token includes and
 * sessions are sorted by lightweight token-overlap score (title).
 */
export function filterSessionSearch(
  query: string,
  sessions: SearchableSession[],
  projects: SearchableProject[],
  opts?: SessionSearchFilterOpts,
): SessionSearchHits {
  const maxSessions = opts?.maxSessions ?? 20;
  const maxProjects = opts?.maxProjects ?? 10;
  const includeArchived = opts?.includeArchived ?? false;
  const mode: SessionSearchMode = opts?.mode ?? "all";
  const rankMode: SessionSearchRankMode =
    opts?.rankMode ?? DEFAULT_SESSION_SEARCH_RANK_MODE;

  const live = includeArchived
    ? sessions
    : sessions.filter((s) => !s.archived);

  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      matchedSessions: live.slice(0, Math.min(12, maxSessions)),
      matchedProjects: projects.slice(0, Math.min(6, maxProjects)),
    };
  }

  // Content-only mode: title/project filters stay empty; content hits fill the list.
  if (mode === "content") {
    return { matchedSessions: [], matchedProjects: [] };
  }

  const tokens = tokenizeSearchText(q);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const matchedProjects = projects
    .filter(
      (p) =>
        textMatchesQuery(p.name, q, tokens, rankMode) ||
        textMatchesQuery(p.path, q, tokens, rankMode),
    )
    .slice(0, maxProjects);
  const matchedProjectIds = new Set(matchedProjects.map((p) => p.id));

  let matchedSessions = live.filter((s) => {
    if (
      textMatchesQuery(s.title, q, tokens, rankMode) ||
      textMatchesQuery(s.id, q, tokens, rankMode)
    ) {
      return true;
    }
    if (s.projectId && matchedProjectIds.has(s.projectId)) {
      return true;
    }
    // Also match project name even if project list itself is full.
    if (s.projectId) {
      const p = projectById.get(s.projectId);
      if (
        p &&
        (textMatchesQuery(p.name, q, tokens, rankMode) ||
          textMatchesQuery(p.path, q, tokens, rankMode))
      ) {
        return true;
      }
    }
    return false;
  });

  if (rankMode === "hybrid") {
    matchedSessions = matchedSessions
      .slice()
      .sort(
        (a, b) =>
          scoreSessionSearchHit(q, { title: b.title, id: b.id, titleMatch: true }) -
          scoreSessionSearchHit(q, { title: a.title, id: a.id, titleMatch: true }),
      );
  }

  return {
    matchedSessions: matchedSessions.slice(0, maxSessions),
    matchedProjects,
  };
}

/**
 * Pure content matcher: case-insensitive substring over user/assistant texts.
 * Returns match count (messages that hit) and a short snippet from the first hit.
 * Used for unit tests; runtime search scans on the host via `sessions_search`.
 */
export function matchMessageContent(
  query: string,
  messages: Array<{ role: string; content: string }>,
  opts?: { snippetRadius?: number; snippetMax?: number },
): { matchCount: number; snippet: string } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const radius = opts?.snippetRadius ?? 48;
  const maxLen = opts?.snippetMax ?? 120;
  let matchCount = 0;
  let snippet: string | undefined;

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = m.content ?? "";
    if (!content) continue;
    const span = caseInsensitiveSpans(content, q)[0];
    if (!span) continue;
    matchCount += 1;
    if (snippet === undefined) {
      snippet = makeContentSnippet(
        content,
        span.start,
        span.end - span.start,
        radius,
        maxLen,
      );
    }
  }

  if (matchCount === 0) return null;
  return { matchCount, snippet: snippet ?? "" };
}

/** Single-line snippet around a match index (character-based). */
export function makeContentSnippet(
  content: string,
  matchIndex: number,
  matchLen: number,
  radius = 48,
  maxLen = 120,
): string {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(content.length, matchIndex + matchLen + radius + 16);
  let slice = content.slice(start, end);
  if (start > 0) slice = `…${slice}`;
  if (end < content.length) slice = `${slice}…`;
  const collapsed = slice.split(/\s+/).filter(Boolean).join(" ");
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Merge title/project hits with journal content hits for the palette.
 *
 * Mode:
 * - `all` (default) — title matches first; content-only rows append
 * - `title` — ignore content hits entirely
 * - `content` — content hits first (by matchCount); no title-only rows
 *
 * Empty query → title list only (recents), no content-only rows.
 * Title matches first; content-only rows append. Empty query → title list only.
 *
 * With `rankMode: "hybrid"`, re-ranks the merged list by token-overlap score on
 * title + snippet (still local keyword hybrid — no embeddings).
 */
export function mergeSessionSearchHits(
  query: string,
  titleHits: SearchableSession[],
  contentHits: SessionContentHit[],
  opts?: SessionSearchMergeOpts,
): MergedSessionHit[] {
  const maxSessions = opts?.maxSessions ?? 20;
  const includeArchived = opts?.includeArchived ?? false;
  const mode: SessionSearchMode = opts?.mode ?? "all";
  const rankMode: SessionSearchRankMode =
    opts?.rankMode ?? DEFAULT_SESSION_SEARCH_RANK_MODE;
  const q = query.trim();

  const contentById = new Map<string, SessionContentHit>();
  if (mode !== "title") {
    for (const h of contentHits) {
      if (!includeArchived && h.archived) continue;
      contentById.set(h.id, h);
    }
  }

  const out: MergedSessionHit[] = [];
  const seen = new Set<string>();

  if (mode === "content" && q) {
    // Prefer content: higher match counts first; no title-only rows.
    const ranked = contentHits
      .filter((h) => includeArchived || !h.archived)
      .slice()
      .sort((a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0));

    for (const h of ranked) {
      if (seen.has(h.id)) continue;
      // Title match flag when the same id also appeared in titleHits (rare in content mode).
      const titleHit = titleHits.find((s) => s.id === h.id);
      out.push({
        id: h.id,
        title: h.title || titleHit?.title || "",
        projectId: h.projectId ?? titleHit?.projectId,
        snippet: h.snippet,
        matchCount: h.matchCount,
        titleMatch: !!titleHit,
        contentMatch: true,
        archived: h.archived ?? titleHit?.archived,
      });
      seen.add(h.id);
      if (out.length >= maxSessions) break;
    }
    return out;
  }

  // title / all: title hits first (with optional content snippets).
  for (const s of titleHits) {
    if (!includeArchived && s.archived) continue;
    const c = mode === "title" ? undefined : contentById.get(s.id);
    out.push({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      snippet: c?.snippet,
      matchCount: c?.matchCount,
      titleMatch: q.length > 0,
      contentMatch: !!c,
      archived: s.archived,
    });
    seen.add(s.id);
    if (out.length >= maxSessions && rankMode !== "hybrid") return out;
  }

  if (!q || mode === "title") return out;
  if (!q) return out.slice(0, maxSessions);

  // Content-only (all mode): prefer higher match counts, then original order.
  const contentOnly = contentHits
    .filter((h) => !seen.has(h.id) && (includeArchived || !h.archived))
    .slice()
    .sort((a, b) => (b.matchCount ?? 0) - (a.matchCount ?? 0));

  for (const h of contentOnly) {
    out.push({
      id: h.id,
      title: h.title,
      projectId: h.projectId,
      snippet: h.snippet,
      matchCount: h.matchCount,
      titleMatch: false,
      contentMatch: true,
      archived: h.archived,
    });
    if (rankMode !== "hybrid" && out.length >= maxSessions) break;
  }

  if (rankMode === "hybrid") {
    for (const hit of out) {
      hit.score = scoreSessionSearchHit(q, hit);
    }
    out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  return out.slice(0, maxSessions);
}
