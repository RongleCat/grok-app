/**
 * Sidebar session pagination — long project / default-workspace lists render
 * one page at a time with a "Show more" row instead of mounting every row.
 *
 * `SidebarPageMap` holds per-group counters of *extra* revealed pages
 * (`0` = first page only). Collapsing a group clears its counter so a reopen
 * starts from the first page again.
 */

/** Session rows revealed per page inside a sidebar group. */
export const SIDEBAR_SESSION_PAGE_SIZE = 5;

/** group key → number of extra revealed pages. */
export type SidebarPageMap = Record<string, number>;

/**
 * Resolve how many rows a paged group renders.
 *
 * `extraPages` grows the window in page steps ("Show more" clicks).
 * `activeIndex` is the viewing session's index inside the group's sorted rows
 * (`-1` when absent). When it sits beyond the revealed window the window grows
 * page-wise until the active row is reachable — the open chat must never stay
 * hidden behind "Show more".
 */
export function sidebarVisibleCount(
  total: number,
  extraPages: number,
  activeIndex: number,
): number {
  if (total <= 0) return 0;
  let count = SIDEBAR_SESSION_PAGE_SIZE * (1 + Math.max(0, extraPages));
  if (activeIndex >= count) {
    count =
      Math.ceil((activeIndex + 1) / SIDEBAR_SESSION_PAGE_SIZE) *
      SIDEBAR_SESSION_PAGE_SIZE;
  }
  return Math.min(total, count);
}

/**
 * Reveal one more page for a group.
 *
 * `visibleCount` is how many rows are already on screen. The open chat can
 * grow that window without writing `extraPages`, so a bare +1 repeats the
 * same page and Show more looks dead. The stored counter jumps to the page
 * just past the rows the user can already see.
 */
export function bumpSidebarPage(
  map: SidebarPageMap,
  key: string,
  visibleCount = 0,
): SidebarPageMap {
  const stored = Math.max(0, map[key] ?? 0);
  const storedWindow = SIDEBAR_SESSION_PAGE_SIZE * (1 + stored);
  const shown = Math.max(storedWindow, Math.max(0, Math.trunc(visibleCount)));
  const pagesShown = Math.ceil(shown / SIDEBAR_SESSION_PAGE_SIZE);
  return { ...map, [key]: pagesShown };
}

/** Drop a group's counter (collapse → next open starts at page one). */
export function clearSidebarPage(
  map: SidebarPageMap,
  key: string,
): SidebarPageMap {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}
