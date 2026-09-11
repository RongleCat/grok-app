/**
 * User preference: virtualize the main chat transcript.
 * localStorage-only — does not touch Host AppSettings.
 *
 * Default on: same as the previous always-on virtual window. Turn off
 * for native overflow if that window jumps when scrolling up.
 */

export const CHAT_VIRTUAL_SCROLL_STORAGE_KEY = "grok.chatVirtualScroll";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const CHAT_VIRTUAL_SCROLL_CHANGE_EVENT = "grok-chat-virtual-scroll-change";

export const DEFAULT_CHAT_VIRTUAL_SCROLL = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface ChatVirtualScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ChatVirtualScrollStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default on. */
export function parseChatVirtualScrollPref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  return DEFAULT_CHAT_VIRTUAL_SCROLL;
}

export function loadChatVirtualScrollPref(
  storage: ChatVirtualScrollStorage = defaultStorage(),
): boolean {
  try {
    return parseChatVirtualScrollPref(
      storage.getItem(CHAT_VIRTUAL_SCROLL_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_CHAT_VIRTUAL_SCROLL;
  }
}

export function saveChatVirtualScrollPref(
  enabled: boolean,
  storage: ChatVirtualScrollStorage = defaultStorage(),
): void {
  try {
    storage.setItem(CHAT_VIRTUAL_SCROLL_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(CHAT_VIRTUAL_SCROLL_CHANGE_EVENT, {
          detail: enabled,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
