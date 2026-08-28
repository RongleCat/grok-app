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
 * this chord steers (`sessionInterject`) instead of queueing.
 *
 * Ctrl only — not Cmd. Grok Build CLI uses Ctrl+Enter on every platform,
 * including macOS (Apple Terminal falls back to Ctrl+O). Cmd+Enter stays
 * the optional Composer send key (`mod-enter`).
 */
export function shouldSteerOnKeydown(e: ComposerSendKeyEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey || e.altKey) return false;
  return e.ctrlKey && !e.metaKey;
}

export type ComposerSubmitAction = "steer" | "send" | "none";

/**
 * Whether the Ctrl+Enter chord should be dispatched to `steerFromComposer`.
 * Permission waits stay **true** — that handler toasts and refuses to write.
 * Pre-filtering `awaiting_permission` here made the chord a silent no-op.
 */
export function composerSteerLive(opts: {
  canGuideQueuedMessage: boolean;
  sessionState: string;
}): boolean {
  void opts.sessionState;
  return opts.canGuideQueuedMessage;
}

/**
 * What composer Enter should do. Steer (CLI Ctrl+Enter) wins while a
 * turn is live so a mod-enter send pref cannot queue instead.
 */
export function resolveComposerSubmitAction(opts: {
  event: ComposerSendKeyEvent;
  sendPref: ComposerSendKeyPref;
  /** Live turn (streaming **or** permission wait). Handler toasts on the gate. */
  canSteer: boolean;
}): ComposerSubmitAction {
  if (shouldSteerOnKeydown(opts.event) && opts.canSteer) return "steer";
  if (shouldSendOnKeydown(opts.event, opts.sendPref)) return "send";
  return "none";
}
