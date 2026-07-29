/**
 * User preference for line numbers on chat markdown code blocks.
 * Frontend-only localStorage; default off.
 */

export const CODE_LINE_NUMBERS_PREF_KEY = "grok.codeLineNumbers";

/** Dispatched on `window` after a successful save (detail = new pref). */
export const CODE_LINE_NUMBERS_PREF_EVENT = "grok:codeLineNumbersPref";

/** `true` = show line number gutter; `false` = no gutter (default). */
export type CodeLineNumbersPref = boolean;

export function loadCodeLineNumbersPref(
  storage: Storage = localStorage,
): CodeLineNumbersPref {
  try {
    const v = storage.getItem(CODE_LINE_NUMBERS_PREF_KEY);
    if (v === "1" || v === "true" || v === "on") return true;
    if (v === "0" || v === "false" || v === "off") return false;
  } catch {
    /* private mode */
  }
  return false;
}

export function saveCodeLineNumbersPref(
  pref: CodeLineNumbersPref,
  storage: Storage = localStorage,
): void {
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
