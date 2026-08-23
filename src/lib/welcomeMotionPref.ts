/** Settings → Appearance → Interface: animate the empty new-chat welcome. */
export const WELCOME_MOTION_STORAGE_KEY = "grok.welcomeMotion";
export const WELCOME_MOTION_CHANGE_EVENT = "grok-welcome-motion-change";
export const DEFAULT_WELCOME_MOTION = true;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

export function parseWelcomeMotionPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_WELCOME_MOTION;
}

export function loadWelcomeMotionPref(
  storage: StorageLike = defaultStorage(),
): boolean {
  try {
    return parseWelcomeMotionPref(storage.getItem(WELCOME_MOTION_STORAGE_KEY));
  } catch {
    return DEFAULT_WELCOME_MOTION;
  }
}

export function saveWelcomeMotionPref(
  enabled: boolean,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(WELCOME_MOTION_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(WELCOME_MOTION_CHANGE_EVENT, { detail: enabled }),
    );
  } catch {
    /* restricted window */
  }
}
