/**
 * User preference for browser spellcheck on the main chat composer.
 * Default matches current product: spellcheck off.
 */

export const COMPOSER_SPELLCHECK_KEY = "grok.composerSpellcheck";

/** Fired on `window` after a same-tab preference save (storage events are cross-tab only). */
export const COMPOSER_SPELLCHECK_CHANGED_EVENT = "grok:composerSpellcheck";

export function loadComposerSpellcheck(
  storage: Storage = localStorage,
): boolean {
  try {
    const v = storage.getItem(COMPOSER_SPELLCHECK_KEY);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* private mode */
  }
  return false;
}

export function saveComposerSpellcheck(
  enabled: boolean,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(COMPOSER_SPELLCHECK_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(COMPOSER_SPELLCHECK_CHANGED_EVENT, {
          detail: enabled,
        }),
      );
    }
  } catch {
    /* ignore */
  }
}
