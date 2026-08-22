/**
 * User preference for default line-wrap on chat markdown code blocks.
 * Per-block toggle still works independently; this only sets the initial state.
 */

export const CODE_WRAP_PREF_KEY = "grok.codeWrapDefault";

/** Dispatched on `window` after a successful save (detail = new pref). */
export const CODE_WRAP_PREF_EVENT = "grok:codeWrapPref";

/** `true` = wrap lines by default; `false` = horizontal scroll (no wrap). */
export type CodeWrapPref = boolean;

let memoryWrapPref: CodeWrapPref | null = null;

export function resetCodeWrapPrefCacheForTest(): void {
  memoryWrapPref = null;
}

export function loadCodeWrapPref(
  storage: Storage = localStorage,
): CodeWrapPref {
  if (
    typeof localStorage !== "undefined" &&
    storage === localStorage &&
    memoryWrapPref !== null
  ) {
    return memoryWrapPref;
  }
  try {
    const v = storage.getItem(CODE_WRAP_PREF_KEY);
    let parsed = false;
    if (v === "1" || v === "true" || v === "wrap") parsed = true;
    else if (v === "0" || v === "false" || v === "scroll") parsed = false;
    if (typeof localStorage !== "undefined" && storage === localStorage) {
      memoryWrapPref = parsed;
    }
    return parsed;
  } catch {
    /* private mode */
  }
  // Default: no wrap (current CodeBlock behavior).
  return false;
}

export function saveCodeWrapPref(
  pref: CodeWrapPref,
  storage: Storage = localStorage,
): void {
  if (typeof localStorage !== "undefined" && storage === localStorage) {
    memoryWrapPref = pref;
  }
  try {
    storage.setItem(CODE_WRAP_PREF_KEY, pref ? "wrap" : "scroll");
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CODE_WRAP_PREF_EVENT, { detail: pref }),
      );
    }
  } catch {
    /* ignore */
  }
}
