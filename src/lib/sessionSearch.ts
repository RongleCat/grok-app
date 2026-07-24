/** Pure helpers for the sidebar / command-palette search. */

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
};

/**
 * Filter sessions and projects by a free-text query.
 * Matches session title / id, and project name / path.
 * When a query matches a project, its sessions are also included.
 */
export function filterSessionSearch(
  query: string,
  sessions: SearchableSession[],
  projects: SearchableProject[],
  opts?: { maxSessions?: number; maxProjects?: number; includeArchived?: boolean },
): SessionSearchHits {
  const maxSessions = opts?.maxSessions ?? 20;
  const maxProjects = opts?.maxProjects ?? 10;
  const includeArchived = opts?.includeArchived ?? false;

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

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const matchedProjects = projects
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    )
    .slice(0, maxProjects);
  const matchedProjectIds = new Set(matchedProjects.map((p) => p.id));

  const matchedSessions = live
    .filter((s) => {
      if (s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
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
          (p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
        ) {
          return true;
        }
      }
      return false;
    })
    .slice(0, maxSessions);

  return { matchedSessions, matchedProjects };
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
    const lower = content.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx < 0) continue;
    matchCount += 1;
    if (snippet === undefined) {
      snippet = makeContentSnippet(content, idx, q.length, radius, maxLen);
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
 * Title matches first; content-only rows append. Empty query → title list only.
 */
export function mergeSessionSearchHits(
  query: string,
  titleHits: SearchableSession[],
  contentHits: SessionContentHit[],
  opts?: { maxSessions?: number; includeArchived?: boolean },
): MergedSessionHit[] {
  const maxSessions = opts?.maxSessions ?? 20;
  const includeArchived = opts?.includeArchived ?? false;
  const q = query.trim();

  const contentById = new Map<string, SessionContentHit>();
  for (const h of contentHits) {
    if (!includeArchived && h.archived) continue;
    contentById.set(h.id, h);
  }

  const out: MergedSessionHit[] = [];
  const seen = new Set<string>();

  for (const s of titleHits) {
    if (!includeArchived && s.archived) continue;
    const c = contentById.get(s.id);
    out.push({
      id: s.id,
      title: s.title,
      projectId: s.projectId,
      snippet: c?.snippet,
      matchCount: c?.matchCount,
      titleMatch: q.length > 0,
      contentMatch: !!c,
    });
    seen.add(s.id);
    if (out.length >= maxSessions) return out;
  }

  if (!q) return out;

  // Content-only: prefer higher match counts, then original order.
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
    });
    if (out.length >= maxSessions) break;
  }

  return out;
}
