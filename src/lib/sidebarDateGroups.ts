/**
 * Pure helpers: bucket sidebar sessions by relative calendar day.
 *
 * Buckets (local day boundaries relative to `now`):
 * - today
 * - yesterday
 * - previous7  (2–7 local days ago, inclusive)
 * - older
 *
 * Within each group: pinned first, then newest `updatedAt`.
 * Empty groups are omitted. Order is always today → yesterday → previous7 → older.
 */

export type SidebarDateGroupId =
  | "today"
  | "yesterday"
  | "previous7"
  | "older";

export const SIDEBAR_DATE_GROUP_ORDER: readonly SidebarDateGroupId[] = [
  "today",
  "yesterday",
  "previous7",
  "older",
] as const;

/** i18n keys for section headers (`src/i18n/messages.ts`). */
export const SIDEBAR_DATE_GROUP_I18N_KEYS: Record<
  SidebarDateGroupId,
  | "sidebar.dateGroup.today"
  | "sidebar.dateGroup.yesterday"
  | "sidebar.dateGroup.previous7"
  | "sidebar.dateGroup.older"
> = {
  today: "sidebar.dateGroup.today",
  yesterday: "sidebar.dateGroup.yesterday",
  previous7: "sidebar.dateGroup.previous7",
  older: "sidebar.dateGroup.older",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal session shape required for bucketing / pin sort. */
export type DateGroupableSession = {
  updatedAt: string;
  pinned?: boolean;
};

export type SidebarDateGroup<T> = {
  id: SidebarDateGroupId;
  sessions: T[];
};

/** Local-calendar midnight for `d` (device timezone). */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse `updatedAt` to epoch ms; invalid / missing → NaN. */
export function parseSessionUpdatedAt(
  updatedAt: string | number | Date | null | undefined,
): number {
  if (updatedAt == null || updatedAt === "") return Number.NaN;
  if (typeof updatedAt === "number") {
    return Number.isFinite(updatedAt) ? updatedAt : Number.NaN;
  }
  if (updatedAt instanceof Date) {
    const t = updatedAt.getTime();
    return Number.isFinite(t) ? t : Number.NaN;
  }
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? t : Number.NaN;
}

/**
 * Local-day distance from `now`'s calendar day to the session's calendar day.
 * 0 = today (or future), 1 = yesterday, 2… = older days.
 * Invalid timestamps → treated as far in the past (older).
 */
export function localDayOffset(
  updatedAt: string | number | Date | null | undefined,
  now: Date = new Date(),
): number {
  const t = parseSessionUpdatedAt(updatedAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  const nowDay = startOfLocalDay(now).getTime();
  const sessionDay = startOfLocalDay(new Date(t)).getTime();
  return Math.floor((nowDay - sessionDay) / DAY_MS);
}

/** Bucket id for a single timestamp relative to `now`. */
export function sidebarDateGroupId(
  updatedAt: string | number | Date | null | undefined,
  now: Date = new Date(),
): SidebarDateGroupId {
  const offset = localDayOffset(updatedAt, now);
  if (offset <= 0) return "today";
  if (offset === 1) return "yesterday";
  if (offset <= 7) return "previous7";
  return "older";
}

/** Pinned first, then newest `updatedAt` (matches host `sort_sessions_by_pin_then_updated`). */
export function compareSessionsPinThenUpdated(
  a: DateGroupableSession,
  b: DateGroupableSession,
): number {
  const ap = a.pinned ? 1 : 0;
  const bp = b.pinned ? 1 : 0;
  if (bp !== ap) return bp - ap;
  const at = parseSessionUpdatedAt(a.updatedAt);
  const bt = parseSessionUpdatedAt(b.updatedAt);
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk && bOk) return bt - at;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}

/**
 * Flat sidebar order: pinned first, then newest last-run time.
 * Does not mutate the input array. No date-section grouping.
 */
export function sortSessionsForSidebar<T extends DateGroupableSession>(
  sessions: readonly T[],
): T[] {
  return sessions.slice().sort(compareSessionsPinThenUpdated);
}

/** Session shape for lifting pins out of their project folder. */
export type GlobalPinnableSession = DateGroupableSession & {
  archived?: boolean;
};

/**
 * Pinned chats sit at the top of the whole sidebar (above folders).
 * Archived rows are omitted. Does not mutate the input array.
 */
export function partitionGlobalPinned<T extends GlobalPinnableSession>(
  sessions: readonly T[],
): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const s of sessions) {
    if (s.archived) continue;
    if (s.pinned) pinned.push(s);
    else rest.push(s);
  }
  return { pinned: sortSessionsForSidebar(pinned), rest };
}

/** j/k order: global pins, then expanded project chats, then default-workspace orphans. */
export function sidebarNavSessionIds<
  T extends GlobalPinnableSession & {
    id: string;
    projectId?: string | null;
  },
>(input: {
  sessions: readonly T[];
  projects: readonly { id: string }[];
  projectsOpen: boolean;
  historyOpen: boolean;
  expandedProjects: Record<string, boolean>;
}): string[] {
  const { pinned, rest } = partitionGlobalPinned(input.sessions);
  const ids = pinned.map((s) => s.id);
  const projectIdSet = new Set(input.projects.map((p) => p.id));
  if (input.projectsOpen) {
    for (const proj of input.projects) {
      if (input.expandedProjects[proj.id] === false) continue;
      const projSessions = rest.filter((s) => s.projectId === proj.id);
      for (const s of sortSessionsForSidebar(projSessions)) ids.push(s.id);
    }
  }
  if (input.historyOpen) {
    const orphans = rest.filter(
      (s) => !s.projectId || !projectIdSet.has(s.projectId),
    );
    for (const s of sortSessionsForSidebar(orphans)) ids.push(s.id);
  }
  return ids;
}

/**
 * Group sessions into relative-date sections.
 * @deprecated Sidebar UI no longer groups by date; prefer {@link sortSessionsForSidebar}.
 * Does not mutate the input array. Empty groups omitted.
 */
export function groupSessionsByDate<T extends DateGroupableSession>(
  sessions: readonly T[],
  now: Date = new Date(),
): SidebarDateGroup<T>[] {
  const buckets: Record<SidebarDateGroupId, T[]> = {
    today: [],
    yesterday: [],
    previous7: [],
    older: [],
  };

  for (const s of sessions) {
    buckets[sidebarDateGroupId(s.updatedAt, now)].push(s);
  }

  const groups: SidebarDateGroup<T>[] = [];
  for (const id of SIDEBAR_DATE_GROUP_ORDER) {
    const list = buckets[id];
    if (list.length === 0) continue;
    list.sort(compareSessionsPinThenUpdated);
    groups.push({ id, sessions: list });
  }
  return groups;
}
