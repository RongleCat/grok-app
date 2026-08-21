/**
 * Paint unread session count on the Windows taskbar *button* overlay.
 * Independent of `trayBusyBadge` (dock/tray count, default on).
 * localStorage-only — does not touch Host AppSettings.
 * Default: off. Fail-closed outside Tauri (invoke no-op via api).
 */

export const WIN_TASKBAR_OVERLAY_STORAGE_KEY = "grok.winTaskbarOverlay";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const WIN_TASKBAR_OVERLAY_CHANGE_EVENT = "grok-win-taskbar-overlay-change";

export const DEFAULT_WIN_TASKBAR_OVERLAY = false;

/** Minimal storage surface so unit tests need no jsdom. */
export interface WinTaskbarOverlayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): WinTaskbarOverlayStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseWinTaskbarOverlayPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_WIN_TASKBAR_OVERLAY;
}

export function loadWinTaskbarOverlayPref(
  storage: WinTaskbarOverlayStorage = defaultStorage(),
): boolean {
  try {
    return parseWinTaskbarOverlayPref(
      storage.getItem(WIN_TASKBAR_OVERLAY_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_WIN_TASKBAR_OVERLAY;
  }
}

export function saveWinTaskbarOverlayPref(
  enabled: boolean,
  storage: WinTaskbarOverlayStorage = defaultStorage(),
): void {
  try {
    storage.setItem(WIN_TASKBAR_OVERLAY_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(WIN_TASKBAR_OVERLAY_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
