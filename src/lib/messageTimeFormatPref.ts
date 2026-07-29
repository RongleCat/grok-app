/**
 * Message timestamp display format (Appearance → Interface).
 * localStorage-only — does not touch Host AppSettings.
 *
 * - `absolute` (default): compact weekday + clock (`formatMessageTime`)
 * - `relative`: “2 minutes ago” style (`formatRelativeTime`); chat refreshes ~60s
 */

export type MessageTimeFormat = "absolute" | "relative";

export const MESSAGE_TIME_FORMAT_STORAGE_KEY = "grok.messageTimeFormat";

/** Fired on `window` after a successful save (detail = format). */
export const MESSAGE_TIME_FORMAT_CHANGE_EVENT =
  "grok-message-time-format-change";

export const DEFAULT_MESSAGE_TIME_FORMAT: MessageTimeFormat = "absolute";

export const MESSAGE_TIME_FORMATS: readonly MessageTimeFormat[] = [
  "absolute",
  "relative",
] as const;

/** Minimal storage surface so unit tests need no jsdom. */
export interface MessageTimeFormatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MessageTimeFormatStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

export function isMessageTimeFormat(value: unknown): value is MessageTimeFormat {
  return value === "absolute" || value === "relative";
}

/** Parse stored value; invalid / empty → default absolute. */
export function parseMessageTimeFormat(raw: unknown): MessageTimeFormat {
  if (typeof raw === "string" && isMessageTimeFormat(raw)) return raw;
  return DEFAULT_MESSAGE_TIME_FORMAT;
}

export function loadMessageTimeFormatPref(
  storage: MessageTimeFormatStorage = defaultStorage(),
): MessageTimeFormat {
  try {
    return parseMessageTimeFormat(
      storage.getItem(MESSAGE_TIME_FORMAT_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_MESSAGE_TIME_FORMAT;
  }
}

export function saveMessageTimeFormatPref(
  format: MessageTimeFormat,
  storage: MessageTimeFormatStorage = defaultStorage(),
): void {
  try {
    storage.setItem(MESSAGE_TIME_FORMAT_STORAGE_KEY, format);
  } catch {
    /* private mode / quota */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(
        new CustomEvent(MESSAGE_TIME_FORMAT_CHANGE_EVENT, { detail: format }),
      );
    } catch {
      /* ignore */
    }
  }
}
