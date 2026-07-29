/**
 * Sidebar session-row relative updated time (Appearance → Interface).
 * localStorage-only — does not touch Host AppSettings.
 * Default: true (show “2 hours ago” style meta on session rows).
 */

export const SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY =
  "grok.sidebarShowRelativeTime";

/** Fired on `window` after a successful save (detail = boolean show). */
export const SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT =
  "grok-sidebar-show-relative-time-change";

export const DEFAULT_SIDEBAR_SHOW_RELATIVE_TIME = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface SidebarShowRelativeTimeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SidebarShowRelativeTimeStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default true. */
export function parseSidebarShowRelativeTimePref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_SIDEBAR_SHOW_RELATIVE_TIME;
}

export function loadSidebarShowRelativeTimePref(
  storage: SidebarShowRelativeTimeStorage = defaultStorage(),
): boolean {
  try {
    return parseSidebarShowRelativeTimePref(
      storage.getItem(SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_SIDEBAR_SHOW_RELATIVE_TIME;
  }
}

export function saveSidebarShowRelativeTimePref(
  show: boolean,
  storage: SidebarShowRelativeTimeStorage = defaultStorage(),
): void {
  try {
    storage.setItem(SIDEBAR_SHOW_RELATIVE_TIME_STORAGE_KEY, show ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT, {
          detail: show,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
