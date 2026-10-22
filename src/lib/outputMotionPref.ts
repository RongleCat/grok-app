/**
 * Model output motion preference (Appearance → Interface).
 *
 * The toggle only maintains `html[data-output-motion="off"]` and localStorage;
 * the actual text reveal and block entrance rules live in CSS and the render
 * layer. On by default, and the system Reduce Motion setting always wins.
 */
export const OUTPUT_MOTION_STORAGE_KEY = "grok.outputMotion";

/** Dispatched on `window` after a save; `detail` is the new boolean. */
export const OUTPUT_MOTION_CHANGE_EVENT = "grok-output-motion-change";

/** On by default so upgrades do not silently change how the app feels. */
export const DEFAULT_OUTPUT_MOTION = true;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Falls back to a no-op store when localStorage is missing (SSR / restricted
 * environments). */
function defaultStorage(): StorageLike {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parses the stored value; unrecognized input falls back to enabled. */
export function parseOutputMotionPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_OUTPUT_MOTION;
}

/** Reads the preference; falls back to enabled when reading fails. */
export function loadOutputMotionPref(
  storage: StorageLike = defaultStorage(),
): boolean {
  try {
    return parseOutputMotionPref(storage.getItem(OUTPUT_MOTION_STORAGE_KEY));
  } catch {
    /* private mode / storage unavailable */
    return DEFAULT_OUTPUT_MOTION;
  }
}

/** Saves the preference and notifies subscribers in this window. */
export function saveOutputMotionPref(
  enabled: boolean,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(OUTPUT_MOTION_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota exceeded */
  }
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(OUTPUT_MOTION_CHANGE_EVENT, { detail: enabled }),
    );
  } catch {
    /* restricted window */
  }
}

/**
 * Mirrors the toggle onto the document root: writes
 * `data-output-motion="off"` when disabled and removes the attribute when
 * enabled to restore motion. Returns early with no document (SSR / tests).
 */
export function applyOutputMotionToDocument(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) {
    delete root.dataset.outputMotion;
    return;
  }
  root.dataset.outputMotion = "off";
}
