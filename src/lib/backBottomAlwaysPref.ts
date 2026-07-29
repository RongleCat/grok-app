/**
 * User preference: always show the chat "back to bottom" control.
 * localStorage-only — does not touch Host AppSettings.
 * Default: false (show only when the user has scrolled up, as today).
 */

export const BACK_BOTTOM_ALWAYS_STORAGE_KEY = "grok.backBottomAlways";

/** Fired on `window` after a successful save (detail = boolean always). */
export const BACK_BOTTOM_ALWAYS_CHANGE_EVENT = "grok-back-bottom-always-change";

export const DEFAULT_BACK_BOTTOM_ALWAYS = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface BackBottomAlwaysStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): BackBottomAlwaysStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseBackBottomAlwaysPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_BACK_BOTTOM_ALWAYS;
}

export function loadBackBottomAlwaysPref(
  storage: BackBottomAlwaysStorage = defaultStorage(),
): boolean {
  try {
    return parseBackBottomAlwaysPref(
      storage.getItem(BACK_BOTTOM_ALWAYS_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_BACK_BOTTOM_ALWAYS;
  }
}

export function saveBackBottomAlwaysPref(
  always: boolean,
  storage: BackBottomAlwaysStorage = defaultStorage(),
): void {
  try {
    storage.setItem(BACK_BOTTOM_ALWAYS_STORAGE_KEY, always ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(BACK_BOTTOM_ALWAYS_CHANGE_EVENT, { detail: always }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure visibility for the back-to-bottom control.
 * Always-on pref OR the normal scrolled-up (showBack) signal.
 */
export function shouldShowBackBottom(
  always: boolean,
  scrolledUp: boolean,
): boolean {
  return always || scrolledUp;
}
