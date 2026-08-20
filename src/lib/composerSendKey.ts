/**
 * User preference for which key sends the composer draft.
 * Default matches current product: plain Enter sends, Shift+Enter is newline.
 * Power users can switch to Cmd/Ctrl+Enter to send (Enter inserts newline).
 */

const STORAGE_KEY = "grok.composerSendKey";

/** Fired on `window` after a same-tab preference save (storage events are cross-tab only). */
export const COMPOSER_SEND_KEY_CHANGED_EVENT = "grok:composerSendKey";

export type ComposerSendKeyPref = "enter" | "mod-enter";

export function loadComposerSendKeyPref(
  storage: Storage = localStorage,
): ComposerSendKeyPref {
  try {
    const v = storage.getItem(STORAGE_KEY);
    if (v === "mod-enter") return "mod-enter";
    if (v === "enter") return "enter";
  } catch {
    /* private mode */
  }
  return "enter";
}

export function saveComposerSendKeyPref(
  pref: ComposerSendKeyPref,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(COMPOSER_SEND_KEY_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

export type ComposerSendKeyEvent = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

/**
 * Whether this keydown should submit the composer (not insert a newline).
 * - `enter`: plain Enter (no modifiers)
 * - `mod-enter`: Cmd/Ctrl+Enter (no Shift/Alt)
 */
export function shouldSendOnKeydown(
  e: ComposerSendKeyEvent,
  pref: ComposerSendKeyPref,
): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey) return false;
  if (pref === "enter") {
    return !e.metaKey && !e.ctrlKey;
  }
  // mod-enter
  return e.metaKey || e.ctrlKey;
}

/**
 * Mid-turn Steer chord. Default matches Grok Build CLI: **Ctrl+Enter**
 * (non–VS Code family; CLI docs also list Ctrl+I / Apple Ctrl+O / VS Code
 * family Ctrl+L as terminal-specific alts).
 *
 * Independent of the Composer send-key preference. While a turn is live,
 * this chord steers (`sessionInterject`) instead of queueing. Cmd+Enter is
 * accepted too so macOS App users hit the same modifier as other App chords.
 */
export function shouldSteerOnKeydown(e: ComposerSendKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey) return false;
  return e.ctrlKey || e.metaKey;
}
