/**
 * User preference for line numbers on chat markdown code blocks.
 * Frontend-only localStorage; default off.
 */

export const CODE_LINE_NUMBERS_PREF_KEY = "grok.codeLineNumbers";

/** Dispatched on `window` after a successful save (detail = new pref). */
export const CODE_LINE_NUMBERS_PREF_EVENT = "grok:codeLineNumbersPref";

/** `true` = show line number gutter; `false` = no gutter (default). */
export type CodeLineNumbersPref = boolean;

let memoryLineNumbersPref: CodeLineNumbersPref | null = null;

export function resetCodeLineNumbersPrefCacheForTest(): void {
  memoryLineNumbersPref = null;
}

export function loadCodeLineNumbersPref(
  storage: Storage = localStorage,
): CodeLineNumbersPref {
  if (
    typeof localStorage !== "undefined" &&
    storage === localStorage &&
    memoryLineNumbersPref !== null
  ) {
    return memoryLineNumbersPref;
  }
  try {
    const v = storage.getItem(CODE_LINE_NUMBERS_PREF_KEY);
    let parsed = false;
    if (v === "1" || v === "true" || v === "on") parsed = true;
    else if (v === "0" || v === "false" || v === "off") parsed = false;
    if (typeof localStorage !== "undefined" && storage === localStorage) {
      memoryLineNumbersPref = parsed;
    }
    return parsed;
  } catch {
    /* private mode */
  }
  return false;
}

export function saveCodeLineNumbersPref(
  pref: CodeLineNumbersPref,
  storage: Storage = localStorage,
): void {
  if (typeof localStorage !== "undefined" && storage === localStorage) {
    memoryLineNumbersPref = pref;
  }
  try {
    storage.setItem(CODE_LINE_NUMBERS_PREF_KEY, pref ? "1" : "0");
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CODE_LINE_NUMBERS_PREF_EVENT, { detail: pref }),
      );
    }
  } catch {
    /* ignore */
  }
}
