/**
 * Keep the main desktop window always on top of others.
 * localStorage-only — does not touch Host AppSettings.
 * Default: off. Fail-closed outside Tauri (no-op, never throws).
 */

export const WINDOW_ALWAYS_ON_TOP_STORAGE_KEY = "grok.windowAlwaysOnTop";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const WINDOW_ALWAYS_ON_TOP_CHANGE_EVENT =
  "grok-window-always-on-top-change";

export const DEFAULT_WINDOW_ALWAYS_ON_TOP = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface WindowAlwaysOnTopStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): WindowAlwaysOnTopStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Parse stored value; invalid / empty → default false. */
export function parseWindowAlwaysOnTopPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_WINDOW_ALWAYS_ON_TOP;
}

export function loadWindowAlwaysOnTopPref(
  storage: WindowAlwaysOnTopStorage = defaultStorage(),
): boolean {
  try {
    return parseWindowAlwaysOnTopPref(
      storage.getItem(WINDOW_ALWAYS_ON_TOP_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_WINDOW_ALWAYS_ON_TOP;
  }
}

export function saveWindowAlwaysOnTopPref(
  enabled: boolean,
  storage: WindowAlwaysOnTopStorage = defaultStorage(),
): void {
  try {
    storage.setItem(WINDOW_ALWAYS_ON_TOP_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(WINDOW_ALWAYS_ON_TOP_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Apply always-on-top via Tauri `setAlwaysOnTop`.
 * Fail-closed: returns false outside Tauri or on error; never throws.
 */
export async function applyWindowAlwaysOnTop(
  enabled: boolean,
): Promise<boolean> {
  try {
    if (!isTauriRuntime()) return false;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(enabled);
    return true;
  } catch {
    return false;
  }
}
